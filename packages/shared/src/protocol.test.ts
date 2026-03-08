import { describe, expect, it } from 'vitest';
import {
  createPermissionId,
  createRequestId,
  isRelayMessage,
  parseRelayMessage,
  serializeRelayMessage,
  type CopilotPromptMessage
} from './protocol.js';

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

  it('creates stable request and permission identifiers', () => {
    expect(createRequestId()).toMatch(/^req_/u);
    expect(createPermissionId()).toMatch(/^perm_/u);
  });
});
