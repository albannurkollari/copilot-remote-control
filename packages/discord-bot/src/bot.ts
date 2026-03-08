import {
  Client,
  Events,
  GatewayIntentBits,
  REST,
  Routes,
  type ChatInputCommandInteraction
} from 'discord.js';
import {
  buildCopilotPromptMessage,
  COPILOT_COMMAND_NAME,
  createCopilotCommand,
  parseCopilotCommand
} from './commands/copilot.js';
import {
  RelayDiscordClient,
  type RelayDiscordClientOptions
} from './relayClient.js';

export interface DiscordBotConfig extends RelayDiscordClientOptions {
  applicationId: string;
  guildId: string;
  token: string;
  targetClientId: string;
  updateIntervalMs?: number;
}

class BufferedReply {
  #buffer = '';
  #dirty = false;
  #finalized = false;
  #flushTimer?: NodeJS.Timeout;
  #notes: string[] = [];

  constructor(
    private readonly interaction: ChatInputCommandInteraction,
    private readonly updateIntervalMs: number
  ) {}

  async start() {
    await this.interaction.deferReply();
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
    process.stdout.write(
      `Discord bot ready as ${client.user?.tag ?? 'unknown'}\n`
    );
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (
      !interaction.isChatInputCommand() ||
      interaction.commandName !== COPILOT_COMMAND_NAME
    ) {
      return;
    }

    await handleCopilotInteraction(interaction, relayClient, config);
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

if (import.meta.url === new URL(process.argv[1] ?? '', 'file:').href) {
  const bot = createDiscordBot(loadDiscordBotConfig());
  await bot.start();
}
