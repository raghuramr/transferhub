-- ============================================================
-- Migration 020 - AI document reading (DocumentIntakes)
-- ============================================================
-- One row per uploaded document that the AI reader classifies and extracts data from
-- (transcripts, ID, English test, syllabus...). The file itself is an Uploads row in blob
-- storage; this table holds the reading result and the review state:
--   uploaded -> reading -> read | needs_review -> confirmed      (failed / skipped when AI is off)
-- Also lets AgentSkills use the new 'documents' category (the editable document-reading playbook).
-- Idempotent.
-- ============================================================
USE TransferHubDB;
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'DocumentIntakes')
BEGIN
    CREATE TABLE DocumentIntakes (
        Id               UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_DocIntakes_Id DEFAULT NEWID(),
        UserId           UNIQUEIDENTIFIER NOT NULL,
        UploadId         UNIQUEIDENTIFIER NOT NULL,           -- the Uploads row (blob storage)
        OriginalFileName NVARCHAR(300)    NOT NULL,
        MimeType         NVARCHAR(100)    NULL,
        Status           VARCHAR(14)      NOT NULL CONSTRAINT DF_DocIntakes_Status DEFAULT 'uploaded',
        DocType          VARCHAR(40)      NULL,               -- transcript | id_document | english_test | syllabus | enrollment_letter | other
        Confidence       DECIMAL(4,3)     NULL,               -- 0..1, overall
        Summary          NVARCHAR(500)    NULL,
        ExtractedJson    NVARCHAR(MAX)    NULL,
        Model            NVARCHAR(100)    NULL,
        InputTokens      INT              NOT NULL CONSTRAINT DF_DocIntakes_In DEFAULT 0,
        OutputTokens     INT              NOT NULL CONSTRAINT DF_DocIntakes_Out DEFAULT 0,
        Error            NVARCHAR(500)    NULL,
        ReadAt           DATETIME2        NULL,
        ConfirmedAt      DATETIME2        NULL,
        CreatedAt        DATETIME2        NOT NULL CONSTRAINT DF_DocIntakes_Created DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_DocumentIntakes PRIMARY KEY (Id),
        CONSTRAINT FK_DocIntakes_User FOREIGN KEY (UserId) REFERENCES Users(Id),
        CONSTRAINT CK_DocIntakes_Status CHECK (Status IN ('uploaded','reading','read','needs_review','confirmed','failed','skipped')),
        CONSTRAINT CK_DocIntakes_Json CHECK (ExtractedJson IS NULL OR ISJSON(ExtractedJson) = 1)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_DocIntakes_User' AND object_id = OBJECT_ID('DocumentIntakes'))
    CREATE INDEX IX_DocIntakes_User ON DocumentIntakes (UserId, CreatedAt);
GO

-- AgentSkills.Category was limited to matching | policy | token_saving; document reading skills use 'documents'.
IF OBJECT_ID('AgentSkills') IS NOT NULL
   AND EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_AgentSkills_Category' AND definition NOT LIKE '%documents%')
BEGIN
    EXEC('ALTER TABLE AgentSkills DROP CONSTRAINT CK_AgentSkills_Category');
    EXEC('ALTER TABLE AgentSkills ADD CONSTRAINT CK_AgentSkills_Category CHECK (Category IN (''matching'',''policy'',''token_saving'',''documents''))');
END
GO
