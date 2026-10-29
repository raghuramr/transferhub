# Requirements Traceability — Asked vs. Built

> **Team:** Clopay CodeCrafters · **Hackathon 5.0, Problem 1** · Updated 2026-10-29
>
> Every request made during the build (the brief, plus every enhancement asked for in working sessions) is mapped here to what was built and where it lives.
> Brief-level rules are checked in more detail in [`GAP_ANALYSIS.md`](GAP_ANALYSIS.md). Problem, users and scope are in [`DISCOVERY.md`](DISCOVERY.md).

**Legend:** ✅ built · 🟡 partial · ⏸ waiting on something outside the code (key, data, decision)

> **Verification note.** "Built" means the code exists, type-checks and, where scripts exist, passes its unit/script tests. The build sandbox could not reach Azure SQL, so SQL marked *untested* in `CLAUDE.md` was first exercised by the team on the live database. Live AI runs on Azure OpenAI (Azure AI Foundry); Anthropic is also configured; the built-in rules engine is the fallback.

---

## 1. The brief (Boston University)

| # | Asked | Status | Where |
|---|---|---|---|
| 1 | Faster for evaluators | ✅ | Triage lanes `sp_TriageCourse`; matcher shortlist + cache; bulk approve; auto-approve stages — `src/api/src/requests/`, `src/api/src/ai/` |
| 2 | Transparent for students | ✅ | Live tracker, per-course lane, notes, degree progress — `pages/student/TranscriptStatus.tsx`, `components/workflow/ProgressTracker.tsx` |
| 3 | Less stressful | ✅ | Syllabus only asked for courses under review; preview before admission; nudges |
| 4 | Department decides (GOV-01) | ✅ | Approval stages; AI never rejects; rules confidence capped at 0.7 |
| 5 | Six-course demo, upload → posting | ✅ | Seed 015 (Maya), Demo scenario page `/superadmin/settings/demo-scenario`, `docs/DEMO_SCRIPT.md` |
| 6 | Measurable outcome | ✅ | Backtest `GET /ai-controls/backtest`: 63 decisions, top-1 88.9%, top-3 96.8% (rules engine) |
| 7 | Side-by-side comparison, credit math | ✅ | `GET /comparison/evaluation/:id`, `CourseComparison.tsx` |
| 8 | Learning loop | ✅ | `sp_RecordDecision` writes `Equivalencies`; `AiMatchCache`; learned-skills suggestions |
| 9 | BU policy rules (caps, grades, age, Hub, international) | ✅ | `src/api/src/policy/` (TransferPolicyService, programme rules, exam rules, credit deadline) |

## 2. Master data

| Asked | Status | Where |
|---|---|---|
| Universities, Institutions (schools), Agencies CRUD | ✅ | `UniversitiesManagement.tsx`, `InstitutionsManagement.tsx`, `AgenciesManagement.tsx` |
| Programs page and CRUD | ✅ | `ProgramsManagement.tsx`, `/courses/programs*` |
| University ↔ Program ↔ Course ↔ Topic many-to-many; edit each from the other's screen | ✅ | `components/programs/ProgramEditor.tsx` (shared editor), migration 011 |
| Courses can be found and attached while creating a program; create a course inline | ✅ | Picker lists every university's catalogue; "Create a new course here" |
| Course topics with reference links; per-university topic on/off | ✅ | `CourseTopicsEditor.tsx`, `UniversityTopicStatus` |
| Activate / deactivate everywhere; permanent delete for super admin with impact preview | ✅ | `src/api/src/purge/`, `PermanentDeleteDialog.tsx` |
| Logos and banners for universities and agencies; header branding per user | ✅ | `ImageSourceField.tsx`, `UniversityHeader.tsx`, migration 030 |
| Equivalencies with effective dates | ✅ | `EquivalenciesManagement.tsx`, migration 017 |

## 3. Students

| Asked | Status | Where |
|---|---|---|
| Public self-registration | ✅ | `/register` (6 steps) + Custom Form steps (`student-registration` form) |
| Registration aligned with BU policy (applicant type, school, education history, exams, language) | ✅ | Migration 015, `AuthService.saveApplication` |
| Smart Upload: read transcripts, IDs, English tests, syllabi; fill the profile; flag university mismatch | ✅ | `src/api/src/documents/`, `SmartUpload.tsx`; camera capture + scan view |
| Submit transcript with target university and program; reuse courses read from documents | ✅ | `UploadTranscript.tsx`, migration 033 |
| Live status, notes beside each step, From → To credits, top-3 suggestions | ✅ | `TranscriptStatus.tsx`, SSE `/events/stream` |
| Explore and compare up to 3 universities, then apply | ✅ | `Explore.tsx`, `/student/compare`, `/student/apply` |
| Degree progress (secure / likely / pending / not counted) | ✅ | `/progress/me`, `DegreeProgressCard` |
| Change target, edit pending courses, cancel a request, appeal a decision | ✅ | `/account/target`, `PATCH /transcripts/courses/:id`, migration 031, `/appeals` |
| Intake by claim link (ID/passport + email), QR code, agency bulk | ✅ | `src/api/src/intake/`, `/intake`, `/admin/intake` |
| Profile photo, email change with verification | ✅ | `src/api/src/account/` |

## 4. Staff, workflow and evaluation

| Asked | Status | Where |
|---|---|---|
| Configurable workflow per university (stages, approvers, SLAs, bypass, auto-approve) | ✅ | `WorkflowDesigner.tsx`, `workflow-engine.service.ts` |
| Approver groups per university, cloned with a university workflow | ✅ | Workflows → Approver groups |
| Approval queue, bulk approve, accept AI suggestions ≥ X% | ✅ | `/requests`, `RequestReview.tsx` |
| Faculty sees full course details at every stage | ✅ | Brief returned for every visible stage |
| Admin and faculty scoped to their universities (incoming / outgoing, read-only outgoing) | ✅ | `policy/scope.service.ts` |
| Super admins invisible to admins | ✅ | Users, approver groups |
| University-to-university exchange (document requests, reminders) | ✅ | `src/api/src/transfers/`, `docs/TRANSFER_EXCHANGE.md` |
| Programme rules, exam-credit rules, transfer rules per university | ✅ | Workflows tabs; migrations 027, 028 |
| One external course → several BU courses | 🟡 | API + automatic application built; no faculty multi-pick screen yet |

## 5. AI

| Asked | Status | Where |
|---|---|---|
| AI course matching with cost controls | ✅ | `ai.service.ts`; running on Azure OpenAI (Azure AI Foundry) |
| Works with no key (rules fallback) | ✅ | `ai/rules-matcher.ts`, `documents/rules-document-reader.ts` |
| Providers configurable when required: Azure OpenAI / Azure AI Foundry (in use), Anthropic (configured), custom OpenAI-compatible, Azure Document Intelligence | ✅ | AI Controls → Providers |
| Editable agent playbook (skills), learned skills from faculty decisions | ✅ | AI Controls → Playbook / Learning |
| Benchmark engines on real students (dry run) | ✅ | AI Controls → Benchmark |
| Equivalency network (anonymised cross-university history, optional boost) | ✅ | `src/api/src/network/` |
| AI usage, tokens saved, efficiency KPIs; correct BIGINT sums | ✅ | AI Controls → Usage |
| **$ spent per request** in AI Controls | ✅ | "$ Spent by request" tab: total, matching / documents / briefs split |
| **AI stats on the Super Admin dashboard, separate from regular stats** | ✅ | Dashboard "AI agents" section (`DashboardService.aiSection`) |

## 6. Platform, security, administration

| Asked | Status | Where |
|---|---|---|
| Roles & permissions matrix, live enforcement | ✅ | `src/api/src/permissions/`, `@Permission()` |
| Custom roles built on a base role | ✅ | Migration 032, `RolesManager` |
| Partner API keys, partner portal, review queue with per-row reports | ✅ | `src/api/src/import/`, `/partner`, `docs/PARTNER_API.md` |
| Branded, editable email templates + custom templates | ✅ | `email-templates.ts`, System Settings → Email |
| Azure Blob Storage, image compression | ✅ | `uploads/blob-storage.service.ts`, `common/image-compress.ts` |
| Demo login (one click per role, no password in the browser) | ✅ | System Settings → Demo login (turn off before real launch) |
| Demo documents generator, demo data sets, Postman collections | ✅ | `/superadmin/settings/demo-documents`, `docs/demo-data/` |
| Dashboards per role, analytics bento | ✅ | `components/dashboard/` |
| Mobile-ready, collapsible sidebar, PWA manifest | ✅ | `AppLayout.tsx` |
| Swagger | ✅ | `/api/docs` (`docs/SWAGGER.md`) |
| GitHub Actions → Azure App Service | ✅ | `.github/workflows/main_codecrafters.yml` |
| DB script runner (GUI) and DB MCP server | ✅ | `tools/db-script-runner/`, `tools/db-mcp-server/` |
| Tests: unit scripts, HTTP smoke, SQL smoke, triage contract | ✅ | `docs/TESTING.md` |

## 7. Submission package (this request)

| # | Asked | Status | Where |
|---|---|---|---|
| 1 | Source code + README with setup and run steps | ✅ | [`../README.md`](../README.md) |
| 2 | Discovery doc (problem, users, requirements, scope) | ✅ | [`DISCOVERY.md`](DISCOVERY.md) |
| 3 | Agent instruction files for dev, DevOps and QA agents | ✅ | [`../.claude/agents/`](../.claude/agents/), [`../.github/agents/`](../.github/agents/), [`../.github/copilot-instructions.md`](../.github/copilot-instructions.md) |
| 4 | Demo video (SharePoint, linked in README) | ⏸ | Recorded by the team; link placeholder in README |
| 5 | PPT — full version and demo version | ✅ | [`deck/`](deck/) |
| 6 | Single-page project overview (team, repo, site, stack, roles) | ✅ | [`ClopayCodeCrafters.html`](ClopayCodeCrafters.html) |

## 8. Open items

- Score the live AI providers (Azure OpenAI, Anthropic) with the same backtest/benchmark and publish the numbers; then try an auto-approve stage.
- CI permission to write Azure SQL firewall rules (migrations are applied by hand until then).
- BU answers: 5-credit lab rule, exam thresholds, baseline turnaround numbers.
- Turn demo login off before a real launch.
