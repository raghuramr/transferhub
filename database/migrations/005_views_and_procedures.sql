-- ============================================================
-- Migration 005 – Views and stored procedures
-- ============================================================
-- Must run after all tables it references exist (Institutions, Courses,
-- Programs, Equivalencies, Users, Departments, Transcripts,
-- TranscriptCourses, Evaluations, AIMatchCandidates, AuditLog).
-- CREATE OR ALTER VIEW / PROCEDURE is naturally idempotent — no IF-EXISTS
-- gymnastics needed. Content unchanged from the original
-- 005_views_and_procedures.sql.
-- ============================================================
USE TransferHubDB;
GO

-- ─── View: student-facing transcript summary ─────────────────
CREATE OR ALTER VIEW vw_StudentTranscriptSummary AS
SELECT
    t.Id                 AS TranscriptId,
    t.StudentUserId,
    u.FirstName + ' ' + u.LastName AS StudentName,
    i.Name               AS InstitutionName,
    i.Calendar,
    t.Status             AS TranscriptStatus,
    t.ReceivedAt,
    tc.Id                AS CourseId,
    tc.CourseCode,
    tc.CourseTitle,
    tc.OriginalCredits,
    tc.NormalisedCredits,
    tc.Grade,
    tc.GradeIsEligible,
    tc.Lane,
    tc.Status            AS CourseStatus,
    e.Outcome,
    e.AwardedCredits,
    bc.Code              AS BUCourseCode,
    bc.Title             AS BUCourseTitle,
    e.Status             AS EvalStatus,
    e.AIConfidence
FROM Transcripts t
JOIN Users u              ON u.Id = t.StudentUserId
JOIN Institutions i        ON i.Id = t.InstitutionId
JOIN TranscriptCourses tc  ON tc.TranscriptId = t.Id
LEFT JOIN Evaluations e    ON e.TranscriptCourseId = tc.Id
LEFT JOIN Courses bc       ON bc.Id = e.DecidedBUCourseId;
GO

-- ─── View: evaluator queue ───────────────────────────────────
CREATE OR ALTER VIEW vw_EvaluatorQueue AS
SELECT
    e.Id                 AS EvaluationId,
    e.Status,
    e.DepartmentId,
    d.Name               AS DepartmentName,
    e.AssignedToUserId,
    fu.FirstName + ' ' + fu.LastName AS AssignedTo,
    tc.CourseCode,
    tc.CourseTitle,
    tc.NormalisedCredits,
    tc.Grade,
    t.StudentUserId,
    su.FirstName + ' ' + su.LastName AS StudentName,
    inst.Name            AS FromInstitution,
    e.AIConfidence,
    amc.BUCourseId       AS TopCandidateBUCourseId,
    bc.Code              AS TopCandidateCode,
    bc.Title             AS TopCandidateTitle,
    e.CreatedAt          AS QueuedAt,
    e.UpdatedAt
FROM Evaluations e
JOIN TranscriptCourses tc  ON tc.Id = e.TranscriptCourseId
JOIN Transcripts t          ON t.Id = tc.TranscriptId
JOIN Users su               ON su.Id = t.StudentUserId
JOIN Institutions inst       ON inst.Id = t.InstitutionId
JOIN Departments d           ON d.Id = e.DepartmentId
LEFT JOIN Users fu           ON fu.Id = e.AssignedToUserId
LEFT JOIN AIMatchCandidates amc ON amc.EvaluationId = e.Id AND amc.Rank = 1
LEFT JOIN Courses bc         ON bc.Id = amc.BUCourseId;
GO

-- ─── View: match summary statistics ─────────────────────────
CREATE OR ALTER VIEW vw_MatchSummary AS
SELECT
    inst.Code            AS Institution,
    tc.Lane,
    COUNT(*)             AS CourseCount
FROM TranscriptCourses tc
JOIN Transcripts t     ON t.Id = tc.TranscriptId
JOIN Institutions inst ON inst.Id = t.InstitutionId
GROUP BY inst.Code, tc.Lane;
GO

-- ─── SP: triage a transcript course (rules engine) ───────────
-- Called by the API after parsing.  Applies business rules and sets Lane.
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

    -- Fetch the course row
    SELECT
        @Grade            = tc.Grade,
        @OrigCredits      = tc.OriginalCredits,
        @ExternalCourseId = tc.ExternalCourseId,
        @InstCalendar     = i.Calendar
    FROM TranscriptCourses tc
    JOIN Transcripts t     ON t.Id = tc.TranscriptId
    JOIN Institutions inst ON inst.Id = t.InstitutionId
    JOIN Institutions i    ON i.Id = t.InstitutionId
    WHERE tc.Id = @TranscriptCourseId;

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
    )
        SET @Lane = 'applied';
    ELSE IF EXISTS (
        SELECT 1 FROM Equivalencies eq
        WHERE eq.ExternalCourseId = @ExternalCourseId
          AND eq.Outcome = 'bu_only' AND eq.IsActive = 1
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

-- ─── SP: record evaluator decision ───────────────────────────
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
