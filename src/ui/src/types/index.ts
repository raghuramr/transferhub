// ─── Auth & Users ────────────────────────────────────────────
export type Role = 'student' | 'faculty' | 'admin' | 'agency' | 'super_admin';

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  departmentId?: number;
  departmentName?: string;
  studentId?: string;
  agencyName?: string;
  isActive: boolean;
  isLocked: boolean;
  mustChangePass: boolean;
  lastLoginAt?: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  user: User;
}

// ─── Courses ─────────────────────────────────────────────────
export interface Course {
  id: number;
  institutionCode: string;
  institutionName: string;
  code: string;
  title: string;
  programArea?: string;
  requirementType?: string;
  credits: number;
  description?: string;
  learningOutcomes?: string;
  verified: string;
  notes?: string;
}

export interface Equivalency {
  id: number;
  externalCourse: Course;
  buCourse: Course;
  outcome: 'equivalent' | 'elective' | 'no_credit' | 'bu_only';
  buCredits?: number;
  matchLevel?: string;
  rationale?: string;
  source: string;
}

// ─── Transcripts ─────────────────────────────────────────────
export type CourseLane =
  | 'pending'
  | 'applied'
  | 'likely'
  | 'needs_syllabus'
  | 'elective_only'
  | 'not_eligible';

export type CourseStatus = 'pending' | 'in_review' | 'decided' | 'posted';

export interface TranscriptCourse {
  id: string;
  courseCode: string;
  courseTitle: string;
  originalCredits: number;
  normalisedCredits?: number;
  grade: string;
  gradeIsEligible?: boolean;
  term?: string;
  lane: CourseLane;
  status: CourseStatus;
  externalCourse?: Course;
  evaluation?: Evaluation;
}

export interface Transcript {
  id: string;
  studentUserId: string;
  studentName?: string;
  institution: { id: number; code: string; name: string; calendar: string };
  status: 'received' | 'processing' | 'complete';
  receivedAt: string;
  processedAt?: string;
  courses: TranscriptCourse[];
}

// ─── Evaluations ─────────────────────────────────────────────
export type EvalOutcome = 'equivalent' | 'elective' | 'no_credit' | 'bu_only';
export type EvalStatus = 'queued' | 'in_progress' | 'decided' | 'posted';

export interface AICandidate {
  rank: number;
  buCourse: Course;
  score: number;
  rationale: string;
}

export interface Evaluation {
  id: string;
  transcriptCourseId: string;
  status: EvalStatus;
  departmentId?: number;
  departmentName?: string;
  assignedTo?: { id: string; name: string };
  aiCandidates?: AICandidate[];
  aiConfidence?: number;
  outcome?: EvalOutcome;
  decidedBUCourse?: Course;
  awardedCredits?: number;
  evaluatorNotes?: string;
  decidedAt?: string;
  queuedAt: string;
}

// ─── Common ───────────────────────────────────────────────────
export interface PagedResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ApiError {
  statusCode: number;
  message: string;
  error?: string;
}
