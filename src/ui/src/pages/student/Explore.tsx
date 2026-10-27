import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Info } from 'lucide-react';
import { api } from '../../lib/api';
import { UniversityCompareColumn } from '../../components/student/UniversityCompareColumn';
import type { CompareResult, JourneyOverview, JourneyUniversity } from '../../components/student/journeyTypes';

/** Compare up to 3 universities side by side: which programs fit the student's courses and how many credits could transfer. */
export default function Explore() {
  const unis = useQuery({ queryKey: ['student', 'universities'], queryFn: async () => (await api.get<JourneyUniversity[]>('/student/universities')).data });
  const overview = useQuery({ queryKey: ['student', 'overview'], queryFn: async () => (await api.get<JourneyOverview>('/student/overview')).data });

  const [slots, setSlots] = useState<(number | null)[]>([null, null, null]);
  const [seeded, setSeeded] = useState(false);

  // Default the first slot to the student's target once both lists have loaded.
  useEffect(() => {
    if (seeded || !unis.data || overview.isLoading) return;
    const t = overview.data?.target?.institutionId;
    const first = t && unis.data.some((u) => u.id === t) ? t : null;
    setSlots([first, null, null]);
    setSeeded(true);
  }, [seeded, unis.data, overview.data, overview.isLoading]);

  const ids = slots.filter((x): x is number => x != null);
  const cmp = useQuery({
    queryKey: ['student', 'compare', ids.join(',')],
    queryFn: async () => (await api.get<CompareResult>('/student/compare', { params: { ids: ids.join(',') } })).data,
    enabled: ids.length > 0,
  });

  const setSlot = (i: number, v: number | null) => setSlots((s) => s.map((x, j) => (j === i ? v : x)));
  const target = overview.data?.target ?? null;

  return (
    <div className="mx-auto w-[95%] p-4 sm:p-6">
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-gray-900">Explore universities</h1>
        <p className="mt-1 text-gray-500">See which programs fit the courses you already have, and how many credits could move with you. Compare up to three universities at once.</p>
      </div>

      <div className="mb-5 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-sm text-amber-900">
        <Info size={16} className="mt-0.5 shrink-0" />
        <p>{cmp.data?.note ?? 'This is a preview, not a guarantee. Matches come from existing equivalencies and built-in rules; the official evaluation happens after you are admitted.'}</p>
      </div>

      {unis.isError && <p className="mb-4 text-sm text-red-600">Could not load the list of universities.</p>}
      {cmp.data && cmp.data.studentCourses.length === 0 && (
        <p className="mb-4 rounded-xl bg-brand-50 p-3 text-sm text-brand-900">You have not submitted any courses yet, so there is nothing to match. Submit a transcript to see real matches here.</p>
      )}

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <UniversityCompareColumn
            key={i}
            index={i}
            optional={i > 0}
            universities={unis.data ?? []}
            value={slots[i]}
            onChange={(v) => setSlot(i, v)}
            takenIds={ids}
            data={cmp.data?.universities.find((u) => u.institutionId === slots[i])}
            loading={cmp.isLoading || (cmp.isFetching && !cmp.data?.universities.some((u) => u.institutionId === slots[i]))}
            error={cmp.isError}
            targetInstitutionId={target?.institutionId ?? null}
            targetProgramId={target?.programId ?? null}
          />
        ))}
      </div>
    </div>
  );
}
