-- ============================================================
-- Migration 012 - Student self-registration fields
-- ============================================================
-- Supports the public student registration page: captures education
-- history and a target University/Program, in addition to the
-- communications/location fields Users already has (Mobile, AddressLine1/2,
-- City, State, PostalCode, Country, CountryOfOrigin — migration 002).
--
-- TargetInstitutionId/TargetProgramId are purely informational (the
-- University/Program a student says they're transferring into) — they do
-- NOT add a UserScopeUniversities row, so registering doesn't narrow a
-- student's own visibility (CLAUDE.md: students default to seeing every
-- University unless an admin explicitly restricts them).
--
-- Idempotent: safe to re-run (IF NOT EXISTS guards, matching every other
-- consolidated migration file).
-- ============================================================
USE TransferHubDB;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('StudentProfiles') AND name = 'TargetInstitutionId')
    ALTER TABLE StudentProfiles ADD TargetInstitutionId INT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_SP_TargetInstitution')
    ALTER TABLE StudentProfiles ADD CONSTRAINT FK_SP_TargetInstitution FOREIGN KEY (TargetInstitutionId) REFERENCES Institutions(Id);
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('StudentProfiles') AND name = 'TargetProgramId')
    ALTER TABLE StudentProfiles ADD TargetProgramId INT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_SP_TargetProgram')
    ALTER TABLE StudentProfiles ADD CONSTRAINT FK_SP_TargetProgram FOREIGN KEY (TargetProgramId) REFERENCES Programs(Id);
GO

-- Education history (free text — a student's prior school is very likely
-- not in our Institutions catalog, which only tracks universities this
-- product actually evaluates transfers for/from).
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('StudentProfiles') AND name = 'PriorInstitutionName')
    ALTER TABLE StudentProfiles ADD
        PriorInstitutionName   NVARCHAR(200) NULL,
        HighestEducationLevel  NVARCHAR(100) NULL,  -- e.g. High School, Associate's, Bachelor's
        FieldOfStudy           NVARCHAR(200) NULL,
        GPA                    DECIMAL(3,2)  NULL,
        GraduationYear         INT           NULL;
GO

-- Emergency contact (communications).
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('StudentProfiles') AND name = 'EmergencyContactName')
    ALTER TABLE StudentProfiles ADD
        EmergencyContactName  NVARCHAR(200) NULL,
        EmergencyContactPhone NVARCHAR(30)  NULL;
GO
