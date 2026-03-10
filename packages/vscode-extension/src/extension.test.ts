import { beforeEach, describe, expect, it, vi } from 'vitest';

const configurationState = vi.hoisted(() => ({
  clientId: 'default',
  maxSessionMessages: 24,
  relayUrl: 'ws://127.0.0.1:8787/',
  sharedSecret: 'secret',
  target: 'global' as 'global' | 'workspace'
}));

const registeredCommands = vi.hoisted(
  () => new Map<string, (...args: unknown[]) => unknown>()
);
const bridgeInstances = vi.hoisted(() => [] as any[]);
const relayInstances = vi.hoisted(() => [] as any[]);
const transcriptStore = vi.hoisted(() => new Map<string, unknown>());

const mockOutputChannel = vi.hoisted(() => ({
  appendLine: vi.fn(),
  show: vi.fn(),
  dispose: vi.fn()
}));

const mockVscode = vi.hoisted(() => {
  const configuration = {
    get: vi.fn((key: string, fallback?: unknown) => {
      switch (key) {
        case 'clientId':
          return configurationState.clientId ?? fallback;
        case 'maxSessionMessages':
          return configurationState.maxSessionMessages ?? fallback;
        case 'relayUrl':
          return configurationState.relayUrl ?? fallback;
        case 'sharedSecret':
          return configurationState.sharedSecret ?? fallback;
        default:
          return fallback;
      }
    }),
    inspect: vi.fn((key: string) => {
      if (key !== 'sharedSecret') {
        return undefined;
      }

      return configurationState.target === 'workspace'
        ? { workspaceValue: configurationState.sharedSecret }
        : {};
    }),
    update: vi.fn(async (key: string, value: string) => {
      if (key === 'sharedSecret') {
        configurationState.sharedSecret = value;
      }
    })
  };

  return {
    commands: {
      executeCommand: vi.fn(),
      registerCommand: vi.fn(
        (command: string, callback: (...args: unknown[]) => unknown) => {
          registeredCommands.set(command, callback);
          return { dispose: vi.fn() };
        }
      )
    },
    ConfigurationTarget: {
      Global: 'global',
      Workspace: 'workspace'
    },
    env: {
      clipboard: {
        writeText: vi.fn()
      }
    },
    ViewColumn: {
      Active: 1
    },
    window: {
      createOutputChannel: vi.fn(() => mockOutputChannel),
      showErrorMessage: vi.fn(),
      showInformationMessage: vi.fn(),
      showTextDocument: vi.fn(),
      showWarningMessage: vi.fn()
    },
    workspace: {
      getConfiguration: vi.fn(() => configuration),
      openTextDocument: vi.fn(async (options: unknown) => options)
    }
  };
});

vi.mock('vscode', () => mockVscode);
vi.mock('./copilotBridge.ts', () => ({
  CopilotBridge: class MockCopilotBridge {
    authorizeAccess = vi.fn().mockResolvedValue('authorized');
    cancelPrompt = vi.fn().mockReturnValue(true);
    clearSharedConversation = vi.fn();
    runPrompt = vi.fn().mockResolvedValue(undefined);

    constructor(
      public context: unknown,
      public outputChannel: unknown,
      public options: unknown
    ) {
      bridgeInstances.push(this as MockCopilotBridge);
    }
  }
}));
vi.mock('./relayClient.ts', () => ({
  VscodeRelayClient: class MockRelayClient {
    connect = vi.fn().mockResolvedValue(undefined);
    disconnect = vi.fn().mockResolvedValue(undefined);
    reconnect = vi.fn().mockResolvedValue(undefined);
    rejectPendingPermissionRequests = vi.fn();
    requestPermission = vi.fn().mockResolvedValue({ approved: true });
    sendStream = vi.fn().mockResolvedValue(undefined);
    promptListener?: (message: any) => void | Promise<void>;
    cancelListener?: (message: any) => void | Promise<void>;
    statusListener?: (message: any) => void | Promise<void>;
    connectionProblemListener?: (message: string) => void | Promise<void>;

    constructor(public options: unknown) {
      relayInstances.push(this as MockRelayClient);
    }

    onPrompt = vi.fn((listener: (message: any) => void | Promise<void>) => {
      this.promptListener = listener;
      return () => {
        this.promptListener = undefined;
      };
    });

    onCancel = vi.fn((listener: (message: any) => void | Promise<void>) => {
      this.cancelListener = listener;
      return () => {
        this.cancelListener = undefined;
      };
    });

    onStatus = vi.fn((listener: (message: any) => void | Promise<void>) => {
      this.statusListener = listener;
      return () => {
        this.statusListener = undefined;
      };
    });

    onConnectionProblem = vi.fn(
      (listener: (message: string) => void | Promise<void>) => {
        this.connectionProblemListener = listener;
        return () => {
          this.connectionProblemListener = undefined;
        };
      }
    );
  }
}));

import { __testing, activate } from './extension.ts';

const createContext = () => {
  return {
    globalState: {
      get: vi.fn((key: string, fallback?: unknown) => {
        return transcriptStore.has(key) ? transcriptStore.get(key) : fallback;
      }),
      update: vi.fn(async (key: string, value: unknown) => {
        transcriptStore.set(key, value);
      })
    },
    subscriptions: [] as unknown[]
  } as any;
};

const getCommand = (command: string) => {
  const handler = registeredCommands.get(command);
  if (!handler) {
    throw new Error(`Missing command: ${command}`);
  }

  return handler;
};

describe('extension helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registeredCommands.clear();
    bridgeInstances.length = 0;
    relayInstances.length = 0;
    transcriptStore.clear();
    configurationState.clientId = 'default';
    configurationState.maxSessionMessages = 24;
    configurationState.relayUrl = 'ws://127.0.0.1:8787/';
    configurationState.sharedSecret = 'secret';
    configurationState.target = 'global';
  });

  it('loads trimmed configuration values', () => {
    configurationState.clientId = ' default ';
    configurationState.relayUrl = ' ws://example.test/ ';
    configurationState.sharedSecret = ' secret ';

    expect(__testing.loadConfiguration()).toEqual({
      clientId: 'default',
      maxSessionMessages: 24,
      relayUrl: 'ws://example.test/',
      sharedSecret: 'secret'
    });
  });

  it('validates missing configuration fields', () => {
    expect(
      __testing.validateConfiguration({
        clientId: '',
        maxSessionMessages: 24,
        relayUrl: '',
        sharedSecret: ''
      })
    ).toEqual([
      '`remoteCopilot.clientId` is empty.',
      '`remoteCopilot.relayUrl` is empty.',
      '`remoteCopilot.sharedSecret` is empty.'
    ]);
  });

  it('creates or reuses the shared secret and copies it', async () => {
    configurationState.sharedSecret = '';

    const generated = await __testing.ensureSharedSecret({
      copyToClipboard: true
    });

    expect(generated.generated).toBe(true);
    expect(generated.sharedSecret).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u
    );
    expect(mockVscode.env.clipboard.writeText).toHaveBeenCalledWith(
      generated.sharedSecret
    );

    const reused = await __testing.ensureSharedSecret({
      copyToClipboard: true
    });
    expect(reused.generated).toBe(false);
    expect(reused.sharedSecret).toBe(generated.sharedSecret);
  });

  it('selects the workspace target when the secret is set there', () => {
    configurationState.target = 'workspace';
    expect(__testing.getSharedSecretTarget()).toBe('workspace');
  });

  it('stores and clears transcripts', async () => {
    const context = createContext();

    await __testing.saveTranscript(context, {
      clientId: 'workspace-1',
      finishedAt: '2026-03-10T00:01:00.000Z',
      mode: 'ask',
      permissions: [],
      prompt: 'Hello',
      requestId: 'req-1',
      response: 'World',
      startedAt: '2026-03-10T00:00:00.000Z'
    });

    expect(transcriptStore.get(__testing.TRANSCRIPT_STORAGE_KEY)).toEqual([
      expect.objectContaining({ requestId: 'req-1' })
    ]);

    await __testing.clearTranscripts(context);
    expect(transcriptStore.get(__testing.TRANSCRIPT_STORAGE_KEY)).toEqual([]);
  });

  it('renders transcript markdown and fences embedded backticks safely', () => {
    expect(__testing.renderTranscriptMarkdown([])).toContain(
      'No saved remote sessions yet.'
    );
    expect(__testing.fenceFor('````code')).toBe('`````');
    expect(
      __testing.renderTranscriptMarkdown([
        {
          clientId: 'workspace-1',
          error: 'Boom',
          finishedAt: 'finish',
          mode: 'ask',
          permissions: [
            {
              action: 'edit_file',
              approved: true,
              details: 'details',
              requestedAt: 'a',
              respondedAt: 'b',
              title: 'Edit file'
            }
          ],
          prompt: '```prompt',
          requestId: 'req-1',
          response: 'reply',
          startedAt: 'start',
          userDisplayName: 'alice'
        }
      ])
    ).toContain('Stored transcripts: 1');
  });

  it('normalizes thrown values into user-facing errors', () => {
    expect(__testing.toErrorMessage(new Error('boom'))).toBe('boom');
    expect(__testing.toErrorMessage('boom')).toBe('boom');
  });
});

describe('activate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registeredCommands.clear();
    bridgeInstances.length = 0;
    relayInstances.length = 0;
    transcriptStore.clear();
    configurationState.clientId = 'default';
    configurationState.maxSessionMessages = 24;
    configurationState.relayUrl = 'ws://127.0.0.1:8787/';
    configurationState.sharedSecret = 'secret';
    configurationState.target = 'global';
  });

  it('connects the relay and wires commands', async () => {
    const context = createContext();
    await activate(context);

    expect(mockVscode.window.createOutputChannel).toHaveBeenCalledWith(
      'Remote Copilot'
    );
    expect(relayInstances).toHaveLength(1);
    expect(bridgeInstances).toHaveLength(1);
    expect(bridgeInstances[0]?.options).toEqual({ maxSessionMessages: 24 });
    expect(relayInstances[0]?.connect).toHaveBeenCalled();
    expect(context.subscriptions.length).toBeGreaterThan(0);

    await getCommand('remoteCopilot.clearSharedSession')();
    expect(bridgeInstances[0]?.clearSharedConversation).toHaveBeenCalled();
  });

  it('shows relay help and skips connecting for invalid configuration', async () => {
    configurationState.clientId = '   ';
    const context = createContext();

    await activate(context);

    expect(relayInstances[0]?.connect).not.toHaveBeenCalled();
    expect(mockVscode.window.showWarningMessage).toHaveBeenCalled();
  });

  it('streams prompt output, permissions, and transcripts', async () => {
    const context = createContext();
    await activate(context);

    const bridge = bridgeInstances[0]!;
    const relay = relayInstances[0]!;
    bridge.runPrompt.mockImplementation(
      async (_message: unknown, handlers: any) => {
        await handlers.onText('Hello');
        await handlers.requestPermission({
          type: 'permission_request',
          action: 'edit_file',
          clientId: 'workspace-1',
          permissionId: 'perm-1',
          requestId: 'req-1',
          title: 'Edit file'
        });
      }
    );

    await relay.promptListener?.({
      type: 'copilot_prompt',
      clientId: 'workspace-1',
      requestId: 'req-1',
      mode: 'ask',
      prompt: 'Explain',
      userDisplayName: 'alice'
    });
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(relay.sendStream).toHaveBeenCalledWith(
      expect.objectContaining({ delta: 'Hello', done: false })
    );
    expect(relay.requestPermission).toHaveBeenCalled();
    expect(transcriptStore.get(__testing.TRANSCRIPT_STORAGE_KEY)).toEqual([
      expect.objectContaining({ requestId: 'req-1', response: 'Hello' })
    ]);
  });

  it('sends an error stream when prompt handling fails', async () => {
    const context = createContext();
    await activate(context);

    const bridge = bridgeInstances[0]!;
    const relay = relayInstances[0]!;
    bridge.runPrompt.mockRejectedValue(new Error('Nope'));

    await relay.promptListener?.({
      type: 'copilot_prompt',
      clientId: 'workspace-1',
      requestId: 'req-2',
      mode: 'ask',
      prompt: 'Explain',
      userDisplayName: 'alice'
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(relay.sendStream).toHaveBeenLastCalledWith(
      expect.objectContaining({ done: true, error: 'Nope', requestId: 'req-2' })
    );
  });

  it('forwards cancel and status events', async () => {
    const context = createContext();
    await activate(context);

    const bridge = bridgeInstances[0]!;
    const relay = relayInstances[0]!;

    await relay.cancelListener?.({ requestId: 'req-1' });
    expect(bridge.cancelPrompt).toHaveBeenCalledWith('req-1');
    expect(relay.rejectPendingPermissionRequests).toHaveBeenCalledWith(
      'req-1',
      'Request cancelled by remote operator.'
    );

    await relay.statusListener?.({ level: 'warning', message: 'warn' });
    expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
      '[relay:warning] warn'
    );
  });

  it('opens settings, output, and reconnects from relay help', async () => {
    const context = createContext();
    await activate(context);

    const relay = relayInstances[0]!;

    mockVscode.window.showWarningMessage.mockResolvedValueOnce({
      title: 'Open Settings'
    });
    await relay.connectionProblemListener?.('Broken');
    expect(mockVscode.commands.executeCommand).toHaveBeenCalledWith(
      'workbench.action.openSettings',
      'remoteCopilot'
    );

    mockVscode.window.showWarningMessage.mockResolvedValueOnce({
      title: 'Show Output'
    });
    await relay.connectionProblemListener?.('Broken again');
    expect(mockOutputChannel.show).toHaveBeenCalledWith(true);

    mockVscode.window.showWarningMessage.mockResolvedValueOnce({
      title: 'Reconnect'
    });
    await relay.connectionProblemListener?.('Broken third');
    expect(relay.reconnect).toHaveBeenCalled();
  });

  it('shows sessions and clears them through commands', async () => {
    const context = createContext();
    transcriptStore.set(__testing.TRANSCRIPT_STORAGE_KEY, [
      {
        clientId: 'workspace-1',
        finishedAt: 'b',
        mode: 'ask',
        permissions: [],
        prompt: 'Hello',
        requestId: 'req-1',
        response: 'World',
        startedAt: 'a'
      }
    ]);
    await activate(context);

    await getCommand('remoteCopilot.showRemoteSessions')();
    expect(mockVscode.workspace.openTextDocument).toHaveBeenCalledWith(
      expect.objectContaining({ language: 'markdown' })
    );
    expect(mockVscode.window.showTextDocument).toHaveBeenCalled();

    await getCommand('remoteCopilot.clearRemoteSessions')();
    expect(transcriptStore.get(__testing.TRANSCRIPT_STORAGE_KEY)).toEqual([]);
  });
});
