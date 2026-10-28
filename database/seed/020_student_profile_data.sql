-- ============================================================
-- Seed 020 - Complete, consistent profile for EVERY student
-- ============================================================
-- Goal: the profile page (Education & Background, University & program, Contact) never shows
-- "Not provided" for a student. Re-runnable and deterministic (hash of the user id, no RAND).
--
-- Rules
--   * Only NULL / empty values are filled; real input by a student or admin is never overwritten.
--   * One exception: values that are STILL the synthetic placeholders seed 012 wrote (its fixed list
--     of 10 community colleges as the prior institution, or no prior institution at all) are treated
--     as "not real yet" and are replaced by consistent data - for students with transcripts, the SOURCE
--     institution of their latest transcript; for Maya Rivera (student@test.edu), her scripted story:
--     Bay State Community College (+ Pioneer Valley Technical College), Associate's, Computer Science,
--     GPA 3.64, graduating 2026, target BU's Computer Science program.
--   * TargetInstitutionId: seed 017's choice is kept; it is only replaced when empty or not a receiving
--     university (inactive / community college / BSCC / PVTC). Maya -> BU.
--   * TargetProgramId: filled (or repaired when the program is not offered by the target) with a program
--     from ProgramUniversities, preferring one whose Area matches the field of study.
--   * One StudentEducation row per source institution of the student's transcripts, else one row for the
--     prior institution (only when the student has none with that name).
--   * CreditsCompleted: sum of the student's transcript course credits when they have any.
-- Needs migrations 012, 015 (StudentProfiles / StudentEducation columns) and 011 (ProgramUniversities).
-- Run after seeds 003, 012, 015 and 017. Ends with a summary of what is still missing.
-- ============================================================
USE TransferHubDB;
GO

SET NOCOUNT ON;

-- 0. A profile row for every student.
INSERT INTO StudentProfiles (UserId)
SELECT u.Id FROM Users u JOIN Roles r ON r.Id = u.RoleId
WHERE r.Name = 'student' AND NOT EXISTS (SELECT 1 FROM StudentProfiles sp WHERE sp.UserId = u.Id);
GO

-- 1. Working set with a stable hash, the latest transcript's source institution and "still synthetic?".
IF OBJECT_ID('tempdb..#S') IS NOT NULL DROP TABLE #S;
SELECT u.Id AS UserId, u.FirstName, u.LastName,
       CASE WHEN u.Email = 'student@test.edu' THEN 1 ELSE 0 END AS IsMaya,
       ABS(CAST(CHECKSUM(CONCAT('p020:', CAST(u.Id AS NVARCHAR(36)))) AS BIGINT)) AS H,
       sp.PriorInstitutionName AS OldPrior,
       CAST(CASE WHEN NULLIF(LTRIM(RTRIM(sp.PriorInstitutionName)), '') IS NULL
                   OR sp.PriorInstitutionName IN (
                        'Bunker Hill Community College', 'Middlesex Community College', 'Northern Virginia Community College', 'Santa Monica College',
                        'Miami Dade College', 'Houston Community College', 'Borough of Manhattan Community College', 'De Anza College',
                        'Montgomery College', 'Portland Community College')
                 THEN 1 ELSE 0 END AS BIT) AS Synth,
       src.InstitutionId AS SrcId, src.Name AS SrcName
INTO #S
FROM Users u
JOIN Roles r ON r.Id = u.RoleId AND r.Name = 'student'
JOIN StudentProfiles sp ON sp.UserId = u.Id
OUTER APPLY (
    SELECT TOP 1 t.InstitutionId, i.Name
    FROM Transcripts t JOIN Institutions i ON i.Id = t.InstitutionId
    WHERE t.StudentUserId = u.Id
    ORDER BY t.ReceivedAt DESC
) src;

-- Maya's story: her source is Bay State, whatever order her two demo transcripts were created in.
UPDATE s SET SrcId = i.Id, SrcName = i.Name
FROM #S s CROSS JOIN Institutions i
WHERE s.IsMaya = 1 AND i.Code = 'BSCC';

-- Receiving universities (same definition as seed 017).
IF OBJECT_ID('tempdb..#U') IS NOT NULL DROP TABLE #U;
SELECT i.Id, ROW_NUMBER() OVER (ORDER BY i.Id) AS Rn
INTO #U
FROM Institutions i
WHERE i.IsActive = 1 AND i.Type = 'university' AND i.Code NOT IN ('BSCC', 'PVTC');
GO

-- 2. Contact + address on Users (fills NULL / empty only).
UPDATE u SET
    Mobile          = COALESCE(NULLIF(LTRIM(RTRIM(u.Mobile)), ''),
                        CASE WHEN s.IsMaya = 1 THEN '+1-617-555-0142'
                             ELSE CONCAT('+1-617-555-', RIGHT('0000' + CAST(s.H % 10000 AS VARCHAR(4)), 4)) END),
    AddressLine1    = COALESCE(NULLIF(LTRIM(RTRIM(u.AddressLine1)), ''),
                        CASE WHEN s.IsMaya = 1 THEN '48 Harbor View Rd'
                             ELSE CONCAT(100 + s.H % 900, ' ', CHOOSE(s.H % 8 + 1, 'Main St', 'Commonwealth Ave', 'Beacon St', 'Maple Ave', 'Oak St', 'College Rd', 'Park Ave', 'Elm St')) END),
    City            = COALESCE(NULLIF(LTRIM(RTRIM(u.City)), ''),
                        CASE WHEN s.IsMaya = 1 THEN 'Quincy'
                             ELSE CHOOSE(s.H % 8 + 1, 'Boston', 'Cambridge', 'Somerville', 'Worcester', 'Providence', 'New York', 'Newark', 'Hartford') END),
    State           = COALESCE(NULLIF(LTRIM(RTRIM(u.State)), ''),
                        CASE WHEN s.IsMaya = 1 THEN 'MA'
                             ELSE CHOOSE(s.H % 8 + 1, 'MA', 'MA', 'MA', 'MA', 'RI', 'NY', 'NJ', 'CT') END),
    PostalCode      = COALESCE(NULLIF(LTRIM(RTRIM(u.PostalCode)), ''),
                        CASE WHEN s.IsMaya = 1 THEN '02169'
                             ELSE CONCAT('0', RIGHT('0000' + CAST(2000 + s.H % 800 AS VARCHAR(4)), 4)) END),
    Country         = COALESCE(NULLIF(LTRIM(RTRIM(u.Country)), ''), 'United States'),
    CountryOfOrigin = COALESCE(NULLIF(LTRIM(RTRIM(u.CountryOfOrigin)), ''),
                        CASE WHEN s.IsMaya = 1 THEN 'United States'
                             ELSE CHOOSE(s.H % 10 + 1, 'United States', 'United States', 'United States', 'India', 'China', 'Brazil', 'Nigeria', 'Canada', 'Vietnam', 'South Korea') END),
    StudentId       = COALESCE(NULLIF(LTRIM(RTRIM(u.StudentId)), ''), CONCAT('TH-', RIGHT('000000' + CAST(s.H % 1000000 AS VARCHAR(6)), 6)))
FROM Users u JOIN #S s ON s.UserId = u.Id;
GO

-- 3a. Prior / current institution: transcript source (or Maya's story) where the value is still synthetic.
UPDATE sp SET
    PriorInstitutionName = CASE
        WHEN s.Synth = 1 AND s.SrcName IS NOT NULL THEN s.SrcName
        ELSE COALESCE(NULLIF(LTRIM(RTRIM(sp.PriorInstitutionName)), ''),
                      s.SrcName,
                      CHOOSE(s.H % 10 + 1,
                        'Bunker Hill Community College', 'Middlesex Community College', 'Northern Virginia Community College', 'Santa Monica College',
                        'Miami Dade College', 'Houston Community College', 'Borough of Manhattan Community College', 'De Anza College',
                        'Montgomery College', 'Portland Community College')) END,
    UpdatedAt = SYSUTCDATETIME()
FROM StudentProfiles sp JOIN #S s ON s.UserId = sp.UserId;
GO

-- 3b. The rest of the education / emergency-contact fields. Maya (still synthetic) gets her scripted values.
UPDATE sp SET
    HighestEducationLevel = CASE WHEN s.IsMaya = 1 AND s.Synth = 1 THEN 'Associate''s'
        ELSE COALESCE(NULLIF(LTRIM(RTRIM(sp.HighestEducationLevel)), ''), CHOOSE(s.H % 4 + 1, 'High School', 'Associate''s', 'High School', 'Associate''s')) END,
    FieldOfStudy = CASE WHEN s.IsMaya = 1 AND s.Synth = 1 THEN 'Computer Science'
        ELSE COALESCE(NULLIF(LTRIM(RTRIM(sp.FieldOfStudy)), ''), CHOOSE(s.H % 9 + 1, 'Computer Science', 'Business Administration', 'Biology', 'Psychology',
            'Mechanical Engineering', 'Economics', 'Communications', 'Mathematics', 'Data Science')) END,
    GPA = CASE WHEN s.IsMaya = 1 AND s.Synth = 1 THEN CAST(3.64 AS DECIMAL(3,2))
        ELSE COALESCE(sp.GPA, CAST(2.60 + (s.H % 136) / 100.0 AS DECIMAL(3,2))) END,
    GraduationYear = CASE WHEN s.IsMaya = 1 AND s.Synth = 1 THEN 2026
        ELSE COALESCE(sp.GraduationYear, 2026 + s.H % 3) END,
    EmergencyContactName = CASE WHEN s.IsMaya = 1 AND s.Synth = 1 THEN 'Elena Rivera'
        ELSE COALESCE(NULLIF(LTRIM(RTRIM(sp.EmergencyContactName)), ''),
            CONCAT(CHOOSE(s.H % 6 + 1, 'Anita', 'David', 'Maria', 'James', 'Priya', 'Carlos'), ' ', s.LastName)) END,
    EmergencyContactPhone = CASE WHEN s.IsMaya = 1 AND s.Synth = 1 THEN '+1-617-555-0173'
        ELSE COALESCE(NULLIF(LTRIM(RTRIM(sp.EmergencyContactPhone)), ''),
            CONCAT('+1-617-555-', RIGHT('0000' + CAST((s.H / 7) % 10000 AS VARCHAR(4)), 4))) END,
    UpdatedAt = SYSUTCDATETIME()
FROM StudentProfiles sp JOIN #S s ON s.UserId = sp.UserId;

-- Program area follows the field of study when empty.
UPDATE sp SET ProgramArea = sp.FieldOfStudy, UpdatedAt = SYSUTCDATETIME()
FROM StudentProfiles sp JOIN #S s ON s.UserId = sp.UserId
WHERE NULLIF(LTRIM(RTRIM(sp.ProgramArea)), '') IS NULL;
GO

-- 3c. Target university: keep seed 017's choice; repair only an empty / non-receiving one. Maya -> BU.
DECLARE @UniCount INT = (SELECT COUNT(*) FROM #U);
UPDATE sp SET
    TargetInstitutionId = CASE
        WHEN s.IsMaya = 1 AND s.Synth = 1 THEN (SELECT Id FROM Institutions WHERE Code = 'BU')
        ELSE (SELECT Id FROM #U WHERE Rn = s.H % NULLIF(@UniCount, 0) + 1) END,
    UpdatedAt = SYSUTCDATETIME()
FROM StudentProfiles sp JOIN #S s ON s.UserId = sp.UserId
WHERE (s.IsMaya = 1 AND s.Synth = 1 AND ISNULL(sp.TargetInstitutionId, -1) <> (SELECT Id FROM Institutions WHERE Code = 'BU'))
   OR sp.TargetInstitutionId IS NULL
   OR NOT EXISTS (SELECT 1 FROM #U x WHERE x.Id = sp.TargetInstitutionId);
GO

-- 3d. Target program: must be offered by the target university; prefer the field-of-study match.
UPDATE sp SET TargetProgramId = NULL
FROM StudentProfiles sp JOIN #S s ON s.UserId = sp.UserId
WHERE sp.TargetProgramId IS NOT NULL
  AND (   NOT EXISTS (SELECT 1 FROM ProgramUniversities pu WHERE pu.ProgramId = sp.TargetProgramId AND pu.InstitutionId = sp.TargetInstitutionId)
       OR NOT EXISTS (SELECT 1 FROM Programs p WHERE p.Id = sp.TargetProgramId AND p.IsActive = 1));
GO
;WITH Cand AS (
    SELECT sp.UserId, p.Id AS ProgramId,
           ROW_NUMBER() OVER (
               PARTITION BY sp.UserId
               ORDER BY CASE WHEN p.Area = sp.FieldOfStudy THEN 0 WHEN p.Area = sp.ProgramArea THEN 1 ELSE 2 END, p.Id) AS Rn
    FROM StudentProfiles sp
    JOIN #S s ON s.UserId = sp.UserId
    JOIN ProgramUniversities pu ON pu.InstitutionId = sp.TargetInstitutionId
    JOIN Programs p ON p.Id = pu.ProgramId AND p.IsActive = 1
    WHERE sp.TargetProgramId IS NULL
)
UPDATE sp SET TargetProgramId = c.ProgramId, UpdatedAt = SYSUTCDATETIME()
FROM StudentProfiles sp JOIN Cand c ON c.UserId = sp.UserId AND c.Rn = 1;
GO

-- Intended school/college must belong to the target university.
UPDATE sp SET IntendedAcademicUnitId = NULL
FROM StudentProfiles sp JOIN #S s ON s.UserId = sp.UserId
WHERE sp.IntendedAcademicUnitId IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM AcademicUnits au WHERE au.Id = sp.IntendedAcademicUnitId AND au.InstitutionId = sp.TargetInstitutionId);
GO

-- 3e. Credits completed = what their transcripts list (when they have any).
UPDATE sp SET CreditsCompleted = c.Total, UpdatedAt = SYSUTCDATETIME()
FROM StudentProfiles sp
JOIN #S s ON s.UserId = sp.UserId
JOIN (
    SELECT t.StudentUserId AS UserId, SUM(COALESCE(tc.NormalisedCredits, tc.OriginalCredits)) AS Total
    FROM Transcripts t JOIN TranscriptCourses tc ON tc.TranscriptId = t.Id
    GROUP BY t.StudentUserId
) c ON c.UserId = sp.UserId
WHERE c.Total IS NOT NULL AND (sp.CreditsCompleted IS NULL OR s.Synth = 1);

UPDATE sp SET CreditsCompleted = CAST(CASE WHEN s.IsMaya = 1 THEN 30 ELSE 24 + (s.H % 5) * 8 END AS DECIMAL(6,2)), UpdatedAt = SYSUTCDATETIME()
FROM StudentProfiles sp JOIN #S s ON s.UserId = sp.UserId
WHERE sp.CreditsCompleted IS NULL;
GO

-- 4. Education history. First rename the placeholder row seed 012 created, then add what is missing.
UPDATE se SET
    InstitutionName = s.SrcName,
    InstitutionId   = s.SrcId,
    FromYear        = CASE WHEN s.IsMaya = 1 THEN 2024 ELSE se.FromYear END,
    ToYear          = CASE WHEN s.IsMaya = 1 THEN 2026 ELSE se.ToYear END
FROM StudentEducation se JOIN #S s ON s.UserId = se.UserId
WHERE s.Synth = 1 AND s.SrcName IS NOT NULL AND s.OldPrior IS NOT NULL
  AND se.InstitutionName = s.OldPrior AND se.InstitutionName <> s.SrcName;

-- One row per transcript source institution the student has no row for yet.
INSERT INTO StudentEducation (UserId, InstitutionName, InstitutionId, City, StateRegion, Country, IsOutsideUS, FromYear, ToYear, CreditsEarned, FullTime, SortOrder)
SELECT s.UserId, i.Name, i.Id, u.City, u.State, 'United States', 0,
       CASE WHEN s.IsMaya = 1 AND i.Code = 'PVTC' THEN 2023 WHEN s.IsMaya = 1 THEN 2024 ELSE COALESCE(sp.GraduationYear, 2026) - 2 END,
       CASE WHEN s.IsMaya = 1 AND i.Code = 'PVTC' THEN 2024 WHEN s.IsMaya = 1 THEN 2026 ELSE COALESCE(sp.GraduationYear, 2026) END,
       cr.Total, 1,
       COALESCE((SELECT MAX(se.SortOrder) + 1 FROM StudentEducation se WHERE se.UserId = s.UserId), 0)
FROM #S s
JOIN StudentProfiles sp ON sp.UserId = s.UserId
JOIN Users u ON u.Id = s.UserId
JOIN (
    SELECT t.StudentUserId AS UserId, t.InstitutionId, SUM(COALESCE(tc.NormalisedCredits, tc.OriginalCredits)) AS Total
    FROM Transcripts t JOIN TranscriptCourses tc ON tc.TranscriptId = t.Id
    GROUP BY t.StudentUserId, t.InstitutionId
) cr ON cr.UserId = s.UserId
JOIN Institutions i ON i.Id = cr.InstitutionId
WHERE NOT EXISTS (SELECT 1 FROM StudentEducation se WHERE se.UserId = s.UserId AND se.InstitutionName = i.Name);

-- Credits earned on the transcript-sourced rows follow the transcripts.
UPDATE se SET CreditsEarned = cr.Total
FROM StudentEducation se
JOIN (
    SELECT t.StudentUserId AS UserId, t.InstitutionId, SUM(COALESCE(tc.NormalisedCredits, tc.OriginalCredits)) AS Total
    FROM Transcripts t JOIN TranscriptCourses tc ON tc.TranscriptId = t.Id
    GROUP BY t.StudentUserId, t.InstitutionId
) cr ON cr.UserId = se.UserId AND cr.InstitutionId = se.InstitutionId
JOIN #S s ON s.UserId = se.UserId
WHERE s.Synth = 1 AND (se.CreditsEarned IS NULL OR se.CreditsEarned <> cr.Total);

-- Students without any education row and without transcripts: one row for the prior institution.
INSERT INTO StudentEducation (UserId, InstitutionName, City, StateRegion, Country, IsOutsideUS, FromYear, ToYear, CreditsEarned, FullTime, SortOrder)
SELECT sp.UserId, sp.PriorInstitutionName, u.City, u.State, 'United States', 0,
       COALESCE(sp.GraduationYear, 2026) - 2, COALESCE(sp.GraduationYear, 2026), sp.CreditsCompleted, 1, 0
FROM StudentProfiles sp
JOIN #S s ON s.UserId = sp.UserId
JOIN Users u ON u.Id = sp.UserId
WHERE NULLIF(LTRIM(RTRIM(sp.PriorInstitutionName)), '') IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM StudentEducation se WHERE se.UserId = sp.UserId);
GO

-- 5. Summary: how many students still lack each field (every number should be 0).
SELECT COUNT(*) AS Students,
       SUM(CASE WHEN NULLIF(LTRIM(RTRIM(u.Mobile)), '') IS NULL THEN 1 ELSE 0 END)                      AS NoMobile,
       SUM(CASE WHEN NULLIF(LTRIM(RTRIM(u.City)), '') IS NULL OR NULLIF(LTRIM(RTRIM(u.State)), '') IS NULL
                  OR NULLIF(LTRIM(RTRIM(u.PostalCode)), '') IS NULL OR NULLIF(LTRIM(RTRIM(u.Country)), '') IS NULL THEN 1 ELSE 0 END) AS NoAddress,
       SUM(CASE WHEN NULLIF(LTRIM(RTRIM(sp.PriorInstitutionName)), '') IS NULL THEN 1 ELSE 0 END)        AS NoPriorInstitution,
       SUM(CASE WHEN NULLIF(LTRIM(RTRIM(sp.FieldOfStudy)), '') IS NULL THEN 1 ELSE 0 END)                AS NoFieldOfStudy,
       SUM(CASE WHEN NULLIF(LTRIM(RTRIM(sp.ProgramArea)), '') IS NULL THEN 1 ELSE 0 END)                 AS NoProgramArea,
       SUM(CASE WHEN NULLIF(LTRIM(RTRIM(sp.HighestEducationLevel)), '') IS NULL THEN 1 ELSE 0 END)       AS NoEducationLevel,
       SUM(CASE WHEN sp.GPA IS NULL THEN 1 ELSE 0 END)                                                   AS NoGpa,
       SUM(CASE WHEN sp.GraduationYear IS NULL THEN 1 ELSE 0 END)                                        AS NoGraduationYear,
       SUM(CASE WHEN sp.CreditsCompleted IS NULL THEN 1 ELSE 0 END)                                      AS NoCredits,
       SUM(CASE WHEN NULLIF(LTRIM(RTRIM(sp.EmergencyContactName)), '') IS NULL
                  OR NULLIF(LTRIM(RTRIM(sp.EmergencyContactPhone)), '') IS NULL THEN 1 ELSE 0 END)      AS NoEmergencyContact,
       SUM(CASE WHEN sp.TargetInstitutionId IS NULL THEN 1 ELSE 0 END)                                   AS NoTargetUniversity,
       SUM(CASE WHEN sp.TargetProgramId IS NULL THEN 1 ELSE 0 END)                                       AS NoTargetProgram,
       SUM(CASE WHEN se.UserId IS NULL THEN 1 ELSE 0 END)                                                AS NoEducationRow
FROM Users u
JOIN Roles r ON r.Id = u.RoleId AND r.Name = 'student'
LEFT JOIN StudentProfiles sp ON sp.UserId = u.Id
LEFT JOIN (SELECT DISTINCT UserId FROM StudentEducation) se ON se.UserId = u.Id;  -- a join, not a subquery inside SUM (SQL Server error 130)
GO

DROP TABLE #S;
DROP TABLE #U;
GO
