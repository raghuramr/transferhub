-- ============================================================
-- Seed 002 – BU Course Catalog (from BU_Transfer_Program_Course_Match.xlsx)
-- ============================================================
USE UniversityManager;
GO

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
