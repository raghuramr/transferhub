# Open policy questions for BU

Questions the hackathon brief and BU's published policy do **not** answer. Until BU replies, the system uses the
defaults below, and every default can be changed without a redeploy where noted. Nothing here blocks the demo; each item
changes how many credits a student sees, so each needs a named owner at BU.

Sources: `_designs/understanding/03_business_rules.md` (rule ids), `06_assumptions_and_questions.md`,
`12_bu_transfer_policy_reference.md`. Rows for the question log are at the bottom.

| # | Rule | Question in one line | Current default | Priority |
|---|------|----------------------|-----------------|----------|
| 1 | CR-04 | What does a 5-credit NU lab course earn against a 4-credit BU course? | Carries the 5 credits unchanged | High |
| 2 | CR-02 | Quarter credits: truncate (2.66) or round (2.67)? | Truncate to 2 decimals | Medium |
| 3 | PRG-09 | Can a "must be taken at BU" course earn elective credit? | Lane `elective_only` intended (see note) | Medium |
| 4 | GR-01 | Does C- transfer, and is the minimum grade the same for every school? | C- does not transfer; minimum grade C | Medium |
| 5 | AP/IB | What score earns credit, and how many credits per exam? | Counts against the 68-credit cap; thresholds per university table | Medium |
| 6 | CR-01 | How are trimester credits converted? | No conversion; sent to a reviewer | Low |

---

## 1. CR-04 - the 5-credit lab rule

**Question.** Several Northeastern courses are listed as 5 credits because a 1-credit lab is bundled with a 4-credit
lecture (for example `CS 2000`). When such a course is matched to a 4-credit BU course, how many BU credits does the
student earn, and what happens to the extra credit?

**Why it matters.** The credit count feeds the 68-credit external cap and the student's degree-progress view. The
difference is one credit per bundled course, which adds up quickly over a transcript, and it decides whether the
department has to touch a course that otherwise matches exactly.

**Options for BU to choose from.**

| Option | Student earns | Effect |
|--------|---------------|--------|
| A. Cap at the BU course credits | 4 | The 5th credit is lost; simplest to explain; never exceeds what the BU course is worth. |
| B. Award 4 + 1 elective | 4 toward the BU course, 1 general elective credit | No credit is lost; adds a second record per course; the elective credit still counts toward the cap. |
| C. Award 5 as elective | 5 elective, BU course not marked satisfied | Keeps all credit but leaves the requirement open, which usually is not what a student expects. |

**Current system default.** None of the three. The matched course keeps the credits it had on the transcript
(`TranscriptCourses.NormalisedCredits` = 5), and `Equivalencies.BUCredits` is empty unless an evaluator types a value.
The evaluator sets the awarded credits by hand when recording the decision (`sp_RecordDecision`, field "awarded credits").
`database/tests/triage-contract.sql` case 11 pins this behaviour so a later change is deliberate.

**Where it is configured.** Per mapping: `Equivalencies.BUCredits` ("if different from the BU course credits"), edited on
`/admin/equivalencies`. There is no global setting yet; options A and B would be one small rule in `sp_TriageCourse` /
`sp_RecordDecision` (and the progress view), so the answer should be known before it is built.

**Data to decide.** Run this on the live database to see how many mappings are affected:

```sql
SELECT xi.Code AS ExternalUniversity, x.Code AS ExternalCourse, x.Credits AS ExternalCredits,
       b.Code AS BuCourse, b.Credits AS BuCredits, e.BUCredits AS CreditsOverride, e.Outcome
FROM Equivalencies e
JOIN Courses x ON x.Id = e.ExternalCourseId JOIN Institutions xi ON xi.Id = x.InstitutionId
JOIN Courses b ON b.Id = e.BUCourseId
WHERE e.IsActive = 1 AND x.Credits <> b.Credits
ORDER BY xi.Code, x.Code;
```

Bring the row count and the list to BU; most are expected to be NU lab courses (5 against 4).

## 2. CR-02 - quarter conversion rounding

**Question.** The brief's example turns 4 quarter credits into 2.66 semester credits. That is truncation
(4 x 2/3 = 2.666...). Rounding would give 2.67. Which does BU want, and is it applied per course or to the transcript total?

**Why it matters.** One hundredth of a credit per course; it only becomes visible when totals are shown to the student
or compared against a threshold, but a student who sees 2.67 elsewhere will ask.

**Current default.** Truncate to two decimals, per course: `FLOOR(credits * 2 / 3 * 100) / 100`
(4 -> 2.66, 5 -> 3.33). Tested in `src/api/scripts/test-progress.ts`, `database/tests/smoke.sql` and
`database/tests/triage-contract.sql`.

**Where configured.** Hard-coded in `sp_TriageCourse` (`database/migrations/017_equivalency_effective_dates.sql`) and
mirrored in `convertCredits` (`src/api/src/progress/progress.aggregate.ts`). Not a setting; changing it means a new
migration plus the mirrored TypeScript.

## 3. PRG-09 - "must be taken at BU" courses

**Question.** If a program requires a course to be taken at BU, can a transfer course that matches it still earn
elective credit?

**Why it matters.** It decides whether the system tells the student "no credit" or "elective credit only" for every
course in that group, which is a large share of the core courses.

**Current default.** Treated as elective credit only (`Equivalencies.Outcome = 'bu_only'`, intended lane
`elective_only`). Migration 029 fixed the triage lane: a `bu_only` mapping now returns `elective_only` instead of `applied`. Whether such a course may earn elective credit at all is still the question for BU.

**Where configured.** Per mapping (`Equivalencies.Outcome`); programme rules (migration 027) for residency limits.

## 4. C- and minimum grade

**Question.** BU's policy states "C or better". Confirm that C- does not transfer, that the minimum is the same for every
college, and whether a course the student already repeated with a higher grade counts.

**Why it matters.** C- is the most common borderline grade; a wrong default silently rejects or accepts courses.

**Current default.** C- is not eligible (`not_eligible`, reason "below minimum grade"). The minimum per university is
`TransferPolicies.MinGrade` (default `C`), edited on Workflows -> Transfer rules; `sp_TriageCourse` additionally rejects
C-, D+, D, D-, F, W, WF, I and NP outright.

**Where configured.** `TransferPolicies.MinGrade` (policy engine) and the grade list in `sp_TriageCourse`.

## 5. AP / IB thresholds

**Question.** Which AP, IB and A-level scores earn BU credit, how many credits for each subject, and does the credit count
against the 68-credit cap? BU's published policy says exam credit counts as external credit; the score table is the
missing piece.

**Why it matters.** Without a score table the system can only count exam credits the student typed in, with no check that
the score qualifies.

**Current default.** Exam credits entered at registration (`StudentExamCredits`) count against the cap
(68 transfer / 60 first-year / 68 current student, `TransferPolicies`); no minimum score is enforced unless an
`ExamCreditRules` row exists for the university (migration 028, added alongside this document; see its header).

**Where configured.** `TransferPolicies.CapTransfer/CapFirstYear/CapCurrentStudent`; `ExamCreditRules` for scores.

## 6. Quarter-to-semester for trimester colleges

**Question.** A few colleges run trimesters. Is the conversion 3/4 of a semester credit (three terms of the same length
as a semester across a year), or something else per college?

**Why it matters.** Without a stated factor the system cannot compute credits for these colleges.

**Current default.** No automatic conversion: a trimester transcript is sent to a reviewer who sets the credit value
(`review` flag `trimester` in `src/api/src/policy/transfer-policy.service.ts`).

**Where configured.** Hard-coded in the policy engine; the factor, once known, would be a per-institution setting.

---

## Ready-to-paste rows for `Hackathon Discovery Log.xlsx`

The workbook (`_designs/requirements/Hackathon Discovery Log.xlsx`) was not modified. Paste into row 5 onward, columns
B to J (the Q ID in column A is a formula; keep it). Replace the placeholder name and date.

### Table

| Problem statement | Team name | Submitted by | Date | Category | Question | Why we're asking | Priority | Addressed to |
|---|---|---|---|---|---|---|---|---|
| Problem 1 - Smarter Transfer Credit Evaluation (Boston University) | Clopay Code Crafters | [Participant name] | 2026-10-27 | Policy / rules | Some Northeastern courses are 5 credits because a 1-credit lab is bundled in. When one is matched to a 4-credit BU course, how many BU credits does the student earn: (A) 4, capped at the BU course; (B) 4 plus 1 elective; or (C) 5 as elective with the BU course left open? | Decides whether we cap the awarded credits or add an elective credit, and how the credit total and the 68-credit cap are shown to the student. Today we carry the 5 credits unchanged. | High | Business stakeholder (SPOC) |
| Problem 1 - Smarter Transfer Credit Evaluation (Boston University) | Clopay Code Crafters | [Participant name] | 2026-10-27 | Policy / rules | The brief converts 4 quarter credits to 2.66 BU credits. Is that truncation to two decimals (2.66) rather than rounding (2.67), and does it apply per course or to the transcript total? | Fixes the rounding rule in the credit conversion; a wrong default shows students a different number from the registrar's. | Medium | Business stakeholder (SPOC) |
| Problem 1 - Smarter Transfer Credit Evaluation (Boston University) | Clopay Code Crafters | [Participant name] | 2026-10-27 | Policy / rules | Can a course marked "must be taken at BU" still earn elective credit when a student has taken an equivalent course elsewhere? | Decides whether those courses show as "elective credit" or "no credit" in the student's result. | Medium | Business stakeholder (SPOC) |
| Problem 1 - Smarter Transfer Credit Evaluation (Boston University) | Clopay Code Crafters | [Participant name] | 2026-10-27 | Policy / rules | BU's policy requires a C or better. Does C- count as below the minimum for every college, and does a repeated course count at its latest grade? | Sets the grade cut-off the system applies automatically; C- is the most common borderline case. | Medium | Business stakeholder (SPOC) |
| Problem 1 - Smarter Transfer Credit Evaluation (Boston University) | Clopay Code Crafters | [Participant name] | 2026-10-27 | Policy / rules | Which AP, IB and A-level scores earn BU credit, how many credits per exam, and do they count against the 68-credit external cap? | We can only count exam credits students type in; a score table lets the system check them. | Medium | Business stakeholder (SPOC) |
| Problem 1 - Smarter Transfer Credit Evaluation (Boston University) | Clopay Code Crafters | [Participant name] | 2026-10-27 | Policy / rules | How should credits from a trimester college be converted to BU semester credits (a fixed factor, or reviewer judgement per college)? | Without a factor we send every trimester transcript to a reviewer instead of converting automatically. | Low | Business stakeholder (SPOC) |

### Tab-separated (paste straight into Excel at B5)

```
Problem 1 - Smarter Transfer Credit Evaluation (Boston University)	Clopay Code Crafters	[Participant name]	2026-10-27	Policy / rules	Some Northeastern courses are 5 credits because a 1-credit lab is bundled in. When one is matched to a 4-credit BU course, how many BU credits does the student earn: (A) 4, capped at the BU course; (B) 4 plus 1 elective; or (C) 5 as elective with the BU course left open?	Decides whether we cap the awarded credits or add an elective credit, and how the credit total and the 68-credit cap are shown to the student. Today we carry the 5 credits unchanged.	High	Business stakeholder (SPOC)
Problem 1 - Smarter Transfer Credit Evaluation (Boston University)	Clopay Code Crafters	[Participant name]	2026-10-27	Policy / rules	The brief converts 4 quarter credits to 2.66 BU credits. Is that truncation to two decimals (2.66) rather than rounding (2.67), and does it apply per course or to the transcript total?	Fixes the rounding rule in the credit conversion; a wrong default shows students a different number from the registrar's.	Medium	Business stakeholder (SPOC)
Problem 1 - Smarter Transfer Credit Evaluation (Boston University)	Clopay Code Crafters	[Participant name]	2026-10-27	Policy / rules	Can a course marked "must be taken at BU" still earn elective credit when a student has taken an equivalent course elsewhere?	Decides whether those courses show as "elective credit" or "no credit" in the student's result.	Medium	Business stakeholder (SPOC)
Problem 1 - Smarter Transfer Credit Evaluation (Boston University)	Clopay Code Crafters	[Participant name]	2026-10-27	Policy / rules	BU's policy requires a C or better. Does C- count as below the minimum for every college, and does a repeated course count at its latest grade?	Sets the grade cut-off the system applies automatically; C- is the most common borderline case.	Medium	Business stakeholder (SPOC)
Problem 1 - Smarter Transfer Credit Evaluation (Boston University)	Clopay Code Crafters	[Participant name]	2026-10-27	Policy / rules	Which AP, IB and A-level scores earn BU credit, how many credits per exam, and do they count against the 68-credit external cap?	We can only count exam credits students type in; a score table lets the system check them.	Medium	Business stakeholder (SPOC)
Problem 1 - Smarter Transfer Credit Evaluation (Boston University)	Clopay Code Crafters	[Participant name]	2026-10-27	Policy / rules	How should credits from a trimester college be converted to BU semester credits (a fixed factor, or reviewer judgement per college)?	Without a factor we send every trimester transcript to a reviewer instead of converting automatically.	Low	Business stakeholder (SPOC)
```
