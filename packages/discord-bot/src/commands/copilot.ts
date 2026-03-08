import {
	createRequestId,
	type CopilotMode,
	type PermissionRequestMessage,
	type RelayStatusMessage
} from '@remote-copilot/shared';
import {
	ChatInputCommandInteraction,
	MessageFlags,
	SlashCommandBuilder,
	type CacheType
} from 'discord.js';

import type { DiscordRelayClient } from '../relayClient.js';

export interface CopilotCommandContext {
	relayClient: DiscordRelayClient;
	streamUpdateIntervalMs: number;
	targetClientId: string;
}

export const copilotCommand = new SlashCommandBuilder()
	.setName('copilot')
	.setDescription('Send a prompt to the connected VS Code Copilot bridge.')
	.addSubcommand((subcommand) => {
		return subcommand
			.setName('ask')
			.setDescription('Ask Copilot a direct question.')
			.addStringOption((option) => option.setName('prompt').setDescription('Prompt to send').setRequired(true));
	})
	.addSubcommand((subcommand) => {
		return subcommand
			.setName('plan')
			.setDescription('Ask Copilot to plan an implementation.')
			.addStringOption((option) => option.setName('prompt').setDescription('Prompt to send').setRequired(true));
	})
	.addSubcommand((subcommand) => {
		return subcommand
			.setName('agent')
			.setDescription('Ask Copilot to reason in an agent-style workflow.')
			.addStringOption((option) => option.setName('prompt').setDescription('Prompt to send').setRequired(true));
	});

class ReplyStreamBuffer {
	#interaction: ChatInputCommandInteraction<CacheType>;
	#intervalHandle: NodeJS.Timeout;
	#resolveCompletion!: () => void;
	#rejectCompletion!: (error: Error) => void;
	#body = '';
	#dirty = false;
	#done = false;
	#notices: string[] = [];
	#completion = new Promise<void>((resolve, reject) => {
		this.#resolveCompletion = resolve;
		this.#rejectCompletion = reject;
	});

	constructor(interaction: ChatInputCommandInteraction<CacheType>, updateIntervalMs: number) {
		this.#interaction = interaction;
		this.#intervalHandle = setInterval(() => {
			void this.flush();
		}, updateIntervalMs);
	}

	get completion() {
		return this.#completion;
	}

	append(chunk: string) {
		this.#body += chunk;
		this.#dirty = true;
	}

	addNotice(notice: string) {
		this.#notices.push(notice);
		this.#dirty = true;
	}

	async fail(message: string) {
		this.#body = '';
		this.#notices.push(`⚠️ ${message}`);
		this.#done = true;
		await this.flush(true);
		this.#cleanup();
		this.#rejectCompletion(new Error(message));
	}

	async finish() {
		this.#done = true;
		await this.flush(true);
		this.#cleanup();
		this.#resolveCompletion();
	}

	async flush(force = false) {
		if (!force && !this.#dirty) {
			return;
		}

		this.#dirty = false;

		const body = this.#body.trim().length > 0 ? this.#body.trim() : 'Processing…';
		const notices = this.#notices.slice(-3).join('\n');
		const parts = [body, notices].filter(Boolean);
		let content = parts.join('\n\n');

		if (this.#done) {
			content = `${content}\n\n✅ Done`;
		}

		if (content.length > 1_950) {
			content = `${content.slice(0, 1_947)}…`;
		}

		await this.#interaction.editReply({ content });
	}

	#cleanup() {
		clearInterval(this.#intervalHandle);
	}
}

const statusMessageForUser = (message: RelayStatusMessage) => {
	switch (message.code) {
		case 'target_not_connected':
			return 'No VS Code relay client is connected for the configured workspace.';
		case 'authorization_required':
			return 'Copilot access has not been authorized in VS Code yet.';
		default:
			return message.message;
	}
};

const permissionNotice = (message: PermissionRequestMessage) => {
	const detail = message.command ?? message.details ?? 'No extra details were provided.';
	return `Permission requested (${message.action}): ${message.title} — ${detail}`;
};

export const handleCopilotCommand = async (
	interaction: ChatInputCommandInteraction<CacheType>,
	context: CopilotCommandContext
) => {
	const mode = interaction.options.getSubcommand(true) as CopilotMode;
	const prompt = interaction.options.getString('prompt', true).trim();

	if (prompt.length === 0) {
		await interaction.reply({
			content: 'Prompt cannot be empty.',
			flags: MessageFlags.Ephemeral
		});
		return;
	}

	await interaction.deferReply();

	const replyBuffer = new ReplyStreamBuffer(interaction, context.streamUpdateIntervalMs);
	const requestId = createRequestId();

	try {
		await context.relayClient.sendPrompt(
			{
				type: 'copilot_prompt',
				clientId: context.targetClientId,
				requestId,
				mode,
				prompt,
				channelId: interaction.channelId ?? undefined,
				messageId: interaction.id,
				threadId: interaction.channel?.isThread() ? interaction.channel.id : undefined,
				userDisplayName: interaction.user.globalName ?? interaction.user.username
			},
			{
				onPermissionRequest: async (message) => {
					replyBuffer.addNotice(permissionNotice(message));
					context.relayClient.sendPermissionResponse({
						type: 'permission_response',
						clientId: context.targetClientId,
						requestId: message.requestId,
						permissionId: message.permissionId,
						approved: false,
						reason: 'Remote permission approval is not implemented yet.'
					});
				},
				onStatus: async (message) => {
					if (message.level === 'error') {
						await replyBuffer.fail(statusMessageForUser(message));
						return;
					}

					replyBuffer.addNotice(message.message);
				},
				onStream: async (message) => {
					if (message.delta) {
						replyBuffer.append(message.delta);
					}

					if (message.error) {
						await replyBuffer.fail(message.error);
						return;
					}

					if (message.done) {
						await replyBuffer.finish();
					}
				}
			}
		);

		await replyBuffer.completion;
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to send prompt to the relay server.';
		await interaction.editReply({ content: `⚠️ ${message}` });
	}
};
