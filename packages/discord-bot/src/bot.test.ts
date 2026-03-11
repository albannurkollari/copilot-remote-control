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
    expect(
      __testing.parseApprovalCustomId('remoteCopilot:permission:approve:')
    ).toBeNull();
    expect(
      __testing.parsePromptCustomId('remoteCopilot:prompt:cancel:')
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

  it('formats durations across seconds and minute boundaries', () => {
    expect(__testing.formatDuration(500)).toBe('1s');
    expect(__testing.formatDuration(60_000)).toBe('1m');
    expect(__testing.formatDuration(61_000)).toBe('1m 1s');
  });

  it('truncates long text and leaves short text untouched', () => {
    expect(__testing.truncateText('abc', 10)).toBe('abc');
    expect(__testing.truncateText('abcdef', 4)).toBe('abc…');
  });

  it('detects Discord API errors and formats generic errors', () => {
    const apiError = Object.assign(new Error('gone'), { code: 10062 });
    expect(__testing.isDiscordApiError(apiError, 10062)).toBe(true);
    expect(__testing.isDiscordApiError(new Error('gone'), 10062)).toBe(false);
    expect(__testing.toErrorMessage(new Error('boom'))).toBe('boom');
    expect(__testing.toErrorMessage('boom')).toBe('boom');
  });

  it('creates prompt action components with a cancel button', () => {
    const [row] = __testing.createPromptActionComponents('req-1');
    expect(row.toJSON()).toEqual(
      expect.objectContaining({
        components: [
          expect.objectContaining({
            custom_id: 'remoteCopilot:prompt:cancel:req-1',
            label: 'Cancel'
          })
        ]
      })
    );
  });

  it('takes pending approval entries and clears their timeout', () => {
    const timeout = setTimeout(() => undefined, 1000);
    const pending = {
      message: { edit: vi.fn() },
      request: {
        type: 'permission_request',
        action: 'edit_file',
        clientId: 'workspace-1',
        permissionId: 'perm-1',
        requestId: 'req-1',
        title: 'Edit file'
      },
      requesterId: 'user-1',
      resolve: vi.fn(),
      timeout
    };
    const pendingApprovals = new Map([['perm-1', pending as never]]);

    expect(__testing.takePendingApproval(pendingApprovals, 'perm-1')).toBe(
      pending
    );
    expect(pendingApprovals.size).toBe(0);
    expect(__testing.takePendingApproval(pendingApprovals, 'perm-1')).toBe(
      undefined
    );
  });

  it('takes pending prompt entries when present', () => {
    const pending = { cancel: vi.fn(), requesterId: 'user-1' };
    const pendingPrompts = new Map([['req-1', pending as never]]);

    expect(__testing.takePendingPrompt(pendingPrompts, 'req-1')).toBe(pending);
    expect(pendingPrompts.size).toBe(0);
    expect(__testing.takePendingPrompt(pendingPrompts, 'req-1')).toBe(
      undefined
    );
  });

  it('sends ephemeral replies via reply or followUp as needed', async () => {
    const replyInteraction = {
      deferred: false,
      replied: false,
      followUp: vi.fn(),
      reply: vi.fn().mockResolvedValue(undefined)
    } as never;
    const followUpInteraction = {
      deferred: true,
      replied: false,
      followUp: vi.fn().mockResolvedValue(undefined),
      reply: vi.fn()
    } as never;

    await __testing.sendEphemeralResponse(replyInteraction, 'hello');
    expect((replyInteraction as any).reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'hello', flags: 64 })
    );

    await __testing.sendEphemeralResponse(followUpInteraction, 'hello');
    expect((followUpInteraction as any).followUp).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'hello', flags: 64 })
    );
  });
});

describe('BufferedReply', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts by deferring the interaction and showing processing state', async () => {
    const interaction = {
      deferred: false,
      editReply: vi.fn().mockResolvedValue(undefined),
      replied: false,
      deferReply: vi.fn().mockResolvedValue(undefined)
    } as never;

    const reply = new __testing.BufferedReply(interaction, 10);
    await reply.start();

    expect((interaction as any).deferReply).toHaveBeenCalled();
    expect((interaction as any).editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'Processing…', components: [] })
    );
  });

  it('rewrites expired interaction errors to a user-facing message', async () => {
    const interaction = {
      deferred: false,
      editReply: vi.fn(),
      replied: false,
      deferReply: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error('expired'), { code: 10062 }))
    } as never;

    const reply = new __testing.BufferedReply(interaction, 10);

    await expect(reply.start()).rejects.toThrow(
      'Discord no longer recognizes this interaction. The command likely expired before it could be acknowledged.'
    );
  });

  it('schedules flushes, truncates long content, and finalizes once', async () => {
    const interaction = {
      deferred: true,
      editReply: vi.fn().mockResolvedValue(undefined),
      replied: false,
      deferReply: vi.fn()
    } as never;

    const reply = new __testing.BufferedReply(interaction, 10);
    reply.append('a'.repeat(2_000));
    reply.addNote('note');

    await vi.advanceTimersByTimeAsync(10);

    expect((interaction as any).editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('…truncated')
      })
    );

    await reply.finish();
    const callCount = (interaction as any).editReply.mock.calls.length;
    await reply.finish();
    expect((interaction as any).editReply.mock.calls.length).toBe(callCount);
  });

  it('supports flushNow, fail, and clearing components', async () => {
    const interaction = {
      deferred: true,
      editReply: vi.fn().mockResolvedValue(undefined),
      replied: false,
      deferReply: vi.fn()
    } as never;

    const reply = new __testing.BufferedReply(interaction, 10);
    const [row] = __testing.createPromptActionComponents('req-1');
    reply.setComponents([row]);
    reply.clearComponents();
    await reply.flushNow();
    expect((interaction as any).editReply).toHaveBeenCalledWith(
      expect.objectContaining({ components: [] })
    );

    await reply.fail('boom');
    expect((interaction as any).editReply).toHaveBeenLastCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Error: boom')
      })
    );
  });

  it('ignores empty appended text', async () => {
    const interaction = {
      deferred: true,
      editReply: vi.fn().mockResolvedValue(undefined),
      replied: false,
      deferReply: vi.fn()
    } as never;

    const reply = new __testing.BufferedReply(interaction, 10);
    reply.append('');
    await vi.advanceTimersByTimeAsync(10);

    expect((interaction as any).editReply).not.toHaveBeenCalled();
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
        await handlers.onStream?.({
          type: 'copilot_stream',
          clientId: 'workspace-1',
          requestId: 'req-1',
          delta: ' again',
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

  it('falls back to the default update interval and stringifies non-Error failures', async () => {
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
        sendPrompt: vi.fn().mockRejectedValue('boom')
      } as any,
      { targetClientId: 'workspace-1' },
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

  it('records denied permissions and stream errors in the buffered reply', async () => {
    const interaction = {
      channel: { isThread: () => true },
      channelId: 'thread-1',
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
        globalName: null,
        id: 'user-1',
        username: 'alice'
      },
      deferReply: vi.fn().mockResolvedValue(undefined)
    } as any;

    const relayClient = {
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
          level: 'info',
          message: 'connected'
        });
        await handlers.onStream?.({
          type: 'copilot_stream',
          clientId: 'workspace-1',
          requestId: 'req-1',
          done: true,
          error: 'Tool failed'
        });
      })
    } as any;

    await handleCopilotInteraction(
      interaction,
      relayClient,
      { targetClientId: 'workspace-1', updateIntervalMs: 1 },
      vi.fn().mockResolvedValue({ approved: false, reason: 'Denied' }),
      {
        cancelPendingApprovals: vi.fn(),
        registerPendingPrompt: vi.fn(),
        unregisterPendingPrompt: vi.fn()
      }
    );

    expect(relayClient.sendPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'thread-1',
        userDisplayName: 'alice'
      }),
      expect.any(Object)
    );
    expect(relayClient.respondToPermissionRequest).toHaveBeenCalledWith(
      expect.objectContaining({ permissionId: 'perm-1' }),
      false,
      'Denied'
    );
    expect(interaction.editReply).toHaveBeenLastCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Permission request denied: Edit file')
      })
    );
    expect(interaction.editReply).toHaveBeenLastCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Tool failed')
      })
    );
  });
});
