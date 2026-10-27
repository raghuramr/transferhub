import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { ExtractedDocument, IntakeDetail } from '../../lib/api';
import { cn } from '../../lib/cn';

const inputCls = 'w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-gray-50 disabled:text-gray-500';
const LOW = 0.6;

interface CourseRow {
  courseCode: string;
  courseTitle: string;
  credits: number | string;
  grade: string;
  term?: string;
  termSeason?: string;
  termYear?: number;
  confidence?: number;
}

type Fields = Record<string, unknown>;
const asObj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));

/** Editable view of what the reader (AI or built-in) found: a courses table for transcripts, key/value inputs for everything else. */
export function DocumentEditor({
  detail,
  readOnly,
  saving,
  onSave,
}: {
  detail: IntakeDetail;
  readOnly: boolean;
  saving: boolean;
  onSave: (extracted: ExtractedDocument) => void;
}) {
  const base: ExtractedDocument = detail.extracted ?? { docType: detail.docType ?? 'other', confidence: detail.confidence ?? 0, summary: detail.summary ?? '', fields: {} };
  const [fields, setFields] = useState<Fields>(base.fields);
  useEffect(() => setFields(base.fields), [detail.id, detail.extracted]); // eslint-disable-line react-hooks/exhaustive-deps

  const isTranscript = (detail.docType ?? base.docType) === 'transcript';
  const lowDoc = base.confidence < LOW;
  const save = () => onSave({ ...base, docType: detail.docType ?? base.docType, fields });

  if (isTranscript) {
    const inst = asObj(fields.institution);
    const student = asObj(fields.student);
    const courses = (Array.isArray(fields.courses) ? fields.courses : []) as CourseRow[];
    const setInst = (k: string, v: unknown) => setFields((f) => ({ ...f, institution: { ...asObj(f.institution), [k]: v } }));
    const setStudent = (k: string, v: unknown) => setFields((f) => ({ ...f, student: { ...asObj(f.student), [k]: v } }));
    const setCourse = (i: number, patch: Partial<CourseRow>) =>
      setFields((f) => ({ ...f, courses: courses.map((c, idx) => (idx === i ? { ...c, ...patch } : c)) }));
    const addCourse = () => setFields((f) => ({ ...f, courses: [...courses, { courseCode: '', courseTitle: '', credits: '', grade: '', term: '' }] }));
    const removeCourse = (i: number) => setFields((f) => ({ ...f, courses: courses.filter((_, idx) => idx !== i) }));

    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="text-xs text-gray-500">Institution
            <input className={cn(inputCls, 'mt-1', lowDoc && 'border-amber-400 bg-amber-50')} disabled={readOnly} value={str(inst.name)} onChange={(e) => setInst('name', e.target.value)} />
          </label>
          <label className="text-xs text-gray-500">Institution code
            <input className={cn(inputCls, 'mt-1')} disabled={readOnly} value={str(inst.code)} onChange={(e) => setInst('code', e.target.value)} />
          </label>
          <label className="text-xs text-gray-500">Calendar
            <select className={cn(inputCls, 'mt-1')} disabled={readOnly} value={str(fields.calendar) || 'semester'} onChange={(e) => setFields((f) => ({ ...f, calendar: e.target.value }))}>
              <option value="semester">Semester</option><option value="quarter">Quarter</option><option value="trimester">Trimester</option>
            </select>
          </label>
          <label className="text-xs text-gray-500">Student name
            <input className={cn(inputCls, 'mt-1')} disabled={readOnly} value={str(student.name)} onChange={(e) => setStudent('name', e.target.value)} />
          </label>
          <label className="text-xs text-gray-500">Student ID
            <input className={cn(inputCls, 'mt-1')} disabled={readOnly} value={str(student.id)} onChange={(e) => setStudent('id', e.target.value)} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs text-gray-500">Program
              <input className={cn(inputCls, 'mt-1')} disabled={readOnly} value={str(fields.program)} onChange={(e) => setFields((f) => ({ ...f, program: e.target.value }))} />
            </label>
            <label className="text-xs text-gray-500">GPA
              <input className={cn(inputCls, 'mt-1')} disabled={readOnly} inputMode="decimal" value={str(fields.gpa)} onChange={(e) => setFields((f) => ({ ...f, gpa: e.target.value }))} />
            </label>
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700">Courses ({courses.length})</span>
            {!readOnly && (
              <button type="button" onClick={addCourse} className="inline-flex items-center gap-1 text-sm font-medium text-brand-800 hover:underline"><Plus size={14} /> Add course</button>
            )}
          </div>
          <div className="space-y-2">
            {courses.length === 0 && <p className="rounded-lg border border-dashed border-gray-300 p-3 text-sm text-gray-400">No courses were found on this document.</p>}
            {courses.map((c, i) => {
              const low = c.confidence !== undefined && c.confidence < LOW;
              const cell = cn(inputCls, low && 'border-amber-400 bg-amber-50');
              return (
                <div key={i} className="grid grid-cols-2 gap-2 sm:grid-cols-[7rem_1fr_5rem_5rem_8rem_2rem]">
                  <input className={cell} placeholder="Code" disabled={readOnly} value={str(c.courseCode)} onChange={(e) => setCourse(i, { courseCode: e.target.value })} />
                  <input className={cn(cell, 'col-span-2 sm:col-span-1')} placeholder="Title" disabled={readOnly} value={str(c.courseTitle)} onChange={(e) => setCourse(i, { courseTitle: e.target.value })} />
                  <input className={cell} placeholder="Credits" inputMode="decimal" disabled={readOnly} value={str(c.credits)} onChange={(e) => setCourse(i, { credits: e.target.value })} />
                  <input className={cell} placeholder="Grade" disabled={readOnly} value={str(c.grade)} onChange={(e) => setCourse(i, { grade: e.target.value })} />
                  <input className={cell} placeholder="Term" disabled={readOnly} value={str(c.term)} onChange={(e) => setCourse(i, { term: e.target.value })} />
                  {!readOnly && (
                    <button type="button" onClick={() => removeCourse(i)} className="flex items-center justify-center text-gray-400 hover:text-red-600" aria-label="Remove course"><Trash2 size={15} /></button>
                  )}
                </div>
              );
            })}
          </div>
          {courses.some((c) => c.confidence !== undefined && c.confidence < LOW) && (
            <p className="mt-2 text-xs text-amber-700">Rows highlighted in amber were hard to read - please check them.</p>
          )}
        </div>

        {!readOnly && (
          <button type="button" onClick={save} disabled={saving} className="rounded-lg border border-brand-800 px-4 py-2 text-sm font-medium text-brand-800 hover:bg-brand-50 disabled:opacity-50">
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        )}
      </div>
    );
  }

  const entries = Object.entries(fields);
  const setField = (k: string, v: string) => setFields((f) => ({ ...f, [k]: v }));
  return (
    <div className="space-y-3">
      {entries.length === 0 && <p className="rounded-lg border border-dashed border-gray-300 p-3 text-sm text-gray-400">Nothing was extracted from this document.</p>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {entries.map(([k, v]) => (
          <label key={k} className="text-xs text-gray-500">{k.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())}
            <input
              className={cn(inputCls, 'mt-1', lowDoc && 'border-amber-400 bg-amber-50')}
              disabled={readOnly || (typeof v === 'object' && v !== null)}
              value={typeof v === 'object' && v !== null ? JSON.stringify(v) : str(v)}
              onChange={(e) => setField(k, e.target.value)}
            />
          </label>
        ))}
      </div>
      {!readOnly && entries.length > 0 && (
        <button type="button" onClick={save} disabled={saving} className="rounded-lg border border-brand-800 px-4 py-2 text-sm font-medium text-brand-800 hover:bg-brand-50 disabled:opacity-50">
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      )}
    </div>
  );
}
