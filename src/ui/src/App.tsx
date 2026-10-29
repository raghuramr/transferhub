import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/auth';
import type { Role } from './types';

// Auth
import LoginPage from './pages/auth/LoginPage';
import RegisterPage from './pages/auth/RegisterPage';
import ChangePasswordPage from './pages/auth/ChangePasswordPage';

// Layout
import AppLayout from './components/layout/AppLayout';

// Student pages
import StudentDashboard from './pages/student/StudentDashboard';
import TranscriptStatus from './pages/student/TranscriptStatus';
import SmartUpload from './pages/student/SmartUpload';
import Explore from './pages/student/Explore';
import UploadTranscript from './pages/student/UploadTranscript';

// Faculty pages
import FacultyQueue from './pages/faculty/FacultyQueue';
import FacultyDashboard from './pages/faculty/FacultyDashboard';
import VerificationRequests from './pages/faculty/VerificationRequests';
import EvaluationWorkbench from './pages/faculty/EvaluationWorkbench';

// Agency pages
import AgencyDashboard from './pages/agency/AgencyDashboard';

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
import DemoScenario from './pages/superadmin/DemoScenario';
import DemoDocuments from './pages/superadmin/DemoDocuments';
import UniversitiesManagement from './pages/superadmin/UniversitiesManagement';
import InstitutionsManagement from './pages/superadmin/InstitutionsManagement';
import IntakeLookup from './pages/public/IntakeLookup';
import IntakeClaim from './pages/public/IntakeClaim';
import IntakeAdmin from './pages/admin/IntakeAdmin';
import VerifyEmailPage from './pages/auth/VerifyEmailPage';
import ProgramsManagement from './pages/superadmin/ProgramsManagement';
import EquivalenciesManagement from './pages/admin/EquivalenciesManagement';
import AgenciesManagement from './pages/superadmin/AgenciesManagement';
import RolesPermissions from './pages/superadmin/RolesPermissions';
import DataImport from './pages/superadmin/DataImport';
import UsersManagement from './pages/superadmin/UsersManagement';
import WorkflowDesigner from './pages/superadmin/WorkflowDesigner';
import AiControls from './pages/superadmin/AiControls';

// Approval workflow (staff)
import RequestsQueue from './pages/staff/RequestsQueue';
import RequestReview from './pages/staff/RequestReview';
import AppealsQueue from './pages/staff/AppealsQueue';
import Transfers from './pages/staff/Transfers';
import TransferDetail from './pages/staff/TransferDetail';

// Custom Pages (CMS) — public-facing view, any authenticated role
import CmsPageView from './pages/cms/CmsPageView';

// Custom Forms — fill-out view, any authenticated role
import FormFillView from './pages/forms/FormFillView';

// Own-profile editor — any authenticated role
import ProfilePage from './pages/ProfilePage';

// Public landing / hero page
import HomePage from './pages/public/HomePage';
import PublicPageShell from './pages/public/PublicPageShell';
import PartnerPortal from './pages/public/PartnerPortal';

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
    agency: '/agency',
    super_admin: '/superadmin',
  };
  return <Navigate to={map[user.role] ?? '/login'} replace />;
}

/** Published Custom Pages need no login; signed-in users still see them inside the app. */
function PageLayout() {
  const { isAuthenticated, user } = useAuthStore();
  if (isAuthenticated && user?.mustChangePass) return <Navigate to="/change-password" replace />;
  return isAuthenticated ? <AppLayout /> : <PublicPageShell />;
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
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/verify-email" element={<VerifyEmailPage />} />
        <Route path="/intake" element={<IntakeLookup />} />
        <Route path="/intake/claim" element={<IntakeClaim />} />
        <Route path="/partner" element={<PartnerPortal />} />
        <Route path="/change-password" element={<ChangePasswordPage />} />
        <Route path="/unauthorized" element={<div className="p-8 text-center text-red-600 text-xl">Not authorised</div>} />

        {/* Root → public landing page, or role-based redirect if already signed in */}
        <Route path="/" element={<RootRoute />} />

        {/* Student */}
        <Route path="/student" element={<RequireAuth roles={['student']}><AppLayout /></RequireAuth>}>
          <Route index element={<StudentDashboard />} />
          <Route path="upload" element={<UploadTranscript />} />
          <Route path="documents" element={<SmartUpload />} />
          <Route path="explore" element={<Explore />} />
          <Route path="transcript/:id" element={<TranscriptStatus />} />
        </Route>

        {/* Agency — submits on behalf of students, has its own dashboard */}
        <Route path="/agency" element={<RequireAuth roles={['agency']}><AppLayout /></RequireAuth>}>
          <Route index element={<AgencyDashboard />} />
          <Route path="upload" element={<UploadTranscript />} />
          <Route path="transcript/:id" element={<TranscriptStatus />} />
        </Route>

        {/* Faculty */}
        <Route path="/faculty" element={<RequireAuth roles={['faculty']}><AppLayout /></RequireAuth>}>
          <Route index element={<FacultyDashboard />} />
          <Route path="queue" element={<FacultyQueue />} />
          <Route path="verification" element={<VerificationRequests />} />
          <Route path="evaluation/:id" element={<EvaluationWorkbench />} />
        </Route>

        {/* Admin */}
        <Route path="/admin" element={<RequireAuth roles={['admin','super_admin']}><AppLayout /></RequireAuth>}>
          <Route index element={<AdminDashboard />} />
          <Route path="transcripts" element={<TranscriptList />} />
          <Route path="evaluation/:id" element={<EvaluationWorkbench />} />
          <Route path="courses" element={<CourseDatabase />} />
          <Route path="equivalencies" element={<EquivalenciesManagement />} />
          <Route path="verification" element={<VerificationRequests />} />
          <Route path="intake" element={<IntakeAdmin />} />
          <Route path="users" element={<UserManagement />} />
          <Route path="pages" element={<PagesList />} />
          <Route path="pages/new" element={<PageEditor />} />
          <Route path="pages/:id" element={<PageEditor />} />
          <Route path="forms" element={<FormsList />} />
          <Route path="forms/new" element={<FormEditor />} />
          <Route path="forms/:id" element={<FormEditor />} />
          <Route path="forms/:id/submissions" element={<FormSubmissions />} />
          <Route path="workflows" element={<WorkflowDesigner />} />
          <Route path="ai-controls" element={<AiControls />} />
        </Route>

        {/* Super Admin */}
        <Route path="/superadmin" element={<RequireAuth roles={['super_admin']}><AppLayout /></RequireAuth>}>
          <Route index element={<SuperAdminDashboard />} />
          <Route path="audit" element={<AuditLog />} />
          <Route path="settings" element={<SystemSettings />} />
          <Route path="users" element={<UsersManagement />} />
          <Route path="universities" element={<UniversitiesManagement />} />
          <Route path="institutions" element={<InstitutionsManagement />} />
          <Route path="programs" element={<ProgramsManagement />} />
          <Route path="agencies" element={<AgenciesManagement />} />
          <Route path="settings/roles-permissions" element={<RolesPermissions />} />
          <Route path="settings/import" element={<DataImport />} />
          <Route path="settings/workflows" element={<WorkflowDesigner />} />
          <Route path="settings/ai-controls" element={<AiControls />} />
          <Route path="settings/demo-scenario" element={<DemoScenario />} />
          <Route path="settings/demo-documents" element={<DemoDocuments />} />
        </Route>

        {/* Approval queue + request review (stage owners) */}
        <Route path="/requests" element={<RequireAuth roles={['faculty','admin','super_admin']}><AppLayout /></RequireAuth>}>
          <Route index element={<RequestsQueue />} />
          <Route path=":id" element={<RequestReview />} />
        </Route>
        {/* Transfers between universities: incoming / outgoing, document requests, reminders */}
        <Route path="/transfers" element={<RequireAuth roles={['faculty','admin','super_admin']}><AppLayout /></RequireAuth>}>
          <Route index element={<Transfers />} />
          <Route path=":id" element={<TransferDetail />} />
        </Route>
        <Route path="/appeals" element={<RequireAuth roles={['faculty','admin','super_admin']}><AppLayout /></RequireAuth>}>
          <Route index element={<AppealsQueue />} />
        </Route>

        {/* Shared CMS page view (any authenticated role) */}
        {/* Custom Pages are public: anonymous visitors get the public frame, signed-in users the app layout. */}
        <Route path="/pages/:slug" element={<PageLayout />}>
          <Route index element={<CmsPageView />} />
        </Route>

        {/* Shared form fill-out view (any authenticated role) */}
        <Route path="/forms/:slug" element={<RequireAuth><AppLayout /></RequireAuth>}>
          <Route index element={<FormFillView />} />
        </Route>

        <Route path="/profile" element={<RequireAuth><AppLayout /></RequireAuth>}>
          <Route index element={<ProfilePage />} />
        </Route>

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
