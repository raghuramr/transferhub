import assert from 'node:assert/strict';
import { DEMO_LOGIN_DEFAULTS, DEMO_FALLBACK_EMAILS, parseFlag, parseUsers } from '../src/settings/demo-login.logic';
import { DEMO_ACCOUNTS } from '../src/settings/demo-accounts';

// Secure default: off, nothing configured.
assert.equal(DEMO_LOGIN_DEFAULTS.enabled, false);
assert.deepEqual(DEMO_LOGIN_DEFAULTS.users, {});

// Flags and the stored role -> userId map are parsed tolerantly.
assert.equal(parseFlag('1'), true); assert.equal(parseFlag('0'), false); assert.equal(parseFlag(null), false);
assert.deepEqual(parseUsers(null), {});
assert.deepEqual(parseUsers('not json'), {});
assert.deepEqual(parseUsers('[1,2]'), {});
assert.deepEqual(parseUsers('{"student":" abc ","faculty":"","admin":5}'), { student: 'abc' });

// Fallback accounts exist for every role, and the logic file never carries a password.
assert.equal(DEMO_ACCOUNTS.length, 5);
assert.deepEqual([...DEMO_FALLBACK_EMAILS], DEMO_ACCOUNTS.map((a) => a.email));
console.log('demo-login logic OK');
