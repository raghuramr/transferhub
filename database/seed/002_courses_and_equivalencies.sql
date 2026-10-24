-- ============================================================
-- Seed 002 – Course catalog (BU, Northeastern, NYU) + Equivalencies
-- ============================================================
-- Consolidated: BU courses (old seed/002), Northeastern + NYU courses and
-- workbook equivalency mappings (old seed/003), and the newer AI/ML course
-- additions (old seed/010's course INSERT only — that file's topic rows
-- are consolidated into the Course Topics seed file instead). All inserts
-- here were already written idempotently (WHERE NOT EXISTS); unchanged in
-- substance, just combined into one file per entity.
-- ============================================================
USE CreditEvalManager;
GO

-- ─── BU Courses (from BU_Transfer_Program_Course_Match.xlsx) ──
DECLARE @BUID INT = (SELECT Id FROM Institutions WHERE Code = 'BU');

INSERT INTO Courses (InstitutionId, Code, Title, ProgramArea, RequirementType, Credits, Verified, Notes, Source)
SELECT @BUID, Code, Title, ProgramArea, RequirementType, Credits, Verified, Notes, Source
FROM (VALUES
-- Computer Science
  ('CAS CS 111','Introduction to Computer Science 1',         'Computer Science','Core (Group A)',   4,'Yes',NULL,               'https://www.bu.edu/academics/cas/programs/computer-science/ba/'),
  ('CAS CS 112','Introduction to Computer Science 2',         'Computer Science','Core (Group A)',   4,'Yes',NULL,               'https://www.bu.edu/academics/cas/programs/computer-science/ba/'),
  ('CAS CS 131','Combinatoric Structures',                     'Computer Science','Core (Group A)',   4,'Yes',NULL,               'https://www.bu.edu/academics/cas/programs/computer-science/ba/'),
  ('CAS CS 210','Computer Systems',                            'Computer Science','Core (Group A)',   4,'Yes',NULL,               'https://www.bu.edu/academics/cas/programs/computer-science/ba/'),
  ('CAS CS 330','Introduction to the Analysis of Algorithms',  'Computer Science','Core (Group A)',   4,'Yes',NULL,               'https://www.bu.edu/academics/cas/programs/computer-science/ba/'),
  ('CAS CS 132','Geometric Algorithms',                        'Computer Science','Group B (choose)', 4,'Yes','CAS MA 242 may substitute','https://www.bu.edu/academics/cas/programs/computer-science/ba/'),
  ('CAS CS 235','Algebraic Algorithms',                        'Computer Science','Group B (choose)', 4,'Yes','CAS MA 294 may substitute','https://www.bu.edu/academics/cas/programs/computer-science/ba/'),
  ('CAS CS 237','Probability in Computing',                    'Computer Science','Group B (choose)', 4,'Yes','CAS MA 581 may substitute','https://www.bu.edu/academics/cas/programs/computer-science/ba/'),
  ('CAS CS 320','Concepts of Programming Languages',           'Computer Science','Group C (BU only)',4,'Yes','Must be taken at BU; cannot be transferred','https://www.bu.edu/academics/cas/programs/computer-science/ba/'),
  ('CAS CS 332','Elements of the Theory of Computation',       'Computer Science','Group C (BU only)',4,'Yes','Must be taken at BU; cannot be transferred','https://www.bu.edu/academics/cas/programs/computer-science/ba/'),
  ('CAS CS 350','Fundamentals of Computing Systems',           'Computer Science','Group C (BU only)',4,'Yes','Must be taken at BU; cannot be transferred','https://www.bu.edu/academics/cas/programs/computer-science/ba/'),
-- Economics
  ('CAS EC 101','Introductory Microeconomic Analysis',         'Economics','Intro',  4,'Yes',NULL,'https://www.bu.edu/academics/cas/programs/economics/ba'),
  ('CAS EC 102','Introductory Macroeconomic Analysis',         'Economics','Intro',  4,'Yes',NULL,'https://www.bu.edu/academics/cas/programs/economics/ba'),
  ('CAS EC 201','Intermediate Microeconomic Analysis',         'Economics','Core',   4,'Yes','Max 4 courses at 200+ level transferable after matriculation','https://www.bu.edu/academics/cas/programs/economics/ba'),
  ('CAS EC 202','Intermediate Macroeconomic Analysis',         'Economics','Core',   4,'Yes','Max 4 courses at 200+ level transferable after matriculation','https://www.bu.edu/academics/cas/programs/economics/ba'),
  ('CAS EC 203','Empirical Economics 1',                       'Economics','Core',   4,'Yes','MA 115, MA 213 or QST QM 221 accepted as substitutes','https://www.bu.edu/academics/cas/programs/economics/ba'),
  ('CAS EC 204','Empirical Economics 2',                       'Economics','Core',   4,'Yes',NULL,'https://www.bu.edu/academics/cas/programs/economics/ba'),
-- Psychology
  ('CAS PS 101','General Psychology',                          'Psychology','Prerequisite',   4,'Yes',NULL,'https://www.bu.edu/academics/cas/programs/psychology/ba/'),
  ('CAS PS 211','Experimental Design in Psychology',           'Psychology','Design & Statistics',4,'Yes','Or MA 115 + MA 116; not a principal course','https://www.bu.edu/academics/cas/programs/psychology/ba/'),
  ('CAS PS 231','Physiological Psychology',                    'Psychology','Required principal',4,'Yes',NULL,'https://www.bu.edu/academics/cas/programs/psychology/ba/'),
  ('CAS PS 222','Perception and Behavior',                     'Psychology','Group A',4,'Yes',NULL,'https://www.bu.edu/academics/cas/programs/psychology/ba/'),
  ('CAS PS 336','Introduction to Cognitive Psychology',        'Psychology','Group A',4,'Yes',NULL,'https://www.bu.edu/academics/cas/programs/psychology/ba/'),
  ('CAS PS 241','Developmental Psychology',                    'Psychology','Group B',4,'Yes',NULL,'https://www.bu.edu/academics/cas/programs/psychology/ba/'),
  ('CAS PS 251','Psychology of Personality: Theories and Application','Psychology','Group B',4,'Yes',NULL,'https://www.bu.edu/academics/cas/programs/psychology/ba/'),
  ('CAS PS 261','Social Psychology',                           'Psychology','Group B',4,'Yes',NULL,'https://www.bu.edu/academics/cas/programs/psychology/ba/'),
  ('CAS PS 371','Psychopathology',                             'Psychology','Group B',4,'Yes','Formerly Abnormal Psychology','https://www.bu.edu/academics/cas/programs/psychology/ba/'),
-- Biology
  ('CAS BI 107','Biology 1',        'Biology','Intro',               4,'Yes',NULL,'https://www.bu.edu/academics/cas/departments/biology/'),
  ('CAS BI 108','Biology 2',        'Biology','Intro',               4,'Yes',NULL,'https://www.bu.edu/academics/cas/departments/biology/'),
  ('CAS BI 203','Cell Biology',     'Biology','Core',                4,'Yes',NULL,'https://www.bu.edu/academics/cas/departments/biology/'),
  ('CAS BI 206','Genetics',         'Biology','Core',                4,'Yes',NULL,'https://www.bu.edu/academics/cas/departments/biology/'),
  ('CAS CH 101','General Chemistry 1',  'Biology','Supporting (Chemistry)',4,'Yes',NULL,'https://www.bu.edu/academics/cas/departments/biology/'),
  ('CAS CH 102','General Chemistry 2',  'Biology','Supporting (Chemistry)',4,'Yes',NULL,'https://www.bu.edu/academics/cas/departments/biology/'),
  ('CAS CH 203','Organic Chemistry 1',  'Biology','Supporting (Chemistry)',4,'Yes',NULL,'https://www.bu.edu/academics/cas/departments/biology/'),
  ('CAS CH 204','Organic Chemistry 2',  'Biology','Supporting (Chemistry)',4,'Yes',NULL,'https://www.bu.edu/academics/cas/departments/biology/'),
-- Mathematics
  ('CAS MA 123','Calculus I',          'Mathematics','Lower division',4,'Yes',NULL,'https://www.bu.edu/math/undergraduate/faqs-and-forms/'),
  ('CAS MA 124','Calculus II',         'Mathematics','Lower division',4,'Yes',NULL,'https://www.bu.edu/math/undergraduate/faqs-and-forms/'),
  ('CAS MA 225','Multivariate Calculus','Mathematics','Lower division',4,'Yes',NULL,'https://www.bu.edu/math/undergraduate/faqs-and-forms/'),
  ('CAS MA 242','Linear Algebra',      'Mathematics','Lower division',4,'Yes',NULL,'https://www.bu.edu/math/undergraduate/faqs-and-forms/'),
  ('CAS MA 226','Differential Equations','Mathematics','Lower division',4,'Check','Title from memory; confirm in Bulletin','https://www.bu.edu/math/undergraduate/faqs-and-forms/'),
  ('CAS MA 293','Discrete Mathematics','Mathematics','Lower division',4,'Yes',NULL,'https://www.bu.edu/math/undergraduate/faqs-and-forms/'),
  ('CAS MA 581','Probability',          'Mathematics','Upper division',4,'Yes',NULL,'https://www.bu.edu/math/undergraduate/faqs-and-forms/')
) AS t(Code,Title,ProgramArea,RequirementType,Credits,Verified,Notes,Source)
WHERE NOT EXISTS (
    SELECT 1 FROM Courses WHERE InstitutionId = @BUID AND Code = t.Code
);
GO

-- ─── Northeastern Courses ────────────────────────────────────
INSERT INTO Courses (InstitutionId, Code, Title, ProgramArea, RequirementType, Credits, Verified, Notes, Source)
SELECT i.Id, t.Code, t.Title, t.ProgramArea, t.RequirementType, t.Credits, t.Verified, t.Notes, t.Source
FROM Institutions i
CROSS JOIN (VALUES
  ('CS 2000','Introduction to Program Design and Implementation','Computer Science','Fundamental',5,'Yes','Includes CS 2001 lab','https://catalog.northeastern.edu/undergraduate/computer-information-science/computer-science/bscs/'),
  ('CS 2100','Program Design and Implementation 1',             'Computer Science','Fundamental',5,'Yes','Includes CS 2101 lab','https://catalog.northeastern.edu/undergraduate/computer-information-science/computer-science/bscs/'),
  ('CS 3100','Program Design and Implementation 2',             'Computer Science','Required',  5,'Yes','Includes CS 3101 lab','https://catalog.northeastern.edu/undergraduate/computer-information-science/computer-science/bscs/'),
  ('CS 1800','Discrete Structures',                             'Computer Science','Fundamental',4,'Yes',NULL,'https://catalog.northeastern.edu/undergraduate/computer-information-science/computer-science/bscs/'),
  ('CS 2700','Data Structures and Analysis',                    'Computer Science','Required',  5,'Yes','Includes CS 2701 lab','https://catalog.northeastern.edu/undergraduate/computer-information-science/computer-science/bscs/'),
  ('CS 3000','Algorithms and Data',                             'Computer Science','Required',  4,'Yes',NULL,'https://catalog.northeastern.edu/undergraduate/computer-information-science/computer-science/bscs/'),
  ('CS 3650','Computer Systems',                                'Computer Science','Required',  4,'Yes',NULL,'https://catalog.northeastern.edu/undergraduate/computer-information-science/computer-science/bscs/'),
  ('CS 3800','Theory of Computation',                           'Computer Science','Required',  4,'Yes',NULL,'https://catalog.northeastern.edu/undergraduate/computer-information-science/computer-science/bscs/'),
  ('CS 4400','Programming Languages',                           'Computer Science','Concentration',4,'Yes','Software concentration','https://catalog.northeastern.edu/undergraduate/computer-information-science/computer-science/bscs/'),
  ('CS 2800','Logic and Computation',                           'Computer Science','Concentration',4,'Yes',NULL,'https://catalog.northeastern.edu/undergraduate/computer-information-science/computer-science/bscs/'),
  ('DS 3000','Mathematical Foundations of Artificial Intelligence','Computer Science','Required',4,'Yes',NULL,'https://catalog.northeastern.edu/undergraduate/computer-information-science/computer-science/bscs/'),
  ('ECON 1116','Principles of Microeconomics','Economics','Required',4,'Yes',NULL,'https://catalog.northeastern.edu/undergraduate/social-sciences-humanities/economics/economics-mathematics-bs/'),
  ('ECON 1115','Principles of Macroeconomics','Economics','Required',4,'Yes',NULL,'https://catalog.northeastern.edu/undergraduate/social-sciences-humanities/economics/economics-mathematics-bs/'),
  ('ECON 2316','Microeconomic Theory',         'Economics','Required',4,'Yes',NULL,'https://catalog.northeastern.edu/undergraduate/social-sciences-humanities/economics/economics-mathematics-bs/'),
  ('ECON 2315','Macroeconomic Theory',         'Economics','Required',4,'Yes',NULL,'https://catalog.northeastern.edu/undergraduate/social-sciences-humanities/economics/economics-mathematics-bs/'),
  ('ECON 2350','Statistics for Economists',    'Economics','Required (most majors)',4,'Yes',NULL,'https://catalog.northeastern.edu/undergraduate/social-sciences-humanities/economics/economics-mathematics-bs/'),
  ('ECON 2560','Applied Econometrics',         'Economics','Required',4,'Yes',NULL,'https://catalog.northeastern.edu/undergraduate/social-sciences-humanities/economics/economics-mathematics-bs/'),
  ('PSYC 1101','Foundations of Psychology',                  'Psychology','Required',4,'Yes',NULL,'https://catalog.northeastern.edu/undergraduate/science/psychology/psychology-bs'),
  ('PSYC 2320','Statistics in Psychological Research',       'Psychology','Required',4,'Yes',NULL,'https://catalog.northeastern.edu/undergraduate/science/psychology/psychology-bs'),
  ('PSYC 3458','Biological Psychology',                      'Psychology','Required (choose)',4,'Yes',NULL,'https://catalog.northeastern.edu/undergraduate/science/psychology/psychology-bs'),
  ('PSYC 3402','Social Psychology',                          'Psychology','Required (choose)',4,'Yes',NULL,'https://catalog.northeastern.edu/undergraduate/science/psychology/psychology-bs'),
  ('PSYC 3404','Developmental Psychology',                   'Psychology','Required (choose)',4,'Yes',NULL,'https://catalog.northeastern.edu/undergraduate/science/psychology/psychology-bs'),
  ('PSYC 3464','Psychology of Language',                     'Psychology','Required (choose)',4,'Yes',NULL,'https://catalog.northeastern.edu/undergraduate/science/psychology/psychology-bs'),
  ('BIOL 1107','Foundations of Biology',        'Biology','Core',5,'Yes','Includes BIOL 1108 lab','https://catalog.northeastern.edu/undergraduate/science/biology/biology-bs/'),
  ('BIOL 1113','General Biology 2',             'Biology','Core (some majors)',4,'Yes','Continues BIOL 1111','https://catalog.northeastern.edu/undergraduate/science/biology/biology-bs/'),
  ('BIOL 2299','Inquiries in Biological Sciences','Biology','Core',4,'Yes',NULL,'https://catalog.northeastern.edu/undergraduate/science/biology/biology-bs/'),
  ('BIOL 2301','Genetics and Molecular Biology','Biology','Core',5,'Yes','Includes BIOL 2302 lab','https://catalog.northeastern.edu/undergraduate/science/biology/biology-bs/'),
  ('BIOL 3611','Biochemistry',                  'Biology','Core',5,'Yes','Includes BIOL 3612 lab','https://catalog.northeastern.edu/undergraduate/science/biology/biology-bs/'),
  ('CHEM 1161','General Chemistry for Science Majors','Biology','Supporting (Chemistry)',5,'Yes','One-semester course with lab and recitation','https://catalog.northeastern.edu/undergraduate/science/biology/biology-bs/'),
  ('CHEM 2311','Organic Chemistry 1',           'Biology','Supporting (Chemistry)',5,'Yes','Includes CHEM 2312 lab','https://catalog.northeastern.edu/undergraduate/science/biology/biology-bs/'),
  ('CHEM 2313','Organic Chemistry 2',           'Biology','Supporting (Chemistry)',5,'Yes','Includes CHEM 2314 lab','https://catalog.northeastern.edu/undergraduate/science/biology/biology-bs/'),
  ('MATH 1341','Calculus 1 for Science and Engineering','Mathematics','Supporting',4,'Yes',NULL,'https://catalog.northeastern.edu/undergraduate/science/biology/biology-mathematics-bs'),
  ('MATH 1342','Calculus 2 for Science and Engineering','Mathematics','Supporting',4,'Yes',NULL,'https://catalog.northeastern.edu/undergraduate/science/biology/biology-mathematics-bs'),
  ('MATH 2321','Calculus 3 for Science and Engineering','Mathematics','Core',4,'Check','Code verified; title from memory','https://catalog.northeastern.edu/undergraduate/science/biology/biology-mathematics-bs'),
  ('MATH 2331','Linear Algebra',                            'Mathematics','Core',4,'Check','Code and title from memory; confirm in catalog','https://catalog.northeastern.edu/undergraduate/science/biology/biology-mathematics-bs'),
  ('MATH 2341','Differential Equations and Linear Algebra for Engineering','Mathematics','Core',4,'Check','Code verified; title from memory','https://catalog.northeastern.edu/undergraduate/science/biology/biology-mathematics-bs'),
  ('MATH 1365','Introduction to Mathematical Reasoning','Mathematics','Core',4,'Yes',NULL,'https://catalog.northeastern.edu/undergraduate/science/biology/biology-mathematics-bs'),
  ('MATH 3081','Probability and Statistics',             'Mathematics','Core',4,'Yes',NULL,'https://catalog.northeastern.edu/undergraduate/science/biology/biology-mathematics-bs')
) AS t(Code,Title,ProgramArea,RequirementType,Credits,Verified,Notes,Source)
WHERE i.Code = 'NU'
  AND NOT EXISTS (SELECT 1 FROM Courses c WHERE c.InstitutionId = i.Id AND c.Code = t.Code);
GO

-- ─── NYU Courses ─────────────────────────────────────────────
INSERT INTO Courses (InstitutionId, Code, Title, ProgramArea, RequirementType, Credits, Verified, Notes, Source)
SELECT i.Id, t.Code, t.Title, t.ProgramArea, t.RequirementType, t.Credits, t.Verified, t.Notes, t.Source
FROM Institutions i
CROSS JOIN (VALUES
  ('CSCI-UA 101','Intro to Computer Science',         'Computer Science','Core',4,'Yes',NULL,'https://bulletins.nyu.edu/undergraduate/arts-science/programs/computer-science-ba/computer-science-ba.pdf'),
  ('CSCI-UA 102','Data Structures',                   'Computer Science','Core',4,'Yes',NULL,'https://bulletins.nyu.edu/undergraduate/arts-science/programs/computer-science-ba/computer-science-ba.pdf'),
  ('CSCI-UA 201','Computer Systems Organization',     'Computer Science','Core',4,'Yes',NULL,'https://bulletins.nyu.edu/undergraduate/arts-science/programs/computer-science-ba/computer-science-ba.pdf'),
  ('CSCI-UA 202','Operating Systems',                 'Computer Science','Core',4,'Yes',NULL,'https://bulletins.nyu.edu/undergraduate/arts-science/programs/computer-science-ba/computer-science-ba.pdf'),
  ('CSCI-UA 310','Basic Algorithms',                  'Computer Science','Core',4,'Yes',NULL,'https://bulletins.nyu.edu/undergraduate/arts-science/programs/computer-science-ba/computer-science-ba.pdf'),
  ('CSCI-UA 453','Theory of Computation',             'Computer Science','Joint/honors major',4,'Yes',NULL,'https://math.nyu.edu/media/math/filer_public/f8/eb/f8eb4d2e-81c8-4421-8f62-fc2683e63e64/csma_major_honors_check_sheet.pdf'),
  ('MATH-UA 120','Discrete Mathematics',              'Computer Science','Core',4,'Yes',NULL,'https://bulletins.nyu.edu/undergraduate/arts-science/programs/computer-science-ba/computer-science-ba.pdf'),
  ('ECON-UA 2','Introduction to Microeconomics',      'Economics','Intro',4,'Yes',NULL,'https://bulletins.nyu.edu/undergraduate/arts-science/programs/economics-ba/economics-ba.pdf'),
  ('ECON-UA 1','Introduction to Macroeconomics',      'Economics','Intro',4,'Yes',NULL,'https://bulletins.nyu.edu/undergraduate/arts-science/programs/economics-ba/economics-ba.pdf'),
  ('ECON-UA 10','Intermediate Microeconomics',        'Economics','Core (Policy)',4,'Yes','Theory track: ECON-UA 11','https://bulletins.nyu.edu/undergraduate/arts-science/programs/economics-ba/economics-ba.pdf'),
  ('ECON-UA 12','Intermediate Macroeconomics',        'Economics','Core (Policy)',4,'Yes','Theory track: ECON-UA 13','https://bulletins.nyu.edu/undergraduate/arts-science/programs/economics-ba/economics-ba.pdf'),
  ('ECON-UA 18','Statistics',                         'Economics','Core (Policy)',4,'Yes','Theory track: ECON-UA 20','https://bulletins.nyu.edu/undergraduate/arts-science/programs/economics-ba/economics-ba.pdf'),
  ('ECON-UA 266','Intro to Econometrics',             'Economics','Core',4,'Yes',NULL,'https://bulletins.nyu.edu/undergraduate/arts-science/programs/economics-ba/economics-ba.pdf'),
  ('PSYCH-UA 1','Intro to Psychology',                'Psychology','Intro',4,'Yes',NULL,'https://bulletins.nyu.edu/courses/psych_ua/psych_ua.pdf'),
  ('PSYCH-UA 10','Statistics for the Behavioral Sciences','Psychology','Statistics',4,'Yes',NULL,'https://bulletins.nyu.edu/courses/psych_ua/psych_ua.pdf'),
  ('PSYCH-UA 11','Statistics and Data Analysis for Research in Psychology','Psychology','Statistics',4,'Yes',NULL,'https://bulletins.nyu.edu/courses/psych_ua/psych_ua.pdf'),
  ('PSYCH-UA 22','Perception',                        'Psychology','Core (choose)',4,'Yes',NULL,'https://bulletins.nyu.edu/courses/psych_ua/psych_ua.pdf'),
  ('PSYCH-UA 25','Cognitive Neuroscience',            'Psychology','Core (choose)',4,'Yes',NULL,'https://bulletins.nyu.edu/courses/psych_ua/psych_ua.pdf'),
  ('PSYCH-UA 29','Cognition',                         'Psychology','Core (choose)',4,'Yes',NULL,'https://bulletins.nyu.edu/courses/psych_ua/psych_ua.pdf'),
  ('PSYCH-UA 30','Personality',                       'Psychology','Core (choose)',4,'Yes',NULL,'https://bulletins.nyu.edu/courses/psych_ua/psych_ua.pdf'),
  ('PSYCH-UA 32','Social Psychology',                 'Psychology','Core (choose)',4,'Yes',NULL,'https://bulletins.nyu.edu/courses/psych_ua/psych_ua.pdf'),
  ('PSYCH-UA 34','Developmental Psychology',          'Psychology','Core (choose)',4,'Yes',NULL,'https://bulletins.nyu.edu/courses/psych_ua/psych_ua.pdf'),
  ('PSYCH-UA 51','Abnormal Psychology',               'Psychology','Elective',4,'Yes',NULL,'https://bulletins.nyu.edu/courses/psych_ua/psych_ua.pdf'),
  ('BIOL-UA 11','Principles of Biology I',            'Biology','Required',4,'Yes',NULL,'https://courses.bio.nyu.edu/requirement/major-standard-track/required'),
  ('BIOL-UA 12','Principles of Biology II',           'Biology','Required',4,'Yes',NULL,'https://courses.bio.nyu.edu/requirement/major-standard-track/required'),
  ('BIOL-UA 21','Molecular and Cell Biology I',       'Biology','Required',4,'Yes',NULL,'https://courses.bio.nyu.edu/requirement/major-standard-track/required'),
  ('BIOL-UA 30','Genetics',                           'Biology','Elective / minor',4,'Yes',NULL,'https://courses.bio.nyu.edu/requirement/major-standard-track/required'),
  ('CHEM-UA 125','General Chemistry I',               'Biology','Supporting (Chemistry)',5,'Check','Code verified; title and credits from memory',NULL),
  ('CHEM-UA 126','General Chemistry II',              'Biology','Supporting (Chemistry)',5,'Check','Code verified; title and credits from memory',NULL),
  ('CHEM-UA 225','Organic Chemistry I',               'Biology','Supporting (Chemistry)',5,'Check','Code verified; title and credits from memory',NULL),
  ('CHEM-UA 226','Organic Chemistry II',              'Biology','Supporting (Chemistry)',5,'Check','Code verified; title and credits from memory',NULL),
  ('MATH-UA 121','Calculus I',                        'Mathematics','Core',4,'Yes',NULL,'https://math.nyu.edu/media/math/filer_public/f8/eb/f8eb4d2e-81c8-4421-8f62-fc2683e63e64/csma_major_honors_check_sheet.pdf'),
  ('MATH-UA 122','Calculus II',                       'Mathematics','Core',4,'Yes',NULL,'https://math.nyu.edu/media/math/filer_public/f8/eb/f8eb4d2e-81c8-4421-8f62-fc2683e63e64/csma_major_honors_check_sheet.pdf'),
  ('MATH-UA 123','Calculus III',                      'Mathematics','Core',4,'Yes',NULL,'https://math.nyu.edu/media/math/filer_public/f8/eb/f8eb4d2e-81c8-4421-8f62-fc2683e63e64/csma_major_honors_check_sheet.pdf'),
  ('MATH-UA 140','Linear Algebra',                    'Mathematics','Core',4,'Yes',NULL,'https://math.nyu.edu/media/math/filer_public/f8/eb/f8eb4d2e-81c8-4421-8f62-fc2683e63e64/csma_major_honors_check_sheet.pdf'),
  ('MATH-UA 262','Ordinary Differential Equations',   'Mathematics','Elective',4,'Yes',NULL,'https://math.nyu.edu/media/math/filer_public/f8/eb/f8eb4d2e-81c8-4421-8f62-fc2683e63e64/csma_major_honors_check_sheet.pdf'),
  ('MATH-UA 233','Theory of Probability',             'Mathematics','Elective',4,'Yes',NULL,'https://math.nyu.edu/media/math/filer_public/f8/eb/f8eb4d2e-81c8-4421-8f62-fc2683e63e64/csma_major_honors_check_sheet.pdf'),
  ('MATH-UA 235','Probability & Statistics',          'Mathematics','Elective',4,'Yes',NULL,'https://math.nyu.edu/media/math/filer_public/f8/eb/f8eb4d2e-81c8-4421-8f62-fc2683e63e64/csma_major_honors_check_sheet.pdf')
) AS t(Code,Title,ProgramArea,RequirementType,Credits,Verified,Notes,Source)
WHERE i.Code = 'NYU'
  AND NOT EXISTS (SELECT 1 FROM Courses c WHERE c.InstitutionId = i.Id AND c.Code = t.Code);
GO

-- ─── New current/trending AI & ML courses (originally seed/010) ───
DECLARE @BUID2  INT = (SELECT Id FROM Institutions WHERE Code = 'BU');
DECLARE @NUID2  INT = (SELECT Id FROM Institutions WHERE Code = 'NU');
DECLARE @NYUID2 INT = (SELECT Id FROM Institutions WHERE Code = 'NYU');

INSERT INTO Courses (InstitutionId, Code, Title, ProgramArea, RequirementType, Credits, Verified, Notes, Source)
SELECT v.InstitutionId, v.Code, v.Title, v.ProgramArea, v.RequirementType, v.Credits, v.Verified, v.Notes, v.Source
FROM (VALUES
  (@BUID2, 'CAS CS 440', 'Artificial Intelligence',                          'Computer Science', 'Elective', 4, 'Check', 'Credits per BU 4-unit-hour default; verify in current Bulletin', 'https://www.cs.bu.edu/faculty/betke/cs440'),
  (@NUID2, 'CS 1700',    'AI for Everyone',                                  'Computer Science', 'Elective', 4, 'Check', 'Credits inferred (no lab); verify in Khoury catalog',           'https://www.khoury.northeastern.edu/all-courses/'),
  (@NUID2, 'CY 4100',    'AI Security and Privacy',                          'Computer Science', 'Elective', 4, 'Check', 'Credits inferred (no lab); verify in Khoury catalog',           'https://www.khoury.northeastern.edu/all-courses/'),
  (@NYUID2,'CSCI-UA 472','Artificial Intelligence',                          'Computer Science', 'Elective', 4, 'Check', 'Credits match other CSCI-UA courses; verify on primary bulletin','https://bulletins.nyu.edu/undergraduate/arts-science/courses/csci-ua/'),
  (@NYUID2,'CSCI-UA 473','Fundamentals of Machine Learning',                 'Computer Science', 'Elective', 4, 'Check', 'Credits match other CSCI-UA courses; verify on primary bulletin','https://bulletins.nyu.edu/undergraduate/arts-science/courses/csci-ua/')
) AS v(InstitutionId, Code, Title, ProgramArea, RequirementType, Credits, Verified, Notes, Source)
WHERE NOT EXISTS (
    SELECT 1 FROM Courses c WHERE c.InstitutionId = v.InstitutionId AND c.Code = v.Code
);
GO

-- ─── Equivalency mappings (from Course Match workbook) ───────
INSERT INTO Equivalencies (ExternalCourseId, BUCourseId, Outcome, MatchLevel, Rationale, Source, DecidedAt)
SELECT ext.Id, bu.Id, 'equivalent', m.ml, m.notes, 'workbook', SYSUTCDATETIME()
FROM (VALUES
  ('NU','CS 2000',   'BU','CAS CS 111','Likely equivalent','Intro programming courses.'),
  ('NU','CS 1800',   'BU','CAS CS 131','Likely equivalent','Discrete structures / discrete math.'),
  ('NU','CS 3650',   'BU','CAS CS 210','Likely equivalent','Computer systems / organization.'),
  ('NU','CS 3000',   'BU','CAS CS 330','Likely equivalent','Algorithms.'),
  ('NU','MATH 2331', 'BU','CAS MA 242','Likely equivalent','Linear algebra.'),
  ('NU','ECON 1116', 'BU','CAS EC 101','Likely equivalent','Principles of microeconomics.'),
  ('NU','ECON 1115', 'BU','CAS EC 102','Likely equivalent','Principles of macroeconomics.'),
  ('NU','ECON 2316', 'BU','CAS EC 201','Likely equivalent','Counts toward BU 4-course cap on 200+ level transfers.'),
  ('NU','ECON 2315', 'BU','CAS EC 202','Likely equivalent','Counts toward BU 4-course cap on 200+ level transfers.'),
  ('NU','ECON 2350', 'BU','CAS EC 203','Likely equivalent','Statistics for economics.'),
  ('NU','PSYC 1101', 'BU','CAS PS 101','Likely equivalent','Intro psychology.'),
  ('NU','PSYC 3458', 'BU','CAS PS 231','Likely equivalent','Physiological/biological psychology.'),
  ('NU','PSYC 3404', 'BU','CAS PS 241','Likely equivalent','Developmental psychology.'),
  ('NU','PSYC 3402', 'BU','CAS PS 261','Likely equivalent','Social psychology.'),
  ('NU','BIOL 1107', 'BU','CAS BI 107','Likely equivalent','First-semester biology.'),
  ('NU','BIOL 1113', 'BU','CAS BI 108','Likely equivalent','Second-semester biology.'),
  ('NU','CHEM 2311', 'BU','CAS CH 203','Likely equivalent','Organic chemistry 1.'),
  ('NU','CHEM 2313', 'BU','CAS CH 204','Likely equivalent','Organic chemistry 2.'),
  ('NU','MATH 1341', 'BU','CAS MA 123','Likely equivalent','Calculus I.'),
  ('NU','MATH 1342', 'BU','CAS MA 124','Likely equivalent','Calculus II.'),
  ('NU','MATH 2321', 'BU','CAS MA 225','Likely equivalent','Multivariable calculus.'),
  ('NYU','CSCI-UA 101','BU','CAS CS 111','Likely equivalent','Intro programming.'),
  ('NYU','CSCI-UA 102','BU','CAS CS 112','Likely equivalent','Data structures.'),
  ('NYU','MATH-UA 120','BU','CAS CS 131','Likely equivalent','Discrete math.'),
  ('NYU','CSCI-UA 201','BU','CAS CS 210','Likely equivalent','Computer systems.'),
  ('NYU','CSCI-UA 310','BU','CAS CS 330','Likely equivalent','Algorithms.'),
  ('NYU','MATH-UA 140','BU','CAS MA 242','Likely equivalent','Linear algebra.'),
  ('NYU','ECON-UA 2',  'BU','CAS EC 101','Likely equivalent','Micro intro.'),
  ('NYU','ECON-UA 1',  'BU','CAS EC 102','Likely equivalent','Macro intro.'),
  ('NYU','ECON-UA 10', 'BU','CAS EC 201','Likely equivalent','Intermediate micro.'),
  ('NYU','ECON-UA 12', 'BU','CAS EC 202','Likely equivalent','Intermediate macro.'),
  ('NYU','ECON-UA 18', 'BU','CAS EC 203','Likely equivalent','Statistics.'),
  ('NYU','PSYCH-UA 1', 'BU','CAS PS 101','Likely equivalent','Intro psychology.'),
  ('NYU','PSYCH-UA 25','BU','CAS PS 231','Likely equivalent','Cognitive neuroscience ~ physiological psych.'),
  ('NYU','PSYCH-UA 22','BU','CAS PS 222','Likely equivalent','Perception.'),
  ('NYU','PSYCH-UA 29','BU','CAS PS 336','Likely equivalent','Cognition.'),
  ('NYU','PSYCH-UA 34','BU','CAS PS 241','Likely equivalent','Developmental psychology.'),
  ('NYU','PSYCH-UA 30','BU','CAS PS 251','Likely equivalent','Personality.'),
  ('NYU','PSYCH-UA 32','BU','CAS PS 261','Likely equivalent','Social psychology.'),
  ('NYU','BIOL-UA 11', 'BU','CAS BI 107','Likely equivalent','First-semester biology.'),
  ('NYU','BIOL-UA 12', 'BU','CAS BI 108','Likely equivalent','Second-semester biology.'),
  ('NYU','BIOL-UA 30', 'BU','CAS BI 206','Likely equivalent','Genetics.'),
  ('NYU','CHEM-UA 125','BU','CAS CH 101','Likely equivalent','General chemistry I.'),
  ('NYU','CHEM-UA 126','BU','CAS CH 102','Likely equivalent','General chemistry II.'),
  ('NYU','CHEM-UA 225','BU','CAS CH 203','Likely equivalent','Organic chemistry I.'),
  ('NYU','CHEM-UA 226','BU','CAS CH 204','Likely equivalent','Organic chemistry II.'),
  ('NYU','MATH-UA 121','BU','CAS MA 123','Likely equivalent','Calculus I.'),
  ('NYU','MATH-UA 122','BU','CAS MA 124','Likely equivalent','Calculus II.'),
  ('NYU','MATH-UA 123','BU','CAS MA 225','Likely equivalent','Calculus III.'),
  ('NYU','MATH-UA 140','BU','CAS MA 242','Likely equivalent','Linear algebra (also).'),
  ('NYU','MATH-UA 262','BU','CAS MA 226','Likely equivalent','ODE ~ Diff Eq.'),
  ('NYU','MATH-UA 233','BU','CAS MA 581','Likely equivalent','Theory of probability.')
) AS m(ei,ec,bi,bc,ml,notes)
JOIN Institutions eInst ON eInst.Code = m.ei
JOIN Courses ext ON ext.InstitutionId = eInst.Id AND ext.Code = m.ec
JOIN Institutions bInst ON bInst.Code = m.bi
JOIN Courses bu  ON bu.InstitutionId  = bInst.Id AND bu.Code  = m.bc
WHERE NOT EXISTS (
    SELECT 1 FROM Equivalencies eq
    WHERE eq.ExternalCourseId = ext.Id AND eq.BUCourseId = bu.Id AND eq.IsActive = 1
);
GO

-- BU-only mappings
INSERT INTO Equivalencies (ExternalCourseId, BUCourseId, Outcome, MatchLevel, Rationale, Source, DecidedAt)
SELECT ext.Id, bu.Id, 'bu_only', 'Must be taken at BU',
       'Group C: BU only, even if a similar course exists.', 'workbook', SYSUTCDATETIME()
FROM (VALUES
  ('NU','CS 4400',    'BU','CAS CS 320'),
  ('NU','CS 3800',    'BU','CAS CS 332'),
  ('NYU','CSCI-UA 453','BU','CAS CS 332'),
  ('NYU','CSCI-UA 202','BU','CAS CS 350')
) AS m(ei,ec,bi,bc)
JOIN Institutions eInst ON eInst.Code = m.ei
JOIN Courses ext ON ext.InstitutionId = eInst.Id AND ext.Code = m.ec
JOIN Institutions bInst ON bInst.Code = m.bi
JOIN Courses bu  ON bu.InstitutionId = bInst.Id AND bu.Code = m.bc
WHERE NOT EXISTS (
    SELECT 1 FROM Equivalencies eq
    WHERE eq.ExternalCourseId = ext.Id AND eq.BUCourseId = bu.Id AND eq.IsActive = 1
);
GO
