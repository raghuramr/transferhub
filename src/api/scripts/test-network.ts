import assert from 'node:assert/strict';
import { aggregate, applyNetworkBoost, BOOST_MAX, BOOST_MIN, fillMonths, isEffective, networkBoost, normTitle, NetRow, OVERALL_CAP, RULES_CAP, toSupport, topAgreed } from '../src/network/network.logic';
import { NetworkService } from '../src/network/network.service';
import { AiService } from '../src/ai/ai.service';

/**
 * Offline checks for the equivalency network: aggregation, anonymisation, agreement, effective dates, boost bounds,
 * the service against a stubbed database, and the matcher hook (switch off by default). No database or network.
 */
const TODAY = new Date('2026-10-28T12:00:00Z');
const SECRET_NAMES = ['Northeastern', 'Cascade Valley', 'Lakeshore', 'Zeta Polytechnic'];

let n = 0;
function row(p: Partial<NetRow> & { recvInstId: number; recvInstName: string }): NetRow {
  return {
    extId: 1, extInstId: 50, buCourseId: 100 + (n++), buCode: 'XX 100', buTitle: 'Introduction to Programming', buCredits: 4, outcome: 'equivalent', awarded: null,
    decidedAt: '2026-05-01T00:00:00Z', createdAt: '2026-05-01T00:00:00Z', effectiveFrom: null, effectiveTo: null, isActive: true, ...p,
  };
}

const rows: NetRow[] = [
  row({ recvInstId: 1, recvInstName: 'Boston University', buCourseId: 10, buCode: 'CAS CS 111', buTitle: 'Introduction to Computer Science I', awarded: 4 }),
  row({ recvInstId: 2, recvInstName: 'Northeastern University', buCode: 'NU CS 2000', buTitle: 'Introduction to Computer Science 1', awarded: 4 }),
  row({ recvInstId: 3, recvInstName: 'Cascade Valley University', buCode: 'CVU 101', buTitle: 'Intro to Computer Science I', awarded: 3 }),
  row({ recvInstId: 4, recvInstName: 'Lakeshore Institute of Technology', buCode: 'LIT 110', buTitle: 'Programming Fundamentals', outcome: 'equivalent', awarded: 4 }),
  row({ recvInstId: 5, recvInstName: 'Zeta Polytechnic', buCode: 'ZP 90', buTitle: 'Computing Elective', outcome: 'elective', awarded: 3 }),
  // Not counted: inactive, expired, not yet effective.
  row({ recvInstId: 6, recvInstName: 'Inactive U', buTitle: 'Introduction to Computer Science I', isActive: false }),
  row({ recvInstId: 7, recvInstName: 'Expired U', buTitle: 'Introduction to Computer Science I', effectiveTo: '2025-12-31' }),
  row({ recvInstId: 8, recvInstName: 'Future U', buTitle: 'Introduction to Computer Science I', effectiveFrom: '2027-01-01' }),
];

(async () => {
  // normalisation
  assert.equal(normTitle('Calculus II'), normTitle('calculus 2'));
  assert.equal(normTitle('Introduction to Computer Science I'), normTitle('Intro to Computer Science 1'));

  // effective dates
  assert.equal(isEffective({ isActive: true, effectiveFrom: null, effectiveTo: '2025-12-31' }, TODAY), false);
  assert.equal(isEffective({ isActive: true, effectiveFrom: '2027-01-01', effectiveTo: null }, TODAY), false);
  assert.equal(isEffective({ isActive: true, effectiveFrom: '2026-10-28', effectiveTo: '2026-10-28' }, TODAY), true);
  assert.equal(isEffective({ isActive: false, effectiveFrom: null, effectiveTo: null }, TODAY), false);

  // aggregation (own = BU = 1)
  const agg = aggregate(rows, { ownInstitutionIds: [1], asOf: TODAY });
  assert.equal(agg.otherUniversities, 4, 'inactive / expired / future rows are ignored');
  assert.equal(agg.acceptedAsEquivalent, 3);
  assert.equal(agg.outcomes.equivalent, 3);
  assert.equal(agg.outcomes.elective, 1);
  assert.equal(agg.headline, 'Accepted as equivalent by 3 other universities');
  assert.equal(agg.targets[0].universities, 2, 'CS I variants from different universities group together');
  assert.equal(agg.targets[0].sharePct, 67);
  assert.equal(agg.targets[0].avgCredits, 3.5);
  assert.equal(agg.agreement, 0.67);
  assert.equal(agg.agreementLevel, 'medium');
  assert.equal(agg.own.length, 1);
  assert.equal(agg.own[0].universityName, 'Boston University', 'own university is shown by name');
  assert.equal(agg.own[0].targetCourse.code, 'CAS CS 111');
  assert.ok(agg.lastDecisionAt);

  // anonymisation: nothing about other universities leaks into the payload
  const blob = JSON.stringify(agg);
  for (const name of SECRET_NAMES) assert.ok(!blob.includes(name), `leaked ${name}`);
  for (const code of ['NU CS 2000', 'CVU 101', 'LIT 110', 'ZP 90']) assert.ok(!blob.includes(code), `leaked code ${code}`);
  assert.ok(!/"recvInst|"extInst/.test(blob), 'no ids of other universities');

  // agreement levels
  const unanimous = aggregate([1, 2, 3, 4].map((i) => row({ recvInstId: i, recvInstName: `U${i}`, buTitle: 'Calculus I' })), { ownInstitutionIds: [], asOf: TODAY });
  assert.equal(unanimous.agreement, 1);
  assert.equal(unanimous.agreementLevel, 'high');
  const scattered = aggregate([1, 2, 3].map((i) => row({ recvInstId: i, recvInstName: `U${i}`, buTitle: `Totally different ${i}` })), { ownInstitutionIds: [], asOf: TODAY });
  assert.ok(scattered.agreement < 0.5 && scattered.agreementLevel === 'low');
  const empty = aggregate([], { ownInstitutionIds: [1], asOf: TODAY });
  assert.equal(empty.agreementLevel, 'none');
  assert.equal(empty.headline, 'No other university has recorded a decision for this course yet.');

  // boost bounds
  const support = toSupport(agg)!;
  const b = networkBoost('Introduction to Computer Science I', support);
  assert.ok(b.boost >= BOOST_MIN && b.boost <= BOOST_MAX && b.universities === 2, `boost ${b.boost}`);
  assert.equal(networkBoost('Organic Chemistry', support).boost, 0);
  assert.equal(networkBoost('Anything', null).boost, 0);
  const strong = networkBoost('Calculus I', toSupport(unanimous)!);
  assert.equal(strong.boost, BOOST_MAX);
  const cands = [
    { buTitle: 'Organic Chemistry', confidenceScore: 0.66, rationale: 'x', rank: 1 },
    { buTitle: 'Introduction to Computer Science I', confidenceScore: 0.6, rationale: 'y', rank: 2 },
  ];
  const rules = applyNetworkBoost(cands, support, RULES_CAP);
  assert.ok(rules.every((c) => c.confidenceScore <= RULES_CAP), 'rules cap 0.7 holds');
  assert.equal(rules[0].buTitle, 'Introduction to Computer Science I', 're-ranked after boost');
  assert.deepEqual(rules.map((c) => c.rank), [1, 2]);
  assert.match(rules[0].rationale, /Also accepted by 2 other universities\./);
  assert.equal(cands[1].confidenceScore, 0.6, 'input not mutated');
  const high = applyNetworkBoost([{ buTitle: 'Calculus I', confidenceScore: 0.95, rationale: 'z', rank: 1 }], toSupport(unanimous), OVERALL_CAP);
  assert.equal(high[0].confidenceScore, OVERALL_CAP);
  const already = applyNetworkBoost([{ buTitle: 'Calculus I', confidenceScore: 0.995, rationale: 'z', rank: 1 }], toSupport(unanimous), OVERALL_CAP);
  assert.equal(already[0].confidenceScore, 0.995, 'never lowers a score above the cap');
  assert.equal(applyNetworkBoost(cands, null, OVERALL_CAP), cands, 'no support = unchanged');

  // summary helpers
  const top = topAgreed(rows.map((r) => ({ ...r, extTitle: 'Intro to Programming' })), TODAY);
  assert.equal(top[0].universities, 4);
  assert.ok(!JSON.stringify(top).includes('Northeastern'));
  const months = fillMonths([{ month: '2026-10', count: 5 }], 3, TODAY);
  assert.deepEqual(months.map((m) => m.month), ['2026-08', '2026-09', '2026-10']);
  assert.equal(months[2].count, 5);

  // service against a stub database
  const stubDb: any = {
    query: async (text: string) => {
      if (/FROM AppSettings/.test(text)) return { recordset: [{ SettingValue: '1' }] };
      if (/REPLACE\(REPLACE/.test(text)) return { recordset: [{ Id: 1, Code: 'CS 1', Title: 'Intro to Programming' }] };
      if (/FROM Courses WHERE Title LIKE/.test(text)) return { recordset: [{ Id: 1, Title: 'Introduction to Programming' }, { Id: 2, Title: 'Intro to Programming' }, { Id: 3, Title: 'Poetry' }] };
      if (/FROM Equivalencies eq/.test(text)) return { recordset: rows.map((r) => ({ ...r, isActive: r.isActive ? 1 : 0 })) };
      if (/FROM Courses WHERE Id IN/.test(text)) return { recordset: [{ Id: 10, Title: 'Introduction to Computer Science I' }, { Id: 11, Title: 'Poetry' }] };
      return { recordset: [] };
    },
  };
  const schema: any = { has: async () => true };
  const scope: any = { universityScope: async () => null };
  const svc = new NetworkService(stubDb, schema, scope);
  const res: any = await svc.forCourse({ institutionId: 50, code: 'CS-1', title: 'Intro to Programming', targetInstitutionId: 1, candidateIds: [10, 11] }, { id: 'u', role: 'faculty' });
  assert.equal(res.course.matchBasis, 'exact+title');
  assert.equal(res.acceptedAsEquivalent, 3);
  assert.equal(res.own[0].universityName, 'Boston University');
  assert.ok(res.candidateSupport['10'].universities === 2 && !res.candidateSupport['11']);
  assert.equal(res.boostEnabled, true);
  for (const name of SECRET_NAMES) assert.ok(!JSON.stringify(res).includes(name), `service leaked ${name}`);
  // A scoped admin cannot see a university outside their scope by name.
  const scopedSvc = new NetworkService(stubDb, schema, { universityScope: async () => [9] } as any);
  const scoped: any = await scopedSvc.forCourse({ title: 'Intro to Programming', targetInstitutionId: 1 }, { id: 'a', role: 'admin' });
  assert.equal(scoped.own.length, 0);
  assert.ok(!JSON.stringify(scoped).includes('Boston University'));
  const sum: any = await svc.summary();
  assert.ok(sum.totalPairs >= 5 && sum.contributingUniversities >= 5 && !JSON.stringify(sum).includes('Northeastern'));

  // matcher hook: off by default, labelled + bounded when on
  const catalog = [
    { id: 10, code: 'CS 111', title: 'Introduction to Computer Science I', credits: 4, programArea: null, description: 'programming basics', topics: ['programming'] },
    { id: 11, code: 'CH 101', title: 'Chemistry', credits: 4, programArea: null, description: 'atoms', topics: [] },
  ];
  const ext = { code: 'CIS 150', title: 'Introduction to Computer Science', credits: 4, description: 'programming basics', topics: [] as string[], institutionName: 'X', calendar: 'semester' };
  const settings: any = {};
  const mkAi = (enabled: boolean) =>
    new AiService({} as any, {} as any, {} as any, {} as any, {} as any, { isBoostEnabled: async () => enabled, supportFor: async () => support } as any);
  const off = await mkAi(false).dryMatch('rules', ext, catalog, settings, { extInstitutionId: 50, targetInstitutionId: 1 });
  const on = await mkAi(true).dryMatch('rules', ext, catalog, settings, { extInstitutionId: 50, targetInstitutionId: 1 });
  assert.ok(!/Also accepted/.test(off.candidates[0].rationale), 'default OFF leaves candidates alone');
  assert.ok(/Also accepted by 2 other universities\./.test(on.candidates[0].rationale));
  assert.ok(on.candidates[0].confidenceScore >= off.candidates[0].confidenceScore && on.candidates[0].confidenceScore <= RULES_CAP, 'rules capped at 0.7');
  const noSvc = new AiService({} as any, {} as any, {} as any, {} as any, {} as any);
  const plain = await noSvc.dryMatch('rules', ext, catalog, settings, { extInstitutionId: 50, targetInstitutionId: 1 });
  assert.equal(plain.candidates[0].confidenceScore, off.candidates[0].confidenceScore, 'works without the network service');

  console.log('test-network: all assertions passed');
})().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
