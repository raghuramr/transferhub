import { useQuery } from '@tanstack/react-query';
import { BookOpen, Search } from 'lucide-react';
import { coursesApi } from '../../lib/api';
import { useState } from 'react';

export default function CourseDatabase() {
  const [search, setSearch] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: ['courses', 'bu'],
    queryFn: () => coursesApi.listBU(),
  });

  const courses: any[] = (data?.data as any) ?? [];
  const filtered = search ? courses.filter((c: any) =>
    c.code?.toLowerCase().includes(search.toLowerCase()) ||
    c.title?.toLowerCase().includes(search.toLowerCase())
  ) : courses;

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-center gap-3 mb-8">
        <BookOpen className="text-brand-800" size={24} />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">BU Course Database</h1>
          <p className="text-gray-500">Boston University course catalog</p>
        </div>
      </div>

      <div className="relative mb-4">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by code or title…"
          className="w-full pl-9 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
      </div>

      {isLoading && <div className="text-center text-gray-400 py-16">Loading…</div>}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs font-semibold text-gray-500 uppercase">
            <tr>
              <th className="px-6 py-3 text-left">Code</th>
              <th className="px-6 py-3 text-left">Title</th>
              <th className="px-6 py-3 text-left">Program Area</th>
              <th className="px-6 py-3 text-right">Credits</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.map((c: any) => (
              <tr key={c.id} className="hover:bg-gray-50">
                <td className="px-6 py-3 font-mono text-brand-900 font-medium">{c.code}</td>
                <td className="px-6 py-3 text-gray-900">{c.title}</td>
                <td className="px-6 py-3 text-gray-500">{c.programArea || '—'}</td>
                <td className="px-6 py-3 text-right text-gray-700">{c.credits}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && !isLoading && (
          <div className="text-center py-12 text-gray-400">No courses found.</div>
        )}
      </div>
    </div>
  );
}
