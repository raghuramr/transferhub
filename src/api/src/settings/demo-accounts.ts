/**
 * The named demo accounts that can be offered on the login page (see database/seed/003_demo_users.sql and
 * scripts/seed-users.ts). Demo/seed credentials only - NEVER put a real or production login in this list.
 * Only returned to the browser while a super admin has switched the demo login on.
 */
export interface DemoAccount {
  label: string;
  role: string;
  email: string;
  password: string;
}

export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  { label: 'Maya Rivera', role: 'student', email: 'student@test.edu', password: 'Student@123!' },
  { label: 'Dr. Jane Lee', role: 'faculty', email: 'faculty.cs@bu.edu', password: 'Faculty@123!' },
  { label: 'Credit Evaluator', role: 'admin', email: 'admin@bu.edu', password: 'Admin@123!' },
  { label: 'Transfer Agency', role: 'agency', email: 'agency@partner.edu', password: 'Agency@123!' },
  { label: 'System Administrator', role: 'super_admin', email: 'super_admin@bu.edu', password: 'SuperAdmin@123!' },
];
