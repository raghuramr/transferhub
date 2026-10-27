/** Pure tests for the demo scenario: npx tsx scripts/test-demo-scenario.ts */
import { deriveDemoState, DemoCourseFact } from '../src/demo/demo-scenario.logic';
import { DEMO_TRANSCRIPTS, DEMO_SUGGESTIONS, DEMO_DECISION_COURSES, SEED_EQUIVALENCY_SOURCES, KNOWN_EQUIVALENCIES } from '../src/demo/demo-scenario.data';

let failed = 0;
const eq = (name: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n      expected ${JSON.stringify(expected)}\n      actual   ${JSON.stringify(actual)}`}`);
};

const mk = (code: string, lane: string, status = 'pending', cr = 4, n: number | null = null, inst = 'BSCC'): DemoCourseFact =>
  ({ transcriptId: inst, institutionCode: inst, code, lane, status, evalStatus: null, originalCredits: cr, normalisedCredits: n ?? cr });
const fresh = (): DemoCourseFact[] => [
  mk('CSC 110', 'applied'), mk('MAT 210', 'applied'), mk('ECO 101', 'applied', 'pending', 3),
  mk('CSC 220', 'needs_syllabus'), mk('CSC 240', 'needs_syllabus'), mk('CIS 150', 'needs_syllabus', 'pending', 4, 2.66, 'PVTC'),
];
const states = (s: ReturnType<typeof deriveDemoState>) => s.steps.map((x) => x.state[0]).join('');

// data invariants
eq('six courses in total', DEMO_TRANSCRIPTS.reduce((n, t) => n + t.courses.length, 0), 6);
eq('3 applied + 3 needing a decision', DEMO_TRANSCRIPTS.flatMap((t) => t.courses).map((c) => c.lane).sort(), ['applied', 'applied', 'applied', 'needs_syllabus', 'needs_syllabus', 'needs_syllabus']);
eq('quarter conversion 4 x 2/3 = 2.66', Math.floor(((4 * 2) / 3) * 100) / 100, 2.66);
eq('every needs_syllabus course has a suggestion with candidates', DEMO_TRANSCRIPTS.flatMap((t) => t.courses).filter((c) => c.lane === 'needs_syllabus').every((c) => DEMO_SUGGESTIONS[c.code]?.candidates.length >= 2), true);
eq('suggestion confidence stays below auto-approve (<= 0.7)', Object.values(DEMO_SUGGESTIONS).every((s) => s.confidence <= 0.7), true);
eq('decision courses are exactly the three maybes', DEMO_DECISION_COURSES.map((d) => d.code), ['CSC 220', 'CSC 240', 'CIS 150']);
eq('known equivalencies do not include the decision courses', KNOWN_EQUIVALENCIES.some((k) => ['CSC 220', 'CSC 240', 'CIS 150'].includes(k.ext)), false);
eq('seed sources are protected', SEED_EQUIVALENCY_SOURCES, ['synthetic', 'workbook']);

// derivation
let s = deriveDemoState({ courses: [], csc220EquivalencyExists: false, secondStudent: null });
eq('empty: not present, first step current', [s.present, states(s)], [false, 'cuuuuuu']);

s = deriveDemoState({ courses: fresh(), csc220EquivalencyExists: false, secondStudent: null });
eq('fresh: 11 credits secure (4 + 4 + 3 as taken)', s.secureCredits, 11);
eq('fresh: steps 1-2 done, syllabus current', states(s), 'ddcuuuu');
eq('fresh: learning loop not ready', s.learningLoop, 'not_ready');

let c = fresh(); c[3].status = 'decided';
s = deriveDemoState({ courses: c, csc220EquivalencyExists: true, secondStudent: null });
eq('CSC 220 decided: workbench done, syllabus still current (CSC 240 open)', states(s), 'ddcduuu');
eq('CSC 220 decided: learning loop ready', s.learningLoop, 'ready');

c = fresh(); c[3].status = 'decided'; c[4].status = 'decided'; c[5].status = 'decided';
s = deriveDemoState({ courses: c, csc220EquivalencyExists: true, secondStudent: null });
eq('all maybes decided: posting current', states(s), 'dddddcu');

c = fresh().map((x) => ({ ...x, status: 'posted' }));
s = deriveDemoState({ courses: c, csc220EquivalencyExists: true, secondStudent: null });
eq('all posted: learning loop current', states(s), 'dddddd' + 'c');

s = deriveDemoState({ courses: c, csc220EquivalencyExists: true, secondStudent: { transcriptId: 'x', lane: 'applied' } });
eq('second student auto-applied: everything done', [states(s), s.learningLoop], ['ddddddd', 'proven']);

s = deriveDemoState({ courses: c, csc220EquivalencyExists: false, secondStudent: { transcriptId: 'x', lane: 'needs_syllabus' } });
eq('second student not applied: loop not proven', [states(s), s.learningLoop], ['dddddd' + 'c', 'not_applied']);

s = deriveDemoState({ courses: fresh().map((x) => ({ ...x, status: 'pending', evalStatus: x.lane === 'applied' ? null : 'decided' })), csc220EquivalencyExists: true, secondStudent: null });
eq('evaluation status alone counts as decided', s.steps[3].state, 'done');

console.log(failed ? `\n${failed} FAILED` : '\nAll demo scenario tests passed.');
process.exit(failed ? 1 : 0);
