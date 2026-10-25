-- ============================================================
-- Migration 013 – Transfer request workflow, notes, documents,
--                 reminders, and AI controls / token accounting
-- ============================================================
-- Adds, all idempotent:
--   * ApproverGroups / ApproverGroupMembers   named groups of approvers
--   * WorkflowDefinitions / WorkflowStages / WorkflowStageApprovers
--       a per-intaking-university stage chain (InstitutionId NULL = the
--       global default used when a university has no workflow of its own)
--   * DocumentTypes / WorkflowRequiredDocs / TranscriptDocuments
--       the per-workflow document checklist (syllabus, score reports, ...)
--   * TranscriptStages    one row per stage per transfer request, with
--       dates, status, deciding user, and the AI brief for that stage
--   * TranscriptNotes     audience-tagged notes ('internal' | 'student')
--   * StatusReminders     audit + rate-limit trail for "request an update"
--   * AiSettings / AiUsageLog / AiMatchCache / AgentSkills
--       AI on/off + cost knobs, per-call token accounting, a cross-student
--       result cache, and editable agent "skills" (playbook rules)
--   * New Transcripts columns linking a request to its workflow
--
-- Reserved-word care: StageOrder (not Order), ApproverType (not Type),
-- StageKey/DocTypeKey (not Key).
-- ============================================================
USE TransferHubDB;
GO

-- ─── Approver groups ─────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ApproverGroups')
BEGIN
    CREATE TABLE ApproverGroups (
        Id            INT            NOT NULL IDENTITY(1,1),
        Name          NVARCHAR(150)  NOT NULL,
        Description   NVARCHAR(500)  NULL,
        InstitutionId INT            NULL,           -- NULL = usable by any university
        IsActive      BIT            NOT NULL DEFAULT 1,
        CreatedAt     DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_ApproverGroups PRIMARY KEY (Id),
        CONSTRAINT FK_ApproverGroups_Institution FOREIGN KEY (InstitutionId) REFERENCES Institutions(Id)
    );
    CREATE UNIQUE INDEX UX_ApproverGroups_Name ON ApproverGroups (Name);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ApproverGroupMembers')
BEGIN
    CREATE TABLE ApproverGroupMembers (
        GroupId  INT              NOT NULL,
        UserId   UNIQUEIDENTIFIER NOT NULL,
        AddedAt  DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_ApproverGroupMembers PRIMARY KEY (GroupId, UserId),
        CONSTRAINT FK_AGM_Group FOREIGN KEY (GroupId) REFERENCES ApproverGroups(Id) ON DELETE CASCADE,
        CONSTRAINT FK_AGM_User  FOREIGN KEY (UserId)  REFERENCES Users(Id)
    );
END
GO

-- ─── Workflow definitions ────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'WorkflowDefinitions')
BEGIN
    CREATE TABLE WorkflowDefinitions (
        Id            INT            NOT NULL IDENTITY(1,1),
        InstitutionId INT            NULL,           -- intaking university; NULL = global default
        Name          NVARCHAR(150)  NOT NULL,
        Description   NVARCHAR(500)  NULL,
        AllowBypass   BIT            NOT NULL DEFAULT 1,  -- may an admin accept the request without the remaining stages?
        IsActive      BIT            NOT NULL DEFAULT 1,
        CreatedAt     DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
        UpdatedAt     DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_WorkflowDefinitions PRIMARY KEY (Id),
        CONSTRAINT FK_WF_Institution FOREIGN KEY (InstitutionId) REFERENCES Institutions(Id)
    );
    -- One active-or-not definition per university, and at most one global (NULL) row.
    CREATE UNIQUE INDEX UX_WF_Institution ON WorkflowDefinitions (InstitutionId);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'WorkflowStages')
BEGIN
    CREATE TABLE WorkflowStages (
        Id             INT            NOT NULL IDENTITY(1,1),
        WorkflowId     INT            NOT NULL,
        StageOrder     INT            NOT NULL,
        StageKey       VARCHAR(40)    NOT NULL,
        Name           NVARCHAR(120)  NOT NULL,
        Description    NVARCHAR(500)  NULL,
        StageType      VARCHAR(12)    NOT NULL,      -- system | review | approval
        AgentTask      VARCHAR(12)    NOT NULL DEFAULT 'none',  -- none | intake | match | finalize
        SlaDays        INT            NULL,
        IsEnabled      BIT            NOT NULL DEFAULT 1,
        CanBypass      BIT            NOT NULL DEFAULT 1,
        RequiresComment BIT           NOT NULL DEFAULT 0,
        CONSTRAINT PK_WorkflowStages PRIMARY KEY (Id),
        CONSTRAINT FK_WS_Workflow FOREIGN KEY (WorkflowId) REFERENCES WorkflowDefinitions(Id) ON DELETE CASCADE,
        CONSTRAINT CK_WS_Type CHECK (StageType IN ('system','review','approval')),
        CONSTRAINT CK_WS_Agent CHECK (AgentTask IN ('none','intake','match','finalize'))
    );
    CREATE INDEX IX_WS_Workflow ON WorkflowStages (WorkflowId, StageOrder);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'WorkflowStageApprovers')
BEGIN
    CREATE TABLE WorkflowStageApprovers (
        Id           INT          NOT NULL IDENTITY(1,1),
        StageId      INT          NOT NULL,
        ApproverType VARCHAR(8)   NOT NULL,          -- role | group | user
        RoleName     VARCHAR(20)  NULL,
        GroupId      INT          NULL,
        UserId       UNIQUEIDENTIFIER NULL,
        CONSTRAINT PK_WSA PRIMARY KEY (Id),
        CONSTRAINT FK_WSA_Stage FOREIGN KEY (StageId) REFERENCES WorkflowStages(Id) ON DELETE CASCADE,
        CONSTRAINT FK_WSA_Group FOREIGN KEY (GroupId) REFERENCES ApproverGroups(Id),
        CONSTRAINT FK_WSA_User  FOREIGN KEY (UserId)  REFERENCES Users(Id),
        CONSTRAINT CK_WSA_Type CHECK (
            (ApproverType = 'role'  AND RoleName IS NOT NULL AND GroupId IS NULL AND UserId IS NULL) OR
            (ApproverType = 'group' AND GroupId  IS NOT NULL AND RoleName IS NULL AND UserId IS NULL) OR
            (ApproverType = 'user'  AND UserId   IS NOT NULL AND RoleName IS NULL AND GroupId IS NULL))
    );
    CREATE INDEX IX_WSA_Stage ON WorkflowStageApprovers (StageId);
END
GO

-- ─── Document checklist ──────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'DocumentTypes')
BEGIN
    CREATE TABLE DocumentTypes (
        DocTypeKey    VARCHAR(40)   NOT NULL,
        Label         NVARCHAR(120) NOT NULL,
        Description   NVARCHAR(500) NULL,
        PerCourse     BIT           NOT NULL DEFAULT 0,   -- attaches to one transcript course (e.g. a syllabus)
        SortOrder     INT           NOT NULL DEFAULT 100,
        CONSTRAINT PK_DocumentTypes PRIMARY KEY (DocTypeKey)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'WorkflowRequiredDocs')
BEGIN
    CREATE TABLE WorkflowRequiredDocs (
        WorkflowId  INT         NOT NULL,
        DocTypeKey  VARCHAR(40) NOT NULL,
        IsRequired  BIT         NOT NULL DEFAULT 1,
        CONSTRAINT PK_WorkflowRequiredDocs PRIMARY KEY (WorkflowId, DocTypeKey),
        CONSTRAINT FK_WRD_Workflow FOREIGN KEY (WorkflowId) REFERENCES WorkflowDefinitions(Id) ON DELETE CASCADE,
        CONSTRAINT FK_WRD_Type FOREIGN KEY (DocTypeKey) REFERENCES DocumentTypes(DocTypeKey)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'TranscriptDocuments')
BEGIN
    CREATE TABLE TranscriptDocuments (
        Id                 INT              NOT NULL IDENTITY(1,1),
        TranscriptId       UNIQUEIDENTIFIER NOT NULL,
        TranscriptCourseId UNIQUEIDENTIFIER NULL,
        DocTypeKey         VARCHAR(40)      NOT NULL,
        UploadId           UNIQUEIDENTIFIER NOT NULL,
        FileName           NVARCHAR(300)    NOT NULL,
        Notes              NVARCHAR(500)    NULL,
        CreatedAt          DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        CreatedBy          UNIQUEIDENTIFIER NOT NULL,
        CONSTRAINT PK_TranscriptDocuments PRIMARY KEY (Id),
        CONSTRAINT FK_TD_Transcript FOREIGN KEY (TranscriptId) REFERENCES Transcripts(Id) ON DELETE CASCADE,
        CONSTRAINT FK_TD_Upload FOREIGN KEY (UploadId) REFERENCES Uploads(Id),
        CONSTRAINT FK_TD_Type FOREIGN KEY (DocTypeKey) REFERENCES DocumentTypes(DocTypeKey),
        CONSTRAINT FK_TD_User FOREIGN KEY (CreatedBy) REFERENCES Users(Id)
    );
    CREATE INDEX IX_TD_Transcript ON TranscriptDocuments (TranscriptId);
END
GO

-- ─── Link Transcripts to a workflow ──────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Transcripts') AND name = 'TargetInstitutionId')
    ALTER TABLE Transcripts ADD TargetInstitutionId INT NULL;
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Transcripts') AND name = 'WorkflowId')
    ALTER TABLE Transcripts ADD WorkflowId INT NULL;
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Transcripts') AND name = 'CurrentStageOrder')
    ALTER TABLE Transcripts ADD CurrentStageOrder INT NULL;
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Transcripts') AND name = 'WorkflowStatus')
    ALTER TABLE Transcripts ADD WorkflowStatus VARCHAR(12) NULL;   -- active | approved | rejected | bypassed
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_Trans_TargetInstitution')
    ALTER TABLE Transcripts ADD CONSTRAINT FK_Trans_TargetInstitution FOREIGN KEY (TargetInstitutionId) REFERENCES Institutions(Id);
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_Trans_Workflow')
    ALTER TABLE Transcripts ADD CONSTRAINT FK_Trans_Workflow FOREIGN KEY (WorkflowId) REFERENCES WorkflowDefinitions(Id);
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Trans_WorkflowStatus')
    ALTER TABLE Transcripts ADD CONSTRAINT CK_Trans_WorkflowStatus
        CHECK (WorkflowStatus IS NULL OR WorkflowStatus IN ('active','approved','rejected','bypassed'));
GO

-- ─── Per-request stage instances ─────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'TranscriptStages')
BEGIN
    CREATE TABLE TranscriptStages (
        Id               INT              NOT NULL IDENTITY(1,1),
        TranscriptId     UNIQUEIDENTIFIER NOT NULL,
        WorkflowStageId  INT              NULL,   -- NULL once the stage is deleted from the definition (snapshot below stays)
        StageOrder       INT              NOT NULL,
        StageKey         VARCHAR(40)      NOT NULL,
        StageName        NVARCHAR(120)    NOT NULL,
        StageType        VARCHAR(12)      NOT NULL,
        AgentTask        VARCHAR(12)      NOT NULL DEFAULT 'none',
        Status           VARCHAR(10)      NOT NULL DEFAULT 'pending',
        ActivatedAt      DATETIME2        NULL,
        DueAt            DATETIME2        NULL,
        CompletedAt      DATETIME2        NULL,
        DecidedByUserId  UNIQUEIDENTIFIER NULL,
        AiBrief          NVARCHAR(MAX)    NULL,   -- JSON: deterministic brief (+ optional narrative)
        AiRecommendation VARCHAR(10)      NULL,   -- approve | review | reject
        BriefGeneratedAt DATETIME2        NULL,
        CONSTRAINT PK_TranscriptStages PRIMARY KEY (Id),
        CONSTRAINT FK_TS_Transcript FOREIGN KEY (TranscriptId) REFERENCES Transcripts(Id) ON DELETE CASCADE,
        CONSTRAINT FK_TS_Stage FOREIGN KEY (WorkflowStageId) REFERENCES WorkflowStages(Id) ON DELETE SET NULL,
        CONSTRAINT FK_TS_Decider FOREIGN KEY (DecidedByUserId) REFERENCES Users(Id),
        CONSTRAINT CK_TS_Status CHECK (Status IN ('pending','active','approved','rejected','returned','skipped','bypassed'))
    );
    CREATE INDEX IX_TS_Transcript ON TranscriptStages (TranscriptId, StageOrder);
    CREATE INDEX IX_TS_Active ON TranscriptStages (Status, WorkflowStageId);
END
GO

-- ─── Notes (internal vs student-visible) ─────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'TranscriptNotes')
BEGIN
    CREATE TABLE TranscriptNotes (
        Id                INT              NOT NULL IDENTITY(1,1),
        TranscriptId      UNIQUEIDENTIFIER NOT NULL,
        TranscriptStageId INT              NULL,
        Audience          VARCHAR(8)       NOT NULL,   -- internal | student
        Kind              VARCHAR(10)      NOT NULL DEFAULT 'note',  -- note | decision | system
        AuthorUserId      UNIQUEIDENTIFIER NULL,        -- NULL for system notes
        AuthorRole        VARCHAR(20)      NULL,
        Body              NVARCHAR(MAX)    NOT NULL,
        CreatedAt         DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_TranscriptNotes PRIMARY KEY (Id),
        CONSTRAINT FK_TN_Transcript FOREIGN KEY (TranscriptId) REFERENCES Transcripts(Id) ON DELETE CASCADE,
        CONSTRAINT FK_TN_Stage FOREIGN KEY (TranscriptStageId) REFERENCES TranscriptStages(Id),
        CONSTRAINT FK_TN_Author FOREIGN KEY (AuthorUserId) REFERENCES Users(Id),
        CONSTRAINT CK_TN_Audience CHECK (Audience IN ('internal','student')),
        CONSTRAINT CK_TN_Kind CHECK (Kind IN ('note','decision','system'))
    );
    CREATE INDEX IX_TN_Transcript ON TranscriptNotes (TranscriptId, CreatedAt);
END
GO

-- ─── Reminders ───────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'StatusReminders')
BEGIN
    CREATE TABLE StatusReminders (
        Id                INT              NOT NULL IDENTITY(1,1),
        TranscriptId      UNIQUEIDENTIFIER NOT NULL,
        Direction         VARCHAR(14)      NOT NULL,   -- nudge_staff | update_student
        RequestedByUserId UNIQUEIDENTIFIER NOT NULL,
        TranscriptStageId INT              NULL,
        RecipientCount    INT              NOT NULL DEFAULT 0,
        Message           NVARCHAR(500)    NULL,
        Success           BIT              NOT NULL DEFAULT 0,
        CreatedAt         DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_StatusReminders PRIMARY KEY (Id),
        CONSTRAINT FK_SR_Transcript FOREIGN KEY (TranscriptId) REFERENCES Transcripts(Id) ON DELETE CASCADE,
        CONSTRAINT FK_SR_User FOREIGN KEY (RequestedByUserId) REFERENCES Users(Id),
        CONSTRAINT CK_SR_Direction CHECK (Direction IN ('nudge_staff','update_student'))
    );
    CREATE INDEX IX_SR_Transcript ON StatusReminders (TranscriptId, CreatedAt);
END
GO

-- ─── AI controls ─────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'AiSettings')
BEGIN
    CREATE TABLE AiSettings (
        Id                      INT           NOT NULL IDENTITY(1,1),
        InstitutionId           INT           NULL,      -- NULL = global; a row per university overrides it
        IsEnabled               BIT           NOT NULL DEFAULT 1,
        AutoRunOnIntake         BIT           NOT NULL DEFAULT 1,   -- run the 'match' agent task when a request reaches that stage
        MatchModel              NVARCHAR(100) NOT NULL DEFAULT 'claude-haiku-4-5',
        EscalationModel         NVARCHAR(100) NULL     DEFAULT 'claude-opus-4-5',
        EscalateBelowConfidence DECIMAL(5,4)  NOT NULL DEFAULT 0.6000,
        AutoLikelyThreshold     DECIMAL(5,4)  NOT NULL DEFAULT 0.7500,
        PrefilterTopN           INT           NOT NULL DEFAULT 8,   -- candidates sent to the model instead of the whole catalog
        MaxDescriptionChars     INT           NOT NULL DEFAULT 160,
        UseTopics               BIT           NOT NULL DEFAULT 1,
        UseResultCache          BIT           NOT NULL DEFAULT 1,
        UsePromptCaching        BIT           NOT NULL DEFAULT 1,
        MaxOutputTokens         INT           NOT NULL DEFAULT 600,
        MaxTokensPerRequest     INT           NULL,      -- cap per transfer request (NULL = no cap)
        MonthlyTokenBudget      BIGINT        NULL,      -- cap per calendar month (NULL = no cap)
        NarrativeBriefEnabled   BIT           NOT NULL DEFAULT 0,   -- LLM-written approver summary; off = free deterministic brief
        UpdatedAt               DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
        UpdatedBy               UNIQUEIDENTIFIER NULL,
        CONSTRAINT PK_AiSettings PRIMARY KEY (Id),
        CONSTRAINT FK_AiSettings_Institution FOREIGN KEY (InstitutionId) REFERENCES Institutions(Id),
        CONSTRAINT FK_AiSettings_User FOREIGN KEY (UpdatedBy) REFERENCES Users(Id)
    );
    CREATE UNIQUE INDEX UX_AiSettings_Institution ON AiSettings (InstitutionId);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'AiUsageLog')
BEGIN
    CREATE TABLE AiUsageLog (
        Id                 BIGINT           NOT NULL IDENTITY(1,1),
        TranscriptId       UNIQUEIDENTIFIER NULL,
        EvaluationId       UNIQUEIDENTIFIER NULL,
        InstitutionId      INT              NULL,     -- intaking university the call was made for
        Operation          VARCHAR(12)      NOT NULL, -- match | escalate | brief | summary
        Model              NVARCHAR(100)    NULL,
        InputTokens        INT              NOT NULL DEFAULT 0,
        OutputTokens       INT              NOT NULL DEFAULT 0,
        CacheReadTokens    INT              NOT NULL DEFAULT 0,
        CacheWriteTokens   INT              NOT NULL DEFAULT 0,
        EstimatedCostUsd   DECIMAL(12,6)    NOT NULL DEFAULT 0,
        DurationMs         INT              NULL,
        Skipped            BIT              NOT NULL DEFAULT 0,
        SkipReason         VARCHAR(30)      NULL,     -- ai_disabled | cache_hit | budget_exceeded | request_cap | equivalency_exists | error
        EstTokensSaved     INT              NOT NULL DEFAULT 0,
        CatalogSize        INT              NULL,
        CandidatesSent     INT              NULL,
        RequestedByUserId  UNIQUEIDENTIFIER NULL,
        CreatedAt          DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_AiUsageLog PRIMARY KEY (Id)
    );
    CREATE INDEX IX_AiUsage_Transcript ON AiUsageLog (TranscriptId);
    CREATE INDEX IX_AiUsage_Created ON AiUsageLog (CreatedAt);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'AiMatchCache')
BEGIN
    CREATE TABLE AiMatchCache (
        Id                    INT           NOT NULL IDENTITY(1,1),
        TargetInstitutionId   INT           NOT NULL,
        ExternalInstitutionId INT           NOT NULL,
        CourseCodeNorm        NVARCHAR(50)  NOT NULL,
        TitleNorm             NVARCHAR(300) NOT NULL,
        CandidatesJson        NVARCHAR(MAX) NOT NULL,
        TopConfidence         DECIMAL(5,4)  NOT NULL,
        Model                 NVARCHAR(100) NULL,
        HitCount              INT           NOT NULL DEFAULT 0,
        CreatedAt             DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
        LastHitAt             DATETIME2     NULL,
        CONSTRAINT PK_AiMatchCache PRIMARY KEY (Id)
    );
    CREATE UNIQUE INDEX UX_AiMatchCache_Key
        ON AiMatchCache (TargetInstitutionId, ExternalInstitutionId, CourseCodeNorm, TitleNorm);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'AgentSkills')
BEGIN
    CREATE TABLE AgentSkills (
        Id           INT           NOT NULL IDENTITY(1,1),
        SkillKey     VARCHAR(60)   NOT NULL,
        Title        NVARCHAR(150) NOT NULL,
        Category     VARCHAR(14)   NOT NULL DEFAULT 'matching',  -- matching | policy | token_saving
        Instructions NVARCHAR(MAX) NOT NULL,   -- injected verbatim into the agent's system prompt while active
        IsActive     BIT           NOT NULL DEFAULT 1,
        SortOrder    INT           NOT NULL DEFAULT 100,
        UpdatedAt    DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
        UpdatedBy    UNIQUEIDENTIFIER NULL,
        CONSTRAINT PK_AgentSkills PRIMARY KEY (Id),
        CONSTRAINT UQ_AgentSkills_Key UNIQUE (SkillKey),
        CONSTRAINT CK_AgentSkills_Category CHECK (Category IN ('matching','policy','token_saving'))
    );
END
GO
