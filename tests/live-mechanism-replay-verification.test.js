const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const apiPromise = import('../scripts/verify-live-mechanism-extension.mjs');
const script = fs.readFileSync(path.join(__dirname, '../scripts/verify-live-mechanism-extension.mjs'), 'utf8');

// Exercise the actual page callback, including its selectors and assertions, without a browser.
function geometryPage({ svg = true, hidden = false, nodes = 2, edges = 1,
  evidence = 1, invalidPath = false, viewBoxWidth = 500 } = {}) {
  const element = (patch = {}) => ({
    textContent: 'source Panel evidence',
    getBoundingClientRect: () => ({ width: 100, height: 40 }),
    getAttribute: () => '', checkVisibility: () => !hidden,
    querySelector: () => null, querySelectorAll: () => [], ...patch
  });
  const node = element();
  const edge = element({ getTotalLength: () => 100,
    getAttribute: name => name === 'd' ? (invalidPath ? 'M NaN 0' : 'M 0 0 L 100 100') : '' });
  const graph = element({ viewBox: { baseVal: { width: viewBoxWidth, height: 200 } },
    querySelectorAll: selector => selector === 'g.node' ? Array(nodes).fill(node)
      : selector.includes('path') || selector.includes('[d]') ? Array(edges).fill(edge) : [] });
  const diagram = element({ querySelector: selector => selector === 'svg' && svg ? graph : null });
  const table = element({ querySelectorAll: selector => selector === 'tbody tr' ? [element()]
    : selector.includes('li') ? Array(evidence).fill(element()) : [] });
  const host = element({ dataset: { previewStatus: 'needs_review', canonicalDigest: 'canonical-digest' },
    querySelector: selector => selector === '[data-pending-preview-diagram]' ? diagram
      : selector === '.mechanism-pending-preview-table' ? table : null });
  const document = { querySelector: () => host,
    getElementById: () => element({ textContent: '已保存' }) };
  const functionSource = script.slice(script.indexOf('async function visiblePendingMechanismGeometry('),
    script.indexOf('\nfunction summarizeProviderEvidence('));
  const check = vm.runInNewContext(`(${functionSource})`, { assert, document,
    getComputedStyle: () => ({ display: hidden ? 'none' : 'block', visibility: 'visible', opacity: '1' }) });
  const panel = { locator: () => ({ waitFor: async () => {} }),
    waitForFunction: async fn => { assert.ok(fn()); }, evaluate: async fn => fn() };
  return () => check(panel);
}

test('connected SVG nodes pass with zero disconnected list items', async () => {
  const geometry = await geometryPage()();
  assert.equal(geometry.graphNodeItems, 2);
  assert.equal(geometry.graphEdgeItems, 1);
  assert.equal(geometry.disconnectedNodeItems, 0);
});

test('text fallback, missing graph content, hidden graph and invalid geometry cannot pass', async () => {
  for (const scenario of [{ svg: false }, { nodes: 0 }, { edges: 0 }, { hidden: true },
    { invalidPath: true }, { viewBoxWidth: 0 }, { evidence: 0 }]) {
    await assert.rejects(geometryPage(scenario)());
  }
});

function requestBody(index = 1) {
  return { model: 'deepseek-flash', stream: false, messages: [{ role: 'user',
    content: JSON.stringify({ stage: 'panel_evidence_extraction', untrusted_panel_evidence: [{
      handle: `source-${index}`, panel_key: `figure-1:P${index}`,
      source_analysis_digest: `source-v2-${String(index).padStart(16, '0')}`,
      source_analysis: { directObservation: `Synthetic evidence ${index}` }
    }] }) }] };
}

function replay(directory, count) {
  const calls = [];
  for (let index = 1; index <= count; index++) {
    const suffix = String(index).padStart(3, '0');
    fs.writeFileSync(path.join(directory, `mechanism-request-${suffix}-redacted.json`), JSON.stringify(requestBody(index)));
    fs.writeFileSync(path.join(directory, `mechanism-response-${suffix}-redacted.json`), JSON.stringify({ synthetic: index }));
    calls.push({ sequence: index, status: 200, request: { stage: 'panel_evidence_extraction' } });
  }
  fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify({ mechanismProviderCalls: calls }));
}

test('source-bound 57-call pure replay passes CLI preflight without credentials; real cap stays 40', async () => {
  const api = await apiPromise;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mechanism-offline-preflight-'));
  const originalArgv = process.argv;
  try {
    const caption = '(A) Synthetic bounded caption.';
    const source = { schemaVersion: 1, url: 'https://example.org/synthetic', title: 'Synthetic',
      expectedPanelTotal: 1, figures: [{ sourceId: 'fig1', label: 'Figure 1', title: 'Synthetic figure',
        expectedPanels: ['A'], captionLength: caption.length, captionFingerprint: api.captionFingerprint(caption) }] };
    fs.writeFileSync(path.join(directory, 'figure.jpg'), Buffer.alloc(10001, 1));
    fs.writeFileSync(path.join(directory, 'source.json'), JSON.stringify(source));
    fs.writeFileSync(path.join(directory, 'article.json'), JSON.stringify({ url: source.url, title: source.title,
      paragraphs: [{ id: 'p1', text: 'Synthetic paragraph.' }], figures: [{ id: 'fig1', title: 'Synthetic figure',
        caption, image: 'https://example.org/figure.jpg', imageFile: 'figure.jpg' }] }));
    const figureDir = path.join(directory, 'figure'); fs.mkdirSync(figureDir);
    fs.writeFileSync(path.join(figureDir, 'request.json'), JSON.stringify({ model: 'deepseek-flash',
      messages: [{ role: 'user', content: JSON.stringify({ figure_id: 'fig1', figure_label: 'Figure 1', article_title: 'Synthetic' }) }] }));
    fs.writeFileSync(path.join(figureDir, 'response.json'), '{}');
    fs.writeFileSync(path.join(figureDir, 'report.json'), JSON.stringify({ providerCalls: [{ status: 200,
      request: { endpoint: '/chat/completions' }, artifacts: { request: 'request.json', response: 'response.json' } }] }));
    replay(directory, 57);
    const args = ['--article', path.join(directory, 'article.json'), '--source-manifest', path.join(directory, 'source.json'),
      '--figure-replay-dir', figureDir, '--mechanism-replay-dir', directory, '--preflight-only', '--model', 'deepseek-flash'];
    process.argv = [...originalArgv.slice(0, 2), ...args];
    const result = await api.run();
    assert.equal(result.outcome.status, 'INPUT_READY');
    assert.equal(result.mechanismRealApiCalls, 0);
    process.argv = [...originalArgv.slice(0, 2), ...args, '--mechanism-call-cap', '41'];
    await assert.rejects(api.run(), { code: 'LIVE_MECHANISM_ARGUMENT_INVALID' });
    replay(directory, 96);
    assert.equal(api.loadMechanismReplayEntries(directory, { maxEntries: 96 }).length, 96);
    assert.throws(() => api.loadMechanismReplayEntries(directory), { code: 'LIVE_MECHANISM_REPLAY_INVALID' });
    replay(directory, 97);
    assert.throws(() => api.loadMechanismReplayEntries(directory, { maxEntries: 96 }), { code: 'LIVE_MECHANISM_REPLAY_INVALID' });
  } finally { process.argv = originalArgv; fs.rmSync(directory, { recursive: true, force: true }); }
});

test('57 exact offline proxy responses bypass live budget, then fail closed without fixture or fetch', async () => {
  const api = await apiPromise;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mechanism-offline-proxy-'));
  const deadline = api.createRunDeadline(10000);
  let proxy;
  try {
    const entries = Array.from({ length: 57 }, (_, index) => ({ sequence: index + 1,
      stage: 'panel_evidence_extraction', requestBody: requestBody(index + 1),
      status: 200, contentType: 'application/json', responseBody: JSON.stringify({ synthetic: index + 1 }) }));
    const report = { figureReplay: [], mechanismProviderCalls: [] };
    const state = { figureReplayCalls: 0, boundaryCalls: 0, mechanismRealApiCalls: 0,
      mechanismFixtureCalls: 0, mechanismReplayCalls: 0, mechanismReplayUsedSequences: new Set() };
    proxy = await api.startCombinedProxy({ secret: '', replayEntries: [], mechanismReplayEntries: entries,
      liveMechanism: false, liveMechanismTail: false, mechanismCallCap: 40, configuredModel: 'deepseek-flash', deadline,
      report, state, outputDirectory: directory, downloadedHashes: new Set(),
      fetchImpl: async () => assert.fail('pure replay must never contact a provider') });
    for (const entry of entries) {
      const response = await fetch(`${proxy.url}/chat/completions`, { method: 'POST', headers: {
        'Content-Type': 'application/json', Authorization: 'Bearer live-figure-proxy-dummy-not-a-real-key'
      }, body: JSON.stringify(entry.requestBody) });
      assert.equal(response.status, 200, `saved sequence ${entry.sequence}`);
      assert.equal(await response.text(), entry.responseBody);
    }
    const exhausted = await fetch(`${proxy.url}/chat/completions`, { method: 'POST', headers: {
      'Content-Type': 'application/json', Authorization: 'Bearer live-figure-proxy-dummy-not-a-real-key'
    }, body: JSON.stringify(entries[0].requestBody) });
    assert.equal(exhausted.status, 502);
    assert.equal((await exhausted.json()).error.code, 'LIVE_MECHANISM_REPLAY_REQUEST_COUNT_MISMATCH');
    assert.equal(state.mechanismReplayCalls, 57);
    assert.equal(state.mechanismFixtureCalls, 0);
    assert.equal(state.mechanismRealApiCalls, 0);
    assert.ok(!state.callCapRejected);
  } finally {
    deadline.dispose();
    if (proxy) { proxy.server.closeAllConnections(); await new Promise(resolve => proxy.server.close(resolve)); }
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('both real and saved-prefix tail modes still stop before real API call 41', async () => {
  const api = await apiPromise;
  for (const tail of [false, true]) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mechanism-real-cap-test-'));
    const deadline = api.createRunDeadline(10000);
    let proxy;
    try {
      const entries = tail ? [{ sequence: 1, stage: 'panel_evidence_extraction', requestBody: requestBody(),
        status: 200, contentType: 'application/json', responseBody: '{"saved":true}' }] : [];
      const report = { figureReplay: [], mechanismProviderCalls: [] };
      const state = { figureReplayCalls: 0, boundaryCalls: 0, mechanismRealApiCalls: 0,
        mechanismFixtureCalls: 0, mechanismReplayCalls: 0, mechanismReplayUsedSequences: new Set() };
      let transportCalls = 0;
      proxy = await api.startCombinedProxy({ secret: 'synthetic-memory-only', replayEntries: [], mechanismReplayEntries: entries,
        liveMechanism: !tail, liveMechanismTail: tail, mechanismCallCap: 40, configuredModel: 'deepseek-flash', deadline,
        report, state, outputDirectory: directory, downloadedHashes: new Set(),
        fetchImpl: async () => { transportCalls++; return new Response('{"synthetic":true}', { status: 200 }); } });
      const send = () => fetch(`${proxy.url}/chat/completions`, { method: 'POST', headers: {
        'Content-Type': 'application/json', Authorization: 'Bearer live-figure-proxy-dummy-not-a-real-key'
      }, body: JSON.stringify(requestBody()) });
      if (tail) assert.equal((await send()).status, 200);
      for (let index = 0; index < 40; index++) assert.equal((await send()).status, 200);
      assert.equal((await send()).status, 429);
      assert.equal(transportCalls, 40);
      assert.equal(state.mechanismRealApiCalls, 40);
      assert.equal(state.mechanismReplayCalls, tail ? 1 : 0);
      assert.equal(state.mechanismFixtureCalls, 0);
      assert.equal(state.callCapRejected, true);
    } finally {
      deadline.dispose();
      if (proxy) { proxy.server.closeAllConnections(); await new Promise(resolve => proxy.server.close(resolve)); }
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }
});
