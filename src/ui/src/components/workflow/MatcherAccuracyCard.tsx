import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Loader2, RefreshCw, Target } from 'lucide-react';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';

interface BacktestGroup {
  institutionId: number;
  institutionCode: string;
  institutionName: string;
  total: number;
  top1: number;
  top3: number;
  top1Rate: number;
  top3Rate: number;
}

interface BacktestResponse {
  method: string;
  total: number;
  top1: number;
  top3: number;
  top1Rate: number;
  top3Rate: number;
  byUniversity: BacktestGroup[];
  misses: { external: string; expected: string; got: string }[];
  missesTotal: number;
  generatedAt: string;
  cached: boolean;
}

const pct = (r: number) => `${Math.round(r * 100)}%`;

/**
 * Hold-out accuracy of the course matcher: for each past "equivalent" decision, can the matcher rediscover the
 * course evaluators chose within its top 1 / top 3? Measures the built-in rules matcher today.
 * EXTENSION POINT: once an Anthropic key exists, the server adds the AI matcher to the same test (see
 * backtest-scoring.ts `Matcher`) and this card gains a second column; nothing here calls a model.
 */
export default function MatcherAccuracyCard() {
  const qc = useQueryClient();
  const [showMisses, setShowMisses] = useState(false);
  const [running, setRunning] = useState(false);
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['ai-backtest'],
    queryFn: async () => (await api.get<BacktestResponse>('/ai-controls/backtest')).data,
    staleTime: 60_000,
    retry: false,
  });

  const run = async () => {
    setRunning(true);
    try {
      const res = await api.get<BacktestResponse>('/ai-controls/backtest', { params: { refresh: 'true' } });
      qc.setQueryData(['ai-backtest'], res.data);
    } finally {
      setRunning(false);
    }
  };

  const busy = isLoading || running;
  const msg = (error as { response?: { data?: { message?: string } } } | null)?.response?.data?.message;

  return (
    <div className="mb-6 rounded-xl border border-gray-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900"><Target size={16} /> Matcher accuracy</h3>
          <p className="mt-1 max-w-2xl text-xs text-gray-500">
            A hold-out test of the <strong>built-in rules matcher</strong>: each past "equivalent" decision is hidden, the matcher ranks the
            receiving university's catalogue for that external course, and we check whether the course evaluators really chose is in its top 1 or top 3.
            The AI matcher will be measured the same way once an Anthropic key is configured.
          </p>
        </div>
        <button type="button" onClick={() => void run()} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          {data ? 'Refresh' : 'Run'}
        </button>
      </div>

      {isError && <p className="mt-4 text-sm text-red-600">{msg ?? 'Could not run the accuracy test.'}</p>}
      {isLoading && <p className="mt-4 text-sm text-gray-400">Running the hold-out test…</p>}

      {data && data.total === 0 && <p className="mt-4 text-sm text-gray-500">No past "equivalent" decisions to test against yet.</p>}

      {data && data.total > 0 && (
        <>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-lg bg-brand-50 p-4 sm:col-span-1">
              <div className="text-xs font-medium text-gray-500">Top-3 hit rate</div>
              <div className="text-4xl font-bold text-brand-800">{pct(data.top3Rate)}</div>
              <div className="mt-0.5 text-xs text-gray-500">{data.top3} of {data.total} in the first three suggestions</div>
            </div>
            <div className="rounded-lg border border-gray-200 p-4">
              <div className="text-xs font-medium text-gray-500">Top-1 hit rate</div>
              <div className="text-2xl font-bold text-gray-900">{pct(data.top1Rate)}</div>
              <div className="mt-0.5 text-xs text-gray-500">{data.top1} of {data.total} as the first suggestion</div>
            </div>
            <div className="rounded-lg border border-gray-200 p-4">
              <div className="text-xs font-medium text-gray-500">Sample size</div>
              <div className="text-2xl font-bold text-gray-900">{data.total}</div>
              <div className="mt-0.5 text-xs text-gray-500">external courses with a past decision</div>
            </div>
          </div>

          <div className="mt-5 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
                  <th className="py-2 pr-3 font-medium">Receiving university</th>
                  <th className="py-2 pr-3 text-right font-medium">Cases</th>
                  <th className="py-2 pr-3 text-right font-medium">Top-1</th>
                  <th className="py-2 text-right font-medium">Top-3</th>
                </tr>
              </thead>
              <tbody>
                {data.byUniversity.map((g) => (
                  <tr key={g.institutionId} className="border-b border-gray-100">
                    <td className="py-2 pr-3 text-gray-800">{g.institutionName} <span className="text-xs text-gray-400">({g.institutionCode})</span></td>
                    <td className="py-2 pr-3 text-right text-gray-700">{g.total}</td>
                    <td className="py-2 pr-3 text-right text-gray-700">{pct(g.top1Rate)}</td>
                    <td className="py-2 text-right font-medium text-gray-900">{pct(g.top3Rate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {data.missesTotal > 0 && (
            <div className="mt-4">
              <button type="button" onClick={() => setShowMisses((v) => !v)} className="flex items-center gap-1 text-sm font-medium text-gray-700 hover:text-gray-900">
                {showMisses ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                Missed cases ({data.missesTotal}{data.missesTotal > data.misses.length ? `, showing ${data.misses.length}` : ''})
              </button>
              {showMisses && (
                <ul className="mt-2 divide-y divide-gray-100 rounded-lg border border-gray-200 text-sm">
                  {data.misses.map((m, i) => (
                    <li key={i} className="px-3 py-2">
                      <div className="font-medium text-gray-900">{m.external}</div>
                      <div className="mt-0.5 text-xs text-gray-600">Evaluators chose <span className="font-medium">{m.expected}</span></div>
                      <div className={cn('text-xs', 'text-gray-500')}>Matcher suggested {m.got}</div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <p className="mt-3 text-xs text-gray-400">
            Method: {data.method}. Run {new Date(data.generatedAt).toLocaleTimeString()}{data.cached ? ' (cached for up to 60 seconds)' : ''}.
          </p>
        </>
      )}
    </div>
  );
}
