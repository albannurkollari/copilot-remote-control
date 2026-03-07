# Contributing to copilot-remote-control

First off, thank you for considering contributing to **copilot-remote-control**! 🎉  
Every contribution — big or small — is greatly appreciated.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [How to Contribute](#how-to-contribute)
  - [Reporting Bugs](#reporting-bugs)
  - [Suggesting Enhancements](#suggesting-enhancements)
  - [Submitting Pull Requests](#submitting-pull-requests)
- [Development Setup](#development-setup)
- [Commit Message Convention](#commit-message-convention)
- [Style Guide](#style-guide)

---

## Code of Conduct

This project adheres to the [Contributor Covenant Code of Conduct](./CODE_OF_CONDUCT.md).  
By participating, you are expected to uphold this code. Please report unacceptable behaviour to the maintainer.

---

## Getting Started

1. **Fork** the repository on GitHub.
2. **Clone** your fork locally:
   ```bash
   git clone https://github.com/<your-username>/copilot-remote-control.git
   cd copilot-remote-control
   ```
3. **Install dependencies** using [pnpm](https://pnpm.io):
   ```bash
   pnpm install
   ```
4. Create a **feature branch** from `main`:
   ```bash
   git checkout -b feat/my-feature
   ```

---

## How to Contribute

### Reporting Bugs

Before opening a new issue, please search the [existing issues](https://github.com/albannurkollari/copilot-remote-control/issues) to avoid duplicates.

When filing a bug report, include:
- A clear and descriptive title.
- Steps to reproduce the issue.
- Expected behaviour vs. actual behaviour.
- Your environment (OS, Node.js version, pnpm version, VS Code version).

### Suggesting Enhancements

Feature requests are welcome. Please open an issue with:
- A clear description of the proposed feature.
- The motivation / use-case behind it.
- Any relevant examples or prior art.

### Submitting Pull Requests

1. Ensure your branch is up-to-date with `main`.
2. Write or update tests for your changes where applicable.
3. Run the full test suite and linter before pushing:
   ```bash
   pnpm lint
   pnpm test
   ```
4. Open a pull request against `main` and fill in the PR template.
5. Address any review feedback promptly.

---

## Development Setup

| Tool | Version |
|------|---------|
| Node.js | ≥ 20 LTS |
| pnpm | ≥ 9 |

Copy the example env file and adjust as needed:

```bash
cp .env.example .env
```

---

## Commit Message Convention

This project follows [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short summary>
```

Common types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`.

Examples:
```
feat(discord): add slash command for sending prompts
fix(websocket): handle reconnection on connection drop
docs: update README with setup instructions
```

---

## Style Guide

- **TypeScript** – strict mode enabled; avoid `any`.
- **Formatting** – handled by the project's formatter; run `pnpm format` to apply.
- **Linting** – run `pnpm lint` and resolve all errors before opening a PR.
- **Imports** – use named imports; avoid default exports where possible.
- **Line endings** – LF (enforced via `.gitattributes` and `.editorconfig`).
