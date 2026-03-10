import { vi } from 'vitest';

const mockVscode = vi.hoisted(() => {
  const selectChatModels = vi.fn();

  class CancellationTokenSource {
    token = { isCancellationRequested: false };

    cancel() {
      this.token.isCancellationRequested = true;
    }

    dispose() {}
  }

  class LanguageModelTextPart {
    value: string;

    constructor(value: string) {
      this.value = value;
    }
  }

  class LanguageModelToolCallPart {}
  class LanguageModelToolResultPart {}
  class LanguageModelError extends Error {}

  const LanguageModelChatMessage = {
    Assistant: (content: unknown) => ({ role: 'assistant', content }),
    User: (content: unknown) => ({ role: 'user', content })
  };

  return {
    CancellationTokenSource,
    LanguageModelChatMessage,
    LanguageModelError,
    LanguageModelTextPart,
    LanguageModelToolCallPart,
    LanguageModelToolResultPart,
    lm: { selectChatModels },
    selectChatModels,
    window: {
      createTerminal: vi.fn(() => ({
        exitStatus: undefined,
        sendText: vi.fn(),
        show: vi.fn()
      }))
    },
    workspace: {
      asRelativePath: vi.fn(),
      fs: {
        createDirectory: vi.fn(),
        writeFile: vi.fn()
      },
      workspaceFolders: []
    },
    commands: {
      executeCommand: vi.fn()
    },
    Uri: {
      joinPath: vi.fn()
    }
  };
});

vi.mock('vscode', () => mockVscode);

import { __testing, CopilotBridge } from './copilotBridge.ts';

const toAsyncIterable = <T>(values: T[]) => {
  return {
    async *[Symbol.asyncIterator]() {
      for (const value of values) {
        yield value;
      }
    }
  };
};

describe('copilot bridge tool execution helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVscode.selectChatModels.mockReset();
  });

  it('normalizes safe workspace-relative paths', () => {
    expect(__testing.normalizeWorkspaceRelativePath('src\\index.ts')).toBe(
      'src/index.ts'
    );
    expect(__testing.normalizeWorkspaceRelativePath('/nested/file.ts')).toBe(
      'nested/file.ts'
    );
  });

  it('rejects paths that escape the workspace', () => {
    expect(() =>
      __testing.normalizeWorkspaceRelativePath('../secret.txt')
    ).toThrow(/within the current workspace/);
  });

  it('builds a terminal command execution plan', () => {
    expect(
      __testing.toToolExecutionPlan('run_terminal_command', {
        command: 'pnpm test'
      })
    ).toEqual({
      kind: 'run_terminal_command',
      command: 'pnpm test'
    });
  });

  it('requires concrete file content for file edits', () => {
    expect(
      __testing.toToolExecutionPlan('edit_file', {
        filePath: 'src/index.ts',
        content: 'console.log("hi")\n'
      })
    ).toEqual({
      kind: 'edit_file',
      filePath: 'src/index.ts',
      content: 'console.log("hi")\n'
    });
  });

  it('maps command payload args for execute_tool', () => {
    expect(
      __testing.toToolExecutionPlan('execute_tool', {
        toolName: 'workbench.action.files.save',
        input: { args: ['a', 2] }
      })
    ).toEqual({
      kind: 'execute_tool',
      commandId: 'workbench.action.files.save',
      args: ['a', 2]
    });
  });

  it('uses the minimal execution result payload', () => {
    expect(__testing.createExecutionResult()).toBe('ok');
  });

  it('renders a compact Copilot prompt', () => {
    expect(
      __testing.renderPromptText({
        type: 'copilot_prompt',
        clientId: 'default',
        requestId: 'req-1',
        mode: 'plan',
        prompt: 'Add tests',
        userDisplayName: 'alice'
      })
    ).toBe('Reply with a brief plan.\nCtx:alice@default\nAdd tests');
  });

  it('keeps tool descriptions short', () => {
    expect(__testing.remoteTools.map((tool) => tool.description)).toEqual([
      'Run a terminal command after approval.',
      'Write a workspace file after approval.',
      'Run a VS Code command after approval.'
    ]);
  });

  it('uses short mode instructions', () => {
    expect(__testing.createModeInstruction('ask')).toBe('Reply briefly.');
    expect(__testing.createModeInstruction('plan')).toBe(
      'Reply with a brief plan.'
    );
    expect(__testing.createModeInstruction('agent')).toBe(
      'Act and reply briefly.'
    );
  });

  it('reuses shared conversation across prompts', async () => {
    const capturedConversations: unknown[] = [];
    const model = {
      id: 'copilot-auto',
      sendRequest: vi
        .fn()
        .mockImplementationOnce(async (messages: unknown) => {
          capturedConversations.push(JSON.parse(JSON.stringify(messages)));
          return {
            stream: toAsyncIterable([
              new mockVscode.LanguageModelTextPart('First reply')
            ]),
            text: toAsyncIterable([])
          };
        })
        .mockImplementationOnce(async (messages: unknown) => {
          capturedConversations.push(JSON.parse(JSON.stringify(messages)));
          return {
            stream: toAsyncIterable([
              new mockVscode.LanguageModelTextPart('Second reply')
            ]),
            text: toAsyncIterable([])
          };
        })
    };

    mockVscode.selectChatModels.mockResolvedValue([model]);

    const bridge = new CopilotBridge(
      {
        languageModelAccessInformation: {
          canSendRequest: () => true
        }
      } as never,
      { appendLine: vi.fn() } as never
    );

    await bridge.runPrompt(
      {
        type: 'copilot_prompt',
        clientId: 'default',
        requestId: 'req-1',
        mode: 'ask',
        prompt: 'First prompt',
        userDisplayName: 'alice'
      },
      {
        onText: vi.fn(),
        requestPermission: vi.fn()
      }
    );

    await bridge.runPrompt(
      {
        type: 'copilot_prompt',
        clientId: 'default',
        requestId: 'req-2',
        mode: 'ask',
        prompt: 'Second prompt',
        userDisplayName: 'alice'
      },
      {
        onText: vi.fn(),
        requestPermission: vi.fn()
      }
    );

    expect(model.sendRequest).toHaveBeenCalledTimes(2);
    expect(capturedConversations[0]).toEqual([
      {
        role: 'user',
        content: 'Reply briefly.\nCtx:alice@default\nFirst prompt'
      }
    ]);
    expect(capturedConversations[1]).toEqual([
      {
        role: 'user',
        content: 'Reply briefly.\nCtx:alice@default\nFirst prompt'
      },
      {
        role: 'assistant',
        content: 'First reply'
      },
      {
        role: 'user',
        content: 'Reply briefly.\nCtx:alice@default\nSecond prompt'
      }
    ]);
  });
});
