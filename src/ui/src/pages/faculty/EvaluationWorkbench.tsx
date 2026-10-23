import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { evaluationsApi, aiApi } from '../../lib/api';
import { Sparkles, CheckCircle, XCircle, BookOpen, ChevronDown } from 'lucide-react';
import { TransferWorkflowStepper, EVALUATION_STEPS } from '../../components/ui/TransferWorkflowStepper';

type DecidePayload = {
  outcome: string;
  buCourseId?: number;
  awardedCredits?: number;
  notes?: string;
};

const outcomeOptions = [
  { value: 'equivalent', label: 'Equivalent — full credit', color: 'text-green-700 bg-green-50' },
  { value: 'elective',   label: 'Elective — general credit', color: 'text-blue-700 bg-blue-50' },
  { value: 'no_credit',  label: 'No credit', color: 'text-red-700 bg-red-50' },
];

export default function EvaluationWorkbench() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [outcome, setOutcome] = useState('');
  const [buCourseId, setBuCourseId] = useState('');
  const [credits, setCredits] = useState('');
  const [notes, setNotes] = useState('');
  const [showCandidates, setShowCandidates] = useState(true);

  const { data, isLoading } = useQuery({
    queryKey: ['evaluation', id],
    queryFn: () => evaluationsApi.get(id!),
  });
  const ev = data?.data as any;

  const matchMutation = useMutation({
    mutationFn: () => aiApi.match(id!),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['evaluation', id] }),
  });

  const decideMutation = useMutation({
    mutationFn: (payload: DecidePayload) => evaluationsApi.decide(id!, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['evaluations'] });
      navigate('/faculty');
    },
  });

  const handleDecide = () => {
    if (!outcome) return;
    decideMutation.mutate({
      outcome,
      buCourseId: buCourseId ? parseInt(buCourseId) : undefined,
      awardedCredits: credits ? parseFloat(credits) : undefined,
      notes,
    });
  };

  if (isLoading) return <div className="p-8 text-gray-400">Loading evaluation…</div>;
  if (!ev) return <div className="p-8 text-red-500">Evaluation not found.</div>;

  const tc = ev.transcriptCourse;
  const candidates: any[] = ev.aiCandidates ?? [];

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Evaluation Workbench</h1>
      <p className="text-gray-500 mb-6">
        {tc?.courseCode} — {tc?.courseTitle} from {tc?.transcript?.institution?.name}
      </p>

      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <TransferWorkflowStepper currentStatus={ev.status} steps={EVALUATION_STEPS} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: course details */}
        <div className="lg:col-span-2 space-y-6">
          {/* Source course */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="font-semibold text-gray-900 mb-3">Transfer Course</h2>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              {[
                ['Code', tc?.courseCode],
                ['Title', tc?.courseTitle],
                ['Credits', tc?.originalCredits],
                ['Grade', tc?.grade],
                ['Institution', tc?.transcript?.institution?.name],
                ['Calendar', tc?.transcript?.institution?.calendar],
              ].map(([k, v]) => (
                <div key={k as string}>
                  <dt className="text-gray-500">{k}</dt>
                  <dd className="font-medium text-gray-900">{v ?? '—'}</dd>
                </div>
              ))}
            </dl>
          </div>

          {/* AI Candidates */}
          <div className="bg-white rounded-xl border border-gray-200">
            <div
              className="flex items-center justify-between px-6 py-4 cursor-pointer border-b border-gray-100"
              onClick={() => setShowCandidates(!showCandidates)}
            >
              <div className="flex items-center gap-2">
                <Sparkles className="text-brand-500" size={18} />
                <h2 className="font-semibold text-gray-900">AI Candidates</h2>
                {candidates.length > 0 && (
                  <span className="px-2 py-0.5 bg-brand-100 text-brand-900 rounded-full text-xs">
                    {candidates.length}
                  </span>
                )}
              </div>
              <ChevronDown className={`text-gray-400 transition-transform ${showCandidates ? 'rotate-180' : ''}`} size={18} />
            </div>

            {showCandidates && (
              <div className="p-4">
                {candidates.length === 0 ? (
                  <div className="text-center py-6">
                    <p className="text-gray-400 text-sm mb-3">No AI candidates yet.</p>
                    <button
                      onClick={() => matchMutation.mutate()}
                      disabled={matchMutation.isPending}
                      className="flex items-center gap-2 mx-auto px-4 py-2 bg-brand-800 text-white rounded-lg text-sm font-medium hover:bg-brand-900 disabled:bg-brand-400"
                    >
                      <Sparkles size={14} />
                      {matchMutation.isPending ? 'Matching…' : 'Run AI Match'}
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {candidates.map((c: any) => (
                      <div
                        key={c.buCourse?.id}
                        onClick={() => {
                          setBuCourseId(String(c.buCourse?.id));
                          setOutcome('equivalent');
                          setCredits(String(c.buCourse?.credits ?? ''));
                        }}
                        className={`p-4 border-2 rounded-lg cursor-pointer transition-all ${
                          buCourseId === String(c.buCourse?.id)
                            ? 'border-brand-500 bg-brand-50'
                            : 'border-gray-200 hover:border-brand-300'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-medium text-gray-900 text-sm">
                              #{c.rank} — {c.buCourse?.code}: {c.buCourse?.title}
                            </p>
                            <p className="text-xs text-gray-500 mt-1">{c.buCourse?.credits} credits</p>
                            <p className="text-xs text-gray-600 mt-2">{c.rationale}</p>
                          </div>
                          <div className="shrink-0 text-right">
                            <span className={`text-sm font-bold ${c.score >= 0.8 ? 'text-green-600' : c.score >= 0.5 ? 'text-amber-600' : 'text-gray-500'}`}>
                              {Math.round(c.score * 100)}%
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right: decision panel */}
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="font-semibold text-gray-900 mb-4">Decision</h2>

            <div className="space-y-2 mb-4">
              {outcomeOptions.map((opt) => (
                <label
                  key={opt.value}
                  className={`flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all ${
                    outcome === opt.value
                      ? 'border-brand-500 ' + opt.color
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <input
                    type="radio"
                    name="outcome"
                    value={opt.value}
                    checked={outcome === opt.value}
                    onChange={() => setOutcome(opt.value)}
                    className="sr-only"
                  />
                  {outcome === opt.value ? <CheckCircle size={16} /> : <div className="w-4 h-4 rounded-full border-2 border-gray-300" />}
                  <span className="text-sm font-medium">{opt.label}</span>
                </label>
              ))}
            </div>

            {outcome === 'equivalent' && (
              <div className="space-y-3 mb-4">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">BU Course ID</label>
                  <input
                    value={buCourseId}
                    onChange={(e) => setBuCourseId(e.target.value)}
                    placeholder="e.g. 12"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Awarded Credits</label>
                  <input
                    value={credits}
                    onChange={(e) => setCredits(e.target.value)}
                    type="number"
                    step="0.5"
                    placeholder="4"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                </div>
              </div>
            )}

            <div className="mb-4">
              <label className="block text-xs font-medium text-gray-700 mb-1">Evaluator Notes</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="Optional rationale for your decision…"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
              />
            </div>

            <button
              onClick={handleDecide}
              disabled={!outcome || decideMutation.isPending}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-green-600 hover:bg-green-700 disabled:bg-gray-300 text-white rounded-lg text-sm font-medium transition-colors"
            >
              <CheckCircle size={16} />
              {decideMutation.isPending ? 'Saving…' : 'Submit Decision'}
            </button>

            <button
              onClick={() => navigate('/faculty')}
              className="w-full mt-2 flex items-center justify-center gap-2 py-2.5 border border-gray-300 text-gray-600 hover:bg-gray-50 rounded-lg text-sm font-medium transition-colors"
            >
              <XCircle size={16} />
              Back to Queue
            </button>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-xs text-amber-700">
            <BookOpen size={14} className="mb-1" />
            Minimum grade C required. Quarter credits already converted. BU Group C residency applies.
          </div>
        </div>
      </div>
    </div>
  );
}
