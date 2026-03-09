# Project TODO

## Run locally

- [x] Create a Discord bot in the Discord Developer Portal
- [x] Invite the bot to your test server
- [x] Fill in `.env.dev` from [examples/.env.example](examples/.env.example)
- [x] Start the relay server
- [x] Start the Discord bot
- [x] Run the VS Code extension in an Extension Development Host
- [x] Set `remoteCopilot.clientId` and `remoteCopilot.relayUrl` in VS Code
- [x] Run `Remote Copilot: Authorize Copilot Access`
- [x] Test `/copilot` from Discord

For the exact local run flow, see [docs/local-development.md](docs/local-development.md).

## Release setup

- [x] Verify the release workflow is enabled in [.github/workflows/release.yml](.github/workflows/release.yml)
- [x] Confirm pushes to `main` should remain the only release trigger
- [x] Test release logic with `pnpm release:dry-run`
- [x] Merge a real `feat` or `fix` commit into `main` and confirm release and tag creation

## VS Code Marketplace shipping

- [ ] Decide the VS Code Marketplace publisher name
- [ ] Add extension publishing metadata to [packages/vscode-extension/package.json](packages/vscode-extension/package.json)
- [ ] Remove `"private": true` from [packages/vscode-extension/package.json](packages/vscode-extension/package.json)
- [ ] Add VSIX packaging
- [ ] Fill in the placeholder ship workflow in [.github/workflows/deploy-ship.yml](.github/workflows/deploy-ship.yml)
- [ ] Add Marketplace publish secrets or tokens

## Open product gaps

- [x] Implement remote permission approval flow in Discord instead of auto-deny
- [ ] Add authentication or shared-secret security for relay clients
- [x] Add end-to-end CI coverage
- [ ] Add Marketplace packaging documentation

## Suggested order

1. Finish the local Discord + VS Code end-to-end test
2. Verify GitHub release automation
3. Implement VS Code Marketplace packaging
4. Improve remote approval and security

---

# Next Phase TODOs for copilot-remote-control

## Priority Tasks

1. **CLI User Onboarding & Prerequisites**
   - Write clear instructions for users on creating a Discord bot project in the Developer Portal.
   - Document required secrets (app id, server id, bot token) and how to provide them via CLI prompts.
   - Add a "Prerequisites" section to the main README and CLI onboarding flow.

2. **Install and Integrate CLI Prompt Library**
   - Evaluate and install `commander` or a lighter alternative for CLI prompts.
   - Implement interactive prompts for first-time setup (bot secrets, relay config).
   - Implement an `init` command that does the above should the user need to reconfigure. The aforementioned step should call `init` on any available commands, if any of the required secrets are missing, but preserving the ones that exist thus not overriding them.

3. **Concurrent Startup Command**
   - Develop a single CLI command (e.g., `copilot-rc start`) that launches both relay-server and discord-bot concurrently.
   - Ensure relay-server starts before bot attempts to connect.

4. **VSCode Extension Error Notification**
   - Add error handling in the extension to notify users if relay-server is not running or required extension settings are missing.
   - Provide actionable error messages and setup guidance (if applicable).

## Secondary Tasks

1. **Semantic Release & Automated Publishing**
   - Improve semantic release config to automate version bumps and npm publishing for relay-server and discord-bot. Or if the simplest approach is to bump all packages, but exclude publishing VSCode to NPM.
   - Create a publishing script that triggers VSCode extension marketplace publish after npm publish completes for relay-server and discord-bot and then create a complementing workflow file that includes executing this script as step in its own.
   - Create `publish.yml` workflow that has 2 jobs, one that does NPM publishing and the other vscode extension, which has dependency on the success of the first.

2. **Monorepo Bin Packaging**
   - Publish relay-server and discord-bot as a single bin under `copilot-rc` npm package.
   - Exclude VSCode extension from npm package; publish it separately to the marketplace.

---

### Implementation Notes

- Prioritize user onboarding, CLI prompts, concurrent startup, and extension error handling.
- Use commander or a suitable alternative for CLI UX.
- Ensure robust error handling and clear instructions for all user-facing flows.
- Automate publishing workflows for seamless releases.
