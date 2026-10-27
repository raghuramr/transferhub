import assert from 'node:assert/strict';
import { fillPlaceholders, previewWithDraft, sanitizeOverride, setTemplateOverrides, templateCatalogue, templates, type TemplateOverride } from '../src/common/email-templates';

const ctx = { appBaseUrl: 'https://x.test', support: 'help@x.test' };
const tid = '1f306ab4-5c2d-4e8a-9b1c-2d3e4f506172';
const data = { name: 'Alex <b>', student: 'Priya Rao', stage: 'Faculty review', transcriptId: tid };

// no override -> coded text, key attached
const base = templates.approverAction(ctx, data);
assert.equal(base.key, 'approverAction');
assert.equal(base.subject.startsWith('Action needed: Faculty review - Priya Rao'), true);
assert.equal(base.suppressed, undefined);

// override applies subject/headline/paragraphs/cta with placeholders; unknown renders empty; output escaped
const o: TemplateOverride = {
  subject: 'Please review {{student}} ({{nope}})',
  headline: 'Hi {{name}}',
  paragraphs: ['{{student}} waits at {{stage}}. ref {{ref}}'],
  ctaLabel: 'Open {{student}}',
  cc: ['cc@x.test'],
};
setTemplateOverrides(new Map([['approverAction', o]]));
const e = templates.approverAction(ctx, data);
assert.ok(e.subject.startsWith('Please review Priya Rao ()'));
assert.ok(e.html.includes('Priya Rao waits at Faculty review. ref 1F306AB4'));
assert.ok(e.html.includes('Open Priya Rao'));
assert.ok(e.html.includes('Hi Alex &lt;b&gt;') && !e.html.includes('Alex <b>'));
assert.deepEqual(e.cc, ['cc@x.test']);

// switch off honoured, except for protected templates
setTemplateOverrides(new Map([['approverAction', { enabled: false }], ['emailChange', { enabled: false }]]));
assert.equal(templates.approverAction(ctx, data).suppressed, true);
assert.equal(templates.emailChange(ctx, { firstName: 'P', newEmail: 'a@b.co', token: 't' }).suppressed, undefined);
assert.equal(sanitizeOverride('emailChange', { enabled: false }).enabled, undefined);
assert.equal(sanitizeOverride('approverAction', { enabled: false }).enabled, false);

// sensitive data never becomes a placeholder
setTemplateOverrides(new Map([['accountCreated', { paragraphs: ['pw={{password}} mail={{email}}'] }]]));
const ac = templates.accountCreated(ctx, { firstName: 'P', email: 'p@x.co', password: 'Secret#1' });
assert.ok(ac.html.includes('mail=p@x.co'));
assert.ok(!ac.text.includes('pw=Secret#1'));

// draft preview does not need the store; catalogue lists placeholders and defaults
setTemplateOverrides(new Map());
const pv = previewWithDraft(ctx, 'a <a@x.co>', 'approverAction', { headline: 'Draft {{stage}}' });
assert.ok(pv && pv.html.includes('Draft Faculty review'));
const cat = templateCatalogue(ctx, 'a <a@x.co>');
const aa = cat.find((c) => c.key === 'approverAction')!;
assert.ok(aa.defaults.placeholders.includes('student') && aa.defaults.placeholders.includes('ref'));
assert.equal(aa.defaults.ctaLabel, 'Review request');
assert.equal(aa.canDisable, true);
assert.equal(cat.find((c) => c.key === 'emailChange')!.canDisable, false);
assert.ok(!cat.find((c) => c.key === 'accountCreated')!.defaults.placeholders.includes('password'));
assert.equal(new Set(cat.map((c) => c.key)).size, cat.length);

// validation
assert.throws(() => sanitizeOverride('welcome', { cc: ['not-an-email'] }));
assert.throws(() => sanitizeOverride('welcome', { subject: 'x'.repeat(201) }));
assert.deepEqual(sanitizeOverride('welcome', { cc: [' A@x.co ', 'a@x.co'], subject: '  ' }), { cc: ['a@x.co'] });
assert.equal(fillPlaceholders('a {{ x }} b {{y}}', { x: '1' }), 'a 1 b ');
console.log('email overrides OK');
