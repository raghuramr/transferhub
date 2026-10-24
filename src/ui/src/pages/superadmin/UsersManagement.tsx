import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { usersApi } from '../../lib/api';
import { Users, GraduationCap, BookOpen, UserCheck, Handshake, ShieldCheck } from 'lucide-react';
import { DataTable, type DataTableColumn } from '../../components/ui/DataTable';

interface UserRow {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  isActive: boolean;
  isLocked?: boolean;
  mobile?: string;
  departmentName?: string;
  agencyName?: string;
  studentId?: string;
  // StudentProfiles fields (only for students)
  priorInstitutionName?: string;
  targetInstitutionName?: string;
  targetProgramName?: string;
  gpa?: number;
  highestEducationLevel?: string;
  fieldOfStudy?: string;
  graduationYear?: number;
}

const roleColors: Record<string, string> = {
  student:     'bg-blue-100 text-blue-700',
  faculty:     'bg-purple-100 text-purple-700',
  admin:       'bg-amber-100 text-amber-700',
  agency:      'bg-teal-100 text-teal-700',
  super_admin: 'bg-red-100 text-red-700',
};

function StatusBadge({ isActive }: { isActive: boolean }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
      isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
    }`}>
      {isActive ? 'Active' : 'Inactive'}
    </span>
  );
}

function RoleBadge({ role }: { role: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${roleColors[role] ?? 'bg-gray-100 text-gray-600'}`}>
      {role.replace('_', ' ')}
    </span>
  );
}

type RoleTab = { key: string | null; label: string; icon: React.ReactNode };

const roleTabs: RoleTab[] = [
  { key: null, label: 'All Users', icon: <Users size={16} /> },
  { key: 'student', label: 'Students', icon: <GraduationCap size={16} /> },
  { key: 'faculty', label: 'Faculty', icon: <BookOpen size={16} /> },
  { key: 'admin', label: 'Admins', icon: <UserCheck size={16} /> },
  { key: 'agency', label: 'Agencies', icon: <Handshake size={16} /> },
  { key: 'super_admin', label: 'Super Admins', icon: <ShieldCheck size={16} /> },
];

const allColumns: DataTableColumn<UserRow>[] = [
  { key: 'firstName', header: 'Name', render: (r) => `${r.firstName} ${r.lastName}` },
  { key: 'email', header: 'Email' },
  { key: 'role', header: 'Role', render: (r) => <RoleBadge role={r.role} /> },
  { key: 'isActive', header: 'Status', render: (r) => <StatusBadge isActive={r.isActive} /> },
  { key: 'mobile', header: 'Mobile', render: (r) => r.mobile ?? '—' },
];

const studentColumns: DataTableColumn<UserRow>[] = [
  { key: 'firstName', header: 'Name', render: (r) => `${r.firstName} ${r.lastName}` },
  { key: 'email', header: 'Email' },
  { key: 'studentId', header: 'Student ID', render: (r) => r.studentId ?? '—' },
  { key: 'priorInstitutionName', header: 'Prior Institution', render: (r) => r.priorInstitutionName ?? '—' },
  { key: 'targetInstitutionName', header: 'Target University', render: (r) => r.targetInstitutionName ?? '—' },
  { key: 'targetProgramName', header: 'Target Program', render: (r) => r.targetProgramName ?? '—' },
  { key: 'gpa', header: 'GPA', render: (r) => r.gpa != null ? r.gpa.toFixed(2) : '—' },
  { key: 'highestEducationLevel', header: 'Education Level', render: (r) => r.highestEducationLevel ?? '—' },
  { key: 'isActive', header: 'Status', render: (r) => <StatusBadge isActive={r.isActive} /> },
];

const facultyColumns: DataTableColumn<UserRow>[] = [
  { key: 'firstName', header: 'Name', render: (r) => `${r.firstName} ${r.lastName}` },
  { key: 'email', header: 'Email' },
  { key: 'departmentName', header: 'Department', render: (r) => r.departmentName ?? '—' },
  { key: 'mobile', header: 'Mobile', render: (r) => r.mobile ?? '—' },
  { key: 'isActive', header: 'Status', render: (r) => <StatusBadge isActive={r.isActive} /> },
];

const agencyColumns: DataTableColumn<UserRow>[] = [
  { key: 'firstName', header: 'Name', render: (r) => `${r.firstName} ${r.lastName}` },
  { key: 'email', header: 'Email' },
  { key: 'agencyName', header: 'Agency', render: (r) => r.agencyName ?? '—' },
  { key: 'mobile', header: 'Mobile', render: (r) => r.mobile ?? '—' },
  { key: 'isActive', header: 'Status', render: (r) => <StatusBadge isActive={r.isActive} /> },
];

const adminColumns: DataTableColumn<UserRow>[] = [
  { key: 'firstName', header: 'Name', render: (r) => `${r.firstName} ${r.lastName}` },
  { key: 'email', header: 'Email' },
  { key: 'mobile', header: 'Mobile', render: (r) => r.mobile ?? '—' },
  { key: 'isActive', header: 'Status', render: (r) => <StatusBadge isActive={r.isActive} /> },
  { key: 'isLocked', header: 'Locked', render: (r) => r.isLocked ? <span className="text-red-600 text-xs font-medium">Locked</span> : '—' },
];

function getColumnsForRole(role: string | null): DataTableColumn<UserRow>[] {
  if (role === 'student') return studentColumns;
  if (role === 'faculty') return facultyColumns;
  if (role === 'agency') return agencyColumns;
  if (role === 'admin' || role === 'super_admin') return adminColumns;
  return allColumns;
}

export default function UsersManagement() {
  const [activeRole, setActiveRole] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['users-all', activeRole],
    queryFn: () => usersApi.list(activeRole ? { role: activeRole } : {}),
    staleTime: 30_000,
  });

  const users = (data?.data ?? []) as UserRow[];
  const columns = getColumnsForRole(activeRole);

  return (
    <div className="w-[95%] mx-auto p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <Users className="text-brand-800" size={24} />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Users</h1>
            <p className="text-gray-500 text-sm">Manage all user accounts across roles</p>
          </div>
        </div>
      </div>

      {/* Role tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg mb-6 flex-wrap">
        {roleTabs.map((tab) => {
          const count = tab.key === null
            ? (data?.data as UserRow[] | undefined)?.length
            : (data?.data as UserRow[] | undefined)?.filter((u: UserRow) => u.role === tab.key).length;
          return (
            <button
              key={String(tab.key)}
              onClick={() => setActiveRole(tab.key)}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                activeRole === tab.key
                  ? 'bg-white shadow text-brand-800'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {tab.icon}
              {tab.label}
              {count != null && activeRole !== tab.key && (
                <span className="bg-gray-200 text-gray-600 text-xs rounded-full px-1.5 py-0.5 leading-none">
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <DataTable<UserRow>
        columns={columns}
        rows={users}
        isLoading={isLoading}
        emptyMessage={`No ${activeRole ? activeRole.replace('_', ' ') : ''} users found.`}
        searchKeys={['firstName', 'lastName', 'email']}
        showExport={false}
      />
    </div>
  );
}
