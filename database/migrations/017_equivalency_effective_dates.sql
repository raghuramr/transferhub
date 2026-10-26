-- ============================================================
-- Migration 017 - Equivalency effective-date ranges (policy Phase 5)
-- ============================================================
-- Equivalencies gain EffectiveFrom / EffectiveTo (both optional DATE, NULL =
-- open-ended), like the TES begin/end dates. sp_TriageCourse only treats an
-- equivalency as "applied" when the course was taken inside its window, and
-- sp_RecordDecision no longer treats an EXPIRED mapping as already recorded.
-- Both procedures are re-created here (CREATE OR ALTER) because they must
-- run after the new columns exist; this version supersedes the one in 005.
-- Idempotent.
-- ============================================================
USE TransferHubDB;
GO

IF COL_LENGTH('Equivalencies', 'EffectiveFrom') IS NULL
    ALTER TABLE Equivalencies ADD EffectiveFrom DATE NULL;
GO
IF COL_LENGTH('Equivalencies', 'EffectiveTo') IS NULL
    ALTER TABLE Equivalencies ADD EffectiveTo DATE NULL;
GO
IF COL_LENGTH('Equivalencies', 'UpdatedAt') IS NULL
    ALTER TABLE Equivalencies ADD UpdatedAt DATETIME2 NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Equiv_DateRange')
    ALTER TABLE Equivalencies ADD CONSTRAINT CK_Equiv_DateRange
        CHECK (EffectiveFrom IS NULL OR EffectiveTo IS NULL OR EffectiveFrom <= EffectiveTo);
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
CREATE OR ALTER PROCEDURE sp_RecordDecision
    @EvaluationId    UNIQUEIDENTIFIER,
    @DecidedBy       UNIQUEIDENTIFIER,
    @Outcome         VARCHAR(20),      -- equivalent|elective|no_credit|bu_only
    @BUCourseId      INT,
    @AwardedCredits  DECIMAL(5,2),
    @EvaluatorNotes  NVARCHAR(MAX)
AS
BEGIN
    SET NOCOUNT ON;

    IF @Outcome NOT IN ('equivalent','elective','no_credit','bu_only')
    BEGIN
        RAISERROR('Invalid outcome value.', 16, 1);
        RETURN;
    END;

    DECLARE @TCId UNIQUEIDENTIFIER;
    SELECT @TCId = TranscriptCourseId FROM Evaluations WHERE Id = @EvaluationId;

    -- Update evaluation
    UPDATE Evaluations SET
        Outcome            = @Outcome,
        DecidedBUCourseId  = @BUCourseId,
        AwardedCredits     = @AwardedCredits,
        EvaluatorNotes     = @EvaluatorNotes,
        DecidedAt          = SYSUTCDATETIME(),
        DecidedBy          = @DecidedBy,
        Status             = 'decided',
        UpdatedAt          = SYSUTCDATETIME()
    WHERE Id = @EvaluationId;

    -- Update transcript course status
    UPDATE TranscriptCourses SET
        Status    = 'decided',
        UpdatedAt = SYSUTCDATETIME()
    WHERE Id = @TCId;

    -- Propagate to equivalency DB for reuse (only positive outcomes)
    IF @Outcome IN ('equivalent','elective')
    BEGIN
        DECLARE @ExtId INT;
        SELECT @ExtId = ExternalCourseId FROM TranscriptCourses WHERE Id = @TCId;

        IF NOT EXISTS (
            SELECT 1 FROM Equivalencies
            WHERE ExternalCourseId = @ExtId AND BUCourseId = @BUCourseId AND IsActive = 1
              AND (EffectiveTo IS NULL OR EffectiveTo >= CAST(SYSUTCDATETIME() AS DATE))
        )
        BEGIN
            INSERT INTO Equivalencies
                (ExternalCourseId, BUCourseId, Outcome, BUCredits, Source, DecidedBy, DecidedAt)
            VALUES
                (@ExtId, @BUCourseId, @Outcome, @AwardedCredits, 'evaluator', @DecidedBy, SYSUTCDATETIME());
        END;
    END;

    -- Audit
    INSERT INTO AuditLog (UserId, Action, EntityType, EntityId, NewValue, OccurredAt)
    VALUES (@DecidedBy, 'DECISION_SAVED', 'Evaluation',
            CAST(@EvaluationId AS NVARCHAR(100)),
            '{"outcome":"' + @Outcome + '","bu_course_id":' + CAST(ISNULL(@BUCourseId,0) AS NVARCHAR(10)) + ',"credits":' + CAST(ISNULL(@AwardedCredits,0) AS NVARCHAR(10)) + '}',
            SYSUTCDATETIME());
END;
GO
