import {
	type CopilotPromptMessage,
	type PermissionRequestMessage
} from '@remote-copilot/shared';
import * as vscode from 'vscode';

import { CopilotBridge } from './copilotBridge.js';
import { VscodeRelayClient } from './relayClient.js';

interface RemoteCopilotConfiguration {
	clientId: string;
	relayUrl: string;
}

const loadConfiguration = (): RemoteCopilotConfiguration => {
	const configuration = vscode.workspace.getConfiguration('remoteCopilot');

	return {
		clientId: configuration.get<string>('clientId', 'default'),
		relayUrl: configuration.get<string>('relayUrl', 'ws://127.0.0.1:8787/')
	};
};

const toErrorMessage = (error: unknown) => {
	if (error instanceof Error) {
		return error.message;
	}

	return String(error);
};

export async function activate(context: vscode.ExtensionContext) {
	const outputChannel = vscode.window.createOutputChannel('Remote Copilot');
	const configuration = loadConfiguration();
	const bridge = new CopilotBridge(context, outputChannel);
	const relayClient = new VscodeRelayClient({
		clientId: configuration.clientId,
		outputChannel,
		url: configuration.relayUrl
	});

	const handlePrompt = async (message: CopilotPromptMessage) => {
		outputChannel.appendLine(`[prompt:${message.requestId}] Received ${message.mode} prompt.`);

		try {
			await bridge.runPrompt(message, {
				onText: async (chunk) => {
					await relayClient.sendStream({
						type: 'copilot_stream',
						clientId: message.clientId,
						requestId: message.requestId,
						delta: chunk,
						done: false
					});
				},
				requestPermission: async (permissionRequest: PermissionRequestMessage) => {
					outputChannel.appendLine(
						`[prompt:${message.requestId}] Awaiting permission for ${permissionRequest.action}.`
					);
					return relayClient.requestPermission(permissionRequest);
				}
			});

			await relayClient.sendStream({
				type: 'copilot_stream',
				clientId: message.clientId,
				requestId: message.requestId,
				done: true
			});
		} catch (error) {
			const errorMessage = toErrorMessage(error);
			outputChannel.appendLine(`[prompt:${message.requestId}] ${errorMessage}`);

			await relayClient.sendStream({
				type: 'copilot_stream',
				clientId: message.clientId,
				requestId: message.requestId,
				done: true,
				error: errorMessage
			});
		}
	};

	const disposePromptListener = relayClient.onPrompt((message) => {
		void handlePrompt(message);
	});

	const disposeStatusListener = relayClient.onStatus((message) => {
		outputChannel.appendLine(`[relay:${message.level}] ${message.message}`);
	});

	context.subscriptions.push(
		relayClient,
		outputChannel,
		{ dispose: disposePromptListener },
		{ dispose: disposeStatusListener },
		vscode.commands.registerCommand('remoteCopilot.authorizeCopilotAccess', async () => {
			try {
				const message = await bridge.authorizeAccess();
				void vscode.window.showInformationMessage(message);
			} catch (error) {
				void vscode.window.showErrorMessage(toErrorMessage(error));
			}
		}),
		vscode.commands.registerCommand('remoteCopilot.showRelayOutput', () => {
			outputChannel.show(true);
		}),
		vscode.commands.registerCommand('remoteCopilot.reconnectRelay', async () => {
			try {
				await relayClient.reconnect();
				void vscode.window.showInformationMessage('Remote Copilot relay reconnected.');
			} catch (error) {
				void vscode.window.showErrorMessage(toErrorMessage(error));
			}
		})
	);

	void relayClient.connect().catch((error) => {
		outputChannel.appendLine(`[relay:error] ${toErrorMessage(error)}`);
	});
}

export function deactivate() {
	return undefined;
}
