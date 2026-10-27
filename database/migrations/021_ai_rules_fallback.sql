USE TransferHubDB;
GO

-- Built-in (non-AI) rules engine for document reading and course matching, used when AI is off/unavailable.
-- Default 1 = fallback on; super admins can switch it off in AI Controls > Settings.
IF OBJECT_ID('AiSettings') IS NOT NULL
   AND COL_LENGTH('AiSettings', 'RulesFallbackEnabled') IS NULL
    ALTER TABLE AiSettings ADD RulesFallbackEnabled BIT NOT NULL CONSTRAINT DF_AiSettings_RulesFallback DEFAULT 1;
GO
