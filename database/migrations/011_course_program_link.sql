-- ============================================================
-- Migration 011 – Real Program > Course hierarchy
-- ============================================================
-- Resolves the user's "do we need a Program concept?" question: the
-- `Programs` table has existed since migration 003 (and is seeded in
-- seed/007 from the workbook's Programs sheet — 15 rows, 3 universities x
-- 5 program areas), but `Courses` only linked to it loosely via a
-- free-text `ProgramArea` string matched by convention, not a real FK.
--
-- This makes the hierarchy real and enforced:
--   University (Institutions) > Program (Programs) > Course (Courses) > Topic (CourseTopics)
-- Credits stay on Course (per course, not per program) as today.
--
-- `Courses.ProgramArea` is kept (not dropped) as a legacy/display column —
-- some rows may not backfill cleanly (e.g. a ProgramArea string with no
-- matching Programs row for that institution yet), so dropping it would
-- silently lose data. ProgramId is nullable for the same reason: a course
-- without a confirmed Program match stays usable, just unlinked until an
-- admin assigns one via the UI.
-- Guarded so this migration is safe to re-run (e.g. a migration-runner
-- tool re-applying scripts that already succeeded) — each step checks
-- whether it already exists before creating it, rather than erroring.
USE CreditEvalManager;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Courses') AND name = 'ProgramId')
    ALTER TABLE Courses ADD ProgramId INT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_Courses_Program')
    ALTER TABLE Courses ADD CONSTRAINT FK_Courses_Program FOREIGN KEY (ProgramId) REFERENCES Programs(Id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Courses_ProgramId' AND object_id = OBJECT_ID('Courses'))
    CREATE INDEX IX_Courses_ProgramId ON Courses (ProgramId);
GO

-- Backfill: match each course to the Program row for the same
-- institution whose Area equals the course's existing ProgramArea text.
UPDATE c
SET c.ProgramId = p.Id
FROM Courses c
JOIN Programs p ON p.InstitutionId = c.InstitutionId AND p.Area = c.ProgramArea
WHERE c.ProgramId IS NULL AND c.ProgramArea IS NOT NULL;
GO
