import { __testing, loadDiscordBotConfig } from './bot.ts';

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
});
