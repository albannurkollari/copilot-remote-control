import {
  type CopilotPromptMessage,
  type PermissionRequestMessage
} from '@remote-copilot/shared';
import * as vscode from 'vscode';

import { CopilotBridge } from './copilotBridge.ts';
import { VscodeRelayClient } from './relayClient.ts';

interface RemoteCopilotConfiguration {
  clientId: string;
  relayUrl: string;
}

interface RemotePermissionTranscriptEntry {
  action: PermissionRequestMessage['action'];
  approved: boolean;
  command?: string;
  details?: string;
  reason?: string;
  requestedAt: string;
  respondedAt: string;
  title: string;
}

interface RemoteTranscriptEntry {
  clientId: string;
  error?: string;
  finishedAt: string;
  mode: CopilotPromptMessage['mode'];
  permissions: RemotePermissionTranscriptEntry[];
  prompt: string;
  requestId: string;
  response: string;
  startedAt: string;
  userDisplayName?: string;
}

const TRANSCRIPT_STORAGE_KEY = 'remoteCopilot.transcripts';
const MAX_TRANSCRIPTS = 50;

const loadConfiguration = (): RemoteCopilotConfiguration => {
  const configuration = vscode.workspace.getConfiguration('remoteCopilot');

  return {
    clientId: configuration.get<string>('clientId', 'default'),
    relayUrl: configuration.get<string>('relayUrl', 'ws://127.0.0.1:8787/')
  };
};

const toErrorMessage = (error: unknown) => {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
};

const saveTranscript = async (
  context: vscode.ExtensionContext,
  entry: RemoteTranscriptEntry
) => {
  const existing = context.globalState.get<RemoteTranscriptEntry[]>(
    TRANSCRIPT_STORAGE_KEY,
    []
  );

  const next = [
    entry,
    ...existing.filter((candidate) => candidate.requestId !== entry.requestId)
  ].slice(0, MAX_TRANSCRIPTS);

  await context.globalState.update(TRANSCRIPT_STORAGE_KEY, next);
};

const clearTranscripts = async (context: vscode.ExtensionContext) => {
  await context.globalState.update(TRANSCRIPT_STORAGE_KEY, []);
};

const fenceFor = (content: string): string => {
  const runs = content.match(/`+/g) ?? [];
  let fenceLength = 3;

  for (const run of runs) {
    if (run.length >= fenceLength) {
      fenceLength = run.length + 1;
    }
  }

  return '`'.repeat(fenceLength);
};

const renderTranscriptMarkdown = (entries: RemoteTranscriptEntry[]) => {
  if (entries.length === 0) {
    return [
      '# Remote Copilot Sessions',
      '',
      'No saved remote sessions yet.'
    ].join('\n');
  }

  return [
    '# Remote Copilot Sessions',
    '',
    `Stored transcripts: ${entries.length}`,
    '',
    ...entries.flatMap((entry) => {
      const permissions =
        entry.permissions.length === 0
          ? ['None']
          : entry.permissions.flatMap((permission) => {
              return [
                `- ${permission.title} (${permission.action})`,
                `  - Requested: ${permission.requestedAt}`,
                `  - Decision: ${permission.approved ? 'approved' : 'denied'}`,
                ...(permission.reason
                  ? [`  - Reason: ${permission.reason}`]
                  : []),
                ...(permission.command
                  ? [`  - Command: ${permission.command}`]
                  : []),
                ...(permission.details
                  ? [`  - Details: ${permission.details}`]
                  : [])
              ];
            });

      const promptFence = fenceFor(entry.prompt);
      const responseFence = fenceFor(
        entry.response.length > 0 ? entry.response : '(no response text)'
      );

      return [
        `## ${entry.requestId}`,
        '',
        `- Started: ${entry.startedAt}`,
        `- Finished: ${entry.finishedAt}`,
        `- Mode: ${entry.mode}`,
        `- Client: ${entry.clientId}`,
        `- User: ${entry.userDisplayName ?? 'unknown'}`,
        ...(entry.error ? [`- Error: ${entry.error}`] : []),
        '',
        '### Prompt',
        '',
        `${promptFence}text`,
        entry.prompt,
        promptFence,
        '',
        '### Permissions',
        '',
        ...permissions,
        '',
        '### Response',
        '',
        `${responseFence}text`,
        entry.response.length > 0 ? entry.response : '(no response text)',
        responseFence,
        ''
      ];
    })
  ].join('\n');
};

export async function activate(context: vscode.ExtensionContext) {
  const outputChannel = vscode.window.createOutputChannel('Remote Copilot');
  const configuration = loadConfiguration();
  const bridge = new CopilotBridge(context, outputChannel);
  const relayClient = new VscodeRelayClient({
    clientId: configuration.clientId,
    outputChannel,
    url: configuration.relayUrl
  });

  const handlePrompt = async (message: CopilotPromptMessage) => {
    const startedAt = new Date().toISOString();
    const permissions: RemotePermissionTranscriptEntry[] = [];
    let errorMessage: string | undefined;
    let responseText = '';

    outputChannel.appendLine(
      `[prompt:${message.requestId}] Received ${message.mode} prompt.`
    );

    try {
      await bridge.runPrompt(message, {
        onText: async (chunk) => {
          responseText += chunk;
          await relayClient.sendStream({
            type: 'copilot_stream',
            clientId: message.clientId,
            requestId: message.requestId,
            delta: chunk,
            done: false
          });
        },
        requestPermission: async (
          permissionRequest: PermissionRequestMessage
        ) => {
          outputChannel.appendLine(
            `[prompt:${message.requestId}] Awaiting permission for ${permissionRequest.action}.`
          );
          const requestedAt = new Date().toISOString();
          const approval =
            await relayClient.requestPermission(permissionRequest);

          permissions.push({
            action: permissionRequest.action,
            approved: approval.approved,
            command: permissionRequest.command,
            details: permissionRequest.details,
            reason: approval.reason,
            requestedAt,
            respondedAt: new Date().toISOString(),
            title: permissionRequest.title
          });

          return approval;
        }
      });

      await relayClient.sendStream({
        type: 'copilot_stream',
        clientId: message.clientId,
        requestId: message.requestId,
        done: true
      });
    } catch (error) {
      errorMessage = toErrorMessage(error);
      outputChannel.appendLine(`[prompt:${message.requestId}] ${errorMessage}`);

      await relayClient.sendStream({
        type: 'copilot_stream',
        clientId: message.clientId,
        requestId: message.requestId,
        done: true,
        error: errorMessage
      });
    } finally {
      try {
        await saveTranscript(context, {
          clientId: message.clientId,
          error: errorMessage,
          finishedAt: new Date().toISOString(),
          mode: message.mode,
          permissions,
          prompt: message.prompt,
          requestId: message.requestId,
          response: responseText,
          startedAt,
          userDisplayName: message.userDisplayName
        });
      } catch (error) {
        outputChannel.appendLine(`[transcript:error] ${toErrorMessage(error)}`);
      }
    }
  };

  const disposePromptListener = relayClient.onPrompt((message) => {
    void handlePrompt(message);
  });

  const disposeStatusListener = relayClient.onStatus((message) => {
    outputChannel.appendLine(`[relay:${message.level}] ${message.message}`);
  });

  context.subscriptions.push(
    relayClient,
    outputChannel,
    { dispose: disposePromptListener },
    { dispose: disposeStatusListener },
    vscode.commands.registerCommand(
      'remoteCopilot.authorizeCopilotAccess',
      async () => {
        try {
          const message = await bridge.authorizeAccess();
          void vscode.window.showInformationMessage(message);
        } catch (error) {
          void vscode.window.showErrorMessage(toErrorMessage(error));
        }
      }
    ),
    vscode.commands.registerCommand('remoteCopilot.showRelayOutput', () => {
      outputChannel.show(true);
    }),
    vscode.commands.registerCommand(
      'remoteCopilot.showRemoteSessions',
      async () => {
        try {
          const entries = context.globalState.get<RemoteTranscriptEntry[]>(
            TRANSCRIPT_STORAGE_KEY,
            []
          );
          const document = await vscode.workspace.openTextDocument({
            content: renderTranscriptMarkdown(entries),
            language: 'markdown'
          });

          await vscode.window.showTextDocument(document, {
            preview: false,
            viewColumn: vscode.ViewColumn.Active
          });
        } catch (error) {
          void vscode.window.showErrorMessage(toErrorMessage(error));
        }
      }
    ),
    vscode.commands.registerCommand(
      'remoteCopilot.clearRemoteSessions',
      async () => {
        try {
          await clearTranscripts(context);
          void vscode.window.showInformationMessage(
            'Remote Copilot transcripts cleared.'
          );
        } catch (error) {
          void vscode.window.showErrorMessage(toErrorMessage(error));
        }
      }
    ),
    vscode.commands.registerCommand(
      'remoteCopilot.reconnectRelay',
      async () => {
        try {
          await relayClient.reconnect();
          void vscode.window.showInformationMessage(
            'Remote Copilot relay reconnected.'
          );
        } catch (error) {
          void vscode.window.showErrorMessage(toErrorMessage(error));
        }
      }
    )
  );

  void relayClient.connect().catch((error) => {
    outputChannel.appendLine(`[relay:error] ${toErrorMessage(error)}`);
  });
}

export function deactivate() {
  return undefined;
}
