import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { BookOpen, Check, Upload } from 'lucide-react';
import { coursesApi } from '../../lib/api';
import { useMemo, useRef, useState } from 'react';
import { DataTable, type DataTableColumn, type DataTableFilter } from '../../components/ui/DataTable';
import { CourseTopicsEditor } from '../../components/ui/CourseTopicsEditor';
import { useAuthStore } from '../../store/auth';

const TOPIC_EDITOR_ROLES = ['super_admin', 'admin', 'faculty'];
const COURSE_EDITOR_ROLES = ['super_admin', 'admin'];

interface CourseRow {
  id: string | number;
  institutionId?: number;
  institutionName?: string;
  programId?: number | null;
  programName?: string;
  code: string;
  title: string;
  programArea?: string;
  requirementType?: string;
  credits: number;
  verified?: boolean;
  isActive?: boolean;
}

function CourseEditForm({ course, canEdit }: { course: CourseRow; canEdit: boolean }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    institutionId: course.institutionId,
    programId: course.programId ?? null,
    code: course.code,
    title: course.title,
    programArea: course.programArea ?? '',
    requirementType: course.requirementType ?? '',
    credits: course.credits,
    isActive: course.isActive !== false,
  });

  const { data: institutionsData } = useQuery({
    queryKey: ['courses', 'institutions'],
    queryFn: () => coursesApi.institutions(),
    enabled: canEdit,
  });
  const institutions: { id: number; name: string; code: string }[] = (institutionsData?.data as any) ?? [];

  const { data: programsData } = useQuery({
    queryKey: ['courses', 'programs', form.institutionId],
    queryFn: () => coursesApi.programs(form.institutionId),
    enabled: canEdit && form.institutionId !== undefined,
  });
  const programs: { id: number; name: string; area: string }[] = (programsData?.data as any) ?? [];

  const saveMutation = useMutation({
    mutationFn: () => coursesApi.update(Number(course.id), form),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['courses', 'bu'] }),
  });

  if (!canEdit) {
    return (
      <div className="mb-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-2">Course Details</h3>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
          <dt className="text-gray-500">University</dt><dd className="text-gray-900">{course.institutionName || '—'}</dd>
          <dt className="text-gray-500">Program</dt><dd className="text-gray-900">{course.programName || '—'}</dd>
          <dt className="text-gray-500">Code</dt><dd className="font-mono text-gray-900">{course.code}</dd>
          <dt className="text-gray-500">Title</dt><dd className="text-gray-900">{course.title}</dd>
          <dt className="text-gray-500">Program Area</dt><dd className="text-gray-900">{course.programArea || '—'}</dd>
          <dt className="text-gray-500">Credits</dt><dd className="text-gray-900">{course.credits}</dd>
        </dl>
      </div>
    );
  }

  return (
    <div className="mb-5 pb-5 border-b border-gray-200">
      <h3 className="text-sm font-semibold text-gray-900 mb-3">Course Details</h3>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">University</label>
          <select
            value={form.institutionId ?? ''}
            onChange={(e) =>
              setForm((f) => ({ ...f, institutionId: e.target.value ? Number(e.target.value) : undefined, programId: null }))
            }
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            <option value="">Select university…</option>
            {institutions.map((i) => (
              <option key={i.id} value={i.id}>{i.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Program</label>
          <select
            value={form.programId ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, programId: e.target.value ? Number(e.target.value) : null }))}
            disabled={!form.institutionId}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-gray-50"
          >
            <option value="">Unassigned</option>
            {programs.map((p) => (
              <option key={p.id} value={p.id}>{p.area} — {p.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Code</label>
          <input
            value={form.code}
            onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Title</label>
          <input
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Program Area</label>
          <input
            value={form.programArea}
            onChange={(e) => setForm((f) => ({ ...f, programArea: e.target.value }))}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Requirement Type</label>
          <input
            value={form.requirementType}
            onChange={(e) => setForm((f) => ({ ...f, requirementType: e.target.value }))}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Credits</label>
          <input
            type="number"
            step="0.5"
            value={form.credits}
            onChange={(e) => setForm((f) => ({ ...f, credits: parseFloat(e.target.value) || 0 }))}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700 self-end pb-2">
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
          />
          Active
        </label>
      </div>
      <button
        onClick={() => saveMutation.mutate()}
        disabled={saveMutation.isPending || !form.code.trim() || !form.title.trim()}
        className="mt-3 px-4 py-2 bg-brand-800 text-white rounded-lg text-sm font-medium hover:bg-brand-900 disabled:bg-brand-400"
      >
        {saveMutation.isPending ? 'Saving…' : 'Save Course Details'}
      </button>
    </div>
  );
}

function downloadBlob(data: BlobPart, filename: string) {
  const blob = new Blob([data], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function CourseDatabase() {
  const role = useAuthStore((s) => s.user?.role);
  const canEditTopics = !!role && TOPIC_EDITOR_ROLES.includes(role);
  const canEditCourse = !!role && COURSE_EDITOR_ROLES.includes(role);
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importResult, setImportResult] = useState<{ created: number; updated: number; errors?: unknown[] } | null>(null);
  const [importing, setImporting] = useState(false);

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

  const handleImportClick = () => fileInputRef.current?.click();
  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImporting(true);
    try {
      const res = await coursesApi.import(file);
      setImportResult(res.data as any);
      qc.invalidateQueries({ queryKey: ['courses', 'bu'] });
    } finally {
      setImporting(false);
    }
  };

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
      key: 'isActive',
      header: 'Status',
      render: (row) =>
        row.isActive === false ? (
          <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-700">Inactive</span>
        ) : (
          <span className="px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700">Active</span>
        ),
    },
  ];

  const filters: DataTableFilter[] = [
    { key: 'programArea', label: 'Program Area', options: programAreaOptions },
  ];

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <BookOpen className="text-brand-800" size={24} />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">BU Course Database</h1>
            <p className="text-gray-500">Boston University course catalog</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleImportFile} />
          <button
            onClick={handleImportClick}
            disabled={importing}
            className="flex items-center gap-1.5 text-sm font-medium px-3 py-2.5 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-60"
          >
            <Upload size={14} /> {importing ? 'Importing…' : 'Import CSV'}
          </button>
        </div>
      </div>

      {importResult && (
        <div className="mb-4 text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-4 py-2">
          Import complete — created {importResult.created}, updated {importResult.updated}
          {(importResult.errors?.length ?? 0) > 0 && ` (${importResult.errors!.length} skipped)`}
        </div>
      )}

      <DataTable
        columns={columns}
        rows={courses}
        searchPlaceholder="Search by code or title…"
        searchKeys={['code', 'title']}
        filters={filters}
        isLoading={isLoading}
        emptyMessage="No courses found."
        onExport={() => coursesApi.export().then((res) => downloadBlob(res.data, 'courses.csv'))}
        bulkActions={[
          {
            label: 'Activate',
            onClick: async (selected) => {
              await Promise.all(selected.map((row) => coursesApi.update(Number(row.id), { isActive: true })));
              qc.invalidateQueries({ queryKey: ['courses', 'bu'] });
            },
          },
          {
            label: 'Deactivate',
            danger: true,
            onClick: async (selected) => {
              await Promise.all(selected.map((row) => coursesApi.deactivate(Number(row.id))));
              qc.invalidateQueries({ queryKey: ['courses', 'bu'] });
            },
          },
        ]}
        renderExpanded={(row) => (
          <div>
            <CourseEditForm course={row} canEdit={canEditCourse} />
            <CourseTopicsEditor
              courseId={Number(row.id)}
              courseLabel={`${row.code} — ${row.title}`}
              canEdit={canEditTopics}
            />
          </div>
        )}
      />
    </div>
  );
}
