import { useState } from 'react';
import { Loader2, Paperclip, X } from 'lucide-react';
import { appealsApi, uploadsApi } from '../../lib/api';
import { BuCoursePicker } from './PolicyBits';
import type { TranscriptCourse } from '../../types';

const errMsg = (e: unknown, fallback: string) => {
  const m = (e as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
  return m ? [m].flat().join(' ') : fallback;
};

/** Step 1 of BU's Transfer Credit Appeal Form, one course per appeal. */
export default function AppealModal({ requestId, course, onClose, onSubmitted }: {
  requestId: string; course: TranscriptCourse; onClose: () => void; onSubmitted: () => void;
}) {
  const [picked, setPicked] = useState<{ id: number; code: string; title: string } | null>(null);
  const [freeText, setFreeText] = useState('');
  const [reason, setReason] = useState('');
  const [syllabus, setSyllabus] = useState<{ id: string; name: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const upload = async (file: File) => {
    setUploading(true);
    setError('');
    try {
      const res = await uploadsApi.upload(file, { entityType: 'appeal' });
      setSyllabus({ id: (res.data as { id: string }).id, name: file.name });
    } catch {
      setError('Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      await appealsApi.create(requestId, course.id, {
        proposedBUCourseId: picked?.id,
        proposedEquivalent: picked ? undefined : freeText.trim() || undefined,
        reason: reason.trim(),
        syllabusUploadId: syllabus?.id,
      });
      onSubmitted();
    } catch (e) {
      setError(errMsg(e, 'Could not submit the appeal.'));
    } finally {
      setBusy(false);
    }
  };

  const ready = reason.trim().length >= 20 && (picked || freeText.trim());
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={onClose}>
      <div className="mt-10 w-full max-w-lg rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900">Appeal: {course.courseCode}</h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Close"><X size={18} /></button>
        </div>
        <p className="mb-4 text-sm text-gray-500">
          {course.courseTitle} · {course.originalCredits} credits · grade {course.grade}
          {course.termSeason ? ` · ${course.termSeason} ${course.termYear ?? ''}` : ''}. The department re-evaluates it and you are emailed the decision.
        </p>
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Proposed BU course equivalent</label>
            <BuCoursePicker value={picked} onChange={(c) => setPicked(c)} />
            {!picked && (
              <input value={freeText} onChange={(e) => setFreeText(e.target.value)} maxLength={200} placeholder="…or type it, e.g. CAS CS 111"
                className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            )}
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Reason for re-evaluation <span className="text-red-600">*</span></label>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={4} maxLength={4000}
              placeholder="Explain why the course should count, e.g. which topics match the BU course."
              className="w-full rounded-lg border border-gray-300 p-2 text-sm" />
            <p className="mt-1 text-xs text-gray-400">At least 20 characters.</p>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Course syllabus</label>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50">
              {uploading ? <Loader2 size={15} className="animate-spin" /> : <Paperclip size={15} />}
              {syllabus ? syllabus.name : 'Attach the syllabus (PDF)'}
              <input type="file" accept=".pdf,.doc,.docx,image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void upload(f); }} />
            </label>
            <p className="mt-1 text-xs text-gray-400">BU requires the external course's syllabus for re-evaluation.</p>
          </div>
          {error && <p className="rounded-lg bg-red-50 p-2 text-sm text-red-700">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700">Cancel</button>
            <button type="button" disabled={!ready || busy || uploading} onClick={() => void submit()} className="rounded-lg bg-brand-800 px-4 py-2 text-sm font-medium text-white disabled:bg-brand-300">
              {busy ? 'Submitting…' : 'Submit appeal'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
