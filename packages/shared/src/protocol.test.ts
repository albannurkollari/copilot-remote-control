import {
  createPermissionId,
  createPingMessage,
  createPongMessage,
  createRequestId,
  isRelayMessage,
  parseRelayMessage,
  serializeRelayMessage,
  type CopilotPromptMessage,
  type RegisterMessage
} from './protocol.ts';

describe('protocol helpers', () => {
  it('parses valid prompt messages', () => {
    const message: CopilotPromptMessage = {
      type: 'copilot_prompt',
      clientId: 'workspace-1',
      requestId: createRequestId(),
      mode: 'ask',
      prompt: 'Explain this function'
    };

    const result = parseRelayMessage(serializeRelayMessage(message));

    expect(result.ok).toBe(true);
    expect(result.ok && result.value).toEqual(message);
    expect(isRelayMessage(message)).toBe(true);
  });

  it('rejects malformed JSON', () => {
    const result = parseRelayMessage('{nope');

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error).toContain('valid JSON');
  });

  it('rejects unsupported message types', () => {
    const result = parseRelayMessage({ type: 'unknown' });

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error).toContain('Unsupported');
  });

  it('rejects non-object payloads and invalid required fields', () => {
    expect(parseRelayMessage(null)).toEqual({
      ok: false,
      error: 'Message must be an object with a string type.'
    });

    expect(
      parseRelayMessage({
        type: 'register',
        clientId: 'workspace-1',
        clientRole: 'vscode',
        sharedSecret: ''
      })
    ).toEqual({
      ok: false,
      error:
        'Register messages require clientRole, clientId, and an optional non-empty sharedSecret.'
    });

    expect(
      parseRelayMessage({
        type: 'copilot_prompt',
        clientId: 'workspace-1',
        requestId: 'req-1',
        mode: 'other',
        prompt: 'Hello'
      })
    ).toEqual({
      ok: false,
      error:
        'Copilot prompt messages require clientId, requestId, mode, and prompt.'
    });

    expect(
      parseRelayMessage({
        type: 'permission_request',
        clientId: 'workspace-1',
        requestId: 'req-1',
        permissionId: 'perm-1',
        action: 'invalid',
        title: 'Edit file'
      })
    ).toEqual({
      ok: false,
      error:
        'Permission request messages require clientId, requestId, permissionId, action, and title.'
    });

    expect(
      parseRelayMessage({
        type: 'permission_response',
        clientId: 'workspace-1',
        requestId: 'req-1',
        permissionId: 'perm-1',
        approved: 'yes'
      })
    ).toEqual({
      ok: false,
      error:
        'Permission response messages require clientId, requestId, permissionId, and approved.'
    });
  });

  it('creates stable request and permission identifiers', () => {
    expect(createRequestId()).toMatch(/^req_/u);
    expect(createPermissionId()).toMatch(/^perm_/u);
  });

  it('parses register messages with an optional shared secret', () => {
    const message: RegisterMessage = {
      type: 'register',
      clientId: 'workspace-1',
      clientRole: 'vscode',
      sharedSecret: 'super-secret'
    };

    const result = parseRelayMessage(serializeRelayMessage(message));

    expect(result.ok).toBe(true);
    expect(result.ok && result.value).toEqual(message);
  });

  it('parses and validates all other supported relay message types', () => {
    const messages = [
      {
        type: 'register_ack',
        clientId: 'workspace-1',
        clientRole: 'vscode',
        connectionId: 'conn-1'
      },
      {
        type: 'relay_status',
        code: 'request_failed',
        level: 'warning',
        message: 'Failed',
        requestId: 'req-1',
        clientId: 'workspace-1',
        targetClientRole: 'discord'
      },
      {
        type: 'copilot_cancel',
        clientId: 'workspace-1',
        requestId: 'req-1'
      },
      {
        type: 'copilot_stream',
        clientId: 'workspace-1',
        requestId: 'req-1',
        done: false,
        delta: 'Hello',
        modelId: 'copilot-auto'
      },
      {
        type: 'permission_request',
        clientId: 'workspace-1',
        requestId: 'req-1',
        permissionId: 'perm-1',
        action: 'edit_file',
        title: 'Edit file',
        details: 'details',
        command: 'echo hi'
      },
      {
        type: 'permission_response',
        clientId: 'workspace-1',
        requestId: 'req-1',
        permissionId: 'perm-1',
        approved: true,
        reason: 'ok'
      },
      {
        type: 'ping',
        timestamp: '2026-03-10T00:00:00.000Z'
      },
      {
        type: 'pong',
        timestamp: '2026-03-10T00:00:00.000Z'
      }
    ] as const;

    for (const message of messages) {
      const result = parseRelayMessage(serializeRelayMessage(message as never));
      expect(result.ok).toBe(true);
      expect(result.ok && result.value).toEqual(message);
    }
  });

  it('preserves optional fields when present and omits invalid optional values', () => {
    expect(
      parseRelayMessage({
        type: 'copilot_prompt',
        clientId: 'workspace-1',
        requestId: 'req-1',
        mode: 'ask',
        prompt: 'Hello',
        userDisplayName: 'alice',
        channelId: 'channel-1',
        threadId: 'thread-1',
        messageId: 'message-1'
      })
    ).toEqual({
      ok: true,
      value: {
        type: 'copilot_prompt',
        clientId: 'workspace-1',
        requestId: 'req-1',
        mode: 'ask',
        prompt: 'Hello',
        userDisplayName: 'alice',
        channelId: 'channel-1',
        threadId: 'thread-1',
        messageId: 'message-1'
      }
    });

    expect(
      parseRelayMessage({
        type: 'relay_status',
        code: 'request_failed',
        level: 'warning',
        message: 'Failed',
        requestId: 1,
        clientId: 2,
        targetClientRole: 3
      })
    ).toEqual({
      ok: false,
      error: 'Relay status requestId must be a non-empty string.'
    });

    expect(
      parseRelayMessage({
        type: 'permission_request',
        clientId: 'workspace-1',
        requestId: 'req-1',
        permissionId: 'perm-1',
        action: 'edit_file',
        title: 'Edit file'
      })
    ).toEqual({
      ok: true,
      value: {
        type: 'permission_request',
        clientId: 'workspace-1',
        requestId: 'req-1',
        permissionId: 'perm-1',
        action: 'edit_file',
        title: 'Edit file',
        details: undefined,
        command: undefined
      }
    });

    expect(
      parseRelayMessage({
        type: 'permission_response',
        clientId: 'workspace-1',
        requestId: 'req-1',
        permissionId: 'perm-1',
        approved: false
      })
    ).toEqual({
      ok: true,
      value: {
        type: 'permission_response',
        clientId: 'workspace-1',
        requestId: 'req-1',
        permissionId: 'perm-1',
        approved: false,
        reason: undefined
      }
    });
  });

  it('accepts the authorization status code and rejects invalid stream payloads', () => {
    expect(
      parseRelayMessage({
        type: 'relay_status',
        code: 'authorization_required',
        level: 'error',
        message: 'Need a secret.'
      })
    ).toEqual({
      ok: true,
      value: {
        type: 'relay_status',
        code: 'authorization_required',
        level: 'error',
        message: 'Need a secret.',
        requestId: undefined,
        clientId: undefined,
        targetClientRole: undefined
      }
    });

    expect(
      parseRelayMessage({
        type: 'copilot_stream',
        clientId: 'workspace-1',
        requestId: 'req-1',
        done: 'nope'
      })
    ).toEqual({
      ok: false,
      error: 'Copilot stream messages require clientId, requestId, and done.'
    });
  });

  it('rejects invalid fields for supported message types', () => {
    expect(
      parseRelayMessage({
        type: 'register_ack',
        clientId: 'workspace-1',
        clientRole: 'vscode'
      })
    ).toEqual({
      ok: false,
      error:
        'Register acknowledgement messages require clientRole, clientId, and connectionId.'
    });

    expect(
      parseRelayMessage({
        type: 'relay_status',
        code: 'request_failed',
        level: 'warning',
        message: ''
      })
    ).toEqual({
      ok: false,
      error: 'Relay status messages require level, code, and message.'
    });

    expect(
      parseRelayMessage({
        type: 'relay_status',
        code: 'request_failed',
        level: 'warning',
        message: 'x',
        requestId: ''
      })
    ).toEqual({
      ok: false,
      error: 'Relay status requestId must be a non-empty string.'
    });

    expect(
      parseRelayMessage({
        type: 'relay_status',
        code: 'request_failed',
        level: 'warning',
        message: 'x',
        clientId: ''
      })
    ).toEqual({
      ok: false,
      error: 'Relay status clientId must be a non-empty string.'
    });

    expect(
      parseRelayMessage({
        type: 'relay_status',
        code: 'request_failed',
        level: 'warning',
        message: 'x',
        targetClientRole: 'other'
      })
    ).toEqual({
      ok: false,
      error: 'Relay status targetClientRole must be a valid client role.'
    });

    expect(
      parseRelayMessage({
        type: 'copilot_cancel',
        clientId: 'workspace-1',
        requestId: ''
      })
    ).toEqual({
      ok: false,
      error: 'Copilot cancel messages require clientId and requestId.'
    });

    expect(
      parseRelayMessage({
        type: 'copilot_stream',
        clientId: 'workspace-1',
        requestId: 'req-1',
        done: false,
        delta: 1
      })
    ).toEqual({ ok: false, error: 'Copilot stream delta must be a string.' });

    expect(
      parseRelayMessage({
        type: 'copilot_stream',
        clientId: 'workspace-1',
        requestId: 'req-1',
        done: false,
        error: 1
      })
    ).toEqual({ ok: false, error: 'Copilot stream error must be a string.' });

    expect(
      parseRelayMessage({
        type: 'copilot_stream',
        clientId: 'workspace-1',
        requestId: 'req-1',
        done: false,
        modelId: 1
      })
    ).toEqual({ ok: false, error: 'Copilot stream modelId must be a string.' });

    expect(
      parseRelayMessage({
        type: 'permission_request',
        clientId: 'workspace-1',
        requestId: 'req-1',
        permissionId: 'perm-1',
        action: 'edit_file',
        title: 'Edit',
        details: 1
      })
    ).toEqual({
      ok: false,
      error: 'Permission request details must be a string.'
    });

    expect(
      parseRelayMessage({
        type: 'permission_request',
        clientId: 'workspace-1',
        requestId: 'req-1',
        permissionId: 'perm-1',
        action: 'edit_file',
        title: 'Edit',
        command: 1
      })
    ).toEqual({
      ok: false,
      error: 'Permission request command must be a string.'
    });

    expect(
      parseRelayMessage({
        type: 'permission_response',
        clientId: 'workspace-1',
        requestId: 'req-1',
        permissionId: 'perm-1',
        approved: true,
        reason: 1
      })
    ).toEqual({
      ok: false,
      error: 'Permission response reason must be a string.'
    });

    expect(parseRelayMessage({ type: 'ping', timestamp: '' })).toEqual({
      ok: false,
      error: 'ping messages require a timestamp.'
    });
  });

  it('creates ping and pong messages with timestamps', () => {
    expect(createPingMessage()).toEqual({
      type: 'ping',
      timestamp: expect.any(String)
    });
    expect(createPongMessage()).toEqual({
      type: 'pong',
      timestamp: expect.any(String)
    });
  });
});
