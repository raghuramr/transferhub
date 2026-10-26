-- ============================================================
-- Migration 015: Align registration, submission and evaluation with BU's
-- published transfer policy (see _designs/understanding/12 and 13).
--
--   * TransferPolicies          per-university thresholds (min grade, credit caps,
--                               max course age, P/F, accreditation, Hub counts)
--   * Institutions.IsAccredited / Accreditor
--   * StudentProfiles           applicant type, admission status, intended
--                               school/college, entry term, English, intl flag,
--                               high school, credits completed
--   * StudentEducation          every institution attended
--   * StudentExamCredits        AP / IB / A-level (count against the cap)
--   * TranscriptCourses         term + year, grading basis, delivery mode,
--                               course type, outside-US flag, policy flags
--   * Transcripts.EvaluationKind  preview | official | preapproval (+ expiry)
--   * CourseAppeals             per-course appeal (mirrors BU's appeal form)
--
-- Reserved-word care: TermSeason (not Season), GradingBasis, CourseType.
-- Idempotent: safe to re-run.
-- ============================================================
USE TransferHubDB;
GO

-- ─── TransferPolicies ────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'TransferPolicies')
BEGIN
    CREATE TABLE TransferPolicies (
        Id                     INT          NOT NULL IDENTITY(1,1),
        InstitutionId          INT          NULL,                 -- NULL = global default
        MinGrade               VARCHAR(3)   NOT NULL DEFAULT 'C',
        MaxCourseAgeYears      INT          NULL     DEFAULT 5,   -- NULL = no age check
        CapTransfer            DECIMAL(6,2) NOT NULL DEFAULT 68,  -- transfer applicants / admitted transfers
        CapFirstYear           DECIMAL(6,2) NOT NULL DEFAULT 60,  -- dual-enrollment / first-year entrants
        CapCurrentStudent      DECIMAL(6,2) NOT NULL DEFAULT 68,
        AllowPassFail          BIT          NOT NULL DEFAULT 0,   -- 0 = P/F goes to review
        RequireAccreditation   BIT          NOT NULL DEFAULT 1,
        HubRequirementsTransfer INT         NOT NULL DEFAULT 10,
        HubCocurricularAllowed INT          NOT NULL DEFAULT 1,
        UpdatedAt              DATETIME2    NOT NULL DEFAULT SYSUTCDATETIME(),
        UpdatedBy              UNIQUEIDENTIFIER NULL,
        CONSTRAINT PK_TransferPolicies PRIMARY KEY (Id),
        CONSTRAINT FK_TP_Institution FOREIGN KEY (InstitutionId) REFERENCES Institutions(Id),
        CONSTRAINT CK_TP_MinGrade CHECK (MinGrade IN ('A','A-','B+','B','B-','C+','C','C-','D+','D','D-'))
    );
    CREATE UNIQUE INDEX UX_TP_Institution ON TransferPolicies (InstitutionId) WHERE InstitutionId IS NOT NULL;
END
GO

-- ─── Institutions: accreditation ─────────────────────────────
IF COL_LENGTH('Institutions', 'IsAccredited') IS NULL
    ALTER TABLE Institutions ADD IsAccredited BIT NULL;           -- NULL = not recorded
GO
IF COL_LENGTH('Institutions', 'Accreditor') IS NULL
    ALTER TABLE Institutions ADD Accreditor NVARCHAR(100) NULL;   -- e.g. NECHE, MSCHE
GO

-- ─── StudentProfiles: application details ───────────────────
IF COL_LENGTH('StudentProfiles', 'ApplicantType') IS NULL
    ALTER TABLE StudentProfiles ADD ApplicantType VARCHAR(20) NULL;  -- transfer_applicant | admitted_transfer | current_student | dual_enrollment
GO
IF COL_LENGTH('StudentProfiles', 'AdmissionStatus') IS NULL
    ALTER TABLE StudentProfiles ADD AdmissionStatus VARCHAR(10) NOT NULL CONSTRAINT DF_SP_AdmissionStatus DEFAULT 'applicant';  -- applicant | admitted
GO
IF COL_LENGTH('StudentProfiles', 'IntendedAcademicUnitId') IS NULL
    ALTER TABLE StudentProfiles ADD IntendedAcademicUnitId INT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_SP_IntendedUnit')
    ALTER TABLE StudentProfiles ADD CONSTRAINT FK_SP_IntendedUnit FOREIGN KEY (IntendedAcademicUnitId) REFERENCES AcademicUnits(Id);
GO
IF COL_LENGTH('StudentProfiles', 'EntryTerm') IS NULL
    ALTER TABLE StudentProfiles ADD EntryTerm VARCHAR(10) NULL, EntryYear INT NULL;
GO
IF COL_LENGTH('StudentProfiles', 'IsNativeEnglish') IS NULL
    ALTER TABLE StudentProfiles ADD IsNativeEnglish BIT NULL, EnglishTestType VARCHAR(10) NULL, EnglishTestScore NVARCHAR(20) NULL;
GO
IF COL_LENGTH('StudentProfiles', 'HasIntlCoursework') IS NULL
    ALTER TABLE StudentProfiles ADD HasIntlCoursework BIT NULL;
GO
IF COL_LENGTH('StudentProfiles', 'HighSchoolName') IS NULL
    ALTER TABLE StudentProfiles ADD HighSchoolName NVARCHAR(200) NULL, HighSchoolGradYear INT NULL, CreditsCompleted DECIMAL(6,2) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_SP_ApplicantType')
    ALTER TABLE StudentProfiles ADD CONSTRAINT CK_SP_ApplicantType
        CHECK (ApplicantType IS NULL OR ApplicantType IN ('transfer_applicant','admitted_transfer','current_student','dual_enrollment'));
GO
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_SP_AdmissionStatus')
    ALTER TABLE StudentProfiles ADD CONSTRAINT CK_SP_AdmissionStatus CHECK (AdmissionStatus IN ('applicant','admitted'));
GO

-- ─── StudentEducation (every institution attended) ──────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'StudentEducation')
BEGIN
    CREATE TABLE StudentEducation (
        Id              INT              NOT NULL IDENTITY(1,1),
        UserId          UNIQUEIDENTIFIER NOT NULL,
        InstitutionName NVARCHAR(200)    NOT NULL,
        InstitutionId   INT              NULL,
        City            NVARCHAR(100)    NULL,
        StateRegion     NVARCHAR(100)    NULL,
        Country         NVARCHAR(100)    NULL,
        IsOutsideUS     BIT              NOT NULL DEFAULT 0,
        FromYear        INT              NULL,
        ToYear          INT              NULL,
        CreditsEarned   DECIMAL(6,2)     NULL,
        FullTime        BIT              NULL,
        SortOrder       INT              NOT NULL DEFAULT 0,
        CreatedAt       DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_StudentEducation PRIMARY KEY (Id),
        CONSTRAINT FK_SE_User FOREIGN KEY (UserId) REFERENCES Users(Id) ON DELETE CASCADE,
        CONSTRAINT FK_SE_Institution FOREIGN KEY (InstitutionId) REFERENCES Institutions(Id)
    );
    CREATE INDEX IX_SE_User ON StudentEducation (UserId);
END
GO

-- ─── StudentExamCredits (AP / IB / A-level) ──────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'StudentExamCredits')
BEGIN
    CREATE TABLE StudentExamCredits (
        Id        INT              NOT NULL IDENTITY(1,1),
        UserId    UNIQUEIDENTIFIER NOT NULL,
        ExamType  VARCHAR(10)      NOT NULL,      -- AP | IB | A-level
        Subject   NVARCHAR(150)    NOT NULL,
        Score     NVARCHAR(10)     NULL,
        ExamYear  INT              NULL,
        Credits   DECIMAL(5,2)     NULL,          -- BU credits once evaluated; counts toward the cap
        CreatedAt DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_StudentExamCredits PRIMARY KEY (Id),
        CONSTRAINT FK_SEC_User FOREIGN KEY (UserId) REFERENCES Users(Id) ON DELETE CASCADE,
        CONSTRAINT CK_SEC_Type CHECK (ExamType IN ('AP','IB','A-level'))
    );
    CREATE INDEX IX_SEC_User ON StudentExamCredits (UserId);
END
GO

-- ─── TranscriptCourses: per-course attributes + policy flags ─
IF COL_LENGTH('TranscriptCourses', 'TermSeason') IS NULL
    ALTER TABLE TranscriptCourses ADD TermSeason VARCHAR(10) NULL, TermYear INT NULL;
GO
IF COL_LENGTH('TranscriptCourses', 'GradingBasis') IS NULL
    ALTER TABLE TranscriptCourses ADD GradingBasis VARCHAR(10) NULL;     -- graded | pass_fail | sat_unsat
GO
IF COL_LENGTH('TranscriptCourses', 'DeliveryMode') IS NULL
    ALTER TABLE TranscriptCourses ADD DeliveryMode VARCHAR(10) NULL;     -- in_person | online | hybrid
GO
IF COL_LENGTH('TranscriptCourses', 'CourseType') IS NULL
    ALTER TABLE TranscriptCourses ADD CourseType VARCHAR(16) NULL;       -- lecture | lab | seminar | internship | research | military | life_experience | other
GO
IF COL_LENGTH('TranscriptCourses', 'IsOutsideUS') IS NULL
    ALTER TABLE TranscriptCourses ADD IsOutsideUS BIT NOT NULL CONSTRAINT DF_TC_IsOutsideUS DEFAULT 0;
GO
IF COL_LENGTH('TranscriptCourses', 'PassFailException') IS NULL
    ALTER TABLE TranscriptCourses ADD PassFailException BIT NOT NULL CONSTRAINT DF_TC_PFException DEFAULT 0;
GO
IF COL_LENGTH('TranscriptCourses', 'PolicyFlags') IS NULL
    ALTER TABLE TranscriptCourses ADD PolicyFlags NVARCHAR(MAX) NULL;    -- JSON array of {code, message}
GO

-- ─── Transcripts: preview vs official vs pre-approval ───────
IF COL_LENGTH('Transcripts', 'EvaluationKind') IS NULL
    ALTER TABLE Transcripts ADD EvaluationKind VARCHAR(12) NOT NULL CONSTRAINT DF_T_EvalKind DEFAULT 'official';
GO
IF COL_LENGTH('Transcripts', 'PreapprovalExpiresAt') IS NULL
    ALTER TABLE Transcripts ADD PreapprovalExpiresAt DATETIME2 NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_T_EvalKind')
    ALTER TABLE Transcripts ADD CONSTRAINT CK_T_EvalKind CHECK (EvaluationKind IN ('preview','official','preapproval'));
GO

-- ─── CourseAppeals ───────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CourseAppeals')
BEGIN
    CREATE TABLE CourseAppeals (
        Id                   INT              NOT NULL IDENTITY(1,1),
        TranscriptCourseId   UNIQUEIDENTIFIER NOT NULL,
        TranscriptId         UNIQUEIDENTIFIER NOT NULL,
        StudentUserId        UNIQUEIDENTIFIER NOT NULL,
        SubmittedByUserId    UNIQUEIDENTIFIER NOT NULL,
        ProposedBUCourseId   INT              NULL,
        ProposedEquivalent   NVARCHAR(200)    NULL,      -- free text when no catalog course is picked
        Reason               NVARCHAR(MAX)    NOT NULL,
        SyllabusUploadId     UNIQUEIDENTIFIER NULL,
        Status               VARCHAR(10)      NOT NULL DEFAULT 'submitted',   -- submitted | decided | withdrawn
        Outcome              VARCHAR(12)      NULL,      -- equivalent | elective | no_credit | denied
        DecidedBUCourseId    INT              NULL,
        AwardedCredits       DECIMAL(5,2)     NULL,
        SatisfiesRequirement NVARCHAR(300)    NULL,
        DenialReason         NVARCHAR(1000)   NULL,
        DepartmentName       NVARCHAR(150)    NULL,
        DepartmentComments   NVARCHAR(MAX)    NULL,
        SignedName           NVARCHAR(150)    NULL,
        DecidedBy            UNIQUEIDENTIFIER NULL,
        DecidedAt            DATETIME2        NULL,
        CreatedAt            DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_CourseAppeals PRIMARY KEY (Id),
        CONSTRAINT FK_CA_Course FOREIGN KEY (TranscriptCourseId) REFERENCES TranscriptCourses(Id),
        CONSTRAINT FK_CA_Transcript FOREIGN KEY (TranscriptId) REFERENCES Transcripts(Id) ON DELETE CASCADE,
        CONSTRAINT FK_CA_Student FOREIGN KEY (StudentUserId) REFERENCES Users(Id),
        CONSTRAINT FK_CA_Proposed FOREIGN KEY (ProposedBUCourseId) REFERENCES Courses(Id),
        CONSTRAINT FK_CA_Decided FOREIGN KEY (DecidedBUCourseId) REFERENCES Courses(Id),
        CONSTRAINT FK_CA_Upload FOREIGN KEY (SyllabusUploadId) REFERENCES Uploads(Id),
        CONSTRAINT CK_CA_Status CHECK (Status IN ('submitted','decided','withdrawn')),
        CONSTRAINT CK_CA_Outcome CHECK (Outcome IS NULL OR Outcome IN ('equivalent','elective','no_credit','denied'))
    );
    CREATE INDEX IX_CA_Status ON CourseAppeals (Status, CreatedAt);
    CREATE INDEX IX_CA_Transcript ON CourseAppeals (TranscriptId);
END
GO

PRINT 'Migration 015 applied: BU policy alignment.';
GO
