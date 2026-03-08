import {
  Client,
  Events,
  GatewayIntentBits,
  REST,
  Routes,
  type ChatInputCommandInteraction
} from 'discord.js';
import { pathToFileURL } from 'node:url';
import pc from 'picocolors';
import {
  buildCopilotPromptMessage,
  COPILOT_COMMAND_NAME,
  createCopilotCommand,
  parseCopilotCommand
} from './commands/copilot.ts';
import {
  RelayDiscordClient,
  type RelayDiscordClientOptions
} from './relayClient.ts';

export interface DiscordBotConfig extends RelayDiscordClientOptions {
  applicationId: string;
  guildId: string;
  token: string;
  targetClientId: string;
  updateIntervalMs?: number;
}

const isDiscordApiError = (
  error: unknown,
  code: number
): error is Error & { code: number } => {
  return error instanceof Error && 'code' in error && error.code === code;
};

const logOverlay = (label: string, message: string) => {
  process.stdout.write(`${label} ${message}\n`);
};

const DISCORD_LABEL = pc.bold(pc.cyan('Discord:'));
const COPILOT_LABEL = pc.bold(pc.magenta('Copilot:'));
const CHAT_LABEL = pc.bold(pc.green('Chat:'));

class BufferedReply {
  #buffer = '';
  #dirty = false;
  #finalized = false;
  #flushTimer?: NodeJS.Timeout;
  #notes: string[] = [];
  readonly interaction: ChatInputCommandInteraction;
  readonly updateIntervalMs: number;

  constructor(
    interaction: ChatInputCommandInteraction,
    updateIntervalMs: number
  ) {
    this.interaction = interaction;
    this.updateIntervalMs = updateIntervalMs;
  }

  async start() {
    if (!this.interaction.deferred && !this.interaction.replied) {
      try {
        await this.interaction.deferReply();
      } catch (error) {
        if (isDiscordApiError(error, 10062)) {
          throw new Error(
            'Discord no longer recognizes this interaction. The command likely expired before it could be acknowledged.'
          );
        }

        throw error;
      }
    }

    await this.interaction.editReply('Processing…');
  }

  append(text: string) {
    if (!text) {
      return;
    }

    this.#buffer += text;
    this.#dirty = true;
    this.#scheduleFlush();
  }

  addNote(note: string) {
    this.#notes.push(note);
    this.#dirty = true;
    this.#scheduleFlush();
  }

  async fail(message: string) {
    this.addNote(`Error: ${message}`);
    await this.finish();
  }

  async finish() {
    if (this.#finalized) {
      return;
    }

    this.#finalized = true;
    if (this.#flushTimer) {
      clearTimeout(this.#flushTimer);
      this.#flushTimer = undefined;
    }

    await this.#flush(true);
  }

  #scheduleFlush() {
    if (this.#flushTimer || this.#finalized) {
      return;
    }

    this.#flushTimer = setTimeout(() => {
      void this.#flush();
    }, this.updateIntervalMs);
  }

  async #flush(force = false) {
    if (!force && !this.#dirty) {
      this.#flushTimer = undefined;
      return;
    }

    this.#dirty = false;
    this.#flushTimer = undefined;

    const notes =
      this.#notes.length > 0
        ? `\n\n${this.#notes.map((note) => `• ${note}`).join('\n')}`
        : '';
    const body = this.#buffer.trim().length > 0 ? this.#buffer : 'Processing…';
    const content = `${body}${notes}`;
    const safeContent =
      content.length > 1_950
        ? `${content.slice(0, 1_930)}\n\n…truncated`
        : content;

    await this.interaction.editReply(safeContent);
  }
}

export const loadDiscordBotConfig = (): DiscordBotConfig => {
  const token = process.env.DISCORD_TOKEN;
  const applicationId = process.env.DISCORD_APPLICATION_ID;
  const guildId = process.env.DISCORD_GUILD_ID;
  const relayUrl = process.env.RELAY_URL;
  const targetClientId = process.env.REMOTE_COPILOT_CLIENT_ID;

  if (!token || !applicationId || !guildId || !relayUrl || !targetClientId) {
    throw new Error(
      'Missing required Discord bot configuration. Expected DISCORD_TOKEN, DISCORD_APPLICATION_ID, DISCORD_GUILD_ID, RELAY_URL, and REMOTE_COPILOT_CLIENT_ID.'
    );
  }

  return {
    applicationId,
    clientId: 'discord-bot',
    guildId,
    relayUrl,
    targetClientId,
    token,
    updateIntervalMs: Number.parseInt(
      process.env.DISCORD_STREAM_UPDATE_MS ?? '1200',
      10
    )
  };
};

export const registerGuildCommands = async (
  config: Pick<DiscordBotConfig, 'applicationId' | 'guildId' | 'token'>
) => {
  const rest = new REST({ version: '10' }).setToken(config.token);
  await rest.put(
    Routes.applicationGuildCommands(config.applicationId, config.guildId),
    {
      body: [createCopilotCommand().toJSON()]
    }
  );
};

export const handleCopilotInteraction = async (
  interaction: ChatInputCommandInteraction,
  relayClient: RelayDiscordClient,
  config: Pick<DiscordBotConfig, 'targetClientId' | 'updateIntervalMs'>
) => {
  const input = parseCopilotCommand(interaction);
  logOverlay(DISCORD_LABEL, `${interaction.user.username} -> ${input.mode}`);
  logOverlay(CHAT_LABEL, input.prompt);

  const reply = new BufferedReply(
    interaction,
    config.updateIntervalMs ?? 1_200
  );
  await reply.start();

  const promptMessage = buildCopilotPromptMessage(input, {
    clientId: config.targetClientId,
    channelId: interaction.channelId,
    messageId: interaction.id,
    threadId: interaction.channel?.isThread()
      ? interaction.channelId
      : undefined,
    userDisplayName: interaction.user.globalName ?? interaction.user.username
  });

  try {
    let replyLogged = false;

    await relayClient.sendPrompt(promptMessage, {
      onPermissionRequest: async (message) => {
        reply.addNote(`Permission request denied: ${message.title}`);
        relayClient.respondToPermissionRequest(
          message,
          false,
          'Remote approval is not implemented yet.'
        );
      },
      onStatus: async (message) => {
        if (message.level !== 'info') {
          reply.addNote(`Relay ${message.level}: ${message.message}`);
        }
      },
      onStream: async (message) => {
        if (message.delta) {
          if (!replyLogged) {
            logOverlay(COPILOT_LABEL, 'Replies');
            replyLogged = true;
          }

          reply.append(message.delta);
        }

        if (message.error) {
          reply.addNote(message.error);
        }
      }
    });

    await reply.finish();
  } catch (error) {
    await reply.fail(error instanceof Error ? error.message : String(error));
  }
};

export const createDiscordBot = (config: DiscordBotConfig) => {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  const relayClient = new RelayDiscordClient({
    clientId: config.clientId,
    relayUrl: config.relayUrl,
    reconnectDelayMs: config.reconnectDelayMs
  });

  client.once(Events.ClientReady, async () => {
    await registerGuildCommands(config);
    await relayClient.connect();
    logOverlay(DISCORD_LABEL, `Bot ready as ${client.user?.tag ?? 'unknown'}`);
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (
      !interaction.isChatInputCommand() ||
      interaction.commandName !== COPILOT_COMMAND_NAME
    ) {
      return;
    }

    void handleCopilotInteraction(interaction, relayClient, config).catch(
      async (error) => {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`Discord interaction failed: ${message}\n`);

        if (interaction.deferred || interaction.replied) {
          try {
            await interaction.editReply(`Error: ${message}`);
          } catch {
          }
          return;
        }

        if (isDiscordApiError(error, 10062)) {
          return;
        }

        try {
          await interaction.reply({ content: `Error: ${message}`, flags: 64 });
        } catch {
        }
      }
    );
  });

  return {
    client,
    relayClient,
    async start() {
      await client.login(config.token);
    },
    async stop() {
      await relayClient.disconnect();
      client.destroy();
    }
  };
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const bot = createDiscordBot(loadDiscordBotConfig());
  await bot.start();
}
