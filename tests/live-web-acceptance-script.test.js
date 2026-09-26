const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');

const scriptUrl = pathToFileURL(path.resolve(__dirname,
  '../scripts/verify-live-web-chat-extension.mjs'));

async function loadScript() {
  return import(`${scriptUrl.href}?test=${Date.now()}-${Math.random()}`);
}

test('direct browser boundary uses one RAM-only key read and caps official calls at two', async () => {
  const { directNetworkBoundarySource } = await loadScript();
  const secret = 'opaque-key-value-that-must-never-be-reported';
  const dummy = 'dummy-key-for-test';
  const providerEndpoint = 'https://api.deepseek.com/responses';
  const brokerUrl = 'http://127.0.0.1:43123';
  const diagnostics = [];
  let keyReads = 0;
  let officialCalls = 0;
  const nativeFetch = async (url, options = {}) => {
    if (url === `${brokerUrl}/secret`) {
      keyReads += 1;
      return new Response(JSON.stringify({ secret }), {
        status: 200, headers: { 'Content-Type': 'application/json' }
      });
    }
    if (url === `${brokerUrl}/diagnostic`) {
      diagnostics.push(JSON.parse(String(options.body || '{}')));
      return new Response(null, { status: 204 });
    }
    assert.equal(url, providerEndpoint);
    officialCalls += 1;
    assert.equal(new Headers(options.headers).get('Authorization'), `Bearer ${secret}`);
    return new Response(JSON.stringify({
      id: `response-${officialCalls}`,
      usage: { input_tokens: 10, output_tokens: 20 }
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const context = vm.createContext({
    fetch: nativeFetch,
    URL,
    Headers,
    Response,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    Date,
    JSON,
    Error,
    String,
    Number,
    Promise
  });
  const source = directNetworkBoundarySource({
    providerEndpoint,
    brokerUrl,
    brokerToken: 'non-secret-broker-token',
    dummySecret: dummy,
    callCap: 2,
    maxResponseBytes: 1024 * 1024
  });
  assert.doesNotMatch(source, new RegExp(secret, 'u'));
  new vm.Script(source).runInContext(context);
  const body = JSON.stringify({
    model: 'deepseek-v4-flash', input: 'question',
    tools: [{ type: 'web_search' }], stream: false
  });
  const request = () => context.fetch(providerEndpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${dummy}`, 'Content-Type': 'application/json' },
    body
  });
  assert.equal((await request()).status, 200);
  assert.equal((await request()).status, 200);
  await assert.rejects(request(), /LIVE_PROVIDER_CALL_CAP/u);
  assert.equal(keyReads, 1);
  assert.equal(officialCalls, 2);
  assert.equal(diagnostics.filter(item => item.phase === 'provider-fetch-start').length, 2);
  assert.equal(diagnostics.filter(item => item.phase === 'call-cap-rejected').length, 1);
  assert.doesNotMatch(JSON.stringify(diagnostics), new RegExp(secret, 'u'));
  assert.ok(diagnostics.every(item => !Object.hasOwn(item, 'headers')));
});

test('direct broker redacts an arbitrary key and keeps replay separate from actual calls', async () => {
  const { startDirectBroker } = await loadScript();
  const secret = 'opaque-arbitrary-provider-key-123';
  const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-broker-test-'));
  const report = { providerCalls: [] };
  const liveState = {
    providerCalls: 0,
    keyReads: 0,
    callCapRejected: false,
    lastProviderRequestBody: '',
    lastProviderResponseBody: ''
  };
  const flushed = [];
  const broker = await startDirectBroker(
    secret, report, liveState, outputDirectory,
    async () => flushed.push(JSON.stringify(report))
  );
  const headers = {
    'Content-Type': 'application/json',
    'X-Live-Broker-Token': broker.brokerToken
  };
  const post = payload => fetch(`${broker.url}/diagnostic`, {
    method: 'POST', headers, body: JSON.stringify(payload)
  });
  try {
    const keyResponse = await fetch(`${broker.url}/secret`, { headers });
    assert.equal(keyResponse.status, 200);
    assert.equal((await keyResponse.json()).secret, secret);
    assert.notEqual((await fetch(`${broker.url}/secret`, { headers })).status, 200);
    const requestBody = JSON.stringify({
      model: 'deepseek-v4-flash', input: 'public article text',
      instructions: 'public instruction', tools: [{ type: 'web_search' }],
      tool_choice: 'auto', stream: false, store: false
    });
    for (const sequence of [1, 2]) {
      assert.equal((await post({
        phase: 'request-start', sequence,
        endpoint: 'https://api.deepseek.com/responses', requestBody
      })).status, 204);
      assert.equal((await post({ phase: 'provider-fetch-start', sequence, elapsedMs: 1 })).status, 204);
      assert.equal((await post({
        phase: 'response-complete', sequence, elapsedMs: 2, status: 200,
        responseBody: JSON.stringify({ output: `public ${secret}` })
      })).status, 204);
    }
    assert.equal((await post({ phase: 'call-cap-rejected', sequence: 3, elapsedMs: 0 })).status, 204);
    assert.equal(liveState.providerCalls, 2);
    assert.equal(liveState.keyReads, 1);
    assert.equal(liveState.callCapRejected, true);
    assert.equal(report.providerCalls.length, 2);
    assert.ok(report.providerCalls.every(call => call.actualProviderCall === true));
    assert.ok(report.providerCalls.every(call => call.replayed !== true));
    const reportText = JSON.stringify(report);
    const filesText = fs.readdirSync(outputDirectory)
      .map(file => fs.readFileSync(path.join(outputDirectory, file), 'utf8')).join('\n');
    assert.doesNotMatch(`${reportText}\n${filesText}\n${flushed.join('\n')}`, new RegExp(secret, 'u'));
    assert.match(filesText, /\[REDACTED_SECRET\]/u);
  } finally {
    broker.clearSecret();
    await new Promise(resolve => broker.server.close(resolve));
    fs.rmSync(outputDirectory, { recursive: true, force: true });
  }
});

test('argument parsing keeps legacy mode and supports default or explicit follow-up', async () => {
  const { parseArguments, acceptanceCallCounts, diagnoseProviderCall } = await loadScript();
  assert.deepEqual(parseArguments(['--replay-dir', 'fixture']), { replayDir: 'fixture' });
  assert.deepEqual(parseArguments(['--direct-browser-network', '--followup']), {
    directBrowserNetwork: true,
    followup: '查一下末尾通讯作者的代表性论文有哪些,列表格总结'
  });
  assert.deepEqual(parseArguments(['--followup', 'second question']), {
    followup: 'second question'
  });
  assert.deepEqual(acceptanceCallCounts({ replay: true, providerCalls: 2 }), {
    realApiCalls: 0,
    replayedCalls: 2
  });
  assert.deepEqual(acceptanceCallCounts({ replay: null, providerCalls: 2 }), {
    realApiCalls: 2,
    replayedCalls: 0
  });
  assert.equal(diagnoseProviderCall({ status: 0,
    transportOutcome: 'request-before-response-failure' }, { turnStatus: 'error' }),
  'request-before-response-failure');
  assert.equal(diagnoseProviderCall({ status: 200,
    transportOutcome: 'response-body-failure' }, { turnStatus: 'error' }),
  'response-body-failure');
  assert.equal(diagnoseProviderCall({ status: 429,
    transportOutcome: 'provider-http-error' }, { turnStatus: 'error' }),
  'provider-http-error');
  assert.equal(diagnoseProviderCall({ status: 200,
    transportOutcome: 'http-success' }, {
    turnStatus: 'error', turnErrorCode: 'INVALID_RESPONSE'
  }),
  'protocol-parse-error-after-http-success');
  assert.equal(diagnoseProviderCall({ status: 200,
    transportOutcome: 'http-success' }, {
    turnStatus: 'error', turnErrorCode: 'NETWORK_ERROR'
  }), 'post-http-production-error');
});
