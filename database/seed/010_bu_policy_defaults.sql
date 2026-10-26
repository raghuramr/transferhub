-- ============================================================
-- Seed 010: defaults for BU policy alignment (migration 015)
--   * global TransferPolicies row (BU: C or better, 68/60 caps, 5-year review,
--     P/F to review, regional accreditation required, 10 Hub requirements)
--   * accreditation for the seeded institutions
--   * BU schools/colleges (needed for "intended school/college" at registration)
--   * new document types + the global workflow's checklist entries
-- Idempotent.
-- ============================================================
USE TransferHubDB;
GO

IF NOT EXISTS (SELECT 1 FROM TransferPolicies WHERE InstitutionId IS NULL)
    INSERT INTO TransferPolicies (InstitutionId) VALUES (NULL);   -- column defaults = BU's published policy
GO

-- Accreditation (regional accreditors). Synthetic colleges are marked accredited so demos behave normally.
UPDATE Institutions SET IsAccredited = 1, Accreditor = 'NECHE' WHERE Code IN ('BU','NU') AND IsAccredited IS NULL;
UPDATE Institutions SET IsAccredited = 1, Accreditor = 'MSCHE' WHERE Code = 'NYU' AND IsAccredited IS NULL;
UPDATE Institutions SET IsAccredited = 1, Accreditor = 'NECHE (synthetic)' WHERE Code IN ('BSCC','PVTC') AND IsAccredited IS NULL;
GO

-- BU schools and colleges (undergraduate) - a transfer applicant must choose one.
MERGE AcademicUnits AS target
USING (VALUES
    ('College of Arts & Sciences',                 'CAS'),
    ('College of Engineering',                     'ENG'),
    ('Questrom School of Business',                'QST'),
    ('College of Communication',                   'COM'),
    ('Sargent College of Health & Rehabilitation Sciences', 'SAR'),
    ('College of Fine Arts',                       'CFA'),
    ('School of Hospitality Administration',       'SHA'),
    ('Wheelock College of Education & Human Development', 'WED'),
    ('Metropolitan College',                       'MET'),
    ('Faculty of Computing & Data Sciences',       'CDS')
) AS source (Name, Code)
ON target.Name = source.Name AND target.InstitutionId = (SELECT Id FROM Institutions WHERE Code = 'BU')
WHEN MATCHED AND target.Code IS NULL THEN UPDATE SET Code = source.Code
WHEN NOT MATCHED THEN
    INSERT (InstitutionId, Name, Code) VALUES ((SELECT Id FROM Institutions WHERE Code = 'BU'), source.Name, source.Code);
GO

-- Documents BU asks for (doc 12, BU-AD-03/08, BU-EL-09). Which ones apply to a given student is
-- decided in code (applicant type, English, institutions attended); see WorkflowEngineService.documentChecklist.
MERGE DocumentTypes AS target
USING (VALUES
    ('transfer_college_report', 'Transfer College Report',            'One per college attended, completed by its dean or registrar.',                     0, 12),
    ('final_transcript',        'Final official transcript',          'Showing your final semester, from every college attended (needed for the official evaluation).', 0, 14),
    ('hs_transcript',           'High-school transcript / proof of graduation', 'Final high-school transcript or diploma.',                               0, 16),
    ('english_test',            'English proficiency score report',   'TOEFL iBT, IELTS or Duolingo - required if English is not your first language.',    0, 18),
    ('dual_enrollment_form',    'Dual Enrollment Form',               'Signed by your high school; send with the college transcript and syllabi.',         0, 19)
) AS source (DocTypeKey, Label, Description, PerCourse, SortOrder)
ON target.DocTypeKey = source.DocTypeKey
WHEN NOT MATCHED THEN
    INSERT (DocTypeKey, Label, Description, PerCourse, SortOrder)
    VALUES (source.DocTypeKey, source.Label, source.Description, source.PerCourse, source.SortOrder);
GO

-- Offer them on the global workflow (required where they apply; the engine skips ones that do not apply).
DECLARE @wf INT = (SELECT TOP 1 Id FROM WorkflowDefinitions WHERE InstitutionId IS NULL);
IF @wf IS NOT NULL
BEGIN
    INSERT INTO WorkflowRequiredDocs (WorkflowId, DocTypeKey, IsRequired)
    SELECT @wf, k.DocTypeKey, 1
    FROM (VALUES ('transfer_college_report'), ('final_transcript'), ('hs_transcript'), ('english_test'), ('dual_enrollment_form')) AS k (DocTypeKey)
    WHERE NOT EXISTS (SELECT 1 FROM WorkflowRequiredDocs x WHERE x.WorkflowId = @wf AND x.DocTypeKey = k.DocTypeKey);
    -- BU only needs syllabi for courses that are not an existing match (doc 12, BU-EV-04); the engine counts them per course.
    UPDATE WorkflowRequiredDocs SET IsRequired = 1 WHERE WorkflowId = @wf AND DocTypeKey = 'syllabus';
END
GO

PRINT 'Seed 010 applied: BU policy defaults.';
GO
