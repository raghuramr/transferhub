-- ============================================================
-- Migration 033 - Target program on a transfer request
-- ============================================================
-- A student says which program they want to join when they submit, not only which university.
-- Transcripts.TargetInstitutionId already exists (migration 013); this adds the program beside it.
-- Idempotent.
-- ============================================================
USE TransferHubDB;
GO

IF COL_LENGTH('Transcripts', 'TargetProgramId') IS NULL
    ALTER TABLE Transcripts ADD TargetProgramId INT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_Transcripts_TargetProgram')
   AND COL_LENGTH('Transcripts', 'TargetProgramId') IS NOT NULL
    ALTER TABLE Transcripts ADD CONSTRAINT FK_Transcripts_TargetProgram
        FOREIGN KEY (TargetProgramId) REFERENCES Programs(Id);
GO
