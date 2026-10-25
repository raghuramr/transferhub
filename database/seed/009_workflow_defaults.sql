-- ============================================================
-- Seed 009 – Default transfer workflow, approver groups, document
--            types, AI settings, agent skills, permission grants
-- ============================================================
-- Everything is idempotent (IF NOT EXISTS / MERGE ... WHEN NOT MATCHED) so
-- re-running never overwrites edits an admin made in the UI.
--
-- The seeded "Standard transfer credit review" workflow is the GLOBAL
-- default (InstitutionId NULL): any intaking university without its own
-- workflow uses it. Stage list follows the desk research in
-- _designs/understanding/11_process_research_and_gaps.md.
-- ============================================================
USE TransferHubDB;
GO

-- ─── Approver groups ─────────────────────────────────────────
MERGE ApproverGroups AS target
USING (VALUES
    ('Faculty Reviewers', 'Academic department evaluators who compare syllabi and decide course equivalency.'),
    ('Finance Office',    'Reviews requests where transferred credit affects aid, billing or credit caps. Empty by default: admins can act until members are added.'),
    ('First Approvers',   'Department chair / dean level sign-off.'),
    ('Final Approvers',   'Registrar-level final approval that posts the credit.')
) AS source (Name, Description)
ON target.Name = source.Name
WHEN NOT MATCHED THEN INSERT (Name, Description) VALUES (source.Name, source.Description);
GO

-- Demo membership (only where the demo accounts exist and the membership isn't there yet).
INSERT INTO ApproverGroupMembers (GroupId, UserId)
SELECT g.Id, u.Id
FROM (VALUES
    ('Faculty Reviewers', 'faculty.cs@bu.edu'),
    ('First Approvers',   'admin@bu.edu'),
    ('Final Approvers',   'admin@bu.edu'),
    ('Final Approvers',   'super_admin@bu.edu')
) AS m (GroupName, Email)
JOIN ApproverGroups g ON g.Name = m.GroupName
JOIN Users u          ON u.Email = m.Email
WHERE NOT EXISTS (SELECT 1 FROM ApproverGroupMembers x WHERE x.GroupId = g.Id AND x.UserId = u.Id);
GO

-- ─── Document types ──────────────────────────────────────────
MERGE DocumentTypes AS target
USING (VALUES
    ('transcript',          'Official transcript',               'Sent directly by the sending institution, or a scanned copy marked unofficial.', 0, 10),
    ('syllabus',            'Course syllabus',                   'Per course: grading breakdown, textbooks, weekly topics, learning outcomes.',    1, 20),
    ('catalog_description', 'Catalog course description',        'Official catalog page or link, including prerequisites and contact hours.',      1, 30),
    ('petition_form',       'Transfer credit petition form',     'Institution-specific request form, where one is required.',                      0, 40),
    ('score_report',        'AP / IB / CLEP score report',       'Official score report from the testing body.',                                   0, 50),
    ('foreign_eval',        'Foreign credential evaluation',     'Course-by-course evaluation from a NACES member (e.g. WES, ECE) for international study.', 0, 60),
    ('translation',         'Certified English translation',     'Required when the transcript is not in English.',                                0, 70),
    ('other',               'Other supporting document',         NULL,                                                                             0, 99)
) AS source (DocTypeKey, Label, Description, PerCourse, SortOrder)
ON target.DocTypeKey = source.DocTypeKey
WHEN NOT MATCHED THEN
    INSERT (DocTypeKey, Label, Description, PerCourse, SortOrder)
    VALUES (source.DocTypeKey, source.Label, source.Description, source.PerCourse, source.SortOrder);
GO

-- ─── Default (global) workflow ───────────────────────────────
IF NOT EXISTS (SELECT 1 FROM WorkflowDefinitions WHERE InstitutionId IS NULL)
BEGIN
    INSERT INTO WorkflowDefinitions (InstitutionId, Name, Description, AllowBypass)
    VALUES (NULL, 'Standard transfer credit review',
            'Default chain used by any intaking university without its own workflow.', 1);
END
GO

DECLARE @wf INT = (SELECT Id FROM WorkflowDefinitions WHERE InstitutionId IS NULL);

IF NOT EXISTS (SELECT 1 FROM WorkflowStages WHERE WorkflowId = @wf)
BEGIN
    INSERT INTO WorkflowStages (WorkflowId, StageOrder, StageKey, Name, Description, StageType, AgentTask, SlaDays, CanBypass, RequiresComment)
    VALUES
    (@wf, 1, 'new',            'New',
        'Request received. The document checklist and a first completeness check run automatically.',                'system',   'intake',   NULL, 0, 0),
    (@wf, 2, 'start',          'Start',
        'Rules check (grade, credits, existing equivalencies) and AI pre-match for courses with no known equivalent.', 'system',   'match',    NULL, 0, 0),
    (@wf, 3, 'faculty_review', 'Faculty Review',
        'Department evaluators confirm the AI-suggested matches against the syllabus. Approve or reject on the summary.', 'review',   'none',     5,    1, 0),
    (@wf, 4, 'finance_review', 'Finance Review',
        'Only where transferred credit affects aid, billing or credit caps.',                                          'approval', 'none',     3,    1, 0),
    (@wf, 5, 'first_approval', 'First Approval',
        'Chair / dean sign-off.',                                                                                      'approval', 'none',     3,    1, 0),
    (@wf, 6, 'final_approval', 'Final Approval',
        'Registrar approval. Approving posts the credit and tells the student.',                                       'approval', 'none',     3,    0, 1),
    (@wf, 7, 'completed',      'Completed',
        'Credit posted; the student is notified.',                                                                     'system',   'finalize', NULL, 0, 0);

    -- Who can act on each human stage.
    INSERT INTO WorkflowStageApprovers (StageId, ApproverType, RoleName)
    SELECT s.Id, 'role', 'faculty'
    FROM WorkflowStages s WHERE s.WorkflowId = @wf AND s.StageKey = 'faculty_review';

    INSERT INTO WorkflowStageApprovers (StageId, ApproverType, GroupId)
    SELECT s.Id, 'group', g.Id
    FROM WorkflowStages s
    JOIN ApproverGroups g ON g.Name = CASE s.StageKey
        WHEN 'faculty_review' THEN 'Faculty Reviewers'
        WHEN 'finance_review' THEN 'Finance Office'
        WHEN 'first_approval' THEN 'First Approvers'
        WHEN 'final_approval' THEN 'Final Approvers' END
    WHERE s.WorkflowId = @wf AND s.StageKey IN ('faculty_review','finance_review','first_approval','final_approval');
END

-- Checklist: the transcript is required; everything else is offered but optional.
INSERT INTO WorkflowRequiredDocs (WorkflowId, DocTypeKey, IsRequired)
SELECT @wf, d.DocTypeKey, CASE WHEN d.DocTypeKey = 'transcript' THEN 1 ELSE 0 END
FROM DocumentTypes d
WHERE NOT EXISTS (SELECT 1 FROM WorkflowRequiredDocs x WHERE x.WorkflowId = @wf AND x.DocTypeKey = d.DocTypeKey);
GO

-- ─── AI settings (global) ────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM AiSettings WHERE InstitutionId IS NULL)
    INSERT INTO AiSettings (InstitutionId) VALUES (NULL);   -- every column has a cost-conscious default
GO

-- ─── Agent skills (injected into the matcher's system prompt while active) ──
MERGE AgentSkills AS target
USING (VALUES
    ('credit_and_level',  'Compare credits and level',   'matching',
     'Compare credit hours and course level. Do not match a 3-credit external course to a 4-credit target course unless the content clearly spans it. Prefer the same level (100/200/300).', 10),
    ('lab_component',     'Respect lab components',      'matching',
     'If the external course includes a lab, prefer target courses that include a lab. Do not match a lecture-only course to a lab course.', 20),
    ('topic_overlap',     'Weigh topics over titles',    'matching',
     'When topics are provided, weigh topic overlap more heavily than title similarity. Different titles can still be the same content.', 30),
    ('residency_courses', 'Must-take-at-home courses',   'policy',
     'Courses that must be taken at the receiving university (e.g. BU CS Group C: CS 320, CS 332, CS 350) must never be ranked as an equivalent. At most they can be suggested as elective credit.', 40),
    ('recommend_only',    'Recommend, never decide',     'policy',
     'You only recommend. Academic departments make the final decision. Never state that credit has been granted.', 50),
    ('compact_output',    'Compact output',              'token_saving',
     'Return JSON only. Keep each rationale under 25 words. Omit candidates scoring below 0.2.', 60),
    ('no_padding',        'Do not pad the list',         'token_saving',
     'If nothing in the list plausibly matches, return an empty array instead of padding to three candidates.', 70)
) AS source (SkillKey, Title, Category, Instructions, SortOrder)
ON target.SkillKey = source.SkillKey
WHEN NOT MATCHED THEN
    INSERT (SkillKey, Title, Category, Instructions, SortOrder)
    VALUES (source.SkillKey, source.Title, source.Category, source.Instructions, source.SortOrder);
GO

-- ─── Roles & Permissions matrix: new modules + starting grants ─────────
MERGE PermissionModules AS target
USING (VALUES
    ('requests',    'Transfer Requests',     150),
    ('workflows',   'Workflows & Approvers', 160),
    ('ai_controls', 'AI Controls',           170)
) AS source ([Key], Label, SortOrder)
ON target.[Key] = source.[Key]
WHEN NOT MATCHED THEN INSERT ([Key], Label, SortOrder) VALUES (source.[Key], source.Label, source.SortOrder);
GO

IF OBJECT_ID('tempdb..#NewGrants') IS NOT NULL DROP TABLE #NewGrants;
CREATE TABLE #NewGrants (RoleName VARCHAR(20), ModuleKey VARCHAR(50), OperationKey VARCHAR(50));
INSERT INTO #NewGrants VALUES
-- requests: staff work the queue (view/edit); bulk_action = bypass the remaining stages
('faculty',     'requests', 'view'), ('admin', 'requests', 'view'), ('super_admin', 'requests', 'view'),
('faculty',     'requests', 'edit'), ('admin', 'requests', 'edit'), ('super_admin', 'requests', 'edit'),
('admin',       'requests', 'bulk_action'), ('super_admin', 'requests', 'bulk_action'),
-- workflows: design stages/approvers per university
('admin', 'workflows', 'view'), ('super_admin', 'workflows', 'view'),
('admin', 'workflows', 'create'), ('super_admin', 'workflows', 'create'),
('admin', 'workflows', 'edit'), ('super_admin', 'workflows', 'edit'),
('admin', 'workflows', 'delete'), ('super_admin', 'workflows', 'delete'),
-- ai_controls: admins can look, only super_admin can change spend-affecting settings
('admin', 'ai_controls', 'view'), ('super_admin', 'ai_controls', 'view'),
('super_admin', 'ai_controls', 'edit');

MERGE RolePermissions AS target
USING (
    SELECT r.Id AS RoleId, m.Id AS ModuleId, o.Id AS OperationId
    FROM #NewGrants g
    JOIN Roles r                ON r.Name = g.RoleName
    JOIN PermissionModules m    ON m.[Key] = g.ModuleKey
    JOIN PermissionOperations o ON o.[Key] = g.OperationKey
) AS source (RoleId, ModuleId, OperationId)
ON target.RoleId = source.RoleId AND target.ModuleId = source.ModuleId AND target.OperationId = source.OperationId
WHEN NOT MATCHED THEN
    INSERT (RoleId, ModuleId, OperationId, IsAllowed) VALUES (source.RoleId, source.ModuleId, source.OperationId, 1);

DROP TABLE #NewGrants;
GO
