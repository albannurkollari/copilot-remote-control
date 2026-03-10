import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sockets = vi.hoisted(() => [] as any[]);
const encode = (message: unknown) => JSON.stringify(message);

vi.mock('vscode', () => ({}));
vi.mock('ws', () => {
  class MockWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSED = 3;

    #listeners = new Map<string, Array<(...args: any[]) => void>>();
    readyState = MockWebSocket.CONNECTING;
    send = vi.fn();
    close = vi.fn(() => {
      this.readyState = MockWebSocket.CLOSED;
      this.emit('close');
    });

    constructor(public url: string) {
      sockets.push(this);
    }

    on(event: string, listener: (...args: any[]) => void) {
      const listeners = this.#listeners.get(event) ?? [];
      listeners.push(listener);
      this.#listeners.set(event, listeners);
      return this;
    }

    emit(event: string, ...args: any[]) {
      for (const listener of this.#listeners.get(event) ?? []) {
        listener(...args);
      }
      return true;
    }
  }

  return {
    default: MockWebSocket,
    WebSocket: MockWebSocket
  };
});

import { VscodeRelayClient } from './relayClient.ts';

const outputChannel = {
  appendLine: vi.fn()
} as any;

const latestSocket = () => {
  const socket = sockets.at(-1);
  if (!socket) {
    throw new Error('Missing socket');
  }

  return socket;
};

const lastSentMessage = (socket: { send: ReturnType<typeof vi.fn> }) => {
  const payload = socket.send.mock.lastCall?.[0];
  return payload ? JSON.parse(payload) : undefined;
};

describe('VscodeRelayClient', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    sockets.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('connects, registers, and becomes ready', async () => {
    const client = new VscodeRelayClient({
      clientId: 'workspace-1',
      outputChannel,
      sharedSecret: 'secret',
      url: 'ws://relay.test'
    });

    const connecting = client.connect();
    const socket = latestSocket();
    socket.readyState = 1;
    socket.emit('open');
    expect(socket.send).toHaveBeenCalledWith(
      encode({
        type: 'register',
        clientRole: 'vscode',
        clientId: 'workspace-1',
        sharedSecret: 'secret'
      })
    );

    socket.emit(
      'message',
      Buffer.from(
        encode({
          type: 'register_ack',
          clientRole: 'vscode',
          clientId: 'workspace-1',
          connectionId: 'conn-1'
        })
      )
    );
    await connecting;

    expect(client.isReady).toBe(true);
  });

  it('sends streams and resolves permission responses', async () => {
    const client = new VscodeRelayClient({
      clientId: 'workspace-1',
      outputChannel,
      sharedSecret: 'secret',
      url: 'ws://relay.test'
    });

    const connecting = client.connect();
    const socket = latestSocket();
    socket.readyState = 1;
    socket.emit('open');
    socket.emit(
      'message',
      Buffer.from(
        encode({
          type: 'register_ack',
          clientRole: 'vscode',
          clientId: 'workspace-1',
          connectionId: 'conn-1'
        })
      )
    );
    await connecting;

    const permissionPromise = client.requestPermission({
      type: 'permission_request',
      action: 'edit_file',
      clientId: 'workspace-1',
      permissionId: 'perm-1',
      requestId: 'req-1',
      title: 'Edit file'
    });
    await Promise.resolve();

    expect(lastSentMessage(socket)).toEqual(
      expect.objectContaining({
        type: 'permission_request',
        action: 'edit_file',
        clientId: 'workspace-1',
        permissionId: 'perm-1',
        requestId: 'req-1',
        title: 'Edit file'
      })
    );

    socket.emit(
      'message',
      Buffer.from(
        encode({
          type: 'permission_response',
          approved: true,
          clientId: 'workspace-1',
          permissionId: 'perm-1',
          requestId: 'req-1'
        })
      )
    );

    await expect(permissionPromise).resolves.toEqual(
      expect.objectContaining({ approved: true })
    );

    await client.sendStream({
      type: 'copilot_stream',
      clientId: 'workspace-1',
      requestId: 'req-1',
      done: true
    });
    expect(lastSentMessage(socket)).toEqual(
      expect.objectContaining({
        type: 'copilot_stream',
        clientId: 'workspace-1',
        requestId: 'req-1',
        done: true
      })
    );
  });

  it('dispatches prompt, cancel, and status listeners', async () => {
    const client = new VscodeRelayClient({
      clientId: 'workspace-1',
      outputChannel,
      sharedSecret: 'secret',
      url: 'ws://relay.test'
    });
    const onPrompt = vi.fn();
    const onCancel = vi.fn();
    const onStatus = vi.fn();
    client.onPrompt(onPrompt);
    client.onCancel(onCancel);
    client.onStatus(onStatus);

    const connecting = client.connect();
    const socket = latestSocket();
    socket.readyState = 1;
    socket.emit('open');
    socket.emit(
      'message',
      Buffer.from(
        encode({
          type: 'register_ack',
          clientRole: 'vscode',
          clientId: 'workspace-1',
          connectionId: 'conn-1'
        })
      )
    );
    await connecting;

    socket.emit(
      'message',
      Buffer.from(
        encode({
          type: 'copilot_prompt',
          clientId: 'workspace-1',
          requestId: 'req-1',
          mode: 'ask',
          prompt: 'Hello'
        })
      )
    );
    socket.emit(
      'message',
      Buffer.from(
        encode({
          type: 'copilot_cancel',
          clientId: 'workspace-1',
          requestId: 'req-1'
        })
      )
    );
    socket.emit(
      'message',
      Buffer.from(
        encode({
          type: 'relay_status',
          code: 'request_failed',
          level: 'warning',
          message: 'Warn'
        })
      )
    );

    expect(onPrompt).toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
    expect(onStatus).toHaveBeenCalled();
  });

  it('rejects pending permissions and reconnects after disconnects', async () => {
    const client = new VscodeRelayClient({
      clientId: 'workspace-1',
      outputChannel,
      reconnectDelayMs: 10,
      sharedSecret: 'secret',
      url: 'ws://relay.test'
    });
    const onConnectionProblem = vi.fn();
    client.onConnectionProblem(onConnectionProblem);

    const connecting = client.connect();
    const socket = latestSocket();
    socket.readyState = 1;
    socket.emit('open');
    socket.emit(
      'message',
      Buffer.from(
        encode({
          type: 'register_ack',
          clientRole: 'vscode',
          clientId: 'workspace-1',
          connectionId: 'conn-1'
        })
      )
    );
    await connecting;

    const permissionPromise = client.requestPermission(
      {
        type: 'permission_request',
        action: 'edit_file',
        clientId: 'workspace-1',
        permissionId: 'perm-1',
        requestId: 'req-1',
        title: 'Edit file'
      },
      1000
    );
    await Promise.resolve();

    client.rejectPendingPermissionRequests('req-1', 'cancelled');
    await expect(permissionPromise).rejects.toThrow('cancelled');

    socket.emit('error', new Error('boom'));
    await vi.runOnlyPendingTimersAsync();

    expect(onConnectionProblem).toHaveBeenCalled();
    expect(client.isReady).toBe(false);
  });

  it('logs malformed messages and disconnects cleanly', async () => {
    const client = new VscodeRelayClient({
      clientId: 'workspace-1',
      outputChannel,
      sharedSecret: 'secret',
      url: 'ws://relay.test'
    });

    const connecting = client.connect();
    const socket = latestSocket();
    socket.readyState = 1;
    socket.emit('open');
    socket.emit(
      'message',
      Buffer.from(
        encode({
          type: 'register_ack',
          clientRole: 'vscode',
          clientId: 'workspace-1',
          connectionId: 'conn-1'
        })
      )
    );
    await connecting;

    socket.emit('message', Buffer.from('{not-json'));
    expect(outputChannel.appendLine).toHaveBeenCalledWith(
      expect.stringContaining('Ignoring malformed relay payload')
    );

    await client.disconnect();
    expect(socket.close).toHaveBeenCalled();
  });
});
