# Project TODO

## Run locally

- [ ] Create a Discord bot in the Discord Developer Portal
- [ ] Invite the bot to your test server
- [ ] Fill in `.env.dev` from [examples/.env.example](examples/.env.example)
- [ ] Start the relay server
- [ ] Start the Discord bot
- [ ] Run the VS Code extension in an Extension Development Host
- [ ] Set `remoteCopilot.clientId` and `remoteCopilot.relayUrl` in VS Code
- [ ] Run `Remote Copilot: Authorize Copilot Access`
- [ ] Test `/copilot` from Discord

For the exact local run flow, see [docs/local-development.md](docs/local-development.md).

## Release setup

- [ ] Verify the release workflow is enabled in [.github/workflows/release.yml](.github/workflows/release.yml)
- [ ] Add the `MV_RELEASE_PAT` repository secret if PAT-based release triggering is required
- [ ] Confirm pushes to `main` should remain the only release trigger
- [ ] Test release logic with `pnpm release:dry-run`
- [ ] Merge a real `feat` or `fix` commit into `main` and confirm release and tag creation

## VS Code Marketplace shipping

- [ ] Decide the VS Code Marketplace publisher name
- [ ] Add extension publishing metadata to [packages/vscode-extension/package.json](packages/vscode-extension/package.json)
- [ ] Remove `"private": true` from [packages/vscode-extension/package.json](packages/vscode-extension/package.json)
- [ ] Add VSIX packaging
- [ ] Fill in the placeholder ship workflow in [.github/workflows/deploy-ship.yml](.github/workflows/deploy-ship.yml)
- [ ] Add Marketplace publish secrets or tokens

## Open product gaps

- [ ] Implement remote permission approval flow in Discord instead of auto-deny
- [ ] Add authentication or shared-secret security for relay clients
- [ ] Add end-to-end CI coverage
- [ ] Add Marketplace packaging documentation

## Suggested order

1. Finish the local Discord + VS Code end-to-end test
2. Verify GitHub release automation
3. Implement VS Code Marketplace packaging
4. Improve remote approval and security
