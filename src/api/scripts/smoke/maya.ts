/**
 * Maya demo scenario check (seed 015 / the Demo scenario page): the student account sees six courses across two
 * requests (Bay State CC + Pioneer Valley TC), three on the "applied" lane, and the quarter-system course normalised to 2.66.
 * SKIPs (with a hint) when the demo is not seeded - never fails just because the data is absent.
 */
import { Ctx, Session, SkipError, expect } from './core';

type CheckFn = (name: string, fn: () => Promise<string | void>) => Promise<void>;

export async function checkDemoScenario(ctx: Ctx, check: CheckFn, need: (r: 'student') => Session): Promise<void> {
  await check('maya: student sees 6 courses over 2 requests, 3 applied, quarter course = 2.66', async () => {
    const s = need('student');
    const list = await ctx.http.get('/transcripts', s.token);
    expect(list.status === 200, `GET /transcripts status ${list.status}`);
    expect(Array.isArray(list.json), 'expected a list');
    const demo = list.json.filter((t: any) => /Bay State|Pioneer Valley/i.test(t.institution?.name ?? ''));
    if (!demo.length) {
      throw new SkipError('no Bay State / Pioneer Valley requests for the student - run seed 015 or "Reset Maya" on /superadmin/settings/demo-scenario (this is normal on a real system)');
    }
    expect(demo.length === 2, `expected 2 demo requests, found ${demo.length} (a student may have extra ones after a reset - use the Demo scenario page)`);

    const courses: any[] = [];
    for (const t of demo) {
      const d = await ctx.http.get(`/transcripts/${t.id}`, s.token);
      expect(d.status === 200, `GET /transcripts/${t.id} status ${d.status}`);
      expect(Array.isArray(d.json?.courses), 'transcript has no courses array');
      courses.push(...d.json.courses);
    }
    expect(courses.length === 6, `expected 6 courses, found ${courses.length}`);

    // Lane counts reflect the state at upload; after the demo is played through they legitimately move on,
    // so only the "applied" three (which are decided by existing equivalencies) are asserted, not the rest.
    const applied = courses.filter((c) => c.lane === 'applied').map((c) => c.courseCode).sort();
    expect(applied.length === 3, `expected 3 applied courses, found ${applied.length} (${applied.join(', ')})`);
    for (const code of ['CSC 110', 'ECO 101', 'MAT 210']) expect(applied.includes(code), `${code} should be applied`);

    const cis = courses.find((c) => c.courseCode === 'CIS 150');
    expect(!!cis, 'CIS 150 (the quarter-system course) is missing');
    expect(Number(cis.originalCredits) === 4, `CIS 150 original credits ${cis.originalCredits}, expected 4`);
    expect(Number(cis.normalisedCredits) === 2.66, `CIS 150 normalised credits ${cis.normalisedCredits}, expected 2.66 (FLOOR(4*2/3*100)/100)`);
    return 'applied: ' + applied.join(', ');
  });
}
