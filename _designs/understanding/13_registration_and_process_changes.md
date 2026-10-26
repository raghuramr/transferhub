# 13 · Aligning Registration & Submission with BU Policy (gap analysis + change plan)

[← Back to Understanding](../UNDERSTANDING.md) · Facts: [12 · BU Transfer Policy Reference](12_bu_transfer_policy_reference.md)

Compares what TransferHub captures and enforces today with BU's published rules, and lists the
changes to make. **Status: Phases 1–4 built (2026-10-26); Phase 5 not built.** IDs (`BU-…`) refer to doc 12.

---

## 1. Gaps found

### A. Rules the system gets wrong today
| # | Today | BU rule | Impact |
|---|---|---|---|
| A1 | `sp_TriageCourse` treats grade **`P` (Pass) as eligible**. | P/F and S/U are **not normally transferable**; exceptions are Spring 2020 and home-institution-mandated P/F (BU-EL-04). | Pass grades get auto-applied when they should go to review. |
| A2 | No **68-credit cap** (60 / 80 variants). Credits keep accumulating. | Max 68 external credits for transfers, 60 first-year, 80 MET; AP/IB/A-level count against the same cap (BU-CR-03/04/05). | Students can be shown more credit than BU will ever post. |
| A3 | No **5-year age check**; course term/year is optional free text. | Work older than 5 years needs extra review (BU-EL-05). | Old courses are auto-applied. |
| A4 | No **accreditation** check on the sending institution. | Only regionally accredited institutions (BU-EL-02). | Credit from unaccredited schools enters the auto-apply lane. |
| A5 | `trimester` accepted on submission but has **no conversion rule**. | Only semester (1:1) and quarter (×2/3) are defined (BU-CR-06). | Trimester credits are passed through 1:1 without review. |
| A6 | Nothing excludes **internships, research, military or life experience**. | No credit for those (BU-EL-06). | Can be submitted and evaluated as normal courses. |
| A7 | Evaluation outcomes don't mention **Hub**; an "equivalent" decision looks like it satisfies everything. | Transfer courses **never satisfy Hub**, even with a BU equivalent; transfers owe **10 Hub requirements** (BU-HUB-01/02). | Misleading student summary. |

### B. Data the registration form doesn't capture (but BU's process needs)
| # | Field / document | Why (doc 12) |
|---|---|---|
| B1 | **Intended BU school/college** (required, no "undeclared") | BU-AD-02 |
| B2 | **Entry term** (Fall / Spring + year) | BU-AD-10 — deadlines and which cap applies |
| B3 | **Applicant type**: transfer applicant / admitted transfer / current BU student taking external courses / dual-enrollment (high school) | Drives pre-admission vs post-admission evaluation (BU-EV-01/08), cap (BU-CR-04), dual-enrollment rules (BU-EL-09) |
| B4 | **BUID** (U + 8 digits), optional until admitted | Appeal form, registrar matching |
| B5 | **Every institution attended** (not just one prior institution): name, dates, credits earned, enrolled full-time?, accredited? | BU-AD-03, BU-AD-09, BU-EL-02 |
| B6 | **Credits completed** (degree-seeking, full-time) | BU-AD-09 (12+ guidance) |
| B7 | **Native English speaker?** → if no: test type (TOEFL iBT / IELTS / Duolingo) + score | BU-AD-08 |
| B8 | **Coursework completed outside the US?** → route to International Admissions, not the domestic flow | BU-AD-11 |
| B9 | **High-school graduation** (year + proof uploaded) | BU-AD-03 |
| B10 | **AP / IB / A-level exams** (counts toward the 68 cap) | BU-CR-05 |

### C. Submission (transcript) process gaps
| # | Gap | BU source |
|---|---|---|
| C1 | Per course we don't capture **term + year**, **delivery mode** (in-person / online), **grading basis** (graded / P-F / S-U), **course type** (lecture / lab / internship / research). | BU-EL-04/05/06/10 |
| C2 | Syllabus is requested for every unmatched course, but BU only needs it for **"maybe" / not-listed** courses, not "match". Our lanes already say this — the **document checklist should require syllabi only for `needs_syllabus` / `likely` courses**. | BU-EV-04 |
| C3 | Required documents don't include the **Transfer College Report** (per institution), **final official transcript** (per institution), **HS transcript/proof of graduation**, **English test report**, **dual-enrollment form**. | BU-AD-03/08, BU-EL-09 |
| C4 | No **"preview only — not a guarantee"** state before admission. BU never evaluates before admission. | BU-EV-01/03 |
| C5 | No **appeal** path after a decision. | Appeal form (doc 12 §6) |
| C6 | No **pre-approval** flow for current BU students taking a course elsewhere (must be approved before enrolling). | BU-EV-08 |
| C7 | Equivalencies have **no effective dates** (TES rows do). | doc 12 §7 |

---

## 2. Proposed changes

### Phase 1 — Correct the rules (small, high value)
1. **Grades:** P / S / CR → `needs review` (not eligible by default) with a "home institution required P/F" or "Spring 2020" exception checkbox the reviewer can tick. C- stays not eligible.
2. **Credit cap:** per-student running total of applied external credits (transfer + AP/IB/A-level). Cap by applicant type: 68 transfer / 60 first-year / 80 MET (configurable per university on the workflow). Courses beyond the cap are flagged "over the external-credit cap" in the brief and student summary.
3. **Age:** require term + year per course; anything older than 5 years → `needs review` with flag "older than 5 years".
4. **Accreditation:** add `Institutions.Accreditor` (regional accreditor name or `none/unknown`); unaccredited or unknown → `needs review`.
5. **Trimester:** treat as review (no automatic conversion) until BU confirms a ratio.
6. **Non-course experience:** course type `internship | research | military | life_experience` → `not eligible` automatically.
7. **Hub:** student summary and reviewer brief always state "Transfer courses don't count toward the BU Hub — 10 Hub requirements remain (up to 1 via a cocurricular)."
8. Make the min-grade / cap / age thresholds **configurable per university** (closes the "rules not configurable" note in CLAUDE.md).

### Phase 2 — Registration form
Restructure `/register` into steps:
1. **Account** (as today).
2. **About your application** — applicant type (B3), intended BU school/college (required, B1), intended program, entry term (B2), BUID (optional, B4).
3. **Contact & location** (as today).
4. **Education history** — repeatable list of institutions (B5: name, city/state/country, from–to, credits earned, full-time?), high school + graduation year (B9), AP/IB/A-level exams (B10).
5. **Language** — native English? test + score (B7).
6. **International check** — "Did you complete coursework outside the US?" → if yes, show the International Admissions contact and stop the domestic credit-evaluation flow for that coursework (B8).
7. **Review & submit**, with a clear notice: *"Credit shown before admission is a preview based on BU's equivalency database, not a guarantee."* (BU-EV-03).

### Phase 3 — Submission & documents
- Per-course fields: term, year, grading basis, delivery mode, course type (C1).
- Document checklist per workflow (already configurable) gains: **Transfer College Report** and **Final official transcript** (one per institution), **HS transcript / proof of graduation**, **English test report**, **Dual-enrollment form**, and **Syllabus required only for review-lane courses** (C2, C3).
- Request **status label** "Preview (not admitted)" vs "Official evaluation" (C4) — preview requests skip department approval stages; they convert to official on admission.

### Phase 4 — Appeals & pre-approval
- **Appeal a decision** (per course, from the student's request page) mirroring the BU form: proposed BU equivalent, mandatory reason, syllabus upload → creates a `appeal` stage routed to the owning department → outcome: equivalent / elective / no credit / denied-with-reason, "satisfies requirement", department comments, signature (name + date). Blocks appeals for non-US pre-matriculation work (route to International Admissions).
- **Pre-approval** for current BU students (applicant type "current BU student"): same flow but before enrolment, outcome stored as a pre-approved equivalency with an expiry.

### Phase 5 — Equivalency data
- `Equivalencies.EffectiveFrom / EffectiveTo` (+ notes) to mirror TES rows; triage only applies equivalencies effective for the course's term.
- Partner/TES import columns for those dates.

---

## 3. Decisions (confirmed by the user)
1. **Applicant types:** all four — transfer applicant, admitted transfer, current BU student (pre-approval), dual enrollment.
2. **Pre-admission:** *preview, then official.* A not-yet-admitted student's request runs the rules and existing equivalencies only (no stages); an admin's "Mark admitted" turns every preview into an official evaluation and starts the workflow.
3. **Caps:** configurable per university (Workflows → Transfer rules); defaults 68 transfer / 60 first-year & dual enrollment / 68 current student.
4. **Scope:** Phases 1–4 built now; Phase 5 (equivalency effective dates) later.
5. **International coursework:** captured and flagged "handled by International Admissions (intadvis@bu.edu)", kept out of evaluation and AI matching, and not appealable here.

## 4. Where it lives in the code
- Schema: `database/migrations/015_bu_policy_alignment.sql`, defaults `database/seed/010_bu_policy_defaults.sql`.
- Rules engine: `src/api/src/policy/transfer-policy.service.ts` (runs after `sp_TriageCourse`; only tightens lanes; writes `TranscriptCourses.PolicyFlags`).
- Preview/official/pre-approval: `TranscriptsService.submit` + `WorkflowEngineService.makeOfficial` / `finalize`.
- Conditional documents: `WorkflowEngineService.documentChecklist`.
- Registration: `pages/auth/RegisterPage.tsx` (6 steps) + `AuthService.saveApplication`.
- Appeals: `src/api/src/requests/appeals.*`, `pages/staff/AppealsQueue.tsx`, `components/policy/AppealModal.tsx`.
- Per-university rules UI: `components/policy/TransferRulesTab.tsx` (Workflows → Transfer rules).
