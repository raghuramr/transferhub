-- ============================================================
-- Seed 008 – 120 synthetic transfer students
-- ============================================================
-- Passwords: all share the placeholder hash below, replaced with a real
-- argon2id hash for "Student@123!" by `npm run seed:users` (bulk UPDATE
-- WHERE Email LIKE 'student%@transferdemo.edu' added to seed-users.ts).
USE CreditEvalManager;
GO

DECLARE @StudentRoleId INT = (SELECT Id FROM Roles WHERE Name = 'student');
DECLARE @PlaceholderHash NVARCHAR(255) = '$argon2id$v=19$m=65536,t=3,p=4$PLACEHOLDER$PLACEHOLDER';

IF OBJECT_ID('tempdb..#Gen') IS NOT NULL DROP TABLE #Gen;

;WITH Tally AS (
    SELECT TOP (120) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS N
    FROM sys.all_objects a CROSS JOIN sys.all_objects b
),
FirstNames AS (
    SELECT Name, ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS rn FROM (VALUES
        ('Maya'),('Liam'),('Olivia'),('Noah'),('Emma'),('Ava'),('Ethan'),('Sophia'),
        ('Mason'),('Isabella'),('Lucas'),('Mia'),('Jacob'),('Amelia'),('Aiden'),('Harper'),
        ('Elijah'),('Evelyn'),('James'),('Abigail'),('Benjamin'),('Emily'),('Logan'),('Ella'),
        ('Alexander'),('Scarlett'),('Jackson'),('Grace'),('Daniel'),('Chloe')
    ) AS f(Name)
),
LastNames AS (
    SELECT Name, ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS rn FROM (VALUES
        ('Rivera'),('Chen'),('Patel'),('Kim'),('Garcia'),('Nguyen'),('Smith'),('Johnson'),
        ('Brown'),('Davis'),('Martinez'),('Lopez'),('Wilson'),('Anderson'),('Taylor'),('Thomas'),
        ('Moore'),('Jackson'),('Martin'),('Lee')
    ) AS l(Name)
),
Programs5 AS (
    SELECT Area, ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS rn
    FROM (VALUES ('Computer Science'),('Economics'),('Psychology'),('Biology'),('Mathematics')) AS p(Area)
)
SELECT
    t.N,
    CONCAT('student', t.N, '@transferdemo.edu') AS Email,
    fn.Name AS FirstName,
    ln.Name AS LastName,
    pr.Area AS ProgramArea,
    2022 + ((t.N - 1) % 4) AS AdmissionYear,
    CONCAT('BU-SYN-', FORMAT(t.N + 1, '000')) AS StudentId
INTO #Gen
FROM Tally t
JOIN FirstNames fn ON fn.rn = ((t.N - 1) % 30) + 1
JOIN LastNames ln  ON ln.rn = ((t.N * 7 - 1) % 20) + 1
JOIN Programs5 pr  ON pr.rn = ((t.N - 1) % 5) + 1;

MERGE Users AS target
USING #Gen AS source
ON target.Email = source.Email
WHEN NOT MATCHED THEN
    INSERT (Id, Email, PasswordHash, FirstName, LastName, RoleId, DepartmentId, StudentId, AgencyName, IsActive, MustChangePass)
    VALUES (NEWID(), source.Email, @PlaceholderHash, source.FirstName, source.LastName,
            @StudentRoleId, NULL, source.StudentId, NULL, 1, 1);
GO

INSERT INTO StudentProfiles (UserId, ProgramArea, AdmissionYear, DeadlineDate)
SELECT u.Id, g.ProgramArea, g.AdmissionYear, DATEADD(YEAR, 1, GETUTCDATE())
FROM Users u
JOIN #Gen g ON g.Email = u.Email
WHERE NOT EXISTS (SELECT 1 FROM StudentProfiles sp WHERE sp.UserId = u.Id);
GO

DROP TABLE #Gen;
GO

PRINT '120 synthetic students seeded. Run ''npm run seed:users'' to set their password hash (Student@123!).';
GO
