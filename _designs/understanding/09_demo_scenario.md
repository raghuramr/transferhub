# 09 · Demo Scenario

[← Back to Understanding](../UNDERSTANDING.md)

## From the brief

> A student transfers from a **community college** with **six courses**. **Three** have existing equivalencies, **two** are listed as **"maybe"**, and **one** is from a **quarter-system** school. Show how your solution handles each case **from upload to final posting**.

## Proposed concrete version (synthetic)

Student: **Maya Rivera (synthetic)** → BU CAS, BA Computer Science. Source schools: *Bay State Community College (synthetic, semester)* and *Pioneer Valley Technical College (synthetic, quarter)*.

| # | External course | Cr | Grade | Case | Expected handling | Expected BU outcome |
|---|---|---|---|---|---|---|
| 1 | BSCC CSC 110 Intro to Programming | 4 | A | Existing equivalency | Auto-applied | CAS CS 111 · 4 cr |
| 2 | BSCC MAT 210 Calculus I | 4 | B+ | Existing equivalency | Auto-applied | CAS MA 123 · 4 cr |
| 3 | BSCC ECO 101 Principles of Microeconomics | 3 | B | Existing equivalency | Auto-applied | CAS EC 101 (credit per CR-04 policy) |
| 4 | BSCC CSC 220 Data Structures & Program Design | 4 | A- | **Maybe** | AI ranks CS 112 first; syllabus requested; evaluator confirms | CAS CS 112 · 4 cr |
| 5 | BSCC CSC 240 Discrete Math for Computing | 4 | B | **Maybe** | AI ranks CS 131 and MA 293; evaluator picks | CAS CS 131 · 4 cr |
| 6 | PVTC CIS 150 Linear Algebra (quarter) | 4 qtr | B | **Quarter-system** | Converted 4 × 2/3 = **2.66**; matched to MA 242 but under-credited | Elective 2.66 cr *or* MA 242 pending dept (to confirm) |

## Walkthrough (what the demo shows)

1. **Upload** — Maya uploads her transcript; six rows appear with parsed credits and grades.
2. **Instant status** — Student view shows 3 ✅ applied (12 cr secure), 2 🟢/🟡 pending CS dept, 1 with quarter conversion explained.
3. **Syllabus request** — only for courses 4 and 5, with a one-line reason each.
4. **Evaluator workbench** — Dr. Lee opens course 4: syllabus side-by-side with CS 112 (and CS 111 as 2nd candidate), overlapping outcomes highlighted, credit math shown; clicks *BU equivalent → CS 112*.
5. **Course 6** — workbench shows the credit shortfall (2.66 vs 4) and lets the evaluator choose equivalent vs elective.
6. **Posting** — all six posted with grade T; student view updates totals and degree progress (e.g., Group A progress, Group C still required at BU).
7. **Learning loop** — next student from BSCC with CSC 220 gets it auto-applied.

## Stretch cases (if time permits)
- Grade C- course → not eligible, explained.
- An NU CS 4400 (Programming Languages) course → flagged *BU-only (CS 320)*, no syllabus requested.
- NU CHEM 1161 → one course mapping to CH 101 + CH 102.
