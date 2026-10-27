// Run: npx tsx scripts/test-exam-credit.ts
import assert from 'node:assert/strict';
import { buildProgress } from '../src/progress/progress.aggregate';
import {
  DEFAULT_EXAM_RULES, ExamRule, conditionalDocApplies, countedExamCredits, evaluateExam, evaluateExams, pickRule, scoreOrdinal, subjectMatches,
} from '../src/policy/exam-credit';

// Ordinal mapping per exam
assert.equal(scoreOrdinal('AP', '5'), 5); assert.equal(scoreOrdinal('AP', '6'), null); assert.equal(scoreOrdinal('AP', '0'), null); assert.equal(scoreOrdinal('AP', 'x'), null);
assert.equal(scoreOrdinal('IB', '7'), 7); assert.equal(scoreOrdinal('IB', '8'), null);
assert.equal(scoreOrdinal('CLEP', '50'), 50); assert.equal(scoreOrdinal('CLEP', '19'), null); assert.equal(scoreOrdinal('CLEP', '81'), null);
assert.equal(scoreOrdinal('A-level', 'A*'), 6); assert.equal(scoreOrdinal('A-level', 'a'), 5); assert.equal(scoreOrdinal('A-level', 'E'), 1); assert.equal(scoreOrdinal('A-level', 'F'), null);
assert.ok(scoreOrdinal('A-level', 'A*')! > scoreOrdinal('A-level', 'A')!);
assert.equal(scoreOrdinal('AP', null), null); assert.equal(scoreOrdinal('AP', '  '), null);

// Subject patterns
assert.ok(subjectMatches(null, 'Calculus BC')); assert.ok(subjectMatches('', 'x'));
assert.ok(subjectMatches('HL|Higher Level', 'Physics HL')); assert.ok(subjectMatches('HL|Higher Level', 'physics (higher level)'));
assert.ok(!subjectMatches('HL', 'Physics SL')); assert.ok(!subjectMatches('HL', 'Philharmonic')); // whole word only

const R = DEFAULT_EXAM_RULES;
const ev = (examType: string, subject: string, score: string | null, credits: number | null = null, inst: number | null = null, rules = R) =>
  evaluateExam({ examType, subject, score, credits }, rules, inst);

// AP >= 3
assert.equal(ev('AP', 'Calculus BC', '2').state, 'below_minimum');
assert.equal(ev('AP', 'Calculus BC', '2').message, 'AP Calculus BC score 2 is below the minimum of 3 - not counted.');
assert.equal(ev('AP', 'Calculus BC', '3').state, 'counts'); assert.equal(ev('AP', 'Calculus BC', '5').state, 'counts');
// IB: HL 5+, SL no rule -> review
assert.equal(ev('IB', 'Physics HL', '4').state, 'below_minimum'); assert.equal(ev('IB', 'Physics HL', '5').state, 'counts');
assert.equal(ev('IB', 'Physics SL', '7').state, 'review');
// CLEP >= 50, A-level C or better
assert.equal(ev('CLEP', 'College Algebra', '49').state, 'below_minimum'); assert.equal(ev('CLEP', 'College Algebra', '50').state, 'counts');
assert.equal(ev('A-level', 'Maths', 'D').state, 'below_minimum'); assert.equal(ev('A-level', 'Maths', 'C').state, 'counts'); assert.equal(ev('A-level', 'Maths', 'A*').state, 'counts');
// Missing / invalid score -> review, never a silent denial
assert.equal(ev('AP', 'Biology', null).state, 'review'); assert.equal(ev('AP', 'Biology', '9').state, 'review');
assert.ok(ev('AP', 'Biology', null).message.includes('no score'));

// Rule choice: specific pattern beats "any"; a university's own rules replace the global ones for that exam type
const rules: ExamRule[] = [
  ...R,
  { institutionId: 7, examType: 'AP', subjectPattern: null, minScore: '4', creditsAwarded: 4, isActive: true },
  { institutionId: 7, examType: 'AP', subjectPattern: 'Calculus', minScore: '3', creditsAwarded: 8, isActive: true },
  { institutionId: 7, examType: 'CLEP', subjectPattern: null, minScore: '60', creditsAwarded: null, isActive: false },
];
assert.equal(pickRule(rules, 7, 'AP', 'Calculus BC')?.minScore, '3');
assert.equal(pickRule(rules, 7, 'AP', 'Biology')?.minScore, '4');
assert.equal(pickRule(rules, 99, 'AP', 'Biology')?.minScore, '3'); // another university: global
assert.equal(pickRule(rules, 7, 'CLEP', 'x')?.minScore, '50'); // inactive own rule ignored -> global
assert.equal(ev('AP', 'Biology', '3', null, 7, rules).state, 'below_minimum');
assert.equal(ev('AP', 'Calculus AB', '3', null, 7, rules).countedCredits, 8); // rule credits when the student's own is unset
assert.equal(ev('AP', 'Calculus AB', '3', 4, 7, rules).countedCredits, 4); // the student's evaluated credits win
assert.equal(pickRule(R.map((r) => ({ ...r, isActive: false })), null, 'AP', 'x'), null);

// Cap counting: only qualifying exams count
const res = evaluateExams([
  { examType: 'AP', subject: 'Calculus BC', score: '5', credits: 8 },
  { examType: 'AP', subject: 'Chemistry', score: '2', credits: 4 },
  { examType: 'IB', subject: 'History HL', score: '6', credits: 6 },
  { examType: 'IB', subject: 'Economics HL', score: '3', credits: 4 },
  { examType: 'A-level', subject: 'Physics', score: 'E', credits: 4 },
  { examType: 'CLEP', subject: 'Spanish', score: '55', credits: null },
], R, null);
assert.deepEqual(res.map((r) => r.state), ['counts', 'below_minimum', 'counts', 'below_minimum', 'below_minimum', 'counts']);
assert.equal(countedExamCredits(res), 14);

// Progress: exams flow through to the card and the cap uses only the qualifying credits
const pr = buildProgress([], { cap: 68, examCredits: countedExamCredits(res), exams: res, likelyThreshold: 0.75, hubRequirements: 10, hubCocurricularAllowed: 1 });
assert.equal(pr.cap.examCredits, 14); assert.equal(pr.cap.used, 14); assert.equal(pr.exams.filter((e) => e.state === 'below_minimum').length, 3);
assert.deepEqual(buildProgress([], { cap: 68, examCredits: 0, likelyThreshold: 0.75, hubRequirements: 10, hubCocurricularAllowed: 1 }).exams, []);

// Document checklist conditions
const ctx = (o: Partial<Parameters<typeof conditionalDocApplies>[1]> = {}) => ({ outsideUS: false, nativeEnglish: true as boolean | null, hasExamCredits: false, ...o });
assert.equal(conditionalDocApplies('credential_evaluation', ctx()), false);
assert.equal(conditionalDocApplies('credential_evaluation', ctx({ outsideUS: true })), true);
assert.equal(conditionalDocApplies('certified_translation', ctx({ outsideUS: true, nativeEnglish: false })), true);
assert.equal(conditionalDocApplies('certified_translation', ctx({ outsideUS: true, nativeEnglish: true })), false); // English transcripts need no translation
assert.equal(conditionalDocApplies('certified_translation', ctx({ outsideUS: false, nativeEnglish: false })), false);
assert.equal(conditionalDocApplies('certified_translation', ctx({ outsideUS: true, nativeEnglish: null })), false);
assert.equal(conditionalDocApplies('exam_score_report', ctx()), false);
assert.equal(conditionalDocApplies('exam_score_report', ctx({ hasExamCredits: true })), true);
assert.equal(conditionalDocApplies('syllabus', ctx({ outsideUS: true })), null);

console.log('exam-credit: all assertions passed');
