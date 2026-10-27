import assert from 'node:assert/strict';
import { isSelectableUniversity, validateTarget, keepIntendedUnit } from '../src/account/target.logic';

const bu = { id: 1, code: 'BU', type: 'university', isActive: true };
const bscc = { id: 7, code: 'BSCC', type: 'community_college', isActive: true };
const pvtcAsUni = { id: 8, code: 'PVTC', type: 'university', isActive: true };
const inactive = { id: 2, code: 'NU', type: 'university', isActive: false };

assert.equal(isSelectableUniversity(bu), true);
assert.equal(isSelectableUniversity(bscc), false);
assert.equal(isSelectableUniversity(pvtcAsUni), false);
assert.equal(isSelectableUniversity(inactive), false);

assert.equal(validateTarget(null, null, false).ok, false);
assert.equal(validateTarget(bscc, null, false).ok, false);
assert.equal(validateTarget(bu, null, false).ok, true);
assert.equal(validateTarget(bu, null, true).ok, false);
assert.equal(validateTarget(bu, { id: 5, isActive: true, offeredAt: [1, 2] }, true).ok, true);
assert.equal(validateTarget(bu, { id: 5, isActive: true, offeredAt: [2] }, true).ok, false);
assert.equal(validateTarget(bu, { id: 5, isActive: false, offeredAt: [1] }, true).ok, false);

assert.equal(keepIntendedUnit(1, 1), true);
assert.equal(keepIntendedUnit(3, 1), false);
assert.equal(keepIntendedUnit(null, 1), false);
console.log('target logic OK');
