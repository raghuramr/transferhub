# Discovery — TransferHub (Smarter Transfer Credit Evaluation)

> **Team:** Clopay CodeCrafters · **Event:** Evoke FDE AI Hackathon 5.0 · **Problem 1:** Smarter Transfer Credit Evaluation (Boston University)
> **Repo:** <https://github.com/Evoke-Hackathon-2026/Clopay-CodeCrafters> · **Live site:** <https://transferhub.wcubeprojects.in/>
> **Status:** Final for submission · 2026-10-29

This document covers the problem, the users, the requirements and the scope. Detailed working notes behind it are in [`UNDERSTANDING.md`](UNDERSTANDING.md) and [`understanding/01–13`](understanding/). What was built against each requirement is in [`REQUIREMENTS_TRACEABILITY.md`](REQUIREMENTS_TRACEABILITY.md) and [`GAP_ANALYSIS.md`](GAP_ANALYSIS.md).

---

## 1. The problem

Boston University takes in **800+ transfer students a year**. Every course on every transcript has to be matched to a BU course, reviewed and posted.

- Courses that are already in BU's **equivalency database** are applied directly.
- Every other course is a **"maybe"**. The student has to find and send a **syllabus**, and a **department evaluator** compares it by hand against BU course descriptions, learning outcomes and credit hours.
- Until a course is decided it shows as **0 units**. The student cannot see how much of their degree is secure.
- All credit has to be settled **within one year** of starting at BU.

The process is careful, but it is **slow for evaluators**, **opaque for students**, and **repetitive**: the same external course is compared again for every new student.

### Root causes

| # | Cause | Effect |
|---|---|---|
| 1 | The "maybe" path is manual, one course at a time | Evaluator time goes into lookups and side-by-side reading |
| 2 | Status is binary and arrives late ("0 units") | Students cannot plan registration or graduation |
| 3 | Gathering evidence falls on the student | Old syllabi are chased even when they would not change the outcome |
| 4 | Past decisions are keyed by exact course only | Near matches (renumbered course, sister school) are not reused |

### Hard constraint

**Academic departments make the final decision.** The system may rank, pre-fill, explain and route. It never posts credit for a course that needs department review unless a department has explicitly enabled auto-approval for that stage, and it never rejects on its own.

---

## 2. Users

| Persona | Role in the app | Needs | Main pains today |
|---|---|---|---|
| **Maya**, transfer student | `student` | Know which credits are secure, what to do, and by when | 0 units with no explanation; chasing old syllabi; late view of degree progress |
| **Dan**, Credit Evaluation staff | `admin` | Clean queue, fast lookups, little chasing | Manual equivalency lookups; tracking outstanding syllabi and the one-year deadline |
| **Dr. Lee**, department evaluator | `faculty` | All evidence in one place, consistency with past decisions | Reading syllabi one by one; cannot see what colleagues decided |
| **Partner agency / college** | `agency` (and the partner API) | Submit students and catalogue data in bulk, see outcomes | Email and spreadsheets; no status feedback |
| **Platform owner** | `super_admin` | Configure universities, workflows, AI, roles; see cost and throughput | No visibility of backlog, turnaround or AI spend |

Secondary stakeholders: academic advisors (plan around secured credits), financial aid (credit totals), and BU leadership (backlog and turnaround).

---

## 3. Requirements

IDs follow [`understanding/03_business_rules.md`](understanding/03_business_rules.md) and [`12_bu_transfer_policy_reference.md`](understanding/12_bu_transfer_policy_reference.md).

### 3.1 From the brief

| ID | Requirement |
|---|---|
| B-1 | Faster for evaluators |
| B-2 | More transparent for students |
| B-3 | Less stressful for students |
| B-4 | Department keeps the final decision (GOV-01) |
| B-5 | Demo: a six-course transcript (3 known equivalents, 2 "maybe", 1 quarter-system) from upload to posting |
| B-6 | A measurable outcome |
| B-7 | Evaluator side-by-side comparison with credit math |
| B-8 | Decisions are reused for the next student (learning loop) |

### 3.2 Business rules

| Area | Rules |
|---|---|
| Outcomes | OUT-01..06: BU equivalent, elective, no credit, BU-only; one external course to several BU courses |
| Credits | CR-01/02: quarter credits × 2/3, truncated; CR-04: 5-credit lab courses (open question to BU) |
| Grades | GR-01: C or higher; GR-02: external grades not in GPA; P/F and S/U go to review |
| Caps and eligibility | GR-04: external-credit cap including AP/IB/A-level (68 for transfers, 60 for first-year/dual enrollment, 68 for current students; per university); GR-05: course age, accreditation, no internships/research/military/life experience |
| Programme | PRG-01: the Hub is never satisfied by transfer; PRG-02: all credit within one year; PRG-03: "must be taken at BU"; PRG-04..08: programme caps and substitutions |
| International | Coursework outside the US goes to International Admissions |

### 3.3 Non-functional

- Role-based access with a permissions matrix that an administrator can change without a deploy.
- University-level visibility scoping for staff.
- Works without an AI key: a zero-token rules fallback for every AI step.
- AI cost controls: budgets, caching, a cheap model with escalation, and a usage log.
- Mobile-ready UI; documents stored privately in Azure Blob Storage.
- Deployable to Azure from GitHub Actions; database changes as idempotent, numbered SQL scripts.

---

## 4. Scope

### In scope (built)

- **Student journey:** self-registration (6 steps plus a configurable form), Smart Upload (document reading), transcript submission with target university and program, a live status tracker, degree progress, Explore and compare universities, appeals, and cancellation.
- **Evaluation:** triage lanes (`sp_TriageCourse`), the policy engine, programme rules, exam-credit rules, AI or rules course matching with top-3 candidates, side-by-side comparison, decisions saved back as equivalencies with effective dates.
- **Workflow:** a per-university workflow designer with stages, approver groups, SLAs, auto-approve, bypass, notes, reminders and insights.
- **Data:** Universities → Programs → Courses → Topics (shared across universities), equivalencies, a partner API and portal, student intake by claim link, and demo data sets.
- **Platform:** a roles and permissions matrix with custom roles, AI Controls (providers, settings, playbook skills, usage and spend, benchmark, learning), dashboards per role, branded emails, and Swagger.

### Out of scope

- Integration with real student information systems (MyBU / SIS). A connector seam (`SourceConnector`) exists for it.
- OCR of scanned images without Azure Document Intelligence.
- Live verification of the Anthropic and Azure OpenAI paths: no key was provided during the hackathon. The rules fallback ran every AI step instead.

### Measurable outcome

**Top-3 hit rate** of the matcher on held-out past decisions (backtest in AI Controls → Usage). Result with the built-in rules engine: **63 past decisions, top-1 88.9%, top-3 96.8%**. The AI matcher plugs into the same harness.

---

## 5. Assumptions and open questions

The open questions for BU are tracked in [`../docs/BU_OPEN_QUESTIONS.md`](../docs/BU_OPEN_QUESTIONS.md) and the organisers' Discovery Log. The main ones:

- The 5-credit lab rule (CR-04).
- Exam-credit thresholds: AP ≥ 3, IB HL ≥ 5, CLEP ≥ 50 are defaults pending confirmation.
- Baseline turnaround numbers. None were supplied, so no before/after timing is claimed.
