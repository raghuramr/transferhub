-- ============================================================
-- Migration 008 – Universities/Institutions split, Agencies, scope visibility
-- ============================================================
-- Naming note (see CLAUDE.md): the existing `Institutions` table already
-- models what the product now calls "Universities" (BU, Northeastern, NYU
-- + future community colleges) -- NOT renamed here to avoid an invasive
-- break across Courses/Transcripts/Equivalencies/ai.service.ts, all of
-- which already reference Institutions(Id). It is simply relabeled
-- "Universities" in the UI/API-facing text.
--
-- The genuinely NEW entity the product calls "Institutions" is a school
-- or college WITHIN a university (e.g. "College of Arts & Sciences",
-- "Khoury College of Computer Sciences") -- sourced from the workbook's
-- Programs sheet ("BU school" / "NU college" / "NYU school" columns).
-- That table is named AcademicUnits here to avoid a name collision with
-- the existing Institutions table, but is labeled "Institutions" in the
-- UI everywhere a user sees it.
-- ============================================================
USE CreditEvalManager;
GO

-- ─── Agencies ────────────────────────────────────────────────
-- Formalizes the external partner-agency concept. Users.AgencyName stays
-- as a free-text display fallback; AgencyId is the real FK going forward.
CREATE TABLE Agencies (
    Id            INT              NOT NULL IDENTITY(1,1),
    Name          NVARCHAR(200)    NOT NULL,
    ContactEmail  NVARCHAR(254)    NULL,
    ContactPhone  NVARCHAR(50)     NULL,
    Country       NVARCHAR(100)    NULL,
    IsActive      BIT              NOT NULL DEFAULT 1,
    CreatedAt     DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
    UpdatedAt     DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_Agencies PRIMARY KEY (Id),
    CONSTRAINT UQ_Agencies_Name UNIQUE (Name)
);
GO

-- ─── AcademicUnits ("Institutions" in the UI) ───────────────
CREATE TABLE AcademicUnits (
    Id            INT              NOT NULL IDENTITY(1,1),
    InstitutionId INT              NOT NULL,   -- the "University" (existing Institutions table)
    Name          NVARCHAR(200)    NOT NULL,   -- e.g. "College of Arts & Sciences"
    Code          VARCHAR(30)      NULL,
    IsActive      BIT              NOT NULL DEFAULT 1,
    CreatedAt     DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
    UpdatedAt     DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_AcademicUnits PRIMARY KEY (Id),
    CONSTRAINT FK_AcademicUnits_Institution FOREIGN KEY (InstitutionId) REFERENCES Institutions(Id),
    CONSTRAINT UQ_AcademicUnits_Inst_Name UNIQUE (InstitutionId, Name)
);
GO

CREATE INDEX IX_AcademicUnits_Institution ON AcademicUnits (InstitutionId);
GO

-- ─── Users.AgencyId FK (keep AgencyName text for back-compat) ─
-- Guarded so this migration is safe to re-run (e.g. a migration-runner tool
-- re-applying scripts that already succeeded) -- matches the pattern used
-- in migration 011.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Users') AND name = 'AgencyId')
    ALTER TABLE Users ADD AgencyId INT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_Users_Agency')
    ALTER TABLE Users ADD CONSTRAINT FK_Users_Agency FOREIGN KEY (AgencyId) REFERENCES Agencies(Id);
GO

-- ─── Scope visibility ────────────────────────────────────────
-- Which Universities / Institutions (AcademicUnits) / Agencies a user can
-- see and act on. No rows for a user = unrestricted (sees everything) --
-- this keeps existing demo users working unchanged after this migration.
CREATE TABLE UserScopeUniversities (
    UserId        UNIQUEIDENTIFIER NOT NULL,
    InstitutionId INT              NOT NULL,
    CreatedAt     DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_UserScopeUniversities PRIMARY KEY (UserId, InstitutionId),
    CONSTRAINT FK_USU_User FOREIGN KEY (UserId) REFERENCES Users(Id) ON DELETE CASCADE,
    CONSTRAINT FK_USU_Institution FOREIGN KEY (InstitutionId) REFERENCES Institutions(Id)
);
GO

CREATE TABLE UserScopeAcademicUnits (
    UserId         UNIQUEIDENTIFIER NOT NULL,
    AcademicUnitId INT              NOT NULL,
    CreatedAt      DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_UserScopeAcademicUnits PRIMARY KEY (UserId, AcademicUnitId),
    CONSTRAINT FK_USAU_User FOREIGN KEY (UserId) REFERENCES Users(Id) ON DELETE CASCADE,
    CONSTRAINT FK_USAU_AcademicUnit FOREIGN KEY (AcademicUnitId) REFERENCES AcademicUnits(Id)
);
GO

CREATE TABLE UserScopeAgencies (
    UserId    UNIQUEIDENTIFIER NOT NULL,
    AgencyId  INT              NOT NULL,
    CreatedAt DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_UserScopeAgencies PRIMARY KEY (UserId, AgencyId),
    CONSTRAINT FK_USA_User FOREIGN KEY (UserId) REFERENCES Users(Id) ON DELETE CASCADE,
    CONSTRAINT FK_USA_Agency FOREIGN KEY (AgencyId) REFERENCES Agencies(Id) ON DELETE CASCADE
);
GO
