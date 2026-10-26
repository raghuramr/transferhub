-- ============================================================
-- Seed 013 - 30 mock "source system" student profiles
-- ============================================================
-- Stand-ins for records that would be fetched from a registrar / agency / partner
-- API (no real endpoints exist yet). The public intake lookup finds these by
-- (student id or passport number) + email. NU and NYU profiles reuse real
-- catalogue courses (preferring ones with seeded equivalencies) so the triage
-- rules find matches; the community-college profiles use a generic course pool.
-- Deterministic (CHECKSUM-free arithmetic on the profile number, no RAND) and
-- idempotent: a profile is only inserted when its (institution, id) is missing,
-- and courses/documents only for profiles that have none. Mock emails are
-- @transferdemo.edu (not real mailboxes: the lookup shows the claim link for
-- IsMock profiles instead of relying on email delivery).
-- ============================================================
USE TransferHubDB;
GO

IF OBJECT_ID('tempdb..#P') IS NOT NULL DROP TABLE #P;
CREATE TABLE #P (
    N INT NOT NULL, FirstName NVARCHAR(100), LastName NVARCHAR(100), Idx INT,
    InstCode VARCHAR(20), InstName NVARCHAR(200), IsIntl BIT, IdType VARCHAR(20),
    ExternalId NVARCHAR(100), Norm NVARCHAR(100), Email NVARCHAR(254),
    Country NVARCHAR(100), CountryOfOrigin NVARCHAR(100), City NVARCHAR(100), StateName NVARCHAR(100),
    FieldName NVARCHAR(200), Degree NVARCHAR(50), Gpa DECIMAL(3,2), GradYear INT, Dob DATE, Phone NVARCHAR(30)
);

;WITH Nums AS (
    SELECT TOP 30 ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS N FROM sys.all_objects
)
INSERT INTO #P (N, FirstName, LastName, Idx, IsIntl)
SELECT N,
    CHOOSE(N, 'Aarav','Sofia','Liam','Mei','Noah','Priya','Lucas','Amara','Ethan','Isabella',
              'Mateo','Hana','Oliver','Fatima','Jacob','Chloe','Daniel','Yuki','Sebastian','Zara',
              'Benjamin','Camila','Samuel','Ananya','Henry','Nadia','Joseph','Elena','Victor','Grace'),
    CHOOSE(N, 'Patel','Garcia','Johnson','Chen','Williams','Sharma','Martinez','Okafor','Brown','Rossi',
              'Hernandez','Kim','Davis','Hassan','Wilson','Nguyen','Moore','Tanaka','Silva','Khan',
              'Taylor','Lopez','Anderson','Reddy','Thomas','Ali','Jackson','Petrova','Santos','Murphy'),
    (N - 1) % 5,
    CASE WHEN N IN (4, 6, 8, 14, 18, 24) THEN 1 ELSE 0 END
FROM Nums;
GO

UPDATE #P SET
    InstCode = CHOOSE(Idx + 1, 'NU', 'NYU', 'BHCC', 'MCC', 'UMB'),
    InstName = CHOOSE(Idx + 1, 'Northeastern University', 'New York University', 'Bunker Hill Community College',
                      'Middlesex Community College', 'UMass Boston'),
    IdType = CASE WHEN IsIntl = 1 THEN 'passport' ELSE 'student_id' END;

UPDATE #P SET
    ExternalId = CASE WHEN IsIntl = 1
                      THEN CONCAT('P', CAST(10000000 + (N * 7352819) % 80000000 AS VARCHAR(8)))
                      ELSE CONCAT(InstCode, '-', CAST(3000000 + (N * 48271) % 900000 AS VARCHAR(7))) END,
    Email = CONCAT(LOWER(FirstName), '.', LOWER(LastName), RIGHT(CONCAT('0', CAST(N AS VARCHAR(2))), 2), '@transferdemo.edu'),
    CountryOfOrigin = CASE WHEN IsIntl = 1 THEN
        CASE N WHEN 4 THEN 'China' WHEN 6 THEN 'India' WHEN 8 THEN 'Nigeria' WHEN 14 THEN 'South Korea' WHEN 18 THEN 'Japan' ELSE 'India' END
        ELSE 'United States' END,
    City = CASE WHEN IsIntl = 1 THEN
        CASE N WHEN 4 THEN 'Shanghai' WHEN 6 THEN 'Mumbai' WHEN 8 THEN 'Lagos' WHEN 14 THEN 'Seoul' WHEN 18 THEN 'Tokyo' ELSE 'Hyderabad' END
        ELSE CHOOSE(Idx + 1, 'Boston', 'New York', 'Boston', 'Bedford', 'Boston') END,
    StateName = CASE WHEN IsIntl = 1 THEN NULL ELSE CHOOSE(Idx + 1, 'MA', 'NY', 'MA', 'MA', 'MA') END,
    FieldName = CHOOSE(N % 6 + 1, 'Computer Science', 'Business Administration', 'Biology', 'Psychology', 'Mechanical Engineering', 'Economics'),
    Degree = CASE WHEN Idx >= 2 THEN 'AS' ELSE 'BS' END,
    Gpa = CAST(2.60 + ((N * 37) % 136) / 100.0 AS DECIMAL(3,2)),
    GradYear = 2025 + N % 3,
    Dob = DATEFROMPARTS(1998 + N % 6, 1 + (N * 5) % 12, 1 + (N * 7) % 28),
    Phone = CONCAT('+1-617-555-', RIGHT(CONCAT('0000', CAST(1000 + (N * 137) % 9000 AS VARCHAR(4))), 4));

UPDATE #P SET
    Country = CountryOfOrigin,
    Norm = UPPER(REPLACE(REPLACE(ExternalId, ' ', ''), '-', ''));
GO

-- 1. Profiles (only the ones that are missing).
INSERT INTO StudentSourceProfiles
    (SourceSystem, IsMock, InstitutionCode, InstitutionName, Calendar, IdType, ExternalId, Email, FirstName, LastName,
     DateOfBirth, Phone, Country, CountryOfOrigin, City, State, ProgramName, Degree, FieldOfStudy, GPA, GraduationYear)
SELECT CONCAT('Mock registrar - ', p.InstName), 1, p.InstCode, p.InstName, 'semester', p.IdType, p.ExternalId, p.Email, p.FirstName, p.LastName,
       p.Dob, p.Phone, p.Country, p.CountryOfOrigin, p.City, p.StateName, p.FieldName, p.Degree, p.FieldName, p.Gpa, p.GradYear
FROM #P p
WHERE NOT EXISTS (
    SELECT 1 FROM StudentSourceProfiles s WHERE s.InstitutionCode = p.InstCode AND s.ExternalIdNorm = p.Norm
);
GO

-- 2a. Courses for NU / NYU profiles: 4-6 real catalogue courses, equivalency-backed ones first.
;WITH Ranked AS (
    SELECT i.Code AS InstCode, c.Code, c.Title, CAST(c.Credits AS DECIMAL(5,2)) AS Credits,
           ROW_NUMBER() OVER (PARTITION BY i.Code ORDER BY
               CASE WHEN EXISTS (SELECT 1 FROM Equivalencies e WHERE e.ExternalCourseId = c.Id AND e.IsActive = 1) THEN 0 ELSE 1 END, c.Id) AS Rn,
           COUNT(*) OVER (PARTITION BY i.Code) AS Cnt
    FROM Courses c JOIN Institutions i ON i.Id = c.InstitutionId
    WHERE i.Code IN ('NU', 'NYU') AND c.IsActive = 1
),
Target AS (
    SELECT s.Id AS ProfileId, p.N, p.InstCode, 4 + p.N % 3 AS K
    FROM #P p JOIN StudentSourceProfiles s ON s.InstitutionCode = p.InstCode AND s.ExternalIdNorm = p.Norm
    WHERE p.InstCode IN ('NU', 'NYU')
      AND NOT EXISTS (SELECT 1 FROM StudentSourceCourses x WHERE x.SourceProfileId = s.Id)
),
Picked AS (
    SELECT t.ProfileId, t.N, r.Code, r.Title, r.Credits,
           ROW_NUMBER() OVER (PARTITION BY t.ProfileId ORDER BY r.Rn) AS Ord
    FROM Target t JOIN Ranked r ON r.InstCode = t.InstCode
    WHERE ((r.Rn - 1 - (t.N * 3) % r.Cnt + r.Cnt) % r.Cnt) < t.K
)
INSERT INTO StudentSourceCourses (SourceProfileId, CourseCode, CourseTitle, Credits, Grade, Term, SortOrder)
SELECT ProfileId, Code, Title, Credits,
       CHOOSE((Ord * 3 + N) % 7 + 1, 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C'),
       CHOOSE((Ord + N) % 4 + 1, 'Fall 2024', 'Spring 2025', 'Fall 2025', 'Spring 2024'),
       Ord
FROM Picked;
GO

-- 2b. Courses for the community-college / UMass profiles: a fixed generic pool.
IF OBJECT_ID('tempdb..#Pool') IS NOT NULL DROP TABLE #Pool;
CREATE TABLE #Pool (Pos INT NOT NULL, Code NVARCHAR(50), Title NVARCHAR(300), Credits DECIMAL(5,2));
INSERT INTO #Pool (Pos, Code, Title, Credits) VALUES
    (0, 'ENG 101', 'English Composition', 3),
    (1, 'MAT 151', 'Calculus I', 4),
    (2, 'MAT 152', 'Calculus II', 4),
    (3, 'CIS 120', 'Introduction to Programming', 3),
    (4, 'BIO 101', 'General Biology', 4),
    (5, 'PSY 101', 'Introduction to Psychology', 3),
    (6, 'HIS 110', 'World History I', 3),
    (7, 'ECO 201', 'Principles of Microeconomics', 3),
    (8, 'PHY 151', 'General Physics I', 4),
    (9, 'CHM 110', 'General Chemistry I', 4),
    (10, 'SOC 101', 'Introduction to Sociology', 3),
    (11, 'COM 101', 'Public Speaking', 3);

;WITH Target AS (
    SELECT s.Id AS ProfileId, p.N, 4 + p.N % 3 AS K, (p.N * 5) % 12 AS StartPos
    FROM #P p JOIN StudentSourceProfiles s ON s.InstitutionCode = p.InstCode AND s.ExternalIdNorm = p.Norm
    WHERE p.InstCode NOT IN ('NU', 'NYU')
      AND NOT EXISTS (SELECT 1 FROM StudentSourceCourses x WHERE x.SourceProfileId = s.Id)
),
Picked AS (
    SELECT t.ProfileId, t.N, q.Code, q.Title, q.Credits,
           ROW_NUMBER() OVER (PARTITION BY t.ProfileId ORDER BY (q.Pos - t.StartPos + 12) % 12) AS Ord
    FROM Target t JOIN #Pool q ON ((q.Pos - t.StartPos + 12) % 12) < t.K
)
INSERT INTO StudentSourceCourses (SourceProfileId, CourseCode, CourseTitle, Credits, Grade, Term, SortOrder)
SELECT ProfileId, Code, Title, Credits,
       CHOOSE((Ord * 3 + N) % 7 + 1, 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C'),
       CHOOSE((Ord + N) % 4 + 1, 'Fall 2024', 'Spring 2025', 'Fall 2025', 'Spring 2024'),
       Ord
FROM Picked;
GO

-- 3. Credits completed = sum of the course credits.
UPDATE s SET CreditsCompleted = c.Total
FROM StudentSourceProfiles s
JOIN (SELECT SourceProfileId, SUM(Credits) AS Total FROM StudentSourceCourses GROUP BY SourceProfileId) c ON c.SourceProfileId = s.Id
WHERE s.IsMock = 1 AND s.CreditsCompleted IS NULL;
GO

-- 4. Two generated documents per profile (content is rendered on demand by the API).
INSERT INTO StudentSourceDocuments (SourceProfileId, DocType, FileName, MimeType, Generated)
SELECT s.Id, 'transcript', CONCAT(s.ExternalId, '-transcript.pdf'), 'application/pdf', 1
FROM StudentSourceProfiles s
WHERE s.IsMock = 1 AND NOT EXISTS (SELECT 1 FROM StudentSourceDocuments d WHERE d.SourceProfileId = s.Id AND d.DocType = 'transcript');

INSERT INTO StudentSourceDocuments (SourceProfileId, DocType, FileName, MimeType, Generated)
SELECT s.Id, 'id_document', CONCAT(s.ExternalId, '-id.pdf'), 'application/pdf', 1
FROM StudentSourceProfiles s
WHERE s.IsMock = 1 AND NOT EXISTS (SELECT 1 FROM StudentSourceDocuments d WHERE d.SourceProfileId = s.Id AND d.DocType = 'id_document');
GO

DROP TABLE #Pool;
DROP TABLE #P;
GO
