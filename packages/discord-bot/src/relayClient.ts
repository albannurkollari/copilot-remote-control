import { setTimeout as delay } from 'node:timers/promises';

import {
	parseRelayMessage,
	serializeRelayMessage,
	type CopilotPromptMessage,
	type CopilotStreamMessage,
	type PermissionRequestMessage,
	type PermissionResponseMessage,
	type RelayStatusMessage,
	type RegisterAckMessage
} from '@remote-copilot/shared';
import WebSocket from 'ws';

export interface DiscordRelayClientOptions {
	clientId: string;
	reconnectDelayMs?: number;
	url: string;
}

export interface RelayRequestHandlers {
	onPermissionRequest?: (message: PermissionRequestMessage) => void | Promise<void>;
	onStatus?: (message: RelayStatusMessage) => void | Promise<void>;
	onStream?: (message: CopilotStreamMessage) => void | Promise<void>;
}

interface PendingRequest {
	handlers: RelayRequestHandlers;
}

const DEFAULT_RECONNECT_DELAY_MS = 1_500;
const DEFAULT_READY_TIMEOUT_MS = 10_000;

export class DiscordRelayClient {
	readonly clientId: string;
	readonly url: string;

	#reconnectDelayMs: number;
	#socket?: WebSocket;
	#pendingRequests = new Map<string, PendingRequest>();
	#statusListeners = new Set<(message: RelayStatusMessage) => void | Promise<void>>();
	#readyPromise: Promise<void> | null = null;
	#resolveReady?: () => void;
	#shouldReconnect = true;
	#reconnectTimer?: NodeJS.Timeout;
	#isReady = false;

	constructor(options: DiscordRelayClientOptions) {
		this.clientId = options.clientId;
		this.url = options.url;
		this.#reconnectDelayMs = options.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS;
	}

	get isReady() {
		return this.#isReady;
	}

	async connect() {
		this.#shouldReconnect = true;

		if (this.#socket && (this.#socket.readyState === WebSocket.OPEN || this.#socket.readyState === WebSocket.CONNECTING)) {
			return;
		}

		this.#readyPromise = new Promise<void>((resolve) => {
			this.#resolveReady = resolve;
		});

		const socket = new WebSocket(this.url);
		this.#socket = socket;

		socket.on('open', () => {
			this.#sendRaw({
				type: 'register',
				clientId: this.clientId,
				clientRole: 'discord'
			});
		});

		socket.on('message', (data) => {
			void this.#handleMessage(data.toString());
		});

		socket.on('close', () => {
			this.#handleDisconnect();
		});

		socket.on('error', () => {
			this.#handleDisconnect();
		});

		await this.waitForReady();
	}

	async disconnect() {
		this.#shouldReconnect = false;
		if (this.#reconnectTimer) {
			clearTimeout(this.#reconnectTimer);
			this.#reconnectTimer = undefined;
		}

		this.#rejectPendingRequests('Relay connection closed.');

		if (this.#socket && this.#socket.readyState === WebSocket.OPEN) {
			this.#socket.close();
		}
	}

	async waitForReady(timeoutMs = DEFAULT_READY_TIMEOUT_MS) {
		if (this.#isReady) {
			return;
		}

		if (!this.#readyPromise) {
			throw new Error('Relay client is not connecting.');
		}

		await Promise.race([
			this.#readyPromise,
			delay(timeoutMs).then(() => {
				throw new Error(`Timed out waiting for relay readiness after ${timeoutMs}ms.`);
			})
		]);
	}

	onStatus(listener: (message: RelayStatusMessage) => void | Promise<void>) {
		this.#statusListeners.add(listener);

		return () => {
			this.#statusListeners.delete(listener);
		};
	}

	async sendPrompt(message: CopilotPromptMessage, handlers: RelayRequestHandlers = {}) {
		await this.waitForReady();
		this.#pendingRequests.set(message.requestId, { handlers });
		this.#sendRaw(message);
	}

	sendPermissionResponse(message: PermissionResponseMessage) {
		this.#sendRaw(message);
	}

	#sendRaw(message: RegisterAckMessage | CopilotPromptMessage | PermissionResponseMessage | { type: 'register'; clientId: string; clientRole: 'discord' }) {
		if (!this.#socket || this.#socket.readyState !== WebSocket.OPEN) {
			throw new Error('Relay connection is not open.');
		}

		this.#socket.send(serializeRelayMessage(message));
	}

	async #handleMessage(raw: string) {
		const parsed = parseRelayMessage(raw);
		if (!parsed.ok) {
			return;
		}

		switch (parsed.value.type) {
			case 'register_ack':
				this.#isReady = true;
				this.#resolveReady?.();
				return;

			case 'copilot_stream': {
				const request = this.#pendingRequests.get(parsed.value.requestId);
				await request?.handlers.onStream?.(parsed.value);

				if (parsed.value.done) {
					this.#pendingRequests.delete(parsed.value.requestId);
				}

				return;
			}

			case 'permission_request': {
				const request = this.#pendingRequests.get(parsed.value.requestId);
				await request?.handlers.onPermissionRequest?.(parsed.value);
				return;
			}

			case 'relay_status': {
				if (parsed.value.requestId) {
					const request = this.#pendingRequests.get(parsed.value.requestId);
					await request?.handlers.onStatus?.(parsed.value);

					if (parsed.value.level === 'error') {
						this.#pendingRequests.delete(parsed.value.requestId);
					}
				}

				for (const listener of this.#statusListeners) {
					await listener(parsed.value);
				}

				return;
			}

			default:
				return;
		}
	}

	#handleDisconnect() {
		this.#isReady = false;
		this.#rejectPendingRequests('Relay connection lost while awaiting a Copilot response.');

		if (!this.#shouldReconnect || this.#reconnectTimer) {
			return;
		}

		this.#readyPromise = new Promise<void>((resolve) => {
			this.#resolveReady = resolve;
		});

		this.#reconnectTimer = setTimeout(() => {
			this.#reconnectTimer = undefined;
			void this.connect().catch(() => {
				void this.#scheduleReconnect();
			});
		}, this.#reconnectDelayMs);
	}

	async #scheduleReconnect() {
		if (!this.#shouldReconnect || this.#reconnectTimer) {
			return;
		}

		this.#reconnectTimer = setTimeout(() => {
			this.#reconnectTimer = undefined;
			void this.connect().catch(() => {
				void this.#scheduleReconnect();
			});
		}, this.#reconnectDelayMs);
	}

	#rejectPendingRequests(message: string) {
		const pendingRequests = [...this.#pendingRequests.entries()];
		this.#pendingRequests.clear();

		for (const [requestId, request] of pendingRequests) {
			void request.handlers.onStatus?.({
				type: 'relay_status',
				level: 'error',
				code: 'target_not_connected',
				message,
				requestId
			});
		}
	}
}
