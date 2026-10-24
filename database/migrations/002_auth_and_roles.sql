-- ============================================================
-- Migration 002 – Authentication, Users, Roles & Permissions
-- ============================================================
-- Consolidated entity file (see CLAUDE.md "DB Script Runner tool" section).
-- Covers: Roles, Departments, Users (+ profile/contact fields), Refresh
-- Tokens, Password Reset Tokens, Audit Log, and the Roles & Permissions
-- master-data tables (PermissionModules / PermissionOperations /
-- RolePermissions). Roles & Permissions is folded in here rather than kept
-- as its own file because PermissionModules/Operations/RolePermissions all
-- FK back to Roles, which lives in this same entity group.
--
-- Users.AgencyId is created here as a plain nullable column (no FK yet) —
-- the FK to Agencies(Id) is added in the Universities/Institutions/
-- Agencies migration, since Agencies doesn't exist until that file runs.
--
-- Every statement is guarded so this file is a clean no-op against a
-- database that already has this shape (from the old 002/014/015
-- migrations), and also builds the full final shape on a fresh database.
-- ============================================================
USE TransferHubDB;
GO

-- ─── Roles ───────────────────────────────────────────────────
-- student      : transfer student; sees only own records
-- faculty      : department evaluator; reviews queue for own dept
-- admin        : Credit Evaluation staff; manages transcripts & catalog
-- agency       : external agency submitting requests on behalf of students
-- super_admin  : full access, manages admins, system config, audit log
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Roles')
BEGIN
    CREATE TABLE Roles (
        Id          INT           NOT NULL IDENTITY(1,1),
        Name        VARCHAR(20)   NOT NULL,   -- student|faculty|admin|agency|super_admin
        DisplayName NVARCHAR(100) NOT NULL,
        Description NVARCHAR(500) NULL,
        CreatedAt   DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_Roles PRIMARY KEY (Id),
        CONSTRAINT UQ_Roles_Name UNIQUE (Name)
    );
END
GO

-- ─── Departments ─────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Departments')
BEGIN
    CREATE TABLE Departments (
        Id          INT           NOT NULL IDENTITY(1,1),
        Code        VARCHAR(20)   NOT NULL,   -- e.g. CS, ECON
        Name        NVARCHAR(200) NOT NULL,
        IsActive    BIT           NOT NULL DEFAULT 1,
        CreatedAt   DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_Departments PRIMARY KEY (Id),
        CONSTRAINT UQ_Departments_Code UNIQUE (Code)
    );
END
GO

-- ─── Users ───────────────────────────────────────────────────
-- Final shape includes migration 015's contact/address fields and
-- migration 008's AgencyId column (FK added later, see note above).
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Users')
BEGIN
    CREATE TABLE Users (
        Id              UNIQUEIDENTIFIER NOT NULL DEFAULT NEWSEQUENTIALID(),
        Email           NVARCHAR(254)    NOT NULL,
        PasswordHash    NVARCHAR(255)    NOT NULL,   -- argon2id hash
        FirstName       NVARCHAR(100)    NOT NULL,
        LastName        NVARCHAR(100)    NOT NULL,
        RoleId          INT              NOT NULL,
        DepartmentId    INT              NULL,        -- faculty only
        StudentId       NVARCHAR(50)     NULL,        -- BU student identifier (students only)
        AgencyName      NVARCHAR(200)    NULL,        -- agency role only (free-text fallback)
        AgencyId        INT              NULL,        -- real FK to Agencies, added in Universities/Institutions/Agencies migration
        IsActive        BIT              NOT NULL DEFAULT 1,
        IsLocked        BIT              NOT NULL DEFAULT 0,
        FailedLogins    INT              NOT NULL DEFAULT 0,
        LockedUntil     DATETIME2        NULL,
        LastLoginAt     DATETIME2        NULL,
        MustChangePass  BIT              NOT NULL DEFAULT 0,
        Mobile          NVARCHAR(30)     NULL,
        AddressLine1    NVARCHAR(200)    NULL,  -- communication address
        AddressLine2    NVARCHAR(200)    NULL,
        City            NVARCHAR(100)    NULL,
        State           NVARCHAR(100)    NULL,
        PostalCode      NVARCHAR(20)     NULL,
        Country         NVARCHAR(100)    NULL,
        CountryOfOrigin NVARCHAR(100)    NULL,
        CreatedAt       DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        UpdatedAt       DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        CreatedBy       UNIQUEIDENTIFIER NULL,
        CONSTRAINT PK_Users PRIMARY KEY (Id),
        CONSTRAINT UQ_Users_Email UNIQUE (Email),
        CONSTRAINT FK_Users_Roles FOREIGN KEY (RoleId) REFERENCES Roles(Id),
        CONSTRAINT FK_Users_Departments FOREIGN KEY (DepartmentId) REFERENCES Departments(Id)
    );
END
GO

-- Upgrade path: database already has Users from the old 002 migration but
-- not yet 008's AgencyId or 015's profile fields.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Users') AND name = 'AgencyId')
    ALTER TABLE Users ADD AgencyId INT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Users') AND name = 'Mobile')
    ALTER TABLE Users ADD
        Mobile          NVARCHAR(30)   NULL,
        AddressLine1    NVARCHAR(200)  NULL,
        AddressLine2    NVARCHAR(200)  NULL,
        City            NVARCHAR(100)  NULL,
        State           NVARCHAR(100)  NULL,
        PostalCode      NVARCHAR(20)   NULL,
        Country         NVARCHAR(100)  NULL,
        CountryOfOrigin NVARCHAR(100)  NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Users_Email' AND object_id = OBJECT_ID('Users'))
    CREATE INDEX IX_Users_Email ON Users (Email);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Users_RoleId' AND object_id = OBJECT_ID('Users'))
    CREATE INDEX IX_Users_RoleId ON Users (RoleId);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Users_IsActive' AND object_id = OBJECT_ID('Users'))
    CREATE INDEX IX_Users_IsActive ON Users (IsActive);
GO

-- ─── Refresh Tokens ──────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'RefreshTokens')
BEGIN
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
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_RefreshTokens_UserId' AND object_id = OBJECT_ID('RefreshTokens'))
    CREATE INDEX IX_RefreshTokens_UserId ON RefreshTokens (UserId);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_RefreshTokens_Token' AND object_id = OBJECT_ID('RefreshTokens'))
    CREATE INDEX IX_RefreshTokens_Token ON RefreshTokens (Token);
GO

-- ─── Password Reset Tokens ───────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'PasswordResetTokens')
BEGIN
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
END
GO

-- ─── Audit Log ───────────────────────────────────────────────
-- Immutable append-only log.  Never update or delete rows here.
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'AuditLog')
BEGIN
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
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_AuditLog_UserId' AND object_id = OBJECT_ID('AuditLog'))
    CREATE INDEX IX_AuditLog_UserId ON AuditLog (UserId);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_AuditLog_Action' AND object_id = OBJECT_ID('AuditLog'))
    CREATE INDEX IX_AuditLog_Action ON AuditLog (Action);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_AuditLog_OccurredAt' AND object_id = OBJECT_ID('AuditLog'))
    CREATE INDEX IX_AuditLog_OccurredAt ON AuditLog (OccurredAt DESC);
GO

-- ─── Permission Modules ─────────────────────────────────────
-- The functional areas of the app that permissions can be scoped to
-- (Course Database, Users, Universities, ... ). Configuration layer
-- consulted live by RolesGuard via @Permission() (see CLAUDE.md).
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'PermissionModules')
BEGIN
    CREATE TABLE PermissionModules (
        Id        INT           NOT NULL IDENTITY(1,1),
        [Key]     VARCHAR(50)   NOT NULL,
        Label     NVARCHAR(100) NOT NULL,
        SortOrder INT           NOT NULL DEFAULT 0,
        CONSTRAINT PK_PermissionModules PRIMARY KEY (Id),
        CONSTRAINT UQ_PermissionModules_Key UNIQUE ([Key])
    );
END
GO

-- ─── Permission Operations ──────────────────────────────────
-- The actions a Role can be granted on a Module (view/create/edit/...).
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'PermissionOperations')
BEGIN
    CREATE TABLE PermissionOperations (
        Id        INT           NOT NULL IDENTITY(1,1),
        [Key]     VARCHAR(50)   NOT NULL,
        Label     NVARCHAR(100) NOT NULL,
        SortOrder INT           NOT NULL DEFAULT 0,
        CONSTRAINT PK_PermissionOperations PRIMARY KEY (Id),
        CONSTRAINT UQ_PermissionOperations_Key UNIQUE ([Key])
    );
END
GO

-- ─── Role Permissions ───────────────────────────────────────
-- The actual Role x Module x Operation grants. Absence of a row means
-- "not allowed".
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'RolePermissions')
BEGIN
    CREATE TABLE RolePermissions (
        RoleId      INT NOT NULL,
        ModuleId    INT NOT NULL,
        OperationId INT NOT NULL,
        IsAllowed   BIT NOT NULL DEFAULT 1,
        CONSTRAINT PK_RolePermissions PRIMARY KEY (RoleId, ModuleId, OperationId),
        CONSTRAINT FK_RolePermissions_Role FOREIGN KEY (RoleId) REFERENCES Roles(Id) ON DELETE CASCADE,
        CONSTRAINT FK_RolePermissions_Module FOREIGN KEY (ModuleId) REFERENCES PermissionModules(Id) ON DELETE CASCADE,
        CONSTRAINT FK_RolePermissions_Operation FOREIGN KEY (OperationId) REFERENCES PermissionOperations(Id) ON DELETE CASCADE
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_RolePermissions_Module' AND object_id = OBJECT_ID('RolePermissions'))
    CREATE INDEX IX_RolePermissions_Module ON RolePermissions (ModuleId);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_RolePermissions_Operation' AND object_id = OBJECT_ID('RolePermissions'))
    CREATE INDEX IX_RolePermissions_Operation ON RolePermissions (OperationId);
GO
