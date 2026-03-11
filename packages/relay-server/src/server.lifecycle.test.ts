import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  httpCloseError: undefined as Error | undefined,
  httpServers: [] as MockHttpServer[],
  listenError: undefined as Error | undefined,
  webSocketServers: [] as MockWebSocketServer[],
  wssCloseError: undefined as Error | undefined
}));

class MockHttpServer extends EventEmitter {
  close = vi.fn((callback?: (error?: Error) => void) => {
    queueMicrotask(() => callback?.(mockState.httpCloseError));
    return this;
  });

  listen = vi.fn((_port: number, _host: string, callback?: () => void) => {
    queueMicrotask(() => {
      if (mockState.listenError) {
        this.emit('error', mockState.listenError);
        return;
      }

      callback?.();
    });

    return this;
  });

  constructor() {
    super();
    mockState.httpServers.push(this);
  }
}

class MockWebSocketServer extends EventEmitter {
  close = vi.fn((callback?: (error?: Error) => void) => {
    queueMicrotask(() => callback?.(mockState.wssCloseError));
  });

  constructor(public options: unknown) {
    super();
    mockState.webSocketServers.push(this);
  }
}

class MockSocket extends EventEmitter {
  OPEN = 1;
  readyState = 1;
  sent: any[] = [];

  close = vi.fn(() => {
    this.readyState = 3;
  });

  send = vi.fn((message: string) => {
    this.sent.push(JSON.parse(message));
  });
}

vi.mock('node:http', () => ({
  createServer: () => new MockHttpServer()
}));

vi.mock('ws', () => ({
  WebSocketServer: MockWebSocketServer
}));

const loadServerModule = async () => {
  vi.resetModules();
  return await import('./server.ts');
};

const emitMessage = (socket: MockSocket, message: Record<string, unknown>) => {
  socket.emit('message', Buffer.from(JSON.stringify(message)));
};

const takeMessages = (socket: MockSocket) => {
  const messages = [...socket.sent];
  socket.sent.length = 0;
  return messages;
};

describe('RelayServer lifecycle coverage', () => {
  beforeEach(() => {
    mockState.httpCloseError = undefined;
    mockState.httpServers.length = 0;
    mockState.listenError = undefined;
    mockState.webSocketServers.length = 0;
    mockState.wssCloseError = undefined;
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('rejects startup listen failures and stop close failures', async () => {
    const listenError = new Error('listen failed');
    mockState.listenError = listenError;

    const { RelayServer } = await loadServerModule();
    const failedStartServer = new RelayServer({ port: 9901 });

    await expect(failedStartServer.start()).rejects.toThrow('listen failed');

    mockState.listenError = undefined;
    const wsCloseError = new Error('ws close failed');
    const httpCloseError = new Error('http close failed');

    const wsStopServer = new RelayServer({ port: 9902 });
    await wsStopServer.start();
    mockState.wssCloseError = wsCloseError;
    await expect(wsStopServer.stop()).rejects.toThrow('ws close failed');

    mockState.wssCloseError = undefined;
    const httpStopServer = new RelayServer({ port: 9903 });
    await httpStopServer.start();
    mockState.httpCloseError = httpCloseError;
    await expect(httpStopServer.stop()).rejects.toThrow('http close failed');
  });

  it('handles socket error closures by clearing pending requests and notifying discord', async () => {
    const { RelayServer } = await loadServerModule();
    const server = new RelayServer({ port: 9904 });
    await server.start();

    const wss = mockState.webSocketServers[0];
    const discord = new MockSocket();
    const vscode = new MockSocket();

    wss.emit('connection', discord);
    wss.emit('connection', vscode);

    emitMessage(discord, {
      type: 'register',
      clientRole: 'discord',
      clientId: 'bot-1'
    });
    emitMessage(vscode, {
      type: 'register',
      clientRole: 'vscode',
      clientId: 'workspace-1'
    });
    takeMessages(discord);
    takeMessages(vscode);

    emitMessage(discord, {
      type: 'copilot_prompt',
      clientId: 'workspace-1',
      requestId: 'req-1',
      mode: 'ask',
      prompt: 'Explain this function'
    });
    expect(takeMessages(vscode)).toEqual([
      expect.objectContaining({ type: 'copilot_prompt', requestId: 'req-1' })
    ]);

    vscode.emit('error', new Error('socket failed'));

    expect(discord.sent).toEqual([
      expect.objectContaining({
        type: 'relay_status',
        code: 'target_not_connected',
        requestId: 'req-1'
      }),
      expect.objectContaining({
        type: 'relay_status',
        code: 'client_disconnected',
        clientId: 'workspace-1'
      })
    ]);
  });
});
