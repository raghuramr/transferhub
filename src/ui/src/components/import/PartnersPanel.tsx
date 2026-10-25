import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Check, Copy, Globe, KeyRound, Loader2, Mail, Phone, Plus, ShieldOff, X } from 'lucide-react';
import { importApi } from '../../lib/api';
import { cn } from '../../lib/cn';
import type { IssuedKey, Partner, PartnerInput } from '../../types/import';

const errMsg = (e: unknown, fallback: string) => {
  const m = (e as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
  return m ? [m].flat().join(' ') : fallback;
};
const when = (d: string | null) => (d ? new Date(d).toLocaleString() : 'never');

const inputCls = 'mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500';

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1800); });
      }}
      className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
    >
      {done ? <Check size={13} className="text-green-600" /> : <Copy size={13} />} {done ? 'Copied' : label}
    </button>
  );
}

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={onClose}>
      <div className={cn('mt-10 w-full rounded-xl bg-white p-5 shadow-xl', wide ? 'max-w-2xl' : 'max-w-lg')} onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Close"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Shown once, right after a key is generated: the only time the full key exists. */
function KeyReveal({ issued, partner, onClose }: { issued: IssuedKey; partner: string; onClose: () => void }) {
  return (
    <Modal title="API key created" onClose={onClose} wide>
      <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
        <strong>Copy this now.</strong> For security only a fingerprint is stored, so this key cannot be shown again. If it is lost, create a new key and revoke this one.
        {issued.emailed && <span className="mt-1 block">The instructions and key were also emailed to the contact.</span>}
      </div>
      <div className="mb-1 text-xs font-medium text-gray-500">API key for {partner}</div>
      <div className="mb-3 flex items-center gap-2">
        <code className="flex-1 break-all rounded-lg bg-slate-900 px-3 py-2 text-xs text-slate-100">{issued.apiKey}</code>
        <CopyButton text={issued.apiKey} />
      </div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-medium text-gray-500">Ready-to-share instructions</span>
        <CopyButton text={issued.instructions} label="Copy instructions" />
      </div>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-900 p-3 text-xs text-slate-100">{issued.instructions}</pre>
      <div className="mt-4 flex justify-end">
        <button type="button" onClick={onClose} className="rounded-lg bg-brand-800 px-4 py-2 text-sm font-medium text-white hover:bg-brand-900">I have saved it</button>
      </div>
    </Modal>
  );
}

function PartnerForm({ initial, onSave, onClose, busy, error }: {
  initial?: Partner; onSave: (v: PartnerInput) => void; onClose: () => void; busy: boolean; error: string;
}) {
  const [v, setV] = useState<PartnerInput>({
    universityName: initial?.universityName ?? '',
    universityCode: initial?.universityCode ?? '',
    contactName: initial?.contactName ?? '',
    contactEmail: initial?.contactEmail ?? '',
    contactPhone: initial?.contactPhone ?? '',
    website: initial?.website ?? '',
    notes: initial?.notes ?? '',
    emailKey: false,
  });
  const set = (patch: Partial<PartnerInput>) => setV((x) => ({ ...x, ...patch }));
  const valid = v.universityName.trim() && v.universityCode.trim() && v.contactName.trim() && /\S+@\S+\.\S+/.test(v.contactEmail);
  return (
    <Modal title={initial ? 'Edit partner' : 'Onboard a partner'} onClose={onClose}>
      {!initial && <p className="mb-4 text-sm text-gray-500">Record who is sending data. An API key is generated for them when you save.</p>}
      <div className="space-y-3">
        <label className="block text-sm font-medium text-gray-700">University / organisation name
          <input className={inputCls} value={v.universityName} onChange={(e) => set({ universityName: e.target.value })} maxLength={200} />
        </label>
        <label className="block text-sm font-medium text-gray-700">University code
          <span className="block text-xs font-normal text-gray-500">The code their data is filed under (e.g. MIT). They can only submit data for this code.</span>
          <input className={inputCls} value={v.universityCode} onChange={(e) => set({ universityCode: e.target.value.toUpperCase() })} maxLength={20} />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-medium text-gray-700">Point of contact
            <input className={inputCls} value={v.contactName} onChange={(e) => set({ contactName: e.target.value })} maxLength={150} />
          </label>
          <label className="block text-sm font-medium text-gray-700">Contact email
            <input type="email" className={inputCls} value={v.contactEmail} onChange={(e) => set({ contactEmail: e.target.value })} maxLength={256} />
          </label>
          <label className="block text-sm font-medium text-gray-700">Phone (optional)
            <input className={inputCls} value={v.contactPhone} onChange={(e) => set({ contactPhone: e.target.value })} maxLength={40} />
          </label>
          <label className="block text-sm font-medium text-gray-700">Website (optional)
            <input className={inputCls} value={v.website} onChange={(e) => set({ website: e.target.value })} maxLength={300} />
          </label>
        </div>
        <label className="block text-sm font-medium text-gray-700">Notes (optional)
          <textarea className={inputCls} rows={2} value={v.notes} onChange={(e) => set({ notes: e.target.value })} maxLength={1000} />
        </label>
        {!initial && (
          <label className="flex items-start gap-2 text-sm text-gray-700">
            <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-gray-300 text-brand-800" checked={!!v.emailKey} onChange={(e) => set({ emailKey: e.target.checked })} />
            <span>Email the instructions and key to the contact now <span className="block text-xs text-gray-500">Sends the key in plain email. Leave off if you prefer to share it yourself.</span></span>
          </label>
        )}
        {error && <p className="rounded-lg bg-red-50 p-2 text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700">Cancel</button>
          <button type="button" disabled={!valid || busy} onClick={() => onSave(v)} className="inline-flex items-center gap-2 rounded-lg bg-brand-800 px-4 py-2 text-sm font-medium text-white disabled:bg-brand-300">
            {busy && <Loader2 size={14} className="animate-spin" />} {initial ? 'Save' : 'Create partner and key'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export default function PartnersPanel() {
  const qc = useQueryClient();
  const partners = useQuery({ queryKey: ['import-partners'], queryFn: () => importApi.partners() });
  const info = useQuery({ queryKey: ['import-endpoint'], queryFn: () => importApi.endpointInfo() });
  const [form, setForm] = useState<{ partner?: Partner } | null>(null);
  const [formError, setFormError] = useState('');
  const [revealed, setRevealed] = useState<{ issued: IssuedKey; partner: string } | null>(null);
  const [showGuide, setShowGuide] = useState(false);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['import-partners'] });

  const create = useMutation({
    mutationFn: (v: PartnerInput) => importApi.createPartner(v),
    onSuccess: (res, v) => { setForm(null); setFormError(''); setRevealed({ issued: res.data, partner: v.universityName }); refresh(); },
    onError: (e) => setFormError(errMsg(e, 'Could not create the partner.')),
  });
  const update = useMutation({
    mutationFn: ({ id, v }: { id: number; v: PartnerInput }) => {
      const { emailKey: _e, ...rest } = v;
      return importApi.updatePartner(id, rest);
    },
    onSuccess: () => { setForm(null); setFormError(''); refresh(); },
    onError: (e) => setFormError(errMsg(e, 'Could not save the partner.')),
  });
  const toggle = useMutation({ mutationFn: ({ id, active }: { id: number; active: boolean }) => importApi.setPartnerActive(id, active), onSuccess: refresh });
  const newKey = useMutation({
    mutationFn: ({ p, email }: { p: Partner; email: boolean }) => importApi.issueKey(p.id, { label: `Key ${p.keys.length + 1}`, emailKey: email }),
    onSuccess: (res, vars) => { setRevealed({ issued: res.data, partner: vars.p.universityName }); refresh(); },
  });
  const revoke = useMutation({ mutationFn: ({ id, keyId }: { id: number; keyId: number }) => importApi.revokeKey(id, keyId), onSuccess: refresh });

  const list = partners.data?.data ?? [];
  const submitUrl = info.data?.data.submitUrl ?? '/api/public/v1/submissions';

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-gray-500">
          Give another university a secure way to push its catalogue to you. Each partner gets an API key; whatever they send lands in the
          <strong> Submissions</strong> queue for you to review and import - nothing is added automatically.
        </p>
        <button type="button" onClick={() => { setFormError(''); setForm({}); }} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-800 px-4 py-2 text-sm font-medium text-white hover:bg-brand-900">
          <Plus size={15} /> Onboard a partner
        </button>
      </div>

      <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4">
        <button type="button" onClick={() => setShowGuide((v) => !v)} className="text-sm font-semibold text-gray-800">
          {showGuide ? '▾' : '▸'} How partners send data
        </button>
        {showGuide && (
          <div className="mt-3 space-y-2 text-sm text-gray-600">
            <p>Partners send a JSON POST with their key in the <code className="rounded bg-gray-100 px-1">X-API-Key</code> header:</p>
            <pre className="overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">{`curl -X POST ${submitUrl} \\
  -H "X-API-Key: <their key>" -H "Content-Type: application/json" \\
  -d '{"note":"Spring update","courses":[{"universityCode":"MIT","code":"6.0001","name":"Intro to CS","credits":3}]}'`}</pre>
            <p>
              They can read the field reference at <a className="text-brand-800 underline" href={info.data?.data.formatUrl} target="_blank" rel="noreferrer">{info.data?.data.formatUrl ?? '/api/public/v1/format'}</a>{' '}
              and poll <code className="rounded bg-gray-100 px-1">GET /api/public/v1/submissions/&lt;reference&gt;</code> for the outcome of each row. Limits: 5,000 rows per submission, 60 requests per minute per key.
            </p>
          </div>
        )}
      </div>

      {partners.isLoading && <p className="text-gray-400">Loading…</p>}
      {!partners.isLoading && list.length === 0 && (
        <div className="rounded-xl border border-dashed border-gray-300 p-10 text-center text-gray-500">
          <Building2 className="mx-auto mb-2 text-gray-300" size={32} />
          No partners yet. Onboard one to generate their API key.
        </div>
      )}

      <div className="space-y-4">
        {list.map((p) => (
          <div key={p.id} className={cn('rounded-xl border bg-white p-5', p.isActive ? 'border-gray-200' : 'border-dashed border-gray-300 opacity-70')}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-semibold text-gray-900">{p.universityName}</h3>
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">{p.universityCode}</span>
                  {!p.isActive && <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">deactivated</span>}
                </div>
                <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-gray-600">
                  <span>{p.contactName}</span>
                  <a href={`mailto:${p.contactEmail}`} className="inline-flex items-center gap-1 hover:text-brand-800"><Mail size={13} /> {p.contactEmail}</a>
                  {p.contactPhone && <span className="inline-flex items-center gap-1"><Phone size={13} /> {p.contactPhone}</span>}
                  {p.website && <a href={p.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-brand-800"><Globe size={13} /> {p.website.replace(/^https?:\/\//, '')}</a>}
                </div>
                <div className="mt-1 text-xs text-gray-400">
                  {p.submissions} submission(s){p.openSubmissions > 0 && <span className="font-medium text-amber-600"> · {p.openSubmissions} waiting for review</span>} · last {when(p.lastSubmissionAt)}
                </div>
                {p.notes && <p className="mt-2 text-sm text-gray-500">{p.notes}</p>}
              </div>
              <div className="flex flex-wrap gap-2 text-sm">
                <button type="button" onClick={() => { setFormError(''); setForm({ partner: p }); }} className="rounded-lg border border-gray-300 px-3 py-1.5 text-gray-700 hover:bg-gray-50">Edit</button>
                <button
                  type="button"
                  onClick={() => toggle.mutate({ id: p.id, active: !p.isActive })}
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-gray-700 hover:bg-gray-50"
                >
                  {p.isActive ? 'Deactivate' : 'Reactivate'}
                </button>
              </div>
            </div>

            <div className="mt-4 border-t border-gray-100 pt-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500"><KeyRound size={13} /> API keys</span>
                <div className="flex gap-2">
                  <button type="button" disabled={newKey.isPending || !p.isActive} onClick={() => newKey.mutate({ p, email: false })} className="text-xs font-medium text-brand-800 hover:underline disabled:opacity-40">+ New key</button>
                  <button
                    type="button"
                    disabled={newKey.isPending || !p.isActive}
                    onClick={() => window.confirm(`Generate a new key and email it to ${p.contactEmail}?`) && newKey.mutate({ p, email: true })}
                    className="text-xs font-medium text-brand-800 hover:underline disabled:opacity-40"
                  >
                    + New key, email it
                  </button>
                </div>
              </div>
              <ul className="divide-y divide-gray-100 text-sm">
                {p.keys.length === 0 && <li className="py-2 text-gray-400">No keys.</li>}
                {p.keys.map((k) => (
                  <li key={k.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div>
                      <code className="text-xs text-gray-700">{k.prefix}…</code>
                      <span className="ml-2 text-gray-600">{k.label}</span>
                      <span className={cn('ml-2 rounded-full px-2 py-0.5 text-xs', k.isActive ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500')}>
                        {k.revoked ? 'revoked' : k.isActive ? 'active' : 'expired'}
                      </span>
                      <div className="text-xs text-gray-400">created {when(k.createdAt)} · last used {when(k.lastUsedAt)}{k.expiresAt && ` · expires ${when(k.expiresAt)}`}</div>
                    </div>
                    {k.isActive && (
                      <button type="button" onClick={() => window.confirm(`Revoke key ${k.prefix}…? Anything using it stops working immediately.`) && revoke.mutate({ id: p.id, keyId: k.id })}
                        className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-red-600"><ShieldOff size={13} /> Revoke</button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ))}
      </div>

      {form && (
        <PartnerForm
          initial={form.partner}
          busy={create.isPending || update.isPending}
          error={formError}
          onClose={() => setForm(null)}
          onSave={(v) => (form.partner ? update.mutate({ id: form.partner.id, v }) : create.mutate(v))}
        />
      )}
      {revealed && <KeyReveal issued={revealed.issued} partner={revealed.partner} onClose={() => setRevealed(null)} />}
    </div>
  );
}
