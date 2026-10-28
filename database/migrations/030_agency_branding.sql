-- ============================================================
-- Migration 030 - Agency branding (logo + banner)
-- ============================================================
-- Agencies get a logo and a banner image, the same two fields universities have, so an agency user sees their
-- own agency in the header of the app. Values are either /uploads/public/:id style URLs, direct blob URLs or any
-- https:// URL (same convention as Institutions.LogoUrl / HeroImageUrl). Idempotent.
-- ============================================================
USE TransferHubDB;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Agencies') AND name = 'LogoUrl')
    ALTER TABLE Agencies ADD LogoUrl NVARCHAR(500) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Agencies') AND name = 'HeroImageUrl')
    ALTER TABLE Agencies ADD HeroImageUrl NVARCHAR(500) NULL;
GO

PRINT 'Migration 030: Agencies.LogoUrl / HeroImageUrl are in place.';
GO
