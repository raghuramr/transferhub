/** Run: npx tsx scripts/test-email-custom.ts - custom e-mail template validation + rendering. */
import assert from 'node:assert/strict';
import { renderCustom, sanitizeCustom } from '../src/common/email-templates';

const ctx = { appBaseUrl: 'https://site.example', support: 'help@site.example' };
const t = sanitizeCustom({ name: ' Pilot welcome ', subject: 'Hi {{firstName}}', headline: 'Welcome to {{universityName}}', paragraphs: ['Hello there', '', 'Second {{fullName}}'], ctaLabel: 'Open', ctaUrl: '/login', enabled: true });
assert.equal(t.name, 'Pilot welcome');
assert.equal(t.paragraphs.length, 2);
const e = renderCustom(ctx, t, { firstName: 'Ana', lastName: 'Lee', universityName: 'Test U' });
assert.equal(e.subject, 'Hi Ana');
assert.ok(e.html.includes('Welcome to Test U') && e.html.includes('Second Ana Lee') && e.html.includes('Hello Ana,'));
assert.ok(e.html.includes('href="https://site.example/login"'));
const ext = renderCustom(ctx, sanitizeCustom({ ...t, ctaUrl: 'https://other.example/a' }), {});
assert.ok(ext.html.includes('href="https://other.example/a"'));
assert.ok(!ext.html.includes('Hello ,'), 'no greeting without a first name');
assert.throws(() => sanitizeCustom({ ...t, ctaUrl: 'javascript:alert(1)' }), /button link/i);
assert.throws(() => sanitizeCustom({ ...t, ctaUrl: '' }), /button link/i);
assert.throws(() => sanitizeCustom({ ...t, paragraphs: [] }), /paragraph/i);
assert.throws(() => sanitizeCustom({ ...t, name: ' ' }), /Name is required/);
assert.equal(sanitizeCustom({ ...t, ctaLabel: '', ctaUrl: '' }).ctaUrl, undefined);
console.log('email custom OK');
