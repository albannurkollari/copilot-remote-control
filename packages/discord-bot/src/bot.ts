import process from 'node:process';

import { Client, GatewayIntentBits, REST, Routes } from 'discord.js';

import { copilotCommand, handleCopilotCommand } from './commands/copilot.js';
import { DiscordRelayClient } from './relayClient.js';

export interface DiscordBotConfig {
	applicationId: string;
	botToken: string;
	guildId: string;
	relayClientId: string;
	relayUrl: string;
	streamUpdateIntervalMs: number;
	targetClientId: string;
}

export const loadDiscordBotConfig = (): DiscordBotConfig => {
	const {
		DISCORD_APPLICATION_ID,
		DISCORD_GUILD_ID,
		DISCORD_RELAY_CLIENT_ID,
		DISCORD_STREAM_UPDATE_INTERVAL_MS,
		DISCORD_TOKEN,
		RELAY_URL,
		REMOTE_COPILOT_CLIENT_ID
	} = process.env;

	if (!DISCORD_TOKEN || !DISCORD_APPLICATION_ID || !DISCORD_GUILD_ID || !REMOTE_COPILOT_CLIENT_ID) {
		throw new Error(
			'Missing required environment variables. Expected DISCORD_TOKEN, DISCORD_APPLICATION_ID, DISCORD_GUILD_ID, and REMOTE_COPILOT_CLIENT_ID.'
		);
	}

	const interval = Number.parseInt(DISCORD_STREAM_UPDATE_INTERVAL_MS ?? '1200', 10);

	return {
		applicationId: DISCORD_APPLICATION_ID,
		botToken: DISCORD_TOKEN,
		guildId: DISCORD_GUILD_ID,
		relayClientId: DISCORD_RELAY_CLIENT_ID ?? 'discord-bot',
		relayUrl: RELAY_URL ?? 'ws://127.0.0.1:8787/',
		streamUpdateIntervalMs: Number.isNaN(interval) ? 1200 : interval,
		targetClientId: REMOTE_COPILOT_CLIENT_ID
	};
};

export const registerGuildCommands = async (config: DiscordBotConfig) => {
	const rest = new REST({ version: '10' }).setToken(config.botToken);

	await rest.put(Routes.applicationGuildCommands(config.applicationId, config.guildId), {
		body: [copilotCommand.toJSON()]
	});
};

export const startDiscordBot = async (config = loadDiscordBotConfig()) => {
	const relayClient = new DiscordRelayClient({
		clientId: config.relayClientId,
		url: config.relayUrl
	});

	await relayClient.connect();

	const client = new Client({ intents: [GatewayIntentBits.Guilds] });

	relayClient.onStatus((message) => {
		if (message.requestId) {
			return;
		}

		process.stdout.write(`[relay] ${message.level}: ${message.message}\n`);
	});

	client.once('ready', async () => {
		await registerGuildCommands(config);
		process.stdout.write(`Discord bot ready as ${client.user?.tag ?? 'unknown-user'}\n`);
	});

	client.on('interactionCreate', async (interaction) => {
		if (!interaction.isChatInputCommand() || interaction.commandName !== 'copilot') {
			return;
		}

		await handleCopilotCommand(interaction, {
			relayClient,
			streamUpdateIntervalMs: config.streamUpdateIntervalMs,
			targetClientId: config.targetClientId
		});
	});

	await client.login(config.botToken);

	const shutdown = async () => {
		await relayClient.disconnect();
		await client.destroy();
		process.exit(0);
	};

	process.once('SIGINT', () => {
		void shutdown();
	});
	process.once('SIGTERM', () => {
		void shutdown();
	});

	return { client, relayClient };
};

if (import.meta.url === new URL(process.argv[1] ?? '', 'file:').href) {
	await startDiscordBot();
}
