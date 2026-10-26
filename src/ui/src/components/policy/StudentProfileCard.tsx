import { Globe2, GraduationCap } from 'lucide-react';
import { APPLICANT_TYPE_LABEL, type StudentApplicationProfile } from '../../types/policy';

/** What the student told us at registration - the reviewer's equivalent of the application file. */
export default function StudentProfileCard({ p }: { p?: StudentApplicationProfile | null }) {
  if (!p) return null;
  const row = (label: string, value: React.ReactNode) =>
    value ? (<div className="flex justify-between gap-3 py-1"><dt className="text-gray-500">{label}</dt><dd className="text-right text-gray-800">{value}</dd></div>) : null;
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm">
      <h3 className="mb-2 flex items-center gap-1.5 font-semibold text-gray-800"><GraduationCap size={15} /> Application</h3>
      <dl className="divide-y divide-gray-50">
        {row('Applying as', p.applicantType ? APPLICANT_TYPE_LABEL[p.applicantType] ?? p.applicantType : null)}
        {row('Admission', p.admissionStatus === 'admitted' ? 'Admitted' : p.admissionStatus === 'applicant' ? 'Not yet admitted' : null)}
        {row('BUID', p.buid)}
        {row('School / college', p.intendedSchool)}
        {row('Program', p.targetProgram)}
        {row('Entry term', p.entryTerm ? `${p.entryTerm} ${p.entryYear ?? ''}` : null)}
        {row('English', p.isNativeEnglish == null ? null : p.isNativeEnglish ? 'First language' : `${p.englishTestType ?? 'Test'} ${p.englishTestScore ?? '(score pending)'}`)}
        {row('High school', p.highSchoolName ? `${p.highSchoolName}${p.highSchoolGradYear ? ` (${p.highSchoolGradYear})` : ''}` : null)}
        {row('College credits', p.creditsCompleted)}
      </dl>
      {p.hasIntlCoursework && (
        <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-sky-50 p-2 text-xs text-sky-900"><Globe2 size={13} className="mt-0.5 shrink-0" />Has coursework from outside the US: handled by International Admissions (intadvis@bu.edu).</p>
      )}
      {p.education.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Colleges attended</div>
          <ul className="space-y-1 text-xs text-gray-700">
            {p.education.map((e, i) => (
              <li key={i}>
                <span className="font-medium">{e.institutionName}</span>
                {e.fromYear || e.toYear ? ` · ${e.fromYear ?? '?'}–${e.toYear ?? 'now'}` : ''}
                {e.creditsEarned != null ? ` · ${e.creditsEarned} cr` : ''}
                {e.fullTime === false ? ' · part-time' : ''}
                {e.isOutsideUS ? ' · outside US' : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
      {p.exams.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">AP / IB / A-level</div>
          <ul className="space-y-0.5 text-xs text-gray-700">
            {p.exams.map((x, i) => <li key={i}>{x.examType} {x.subject}{x.score ? ` (${x.score})` : ''}{x.examYear ? `, ${x.examYear}` : ''}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
