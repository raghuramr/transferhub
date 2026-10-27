-- ============================================================
-- Migration 029 - sp_TriageCourse: a 'bu_only' equivalency must not auto-apply (PRG-03)
-- ============================================================
-- Bug: the first existence check ("lane = applied") ignored Equivalencies.Outcome, so a mapping
-- recorded as 'must be taken at BU' returned lane 'applied' and the intended 'elective_only' branch
-- below it was unreachable. Fix: the 'applied' check now excludes Outcome = 'bu_only'.
-- Everything else in the procedure is identical to migration 017. CREATE OR ALTER = idempotent.
-- Effect: such courses land in lane 'elective_only' (students see "likely elective credit at most";
-- the department still decides, GOV-01). Existing already-triaged rows are NOT rewritten.
-- ============================================================
USE TransferHubDB;
GO

CREATE OR ALTER PROCEDURE sp_TriageCourse
    @TranscriptCourseId UNIQUEIDENTIFIER,
    @TriagedBy          UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @Lane             VARCHAR(30) = 'pending';
    DECLARE @GradeEligible    BIT;
    DECLARE @NCredits         DECIMAL(5,2);
    DECLARE @ExternalCourseId INT;
    DECLARE @Grade            NVARCHAR(10);
    DECLARE @InstCalendar     VARCHAR(10);
    DECLARE @OrigCredits      DECIMAL(5,2);
    DECLARE @Term             NVARCHAR(50);
    DECLARE @AsOf             DATE = CAST(SYSUTCDATETIME() AS DATE);  -- when the course was taken (else today)

    -- Fetch the course row
    SELECT
        @Grade            = tc.Grade,
        @OrigCredits      = tc.OriginalCredits,
        @ExternalCourseId = tc.ExternalCourseId,
        @Term             = tc.Term,
        @InstCalendar     = i.Calendar
    FROM TranscriptCourses tc
    JOIN Transcripts t     ON t.Id = tc.TranscriptId
    JOIN Institutions inst ON inst.Id = t.InstitutionId
    JOIN Institutions i    ON i.Id = t.InstitutionId
    WHERE tc.Id = @TranscriptCourseId;

    -- Effective dates (TES-style): an equivalency applies to courses taken between its
    -- begin and end date (either may be NULL = open-ended). The term text
    -- ("Fall 2021") gives the date; when no year can be read, today is used.
    DECLARE @TermPos INT = PATINDEX('%[12][0-9][0-9][0-9]%', ISNULL(@Term, ''));
    IF @TermPos > 0
    BEGIN
        DECLARE @TermYear INT = TRY_CAST(SUBSTRING(@Term, @TermPos, 4) AS INT);
        IF @TermYear BETWEEN 1950 AND 2100
            SET @AsOf = DATEFROMPARTS(@TermYear,
                CASE WHEN @Term LIKE '%fall%' THEN 9 WHEN @Term LIKE '%summer%' THEN 6 ELSE 1 END, 1);
    END;

    -- Rule CR-01/02: credit normalisation
    IF @InstCalendar = 'quarter'
        SET @NCredits = CAST(FLOOR(@OrigCredits * 2.0 / 3.0 * 100) / 100 AS DECIMAL(5,2));
    ELSE
        SET @NCredits = @OrigCredits;

    -- Rule GR-01: grade eligibility (C or higher; simplified)
    IF @Grade IN ('A+','A','A-','B+','B','B-','C','P','T')
        SET @GradeEligible = 1;
    ELSE IF @Grade IN ('C-','D+','D','D-','F','W','WF','I','NP')
        SET @GradeEligible = 0;
    ELSE
        SET @GradeEligible = NULL; -- AP, IB, other — flag for review

    -- Lane assignment
    IF @GradeEligible = 0
        SET @Lane = 'not_eligible';
    ELSE IF EXISTS (
        SELECT 1 FROM Equivalencies eq
        WHERE eq.ExternalCourseId = @ExternalCourseId AND eq.IsActive = 1
          AND eq.Outcome <> 'bu_only'   -- PRG-03: a 'must be taken at BU' mapping never auto-applies (see next branch)
          AND (eq.EffectiveFrom IS NULL OR eq.EffectiveFrom <= @AsOf)
          AND (eq.EffectiveTo IS NULL OR eq.EffectiveTo >= @AsOf)
    )
        SET @Lane = 'applied';
    ELSE IF EXISTS (
        SELECT 1 FROM Equivalencies eq
        WHERE eq.ExternalCourseId = @ExternalCourseId
          AND eq.Outcome = 'bu_only' AND eq.IsActive = 1
          AND (eq.EffectiveFrom IS NULL OR eq.EffectiveFrom <= @AsOf)
          AND (eq.EffectiveTo IS NULL OR eq.EffectiveTo >= @AsOf)
    )
        SET @Lane = 'elective_only';
    ELSE
        SET @Lane = 'needs_syllabus';  -- will be updated to 'likely' after AI match

    -- Persist
    UPDATE TranscriptCourses SET
        NormalisedCredits = @NCredits,
        GradeIsEligible   = @GradeEligible,
        Lane              = @Lane,
        UpdatedAt         = SYSUTCDATETIME()
    WHERE Id = @TranscriptCourseId;

    -- Audit
    INSERT INTO AuditLog (Action, EntityType, EntityId, NewValue, OccurredAt)
    VALUES ('TRIAGE_COURSE', 'TranscriptCourse', CAST(@TranscriptCourseId AS NVARCHAR(100)),
            '{"lane":"' + @Lane + '","normalised_credits":' + CAST(@NCredits AS NVARCHAR(10)) + '}',
            SYSUTCDATETIME());

    SELECT @Lane AS Lane, @NCredits AS NormalisedCredits, @GradeEligible AS GradeIsEligible;
END;
GO
