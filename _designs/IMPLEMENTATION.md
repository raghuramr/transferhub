# TransferHub — Implementation Reference

> **Repo:** `raghuramr/transferhub` (formerly `raghuramr/universitymanager`)
> **Stack:** React 19 + Vite + Tailwind v4 + TanStack Query (UI) · NestJS + TypeScript (API) · SQL Server / Azure SQL (DB)
> **Last updated:** 2026-10-24

This document is the single authoritative reference for every feature, migration, seed file, API endpoint, UI page, and tool built across all sessions. Use it to orient yourself in the codebase without re-reading every commit.

---

## Table of Contents

1. [Repository Identity](#1-repository-identity)
2. [Database — Migrations](#2-database--migrations)
3. [Database — Seed Files](#3-database--seed-files)
4. [API Modules & Endpoints](#4-api-modules--endpoints)
5. [UI Pages & Components](#5-ui-pages--components)
6. [Auth & Roles](#6-auth--roles)
7. [Roles & Permissions Matrix](#7-roles--permissions-matrix)
8. [Uploads Subsystem](#8-uploads-subsystem)
9. [Course Topics](#9-course-topics)
10. [Programs CRUD & Sharing](#10-programs-crud--sharing)
11. [Student Self-Registration](#11-student-self-registration)
12. [MCP Server — DB Script Runner](#12-mcp-server--db-script-runner)
13. [PowerShell DB Script Runner (GUI)](#13-powershell-db-script-runner-gui)
14. [AI Integration (Planned)](#14-ai-integration-planned)
15. [Deployment](#15-deployment)
16. [Environment Variables Reference](#16-environment-variables-reference)
17. [Demo Accounts](#17-demo-accounts)

---

## 1. Repository Identity

| Item | Value |
|---|---|
| GitHub repo | `raghuramr/transferhub` |
| Previously named | `raghuramr/universitymanager` |
| Main branch | `main` (all current work) |
| Feature branch (legacy) | `claude/sleepy-maxwell-mzyijb` — merged into `main` 2026-10-24 |
| Azure SQL DB | `TransferHubDB` on `codecrafterstransferhub.database.windows.net` |
| Azure App Service | Configured in `.github/workflows/main_codecrafters.yml` |

**Note:** The `transferhub` and `universitymanager` GitHub repos are the same repository (same commit hashes). The branch `claude/sleepy-maxwell-mzyijb` was merged into `main` without conflicts — `main` had only one unique commit (the Azure deploy workflow file) at the time of merge.

---

## 2. Database — Migrations

Run in filename order against `TransferHubDB`. Every file is **idempotent** (IF NOT EXISTS guards). Use `tools/db-script-runner/` (PowerShell GUI) or `tools/db-mcp-server/` (MCP server) — never run manually in SSMS.

> **Azure SQL note:** `001_database.sql` cannot run against Azure SQL (no `USE` across connections). Create the DB as its own Azure resource first, then run `002` onward.

| File | What it creates |
|---|---|
| `001_database.sql` | `CREATE DATABASE TransferHubDB` — run against `master` only |
| `002_auth_and_roles.sql` | Roles, Departments, Users (all profile/contact fields, AgencyId), RefreshTokens, PasswordResetTokens, AuditLog, PermissionModules, PermissionOperations, RolePermissions |
| `003_institutions_courses_programs.sql` | Institutions ("Universities" in the UI), Programs (IsActive, UpdatedAt), Courses (ProgramId FK), Equivalencies |
| `004_transcripts_and_evaluations.sql` | StudentProfiles, Transcripts, TranscriptCourses, Syllabi, Evaluations, AIMatchCandidates |
| `005_views_and_procedures.sql` | 3 views + `sp_TriageCourse` / `sp_RecordDecision` (CREATE OR ALTER — always idempotent) |
| `006_pages.sql` | Pages (CMS) |
| `007_forms.sql` | Forms, FormSubmissions |
| `008_universities_institutions_agencies.sql` | Agencies, AcademicUnits ("Institutions" in UI), UserScopeUniversities, UserScopeAcademicUnits, UserScopeAgencies, LogoUrl/HeroImageUrl on both entity types |
| `009_course_topics.sql` | CourseTopics (with ReferenceLinksJson column for `{label,url}` pairs) |
| `010_uploads.sql` | Uploads table (file storage metadata) |
| `011_program_sharing_and_topic_status.sql` | ProgramUniversities (M:M owner+shared), ProgramCourses (M:M), UniversityTopicStatus (per-university topic active/inactive override) |
| `012_student_registration_fields.sql` | Adds to StudentProfiles: TargetInstitutionId, TargetProgramId, PriorInstitutionName, HighestEducationLevel, FieldOfStudy, GPA, GraduationYear, EmergencyContactName, EmergencyContactPhone |

---

## 3. Database — Seed Files

Run in filename order **after all migrations**. Every file is **idempotent** (MERGE / WHERE NOT EXISTS). After seeding, always run `npm run seed:users` from `src/api` to hash demo passwords (T-SQL can't compute argon2id — the seed SQL inserts placeholder hashes).

| File | What it seeds |
|---|---|
| `001_reference_data.sql` | Roles (student/faculty/admin/agency/super_admin), Departments, Institutions (BU etc.) |
| `002_courses_and_equivalencies.sql` | BU/Northeastern/NYU + AI/ML course catalog (~150+ courses); workbook equivalency mappings |
| `003_demo_users.sql` | 5 named demo accounts + 120 synthetic students (placeholder password hashes — must run `npm run seed:users` after) |
| `004_pages.sql` | 3 demo CMS pages |
| `005_forms.sql` | 1 demo Custom Form |
| `006_agencies_academicunits_programs.sql` | Agencies, AcademicUnits, Programs |
| `007_course_topics.sql` | All seeded CourseTopics rows |
| `008_roles_permissions.sql` | PermissionModules, PermissionOperations, starting RolePermissions grant set |

---

## 4. API Modules & Endpoints

Base URL: `http://localhost:3001` (dev). All endpoints require JWT (`Authorization: Bearer <token>`) unless marked **PUBLIC**.

### Auth (`/auth`)

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/login` | PUBLIC | Email + password → `{accessToken, refreshToken, user}` |
| POST | `/auth/logout` | JWT | Revokes refresh token |
| POST | `/auth/refresh` | PUBLIC | Refreshes access token |
| POST | `/auth/register` | PUBLIC | Student self-registration (see §11) |
| GET | `/auth/universities` | PUBLIC | Lists active Institutions for registration dropdown |
| GET | `/auth/programs?institutionId=N` | PUBLIC | Lists Programs offered by a University (via ProgramUniversities) |

### Users (`/users`)

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/users` | admin+ | List all users (paginated) |
| POST | `/users` | admin+ | Create user (sends welcome email) |
| GET | `/users/:id` | self or admin+ | Get user by id |
| PATCH | `/users/:id` | self or admin+ | Update user |
| POST | `/users/:id/unlock` | admin+ | Unlock locked account |
| PUT | `/users/:id/scope` | admin+ | Set UserScope (universities, institutions, agencies) |

### Universities/Institutions (`/universities`)

| Method | Path | Auth | Permission module |
|---|---|---|---|
| GET | `/universities` | JWT | — |
| POST | `/universities` | admin+ | `universities/create` |
| PATCH | `/universities/:id` | admin+ | `universities/edit` |
| DELETE | `/universities/:id` | admin+ | `universities/delete` |
| GET | `/universities/:id/institutions` | JWT | — |
| POST | `/universities/:id/generate-page` | admin+ | Creates/refreshes CMS page aggregating CourseTopics |

### Institutions/AcademicUnits (`/institutions`)

Full CRUD with `@Permission()` matrix enforcement on mutations.

### Agencies (`/agencies`)

Full CRUD with `@Permission()` matrix enforcement on mutations.

### Courses (`/courses`)

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/courses/bu` | JWT | BU courses (scoped by UserScopeUniversities) |
| GET | `/courses/external` | JWT | External courses (scoped) |
| GET | `/courses/programs` | JWT | All programs (+ `includeInactive`, `institutionCode`, `institutionName`) |
| POST | `/courses/programs` | admin+ | Create program |
| PATCH | `/courses/programs/:id` | admin+ | Update program |
| DELETE | `/courses/programs/:id` | admin+ | Deactivate program |
| GET | `/courses/programs/:id/universities` | JWT | Universities offering a program |
| POST | `/courses/programs/:id/universities` | admin+ | Share program with additional university |
| DELETE | `/courses/programs/:id/universities/:institutionId` | admin+ | Remove sharing (cannot remove owning university) |
| GET | `/courses/programs/:id/courses` | JWT | Courses in a program |
| POST | `/courses/programs/:id/courses` | admin+ | Attach course to program |
| DELETE | `/courses/programs/:id/courses/:courseId` | admin+ | Detach course from program |
| GET | `/courses/by-institution/:institutionId` | JWT | All courses for any university |
| POST | `/courses` | admin+ | Create course |
| PATCH | `/courses/:id` | admin+ | Update course |
| DELETE | `/courses/:id` | admin+ | Deactivate course |
| POST | `/courses/import` | admin+ | Bulk import |
| GET | `/courses/export` | admin+ | CSV export |

### Course Topics (`/course-topics` and `/courses/:courseId/topics`)

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/courses/:courseId/topics` | JWT | List topics; `?institutionId=N` adds `isActiveForUniversity` |
| POST | `/courses/:courseId/topics` | faculty+ | Create topic |
| PATCH | `/course-topics/:id` | faculty+ | Update topic |
| DELETE | `/course-topics/:id` | faculty+ | Delete topic |
| PUT | `/course-topics/:id/university-status` | faculty+ | Toggle topic active/inactive per university |

### Evaluations, Transcripts, AI Match — existing endpoints, unchanged.

### Permissions (`/permissions`) — super_admin only

| Method | Path | Description |
|---|---|---|
| GET | `/permissions/modules` | List permission modules |
| GET | `/permissions/operations` | List operations |
| GET | `/permissions/matrix` | Full role×module×operation matrix |
| PUT | `/permissions/matrix` | Bulk upsert grants |
| GET | `/permissions/my` | **Any authenticated role** — caller's own effective grants |

### Uploads (`/uploads`)

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/uploads` | JWT | Upload private file |
| GET | `/uploads/:id` | JWT (owner or admin+) | Serve private file |
| POST | `/uploads/public` | admin+ | Upload public file (logos/hero images) |
| GET | `/uploads/public/:id` | PUBLIC | Serve public file |

### Pages (`/pages`) — CMS

Full CRUD. Slug-based lookup. University public-page generator (`POST /universities/:id/generate-page`) uses PagesService internally.

### Forms (`/forms`)

Full CRUD for form definitions + submissions. Supports `'file'` field type (uploads via `/uploads`).

### Agent/Chat (`/agent/chat`) — PLANNED, not built

---

## 5. UI Pages & Components

All pages live under `src/ui/src/pages/`. Routes defined in `src/ui/src/App.tsx`.

### Public (unauthenticated)

| Route | File | Notes |
|---|---|---|
| `/login` | `auth/LoginPage.tsx` | Argon2id password check; locked account handling; link to `/register` |
| `/register` | `auth/RegisterPage.tsx` | Student self-registration (see §11) |

### Student (`/student`)

| Route | File | Notes |
|---|---|---|
| `/student` | `student/StudentDashboard.tsx` | Evaluation status overview |
| `/student/transcripts` | `student/TranscriptList.tsx` | — |
| `/student/evaluations` | `student/EvaluationTracker.tsx` | Per-course status + provisional range |

### Faculty (`/faculty`)

Evaluation workbench, transcript review, AI match results.

### Admin (`/admin`)

User management, transcript intake, evaluation management, audit log.

### Super Admin (`/superadmin`)

| Route | File | Notes |
|---|---|---|
| `/superadmin` | `superadmin/SuperAdminDashboard.tsx` | — |
| `/superadmin/universities` | `superadmin/UniversitiesManagement.tsx` | Universities + nested Institutions + Programs sub-lists; 95% width |
| `/superadmin/institutions` | `superadmin/InstitutionsManagement.tsx` | 95% width |
| `/superadmin/agencies` | `superadmin/AgenciesManagement.tsx` | 95% width |
| `/superadmin/programs` | `superadmin/ProgramsManagement.tsx` | Full catalog across all universities; Program sharing controls |
| `/superadmin/users` | `superadmin/UserManagement.tsx` | 95% width; scope editor (tree format) |
| `/superadmin/courses` | `superadmin/CourseDatabase.tsx` | 95% width; Topics action per row |
| `/superadmin/pages` | `superadmin/PagesManagement.tsx` | CMS |
| `/superadmin/forms` | `superadmin/FormsManagement.tsx` | — |
| `/superadmin/settings/roles-permissions` | `superadmin/RolesPermissions.tsx` | Live role×module×operation matrix |

### Shared Components

| Component | File | Notes |
|---|---|---|
| `DataTable` | `components/shared/DataTable.tsx` | Sortable, filterable, paginated; `showExport` prop |
| `AppLayout` | `components/layout/AppLayout.tsx` | Sidebar (hidden on mobile, slide-over drawer); mobile top bar |
| `CourseTopicsEditor` | `components/CourseTopicsEditor.tsx` | Topic CRUD with reference links |
| `CourseTopicsUniversityMatrix` | `components/CourseTopicsUniversityMatrix.tsx` | Per-university topic toggle grid |
| `ProgramUniversitiesList` | `components/ProgramUniversitiesList.tsx` | Assign/remove sharing universities |
| `ProgramCoursesList` | `components/ProgramCoursesList.tsx` | Attach/detach courses via University→Course picker |
| `UniversityInstitutionTree` | `components/UniversityInstitutionTree.tsx` | Scope picker — University + Institution independently checkable |
| `ImageSourceField` | `components/shared/ImageSourceField.tsx` | Pick upload URL or external URL for logos/hero images |
| `CascadingMasterDataSelect` | `components/shared/CascadingMasterDataSelect.tsx` | University→Program→Course cascading picker with inline create |
| `FormRenderer` | `components/FormRenderer.tsx` | Renders custom forms including `file` field type |
| `FieldEditor` | `components/FieldEditor.tsx` | Form builder with all field types including `file` |

### Hooks

| Hook | File | Notes |
|---|---|---|
| `usePermissions` | `hooks/usePermissions.ts` | Calls `GET /permissions/my`; exposes `can(module, operation)` |
| `useAuth` | `hooks/useAuth.ts` | Auth state from localStorage; token refresh |

---

## 6. Auth & Roles

Five roles (seeded in `001_reference_data.sql`):

| Role | Code | Default access |
|---|---|---|
| Student | `student` | Own transcripts, evaluations, profile |
| Faculty | `faculty` | Evaluation workbench, course topics (edit) |
| Admin | `admin` | User management, transcript intake, evaluation management |
| Agency | `agency` | Submit forms, view own submissions |
| Super Admin | `super_admin` | Everything including permissions matrix |

Password hashing: **argon2id** via `argon2` npm package. Tokens: JWT access (15 min) + refresh (7 days). Account lockout after 5 failed attempts (configurable via `MAX_LOGIN_ATTEMPTS`, `LOCK_DURATION_MINUTES`).

---

## 7. Roles & Permissions Matrix

**Location:** `src/api/src/permissions/` + `src/ui/src/pages/superadmin/RolesPermissions.tsx`

- DB tables: `PermissionModules`, `PermissionOperations`, `RolePermissions` (migration `002_auth_and_roles.sql`)
- Modules: `courses`, `course_topics`, `users`, `universities`, `institutions`, `agencies`, `programs`, `pages`, `forms`, `audit_log`, `transcripts`, `evaluations`
- Operations: `view`, `create`, `edit`, `delete`, `import`, `export`, `bulk_action`
- Absence of a row = not allowed (same pattern as `UserScopeUniversities`)
- **Live enforcement:** `@Permission(moduleKey, operationKey)` decorator on mutation endpoints → checked via `RolePermissionsCacheService` (30s in-memory cache, invalidated immediately on every `PUT /permissions/matrix`)
- **Fallback:** endpoints without `@Permission()` still use their static `@Roles()` array unchanged
- **UI enforcement:** `usePermissions().can(module, op)` gates Import/Export/bulk-action buttons in all five management tables

---

## 8. Uploads Subsystem

**Migration:** `010_uploads.sql` · **Module:** `src/api/src/uploads/`

Two storage paths, never mixed:

| Type | Storage path | Served via | Access |
|---|---|---|---|
| Private (student docs, form files) | `src/api/storage/uploads/{role}/{userId}/{entityType}/{entityId}/{filename}` | `GET /uploads/:id` | JWT; owner or admin+/faculty |
| Public (logos, hero images) | `src/api/storage/public-uploads/{uuid}-{filename}` | `GET /uploads/public/:id` | Unauthenticated |

- `Institutions.LogoUrl`/`HeroImageUrl` and `AcademicUnits.LogoUrl`/`HeroImageUrl` store either a `/uploads/public/:id` path or an external `https://...` URL
- Custom Forms gained a `'file'` field type — upload happens first, `{id, url, name}` stored in submission JSON
- **Known limitation (deferred):** storage is local disk only. For production Azure deployment, should move to Azure Blob Storage (private + public containers). Not yet built.

---

## 9. Course Topics

**Migration:** `009_course_topics.sql` · **Table:** `CourseTopics` · **Column:** `ReferenceLinksJson` (JSON `[{label, url}]`)

- Each Course can have multiple Topics (title, description, reference links)
- Topics editable by `super_admin`/`admin`/`faculty` only; any authenticated role can view
- Per-university active/inactive override via `UniversityTopicStatus` (migration `011`)
- **Purpose:** give the AI matcher syllabus-level detail, not just course title/description

UI entry point: "Topics" action on each row in `CourseDatabase.tsx` → `CourseTopicsEditor.tsx`

University public page generator (`POST /universities/:id/generate-page`) aggregates `CourseTopics` across all university courses, grouped by Program, and creates/refreshes a CMS page (`slug: university-{code}`).

---

## 10. Programs CRUD & Sharing

**Migration:** `011_program_sharing_and_topic_status.sql` adds `ProgramUniversities`, `ProgramCourses`, `UniversityTopicStatus`

### Program ownership model

- `Programs.InstitutionId` = owning/managing University (never removed)
- `ProgramUniversities (ProgramId, InstitutionId)` = every University offering the program (owner always included, backfilled)
- A Program can be offered by multiple Universities (shared); cannot remove the owner via API

### Course-to-Program mapping

- `ProgramCourses (ProgramId, CourseId)` = real M:M (replaces the single `Courses.ProgramId` FK for management purposes)
- `Courses.ProgramId` retained for display/reporting queries (original/primary program)
- A Course can belong to multiple Programs (e.g. shared intro course in CS + Data Science)

### Topic activation per University

- `UniversityTopicStatus (InstitutionId, TopicId, IsActive)` — absence = active
- Same topic's active/inactive state is university-wide (not per Program-University pair)

### UI entry points

1. **`UniversitiesManagement.tsx`** — "Programs" sub-list in each university's expanded row (`UniversityProgramsList`)
2. **`ProgramsManagement.tsx`** (`/superadmin/programs`) — full catalog across all universities; expanded row has edit form (left) + sharing controls (right: `ProgramUniversitiesList` + `ProgramCoursesList` + `CourseTopicsUniversityMatrix`)

---

## 11. Student Self-Registration

**Migration:** `012_student_registration_fields.sql` · **Route:** `POST /auth/register` (PUBLIC)

### What is captured

| Section | Fields |
|---|---|
| Account | email, password, firstName, lastName |
| Communications | mobilePhone, emergencyContactName, emergencyContactPhone |
| Location | addressLine1, addressLine2, city, state, postalCode, country, countryOfOrigin |
| Education | priorInstitutionName, highestEducationLevel, fieldOfStudy, GPA (0–4.33), graduationYear |
| Transfer target | targetInstitutionId (University dropdown), targetProgramId (cascading Program dropdown) |

### API changes

- `POST /auth/register` — validates uniqueness, hashes password, inserts Users + StudentProfiles, auto-login, sends welcome email (non-fatal)
- `GET /auth/universities` — public; lists active Institutions for dropdown
- `GET /auth/programs?institutionId=N` — public; joins `ProgramUniversities` so shared programs appear under each offering university

### UI

- `src/ui/src/pages/auth/RegisterPage.tsx` — React Hook Form + Zod validation; cascading University→Program dropdowns via TanStack Query; auto-login on success; link back to `/login`
- `LoginPage.tsx` — "New student? Create an account" link added → `/register`

### Design decisions

- `TargetInstitutionId`/`TargetProgramId` on `StudentProfiles` are **informational only** — not tied to `UserScopeUniversities` (students see all universities by default, not just their target)
- All registration fields except Account (email/password/firstName/lastName) are optional
- GPA validated: `@Min(0) @Max(4.33)`

---

## 12. MCP Server — DB Script Runner

**Location:** `tools/db-mcp-server/` · **Auto-discovered via:** `.mcp.json` at repo root

### Setup (one-time)

```bash
cd tools/db-mcp-server
npm install
npm run build   # compiles TypeScript → dist/
```

### Tools exposed

| Tool | Description |
|---|---|
| `test_connection` | Connects and reports success/failure + which env file was used |
| `list_scripts` | Lists `.sql` files in `migrations/` or `seed/` with status: Not Applied / Applied / Changed / Failed |
| `run_migrations` | Applies `database/migrations/*.sql` in filename order; stops at first failure |
| `run_seeds` | Applies `database/seed/*.sql` in filename order; stops at first failure |

Both `run_*` tools accept:
- `scripts` (optional string[]) — specific filenames to run; omit for all
- `onlyIfNeeded` (default `true`) — skip already-Applied files with matching checksum

### Shared ledger with PowerShell tool

Uses the same `dbo.__ScriptRunnerHistory` table (same columns, same SHA-256 checksum logic) as `tools/db-script-runner/DbScriptRunner.ps1`. Either tool can see what the other applied.

### Env resolution order

1. `DB_MCP_ENV_FILE` env var → explicit path
2. `tools/db-mcp-server/.env` (if exists, gitignored)
3. `src/api/.env` ← **default** — shares credentials with the API, no duplication

### Limitations

- TCP connections only (Azure SQL, any network SQL Server). Does **not** support LocalDB (`(localdb)\...`). Use the PowerShell GUI for LocalDB.
- Natural filename sort (`002_` before `011_`) matches the PowerShell tool exactly.

### `.mcp.json` (repo root)

```json
{
  "mcpServers": {
    "transferhub-db": {
      "command": "node",
      "args": ["tools/db-mcp-server/dist/index.js"]
    }
  }
}
```

Claude Code picks this up automatically for any session opened on this repo.

---

## 13. PowerShell DB Script Runner (GUI)

**Location:** `tools/db-script-runner/` · **Entry point:** `Run.bat` (double-click)

- Windows Forms GUI — pick a `.env`-style connection file, pick a folder of `.sql` scripts
- Lists scripts naturally sorted with Applied/Not Applied/Changed/Failed status
- "Run Selected" executes in filename order via `sqlcmd.exe` (falls back to `Invoke-Sqlcmd`)
- Tracks history in `dbo.__ScriptRunnerHistory` (shared with MCP server — see §12)
- Supports Windows/trusted auth and SQL auth; Azure SQL encrypted connections
- Deliberately generic — can be copied into any SQL-Server-based project

---

## 14. AI Integration (Planned)

Three capabilities scoped and sequenced, **none built yet**:

| # | Capability | Approach | Status |
|---|---|---|---|
| 1 | **Background agent** | `@nestjs/schedule` cron inside the API process; calls `AiService.matchCourse` automatically on newly-queued evaluations | Not started |
| 2 | **Chat agent** | New NestJS module; Claude tool-use loop; `POST /agent/chat`; React chat widget | Not started |
| 3 | **Workflow builder** | Azure Logic Apps (Consumption tier); HTTP connector calls existing API endpoints | Not started |

**When building #1/#2:** the matcher's prompt should pull in `CourseTopics` (title, description, reference links via migration 009) for both the BU course and the external course being compared — not just course title/description. This is expected to produce much more precise equivalency matches.

**AI SDK:** `@anthropic-ai/sdk` directly (not Azure AI Foundry). Same Anthropic API key as current `AiService`.

---

## 15. Deployment

### Azure (target)

| Resource | Config |
|---|---|
| Azure SQL Database | `TransferHubDB` on `codecrafterstransferhub.database.windows.net` — already provisioned |
| App Service | Linux, Node 20, paid tier (NOT Free/F1 — sleeps on idle, breaks cron) |
| Deploy workflow | `.github/workflows/main_codecrafters.yml` (Azure App Service deploy, already committed) |

### Open decisions (pending)

- Azure DevOps vs. GitHub + Azure Pipelines/GitHub Actions for CI/CD
- App Service tier/SKU (B1/S1/etc.)
- Single Web App (UI+API, same-origin, `@nestjs/serve-static`) vs. two Web Apps under one Plan (simpler, independent deploys, needs `CORS_ORIGIN`)

### Applying migrations to live Azure DB

This session's sandbox **cannot reach** `codecrafterstransferhub.database.windows.net:1433` (firewall). To apply migrations:

1. From your own machine (Azure SQL firewall already allows your IP), run `tools/db-script-runner/Run.bat`, OR
2. Use `tools/db-mcp-server/` pointed at `src/api/.env` (which has the real credentials)
3. Order: run all 12 migrations → run all 8 seeds → run `npm run seed:users` from `src/api`

---

## 16. Environment Variables Reference

### `src/api/.env` (gitignored — real secrets for local dev)

```
NODE_ENV=development
DB_SERVER=codecrafterstransferhub.database.windows.net
DB_PORT=1433
DB_NAME=TransferHubDB
DB_TRUSTED_CONNECTION=false
DB_ENCRYPT=true
DB_DRIVER=tedious
DB_USER=<sql_admin_login>
DB_PASSWORD=<sql_admin_password>
JWT_SECRET=<64-char hex>
JWT_ACCESS_EXPIRES=15m
JWT_REFRESH_EXPIRES=7d
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-opus-4-5
PORT=3001
CORS_ORIGIN=http://localhost:5173
MAX_LOGIN_ATTEMPTS=5
LOCK_DURATION_MINUTES=15
RESEND_API_KEY=
```

### `src/api/.env.test` (committed — no real secrets)

- `DB_SERVER=(localdb)\MSSQLLocalDB` — automated tests use LocalDB, never the live Azure DB
- `DB_NAME=TransferHubDB`
- `DB_DRIVER=msnodesqlv8` (LocalDB requires named-pipe driver)

### `src/api/.env.production` (committed — no real secrets)

- `DB_SERVER=codecrafterstransferhub.database.windows.net` (non-secret hostname)
- `DB_USER=REPLACE_WITH_SQL_ADMIN_LOGIN` / `DB_PASSWORD=REPLACE_WITH_SQL_ADMIN_PASSWORD`
- Real secrets injected via Azure Key Vault + Managed Identity at runtime

### Key driver note

| Connection target | `DB_DRIVER` | `DB_TRUSTED_CONNECTION` | `DB_ENCRYPT` |
|---|---|---|---|
| LocalDB `(localdb)\...` | `msnodesqlv8` | `true` | `false` |
| Azure SQL / any TCP SQL Server | `tedious` | `false` | `true` |

---

## 17. Demo Accounts

After `migrations → seeds → npm run seed:users` (from `src/api`):

| Role | Email | Password |
|---|---|---|
| Student | `student@test.edu` | `Student@123!` |
| Faculty | `faculty.cs@bu.edu` | `Faculty@123!` |
| Admin | `admin@bu.edu` | `Admin@123!` |
| Agency | `agency@partner.edu` | `Agency@123!` |
| Super Admin | `super_admin@bu.edu` | `SuperAdmin@123!` |

**Why `npm run seed:users` is required:** `003_demo_users.sql` inserts placeholder (non-functional) `PasswordHash` values — T-SQL cannot compute argon2id hashes. `npm run seed:users` reads each demo email, hashes the real password with `argon2.hash(..., argon2id)`, and `UPDATE`s `Users.PasswordHash` in place. Without this step the demo accounts exist in the DB but every login attempt fails.

---

## Scope Visibility Notes

- Students (and any user) can be scoped to an individual Institution **or** to an entire University independently — two separate layers (`UserScopeUniversities` + `UserScopeAcademicUnits`)
- No scope rows for a user = unrestricted access (same convention throughout)
- BU courses are now scoped exactly like external courses (reversed the earlier "BU is special" decision; heads toward multi-tenant SaaS direction)
- Scope editor in User Management uses `UniversityInstitutionTree.tsx` — Universities as top-level rows, Institutions nested underneath, each independently checkable

---

## Email (Resend)

`src/api/src/common/email.service.ts` wraps the `resend` npm package.

- Configure via `RESEND_API_KEY` in `src/api/.env`; optionally `RESEND_FROM_EMAIL`
- If `RESEND_API_KEY` is unset: logs a warning, no-ops (local dev without key keeps working)
- Failures are always non-fatal — email errors never fail user creation or registration

---

## Mobile / Responsive

First responsive pass completed across all pages:

- **App shell:** sidebar `hidden md:flex`; mobile slide-over drawer + hamburger + top bar
- **Entity table pages** (Universities, Institutions, Programs, Agencies, Users, Courses, Transcripts, Audit Log, Pages, Forms, Form Submissions): `w-[95%] mx-auto` — use nearly full viewport width
- **Other pages:** kept `max-w-*` caps (dashboards, editors, login/register)
- **Header rows:** `flex-wrap gap-3` so action buttons wrap on small screens
- **Grids:** all `grid-cols-2`/`grid-cols-3` became `grid-cols-1 sm:grid-cols-N`
- `DataTable` already had `overflow-x-auto` — no structural change needed

---

*End of implementation reference. Update this file whenever a new migration, module, page, or tool is added.*
