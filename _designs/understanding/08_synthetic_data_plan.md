# 08 · Synthetic Data Plan

[← Back to Understanding](../UNDERSTANDING.md)

Ground rule: **no real personal, student or customer data.** Everything below is generated and labelled `source: synthetic`.

## What to generate

| Dataset | Volume | Based on | Key fields | Notes |
|---|---|---|---|---|
| **Institutions** | 4–5 | — | id, name, calendar (semester/quarter), type | Add **"Bay State Community College (synthetic)"** – quarter system – plus NU, NYU, and one more semester-system school |
| **BU course descriptions** | 41 existing (+ up to ~110 to reach ~150) | BU Courses sheet | description, learning outcomes (4–6 bullets), level | If we narrow to CS, deepen CS + Maths electives instead of all programs |
| **Peer course descriptions** | 76 existing (+ community-college catalog ~50) | NU / NYU sheets | description, outcomes, credits | Keep codes/titles from workbook; write plausible descriptions |
| **Past decisions** | ~100 | Course Match sheet (82 BU↔peer pairs) + synthetic CC decisions | ext course, BU course, outcome, credits, rationale, evaluator, date | Hold out ~20% for backtesting |
| **Syllabi** | ~10–15 | Selected "maybe" courses | weekly topics, outcomes, textbook, assessment, contact hours | Short Markdown/PDF |
| **Transcripts** | 3–4 | Mix of above | student (fake), institution, term, course code, title, credits, grade | One must be the [demo scenario](09_demo_scenario.md) |

## Derivation of the equivalency DB from the workbook

| Workbook match level | Synthetic decision outcome |
|---|---|
| Likely equivalent | `equivalent` → BU course (exact-match row) |
| Partial – syllabus review | *not* in DB → becomes a "maybe" test case; ground truth = the BU course listed |
| No equivalent found | `elective` or `no_credit` (choose per course, record rationale) |
| Must be taken at BU | `bu_only` (elective credit pending PRG-09 answer) |

## Transcript coverage checklist
Each transcript set should include at least one of:
- [ ] exact equivalency
- [ ] renumbered / near-identical course (tests fuzzy match)
- [ ] partial match needing syllabus
- [ ] course that splits / combines (NU CHEM 1161; NU CS 2100 + CS 2700)
- [ ] BU-only requirement (CS 320/332/350 equivalents)
- [ ] grade below C
- [ ] quarter-system credits
- [ ] 5-credit lab course
- [ ] course with no plausible match (pure elective)

## Output location (proposal)
`data/synthetic/` with CSV/JSON files: `institutions`, `courses`, `equivalencies`, `syllabi/`, `transcripts/`, plus a generator script so data is reproducible.
