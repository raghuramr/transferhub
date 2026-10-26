import UserManagement from '../admin/UserManagement';

/** Super admins use the full user manager (create, edit, assign roles, scope) with per-role tabs. */
export default function UsersManagement() {
  return <UserManagement withRoleTabs />;
}
