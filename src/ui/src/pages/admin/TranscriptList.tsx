import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FileText, ChevronRight } from 'lucide-react';
import { transcriptsApi } from '../../lib/api';
import { useState } from 'react';
import { Link } from 'react-router-dom';

const STATUS_FILTERS = ['all', 'pending', 'in_review', 'complete'];

export default function TranscriptList() {
  const [statusFilter, setStatusFilter] = useState('all');
  const { data, isLoading } = useQuery({
    queryKey: ['transcripts', statusFilter],
    queryFn: () => transcriptsApi.list(statusFilter !== 'all' ? { status: statusFilter } : {}),
  });

  const transcripts: any[] = (data?.data as any) ?? [];

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <FileText className="text-indigo-600" size={24} />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Transcripts</h1>
            <p className="text-gray-500">All submitted transfer transcripts</p>
          </div>
        </div>
        <div className="flex gap-2">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                statusFilter === s
                  ? 'bg-indigo-600 text-white'
                  : 'bg-white border border-gray-200 text-gray-600 hover:border-indigo-300'
              }`}
            >
              {s === 'all' ? 'All' : s.replace('_', ' ')}
            </button>
          ))}
        </div>
      </div>

      {isLoading && <div className="text-center text-gray-400 py-16">Loading…</div>}

      <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
        {transcripts.length === 0 && !isLoading && (
          <div className="text-center py-16 text-gray-400">No transcripts found.</div>
        )}
        {transcripts.map((t: any) => (
          <div key={t.Id} className="flex items-center gap-4 px-6 py-4 hover:bg-gray-50">
            <div className="flex-1">
              <p className="font-medium text-sm text-gray-900">{t.StudentName}</p>
              <p className="text-xs text-gray-500">{t.InstitutionName} · {t.CourseCount} courses · Submitted {new Date(t.SubmittedAt).toLocaleDateString()}</p>
            </div>
            <span className={`px-2 py-1 rounded-full text-xs font-medium ${
              t.Status === 'complete' ? 'bg-green-100 text-green-700' :
              t.Status === 'pending' ? 'bg-yellow-100 text-yellow-700' : 'bg-blue-100 text-blue-700'
            }`}>
              {t.Status}
            </span>
            <ChevronRight className="text-gray-400" size={16} />
          </div>
        ))}
      </div>
    </div>
  );
}
