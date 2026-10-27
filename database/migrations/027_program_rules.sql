-- ============================================================
-- Migration 027 - Programme rules (PRG-03..08)
-- ============================================================
-- ProgramRules: per university (InstitutionId) and optionally per Program (ProgramId NULL = every programme of the
-- university) requirements such as "CS 320 must be taken at BU" or "at most 4 transferred courses at 200+ level".
-- The engine (policy/programme-rules.service.ts) only raises FLAGS on a student's transcript courses (stored in
-- TranscriptCourses.PolicyFlags): it routes a course to department review or explains something, it never denies.
--   RuleType:
--     max_transfer_at_level    LevelMin + MaxCount  (e.g. Economics: max 4 courses at 200+)
--     min_at_home              MinCount + CourseCodePattern (+ ParamsJson.excludeCodes)
--     required_at_home         CourseCodePattern (ParamsJson.enforcement = 'info' softens it to an explanation)
--     substitution             CourseCodePattern (the substitutes) + SubstituteFor (the required course)
--     not_principal            CourseCodePattern
--     residency_courses_count  MinCount and/or MaxCount (+ optional CourseCodePattern)
-- ParamsJson is free-form settings (validated as JSON) for anything the typed columns do not cover.
-- Idempotent.
-- ============================================================
USE TransferHubDB;
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ProgramRules')
BEGIN
    CREATE TABLE ProgramRules (
        Id                INT            NOT NULL IDENTITY(1,1),
        InstitutionId     INT            NOT NULL,
        ProgramId         INT            NULL,          -- NULL = all programmes of the university
        RuleCode          VARCHAR(20)    NULL,          -- workbook reference, e.g. PRG-04
        RuleType          VARCHAR(30)    NOT NULL,
        LevelMin          INT            NULL,
        MaxCount          INT            NULL,
        MinCount          INT            NULL,
        CourseCodePattern NVARCHAR(200)  NULL,          -- 'CS 320|CS 332' or a department 'BI'
        SubstituteFor     NVARCHAR(100)  NULL,
        ParamsJson        NVARCHAR(MAX)  NULL,
        Description       NVARCHAR(500)  NOT NULL,
        IsActive          BIT            NOT NULL DEFAULT 1,
        CreatedAt         DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
        UpdatedAt         DATETIME2      NULL,
        UpdatedBy         UNIQUEIDENTIFIER NULL,
        CONSTRAINT PK_ProgramRules PRIMARY KEY (Id),
        CONSTRAINT FK_ProgramRules_Institution FOREIGN KEY (InstitutionId) REFERENCES Institutions(Id),
        CONSTRAINT FK_ProgramRules_Program     FOREIGN KEY (ProgramId)     REFERENCES Programs(Id),
        CONSTRAINT FK_ProgramRules_UpdatedBy   FOREIGN KEY (UpdatedBy)     REFERENCES Users(Id),
        CONSTRAINT CK_ProgramRules_Type CHECK (RuleType IN
            ('max_transfer_at_level','min_at_home','required_at_home','substitution','not_principal','residency_courses_count')),
        CONSTRAINT CK_ProgramRules_Json   CHECK (ParamsJson IS NULL OR ISJSON(ParamsJson) = 1),
        CONSTRAINT CK_ProgramRules_Counts CHECK ((LevelMin IS NULL OR LevelMin >= 0) AND (MaxCount IS NULL OR MaxCount >= 0) AND (MinCount IS NULL OR MinCount >= 0))
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ProgramRules_Scope' AND object_id = OBJECT_ID('ProgramRules'))
    CREATE INDEX IX_ProgramRules_Scope ON ProgramRules (InstitutionId, ProgramId, IsActive);
GO
