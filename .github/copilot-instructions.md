Repository Purpose

First Principle

The first and foremost principle in this repository is:

- minimum bare consumption of tokens for both input and output

Guidance:

- Never add extra wording, explanation, framing, or prompt padding around user input before sending it to GitHub Copilot.
- Keep all Copilot-facing prompts, tool schemas, tool results, and follow-up messages as short as possible.
- Prefer concise outputs from Copilot.
- If structure, formatting, labels, status text, or presentation can be added after the model responds, do that in the VS Code extension or other local helper code instead of asking the LLM to generate it.
- Do not spend tokens on text that can be deterministically produced by the application.
- Treat new context creation and unnecessary conversation history growth as costly; minimize both whenever possible.

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

Shell And Terminal Defaults

Prefer Bash as the default shell for command execution.

Do not use PowerShell unless:

- the user explicitly asks for it
- the task clearly requires PowerShell-specific behavior

When running multiple sequential commands for the same task, prefer reusing the active shared integrated terminal instead of spawning a new terminal for each command.

Only use a separate terminal when necessary, such as:

- concurrent long-running processes
- background services
- isolating unrelated workflows
- avoiding disruption of an already-running command sequence

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
