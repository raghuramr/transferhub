-- ============================================================
-- Migration 022 - Transfer exchange (University 1 <-> University 2 <-> student)
-- ============================================================
-- A transfer request has three parties: the student, the SOURCE university
-- (Transcripts.InstitutionId, "University 1") and the TARGET university
-- (Transcripts.TargetInstitutionId, "University 2"). This migration lets them
-- collaborate on it:
--   * DocumentRequests  one party asks another for a document on a request
--   * PartyReminders    party-to-party reminders (audit + 12h rate limit)
--   * Uploads (new columns) files uploaded for a transfer by any party, stored
--       in the STUDENT's folder, with who/what/why recorded
-- Reserved-word care: no column is called Type/Order/Key/Open/Schema; the
-- document type column is DocTypeKey (same as DocumentTypes).
-- Idempotent. Safe to re-run.
-- ============================================================
USE TransferHubDB;
GO

-- ─── Document requests ───────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'DocumentRequests')
BEGIN
    CREATE TABLE DocumentRequests (
        Id                        INT              NOT NULL IDENTITY(1,1),
        TranscriptId              UNIQUEIDENTIFIER NOT NULL,
        RequestedByParty          VARCHAR(20)      NOT NULL,   -- student | source_university | target_university
        RequestedFromParty        VARCHAR(20)      NOT NULL,
        RequestedByUserId         UNIQUEIDENTIFIER NOT NULL,
        RequestedByInstitutionId  INT              NULL,       -- the university speaking (NULL for the student)
        RequestedFromInstitutionId INT             NULL,       -- the university asked (NULL when the student is asked)
        DocTypeKey                VARCHAR(40)      NULL,       -- DocumentTypes.DocTypeKey, NULL = free-form
        Title                     NVARCHAR(200)    NOT NULL,
        Message                   NVARCHAR(1000)   NULL,
        DueDate                   DATE             NULL,
        Status                    VARCHAR(12)      NOT NULL CONSTRAINT DF_DocReq_Status DEFAULT 'open',
        FulfilledUploadId         UNIQUEIDENTIFIER NULL,       -- Uploads.Id (no FK: uploads are never cascaded away)
        FulfilledByUserId         UNIQUEIDENTIFIER NULL,
        FulfilledAt               DATETIME2        NULL,
        ResolvedByUserId          UNIQUEIDENTIFIER NULL,       -- who cancelled / declined it
        ResolutionNote            NVARCHAR(500)    NULL,
        CreatedAt                 DATETIME2        NOT NULL CONSTRAINT DF_DocReq_Created DEFAULT SYSUTCDATETIME(),
        UpdatedAt                 DATETIME2        NOT NULL CONSTRAINT DF_DocReq_Updated DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_DocumentRequests PRIMARY KEY (Id),
        CONSTRAINT FK_DocReq_Transcript FOREIGN KEY (TranscriptId) REFERENCES Transcripts(Id) ON DELETE CASCADE,
        CONSTRAINT FK_DocReq_ByUser FOREIGN KEY (RequestedByUserId) REFERENCES Users(Id),
        CONSTRAINT FK_DocReq_ByInst FOREIGN KEY (RequestedByInstitutionId) REFERENCES Institutions(Id),
        CONSTRAINT FK_DocReq_FromInst FOREIGN KEY (RequestedFromInstitutionId) REFERENCES Institutions(Id),
        CONSTRAINT FK_DocReq_DocType FOREIGN KEY (DocTypeKey) REFERENCES DocumentTypes(DocTypeKey),
        CONSTRAINT CK_DocReq_ByParty CHECK (RequestedByParty IN ('student','source_university','target_university')),
        CONSTRAINT CK_DocReq_FromParty CHECK (RequestedFromParty IN ('student','source_university','target_university')),
        CONSTRAINT CK_DocReq_Distinct CHECK (RequestedByParty <> RequestedFromParty),
        CONSTRAINT CK_DocReq_Status CHECK (Status IN ('open','fulfilled','cancelled','declined'))
    );
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_DocReq_Transcript' AND object_id = OBJECT_ID('DocumentRequests'))
    CREATE INDEX IX_DocReq_Transcript ON DocumentRequests (TranscriptId, Status);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_DocReq_FromInst' AND object_id = OBJECT_ID('DocumentRequests'))
    CREATE INDEX IX_DocReq_FromInst ON DocumentRequests (RequestedFromInstitutionId, Status);
GO

-- ─── Party-to-party reminders ────────────────────────────────
-- Separate from StatusReminders (whose Direction check only knows student<->approvers).
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'PartyReminders')
BEGIN
    CREATE TABLE PartyReminders (
        Id                  INT              NOT NULL IDENTITY(1,1),
        TranscriptId        UNIQUEIDENTIFIER NOT NULL,
        DocumentRequestId   INT              NULL,        -- set when the reminder is about one document request
        FromParty           VARCHAR(20)      NOT NULL,
        ToParty             VARCHAR(20)      NOT NULL,
        SentByUserId        UNIQUEIDENTIFIER NOT NULL,
        SentByInstitutionId INT              NULL,
        ToInstitutionId     INT              NULL,
        Message             NVARCHAR(500)    NULL,
        RecipientCount      INT              NOT NULL CONSTRAINT DF_PartyRem_Count DEFAULT 0,
        Success             BIT              NOT NULL CONSTRAINT DF_PartyRem_Success DEFAULT 0,   -- 1 = e-mail actually went out
        CreatedAt           DATETIME2        NOT NULL CONSTRAINT DF_PartyRem_Created DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_PartyReminders PRIMARY KEY (Id),
        CONSTRAINT FK_PartyRem_Transcript FOREIGN KEY (TranscriptId) REFERENCES Transcripts(Id) ON DELETE CASCADE,
        CONSTRAINT FK_PartyRem_User FOREIGN KEY (SentByUserId) REFERENCES Users(Id),
        CONSTRAINT CK_PartyRem_From CHECK (FromParty IN ('student','source_university','target_university')),
        CONSTRAINT CK_PartyRem_To CHECK (ToParty IN ('student','source_university','target_university'))
    );
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_PartyRem_Transcript' AND object_id = OBJECT_ID('PartyReminders'))
    CREATE INDEX IX_PartyRem_Transcript ON PartyReminders (TranscriptId, FromParty, ToParty, CreatedAt);
GO

-- ─── Uploads: who uploaded what, for which transfer ──────────
-- OwnerUserId / Role keep meaning "the uploader" (legacy owner rules keep working);
-- StudentUserId is the student whose folder the file lives in.
IF COL_LENGTH('Uploads', 'StudentUserId') IS NULL
    ALTER TABLE Uploads ADD StudentUserId UNIQUEIDENTIFIER NULL;
GO
IF COL_LENGTH('Uploads', 'TranscriptId') IS NULL
    ALTER TABLE Uploads ADD TranscriptId UNIQUEIDENTIFIER NULL;
GO
IF COL_LENGTH('Uploads', 'UploadedByParty') IS NULL
    ALTER TABLE Uploads ADD UploadedByParty VARCHAR(20) NULL;          -- student | source_university | target_university
GO
IF COL_LENGTH('Uploads', 'UploadedByInstitutionId') IS NULL
    ALTER TABLE Uploads ADD UploadedByInstitutionId INT NULL;
GO
IF COL_LENGTH('Uploads', 'Note') IS NULL
    ALTER TABLE Uploads ADD Note NVARCHAR(500) NULL;
GO
IF COL_LENGTH('Uploads', 'DocumentRequestId') IS NULL
    ALTER TABLE Uploads ADD DocumentRequestId INT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Uploads_Transcript' AND object_id = OBJECT_ID('Uploads'))
    CREATE INDEX IX_Uploads_Transcript ON Uploads (TranscriptId);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Uploads_StudentUser' AND object_id = OBJECT_ID('Uploads'))
    CREATE INDEX IX_Uploads_StudentUser ON Uploads (StudentUserId);
GO

-- Indexes that make the per-university Incoming / Outgoing lists cheap.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Transcripts_Source' AND object_id = OBJECT_ID('Transcripts'))
    CREATE INDEX IX_Transcripts_Source ON Transcripts (InstitutionId, ReceivedAt);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Transcripts_Target' AND object_id = OBJECT_ID('Transcripts'))
    CREATE INDEX IX_Transcripts_Target ON Transcripts (TargetInstitutionId, ReceivedAt);
GO
