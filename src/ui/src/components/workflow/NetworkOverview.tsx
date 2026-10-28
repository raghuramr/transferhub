import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import { Loader2 } from 'lucide-react';
import { networkApi } from '../../lib/api-network';
import { AgreementChip } from './NetworkBits';
import { useAuthStore } from '../../store/auth';

function Card({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">{label}</p>
      <p className="mt-1 text-2xl font-bold text-gray-900">{value}</p>
      {sub && <p className="text-xs text-gray-500">{sub}</p>}
    </div>
  );
}

/** Equivalencies > Network: anonymised overview of the shared equivalency data, and the switch for the confidence boost. */
export default function NetworkOverview() {
  const qc = useQueryClient();
  const role = useAuthStore((s) => s.user?.role);
  const { data, isLoading, error } = useQuery({ queryKey: ['network-summary'], queryFn: async () => (await networkApi.summary()).data, retry: false });
  const settings = useQuery({ queryKey: ['network-settings'], queryFn: async () => (await networkApi.settings()).data, retry: false });
  const toggle = useMutation({
    mutationFn: (v: boolean) => networkApi.saveSettings(v),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['network-settings'] }); void qc.invalidateQueries({ queryKey: ['network-summary'] }); },
  });
  const isSuper = role === 'super_admin';
  const on = settings.data?.boostEnabled ?? false;

  if (isLoading) return <div className="flex items-center gap-2 p-6 text-sm text-gray-500"><Loader2 size={14} className="animate-spin" /> Loading the network…</div>;
  if (error || !data) return <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">Could not load the network overview.</div>;

  const growthTotal = data.growth.reduce((n, g) => n + g.count, 0);
  const spark = data.growth.map((g) => ({ ...g, label: g.month.slice(2) }));

  return (
    <div className="space-y-6" data-testid="network-overview">
      <p className="max-w-3xl text-sm text-gray-600">
        Every university&apos;s equivalency decisions feed one shared pool. Reviewers see how many <em>other</em> universities treated the same course,
        never which ones. Student records and other universities&apos; names are never shared.
      </p>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card label="Equivalency pairs" value={data.totalPairs} sub="active, in effect today" />
        <Card label="Universities contributing" value={data.contributingUniversities} />
        <Card label="Outside courses covered" value={`${data.coveragePct}%`} sub={`${data.mappedExternalCourses} of ${data.externalCourses} have a mapping`} />
        <Card label="Added, last 12 months" value={growthTotal} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <h3 className="mb-2 text-sm font-semibold text-gray-900">Growth (new pairs per month)</h3>
          <div className="h-40" data-testid="growth-chart">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={spark} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
                <defs>
                  <linearGradient id="netGrowth" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#0ea5e9" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#0ea5e9" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <Tooltip formatter={(v: number) => [v, 'New pairs']} labelFormatter={(l) => `20${l}`} />
                <Area type="monotone" dataKey="count" stroke="#0ea5e9" strokeWidth={2} fill="url(#netGrowth)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <h3 className="mb-2 text-sm font-semibold text-gray-900">Most agreed courses</h3>
          {data.topAgreed.length === 0 ? (
            <p className="text-sm text-gray-500">Nothing yet. Agreement appears once universities record equivalent decisions.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {data.topAgreed.map((t) => (
                <li key={t.title} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                  <span className="min-w-0 flex-1 break-words text-gray-800">{t.title}</span>
                  <span className="text-xs text-gray-500">{t.universities} {t.universities === 1 ? 'university' : 'universities'}</span>
                  <AgreementChip level={t.agreementLevel} agreement={t.agreement} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-gray-900">Boost confidence when other universities agree</h3>
            <p className="mt-1 max-w-2xl text-sm text-gray-600">
              When this is on, a suggested match that other universities also accepted as equivalent gets a small confidence boost (between 5 and 15
              points, more when more universities agree) and its explanation says so, for example &quot;Also accepted by 3 other universities.&quot;
              The built-in rules never go above 70% and nothing goes above 99%. It only adjusts the suggestion; a person still decides. Off by default.
            </p>
            {!isSuper && <p className="mt-1 text-xs text-gray-500">Only a super admin can change this.</p>}
            {settings.data && !settings.data.ready && <p className="mt-1 text-xs text-amber-700">Settings storage (migration 023) is not applied yet, so the switch cannot be saved.</p>}
            {toggle.isError && <p className="mt-1 text-xs text-red-600">Could not save the setting.</p>}
          </div>
          <label className="inline-flex shrink-0 cursor-pointer items-center gap-2 text-sm font-medium text-gray-800">
            <input type="checkbox" role="switch" className="h-5 w-9 cursor-pointer accent-brand-800" checked={on} disabled={!isSuper || toggle.isPending || settings.data?.ready === false}
              onChange={(e) => toggle.mutate(e.target.checked)} data-testid="boost-toggle" />
            {on ? 'On' : 'Off'}
          </label>
        </div>
      </div>
    </div>
  );
}
