# Remote Copilot Host

Remote Copilot Host turns your VS Code window into a remote control surface for GitHub Copilot Chat.

It connects to a relay server, receives remote prompt requests, runs them through Copilot in your current VS Code session, and streams the results back to the connected client.

## Part of the Remote Copilot toolset

Remote Copilot Host is the VS Code side of a larger self-hosted workflow.

- [`copilot-rc`](https://github.com/albannurkollari/copilot-remote-control/tree/main/packages/copilot-rc) is the CLI for initializing config and starting the stack.
- The [relay server](https://github.com/albannurkollari/copilot-remote-control/tree/main/packages/relay-server) routes messages between your remote client and this host.
- The [Discord bot](https://github.com/albannurkollari/copilot-remote-control/tree/main/packages/discord-bot) is the current remote client integration.

If you want the full setup, start with `copilot-rc`, then connect this extension as the Copilot host inside VS Code.

## What you can do

- Connect VS Code to a remote Copilot relay
- Let remote clients send prompts into your active Copilot environment
- Stream Copilot responses back in real time
- Review saved remote session transcripts locally
- Reconnect quickly if the relay becomes unavailable
- Approve Copilot access from inside VS Code

## Typical flow

1. Configure the relay connection in VS Code settings
2. Start the relay server and the remote client that will send prompts
3. Open VS Code with GitHub Copilot Chat available
4. Authorize Remote Copilot access
5. Let the remote client send prompts through this host

## Commands

### Remote Copilot: Authorize Copilot Access

Use this command to grant the extension access to GitHub Copilot for remote prompt execution.

### Remote Copilot: Copy Shared Secret

Generates the extension-owned shared secret if needed, saves it to settings, and copies it to the clipboard so you can paste it into `copilot-rc init`.

### Remote Copilot: Show Relay Output

Opens the output channel so you can inspect relay connection status, warnings, and runtime activity.

### Remote Copilot: Show Remote Sessions

Shows a local transcript view of previously handled remote sessions, including prompts, responses, and permission activity.

### Remote Copilot: Clear Remote Sessions

Deletes the locally stored transcript history for remote sessions.

### Remote Copilot: Reconnect Relay

Reconnects the extension to the configured relay server without restarting VS Code.

## Requirements

- VS Code 1.105 or newer.
- GitHub Copilot Chat available in the current VS Code instance.
- A reachable relay server.

## Settings

This extension contributes the following settings:

- `remoteCopilot.clientId`: Logical client ID used to register this host with the relay server.
- `remoteCopilot.relayUrl`: WebSocket relay URL used by this host.
- `remoteCopilot.sharedSecret`: Shared secret owned by this extension and pasted into `copilot-rc init`.

## What the extension stores

This extension stores remote session transcripts locally in VS Code global state so you can inspect past prompt activity later.

## Troubleshooting

- If the relay is offline or unreachable, the extension will show a warning and offer reconnect/help actions.
- If settings are missing, open the Remote Copilot settings and provide the required values.
- If remote execution is not working, first confirm that GitHub Copilot Chat is available in the current VS Code window.
