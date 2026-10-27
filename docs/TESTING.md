# Testing

Three layers, from cheapest to most realistic. None of them needs an Anthropic key.

| Layer | What it checks | Needs | Command |
|-------|----------------|-------|---------|
| Unit tests | Pure logic (rules matcher, credit conversion, progress, exchange rules, demo login, deadlines) | Node only | `npm run test:unit` (in `src/api`) |
| API smoke | A running API end to end: login per role, key endpoints and response shapes, scoping | A running API + seeded demo accounts | `npm run smoke -- --base <url>` (in `src/api`) |
| SQL tests | Schema objects, seed data sanity, and the `sp_TriageCourse` contract | A SQL Server / Azure SQL database | `sqlcmd -i database/tests/*.sql` (see below) |

## 1. Unit tests

```bash
cd src/api
npm run test:unit                  # runs every scripts/test-*.ts with tsx, prints a table, exits 1 on any failure
npm run test:unit -- --filter progress   # only files whose name contains "progress"
npm run test:unit -- --verbose           # show each test's own output
```

`scripts/run-all-tests.ts` discovers `scripts/test-*.ts`, so a new test only needs that file name. A test fails if it exits
non-zero or prints a line starting with `FAIL`. No database, network or env file is needed. Current files:
`test-backtest`, `test-credit-deadline`, `test-demo-login`, `test-demo-scenario`, `test-exchange-logic`, `test-progress`,
`test-rules-reader`.

## 2. API smoke suite

Runs against any deployed or local API using Node's built-in `fetch` (Node 18+), no extra packages.

```bash
cd src/api
npm run smoke -- --base https://<app>.azurewebsites.net/api
npm run smoke -- --base http://localhost:3000/api --json smoke-report.json
npm run smoke -- --base https://<app>/api --write        # also runs the self-cleaning mutating check
```

`--base` is the API root including `/api` (or set `SMOKE_BASE`). Other flags: `--json <path>` writes a machine-readable
report, `--timeout <ms>` (default 20000), `--verbose`.

**Accounts.** The demo accounts from `CLAUDE.md` (run `npm run seed:users` once after seeding a fresh database, otherwise every
login fails). Override per role with environment variables, for example:

```bash
SMOKE_ADMIN_EMAIL=ops@example.edu SMOKE_ADMIN_PASSWORD='...' npm run smoke -- --base https://<app>/api
```

Roles: `STUDENT`, `FACULTY`, `ADMIN`, `AGENCY`, `SUPER_ADMIN` (`SMOKE_<ROLE>_EMAIL` / `SMOKE_<ROLE>_PASSWORD`).

**Output.** One line per check: `PASS`, `FAIL`, `SKIP` (precondition missing, for example the Maya demo is not seeded;
the line says how to fix it) or `INFO` (a note, never fails). A summary follows, and the exit code is 1 if anything failed,
0 otherwise, 2 for a usage error.

**What is checked.**

- `GET /health`; login for each of the five roles.
- `GET /permissions/my` and `GET /dashboard`, `GET /dashboard/bento` for each role.
- Student `GET /progress/me` shape (totals, cap, hub, requests).
- The Maya scenario: the student sees 6 courses over 2 requests (Bay State + Pioneer Valley), 3 on the `applied` lane,
  and the quarter course CIS 150 normalised to 2.66. Skipped with a hint when the demo is not seeded.
- Staff `GET /requests/queue` and `GET /requests/:id` timeline; `GET /transfers/summary` shape.
- `GET /ai-controls/readiness` and `GET /ai-controls/backtest` (rates must lie between 0 and 1, top-3 not below top-1).
- `GET /documents/status`; public `GET /auth/demo-login` (shape) and `GET /auth/universities` (at least 3; if the synthetic
  BSCC/PVTC colleges appear it is reported as INFO).
- Scoping: unauthenticated calls give 401; a student calling staff endpoints gets 403; an admin calling a super-admin
  endpoint gets 403.
- `GET /email/templates` preview list.
- With `--write` only: creates a document request (super admin, from the *source university* side, so no mailbox is
  contacted for the synthetic colleges) on one of Maya's demo requests and cancels it straight away. If the cancel
  step fails the check says so; remove the request "Smoke test ... please ignore" by hand.

Read-only runs change nothing, other than the normal side effects of logging in (refresh tokens, audit entries).
Demo login being enabled on a production system is reported as INFO.

## 3. SQL tests

Files live in `database/tests/`, **not** in `database/migrations` or `database/seed`, so the db-script-runner and the
db-mcp-server never list them as scripts and never record them in `dbo.__ScriptRunnerHistory`.

| File | What it does | Writes? |
|------|--------------|---------|
| `smoke.sql` | Every table, key column, check constraint, view and procedure the app uses exists (migrations 002-024); `sp_TriageCourse` is the effective-dates version with the quarter conversion; migration/seed files 001-024 / 001-017 are in the ledger as successful; BU/NU/NYU present, equivalencies exist, no student without a target university, Maya's two demo transcripts and CIS 150 = 2.66, no orphan rows in the exchange tables | No (a session temp table only) |
| `triage-contract.sql` | Inside `BEGIN TRAN ... ROLLBACK`, creates throwaway colleges, courses, equivalencies and two transcripts, runs `sp_TriageCourse` the way the app does and compares lane, normalised credits and grade eligibility for 11 cases (exact equivalency, C-, P, unknown grade, quarter 4 and 5 credits, no equivalency, `bu_only`, expired and future-dated equivalency, 5-credit lab) | Only inside the transaction, rolled back; finishes by checking nothing is left |

Results are `PASS`, `FAIL`, `WARN` (look, not fatal) or `SKIP` (precondition absent). Both files `THROW` at the end when
anything failed, so `sqlcmd -b` returns a non-zero exit code.

### Run with sqlcmd (local SQL Server, LocalDB or Azure SQL)

Connect straight to the database; the files have no `USE` (Azure SQL cannot switch databases).

```bash
# Azure SQL / networked SQL Server
sqlcmd -S codecrafterstransferhub.database.windows.net,1433 -d TransferHubDB -U codecrafters -P "$DB_PASSWORD" -N -C -b -i database/tests/smoke.sql
sqlcmd -S codecrafterstransferhub.database.windows.net,1433 -d TransferHubDB -U codecrafters -P "$DB_PASSWORD" -N -C -b -i database/tests/triage-contract.sql
# LocalDB (Windows)
sqlcmd -S "(localdb)\MSSQLLocalDB" -d TransferHubDB -E -b -i database\tests\smoke.sql
```

The machine must be allowed by the Azure SQL firewall (the Claude sandbox is not). SSMS or Azure Data Studio also works:
open the file, make sure the database selector says `TransferHubDB`, run it, read the result grid.

### Run through the db-script-runner or db-mcp-server

Both tools only run files from the folders they list (`database/migrations`, `database/seed`) and would record the file in the
ledger, which is not wanted for a test. Use them for the *connection settings* only:

- **db-script-runner** (`tools/db-script-runner/`): load `src/api/.env` for the server and credentials, then run
  `sqlcmd` from a terminal with the same values as above. Or point the runner's script folder at `database/tests` for a
  one-off session; the history table would then list the test files, so do this on a throwaway copy only.
- **db-mcp-server** (`tools/db-mcp-server/`): it reads `src/api/.env` too. Its tools (`run_migrations`, `run_seeds`) take
  the two standard folders; use `test_connection` to confirm access, then run the SQL files with `sqlcmd` as above. The
  server runs each script in one transaction on one pinned connection, which is the same behaviour the test files assume
  (one batch, session temp tables), should a client ever be pointed at them directly.

After applying new migrations or seeds, run `smoke.sql` to confirm the objects arrived, and `triage-contract.sql` after
any change to `sp_TriageCourse` or `sp_RecordDecision`.

## What is not covered

- **No browser/UI tests.** Screens, responsive layout and the Excel/partner upload flows are checked by hand.
- **The smoke suite does not exercise every endpoint.** Mutating flows (submitting a transcript, workflow approvals, bulk
  actions, uploads, registration, intake claim, partner API with keys, appeals) are not run; only the one `--write` check
  exists. Email delivery is never asserted (Resend may no-op or reject).
- **No API integration tests** against a real database in CI; the unit tests use pure functions with no database.
- **SQL tests have not been run in the Claude sandbox**: it has no SQL Server and cannot reach Azure SQL. They are
  reviewed by reading, so run them once on a database before relying on them. `smoke.sql` covers migrations 001-024 and
  seeds 001-017; later files (025 onward) are not asserted yet.
- **AI paths** (Claude matching, document reading with a real key) are untested; only the built-in rules fallback is.
- **Policy engine** (`TransferPolicyService`: pass/fail, age, accreditation, cap, outside-US) has no automated tests; the
  SQL contract covers the procedure only, and notes where the application layer takes over.
- **The 5-credit lab rule and other open BU policy points** (`docs/BU_OPEN_QUESTIONS.md`): current behaviour is pinned
  where possible, but the tests do not decide what is right.
- **Known finding pinned, not fixed:** `sp_TriageCourse` gives lane `applied` for a `bu_only` mapping, so its
  `elective_only` branch cannot be reached (`triage-contract.sql` case 8).
- **Load, security and accessibility testing** are out of scope.
