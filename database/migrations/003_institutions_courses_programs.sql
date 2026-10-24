-- ============================================================
-- Migration 003 – Institutions (Universities), Programs & Courses
-- ============================================================
-- Consolidated entity file (see CLAUDE.md "DB Script Runner tool" section).
-- Naming note: this `Institutions` table is what the product UI calls
-- "Universities" (BU, Northeastern, NYU, …). The UI's "Institutions"
-- (schools/colleges within a university) is the separate `AcademicUnits`
-- table, created in the Universities/Institutions/Agencies migration.
--
-- Covers: Institutions (Universities), Programs (+ IsActive/UpdatedAt),
-- Courses (+ ProgramId link), Equivalencies.
-- LogoUrl/HeroImageUrl are NOT added to Institutions here — those are
-- grouped with the Universities/Institutions/Agencies migration where
-- AcademicUnits also gets them, since both columns were introduced
-- together as part of that same branding/public-page feature.
-- ============================================================
USE TransferHubDB;
GO

-- ─── Institutions ("Universities" in the UI) ────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Institutions')
BEGIN
    CREATE TABLE Institutions (
        Id          INT            NOT NULL IDENTITY(1,1),
        Code        VARCHAR(20)    NOT NULL,   -- e.g. BU, NU, NYU, BSCC
        Name        NVARCHAR(200)  NOT NULL,
        Calendar    VARCHAR(10)    NOT NULL DEFAULT 'semester', -- semester | quarter
        Type        VARCHAR(30)    NOT NULL DEFAULT 'university', -- university | community_college
        IsBU        BIT            NOT NULL DEFAULT 0,  -- the receiving institution
        IsActive    BIT            NOT NULL DEFAULT 1,
        Source      NVARCHAR(500)  NULL,       -- catalog URL
        CreatedAt   DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_Institutions PRIMARY KEY (Id),
        CONSTRAINT UQ_Institutions_Code UNIQUE (Code),
        CONSTRAINT CK_Institutions_Calendar CHECK (Calendar IN ('semester','quarter')),
        CONSTRAINT CK_Institutions_Type CHECK (Type IN ('university','community_college'))
    );
END
GO

-- ─── Programs ────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Programs')
BEGIN
    CREATE TABLE Programs (
        Id              INT            NOT NULL IDENTITY(1,1),
        InstitutionId   INT            NOT NULL,
        Area            NVARCHAR(100)  NOT NULL,  -- Computer Science, Economics …
        Name            NVARCHAR(200)  NOT NULL,
        Degree          VARCHAR(10)    NULL,       -- BA, BS …
        School          NVARCHAR(200)  NULL,
        KeyRules        NVARCHAR(MAX)  NULL,
        Source          NVARCHAR(500)  NULL,
        MatchStrength   VARCHAR(20)    NULL,       -- Strong | Moderate (vs BU)
        Notes           NVARCHAR(MAX)  NULL,
        IsActive        BIT            NOT NULL DEFAULT 1,
        CreatedAt       DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
        UpdatedAt       DATETIME2      NULL,
        CONSTRAINT PK_Programs PRIMARY KEY (Id),
        CONSTRAINT FK_Programs_Institutions FOREIGN KEY (InstitutionId) REFERENCES Institutions(Id)
    );
END
GO

-- Upgrade path: Programs exists from the old 003 migration but is missing
-- migration 017's soft-delete flag.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Programs') AND name = 'IsActive')
    ALTER TABLE Programs ADD IsActive BIT NOT NULL CONSTRAINT DF_Programs_IsActive DEFAULT 1;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Programs') AND name = 'UpdatedAt')
    ALTER TABLE Programs ADD UpdatedAt DATETIME2 NULL;
GO

-- ─── Courses ─────────────────────────────────────────────────
-- ProgramId links a Course to a Program (migration 011). Nullable and
-- never backfilled with a hard requirement — a course without a confirmed
-- Program match stays usable, just unlinked until an admin assigns one.
-- ProgramArea (free-text, legacy/display) is kept alongside it.
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Courses')
BEGIN
    CREATE TABLE Courses (
        Id              INT            NOT NULL IDENTITY(1,1),
        InstitutionId   INT            NOT NULL,
        Code            NVARCHAR(30)   NOT NULL,  -- e.g. CAS CS 111, CS 2000
        Title           NVARCHAR(300)  NOT NULL,
        ProgramArea     NVARCHAR(100)  NULL,      -- Computer Science … (legacy/display)
        ProgramId       INT            NULL,      -- real FK to Programs(Id)
        RequirementType NVARCHAR(100)  NULL,      -- Core (Group A), Required …
        Credits         DECIMAL(5,2)   NOT NULL DEFAULT 4,
        Description     NVARCHAR(MAX)  NULL,
        LearningOutcomes NVARCHAR(MAX) NULL,      -- JSON array or plain text
        Level           VARCHAR(20)    NULL,       -- intro | lower | upper
        Verified        VARCHAR(10)    NOT NULL DEFAULT 'Yes', -- Yes | Check
        Notes           NVARCHAR(500)  NULL,
        Source          NVARCHAR(500)  NULL,
        IsActive        BIT            NOT NULL DEFAULT 1,
        CreatedAt       DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
        UpdatedAt       DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_Courses PRIMARY KEY (Id),
        CONSTRAINT FK_Courses_Institutions FOREIGN KEY (InstitutionId) REFERENCES Institutions(Id),
        CONSTRAINT FK_Courses_Program FOREIGN KEY (ProgramId) REFERENCES Programs(Id),
        CONSTRAINT UQ_Courses_Institution_Code UNIQUE (InstitutionId, Code)
    );
END
GO

-- Upgrade path: Courses exists from the old 003 migration but is missing
-- migration 011's ProgramId link.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Courses') AND name = 'ProgramId')
    ALTER TABLE Courses ADD ProgramId INT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_Courses_Program')
    ALTER TABLE Courses ADD CONSTRAINT FK_Courses_Program FOREIGN KEY (ProgramId) REFERENCES Programs(Id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Courses_InstitutionId' AND object_id = OBJECT_ID('Courses'))
    CREATE INDEX IX_Courses_InstitutionId ON Courses (InstitutionId);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Courses_ProgramArea' AND object_id = OBJECT_ID('Courses'))
    CREATE INDEX IX_Courses_ProgramArea ON Courses (ProgramArea);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Courses_ProgramId' AND object_id = OBJECT_ID('Courses'))
    CREATE INDEX IX_Courses_ProgramId ON Courses (ProgramId);
GO

-- Backfill (idempotent — only touches rows that still need it): match each
-- course to the Program row for the same institution whose Area equals the
-- course's existing ProgramArea text.
UPDATE c
SET c.ProgramId = p.Id
FROM Courses c
JOIN Programs p ON p.InstitutionId = c.InstitutionId AND p.Area = c.ProgramArea
WHERE c.ProgramId IS NULL AND c.ProgramArea IS NOT NULL;
GO

-- ─── Equivalency Database ────────────────────────────────────
-- Stores confirmed course matches.  Source of truth for the auto-apply path.
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Equivalencies')
BEGIN
    CREATE TABLE Equivalencies (
        Id              INT              NOT NULL IDENTITY(1,1),
        ExternalCourseId INT             NOT NULL,
        BUCourseId      INT              NOT NULL,
        Outcome         VARCHAR(20)      NOT NULL,  -- equivalent | elective | no_credit | bu_only
        BUCredits       DECIMAL(5,2)     NULL,       -- if different from BU course credits
        MatchLevel      VARCHAR(40)      NULL,       -- Likely equivalent | Partial … (workbook)
        Rationale       NVARCHAR(MAX)    NULL,
        Source          VARCHAR(20)      NOT NULL DEFAULT 'evaluator', -- evaluator | workbook | synthetic
        DecidedBy       UNIQUEIDENTIFIER NULL,       -- FK Users.Id
        DecidedAt       DATETIME2        NULL,
        IsActive        BIT              NOT NULL DEFAULT 1,
        CreatedAt       DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_Equivalencies PRIMARY KEY (Id),
        CONSTRAINT FK_Equiv_External FOREIGN KEY (ExternalCourseId) REFERENCES Courses(Id),
        CONSTRAINT FK_Equiv_BU       FOREIGN KEY (BUCourseId)       REFERENCES Courses(Id),
        CONSTRAINT FK_Equiv_Decided  FOREIGN KEY (DecidedBy)        REFERENCES Users(Id),
        CONSTRAINT CK_Equiv_Outcome  CHECK (Outcome IN ('equivalent','elective','no_credit','bu_only'))
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Equiv_ExternalCourse' AND object_id = OBJECT_ID('Equivalencies'))
    CREATE INDEX IX_Equiv_ExternalCourse ON Equivalencies (ExternalCourseId);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Equiv_BUCourse' AND object_id = OBJECT_ID('Equivalencies'))
    CREATE INDEX IX_Equiv_BUCourse ON Equivalencies (BUCourseId);
GO
