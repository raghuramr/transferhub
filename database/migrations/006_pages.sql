-- ============================================================
-- Migration 006 – Custom Pages / CMS (admin-editable content)
-- ============================================================
-- Lightweight page-builder, inspired by a blocks-as-JSON content model:
-- one row = one page, the entire body is a JSON array of typed "block"
-- objects stored in a single column. No separate draft/publish tables —
-- Published + each block's own "visible" flag gate what's shown, and an
-- admin save is immediately live (no staging step), which is exactly
-- the "update data on the general screen from the Admin console"
-- behaviour the product wants.
--
-- Block shape (validated at the API layer, not by SQL):
--   { id, type, visible, ...type-specific fields }
-- type one of: heading | richtext | notice | cards | cta | divider | image
--
-- Content unchanged from the original 006_pages.sql, made idempotent.
-- ============================================================
USE CreditEvalManager;
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Pages')
BEGIN
    CREATE TABLE Pages (
        Id          INT              NOT NULL IDENTITY(1,1),
        Slug        VARCHAR(150)     NOT NULL,   -- e.g. "dashboard-announcements", "faq"
        Title       NVARCHAR(200)    NOT NULL,
        Blocks      NVARCHAR(MAX)    NOT NULL DEFAULT '[]',  -- JSON array of blocks
        Published   BIT              NOT NULL DEFAULT 0,
        ShowInNav   BIT              NOT NULL DEFAULT 0,
        NavLabel    NVARCHAR(100)    NULL,
        NavOrder    INT              NOT NULL DEFAULT 0,
        CreatedBy   UNIQUEIDENTIFIER NULL,
        UpdatedBy   UNIQUEIDENTIFIER NULL,
        CreatedAt   DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        UpdatedAt   DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_Pages PRIMARY KEY (Id),
        CONSTRAINT UQ_Pages_Slug UNIQUE (Slug),
        CONSTRAINT FK_Pages_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES Users(Id),
        CONSTRAINT FK_Pages_UpdatedBy FOREIGN KEY (UpdatedBy) REFERENCES Users(Id),
        CONSTRAINT CK_Pages_Blocks_IsJson CHECK (ISJSON(Blocks) = 1)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Pages_Published' AND object_id = OBJECT_ID('Pages'))
    CREATE INDEX IX_Pages_Published ON Pages(Published);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Pages_ShowInNav' AND object_id = OBJECT_ID('Pages'))
    CREATE INDEX IX_Pages_ShowInNav ON Pages(ShowInNav, NavOrder);
GO
