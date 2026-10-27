/** Run: npx tsx scripts/test-comparison.ts (pure functions, no database). */
import { computeOverlap, convertCredits, creditMath, matchTopics, parseOutcomes } from '../src/comparison/comparison.logic';

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  -> ${JSON.stringify(detail)}`}`);
  if (!ok) failed++;
}

// credits
check('quarter 4 -> 2.66 (truncated)', convertCredits(4, 'quarter') === 2.66, convertCredits(4, 'quarter'));
check('quarter 3 -> 2', convertCredits(3, 'quarter') === 2);
check('semester unchanged', convertCredits(3, 'semester') === 3);
const q = creditMath({ originalCredits: 4, normalisedCredits: null, calendar: 'quarter', buCredits: 4 });
check('quarter shortfall', q.status === 'shortfall' && q.difference === -1.34 && q.quarterTruncated, q);
check('quarter note mentions truncated', /truncated/.test(q.note));
const q3 = creditMath({ originalCredits: 3, normalisedCredits: 2, calendar: 'quarter', buCredits: 2 });
check('quarter exact third not flagged truncated', q3.status === 'exact' && !q3.quarterTruncated, q3);
const s = creditMath({ originalCredits: 5, normalisedCredits: 5, calendar: 'semester', buCredits: 4 });
check('semester surplus', s.status === 'surplus' && s.difference === 1 && s.awardIfEquivalent === 4 && s.awardIfElective === 5, s);
check('no candidate', creditMath({ originalCredits: 3, normalisedCredits: null, calendar: null, buCredits: null }).status === 'no_candidate');
check('stored normalised wins', creditMath({ originalCredits: 4, normalisedCredits: 2.5, calendar: 'quarter', buCredits: 4 }).convertedCredits === 2.5);

// outcomes
check('outcomes json', parseOutcomes('["Write loops","Use arrays"]').length === 2);
check('outcomes text', parseOutcomes('- Write loops\n- Use arrays').join('|') === 'Write loops|Use arrays', parseOutcomes('- Write loops\n- Use arrays'));
check('outcomes empty', parseOutcomes(null).length === 0);

// overlap
const ext = { title: 'Data Structures', description: 'Linked lists, trees, graphs and hashing algorithms in Java', topics: [{ title: 'Binary trees' }, { title: 'Hash tables' }, { title: 'Sorting' }] };
const bu = { title: 'Data Structures and Algorithms', description: 'Trees, graphs, hashing and sorting algorithms', topics: [{ title: 'Trees and binary search trees' }, { title: 'Hashing and hash tables' }] };
const o = computeOverlap(ext, bu);
check('shared terms found', ['algorithms', 'data', 'graphs', 'hashing', 'structures', 'trees'].every((t) => o.sharedTerms.includes(t)), o.sharedTerms);
check('overlap % sensible', o.overlapPct > 30 && o.overlapPct <= 100, o.overlapPct);
check('topic matches', o.topicMatches.length === 2 && o.topicMatches[0].bu.startsWith('Trees'), o.topicMatches);
const none = computeOverlap({ title: 'Ceramics studio' }, { title: 'Organic chemistry', description: 'Reaction mechanisms' });
check('no overlap = 0', none.overlapPct === 0 && none.sharedTerms.length === 0, none);
check('empty safe', computeOverlap({ title: '' }, { title: '' }).overlapPct === 0);
check('matchTopics none', matchTopics([{ title: 'Pottery' }], [{ title: 'Calculus' }]).length === 0);

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nAll passed');
