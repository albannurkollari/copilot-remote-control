# Copilot Remote Control

![Illustration of a laptop showing GitHub Copilot Chat connected to Discord with the title Copilot Remote Control](https://repository-images.githubusercontent.com/1175490456/8305002a-52fc-475a-a6c1-9bae46bdd4be)

![Tests](https://github.com/albannurkollari/copilot-remote-control/actions/workflows/tests.yml/badge.svg)
[![codecov](https://codecov.io/gh/albannurkollari/copilot-remote-control/graph/badge.svg?token=aCU2hYVAO3)](https://codecov.io/gh/albannurkollari/copilot-remote-control)
[![semantic-release: angular](https://img.shields.io/badge/semantic--release-angular-e10079?logo=semantic-release)](https://github.com/semantic-release/semantic-release)

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

## Must know before you start

Each developer must use their own Discord bot application and secrets.
The bot is intended to be self-hosted alongside the relay server and your VS Code session.

### 1. Create your Discord bot project

1. Open the Discord Developer Portal.
2. Create a new application.
3. Add a bot user to that application.
4. Copy these values for later:

- Application ID
- Bot token
- Your Discord server ID

1. Invite the bot to your own server with the permissions needed for slash commands.

### 2. Initialize local configuration

From the repository root:

1. Install dependencies with `pnpm install`
2. Run `pnpm dev:init`
3. Answer the interactive prompts for your Discord and relay configuration
4. Copy the printed `remoteCopilot.clientId`, `remoteCopilot.relayUrl`, and `remoteCopilot.sharedSecret` values into VS Code settings

## Quick start

From the repository root:

1. Install dependencies with `pnpm install`
2. Run `pnpm dev:init`
3. Start the relay server and Discord bot together with `pnpm dev:stack`
4. Run the VS Code extension in an Extension Development Host
5. Paste the printed `remoteCopilot.*` values into your VS Code settings
6. Authorize Copilot access in VS Code
7. Run `/copilot` in Discord

For the full local setup, see [docs/local-development.md](docs/local-development.md).

## Usage

Use `/copilot` in Discord, choose a mode, and enter a prompt. The reply is streamed back into Discord through the connected VS Code instance.

## Documentation

- [Local development](docs/local-development.md)
- [Privacy Policy](docs/privacy-policy.md)
- [Terms of Service](docs/terms-of-service.md)
- [Project TODO](todo.md)
- [Contributing](CONTRIBUTING.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)

## Publishing

This repository now ships in two lanes:

1. `copilot-rc` is published to npm.
2. `remote-copilot-host` is published to the VS Code Marketplace.

The CI workflow in [.github/workflows/publish.yml](.github/workflows/publish.yml) runs npm publishing first and only publishes the extension after a successful release.

Required repository secrets:

- `NPM_TOKEN` for publishing [packages/copilot-rc](packages/copilot-rc/package.json)
- `VSCE_PAT` for publishing the VS Code extension from [packages/vscode-extension](packages/vscode-extension/package.json)

Useful commands:

- `pnpm release:dry-run` to preview semantic-release locally
- `pnpm publish:extension` to publish the VS Code extension when `RELEASE_VERSION` and `VSCE_PAT` are set

## Current limitations

- Remote approval for tool calls is **not implemented yet**
- The extension is not yet fully prepared for VS Code Marketplace publishing
- The extension does **not** connect to Discord directly; Discord integration happens only through the bot

## Notes

- The relay defaults to `ws://127.0.0.1:8787/`
- The VS Code extension is currently intended for local development use
- Marketplace packaging is still a future step

For contributor, release, and workflow details, see [CONTRIBUTING.md](CONTRIBUTING.md).
