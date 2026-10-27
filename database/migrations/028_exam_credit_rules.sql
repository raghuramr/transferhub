-- ============================================================
-- Migration 028 - Exam credit thresholds (AP / IB / CLEP / A-level)
-- ============================================================
-- Adds:
--   * ExamCreditRules   per-university minimum scores: an exam counts toward the external-credit
--                       cap only when the student's score is at least MinScore. InstitutionId NULL
--                       = the global default; a university with its own rules for an exam type
--                       uses only those. SubjectPattern NULL = any subject; '|' separates
--                       alternatives, matched as whole words ('HL|Higher Level').
--                       MinScore is text because the scale differs per exam: AP 1-5, IB 1-7,
--                       CLEP 20-80, A-level A*-E (the code maps letters to an ordinal).
--                       CreditsAwarded NULL = unknown (a reviewer sets it).
--   * StudentExamCredits.ExamType now also allows 'CLEP' (the 015 constraint only had AP/IB/A-level).
-- Idempotent and non-destructive. Reserved-word care: no column is called Key/Order/Type/Open/Schema.
-- ============================================================
USE TransferHubDB;
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ExamCreditRules')
BEGIN
    CREATE TABLE ExamCreditRules (
        Id             INT           NOT NULL IDENTITY(1,1),
        InstitutionId  INT           NULL,                 -- NULL = global default
        ExamType       VARCHAR(10)   NOT NULL,
        SubjectPattern NVARCHAR(150) NULL,                 -- NULL = any subject
        MinScore       VARCHAR(10)   NOT NULL,
        CreditsAwarded DECIMAL(5,2)  NULL,
        IsActive       BIT           NOT NULL CONSTRAINT DF_ECR_IsActive DEFAULT 1,
        Notes          NVARCHAR(300) NULL,
        CreatedAt      DATETIME2     NOT NULL CONSTRAINT DF_ECR_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAt      DATETIME2     NOT NULL CONSTRAINT DF_ECR_UpdatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_ExamCreditRules PRIMARY KEY (Id),
        CONSTRAINT FK_ECR_Institution FOREIGN KEY (InstitutionId) REFERENCES Institutions(Id),
        CONSTRAINT CK_ECR_ExamType CHECK (ExamType IN ('AP','IB','A-level','CLEP'))
    );
    CREATE UNIQUE INDEX UX_ECR_Rule ON ExamCreditRules (InstitutionId, ExamType, SubjectPattern);
END
GO

-- Allow CLEP on the student's own exam list.
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_SEC_Type' AND definition NOT LIKE '%CLEP%')
BEGIN
    ALTER TABLE StudentExamCredits DROP CONSTRAINT CK_SEC_Type;
    ALTER TABLE StudentExamCredits ADD CONSTRAINT CK_SEC_Type CHECK (ExamType IN ('AP','IB','A-level','CLEP'));
END
GO

PRINT 'Migration 028 applied: exam credit rules.';
GO
