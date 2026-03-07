---
name: vscode-extension
description: Implement and maintain a VSCode extension that connects to the relay server and forwards prompts to GitHub Copilot Chat while streaming responses back.
---

Documentation:
https://code.visualstudio.com/api
https://code.visualstudio.com/api/extension-guides/overview
https://code.visualstudio.com/docs/copilot

Goal

Create a VSCode extension that acts as a bridge between the WebSocket relay server and GitHub Copilot Chat.

The extension should:

1. Connect to the relay server.
2. Receive Copilot prompts from the relay.
3. Send prompts to Copilot Chat.
4. Stream Copilot responses back to the relay server.

Architecture

Discord bot
↓
WebSocket relay
↓
VSCode extension
↓
GitHub Copilot Chat

Runtime Rules

Use Node.js v24.

During development TypeScript should run directly.

Do not introduce:

- webpack
- rollup
- custom build pipelines

Compilation should only happen during the build step using tsup.

Project Structure

packages/vscode-extension/

src/
extension.ts
relayClient.ts
copilotBridge.ts

Extension Lifecycle

The extension should activate automatically.

Activation event:

onStartupFinished

Example activation:

export function activate(context: vscode.ExtensionContext) {}

When activated the extension must:

1. Create a WebSocket connection to the relay server.
2. Register itself as the vscode client.

Example registration message:

{
"type": "register",
"client": "vscode"
}

Relay Communication

The extension listens for messages from the relay server.

Example prompt:

{
"type": "copilot_prompt",
"mode": "ask",
"prompt": "Explain this code"
}

The extension forwards the prompt to GitHub Copilot Chat.

Streaming Responses

Copilot responses should be streamed back to the relay server.

Example chunk:

{
"type": "copilot_stream",
"content": "This code defines a function...",
"done": false
}

When the response completes:

{
"type": "copilot_stream",
"done": true
}

Permission Requests

Copilot may request permissions such as:

- running terminal commands
- editing files

The extension should forward permission requests to the relay server.

Example message:

{
"type": "permission_request",
"action": "run_terminal_command",
"command": "npm test"
}

The relay server will forward this to the Discord bot.

When a response arrives:

{
"type": "permission_response",
"approved": true
}

the extension proceeds with the action.

Connection Management

The extension must:

- reconnect if the relay server disconnects
- log errors using a VSCode output channel
- avoid blocking the extension host thread

Best Practices

- keep Copilot logic isolated inside copilotBridge.ts
- keep WebSocket logic inside relayClient.ts
- keep extension lifecycle logic inside extension.ts

When To Use This Skill

Use this skill when:

- implementing the VSCode extension
- integrating with GitHub Copilot Chat
- handling relay communication
