---
name: mode-handoff
description: Teaches the agent how to clearly explain when to stay in the current mode, when to switch between Local and @cli, and how to phrase the handoff recommendation.
---

## Mode Handoff

This skill complements `workflow-routing`.

Use it when the user needs a clearer recommendation about whether to stay in Local, switch to `@cli`, or use a hybrid flow.

The purpose of this skill is not just to choose a mode.
It is to explain the choice in a way that is easy for the user to act on in the next prompt or session.

## Shell And Terminal Preferences

When terminal work is appropriate, prefer `Bash` as the default shell.

Rules:

- Use `Bash` as the go-to shell for command execution.
- Do not switch to PowerShell unless the task clearly requires PowerShell-specific behavior or the user explicitly asks for it.
- If both shells could work, prefer `Bash`.

When running multiple sequential commands, prefer the active shared integrated terminal instead of spawning a new terminal for each step.

Rules:

- Reuse the existing shared terminal context when commands are part of the same workflow.
- Preserve command history visibility for the user whenever practical.
- Only start a separate terminal when it is necessary, such as:
	- concurrent long-running processes
	- background services
	- isolating a risky or unrelated workflow
	- avoiding disruption of an existing active command sequence

If a new terminal is necessary, keep the reason short and explicit.

## Core Rule

When recommending a mode, the agent must answer three things clearly:

1. What mode is best right now?
2. Why is that mode best for this task?
3. What should the user do next in that mode?

If a switch is useful, the agent should say so directly.
If a switch is not necessary, the agent should say that directly too.

## Recommendation Format

When this skill applies, prefer this structure:

- Best mode now: Local / `@cli` / Hybrid
- Why: one short sentence
- Next prompt to use: a concrete example the user can paste or adapt
- Switch later?: yes or no, plus the trigger for switching

Keep the response compact unless the user asks for more detail.

## Stay vs Switch Rules

### Stay in Local

Say to stay in Local when:

- the task is mainly about code understanding
- the task is mainly about semantic edits
- the task touches multiple related files
- the task depends on diagnostics, references, or symbol tracing
- the task is safer with editor context

Preferred phrasing:

- "Stay in Local for this one."
- "No switch needed yet."
- "Use Local first, because this is mainly a code reasoning task."

### Switch to `@cli`

Say to switch to `@cli` when:

- the task is mainly about running commands
- the task is iterative and output-driven
- the task depends on logs, build output, or test reruns
- the task is operational rather than semantic
- the user wants a shell-first flow

When recommending `@cli`, assume `Bash` is the preferred shell unless the task requires otherwise.

Preferred phrasing:

- "This is a good point to switch to `@cli`."
- "Use `@cli` here because the terminal is the main interface for the task."
- "Switch to `@cli` for the validation loop."

### Switch to Local

Say to switch back to Local when:

- command output suggests a code change is needed
- the failure spans multiple packages or files
- the task becomes a refactor rather than an inspection
- the user needs help tracing usages or updating types safely

Preferred phrasing:

- "Switch back to Local once you know what needs to change."
- "Use Local for the patch itself."
- "Now that the issue is identified, Local is the better mode for the edit."

### Hybrid

Use Hybrid when the task naturally splits into implementation and validation.

Preferred phrasing:

- "Use Local for the change, then switch to `@cli` for validation."
- "Start in `@cli` to inspect the failure, then switch to Local for the fix."

## Handoff Templates

### Local -> `@cli`

Use this when the code change is done and the next step is operational.

Template:

- Best mode now: `@cli`
- Why: the next step is command-driven validation
- Next prompt to use: "Run the relevant build/test loop for this package and summarize failures."
- Switch later?: switch back to Local only if the output points to a non-trivial code fix

### `@cli` -> Local

Use this when CLI inspection found the problem and now a code patch is needed.

Template:

- Best mode now: Local
- Why: the next step is a code edit across one or more files
- Next prompt to use: "Patch the identified issue and update all affected usages safely."
- Switch later?: switch to `@cli` again after the edit to validate build/tests

### Stay in Local

Template:

- Best mode now: Local
- Why: this is primarily a code understanding or editing task
- Next prompt to use: "Analyze the affected files, implement the change, and explain impact."
- Switch later?: only if you want a build/test/log loop after the edit

### Stay in `@cli`

Template:

- Best mode now: `@cli`
- Why: this is mainly command execution and output inspection
- Next prompt to use: "Run the relevant commands, inspect the output, and summarize what action is needed."
- Switch later?: switch to Local if the next step becomes a non-trivial code patch

When acting in `@cli`, prefer reusing the active shared `Bash` terminal for sequential steps.

## Monorepo-Specific Examples

### Example 1: Shared protocol change

Task:

"Change the shared message shape and update all consumers."

Response shape:

- Best mode now: Local
- Why: this is a multi-package semantic refactor
- Next prompt to use: "Update the shared protocol, patch all usages across packages, and summarize the impact."
- Switch later?: yes, switch to `@cli` after the edit to run the build/test validation loop

### Example 2: Failing relay-server tests

Task:

"Investigate why relay-server tests are failing."

Response shape:

- Best mode now: `@cli`
- Why: the first step is running tests and reading output
- Next prompt to use: "Run the relay-server tests, inspect failures, and identify the likely root cause."
- Switch later?: yes, switch to Local once the failing code path is identified and needs a patch

### Example 3: Repeated dev workflow

Task:

"Help me run the bot and relay locally and watch logs."

Response shape:

- Best mode now: `@cli`
- Why: this is process and log management
- Next prompt to use: "Start the relevant workspace dev commands, watch the output, and call out any startup issues."
- Switch later?: no, not unless log inspection reveals a code change that requires semantic editing

## What Not To Do

- Do not recommend switching modes without explaining why.
- Do not recommend Hybrid for every task.
- Do not keep the recommendation abstract; always include a concrete next prompt.
- Do not say "either is fine" unless the task is genuinely trivial.
- Do not overcomplicate the answer when one mode is clearly dominant.
- Do not default to PowerShell when `Bash` is suitable.
- Do not spawn a fresh terminal for every command in the same workflow without a clear reason.

## Default Heuristic

If the user sounds unsure, respond with a simple action-oriented recommendation:

- "Stay in Local for the implementation, then switch to `@cli` to validate."
- "Start in `@cli` to inspect the failure, then come back to Local for the patch."
- "Stay in Local; no switch needed yet."

## Companion Usage

This skill works best together with:

- `workflow-routing` for deciding the best mode
- `environment-awareness` when shell or Git workflows are involved
