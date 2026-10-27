import { motion } from 'framer-motion';
import { UserRound, Loader2 } from 'lucide-react';
import type { DemoLoginPublic, DemoLoginUser } from '../../lib/api';

const ROLE_LABEL: Record<string, string> = {
  student: 'Student',
  faculty: 'Faculty',
  admin: 'Admin',
  agency: 'Agency',
  super_admin: 'Super Admin',
};

/**
 * Demo-account picker for the login page. Renders nothing unless the server says it is enabled.
 * Clicking a button signs in directly as that account (no password shown or typed) — the server only
 * allows it for the accounts a super admin configured, while demo login is on.
 */
export function DemoLoginBox({
  demo,
  onPick,
  busyId,
}: {
  demo: DemoLoginPublic | null;
  onPick: (u: DemoLoginUser) => void;
  busyId?: string | null;
}) {
  if (!demo || !demo.enabled || !demo.users || demo.users.length === 0) return null;

  return (
    <div className="mt-6 pt-6 border-t border-gray-100" data-testid="demo-login">
      <p className="text-xs text-gray-500 text-center mb-3">Demo accounts — click one to sign in instantly</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
        {demo.users.map((u) => {
          const busy = busyId === u.userId;
          return (
            <motion.button
              key={u.userId}
              type="button"
              whileHover={{ y: busy ? 0 : -2 }}
              whileTap={{ scale: busy ? 1 : 0.98 }}
              disabled={!!busyId}
              onClick={() => onPick(u)}
              aria-label={`Sign in as ${u.label}, ${ROLE_LABEL[u.role] ?? u.role}`}
              className="flex items-start gap-2 rounded-lg bg-brand-50/60 p-2.5 text-left transition-colors hover:bg-brand-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 min-h-[44px] disabled:opacity-60"
            >
              {busy ? (
                <Loader2 size={16} className="mt-0.5 shrink-0 animate-spin text-brand-700" aria-hidden="true" />
              ) : (
                <UserRound size={16} className="mt-0.5 shrink-0 text-brand-700" aria-hidden="true" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-brand-900 truncate">{u.label}</span>
                <span className="block text-gray-500">{ROLE_LABEL[u.role] ?? u.role}</span>
              </span>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
