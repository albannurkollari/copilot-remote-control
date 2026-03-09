import {
  parseRelayMessage,
  serializeRelayMessage,
  type CopilotPromptMessage,
  type CopilotStreamMessage,
  type PermissionRequestMessage,
  type PermissionResponseMessage,
  type RegisterAckMessage,
  type RelayStatusMessage
} from '@remote-copilot/shared';
import { EventEmitter } from 'node:events';
import { WebSocket } from 'ws';

export interface RelayDiscordClientOptions {
  clientId: string;
  reconnectDelayMs?: number;
  relayUrl: string;
  sharedSecret?: string;
}

export interface PromptRequestHandlers {
  onPermissionRequest?: (
    message: PermissionRequestMessage
  ) => void | Promise<void>;
  onStatus?: (message: RelayStatusMessage) => void | Promise<void>;
  onStream?: (message: CopilotStreamMessage) => void | Promise<void>;
}

interface PendingPromptRequest extends PromptRequestHandlers {
  reject: (error: Error) => void;
  resolve: () => void;
}

type RelayClientEvents = {
  connected: [];
  disconnected: [];
  status: [RelayStatusMessage];
};

export class RelayDiscordClient extends EventEmitter<RelayClientEvents> {
  readonly clientId: string;
  readonly reconnectDelayMs: number;
  readonly relayUrl: string;
  readonly sharedSecret?: string;

  #connectPromise?: Promise<void>;
  #isStopping = false;
  #pendingRequests = new Map<string, PendingPromptRequest>();
  #reconnectTimer?: NodeJS.Timeout;
  #registerAck?: RegisterAckMessage;
  #socket?: WebSocket;

  constructor(options: RelayDiscordClientOptions) {
    super();
    this.clientId = options.clientId;
    this.reconnectDelayMs = options.reconnectDelayMs ?? 2_000;
    this.relayUrl = options.relayUrl;
    this.sharedSecret = options.sharedSecret;
  }

  get isConnected() {
    return (
      this.#socket?.readyState === WebSocket.OPEN &&
      this.#registerAck !== undefined
    );
  }

  async connect() {
    if (this.isConnected) {
      return;
    }

    if (this.#connectPromise) {
      return this.#connectPromise;
    }

    this.#isStopping = false;
    this.#connectPromise = new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(this.relayUrl);
      let settled = false;

      const fail = (error: Error) => {
        if (settled) {
          return;
        }

        settled = true;
        this.#connectPromise = undefined;
        reject(error);
      };

      const succeed = (ack: RegisterAckMessage) => {
        if (settled) {
          return;
        }

        settled = true;
        this.#registerAck = ack;
        this.#connectPromise = undefined;
        this.emit('connected');
        resolve();
      };

      socket.once('open', () => {
        this.#socket = socket;
        socket.send(
          serializeRelayMessage({
            type: 'register',
            clientId: this.clientId,
            clientRole: 'discord',
            ...(this.sharedSecret ? { sharedSecret: this.sharedSecret } : {})
          })
        );
      });

      socket.on('message', (data) => {
        void this.#handleMessage(data.toString(), {
          onRegisterAck: succeed
        });
      });

      socket.once('close', () => {
        this.#handleDisconnect();
        if (!settled) {
          fail(
            new Error('Relay connection closed before registration completed.')
          );
        }
      });

      socket.once('error', (error) => {
        this.#handleDisconnect();
        if (!settled) {
          fail(error instanceof Error ? error : new Error(String(error)));
        }
      });
    });

    return this.#connectPromise;
  }

  async disconnect() {
    this.#isStopping = true;
    this.#registerAck = undefined;
    this.#connectPromise = undefined;

    if (this.#reconnectTimer) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = undefined;
    }

    if (this.#socket) {
      for (const pending of this.#pendingRequests.values()) {
        pending.reject(new Error('Relay connection was closed.'));
      }
      this.#pendingRequests.clear();
      this.#socket.close();
      this.#socket = undefined;
    }
  }

  async sendPrompt(
    message: CopilotPromptMessage,
    handlers: PromptRequestHandlers = {}
  ) {
    await this.connect();

    if (!this.#socket || this.#socket.readyState !== WebSocket.OPEN) {
      throw new Error('Relay connection is not available.');
    }

    return await new Promise<void>((resolve, reject) => {
      this.#pendingRequests.set(message.requestId, {
        ...handlers,
        reject,
        resolve
      });
      this.#socket?.send(serializeRelayMessage(message));
    });
  }

  respondToPermissionRequest(
    message: PermissionRequestMessage,
    approved: boolean,
    reason?: string
  ) {
    if (!this.#socket || this.#socket.readyState !== WebSocket.OPEN) {
      throw new Error('Relay connection is not available.');
    }

    const response: PermissionResponseMessage = {
      type: 'permission_response',
      clientId: message.clientId,
      requestId: message.requestId,
      permissionId: message.permissionId,
      approved,
      reason
    };

    this.#socket.send(serializeRelayMessage(response));
  }

  async #handleMessage(
    raw: string,
    options: { onRegisterAck?: (ack: RegisterAckMessage) => void } = {}
  ) {
    const parsed = parseRelayMessage(raw);
    if (!parsed.ok) {
      throw new Error(parsed.error);
    }

    const message = parsed.value;
    if (message.type === 'register_ack') {
      options.onRegisterAck?.(message);
      return;
    }

    if (message.type === 'relay_status') {
      this.emit('status', message);
      const pending = message.requestId
        ? this.#pendingRequests.get(message.requestId)
        : undefined;
      await pending?.onStatus?.(message);

      if (message.level === 'error' && message.requestId && pending) {
        this.#pendingRequests.delete(message.requestId);
        pending.reject(new Error(message.message));
      }

      return;
    }

    if ('requestId' in message) {
      const pending = this.#pendingRequests.get(message.requestId);
      if (!pending) {
        return;
      }

      if (message.type === 'copilot_stream') {
        await pending.onStream?.(message);
        if (message.done) {
          this.#pendingRequests.delete(message.requestId);
          if (message.error) {
            pending.reject(new Error(message.error));
          } else {
            pending.resolve();
          }
        }
        return;
      }

      if (message.type === 'permission_request') {
        await pending.onPermissionRequest?.(message);
      }
    }
  }

  #handleDisconnect() {
    this.#registerAck = undefined;
    this.#connectPromise = undefined;
    this.#socket = undefined;
    this.emit('disconnected');

    for (const [requestId, pending] of this.#pendingRequests.entries()) {
      this.#pendingRequests.delete(requestId);
      pending.reject(new Error('Relay connection was interrupted.'));
    }

    if (this.#isStopping) {
      return;
    }

    if (this.#reconnectTimer) {
      clearTimeout(this.#reconnectTimer);
    }

    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = undefined;
      void this.connect().catch(() => undefined);
    }, this.reconnectDelayMs);
  }
}
