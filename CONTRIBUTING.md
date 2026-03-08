# Contributing to copilot-remote-control

This project requires **Node.js ≥24** and **pnpm ≥10**. Fork the repo, clone it locally, run `pnpm install`, then create a feature branch from `main`. Open a pull request against `main` when your change is ready.

Follow [Conventional Commits](https://www.conventionalcommits.org/) for commit messages (`feat`, `fix`, `docs`, `chore`, …). Write TypeScript with strict mode enabled; run `pnpm lint` and `pnpm test` before pushing.

## Releases

Releases are automated with `semantic-release` through GitHub Actions.

- pushes to `main` can produce stable releases
- release and tagging automation live in [.github/workflows/release.yml](.github/workflows/release.yml)
- downstream shipping automation lives in [.github/workflows/deploy-ship.yml](.github/workflows/deploy-ship.yml)

Conventional Commit messages are important because release versioning is derived from commit history.

- `feat` triggers a minor release
- `fix` triggers a patch release
- `refactor` is treated as a minor release
- `chore` does not trigger a release

You can preview release behavior locally with `pnpm release:dry-run`.

For bugs or feature requests, open an issue first. Include a clear description, reproduction steps, and your environment details (OS, Node.js version, pnpm version, VS Code version).

Please read our [Code of Conduct](./CODE_OF_CONDUCT.md) before contributing.

---

[README](./README.md) · [Code of Conduct](./CODE_OF_CONDUCT.md)
