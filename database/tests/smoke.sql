-- ============================================================
-- database/tests/smoke.sql - read-only SQL smoke test
-- ============================================================
-- Asserts that everything the app relies on exists after migrations 002-024 + seeds 001-017, and that the seeded
-- data is sane. READ-ONLY: only SELECTs and a session temp table (#smoke); nothing in the database is changed.
-- NOT a migration/seed: it lives in database/tests/ so the db-script-runner and db-mcp-server (which only list
-- database/migrations and database/seed) never pick it up or record it in dbo.__ScriptRunnerHistory.
--
-- Run it connected to the TransferHubDB database (no USE statement on purpose: Azure SQL cannot switch databases):
--   sqlcmd -S <server>,1433 -d TransferHubDB -U <user> -P <pwd> -N -C -b -i database/tests/smoke.sql
--   (-b makes sqlcmd exit non-zero when a check FAILs; WARN and SKIP rows never fail the run.)
-- or paste it into SSMS / Azure Data Studio and read the result grid. See docs/TESTING.md.
--
-- Result values:  PASS | FAIL (a required object/data is wrong) | WARN (worth a look, not fatal) | SKIP (precondition absent,
-- e.g. the Maya demo is not seeded - normal on a real system).
-- Single batch, no GO: the whole file runs on one connection so the temp table survives.
-- Section 6 asserts migrations 001-024 and seeds 001-017 only; add newer files to that list (and their objects to sections 1-4) as they are
-- adopted. Newer migrations never make this file fail.
-- ============================================================
SET NOCOUNT ON;

IF OBJECT_ID('tempdb..#chk') IS NOT NULL DROP TABLE #chk;
IF OBJECT_ID('tempdb..#smoke') IS NOT NULL DROP TABLE #smoke;
CREATE TABLE #chk (Id INT IDENTITY(1,1) PRIMARY KEY, Section VARCHAR(30), Name NVARCHAR(200), Sql NVARCHAR(MAX), OnFail VARCHAR(4));
CREATE TABLE #smoke (Id INT IDENTITY(1,1) PRIMARY KEY, Section VARCHAR(30), Name NVARCHAR(200), Result VARCHAR(4), Detail NVARCHAR(400));

-- Each check's Sql sets @ok (1 = pass, 0 = fail, NULL = skip) and optionally @detail. OnFail = FAIL or WARN.

-- 1. Tables ------------------------------------------------------------------
INSERT #chk (Section, Name, Sql, OnFail)
SELECT 'tables', 'table ' + v.n,
       'SELECT @ok = CASE WHEN OBJECT_ID(N''dbo.' + v.n + ''', ''U'') IS NULL THEN 0 ELSE 1 END', 'FAIL'
FROM (VALUES
 ('Roles'),('Departments'),('Users'),('RefreshTokens'),('PasswordResetTokens'),('AuditLog'),
 ('PermissionModules'),('PermissionOperations'),('RolePermissions'),
 ('Institutions'),('Programs'),('Courses'),('Equivalencies'),
 ('StudentProfiles'),('Transcripts'),('TranscriptCourses'),('Syllabi'),('Evaluations'),('AIMatchCandidates'),
 ('Pages'),('Forms'),('FormSubmissions'),
 ('Agencies'),('AcademicUnits'),('UserScopeUniversities'),('UserScopeAcademicUnits'),('UserScopeAgencies'),
 ('CourseTopics'),('Uploads'),
 ('ProgramUniversities'),('ProgramCourses'),('UniversityTopicStatus'),
 ('WorkflowDefinitions'),('WorkflowStages'),('WorkflowStageApprovers'),('ApproverGroups'),('ApproverGroupMembers'),
 ('DocumentTypes'),('WorkflowRequiredDocs'),('TranscriptStages'),('TranscriptNotes'),('StatusReminders'),
 ('AiSettings'),('AiUsageLog'),('AiMatchCache'),('AgentSkills'),
 ('DataPartners'),('PartnerApiKeys'),('ImportBatches'),('ImportBatchRows'),
 ('TransferPolicies'),('StudentEducation'),('StudentExamCredits'),('CourseAppeals'),('TranscriptDocuments'),
 ('EmailChangeRequests'),('CourseVerificationRequests'),
 ('StudentSourceProfiles'),('StudentSourceCourses'),('StudentSourceDocuments'),('IntakeSessions'),
 ('DocumentIntakes'),('DocumentRequests'),('PartyReminders'),
 ('AppSettings'),('CreditDeadlineNotices')
) v(n);

-- 2. Key columns (table, column) -------------------------------------------------
INSERT #chk (Section, Name, Sql, OnFail)
SELECT 'columns', v.t + '.' + v.c,
       'SELECT @ok = CASE WHEN COL_LENGTH(N''dbo.' + v.t + ''', N''' + v.c + ''') IS NULL THEN 0 ELSE 1 END', 'FAIL'
FROM (VALUES
 ('Users','Email'),('Users','RoleId'),('Users','StudentId'),('Users','AgencyId'),('Users','EmailVerified'),('Users','AvatarUploadId'),
 ('Institutions','Calendar'),('Institutions','Type'),('Institutions','IsBU'),('Institutions','IsActive'),
 ('Programs','InstitutionId'),('Programs','IsActive'),
 ('Courses','InstitutionId'),('Courses','Credits'),('Courses','ProgramId'),('Courses','Verified'),
 ('Equivalencies','ExternalCourseId'),('Equivalencies','BUCourseId'),('Equivalencies','Outcome'),('Equivalencies','BUCredits'),
 ('Equivalencies','EffectiveFrom'),('Equivalencies','EffectiveTo'),
 ('StudentProfiles','TargetInstitutionId'),('StudentProfiles','TargetProgramId'),('StudentProfiles','ApplicantType'),('StudentProfiles','StartDate'),
 ('Transcripts','InstitutionId'),('Transcripts','StudentUserId'),('Transcripts','TargetInstitutionId'),('Transcripts','WorkflowId'),
 ('Transcripts','CurrentStageOrder'),('Transcripts','WorkflowStatus'),('Transcripts','EvaluationKind'),('Transcripts','PreapprovalExpiresAt'),
 ('TranscriptCourses','OriginalCredits'),('TranscriptCourses','NormalisedCredits'),('TranscriptCourses','Grade'),('TranscriptCourses','Lane'),
 ('TranscriptCourses','GradeIsEligible'),('TranscriptCourses','ExternalCourseId'),('TranscriptCourses','TermSeason'),('TranscriptCourses','TermYear'),
 ('TranscriptCourses','GradingBasis'),('TranscriptCourses','DeliveryMode'),('TranscriptCourses','CourseType'),('TranscriptCourses','IsOutsideUS'),
 ('TranscriptCourses','PassFailException'),('TranscriptCourses','PolicyFlags'),
 ('TransferPolicies','MinGrade'),('TransferPolicies','CapTransfer'),('TransferPolicies','CreditDeadlineMonths'),
 ('AiSettings','RulesFallbackEnabled'),
 ('Uploads','StorageProvider'),('Uploads','ContainerName'),('Uploads','DocumentType'),('Uploads','StudentUserId'),('Uploads','TranscriptId'),
 ('Uploads','UploadedByParty'),('Uploads','UploadedByInstitutionId'),('Uploads','Note'),('Uploads','DocumentRequestId'),
 ('DocumentRequests','TranscriptId'),('DocumentRequests','RequestedByParty'),('DocumentRequests','RequestedFromParty'),('DocumentRequests','Status'),
 ('PartyReminders','TranscriptId'),('PartyReminders','FromParty'),('PartyReminders','ToParty'),
 ('AppSettings','SettingKey'),('AppSettings','SettingValue'),
 ('CreditDeadlineNotices','Id')
) v(t, c);

-- 3. Check constraints ----------------------------------------------------------
INSERT #chk (Section, Name, Sql, OnFail)
SELECT 'constraints', v.n,
       'SELECT @ok = CASE WHEN EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N''' + v.n + ''') THEN 1 ELSE 0 END', 'FAIL'
FROM (VALUES
 ('CK_TC_Lane'),('CK_TC_Status'),('CK_Equiv_Outcome'),('CK_Equiv_DateRange'),('CK_Eval_Outcome'),('CK_Eval_Status'),
 ('CK_Institutions_Calendar'),('CK_Institutions_Type'),('CK_Trans_Status'),('CK_Trans_WorkflowStatus'),('CK_T_EvalKind'),
 ('CK_TP_MinGrade'),('CK_TP_CreditDeadlineMonths'),('CK_DocReq_Status'),('CK_DocReq_Distinct'),('CK_DocReq_ByParty'),
 ('CK_PartyRem_From'),('CK_PartyRem_To'),('CK_AgentSkills_Category'),('CK_IBR_Entity'),('CK_TS_Status')
) v(n);
INSERT #chk (Section, Name, Sql, OnFail) VALUES
 ('constraints', 'CK_TC_Lane allows all six lanes',
  'SELECT @ok = CASE WHEN NOT EXISTS (SELECT 1 FROM (VALUES (''pending''),(''applied''),(''likely''),(''needs_syllabus''),(''elective_only''),(''not_eligible'')) l(x) WHERE (SELECT definition FROM sys.check_constraints WHERE name = N''CK_TC_Lane'') NOT LIKE ''%'' + l.x + ''%'') THEN 1 ELSE 0 END', 'FAIL'),
 ('constraints', 'CK_AgentSkills_Category allows ''documents'' (migration 020)',
  'SELECT @ok = CASE WHEN (SELECT definition FROM sys.check_constraints WHERE name = N''CK_AgentSkills_Category'') LIKE ''%documents%'' THEN 1 ELSE 0 END', 'FAIL'),
 ('constraints', 'CK_IBR_Entity allows ''students'' (migration 019)',
  'SELECT @ok = CASE WHEN (SELECT definition FROM sys.check_constraints WHERE name = N''CK_IBR_Entity'') LIKE ''%students%'' THEN 1 ELSE 0 END', 'FAIL');

-- 4. Views and stored procedures ------------------------------------------------
INSERT #chk (Section, Name, Sql, OnFail)
SELECT 'programmability', 'view ' + v.n, 'SELECT @ok = CASE WHEN OBJECT_ID(N''dbo.' + v.n + ''', ''V'') IS NULL THEN 0 ELSE 1 END', 'FAIL'
FROM (VALUES ('vw_StudentTranscriptSummary'),('vw_EvaluatorQueue'),('vw_MatchSummary')) v(n);
INSERT #chk (Section, Name, Sql, OnFail) VALUES
 ('programmability', 'procedure sp_TriageCourse exists', 'SELECT @ok = CASE WHEN OBJECT_ID(N''dbo.sp_TriageCourse'', ''P'') IS NULL THEN 0 ELSE 1 END', 'FAIL'),
 ('programmability', 'procedure sp_RecordDecision exists', 'SELECT @ok = CASE WHEN OBJECT_ID(N''dbo.sp_RecordDecision'', ''P'') IS NULL THEN 0 ELSE 1 END', 'FAIL'),
 ('programmability', 'sp_TriageCourse is the migration-017 version (effective dates)',
  'SELECT @ok = CASE WHEN OBJECT_DEFINITION(OBJECT_ID(N''dbo.sp_TriageCourse'')) LIKE ''%EffectiveFrom%'' THEN 1 ELSE 0 END', 'FAIL'),
 ('programmability', 'sp_TriageCourse has the quarter conversion (FLOOR(credits*2/3*100)/100)',
  'SELECT @ok = CASE WHEN OBJECT_DEFINITION(OBJECT_ID(N''dbo.sp_TriageCourse'')) LIKE ''%FLOOR(@OrigCredits * 2.0 / 3.0 * 100)%'' THEN 1 ELSE 0 END', 'FAIL'),
 ('programmability', 'sp_RecordDecision is the migration-017 version (effective dates)',
  'SELECT @ok = CASE WHEN OBJECT_DEFINITION(OBJECT_ID(N''dbo.sp_RecordDecision'')) LIKE ''%Effective%'' THEN 1 ELSE 0 END', 'WARN');

-- 5. Reference data and sanity ----------------------------------------------------
INSERT #chk (Section, Name, Sql, OnFail)
SELECT 'data', 'role ' + v.n + ' exists', 'SELECT @ok = CASE WHEN EXISTS (SELECT 1 FROM Roles WHERE Name = N''' + v.n + ''') THEN 1 ELSE 0 END', 'FAIL'
FROM (VALUES ('student'),('faculty'),('admin'),('agency'),('super_admin')) v(n);
INSERT #chk (Section, Name, Sql, OnFail)
SELECT 'data', 'institution ' + v.n + ' present', 'SELECT @ok = CASE WHEN EXISTS (SELECT 1 FROM Institutions WHERE Code = N''' + v.n + ''') THEN 1 ELSE 0 END', 'FAIL'
FROM (VALUES ('BU'),('NU'),('NYU')) v(n);
INSERT #chk (Section, Name, Sql, OnFail) VALUES
 ('data', 'BU is flagged IsBU and uses the semester calendar',
  'SELECT @ok = CASE WHEN EXISTS (SELECT 1 FROM Institutions WHERE Code = N''BU'' AND IsBU = 1 AND Calendar = ''semester'') THEN 1 ELSE 0 END', 'FAIL'),
 ('data', 'at least 3 active receiving universities (Type = university)',
  'SELECT @ok = CASE WHEN (SELECT COUNT(*) FROM Institutions WHERE IsActive = 1 AND Type = ''university'') >= 3 THEN 1 ELSE 0 END, @detail = CONCAT((SELECT COUNT(*) FROM Institutions WHERE IsActive = 1 AND Type = ''university''), '' found'')', 'FAIL'),
 ('data', 'Courses exist for BU, NU and NYU',
  'SELECT @ok = CASE WHEN (SELECT COUNT(DISTINCT i.Code) FROM Courses c JOIN Institutions i ON i.Id = c.InstitutionId WHERE i.Code IN (N''BU'', N''NU'', N''NYU'')) = 3 THEN 1 ELSE 0 END', 'FAIL'),
 ('data', 'active equivalencies > 0',
  'SELECT @detail = CONCAT((SELECT COUNT(*) FROM Equivalencies WHERE IsActive = 1), '' active''), @ok = CASE WHEN EXISTS (SELECT 1 FROM Equivalencies WHERE IsActive = 1) THEN 1 ELSE 0 END', 'FAIL'),
 ('data', 'every equivalency points at a BU-side course of a different institution than the external one',
  'SELECT @ok = CASE WHEN NOT EXISTS (SELECT 1 FROM Equivalencies e JOIN Courses x ON x.Id = e.ExternalCourseId JOIN Courses b ON b.Id = e.BUCourseId WHERE x.InstitutionId = b.InstitutionId) THEN 1 ELSE 0 END', 'WARN'),
 ('data', 'a global default workflow exists (InstitutionId IS NULL, active)',
  'SELECT @ok = CASE WHEN EXISTS (SELECT 1 FROM WorkflowDefinitions WHERE InstitutionId IS NULL AND IsActive = 1) THEN 1 ELSE 0 END', 'FAIL'),
 ('data', 'a global transfer policy row exists (InstitutionId IS NULL)',
  'SELECT @ok = CASE WHEN EXISTS (SELECT 1 FROM TransferPolicies WHERE InstitutionId IS NULL) THEN 1 ELSE 0 END', 'FAIL'),
 ('data', 'permission modules requests / transfers / ai_controls / workflows are seeded',
  'SELECT @ok = CASE WHEN (SELECT COUNT(*) FROM PermissionModules WHERE [Key] IN (N''requests'', N''transfers'', N''ai_controls'', N''workflows'')) = 4 THEN 1 ELSE 0 END', 'FAIL'),
 ('data', 'AppSettings has the demo-login keys (migration 023)',
  'SELECT @ok = CASE WHEN EXISTS (SELECT 1 FROM AppSettings WHERE SettingKey LIKE N''demo%'') THEN 1 ELSE 0 END', 'WARN'),
 ('data', 'quarter conversion: FLOOR(4 * 2/3 * 100) / 100 = 2.66 (not 2.67)',
  'SELECT @ok = CASE WHEN CAST(FLOOR(CAST(4 AS DECIMAL(5,2)) * 2.0 / 3.0 * 100) / 100 AS DECIMAL(5,2)) = 2.66 THEN 1 ELSE 0 END', 'FAIL'),
 ('data', 'PVTC (the quarter-system demo college) uses the quarter calendar',
  'SELECT @ok = CASE WHEN NOT EXISTS (SELECT 1 FROM Institutions WHERE Code = N''PVTC'') THEN NULL WHEN EXISTS (SELECT 1 FROM Institutions WHERE Code = N''PVTC'' AND Calendar = ''quarter'') THEN 1 ELSE 0 END', 'FAIL'),
 ('data', 'no student has a NULL target university (after seed 017)',
  'SELECT @detail = CONCAT((SELECT COUNT(*) FROM Users u JOIN Roles r ON r.Id = u.RoleId AND r.Name = ''student'' LEFT JOIN StudentProfiles sp ON sp.UserId = u.Id WHERE sp.UserId IS NULL OR sp.TargetInstitutionId IS NULL), '' students without a target''), @ok = CASE WHEN EXISTS (SELECT 1 FROM Users u JOIN Roles r ON r.Id = u.RoleId AND r.Name = ''student'' LEFT JOIN StudentProfiles sp ON sp.UserId = u.Id WHERE sp.UserId IS NULL OR sp.TargetInstitutionId IS NULL) THEN 0 ELSE 1 END', 'FAIL'),
 ('data', 'students are spread over more than one receiving university (seed 017)',
  'SELECT @detail = CONCAT((SELECT COUNT(DISTINCT sp.TargetInstitutionId) FROM StudentProfiles sp), '' distinct targets''), @ok = CASE WHEN (SELECT COUNT(DISTINCT sp.TargetInstitutionId) FROM StudentProfiles sp) > 1 THEN 1 ELSE 0 END', 'WARN');

-- Maya demo scenario (seed 015 / Demo scenario page): SKIP when the demo is not seeded.
INSERT #chk (Section, Name, Sql, OnFail) VALUES
 ('maya', 'Maya has exactly two "Demo scenario" transcripts (BSCC + PVTC)',
  'DECLARE @n INT = (SELECT COUNT(*) FROM Transcripts t JOIN Users u ON u.Id = t.StudentUserId WHERE u.Email = N''student@test.edu'' AND t.Notes LIKE N''Demo scenario%''); DECLARE @inst INT = (SELECT COUNT(DISTINCT i.Code) FROM Transcripts t JOIN Users u ON u.Id = t.StudentUserId JOIN Institutions i ON i.Id = t.InstitutionId WHERE u.Email = N''student@test.edu'' AND t.Notes LIKE N''Demo scenario%'' AND i.Code IN (N''BSCC'', N''PVTC'')); SELECT @detail = CONCAT(@n, '' transcripts, '', @inst, '' of BSCC/PVTC''), @ok = CASE WHEN @n = 0 THEN NULL WHEN @n = 2 AND @inst = 2 THEN 1 ELSE 0 END', 'FAIL'),
 ('maya', 'Maya''s demo transcripts hold 6 courses, 3 of them with CSC 110 / MAT 210 / ECO 101',
  'DECLARE @c INT = (SELECT COUNT(*) FROM TranscriptCourses tc JOIN Transcripts t ON t.Id = tc.TranscriptId JOIN Users u ON u.Id = t.StudentUserId WHERE u.Email = N''student@test.edu'' AND t.Notes LIKE N''Demo scenario%''); DECLARE @k INT = (SELECT COUNT(*) FROM TranscriptCourses tc JOIN Transcripts t ON t.Id = tc.TranscriptId JOIN Users u ON u.Id = t.StudentUserId WHERE u.Email = N''student@test.edu'' AND t.Notes LIKE N''Demo scenario%'' AND tc.CourseCode IN (N''CSC 110'', N''MAT 210'', N''ECO 101'')); SELECT @detail = CONCAT(@c, '' courses, '', @k, '' of the three known''), @ok = CASE WHEN @c = 0 THEN NULL WHEN @c = 6 AND @k = 3 THEN 1 ELSE 0 END', 'FAIL'),
 ('maya', 'Maya''s quarter course CIS 150 is stored as 4 original / 2.66 normalised credits',
  'DECLARE @o DECIMAL(5,2), @n DECIMAL(5,2); SELECT @o = tc.OriginalCredits, @n = tc.NormalisedCredits FROM TranscriptCourses tc JOIN Transcripts t ON t.Id = tc.TranscriptId JOIN Users u ON u.Id = t.StudentUserId WHERE u.Email = N''student@test.edu'' AND t.Notes LIKE N''Demo scenario%'' AND tc.CourseCode = N''CIS 150''; SELECT @detail = CONCAT(''original '', @o, '', normalised '', @n), @ok = CASE WHEN @o IS NULL THEN NULL WHEN @o = 4 AND @n = 2.66 THEN 1 ELSE 0 END', 'FAIL');

-- Orphans in the exchange tables (some links have no FK on purpose: uploads are never cascaded away).
INSERT #chk (Section, Name, Sql, OnFail) VALUES
 ('orphans', 'DocumentRequests -> Transcripts',
  'SELECT @detail = CONCAT((SELECT COUNT(*) FROM DocumentRequests d WHERE NOT EXISTS (SELECT 1 FROM Transcripts t WHERE t.Id = d.TranscriptId)), '' orphans''), @ok = CASE WHEN EXISTS (SELECT 1 FROM DocumentRequests d WHERE NOT EXISTS (SELECT 1 FROM Transcripts t WHERE t.Id = d.TranscriptId)) THEN 0 ELSE 1 END', 'FAIL'),
 ('orphans', 'DocumentRequests.DocTypeKey -> DocumentTypes',
  'SELECT @ok = CASE WHEN EXISTS (SELECT 1 FROM DocumentRequests d WHERE d.DocTypeKey IS NOT NULL AND NOT EXISTS (SELECT 1 FROM DocumentTypes x WHERE x.DocTypeKey = d.DocTypeKey)) THEN 0 ELSE 1 END', 'FAIL'),
 ('orphans', 'DocumentRequests.FulfilledUploadId -> Uploads (no FK by design)',
  'SELECT @ok = CASE WHEN EXISTS (SELECT 1 FROM DocumentRequests d WHERE d.FulfilledUploadId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM Uploads u WHERE u.Id = d.FulfilledUploadId)) THEN 0 ELSE 1 END', 'WARN'),
 ('orphans', 'PartyReminders.DocumentRequestId -> DocumentRequests',
  'SELECT @ok = CASE WHEN EXISTS (SELECT 1 FROM PartyReminders r WHERE r.DocumentRequestId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM DocumentRequests d WHERE d.Id = r.DocumentRequestId)) THEN 0 ELSE 1 END', 'FAIL'),
 ('orphans', 'PartyReminders -> Transcripts',
  'SELECT @ok = CASE WHEN EXISTS (SELECT 1 FROM PartyReminders r WHERE NOT EXISTS (SELECT 1 FROM Transcripts t WHERE t.Id = r.TranscriptId)) THEN 0 ELSE 1 END', 'FAIL'),
 ('orphans', 'Uploads.DocumentRequestId -> DocumentRequests',
  'SELECT @ok = CASE WHEN EXISTS (SELECT 1 FROM Uploads u WHERE u.DocumentRequestId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM DocumentRequests d WHERE d.Id = u.DocumentRequestId)) THEN 0 ELSE 1 END', 'FAIL'),
 ('orphans', 'Uploads.TranscriptId -> Transcripts',
  'SELECT @ok = CASE WHEN EXISTS (SELECT 1 FROM Uploads u WHERE u.TranscriptId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM Transcripts t WHERE t.Id = u.TranscriptId)) THEN 0 ELSE 1 END', 'WARN'),
 ('orphans', 'exchange party values are valid on open document requests (student / source_university / target_university)',
  'SELECT @ok = CASE WHEN EXISTS (SELECT 1 FROM DocumentRequests d WHERE d.RequestedByParty = d.RequestedFromParty) THEN 0 ELSE 1 END', 'FAIL'),
 ('orphans', 'transcript courses without a transcript',
  'SELECT @ok = CASE WHEN EXISTS (SELECT 1 FROM TranscriptCourses tc WHERE NOT EXISTS (SELECT 1 FROM Transcripts t WHERE t.Id = tc.TranscriptId)) THEN 0 ELSE 1 END', 'FAIL');

-- 6. Script ledger: dbo.__ScriptRunnerHistory (written by db-script-runner and db-mcp-server) ----------
-- A missing ledger table is only a WARN (scripts may have been applied by hand in SSMS). 001_database.sql cannot run on
-- Azure SQL (CREATE DATABASE), so its absence is a WARN as well.
INSERT #chk (Section, Name, Sql, OnFail)
SELECT 'ledger', v.k + '/' + v.f,
       'SELECT @ok = CASE WHEN OBJECT_ID(N''dbo.__ScriptRunnerHistory'', ''U'') IS NULL THEN NULL ELSE 0 END; ' +
       'IF @ok IS NOT NULL SELECT @ok = CASE WHEN EXISTS (SELECT 1 FROM dbo.__ScriptRunnerHistory h WHERE h.ScriptName = N''' + v.f + ''' AND h.Id = (SELECT MAX(h2.Id) FROM dbo.__ScriptRunnerHistory h2 WHERE h2.ScriptName = h.ScriptName) AND h.Success = 1) THEN 1 ELSE 0 END',
       CASE WHEN v.f = '001_database.sql' THEN 'WARN' ELSE 'FAIL' END
FROM (VALUES
        ('migrations', '001_database.sql'),
        ('migrations', '002_auth_and_roles.sql'),
        ('migrations', '003_institutions_courses_programs.sql'),
        ('migrations', '004_transcripts_and_evaluations.sql'),
        ('migrations', '005_views_and_procedures.sql'),
        ('migrations', '006_pages.sql'),
        ('migrations', '007_forms.sql'),
        ('migrations', '008_universities_institutions_agencies.sql'),
        ('migrations', '009_course_topics.sql'),
        ('migrations', '010_uploads.sql'),
        ('migrations', '011_program_sharing_and_topic_status.sql'),
        ('migrations', '012_student_registration_fields.sql'),
        ('migrations', '013_transfer_workflow_and_ai_controls.sql'),
        ('migrations', '014_partner_data_intake_and_workflow_automation.sql'),
        ('migrations', '015_bu_policy_alignment.sql'),
        ('migrations', '016_uploads_blob_storage.sql'),
        ('migrations', '017_equivalency_effective_dates.sql'),
        ('migrations', '018_profiles_email_verification_verification_requests.sql'),
        ('migrations', '019_student_intake.sql'),
        ('migrations', '020_document_intakes.sql'),
        ('migrations', '021_ai_rules_fallback.sql'),
        ('migrations', '022_transfer_exchange.sql'),
        ('migrations', '023_app_settings.sql'),
        ('migrations', '024_credit_deadline.sql'),
        ('seed', '001_reference_data.sql'),
        ('seed', '002_courses_and_equivalencies.sql'),
        ('seed', '003_demo_users.sql'),
        ('seed', '004_pages.sql'),
        ('seed', '005_forms.sql'),
        ('seed', '006_agencies_academicunits_programs.sql'),
        ('seed', '007_course_topics.sql'),
        ('seed', '008_roles_permissions.sql'),
        ('seed', '009_workflow_defaults.sql'),
        ('seed', '010_bu_policy_defaults.sql'),
        ('seed', '011_registration_form.sql'),
        ('seed', '012_student_profile_backfill.sql'),
        ('seed', '013_mock_source_profiles.sql'),
        ('seed', '014_document_skills.sql'),
        ('seed', '015_demo_maya_scenario.sql'),
        ('seed', '016_transfer_exchange.sql'),
        ('seed', '017_spread_students_across_universities.sql')
) v(k, f);
INSERT #chk (Section, Name, Sql, OnFail) VALUES
 ('ledger', 'no script has a failed LAST run in the ledger',
  'SELECT @ok = CASE WHEN OBJECT_ID(N''dbo.__ScriptRunnerHistory'', ''U'') IS NULL THEN NULL ELSE 1 END; IF @ok IS NOT NULL SELECT @detail = (SELECT STRING_AGG(h.ScriptName, N'', '') FROM dbo.__ScriptRunnerHistory h WHERE h.Id = (SELECT MAX(h2.Id) FROM dbo.__ScriptRunnerHistory h2 WHERE h2.ScriptName = h.ScriptName) AND h.Success = 0), @ok = CASE WHEN EXISTS (SELECT 1 FROM dbo.__ScriptRunnerHistory h WHERE h.Id = (SELECT MAX(h2.Id) FROM dbo.__ScriptRunnerHistory h2 WHERE h2.ScriptName = h.ScriptName) AND h.Success = 0) THEN 0 ELSE 1 END', 'FAIL');

-- 7. Execute every check; an error inside a check is reported as that check's failure, never aborts the run.
DECLARE @id INT, @sec VARCHAR(30), @name NVARCHAR(200), @sql NVARCHAR(MAX), @onfail VARCHAR(4);
DECLARE c CURSOR LOCAL FAST_FORWARD FOR SELECT Id, Section, Name, Sql, OnFail FROM #chk ORDER BY Id;
OPEN c;
FETCH NEXT FROM c INTO @id, @sec, @name, @sql, @onfail;
WHILE @@FETCH_STATUS = 0
BEGIN
    DECLARE @ok INT = NULL, @detail NVARCHAR(400) = NULL;
    BEGIN TRY
        EXEC sp_executesql @sql, N'@ok INT OUTPUT, @detail NVARCHAR(400) OUTPUT', @ok = @ok OUTPUT, @detail = @detail OUTPUT;
        INSERT #smoke (Section, Name, Result, Detail)
        VALUES (@sec, @name, CASE WHEN @ok IS NULL THEN 'SKIP' WHEN @ok = 1 THEN 'PASS' ELSE @onfail END, @detail);
    END TRY
    BEGIN CATCH
        INSERT #smoke (Section, Name, Result, Detail)
        VALUES (@sec, @name, @onfail, LEFT(CONCAT('error: ', ERROR_MESSAGE()), 400));
    END CATCH;
    FETCH NEXT FROM c INTO @id, @sec, @name, @sql, @onfail;
END
CLOSE c; DEALLOCATE c;

-- 8. Report -----------------------------------------------------------------------
SELECT Section, Name, Result, Detail
FROM #smoke
ORDER BY CASE Result WHEN 'FAIL' THEN 0 WHEN 'WARN' THEN 1 WHEN 'SKIP' THEN 2 ELSE 3 END, Id;

SELECT Result, COUNT(*) AS Checks FROM #smoke GROUP BY Result ORDER BY CASE Result WHEN 'FAIL' THEN 0 WHEN 'WARN' THEN 1 WHEN 'SKIP' THEN 2 ELSE 3 END;

-- Also PRINT the non-passing rows, for clients that only show messages (sqlcmd, some MCP tools).
DECLARE @line NVARCHAR(600);
DECLARE p CURSOR LOCAL FAST_FORWARD FOR
    SELECT CONCAT(Result, '  [', Section, '] ', Name, ISNULL(CONCAT('  - ', Detail), '')) FROM #smoke WHERE Result <> 'PASS'
    ORDER BY CASE Result WHEN 'FAIL' THEN 0 WHEN 'WARN' THEN 1 ELSE 2 END, Id;
OPEN p; FETCH NEXT FROM p INTO @line;
WHILE @@FETCH_STATUS = 0 BEGIN PRINT @line; FETCH NEXT FROM p INTO @line; END
CLOSE p; DEALLOCATE p;

DECLARE @fail INT = (SELECT COUNT(*) FROM #smoke WHERE Result = 'FAIL');
DECLARE @summary NVARCHAR(200) = CONCAT('smoke.sql: ', (SELECT COUNT(*) FROM #smoke WHERE Result = 'PASS'), ' PASS, ', @fail, ' FAIL, ',
    (SELECT COUNT(*) FROM #smoke WHERE Result = 'WARN'), ' WARN, ', (SELECT COUNT(*) FROM #smoke WHERE Result = 'SKIP'), ' SKIP');
PRINT @summary;
IF @fail > 0 THROW 50000, @summary, 1;   -- non-zero exit for sqlcmd -b / CI
