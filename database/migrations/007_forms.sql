-- ============================================================
-- Migration 007 – Custom Forms (JSON-schema driven, admin-built)
-- ============================================================
-- Mirrors the "forms" content pattern from SKPTrust: a form's field list
-- is stored as a single JSON schema column rather than one table per
-- form. Submissions store their answers as JSON keyed by field, so new
-- forms never require a schema migration.
-- ============================================================
USE CreditEvalManager;
GO

CREATE TABLE Forms (
    Id              INT              NOT NULL IDENTITY(1,1),
    Slug            VARCHAR(150)     NOT NULL,
    Title           NVARCHAR(200)    NOT NULL,
    Description     NVARCHAR(MAX)    NULL,
    Status          VARCHAR(20)      NOT NULL DEFAULT 'draft',  -- draft|open|closed
    Schema          NVARCHAR(MAX)    NOT NULL DEFAULT '{"fields":[]}', -- JSON: { fields: FormField[] }
    SuccessMessage  NVARCHAR(MAX)    NULL,
    CreatedBy       UNIQUEIDENTIFIER NULL,
    CreatedAt       DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
    UpdatedAt       DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_Forms PRIMARY KEY (Id),
    CONSTRAINT UQ_Forms_Slug UNIQUE (Slug),
    CONSTRAINT FK_Forms_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES Users(Id),
    CONSTRAINT CK_Forms_Status CHECK (Status IN ('draft','open','closed')),
    CONSTRAINT CK_Forms_Schema_IsJson CHECK (ISJSON(Schema) = 1)
);
GO

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
GO

CREATE INDEX IX_FormSubmissions_Form ON FormSubmissions (FormId);
CREATE INDEX IX_FormSubmissions_Status ON FormSubmissions (Status);
GO
