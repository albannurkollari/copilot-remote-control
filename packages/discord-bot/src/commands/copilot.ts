import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';

import { createRequestId, type CopilotMode, type CopilotPromptMessage } from '@remote-copilot/shared';

export const COPILOT_COMMAND_NAME = 'copilot';
export const COPILOT_MODE_OPTION = 'mode';
export const COPILOT_PROMPT_OPTION = 'prompt';

export interface CopilotCommandInput {
	mode: CopilotMode;
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
		.addStringOption((option) => {
			return option
				.setName(COPILOT_MODE_OPTION)
				.setDescription('Copilot request mode')
				.setRequired(true)
				.addChoices(
					{ name: 'Ask', value: 'ask' },
					{ name: 'Plan', value: 'plan' },
					{ name: 'Agent', value: 'agent' }
				);
		})
		.addStringOption((option) => {
			return option
				.setName(COPILOT_PROMPT_OPTION)
				.setDescription('Prompt to forward to Copilot')
				.setRequired(true)
				.setMinLength(1)
				.setMaxLength(4_000);
		});
};

export const parseCopilotCommand = (
	interaction: Pick<ChatInputCommandInteraction, 'options'>
): CopilotCommandInput => {
	const prompt = interaction.options.getString(COPILOT_PROMPT_OPTION, true).trim();

	if (!prompt) {
		throw new Error('Prompt cannot be empty.');
	}

	return {
		mode: interaction.options.getString(COPILOT_MODE_OPTION, true) as CopilotMode,
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
		prompt: input.prompt,
		userDisplayName: context.userDisplayName,
		channelId: context.channelId,
		threadId: context.threadId,
		messageId: context.messageId
	};
};
