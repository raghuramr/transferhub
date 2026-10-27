-- ============================================================
-- Seed 019 - Exam credit defaults + international / exam documents
-- ============================================================
-- Needs migration 028. Idempotent (safe to re-run).
--
-- 1. Global minimum scores for AP / IB / CLEP / A-level.
--    *** DEFAULTS - CONFIRM WITH BU. *** doc 12 (BU policy) states no minimum score; these follow
--    doc 11 (AP >= 3, CLEP >= 50, IB higher-level 5+, A-level C or better). IB Standard Level has no
--    rule on purpose: it goes to a reviewer. Universities override per exam type under
--    Workflows > Transfer rules > Exam credit.
-- 2. Three new document types, offered on every workflow. The engine decides when each applies
--    (WorkflowEngineService.documentChecklist + policy/exam-credit.ts conditionalDocApplies):
--      credential_evaluation  - course-by-course foreign credential evaluation by a NACES member
--      certified_translation  - certified English translation of non-English transcripts
--      exam_score_report      - official AP/IB/CLEP/A-level report from the testing body
--    The first two are shown as "needed by International Admissions"; they do not change routing.
-- ============================================================
USE TransferHubDB;
GO

DECLARE @rules TABLE (ExamType VARCHAR(10), SubjectPattern NVARCHAR(150) NULL, MinScore VARCHAR(10), Notes NVARCHAR(300));
INSERT INTO @rules VALUES
    ('AP',      NULL,                '3',  N'Default - confirm with BU. AP score 3 or higher.'),
    ('IB',      N'HL|Higher Level',  '5',  N'Default - confirm with BU. Higher Level 5 or higher; Standard Level has no rule (reviewer decides).'),
    ('CLEP',    NULL,                '50', N'Default - confirm with BU. CLEP 50 or higher.'),
    ('A-level', NULL,                'C',  N'Default - confirm with BU. Grade C or better.');

INSERT INTO ExamCreditRules (InstitutionId, ExamType, SubjectPattern, MinScore, Notes)
SELECT NULL, r.ExamType, r.SubjectPattern, r.MinScore, r.Notes
FROM @rules r
WHERE NOT EXISTS (
    SELECT 1 FROM ExamCreditRules x
    WHERE x.InstitutionId IS NULL AND x.ExamType = r.ExamType AND ISNULL(x.SubjectPattern, N'') = ISNULL(r.SubjectPattern, N'')
);
GO

MERGE DocumentTypes AS target
USING (VALUES
    ('credential_evaluation', 'Course-by-course credential evaluation (NACES)', 'Foreign credential evaluation from a NACES member such as WES or ECE. Needed by International Admissions for coursework completed outside the US.', 0, 20),
    ('certified_translation', 'Certified English translation',                  'Official certified translation of any transcript not in English, done by a translation service (not by you or your family). Needed by International Admissions.', 0, 21),
    ('exam_score_report',     'AP / IB / CLEP / A-level score report',          'Official score report sent by the testing body (College Board, IB, CLEP, exam board). Needed for the exams you listed.', 0, 22)
) AS source (DocTypeKey, Label, Description, PerCourse, SortOrder)
ON target.DocTypeKey = source.DocTypeKey
WHEN NOT MATCHED THEN
    INSERT (DocTypeKey, Label, Description, PerCourse, SortOrder)
    VALUES (source.DocTypeKey, source.Label, source.Description, source.PerCourse, source.SortOrder);
GO

-- Offer them on every existing workflow (required where they apply; the engine skips ones that do not).
INSERT INTO WorkflowRequiredDocs (WorkflowId, DocTypeKey, IsRequired)
SELECT w.Id, k.DocTypeKey, 1
FROM WorkflowDefinitions w
CROSS JOIN (VALUES ('credential_evaluation'), ('certified_translation'), ('exam_score_report')) AS k (DocTypeKey)
WHERE NOT EXISTS (SELECT 1 FROM WorkflowRequiredDocs x WHERE x.WorkflowId = w.Id AND x.DocTypeKey = k.DocTypeKey);
GO

PRINT 'Seed 019 applied: exam credit defaults + document types.';
GO
