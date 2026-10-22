-- ============================================================
-- Migration 003 – Institutions, Programs & Courses
-- ============================================================
USE UniversityManager;
GO

-- ─── Institutions ────────────────────────────────────────────
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
GO

-- ─── Programs ────────────────────────────────────────────────
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
    CreatedAt       DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_Programs PRIMARY KEY (Id),
    CONSTRAINT FK_Programs_Institutions FOREIGN KEY (InstitutionId) REFERENCES Institutions(Id)
);
GO

-- ─── Courses ─────────────────────────────────────────────────
CREATE TABLE Courses (
    Id              INT            NOT NULL IDENTITY(1,1),
    InstitutionId   INT            NOT NULL,
    Code            NVARCHAR(30)   NOT NULL,  -- e.g. CAS CS 111, CS 2000
    Title           NVARCHAR(300)  NOT NULL,
    ProgramArea     NVARCHAR(100)  NULL,      -- Computer Science …
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
    CONSTRAINT UQ_Courses_Institution_Code UNIQUE (InstitutionId, Code)
);
GO

CREATE INDEX IX_Courses_InstitutionId ON Courses (InstitutionId);
CREATE INDEX IX_Courses_ProgramArea   ON Courses (ProgramArea);
GO

-- ─── Equivalency Database ────────────────────────────────────
-- Stores confirmed course matches.  Source of truth for the auto-apply path.
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
GO

CREATE INDEX IX_Equiv_ExternalCourse ON Equivalencies (ExternalCourseId);
CREATE INDEX IX_Equiv_BUCourse       ON Equivalencies (BUCourseId);
GO
