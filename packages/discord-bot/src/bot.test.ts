import {
  __testing,
  handleCopilotInteraction,
  loadDiscordBotConfig
} from './bot.ts';

describe('discord bot approval helpers', () => {
  it('uses a 30 minute approval cache by default', () => {
    expect(__testing.DEFAULT_APPROVAL_TTL_MS).toBe(30 * 60 * 1000);
    expect(
      __testing.formatApprovalTtlLabel(__testing.DEFAULT_APPROVAL_TTL_MS)
    ).toBe('Allow 30 mins');
  });

  it('parses supported approval actions and rejects the removed session action', () => {
    const approveCustomId = __testing.createApprovalCustomId(
      'perm-1',
      'approve'
    );
    const ttlCustomId = __testing.createApprovalCustomId(
      'perm-1',
      'approve_ttl'
    );
    const cancelCustomId = __testing.createPromptCustomId('req-1', 'cancel');

    expect(__testing.parseApprovalCustomId(approveCustomId)).toEqual({
      action: 'approve',
      permissionId: 'perm-1'
    });
    expect(__testing.parseApprovalCustomId(ttlCustomId)).toEqual({
      action: 'approve_ttl',
      permissionId: 'perm-1'
    });
    expect(
      __testing.parseApprovalCustomId(
        'remoteCopilot:permission:approve_session:perm-1'
      )
    ).toBeNull();
    expect(__testing.parsePromptCustomId(cancelCustomId)).toEqual({
      action: 'cancel',
      requestId: 'req-1'
    });
    expect(
      __testing.parsePromptCustomId('remoteCopilot:prompt:deny:req-1')
    ).toBeNull();
  });

  it('formats permission requests with truncation', () => {
    const text = __testing.formatPermissionRequest({
      type: 'permission_request',
      action: 'run_terminal_command',
      clientId: 'workspace-1',
      requestId: 'req-1',
      permissionId: 'perm-1',
      title: 'Run terminal command',
      command: 'x'.repeat(200),
      details: 'y'.repeat(350)
    });

    expect(text).toContain('**Permission request**');
    expect(text).toContain('Action: Run terminal command');
    expect(text).toContain('Kind: run_terminal_command');
    expect(text).toContain('Command: `');
    expect(text).toContain('Details: ');
    expect(text).toContain('…');
  });

  it('formats approval scope keys and singular ttl labels', () => {
    expect(
      __testing.createApprovalScopeKey('user-1', {
        type: 'permission_request',
        action: 'edit_file',
        clientId: 'workspace-1',
        permissionId: 'perm-1',
        requestId: 'req-1',
        title: 'Edit file'
      })
    ).toBe('user-1:workspace-1:edit_file');
    expect(__testing.formatApprovalTtlLabel(60_000)).toBe('Allow 1 min');
  });
});

describe('loadDiscordBotConfig', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('defaults the approval ttl to 30 minutes', () => {
    process.env.DISCORD_TOKEN = 'token';
    process.env.DISCORD_APPLICATION_ID = 'app';
    process.env.DISCORD_GUILD_ID = 'guild';
    process.env.RELAY_URL = 'ws://127.0.0.1:8787/';
    process.env.REMOTE_COPILOT_CLIENT_ID = 'default';
    process.env.REMOTE_COPILOT_SHARED_SECRET = 'secret';
    delete process.env.DISCORD_APPROVAL_TTL_MS;

    const config = loadDiscordBotConfig();

    expect(config.approvalTtlMs).toBe(30 * 60 * 1000);
  });

  it('throws when required configuration is missing', () => {
    process.env = {};

    expect(() => loadDiscordBotConfig()).toThrow(
      /Missing required Discord bot configuration/
    );
  });

  it('uses fallback ttl and custom update interval values', () => {
    process.env.DISCORD_TOKEN = 'token';
    process.env.DISCORD_APPLICATION_ID = 'app';
    process.env.DISCORD_GUILD_ID = 'guild';
    process.env.RELAY_URL = 'ws://127.0.0.1:8787/';
    process.env.REMOTE_COPILOT_CLIENT_ID = 'default';
    process.env.REMOTE_COPILOT_SHARED_SECRET = ' secret ';
    process.env.DISCORD_APPROVAL_TTL_MS = 'nope';
    process.env.DISCORD_STREAM_UPDATE_MS = '250';

    const config = loadDiscordBotConfig();

    expect(config.approvalTtlMs).toBe(30 * 60 * 1000);
    expect(config.sharedSecret).toBe('secret');
    expect(config.updateIntervalMs).toBe(250);
  });
});

describe('handleCopilotInteraction', () => {
  it('streams replies, resolves permissions, and unregisters prompts', async () => {
    const interaction = {
      channel: { isThread: () => false },
      channelId: 'channel-1',
      deferred: false,
      editReply: vi.fn().mockResolvedValue(undefined),
      followUp: vi.fn().mockResolvedValue(undefined),
      id: 'message-1',
      options: {
        getString: vi.fn((name: string) => {
          return name === 'mode' ? 'ask' : 'Explain this';
        })
      },
      replied: false,
      user: {
        globalName: 'Alice',
        id: 'user-1',
        username: 'alice'
      },
      deferReply: vi.fn().mockResolvedValue(undefined)
    } as any;
    const relayClient = {
      cancelPrompt: vi.fn().mockResolvedValue(true),
      respondToPermissionRequest: vi.fn(),
      sendPrompt: vi.fn(async (_message, handlers) => {
        await handlers.onPermissionRequest?.({
          type: 'permission_request',
          action: 'edit_file',
          clientId: 'workspace-1',
          permissionId: 'perm-1',
          requestId: 'req-1',
          title: 'Edit file'
        });
        await handlers.onStatus?.({
          type: 'relay_status',
          code: 'client_connected',
          level: 'warning',
          message: 'warn'
        });
        await handlers.onStream?.({
          type: 'copilot_stream',
          clientId: 'workspace-1',
          requestId: 'req-1',
          delta: 'Hello',
          done: false
        });
      })
    } as any;
    const registerPendingPrompt = vi.fn();
    const unregisterPendingPrompt = vi.fn();

    await handleCopilotInteraction(
      interaction,
      relayClient,
      { targetClientId: 'workspace-1', updateIntervalMs: 1 },
      vi.fn().mockResolvedValue({ approved: true }),
      {
        cancelPendingApprovals: vi.fn(),
        registerPendingPrompt,
        unregisterPendingPrompt
      }
    );

    expect(interaction.deferReply).toHaveBeenCalled();
    expect(relayClient.sendPrompt).toHaveBeenCalled();
    expect(relayClient.respondToPermissionRequest).toHaveBeenCalledWith(
      expect.objectContaining({ permissionId: 'perm-1' }),
      true,
      undefined
    );
    expect(registerPendingPrompt).toHaveBeenCalled();
    expect(unregisterPendingPrompt).toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenLastCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Hello') })
    );
  });

  it('reports relay failures in the buffered reply', async () => {
    const interaction = {
      channel: { isThread: () => false },
      channelId: 'channel-1',
      deferred: false,
      editReply: vi.fn().mockResolvedValue(undefined),
      followUp: vi.fn().mockResolvedValue(undefined),
      id: 'message-1',
      options: {
        getString: vi.fn((name: string) => {
          return name === 'mode' ? 'ask' : 'Explain this';
        })
      },
      replied: false,
      user: {
        globalName: 'Alice',
        id: 'user-1',
        username: 'alice'
      },
      deferReply: vi.fn().mockResolvedValue(undefined)
    } as any;

    await handleCopilotInteraction(
      interaction,
      {
        sendPrompt: vi.fn().mockRejectedValue(new Error('boom'))
      } as any,
      { targetClientId: 'workspace-1', updateIntervalMs: 1 },
      vi.fn(),
      {
        cancelPendingApprovals: vi.fn(),
        registerPendingPrompt: vi.fn(),
        unregisterPendingPrompt: vi.fn()
      }
    );

    expect(interaction.editReply).toHaveBeenLastCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Error: boom')
      })
    );
  });
});
