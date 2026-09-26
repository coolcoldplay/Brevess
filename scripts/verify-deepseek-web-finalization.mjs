// Resume one captured search-only response using the production adapter. The
// first boundary response is replayed; only its finalization calls the real API.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { readSecretFromTty } from './probe-deepseek-figure-recovery.mjs';
import { sanitizedReplay } from './verify-live-web-chat-extension.mjs';
const require = createRequire(import.meta.url);
require('../providers/provider-utils.js');
require('../core/article-chat-web-sources.js');
require('../providers/deepseek.js');
const { createProviderAdapter } = require('../providers/provider-registry.js');
const directory = path.resolve(process.argv[2] || 'output/playwright/live-web-chat-direct-followup');
const output = path.resolve(process.argv[3] || 'output/playwright/live-web-finalization');
const original = JSON.parse(fs.readFileSync(path.join(directory, 'provider-request-turn-2-redacted.json')));
const captured = JSON.parse(fs.readFileSync(path.join(directory, 'provider-response-turn-2-redacted.json')));
const previousReport = JSON.parse(fs.readFileSync(path.join(directory, 'report.json')));
const maxOutputTokens = previousReport.providerCalls[1].request.maxOutputTokens;
fs.mkdirSync(output, { recursive: true });
const report = { status: 'FAIL', replayedCalls: 0, realApiCalls: 0, providerCallCap: 1,
  boundary: 'production adapter; exact captured first response, one live finalization over Node HTTPS',
  providerCalls: [], sourceSha256: crypto.createHash('sha256').update(fs.readFileSync(new URL('../providers/deepseek.js', import.meta.url))).digest('hex') };
let secret = '';
try {
  secret = await readSecretFromTty({ prompt: 'DeepSeek key for one captured-search finalization: ' });
  const adapter = createProviderAdapter({ providerId: 'deepseek',
    config: { model: original.model, apiKey: secret, reasoningEnabled: false },
    fetchImpl: async (url, options) => {
    if (!report.replayedCalls) {
      report.replayedCalls++;
      return new Response(JSON.stringify(captured), { status: 200 });
    }
    if (report.realApiCalls >= 1 || url !== 'https://api.deepseek.com/responses') throw new Error('LIVE_CALL_CAP');
    const body = JSON.parse(options.body);
    if (body.tool_choice !== 'none' || !Array.isArray(body.input)) throw new Error('FINALIZATION_SHAPE');
    report.realApiCalls++;
    fs.writeFileSync(path.join(output, 'provider-request-redacted.json'), sanitizedReplay(options.body));
    const started = Date.now();
    const response = await fetch(url, options);
    const text = await response.text();
    fs.writeFileSync(path.join(output, 'provider-response-redacted.json'), sanitizedReplay(text));
    report.providerCalls.push({ status: response.status, elapsedMs: Date.now() - started,
      usage: JSON.parse(text).usage, toolChoice: body.tool_choice,
      reasoning: body.reasoning, maxOutputTokens: body.max_output_tokens });
    return new Response(text, { status: response.status, headers: { 'Content-Type': 'application/json' } });
  } });
  const events = [];
  for await (const event of adapter.generateWebSearchTextStream({
    webSystemPrompt: original.instructions.replace(/\nYou must perform at least one web search[\s\S]*$/u, ''),
    userPrompt: original.input, maxOutputTokens,
    timeoutMs: 180000, reasoningEnabled: false
  })) events.push(event);
  const error = events.find(event => event.type === 'error');
  report.errorCode = error?.error?.code || '';
  report.answerChars = events.find(event => event.type === 'text_delta')?.text?.length || 0;
  report.provenance = events.find(event => event.type === 'web_unverified')?.answerProvenance || null;
  if (events.at(-1)?.type === 'completed' && report.realApiCalls === 1 && report.answerChars > 0) report.status = 'PASS';
} catch (error) {
  report.errorCode = /^[A-Z_]{3,80}$/u.test(error?.code || error?.message || '')
    ? (error.code || error.message) : 'FINALIZATION_FAILED';
} finally {
  secret = '';
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, realApiCalls: report.realApiCalls, answerChars: report.answerChars, errorCode: report.errorCode }));
  if (report.status !== 'PASS') process.exitCode = 1;
}
