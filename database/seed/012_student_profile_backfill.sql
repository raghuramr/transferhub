-- ============================================================
-- Seed 012 - Fill in the profile details of every existing student
-- ============================================================
-- Only touches NULL / missing values, so real data entered by a student or
-- admin is never overwritten and the script is safe to re-run. Values are
-- picked deterministically from a hash of the user id (no RAND), so a re-run
-- produces the same result. Covers: contact + address (Users), the profile
-- (target university/program/school, applicant type, entry term, education,
-- English, GPA, emergency contact) and one education-history row.
-- ============================================================
USE TransferHubDB;
GO

-- 1. A profile row for every student.
INSERT INTO StudentProfiles (UserId)
SELECT u.Id FROM Users u JOIN Roles r ON r.Id = u.RoleId
WHERE r.Name = 'student' AND NOT EXISTS (SELECT 1 FROM StudentProfiles sp WHERE sp.UserId = u.Id);
GO

IF OBJECT_ID('tempdb..#S') IS NOT NULL DROP TABLE #S;
SELECT u.Id AS UserId, u.FirstName, u.LastName,
       ABS(CHECKSUM(CAST(u.Id AS NVARCHAR(36)))) AS H
INTO #S
FROM Users u JOIN Roles r ON r.Id = u.RoleId
WHERE r.Name = 'student';
GO

-- 2. Contact + address on Users.
UPDATE u SET
    Mobile          = COALESCE(u.Mobile, CONCAT('+1-617-555-', RIGHT('0000' + CAST(s.H % 10000 AS VARCHAR(4)), 4))),
    AddressLine1    = COALESCE(u.AddressLine1, CONCAT(100 + s.H % 900, ' ', CHOOSE(s.H % 8 + 1, 'Main St', 'Commonwealth Ave', 'Beacon St', 'Maple Ave', 'Oak St', 'College Rd', 'Park Ave', 'Elm St'))),
    City            = COALESCE(u.City, CHOOSE(s.H % 8 + 1, 'Boston', 'Cambridge', 'Somerville', 'Worcester', 'Providence', 'New York', 'Newark', 'Hartford')),
    State           = COALESCE(u.State, CHOOSE(s.H % 8 + 1, 'MA', 'MA', 'MA', 'MA', 'RI', 'NY', 'NJ', 'CT')),
    PostalCode      = COALESCE(u.PostalCode, CONCAT('0', RIGHT('0000' + CAST(2000 + s.H % 800 AS VARCHAR(4)), 4))),
    Country         = COALESCE(u.Country, 'United States'),
    CountryOfOrigin = COALESCE(u.CountryOfOrigin, CHOOSE(s.H % 10 + 1, 'United States', 'United States', 'United States', 'India', 'China', 'Brazil', 'Nigeria', 'Canada', 'Vietnam', 'South Korea')),
    StudentId       = COALESCE(u.StudentId, CONCAT('TH-', RIGHT('000000' + CAST(s.H % 1000000 AS VARCHAR(6)), 6)))
FROM Users u JOIN #S s ON s.UserId = u.Id;
GO

-- 3. Profile columns.
DECLARE @UniCount INT = (SELECT COUNT(*) FROM Institutions WHERE IsActive = 1);

;WITH Unis AS (
    SELECT Id, ROW_NUMBER() OVER (ORDER BY Id) AS Rn FROM Institutions WHERE IsActive = 1
)
UPDATE sp SET
    PriorInstitutionName  = COALESCE(sp.PriorInstitutionName, CHOOSE(s.H % 10 + 1,
        'Bunker Hill Community College', 'Middlesex Community College', 'Northern Virginia Community College', 'Santa Monica College',
        'Miami Dade College', 'Houston Community College', 'Borough of Manhattan Community College', 'De Anza College',
        'Montgomery College', 'Portland Community College')),
    HighestEducationLevel = COALESCE(sp.HighestEducationLevel, CHOOSE(s.H % 4 + 1, 'High School', 'Associate''s', 'High School', 'Associate''s')),
    FieldOfStudy          = COALESCE(sp.FieldOfStudy, CHOOSE(s.H % 9 + 1, 'Computer Science', 'Business Administration', 'Biology', 'Psychology',
        'Mechanical Engineering', 'Economics', 'Communications', 'Mathematics', 'Data Science')),
    GPA                   = COALESCE(sp.GPA, CAST(2.60 + (s.H % 136) / 100.0 AS DECIMAL(3,2))),
    GraduationYear        = COALESCE(sp.GraduationYear, 2026 + s.H % 3),
    EmergencyContactName  = COALESCE(sp.EmergencyContactName, CONCAT(CHOOSE(s.H % 6 + 1, 'Anita', 'David', 'Maria', 'James', 'Priya', 'Carlos'), ' ', s.LastName)),
    EmergencyContactPhone = COALESCE(sp.EmergencyContactPhone, CONCAT('+1-617-555-', RIGHT('0000' + CAST((s.H / 7) % 10000 AS VARCHAR(4)), 4))),
    TargetInstitutionId   = COALESCE(sp.TargetInstitutionId, (SELECT Id FROM Unis WHERE Rn = s.H % NULLIF(@UniCount, 0) + 1)),
    ApplicantType         = COALESCE(sp.ApplicantType, CHOOSE(s.H % 10 + 1, 'admitted_transfer', 'admitted_transfer', 'admitted_transfer', 'admitted_transfer', 'admitted_transfer',
                              'admitted_transfer', 'transfer_applicant', 'transfer_applicant', 'transfer_applicant', 'current_student')),
    EntryTerm             = COALESCE(sp.EntryTerm, CHOOSE(s.H % 3 + 1, 'fall', 'spring', 'fall')),
    EntryYear             = COALESCE(sp.EntryYear, 2026 + s.H % 2),
    IsNativeEnglish       = COALESCE(sp.IsNativeEnglish, CASE WHEN s.H % 10 < 7 THEN 1 ELSE 0 END),
    HasIntlCoursework     = COALESCE(sp.HasIntlCoursework, CASE WHEN s.H % 10 = 0 THEN 1 ELSE 0 END),
    HighSchoolName        = COALESCE(sp.HighSchoolName, CONCAT(CHOOSE(s.H % 6 + 1, 'Lincoln', 'Roosevelt', 'Washington', 'Jefferson', 'Kennedy', 'Franklin'), ' High School')),
    HighSchoolGradYear    = COALESCE(sp.HighSchoolGradYear, 2020 + s.H % 4),
    CreditsCompleted      = COALESCE(sp.CreditsCompleted, CAST(24 + (s.H % 5) * 8 AS DECIMAL(6,2))),
    UpdatedAt             = SYSUTCDATETIME()
FROM StudentProfiles sp JOIN #S s ON s.UserId = sp.UserId;
GO

-- English test only for non-native speakers; admission status follows applicant type.
UPDATE sp SET
    EnglishTestType  = COALESCE(sp.EnglishTestType, CHOOSE(s.H % 3 + 1, 'TOEFL', 'IELTS', 'Duolingo')),
    EnglishTestScore = COALESCE(sp.EnglishTestScore, CHOOSE(s.H % 3 + 1, '98', '7.0', '120'))
FROM StudentProfiles sp JOIN #S s ON s.UserId = sp.UserId
WHERE sp.IsNativeEnglish = 0;
GO
UPDATE sp SET AdmissionStatus = CASE WHEN sp.ApplicantType IN ('admitted_transfer', 'current_student') THEN 'admitted' ELSE 'applicant' END
FROM StudentProfiles sp JOIN #S s ON s.UserId = sp.UserId;
GO

-- Target program: one that the target university offers.
;WITH Offered AS (
    SELECT pu.InstitutionId, pu.ProgramId, ROW_NUMBER() OVER (PARTITION BY pu.InstitutionId ORDER BY pu.ProgramId) AS Rn,
           COUNT(*) OVER (PARTITION BY pu.InstitutionId) AS Cnt
    FROM ProgramUniversities pu JOIN Programs p ON p.Id = pu.ProgramId AND p.IsActive = 1
)
UPDATE sp SET TargetProgramId = o.ProgramId
FROM StudentProfiles sp JOIN #S s ON s.UserId = sp.UserId
JOIN Offered o ON o.InstitutionId = sp.TargetInstitutionId AND o.Rn = s.H % o.Cnt + 1
WHERE sp.TargetProgramId IS NULL;
GO

-- Intended school/college: one of the target university's academic units.
;WITH Units AS (
    SELECT au.Id, au.InstitutionId, ROW_NUMBER() OVER (PARTITION BY au.InstitutionId ORDER BY au.Id) AS Rn,
           COUNT(*) OVER (PARTITION BY au.InstitutionId) AS Cnt
    FROM AcademicUnits au WHERE au.IsActive = 1
)
UPDATE sp SET IntendedAcademicUnitId = un.Id
FROM StudentProfiles sp JOIN #S s ON s.UserId = sp.UserId
JOIN Units un ON un.InstitutionId = sp.TargetInstitutionId AND un.Rn = s.H % un.Cnt + 1
WHERE sp.IntendedAcademicUnitId IS NULL;
GO

-- 4. One education-history row for students that have none.
INSERT INTO StudentEducation (UserId, InstitutionName, City, StateRegion, Country, IsOutsideUS, FromYear, ToYear, CreditsEarned, FullTime, SortOrder)
SELECT sp.UserId, sp.PriorInstitutionName, u.City, u.State, 'United States', 0,
       COALESCE(sp.GraduationYear, 2026) - 2, COALESCE(sp.GraduationYear, 2026), sp.CreditsCompleted, 1, 0
FROM StudentProfiles sp
JOIN Users u ON u.Id = sp.UserId
JOIN #S s ON s.UserId = sp.UserId
WHERE sp.PriorInstitutionName IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM StudentEducation se WHERE se.UserId = sp.UserId);
GO

DROP TABLE #S;
GO
