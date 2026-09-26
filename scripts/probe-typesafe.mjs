import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { readSecretFromTty } from './probe-deepseek-figure-recovery.mjs';
const require = createRequire(import.meta.url);
require('../providers/provider-utils.js');
const { createTypeSafeAdapter } = require('../providers/typesafe.js');
const output = path.resolve(process.argv[2] || 'output/typesafe/connection-20260921.json');
if (fs.existsSync(output)) throw new Error('OUTPUT_ALREADY_EXISTS');
const report = { status: 'RUNNING', startedAt: new Date().toISOString(), calls: [] };
let secret = await readSecretFromTty({ prompt: 'TypeSafe API key (masked, memory only): ' });
try {
  const observedFetch = async (url, options) => {
    const start = Date.now();
    const response = await fetch(url, options);
    const raw = await response.clone().text();
    report.calls.push({ status: response.status, elapsedMs: Date.now() - start,
      inputSha256: crypto.createHash('sha256').update(options.body).digest('hex'),
      outputSha256: crypto.createHash('sha256').update(raw).digest('hex') });
    return response;
  };
  const adapter = createTypeSafeAdapter({ apiKey: secret, model: 'jev-latest' }, observedFetch);
  const result = await adapter.evaluateDecisions({ state: 'We investigated whether protein X regulates sleep. The inhibitor did not change total sleep time.',
    questions: {
      question: { type: 'noul', instructions: 'Does the first sentence explicitly state the objective of this study?' },
      positive: { type: 'noul', instructions: 'Does the second sentence report an increase in total sleep time?' }
    } });
  report.model = result.model;
  report.answers = result.answers;
  report.usage = result.usage;
  report.status = result.answers.question.noul >= 0.8 && result.answers.positive.noul <= 0.2 ? 'PASS' : 'QUALITY_REVIEW';
} catch (error) {
  report.status = 'FAIL'; report.errorCode = error.code || error.name;
} finally {
  const text = JSON.stringify(report, null, 2);
  if (text.includes(secret)) throw new Error('SECRET_IN_REPORT');
  secret = '';
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, text + '\n');
  process.stdout.write(JSON.stringify(report) + '\n');
}
if (report.status !== 'PASS') process.exitCode = 1;
