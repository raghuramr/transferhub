import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Settings, Save, Info, Mail, ShieldCheck, Upload, Eye, CheckCircle, AlertCircle, Code2, Send, KeyRound } from 'lucide-react';
import RolesPermissions from './RolesPermissions';
import { Link } from 'react-router-dom';
import { api, emailApi, demoLoginApi, usersApi } from '../../lib/api';
import { DemoLoginBox } from '../../components/auth/DemoLoginBox';
import { EmailTemplateEditor } from './EmailTemplateEditor';
import { useAuthStore } from '../../store/auth';

// ── General settings ─────────────────────────────────────────────

type SettingGroup = {
  title: string;
  desc: string;
  fields: { key: string; label: string; type: 'number' | 'text' | 'select'; options?: string[]; help?: string }[];
};

const GROUPS: SettingGroup[] = [
  {
    title: 'AI Matching',
    desc: 'Configure Anthropic AI match thresholds and behaviour',
    fields: [
      { key: 'ai_auto_apply_threshold', label: 'Auto-apply threshold (0–1)', type: 'number', help: 'Evaluations scoring above this are auto-applied without human review.' },
      { key: 'ai_candidate_count', label: 'Max AI candidates per course', type: 'number' },
      { key: 'ai_model', label: 'Anthropic model', type: 'select', options: ['claude-opus-4-5', 'claude-sonnet-4-5', 'claude-haiku-4-5'] },
    ],
  },
  {
    title: 'Transfer Credit Rules',
    desc: 'BU-level academic business rules',
    fields: [
      { key: 'min_grade_threshold', label: 'Minimum eligible grade', type: 'text', help: 'Courses graded below this are not eligible (default: C).' },
      { key: 'quarter_credit_divisor', label: 'Quarter credit divisor', type: 'number', help: 'Quarter credits ÷ this value → semester credits (default: 1.5).' },
      { key: 'group_c_min_credits', label: 'BU Group C minimum credits', type: 'number', help: 'Residency requirement — minimum credits earned at BU.' },
    ],
  },
  {
    title: 'Security',
    desc: 'Authentication and session parameters',
    fields: [
      { key: 'max_login_attempts', label: 'Max login attempts before lockout', type: 'number' },
      { key: 'access_token_ttl_minutes', label: 'Access token TTL (minutes)', type: 'number' },
      { key: 'refresh_token_ttl_days', label: 'Refresh token TTL (days)', type: 'number' },
    ],
  },
];

const DEFAULTS: Record<string, string> = {
  ai_auto_apply_threshold: '0.92',
  ai_candidate_count: '3',
  ai_model: 'claude-opus-4-5',
  min_grade_threshold: 'C',
  quarter_credit_divisor: '1.5',
  group_c_min_credits: '16',
  max_login_attempts: '5',
  access_token_ttl_minutes: '15',
  refresh_token_ttl_days: '7',
};

const fieldCls = 'w-28 shrink-0 rounded-md border border-gray-300 px-2.5 py-1.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-brand-500';

function GeneralTab() {
  const [values, setValues] = useState<Record<string, string>>(DEFAULTS);
  const [saved, setSaved] = useState(false);
  const handleSave = () => { setSaved(true); setTimeout(() => setSaved(false), 2500); };
  const set = (key: string, v: string) => setValues((cur) => ({ ...cur, [key]: v }));

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
        <Info size={16} className="mt-0.5 shrink-0" />
        <span>
          These values are not stored yet. The settings that take effect live in{' '}
          <Link to="/superadmin/settings/ai-controls" className="font-medium underline">AI Controls</Link> (model, thresholds, budgets) and{' '}
          <Link to="/superadmin/settings/workflows" className="font-medium underline">Workflows → Transfer rules</Link> (minimum grade, credit caps, course age).
        </span>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {GROUPS.map((group) => (
          <section key={group.title} className="rounded-xl border border-gray-200 bg-white">
            <header className="border-b border-gray-100 px-4 py-3">
              <h2 className="text-sm font-semibold text-gray-900">{group.title}</h2>
              <p className="text-xs text-gray-500">{group.desc}</p>
            </header>
            <ul className="divide-y divide-gray-100">
              {group.fields.map((field) => (
                <li key={field.key} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <label htmlFor={field.key} className="min-w-0 text-sm text-gray-700">
                    <span className="flex items-center gap-1">
                      {field.label}
                      {field.help && (
                        <span title={field.help} className="cursor-help text-gray-400"><Info size={12} /></span>
                      )}
                    </span>
                  </label>
                  {field.type === 'select' ? (
                    <select id={field.key} value={values[field.key]} onChange={(e) => set(field.key, e.target.value)}
                      className="w-44 shrink-0 rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
                      {field.options?.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : (
                    <input id={field.key} type={field.type} value={values[field.key]} onChange={(e) => set(field.key, e.target.value)}
                      step={field.type === 'number' ? 'any' : undefined} className={fieldCls} />
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <div className="flex items-center justify-end gap-3">
        {saved && <p className="text-sm text-gray-500">Nothing is stored for these yet — see the note above.</p>}
        <button
          onClick={handleSave}
          className="flex items-center gap-2 rounded-lg bg-brand-800 px-5 py-2 text-sm font-medium text-white hover:bg-brand-900"
        >
          <Save size={16} />Save Settings
        </button>
      </div>
    </div>
  );
}

// ── Demo login (login-page demo accounts) ─────────────────────────

const DEMO_ROLES: { role: string; label: string }[] = [
  { role: 'student', label: 'Student' },
  { role: 'faculty', label: 'Faculty' },
  { role: 'admin', label: 'Admin' },
  { role: 'agency', label: 'Agency' },
  { role: 'super_admin', label: 'Super Admin' },
];

function DemoLoginTab() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['demo-login-settings'], queryFn: () => demoLoginApi.get() });
  const usersQ = useQuery({ queryKey: ['demo-login-users'], queryFn: () => usersApi.list({ pageSize: 1000 }) });
  const [enabled, setEnabled] = useState(false);
  const [users, setUsers] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (q.data) { setEnabled(q.data.data.enabled); setUsers(q.data.data.users ?? {}); }
  }, [q.data]);

  const allUsers = (usersQ.data?.data ?? []) as { id: string; firstName: string; lastName: string; role: string; email: string }[];
  const usersByRole = (role: string) => allUsers.filter((u) => u.role === role);

  const save = useMutation({
    mutationFn: () => demoLoginApi.save({ enabled, users }),
    onSuccess: () => {
      setMsg({ ok: true, text: 'Saved. The login page picks this up within a few seconds.' });
      void qc.invalidateQueries({ queryKey: ['demo-login-settings'] });
    },
    onError: (e) => {
      const m = (e as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
      setMsg({ ok: false, text: (Array.isArray(m) ? m.join(', ') : m) ?? 'Could not save the setting.' });
    },
  });

  const data = q.data?.data;
  const dirty = !!data && (enabled !== data.enabled || JSON.stringify(users) !== JSON.stringify(data.users ?? {}));

  // Preview from the current picks (falls back to the already-resolved seed accounts when nothing is picked).
  const previewUsers = Object.entries(users)
    .map(([role, id]) => {
      const u = allUsers.find((x) => x.id === id);
      return u ? { userId: u.id, label: `${u.firstName} ${u.lastName}`, role: u.role } : null;
    })
    .filter((x): x is { userId: string; label: string; role: string } => !!x);
  const resolvedFallback = data?.resolved ?? [];
  const preview = enabled
    ? { enabled: true as const, users: previewUsers.length ? previewUsers : resolvedFallback }
    : { enabled: false as const };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <section className="rounded-xl border border-gray-200 bg-white">
        <header className="border-b border-gray-100 px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900"><KeyRound size={15} />Demo login</h2>
          <p className="text-xs text-gray-500">Pick the account offered per role. Clicking it on the login page signs in instantly.</p>
        </header>
        {q.isLoading && <p className="px-4 py-3 text-sm text-gray-400">Loading…</p>}
        {q.isError && <p className="px-4 py-3 text-sm text-red-600">Could not load the setting.</p>}
        {data && (
          <div className="space-y-4 p-4 text-sm">
            {!data.ready && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-800">
                <Info size={16} className="mt-0.5 shrink-0" />
                <span>Migration 023 has not been applied, so this cannot be saved yet. The demo box stays hidden.</span>
              </div>
            )}
            <label className="flex items-start gap-3">
              <input type="checkbox" checked={enabled} onChange={(e) => { setEnabled(e.target.checked); setMsg(null); }}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 accent-brand-800" />
              <span>
                <span className="block font-medium text-gray-900">Show demo accounts on the login page</span>
                <span className="block text-xs text-gray-500">Off by default. When off, nothing about the demo accounts is sent to the browser and one-click sign-in is refused.</span>
              </span>
            </label>

            <fieldset disabled={!enabled} className={`space-y-3 border-l-2 pl-4 ${enabled ? 'border-brand-200' : 'border-gray-100 opacity-50'}`}>
              <legend className="mb-1 text-xs font-medium text-gray-500">Account offered for each role</legend>
              {DEMO_ROLES.map(({ role, label }) => (
                <div key={role}>
                  <label className="mb-1 block text-xs font-medium text-gray-600">{label}</label>
                  <select
                    value={users[role] ?? ''}
                    onChange={(e) => {
                      setMsg(null);
                      setUsers((prev) => {
                        const next = { ...prev };
                        if (e.target.value) next[role] = e.target.value; else delete next[role];
                        return next;
                      });
                    }}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  >
                    <option value="">Not offered</option>
                    {usersByRole(role).map((u) => (
                      <option key={u.id} value={u.id}>{u.firstName} {u.lastName} · {u.email}</option>
                    ))}
                  </select>
                </div>
              ))}
              <p className="text-xs text-gray-400">Leave all unset to offer the built-in seed demo accounts (one per role).</p>
            </fieldset>

            <p className="rounded-lg bg-gray-50 p-3 text-xs text-gray-600">
              Clicking a demo button signs in as that exact account. No password is ever sent to the browser — the server
              only allows it while this is on and only for the accounts you pick here. Still, turn it off outside demos.
            </p>

            {msg && (
              <p role="status" className={`flex items-start gap-2 rounded-lg p-2 ${msg.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                {msg.ok ? <CheckCircle size={16} className="mt-0.5 shrink-0" /> : <AlertCircle size={16} className="mt-0.5 shrink-0" />}
                {msg.text}
              </p>
            )}
            <div className="flex justify-end">
              <button type="button" onClick={() => { setMsg(null); save.mutate(); }} disabled={!dirty || save.isPending || !data.ready}
                className="flex items-center gap-2 rounded-lg bg-brand-800 px-5 py-2 text-sm font-medium text-white hover:bg-brand-900 disabled:opacity-50">
                <Save size={16} />{save.isPending ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-gray-200 bg-white">
        <header className="border-b border-gray-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-gray-900">Preview of the login page</h2>
          <p className="text-xs text-gray-500">Updates as you change the options (not saved until you press Save).</p>
        </header>
        <div className="p-4">
          <div className="mx-auto max-w-md rounded-2xl bg-brand-950 p-4">
            <div className="rounded-xl bg-white p-5">
              <p className="mb-3 text-sm font-semibold text-gray-900">Sign in to your account</p>
              <div className="space-y-2" aria-hidden="true">
                <div className="h-9 rounded-lg border border-gray-300 bg-gray-50" />
                <div className="h-9 rounded-lg border border-gray-300 bg-gray-50" />
                <div className="h-9 rounded-lg bg-brand-800" />
              </div>
              {preview.enabled ? (
                <DemoLoginBox demo={preview} onPick={() => undefined} />
              ) : (
                <p className="mt-4 border-t border-gray-100 pt-3 text-center text-xs text-gray-400">No demo accounts are shown.</p>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

// ── Email settings ────────────────────────────────────────────────

function TemplateGallery({ to }: { to: string }) {
  const list = useQuery({ queryKey: ['email-templates'], queryFn: () => emailApi.templates() });
  const [sel, setSel] = useState(0);
  const send = useMutation({ mutationFn: (id: number) => emailApi.sendSample(id, to.trim() || undefined) });
  const items = list.data?.data ?? [];
  const cur = items[sel];

  return (
    <section className="rounded-xl border border-gray-200 bg-white lg:col-span-2">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">E-mail templates</h2>
          <p className="text-xs text-gray-500">Every e-mail TransferHub sends, shown with sample data.</p>
        </div>
        {cur && (
          <button type="button" onClick={() => send.mutate(cur.id)} disabled={send.isPending}
            className="flex items-center gap-1.5 rounded-lg border border-brand-800 px-3 py-1.5 text-sm font-medium text-brand-800 hover:bg-brand-50 disabled:opacity-50">
            <Send size={14} />{send.isPending ? 'Sending…' : `Send this sample to ${to || 'me'}`}
          </button>
        )}
      </header>
      {send.data && (
        <p className={`mx-4 mt-3 rounded-lg p-2 text-sm ${send.data.data.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {send.data.data.ok ? 'Sample sent.' : `Not sent: ${send.data.data.error}`}
        </p>
      )}
      {list.isLoading && <p className="px-4 py-3 text-sm text-gray-400">Loading…</p>}
      {list.isError && <p className="px-4 py-3 text-sm text-red-600">Could not load the templates.</p>}
      {cur && (
        <div className="grid gap-0 md:grid-cols-[16rem_1fr]">
          <ul className="max-h-[720px] overflow-y-auto border-b border-gray-100 md:border-b-0 md:border-r">
            {items.map((t, i) => (
              <li key={t.id}>
                <button type="button" onClick={() => { setSel(i); send.reset(); }}
                  className={`w-full px-4 py-2.5 text-left text-sm ${i === sel ? 'bg-brand-50 text-brand-800' : 'text-gray-700 hover:bg-gray-50'}`}>
                  <span className="block font-medium">{t.name}</span>
                  <span className="block text-xs text-gray-500">To: {t.audience}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="min-w-0 p-4">
            <p className="mb-2 truncate text-sm text-gray-600"><span className="text-gray-400">Subject:</span> {cur.subject}</p>
            <iframe title={cur.name} srcDoc={cur.html} sandbox="" className="h-[680px] w-full rounded-lg border border-gray-200 bg-white" />
          </div>
        </div>
      )}
    </section>
  );
}

function EmailTab() {
  const user = useAuthStore((st) => st.user);
  const status = useQuery({ queryKey: ['email-status'], queryFn: () => emailApi.status() });
  const [to, setTo] = useState(user?.email ?? '');
  const test = useMutation({
    mutationFn: () => emailApi.test(to.trim() || undefined),
    onSettled: () => void status.refetch(),
  });
  const st = status.data?.data;
  const testError = test.isError
    ? ((test.error as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message ?? 'Request failed.')
    : null;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <section className="rounded-xl border border-gray-200 bg-white">
        <header className="border-b border-gray-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-gray-900">Email delivery (Resend)</h2>
          <p className="text-xs text-gray-500">Read from the server&apos;s environment variables. Change them under App Service → Environment variables.</p>
        </header>
        {status.isLoading && <p className="px-4 py-3 text-sm text-gray-400">Loading…</p>}
        {status.isError && <p className="px-4 py-3 text-sm text-red-600">Could not load the email status.</p>}
        {st && (
          <dl className="divide-y divide-gray-100 text-sm">
            <div className="flex justify-between gap-3 px-4 py-2.5">
              <dt className="text-gray-500">RESEND_API_KEY</dt>
              <dd className={st.configured ? 'font-medium text-green-700' : 'font-medium text-red-600'}>{st.configured ? 'Set' : 'Not set — no emails are sent'}</dd>
            </div>
            <div className="flex justify-between gap-3 px-4 py-2.5">
              <dt className="text-gray-500">Sender</dt>
              <dd className="text-right text-gray-800">{st.fromName} &lt;{st.fromAddress}&gt;{st.fromIsDefault && <span className="block text-xs text-amber-700">built-in default — RESEND_FROM_EMAIL is not set</span>}</dd>
            </div>
            <div className="flex justify-between gap-3 px-4 py-2.5">
              <dt className="text-gray-500">Links in emails point to</dt>
              <dd className="text-right text-gray-800">{st.appBaseUrl}</dd>
            </div>
          </dl>
        )}
        {st && (
          <p className="flex items-start gap-1.5 border-t border-gray-100 px-4 py-3 text-xs text-gray-500">
            <Info size={12} className="mt-0.5 shrink-0" />
            Resend only delivers from a domain verified in your Resend account (Domains). The domain here is <strong className="mx-0.5">{st.fromDomain}</strong>.
            A key on an unverified account can only send to the account owner&apos;s own address.
          </p>
        )}
      </section>

      <section className="rounded-xl border border-gray-200 bg-white">
        <header className="border-b border-gray-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-gray-900">Send a test email</h2>
          <p className="text-xs text-gray-500">Shows Resend&apos;s exact answer, so a rejected message is no longer silent.</p>
        </header>
        <div className="flex flex-wrap items-center gap-2 px-4 py-3">
          <input type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="you@example.com"
            className="min-w-0 flex-1 rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
          <button type="button" onClick={() => test.mutate()} disabled={test.isPending}
            className="flex items-center gap-1.5 rounded-lg bg-brand-800 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-900 disabled:bg-brand-400">
            <Send size={14} />{test.isPending ? 'Sending…' : 'Send test'}
          </button>
        </div>
        {test.data && (
          <div className={`mx-4 mb-3 flex items-start gap-2 rounded-lg p-3 text-sm ${test.data.data.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
            {test.data.data.ok ? <CheckCircle size={16} className="mt-0.5 shrink-0" /> : <AlertCircle size={16} className="mt-0.5 shrink-0" />}
            {test.data.data.ok
              ? `Accepted by Resend (id ${test.data.data.id ?? '?'}). If it doesn't arrive, check spam and the Resend dashboard's Logs.`
              : `Not sent: ${test.data.data.error}`}
          </div>
        )}
        {testError && <p className="mx-4 mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{[testError].flat().join(' ')}</p>}
        <div className="border-t border-gray-100 px-4 py-3">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Recent attempts (since the API last restarted)</h3>
          {!st?.recent.length && <p className="text-sm text-gray-400">None yet.</p>}
          <ul className="space-y-1.5 text-sm">
            {st?.recent.map((r, i) => (
              <li key={i} className="flex items-start gap-2">
                {r.ok ? <CheckCircle size={14} className="mt-0.5 shrink-0 text-green-600" /> : <AlertCircle size={14} className="mt-0.5 shrink-0 text-red-600" />}
                <span className="min-w-0">
                  <span className="text-gray-800">{r.subject}</span>
                  <span className="text-gray-500"> → {r.to} · {new Date(r.at).toLocaleString()}</span>
                  {!r.ok && <span className="block text-xs text-red-600">{r.error}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>
      <EmailTemplateEditor to={to} />
      <TemplateGallery to={to} />
    </div>
  );
}

// ── Data Import ───────────────────────────────────────────────────

type ImportType = 'universities' | 'programs' | 'courses';

const FORMAT_EXAMPLES: Record<ImportType, string> = {
  universities: JSON.stringify({
    type: 'universities',
    data: [{ code: 'MIT', name: 'Massachusetts Institute of Technology', type: 'University', country: 'USA', state: 'MA', city: 'Cambridge' }],
  }, null, 2),
  programs: JSON.stringify({
    type: 'programs',
    data: [{ name: 'Computer Science', code: 'CS', universityCode: 'MIT', description: 'BS in Computer Science' }],
  }, null, 2),
  courses: JSON.stringify({
    type: 'courses',
    data: [{
      code: 'CS101', name: 'Intro to Computer Science', credits: 3,
      universityCode: 'MIT', programCode: 'CS', description: 'Fundamentals of programming.',
      topics: [{ title: 'Variables and Data Types', description: 'Primitive types, assignment.' }, { title: 'Control Flow', description: 'Conditionals and loops.' }],
    }],
  }, null, 2),
};

type PreviewRow = Record<string, unknown>;

function DataImportTab() {
  const [importType, setImportType] = useState<ImportType>('universities');
  const [jsonInput, setJsonInput] = useState('');
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const [parseError, setParseError] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ success: boolean; message: string } | null>(null);
  const [showFormat, setShowFormat] = useState(false);

  const handlePreview = () => {
    setParseError('');
    setPreview(null);
    setImportResult(null);
    try {
      const parsed = JSON.parse(jsonInput);
      if (!parsed.data || !Array.isArray(parsed.data)) {
        setParseError('JSON must have a "data" array at the root.');
        return;
      }
      setPreview(parsed.data as PreviewRow[]);
    } catch (e) {
      setParseError(`JSON parse error: ${(e as Error).message}`);
    }
  };

  const handleImport = async () => {
    if (!preview) return;
    setImporting(true);
    setImportResult(null);
    try {
      await api.post('/import/preview', { type: importType, data: preview });
      setImportResult({ success: true, message: `${preview.length} ${importType} imported successfully.` });
      setPreview(null);
      setJsonInput('');
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Import failed.';
      setImportResult({ success: false, message: msg });
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="font-semibold text-gray-900 mb-1">Data Import</h2>
        <p className="text-sm text-gray-500 mb-5">
          Import Universities, Programs, or Courses from an external source using a standard JSON format.
          Paste the JSON below, preview it, then import on approval.
        </p>

        {/* Entity type tabs */}
        <div className="flex gap-2 mb-5">
          {(['universities', 'programs', 'courses'] as ImportType[]).map((t) => (
            <button
              key={t}
              onClick={() => { setImportType(t); setPreview(null); setParseError(''); setImportResult(null); }}
              className={`px-4 py-2 rounded-lg text-sm font-medium capitalize transition-colors ${
                importType === t
                  ? 'bg-brand-800 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Format reference */}
        <div className="mb-4">
          <button
            onClick={() => setShowFormat((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-brand-700 hover:text-brand-900 font-medium"
          >
            <Code2 size={14} />{showFormat ? 'Hide format' : 'Show expected JSON format'}
          </button>
          {showFormat && (
            <pre className="mt-2 p-4 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-700 overflow-x-auto">
              {FORMAT_EXAMPLES[importType]}
            </pre>
          )}
        </div>

        {/* JSON input */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Paste JSON Data</label>
          <textarea
            rows={10}
            value={jsonInput}
            onChange={(e) => { setJsonInput(e.target.value); setParseError(''); setPreview(null); }}
            placeholder={`Paste ${importType} JSON here…`}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-brand-500 resize-y"
          />
        </div>

        {parseError && (
          <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm mb-4">
            <AlertCircle size={16} className="shrink-0 mt-0.5" />{parseError}
          </div>
        )}

        <div className="flex gap-3 mb-4">
          <button
            onClick={handlePreview}
            disabled={!jsonInput.trim()}
            className="flex items-center gap-2 px-5 py-2.5 border border-brand-800 text-brand-800 rounded-lg text-sm font-medium hover:bg-brand-50 disabled:opacity-50"
          >
            <Eye size={16} />Preview
          </button>
          {preview && (
            <button
              onClick={handleImport}
              disabled={importing}
              className="flex items-center gap-2 px-5 py-2.5 bg-brand-800 text-white rounded-lg text-sm font-medium hover:bg-brand-900 disabled:bg-brand-400"
            >
              <Upload size={16} />{importing ? 'Importing…' : `Import ${preview.length} records`}
            </button>
          )}
        </div>

        {importResult && (
          <div className={`flex items-start gap-2 p-3 rounded-lg text-sm ${importResult.success ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
            {importResult.success ? <CheckCircle size={16} className="shrink-0 mt-0.5" /> : <AlertCircle size={16} className="shrink-0 mt-0.5" />}
            {importResult.message}
          </div>
        )}

        {/* Preview table */}
        {preview && preview.length > 0 && (
          <div className="mt-5 overflow-x-auto">
            <p className="text-sm font-medium text-gray-700 mb-2">{preview.length} record(s) to import:</p>
            <table className="w-full text-xs border-collapse border border-gray-200 rounded-lg overflow-hidden">
              <thead>
                <tr className="bg-gray-50">
                  {Object.keys(preview[0]).map((k) => (
                    <th key={k} className="px-3 py-2 text-left font-semibold text-gray-600 border-b border-gray-200">{k}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.slice(0, 20).map((row, i) => (
                  <tr key={i} className="even:bg-gray-50">
                    {Object.values(row).map((v, j) => (
                      <td key={j} className="px-3 py-2 border-b border-gray-100 text-gray-700 max-w-[200px] truncate">
                        {typeof v === 'object' ? JSON.stringify(v) : String(v ?? '')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {preview.length > 20 && (
              <p className="text-xs text-gray-400 mt-2">Showing first 20 of {preview.length} rows.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────

type Tab = 'general' | 'email' | 'demo' | 'roles' | 'import';

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'general', label: 'General', icon: <Settings size={16} /> },
  { id: 'email', label: 'Email', icon: <Mail size={16} /> },
  { id: 'demo', label: 'Demo login', icon: <KeyRound size={16} /> },
  { id: 'roles', label: 'Roles & Permissions', icon: <ShieldCheck size={16} /> },
  { id: 'import', label: 'Data Import', icon: <Upload size={16} /> },
];

export default function SystemSettings() {
  const [activeTab, setActiveTab] = useState<Tab>('general');

  return (
    <div className="p-4 sm:p-8 w-[95%] mx-auto">
      <div className="flex items-center gap-3 mb-2">
        <Settings className="text-gray-600" size={24} />
        <h1 className="text-2xl font-bold text-gray-900">System Settings</h1>
      </div>
      <p className="text-gray-500 mb-6">Configure system-wide settings, email, permissions, and data imports.</p>

      {/* Tab bar */}
      <div className="flex flex-wrap gap-1 mb-6 border-b border-gray-200 pb-0">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-lg border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-brand-800 text-brand-800 bg-brand-50/50'
                : 'border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-300'
            }`}
          >
            {tab.icon}{tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'general' && <GeneralTab />}
      {activeTab === 'email' && <EmailTab />}
      {activeTab === 'demo' && <DemoLoginTab />}
      {activeTab === 'roles' && <RolesPermissions />}
      {activeTab === 'import' && <DataImportTab />}
    </div>
  );
}
