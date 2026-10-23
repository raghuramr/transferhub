import { useQuery } from '@tanstack/react-query';
import { BookOpen, Check, ListTree } from 'lucide-react';
import { coursesApi } from '../../lib/api';
import { useMemo, useState } from 'react';
import { DataTable, type DataTableColumn, type DataTableFilter } from '../../components/ui/DataTable';
import { CourseTopicsEditor } from '../../components/ui/CourseTopicsEditor';
import { useAuthStore } from '../../store/auth';

const TOPIC_EDITOR_ROLES = ['super_admin', 'admin', 'faculty'];

interface CourseRow {
  id: string | number;
  code: string;
  title: string;
  programArea?: string;
  credits: number;
  verified?: boolean;
}

export default function CourseDatabase() {
  const role = useAuthStore((s) => s.user?.role);
  const canEditTopics = !!role && TOPIC_EDITOR_ROLES.includes(role);
  const [topicsFor, setTopicsFor] = useState<CourseRow | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['courses', 'bu'],
    queryFn: () => coursesApi.listBU(),
  });

  const courses: CourseRow[] = ((data?.data as any[]) ?? []).map((c: any) => ({
    ...c,
    id: c.id,
  }));

  const programAreaOptions = useMemo(() => {
    const values = Array.from(new Set(courses.map((c) => c.programArea).filter(Boolean))) as string[];
    return values.sort().map((v) => ({ value: v, label: v }));
  }, [courses]);

  const columns: DataTableColumn<CourseRow>[] = [
    { key: 'code', header: 'Code', render: (row) => <span className="font-mono text-brand-900 font-medium">{row.code}</span> },
    { key: 'title', header: 'Title', render: (row) => <span className="text-gray-900">{row.title}</span> },
    { key: 'programArea', header: 'Program Area', render: (row) => <span className="text-gray-500">{row.programArea || '—'}</span> },
    { key: 'credits', header: 'Credits', align: 'right', sortValue: (row) => row.credits, render: (row) => <span className="text-gray-700">{row.credits}</span> },
    {
      key: 'verified',
      header: 'Verified',
      render: (row) =>
        row.verified ? (
          <span className="inline-flex items-center gap-1 text-green-700"><Check size={14} /> Yes</span>
        ) : (
          <span className="text-gray-400">No</span>
        ),
    },
    {
      key: 'topics',
      header: 'Topics',
      render: (row) => (
        <button
          onClick={() => setTopicsFor(row)}
          className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:text-brand-900"
        >
          <ListTree size={14} /> {canEditTopics ? 'Edit topics' : 'View topics'}
        </button>
      ),
    },
  ];

  const filters: DataTableFilter[] = [
    { key: 'programArea', label: 'Program Area', options: programAreaOptions },
  ];

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-center gap-3 mb-8">
        <BookOpen className="text-brand-800" size={24} />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">BU Course Database</h1>
          <p className="text-gray-500">Boston University course catalog</p>
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={courses}
        searchPlaceholder="Search by code or title…"
        searchKeys={['code', 'title']}
        filters={filters}
        isLoading={isLoading}
        emptyMessage="No courses found."
      />

      {topicsFor && (
        <CourseTopicsEditor
          courseId={Number(topicsFor.id)}
          courseLabel={`${topicsFor.code} — ${topicsFor.title}`}
          canEdit={canEditTopics}
          onClose={() => setTopicsFor(null)}
        />
      )}
    </div>
  );
}
