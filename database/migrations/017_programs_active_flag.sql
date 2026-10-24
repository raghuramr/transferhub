-- Adds a soft-delete flag to Programs so they can be deactivated instead of
-- hard-deleted (Courses.ProgramId references Programs and must keep
-- resolving for historical courses). Mirrors the IsActive pattern already
-- used on Institutions/AcademicUnits.
-- Idempotent: safe to re-run.

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Programs') AND name = 'IsActive')
    ALTER TABLE Programs ADD IsActive BIT NOT NULL CONSTRAINT DF_Programs_IsActive DEFAULT 1;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Programs') AND name = 'UpdatedAt')
    ALTER TABLE Programs ADD UpdatedAt DATETIME2 NULL;
GO
