// Isolated real-extension acceptance for AI-generated literature-note readability.
// Provider traffic is redirected to a loopback fixture; no real API is contacted.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(process.env.SCI_EXTENSION_ROOT || path.join(__dirname, '..'));
const output = path.resolve(process.env.SCI_QA_OUTPUT_DIR ||
  path.join(root, 'output/playwright/note-readability'));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-note-readability-profile-'));
const extension = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-note-readability-extension-'));
const articleUrl = 'https://example.org/brevess-note-readability-acceptance';
const articleTitle = 'BREVESS note readability acceptance paper';
const manualValue = [
  'Reader note: preserve this hand-written background exactly.',
  'Line 2 records the unresolved biological context.',
  'Line 3 records the bounded experimental system.',
  'Line 4 records the primary reader interpretation.',
  'Line 5 remains visible without an internal scrollbar.',
  'Line 6 exercises manual-input textarea growth.'
].join('\n');
const rawNumbered = '1. Perfuse tissue; 2. Prepare cryosections; 3. Image at a 2.5 mg dose.';
const formattedNumbered = '1. Perfuse tissue;\n2. Prepare cryosections;\n3. Image at a 2.5 mg dose.';
const rawBullets = '• Signal increased • Target expression rose • Cell survival improved';
const formattedBullets = '• Signal increased\n• Target expression rose\n• Cell survival improved';
const decimalProse = 'Matched controls used a 2.5 mg dose with P=0.05; Fig. 1. and Fig. 2. were assessed.';
const singleFieldPrompt = 'Extract only the principal supported finding and keep its causal boundary explicit.';
const singleRegeneratedFinding = [
  'Single-field regeneration: signal increased in the bounded synthetic system.',
  'The article does not establish broader clinical causality.'
].join('\n');
const manualRaceValue = 'Reader edit made while single-field AI generation was still pending.';
const staleTemplateAttempt = 'AI result that must be discarded after the reader switches templates.';
const manualMetaValue = 'Reader-owned limitation: preserve this manual assessment.';
const legacyBackground = 'Legacy background: clearance depends on a bounded tissue pathway.';
const legacyInnovation = 'Legacy innovation: the study links route perturbation to functional clearance.';
const legacyLimitation = 'Legacy limitation: evidence comes from one experimental model.';
const matchedTemplateId = 'qa_meta_migration';
const report = {
  scenario: 'synthetic public article, auto-growing literature notes, legacy migration, and loopback AI fixture',
  provider: 'synthetic only',
  realApiCalls: 0,
  externalRequests: [],
  checks: [],
  requests: [],
  screenshots: [],
  sourceHashes: {}
};
let context;
let panel;
let server;
let serverUrl;
let nextSingleDelayMs = 0;

function stage(value) {
  process.stdout.write(`${value}\n`);
}

function check(name, value, details = undefined) {
  assert.ok(value, name);
  report.checks.push(details === undefined ? { name, pass: true } : { name, pass: true, details });
  stage(`PASS ${name}`);
}

function sha256(filename) {
  return crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
}

function articleFixture() {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${articleTitle}</title>
    <link rel="canonical" href="${articleUrl}">
    <meta name="citation_doi" content="10.1000/brevess-note-readability"></head>
    <body><main><article><h1>${articleTitle}</h1>
    <section><h2>Abstract</h2><p>This public synthetic paper tests structured literature notes without using private data. How a bounded tissue route controls clearance remains unresolved.</p></section>
    <section><h2>Introduction</h2><p>A tissue pathway provides the known context for clearance, but the mechanism linking route perturbation to functional recovery is unknown.</p></section>
    <section><h2>Methods</h2><p>We perfused tissue, prepared cryosections, and acquired confocal images. Matched controls used a 2.5 mg dose.</p></section>
    <section><h2>Results</h2><p>Signal increased, target expression rose, and cell survival improved. The threshold was P=0.05.</p></section>
    <section><h2>Discussion</h2><p>Figure 1 and Figure 2 summarize the bounded synthetic observations.</p></section>
    </article></main></body></html>`;
}

function messageText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map(item => typeof item === 'string' ? item : String(item?.text || '')).join('\n');
}

function paperMetaStage(body) {
  const texts = (body.messages || []).map(message => messageText(message?.content));
  const systemText = texts.find(text => text.includes('CANONICAL_EVIDENCE_DOCUMENT_V') ||
    text.includes('NORMALIZED_ATOMS_V')) || '';
  const instructionText = texts.find(text =>
    text.includes('Return atomic evidence as schema-valid JSON') ||
    text.includes('research limitations')) || '';
  if (systemText.includes('CANONICAL_EVIDENCE_DOCUMENT_V')) return 'atomic_evidence';
  if (instructionText.includes('research limitations')) return 'limitations';
  return '';
}

function canonicalRecordsFromPrompt(body) {
  const text = (body.messages || []).map(message => messageText(message?.content))
    .find(value => value.includes('CANONICAL_EVIDENCE_DOCUMENT_V')) || '';
  if (!text) return [];
  const payload = text.slice(text.indexOf('CANONICAL_EVIDENCE_DOCUMENT_V'))
    .replace(/^CANONICAL_EVIDENCE_DOCUMENT_V[^:]*:\s*/u, '')
    .split('\nThe response must satisfy this JSON schema exactly.')[0];
  return payload.split(/\}\s+\{/u).map((fragment, index, values) => {
    const line = `${index > 0 ? '{' : ''}${fragment}${index < values.length - 1 ? '}' : ''}`;
    try {
      const parsed = JSON.parse(line);
      return parsed?.paragraphId && parsed?.text ? parsed : null;
    } catch (_) {
      return null;
    }
  }).filter(Boolean);
}

function responseForRequest(body) {
  const userText = messageText(body.messages?.find(message => message?.role === 'user')?.content);
  const requestMatch = userText.match(/LITERATURE_NOTE_REQUEST:\s*\n(\{.*\})\s*$/su);
  const metaStage = paperMetaStage(body);
  let content;
  if (requestMatch) {
    const request = JSON.parse(requestMatch[1]);
    const fieldIds = request?.template?.fields?.map(field => String(field?.id || ''))
      .filter(Boolean) || [];
    assert.ok(fieldIds.length > 0, 'fixture received template fields');
    const paragraphIds = [...userText.matchAll(/^\{"paragraphId":"([^"]+)"/gmu)]
      .map(match => match[1]);
    assert.ok(paragraphIds.length > 0, 'fixture received canonical paragraph ids');
    const source = paragraphIds[0];
    const values = Object.fromEntries(fieldIds.map(id => [id, '']));
    const statuses = Object.fromEntries(fieldIds.map(id => [id, 'missing']));
    const sources = Object.fromEntries(fieldIds.map(id => [id, []]));
    const supported = {
      research_background: 'AI replacement that must not overwrite the reader note.',
      experimental_design: fieldIds.length === 1
        ? 'AI response that must not overwrite the in-flight reader edit.' : decimalProse,
      important_methods: fieldIds.length === 1 ? staleTemplateAttempt : rawNumbered,
      main_findings: fieldIds.length === 1 ? singleRegeneratedFinding : rawBullets
    };
    for (const [fieldId, value] of Object.entries(supported)) {
      if (!fieldIds.includes(fieldId)) continue;
      values[fieldId] = value;
      statuses[fieldId] = 'supported';
      sources[fieldId] = [source];
    }
    report.requests.push({
      kind: 'literature_note_autofill', path: '/chat/completions',
      stream: body.stream,
      schemaRequested: body.response_format?.type === 'json_object',
      fieldCount: fieldIds.length,
      fieldIds,
      fieldConfigs: request.template.fields,
      source,
      promptIncluded: userText.includes(singleFieldPrompt),
      promptRequestsOneItemPerLine: /one item per line/i.test(userText) &&
        /one item per line/i.test(messageText(
          body.messages?.find(message => message?.role === 'system')?.content
        ))
    });
    content = JSON.stringify({ values, statuses, sources });
  } else if (metaStage) {
    const records = canonicalRecordsFromPrompt(body);
    const intro = records.find(record => ['abstract', 'introduction', 'background']
      .includes(record.sectionKind)) || records[0];
    const result = records.find(record => ['results', 'result'].includes(record.sectionKind)) ||
      records[1] || intro;
    if (metaStage === 'atomic_evidence') {
      assert.ok(intro?.paragraphId && result?.paragraphId,
        `${metaStage} fixture received canonical evidence records`);
    }
    const sourceRef = record => ({
      paragraphId: String(record.paragraphId || ''),
      sourceIdentity: String(record.sourceIdentity || record.sourceKey || ''),
      sourceKey: String(record.sourceKey || ''),
      textHash: String(record.textHash || ''),
      quote: String(record.text || '').slice(0, 120).trim(),
      sectionPath: Array.isArray(record.sectionPath) ? record.sectionPath : []
    });
    const payload = metaStage === 'atomic_evidence' ? {
      atoms: [{
        evidenceId: 'B1', type: 'background', statement: legacyBackground,
        evidenceRole: 'context', directness: 'conceptual', origin: 'author_explicit',
        confidence: 'high', verificationStatus: 'verified', sourceRefs: [sourceRef(intro)]
      }, {
        evidenceId: 'R1', type: 'result',
        statement: 'The intervention changed the measured clearance outcome.',
        evidenceRole: 'direct_evidence', directness: 'same_system', origin: 'author_explicit',
        confidence: 'high', verificationStatus: 'verified', sourceRefs: [sourceRef(result)]
      }]
    } : {
      limitationPoints: [{
        pointId: 'L-live', text: legacyLimitation, evidenceIds: ['R1'],
        scope: 'external validity', origin: 'brevess_reconstructed', confidence: 'medium'
      }]
    };
    report.requests.push({
      kind: 'paper_meta', stage: metaStage, path: '/chat/completions',
      stream: body.stream, schemaRequested: body.response_format?.type === 'json_object',
      canonicalRecordCount: records.length
    });
    content = JSON.stringify(payload);
  } else {
    throw new Error(`QA_UNEXPECTED_PROVIDER_REQUEST:${JSON.stringify(body).slice(0, 1200)}`);
  }
  return {
    id: 'note-readability-fixture',
    model: 'deepseek-v4-flash',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 120, completion_tokens: 80 }
  };
}

function prepareExtension() {
  for (const dir of ['core', 'providers', 'vendor', 'icons', '_locales']) {
    fs.cpSync(path.join(root, dir), path.join(extension, dir), { recursive: true });
  }
  for (const file of fs.readdirSync(root)) {
    if (/\.(?:js|mjs|html|css)$/u.test(file) || file === 'manifest.json') {
      fs.copyFileSync(path.join(root, file), path.join(extension, file));
    }
  }
  for (const file of ['core/reading-tools.js', 'content.js', 'popup.js',
    'core/background-router.js', 'offscreen-network-worker.js']) {
    report.sourceHashes[file] = sha256(path.join(extension, file));
  }
  const contentFile = path.join(extension, 'content.js');
  const contentSource = fs.readFileSync(contentFile, 'utf8');
  const hookMarker = "console.log('Brevess 已加载');";
  const hookIndex = contentSource.lastIndexOf(hookMarker);
  assert.ok(hookIndex >= 0, 'temporary content hook insertion point exists');
  const qaWorkspaceHook = `
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request?.action !== 'qaSeedLegacyPaperMeta') return undefined;
  Promise.resolve().then(async () => {
    const fixture = request.fixture || {};
    await seedIndependentPaperMeta('research_logic', fixture.researchLogic || {});
    await seedIndependentPaperMeta('innovation', {
      innovationPoints: fixture.innovationPoints || []
    });
    await seedIndependentPaperMeta('limitations', {
      limitationPoints: fixture.limitationPoints || []
    });
    scheduleCurrentArticleArchiveSave();
    scheduleArticleWorkspaceArtifactsSave({ immediate: true });
    const snapshot = getCanonicalArticleSnapshot();
    const draft = figureWorkspaceDraftController?.getDraft?.() || figureWorkspaceDraft;
    return {
      success: true,
      documentHash: String(snapshot?.documentHash || ''),
      draft: JSON.parse(JSON.stringify(draft || null))
    };
  }).then(sendResponse).catch(error => sendResponse({
    success: false, error: String(error?.message || error), code: String(error?.code || '')
  }));
  return true;
});
`;
  fs.writeFileSync(contentFile,
    contentSource.slice(0, hookIndex) + qaWorkspaceHook + contentSource.slice(hookIndex));
  const networkFile = path.join(extension, 'offscreen-network-worker.js');
  const boundary = `const qaNativeFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (url, options) => {
  const parsed = new URL(String(url));
  if (parsed.origin !== 'https://api.deepseek.com' || parsed.pathname !== '/chat/completions') {
    throw new Error('QA_BLOCKED_REMOTE_FETCH');
  }
  return qaNativeFetch(${JSON.stringify(serverUrl)} + parsed.pathname, options);
};\n`;
  fs.writeFileSync(networkFile, boundary + fs.readFileSync(networkFile, 'utf8'));
  report.testInjection =
    'Temporary offscreen worker redirected DeepSeek chat to loopback; temporary content hook invokes the production paper-meta seed/controller path';
}

async function configureSyntheticProfile() {
  await panel.evaluate(async () => {
    const messages = [
      {
        type: 'LLM_SAVE_PROFILE',
        profile: {
          id: 'profile_note_readability_qa',
          name: 'QA note readability fixture',
          providerId: 'deepseek',
          config: {
            apiKey: 'fixture-not-a-real-key',
            model: 'deepseek-v4-flash',
            maxOutputTokens: 4096,
            reasoningEnabled: false
          }
        }
      },
      {
        type: 'LLM_UPDATE_PROFILE_ROUTING',
        globalProfileId: 'profile_note_readability_qa',
        taskRoutes: {
          literature_note_autofill: 'profile_note_readability_qa',
          paper_limitations: 'profile_note_readability_qa'
        }
      },
      { type: 'LLM_UPDATE_PREFERENCES', preferences: { mode: 'llm', consentGranted: true } }
    ];
    for (const message of messages) {
      const response = await chrome.runtime.sendMessage(message);
      if (!response?.success) throw new Error(`QA_PROFILE_SETUP_FAILED:${JSON.stringify(response?.error)}`);
    }
    await loadLlmSettings();
    await refreshArticleWorkspace();
  });
}

async function configureQaTemplates() {
  return panel.evaluate(async ({ matchedTemplateId, singleFieldPrompt }) => {
    const state = await chrome.runtime.sendMessage({ type: 'LLM_GET_SETTINGS' });
    if (!state?.success) throw new Error('QA_SETTINGS_READ_FAILED');
    const templates = Array.isArray(state.data?.settings?.literatureNoteTemplates)
      ? state.data.settings.literatureNoteTemplates : [];
    const promptedTemplates = templates.map(template => template.id !== 'basic_research'
      ? template
      : {
          ...template,
          fields: template.fields.map(field => field.id !== 'main_findings'
            ? field : { ...field, prompt: singleFieldPrompt })
        });
    const matched = {
      id: matchedTemplateId,
      name: 'QA paper meta migration',
      studyFamily: 'basic_research',
      fields: [
        { id: 'research_background', label: '研究背景', multiline: true },
        { id: 'scientific_questions', label: '科学问题与逻辑子问题', multiline: true },
        { id: 'innovations', label: '研究创新点', multiline: true },
        { id: 'limitations', label: '研究局限性', multiline: true }
      ]
    };
    const response = await chrome.runtime.sendMessage({
      type: 'LLM_UPDATE_PREFERENCES',
      preferences: {
        literatureNoteTemplates: [
          ...promptedTemplates.filter(item => item.id !== matchedTemplateId),
          matched
        ]
      }
    });
    if (!response?.success) {
      throw new Error(`QA_TEMPLATE_SETUP_FAILED:${JSON.stringify(response?.error)}`);
    }
    await loadLlmSettings();
    return {
      matchedFields: literatureNoteTemplates().find(item => item.id === matchedTemplateId)
        ?.fields?.map(field => field.id) || []
    };
  }, { matchedTemplateId, singleFieldPrompt });
}

function legacyPaperMetaFixture() {
  const sourceRef = {
    paragraphId: 'legacy-introduction-p1', sourceIdentity: 'Introduction paragraph 1',
    sourceKey: 'introduction:p1', textHash: 'legacy-text-hash',
    quote: 'A tissue pathway provides the known context for clearance.',
    sectionPath: ['Introduction'], citationRefs: ['Ref-1']
  };
  const evidenceIds = ['B1', 'X1', 'G1', 'R1'];
  const progression = Array.from({ length: 4 }, (_, index) => {
    const number = index + 1;
    return {
      questionId: `Q${number}`,
      text: `Legacy subquestion ${number}: which experiment resolves step ${number}?`,
      generatedFrom: [number === 1 ? 'Q0' : `Q${number - 1}`],
      hypothesis: `Hypothesis ${number}`,
      test: `Test ${number}`,
      result: `Result ${number}`,
      warrantedConclusion: `Bounded conclusion ${number}`,
      remainingGap: `Remaining limitation ${number}`,
      causalLevel: 'association', evidenceIds: ['R1'],
      origin: 'brevess_reconstructed', confidence: 'medium'
    };
  });
  return {
    researchLogic: {
      version: 'legacy-qa-v1', partial: false,
      atomicEvidence: [{
        evidenceId: 'B1', type: 'background', statement: legacyBackground,
        origin: 'author_explicit', verificationStatus: 'verified', sourceRefs: [sourceRef]
      }, {
        evidenceId: 'X1', type: 'knowledge_gap',
        statement: 'Legacy gap: the controlling route is unresolved.',
        origin: 'author_explicit', verificationStatus: 'verified', sourceRefs: [sourceRef]
      }, {
        evidenceId: 'G1', type: 'rationale',
        statement: 'Legacy rationale: perturb the route and measure clearance.',
        origin: 'brevess_reconstructed', verificationStatus: 'verified', sourceRefs: [sourceRef]
      }, {
        evidenceId: 'R1', type: 'result',
        statement: 'Legacy result: route perturbation changed clearance.',
        origin: 'author_explicit', verificationStatus: 'verified', sourceRefs: [sourceRef]
      }],
      questionTrace: {
        coreQuestion: {
          questionId: 'Q0', text: 'Legacy Q0: what controls tissue clearance?',
          evidenceIds, origin: 'brevess_reconstructed', confidence: 'high',
          remainingGap: 'Legacy core limitation: alternative routes remain unresolved.'
        },
        bridge: [{
          traceId: 'T1', type: 'B', evidenceIds: ['B1'],
          statement: 'Known clearance context', relation: 'establishes context',
          origin: 'author_explicit'
        }]
      },
      progression,
      audit: {
        validCoreQuestion: true,
        acceptedProgressionIds: progression.map(item => item.questionId),
        issues: [], audited: true, evidenceCoverage: 4
      }
    },
    innovationPoints: [{
      pointId: 'I-legacy', text: legacyInnovation, evidenceIds: ['G1', 'R1'],
      noveltyType: 'mechanism_to_function', scope: 'Validated in one model.',
      origin: 'brevess_reconstructed', confidence: 'medium'
    }],
    limitationPoints: [{
      pointId: 'L-legacy', text: legacyLimitation, evidenceIds: ['R1'],
      scope: 'No human cohort.', origin: 'brevess_reconstructed', confidence: 'medium'
    }]
  };
}

async function seedLegacyPaperMeta(worker, tab) {
  return worker.evaluate(async ({ tabId, fixture }) => {
    return chrome.tabs.sendMessage(tabId, { action: 'qaSeedLegacyPaperMeta', fixture });
  }, { tabId: tab.id, fixture: legacyPaperMetaFixture() });
}

async function openDrawer() {
  const button = panel.locator('#openLiteratureNote');
  await button.waitFor({ state: 'visible', timeout: 30000 });
  if (await panel.locator('#literatureNoteDrawer').isHidden()) await button.click();
  await panel.locator('#literatureNoteDrawer').waitFor({ state: 'visible', timeout: 10000 });
  await panel.locator('#literatureNoteTemplateSelect').selectOption('basic_research');
  await panel.locator('[data-literature-note-field="important_methods"]')
    .waitFor({ state: 'visible', timeout: 10000 });
}

function field(fieldId) {
  return panel.locator(`[data-literature-note-field="${fieldId}"]`);
}

async function selectTemplate(templateId, fieldId) {
  await panel.locator('#literatureNoteTemplateSelect').selectOption(templateId);
  await field(fieldId).waitFor({ state: 'visible', timeout: 10000 });
}

async function fieldStatus(fieldId) {
  const wrapper = field(fieldId).locator('xpath=..');
  const status = wrapper.locator('.literature-note-field-status');
  return { className: await status.getAttribute('class'), text: await status.textContent() };
}

async function textareaGeometry(fieldId) {
  return field(fieldId).evaluate(textarea => {
    const style = getComputedStyle(textarea);
    return {
      fieldId: textarea.dataset.literatureNoteField,
      scrollHeight: textarea.scrollHeight,
      clientHeight: textarea.clientHeight,
      height: style.height,
      overflowY: style.overflowY,
      resize: style.resize,
      lines: textarea.value.split('\n').length
    };
  });
}

async function checkExpanded(name, fieldIds) {
  const geometries = [];
  for (const fieldId of fieldIds) geometries.push(await textareaGeometry(fieldId));
  stage(`GEOMETRY ${name}: ${JSON.stringify(geometries)}`);
  check(name, geometries.every(item =>
    item.scrollHeight <= item.clientHeight + 2 &&
    item.overflowY === 'hidden' && item.resize === 'none'), geometries);
  return geometries;
}

async function waitForExpanded(fieldIds) {
  await panel.waitForFunction(ids => ids.every(fieldId => {
    const textarea = document.querySelector(
      `[data-literature-note-field="${CSS.escape(fieldId)}"]`
    );
    return textarea && textarea.scrollHeight <= textarea.clientHeight + 2;
  }), fieldIds, { timeout: 5000 });
}

async function capture(name, locator) {
  const filename = path.join(output, name);
  await locator.scrollIntoViewIfNeeded();
  await locator.screenshot({ path: filename });
  const record = { filename: name, bytes: fs.statSync(filename).size, sha256: sha256(filename) };
  report.screenshots.push(record);
  return record;
}

async function waitForAutofill() {
  await panel.waitForFunction(expected => {
    const methods = document.querySelector('[data-literature-note-field="important_methods"]');
    const button = document.getElementById('autofillLiteratureNote');
    return methods?.value === expected && button && !button.disabled;
  }, formattedNumbered, { timeout: 30000 });
}

async function waitForLiteratureRequestCount(expected, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const count = report.requests.filter(item =>
      item.kind === 'literature_note_autofill').length;
    if (count >= expected) return count;
    await panel.waitForTimeout(25);
  }
  throw new Error(`Timed out waiting for literature-note request ${expected}`);
}

(async () => {
  fs.mkdirSync(output, { recursive: true });
  fs.rmSync(path.join(output, 'failure.png'), { force: true });
  server = http.createServer(async (request, reply) => {
    reply.setHeader('Access-Control-Allow-Origin', '*');
    reply.setHeader('Access-Control-Allow-Headers', '*');
    if (request.method === 'OPTIONS') {
      reply.writeHead(204);
      reply.end();
      return;
    }
    let raw = '';
    for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw);
    assert.equal(request.url, '/chat/completions');
    assert.equal(request.method, 'POST');
    const fixture = responseForRequest(body);
    const latestRequest = report.requests.at(-1);
    if (latestRequest?.kind === 'literature_note_autofill' &&
        latestRequest.fieldCount === 1 && nextSingleDelayMs > 0) {
      const delayMs = nextSingleDelayMs;
      nextSingleDelayMs = 0;
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
    reply.setHeader('Content-Type', 'application/json');
    reply.end(JSON.stringify(fixture));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  serverUrl = `http://127.0.0.1:${server.address().port}`;
  prepareExtension();

  context = await chromium.launchPersistentContext(profile, {
    channel: 'msedge',
    headless: true,
    viewport: { width: 1280, height: 900 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  });
  await context.route(/^https?:\/\//u, async route => {
    const url = route.request().url();
    if (url === articleUrl) {
      return route.fulfill({ contentType: 'text/html; charset=utf-8', body: articleFixture() });
    }
    if (url.startsWith(`${serverUrl}/`)) return route.continue();
    report.externalRequests.push(url);
    return route.abort('blockedbyclient');
  });
  const paper = context.pages()[0] || await context.newPage();
  await paper.goto(articleUrl, { waitUntil: 'domcontentloaded' });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;
  const tab = await worker.evaluate(async url =>
    (await chrome.tabs.query({})).find(item => item.url === url), articleUrl);
  assert.ok(tab?.id, 'synthetic article tab found');
  await worker.evaluate(async activeTab => {
    const activation = await SciLLM.markTabActivated(chrome.storage.session, activeTab);
    await chrome.runtime.sendMessage({ type: 'PANEL_TAB_ACTIVATED', activation }).catch(() => {});
  }, tab);

  panel = await context.newPage();
  await panel.setViewportSize({ width: 520, height: 1000 });
  await panel.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'domcontentloaded' });
  await paper.bringToFront();
  await panel.waitForFunction(expected =>
    document.getElementById('sidePanelPaperTitle')?.textContent === expected, articleTitle);
  await configureSyntheticProfile();
  const qaTemplates = await configureQaTemplates();
  await openDrawer();

  await field('research_background').fill(manualValue); // Real input event updates note state.
  await checkExpanded('manual input expands immediately to its complete value',
    ['research_background']);
  await capture('00-manual-before-autofill.png',
    field('research_background').locator('xpath=..'));
  await panel.locator('#autofillLiteratureNote').click();
  await waitForAutofill();

  const values = {
    manual: await field('research_background').inputValue(),
    numbered: await field('important_methods').inputValue(),
    bullets: await field('main_findings').inputValue(),
    decimal: await field('experimental_design').inputValue()
  };
  const autofillRequests = report.requests.filter(item => item.kind === 'literature_note_autofill');
  check('actual AI autofill button produced one local provider request', autofillRequests.length === 1,
    autofillRequests[0]);
  check('autofill prompt requests one item per line',
    autofillRequests[0]?.promptRequestsOneItemPerLine === true);
  check('inline numbered methods render on three lines', values.numbered === formattedNumbered,
    values.numbered);
  check('inline bullet findings render on three lines', values.bullets === formattedBullets,
    values.bullets);
  check('decimal, P value and figure references remain one prose line',
    values.decimal === decimalProse && !values.decimal.includes('\n'), values.decimal);
  check('pre-existing reader note is not overwritten', values.manual === manualValue, values.manual);
  const initialGeometry = await checkExpanded(
    'AI-filled and reader-owned textareas show all content without internal scrolling',
    ['research_background', 'important_methods', 'main_findings', 'experimental_design']);

  const methodStatus = await fieldStatus('important_methods');
  const findingStatus = await fieldStatus('main_findings');
  const manualStatus = await fieldStatus('research_background');
  check('statuses contract reaches the popup as supported field state',
    methodStatus.className?.includes('is-supported') &&
      findingStatus.className?.includes('is-supported'), { methodStatus, findingStatus });
  check('preserved manual field remains reader-owned rather than AI-supported',
    manualStatus.className?.includes('is-idle'), manualStatus);

  await capture('01-numbered-methods.png', field('important_methods').locator('xpath=..'));
  await capture('02-bulleted-findings.png', field('main_findings').locator('xpath=..'));
  await capture('03-decimal-prose.png', field('experimental_design').locator('xpath=..'));

  const fieldCount = await panel.locator('[data-literature-note-field]').count();
  const generateButtonCount = await panel.locator(
    '[data-generate-literature-note-field]'
  ).count();
  check('every literature-note field has its own AI generate button',
    generateButtonCount === fieldCount && fieldCount > 0,
    { fieldCount, generateButtonCount });

  const beforeSingle = {
    background: await field('research_background').inputValue(),
    design: await field('experimental_design').inputValue(),
    methods: await field('important_methods').inputValue()
  };
  await panel.locator(
    '[data-generate-literature-note-field="main_findings"]'
  ).click();
  await panel.waitForFunction(expected => {
    const input = document.querySelector('[data-literature-note-field="main_findings"]');
    const button = document.querySelector(
      '[data-generate-literature-note-field="main_findings"]'
    );
    return input?.value === expected && button && !button.disabled;
  }, singleRegeneratedFinding, { timeout: 30000 });
  const singleRequest = report.requests.filter(item =>
    item.kind === 'literature_note_autofill').at(-1);
  check('single-field button requests only its stable target and carries its prompt',
    singleRequest?.fieldIds?.length === 1 &&
      singleRequest.fieldIds[0] === 'main_findings' &&
      singleRequest.fieldConfigs?.[0]?.prompt === singleFieldPrompt &&
      singleRequest.promptIncluded === true,
    singleRequest);
  check('single-field regeneration replaces the existing target only',
    await field('main_findings').inputValue() === singleRegeneratedFinding &&
      await field('research_background').inputValue() === beforeSingle.background &&
      await field('experimental_design').inputValue() === beforeSingle.design &&
      await field('important_methods').inputValue() === beforeSingle.methods,
    beforeSingle);
  await checkExpanded('single-field result autosizes immediately', ['main_findings']);

  nextSingleDelayMs = 800;
  await panel.locator(
    '[data-generate-literature-note-field="experimental_design"]'
  ).click();
  await waitForLiteratureRequestCount(3);
  await field('experimental_design').fill(manualRaceValue);
  await panel.waitForFunction(() => {
    const button = document.querySelector(
      '[data-generate-literature-note-field="experimental_design"]'
    );
    return button && !button.disabled;
  }, undefined, { timeout: 30000 });
  check('reader edit made during a single-field request is never overwritten',
    await field('experimental_design').inputValue() === manualRaceValue,
    await field('experimental_design').inputValue());

  nextSingleDelayMs = 800;
  await panel.locator(
    '[data-generate-literature-note-field="important_methods"]'
  ).click();
  await waitForLiteratureRequestCount(4);
  await selectTemplate('methods_resource', 'limitations');
  await panel.waitForFunction(() => {
    const button = document.getElementById('autofillLiteratureNote');
    return button && !button.disabled;
  }, undefined, { timeout: 30000 });
  await selectTemplate('basic_research', 'main_findings');
  check('template switch during generation discards the stale field result',
    await field('important_methods').inputValue() === formattedNumbered,
    await field('important_methods').inputValue());
  await panel.waitForTimeout(600);
  const requestsBeforeReload = report.requests.filter(item =>
    item.kind === 'literature_note_autofill').length;

  await panel.reload({ waitUntil: 'domcontentloaded' });
  await paper.bringToFront();
  await panel.waitForFunction(expected =>
    document.getElementById('sidePanelPaperTitle')?.textContent === expected, articleTitle);
  await configureSyntheticProfile();
  await openDrawer();
  const reloaded = {
    manual: await field('research_background').inputValue(),
    numbered: await field('important_methods').inputValue(),
    bullets: await field('main_findings').inputValue(),
    decimal: await field('experimental_design').inputValue()
  };
  check('panel reload preserves AI list line breaks and reader content',
    reloaded.manual === manualValue && reloaded.numbered === formattedNumbered &&
      reloaded.bullets === singleRegeneratedFinding &&
      reloaded.decimal === manualRaceValue, reloaded);
  check('reload performs no additional provider request',
    report.requests.filter(item => item.kind === 'literature_note_autofill').length ===
      requestsBeforeReload);
  const reloadedStatus = await fieldStatus('important_methods');
  check('supported status survives persistence and reload',
    reloadedStatus.className?.includes('is-supported'), reloadedStatus);
  const reloadGeometry = await checkExpanded(
    'panel reload remeasures persisted reader and AI content',
    ['research_background', 'important_methods', 'main_findings', 'experimental_design']);
  await capture('04-after-reload-numbered.png', field('important_methods').locator('xpath=..'));

  check('compatible QA template is installed through settings',
    qaTemplates.matchedFields.join(',') ===
      'research_background,scientific_questions,innovations,limitations', qaTemplates);
  await selectTemplate('methods_resource', 'limitations');
  await field('limitations').fill(manualMetaValue);
  await panel.waitForTimeout(500);
  check('manual compatible field is present before meta migration',
    await field('limitations').inputValue() === manualMetaValue);
  await panel.locator('#closeLiteratureNote').click();
  await panel.locator('#literatureNoteDrawer').waitFor({ state: 'hidden' });

  const seeded = await seedLegacyPaperMeta(worker, tab);
  check('legacy meta was seeded through production workspace draft mutations',
    seeded?.success === true && Boolean(seeded.documentHash) &&
      seeded.draft?.meta?.researchLogic?.questionTrace?.coreQuestion?.questionId === 'Q0' &&
      seeded.draft?.meta?.researchLogic?.progression?.length === 4 &&
      seeded.draft?.meta?.paperMetaDetails?.innovationPoints?.length === 1 &&
      seeded.draft?.meta?.paperMetaDetails?.limitationPoints?.length === 1,
    {
      documentHash: seeded?.documentHash,
      draftRevision: seeded?.draft?.revision,
      progressionCount: seeded?.draft?.meta?.researchLogic?.progression?.length,
      innovationDetails: seeded?.draft?.meta?.paperMetaDetails?.innovationPoints?.length,
      limitationDetails: seeded?.draft?.meta?.paperMetaDetails?.limitationPoints?.length
    });
  await panel.evaluate(async () => refreshArticleWorkspace());
  await openDrawer();

  const removedPaperMetaUi = await panel.evaluate(() => ({
    section: document.getElementById('literatureNotePaperMeta'),
    actions: document.getElementById('literatureNotePaperMetaActions'),
    results: document.getElementById('literatureNotePaperMetaResults'),
    taskButtons: document.querySelectorAll('[data-paper-meta-task]').length
  }));
  check('extra paper-meta section, cards, and extraction buttons are absent from the DOM',
    !removedPaperMetaUi.section && !removedPaperMetaUi.actions &&
      !removedPaperMetaUi.results && removedPaperMetaUi.taskButtons === 0,
    { taskButtons: removedPaperMetaUi.taskButtons });

  check('original basic-template manual background remains reader-owned during migration',
    await field('research_background').inputValue() === manualValue,
    await field('research_background').inputValue());
  await selectTemplate(matchedTemplateId, 'research_background');
  const migrated = {
    background: await field('research_background').inputValue(),
    questions: await field('scientific_questions').inputValue(),
    innovations: await field('innovations').inputValue(),
    limitations: await field('limitations').inputValue()
  };
  check('legacy paper meta migrates into all four blank compatible note fields',
    migrated.background.includes(legacyBackground) &&
      migrated.questions.includes('Legacy Q0') &&
      migrated.innovations.includes(legacyInnovation) &&
      migrated.limitations.includes(legacyLimitation), migrated);
  check('migrated questions preserve Q0 and Q1-Q4 hierarchy',
    ['Q0', 'Q1', 'Q2', 'Q3', 'Q4'].every(id =>
      migrated.questions.includes(`- ${id}：`)), migrated.questions);
  check('migrated fields preserve body-source tags and limitation markers',
    migrated.background.includes('[正文证据来源：') &&
      migrated.questions.includes('[正文证据来源：') &&
      migrated.questions.includes('  - 局限：Remaining limitation 1') &&
      migrated.innovations.includes('[局限：Validated in one model.]') &&
      migrated.limitations.includes('[局限：No human cohort.]'), migrated);
  const migratedGeometry = await checkExpanded(
    'template switch expands all migrated background, question, innovation, and limitation fields',
    ['research_background', 'scientific_questions', 'innovations', 'limitations']);
  await capture('05-migrated-background-questions.png',
    panel.locator('#literatureNoteFields'));

  await panel.setViewportSize({ width: 340, height: 1000 });
  await waitForExpanded(
    ['research_background', 'scientific_questions', 'innovations', 'limitations']);
  const narrowGeometry = await checkExpanded(
    'narrow panel width reflows and remeasures every migrated textarea',
    ['research_background', 'scientific_questions', 'innovations', 'limitations']);
  await capture('06-narrow-width-migrated-questions.png',
    field('scientific_questions').locator('xpath=..'));
  await panel.setViewportSize({ width: 520, height: 1000 });
  await panel.waitForTimeout(150);

  await selectTemplate('methods_resource', 'limitations');
  check('paper-meta migration preserves an existing manual compatible value',
    await field('limitations').inputValue() === manualMetaValue,
    await field('limitations').inputValue());

  await selectTemplate(matchedTemplateId, 'research_background');
  await panel.waitForTimeout(500);
  await panel.locator('#closeLiteratureNote').click();
  await panel.locator('#literatureNoteDrawer').waitFor({ state: 'hidden' });
  await panel.locator('#openLiteratureNote').click();
  await panel.locator('#literatureNoteDrawer').waitFor({ state: 'visible' });
  await field('scientific_questions').waitFor({ state: 'visible', timeout: 10000 });
  const reopenedQuestions = await field('scientific_questions').inputValue();
  check('closing and reopening the note preserves the selected template and migrated content',
    await panel.locator('#literatureNoteTemplateSelect').inputValue() === matchedTemplateId &&
      reopenedQuestions === migrated.questions, reopenedQuestions);
  const reopenGeometry = await checkExpanded(
    'reopening the note remeasures every migrated textarea',
    ['research_background', 'scientific_questions', 'innovations', 'limitations']);
  await capture('07-reopened-migrated-questions.png',
    field('scientific_questions').locator('xpath=..'));

  await panel.waitForTimeout(500);
  await panel.reload({ waitUntil: 'domcontentloaded' });
  await paper.bringToFront();
  await panel.waitForFunction(expected =>
    document.getElementById('sidePanelPaperTitle')?.textContent === expected, articleTitle);
  await configureSyntheticProfile();
  await openDrawer();
  check('panel reload still preserves the original basic-template manual background',
    await field('research_background').inputValue() === manualValue,
    await field('research_background').inputValue());
  await selectTemplate(matchedTemplateId, 'research_background');
  const migrationReload = {
    background: await field('research_background').inputValue(),
    questions: await field('scientific_questions').inputValue(),
    innovations: await field('innovations').inputValue(),
    limitations: await field('limitations').inputValue()
  };
  await selectTemplate('methods_resource', 'limitations');
  const manualMetaReload = await field('limitations').inputValue();
  check('save and panel reload retain migrated values, hierarchy, sources, and manual value',
    migrationReload.background === migrated.background &&
      migrationReload.questions === migrated.questions &&
      migrationReload.innovations === migrated.innovations &&
      migrationReload.limitations === migrated.limitations &&
      migrationReload.questions.includes('Q4') &&
      migrationReload.background.includes('[正文证据来源：') &&
      manualMetaReload === manualMetaValue,
    { migrationReload, manualMetaReload });
  await selectTemplate(matchedTemplateId, 'research_background');
  const migrationReloadGeometry = await checkExpanded(
    'reload and template restoration remeasure all persisted migrated fields',
    ['research_background', 'scientific_questions', 'innovations', 'limitations']);
  check('removed paper-meta UI cannot trigger provider traffic',
    report.requests.filter(item => item.kind === 'paper_meta').length === 0,
    report.requests);
  check('isolated MV3 run attempted no external network request',
    report.externalRequests.length === 0, report.externalRequests);
  await capture('08-after-reload-migrated-questions.png',
    field('scientific_questions').locator('xpath=..'));

  report.finalValues = reloaded;
  report.geometry = {
    initial: initialGeometry,
    reload: reloadGeometry,
    migrated: migratedGeometry,
    narrow: narrowGeometry,
    reopen: reopenGeometry,
    migrationReload: migrationReloadGeometry
  };
  report.paperMeta = {
    seededDocumentHash: seeded.documentHash,
    migrated,
    manualMetaValue,
    extraUiPresent: false
  };
  report.passed = true;
})().catch(async error => {
  report.passed = false;
  report.error = { message: error.message, stack: error.stack };
  if (panel) {
    report.visibleState = await panel.locator('body').innerText().catch(() => 'unavailable');
    await panel.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
  }
  process.exitCode = 1;
}).finally(async () => {
  await context?.close().catch(() => undefined);
  if (server) await new Promise(resolve => server.close(resolve));
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  stage(JSON.stringify({
    passed: report.passed,
    checks: report.checks.length,
    requests: report.requests.length,
    screenshots: report.screenshots.length,
    error: report.error?.message,
    output
  }));
});
