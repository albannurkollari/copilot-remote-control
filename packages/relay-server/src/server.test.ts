import { createRequestId, type RelayMessage } from '@remote-copilot/shared';
import { afterEach } from 'vitest';
import { WebSocket } from 'ws';

import {
  RelayServer,
  loadRelayServerOptions,
  startRelayServer
} from './server.ts';

const waitForOpen = (socket: WebSocket) => {
  return new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
  });
};

const nextMessage = (socket: WebSocket) => {
  return new Promise<RelayMessage>((resolve, reject) => {
    socket.once('message', (data) => {
      resolve(JSON.parse(data.toString()) as RelayMessage);
    });
    socket.once('error', reject);
  });
};

const waitForClose = (socket: WebSocket) => {
  return new Promise<void>((resolve) => {
    socket.once('close', () => resolve());
  });
};

const createSocket = async (address: string) => {
  const socket = new WebSocket(address);
  await waitForOpen(socket);
  return socket;
};

describe('RelayServer', () => {
  const servers: RelayServer[] = [];
  const originalEnv = { ...process.env };
  const originalArgv = [...process.argv];

  afterEach(async () => {
    process.env = { ...originalEnv };
    process.argv = [...originalArgv];
    await Promise.all(servers.splice(0).map((server) => server.stop()));
  });

  it('loads relay options from env and verbose flags', () => {
    process.env.RELAY_HOST = '0.0.0.0';
    process.env.RELAY_PATH = '/relay';
    process.env.RELAY_PORT = 'nope';
    process.env.RELAY_LOG = 'verbose';
    process.env.REMOTE_COPILOT_SHARED_SECRET = ' secret ';
    process.argv = [...originalArgv, '--verbose'];

    expect(loadRelayServerOptions()).toEqual({
      host: '0.0.0.0',
      path: '/relay',
      port: 8787,
      sharedSecret: 'secret',
      verbose: true
    });
  });

  it('uses default relay options when env vars are absent', () => {
    delete process.env.RELAY_HOST;
    delete process.env.RELAY_PATH;
    delete process.env.RELAY_PORT;
    delete process.env.RELAY_LOG;
    delete process.env.REMOTE_COPILOT_SHARED_SECRET;

    expect(loadRelayServerOptions()).toEqual({
      host: '127.0.0.1',
      path: '/',
      port: 8787,
      sharedSecret: undefined,
      verbose: false
    });
  });

  it('parses a valid RELAY_PORT and uses RELAY_LOG verbose without --verbose flag', () => {
    process.env.RELAY_PORT = '9876';
    process.env.RELAY_LOG = 'verbose';

    const options = loadRelayServerOptions();
    expect(options.port).toBe(9876);
    expect(options.verbose).toBe(true);
  });

  it('treats a whitespace-only sharedSecret as absent', () => {
    const server = new RelayServer({ port: 8814, sharedSecret: '   ' });
    servers.push(server);

    expect(server.sharedSecret).toBeUndefined();
  });

  it('uses default port when none is provided', () => {
    const server = new RelayServer({});
    expect(server.address).toContain(':8787');
  });

  it('starts a relay server with helper defaults', async () => {
    const server = await startRelayServer({ port: 8803 });
    servers.push(server);

    expect(server).toBeInstanceOf(RelayServer);
    expect(server.address).toBe('ws://127.0.0.1:8803/');
  });

  it('starts and stops idempotently', async () => {
    const server = new RelayServer({ port: 8811 });
    servers.push(server);

    await server.start();
    await server.start();
    await server.stop();
    await server.stop();

    expect(server.address).toBe('ws://127.0.0.1:8811/');
  });

  it('registers clients and routes prompt streams', async () => {
    const server = new RelayServer({ port: 8791 });
    servers.push(server);
    await server.start();

    const discord = await createSocket(server.address);
    const vscode = await createSocket(server.address);

    discord.send(
      JSON.stringify({
        type: 'register',
        clientRole: 'discord',
        clientId: 'bot-1'
      })
    );
    expect((await nextMessage(discord)).type).toBe('register_ack');

    vscode.send(
      JSON.stringify({
        type: 'register',
        clientRole: 'vscode',
        clientId: 'workspace-1'
      })
    );
    expect((await nextMessage(vscode)).type).toBe('register_ack');

    const requestId = createRequestId();
    discord.send(
      JSON.stringify({
        type: 'copilot_prompt',
        clientId: 'workspace-1',
        requestId,
        mode: 'ask',
        prompt: 'Explain this function'
      })
    );

    const forwardedPrompt = await nextMessage(vscode);
    expect(forwardedPrompt.type).toBe('copilot_prompt');
    if (forwardedPrompt.type !== 'copilot_prompt') {
      throw new Error(
        `Expected copilot_prompt but received ${forwardedPrompt.type}`
      );
    }

    expect(forwardedPrompt.requestId).toBe(requestId);

    vscode.send(
      JSON.stringify({
        type: 'copilot_stream',
        clientId: 'workspace-1',
        requestId,
        delta: 'Hello',
        done: false
      })
    );

    const firstChunk = await nextMessage(discord);
    expect(firstChunk.type).toBe('copilot_stream');
    if (firstChunk.type !== 'copilot_stream') {
      throw new Error(
        `Expected copilot_stream but received ${firstChunk.type}`
      );
    }

    expect(firstChunk.delta).toBe('Hello');

    vscode.send(
      JSON.stringify({
        type: 'copilot_stream',
        clientId: 'workspace-1',
        requestId,
        done: true
      })
    );

    const finalChunk = await nextMessage(discord);
    expect(finalChunk.type).toBe('copilot_stream');
    if (finalChunk.type !== 'copilot_stream') {
      throw new Error(
        `Expected copilot_stream but received ${finalChunk.type}`
      );
    }

    expect(finalChunk.done).toBe(true);

    discord.close();
    vscode.close();
  });

  it('reports malformed messages', async () => {
    const server = new RelayServer({ port: 8792 });
    servers.push(server);
    await server.start();

    const discord = await createSocket(server.address);
    discord.send('{not-json');

    const status = await nextMessage(discord);
    expect(status.type).toBe('relay_status');
    if (status.type !== 'relay_status') {
      throw new Error(`Expected relay_status but received ${status.type}`);
    }

    expect(status.code).toBe('malformed_message');

    discord.close();
  });

  it('rejects prompts when the target vscode client is unavailable', async () => {
    const server = new RelayServer({ port: 8793 });
    servers.push(server);
    await server.start();

    const discord = await createSocket(server.address);
    discord.send(
      JSON.stringify({
        type: 'register',
        clientRole: 'discord',
        clientId: 'bot-1'
      })
    );
    expect((await nextMessage(discord)).type).toBe('register_ack');

    discord.send(
      JSON.stringify({
        type: 'copilot_prompt',
        clientId: 'missing-workspace',
        requestId: createRequestId(),
        mode: 'plan',
        prompt: 'Plan this feature'
      })
    );

    const status = await nextMessage(discord);
    expect(status.type).toBe('relay_status');
    if (status.type !== 'relay_status') {
      throw new Error(`Expected relay_status but received ${status.type}`);
    }

    expect(status.code).toBe('target_not_connected');

    discord.close();
  });

  it('rejects client registration with an invalid shared secret', async () => {
    const server = new RelayServer({
      port: 8794,
      sharedSecret: 'trusted-secret'
    });
    servers.push(server);
    await server.start();

    const discord = await createSocket(server.address);
    discord.send(
      JSON.stringify({
        type: 'register',
        clientRole: 'discord',
        clientId: 'bot-1',
        sharedSecret: 'wrong-secret'
      })
    );

    const status = await nextMessage(discord);
    expect(status.type).toBe('relay_status');
    if (status.type !== 'relay_status') {
      throw new Error(`Expected relay_status but received ${status.type}`);
    }

    expect(status.code).toBe('authorization_required');
    discord.close();
  });

  it('accepts client registration with the configured shared secret', async () => {
    const server = new RelayServer({
      port: 8795,
      sharedSecret: 'trusted-secret'
    });
    servers.push(server);
    await server.start();

    const discord = await createSocket(server.address);
    discord.send(
      JSON.stringify({
        type: 'register',
        clientRole: 'discord',
        clientId: 'bot-1',
        sharedSecret: 'trusted-secret'
      })
    );

    const ack = await nextMessage(discord);
    expect(ack.type).toBe('register_ack');
    discord.close();
  });

  it('forwards cancel requests to the target vscode client', async () => {
    const server = new RelayServer({ port: 8796 });
    servers.push(server);
    await server.start();

    const discord = await createSocket(server.address);
    const vscode = await createSocket(server.address);

    discord.send(
      JSON.stringify({
        type: 'register',
        clientRole: 'discord',
        clientId: 'bot-1'
      })
    );
    expect((await nextMessage(discord)).type).toBe('register_ack');

    vscode.send(
      JSON.stringify({
        type: 'register',
        clientRole: 'vscode',
        clientId: 'workspace-1'
      })
    );
    expect((await nextMessage(vscode)).type).toBe('register_ack');

    const requestId = createRequestId();
    const forwardedPromptPromise = nextMessage(vscode);
    discord.send(
      JSON.stringify({
        type: 'copilot_prompt',
        clientId: 'workspace-1',
        requestId,
        mode: 'ask',
        prompt: 'Start a long task'
      })
    );

    expect((await forwardedPromptPromise).type).toBe('copilot_prompt');

    const cancelStatusPromise = nextMessage(discord);
    const cancelForwardedPromise = nextMessage(vscode);
    discord.send(
      JSON.stringify({
        type: 'copilot_cancel',
        clientId: 'workspace-1',
        requestId
      })
    );

    const cancelStatus = await cancelStatusPromise;
    expect(cancelStatus.type).toBe('relay_status');
    if (cancelStatus.type !== 'relay_status') {
      throw new Error(
        `Expected relay_status but received ${cancelStatus.type}`
      );
    }

    expect(cancelStatus.code).toBe('request_cancelled');

    const cancelForwarded = await cancelForwardedPromise;
    expect(cancelForwarded.type).toBe('copilot_cancel');
    if (cancelForwarded.type !== 'copilot_cancel') {
      throw new Error(
        `Expected copilot_cancel but received ${cancelForwarded.type}`
      );
    }

    expect(cancelForwarded.requestId).toBe(requestId);

    discord.close();
    vscode.close();
  });

  it('routes permission requests to discord and responses back to vscode', async () => {
    const server = new RelayServer({ port: 8797 });
    servers.push(server);
    await server.start();

    const discord = await createSocket(server.address);
    const vscode = await createSocket(server.address);

    discord.send(
      JSON.stringify({
        type: 'register',
        clientRole: 'discord',
        clientId: 'bot-1'
      })
    );
    expect((await nextMessage(discord)).type).toBe('register_ack');

    vscode.send(
      JSON.stringify({
        type: 'register',
        clientRole: 'vscode',
        clientId: 'workspace-1'
      })
    );
    expect((await nextMessage(vscode)).type).toBe('register_ack');

    discord.send(
      JSON.stringify({
        type: 'copilot_prompt',
        clientId: 'workspace-1',
        requestId: 'req-1',
        mode: 'ask',
        prompt: 'Start'
      })
    );
    expect((await nextMessage(vscode)).type).toBe('copilot_prompt');

    vscode.send(
      JSON.stringify({
        type: 'permission_request',
        clientId: 'workspace-1',
        requestId: 'req-1',
        permissionId: 'perm-1',
        action: 'edit_file',
        title: 'Edit file'
      })
    );

    const forwardedRequest = await nextMessage(discord);
    expect(forwardedRequest.type).toBe('permission_request');

    discord.send(
      JSON.stringify({
        type: 'permission_response',
        clientId: 'workspace-1',
        requestId: 'req-1',
        permissionId: 'perm-1',
        approved: true
      })
    );

    const forwardedResponse = await nextMessage(vscode);
    expect(forwardedResponse.type).toBe('permission_response');

    discord.close();
    vscode.close();
  });

  it('responds to ping with pong and rejects unsupported message directions', async () => {
    const server = new RelayServer({ port: 8798 });
    servers.push(server);
    await server.start();

    const vscode = await createSocket(server.address);
    vscode.send(
      JSON.stringify({
        type: 'register',
        clientRole: 'vscode',
        clientId: 'workspace-1'
      })
    );
    expect((await nextMessage(vscode)).type).toBe('register_ack');

    vscode.send(
      JSON.stringify({
        type: 'ping',
        timestamp: '2026-03-10T00:00:00.000Z'
      })
    );

    const pong = await nextMessage(vscode);
    expect(pong.type).toBe('pong');

    vscode.send(
      JSON.stringify({
        type: 'copilot_prompt',
        clientId: 'workspace-1',
        requestId: 'req-1',
        mode: 'ask',
        prompt: 'nope'
      })
    );

    const status = await nextMessage(vscode);
    expect(status.type).toBe('relay_status');
    if (status.type !== 'relay_status') {
      throw new Error(`Expected relay_status but received ${status.type}`);
    }

    expect(status.code).toBe('unsupported_message');
    vscode.close();
  });

  it('rejects server-managed messages sent by registered clients', async () => {
    const server = new RelayServer({ port: 8812 });
    servers.push(server);
    await server.start();

    const discord = await createSocket(server.address);
    discord.send(
      JSON.stringify({
        type: 'register',
        clientRole: 'discord',
        clientId: 'bot-1'
      })
    );
    expect((await nextMessage(discord)).type).toBe('register_ack');

    for (const type of ['register_ack', 'relay_status', 'pong'] as const) {
      discord.send(
        JSON.stringify(
          type === 'pong'
            ? { type, timestamp: '2026-03-10T00:00:00.000Z' }
            : type === 'register_ack'
              ? {
                  type,
                  clientRole: 'discord',
                  clientId: 'bot-1',
                  connectionId: 'conn-1'
                }
              : {
                  type,
                  code: 'request_failed',
                  level: 'error',
                  message: 'Nope'
                }
        )
      );

      const status = await nextMessage(discord);
      expect(status.type).toBe('relay_status');
      if (status.type !== 'relay_status') {
        throw new Error(`Expected relay_status but received ${status.type}`);
      }

      expect(status.message).toContain('server-managed');
    }

    discord.close();
  });

  it('rejects cancel requests from vscode clients and inactive discord cancels', async () => {
    const server = new RelayServer({ port: 8813 });
    servers.push(server);
    await server.start();

    const discord = await createSocket(server.address);
    const vscode = await createSocket(server.address);

    discord.send(
      JSON.stringify({
        type: 'register',
        clientRole: 'discord',
        clientId: 'bot-1'
      })
    );
    expect((await nextMessage(discord)).type).toBe('register_ack');

    vscode.send(
      JSON.stringify({
        type: 'register',
        clientRole: 'vscode',
        clientId: 'workspace-1'
      })
    );
    expect((await nextMessage(vscode)).type).toBe('register_ack');

    vscode.send(
      JSON.stringify({
        type: 'copilot_cancel',
        clientId: 'workspace-1',
        requestId: 'req-1'
      })
    );

    const unsupported = await nextMessage(vscode);
    expect(unsupported.type).toBe('relay_status');
    if (unsupported.type !== 'relay_status') {
      throw new Error(`Expected relay_status but received ${unsupported.type}`);
    }

    expect(unsupported.code).toBe('unsupported_message');

    discord.send(
      JSON.stringify({
        type: 'copilot_cancel',
        clientId: 'workspace-1',
        requestId: 'missing'
      })
    );

    const missing = await nextMessage(discord);
    expect(missing.type).toBe('relay_status');
    if (missing.type !== 'relay_status') {
      throw new Error(`Expected relay_status but received ${missing.type}`);
    }

    expect(missing.message).toContain('no longer active');

    discord.close();
    vscode.close();
  });

  it('rejects messages sent before registration and closes the socket', async () => {
    const server = new RelayServer({ port: 8799 });
    servers.push(server);
    await server.start();

    const socket = await createSocket(server.address);
    const closePromise = waitForClose(socket);

    socket.send(
      JSON.stringify({
        type: 'ping',
        timestamp: '2026-03-10T00:00:00.000Z'
      })
    );

    const status = await nextMessage(socket);
    expect(status.type).toBe('relay_status');
    if (status.type !== 'relay_status') {
      throw new Error(`Expected relay_status but received ${status.type}`);
    }

    expect(status.code).toBe('unsupported_message');
    await closePromise;
  });

  it('reports repeated cancel requests after the first cancellation is forwarded', async () => {
    const server = new RelayServer({ port: 8800 });
    servers.push(server);
    await server.start();

    const discord = await createSocket(server.address);
    const vscode = await createSocket(server.address);

    discord.send(
      JSON.stringify({
        type: 'register',
        clientRole: 'discord',
        clientId: 'bot-1'
      })
    );
    expect((await nextMessage(discord)).type).toBe('register_ack');

    vscode.send(
      JSON.stringify({
        type: 'register',
        clientRole: 'vscode',
        clientId: 'workspace-1'
      })
    );
    expect((await nextMessage(vscode)).type).toBe('register_ack');

    const requestId = createRequestId();
    discord.send(
      JSON.stringify({
        type: 'copilot_prompt',
        clientId: 'workspace-1',
        requestId,
        mode: 'ask',
        prompt: 'Start'
      })
    );
    expect((await nextMessage(vscode)).type).toBe('copilot_prompt');

    discord.send(
      JSON.stringify({
        type: 'copilot_cancel',
        clientId: 'workspace-1',
        requestId
      })
    );

    const firstStatus = await nextMessage(discord);
    expect(firstStatus.type).toBe('relay_status');
    if (firstStatus.type !== 'relay_status') {
      throw new Error(`Expected relay_status but received ${firstStatus.type}`);
    }

    expect(firstStatus.message).toContain('Cancellation requested');
    expect((await nextMessage(vscode)).type).toBe('copilot_cancel');

    discord.send(
      JSON.stringify({
        type: 'copilot_cancel',
        clientId: 'workspace-1',
        requestId
      })
    );

    const secondStatus = await nextMessage(discord);
    expect(secondStatus.type).toBe('relay_status');
    if (secondStatus.type !== 'relay_status') {
      throw new Error(
        `Expected relay_status but received ${secondStatus.type}`
      );
    }

    expect(secondStatus.message).toContain('Cancellation already requested');

    discord.close();
    vscode.close();
  });

  it('warns the old client when a newer client registers with the same id', async () => {
    const server = new RelayServer({ port: 8801 });
    servers.push(server);
    await server.start();

    const firstDiscord = await createSocket(server.address);
    const secondDiscord = await createSocket(server.address);

    firstDiscord.send(
      JSON.stringify({
        type: 'register',
        clientRole: 'discord',
        clientId: 'bot-1'
      })
    );
    expect((await nextMessage(firstDiscord)).type).toBe('register_ack');

    const closePromise = waitForClose(firstDiscord);
    secondDiscord.send(
      JSON.stringify({
        type: 'register',
        clientRole: 'discord',
        clientId: 'bot-1'
      })
    );

    const warning = await nextMessage(firstDiscord);
    expect(warning.type).toBe('relay_status');
    if (warning.type !== 'relay_status') {
      throw new Error(`Expected relay_status but received ${warning.type}`);
    }

    expect(warning.code).toBe('client_disconnected');
    expect(warning.message).toContain('Connection replaced');
    expect((await nextMessage(secondDiscord)).type).toBe('register_ack');
    await closePromise;

    secondDiscord.close();
  });

  it('notifies discord when the vscode client disconnects during a pending request', async () => {
    const server = new RelayServer({ port: 8802 });
    servers.push(server);
    await server.start();

    const discord = await createSocket(server.address);
    const vscode = await createSocket(server.address);

    discord.send(
      JSON.stringify({
        type: 'register',
        clientRole: 'discord',
        clientId: 'bot-1'
      })
    );
    expect((await nextMessage(discord)).type).toBe('register_ack');

    vscode.send(
      JSON.stringify({
        type: 'register',
        clientRole: 'vscode',
        clientId: 'workspace-1'
      })
    );
    expect((await nextMessage(vscode)).type).toBe('register_ack');

    const requestId = createRequestId();
    discord.send(
      JSON.stringify({
        type: 'copilot_prompt',
        clientId: 'workspace-1',
        requestId,
        mode: 'ask',
        prompt: 'Start'
      })
    );
    expect((await nextMessage(vscode)).type).toBe('copilot_prompt');

    vscode.close();

    const status = await nextMessage(discord);
    expect(status.type).toBe('relay_status');
    if (status.type !== 'relay_status') {
      throw new Error(`Expected relay_status but received ${status.type}`);
    }

    expect(status.code).toBe('target_not_connected');
    expect(status.message).toContain(
      'disconnected before completing the request'
    );

    discord.close();
  });

  it('warns when vscode requests permission for a missing prompt', async () => {
    const server = new RelayServer({ port: 8807 });
    servers.push(server);
    await server.start();

    const vscode = await createSocket(server.address);
    vscode.send(
      JSON.stringify({
        type: 'register',
        clientRole: 'vscode',
        clientId: 'workspace-1'
      })
    );
    expect((await nextMessage(vscode)).type).toBe('register_ack');

    vscode.send(
      JSON.stringify({
        type: 'permission_request',
        clientId: 'workspace-1',
        requestId: 'missing',
        permissionId: 'perm-1',
        action: 'edit_file',
        title: 'Edit file'
      })
    );

    const status = await nextMessage(vscode);
    expect(status.type).toBe('relay_status');
    if (status.type !== 'relay_status') {
      throw new Error(`Expected relay_status but received ${status.type}`);
    }

    expect(status.code).toBe('request_cancelled');
    vscode.close();
  });

  it('warns when vscode streams a reply for a missing prompt', async () => {
    const server = new RelayServer({ port: 8810 });
    servers.push(server);
    await server.start();

    const vscode = await createSocket(server.address);
    vscode.send(
      JSON.stringify({
        type: 'register',
        clientRole: 'vscode',
        clientId: 'workspace-1'
      })
    );
    expect((await nextMessage(vscode)).type).toBe('register_ack');

    vscode.send(
      JSON.stringify({
        type: 'copilot_stream',
        clientId: 'workspace-1',
        requestId: 'missing',
        done: true
      })
    );

    const status = await nextMessage(vscode);
    expect(status.type).toBe('relay_status');
    if (status.type !== 'relay_status') {
      throw new Error(`Expected relay_status but received ${status.type}`);
    }

    expect(status.code).toBe('request_cancelled');
    vscode.close();
  });

  it('logs accumulated verbose replies when streams finish', async () => {
    const server = new RelayServer({ port: 8808, verbose: true });
    servers.push(server);
    await server.start();

    const logSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    try {
      const discord = await createSocket(server.address);
      const vscode = await createSocket(server.address);

      discord.send(
        JSON.stringify({
          type: 'register',
          clientRole: 'discord',
          clientId: 'bot-1'
        })
      );
      expect((await nextMessage(discord)).type).toBe('register_ack');

      vscode.send(
        JSON.stringify({
          type: 'register',
          clientRole: 'vscode',
          clientId: 'workspace-1'
        })
      );
      expect((await nextMessage(vscode)).type).toBe('register_ack');

      const requestId = createRequestId();
      discord.send(
        JSON.stringify({
          type: 'copilot_prompt',
          clientId: 'workspace-1',
          requestId,
          mode: 'ask',
          prompt: 'Explain this function'
        })
      );
      expect((await nextMessage(vscode)).type).toBe('copilot_prompt');

      vscode.send(
        JSON.stringify({
          type: 'copilot_stream',
          clientId: 'workspace-1',
          requestId,
          delta: 'Hello ',
          done: false
        })
      );
      expect((await nextMessage(discord)).type).toBe('copilot_stream');

      vscode.send(
        JSON.stringify({
          type: 'copilot_stream',
          clientId: 'workspace-1',
          requestId,
          delta: 'world',
          done: true
        })
      );
      expect((await nextMessage(discord)).type).toBe('copilot_stream');
      await Promise.resolve();

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Hello world')
      );

      discord.close();
      vscode.close();
    } finally {
      logSpy.mockRestore();
    }
  });

  it('logs verbose stream errors when replies fail', async () => {
    const server = new RelayServer({ port: 8809, verbose: true });
    servers.push(server);
    await server.start();

    const logSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    try {
      const discord = await createSocket(server.address);
      const vscode = await createSocket(server.address);

      discord.send(
        JSON.stringify({
          type: 'register',
          clientRole: 'discord',
          clientId: 'bot-1'
        })
      );
      expect((await nextMessage(discord)).type).toBe('register_ack');

      vscode.send(
        JSON.stringify({
          type: 'register',
          clientRole: 'vscode',
          clientId: 'workspace-1'
        })
      );
      expect((await nextMessage(vscode)).type).toBe('register_ack');

      const requestId = createRequestId();
      discord.send(
        JSON.stringify({
          type: 'copilot_prompt',
          clientId: 'workspace-1',
          requestId,
          mode: 'ask',
          prompt: 'Explain this function'
        })
      );
      expect((await nextMessage(vscode)).type).toBe('copilot_prompt');

      vscode.send(
        JSON.stringify({
          type: 'copilot_stream',
          clientId: 'workspace-1',
          requestId,
          done: true,
          error: 'Boom'
        })
      );
      expect((await nextMessage(discord)).type).toBe('copilot_stream');
      await Promise.resolve();

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error: Boom')
      );

      discord.close();
      vscode.close();
    } finally {
      logSpy.mockRestore();
    }
  });

  it('uses Replies as fallback when verbose stream finishes with no accumulated text', async () => {
    const server = new RelayServer({ port: 8815, verbose: true });
    servers.push(server);
    await server.start();

    const logSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    try {
      const discord = await createSocket(server.address);
      const vscode = await createSocket(server.address);

      discord.send(
        JSON.stringify({
          type: 'register',
          clientRole: 'discord',
          clientId: 'bot-1'
        })
      );
      expect((await nextMessage(discord)).type).toBe('register_ack');

      vscode.send(
        JSON.stringify({
          type: 'register',
          clientRole: 'vscode',
          clientId: 'workspace-1'
        })
      );
      expect((await nextMessage(vscode)).type).toBe('register_ack');

      const requestId = createRequestId();
      discord.send(
        JSON.stringify({
          type: 'copilot_prompt',
          clientId: 'workspace-1',
          requestId,
          mode: 'ask',
          prompt: 'Q'
        })
      );
      expect((await nextMessage(vscode)).type).toBe('copilot_prompt');

      vscode.send(
        JSON.stringify({
          type: 'copilot_stream',
          clientId: 'workspace-1',
          requestId,
          done: true
        })
      );
      expect((await nextMessage(discord)).type).toBe('copilot_stream');
      await Promise.resolve();

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Replies'));

      discord.close();
      vscode.close();
    } finally {
      logSpy.mockRestore();
    }
  });

  it('rejects permission responses for inactive requests', async () => {
    const server = new RelayServer({ port: 8804 });
    servers.push(server);
    await server.start();

    const discord = await createSocket(server.address);
    discord.send(
      JSON.stringify({
        type: 'register',
        clientRole: 'discord',
        clientId: 'bot-1'
      })
    );
    expect((await nextMessage(discord)).type).toBe('register_ack');

    discord.send(
      JSON.stringify({
        type: 'permission_response',
        clientId: 'workspace-1',
        requestId: 'missing',
        permissionId: 'perm-1',
        approved: true
      })
    );

    const status = await nextMessage(discord);
    expect(status.type).toBe('relay_status');
    if (status.type !== 'relay_status') {
      throw new Error(`Expected relay_status but received ${status.type}`);
    }

    expect(status.code).toBe('request_cancelled');
    discord.close();
  });

  it('rejects permission responses sent by vscode clients', async () => {
    const server = new RelayServer({ port: 8805 });
    servers.push(server);
    await server.start();

    const vscode = await createSocket(server.address);
    vscode.send(
      JSON.stringify({
        type: 'register',
        clientRole: 'vscode',
        clientId: 'workspace-1'
      })
    );
    expect((await nextMessage(vscode)).type).toBe('register_ack');

    vscode.send(
      JSON.stringify({
        type: 'permission_response',
        clientId: 'workspace-1',
        requestId: 'req-1',
        permissionId: 'perm-1',
        approved: true
      })
    );

    const status = await nextMessage(vscode);
    expect(status.type).toBe('relay_status');
    if (status.type !== 'relay_status') {
      throw new Error(`Expected relay_status but received ${status.type}`);
    }

    expect(status.code).toBe('unsupported_message');
    vscode.close();
  });

  it('rejects permission and stream messages sent from discord clients', async () => {
    const server = new RelayServer({ port: 8806 });
    servers.push(server);
    await server.start();

    const discord = await createSocket(server.address);
    discord.send(
      JSON.stringify({
        type: 'register',
        clientRole: 'discord',
        clientId: 'bot-1'
      })
    );
    expect((await nextMessage(discord)).type).toBe('register_ack');

    discord.send(
      JSON.stringify({
        type: 'permission_request',
        clientId: 'workspace-1',
        requestId: 'req-1',
        permissionId: 'perm-1',
        action: 'edit_file',
        title: 'Edit file'
      })
    );

    const permissionStatus = await nextMessage(discord);
    expect(permissionStatus.type).toBe('relay_status');
    if (permissionStatus.type !== 'relay_status') {
      throw new Error(
        `Expected relay_status but received ${permissionStatus.type}`
      );
    }

    expect(permissionStatus.code).toBe('unsupported_message');

    discord.send(
      JSON.stringify({
        type: 'copilot_stream',
        clientId: 'workspace-1',
        requestId: 'req-1',
        done: true
      })
    );

    const streamStatus = await nextMessage(discord);
    expect(streamStatus.type).toBe('relay_status');
    if (streamStatus.type !== 'relay_status') {
      throw new Error(
        `Expected relay_status but received ${streamStatus.type}`
      );
    }

    expect(streamStatus.code).toBe('unsupported_message');
    discord.close();
  });
});
