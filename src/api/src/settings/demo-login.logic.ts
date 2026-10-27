import { DEMO_ACCOUNTS } from './demo-accounts';

/**
 * Demo-login configuration. `users` maps a role to the specific user account the super admin
 * picked to be offered on the login page for that role. Empty => fall back to the seed demo accounts.
 */
export interface DemoLoginSettings {
  enabled: boolean;
  users: Record<string, string>; // role -> userId
}

/** One offered demo account, as the login page and settings preview see it — never includes a password. */
export interface DemoLoginUser {
  userId: string;
  label: string;
  role: string;
}

export interface PublicDemoLogin {
  enabled: boolean;
  users?: DemoLoginUser[];
}

/** Secure default: hidden, nothing configured. */
export const DEMO_LOGIN_DEFAULTS: DemoLoginSettings = { enabled: false, users: {} };

/** The seed demo-account emails, used only as a fallback when the super admin has picked no users. */
export const DEMO_FALLBACK_EMAILS: readonly string[] = DEMO_ACCOUNTS.map((a) => a.email);

export function parseFlag(v: string | null | undefined): boolean {
  return v === '1' || v === 'true';
}

/** Tolerant parse of the stored role->userId JSON map. */
export function parseUsers(v: string | null | undefined): Record<string, string> {
  if (!v) return {};
  try {
    const o = JSON.parse(v);
    if (!o || typeof o !== 'object' || Array.isArray(o)) return {};
    const out: Record<string, string> = {};
    for (const [k, val] of Object.entries(o)) {
      if (typeof val === 'string' && val.trim()) out[k] = val.trim();
    }
    return out;
  } catch {
    return {};
  }
}
