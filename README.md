# TransferHub — Smarter Transfer Credit Evaluation

**Team Clopay CodeCrafters** · Evoke FDE AI Hackathon 5.0 · Problem 1 (Boston University)

TransferHub makes transfer-credit evaluation faster for evaluators and transparent for students, while academic departments keep the final decision.

- A student registers and drops in their documents.
- The system reads the documents and fills the transfer request.
- Each course is triaged against known equivalencies and BU policy.
- AI (or a zero-token rules engine) ranks the likely BU equivalents.
- Faculty and admins approve through a configurable workflow.
- Every decision is saved for reuse with the next student.

| | |
|---|---|
| **Live site** | <https://transferhub.wcubeprojects.in/> |
| **Repository** | <https://github.com/Evoke-Hackathon-2026/Clopay-CodeCrafters> |
| **Demo video** | _SharePoint link — add here_ |
| **Slides** | Full deck and demo deck in [`_designs/deck/`](_designs/deck/) (also on SharePoint) |
| **One-page overview** | [`_designs/ClopayCodeCrafters.html`](_designs/ClopayCodeCrafters.html) |

## Submission contents

| # | Deliverable | Location |
|---|---|---|
| 1 | Source code + this README (setup and run) | this repo |
| 2 | Discovery doc: problem, users, requirements, scope | [`_designs/DISCOVERY.md`](_designs/DISCOVERY.md) |
| 3 | Agent instruction files (Dev, DevOps, QA) | [`.claude/agents/`](.claude/agents/) (Claude Code) · [`.github/agents/`](.github/agents/) + [`.github/copilot-instructions.md`](.github/copilot-instructions.md) (GitHub Copilot) |
| 4 | Working demo video | SharePoint (link above) |
| 5 | PPT (full + demo) | [`_designs/deck/`](_designs/deck/) |
| — | Asked vs. built (traceability) | [`_designs/REQUIREMENTS_TRACEABILITY.md`](_designs/REQUIREMENTS_TRACEABILITY.md), [`_designs/GAP_ANALYSIS.md`](_designs/GAP_ANALYSIS.md) |

## Tech stack

| Layer | Technology |
|---|---|
| Frontend (`src/ui`) | React 19, Vite, Tailwind CSS v4, TanStack Query, React Router 7, framer-motion, recharts, zustand, react-hook-form + zod |
| Backend (`src/api`) | NestJS 10 + TypeScript, passport-JWT, argon2, class-validator, Swagger, helmet, throttler, SSE live events |
| Database | Azure SQL Database / SQL Server via `mssql`/`tedious`. Core rules are in the stored procedures `sp_TriageCourse` and `sp_RecordDecision`; schema changes are numbered, idempotent SQL scripts in `database/` |
| AI | Azure OpenAI via Azure AI Foundry (in use today) and Anthropic Claude, both configured. More providers can be added when required: any OpenAI-compatible service, plus Azure Document Intelligence for reading. A built-in zero-token rules engine takes over when no provider is active or the budget is spent |
| Cloud | Azure App Service (one Node app serves the API and the SPA), Azure Blob Storage, Resend email, GitHub Actions CI/CD |

## Roles

| Role | Who | Can do |
|---|---|---|
| `student` | Transfer applicant | Register, upload documents, submit and track requests, explore universities, appeal, cancel |
| `faculty` | Department evaluator | Review courses at their workflow stage, compare side by side, decide equivalencies |
| `admin` | Credit Evaluation staff | Run the approval queue, manage students and workflows for their universities |
| `agency` | Partner agency | Submit and follow requests on behalf of students |
| `super_admin` | Platform owner | Master data, workflows, AI controls and spend, roles & permissions, demo tools |

A super admin can also create **custom roles**. Each custom role is built on one of the base roles and has its own grants in the permissions matrix.

## Repository layout

| Path | Contents |
|---|---|
| `src/ui` | React single-page app |
| `src/api` | NestJS API (one module per area: `requests`, `ai`, `policy`, `documents`, `workflows`, …) |
| `database/migrations`, `database/seed` | Numbered, idempotent SQL scripts — run in filename order |
| `database/tests` | SQL smoke and triage contract tests |
| `tools/db-mcp-server`, `tools/db-script-runner` | Apply migrations/seeds (CLI/MCP, or a Windows GUI) with a shared history table |
| `docs/` | Demo script, partner API, testing, Swagger, open questions for BU, demo data sets |
| `_designs/` | Discovery, understanding notes, traceability, gap analysis, decks, one-page overview |
| `.github/workflows/main_codecrafters.yml` | Build and deploy to Azure App Service on push to `main` |

## Run it locally

### Prerequisites

- Node.js 20 or newer (CI uses 22).
- A SQL Server you can reach over TCP: SQL Server Express/Developer, a Docker `mcr.microsoft.com/mssql/server` container, or Azure SQL. LocalDB also works with `DB_DRIVER=msnodesqlv8`.

### 1. Create the database

1. Create an empty database, for example `TransferHubDB`.
   - On SQL Server you can run `database/migrations/001_database.sql` against `master`.
   - On Azure SQL, create the database in the portal instead.
2. Apply the migrations, then the seeds, each in filename order. The easiest way is the bundled runner, which reads the same `DB_*` settings as the API:

```bash
cd tools/db-mcp-server
npm install
DB_SERVER=localhost DB_PORT=1433 DB_NAME=TransferHubDB DB_USER=sa DB_PASSWORD='<password>' DB_ENCRYPT=false npm run apply:all
```

On Windows you can use the GUI instead: `tools/db-script-runner/Run.bat`.

### 2. Configure and start the API

```bash
cd src/api
cp .env.example .env      # fill DB_*, JWT_SECRET; AI and email keys are optional
npm install
npm run seed:users        # sets real passwords for the demo accounts (required once after seeding)
npm run start:dev         # http://localhost:3001/api  ·  Swagger at /api/docs
```

### 3. Start the UI

```bash
cd src/ui
npm install
npm run dev               # http://localhost:5173 (proxies /api to :3001)
```

On Windows, `./start-dev.ps1 [-Seed]` installs dependencies and starts both servers.

### Demo accounts

These work after `npm run seed:users`.

| Role | Email | Password |
|---|---|---|
| Student | `student@test.edu` | `Student@123!` |
| Faculty | `faculty.cs@bu.edu` | `Faculty@123!` |
| Admin | `admin@bu.edu` | `Admin@123!` |
| Agency | `agency@partner.edu` | `Agency@123!` |
| Super Admin | `super_admin@bu.edu` | `SuperAdmin@123!` |

### Optional settings

These go in `src/api/.env` locally, or in App Service application settings.

- **AI providers:** configured in **AI Controls → Providers**. The deployed site uses Azure OpenAI (Azure AI Foundry), and Anthropic is also set up; `ANTHROPIC_API_KEY` is the env-var alternative for Anthropic. With no provider active, the built-in rules engine does every AI step.
- `AZURE_STORAGE_CONNECTION_STRING`: document storage in Azure Blob. Without it, files go to local disk.
- `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `APP_BASE_URL`: email.

## Tests

```bash
cd src/api
npm run test:unit                                           # unit/script tests
npm run smoke -- --base https://transferhub.wcubeprojects.in/api   # HTTP smoke suite (read-only)
npx tsc --noEmit && (cd ../ui && npx tsc --noEmit)          # type checks (run before every commit)
```

SQL smoke and triage contract tests are in `database/tests/`. See [`docs/TESTING.md`](docs/TESTING.md).

## Deploy

A push to `main` runs `.github/workflows/main_codecrafters.yml`:

1. Build the UI.
2. Copy it into the API's `public/` folder.
3. Build the API.
4. Deploy `src/api` to Azure App Service.

Database scripts are applied by hand with `npm run apply:all` (see above), from a machine the Azure SQL firewall allows. See [`DEPLOYMENT.md`](DEPLOYMENT.md).

## Demo walkthrough

[`docs/DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md) has the full script. In short:

1. Register a student.
2. Upload documents in Smart Upload.
3. The courses are captured into the transfer request.
4. Submit the request.
5. The admin or faculty member approves and decides the equivalencies, which feed the AI skills.
6. Configure the workflow stages.
7. As super admin, review AI usage and $ spent.
