-- ============================================================
-- Migration 032 - Custom roles
-- ============================================================
-- The super admin can create roles beyond the five built-in ones. A custom role has its own row in the
-- Roles & Permissions matrix (its own grants) and a BaseRole: the built-in role whose screens and
-- fixed (@Roles) checks it behaves like. Built-in roles are flagged IsSystem and cannot be deleted.
-- Idempotent.
-- ============================================================
USE TransferHubDB;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Roles') AND name = 'BaseRole')
    ALTER TABLE Roles ADD BaseRole VARCHAR(20) NULL;
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Roles') AND name = 'IsSystem')
    ALTER TABLE Roles ADD IsSystem BIT NOT NULL CONSTRAINT DF_Roles_IsSystem DEFAULT 0;
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Roles') AND name = 'IsActive')
    ALTER TABLE Roles ADD IsActive BIT NOT NULL CONSTRAINT DF_Roles_IsActive DEFAULT 1;
GO

UPDATE Roles SET IsSystem = 1 WHERE Name IN ('student','faculty','admin','agency','super_admin');
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Roles_BaseRole')
    ALTER TABLE Roles ADD CONSTRAINT CK_Roles_BaseRole
        CHECK (BaseRole IS NULL OR BaseRole IN ('student','faculty','admin','agency'));
GO
