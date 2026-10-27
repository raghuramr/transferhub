USE TransferHubDB;
GO

-- Generic key/value application settings (first user: the login-page demo-account controls).
-- Idempotent: safe to re-run.
IF OBJECT_ID('dbo.AppSettings') IS NULL
BEGIN
    CREATE TABLE dbo.AppSettings (
        SettingKey   VARCHAR(100)   NOT NULL,
        SettingValue NVARCHAR(1000) NULL,
        UpdatedAt    DATETIME2      NOT NULL CONSTRAINT DF_AppSettings_UpdatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedBy    NVARCHAR(254)  NULL,
        CONSTRAINT PK_AppSettings PRIMARY KEY (SettingKey)
    );
END
GO

-- Secure by default: demo accounts are HIDDEN on the login page, and credentials are not displayed.
-- Only inserts missing keys, so a super admin's later choice is never overwritten on re-run.
INSERT INTO dbo.AppSettings (SettingKey, SettingValue, UpdatedBy)
SELECT d.SettingKey, d.SettingValue, N'migration 023'
FROM (VALUES
    ('demo_login.enabled',          '0'),
    ('demo_login.show_credentials', '0')
) AS d (SettingKey, SettingValue)
WHERE NOT EXISTS (SELECT 1 FROM dbo.AppSettings s WHERE s.SettingKey = d.SettingKey);
GO
