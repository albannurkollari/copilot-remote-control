# Local development

This guide covers running the project locally end to end.

## Prerequisites

- Node.js 24+
- pnpm 10
- VS Code with GitHub Copilot Chat available
- A Discord application and bot token
- A Discord server where you can invite the bot

## 1. Install dependencies

From the repository root:

1. Run `pnpm install`
2. Run `pnpm dev:init`
3. Provide your Discord application ID, Discord server ID, and bot token when prompted
4. Copy the printed VS Code settings, including the shared secret, into your local `settings.json`

## 2. Start the relay server and Discord bot

Run:

- `pnpm dev:stack`

Default address:

- `ws://127.0.0.1:8787/`

## 3. Run the VS Code extension

1. Open the repository in VS Code
2. Run `pnpm build`
3. Start the extension in an Extension Development Host
4. Set these VS Code settings:

```json
{
  "remoteCopilot.clientId": "default",
  "remoteCopilot.relayUrl": "ws://127.0.0.1:8787/",
  "remoteCopilot.sharedSecret": "paste-the-generated-secret"
}
```

- Run `Remote Copilot: Authorize Copilot Access`
- Later, run `Remote Copilot: Show Remote Sessions` to inspect saved Discord-driven prompt transcripts inside the extension host
- Run `Remote Copilot: Clear Remote Sessions` to purge the saved transcript history

## 4. Test the full flow

In Discord:

1. Open the server where the bot is installed
2. Run `/copilot`
3. Choose one of:
   - `ask`
   - `plan`
   - `agent`
4. Enter your prompt

The reply should stream back into Discord through the connected VS Code instance.

## Local settings

The extension does not read env files directly. Copy these values into VS Code settings:

- `remoteCopilot.clientId`
- `remoteCopilot.relayUrl`
- `remoteCopilot.sharedSecret`

The extension stores the latest remote transcripts in extension global state and shows them through `Remote Copilot: Show Remote Sessions`.
That state is persisted by VS Code outside the workspace folder, so it survives window reloads and restarts until you clear it.

If you need to reconfigure the bot later, run `pnpm dev:init -- --force`.

## Current local limitations

- Remote approval for tool calls is implemented, but full remote execution behavior still depends on the connected VS Code Copilot agent flow
- The extension is currently intended for local development use
- Marketplace packaging is still a future step
