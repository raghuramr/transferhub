/** Run: npx tsx scripts/test-ai-providers.ts - provider URL guard, readiness helpers and the OpenAI-compatible call path. */
import assert from 'node:assert/strict';
import http from 'node:http';
import { assertSafeProviderUrl, chatProviderLabel, isChatReady, type AiProviderConfig } from '../src/ai/ai-providers.service';
import { AiService } from '../src/ai/ai.service';

assert.equal(assertSafeProviderUrl('https://api.openai.com/v1/'), 'https://api.openai.com/v1');
for (const bad of ['http://api.openai.com/v1', 'https://localhost/v1', 'https://127.0.0.1/v1', 'https://10.0.0.5/v1', 'https://169.254.169.254/latest', 'https://192.168.1.2/v1', 'https://172.20.0.1/v1', 'https://svc.internal/v1', 'not a url', 'https://[::1]/v1']) {
  assert.throws(() => assertSafeProviderUrl(bad), undefined, bad);
}

const cfg = { chatProvider: 'custom:ab12', anthropicKey: 'REPLACE_WITH_KEY', anthropicBaseUrl: null, azureOpenAiEndpoint: null, azureOpenAiKey: null, azureOpenAiDeployment: null, azureOpenAiApiVersion: 'x',
  docProvider: 'none', azureDocEndpoint: null, azureDocKey: null, customProviders: [{ id: 'ab12', name: 'Acme AI', baseUrl: 'http://127.0.0.1:0/v1', model: 'm1', apiKey: 'k', authStyle: 'bearer' as const }] } as AiProviderConfig;
assert.equal(isChatReady(cfg), true);
assert.equal(isChatReady(cfg, 'anthropic'), false, 'placeholder key is not a key');
assert.equal(isChatReady(cfg, 'none'), false);
assert.equal(isChatReady(cfg, 'custom:nope'), false);
assert.equal(chatProviderLabel(cfg), 'Acme AI');

(async () => {
  // A tiny local server stands in for the provider (the save-time https guard is not involved in the call path).
  let seen: { url?: string; auth?: string; body?: any } = {};
  const server = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
      seen = { url: req.url ?? '', auth: String(req.headers.authorization ?? ''), body: JSON.parse(b) };
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { content: 'OK' } }], usage: { prompt_tokens: 5, completion_tokens: 1 } }));
    });
  }).listen(0);
  const port = (server.address() as { port: number }).port;
  cfg.customProviders[0].baseUrl = `http://127.0.0.1:${port}/v1`;
  const providers: any = { getConfig: async () => cfg };
  const settings: any = { getEffective: async () => ({ matchModel: 'claude-haiku-4-5', usePromptCaching: false }) };
  const svc = new AiService({} as any, {} as any, settings, {} as any, providers);
  const r = await svc.testProvider('custom:ab12');
  server.close();
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.reply, 'OK');
  assert.equal(seen.url, '/v1/chat/completions');
  assert.equal(seen.auth, 'Bearer k');
  assert.equal(seen.body.model, 'm1');
  const bad = await svc.testProvider('custom:zzz');
  assert.equal(bad.ok, false);
  console.log('ai providers OK');
})().catch((e) => { console.error(e); process.exit(1); });
