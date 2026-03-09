import {
  type CopilotPromptMessage,
  type PermissionAction,
  type PermissionRequestMessage
} from '@remote-copilot/shared';
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

const REMOTE_TOOLS: vscode.LanguageModelChatTool[] = [
  {
    name: 'run_terminal_command',
    description:
      'Request approval before running a terminal command in the local workspace.',
    inputSchema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'Terminal command the model wants to run.'
        }
      },
      required: ['command']
    }
  },
  {
    name: 'edit_file',
    description: 'Request approval before editing a workspace file.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'Workspace-relative file path to edit.'
        },
        summary: {
          type: 'string',
          description: 'Short description of the intended file change.'
        }
      },
      required: ['filePath', 'summary']
    }
  },
  {
    name: 'execute_tool',
    description: 'Request approval before invoking another developer tool.',
    inputSchema: {
      type: 'object',
      properties: {
        toolName: {
          type: 'string',
          description: 'Developer tool name to invoke.'
        },
        input: {
          type: 'object',
          description: 'Tool input payload.'
        }
      },
      required: ['toolName']
    }
  }
];

export class CopilotBridge {
  #context: vscode.ExtensionContext;
  #outputChannel: vscode.OutputChannel;

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

  async runPrompt(message: CopilotPromptMessage, handlers: RunPromptHandlers) {
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
    const conversation = [
      api.LanguageModelChatMessage.User(this.#renderPrompt(message))
    ];

    try {
      const response = await model.sendRequest(
        conversation,
        { tools: REMOTE_TOOLS },
        tokenSource.token
      );
      await this.#streamResponse(
        response,
        model,
        conversation,
        message,
        handlers,
        tokenSource.token
      );
    } catch (error) {
      throw new Error(this.#toUserFacingError(error));
    } finally {
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

    for await (const part of response.stream) {
      if (part instanceof api.LanguageModelTextPart) {
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

        conversation.push(api.LanguageModelChatMessage.Assistant([part]));
        conversation.push(
          api.LanguageModelChatMessage.User([
            new api.LanguageModelToolResultPart(part.callId, [
              new api.LanguageModelTextPart(
                'Approved by the remote operator. Continue by describing the intended action and any manual steps instead of executing side effects automatically.'
              )
            ])
          ])
        );

        const followUp = await model.sendRequest(
          conversation,
          { tools: REMOTE_TOOLS },
          token
        );
        await this.#streamResponse(
          followUp,
          model,
          conversation,
          prompt,
          handlers,
          token
        );
        return;
      }
    }
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
    const modeInstruction = (() => {
      switch (message.mode) {
        case 'ask':
          return 'Answer the request directly and concisely.';
        case 'plan':
          return 'Produce an implementation plan with practical steps, risks, and validation guidance.';
        case 'agent':
          return 'Reason step-by-step like an autonomous coding assistant, but only return the response text.';
      }
    })();

    return [
      modeInstruction,
      `Remote user: ${message.userDisplayName ?? 'unknown'}`,
      `Workspace client: ${message.clientId}`,
      '',
      'User prompt:',
      message.prompt
    ].join('\n');
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

  #toUserFacingError(error: unknown) {
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
