-- ============================================================
-- Seed 006 – Agencies, AcademicUnits ("Institutions" in UI), Programs
-- ============================================================
-- Source: BU_Transfer_Program_Course_Match.xlsx, "Programs" sheet.
-- "BU school" / "NU college" / "NYU school" columns become AcademicUnits
-- rows, FK'd to the matching University (existing Institutions table).
-- Unchanged from the original seed/007_agencies_academicunits_programs.sql
-- (already idempotent via MERGE / WHERE NOT EXISTS).
-- ============================================================
USE TransferHubDB;
GO

-- ─── Agencies ────────────────────────────────────────────────
MERGE Agencies AS target
USING (VALUES
    ('BU Transfer Partners',      'contact@buxferpartners.example', '617-555-0101', 'USA'),
    ('Global Credit Bridge',      'hello@globalcreditbridge.example', '212-555-0199', 'USA'),
    ('Northeast Edu Consultants', 'info@needuconsult.example',       '617-555-0144', 'USA')
) AS source (Name, ContactEmail, ContactPhone, Country)
ON target.Name = source.Name
WHEN NOT MATCHED THEN
    INSERT (Name, ContactEmail, ContactPhone, Country)
    VALUES (source.Name, source.ContactEmail, source.ContactPhone, source.Country);
GO

-- Link the existing demo agency user to the formal Agencies row.
UPDATE Users
SET AgencyId = (SELECT Id FROM Agencies WHERE Name = 'BU Transfer Partners')
WHERE Email = 'agency@partner.edu' AND AgencyId IS NULL;
GO

-- ─── AcademicUnits (schools/colleges within each university) ──
-- Derived from the Programs sheet's BU school / NU college / NYU school columns
-- across the 5 program areas: Computer Science, Economics, Psychology, Biology, Mathematics.
MERGE AcademicUnits AS target
USING (VALUES
    ('BU',  'College of Arts & Sciences'),
    ('NU',  'Khoury College of Computer Sciences'),
    ('NU',  'College of Social Sciences and Humanities'),
    ('NU',  'College of Science'),
    ('NYU', 'College of Arts & Science')
) AS source (InstitutionCode, Name)
ON target.Name = source.Name
   AND target.InstitutionId = (SELECT Id FROM Institutions WHERE Code = source.InstitutionCode)
WHEN NOT MATCHED THEN
    INSERT (InstitutionId, Name)
    VALUES ((SELECT Id FROM Institutions WHERE Code = source.InstitutionCode), source.Name);
GO

-- ─── Programs ────────────────────────────────────────────────
-- One row per (university, program area) — 5 areas x 3 universities = 15 rows.
MERGE Programs AS target
USING (VALUES
    ('BU',  'Computer Science', 'BA in Computer Science',        'BA', 'College of Arts & Sciences',
        '15 courses; Group C (CS 320, 332, 350) cannot be transferred',
        'https://www.bu.edu/academics/cas/programs/computer-science/ba/', NULL, NULL),
    ('NU',  'Computer Science', 'Computer Science, BSCS (Boston)','BS', 'Khoury College of Computer Sciences',
        '72 SH in major; co-op based curriculum',
        'https://catalog.northeastern.edu/undergraduate/computer-information-science/computer-science/', 'Strong',
        'NU uses 4-5 SH courses; co-op terms do not map to a BU semester'),
    ('NYU', 'Computer Science', 'Computer Science (BA)',          'BA', 'College of Arts & Science',
        '12 courses',
        'https://bulletins.nyu.edu/undergraduate/liberal-arts-sciences/departments-programs/computer-science/computer-science-ba/', 'Strong', NULL),

    ('BU',  'Economics', 'BA in Economics', 'BA', 'College of Arts & Sciences',
        'Intermediate micro/macro + statistics required at BU', 'https://www.bu.edu/academics/cas/programs/economics/ba/', NULL, NULL),
    ('NU',  'Economics', 'Economics, BA', 'BA', 'College of Social Sciences and Humanities',
        'Quarter-based core sequence', 'https://catalog.northeastern.edu/undergraduate/social-sciences-humanities/economics/', 'Moderate', NULL),
    ('NYU', 'Economics', 'Economics (BA)', 'BA', 'College of Arts & Science',
        'Calculus-based track differs from BU track', 'https://bulletins.nyu.edu/undergraduate/liberal-arts-sciences/departments-programs/economics/economics-ba/', 'Moderate', NULL),

    ('BU',  'Psychology', 'BA in Psychology', 'BA', 'College of Arts & Sciences',
        'Research methods + statistics core', 'https://www.bu.edu/academics/cas/programs/psychology/ba/', NULL, NULL),
    ('NU',  'Psychology', 'Psychology, BA', 'BA', 'College of Social Sciences and Humanities',
        'Co-op based; core sequence differs', 'https://catalog.northeastern.edu/undergraduate/social-sciences-humanities/psychology/', 'Strong', NULL),
    ('NYU', 'Psychology', 'Psychology (BA)', 'BA', 'College of Arts & Science',
        'Core overlaps well with BU', 'https://bulletins.nyu.edu/undergraduate/liberal-arts-sciences/departments-programs/psychology/psychology-ba/', 'Strong', NULL),

    ('BU',  'Biology', 'BA in Biology', 'BA', 'College of Arts & Sciences',
        'Lab sequence must be completed at BU for upper-level standing', 'https://www.bu.edu/academics/cas/programs/biology/ba/', NULL, NULL),
    ('NU',  'Biology', 'Biology, BS', 'BS', 'College of Science',
        'Lab credit transfer requires syllabus review', 'https://catalog.northeastern.edu/undergraduate/science/biology/', 'Moderate', NULL),
    ('NYU', 'Biology', 'Biology (BA)', 'BA', 'College of Arts & Science',
        'Core overlaps well with BU', 'https://bulletins.nyu.edu/undergraduate/liberal-arts-sciences/departments-programs/biology/biology-ba/', 'Strong', NULL),

    ('BU',  'Mathematics', 'BA in Mathematics', 'BA', 'College of Arts & Sciences',
        'Proof-based sequence required at BU', 'https://www.bu.edu/academics/cas/programs/mathematics/ba/', NULL, NULL),
    ('NU',  'Mathematics', 'Mathematics, BS', 'BS', 'College of Science',
        'Quarter-based core sequence', 'https://catalog.northeastern.edu/undergraduate/science/mathematics/', 'Moderate', NULL),
    ('NYU', 'Mathematics', 'Mathematics (BA)', 'BA', 'College of Arts & Science',
        'Core overlaps well with BU', 'https://bulletins.nyu.edu/undergraduate/liberal-arts-sciences/departments-programs/mathematics/mathematics-ba/', 'Strong', NULL)
) AS source (InstitutionCode, Area, Name, Degree, School, KeyRules, Source, MatchStrength, Notes)
ON target.Area = source.Area
   AND target.InstitutionId = (SELECT Id FROM Institutions WHERE Code = source.InstitutionCode)
WHEN NOT MATCHED THEN
    INSERT (InstitutionId, Area, Name, Degree, School, KeyRules, Source, MatchStrength, Notes)
    VALUES (
        (SELECT Id FROM Institutions WHERE Code = source.InstitutionCode),
        source.Area, source.Name, source.Degree, source.School, source.KeyRules, source.Source, source.MatchStrength, source.Notes
    );
GO
