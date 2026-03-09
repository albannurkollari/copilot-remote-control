import { createRequestId, type RelayMessage } from '@remote-copilot/shared';
import { WebSocket } from 'ws';

import { RelayServer } from './server.js';

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

const createSocket = async (address: string) => {
  const socket = new WebSocket(address);
  await waitForOpen(socket);
  return socket;
};

describe('RelayServer', () => {
  const servers: RelayServer[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.stop()));
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
});
