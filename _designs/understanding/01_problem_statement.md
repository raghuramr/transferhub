# 01 · Problem Statement

[← Back to Understanding](../UNDERSTANDING.md)

## Sponsor's own words (from the brief)

| | |
|---|---|
| **Background** | Every year, hundreds of students transfer into universities and need their past coursework evaluated for credit. Boston University welcomes more than 800 transfer students annually, and each of their courses has to be matched, reviewed and posted to their academic record. |
| **Problem for students** | They often cannot tell what is happening while courses sit at zero units. Many have to chase down old syllabi, and they do not know how much of their degree progress is secure until late in the process. |
| **Problem for evaluators** | They review syllabi one by one, which means repeated manual comparison of course descriptions, learning outcomes and credit hours. |
| **Challenge** | Design and build a tool that makes transfer credit evaluation **faster, more transparent and less stressful**, while respecting the rule that **academic departments make the final decision**. |

> The brief reminds us to treat this as the sponsor's account, not verified fact.

## Where it sits

- **Business area:** BU Credit Evaluation Department + academic departments' evaluators.
- **Day-to-day users:** Credit Evaluation staff, department evaluators. Students see status in MyBU Student.
- **Also affected:** transfer students (800+/yr), academic advisors, financial aid team.

## Breaking it down

### Three goals, three different users

| Goal word | Who feels it | What "better" would mean |
|---|---|---|
| **Faster** | Evaluators, Credit Evaluation staff | Less time per "maybe" course; fewer repeat reviews of the same external course |
| **More transparent** | Students, advisors | Every course has a visible state, a likely outcome and a named next action |
| **Less stressful** | Students | Earlier knowledge of secured credit; only asked for syllabi that actually matter |

### Known (stated in sources)
- Volume: 800+ transfer students per year.
- Decision paths: existing equivalency → specific BU course; otherwise "maybe" → syllabus → department decides BU equivalent / elective / no credit.
- Pending credit = 0 units in MyBU Student; final result posted with grade "T".
- Rules: quarter → ×2/3; C-or-higher at many schools; no BU GPA effect; no Hub units; one-year deadline.
- Existing tools: Transferology (student preview), equivalency database.
- No AI-based matching exists today (to be confirmed with BU).

### Assumed (not stated — must be checked)
- The "maybe" path is where most elapsed time is spent (seems likely, not evidenced).
- The equivalency database is keyed on exact external course code + institution, so renumbered or near-identical courses miss.
- Evaluators re-review courses another evaluator has already decided for another student.
- Students are not told *which* syllabi are worth chasing (e.g., courses likely to be "no credit" anyway, or BU-only requirements).

### Why it keeps happening (root causes, hypothesised)
1. **Text comparison is manual.** Matching course descriptions/outcomes is a reading task that does not scale with volume.
2. **Decisions are not generalised.** A decision is stored for one external course rather than as reusable evidence.
3. **The status model is too coarse.** "0 units" hides progress and likely outcome.
4. **Evidence gathering starts late.** Syllabi are requested only after a course fails the lookup, after admission.

## Problem in one sentence

> *Transfer courses without an exact equivalency fall into a manual, opaque syllabus review that is slow for evaluators and stressful for students; we want to shorten and explain that path without taking the decision away from departments.*
