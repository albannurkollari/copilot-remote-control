---
name: monorepo-bootstrap
description: Initialize and maintain a pnpm workspace monorepo for Node.js services, bots, and VSCode extensions using TypeScript and tsup. Use this skill whenever creating packages or configuring the workspace.
---

Documentation:
https://pnpm.io/workspaces
https://pnpm.io/pnpm-workspace_yaml
https://nodejs.org/docs/latest-v24.x/api/
https://tsup.egoist.dev/

Goal

Maintain the monorepo architecture for the remote Copilot control system.
All packages must live inside the `packages` workspace and follow the same runtime and build rules.

Runtime Rules

Use Node.js v24 or later.

During development Node should execute TypeScript files directly.

Example:

node src/index.ts

Do not introduce:

- ts-node
- tsx
- babel
- nodemon

Compilation should only occur during the build step.

Package Manager

Use pnpm exclusively.

Never use:

- npm
- yarn
- bun

Workspace Configuration

The workspace must be defined in `pnpm-workspace.yaml`:

packages:

- "packages/\*"

Repository Structure

remote-copilot-control/
.github/
packages/
shared/
relay-server/
discord-bot/
vscode-extension/

Shared Package

The shared package defines the protocol used by all services.

Example location:

packages/shared/src/protocol.ts

Other packages must import types from this package instead of redefining them.

Example dependency:

"dependencies": {
"@remote-copilot/shared": "workspace:\*"
}

Build System

Use tsup to build TypeScript into JavaScript.

Example build command:

tsup src/index.ts --format esm --dts

Each package should include scripts:

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

TypeScript Configuration

All packages must extend the root configuration:

tsconfig.base.json

Example package config:

{
"extends": "../../tsconfig.base.json",
"compilerOptions": {
"outDir": "dist"
},
"include": ["src"]
}

Best Practices

- Keep runtime dependencies minimal.
- Avoid cross-imports between packages except through workspace dependencies.
- Shared types must live in the shared package.
- Prefer ESM modules.

When To Use This Skill

Use this skill when:

- initializing the repository
- adding packages
- configuring TypeScript
- configuring builds
