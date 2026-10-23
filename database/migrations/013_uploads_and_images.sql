-- ============================================================
-- Migration 013 – Uploads (file storage metadata) + Logo/Hero image URLs
-- ============================================================
-- Part A (Custom Forms file-upload field type): user-submitted documents
-- must never live under a web-servable public folder (world-readable
-- without auth). Files are written to disk under
-- storage/uploads/{role}/{userId}/{entityType}/{entityId}/{originalFilename}
-- (private) or storage/public-uploads/{uuid}-{originalFilename} (public —
-- logos/hero images only). This table is the metadata of record; the
-- filesystem path alone is never trusted for access control.
--
-- Part B: Institutions (Universities) and AcademicUnits (Institutions in
-- the UI) get LogoUrl/HeroImageUrl — a single URL-like string that is
-- either `/uploads/...` (served by the new uploads module) or an external
-- `https://...` URL.
USE CreditEvalManager;
GO

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
GO

CREATE INDEX IX_Uploads_OwnerUserId ON Uploads (OwnerUserId);
CREATE INDEX IX_Uploads_Entity ON Uploads (EntityType, EntityId);
GO

ALTER TABLE Institutions ADD LogoUrl NVARCHAR(500) NULL;
ALTER TABLE Institutions ADD HeroImageUrl NVARCHAR(500) NULL;
GO

ALTER TABLE AcademicUnits ADD LogoUrl NVARCHAR(500) NULL;
ALTER TABLE AcademicUnits ADD HeroImageUrl NVARCHAR(500) NULL;
GO
