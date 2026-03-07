---
name: websocket-relay
description: Implement and maintain the WebSocket relay server responsible for routing messages between the Discord bot and the VSCode extension.
---

Documentation:
https://github.com/websockets/ws
https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API
https://nodejs.org/docs/latest-v24.x/api/

Goal

Implement a WebSocket relay server that routes Copilot messages between remote clients and local development tools.

The relay server acts as the message hub between:

Discord bot
VSCode extension

Architecture

Discord bot
↓
WebSocket relay server
↓
VSCode extension
↓
GitHub Copilot Chat

The relay server does not process Copilot responses.
It only routes messages between clients.

Runtime Rules

Use Node.js v24.

During development run TypeScript directly:

node src/server.ts

Do not introduce:

- express
- fastify
- REST APIs
- polling systems

Communication must occur through WebSockets.

Project Structure

packages/relay-server/

src/
server.ts

The server should use the `ws` library to create a WebSocket server.

Client Types

The relay server must support two client roles:

discord
vscode

Clients must identify themselves after connecting.

Example handshake message:

{
"type": "register",
"client": "discord"
}

or

{
"type": "register",
"client": "vscode"
}

Message Routing

Once registered, the relay server forwards messages.

Example flow:

Discord bot sends prompt:

{
"type": "copilot_prompt",
"mode": "ask",
"prompt": "Explain this function"
}

Relay forwards to VSCode extension.

VSCode extension sends stream response:

{
"type": "copilot_stream",
"content": "This function calculates...",
"done": false
}

Relay forwards to Discord bot.

Message Types

copilot_prompt
copilot_stream
permission_request
permission_response

The relay must not modify payload contents.

Connection Management

The server must:

- track connected clients
- store references for discord and vscode clients
- detect disconnections
- allow reconnections

If the VSCode extension disconnects:

- notify the Discord bot
- reject new prompts until reconnected

Error Handling

Handle:

- malformed JSON
- unknown message types
- disconnected clients

Best Practices

- keep relay logic minimal
- do not store conversation history
- avoid business logic in the relay
- keep message envelopes consistent

When To Use This Skill

Use this skill when:

- implementing the relay server
- adding message routing logic
- defining the WebSocket protocol
