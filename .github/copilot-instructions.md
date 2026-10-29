# Copilot instructions — TransferHub

TransferHub is a transfer-credit evaluation platform (Evoke FDE AI Hackathon 5.0, Problem 1, Boston University).

- **UI** (`src/ui`): React 19, Vite, Tailwind v4, TanStack Query.
- **API** (`src/api`): NestJS 10, raw SQL via `mssql`.
- **Database** (`database/`): SQL Server / Azure SQL, numbered idempotent migrations and seeds.

Read `CLAUDE.md` for the project memory (decisions, gotchas, pending items) and `_designs/DISCOVERY.md` for the problem, users and scope.

Role-specific instructions are in `.github/agents/`:

- `dev.agent.md`: implementing features and fixes.
- `devops.agent.md`: build, Azure deployment, database rollout.
- `qa.agent.md`: testing and verification.

The same files exist for Claude Code in `.claude/agents/`.

Always:

- Run `npx tsc --noEmit` in `src/api` and `src/ui` before committing.
- Never push to `main` directly. Every push to `main` deploys to Azure.
- Keep departments in control: AI and rules recommend; people decide.
- Gate mutating endpoints with `@Permission(module, operation)` and guard not-yet-applied schema with `SchemaService.has()`.
