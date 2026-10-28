/** Run: npx tsx scripts/test-benchmark.ts - benchmark metrics + the dry-run matcher (no database, stub provider). */
import assert from 'node:assert/strict';
import http from 'node:http';
import { scoreCase, summarize, type BenchCase } from '../src/ai/benchmark-metrics';
import { AiService } from '../src/ai/ai.service';
import type { AiProviderConfig } from '../src/ai/ai-providers.service';

const mk = (engine: string, ok: boolean, conf: number, ms: number, cost: number, withTruth = true): BenchCase =>
  scoreCase({ engine, engineLabel: engine, model: 'm', studentId: 's', studentName: 'S', courseCode: 'C', courseTitle: 'T', institution: 'X',
    expected: withTruth ? { buCode: 'A', source: 'equivalency' } : null, picks: [{ buCode: ok ? 'A' : 'B', confidence: conf }, { buCode: 'A', confidence: conf / 2 }],
    shortlistMs: 1, callMs: ms, parseMs: 1, totalMs: ms, usage: cost ? { input: 100, output: 10, cacheRead: 0, cacheWrite: 0 } : null, costUsd: cost });

const cases = [mk('ai', true, 0.9, 2000, 0.01), mk('ai', true, 0.8, 2200, 0.01), mk('ai', false, 0.9, 1800, 0.01), mk('rules', true, 0.5, 5, 0), mk('rules', false, 0.6, 5, 0), mk('rules', false, 0.4, 5, 0), mk('rules', true, 0.5, 5, 0, false)];
assert.equal(cases[2].rank, 2); assert.equal(cases[2].hit1, false); assert.equal(cases[2].hit3, true);
assert.equal(cases[6].hit1, null, 'no known answer = not scored');
const s = summarize(cases, 0.85);
const ai = s.find((x) => x.engine === 'ai')!; const rules = s.find((x) => x.engine === 'rules')!;
assert.equal(ai.top1, 66.7); assert.equal(ai.top3, 100); assert.equal(ai.autoApplied, 2); assert.equal(ai.autoWrong, 1);
assert.equal(rules.withTruth, 3); assert.equal(rules.costUsd, 0); assert.equal(rules.scores.cost, 100); assert.equal(rules.scores.speed, 100);
assert.ok(ai.scores.speed < 1); assert.ok(ai.costPerCorrect! > 0.0149 && ai.costPerCorrect! < 0.0151);
assert.equal(ai.tokensIn, 300);

(async () => {
  const catalog = [
    { id: 1, code: 'CAS CS 112', title: 'Introduction to Computer Science 2', credits: 4, programArea: null, description: 'data structures stacks queues trees', topics: ['Stacks and queues', 'Trees'] },
    { id: 2, code: 'CAS MA 123', title: 'Calculus I', credits: 4, programArea: null, description: 'limits derivatives', topics: [] },
  ];
  const ext = { code: 'CSC 220', title: 'Data Structures', credits: 4, description: 'stacks queues linked lists trees', topics: ['Trees'], institutionName: 'Bay State CC', calendar: 'semester' };
  const settings: any = { matchModel: 'm', prefilterTopN: 5, maxDescriptionChars: 100, maxOutputTokens: 500, usePromptCaching: false };
  const server = http.createServer((req, res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: '[{"buCourseId":1,"rank":1,"confidenceScore":0.93,"rationale":"match"}]' } }], usage: { prompt_tokens: 120, completion_tokens: 20 } })); }); }).listen(0);
  const port = (server.address() as { port: number }).port;
  const cfg = { chatProvider: 'custom:z', anthropicKey: null, anthropicBaseUrl: null, temperature: 0, timeoutSec: 10, azureOpenAiEndpoint: null, azureOpenAiKey: null, azureOpenAiDeployment: null, azureOpenAiApiVersion: 'x', docProvider: 'none', azureDocEndpoint: null, azureDocKey: null,
    customProviders: [{ id: 'z', name: 'Stub', baseUrl: `http://127.0.0.1:${port}/v1`, model: 'stub-1', apiKey: 'k', authStyle: 'bearer' }] } as AiProviderConfig;
  const svc = new AiService({} as any, {} as any, { buildSystemPrompt: async () => ({ text: 'sys' }) } as any, {} as any, { getConfig: async () => cfg } as any);
  const rules = await svc.dryMatch('rules', ext, catalog, settings);
  assert.equal(rules.candidates[0]?.buCode, 'CAS CS 112'); assert.equal(rules.costUsd, 0); assert.equal(rules.model, 'built-in rules');
  const ai = await svc.dryMatch('custom:z', ext, catalog, settings);
  server.close();
  assert.equal(ai.error, undefined, ai.error);
  assert.equal(ai.candidates[0].buCode, 'CAS CS 112'); assert.equal(ai.model, 'stub-1'); assert.equal(ai.usage?.input, 120); assert.ok(ai.callMs >= 0);
  const down = await svc.dryMatch('anthropic', ext, catalog, settings);
  assert.ok(down.error && down.candidates.length === 0, 'an unconfigured engine reports an error instead of throwing');
  console.log('benchmark OK');
})().catch((e) => { console.error(e); process.exit(1); });
