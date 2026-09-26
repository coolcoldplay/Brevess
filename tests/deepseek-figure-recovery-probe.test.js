const test = require('node:test');
const assert = require('node:assert/strict');
const {
  readFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync
} = require('node:fs');
const { spawnSync } = require('node:child_process');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const tls = require('node:tls');
const { tmpdir } = require('node:os');
const { dirname, join, resolve } = require('node:path');
const { PassThrough } = require('node:stream');
const { pathToFileURL } = require('node:url');
const { inflateSync } = require('node:zlib');

const root = join(__dirname, '..');
const scriptPath = join(root, 'scripts', 'probe-deepseek-figure-recovery.mjs');
const probeModule = import(pathToFileURL(scriptPath).href);

const networkRestorers = [];
function poisonNetwork(target, property) {
  const original = target[property];
  target[property] = function offlineNetworkForbidden() {
    throw Object.assign(new Error('Offline test attempted network access'), {
      code: 'OFFLINE_NETWORK_FORBIDDEN'
    });
  };
  networkRestorers.push(() => { target[property] = original; });
}

test.before(() => {
  poisonNetwork(globalThis, 'fetch');
  for (const [target, properties] of [
    [http, ['request', 'get']],
    [https, ['request', 'get']],
    [net, ['connect', 'createConnection']],
    [tls, ['connect']]
  ]) {
    for (const property of properties) poisonNetwork(target, property);
  }
});

test.after(() => {
  while (networkRestorers.length) networkRestorers.pop()();
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const GLYPHS = Object.freeze({
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000']
});

function rawPanel(panel) {
  return {
    panel,
    role: panel === 'A' ? 'phenotype' : 'other',
    phenotype_name_zh: panel === 'A' ? `合成读数 ${panel}` : '',
    method_category: 'other',
    methods: [`synthetic method ${panel}`],
    evidence_type_zh: `合成证据 ${panel}`,
    experimental_methods: [`synthetic assay ${panel}`],
    statistical_methods: [],
    method_source: 'image',
    purpose_zh: `识别合成 Panel ${panel}`,
    design_zh: `读取标记为 ${panel} 的方框`,
    comparison_zh: `Panel ${panel} 与其标签`,
    direct_observation_zh: `图中存在标签 ${panel}`,
    observation_source: 'image_observation',
    local_inference_zh: `该记录仅验证 ${panel} 可被读取`,
    contribution_zh: `覆盖合成 Panel ${panel}`
  };
}

function initialResponse(panels = ['A', 'B', 'C']) {
  return {
    figure_id: 'probe-figure',
    analysis_depth: 'standard',
    basis: 'vision_text',
    figure_title_zh: '合成 A-F Figure',
    figure_question_zh: '模型能否读取六个合成 Panel？',
    remaining_question_zh: '缺失 Panel 需要定向恢复。',
    panels: panels.map(rawPanel),
    panel_groups: panels.map(panel => ({
      panels: [panel],
      group_goal_zh: `读取 ${panel}`,
      group_conclusion_zh: `${panel} 已读取`
    })),
    logic_bridges: [],
    argument_chain: panels.map(panel => ({
      panels: [panel],
      established_zh: `${panel} 标签可见`,
      handoff_zh: `继续检查 ${panel} 后的标签`,
      evidence_level: 'descriptive'
    })),
    author_assembly_zh: '仅用于离线多模态探针。',
    core_conclusion_zh: '已返回部分合成 Panel。',
    claim_boundary_zh: '不得外推到真实科学结论。'
  };
}

function validDiagnosticReport() {
  return {
    schemaVersion: 2,
    status: 'PASS',
    inputMode: 'figure_image',
    model: 'deepseek-v4-flash-vision-exp',
    finishReason: 'stop',
    visualVerified: true,
    panelCounts: {
      requested: 6,
      received: 3,
      recovered: 3,
      unresolved: 0,
      unique: 6,
      matched: 6
    },
    requestCount: 2,
    tokenTotals: { input: 201, output: 81, reasoning: 21 },
    elapsedMs: 21
  };
}

function recoveryResponse() {
  return {
    figure_id: 'probe-figure',
    analysis_depth: 'standard',
    basis: 'vision_text',
    panels: [
      rawPanel('D'),
      rawPanel('E'),
      {
        panel: 'F',
        status: 'not_identifiable',
        reason_code: 'insufficient_panel_evidence',
        input_mode: 'figure_image',
        evidence_refs: ['image:figure_probe-figure']
      }
    ]
  };
}

function resolvedRecoveryResponse(panels) {
  return {
    figure_id: 'probe-figure',
    analysis_depth: 'standard',
    basis: 'vision_text',
    panels: panels.map(rawPanel)
  };
}

function offlineAdapter(responses, requests) {
  return {
    providerId: 'deepseek',
    async analyzeChunk(request) {
      requests.push(request);
      const index = requests.length - 1;
      const codes = decodeVisualCodes(request.images[0].dataUrl);
      request.onProviderTelemetry?.({
        providerId: 'deepseek',
        model: 'deepseek-v4-flash-vision-exp',
        finishReason: 'stop',
        inputTokens: 100 + index,
        outputTokens: 40 + index,
        reasoningTokens: 10 + index,
        elapsedMs: 5 + index
      });
      const response = structuredClone(responses[index]);
      if (Array.isArray(response?.panels)) {
        response.panels = response.panels.map(panel => ({
          ...panel,
          visual_code: codes[panel.panel]
        }));
      }
      return response;
    }
  };
}

function ttyFixture(options = {}) {
  const input = new PassThrough();
  input.isTTY = true;
  input.isRaw = false;
  const handle = {
    reading: false,
    readStartCalls: 0,
    readStopCalls: 0
  };
  input._handle = handle;
  const rawModes = [];
  input.setRawMode = value => {
    rawModes.push(value);
    input.isRaw = value;
  };
  const originalPause = input.pause.bind(input);
  let pauses = 0;
  input.pause = () => {
    pauses += 1;
    handle.reading = false;
    handle.readStopCalls += 1;
    return originalPause();
  };
  const originalResume = input.resume.bind(input);
  let resumes = 0;
  input.resume = () => {
    resumes += 1;
    handle.reading = true;
    handle.readStartCalls += 1;
    return originalResume();
  };
  let unrefs = 0;
  if (options.withUnref === true) {
    input.unref = () => {
      unrefs += 1;
    };
  }
  const writes = [];
  const output = {
    isTTY: true,
    write(value) {
      writes.push(String(value));
      return true;
    }
  };
  return {
    input, output, rawModes, writes, handle,
    pauses: () => pauses,
    resumes: () => resumes,
    unrefs: () => unrefs
  };
}

function assertTtyCleaned(fixture, expectedFlow = { flowing: null, paused: true }) {
  for (const event of ['data', 'end', 'close', 'error']) {
    assert.equal(fixture.input.listenerCount(event), 0, `${event} listener removed`);
  }
  assert.deepEqual(fixture.rawModes, [true, false]);
  assert.equal(fixture.input.readableFlowing, expectedFlow.flowing);
  assert.equal(fixture.input.isPaused(), expectedFlow.paused);
}

async function expectTtyEventFailure(api, event, code, detail) {
  const fixture = ttyFixture();
  const pending = api.readSecretFromTty({
    input: fixture.input,
    output: fixture.output,
    prompt: 'API key: '
  });
  const registered = fixture.input.listenerCount(event) > 0;
  if (registered) fixture.input.emit(event, detail);
  else fixture.input.write(Buffer.from('\r'));
  if (!registered) {
    await pending;
    assert.fail(`${event} listener was not installed`);
  }
  await assert.rejects(pending, error => error.code === code);
  assertTtyCleaned(fixture);
  assert.doesNotMatch(fixture.writes.join(''), /PRIVATEALPHANUMERIC/);
}

test('probe script is an offline-testable production Figure recovery harness', async () => {
  const api = await probeModule;
  const source = readFileSync(scriptPath, 'utf8');
  for (const productionSymbol of [
    'createProviderAdapter', 'createPanelRecoveryBatches', 'mergeRecoveredPanels',
    'compileFigureAnalysisPrompt', 'validateFigureAnalysis',
    'compileFigurePanelRecoveryPrompt', 'validateFigurePanelRecoveryResult'
  ]) {
    assert.match(source, new RegExp(`\\b${productionSymbol}\\b`), productionSymbol);
  }
  assert.doesNotMatch(source, /process\.env|process\.argv\s*\[\s*[23]\s*\]/);
  assert.doesNotMatch(source, /readline[^\n]*question/i);
  assert.match(source, /\brandomBytes\b/,
    'production visual codes use the Node cryptographic random source');

  assert.deepEqual(api.SYNTHETIC_FIGURE.panelHints, ['A', 'B', 'C', 'D', 'E', 'F']);
  const fixture = api.__testOnlyCreateVisualFixture();
  assert.equal(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(fixture.image.dataUrl), true);
  assert.ok(Buffer.byteLength(fixture.image.dataUrl) <=
    api.PROBE_LIMITS.maxImageDataUrlBytes);
  for (const [key, value] of Object.entries(api.PROBE_LIMITS)) {
    assert.equal(Number.isSafeInteger(value), true, key);
    assert.ok(value > 0, key);
  }
  assert.equal(api.PROBE_LIMITS.maxRequests, 3);
  assert.ok(api.PROBE_LIMITS.requestTimeoutMs <= 120000);
  assert.ok(api.PROBE_LIMITS.maxOutputTokens <= 8192);
});

test('runtime A-F fixture is a bounded pixel-only PNG with verified label glyphs', async () => {
  const api = await probeModule;
  const fixture = api.__testOnlyCreateVisualFixture();
  const parsed = parsePixelOnlyVisualPng(fixture.image.dataUrl);
  assert.deepEqual([parsed.width, parsed.height], [360, 180]);
  const pixelValues = new Set();
  for (let y = 0; y < parsed.height; y += 1) {
    for (let x = 0; x < parsed.width; x += 1) pixelValues.add(parsed.pixel(x, y));
  }
  assert.deepEqual([...pixelValues].sort((left, right) => left - right), [0, 255],
    'fixture contains only black and white pixels');
  for (const [index, label] of [...'ABCDEF'].entries()) {
    const cellX = (index % 3) * 120;
    const cellY = Math.floor(index / 3) * 90;
    assert.equal(parsed.pixel(cellX, cellY), 0, `${label} has a dark top-left border`);
    assert.equal(parsed.pixel(cellX + 119, cellY + 89), 0,
      `${label} has a dark bottom-right border`);
    const glyph = GLYPHS[label];
    for (let row = 0; row < glyph.length; row += 1) {
      for (let column = 0; column < glyph[row].length; column += 1) {
        if (glyph[row][column] !== '1') continue;
        assert.equal(parsed.pixel(cellX + 8 + column * 3, cellY + 8 + row * 3), 0,
          `${label} glyph pixel ${column},${row}`);
      }
    }
  }
});

test('offline harness validates initial output and recovers only missing labels', async () => {
  const api = await probeModule;
  const requests = [];
  const report = await api.runOfflineFigureRecoveryProbe({
    adapter: offlineAdapter([
      initialResponse(), resolvedRecoveryResponse(['D', 'E', 'F'])
    ], requests),
    now: () => 1000
  });

  assert.equal(requests.length, 2);
  assert.deepEqual(JSON.parse(requests[0].userPrompt).expected_panel_labels,
    ['A', 'B', 'C', 'D', 'E', 'F']);
  const recoveryPayload = JSON.parse(requests[1].userPrompt);
  assert.deepEqual(recoveryPayload.requested_panel_labels, ['D', 'E', 'F']);
  assert.deepEqual(recoveryPayload.completed_panel_labels, ['A', 'B', 'C']);
  for (const request of requests) {
    assert.equal(request.images.length, 1);
    assert.ok(Buffer.byteLength(JSON.stringify({
      systemPrompt: request.systemPrompt,
      userPrompt: request.userPrompt,
      schemaName: request.schemaName,
      responseSchema: request.responseSchema,
      images: request.images
    })) <= api.PROBE_LIMITS.maxRequestBytes);
    assert.ok(request.maxOutputTokens <= api.PROBE_LIMITS.maxOutputTokens);
    assert.ok(request.timeoutMs <= api.PROBE_LIMITS.requestTimeoutMs);
    assertVisualResponseSchema(request);
  }

  assert.deepEqual(report, {
    schemaVersion: 2,
    status: 'PASS',
    inputMode: 'figure_image',
    model: 'deepseek-v4-flash-vision-exp',
    finishReason: 'stop',
    visualVerified: true,
    panelCounts: {
      requested: 6,
      received: 3,
      recovered: 3,
      unresolved: 0,
      unique: 6,
      matched: 6
    },
    requestCount: 2,
    tokenTotals: { input: 201, output: 81, reasoning: 21 },
    elapsedMs: 0
  });
  const canonical = api.assertSafeDiagnosticReport(report);
  assert.notEqual(canonical, report);
  assert.deepEqual(JSON.parse(JSON.stringify(canonical)), report);
});

test('diagnostic report scanner rejects secrets, prompts, article content, pixels, and responses', async () => {
  const api = await probeModule;
  const forbidden = [
    { apiKey: 'private' },
    { nested: { Authorization: 'Bearer private' } },
    { systemPrompt: 'private prompt' },
    { articleText: 'private article body' },
    { image: { dataUrl: 'data:image/png;base64,AAAA' } },
    { oracle: 'must-not-be-written' },
    { pixels: 'must-not-be-written' },
    { visualCode: 'must-not-be-written' },
    { response: { raw: 'full model response' } },
    { safe: 'Bearer private' },
    { safe: 'data:image/png;base64,AAAA' },
    { safe: 'sk-' + 'a'.repeat(32) }
  ];
  for (const payload of forbidden) {
    assert.throws(
      () => api.assertNoForbiddenDiagnosticData(payload),
      error => error.code === 'UNSAFE_DIAGNOSTIC_REPORT'
    );
  }
});

test('safe reports reject non-finite or negative aggregate timings', async () => {
  const api = await probeModule;
  const requests = [];
  const report = await api.runOfflineFigureRecoveryProbe({
    adapter: offlineAdapter([
      initialResponse(['A', 'B', 'C', 'D', 'E', 'F'])
    ], requests),
    now: () => 10
  });
  for (const elapsedMs of [Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5]) {
    assert.throws(
      () => api.assertSafeDiagnosticReport({ ...report, elapsedMs }),
      error => error.code === 'UNSAFE_DIAGNOSTIC_REPORT'
    );
  }
  assert.throws(
    () => api.assertSafeDiagnosticReport({
      ...report,
      panelCounts: { ...report.panelCounts, recovered: 1 }
    }),
    error => error.code === 'UNSAFE_DIAGNOSTIC_REPORT',
    'Panel aggregate classifications must cover exactly six unique matches'
  );
});

test('diagnostic reports are canonicalized from strict own data shapes', async () => {
  const api = await probeModule;
  const unsafeReports = [];

  const inheritedToJSON = Object.assign(Object.create({
    toJSON() { return { apiKey: 'must-not-be-written' }; }
  }), validDiagnosticReport());
  unsafeReports.push(inheritedToJSON);

  const ownToJSON = validDiagnosticReport();
  Object.defineProperty(ownToJSON, 'toJSON', {
    value() { return { apiKey: 'must-not-be-written' }; },
    enumerable: false
  });
  unsafeReports.push(ownToJSON);

  const symbolReport = validDiagnosticReport();
  symbolReport[Symbol('secret')] = 'must-not-be-written';
  unsafeReports.push(symbolReport);

  const getterReport = validDiagnosticReport();
  Object.defineProperty(getterReport, 'status', {
    get() { return 'PASS'; },
    enumerable: true
  });
  unsafeReports.push(getterReport);

  unsafeReports.push(new Proxy(validDiagnosticReport(), {
    ownKeys() { throw new Error('untrusted ownKeys trap'); }
  }));
  const revoked = Proxy.revocable(validDiagnosticReport(), {});
  revoked.revoke();
  unsafeReports.push(revoked.proxy);

  const inheritedTokenTotals = validDiagnosticReport();
  inheritedTokenTotals.tokenTotals = Object.assign(Object.create({ inherited: true }), {
    input: 201, output: 81, reasoning: 21
  });
  unsafeReports.push(inheritedTokenTotals);

  const tokenToJSON = validDiagnosticReport();
  Object.defineProperty(tokenToJSON.tokenTotals, 'toJSON', {
    value() { return { apiKey: 'must-not-be-written' }; },
    enumerable: false
  });
  unsafeReports.push(tokenToJSON);

  const tokenSymbol = validDiagnosticReport();
  tokenSymbol.tokenTotals[Symbol('secret')] = 1;
  unsafeReports.push(tokenSymbol);

  const tokenGetter = validDiagnosticReport();
  Object.defineProperty(tokenGetter.tokenTotals, 'input', {
    get() { return 201; },
    enumerable: true
  });
  unsafeReports.push(tokenGetter);

  const proxiedTokenTotals = validDiagnosticReport();
  proxiedTokenTotals.tokenTotals = new Proxy(proxiedTokenTotals.tokenTotals, {
    ownKeys() { throw new Error('untrusted token trap'); }
  });
  unsafeReports.push(proxiedTokenTotals);

  const inheritedPanelCounts = validDiagnosticReport();
  Object.setPrototypeOf(inheritedPanelCounts.panelCounts,
    Object.create(Object.prototype, {
      toJSON: { value() { return { requested: 6 }; } }
    }));
  unsafeReports.push(inheritedPanelCounts);

  const extraPanelCountProperty = validDiagnosticReport();
  Object.defineProperty(extraPanelCountProperty.panelCounts, 'extra', {
    value: 'must-not-be-written', enumerable: false
  });
  unsafeReports.push(extraPanelCountProperty);

  const panelCountSymbol = validDiagnosticReport();
  panelCountSymbol.panelCounts[Symbol('secret')] = 'must-not-be-written';
  unsafeReports.push(panelCountSymbol);

  const panelCountGetter = validDiagnosticReport();
  Object.defineProperty(panelCountGetter.panelCounts, 'matched', {
    get() { return 6; }, enumerable: true
  });
  unsafeReports.push(panelCountGetter);

  const proxiedPanelCounts = validDiagnosticReport();
  proxiedPanelCounts.panelCounts = new Proxy(proxiedPanelCounts.panelCounts, {
    ownKeys() { throw new Error('untrusted count trap'); }
  });
  unsafeReports.push(proxiedPanelCounts);

  for (const report of unsafeReports) {
    assert.throws(
      () => api.assertSafeDiagnosticReport(report),
      error => error.code === 'UNSAFE_DIAGNOSTIC_REPORT'
    );
  }

  const source = validDiagnosticReport();
  const canonical = api.assertSafeDiagnosticReport(source);
  source.status = 'MUTATED';
  source.tokenTotals.input = 999;
  source.panelCounts.received = 0;
  assert.deepEqual(JSON.parse(JSON.stringify(canonical)), validDiagnosticReport(),
    'canonical report must not retain mutable input objects');
});

test('failed report canonicalization never replaces an existing report', async t => {
  const api = await probeModule;
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'brevess-probe-canonical-'));
  t.after(() => rmSync(temporaryRoot, { recursive: true, force: true }));
  const writeTestReport = api.__testOnlyCreateReportWriter({ rootDir: temporaryRoot });
  const safeReport = validDiagnosticReport();
  const reportPath = await writeTestReport(safeReport);
  const original = readFileSync(reportPath, 'utf8');
  const inheritedToJSON = Object.assign(Object.create({
    toJSON() { return { apiKey: 'must-not-be-written' }; }
  }), validDiagnosticReport());

  await assert.rejects(
    writeTestReport(inheritedToJSON),
    error => error.code === 'UNSAFE_DIAGNOSTIC_REPORT'
  );
  assert.equal(readFileSync(reportPath, 'utf8'), original);
});

for (const [prototypeName, prototype] of [
  ['Object.prototype', Object.prototype],
  ['Array.prototype', Array.prototype]
]) {
  test(`report writer ignores inherited ${prototypeName}.toJSON pollution`, async () => {
    const api = await probeModule;
    const temporaryRoot = mkdtempSync(join(tmpdir(), 'brevess-probe-to-json-'));
    const previousDescriptor = Object.getOwnPropertyDescriptor(prototype, 'toJSON');
    let hookCalls = 0;
    try {
      Object.defineProperty(prototype, 'toJSON', {
        configurable: true,
        writable: true,
        value() {
          hookCalls += 1;
          return { apiKey: 'must-not-be-written' };
        }
      });
      const writeTestReport = api.__testOnlyCreateReportWriter({ rootDir: temporaryRoot });
      const reportPath = await writeTestReport(validDiagnosticReport());

      assert.equal(hookCalls, 0, 'serialization must not invoke inherited hooks');
      assert.deepEqual(JSON.parse(readFileSync(reportPath, 'utf8')), validDiagnosticReport());
      assert.deepEqual(readdirSync(dirname(reportPath)), ['report.json'],
        'prototype pollution leaves no atomic temporary file');
    } finally {
      if (previousDescriptor) {
        Object.defineProperty(prototype, 'toJSON', previousDescriptor);
      } else {
        delete prototype.toJSON;
      }
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });
}

test('report writer exposes one fixed production target and atomically stores only safe fields', async t => {
  const api = await probeModule;
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'brevess-probe-'));
  t.after(() => rmSync(temporaryRoot, { recursive: true, force: true }));
  const report = await api.runOfflineFigureRecoveryProbe({
    adapter: offlineAdapter([initialResponse(['A', 'B', 'C', 'D', 'E', 'F'])], []),
    now: (() => { let value = 0; return () => ++value; })()
  });
  assert.equal(api.FIXED_REPORT_RELATIVE_PATH,
    'tmp/deepseek-figure-recovery/report.json');
  assert.equal(api.writeRedactedReport.length, 1,
    'production writer cannot accept a caller-selected root or file name');
  const writeTestReport = api.__testOnlyCreateReportWriter({ rootDir: temporaryRoot });
  const reportPath = await writeTestReport(report);
  const expectedRoot = resolve(temporaryRoot, 'tmp', 'deepseek-figure-recovery');
  assert.equal(resolve(reportPath), resolve(expectedRoot, 'report.json'));
  assert.equal(existsSync(reportPath), true);
  assert.deepEqual(JSON.parse(readFileSync(reportPath, 'utf8')), report);
  assert.deepEqual(readdirSync(expectedRoot), ['report.json'],
    'atomic temporary file is always removed');
  assert.doesNotMatch(readFileSync(reportPath, 'utf8'),
    /authorization|apiKey|prompt|articleText|data:image|rawResponse|fullResponse|oracle|pixels|visualCode/i);
});

test('console summary contains only fixed enums and aggregate safe report fields', async () => {
  const api = await probeModule;
  const summary = api.__testOnlySafeConsoleSummary(validDiagnosticReport());
  assert.match(summary, /^PASS\n/);
  assert.match(summary, /visual verified: true/);
  assert.match(summary, /panels matched: 6/);
  assert.match(summary, /tokens: 282/);
  assert.doesNotMatch(summary,
    /authorization|apiKey|prompt|articleText|data:image|rawResponse|oracle|pixels|visualCode/i);
});

test('report writer refuses junction or symlink traversal outside its fixed target', async t => {
  const api = await probeModule;
  const temporaryBase = mkdtempSync(join(tmpdir(), 'brevess-probe-link-'));
  const rootDir = join(temporaryBase, 'root');
  const outsideDir = join(temporaryBase, 'outside');
  mkdirSync(rootDir);
  mkdirSync(outsideDir);
  symlinkSync(outsideDir, join(rootDir, 'tmp'), process.platform === 'win32' ? 'junction' : 'dir');
  t.after(() => rmSync(temporaryBase, { recursive: true, force: true }));
  const report = await api.runOfflineFigureRecoveryProbe({
    adapter: offlineAdapter([initialResponse(['A', 'B', 'C', 'D', 'E', 'F'])], []),
    now: (() => { let value = 0; return () => ++value; })()
  });
  const writeTestReport = api.__testOnlyCreateReportWriter({ rootDir });
  await assert.rejects(
    writeTestReport(report),
    error => error.code === 'UNSAFE_REPORT_PATH'
  );
  assert.deepEqual(readdirSync(outsideDir), []);
});

test('secret input requires two TTYs and successful input is never copied to output', async () => {
  const api = await probeModule;
  const redirected = new PassThrough();
  redirected.isTTY = false;
  await assert.rejects(
    api.readSecretFromTty({ input: redirected, output: { isTTY: true, write() {} } }),
    error => error.code === 'TTY_REQUIRED'
  );

  const redirectedOutput = new PassThrough();
  redirectedOutput.isTTY = false;
  const inputForRedirectedOutput = ttyFixture().input;
  await assert.rejects(
    api.readSecretFromTty({ input: inputForRedirectedOutput, output: redirectedOutput }),
    error => error.code === 'TTY_REQUIRED'
  );

  const fixture = ttyFixture();
  const pending = api.readSecretFromTty({
    input: fixture.input, output: fixture.output, prompt: 'API key: '
  });
  fixture.input.write(Buffer.from('non-echoed-secret\r'));
  const secret = await pending;

  assert.equal(secret, 'non-echoed-secret');
  assertTtyCleaned(fixture);
  assert.doesNotMatch(fixture.writes.join(''), /non-echoed-secret/);
  assert.match(fixture.writes.join(''), /API key:/);
});

test('TTY secret reader settles and cleans up on EOF, close, error, Ctrl-C, and oversize', async () => {
  const api = await probeModule;
  await expectTtyEventFailure(api, 'end', 'PROBE_TTY_CLOSED');
  await expectTtyEventFailure(api, 'close', 'PROBE_TTY_CLOSED');
  await expectTtyEventFailure(
    api,
    'error',
    'PROBE_TTY_IO_ERROR',
    Object.assign(new Error('PRIVATEALPHANUMERIC987654321'), {
      code: 'PRIVATEALPHANUMERIC987654321'
    })
  );

  const interrupted = ttyFixture();
  const interruptedPending = api.readSecretFromTty({
    input: interrupted.input, output: interrupted.output
  });
  interrupted.input.write(Buffer.from([3]));
  await assert.rejects(interruptedPending, error => error.code === 'PROBE_INTERRUPTED');
  assertTtyCleaned(interrupted);

  const oversized = ttyFixture();
  const oversizedPending = api.readSecretFromTty({
    input: oversized.input, output: oversized.output
  });
  oversized.input.write(Buffer.from('x'.repeat(api.PROBE_LIMITS.maxSecretChars + 1)));
  await assert.rejects(oversizedPending, error => error.code === 'PROBE_KEY_TOO_LONG');
  assertTtyCleaned(oversized);
});

test('TTY input refuses existing consumers before any prompt or raw-mode change', async () => {
  const api = await probeModule;
  for (const eventName of ['data', 'readable']) {
    const fixture = ttyFixture();
    const existingListener = () => {};
    fixture.input.on(eventName, existingListener);
    const beforeCount = fixture.input.listenerCount(eventName);
    await assert.rejects(
      api.readSecretFromTty({ input: fixture.input, output: fixture.output }),
      error => error.code === 'TTY_REQUIRED'
    );
    assert.equal(fixture.input.listenerCount(eventName), beforeCount,
      'pre-existing listener is preserved');
    assert.equal(fixture.input.listeners(eventName).includes(existingListener), true);
    assert.deepEqual(fixture.rawModes, []);
    assert.deepEqual(fixture.writes, []);
    fixture.input.removeListener(eventName, existingListener);
  }
});

test('TTY input restores flowing state while stopped inputs remain stopped', async () => {
  const api = await probeModule;
  for (const state of ['neutral', 'flowing', 'paused']) {
    const fixture = ttyFixture();
    if (state === 'flowing') fixture.input.resume();
    if (state === 'paused') fixture.input.pause();
    const expectedFlow = {
      flowing: fixture.input.readableFlowing,
      paused: state !== 'flowing'
    };
    const pending = api.readSecretFromTty({ input: fixture.input, output: fixture.output });
    fixture.input.emit('data', Buffer.from('safe-placeholder\r'));
    assert.equal(await pending, 'safe-placeholder');
    assertTtyCleaned(fixture, expectedFlow);
  }
});

test('TTY neutral cleanup calls read-stop without resume or unref', async () => {
  const api = await probeModule;
  for (const withUnref of [false, true]) {
    const fixture = ttyFixture({ withUnref });
    assert.equal(typeof fixture.input.unref, withUnref ? 'function' : 'undefined');
    const pending = api.readSecretFromTty({ input: fixture.input, output: fixture.output });
    const pausesBeforeFinish = fixture.pauses();
    const resumesBeforeFinish = fixture.resumes();
    const readStopsBeforeFinish = fixture.handle.readStopCalls;
    const unrefsBeforeFinish = fixture.unrefs();
    assert.equal(fixture.handle.reading, true, 'secret reader activates the input handle');
    fixture.input.emit('data', Buffer.from('safe-placeholder\r'));
    assert.equal(await pending, 'safe-placeholder');
    assert.equal(fixture.pauses(), pausesBeforeFinish + 1,
      'neutral cleanup pauses stdin once');
    assert.equal(fixture.handle.readStopCalls, readStopsBeforeFinish + 1,
      'pause reaches the underlying read-stop operation');
    assert.equal(fixture.handle.reading, false,
      'the underlying input handle no longer reads');
    assert.equal(fixture.resumes(), resumesBeforeFinish,
      'cleanup never resumes an originally neutral stdin');
    assert.equal(fixture.unrefs(), unrefsBeforeFinish,
      'unref is never substituted for stopping the read');
    assertTtyCleaned(fixture);
  }
});

test('TTY terminal handlers settle once and ignore later data callbacks', async () => {
  const api = await probeModule;
  const fixture = ttyFixture();
  const pending = api.readSecretFromTty({ input: fixture.input, output: fixture.output });
  const dataHandler = fixture.input.listeners('data')[0];
  const closeHandler = fixture.input.listeners('close')[0];
  const endHandler = fixture.input.listeners('end')[0];
  const errorHandler = fixture.input.listeners('error')[0];
  dataHandler(Buffer.from('safe-placeholder\r'));
  assert.equal(await pending, 'safe-placeholder');
  let coercions = 0;
  dataHandler({ toString() { coercions += 1; return 'late-data'; } });
  closeHandler();
  endHandler();
  errorHandler(new Error('late error'));
  assert.equal(coercions, 0);
  assert.deepEqual(fixture.rawModes, [true, false]);
  assert.equal(fixture.writes.filter(value => value === '\n').length, 1);
  assertTtyCleaned(fixture);
});

test('TTY setup and output exceptions reject safely without leaking provider-controlled codes', async () => {
  const api = await probeModule;
  const outputFailure = ttyFixture();
  outputFailure.output.write = () => {
    throw Object.assign(new Error('PRIVATEALPHANUMERICOUTPUT123456789'), {
      code: 'PRIVATEALPHANUMERICOUTPUT123456789'
    });
  };
  await assert.rejects(
    api.readSecretFromTty({ input: outputFailure.input, output: outputFailure.output }),
    error => error.code === 'PROBE_TTY_IO_ERROR'
  );
  for (const event of ['data', 'end', 'close', 'error']) {
    assert.equal(outputFailure.input.listenerCount(event), 0);
  }

  const rawFailure = ttyFixture();
  rawFailure.input.setRawMode = () => {
    throw new Error('raw setup failed');
  };
  await assert.rejects(
    api.readSecretFromTty({ input: rawFailure.input, output: rawFailure.output }),
    error => error.code === 'TTY_REQUIRED'
  );
  for (const event of ['data', 'end', 'close', 'error']) {
    assert.equal(rawFailure.input.listenerCount(event), 0);
  }
  assert.deepEqual(rawFailure.rawModes, [], 'failed setup is not treated as armed raw mode');
  assert.equal(rawFailure.input.readableFlowing, null);
  assert.equal(rawFailure.input.isPaused(), true);

  const rawRestoreFailure = ttyFixture();
  rawRestoreFailure.input.setRawMode = value => {
    rawRestoreFailure.rawModes.push(value);
    if (value === false) throw new Error('raw restore failed');
    rawRestoreFailure.input.isRaw = value;
  };
  const rawRestorePending = api.readSecretFromTty({
    input: rawRestoreFailure.input,
    output: rawRestoreFailure.output
  });
  rawRestoreFailure.input.emit('data', Buffer.from('safe-placeholder\r'));
  await assert.rejects(
    rawRestorePending,
    error => error.code === 'PROBE_TTY_IO_ERROR'
  );
  assert.deepEqual(rawRestoreFailure.rawModes, [true, false]);
  for (const event of ['data', 'end', 'close', 'error']) {
    assert.equal(rawRestoreFailure.input.listenerCount(event), 0);
  }
  assert.equal(rawRestoreFailure.input.readableFlowing, null);
  assert.equal(rawRestoreFailure.input.isPaused(), true);

  assert.equal(api.safeErrorCode({ code: 'PROBE_TTY_IO_ERROR' }), 'PROBE_TTY_IO_ERROR');
  assert.equal(api.safeErrorCode({ code: 'INVALID_RESPONSE' }), 'INVALID_RESPONSE');
  assert.equal(api.safeErrorCode({ code: 'PROBE_VISUAL_ASSERTION_FAILED' }),
    'PROBE_VISUAL_ASSERTION_FAILED');
  assert.equal(api.safeErrorCode({ code: 'PRIVATEALPHANUMERIC987654321' }),
    'PROBE_FAILED');
  let accessorCalls = 0;
  const accessorError = {};
  Object.defineProperty(accessorError, 'code', {
    get() {
      accessorCalls += 1;
      throw new Error('PRIVATEALPHANUMERIC987654321');
    }
  });
  assert.equal(api.safeErrorCode(accessorError), 'PROBE_FAILED');
  assert.equal(accessorCalls, 0, 'error-code accessors are never executed');
  assert.equal(api.safeErrorCode({ code: { toString() { accessorCalls += 1; } } }),
    'PROBE_FAILED');
  assert.equal(accessorCalls, 0, 'object error codes are never stringified');
});

test('offline harness enforces response, request-count, time, and Token caps', async () => {
  const api = await probeModule;
  const fixture = api.__testOnlyCreateVisualFixture();
  for (const [budget, code] of [
    [{ requestCount: api.PROBE_LIMITS.maxRequests + 1 }, 'PROBE_REQUEST_LIMIT_EXCEEDED'],
    [{ elapsedMs: api.PROBE_LIMITS.maxTotalElapsedMs + 1 }, 'PROBE_TIME_LIMIT_EXCEEDED'],
    [{ tokenTotal: api.PROBE_LIMITS.maxTotalTokens + 1 }, 'PROBE_TOKEN_LIMIT_EXCEEDED']
  ]) {
    assert.throws(
      () => api.assertProbeBudget(budget),
      error => error.code === code,
      code
    );
  }
  assert.throws(
    () => api.assertBoundedProviderRequest({
      systemPrompt: 'x'.repeat(api.PROBE_LIMITS.maxRequestBytes + 1),
      userPrompt: 'probe',
      schemaName: 'probe',
      responseSchema: { type: 'object' },
      images: [fixture.image],
      maxOutputTokens: api.PROBE_LIMITS.maxOutputTokens,
      timeoutMs: api.PROBE_LIMITS.requestTimeoutMs
    }),
    error => error.code === 'PROBE_REQUEST_TOO_LARGE'
  );
  const oversized = initialResponse();
  oversized.figure_title_zh = 'x'.repeat(api.PROBE_LIMITS.maxResponseBytes + 1);
  await assert.rejects(
    api.runOfflineFigureRecoveryProbe({
      adapter: offlineAdapter([oversized], []),
      now: () => 1
    }),
    error => error.code === 'PROBE_RESPONSE_TOO_LARGE'
  );

  const adapter = offlineAdapter([initialResponse()], []);
  adapter.analyzeChunk = async request => {
    request.onProviderTelemetry?.({
      providerId: 'deepseek',
      model: 'deepseek-v4-flash-vision-exp',
      finishReason: 'stop',
      inputTokens: api.PROBE_LIMITS.maxTotalTokens,
      outputTokens: 1,
      reasoningTokens: 0,
      elapsedMs: api.PROBE_LIMITS.requestTimeoutMs
    });
    return initialResponse(['A', 'B', 'C', 'D', 'E', 'F']);
  };
  await assert.rejects(
    api.runOfflineFigureRecoveryProbe({ adapter, now: () => 1 }),
    error => error.code === 'PROBE_TOKEN_LIMIT_EXCEEDED'
  );
});

test('total deadline aborts an adapter that ignores its signal', async () => {
  const api = await probeModule;
  let calls = 0;
  let observedSignal = null;
  const adapter = {
    async analyzeChunk(request) {
      calls += 1;
      observedSignal = request.signal;
      return new Promise(() => {});
    }
  };
  let clockCalls = 0;
  const now = () => clockCalls++ === 0 ? 0 : api.PROBE_LIMITS.maxTotalElapsedMs - 1;
  const guard = new Promise((_, reject) => setTimeout(() => reject(
    Object.assign(new Error('probe deadline did not settle'), { code: 'TEST_TIMEOUT' })
  ), 100));

  await assert.rejects(
    Promise.race([api.runOfflineFigureRecoveryProbe({ adapter, now }), guard]),
    error => error.code === 'PROBE_TIME_LIMIT_EXCEEDED'
  );
  assert.equal(calls, 1);
  assert.equal(observedSignal?.aborted, true);
});

test('an exhausted total deadline is enforced before a recovery request', async () => {
  const api = await probeModule;
  let clock = 0;
  let calls = 0;
  const adapter = {
    async analyzeChunk(request) {
      calls += 1;
      request.onProviderTelemetry?.({
        inputTokens: 10, outputTokens: 5, reasoningTokens: 0
      });
      clock = api.PROBE_LIMITS.maxTotalElapsedMs + 1;
      return initialResponse(['A']);
    }
  };
  await assert.rejects(
    api.runOfflineFigureRecoveryProbe({ adapter, now: () => clock }),
    error => error.code === 'PROBE_TIME_LIMIT_EXCEEDED'
  );
  assert.equal(calls, 1, 'deadline breach prevents every recovery request');
});

test('every adapter response must report usage before the probe can continue', async () => {
  const api = await probeModule;
  let calls = 0;
  const adapter = {
    async analyzeChunk() {
      calls += 1;
      return initialResponse(['A']);
    }
  };
  await assert.rejects(
    api.runOfflineFigureRecoveryProbe({ adapter, now: () => 1 }),
    error => error.code === 'PROBE_TOKEN_USAGE_MISSING'
  );
  assert.equal(calls, 1);

  let coercions = 0;
  const coercingAdapter = {
    async analyzeChunk(request) {
      request.onProviderTelemetry?.({
        inputTokens: { valueOf() { coercions += 1; return 10; } },
        outputTokens: 5
      });
      return initialResponse(['A']);
    }
  };
  await assert.rejects(
    api.runOfflineFigureRecoveryProbe({ adapter: coercingAdapter, now: () => 1 }),
    error => error.code === 'PROBE_TOKEN_USAGE_MISSING'
  );
  assert.equal(coercions, 0, 'usage objects are never coerced');
});

test('A-F recovery reaches the three-request ceiling without weakening initial validation', async () => {
  const api = await probeModule;
  assert.equal(api.PROBE_LIMITS.maxRequests, 3);
  const requests = [];
  const report = await api.runOfflineFigureRecoveryProbe({
    adapter: offlineAdapter([
      initialResponse(['A']),
      resolvedRecoveryResponse(['B', 'C', 'D']),
      resolvedRecoveryResponse(['E', 'F'])
    ], requests),
    now: () => 100
  });
  assert.equal(requests.length, 3);
  assert.deepEqual(requests.slice(1).map(request =>
    JSON.parse(request.userPrompt).requested_panel_labels), [
    ['B', 'C', 'D'], ['E', 'F']
  ]);
  assert.deepEqual(report.panelCounts, {
    requested: 6,
    received: 1,
    recovered: 5,
    unresolved: 0,
    unique: 6,
    matched: 6
  });
  assert.equal(report.requestCount, 3);
});

test('an empty initial Panel response is invalid and never used to manufacture retries', async () => {
  const api = await probeModule;
  const requests = [];
  await assert.rejects(
    api.runOfflineFigureRecoveryProbe({
      adapter: offlineAdapter([initialResponse([])], requests),
      now: () => 1
    }),
    error => error.code === 'PROBE_VISUAL_ASSERTION_FAILED'
  );
  assert.equal(requests.length, 1);
});

test('a visually verified but unresolved Panel can never produce PASS', async () => {
  const api = await probeModule;
  const requests = [];
  await assert.rejects(
    api.runOfflineFigureRecoveryProbe({
      adapter: offlineAdapter([initialResponse(), recoveryResponse()], requests),
      now: () => 1
    }),
    error => error.code === 'PROBE_VISUAL_ASSERTION_FAILED'
  );
  assert.equal(requests.length, 2);
});

test('a fourth request is rejected before the adapter is called', async () => {
  const api = await probeModule;
  const requests = [];
  await assert.rejects(
    api.runOfflineFigureRecoveryProbe({
      adapter: offlineAdapter([
        initialResponse(['A']),
        resolvedRecoveryResponse(['B', 'C']),
        resolvedRecoveryResponse(['D', 'E'])
      ], requests),
      recoveryBatchSize: 2,
      now: () => 1
    }),
    error => error.code === 'PROBE_REQUEST_LIMIT_EXCEEDED'
  );
  assert.equal(requests.length, 3);
  assert.deepEqual(requests.map(request =>
    JSON.parse(request.userPrompt).requested_panel_labels ||
      JSON.parse(request.userPrompt).expected_panel_labels), [
    ['A', 'B', 'C', 'D', 'E', 'F'], ['B', 'C'], ['D', 'E']
  ]);
});

test('production DeepSeek adapter is exercised only through injected offline fetch', async () => {
  const api = await probeModule;
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url: String(url), body: JSON.parse(options.body) });
    return {
      ok: true,
      status: 200,
      headers: { get() { return null; } },
      async text() {
        return JSON.stringify({
          model: 'deepseek-v4-flash-vision-exp',
          choices: [{
            finish_reason: 'stop',
            message: {
              content: JSON.stringify(responseWithWireVisualCodes(
                initialResponse(['A', 'B', 'C', 'D', 'E', 'F']),
                requests[0].body
              ))
            }
          }],
          usage: {
            prompt_tokens: 7,
            completion_tokens: 3,
            completion_tokens_details: { reasoning_tokens: 0 }
          }
        });
      }
    };
  };
  const adapter = api.createDeepSeekProbeAdapter('OFFLINE_PLACEHOLDER', { fetchImpl });
  const report = await api.runOfflineFigureRecoveryProbe({
    adapter,
    now: () => 10
  });
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /^https:\/\/api\.deepseek\.com\//);
  assert.equal(requests[0].body.model, 'deepseek-v4-flash-vision-exp');
  assert.equal(requests[0].body.stream, false);
  assert.deepEqual(requests[0].body.thinking, { type: 'disabled' });
  assert.deepEqual(requests[0].body.response_format, { type: 'json_object' });
  assert.ok(Buffer.byteLength(JSON.stringify(requests[0].body)) <=
    api.PROBE_LIMITS.maxRequestBytes);
  assert.equal(Array.isArray(requests[0].body.messages[1].content), true);
  assert.equal(requests[0].body.messages[1].content.some(item =>
    item.type === 'image_url' && /^data:image\/png;base64,/.test(item.image_url?.url)), true);
  assert.deepEqual(report.tokenTotals, { input: 7, output: 3, reasoning: 0 });
});

test('production DeepSeek adapter bounds the exact serialized HTTP body before fetch', async () => {
  const api = await probeModule;
  const fixture = api.__testOnlyCreateVisualFixture();
  let fetchCalls = 0;
  const adapter = api.createDeepSeekProbeAdapter('OFFLINE_PLACEHOLDER', {
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error('fetch must not receive an oversized wire body');
    }
  });
  await assert.rejects(
    adapter.analyzeChunk({
      systemPrompt: 'bounded probe',
      userPrompt: 'bounded probe',
      schemaName: 'wire_body_probe',
      responseSchema: {
        type: 'object',
        description: '\\'.repeat(api.PROBE_LIMITS.maxRequestBytes)
      },
      images: [fixture.image],
      maxOutputTokens: api.PROBE_LIMITS.maxOutputTokens,
      timeoutMs: api.PROBE_LIMITS.requestTimeoutMs
    }),
    error => error.code === 'PROBE_REQUEST_TOO_LARGE'
  );
  assert.equal(fetchCalls, 0);
});

test('production DeepSeek adapter rejects oversized streamed outer responses', async () => {
  const api = await probeModule;
  const outer = JSON.stringify({
    ignored: 'x'.repeat(api.PROBE_LIMITS.maxResponseBytes),
    model: 'deepseek-v4-flash-vision-exp',
    choices: [{
      finish_reason: 'stop',
      message: {
        content: JSON.stringify(initialResponse(['A', 'B', 'C', 'D', 'E', 'F']))
      }
    }],
    usage: { prompt_tokens: 7, completion_tokens: 3 }
  });
  const bytes = Buffer.from(outer);
  let offset = 0;
  let cancelled = false;
  const body = {
    getReader() {
      return {
        async read() {
          if (offset >= bytes.length) return { done: true, value: undefined };
          const value = bytes.subarray(offset, Math.min(bytes.length, offset + 32768));
          offset += value.length;
          return { done: false, value };
        },
        cancel() { cancelled = true; },
        releaseLock() {}
      };
    }
  };
  const adapter = api.createDeepSeekProbeAdapter('OFFLINE_PLACEHOLDER', {
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: { get() { return null; } },
      body,
      async text() { return outer; }
    })
  });

  await assert.rejects(
    api.runOfflineFigureRecoveryProbe({ adapter, now: () => 1 }),
    error => error.code === 'PROBE_RESPONSE_TOO_LARGE'
  );
  assert.equal(cancelled, true);
});

test('production DeepSeek adapter rejects declared oversized responses before reading', async () => {
  const api = await probeModule;
  let textCalls = 0;
  let cancelled = false;
  const adapter = api.createDeepSeekProbeAdapter('OFFLINE_PLACEHOLDER', {
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: {
        get(name) {
          return String(name).toLowerCase() === 'content-length'
            ? String(api.PROBE_LIMITS.maxResponseBytes + 1)
            : null;
        }
      },
      body: { cancel() { cancelled = true; } },
      async text() {
        textCalls += 1;
        return '{}';
      }
    })
  });
  await assert.rejects(
    api.runOfflineFigureRecoveryProbe({ adapter, now: () => 1 }),
    error => error.code === 'PROBE_RESPONSE_TOO_LARGE'
  );
  assert.equal(textCalls, 0);
  assert.equal(cancelled, true);
});

test('production DeepSeek SSE fallback without usage fails closed', async () => {
  const api = await probeModule;
  const adapter = api.createDeepSeekProbeAdapter('OFFLINE_PLACEHOLDER', {
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: { get() { return null; } },
      async text() {
        return `data: ${JSON.stringify({
          choices: [{
            delta: {
              content: JSON.stringify(initialResponse(['A', 'B', 'C', 'D', 'E', 'F']))
            }
          }]
        })}\n\ndata: [DONE]\n\n`;
      }
    })
  });
  await assert.rejects(
    api.runOfflineFigureRecoveryProbe({ adapter, now: () => 1 }),
    error => error.code === 'PROBE_TOKEN_USAGE_MISSING'
  );
});

test('production DeepSeek adapter fails closed when HTTP usage is absent', async () => {
  const api = await probeModule;
  let fetchCalls = 0;
  const adapter = api.createDeepSeekProbeAdapter('OFFLINE_PLACEHOLDER', {
    fetchImpl: async () => {
      fetchCalls += 1;
      return {
        ok: true,
        status: 200,
        headers: { get() { return null; } },
        async text() {
          return JSON.stringify({
            model: 'deepseek-v4-flash-vision-exp',
            choices: [{
              finish_reason: 'stop',
              message: { content: JSON.stringify(initialResponse(['A'])) }
            }]
          });
        }
      };
    }
  });
  await assert.rejects(
    api.runOfflineFigureRecoveryProbe({ adapter, now: () => 1 }),
    error => error.code === 'PROBE_TOKEN_USAGE_MISSING'
  );
  assert.equal(fetchCalls, 1);
});

test('production DeepSeek adapter rejects fractional usage before normalization', async () => {
  const api = await probeModule;
  const adapter = api.createDeepSeekProbeAdapter('OFFLINE_PLACEHOLDER', {
    fetchImpl: async (_url, options) => {
      const wireBody = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        headers: { get() { return null; } },
        async text() {
          return JSON.stringify({
            model: 'deepseek-v4-flash-vision-exp',
            choices: [{
              finish_reason: 'stop',
              message: { content: JSON.stringify(responseWithWireVisualCodes(
                initialResponse([...'ABCDEF']),
                wireBody
              )) }
            }],
            usage: { prompt_tokens: 7.5, completion_tokens: 3 }
          });
        }
      };
    }
  });
  await assert.rejects(
    api.runOfflineFigureRecoveryProbe({ adapter, now: () => 1 }),
    error => error.code === 'PROBE_TOKEN_USAGE_MISSING'
  );
});

test('production DeepSeek adapter completes one partial-to-recovery round trip', async () => {
  const api = await probeModule;
  const responses = [
    initialResponse(['A', 'B', 'C']),
    resolvedRecoveryResponse(['D', 'E', 'F'])
  ];
  const requests = [];
  const adapter = api.createDeepSeekProbeAdapter('OFFLINE_PLACEHOLDER', {
    fetchImpl: async (url, options) => {
      const index = requests.length;
      requests.push({ url: String(url), body: JSON.parse(options.body) });
      return {
        ok: true,
        status: 200,
        headers: { get() { return null; } },
        async text() {
          return JSON.stringify({
            model: 'deepseek-v4-flash-vision-exp',
            choices: [{
              finish_reason: 'stop',
              message: { content: JSON.stringify(responseWithWireVisualCodes(
                responses[index],
                requests[index].body
              )) }
            }],
            usage: { prompt_tokens: 10 + index, completion_tokens: 5 + index }
          });
        }
      };
    }
  });
  const report = await api.runOfflineFigureRecoveryProbe({ adapter, now: () => 1 });
  assert.equal(requests.length, 2);
  const recoveryUserContent = requests[1].body.messages[1].content;
  const recoveryPrompt = JSON.parse(
    recoveryUserContent.find(item => item.type === 'text').text
  );
  assert.deepEqual(recoveryPrompt.requested_panel_labels, ['D', 'E', 'F']);
  assert.deepEqual(report.panelCounts, {
    requested: 6,
    received: 3,
    recovered: 3,
    unresolved: 0,
    unique: 6,
    matched: 6
  });
});

test('production DeepSeek telemetry over budget stops before any recovery request', async () => {
  const api = await probeModule;
  const requests = [];
  const responses = [
    initialResponse(['A']),
    resolvedRecoveryResponse(['B', 'C', 'D']),
    resolvedRecoveryResponse(['E', 'F'])
  ];
  const fetchImpl = async (url, options) => {
    const index = requests.length;
    requests.push({ url: String(url), body: JSON.parse(options.body) });
    return {
      ok: true,
      status: 200,
      headers: { get() { return null; } },
      async text() {
        return JSON.stringify({
          model: 'deepseek-v4-flash-vision-exp',
          choices: [{
            finish_reason: 'stop',
            message: { content: JSON.stringify(responses[index]) }
          }],
          usage: index === 0
            ? {
              prompt_tokens: api.PROBE_LIMITS.maxTotalTokens + 1,
              completion_tokens: 0
            }
            : { prompt_tokens: 0, completion_tokens: 0 }
        });
      }
    };
  };
  const adapter = api.createDeepSeekProbeAdapter('OFFLINE_PLACEHOLDER', { fetchImpl });

  await assert.rejects(
    api.runOfflineFigureRecoveryProbe({ adapter, now: () => 1 }),
    error => error.code === 'PROBE_TOKEN_LIMIT_EXCEEDED'
  );

  assert.equal(requests.length, 1, 'token breach prevents a second adapter/fetch call');
  const firstUserContent = requests[0].body.messages[1].content;
  const firstPrompt = JSON.parse(firstUserContent.find(item => item.type === 'text').text);
  assert.deepEqual(firstPrompt.expected_panel_labels, ['A', 'B', 'C', 'D', 'E', 'F']);
  assert.equal(Object.hasOwn(firstPrompt, 'requested_panel_labels'), false,
    'the only request is the initial analysis, never a recovery request');
});

test('interactive main ignores environment and argv secrets and refuses redirected stdin', () => {
  const environmentSecret = 'ENVPRIVATEALPHANUMERIC987654321';
  const argvSecret = 'ARGVPRIVATEALPHANUMERIC987654321';
  const childEnvironment = { DEEPSEEK_API_KEY: environmentSecret };
  for (const key of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP']) {
    if (process.env[key]) childEnvironment[key] = process.env[key];
  }
  const child = spawnSync(process.execPath, [scriptPath, argvSecret], {
    encoding: 'utf8',
    env: childEnvironment,
    input: '',
    timeout: 5000
  });
  assert.equal(child.status, 1);
  assert.match(child.stderr, /^FAIL TTY_REQUIRED\s*$/);
  assert.doesNotMatch(`${child.stdout}\n${child.stderr}`,
    new RegExp(`${environmentSecret}|${argvSecret}`, 'i'));
});

const VISUAL_CODE_GLYPHS = Object.freeze({
  2: ['11110', '00001', '00001', '11110', '10000', '10000', '11111'],
  3: ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  4: ['10010', '10010', '10010', '11111', '00010', '00010', '00010'],
  5: ['11111', '10000', '10000', '11110', '00001', '00001', '11110'],
  6: ['01111', '10000', '10000', '11110', '10001', '10001', '01110'],
  7: ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  8: ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  9: ['01110', '10001', '10001', '01111', '00001', '00001', '11110']
});

function parsePixelOnlyVisualPng(dataUrl) {
  const prefix = 'data:image/png;base64,';
  assert.equal(dataUrl.startsWith(prefix), true);
  const png = Buffer.from(dataUrl.slice(prefix.length), 'base64');
  assert.deepEqual(png.subarray(0, 8), Buffer.from('89504e470d0a1a0a', 'hex'));
  const chunks = [];
  let offset = 8;
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const typeBytes = png.subarray(offset + 4, offset + 8);
    const type = typeBytes.toString('ascii');
    const data = png.subarray(offset + 8, offset + 8 + length);
    assert.equal(crc32(Buffer.concat([typeBytes, data])),
      png.readUInt32BE(offset + 8 + length), `${type} CRC`);
    chunks.push({ type, data });
    offset += 12 + length;
    if (type === 'IEND') break;
  }
  assert.equal(offset, png.length);
  assert.deepEqual(chunks.map(chunk => chunk.type), ['IHDR', 'IDAT', 'IEND'],
    'visual oracle PNG must contain no text or ancillary metadata chunks');
  const ihdr = chunks[0].data;
  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  assert.deepEqual([width, height], [360, 180]);
  assert.deepEqual([...ihdr.subarray(8)], [8, 0, 0, 0, 0]);
  const raw = inflateSync(Buffer.concat(
    chunks.filter(chunk => chunk.type === 'IDAT').map(chunk => chunk.data)
  ), { maxOutputLength: height * (width + 1) });
  assert.equal(raw.length, height * (width + 1));
  for (let row = 0; row < height; row += 1) {
    assert.equal(raw[row * (width + 1)], 0);
  }
  return {
    width,
    height,
    pixel(x, y) { return raw[y * (width + 1) + 1 + x]; }
  };
}

function decodeVisualCodes(dataUrl) {
  const parsed = parsePixelOnlyVisualPng(dataUrl);
  const glyphByBits = new Map(Object.entries(VISUAL_CODE_GLYPHS)
    .map(([value, glyph]) => [glyph.join(''), value]));
  const decoded = {};
  for (const [index, panel] of [...'ABCDEF'].entries()) {
    const cellX = (index % 3) * 120;
    const cellY = Math.floor(index / 3) * 90;
    let code = '';
    for (let character = 0; character < 3; character += 1) {
      let bits = '';
      for (let row = 0; row < 7; row += 1) {
        for (let column = 0; column < 5; column += 1) {
          bits += parsed.pixel(
            cellX + 15 + character * 35 + column * 5 + 2,
            cellY + 42 + row * 5 + 2
          ) === 0 ? '1' : '0';
        }
      }
      const value = glyphByBits.get(bits);
      assert.ok(value, `Panel ${panel} character ${character + 1} decodes`);
      code += value;
    }
    decoded[panel] = code;
  }
  return decoded;
}

function visualInitialResponse(codes, panels = [...'ABCDEF']) {
  const response = initialResponse(panels);
  response.panels = response.panels.map(panel => ({
    ...panel,
    visual_code: codes[panel.panel]
  }));
  return response;
}

function responseWithWireVisualCodes(response, wireBody) {
  const userContent = wireBody.messages?.[1]?.content;
  const imageUrl = Array.isArray(userContent)
    ? userContent.find(item => item?.type === 'image_url')?.image_url?.url
    : '';
  const codes = decodeVisualCodes(imageUrl);
  const copy = structuredClone(response);
  if (Array.isArray(copy?.panels)) {
    copy.panels = copy.panels.map(panel => ({
      ...panel,
      visual_code: codes[panel.panel]
    }));
  }
  return copy;
}

function pixelReadingAdapter(requests, options = {}) {
  return {
    providerId: 'deepseek',
    async analyzeChunk(request) {
      requests.push(request);
      const image = request.images[0].dataUrl;
      const codes = decodeVisualCodes(image);
      request.onProviderTelemetry?.({
        providerId: 'deepseek',
        model: options.model || 'deepseek-v4-flash-vision-exp',
        finishReason: options.finishReason || 'stop',
        inputTokens: options.inputTokens ?? 100,
        outputTokens: options.outputTokens ?? 40,
        reasoningTokens: options.reasoningTokens ?? 10,
        elapsedMs: 5
      });
      return visualInitialResponse(codes);
    }
  };
}

function assertVisualResponseSchema(request) {
  const item = request.responseSchema?.properties?.panels?.items;
  const variants = Array.isArray(item?.oneOf) ? item.oneOf : [item];
  assert.ok(variants.length >= 1);
  for (const schema of variants) {
    assert.equal(schema?.additionalProperties, false);
    assert.deepEqual(schema?.properties?.visual_code, {
      type: 'string', pattern: '^[2-9]{3}$'
    });
    assert.equal(schema?.required?.filter(field => field === 'visual_code').length, 1);
  }
}

test('runtime visual oracle is CSPRNG-shaped, unique, bounded, and encoded only in PNG pixels', async () => {
  const api = await probeModule;
  const { first, second } = api.__testOnlyCreateMetamorphicVisualPair();
  for (const fixture of [first, second]) {
    assert.deepEqual(Object.keys(fixture.oracle), [...'ABCDEF']);
    assert.equal(new Set(Object.values(fixture.oracle)).size, 6);
    for (const code of Object.values(fixture.oracle)) {
      assert.equal(/^[2-9]{3}$/.test(code), true, 'oracle code uses the safe alphabet');
    }
    assert.equal(JSON.stringify(decodeVisualCodes(fixture.image.dataUrl)) ===
      JSON.stringify(fixture.oracle), true, 'decoded pixels match the in-memory oracle');
    assert.ok(Buffer.byteLength(fixture.image.dataUrl) <= api.PROBE_LIMITS.maxImageDataUrlBytes);
  }
  assert.equal(first.image.dataUrl !== second.image.dataUrl, true,
    'metamorphic fixture must change its pixel oracle');
});

test('pixel-reading adapter passes exact six-Panel visual gate without leaking codes into text', async () => {
  const api = await probeModule;
  const requests = [];
  const report = await api.runOfflineFigureRecoveryProbe({
    adapter: pixelReadingAdapter(requests),
    now: () => 100
  });
  assert.equal(requests.length, 1);
  const codes = decodeVisualCodes(requests[0].images[0].dataUrl);
  const textualRequest = JSON.stringify({
    systemPrompt: requests[0].systemPrompt,
    userPrompt: requests[0].userPrompt,
    schemaName: requests[0].schemaName,
    responseSchema: requests[0].responseSchema
  });
  for (const code of Object.values(codes)) assert.equal(textualRequest.includes(code), false);
  assertVisualResponseSchema(requests[0]);
  assert.deepEqual(report, {
    schemaVersion: 2,
    status: 'PASS',
    inputMode: 'figure_image',
    model: 'deepseek-v4-flash-vision-exp',
    finishReason: 'stop',
    visualVerified: true,
    panelCounts: {
      requested: 6,
      received: 6,
      recovered: 0,
      unresolved: 0,
      unique: 6,
      matched: 6
    },
    requestCount: 1,
    tokenTotals: { input: 100, output: 40, reasoning: 10 },
    elapsedMs: 0
  });
  assert.equal(Object.values(codes).some(code => JSON.stringify(report).includes(code)), false,
    'safe report excludes every visual code');
});

test('image-blind and constant adapters fail the visual assertion deterministically', async () => {
  const api = await probeModule;
  for (const codeForPanel of [
    panel => `${panel}${panel}${panel}`,
    () => '222'
  ]) {
    const adapter = {
      providerId: 'deepseek',
      async analyzeChunk(request) {
        request.onProviderTelemetry?.({
          providerId: 'deepseek', model: 'deepseek-v4-flash-vision-exp',
          finishReason: 'stop', inputTokens: 10, outputTokens: 5, reasoningTokens: 0
        });
        const response = initialResponse([...'ABCDEF']);
        response.panels = response.panels.map(panel => ({
          ...panel, visual_code: codeForPanel(panel.panel)
        }));
        return response;
      }
    };
    await assert.rejects(
      api.runOfflineFigureRecoveryProbe({ adapter, now: () => 1 }),
      error => error.code === 'PROBE_VISUAL_ASSERTION_FAILED'
    );
  }
});

test('image-blind replay fails across a same-prompt different-pixels metamorphic pair', async () => {
  const api = await probeModule;
  const pair = api.__testOnlyCreateMetamorphicVisualPair();
  assert.equal(pair.first.image.dataUrl !== pair.second.image.dataUrl, true);
  assert.equal(JSON.stringify(pair.first.oracle) !== JSON.stringify(pair.second.oracle), true);
  const replayedCodes = decodeVisualCodes(pair.first.image.dataUrl);
  const requests = [];
  const imageBlindReplayAdapter = {
    providerId: 'deepseek',
    async analyzeChunk(request) {
      requests.push(request);
      request.onProviderTelemetry?.({
        providerId: 'deepseek', model: 'deepseek-v4-flash-vision-exp',
        finishReason: 'stop', inputTokens: 10, outputTokens: 5, reasoningTokens: 0
      });
      return visualInitialResponse(replayedCodes);
    }
  };
  await api.__testOnlyRunWithVisualFixture({
    adapter: imageBlindReplayAdapter, now: () => 10
  }, pair.first);
  await assert.rejects(
    api.__testOnlyRunWithVisualFixture({
      adapter: imageBlindReplayAdapter, now: () => 10
    }, pair.second),
    error => error.code === 'PROBE_VISUAL_ASSERTION_FAILED'
  );
  const textRequests = requests.map(request => JSON.stringify({
    systemPrompt: request.systemPrompt,
    userPrompt: request.userPrompt,
    schemaName: request.schemaName,
    responseSchema: request.responseSchema
  }));
  assert.equal(requests.length, 2);
  assert.equal(textRequests[0], textRequests[1]);
});

test('PASS requires exact model, stop, and reasoning as a subset of output only', async () => {
  const api = await probeModule;
  for (const options of [
    { model: 'deepseek-chat' },
    { finishReason: 'length' },
    { outputTokens: 4, reasoningTokens: 5 },
    { inputTokens: 1.5 }
  ]) {
    await assert.rejects(
      api.runOfflineFigureRecoveryProbe({
        adapter: pixelReadingAdapter([], options), now: () => 1
      }),
      error => ['PROBE_VISUAL_ASSERTION_FAILED', 'PROBE_TOKEN_USAGE_MISSING']
        .includes(error.code)
    );
  }
  const report = await api.runOfflineFigureRecoveryProbe({
    adapter: pixelReadingAdapter([], {
      inputTokens: api.PROBE_LIMITS.maxTotalTokens - 5,
      outputTokens: 5,
      reasoningTokens: 5
    }),
    now: () => 1
  });
  assert.deepEqual(report.tokenTotals, {
    input: api.PROBE_LIMITS.maxTotalTokens - 5,
    output: 5,
    reasoning: 5
  });
});
