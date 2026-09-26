const test = require('node:test');
const assert = require('node:assert/strict');
require('../providers/provider-utils.js');
const { createTypeSafeAdapter, TYPESAFE_ENDPOINT } = require('../providers/typesafe.js');
const { runProviderCapabilityProbes } = require('../core/provider-probes.js');
const questions = { match: { type: 'noul', instructions: 'Is the reported effect positive?' } };
const response = body => new Response(JSON.stringify(body), { status: 200 });

test('TypeSafe uses typed official wire format and forwards exact scientific text and cancellation', async () => {
  const signal = new AbortController().signal;
  let observed;
  const adapter = createTypeSafeAdapter({ apiKey: 'test-only', model: 'jev-custom' }, async (url, options) => {
    observed = { url, ...options };
    return response({ model: 'jev-resolved', answers: { match: { type: 'noul', noul: 0.95 } },
      usage: { input_tokens: 42, output_tokens: 3 } });
  });
  const telemetry = [];
  await adapter.evaluateDecisions({ state: 'Dose 10²; p < 0.05 and x > 1.', questions, signal,
    onProviderTelemetry: event => telemetry.push(event) });
  assert.equal(observed.url, TYPESAFE_ENDPOINT);
  assert.equal(observed.headers.Authorization, 'Bearer test-only');
  assert.deepEqual(JSON.parse(observed.body), { model: 'jev-custom',
    state: 'Dose 10²; p < 0.05 and x > 1.', questions });
  assert.ok(observed.signal);
  assert.equal(telemetry[0].inputTokens, 42);
  assert.equal(adapter.generateTextStream, undefined);
  await assert.rejects(adapter.analyzeChunk({ schemaName: 'article_chat' }), { code: 'CAPABILITY_MISMATCH' });
  assert.throws(() => createTypeSafeAdapter({ baseUrl: 'https://other.example', apiKey: 'x' }, fetch),
    { code: 'INVALID_SETTINGS' });
});

test('TypeSafe rejects partial, malformed and non-finite answers without returning fake empty highlights', async () => {
  for (const answers of [{}, { match: { type: 'noul', noul: '0.9' } },
    { match: { type: 'noul', noul: 1.1 } }, { match: { type: 'choice', choice: 'yes' } }]) {
    const adapter = createTypeSafeAdapter({ apiKey: 'test-only' }, async () => response({ answers }));
    await assert.rejects(adapter.evaluateDecisions({ state: 'x', questions }), { code: 'INVALID_RESPONSE' });
  }
  let calls = 0;
  const adapter = createTypeSafeAdapter({ apiKey: 'test-only' }, async () => { calls++; });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(adapter.evaluateDecisions({ state: 'x', questions, signal: controller.signal }),
    { code: 'CANCELLED' });
  assert.equal(calls, 0);
});

test('connection probe calls actual typed API; generative capabilities remain unsupported', async () => {
  let calls = 0;
  const adapter = createTypeSafeAdapter({ apiKey: 'test-only' }, async (_url, options) => {
    calls++;
    assert.equal(JSON.parse(options.body).questions.blue.type, 'noul');
    return response({ answers: { blue: { type: 'noul', noul: 1 } } });
  });
  const result = await runProviderCapabilityProbes(adapter, { typedDecisions: true,
    probeIds: ['connectivity', 'structured_schema', 'vision_input', 'streaming'] });
  assert.equal(calls, 1);
  assert.equal(result.connected, true);
  assert.equal(result.probes.find(item => item.id === 'connectivity').status, 'passed');
  assert.ok(result.probes.filter(item => item.id !== 'connectivity').every(item => item.status === 'unsupported'));
});

test('accepts one-percent rounded Choice mass without accepting malformed distributions', async () => {
  const choiceQuestions = { span: { type: 'choice', instructions: 'Choose a boundary',
    criteria: { first: 'First token', next: 'Next token', none: 'No boundary' } } };
  for (const [probabilities, accepted] of [
    [{ first: 0.67, next: 0.3, none: 0.02 }, true],
    [{ first: 0.67, next: 0.3, none: 0.01 }, false],
    [{ first: 0.67, next: -0.1, none: 0.42 }, false]
  ]) {
    const adapter = createTypeSafeAdapter({ apiKey: 'test-only' }, async () => response({
      answers: { span: { type: 'choice', choice: 'first', confidence: 0.6, probabilities } }
    }));
    const operation = adapter.evaluateDecisions({ state: 'Original text', questions: choiceQuestions });
    if (accepted) assert.equal((await operation).answers.span.choice, 'first');
    else await assert.rejects(operation, { code: 'INVALID_RESPONSE' });
  }
});
