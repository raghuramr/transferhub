-- ============================================================
-- Migration 026 - One external course -> several BU courses (OUT-06)
-- ============================================================
-- EvaluationCourseMappings: every BU course a single external (transcript) course counts as.
--   * Source 'decision'    - written when an evaluator records several BU courses at once (the first one is also
--                            Evaluations.DecidedBUCourseId, so every existing query keeps working);
--   * Source 'equivalency' - written when the rules engine auto-applies a known one-to-many (or combined) equivalency.
--   TranscriptCourseId is always set (auto-applied courses have no Evaluations row); EvaluationId is optional.
-- Equivalencies.GroupKey: external courses that share a key AND the same BU course only count together
--   (NU CS 2100 + CS 2700 -> CS 112). A one-to-many needs no key: it is simply several active rows for one external course.
-- sp_TriageCourse / sp_RecordDecision are NOT changed: the primary mapping is recorded through them as before and the
-- extra mappings are written by the API in the same transaction.
-- Idempotent.
-- ============================================================
USE TransferHubDB;
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'EvaluationCourseMappings')
BEGIN
    CREATE TABLE EvaluationCourseMappings (
        Id                 INT              NOT NULL IDENTITY(1,1),
        TranscriptCourseId UNIQUEIDENTIFIER NOT NULL,
        EvaluationId       UNIQUEIDENTIFIER NULL,
        BUCourseId         INT              NOT NULL,
        AwardedCredits     DECIMAL(5,2)     NULL,
        Outcome            VARCHAR(20)      NOT NULL DEFAULT 'equivalent',  -- equivalent | elective
        Source             VARCHAR(20)      NOT NULL DEFAULT 'decision',    -- decision | equivalency
        SortOrder          INT              NOT NULL DEFAULT 0,
        CreatedAt          DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_EvalCourseMappings PRIMARY KEY (Id),
        CONSTRAINT FK_ECM_TC     FOREIGN KEY (TranscriptCourseId) REFERENCES TranscriptCourses(Id),
        CONSTRAINT FK_ECM_Eval   FOREIGN KEY (EvaluationId)       REFERENCES Evaluations(Id),
        CONSTRAINT FK_ECM_BU     FOREIGN KEY (BUCourseId)         REFERENCES Courses(Id),
        CONSTRAINT UQ_ECM_TC_BU  UNIQUE (TranscriptCourseId, BUCourseId),
        CONSTRAINT CK_ECM_Outcome CHECK (Outcome IN ('equivalent','elective')),
        CONSTRAINT CK_ECM_Source  CHECK (Source IN ('decision','equivalency')),
        CONSTRAINT CK_ECM_Credits CHECK (AwardedCredits IS NULL OR AwardedCredits >= 0)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ECM_Eval' AND object_id = OBJECT_ID('EvaluationCourseMappings'))
    CREATE INDEX IX_ECM_Eval ON EvaluationCourseMappings (EvaluationId);
GO

IF COL_LENGTH('Equivalencies', 'GroupKey') IS NULL
    ALTER TABLE Equivalencies ADD GroupKey NVARCHAR(40) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Equiv_GroupKey' AND object_id = OBJECT_ID('Equivalencies'))
    CREATE INDEX IX_Equiv_GroupKey ON Equivalencies (GroupKey);
GO
