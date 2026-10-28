import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, CheckCircle, ChevronDown, ChevronRight, Mail, Plus, Power, PowerOff, Save, Search, Send, Trash2 } from 'lucide-react';
import { emailApi, type CustomEmailDraft, type CustomEmailTemplate, type EmailTemplateItem } from '../../lib/api';
import { BuiltinTemplateEditor } from './EmailTemplateEditor';

const errText = (e: unknown) => {
  const m = (e as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
  return m ? [m].flat().join(' ') : 'Request failed.';
};
const input = 'w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500';
const parseList = (t: string) => [...new Set(t.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean))];
const isEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

interface Row { key: string; kind: 'builtin' | 'custom'; id: string; name: string; audience: string; active: boolean; badge?: string }

function Pill({ on }: { on: boolean }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${on ? 'bg-green-100 text-green-800' : 'bg-gray-200 text-gray-600'}`}>{on ? 'Active' : 'Inactive'}</span>;
}

interface CForm { name: string; audience: string; subject: string; headline: string; body: string; ctaLabel: string; ctaUrl: string; enabled: boolean }
const EMPTY_C: CForm = { name: '', audience: 'Anyone', subject: '', headline: '', body: '', ctaLabel: '', ctaUrl: '', enabled: true };
const toForm = (t: CustomEmailTemplate): CForm => ({ name: t.name, audience: t.audience, subject: t.subject, headline: t.headline, body: t.paragraphs.join('\n\n'), ctaLabel: t.ctaLabel ?? '', ctaUrl: t.ctaUrl ?? '', enabled: t.enabled });
const toDraft = (f: CForm): CustomEmailDraft => ({
  name: f.name.trim(), audience: f.audience.trim(), subject: f.subject.trim(), headline: f.headline.trim(),
  paragraphs: f.body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean),
  ...(f.ctaLabel.trim() && f.ctaUrl.trim() ? { ctaLabel: f.ctaLabel.trim(), ctaUrl: f.ctaUrl.trim() } : {}),
  enabled: f.enabled,
});

/** Create / edit / send a custom template. `item` is null while creating a new one. */
function CustomTemplateEditor({ item, placeholders, to, onSaved, onDeleted, onCancel }: {
  item: CustomEmailTemplate | null; placeholders: string[]; to: string;
  onSaved: (t: CustomEmailTemplate) => void; onDeleted: () => void; onCancel: () => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState<CForm>(item ? toForm(item) : EMPTY_C);
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [recipients, setRecipients] = useState('');
  const [vars, setVars] = useState({ firstName: '', universityName: '' });
  const set = <K extends keyof CForm>(k: K, v: CForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const draft = useMemo(() => toDraft(form), [form]);
  const draftJson = JSON.stringify(draft);

  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      emailApi.customPreview(JSON.parse(draftJson)).then((r) => { if (live) setPreview(r.data); }).catch(() => { if (live) setPreview(null); });
    }, 350);
    return () => { live = false; clearTimeout(t); };
  }, [draftJson]);

  const refresh = () => { void qc.invalidateQueries({ queryKey: ['email-custom'] }); };
  const save = useMutation({
    mutationFn: () => (item ? emailApi.customUpdate(item.id, draft) : emailApi.customCreate(draft)),
    onSuccess: (r) => { setMsg({ ok: true, text: item ? 'Saved.' : 'Template created.' }); refresh(); onSaved(r.data); },
    onError: (e) => setMsg({ ok: false, text: errText(e) }),
  });
  const del = useMutation({
    mutationFn: () => emailApi.customDelete(item!.id),
    onSuccess: () => { refresh(); onDeleted(); },
    onError: (e) => setMsg({ ok: false, text: errText(e) }),
  });
  const test = useMutation({
    mutationFn: () => emailApi.customTest(draft, to.trim() || undefined),
    onSuccess: (r) => setMsg(r.data.ok ? { ok: true, text: 'Test sent (sample data).' } : { ok: false, text: `Not sent: ${r.data.error}` }),
    onError: (e) => setMsg({ ok: false, text: errText(e) }),
  });
  const list = parseList(recipients);
  const badTo = list.filter((e) => !isEmail(e));
  const send = useMutation({
    mutationFn: () => emailApi.customSend(item!.id, list, { ...(vars.firstName ? { firstName: vars.firstName } : {}), ...(vars.universityName ? { universityName: vars.universityName } : {}) }),
    onSuccess: (r) => {
      const failed = r.data.results.filter((x) => !x.ok);
      setMsg(failed.length ? { ok: false, text: `Sent ${r.data.sent}, failed ${failed.length}: ${failed.map((f) => `${f.to} (${f.error})`).join('; ')}` } : { ok: true, text: `Sent to ${r.data.sent} recipient${r.data.sent === 1 ? '' : 's'}.` });
    },
    onError: (e) => setMsg({ ok: false, text: errText(e) }),
  });

  const valid = !!form.name.trim() && !!form.subject.trim() && !!form.headline.trim() && draft.paragraphs!.length > 0 && !(form.ctaLabel.trim() && !form.ctaUrl.trim());
  return (
    <div className="grid gap-0 lg:grid-cols-[1fr_1fr]">
      <div className="space-y-3 border-b border-gray-100 p-4 lg:border-b-0 lg:border-r">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm"><span className="mb-1 block text-xs font-medium text-gray-600">Template name *</span>
            <input value={form.name} onChange={(e) => set('name', e.target.value)} maxLength={100} placeholder="Welcome to the pilot" className={input} /></label>
          <label className="block text-sm"><span className="mb-1 block text-xs font-medium text-gray-600">Audience (who it is for)</span>
            <input value={form.audience} onChange={(e) => set('audience', e.target.value)} maxLength={60} placeholder="Partner contacts" className={input} /></label>
        </div>
        <label className="block text-sm"><span className="mb-1 block text-xs font-medium text-gray-600">Subject *</span>
          <input value={form.subject} onChange={(e) => set('subject', e.target.value)} maxLength={200} className={input} /></label>
        <label className="block text-sm"><span className="mb-1 block text-xs font-medium text-gray-600">Headline *</span>
          <input value={form.headline} onChange={(e) => set('headline', e.target.value)} maxLength={200} className={input} /></label>
        <label className="block text-sm"><span className="mb-1 block text-xs font-medium text-gray-600">Body * (separate paragraphs with a blank line)</span>
          <textarea value={form.body} onChange={(e) => set('body', e.target.value)} rows={7} className={input} /></label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm"><span className="mb-1 block text-xs font-medium text-gray-600">Button label (optional)</span>
            <input value={form.ctaLabel} onChange={(e) => set('ctaLabel', e.target.value)} maxLength={60} placeholder="Open TransferHub" className={input} /></label>
          <label className="block text-sm"><span className="mb-1 block text-xs font-medium text-gray-600">Button link</span>
            <input value={form.ctaUrl} onChange={(e) => set('ctaUrl', e.target.value)} maxLength={500} placeholder="/login or https://…" className={input} /></label>
        </div>
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600">
          <p className="mb-1 font-medium text-gray-700">Placeholders</p>
          <p className="flex flex-wrap gap-1">{placeholders.map((p) => <code key={p} className="rounded bg-white px-1.5 py-0.5 text-[11px] text-gray-800 ring-1 ring-gray-200">{`{{${p}}}`}</code>)}</p>
          <p className="mt-1.5">Use them in any field, e.g. <code>{'Hello {{firstName}}'}</code>. They are filled in when you send. A greeting line is added only if a first name is given.</p>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={form.enabled} onChange={(e) => set('enabled', e.target.checked)} /> Active (inactive templates cannot be sent)
        </label>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button type="button" onClick={() => save.mutate()} disabled={save.isPending || !valid}
            className="flex items-center gap-1.5 rounded-lg bg-brand-800 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-900 disabled:bg-brand-400">
            <Save size={14} />{save.isPending ? 'Saving…' : item ? 'Save' : 'Create template'}
          </button>
          <button type="button" onClick={() => test.mutate()} disabled={test.isPending || !valid}
            className="flex items-center gap-1.5 rounded-lg border border-brand-800 px-3 py-1.5 text-sm font-medium text-brand-800 hover:bg-brand-50 disabled:opacity-50">
            <Send size={14} />{test.isPending ? 'Sending…' : `Send test to ${to || 'me'}`}
          </button>
          {!item && <button type="button" onClick={onCancel} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">Cancel</button>}
          {item && (
            <button type="button" disabled={del.isPending} onClick={() => { if (window.confirm(`Delete the template "${item.name}"? This cannot be undone.`)) del.mutate(); }}
              className="flex items-center gap-1.5 rounded-lg border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-40">
              <Trash2 size={14} />Delete
            </button>
          )}
        </div>

        {item && (
          <div className="space-y-2 rounded-lg border border-gray-200 p-3">
            <p className="text-sm font-medium text-gray-800">Send this template</p>
            <textarea value={recipients} onChange={(e) => setRecipients(e.target.value)} rows={2} placeholder="Recipient e-mail addresses, separated by commas (up to 25)" className={input} />
            {badTo.length > 0 && <p className="text-xs text-red-600">Not a valid address: {badTo.join(', ')}</p>}
            <div className="grid gap-2 sm:grid-cols-2">
              <input value={vars.firstName} onChange={(e) => setVars((v) => ({ ...v, firstName: e.target.value }))} placeholder="{{firstName}} for everyone (optional)" className={input} />
              <input value={vars.universityName} onChange={(e) => setVars((v) => ({ ...v, universityName: e.target.value }))} placeholder="{{universityName}} (optional)" className={input} />
            </div>
            <button type="button" disabled={send.isPending || !list.length || badTo.length > 0 || list.length > 25 || !item.enabled}
              onClick={() => { if (window.confirm(`Send "${item.name}" to ${list.length} recipient${list.length === 1 ? '' : 's'}?`)) send.mutate(); }}
              className="flex items-center gap-1.5 rounded-lg bg-brand-800 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-900 disabled:bg-brand-400">
              <Send size={14} />{send.isPending ? 'Sending…' : `Send to ${list.length || 'recipients'}`}
            </button>
            {!item.enabled && <p className="text-xs text-amber-700">This template is inactive: activate it to send.</p>}
            <p className="text-xs text-gray-500">Saved changes are what gets sent. Save first if you edited the text above.</p>
          </div>
        )}
        {msg && (
          <p className={`flex items-start gap-1.5 rounded-lg p-2 text-sm ${msg.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
            {msg.ok ? <CheckCircle size={14} className="mt-0.5 shrink-0" /> : <AlertCircle size={14} className="mt-0.5 shrink-0" />}{msg.text}
          </p>
        )}
      </div>
      <div className="min-w-0 p-4">
        <p className="mb-2 truncate text-sm text-gray-600"><span className="text-gray-400">Subject:</span> {preview?.subject ?? form.subject}</p>
        {preview ? <iframe title="Template preview" srcDoc={preview.html} sandbox="" className="h-[680px] w-full rounded-lg border border-gray-200 bg-white" /> : <p className="text-sm text-gray-400">Fill in the subject, headline and body to see the preview.</p>}
      </div>
    </div>
  );
}

export function EmailTemplateManager({ to }: { to: string }) {
  const qc = useQueryClient();
  const overrides = useQuery({ queryKey: ['email-overrides'], queryFn: () => emailApi.overrides() });
  const customQ = useQuery({ queryKey: ['email-custom'], queryFn: () => emailApi.customList() });
  const items: EmailTemplateItem[] = overrides.data?.data.items ?? [];
  const customs: CustomEmailTemplate[] = customQ.data?.data.items ?? [];
  const ready = overrides.data?.data.ready ?? true;

  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const rows: Row[] = useMemo(() => [
    ...customs.map((c): Row => ({ key: `c:${c.id}`, kind: 'custom', id: c.id, name: c.name, audience: c.audience, active: c.enabled, badge: 'Custom' })),
    ...items.map((i): Row => ({ key: `b:${i.key}`, kind: 'builtin', id: i.key, name: i.name, audience: i.audience, active: i.override?.enabled !== false, badge: i.override ? 'Edited' : undefined })),
  ], [customs, items]);
  const shown = rows.filter((r) => !q.trim() || `${r.name} ${r.audience}`.toLowerCase().includes(q.trim().toLowerCase()));
  const allShown = shown.length > 0 && shown.every((r) => sel.has(r.key));
  const toggleSel = (k: string) => setSel((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });

  const bulk = useMutation({
    mutationFn: (action: 'activate' | 'deactivate' | 'delete') => {
      const picked = rows.filter((r) => sel.has(r.key));
      return emailApi.bulk(picked.filter((r) => r.kind === 'builtin').map((r) => r.id), picked.filter((r) => r.kind === 'custom').map((r) => r.id), action);
    },
    onSuccess: (r, action) => {
      const verb = action === 'activate' ? 'activated' : action === 'deactivate' ? 'deactivated' : 'deleted / reset';
      const sk = r.data.skipped;
      setNote({ ok: sk.length === 0, text: `${r.data.done} template${r.data.done === 1 ? '' : 's'} ${verb}.${sk.length ? ` Skipped ${sk.length}: ${sk.map((s) => `${s.id} (${s.reason})`).join('; ')}` : ''}` });
      setSel(new Set());
      void qc.invalidateQueries({ queryKey: ['email-overrides'] });
      void qc.invalidateQueries({ queryKey: ['email-custom'] });
      void qc.invalidateQueries({ queryKey: ['email-templates'] });
    },
    onError: (e) => setNote({ ok: false, text: errText(e) }),
  });
  const run = (action: 'activate' | 'deactivate' | 'delete') => {
    const picked = rows.filter((r) => sel.has(r.key));
    if (action === 'delete') {
      const nCustom = picked.filter((r) => r.kind === 'custom').length;
      const nBuiltin = picked.length - nCustom;
      const msg = `Delete ${nCustom} custom template${nCustom === 1 ? '' : 's'} permanently` + (nBuiltin ? ` and reset ${nBuiltin} built-in template${nBuiltin === 1 ? '' : 's'} to their default text (built-ins cannot be deleted)` : '') + '?';
      if (!window.confirm(msg)) return;
    }
    setNote(null);
    bulk.mutate(action);
  };

  return (
    <section className="rounded-xl border border-gray-200 bg-white lg:col-span-2">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 px-4 py-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900"><Mail size={15} /> Email templates</h2>
          <p className="text-xs text-gray-500">
            Open a template to change its subject, headline, body, button and CC, or switch it off. Create your own templates and send them by hand.
            Built-in emails keep their layout and cannot be deleted; sign-in and access emails cannot be switched off.
          </p>
        </div>
        <button type="button" onClick={() => { setCreating(true); setOpen(null); }}
          className="flex items-center gap-1.5 rounded-lg bg-brand-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-900"><Plus size={14} />New template</button>
      </header>

      <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-4 py-2">
        <div className="relative min-w-[12rem] flex-1">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search templates" className="w-full rounded-lg border border-gray-300 py-1.5 pl-8 pr-3 text-sm" />
        </div>
        {sel.size > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-gray-700">{sel.size} selected</span>
            <button type="button" disabled={bulk.isPending} onClick={() => run('activate')} className="flex items-center gap-1 rounded-lg border border-green-300 px-2.5 py-1 text-sm text-green-700 hover:bg-green-50 disabled:opacity-50"><Power size={13} />Activate</button>
            <button type="button" disabled={bulk.isPending} onClick={() => run('deactivate')} className="flex items-center gap-1 rounded-lg border border-gray-300 px-2.5 py-1 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"><PowerOff size={13} />Deactivate</button>
            <button type="button" disabled={bulk.isPending} onClick={() => run('delete')} className="flex items-center gap-1 rounded-lg border border-red-300 px-2.5 py-1 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"><Trash2 size={13} />Delete</button>
            <button type="button" onClick={() => setSel(new Set())} className="text-sm text-gray-500 underline">Clear</button>
          </div>
        )}
      </div>
      {note && <p className={`mx-4 mt-3 flex items-start gap-1.5 rounded-lg p-2 text-sm ${note.ok ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-800'}`}>
        {note.ok ? <CheckCircle size={14} className="mt-0.5 shrink-0" /> : <AlertCircle size={14} className="mt-0.5 shrink-0" />}{note.text}</p>}
      {!ready && <p className="mx-4 mt-3 rounded-lg bg-amber-50 p-2 text-sm text-amber-800">Saving needs migration 023 (AppSettings) to be applied. You can still preview.</p>}

      {creating && (
        <div className="m-4 rounded-lg border border-brand-200 bg-brand-50/30">
          <div className="border-b border-brand-100 px-4 py-2 text-sm font-semibold text-brand-900">New template</div>
          <CustomTemplateEditor item={null} placeholders={customQ.data?.data.placeholders ?? []} to={to}
            onSaved={(t) => { setCreating(false); setOpen(`c:${t.id}`); }} onDeleted={() => undefined} onCancel={() => setCreating(false)} />
        </div>
      )}

      <div className="px-2 py-2">
        <div className="hidden grid-cols-[2rem_1fr_12rem_6rem_2rem] items-center gap-2 px-2 pb-1 text-xs font-medium uppercase tracking-wide text-gray-400 sm:grid">
          <input type="checkbox" aria-label="Select all shown" checked={allShown} onChange={() => setSel((s) => { const n = new Set(s); shown.forEach((r) => (allShown ? n.delete(r.key) : n.add(r.key))); return n; })} />
          <span>Template</span><span>For</span><span>Status</span><span />
        </div>
        {(overrides.isLoading || customQ.isLoading) && <p className="px-3 py-3 text-sm text-gray-400">Loading…</p>}
        {(overrides.isError) && <p className="px-3 py-3 text-sm text-red-600">Could not load the templates.</p>}
        {shown.map((r) => {
          const isOpen = open === r.key;
          const bItem = r.kind === 'builtin' ? items.find((i) => i.key === r.id) : undefined;
          const cItem = r.kind === 'custom' ? customs.find((c) => c.id === r.id) : undefined;
          return (
            <div key={r.key} className={`mb-1 rounded-lg border ${isOpen ? 'border-brand-200 bg-white' : 'border-gray-100'}`}>
              <div className={`grid grid-cols-[2rem_1fr_auto_2rem] items-center gap-2 px-2 py-2 sm:grid-cols-[2rem_1fr_12rem_6rem_2rem] ${isOpen ? 'bg-brand-50/40' : 'hover:bg-gray-50'}`}>
                <input type="checkbox" aria-label={`Select ${r.name}`} checked={sel.has(r.key)} onChange={() => toggleSel(r.key)} />
                <button type="button" onClick={() => { setOpen(isOpen ? null : r.key); setCreating(false); }} className="min-w-0 text-left" aria-expanded={isOpen}>
                  <span className="text-sm font-medium text-gray-900">{r.name}</span>
                  {r.badge && <span className={`ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${r.badge === 'Custom' ? 'bg-indigo-100 text-indigo-700' : 'bg-amber-100 text-amber-800'}`}>{r.badge}</span>}
                  <span className="block text-xs text-gray-500 sm:hidden">to {r.audience}</span>
                </button>
                <span className="hidden truncate text-sm text-gray-600 sm:block">{r.audience}</span>
                <Pill on={r.active} />
                <button type="button" onClick={() => { setOpen(isOpen ? null : r.key); setCreating(false); }} aria-label={isOpen ? 'Collapse' : 'Expand'} className="text-gray-400 hover:text-brand-800">
                  {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                </button>
              </div>
              {isOpen && (
                <div className="border-t border-gray-100">
                  {bItem && <BuiltinTemplateEditor item={bItem} to={to} ready={ready} />}
                  {cItem && <CustomTemplateEditor key={`${cItem.id}-${cItem.enabled}`} item={cItem} placeholders={customQ.data?.data.placeholders ?? []} to={to}
                    onSaved={() => undefined} onDeleted={() => setOpen(null)} onCancel={() => undefined} />}
                </div>
              )}
            </div>
          );
        })}
        {!shown.length && !overrides.isLoading && <p className="px-3 py-3 text-sm text-gray-400">No templates match.</p>}
      </div>
    </section>
  );
}
