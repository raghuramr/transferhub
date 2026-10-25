# 11 · Process Research & Gap Analysis

[← Back to Understanding](../UNDERSTANDING.md)

> Desk research on how universities actually run transfer-credit evaluation, compared against docs 03 (rules), 05 (personas) and 07 (solution concept). Findings are from public registrar pages found via web search; `WebFetch` could not reach external hosts from the build sandbox, so everything below rests on search-result summaries, not full page reads. Treat institution-specific numbers as examples, not policy.

## 1. Typical end-to-end stages and owners

| # | Stage | Typical owner | Notes from sources |
|---|---|---|---|
| 1 | **Intake / admission** | Admissions | Most schools evaluate only *after* admission (BU, JMU). |
| 2 | **Document receipt** | Registrar / Credit Evaluation Office | Official transcript sent directly from the sending school; unofficial copies flagged "pending". |
| 3 | **Rules & known-equivalency pass** | Registrar / Credit Evaluation Office | Grade minimum, credit conversion, existing articulation table. Known equivalencies post with no faculty review (BU: grade "T"). |
| 4 | **Syllabus request** | Registrar → student | Only for courses with no existing equivalency. |
| 5 | **Department / faculty review** | Academic department evaluator | Decides equivalent / elective / no credit. BU routes each syllabus to the *offering* department, which may sit outside the student's own school. |
| 6 | **Dean / chair approval** | Department chair or dean | Seen mainly on exceptions and appeals (Fredonia, Faulkner: advisor + chair + dean signatures). |
| 7 | **Final approval & posting** | Registrar | Posts units; pending credit shows 0 units until decided. |
| 8 | **Appeal (optional)** | Chair → dean → provost | Windows are short: first semester (Fredonia), 60 days from posting (Delaware). Gardner-Webb makes chair/dean final. |

Finance/bursar is **not** a standard stage in the sources found. It appears only where credit totals affect aid or enrollment status, so it should be an *optional, configurable* stage rather than a default.

## 2. Forms and documents students submit

| Form / document | Seen in practice | In app today? | Proposed |
|---|---|---|---|
| Official transcript | Universal; sent directly by sending institution | Partial: optional attachment on Submit Transcript (just added) | Keep; add "official vs unofficial" flag |
| Course syllabus (per course) | Universal for unmatched courses; BU wants grading breakdown, textbooks, reading schedule / weekly topics | `Syllabi` table exists, **no upload UI** | Per-course syllabus upload tied to the evaluation |
| Catalog course description + prerequisites (link) | Lehigh asks for an official catalog link; blurbs alone rejected | No | Optional catalog URL field per course |
| Transfer credit request / application (per course) | Stevens requires one per course, approved *before* enrolling | Partial: Submit Transcript covers a batch | Keep batch form; add per-course notes |
| Course equivalency request | Departments / registrar | No (staff add equivalencies directly) | Faculty "save as equivalency" on decision |
| AP / IB / CLEP official score reports | Must come from the testing body; minimum scores vary (AP ≥3, CLEP ≥50, IB 4–5) | No | New document type + score-threshold rule |
| Foreign credential evaluation (NACES: WES/ECE), course-by-course | JMU accepts any NACES member | No | New document type, required for international |
| Certified English translation | Required where the transcript is not in English; not by student or family | No | Document-type checklist item |
| Quarter→semester conversion | 2/3 factor (equivalently ÷1.5) is standard | Yes (CR-01/02, UI hint) | Done |
| Minimum grade | C common; C- accepted at some schools; JMU rejects C- | Rule exists (GR-01); C- open question (GR-03) | Make threshold configurable per university |
| Residency / max-transfer caps | e.g. 30 credits at the school, cap on exam credit | Program-specific rules only (PRG-03..05) | Per-university cap settings |
| Transfer credit appeal form | Chair/dean sign-off, strict deadline | No | Appeal stage with its own deadline |

## 3. Turnaround and status labels

- BU: external approval "can take up to three weeks"; a department states up to two weeks. Pending courses show **zero units**, approved show **T**.
- Appeal deadlines range from first semester to 60 days after posting.
- Nothing authoritative found on a universal status vocabulary; the sources use *pending / tentative / approved / posted*. The app's existing lanes plus per-stage status cover this.

## 4. What evaluators actually compare

Course description and prerequisites (catalog text), **learning outcomes** (fall back to the department site when the syllabus lacks them), **contact hours and term length** (Lehigh), grading breakdown and assessment types as a rigor proxy, textbooks and weekly topics, credits, and grade. Self-study and recorded-video courses are often refused. Course **level** and **lab component** were not covered by the sources; the workbook already shows lab bundling (CR-04), so keep them as comparison fields.

## 5. Gap analysis against docs 03 / 05 / 07

| Area | Already covered | Gap | Proposed action |
|---|---|---|---|
| Rules (03) | Deadline, grade, credits, equivalency, residency | Per-university thresholds, C- policy, AP/IB minimums, credit caps, exam-credit rules | Move thresholds into per-university settings |
| Workflow (07) | Single flow: rules → AI → one evaluator → post | **No multi-stage approval chain**, no bypass, no per-university definition, no stage dates/comments | Configurable stage list per university (below) |
| Personas (05) | Student, credit evaluator, department evaluator; advisor and financial aid as secondary | Dean/chair, finance, final approver have no role or queue | Approver groups per stage |
| Evidence | Titles, descriptions, topics | Syllabus upload, learning outcomes, contact hours, catalog link | Syllabus + evidence checklist per course |
| Communication | Student status view | **No notes separation** (internal vs student-visible), no reminders | Audience-tagged notes; "request update" email |
| Cost / AI | Matcher (AI) | No usage controls, no token accounting, no way to tune cost | AI settings, per-request usage log, skill playbooks |
| Appeals | Out of MVP (07) | Real schools run a short appeal window | Optional final stage |
| International | Not mentioned | NACES evaluation + certified translation | Document checklist, flagged for international students |

## 6. Proposed default stage list

Every stage is optional and re-orderable per receiving university; any stage can be bypassed by a user with bypass permission (with a required reason).

1. **New** — request received; documents checklist generated.
2. **Rules check (automated)** — grade, credits, deadline, existing equivalency, caps.
3. **AI pre-match (automated, optional)** — ranks candidates, writes a reviewer summary.
4. **Credit Evaluation review** — registrar confirms documents and known equivalencies.
5. **Faculty / department review** — one-click approve / reject on the AI summary.
6. **Finance review (optional)** — only where credits affect aid or caps.
7. **First approver (chair / dean)** — optional.
8. **Final approver (registrar)** — posts credit.
9. **Completed / Posted** — or **Rejected** with a student-facing reason, optionally followed by **Appeal**.

## Sources

- [BU Registrar – stages of transfer evaluation](https://www.bu.edu/reg/transfer-credit/stages-of-transfer-evaluation/)
- [BU Registrar – transfer credit](https://www.bu.edu/reg/transfer-credit/)
- [BU Registrar – transfer credit FAQs](https://www.bu.edu/reg/transfer-credit/faqs/)
- [BU History – transferring credit](https://www.bu.edu/history/academics/undergraduate-program/transferring-credit/)
- [BU Biology – transfer](https://www.bu.edu/biology/transfer)
- [Stevens – transfer credit information](https://www.stevens.edu/office-of-the-registrar/transfer-credit-information)
- [JMU – international transfer credit](https://www.jmu.edu/registrar/prospective-student/transfer-credit/international.shtml)
- [Univ. of Delaware – transfer credit form](https://udel.edu/content/dam/udelImages/registrar/Students/TransferCredit/TransferCreditForm_FillablePDF_Updated_11_21_22.pdf)
- [Univ. of Delaware – appeal process](https://udel.edu/academics/registrar/students/transfer-credit/appeal-process)
- [Fredonia – transfer appeal process and form](https://fa.fredonia.edu/sites/default/files/section/academics/registrar/_files/Transfer%20Appeal%20Process%20and%20Form.pdf)
- [Faulkner – transfer credit appeal form](https://www.faulkner.edu/wp-content/uploads/Transfer-Credit-Appeal-Form.pdf)
- [Gardner-Webb – transfer credit appeals](https://gardner-webb.smartcatalogiq.com/en/2024-2025/academic-catalog/traditional-undergraduate-programs/academic-policies/transfer-credit-policies/transfer-credit-appeals)
- [St. Joseph's (Fisher) – current student transfer guidelines](https://www.sjf.edu/services/registrar/student-information/transfer-articulation-guide/current-student-transfer-guidelines)
- [Lehigh – transfer credit evaluation](https://www2.lehigh.edu/admissions/transfer-credit-evaluation)
- [Frostburg – AP, IB and CLEP credit](https://frostburg.edu/admissions-and-cost/undergraduate/apply/ap-ib-clep-credit.php)
- [Bethel – credits by examination](https://bethel.edu/registrar/transfer-credits/undergraduate/credits-by-examination)
- [Linfield – quarter/semester conversion](https://sparkwonder.linfield.edu/registrar/transfer-credit/transfer.html)
- [Univ. of Idaho – transfer guide](https://www.uidaho.edu/-/media/UIdaho-Responsive/Files/registrar/Registrar/DW-Plan-Transfer-Guide.pdf)
- [Catholic University – transfer FAQs](https://undergraduate-studies.catholic.edu/academic-support/transfers/faqs.html)
