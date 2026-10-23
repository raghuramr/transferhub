# Project memory — BU Transfer Credit Evaluation

Read this first in any new session on this repo. It captures decisions made
in prior sessions so they don't need to be re-derived or re-asked.

## Stack (as built)
- UI: React 19 + Vite + Tailwind v4 + TanStack Query + framer-motion (`src/ui`)
- API: NestJS + TypeScript (`src/api`)
- DB: SQL Server (Azure SQL Database in production) — raw `mssql`/`tedious`,
  no ORM, stored procedures for core business logic (`sp_TriageCourse`,
  `sp_RecordDecision`)
- AI: Anthropic Claude API directly (`@anthropic-ai/sdk`) — **not** Azure AI
  Foundry. Decision made explicitly: keep the existing direct-API
  integration since prompts/output parsing are already tuned for it: no
  reason to re-platform.

## Deployment decision (confirmed)
Going **all-Azure** — user explicitly rejected Vercel and serverbyt.in.
- UI → Azure Static Web Apps (or same App Service as the API — see "open
  decision" below)
- API → Azure App Service (Linux, Node 20) — **must not be the Free/F1
  tier**, it sleeps on idle and breaks background cron + adds chat latency
- DB → Azure SQL Database — user already has this provisioned

See `DEPLOYMENT.md` for the full walkthrough (Azure SQL provisioning, the
migration caveat below, Render/Vercel instructions are now superseded by
the all-Azure decision but the DB section still applies).

## AI Agents plan (confirmed scope — not yet built)
Three capabilities requested, in this build order:
1. **Background agent** — `@nestjs/schedule` cron job inside the existing
   API process, calls the existing `AiService.matchCourse` logic
   automatically (e.g. on newly-queued evaluations). No new Azure resource
   needed — pure code change.
2. **Chat agent** — new NestJS module implementing an agent loop using
   Claude's native tool-use/function-calling: define tools mapping to
   existing services (`runAIMatch`, `decideEvaluation`, `listPendingForms`,
   etc.), loop until Claude stops requesting tools. Exposed as one REST
   endpoint (`/agent/chat`); React chat widget calls it. No Azure AI
   Foundry — same direct Anthropic API key as everything else.
3. **Workflow builder** — Azure Logic Apps (Consumption tier), HTTP
   connector calls the API's own endpoints as steps. API never exposes the
   Anthropic key to Logic Apps — the key only ever lives server-side in
   the API.

Status as of last session: **none of the three implemented yet** — only
discussed/scoped. Next step when resumed: start with #1 (pure code,
no infra needed).

## Infra ask-list (already handed to IT/provisioning — see full form in
chat history if needed, repeated here for quick reference)
- Resource Group
- App Service (Linux, Node 20, paid tier)
- Azure SQL Database (have this already)
- Azure Key Vault (Anthropic key, JWT secret, SQL credentials)
- Managed Identity on the App Service (reads Key Vault)
- Azure Logic Apps (Consumption)
- Application Insights
- Firewall/egress: outbound 443 to `api.anthropic.com`; Azure SQL firewall
  allow rule for the App Service; inbound 443 to the App Service

**Open decisions still pending from the user's side:**
- Azure DevOps Repos vs. keep GitHub + Azure Pipelines/GitHub Actions for CI/CD
- Exact App Service tier/SKU (B1/S1/etc.)
- Single Web App serving both UI+API (needs `@nestjs/serve-static` + build
  changes, gets same-origin so no CORS config needed) **vs.** two Web Apps
  under one Plan (simpler, independent deploys, needs CORS_ORIGIN set)

## Confirmed facts (verified by actually testing, not just claimed)
- **Fresh DB + scripts**: running `migrations/001` through `007` then
  `seed/001` through `006` in order against a completely empty SQL Server
  produces the full schema correctly — proven by running the whole set
  against a clean Docker SQL Server instance mid-session. One exception:
  **Azure SQL Database specifically** can't run `001_create_database.sql`
  as-is (no cross-database `USE` mid-connection) — create the DB as its
  own Azure resource first, then run `002` onward connected directly to it.
- **DB credentials are 100% env-driven** — `database.service.ts` /
  `sql-connection.util.ts` have zero hardcoded server/host values. Pointing
  at a new SQL Server is purely an `.env` change (`DB_SERVER`, `DB_PORT`,
  `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_ENCRYPT`, `DB_DRIVER`,
  `DB_TRUSTED_CONNECTION`), no code change.
- LocalDB requires `DB_DRIVER=msnodesqlv8` (tedious is TCP-only, can't
  reach `(localdb)\...`). Azure SQL / any real SQL Server over TCP uses
  plain `DB_DRIVER=tedious` with `DB_ENCRYPT=true`.

## Known demo accounts (after `npm run seed:users`)
| Role | Email | Password |
|---|---|---|
| Student | `student@test.edu` | `Student@123!` |
| Faculty | `faculty.cs@bu.edu` | `Faculty@123!` |
| Admin | `admin@bu.edu` | `Admin@123!` |
| Agency | `agency@partner.edu` | `Agency@123!` |
| Super Admin | `super_admin@bu.edu` | `SuperAdmin@123!` |

## Workflow reminders for this repo
- Feature branch: `claude/sleepy-maxwell-mzyijb` — merge into `main` after
  each change set (this has been the pattern all session; keep doing it
  unless told otherwise)
- Always run `npx tsc --noEmit` in both `src/api` and `src/ui` before
  committing
- SQL Server reserved keywords bite here more than once (`Schema` broke a
  `CREATE TABLE` — renamed to `SchemaJson`) — double-check column names
  against the T-SQL reserved word list when adding new tables
