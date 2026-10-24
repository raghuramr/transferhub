import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { importApi } from '../../lib/api';
import { Upload, Eye, CheckCircle, AlertCircle, Info, ChevronDown, ChevronRight } from 'lucide-react';

type ImportType = 'universities' | 'programs' | 'courses';

const FORMAT_EXAMPLES: Record<ImportType, { description: string; example: object }> = {
  universities: {
    description: 'Import universities. Required fields: code, name.',
    example: {
      type: 'universities',
      data: [
        { code: 'MIT', name: 'Massachusetts Institute of Technology', country: 'USA', state: 'MA', city: 'Cambridge' },
      ],
    },
  },
  programs: {
    description: 'Import academic programs. Required fields: code, name, universityCode.',
    example: {
      type: 'programs',
      data: [
        { name: 'Computer Science', code: 'CS', universityCode: 'MIT', description: 'Bachelor of Science in CS' },
      ],
    },
  },
  courses: {
    description: 'Import courses with optional topics. Required fields: code, name, credits, universityCode.',
    example: {
      type: 'courses',
      data: [
        {
          code: 'CS101', name: 'Intro to Computer Science', credits: 3,
          universityCode: 'MIT', programCode: 'CS',
          description: 'Fundamentals of programming',
          topics: [
            { title: 'Variables & Data Types', description: 'Basic data types and variables' },
            { title: 'Control Flow', description: 'Loops, conditionals and functions' },
          ],
        },
      ],
    },
  },
};

export default function DataImport() {
  const [activeType, setActiveType] = useState<ImportType>('universities');
  const [jsonText, setJsonText] = useState('');
  const [showFormat, setShowFormat] = useState(true);
  const [previewResult, setPreviewResult] = useState<Record<string, unknown> | null>(null);
  const [importResult, setImportResult] = useState<Record<string, unknown> | null>(null);
  const [parseError, setParseError] = useState('');

  const previewMutation = useMutation({
    mutationFn: ({ type, data }: { type: string; data: unknown[] }) =>
      importApi.preview(type, data),
    onSuccess: (res) => { setPreviewResult(res.data); setImportResult(null); },
  });

  const importMutation = useMutation({
    mutationFn: ({ type, data }: { type: string; data: unknown[] }) =>
      importApi.execute(type, data),
    onSuccess: (res) => { setImportResult(res.data); },
  });

  const parseAndRun = (action: 'preview' | 'import') => {
    setParseError('');
    setPreviewResult(null);
    setImportResult(null);
    let parsed: { type?: string; data?: unknown[] };
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      setParseError('Invalid JSON — please check your input.');
      return;
    }
    if (!parsed.data || !Array.isArray(parsed.data)) {
      setParseError('JSON must have a "data" array field.');
      return;
    }
    const type = parsed.type || activeType;
    if (action === 'preview') {
      previewMutation.mutate({ type, data: parsed.data });
    } else {
      importMutation.mutate({ type, data: parsed.data });
    }
  };

  const loadExample = () => {
    setJsonText(JSON.stringify(FORMAT_EXAMPLES[activeType].example, null, 2));
    setParseError('');
    setPreviewResult(null);
    setImportResult(null);
  };

  const tabs: { key: ImportType; label: string }[] = [
    { key: 'universities', label: 'Universities' },
    { key: 'programs', label: 'Programs' },
    { key: 'courses', label: 'Courses' },
  ];

  return (
    <div className="w-[95%] mx-auto p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <Upload className="text-brand-800" size={24} />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Data Import</h1>
            <p className="text-gray-500 text-sm">Import universities, programs, and courses from external sources</p>
          </div>
        </div>
      </div>

      {/* Type Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit mb-6">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => { setActiveType(t.key); setJsonText(''); setPreviewResult(null); setImportResult(null); setParseError(''); }}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              activeType === t.key
                ? 'bg-white shadow text-brand-800'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Format reference */}
        <div>
          <button
            onClick={() => setShowFormat((v) => !v)}
            className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-3 hover:text-brand-800"
          >
            {showFormat ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            Expected Format
          </button>
          {showFormat && (
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
              <div className="flex items-start gap-2 mb-3">
                <Info size={16} className="text-brand-800 mt-0.5 shrink-0" />
                <p className="text-sm text-gray-600">{FORMAT_EXAMPLES[activeType].description}</p>
              </div>
              <pre className="text-xs bg-white border border-gray-200 rounded-lg p-3 overflow-x-auto text-gray-700 leading-relaxed">
                {JSON.stringify(FORMAT_EXAMPLES[activeType].example, null, 2)}
              </pre>
              <button
                onClick={loadExample}
                className="mt-3 text-xs text-brand-800 hover:underline font-medium"
              >
                Load example into editor →
              </button>
            </div>
          )}
        </div>

        {/* Right: Import editor */}
        <div className="flex flex-col gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Paste your JSON data
            </label>
            <textarea
              className="w-full h-64 px-4 py-3 border border-gray-300 rounded-xl text-xs font-mono focus:outline-none focus:ring-2 focus:ring-brand-500 resize-y"
              placeholder={`Paste JSON here...\n\nExample:\n{\n  "type": "${activeType}",\n  "data": [...]\n}`}
              value={jsonText}
              onChange={(e) => { setJsonText(e.target.value); setParseError(''); }}
            />
            {parseError && (
              <p className="mt-1 text-xs text-red-600 flex items-center gap-1">
                <AlertCircle size={12} /> {parseError}
              </p>
            )}
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => parseAndRun('preview')}
              disabled={!jsonText.trim() || previewMutation.isPending}
              className="flex items-center gap-2 px-4 py-2.5 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              <Eye size={16} />
              {previewMutation.isPending ? 'Previewing…' : 'Preview'}
            </button>
            <button
              onClick={() => parseAndRun('import')}
              disabled={!jsonText.trim() || importMutation.isPending}
              className="flex items-center gap-2 px-5 py-2.5 bg-brand-800 text-white rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
            >
              <Upload size={16} />
              {importMutation.isPending ? 'Importing…' : 'Import Now'}
            </button>
          </div>
        </div>
      </div>

      {/* Preview results */}
      {previewResult && (
        <div className="mt-6 bg-blue-50 border border-blue-200 rounded-xl p-5">
          <h3 className="font-semibold text-blue-900 mb-3 flex items-center gap-2">
            <Eye size={16} /> Preview Results
          </h3>
          <pre className="text-xs text-blue-800 overflow-x-auto bg-white border border-blue-100 rounded-lg p-3">
            {JSON.stringify(previewResult, null, 2)}
          </pre>
        </div>
      )}

      {/* Import results */}
      {importResult && (
        <div className="mt-6 bg-green-50 border border-green-200 rounded-xl p-5">
          <h3 className="font-semibold text-green-900 mb-3 flex items-center gap-2">
            <CheckCircle size={16} /> Import Complete
          </h3>
          <pre className="text-xs text-green-800 overflow-x-auto bg-white border border-green-100 rounded-lg p-3">
            {JSON.stringify(importResult, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
