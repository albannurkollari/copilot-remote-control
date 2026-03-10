import {
    createModeInstruction,
    DEFAULT_MAX_SESSION_MESSAGES,
    normalizeMaxSessionMessages,
    normalizeWorkspaceRelativePath,
    renderPromptText,
    toToolExecutionPlan,
    trimConversation
} from '@remote-copilot/shared';
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

  class LanguageModelToolCallPart {
    callId: string;
    input: object;
    name: string;

    constructor(callId: string, name: string, input: object) {
      this.callId = callId;
      this.name = name;
      this.input = input;
    }
  }

  class LanguageModelToolResultPart {
    callId: string;
    parts: unknown[];

    constructor(callId: string, parts: unknown[]) {
      this.callId = callId;
      this.parts = parts;
    }
  }
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
    expect(normalizeWorkspaceRelativePath('src\\index.ts')).toBe(
      'src/index.ts'
    );
    expect(normalizeWorkspaceRelativePath('/nested/file.ts')).toBe(
      'nested/file.ts'
    );
  });

  it('rejects paths that escape the workspace', () => {
    expect(() => normalizeWorkspaceRelativePath('../secret.txt')).toThrow(
      /within the current workspace/
    );
  });

  it('builds a terminal command execution plan', () => {
    expect(
      toToolExecutionPlan('run_terminal_command', {
        command: 'pnpm test'
      })
    ).toEqual({
      kind: 'run_terminal_command',
      command: 'pnpm test'
    });
  });

  it('requires concrete file content for file edits', () => {
    expect(
      toToolExecutionPlan('edit_file', {
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
      toToolExecutionPlan('execute_tool', {
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
      renderPromptText({
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
    expect(createModeInstruction('ask')).toBe('Reply briefly.');
    expect(createModeInstruction('plan')).toBe('Reply with a brief plan.');
    expect(createModeInstruction('agent')).toBe('Act and reply briefly.');
  });

  it('normalizes max retained session messages', () => {
    expect(normalizeMaxSessionMessages()).toBe(DEFAULT_MAX_SESSION_MESSAGES);
    expect(normalizeMaxSessionMessages(0)).toBe(1);
    expect(normalizeMaxSessionMessages(5.8)).toBe(5);
  });

  it('trims retained conversation to the newest messages', () => {
    expect(trimConversation([1, 2, 3, 4], 2)).toEqual([3, 4]);
    expect(trimConversation([1, 2], 4)).toEqual([1, 2]);
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

  it('returns early when Copilot access is already authorized', async () => {
    const model = {
      id: 'copilot-auto',
      sendRequest: vi.fn()
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

    await expect(bridge.authorizeAccess()).resolves.toBe(
      'Copilot access is already authorized for this extension.'
    );
    expect(model.sendRequest).not.toHaveBeenCalled();
  });

  it('authorizes access by sending the minimal authorization prompt', async () => {
    const model = {
      id: 'copilot-auto',
      sendRequest: vi.fn().mockResolvedValue({
        stream: toAsyncIterable([]),
        text: toAsyncIterable(['authorized'])
      })
    };

    mockVscode.selectChatModels.mockResolvedValue([model]);

    const bridge = new CopilotBridge(
      {
        languageModelAccessInformation: {
          canSendRequest: () => false
        }
      } as never,
      { appendLine: vi.fn() } as never
    );

    await expect(bridge.authorizeAccess()).resolves.toBe(
      'Copilot access authorized for remote prompts.'
    );
    expect(model.sendRequest).toHaveBeenCalledWith(
      [
        {
          role: 'user',
          content: 'Reply with exactly the word "authorized".'
        }
      ],
      {},
      expect.any(Object)
    );
  });

  it('surfaces authorization errors from the model', async () => {
    const model = {
      id: 'copilot-auto',
      sendRequest: vi.fn().mockRejectedValue(new Error('not allowed'))
    };

    mockVscode.selectChatModels.mockResolvedValue([model]);

    const bridge = new CopilotBridge(
      {
        languageModelAccessInformation: {
          canSendRequest: () => false
        }
      } as never,
      { appendLine: vi.fn() } as never
    );

    await expect(bridge.authorizeAccess()).rejects.toThrow('not allowed');
  });

  it('uses language model errors verbatim', async () => {
    const model = {
      id: 'copilot-auto',
      sendRequest: vi
        .fn()
        .mockRejectedValue(new mockVscode.LanguageModelError('lm failed'))
    };

    mockVscode.selectChatModels.mockResolvedValue([model]);

    const bridge = new CopilotBridge(
      {
        languageModelAccessInformation: {
          canSendRequest: () => false
        }
      } as never,
      { appendLine: vi.fn() } as never
    );

    await expect(bridge.authorizeAccess()).rejects.toThrow('lm failed');
  });

  it('coerces non-error thrown values into user-facing strings', async () => {
    const model = {
      id: 'copilot-auto',
      sendRequest: vi.fn().mockRejectedValue('plain failure')
    };

    mockVscode.selectChatModels.mockResolvedValue([model]);

    const bridge = new CopilotBridge(
      {
        languageModelAccessInformation: {
          canSendRequest: () => false
        }
      } as never,
      { appendLine: vi.fn() } as never
    );

    await expect(bridge.authorizeAccess()).rejects.toThrow('plain failure');
  });

  it('requires a compatible language model api', async () => {
    const bridge = new CopilotBridge(
      {} as never,
      { appendLine: vi.fn() } as never
    );

    await expect(bridge.authorizeAccess()).rejects.toThrow(
      /does not expose the GitHub Copilot language model API/
    );
  });

  it('executes approved terminal tool calls and streams the follow-up reply', async () => {
    const onText = vi.fn();
    const requestPermission = vi.fn().mockResolvedValue({ approved: true });
    const toolCall = new mockVscode.LanguageModelToolCallPart(
      'call-1',
      'run_terminal_command',
      {
        command: 'pnpm test'
      }
    );
    const model = {
      id: 'copilot-auto',
      sendRequest: vi
        .fn()
        .mockResolvedValueOnce({
          stream: toAsyncIterable([toolCall]),
          text: toAsyncIterable([])
        })
        .mockResolvedValueOnce({
          stream: toAsyncIterable([
            new mockVscode.LanguageModelTextPart('done')
          ]),
          text: toAsyncIterable([])
        })
    };

    mockVscode.selectChatModels.mockResolvedValue([model]);

    const terminal = {
      exitStatus: undefined,
      sendText: vi.fn(),
      show: vi.fn()
    };
    mockVscode.window.createTerminal.mockReturnValue(terminal);

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
        mode: 'agent',
        prompt: 'Run tests',
        userDisplayName: 'alice'
      },
      { onText, requestPermission }
    );

    expect(requestPermission).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'run_terminal_command',
        title: 'Run terminal command'
      })
    );
    expect(terminal.sendText).toHaveBeenCalledWith('pnpm test', true);
    expect(onText).toHaveBeenCalledWith('done');
  });

  it('writes approved file edits into the workspace', async () => {
    const toolCall = new mockVscode.LanguageModelToolCallPart(
      'call-1',
      'edit_file',
      {
        filePath: 'src/index.ts',
        content: 'console.log("hi")\n'
      }
    );
    const model = {
      id: 'copilot-auto',
      sendRequest: vi
        .fn()
        .mockResolvedValueOnce({
          stream: toAsyncIterable([toolCall]),
          text: toAsyncIterable([])
        })
        .mockResolvedValueOnce({
          stream: toAsyncIterable([]),
          text: toAsyncIterable([])
        })
    };

    mockVscode.selectChatModels.mockResolvedValue([model]);
    mockVscode.workspace.workspaceFolders = [{ uri: 'workspace-uri' }] as any;
    mockVscode.Uri.joinPath.mockImplementation((...parts: unknown[]) =>
      parts.join('/')
    );
    mockVscode.workspace.asRelativePath.mockReturnValue('src/index.ts');

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
        mode: 'agent',
        prompt: 'Edit file',
        userDisplayName: 'alice'
      },
      {
        onText: vi.fn(),
        requestPermission: vi.fn().mockResolvedValue({ approved: true })
      }
    );

    expect(mockVscode.workspace.fs.createDirectory).toHaveBeenCalled();
    expect(mockVscode.workspace.fs.writeFile).toHaveBeenCalledWith(
      'workspace-uri/src/index.ts',
      expect.any(Uint8Array)
    );
  });

  it('skips parent directory creation for workspace-root file edits', async () => {
    const toolCall = new mockVscode.LanguageModelToolCallPart(
      'call-1',
      'edit_file',
      {
        filePath: 'README.md',
        content: '# hi\n'
      }
    );
    const model = {
      id: 'copilot-auto',
      sendRequest: vi
        .fn()
        .mockResolvedValueOnce({
          stream: toAsyncIterable([toolCall]),
          text: toAsyncIterable([])
        })
        .mockResolvedValueOnce({
          stream: toAsyncIterable([]),
          text: toAsyncIterable([])
        })
    };

    mockVscode.selectChatModels.mockResolvedValue([model]);
    mockVscode.workspace.workspaceFolders = [{ uri: 'workspace-uri' }] as any;
    mockVscode.Uri.joinPath.mockImplementation((...parts: unknown[]) =>
      parts.join('/')
    );
    mockVscode.workspace.asRelativePath.mockReturnValue('README.md');

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
        requestId: 'req-root',
        mode: 'agent',
        prompt: 'Edit root file',
        userDisplayName: 'alice'
      },
      {
        onText: vi.fn(),
        requestPermission: vi.fn().mockResolvedValue({ approved: true })
      }
    );

    expect(mockVscode.workspace.fs.createDirectory).not.toHaveBeenCalled();
    expect(mockVscode.workspace.fs.writeFile).toHaveBeenCalledWith(
      'workspace-uri/README.md',
      expect.any(Uint8Array)
    );
  });

  it('executes approved VS Code commands', async () => {
    const toolCall = new mockVscode.LanguageModelToolCallPart(
      'call-1',
      'execute_tool',
      {
        toolName: 'workbench.action.files.save',
        input: { args: ['x'] }
      }
    );
    const model = {
      id: 'copilot-auto',
      sendRequest: vi
        .fn()
        .mockResolvedValueOnce({
          stream: toAsyncIterable([toolCall]),
          text: toAsyncIterable([])
        })
        .mockResolvedValueOnce({
          stream: toAsyncIterable([]),
          text: toAsyncIterable([])
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
        mode: 'agent',
        prompt: 'Save',
        userDisplayName: 'alice'
      },
      {
        onText: vi.fn(),
        requestPermission: vi.fn().mockResolvedValue({ approved: true })
      }
    );

    expect(mockVscode.commands.executeCommand).toHaveBeenCalledWith(
      'workbench.action.files.save',
      'x'
    );
  });

  it('surfaces denied permission errors', async () => {
    const toolCall = new mockVscode.LanguageModelToolCallPart(
      'call-1',
      'run_terminal_command',
      {
        command: 'pnpm test'
      }
    );
    const model = {
      id: 'copilot-auto',
      sendRequest: vi.fn().mockResolvedValue({
        stream: toAsyncIterable([toolCall]),
        text: toAsyncIterable([])
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

    await expect(
      bridge.runPrompt(
        {
          type: 'copilot_prompt',
          clientId: 'default',
          requestId: 'req-1',
          mode: 'agent',
          prompt: 'Run tests',
          userDisplayName: 'alice'
        },
        {
          onText: vi.fn(),
          requestPermission: vi.fn().mockResolvedValue({
            approved: false,
            reason: 'Denied'
          })
        }
      )
    ).rejects.toThrow('Denied');
  });

  it('returns a custom cancellation reason for cancelled prompts', async () => {
    let capturedToken: { isCancellationRequested: boolean } | undefined;
    let releaseSendRequest!: () => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const sendRequestGate = new Promise<void>((resolve) => {
      releaseSendRequest = resolve;
    });
    const model = {
      id: 'copilot-auto',
      sendRequest: vi
        .fn()
        .mockImplementation(
          async (_messages: unknown, _options: unknown, token: any) => {
            capturedToken = token;
            markStarted();
            await sendRequestGate;
            if (token.isCancellationRequested) {
              throw new Error('ignored');
            }

            return {
              stream: toAsyncIterable([]),
              text: toAsyncIterable([])
            };
          }
        )
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

    const run = bridge.runPrompt(
      {
        type: 'copilot_prompt',
        clientId: 'default',
        requestId: 'req-1',
        mode: 'ask',
        prompt: 'Cancel me',
        userDisplayName: 'alice'
      },
      {
        onText: vi.fn(),
        requestPermission: vi.fn()
      }
    );

    await started;
    expect(bridge.cancelPrompt('req-1', 'Custom cancel')).toBe(true);
    releaseSendRequest();
    await expect(run).rejects.toThrow('Custom cancel');
    expect(capturedToken?.isCancellationRequested).toBe(true);
  });

  it('fails to edit files when no workspace is open', async () => {
    const toolCall = new mockVscode.LanguageModelToolCallPart(
      'call-1',
      'edit_file',
      {
        filePath: 'src/index.ts',
        content: 'console.log("hi")\n'
      }
    );
    const model = {
      id: 'copilot-auto',
      sendRequest: vi.fn().mockResolvedValue({
        stream: toAsyncIterable([toolCall]),
        text: toAsyncIterable([])
      })
    };

    mockVscode.selectChatModels.mockResolvedValue([model]);
    mockVscode.workspace.workspaceFolders = [] as any;

    const bridge = new CopilotBridge(
      {
        languageModelAccessInformation: {
          canSendRequest: () => true
        }
      } as never,
      { appendLine: vi.fn() } as never
    );

    await expect(
      bridge.runPrompt(
        {
          type: 'copilot_prompt',
          clientId: 'default',
          requestId: 'req-1',
          mode: 'agent',
          prompt: 'Edit file',
          userDisplayName: 'alice'
        },
        {
          onText: vi.fn(),
          requestPermission: vi.fn().mockResolvedValue({ approved: true })
        }
      )
    ).rejects.toThrow(/No workspace folder is open/);
  });

  it('fails when no Copilot chat model is available', async () => {
    mockVscode.selectChatModels.mockResolvedValue([]);

    const bridge = new CopilotBridge(
      {
        languageModelAccessInformation: {
          canSendRequest: () => true
        }
      } as never,
      { appendLine: vi.fn() } as never
    );

    await expect(
      bridge.runPrompt(
        {
          type: 'copilot_prompt',
          clientId: 'default',
          requestId: 'req-no-model',
          mode: 'ask',
          prompt: 'Hello',
          userDisplayName: 'alice'
        },
        {
          onText: vi.fn(),
          requestPermission: vi.fn()
        }
      )
    ).rejects.toThrow(/No GitHub Copilot chat model is available/);
  });

  it('requires the full Copilot chat api surface when selecting models', async () => {
    const originalToolResultPart = mockVscode.LanguageModelToolResultPart;
    mockVscode.LanguageModelToolResultPart = undefined as any;

    try {
      const bridge = new CopilotBridge(
        {
          languageModelAccessInformation: {
            canSendRequest: () => true
          }
        } as never,
        { appendLine: vi.fn() } as never
      );

      await expect(
        bridge.runPrompt(
          {
            type: 'copilot_prompt',
            clientId: 'default',
            requestId: 'req-api',
            mode: 'ask',
            prompt: 'Hello',
            userDisplayName: 'alice'
          },
          {
            onText: vi.fn(),
            requestPermission: vi.fn()
          }
        )
      ).rejects.toThrow(/does not support the GitHub Copilot chat APIs/);
    } finally {
      mockVscode.LanguageModelToolResultPart = originalToolResultPart;
    }
  });

  it('describes unsupported tool calls before rejecting them', async () => {
    const requestPermission = vi.fn().mockResolvedValue({ approved: true });
    const toolCall = new mockVscode.LanguageModelToolCallPart(
      'call-1',
      'mystery_tool',
      { foo: 'bar' }
    );
    const model = {
      id: 'copilot-auto',
      sendRequest: vi.fn().mockResolvedValue({
        stream: toAsyncIterable([toolCall]),
        text: toAsyncIterable([])
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

    await expect(
      bridge.runPrompt(
        {
          type: 'copilot_prompt',
          clientId: 'default',
          requestId: 'req-unknown-tool',
          mode: 'agent',
          prompt: 'Try unknown tool',
          userDisplayName: 'alice'
        },
        {
          onText: vi.fn(),
          requestPermission
        }
      )
    ).rejects.toThrow(/Unsupported tool call: mystery_tool/);

    expect(requestPermission).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'other',
        title: 'Tool call: mystery_tool'
      })
    );
  });

  it('caps retained shared conversation size', async () => {
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
      { appendLine: vi.fn() } as never,
      { maxSessionMessages: 2 }
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

    expect(bridge.getSharedConversationSize()).toBe(2);

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

    expect(bridge.getSharedConversationSize()).toBe(2);
    expect(capturedConversations[1]).toEqual([
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

  it('clears the shared conversation on demand', async () => {
    const model = {
      id: 'copilot-auto',
      sendRequest: vi.fn().mockResolvedValue({
        stream: toAsyncIterable([
          new mockVscode.LanguageModelTextPart('Reply')
        ]),
        text: toAsyncIterable([])
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

    expect(bridge.getSharedConversationSize()).toBeGreaterThan(0);

    bridge.clearSharedConversation();

    expect(bridge.getSharedConversationSize()).toBe(0);
  });
});
