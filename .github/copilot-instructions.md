Repository Purpose

This repository implements a system for remotely interacting with GitHub Copilot Chat through Discord.

The architecture consists of:

Discord bot
↓
WebSocket relay server
↓
VSCode extension
↓
GitHub Copilot Chat

All components communicate using a shared message protocol.

Tech Stack

Node.js v24
pnpm workspaces
TypeScript
tsup builds

Runtime Rules

During development Node.js should execute TypeScript files directly.

Example:

node src/index.ts

Do not introduce:

- ts-node
- tsx
- babel
- nodemon

Compilation should only occur during the build step.

Workspace Rules

This repository uses pnpm workspaces.

All packages must live inside:

packages/

Do not create packages outside this directory.

Internal dependencies must use workspace references.

Example:

"dependencies": {
"@remote-copilot/shared": "workspace:\*"
}

Architecture Rules

The system is composed of four packages:

shared
relay-server
discord-bot
vscode-extension

shared

Contains protocol types used by all components.

relay-server

Routes WebSocket messages between clients.

discord-bot

Receives slash commands and sends Copilot prompts.

vscode-extension

Bridges the relay server with GitHub Copilot Chat.

Build Rules

Use tsup to build TypeScript into JavaScript.

Example:

tsup src/index.ts --format esm --dts

Each package should define scripts:

dev
build
clean

Example:

{
"scripts": {
"dev": "node src/index.ts",
"build": "tsup src/index.ts --format esm --dts",
"clean": "rm -rf dist"
}
}

Best Practices

Keep packages small and focused.

Shared types must live in the shared package.

Avoid duplicating protocol definitions.

Use ESM modules.
