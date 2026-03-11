import {
  createRequestId,
  type CopilotMode,
  type CopilotPromptMessage
} from '@remote-copilot/shared';
import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction
} from 'discord.js';

export const COPILOT_COMMAND_NAME = 'copilot';
export const COPILOT_MODE_OPTION = 'mode';
export const COPILOT_MODEL_OPTION = 'model';
export const COPILOT_PROMPT_OPTION = 'prompt';

export const COPILOT_MODEL_CHOICES = [
  { name: 'Auto (default)', value: 'copilot-auto' },
  { name: 'GPT-4o', value: 'gpt-4o' },
  { name: 'GPT-4o Mini', value: 'gpt-4o-mini' },
  { name: 'GPT-4.1', value: 'gpt-4.1' },
  { name: 'GPT-4.1 Mini', value: 'gpt-4.1-mini' },
  { name: 'GPT-4.1 Nano', value: 'gpt-4.1-nano' },
  { name: 'Claude Sonnet 4.5', value: 'claude-sonnet-4-5' },
  { name: 'Claude 3.7 Sonnet', value: 'claude-3.7-sonnet' },
  { name: 'o3-mini', value: 'o3-mini' },
  { name: 'o4-mini', value: 'o4-mini' }
] as const;

export interface CopilotCommandInput {
  mode: CopilotMode;
  model?: string;
  prompt: string;
}

export interface CopilotPromptContext {
  channelId?: string;
  clientId: string;
  messageId?: string;
  threadId?: string;
  userDisplayName?: string;
}

export const createCopilotCommand = () => {
  return new SlashCommandBuilder()
    .setName(COPILOT_COMMAND_NAME)
    .setDescription('Send a prompt to the connected VS Code Copilot bridge.')
    .addStringOption((option) =>
      option
        .setName('prompt')
        .setDescription('The prompt to send to Copilot')
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName('mode')
        .setDescription('Execution mode')
        .setRequired(false)
        .addChoices(
          { name: 'agent', value: 'agent' },
          { name: 'ask', value: 'ask' }
        )
    )
    .addStringOption((option) =>
      option
        .setName('model')
        .setDescription('LLM model to use (defaults to copilot-auto)')
        .setRequired(false)
        .addChoices(...COPILOT_MODEL_CHOICES)
    );
};

export const parseCopilotCommand = (
  interaction: Pick<ChatInputCommandInteraction, 'options'>
): CopilotCommandInput => {
  const prompt = interaction.options
    .getString(COPILOT_PROMPT_OPTION, true)
    .trim();

  if (!prompt) {
    throw new Error('Prompt cannot be empty.');
  }

  return {
    mode: interaction.options.getString(
      COPILOT_MODE_OPTION,
      true
    ) as CopilotMode,
    model: interaction.options.getString(COPILOT_MODEL_OPTION) ?? undefined,
    prompt
  };
};

export const buildCopilotPromptMessage = (
  input: CopilotCommandInput,
  context: CopilotPromptContext
): CopilotPromptMessage => {
  return {
    type: 'copilot_prompt',
    clientId: context.clientId,
    requestId: createRequestId(),
    mode: input.mode,
    model: input.model,
    prompt: input.prompt,
    userDisplayName: context.userDisplayName,
    channelId: context.channelId,
    threadId: context.threadId,
    messageId: context.messageId
  };
};
