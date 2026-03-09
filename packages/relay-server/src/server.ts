import {
  createPongMessage,
  parseRelayMessage,
  serializeRelayMessage,
  type ClientRole,
  type CopilotPromptMessage,
  type CopilotStreamMessage,
  type PermissionRequestMessage,
  type PermissionResponseMessage,
  type RegisterMessage,
  type RelayMessage,
  type RelayStatusCode,
  type RelayStatusLevel
} from '@remote-copilot/shared';
import { randomUUID } from 'node:crypto';
import { createServer, type Server as HttpServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import pc from 'picocolors';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';

export interface RelayServerOptions {
  host?: string;
  path?: string;
  port?: number;
  verbose?: boolean;
}

interface RegisteredClient {
  clientId: string;
  connectionId: string;
  role: ClientRole;
  socket: WebSocket;
}

interface PendingRequest {
  discordConnectionId: string;
  discordSocket: WebSocket;
  hasLoggedReply: boolean;
  replyText: string;
  targetClientId: string;
}

const DEFAULT_PORT = 8787;
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PATH = '/';

export class RelayServer {
  readonly host: string;
  readonly path: string;
  readonly port: number;
  readonly verbose: boolean;

  #httpServer?: HttpServer;
  #started = false;
  #wss?: WebSocketServer;
  #clients = {
    discord: new Map<string, RegisteredClient>(),
    vscode: new Map<string, RegisteredClient>()
  };
  #requests = new Map<string, PendingRequest>();
  #connections = new WeakMap<WebSocket, RegisteredClient>();

  constructor(options: RelayServerOptions = {}) {
    this.host = options.host ?? DEFAULT_HOST;
    this.path = options.path ?? DEFAULT_PATH;
    this.port = options.port ?? DEFAULT_PORT;
    this.verbose = options.verbose ?? false;
  }

  get address() {
    return `ws://${this.host}:${this.port}${this.path}`;
  }

  #log(message: string) {
    process.stdout.write(`${message}\n`);
  }

  #logDiscordPrompt(message: CopilotPromptMessage) {
    const source = pc.cyan('Discord');
    const arrow = pc.dim('→');
    const target = pc.magenta(`Copilot(${message.clientId})`);
    const mode = pc.yellow(`[${message.mode}]`);
    const author = pc.dim(message.userDisplayName ?? 'unknown');

    this.#log(
      `${source} ${arrow} ${target} ${mode} ${author}: ${message.prompt}`
    );
  }

  #logCopilotReply(message: CopilotStreamMessage, content = 'Replies') {
    const source = pc.magenta('Copilot');
    const arrow = pc.dim('→');
    const target = pc.cyan(`Discord(${message.clientId})`);
    this.#log(`${source} ${arrow} ${target}: ${pc.green(content)}`);
  }

  async start() {
    if (this.#started) {
      return;
    }

    this.#httpServer = createServer();
    this.#wss = new WebSocketServer({
      path: this.path,
      server: this.#httpServer
    });

    this.#wss.on('connection', (socket) => {
      this.#handleConnection(socket);
    });

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        reject(error);
      };

      this.#httpServer?.once('error', onError);
      this.#httpServer?.listen(this.port, this.host, () => {
        this.#httpServer?.off('error', onError);
        resolve();
      });
    });

    this.#started = true;
  }

  async stop() {
    if (!this.#started) {
      return;
    }

    for (const client of this.#getAllClients()) {
      client.socket.close();
    }

    await new Promise<void>((resolve, reject) => {
      this.#wss?.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });

    await new Promise<void>((resolve, reject) => {
      this.#httpServer?.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });

    this.#requests.clear();
    this.#clients.discord.clear();
    this.#clients.vscode.clear();
    this.#started = false;
  }

  #getAllClients() {
    return [
      ...this.#clients.discord.values(),
      ...this.#clients.vscode.values()
    ];
  }

  #handleConnection(socket: WebSocket) {
    socket.on('message', (data) => {
      this.#handleSocketMessage(socket, data);
    });

    socket.on('close', () => {
      this.#handleSocketClose(socket);
    });

    socket.on('error', () => {
      this.#handleSocketClose(socket);
    });
  }

  #handleSocketMessage(socket: WebSocket, data: RawData) {
    const text = data.toString();
    const parsed = parseRelayMessage(text);

    if (!parsed.ok) {
      this.#sendStatus(socket, 'error', 'malformed_message', parsed.error);
      return;
    }

    const registeredClient = this.#connections.get(socket);

    if (parsed.value.type === 'register') {
      this.#registerClient(socket, parsed.value);
      return;
    }

    if (!registeredClient) {
      this.#sendStatus(
        socket,
        'error',
        'unsupported_message',
        'Clients must register before sending messages.'
      );
      socket.close();
      return;
    }

    switch (parsed.value.type) {
      case 'ping':
        this.#send(socket, createPongMessage());
        return;

      case 'copilot_prompt':
        this.#handlePrompt(registeredClient, parsed.value);
        return;

      case 'copilot_stream':
        this.#handleStream(registeredClient, parsed.value);
        return;

      case 'permission_request':
        this.#handlePermissionRequest(registeredClient, parsed.value);
        return;

      case 'permission_response':
        this.#handlePermissionResponse(registeredClient, parsed.value);
        return;

      case 'register_ack':
      case 'relay_status':
      case 'pong':
        this.#sendStatus(
          socket,
          'error',
          'unsupported_message',
          `Message type ${parsed.value.type} is server-managed.`
        );
        return;
    }
  }

  #registerClient(socket: WebSocket, message: RegisterMessage) {
    const connectionId = randomUUID();
    const nextClient: RegisteredClient = {
      clientId: message.clientId,
      connectionId,
      role: message.clientRole,
      socket
    };

    const existingClient = this.#clients[message.clientRole].get(
      message.clientId
    );
    if (existingClient && existingClient.socket !== socket) {
      this.#sendStatus(
        existingClient.socket,
        'warning',
        'client_disconnected',
        `Connection replaced by a newer ${message.clientRole} client.`,
        { clientId: message.clientId, targetClientRole: message.clientRole }
      );
      existingClient.socket.close();
    }

    this.#clients[message.clientRole].set(message.clientId, nextClient);
    this.#connections.set(socket, nextClient);

    this.#send(socket, {
      type: 'register_ack',
      clientRole: message.clientRole,
      clientId: message.clientId,
      connectionId
    });

    this.#broadcastStatus(
      'info',
      'client_connected',
      `${message.clientRole} client ${message.clientId} connected.`,
      { clientId: message.clientId, targetClientRole: message.clientRole }
    );
  }

  #handlePrompt(client: RegisteredClient, message: CopilotPromptMessage) {
    if (client.role !== 'discord') {
      this.#sendStatus(
        client.socket,
        'error',
        'unsupported_message',
        'Only discord clients can send copilot prompts.',
        { requestId: message.requestId, clientId: message.clientId }
      );
      return;
    }

    const vscodeClient = this.#clients.vscode.get(message.clientId);
    if (!vscodeClient) {
      this.#sendStatus(
        client.socket,
        'error',
        'target_not_connected',
        `No VS Code client is connected for ${message.clientId}.`,
        {
          requestId: message.requestId,
          clientId: message.clientId,
          targetClientRole: 'vscode'
        }
      );
      return;
    }

    this.#requests.set(message.requestId, {
      discordConnectionId: client.connectionId,
      discordSocket: client.socket,
      hasLoggedReply: false,
      replyText: '',
      targetClientId: message.clientId
    });

    this.#logDiscordPrompt(message);

    this.#send(vscodeClient.socket, message);
  }

  #handleStream(client: RegisteredClient, message: CopilotStreamMessage) {
    if (client.role !== 'vscode') {
      this.#sendStatus(
        client.socket,
        'error',
        'unsupported_message',
        'Only VS Code clients can send copilot stream messages.',
        { requestId: message.requestId, clientId: message.clientId }
      );
      return;
    }

    const request = this.#requests.get(message.requestId);
    if (!request) {
      this.#sendStatus(
        client.socket,
        'warning',
        'request_cancelled',
        `No pending discord request exists for ${message.requestId}.`,
        { requestId: message.requestId, clientId: message.clientId }
      );
      return;
    }

    if (this.verbose && message.delta) {
      request.replyText += message.delta;
    }

    if (!this.verbose && !request.hasLoggedReply) {
      request.hasLoggedReply = true;
      this.#logCopilotReply(message);
    }

    this.#send(request.discordSocket, message);

    if (
      this.verbose &&
      !request.hasLoggedReply &&
      (message.done || message.error)
    ) {
      request.hasLoggedReply = true;
      const content = message.error
        ? `Error: ${message.error}`
        : request.replyText.trim() || 'Replies';

      queueMicrotask(() => {
        this.#logCopilotReply(message, content);
      });
    }

    if (message.done) {
      this.#requests.delete(message.requestId);
    }
  }

  #handlePermissionRequest(
    client: RegisteredClient,
    message: PermissionRequestMessage
  ) {
    if (client.role !== 'vscode') {
      this.#sendStatus(
        client.socket,
        'error',
        'unsupported_message',
        'Only VS Code clients can send permission requests.',
        { requestId: message.requestId, clientId: message.clientId }
      );
      return;
    }

    const request = this.#requests.get(message.requestId);
    if (!request) {
      this.#sendStatus(
        client.socket,
        'warning',
        'request_cancelled',
        `No pending discord request exists for ${message.requestId}.`,
        { requestId: message.requestId, clientId: message.clientId }
      );
      return;
    }

    this.#send(request.discordSocket, message);
  }

  #handlePermissionResponse(
    client: RegisteredClient,
    message: PermissionResponseMessage
  ) {
    if (client.role !== 'discord') {
      this.#sendStatus(
        client.socket,
        'error',
        'unsupported_message',
        'Only discord clients can send permission responses.',
        { requestId: message.requestId, clientId: message.clientId }
      );
      return;
    }

    const request = this.#requests.get(message.requestId);
    if (!request) {
      this.#sendStatus(
        client.socket,
        'warning',
        'request_cancelled',
        `The request ${message.requestId} is no longer active.`,
        { requestId: message.requestId, clientId: message.clientId }
      );
      return;
    }

    const vscodeClient = this.#clients.vscode.get(request.targetClientId);
    if (!vscodeClient) {
      this.#sendStatus(
        client.socket,
        'error',
        'target_not_connected',
        `No VS Code client is connected for ${request.targetClientId}.`,
        {
          requestId: message.requestId,
          clientId: request.targetClientId,
          targetClientRole: 'vscode'
        }
      );
      this.#requests.delete(message.requestId);
      return;
    }

    this.#send(vscodeClient.socket, message);
  }

  #handleSocketClose(socket: WebSocket) {
    const client = this.#connections.get(socket);
    if (!client) {
      return;
    }

    this.#connections.delete(socket);

    const registeredClient = this.#clients[client.role].get(client.clientId);
    if (registeredClient?.socket === socket) {
      this.#clients[client.role].delete(client.clientId);
    }

    const pendingEntries = [...this.#requests.entries()].filter(
      ([, request]) => {
        return (
          request.discordConnectionId === client.connectionId ||
          request.targetClientId === client.clientId
        );
      }
    );

    for (const [requestId, request] of pendingEntries) {
      if (client.role === 'vscode') {
        this.#sendStatus(
          request.discordSocket,
          'error',
          'target_not_connected',
          `VS Code client ${client.clientId} disconnected before completing the request.`,
          { requestId, clientId: client.clientId, targetClientRole: 'vscode' }
        );
      }

      this.#requests.delete(requestId);
    }

    this.#broadcastStatus(
      'warning',
      'client_disconnected',
      `${client.role} client ${client.clientId} disconnected.`,
      { clientId: client.clientId, targetClientRole: client.role }
    );
  }

  #broadcastStatus(
    level: RelayStatusLevel,
    code: RelayStatusCode,
    message: string,
    details: {
      clientId?: string;
      requestId?: string;
      targetClientRole?: ClientRole;
    } = {}
  ) {
    const statusMessage = {
      type: 'relay_status' as const,
      level,
      code,
      message,
      ...details
    };

    for (const client of this.#clients.discord.values()) {
      this.#send(client.socket, statusMessage);
    }
  }

  #sendStatus(
    socket: WebSocket,
    level: RelayStatusLevel,
    code: RelayStatusCode,
    message: string,
    details: {
      clientId?: string;
      requestId?: string;
      targetClientRole?: ClientRole;
    } = {}
  ) {
    this.#send(socket, {
      type: 'relay_status',
      level,
      code,
      message,
      ...details
    });
  }

  #send(socket: WebSocket, message: RelayMessage) {
    if (socket.readyState !== socket.OPEN) {
      return;
    }

    socket.send(serializeRelayMessage(message));
  }
}

export const loadRelayServerOptions = (): RelayServerOptions => {
  const port = Number.parseInt(process.env.RELAY_PORT ?? `${DEFAULT_PORT}`, 10);
  const hasVerboseFlag = process.argv.includes('--verbose');
  const relayLogLevel = process.env.RELAY_LOG?.trim().toLowerCase();
  const verbose = hasVerboseFlag || relayLogLevel === 'verbose';

  return {
    host: process.env.RELAY_HOST ?? DEFAULT_HOST,
    path: process.env.RELAY_PATH ?? DEFAULT_PATH,
    port: Number.isNaN(port) ? DEFAULT_PORT : port,
    verbose
  };
};

export const startRelayServer = async (
  options: RelayServerOptions = loadRelayServerOptions()
) => {
  const server = new RelayServer(options);
  await server.start();
  return server;
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const server = await startRelayServer();

  process.stdout.write(`Relay server listening on ${server.address}\n`);
}
