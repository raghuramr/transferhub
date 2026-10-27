/**
 * Pure derivation of the demo walkthrough state from what is in the database.
 * No I/O: DemoService gathers the facts, this turns them into per-step status for the presenter UI.
 */

export type StepState = 'done' | 'current' | 'upcoming';

export interface DemoCourseFact {
  transcriptId: string;
  institutionCode: string;
  code: string;
  lane: string;
  status: string;               // TranscriptCourses.Status: pending | in_review | decided | posted
  evalStatus: string | null;    // Evaluations.Status when there is one
  normalisedCredits: number | null;
  originalCredits: number;
}

export interface DemoSecondStudentFact {
  transcriptId: string;
  lane: string | null;
}

export interface DemoFacts {
  courses: DemoCourseFact[];            // Maya's demo courses
  csc220EquivalencyExists: boolean;
  secondStudent: DemoSecondStudentFact | null;
}

export interface DemoStep {
  key: 'upload' | 'instant_status' | 'syllabus' | 'workbench' | 'quarter' | 'posting' | 'learning_loop';
  state: StepState;
  detail: string;
}

export type LearningLoop = 'not_ready' | 'ready' | 'not_applied' | 'proven';

export interface DemoState {
  present: boolean;
  steps: DemoStep[];
  secureCredits: number;          // credits already settled at upload (applied lane)
  learningLoop: LearningLoop;
}

const isDecided = (c?: DemoCourseFact) => !!c && (c.status === 'decided' || c.status === 'posted' || c.evalStatus === 'decided' || c.evalStatus === 'posted');
const find = (cs: DemoCourseFact[], code: string) => cs.find((c) => c.code === code);

export function deriveDemoState(f: DemoFacts): DemoState {
  const cs = f.courses;
  const present = cs.length > 0;
  const secureCredits = round2(cs.filter((c) => c.lane === 'applied').reduce((s, c) => s + (c.normalisedCredits ?? c.originalCredits), 0));
  const c220 = find(cs, 'CSC 220');
  const c240 = find(cs, 'CSC 240');
  const c150 = find(cs, 'CIS 150');
  const maybes = cs.filter((c) => c.code === 'CSC 220' || c.code === 'CSC 240');
  const allPosted = present && cs.every((c) => c.status === 'posted');

  let learningLoop: LearningLoop = 'not_ready';
  if (f.secondStudent) learningLoop = f.secondStudent.lane === 'applied' ? 'proven' : 'not_applied';
  else if (f.csc220EquivalencyExists) learningLoop = 'ready';

  const done: Record<DemoStep['key'], boolean> = {
    upload: present,
    instant_status: present,
    syllabus: present && maybes.length === 2 && maybes.every(isDecided),
    workbench: isDecided(c220),
    quarter: isDecided(c150),
    posting: allPosted,
    learning_loop: learningLoop === 'proven',
  };

  const detail: Record<DemoStep['key'], string> = {
    upload: present ? `${cs.length} courses on 2 transcripts` : 'Scenario not loaded - press "Reset Maya scenario"',
    instant_status: present ? `${secureCredits} credits secure (3 applied automatically)` : 'Waiting for the scenario',
    syllabus: !present ? 'Waiting for the scenario' : done.syllabus ? 'CSC 220 and CSC 240 decided' : `Syllabus needed for ${maybes.filter((c) => !isDecided(c)).map((c) => c.code).join(' and ') || 'CSC 220 and CSC 240'}`,
    workbench: !present ? 'Waiting for the scenario' : isDecided(c220) ? 'CSC 220 decided' : 'CSC 220: pick the BU equivalent (CS 112 ranked first)',
    quarter: !present ? 'Waiting for the scenario' : isDecided(c150) ? 'CIS 150 decided' : 'CIS 150: 4 quarter credits = 2.66 semester credits vs MA 242 (4)',
    posting: !present ? 'Waiting for the scenario' : allPosted ? 'All six courses posted' : `${cs.filter((c) => c.status === 'posted').length} of ${cs.length} posted`,
    learning_loop:
      learningLoop === 'proven' ? 'Second student\'s CSC 220 was applied automatically'
      : learningLoop === 'not_applied' ? 'Second student added but CSC 220 was NOT auto-applied - decide CSC 220 for Maya first, then add again'
      : learningLoop === 'ready' ? 'CSC 220 now has an equivalency - add the second student'
      : 'Decide CSC 220 for Maya first',
  };

  const order: DemoStep['key'][] = ['upload', 'instant_status', 'syllabus', 'workbench', 'quarter', 'posting', 'learning_loop'];
  let currentSet = false;
  const steps: DemoStep[] = order.map((key) => {
    let state: StepState;
    if (done[key]) state = 'done';
    else if (!currentSet) { state = 'current'; currentSet = true; }
    else state = 'upcoming';
    return { key, state, detail: detail[key] };
  });

  return { present, steps, secureCredits, learningLoop };
}

function round2(n: number) { return Math.round(n * 100) / 100; }
