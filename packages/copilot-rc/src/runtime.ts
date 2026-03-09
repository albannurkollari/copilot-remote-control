import {
  createDiscordBot,
  loadDiscordBotConfig
} from '../../discord-bot/src/index.ts';
import {
  RelayServer,
  loadRelayServerOptions,
  startRelayServer
} from '../../relay-server/src/index.ts';

export interface DiscordBotRuntimeHandle {
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

export interface RemoteControlStackRuntime {
  bot: DiscordBotRuntimeHandle;
  relay: RelayServer;
  stop: () => Promise<void>;
}

export interface RunRemoteControlStackOptions {
  onRelayReady?: (address: string) => void | Promise<void>;
  onStarted?: () => void | Promise<void>;
  onStopping?: (signal: NodeJS.Signals) => void | Promise<void>;
  onStopped?: () => void | Promise<void>;
}

const waitForShutdownSignal = () => {
  return new Promise<NodeJS.Signals>((resolve) => {
    const handleSignal = (signal: NodeJS.Signals) => {
      process.off('SIGINT', handleSignal);
      process.off('SIGTERM', handleSignal);
      resolve(signal);
    };

    process.on('SIGINT', handleSignal);
    process.on('SIGTERM', handleSignal);
  });
};

export const startRemoteControlStack = async () => {
  const relay = await startRelayServer(loadRelayServerOptions());

  try {
    const bot = createDiscordBot(loadDiscordBotConfig());
    await bot.start();

    return {
      bot,
      relay,
      async stop() {
        await bot.stop();
        await relay.stop();
      }
    } satisfies RemoteControlStackRuntime;
  } catch (error) {
    await relay.stop();
    throw error;
  }
};

export const runRemoteControlStack = async (
  options: RunRemoteControlStackOptions = {}
) => {
  const runtime = await startRemoteControlStack();

  await options.onRelayReady?.(runtime.relay.address);
  await options.onStarted?.();

  const signal = await waitForShutdownSignal();
  await options.onStopping?.(signal);

  await runtime.stop();
  await options.onStopped?.();
};
