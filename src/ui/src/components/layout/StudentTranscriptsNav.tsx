import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, FileText } from 'lucide-react';
import { transcriptsApi } from '../../lib/api';
import type { TranscriptSummary } from '../../types';

/** Short status text + chip colour for a request, used in the sidebar and anywhere a compact status is needed. */
export function requestStatus(t: Pick<TranscriptSummary, 'status' | 'currentStage'>): { label: string; cls: string } {
  if (t.status === 'cancelled') return { label: 'Cancelled', cls: 'bg-gray-100 text-gray-500' };
  if (t.status === 'complete') return { label: 'Complete', cls: 'bg-emerald-50 text-emerald-700' };
  if (t.currentStage) return { label: t.currentStage, cls: 'bg-brand-50 text-brand-800' };
  return { label: t.status === 'processing' ? 'In review' : 'Received', cls: 'bg-amber-50 text-amber-700' };
}

/** Student sidebar section: every transcript request with its status, foldable. */
export function StudentTranscriptsNav() {
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem('th.nav.transcripts') !== '0'; } catch { return true; }
  });
  const toggle = () => setOpen((o) => {
    try { localStorage.setItem('th.nav.transcripts', o ? '0' : '1'); } catch { /* ignore */ }
    return !o;
  });
  const { data } = useQuery({ queryKey: ['transcripts'], queryFn: async () => (await transcriptsApi.list()).data, staleTime: 30_000 });
  const rows = data ?? [];
  if (!rows.length) return null;
  const active = rows.filter((r) => r.status !== 'cancelled' && r.status !== 'complete').length;

  return (
    <div>
      <button type="button" onClick={toggle} aria-expanded={open}
        className="flex w-full items-center justify-between px-3 pt-4 pb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400 hover:text-brand-800">
        <span>My transcripts <span className="font-normal normal-case text-gray-400">({rows.length}{active ? `, ${active} open` : ''})</span></span>
        <ChevronDown size={13} className={`transition-transform ${open ? '' : '-rotate-90'}`} />
      </button>
      {open && (
        <ul className="space-y-0.5">
          {rows.map((t) => {
            const st = requestStatus(t);
            return (
              <li key={t.id}>
                <NavLink to={`/student/transcript/${t.id}`}
                  className={({ isActive }) => `flex items-start gap-2 rounded-lg px-3 py-2 text-xs transition-colors ${isActive ? 'bg-brand-50' : 'hover:bg-gray-50'}`}>
                  <FileText size={15} className="mt-0.5 shrink-0 text-gray-400" />
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate font-medium ${t.status === 'cancelled' ? 'text-gray-400 line-through' : 'text-gray-800'}`}>
                      {t.institution?.name ?? 'Transcript'}{t.targetInstitutionName ? ` → ${t.targetInstitutionName}` : ''}
                    </span>
                    <span className="mt-0.5 flex items-center gap-1.5">
                      <span className={`max-w-full truncate rounded-full px-1.5 py-0.5 text-[10px] font-medium ${st.cls}`}>{st.label}</span>
                      <span className="text-[10px] text-gray-400">{new Date(t.receivedAt).toLocaleDateString()}</span>
                    </span>
                  </span>
                </NavLink>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
