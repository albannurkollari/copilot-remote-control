---
name: discord-bot
description: Implement and maintain a Discord bot written in TypeScript that sends Copilot prompts to the relay server and streams responses back to Discord.
---

Documentation:
https://discord.js.org/#/docs
https://discordjs.guide/
https://nodejs.org/docs/latest-v24.x/api/

Goal

Implement a Discord bot that acts as the remote interface for interacting with GitHub Copilot.

The bot must:

1. Accept slash commands from users.
2. Send Copilot prompts to the WebSocket relay server.
3. Stream responses back into the Discord message thread.

Runtime Rules

Use Node.js v24.

TypeScript files should run directly during development:

node src/bot.ts

Do not introduce:

- ts-node
- tsx
- nodemon

Architecture

Discord bot communicates only with the relay server.

Flow:

Discord User
↓
Discord Bot
↓
WebSocket Relay
↓
VSCode Extension
↓
Copilot Chat

Project Structure

packages/discord-bot/

src/
bot.ts
commands/
copilot.ts
relayClient.ts

Command Design

Use slash commands.

Primary command:

/copilot

Parameters:

mode
prompt

Example:

/copilot mode:ask prompt:"Explain this TypeScript error"

/copilot mode:plan prompt:"Design a caching layer"

/copilot mode:agent prompt:"Refactor the user reducer"

Valid Modes

ask
plan
agent

Command Handler Flow

1. Receive slash command interaction.
2. Validate parameters.
3. Send prompt message to relay server.

Example message:

{
"type": "copilot_prompt",
"mode": "ask",
"prompt": "Explain this code"
}

Streaming Responses

The relay server will send streamed responses.

Example chunk:

{
"type": "copilot_stream",
"content": "This code defines a function...",
"done": false
}

The bot should:

1. Send an initial reply:

"Processing..."

2. Edit the message as chunks arrive.

3. Finalize when done = true.

Rate Limiting

Discord rate limits message edits.

To avoid hitting limits:

- buffer response chunks
- update messages every 1–2 seconds

Error Handling

Handle the following errors:

- relay server unavailable
- invalid command parameters
- Discord API errors

Best Practices

- Use modular command handlers.
- Separate Discord logic from relay communication.
- Keep the bot stateless.

When To Use This Skill

Use this skill when:

- implementing Discord commands
- handling interactions
- streaming Copilot responses
- connecting to the relay server
