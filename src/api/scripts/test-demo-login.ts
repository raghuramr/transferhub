import assert from 'node:assert/strict';
import { buildPublicDemoLogin, parseFlag } from '../src/settings/demo-login.logic';
import { DEMO_ACCOUNTS } from '../src/settings/demo-accounts';

const off = buildPublicDemoLogin({ enabled: false, showCredentials: true });
assert.deepEqual(off, { enabled: false });
assert.equal(JSON.stringify(off).includes('@'), false);

const names = buildPublicDemoLogin({ enabled: true, showCredentials: false });
assert.equal(names.enabled, true); assert.equal(names.namesOnly, true); assert.equal(names.showCredentials, false);
assert.equal(names.accounts?.length, DEMO_ACCOUNTS.length);
assert.ok(names.accounts?.every((a) => a.password && a.email));

const creds = buildPublicDemoLogin({ enabled: true, showCredentials: true });
assert.equal(creds.namesOnly, false); assert.equal(creds.showCredentials, true);

assert.equal(parseFlag('1'), true); assert.equal(parseFlag('0'), false); assert.equal(parseFlag(null), false);
assert.equal(DEMO_ACCOUNTS.length, 5);
console.log('demo-login logic OK');
