# Demo script: Maya Rivera's six courses (about 8 minutes)

All data is synthetic. Presenter tool: **Super admin > Settings > Demo scenario** (`/superadmin/settings/demo-scenario`).
It shows live progress for each step and has two buttons:

- **Reset Maya scenario** - removes the demo requests (and any decisions made on them), removes the equivalencies those decisions
  created for CSC 220, CSC 240 and CIS 150, and rebuilds the six courses at upload state. Seed-written equivalencies and every
  other student's data are untouched. Run it before every demo.
- **Add second student (learning loop)** - creates Noah Chen (Bay State) with one CSC 220 course through the normal submission path.

Needs: seed 015 applied (catalogue + equivalencies), plus migrations 013/015/022 for the full timeline and exchange views.

## Logins

| Role | Email | Password |
|---|---|---|
| Student (Maya) | student@test.edu | Student@123! |
| Faculty | faculty.cs@bu.edu | Faculty@123! |
| Admin | admin@bu.edu | Admin@123! |
| Super admin | super_admin@bu.edu | SuperAdmin@123! |

Use two browser profiles (student and staff) so you do not have to sign in and out.

## Before you start
1. Sign in as super admin, open the Demo scenario page, press **Reset Maya scenario**, confirm. Steps 1 and 2 turn green.
2. Check the page shows: 6 courses, secure credits **11**, no equivalency for CSC 220 / CSC 240 / CIS 150, second student "Not added".

## The story
Maya Rivera is moving to Boston University (College of Arts and Sciences, BA Computer Science). She has two earlier schools:
Bay State Community College (semester) with five courses and Pioneer Valley Technical College (quarter) with one.

| # | Course | Credits | Grade | Case | Expected |
|---|---|---|---|---|---|
| 1 | BSCC CSC 110 Intro to Programming | 4 | A | Existing equivalency | Applied: CAS CS 111, 4 cr |
| 2 | BSCC MAT 210 Calculus I | 4 | B+ | Existing equivalency | Applied: CAS MA 123, 4 cr |
| 3 | BSCC ECO 101 Microeconomics | 3 | B | Existing equivalency | Applied: CAS EC 101, 3 cr as taken |
| 4 | BSCC CSC 220 Data Structures | 4 | A- | Maybe | Rules rank CS 112 first (62%), needs the department |
| 5 | BSCC CSC 240 Discrete Math | 4 | B | Maybe | CS 131 (58%) and MA 293 (55%) |
| 6 | PVTC CIS 150 Linear Algebra | 4 quarter | B | Quarter system | 4 x 2/3 = **2.66** semester credits vs MA 242 (4) |

## Walkthrough

1. **Upload** (student, Maya). Open *Upload transcript* / *My requests*. Say: "She uploads her transcripts; every course is read and triaged
   immediately." Show two requests, six courses.
2. **Instant status** (student dashboard). Say: "Before anyone looks at it, three courses are already settled." Point at the degree-progress card:
   **11 credits secure** (4 + 4 + 3; ECO 101 counts 3, as taken), two courses waiting for the department, CIS 150 showing the quarter conversion
   (4 quarter credits = 2.66). Note: the brief's "12 credits" assumed 4 for economics; the demo data has 3.
3. **Syllabus request** (student request page). Say: "Only the two uncertain courses ask for a syllabus, each with a one-line reason." CSC 110, MAT 210 and ECO 101 do not.
4. **Evaluator workbench, course 4** (staff: faculty.cs@bu.edu, *Approval queue*, open the Bay State request, Faculty review stage).
   Open CSC 220: syllabus topics next to CAS CS 112 (CS 111 second), credit maths shown. Choose **BU equivalent: CAS CS 112, 4 cr** and save.
   Say: "This decision is written back to the equivalency database."
5. **Course 6, quarter** (open the Pioneer Valley request). Say: "Four quarter credits become 2.66 semester credits, the rule is shown, and the
   shortfall against MA 242 (4) is visible." Choose *equivalent* (2.66 cr) or *elective*. Also decide CSC 240 (CS 131, 4 cr).
6. **Posting.** Approve the remaining stages (finance, first approver, final approver; admin@bu.edu can approve or use the stage bypass). All six
   courses become *Posted*. Back in Maya's dashboard the totals and degree progress update. Show *Transfers* (both universities see the request) as a bonus.
7. **Learning loop.** On the Demo scenario page press **Add second student (learning loop)**. Open the new request: Noah Chen, also from
   Bay State, also CSC 220, is **Applied automatically** to CS 112 with no review. Say: "Every decision makes the next student faster."
   If the badge shows "Not applied", CSC 220 was not decided yet: decide it for Maya first, then press the button again.

## Repeat the demo
Press **Reset Maya scenario** again; steps return to the start. It is safe to repeat as often as needed.

## Notes
- Reset keeps the three "known" equivalencies (CSC 110, MAT 210, ECO 101) and the eight extra past BSCC decisions from seed 015.
- Noah Chen (`noah.chen@transferdemo.edu`) has a placeholder password (no login); the presenter opens his request from the staff side.
- Endpoints (super admin only, audit-logged): `GET /api/demo/status`, `POST /api/demo/maya/reset`, `POST /api/demo/maya/second-student`.
