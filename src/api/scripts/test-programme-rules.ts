// Run: npx tsx scripts/test-programme-rules.ts
import assert from 'node:assert/strict';
import {
  ProgramRule, RuleCourse, RuleType, evaluateProgrammeRules, levelOf, mergeOwnedFlags, parseCode, splitPattern, validateRuleInput,
} from '../src/policy/programme-rules';

const rule = (o: Partial<ProgramRule> & { ruleType: RuleType }): ProgramRule => ({
  id: 1, institutionId: 1, institutionCode: 'BU', programId: 10, programName: 'Economics BA', ruleCode: null,
  levelMin: null, maxCount: null, minCount: null, courseCodePattern: null, substituteFor: null, params: {},
  description: 'x', isActive: true, ...o,
});
const course = (id: string, code: string, bu: string[] = [], o: Partial<RuleCourse> = {}): RuleCourse => ({ id, code, lane: 'applied', buCodes: bu, ...o });
const msgs = (m: Map<string, { message: string }[]>, id: string) => (m.get(id) ?? []).map((f) => f.message);

// ── code parsing is flexible about the college prefix ──
assert.deepEqual(parseCode('CAS CS 320'), { dept: 'CS', num: 320 });
assert.deepEqual(parseCode('cs320'), { dept: 'CS', num: 320 });
assert.deepEqual(parseCode('QST QM 221'), { dept: 'QM', num: 221 });
assert.deepEqual(parseCode('CHEM 1161'), { dept: 'CHEM', num: 1161 });
assert.deepEqual(parseCode('BI'), { dept: 'BI', num: null });
assert.equal(parseCode(''), null);
assert.equal(levelOf(2100), 200);
assert.equal(levelOf(242), 200);
assert.equal(levelOf(1161), 100);
assert.equal(splitPattern('CS 320|CS 332, CS 350').length, 3);

// ── PRG-03 required at home: transferred CS 320 is flagged for review, others untouched ──
{
  const r = rule({ ruleType: 'required_at_home', programName: 'Computer Science BA', courseCodePattern: 'CS 320|CS 332|CS 350' });
  const out = evaluateProgrammeRules([r], [course('a', 'NU CS 4400', ['CAS CS 320']), course('b', 'NU CS 2100', ['CAS CS 112'])]);
  assert.equal(out.get('a')![0].severity, 'review');
  assert.equal(out.get('a')![0].code, 'program_at_home');
  assert.match(out.get('a')![0].message, /CS 320 must be taken at BU/);
  assert.equal(out.has('b'), false);
  // enforcement info just explains
  const soft = evaluateProgrammeRules([rule({ ruleType: 'required_at_home', courseCodePattern: 'PS 231', params: { enforcement: 'info' } })], [course('a', 'X', ['CAS PS 231'])]);
  assert.equal(soft.get('a')![0].severity, 'info');
}

// ── PRG-04 max 4 at 200+: 5 listed -> all five flagged, 4 are fine ──
{
  const r = rule({ ruleType: 'max_transfer_at_level', levelMin: 200, maxCount: 4 });
  const five = ['EC 201', 'EC 202', 'EC 301', 'EC 311', 'EC 345'].map((c, i) => course(`c${i}`, `X ${c}`, [`CAS ${c}`]));
  const low = course('low', 'X 101', ['CAS EC 101']);
  const out = evaluateProgrammeRules([r], [...five, low]);
  assert.equal(out.size, 5);
  assert.equal(out.has('low'), false);
  assert.match(msgs(out, 'c0')[0], /Economics BA allows at most 4 transferred courses at 200\+ level \(5 listed\)/);
  assert.equal(out.get('c0')![0].severity, 'review');
  // exactly 4 -> nothing; unmapped course falls back to the external code's level (NU 2100 = 200 level)
  assert.equal(evaluateProgrammeRules([r], five.slice(0, 4)).size, 0);
  const ext = ['2100', '2200', '3100', '3200', '4100'].map((n, i) => course(`e${i}`, `ECON ${n}`));
  assert.equal(evaluateProgrammeRules([r], ext).size, 5);
}

// ── PRG-05 min at home with excluded intro courses ──
{
  const r = rule({ ruleType: 'min_at_home', programName: 'Biology BA', minCount: 5, courseCodePattern: 'BI', params: { excludeCodes: ['BI 107', 'BI 108'] } });
  const out = evaluateProgrammeRules([r], [course('a', 'BIOL 1107', ['CAS BI 107']), course('b', 'BIOL 3300', ['CAS BI 315']), course('c', 'CHEM 1', ['CAS CH 101'])]);
  assert.equal(out.has('a'), false, 'BI 107 is excluded');
  assert.equal(out.has('c'), false, 'other departments untouched');
  assert.match(msgs(out, 'b')[0], /at least 5 BI courses beyond BI 107\/BI 108 taken at BU/);
}

// ── PRG-06 not principal + residency count ──
{
  const np = rule({ ruleType: 'not_principal', programName: 'Psychology BA', courseCodePattern: 'PS 211' });
  const out = evaluateProgrammeRules([np], [course('a', 'PSYC 2', ['CAS PS 211']), course('b', 'PSYC 3', ['CAS PS 231'])]);
  assert.match(msgs(out, 'a')[0], /PS 211 is not counted as a principal course/);
  assert.equal(out.get('a')![0].severity, 'info');
  assert.equal(out.has('b'), false);
  const rc = rule({ ruleType: 'residency_courses_count', minCount: 10, courseCodePattern: 'PS' });
  const o2 = evaluateProgrammeRules([rc], [course('a', 'P', ['CAS PS 231'])]);
  assert.equal(o2.get('a')![0].severity, 'info');
  const capped = rule({ ruleType: 'residency_courses_count', maxCount: 1, courseCodePattern: 'PS' });
  const o3 = evaluateProgrammeRules([capped], [course('a', 'P', ['CAS PS 231']), course('b', 'Q', ['CAS PS 241'])]);
  assert.equal(o3.get('a')![0].severity, 'review');
}

// ── PRG-08 substitutions ──
{
  const sub = rule({ ruleType: 'substitution', programName: 'Computer Science BA', courseCodePattern: 'CS 132', substituteFor: 'MA 242', params: { bidirectional: true } });
  const o1 = evaluateProgrammeRules([sub], [course('a', 'MATH', ['CAS MA 242'])]);
  assert.match(msgs(o1, 'a')[0], /substitution available: MA 242 may be satisfied by CS 132/);
  const o2 = evaluateProgrammeRules([sub], [course('a', 'CSCI', ['CAS CS 132'])]);
  assert.match(msgs(o2, 'a')[0], /CS 132 may satisfy MA 242/);
  assert.equal(o1.get('a')![0].code, 'program_substitution');
  const ec = rule({ ruleType: 'substitution', courseCodePattern: 'MA 115|MA 213|QM 221', substituteFor: 'EC 203' });
  const o3 = evaluateProgrammeRules([ec], [course('a', 'Q', ['QST QM 221'])]);
  assert.match(msgs(o3, 'a')[0], /QM 221 may satisfy EC 203/);
  // allOf: MA 115 + MA 116 -> PS 211
  const all = rule({ ruleType: 'substitution', courseCodePattern: 'MA 115|MA 116', substituteFor: 'PS 211', params: { allOf: true } });
  const one = evaluateProgrammeRules([all], [course('a', 'M1', ['CAS MA 115'])]);
  assert.match(msgs(one, 'a')[0], /only MA 115 is on this request/);
  const both = evaluateProgrammeRules([all], [course('a', 'M1', ['CAS MA 115']), course('b', 'M2', ['CAS MA 116'])]);
  assert.match(msgs(both, 'a')[0], /MA 115 \+ MA 116 together may satisfy PS 211/);
  assert.match(msgs(both, 'b')[0], /together may satisfy PS 211/);
}

// ── never flags blocked/outside-US courses, ignores inactive rules, dedupes ──
{
  const r = rule({ ruleType: 'required_at_home', courseCodePattern: 'CS 320' });
  const out = evaluateProgrammeRules(
    [r, { ...r, id: 2 }, rule({ ruleType: 'required_at_home', courseCodePattern: 'CS 332', isActive: false })],
    [course('a', 'X', ['CS 320']), course('n', 'X', ['CS 320'], { lane: 'not_eligible' }), course('i', 'X', ['CS 320'], { isOutsideUS: true }), course('z', 'X', ['CS 332'])],
  );
  assert.equal(out.get('a')!.length, 1, 'duplicate rule does not repeat the flag');
  assert.equal(out.has('n'), false);
  assert.equal(out.has('i'), false);
  assert.equal(out.has('z'), false, 'inactive rule ignored');
  assert.equal(evaluateProgrammeRules([], [course('a', 'X', ['CS 320'])]).size, 0);
}

// ── merging keeps foreign flags, replaces our own ──
{
  const existing = [
    { code: 'too_old', severity: 'review', message: 'old' },
    { code: 'program_rule', severity: 'info', message: 'stale' },
    { code: 'program_at_home', severity: 'review', message: 'stale2' },
  ];
  const merged = mergeOwnedFlags(existing, [{ code: 'program_rule', severity: 'review', message: 'fresh' }]);
  assert.deepEqual(merged.map((f) => f.message), ['old', 'fresh']);
  assert.deepEqual(mergeOwnedFlags(merged, merged.filter((f) => f.code === 'program_rule')).map((f) => f.message), ['old', 'fresh']);
}

// ── validation per rule type ──
{
  assert.ok(validateRuleInput({ ruleType: 'nope', description: 'x' }).length);
  assert.deepEqual(validateRuleInput({ ruleType: 'max_transfer_at_level', levelMin: 200, maxCount: 4, description: 'ok' }), []);
  assert.ok(validateRuleInput({ ruleType: 'max_transfer_at_level', description: 'x' }).length >= 2);
  assert.deepEqual(validateRuleInput({ ruleType: 'min_at_home', minCount: 5, courseCodePattern: 'BI', description: 'ok' }), []);
  assert.ok(validateRuleInput({ ruleType: 'min_at_home', minCount: 5, description: 'x' }).length);
  assert.deepEqual(validateRuleInput({ ruleType: 'required_at_home', courseCodePattern: 'CS 320|CS 332', description: 'ok' }), []);
  assert.ok(validateRuleInput({ ruleType: 'required_at_home', description: 'x' }).length);
  assert.ok(validateRuleInput({ ruleType: 'substitution', courseCodePattern: 'CS 132', description: 'x' }).length, 'substitution needs the course it substitutes for');
  assert.deepEqual(validateRuleInput({ ruleType: 'substitution', courseCodePattern: 'CS 132', substituteFor: 'MA 242', description: 'ok' }), []);
  assert.deepEqual(validateRuleInput({ ruleType: 'not_principal', courseCodePattern: 'PS 211', description: 'ok' }), []);
  assert.ok(validateRuleInput({ ruleType: 'residency_courses_count', description: 'x' }).length);
  assert.deepEqual(validateRuleInput({ ruleType: 'residency_courses_count', minCount: 10, description: 'ok' }), []);
  assert.ok(validateRuleInput({ ruleType: 'min_at_home', minCount: -1, courseCodePattern: 'BI', description: 'x' }).length);
  assert.ok(validateRuleInput({ ruleType: 'required_at_home', courseCodePattern: 'CS 320', description: '   ' }).length, 'description required');
}

console.log('programme rules: all checks passed');
