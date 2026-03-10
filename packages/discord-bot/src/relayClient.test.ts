import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sockets = vi.hoisted(() => [] as any[]);
const encode = (message: unknown) => JSON.stringify(message);

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

    once(event: string, listener: (...args: any[]) => void) {
      const onceListener = (...args: any[]) => {
        this.off(event, onceListener);
        listener(...args);
      };
      return this.on(event, onceListener);
    }

    off(event: string, listener: (...args: any[]) => void) {
      const listeners = (this.#listeners.get(event) ?? []).filter(
        (candidate) => candidate !== listener
      );
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

  return { WebSocket: MockWebSocket };
});

import { RelayDiscordClient } from './relayClient.ts';

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

describe('RelayDiscordClient', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    sockets.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('connects, registers, and emits connected', async () => {
    const client = new RelayDiscordClient({
      clientId: 'discord-bot',
      relayUrl: 'ws://relay.test',
      sharedSecret: 'secret'
    });
    const onConnected = vi.fn();
    client.on('connected', onConnected);

    const connecting = client.connect();
    const socket = latestSocket();
    socket.readyState = 1;
    socket.emit('open');
    expect(socket.send).toHaveBeenCalledWith(
      encode({
        type: 'register',
        clientId: 'discord-bot',
        clientRole: 'discord',
        sharedSecret: 'secret'
      })
    );

    socket.emit(
      'message',
      Buffer.from(
        encode({
          type: 'register_ack',
          clientRole: 'discord',
          clientId: 'discord-bot',
          connectionId: 'conn-1'
        })
      )
    );
    await connecting;

    expect(client.isConnected).toBe(true);
    expect(onConnected).toHaveBeenCalled();
  });

  it('sends prompts, handles stream completions, and permission requests', async () => {
    const client = new RelayDiscordClient({
      clientId: 'discord-bot',
      relayUrl: 'ws://relay.test'
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
          clientRole: 'discord',
          clientId: 'discord-bot',
          connectionId: 'conn-1'
        })
      )
    );
    await connecting;

    const onPermissionRequest = vi.fn();
    const onStatus = vi.fn();
    const onStream = vi.fn();
    const promptPromise = client.sendPrompt(
      {
        type: 'copilot_prompt',
        clientId: 'workspace-1',
        requestId: 'req-1',
        mode: 'ask',
        prompt: 'Explain'
      },
      { onPermissionRequest, onStatus, onStream }
    );
    await Promise.resolve();

    expect(lastSentMessage(socket)).toEqual(
      expect.objectContaining({
        type: 'copilot_prompt',
        clientId: 'workspace-1',
        requestId: 'req-1',
        mode: 'ask',
        prompt: 'Explain'
      })
    );

    socket.emit(
      'message',
      Buffer.from(
        encode({
          type: 'permission_request',
          action: 'edit_file',
          clientId: 'workspace-1',
          permissionId: 'perm-1',
          requestId: 'req-1',
          title: 'Edit file'
        })
      )
    );
    socket.emit(
      'message',
      Buffer.from(
        encode({
          type: 'relay_status',
          code: 'client_connected',
          level: 'warning',
          message: 'warn',
          requestId: 'req-1'
        })
      )
    );
    socket.emit(
      'message',
      Buffer.from(
        encode({
          type: 'copilot_stream',
          clientId: 'workspace-1',
          requestId: 'req-1',
          delta: 'Hello',
          done: false
        })
      )
    );
    socket.emit(
      'message',
      Buffer.from(
        encode({
          type: 'copilot_stream',
          clientId: 'workspace-1',
          requestId: 'req-1',
          done: true
        })
      )
    );

    await expect(promptPromise).resolves.toBeUndefined();
    expect(onPermissionRequest).toHaveBeenCalled();
    expect(onStatus).toHaveBeenCalled();
    expect(onStream).toHaveBeenCalled();
  });

  it('cancels active prompts and responds to permission requests', async () => {
    const client = new RelayDiscordClient({
      clientId: 'discord-bot',
      relayUrl: 'ws://relay.test'
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
          clientRole: 'discord',
          clientId: 'discord-bot',
          connectionId: 'conn-1'
        })
      )
    );
    await connecting;

    const promptPromise = client.sendPrompt({
      type: 'copilot_prompt',
      clientId: 'workspace-1',
      requestId: 'req-1',
      mode: 'ask',
      prompt: 'Explain'
    });
    await Promise.resolve();

    await expect(client.cancelPrompt('req-1')).resolves.toBe(true);
    expect(lastSentMessage(socket)).toEqual(
      expect.objectContaining({
        type: 'copilot_cancel',
        clientId: 'workspace-1',
        requestId: 'req-1'
      })
    );
    await expect(client.cancelPrompt('missing')).resolves.toBe(false);

    client.respondToPermissionRequest(
      {
        type: 'permission_request',
        action: 'edit_file',
        clientId: 'workspace-1',
        permissionId: 'perm-1',
        requestId: 'req-1',
        title: 'Edit file'
      },
      false,
      'Denied'
    );
    expect(lastSentMessage(socket)).toEqual(
      expect.objectContaining({
        type: 'permission_response',
        approved: false,
        clientId: 'workspace-1',
        permissionId: 'perm-1',
        reason: 'Denied',
        requestId: 'req-1'
      })
    );

    socket.emit(
      'message',
      Buffer.from(
        encode({
          type: 'copilot_stream',
          clientId: 'workspace-1',
          requestId: 'req-1',
          done: true,
          error: 'Stopped'
        })
      )
    );
    await expect(promptPromise).rejects.toThrow('Stopped');
  });

  it('rejects pending prompts on relay errors and reconnects after disconnects', async () => {
    const client = new RelayDiscordClient({
      clientId: 'discord-bot',
      reconnectDelayMs: 10,
      relayUrl: 'ws://relay.test'
    });
    const onDisconnected = vi.fn();
    client.on('disconnected', onDisconnected);

    const connecting = client.connect();
    const socket = latestSocket();
    socket.readyState = 1;
    socket.emit('open');
    socket.emit(
      'message',
      Buffer.from(
        encode({
          type: 'register_ack',
          clientRole: 'discord',
          clientId: 'discord-bot',
          connectionId: 'conn-1'
        })
      )
    );
    await connecting;

    const promptPromise = client.sendPrompt({
      type: 'copilot_prompt',
      clientId: 'workspace-1',
      requestId: 'req-1',
      mode: 'plan',
      prompt: 'Plan'
    });
    await Promise.resolve();

    socket.emit(
      'message',
      Buffer.from(
        encode({
          type: 'relay_status',
          code: 'request_failed',
          level: 'error',
          message: 'Failed',
          requestId: 'req-1'
        })
      )
    );
    await expect(promptPromise).rejects.toThrow('Failed');

    socket.emit('close');
    await vi.runOnlyPendingTimersAsync();
    expect(onDisconnected).toHaveBeenCalled();
    expect(sockets.length).toBeGreaterThan(1);
  });

  it('disconnects pending requests cleanly', async () => {
    const client = new RelayDiscordClient({
      clientId: 'discord-bot',
      relayUrl: 'ws://relay.test'
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
          clientRole: 'discord',
          clientId: 'discord-bot',
          connectionId: 'conn-1'
        })
      )
    );
    await connecting;

    const promptPromise = client.sendPrompt({
      type: 'copilot_prompt',
      clientId: 'workspace-1',
      requestId: 'req-1',
      mode: 'ask',
      prompt: 'Explain'
    });
    await Promise.resolve();

    socket.emit('close');
    await expect(promptPromise).rejects.toThrow(
      'Relay connection was interrupted.'
    );

    await client.disconnect();
  });
});
