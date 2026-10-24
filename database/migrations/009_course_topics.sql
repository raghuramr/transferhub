-- ============================================================
-- Migration 009 – Course Topics (detailed syllabus-level matching)
-- ============================================================
-- Lets admin/faculty staff break a Course down into topics, each with its
-- own reference links (syllabus PDF, catalog page, etc.). This gives the
-- AI matcher (future work — see CLAUDE.md) finer-grained material to
-- compare across institutions than the Course-level Description alone.
-- Content unchanged from the original 009_course_topics.sql, made
-- idempotent.
-- ============================================================
USE CreditEvalManager;
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CourseTopics')
BEGIN
    CREATE TABLE CourseTopics (
        Id                 INT              NOT NULL IDENTITY(1,1),
        CourseId           INT              NOT NULL,
        Title              NVARCHAR(200)    NOT NULL,
        Description        NVARCHAR(MAX)    NULL,
        SortOrder          INT              NOT NULL DEFAULT 0,
        ReferenceLinksJson NVARCHAR(MAX)    NULL,   -- JSON array of {label, url}
        CreatedBy          UNIQUEIDENTIFIER NULL,
        UpdatedBy          UNIQUEIDENTIFIER NULL,
        CreatedAt          DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        UpdatedAt          DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_CourseTopics PRIMARY KEY (Id),
        CONSTRAINT FK_CourseTopics_Course FOREIGN KEY (CourseId) REFERENCES Courses(Id) ON DELETE CASCADE,
        CONSTRAINT FK_CourseTopics_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES Users(Id),
        CONSTRAINT FK_CourseTopics_UpdatedBy FOREIGN KEY (UpdatedBy) REFERENCES Users(Id),
        CONSTRAINT CK_CourseTopics_LinksJson CHECK (ReferenceLinksJson IS NULL OR ISJSON(ReferenceLinksJson) = 1)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_CourseTopics_CourseId' AND object_id = OBJECT_ID('CourseTopics'))
    CREATE INDEX IX_CourseTopics_CourseId ON CourseTopics (CourseId);
GO
