# Project TODO

## Run locally

- [x] Create a Discord bot in the Discord Developer Portal
- [x] Invite the bot to your test server
- [x] Initialize local config with `pnpm dev:init`
- [x] Start the relay server and Discord bot with `pnpm dev:stack`
- [x] Run the VS Code extension in an Extension Development Host
- [x] Set `remoteCopilot.clientId`, `remoteCopilot.relayUrl`, and `remoteCopilot.sharedSecret` in VS Code
- [x] Run `Remote Copilot: Authorize Copilot Access`
- [x] Test `/copilot` from Discord

For the exact local run flow, see [docs/local-development.md](docs/local-development.md).

## Release setup

- [x] Verify the publish workflow is enabled in [.github/workflows/publish.yml](.github/workflows/publish.yml)
- [x] Confirm release automation runs from pushes to `main` and supports manual dispatch
- [x] Test release logic with `pnpm release:dry-run`
- [ ] Confirm a real `feat` or `fix` merged to `main` creates the release and tag end to end

## VS Code Marketplace shipping

- [x] Decide the VS Code Marketplace publisher name
- [x] Add extension publishing metadata to [packages/vscode-extension/package.json](packages/vscode-extension/package.json)
- [x] Remove `"private": true` from [packages/vscode-extension/package.json](packages/vscode-extension/package.json)
- [x] Add VSIX packaging
- [x] Replace the old placeholder shipping flow with [.github/workflows/publish.yml](.github/workflows/publish.yml)
- [x] Add Marketplace publish secrets or tokens

## Open product gaps

- [x] Implement remote permission approval flow in Discord instead of auto-deny
- [x] Add authentication or shared-secret security for relay clients
- [x] Add end-to-end CI coverage
- [x] Add Marketplace packaging documentation

## Completed next-phase work

- [x] Add CLI onboarding and prerequisites documentation
- [x] Implement interactive `copilot-rc init` setup with `commander`
- [x] Implement `copilot-rc start` / `pnpm dev:stack` concurrent startup flow
- [x] Add VS Code extension relay/configuration warnings and guidance
- [x] Publish `copilot-rc` as the npm package for the relay/bot runtime
- [x] Keep the VS Code extension out of the npm package and publish it separately
- [x] Add unified npm + VS Code Marketplace publishing automation
