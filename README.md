# copilot-remote-control

![Illustration of a laptop showing GitHub Copilot Chat connected to Discord with the title Copilot Remote Control](https://repository-images.githubusercontent.com/1175490456/8305002a-52fc-475a-a6c1-9bae46bdd4be)

Remote control system for GitHub Copilot Chat via Discord using a VSCode extension bridge and WebSocket relay.

---

[Contributing](./CONTRIBUTING.md) · [Code of Conduct](./CODE_OF_CONDUCT.md) · [License](./LICENSE)

## How it works

The system is split into three running parts and one shared protocol package:

1. **Discord bot** receives `/copilot` slash commands.
2. **Relay server** routes WebSocket messages between clients.
3. **VS Code extension** receives prompts and forwards them to GitHub Copilot Chat.
4. **Shared package** defines the message protocol used by all components.

High-level flow:

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

Before you run the project, make sure you have:

- **Node.js 24+**
- **pnpm 10**
- **VS Code** with GitHub Copilot Chat available
- A **Discord application + bot token** from the Discord Developer Portal
- A Discord server where you can install the bot

## Install dependencies

From the repository root:

1. Install dependencies with `pnpm install`
2. Generate local env files with `pnpm env:generate`
3. Build everything once with `pnpm build`

Useful root scripts:

- `pnpm env:generate` generates both `.env.dev` and `.env.prod`
- `pnpm env:generate:dev` generates only `.env.dev`
- `pnpm env:generate:prod` generates only `.env.prod`
- `pnpm build` builds all packages
- `pnpm test` runs all tests
- `pnpm lint` runs the linter

## Environment files

The checked-in template lives in [examples/.env.example](examples/.env.example).

Generate concrete files with:

- `pnpm env:generate`
- `pnpm env:generate:dev`
- `pnpm env:generate:prod`

This creates root-level files:

- `.env.dev`
- `.env.prod`

Important variables:

- `DISCORD_TOKEN` - Discord bot token
- `DISCORD_APPLICATION_ID` - Discord application ID
- `DISCORD_GUILD_ID` - Discord server ID for slash command registration
- `RELAY_URL` - WebSocket URL the Discord bot connects to
- `REMOTE_COPILOT_CLIENT_ID` - logical client ID shared by the bot and the VS Code extension
- `RELAY_HOST`, `RELAY_PORT`, `RELAY_PATH` - relay server binding settings

The extension itself does **not** read env files directly. Instead, copy these values into VS Code settings:

- `remoteCopilot.clientId`
- `remoteCopilot.relayUrl`

## Step-by-step local setup

### 1. Start the relay server

The relay server is a normal Node.js process. It does **not** need to be packaged as a standalone executable.

Development run:

- `pnpm --filter @remote-copilot/relay-server dev`

Default development address:

- `ws://127.0.0.1:8787/`

### 2. Configure and run the Discord bot

Create a Discord application and bot in the Discord Developer Portal, then:

1. Copy values from `.env.dev`
2. Replace the Discord placeholders with real credentials
3. Invite the bot to your test server with slash-command permissions
4. Start the bot:

- `pnpm --filter @remote-copilot/discord-bot dev`

The bot registers the `/copilot` command for the configured guild at startup.

### 3. Install or run the VS Code extension

Current status: the extension builds correctly, but Marketplace packaging is not fully wired yet.

For development:

1. Open this repository in VS Code
2. Build the project with `pnpm build`
3. Run the extension in an Extension Development Host
4. Set these VS Code settings:

```json
{
  "remoteCopilot.clientId": "default",
  "remoteCopilot.relayUrl": "ws://127.0.0.1:8787/"
}
```

Then run the command:

- `Remote Copilot: Authorize Copilot Access`

That authorizes the extension to use GitHub Copilot Chat locally.

### 4. Run an end-to-end test

Once the relay, bot, and extension are all running:

1. Open Discord on desktop or Android
2. Go to the server where the bot is installed
3. Run `/copilot`
4. Choose a mode:
   - `ask`
   - `plan`
   - `agent`
5. Enter your prompt

If the `REMOTE_COPILOT_CLIENT_ID` in the bot matches `remoteCopilot.clientId` in VS Code, the prompt should route to your current VS Code instance.

## How users use the app

### On Discord

Users interact only through the `/copilot` slash command.

The command accepts:

- `mode` - one of `ask`, `plan`, or `agent`
- `prompt` - the text sent to Copilot

The Discord bot streams the response back by editing the original reply over time.

### In VS Code

The local machine running the extension is the execution side.

The extension:

- auto-activates after VS Code startup
- connects to the relay server
- forwards prompt text to GitHub Copilot Chat
- streams the response back to Discord

Available commands:

- `Remote Copilot: Authorize Copilot Access`
- `Remote Copilot: Show Relay Output`
- `Remote Copilot: Reconnect Relay`

## Current limitations

- Remote approval for tool calls is **not implemented yet**
- The Discord bot currently denies permission requests instead of letting a Discord user approve them interactively
- The extension is not yet fully prepared for VS Code Marketplace publishing
- The extension does **not** connect to Discord directly; Discord integration happens only through the bot

## Packaging the VS Code extension

Right now the extension is buildable but not yet Marketplace-ready.

What already exists:

- extension entry output at `packages/vscode-extension/dist/extension.js`
- manifest at `packages/vscode-extension/package.json`
- build step via `pnpm --filter @remote-copilot/vscode-extension build`

What still needs to be added before publishing:

- `publisher` metadata
- removal of `"private": true`
- VSIX packaging workflow
- Marketplace publishing workflow

Also note:

- installing the extension would **not** request Discord webhook setup
- it would only connect to the configured relay URL
- Copilot access must still be authorized locally in VS Code

## Recommended next step

After cloning and installing dependencies, do this in order:

1. `pnpm env:generate`
2. Fill in `.env.dev`
3. Start the relay server
4. Start the Discord bot
5. Run the VS Code extension in the Extension Development Host
6. Authorize Copilot access in VS Code
7. Run a `/copilot` command from Discord
