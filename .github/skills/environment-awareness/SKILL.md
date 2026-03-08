---
name: environment-awareness
description: Enables the agent to understand and use the developer's local Git aliases and custom Bash helper functions instead of recreating workflows manually.
---

## Environment Awareness

This environment contains custom Git aliases and Bash helper functions designed to accelerate development workflows. The agent must inspect and understand these before attempting to implement new shell logic or Git command sequences.

## Git Configuration

Primary Git configuration is located at:

~/.gitconfig

This file defines numerous aliases that wrap complex Git workflows.

### Rules

- Always inspect ~/.gitconfig before constructing Git commands.
- Prefer existing aliases over manually composing equivalent commands.
- If an alias exists that performs the required task, use it.
- Do not reimplement alias logic unless absolutely necessary.

Aliases may include:

- commit helpers
- branch utilities
- history inspection
- cleanup commands
- rebase workflows
- squash helpers
- release workflows

Aliases may internally execute shell commands or multi-step operations.

## Bash Helper Functions

Additional development helpers are stored in:

bash_functions/

These are reusable shell utilities that automate development tasks.

### Rules

Before writing scripts or shell commands:

1. Inspect bash_functions/.
2. Prefer calling existing functions.
3. Avoid duplicating functionality that already exists.

These helpers may include functionality for:

- Git workflows
- repository maintenance
- project setup
- formatting tasks
- automation
- development tooling

## Execution Strategy

When performing development tasks the agent should follow this order:

1. Inspect ~/.gitconfig for relevant aliases.
2. Inspect bash_functions/ for reusable helpers.
3. Use existing abstractions where possible.
4. Implement new logic only when no suitable helper exists.

## Git Safety Rules

When interacting with Git repositories:

- Never use destructive commands unless explicitly instructed.
- Avoid git reset --hard.
- Avoid git push --force unless explicitly requested.
- Preserve repository history.
