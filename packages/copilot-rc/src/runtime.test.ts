import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockBot = vi.hoisted(() => ({
  start: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn().mockResolvedValue(undefined)
}));

const mockRelay = vi.hoisted(() => ({
  address: 'ws://127.0.0.1:8787/',
  stop: vi.fn().mockResolvedValue(undefined)
}));

const relayModule = vi.hoisted(() => ({
  loadRelayServerOptions: vi.fn(() => ({ port: 8787 })),
  startRelayServer: vi.fn(async () => mockRelay)
}));

const botModule = vi.hoisted(() => ({
  createDiscordBot: vi.fn(() => mockBot),
  loadDiscordBotConfig: vi.fn(() => ({ token: 'token' }))
}));

vi.mock('../../discord-bot/src/index.ts', () => botModule);
vi.mock('../../relay-server/src/index.ts', () => relayModule);

import { runRemoteControlStack, startRemoteControlStack } from './runtime.ts';

describe('startRemoteControlStack', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBot.start.mockResolvedValue(undefined);
    mockBot.stop.mockResolvedValue(undefined);
    mockRelay.stop.mockResolvedValue(undefined);
  });

  it('starts the relay and bot and stops both', async () => {
    const runtime = await startRemoteControlStack();

    expect(relayModule.loadRelayServerOptions).toHaveBeenCalled();
    expect(relayModule.startRelayServer).toHaveBeenCalled();
    expect(botModule.loadDiscordBotConfig).toHaveBeenCalled();
    expect(botModule.createDiscordBot).toHaveBeenCalled();
    expect(mockBot.start).toHaveBeenCalled();

    await runtime.stop();

    expect(mockBot.stop).toHaveBeenCalled();
    expect(mockRelay.stop).toHaveBeenCalled();
  });

  it('stops the relay if bot startup fails', async () => {
    mockBot.start.mockRejectedValueOnce(new Error('bot failed'));

    await expect(startRemoteControlStack()).rejects.toThrow('bot failed');
    expect(mockRelay.stop).toHaveBeenCalled();
  });
});

describe('runRemoteControlStack', () => {
  const originalListeners = {
    SIGINT: process.listeners('SIGINT'),
    SIGTERM: process.listeners('SIGTERM')
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockBot.start.mockResolvedValue(undefined);
    mockBot.stop.mockResolvedValue(undefined);
    mockRelay.stop.mockResolvedValue(undefined);
  });

  afterEach(() => {
    for (const listener of process.listeners('SIGINT')) {
      process.off('SIGINT', listener);
    }
    for (const listener of process.listeners('SIGTERM')) {
      process.off('SIGTERM', listener);
    }
    for (const listener of originalListeners.SIGINT) {
      process.on('SIGINT', listener as (...args: any[]) => void);
    }
    for (const listener of originalListeners.SIGTERM) {
      process.on('SIGTERM', listener as (...args: any[]) => void);
    }
  });

  it('runs lifecycle callbacks around shutdown', async () => {
    const events: string[] = [];
    await runRemoteControlStack({
      onRelayReady: async (address) => {
        events.push(`ready:${address}`);
      },
      onStarted: async () => {
        events.push('started');
        setTimeout(() => {
          process.emit('SIGINT', 'SIGINT');
        }, 0);
      },
      onStopping: async (signal) => {
        events.push(`stopping:${signal}`);
      },
      onStopped: async () => {
        events.push('stopped');
      }
    });

    expect(events).toEqual([
      'ready:ws://127.0.0.1:8787/',
      'started',
      'stopping:SIGINT',
      'stopped'
    ]);
    expect(mockBot.stop).toHaveBeenCalled();
    expect(mockRelay.stop).toHaveBeenCalled();
  });
});
