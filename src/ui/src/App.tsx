import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/auth';
import type { Role } from './types';

// Auth
import LoginPage from './pages/auth/LoginPage';
import ChangePasswordPage from './pages/auth/ChangePasswordPage';

// Layout
import AppLayout from './components/layout/AppLayout';

// Student pages
import StudentDashboard from './pages/student/StudentDashboard';
import TranscriptStatus from './pages/student/TranscriptStatus';
import UploadTranscript from './pages/student/UploadTranscript';

// Faculty pages
import FacultyQueue from './pages/faculty/FacultyQueue';
import EvaluationWorkbench from './pages/faculty/EvaluationWorkbench';

// Admin pages
import AdminDashboard from './pages/admin/AdminDashboard';
import TranscriptList from './pages/admin/TranscriptList';
import CourseDatabase from './pages/admin/CourseDatabase';
import UserManagement from './pages/admin/UserManagement';

// Super Admin pages
import SuperAdminDashboard from './pages/superadmin/SuperAdminDashboard';
import AuditLog from './pages/superadmin/AuditLog';
import SystemSettings from './pages/superadmin/SystemSettings';

// Guards
function RequireAuth({ children, roles }: { children: React.ReactElement; roles?: Role[] }) {
  const { isAuthenticated, user } = useAuthStore();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (user?.mustChangePass) return <Navigate to="/change-password" replace />;
  if (roles && user && !roles.includes(user.role)) return <Navigate to="/unauthorized" replace />;
  return children;
}

function RoleRedirect() {
  const { user } = useAuthStore();
  if (!user) return <Navigate to="/login" replace />;
  const map: Record<Role, string> = {
    student: '/student',
    faculty: '/faculty',
    admin: '/admin',
    agency: '/student', // agency sees the same submit flow as student
    super_admin: '/superadmin',
  };
  return <Navigate to={map[user.role] ?? '/login'} replace />;
}

export default function App() {
  const { initFromStorage } = useAuthStore();
  useEffect(() => { initFromStorage(); }, [initFromStorage]);

  return (
    <BrowserRouter>
      <Routes>
        {/* Public */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/change-password" element={<ChangePasswordPage />} />
        <Route path="/unauthorized" element={<div className="p-8 text-center text-red-600 text-xl">Not authorised</div>} />

        {/* Root → role-based redirect */}
        <Route path="/" element={<RequireAuth><RoleRedirect /></RequireAuth>} />

        {/* Student & Agency */}
        <Route path="/student" element={<RequireAuth roles={['student','agency']}><AppLayout /></RequireAuth>}>
          <Route index element={<StudentDashboard />} />
          <Route path="upload" element={<UploadTranscript />} />
          <Route path="transcript/:id" element={<TranscriptStatus />} />
        </Route>

        {/* Faculty */}
        <Route path="/faculty" element={<RequireAuth roles={['faculty']}><AppLayout /></RequireAuth>}>
          <Route index element={<FacultyQueue />} />
          <Route path="evaluation/:id" element={<EvaluationWorkbench />} />
        </Route>

        {/* Admin */}
        <Route path="/admin" element={<RequireAuth roles={['admin','super_admin']}><AppLayout /></RequireAuth>}>
          <Route index element={<AdminDashboard />} />
          <Route path="transcripts" element={<TranscriptList />} />
          <Route path="courses" element={<CourseDatabase />} />
          <Route path="users" element={<UserManagement />} />
        </Route>

        {/* Super Admin */}
        <Route path="/superadmin" element={<RequireAuth roles={['super_admin']}><AppLayout /></RequireAuth>}>
          <Route index element={<SuperAdminDashboard />} />
          <Route path="audit" element={<AuditLog />} />
          <Route path="settings" element={<SystemSettings />} />
          <Route path="users" element={<UserManagement />} />
        </Route>

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
