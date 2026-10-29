# Agent instruction files

| File | Agent | Use for |
|---|---|---|
| `dev.md` | `transferhub-dev` | Coding in `src/` and `database/` |
| `devops.md` | `transferhub-devops` | CI/CD, Azure App Service, Azure SQL, Blob Storage, applying migrations |
| `qa.md` | `transferhub-qa` | Type checks, unit/script tests, API smoke, SQL contract tests, UI checks |

Claude Code loads these as subagents automatically.

The same instructions are available for GitHub Copilot in `.github/agents/*.agent.md`, with general repo guidance in `.github/copilot-instructions.md`.

Project-wide memory lives in `/CLAUDE.md`.
