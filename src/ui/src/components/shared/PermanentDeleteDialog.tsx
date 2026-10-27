import { useEffect, useState, type ReactNode } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { AlertTriangle, X } from 'lucide-react';
import { purgeApi, getErrorMessage, type PurgeEntity } from '../../lib/api';

interface Props {
  entity: PurgeEntity;
  id: number | string;
  /** Shown while the impact is loading. */
  fallbackLabel?: string;
  onClose: () => void;
  onDeleted: () => void;
}

/** Super-admin-only permanent delete with an impact preview. Callers must gate on role. */
export function PermanentDeleteDialog({ entity, id, fallbackLabel, onClose, onDeleted }: Props) {
  const [cascade, setCascade] = useState(false);
  const [confirm, setConfirm] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['purge-impact', entity, id, cascade],
    queryFn: async () => (await purgeApi.impact(entity, id, cascade)).data,
    staleTime: 0,
    gcTime: 0,
  });

  const del = useMutation({
    mutationFn: () => purgeApi.remove(entity, id, cascade),
    onSuccess: () => onDeleted(),
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !del.isPending && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, del.isPending]);

  const canDelete = !!data?.canDelete;
  const ready = canDelete && confirm === 'DELETE' && !del.isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={() => !del.isPending && onClose()}>
      <div className="my-8 w-full max-w-lg rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-gray-200 p-4 sm:p-5">
          <div className="min-w-0">
            <h2 className="font-semibold text-gray-900">Delete permanently</h2>
            <p className="mt-0.5 truncate text-sm text-gray-600">{data?.label ?? fallbackLabel ?? `#${id}`}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        <div className="space-y-4 p-4 sm:p-5">
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span><strong>This cannot be undone.</strong> The data is removed from the database for good.</span>
          </div>

          {entity === 'universities' && (
            <label className="flex items-start gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={cascade}
                onChange={(e) => { setCascade(e.target.checked); setConfirm(''); }}
                className="mt-0.5 rounded border-gray-300"
              />
              Also delete its programs, courses and topics (cascade)
            </label>
          )}

          {isLoading && <p className="py-4 text-center text-sm text-gray-400">Checking what this affects…</p>}
          {error && <p className="text-sm text-red-600">{getErrorMessage(error, 'Could not load the impact preview.')}</p>}

          {data && (
            <>
              {data.blockers.length > 0 && (
                <Section title="Blocked" tone="red">
                  {data.blockers.map((b, i) => (
                    <li key={i}>
                      <span className="font-medium">{b.count}</span> {b.label}
                      {b.hint && <span className="block text-xs text-gray-500">{b.hint}</span>}
                    </li>
                  ))}
                </Section>
              )}
              {canDelete && data.willDelete.length > 0 && (
                <Section title="What will be deleted" tone="red">
                  {data.willDelete.map((d, i) => (
                    <li key={i}><span className="font-medium">{d.count}</span> {d.label}</li>
                  ))}
                </Section>
              )}
              {canDelete && data.willDetach.length > 0 && (
                <Section title="Kept but unlinked" tone="gray">
                  {data.willDetach.map((d, i) => (
                    <li key={i}><span className="font-medium">{d.count}</span> {d.label}</li>
                  ))}
                </Section>
              )}
            </>
          )}

          {data && !canDelete && (
            <p className="text-sm text-gray-600">
              This item cannot be deleted while the blockers above exist. Use <strong>Deactivate</strong> instead to hide it without losing data.
            </p>
          )}

          {canDelete && (
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Type <span className="font-mono font-bold">DELETE</span> to confirm</label>
              <input
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="off"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
              />
            </div>
          )}

          {del.isError && <p className="text-sm text-red-600">{getErrorMessage(del.error, 'Delete failed.')}</p>}
        </div>

        <div className="flex gap-2 border-t border-gray-200 p-4 sm:p-5">
          <button onClick={onClose} disabled={del.isPending} className="flex-1 rounded-lg border border-gray-300 py-2 text-sm text-gray-600 hover:bg-gray-50">
            Cancel
          </button>
          <button
            onClick={() => del.mutate()}
            disabled={!ready}
            className="flex-1 rounded-lg bg-red-600 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-red-300"
          >
            {del.isPending ? 'Deleting…' : 'Delete permanently'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, tone, children }: { title: string; tone: 'red' | 'gray'; children: ReactNode }) {
  return (
    <div>
      <h3 className={`mb-1 text-xs font-semibold uppercase tracking-wide ${tone === 'red' ? 'text-red-700' : 'text-gray-500'}`}>{title}</h3>
      <ul className="space-y-1 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">{children}</ul>
    </div>
  );
}
