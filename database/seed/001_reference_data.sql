-- ============================================================
-- Seed 001 – Reference data: roles, departments, institutions
-- ============================================================
-- Unchanged from the original seed/001_reference_data.sql (already
-- idempotent via MERGE ... WHEN NOT MATCHED).
-- ============================================================
USE CreditEvalManager;
GO

-- ─── Roles ───────────────────────────────────────────────────
MERGE Roles AS target
USING (VALUES
    ('student',     'Student',       'Transfer student; sees only own evaluations.'),
    ('faculty',     'Faculty',       'Department evaluator; reviews queue for their department.'),
    ('admin',       'Admin',         'Credit Evaluation staff; manages transcripts and catalog.'),
    ('agency',      'Agency',        'External agency submitting requests on behalf of students.'),
    ('super_admin', 'Super Admin',   'Full access; manages admins, roles, system config and audit log.')
) AS source (Name, DisplayName, Description)
ON target.Name = source.Name
WHEN NOT MATCHED THEN
    INSERT (Name, DisplayName, Description) VALUES (source.Name, source.DisplayName, source.Description);
GO

-- ─── Departments ─────────────────────────────────────────────
MERGE Departments AS target
USING (VALUES
    ('CS',   'Computer Science'),
    ('ECON', 'Economics'),
    ('PSYC', 'Psychology'),
    ('BIOL', 'Biology'),
    ('MATH', 'Mathematics'),
    ('CHEM', 'Chemistry'),
    ('EVAL', 'Credit Evaluation')   -- used for admin/staff users
) AS source (Code, Name)
ON target.Code = source.Code
WHEN NOT MATCHED THEN
    INSERT (Code, Name) VALUES (source.Code, source.Name);
GO

-- ─── Institutions ────────────────────────────────────────────
MERGE Institutions AS target
USING (VALUES
    ('BU',   'Boston University',                          'semester', 'university',         1, 'https://www.bu.edu'),
    ('NU',   'Northeastern University',                    'semester', 'university',         0, 'https://catalog.northeastern.edu'),
    ('NYU',  'New York University',                        'semester', 'university',         0, 'https://bulletins.nyu.edu'),
    ('BSCC', 'Bay State Community College (synthetic)',    'semester', 'community_college',  0, NULL),
    ('PVTC', 'Pioneer Valley Technical College (synthetic)','quarter', 'community_college',  0, NULL)
) AS source (Code, Name, Calendar, Type, IsBU, Source)
ON target.Code = source.Code
WHEN NOT MATCHED THEN
    INSERT (Code, Name, Calendar, Type, IsBU, Source)
    VALUES (source.Code, source.Name, source.Calendar, source.Type, source.IsBU, source.Source);
GO
