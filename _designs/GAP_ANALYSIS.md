# Gap Analysis — The Ask vs. What Was Built

> **Team:** Clopay Code Crafters · **Hackathon:** FDE AI Hackathon 5.0 · **Problem 1:** Smarter Transfer Credit Evaluation (Boston University)
> **Date:** 2026-10-27 · **Sources compared:** `requirements/Boston University.docx`, `UNDERSTANDING.md` + `understanding/01–13`, `IMPLEMENTATION.md`, `CLAUDE.md`, and the code on `main`.
> **Method:** every requirement/rule ID in the understanding docs was checked against the code, migrations and seeds. "Built" means the code exists and type-checks; **no SQL Server was available in the build sandbox, so SQL/stored-procedure behaviour and anything needing a live key is marked _unverified_.**

Legend: ✅ built · 🟡 partial · ❌ gap · ⭐ beyond the ask

---

## 1. The brief's own tests

| # | The ask (brief) | Status | Evidence |
|---|---|---|---|
| 1 | **Faster** for evaluators | ✅ | `sp_TriageCourse` lanes; lexical shortlist; cross-student match cache; auto-approve stage; bulk approve; decisions saved back as reusable equivalencies |
| 2 | **More transparent** for students | ✅ | Student request page: vertical timeline, per-course lane, notes, reminders ("nudge"); dashboards |
| 3 | **Less stressful** | ✅ | Syllabus requested only for review-lane courses; preview before admission; status per course instead of "0 units" |
| 4 | **Department makes the final decision** (GOV-01) | ✅ | Configurable approval stages; AI/rules never reject; rules confidence capped at 0.7; auto-approve is an opt-in per-stage setting that records the agent as the actor |
| 5 | Demo: six courses (3 equivalent, 2 maybe, 1 quarter) upload → posting | ✅ | Seed 015 (applied, counts verified) + a repeatable presenter page (reset Maya, second student for the learning loop) and docs/DEMO_SCRIPT.md |
| 6 | Measurable outcome (07): top-3 hit rate on held-out decisions | ✅ | `GET /ai-controls/backtest` + Matcher accuracy card (AI Controls, Usage tab). Number not yet run on live data; AI matcher plugs into the same harness |
| 7 | Student "provisional range" + degree-progress view (07/05) | ✅ | `GET /progress/me` + Degree progress card: secured / likely range / pending / not counted vs the cap, next step per course |
| 8 | Evaluator workbench: side-by-side comparison with highlighted overlap, credit math (07) | 🟡 | Request review shows brief, AI/rule candidates with rationale, credit conversion; **no side-by-side description/outcome diff with highlighting** |
| 9 | Learning loop: next student auto-applied (demo step 7) | ✅ | `sp_RecordDecision` writes an `Equivalencies` row (now with effective dates); `AiMatchCache` reuses AI results across students |

## 2. Business rules (doc 03 / 12)

| Rule | Status | Note |
|---|---|---|
| OUT-01/02/04/05 outcomes, existing-equivalency auto-apply, grade "T", 0-unit pending | ✅ | Equivalent / elective / no-credit / bu_only |
| OUT-06 one external course → several BU courses (e.g. NU CHEM 1161) | 🟡 | Up to 3 ranked candidates; a single decision maps one BU course. Splits/combines not modelled _(not verified end-to-end)_ |
| CR-01/02 quarter × 2/3, truncated (4 → 2.66) | ✅ | `FLOOR(x·2/3·100)/100` in `sp_TriageCourse` |
| CR-04 5-credit NU lab course | 🟡 | Credits stored as given; no explicit rule (BU never stated one — open question) |
| GR-01 C or higher; C- not eligible | ✅ | Plus policy engine: P/F & S/U → review (exceptions: Spring 2020, mandated P/F), per-university minimum |
| GR-02 external grades not in GPA | ✅ | Not computed |
| GR-04 68/60/80 external-credit cap incl. AP/IB/A-level | ✅ ⭐ | `TransferPolicyService`, per-university thresholds |
| GR-05 5-year age, accreditation, no internships/research/military/life experience | ✅ ⭐ | Flags stored per course and shown in brief + student view |
| GR-06 / PRG-01 Hub never satisfied by transfer | ✅ | Always stated in brief and student summary |
| **PRG-02 all credits within one year of starting** | ✅ | Credit-deadline tracker: per-university months, `past_deadline` review flag, progress/staff badges, 90/30/7-day and overdue reminders (migration 024; SQL unverified until applied) |
| PRG-03 "Must be taken at BU" (CS 320/332/350) | ✅ | `Equivalencies.Outcome = 'bu_only'` honoured by triage |
| **PRG-04/05/06/07/08** programme caps and substitutions (Econ ≤4 at 200+, Biology 5 BI at BU, MA 242 ↔ CS 132 …) | ❌ | Not encoded as rules; only the BU-only flag exists |
| International coursework → International Admissions | ✅ ⭐ | Flagged, excluded from evaluation and AI |

## 3. Data promised vs. seeded (doc 08)

| Dataset | Promised | Seeded | Status |
|---|---|---|---|
| BU courses | ~150 | BU + Northeastern + NYU + AI/ML catalogue (~170 course rows total) with ~220 topics | 🟡 (BU count below 150; descriptions are topic-based) |
| Peer courses | ~200 | ~76 workbook courses | 🟡 |
| Past decisions | ~100 | Workbook-derived equivalencies (~80) | 🟡 |
| Community-college + quarter-system catalogue | BSCC / PVTC | ~16 synthetic courses with topics (seed 015) | ✅ |
| Sample transcripts | 3–4 | 120 synthetic students + Maya's scripted six-course transcripts | 🟡 |
| Syllabi | 10–15 | None (upload + AI/rules reading built instead) | 🟡 |

## 4. Process research gaps (doc 11 / 13)

| Item | Status |
|---|---|
| Multi-stage approval chain, bypass, per-university workflow | ✅ ⭐ (Workflow Designer) |
| Internal vs student-visible notes, reminders, SLA escalation | ✅ ⭐ |
| AI cost controls, usage log, skill playbooks | ✅ ⭐ |
| Appeals (BU form), pre-approval, preview→official | ✅ ⭐ |
| Equivalency effective dates (Phase 5) | ✅ |
| Syllabus upload tied to a course | 🟡 — via Smart Upload / appeals; no per-course syllabus slot on the submit form |
| NACES credential evaluation / certified translation checklist items | ❌ |
| AP/IB score-threshold rule (AP ≥ 3 etc.) | ❌ (exams captured, thresholds not enforced) |

## 5. Quality & proof gaps

| Item | Status |
|---|---|
| Automated tests | ❌ none for the API (one script test for the rules document reader) |
| Live AI validation | ❌ no Anthropic key yet — AI paths unverified; **built-in rules fallback** keeps every AI step working without it |
| Baseline numbers (45/month, 18-day turnaround were only the template example) | ❌ none supplied by BU |
| Live DB migrations 018–021 | ⚠️ user applied via MCP; end-to-end smoke test still owed |

---

## 6. Beyond the ask — the "wow" list

Things nobody asked for that change the product from "evaluator tool" to "platform":

1. **AI that works without AI.** A zero-token rules engine reads documents and suggests courses when there is no key, budget or connectivity — a super-admin switch decides.
2. **Reads documents.** Students drop PDFs/photos; the system classifies transcripts, IDs, English tests and syllabi, extracts fields, and pre-fills the transcript form.
3. **Student intake 5 ways:** self-registration, emailed claim link (ID/passport + email), QR code, 30 mock registrar profiles, agency/partner bulk API — the account is created only after the student confirms.
4. **Policy engine** that mirrors BU's published rules (caps, P/F, age, accreditation, Hub) and shows flags to both student and reviewer.
5. **Configurable workflow engine** per university with SLAs, auto-approve, bypass, appeals, preview→official.
6. **Multi-university master data:** Universities → Programs → Courses → Topics (many-to-many, per-university topic switches).
7. **Roles & permissions matrix** enforced live on every mutation, plus admin visibility scoping (super-admins invisible to admins).
8. **Partner portal + public API** with hashed keys, Excel templates, review queue and emailed per-row reports.
9. **Token-frugal AI:** lexical shortlist, cross-student cache, cheap model with escalation, prompt caching, budgets, savings meter.
10. **Role dashboards** with animated analytics, mobile-ready UI, branded emails, Azure Blob storage, GitHub Actions → Azure deploy.

## 6b. Added since the first pass (2026-10-27)

- **University-to-university exchange:** both source and target universities see a transfer (incoming/outgoing counts), request documents from each other or the student, upload into the student's folder with party metadata, and send reminders. See `docs/TRANSFER_EXCHANGE.md`.
- Closed from the list below: items 1, 2, 3 (demo data, backtest, degree progress).

## 7. Recommended next actions (highest value for the panel first)

| # | Action | Closes | Effort |
|---|---|---|---|
| ~~1~~ | ~~Seed the Maya Rivera six-course demo transcript + BSCC/PVTC catalogue | Gap 5, data gaps | S |
| ~~2~~ | ~~Backtest endpoint/script: top-3 hit rate of rules matcher (and AI once keyed) against held-out equivalencies; show on AI Controls | Gap 6 — the brief's measurable outcome | M |
| ~~3~~ | ~~Student degree-progress card (secured / likely / at-risk credits, provisional range) | Gap 7 | M |
| 4 | Side-by-side course comparison with highlighted overlapping topics | Gap 8 | M |
| 5 | One-year deadline tracker per student with reminders | PRG-02 | S |
| 6 | Programme rules table (PRG-04/05/08) | PRG-04..08 | M |
| 7 | API smoke tests for triage/policy/workflow | Quality | M |
