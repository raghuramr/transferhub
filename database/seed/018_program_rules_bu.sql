-- ============================================================
-- Seed 018 - BU programme rules from the workbook (PRG-03..08; migration 027)
-- ============================================================
-- Programmes are matched by name against the BU rows seeded in 006 (INNER JOIN: a rule whose programme is not
-- there yet is skipped, never widened to "all programmes"). Re-runnable: a rule is inserted only when the same
-- (university, RuleCode, type, pattern, substitute-for, programme) is not already there.
-- Course codes are written without the college prefix ('CS 320'); the engine matches 'CAS CS 320' flexibly.
-- ============================================================
USE TransferHubDB;
GO

DECLARE @bu INT = (SELECT TOP 1 Id FROM Institutions WHERE Code = 'BU');
IF @bu IS NULL
BEGIN
    PRINT 'Seed 018 skipped: no BU institution found (run seed 001 first).';
END
ELSE
BEGIN
    DECLARE @before INT = (SELECT COUNT(*) FROM ProgramRules WHERE InstitutionId = @bu);

    INSERT INTO ProgramRules (InstitutionId, ProgramId, RuleCode, RuleType, LevelMin, MaxCount, MinCount, CourseCodePattern, SubstituteFor, ParamsJson, Description)
    SELECT @bu, p.Id, v.RuleCode, v.RuleType, v.LevelMin, v.MaxCount, v.MinCount, v.Pattern, v.SubFor, v.ParamsJson, v.Descr
    FROM (VALUES
      ('PRG-03','BA in Computer Science','required_at_home',NULL,NULL,NULL,'CS 320|CS 332|CS 350',NULL,NULL,
         N'CS BA Group C courses (CS 320, CS 332, CS 350) must be taken at BU; transfer cannot satisfy them even if a similar course exists.'),
      ('PRG-04','BA in Economics','max_transfer_at_level',200,4,NULL,NULL,NULL,'{"afterMatriculation":true}',
         N'Economics BA: at most 4 courses at 200+ level may be transferred after matriculation.'),
      ('PRG-05','BA in Biology','min_at_home',NULL,NULL,5,'BI',NULL,'{"excludeCodes":["BI 107","BI 108"]}',
         N'Biology BA: at least 5 BI courses beyond BI 107/108 must be taken at BU.'),
      ('PRG-06','BA in Psychology','residency_courses_count',NULL,NULL,10,'PS',NULL,'{"requiredCodes":["PS 101"],"principalCourses":9}',
         N'Psychology BA: PS 101 plus 9 principal courses (10 PS courses counted toward the major).'),
      ('PRG-06','BA in Psychology','required_at_home',NULL,NULL,NULL,'PS 231',NULL,'{"enforcement":"info"}',
         N'Psychology BA: PS 231 is a required course.'),
      ('PRG-06','BA in Psychology','not_principal',NULL,NULL,NULL,'PS 211',NULL,NULL,
         N'Psychology BA: PS 211 is not a principal course.'),
      ('PRG-07','BA in Mathematics','required_at_home',NULL,NULL,NULL,'MA 123|MA 124|MA 225|MA 242',NULL,'{"enforcement":"info"}',
         N'Mathematics BA: calculus sequence MA 123, MA 124, MA 225 plus MA 242.'),
      ('PRG-08','BA in Computer Science','substitution',NULL,NULL,NULL,'CS 132','MA 242','{"bidirectional":true}',
         N'MA 242 and CS 132 may substitute for each other.'),
      ('PRG-08','BA in Computer Science','substitution',NULL,NULL,NULL,'CS 235','MA 294','{"bidirectional":true}',
         N'MA 294 and CS 235 may substitute for each other.'),
      ('PRG-08','BA in Computer Science','substitution',NULL,NULL,NULL,'CS 237','MA 581','{"bidirectional":true}',
         N'MA 581 and CS 237 may substitute for each other.'),
      ('PRG-08','BA in Economics','substitution',NULL,NULL,NULL,'MA 115|MA 213|QM 221','EC 203',NULL,
         N'EC 203 may be satisfied by MA 115, MA 213 or QST QM 221.'),
      ('PRG-08','BA in Psychology','substitution',NULL,NULL,NULL,'MA 115|MA 116','PS 211','{"allOf":true}',
         N'PS 211 may be satisfied by MA 115 together with MA 116.')
    ) AS v (RuleCode, ProgName, RuleType, LevelMin, MaxCount, MinCount, Pattern, SubFor, ParamsJson, Descr)
    JOIN Programs p ON p.InstitutionId = @bu AND p.Name = v.ProgName
    WHERE NOT EXISTS (
        SELECT 1 FROM ProgramRules r
        WHERE r.InstitutionId = @bu AND r.ProgramId = p.Id AND r.RuleCode = v.RuleCode AND r.RuleType = v.RuleType
          AND ISNULL(r.CourseCodePattern, N'') = ISNULL(v.Pattern, N'') AND ISNULL(r.SubstituteFor, N'') = ISNULL(v.SubFor, N'')
    );

    PRINT CONCAT('Seed 018: ', (SELECT COUNT(*) FROM ProgramRules WHERE InstitutionId = @bu) - @before, ' programme rule(s) added for BU.');
END
GO
