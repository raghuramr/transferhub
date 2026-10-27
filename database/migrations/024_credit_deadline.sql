-- ============================================================
-- Migration 024 - Credit deadline (PRG-02)
-- ============================================================
-- All transfer credit must be transferred within ONE YEAR of starting at the
-- university. The deadline itself is computed in code (policy/credit-deadline.ts)
-- from the student's entry term, so it is never stored; this migration only adds:
--   * TransferPolicies.CreditDeadlineMonths  months allowed (default 12), per university
--   * StudentProfiles.StartDate              actual start date when known (overrides
--                                            the entry-term default)
--   * CreditDeadlineNotices                  one row per (request, threshold) so a
--                                            reminder (90/30/7 days, overdue) is sent once
-- Idempotent and non-destructive. Reserved-word care: no column is called
-- Key/Order/Type/Open/Schema (the threshold column is ThresholdKey).
-- ============================================================
USE TransferHubDB;
GO

IF COL_LENGTH('TransferPolicies', 'CreditDeadlineMonths') IS NULL
    ALTER TABLE TransferPolicies ADD CreditDeadlineMonths INT NOT NULL
        CONSTRAINT DF_TP_CreditDeadlineMonths DEFAULT 12;
GO
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_TP_CreditDeadlineMonths')
    ALTER TABLE TransferPolicies ADD CONSTRAINT CK_TP_CreditDeadlineMonths CHECK (CreditDeadlineMonths BETWEEN 1 AND 120);
GO

IF COL_LENGTH('StudentProfiles', 'StartDate') IS NULL
    ALTER TABLE StudentProfiles ADD StartDate DATE NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CreditDeadlineNotices')
BEGIN
    CREATE TABLE CreditDeadlineNotices (
        Id             INT          NOT NULL IDENTITY(1,1),
        TranscriptId   UNIQUEIDENTIFIER NOT NULL,
        ThresholdKey   VARCHAR(10)  NOT NULL,                 -- '90' | '30' | '7' | 'overdue'
        SentAt         DATETIME2    NOT NULL DEFAULT SYSUTCDATETIME(),
        Recipients     INT          NOT NULL DEFAULT 0,       -- how many emails were attempted
        CONSTRAINT PK_CreditDeadlineNotices PRIMARY KEY (Id),
        CONSTRAINT FK_CDN_Transcript FOREIGN KEY (TranscriptId) REFERENCES Transcripts(Id) ON DELETE CASCADE,
        CONSTRAINT UX_CDN_Transcript_Threshold UNIQUE (TranscriptId, ThresholdKey),
        CONSTRAINT CK_CDN_Threshold CHECK (ThresholdKey IN ('90','30','7','overdue'))
    );
END
GO
