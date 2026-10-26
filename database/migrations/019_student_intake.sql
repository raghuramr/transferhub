-- ============================================================
-- Migration 019 - Student intake: source-system profiles + claim sessions
-- ============================================================
-- StudentSourceProfiles(+Courses,+Documents) hold records "fetched from another
-- system" (a registrar, an agency, a partner API). Until real connectors exist
-- they are filled by seed 013 (30 mock profiles) and by partner submissions
-- (import entity 'students'). IntakeSessions are the one-time claim links
-- emailed to the person the record belongs to; an account is only created
-- after they confirm. Idempotent.
-- ============================================================
USE TransferHubDB;
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'StudentSourceProfiles')
BEGIN
    CREATE TABLE StudentSourceProfiles (
        Id               INT           NOT NULL IDENTITY(1,1),
        SourceSystem     NVARCHAR(100) NOT NULL,
        IsMock           BIT           NOT NULL CONSTRAINT DF_SSP_IsMock DEFAULT 0,
        InstitutionCode  VARCHAR(20)   NOT NULL,
        InstitutionName  NVARCHAR(200) NOT NULL,
        Calendar         VARCHAR(10)   NOT NULL CONSTRAINT DF_SSP_Calendar DEFAULT 'semester',
        IdType           VARCHAR(20)   NOT NULL CONSTRAINT DF_SSP_IdType DEFAULT 'student_id',
        ExternalId       NVARCHAR(100) NOT NULL,
        ExternalIdNorm   AS (UPPER(REPLACE(REPLACE(ExternalId, ' ', ''), '-', ''))) PERSISTED,
        Email            NVARCHAR(254) NOT NULL,
        FirstName        NVARCHAR(100) NOT NULL,
        LastName         NVARCHAR(100) NOT NULL,
        DateOfBirth      DATE          NULL,
        Phone            NVARCHAR(30)  NULL,
        Country          NVARCHAR(100) NULL,
        CountryOfOrigin  NVARCHAR(100) NULL,
        City             NVARCHAR(100) NULL,
        State            NVARCHAR(100) NULL,
        ProgramName      NVARCHAR(200) NULL,
        Degree           NVARCHAR(50)  NULL,
        FieldOfStudy     NVARCHAR(200) NULL,
        GPA              DECIMAL(3,2)  NULL,
        GraduationYear   INT           NULL,
        CreditsCompleted DECIMAL(6,2)  NULL,
        PartnerId        INT           NULL,
        IsActive         BIT           NOT NULL CONSTRAINT DF_SSP_IsActive DEFAULT 1,
        CreatedAt        DATETIME2     NOT NULL CONSTRAINT DF_SSP_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAt        DATETIME2     NOT NULL CONSTRAINT DF_SSP_UpdatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_StudentSourceProfiles PRIMARY KEY (Id),
        CONSTRAINT CK_SSP_IdType CHECK (IdType IN ('student_id', 'passport', 'national_id', 'other')),
        CONSTRAINT UQ_SSP_Institution_ExternalId UNIQUE (InstitutionCode, ExternalIdNorm)
    );
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_SSP_Email' AND object_id = OBJECT_ID('StudentSourceProfiles'))
    CREATE INDEX IX_SSP_Email ON StudentSourceProfiles (Email);
GO

IF OBJECT_ID('DataPartners') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_SSP_Partner')
    EXEC('ALTER TABLE StudentSourceProfiles ADD CONSTRAINT FK_SSP_Partner FOREIGN KEY (PartnerId) REFERENCES DataPartners(Id)');
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'StudentSourceCourses')
BEGIN
    CREATE TABLE StudentSourceCourses (
        Id              INT           NOT NULL IDENTITY(1,1),
        SourceProfileId INT           NOT NULL,
        CourseCode      NVARCHAR(50)  NOT NULL,
        CourseTitle     NVARCHAR(300) NOT NULL,
        Credits         DECIMAL(5,2)  NOT NULL,
        Grade           NVARCHAR(10)  NOT NULL,
        Term            NVARCHAR(50)  NULL,
        SortOrder       INT           NOT NULL CONSTRAINT DF_SSC_SortOrder DEFAULT 0,
        CONSTRAINT PK_StudentSourceCourses PRIMARY KEY (Id),
        CONSTRAINT FK_SSC_Profile FOREIGN KEY (SourceProfileId) REFERENCES StudentSourceProfiles(Id) ON DELETE CASCADE
    );
    CREATE INDEX IX_SSC_Profile ON StudentSourceCourses (SourceProfileId);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'StudentSourceDocuments')
BEGIN
    CREATE TABLE StudentSourceDocuments (
        Id              INT           NOT NULL IDENTITY(1,1),
        SourceProfileId INT           NOT NULL,
        DocType         VARCHAR(40)   NOT NULL,
        FileName        NVARCHAR(300) NOT NULL,
        MimeType        NVARCHAR(100) NOT NULL CONSTRAINT DF_SSD_Mime DEFAULT 'application/pdf',
        Content         VARBINARY(MAX) NULL,
        Generated       BIT           NOT NULL CONSTRAINT DF_SSD_Generated DEFAULT 0,
        CreatedAt       DATETIME2     NOT NULL CONSTRAINT DF_SSD_CreatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_StudentSourceDocuments PRIMARY KEY (Id),
        CONSTRAINT FK_SSD_Profile FOREIGN KEY (SourceProfileId) REFERENCES StudentSourceProfiles(Id) ON DELETE CASCADE
    );
    CREATE INDEX IX_SSD_Profile ON StudentSourceDocuments (SourceProfileId);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'IntakeSessions')
BEGIN
    CREATE TABLE IntakeSessions (
        Id              UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_IS_Id DEFAULT NEWID(),
        SourceProfileId INT              NOT NULL,
        Email           NVARCHAR(254)    NOT NULL,
        TokenHash       NVARCHAR(128)    NOT NULL,
        Channel         VARCHAR(20)      NOT NULL CONSTRAINT DF_IS_Channel DEFAULT 'link',
        Status          VARCHAR(10)      NOT NULL CONSTRAINT DF_IS_Status DEFAULT 'open',
        ExpiresAt       DATETIME2        NOT NULL,
        CreatedAt       DATETIME2        NOT NULL CONSTRAINT DF_IS_CreatedAt DEFAULT SYSUTCDATETIME(),
        ClaimedAt       DATETIME2        NULL,
        ClaimedUserId   UNIQUEIDENTIFIER NULL,
        RequestIp       VARCHAR(64)      NULL,
        CONSTRAINT PK_IntakeSessions PRIMARY KEY (Id),
        CONSTRAINT FK_IS_Profile FOREIGN KEY (SourceProfileId) REFERENCES StudentSourceProfiles(Id),
        CONSTRAINT FK_IS_User FOREIGN KEY (ClaimedUserId) REFERENCES Users(Id),
        CONSTRAINT CK_IS_Channel CHECK (Channel IN ('link', 'qr', 'email', 'partner_invite')),
        CONSTRAINT CK_IS_Status CHECK (Status IN ('open', 'claimed', 'expired'))
    );
    CREATE INDEX IX_IS_Token ON IntakeSessions (TokenHash);
    CREATE INDEX IX_IS_Profile ON IntakeSessions (SourceProfileId);
END
GO

-- The partner import queue may now carry student profiles.
IF OBJECT_ID('ImportBatchRows') IS NOT NULL
   AND EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_IBR_Entity' AND definition NOT LIKE '%students%')
BEGIN
    EXEC('ALTER TABLE ImportBatchRows DROP CONSTRAINT CK_IBR_Entity');
    EXEC('ALTER TABLE ImportBatchRows ADD CONSTRAINT CK_IBR_Entity CHECK (EntityType IN (''universities'', ''programs'', ''courses'', ''students''))');
END
GO
