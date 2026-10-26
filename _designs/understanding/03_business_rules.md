# 03 · Business Rules

[← Back to Understanding](../UNDERSTANDING.md)

Each rule has an ID so it can be referenced from code and tests. **Source** = where it came from; **Confidence**: *Stated* (in the brief / workbook), *Inferred* (our reading), *To confirm*.

## Governance

| ID | Rule | Source | Confidence |
|---|---|---|---|
| GOV-01 | Academic departments make the final decision on any course needing review. The tool may recommend, never decide. | Brief | Stated |
| GOV-02 | Matches in the workbook are a starting point, not official equivalencies. | Workbook README | Stated |
| GOV-03 | Student records are private; use only supplied/synthetic data. | Brief | Stated |

## Evaluation outcomes

| ID | Rule | Source | Confidence |
|---|---|---|---|
| OUT-01 | Each external course ends as one of: **BU equivalent** (specific course), **Elective credit** (counts as units), **No credit** (0 units). | Brief, Fig. 2 | Stated |
| OUT-02 | If an equivalency already exists, it is applied without department review. | Brief step 4 | Stated |
| OUT-03 | If no equivalency exists, the course is "maybe" and requires a syllabus for department review. | Brief step 5 | Stated |
| OUT-04 | Posted transfer courses carry grade **"T"**. | Brief step 7 | Stated |
| OUT-05 | Until evaluated, a course shows **0 units** in MyBU Student. | Brief | Stated |
| OUT-06 | One external course may map to more than one BU course and vice versa (e.g., NU CHEM 1161 → CH 101 and/or CH 102; NU splits CS 112 content across CS 2100 + CS 2700). | Workbook notes | Stated |

## Credits

| ID | Rule | Source | Confidence |
|---|---|---|---|
| CR-01 | Quarter-system credits convert at **2/3** of a semester credit. | Brief | Stated |
| CR-02 | Worked example: 4 quarter credits → **2.66** BU credits. This implies **truncation to 2 decimals** (rounding would give 2.67). | Brief | To confirm |
| CR-03 | BU, Northeastern and NYU all use semester credit hours. | Workbook README | Stated |
| CR-04 | Northeastern often bundles a 1-credit lab with a 4-credit course (shown as 5). How many BU credits a 5-credit NU course earns against a 4-credit BU course is **not stated**. | Workbook README | To confirm |

## Grades and GPA

| ID | Rule | Source | Confidence |
|---|---|---|---|
| GR-01 | Many BU schools require **C or higher** for transfer credit. Threshold is school-specific. | Brief | Stated (school variance to confirm) |
| GR-02 | External grades **do not count** toward BU GPA. | Brief | Stated |
| GR-03 | **Resolved by BU policy (doc 12):** C- does **not** qualify (C or better). Pass/Fail and S/U are not normally transferable (exceptions: Spring 2020, home-institution-mandated P/F). AP/IB/A-level count against the external-credit cap. | BU-EL-01/04, BU-CR-05 | Stated (BU) |
| GR-04 | Credit cap: max **68** external credits for transfer students (60 first-year, 80 MET); 128 to graduate, 60 in residence. | BU-CR-01..04 | Stated (BU) |
| GR-05 | Coursework older than **5 years** needs extra review; only **regionally accredited** institutions; no credit for internships, research, military or life experience. | BU-EL-02/05/06 | Stated (BU) |
| GR-06 | Transfer courses **never satisfy BU Hub** requirements; transfer students owe **10 Hub requirements**. | BU-HUB-01/02 | Stated (BU) |

## Program / degree rules

| ID | Rule | Source | Confidence |
|---|---|---|---|
| PRG-01 | Transfer courses **do not earn BU Hub** general-education units. | Brief | Stated |
| PRG-02 | All credits must be transferred **within one year** of starting at BU. | Brief | Stated |
| PRG-03 | **CS BA:** Group C courses (CAS CS 320, 332, 350) **must be taken at BU**; transfer cannot satisfy them even if a similar course exists. | Workbook | Stated |
| PRG-04 | **Economics BA:** max **4 courses at 200+ level** may be transferred *after matriculation*. | Workbook | Stated |
| PRG-05 | **Biology BA:** at least **5 BI courses beyond BI 107/108** must be taken at BU. | Workbook | Stated |
| PRG-06 | **Psychology BA:** PS 101 + 9 principal courses; PS 231 required; PS 211 is not a principal course. | Workbook | Stated |
| PRG-07 | **Mathematics BA:** calculus sequence MA 123/124/225 plus MA 242. | Workbook | Stated |
| PRG-08 | Substitutions allowed: MA 242 → CS 132; MA 294 → CS 235; MA 581 → CS 237; MA 115 / MA 213 / QST QM 221 → EC 203; MA 115 + MA 116 → PS 211. | Workbook notes | Stated |
| PRG-09 | Whether a "Must be taken at BU" course can still earn **elective** credit is not stated. | — | To confirm |

## Match-level vocabulary (from workbook)

| Level | Meaning | Maps to brief's process |
|---|---|---|
| Likely equivalent | Content and level line up closely | Candidate for "already evaluated" path |
| Partial – syllabus review | Overlapping content; syllabus review needed or maps to different/combined course | "Maybe" path |
| No equivalent found | No comparable course in peer core (elective may still exist) | "Maybe" → likely elective or no credit |
| Must be taken at BU | Residency requirement; transfer won't satisfy | Rule-based; at best elective (PRG-09) |

## Rule-evaluation order (proposed)

1. Deadline (PRG-02) → 2. Grade threshold (GR-01) → 3. Credit normalisation (CR-01/02) → 4. Existing equivalency (OUT-02) → 5. Residency / program caps (PRG-03..05) → 6. AI-ranked candidates for department review (GOV-01).
