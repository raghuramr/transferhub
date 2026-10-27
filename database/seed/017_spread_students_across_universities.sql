-- ============================================================
-- Seed 017 - Spread students across the receiving universities
-- ============================================================
-- Receiving universities = active Institutions with Type = 'university' (the synthetic
-- community colleges BSCC / PVTC are source-only and are excluded, so are any other
-- community_college rows). Seed 012 spread students over EVERY active institution, which could
-- point a student at a community college; this seed corrects that.
--
-- Who is (re)assigned, deterministically by a hash of the user id (no RAND, re-runnable):
--   * the synthetic demo students (Users.StudentId LIKE 'BU-SYN-%'), except Maya
--   * any student whose target is missing or is not a receiving university
-- NOT touched: student@test.edu (Maya, stays on BU with her demo-scenario transcripts), real
-- self-registered students who already chose a valid university, and the mock intake profiles
-- (StudentSourceProfiles is a separate table and is never read or written here).
--
-- Also realigned for reassigned students: TargetProgramId (a program the new university offers via
-- ProgramUniversities, NULL if it offers none) and IntendedAcademicUnitId (a school of the new
-- university, else NULL). Transcripts are updated ONLY if no workflow has started for them
-- (WorkflowId/WorkflowStatus NULL, no TranscriptStages rows, not complete) - request snapshots of
-- in-flight workflows are never changed.
-- Needs migrations 012, 013 and 015 (same as seed 012).
-- ============================================================
USE TransferHubDB;
GO

SET NOCOUNT ON;

-- 1. Receiving universities, numbered by Id.
IF OBJECT_ID('tempdb..#U') IS NOT NULL DROP TABLE #U;
SELECT i.Id, ROW_NUMBER() OVER (ORDER BY i.Id) AS Rn
INTO #U
FROM Institutions i
WHERE i.IsActive = 1 AND i.Type = 'university' AND i.Code NOT IN ('BSCC', 'PVTC');

DECLARE @UniCount INT = (SELECT COUNT(*) FROM #U);
IF @UniCount = 0
    PRINT 'Seed 017: no active receiving universities found - nothing to do.';
ELSE
    PRINT CONCAT('Seed 017: spreading students over ', @UniCount, ' receiving universities.');

-- 2. Every student has a profile row (all other StudentProfiles columns are nullable).
INSERT INTO StudentProfiles (UserId)
SELECT u.Id
FROM Users u JOIN Roles r ON r.Id = u.RoleId
WHERE r.Name = 'student'
  AND NOT EXISTS (SELECT 1 FROM StudentProfiles sp WHERE sp.UserId = u.Id);

-- 3. Students to (re)assign, with a stable hash (different salt per purpose, BIGINT so ABS cannot overflow).
IF OBJECT_ID('tempdb..#S') IS NOT NULL DROP TABLE #S;
SELECT u.Id AS UserId,
       ABS(CAST(CHECKSUM(CONCAT('uni:',  CAST(u.Id AS NVARCHAR(36)))) AS BIGINT)) AS HUni,
       ABS(CAST(CHECKSUM(CONCAT('prog:', CAST(u.Id AS NVARCHAR(36)))) AS BIGINT)) AS HProg,
       CAST(NULL AS INT) AS NewTarget
INTO #S
FROM Users u
JOIN Roles r ON r.Id = u.RoleId AND r.Name = 'student'
JOIN StudentProfiles sp ON sp.UserId = u.Id
WHERE u.Email <> 'student@test.edu'
  AND ISNULL(u.StudentId, '') <> 'BU-SYN-001'
  AND (   u.StudentId LIKE 'BU-SYN-%'
       OR sp.TargetInstitutionId IS NULL
       OR NOT EXISTS (SELECT 1 FROM #U x WHERE x.Id = sp.TargetInstitutionId));

IF @UniCount > 0
BEGIN
    UPDATE s SET NewTarget = un.Id
    FROM #S s JOIN #U un ON un.Rn = (s.HUni % @UniCount) + 1;

    -- 4. Target university (and a school/college + program of THAT university).
    UPDATE sp SET TargetInstitutionId = s.NewTarget, UpdatedAt = SYSUTCDATETIME()
    FROM StudentProfiles sp JOIN #S s ON s.UserId = sp.UserId
    WHERE s.NewTarget IS NOT NULL;

    -- Program: keep the current one if the new university offers it, else pick one it offers, else NULL.
    ;WITH Offered AS (
        SELECT pu.InstitutionId, pu.ProgramId,
               ROW_NUMBER() OVER (PARTITION BY pu.InstitutionId ORDER BY pu.ProgramId) AS Rn,
               COUNT(*)     OVER (PARTITION BY pu.InstitutionId) AS Cnt
        FROM ProgramUniversities pu
        JOIN Programs p ON p.Id = pu.ProgramId AND p.IsActive = 1
    )
    UPDATE sp SET TargetProgramId = o.ProgramId
    FROM StudentProfiles sp
    JOIN #S s ON s.UserId = sp.UserId AND s.NewTarget IS NOT NULL
    LEFT JOIN Offered o ON o.InstitutionId = s.NewTarget AND o.Rn = (s.HProg % o.Cnt) + 1
    WHERE NOT EXISTS (SELECT 1 FROM ProgramUniversities k
                      WHERE k.ProgramId = sp.TargetProgramId AND k.InstitutionId = s.NewTarget);

    ;WITH Units AS (
        SELECT au.Id, au.InstitutionId,
               ROW_NUMBER() OVER (PARTITION BY au.InstitutionId ORDER BY au.Id) AS Rn,
               COUNT(*)     OVER (PARTITION BY au.InstitutionId) AS Cnt
        FROM AcademicUnits au WHERE au.IsActive = 1
    )
    UPDATE sp SET IntendedAcademicUnitId = un.Id
    FROM StudentProfiles sp
    JOIN #S s ON s.UserId = sp.UserId AND s.NewTarget IS NOT NULL
    LEFT JOIN Units un ON un.InstitutionId = s.NewTarget AND un.Rn = (s.HProg % un.Cnt) + 1
    WHERE NOT EXISTS (SELECT 1 FROM AcademicUnits a
                      WHERE a.Id = sp.IntendedAcademicUnitId AND a.InstitutionId = s.NewTarget);

    -- 5. Transcripts whose workflow has NOT started: align the target. WorkflowId is left NULL on purpose
    --    (the engine resolves the university's own workflow, else the global default, when it starts).
    UPDATE t SET TargetInstitutionId = s.NewTarget
    FROM Transcripts t
    JOIN #S s ON s.UserId = t.StudentUserId AND s.NewTarget IS NOT NULL
    WHERE t.WorkflowId IS NULL AND t.WorkflowStatus IS NULL
      AND t.Status <> 'complete'
      AND NOT EXISTS (SELECT 1 FROM TranscriptStages ts WHERE ts.TranscriptId = t.Id)
      AND ISNULL(t.TargetInstitutionId, -1) <> s.NewTarget;
END

-- 6. Safety net: no student may be left without a target (students with a valid target are left as they are).
IF @UniCount > 0
BEGIN
    ;WITH Fix AS (
        SELECT sp.UserId,
               (SELECT un.Id FROM #U un
                 WHERE un.Rn = (ABS(CAST(CHECKSUM(CONCAT('uni:', CAST(sp.UserId AS NVARCHAR(36)))) AS BIGINT)) % @UniCount) + 1) AS T
        FROM StudentProfiles sp
        JOIN Users u ON u.Id = sp.UserId JOIN Roles r ON r.Id = u.RoleId AND r.Name = 'student'
        WHERE sp.TargetInstitutionId IS NULL
    )
    UPDATE sp SET TargetInstitutionId = f.T, UpdatedAt = SYSUTCDATETIME()
    FROM StudentProfiles sp JOIN Fix f ON f.UserId = sp.UserId;
END

-- 7. Summary for the run log: students per target university (incl. any outside the receiving list).
SELECT COALESCE(i.Code, '(none)') AS University, COUNT(*) AS Students,
       SUM(CASE WHEN sp.TargetProgramId IS NULL THEN 1 ELSE 0 END) AS WithoutProgram
FROM Users u
JOIN Roles r ON r.Id = u.RoleId AND r.Name = 'student'
LEFT JOIN StudentProfiles sp ON sp.UserId = u.Id
LEFT JOIN Institutions i ON i.Id = sp.TargetInstitutionId
GROUP BY COALESCE(i.Code, '(none)')
ORDER BY University;

IF OBJECT_ID('tempdb..#S') IS NOT NULL DROP TABLE #S;
IF OBJECT_ID('tempdb..#U') IS NOT NULL DROP TABLE #U;
GO
