-- ============================================================
-- Migration 018 - Email verification, profile photos, course verification requests
-- ============================================================
--  * Users.EmailVerified (default 1: every existing AND newly registered
--    account counts as verified for now; changing an email later requires
--    clicking the emailed link - see EmailChangeRequests).
--  * Users.AvatarUploadId - the profile photo (an Uploads row in blob storage).
--  * EmailChangeRequests - pending "change my email" requests (hashed token).
--  * CourseVerificationRequests - faculty/admin raise a course for verification.
-- Idempotent.
-- ============================================================
USE TransferHubDB;
GO

IF COL_LENGTH('Users', 'EmailVerified') IS NULL
    ALTER TABLE Users ADD EmailVerified BIT NOT NULL CONSTRAINT DF_Users_EmailVerified DEFAULT 1;
GO
IF COL_LENGTH('Users', 'AvatarUploadId') IS NULL
    ALTER TABLE Users ADD AvatarUploadId UNIQUEIDENTIFIER NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'EmailChangeRequests')
BEGIN
    CREATE TABLE EmailChangeRequests (
        Id        INT              NOT NULL IDENTITY(1,1),
        UserId    UNIQUEIDENTIFIER NOT NULL,
        NewEmail  NVARCHAR(254)    NOT NULL,
        TokenHash NVARCHAR(128)    NOT NULL,
        ExpiresAt DATETIME2        NOT NULL,
        UsedAt    DATETIME2        NULL,
        CreatedAt DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_EmailChangeRequests PRIMARY KEY (Id),
        CONSTRAINT FK_ECR_User FOREIGN KEY (UserId) REFERENCES Users(Id) ON DELETE CASCADE
    );
    CREATE INDEX IX_ECR_Token ON EmailChangeRequests (TokenHash);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CourseVerificationRequests')
BEGIN
    CREATE TABLE CourseVerificationRequests (
        Id             INT              NOT NULL IDENTITY(1,1),
        CourseId       INT              NOT NULL,
        RaisedBy       UNIQUEIDENTIFIER NOT NULL,
        Reason         NVARCHAR(1000)   NOT NULL,
        Status         VARCHAR(20)      NOT NULL DEFAULT 'open',   -- open | verified | rejected
        ResolvedBy     UNIQUEIDENTIFIER NULL,
        ResolvedAt     DATETIME2        NULL,
        ResolutionNote NVARCHAR(1000)   NULL,
        CreatedAt      DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_CourseVerificationRequests PRIMARY KEY (Id),
        CONSTRAINT FK_CVR_Course FOREIGN KEY (CourseId) REFERENCES Courses(Id),
        CONSTRAINT FK_CVR_RaisedBy FOREIGN KEY (RaisedBy) REFERENCES Users(Id),
        CONSTRAINT FK_CVR_ResolvedBy FOREIGN KEY (ResolvedBy) REFERENCES Users(Id),
        CONSTRAINT CK_CVR_Status CHECK (Status IN ('open','verified','rejected'))
    );
    CREATE INDEX IX_CVR_Status ON CourseVerificationRequests (Status);
END
GO
