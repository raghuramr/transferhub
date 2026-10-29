import assert from 'node:assert/strict';
import { sameInstitution } from '../src/documents/document-types';

/**
 * The college-name comparison behind the smart-upload "this does not match your profile" warning.
 * A false match costs a warning we did not show; a false mismatch nags the student for nothing, so
 * the cases below pin both directions.
 */
(async () => {
  // Same place, written differently.
  for (const [a, b] of [
    ['New York University', 'new york university'],
    ['New York University', 'New York University '],
    ['Bay State Community College', 'Bay State Community College (synthetic)'],
    ['Miami-Dade College', 'Miami Dade College'],
    ['University of Massachusetts', 'Massachusetts University'],
    ['Northeastern University', 'Northeastern'],
  ] as const) {
    assert.equal(sameInstitution(a, b), true, `${a} === ${b}`);
    assert.equal(sameInstitution(b, a), true, `${b} === ${a} (symmetric)`);
  }

  // Genuinely different places — these must warn.
  for (const [a, b] of [
    ['New York University', 'Miami Dade College'],
    ['Boston University', 'Northeastern University'],
    ['Bay State Community College', 'Pioneer Valley Technical College'],
    ['New York University', 'New Jersey University'],
  ] as const) {
    assert.equal(sameInstitution(a, b), false, `${a} !== ${b}`);
  }

  // Nothing to compare.
  assert.equal(sameInstitution('', 'New York University'), false);
  assert.equal(sameInstitution('New York University', ''), false);
  // Nothing distinctive on either side once the generic words go: do not nag.
  assert.equal(sameInstitution('The University', 'University'), true);

  console.log('document profile match OK');
})();
