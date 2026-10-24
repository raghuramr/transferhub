import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { formsApi } from '../../lib/api';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Reveal } from '../../components/ui/PageTransition';
import { ArrowLeft } from 'lucide-react';
import type { FormSubmission } from '../../types';

const statusTone: Record<string, 'blue' | 'green' | 'red' | 'gray'> = {
  new: 'blue',
  reviewed: 'gray',
  approved: 'green',
  rejected: 'red',
};

export default function FormSubmissions() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['forms', id, 'submissions'],
    queryFn: () => formsApi.submissions(Number(id)),
  });

  const decideMutation = useMutation({
    mutationFn: ({ submissionId, status }: { submissionId: string; status: string }) =>
      formsApi.decideSubmission(submissionId, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['forms', id, 'submissions'] }),
  });

  const submissions = (data?.data as FormSubmission[]) ?? [];

  return (
    <div className="p-4 sm:p-6 w-[95%] mx-auto">
      <button onClick={() => navigate(`/admin/forms/${id}`)} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900 mb-6">
        <ArrowLeft size={16} /> Back to Form
      </button>

      <h1 className="text-2xl font-bold text-gray-900 mb-1">
        {submissions[0]?.formTitle ?? 'Submissions'}
      </h1>
      <p className="text-gray-500 mb-6">{submissions.length} submission{submissions.length === 1 ? '' : 's'}</p>

      {isLoading && <p className="text-gray-400 text-center py-12">Loading…</p>}

      <div className="space-y-3">
        {submissions.map((sub, i) => (
          <Reveal key={sub.id} index={i}>
            <Card className="p-5">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="font-semibold text-gray-900">{sub.submittedByName ?? 'Unknown'}</p>
                  <p className="text-xs text-gray-500">
                    {sub.submittedByEmail} · {new Date(sub.submittedAt).toLocaleString()}
                  </p>
                </div>
                <Badge tone={statusTone[sub.status] ?? 'gray'}>{sub.status}</Badge>
              </div>

              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm mb-4">
                {Object.entries(sub.data).map(([key, value]) => (
                  <div key={key}>
                    <dt className="text-gray-500 text-xs">{key}</dt>
                    <dd className="font-medium text-gray-900">{Array.isArray(value) ? value.join(', ') : String(value)}</dd>
                  </div>
                ))}
              </dl>

              <div className="flex gap-2">
                {['reviewed', 'approved', 'rejected'].map((s) => (
                  <button
                    key={s}
                    onClick={() => decideMutation.mutate({ submissionId: sub.id, status: s })}
                    disabled={sub.status === s}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 text-gray-600 hover:border-brand-300 hover:text-brand-800 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Mark {s}
                  </button>
                ))}
              </div>
            </Card>
          </Reveal>
        ))}

        {!isLoading && submissions.length === 0 && (
          <Card className="p-12 text-center text-gray-400">No submissions yet.</Card>
        )}
      </div>
    </div>
  );
}
