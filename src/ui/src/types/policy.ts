export type FlagSeverity = 'block' | 'review' | 'info';
export interface PolicyFlag {
  code: string;
  severity: FlagSeverity;
  message: string;
}

export type EvaluationKind = 'preview' | 'official' | 'preapproval';

export interface CreditSummary {
  cap: number;
  transferCredits: number;
  examCredits: number;
  used: number;
  remaining: number;
  hubRequirements: number;
  hubCocurricularAllowed: number;
  applicantType: string | null;
}

export interface TransferPolicy {
  id: number | null;
  institutionId: number | null;
  institutionName?: string | null;
  minGrade: string;
  maxCourseAgeYears: number | null;
  capTransfer: number;
  capFirstYear: number;
  capCurrentStudent: number;
  allowPassFail: boolean;
  requireAccreditation: boolean;
  hubRequirementsTransfer: number;
  hubCocurricularAllowed: number;
}

export interface CourseAppealSummary {
  id: number;
  status: 'submitted' | 'decided' | 'withdrawn';
  outcome: 'equivalent' | 'elective' | 'no_credit' | 'denied' | null;
  denialReason: string | null;
  comments: string | null;
}

export interface Appeal {
  id: number;
  transcriptId: string;
  courseId: string;
  status: 'submitted' | 'decided' | 'withdrawn';
  outcome: 'equivalent' | 'elective' | 'no_credit' | 'denied' | null;
  reason: string;
  proposedEquivalent: string | null;
  syllabusUploadId: string | null;
  proposedCourseId: number | null;
  proposedCode: string | null;
  proposedTitle: string | null;
  decidedCode: string | null;
  decidedTitle: string | null;
  awardedCredits: number | null;
  satisfiesRequirement: string | null;
  denialReason: string | null;
  departmentName: string | null;
  comments: string | null;
  signedName: string | null;
  decidedAt: string | null;
  createdAt: string;
  courseCode: string;
  courseTitle: string;
  credits: number;
  grade: string;
  termSeason: string | null;
  termYear: number | null;
  lane: string;
  currentOutcome: string | null;
  currentCode: string | null;
  currentCredits: number | null;
  institutionName: string;
  calendar: string;
  studentName: string;
  buid: string | null;
  studentSchool: string | null;
  targetInstitutionId: number | null;
}

export interface StudentApplicationProfile {
  applicantType?: string | null;
  admissionStatus?: string | null;
  buid?: string | null;
  intendedSchool?: string | null;
  targetUniversity?: string | null;
  targetProgram?: string | null;
  entryTerm?: string | null;
  entryYear?: number | null;
  isNativeEnglish?: boolean | null;
  englishTestType?: string | null;
  englishTestScore?: string | null;
  hasIntlCoursework?: boolean | null;
  highSchoolName?: string | null;
  highSchoolGradYear?: number | null;
  creditsCompleted?: number | null;
  education: {
    institutionName: string; city: string | null; stateRegion: string | null; country: string | null; isOutsideUS: boolean;
    fromYear: number | null; toYear: number | null; creditsEarned: number | null; fullTime: boolean | null;
  }[];
  exams: { examType: string; subject: string; score: string | null; examYear: number | null; credits: number | null }[];
}

export const APPLICANT_TYPE_LABEL: Record<string, string> = {
  transfer_applicant: 'Transfer applicant',
  admitted_transfer: 'Admitted transfer student',
  current_student: 'Current BU student (pre-approval)',
  dual_enrollment: 'Dual-enrollment (high school)',
};
