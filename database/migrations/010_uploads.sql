-- ============================================================
-- Migration 010 – Uploads (file storage metadata)
-- ============================================================
-- User-submitted documents must never live under a web-servable public
-- folder (world-readable without auth). Files are written to disk under
-- storage/uploads/{role}/{userId}/{entityType}/{entityId}/{originalFilename}
-- (private) or storage/public-uploads/{uuid}-{originalFilename} (public —
-- logos/hero images only). This table is the metadata of record; the
-- filesystem path alone is never trusted for access control.
--
-- The LogoUrl/HeroImageUrl columns this table's feature also introduced on
-- Institutions/AcademicUnits live in the Universities/Institutions/
-- Agencies migration instead (with their owning entity), not here — see
-- that file's header note. This migration covers the Uploads table only,
-- and runs after that one since it has no other dependency ordering
-- requirement of its own beyond Users.
-- ============================================================
USE CreditEvalManager;
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Uploads')
BEGIN
    CREATE TABLE Uploads (
        Id               UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID(),
        OwnerUserId      UNIQUEIDENTIFIER NOT NULL,
        Role             NVARCHAR(30)     NOT NULL,
        EntityType       NVARCHAR(50)     NOT NULL,
        EntityId         NVARCHAR(100)    NULL,
        OriginalFileName NVARCHAR(300)    NOT NULL,
        StoredPath       NVARCHAR(500)    NOT NULL,
        MimeType         NVARCHAR(100)    NULL,
        SizeBytes        BIGINT           NOT NULL DEFAULT 0,
        IsPublic         BIT              NOT NULL DEFAULT 0,
        CreatedAt        DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_Uploads PRIMARY KEY (Id),
        CONSTRAINT FK_Uploads_OwnerUser FOREIGN KEY (OwnerUserId) REFERENCES Users(Id)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Uploads_OwnerUserId' AND object_id = OBJECT_ID('Uploads'))
    CREATE INDEX IX_Uploads_OwnerUserId ON Uploads (OwnerUserId);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Uploads_Entity' AND object_id = OBJECT_ID('Uploads'))
    CREATE INDEX IX_Uploads_Entity ON Uploads (EntityType, EntityId);
GO
