-- ============================================================
-- Migration 004 – Transcripts, Evaluations & Syllabi
-- ============================================================
USE UniversityManager;
GO

-- ─── Students (extended profile for Users with role=student) ─
CREATE TABLE StudentProfiles (
    UserId          UNIQUEIDENTIFIER NOT NULL,
    BUStudentId     NVARCHAR(50)     NULL,   -- BU-assigned ID
    AdmissionYear   INT              NULL,
    ProgramArea     NVARCHAR(100)    NULL,
    AdvisorId       UNIQUEIDENTIFIER NULL,   -- FK Users.Id (admin/faculty)
    DeadlineDate    DATE             NULL,   -- one-year transfer deadline
    Notes           NVARCHAR(MAX)    NULL,
    CreatedAt       DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
    UpdatedAt       DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_StudentProfiles PRIMARY KEY (UserId),
    CONSTRAINT FK_SP_Users   FOREIGN KEY (UserId)    REFERENCES Users(Id) ON DELETE CASCADE,
    CONSTRAINT FK_SP_Advisor FOREIGN KEY (AdvisorId) REFERENCES Users(Id)
);
GO

-- ─── Transcripts ─────────────────────────────────────────────
CREATE TABLE Transcripts (
    Id              UNIQUEIDENTIFIER NOT NULL DEFAULT NEWSEQUENTIALID(),
    StudentUserId   UNIQUEIDENTIFIER NOT NULL,
    SubmittedById   UNIQUEIDENTIFIER NOT NULL,  -- student or agency user
    InstitutionId   INT              NOT NULL,
    FileStoragePath NVARCHAR(500)    NULL,       -- relative path on server
    OriginalFileName NVARCHAR(300)   NULL,
    Status          VARCHAR(20)      NOT NULL DEFAULT 'received',
                                                -- received|processing|complete
    Notes           NVARCHAR(MAX)    NULL,
    ReceivedAt      DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
    ProcessedAt     DATETIME2        NULL,
    ProcessedBy     UNIQUEIDENTIFIER NULL,
    CONSTRAINT PK_Transcripts PRIMARY KEY (Id),
    CONSTRAINT FK_Trans_Student  FOREIGN KEY (StudentUserId) REFERENCES Users(Id),
    CONSTRAINT FK_Trans_Submitter FOREIGN KEY (SubmittedById) REFERENCES Users(Id),
    CONSTRAINT FK_Trans_Institution FOREIGN KEY (InstitutionId) REFERENCES Institutions(Id),
    CONSTRAINT FK_Trans_Processor FOREIGN KEY (ProcessedBy) REFERENCES Users(Id),
    CONSTRAINT CK_Trans_Status CHECK (Status IN ('received','processing','complete'))
);
GO

CREATE INDEX IX_Transcripts_Student ON Transcripts (StudentUserId);
CREATE INDEX IX_Transcripts_Status  ON Transcripts (Status);
GO

-- ─── Transcript Courses ──────────────────────────────────────
-- Each row is one course on a student's transcript from one institution.
CREATE TABLE TranscriptCourses (
    Id              UNIQUEIDENTIFIER NOT NULL DEFAULT NEWSEQUENTIALID(),
    TranscriptId    UNIQUEIDENTIFIER NOT NULL,
    CourseCode      NVARCHAR(50)     NOT NULL,  -- as it appears on the transcript
    CourseTitle     NVARCHAR(300)    NOT NULL,
    ExternalCourseId INT             NULL,       -- matched to Courses table (may be NULL)
    OriginalCredits DECIMAL(5,2)     NOT NULL,
    NormalisedCredits DECIMAL(5,2)   NULL,       -- after quarter conversion
    Grade           NVARCHAR(10)     NOT NULL,   -- A, B+, C, P …
    GradeIsEligible BIT              NULL,       -- NULL = not yet assessed
    Term            NVARCHAR(50)     NULL,
    Lane            VARCHAR(30)      NOT NULL DEFAULT 'pending',
                                                -- pending|applied|likely|needs_syllabus|
                                                -- elective_only|not_eligible
    Status          VARCHAR(30)      NOT NULL DEFAULT 'pending',
                                                -- pending|in_review|decided|posted
    SortOrder       INT              NOT NULL DEFAULT 0,
    CreatedAt       DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
    UpdatedAt       DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_TranscriptCourses PRIMARY KEY (Id),
    CONSTRAINT FK_TC_Transcript FOREIGN KEY (TranscriptId)    REFERENCES Transcripts(Id) ON DELETE CASCADE,
    CONSTRAINT FK_TC_Course     FOREIGN KEY (ExternalCourseId) REFERENCES Courses(Id),
    CONSTRAINT CK_TC_Lane CHECK (Lane IN ('pending','applied','likely','needs_syllabus','elective_only','not_eligible')),
    CONSTRAINT CK_TC_Status CHECK (Status IN ('pending','in_review','decided','posted'))
);
GO

CREATE INDEX IX_TC_Transcript ON TranscriptCourses (TranscriptId);
CREATE INDEX IX_TC_Lane       ON TranscriptCourses (Lane);
CREATE INDEX IX_TC_Status     ON TranscriptCourses (Status);
GO

-- ─── Syllabi ─────────────────────────────────────────────────
CREATE TABLE Syllabi (
    Id                  UNIQUEIDENTIFIER NOT NULL DEFAULT NEWSEQUENTIALID(),
    TranscriptCourseId  UNIQUEIDENTIFIER NOT NULL,
    FileStoragePath     NVARCHAR(500)    NULL,
    OriginalFileName    NVARCHAR(300)    NULL,
    ExtractedText       NVARCHAR(MAX)    NULL,   -- parsed text for AI
    UploadedBy          UNIQUEIDENTIFIER NOT NULL,
    UploadedAt          DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_Syllabi PRIMARY KEY (Id),
    CONSTRAINT FK_Syl_TC     FOREIGN KEY (TranscriptCourseId) REFERENCES TranscriptCourses(Id) ON DELETE CASCADE,
    CONSTRAINT FK_Syl_Uploader FOREIGN KEY (UploadedBy) REFERENCES Users(Id)
);
GO

-- ─── Evaluations ─────────────────────────────────────────────
-- One row per TranscriptCourse reaching department review.
CREATE TABLE Evaluations (
    Id                  UNIQUEIDENTIFIER NOT NULL DEFAULT NEWSEQUENTIALID(),
    TranscriptCourseId  UNIQUEIDENTIFIER NOT NULL,
    AssignedToUserId    UNIQUEIDENTIFIER NULL,   -- faculty evaluator
    DepartmentId        INT              NULL,
    -- AI suggestion fields
    AISuggestionRaw     NVARCHAR(MAX)    NULL,   -- full JSON from AI
    AISuggestedCourseId INT              NULL,   -- top BU candidate
    AIConfidence        DECIMAL(5,4)     NULL,   -- 0.0–1.0
    AIRationale         NVARCHAR(MAX)    NULL,
    -- Human decision
    Outcome             VARCHAR(20)      NULL,   -- equivalent|elective|no_credit|bu_only
    DecidedBUCourseId   INT              NULL,
    AwardedCredits      DECIMAL(5,2)     NULL,
    EvaluatorNotes      NVARCHAR(MAX)    NULL,
    DecidedAt           DATETIME2        NULL,
    DecidedBy           UNIQUEIDENTIFIER NULL,
    -- Workflow
    Status              VARCHAR(20)      NOT NULL DEFAULT 'queued',
                                                -- queued|in_progress|decided|posted
    PostedAt            DATETIME2        NULL,
    PostedBy            UNIQUEIDENTIFIER NULL,
    CreatedAt           DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
    UpdatedAt           DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_Evaluations PRIMARY KEY (Id),
    CONSTRAINT FK_Eval_TC        FOREIGN KEY (TranscriptCourseId) REFERENCES TranscriptCourses(Id),
    CONSTRAINT FK_Eval_Faculty   FOREIGN KEY (AssignedToUserId)   REFERENCES Users(Id),
    CONSTRAINT FK_Eval_Dept      FOREIGN KEY (DepartmentId)       REFERENCES Departments(Id),
    CONSTRAINT FK_Eval_AICourse  FOREIGN KEY (AISuggestedCourseId) REFERENCES Courses(Id),
    CONSTRAINT FK_Eval_BUCourse  FOREIGN KEY (DecidedBUCourseId)  REFERENCES Courses(Id),
    CONSTRAINT FK_Eval_Decider   FOREIGN KEY (DecidedBy)          REFERENCES Users(Id),
    CONSTRAINT FK_Eval_Poster    FOREIGN KEY (PostedBy)           REFERENCES Users(Id),
    CONSTRAINT CK_Eval_Outcome CHECK (Outcome IS NULL OR Outcome IN ('equivalent','elective','no_credit','bu_only')),
    CONSTRAINT CK_Eval_Status  CHECK (Status IN ('queued','in_progress','decided','posted'))
);
GO

CREATE INDEX IX_Eval_TC       ON Evaluations (TranscriptCourseId);
CREATE INDEX IX_Eval_Faculty  ON Evaluations (AssignedToUserId);
CREATE INDEX IX_Eval_Dept     ON Evaluations (DepartmentId);
CREATE INDEX IX_Eval_Status   ON Evaluations (Status);
GO

-- ─── AI Candidate Suggestions ────────────────────────────────
-- Up to N BU course candidates per evaluation, ranked by AI.
CREATE TABLE AIMatchCandidates (
    Id              INT              NOT NULL IDENTITY(1,1),
    EvaluationId    UNIQUEIDENTIFIER NOT NULL,
    Rank            INT              NOT NULL,   -- 1 = best
    BUCourseId      INT              NOT NULL,
    Score           DECIMAL(5,4)     NULL,       -- 0.0–1.0
    Rationale       NVARCHAR(MAX)    NULL,
    TokensUsed      INT              NULL,       -- for cost tracking
    CreatedAt       DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_AIMatchCandidates PRIMARY KEY (Id),
    CONSTRAINT FK_AIMC_Eval     FOREIGN KEY (EvaluationId) REFERENCES Evaluations(Id) ON DELETE CASCADE,
    CONSTRAINT FK_AIMC_BUCourse FOREIGN KEY (BUCourseId)   REFERENCES Courses(Id)
);
GO

CREATE INDEX IX_AIMC_Evaluation ON AIMatchCandidates (EvaluationId);
GO
