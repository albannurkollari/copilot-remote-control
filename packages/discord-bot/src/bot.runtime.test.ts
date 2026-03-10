import { beforeEach, describe, expect, it, vi } from 'vitest';

const clientInstances = vi.hoisted(() => [] as any[]);
const relayInstances = vi.hoisted(() => [] as any[]);
const restCalls = vi.hoisted(
  () => [] as Array<{ route: string; body: unknown }>
);

vi.mock('discord.js', () => {
  class MockSlashCommandStringOption {
    data: Record<string, unknown> = {};

    setName(name: string) {
      this.data.name = name;
      return this;
    }

    setDescription(description: string) {
      this.data.description = description;
      return this;
    }

    setRequired(required: boolean) {
      this.data.required = required;
      return this;
    }

    addChoices(...choices: Array<{ name: string; value: string }>) {
      this.data.choices = choices;
      return this;
    }

    setMinLength(minLength: number) {
      this.data.minLength = minLength;
      return this;
    }

    setMaxLength(maxLength: number) {
      this.data.maxLength = maxLength;
      return this;
    }

    toJSON() {
      return { ...this.data };
    }
  }

  class SlashCommandBuilder {
    data: Record<string, unknown> = { options: [] as unknown[] };

    setName(name: string) {
      this.data.name = name;
      return this;
    }

    setDescription(description: string) {
      this.data.description = description;
      return this;
    }

    addStringOption(
      builder: (option: MockSlashCommandStringOption) => unknown
    ) {
      const option = new MockSlashCommandStringOption();
      builder(option);
      (this.data.options as unknown[]).push(option.toJSON());
      return this;
    }

    toJSON() {
      return { ...this.data };
    }
  }

  class ButtonBuilder {
    data: Record<string, unknown> = {};

    setCustomId(customId: string) {
      this.data.custom_id = customId;
      return this;
    }

    setLabel(label: string) {
      this.data.label = label;
      return this;
    }

    setStyle(style: number) {
      this.data.style = style;
      return this;
    }

    toJSON() {
      return { ...this.data };
    }
  }

  class ActionRowBuilder<T extends { toJSON(): unknown }> {
    components: T[] = [];

    addComponents(...components: T[]) {
      this.components.push(...components);
      return this;
    }

    toJSON() {
      return {
        components: this.components.map((component) => component.toJSON())
      };
    }
  }

  class Client {
    handlers = new Map<string, Array<(...args: unknown[]) => unknown>>();
    destroy = vi.fn();
    login = vi.fn().mockResolvedValue('token');
    user = { tag: 'bot#1' };

    constructor(public options: unknown) {
      clientInstances.push(this);
    }

    once(event: string, handler: (...args: unknown[]) => unknown) {
      const onceHandler = (...args: unknown[]) => {
        this.off(event, onceHandler);
        return handler(...args);
      };
      return this.on(event, onceHandler);
    }

    on(event: string, handler: (...args: unknown[]) => unknown) {
      const handlers = this.handlers.get(event) ?? [];
      handlers.push(handler);
      this.handlers.set(event, handlers);
      return this;
    }

    off(event: string, handler: (...args: unknown[]) => unknown) {
      this.handlers.set(
        event,
        (this.handlers.get(event) ?? []).filter(
          (candidate) => candidate !== handler
        )
      );
      return this;
    }

    async emitAsync(event: string, ...args: unknown[]) {
      for (const handler of this.handlers.get(event) ?? []) {
        await handler(...args);
      }
    }
  }

  class REST {
    token?: string;

    constructor(_options: unknown) {}

    setToken(token: string) {
      this.token = token;
      return this;
    }

    async put(route: string, options: { body: unknown }) {
      restCalls.push({ route, body: options.body });
      return undefined;
    }
  }

  return {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle: {
      Danger: 4,
      Primary: 1,
      Success: 3
    },
    Client,
    Events: {
      ClientReady: 'ready',
      InteractionCreate: 'interactionCreate'
    },
    GatewayIntentBits: {
      Guilds: 1
    },
    MessageFlags: {
      Ephemeral: 64
    },
    REST,
    Routes: {
      applicationGuildCommands: (applicationId: string, guildId: string) => {
        return `route:${applicationId}:${guildId}`;
      }
    },
    SlashCommandBuilder
  };
});

vi.mock('./relayClient.ts', () => ({
  RelayDiscordClient: class MockRelayDiscordClient {
    cancelPrompt = vi.fn().mockResolvedValue(true);
    connect = vi.fn().mockResolvedValue(undefined);
    disconnect = vi.fn().mockResolvedValue(undefined);
    respondToPermissionRequest = vi.fn();
    sendPrompt = vi.fn().mockResolvedValue(undefined);

    constructor(public options: unknown) {
      relayInstances.push(this);
    }
  }
}));

import { __testing, createDiscordBot, registerGuildCommands } from './bot.ts';

const createChatInteraction = () => {
  return {
    channel: { isThread: () => false },
    channelId: 'channel-1',
    commandName: 'copilot',
    deferred: false,
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    followUp: vi.fn().mockResolvedValue({
      edit: vi.fn().mockResolvedValue(undefined)
    }),
    id: 'msg-1',
    isButton: () => false,
    isChatInputCommand: () => true,
    options: {
      getString: vi.fn((name: string) => {
        return name === 'mode' ? 'ask' : 'Explain this';
      })
    },
    replied: false,
    reply: vi.fn().mockResolvedValue(undefined),
    user: {
      globalName: 'Alice',
      id: 'user-1',
      username: 'alice'
    }
  } as any;
};

const createButtonInteraction = (customId: string, userId = 'user-1') => {
  return {
    customId,
    deferred: false,
    deferUpdate: vi.fn().mockResolvedValue(undefined),
    followUp: vi.fn().mockResolvedValue(undefined),
    isButton: () => true,
    isChatInputCommand: () => false,
    replied: false,
    reply: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
    user: { id: userId }
  } as any;
};

describe('discord bot runtime flows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clientInstances.length = 0;
    relayInstances.length = 0;
    restCalls.length = 0;
  });

  it('registers guild commands through the Discord REST API', async () => {
    await registerGuildCommands({
      applicationId: 'app-1',
      guildId: 'guild-1',
      token: 'token'
    });

    expect(restCalls).toEqual([
      {
        route: 'route:app-1:guild-1',
        body: [
          expect.objectContaining({
            name: 'copilot'
          })
        ]
      }
    ]);
  });

  it('starts the client and connects the relay on ready', async () => {
    const bot = createDiscordBot({
      applicationId: 'app-1',
      clientId: 'discord-bot',
      guildId: 'guild-1',
      relayUrl: 'ws://relay.test',
      sharedSecret: 'secret',
      targetClientId: 'workspace-1',
      token: 'token'
    });

    await bot.start();
    expect(clientInstances[0].login).toHaveBeenCalledWith('token');

    await clientInstances[0].emitAsync('ready');
    expect(relayInstances[0].connect).toHaveBeenCalled();
    expect(restCalls).toHaveLength(1);
  });

  it('cancels a pending prompt from the original requester', async () => {
    const bot = createDiscordBot({
      applicationId: 'app-1',
      clientId: 'discord-bot',
      guildId: 'guild-1',
      relayUrl: 'ws://relay.test',
      sharedSecret: 'secret',
      targetClientId: 'workspace-1',
      token: 'token',
      updateIntervalMs: 1
    });
    const relay = relayInstances[0];
    const pending = new Promise<void>(() => undefined);
    relay.sendPrompt.mockReturnValue(pending);

    const interaction = createChatInteraction();
    await clientInstances[0].emitAsync('interactionCreate', interaction);
    await vi.waitFor(() => {
      expect(relay.sendPrompt).toHaveBeenCalledTimes(1);
    });
    const requestId = relay.sendPrompt.mock.calls[0][0].requestId;
    const cancelInteraction = createButtonInteraction(
      `remoteCopilot:prompt:cancel:${requestId}`
    );

    await clientInstances[0].emitAsync('interactionCreate', cancelInteraction);

    expect(cancelInteraction.deferUpdate).toHaveBeenCalled();
    expect(relay.cancelPrompt).toHaveBeenCalledWith(requestId);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Cancellation requested.')
      })
    );
    void bot;
  });

  it('approves a permission request and reuses ttl approval cache', async () => {
    const bot = createDiscordBot({
      applicationId: 'app-1',
      approvalTtlMs: 60_000,
      clientId: 'discord-bot',
      guildId: 'guild-1',
      relayUrl: 'ws://relay.test',
      sharedSecret: 'secret',
      targetClientId: 'workspace-1',
      token: 'token',
      updateIntervalMs: 1
    });
    const relay = relayInstances[0];
    relay.sendPrompt.mockImplementation(
      async (_message: any, handlers: any) => {
        await handlers.onPermissionRequest({
          type: 'permission_request',
          action: 'edit_file',
          clientId: 'workspace-1',
          permissionId: 'perm-1',
          requestId: 'req-1',
          title: 'Edit file'
        });
      }
    );

    const firstInteraction = createChatInteraction();
    void clientInstances[0].emitAsync('interactionCreate', firstInteraction);
    await vi.waitFor(() => {
      expect(firstInteraction.followUp).toHaveBeenCalledTimes(1);
    });

    const approveInteraction = createButtonInteraction(
      'remoteCopilot:permission:approve_ttl:perm-1'
    );
    await clientInstances[0].emitAsync('interactionCreate', approveInteraction);
    await vi.waitFor(() => {
      expect(relay.respondToPermissionRequest).toHaveBeenCalledWith(
        expect.objectContaining({ permissionId: 'perm-1' }),
        true,
        'Approved from Discord for 1m.'
      );
    });

    expect(approveInteraction.update).toHaveBeenCalled();

    const secondInteraction = createChatInteraction();
    await clientInstances[0].emitAsync('interactionCreate', secondInteraction);

    await vi.waitFor(() => {
      expect(relay.respondToPermissionRequest).toHaveBeenCalledWith(
        expect.objectContaining({ permissionId: 'perm-1' }),
        true,
        'Approved from cached Discord permission.'
      );
    });
    expect(secondInteraction.followUp).not.toHaveBeenCalled();
    void bot;
  });

  it('times out unanswered permission requests', async () => {
    vi.useFakeTimers();
    try {
      const bot = createDiscordBot({
        applicationId: 'app-1',
        clientId: 'discord-bot',
        guildId: 'guild-1',
        relayUrl: 'ws://relay.test',
        sharedSecret: 'secret',
        targetClientId: 'workspace-1',
        token: 'token',
        updateIntervalMs: 1
      });
      const relay = relayInstances[0];
      relay.sendPrompt.mockImplementation(
        async (_message: any, handlers: any) => {
          await handlers.onPermissionRequest({
            type: 'permission_request',
            action: 'edit_file',
            clientId: 'workspace-1',
            permissionId: 'perm-timeout',
            requestId: 'req-timeout',
            title: 'Edit file'
          });
        }
      );

      const approvalMessage = { edit: vi.fn().mockResolvedValue(undefined) };
      const interaction = createChatInteraction();
      interaction.followUp.mockResolvedValue(approvalMessage);

      void clientInstances[0].emitAsync('interactionCreate', interaction);
      await vi.waitFor(() => {
        expect(interaction.followUp).toHaveBeenCalledTimes(1);
      });

      await vi.advanceTimersByTimeAsync(__testing.APPROVAL_TIMEOUT_MS);

      await vi.waitFor(() => {
        expect(relay.respondToPermissionRequest).toHaveBeenCalledWith(
          expect.objectContaining({ permissionId: 'perm-timeout' }),
          false,
          'Timed out waiting for Discord approval.'
        );
      });
      expect(approvalMessage.edit).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Decision: Timed out'),
          components: []
        })
      );
      void bot;
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects prompt cancellation from other users', async () => {
    createDiscordBot({
      applicationId: 'app-1',
      clientId: 'discord-bot',
      guildId: 'guild-1',
      relayUrl: 'ws://relay.test',
      sharedSecret: 'secret',
      targetClientId: 'workspace-1',
      token: 'token',
      updateIntervalMs: 1
    });
    const relay = relayInstances[0];
    relay.sendPrompt.mockReturnValue(new Promise<void>(() => undefined));

    const interaction = createChatInteraction();
    await clientInstances[0].emitAsync('interactionCreate', interaction);
    await vi.waitFor(() => {
      expect(relay.sendPrompt).toHaveBeenCalledTimes(1);
    });

    const requestId = relay.sendPrompt.mock.calls[0][0].requestId;
    const wrongUserButton = createButtonInteraction(
      `remoteCopilot:prompt:cancel:${requestId}`,
      'other-user'
    );
    await clientInstances[0].emitAsync('interactionCreate', wrongUserButton);

    expect(wrongUserButton.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Only the original requester can cancel this action.',
        flags: 64
      })
    );
  });

  it('reports inactive prompt cancellation requests', async () => {
    createDiscordBot({
      applicationId: 'app-1',
      clientId: 'discord-bot',
      guildId: 'guild-1',
      relayUrl: 'ws://relay.test',
      sharedSecret: 'secret',
      targetClientId: 'workspace-1',
      token: 'token',
      updateIntervalMs: 1
    });

    const button = createButtonInteraction(
      'remoteCopilot:prompt:cancel:missing'
    );
    await clientInstances[0].emitAsync('interactionCreate', button);

    expect(button.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'This Copilot request is no longer active.',
        flags: 64
      })
    );
  });

  it('rejects button actions from other users and stops cleanly', async () => {
    const bot = createDiscordBot({
      applicationId: 'app-1',
      clientId: 'discord-bot',
      guildId: 'guild-1',
      relayUrl: 'ws://relay.test',
      sharedSecret: 'secret',
      targetClientId: 'workspace-1',
      token: 'token',
      updateIntervalMs: 1
    });
    const relay = relayInstances[0];
    relay.sendPrompt.mockImplementation(
      async (_message: any, handlers: any) => {
        await handlers.onPermissionRequest({
          type: 'permission_request',
          action: 'edit_file',
          clientId: 'workspace-1',
          permissionId: 'perm-1',
          requestId: 'req-1',
          title: 'Edit file'
        });
      }
    );

    const interaction = createChatInteraction();
    void clientInstances[0].emitAsync('interactionCreate', interaction);
    await vi.waitFor(() => {
      expect(interaction.followUp).toHaveBeenCalledTimes(1);
    });

    const wrongUserButton = createButtonInteraction(
      'remoteCopilot:permission:deny:perm-1',
      'other-user'
    );
    await clientInstances[0].emitAsync('interactionCreate', wrongUserButton);

    expect(wrongUserButton.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Only the original requester can approve or deny this action.',
        flags: 64
      })
    );

    await bot.stop();
    expect(relay.disconnect).toHaveBeenCalled();
    expect(clientInstances[0].destroy).toHaveBeenCalled();
  });
});
