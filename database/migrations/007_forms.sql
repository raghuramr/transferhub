-- ============================================================
-- Migration 007 – Custom Forms (JSON-schema driven, admin-built)
-- ============================================================
-- Mirrors the "forms" content pattern from SKPTrust: a form's field list
-- is stored as a single JSON schema column rather than one table per
-- form. Submissions store their answers as JSON keyed by field, so new
-- forms never require a schema migration.
--
-- Consolidation note: the original 007_forms.sql unconditionally dropped
-- FormSubmissions/Forms at the top of the file (a one-time recovery step
-- for an earlier mid-migration failure, before the Schema -> SchemaJson
-- rename below). That is NOT safe to re-run against a database that
-- already has real Forms/FormSubmissions data — every re-run would
-- silently destroy it. This consolidated file uses the same
-- existence-guarded CREATE pattern as every other entity file instead,
-- so it is a true no-op against an already-correct database.
-- ============================================================
USE CreditEvalManager;
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Forms')
BEGIN
    CREATE TABLE Forms (
        Id              INT              NOT NULL IDENTITY(1,1),
        Slug            VARCHAR(150)     NOT NULL,
        Title           NVARCHAR(200)    NOT NULL,
        Description     NVARCHAR(MAX)    NULL,
        Status          VARCHAR(20)      NOT NULL DEFAULT 'draft',  -- draft|open|closed
        SchemaJson      NVARCHAR(MAX)    NOT NULL DEFAULT '{"fields":[]}', -- JSON: { fields: FormField[] }
                                                    -- (named SchemaJson, not "Schema" -- SCHEMA is a
                                                    -- reserved T-SQL keyword and breaks CREATE TABLE)
        SuccessMessage  NVARCHAR(MAX)    NULL,
        CreatedBy       UNIQUEIDENTIFIER NULL,
        CreatedAt       DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        UpdatedAt       DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_Forms PRIMARY KEY (Id),
        CONSTRAINT UQ_Forms_Slug UNIQUE (Slug),
        CONSTRAINT FK_Forms_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES Users(Id),
        CONSTRAINT CK_Forms_Status CHECK (Status IN ('draft','open','closed')),
        CONSTRAINT CK_Forms_SchemaJson_IsJson CHECK (ISJSON(SchemaJson) = 1)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'FormSubmissions')
BEGIN
    CREATE TABLE FormSubmissions (
        Id                UNIQUEIDENTIFIER NOT NULL DEFAULT NEWSEQUENTIALID(),
        FormId            INT              NOT NULL,
        SubmittedByUserId UNIQUEIDENTIFIER NULL,
        Data              NVARCHAR(MAX)    NOT NULL,   -- JSON: { [fieldKey]: value }
        Status            VARCHAR(20)      NOT NULL DEFAULT 'new',  -- new|reviewed|approved|rejected
        AdminNotes        NVARCHAR(MAX)    NULL,
        SubmittedAt       DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        DecidedAt         DATETIME2        NULL,
        DecidedBy         UNIQUEIDENTIFIER NULL,
        CONSTRAINT PK_FormSubmissions PRIMARY KEY (Id),
        CONSTRAINT FK_FS_Form    FOREIGN KEY (FormId)            REFERENCES Forms(Id),
        CONSTRAINT FK_FS_User    FOREIGN KEY (SubmittedByUserId) REFERENCES Users(Id),
        CONSTRAINT FK_FS_Decider FOREIGN KEY (DecidedBy)         REFERENCES Users(Id),
        CONSTRAINT CK_FS_Status  CHECK (Status IN ('new','reviewed','approved','rejected')),
        CONSTRAINT CK_FS_Data_IsJson CHECK (ISJSON(Data) = 1)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FormSubmissions_Form' AND object_id = OBJECT_ID('FormSubmissions'))
    CREATE INDEX IX_FormSubmissions_Form ON FormSubmissions (FormId);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FormSubmissions_Status' AND object_id = OBJECT_ID('FormSubmissions'))
    CREATE INDEX IX_FormSubmissions_Status ON FormSubmissions (Status);
GO
