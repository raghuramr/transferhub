-- ============================================================
-- database/tests/triage-contract.sql - contract test for sp_TriageCourse (everything is rolled back)
-- ============================================================
-- Pins the lane / normalised-credit behaviour of dbo.sp_TriageCourse (migration 017 version) using throwaway data:
-- inside BEGIN TRAN it creates three throwaway institutions (ZZSEM semester, ZZQTR quarter, ZZBU the "BU side"),
-- their courses, equivalencies, two transcripts and eleven transcript courses; calls sp_TriageCourse for each course
-- exactly the way the app does (transcripts.service.ts: EXEC sp_TriageCourse @TranscriptCourseId, @TriagedBy), compares
-- the result with the expected value and then ROLLS EVERYTHING BACK. Nothing is left behind (the file prints a
-- check at the end). Do not run it concurrently with a deploy that inserts institutions whose code starts with ZZ.
--
-- Run connected to TransferHubDB (no USE - Azure SQL cannot switch databases):
--   sqlcmd -S <server>,1433 -d TransferHubDB -U <user> -P <pwd> -N -C -b -i database/tests/triage-contract.sql
-- Needs at least one student user (seed 003). Results: PASS/FAIL per case, then a summary; THROWs (sqlcmd -b -> non-zero exit)
-- if any case FAILs. Single batch, no GO.
--
-- What this covers and what it deliberately does NOT:
--   * SQL layer only. The application's policy engine (TransferPolicyService) runs AFTER the procedure and tightens lanes:
--     Pass/Fail, below-minimum grades per university, course age, accreditation, outside-US, credit cap. So grade "P"
--     is still grade-eligible here (lane needs_syllabus) and only becomes "review" in the app layer - see the Note column.
--   * The 5-credit lab rule (CR-04) is an OPEN POLICY QUESTION: case 11 pins today's behaviour (the 5 credits are carried
--     unchanged); it is not an endorsement. See docs/BU_OPEN_QUESTIONS.md.
-- ============================================================
SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @res TABLE (
    Seq INT, Scenario NVARCHAR(120), ExpLane VARCHAR(30), ActLane VARCHAR(30),
    ExpCredits DECIMAL(5,2), ActCredits DECIMAL(5,2), ExpEligible BIT, ActEligible BIT, Result VARCHAR(4), Note NVARCHAR(300));
DECLARE @fail INT = 0, @total INT = 0;

BEGIN TRY
    BEGIN TRAN;

    DECLARE @User UNIQUEIDENTIFIER = (SELECT TOP 1 u.Id FROM Users u JOIN Roles r ON r.Id = u.RoleId WHERE r.Name = 'student' ORDER BY u.CreatedAt);
    IF @User IS NULL THROW 50001, 'triage-contract.sql needs at least one student user (run the seeds first).', 1;
    IF EXISTS (SELECT 1 FROM Institutions WHERE Code IN ('ZZSEM', 'ZZQTR', 'ZZBU')) THROW 50002, 'Institutions ZZSEM/ZZQTR/ZZBU already exist - a previous run did not roll back; remove them first.', 1;

    -- Throwaway institutions and courses ------------------------------------------------
    INSERT INTO Institutions (Code, Name, Calendar, Type, IsBU, IsActive) VALUES
        ('ZZSEM', 'Zz Test Semester College', 'semester', 'community_college', 0, 1),
        ('ZZQTR', 'Zz Test Quarter College',  'quarter',  'community_college', 0, 1),
        ('ZZBU',  'Zz Test Receiving University', 'semester', 'university',   0, 1);
    DECLARE @Sem INT = (SELECT Id FROM Institutions WHERE Code = 'ZZSEM');
    DECLARE @Qtr INT = (SELECT Id FROM Institutions WHERE Code = 'ZZQTR');
    DECLARE @Bu  INT = (SELECT Id FROM Institutions WHERE Code = 'ZZBU');

    -- Receiving-side courses (4 credits each, one 4-credit target for the 5-credit lab case)
    INSERT INTO Courses (InstitutionId, Code, Title, Credits) VALUES
        (@Bu, 'ZB 100', 'Zz Target Course A', 4), (@Bu, 'ZB 101', 'Zz Target Course B', 4), (@Bu, 'ZB 102', 'Zz Target Course C', 4);
    DECLARE @BuA INT = (SELECT Id FROM Courses WHERE InstitutionId = @Bu AND Code = 'ZB 100');
    DECLARE @BuB INT = (SELECT Id FROM Courses WHERE InstitutionId = @Bu AND Code = 'ZB 101');
    DECLARE @BuC INT = (SELECT Id FROM Courses WHERE InstitutionId = @Bu AND Code = 'ZB 102');

    -- External courses: Seq, institution, code, credits, grade, term, equivalency kind, expected lane / credits / eligible, scenario
    DECLARE @case TABLE (Seq INT, InstId INT, Code NVARCHAR(30), Credits DECIMAL(5,2), Grade NVARCHAR(10), Term NVARCHAR(50),
                         Eq VARCHAR(12), ExpLane VARCHAR(30), ExpCredits DECIMAL(5,2), ExpEligible BIT, Scenario NVARCHAR(120), Note NVARCHAR(300));
    INSERT @case VALUES
     (1,  @Sem, 'ZT 101', 4, 'A',  'Fall 2024', 'equivalent', 'applied',        4.00, 1,    'exact equivalency (4cr, A)', NULL),
     (2,  @Sem, 'ZT 102', 3, 'C-', 'Fall 2024', 'equivalent', 'not_eligible',   3.00, 0,    'grade C- beats an existing equivalency', 'GR-01 minimum grade is C; C- is not eligible (C- policy is an open BU question)'),
     (3,  @Sem, 'ZT 103', 3, 'P',  'Fall 2024', NULL,         'needs_syllabus', 3.00, 1,    'grade P, no equivalency', 'P stays grade-eligible in SQL; the policy engine (app layer) then sends P/F to review'),
     (4,  @Sem, 'ZT 104', 3, 'AP', 'Fall 2024', NULL,         'needs_syllabus', 3.00, NULL, 'unrecognised grade (AP) -> eligibility unknown', 'GradeIsEligible NULL = flagged for review'),
     (5,  @Qtr, 'ZQ 201', 4, 'B',  'Fall 2024', NULL,         'needs_syllabus', 2.66, 1,    'quarter 4 credits, no equivalency -> 2.66 (FLOOR, not 2.67)', 'CR-02: rounding is an open BU question'),
     (6,  @Qtr, 'ZQ 202', 5, 'B+', 'Fall 2024', 'equivalent', 'applied',        3.33, 1,    'quarter 5 credits with equivalency -> 3.33', NULL),
     (7,  @Sem, 'ZT 105', 4, 'B',  'Fall 2024', NULL,         'needs_syllabus', 4.00, 1,    'no equivalency -> needs_syllabus', NULL),
     (8,  @Sem, 'ZT 106', 4, 'B',  'Fall 2024', 'bu_only',    'applied',        4.00, 1,    'equivalency outcome bu_only (current behaviour: lane applied)', 'KNOWN QUIRK pinned, not endorsed: the elective_only branch is unreachable because the first EXISTS ignores Equivalencies.Outcome, so bu_only/elective/no_credit mappings all give lane applied; the intended lane is elective_only'),
     (9,  @Sem, 'ZT 107', 4, 'A',  'Fall 2024', 'expired',    'needs_syllabus', 4.00, 1,    'equivalency ended 2020-12-31, course taken Fall 2024 -> not applied', 'effective dates (migration 017)'),
     (10, @Sem, 'ZT 108', 4, 'A',  'Fall 2021', 'future',     'needs_syllabus', 4.00, 1,    'equivalency starts 2025-01-01, course taken Fall 2021 -> not applied', 'effective dates (migration 017)'),
     (11, @Sem, 'ZT 109', 5, 'A',  'Fall 2024', 'equivalent', 'applied',        5.00, 1,    '5-credit semester lab course with equivalency to a 4-credit course', 'CR-04 OPEN: today the 5 credits are carried unchanged; BU must say how many credits the student earns (docs/BU_OPEN_QUESTIONS.md)');

    INSERT INTO Courses (InstitutionId, Code, Title, Credits)
    SELECT InstId, Code, CONCAT('Zz ', Code), Credits FROM @case;

    -- Equivalencies (all point at throwaway receiving-side courses)
    INSERT INTO Equivalencies (ExternalCourseId, BUCourseId, Outcome, MatchLevel, Rationale, Source, IsActive, EffectiveFrom, EffectiveTo)
    SELECT c.Id,
           CASE k.Seq WHEN 11 THEN @BuC WHEN 6 THEN @BuB ELSE @BuA END,
           CASE k.Eq WHEN 'bu_only' THEN 'bu_only' ELSE 'equivalent' END,
           'Likely equivalent', 'triage-contract.sql (rolled back)', 'synthetic', 1,
           CASE k.Eq WHEN 'future' THEN '2025-01-01' END,
           CASE k.Eq WHEN 'expired' THEN '2020-12-31' END
    FROM @case k JOIN Courses c ON c.InstitutionId = k.InstId AND c.Code = k.Code
    WHERE k.Eq IS NOT NULL;

    -- One transcript per college (a transcript belongs to exactly one institution) and the transcript courses
    DECLARE @TSem UNIQUEIDENTIFIER = NEWID(), @TQtr UNIQUEIDENTIFIER = NEWID();
    INSERT INTO Transcripts (Id, StudentUserId, SubmittedById, InstitutionId, Status, Notes) VALUES
        (@TSem, @User, @User, @Sem, 'received', 'triage-contract.sql (rolled back)'),
        (@TQtr, @User, @User, @Qtr, 'received', 'triage-contract.sql (rolled back)');

    DECLARE @tc TABLE (Seq INT, TcId UNIQUEIDENTIFIER);
    DECLARE @s INT = 1;
    WHILE @s <= 11
    BEGIN
        DECLARE @newTc UNIQUEIDENTIFIER = NEWID();
        INSERT INTO TranscriptCourses (Id, TranscriptId, CourseCode, CourseTitle, ExternalCourseId, OriginalCredits, Grade, Term, SortOrder)
        SELECT @newTc, CASE WHEN k.InstId = @Qtr THEN @TQtr ELSE @TSem END, k.Code, CONCAT('Zz ', k.Code), c.Id, k.Credits, k.Grade, k.Term, k.Seq
        FROM @case k JOIN Courses c ON c.InstitutionId = k.InstId AND c.Code = k.Code WHERE k.Seq = @s;
        INSERT @tc VALUES (@s, @newTc);
        SET @s += 1;
    END

    -- Execute the procedure the way the app does: EXEC sp_TriageCourse @TranscriptCourseId, @TriagedBy
    DECLARE @out TABLE (Lane VARCHAR(30), NormalisedCredits DECIMAL(5,2), GradeIsEligible BIT);
    DECLARE @seq INT, @tcid UNIQUEIDENTIFIER;
    DECLARE cur CURSOR LOCAL FAST_FORWARD FOR SELECT Seq, TcId FROM @tc ORDER BY Seq;
    OPEN cur; FETCH NEXT FROM cur INTO @seq, @tcid;
    WHILE @@FETCH_STATUS = 0
    BEGIN
        DELETE FROM @out;
        INSERT @out EXEC sp_TriageCourse @TranscriptCourseId = @tcid, @TriagedBy = @User;
        INSERT @res (Seq, Scenario, ExpLane, ActLane, ExpCredits, ActCredits, ExpEligible, ActEligible, Result, Note)
        SELECT k.Seq, k.Scenario, k.ExpLane, o.Lane, k.ExpCredits, o.NormalisedCredits, k.ExpEligible, o.GradeIsEligible,
               CASE WHEN o.Lane = k.ExpLane AND o.NormalisedCredits = k.ExpCredits
                         AND ((o.GradeIsEligible IS NULL AND k.ExpEligible IS NULL) OR o.GradeIsEligible = k.ExpEligible) THEN 'PASS' ELSE 'FAIL' END,
               k.Note
        FROM @case k CROSS JOIN @out o WHERE k.Seq = @seq;
        -- The procedure must also persist what it returned.
        IF NOT EXISTS (SELECT 1 FROM TranscriptCourses tc JOIN @out o ON o.Lane = tc.Lane AND o.NormalisedCredits = tc.NormalisedCredits WHERE tc.Id = @tcid)
            INSERT @res (Seq, Scenario, ExpLane, ActLane, ExpCredits, ActCredits, ExpEligible, ActEligible, Result, Note)
            VALUES (@seq * 100, CONCAT('case ', @seq, ': procedure result was persisted to TranscriptCourses'), NULL, NULL, NULL, NULL, NULL, NULL, 'FAIL', 'row not updated');
        FETCH NEXT FROM cur INTO @seq, @tcid;
    END
    CLOSE cur; DEALLOCATE cur;

    -- A procedure that returned nothing for a case would leave it missing from @res.
    INSERT @res (Seq, Scenario, Result, Note)
    SELECT k.Seq, k.Scenario, 'FAIL', 'sp_TriageCourse returned no row' FROM @case k WHERE NOT EXISTS (SELECT 1 FROM @res r WHERE r.Seq = k.Seq);

    -- Report while the throwaway rows still exist (table variables survive the ROLLBACK, so this is only for clarity).
    SELECT @fail = COUNT(*) FROM @res WHERE Result = 'FAIL';
    SELECT @total = COUNT(*) FROM @res;

    ROLLBACK TRAN;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRAN;
    DECLARE @err NVARCHAR(400) = CONCAT('triage-contract.sql aborted (rolled back): ', ERROR_MESSAGE());
    THROW 50003, @err, 1;
END CATCH;

-- Results (after the rollback; @res is a table variable so it is still there) --------------------------------
SELECT Seq, Scenario, ExpLane, ActLane, ExpCredits, ActCredits, ExpEligible, ActEligible, Result, Note FROM @res ORDER BY Seq;

SELECT CASE WHEN EXISTS (SELECT 1 FROM Institutions WHERE Code IN ('ZZSEM','ZZQTR','ZZBU')) OR EXISTS (SELECT 1 FROM Transcripts WHERE Notes = 'triage-contract.sql (rolled back)')
            THEN 'FAIL' ELSE 'PASS' END AS RollbackLeftNothingBehind;

DECLARE @line NVARCHAR(500);
DECLARE p CURSOR LOCAL FAST_FORWARD FOR
    SELECT CONCAT(Result, '  #', Seq, ' ', Scenario, '  expected ', ExpLane, ' / ', ExpCredits, '  actual ', ISNULL(ActLane, '-'), ' / ', ISNULL(CAST(ActCredits AS VARCHAR(10)), '-')) FROM @res ORDER BY Seq;
OPEN p; FETCH NEXT FROM p INTO @line;
WHILE @@FETCH_STATUS = 0 BEGIN PRINT @line; FETCH NEXT FROM p INTO @line; END
CLOSE p; DEALLOCATE p;

DECLARE @summary NVARCHAR(200) = CONCAT('triage-contract.sql: ', @total - @fail, ' PASS, ', @fail, ' FAIL (all changes rolled back)');
PRINT @summary;
IF @fail > 0 THROW 50000, @summary, 1;   -- non-zero exit for sqlcmd -b / CI
