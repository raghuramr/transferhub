-- ============================================================
-- Migration 002 – Authentication & User Management
-- ============================================================
USE CreditEvalManager;
GO

-- ─── Roles ───────────────────────────────────────────────────
-- student      : transfer student; sees only own records
-- faculty      : department evaluator; reviews queue for own dept
-- admin        : Credit Evaluation staff; manages transcripts & catalog
-- agency       : external agency submitting requests on behalf of students
-- super_admin  : full access, manages admins, system config, audit log
CREATE TABLE Roles (
    Id          INT           NOT NULL IDENTITY(1,1),
    Name        VARCHAR(20)   NOT NULL,   -- student|faculty|admin|agency|super_admin
    DisplayName NVARCHAR(100) NOT NULL,
    Description NVARCHAR(500) NULL,
    CreatedAt   DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_Roles PRIMARY KEY (Id),
    CONSTRAINT UQ_Roles_Name UNIQUE (Name)
);
GO

-- ─── Departments ─────────────────────────────────────────────
CREATE TABLE Departments (
    Id          INT           NOT NULL IDENTITY(1,1),
    Code        VARCHAR(20)   NOT NULL,   -- e.g. CS, ECON
    Name        NVARCHAR(200) NOT NULL,
    IsActive    BIT           NOT NULL DEFAULT 1,
    CreatedAt   DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_Departments PRIMARY KEY (Id),
    CONSTRAINT UQ_Departments_Code UNIQUE (Code)
);
GO

-- ─── Users ───────────────────────────────────────────────────
CREATE TABLE Users (
    Id              UNIQUEIDENTIFIER NOT NULL DEFAULT NEWSEQUENTIALID(),
    Email           NVARCHAR(254)    NOT NULL,
    PasswordHash    NVARCHAR(255)    NOT NULL,   -- argon2id hash
    FirstName       NVARCHAR(100)    NOT NULL,
    LastName        NVARCHAR(100)    NOT NULL,
    RoleId          INT              NOT NULL,
    DepartmentId    INT              NULL,        -- faculty only
    StudentId       NVARCHAR(50)     NULL,        -- BU student identifier (students only)
    AgencyName      NVARCHAR(200)    NULL,        -- agency role only
    IsActive        BIT              NOT NULL DEFAULT 1,
    IsLocked        BIT              NOT NULL DEFAULT 0,
    FailedLogins    INT              NOT NULL DEFAULT 0,
    LockedUntil     DATETIME2        NULL,
    LastLoginAt     DATETIME2        NULL,
    MustChangePass  BIT              NOT NULL DEFAULT 0,
    CreatedAt       DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
    UpdatedAt       DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
    CreatedBy       UNIQUEIDENTIFIER NULL,
    CONSTRAINT PK_Users PRIMARY KEY (Id),
    CONSTRAINT UQ_Users_Email UNIQUE (Email),
    CONSTRAINT FK_Users_Roles FOREIGN KEY (RoleId) REFERENCES Roles(Id),
    CONSTRAINT FK_Users_Departments FOREIGN KEY (DepartmentId) REFERENCES Departments(Id)
);
GO

CREATE INDEX IX_Users_Email    ON Users (Email);
CREATE INDEX IX_Users_RoleId   ON Users (RoleId);
CREATE INDEX IX_Users_IsActive ON Users (IsActive);
GO

-- ─── Refresh Tokens ──────────────────────────────────────────
CREATE TABLE RefreshTokens (
    Id          UNIQUEIDENTIFIER NOT NULL DEFAULT NEWSEQUENTIALID(),
    UserId      UNIQUEIDENTIFIER NOT NULL,
    Token       NVARCHAR(512)    NOT NULL,   -- SHA-256 hash of the token
    DeviceInfo  NVARCHAR(500)    NULL,
    IpAddress   NVARCHAR(45)     NULL,
    ExpiresAt   DATETIME2        NOT NULL,
    IsRevoked   BIT              NOT NULL DEFAULT 0,
    CreatedAt   DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_RefreshTokens PRIMARY KEY (Id),
    CONSTRAINT FK_RefreshTokens_Users FOREIGN KEY (UserId) REFERENCES Users(Id) ON DELETE CASCADE
);
GO

CREATE INDEX IX_RefreshTokens_UserId ON RefreshTokens (UserId);
CREATE INDEX IX_RefreshTokens_Token  ON RefreshTokens (Token);
GO

-- ─── Password Reset Tokens ───────────────────────────────────
CREATE TABLE PasswordResetTokens (
    Id          UNIQUEIDENTIFIER NOT NULL DEFAULT NEWSEQUENTIALID(),
    UserId      UNIQUEIDENTIFIER NOT NULL,
    Token       NVARCHAR(512)    NOT NULL,   -- SHA-256 hash
    ExpiresAt   DATETIME2        NOT NULL,
    IsUsed      BIT              NOT NULL DEFAULT 0,
    CreatedAt   DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_PasswordResetTokens PRIMARY KEY (Id),
    CONSTRAINT FK_PasswordResetTokens_Users FOREIGN KEY (UserId) REFERENCES Users(Id) ON DELETE CASCADE
);
GO

-- ─── Audit Log ───────────────────────────────────────────────
-- Immutable append-only log.  Never update or delete rows here.
CREATE TABLE AuditLog (
    Id          BIGINT           NOT NULL IDENTITY(1,1),
    UserId      UNIQUEIDENTIFIER NULL,        -- NULL for system actions
    UserEmail   NVARCHAR(254)    NULL,        -- snapshot at time of action
    UserRole    VARCHAR(20)      NULL,
    Action      NVARCHAR(200)    NOT NULL,    -- e.g. LOGIN, DECISION_SAVED, USER_CREATED
    EntityType  NVARCHAR(100)    NULL,        -- e.g. Evaluation, User
    EntityId    NVARCHAR(100)    NULL,
    OldValue    NVARCHAR(MAX)    NULL,        -- JSON snapshot before change
    NewValue    NVARCHAR(MAX)    NULL,        -- JSON snapshot after change
    IpAddress   NVARCHAR(45)     NULL,
    UserAgent   NVARCHAR(500)    NULL,
    OccurredAt  DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_AuditLog PRIMARY KEY (Id)
);
GO

CREATE INDEX IX_AuditLog_UserId     ON AuditLog (UserId);
CREATE INDEX IX_AuditLog_Action     ON AuditLog (Action);
CREATE INDEX IX_AuditLog_OccurredAt ON AuditLog (OccurredAt DESC);
GO
