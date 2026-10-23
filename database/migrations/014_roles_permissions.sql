-- ============================================================
-- Migration 014 – Roles & Permissions master data
-- ============================================================
-- Master-data / configuration layer so the SuperAdmin can see and (later)
-- adjust which Role is allowed which Operation on which Module, from a
-- single matrix screen. This is a CONFIGURATION layer only in this pass —
-- it does not replace or get consulted by the existing @Roles()/RolesGuard
-- checks scattered across the controllers; those remain the actual
-- enforcement mechanism today. See CLAUDE.md for the deferred-work note.
USE CreditEvalManager;
GO

-- ─── Permission Modules ─────────────────────────────────────
-- The functional areas of the app that permissions can be scoped to
-- (Course Database, Users, Universities, ... ).
CREATE TABLE PermissionModules (
    Id        INT           NOT NULL IDENTITY(1,1),
    [Key]     VARCHAR(50)   NOT NULL,
    Label     NVARCHAR(100) NOT NULL,
    SortOrder INT           NOT NULL DEFAULT 0,
    CONSTRAINT PK_PermissionModules PRIMARY KEY (Id),
    CONSTRAINT UQ_PermissionModules_Key UNIQUE ([Key])
);
GO

-- ─── Permission Operations ──────────────────────────────────
-- The actions a Role can be granted on a Module (view/create/edit/...).
CREATE TABLE PermissionOperations (
    Id        INT           NOT NULL IDENTITY(1,1),
    [Key]     VARCHAR(50)   NOT NULL,
    Label     NVARCHAR(100) NOT NULL,
    SortOrder INT           NOT NULL DEFAULT 0,
    CONSTRAINT PK_PermissionOperations PRIMARY KEY (Id),
    CONSTRAINT UQ_PermissionOperations_Key UNIQUE ([Key])
);
GO

-- ─── Role Permissions ───────────────────────────────────────
-- The actual Role x Module x Operation grants. Absence of a row means
-- "not allowed" — the matrix UI only needs to insert/toggle the rows
-- that are actually granted.
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
GO

CREATE INDEX IX_RolePermissions_Module ON RolePermissions (ModuleId);
GO
CREATE INDEX IX_RolePermissions_Operation ON RolePermissions (OperationId);
GO
