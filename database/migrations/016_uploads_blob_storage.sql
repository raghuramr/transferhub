-- ============================================================
-- Migration 016 - Uploads: Azure Blob Storage + document type
-- ============================================================
-- Files now live in Azure Blob Storage (private container, one folder per
-- user: {role}/{userId}/{entityType}/{entityId}/{uuid}-{filename}).
-- StoredPath keeps holding the blob name (or, for legacy rows, the local
-- disk path); the new columns say where to find it and what kind of
-- document it is. Idempotent.
-- ============================================================
USE TransferHubDB;
GO

IF COL_LENGTH('Uploads', 'StorageProvider') IS NULL
    ALTER TABLE Uploads ADD StorageProvider NVARCHAR(10) NOT NULL CONSTRAINT DF_Uploads_StorageProvider DEFAULT 'local';
GO
IF COL_LENGTH('Uploads', 'ContainerName') IS NULL
    ALTER TABLE Uploads ADD ContainerName NVARCHAR(100) NULL;
GO
IF COL_LENGTH('Uploads', 'DocumentType') IS NULL
    ALTER TABLE Uploads ADD DocumentType NVARCHAR(50) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Uploads_Owner_DocType' AND object_id = OBJECT_ID('Uploads'))
    CREATE INDEX IX_Uploads_Owner_DocType ON Uploads (OwnerUserId, DocumentType);
GO
