import assert from 'node:assert/strict';
import { AuthService } from '../src/auth/auth.service';

/**
 * checkEmailAvailable: reports whether an email is already registered (so the registration wizard
 * can say so on step 1), and rate-limits per IP without ever blocking the real register() check.
 */
function make(takenEmails: string[]) {
  const queries: string[] = [];
  const db: any = {
    query: async (text: string, inputs: any[]) => {
      queries.push(text);
      const email = String(inputs?.[0]?.value ?? '').toLowerCase();
      const taken = takenEmails.some((e) => e.toLowerCase() === email);
      return { recordset: taken ? [{ Id: 'x' }] : [] };
    },
  };
  const svc = new AuthService(db, {} as any, { get: () => undefined } as any, {} as any, {} as any);
  return { svc, queries };
}

(async () => {
  // Not taken.
  {
    const { svc } = make([]);
    const r = await svc.checkEmailAvailable('new@example.edu', '1.2.3.4');
    assert.deepEqual(r, { available: true });
  }

  // Already registered.
  {
    const { svc } = make(['raghuramr@outlook.com']);
    const r = await svc.checkEmailAvailable('raghuramr@outlook.com', '1.2.3.4');
    assert.deepEqual(r, { available: false });
  }

  // Not-yet-valid-looking input is never reported as taken (avoid flashing an error before the field's own validation runs).
  {
    const { svc } = make(['taken@example.edu']);
    const r = await svc.checkEmailAvailable('not-an-email', '1.2.3.4');
    assert.deepEqual(r, { available: true });
  }

  // Rate limit: 20 allowed per minute per IP, then 429; a different IP is unaffected.
  {
    const { svc } = make([]);
    for (let i = 0; i < 20; i++) await svc.checkEmailAvailable(`a${i}@example.edu`, '9.9.9.9');
    await assert.rejects(svc.checkEmailAvailable('one-more@example.edu', '9.9.9.9'), /Too many checks/);
    const r = await svc.checkEmailAvailable('fine@example.edu', '8.8.8.8');
    assert.deepEqual(r, { available: true });
  }

  console.log('check-email OK');
})();
