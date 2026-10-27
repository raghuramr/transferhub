-- ============================================================
-- Seed 015 - Hackathon demo: "Maya Rivera" six-course transfer scenario
-- ============================================================
-- The brief (understanding/09_demo_scenario.md): a student transfers from a
-- community college with six courses - three with existing equivalencies, two
-- "maybe", one from a quarter-system school - and the solution must show each
-- case from upload to final posting.
--
-- Story (all synthetic):
--   Maya Rivera (student@test.edu, seeded in 003) is moving to BU CAS, BA Computer Science.
--   Bay State Community College (BSCC, semester) - 5 courses on one transcript:
--     1 CSC 110 Intro to Programming          4cr A   -> existing equivalency -> CAS CS 111  (lane: applied)
--     2 MAT 210 Calculus I                    4cr B+  -> existing equivalency -> CAS MA 123  (lane: applied)
--     3 ECO 101 Principles of Microeconomics  3cr B   -> existing equivalency -> CAS EC 101  (lane: applied, 3cr as taken)
--     4 CSC 220 Data Structures & Program Design 4cr A- -> NO equivalency ("maybe"); rules rank CS 112 first
--     5 CSC 240 Discrete Math for Computing   4cr B   -> NO equivalency ("maybe"); rules rank CS 131 and MA 293
--   Pioneer Valley Technical College (PVTC, quarter) - 1 course on a second transcript
--   (a transcript belongs to exactly one institution, as in the app):
--     6 CIS 150 Linear Algebra                4 quarter cr B -> 4 x 2/3 = 2.66 semester cr; no equivalency;
--                                               rules suggest CAS MA 242 (4cr), so the credit shortfall shows.
--   Courses 4-6 get an open Evaluation with the suggestion that the built-in rules matcher would produce
--   (confidence capped at 0.7, so they stay "needs syllabus" - the department decides, GOV-01).
--   Both requests are placed at the "Faculty Review" stage of the workflow (stages 1-2 done), exactly where a
--   real submission lands after intake + match, so they show on the student's dashboard and in the staff queues.
--   The learning loop (demo step 7) works because Evaluator decisions are written back to Equivalencies.
--
-- Also seeded: a small synthetic BSCC/PVTC catalogue with topics, 8 extra past BSCC decisions (ground truth for
-- the matcher / hold-out backtest), and descriptions for ~10 BU courses that had none.
--
-- Idempotent: courses/topics/equivalencies are insert-if-missing; the two transcripts are created only when
-- Maya has no "Demo scenario" transcript for that institution. Needs migrations through 013 (workflow) and
-- seeds 001/002/003/007/009. Uses only columns present in migrations 003/004/009/013 (015's optional per-course
-- policy columns are filled only when they exist).
-- ============================================================
USE TransferHubDB;
GO

-- ─── 1. Catalogue: BSCC (semester) + PVTC (quarter) ──────────
DECLARE @Bscc INT = (SELECT Id FROM Institutions WHERE Code = 'BSCC');
DECLARE @Pvtc INT = (SELECT Id FROM Institutions WHERE Code = 'PVTC');

INSERT INTO Courses (InstitutionId, Code, Title, ProgramArea, RequirementType, Credits, Description, LearningOutcomes, Level, Verified, Source)
SELECT v.InstId, v.Code, v.Title, v.Area, v.Req, v.Credits, v.Descr, v.Outcomes, v.Lvl, 'Yes', 'Synthetic demo catalogue'
FROM (VALUES
  (@Bscc,'CSC 110','Introduction to Programming','Computer Science','Core',4,
   'First course in programming. Variables, expressions, conditionals, loops, functions, lists and strings, recursion, and basic testing and debugging using Python. No prior experience assumed.',
   'Write and test small Python programs; decompose problems into functions; use loops, conditionals, lists and recursion.','intro'),
  (@Bscc,'CSC 220','Data Structures & Program Design','Computer Science','Core',4,
   'Object-oriented program design and the core data structures: classes, inheritance and interfaces, stacks, queues, linked lists, trees, hash tables, recursion, sorting and searching, and algorithm efficiency. Prerequisite CSC 110.',
   'Design object-oriented programs; implement and choose among stacks, queues, linked lists, trees and hash tables; analyse sorting and searching algorithms.','lower'),
  (@Bscc,'CSC 230','Computer Organization','Computer Science','Core',4,
   'Machine representation of data, assembly language basics, memory layout and the call stack, pointers, systems programming in C, and an introduction to operating system calls.',
   'Explain how programs execute on hardware; write small C and assembly programs; reason about memory and the stack.','lower'),
  (@Bscc,'CSC 240','Discrete Math for Computing','Computer Science','Core',4,
   'Mathematical foundations for computer science: propositional and predicate logic, proof techniques including induction, sets, relations and functions, counting and combinatorics, and an introduction to graphs and trees.',
   'Construct proofs by induction and contradiction; apply counting principles; model problems with graphs.','lower'),
  (@Bscc,'MAT 210','Calculus I','Mathematics','Core',4,
   'Limits and continuity, the derivative and its rules, applications of derivatives (optimisation, related rates), the definite integral and the Fundamental Theorem of Calculus.',
   'Compute limits, derivatives and basic integrals; solve optimisation and related-rates problems.','lower'),
  (@Bscc,'MAT 211','Calculus II','Mathematics','Core',4,
   'Techniques of integration, applications of the integral, improper integrals, sequences and series, Taylor series, and an introduction to differential equations.',
   'Integrate using standard techniques; test series for convergence; build Taylor approximations.','lower'),
  (@Bscc,'MAT 220','Linear Algebra','Mathematics','Elective',4,
   'Systems of linear equations, matrices and determinants, vector spaces, linear transformations, eigenvalues and eigenvectors, and orthogonality.',
   'Solve linear systems; compute with matrices and determinants; find eigenvalues and eigenvectors.','lower'),
  (@Bscc,'ECO 101','Principles of Microeconomics','Economics','Core',3,
   'Supply and demand, consumer choice, costs of production, competitive and monopoly markets, market failure and the role of government.',
   'Apply supply-and-demand analysis; explain firm and consumer behaviour; evaluate simple policy interventions.','intro'),
  (@Bscc,'ECO 102','Principles of Macroeconomics','Economics','Core',3,
   'National income accounting, unemployment and inflation, aggregate demand and supply, fiscal and monetary policy, and international trade basics.',
   'Interpret macroeconomic indicators; analyse fiscal and monetary policy.','intro'),
  (@Bscc,'PSY 101','Introduction to Psychology','Psychology','Core',3,
   'Survey of psychology: research methods, the brain and behaviour, learning, memory, development, personality, social behaviour and psychological disorders.',
   'Describe major areas of psychology and the methods used to study behaviour.','intro'),
  (@Bscc,'BIO 110','General Biology I','Biology','Core',4,
   'Cell structure and function, biological molecules, metabolism, genetics and molecular biology, and the foundations of evolution. Includes a laboratory.',
   'Explain cellular processes and heredity; carry out basic laboratory procedures.','intro'),
  (@Bscc,'CHM 110','General Chemistry I','Chemistry','Core',4,
   'Atomic structure, periodic trends, bonding, stoichiometry, gases, thermochemistry and solutions. Includes a laboratory.',
   'Balance equations and do stoichiometry; relate structure to properties; perform basic laboratory work.','intro'),
  (@Bscc,'CHM 111','General Chemistry II','Chemistry','Core',4,
   'Chemical kinetics, equilibrium, acids and bases, thermodynamics, electrochemistry and an introduction to organic chemistry. Includes a laboratory.',
   'Analyse equilibria and kinetics; apply thermodynamics and electrochemistry.','intro'),
  (@Pvtc,'CIS 150','Linear Algebra','Mathematics','Elective',4,
   'Quarter-system course (4 quarter credits). Vectors and matrices, systems of linear equations, determinants, vector spaces and subspaces, linear transformations, eigenvalues and eigenvectors with applications to computing.',
   'Solve linear systems; work with vector spaces and transformations; compute eigenvalues and eigenvectors.','lower'),
  (@Pvtc,'CIS 110','Programming Fundamentals','Computer Science','Core',4,
   'Quarter-system first programming course: variables, control flow, functions, arrays, and basic file input and output in Java.',
   'Write structured programs in Java.','intro'),
  (@Pvtc,'MTH 140','Calculus I','Mathematics','Core',4,
   'Quarter-system calculus: limits, derivatives and their applications, and an introduction to integration.',
   'Compute limits and derivatives; solve basic optimisation problems.','lower')
) AS v(InstId, Code, Title, Area, Req, Credits, Descr, Outcomes, Lvl)
WHERE v.InstId IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM Courses c WHERE c.InstitutionId = v.InstId AND c.Code = v.Code);
GO

-- Topics (syllabus-level detail) for the new external courses. Insert-if-missing by (course, title).
INSERT INTO CourseTopics (CourseId, Title, Description, SortOrder)
SELECT c.Id, t.Title, t.Descr, t.Sort
FROM (VALUES
  ('BSCC','CSC 110','Variables, control flow & functions','Python syntax, conditionals, loops and function definitions.',1),
  ('BSCC','CSC 110','Lists, strings & recursion','Sequence types and recursive problem solving.',2),
  ('BSCC','CSC 110','Testing & debugging','Writing simple tests and tracing programs.',3),
  ('BSCC','CSC 220','Object-oriented design','Classes, inheritance, interfaces and encapsulation.',1),
  ('BSCC','CSC 220','Core data structures','Stacks, queues, linked lists, trees and hash tables.',2),
  ('BSCC','CSC 220','Sorting & searching','Comparison sorts, binary search and algorithm efficiency.',3),
  ('BSCC','CSC 230','Machine representation','Binary data, assembly basics.',1),
  ('BSCC','CSC 230','Memory & the stack','Memory layout, the call stack and pointers in C.',2),
  ('BSCC','CSC 230','Systems programming','C programming and operating system calls.',3),
  ('BSCC','CSC 240','Logic & proof techniques','Propositional and predicate logic, direct proof, induction.',1),
  ('BSCC','CSC 240','Counting & combinatorics','Permutations, combinations and counting arguments.',2),
  ('BSCC','CSC 240','Graphs & trees','Graph terminology, trees and basic graph algorithms.',3),
  ('BSCC','CSC 240','Sets, relations & functions','Set theory, relations and functions.',4),
  ('BSCC','MAT 210','Limits & continuity','Limit laws and continuity.',1),
  ('BSCC','MAT 210','Derivatives & applications','Differentiation rules, optimisation and related rates.',2),
  ('BSCC','MAT 210','Definite integral','Riemann sums and the Fundamental Theorem of Calculus.',3),
  ('BSCC','MAT 211','Techniques of integration','Substitution, parts, partial fractions.',1),
  ('BSCC','MAT 211','Sequences & series','Convergence tests and Taylor series.',2),
  ('BSCC','MAT 220','Systems & matrices','Gaussian elimination, matrix algebra and determinants.',1),
  ('BSCC','MAT 220','Vector spaces','Subspaces, basis, dimension and linear transformations.',2),
  ('BSCC','MAT 220','Eigenvalues & eigenvectors','Eigenvalue theory and diagonalisation.',3),
  ('BSCC','ECO 101','Supply & demand','Market equilibrium and elasticity.',1),
  ('BSCC','ECO 101','Consumer & firm behaviour','Utility, costs and market structures.',2),
  ('BSCC','ECO 101','Market failure','Externalities, public goods and policy.',3),
  ('BSCC','ECO 102','National income & indicators','GDP, unemployment and inflation.',1),
  ('BSCC','ECO 102','Fiscal & monetary policy','Aggregate demand, central banking and government budgets.',2),
  ('BSCC','PSY 101','Research methods','Experimental design and statistics basics.',1),
  ('BSCC','PSY 101','Learning, memory & development','Core psychological processes across the lifespan.',2),
  ('BSCC','BIO 110','Cell biology','Cell structure, membranes and metabolism.',1),
  ('BSCC','BIO 110','Genetics','Mendelian and molecular genetics.',2),
  ('BSCC','CHM 110','Atomic structure & bonding','Periodic trends and chemical bonding.',1),
  ('BSCC','CHM 110','Stoichiometry & gases','Moles, reactions and gas laws.',2),
  ('BSCC','CHM 111','Kinetics & equilibrium','Reaction rates and chemical equilibrium.',1),
  ('BSCC','CHM 111','Thermodynamics & electrochemistry','Energy, entropy and electrochemical cells.',2),
  ('PVTC','CIS 150','Vectors & matrices','Vector operations, matrix algebra and linear systems.',1),
  ('PVTC','CIS 150','Vector spaces & transformations','Subspaces, basis and linear maps.',2),
  ('PVTC','CIS 150','Eigenvalues & eigenvectors','Eigen decomposition with computing applications.',3),
  ('PVTC','CIS 110','Programming fundamentals','Variables, control flow, functions and arrays in Java.',1),
  ('PVTC','MTH 140','Limits & derivatives','Limits, derivatives and applications.',1)
) AS t(InstCode, Code, Title, Descr, Sort)
JOIN Institutions i ON i.Code = t.InstCode
JOIN Courses c ON c.InstitutionId = i.Id AND c.Code = t.Code
WHERE NOT EXISTS (SELECT 1 FROM CourseTopics ct WHERE ct.CourseId = c.Id AND ct.Title = t.Title);
GO

-- Descriptions for BU courses used by the demo (only where empty, never overwrites).
UPDATE c SET c.Description = d.Descr, c.UpdatedAt = SYSUTCDATETIME()
FROM Courses c
JOIN Institutions i ON i.Id = c.InstitutionId AND i.Code = 'BU'
JOIN (VALUES
  ('CAS CS 111','Introduction to programming and problem solving: variables, control flow, functions, strings and lists, recursion and basic object use. For students with little or no prior experience.'),
  ('CAS CS 112','Second programming course: object-oriented design, classes and inheritance, stacks, queues, linked lists, trees, hash tables, sorting and searching, and algorithm efficiency.'),
  ('CAS CS 131','Combinatoric structures: logic and proof techniques including induction, sets and relations, counting and combinatorics, and an introduction to graphs and trees.'),
  ('CAS CS 132','Geometric algorithms: vectors, matrices, linear systems, and geometric transformations used in computing.'),
  ('CAS CS 210','Computer systems: machine representation, assembly basics, memory and the call stack, pointers, C programming and operating system calls.'),
  ('CAS CS 330','Analysis of algorithms: asymptotic analysis, divide and conquer, dynamic programming, graph algorithms and NP-completeness.'),
  ('CAS MA 123','Calculus I: limits, derivatives and their applications, and an introduction to the definite integral.'),
  ('CAS MA 124','Calculus II: techniques of integration, applications, sequences and series.'),
  ('CAS MA 242','Linear algebra: systems of linear equations, matrices, determinants, vector spaces, linear transformations, eigenvalues and eigenvectors.'),
  ('CAS MA 293','Discrete mathematics: logic, sets, relations and functions, counting, induction and graphs; supports computer science.'),
  ('CAS EC 101','Introductory microeconomic analysis: supply and demand, consumer and firm behaviour, market structures and market failure.'),
  ('CAS EC 102','Introductory macroeconomic analysis: national income, unemployment and inflation, aggregate demand and supply, fiscal and monetary policy.')
) AS d(Code, Descr) ON d.Code = c.Code
WHERE c.Description IS NULL;
GO

-- ─── 2. Equivalencies (existing decisions) ───────────────────
-- Demo "known" three: CSC 110 -> CS 111, MAT 210 -> MA 123, ECO 101 -> EC 101.
-- NOT seeded on purpose: CSC 220, CSC 240 (the "maybes") and PVTC CIS 150 (quarter course).
-- Plus 8 extra BSCC decisions so the matcher / backtest has local evidence.
INSERT INTO Equivalencies (ExternalCourseId, BUCourseId, Outcome, BUCredits, MatchLevel, Rationale, Source, DecidedAt)
SELECT ext.Id, bu.Id, 'equivalent', m.Credits, 'Likely equivalent', m.Rationale, 'synthetic', SYSUTCDATETIME()
FROM (VALUES
  ('CSC 110','CAS CS 111',4.00,'Intro programming; outcomes and topics match CS 111 (demo: existing equivalency).'),
  ('MAT 210','CAS MA 123',4.00,'Single-variable Calculus I (demo: existing equivalency).'),
  ('ECO 101','CAS EC 101',3.00,'Principles of microeconomics; credit applied as taken (3) - the demo shows credit-policy handling.'),
  ('MAT 211','CAS MA 124',4.00,'Calculus II; integration techniques and series.'),
  ('ECO 102','CAS EC 102',3.00,'Principles of macroeconomics; credit applied as taken (3).'),
  ('PSY 101','CAS PS 101',3.00,'Introductory psychology survey.'),
  ('BIO 110','CAS BI 107',4.00,'General biology with laboratory.'),
  ('CHM 110','CAS CH 101',4.00,'General chemistry I with laboratory.'),
  ('CHM 111','CAS CH 102',4.00,'General chemistry II with laboratory.'),
  ('MAT 220','CAS MA 242',4.00,'Linear algebra; same topic list as MA 242.'),
  ('CSC 230','CAS CS 210',4.00,'Computer organization / systems programming in C.')
) AS m(ExtCode, BuCode, Credits, Rationale)
JOIN Institutions ei ON ei.Code = 'BSCC'
JOIN Courses ext ON ext.InstitutionId = ei.Id AND ext.Code = m.ExtCode
JOIN Institutions bi ON bi.Code = 'BU'
JOIN Courses bu  ON bu.InstitutionId = bi.Id AND bu.Code = m.BuCode
WHERE NOT EXISTS (
    SELECT 1 FROM Equivalencies eq
    WHERE eq.ExternalCourseId = ext.Id AND eq.BUCourseId = bu.Id AND eq.IsActive = 1
);
GO

-- ─── 3. Maya's two transcripts, as a real submission would leave them ─────
-- Mirrors TranscriptsService.submit: Transcripts + TranscriptCourses, sp_TriageCourse (lanes + credit
-- normalisation: quarter x 2/3 truncated), one queued Evaluation per needs_syllabus course, then the
-- workflow (TargetInstitutionId = BU, stage snapshot) with the rules-matcher suggestions applied.
DECLARE @StudentId UNIQUEIDENTIFIER = (SELECT Id FROM Users WHERE Email = 'student@test.edu');
DECLARE @BuId   INT = (SELECT Id FROM Institutions WHERE Code = 'BU');
DECLARE @BsccId INT = (SELECT Id FROM Institutions WHERE Code = 'BSCC');
DECLARE @PvtcId INT = (SELECT Id FROM Institutions WHERE Code = 'PVTC');
DECLARE @WfId   INT = ISNULL(
    (SELECT TOP 1 Id FROM WorkflowDefinitions WHERE InstitutionId = @BuId AND IsActive = 1),
    (SELECT TOP 1 Id FROM WorkflowDefinitions WHERE InstitutionId IS NULL AND IsActive = 1));

IF @StudentId IS NULL OR @BuId IS NULL OR @BsccId IS NULL OR @PvtcId IS NULL
    PRINT 'Seed 015: student@test.edu or the BU/BSCC/PVTC institutions are missing - transcripts skipped (run seeds 001-003 first).';
ELSE
BEGIN
    IF OBJECT_ID('tempdb..#NewT') IS NOT NULL DROP TABLE #NewT;
    CREATE TABLE #NewT (TranscriptId UNIQUEIDENTIFIER NOT NULL);
    DECLARE @T1 UNIQUEIDENTIFIER = NEWID();
    DECLARE @T2 UNIQUEIDENTIFIER = NEWID();

    IF NOT EXISTS (SELECT 1 FROM Transcripts WHERE StudentUserId = @StudentId AND InstitutionId = @BsccId AND Notes LIKE 'Demo scenario%')
    BEGIN
        INSERT INTO Transcripts (Id, StudentUserId, SubmittedById, InstitutionId, Status, Notes, ReceivedAt, TargetInstitutionId, WorkflowId, WorkflowStatus, CurrentStageOrder)
        VALUES (@T1, @StudentId, @StudentId, @BsccId, 'processing',
                'Demo scenario (synthetic): Maya Rivera - Bay State Community College (semester). 3 known equivalencies, 2 maybes.',
                DATEADD(DAY, -2, SYSUTCDATETIME()), @BuId, @WfId, CASE WHEN @WfId IS NULL THEN NULL ELSE 'active' END, CASE WHEN @WfId IS NULL THEN NULL ELSE 3 END);

        INSERT INTO TranscriptCourses (Id, TranscriptId, CourseCode, CourseTitle, ExternalCourseId, OriginalCredits, NormalisedCredits, Grade, GradeIsEligible, Term, Lane, Status, SortOrder)
        SELECT NEWID(), @T1, v.Code, v.Title, c.Id, v.Credits, v.Credits, v.Grade, 1, v.Term, v.Lane, 'pending', v.Sort
        FROM (VALUES
          ('CSC 110','Introduction to Programming',4.00,'A', 'Fall 2025',  'applied',        1),
          ('MAT 210','Calculus I',                 4.00,'B+','Fall 2025',  'applied',        2),
          ('ECO 101','Principles of Microeconomics',3.00,'B','Spring 2026','applied',        3),
          ('CSC 220','Data Structures & Program Design',4.00,'A-','Spring 2026','needs_syllabus',4),
          ('CSC 240','Discrete Math for Computing',4.00,'B', 'Spring 2026','needs_syllabus', 5)
        ) AS v(Code, Title, Credits, Grade, Term, Lane, Sort)
        JOIN Courses c ON c.InstitutionId = @BsccId AND c.Code = v.Code;

        INSERT INTO #NewT (TranscriptId) VALUES (@T1);
    END

    IF NOT EXISTS (SELECT 1 FROM Transcripts WHERE StudentUserId = @StudentId AND InstitutionId = @PvtcId AND Notes LIKE 'Demo scenario%')
    BEGIN
        INSERT INTO Transcripts (Id, StudentUserId, SubmittedById, InstitutionId, Status, Notes, ReceivedAt, TargetInstitutionId, WorkflowId, WorkflowStatus, CurrentStageOrder)
        VALUES (@T2, @StudentId, @StudentId, @PvtcId, 'processing',
                'Demo scenario (synthetic): Maya Rivera - Pioneer Valley Technical College (quarter system). 4 quarter credits = 2.66 semester credits.',
                DATEADD(DAY, -2, SYSUTCDATETIME()), @BuId, @WfId, CASE WHEN @WfId IS NULL THEN NULL ELSE 'active' END, CASE WHEN @WfId IS NULL THEN NULL ELSE 3 END);

        -- 4 quarter credits x 2/3, truncated to 2 places = 2.66 (same formula as sp_TriageCourse).
        INSERT INTO TranscriptCourses (Id, TranscriptId, CourseCode, CourseTitle, ExternalCourseId, OriginalCredits, NormalisedCredits, Grade, GradeIsEligible, Term, Lane, Status, SortOrder)
        SELECT NEWID(), @T2, 'CIS 150', 'Linear Algebra', c.Id, 4.00,
               CAST(FLOOR(4.00 * 2.0 / 3.0 * 100) / 100 AS DECIMAL(5,2)), 'B', 1, 'Winter 2026', 'needs_syllabus', 'pending', 1
        FROM Courses c WHERE c.InstitutionId = @PvtcId AND c.Code = 'CIS 150';

        INSERT INTO #NewT (TranscriptId) VALUES (@T2);
    END

    -- Optional policy columns (migration 015) - plain, US, graded, in-person lecture courses.
    IF COL_LENGTH('TranscriptCourses', 'GradingBasis') IS NOT NULL AND EXISTS (SELECT 1 FROM #NewT)
        EXEC('UPDATE tc SET tc.GradingBasis = ''graded'', tc.DeliveryMode = ''in_person'', tc.CourseType = ''lecture'', tc.IsOutsideUS = 0
              FROM TranscriptCourses tc JOIN #NewT n ON n.TranscriptId = tc.TranscriptId');

    -- One queued Evaluation per needs_syllabus course (what submit() does), already carrying the built-in rules
    -- matcher's suggestion (confidence capped at 0.7, so the lane stays needs_syllabus - the department decides).
    INSERT INTO Evaluations (TranscriptCourseId, Status, AISuggestedCourseId, AIConfidence, AIRationale)
    SELECT tc.Id, 'in_progress', bu.Id, s.Conf, '[Built-in rules] ' + s.Why
    FROM TranscriptCourses tc
    JOIN #NewT n ON n.TranscriptId = tc.TranscriptId
    JOIN (VALUES
      ('CSC 220','CAS CS 112',0.620,'title/topic words in common: data, structures; description overlap: stacks, queues, linked, trees; credits are close (4 vs 4). Please verify against the syllabus.'),
      ('CSC 240','CAS CS 131',0.580,'title/topic words in common: discrete, counting; description overlap: logic, induction, combinatorics; credits are close (4 vs 4). Please verify against the syllabus.'),
      ('CIS 150','CAS MA 242',0.660,'title/topic words in common: linear, algebra; description overlap: vector, matrices, eigenvalues. Credits differ (2.66 vs 4) - quarter conversion applied. Please verify against the syllabus.')
    ) AS s(Code, BuCode, Conf, Why) ON s.Code = tc.CourseCode
    JOIN Courses bu ON bu.InstitutionId = @BuId AND bu.Code = s.BuCode
    WHERE tc.Lane = 'needs_syllabus'
      AND NOT EXISTS (SELECT 1 FROM Evaluations e WHERE e.TranscriptCourseId = tc.Id);

    -- Ranked candidates (what the matcher stores in AIMatchCandidates; max 3 per course).
    INSERT INTO AIMatchCandidates (EvaluationId, Rank, BUCourseId, Score, Rationale)
    SELECT e.Id, k.Rnk, bu.Id, k.Score, '[Built-in rules] ' + k.Why
    FROM Evaluations e
    JOIN TranscriptCourses tc ON tc.Id = e.TranscriptCourseId
    JOIN #NewT n ON n.TranscriptId = tc.TranscriptId
    JOIN (VALUES
      ('CSC 220',1,'CAS CS 112',0.620,'data structures, object-oriented design, sorting and searching overlap.'),
      ('CSC 220',2,'CAS CS 111',0.310,'introductory programming content; weaker topic overlap.'),
      ('CSC 220',3,'CAS CS 330',0.220,'algorithm-efficiency overlap only.'),
      ('CSC 240',1,'CAS CS 131',0.580,'logic, induction, counting, graphs overlap.'),
      ('CSC 240',2,'CAS MA 293',0.550,'discrete mathematics: sets, logic, induction overlap.'),
      ('CSC 240',3,'CAS CS 112',0.180,'trees/graphs mentioned; weak overlap.'),
      ('CIS 150',1,'CAS MA 242',0.660,'linear algebra topics match; credits differ after quarter conversion (2.66 vs 4).'),
      ('CIS 150',2,'CAS CS 132',0.300,'vectors/matrices; BU notes MA 242 may substitute for CS 132.')
    ) AS k(Code, Rnk, BuCode, Score, Why) ON k.Code = tc.CourseCode
    JOIN Courses bu ON bu.InstitutionId = @BuId AND bu.Code = k.BuCode
    WHERE NOT EXISTS (SELECT 1 FROM AIMatchCandidates x WHERE x.EvaluationId = e.Id AND x.Rank = k.Rnk);

    -- Workflow snapshot: stages 1-2 (New, Start) done, Faculty Review active, the rest pending.
    IF @WfId IS NOT NULL AND EXISTS (SELECT 1 FROM #NewT)
    BEGIN
        INSERT INTO TranscriptStages (TranscriptId, WorkflowStageId, StageOrder, StageKey, StageName, StageType, AgentTask, Status, ActivatedAt, DueAt, CompletedAt)
        SELECT n.TranscriptId, s.Id, s.Ord, s.StageKey, s.Name, s.StageType, s.AgentTask,
               CASE WHEN s.Ord <= 2 THEN 'approved' WHEN s.Ord = 3 THEN 'active' ELSE 'pending' END,
               CASE WHEN s.Ord <= 3 THEN DATEADD(DAY, -2, SYSUTCDATETIME()) END,
               CASE WHEN s.Ord = 3 AND s.SlaDays IS NOT NULL THEN DATEADD(DAY, s.SlaDays - 2, SYSUTCDATETIME()) END,
               CASE WHEN s.Ord <= 2 THEN DATEADD(DAY, -2, SYSUTCDATETIME()) END
        FROM #NewT n
        CROSS JOIN (
            SELECT ws.Id, ws.StageKey, ws.Name, ws.StageType, ws.AgentTask, ws.SlaDays,
                   ROW_NUMBER() OVER (ORDER BY ws.StageOrder) AS Ord
            FROM WorkflowStages ws WHERE ws.WorkflowId = @WfId AND ws.IsEnabled = 1
        ) s
        WHERE NOT EXISTS (SELECT 1 FROM TranscriptStages x WHERE x.TranscriptId = n.TranscriptId);

        -- A visible message for the student, like the engine's "now in <stage>" note.
        INSERT INTO TranscriptNotes (TranscriptId, TranscriptStageId, Audience, Kind, Body)
        SELECT ts.TranscriptId, ts.Id, 'student', 'system', 'Your request is now in "' + ts.StageName + '".'
        FROM TranscriptStages ts JOIN #NewT n ON n.TranscriptId = ts.TranscriptId
        WHERE ts.Status = 'active';
    END

    DROP TABLE #NewT;
END
GO

PRINT 'Seed 015: BSCC/PVTC catalogue, past decisions and the Maya Rivera six-course scenario are in place.';
GO
