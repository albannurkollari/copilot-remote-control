import {
  buildCopilotPromptMessage,
  createCopilotCommand,
  parseCopilotCommand
} from './copilot.ts';

describe('copilot command', () => {
  it('defines the expected slash command shape', () => {
    const command = createCopilotCommand().toJSON();

    expect(command.name).toBe('copilot');
    expect(command.options).toHaveLength(3);
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

  it('includes model in the protocol message when specified', () => {
    const message = buildCopilotPromptMessage(
      { mode: 'ask', model: 'gpt-4o', prompt: 'Explain this code' },
      { clientId: 'workspace-1', userDisplayName: 'octocat' }
    );

    expect(message.model).toBe('gpt-4o');
  });

  it('omits model from the protocol message when not specified', () => {
    const message = buildCopilotPromptMessage(
      { mode: 'ask', prompt: 'Explain this code' },
      { clientId: 'workspace-1', userDisplayName: 'octocat' }
    );

    expect(message.model).toBeUndefined();
  });

  it('extracts model from command options', () => {
    const result = parseCopilotCommand({
      options: {
        getString: (name: string, _required?: boolean) => {
          if (name === 'mode') return 'ask';
          if (name === 'model') return 'gpt-4o';
          return 'Hello';
        }
      }
    } as never);

    expect(result.model).toBe('gpt-4o');
  });

  it('leaves model undefined when not provided', () => {
    const result = parseCopilotCommand({
      options: {
        getString: (name: string, _required?: boolean) => {
          if (name === 'mode') return 'ask';
          if (name === 'model') return null;
          return 'Hello';
        }
      }
    } as never);

    expect(result.model).toBeUndefined();
  });

  it('rejects empty command prompts after trimming', () => {
    expect(() =>
      parseCopilotCommand({
        options: {
          getString: (_name: string) => '   '
        }
      } as never)
    ).toThrow('Prompt cannot be empty.');
  });
});
