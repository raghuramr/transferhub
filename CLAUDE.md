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
