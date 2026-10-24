-- ============================================================
-- Seed 008 – Roles & Permissions master data
-- ============================================================
-- Seeds PermissionModules, PermissionOperations, and a starting
-- RolePermissions grant set that MIRRORS the actual hardcoded
-- @Roles()/RolesGuard behaviour as a starting point the SuperAdmin can
-- adjust from the Roles & Permissions matrix screen. Unchanged from the
-- original seed/011_roles_permissions.sql (already idempotent via
-- MERGE ... WHEN NOT MATCHED).
-- ============================================================
USE TransferHubDB;
GO

-- ─── Permission Modules ──────────────────────────────────────
MERGE PermissionModules AS target
USING (VALUES
    ('courses',       'Course Database', 10),
    ('course_topics', 'Course Topics',   20),
    ('users',         'Users',           30),
    ('universities',  'Universities',    40),
    ('institutions',  'Institutions',    50),
    ('agencies',       'Agencies',       60),
    ('programs',       'Programs',       70),
    ('pages',          'Custom Pages',   80),
    ('forms',          'Custom Forms',   90),
    ('audit_log',      'Audit Log',      100),
    ('transcripts',    'Transcripts',    110),
    ('evaluations',    'Evaluations',    120)
) AS source ([Key], Label, SortOrder)
ON target.[Key] = source.[Key]
WHEN NOT MATCHED THEN
    INSERT ([Key], Label, SortOrder) VALUES (source.[Key], source.Label, source.SortOrder);
GO

-- ─── Permission Operations ───────────────────────────────────
MERGE PermissionOperations AS target
USING (VALUES
    ('view',        'View',         10),
    ('create',      'Create',       20),
    ('edit',        'Edit',         30),
    ('delete',      'Delete',       40),
    ('import',      'Import',       50),
    ('export',      'Export',       60),
    ('bulk_action', 'Bulk Actions', 70)
) AS source ([Key], Label, SortOrder)
ON target.[Key] = source.[Key]
WHEN NOT MATCHED THEN
    INSERT ([Key], Label, SortOrder) VALUES (source.[Key], source.Label, source.SortOrder);
GO

-- ─── Role Permissions ────────────────────────────────────────
-- Grant list expressed as (RoleName, ModuleKey, OperationKey) triples,
-- mirroring the current @Roles() decorators. Only granted combinations
-- are listed — anything not listed here defaults to "not allowed".
IF OBJECT_ID('tempdb..#Grants') IS NOT NULL DROP TABLE #Grants;
CREATE TABLE #Grants (RoleName VARCHAR(20), ModuleKey VARCHAR(50), OperationKey VARCHAR(50));

INSERT INTO #Grants (RoleName, ModuleKey, OperationKey) VALUES
-- courses: any authenticated role can browse/view; admin+super_admin manage
('student',     'courses', 'view'),
('faculty',     'courses', 'view'),
('admin',       'courses', 'view'),
('agency',      'courses', 'view'),
('super_admin', 'courses', 'view'),
('admin',       'courses', 'create'),
('super_admin', 'courses', 'create'),
('admin',       'courses', 'edit'),
('super_admin', 'courses', 'edit'),
('admin',       'courses', 'delete'),
('super_admin', 'courses', 'delete'),
('admin',       'courses', 'import'),
('super_admin', 'courses', 'import'),
('admin',       'courses', 'export'),
('super_admin', 'courses', 'export'),
('admin',       'courses', 'bulk_action'),
('super_admin', 'courses', 'bulk_action'),

-- course_topics: everyone can view (read-only); super_admin/admin/faculty edit
('student',     'course_topics', 'view'),
('faculty',     'course_topics', 'view'),
('admin',       'course_topics', 'view'),
('agency',      'course_topics', 'view'),
('super_admin', 'course_topics', 'view'),
('faculty',     'course_topics', 'create'),
('admin',       'course_topics', 'create'),
('super_admin', 'course_topics', 'create'),
('faculty',     'course_topics', 'edit'),
('admin',       'course_topics', 'edit'),
('super_admin', 'course_topics', 'edit'),
('faculty',     'course_topics', 'delete'),
('admin',       'course_topics', 'delete'),
('super_admin', 'course_topics', 'delete'),

-- users: admin/super_admin manage; delete/create/import are super_admin-only
('admin',       'users', 'view'),
('super_admin', 'users', 'view'),
('super_admin', 'users', 'create'),
('admin',       'users', 'edit'),
('super_admin', 'users', 'edit'),
('super_admin', 'users', 'delete'),
('super_admin', 'users', 'import'),
('admin',       'users', 'export'),
('super_admin', 'users', 'export'),

-- universities / institutions / agencies: admin+super_admin only, full CRUD
('admin',       'universities', 'view'),
('super_admin', 'universities', 'view'),
('admin',       'universities', 'create'),
('super_admin', 'universities', 'create'),
('admin',       'universities', 'edit'),
('super_admin', 'universities', 'edit'),
('admin',       'universities', 'delete'),
('super_admin', 'universities', 'delete'),
('admin',       'universities', 'import'),
('super_admin', 'universities', 'import'),
('admin',       'universities', 'export'),
('super_admin', 'universities', 'export'),
('admin',       'universities', 'bulk_action'),
('super_admin', 'universities', 'bulk_action'),

('admin',       'institutions', 'view'),
('super_admin', 'institutions', 'view'),
('admin',       'institutions', 'create'),
('super_admin', 'institutions', 'create'),
('admin',       'institutions', 'edit'),
('super_admin', 'institutions', 'edit'),
('admin',       'institutions', 'delete'),
('super_admin', 'institutions', 'delete'),
('admin',       'institutions', 'import'),
('super_admin', 'institutions', 'import'),
('admin',       'institutions', 'export'),
('super_admin', 'institutions', 'export'),
('admin',       'institutions', 'bulk_action'),
('super_admin', 'institutions', 'bulk_action'),

('admin',       'agencies', 'view'),
('super_admin', 'agencies', 'view'),
('admin',       'agencies', 'create'),
('super_admin', 'agencies', 'create'),
('admin',       'agencies', 'edit'),
('super_admin', 'agencies', 'edit'),
('admin',       'agencies', 'delete'),
('super_admin', 'agencies', 'delete'),
('admin',       'agencies', 'import'),
('super_admin', 'agencies', 'import'),
('admin',       'agencies', 'export'),
('super_admin', 'agencies', 'export'),
('admin',       'agencies', 'bulk_action'),
('super_admin', 'agencies', 'bulk_action'),

-- programs: viewable by anyone; managed by admin/super_admin (no dedicated
-- endpoints today beyond listing — grants recorded for when they're added)
('student',     'programs', 'view'),
('faculty',     'programs', 'view'),
('admin',       'programs', 'view'),
('agency',      'programs', 'view'),
('super_admin', 'programs', 'view'),
('admin',       'programs', 'create'),
('super_admin', 'programs', 'create'),
('admin',       'programs', 'edit'),
('super_admin', 'programs', 'edit'),
('admin',       'programs', 'delete'),
('super_admin', 'programs', 'delete'),

-- pages: any signed-in role can view; admin/super_admin edit; delete is
-- super_admin-only
('student',     'pages', 'view'),
('faculty',     'pages', 'view'),
('admin',       'pages', 'view'),
('agency',      'pages', 'view'),
('super_admin', 'pages', 'view'),
('admin',       'pages', 'create'),
('super_admin', 'pages', 'create'),
('admin',       'pages', 'edit'),
('super_admin', 'pages', 'edit'),
('super_admin', 'pages', 'delete'),

-- forms: any signed-in role can view/list; admin/super_admin edit; delete
-- is super_admin-only
('student',     'forms', 'view'),
('faculty',     'forms', 'view'),
('admin',       'forms', 'view'),
('agency',      'forms', 'view'),
('super_admin', 'forms', 'view'),
('admin',       'forms', 'create'),
('super_admin', 'forms', 'create'),
('admin',       'forms', 'edit'),
('super_admin', 'forms', 'edit'),
('super_admin', 'forms', 'delete'),

-- audit_log: super_admin only
('super_admin', 'audit_log', 'view'),

-- transcripts: students/agencies submit and see their own, staff see all;
-- status changes are faculty/admin/super_admin
('student',     'transcripts', 'view'),
('faculty',     'transcripts', 'view'),
('admin',       'transcripts', 'view'),
('agency',      'transcripts', 'view'),
('super_admin', 'transcripts', 'view'),
('student',     'transcripts', 'create'),
('agency',      'transcripts', 'create'),
('admin',       'transcripts', 'create'),
('super_admin', 'transcripts', 'create'),
('faculty',     'transcripts', 'edit'),
('admin',       'transcripts', 'edit'),
('super_admin', 'transcripts', 'edit'),

-- evaluations: faculty/admin/super_admin only; assign/post restricted further
('faculty',     'evaluations', 'view'),
('admin',       'evaluations', 'view'),
('super_admin', 'evaluations', 'view'),
('faculty',     'evaluations', 'edit'),
('admin',       'evaluations', 'edit'),
('super_admin', 'evaluations', 'edit'),
('admin',       'evaluations', 'bulk_action'),
('super_admin', 'evaluations', 'bulk_action');

MERGE RolePermissions AS target
USING (
    SELECT r.Id AS RoleId, m.Id AS ModuleId, o.Id AS OperationId
    FROM #Grants g
    JOIN Roles r ON r.Name = g.RoleName
    JOIN PermissionModules m ON m.[Key] = g.ModuleKey
    JOIN PermissionOperations o ON o.[Key] = g.OperationKey
) AS source (RoleId, ModuleId, OperationId)
ON target.RoleId = source.RoleId AND target.ModuleId = source.ModuleId AND target.OperationId = source.OperationId
WHEN NOT MATCHED THEN
    INSERT (RoleId, ModuleId, OperationId, IsAllowed) VALUES (source.RoleId, source.ModuleId, source.OperationId, 1);
GO

DROP TABLE #Grants;
GO
