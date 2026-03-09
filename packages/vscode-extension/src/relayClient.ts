import {
  parseRelayMessage,
  serializeRelayMessage,
  type CopilotPromptMessage,
  type CopilotStreamMessage,
  type PermissionRequestMessage,
  type PermissionResponseMessage,
  type RelayStatusMessage
} from '@remote-copilot/shared';
import { setTimeout as delay } from 'node:timers/promises';
import * as vscode from 'vscode';
import WebSocket from 'ws';

export interface VscodeRelayClientOptions {
  clientId: string;
  outputChannel: vscode.OutputChannel;
  reconnectDelayMs?: number;
  url: string;
}

type PromptListener = (message: CopilotPromptMessage) => void | Promise<void>;
type StatusListener = (message: RelayStatusMessage) => void | Promise<void>;

interface PendingPermissionResponse {
  reject: (error: Error) => void;
  resolve: (message: PermissionResponseMessage) => void;
}

const DEFAULT_READY_TIMEOUT_MS = 10_000;

export class VscodeRelayClient implements vscode.Disposable {
  readonly clientId: string;
  readonly url: string;

  #outputChannel: vscode.OutputChannel;
  #promptListeners = new Set<PromptListener>();
  #statusListeners = new Set<StatusListener>();
  #permissionResponses = new Map<string, PendingPermissionResponse>();
  #readyPromise: Promise<void> | null = null;
  #reconnectDelayMs: number;
  #reconnectTimer?: NodeJS.Timeout;
  #resolveReady?: () => void;
  #socket?: WebSocket;
  #shouldReconnect = true;
  #isReady = false;

  constructor(options: VscodeRelayClientOptions) {
    this.clientId = options.clientId;
    this.url = options.url;
    this.#outputChannel = options.outputChannel;
    this.#reconnectDelayMs = options.reconnectDelayMs ?? 1_500;
  }

  get isReady() {
    return this.#isReady;
  }

  async connect() {
    this.#shouldReconnect = true;

    if (
      this.#socket &&
      (this.#socket.readyState === WebSocket.OPEN ||
        this.#socket.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    this.#readyPromise = new Promise<void>((resolve) => {
      this.#resolveReady = resolve;
    });

    const socket = new WebSocket(this.url);
    this.#socket = socket;

    socket.on('open', () => {
      this.#log(
        `Connected to relay ${this.url}. Registering as ${this.clientId}.`
      );
      this.#sendRaw({
        type: 'register',
        clientRole: 'vscode',
        clientId: this.clientId
      });
    });

    socket.on('message', (data) => {
      void this.#handleMessage(data.toString());
    });

    socket.on('close', () => {
      this.#handleDisconnect();
    });

    socket.on('error', (error) => {
      this.#log(`Relay socket error: ${error.message}`);
      this.#handleDisconnect();
    });

    await this.waitForReady();
  }

  async reconnect() {
    await this.disconnect();
    await this.connect();
  }

  async waitForReady(timeoutMs = DEFAULT_READY_TIMEOUT_MS) {
    if (this.#isReady) {
      return;
    }

    if (!this.#readyPromise) {
      throw new Error('Relay client has not started connecting yet.');
    }

    await Promise.race([
      this.#readyPromise,
      delay(timeoutMs).then(() => {
        throw new Error(
          `Timed out waiting for relay readiness after ${timeoutMs}ms.`
        );
      })
    ]);
  }

  onPrompt(listener: PromptListener) {
    this.#promptListeners.add(listener);
    return () => {
      this.#promptListeners.delete(listener);
    };
  }

  onStatus(listener: StatusListener) {
    this.#statusListeners.add(listener);
    return () => {
      this.#statusListeners.delete(listener);
    };
  }

  async sendStream(message: CopilotStreamMessage) {
    await this.waitForReady();
    this.#sendRaw(message);
  }

  async requestPermission(
    message: PermissionRequestMessage,
    timeoutMs = 120_000
  ) {
    await this.waitForReady();

    const key = `${message.requestId}:${message.permissionId}`;
    const responsePromise = new Promise<PermissionResponseMessage>(
      (resolve, reject) => {
        this.#permissionResponses.set(key, { resolve, reject });
      }
    );

    this.#sendRaw(message);

    return Promise.race([
      responsePromise,
      delay(timeoutMs).then(() => {
        this.#permissionResponses.delete(key);
        throw new Error(
          `Timed out waiting for permission response after ${timeoutMs}ms.`
        );
      })
    ]);
  }

  async disconnect() {
    this.#shouldReconnect = false;

    if (this.#reconnectTimer) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = undefined;
    }

    for (const pending of this.#permissionResponses.values()) {
      pending.reject(
        new Error(
          'Relay connection closed before a permission response arrived.'
        )
      );
    }
    this.#permissionResponses.clear();

    if (this.#socket && this.#socket.readyState === WebSocket.OPEN) {
      this.#socket.close();
    }
  }

  dispose() {
    void this.disconnect();
  }

  #sendRaw(
    message:
      | CopilotStreamMessage
      | PermissionRequestMessage
      | { type: 'register'; clientRole: 'vscode'; clientId: string }
  ) {
    if (!this.#socket || this.#socket.readyState !== WebSocket.OPEN) {
      throw new Error('Relay connection is not open.');
    }

    this.#socket.send(serializeRelayMessage(message));
  }

  async #handleMessage(raw: string) {
    const parsed = parseRelayMessage(raw);
    if (!parsed.ok) {
      this.#log(`Ignoring malformed relay payload: ${parsed.error}`);
      return;
    }

    switch (parsed.value.type) {
      case 'register_ack':
        this.#isReady = true;
        this.#resolveReady?.();
        this.#log(
          `Relay registration acknowledged with connection ${parsed.value.connectionId}.`
        );
        return;

      case 'copilot_prompt':
        for (const listener of this.#promptListeners) {
          await listener(parsed.value);
        }
        return;

      case 'permission_response': {
        const key = `${parsed.value.requestId}:${parsed.value.permissionId}`;
        const pending = this.#permissionResponses.get(key);
        if (pending) {
          this.#permissionResponses.delete(key);
          pending.resolve(parsed.value);
        }
        return;
      }

      case 'relay_status':
        for (const listener of this.#statusListeners) {
          await listener(parsed.value);
        }
        return;

      default:
        return;
    }
  }

  #handleDisconnect() {
    this.#isReady = false;

    if (!this.#shouldReconnect || this.#reconnectTimer) {
      return;
    }

    this.#readyPromise = new Promise<void>((resolve) => {
      this.#resolveReady = resolve;
    });

    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = undefined;
      void this.connect().catch((error) => {
        this.#log(
          `Relay reconnect failed: ${error instanceof Error ? error.message : String(error)}`
        );
        this.#handleDisconnect();
      });
    }, this.#reconnectDelayMs);
  }

  #log(message: string) {
    this.#outputChannel.appendLine(`[relay] ${message}`);
  }
}
