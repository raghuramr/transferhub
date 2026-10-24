-- ============================================================
-- Migration 015 – User profile fields (contact + address)
-- ============================================================
USE CreditEvalManager;
GO

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
