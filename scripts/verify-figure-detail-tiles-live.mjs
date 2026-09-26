// One controlled image-detail diagnostic. Production prompt/schema/budget;
// original Figure pixels only, no expected answers or replayed response.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { readSecretFromTty } from './probe-deepseek-figure-recovery.mjs';
import { loadCapturedSynthesisInput } from './verify-figure-group-synthesis-live.mjs';
import { outputBudget } from './verify-figure-conflict-recheck-live.mjs';
const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const { compileFigurePanelBatchPrompt, validateFigurePanelBatch } = require('../core/figure-analysis.js');
const { createProviderAdapter } = require('../providers/provider-registry.js');
const model = 'deepseek-v4-flash-vision-exp';
const endpoint = 'https://api.deepseek.com/chat/completions';
const args = process.argv.slice(2);
const live = args.includes('--live');
const outArg = args.indexOf('--output-dir');
assert.ok(outArg >= 0 && args[outArg + 1], '--output-dir required');
const output = path.resolve(args[outArg + 1]);
assert.ok(!fs.existsSync(output), 'Never overwrite diagnostic evidence');
fs.mkdirSync(output, { recursive: true });
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const sourceRoot = path.join(root, 'output/playwright/figure-detail-tiles-source-r12');
const sourceReceipt = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'source-receipt.json'), 'utf8'));
assert.equal(sourceReceipt.status, 'PASS');
const fixture = { id: 'figure-1', requestFile: 'provider-request-006-redacted.json',
  expectedPanels: Array.from({length:26}, (_,i) => String.fromCharCode(65+i)) };
const { input } = loadCapturedSynthesisInput(path.join(root, 'tmp/figure-speed-r5-live-vision'), fixture);
const targets = ['D', 'E', 'O', 'U', 'Z'];
const requestInput = { ...input, panelHints: targets };
const compiled = compileFigurePanelBatchPrompt(requestInput, { visualInput: true, analysisDepth: 'standard' });
const budget = outputBudget(model, compiled);
const tileSources = sourceReceipt.figures.find(figure => figure.figureId === fixture.id).tiles;
assert.equal(tileSources.length, 4);
const images = tileSources.map(tile => {
  const bytes = fs.readFileSync(path.join(sourceRoot, tile.outputFile));
  assert.equal(sha256(bytes), tile.outputSha256);
  return { mediaType: 'image/jpeg', dataUrl: `data:image/jpeg;base64,${bytes.toString('base64')}` };
});
let secret = '';
let calls = 0;
const report = { status: live ? 'STARTED' : 'PREPARED_ZERO_API',
  scope: '5 requested Panels from official Figure 1; image-detail diagnostic only; not release acceptance',
  model, targetPanels: targets, realApiCalls: 0, hardHttpCap: 1, automaticRetries: 0,
  expectedAnswersEmbeddedInPrompt: false, replay: false,
  sourceReceipt: 'output/playwright/figure-detail-tiles-source-r12/source-receipt.json',
  sourceReceiptSha256: sha256(fs.readFileSync(path.join(sourceRoot, 'source-receipt.json'))),
  sourceHashes: Object.fromEntries(['core/figure-analysis.js','core/token-budget.js','core/figure-image-tiles.js',
    'providers/deepseek.js','providers/provider-utils.js'].map(file => [file,sha256(fs.readFileSync(path.join(root,file)))])),
  systemPromptSha256: sha256(compiled.systemPrompt), userPromptSha256: sha256(compiled.userPrompt),
  budget, images: tileSources };
function save(name, value) {
  let text = JSON.stringify(value, null, 2).replace(/\bsk-[A-Za-z0-9_-]{3,}\b/g, '[REDACTED_SECRET]');
  if (secret) text = text.split(secret).join('[REDACTED_SECRET]');
  fs.writeFileSync(path.join(output, name), text);
}
const adapter = createProviderAdapter({ providerId: 'deepseek',
  config: { model, apiKey: live ? 'KEY_READ_BELOW' : 'PREPARE_ONLY', reasoningEnabled: true, reasoningEffort: 'high' },
  fetchImpl: async (url, options) => {
    assert.equal(String(url), endpoint);
    const body = JSON.parse(options.body);
    const wireImages = body.messages.find(message => message.role === 'user').content.filter(part => part.type === 'image_url');
    assert.deepEqual(wireImages.map(part => sha256(part.image_url.url)), images.map(image => sha256(image.dataUrl)));
    assert.equal(body.thinking.type, 'enabled');
    assert.equal(body.reasoning_effort, 'high');
    assert.equal(body.max_tokens, budget.initial);
    report.serialized = { imageCount: wireImages.length, bytes: Buffer.byteLength(options.body),
      sha256: sha256(options.body), maxTokens: body.max_tokens, thinking: body.thinking, effort: body.reasoning_effort };
    if (!live) return new Response(JSON.stringify({ choices:[{ finish_reason:'stop',message:{content:'{}'} }] }));
    assert.ok(++calls <= 1, 'One HTTP call only');
    report.realApiCalls = calls; save('report.json', report);
    const started = Date.now();
    const response = await fetch(url, { ...options, headers:{...options.headers,Authorization:`Bearer ${secret}`}, signal:AbortSignal.timeout(300000) });
    const text = await response.text();
    assert.ok(Buffer.byteLength(text) < 12 * 1024 * 1024);
    let envelope; try { envelope = JSON.parse(text); } catch { envelope = { text }; }
    save('provider-response-redacted.json', envelope);
    Object.assign(report, { httpStatus:response.status,elapsedMs:Date.now()-started, usage:envelope.usage,
      finishReason:envelope.choices?.[0]?.finish_reason });
    save('report.json', report);
    return new Response(text, { status:response.status,headers:{'Content-Type':response.headers.get('Content-Type')||'application/json'} });
  } });
try {
  if (live) secret = await readSecretFromTty({ prompt:'Authorized key for one Figure detail diagnostic (masked): ' });
  const raw = await adapter.generateJson({ ...compiled, images, maxOutputTokens:budget.initial, timeoutMs:300000, reasoningEnabled:true,reasoningEffort:'high' });
  if (live) {
    const result = validateFigurePanelBatch(raw, requestInput, { analysisDepth:'standard',visualInput:true });
    assert.deepEqual(result.panels.map(panel => panel.panel), targets);
    save('fresh-panels-normalized-redacted.json', result.panels);
    report.status = 'STRUCTURAL_PASS_SCIENTIFIC_REVIEW_REQUIRED';
  }
} catch (error) { report.status='FAIL'; report.errorCode=error.code||'DIAGNOSTIC_FAILED'; report.error=String(error.message); process.exitCode=1; }
finally { save('report.json',report); secret=''; }
console.log(JSON.stringify({status:report.status,realApiCalls:report.realApiCalls,elapsedMs:report.elapsedMs,error:report.errorCode}));
