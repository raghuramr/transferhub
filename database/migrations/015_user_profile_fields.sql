-- ============================================================
-- Migration 015 – User profile fields (contact + address)
-- ============================================================
USE CreditEvalManager;
GO

-- Guarded so this migration is safe to re-run (e.g. a migration-runner tool
-- re-applying scripts that already succeeded) -- matches the pattern used
-- in migration 011. All columns were introduced together here, so a single
-- existence check on the first one is sufficient to guard the whole batch.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Users') AND name = 'Mobile')
    ALTER TABLE Users ADD
        Mobile          NVARCHAR(30)   NULL,
        AddressLine1    NVARCHAR(200)  NULL,  -- communication address
        AddressLine2    NVARCHAR(200)  NULL,
        City            NVARCHAR(100)  NULL,
        State           NVARCHAR(100)  NULL,
        PostalCode      NVARCHAR(20)   NULL,
        Country         NVARCHAR(100)  NULL,
        CountryOfOrigin NVARCHAR(100)  NULL;
GO
