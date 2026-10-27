-- ============================================================
-- Migration 025 - per-course syllabus link on the submit form
-- ------------------------------------------------------------
-- The student can attach a syllabus file and/or a catalogue URL to each course when submitting.
--   * Syllabi.UploadId   - the Uploads row (blob) the student attached (Syllabi.FileStoragePath keeps
--                          the blob name for older readers)
--   * Syllabi.CatalogUrl - optional public catalogue / syllabus page for that course
-- Idempotent: each column is added only when missing. The API checks for these columns and degrades
-- (file still counted through TranscriptDocuments, URL ignored) until this is applied.
-- ============================================================
USE TransferHubDB;
GO

IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Syllabi')
BEGIN
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Syllabi') AND name = 'UploadId')
        ALTER TABLE Syllabi ADD UploadId UNIQUEIDENTIFIER NULL;
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Syllabi') AND name = 'CatalogUrl')
        ALTER TABLE Syllabi ADD CatalogUrl NVARCHAR(500) NULL;
END
GO
