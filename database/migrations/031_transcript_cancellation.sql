-- ============================================================
-- Migration 031 - Student can cancel a transfer request
-- ============================================================
-- Adds a 'cancelled' status (Transcripts.Status and WorkflowStatus) plus who/why/when and a progress
-- snapshot (how many courses were decided, credits awarded, stages completed) taken at cancellation.
-- Idempotent.
-- ============================================================
USE TransferHubDB;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Transcripts') AND name = 'CancelledAt')
    ALTER TABLE Transcripts ADD CancelledAt DATETIME2 NULL;
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Transcripts') AND name = 'CancelReason')
    ALTER TABLE Transcripts ADD CancelReason NVARCHAR(60) NULL;
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Transcripts') AND name = 'CancelNote')
    ALTER TABLE Transcripts ADD CancelNote NVARCHAR(1000) NULL;
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Transcripts') AND name = 'CancelProgress')
    ALTER TABLE Transcripts ADD CancelProgress NVARCHAR(1000) NULL;   -- JSON snapshot
GO

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Trans_Status')
    ALTER TABLE Transcripts DROP CONSTRAINT CK_Trans_Status;
ALTER TABLE Transcripts ADD CONSTRAINT CK_Trans_Status CHECK (Status IN ('received','processing','complete','cancelled'));
GO

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Trans_WorkflowStatus')
    ALTER TABLE Transcripts DROP CONSTRAINT CK_Trans_WorkflowStatus;
ALTER TABLE Transcripts ADD CONSTRAINT CK_Trans_WorkflowStatus
    CHECK (WorkflowStatus IS NULL OR WorkflowStatus IN ('active','approved','rejected','bypassed','cancelled'));
GO
