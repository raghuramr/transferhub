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
  mobile?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  country?: string;
  countryOfOrigin?: string;
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

/**
 * Summary shape returned by `GET /transcripts` (list view). `courseCount` is
 * present on the plain admin listing; the student/agency "mine" listing
 * additionally returns the per-course `lane` breakdown used for the dashboard
 * tally — both are optional here since which fields come back depends on
 * the query (see `transcripts.service.ts`).
 */
export interface TranscriptSummary {
  id: string;
  studentName?: string;
  institution?: { id: number; code: string; name: string };
  courseCount?: number;
  courses?: TranscriptCourse[];
  status: 'received' | 'processing' | 'complete';
  receivedAt: string;
}

export interface Transcript {
  id: string;
  studentUserId: string;
  studentName?: string;
  institution: { id: number; code: string; name: string; calendar: string };
  status: 'received' | 'processing' | 'complete';
  receivedAt: string;
  processedAt?: string;
  documentFileName?: string | null;
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

// ─── Custom Pages (CMS) ────────────────────────────────────────
export type BlockType = 'hero' | 'heading' | 'richtext' | 'notice' | 'cards' | 'cta' | 'divider' | 'image';
export type NoticeTone = 'info' | 'warning' | 'success';

export interface BlockBase {
  id: string;
  type: BlockType;
  visible: boolean;
}

export interface HeroBlock extends BlockBase {
  type: 'hero';
  title: string;
  subtitle?: string;
  ctaLabel?: string;
  ctaHref?: string;
}

export interface HeadingBlock extends BlockBase {
  type: 'heading';
  text: string;
  subtitle?: string;
}

export interface RichTextBlock extends BlockBase {
  type: 'richtext';
  html: string;
}

export interface NoticeBlock extends BlockBase {
  type: 'notice';
  tone: NoticeTone;
  text: string;
}

export interface CardItem {
  id: string;
  visible: boolean;
  title: string;
  body: string;
}

export interface CardsBlock extends BlockBase {
  type: 'cards';
  items: CardItem[];
}

export interface CtaBlock extends BlockBase {
  type: 'cta';
  text: string;
  buttonLabel: string;
  buttonHref: string;
}

export interface DividerBlock extends BlockBase {
  type: 'divider';
}

export interface ImageBlock extends BlockBase {
  type: 'image';
  url: string;
  caption?: string;
}

export type Block =
  | HeroBlock
  | HeadingBlock
  | RichTextBlock
  | NoticeBlock
  | CardsBlock
  | CtaBlock
  | DividerBlock
  | ImageBlock;

export interface CmsPage {
  id: number;
  slug: string;
  title: string;
  blocks: Block[];
  published: boolean;
  showInNav: boolean;
  navLabel?: string;
  navOrder: number;
  createdAt: string;
  updatedAt: string;
}

// ─── Custom Forms (JSON-schema driven) ─────────────────────────
export type FormFieldType =
  | 'text' | 'textarea' | 'email' | 'phone' | 'number' | 'date'
  | 'select' | 'radio' | 'checkboxes' | 'yesno' | 'file';

export interface FormField {
  key: string;
  label: string;
  type: FormFieldType;
  required?: boolean;
  options?: string[];       // select | radio | checkboxes
  placeholder?: string;
  helpText?: string;
}

export type FormStatus = 'draft' | 'open' | 'closed';

export interface FormDef {
  id: number;
  slug: string;
  title: string;
  description?: string;
  status: FormStatus;
  schema: { fields: FormField[] };
  successMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export type SubmissionStatus = 'new' | 'reviewed' | 'approved' | 'rejected';

export interface FormSubmission {
  id: string;
  formId: number;
  formTitle: string;
  submittedByName?: string;
  submittedByEmail?: string;
  data: Record<string, any>;
  status: SubmissionStatus;
  adminNotes?: string;
  submittedAt: string;
  decidedAt?: string;
}

// ─── Course Topics (syllabus-level detail + reference links) ──
export interface TopicReferenceLink {
  label: string;
  url: string;
}

export interface CourseTopic {
  id: number;
  courseId: number;
  title: string;
  description?: string;
  referenceLinks: TopicReferenceLink[];
  /** Only present when fetched with an institutionId (per-University override, migration 011). */
  isActiveForUniversity?: boolean;
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
