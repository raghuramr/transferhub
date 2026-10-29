import assert from 'node:assert/strict';
import { PermissionsService } from '../src/permissions/permissions.service';

/** Custom role rules against a stubbed database: reserved keys, base-role grant copy, delete guards. */
function make(opts: { users?: number; system?: boolean } = {}) {
  const writes: string[] = [];
  const roleRow = { Id: 9, Name: 'registrar', DisplayName: 'Registrar', Description: null, BaseRole: 'faculty', IsSystem: !!opts.system, IsActive: true, Users: opts.users ?? 0 };
  const db: any = {
    query: async (text: string) => {
      writes.push(text);
      if (/SELECT 1 AS x FROM Roles WHERE Name/.test(text)) return { recordset: [] };
      if (/INSERT INTO Roles/.test(text)) return { recordset: [{ Id: 9 }] };
      if (/SELECT Id FROM Roles WHERE Name = @b/.test(text)) return { recordset: [{ Id: 3 }] };
      if (/FROM Roles r ORDER BY/.test(text)) return { recordset: [roleRow] };
      return { recordset: [], rowsAffected: [1] };
    },
  };
  const cache: any = { invalidate: () => writes.push('invalidate') };
  const schema: any = { has: async () => true };
  return { svc: new PermissionsService(db, cache, schema), writes };
}

(async () => {
  const by = { id: 'u', email: 'a@b', role: 'super_admin' };
  {
    const { svc, writes } = make();
    const r = await svc.createRole({ name: 'registrar', displayName: 'Registrar', baseRole: 'faculty' }, by);
    assert.equal(r?.id, 9);
    assert.ok(writes.some((w) => /INSERT INTO RolePermissions/.test(w)), 'copies the base role grants');
    assert.ok(writes.includes('invalidate'));
  }
  await assert.rejects(make().svc.createRole({ name: 'admin', displayName: 'X', baseRole: 'admin' }, by), /reserved/);
  await assert.rejects(make({ users: 2 }).svc.deleteRole(9, by), /still have this role/);
  await assert.rejects(make({ system: true }).svc.deleteRole(9, by), /Built-in/);
  { const { svc, writes } = make(); await svc.deleteRole(9, by); assert.ok(writes.some((w) => /DELETE FROM Roles/.test(w))); }
  const list = await make().svc.assignableRoles(false);
  assert.ok(list.every((r) => r.name !== 'super_admin'));
  console.log('custom roles OK');
})();
