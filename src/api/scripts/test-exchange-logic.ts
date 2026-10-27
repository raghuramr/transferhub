/** Run: npx tsx scripts/test-exchange-logic.ts  - checks the pure transfer-exchange rules. */
import assert from 'node:assert/strict';
import { pickParty, validateAsk, reminderBlocked, statusBucket, partyName, defaultTitle, cleanDueDate, transferBlobNameCheck } from './exchange-logic-shim';

assert.equal(pickParty([], null), null);
assert.equal(pickParty(['student'], null), 'student');
assert.equal(pickParty(['student'], 'target_university'), null);
assert.equal(pickParty(['source_university', 'target_university'], null), 'target_university');
assert.equal(pickParty(['source_university', 'target_university'], 'source_university'), 'source_university');
assert.equal(pickParty(['source_university'], 'bogus'), null);

assert.equal(validateAsk(['source_university'], 'source_university', 'target_university'), null);
assert.ok(validateAsk(['source_university'], 'target_university', 'student'));
assert.ok(validateAsk(['student'], 'student', 'student'));

const now = Date.now();
assert.equal(reminderBlocked(null, now), false);
assert.equal(reminderBlocked(new Date(now - 11 * 3_600_000), now), true);
assert.equal(reminderBlocked(new Date(now - 13 * 3_600_000), now), false);

assert.equal(statusBucket('active', 'processing'), 'in_review');
assert.equal(statusBucket('bypassed', 'complete'), 'approved');
assert.equal(statusBucket('rejected', 'complete'), 'rejected');
assert.equal(statusBucket(null, 'received'), 'new');
assert.equal(statusBucket(null, 'complete'), 'approved');

assert.equal(partyName('student', { student: 'Priya' }), 'Priya');
assert.equal(partyName('source_university', { source: 'NYU' }), 'NYU');
assert.equal(defaultTitle('Official transcript', '  '), 'Official transcript');
assert.equal(defaultTitle('x', ' Syllabus for CS 101 '), 'Syllabus for CS 101');
assert.equal(cleanDueDate('2026-11-30'), '2026-11-30');
assert.equal(cleanDueDate('2026-02-31'), null);
assert.equal(cleanDueDate('soon'), null);

// Transfer uploads always land in the STUDENT's folder, under the uploader's party.
const name = transferBlobNameCheck('STU-1', 'TR-9', 'target_university', 'abc', 'letter.pdf');
assert.equal(name, 'student/STU-1/transfer/TR-9/target_university/abc-letter.pdf');
assert.equal(transferBlobNameCheck('S', 'T', 'student', 'i', '../../etc/passwd'), 'student/S/transfer/T/student/i-passwd');
console.log('exchange logic: all checks passed');
