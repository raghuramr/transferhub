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
import PagesList from './pages/admin/PagesList';
import PageEditor from './pages/admin/PageEditor';
import FormsList from './pages/admin/FormsList';
import FormEditor from './pages/admin/FormEditor';
import FormSubmissions from './pages/admin/FormSubmissions';

// Super Admin pages
import SuperAdminDashboard from './pages/superadmin/SuperAdminDashboard';
import AuditLog from './pages/superadmin/AuditLog';
import SystemSettings from './pages/superadmin/SystemSettings';

// Custom Pages (CMS) — public-facing view, any authenticated role
import CmsPageView from './pages/cms/CmsPageView';

// Custom Forms — fill-out view, any authenticated role
import FormFillView from './pages/forms/FormFillView';

// Public landing / hero page
import HomePage from './pages/public/HomePage';

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

/** Signed-in users are sent to their dashboard; anonymous visitors see the public landing page. */
function RootRoute() {
  const { isAuthenticated } = useAuthStore();
  return isAuthenticated ? <RoleRedirect /> : <HomePage />;
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

        {/* Root → public landing page, or role-based redirect if already signed in */}
        <Route path="/" element={<RootRoute />} />

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
          <Route path="pages" element={<PagesList />} />
          <Route path="pages/new" element={<PageEditor />} />
          <Route path="pages/:id" element={<PageEditor />} />
          <Route path="forms" element={<FormsList />} />
          <Route path="forms/new" element={<FormEditor />} />
          <Route path="forms/:id" element={<FormEditor />} />
          <Route path="forms/:id/submissions" element={<FormSubmissions />} />
        </Route>

        {/* Super Admin */}
        <Route path="/superadmin" element={<RequireAuth roles={['super_admin']}><AppLayout /></RequireAuth>}>
          <Route index element={<SuperAdminDashboard />} />
          <Route path="audit" element={<AuditLog />} />
          <Route path="settings" element={<SystemSettings />} />
          <Route path="users" element={<UserManagement />} />
        </Route>

        {/* Shared CMS page view (any authenticated role) */}
        <Route path="/pages/:slug" element={<RequireAuth><AppLayout /></RequireAuth>}>
          <Route index element={<CmsPageView />} />
        </Route>

        {/* Shared form fill-out view (any authenticated role) */}
        <Route path="/forms/:slug" element={<RequireAuth><AppLayout /></RequireAuth>}>
          <Route index element={<FormFillView />} />
        </Route>

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
