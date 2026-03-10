import { type PermissionRequestMessage } from '@remote-copilot/shared';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  REST,
  Routes,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type InteractionReplyOptions,
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
const PROMPT_CUSTOM_ID_PREFIX = 'remoteCopilot:prompt';
const APPROVAL_TIMEOUT_MS = 120_000;
const DEFAULT_APPROVAL_TTL_MS = 30 * 60 * 1000;
const DISCORD_CANCEL_REASON = 'Cancelled from Discord.';

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

interface PendingPrompt {
  cancel: () => Promise<void>;
  requesterId: string;
}

type ApprovalAction = 'approve' | 'approve_ttl' | 'deny';
type PromptAction = 'cancel';

const createApprovalCustomId = (
  permissionId: string,
  action: ApprovalAction
) => {
  return `${APPROVAL_CUSTOM_ID_PREFIX}:${action}:${permissionId}`;
};

const parseApprovalCustomId = (customId: string) => {
  if (!customId.startsWith(`${APPROVAL_CUSTOM_ID_PREFIX}:`)) {
    return null;
  }

  const [, , action, permissionId] = customId.split(':');
  if (
    (action !== 'approve' && action !== 'approve_ttl' && action !== 'deny') ||
    !permissionId ||
    permissionId.trim().length === 0
  ) {
    return null;
  }

  return { action, permissionId } as const;
};

const createPromptCustomId = (requestId: string, action: PromptAction) => {
  return `${PROMPT_CUSTOM_ID_PREFIX}:${action}:${requestId}`;
};

const parsePromptCustomId = (customId: string) => {
  if (!customId.startsWith(`${PROMPT_CUSTOM_ID_PREFIX}:`)) {
    return null;
  }

  const [, , action, requestId] = customId.split(':');
  if (action !== 'cancel' || !requestId || requestId.trim().length === 0) {
    return null;
  }

  return { action, requestId } as const;
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

const formatApprovalTtlLabel = (durationMs: number) => {
  const minutes = Math.max(1, Math.ceil(durationMs / 60_000));
  return `Allow ${minutes} min${minutes === 1 ? '' : 's'}`;
};

const toErrorMessage = (error: unknown) => {
  return error instanceof Error ? error.message : String(error);
};

const logDiscordError = (context: string, error: unknown) => {
  process.stderr.write(`[discord-bot] ${context}: ${toErrorMessage(error)}\n`);
};

const takePendingApproval = (
  pendingApprovals: Map<string, PendingApproval>,
  permissionId: string
) => {
  const pending = pendingApprovals.get(permissionId);
  if (!pending) {
    return undefined;
  }

  clearTimeout(pending.timeout);
  pendingApprovals.delete(permissionId);
  return pending;
};

const sendEphemeralResponse = async (
  interaction: ButtonInteraction | ChatInputCommandInteraction,
  content: string
) => {
  const options: InteractionReplyOptions = {
    content,
    flags: MessageFlags.Ephemeral
  };

  if (interaction.deferred || interaction.replied) {
    await interaction.followUp(options);
    return;
  }

  await interaction.reply(options);
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

const createPromptActionComponents = (requestId: string) => {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(createPromptCustomId(requestId, 'cancel'))
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Danger)
    )
  ];
};

const takePendingPrompt = (
  pendingPrompts: Map<string, PendingPrompt>,
  requestId: string
) => {
  const pending = pendingPrompts.get(requestId);
  if (!pending) {
    return undefined;
  }

  pendingPrompts.delete(requestId);
  return pending;
};

class BufferedReply {
  #buffer = '';
  #components: ActionRowBuilder<ButtonBuilder>[] = [];
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

    await this.interaction.editReply({
      content: 'Processing…',
      components: this.#components
    });
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

  setComponents(components: ActionRowBuilder<ButtonBuilder>[]) {
    this.#components = components;
    this.#dirty = true;
  }

  clearComponents() {
    this.#components = [];
    this.#dirty = true;
  }

  async flushNow() {
    await this.#flush(true);
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

    await this.interaction.editReply({
      content: safeContent,
      components: this.#components
    });
  }
}

export const loadDiscordBotConfig = (): DiscordBotConfig => {
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
  ) => Promise<ApprovalDecision>,
  options: {
    cancelPendingApprovals: (requestId: string, reason: string) => void;
    registerPendingPrompt: (
      pending: PendingPrompt & { requestId: string }
    ) => void;
    unregisterPendingPrompt: (requestId: string) => void;
  }
) => {
  const input = parseCopilotCommand(interaction);
  logOverlay(DISCORD_LABEL, `${interaction.user.username} -> ${input.mode}`);
  logOverlay(CHAT_LABEL, input.prompt);

  const promptMessage = buildCopilotPromptMessage(input, {
    clientId: config.targetClientId,
    channelId: interaction.channelId,
    messageId: interaction.id,
    threadId: interaction.channel?.isThread()
      ? interaction.channelId
      : undefined,
    userDisplayName: interaction.user.globalName ?? interaction.user.username
  });

  const reply = new BufferedReply(
    interaction,
    config.updateIntervalMs ?? 1_200
  );
  reply.setComponents(createPromptActionComponents(promptMessage.requestId));
  await reply.start();

  try {
    let replyLogged = false;

    options.registerPendingPrompt({
      requestId: promptMessage.requestId,
      requesterId: interaction.user.id,
      cancel: async () => {
        options.cancelPendingApprovals(
          promptMessage.requestId,
          DISCORD_CANCEL_REASON
        );
        reply.addNote('Cancellation requested.');
        reply.clearComponents();
        await reply.flushNow();

        const cancelled = await relayClient.cancelPrompt(
          promptMessage.requestId
        );
        if (!cancelled) {
          throw new Error('This request is no longer active.');
        }
      }
    });

    await relayClient.sendPrompt(promptMessage, {
      onPermissionRequest: async (message) => {
        const decision = await requestPermissionApproval(interaction, message);

        if (!decision.approved && decision.reason !== DISCORD_CANCEL_REASON) {
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

    reply.clearComponents();
    await reply.finish();
  } catch (error) {
    reply.clearComponents();
    await reply.fail(error instanceof Error ? error.message : String(error));
  } finally {
    options.unregisterPendingPrompt(promptMessage.requestId);
  }
};

export const createDiscordBot = (config: DiscordBotConfig) => {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  const approvalGrants = new Map<string, ApprovalGrant>();
  const pendingApprovals = new Map<string, PendingApproval>();
  const pendingPrompts = new Map<string, PendingPrompt>();
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
    const cacheKey = createApprovalScopeKey(interaction.user.id, request);
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
            createApprovalCustomId(request.permissionId, 'approve_ttl')
          )
          .setLabel(
            formatApprovalTtlLabel(
              config.approvalTtlMs ?? DEFAULT_APPROVAL_TTL_MS
            )
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
        takePendingApproval(pendingApprovals, request.permissionId);
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

  const cancelPendingApprovals = (requestId: string, reason: string) => {
    for (const [permissionId, pending] of pendingApprovals.entries()) {
      if (pending.request.requestId !== requestId) {
        continue;
      }

      const activePending = takePendingApproval(pendingApprovals, permissionId);
      if (!activePending) {
        continue;
      }

      activePending.resolve({ approved: false, reason });
      void activePending.message.edit({
        content: `${formatPermissionRequest(activePending.request)}\n\nDecision: Cancelled`,
        components: []
      });
    }
  };

  client.once(Events.ClientReady, async () => {
    await registerGuildCommands(config);
    await relayClient.connect();
    logOverlay(DISCORD_LABEL, `Bot ready as ${client.user?.tag ?? 'unknown'}`);
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.isButton()) {
      try {
        const promptAction = parsePromptCustomId(interaction.customId);
        if (promptAction) {
          const pendingPrompt = pendingPrompts.get(promptAction.requestId);
          if (!pendingPrompt) {
            await sendEphemeralResponse(
              interaction,
              'This Copilot request is no longer active.'
            );
            return;
          }

          if (interaction.user.id !== pendingPrompt.requesterId) {
            await sendEphemeralResponse(
              interaction,
              'Only the original requester can cancel this action.'
            );
            return;
          }

          const activePrompt = takePendingPrompt(
            pendingPrompts,
            promptAction.requestId
          );
          if (!activePrompt) {
            await sendEphemeralResponse(
              interaction,
              'This Copilot request is no longer active.'
            );
            return;
          }

          await interaction.deferUpdate();
          await activePrompt.cancel();
          return;
        }

        const parsed = parseApprovalCustomId(interaction.customId);
        if (!parsed) {
          return;
        }

        const pending = pendingApprovals.get(parsed.permissionId);
        if (!pending) {
          await sendEphemeralResponse(
            interaction,
            'This permission request is no longer active.'
          );
          return;
        }

        if (interaction.user.id !== pending.requesterId) {
          await sendEphemeralResponse(
            interaction,
            'Only the original requester can approve or deny this action.'
          );
          return;
        }

        const activePending = takePendingApproval(
          pendingApprovals,
          parsed.permissionId
        );
        if (!activePending) {
          await sendEphemeralResponse(
            interaction,
            'This permission request is no longer active.'
          );
          return;
        }

        const approved =
          parsed.action === 'approve' || parsed.action === 'approve_ttl';
        if (parsed.action === 'approve_ttl') {
          const cacheKey = createApprovalScopeKey(
            interaction.user.id,
            activePending.request
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

        activePending.resolve({ approved, reason });

        await interaction.update({
          content: `${formatPermissionRequest(activePending.request)}\n\nDecision: ${approved ? reason : 'Denied'}`,
          components: []
        });
      } catch (error) {
        logDiscordError('button interaction failed', error);
        await sendEphemeralResponse(
          interaction,
          `Error: ${toErrorMessage(error)}`
        ).catch(() => undefined);
      }
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
      requestPermissionApproval,
      {
        cancelPendingApprovals,
        registerPendingPrompt: ({ requestId, ...pending }) => {
          pendingPrompts.set(requestId, pending);
        },
        unregisterPendingPrompt: (requestId) => {
          pendingPrompts.delete(requestId);
        }
      }
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
      for (const pending of pendingApprovals.values()) {
        clearTimeout(pending.timeout);
        pending.resolve({
          approved: false,
          reason: 'Discord bot stopped before approval was completed.'
        });
      }
      pendingApprovals.clear();
      pendingPrompts.clear();
      await relayClient.disconnect();
      client.destroy();
    }
  };
};

export const __testing = {
  DEFAULT_APPROVAL_TTL_MS,
  createApprovalCustomId,
  createApprovalScopeKey,
  createPromptCustomId,
  formatApprovalTtlLabel,
  formatPermissionRequest,
  parseApprovalCustomId,
  parsePromptCustomId
};
