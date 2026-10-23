# 06 · Assumptions & Open Questions

[← Back to Understanding](../UNDERSTANDING.md)

## Assumptions register

| ID | Assumption | Why we believe it | How to test | Risk if wrong |
|---|---|---|---|---|
| A-01 | The "maybe" path accounts for most elapsed time and evaluator effort. | Brief focuses evaluator pain on syllabus review. | Ask for % of courses that go to "maybe" and median time per path. | We optimise the wrong step. |
| A-02 | The equivalency database matches on exact institution + course code. | "Already evaluated" wording. | Ask how a renumbered course is handled. | Fuzzy-match value is smaller. |
| A-03 | Evaluators would accept AI-ranked suggestions as decision support. | Brief invites a tool; GOV-01 preserved. | Sponsor interview; show mock workbench. | Adoption fails. |
| A-04 | Showing students a *provisional* outcome is acceptable. | Transparency is a stated goal. | Ask sponsor about expectation / appeals risk. | Must show status only, not likely outcome. |
| A-05 | Quarter conversion truncates to 2 decimals (4 → 2.66). | Brief's example. | Confirm with Credit Evaluation. | Off-by-0.01 credit totals. |
| A-06 | Workbook match levels can stand in for past decisions. | Only decision-like data provided. | Ask for a real decision extract. | Backtest metrics are optimistic. |
| A-07 | Scope can be one BU program (Computer Science) for the demo. | Brief: "BU course list for one program". | Confirm with organisers. | Demo too narrow / too broad. |
| A-08 | A 5-credit NU course (with lab) earns 4 BU credits when mapped to a 4-credit BU course, and the extra credit is elective. | Common practice; not stated. | Ask. | Credit totals wrong. |
| A-09 | Grade threshold C applies to CAS for the demo. | "Many BU schools". | Ask per school. | Wrong eligibility. |
| A-10 | Transcripts arrive as PDFs; parsing is in scope. | Data format "Documents / PDFs". | Ask for a sample. | Need manual entry instead. |

## Questions for the sponsor

Formatted to paste into `Hackathon Discovery Log.xlsx` (columns: Category · Question · Why we're asking · Priority · Addressed to).

| # | Category | Question | Why we're asking | Priority |
|---|---|---|---|---|
| 1 | Business numbers / KPIs | How many transfer courses are evaluated per year, and what % are resolved by the equivalency database vs. go to "maybe"? | Sizes the problem; picks our baseline. | High |
| 2 | Business numbers / KPIs | What is the median / 90th-percentile time from transcript receipt to all courses posted? And for a single "maybe" course? | Baseline for the measurable outcome. | High |
| 3 | Process | How long does an evaluator spend per syllabus review, and how many evaluators/departments are involved? | Quantifies evaluator effort we aim to cut. | High |
| 4 | Data | Can we get an extract (even anonymised/synthetic-shaped) of the equivalency database? What fields does it hold? | Defines our data model and matching keys. | High |
| 5 | Data | When an evaluator decides, is a rationale recorded? Is it reused for the next student with the same course? | Tests A-02 and feedback-loop assumption. | High |
| 6 | Policy | Would BU allow students to see a *provisional / likely* outcome before department decision? | Tests A-04; shapes student UI. | High |
| 7 | Policy | How is a 5-credit course (with lab) mapped to a 4-credit BU course? And quarter rounding — truncate or round? | CR-02, CR-04. | Medium |
| 8 | Policy | Can a "must be taken at BU" course still earn elective credit? | PRG-09. | Medium |
| 9 | Policy | Grade threshold per school; treatment of C-, P/F, W, AP/IB? | GR-01, GR-03. | Medium |
| 10 | Process | What happens when a syllabus can't be obtained (old course, closed college)? | Edge-case path not in brief. | Medium |
| 11 | Process | How often does the Transferology preview differ from the final decision? | Expectation gap for students. | Medium |
| 12 | Systems | What systems does Credit Evaluation use (SIS, MyBU, workflow tool)? Any integration constraints? | Integration realism. | Low |
| 13 | Process | How is the one-year deadline tracked and communicated today? | Possible nudge feature. | Low |
| 14 | Data | Will organisers supply the promised syllabi and equivalency extract, or should we fully synthesise? | Data plan. | High |
| 15 | Scope | Is a community-college / quarter-system source school available, as in the demo scenario? | Demo realism. | Medium |

## Known unknowns (things we must say honestly in the final pitch)
- No baseline numbers → impact estimates will be modelled, not measured.
- Recommendation accuracy is measured against workbook/synthetic decisions, not real BU decisions.
- Department acceptance of AI suggestions is untested.
