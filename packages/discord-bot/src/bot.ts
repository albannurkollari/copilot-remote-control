import { type PermissionRequestMessage } from '@remote-copilot/shared';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  ModalBuilder,
  REST,
  Routes,
  TextInputBuilder,
  TextInputStyle,
  type ChatInputCommandInteraction,
  type Message
} from 'discord.js';
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
  approvalPassphrase?: string;
  approvalTtlMs?: number;
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
const APPROVAL_CUSTOM_ID_PREFIX = 'remoteCopilot:permission';
const APPROVAL_MODAL_ID_PREFIX = 'remoteCopilot:passphrase';
const APPROVAL_PASSPHRASE_INPUT_ID = 'approvalPassphrase';
const APPROVAL_TIMEOUT_MS = 120_000;
const DEFAULT_APPROVAL_TTL_MS = 15 * 60 * 1000;

interface ApprovalDecision {
  approved: boolean;
  reason?: string;
}

interface PendingApproval {
  message: Message;
  request: PermissionRequestMessage;
  requesterId: string;
  resolve: (decision: ApprovalDecision) => void;
  timeout: NodeJS.Timeout;
}

interface ApprovalGrant {
  expiresAt: number;
}

const createApprovalCustomId = (
  permissionId: string,
  action: 'approve' | 'approve_session' | 'approve_ttl' | 'deny'
) => {
  return `${APPROVAL_CUSTOM_ID_PREFIX}:${action}:${permissionId}`;
};

const createApprovalModalId = (permissionId: string) => {
  return `${APPROVAL_MODAL_ID_PREFIX}:${permissionId}`;
};

const parseApprovalCustomId = (customId: string) => {
  if (!customId.startsWith(`${APPROVAL_CUSTOM_ID_PREFIX}:`)) {
    return null;
  }

  const [, , action, permissionId] = customId.split(':');
  if (
    (action !== 'approve' &&
      action !== 'approve_session' &&
      action !== 'approve_ttl' &&
      action !== 'deny') ||
    !permissionId ||
    permissionId.trim().length === 0
  ) {
    return null;
  }

  return { action, permissionId } as const;
};

const parseApprovalModalId = (customId: string) => {
  if (!customId.startsWith(`${APPROVAL_MODAL_ID_PREFIX}:`)) {
    return null;
  }

  const [, , permissionId] = customId.split(':');
  if (!permissionId || permissionId.trim().length === 0) {
    return null;
  }

  return { permissionId } as const;
};

const truncateText = (value: string, maxLength: number) => {
  return value.length <= maxLength
    ? value
    : `${value.slice(0, maxLength - 1)}…`;
};

const formatPermissionRequest = (message: PermissionRequestMessage) => {
  const lines = [
    `**Permission request**`,
    `Action: ${message.title}`,
    `Kind: ${message.action}`
  ];

  if (message.command) {
    lines.push(`Command: \`${truncateText(message.command, 120)}\``);
  }

  if (message.details) {
    lines.push(`Details: ${truncateText(message.details, 300)}`);
  }

  return lines.join('\n');
};

const createApprovalScopeKey = (
  requesterId: string,
  request: PermissionRequestMessage
) => {
  return [requesterId, request.clientId, request.action].join(':');
};

const formatDuration = (durationMs: number) => {
  const totalSeconds = Math.max(1, Math.ceil(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes <= 0) {
    return `${seconds}s`;
  }

  if (seconds === 0) {
    return `${minutes}m`;
  }

  return `${minutes}m ${seconds}s`;
};

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
  const approvalPassphrase = process.env.DISCORD_APPROVAL_PASSPHRASE?.trim();
  const token = process.env.DISCORD_TOKEN;
  const applicationId = process.env.DISCORD_APPLICATION_ID;
  const guildId = process.env.DISCORD_GUILD_ID;
  const relayUrl = process.env.RELAY_URL;
  const sharedSecret = process.env.REMOTE_COPILOT_SHARED_SECRET?.trim();
  const targetClientId = process.env.REMOTE_COPILOT_CLIENT_ID;
  const approvalTtlMs = Number.parseInt(
    process.env.DISCORD_APPROVAL_TTL_MS ?? `${DEFAULT_APPROVAL_TTL_MS}`,
    10
  );

  if (
    !token ||
    !applicationId ||
    !guildId ||
    !relayUrl ||
    !targetClientId ||
    !sharedSecret
  ) {
    throw new Error(
      'Missing required Discord bot configuration. Expected DISCORD_TOKEN, DISCORD_APPLICATION_ID, DISCORD_GUILD_ID, RELAY_URL, REMOTE_COPILOT_CLIENT_ID, and REMOTE_COPILOT_SHARED_SECRET.'
    );
  }

  return {
    applicationId,
    approvalPassphrase:
      approvalPassphrase && approvalPassphrase.length > 0
        ? approvalPassphrase
        : undefined,
    approvalTtlMs: Number.isNaN(approvalTtlMs)
      ? DEFAULT_APPROVAL_TTL_MS
      : approvalTtlMs,
    clientId: 'discord-bot',
    guildId,
    relayUrl,
    sharedSecret,
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
  config: Pick<DiscordBotConfig, 'targetClientId' | 'updateIntervalMs'>,
  requestPermissionApproval: (
    interaction: ChatInputCommandInteraction,
    request: PermissionRequestMessage
  ) => Promise<ApprovalDecision>
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
        const decision = await requestPermissionApproval(interaction, message);

        if (!decision.approved) {
          reply.addNote(`Permission request denied: ${message.title}`);
        }

        relayClient.respondToPermissionRequest(
          message,
          decision.approved,
          decision.reason
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
  const sessionApprovalGrants = new Set<string>();
  const approvalGrants = new Map<string, ApprovalGrant>();
  const pendingApprovals = new Map<string, PendingApproval>();
  const relayClient = new RelayDiscordClient({
    clientId: config.clientId,
    relayUrl: config.relayUrl,
    reconnectDelayMs: config.reconnectDelayMs,
    sharedSecret: config.sharedSecret
  });

  const getApprovalGrant = (cacheKey: string) => {
    const grant = approvalGrants.get(cacheKey);
    if (!grant) {
      return undefined;
    }

    if (grant.expiresAt <= Date.now()) {
      approvalGrants.delete(cacheKey);
      return undefined;
    }

    return grant;
  };

  const requestPermissionApproval = async (
    interaction: ChatInputCommandInteraction,
    request: PermissionRequestMessage
  ) => {
    const scopeKey = createApprovalScopeKey(interaction.user.id, request);
    if (sessionApprovalGrants.has(scopeKey)) {
      logOverlay(
        COPILOT_LABEL,
        `Session-approved ${request.title} for ${interaction.user.username}`
      );
      return {
        approved: true,
        reason: 'Approved from Discord for this bot session.'
      };
    }

    const cacheKey = scopeKey;
    const cachedGrant = getApprovalGrant(cacheKey);

    if (cachedGrant) {
      logOverlay(
        COPILOT_LABEL,
        `Auto-approved ${request.title} for ${interaction.user.username} (${formatDuration(cachedGrant.expiresAt - Date.now())} left)`
      );
      return {
        approved: true,
        reason: 'Approved from cached Discord permission.'
      };
    }

    const components = [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(createApprovalCustomId(request.permissionId, 'approve'))
          .setLabel('Approve once')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(
            createApprovalCustomId(request.permissionId, 'approve_session')
          )
          .setLabel('Allow session')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(!config.approvalPassphrase),
        new ButtonBuilder()
          .setCustomId(
            createApprovalCustomId(request.permissionId, 'approve_ttl')
          )
          .setLabel(
            `Approve ${formatDuration(config.approvalTtlMs ?? DEFAULT_APPROVAL_TTL_MS)}`
          )
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(createApprovalCustomId(request.permissionId, 'deny'))
          .setLabel('Deny')
          .setStyle(ButtonStyle.Danger)
      )
    ];

    const approvalMessage = await interaction.followUp({
      content: formatPermissionRequest(request),
      components,
      flags: MessageFlags.Ephemeral
    });

    return await new Promise<ApprovalDecision>((resolve) => {
      const timeout = setTimeout(() => {
        pendingApprovals.delete(request.permissionId);
        void approvalMessage.edit({
          content: `${formatPermissionRequest(request)}\n\nDecision: Timed out`,
          components: []
        });
        resolve({
          approved: false,
          reason: 'Timed out waiting for Discord approval.'
        });
      }, APPROVAL_TIMEOUT_MS);

      pendingApprovals.set(request.permissionId, {
        message: approvalMessage,
        request,
        requesterId: interaction.user.id,
        resolve,
        timeout
      });
    });
  };

  client.once(Events.ClientReady, async () => {
    await registerGuildCommands(config);
    await relayClient.connect();
    logOverlay(DISCORD_LABEL, `Bot ready as ${client.user?.tag ?? 'unknown'}`);
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.isButton()) {
      const parsed = parseApprovalCustomId(interaction.customId);
      if (!parsed) {
        return;
      }

      const pending = pendingApprovals.get(parsed.permissionId);
      if (!pending) {
        await interaction.reply({
          content: 'This permission request is no longer active.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      if (interaction.user.id !== pending.requesterId) {
        await interaction.reply({
          content:
            'Only the original requester can approve or deny this action.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      if (parsed.action === 'approve_session') {
        if (!config.approvalPassphrase) {
          await interaction.reply({
            content: 'Session authorization is not configured for this bot.',
            flags: MessageFlags.Ephemeral
          });
          return;
        }

        await interaction.showModal(
          new ModalBuilder()
            .setCustomId(createApprovalModalId(parsed.permissionId))
            .setTitle('Allow session')
            .addComponents(
              new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                  .setCustomId(APPROVAL_PASSPHRASE_INPUT_ID)
                  .setLabel('Passphrase')
                  .setRequired(true)
                  .setStyle(TextInputStyle.Short)
              )
            )
        );
        return;
      }

      clearTimeout(pending.timeout);
      pendingApprovals.delete(parsed.permissionId);

      const approved =
        parsed.action === 'approve' || parsed.action === 'approve_ttl';
      if (parsed.action === 'approve_ttl') {
        const cacheKey = createApprovalScopeKey(
          interaction.user.id,
          pending.request
        );
        approvalGrants.set(cacheKey, {
          expiresAt:
            Date.now() + (config.approvalTtlMs ?? DEFAULT_APPROVAL_TTL_MS)
        });
      }

      const reason = approved
        ? parsed.action === 'approve_ttl'
          ? `Approved from Discord for ${formatDuration(config.approvalTtlMs ?? DEFAULT_APPROVAL_TTL_MS)}.`
          : 'Approved from Discord.'
        : 'Denied from Discord.';

      await interaction.update({
        content: `${formatPermissionRequest(pending.request)}\n\nDecision: ${approved ? reason : 'Denied'}`,
        components: []
      });

      pending.resolve({ approved, reason });
      return;
    }

    if (interaction.isModalSubmit()) {
      const parsed = parseApprovalModalId(interaction.customId);
      if (!parsed) {
        return;
      }

      const pending = pendingApprovals.get(parsed.permissionId);
      if (!pending) {
        await interaction.reply({
          content: 'This permission request is no longer active.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      if (interaction.user.id !== pending.requesterId) {
        await interaction.reply({
          content: 'Only the original requester can authorize this session.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const submittedPassphrase = interaction.fields.getTextInputValue(
        APPROVAL_PASSPHRASE_INPUT_ID
      );

      if (
        !config.approvalPassphrase ||
        submittedPassphrase !== config.approvalPassphrase
      ) {
        await interaction.reply({
          content: 'Invalid passphrase.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      clearTimeout(pending.timeout);
      pendingApprovals.delete(parsed.permissionId);

      const scopeKey = createApprovalScopeKey(
        interaction.user.id,
        pending.request
      );
      sessionApprovalGrants.add(scopeKey);

      await pending.message.edit({
        content: `${formatPermissionRequest(pending.request)}\n\nDecision: Approved for this bot session`,
        components: []
      });
      await interaction.reply({
        content:
          'Session authorization granted. Matching requests will now auto-approve for this bot session.',
        flags: MessageFlags.Ephemeral
      });

      pending.resolve({
        approved: true,
        reason: 'Approved from Discord for this bot session.'
      });
      return;
    }

    if (
      !interaction.isChatInputCommand() ||
      interaction.commandName !== COPILOT_COMMAND_NAME
    ) {
      return;
    }

    void handleCopilotInteraction(
      interaction,
      relayClient,
      config,
      requestPermissionApproval
    ).catch(async (error) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Discord interaction failed: ${message}\n`);

      if (interaction.deferred || interaction.replied) {
        try {
          await interaction.editReply(`Error: ${message}`);
        } catch {}
        return;
      }

      if (isDiscordApiError(error, 10062)) {
        return;
      }

      try {
        await interaction.reply({ content: `Error: ${message}`, flags: 64 });
      } catch {}
    });
  });

  return {
    client,
    relayClient,
    async start() {
      await client.login(config.token);
    },
    async stop() {
      sessionApprovalGrants.clear();
      for (const pending of pendingApprovals.values()) {
        clearTimeout(pending.timeout);
        pending.resolve({
          approved: false,
          reason: 'Discord bot stopped before approval was completed.'
        });
      }
      pendingApprovals.clear();
      await relayClient.disconnect();
      client.destroy();
    }
  };
};
