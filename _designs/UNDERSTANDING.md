# Understanding Document — Smarter Transfer Credit Evaluation

> **Hackathon:** FDE AI Hackathon 5.0 · **Problem 1** · Transfer credit evaluation
> **Sponsor:** Pavan Vangara (submitted as "Smarter Transfer Credit Evaluation" — EdTech · Student Experience · Process Automation)
> **Client context:** Boston University (BU) — Credit Evaluation Department and academic departments
> **Status:** Draft v0.1 · 2026-10-22 · built only from the files in [`requirements/`](requirements/)

This is the single-page summary of what we understand. Each topic is expanded in its own file under [`understanding/`](understanding/).

| # | Document | What it covers |
|---|----------|----------------|
| 01 | [Problem statement](understanding/01_problem_statement.md) | The sponsor's problem, broken down to its core |
| 02 | [Current process (as-is)](understanding/02_current_process.md) | Step-by-step workflow, decision paths, where it breaks |
| 03 | [Business rules](understanding/03_business_rules.md) | Every rule in the sources, written to be testable |
| 04 | [Data inventory](understanding/04_data_inventory.md) | What data we were given, its quality, and the gaps |
| 05 | [Personas & pain points](understanding/05_personas_and_pain_points.md) | Who uses / is affected by the process |
| 06 | [Assumptions & open questions](understanding/06_assumptions_and_questions.md) | What we assume, how to test it, questions for the sponsor |
| 07 | [Solution concept](understanding/07_solution_concept.md) | Measurable outcome, proposed to-be process, MVP scope |
| 08 | [Synthetic data plan](understanding/08_synthetic_data_plan.md) | What we must generate and how |
| 09 | [Demo scenario](understanding/09_demo_scenario.md) | The six-course walkthrough the brief asks for |
| 10 | [Glossary](understanding/10_glossary.md) | Terms used across the documents |

---

## 1. The problem in one paragraph

BU takes in **800+ transfer students a year**. Every course on every transcript must be matched to BU, reviewed and posted. Courses already in BU's **equivalency database** are applied directly; anything else is marked **"maybe"**, the student must find and send a **syllabus**, and a **department evaluator** compares it by hand against BU course descriptions, learning outcomes and credit hours. Until a course is decided it shows as **0 units** in MyBU Student, so the student cannot see how much of their degree is secure, and all credit must be settled **within one year** of starting. The work is careful, but it is slow, opaque to students, and repetitive for evaluators.

## 2. The core of the problem

1. **The "maybe" path is the bottleneck.** Known equivalencies are a lookup; unknown courses become a manual, one-by-one syllabus comparison that is done again for each new student even when the same course was reviewed before.
2. **Status is binary and late.** "0 units" means both "not looked at yet" and "under review". The student has no signal of the likely outcome or of what is blocking it.
3. **Evidence collection falls on the student.** The student has to chase syllabi, often for old courses, without knowing which ones actually matter.
4. **Knowledge is not reused well.** Past decisions sit in a database keyed by exact course; near-matches (same course renumbered, same content at a sister school) are not surfaced to the evaluator.

## 3. Hard constraint

**Academic departments make the final decision.** Any tool may recommend, rank, pre-fill and explain — it must never post credit on its own for a course that needs department review.

## 4. What we were given (summary)

| File | Contents | Usefulness |
|---|---|---|
| `Boston University.docx` | Problem brief, workflow, rules, numbers, demo scenario, data promise | Primary source of requirements |
| `BU_Transfer_Program_Course_Match.xlsx` | 5 programs; 41 BU, 38 Northeastern, 38 NYU courses; a 41-row BU↔peer match table; summary; a lookup sheet | Seed catalog + "past decisions" proxy |
| `Hackathon Discovery Log.xlsx` | Question log template for sponsor Q&A | Process tool — our questions go here |

**Gaps:** no transcripts, no syllabi, no course descriptions/learning outcomes, no real past decisions, no quarter-system or community-college school. The brief promised 150 BU courses / 200 peer courses / 100 past decisions / 3–4 transcripts; we have ~27%, ~38%, 0 and 0 respectively. These must be generated synthetically (see [08](understanding/08_synthetic_data_plan.md)).

## 5. Proposed direction (to validate)

An **evaluator co-pilot + student status tracker**:

- **Intake:** parse a transcript into course rows; normalise credits (quarter → semester) and grades (C-or-higher check).
- **Triage every course into a lane:** *Known equivalency* (auto-apply as today) · *Likely match* (AI-ranked BU candidates with evidence) · *Needs syllabus* · *Not transferable / BU-only*.
- **Evaluator workbench:** side-by-side comparison of the external course and the top BU candidates, with highlighted overlaps in outcomes/topics, credit math and rule flags; evaluator chooses *BU equivalent / elective / no credit*; decision is saved back to the equivalency database for reuse.
- **Student view:** per-course status with a *provisional* range ("likely 3–4 BU credits, pending CS department"), what is needed from them, and a degree-progress view of what is already secure.

**One measurable outcome (proposed):** reduce the evaluator's handling time for a "maybe" course, demonstrated in the hackathon as **top-3 recommendation hit rate against held-out past decisions** plus the share of transcript courses that receive a provisional status at intake. See [07](understanding/07_solution_concept.md).

## 6. Biggest unknowns

- How decisions are actually recorded today and whether the equivalency database can be extracted (format, size, keys).
- Evaluator time per syllabus and current end-to-end turnaround — no baseline numbers were given.
- Whether showing students a *provisional* outcome is acceptable to BU (expectation-setting / appeals risk).
- Exact rounding rule for quarter conversion (brief says 4 → 2.66, implying truncation, not 2.67).
- Whether "Must be taken at BU" courses can still earn elective credit.

Full list with owners and test approaches: [06](understanding/06_assumptions_and_questions.md).
