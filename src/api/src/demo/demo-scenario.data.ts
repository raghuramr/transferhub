/**
 * The "Maya Rivera" six-course demo scenario (brief: understanding/09_demo_scenario.md).
 * Mirrors database/seed/015_demo_maya_scenario.sql section 3 - keep the two in step.
 * The catalogue (BSCC / PVTC courses, topics, the existing equivalencies) is NOT created here:
 * that is seed 015's job and is never touched by a reset.
 */

export const DEMO_NOTE_PREFIX = 'Demo scenario';
export const MAYA_EMAIL = 'student@test.edu';
export const NOAH_EMAIL = 'noah.chen@transferdemo.edu';

export interface DemoCourse {
  code: string;
  title: string;
  credits: number;
  grade: string;
  term: string;
  lane: 'applied' | 'needs_syllabus';
}

export interface DemoSuggestion {
  confidence: number;
  buCode: string;
  why: string;
  candidates: Array<{ rank: number; buCode: string; score: number; why: string }>;
}

export interface DemoTranscript {
  key: 'bscc' | 'pvtc';
  institutionCode: string;
  notes: string;
  courses: DemoCourse[];
}

export const DEMO_TRANSCRIPTS: DemoTranscript[] = [
  {
    key: 'bscc',
    institutionCode: 'BSCC',
    notes: 'Demo scenario (synthetic): Maya Rivera - Bay State Community College (semester). 3 known equivalencies, 2 maybes.',
    courses: [
      { code: 'CSC 110', title: 'Introduction to Programming', credits: 4, grade: 'A', term: 'Fall 2025', lane: 'applied' },
      { code: 'MAT 210', title: 'Calculus I', credits: 4, grade: 'B+', term: 'Fall 2025', lane: 'applied' },
      { code: 'ECO 101', title: 'Principles of Microeconomics', credits: 3, grade: 'B', term: 'Spring 2026', lane: 'applied' },
      { code: 'CSC 220', title: 'Data Structures & Program Design', credits: 4, grade: 'A-', term: 'Spring 2026', lane: 'needs_syllabus' },
      { code: 'CSC 240', title: 'Discrete Math for Computing', credits: 4, grade: 'B', term: 'Spring 2026', lane: 'needs_syllabus' },
    ],
  },
  {
    key: 'pvtc',
    institutionCode: 'PVTC',
    notes: 'Demo scenario (synthetic): Maya Rivera - Pioneer Valley Technical College (quarter system). 4 quarter credits = 2.66 semester credits.',
    courses: [
      { code: 'CIS 150', title: 'Linear Algebra', credits: 4, grade: 'B', term: 'Winter 2026', lane: 'needs_syllabus' },
    ],
  },
];

/** Rules-matcher suggestions the seed attaches to the three "maybe" courses (confidence capped at 0.7). */
export const DEMO_SUGGESTIONS: Record<string, DemoSuggestion> = {
  'CSC 220': {
    confidence: 0.62, buCode: 'CAS CS 112',
    why: 'title/topic words in common: data, structures; description overlap: stacks, queues, linked, trees; credits are close (4 vs 4). Please verify against the syllabus.',
    candidates: [
      { rank: 1, buCode: 'CAS CS 112', score: 0.62, why: 'data structures, object-oriented design, sorting and searching overlap.' },
      { rank: 2, buCode: 'CAS CS 111', score: 0.31, why: 'introductory programming content; weaker topic overlap.' },
      { rank: 3, buCode: 'CAS CS 330', score: 0.22, why: 'algorithm-efficiency overlap only.' },
    ],
  },
  'CSC 240': {
    confidence: 0.58, buCode: 'CAS CS 131',
    why: 'title/topic words in common: discrete, counting; description overlap: logic, induction, combinatorics; credits are close (4 vs 4). Please verify against the syllabus.',
    candidates: [
      { rank: 1, buCode: 'CAS CS 131', score: 0.58, why: 'logic, induction, counting, graphs overlap.' },
      { rank: 2, buCode: 'CAS MA 293', score: 0.55, why: 'discrete mathematics: sets, logic, induction overlap.' },
      { rank: 3, buCode: 'CAS CS 112', score: 0.18, why: 'trees/graphs mentioned; weak overlap.' },
    ],
  },
  'CIS 150': {
    confidence: 0.66, buCode: 'CAS MA 242',
    why: 'title/topic words in common: linear, algebra; description overlap: vector, matrices, eigenvalues. Credits differ (2.66 vs 4) - quarter conversion applied. Please verify against the syllabus.',
    candidates: [
      { rank: 1, buCode: 'CAS MA 242', score: 0.66, why: 'linear algebra topics match; credits differ after quarter conversion (2.66 vs 4).' },
      { rank: 2, buCode: 'CAS CS 132', score: 0.3, why: 'vectors/matrices; BU notes MA 242 may substitute for CS 132.' },
    ],
  },
};

/** The three equivalencies that exist before the demo (so lane = applied). Re-added on reset if missing. */
export const KNOWN_EQUIVALENCIES = [
  { ext: 'CSC 110', bu: 'CAS CS 111', credits: 4, why: 'Intro programming; outcomes and topics match CS 111 (demo: existing equivalency).' },
  { ext: 'MAT 210', bu: 'CAS MA 123', credits: 4, why: 'Single-variable Calculus I (demo: existing equivalency).' },
  { ext: 'ECO 101', bu: 'CAS EC 101', credits: 3, why: 'Principles of microeconomics; credit applied as taken (3) - the demo shows credit-policy handling.' },
];

/** The only external courses whose equivalencies are removed on reset (the decisions the presenter makes). */
export const DEMO_DECISION_COURSES = [
  { institutionCode: 'BSCC', code: 'CSC 220' },
  { institutionCode: 'BSCC', code: 'CSC 240' },
  { institutionCode: 'PVTC', code: 'CIS 150' },
];

/** Equivalency sources written by the seeds - never deleted by a reset. */
export const SEED_EQUIVALENCY_SOURCES = ['synthetic', 'workbook'];

export const NOAH = {
  firstName: 'Noah',
  lastName: 'Chen',
  institutionCode: 'BSCC',
  institutionName: 'Bay State Community College',
  notes: 'Demo scenario (learning loop, synthetic): Noah Chen - same college, same course (CSC 220) as Maya.',
  course: { code: 'CSC 220', title: 'Data Structures & Program Design', credits: 4, grade: 'A-', term: 'Fall 2025', termSeason: 'fall', termYear: 2025 },
};
