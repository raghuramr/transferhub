import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, Search, ShieldQuestion } from 'lucide-react';
import { coursesApi, verificationApi, getErrorMessage } from '../../lib/api';
import { useAuthStore } from '../../store/auth';

interface Institution { id: number; code: string; name: string; isBU: boolean }
interface CourseHit { id: number; code: string; title: string; institutionCode: string; credits: number; verified: string | null }
interface Request {
  id: number;
  courseCode: string;
  courseTitle: string;
  institutionCode: string;
  reason: string;
  status: 'open' | 'verified' | 'rejected';
  raisedBy: string;
  createdAt: string;
  resolvedBy: string | null;
  resolutionNote: string | null;
}

const STATUS: Record<Request['status'], string> = {
  open: 'bg-amber-100 text-amber-700',
  verified: 'bg-green-100 text-green-700',
  rejected: 'bg-gray-100 text-gray-600',
};
const inputCls = 'w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500';

/** Faculty raise a course for verification; admins review and resolve the requests. */
export default function VerificationRequests() {
  const qc = useQueryClient();
  const role = useAuthStore((s) => s.user?.role);
  const isAdmin = role === 'admin' || role === 'super_admin';
  const [instId, setInstId] = useState('');
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<CourseHit | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [notes, setNotes] = useState<Record<number, string>>({});

  const institutions = useQuery({ queryKey: ['course-institutions'], queryFn: () => coursesApi.institutions() });
  const instList = (institutions.data?.data as Institution[]) ?? [];
  const selected = instList.find((i) => String(i.id) === instId);

  const hits = useQuery({
    queryKey: ['verify-course-search', instId, q],
    enabled: q.trim().length >= 2,
    queryFn: () => coursesApi.search(q.trim(), selected && !selected.isBU ? selected.code : undefined),
  });
  const results = ((hits.data?.data as CourseHit[]) ?? []).slice(0, 8);

  const list = useQuery({ queryKey: ['verification-requests'], queryFn: () => verificationApi.list() });
  const requests = (list.data?.data as Request[]) ?? [];

  const raise = useMutation({
    mutationFn: () => verificationApi.raise(picked!.id, reason),
    onSuccess: () => {
      setPicked(null);
      setReason('');
      setQ('');
      setError('');
      qc.invalidateQueries({ queryKey: ['verification-requests'] });
    },
    onError: (e) => setError(getErrorMessage(e, 'Could not raise the request')),
  });

  const resolve = useMutation({
    mutationFn: ({ id, status }: { id: number; status: 'verified' | 'rejected' }) => verificationApi.resolve(id, status, notes[id]),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['verification-requests'] }),
    onError: (e) => setError(getErrorMessage(e, 'Could not update the request')),
  });

  return (
    <div className="p-4 sm:p-8 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-2">
        <ShieldQuestion className="text-brand-800" size={24} />
        <h1 className="text-2xl font-bold text-gray-900">Course verification</h1>
      </div>
      <p className="mb-6 text-sm text-gray-500">
        Spotted a course whose credits, title or description look wrong? Raise it here. The course is flagged &quot;Check&quot; in the catalogue until an administrator verifies it.
      </p>

      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <div className="mb-8 space-y-3 rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="font-semibold text-gray-900">Raise a request</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <select className={inputCls} value={instId} onChange={(e) => { setInstId(e.target.value); setPicked(null); }}>
            <option value="">Home university (BU)</option>
            {instList.filter((i) => !i.isBU).map((i) => <option key={i.id} value={i.id}>{i.code} - {i.name}</option>)}
          </select>
          <div className="relative sm:col-span-2">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input className={`${inputCls} pl-9`} placeholder="Search course code or title…" value={q} onChange={(e) => { setQ(e.target.value); setPicked(null); }} />
          </div>
        </div>
        {!picked && results.length > 0 && (
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
            {results.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => setPicked(c)} className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-gray-50">
                  <span><span className="font-medium">{c.code}</span> <span className="text-gray-500">{c.title}</span></span>
                  <span className="shrink-0 text-xs text-gray-400">{c.credits} cr</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {picked && (
          <>
            <div className="rounded-lg bg-brand-50 p-3 text-sm text-brand-900">
              <strong>{picked.code}</strong> {picked.title}
            </div>
            <textarea className={inputCls} rows={3} placeholder="What needs verifying? e.g. credits should be 3, not 4" value={reason} onChange={(e) => setReason(e.target.value)} />
            <button
              onClick={() => raise.mutate()}
              disabled={raise.isPending || reason.trim().length < 5}
              className="rounded-lg bg-brand-800 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-900 disabled:bg-brand-400"
            >
              {raise.isPending ? 'Sending…' : 'Raise for verification'}
            </button>
          </>
        )}
      </div>

      <h2 className="mb-3 font-semibold text-gray-900">{isAdmin ? 'All requests' : 'My requests'}</h2>
      {list.isLoading && <p className="text-sm text-gray-400">Loading…</p>}
      {!list.isLoading && requests.length === 0 && <p className="text-sm text-gray-400">Nothing raised yet.</p>}
      <div className="space-y-3">
        {requests.map((r) => (
          <div key={r.id} className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-gray-900">{r.institutionCode} {r.courseCode}</span>
              <span className="text-gray-500">{r.courseTitle}</span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS[r.status]}`}>{r.status}</span>
            </div>
            <p className="mt-1 text-sm text-gray-700">{r.reason}</p>
            <p className="mt-1 text-xs text-gray-400">Raised by {r.raisedBy} on {new Date(r.createdAt).toLocaleDateString()}{r.resolvedBy ? ` · resolved by ${r.resolvedBy}` : ''}</p>
            {r.resolutionNote && <p className="mt-1 text-xs text-gray-500">Note: {r.resolutionNote}</p>}
            {isAdmin && r.status === 'open' && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input className={`${inputCls} flex-1 min-w-[12rem]`} placeholder="Note (optional)" value={notes[r.id] ?? ''} onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))} />
                <button onClick={() => resolve.mutate({ id: r.id, status: 'verified' })} className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700"><BadgeCheck size={15} /> Mark verified</button>
                <button onClick={() => resolve.mutate({ id: r.id, status: 'rejected' })} className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50">Dismiss</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
