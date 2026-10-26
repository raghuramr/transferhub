import { Avatar } from '../shared/Avatar';
import { Users, GraduationCap, BookOpen, UserCheck, Handshake, ShieldCheck } from 'lucide-react';
import { DataTable, type DataTableColumn } from '../ui/DataTable';

export interface UserRow {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  isActive: boolean;
  isLocked?: boolean;
  hasAvatar?: boolean;
  emailVerified?: boolean;
  status?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  country?: string;
  countryOfOrigin?: string;
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

export function NameCell({ r }: { r: Pick<UserRow, 'id' | 'firstName' | 'lastName'> & { hasAvatar?: boolean } }) {
  return (
    <span className="flex items-center gap-2.5">
      <Avatar userId={r.id} firstName={r.firstName} lastName={r.lastName} hasPhoto={r.hasAvatar} size="sm" />
      <span className="font-medium text-gray-900">{r.firstName} {r.lastName}</span>
    </span>
  );
}

export const roleColors: Record<string, string> = {
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

export type RoleTab = { key: string | null; label: string; icon: React.ReactNode };

export const roleTabs: RoleTab[] = [
  { key: null, label: 'All Users', icon: <Users size={16} /> },
  { key: 'student', label: 'Students', icon: <GraduationCap size={16} /> },
  { key: 'faculty', label: 'Faculty', icon: <BookOpen size={16} /> },
  { key: 'admin', label: 'Admins', icon: <UserCheck size={16} /> },
  { key: 'agency', label: 'Agencies', icon: <Handshake size={16} /> },
  { key: 'super_admin', label: 'Super Admins', icon: <ShieldCheck size={16} /> },
];

const allColumns: DataTableColumn<UserRow>[] = [
  { key: 'firstName', header: 'Name', render: (r) => <NameCell r={r} /> },
  { key: 'email', header: 'Email' },
  { key: 'role', header: 'Role', render: (r) => <RoleBadge role={r.role} /> },
  { key: 'isActive', header: 'Status', render: (r) => <StatusBadge isActive={r.isActive} /> },
  { key: 'mobile', header: 'Mobile', render: (r) => r.mobile ?? '—' },
];

const studentColumns: DataTableColumn<UserRow>[] = [
  { key: 'firstName', header: 'Name', render: (r) => <NameCell r={r} /> },
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
  { key: 'firstName', header: 'Name', render: (r) => <NameCell r={r} /> },
  { key: 'email', header: 'Email' },
  { key: 'departmentName', header: 'Department', render: (r) => r.departmentName ?? '—' },
  { key: 'mobile', header: 'Mobile', render: (r) => r.mobile ?? '—' },
  { key: 'isActive', header: 'Status', render: (r) => <StatusBadge isActive={r.isActive} /> },
];

const agencyColumns: DataTableColumn<UserRow>[] = [
  { key: 'firstName', header: 'Name', render: (r) => <NameCell r={r} /> },
  { key: 'email', header: 'Email' },
  { key: 'agencyName', header: 'Agency', render: (r) => r.agencyName ?? '—' },
  { key: 'mobile', header: 'Mobile', render: (r) => r.mobile ?? '—' },
  { key: 'isActive', header: 'Status', render: (r) => <StatusBadge isActive={r.isActive} /> },
];

const adminColumns: DataTableColumn<UserRow>[] = [
  { key: 'firstName', header: 'Name', render: (r) => <NameCell r={r} /> },
  { key: 'email', header: 'Email' },
  { key: 'mobile', header: 'Mobile', render: (r) => r.mobile ?? '—' },
  { key: 'isActive', header: 'Status', render: (r) => <StatusBadge isActive={r.isActive} /> },
  { key: 'isLocked', header: 'Locked', render: (r) => r.isLocked ? <span className="text-red-600 text-xs font-medium">Locked</span> : '—' },
];

export function getColumnsForRole(role: string | null): DataTableColumn<UserRow>[] {
  if (role === 'student') return studentColumns;
  if (role === 'faculty') return facultyColumns;
  if (role === 'agency') return agencyColumns;
  if (role === 'admin' || role === 'super_admin') return adminColumns;
  return allColumns;
}

