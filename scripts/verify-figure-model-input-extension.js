// Isolated real-extension Figure acceptance. Every model response is served by
// a deterministic loopback fixture; this script never reads or calls a real API.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { chromium } = require('playwright');

const root = path.resolve(process.env.SCI_EXTENSION_ROOT || path.join(__dirname, '..'));
const output = path.resolve(
  process.env.SCI_QA_OUTPUT_DIR || path.join(root, 'output/playwright/figure-model-input')
);
const extension = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-figure-input-extension-'));
const articleOrigin = 'https://example.org';
const imageBytesByPath = new Map();
const report = {
  acceptance: 'real extension UI with local deterministic provider fixtures',
  provider: 'synthetic loopback mock only',
  realApiCalls: 0,
  realServiceSuccessClaimed: false,
  checks: [],
  scenarios: {},
  sourceHashes: {},
  screenshots: [],
  diagnostics: []
};
let server;
let serverUrl = '';
let activeScenario = null;
let activeContext = null;
let activePanel = null;
const verifyDocumentRefresh = process.env.SCI_FIGURE_REVISION_QA === '1';

function stage(value) { process.stdout.write(`${value}\n`); }
function check(name, value) {
  assert.ok(value, name);
  report.checks.push(name);
  stage(`PASS ${name}`);
}
function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}
function labels(first, last) {
  const values = [];
  for (let code = first.charCodeAt(0); code <= last.charCodeAt(0); code += 1) {
    values.push(String.fromCharCode(code));
  }
  return values;
}

const figurePanels = {
  'figure-1': labels('A', 'Z'),
  'figure-2': labels('A', 'E')
};

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const name = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function syntheticPng(width, height, seed) {
  const rows = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1);
    rows[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = row + 1 + x * 3;
      const band = Math.floor(x / Math.max(1, Math.floor(width / 8)));
      rows[offset] = (seed * 47 + band * 29 + y) % 256;
      rows[offset + 1] = (seed * 83 + x + band * 13) % 256;
      rows[offset + 2] = (seed * 31 + x + y * 2) % 256;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(rows, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

imageBytesByPath.set('/figure-1.png', syntheticPng(720, 420, 1));
imageBytesByPath.set('/figure-2.png', syntheticPng(720, 420, 2));

function figureCaption(number, panelIds) {
  const statements = panelIds.map(panel =>
    `(${panel}) Synthetic assay ${panel} reports the bounded readout for condition ${panel}.`
  );
  return `Figure ${number}. ${statements.join(' ')}`;
}

function articleFixture(scenarioName) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Figure model-input acceptance ${scenarioName}</title>
    <link rel="canonical" href="${articleOrigin}/${scenarioName}"></head><body><main><article>
    <h1>Figure model-input acceptance ${scenarioName}</h1>
    <section><h2>Abstract</h2><p>This synthetic article tests the model input selected for Figure interpretation.</p></section>
    <section><h2>Introduction</h2><p>The experiment compares matched conditions and records bounded molecular readouts without making claims beyond the supplied evidence.</p></section>
    <section><h2>Results</h2>
      <p>Figure 1 reports a complete A through Z assay series in matched synthetic samples. The body states that every labeled readout belongs to Figure 1.</p>
      <p>Figure 2 reports a focused A through E validation series. The body states that Panel E is the final validation readout in Figure 2.</p>
      <figure id="figure-one"><img src="${articleOrigin}/figure-1.png" width="720" height="420" alt="Synthetic Figure 1 pixels">
        <figcaption><span class="figure-label">Figure 1</span>. ${figureCaption(1, figurePanels['figure-1'])}</figcaption></figure>
      <figure id="figure-two"><img src="${articleOrigin}/figure-2.png" width="720" height="420" alt="Synthetic Figure 2 pixels">
        <figcaption><span class="figure-label">Figure 2</span>. ${figureCaption(2, figurePanels['figure-2'])}</figcaption></figure>
    </section>
    <section><h2>Discussion</h2><p>The synthetic evidence is deliberately limited to the captions, related body text, and generated pixels.</p></section>
    <section><h2>Methods</h2><p>All inputs and responses are deterministic local fixtures used only for browser acceptance.</p></section>
    </article></main></body></html>`;
}

function prepareExtension() {
  for (const dir of ['core', 'providers', 'vendor', 'icons', '_locales']) {
    fs.cpSync(path.join(root, dir), path.join(extension, dir), { recursive: true });
  }
  for (const file of fs.readdirSync(root)) {
    if (/\.(?:js|mjs|html|css)$/.test(file) || file === 'manifest.json') {
      fs.copyFileSync(path.join(root, file), path.join(extension, file));
    }
  }
  for (const file of [
    'content.js', 'content.css', 'popup.js', 'ui-swiss.css', 'background.js',
    'core/figure-workspace.js', 'core/tab-messenger.js', 'core/background-router.js',
    'core/llm-task-catalog.js', 'core/task-profile-router.js',
    'providers/deepseek.js'
  ]) {
    report.sourceHashes[file] = sha256(fs.readFileSync(path.join(extension, file)));
  }
  const contentFile = path.join(extension, 'content.js');
  const contentSource = fs.readFileSync(contentFile, 'utf8');
  const diagnosticFailSource = `    const fail = code => {\n        const error = new Error(code);\n        error.code = code;\n        try {\n            const diagnosticEnvelope = targetEnvelope?.figureResult\n                ? targetEnvelope : clearEnvelope?.figureResult ? clearEnvelope : discardEnvelope;\n            console.error('FIGURE_QA_DIAG ' + JSON.stringify({\n                source: 'persistFigureInventoryWithCas.fail',\n                code, targetFigureId, targetDepth,\n                checkpointWrite, checkpointClear, checkpointDiscard,\n                panelIds: Array.isArray(diagnosticEnvelope?.figureResult?.panels)\n                    ? diagnosticEnvelope.figureResult.panels.map(panel =>\n                        String(panel?.panel || '')).slice(0, 30) : [],\n                resultKeys: diagnosticEnvelope?.figureResult &&\n                    typeof diagnosticEnvelope.figureResult === 'object'\n                    ? Object.keys(diagnosticEnvelope.figureResult).sort() : [],\n                stack: String(error.stack || '').split('\\n').slice(0, 5)\n            }));\n        } catch (_) {}\n        throw error;\n    };`;
  const casStart = contentSource.indexOf('async function persistFigureInventoryWithCas');
  const failStart = contentSource.indexOf('    const fail = code => {', casStart);
  const failEnd = contentSource.indexOf('    };', failStart) + '    };'.length;
  assert.ok(casStart >= 0 && failStart > casStart && failEnd > failStart,
    'temporary CAS diagnostic insertion point exists');
  fs.writeFileSync(contentFile,
    contentSource.slice(0, failStart) + diagnosticFailSource + contentSource.slice(failEnd));
  const networkFile = path.join(extension, 'offscreen-network-worker.js');
  const boundary = `const qaNativeFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (url, options) => {
  const parsed = new URL(String(url));
  if (parsed.origin !== 'https://api.deepseek.com' ||
      !['/responses', '/chat/completions'].includes(parsed.pathname)) {
    throw new Error('QA_BLOCKED_REMOTE_FETCH');
  }
  return qaNativeFetch(${JSON.stringify(serverUrl)} + parsed.pathname, options);
};\n`;
  fs.writeFileSync(networkFile, boundary + fs.readFileSync(networkFile, 'utf8'));
  report.testInjection =
    'Temporary copied offscreen worker redirects only DeepSeek provider fetches to loopback; content CAS failure logging is diagnostic-only';
}

function extractUserPayload(body) {
  const message = Array.isArray(body?.messages)
    ? body.messages.find(item => item?.role === 'user') : null;
  const content = message?.content;
  const text = typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? String(content.find(item => item?.type === 'text')?.text || '')
      : '';
  return { text, payload: JSON.parse(text) };
}

function imageDataUrls(body) {
  return (Array.isArray(body?.messages) ? body.messages : [])
    .flatMap(message => Array.isArray(message?.content) ? message.content : [])
    .filter(item => item?.type === 'image_url')
    .map(item => String(item?.image_url?.url || ''))
    .filter(value => /^data:image\//u.test(value));
}

function panelRecord(figureId, panel, basis) {
  const vision = basis === 'vision_text';
  return {
    panel,
    role: 'phenotype',
    phenotype_name_zh: `${figureId} Panel ${panel} 合成表型`,
    method_category: 'wet_lab',
    methods: [`合成检测 ${panel}`],
    evidence_type_zh: '受控合成实验',
    experimental_methods: [`合成检测 ${panel}`],
    statistical_methods: [],
    method_source: vision ? 'image' : 'caption',
    purpose_zh: `检验 ${figureId} Panel ${panel} 的限定问题`,
    design_zh: `合成条件 ${panel} 与匹配对照比较`,
    comparison_zh: `条件 ${panel} 对比匹配对照`,
    direct_observation_zh: `${figureId} Panel ${panel} 显示方向明确的合成读数`,
    observation_source: vision ? 'image_observation' : 'caption_statement',
    local_inference_zh: `该证据仅支持 Panel ${panel} 的局部结论`,
    contribution_zh: `Panel ${panel} 提供一项独立证据`
  };
}

function wholeFigureOutput(input, returnedPanels = null) {
  const panelIds = returnedPanels || input.expected_panel_labels ||
    (Array.isArray(input.panel_evidence) ? input.panel_evidence.map(item => item.panel) : ['A']);
  const basis = input.analysis_basis === 'vision_text' ? 'vision_text' : 'caption_context';
  const output = {
    figure_id: input.figure_id,
    analysis_depth: input.analysis_depth || 'standard',
    basis,
    figure_question_zh: `${input.figure_label || input.figure_id} 的各 Panel 如何形成证据链？`,
    panels: panelIds.map(panel => panelRecord(input.figure_id, panel, basis)),
    panel_groups: [{
      panels: [...panelIds],
      group_goal_zh: '逐项核对合成读数',
      group_conclusion_zh: `${input.figure_id} 的已返回 Panel 构成一致的限定证据`
    }],
    logic_bridges: [],
    argument_chain: [{
      panels: [...panelIds],
      established_zh: `${input.figure_id} 的已返回 Panel 建立合成观察。`,
      handoff_zh: '下一步仅在已提供证据范围内解释。',
      evidence_level: 'intervention_effect'
    }],
    author_assembly_zh: '作者按 Panel 顺序组织合成证据。',
    core_conclusion_zh: `${input.figure_id} 合成结论 ${basis}`,
    claim_boundary_zh: '该结论仅用于本地 mock 验收，不代表真实科学或服务结果。'
  };
  if (input.pass === 'panel_extraction') {
    return {
      figure_id: output.figure_id,
      analysis_depth: output.analysis_depth,
      basis: output.basis,
      panels: output.panels
    };
  }
  if (input.pass === 'figure_synthesis') {
    const { panels, ...synthesis } = output;
    return synthesis;
  }
  return output;
}

function recoveryOutput(input) {
  const basis = input.analysis_basis === 'vision_text' ? 'vision_text' : 'caption_context';
  return {
    figure_id: input.figure_id,
    analysis_depth: input.analysis_depth || 'standard',
    basis,
    panels: input.requested_panel_labels.map(panel =>
      panelRecord(input.figure_id, panel, basis))
  };
}

function providerEnvelope(value) {
  return {
    id: `mock_${activeScenario.requests.length}`,
    model: activeScenario.model,
    choices: [{
      index: 0,
      message: { role: 'assistant', content: JSON.stringify(value) },
      finish_reason: 'stop'
    }],
    usage: { prompt_tokens: 101, completion_tokens: 53, total_tokens: 154 }
  };
}

function requestSummary(body, payload, urls) {
  const decoded = urls.map(url => {
    const comma = url.indexOf(',');
    const bytes = comma >= 0 ? Buffer.from(url.slice(comma + 1), 'base64') : Buffer.alloc(0);
    return {
      mediaType: url.slice(5, url.indexOf(';')),
      bytes: bytes.length,
      sha256: sha256(bytes)
    };
  });
  return {
    sequence: activeScenario.requests.length + 1,
    path: '/chat/completions',
    model: String(body.model || ''),
    figureId: String(payload.figure_id || ''),
    pass: String(payload.pass || 'whole_figure'),
    expectedPanels: Array.isArray(payload.expected_panel_labels)
      ? payload.expected_panel_labels : [],
    requestedPanels: Array.isArray(payload.requested_panel_labels)
      ? payload.requested_panel_labels : [],
    evidencePanels: Array.isArray(payload.panel_evidence)
      ? payload.panel_evidence.map(item => item?.panel).filter(Boolean) : [],
    imageCount: urls.length,
    images: decoded,
    hasCaption: (typeof payload.caption === 'string' &&
      payload.caption.includes('Synthetic assay')) ||
      (typeof payload.figure_context?.shared_legend === 'string' &&
        payload.figure_context.shared_legend.includes('Synthetic assay')) ||
      Object.values(payload.figure_context?.panel_caption_slices || {})
        .some(value => String(value).includes('Synthetic assay')),
    hasBodyContext: Array.isArray(payload.related_body_context)
      ? payload.related_body_context.some(item => /Figure [12]/u.test(String(item?.text || '')))
      : payload.figure_context?.body_registry &&
        Object.values(payload.figure_context.body_registry)
          .some(item => /Figure [12]/u.test(String(item?.text || '')))
  };
}

async function startServer() {
  server = http.createServer(async (request, reply) => {
    reply.setHeader('Access-Control-Allow-Origin', '*');
    reply.setHeader('Access-Control-Allow-Headers', '*');
    if (request.method === 'OPTIONS') {
      reply.writeHead(204);
      reply.end();
      return;
    }
    try {
      assert.equal(request.method, 'POST');
      assert.equal(request.url, '/chat/completions');
      assert.ok(activeScenario, 'active scenario exists');
      let raw = '';
      for await (const chunk of request) raw += chunk;
      const body = JSON.parse(raw);
      const { payload } = extractUserPayload(body);
      const urls = imageDataUrls(body);
      const summary = requestSummary(body, payload, urls);
      activeScenario.requests.push(summary);
      stage(`REQUEST ${activeScenario.name} ${JSON.stringify({
        sequence: summary.sequence,
        figureId: summary.figureId,
        pass: summary.pass,
        expectedPanels: summary.expectedPanels,
        requestedPanels: summary.requestedPanels,
        imageCount: summary.imageCount
      })}`);
      assert.equal(body.model, activeScenario.model);
      assert.ok(summary.figureId, `unexpected non-Figure request: ${JSON.stringify(payload)}`);
      let value;
      if (payload.pass === 'missing_panel_recovery') {
        value = recoveryOutput(payload);
      } else if (activeScenario.injectIncomplete && !activeScenario.incompleteInjected &&
          payload.figure_id === 'figure-2' && !payload.pass) {
        activeScenario.incompleteInjected = true;
        value = wholeFigureOutput(payload, ['A', 'B', 'C', 'D']);
      } else {
        value = wholeFigureOutput(payload);
      }
      reply.setHeader('Content-Type', 'application/json');
      reply.end(JSON.stringify(providerEnvelope(value)));
    } catch (error) {
      reply.statusCode = 500;
      reply.setHeader('Content-Type', 'application/json');
      reply.end(JSON.stringify({ error: { message: String(error.message || error) } }));
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  serverUrl = `http://127.0.0.1:${server.address().port}`;
}

async function setupProfile(panel, scenario) {
  await panel.evaluate(async profile => {
    for (const message of [
      {
        type: 'LLM_SAVE_PROFILE',
        profile: {
          id: profile.id,
          name: profile.name,
          providerId: 'deepseek',
          config: {
            apiKey: 'fixture-not-a-real-key', model: profile.model,
            maxOutputTokens: 16384, reasoningEnabled: false
          }
        }
      },
      { type: 'LLM_UPDATE_PROFILE_ROUTING', globalProfileId: profile.id, taskRoutes: {} },
      { type: 'LLM_UPDATE_PREFERENCES', preferences: { mode: 'llm', consentGranted: true } }
    ]) {
      const result = await chrome.runtime.sendMessage(message);
      if (!result?.success) throw new Error(`SETUP_FAILED:${JSON.stringify(result?.error)}`);
    }
    await loadLlmSettings();
    await refreshArticleWorkspace();
    switchWorkspaceView('figures');
  }, {
    id: `profile_qa_${scenario.name.replace(/[^a-z0-9_]/giu, '_')}`,
    name: `QA ${scenario.name} synthetic`,
    model: scenario.model
  });
}

async function currentArchive(panel) {
  return panel.evaluate(async () => (await getCurrentArticleArchiveFromTab()).archive);
}

function archiveFigures(archive) {
  return Array.isArray(archive?.workspace?.figures) ? archive.workspace.figures : [];
}

function figureResult(figure) {
  return figure?.modelStandard || figure?.standard || figure?.result || null;
}

function pendingStandardCheckpoint(figure) {
  return Boolean(
    figure?.pendingStandard ||
    figure?.pendingResumeCheckpoints?.standard ||
    figure?.pendingResults?.standard
  );
}

function durablyCompleteFigure(figure, figureId) {
  return figureResult(figure)?.panels?.length === figurePanels[figureId].length &&
    !String(figure?.standardError || '') && !pendingStandardCheckpoint(figure);
}

async function waitForArchive(panel, predicate, description, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    try {
      last = await currentArchive(panel);
      if (predicate(last)) return last;
    } catch (error) {
      if (!/ARTICLE_ARCHIVE_DOCUMENT_NOT_READY/u.test(String(error?.message || ''))) throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error(`TIMEOUT ${description}: ${JSON.stringify(archiveFigures(last).map(item => ({
    figureId: item?.figureId,
    panels: figureResult(item)?.panels?.length,
    error: item?.standardError
  })))}`);
}

async function clickSingleFigure(panel, figureId) {
  const card = panel.locator(`.workspace-figure-card[data-figure-id="${figureId}"]`);
  if (!await card.evaluate(element => element.open)) {
    await card.locator(':scope > summary').click();
  }
  await card.locator('.workspace-figure-analyze-action').click();
  return waitForArchive(panel, archive => {
    const figure = archiveFigures(archive).find(item => item?.figureId === figureId);
    return durablyCompleteFigure(figure, figureId);
  }, `${figureId} completed`);
}

async function openFigureCards(panel) {
  for (const figureId of Object.keys(figurePanels)) {
    const card = panel.locator(`.workspace-figure-card[data-figure-id="${figureId}"]`);
    if (!await card.evaluate(element => element.open)) await card.locator(':scope > summary').click();
  }
}

async function verifySameArticleRevisions({ paper, panel, scenario }) {
  const readDraft = () => panel.evaluate(() =>
    currentWorkspaceSnapshot?.figures?.draft || currentWorkspaceSnapshot?.figureWorkspaceDraft);
  const original = await readDraft();
  const note = 'Reviewed note survives reopening and re-extraction';
  const saved = await panel.evaluate(async value => {
    const context = captureFigureWorkspaceEditContext();
    const draft = mechanismWorkspaceDraft(currentWorkspaceSnapshot);
    return SciLLM.sendTabMessageWithRecovery(chrome, context.tabId, {
      action: 'updateFigureWorkspaceDraft',
      workspaceTarget: buildFigureWorkspaceEditTarget(context),
      mutation: { type: 'set_panel_field', figureId: 'figure-1', panelId: 'A',
        field: 'note', value, expectedRevision: draft.revision }
    });
  }, note);
  assert.equal(saved?.success, true, JSON.stringify(saved));
  check('revision: reviewed Panel note is durably seeded through the production message path',
    saved.draft.figures['figure-1'].panels.A.note.value === note);
  const savedArchive = await currentArchive(panel);
  const identities = [original.binding];
  for (const mode of ['reopen', 'reextract', 'restore']) {
    const before = await currentArchive(panel);
    const priorOperation = figureResult(archiveFigures(before).find(f => f.figureId === 'figure-1'))?.operationId;
    if (mode === 'reopen') {
      scenario.documentRevision = 1;
      await paper.reload();
      await paper.bringToFront();
      // Keep the panel's injection owner alive while the paper reloads.
      // Reloading the panel itself mid-injection would intentionally abandon
      // that context before it can release its claim.
      await setupProfile(panel, scenario);
    } else if (mode === 'reextract') {
      await paper.locator('#revision-fixture').evaluate(element => {
        element.textContent = 'Extraction revision 2: additional bounded experimental context.';
      });
      const refreshed = await panel.evaluate(async () => {
        const tab = await queryPanelTargetTab();
        const result = await sendTabMessage(tab.id, { action: 'ensureArticleWorkspace', forceRefresh: true });
        await refreshArticleWorkspace();
        switchWorkspaceView('figures');
        return result;
      });
      assert.equal(refreshed?.success, true, JSON.stringify(refreshed));
    } else {
      const restored = await panel.evaluate(async archive => {
        const tab = await queryPanelTargetTab();
        // Re-extraction prepares a new manual document in the content world.
        // Synchronize the sidebar's identity using its production summary path
        // before taking a one-use restoration authorization.
        await refreshManualAnnotationSummary(tab.id);
        return applyLoadedArticleArchive(archive);
      }, savedArchive);
      assert.equal(restored?.success, true, JSON.stringify(restored));
      check('revision restore: old-content archive commits through the production restore transaction',
        restored.committed === true && restored.partial === true);
      await panel.evaluate(() => switchWorkspaceView('figures'));
    }
    await panel.waitForFunction(() => document.querySelectorAll('.workspace-figure-card').length === 2);
    const card = panel.locator('.workspace-figure-card[data-figure-id="figure-1"]');
    if (!await card.evaluate(element => element.open)) await card.locator(':scope > summary').click();
    await card.locator('.workspace-figure-analyze-action').click();
    await waitForArchive(panel, archive => {
      const figure = archiveFigures(archive).find(f => f.figureId === 'figure-1');
      return durablyCompleteFigure(figure, 'figure-1') &&
        figureResult(figure)?.operationId !== priorOperation;
    }, `revision ${mode} fresh Figure interpretation`);
    await panel.evaluate(() => refreshArticleWorkspace());
    const draft = await readDraft();
    identities.push(draft.binding);
    check(`revision ${mode}: same owner accepts a new body fingerprint`,
      draft.binding.workspaceId === original.binding.workspaceId &&
      draft.binding.workspaceGeneration === original.binding.workspaceGeneration &&
      draft.binding.canonicalUrl === original.binding.canonicalUrl &&
      (mode === 'restore' ? draft.binding.documentHash === identities.at(-2).documentHash :
        draft.binding.documentHash !== identities.at(-2).documentHash));
    check(`revision ${mode}: fresh model result retains the reviewed note`,
      draft.figures['figure-1'].panels.A.note.value === note &&
      draft.figures['figure-1'].panels.A.note.editedAt === saved.draft.figures['figure-1'].panels.A.note.editedAt);
    check(`revision ${mode}: no binding mismatch in the visible UI`,
      !(await panel.locator('body').innerText()).includes('FIGURE_WORKSPACE_BINDING_MISMATCH'));
  }
  report.documentRefresh = { identities, notePreserved: true, modes: ['reopen', 'reextract', 'restore'] };
  const screenshot = path.join(output, 'document-refresh-completed.png');
  await panel.screenshot({ path: screenshot, fullPage: true });
  report.screenshots.push(screenshot);
}

async function runScenario(definition) {
  const scenario = {
    ...definition,
    requests: [],
    incompleteInjected: false,
    profile: fs.mkdtempSync(path.join(os.tmpdir(), `brevess-figure-${definition.name}-profile-`))
  };
  activeScenario = scenario;
  const articleUrl = `${articleOrigin}/${scenario.name}`;
  let context;
  let panel;
  try {
    context = await chromium.launchPersistentContext(scenario.profile, {
      channel: 'msedge',
      headless: true,
      viewport: { width: 1280, height: 900 },
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
    });
    activeContext = context;
    const captureConsole = (surface, source) => {
      surface.on('console', message => {
        const value = message.text();
        if (!value.startsWith('FIGURE_QA_DIAG ')) return;
        let detail = value.slice('FIGURE_QA_DIAG '.length);
        try { detail = JSON.parse(detail); } catch (_) {}
        report.diagnostics.push({ scenario: scenario.name, source, detail });
        stage(`DIAGNOSTIC ${scenario.name} ${JSON.stringify(detail)}`);
      });
      surface.on('pageerror', error => {
        const value = String(error?.stack || error?.message || error);
        if (!/FIGURE_(?:CHECKPOINT|PERSIST|CONFLICT)/u.test(value)) return;
        report.diagnostics.push({ scenario: scenario.name, source, pageError: value });
      });
    };
    context.pages().forEach(page => captureConsole(page, 'page'));
    context.on('page', page => captureConsole(page, 'page'));
    context.on('serviceworker', worker => captureConsole(worker, 'serviceworker'));
    await context.route(/^https?:\/\//u, async route => {
      const url = new URL(route.request().url());
      if (url.href === articleUrl) {
        const html = verifyDocumentRefresh ? articleFixture(scenario.name).replace('</article>',
          `<p id="revision-fixture">Extraction revision ${scenario.documentRevision || 0}: bounded article text.</p></article>`) : articleFixture(scenario.name);
        return route.fulfill({ contentType: 'text/html', body: html });
      }
      if (url.origin === articleOrigin && imageBytesByPath.has(url.pathname)) {
        return route.fulfill({
          contentType: 'image/png',
          body: imageBytesByPath.get(url.pathname)
        });
      }
      if (url.href.startsWith(`${serverUrl}/`)) return route.continue();
      return route.abort('blockedbyclient');
    });
    const paper = context.pages()[0] || await context.newPage();
    await paper.goto(articleUrl);
    await paper.waitForFunction(() => [...document.images].every(image =>
      image.complete && image.naturalWidth >= 720 && image.naturalHeight >= 420
    ));
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const extensionId = new URL(worker.url()).host;
    const tab = await worker.evaluate(async url =>
      (await chrome.tabs.query({})).find(item => item.url === url), articleUrl);
    assert.ok(tab?.id, `${scenario.name} article tab found`);
    await worker.evaluate(async activeTab => {
      const activation = await SciLLM.markTabActivated(chrome.storage.session, activeTab);
      await chrome.runtime.sendMessage({ type: 'PANEL_TAB_ACTIVATED', activation }).catch(() => {});
    }, tab);
    panel = await context.newPage();
    activePanel = panel;
    await panel.setViewportSize({ width: 480, height: 1000 });
    await panel.goto(`chrome-extension://${extensionId}/popup.html`, {
      waitUntil: 'domcontentloaded'
    });
    await paper.bringToFront();
    await panel.waitForFunction(expected =>
      document.getElementById('sidePanelPaperTitle')?.textContent === expected,
    `Figure model-input acceptance ${scenario.name}`);
    await setupProfile(panel, scenario);
    await panel.waitForFunction(() =>
      document.querySelectorAll('.workspace-figure-card').length === 2);

    await clickSingleFigure(panel, 'figure-1');
    const completed = await clickSingleFigure(panel, 'figure-2');
    const savedFigures = archiveFigures(completed);
    const first = savedFigures.find(item => item.figureId === 'figure-1');
    const second = savedFigures.find(item => item.figureId === 'figure-2');
    const firstResult = figureResult(first);
    const secondResult = figureResult(second);
    check(`${scenario.name}: both Figure results saved`,
      firstResult?.panels?.length === 26 && secondResult?.panels?.length === 5);
    check(`${scenario.name}: sequential Figure receipts remain bound`,
      firstResult.figureId === 'figure-1' && secondResult.figureId === 'figure-2' &&
      firstResult.operationId && secondResult.operationId &&
      firstResult.operationId !== secondResult.operationId);
    await openFigureCards(panel);
    const panelText = await panel.locator('#figureWorkspace').innerText();
    const expectedBasisText = scenario.vision ? '整张 Figure 图片' : '图注/正文回退';
    check(`${scenario.name}: UI shows the effective input basis`,
      panelText.includes(expectedBasisText));
    check(`${scenario.name}: completed UI has no Figure failure state`,
      !panelText.includes('FIGURE_CHECKPOINT') && !panelText.includes('解读失败') &&
      !panelText.includes('精读失败') && !panelText.includes('重试失败'));
    check(`${scenario.name}: completed archive clears pending checkpoints`,
      [first, second].every(figure => !pendingStandardCheckpoint(figure) &&
        !String(figure?.standardError || '')));
    const screenshot = path.join(output, `${scenario.name}-completed.png`);
    await panel.screenshot({ path: screenshot, fullPage: true });
    report.screenshots.push(screenshot);

    const figureRequests = scenario.requests.filter(item => item.figureId);
    if (scenario.vision) {
      const pixelAnalysisRequests = figureRequests.filter(item =>
        item.pass === 'panel_extraction' || item.pass === 'whole_figure');
      check('vision: Figure extraction requests contain real encoded pixels',
        pixelAnalysisRequests.length === 6 && pixelAnalysisRequests.every(item =>
          item.imageCount >= 1 && item.images.every(image =>
            image.mediaType === 'image/jpeg' && image.bytes > 1000)));
      const recovery = figureRequests.filter(item => item.pass === 'missing_panel_recovery');
      check('vision: incomplete Figure 2 recovers only Panel E',
        scenario.incompleteInjected === true && recovery.length === 1 &&
        JSON.stringify(recovery[0].requestedPanels) === JSON.stringify(['E']));
      check('vision: synthesis reuses extracted evidence without resending pixels',
        figureRequests.some(item => item.pass === 'figure_synthesis' &&
          item.figureId === 'figure-2' && item.imageCount === 0));
      check('vision: recovery remains visual', recovery[0]?.imageCount >= 1);
    } else {
      check('text: all Figure requests omit pixels',
        figureRequests.length === 7 && figureRequests.every(item => item.imageCount === 0));
      check('text: each request includes caption and related body context',
        figureRequests.every(item => item.hasCaption && item.hasBodyContext));
      const figure1Extraction = figureRequests.filter(item =>
        item.figureId === 'figure-1' && item.pass === 'panel_extraction');
      check('text: Figure 1 uses bounded six-Panel extraction batches plus synthesis',
        figure1Extraction.length === 5 &&
        figure1Extraction.every(item => item.expectedPanels.length <= 6) &&
        figureRequests.some(item => item.figureId === 'figure-1' &&
          item.pass === 'figure_synthesis'));
      check('text: completed results are caption-context results',
        [firstResult, secondResult].every(result =>
          result.basis === 'caption_context' && result.inputMode === 'caption_context'));
    }

    const beforeReload = {
      firstConclusion: firstResult.coreConclusion,
      secondConclusion: secondResult.coreConclusion,
      firstOperationId: firstResult.operationId,
      secondOperationId: secondResult.operationId
    };
    await panel.reload({ waitUntil: 'domcontentloaded' });
    await paper.bringToFront();
    await panel.waitForFunction(expected =>
      document.getElementById('sidePanelPaperTitle')?.textContent === expected,
    `Figure model-input acceptance ${scenario.name}`);
    await setupProfile(panel, scenario);
    await panel.waitForFunction(() =>
      document.querySelectorAll('.workspace-figure-card').length === 2);
    const reloaded = await waitForArchive(panel, archive =>
      archiveFigures(archive).filter(item => figureResult(item)?.panels?.length).length === 2,
    `${scenario.name} reload retained results`);
    const reloadedResults = Object.fromEntries(archiveFigures(reloaded).map(item => [
      item.figureId, figureResult(item)
    ]));
    const reloadedFigures = archiveFigures(reloaded);
    check(`${scenario.name}: reload preserves both saved Figure results`,
      reloadedResults['figure-1']?.coreConclusion === beforeReload.firstConclusion &&
      reloadedResults['figure-2']?.coreConclusion === beforeReload.secondConclusion &&
      reloadedResults['figure-1']?.operationId === beforeReload.firstOperationId &&
      reloadedResults['figure-2']?.operationId === beforeReload.secondOperationId);
    check(`${scenario.name}: reload retains no pending checkpoint or failure`,
      reloadedFigures.every(figure => !pendingStandardCheckpoint(figure) &&
        !String(figure?.standardError || '')));
    await openFigureCards(panel);
    check(`${scenario.name}: reloaded UI renders both conclusions`,
      (await panel.locator('#figureWorkspace').innerText()).includes(beforeReload.firstConclusion) &&
      (await panel.locator('#figureWorkspace').innerText()).includes(beforeReload.secondConclusion));
    const reloadScreenshot = path.join(output, `${scenario.name}-reloaded.png`);
    await panel.screenshot({ path: reloadScreenshot, fullPage: true });
    report.screenshots.push(reloadScreenshot);

    if (verifyDocumentRefresh) {
      await verifySameArticleRevisions({ paper, panel, scenario });
    }

    report.scenarios[scenario.name] = {
      model: scenario.model,
      capabilityExpected: scenario.vision ? 'vision' : 'caption_text_only',
      incompletePanelInjected: scenario.incompleteInjected,
      requests: scenario.requests,
      saved: {
        figure1Panels: firstResult.panels.length,
        figure2Panels: secondResult.panels.length,
        distinctOperationReceipts: firstResult.operationId !== secondResult.operationId,
        reloaded: true
      }
    };
  } catch (error) {
    report.scenarios[scenario.name] = {
      model: scenario.model,
      capabilityExpected: scenario.vision ? 'vision' : 'caption_text_only',
      incompletePanelInjected: scenario.incompleteInjected,
      requests: scenario.requests,
      failed: true,
      error: String(error?.stack || error?.message || error)
    };
    if (panel) {
      report.visibleState = await panel.locator('body').innerText().catch(() => 'unavailable');
      const failure = path.join(output, `${scenario.name}-failure.png`);
      await panel.screenshot({ path: failure, fullPage: true }).catch(() => {});
      report.screenshots.push(failure);
    }
    throw error;
  } finally {
    await context?.close();
    activeContext = null;
    activePanel = null;
    activeScenario = null;
  }
}

(async () => {
  fs.mkdirSync(output, { recursive: true });
  await startServer();
  prepareExtension();
  await runScenario({
    name: 'caption-text-only',
    model: 'deepseek-v4-flash',
    vision: false,
    injectIncomplete: false
  });
  if (!verifyDocumentRefresh) {
    await runScenario({
      name: 'vision-with-recovery',
      model: 'deepseek-v4-flash-vision-exp',
      vision: true,
      injectIncomplete: true
    });
  }
  check('all provider traffic stayed on the loopback fixture', report.realApiCalls === 0);
  report.passed = true;
})().catch(async error => {
  report.passed = false;
  report.error = String(error?.stack || error?.message || error);
  if (activePanel) {
    report.visibleState = await activePanel.locator('body').innerText().catch(() => 'unavailable');
    const failure = path.join(output, 'failure.png');
    await activePanel.screenshot({ path: failure, fullPage: true }).catch(() => {});
    report.screenshots.push(failure);
  }
  process.exitCode = 1;
}).finally(async () => {
  await activeContext?.close().catch(() => {});
  if (server) await new Promise(resolve => server.close(resolve));
  fs.writeFileSync(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  stage(JSON.stringify({
    passed: report.passed,
    checks: report.checks.length,
    scenarios: Object.keys(report.scenarios),
    realApiCalls: report.realApiCalls,
    error: report.error,
    output
  }));
});
