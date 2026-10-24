-- ============================================================
-- Migration 008 – Universities/Institutions split, Agencies, scope
-- visibility, branding (Logo/Hero) images
-- ============================================================
-- Naming note (see CLAUDE.md): the existing `Institutions` table (created
-- in the Institutions/Courses/Programs migration) already models what the
-- product now calls "Universities" (BU, Northeastern, NYU + future
-- community colleges) -- not renamed, to avoid an invasive break across
-- Courses/Transcripts/Equivalencies/ai.service.ts, all of which already
-- reference Institutions(Id). It is simply relabeled "Universities" in the
-- UI/API-facing text.
--
-- The genuinely NEW entity the product calls "Institutions" is a school
-- or college WITHIN a university (e.g. "College of Arts & Sciences",
-- "Khoury College of Computer Sciences"). That table is named
-- AcademicUnits here to avoid a name collision with the existing
-- Institutions table, but is labeled "Institutions" in the UI everywhere
-- a user sees it. AcademicUnits.InstitutionId is nullable (an AcademicUnit
-- can exist before being mapped to a University).
--
-- Also covers: LogoUrl/HeroImageUrl on both Institutions and AcademicUnits
-- (public branding images for the University/Institution public pages) —
-- grouped here rather than with the Uploads migration, since these two
-- columns were introduced together as part of this entity's own
-- branding/public-page feature, not as part of the Uploads table itself.
-- ============================================================
USE TransferHubDB;
GO

-- ─── Agencies ────────────────────────────────────────────────
-- Formalizes the external partner-agency concept. Users.AgencyName stays
-- as a free-text display fallback; AgencyId is the real FK going forward.
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Agencies')
BEGIN
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
END
GO

-- ─── AcademicUnits ("Institutions" in the UI) ───────────────
-- InstitutionId is nullable from the start here (final shape already
-- reflects migration 016 -- an AcademicUnit may exist before being
-- mapped to a University).
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'AcademicUnits')
BEGIN
    CREATE TABLE AcademicUnits (
        Id            INT              NOT NULL IDENTITY(1,1),
        InstitutionId INT              NULL,       -- the "University" (existing Institutions table); nullable, see migration 016 note above
        Name          NVARCHAR(200)    NOT NULL,   -- e.g. "College of Arts & Sciences"
        Code          VARCHAR(30)      NULL,
        IsActive      BIT              NOT NULL DEFAULT 1,
        CreatedAt     DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        UpdatedAt     DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_AcademicUnits PRIMARY KEY (Id),
        CONSTRAINT FK_AcademicUnits_Institution FOREIGN KEY (InstitutionId) REFERENCES Institutions(Id),
        CONSTRAINT UQ_AcademicUnits_Inst_Name UNIQUE (InstitutionId, Name)
    );
END
GO

-- Upgrade path: database already has AcademicUnits from the old 008
-- migration with InstitutionId still NOT NULL (pre-016). ALTER COLUMN to
-- the same (already-nullable) type is itself a safe no-op in SQL Server,
-- so this is safe to run unconditionally.
ALTER TABLE AcademicUnits ALTER COLUMN InstitutionId INT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_AcademicUnits_Institution' AND object_id = OBJECT_ID('AcademicUnits'))
    CREATE INDEX IX_AcademicUnits_Institution ON AcademicUnits (InstitutionId);
GO

-- ─── Users.AgencyId FK (keep AgencyName text for back-compat) ─
-- The AgencyId column itself is created in the Auth/Users migration
-- (Agencies doesn't exist yet at that point); the FK is added here.
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_Users_Agency')
    ALTER TABLE Users ADD CONSTRAINT FK_Users_Agency FOREIGN KEY (AgencyId) REFERENCES Agencies(Id);
GO

-- ─── Scope visibility ────────────────────────────────────────
-- Which Universities / Institutions (AcademicUnits) / Agencies a user can
-- see and act on. No rows for a user = unrestricted (sees everything) --
-- this keeps existing demo users working unchanged.
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'UserScopeUniversities')
BEGIN
    CREATE TABLE UserScopeUniversities (
        UserId        UNIQUEIDENTIFIER NOT NULL,
        InstitutionId INT              NOT NULL,
        CreatedAt     DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_UserScopeUniversities PRIMARY KEY (UserId, InstitutionId),
        CONSTRAINT FK_USU_User FOREIGN KEY (UserId) REFERENCES Users(Id) ON DELETE CASCADE,
        CONSTRAINT FK_USU_Institution FOREIGN KEY (InstitutionId) REFERENCES Institutions(Id)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'UserScopeAcademicUnits')
BEGIN
    CREATE TABLE UserScopeAcademicUnits (
        UserId         UNIQUEIDENTIFIER NOT NULL,
        AcademicUnitId INT              NOT NULL,
        CreatedAt      DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_UserScopeAcademicUnits PRIMARY KEY (UserId, AcademicUnitId),
        CONSTRAINT FK_USAU_User FOREIGN KEY (UserId) REFERENCES Users(Id) ON DELETE CASCADE,
        CONSTRAINT FK_USAU_AcademicUnit FOREIGN KEY (AcademicUnitId) REFERENCES AcademicUnits(Id)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'UserScopeAgencies')
BEGIN
    CREATE TABLE UserScopeAgencies (
        UserId    UNIQUEIDENTIFIER NOT NULL,
        AgencyId  INT              NOT NULL,
        CreatedAt DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_UserScopeAgencies PRIMARY KEY (UserId, AgencyId),
        CONSTRAINT FK_USA_User FOREIGN KEY (UserId) REFERENCES Users(Id) ON DELETE CASCADE,
        CONSTRAINT FK_USA_Agency FOREIGN KEY (AgencyId) REFERENCES Agencies(Id) ON DELETE CASCADE
    );
END
GO

-- ─── Branding images (Logo/Hero) ─────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Institutions') AND name = 'LogoUrl')
    ALTER TABLE Institutions ADD LogoUrl NVARCHAR(500) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Institutions') AND name = 'HeroImageUrl')
    ALTER TABLE Institutions ADD HeroImageUrl NVARCHAR(500) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('AcademicUnits') AND name = 'LogoUrl')
    ALTER TABLE AcademicUnits ADD LogoUrl NVARCHAR(500) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('AcademicUnits') AND name = 'HeroImageUrl')
    ALTER TABLE AcademicUnits ADD HeroImageUrl NVARCHAR(500) NULL;
GO
