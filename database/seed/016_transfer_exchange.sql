-- ============================================================
-- Seed 016 - Transfer exchange: permission module + grants (idempotent)
-- Requires migration 022 and seed 008/009 (modules, operations, roles).
-- ============================================================
USE TransferHubDB;
GO

MERGE PermissionModules AS target
USING (VALUES ('transfers', 'Transfers (incoming / outgoing)', 180)) AS source ([Key], Label, SortOrder)
ON target.[Key] = source.[Key]
WHEN NOT MATCHED THEN INSERT ([Key], Label, SortOrder) VALUES (source.[Key], source.Label, source.SortOrder);
GO

IF OBJECT_ID('tempdb..#ExGrants') IS NOT NULL DROP TABLE #ExGrants;
CREATE TABLE #ExGrants (RoleName VARCHAR(20), ModuleKey VARCHAR(50), OperationKey VARCHAR(50));
INSERT INTO #ExGrants VALUES
-- view = the Transfers page and its summary / lists
('faculty', 'transfers', 'view'), ('admin', 'transfers', 'view'), ('super_admin', 'transfers', 'view'),
-- create = ask another party for a document, upload for a transfer, send a reminder
('faculty', 'transfers', 'create'), ('admin', 'transfers', 'create'), ('super_admin', 'transfers', 'create'),
-- edit = cancel / decline / fulfil a document request
('faculty', 'transfers', 'edit'), ('admin', 'transfers', 'edit'), ('super_admin', 'transfers', 'edit');

MERGE RolePermissions AS target
USING (
    SELECT r.Id AS RoleId, m.Id AS ModuleId, o.Id AS OperationId
    FROM #ExGrants g
    JOIN Roles r                ON r.Name = g.RoleName
    JOIN PermissionModules m    ON m.[Key] = g.ModuleKey
    JOIN PermissionOperations o ON o.[Key] = g.OperationKey
) AS source (RoleId, ModuleId, OperationId)
ON target.RoleId = source.RoleId AND target.ModuleId = source.ModuleId AND target.OperationId = source.OperationId
WHEN NOT MATCHED THEN
    INSERT (RoleId, ModuleId, OperationId, IsAllowed) VALUES (source.RoleId, source.ModuleId, source.OperationId, 1);

DROP TABLE #ExGrants;
GO
