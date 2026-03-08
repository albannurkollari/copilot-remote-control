---
name: workflow-routing
description: Helps the agent decide when to keep working in Local mode, when to recommend switching to @cli, and when to use a hybrid flow.
---

## Workflow Routing

This skill teaches the agent how to choose between Local mode and `@cli` mode for a given task.

The goal is not to force one mode for everything.
The goal is to pick the mode that best matches the work and to tell the user clearly when a switch would help.

## Shell And Terminal Preferences

When command execution is part of the workflow, prefer `Bash` as the default shell.

Rules:

- Use `Bash` as the go-to shell unless the task clearly requires PowerShell-specific behavior or the user explicitly asks for PowerShell.
- If both shells are viable, choose `Bash`.
- For sequential commands in the same workflow, prefer reusing the active shared integrated terminal.
- Avoid spawning a fresh terminal for each command when the existing terminal context is sufficient.
- Open a separate terminal only when necessary for concurrent long-running work, background processes, isolation, or preserving an existing command flow.

## Mode Definitions

### Local

Use Local when the task benefits from editor awareness, workspace context, symbol navigation, diagnostics, or direct code edits.

Think:

- code understanding
- semantic refactors
- multi-file edits
- diagnostics-driven fixes
- extension and API work
- tracing references and usages

### `@cli`

Use `@cli` when the task is primarily shell-driven and is best handled through terminal commands and command output.

Think:

- builds
- tests
- logs
- process management
- Git inspection
- repo automation
- repeated command loops
- remote or headless workflows

When using `@cli`, prefer `Bash` and reuse the active shared terminal for sequential steps whenever practical.

## Primary Decision Rule

Choose the mode based on the dominant kind of work.

- If the task is mainly about understanding, changing, or refactoring code, prefer Local.
- If the task is mainly about running commands, inspecting output, or automating shell workflows, prefer `@cli`.
- If the task requires both, recommend a hybrid flow and say which part belongs in which mode.

## Hard Priority Rules

1. If the user explicitly asks for Local, prefer Local.
2. If the user explicitly asks for `@cli`, prefer `@cli`.
3. If the user asks for codebase reasoning across multiple files, prefer Local unless they explicitly want a shell-only approach.
4. If the user asks for build, test, logs, process control, or Git-heavy execution, prefer `@cli` unless editor diagnostics are clearly more important.
5. If the user asks for both implementation and validation, prefer a hybrid recommendation.

## Trigger Conditions For Local

Recommend Local when the task includes signals like:

- "refactor"
- "update all usages"
- "find references"
- "fix TypeScript errors"
- "change the protocol and propagate it"
- "edit the VS Code extension"
- "understand how this code works"
- "make a safe multi-file change"

## Trigger Conditions For `@cli`

Recommend `@cli` when the task includes signals like:

- "run the tests"
- "build the repo"
- "check logs"
- "inspect process output"
- "run pnpm commands"
- "Git workflow"
- "automate this repetitive sequence"
- "work over SSH"
- "do this from a terminal"

## Trigger Conditions For Hybrid Flow

Recommend a hybrid approach when the task looks like:

- implement a code change, then run build/test loops
- change shared types, then validate consumers
- diagnose a failure from logs, then patch code
- inspect failing tests, edit code, then rerun commands

In these cases, tell the user something like:

- use Local for the code change
- use `@cli` for validation and runtime inspection

## Monorepo-Specific Guidance

For this repository, prefer Local for:

- changes to shared protocol types and all consumers
- VS Code extension behavior
- Discord bot command flow edits
- relay message routing changes across packages
- tracing references across `packages/*`

For this repository, prefer `@cli` for:

- `pnpm --filter ... dev`
- `pnpm -r build`
- `pnpm -r test`
- inspecting dev server output
- checking coverage/test artifacts
- Git status, diff, commit, and history inspection

## How To Respond

When this skill applies, do not just answer the user's task.
Also provide a short routing recommendation.

Use this structure when helpful:

- Recommended mode: Local / `@cli` / Hybrid
- Why: one sentence about the dominant task type
- If hybrid: say which subtask belongs to which mode

Keep it brief unless the user asks for detail.

If command execution is relevant, align the recommendation with the shell preference:

- prefer `Bash`
- prefer the active shared terminal for sequential work
- mention a separate terminal only when there is a concrete reason

## Examples

### Example 1

User intent:

"Update the shared protocol and fix all TypeScript breakage."

Recommendation:

- Recommended mode: Local
- Why: this is a semantic multi-file refactor across packages

### Example 2

User intent:

"Run tests for the relay server until they pass and inspect failures."

Recommendation:

- Recommended mode: `@cli`
- Why: this is command-loop and output-driven work

### Example 3

User intent:

"Implement the feature and then validate the build and tests."

Recommendation:

- Recommended mode: Hybrid
- Why: code editing fits Local, validation fits `@cli`

## Cautions

- Do not recommend mode switching for trivial reasons.
- Do not suggest `@cli` just because a single command might be useful.
- Do not suggest Local just because code exists somewhere in the repo.
- Prefer the simplest mode that fits the dominant work.
- If the current mode already fits well enough, say no switch is necessary.
- Do not default to PowerShell when `Bash` would work.
- Do not recommend spawning a new terminal per command without need.

## Default Heuristic

If unsure:

- choose Local for code reasoning and code changes
- choose `@cli` for command execution and operational workflows
- choose Hybrid when implementation and validation are equally important
