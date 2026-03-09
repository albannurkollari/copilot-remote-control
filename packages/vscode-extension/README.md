# Remote Copilot Host

Remote Copilot Host is a VS Code extension that connects a local VS Code instance to the remote Copilot relay server.

## Features

- Connects to the WebSocket relay server.
- Receives remote prompts and forwards them to GitHub Copilot Chat.
- Streams responses back to the relay.
- Records prompt, response, and permission transcripts locally.

## Requirements

- VS Code 1.105 or newer.
- GitHub Copilot Chat available in the current VS Code instance.
- A reachable relay server.

## Extension Settings

This extension contributes the following settings:

- `remoteCopilot.clientId`: Logical client ID used to register this VS Code bridge.
- `remoteCopilot.relayUrl`: WebSocket relay URL for the bridge.

## Packaging

Build the installable VSIX from this package directory:

- `pnpm package`

The generated `.vsix` file can then be installed in VS Code with **Install from VSIX...**.
