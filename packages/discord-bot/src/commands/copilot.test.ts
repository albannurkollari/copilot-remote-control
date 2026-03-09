import { buildCopilotPromptMessage, createCopilotCommand } from './copilot.ts';

describe('copilot command', () => {
  it('defines the expected slash command shape', () => {
    const command = createCopilotCommand().toJSON();

    expect(command.name).toBe('copilot');
    expect(command.options).toHaveLength(2);
  });

  it('builds protocol messages from command input', () => {
    const message = buildCopilotPromptMessage(
      { mode: 'ask', prompt: 'Explain this code' },
      { clientId: 'workspace-1', userDisplayName: 'octocat' }
    );

    expect(message.type).toBe('copilot_prompt');
    expect(message.clientId).toBe('workspace-1');
    expect(message.requestId).toMatch(/^req_/u);
  });
});
