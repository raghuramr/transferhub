# Project memory — BU Transfer Credit Evaluation

Read this first in any new session on this repo. It captures decisions made
in prior sessions so they don't need to be re-derived or re-asked.

## Repo identity (confirmed) — this IS raghuramr/universitymanager's work
`raghuramr/transferhub` and `raghuramr/universitymanager` are the same
underlying GitHub repository the user has referred to by both names/clone
URLs across sessions. `transferhub`'s `main` branch had fallen behind (it
was missing everything from Roles & Permissions enforcement onward — 34
completed tasks' worth) while its `claude/sleepy-maxwell-mzyijb` branch was
fully current (confirmed identical commit hash to universitymanager's tip
at the time). Merged `claude/sleepy-maxwell-mzyijb` into `main` (one small
conflict-free merge — `main` had one extra commit, an Azure App Service
GitHub Actions workflow file added directly via the Azure Portal) and
pushed. **All work going forward happens directly on `main`** in this repo
— there is no reason to maintain a separate long-lived feature branch now
that `main` is current; the `claude/sleepy-maxwell-mzyijb` branch name is
a historical artifact from how multi-session work accumulated before this
reconciliation, not an ongoing convention.

## Azure SQL Database (confirmed, live)
The database is **TransferHubDB** on
`codecrafterstransferhub.database.windows.net,1433` (SQL login
`codecrafters`). Every migration/seed file's `USE` statement, `.env.example`
/`.env.production`/`.env.test`'s `DB_NAME`, `render.yaml` (stale — kept
consistent anyway), and `seed-users.ts`/`setup-env.ts`'s fallback defaults
were all renamed from the old `CreditEvalManager` to `TransferHubDB`.
- The real credentials live **only** in the gitignored `src/api/.env`
  (created this session, never committed) — that's what local dev
  (`NODE_ENV` unset/`development`) connects to, so local dev and the
  deployed app share the same live data.
- `.env.test` deliberately stays pointed at LocalDB (just `DB_NAME` was
  renamed there) — automated test runs shouldn't mutate/depend on live
  Azure data. Say so explicitly if that's ever actually wanted instead.
- **This sandbox's outbound network cannot reach Azure SQL** (port 1433
  connection attempt timed out) — almost certainly Azure SQL's firewall
  not allow-listing this sandbox's egress IP (the project's own infra
  ask-list already flags "Azure SQL firewall allow rule" as a needed
  item). Migrations/seeds have NOT been applied to the live database from
  a Claude session yet — run them from a machine Azure SQL's firewall
  allows (the user's own machine, presumably, since they created the DB),
  via `tools/db-script-runner/` or the new `tools/db-mcp-server/` (see
  below) once that machine's `src/api/.env` has the real credentials.

## Student self-registration (confirmed, built)
Public registration page at `/register` (`RegisterPage.tsx`, linked from
`/login`) — captures account, communications (mobile + emergency contact),
location (reuses `Users`' existing address fields), education (prior
institution, highest education level, field of study, GPA, graduation
year — new, migration 012), and a target University/Program via cascading
dropdowns.
- `POST /auth/register` (public, no guard) creates the `Users` +
  `StudentProfiles` rows and logs the student straight in (same response
  shape as `POST /auth/login`). `GET /auth/universities` and
  `GET /auth/programs?institutionId=` (also public) back the cascading
  dropdowns — regular `GET /universities`/`GET /courses/programs` require
  a JWT, which an unauthenticated registrant doesn't have yet, so these
  are deliberately separate, minimal-field, read-only endpoints living on
  `AuthController` rather than reused.
- `StudentProfiles.TargetInstitutionId`/`TargetProgramId` (migration 012)
  are **purely informational** — registering does **not** add a
  `UserScopeUniversities` row, so it never narrows the student's own
  visibility (consistent with the existing "students default to seeing
  every University unless an admin explicitly restricts them" decision).
- `publicPrograms()` queries via `ProgramUniversities` (migration 011),
  not `Programs.InstitutionId` directly, so a Program shared across
  multiple Universities correctly shows up under every University that
  offers it, not just its owner.

## DB MCP server (confirmed, built)
`tools/db-mcp-server/` — an MCP server (Node/TypeScript,
`@modelcontextprotocol/sdk`) exposing `test_connection`, `list_scripts`,
`run_migrations`, `run_seeds` as callable tools, so an MCP client (this
one included, via the repo's new `.mcp.json`) can apply
`database/migrations/`/`database/seed/` directly without the PowerShell
GUI. Deliberately shares the **exact same** `dbo.__ScriptRunnerHistory`
ledger table/checksum scheme as `tools/db-script-runner/` — scripts run
through either tool show as Applied to the other. TCP-only (Azure SQL /
networked SQL Server), not LocalDB — defaults to reading `src/api/.env`
for connection settings (so there's one source of truth for local
credentials), overridable via `DB_MCP_ENV_FILE` or an explicit `env`
block in whichever MCP client config loads it. Needs
`npm install && npm run build` in that folder before first use.
Each script runs inside one transaction on one pinned connection (not
`pool.request()` per batch) because seeds such as `003_demo_users.sql` and
`007_course_topics.sql` use `#temp` tables across `GO` batches; running
batches on different pooled connections made them fail with "Invalid object
name '#Gen'" / "Cannot drop the table '#Topics'". A failed script now rolls
back fully. See its
own README for the full setup (Claude Desktop config example included).

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

**Sequencing decision (confirmed):** finish the rest of the UI/data work
first (Universities/Institutions/Agencies CRUD — done; Course Topics +
reference links — done; remaining dashboards/workflow polish) before
starting on any of the three AI Agents above. Once the UI is fully set up,
the AI integration should specifically make use of the Course Topics +
reference links data (migration 009) to read through syllabus-level
documentation per topic, not just the course-level Description field —
this is expected to produce much more precise equivalency matches than
course-title/description matching alone. Keep this in mind when actually
building capability #1/#2 above: the matcher's prompt construction should
pull in `CourseTopics` (title, description, reference links) for both the
BU and external course being compared.

## Course credit-hours check (researched, no change needed)
User flagged that every BU course shows 4 credits and asked to verify. Checked
against BU's own CAS bulletin: BU's stated institutional default is "all
required courses are 4 unit hours unless otherwise noted" — the uniform 4 is
correct, not a seeding bug. Northeastern/NYU courses already vary (4 vs 5 for
lab-attached courses, e.g. NU `CS 2000`=5, `CS 1800`=4). A few of the newer
AI/ML courses have unverified credit values (marked `Verified = 'Check'`)
pending a direct primary-bulletin confirmation — see the comments in
`database/seed/002_courses_and_equivalencies.sql` (the consolidated course
catalog seed — see "DB Script Runner tool" below) for which ones. (This
note used to point at "seed/003"/"seed/010"; those files no longer exist
after the migrations/seed consolidation.)

## Course Topics (confirmed, built)
Courses can now be broken down into **Topics** (migration 009:
`CourseTopics`, JSON `ReferenceLinksJson` column for `{label, url}` pairs),
editable only by `super_admin`/`admin`/`faculty` (enforced via `@Roles` on
`CourseTopicsController`); any authenticated role can view them read-only.
UI: a "Topics" action per row in `CourseDatabase.tsx` opens
`CourseTopicsEditor.tsx`. Purpose: give the future AI matcher
syllabus-level detail to compare, not just the course title/description.

## Uploads subsystem (confirmed, built)
Migration 013 adds an `Uploads` table + `src/api/src/uploads/` module.
Two separate storage/serving paths, by design — never mixed:
- **Private (student/agency documents, e.g. Custom Forms file-upload
  fields)**: written to `storage/uploads/{role}/{userId}/{entityType}/
  {entityId}/{originalFilename}`, *outside* any web-servable public root.
  Served only via authenticated `GET /uploads/:id` — 403s unless the
  requester is the uploading user or has an `admin`/`super_admin`/
  `faculty` role. The `Uploads` row (owner, role, entity, mime, size) is
  the source of truth for that access check, not the filesystem path
  alone.
- **Public (University/Institution Logo + Hero Image)**: these are meant
  to be visible on a public page, so they're written to
  `storage/public-uploads/{uuid}-{filename}` and served unauthenticated
  via `GET /uploads/public/:id`. `Institutions.LogoUrl`/`HeroImageUrl` and
  `AcademicUnits.LogoUrl`/`HeroImageUrl` (migration 013) each store a
  single string that's either one of these `/uploads/public/:id` URLs or
  an external `https://...` URL — the admin UI
  (`components/shared/ImageSourceField.tsx`) lets the admin pick either.
- Custom Forms gained a `'file'` field type (`FieldEditor.tsx`,
  `FormRenderer.tsx`); the frontend uploads the file first (private,
  `entityType: 'form_submission'`) and stores `{id, url, name}` in the
  submission's JSON payload. No `forms.service.ts` change was needed
  beyond the field-type allowlist — the submission `Data` column was
  already a flexible JSON blob.
- **University public page generation**: `POST /universities/:id/
  generate-page` aggregates `CourseTopics` across all of a university's
  `Courses`, grouped by `Program` (migration 011's Program>Course link),
  and creates/refreshes a Custom Pages CMS page (slug `university-{code}`)
  via the existing `PagesService` — a heading block plus one "cards"
  block per Program listing its Topics. Reuses the CMS rather than a
  bespoke renderer.
- **Known limitation, deferred on purpose** (same pattern as the other
  Azure-infra items below): storage is local disk under `src/api/
  storage/` (gitignored). For the real Azure deployment this should move
  to Azure Blob Storage (private container for documents, public container
  or CDN for logos/hero images) — not built now, noted here so it isn't
  re-discovered as a surprise later.

## Roles & Permissions master data (confirmed, built)
Added a master-data / configuration layer so the SuperAdmin can see and
adjust which Role may perform which Operation on which Module from a
single matrix screen, per their request to "create and assign the modules
and operations based on requirement":
- Migration 014 (`PermissionModules`, `PermissionOperations`,
  `RolePermissions`) — modules like `courses`, `course_topics`, `users`,
  `universities`, `institutions`, `agencies`, `programs`, `pages`, `forms`,
  `audit_log`, `transcripts`, `evaluations`; operations `view`/`create`/
  `edit`/`delete`/`import`/`export`/`bulk_action`. `RolePermissions` is
  keyed on (RoleId, ModuleId, OperationId); absence of a row means "not
  allowed".
- Seed 011 seeds the modules/operations and a starting `RolePermissions`
  grant set that mirrors the actual hardcoded `@Roles()`/`RolesGuard`
  checks in the controllers as of this writing — a starting point for the
  SuperAdmin to adjust, not a guarantee of exhaustiveness.
- New `permissions` module (`src/api/src/permissions/`), super_admin-only:
  `GET /permissions/modules`, `GET /permissions/operations`,
  `GET /permissions/matrix`, `PUT /permissions/matrix` (bulk upsert).
- UI: `src/ui/src/pages/superadmin/RolesPermissions.tsx`, at
  `/superadmin/settings/roles-permissions`, linked from the "Roles &
  Permissions" entry in the super_admin nav (under Settings).

**Update — now wired into live enforcement.** The matrix is no longer
configuration-only; it is consulted at request time:
- A new `@Permission(moduleKey, operationKey)` decorator
  (`src/api/src/auth/permission.decorator.ts`) marks an endpoint as
  DB-driven. `RolesGuard` checks `@Permission()` first when present —
  via `RolePermissionsCacheService` (`src/api/src/auth/
  role-permissions-cache.service.ts`, a 30s in-memory cache of
  `RolePermissions`, invalidated immediately on every
  `PermissionsService.saveMatrix()` write) — and that check REPLACES the
  static `@Roles()` array for that endpoint, so toggling a grant off for a
  role actually blocks it, live, on the very next request. An endpoint
  with no `@Permission()` still falls back to its old `@Roles()` check
  unchanged (additive rollout, not a rewrite of every guard at once).
- Applied to the mutation endpoints (create/edit/delete/import/export)
  across `agencies`, `users` (the pure admin-management endpoints only —
  `findOne`/`update`/`unlock`/`scope` keep their own "self or admin" logic
  since that isn't expressible as a single module grant),
  `universities`, `institutions`, `courses` (+ the new `programs`
  sub-routes), `course_topics`, `pages`, `forms`, and `audit_log`. Pure
  read/list endpoints that were already opened to any authenticated role
  were deliberately left alone (lower risk, and already matches the
  seeded `view` grants). `evaluations`' mixed self/role endpoints were
  left on `@Roles()` for the same reason as the `users` exceptions above.
- `GET /permissions/my` — intentionally open to every authenticated role
  (not just super_admin) — returns the caller's own effective grants as
  `{ [moduleKey]: { [operationKey]: boolean } }`. The UI's
  `usePermissions()` hook (`src/ui/src/hooks/usePermissions.ts`) calls it
  and a `can(moduleKey, operationKey)` check now gates the Import/Export
  buttons and each bulk-action in `UserManagement.tsx`,
  `CourseDatabase.tsx`, `UniversitiesManagement.tsx`,
  `InstitutionsManagement.tsx`, and `AgenciesManagement.tsx` — so a grant
  toggled off in the matrix both hides the control AND (via the backend
  `@Permission()` check) blocks the request if it's called anyway.
  `DataTable` gained a `showExport` prop to let a page actually hide its
  Export button (it previously always rendered one, falling back to a
  naive client-side CSV when no `onExport` was given).
- **Known gap, deliberately out of scope for this pass**: the per-row
  "+Add new" affordances inside `UniversityInstitutionsList` /
  `UniversityProgramsList` (the Universities admin page's nested
  sub-lists) and `CascadingMasterDataSelect.tsx`'s own `canCreate` checks
  still use their original hardcoded role arrays, not the matrix — the
  backend endpoints they call now enforce the real `@Permission()` check
  either way, so this is a UI-polish gap (a disallowed create attempt
  gets a 403 instead of being hidden), not a security one.

## Scope-visibility decision (confirmed — updated)
BU course listings (`findBuCourses`) are now scoped by
`UserScopeUniversities` exactly like external course listings
(`findExternalCourses`) — the earlier "BU is the fixed home institution,
leave it unscoped" choice was explicitly reversed now that the product is
heading toward the multi-tenant SaaS model noted below (BU stops being a
structurally special case, it's just another "University" row). No scope
rows for a user still means unrestricted, unchanged.

**Confirming an already-built capability**: a student (or any user) can be
scoped to an individual Institution (AcademicUnit) *or* to a whole
University directly — these are two independent layers, not an either/or
choice forced on the admin. Built as part of the "Users scope editor: tree
format" work — `UniversityInstitutionTree.tsx` renders Universities as
top-level checkable rows with their Institutions nested/independently
checkable underneath, backed by the separate `UserScopeUniversities` /
`UserScopeAcademicUnits` tables. Checking a University doesn't remove
control over its Institutions and vice versa. No new work was needed here
when this was asked about again — it already does exactly this.

## Programs CRUD + mapping (confirmed, built)
Programs (`Programs` table, consolidated into migration
`003_institutions_courses_programs.sql`; `InstitutionId` FK = UI
"University") previously had only a read endpoint (`GET /courses/programs`)
— no way to create/edit one anywhere in the app, despite Courses and the
cascading master-data picker already referencing `ProgramId`. Closed the
gap:
- `Programs.IsActive` (default 1) + `UpdatedAt` were added, so Programs can
  be soft-deactivated like every other master-data entity (`Courses.
  ProgramId` is nullable and may reference a Program historically, so hard
  delete is never done).
- `CoursesService`/`CoursesController` gained
  `createProgram`/`updateProgram`/`deactivateProgram` — `POST`/`PATCH
  /courses/programs/:id`/`DELETE /courses/programs/:id`, gated via the
  `programs` module in the Roles & Permissions matrix (see below); `GET
  /courses/programs` now also accepts `includeInactive=true` and joins
  `Institutions` so callers get `institutionCode`/`institutionName`, not
  just the raw FK id.
- UI, two entry points (both call the same endpoints):
  1. `UniversitiesManagement.tsx` shows a "Programs" sub-list in each
     University's expanded row (`UniversityProgramsList`, mirroring the
     existing `UniversityInstitutionsList` pattern), stacked below
     Institutions in the right-hand column — create a Program directly
     under that University, or deactivate one.
  2. **`ProgramsManagement.tsx`** (`/superadmin/programs`, nav entry
     "Programs" under super_admin — added after the user reported they
     couldn't find Programs in the nav at all, since unlike Universities/
     Institutions/Agencies, Programs previously had no standalone
     full-catalog page) — a normal `DataTable` list across *every*
     University's Programs at once (filterable by University), with
     create/edit/deactivate. No import/export/bulk-action here since
     those operations were never seeded for the `programs` permission
     module (view/create/edit/delete only) and no backend endpoints exist
     for them — `showExport={false}` on the DataTable reflects that
     deliberately, not an oversight.
  Programs have no "unmapped" concept (they're always created directly
  under a University), so unlike Institutions there's no assign-existing
  flow here.
- `CascadingMasterDataSelect.tsx`'s Program level now has a real
  `canCreate`/`onCreate` wired to the new endpoint (previously hardcoded
  `canCreate={false}` with a comment noting no create endpoint existed —
  that comment/limitation is now resolved).

## Program/Course/Topic sharing across Universities (confirmed, built)
Closed a second gap in the Universities > Programs > Courses > Topics
hierarchy, per explicit user request — a Program can now be offered by
more than one University, pull in Courses from more than one Program, and
a Topic's active/inactive state can be overridden per University. Design
decisions (all confirmed explicitly via `AskUserQuestion` before writing
any migration, since this reshapes relationships added in earlier
sessions):
- **Program <-> University stays owner + shared, not fully M:M.**
  `Programs.InstitutionId` remains the Program's owning/managing
  University — NOT removed. Migration 011 adds `ProgramUniversities
  (ProgramId, InstitutionId)`, backfilled so the owner is always included
  in it too — "every University offering this Program" is always just
  `SELECT * FROM ProgramUniversities WHERE ProgramId = @id`, no special-
  casing the owner in queries. The owner's row can't be removed from this
  list via the API (`removeProgramUniversity` throws a
  `BadRequestException`) — changing who owns a Program means editing the
  Program's own "University" field instead.
- **Course <-> Program became real many-to-many.** Migration 011 adds
  `ProgramCourses (ProgramId, CourseId)`, backfilled from the existing
  `Courses.ProgramId` values. `Courses.ProgramId` itself is left in place
  unchanged (existing display/report queries — the course catalog's
  "Program" column, the university public-page generator — keep working
  off it as the course's original/primary Program) but it's no longer the
  only way a Course relates to a Program: the new Program-management UI
  reads/writes `ProgramCourses` instead, so a Course can now be pulled
  into more than one Program (e.g. a shared intro course used by both a
  CS and a Data Science program).
- **Topic activation is per (University, Topic), not per
  (Program, University, Topic).** Migration 011 adds
  `UniversityTopicStatus (InstitutionId, TopicId, IsActive)` — absence of
  a row means active, the same "absence = allowed" convention
  `RolePermissions` already uses elsewhere in this schema. A topic's
  active/inactive state for a given University is the same everywhere
  that University sees it, regardless of which Program pulled the course
  in (the simpler of the two designs offered — per-Program-AND-University
  overrides were explicitly not chosen).
- API: `CoursesController` gained `GET/POST /courses/programs/:id/
  universities`, `DELETE .../universities/:institutionId`,
  `GET/POST /courses/programs/:id/courses`, `DELETE .../courses/:courseId`
  (all `programs`/`edit` permission-gated except the GETs), plus a new
  generic `GET /courses/by-institution/:institutionId` (any University,
  not just BU or "not-BU" like `findBuCourses`/`findExternalCourses` —
  needed for the cross-university course-attach picker).
  `CourseTopicsController`'s `GET courses/:courseId/topics` now accepts an
  optional `?institutionId=` that adds `isActiveForUniversity` to each
  topic; a new `PUT course-topics/:id/university-status` sets it.
- UI: `ProgramsManagement.tsx`'s expanded row is now a two-column layout
  (edit form left, sharing controls right) with two new sub-components —
  `ProgramUniversitiesList` (assign/remove additional Universities) and
  `ProgramCoursesList` (attach/detach Courses from any of the Program's
  Universities' own catalogs, picked via a University-then-Course
  dropdown pair). Expanding an attached Course shows
  `CourseTopicsUniversityMatrix` — every Topic as a row, one checkbox
  column per University the Program is offered at, toggling that
  Topic's `UniversityTopicStatus` directly.

## Transfer-request approval workflow + AI controls (built; migration 013 / seed 009)
Each transfer request (a `Transcripts` row) now runs through a per-intaking-
university workflow of stages, with agents doing the reading/matching so a
stage owner only clicks approve/reject.
- **Schema**: migration `013_transfer_workflow_and_ai_controls.sql` (approver
  groups, `WorkflowDefinitions`/`WorkflowStages`/`WorkflowStageApprovers`,
  document types + required docs, per-request `TranscriptStages` snapshots,
  `TranscriptNotes` (audience `internal`|`student`), `StatusReminders`,
  `AiSettings`, `AiUsageLog`, `AiMatchCache`, `AgentSkills`, and new
  `Transcripts.TargetInstitutionId/WorkflowId/CurrentStageOrder/WorkflowStatus`).
  Seed `009_workflow_defaults.sql`: 4 approver groups, a global default
  workflow (new > start/AI match > faculty > finance > 1st approver > final
  approver > completed), doc types, AI settings, 7 agent skills, and the
  `requests`/`workflows`/`ai_controls` permission modules.
- **Workflow resolution**: `WorkflowsService.resolveForInstitution` = the
  university's own active workflow, else the global default
  (`InstitutionId NULL`). Target university = `StudentProfiles.TargetInstitutionId`,
  falling back to BU. A stage with no approvers can be acted on by admins.
- **Engine** (`src/api/src/requests/workflow-engine.service.ts`): stage types
  `system|review|approval`; agent tasks `none|intake|match|finalize`. Two
  distinct bypasses: per-stage `CanBypass` (admin skips one stage) and the
  workflow's `AllowBypass` (admin accepts the whole request). Notes: internal
  notes are visible only to people in that stage's approver set + admins.
  Student/staff reminders are rate-limited (24h / 12h). `startWorkflow`
  failing never fails a transcript submission.
- **AI controls** (`/ai-controls`, UI `AiControls.tsx`): global + per-university
  switches/budgets, cheap model with escalation, lexical catalogue shortlist
  (zero tokens), cross-student match cache, prompt caching, editable agent
  playbook (`AgentSkills`), `AiUsageLog` token/cost/tokens-saved per call and
  per request. The briefing text for reviewers is a free template unless
  `narrativeBriefEnabled`. Rules thresholds in `sp_TriageCourse` are still
  fixed (not yet configurable per university).
- **UI**: `/requests` + `/requests/:id` (staff), vertical animated timeline
  (`components/workflow/`), student `TranscriptStatus` shows it with notes,
  documents, and a "nudge" reminder; admin pages `WorkflowDesigner.tsx`
  (`/superadmin/settings/workflows`, `/admin/workflows`) and `AiControls.tsx`
  (`/superadmin/settings/ai-controls`, `/admin/ai-controls`).
- **Needs from infra**: real `ANTHROPIC_API_KEY`; `RESEND_API_KEY` (+
  `RESEND_FROM_EMAIL`) for emails (no-op otherwise); real members in the
  approver groups (Finance Office is empty by default).
- **CI**: the DB-apply steps in `main_codecrafters.yml` are switched OFF
  (`APPLY_DB_CHANGES: 'false'` at the top of the workflow; user decision 2026-10-26) —
  migrations/seeds are applied manually. Set it to `'true'` once the deploy identity can
  write Azure SQL firewall rules. The old "fail the run" step was removed.

## Partner data intake + workflow automation (built; migration 014)
**Data Import** (`/superadmin/settings/import`, `components/import/`) now has three tabs:
- **Submissions** - a review queue. Anything pushed by a partner (or staged by staff via
  "Stage rows yourself") lands in `ImportBatches`/`ImportBatchRows`; rows are validated on
  arrival (`ImportService.checkRow`) and shown in a table with filters, per-row edit, and
  bulk select / import / reject / restore. Only the selected rows are written, universities
  first, then programs, then courses (chunks of 500). Importing emails the partner a
  per-row report (`SubmissionsService.sendReport`, via `EmailService.sendRichNotice`);
  "Reject remaining" emails the reason. Imported partner courses get `Verified = 'Check'`.
- **Partners & API keys** - onboarding form (university, code, point of contact, email) ->
  `DataPartners` + a generated key. Keys are `th_live_...`, only the SHA-256 hash is
  stored (`PartnerApiKeys`), the plaintext is shown once (optionally emailed). A partner can
  only submit rows for its own `UniversityCode`.
- **Direct import** - the old paste-and-write path, kept for super admins (no review).
Public API (no login, `X-API-Key`): `POST/GET /api/public/v1/submissions[/ref]`,
`GET /api/public/v1/format`; see `docs/PARTNER_API.md`. Rate limit 60/min per key, body
limit raised to 6 MB in `main.ts`.
**Partner portal** (`/partner`, public, `pages/public/PartnerPortal.tsx`): the partner signs
in with their API key (kept in sessionStorage; `GET /public/v1/me`), downloads an Excel
template (sheets Universities/Programs/Courses/Topics) or JSON example, uploads `.xlsx`/`.json`
(parsed in the browser with `read-excel-file`/`write-excel-file`, `lib/importFile.ts`),
previews, and sends to the same `/public/v1/submissions` queue; also lists their
submissions with per-row outcomes and shows the API guide.
**AI paused (decision)**: no Anthropic key yet, so AI matching is meant to stay off until it
exists - toggle in AI Controls > Settings, or set `AI_DISABLED=true` (hard override). Without a
key the pipeline now skips quietly ("AI key not configured") instead of failing per course.
**Correction**: the original `ImportService` targeted columns that do not exist
(`Institutions.Country`, `Programs.Code`, `Courses.IsBU`); it was rewritten against the real
schema. Programs are identified by (university, name); courses reference `programName`.
Imported programs also get their `ProgramUniversities` owner row, and `createProgram`
now does too (previously new programs were invisible to `publicPrograms()`).

**Workflow automation** (all tolerant of migration 014 not being applied yet):
- Stages can **auto-approve** (`WorkflowStages.AutoApprove`, `AutoApproveMinConfidence`): on
  activation the engine accepts AI suggestions >= the threshold (`sp_RecordDecision`,
  outcome `equivalent`), rebuilds the brief, and if nothing is flagged approves the stage as
  the agent (`TranscriptStages.AutoApproved`); otherwise it leaves a note and a person
  reviews. It never rejects. Approvers also get **Accept AI suggestions >= X%** on the
  review page, and **Approve N** (bulk) in the queue (`POST /requests/bulk-approve`).
- `finalize` only posts *decided* evaluations; it now leaves an internal note when courses had
  no decision. (Earlier, approving a stage never recorded any match - that gap is closed by
  the accept-suggestions paths above.)
- `SlaWatcherService` (hourly, in-process, `SLA_WATCHER=off` disables) escalates each overdue
  stage once (`OverdueNotifiedAt`): emails approvers + admins, notes for reviewers/student.
- `GET /ai-controls/readiness` powers a setup checklist card (AI key, email, migration,
  default workflow, stages with no approver, stalled automation, overdue).
- `GET /workflows/insights` + Insights tab: per-stage turnaround/backlog/lateness.
- AI Controls: Economy/Balanced/Accuracy presets and a monthly-budget meter.
- Fixed: the designer posted server-only fields (`stageKey`, approver `id`...) that the API's
  whitelist validation rejects; it now sends only editable fields.

## BU transfer policy alignment (built; migration 015 / seed 010)
Source of truth for BU's rules: `_designs/understanding/12_bu_transfer_policy_reference.md`
(gathered from search extracts - bu.edu is blocked by this sandbox's network policy) and the
change plan + confirmed decisions in `13_registration_and_process_changes.md`.
- **Policy engine** `src/api/src/policy/` (global module): `TransferPolicyService.applyToTranscript`
  runs after `sp_TriageCourse` and only *tightens* lanes - P/F & S/U -> review (Spring 2020 and
  reviewer-accepted "college required P/F" are exceptions), grade below the university's minimum ->
  not eligible, older than N years -> review, unaccredited -> not eligible / unknown -> review,
  trimester -> review, internship/research/military/life experience -> not eligible, coursework
  outside the US -> flagged for International Admissions (no evaluation, no AI), over the external
  credit cap (transfer + AP/IB/A-level; 68 / 60 / 68 by applicant type) -> review. Flags are stored
  as JSON in `TranscriptCourses.PolicyFlags` and shown to students and in the reviewer brief, which
  also always states the Hub rule (transfer courses never count; 10 Hub requirements).
  Thresholds are per university in `TransferPolicies` (Workflows -> Transfer rules tab).
- **Preview vs official vs pre-approval** (`Transcripts.EvaluationKind`): applicant not yet admitted
  -> `preview` (rules only, no workflow, status complete); admin "Mark admitted" (`POST
  /requests/:id/make-official`) converts all of that student's previews and starts the workflow;
  current BU students -> `preapproval` (valid one year after completion). Legacy profiles with no
  ApplicantType stay `official`.
- **Registration** is now a 6-step form (account, application, contact, education history with
  every college + AP/IB/A-level, language + outside-US check, review); details saved by
  `AuthService.saveApplication` into new StudentProfiles columns, `StudentEducation`,
  `StudentExamCredits`. Public `GET /auth/academic-units?institutionId=` lists BU schools/colleges
  (seed 010 adds them; transfer applicants must choose one).
- **Submission** captures term + year, grading basis, delivery mode, course type, outside-US.
- **Documents** are conditional (`documentChecklist`): English test only for non-native speakers,
  dual-enrollment form only for dual enrollment, Transfer College Report / HS transcript for
  transfers, final transcript only once official, syllabi counted per course still under review.
- **Appeals** (`CourseAppeals`, `requests/appeals.*`, staff page `/appeals`): mirrors BU's Transfer
  Credit Appeal Form (one course; proposed BU equivalent; mandatory reason; syllabus) -> department
  decides equivalent / elective / no credit / denied with requirement satisfied, comments, signature
  name; decision re-records the evaluation (posted immediately if the request is complete). Not for
  previews or outside-US coursework.
- Everything new checks `SchemaService.policyReady()` and degrades (defaults, skipped extras) when
  migration 015 is not applied, so deploys before the migration do not break submissions.
- **Not built (Phase 5):** equivalency effective-date ranges (TES-style begin/end dates).

## Parked / pending items (as of 2026-10-26)
- **Migration 014 + seeds: APPLIED** to the live DB (user ran `apply:all` via the db-mcp-server).
- **Migration 015 + seed 010: APPLIED** to the live DB (2026-10-26). User is testing the new 6-step registration and will report back.
- **`ANTHROPIC_API_KEY`: not obtained yet.** AI stays paused (AI Controls switch off or
  `AI_DISABLED=true`; without a key the pipeline skips quietly). Revisit when the key exists:
  set it, remove `AI_DISABLED`, switch AI back on, then try an auto-approve stage.
- **Decisions (user, 2026-10-26):** CI/CD stays on **GitHub Actions** (the Azure DevOps option is
  closed for now). The Anthropic key is still being requested from the infra team. The CI
  SQL-firewall permission and applying migrations/seeds by hand stay as they are until the user
  says otherwise.
- **CI SQL-firewall permission: deliberately left for later** (user decision). The deploy
  service principal (object id `275b63a9-80e3-4ede-8867-4110cf1ed843`) still lacks
  `Microsoft.Sql/servers/firewallRules/write`, so the workflow's DB steps are switched off
  (`APPLY_DB_CHANGES: 'false'`) and the run no longer fails. Until fixed, apply new
  migrations/seeds manually with `npm run apply:all` in `tools/db-mcp-server` (set `DB_*` env
  vars, machine must be allowed by the SQL firewall). Do not nag about this; wait for the user.
- **End-to-end trial of the partner flow (onboard partner -> key -> submit via `/partner` or
  API -> review/import -> report email) and of auto-approve: user will try it and report back.**
  Resend is already configured in the App Service environment variables.

## Session 2026-10-26 (b): storage, registration form, equivalency dates, active toggles (built)
- **Migrations 016 + 017 and seed 011 are NEW and NOT yet applied to the live DB** - run
  `npm run apply:all` in `tools/db-mcp-server` (or the script runner) from an allowed machine.
  Code degrades until then: uploads fall back to the legacy insert (blob mode refuses with a clear
  503 until 016 is in), equivalency dates are rejected/ignored until 017.
- **Uploads -> Azure Blob Storage** (`src/api/src/uploads/blob-storage.service.ts`,
  `@azure/storage-blob`). Set `AZURE_STORAGE_CONNECTION_STRING` (+ optional
  `AZURE_STORAGE_CONTAINER_PRIVATE` default `student-documents`, `..._PUBLIC` default
  `public-assets`) in App Service settings; unset = local disk under `src/api/storage/` (dev only).
  Private blobs are `{role}/{userId}/{entityType}/{entityId}/{uuid}-{filename}` (one folder per
  user). `Uploads` gained `StorageProvider`, `ContainerName`, `DocumentType` (migration 016);
  `StoredPath` holds the blob name (legacy rows keep their disk path). Downloads are streamed
  through the authenticated API (owner or admin/super_admin/faculty); `GET /uploads` lists a user's
  own docs (staff may pass `?userId=`). Multer limit 15 MB + extension allowlist; no sync disk
  I/O any more (the old `writeFileSync` path is the likely cause of the 502s).
- **Registration**: application step no longer defaults to or hard-codes BU - copy follows the
  chosen university, the school/college is only required when that university lists any, the
  student-ID format is not enforced server-side, BU policy blurbs show only for code `BU`.
  `AuthService.register` now rolls back a half-created student (user/profile/education/exams/
  submission) so a failure no longer leaves the email stuck as "already in use".
- **Registration as a Custom Form**: the OPEN form with slug `student-registration` (seed 011,
  edited under Custom Forms - fields have an optional "Step / section name") renders as extra steps
  before Review; answers are stored as a `FormSubmission` linked to the new student
  (`GET /auth/registration-form` public, `extraAnswers` on `POST /auth/register`; file fields are
  ignored pre-login). The core steps (account, application, contact, education history, language)
  stay built in because the transfer-policy engine needs them as structured data; moving more of
  them into the form engine would need repeatable groups + field-to-column mapping.
- **Equivalency effective dates (Phase 5, built)**: `Equivalencies.EffectiveFrom/EffectiveTo`
  (migration 017, which also re-creates `sp_TriageCourse`/`sp_RecordDecision`; the term text
  "Fall 2021" gives the as-of date, else today; an expired mapping no longer blocks recording a
  new one). New `EquivalenciesController` (`/equivalencies`, gated by the `courses` permission
  module) + UI `pages/admin/EquivalenciesManagement.tsx` at `/admin/equivalencies` (nav entry
  "Equivalencies" for admin + super_admin) with current/upcoming/expired/inactive status.
- **Active toggles**: Programs now have Activate (row, bulk, and an Active checkbox in the editor),
  Universities/Institutions/Agencies got a per-row Activate beside Deactivate, and the University
  page's program list shows inactive programs with an activate button.
- **Responsive**: `DataTable` renders one card per row below `md` (first column = title); Roles &
  Permissions stacks on phones; small 2-column form grids stack. Still not pixel-checked on a device.
- Open question left for the user: "University - Institutions (One-One)" was read as "an Institution
  (AcademicUnit) belongs to exactly one University", which is already the schema (`InstitutionId`
  FK, nullable = unmapped).

## Session 2026-10-26 (c): dashboards, scoping, photos, email change, verification (built; NOT merged to main yet)
Branch `claude/dashboards-profiles-scoping` (built on `claude/superadmin-users-edit-fix`, which is also unmerged).
- **Migration 018 + seed 012 are NEW and NOT applied** (run `npm run apply:all` in `tools/db-mcp-server`).
  018: `Users.EmailVerified` (default 1 = every existing/new account counts as verified for now),
  `Users.AvatarUploadId`, `EmailChangeRequests`, `CourseVerificationRequests`. Seed 012 fills every
  student's missing profile fields (only NULLs, deterministic, re-runnable): contact/address, prior college,
  target university/program/school, applicant type, entry term, English, GPA, emergency contact, one education row.
  Code degrades until 018 is applied (dashboards skip those widgets; photo/verification endpoints say so).
- **Invisible button root cause**: `cn()` just joined classes, so `bg-white` (Card) beat `bg-brand-800`. `cn()` now
  uses `tailwind-merge`; this fixes the same class conflict everywhere, not only the student dashboard.
- **Admin scoping**: `ScopeService` (policy module, global). An `admin` with `UserScopeUniversities` rows only sees
  students whose `StudentProfiles.TargetInstitutionId` (or a transcript's `TargetInstitutionId`) is in scope: users
  list/get/update/deactivate/unlock, transcripts list/get/document, approval queue + `assertCanView`, dashboard.
  No scope rows = unrestricted; super admins and faculty are never narrowed (faculty are limited by workflow stages).
  Note: transcripts previously scoped admins by the SOURCE institution; that was replaced by target-university scope.
  Students with no target university are invisible to a scoped admin (seed 012 gives every student one).
- **Dashboards**: `GET /dashboard?days=30|90|180|365` (`dashboard/`) returns role-specific `{kpis, charts}`; the UI
  (`components/dashboard/DashboardView.tsx`, recharts) renders them generically with a time-range selector. Used by
  student, faculty (new `/faculty` dashboard; the old queue moved to `/faculty/queue`), admin and super admin.
  Each widget is isolated in try/catch so one bad query never blanks the page. Agency dashboard unchanged.
- **Faculty "approvals" explained**: the default workflow's Faculty-review stage is assigned to the ROLE `faculty`, so
  every faculty user sees every request waiting at that stage (all universities). Narrow it in Workflows (assign a
  group or user instead of the role). Faculty can now raise a course for verification (`/faculty/verification`,
  `verification-requests` API): raising flags `Courses.Verified='Check'`; an admin marks it verified ('Yes') or dismisses.
- **Profile photos**: `account/` module. Photo is cropped/zoomed in the browser (`PhotoEditor`), saved as a 512px JPEG
  in blob storage via `UploadsService` (entityType `avatar`), `Users.AvatarUploadId` points at it; any signed-in user may
  view it (`GET /account/photo/:userId`, fetched with the session by `Avatar`). Super admin "Generate default photos"
  (Users page) gives every user without one a generated initials avatar (SVG in blob) - real photos cannot be invented.
- **Email change**: users can no longer PATCH their own email; `POST /account/email-change` (needs current password)
  emails a 24h link to the NEW address, `/verify-email?token=` confirms it (`EmailChangeRequests`, hashed token).
  Admins can still edit other users' emails directly. No verification mail is sent at registration yet.
- Also fixed: the transcript document download still read local disk (broken since blob storage); it now streams from
  blob storage via `UploadsService.getByStoredPath`.
- **Next (user-stated)**: after these are done, move on to the core AI processing logic.

## Session 2026-10-26 (d): admin visibility fixes (branch `claude/admin-scope-superadmin-visibility`, not merged)
- **Super admins are invisible to plain admins**: hidden from the users list, not manageable (get/update/deactivate/
  unlock return 403), the super_admin role cannot be assigned by an admin (create, update, bulk, CSV import), and they
  are hidden from approver-group member lists / pickers (an admin saving a group keeps any super-admin members as they were).
  The Workflow designer's "All super admins" approver option is hidden from admins.
- **Scope not showing after save (root cause)**: the scope panel filled its draft inside `queryFn`, but the app caches
  queries for 30s (`staleTime`), so re-opening a row within that window skipped `queryFn` and showed an empty selection.
  The draft is now set from the query's data in an effect, and the cache is updated on save.
- Admin sidebar is grouped like the super admin's (Operations, Users, Settings, Account).

## Session 2026-10-26 (e): student intake pipeline (branch `claude/student-intake`, NOT merged; migration 019 + seed 013 NOT applied)
Several ways to get a student's data in; every channel ends at the same "confirm, then create the account" step.
- **Tables (migration 019)**: `StudentSourceProfiles` (+ `StudentSourceCourses`, `StudentSourceDocuments`) = records held by a
  source system (registrar/agency/partner); `IntakeSessions` = one emailed claim link (sha256 token, 48h). Also lets
  `ImportBatchRows.EntityType` be `'students'`. Seed 013 = 30 mock profiles (`IsMock=1`, `@transferdemo.edu` emails, NU/NYU
  use real catalogue courses so equivalencies fire; six passport holders); documents are `Generated=1` and rendered to PDF
  on demand (pdfkit) by the connector.
- **Flow**: public `/intake` (ID/passport + email [+ university]) -> `POST /intake/lookup` always answers the same
  (no enumeration; rate limited) and, on a match, emails `/intake/claim?token=`. Mock profiles also return the link in the
  response (their mailboxes are fake). `/intake/claim` shows the record (details, courses, documents) and only on confirm +
  consent + password does `POST /intake/claim` create the account (email pre-verified), profile, education row, copy the
  documents into the student's blob folder (`entityType 'intake'`, typed) and optionally submit the courses for evaluation.
  Account-creation steps roll back on failure; document/submit failures are reported but keep the account.
- **Connector seam**: `SourceConnector` (`DbSourceConnector` today). Real registrar/exchange integrations = another
  implementation, nothing else changes.
- **Admin**: `/admin/intake` (nav "Student intake"): share link, QR code (download PNG), email template, counts, demo
  profiles with "Try it", recent sessions, "Send invite".
- **Partner/agency bulk**: the partner API/portal/import queue accept a `students` entity (profile fields + courses +
  optional base64 documents + `invite`). Applying a row only upserts a source profile (never a user); `invite:true` emails
  the claim link via `IntakeService.sendInvite`. See `docs/PARTNER_API.md`.
- **Not built yet (ideas)**: AI document upload/classification (needs the Anthropic key; plan to add reader skills in AI
  Controls), email-in, registrar feeds, advisor-initiated invites, consent log.

## Session 2026-10-26 (f): merged to main + analytics bento dashboards
- `main` now contains: student intake pipeline (migration 019 + seed 013 still NOT applied), animated dashboards, and the
  **analytics bento** (`components/ui/analytics-bento.tsx`, from a 21st.dev prompt; theme tokens card/muted/border/etc. added
  in `index.css`). `GET /dashboard/bento` (`dashboard/bento.service.ts`) feeds it for every role (staff scoped, faculty/student
  own data): requests per day, activity by hour, courses by lane treemap (+ top source universities), requests per month radar
  (two years). `DashboardView` shows the bento and falls back to the previous charts if that call fails. `?days` is ignored by
  the bento (fixed weekly/monthly/yearly windows). Negative deltas render red with a down arrow.
- The user also shared a 21st.dev "glass-folder-cards" link; it cannot be opened from here - ask for the component code/prompt.

## Session 2026-10-26 (g): refresh-logout fix (on main) + AI document reading (branch `claude/ai-documents`, NOT merged)
- **Refresh logged users out (fixed, on main)**: the auth store started logged-out and restored the session in a `useEffect`
  after first render, so every route guard redirected to `/login` on reload. `store/auth.ts` now reads localStorage when the
  store is created (`loadStoredSession`).
- **AI document reading** (`src/api/src/documents/`, UI `/student/documents` "Smart upload"): students drop PDFs/images ->
  stored privately in blob (entityType `smart_upload`) -> `DocumentReader` classifies + extracts (transcript, id_document,
  english_test, syllabus, enrollment_letter, other) -> student reviews/edits -> confirm sets `Uploads.DocumentType`, adds a
  `StudentEducation` row (transcripts) and can prefill the existing transcript form (`/student/upload?intake=<id>`).
  Status flow: uploaded -> reading -> read | needs_review (confidence < 0.6) -> confirmed; failed/skipped.
  **Without `ANTHROPIC_API_KEY` / with AI off it is "paused"**: files are stored, status `skipped`, the student picks the type
  and edits by hand. With a key it uses the cheap model first and escalates (`AiSettings`), respects the global switch,
  `AI_DISABLED` and the monthly budget, and logs usage with operation `read`. Reading instructions are editable skills under
  AI Controls category "Document reading" (seed 014: doc_classify, doc_transcript_extract, doc_id_extract,
  doc_english_test, doc_syllabus, doc_output_rules); they are NOT injected into the course-matcher prompt.
- **Needs applying**: migration 020 (also widens `CK_AgentSkills_Category` to allow `documents`) + seed 014. Until then every
  `/documents` endpoint except `status` returns 503. Migrations 018/019 + seeds 012/013 from earlier are still pending too
  unless the user has applied them.
- **Not tested with a real key**: the Anthropic PDF/image request shape and JSON parsing are covered by reading only.

## Session 2026-10-27: built-in rules fallback + bigger logo (branch `claude/offline-ai-fallback`, NOT merged; migration 021 NOT applied)
- No Anthropic key yet, so every AI step has a zero-token **rules fallback**, switch `AiSettings.RulesFallbackEnabled`
  (AI Controls > Settings "Built-in rules fallback", default ON; migration 021, code treats missing column as ON).
  Order: AI if key + switch on + budget; else rules if fallback on; else paused/skipped.
- **Course matching**: `ai/rules-matcher.ts` ranks the catalogue with the lexical `scoreCourse`, up to 3 candidates, confidence
  capped at 0.7 (so never auto-"likely"/auto-approved at default thresholds), rationale prefixed "[Built-in rules]", not cached,
  usage logged as model `built-in rules`. Also used if an AI call errors. `matchQueuedForTranscript` runs it automatically.
- **Document reading**: `documents/rules-document-reader.ts` + `rules-helpers.ts` (pdf-parse text extraction, keyword
  classification, regex extractors for transcript/ID+MRZ/English test/syllabus). No OCR: images/scans get filename guesses at
  confidence <=0.3. Rules results end as read/needs_review, never confirmed. Test: `npx tsx scripts/test-rules-reader.ts` (src/api).
- Everywhere a person can still override manually (faculty evaluation, document editor).
- **Logo**: `LogoFull`/`LogoTile`/`LogoMark` in `components/shared/Logo.tsx`, `public/logo-mark.png` (tight crop); bigger in
  sidebar, auth, home, partner, intake pages; emails use `${APP_BASE_URL}/logo.png?v=3` (210x110) in a white box.

## Session 2026-10-27 (c): university exchange, Maya demo seed, backtest, degree progress (branch `claude/university-exchange`, NOT merged)
- **Apply**: migration 022 (`DocumentRequests`, `PartyReminders`, new `Uploads` columns StudentUserId/TranscriptId/UploadedByParty/
  UploadedByInstitutionId/Note/DocumentRequestId), seed 015 (Maya six-course demo: BSCC/PVTC catalogue, 3 known equivalencies,
  two transcripts BSCC 5 courses + PVTC 1) and seed 016 (`transfers` permission module). Code degrades until applied. SQL untested.
- **Exchange** (`src/api/src/transfers/`, UI `/transfers`, `/transfers/:id`, `components/.../ExchangePanel`, docs/TRANSFER_EXCHANGE.md):
  both source (U1) and target (U2) universities see a request; incoming/outgoing counts; document requests between student,
  U1 and U2; uploads by either university land in the student's folder `student/{id}/transfer/{transcriptId}/{party}/...` with
  party/institution metadata; party-to-party reminders (12h rate limit, emailed). `ScopeService`: scoped admin sees incoming
  (full) + outgoing (read-only, no decisions, no receiving-side internal notes/brief). Student does not see U1<->U2 traffic.
- **Backtest**: `GET /ai-controls/backtest` (rules matcher top-1/top-3 hit rate on held-out equivalencies) + MatcherAccuracyCard on
  the AI Controls Usage tab; the AI matcher plugs into the `Matcher` type later.
- **Degree progress**: `GET /progress/me` + `/progress/student/:id`, `DegreeProgressCard` on the student dashboard (secure / likely
  range / pending / not counted vs the external-credit cap).
- Script tests: `npx tsx scripts/test-{rules-reader,backtest,progress,exchange-logic}.ts` in src/api.
## Session 2026-10-27 (b): hackathon gap analysis + deck (branch `claude/hackathon-deck`, NOT merged)
- `_designs/GAP_ANALYSIS.md`: ask-vs-built check. Main open gaps: top-3 hit-rate backtest (the brief's measurable outcome),
  one-year deadline tracker (PRG-02), programme rules PRG-04..08, degree-progress view, side-by-side course diff, scripted
  six-course "Maya" demo transcript + BSCC/PVTC catalogues (only the institutions are seeded), no API tests.
- `_designs/deck/`: `TransferHub-Hackathon.pptx` (16 slides) built by `build-deck.js` (needs pptxgenjs, react-icons, sharp via
  NODE_PATH); `screens/` are mocked-API screenshots (synthetic numbers, not real data).

## Session 2026-10-27 (d): demo-login controls, student spread, deadline tracker, repeatable demo (branch `claude/demo-login-controls`)
- **Apply**: migration 023 (`AppSettings`), seed 017 (spread students over the receiving universities, deterministic; check run log shows the
  expected university count), migration 024 (`TransferPolicies.CreditDeadlineMonths`, `StudentProfiles.StartDate`, `CreditDeadlineNotices`).
- **Demo login**: public `GET /auth/demo-login` (off by default, 10s cache, per-IP limit), super_admin `GET/PUT /settings/demo-login`
  (System Settings > Demo login): off / names-only buttons that autofill / show credentials. Accounts are the 5 seed demo accounts
  hard-coded in `src/api/src/settings/demo-accounts.ts`. Audit action `DEMO_LOGIN_SETTINGS_CHANGED`.
- **Student spread** (seed 017): the 120 synthetic students + any student with no valid target get a hash-picked receiving university
  (Type='university', not BSCC/PVTC); Maya stays BU; real registrants with a valid choice are untouched; only pre-workflow transcripts
  are realigned. Scoped admins now see only their university's slice.
- **PRG-02 credit deadline**: `policy/credit-deadline.ts` (term starts Fall Sep 1 / Spring Jan 15 / Summer May 25, months per university
  in Transfer rules, estimate from first request if no entry term), `past_deadline` flag sends undecided courses to review (never denies),
  progress card block, staff badge + queue filter, SLA-watcher reminders at 90/30/7 days + overdue (ledger `CreditDeadlineNotices`).
  Nothing populates `StudentProfiles.StartDate` yet.
- **Repeatable demo (Gap 5)**: `/superadmin/settings/demo-scenario` page + `src/api/src/demo/` (`POST /demo/maya/reset`, `/second-student`,
  `GET /demo/status`); built in TypeScript (mirrors seed 015 section 3 - keep in step); `docs/DEMO_SCRIPT.md`. Secure credits at upload = 11
  (4+4+3), not 12. Reset does not clear `AiMatchCache`.

## PENDING (parked by the user 2026-10-27; to be worked on together "tonight", do not start unprompted)
**Medium-sized gaps** (items 1-6 below were BUILT on 2026-10-27, see the 'medium gaps built' session note; item 7 deck refresh DONE 2026-10-27: scorecard 20 built / 2 partial / 0 open, backtest slide 63 cases top-1 88.9% top-3 96.8%, live smoke 39/0/1):
1. Side-by-side course comparison with highlighted overlapping topics/outcomes + credit math in the evaluator workbench (RequestReview).
2. OUT-06 one external course -> several BU courses (split/combine, e.g. NU CHEM 1161), currently one BU course per decision.
3. Programme rules PRG-04..08 (Econ max 4 courses at 200+, Biology 5 BI at BU, Psych/Math rules, substitutions like MA 242 <-> CS 132) as a rules table.
4. AP/IB score thresholds (AP >= 3, IB 4-5, CLEP >= 50); NACES credential evaluation + certified translation checklist items.
5. Per-course syllabus upload slot on the submit form (today only via Smart Upload / appeals).
6. API/SQL smoke tests (triage, policy, workflow, exchange); CR-04 5-credit lab rule needs BU's answer.
7. Re-run the deck (`_designs/deck/build-deck.js`): scorecard still shows PRG-02 open; refresh counts after these.
**User-side checks still owed**: apply migration 023 -> seed 017 (check log shows 6 universities) -> migration 024; run the Matcher accuracy
backtest (AI Controls > Usage) for a real number; click through the Demo scenario page; set `StudentProfiles.StartDate` has no UI yet.
**Open question**: public `/auth/universities` lists BSCC/PVTC (community colleges), so a registrant can pick one as target.
**Waiting on infra**: `ANTHROPIC_API_KEY`.

## Session 2026-10-27 (e): medium gaps built (branch `claude/medium-gaps`; apply 025 -> 029 + seeds 018, 019; all SQL UNTESTED)
- **025** `Syllabi.UploadId/CatalogUrl`: per-course syllabus attach + catalogue URL on the submit form (UploadTranscript), shown on student/staff pages.
- **Side-by-side compare**: `GET /comparison/evaluation/:id` (staff only, needs canWorkRequest) + `CourseComparison.tsx` panel in RequestReview
  (overlap highlight, credit math, candidate switcher, one-click decide via POST /evaluations/:id/decide).
- **026** one-to-many: `EvaluationCourseMappings`, `Equivalencies.GroupKey`; decide API accepts `mappings[]`/`buCourseIds[]`; multi decision runs in TS around
  the unchanged `sp_RecordDecision` (one transaction); workflow-engine/appeals paths still record one BU course; no faculty UI to pick several yet.
- **027 + seed 018** `ProgramRules` (12 BU rules PRG-03..08) + engine `policy/programme-rules*.ts` (flags only, never denies) + Workflows > Programme rules tab.
- **028 + seed 019** `ExamCreditRules` (AP>=3, IB HL>=5, CLEP>=50, A-level C - defaults, confirm with BU), CLEP allowed in StudentExamCredits, doc types
  credential_evaluation / certified_translation / exam_score_report (conditional checklist), Exam credit card in Transfer rules. CLEP not yet offered in the
  registration form.
- **Tests/docs**: `npm run test:unit` (src/api), `npm run smoke -- --base <url>`, `database/tests/{smoke,triage-contract}.sql` (run with sqlcmd, not via the
  migration runner), `docs/TESTING.md`, `docs/BU_OPEN_QUESTIONS.md` (5-credit lab rule CR-04 etc., Discovery Log rows).
- **Bug fixed by migration 029**: `sp_TriageCourse` ignored `Equivalencies.Outcome` in the 'applied' check, so a `bu_only` mapping returned lane `applied`; now it
  returns `elective_only` (PRG-03). Existing triaged rows are not rewritten. `triage-contract.sql` case 8 expects `elective_only`. Apply 029 with the others.

## Session 2026-10-27 (f): Swagger + transfers module fix (on main)
- Swagger UI at `/api/docs`, JSON at `/api/docs-json` (`src/api/src/swagger.ts`, wired in main.ts after setGlobalPrefix). On in dev, OFF in production unless
  `SWAGGER_ENABLED=true`; optional basic auth via `SWAGGER_USER`/`SWAGGER_PASSWORD`; relaxed CSP only on the docs routes. Bearer auth: POST /api/auth/login -> accessToken
  -> Authorize. See `docs/SWAGGER.md`. No request-body schemas (plain `tsc`, no CLI plugin).
- **Bug found via Swagger**: `TransfersModule` was imported in `app.module.ts` but missing from the `imports` array, so every `/transfers/*` endpoint 404'd in production
  (the smoke suite caught it). Fixed. Check for this class of bug by comparing module imports vs the array.

## Session 2026-10-27 (g): student journey (branch `claude/student-journey`; apply seed 020; SQL UNTESTED)
- **Profile bug root cause**: `GET /users/:id` had `@Roles('admin','super_admin')`, so students got 403 and the profile page showed "Not provided" everywhere. Role guard removed; the
  controller's own self-or-admin + scope check still applies. Profile page now shows an error banner on failure and a "University & program" card.
- **Student target**: `GET /account/targets`, `PUT /account/target {institutionId, programId?}` (student only; receiving universities only, program must be offered there; audit
  `STUDENT_TARGET_CHANGED`; never touches existing transcripts/workflows), `GET /account/student-overview`. Profile page has "Change target university".
- **Seed 020** completes every student's profile consistently (prior institution = latest transcript source, education rows, credits, target program; Maya = Bay State CC -> BU CS).
- **Where I am now + Explore**: `src/api/src/student-journey/` (`GET /student/overview`, `/student/universities`, `/student/compare?ids=a,b,c` max 3), UI `CurrentStatusCard` on the
  student dashboard and `/student/explore` (compare up to 3 universities: known equivalencies first, then built-in rules matcher, programs ranked by transferable credits, capped
  by the external-credit cap; preview only; "Make this my target" button).

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
- **Fresh DB + scripts**: running the full consolidated `migrations/`
  set (`001_database.sql` through `010_uploads.sql`) then the full
  consolidated `seed/` set (`001_reference_data.sql` through
  `008_roles_permissions.sql`), each in filename order, against a
  completely empty SQL Server produces the full schema + demo data
  correctly (this was proven against the pre-consolidation migration/seed
  files on a clean Docker SQL Server instance in an earlier session; the
  consolidation preserved every column/constraint/index/proc/view — see
  the "DB Script Runner tool" section below for the rationale and the
  column/constraint cross-check that was done). One exception: **Azure SQL
  Database specifically** can't run `001_database.sql` as-is (no
  cross-database `USE` mid-connection) — create the DB as its own Azure
  resource first, then run `002` onward connected directly to it.
- **DB credentials are 100% env-driven** — `database.service.ts` /
  `sql-connection.util.ts` have zero hardcoded server/host values. Pointing
  at a new SQL Server is purely an `.env` change (`DB_SERVER`, `DB_PORT`,
  `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_ENCRYPT`, `DB_DRIVER`,
  `DB_TRUSTED_CONNECTION`), no code change.
- LocalDB requires `DB_DRIVER=msnodesqlv8` (tedious is TCP-only, can't
  reach `(localdb)\...`). Azure SQL / any real SQL Server over TCP uses
  plain `DB_DRIVER=tedious` with `DB_ENCRYPT=true`.

## Known demo accounts (after `npm run seed:users`) — why that step is required
`database/seed/003_demo_users.sql` inserts the 5 named demo accounts (and
the 120 synthetic students) with a **placeholder, non-functional
`PasswordHash`** — the seed SQL deliberately can't compute a real argon2id
hash itself (that needs the `argon2` npm package, not T-SQL). So right
after a fresh `migrations/` + `seed/` run, these users exist in the DB but
**cannot log in yet** — every login attempt fails. `npm run seed:users`
(run from `src/api`, needs the API's own `.env` already set up) is a
separate, required step: it hashes each demo password with
`argon2.hash(..., argon2id)` and `UPDATE`s `Users.PasswordHash` in place
for exactly these accounts (matched by email). **Always run migrations →
seeds → `npm run seed:users`, in that order, on a fresh database** — this
tripped someone up after a full DB reset+reseed in this project's own
session history, so it's worth remembering as a checklist, not just a
one-off fix.
| Role | Email | Password |
|---|---|---|
| Student | `student@test.edu` | `Student@123!` |
| Faculty | `faculty.cs@bu.edu` | `Faculty@123!` |
| Admin | `admin@bu.edu` | `Admin@123!` |
| Agency | `agency@partner.edu` | `Agency@123!` |
| Super Admin | `super_admin@bu.edu` | `SuperAdmin@123!` |

## Email (Resend)
- `src/api/src/common/email.service.ts` wraps the `resend` npm package.
  Configure via `RESEND_API_KEY` in `src/api/.env` (see `.env.example`) —
  optionally `RESEND_FROM_EMAIL` to override the default sender.
- If `RESEND_API_KEY` is unset, `EmailService.send` logs a warning and
  no-ops instead of throwing, so local dev without the key keeps working.
- **Resend does not throw on rejection** — `emails.send()` returns `{ data, error }`.
  `EmailService.send()` now checks `error`, logs it, returns an `EmailResult`, and keeps the
  last 20 attempts in memory. Super admins see them, plus the sender/domain, under
  System Settings → Email (`GET /email/status`, `POST /email/test`), and the readiness card
  warns when the latest email was rejected. Typical cause: the sender domain
  (`RESEND_FROM_EMAIL`, default `support@wcubeprojects.in`) is not verified in Resend.
- **Templates**: every e-mail is defined in `src/api/src/common/email-templates.ts` (pure
  functions, table layout + inline CSS, modelled on the SKPTrust "message from the Trust"
  design in TransferHub maroon): status chip, serif headline, "Hello <name>", callout,
  "If you wish to reply ... quote your reference number", details card, dark footer, plain
  text part, `[Ref XXXXXXXX]` subject suffix (first 8 hex of the request id, or `IMP-…`).
  Callers use `email.sendEmail(to, templates.x(email.context, {...}))`. Preview gallery +
  "send this sample" in System Settings → Email (`GET /email/templates`,
  `POST /email/templates/:id/send`). Replies/questions address = `SUPPORT_EMAIL` env, else
  the from address.
- Failures are always non-fatal: `UsersService.create()` sends a "your
  account was created" email with the temp password after inserting the
  user, wrapped in try/catch — email delivery problems never fail user
  creation.

## Future direction: multi-tenant SaaS

**Status: not scheduled, not being built — a direction to keep in mind so
current schema/scope decisions don't accidentally foreclose it later.**
Current hackathon-scope work (scope visibility, Resend email,
universities/institutions/agencies CRUD, workflow dashboards, etc.)
continues exactly as planned; nothing here changes any code, schema, or
behavior today.

The longer-term idea: evolve this app from a single-institution,
BU-centric tool into a multi-tenant SaaS product that other universities
could subscribe to as independent tenants.

Getting there eventually would mean:
- Removing the BU-centric assumptions baked into the system today — most
  visibly the `Institutions.IsBU` flag, but also the more implicit
  "there is exactly one receiving institution" assumption that shows up in
  places like the triage/evaluation logic (`sp_TriageCourse`,
  `sp_RecordDecision`, and the services around them), which currently
  reason about a single home institution rather than "which tenant does
  this request belong to."
- Treating the Agencies/Universities/Institutions scope-visibility work
  currently being built (migration 008 and its
  `UserScopeUniversities` / `UserScopeAcademicUnits` / `UserScopeAgencies`
  tables) as a stepping stone rather than the end state. That work solves
  *visibility* (who can see what); real multi-tenancy would need it
  extended into actual tenant isolation — e.g. row-level security or an
  explicit tenant-id on the relevant tables — not just filtering what a
  given user is shown.
- Deciding what stays shared vs. what becomes tenant-private. The
  `Equivalencies` table (cross-university course-matching data) is
  valuable precisely because it's cross-institution — the plan would be
  to keep it as a shared, crowdsourced asset that every tenant university
  can read from and contribute equivalency mappings to, rather than
  partitioning it per tenant. By contrast, `Transcripts` and `Evaluations`
  are student-specific records and would need to stay strictly private to
  the tenant that owns them.

Again: this is just a direction noted for future reference, not committed
work. No action item follows from it right now.

## Responsive/mobile pass (confirmed, built — first pass)
User asked for an effort estimate on making every page mobile-friendly, then
said to pick it up. Scope of this first pass (mechanical + the one real
structural blocker):
- **App shell (`AppLayout.tsx`)**: the sidebar was a fixed `w-64` column
  always rendered — the single biggest mobile blocker, since it alone ate
  256px of any viewport. Now `hidden md:flex` on desktop, replaced below
  `md` by a slide-over drawer (backdrop + `Menu`/`X` toggle, closes on
  every route change) and a mobile top bar carrying the hamburger + logo.
- **Page containers**: every `p-8 max-w-Nxl mx-auto` page wrapper (27
  occurrences across ~25 files) became `p-4 sm:p-8 max-w-Nxl mx-auto` —
  full padding is a lot of a 375px viewport's width.
- **Update — "use 95% of space" for entity-table pages (confirmed,
  built)**: the 11 pages whose main content is a `DataTable` (Universities,
  Institutions, Programs, Agencies, Users, Course Database, Transcripts,
  Audit Log, Pages, Forms, Form Submissions) had their `max-w-Nxl mx-auto`
  cap replaced with `w-[95%] mx-auto` (and padding trimmed to `p-4 sm:p-6`)
  per explicit follow-up request, so these tables use nearly the full
  width next to the sidebar on large monitors instead of being capped at
  ~1152px (`max-w-6xl`) with empty space on both sides. Pages without a
  primary table (dashboards, editors, login) were deliberately left on
  their original `max-w-*` caps — narrower forms/dashboards read better
  capped, this was specifically about *tables*.
- **Header rows**: the top-level title+actions `flex items-center
  justify-between` row on the 13 pages that have one (list pages,
  editors, the profile page) gained `flex-wrap gap-3` so action buttons
  wrap onto a second line instead of overflowing/squeezing. Deliberately
  left alone: smaller nested card/section headers (e.g. inside
  `SuperAdminDashboard`'s stat cards) — different risk/benefit, not the
  reported problem.
- **Fixed multi-column grids**: every always-on `grid-cols-2`/`grid-cols-3`
  (form field pairs, stat card rows, dashboard panels — ~17 occurrences)
  became `grid-cols-1 sm:grid-cols-N`, so they stack on a phone instead of
  squeezing into unreadably narrow columns.
- `DataTable` (used on ~15 pages) was already reasonably mobile-tolerant
  going in — its toolbar already used `flex-wrap` and its table already
  scrolled horizontally (`overflow-x-auto`) — so it needed no structural
  change here, just the `showExport` prop added for the Roles &
  Permissions work above.
- Verified: the public `/login` page renders correctly at 375×667 (headless
  Chromium screenshot). Could not visually verify authenticated pages in
  this pass — this sandbox has no SQL Server/Docker available to run the
  real API+DB stack, and faking `localStorage` auth to view a protected
  route directly hits an unrelated pre-existing quirk (hard-loading a
  protected URL always bounces to `/login` for one render before
  `initFromStorage()`'s effect fires — not something this pass touched or
  introduced). The shell/grid/wrapper changes are otherwise standard,
  TypeScript-checked Tailwind responsive patterns already used elsewhere
  in this codebase.
- **Known gap, not done in this pass**: no page-by-page bespoke mobile
  redesign (e.g. turning `DataTable`'s desktop table into a stacked
  card list below a breakpoint) — this pass fixes the structural
  blockers and the worst offenders mechanically; a true "every page
  pixel-checked on a real phone" pass would be a separate, larger effort
  if still wanted after seeing this.

## DB Script Runner tool (confirmed, built)
`tools/db-script-runner/` is a standalone PowerShell + Windows Forms GUI
for applying `.sql` migration/seed scripts to SQL Server / Azure SQL,
built to replace manually running scripts one at a time in SSMS (which is
what caused a prior "column already exists" incident from re-running an
already-applied migration with no tracking of what had run). Use it
instead of SSMS whenever applying a batch of migrations/seeds, especially
against Azure SQL Database.
- `DbScriptRunner.ps1` — the GUI: pick a folder containing a `.env`-style
  file and load connection settings from it (generic `KEY=value` parser,
  all fields editable afterwards); pick a folder of `.sql` scripts
  (defaults to `database/migrations` in this repo, auto-detects a sibling
  `database/seed` folder as a second tab); lists scripts naturally sorted
  (`002_` before `011_`) with Applied/Not Applied/Changed/Failed status;
  checkbox-select and "Run Selected" executes them in filename order via
  `sqlcmd.exe` (falls back to `Invoke-Sqlcmd`/`SqlServer` module if
  `sqlcmd.exe` isn't on PATH), streaming output live and stopping the
  batch on the first error.
- `Run.bat` — double-click launcher (`-ExecutionPolicy Bypass` scoped to
  just that invocation, no global policy change).
- Tracks what's already been applied in a `dbo.__ScriptRunnerHistory`
  table it creates automatically in the target database (script name,
  timestamp, success flag, SHA-256 checksum) — re-running something
  already marked Applied prompts for confirmation instead of silently
  erroring or silently re-running.
- Supports both Windows/trusted auth and SQL auth, and Azure SQL's
  required encrypted connection (`-N -C` sqlcmd flags / `Encrypt=Mandatory`
  + `TrustServerCertificate` for `Invoke-Sqlcmd`).
- **Deliberately generic / not hardcoded to this repo** — it's meant to be
  copied as-is into any other SQL-Server-based project; see
  `tools/db-script-runner/README.md` for the full explanation and how to
  point it at a different project's env vars/folder layout.

**Migrations/seed consolidation (confirmed, deliberate and destructive —
done at the user's explicit request after being warned).** The old
per-feature migration/seed file history (`migrations/001` through `017`,
`seed/001` through `011`, with some numbers never used) was replaced
outright with one idempotent file per entity, in both `database/migrations/`
and `database/seed/`. The old files are gone from the repo, not kept
alongside the new ones.

New `database/migrations/` layout (run in this filename order):
- `001_database.sql` — `CREATE DATABASE` against `master` (unchanged
  special case; still can't be run against Azure SQL, see its header).
- `002_auth_and_roles.sql` — Roles, Departments, Users (incl. profile/
  contact fields and the `AgencyId` column), RefreshTokens,
  PasswordResetTokens, AuditLog, and the Roles & Permissions master-data
  tables (PermissionModules/PermissionOperations/RolePermissions) — folded
  in here since they FK back to Roles.
- `003_institutions_courses_programs.sql` — Institutions ("Universities" in
  the UI), Programs (+ `IsActive`/`UpdatedAt`), Courses (+ `ProgramId`
  link + backfill), Equivalencies.
- `004_transcripts_and_evaluations.sql` — StudentProfiles, Transcripts,
  TranscriptCourses, Syllabi, Evaluations, AIMatchCandidates.
- `005_views_and_procedures.sql` — the 3 views + `sp_TriageCourse` /
  `sp_RecordDecision` (`CREATE OR ALTER`, naturally idempotent).
- `006_pages.sql` — Pages (CMS).
- `007_forms.sql` — Forms, FormSubmissions.
- `008_universities_institutions_agencies.sql` — Agencies, AcademicUnits
  ("Institutions" in the UI, nullable `InstitutionId`), the
  `Users.AgencyId` FK (the column itself lives in file 002, since Agencies
  doesn't exist yet at that point), the three UserScope* visibility
  tables, and `LogoUrl`/`HeroImageUrl` on both Institutions and
  AcademicUnits (grouped here with their owning entity, not with Uploads).
- `009_course_topics.sql` — CourseTopics.
- `010_uploads.sql` — Uploads (file storage metadata) only.

New `database/seed/` layout (run in this filename order):
- `001_reference_data.sql` — Roles, Departments, Institutions.
- `002_courses_and_equivalencies.sql` — BU/Northeastern/NYU + AI/ML course
  catalog, and the workbook equivalency mappings.
- `003_demo_users.sql` — the 5 named demo accounts + the 120 synthetic
  students.
- `004_pages.sql` — the 3 demo CMS pages.
- `005_forms.sql` — the demo Custom Form.
- `006_agencies_academicunits_programs.sql` — Agencies, AcademicUnits,
  Programs.
- `007_course_topics.sql` — all seeded CourseTopics rows.
- `008_roles_permissions.sql` — PermissionModules/Operations seed rows +
  the starting RolePermissions grant set.

Every new file was checked column-by-column/constraint-by-constraint
against the old migration set it replaces (see the session that did this
for the full inventory) — nothing was dropped. Two small correctness fixes
were made along the way, not just a mechanical merge: the old
`007_forms.sql` unconditionally `DROP TABLE`'d Forms/FormSubmissions on
every run (a one-time recovery step that would have silently destroyed
real data on a second run) — replaced with the same existence-guarded
`CREATE TABLE` pattern used everywhere else; and the old `seed/005_pages.sql`
inserted the 3 demo Pages with bare `INSERT` (would throw a unique-
constraint error on a second run, not silently no-op) — now guarded with
`IF NOT EXISTS`.

**If you point `tools/db-script-runner/` at an already-deployed database**
that ran the *old* file set: the new consolidated files will show as "Not
Applied" (the history table is keyed by filename, and these are new
filenames) — this is expected, not a problem. Running them is safe: every
new file is idempotent and a true no-op wherever the database's schema/data
already matches, so it just gains new history rows for the new filenames
alongside the old (harmless, vestigial) ones. No manual
`__ScriptRunnerHistory` surgery is needed.

## Workflow reminders for this repo
- **Branches (2026-10-26):** every push to `main` deploys to Azure. `ccr-da95d981-um0118`'s work was
  merged into `main` at the user's explicit request. User decision: do NOT merge
  `claude/upbeat-davinci-vg9kbz` (old, superseded line of work) - leave it unmerged.
- Always run `npx tsc --noEmit` in both `src/api` and `src/ui` before
  committing
- `@hookform/resolvers` must be v5+ with zod 4 (v3 re-throws zod 4 errors instead of
  returning field errors — that broke every multi-step/invalid form, e.g. /register stuck
  on step 1). `DataTable` has an opt-in `pageSize` prop (Users uses 25).
- SQL Server reserved keywords bite here more than once (`Schema` broke a
  `CREATE TABLE` — renamed to `SchemaJson`; a column alias `AS Open` broke the partners
  list with a 500 that the UI showed as "no partners") — double-check column names and aliases
  against the T-SQL reserved word list when adding new tables

## Session 2026-10-28: student flow, demo login, AI providers, roadmap (read before continuing)
**Branch state:** on `main`: submit-transcript redesign, target-on-submit, From->To credits, per-course suggestions, source-notify,
one-click demo login, admin photo upload, course edit, AI providers + Document Intelligence reader. On branch
`claude/roadmap-student-superadmin-ai` (NOT merged - merge only when the user says so; every push to main deploys): provider cards UI,
DI reader follows document skills, learned-skills panel, Explore wizard, Smart Upload actions, editable emails, (Partners table pending).
Agent worktrees live under `.claude/worktrees/` (gitignored - never `git add` them; use `git add src/` not `-A` while agents run).
No migrations were added this session. Still to apply by the user: seed 020 (and anything earlier still pending).
- **Submit Transcript** (`UploadTranscript.tsx`): free-text source college (searchable; known universities unlock a catalogue pick), free-text
  courses, required "Transferring to" selector (students) saved as `Transcripts.TargetInstitutionId`; `WorkflowEngine.startWorkflow` prefers the
  request's own target over the profile target. Source college prefills from profile "current institution". Sticky bar uses `md:left-64`.
- **Profile**: "Current institution/program" are editable free text (`PUT /account/student-profile` -> `StudentProfiles.PriorInstitutionName/FieldOfStudy`).
- **Status page**: From->To card (`fromCredits`/`toCredits`/`targetInstitutionName` on `GET /transcripts/:id`), top-3 matcher candidates per undecided course
  (`suggestions`), and on completion `notifySourceInstitution` emails the sending university's `DataPartners` contact (template `sourceDecisionNotice`);
  an internal note records when no contact exists.
- **Dashboard "Where I am now"**: pending courses editable inline -> `PATCH /transcripts/courses/:courseId` (student-owned, re-runs sp_TriageCourse + policy,
  blocked once posted).
- **Demo login (replaces the older autofill design)**: super admin picks one user per role (AppSettings `demo_login.users` JSON role->userId; none picked = seed
  accounts). Login page buttons call public `POST /auth/demo-login {userId}` which issues a real session server-side - NO password ever reaches the browser.
  Gated by `demo_login.enabled`, rate-limited. The earlier "show credentials" option no longer exists. Still enabled on production - turn it off before real launch.
- **Photos**: admins can set/remove any user's photo (`PUT/DELETE /account/photo/:userId`, Users edit panel). Generated initials avatars come from the old
  "Generate default photos"; real uploads replace them.
- **AI providers** (AI Controls > Providers, `ai-providers.service.ts`, AppSettings keys `ai.*`; secrets server-side, never returned): chat provider
  Anthropic or Azure OpenAI (REST: `{endpoint}/openai/deployments/{deployment}/chat/completions`, base endpoint WITHOUT `/openai/v1`), document provider
  rules or Azure Document Intelligence (`prebuilt-read`, api-version 2024-11-30). Card-per-provider UI; clicking a card makes it active. `AiService.callModel`
  routes by provider; `hasChatProvider()`/`completeText()` are public for the document reader. Readiness card reflects the active provider. Live Azure calls
  have NOT been tested. Needs outbound 443 to `*.openai.azure.com` and `*.cognitiveservices.azure.com`.
- **Skills**: the matcher's playbook (`buildSystemPrompt`) goes to whichever provider is active; 'documents'-category skills go to the document readers
  (Anthropic and DI). The rules matcher/reader do NOT read skills (open idea: let rules honour no-credit/elective skills). **Learned skills**:
  `GET /ai-controls/learned-skills` (`ai-learning.service.ts`) mines faculty decisions (overrides of the top pick, repeated elective/no-credit) into suggested
  rules; admin adds one with a click - nothing is automatic. Backtest/agreement stats shown there.
- **Explore wizard** (`pages/student/Explore.tsx`): 4 steps (courses, documents, compare with my-credits vs would-transfer, apply). `POST /student/apply
  {institutionIds}` creates one request per university via `TranscriptsService.submit` (skips ones with an active non-preview request).
- **Smart Upload** (`SmartUpload.tsx`): `POST /documents/:id/reprocess`, `DELETE /documents/:id` (file deleted only if no FK/request/public use),
  `POST /documents/:id/attach {transcriptId}`, confirmed docs re-editable. New SQL untested.
- **Emails**: coded templates remain the default; super admin edits subject/headline/body/button text, CC list and on/off per template
  (AppSettings `email.template.<key>`, chunked 900 chars, refreshed every 60s; endpoints `/email/overrides*`). Account/email-change/intake/partner-access/test emails
  cannot be disabled. Placeholders `{{firstName}}` etc. are listed per template in the editor. SQL/Resend path untested.
- **Gotchas learned**: AppSettings.SettingValue is NVARCHAR(1000); `tsx` must be installed locally for scripts; do not use `git add -A` while agent worktrees exist;
  `SchemaService.has(table, column)` guards pre-migration deployments.
- **Remaining roadmap**: SuperAdmin Partners table (search, expandable rows, bulk deactivate/delete - agent was in progress), improve the rules fallback (honour
  playbook), Document Intelligence/Azure OpenAI live verification, per-university AI settings UI, seed 020 apply, disable demo login before launch.
- **Email links/logo base URL**: `EmailService.appBaseUrl` = `APP_BASE_URL` env, else `https://$WEBSITE_HOSTNAME`, else a guessed azurewebsites host (logs a warning).
  The email logo is `${appBaseUrl}/logo.png`, so a broken logo in emails means `APP_BASE_URL` is unset/wrong - set it to the public site (e.g. https://transferhub.wcubeprojects.in).
- **Workflow "Agent does" steps** are a fixed list (`none|intake|match|finalize`): options in `WorkflowDesigner.tsx` `AGENT_TASKS`, behaviour in
  `workflow-engine.service.ts` `runAgentTask`, allowed values in DB constraint `CK_WS_Agent`. A new AI step needs all three (code + a migration).
- **System Settings > General** cards (Transfer Credit Rules, Security) are inert placeholders - nothing is stored or read; real values live in AI Controls and Workflows > Transfer rules.
- React gotcha: never define a component inside another component's body (inputs lose focus each keystroke) - e.g. `ProviderCard` is module-level in `AiControls.tsx`.

## Session 2026-10-28 (b): demo catalogue + super-admin permanent delete (branch `claude/super-admin-purge`, apply nothing - no migrations)
- **Demo data** `docs/demo-data/`: `pacific-ridge-catalogue.json` (fictional university `PRU`, 10 programs, 50 courses, 200 topics), `validate.js`, `build-postman.js`,
  generated Postman collection, README with the presenter flow (onboard partner PRU -> key -> POST via Postman -> review/import in Data Import > Submissions -> reset by deleting).
  Partner keys are scoped to ONE university code, so the catalogue is for `PRU` only. Regenerate the collection with `node docs/demo-data/build-postman.js` after editing the JSON.
- **Permanent delete** (super_admin ONLY, not in the permissions matrix): `src/api/src/purge/` - `GET /purge/:entity/:id/impact?cascade=` previews, `DELETE /purge/:entity/:id?cascade=`
  deletes in one transaction; entity = universities|programs|courses|topics. One rule table drives both: real history BLOCKS (transcripts, transcript courses, evaluations, equivalencies,
  appeals, multi-course decisions, programme/transfer/exam rules, workflows, approver groups, AI overrides, student targets, BU home university, programs shared with other universities);
  link/derived rows are deleted with it; informational links are detached (course primary program, student target program, schools become unmapped). A university needs cascade to also remove its
  programs/courses/topics. Unknown FK -> rollback + 409. Audit `DATA_PURGED`. UI: `components/shared/PermanentDeleteDialog.tsx` (preview + type DELETE) wired on Universities, Programs, Course Database,
  Topics editor, row + bulk. Test: `scripts/test-purge.ts` (stubbed DB). The delete SQL is untested against a live database - try a throwaway university first.
- **Demo students** (`docs/demo-data/`): `pacific-ridge-students.json` (30 PRU students, all importer fields, 207 courses from the PRU catalogue, 72 text-layer PDFs: transcript, ID/passport, TOEFL for international) and a no-documents variant, generated deterministically by `build-students.js`; Postman "Students" folder. Checked with the importer's real `checkRow` by `src/api/scripts/test-demo-students.ts`. Imported profiles are NOT accounts - they are "ready to claim" at `/intake` (the claim link is only returned in the response for mock profiles, so use a real mailbox email for the live claim demo). The purge cascade for a university also deletes its unclaimed `StudentSourceProfiles` (matched by InstitutionCode) and blocks on claimed ones.

## Session 2026-10-28 (c): university header branding + three demo data sets (branch `claude/university-branding-and-demo-sets`, NOT merged; no migrations)
- **Header branding**: `GET /account/university-brand` (admin/faculty only) returns the universities from the user's `UserScopeUniversities` rows (name, code, logo, banner);
  `components/layout/UniversityHeader.tsx` (rendered in `AppLayout` above `<main>`) shows banner background, logo (or initials), name, `CODE - Faculty|Administration`, and a
  switcher when the user has several universities. Logos/banners are uploaded per University on the Universities page (`ImageSourceField`). Root cause fixed along the way: uploaded
  `/uploads/public/:id` URLs never loaded because the API lives under `/api` - `assetUrl()` in `lib/api.ts` prefixes it (also used in the upload preview); public uploads now send
  `Cross-Origin-Resource-Policy: cross-origin`. A user with no scope rows (unrestricted) sees no university header.
- **Demo data is now one folder per set** under `docs/demo-data/` (index in its README): `test-mini/` (HTC, 2 programs/4 courses/3 students), `demo-1-pacific-ridge/` (PRU), `demo-2-cascade-valley/` (CVU).
  Files per set: `catalogue.json`, `students.json`, `students-no-documents.json`, `postman.collection.json`, `roster.json`, `set.json`. Shared generic tools in `docs/demo-data/tools/`
  (`validate.js`, `build-students.js`, `build-postman.js`, each takes the set folder); regenerating PRU is byte-identical to the earlier output. `scripts/test-demo-students.ts` checks all sets.
  The old root paths (`pacific-ridge-*.json`, `build-*.js`) no longer exist; anything above that mentions them means the PRU folder.
- **Demo 3** `docs/demo-data/demo-3-lakeshore-tech/` (Lakeshore Institute of Technology, `LIT`, applied/technical fields): 10 programs, 50 courses, 164 topics, 30 students (213 course rows, 69 PDFs); same layout/tools as demo 2; `test-demo-students.ts` now expects >= 4 sets.
- **Public images straight from Azure Storage** (no migration): the `public-assets` container is now created with anonymous *blob* read (never listing). `BlobStorageService.publicUrl()` checks the container really is publicly readable and, if so, `UploadsService.save` returns the direct blob URL (or `PUBLIC_ASSET_BASE_URL/<blob>` for a CDN/custom domain) for logos/banners, so `Institutions.LogoUrl/HeroImageUrl` hold an `https://...blob.core.windows.net/...` URL and no longer depend on the API route. If the storage account has "Allow blob anonymous access" disabled, it falls back to the old `/uploads/public/:id` API route (still works, plus `assetUrl()`). Existing `/uploads/public/:id` values keep working; re-upload to move them. Needs the storage account setting *Allow Blob anonymous access = Enabled*. Private documents are unchanged (private container, streamed through the authenticated API).

## Session 2026-10-28 (d): demo documents tool, image compression, storage check (branch `claude/demo-documents-tool`, NOT merged; no migrations)
- **Seed 017 result on live DB**: 4 receiving universities (BU 29, MDC 36, NU 25, NYU 32), MDC students have no target program because MDC offers no programs (it is typed `university` but has none). The "6 universities" note was an assumption; PRU/CVU/LIT/HTC only count once imported, and re-running 017 does not move students already assigned.
- **Demo documents** (super admin > Settings > "Demo documents", `/superadmin/settings/demo-documents`; API `GET /demo/documents/{kinds,students}`, `POST /demo/documents/generate`): pick students + document types, download one PDF or a ZIP (folder per student + README of what was made/skipped). Built from each student's own records (`Transcripts`/`TranscriptCourses` for the colleges they submitted, catalogue description + topics for syllabi when the course is matched). Kinds: transcript, id_document (passport for international), english_test (non-native only), syllabus, enrollment_letter. Renderers are pure functions in `demo/demo-documents.ts` (also holds a dependency-free STORE ZIP writer); layouts are made to classify and read correctly with the rules reader (checked in `scripts/test-demo-documents.ts`). DOB/passport numbers are derived from a hash of the user id (not stored anywhere). Offline pack for Maya: `npx tsx scripts/build-maya-documents.ts` -> `docs/demo-data/maya-documents/`.
- **Image compression** (`common/image-compress.ts`, `sharp`): every upload through `UploadsService.save` that is a JPEG/PNG/WebP is shrunk first - public logos/banners to <=1920px WebP, private document images to <=2400px JPEG (Azure Document Intelligence cannot read WebP). PDFs untouched; any failure stores the original.
- **Storage check**: `GET /demo/storage-status` (shown on the Demo documents page) reports provider (blob vs server disk), containers and whether the public container is anonymously readable. `BlobStorageService` now also tries to switch an EXISTING private `public-assets` container to blob read access (createIfNotExists never changes access of an existing container) and re-checks every 60s while it is private. If `AZURE_STORAGE_CONNECTION_STRING` is missing in App Service, uploads go to the server disk (lost on deploy) - the check page says so.
- **Collapsible sidebar** (all roles share `AppLayout`): desktop sidebar collapses to a 64px icon rail (toggle at the top, choice kept in `localStorage` `th.sidebar.collapsed`; icons get tooltips, groups become dividers, user block shows only the avatar). The mobile drawer is unchanged. `--sidebar-w` CSS variable on `<html>` lets fixed bars (submit-transcript action bar) follow the width. Also on branch `claude/pdfkit-import-fix`: pdfkit/sharp compiled-build import fix (PDFs 500'd in production), email layout fixes (long URLs -> "Open link", Outlook-safe button, `<br>` line breaks).

## Session 2026-10-28 (e): nav + insights + email templates polish (on main, no migrations)
- **Nav**: logo (sidebar, drawer, mobile bar) links to the role's dashboard; public-page logos link to `/`. Menu sections (Operations, Users, ...) fold to their heading (chevron; state in `localStorage` `th.nav.folded`; navigating into a folded section reopens it; icon-rail mode ignores folding). Super admin order: Dashboard, Operations, Users, Reports, **Master Data, Settings, Demo** (Demo scenario + Demo documents are their own section).
- **Workflow Insights** date range: preset (30/90/180/365) or "Custom range" with from/to dates (`GET /workflows/insights?from=&to=`, inclusive, wins over `days`).
- **Email templates** (System Settings > Email, `EmailTemplateManager.tsx`): one expandable-row list of built-in + custom templates (search, checkboxes, bulk Activate / Deactivate / Delete). Built-ins: deactivate = override `enabled:false` (not allowed for sign-in/access emails), activate clears it, Delete = reset to default text (built-ins cannot be deleted). **Custom templates** (`email-custom.service.ts`/`.controller.ts`, AppSettings `email.custom.<id>` chunked): name, audience, subject, headline, body, optional button (site path or https URL), placeholders `{{firstName}} {{lastName}} {{fullName}} {{email}} {{universityName}} {{supportEmail}} {{appBaseUrl}}`; live preview, test send, and **manual** send to up to 25 addresses (no automatic trigger). `POST /email/custom/bulk {builtin[], custom[], action}`. Test: `scripts/test-email-custom.ts`.

## Session 2026-10-28 (f): provider cards + custom providers + email test (branch `claude/providers-email-test`, not merged; no migrations)
- **AI Controls > Providers**: small cards (name + Active/Inactive + Configured) that expand into a larger card with every option (key, base URL, model/deployment, **Active switch**, Save, Test connection, Remove); closing returns to the small cards. Active switch saves at once: ON selects the provider, OFF sets the category to `none` (rules engine only). `ai.chat_provider` may now be `none | anthropic | azure_openai | custom:<id>`.
- **Add provider** = OpenAI-compatible chat-completions services (OpenAI, Azure AI Foundry `/openai/v1`, OpenRouter, vLLM...): name, base URL (https only; localhost/private/link-local/IP-literal hosts are refused because the server calls it), model, key (`Authorization: Bearer` or `api-key` header). Stored in AppSettings `ai.custom.<id>` (chunked, key never returned, `keySet` only). Anthropic also gets an optional base URL (gateway/proxy). `POST /ai-controls/providers/test {provider}` sends a one-word prompt. `ai-providers.service.ts` exports `isChatReady`/`chatProviderLabel`; `ai.service.ts` `callWith` routes by provider; test `scripts/test-ai-providers.ts`.
- **Email**: the separate "E-mail templates" gallery below the list is gone; the template table has a bulk **Send test to <address>** (uses the "Send a test email" address) alongside Activate/Deactivate/Delete.

## Session 2026-10-28 (g): provider UX, model parameters, engine benchmark, Explore compare (branch `claude/provider-ux-benchmark`, NOT merged; no migrations)
- **Provider cards**: each card keeps its grid position and animates (framer-motion `layout`) between small and large; clicking the expanded header (or the chevron) collapses it. Every card shows the model in use (Anthropic = matchModel/escalation from Settings, Azure = deployment, custom = model). **Model parameters** panel: temperature (0-1) and request timeout (5-300 s) stored in AppSettings `ai.temperature`/`ai.timeout_sec`, applied to Anthropic, Azure OpenAI and custom calls (`callWith`); max output tokens, shortlist size, escalation/auto-apply thresholds, caching, budget are shown read-only (edit in Settings).
- **Benchmark** (AI Controls > Benchmark; `ai/benchmark.service.ts`, `benchmark-metrics.ts`, `AiService.dryMatch`): DRY RUN of the matching step for up to 3 students into BU through each ready engine (Anthropic, Azure OpenAI, custom providers, built-in rules). Ground truth = past equivalency decisions (`Equivalencies` outcome 'equivalent' to a BU course) plus a small scripted reference table for Maya's three review courses (`SCENARIO_REFERENCE`). Metrics per engine and per student: top-1/top-3, avg/p95 time per course (shortlist, call, parse), tokens, cost, cost per correct, correct per minute, auto-apply count and how many were wrong, confidence when right vs wrong, composite score (50% accuracy, 25% speed, 25% cost). Endpoints `GET /ai-controls/benchmark/{engines,students}`, `POST /ai-controls/benchmark/run` (edit permission); nothing is saved/cached/logged. Human approval stages are not timed. Test: `scripts/test-benchmark.ts`. Live Anthropic/Azure numbers need the keys; the rules engine always runs.
- **Explore universities** (student): starts with one university (the student's target), "Add university to compare" up to 3, remove with X; `/student/compare` is called with only the selected ids.

## Session 2026-10-29: faculty + agency header branding (branch `claude/agency-faculty-branding`; apply migration 030)
- The header band (`UniversityHeader`) now also shows for **faculty** (their scoped universities, label "CODE · Faculty · <department>") and **agency** users (their own agency: logo, banner, name, "Partner agency"). `GET /account/university-brand` returns `{universities:[{id,code,name,logoUrl,heroImageUrl,kind,department}]}`; agency source order: `Users.AgencyId`, else `UserScopeAgencies`, else `Users.AgencyName` matched to `Agencies.Name`. Faculty and admins still need University rows under Users > Visibility scope to get a header.
- **Migration 030** adds `Agencies.LogoUrl/HeroImageUrl`; `AgenciesService` reads/writes them only when the columns exist (guarded); Agencies admin form has logo + banner upload fields (`ImageSourceField`).

## Session 2026-10-29 (b): "wow" features integrated (branch `claude/wow-features` = live tracker + scan/mobile + equivalency network + learning page + agency/faculty branding; NOT merged; apply migration 030 only)
- **Live tracker** (`src/api/src/events/`, UI `components/live/`, `components/workflow/ProgressTracker.tsx`): in-process `EventBus` + SSE `GET /api/events/stream?ticket=` (ticket from `POST /api/events/ticket`, 30 s single-use), per-user visibility via `EventAccessService`, internal notes staff-only, heartbeat 25 s, 5 connections/user, 15 min server-side recycle. Emits from workflow engine, requests/evaluations/exchange services (optional bus, fire-and-forget). UI: `LiveEventsProvider` in `AppLayout` (one EventSource per tab, backoff, 15 s polling fallback, batched query invalidation), `LiveIndicator`, student/agency toasts, pizza-tracker on `TranscriptStatus` (estimates from `getTimeline.avgMinutes`). Caveats: bus/tickets are per App Service instance (scale-out needs a shared bus); Azure may cut idle streams (~230 s) - client reconnects.
- **Scan view + mobile**: `components/scan/ScanViewer.tsx` (pdfjs-dist, highlights each extracted value on the page via text-layer matching `lib/scan-match.ts` or Azure DI word boxes `documents/di-layout.ts`), `components/capture/{CameraModal,CaptureFlow}.tsx` (rear camera, multi-page, client-side rotate/downscale/JPEG, pdf-lib combine, retrying upload), `StudentTabBar` (student role, < md), `.student-app` mobile CSS, PWA manifest/icons (no service worker). New deps: `pdfjs-dist@4.10.38`, `pdf-lib@1.17.1` (run `npm install` in src/ui). Not tested on real phones / real Azure DI polygons.
- **Equivalency network** (`src/api/src/network/`): anonymised cross-university history `GET /equivalency-network/course` (other universities never named; own university by name), `/summary`, `/settings` (`ai.network_boost`, default OFF, super_admin) with `networkBoost()` (+0.05..0.15, capped 0.7 rules / 0.99 overall, rationale suffix), wired into `AiService.runMatch/dryMatch` via an optional constructor arg; UI `NetworkPanel` in `RequestReview` ("Use this match") and a Network tab on Equivalencies. Boost excludes the target university's own decisions so the benchmark stays honest.
- **Learning tab** (AI Controls > Learning; `ai/learning-trend.ts`, `LearningTab.tsx`): `GET /ai-controls/learning/{trend,overview}` computed on demand (no migration): weekly agreement/top-3/instant-answer share/knowledge-base growth, recurring mistakes -> "turn into a playbook rule", client-side labelled demo trend. "Auto-apply safety" = agreement among picks >= autoLikelyThreshold (overrides after auto-accept are not recorded).
- **Faculty + agency header** (migration 030 adds `Agencies.LogoUrl/HeroImageUrl`): see the branding note above.

## Session 2026-10-29 (c): agency management fixes (branch `claude/agency-management-fixes`, NOT merged; no migrations)
- **Duplicate contact email**: `AgenciesService` now refuses (409) a contact email already used by another agency (case-insensitive, create + update + CSV import). An agency's contact email MAY equal an agency user's login email (the seed does this on purpose); user logins are still unique in `Users`.
- **Rename**: name edit validated (non-empty, unique); on rename `Users.AgencyName` of linked users is updated too. The agency form now shows save errors and a "Saved." note (failures were previously silent).
- **Agency users <-> agency**: `POST/PATCH /users` accept `agencyId` (or an exact `agencyName`, which is linked) and set `Users.AgencyId` + `AgencyName`; Users create/edit forms show an Agency dropdown for role agency. This is what the header logo/banner resolves from.
- **Permanent delete**: `agencies` added to the purge framework (super_admin only). Blocks if its users submitted transcript requests; otherwise unlinks users (accounts kept), removes scope rows, deletes the agency. UI: row + bulk "Delete permanently" on Agencies. Logo/banner editing lives in the expanded row's form (needs migration 030; restart the API if it was applied after the app started - a negative schema check is re-tried every minute).

## Session 2026-10-29 (d): student view fixes (branch `claude/student-view-fixes`, NOT merged; apply migration 031)
- **Compare list** now includes `community_college` institutions (they were filtered out by `Type = 'university'` in `student-journey.service.ts`, used by list/compare/apply); `GET /student/universities` returns `type`. Cancelled requests are excluded from the student's courses, progress, source-college and "already applied" checks.
- **Compare UI**: "Your target" chip sits right beside the university name; the "Add university" control is now an empty dashed slot next to the shown universities (max 3 total), not a bar above them.
- **Submit transcript wording**: step 1 = the college where the courses were already completed (source), separate "University you want to transfer to"; courses are only from the source college.
- **Sidebar**: students get a foldable "My transcripts" section (`StudentTranscriptsNav`) listing each request, `source -> target`, status chip (cancelled / complete / current stage) and date; `GET /transcripts` now returns `targetInstitutionName` + `currentStage`.
- **Tracker** (`ProgressTracker`) is vertical again at every width.
- **Cancel** (migration 031: `Transcripts.CancelledAt/CancelReason/CancelNote/CancelProgress`, `cancelled` allowed in `Status` and `WorkflowStatus`): `POST /transcripts/:id/cancel {reason, note?}` by the owning student (or submitting agency) while the request is open; open stages become `skipped`, staff queues drop it (they filter `WorkflowStatus='active'`), a progress snapshot (courses decided/total, credits awarded, stages done, stopped-at stage) is stored and shown on the cancelled request page; audit `TRANSCRIPT_CANCELLED`. 503 until 031 is applied. Test: `scripts/test-cancel.ts`.

## Session 2026-10-29 (e): AI usage numbers fix + provider cards + status page (merged to main; migration 031 APPLIED by the user)
- **Tokens-used "blunder" root cause**: SQL Server returns `BIGINT` sums as strings, so `inputTokens + outputTokens` concatenated ("3234" + "724" = "3234724"; "0"+"0" = "00"). `AiUsageService` now converts every numeric column (`num()` helper) for the summary and by-request rows, and the UI also wraps sums in `Number()`. Remember this for any new `SUM(CAST(.. AS BIGINT))` query.
- **AI efficiency KPIs** (AI Controls > Usage): tokens per request/call, cost per request, share of tokens avoided, calls skipped %, cache-hit %, prompt-cached share, average/slowest response time (`AiUsageLog.DurationMs`), plus a By-model table and avg time per operation. All come from `AiUsageService.summary().kpis/byModel`.
- **Provider cards** (`ConnectedGrid` in `AiControls.tsx`): small cards always stay in the grid; clicking one toggles its full card open directly underneath, joined by a notch pointing at that small card; clicking the small card again (or the header) closes it.
- Demo documents lists up to 1000 students (was 80; downloads stay limited to 25); student status page shows the steps once (tracker) and notes separately.

## Session 2026-10-29 (f): custom roles, per-university approver groups, university panel room (branch `claude/roles-workflow-groups`; apply migration 032)
- **Custom roles** (migration 032: `Roles.BaseRole/IsSystem/IsActive`): super admin creates roles on Roles & Permissions (`RolesManager`, `/permissions/roles` CRUD, audit `ROLE_CREATED/DELETED`). A custom role has its own grants in the matrix (starts as a copy of its base role's grants) and a **BaseRole** (student/faculty/admin/agency, never super_admin). Mechanism: `JwtStrategy`/`AuthService` return `role` = BaseRole (so every `@Roles()` check, route guard and UI shell treats the user as that built-in role) plus `roleKey` = the real role name; `RolesGuard` and `GET /permissions/my` use `roleKey` for the `@Permission()` matrix. Users forms take roles from `GET /permissions/assignable-roles` (plain admins never get super_admin). Delete blocked while users hold the role; built-ins cannot be deleted/deactivated. Code degrades before 032 (`SchemaService.has('Roles','BaseRole')`). Limit: only `@Permission()`-gated endpoints follow the custom role's own grants; everything else follows its base role. Test: `scripts/test-custom-roles.ts`.
- **Per-university approver groups**: creating a university workflow ("Copy from default") now clones every approver group on the copied stages as `<CODE> - <name>` with `InstitutionId` = that university (no members; reused if it exists) and points the new stages at them; the response carries `createdGroups` and the designer says so. Approver groups tab: university picker per group (it was never sent before), filter, university label; a university workflow's stage picker offers its own + shared groups only.
- **University panel**: left details pane can be hidden ("Hide details for more room") so Institutions/Programs/Courses/Topics use the full width; nested program editor split is 1:2 (sharing area gets the room); expanded table cell padding reduced.

## Session 2026-10-29 (g): faculty university scope (branch `claude/faculty-university-scope`, NOT merged; no migrations)
- **Root cause**: `ScopeService.universityScope()` began `if (viewer.role !== 'admin') return null`, so *only* admins were ever
  narrowed. A faculty user with `UserScopeUniversities` rows saw every university's requests, queues and evaluations.
- **Fix**: `isScopedStaffRole(role)` (= admin | faculty, exported from `policy/scope.service.ts`) now gates `universityScope`,
  `canViewTranscript`, `canWorkRequest` and `canManageUser`; `staffUniversityScope()` is just an alias now. Unchanged rules:
  super admins are never narrowed, **no scope rows = unrestricted**, students/agencies keep their ownership checks.
- **Faculty narrowing is additive**: workflow-stage membership (`myStageIds`) AND university scope both apply.
- Scoped staff on an **outgoing** request (their university is the source) are read-only everywhere now, not just admins:
  `requests` stage actions, `evaluations.decide`, `appeals.decide`, `transcripts.updateStatus`.
- Call sites touched: `requests.service` (assertCanView, timeline readOnly, queue, bulk-approve), `transcripts.service.findAll`
  (faculty used to be narrowed by SOURCE institution only; super admins were wrongly narrowed by the legacy branch - fixed) +
  `adminCanSee` via `transcripts.controller`, **`evaluations.service` list/findById/decide (was completely unscoped - this is the
  faculty queue)**, `appeals.service` listForStaff/decide (was unscoped), `dashboard.service` faculty waiting/backlog/appeals,
  `uploads.service`, `events/event-access.service`, and everything already routed through `universityScope` (users, bento,
  network, comparison, progress, student-journey, transfers).
- **Course-detail gap (the "faculty is not displayed with all the course details" report)**: the per-course table comes from
  `TranscriptStages.AiBrief`, and `getTimeline` only returned it `WHERE s.Status = 'active'` - so a faculty reviewer lost the whole
  course list as soon as their stage was approved, or before it activated. It is now returned for every stage a staff viewer can
  see, and `RequestReview.tsx` falls back to the most recent stage that carries one. The brief also gained `term`,
  `originalCredits`/`normalisedCredits` (shown as "X taken -> Y converted") and the lane is now its own "Status" column.
  Nothing was role-gated away from faculty in that table - `canAct` only hides the action buttons.
- Test: `scripts/test-faculty-scope.ts` (stubbed DB). `test-events.ts` was updated: faculty now go through `canViewTranscript`.
- **Not changed / known gaps**: `documents.service` smart-upload access still checks `role === 'admin'` only, because
  `canManageUser` matches students by TARGET university and would lock source-side faculty out of their own students' documents;
  `studentInScope` is still target-only for the same reason; the bento faculty widgets are all "my own work" so they needed no
  scope. Nothing was verified against a live database.

## Session 2026-10-29 (g): demo dry-run gaps (branch `claude/student-journey-gaps`; apply migration 033)
Four areas the user found while rehearsing the demo. One branch, three lines of work (two built by agents, merged in).

**1. Student journey (registration -> smart upload -> submit)**
- **University mismatch is now flagged.** `DocumentsService.profileCheck()` (returned on `GET /documents/intakes/:id`) compares the college on a transcript against the student's `PriorInstitutionName`, their past requests and their education rows; Smart Upload shows an amber "this does not match your profile" panel. Name comparison is `sameInstitution()` in `document-types.ts` (word-set match, ignores "University/College/(synthetic)" noise) - test `scripts/test-document-profile-match.ts`.
- **Documents fill the profile.** `fillProfileFromDocument()` runs on confirm and writes ONLY into blanks: prior institution, GPA, credits completed (also onto the matching `StudentEducation` row), student id, country of origin (from an ID), institution from an enrolment letter. Each write is isolated so a missing column never loses the rest.
- **Courses are no longer retyped.** Submit Transcript lists the transcripts Smart Upload already read (`documentsApi.list()` filtered to docType transcript, status read/needs_review/confirmed) with "Use these courses", which routes through the existing `?intake=<id>` prefill.
- **Target university + program.** Migration 033 adds `Transcripts.TargetProgramId`; the submit form asks "Program you want to join" (prefilled from the profile, options from the chosen university, each showing credits + course count) and sends `targetProgramId`. Root cause of "we are asked again": a profile target missing from `GET /account/targets` (that list is `Type='university'` and active only) left the select blank - the student's own target is now injected as an option so it stays chosen.
- **Credits everywhere a thing is picked**: `GET /account/targets`, `GET /courses/programs` and public `GET /auth/programs` now return `credits`/`courses` per program (sum over `ProgramCourses` + `Courses.ProgramId`); course pickers put the credits in the option label itself, not only the sublabel.
- **Student transcript notes** now sit beside the step they belong to (`ProgressTracker showNotes`); the collapsible block below is only for notes tied to no step, and is hidden when empty. The From->To card shows the target program.
- **MyProfile** shows the rest of what registration captured: applicant type, admission status, entry term, school/college, English (native + test), outside-US coursework, high school, credits completed, the full education history and exam credits (`GET /account/student-overview` gained `education` + `examCredits`; `users.findById` gained the migration-015 columns, guarded by `SchemaService`).

**2. Explore** step 1 shows the same credit picture as the dashboard: per-course converted + as-taken credits, the secure/likely/pending/not-counted chip, and an as-taken total.

**3. Demo documents** (agent): every applicable kind is now generated rather than skipped - synthetic coursework/college/English scores are derived deterministically from the name when the student has none, and ID produces both a passport page and a card. New **"Type the details"** tab + `POST /demo/documents/{generate-manual,check-manual}` builds documents from typed data with no student record. Only real failures remain in the ZIP's skip list.

**4. Faculty scoping** (agent): `universityScope()` only ever narrowed `admin`, so faculty with `UserScopeUniversities` rows saw everything. Now `isScopedStaffRole()` (`admin|faculty`) gates `universityScope`/`canViewTranscript`/`canWorkRequest`/`canManageUser`/`partiesFor`, and `staffUniversityScope()` is an alias so the two cannot drift. Scoped faculty see incoming OR outgoing only, across the queue, transcripts, **evaluations and appeals (both were completely unscoped for every role)**, dashboard counts, request documents and SSE events; outgoing stays read-only (no deciding). Super admins and anyone with no scope rows are unchanged. Also fixed: a super admin WITH scope rows used to be narrowed by a legacy source-only branch in `transcripts.findAll`.
  - **Course details gap, real cause**: `getTimeline` returned `aiBrief` only for the *active* stage, so the per-course table vanished for a reviewer once their stage passed. Now returned for every stage a staff viewer may see, the page falls back to the latest stage carrying one, and the table gained Term + Status columns and "4 taken -> 3 converted" credits.
  - **"from and to" for student records**: `studentInScope` matched the target university only, so sending-side staff could see the request but not the student. It now also matches a request's source institution; Smart Upload documents follow the same rule for faculty.
- Not verified: nothing was run against the live database (the sandbox cannot reach Azure SQL), and none of the new UI was opened in a browser.
