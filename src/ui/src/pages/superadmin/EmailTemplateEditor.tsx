import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, CheckCircle, RotateCcw, Save, Send } from 'lucide-react';
import { emailApi, type EmailTemplateItem, type EmailTemplateOverride } from '../../lib/api';

interface Form {
  subject: string;
  headline: string;
  paragraphs: string; // blank-line separated
  ctaLabel: string;
  enabled: boolean;
  cc: string; // comma / space / newline separated
}

const EMPTY: Form = { subject: '', headline: '', paragraphs: '', ctaLabel: '', enabled: true, cc: '' };

const fromOverride = (o: EmailTemplateOverride | null): Form =>
  o ? {
    subject: o.subject ?? '', headline: o.headline ?? '', paragraphs: (o.paragraphs ?? []).join('\n\n'),
    ctaLabel: o.ctaLabel ?? '', enabled: o.enabled !== false, cc: (o.cc ?? []).join(', '),
  } : EMPTY;

const parseCc = (t: string) => [...new Set(t.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean))];

const toDraft = (f: Form): EmailTemplateOverride => ({
  subject: f.subject.trim(),
  headline: f.headline.trim(),
  paragraphs: f.paragraphs.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean),
  ctaLabel: f.ctaLabel.trim(),
  enabled: f.enabled,
  cc: parseCc(f.cc),
});

const errText = (e: unknown) => {
  const m = (e as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
  return m ? [m].flat().join(' ') : 'Request failed.';
};

const input = 'w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500';

/** Editor for one built-in template, shown inside its expanded row in the template list. */
export function BuiltinTemplateEditor({ item, to, ready }: { item: EmailTemplateItem; to: string; ready: boolean }) {
  const qc = useQueryClient();
  const cur = item;
  const [form, setForm] = useState<Form>(EMPTY);
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Load the form when the selected template (or its stored override) changes.
  const stored = cur?.override ?? null;
  useEffect(() => {
    setForm(fromOverride(stored));
    setMsg(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur?.key, JSON.stringify(stored)]);

  const draft = useMemo(() => toDraft(form), [form]);
  const draftJson = JSON.stringify(draft);

  // Live preview, debounced.
  useEffect(() => {
    if (!cur) return;
    let live = true;
    const t = setTimeout(() => {
      emailApi.previewOverride(cur.key, JSON.parse(draftJson)).then((r) => { if (live) setPreview(r.data); }).catch(() => { if (live) setPreview(null); });
    }, 350);
    return () => { live = false; clearTimeout(t); };
  }, [cur?.key, draftJson]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: () => emailApi.saveOverride(cur!.key, draft),
    onSuccess: () => { setMsg({ ok: true, text: 'Saved. New emails use this text straight away (other servers within a minute).' }); void qc.invalidateQueries({ queryKey: ['email-overrides'] }); void qc.invalidateQueries({ queryKey: ['email-templates'] }); },
    onError: (e) => setMsg({ ok: false, text: errText(e) }),
  });
  const reset = useMutation({
    mutationFn: () => emailApi.resetOverride(cur!.key),
    onSuccess: () => { setForm(EMPTY); setMsg({ ok: true, text: 'Reset to the default text.' }); void qc.invalidateQueries({ queryKey: ['email-overrides'] }); void qc.invalidateQueries({ queryKey: ['email-templates'] }); },
    onError: (e) => setMsg({ ok: false, text: errText(e) }),
  });
  const test = useMutation({
    mutationFn: () => emailApi.testOverride(cur!.key, draft, to.trim() || undefined),
    onError: (e) => setMsg({ ok: false, text: errText(e) }),
  });

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const badCc = parseCc(form.cc).filter((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  const d = cur?.defaults;

  return (
    <div>
      {!ready && <p className="mx-4 mt-3 rounded-lg bg-amber-50 p-2 text-sm text-amber-800">Saving needs migration 023 (AppSettings) to be applied. You can still preview.</p>}
      {cur && d && (
        <div className="grid gap-0 lg:grid-cols-[1fr_1fr]">
          <div className="space-y-3 border-b border-gray-100 p-4 lg:border-b-0 lg:border-r">
            <label className="block text-sm">
              <span className="mb-1 block text-xs font-medium text-gray-600">Subject</span>
              <input value={form.subject} onChange={(e) => set('subject', e.target.value)} placeholder={d.subject} maxLength={200} className={input} />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-xs font-medium text-gray-600">Headline</span>
              <input value={form.headline} onChange={(e) => set('headline', e.target.value)} placeholder={d.headline} maxLength={200} className={input} />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-xs font-medium text-gray-600">Body (separate paragraphs with a blank line)</span>
              <textarea value={form.paragraphs} onChange={(e) => set('paragraphs', e.target.value)} rows={6} placeholder={d.paragraphs.join('\n\n')} className={input} />
            </label>
            {d.hasCta && (
              <label className="block text-sm">
                <span className="mb-1 block text-xs font-medium text-gray-600">Button label</span>
                <input value={form.ctaLabel} onChange={(e) => set('ctaLabel', e.target.value)} placeholder={d.ctaLabel} maxLength={60} className={input} />
              </label>
            )}
            <p className="text-xs text-gray-500">
              The greyed text shown in empty fields is the built-in wording with sample data filled in.
              {' '}
              <button type="button" className="text-brand-800 underline"
                onClick={() => setForm((f) => ({ ...f, subject: f.subject || d.subject, headline: f.headline || d.headline, paragraphs: f.paragraphs || d.paragraphs.join('\n\n'), ctaLabel: f.ctaLabel || d.ctaLabel }))}>
                Copy it into the fields to edit
              </button>
            </p>

            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600">
              <p className="mb-1 font-medium text-gray-700">Placeholders for this email</p>
              <p className="flex flex-wrap gap-1">
                {d.placeholders.map((p) => (
                  <code key={p} className="rounded bg-white px-1.5 py-0.5 text-[11px] text-gray-800 ring-1 ring-gray-200">{`{{${p}}}`}</code>
                ))}
              </p>
              <p className="mt-1.5">Use them in the subject, headline, body or button, e.g. <code>{'Hello {{firstName}}'}</code>. A placeholder that does not exist shows as empty.</p>
            </div>

            <label className="block text-sm">
              <span className="mb-1 block text-xs font-medium text-gray-600">Also copy (CC) these addresses on every send of this email</span>
              <input value={form.cc} onChange={(e) => set('cc', e.target.value)} placeholder="registrar@example.edu, dean@example.edu" className={input} />
              {badCc.length > 0 && <span className="mt-1 block text-xs text-red-600">Not a valid address: {badCc.join(', ')}</span>}
              <span className="mt-1 block text-xs text-gray-500">Up to 10. Everyone in the CC line can see the recipient&apos;s address, so use this mainly for staff-facing emails.</span>
            </label>

            {cur.canDisable ? (
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={form.enabled} onChange={(e) => set('enabled', e.target.checked)} />
                Send this email (untick to switch it off)
              </label>
            ) : (
              <p className="text-xs text-gray-500">This email carries a sign-in, security or access detail, so it can be reworded but never switched off.</p>
            )}

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button type="button" onClick={() => save.mutate()} disabled={save.isPending || badCc.length > 0 || !ready}
                className="flex items-center gap-1.5 rounded-lg bg-brand-800 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-900 disabled:bg-brand-400">
                <Save size={14} />{save.isPending ? 'Saving…' : 'Save'}
              </button>
              <button type="button" onClick={() => test.mutate()} disabled={test.isPending}
                className="flex items-center gap-1.5 rounded-lg border border-brand-800 px-3 py-1.5 text-sm font-medium text-brand-800 hover:bg-brand-50 disabled:opacity-50">
                <Send size={14} />{test.isPending ? 'Sending…' : `Send test to ${to || 'me'}`}
              </button>
              <button type="button" disabled={reset.isPending || !cur.override}
                onClick={() => { if (window.confirm('Reset this email to the built-in text, switch-on state and no CC?')) reset.mutate(); }}
                className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40">
                <RotateCcw size={14} />Reset to default
              </button>
            </div>
            {msg && (
              <p className={`flex items-start gap-1.5 rounded-lg p-2 text-sm ${msg.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                {msg.ok ? <CheckCircle size={14} className="mt-0.5 shrink-0" /> : <AlertCircle size={14} className="mt-0.5 shrink-0" />}{msg.text}
              </p>
            )}
            {test.data && (
              <p className={`rounded-lg p-2 text-sm ${test.data.data.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                {test.data.data.ok ? 'Test sent (sample data).' : `Not sent: ${test.data.data.error}`}
              </p>
            )}
          </div>

          <div className="min-w-0 p-4">
            <p className="mb-2 truncate text-sm text-gray-600"><span className="text-gray-400">Subject:</span> {preview?.subject ?? d.subject}</p>
            {!form.enabled && cur.canDisable && <p className="mb-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-800">Switched off: this email will not be sent (the preview still shows what it looks like).</p>}
            {preview
              ? <iframe title={`${cur.name} preview`} srcDoc={preview.html} sandbox="" className="h-[680px] w-full rounded-lg border border-gray-200 bg-white" />
              : <p className="text-sm text-gray-400">Loading preview…</p>}
          </div>
        </div>
      )}
    </div>
  );
}
