-- ============================================================
-- Migration 014: Partner data intake + workflow automation
--
-- Part 1 - Partner data intake (Data Import > Submissions / Partners)
--   * DataPartners      a university (or agency) that is allowed to push
--                       catalogue data to us: who they are + point of contact
--   * PartnerApiKeys    API keys issued to a partner. Only a SHA-256 hash is
--                       stored; the key itself is shown once at creation.
--   * ImportBatches     one submission (pushed over the API, or staged by staff)
--   * ImportBatchRows   every university / program / course row of a submission,
--                       with validation results and a per-row review status.
--                       Nothing reaches the real tables until a super admin
--                       selects rows and imports them.
--
-- Part 2 - Workflow automation
--   * WorkflowStages.AutoApprove / AutoApproveMinConfidence
--       a stage can be approved by the agent itself when the brief is clean
--   * TranscriptStages.AutoApproved / OverdueNotifiedAt
--       records agent approvals and de-duplicates overdue (SLA) alerts
--
-- Reserved-word care: PlannedAction (not Action), RowStatus, ValidationStatus.
-- Idempotent: safe to re-run.
-- ============================================================
USE TransferHubDB;
GO

-- ─── DataPartners ────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'DataPartners')
BEGIN
    CREATE TABLE DataPartners (
        Id             INT            NOT NULL IDENTITY(1,1),
        UniversityName NVARCHAR(200)  NOT NULL,
        UniversityCode VARCHAR(20)    NOT NULL,   -- the code this partner may submit data for
        ContactName    NVARCHAR(150)  NOT NULL,
        ContactEmail   NVARCHAR(256)  NOT NULL,
        ContactPhone   NVARCHAR(40)   NULL,
        Website        NVARCHAR(300)  NULL,
        Notes          NVARCHAR(1000) NULL,
        IsActive       BIT            NOT NULL DEFAULT 1,
        CreatedAt      DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
        CreatedBy      UNIQUEIDENTIFIER NULL,
        UpdatedAt      DATETIME2      NULL,
        CONSTRAINT PK_DataPartners PRIMARY KEY (Id),
        CONSTRAINT FK_DataPartners_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES Users(Id)
    );
    CREATE INDEX IX_DataPartners_Code ON DataPartners (UniversityCode);
END
GO

-- ─── PartnerApiKeys ──────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'PartnerApiKeys')
BEGIN
    CREATE TABLE PartnerApiKeys (
        Id          INT           NOT NULL IDENTITY(1,1),
        PartnerId   INT           NOT NULL,
        Label       NVARCHAR(100) NOT NULL DEFAULT 'Default',
        KeyPrefix   VARCHAR(16)   NOT NULL,       -- first characters, for recognising a key in the UI
        KeyHash     CHAR(64)      NOT NULL,       -- SHA-256 hex of the full key
        IsActive    BIT           NOT NULL DEFAULT 1,
        ExpiresAt   DATETIME2     NULL,
        LastUsedAt  DATETIME2     NULL,
        LastUsedIp  VARCHAR(64)   NULL,
        CreatedAt   DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
        CreatedBy   UNIQUEIDENTIFIER NULL,
        RevokedAt   DATETIME2     NULL,
        CONSTRAINT PK_PartnerApiKeys PRIMARY KEY (Id),
        CONSTRAINT FK_PartnerApiKeys_Partner FOREIGN KEY (PartnerId) REFERENCES DataPartners(Id) ON DELETE CASCADE,
        CONSTRAINT FK_PartnerApiKeys_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES Users(Id)
    );
    CREATE UNIQUE INDEX UX_PartnerApiKeys_Hash ON PartnerApiKeys (KeyHash);
    CREATE INDEX IX_PartnerApiKeys_Partner ON PartnerApiKeys (PartnerId);
END
GO

-- ─── ImportBatches ───────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ImportBatches')
BEGIN
    CREATE TABLE ImportBatches (
        Id            INT            NOT NULL IDENTITY(1,1),
        Ref           AS ('IMP-' + RIGHT('000000' + CAST(Id AS VARCHAR(10)), 6)),
        PartnerId     INT            NULL,          -- NULL for a batch staged by staff
        Source        VARCHAR(10)    NOT NULL DEFAULT 'api',
        Status        VARCHAR(10)    NOT NULL DEFAULT 'pending',
        SubmitterNote NVARCHAR(1000) NULL,
        SubmittedAt   DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
        SubmittedIp   VARCHAR(64)    NULL,
        ReviewedBy    UNIQUEIDENTIFIER NULL,
        ReviewedAt    DATETIME2      NULL,
        ReviewerNote  NVARCHAR(1000) NULL,
        ReportSentAt  DATETIME2      NULL,
        CONSTRAINT PK_ImportBatches PRIMARY KEY (Id),
        CONSTRAINT FK_ImportBatches_Partner FOREIGN KEY (PartnerId) REFERENCES DataPartners(Id),
        CONSTRAINT FK_ImportBatches_Reviewer FOREIGN KEY (ReviewedBy) REFERENCES Users(Id),
        CONSTRAINT CK_ImportBatches_Source CHECK (Source IN ('api','manual')),
        CONSTRAINT CK_ImportBatches_Status CHECK (Status IN ('pending','partial','imported','rejected'))
    );
    CREATE INDEX IX_ImportBatches_Status ON ImportBatches (Status, SubmittedAt DESC);
    CREATE INDEX IX_ImportBatches_Partner ON ImportBatches (PartnerId);
END
GO

-- ─── ImportBatchRows ─────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ImportBatchRows')
BEGIN
    CREATE TABLE ImportBatchRows (
        Id               INT            NOT NULL IDENTITY(1,1),
        BatchId          INT            NOT NULL,
        EntityType       VARCHAR(12)    NOT NULL,
        RowNo            INT            NOT NULL,
        Payload          NVARCHAR(MAX)  NOT NULL,   -- JSON exactly as received (editable by the reviewer)
        ValidationStatus VARCHAR(8)     NOT NULL DEFAULT 'valid',
        Messages         NVARCHAR(MAX)  NULL,       -- JSON array of strings
        PlannedAction    VARCHAR(8)     NOT NULL DEFAULT 'create',
        RowStatus        VARCHAR(10)    NOT NULL DEFAULT 'pending',
        OutcomeMessage   NVARCHAR(1000) NULL,
        DecidedBy        UNIQUEIDENTIFIER NULL,
        DecidedAt        DATETIME2      NULL,
        CONSTRAINT PK_ImportBatchRows PRIMARY KEY (Id),
        CONSTRAINT FK_IBR_Batch FOREIGN KEY (BatchId) REFERENCES ImportBatches(Id) ON DELETE CASCADE,
        CONSTRAINT FK_IBR_DecidedBy FOREIGN KEY (DecidedBy) REFERENCES Users(Id),
        CONSTRAINT CK_IBR_Entity CHECK (EntityType IN ('universities','programs','courses')),
        CONSTRAINT CK_IBR_Validation CHECK (ValidationStatus IN ('valid','warning','error')),
        CONSTRAINT CK_IBR_Planned CHECK (PlannedAction IN ('create','update','skip')),
        CONSTRAINT CK_IBR_Status CHECK (RowStatus IN ('pending','rejected','created','updated','failed'))
    );
    CREATE INDEX IX_IBR_Batch ON ImportBatchRows (BatchId, EntityType, RowNo);
END
GO

-- ─── Workflow automation columns ─────────────────────────────
IF COL_LENGTH('WorkflowStages', 'AutoApprove') IS NULL
    ALTER TABLE WorkflowStages ADD AutoApprove BIT NOT NULL CONSTRAINT DF_WS_AutoApprove DEFAULT 0;
GO
IF COL_LENGTH('WorkflowStages', 'AutoApproveMinConfidence') IS NULL
    ALTER TABLE WorkflowStages ADD AutoApproveMinConfidence DECIMAL(4,3) NULL;
GO
IF COL_LENGTH('TranscriptStages', 'AutoApproved') IS NULL
    ALTER TABLE TranscriptStages ADD AutoApproved BIT NOT NULL CONSTRAINT DF_TS_AutoApproved DEFAULT 0;
GO
IF COL_LENGTH('TranscriptStages', 'OverdueNotifiedAt') IS NULL
    ALTER TABLE TranscriptStages ADD OverdueNotifiedAt DATETIME2 NULL;
GO

PRINT 'Migration 014 applied: partner data intake + workflow automation.';
GO
