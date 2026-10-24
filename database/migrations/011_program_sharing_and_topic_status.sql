-- ============================================================
-- Migration 011 - Program/University/Course sharing + per-University
-- Topic active/inactive status
-- ============================================================
-- Closes a gap in the Universities > Programs > Courses > Topics
-- hierarchy, per explicit user request:
--   - A Program can now be offered by more than one University.
--   - A Program can pull in Courses from more than one Program/University
--     (many-to-many, not just the single Courses.ProgramId it had before).
--   - A Topic's active/inactive status can now be overridden per
--     University, independent of which Program pulled the course in.
--
-- Design decisions (confirmed explicitly, see CLAUDE.md):
--   - Programs.InstitutionId remains the Program's "owning" University
--     (who created/manages it) -- NOT removed. ProgramUniversities adds
--     the list of (possibly additional) Universities it's shared with,
--     and is backfilled so the owner is always included in it too --
--     "every University offering this Program" is always just
--     `SELECT * FROM ProgramUniversities WHERE ProgramId = @id`, no need
--     to special-case the owner in queries.
--   - Courses.ProgramId is left in place (existing display/report
--     queries, e.g. the course catalog's "Program" column and the
--     university page generator, keep working unchanged) but is no
--     longer the sole source of truth for Program membership --
--     ProgramCourses is the many-to-many join the new Program-management
--     UI reads/writes.
--   - UniversityTopicStatus is per (University, Topic), not per
--     (Program, University, Topic) -- a topic's active state for a given
--     University is the same everywhere that University sees it. Absence
--     of a row means active (default), matching the "absence = allowed"
--     convention RolePermissions already uses elsewhere in this schema.
--
-- Idempotent: safe to re-run (IF NOT EXISTS guards throughout, matching
-- every other consolidated migration file).
-- ============================================================
USE CreditEvalManager;
GO

-- ─── ProgramUniversities ────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ProgramUniversities')
BEGIN
    CREATE TABLE ProgramUniversities (
        ProgramId     INT       NOT NULL,
        InstitutionId INT       NOT NULL,
        CreatedAt     DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_ProgramUniversities PRIMARY KEY (ProgramId, InstitutionId),
        CONSTRAINT FK_ProgramUniversities_Program FOREIGN KEY (ProgramId) REFERENCES Programs(Id) ON DELETE CASCADE,
        CONSTRAINT FK_ProgramUniversities_Institution FOREIGN KEY (InstitutionId) REFERENCES Institutions(Id)
    );
END
GO

-- Backfill: every existing Program is, at minimum, offered by its own
-- owning University (Programs.InstitutionId).
INSERT INTO ProgramUniversities (ProgramId, InstitutionId)
SELECT p.Id, p.InstitutionId
FROM Programs p
WHERE NOT EXISTS (
    SELECT 1 FROM ProgramUniversities pu WHERE pu.ProgramId = p.Id AND pu.InstitutionId = p.InstitutionId
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ProgramUniversities_Institution' AND object_id = OBJECT_ID('ProgramUniversities'))
    CREATE INDEX IX_ProgramUniversities_Institution ON ProgramUniversities (InstitutionId);
GO

-- ─── ProgramCourses ─────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ProgramCourses')
BEGIN
    CREATE TABLE ProgramCourses (
        ProgramId INT       NOT NULL,
        CourseId  INT       NOT NULL,
        CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_ProgramCourses PRIMARY KEY (ProgramId, CourseId),
        CONSTRAINT FK_ProgramCourses_Program FOREIGN KEY (ProgramId) REFERENCES Programs(Id) ON DELETE CASCADE,
        CONSTRAINT FK_ProgramCourses_Course FOREIGN KEY (CourseId) REFERENCES Courses(Id) ON DELETE CASCADE
    );
END
GO

-- Backfill from the existing single Courses.ProgramId FK.
INSERT INTO ProgramCourses (ProgramId, CourseId)
SELECT c.ProgramId, c.Id
FROM Courses c
WHERE c.ProgramId IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM ProgramCourses pc WHERE pc.ProgramId = c.ProgramId AND pc.CourseId = c.Id);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ProgramCourses_Course' AND object_id = OBJECT_ID('ProgramCourses'))
    CREATE INDEX IX_ProgramCourses_Course ON ProgramCourses (CourseId);
GO

-- ─── UniversityTopicStatus ──────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'UniversityTopicStatus')
BEGIN
    CREATE TABLE UniversityTopicStatus (
        InstitutionId INT              NOT NULL,
        TopicId       INT              NOT NULL,
        IsActive      BIT              NOT NULL DEFAULT 1,
        UpdatedAt     DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        UpdatedBy     UNIQUEIDENTIFIER NULL,
        CONSTRAINT PK_UniversityTopicStatus PRIMARY KEY (InstitutionId, TopicId),
        CONSTRAINT FK_UTS_Institution FOREIGN KEY (InstitutionId) REFERENCES Institutions(Id),
        CONSTRAINT FK_UTS_Topic FOREIGN KEY (TopicId) REFERENCES CourseTopics(Id) ON DELETE CASCADE,
        CONSTRAINT FK_UTS_UpdatedBy FOREIGN KEY (UpdatedBy) REFERENCES Users(Id)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_UniversityTopicStatus_Topic' AND object_id = OBJECT_ID('UniversityTopicStatus'))
    CREATE INDEX IX_UniversityTopicStatus_Topic ON UniversityTopicStatus (TopicId);
GO
