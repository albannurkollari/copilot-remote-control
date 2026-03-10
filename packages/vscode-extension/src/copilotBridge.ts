import {
  type CopilotPromptMessage,
  type PermissionAction,
  type PermissionRequestMessage
} from '@remote-copilot/shared';
import path from 'node:path';
import * as vscode from 'vscode';

export interface PermissionRequester {
  (
    message: PermissionRequestMessage
  ): Promise<{ approved: boolean; reason?: string }>;
}

export interface RunPromptHandlers {
  onText: (chunk: string) => void | Promise<void>;
  requestPermission: PermissionRequester;
}

type TerminalCommandExecution = {
  command: string;
  kind: 'run_terminal_command';
};

type FileEditExecution = {
  content: string;
  filePath: string;
  kind: 'edit_file';
};

type VsCodeCommandExecution = {
  args: unknown[];
  commandId: string;
  kind: 'execute_tool';
};

type ToolExecutionPlan =
  | TerminalCommandExecution
  | FileEditExecution
  | VsCodeCommandExecution;

const REMOTE_COPILOT_TERMINAL_NAME = 'Remote Copilot';

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null;
};

const isNonEmptyString = (value: unknown): value is string => {
  return typeof value === 'string' && value.trim().length > 0;
};

const MINIMAL_TOOL_RESULT = 'ok';

const createExecutionResult = () => {
  return MINIMAL_TOOL_RESULT;
};

const createModeInstruction = (mode: CopilotPromptMessage['mode']) => {
  switch (mode) {
    case 'ask':
      return 'Reply briefly.';
    case 'plan':
      return 'Reply with a brief plan.';
    case 'agent':
      return 'Act and reply briefly.';
  }
};

const renderPromptText = (message: CopilotPromptMessage) => {
  return [
    createModeInstruction(message.mode),
    `Ctx:${message.userDisplayName ?? 'unknown'}@${message.clientId}`,
    message.prompt
  ].join('\n');
};

const normalizeWorkspaceRelativePath = (filePath: string) => {
  const trimmed = filePath.trim();
  if (trimmed.length === 0) {
    throw new Error('File path must not be empty.');
  }

  const normalized = path.posix.normalize(
    trimmed.replace(/\\/g, '/').replace(/^\/+/g, '')
  );

  if (
    normalized.length === 0 ||
    normalized === '.' ||
    normalized.startsWith('../') ||
    path.posix.isAbsolute(normalized)
  ) {
    throw new Error(
      `File path must stay within the current workspace: ${filePath}`
    );
  }

  return normalized;
};

const toCommandArgs = (input: unknown) => {
  if (!isRecord(input)) {
    return input === undefined ? [] : [input];
  }

  if (Array.isArray(input.args)) {
    return [...input.args];
  }

  return Object.keys(input).length === 0 ? [] : [input];
};

const toToolExecutionPlan = (
  name: string,
  input: object
): ToolExecutionPlan => {
  const data = input as Record<string, unknown>;

  if (name === 'run_terminal_command') {
    if (!isNonEmptyString(data.command)) {
      throw new Error('run_terminal_command requires a non-empty command.');
    }

    return {
      kind: 'run_terminal_command',
      command: data.command.trim()
    };
  }

  if (name === 'edit_file') {
    if (!isNonEmptyString(data.filePath)) {
      throw new Error('edit_file requires a non-empty filePath.');
    }

    if (!isNonEmptyString(data.content)) {
      throw new Error('edit_file requires a non-empty content string.');
    }

    return {
      kind: 'edit_file',
      filePath: data.filePath.trim(),
      content: data.content
    };
  }

  if (name === 'execute_tool') {
    if (!isNonEmptyString(data.toolName)) {
      throw new Error('execute_tool requires a non-empty toolName.');
    }

    return {
      kind: 'execute_tool',
      commandId: data.toolName.trim(),
      args: toCommandArgs(data.input)
    };
  }

  throw new Error(`Unsupported tool call: ${name}`);
};

const REMOTE_TOOLS: vscode.LanguageModelChatTool[] = [
  {
    name: 'run_terminal_command',
    description: 'Run a terminal command after approval.',
    inputSchema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'Shell command.'
        }
      },
      required: ['command']
    }
  },
  {
    name: 'edit_file',
    description: 'Write a workspace file after approval.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'Workspace path.'
        },
        content: {
          type: 'string',
          description: 'Full file content.'
        }
      },
      required: ['filePath', 'content']
    }
  },
  {
    name: 'execute_tool',
    description: 'Run a VS Code command after approval.',
    inputSchema: {
      type: 'object',
      properties: {
        toolName: {
          type: 'string',
          description: 'Command id.'
        },
        input: {
          type: 'object',
          description: 'Optional args.'
        }
      },
      required: ['toolName']
    }
  }
];

export class CopilotBridge {
  #context: vscode.ExtensionContext;
  #activePrompts = new Map<
    string,
    {
      cancellationReason?: string;
      tokenSource: vscode.CancellationTokenSource;
    }
  >();
  #outputChannel: vscode.OutputChannel;
  #runQueue = Promise.resolve();
  #sharedConversation: vscode.LanguageModelChatMessage[] = [];
  #terminal?: vscode.Terminal;

  constructor(
    context: vscode.ExtensionContext,
    outputChannel: vscode.OutputChannel
  ) {
    this.#context = context;
    this.#outputChannel = outputChannel;
  }

  async authorizeAccess() {
    const api = this.#getLanguageModelApi();
    const model = await this.#selectModel();
    this.#outputChannel.appendLine(
      `[copilot] Authorizing access with model ${model.id ?? 'unknown'}.`
    );

    if (
      this.#context.languageModelAccessInformation.canSendRequest(model) ===
      true
    ) {
      return 'Copilot access is already authorized for this extension.';
    }

    const tokenSource = new api.CancellationTokenSource();

    try {
      const response = await model.sendRequest(
        [
          api.LanguageModelChatMessage.User(
            'Reply with exactly the word "authorized".'
          )
        ],
        {},
        tokenSource.token
      );

      for await (const _part of response.text) {
      }

      return 'Copilot access authorized for remote prompts.';
    } catch (error) {
      throw new Error(this.#toUserFacingError(error));
    } finally {
      tokenSource.dispose();
    }
  }

  cancelPrompt(
    requestId: string,
    reason = 'Request cancelled by remote operator.'
  ) {
    const activePrompt = this.#activePrompts.get(requestId);
    if (!activePrompt) {
      return false;
    }

    activePrompt.cancellationReason = reason;
    activePrompt.tokenSource.cancel();
    return true;
  }

  async runPrompt(message: CopilotPromptMessage, handlers: RunPromptHandlers) {
    const run = async () => {
      await this.#runPromptInSession(message, handlers);
    };

    const nextRun = this.#runQueue.then(run, run);
    this.#runQueue = nextRun.then(
      () => undefined,
      () => undefined
    );

    await nextRun;
  }

  async #runPromptInSession(
    message: CopilotPromptMessage,
    handlers: RunPromptHandlers
  ) {
    const api = this.#getLanguageModelApi();
    const model = await this.#selectModel();
    const canSend =
      this.#context.languageModelAccessInformation.canSendRequest(model);
    this.#outputChannel.appendLine(
      `[copilot] Handling ${message.mode} request ${message.requestId} with model ${model.id ?? 'unknown'}.`
    );

    if (canSend !== true) {
      throw new Error(
        'Copilot access has not been authorized for this extension. Run the "Remote Copilot: Authorize Copilot Access" command locally in VS Code first.'
      );
    }

    const tokenSource = new api.CancellationTokenSource();
    this.#activePrompts.set(message.requestId, { tokenSource });
    const userMessage = api.LanguageModelChatMessage.User(
      this.#renderPrompt(message)
    );
    const conversation = [...this.#sharedConversation, userMessage];

    try {
      if (tokenSource.token.isCancellationRequested) {
        throw new Error(
          this.#toUserFacingError('Request cancelled.', message.requestId)
        );
      }

      const response = await model.sendRequest(
        conversation,
        { tools: REMOTE_TOOLS },
        tokenSource.token
      );
      const assistantText = await this.#streamResponse(
        response,
        model,
        conversation,
        message,
        handlers,
        tokenSource.token
      );

      if (assistantText.trim().length > 0) {
        conversation.push(
          api.LanguageModelChatMessage.Assistant(assistantText)
        );
      }

      this.#sharedConversation = conversation;
    } catch (error) {
      throw new Error(this.#toUserFacingError(error, message.requestId));
    } finally {
      this.#activePrompts.delete(message.requestId);
      tokenSource.dispose();
    }
  }

  async #streamResponse(
    response: vscode.LanguageModelChatResponse,
    model: vscode.LanguageModelChat,
    conversation: vscode.LanguageModelChatMessage[],
    prompt: CopilotPromptMessage,
    handlers: RunPromptHandlers,
    token: vscode.CancellationToken
  ) {
    const api = this.#getLanguageModelApi();
    let assistantText = '';

    for await (const part of response.stream) {
      if (part instanceof api.LanguageModelTextPart) {
        assistantText += part.value;
        await handlers.onText(part.value);
        continue;
      }

      if (part instanceof api.LanguageModelToolCallPart) {
        this.#outputChannel.appendLine(
          `[copilot] Tool request ${part.name} for ${prompt.requestId}.`
        );
        const permissionRequest = this.#toPermissionRequest(prompt, part);
        const approval = await handlers.requestPermission(permissionRequest);

        if (!approval.approved) {
          throw new Error(
            approval.reason ?? `Permission denied for ${part.name}.`
          );
        }

        const executionResult = await this.#executeApprovedToolCall(part);

        conversation.push(api.LanguageModelChatMessage.Assistant([part]));
        conversation.push(
          api.LanguageModelChatMessage.User([
            new api.LanguageModelToolResultPart(part.callId, [
              new api.LanguageModelTextPart(executionResult)
            ])
          ])
        );

        const followUp = await model.sendRequest(
          conversation,
          { tools: REMOTE_TOOLS },
          token
        );
        assistantText += await this.#streamResponse(
          followUp,
          model,
          conversation,
          prompt,
          handlers,
          token
        );
        return assistantText;
      }
    }

    return assistantText;
  }

  async #executeApprovedToolCall(part: vscode.LanguageModelToolCallPart) {
    const plan = toToolExecutionPlan(part.name, part.input);

    switch (plan.kind) {
      case 'run_terminal_command': {
        const terminal = this.#getOrCreateTerminal();
        terminal.show(false);
        terminal.sendText(plan.command, true);

        return createExecutionResult();
      }

      case 'edit_file': {
        const fileUri = await this.#resolveWorkspaceFileUri(plan.filePath);
        await this.#ensureParentDirectory(fileUri);
        await vscode.workspace.fs.writeFile(
          fileUri,
          new TextEncoder().encode(plan.content)
        );

        return createExecutionResult();
      }

      case 'execute_tool': {
        await vscode.commands.executeCommand(plan.commandId, ...plan.args);

        return createExecutionResult();
      }
    }
  }

  #getOrCreateTerminal() {
    if (this.#terminal && this.#terminal.exitStatus === undefined) {
      return this.#terminal;
    }

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    this.#terminal = vscode.window.createTerminal({
      cwd: workspaceFolder?.uri,
      name: REMOTE_COPILOT_TERMINAL_NAME
    });

    return this.#terminal;
  }

  async #resolveWorkspaceFileUri(filePath: string) {
    const normalizedPath = normalizeWorkspaceRelativePath(filePath);
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

    if (!workspaceFolder) {
      throw new Error(
        'No workspace folder is open, so Remote Copilot cannot edit workspace files.'
      );
    }

    return vscode.Uri.joinPath(
      workspaceFolder.uri,
      ...normalizedPath.split('/')
    );
  }

  async #ensureParentDirectory(fileUri: vscode.Uri) {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return;
    }

    const relativePath = normalizeWorkspaceRelativePath(
      vscode.workspace.asRelativePath(fileUri, false)
    );
    const parentPath = path.posix.dirname(relativePath);

    if (parentPath === '.' || parentPath.length === 0) {
      return;
    }

    await vscode.workspace.fs.createDirectory(
      vscode.Uri.joinPath(workspaceFolder.uri, ...parentPath.split('/'))
    );
  }

  async #selectModel() {
    const { lm } = this.#getLanguageModelApi();
    const models = await lm.selectChatModels({ vendor: 'copilot' });

    if (models.length === 0) {
      throw new Error(
        'No GitHub Copilot chat model is available in this VS Code instance.'
      );
    }

    return models[0];
  }

  #renderPrompt(message: CopilotPromptMessage) {
    return renderPromptText(message);
  }

  #toPermissionRequest(
    prompt: CopilotPromptMessage,
    part: vscode.LanguageModelToolCallPart
  ): PermissionRequestMessage {
    const { action, command, details, title } = this.#describeToolCall(
      part.name,
      part.input
    );

    return {
      type: 'permission_request',
      clientId: prompt.clientId,
      requestId: prompt.requestId,
      permissionId: part.callId,
      action,
      title,
      details,
      command
    };
  }

  #describeToolCall(
    name: string,
    input: object
  ): {
    action: PermissionAction;
    command?: string;
    details?: string;
    title: string;
  } {
    const data = input as Record<string, unknown>;

    if (name === 'run_terminal_command') {
      return {
        action: 'run_terminal_command',
        command: typeof data.command === 'string' ? data.command : undefined,
        title: 'Run terminal command',
        details: JSON.stringify(input)
      };
    }

    if (name === 'edit_file') {
      return {
        action: 'edit_file',
        title: 'Edit workspace file',
        details: JSON.stringify(input)
      };
    }

    if (name === 'execute_tool') {
      return {
        action: 'execute_tool',
        title: 'Invoke developer tool',
        details: JSON.stringify(input)
      };
    }

    return {
      action: 'other',
      title: `Tool call: ${name}`,
      details: JSON.stringify(input)
    };
  }

  #getLanguageModelApi() {
    const api = vscode as typeof vscode & {
      lm?: typeof vscode.lm;
      LanguageModelChatMessage?: typeof vscode.LanguageModelChatMessage;
      LanguageModelError?: typeof vscode.LanguageModelError;
      LanguageModelTextPart?: typeof vscode.LanguageModelTextPart;
      LanguageModelToolCallPart?: typeof vscode.LanguageModelToolCallPart;
      LanguageModelToolResultPart?: typeof vscode.LanguageModelToolResultPart;
    };

    if (!this.#context.languageModelAccessInformation) {
      throw new Error(
        'This VS Code build does not expose the GitHub Copilot language model API required by Remote Copilot Host.'
      );
    }

    if (
      !api.lm ||
      !api.LanguageModelChatMessage ||
      !api.LanguageModelError ||
      !api.LanguageModelTextPart ||
      !api.LanguageModelToolCallPart ||
      !api.LanguageModelToolResultPart
    ) {
      throw new Error(
        'This VS Code build does not support the GitHub Copilot chat APIs required by Remote Copilot Host. Use a compatible VS Code version with GitHub Copilot Chat available.'
      );
    }

    return {
      CancellationTokenSource: vscode.CancellationTokenSource,
      LanguageModelChatMessage: api.LanguageModelChatMessage,
      LanguageModelError: api.LanguageModelError,
      LanguageModelTextPart: api.LanguageModelTextPart,
      LanguageModelToolCallPart: api.LanguageModelToolCallPart,
      LanguageModelToolResultPart: api.LanguageModelToolResultPart,
      lm: api.lm
    };
  }

  #toUserFacingError(error: unknown, requestId?: string) {
    if (requestId) {
      const activePrompt = this.#activePrompts.get(requestId);
      if (activePrompt?.tokenSource.token.isCancellationRequested) {
        return activePrompt.cancellationReason ?? 'Request cancelled.';
      }
    }

    const languageModelError = (
      vscode as typeof vscode & {
        LanguageModelError?: typeof vscode.LanguageModelError;
      }
    ).LanguageModelError;

    if (languageModelError && error instanceof languageModelError) {
      return error.message;
    }

    if (error instanceof Error) {
      return error.message;
    }

    return String(error);
  }
}

export const __testing = {
  createExecutionResult,
  createModeInstruction,
  remoteTools: REMOTE_TOOLS,
  normalizeWorkspaceRelativePath,
  renderPromptText,
  toCommandArgs,
  toToolExecutionPlan
};
