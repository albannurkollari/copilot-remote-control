# copilot-remote-control

![Illustration of a laptop showing GitHub Copilot Chat connected to Discord with the title Copilot Remote Control](https://repository-images.githubusercontent.com/1175490456/8305002a-52fc-475a-a6c1-9bae46bdd4be)

Remote control system for GitHub Copilot Chat via Discord using a VSCode extension bridge and WebSocket relay.

---

[Contributing](./CONTRIBUTING.md) · [Code of Conduct](./CODE_OF_CONDUCT.md) · [License](./LICENSE)

## Overview

Use Discord to send prompts to GitHub Copilot running inside your local VS Code instance.

The project has three main moving parts:

1. **Discord bot** receives `/copilot` slash commands.
2. **Relay server** routes WebSocket messages between clients.
3. **VS Code extension** receives prompts and forwards them to GitHub Copilot Chat.

Flow:

```text
Discord user
  -> Discord bot
  -> relay server
  -> VS Code extension
  -> GitHub Copilot Chat
  -> relay server
  -> Discord bot
  -> Discord reply
```

## Prerequisites

- **Node.js 24+**
- **pnpm 10**
- **VS Code** with GitHub Copilot Chat available
- A **Discord application + bot token** from the Discord Developer Portal
- A Discord server where you can install the bot

## Quick start

From the repository root:

1. Install dependencies with `pnpm install`
2. Generate local env files with `pnpm env:generate`
3. Fill in `.env.dev` using [examples/.env.example](examples/.env.example)
4. Start the relay server
5. Start the Discord bot
6. Run the VS Code extension in an Extension Development Host
7. Authorize Copilot access in VS Code
8. Run `/copilot` in Discord

For the full local setup, see [docs/local-development.md](docs/local-development.md).

## Usage

Use `/copilot` in Discord, choose a mode, and enter a prompt. The reply is streamed back into Discord through the connected VS Code instance.

## Documentation

- [Local development](docs/local-development.md)
- [Terms of Service](docs/terms-of-service.md)
- [Project TODO](TODO.md)
- [Contributing](CONTRIBUTING.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)

## Current limitations

- Remote approval for tool calls is **not implemented yet**
- The extension is not yet fully prepared for VS Code Marketplace publishing
- The extension does **not** connect to Discord directly; Discord integration happens only through the bot

## Notes

- The relay defaults to `ws://127.0.0.1:8787/`
- The VS Code extension is currently intended for local development use
- Marketplace packaging is still a future step

For contributor, release, and workflow details, see [CONTRIBUTING.md](CONTRIBUTING.md).
