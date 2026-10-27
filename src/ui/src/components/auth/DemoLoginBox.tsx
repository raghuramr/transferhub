import { motion } from 'framer-motion';
import { UserRound } from 'lucide-react';
import type { DemoLoginPublic } from '../../lib/api';

type Account = NonNullable<DemoLoginPublic['accounts']>[number];

const ROLE_LABEL: Record<string, string> = {
  student: 'Student',
  faculty: 'Faculty',
  admin: 'Admin',
  agency: 'Agency',
  super_admin: 'Super Admin',
};

/**
 * Demo-account picker for the login page. Renders nothing unless the server says it is enabled.
 * Clicking a button fills the email and password fields (via onPick); the password is only shown as text
 * when `showCredentials` is on.
 */
export function DemoLoginBox({ demo, onPick }: { demo: DemoLoginPublic | null; onPick: (a: Account) => void }) {
  if (!demo || !demo.enabled || !demo.accounts || demo.accounts.length === 0) return null;
  const showCreds = !!demo.showCredentials;

  return (
    <div className="mt-6 pt-6 border-t border-gray-100" data-testid="demo-login">
      <p className="text-xs text-gray-500 text-center mb-3">
        Demo accounts - {showCreds ? 'click one to fill the form' : 'click a name, then press Sign in'}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
        {demo.accounts.map((a) => (
          <motion.button
            key={a.email}
            type="button"
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => onPick(a)}
            aria-label={`Fill the sign-in form as ${a.label}, ${ROLE_LABEL[a.role] ?? a.role}`}
            className="flex items-start gap-2 rounded-lg bg-brand-50/60 p-2.5 text-left transition-colors hover:bg-brand-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 min-h-[44px]"
          >
            <UserRound size={16} className="mt-0.5 shrink-0 text-brand-700" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="block font-medium text-brand-900 truncate">{a.label}</span>
              <span className="block text-gray-500">{ROLE_LABEL[a.role] ?? a.role}</span>
              {showCreds && (
                <>
                  <span className="block text-gray-500 truncate">{a.email}</span>
                  <span className="block font-mono text-gray-500 truncate">{a.password}</span>
                </>
              )}
            </span>
          </motion.button>
        ))}
      </div>
    </div>
  );
}
