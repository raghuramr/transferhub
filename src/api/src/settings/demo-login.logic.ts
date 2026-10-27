import { DEMO_ACCOUNTS, DemoAccount } from './demo-accounts';

export interface DemoLoginSettings {
  enabled: boolean;
  showCredentials: boolean;
}

export interface PublicDemoLogin {
  enabled: boolean;
  namesOnly?: boolean;
  showCredentials?: boolean;
  accounts?: { label: string; role: string; email: string; password: string }[];
}

/** Secure default: hidden, no credentials displayed. */
export const DEMO_LOGIN_DEFAULTS: DemoLoginSettings = { enabled: false, showCredentials: false };

export function parseFlag(v: string | null | undefined): boolean {
  return v === '1' || v === 'true';
}

/**
 * What the public login page may receive. Disabled -> nothing else at all (no accounts, no passwords).
 * Enabled -> accounts incl. password (needed so a button click can fill the form); `showCredentials` only
 * controls whether the page DISPLAYS them. "Names only" is simply the opposite of showCredentials.
 */
export function buildPublicDemoLogin(s: DemoLoginSettings, accounts: readonly DemoAccount[] = DEMO_ACCOUNTS): PublicDemoLogin {
  if (!s.enabled) return { enabled: false };
  return {
    enabled: true,
    namesOnly: !s.showCredentials,
    showCredentials: s.showCredentials,
    accounts: accounts.map((a) => ({ label: a.label, role: a.role, email: a.email, password: a.password })),
  };
}
