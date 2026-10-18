const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { chromium } = require('playwright');

const root = process.env.SCI_EXTENSION_ROOT
  ? path.resolve(process.env.SCI_EXTENSION_ROOT)
  : path.resolve(__dirname, '..');
const outputDir = process.env.SCI_QA_OUTPUT_DIR
  ? path.resolve(process.env.SCI_QA_OUTPUT_DIR)
  : path.join(root, 'output', 'playwright');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sci-side-panel-edge-'));
const extensionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sci-side-panel-extension-'));
let activeContext = null;
let providerServer = null;
let analysisProviderServer = null;
let releaseProviderResponse = null;
const qaStartedAt = Date.now();

function reportQaStage(stage) {
  const elapsedSeconds = ((Date.now() - qaStartedAt) / 1000).toFixed(1);
  process.stderr.write(`[edge-qa +${elapsedSeconds}s] ${stage}\n`);
}

function prepareQaExtension() {
  for (const directory of ['core', 'providers', 'vendor', 'icons', '_locales']) {
    fs.cpSync(path.join(root, directory), path.join(extensionDir, directory), {
      recursive: true
    });
  }
  for (const filename of [
    'background.js', 'content.js', 'content.css', 'popup.html', 'popup.js', 'popup.css',
    'action-popup.html', 'action-popup.js', 'action-popup.css',
    'logic-map.html', 'logic-map.js', 'logic-map.css',
    'pdf-reader.html', 'pdf-reader.js', 'pdf-reader.css', 'pdf-native-reader.mjs',
    'offline-reader.html', 'offline-reader.js', 'offline-reader.css',
    'options.html', 'options.js', 'options.css', 'offscreen.html', 'offscreen.js',
    'offscreen-network-worker.js'
  ]) {
    fs.copyFileSync(path.join(root, filename), path.join(extensionDir, filename));
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  fs.writeFileSync(
    path.join(extensionDir, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8'
  );
}

function articleFixture() {
  return `<!doctype html><html><head>
    <title>OA mechanism review test</title>
    <link rel="canonical" href="https://example.org/oa-mechanism-review">
    <meta name="citation_doi" content="10.1000/oa-review-test">
  </head><body><main><article>
    <h1>OA mechanism review test</h1>
    <section><h2>Abstract</h2><p>The precise mechanism remains unclear. This study aimed to summarize a defined molecular pathway and its translational implications across experimental systems.</p></section>
    <section><h2>Introduction</h2><p>It is well established that metabolic signaling regulates immune adaptation through coordinated transcriptional and epigenetic programs in disease.</p></section>
    <section><h2>Mechanisms</h2><h3>Signal integration</h3><p>We performed a matched-control experiment. We found that activation of kinase A increased transcription factor B, which directly induced target C and promoted cellular survival.</p><p>Genetic inhibition of kinase A abolished target C induction, supporting a necessary mechanistic relationship.</p></section>
    <section><h2>Limitations</h2><p>One major limitation of this study is that available evidence used small preclinical cohorts and requires validation in independent human samples.</p></section>
    <section><h2>Conclusions</h2><p>In conclusion, our findings support a testable pathway while leaving its clinical generalizability unresolved.</p></section>
    <figure id="figure-1"><figcaption><strong>Figure 1.</strong> (A) The observed phenotype is established in matched controls. (B) The responding population expands. (C) Cell viability increases.</figcaption></figure>
    <figure id="figure-2"><figcaption><strong>Figure 2.</strong> (A) RNA sequencing identifies receptor signaling. (B) qPCR validates the target response.</figcaption></figure>
    <figure id="figure-3"><figcaption><strong>Figure 3.</strong> (A) Tissue validation reproduces the functional outcome.</figcaption></figure>
  </article></main></body></html>`;
}

function figureWorkspaceFixture() {
  const panel = (label, method, observation) => ({
    panel: label,
    role: 'phenotype',
    phenotypeName: `${label} panel phenotype`,
    methodCategory: 'wet_lab',
    methods: [method],
    methodSource: 'caption',
    purpose: `Test the ${label} step in the evidence chain.`,
    design: 'Treatment versus matched control.',
    comparison: 'Treated group compared with control.',
    directObservation: observation,
    observationSource: 'caption_statement',
    localInference: 'The observation supports this local step only.',
    contribution: `Panel ${label} advances the Figure argument.`,
    inputBasis: {
      inputMode: 'caption_context', imageWidth: 0, imageHeight: 0,
      pixelsSupplied: false, attempts: 1
    }
  });
  const makeFigure = (number, panels) => ({
    figureId: `figure-${number}`,
    figureLabel: `Figure ${number}`,
    hasImage: false,
    caption: `Figure ${number} A bounded pathway evidence step 图 ${number} 有边界的通路证据步骤 (A) Experimental design.`,
    isSupplemental: false,
    panelHints: panels.map(item => item.panel),
    activeDepth: 'standard',
    standard: {
      analysisDepth: 'standard',
      basis: 'caption_context',
      figureTitleZh: '有边界的通路证据步骤',
      figureQuestion: `What does Figure ${number} establish?`,
      coreConclusion: `Figure ${number} establishes one bounded evidence step.`,
      claimBoundary: 'Only caption and supplied body context were available.',
      authorAssembly: 'Panels progress from design to observation and interpretation.',
      panels,
      panelCoverage: {
        expectedPanels: panels.map(item => item.panel),
        returnedPanels: panels.map(item => item.panel),
        missingPanels: []
      },
      argumentChain: panels.map(item => ({
        panels: [item.panel], established: item.directObservation,
        handoff: 'Motivates the next Panel.', evidenceLevel: 'association'
      })),
      panelGroups: [], logicBridges: []
    },
    standardError: '', deep: null, deepLoading: false, deepError: '',
    panelFollowups: {}, panelFollowupLoading: {}, panelFollowupErrors: {}, expanded: false
  });
  return {
    status: { running: false, paused: false, phase: 'completed', figureProgress: [] },
    figures: [
      makeFigure(1, [panel('A', 'Western blot', 'Signal increased after treatment.'),
        panel('B', 'Flow cytometry', 'The responding population expanded.'),
        panel('C', 'CCK-8', 'Cell viability increased.')]),
      makeFigure(2, [panel('A', 'RNA-seq', 'A pathway signature was enriched.'),
        panel('B', 'qPCR', 'Target expression increased.')]),
      makeFigure(3, [panel('A', 'IHC', 'The phenotype was reproduced in tissue.')])
    ],
    totalFigures: 3,
    failedFigures: 0,
    supplemental: {
      materials: [{
        materialId: 'qa-supplement',
        title: 'Supplemental information · Figures S1–S2',
        url: 'https://example.org/qa-supplement.pdf',
        kind: 'pdf'
      }],
      references: [
        { kind: 'supplemental-figure', label: 'Figure S1', shortLabel: 'S1' },
        { kind: 'supplemental-figure', label: 'Figure S2', shortLabel: 'S2' }
      ],
      coverage: {
        status: 'partial',
        expectedFigureCount: 2,
        foundFigureCount: 1,
        analyzedFigureCount: 1,
        missingFigureLabels: ['Figure S2']
      },
      logicRefreshRequired: '补充图已更新，请重新运行主图串解以纳入补充证据'
    },
    crossFigureLogic: {
      result: null,
      loading: false,
      error: '',
      staleReason: '补充图已更新，请重新运行主图串解以纳入补充证据'
    }
  };
}

async function extensionWorker(context) {
  const current = context.serviceWorkers()[0];
  return current || context.waitForEvent('serviceworker', { timeout: 15000 });
}

async function readDiagnosticDownload(download) {
  const filename = download.suggestedFilename();
  const downloadPath = await download.path();
  if (!downloadPath) throw new Error(`Diagnostic download has no local path: ${filename}`);
  const bytes = fs.readFileSync(downloadPath);
  const json = filename.endsWith('.gz') ? zlib.gunzipSync(bytes) : bytes;
  return {
    filename,
    path: downloadPath,
    bytes: bytes.length,
    bundle: JSON.parse(json.toString('utf8'))
  };
}

async function readTextDownload(download) {
  const filename = download.suggestedFilename();
  const downloadPath = await download.path();
  if (!downloadPath) throw new Error(`Text download has no local path: ${filename}`);
  const content = fs.readFileSync(downloadPath, 'utf8');
  return {
    filename,
    path: downloadPath,
    bytes: Buffer.byteLength(content, 'utf8'),
    content
  };
}

async function closeHttpServer(server, forceAfterMs = 1500) {
  if (!server) return;
  await new Promise(resolve => {
    let settled = false;
    let forceTimer = null;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (forceTimer) clearTimeout(forceTimer);
      resolve();
    };
    server.close(finish);
    server.closeIdleConnections?.();
    forceTimer = setTimeout(() => {
      server.closeAllConnections?.();
      finish();
    }, forceAfterMs);
  });
}

async function configureQaCrossFigureProvider(extensionPage, baseUrl) {
  return extensionPage.evaluate(async ({ baseUrl: providerBaseUrl }) => {
    const profileId = 'profile_qa_cross_figure';
    const savedResponse = await chrome.runtime.sendMessage({
      type: 'LLM_SAVE_PROFILE',
      profile: {
        id: profileId,
        name: 'QA cross-figure provider',
        providerId: 'openai-compatible',
        config: {
          apiKey: 'qa-onboarding-secret',
          model: 'qa-onboarding-model',
          presetId: 'custom',
          baseUrl: providerBaseUrl,
          authHeader: 'Authorization',
          authPrefix: 'Bearer',
          maxOutputTokens: 4096,
          jsonMode: true,
          supportsVision: true,
          customHeaders: {}
        }
      }
    });
    if (!savedResponse?.success) {
      throw new Error(`QA_PROFILE_SAVE_FAILED:${JSON.stringify(savedResponse?.error || {})}`);
    }
    const routedResponse = await chrome.runtime.sendMessage({
      type: 'LLM_UPDATE_PROFILE_ROUTING',
      globalProfileId: profileId,
      taskRoutes: {}
    });
    if (!routedResponse?.success) {
      throw new Error(`QA_PROFILE_ROUTE_FAILED:${JSON.stringify(routedResponse?.error || {})}`);
    }
    const preferencesResponse = await chrome.runtime.sendMessage({
      type: 'LLM_UPDATE_PREFERENCES',
      preferences: { mode: 'llm', consentGranted: true }
    });
    if (!preferencesResponse?.success) {
      throw new Error(
        `QA_PROFILE_PREFERENCES_FAILED:${JSON.stringify(preferencesResponse?.error || {})}`
      );
    }
    const saved = savedResponse.data || {};
    const routed = routedResponse.data || {};
    const preferences = preferencesResponse.data || {};
    return {
      profileId,
      saved: saved?.profile?.id === profileId,
      routed: routed?.settings?.globalProfileId === profileId,
      ready: preferences?.llmReady === true,
      effectiveMode: preferences?.effectiveMode || '',
      consentGranted: preferences?.settings?.consentGranted === true,
      profilePresent: Boolean(preferences?.settings?.profiles?.[profileId])
    };
  }, { baseUrl });
}

(async () => {
  fs.mkdirSync(outputDir, { recursive: true });
  prepareQaExtension();
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'msedge',
    headless: true,
    viewport: { width: 1280, height: 900 },
    args: [
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`
    ]
  });
  activeContext = context;
  let observeProviderRequest;
  let providerRequestQa = null;
  let crossFigureProviderRequestCount = 0;
  const researchProviderStageCalls = [];
  const researchProviderRequestDiagnostics = [];
  const providerUnknownRequestSummaries = [];
  const providerRequestObserved = new Promise(resolve => {
    observeProviderRequest = resolve;
  });
  const providerResponseGate = new Promise(resolve => {
    releaseProviderResponse = resolve;
  });
  providerServer = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    let body = {};
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch (_) {}
    const serializedBody = JSON.stringify(body);
    const promptTexts = Array.isArray(body.messages)
      ? body.messages.map(message => typeof message?.content === 'string'
        ? message.content : '').filter(Boolean)
      : [];
    const researchSystemText = promptTexts.find(text =>
      text.includes('CANONICAL_EVIDENCE_DOCUMENT_V') ||
      text.includes('NORMALIZED_ATOMS_V')) || '';
    const researchInstructionText = promptTexts.find(text =>
      text.includes('Return atomic evidence as schema-valid JSON') ||
      text.includes('exactly one paper-level Q0') ||
      text.includes('Starting from Q0') ||
      text.includes('Audit source binding') ||
      text.includes('paper-level innovation points') ||
      text.includes('research limitations')) || '';
    const researchStage = researchSystemText.includes('CANONICAL_EVIDENCE_DOCUMENT_V')
      ? 'atomic_evidence'
      : researchInstructionText.includes('exactly one paper-level Q0')
        ? 'question_trace'
        : researchInstructionText.includes('Starting from Q0')
          ? 'progression'
          : researchInstructionText.includes('Audit source binding')
            ? 'audit'
            : researchInstructionText.includes('paper-level innovation points')
              ? 'innovation'
              : researchInstructionText.includes('research limitations')
                ? 'limitations' : '';
    const isConnectivityProbe =
      serializedBody.includes('Minimal connectivity probe') &&
      serializedBody.includes('Reply with exactly OK');
    const crossPromptText = Array.isArray(body.messages)
      ? body.messages.map(message => message?.content).find(content =>
        typeof content === 'string' && content.includes('"main_figure_ids"') &&
        content.includes('"figures"'))
      : '';
    let crossPrompt = null;
    try { crossPrompt = crossPromptText ? JSON.parse(crossPromptText) : null; } catch (_) {}
    const isCrossFigureRequest = Array.isArray(crossPrompt?.main_figure_ids) &&
      crossPrompt.main_figure_ids.length >= 2;
    if (isCrossFigureRequest) crossFigureProviderRequestCount += 1;
    if (!isConnectivityProbe && !isCrossFigureRequest && !researchStage) {
      providerUnknownRequestSummaries.push({
        path: request.url || '',
        messages: Array.isArray(body.messages) ? body.messages.map(message => ({
          role: String(message?.role || ''),
          contentType: Array.isArray(message?.content) ? 'array' : typeof message?.content,
          content: typeof message?.content === 'string'
            ? message.content.slice(0, 320)
            : JSON.stringify(message?.content || null).slice(0, 320)
        })) : [],
        responseFormat: body.response_format || null
      });
    }
    providerRequestQa = {
      method: request.method || '',
      path: new URL(request.url || '/', 'http://127.0.0.1').pathname,
      model: String(body.model || ''),
      authorizationPresent: /^Bearer\s+qa-onboarding-secret$/u.test(
        request.headers.authorization || ''
      ),
      connectivityPromptPresent: isConnectivityProbe,
      streamingRequested: body.stream === true
    };
    observeProviderRequest(providerRequestQa);
    if (researchStage) researchProviderStageCalls.push(researchStage);
    if (!isCrossFigureRequest && !researchStage) await providerResponseGate;
    const mainFigureIds = isCrossFigureRequest
      ? crossPrompt.main_figure_ids.map(value => String(value || '')).filter(Boolean)
      : [];
    const crossFigureContent = isCrossFigureRequest ? {
      article_title: 'QA cross-figure synthesis',
      known_background_zh: ['QA background: phenotype precedes receptor-mechanism testing.'],
      innovation_points_zh: ['QA innovation: perturbation, mechanism and validation are linked.'],
      limitation_points_zh: ['QA limitation: independent human validation remains necessary.'],
      centralScientificQuestion:
        'How does receptor signaling convert the observed phenotype into functional rescue?',
      scientificQuestions: [{
        questionId: 'qa-question-root',
        text: 'How does receptor signaling convert the phenotype into functional rescue?',
        relationType: 'root',
        parentQuestionIds: [],
        supportingFigureIds: mainFigureIds
      }],
      overall_thesis_zh: 'The paper links phenotype, receptor mechanism and functional validation.',
      figure_nodes: mainFigureIds.map((figureId, index) => ({
        figure_id: figureId,
        role: index === 0 ? 'phenomenon' : index === mainFigureIds.length - 1
          ? 'functional_outcome' : 'mechanism',
        established_zh: `QA evidence established by ${figureId}.`,
        transition_zh: index < mainFigureIds.length - 1
          ? `The next Figure tests the inference from ${figureId}.` : 'Final validation step.',
        evidence_level: index === 0 ? 'association' : index === mainFigureIds.length - 1
          ? 'functional_validation' : 'mechanistic_support'
      })),
      domino_chain: mainFigureIds.slice(0, -1).map((figureId, index) => ({
        from_figure_id: figureId,
        to_figure_id: mainFigureIds[index + 1],
        relation_type: index === 0 ? 'phenomenon_to_mechanism' : 'causality_to_function',
        established_zh: `QA result from ${figureId}.`,
        transition_zh: `QA transition to ${mainFigureIds[index + 1]}.`,
        evidence_boundary_zh: 'Only the supplied Figure evidence is claimed.'
      })),
      mechanism_chain: [{
        from_zh: 'Observed phenotype',
        to_zh: 'Receptor signaling',
        polarity: 'positive',
        support_panel_refs: [
          `${String(mainFigureIds[0] || '').replace(/^figure-/u, '').toUpperCase()}A`
        ]
      }, {
        from_zh: 'Receptor signaling',
        to_zh: 'Functional validation',
        polarity: 'positive',
        support_panel_refs: [
          `${String(mainFigureIds[1] || mainFigureIds[0] || '')
            .replace(/^figure-/u, '').toUpperCase()}A`
        ]
      }],
      supplemental_support: [],
      claim_boundary_zh: 'QA synthesis is limited to supplied Figure evidence.'
    } : null;
    const canonicalPayload = researchStage === 'atomic_evidence'
      ? researchSystemText.slice(
        researchSystemText.indexOf('CANONICAL_EVIDENCE_DOCUMENT_V')
      ).replace(/^CANONICAL_EVIDENCE_DOCUMENT_V[^:]*:\s*/u, '')
        .split('\nThe response must satisfy this JSON schema exactly.')[0]
      : '';
    const canonicalRecords = canonicalPayload
      ? canonicalPayload.split(/\}\s+\{/u).map((fragment, index, values) => {
        const line = `${index > 0 ? '{' : ''}${fragment}${
          index < values.length - 1 ? '}' : ''}`;
        try {
          const parsed = JSON.parse(line);
          return parsed?.paragraphId && parsed?.text ? parsed : null;
        } catch (_) {
          return null;
        }
      }).filter(Boolean)
      : [];
    if (researchStage) {
      researchProviderRequestDiagnostics.push({
        stage: researchStage,
        canonicalRecordCount: canonicalRecords.length,
        systemLength: researchSystemText.length,
        markerIndex: researchSystemText.indexOf('CANONICAL_EVIDENCE_DOCUMENT_V'),
        systemAfterMarker: researchSystemText.includes('CANONICAL_EVIDENCE_DOCUMENT_V')
          ? researchSystemText.slice(
            researchSystemText.indexOf('CANONICAL_EVIDENCE_DOCUMENT_V'),
            researchSystemText.indexOf('CANONICAL_EVIDENCE_DOCUMENT_V') + 500
          ) : ''
      });
    }
    const introRecord = canonicalRecords.find(record =>
      ['abstract', 'introduction', 'background'].includes(record.sectionKind)
    ) || canonicalRecords[0] || {};
    const resultRecord = canonicalRecords.find(record =>
      ['results', 'result'].includes(record.sectionKind)
    ) || canonicalRecords[1] || introRecord;
    const sourceRef = record => ({
      paragraphId: String(record?.paragraphId || ''),
      sourceIdentity: String(record?.sourceIdentity || record?.sourceKey || ''),
      sourceKey: String(record?.sourceKey || ''),
      textHash: String(record?.textHash || ''),
      quote: String(record?.text || '').slice(0, 120).trim(),
      sectionPath: Array.isArray(record?.sectionPath) ? record.sectionPath : []
    });
    const researchContent = researchStage === 'atomic_evidence' ? {
      atoms: [{
        evidenceId: 'B1', type: 'background',
        statement: 'The paper establishes a bounded biological context before testing its mechanism.',
        evidenceRole: 'context', directness: 'conceptual', origin: 'author_explicit',
        confidence: 'high', verificationStatus: 'verified', sourceRefs: [sourceRef(introRecord)]
      }, {
        evidenceId: 'X1', type: 'knowledge_gap',
        statement: 'The causal link between the observed phenotype and the tested mechanism remains unresolved.',
        evidenceRole: 'author_statement', directness: 'same_system', origin: 'brevess_reconstructed',
        confidence: 'medium', verificationStatus: 'verified', sourceRefs: [sourceRef(introRecord)]
      }, {
        evidenceId: 'G1', type: 'rationale',
        statement: 'The study therefore tests whether the candidate mechanism explains the phenotype.',
        evidenceRole: 'context', directness: 'same_system', origin: 'brevess_reconstructed',
        confidence: 'medium', verificationStatus: 'verified', sourceRefs: [sourceRef(introRecord)]
      }, {
        evidenceId: 'R1', type: 'result',
        statement: 'The supplied result supports a bounded link between the intervention and outcome.',
        evidenceRole: 'direct_evidence', directness: 'same_system', origin: 'author_explicit',
        confidence: 'high', verificationStatus: 'verified', sourceRefs: [sourceRef(resultRecord)]
      }]
    } : researchStage === 'question_trace' ? {
      bridge: [{
        traceId: 'B1', type: 'B', evidenceIds: ['B1'],
        statement: 'Biological context', relation: 'establishes context', origin: 'author_explicit'
      }, {
        traceId: 'X1', type: 'X', evidenceIds: ['X1'],
        statement: 'Unresolved mechanism', relation: 'creates the gap', origin: 'brevess_reconstructed'
      }, {
        traceId: 'G1', type: 'G', evidenceIds: ['G1'],
        statement: 'Mechanistic rationale', relation: 'motivates the test', origin: 'brevess_reconstructed'
      }],
      coreQuestion: {
        questionId: 'Q0',
        text: 'How does the candidate mechanism explain the observed biological phenotype?',
        authorWording: 'The study asks whether the candidate mechanism accounts for the phenotype.',
        evidenceIds: ['X1', 'G1'], origin: 'brevess_reconstructed', confidence: 'high'
      }
    } : researchStage === 'progression' ? {
      progression: [{
        questionId: 'Q1',
        text: 'Does perturbing the candidate mechanism alter the measured phenotype?',
        authorWording: '', evidenceIds: ['R1'], origin: 'brevess_reconstructed',
        confidence: 'high', generatedFrom: ['Q0'],
        hypothesis: 'Perturbation changes the phenotype.',
        test: 'Compare the intervention and matched control.',
        result: 'The intervention changes the measured outcome.',
        warrantedConclusion: 'The result supports an intervention effect in the tested system.',
        remainingGap: 'Independent systems remain to be tested.',
        causalLevel: 'intervention_effect'
      }]
    } : researchStage === 'audit' ? {
      issues: [], acceptedQuestionIds: ['Q0', 'Q1']
    } : researchStage === 'innovation' ? {
      innovationPoints: [{
        pointId: 'I1',
        text: 'The study connects a bounded mechanistic test to a functional outcome.',
        evidenceIds: ['G1', 'R1'], noveltyType: 'mechanism_to_function',
        origin: 'brevess_reconstructed', confidence: 'medium'
      }]
    } : researchStage === 'limitations' ? {
      limitationPoints: [{
        pointId: 'L1',
        text: 'The supplied evidence is limited to the tested biological system.',
        evidenceIds: ['R1'], scope: 'external validity',
        origin: 'brevess_reconstructed', confidence: 'medium'
      }]
    } : null;
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({
      model: 'qa-onboarding-model',
      choices: [{
        finish_reason: 'stop',
         message: {
           content: isConnectivityProbe ? 'OK' : isCrossFigureRequest
             ? JSON.stringify(crossFigureContent)
             : researchContent ? JSON.stringify(researchContent)
             : JSON.stringify({ paragraphs_reviewed: ['connection-p1'], annotations: [] })
        }
      }],
      usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 }
    }));
  });
  await new Promise((resolve, reject) => {
    providerServer.once('error', reject);
    providerServer.listen(0, '127.0.0.1', resolve);
  });
  const providerBaseUrl =
    `http://127.0.0.1:${providerServer.address().port}/v1`;
  const pageErrors = [];
  const consoleErrors = [];
  const fixture = context.pages()[0] || await context.newPage();
  fixture.on('pageerror', error => pageErrors.push(`fixture: ${error.message}`));
  fixture.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(`fixture: ${message.text()}`);
  });
  await fixture.route('https://example.org/oa-mechanism-review', route => route.fulfill({
    status: 200,
    contentType: 'text/html; charset=utf-8',
    body: articleFixture()
  }));
  await fixture.goto('https://example.org/oa-mechanism-review', {
    waitUntil: 'domcontentloaded'
  });

  const beforeActivationRevision = await fixture.evaluate(() =>
    document.documentElement.dataset.sciLlmContentRevision || '');
  const worker = await extensionWorker(context);
  const extensionId = new URL(worker.url()).host;
  if (process.env.SCI_QA_PROFILE_SETUP_PROBE === '1') {
    const setupPage = await context.newPage();
    await setupPage.goto(`chrome-extension://${extensionId}/options.html`, {
      waitUntil: 'domcontentloaded'
    });
    const setup = await configureQaCrossFigureProvider(setupPage, providerBaseUrl);
    let researchRouterProbe = null;
    if (process.env.SCI_QA_RESEARCH_ROUTER_PROBE === '1') {
      releaseProviderResponse?.();
      const document = {
        title: 'QA research router probe',
        documentHash: 'qa-research-router-hash',
        paragraphs: [{
          paragraphId: 'qa-intro-1', sourceIdentity: 'qa-intro-1',
          sourceKey: 'qa-intro-1', textHash: 'qa-intro-hash',
          sectionKind: 'introduction', sectionTitle: 'Introduction',
          sectionPath: ['Introduction'],
          text: 'The mechanism linking the phenotype to functional recovery remains unknown.'
        }, {
          paragraphId: 'qa-result-1', sourceIdentity: 'qa-result-1',
          sourceKey: 'qa-result-1', textHash: 'qa-result-hash',
          sectionKind: 'results', sectionTitle: 'Results',
          sectionPath: ['Results'],
          text: 'The intervention changed the measured phenotype in the tested system.'
        }]
      };
      researchRouterProbe = await setupPage.evaluate(async value => {
        const research = await chrome.runtime.sendMessage({
          type: 'LLM_ANALYZE_RESEARCH_LOGIC', document: value
        });
        const innovation = await chrome.runtime.sendMessage({
          type: 'LLM_ANALYZE_PAPER_INNOVATION', document: value
        });
        const limitations = await chrome.runtime.sendMessage({
          type: 'LLM_ANALYZE_PAPER_LIMITATIONS', document: value
        });
        return { research, innovation, limitations };
      }, document);
    }
    const stateResponse = await setupPage.evaluate(() =>
      chrome.runtime.sendMessage({ type: 'LLM_GET_SETTINGS' }));
    const state = stateResponse?.data || {};
    const probe = {
      setup,
      responseSuccess: stateResponse?.success === true,
      getProfilePresent: Boolean(state.settings?.profiles?.[setup.profileId]),
      getGlobalProfileId: state.settings?.globalProfileId || '',
      getConsentGranted: state.settings?.consentGranted === true,
      getEffectiveMode: state.effectiveMode || '',
      getLlmReady: state.llmReady === true,
      researchRouterProbe,
      researchProviderStageCalls,
      researchProviderRequestDiagnostics,
      providerUnknownRequestSummaries
    };
    probe.passed = probe.responseSuccess && probe.setup.saved && probe.setup.routed &&
      probe.setup.ready && probe.setup.effectiveMode === 'llm' &&
      probe.setup.consentGranted && probe.setup.profilePresent &&
      probe.getProfilePresent && probe.getGlobalProfileId === setup.profileId &&
      probe.getConsentGranted && probe.getEffectiveMode === 'llm' && probe.getLlmReady;
    if (process.env.SCI_QA_RESEARCH_ROUTER_PROBE === '1') {
      probe.passed = probe.passed &&
        researchRouterProbe?.research?.success === true &&
        researchRouterProbe?.innovation?.success === true &&
        researchRouterProbe?.limitations?.success === true;
    }
    process.stdout.write(`${JSON.stringify(probe, null, 2)}\n`);
    if (!probe.passed) throw new Error(`QA_PROFILE_SETUP_PROBE_FAILED:${JSON.stringify(probe)}`);
    await context.close();
    activeContext = null;
    await closeHttpServer(providerServer);
    providerServer = null;
    fs.rmSync(userDataDir, { recursive: true, force: true });
    fs.rmSync(extensionDir, { recursive: true, force: true });
    return;
  }
  const tabs = await worker.evaluate(() => chrome.tabs.query({}));
  const fixtureTab = tabs.find(tab =>
    tab.url?.startsWith('https://example.org/oa-mechanism-review') ||
    tab.title === 'OA mechanism review test'
  ) || tabs.find(tab => tab.active);
  if (!fixtureTab?.id) {
    throw new Error(`Unable to resolve the fixture tab id: ${JSON.stringify(tabs)}`);
  }
  const legacySidePanelRepair = await worker.evaluate(async tabId => {
    await chrome.sidePanel.setOptions({
      tabId,
      path: 'popup.html',
      enabled: false
    });
    const before = await chrome.sidePanel.getOptions({ tabId });
    const repaired = await repairLegacyTabSidePanelOptions(tabId);
    const after = await chrome.sidePanel.getOptions({ tabId });
    return { before, repaired, after };
  }, fixtureTab.id);
  const sidePanelOptions = await worker.evaluate(
    tabId => chrome.sidePanel.getOptions({ tabId }),
    fixtureTab.id
  );
  await worker.evaluate(async tab => {
    const activation = await SciLLM.markTabActivated(chrome.storage.session, tab);
    await chrome.runtime.sendMessage({ type: 'PANEL_TAB_ACTIVATED', activation })
      .catch(() => {});
    await chrome.tabs.sendMessage(tab.id, { action: 'disarmSidePanelRestore' })
      .catch(() => {});
  }, fixtureTab);

  const sidePanel = await context.newPage();
  sidePanel.on('pageerror', error => pageErrors.push(`side-panel: ${error.message}`));
  sidePanel.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(`side-panel: ${message.text()}`);
  });
  await sidePanel.setViewportSize({ width: 420, height: 900 });
  await sidePanel.goto(`chrome-extension://${extensionId}/popup.html`, {
    waitUntil: 'domcontentloaded'
  });
  await fixture.bringToFront();
  try {
    await sidePanel.waitForFunction(() =>
      document.getElementById('sidePanelPaperTitle')?.textContent ===
        'OA mechanism review test'
    );
  } catch (error) {
    const panelState = await sidePanel.evaluate(() => ({
      title: document.getElementById('sidePanelPaperTitle')?.textContent || '',
      status: document.getElementById('sidePanelDocumentStatusText')?.textContent || '',
      displayMode: document.body.dataset.displayMode || '',
      readyState: document.readyState
    })).catch(() => ({}));
    throw new Error(`Side panel did not bind the fixture: ${JSON.stringify({
      panelState, pageErrors, consoleErrors, cause: error.message
    })}`);
  }
  const activated = await sidePanel.evaluate(async () => {
    await refreshManualAnnotationSummary();
    await refreshArticleWorkspace();
    await probeCurrentArticleArchive();
    return {
      title: document.getElementById('sidePanelPaperTitle')?.textContent || '',
      status: document.getElementById('articleNavigationStatus')?.textContent || '',
      viewCount: document.querySelectorAll('[data-workspace-view]').length,
      navCount: document.querySelectorAll('[data-workspace-target]').length,
      applyActionAboveEngine:
        document.getElementById('applyHighlight')?.compareDocumentPosition(
          document.querySelector('.analysis-engine-section')
        ) === Node.DOCUMENT_POSITION_FOLLOWING,
      analysisIconVisible: getComputedStyle(
        document.querySelector('#highlightControls > summary .ph'), '::before'
      ).content !== 'none',
      removedAnalysisActions:
        !document.getElementById('openArticleNavigator') &&
        !document.getElementById('generateReviewOutline'),
      feedbackRemoved: !document.querySelector('a[href^="mailto:"]'),
      archivePromptHidden: document.getElementById('articleArchivePrompt')?.hidden,
      migrationScriptsLoaded: typeof SciLLM.validateArticleArchive === 'function'
    };
  });
  const publisherSingleColumnQa = await fixture.evaluate(() => {
    const originalFamily = document.documentElement.dataset.sciPublisherFamily || '';
    document.documentElement.dataset.sciPublisherFamily = 'springer-nature';
    const host = document.createElement('div');
    host.id = 'publisher-single-column-qa';
    host.style.cssText = 'width:760px;overflow:hidden';
    host.innerHTML =
      '<div class="c-article-main-column" style="float:left;width:500px">Article</div>' +
      '<aside class="c-article-extras" style="float:right;width:240px">' +
      '<div class="c-reading-companion">Publisher navigation</div></aside>';
    document.body.appendChild(host);
    const main = host.querySelector('.c-article-main-column');
    const extras = host.querySelector('.c-article-extras');
    const companion = host.querySelector('.c-reading-companion');
    const result = {
      enabled: document.documentElement.dataset.sciReaderSingleColumn === 'true',
      extrasDisplay: getComputedStyle(extras).display,
      companionDisplay: getComputedStyle(companion).display,
      mainFloat: getComputedStyle(main).float,
      mainWidth: Math.round(main.getBoundingClientRect().width),
      hostWidth: Math.round(host.getBoundingClientRect().width)
    };
    host.remove();
    document.documentElement.dataset.sciPublisherFamily = originalFamily;
    return result;
  });
  await fixture.evaluate(() => {
    const figure = document.createElement('figure');
    figure.id = 'dynamic-nature-panel-qa';
    figure.innerHTML =
      '<div class="figure-caption"><span class="figure-label">Figure 9.</span> Dynamic Nature figure.</div>' +
      '<div class="c-article-section__figure-description">Loading figure metadata…</div>';
    document.querySelector('article')?.appendChild(figure);
  });
  const dynamicNaturePanelInitial = await sidePanel.evaluate(async () => {
    const snapshot = await refreshArticleWorkspace();
    const figure = snapshot?.figures?.figures?.find(item => item.figureId === 'figure-9');
    return { found: Boolean(figure), panelHints: figure?.panelHints || [] };
  });
  await fixture.evaluate(() => {
    const description = document.querySelector(
      '#dynamic-nature-panel-qa .c-article-section__figure-description'
    );
    if (description) description.innerHTML =
      '<b>a-c,</b>Monocytes and macrophages were selected and reclustered.' +
      '<b>d-f.</b>UMAP plots show selected genes in ND, recurrent and mouse tumors.' +
      '<b>g,h.</b>Volcano plots compare Mg-TAMs and Mo-TAMs.' +
      '<b>i,j.</b>Scatter plots and TAM percentages are shown.';
  });
  await sidePanel.waitForFunction(() => {
    const figure = currentWorkspaceSnapshot?.figures?.figures
      ?.find(item => item.figureId === 'figure-9');
    return JSON.stringify(figure?.panelHints || []) ===
      JSON.stringify(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']);
  }, null, { timeout: 5000 });
  const dynamicNaturePanelUpdated = await sidePanel.evaluate(() => {
    const snapshot = currentWorkspaceSnapshot;
    const figure = snapshot?.figures?.figures?.find(item => item.figureId === 'figure-9');
    return { found: Boolean(figure), panelHints: figure?.panelHints || [] };
  });
  const figureInventoryCacheQa = await worker.evaluate(async tabId => {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'ISOLATED',
      func: () => {
        const originalFreshnessCheck = SciLLM.figureInventoryNeedsRefresh;
        const originalExtraction = SciLLM.extractArticleFigures;
        let freshnessChecks = 0;
        let extractions = 0;
        SciLLM.figureInventoryNeedsRefresh = (...args) => {
          freshnessChecks += 1;
          return originalFreshnessCheck(...args);
        };
        SciLLM.extractArticleFigures = (...args) => {
          extractions += 1;
          return originalExtraction(...args);
        };
        const startedAt = performance.now();
        for (let index = 0; index < 100; index += 1) getFigureWorkspaceInventory();
        const elapsedMs = performance.now() - startedAt;
        SciLLM.figureInventoryNeedsRefresh = originalFreshnessCheck;
        SciLLM.extractArticleFigures = originalExtraction;
        return { freshnessChecks, extractions, elapsedMs };
      }
    });
    return result;
  }, fixtureTab.id);
  await fixture.evaluate(() => document.getElementById('dynamic-nature-panel-qa')?.remove());
  await sidePanel.waitForFunction(() =>
    !currentWorkspaceSnapshot?.figures?.figures
      ?.some(item => item.figureId === 'figure-9'), null, { timeout: 5000 });
  const dynamicNaturePanelCleanup = await sidePanel.evaluate(() => {
    const snapshot = currentWorkspaceSnapshot;
    return !snapshot?.figures?.figures?.some(item => item.figureId === 'figure-9');
  });
  const dynamicNaturePanelQa = {
    initial: dynamicNaturePanelInitial,
    updated: dynamicNaturePanelUpdated,
    cleanup: dynamicNaturePanelCleanup
  };
  await fixture.evaluate(() => {
    const wrapper = document.createElement('div');
    wrapper.id = 'structured-nature-panel-qa';
    wrapper.innerHTML =
      '<figure><figcaption><b class="figure-label">Figure 92.</b> Structured legend.</figcaption>' +
      '<div class="c-article-section__figure-description" data-test="bottom-caption">' +
      '<p><b>a</b>, Overview. <b>b–d</b>, Measurements. ' +
      '<b>e</b>,<b>f</b>, Heatmaps. B, B cells; n.c., necrotic core; ' +
      'M, mean; T, T cells.</p></div></figure>';
    document.querySelector('article')?.appendChild(wrapper);
  });
  await sidePanel.waitForFunction(() => {
    const figure = currentWorkspaceSnapshot?.figures?.figures
      ?.find(item => item.figureId === 'figure-92');
    return JSON.stringify(figure?.panelHints || []) ===
      JSON.stringify(['A', 'B', 'C', 'D', 'E', 'F']);
  }, null, { timeout: 5000 });
  const structuredNaturePanelQa = await sidePanel.evaluate(() => {
    const figure = currentWorkspaceSnapshot?.figures?.figures
      ?.find(item => item.figureId === 'figure-92');
    return {
      panels: figure?.panelHints || [],
      excludesGlossaryInitials: !figure?.panelHints?.some(label =>
        ['M', 'N', 'T'].includes(label))
    };
  });
  await fixture.evaluate(() => document.getElementById('structured-nature-panel-qa')?.remove());
  await sidePanel.waitForFunction(() =>
    !currentWorkspaceSnapshot?.figures?.figures
      ?.some(item => item.figureId === 'figure-92'), null, { timeout: 5000 });
  structuredNaturePanelQa.cleanup = true;
  await fixture.evaluate(() => {
    const aggregate = document.createElement('div');
    aggregate.id = 'nested-figure-aggregate-qa';
    aggregate.className = 'figure';
    aggregate.innerHTML =
      '<figure id="nested-figure-90"><figcaption>' +
      '<span class="figure-label">Figure 90.</span> Study overview. ' +
      '<b>a-c,</b>Workflow and cohorts.</figcaption></figure>' +
      '<figure id="nested-figure-91"><figcaption>' +
      '<span class="figure-label">Figure 91.</span> Dendritic-cell atlas. ' +
      '<b>a-m,</b>UMAP, heatmaps, and validation.</figcaption></figure>';
    document.querySelector('article')?.appendChild(aggregate);
  });
  await sidePanel.waitForFunction(() => {
    const figures = currentWorkspaceSnapshot?.figures?.figures || [];
    const figure90 = figures.find(item => item.figureId === 'figure-90');
    const figure91 = figures.find(item => item.figureId === 'figure-91');
    return JSON.stringify(figure90?.panelHints || []) === JSON.stringify(['A', 'B', 'C']) &&
      JSON.stringify(figure91?.panelHints || []) ===
        JSON.stringify(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M']);
  }, null, { timeout: 5000 });
  const nestedFigureIsolationBeforeJump = await sidePanel.evaluate(() => {
    const figures = currentWorkspaceSnapshot?.figures?.figures || [];
    const figure90 = figures.find(item => item.figureId === 'figure-90');
    const figure91 = figures.find(item => item.figureId === 'figure-91');
    return {
      figure90Panels: figure90?.panelHints || [],
      figure91Panels: figure91?.panelHints || [],
      figure90Caption: figure90?.caption || '',
      figure91Caption: figure91?.caption || ''
    };
  });
  await sidePanel.locator('[data-workspace-target="figures"]').click();
  await sidePanel.locator(
    '.workspace-figure-card[data-figure-id="figure-90"] > summary'
  ).click();
  await sidePanel.locator(
    '.workspace-figure-card[data-figure-id="figure-90"] .workspace-figure-action'
  ).first().click();
  await fixture.waitForFunction(() => Boolean(
    document.querySelector('#nested-figure-90 .sci-article-source-focus')
  ));
  const nestedFigureJumpQa = await fixture.evaluate(() => ({
    figure90Focused: Boolean(document.querySelector(
      '#nested-figure-90 .sci-article-source-focus'
    )),
    figure91Focused: Boolean(document.querySelector(
      '#nested-figure-91 .sci-article-source-focus'
    ))
  }));
  await fixture.evaluate(() => document.getElementById('nested-figure-aggregate-qa')?.remove());
  await sidePanel.waitForFunction(() => {
    const figures = currentWorkspaceSnapshot?.figures?.figures || [];
    return !figures.some(item => ['figure-90', 'figure-91'].includes(item.figureId));
  }, null, { timeout: 5000 });
  const nestedFigureIsolationQa = {
    ...nestedFigureIsolationBeforeJump,
    ...nestedFigureJumpQa,
    cleanup: true
  };
  if (process.env.SCI_QA_INVENTORY_ALIGNMENT_PROBE === '1') {
    const probeArchive = await sidePanel.evaluate(async () =>
      (await getCurrentArticleArchiveFromTab()).archive);
    probeArchive.workspace.figureWorkspace = figureWorkspaceFixture();
    probeArchive.workspace.figures = probeArchive.workspace.figureWorkspace.figures;
    const restoredProbe = await sidePanel.evaluate(
      value => applyLoadedArticleArchive(value, { imported: true }),
      probeArchive
    );
    await sidePanel.evaluate(() => refreshArticleWorkspace());
    const contentProbe = await worker.evaluate(async tabId => {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'ISOLATED',
        func: () => ({
          inventoryIds: (figureWorkspaceInventory || []).map(figure => figure.figureId),
          draftIds: Object.keys(figureWorkspaceDraft?.figures || {})
        })
      });
      return result;
    }, fixtureTab.id);
    const panelIds = await sidePanel.evaluate(() =>
      Object.keys(mechanismWorkspaceDraft()?.figures || {}));
    const expectedIds = ['figure-1', 'figure-2', 'figure-3'];
    const probe = {
      restored: restoredProbe?.success === true,
      panelIds,
      contentInventoryIds: contentProbe.inventoryIds,
      contentDraftIds: contentProbe.draftIds
    };
    probe.passed = probe.restored &&
      expectedIds.every(id => probe.panelIds.includes(id)) &&
      expectedIds.every(id => probe.contentInventoryIds.includes(id)) &&
      expectedIds.every(id => probe.contentDraftIds.includes(id)) &&
      !probe.contentInventoryIds.some(id => ['figure-9', 'figure-90', 'figure-91', 'figure-92']
        .includes(id));
    process.stdout.write(`${JSON.stringify(probe, null, 2)}\n`);
    if (!probe.passed) throw new Error(`QA_INVENTORY_ALIGNMENT_PROBE_FAILED:${JSON.stringify(probe)}`);
    await context.close();
    activeContext = null;
    await closeHttpServer(providerServer);
    providerServer = null;
    fs.rmSync(userDataDir, { recursive: true, force: true });
    fs.rmSync(extensionDir, { recursive: true, force: true });
    return;
  }
  await sidePanel.locator('[data-workspace-target="figures"]').click();
  await sidePanel.waitForFunction(() =>
    document.querySelector('[data-workspace-view="figures"]')?.hidden === false
  );
  await sidePanel.locator('#saveCurrentArticleWorkspace').click();
  await sidePanel.waitForFunction(() =>
    document.getElementById('saveCurrentArticleWorkspace')?.disabled === false &&
    /\u5c1a\u672a\u8bbe\u7f6e\u672c\u5730\u4fdd\u5b58\u6587\u4ef6\u5939/.test(
      document.getElementById('statusMessage')?.textContent || ''
    )
  );
  const globalToolbarSaveFailureQa = await sidePanel.evaluate(() => {
    const status = document.getElementById('statusMessage');
    const button = document.getElementById('saveCurrentArticleWorkspace');
    return {
      figureViewActive:
        document.querySelector('[data-workspace-view="figures"]')?.hidden === false,
      visible: Boolean(status && status.offsetParent !== null &&
        getComputedStyle(status).display !== 'none'),
      text: status?.textContent || '',
      buttonRecovered: button?.disabled === false,
      busyReleased: button?.hasAttribute('aria-busy') === false
    };
  });
  await sidePanel.evaluate(() => showStatus('QA first global status', 'success'));
  await sidePanel.waitForTimeout(2600);
  await sidePanel.evaluate(() => showStatus('QA latest global status', 'success'));
  await sidePanel.waitForTimeout(550);
  const globalToolbarTimerQa = await sidePanel.evaluate(() => {
    const status = document.getElementById('statusMessage');
    return {
      latestTextRetained: status?.textContent === 'QA latest global status',
      latestStillVisible: Boolean(status?.classList.contains('show') &&
        status.offsetParent !== null && getComputedStyle(status).display !== 'none'),
      timerActive: statusMessageTimer !== null
    };
  });
  const globalToolbarFeedbackQa = {
    saveFailure: globalToolbarSaveFailureQa,
    timerIsolation: globalToolbarTimerQa
  };
  await sidePanel.locator('[data-workspace-target="highlights"]').click();
  if (!await sidePanel.locator('#highlightControls').evaluate(node => node.open)) {
    await sidePanel.locator('#highlightControls > summary').click();
  }
  await sidePanel.waitForFunction(() =>
    document.querySelector('[data-workspace-view="highlights"]')?.hidden === false &&
    document.getElementById('highlightControls')?.open === true
  );
  const afterActivationRevision = await fixture.evaluate(() =>
    document.documentElement.dataset.sciLlmContentRevision || '');
  const pageOverlayCount = await fixture.locator(
    '#sci-reading-panel,#sci-review-outline-panel,#sci-article-navigator,.sci-figure-walkthrough'
  ).count();
  await sidePanel.waitForFunction(() =>
    analysisMode === 'regex' &&
    selectedCategories.size > 0 &&
    document.getElementById('applyHighlight')?.disabled === false
  );
  await sidePanel.locator('#applyHighlight').click();
  await sidePanel.waitForFunction(() =>
    regexApplyPending === false &&
    document.getElementById('applyHighlight')?.disabled === false &&
    /高亮已应用/.test(document.getElementById('statusMessage')?.textContent || '')
  );
  try {
    await fixture.waitForFunction(() =>
      document.querySelectorAll('.sci-highlight,.sci-llm-highlight').length > 0
    );
  } catch (error) {
    const panelDebug = await sidePanel.evaluate(() => ({
      analysisMode,
      readingViewId,
      selectedCategories: [...selectedCategories],
      regexCategories: getCategoryEntriesForEngine('regex')
        .filter(([categoryId]) => selectedCategories.has(categoryId))
        .map(([categoryId, category]) => ({
          categoryId,
          name: category?.name || '',
          patterns: category?.patterns || category?.regexPatterns || []
        })),
      matchCounts,
      status: document.getElementById('statusMessage')?.textContent || ''
    })).catch(() => ({}));
    const fixtureDebug = await fixture.evaluate(() => ({
      contentRevision: document.documentElement.dataset.sciLlmContentRevision || '',
      paragraphIds: [...document.querySelectorAll('[data-sci-llm-paragraph-id]')]
        .map(element => element.dataset.sciLlmParagraphId),
      marks: document.querySelectorAll('.sci-highlight,.sci-llm-highlight').length
    })).catch(() => ({}));
    const isolatedDebug = await worker.evaluate(async tabId => {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'ISOLATED',
        func: () => ({
          allowedParagraphIds: [...(highlighter.allowedParagraphIds || [])],
          matchCounts: highlighter.matchCounts,
          lastRegexHighlightRequest
        })
      });
      return result;
    }, fixtureTab.id).catch(() => ({}));
    throw new Error(`Regex highlight did not render: ${JSON.stringify({
      panelDebug, fixtureDebug, isolatedDebug, pageErrors, consoleErrors,
      cause: error.message
    })}`);
  }
  const automaticHighlightsCreated = await fixture.locator(
    '.sci-highlight,.sci-llm-highlight'
  ).count();
  const manualSelectionQa = await fixture.evaluate(async () => {
    const paragraph = document.querySelector('article section:nth-of-type(3) p');
    const walker = paragraph
      ? document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT)
      : null;
    const textNodes = [];
    while (walker?.nextNode()) {
      if (walker.currentNode.textContent) textNodes.push(walker.currentNode);
    }
    if (!textNodes.length) return { toolbarVisible: false, reason: 'missing-fixture-text' };
    const locateOffset = offset => {
      let remaining = Math.max(0, offset);
      for (const textNode of textNodes) {
        const length = textNode.textContent.length;
        if (remaining <= length) return { textNode, offset: remaining };
        remaining -= length;
      }
      const textNode = textNodes[textNodes.length - 1];
      return { textNode, offset: textNode.textContent.length };
    };
    const selectAndWait = async (start, end) => {
      const startPoint = locateOffset(start);
      const endPoint = locateOffset(end);
      const range = document.createRange();
      range.setStart(startPoint.textNode, startPoint.offset);
      range.setEnd(endPoint.textNode, endPoint.offset);
      const selection = document.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      const startedAt = performance.now();
      document.dispatchEvent(new Event('selectionchange', { bubbles: true }));
      document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      while (!document.getElementById('sci-manual-toolbar') &&
          performance.now() - startedAt < 600) {
        await new Promise(resolve => setTimeout(resolve, 4));
      }
      return Math.round(performance.now() - startedAt);
    };
    const firstOpenMs = await selectAndWait(0, 42);
    const toolbar = document.getElementById('sci-manual-toolbar');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    const secondOpenMs = await selectAndWait(12, 56);
    const secondToolbar = document.getElementById('sci-manual-toolbar');
    const modeSelect = secondToolbar?.querySelector('.sci-manual-mode-row select');
    const beforeModeId = modeSelect?.value || '';
    const beforeCategories = [...(secondToolbar?.querySelectorAll(
      '.sci-manual-category'
    ) || [])].map(button => button.textContent || '');
    const alternateMode = [...(modeSelect?.options || [])]
      .find(option => option.value && option.value !== beforeModeId);
    if (alternateMode && modeSelect) {
      modeSelect.value = alternateMode.value;
      modeSelect.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const switchedToolbar = document.getElementById('sci-manual-toolbar');
    const switchedSelect = switchedToolbar?.querySelector('.sci-manual-mode-row select');
    const afterCategories = [...(switchedToolbar?.querySelectorAll(
      '.sci-manual-category'
    ) || [])].map(button => button.textContent || '');
    const result = {
      toolbarVisible: Boolean(toolbar) && Boolean(switchedToolbar),
      categoryActions: switchedToolbar?.querySelectorAll('.sci-manual-category').length || 0,
      hasMore: Boolean(switchedToolbar?.querySelector('.sci-manual-text-action')),
      firstOpenMs,
      secondOpenMs,
      beforeModeId,
      requestedModeId: alternateMode?.value || '',
      afterModeId: switchedSelect?.value || '',
      modeSwitched: Boolean(alternateMode) &&
        switchedSelect?.value === alternateMode.value,
      categoriesChanged: JSON.stringify(beforeCategories) !== JSON.stringify(afterCategories)
    };
    return result;
  });
  await fixture.screenshot({
    path: path.join(outputDir, 'edge-manual-analysis-mode-toolbar.png'),
    fullPage: false
  });
  const manualAnnotationCreatedQa = await fixture.evaluate(async () => {
    const paragraph = document.querySelector('article section:nth-of-type(2) p');
    const walker = paragraph
      ? document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT)
      : null;
    const textNodes = [];
    while (walker?.nextNode()) {
      if (walker.currentNode.textContent) textNodes.push(walker.currentNode);
    }
    if (!textNodes.length) {
      return { created: false, reason: 'missing-manual-annotation-text' };
    }
    let remaining = 48;
    let endNode = textNodes[0];
    let endOffset = Math.min(remaining, endNode.textContent.length);
    for (const textNode of textNodes) {
      if (remaining <= textNode.textContent.length) {
        endNode = textNode;
        endOffset = remaining;
        break;
      }
      remaining -= textNode.textContent.length;
      endNode = textNode;
      endOffset = textNode.textContent.length;
    }
    const range = document.createRange();
    range.setStart(textNodes[0], 0);
    range.setEnd(endNode, endOffset);
    const selection = document.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    const startedAt = performance.now();
    document.dispatchEvent(new Event('selectionchange', { bubbles: true }));
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    while (!document.querySelector('#sci-manual-toolbar .sci-manual-category') &&
        performance.now() - startedAt < 800) {
      await new Promise(resolve => setTimeout(resolve, 4));
    }
    const category = document.querySelector('#sci-manual-toolbar .sci-manual-category');
    const categoryName = category?.textContent || '';
    category?.click();
    while (document.querySelectorAll('.sci-manual-highlight').length === 0 &&
        performance.now() - startedAt < 2500) {
      await new Promise(resolve => setTimeout(resolve, 8));
    }
    return {
      created: document.querySelectorAll('.sci-manual-highlight').length === 1,
      categoryName,
      createdMs: Math.round(performance.now() - startedAt)
    };
  });
  await sidePanel.waitForFunction(() =>
    /本文手动标注 1 条/.test(
      document.getElementById('manualAnnotationSummary')?.textContent || ''
    ) && document.getElementById('clearManualAnnotations')?.disabled === false,
  null, { timeout: 2500 });
  await sidePanel.locator('[data-workspace-target="highlights"]').click();
  await sidePanel.waitForFunction(() =>
    document.querySelectorAll('.workspace-distribution-cell.is-manual').length > 0 &&
    document.querySelectorAll('.workspace-distribution-cell.is-regex').length > 0,
  null, { timeout: 2500 });
  const manualDistributionBeforeClearQa = await sidePanel.evaluate(() => ({
    totalHighlights: Number(currentWorkspaceSnapshot?.highlightDistribution?.totalHighlights) || 0,
    manualCount: Number(currentWorkspaceSnapshot?.highlightDistribution?.sourceCounts?.manual) || 0,
    regexCount: Number(currentWorkspaceSnapshot?.highlightDistribution?.sourceCounts?.regex) || 0,
    manualLegend: document.querySelector(
      '.workspace-distribution-legend-item.is-manual'
    )?.textContent || '',
    regexLegend: document.querySelector(
      '.workspace-distribution-legend-item.is-regex'
    )?.textContent || '',
    manualCells: document.querySelectorAll(
      '.workspace-distribution-cell.is-manual'
    ).length,
    regexCells: document.querySelectorAll(
      '.workspace-distribution-cell.is-regex'
    ).length
  }));
  await sidePanel.locator('.workspace-distribution-cell.is-manual').first().click();
  await fixture.waitForFunction(() =>
    Boolean(document.querySelector('.sci-manual-highlight.sci-article-source-focus'))
  );
  manualDistributionBeforeClearQa.manualJumpFocused = true;
  // Let the first async source-focus message finish before issuing the next jump.
  await sidePanel.waitForTimeout(100);
  await sidePanel.evaluate(() => {
    const originalFocusWorkspaceSource = focusWorkspaceSource;
    globalThis.__sciQaRegexDistributionJump = null;
    focusWorkspaceSource = async (...args) => {
      const focused = await originalFocusWorkspaceSource(...args);
      globalThis.__sciQaRegexDistributionJump = {
        target: args[0] || null,
        focused
      };
      return focused;
    };
  });
  await sidePanel.locator('.workspace-distribution-cell.is-regex').first()
    .evaluate(button => button.click());
  await sidePanel.waitForFunction(() =>
    globalThis.__sciQaRegexDistributionJump?.target?.kind === 'highlight' &&
    globalThis.__sciQaRegexDistributionJump?.focused === true,
  null, { timeout: 5000 });
  manualDistributionBeforeClearQa.regexJumpFocused = true;
  await sidePanel.locator('[data-workspace-target="highlights"]').click();
  if (!await sidePanel.locator('#highlightControls').evaluate(node => node.open)) {
    await sidePanel.locator('#highlightControls > summary').click();
  }
  await sidePanel.locator('#clearAutomaticHighlights').click();
  await fixture.waitForFunction(() =>
    document.querySelectorAll('.sci-highlight,.sci-llm-highlight').length === 0
  );
  await sidePanel.waitForFunction(() =>
    /自动高亮已清除/.test(
      document.getElementById('statusMessage')?.textContent || ''
    ) &&
    document.getElementById('clearAutomaticHighlights')?.disabled === false
  );
  const afterAutomaticClearQa = await worker.evaluate(async tabId => {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'ISOLATED',
      func: async () => {
        const response = await chrome.runtime.sendMessage({
          type: 'ARTICLE_WORKSPACE_EXPORT',
          workspaceId: currentArticleWorkspace?.workspaceId || ''
        });
        const highlightAsset = response?.data?.assets?.find(
          asset => asset.relativePath === 'annotations/highlights.json'
        )?.content || null;
        const analysisAsset = response?.data?.assets?.find(
          asset => asset.relativePath === 'analysis/full-analysis.json'
        )?.content || null;
        return {
          automaticMarks: document.querySelectorAll(
            '.sci-highlight,.sci-llm-highlight'
          ).length,
          manualMarks: document.querySelectorAll('.sci-manual-highlight').length,
          annotationCount:
            currentManualDocument?.record?.annotations?.length || 0,
          lastRegexRequestCleared: lastRegexHighlightRequest === null,
          lastLlmAnalysisCleared: lastLlmAnalysis === null,
          persistedActiveEngine: highlightAsset?.activeEngine || '',
          persistedRegexRequest: highlightAsset?.lastRegexRequest ?? null,
          persistedManualAnnotations: highlightAsset?.annotations?.length || 0,
          persistedLlmAnalysis: analysisAsset?.llm ?? null
        };
      }
    });
    return result;
  }, fixtureTab.id);
  await sidePanel.locator('#clearManualAnnotations').click();
  await sidePanel.locator('#clearManualDialog[open]').waitFor({ state: 'visible' });
  await sidePanel.locator('#cancelClearManual').click();
  await sidePanel.locator('#clearManualDialog').waitFor({ state: 'hidden' });
  const manualClearCancelledQa = {
    marks: await fixture.locator('.sci-manual-highlight').count(),
    annotations: await worker.evaluate(async tabId => {
      const response = await chrome.tabs.sendMessage(tabId, {
        action: 'prepareManualAnnotations'
      });
      return response?.annotationCount || 0;
    }, fixtureTab.id)
  };
  await sidePanel.locator('#clearManualAnnotations').click();
  await sidePanel.locator('#clearManualDialog[open]').waitFor({ state: 'visible' });
  await sidePanel.locator('#confirmClearManual').click();
  await fixture.waitForFunction(() =>
    document.querySelectorAll('.sci-manual-highlight').length === 0
  );
  await sidePanel.waitForFunction(() =>
    /本文手动标注 0 条/.test(
      document.getElementById('manualAnnotationSummary')?.textContent || ''
    ) && document.getElementById('clearManualAnnotations')?.disabled === true
  );
  const manualAnnotationLifecycleQa = {
    marksAfterConfirm: await fixture.locator('.sci-manual-highlight').count(),
    annotationsAfterConfirm: await worker.evaluate(async tabId => {
      const response = await chrome.tabs.sendMessage(tabId, {
        action: 'prepareManualAnnotations'
      });
      return response?.annotationCount || 0;
    }, fixtureTab.id)
  };

  await fixture.bringToFront();
  await sidePanel.locator('[data-workspace-target="highlights"]').click();
  await sidePanel.locator('[data-workspace-view="highlights"]').waitFor({ state: 'visible' });
  await sidePanel.locator('#exportCurrentArticleArchive').waitFor({ state: 'visible' });
  const archiveControlFixture = await sidePanel.evaluate(async () =>
    (await getCurrentArticleArchiveFromTab()).archive);
  await sidePanel.evaluate(archiveValue => {
    globalThis.__sciQaArchiveControlFixture = archiveValue;
    globalThis.__sciQaArchiveOriginalSendLlmMessage = sendLlmMessage;
    globalThis.__sciQaArchiveOriginalDownloadBlob = downloadBlob;
    globalThis.__sciQaArchiveDownloadCapture = null;
    downloadBlob = (blob, filename) => {
      globalThis.__sciQaArchiveDownloadCapture = blob.text().then(text => ({
        filename,
        text
      }));
    };
    sendLlmMessage = async message => {
      if (message?.type === 'ARTICLE_ARCHIVE_SAVE') {
        return { saved: true, queued: true, relativePath: 'articles/qa.json' };
      }
      if (message?.type === 'ARTICLE_ARCHIVE_LOAD') {
        return { archive: message.archive || globalThis.__sciQaArchiveControlFixture };
      }
      return globalThis.__sciQaArchiveOriginalSendLlmMessage(message);
    };
  }, archiveControlFixture);
  await sidePanel.locator('#exportCurrentArticleArchive').click();
  await sidePanel.waitForFunction(() => Boolean(globalThis.__sciQaArchiveDownloadCapture));
  const articleArchiveCapture = await sidePanel.evaluate(() =>
    globalThis.__sciQaArchiveDownloadCapture);
  const articleArchivePath = path.join(outputDir, articleArchiveCapture.filename);
  fs.writeFileSync(articleArchivePath, articleArchiveCapture.text, 'utf8');
  const articleArchiveExport = {
    filename: articleArchiveCapture.filename,
    path: articleArchivePath,
    bytes: Buffer.byteLength(articleArchiveCapture.text, 'utf8'),
    bundle: JSON.parse(articleArchiveCapture.text)
  };
  await sidePanel.locator('#importCurrentArticleArchive').setInputFiles(
    articleArchiveExport.path
  );
  await sidePanel.waitForFunction(() =>
    /上次的高亮、备注与 AI 分析结果已恢复/.test(
      document.getElementById('statusMessage')?.textContent || ''
    ) && document.getElementById('importCurrentArticleArchive')?.value === ''
  );
  await sidePanel.evaluate(() => setArticleArchivePrompt({
    found: true,
    savedAt: new Date().toISOString(),
    annotationCount: 0,
    hasLlmAnalysis: false,
    hasReviewOutline: false,
    figureCount: 0
  }));
  await sidePanel.locator('#articleArchivePrompt').waitFor({ state: 'visible' });
  await sidePanel.locator('#reanalyzeArticle').click();
  await sidePanel.waitForFunction(async () =>
    (await readArticleArchivePromptDecision())?.decision === 'skipped'
  );
  const archiveReanalyzeQa = await sidePanel.evaluate(async () => ({
    promptHidden: document.getElementById('articleArchivePrompt')?.hidden === true,
    analysisActive:
      document.querySelector('[data-workspace-view="highlights"]')?.hidden === false &&
      document.getElementById('highlightControls')?.open === true,
    status: document.getElementById('statusMessage')?.textContent || '',
    rememberedDecision: (await readArticleArchivePromptDecision())?.decision || ''
  }));
  await sidePanel.evaluate(() => setArticleArchivePrompt({
    found: true,
    savedAt: new Date().toISOString(),
    annotationCount: 0,
    hasLlmAnalysis: false,
    hasReviewOutline: false,
    figureCount: 0
  }));
  await sidePanel.locator('#loadArticleArchive').click();
  await sidePanel.waitForFunction(() =>
    /上次的高亮、备注与 AI 分析结果已恢复/.test(
      document.getElementById('statusMessage')?.textContent || ''
    ) && document.getElementById('articleArchivePrompt')?.hidden === true
  );
  const archiveReentryQa = await sidePanel.evaluate(async () => {
    currentWorkspaceSnapshot = {
      ...(currentWorkspaceSnapshot || {}),
      chat: {
        ...(currentWorkspaceSnapshot?.chat || {}),
        totalTurns: 1
      }
    };
    setArticleArchivePrompt({
      found: true,
      savedAt: new Date().toISOString(),
      annotationCount: 1,
      hasLlmAnalysis: true,
      hasReviewOutline: false,
      figureCount: 0
    });
    const hadResults = workspaceAlreadyHasArticleResults();
    await probeCurrentArticleArchive();
    return {
      hadResults,
      promptHidden: document.getElementById('articleArchivePrompt')?.hidden === true,
      decision: (await readArticleArchivePromptDecision())?.decision || ''
    };
  });
  const articleArchiveControlsQa = await sidePanel.evaluate(() => {
    const result = {
      importInputCleared:
        document.getElementById('importCurrentArticleArchive')?.value === '',
      loadPromptHidden: document.getElementById('articleArchivePrompt')?.hidden === true,
      loadStatus: document.getElementById('statusMessage')?.textContent || ''
    };
    sendLlmMessage = globalThis.__sciQaArchiveOriginalSendLlmMessage;
    downloadBlob = globalThis.__sciQaArchiveOriginalDownloadBlob;
    delete globalThis.__sciQaArchiveOriginalSendLlmMessage;
    delete globalThis.__sciQaArchiveOriginalDownloadBlob;
    delete globalThis.__sciQaArchiveDownloadCapture;
    delete globalThis.__sciQaArchiveControlFixture;
    return result;
  });
  articleArchiveControlsQa.exportKind = articleArchiveExport.bundle.kind;
  articleArchiveControlsQa.exportSchemaVersion =
    articleArchiveExport.bundle.schemaVersion;
  articleArchiveControlsQa.exportBytes = articleArchiveExport.bytes;
  articleArchiveControlsQa.exportContainsSecrets =
    /apiKey|authorization|data:image|pageHtml/i.test(
      JSON.stringify(articleArchiveExport.bundle)
    );
  articleArchiveControlsQa.reanalyze = archiveReanalyzeQa;
  articleArchiveControlsQa.reentry = archiveReentryQa;

  const preSwitchTraceResponse = await worker.evaluate(
    tabId => chrome.tabs.sendMessage(tabId, { action: 'buildAdapterDiagnosticBundle' }),
    fixtureTab.id
  );
  const preSwitchExtractionRuns = (preSwitchTraceResponse?.bundle?.trace || []).filter(record =>
    record.stage === 'extract_article' && record.status === 'complete' &&
    record.cacheHit !== true
  ).length;
  const secondFixture = await context.newPage();
  secondFixture.on('pageerror', error => pageErrors.push(`fixture-2: ${error.message}`));
  secondFixture.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(`fixture-2: ${message.text()}`);
  });
  const secondUrl = 'https://example.org/oa-translational-review';
  const secondHtml = articleFixture()
    .replaceAll('OA mechanism review test', 'OA translational review test')
    .replaceAll('oa-mechanism-review', 'oa-translational-review');
  await secondFixture.route(secondUrl, route => route.fulfill({
    status: 200,
    contentType: 'text/html; charset=utf-8',
    body: secondHtml
  }));
  const untouchedStartedAt = Date.now();
  await secondFixture.goto(secondUrl, { waitUntil: 'domcontentloaded' });
  await sidePanel.waitForFunction(() =>
    /尚未激活/.test(document.getElementById('sidePanelDocumentStatusText')?.textContent || '')
  );
  const untouchedReadyMs = Date.now() - untouchedStartedAt;
  const untouchedRevision = await secondFixture.evaluate(() =>
    document.documentElement.dataset.sciLlmContentRevision || '');
  const currentTabs = await worker.evaluate(() => chrome.tabs.query({}));
  const secondTab = currentTabs.find(tab => tab.url?.startsWith(secondUrl));
  if (!secondTab?.id) throw new Error('Unable to resolve second fixture tab');
  const untouchedSidePanelOptions = await worker.evaluate(
    tabId => chrome.sidePanel.getOptions({ tabId }), secondTab.id
  );

  await worker.evaluate(async tab => {
    const activation = await SciLLM.markTabActivated(chrome.storage.session, tab);
    await chrome.runtime.sendMessage({ type: 'PANEL_TAB_ACTIVATED', activation })
      .catch(() => {});
    await chrome.tabs.sendMessage(tab.id, { action: 'disarmSidePanelRestore' })
      .catch(() => {});
  }, secondTab);
  await secondFixture.bringToFront();
  await sidePanel.waitForFunction(() =>
    document.getElementById('sidePanelPaperTitle')?.textContent ===
      'OA translational review test'
  );
  await secondFixture.waitForFunction(() =>
    document.documentElement.dataset.sciLlmContentRevision ===
      '1.0.1-ai-reliability-v2', null, { timeout: 5000 }
  );
  const secondActivatedRevision = await secondFixture.evaluate(() =>
    document.documentElement.dataset.sciLlmContentRevision || '');
  const activatedSidePanelOptions = await worker.evaluate(
    tabId => chrome.sidePanel.getOptions({ tabId }), secondTab.id
  );

  const switchBackStartedAt = Date.now();
  await fixture.bringToFront();
  await sidePanel.waitForFunction(() =>
    document.getElementById('sidePanelPaperTitle')?.textContent ===
      'OA mechanism review test'
  );
  const switchBackMs = Date.now() - switchBackStartedAt;
  await fixture.waitForTimeout(80);
  const restoreHandleVisible = await fixture.locator('#sci-side-panel-restore').isVisible()
    .catch(() => false);
  if (restoreHandleVisible) {
    await fixture.locator('h1').click();
    await fixture.locator('#sci-side-panel-restore').waitFor({ state: 'detached', timeout: 1200 });
  }
  const restoreHandleCleared = await fixture.locator('#sci-side-panel-restore').count() === 0;
  const traceResponse = await worker.evaluate(
    tabId => chrome.tabs.sendMessage(tabId, { action: 'buildAdapterDiagnosticBundle' }),
    fixtureTab.id
  );
  const actualExtractionRuns = (traceResponse?.bundle?.trace || []).filter(record =>
    record.stage === 'extract_article' && record.status === 'complete' &&
    record.cacheHit !== true
  ).length;
  const switchExtractionRuns = Math.max(0, actualExtractionRuns - preSwitchExtractionRuns);
  const restoredSidePanelOptions = await worker.evaluate(
    tabId => chrome.sidePanel.getOptions({ tabId }), fixtureTab.id
  );
  const multiTab = {
    untouchedRevision,
    untouchedReadyMs,
    untouchedSidePanelEnabled: untouchedSidePanelOptions.enabled,
    activatedSidePanelEnabled: activatedSidePanelOptions.enabled,
    restoredSidePanelEnabled: restoredSidePanelOptions.enabled,
    secondActivatedRevision,
    switchBackMs,
    restoreHandleVisible,
    restoreHandleCleared,
    activeTitleAfterSwitchBack: await sidePanel.locator('#sidePanelPaperTitle').textContent(),
    actualExtractionRuns,
    preSwitchExtractionRuns,
    switchExtractionRuns
  };
  reportQaStage(
    `tab-switch restore checked (fallback visible: ${restoreHandleVisible ? 'yes' : 'no'})`
  );

  const awayUrl = 'https://example.org/non-article-navigation-target';
  await fixture.route(awayUrl, route => route.fulfill({
    status: 200,
    contentType: 'text/html; charset=utf-8',
    body: '<!doctype html><title>Ordinary page</title><main><h1>Ordinary page</h1></main>'
  }));
  await fixture.goto(awayUrl, { waitUntil: 'domcontentloaded' });
  let awaySidePanelOptions = null;
  const awayStartedAt = Date.now();
  while (Date.now() - awayStartedAt < 3000) {
    awaySidePanelOptions = await worker.evaluate(
      tabId => chrome.sidePanel.getOptions({ tabId }), fixtureTab.id
    );
    if (awaySidePanelOptions.enabled === true) break;
    await fixture.waitForTimeout(40);
  }
  const activationWhileAway = await worker.evaluate(async ({ tabId, url }) => ({
    record: await SciLLM.readTabActivation(chrome.storage.session, tabId),
    awayActivated: await SciLLM.isTabActivated(chrome.storage.session, { id: tabId, url })
  }), { tabId: fixtureTab.id, url: awayUrl });
  await fixture.goBack({ waitUntil: 'domcontentloaded' });
  await fixture.waitForFunction(() =>
    document.documentElement.dataset.sciLlmContentRevision ===
      '1.0.1-ai-reliability-v2', null, { timeout: 5000 }
  );
  let returnedSidePanelOptions = null;
  const returnStartedAt = Date.now();
  while (Date.now() - returnStartedAt < 3000) {
    returnedSidePanelOptions = await worker.evaluate(
      tabId => chrome.sidePanel.getOptions({ tabId }), fixtureTab.id
    );
    if (returnedSidePanelOptions.enabled === true) break;
    await fixture.waitForTimeout(40);
  }
  const returnRestoreHandleVisible = await fixture.locator(
    '#sci-side-panel-restore'
  ).isVisible().catch(() => false);
  const returnRestoreHandleCleared =
    await fixture.locator('#sci-side-panel-restore').count() === 0;
  await sidePanel.waitForFunction(() =>
    document.getElementById('sidePanelPaperTitle')?.textContent ===
      'OA mechanism review test'
  );
  const activationAfterReturn = await worker.evaluate(async tabId => {
    const record = await SciLLM.readTabActivation(chrome.storage.session, tabId);
    return {
      documentUrls: (record?.documents || []).map(document => document.url),
      currentActivated: await SciLLM.isTabActivated(chrome.storage.session, {
        id: tabId,
        url: 'https://example.org/oa-mechanism-review'
      })
    };
  }, fixtureTab.id);
  await fixture.reload({ waitUntil: 'domcontentloaded' });
  await fixture.waitForFunction(() =>
    document.documentElement.dataset.sciLlmContentRevision ===
      '1.0.1-ai-reliability-v2', null, { timeout: 5000 }
  );
  await sidePanel.waitForFunction(() =>
    document.getElementById('sidePanelPaperTitle')?.textContent ===
      'OA mechanism review test'
  );
  const refreshedSidePanelOptions = await worker.evaluate(
    tabId => chrome.sidePanel.getOptions({ tabId }), fixtureTab.id
  );
  const navigationLifecycleQa = {
    awayKeptOpen: awaySidePanelOptions?.enabled === true,
    awayNotActivated: activationWhileAway.awayActivated === false,
    activationPreservedWhileAway: (activationWhileAway.record?.documents || [])
      .some(document => document.url === 'https://example.org/oa-mechanism-review'),
    returnedEnabled: returnedSidePanelOptions?.enabled === true,
    returnRestoreHandleVisible,
    returnRestoreHandleCleared,
    returnedActivated: activationAfterReturn.currentActivated === true,
    rememberedDocumentUrls: activationAfterReturn.documentUrls,
    refreshContentInjected: await fixture.evaluate(() =>
      document.documentElement.dataset.sciLlmContentRevision ===
        '1.0.1-ai-reliability-v2'),
    refreshSidePanelEnabled: refreshedSidePanelOptions.enabled === true,
    titleAfterRefresh: await sidePanel.locator('#sidePanelPaperTitle').textContent()
  };

  await fixture.bringToFront();
  const [diagnosticDownload] = await Promise.all([
    sidePanel.waitForEvent('download', { timeout: 30000 }),
    sidePanel.evaluate(() => exportAdapterDiagnosticBundle())
  ]);
  const firstDiagnostic = await readDiagnosticDownload(diagnosticDownload);

  const patchResult = await worker.evaluate(async tabId => {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'ISOLATED',
      func: () => {
        globalThis.__sciDiagnosticOriginalExtractArticle = SciLLM.extractArticle;
        SciLLM.extractArticle = () => {
          const error = new Error('FORCED_EXTRACTOR_FAILURE_FOR_DIAGNOSTIC');
          error.code = 'FORCED_EXTRACTOR_FAILURE';
          throw error;
        };
        return true;
      }
    });
    const response = await chrome.tabs.sendMessage(tabId, {
      action: 'extractArticleForLLM',
      forceRefresh: true
    });
    return { patched: result === true, response };
  }, fixtureTab.id);

  await fixture.bringToFront();
  const failedConnectionUi = await sidePanel.evaluate(async () => {
    const originalMode = analysisMode;
    const originalSettings = llmSettingsState;
    analysisMode = 'llm';
    llmSettingsState = { ...(llmSettingsState || {}), effectiveMode: 'llm' };
    prepareState = 'idle';
    await initializeCurrentArticle({ retry: true });
    const result = {
      status: document.getElementById('sidePanelDocumentStatusText')?.textContent || '',
      retryVisible: !document.getElementById('retryArticlePreparation')?.hidden
    };
    analysisMode = originalMode;
    llmSettingsState = originalSettings;
    return result;
  });

  await fixture.bringToFront();
  const [failureDiagnosticDownload] = await Promise.all([
    sidePanel.waitForEvent('download', { timeout: 30000 }),
    sidePanel.evaluate(() => exportAdapterDiagnosticBundle())
  ]);
  const failureDiagnostic = await readDiagnosticDownload(failureDiagnosticDownload);

  await worker.evaluate(async tabId => {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'ISOLATED',
      func: () => {
        if (globalThis.__sciDiagnosticOriginalExtractArticle) {
          SciLLM.extractArticle = globalThis.__sciDiagnosticOriginalExtractArticle;
          delete globalThis.__sciDiagnosticOriginalExtractArticle;
        }
      }
    });
  }, fixtureTab.id);

  await fixture.bringToFront();
  const archive = await sidePanel.evaluate(async () =>
    (await getCurrentArticleArchiveFromTab()).archive);
  archive.workspace.figureWorkspace = figureWorkspaceFixture();
  archive.workspace.figures = archive.workspace.figureWorkspace.figures;
  const archiveText = JSON.stringify(archive);
  const restored = await sidePanel.evaluate(
    value => applyLoadedArticleArchive(value, { imported: true }),
    archive
  );

  await worker.evaluate(async tabId => {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'ISOLATED',
      func: async () => {
        await chrome.runtime.sendMessage({
          type: 'ARTICLE_NOTIFICATION',
          message: 'Figure 1：Panel A 解读已完成',
          level: 'success',
          timestamp: Date.now() - 1000
        });
        await chrome.runtime.sendMessage({
          type: 'ARTICLE_NOTIFICATION',
          message: 'Figure 1：Panel B 解读已完成',
          level: 'success',
          timestamp: Date.now()
        });
      }
    });
  }, fixtureTab.id);
  await sidePanel.waitForFunction(() =>
    /Panel B 解读已完成/.test(
      document.getElementById('sidePanelNotificationLatest')?.textContent || ''
    )
  );
  await sidePanel.locator('#sidePanelNotificationSummary').click();
  await sidePanel.waitForFunction(() => {
    const center = document.getElementById('sidePanelNotificationCenter');
    return center?.open === true && !center.classList.contains('has-unread');
  });
  const notificationCenterQa = await sidePanel.evaluate(() => ({
    open: document.getElementById('sidePanelNotificationCenter')?.open === true,
    latest: document.getElementById('sidePanelNotificationLatest')?.textContent || '',
    latestTime: document.getElementById('sidePanelNotificationTime')?.textContent || '',
    history: Array.from(document.querySelectorAll(
      '#sidePanelNotificationHistory .side-panel-notification-item'
    )).map(item => item.textContent?.trim() || ''),
    unreadCleared:
      !document.getElementById('sidePanelNotificationCenter')?.classList.contains('has-unread')
  }));
  const notificationPageOverlayCount = await fixture.locator('#sci-llm-status').count();
  await sidePanel.locator('#sidePanelNotificationSummary').click();

  const figureIncrementalQa = await sidePanel.evaluate(completeWorkspace => {
    const originalWorkspaceSnapshot = currentWorkspaceSnapshot;
    const originalFigureAnalysisState = figureAnalysisState;
    const originalFigureProgressRenderSignature = figureProgressRenderSignature;
    const pendingWorkspace = structuredClone(completeWorkspace);
    pendingWorkspace.status = {
      running: true,
      paused: false,
      phase: 'figure_panel_batch_complete',
      figureProgress: [{
        figureId: 'figure-1',
        figureLabel: 'Figure 1',
        phase: 'figure_panel_batch_complete',
        running: true,
        expectedPanels: ['A', 'B'],
        expectedPanelCount: 2,
        recognizedPanelCount: 2,
        batchRecognizedPanelCount: 2,
        unexpectedPanels: ['D', 'E'],
        ignoredUnexpectedPanelCount: 2,
        completedPanelBatches: 1,
        totalPanelBatches: 2,
        completedFigures: 0,
        totalFigures: 3,
        startedAt: Date.now() - 5000
      }]
    };
    pendingWorkspace.figures = pendingWorkspace.figures.map(figure => ({
      ...figure,
      standard: null,
      deep: null,
      standardError: '',
      deepError: ''
    }));
    const completeFirstFigure = completeWorkspace.figures[0];
    pendingWorkspace.figures[0].standard = {
      ...completeFirstFigure.standard,
      panels: completeFirstFigure.standard.panels.slice(0, 2),
      panelCoverage: {
        expectedPanels: ['A', 'B', 'C'],
        returnedPanels: ['A', 'B'],
        missingPanels: ['C'],
        unexpectedPanels: ['D', 'E'],
        ignoredUnexpectedPanelCount: 2
      }
    };
    currentWorkspaceSnapshot = {
      ...currentWorkspaceSnapshot,
      figures: pendingWorkspace
    };
    figureProgressRenderSignature = '';
    applyFigureAnalysisProgress(pendingWorkspace.status, false);
    const cards = Array.from(document.querySelectorAll('.workspace-figure-card'));
    const firstProgressText = cards[0]
      ?.querySelector('.workspace-figure-progress')?.textContent || '';
    const quickNavItem = document.querySelector('.figure-quick-nav-item');
    quickNavItem?.classList.add('show-panels');
    const elapsedOnlyStatus = structuredClone(pendingWorkspace.status);
    elapsedOnlyStatus.figureProgress[0].elapsedSeconds = 8;
    applyFigureAnalysisProgress(elapsedOnlyStatus, false);
    const quickNavAfterElapsed = document.querySelector('.figure-quick-nav-item');
    const elapsedText = cards[0]
      ?.querySelector('[data-figure-elapsed="true"]')?.textContent || '';
    const stablePollingKeepsQuickNavNode =
      quickNavItem === quickNavAfterElapsed && quickNavItem?.isConnected === true;
    const stablePollingKeepsHoverState =
      quickNavAfterElapsed?.classList.contains('show-panels') === true;
    const changedStatus = structuredClone(elapsedOnlyStatus);
    changedStatus.figureProgress[0].batchRecognizedPanelCount = 1;
    applyFigureAnalysisProgress(changedStatus, false);
    const result = {
      cardCount: cards.length,
      summaries: cards.map(card => card.querySelector('summary')?.textContent?.trim() || ''),
      firstHasPartialResult: Boolean(cards[0]?.querySelector('.workspace-figure-field')),
      firstPanelCatalogSize:
        cards[0]?.querySelectorAll('.workspace-figure-panel-card').length || 0,
      firstAnalyzedPanels: Array.from(
        cards[0]?.querySelectorAll('.workspace-panel-analyze') || []
      ).filter(button => button.textContent?.includes('重新解读')).length,
      secondHasResult: Boolean(cards[1]?.querySelector('.workspace-figure-field')),
      firstProgressText,
      stablePollingKeepsQuickNavNode,
      stablePollingKeepsHoverState,
      elapsedUpdatedWithoutRebuild: elapsedText === '已用时 8 秒',
      changedProgressRebuilds: quickNavAfterElapsed?.isConnected === false,
      reportsBatchCount: /本批有效 Panel：2/.test(firstProgressText),
      reportsIgnoredPanels: /已忽略模型重复返回的 2 个批次外 Panel（D、E）/.test(firstProgressText)
    };
    currentWorkspaceSnapshot = originalWorkspaceSnapshot;
    figureAnalysisState = originalFigureAnalysisState;
    figureProgressRenderSignature = originalFigureProgressRenderSignature;
    renderFigureWorkspaceSnapshot(currentWorkspaceSnapshot);
    return result;
  }, figureWorkspaceFixture());

  // A real Edge side panel never becomes the active browser tab. Keep the
  // article active while exercising the panel's navigation handler.
  await fixture.bringToFront();
  await sidePanel.locator('[data-workspace-target="navigation"]').click();
  await sidePanel.waitForFunction(() =>
    document.querySelector('[data-workspace-view="navigation"]')?.classList.contains('active'));
  await sidePanel.locator('#refreshArticleNavigation').click();
  await sidePanel.waitForFunction(() =>
    document.querySelectorAll('#articleNavigationTree details.workspace-tree-node').length > 0
  );
  await sidePanel.locator('#expandAllOutlineLevels').click();
  const expandedOutlineQa = await sidePanel.evaluate(() => {
    const branches = Array.from(document.querySelectorAll(
      '#articleNavigationTree details.workspace-tree-node:not([data-leaf="true"])'
    ));
    return {
      branchCount: branches.length,
      openCount: branches.filter(details => details.open).length
    };
  });
  await sidePanel.locator('#collapseAllOutlineLevels').click();
  const navigationControlsQa = await sidePanel.evaluate(expanded => ({
    branchCount: expanded.branchCount,
    expandedAll: expanded.branchCount > 0 && expanded.openCount === expanded.branchCount,
    openAfterCollapse: document.querySelectorAll(
      '#articleNavigationTree details.workspace-tree-node[open]'
    ).length,
    refreshStatus: document.getElementById('articleNavigationStatus')?.textContent || ''
  }), expandedOutlineQa);
  const navigationStatus = await sidePanel.locator('#articleNavigationStatus').textContent();
  await sidePanel.screenshot({
    path: path.join(outputDir, 'edge-native-side-panel-extension.png'),
    fullPage: true
  });

  await sidePanel.evaluate(async () => {
    document.querySelector('[data-workspace-target="figures"]')?.click();
    await refreshArticleWorkspace();
  });
  await sidePanel.locator('.workspace-figure-card').first().locator('summary').first().click();
  await sidePanel.locator('.workspace-figure-panel-card').first().locator('summary').first().click();
  await sidePanel.locator('.workspace-panel-ask').first().evaluate(button => {
    button.disabled = false;
    button.click();
  });
  await sidePanel.locator('.workspace-panel-followup-custom textarea').first()
    .fill('Why does this Panel use this comparison?');
  await sidePanel.evaluate(() => renderFigureWorkspaceSnapshot(currentWorkspaceSnapshot));
  const quickNavPreHover = await sidePanel.evaluate(async () => {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const view = document.querySelector('[data-workspace-view="figures"]');
    const nav = document.getElementById('figureQuickNav');
    const marker = document.querySelector('.figure-quick-nav-marker');
    const markerRect = marker?.getBoundingClientRect();
    const navRect = nav?.getBoundingClientRect();
    const markerStyle = marker ? getComputedStyle(marker) : null;
    const navStyle = nav ? getComputedStyle(nav) : null;
    return {
      activeWorkspaceView,
      viewHidden: view?.hidden,
      navHidden: nav?.hidden,
      navDisplay: navStyle?.display || '',
      navVisibility: navStyle?.visibility || '',
      navRect: navRect ? { width: navRect.width, height: navRect.height } : null,
      markerDisplay: markerStyle?.display || '',
      markerVisibility: markerStyle?.visibility || '',
      markerOpacity: markerStyle?.opacity || '',
      markerRect: markerRect ? {
        width: markerRect.width,
        height: markerRect.height,
        top: markerRect.top,
        bottom: markerRect.bottom
      } : null,
      markerVisible: marker?.checkVisibility?.({
        checkOpacity: true,
        checkVisibilityCSS: true
      }) === true,
      figureCount: currentWorkspaceSnapshot?.figures?.figures?.length || 0
    };
  });
  if (!quickNavPreHover.markerVisible) {
    throw new Error(`Figure quick navigation was hidden before hover: ${JSON.stringify(quickNavPreHover)}`);
  }
  await sidePanel.locator('.figure-quick-nav-marker').first().hover({ force: true });
  await sidePanel.waitForFunction(() => {
    const popover = document.querySelector(
      '.figure-quick-nav-item.show-panels .figure-quick-nav-panel-popover'
    );
    const style = popover ? getComputedStyle(popover) : null;
    return style?.opacity === '1' && style.visibility === 'visible';
  });
  const figureVisualQa = await sidePanel.evaluate(() => {
    const panelPopover = document.querySelector(
      '.figure-quick-nav-item.show-panels .figure-quick-nav-panel-popover'
    );
    const panelPopoverStyle = panelPopover ? getComputedStyle(panelPopover) : null;
    const panelPopoverRect = panelPopover?.getBoundingClientRect();
    const panelButtonElements = panelPopover
      ? Array.from(panelPopover.querySelectorAll('.figure-quick-nav-panel-button'))
      : [];
    const panelButtonRects = panelButtonElements.map(button => button.getBoundingClientRect());
    const inputBasisElements = Array.from(document.querySelectorAll(
      '.workspace-figure-field, .workspace-panel-input-basis'
    ));
    const inputBasisDetails = inputBasisElements.map(element => ({
      selector: element.className,
      text: element.textContent?.trim() || '',
      visible: element.checkVisibility?.({
        checkOpacity: true,
        checkVisibilityCSS: true
      }) !== false
    }));
    return {
      figureOpen: document.querySelector('.workspace-figure-card')?.open === true,
      panelOpen: document.querySelector('.workspace-figure-panel-card')?.open === true,
      followupOpen: document.querySelector('.workspace-panel-followup')?.hidden === false,
      draftPreserved: document.querySelector('.workspace-panel-followup-custom textarea')?.value ===
        'Why does this Panel use this comparison?',
      inputBasisDetails,
      inputBasisVisible: inputBasisDetails.some(item => item.visible &&
        /本次(?:解读)?依据|图注与相关正文|最佳单张\s*Figure\s*图/iu.test(item.text)),
      quickNavVisible: document.getElementById('figureQuickNav')?.hidden === false,
      figureMarkers: document.querySelectorAll('.figure-quick-nav-marker').length,
      figureLabels: document.querySelectorAll('.figure-quick-nav-label').length,
      panelButtons: document.querySelectorAll('.figure-quick-nav-panel-button').length,
      panelPopoverOpen: Boolean(panelPopover),
      panelOrder: panelButtonElements.map(button => button.textContent?.trim() || ''),
      panelSingleColumn: panelPopoverStyle?.display === 'grid' && panelButtonRects.every((rect, index) =>
        index === 0 || (
          Math.abs(rect.left - panelButtonRects[0].left) < 1 &&
          rect.top >= panelButtonRects[index - 1].bottom
        )),
      panelPopoverVisual: panelPopover ? {
        opacity: panelPopoverStyle.opacity,
        visibility: panelPopoverStyle.visibility,
        width: panelPopoverRect.width,
        left: panelPopoverRect.left,
        right: panelPopoverRect.right
      } : null,
      collapsedResultSections: Array.from(
        document.querySelectorAll('.workspace-figure-result-section')
      ).every(section => section.open === false)
    };
  });
  const panelFollowupAnswerQa = await sidePanel.evaluate(async () => {
    const figure = currentWorkspaceSnapshot?.figures?.figures?.[0];
    if (!figure) return { rendered: false };
    const panelId = 'A';
    const followupKey = panelWorkspaceKey(figure.figureId, panelId);
    figure.panelFollowups ||= {};
    figure.panelFollowups[panelId] = {
      panel: panelId,
      topics: ['grouping'],
      customQuestion: 'Why does this Panel use this comparison?',
      answer: 'The comparison isolates the treatment effect against the matched control.',
      claimBoundary: 'This answer is limited to the supplied Panel evidence.',
      inputBasis: { inputMode: 'figure_image', pixelsSupplied: true, imageWidth: 960,
        imageHeight: 720, attempts: 1 }
    };
    const draft = getPanelFollowupDraft(figure.figureId, panelId);
    draft.open = true;
    figureExpansionState.set(figure.figureId, true);
    figurePanelExpansionState.set(followupKey, true);
    panelFollowupRevealKey = followupKey;
    renderFigureWorkspaceSnapshot(currentWorkspaceSnapshot);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const revealed = revealPanelFollowupAnswer(followupKey);
    panelFollowupRevealKey = '';
    await new Promise(resolve => setTimeout(resolve, 90));
    const answer = document.querySelector(`[data-panel-followup-answer="${CSS.escape(followupKey)}"]`);
    const followup = answer?.closest('.workspace-panel-followup');
    const details = answer?.closest('.workspace-figure-panel-card');
    const inputBasis = answer?.querySelector('.workspace-panel-input-basis');
    const view = document.querySelector('[data-workspace-view="figures"]');
    const answerRect = answer?.getBoundingClientRect();
    const viewRect = view?.getBoundingClientRect();
    return {
      rendered: Boolean(answer),
      revealed,
      followupVisible: followup?.hidden === false,
      panelOpen: details?.open === true,
      answerText: answer?.textContent || '',
      inputBasisSelector: inputBasis?.className || '',
      inputBasisText: inputBasis?.textContent?.trim() || '',
      inputBasisVisible: inputBasis?.checkVisibility?.({
        checkOpacity: true,
        checkVisibilityCSS: true
      }) === true,
      statusText: followup?.querySelector('.workspace-panel-followup-status')?.textContent || '',
      focused: document.activeElement === answer,
      inViewport: Boolean(answerRect && viewRect && answerRect.bottom >= viewRect.top &&
        answerRect.top <= viewRect.bottom)
    };
  });
  await sidePanel.screenshot({
    path: path.join(outputDir, 'edge-figure-interaction-controls.png'),
    fullPage: true
  });
  // Let the answer reveal's deliberate smooth scroll finish before measuring a
  // separate pointer gesture against the fixed quick-navigation rail.
  await sidePanel.waitForTimeout(450);
  await sidePanel.locator('.figure-quick-nav-marker').nth(1).hover({ force: true });
  await sidePanel.waitForTimeout(25);
  const quickNavSwitchQa = await sidePanel.evaluate(() => ({
    expandedFigureIds: Array.from(
      document.querySelectorAll('.figure-quick-nav-item.show-panels')
    ).map(item => item.dataset.figureId),
    firstFigureStillExpanded: document.querySelector(
      '.figure-quick-nav-item[data-figure-id="figure-1"]'
    )?.classList.contains('show-panels') === true
  }));
  await sidePanel.evaluate(() => document.activeElement?.blur?.());
  await sidePanel.locator('#sidePanelPaperTitle').hover({ force: true });
  await sidePanel.waitForTimeout(150);
  const quickNavExitQa = await sidePanel.evaluate(() => ({
    expandedItems: document.querySelectorAll('.figure-quick-nav-item.show-panels').length,
    hoveredItems: Array.from(document.querySelectorAll('.figure-quick-nav-item'))
      .filter(item => item.matches(':hover')).length,
    focusedItems: Array.from(document.querySelectorAll('.figure-quick-nav-item'))
      .filter(item => item.matches(':focus-within')).length
  }));
  await sidePanel.locator('#expandAllFigureLevels').click();
  const expandedFigureControlsQa = await sidePanel.evaluate(() => ({
    totalFigures: document.querySelectorAll('.workspace-figure-card').length,
    openFigures: document.querySelectorAll('.workspace-figure-card[open]').length
  }));
  await sidePanel.locator('#collapseAllFigureLevels').click();
  const collapsedFigureControlsQa = await sidePanel.evaluate(() => ({
    openFigures: document.querySelectorAll('.workspace-figure-card[open]').length,
    openPanels: document.querySelectorAll('.workspace-figure-panel-card[open]').length
  }));
  await sidePanel.locator('#refreshFigureInventory').click();
  await sidePanel.waitForFunction(() =>
    document.querySelectorAll('.workspace-figure-card').length === 3
  );
  const figureToolbarControlsQa = await sidePanel.evaluate(
    ({ expanded, collapsed }) => ({
      totalFigures: expanded.totalFigures,
      expandedAll:
        expanded.totalFigures > 0 && expanded.openFigures === expanded.totalFigures,
      collapsedFigures: collapsed.openFigures,
      collapsedPanels: collapsed.openPanels,
      refreshedFigures: document.querySelectorAll('.workspace-figure-card').length
    }),
    { expanded: expandedFigureControlsQa, collapsed: collapsedFigureControlsQa }
  );
  const taskControlButtonsQa = await sidePanel.evaluate(async () => {
    const originalControlActiveAnalysis = controlActiveAnalysis;
    const calls = [];
    controlActiveAnalysis = async (scope, command) => {
      calls.push(`${scope}:${command}`);
      if (scope === 'highlight') {
        highlightTaskState = {
          ...highlightTaskState,
          running: command !== 'cancel',
          paused: command === 'pause' ? true : command === 'resume' ? false
            : highlightTaskState.paused,
          cancelled: command === 'cancel'
        };
        updateHighlightTaskControls();
      } else {
        figureAnalysisState = {
          ...figureAnalysisState,
          running: command !== 'cancel',
          paused: command === 'pause' ? true : command === 'resume' ? false
            : figureAnalysisState.paused,
          phase: command === 'cancel' ? 'cancelled'
            : command === 'pause' ? 'paused' : 'analyzing'
        };
        updateFigureTaskControls();
      }
      return { success: true };
    };
    const settle = () => new Promise(resolve => setTimeout(resolve, 20));
    highlightTaskState = { running: true, paused: false, cancelled: false };
    updateHighlightTaskControls();
    document.getElementById('pauseHighlightAnalysis')?.click();
    await settle();
    document.getElementById('pauseHighlightAnalysis')?.click();
    await settle();
    document.getElementById('cancelHighlightAnalysis')?.click();
    await settle();
    figureAnalysisState = {
      ...figureAnalysisState,
      running: true,
      paused: false,
      phase: 'analyzing'
    };
    updateFigureTaskControls();
    document.getElementById('pauseFigureAnalysis')?.click();
    await settle();
    document.getElementById('pauseFigureAnalysis')?.click();
    await settle();
    figureAnalysisState = {
      ...figureAnalysisState,
      running: true,
      paused: false,
      phase: 'analyzing'
    };
    updateFigureTaskControls();
    document.getElementById('cancelFigureAnalysis')?.click();
    await settle();
    const result = {
      calls,
      highlightControlsHidden:
        document.getElementById('highlightTaskControls')?.hidden === true,
      figureControlsHidden:
        document.getElementById('figureTaskControls')?.hidden === true
    };
    controlActiveAnalysis = originalControlActiveAnalysis;
    highlightTaskState = { running: false, paused: false, cancelled: false };
    figureAnalysisState = {
      ...figureAnalysisState,
      running: false,
      paused: false,
      phase: 'completed'
    };
    updateHighlightTaskControls();
    updateFigureTaskControls();
    return result;
  });

  await sidePanel.evaluate(() => {
    const figureId = 'figure-2';
    document.querySelectorAll(
      `.workspace-figure-panel-card[data-figure-id="${figureId}"]`
    ).forEach(card => {
      card.open = false;
      const panelId = String(card.dataset.panelId || '').toUpperCase();
      if (panelId) figurePanelExpansionState.set(
        panelWorkspaceKey(figureId, panelId), false
      );
    });
    figureQuickNavActiveId = '';
    figureKeyboardShortcutArmed = true;
    document.body.tabIndex = -1;
    document.body.focus();
  });
  await sidePanel.locator('[data-workspace-target="figures"]').hover({ force: true });
  await sidePanel.keyboard.press('2');
  await sidePanel.waitForFunction(() =>
    document.querySelector(
      '.workspace-figure-card[data-figure-id="figure-2"]'
    )?.open === true
  );
  await sidePanel.keyboard.press('ArrowDown');
  await sidePanel.waitForTimeout(150);
  const panelBOpenedOnFirstKey = await sidePanel.evaluate(() =>
    document.querySelector(
      '.workspace-figure-panel-card[data-figure-id="figure-2"][data-panel-id="B"]'
    )?.open === true
  );
  if (!panelBOpenedOnFirstKey) await sidePanel.keyboard.press('ArrowDown');
  await sidePanel.waitForFunction(() =>
    document.querySelector(
      '.workspace-figure-panel-card[data-figure-id="figure-2"][data-panel-id="B"]'
    )?.open === true
  );
  const figureKeyboardQa = await sidePanel.evaluate(() => ({
    activeFigureId: figureQuickNavActiveId,
    openFigures: Array.from(document.querySelectorAll(
      '.workspace-figure-card[open]'
    )).map(item => item.dataset.figureId),
    panelBOpen: document.querySelector(
      '.workspace-figure-panel-card[data-figure-id="figure-2"][data-panel-id="B"]'
    )?.open === true,
    latestNotification:
      document.getElementById('sidePanelNotificationLatest')?.textContent || ''
  }));

  const figureControlReleaseQa = await sidePanel.evaluate(async () => {
    const originalSendTabMessage = sendTabMessage;
    const originalState = structuredClone(figureAnalysisState);
    const staleSnapshot = {
      running: false,
      paused: false,
      phase: 'completed',
      operationId: 'qa-completed-operation',
      figureProgress: [{
        figureId: 'figure-1',
        figureLabel: 'Figure 1',
        phase: 'figure',
        running: true,
        completed: true
      }]
    };
    applyFigureAnalysisProgress(staleSnapshot, false);
    const staleReleased = !hasRunningFigureProgress(figureAnalysisState) &&
      document.getElementById('figureTaskControls')?.hidden === true;

    figureAnalysisState = {
      ...figureAnalysisState,
      running: true,
      paused: false,
      phase: 'analyzing',
      operationId: 'qa-hung-control',
      figureProgress: [{
        figureId: 'figure-1',
        figureLabel: 'Figure 1',
        phase: 'figure_model_processing',
        running: true,
        completed: false,
        failed: false
      }]
    };
    updateFigureButton();
    sendTabMessage = async (tabId, message) => {
      if (message?.action === 'controlLlmOperation') {
        return new Promise(() => {});
      }
      return originalSendTabMessage(tabId, message);
    };
    const controlPromise = controlActiveAnalysis('figure', 'cancel');
    await new Promise(resolve => setTimeout(resolve, 100));
    const immediateRelease = {
      running: hasRunningFigureProgress(figureAnalysisState),
      controlsHidden: document.getElementById('figureTaskControls')?.hidden === true
    };
    const response = await controlPromise;
    const finalRelease = {
      running: hasRunningFigureProgress(figureAnalysisState),
      controlsHidden: document.getElementById('figureTaskControls')?.hidden === true,
      pending: response?.pending === true,
      notification:
        document.getElementById('sidePanelNotificationLatest')?.textContent || ''
    };
    sendTabMessage = originalSendTabMessage;
    figureAnalysisState = originalState;
    applyFigureAnalysisProgress(originalState, false);
    return { staleReleased, immediateRelease, finalRelease };
  });

  const crossFigureProviderSetupQa = await configureQaCrossFigureProvider(
    sidePanel, providerBaseUrl
  );

  await sidePanel.evaluate(() => {
    globalThis.__sciQaOriginalLlmActionSendTabMessage = sendTabMessage;
    globalThis.__sciQaLlmActionCalls = [];
    globalThis.__sciQaOriginalSendTabMessageWithRecovery =
      SciLLM.sendTabMessageWithRecovery;
    globalThis.__sciQaFigureWorkspaceMutationCalls = [];
    SciLLM.sendTabMessageWithRecovery = async (...args) => {
      const response = await globalThis.__sciQaOriginalSendTabMessageWithRecovery(...args);
      const message = args[2] || {};
      if (message.action === 'updateFigureWorkspaceDraft') {
        globalThis.__sciQaFigureWorkspaceMutationCalls.push({
          type: message.mutation?.type || '',
          expectedRevision: message.mutation?.expectedRevision,
          response: response && typeof response === 'object' ? { ...response } : response
        });
      }
      return response;
    };
    sendTabMessage = async (tabId, message) => {
      const action = message?.action || '';
      if ([
        'analyzeFiguresWithLLM',
        'getFigureAnalysisStatus',
        'analyzeCrossFigureLogicWithLLM',
        'analyzeResearchLogicWithLLM',
        'analyzePaperInnovationWithLLM',
        'analyzePaperLimitationsWithLLM',
        'analyzeReviewParagraphWithLLM'
      ].includes(action)) {
        globalThis.__sciQaLlmActionCalls.push({ tabId, action, message: { ...message } });
      }
      if (action === 'analyzeFiguresWithLLM') {
        return {
          success: true,
          analyzedCount: 3,
          failedCount: 0,
          totalCount: 3,
          cacheHits: 1,
          visionFallbacks: 0
        };
      }
      if (action === 'getFigureAnalysisStatus') {
        return {
          success: true,
          status: {
            running: false,
            paused: false,
            phase: 'completed',
            currentFigure: 3,
            totalFigures: 3,
            completedFigures: 3,
            failedFigures: 0,
            figureProgress: []
          }
        };
      }
      if (action === 'analyzeCrossFigureLogicWithLLM') {
        return globalThis.__sciQaOriginalLlmActionSendTabMessage(tabId, message);
      }
      if (action === 'analyzeReviewParagraphWithLLM') {
        return {
          success: true,
          summary: '该段概述了论文的一项核心证据。',
          usage: { inputTokens: 120, outputTokens: 24, totalTokens: 144 }
        };
      }
      return globalThis.__sciQaOriginalLlmActionSendTabMessage(tabId, message);
    };
    analysisMode = 'llm';
    llmSettingsState = {
      ...(llmSettingsState || {}),
      effectiveMode: 'llm',
      llmReady: true,
      settings: llmSettingsState?.settings || {}
    };
    const paragraphs = Array.isArray(currentWorkspaceSnapshot?.paragraphs)
      ? currentWorkspaceSnapshot.paragraphs
      : [];
    preparedDocumentState = {
      documentId: manualAnnotationState.documentId || 'qa-document',
      documentHash: manualAnnotationState.documentHash || 'qa-document-hash',
      studyProfile: { primaryType: 'review', reviewSubtype: 'systematic_review' },
      document: { paragraphs: paragraphs.length ? paragraphs : Array.from({ length: 6 }, (_, index) => ({
        paragraphId: `qa-outline-${index + 1}`,
        text: `QA outline paragraph ${index + 1}`
      })) }
    };
    updateAnalysisModeUi();
    renderCategories();
    updateFigureButton();
    updateReviewOutlineButton();
  });
  await fixture.bringToFront();
  await sidePanel.locator('[data-workspace-target="highlights"]').click();
  if (!await sidePanel.locator('#highlightControls').evaluate(node => node.open)) {
    await sidePanel.locator('#highlightControls > summary').click();
  }
  const fineCategoryDetails = sidePanel.locator('#fineCategoryDetails');
  if (!await fineCategoryDetails.evaluate(element => element.open)) {
    await fineCategoryDetails.locator('summary').click();
  }
  await sidePanel.waitForFunction(() => document.getElementById('fineCategoryDetails')?.open);
  await sidePanel.locator('#moreCategories').click();
  await sidePanel.locator('#moreCategoriesPanel').waitFor({ state: 'visible' });
  const moreCategoriesOpenQa = await sidePanel.evaluate(() => ({
    expanded: document.getElementById('moreCategories')?.getAttribute('aria-expanded'),
    panelVisible: document.getElementById('moreCategoriesPanel')?.hidden === false,
    searchFocused: document.activeElement?.id === 'categorySearch',
    groupCount: document.querySelectorAll('#moreCategoryGroups .more-category-group').length
  }));
  await sidePanel.locator('#moreCategories').click();
  await sidePanel.locator('#moreCategoriesPanel').waitFor({ state: 'hidden' });
  await sidePanel.evaluate(() => {
    globalThis.__sciQaOriginalRestoreViewPreset = queueRestoreViewPreset;
    globalThis.__sciQaRestoreViewCalls = [];
    queueRestoreViewPreset = async targetViewId => {
      globalThis.__sciQaRestoreViewCalls.push(targetViewId);
      return { status: 'refreshed' };
    };
  });
  await sidePanel.locator('#restoreViewPreset').click();
  await sidePanel.waitForFunction(() => globalThis.__sciQaRestoreViewCalls?.length === 1);
  const analysisCategoryControlsQa = await sidePanel.evaluate(openQa => {
    const result = {
      more: openQa,
      moreCollapsed:
        document.getElementById('moreCategories')?.getAttribute('aria-expanded') === 'false' &&
        document.getElementById('moreCategoriesPanel')?.hidden === true,
      restoreCalls: [...globalThis.__sciQaRestoreViewCalls],
      restoreVisible: document.getElementById('restoreViewPreset')?.hidden === false
    };
    queueRestoreViewPreset = globalThis.__sciQaOriginalRestoreViewPreset;
    delete globalThis.__sciQaOriginalRestoreViewPreset;
    delete globalThis.__sciQaRestoreViewCalls;
    return result;
  }, moreCategoriesOpenQa);
  await sidePanel.locator('[data-workspace-target="figures"]').click();
  await sidePanel.locator('#analyzeFiguresFromFigures').click();
  try {
    await sidePanel.waitForFunction(() =>
      globalThis.__sciQaLlmActionCalls?.some(call => call.action === 'analyzeFiguresWithLLM') &&
      globalThis.__sciQaLlmActionCalls?.some(call =>
        call.action === 'analyzeCrossFigureLogicWithLLM') &&
      figureAnalysisState.running === false && crossFigureLogicRunning === false &&
      (mechanismWorkspaceDraft()?.mechanismChain?.nodes?.length || 0) >= 2
    , null, { timeout: 10000 });
  } catch (error) {
    const panelDebug = await sidePanel.evaluate(() => ({
      calls: globalThis.__sciQaLlmActionCalls?.map(call => call.action) || [],
      figureAnalysisState,
      crossFigureLogicRunning,
      status: document.getElementById('statusMessage')?.textContent || '',
      mechanismStatus: document.getElementById('mechanismChainSaveStatus')?.textContent || '',
      mutationCalls: globalThis.__sciQaFigureWorkspaceMutationCalls || [],
      context: captureFigureWorkspaceEditContext(),
      draft: {
        revision: mechanismWorkspaceDraft()?.revision,
        figureIds: Object.keys(mechanismWorkspaceDraft()?.figures || {}),
        metaCounts: {
          background: mechanismWorkspaceDraft()?.meta?.backgroundItems?.length || 0,
          questions: mechanismWorkspaceDraft()?.meta?.scientificQuestions?.length || 0,
          innovations: mechanismWorkspaceDraft()?.meta?.innovationPoints?.length || 0,
          limitations: mechanismWorkspaceDraft()?.meta?.limitationPoints?.length || 0
        },
        mechanismNodes: mechanismWorkspaceDraft()?.mechanismChain?.nodes?.length || 0,
        mechanismEdges: mechanismWorkspaceDraft()?.mechanismChain?.edges?.length || 0
      }
    })).catch(debugError => ({ panelDebugError: debugError.message }));
    const isolatedDebug = await worker.evaluate(async tabId => {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'ISOLATED',
        func: () => ({
          crossState: crossFigureLogicState,
          workspace: currentArticleWorkspace,
          draftRevision: figureWorkspaceDraft?.revision,
          draftFigureIds: Object.keys(figureWorkspaceDraft?.figures || {})
        })
      });
      return result;
    }, fixtureTab.id).catch(debugError => ({ isolatedDebugError: debugError.message }));
    throw new Error(`All-figure synthesis did not persist: ${JSON.stringify({
      panelDebug, isolatedDebug, crossFigureProviderSetupQa,
      providerCalls: crossFigureProviderRequestCount, cause: error.message
    })}`);
  }
  const figureBatchButtonQa = await sidePanel.evaluate(() => ({
    disabledAfterCompletion: document.getElementById('analyzeFiguresFromFigures')?.disabled,
    phase: figureAnalysisState.phase,
    completedFigures: figureAnalysisState.completedFigures,
    totalFigures: figureAnalysisState.totalFigures,
    status: document.getElementById('statusMessage')?.textContent || ''
  }));
  await sidePanel.locator('.workspace-logic-map-open').click();
  await sidePanel.waitForFunction(() =>
    activeWorkspaceView === 'mechanism' &&
    document.querySelector('[data-workspace-view="mechanism"]')?.hidden === false &&
    document.querySelector('.workspace-mechanism-mermaid svg') &&
    document.querySelector('.workspace-mechanism-matrix')
  );
  const crossFigureSemanticFixture = await worker.evaluate(({ raw, input }) =>
    SciLLM.validateCrossFigureLogic(raw, input), {
    raw: {
      article_title: 'QA semantic fallback',
      known_background_zh: [
        'A reproducible metabolic phenotype is established before receptor mechanism testing.'
      ],
      overall_thesis_zh: '先建立表型，再解析受体信号机制。',
      figure_nodes: [
        {
          figure_id: 'figure-1', role: 'other',
          established_zh: '本图观察到可重复的代谢表型。',
          transition_zh: '下一图需要解释该表型的机制。', evidence_level: 'other'
        },
        {
          figure_id: 'figure-2', role: 'other',
          established_zh: '受体信号通路介导该表型。',
          transition_zh: '下一步需要功能验证。', evidence_level: 'other'
        }
      ],
      domino_chain: [{
        from_figure_id: 'figure-1', to_figure_id: 'figure-2', relation_type: 'other',
        established_zh: '前图建立现象。', transition_zh: '后图解析机制。',
        evidence_boundary_zh: '尚未证明充分性。'
      }],
      mechanism_chain: [{
        from_zh: '代谢表型',
        to_zh: '受体信号机制',
        support_panel_refs: ['1A']
      }],
      supplemental_support: [],
      claim_boundary_zh: '仅限所给图注与逐图解读。'
    },
    input: {
      articleTitle: 'QA semantic fallback',
      figures: [
        {
          figureId: 'figure-1', figureLabel: 'Figure 1',
          caption: 'A reproducible metabolic phenotype is observed.',
          analysis: {
            coreConclusion: '建立代谢表型。',
            argumentChain: [{ panels: ['A'], evidenceLevel: 'association' }]
          }
        },
        {
          figureId: 'figure-2', figureLabel: 'Figure 2',
          caption: 'A receptor signaling pathway mediates the phenotype.',
          analysis: { coreConclusion: '受体信号通路介导表型。' }
        }
      ]
    }
  });
  const crossFigureButtonQa = await sidePanel.evaluate(normalized => {
    const draft = currentWorkspaceSnapshot?.figures?.draft ||
      currentWorkspaceSnapshot?.figureWorkspaceDraft || {};
    const result = {
      disabledAfterCompletion: document.getElementById('analyzeFiguresFromFigures')?.disabled,
      running: crossFigureLogicRunning,
      status: document.getElementById('statusMessage')?.textContent || '',
      roles: normalized.nodes.map(node => node.role),
      evidenceLevels: normalized.nodes.map(node => node.evidenceLevel),
      relationTypes: normalized.dominoChain.map(link => link.relationType),
      generatedNodes: draft.mechanismChain?.nodes?.length || 0,
      generatedEdges: draft.mechanismChain?.edges?.length || 0,
      backgroundItems: draft.meta?.backgroundItems?.length || 0,
      scientificQuestions: draft.meta?.scientificQuestions?.length || 0,
      innovationPoints: draft.meta?.innovationPoints?.length || 0,
      limitationPoints: draft.meta?.limitationPoints?.length || 0,
      mechanismViewVisible:
        document.querySelector('[data-workspace-view="mechanism"]')?.hidden === false,
      mechanismNodes:
        document.querySelectorAll('.workspace-mechanism-mermaid g.node').length,
      mechanismEdges:
        document.querySelectorAll(
          '.workspace-mechanism-mermaid g.edgePath, ' +
          '.workspace-mechanism-mermaid path.flowchart-link'
        ).length,
      evidenceMatrixVisible:
        document.querySelector('.workspace-mechanism-matrix')?.checkVisibility?.() === true,
      evidenceMatrixItems:
        document.querySelectorAll('.workspace-mechanism-matrix-evidence').length,
      evidenceMatrixClasses: [...document.querySelectorAll(
        '.workspace-mechanism-matrix-evidence'
      )].map(item => [...item.classList].find(name => name.startsWith('is-')) || '')
    };
    return result;
  }, crossFigureSemanticFixture);
  await sidePanel.locator('.workspace-mechanism-synthesis').scrollIntoViewIfNeeded();
  await sidePanel.screenshot({
    path: path.join(outputDir, 'workspace-mechanism-mermaid-matrix-qa.png'),
    fullPage: true
  });
  crossFigureButtonQa.providerConfigured =
    crossFigureProviderSetupQa.saved && crossFigureProviderSetupQa.routed &&
    crossFigureProviderSetupQa.ready && crossFigureProviderSetupQa.effectiveMode === 'llm' &&
    crossFigureProviderSetupQa.consentGranted && crossFigureProviderSetupQa.profilePresent;
  crossFigureButtonQa.providerCalls = crossFigureProviderRequestCount;
  await sidePanel.locator('#backFromMechanismChain').click();
  await sidePanel.waitForFunction(() =>
    activeWorkspaceView === 'figures' &&
    document.querySelector('[data-workspace-view="figures"]')?.hidden === false &&
    document.querySelector('.workspace-bottom-nav')?.checkVisibility?.() === true
  );
  crossFigureButtonQa.returnedViaBack = true;
  await sidePanel.getByRole('button', {
    name: '提取研究背景与科学问题', exact: true
  }).click();
  try {
    await sidePanel.waitForFunction(() => {
      const draft = mechanismWorkspaceDraft();
      return paperMetaTaskState.research_logic.running === false &&
        Boolean(draft?.meta?.researchLogic?.questionTrace?.coreQuestion) &&
        (draft?.meta?.backgroundItems?.length || 0) >= 1 &&
        (draft?.meta?.scientificQuestions?.length || 0) >= 1;
    }, null, { timeout: 20000 });
  } catch (error) {
    const panelDebug = await sidePanel.evaluate(() => {
      const draft = mechanismWorkspaceDraft();
      return {
        taskState: structuredClone(paperMetaTaskState.research_logic),
        status: document.getElementById('statusMessage')?.textContent || '',
        calls: globalThis.__sciQaLlmActionCalls?.map(call => call.action) || [],
        draftRevision: draft?.revision,
        researchLogic: draft?.meta?.researchLogic || null,
        backgroundItems: draft?.meta?.backgroundItems?.length || 0,
        scientificQuestions: draft?.meta?.scientificQuestions?.length || 0,
        mutationCalls: globalThis.__sciQaFigureWorkspaceMutationCalls || []
      };
    }).catch(debugError => ({ panelDebugError: debugError.message }));
    throw new Error(`Independent research extraction did not persist: ${JSON.stringify({
      panelDebug,
      providerStages: researchProviderStageCalls,
      cause: error.message
    })}`);
  }
  const researchLogicTabs = sidePanel.locator('.research-logic-tabs [role="tab"]');
  const researchLogicTabCount = await researchLogicTabs.count();
  for (let index = 0; index < researchLogicTabCount; index += 1) {
    await researchLogicTabs.nth(index).click();
    await sidePanel.waitForFunction(tabIndex => {
      const tabs = Array.from(document.querySelectorAll(
        '.research-logic-tabs [role="tab"]'
      ));
      return tabs[tabIndex]?.getAttribute('aria-selected') === 'true';
    }, index);
  }
  await researchLogicTabs.first().click();
  const researchLogicCard = sidePanel.locator('.research-logic-card');
  await researchLogicCard.scrollIntoViewIfNeeded();
  await researchLogicCard.screenshot({
    path: path.join(outputDir, 'workspace-research-logic-qa.png')
  });
  const innovationCard = sidePanel.locator(
    'details.workspace-figure-meta-card[data-meta-kind="paper innovation"]'
  );
  if (!await innovationCard.evaluate(element => element.open)) {
    await innovationCard.locator('summary').click();
  }
  await innovationCard.getByRole('button', { name: '提取创新点', exact: true }).click();
  await sidePanel.waitForFunction(() =>
    paperMetaTaskState.innovation.running === false &&
    (mechanismWorkspaceDraft()?.meta?.innovationPoints?.length || 0) >= 1,
  null, { timeout: 15000 });
  const limitationCard = sidePanel.locator(
    'details.workspace-figure-meta-card[data-meta-kind="paper limitation"]'
  );
  if (!await limitationCard.evaluate(element => element.open)) {
    await limitationCard.locator('summary').click();
  }
  await limitationCard.getByRole('button', {
    name: '提取研究局限', exact: true
  }).click();
  await sidePanel.waitForFunction(() =>
    paperMetaTaskState.limitations.running === false &&
    (mechanismWorkspaceDraft()?.meta?.limitationPoints?.length || 0) >= 1,
  null, { timeout: 15000 });
  const paperMetaExtractionQa = await sidePanel.evaluate(() => {
    const draft = mechanismWorkspaceDraft();
    const tabs = Array.from(document.querySelectorAll(
      '.research-logic-tabs [role="tab"]'
    ));
    return {
      backgroundItems: draft?.meta?.backgroundItems?.length || 0,
      scientificQuestions: draft?.meta?.scientificQuestions?.length || 0,
      innovationPoints: draft?.meta?.innovationPoints?.length || 0,
      limitationPoints: draft?.meta?.limitationPoints?.length || 0,
      hasCoreQuestion: Boolean(draft?.meta?.researchLogic?.questionTrace?.coreQuestion),
      progressionCount: draft?.meta?.researchLogic?.progression?.length || 0,
      researchLogicTabs: tabs.map(tab => tab.textContent?.trim() || ''),
      selectedTab: tabs.find(tab => tab.getAttribute('aria-selected') === 'true')
        ?.textContent?.trim() || '',
      sourceChipCount: document.querySelectorAll('.research-logic-source-chip').length,
      actions: globalThis.__sciQaLlmActionCalls?.map(call => call.action) || []
    };
  });
  paperMetaExtractionQa.providerStages = [...researchProviderStageCalls];
  paperMetaExtractionQa.atomicEvidenceCalls = researchProviderStageCalls.filter(
    stage => stage === 'atomic_evidence'
  ).length;
  await sidePanel.screenshot({
    path: path.join(outputDir, 'workspace-paper-meta-footer-qa.png'),
    fullPage: true
  });
  reportQaStage('Figure, mechanism, and independent paper-meta interactions completed');
  await sidePanel.locator('[data-workspace-target="navigation"]').click();
  await sidePanel.locator('#expandAllOutlineLevels').click();
  const paragraphDrawerToggle = sidePanel.locator(
    '.workspace-tree-toggle[aria-label*="段落摘要"]'
  ).first();
  await paragraphDrawerToggle.waitFor({ state: 'visible' });
  await paragraphDrawerToggle.click();
  const paragraphSummaryAction = sidePanel.locator(
    '.workspace-paragraph-summary-action'
  ).first();
  await paragraphSummaryAction.waitFor({ state: 'visible' });
  await paragraphSummaryAction.click();
  await sidePanel.waitForFunction(() =>
    globalThis.__sciQaLlmActionCalls?.some(call =>
      call.action === 'analyzeReviewParagraphWithLLM') &&
    /\u6bb5\u843d\u6982\u8ff0\u5df2\u751f\u6210/.test(
      document.getElementById('statusMessage')?.textContent || ''
    )
  );
  const paragraphSummaryActionQa = await sidePanel.evaluate(() => ({
    globalGeneratorRemoved: !document.getElementById('generateOutlineSummaries'),
    actionCount: document.querySelectorAll('.workspace-paragraph-summary-action').length,
    status: document.getElementById('statusMessage')?.textContent || '',
    calls: globalThis.__sciQaLlmActionCalls.map(call => call.action)
  }));
  await sidePanel.evaluate(() => {
    sendTabMessage = globalThis.__sciQaOriginalLlmActionSendTabMessage;
    delete globalThis.__sciQaOriginalLlmActionSendTabMessage;
    delete globalThis.__sciQaLlmActionCalls;
    SciLLM.sendTabMessageWithRecovery = globalThis.__sciQaOriginalSendTabMessageWithRecovery;
    delete globalThis.__sciQaOriginalSendTabMessageWithRecovery;
    delete globalThis.__sciQaFigureWorkspaceMutationCalls;
    stopFigureProgressPolling();
    stopReviewOutlineProgressPolling();
  });
  await sidePanel.evaluate(async profileId => {
    await chrome.runtime.sendMessage({ type: 'LLM_DELETE_PROFILE', profileId });
    await chrome.runtime.sendMessage({
      type: 'LLM_UPDATE_PREFERENCES',
      preferences: { mode: 'regex', consentGranted: false }
    });
  }, crossFigureProviderSetupQa.profileId);

  const chatSourceSnapshot = await worker.evaluate(
    tabId => chrome.tabs.sendMessage(tabId, {
      action: 'getArticleWorkspaceSnapshot', forceRefresh: true
    }),
    fixtureTab.id
  );
  await sidePanel.evaluate(paragraphs => {
    globalThis.__sciQaChatParagraphs = paragraphs;
  }, chatSourceSnapshot?.snapshot?.paragraphs || []);
  await sidePanel.setViewportSize({ width: 574, height: 1345 });
  let articleChatQa = await sidePanel.evaluate(async () => {
    await refreshArticleWorkspace();
    llmSettingsState = {
      effectiveMode: 'llm',
      llmReady: true,
      settings: {
        consentGranted: true,
        globalProfileId: 'profile_qa_deepseek',
        profileOrder: ['profile_qa_deepseek', 'profile_qa_openai'],
        profiles: {
          profile_qa_deepseek: {
            name: 'DeepSeek V4 Pro', providerId: 'deepseek',
            config: { model: 'deepseek-v4-pro', hasApiKey: true }
          },
          profile_qa_openai: {
            name: 'GPT 5 Mini', providerId: 'openai',
            config: { model: 'gpt-5-mini', hasApiKey: true }
          }
        }
      }
    };
    currentWorkspaceSnapshot = {
      ...(currentWorkspaceSnapshot || {}),
      chat: {
        loading: false, error: '',
        coverage: {
          sentParagraphs: 6, totalParagraphs: 6,
          sentCharacters: 720, totalCharacters: 720, truncated: false
        },
        messages: [{
          role: 'user', content: '作者用哪些证据支持核心机制？', createdAt: Date.now()
        }, {
          role: 'assistant',
          profileName: 'DeepSeek V4 Pro', model: 'deepseek-v4-pro',
          content: '正文给出了表型变化、遗传抑制和下游靶点三层证据；其中遗传抑制最直接支持必要性。',
          evidence: [{ sectionTitle: 'Mechanisms', support: '抑制 kinase A 后 target C 的诱导消失。' }],
          limitations: '当前正文仍缺少独立人群验证。', createdAt: Date.now()
        }]
      }
    };
    const sourceParagraphs = Array.isArray(globalThis.__sciQaChatParagraphs) &&
      globalThis.__sciQaChatParagraphs.length
      ? globalThis.__sciQaChatParagraphs
      : (Array.isArray(currentWorkspaceSnapshot?.paragraphs) ? currentWorkspaceSnapshot.paragraphs : []);
    const sourceA = sourceParagraphs[2] || sourceParagraphs[0] || {};
    const sourceB = sourceParagraphs[3] || sourceParagraphs[1] || sourceA;
    currentWorkspaceSnapshot.chat.messages = [{
      role: 'user', content: '读懂这篇文献需要了解哪些背景知识？', createdAt: Date.now()
    }, {
      role: 'assistant', profileName: 'DeepSeek V4 Pro', model: 'deepseek-v4-pro',
      content: '**建议先掌握以下背景**\n\n1. **信号转导**：理解激酶如何把外界刺激传入细胞。\n2. **转录调控**：理解转录因子如何改变靶基因表达。\n3. **必要性证据**：抑制关键节点后效应消失，比单纯相关性更有说服力。\n4. **证据边界**：前临床结果不能直接等同于人群中的临床效果。',
      evidence: [{
        paragraphId: sourceA.paragraphId || 'qa-paragraph-a', sourceKey: sourceA.sourceKey || 'qa-source-a', sectionTitle: sourceA.sectionTitle || 'Mechanisms',
        quote: sourceA.text || 'Activation of kinase A increased transcription factor B.',
        support: '该段定义了论文检验的信号通路。'
      }, {
        paragraphId: sourceB.paragraphId || 'qa-paragraph-b', sourceKey: sourceB.sourceKey || 'qa-source-b', sectionTitle: sourceB.sectionTitle || 'Mechanisms',
        quote: sourceB.text || 'Genetic inhibition abolished target induction.',
        support: '该段提供了必要性证据。'
      }],
      limitations: '当前正文仍缺少独立人群验证。', createdAt: Date.now()
    }, {
      role: 'user', content: '作者具体怎样设计实验来验证这一点？', createdAt: Date.now()
    }, {
      role: 'assistant', profileName: 'GPT 5 Mini', model: 'gpt-5-mini',
      content: '**实验逻辑分为三步：**\n\n1. **先观察响应**：处理后检测 kinase A 与 target C 的变化。\n2. **再做干预**：遗传抑制 kinase A，观察 target C 的诱导是否消失。\n3. **最后界定结论**：现有结果支持通路中的必要关系，但尚不能证明临床普适性。\n\n这种“观察—干预—边界”的组织方式，把相关性推进到了机制证据。',
      evidence: [{
        paragraphId: sourceA.paragraphId || 'qa-paragraph-a', sourceKey: sourceA.sourceKey || 'qa-source-a', sectionTitle: sourceA.sectionTitle || 'Mechanisms',
        quote: sourceA.text || 'Activation of kinase A increased transcription factor B.',
        support: '处理实验建立通路响应。'
      }, {
        paragraphId: sourceB.paragraphId || 'qa-paragraph-b', sourceKey: sourceB.sourceKey || 'qa-source-b', sectionTitle: sourceB.sectionTitle || 'Mechanisms',
        quote: sourceB.text || 'Genetic inhibition abolished target induction.',
        support: '遗传抑制实验检验必要性。'
      }],
      limitations: '网页正文没有提供效应量、置信区间或独立重复次数。', createdAt: Date.now()
    }];
    currentWorkspaceSnapshot.chat.messages[1].content =
      '**建议先掌握以下背景**\n\n1. **信号转导**：理解激酶 kinase A<sup>1</sup> 如何把外界刺激传入细胞。[[1]]\n2. **转录调控**：理解转录因子如何改变靶基因表达。[[1]]\n3. **必要性证据**：抑制关键节点后效应消失，比单纯相关性更有说服力。[[2]]\n4. **证据边界**：前临床结果不能直接等同于人群中的临床效果。[[2]]\n\n正文先用激活实验建立通路响应，再用遗传抑制检验关键节点是否不可替代。[[1]]\n\n这种“先观察、再干预”的组合，比只报告两个指标同时变化更接近机制论证。[[2]]\n\n阅读时还应区分细胞存活这一表型与临床获益，两者不能直接互换。[[2]]\n\n因此背景知识的重点不是记住术语，而是理解每类实验在因果链中的位置。[[1]]';
    currentWorkspaceSnapshot.chat.messages[3].content =
      '**实验逻辑分为三步**\n\n1. **先观察响应**：处理后检测 kinase A 与 target C 的变化。[[1]]\n2. **再做干预**：遗传抑制 kinase A，观察 target C 的诱导是否消失。[[2]]\n3. **最后界定结论**：现有结果支持通路中的必要关系，但尚不能证明临床普适性。[[2]]\n\n第一步回答通路是否随处理发生变化，第二步回答变化是否依赖 kinase A。[[1]]\n\n抑制后 target C 的诱导消失，是这里最关键的必要性证据。[[2]]\n\n不过，该设计仍不能单独排除所有旁路机制，也不能外推到独立人群。[[2]]\n\n因此更准确的结论是“支持一条可检验的必要关系”，而不是已经证明完整临床机制。[[2]]';
    const longAnswerAppendix = Array.from({ length: 12 }, (_, index) =>
      `补充说明 ${index + 1}：这一判断需要同时对照观察实验、干预实验与证据边界，避免把相关变化直接写成已经证实的完整因果机制。[[${index % 2 ? 2 : 1}]]`
    ).join('\n\n');
    currentWorkspaceSnapshot.chat.messages[1].content += `\n\n${longAnswerAppendix}`;
    currentWorkspaceSnapshot.chat.messages[3].content += `\n\n${longAnswerAppendix}`;
    const legacyMessages = currentWorkspaceSnapshot.chat.messages;
    currentWorkspaceSnapshot.chat.turns = [0, 2].map((questionIndex, turnIndex) => {
      const question = legacyMessages[questionIndex];
      const answer = legacyMessages[questionIndex + 1];
      return {
        turnId: `turn-qa-${turnIndex + 1}`,
        question: question.content,
        answerBlocks: [{
          blockId: `block-qa-${turnIndex + 1}`,
          markdown: answer.content,
          evidence: answer.evidence.map((item, evidenceIndex) => ({
            ...item,
            marker: String(evidenceIndex + 1),
            documentRevision: currentWorkspaceSnapshot.revision
          }))
        }],
        summary: '',
        status: 'completed',
        selectedProfileId: turnIndex === 0 ? 'profile_qa_deepseek' : 'profile_qa_openai',
        profileName: answer.profileName,
        model: answer.model,
        createdAt: question.createdAt,
        updatedAt: answer.createdAt
      };
    });
    currentWorkspaceSnapshot.chat.totalTurns = currentWorkspaceSnapshot.chat.turns.length;
    delete currentWorkspaceSnapshot.chat.messages;
    articleChatFollowLatest = true;
    switchWorkspaceView('chat');
    renderArticleChatSnapshot(currentWorkspaceSnapshot);
    return {
      active: document.querySelector('[data-workspace-view="chat"]')?.hidden === false,
      profileOptions: document.querySelectorAll('#articleChatProfile option').length,
      messages: document.querySelectorAll('.article-chat-message').length,
      evidenceCollapsed: document.querySelector('.article-chat-evidence')?.open === false,
      limitationsCollapsed: document.querySelector('.article-chat-limitations')?.open === false
    };
  });
  await sidePanel.waitForTimeout(160);
  articleChatQa = await sidePanel.evaluate(() => {
    const messages = document.getElementById('articleChatMessages');
    const composer = document.getElementById('articleChatForm');
    const messageRect = messages?.getBoundingClientRect();
    const composerRect = composer?.getBoundingClientRect();
    return {
      active: document.querySelector('[data-workspace-view="chat"]')?.hidden === false,
      profileOptions: document.querySelectorAll('#articleChatProfile option').length,
      messages: document.querySelectorAll('.article-chat-message').length,
      userLabels: document.querySelectorAll(
        '.article-chat-message.is-user .article-chat-message-meta'
      ).length,
      assistantLabels: document.querySelectorAll(
        '.article-chat-message.is-assistant .article-chat-message-meta'
      ).length,
      boldNodes: document.querySelectorAll('.article-chat-message-content strong').length,
      superscriptNodes: document.querySelectorAll('.article-chat-message-content sup').length,
      literalSupTagsVisible: Array.from(document.querySelectorAll('.article-chat-message-content'))
        .some(element => element.textContent?.includes('<sup>')),
      listItems: document.querySelectorAll('.article-chat-message-content li').length,
      orderedLists: document.querySelectorAll('.article-chat-message-content ol').length,
      secondQuestionVisible: Array.from(document.querySelectorAll('.article-chat-message.is-user'))
        .some(message => message.textContent?.includes('作者具体怎样设计实验')),
      citationButtons: messages?.querySelectorAll('.article-chat-inline-citation').length || 0,
      citationParagraphIds: Array.from(
        messages?.querySelectorAll('.article-chat-inline-citation') || []
      )
        .map(button => button.dataset.paragraphId).filter(Boolean),
      citationSourceKeys: Array.from(
        messages?.querySelectorAll('.article-chat-inline-citation') || []
      )
        .map(button => button.dataset.sourceKey).filter(Boolean),
      fallbackCitationRows: document.querySelectorAll('.article-chat-citation-fallback').length,
      limitationsCollapsed: Array.from(document.querySelectorAll('.article-chat-limitations'))
        .every(details => details.open === false),
      messagesOverflowY: messages ? getComputedStyle(messages).overflowY : '',
      messagesScrollable: Boolean(messages && messages.scrollHeight > messages.clientHeight),
      scrolledToLatest: Boolean(messages && messages.scrollTop > 0 &&
        messages.scrollTop + messages.clientHeight >= messages.scrollHeight - 3),
      composerOutsideMessages: Boolean(messageRect && composerRect &&
        messageRect.bottom <= composerRect.top + 1)
    };
  });
  await sidePanel.locator(
    '#articleChatMessages .article-chat-inline-citation:not(:disabled)'
  ).first().click();
  await fixture.waitForSelector('.sci-article-source-focus', { timeout: 1800 });
  articleChatQa.citationJumpFocused = await fixture.evaluate(() => {
    const focused = document.querySelector('.sci-article-source-focus');
    return Boolean(focused && /activation of kinase A|genetic inhibition of kinase A/i
      .test(focused.textContent || ''));
  });
  await sidePanel.evaluate(() => {
    const messages = document.getElementById('articleChatMessages');
    if (messages) {
      messages.scrollTop = 0;
      messages.dispatchEvent(new Event('scroll'));
    }
  });
  await sidePanel.waitForTimeout(80);
  articleChatQa.returnLatestVisible = await sidePanel.evaluate(() =>
    document.getElementById('articleChatReturnLatest')?.hidden === false
  );
  await sidePanel.screenshot({
    path: path.join(outputDir, 'edge-article-chat-citations.png'),
    fullPage: true
  });
  await sidePanel.locator('#articleChatReturnLatest').click();
  await sidePanel.waitForTimeout(240);
  articleChatQa.returnLatestRestored = await sidePanel.evaluate(() => {
    const messages = document.getElementById('articleChatMessages');
    return Boolean(messages && messages.scrollTop + messages.clientHeight >=
      messages.scrollHeight - 3);
  });
  await sidePanel.evaluate(() => {
    globalThis.__sciQaOriginalChatSendTabMessage = sendTabMessage;
    globalThis.__sciQaChatCancelCalls = [];
    sendTabMessage = async (tabId, message) => {
      if (message?.action === 'cancelArticleChatWithLLM') {
        globalThis.__sciQaChatCancelCalls.push({ tabId, action: message.action });
        return { success: true, cancelled: true };
      }
      return globalThis.__sciQaOriginalChatSendTabMessage(tabId, message);
    };
    currentWorkspaceSnapshot.chat = {
      ...(currentWorkspaceSnapshot.chat || {}),
      loading: true
    };
    renderArticleChatSnapshot(currentWorkspaceSnapshot);
  });
  const cancelPrimaryButton = sidePanel.locator('#sendArticleChat');
  await cancelPrimaryButton.waitFor({ state: 'visible' });
  await cancelPrimaryButton.click();
  await sidePanel.waitForTimeout(80);
  articleChatQa.cancelControl = await sidePanel.evaluate(() => {
    const result = {
      calls: [...globalThis.__sciQaChatCancelCalls],
      sameButtonWhileLoading:
        document.getElementById('sendArticleChat')?.dataset.mode === 'cancel' &&
        document.getElementById('sendArticleChat')?.textContent?.includes('取消回答') === true
    };
    sendTabMessage = globalThis.__sciQaOriginalChatSendTabMessage;
    delete globalThis.__sciQaOriginalChatSendTabMessage;
    delete globalThis.__sciQaChatCancelCalls;
    currentWorkspaceSnapshot.chat = {
      ...(currentWorkspaceSnapshot.chat || {}),
      loading: false
    };
    renderArticleChatSnapshot(currentWorkspaceSnapshot);
    result.restoredAfterCompletion =
      document.getElementById('sendArticleChat')?.dataset.mode === 'send' &&
      document.getElementById('sendArticleChat')?.textContent?.includes('发送') === true;
    return result;
  });
  await sidePanel.screenshot({
    path: path.join(outputDir, 'edge-article-chat.png'),
    fullPage: true
  });

  const streamEvidenceParagraphs = (chatSourceSnapshot?.snapshot?.paragraphs || [])
    .filter(item => /activation of kinase A|genetic inhibition of kinase A/i.test(item.text || ''));
  if (streamEvidenceParagraphs.length < 2) {
    throw new Error('Unable to resolve fixture evidence for streaming chat QA');
  }
  const streamRequests = [];
  const panelCapacityRequests = [];
  const panelTruncationRequests = [];
  const panelUiInterpretationRequests = [];
  const panelUiFollowupRequests = [];
  const unlabeledFigureRequests = [];
  const highlightRequests = [];
  const evidenceLedgerRequests = [];
  let releaseEvidenceLedger = null;
  const evidenceLedgerGate = new Promise(resolve => {
    releaseEvidenceLedger = resolve;
  });
  let releaseStreamContinuation = null;
  let streamContinuationReleased = false;
  const sseBody = (pieces, finishReason, usage) => [
    ...pieces.map(content => `data: ${JSON.stringify({
      choices: [{ delta: { content }, finish_reason: null }]
    })}\n\n`),
    `data: ${JSON.stringify({
      choices: [{ delta: {}, finish_reason: finishReason }], usage
    })}\n\n`,
    'data: [DONE]\n\n'
  ].join('');
  const evidenceRecord = (paragraph, marker) => ({
    marker: String(marker),
    paragraph_id: paragraph.paragraphId,
    source_key: paragraph.sourceKey,
    text_hash: paragraph.textHash,
    quote: paragraph.text,
    section_path: Array.isArray(paragraph.sectionPath)
      ? paragraph.sectionPath.map(item => typeof item === 'string' ? item : item.title)
        .filter(Boolean)
      : []
  });
  const streamBlock1 = {
    type: 'answer_block', block_id: 'stream-step-1',
    markdown: '1. **锁定候选通路**\n\n激活 kinase A 会提高转录因子 B，并进一步诱导靶点 C。[[1]]',
    evidence: [evidenceRecord(streamEvidenceParagraphs[0], 1)]
  };
  const streamBlock2 = {
    type: 'answer_block', block_id: 'stream-step-2',
    markdown: '2. **验证必要性**\n\n遗传抑制 kinase A 会消除靶点 C 的诱导，因此把相关性推进为必要性证据。[[1]]',
    evidence: [evidenceRecord(streamEvidenceParagraphs[1], 1)]
  };
  const panelCapacityOutput = figureId => ({
    figure_id: figureId,
    panel: 'A',
    basis: 'vision_text',
    panel_interpretation: {
      panel: 'A',
      role: 'phenotype',
      phenotype_name_zh: '目标表型',
      method_category: 'wet_lab',
      methods: ['CCK-8'],
      method_source: 'image',
      purpose_zh: '比较处理组与匹配对照组。',
      design_zh: '两组使用相同指标进行检测。',
      comparison_zh: '处理组对比匹配对照组。',
      direct_observation_zh: '处理组的目标表型低于对照组。',
      observation_source: 'image_observation',
      local_inference_zh: '结果支持处理产生抑制作用。',
      contribution_zh: '该 Panel 建立主要表型证据。'
    },
    claim_boundary_zh: '这一结果本身不能证明直接分子机制。'
  });
  const panelUiInterpretationOutput = figureId => ({
    figure_id: figureId,
    panel: 'A',
    basis: 'caption_context',
    panel_interpretation: {
      panel: 'A',
      role: 'phenotype',
      phenotype_name_zh: '目标表型',
      method_category: 'other',
      methods: [],
      method_source: 'caption',
      purpose_zh: '比较处理组与匹配对照组。',
      design_zh: '处理组与匹配对照组接受同一指标检测。',
      comparison_zh: '处理组对比匹配对照组。',
      direct_observation_zh: '图注明确报告处理组的目标表型降低。',
      observation_source: 'caption_statement',
      local_inference_zh: '结果支持处理与表型下降相关。',
      contribution_zh: '该 Panel 建立主要表型证据。'
    },
    claim_boundary_zh: '仅凭该 Panel 不能证明直接分子机制。'
  });
  const panelUiFollowupOutput = parsedUser => ({
    figure_id: parsedUser.figure_id,
    panel: parsedUser.panel,
    topics: parsedUser.requested_topics,
    basis: 'caption_context',
    answer_zh: '匹配对照使主要差异集中于处理因素，并减少基础条件差异的解释空间。',
    claim_boundary_zh: '仍不能排除输入中未描述的混杂因素。',
    source_refs: [{
      kind: 'paragraph',
      ref: 'panel-ui-r1',
      paragraph_id: 'panel-ui-r1',
      quote: 'Figure 78A compares the treated group with a matched control group.'
    }]
  });
  const unlabeledFigureOutput = figureId => ({
    figure_id: figureId,
    analysis_depth: 'standard',
    basis: 'caption_context',
    figure_title_zh: '',
    figure_question_zh: '该图如何建立处理与目标表型变化之间的证据联系？',
    evidence_steps: [{
      source_zh: '图注与相关 Results 正文',
      established_zh: '处理组的目标表型低于匹配对照组。',
      handoff_zh: '这一比较建立现象，但仍需要独立实验检验机制。',
      evidence_level: 'association'
    }],
    author_assembly_zh: '作者先呈现组间比较，再限定该结果能够支持的结论。',
    core_conclusion_zh: '处理与目标表型下降相关。',
    claim_boundary_zh: '该图本身不能证明直接分子机制或因果链。'
  });
  const streamServer = http.createServer((request, response) => {
    let requestBody = '';
    request.setEncoding('utf8');
    request.on('data', chunk => {
      requestBody += chunk;
      if (requestBody.length > 4 * 1024 * 1024) request.destroy();
    });
    request.on('end', async () => {
      try {
        const body = JSON.parse(requestBody || '{}');
        if (body.stream === false) {
          const systemText = String(body.messages?.[0]?.content || '');
          const userContent = body.messages?.[1]?.content;
          const userText = Array.isArray(userContent)
            ? userContent.find(item => item?.type === 'text')?.text || ''
            : String(userContent || '');
          const imageUrl = Array.isArray(userContent)
            ? userContent.find(item => item?.type === 'image_url')?.image_url?.url || ''
            : '';
          if (systemText.includes('scientific discourse annotation engine') &&
              userText.includes('"chunk_id"') && userText.includes('"paragraphs"')) {
            const input = JSON.parse(userText || '{}');
            const paragraphs = Array.isArray(input.paragraphs) ? input.paragraphs : [];
            const limitation = paragraphs.find(item =>
              String(item.text || '').includes('One major limitation of this study')
            );
            highlightRequests.push({
              chunkId: String(input.chunk_id || ''),
              paragraphIds: paragraphs.map(item => String(item.paragraph_id || '')),
              categoryBounded: systemText.includes('"category_id":"limitation"') ||
                systemText.includes('"category_id"') && systemText.includes('limitation'),
              maxTokens: Number(body.max_tokens) || 0
            });
            response.writeHead(200, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({
              model: 'qa-stream-model',
              choices: [{
                finish_reason: 'stop',
                message: {
                  content: JSON.stringify({
                    chunk_id: input.chunk_id,
                    paragraphs_reviewed: paragraphs.map(item => item.paragraph_id),
                    annotations: limitation ? [{
                      paragraph_id: limitation.paragraph_id,
                      quote: limitation.text,
                      occurrence: 0,
                      category_id: 'limitation',
                      confidence: 0.97,
                      reason_zh: '原文明示了样本量与外部验证方面的研究局限。'
                    }] : []
                  })
                }
              }],
              usage: { prompt_tokens: 980, completion_tokens: 180 }
            }));
            return;
          }
          if (systemText.includes('synthesize an evidence ledger')) {
            evidenceLedgerRequests.push({
              receivedAt: Date.now(),
              hasValidatedAnnotation: userText.includes('limitation')
            });
            await Promise.race([
              evidenceLedgerGate,
              new Promise(resolve => setTimeout(resolve, 30000))
            ]);
            response.writeHead(200, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({
              model: 'qa-stream-model',
              choices: [{
                finish_reason: 'stop',
                message: {
                  content: JSON.stringify({
                    key_annotation_ids: [],
                    relation_summaries: [],
                    review_warnings: [],
                    audit_items: []
                  })
                }
              }],
              usage: { prompt_tokens: 260, completion_tokens: 40 }
            }));
            return;
          }
          let parsedUser = null;
          try { parsedUser = JSON.parse(userText || '{}'); } catch (_) {}
          if (parsedUser?.request_mode === 'single_panel_interpretation' &&
              parsedUser?.figure_id === 'figure-78') {
            const requestRecord = {
              figureId: String(parsedUser.figure_id || ''),
              panel: String(parsedUser.panel || ''),
              repairPass: systemText.includes('SCHEMA_REPAIR_PASS'),
              maxTokens: Number(body.max_tokens) || 0,
              hasImage: Boolean(imageUrl)
            };
            panelUiInterpretationRequests.push(requestRecord);
            response.writeHead(200, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({
              model: 'qa-stream-model',
              choices: [{
                finish_reason: 'stop',
                message: {
                  content: JSON.stringify(panelUiInterpretationRequests.length === 1
                    ? { figure_id: parsedUser.figure_id }
                    : panelUiInterpretationOutput(parsedUser.figure_id))
                }
              }],
              usage: { prompt_tokens: 540, completion_tokens: 260 }
            }));
            return;
          }
          if (parsedUser?.figure_id === 'figure-78' &&
              Array.isArray(parsedUser?.requested_topics)) {
            const requestRecord = {
              figureId: String(parsedUser.figure_id || ''),
              panel: String(parsedUser.panel || ''),
              topics: parsedUser.requested_topics,
              customQuestion: String(parsedUser.custom_question || ''),
              repairPass: systemText.includes('SCHEMA_REPAIR_PASS'),
              maxTokens: Number(body.max_tokens) || 0,
              hasImage: Boolean(imageUrl)
            };
            panelUiFollowupRequests.push(requestRecord);
            response.writeHead(200, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({
              model: 'qa-stream-model',
              choices: [{
                finish_reason: 'stop',
                message: {
                  content: JSON.stringify(panelUiFollowupRequests.length === 1
                    ? { answer_zh: '字段不完整' }
                    : panelUiFollowupOutput(parsedUser))
                }
              }],
              usage: { prompt_tokens: 620, completion_tokens: 220 }
            }));
            return;
          }
          if (parsedUser?.pass === 'unlabeled_figure_overview') {
            unlabeledFigureRequests.push({
              figureId: String(parsedUser.figure_id || ''),
              pass: String(parsedUser.pass || ''),
              maxTokens: Number(body.max_tokens) || 0,
              hasImage: Boolean(imageUrl),
              hasCompactSchema: systemText.includes('"evidence_steps"') &&
                !systemText.includes('"panel_groups"')
            });
            response.writeHead(200, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({
              model: 'qa-stream-model',
              choices: [{
                finish_reason: 'stop',
                message: {
                  content: JSON.stringify(unlabeledFigureOutput(parsedUser.figure_id))
                }
              }],
              usage: { prompt_tokens: 620, completion_tokens: 310 }
            }));
            return;
          }
          const truncationRequest = userText.includes('"figure_id":"figure-92"');
          const requestRecord = {
            maxTokens: Number(body.max_tokens) || 0,
            imageLength: imageUrl.length,
            hasImage: Boolean(imageUrl)
          };
          const requests = truncationRequest
            ? panelTruncationRequests : panelCapacityRequests;
          requests.push(requestRecord);
          if (truncationRequest && requests.length === 1) {
            response.writeHead(200, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({
              model: 'qa-stream-model',
              choices: [{ finish_reason: 'length', message: { content: '{}' } }],
              usage: { prompt_tokens: 720, completion_tokens: requestRecord.maxTokens }
            }));
            return;
          }
          if (!truncationRequest && requests.length < 3) {
            const maximum = requests.length === 1 ? 1024 : 768;
            response.writeHead(400, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({
              error: { message: `max_tokens cannot exceed ${maximum}` }
            }));
            return;
          }
          response.writeHead(200, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({
            model: 'qa-stream-model',
            choices: [{
              finish_reason: 'stop',
              message: {
                content: JSON.stringify(panelCapacityOutput(
                  truncationRequest ? 'figure-92' : 'figure-91'
                ))
              }
            }],
            usage: { prompt_tokens: 720, completion_tokens: 640 }
          }));
          return;
        }
        const streamSystemText = String(body.messages?.[0]?.content || '');
        const streamUserContent = body.messages?.[1]?.content;
        const streamUserText = Array.isArray(streamUserContent)
          ? streamUserContent.find(item => item?.type === 'text')?.text || ''
          : String(streamUserContent || '');
        if (streamSystemText.includes('You are SCI-CENSUS')) {
          const input = JSON.parse(streamUserText || '{}');
          const sourceData = Array.isArray(input.source_data) ? input.source_data : [];
          const limitationTask = (Array.isArray(input.task_spec) ? input.task_spec : [])
            .find(item => item?.id === 'limitation');
          const limitation = sourceData.find(item =>
            String(item?.x || '').includes('One major limitation of this study')
          );
          highlightRequests.push({
            chunkId: String(input.chunk?.id || ''),
            paragraphIds: sourceData.map(item => String(item?.id || '')),
            categoryBounded: Boolean(limitationTask?.c),
            maxTokens: Number(body.max_tokens) || 0,
            protocol: 'ndjson-v1'
          });
          const records = sourceData.map(item => JSON.stringify({
            t: 'p', i: Number(item.i),
            a: item === limitation && limitationTask ? [{
              c: limitationTask.c,
              prov: 'current',
              d: [{ i: Number(item.i), x: String(item.x || ''),
                r: limitationTask.r?.[0] || 'statement' }],
              s: [], sl: {}, need: false
            }] : []
          }));
          records.push(JSON.stringify({ t: 'final', n: sourceData.length }));
          response.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache',
            Connection: 'close'
          });
          response.end(sseBody(
            [`${records.join('\n')}\n`],
            'stop',
            { prompt_tokens: 520, completion_tokens: 120 }
          ));
          return;
        }
        streamRequests.push(body);
        const requestNumber = streamRequests.length;
        if (requestNumber === 2 && !streamContinuationReleased) {
          await Promise.race([
            new Promise(resolve => { releaseStreamContinuation = resolve; }),
            new Promise(resolve => setTimeout(resolve, 5000))
          ]);
        }
        const responseBody = requestNumber === 1
          ? sseBody([
            `${JSON.stringify(streamBlock1)}\n`,
            '{"type":"answer_block","block_id":"stream-step-2","markdown":"2. 未完成'
          ], 'length', { prompt_tokens: 1200, completion_tokens: 8192 })
          : sseBody([
            `${JSON.stringify(streamBlock1)}\n`,
            `${JSON.stringify(streamBlock2)}\n`,
            `${JSON.stringify({
              type: 'turn_summary', summary: '先定位候选通路，再用遗传抑制验证必要性。'
            })}\n`,
            `${JSON.stringify({ type: 'final', status: 'completed' })}\n`
          ], 'stop', { prompt_tokens: 980, completion_tokens: 1400 });
        response.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache',
          Connection: 'close'
        });
        response.end(responseBody);
      } catch (error) {
        response.writeHead(500, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ error: { message: error.message } }));
      }
    });
  });
  await new Promise((resolve, reject) => {
    streamServer.once('error', reject);
    streamServer.listen(0, '127.0.0.1', resolve);
  });
  analysisProviderServer = streamServer;
  const streamAddress = streamServer.address();
  const streamProviderBaseUrl = `http://127.0.0.1:${streamAddress.port}/v1`;
  reportQaStage('starting full-text LLM highlighting scenario');
  const streamingProfileQa = await sidePanel.evaluate(async baseUrl => {
    const saved = await chrome.runtime.sendMessage({
      type: 'LLM_SAVE_PROFILE',
      profile: {
        id: 'profile_qa_stream',
        name: 'Edge Streaming QA',
        providerId: 'openai-compatible',
        config: {
          apiKey: 'qa-stream-secret',
          model: 'qa-stream-model',
          baseUrl,
          supportsVision: true
        },
        capabilities: { vision: true },
        contextWindowTokens: 32768,
        tokenPolicy: { mode: 'auto', autoCap: 16384 }
      }
    });
    const preferences = await chrome.runtime.sendMessage({
      type: 'LLM_UPDATE_PREFERENCES',
      preferences: { mode: 'llm', consentGranted: true }
    });
    const routing = await chrome.runtime.sendMessage({
      type: 'LLM_UPDATE_PROFILE_ROUTING',
      globalProfileId: 'profile_qa_stream'
    });
    return {
      profileSaved: saved?.success === true,
      preferencesSaved: preferences?.success === true,
      routingSaved: routing?.success === true,
      effectiveMode: preferences?.data?.effectiveMode || '',
      profileError: saved?.error || null,
      preferencesError: preferences?.error || null,
      routingError: routing?.error || null
    };
  }, streamProviderBaseUrl);
  reportQaStage('full-text LLM profile configured');
  await sidePanel.evaluate(async () => {
    await loadLlmSettings();
    switchWorkspaceView('analysis');
    await Promise.race([
      queueAnalysisModeMutation('llm'),
      new Promise((_, reject) => setTimeout(() =>
        reject(new Error('QA_ANALYSIS_MODE_MUTATION_TIMEOUT')), 20000))
    ]);
  });
  reportQaStage('full-text LLM mode and article preparation completed');
  await sidePanel.waitForFunction(() =>
    analysisMode === 'llm' &&
    llmSettingsState?.effectiveMode === 'llm' &&
    prepareState === 'prepared' &&
    Boolean(preparedDocumentState?.documentHash)
  );
  reportQaStage('full-text LLM mode ready without a paper-type chooser');
  const limitationSelected = await sidePanel.locator('#cat-limitation').isChecked();
  if (!limitationSelected) {
    await sidePanel.locator('#cat-limitation').check();
    await sidePanel.waitForFunction(() =>
      llmSelectedCategories.has('limitation') &&
      preferenceMutationCoordinator.isPending() === false
    );
  }
  await sidePanel.waitForFunction(() =>
    document.getElementById('applyHighlight')?.disabled === false &&
    /分析全文|重新分析全文/.test(
      document.getElementById('applyHighlight')?.getAttribute('aria-label') ||
      document.getElementById('applyHighlight')?.textContent || ''
    )
  );
  await worker.evaluate(async tabId => {
    await chrome.scripting.executeScript({
      target: { tabId }, world: 'ISOLATED',
      func: () => {
        globalThis.__sciQaProgressiveHighlightTrace = [];
        const original = renderProgressiveLlmChunk;
        globalThis.__sciQaOriginalProgressiveHighlight = original;
        renderProgressiveLlmChunk = progress => {
          const before = {
            phase: String(progress?.phase || ''),
            checkpointAnnotations: Array.isArray(progress?.checkpointAnnotations)
              ? progress.checkpointAnnotations.length : -1,
            hasProgressiveState: Boolean(llmProgressiveAnalysis),
            currentAnnotations:
              llmProgressiveAnalysis?.rawAnalysis?.annotations?.length || 0,
            checkpointShape: (() => {
              const item = progress?.checkpointAnnotations?.[0];
              if (!item) return null;
              return {
                keys: Object.keys(item).sort(),
                paragraphId: String(item.paragraphId || ''),
                categoryId: String(item.categoryId || ''),
                confidence: Number(item.confidence),
                groupedCategories: Array.isArray(item.categories)
                  ? item.categories.length : -1
              };
            })()
          };
          const result = original(progress);
          const afterItem = llmProgressiveAnalysis?.rawAnalysis?.annotations?.[0];
          const filtered = SciLLM.filterAnnotationGroupsByConfidence(
            llmProgressiveAnalysis?.rawAnalysis?.annotations || [],
            llmProgressiveAnalysis?.threshold || 0.8
          );
          globalThis.__sciQaProgressiveHighlightTrace.push({
            ...before,
            afterShape: afterItem ? {
              keys: Object.keys(afterItem).sort(),
              paragraphId: String(afterItem.paragraphId || ''),
              categoryCount: Array.isArray(afterItem.categories)
                ? afterItem.categories.length : -1
            } : null,
            filteredAnnotations: filtered.annotations.length,
            filteredHidden: filtered.hiddenCount,
            anchorPresent: Boolean(afterItem?.paragraphId && document.querySelector(
              `[data-sci-llm-paragraph-id="${CSS.escape(afterItem.paragraphId)}"]`
            )),
            resultHighlightedCount: Number(result?.highlightedCount) || 0,
            marksAfter: document.querySelectorAll('.sci-llm-highlight').length
          });
          return result;
        };
      }
    });
  }, fixtureTab.id);
  await sidePanel.locator('#applyHighlight').click();
  reportQaStage('full-text LLM analysis request started');
  await sidePanel.waitForFunction(() =>
    highlightTaskState.running === true &&
    prepareState === 'analyzing',
  null, { timeout: 3000 });
  try {
    await fixture.waitForFunction(() =>
      document.querySelectorAll('.sci-llm-highlight').length === 1,
    null, { timeout: 15000 });
  } catch (error) {
    const ui = await sidePanel.evaluate(() => ({
      status: document.getElementById('statusMessage')?.textContent || '',
      prepareState,
      highlightTaskState,
      applyButton: document.getElementById('applyHighlight')?.textContent || ''
    }));
    const content = await worker.evaluate(async tabId => {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId }, world: 'ISOLATED',
        func: () => ({
          trace: globalThis.__sciQaProgressiveHighlightTrace || [],
          hasProgressiveState: Boolean(llmProgressiveAnalysis),
          progressiveAnnotations:
            llmProgressiveAnalysis?.rawAnalysis?.annotations?.length || 0,
          lastDiagnostics: lastLlmDiagnostics,
          marks: document.querySelectorAll('.sci-llm-highlight').length
        })
      });
      return result;
    }, fixtureTab.id);
    throw new Error(`Full-text highlight did not render: ${JSON.stringify({
      ui,
      content,
      highlightRequests,
      evidenceLedgerRequests,
      panelCapacityRequests
    })}`, { cause: error });
  }
  reportQaStage('full-text LLM progressive highlight rendered');
  const progressiveHighlightQa = await worker.evaluate(async tabId => {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'ISOLATED',
      func: async () => {
        const startedAt = Date.now();
        let highlightAsset = null;
        let analysisAsset = null;
        while (Date.now() - startedAt < 3000) {
          const response = await chrome.runtime.sendMessage({
            type: 'ARTICLE_WORKSPACE_EXPORT',
            workspaceId: currentArticleWorkspace?.workspaceId || ''
          });
          highlightAsset = response?.data?.assets?.find(
            asset => asset.relativePath === 'annotations/highlights.json'
          )?.content || null;
          analysisAsset = response?.data?.assets?.find(
            asset => asset.relativePath === 'analysis/full-analysis.json'
          )?.content || null;
          if ((analysisAsset?.llm?.rawAnalysis?.annotations?.length || 0) > 0) break;
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        const mark = document.querySelector('.sci-llm-highlight');
        return {
          marks: document.querySelectorAll('.sci-llm-highlight').length,
          markText: mark?.textContent || '',
          diagnosticsStage: lastLlmDiagnostics?.stage || '',
          inMemoryAnnotations: lastLlmAnalysis?.rawAnalysis?.annotations?.length || 0,
          persistedActiveEngine: highlightAsset?.activeEngine || '',
          persistedAnnotations:
            analysisAsset?.llm?.rawAnalysis?.annotations?.length || 0,
          persistedDiagnosticsStage: analysisAsset?.diagnostics?.stage || ''
        };
      }
    });
    return result;
  }, fixtureTab.id);
  releaseEvidenceLedger();
  await sidePanel.waitForFunction(() =>
    regexApplyPending === false &&
    highlightTaskState.running === false &&
    prepareState === 'prepared' &&
    /LLM 已高亮 1 处/.test(
      document.getElementById('statusMessage')?.textContent || ''
    )
  );
  const completedHighlightQa = await worker.evaluate(async tabId => {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'ISOLATED',
      func: async () => {
        const response = await chrome.runtime.sendMessage({
          type: 'ARTICLE_WORKSPACE_EXPORT',
          workspaceId: currentArticleWorkspace?.workspaceId || ''
        });
        const highlightAsset = response?.data?.assets?.find(
          asset => asset.relativePath === 'annotations/highlights.json'
        )?.content || null;
        const analysisAsset = response?.data?.assets?.find(
          asset => asset.relativePath === 'analysis/full-analysis.json'
        )?.content || null;
        return {
          marks: document.querySelectorAll('.sci-llm-highlight').length,
          diagnosticsStage: lastLlmDiagnostics?.stage || '',
          relationCount: lastLlmDiagnostics?.relationCount || 0,
          persistedActiveEngine: highlightAsset?.activeEngine || '',
          persistedAnnotations:
            analysisAsset?.llm?.rawAnalysis?.annotations?.length || 0,
          persistedDiagnosticsStage: analysisAsset?.diagnostics?.stage || '',
          workspaceTaskRunning: analysisAsset?.task?.running === true
        };
      }
    });
    return result;
  }, fixtureTab.id);
  const fullTextHighlightQa = {
    requestCount: highlightRequests.length,
    requests: highlightRequests,
    evidenceLedgerRequestCount: evidenceLedgerRequests.length,
    evidenceLedgerRequests,
    progressive: progressiveHighlightQa,
    completed: completedHighlightQa
  };
  await worker.evaluate(async tabId => {
    await chrome.scripting.executeScript({
      target: { tabId }, world: 'ISOLATED',
      func: () => {
        if (globalThis.__sciQaOriginalProgressiveHighlight) {
          renderProgressiveLlmChunk = globalThis.__sciQaOriginalProgressiveHighlight;
        }
        delete globalThis.__sciQaOriginalProgressiveHighlight;
        delete globalThis.__sciQaProgressiveHighlightTrace;
      }
    });
  }, fixtureTab.id);
  reportQaStage('full-text LLM highlighting completed');
  await worker.evaluate(async tabId => {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId }, world: 'ISOLATED',
      func: () => {
        if (!globalThis.__sciQaTurnPersistenceTrace) {
          globalThis.__sciQaTurnPersistenceTrace = [];
          const originalSendMessage = chrome.runtime.sendMessage.bind(chrome.runtime);
          chrome.runtime.sendMessage = async (...args) => {
            const message = args[0] || {};
            const traced = message.type === 'ARTICLE_WORKSPACE_SAVE_TURN' ||
              message.type === 'ARTICLE_WORKSPACE_UPDATE_TURN' ||
              (message.type === 'ARTICLE_WORKSPACE_SAVE_ASSET' &&
                message.relativePath === 'chat/index.json');
            const trace = traced ? {
              phase: 'request',
              type: message.type,
              turnId: message.turnId || message.turn?.turnId || '',
              status: message.turn?.status ||
                message.content?.turns?.at?.(-1)?.status || '',
              blocks: message.turn?.answerBlocks?.length ||
                message.content?.turns?.at?.(-1)?.answerBlocks?.length || 0,
              clientUpdatedAt: message.turn?.updatedAt || 0,
              at: Date.now()
            } : null;
            if (trace) globalThis.__sciQaTurnPersistenceTrace.push(trace);
            const response = await originalSendMessage(...args);
            if (trace) globalThis.__sciQaTurnPersistenceTrace.push({
              ...trace,
              phase: 'response',
              savedStatus: response?.data?.turn?.status || '',
              savedBlocks: response?.data?.turn?.answerBlocks?.length || 0,
              success: response?.success === true,
              errorCode: response?.error?.code || '',
              at: Date.now()
            });
            return response;
          };
        }
        return clearArticleChat();
      }
    });
    return result;
  }, fixtureTab.id);
  await sidePanel.evaluate(async () => {
    await loadLlmSettings();
    await refreshArticleWorkspace();
    switchWorkspaceView('chat');
    const select = document.getElementById('articleChatProfile');
    select.value = 'profile_qa_stream';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const streamingComposerQa = await sidePanel.evaluate(() => ({
    effectiveMode: llmSettingsState?.effectiveMode || '',
    selectedProfileId: articleChatSelectedProfileId,
    selectValue: document.getElementById('articleChatProfile')?.value || '',
    profileOptions: Array.from(document.querySelectorAll('#articleChatProfile option'))
      .map(option => ({ value: option.value, text: option.textContent })),
    sendDisabled: document.getElementById('sendArticleChat')?.disabled === true
  }));
  if (streamingComposerQa.sendDisabled ||
      streamingComposerQa.selectValue !== 'profile_qa_stream') {
    throw new Error(`Streaming chat profile unavailable: ${JSON.stringify({
      streamingProfileQa, streamingComposerQa
    })}`);
  }
  await sidePanel.locator('#articleChatQuestion').fill(
    '请分步骤说明作者如何从相关性推进到必要性证据。'
  );
  await sidePanel.locator('#sendArticleChat').click();
  try {
    await sidePanel.waitForFunction(() => {
      const turn = document.querySelector('.article-chat-turn:last-child');
      return turn?.querySelectorAll('.article-chat-answer-block').length === 1 &&
        turn.textContent.includes('锁定候选通路') &&
        turn.textContent.includes('正在继续生成');
    }, null, { timeout: 5000 });
  } catch (error) {
    const sideState = await sidePanel.evaluate(() => ({
      text: document.querySelector('.article-chat-turn:last-child')?.textContent || '',
      html: document.querySelector('.article-chat-turn:last-child')?.outerHTML || '',
      status: document.getElementById('status')?.textContent || ''
    }));
    const contentState = await worker.evaluate(async tabId => {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId }, world: 'ISOLATED',
        func: () => ({
          state: getPublicArticleChatState(),
          workspaceId: currentArticleWorkspace?.workspaceId || ''
        })
      });
      return result;
    }, fixtureTab.id);
    throw new Error(`Streaming block did not render: ${JSON.stringify({
      sideState,
      contentState,
      requestCount: streamRequests.length,
      requestUrls: streamRequests.map(item => item?.model || ''),
      consoleErrors
    })}; original=${error.message}`);
  }
  const streamingMidUiQa = await sidePanel.evaluate(() => {
    const turn = document.querySelector('.article-chat-turn:last-child');
    return {
      renderedBlocks: turn?.querySelectorAll('.article-chat-answer-block').length || 0,
      visibleText: turn?.textContent || '',
      citationButtons: turn?.querySelectorAll('.article-chat-inline-citation').length || 0,
      actionsHiddenWhileGenerating:
        (turn?.querySelectorAll('.article-chat-turn-action').length || 0) === 0
    };
  });
  const streamingMidStateQa = await worker.evaluate(async tabId => {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId }, world: 'ISOLATED',
      func: () => {
        const turn = articleChatState.turns.at(-1);
        return {
          turnId: turn?.turnId || '',
          status: turn?.status || '',
          blocks: turn?.answerBlocks?.length || 0,
          continuationCount: turn?.continuationCount || 0,
          loading: articleChatState.loading === true,
          workspaceId: currentArticleWorkspace?.workspaceId || ''
        };
      }
    });
    return result;
  }, fixtureTab.id);
  const streamRequestStartedAt = Date.now();
  while (streamRequests.length < 2 && Date.now() - streamRequestStartedAt < 3000) {
    await sidePanel.waitForTimeout(10);
  }
  const continuationPrompt = JSON.stringify(streamRequests[1] || {});
  const streamingContinuationQa = {
    requestCountBeforeRelease: streamRequests.length,
    promptIncludesPriorBlock: continuationPrompt.includes('stream-step-1'),
    promptIncludesContinuationContract: continuationPrompt.includes('continue_after_block_ids'),
    firstMaxOutputTokens: Number(streamRequests[0]?.max_tokens) || 0,
    continuationMaxOutputTokens: Number(streamRequests[1]?.max_tokens) || 0
  };
  streamContinuationReleased = true;
  releaseStreamContinuation?.();
  await sidePanel.waitForFunction(() => {
    const turn = document.querySelector('.article-chat-turn:last-child');
    return turn?.querySelectorAll('.article-chat-answer-block').length === 2 &&
      turn.textContent.includes('验证必要性') &&
      !turn.classList.contains('is-generating');
  }, null, { timeout: 5000 });
  const streamingFinalUiQa = await sidePanel.evaluate(() => {
    const turn = document.querySelector('.article-chat-turn:last-child');
    return {
      renderedBlocks: turn?.querySelectorAll('.article-chat-answer-block').length || 0,
      blockIds: Array.from(turn?.querySelectorAll('[data-block-id]') || [])
        .map(node => node.dataset.blockId),
      citationButtons: turn?.querySelectorAll('.article-chat-inline-citation').length || 0,
      citationNumbers: Array.from(
        turn?.querySelectorAll('.article-chat-inline-citation') || []
      ).map(button => button.textContent?.trim() || ''),
      statusText: turn?.querySelector('.article-chat-turn-status')?.textContent || '',
      actions: Array.from(turn?.querySelectorAll('.article-chat-turn-action') || [])
        .map(button => button.dataset.articleChatAction)
    };
  });
  const streamingFinalStateQa = await worker.evaluate(async tabId => {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId }, world: 'ISOLATED',
      func: () => {
        const turn = articleChatState.turns.at(-1);
        return {
          turnId: turn?.turnId || '',
          status: turn?.status || '',
          blocks: turn?.answerBlocks?.length || 0,
          blockIds: turn?.answerBlocks?.map(block => block.blockId) || [],
          continuationCount: turn?.continuationCount || 0,
          model: turn?.model || '',
          loading: articleChatState.loading === true
        };
      }
    });
    return result;
  }, fixtureTab.id);
  let streamingPersistedQa = false;
  let streamingPersistedDetails = null;
  const streamingPersistStartedAt = Date.now();
  while (!streamingPersistedQa && Date.now() - streamingPersistStartedAt < 15000) {
    streamingPersistedDetails = await worker.evaluate(async ({ workspaceId, tabId, turnId }) => {
      const [{ result: response }] = await chrome.scripting.executeScript({
        target: { tabId }, world: 'ISOLATED',
        func: workspaceId => chrome.runtime.sendMessage({
          type: 'ARTICLE_WORKSPACE_EXPORT', workspaceId
        }),
        args: [workspaceId]
      });
      if (!response?.success) return {
        passed: false,
        workspaceId,
        turnId,
        responseError: response?.error || null
      };
      const stored = response.data.turns.find(turn => turn.turnId === turnId);
      const index = response.data.assets.find(asset =>
        asset.relativePath === 'chat/index.json');
      const indexed = index?.content?.turns?.find(turn => turn.turnId === turnId);
      const passed = stored?.status === 'completed' && stored.answerBlocks?.length === 2 &&
        indexed?.status === 'completed' && indexed.answerBlocks?.length === 2;
      return {
        passed,
        workspaceId,
        turnId,
        storedStatus: stored?.status || '',
        storedBlocks: stored?.answerBlocks?.length || 0,
        indexedStatus: indexed?.status || '',
        indexedBlocks: indexed?.answerBlocks?.length || 0,
        storedTurnIds: response.data.turns.map(turn => turn.turnId),
        indexedTurnIds: Array.isArray(index?.content?.turns)
          ? index.content.turns.map(turn => turn.turnId) : [],
        assetPaths: response.data.assets.map(asset => asset.relativePath)
      };
    }, {
      workspaceId: streamingMidStateQa.workspaceId,
      tabId: fixtureTab.id,
      turnId: streamingFinalStateQa.turnId
    });
    streamingPersistedQa = streamingPersistedDetails?.passed === true;
    if (!streamingPersistedQa) await sidePanel.waitForTimeout(50);
  }
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(
    path.join(outputDir, 'streaming-persistence-diagnostic.json'),
    `${JSON.stringify({
      streamingMidStateQa,
      streamingFinalStateQa,
      streamingPersistedQa,
      streamingPersistedDetails,
      persistenceTrace: await worker.evaluate(async tabId => {
        const [{ result }] = await chrome.scripting.executeScript({
          target: { tabId }, world: 'ISOLATED',
          func: () => globalThis.__sciQaTurnPersistenceTrace || []
        });
        return result;
      }, fixtureTab.id)
    }, null, 2)}\n`,
    'utf8'
  );
  if (process.env.SCI_QA_STOP_AFTER_STREAMING === '1') {
    throw new Error('QA_STOP_AFTER_STREAMING');
  }
  const panelCapacityResponse = await worker.evaluate(async tabId => {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId }, world: 'ISOLATED',
      func: async () => chrome.runtime.sendMessage({
        type: 'LLM_ANALYZE_FIGURE_PANEL',
        workspaceLifecycle: articleWorkspaceLifecycleGeneration,
        operationId: 'qa-panel-capacity',
        documentHash: 'b'.repeat(64),
        document: {
          title: 'Panel capacity QA',
          documentHash: 'b'.repeat(64)
        },
        figure: {
          figureId: 'figure-91',
          figureLabel: 'Figure capacity QA',
          caption: 'Figure capacity QA. (A) Treatment reduced the target phenotype compared with matched control.',
          panelHints: ['A'],
          contextParagraphs: [
            {
              paragraphId: 'panel-r1',
              sectionTitle: 'Results',
              text: 'Figure capacity QA Panel A compares treatment with matched control.'
            },
            {
              paragraphId: 'panel-m1',
              sectionTitle: 'Methods',
              text: 'Samples were randomized before the same assay was applied.'
            }
          ],
          imageVariants: [
            {
              mediaType: 'image/jpeg',
              dataUrl: `data:image/jpeg;base64,${'A'.repeat(1200)}`,
              width: 1200,
              height: 900,
              maxEdge: 1200,
              inputMode: 'figure_image',
              pixelsSupplied: true
            },
            {
              mediaType: 'image/jpeg',
              dataUrl: `data:image/jpeg;base64,${'A'.repeat(960)}`,
              width: 960,
              height: 720,
              maxEdge: 960,
              inputMode: 'figure_image',
              pixelsSupplied: true
            },
            {
              mediaType: 'image/jpeg',
              dataUrl: `data:image/jpeg;base64,${'A'.repeat(768)}`,
              width: 768,
              height: 576,
              maxEdge: 768,
              inputMode: 'figure_image',
              pixelsSupplied: true
            }
          ]
        },
        panel: { panel: 'A' },
        forceRefresh: true
      })
    });
    return result;
  }, fixtureTab.id);
  const panelCapacityQa = {
    success: panelCapacityResponse?.success === true,
    error: panelCapacityResponse?.error || null,
    requestCount: panelCapacityRequests.length,
    imageLengths: panelCapacityRequests.map(item => item.imageLength),
    outputBudgets: panelCapacityRequests.map(item => item.maxTokens),
    allRequestsHaveImages: panelCapacityRequests.every(item => item.hasImage),
    panel: panelCapacityResponse?.data?.panelAnalysis?.panel || '',
    basis: panelCapacityResponse?.data?.panelAnalysis?.basis || '',
    attempts: panelCapacityResponse?.data?.panelAnalysis?.inputBasis?.attempts || 0,
    inputMode: panelCapacityResponse?.data?.panelAnalysis?.inputBasis?.inputMode || '',
    imageMaxEdge: panelCapacityResponse?.data?.panelAnalysis?.inputBasis?.imageMaxEdge || 0,
    outputBudgetTokens:
      panelCapacityResponse?.data?.panelAnalysis?.inputBasis?.outputBudgetTokens || 0,
    routeModel: panelCapacityResponse?.data?.route?.model || ''
  };
  const panelTruncationResponse = await worker.evaluate(async tabId => {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId }, world: 'ISOLATED',
      func: async () => chrome.runtime.sendMessage({
        type: 'LLM_ANALYZE_FIGURE_PANEL',
        workspaceLifecycle: articleWorkspaceLifecycleGeneration,
        operationId: 'qa-panel-output-expansion',
        documentHash: 'c'.repeat(64),
        document: {
          title: 'Panel output expansion QA',
          documentHash: 'c'.repeat(64)
        },
        figure: {
          figureId: 'figure-92',
          figureLabel: 'Figure output expansion QA',
          caption: 'Figure output expansion QA. (A) Treatment reduced the target phenotype compared with matched control.',
          panelHints: ['A'],
          contextParagraphs: [{
            paragraphId: 'panel-output-r1',
            sectionTitle: 'Results',
            text: 'Figure output expansion QA Panel A compares treatment with matched control.'
          }],
          imageVariants: [
            {
              mediaType: 'image/jpeg',
              dataUrl: `data:image/jpeg;base64,${'A'.repeat(1200)}`,
              width: 1200, height: 900, maxEdge: 1200,
              inputMode: 'figure_image', pixelsSupplied: true
            },
            {
              mediaType: 'image/jpeg',
              dataUrl: `data:image/jpeg;base64,${'A'.repeat(960)}`,
              width: 960, height: 720, maxEdge: 960,
              inputMode: 'figure_image', pixelsSupplied: true
            }
          ]
        },
        panel: { panel: 'A' },
        forceRefresh: true
      })
    });
    return result;
  }, fixtureTab.id);
  const panelTruncationQa = {
    success: panelTruncationResponse?.success === true,
    error: panelTruncationResponse?.error || null,
    requestCount: panelTruncationRequests.length,
    imageLengths: panelTruncationRequests.map(item => item.imageLength),
    outputBudgets: panelTruncationRequests.map(item => item.maxTokens),
    allRequestsHaveImages: panelTruncationRequests.every(item => item.hasImage),
    panel: panelTruncationResponse?.data?.panelAnalysis?.panel || '',
    attempts: panelTruncationResponse?.data?.panelAnalysis?.inputBasis?.attempts || 0,
    imageMaxEdge:
      panelTruncationResponse?.data?.panelAnalysis?.inputBasis?.imageMaxEdge || 0,
    outputBudgetTokens:
      panelTruncationResponse?.data?.panelAnalysis?.inputBasis?.outputBudgetTokens || 0
  };
  reportQaStage('starting unlabeled single-Figure side-panel scenario');
  const unlabeledFigureSetupQa = await worker.evaluate(async tabId => {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId }, world: 'ISOLATED',
      func: () => {
        globalThis.__sciQaUnlabeledFigurePrevious = {
          inventory: figureWorkspaceInventory,
          walkthrough: Array.from(figureWalkthroughState.entries()),
          progress: Array.from(figureProgressById.entries()),
          restored: restoredFigureWorkspaceSnapshot,
          lastAnalysis: lastFigureAnalysis,
          analysisStatus: figureAnalysisStatus,
          crossFigure: crossFigureLogicState
        };
        const figure = {
          figureId: 'figure-77',
          figureLabel: 'Figure 77',
          caption: 'Figure 77. Treatment reduced the target phenotype compared with matched control; independent validation is required.',
          panelHints: [],
          contextParagraphs: [{
            paragraphId: 'unlabeled-r1',
            sectionTitle: 'Results',
            text: 'Treatment reduced the target phenotype compared with the matched control.'
          }],
          imageElements: [],
          isSupplemental: false
        };
        figureWorkspaceInventory = [figure];
        figureWalkthroughState.clear();
        figureProgressById.clear();
        restoredFigureWorkspaceSnapshot = null;
        lastFigureAnalysis = null;
        crossFigureLogicState = { result: null, loading: false, error: '' };
        figureAnalysisStatus = {
          running: false, paused: false, phase: 'idle', currentFigure: 0,
          totalFigures: 1, completedFigures: 0, failedFigures: 0,
          figureProgress: [], failures: []
        };
        const state = ensureFigureWalkthroughState(figure.figureId);
        state.expanded = true;
        return {
          figureId: figure.figureId,
          panelHints: figure.panelHints.length,
          snapshotFigures: buildFigureWorkspaceSnapshot().figures.length
        };
      }
    });
    return result;
  }, fixtureTab.id);
  await sidePanel.evaluate(async () => {
    switchWorkspaceView('figures');
    await refreshArticleWorkspace();
  });
  const unlabeledFigureCard = sidePanel.locator(
    '.workspace-figure-card[data-figure-id="figure-77"]'
  );
  await unlabeledFigureCard.waitFor({ state: 'visible' });
  if (!await unlabeledFigureCard.evaluate(card => card.open)) {
    await unlabeledFigureCard.locator('summary').first().click();
  }
  await unlabeledFigureCard.locator('.workspace-figure-analyze-action').click();
  const unlabeledFigureCompleted = await sidePanel.waitForFunction(() => {
    const figure = currentWorkspaceSnapshot?.figures?.figures?.find(
      item => item.figureId === 'figure-77'
    );
    const card = document.querySelector(
      '.workspace-figure-card[data-figure-id="figure-77"]'
    );
    return figure?.standard?.unlabeledOverview === true && figure.deepLoading !== true &&
      /解图|重新精读此图/.test(
        card?.querySelector('.workspace-figure-analyze-action')?.textContent || ''
      ) && /已完成 figure-77 的单图精读/.test(
        document.getElementById('statusMessage')?.textContent || ''
      );
  }, null, { timeout: 15000 }).then(() => true).catch(() => false);
  if (!unlabeledFigureCompleted) {
    const diagnostic = await sidePanel.evaluate(() => {
      const figure = currentWorkspaceSnapshot?.figures?.figures?.find(
        item => item.figureId === 'figure-77'
      );
      const card = document.querySelector(
        '.workspace-figure-card[data-figure-id="figure-77"]'
      );
      return {
        llmReady: llmSettingsState?.llmReady,
        effectiveMode: llmSettingsState?.effectiveMode,
        analysisMode,
        buttonText:
          card?.querySelector('.workspace-figure-analyze-action')?.textContent || '',
        buttonDisabled:
          card?.querySelector('.workspace-figure-analyze-action')?.disabled === true,
        status: document.getElementById('statusMessage')?.textContent || '',
        figure: figure ? {
          deepLoading: figure.deepLoading,
          deepError: figure.deepError,
          standardError: figure.standardError,
          hasStandard: Boolean(figure.standard),
          hasDeep: Boolean(figure.deep),
          unlabeledOverview: figure.standard?.unlabeledOverview
        } : null
      };
    });
    throw new Error(`Unlabeled Figure UI did not complete: ${JSON.stringify(diagnostic)}`);
  }
  const unlabeledFigureUiQa = await sidePanel.evaluate(() => {
    const card = document.querySelector(
      '.workspace-figure-card[data-figure-id="figure-77"]'
    );
    const buttonText = card?.querySelector('.workspace-figure-analyze-action')?.textContent || '';
    const figure = currentWorkspaceSnapshot?.figures?.figures?.find(
      item => item.figureId === 'figure-77'
    );
    return {
      cardOpen: card?.open === true,
      completed:
        figure?.standard?.unlabeledOverview === true &&
        figure.deepLoading !== true &&
        /解图|重新精读此图/.test(buttonText),
      summaryText: card?.querySelector('summary')?.textContent || '',
      noteVisible: /未提供稳定的 Panel 标签/.test(card?.textContent || ''),
      conclusionVisible: /处理与目标表型下降相关/.test(card?.textContent || ''),
      boundaryVisible: /不能证明直接分子机制/.test(card?.textContent || ''),
      overviewFields:
        card?.querySelectorAll('.workspace-figure-overview .workspace-figure-view-field').length || 0,
      chainSteps: card?.querySelectorAll('.workspace-figure-chain-step').length || 0,
      panelCards: card?.querySelectorAll('.workspace-figure-panel-card').length || 0,
      fakePanelLabels: Array.from(card?.querySelectorAll('.workspace-figure-field-label') || [])
        .filter(node => /^Panel\b/i.test(node.textContent || '')).length,
      buttonText,
      statusText: document.getElementById('statusMessage')?.textContent || ''
    };
  });
  const unlabeledFigurePersistedQa = await worker.evaluate(async tabId => {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId }, world: 'ISOLATED',
      func: async () => {
        let persisted = null;
        const startedAt = Date.now();
        while (Date.now() - startedAt < 5000) {
          const response = await chrome.runtime.sendMessage({
            type: 'ARTICLE_WORKSPACE_EXPORT',
            workspaceId: currentArticleWorkspace?.workspaceId || ''
          });
          const asset = response?.data?.assets?.find(
            item => item.relativePath === 'figures/inventory.json'
          );
          persisted = asset?.content?.figures?.find(
            item => item.figureId === 'figure-77'
          )?.standard || null;
          if (persisted?.unlabeledOverview === true) break;
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        const state = figureWalkthroughState.get('figure-77');
        return {
          inMemory: state?.standard?.unlabeledOverview === true,
          persisted: persisted?.unlabeledOverview === true,
          argumentSteps: persisted?.argumentChain?.length || 0,
          panels: persisted?.panels?.length || 0,
          standardError: state?.standardError || ''
        };
      }
    });
    return result;
  }, fixtureTab.id);
  const unlabeledSingleFigureQa = {
    setup: unlabeledFigureSetupQa,
    ui: unlabeledFigureUiQa,
    persisted: unlabeledFigurePersistedQa,
    requestCount: unlabeledFigureRequests.length,
    requests: unlabeledFigureRequests
  };
  reportQaStage('starting real side-panel Panel interpretation and follow-up scenario');
  const panelUiSetupQa = await worker.evaluate(async tabId => {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId }, world: 'ISOLATED',
      func: () => {
        const figure = {
          figureId: 'figure-78',
          figureLabel: 'Figure 78',
          caption: 'Figure 78. (A) Treatment reduced the target phenotype compared with the matched control.',
          panelHints: ['A'],
          contextParagraphs: [{
            paragraphId: 'panel-ui-r1',
            sectionTitle: 'Results',
            text: 'Figure 78A compares the treated group with a matched control group.'
          }],
          imageElements: [],
          isSupplemental: false
        };
        figureWorkspaceInventory = [figure];
        figureWalkthroughState.clear();
        figureProgressById.clear();
        restoredFigureWorkspaceSnapshot = null;
        lastFigureAnalysis = null;
        crossFigureLogicState = { result: null, loading: false, error: '' };
        figureAnalysisStatus = {
          running: false, paused: false, phase: 'idle', currentFigure: 0,
          totalFigures: 1, completedFigures: 0, failedFigures: 0,
          figureProgress: [], failures: []
        };
        const state = ensureFigureWalkthroughState(figure.figureId);
        state.expanded = true;
        return {
          figureId: figure.figureId,
          panels: figure.panelHints,
          snapshotFigures: buildFigureWorkspaceSnapshot().figures.length
        };
      }
    });
    return result;
  }, fixtureTab.id);
  await sidePanel.evaluate(async () => {
    switchWorkspaceView('figures');
    await refreshArticleWorkspace();
  });
  const panelUiFigureCard = sidePanel.locator(
    '.workspace-figure-card[data-figure-id="figure-78"]'
  );
  await panelUiFigureCard.waitFor({ state: 'visible' });
  if (!await panelUiFigureCard.evaluate(card => card.open)) {
    await panelUiFigureCard.locator('summary').first().click();
  }
  const panelUiCard = panelUiFigureCard.locator(
    '.workspace-figure-panel-card[data-panel-id="A"]'
  );
  if (!await panelUiCard.evaluate(card => card.open)) {
    await panelUiCard.locator('summary').first().click();
  }
  await panelUiCard.locator('.workspace-panel-analyze').click();
  await sidePanel.waitForFunction(() => {
    const figure = currentWorkspaceSnapshot?.figures?.figures?.find(
      item => item.figureId === 'figure-78'
    );
    const card = document.querySelector(
      '.workspace-figure-card[data-figure-id="figure-78"] ' +
      '.workspace-figure-panel-card[data-panel-id="A"]'
    );
    return Boolean(figure?.panelAnalyses?.A?.purpose) &&
      figure?.panelAnalysisLoading?.A !== true &&
      /重新解读此 Panel/.test(card?.querySelector('.workspace-panel-analyze')?.textContent || '');
  }, null, { timeout: 20000 });
  const panelUiInterpretationQa = await sidePanel.evaluate(() => {
    const card = document.querySelector(
      '.workspace-figure-card[data-figure-id="figure-78"] ' +
      '.workspace-figure-panel-card[data-panel-id="A"]'
    );
    const figure = currentWorkspaceSnapshot?.figures?.figures?.find(
      item => item.figureId === 'figure-78'
    );
    return {
      figureOpen: card?.closest('.workspace-figure-card')?.open === true,
      panelOpen: card?.open === true,
      buttonText: card?.querySelector('.workspace-panel-analyze')?.textContent || '',
      text: card?.textContent || '',
      inputBasis: Array.from(card?.querySelectorAll('.workspace-figure-field') || [])
        .find(field => /本次解读依据/.test(field.textContent || ''))?.textContent || '',
      error: figure?.panelAnalysisErrors?.A || '',
      attempts: figure?.panelAnalyses?.A?.inputBasis?.attempts || 0,
      inputMode: figure?.panelAnalyses?.A?.inputBasis?.inputMode || ''
    };
  });
  await panelUiCard.locator('.workspace-panel-ask').click();
  await panelUiCard.locator(
    '.workspace-panel-followup-options input[value="grouping"]'
  ).check();
  await panelUiCard.locator('.workspace-panel-followup-custom textarea')
    .fill('为什么匹配对照对于解释这个 Panel 很重要？');
  await panelUiCard.locator('.workspace-panel-followup-submit').click();
  try {
    await sidePanel.waitForFunction(() => {
      const answer = document.querySelector(
        '[data-panel-followup-answer="figure-78::A"]'
      );
      return /匹配对照使主要差异集中于处理因素/.test(answer?.textContent || '');
    }, null, { timeout: 20000 });
  } catch (error) {
    const diagnostic = await sidePanel.evaluate(() => {
      const figure = currentWorkspaceSnapshot?.figures?.figures?.find(
        item => item.figureId === 'figure-78'
      );
      const answer = document.querySelector(
        '[data-panel-followup-answer="figure-78::A"]'
      );
      return {
        answerText: answer?.textContent || '',
        loading: figure?.panelFollowupLoading?.A === true,
        followup: figure?.panelFollowups?.A || null,
        error: figure?.panelFollowupErrors?.A || '',
        status: document.getElementById('statusMessage')?.textContent || ''
      };
    });
    throw new Error(`Panel follow-up did not render: ${JSON.stringify({
      diagnostic,
      requests: panelUiFollowupRequests,
      pageErrors,
      consoleErrors,
      cause: error.message
    })}`);
  }
  await sidePanel.waitForFunction(() => {
    const answer = document.querySelector('[data-panel-followup-answer="figure-78::A"]');
    const view = document.querySelector('[data-workspace-view="figures"]');
    const answerRect = answer?.getBoundingClientRect();
    const viewRect = view?.getBoundingClientRect();
    return document.activeElement === answer && Boolean(
      answerRect && viewRect && answerRect.bottom >= viewRect.top && answerRect.top <= viewRect.bottom
    );
  }, null, { timeout: 3000 });
  const panelUiFollowupQa = await sidePanel.evaluate(() => {
    const answer = document.querySelector(
      '[data-panel-followup-answer="figure-78::A"]'
    );
    const card = answer?.closest('.workspace-figure-panel-card');
    const followup = answer?.closest('.workspace-panel-followup');
    const view = document.querySelector('[data-workspace-view="figures"]');
    const answerRect = answer?.getBoundingClientRect();
    const viewRect = view?.getBoundingClientRect();
    const figure = currentWorkspaceSnapshot?.figures?.figures?.find(
      item => item.figureId === 'figure-78'
    );
    return {
      rendered: Boolean(answer),
      panelOpen: card?.open === true,
      answerText: answer?.textContent || '',
      questionText: answer?.querySelector('.workspace-panel-followup-question')?.textContent || '',
      statusText: followup?.querySelector('.workspace-panel-followup-status')?.textContent || '',
      focused: document.activeElement === answer,
      inViewport: Boolean(answerRect && viewRect && answerRect.bottom >= viewRect.top &&
        answerRect.top <= viewRect.bottom),
      historyLength: figure?.panelFollowupHistories?.A?.length || 0,
      loading: figure?.panelFollowupLoading?.A === true,
      error: figure?.panelFollowupErrors?.A || '',
      attempts: figure?.panelFollowups?.A?.inputBasis?.attempts || 0
    };
  });
  const panelUiPersistedQa = await worker.evaluate(async tabId => {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId }, world: 'ISOLATED',
      func: async () => {
        let savedFigure = null;
        const startedAt = Date.now();
        while (Date.now() - startedAt < 5000) {
          const response = await chrome.runtime.sendMessage({
            type: 'ARTICLE_WORKSPACE_EXPORT',
            workspaceId: currentArticleWorkspace?.workspaceId || ''
          });
          const asset = response?.data?.assets?.find(
            item => item.relativePath === 'figures/inventory.json'
          );
          savedFigure = asset?.content?.figures?.find(item => item.figureId === 'figure-78') || null;
          if (savedFigure?.panelAnalyses?.A && savedFigure?.panelFollowups?.A &&
              savedFigure?.panelFollowupHistories?.A?.length === 2) break;
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        const state = figureWalkthroughState.get('figure-78');
        return {
          analysisInMemory: Boolean(state?.panelAnalyses?.A),
          followupInMemory: Boolean(state?.panelFollowups?.A),
          historyInMemory: state?.panelFollowupHistories?.A?.length || 0,
          analysisPersisted: Boolean(savedFigure?.panelAnalyses?.A),
          followupPersisted: Boolean(savedFigure?.panelFollowups?.A),
          historyPersisted: savedFigure?.panelFollowupHistories?.A?.length || 0
        };
      }
    });
    return result;
  }, fixtureTab.id);
  const panelUiEndToEndQa = {
    setup: panelUiSetupQa,
    interpretation: panelUiInterpretationQa,
    followup: panelUiFollowupQa,
    persisted: panelUiPersistedQa,
    interpretationRequests: panelUiInterpretationRequests,
    followupRequests: panelUiFollowupRequests
  };
  await worker.evaluate(async tabId => {
    await chrome.scripting.executeScript({
      target: { tabId }, world: 'ISOLATED',
      func: async () => {
        const previous = globalThis.__sciQaUnlabeledFigurePrevious;
        if (!previous) return;
        figureWorkspaceInventory = previous.inventory;
        figureWalkthroughState.clear();
        previous.walkthrough.forEach(([key, value]) => figureWalkthroughState.set(key, value));
        figureProgressById.clear();
        previous.progress.forEach(([key, value]) => figureProgressById.set(key, value));
        restoredFigureWorkspaceSnapshot = previous.restored;
        lastFigureAnalysis = previous.lastAnalysis;
        figureAnalysisStatus = previous.analysisStatus;
        crossFigureLogicState = previous.crossFigure;
        delete globalThis.__sciQaUnlabeledFigurePrevious;
        scheduleArticleWorkspaceArtifactsSave({ immediate: true });
        await articleWorkspaceMutationTail;
      }
    });
  }, fixtureTab.id);
  await sidePanel.evaluate(() => refreshArticleWorkspace());
  await closeHttpServer(streamServer);
  analysisProviderServer = null;
  reportQaStage('streaming chat, Panel, and unlabeled Figure provider scenarios completed');
  await worker.evaluate(async tabId => {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId }, world: 'ISOLATED',
      func: async () => {
        clearArticleChat();
        await articleWorkspaceMutationTail;
        return { turns: articleChatState.turns.length };
      }
    });
    return result;
  }, fixtureTab.id);

  const largeChatHistorySetup = await worker.evaluate(async tabId => {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId }, world: 'ISOLATED',
      func: () => {
        const turns = Array.from({ length: 95 }, (_, index) => {
          const sequence = index + 1;
          const padded = String(sequence).padStart(3, '0');
          const turn = createArticleChatTurn(
            '历史问题 ' + padded,
            'profile_qa_openai',
            { turnId: 'turn-history-' + padded }
          );
          turn.answerBlocks = [{
            blockId: 'block-history-' + sequence,
            markdown: '**历史回答 ' + sequence + '**：用于验证无限问答分页。',
            evidence: [],
            createdAt: turn.createdAt
          }];
          turn.status = 'completed';
          turn.profileName = 'GPT 5 Mini';
          turn.model = 'gpt-5-mini';
          turn.updatedAt = turn.createdAt;
          return turn;
        });
        articleChatGeneration += 1;
        articleChatPumpPromise = null;
        articleChatState = {
          turns,
          loading: false,
          error: '',
          operationId: '',
          activeTurnId: '',
          coverage: null,
          memoryNeedsRebuild: false
        };
        notifyArticleChatStateChanged('workspace_restored');
        return { totalTurns: turns.length };
      }
    });
    return result;
  }, fixtureTab.id);
  const largeChatInitialQa = await sidePanel.evaluate(async () => {
    articleChatVisibleTurnCount = articleChatHistoryPageSize;
    await refreshArticleWorkspace();
    switchWorkspaceView('chat');
    const turns = currentWorkspaceSnapshot?.chat?.turns || [];
    return {
      totalTurns: currentWorkspaceSnapshot?.chat?.totalTurns || 0,
      snapshotTurns: turns.length,
      renderedTurns: document.querySelectorAll('.article-chat-turn').length,
      firstTurnId: document.querySelector('.article-chat-turn')?.dataset.turnId || '',
      lastTurnId: document.querySelector('.article-chat-turn:last-child')?.dataset.turnId || '',
      remainingLabel: document.getElementById('articleChatLoadEarlier')?.textContent || ''
    };
  });
  const loadEarlierHistoryPage = async expectedTurns => sidePanel.evaluate(async expected => {
    const container = document.getElementById('articleChatMessages');
    const anchor = container?.querySelector('.article-chat-turn');
    if (container) container.scrollTop = 0;
    const anchorBefore = anchor?.getBoundingClientRect().top || 0;
    const startedAt = performance.now();
    document.getElementById('articleChatLoadEarlier')?.click();
    while ((document.querySelectorAll('.article-chat-turn').length !== expected ||
        document.getElementById('articleChatLoadEarlier')?.disabled) &&
        performance.now() - startedAt < 1800) {
      await new Promise(resolve => setTimeout(resolve, 8));
    }
    await new Promise(resolve => setTimeout(resolve, 20));
    const anchorAfter = anchor?.getBoundingClientRect().top || 0;
    const turns = currentWorkspaceSnapshot?.chat?.turns || [];
    return {
      loadMs: Math.round(performance.now() - startedAt),
      snapshotTurns: turns.length,
      renderedTurns: document.querySelectorAll('.article-chat-turn').length,
      firstTurnId: document.querySelector('.article-chat-turn')?.dataset.turnId || '',
      anchorShiftPx: Math.round(Math.abs(anchorAfter - anchorBefore)),
      remainingLabel: document.getElementById('articleChatLoadEarlier')?.textContent || '',
      loadButtonHidden: document.getElementById('articleChatLoadEarlier')?.hidden === true
    };
  }, expectedTurns);
  const largeChatPage2Qa = await loadEarlierHistoryPage(60);
  const largeChatPage3Qa = await loadEarlierHistoryPage(90);
  const largeChatPage4Qa = await loadEarlierHistoryPage(95);
  await sidePanel.locator(
    '[data-turn-id="turn-history-001"] [data-article-chat-action="delete-turn"]'
  ).click();
  await sidePanel.waitForFunction(() =>
    !document.querySelector('[data-turn-id="turn-history-001"]') &&
    document.querySelectorAll('.article-chat-turn').length === 94
  );
  const largeChatDeleteQa = await sidePanel.evaluate(() => ({
    totalTurns: currentWorkspaceSnapshot?.chat?.totalTurns || 0,
    snapshotTurns: currentWorkspaceSnapshot?.chat?.turns?.length || 0,
    renderedTurns: document.querySelectorAll('.article-chat-turn').length,
    deletedAbsent: !document.querySelector('[data-turn-id="turn-history-001"]')
  }));
  reportQaStage('large chat history scenarios completed');

  const chatMutationSetup = await worker.evaluate(async tabId => {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'ISOLATED',
      func: async () => {
        const completedTurn = (turnId, question, answer) => {
          const turn = createArticleChatTurn(question, 'profile_qa_openai', { turnId });
          turn.answerBlocks = [{
            blockId: `block-${turnId}`,
            markdown: answer,
            evidence: [],
            createdAt: Date.now()
          }];
          turn.status = 'completed';
          turn.profileName = 'GPT 5 Mini';
          turn.model = 'gpt-5-mini';
          turn.updatedAt = Date.now();
          return turn;
        };
        const first = completedTurn(
          'turn-ui-first', '第一个待删除的问题', '第一个回答。'
        );
        const second = completedTurn(
          'turn-ui-regenerate', '请重新生成这个回答', '旧回答。'
        );
        const queued = createArticleChatTurn(
          '这个排队问题应当可以直接删除', 'profile_qa_openai',
          { turnId: 'turn-ui-queued' }
        );
        articleChatGeneration += 1;
        articleChatPumpPromise = null;
        articleChatState = {
          turns: [first, second, queued],
          loading: false,
          error: '',
          operationId: '',
          activeTurnId: '',
          coverage: null,
          memoryNeedsRebuild: false
        };
        for (const turn of articleChatState.turns) {
          await persistWorkspaceTurnCheckpoint(turn, { append: true, force: true });
        }
        await persistArticleWorkspaceArtifacts({ force: true });
        notifyArticleChatStateChanged('workspace_restored');
        return {
          workspaceId: currentArticleWorkspace?.workspaceId || '',
          turnIds: articleChatState.turns.map(turn => turn.turnId)
        };
      }
    });
    return result;
  }, fixtureTab.id);
  await sidePanel.evaluate(async () => {
    await refreshArticleWorkspace();
    switchWorkspaceView('chat');
  });
  await sidePanel.waitForFunction(() =>
    document.querySelectorAll('.article-chat-turn').length === 3
  );
  await sidePanel.locator(
    '[data-article-chat-action="delete-queued"][data-turn-id="turn-ui-queued"]'
  ).click();
  await sidePanel.waitForFunction(() =>
    !document.querySelector('[data-turn-id="turn-ui-queued"]') &&
    document.querySelectorAll('.article-chat-turn').length === 2
  );
  const queuedDeleteState = await worker.evaluate(async tabId => {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId }, world: 'ISOLATED',
      func: () => ({
        turnIds: articleChatState.turns.map(turn => turn.turnId),
        queuedRemaining: articleChatState.turns.some(turn => turn.status === 'queued')
      })
    });
    return result;
  }, fixtureTab.id);

  await sidePanel.locator(
    '[data-article-chat-action="delete-answer"][data-turn-id="turn-ui-regenerate"]'
  ).click();
  await sidePanel.waitForFunction(() => {
    const turn = document.querySelector('[data-turn-id="turn-ui-regenerate"]');
    return Boolean(turn && !turn.querySelector('.article-chat-answer-block') &&
      turn.querySelector('[data-article-chat-action="regenerate"]'));
  });
  const answerDeleteState = await worker.evaluate(async tabId => {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId }, world: 'ISOLATED',
      func: () => {
        const turn = articleChatState.turns.find(item =>
          item.turnId === 'turn-ui-regenerate');
        return {
          status: String(turn?.status || ''),
          answerBlocks: turn?.answerBlocks?.length || 0
        };
      }
    });
    return result;
  }, fixtureTab.id);

  await worker.evaluate(async tabId => {
    await chrome.scripting.executeScript({
      target: { tabId }, world: 'ISOLATED',
      func: () => {
        const original = chrome.runtime.sendMessage.bind(chrome.runtime);
        globalThis.__sciQaOriginalChatMutationSendMessage = original;
        chrome.runtime.sendMessage = async message => {
          if (message?.type === 'LLM_ASK_ARTICLE' &&
              message.turnId === 'turn-ui-regenerate') {
            return {
              success: true,
              data: {
                message: {
                  answerBlocks: [{
                    blockId: 'block-regenerated-qa',
                    markdown: '**重新生成成功**：这是新的完整回答。',
                    evidence: []
                  }],
                  summary: '重新生成成功',
                  status: 'completed'
                },
                route: {
                  effectiveProfileId: 'profile_qa_openai',
                  effectiveProfileName: 'GPT 5 Mini',
                  model: 'gpt-5-mini'
                },
                usage: { inputTokens: 10, outputTokens: 12 },
                coverage: { sentParagraphs: 1, totalParagraphs: 1, truncated: false }
              }
            };
          }
          return original(message);
        };
      }
    });
  }, fixtureTab.id);
  await sidePanel.locator(
    '[data-article-chat-action="regenerate"][data-turn-id="turn-ui-regenerate"]'
  ).click();
  await sidePanel.waitForFunction(() =>
    document.querySelector('[data-turn-id="turn-ui-regenerate"]')
      ?.textContent?.includes('重新生成成功') === true
  );
  const regenerateState = await worker.evaluate(async tabId => {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId }, world: 'ISOLATED',
      func: () => {
        const turn = articleChatState.turns.find(item =>
          item.turnId === 'turn-ui-regenerate');
        const snapshot = {
          status: String(turn?.status || ''),
          answer: String(turn?.answerBlocks?.[0]?.markdown || ''),
          loading: articleChatState.loading === true
        };
        if (globalThis.__sciQaOriginalChatMutationSendMessage) {
          chrome.runtime.sendMessage = globalThis.__sciQaOriginalChatMutationSendMessage;
          delete globalThis.__sciQaOriginalChatMutationSendMessage;
        }
        return snapshot;
      }
    });
    return result;
  }, fixtureTab.id);

  await sidePanel.locator(
    '[data-article-chat-action="delete-turn"][data-turn-id="turn-ui-first"]'
  ).click();
  await sidePanel.waitForFunction(() =>
    !document.querySelector('[data-turn-id="turn-ui-first"]') &&
    document.querySelectorAll('.article-chat-turn').length === 1
  );
  await sidePanel.locator('#clearArticleChat').click();
  await sidePanel.waitForFunction(() =>
    document.querySelectorAll('.article-chat-turn').length === 0
  );
  let chatPersistenceSettled = false;
  const chatPersistenceStartedAt = Date.now();
  while (!chatPersistenceSettled && Date.now() - chatPersistenceStartedAt < 5000) {
    chatPersistenceSettled = await worker.evaluate(async ({ workspaceId, tabId }) => {
      const [{ result: response }] = await chrome.scripting.executeScript({
        target: { tabId }, world: 'ISOLATED',
        func: workspaceId => chrome.runtime.sendMessage({
          type: 'ARTICLE_WORKSPACE_EXPORT', workspaceId
        }),
        args: [workspaceId]
      });
      if (!response?.success) return false;
      const index = response.data.assets.find(asset =>
        asset.relativePath === 'chat/index.json');
      return response.data.turns.length === 0 &&
        Array.isArray(index?.content?.turns) && index.content.turns.length === 0;
    }, { workspaceId: chatMutationSetup.workspaceId, tabId: fixtureTab.id });
    if (!chatPersistenceSettled) await sidePanel.waitForTimeout(50);
  }
  if (!chatPersistenceSettled) {
    const diagnostics = await worker.evaluate(async ({ workspaceId, tabId }) => {
      const [{ result: response }] = await chrome.scripting.executeScript({
        target: { tabId }, world: 'ISOLATED',
        func: workspaceId => chrome.runtime.sendMessage({
          type: 'ARTICLE_WORKSPACE_EXPORT', workspaceId
        }),
        args: [workspaceId]
      });
      const index = response?.data?.assets?.find(asset =>
        asset.relativePath === 'chat/index.json');
      const [{ result: contentState }] = await chrome.scripting.executeScript({
        target: { tabId }, world: 'ISOLATED',
        func: () => ({
          turns: articleChatState.turns.map(turn => ({
            turnId: turn.turnId, status: turn.status,
            blocks: turn.answerBlocks?.length || 0
          })),
          mutationPending: Boolean(articleWorkspaceMutationTail),
          lifecycle: articleWorkspaceLifecycleGeneration
        })
      });
      return {
        success: response?.success,
        storedTurns: response?.data?.turns?.map(turn => ({
          turnId: turn.turnId, status: turn.status,
          blocks: turn.answerBlocks?.length || 0
        })) || [],
        indexTurns: index?.content?.turns?.map(turn => ({
          turnId: turn.turnId, status: turn.status,
          blocks: turn.answerBlocks?.length || 0
        })) || [],
        contentState
      };
    }, { workspaceId: chatMutationSetup.workspaceId, tabId: fixtureTab.id });
    throw new Error(`Chat mutations were not persisted: ${JSON.stringify(diagnostics)}`);
  }
  const chatMutationQa = await worker.evaluate(async ({ workspaceId, tabId }) => {
    const [{ result: response }] = await chrome.scripting.executeScript({
      target: { tabId }, world: 'ISOLATED',
      func: workspaceId => chrome.runtime.sendMessage({
        type: 'ARTICLE_WORKSPACE_EXPORT', workspaceId
      }),
      args: [workspaceId]
    });
    const index = response?.data?.assets?.find(asset =>
      asset.relativePath === 'chat/index.json');
    return {
      setupTurns: 3,
      queuedDeleted: true,
      queuedRemaining: false,
      answerDeleteState: null,
      regenerateState: null,
      finalStoredTurns: response?.data?.turns?.length ?? -1,
      finalIndexTurns: index?.content?.turns?.length ?? -1
    };
  }, { workspaceId: chatMutationSetup.workspaceId, tabId: fixtureTab.id });
  chatMutationQa.queuedDeleted =
    !queuedDeleteState.turnIds.includes('turn-ui-queued');
  chatMutationQa.queuedRemaining = queuedDeleteState.queuedRemaining;
  chatMutationQa.answerDeleteState = answerDeleteState;
  chatMutationQa.regenerateState = regenerateState;

  await fixture.evaluate(() => {
    const section = document.querySelector('article section:nth-of-type(3)');
    const text = 'A dynamically loaded mechanistic paragraph is represented twice by responsive markup but should count once.';
    for (let index = 0; index < 2; index += 1) {
      const paragraph = document.createElement('div');
      paragraph.className = `Paragraph responsive-copy-${index + 1}`;
      paragraph.textContent = text;
      section?.appendChild(paragraph);
    }
  });
  await sidePanel.waitForFunction(() =>
    /7 段正文/.test(document.getElementById('articleNavigationStatus')?.textContent || ''),
    null,
    { timeout: 4000 }
  );
  const dynamicParagraphQa = await sidePanel.evaluate(() => ({
    status: document.getElementById('articleNavigationStatus')?.textContent || '',
    paragraphCount: currentWorkspaceSnapshot?.paragraphs?.length || 0
  }));

  const dynamicMutationFixture = await fixture.evaluate(() => {
    document.querySelectorAll('[class*="responsive-copy-"]').forEach(node => node.remove());
    const firstParagraph = document.querySelector('article section p');
    const marker = ' Character-data mutation is reflected in the live article index.';
    if (firstParagraph?.firstChild) firstParagraph.firstChild.data += marker;
    return { marker };
  });
  await sidePanel.waitForFunction(marker => {
    const paragraphs = currentWorkspaceSnapshot?.paragraphs || [];
    return paragraphs.length === 6 && paragraphs.some(item => item.text.includes(marker));
  }, dynamicMutationFixture.marker, { timeout: 5000 });
  const dynamicRemovalAndTextQa = await sidePanel.evaluate(marker => ({
    paragraphCount: currentWorkspaceSnapshot?.paragraphs?.length || 0,
    removedResponsiveCopies: !(currentWorkspaceSnapshot?.paragraphs || []).some(item =>
      item.text.includes('dynamically loaded mechanistic paragraph')),
    characterDataUpdated: (currentWorkspaceSnapshot?.paragraphs || []).some(item =>
      item.text.includes(marker))
  }), dynamicMutationFixture.marker);

  const rootReplacementFixture = await fixture.evaluate(() => {
    const article = document.querySelector('article');
    const replacement = article?.cloneNode(true);
    const marker = 'Root replacement paragraph must enter navigation and article chat.';
    if (!article || !replacement) return { replaced: false, marker };
    const paragraph = document.createElement('p');
    paragraph.textContent = marker;
    replacement.querySelector('section:last-of-type')?.appendChild(paragraph);
    article.replaceWith(replacement);
    return { replaced: true, marker };
  });
  await sidePanel.waitForFunction(marker => {
    const paragraphs = currentWorkspaceSnapshot?.paragraphs || [];
    return paragraphs.length === 7 && paragraphs.some(item => item.text.includes(marker));
  }, rootReplacementFixture.marker, { timeout: 5000 });
  const articleRootReplacementQa = await sidePanel.evaluate(marker => ({
    replaced: true,
    paragraphCount: currentWorkspaceSnapshot?.paragraphs?.length || 0,
    replacementIndexed: (currentWorkspaceSnapshot?.paragraphs || []).some(item =>
      item.text.includes(marker))
  }), rootReplacementFixture.marker);
  reportQaStage('workspace mutation and dynamic article scenarios completed');

  const options = await context.newPage();
  options.on('pageerror', error => pageErrors.push(`options: ${error.message}`));
  await options.goto(`chrome-extension://${extensionId}/options.html`, {
    waitUntil: 'domcontentloaded'
  });
  const migrationControls = await options.locator(
    '#exportMigrationBundle,#importMigrationBundle,#confirmMigrationImport'
  ).count();
  const supportEmail = await options.locator('#support a[href$="/issues"]').first().textContent();
  await options.waitForFunction(() =>
    document.querySelectorAll('#providerId option').length >= 5 &&
    document.querySelectorAll('#apiProfileList [data-profile-id]').length >= 1
  );
  const panelPromptResetQa = await options.evaluate(() => {
    const field = document.querySelector(
      '#panelFollowupPresetList [data-panel-preset-prompt]'
    );
    const expectedPresets = state?.panelFollowupPresetDefaults || [];
    const expected = expectedPresets[0]?.prompt || '';
    field.value = 'QA modified panel follow-up prompt';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('resetPanelFollowupPrompts').click();
    const restoredField = document.querySelector(
      '#panelFollowupPresetList [data-panel-preset-prompt]'
    );
    const result = {
      restored: restoredField?.value === expected,
      expectedLength: expected.length,
      presetCount:
        document.querySelectorAll('#panelFollowupPresetList .named-prompt-row').length,
      expectedPresetCount: expectedPresets.length,
      editorDirty: profileEditorDirty
    };
    profileEditorDirty = false;
    renderProfileEditor();
    return result;
  });
  await options.evaluate(() => {
    if (onboardingUi.active) leaveOnboardingLayout();
    activateSettingsPage('overview');
  });
  await options.locator('[data-settings-nav="categories"]').first().click();
  await options.locator('#categoryWorkspace').waitFor({ state: 'visible' });
  await options.waitForFunction(() =>
    document.querySelectorAll('#categoryList .category-list-item').length >= 2
  );
  const categoryIds = await options.locator('#categoryList .category-list-item')
    .evaluateAll(buttons => buttons.slice(0, 2).map(button => button.dataset.categoryId));
  const firstCategory = options.locator(
    `#categoryList .category-list-item[data-category-id="${categoryIds[0]}"]`
  );
  const secondCategory = options.locator(
    `#categoryList .category-list-item[data-category-id="${categoryIds[1]}"]`
  );
  await firstCategory.click();
  await options.waitForFunction(categoryId =>
    categoryEditor.categoryId === categoryId && categoryEditor.pending === false,
  categoryIds[0]);
  const originalCategoryName = await options.locator('#categoryName').inputValue();
  await options.locator('#categoryRegexTab').click();
  const initialPhrases = await options.locator('#categoryRegexPhrases').inputValue();
  await options.locator('#categoryRegexPhrases').fill(
    `${initialPhrases}\nQA_MATCH_TOKEN`.trim()
  );
  await options.locator('#categoryRegexTestText').fill(
    'This paragraph contains QA_MATCH_TOKEN for the safe regex laboratory.'
  );
  await options.locator('#testCategoryRegex').click();
  await options.waitForFunction(() =>
    categoryEditor.pending === false &&
    document.querySelectorAll('#categoryRegexResults .regex-result-text').length > 0
  );
  const regexLabQa = await options.evaluate(() => ({
    regexSelected:
      document.getElementById('categoryRegexTab')?.getAttribute('aria-selected') === 'true',
    promptPanelHidden: document.getElementById('categoryPromptPanel')?.hidden === true,
    matchCount: document.querySelectorAll('#categoryRegexResults .regex-result-text').length,
    matchedText: document.querySelector('#categoryRegexResults .regex-result-text')?.textContent || ''
  }));
  await options.locator('#categoryPromptTab').click();
  await options.locator('#categoryName').fill(`${originalCategoryName} QA unsaved`);
  await secondCategory.click();
  await options.locator('#unsavedCategoryDialog[open]').waitFor({ state: 'visible' });
  await options.locator('#cancelCategoryNavigation').click();
  await options.locator('#unsavedCategoryDialog').waitFor({ state: 'hidden' });
  const cancelNavigationQa = await options.evaluate(categoryId => ({
    stayedOnCategory: categoryEditor.categoryId === categoryId,
    dirtyPreserved: categoryEditor.dirty,
    promptSelected:
      document.getElementById('categoryPromptTab')?.getAttribute('aria-selected') === 'true'
  }), categoryIds[0]);
  await secondCategory.click();
  await options.locator('#unsavedCategoryDialog[open]').waitFor({ state: 'visible' });
  await options.locator('#discardCategoryChanges').click();
  await options.waitForFunction(categoryId =>
    categoryEditor.categoryId === categoryId && categoryEditor.pending === false &&
    categoryEditor.dirty === false,
  categoryIds[1]);
  const discardNavigationQa = await options.evaluate(categoryId => ({
    navigated: categoryEditor.categoryId === categoryId,
    dirtyCleared: categoryEditor.dirty === false
  }), categoryIds[1]);
  await firstCategory.click();
  await options.waitForFunction(categoryId =>
    categoryEditor.categoryId === categoryId && categoryEditor.pending === false,
  categoryIds[0]);
  await options.locator('#categoryName').fill(`${originalCategoryName} QA Override`);
  await options.locator('#saveCategoryOverride').click();
  await options.waitForFunction(() =>
    categoryEditor.pending === false && categoryEditor.detail?.metadata?.overridden === true
  );
  const savedOverrideQa = await options.evaluate(() => ({
    overridden: categoryEditor.detail?.metadata?.overridden === true,
    dirtyCleared: categoryEditor.dirty === false,
    name: document.getElementById('categoryName')?.value || ''
  }));
  await options.locator('#resetCategoryOverride').click();
  await options.locator('#resetCategoryDialog[open]').waitFor({ state: 'visible' });
  await options.locator('#confirmResetCategory').click();
  await options.waitForFunction(expectedName =>
    categoryEditor.pending === false &&
    categoryEditor.detail?.metadata?.overridden === false &&
    document.getElementById('categoryName')?.value === expectedName,
  originalCategoryName);
  const categoryEditorControlsQa = await options.evaluate((input) => ({
    categoryIds: input.categoryIds,
    regexLab: input.regexLab,
    cancelNavigation: input.cancelNavigation,
    discardNavigation: input.discardNavigation,
    savedOverride: input.savedOverride,
    resetRestoredBuiltIn: categoryEditor.detail?.metadata?.overridden === false,
    resetName: document.getElementById('categoryName')?.value || ''
  }), {
    categoryIds,
    regexLab: regexLabQa,
    cancelNavigation: cancelNavigationQa,
    discardNavigation: discardNavigationQa,
    savedOverride: savedOverrideQa
  });
  await options.locator('#customCategoryName').fill('QA transient category');
  await options.locator('#customCategoryDefinition').fill(
    'Identify a sentence containing the dedicated QA category token.'
  );
  await options.locator('#customCategoryInclude').fill('Contains QA category token');
  await options.locator('#saveCustomCategory').click();
  await options.waitForFunction(() =>
    (state?.customCategories || []).some(category => category.name === 'QA transient category')
  );
  const customCategoryCreatedQa = await options.evaluate(() => ({
    created: (state?.customCategories || []).some(category =>
      category.name === 'QA transient category'),
    formCleared: document.getElementById('customCategoryName')?.value === ''
  }));
  const customCategoryRow = options.locator('#customCategoriesList .custom-category-row')
    .filter({ hasText: 'QA transient category' });
  options.once('dialog', dialog => dialog.accept());
  await customCategoryRow.locator('.category-delete').click();
  await options.waitForFunction(() =>
    !(state?.customCategories || []).some(category => category.name === 'QA transient category')
  );
  const customCategoryControlsQa = {
    ...customCategoryCreatedQa,
    deleted: await customCategoryRow.count() === 0
  };
  await options.locator('[data-settings-nav="data"]').first().click();
  await options.locator('#localData').waitFor({ state: 'visible' });
  const workspaceOverviewFixture = await options.evaluate(async workspace => {
    const ensure = await callBackground({
      type: 'ARTICLE_WORKSPACE_ENSURE', workspace
    });
    const asset = await callBackground({
      type: 'ARTICLE_WORKSPACE_SAVE_ASSET',
      workspaceId: workspace.workspaceId,
      relativePath: 'figures/inventory.json',
      content: {
        figures: [
          { figureId: 'figure-qa-1', panelHints: ['A', 'B'] },
          { figureId: 'figure-qa-2', panelHints: ['A'] }
        ]
      }
    });
    const turn = await callBackground({
      type: 'ARTICLE_WORKSPACE_SAVE_TURN',
      workspaceId: workspace.workspaceId,
      turn: {
        turnId: 'turn-qa-1',
        question: 'How is the evidence organized?',
        status: 'complete',
        answerBlocks: [{ blockId: 'block-1', markdown: 'A bounded answer.' }]
      }
    });
    await refreshArticleWorkspaceOverview();
    return {
      workspaceId: ensure.workspace.workspaceId,
      ensured: Boolean(ensure.workspace),
      assetSaved: asset.saved === true,
      turnSaved: turn.saved === true
    };
  }, {
    schemaVersion: 1,
    workspaceId: `workspace:${'e'.repeat(64)}`,
    canonicalUrl: 'https://example.org/qa-workspace-search-target',
    aliases: [{ type: 'doi', value: '10.1000/qa-workspace' }],
    title: 'QA Workspace Search Target',
    directoryName: `QA Workspace Search Target--${'e'.repeat(16)}`,
    revision: '5'.repeat(64),
    contentHash: '5'.repeat(64),
    workspaceGeneration: 1
  });
  await options.waitForFunction(workspaceId =>
    articleWorkspaceOverviewUi.loading === false &&
    articleWorkspaceOverviewUi.items.some(item => item.workspaceId === workspaceId) &&
    articleWorkspaceOverviewUi.details.has(workspaceId),
  workspaceOverviewFixture.workspaceId);
  const workspaceOverviewQa = await options.evaluate(workspaceId => {
    const item = articleWorkspaceOverviewUi.items.find(entry => entry.workspaceId === workspaceId);
    const detail = articleWorkspaceOverviewUi.details.get(workspaceId);
    const search = document.getElementById('articleWorkspaceSearch');
    search.value = 'qa workspace search target';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    const cards = Array.from(document.querySelectorAll('.article-workspace-card'));
    const matchingTitle = cards[0]?.querySelector('.article-workspace-title')?.textContent || '';
    const metrics = cards[0]?.querySelector('.article-workspace-metrics')?.textContent || '';
    const checkbox = cards[0]?.querySelector('.article-workspace-select');
    checkbox?.click();
    const bulkClearEnabledAfterSelect =
      document.getElementById('clearSelectedArticleWorkspaces')?.disabled === false;
    checkbox?.click();
    return {
      listItemFound: Boolean(item),
      detailLoaded: Boolean(detail),
      detailCounts: detail ? {
        chatTurns: detail.chatTurnCount,
        figures: detail.figureCount,
        panels: detail.panelCount
      } : null,
      filteredCardCount: cards.length,
      matchingTitle,
      metrics,
      bulkClearEnabledAfterSelect,
      bulkClearDisabledAfterDeselect:
        document.getElementById('clearSelectedArticleWorkspaces')?.disabled === true
    };
  }, workspaceOverviewFixture.workspaceId);
  reportQaStage('settings workspace overview loaded');
  const workspaceExport = await options.evaluate(workspaceId =>
    callBackground({ type: 'ARTICLE_WORKSPACE_EXPORT', workspaceId }),
  workspaceOverviewFixture.workspaceId);
  workspaceOverviewQa.exportedWorkspaceId = workspaceExport.workspace?.workspaceId || '';
  workspaceOverviewQa.exportContainsSecrets =
    /apiKey|authorization|absolutePath/i.test(JSON.stringify(workspaceExport));
  await options.locator(
    `[data-workspace-action="restore"][data-workspace-id="${workspaceOverviewFixture.workspaceId}"]`
  ).click();
  await options.waitForFunction(() =>
    /需要重新授权本地保存目录/.test(
      document.getElementById('articleWorkspaceOverviewStatus')?.textContent || ''
    )
  );
  workspaceOverviewQa.restoreWithoutDirectoryExplained = true;
  options.once('dialog', dialog => dialog.accept());
  await options.locator(
    `[data-workspace-action="clear"][data-workspace-id="${workspaceOverviewFixture.workspaceId}"]`
  ).click();
  await options.waitForFunction(workspaceId =>
    articleWorkspaceOverviewUi.loading === false &&
    !articleWorkspaceOverviewUi.items.some(item => item.workspaceId === workspaceId),
  workspaceOverviewFixture.workspaceId);
  workspaceOverviewQa.deletedFromOverview = true;
  workspaceOverviewQa.clearStatus = await options.locator(
    '#articleWorkspaceOverviewStatus'
  ).textContent();
  const workspacePaginationFixture = await options.evaluate(async () => {
    const workspaceIds = [];
    for (let index = 1; index <= 21; index += 1) {
      const digest = index.toString(16).padStart(64, '0');
      const workspaceId = `workspace:${digest}`;
      workspaceIds.push(workspaceId);
      await callBackground({
        type: 'ARTICLE_WORKSPACE_ENSURE',
        workspace: {
          schemaVersion: 1,
          workspaceId,
          canonicalUrl: `https://example.org/qa-pagination-${index}`,
          aliases: [],
          title: `QA Pagination ${String(index).padStart(2, '0')}`,
          directoryName: `QA-Pagination-${String(index).padStart(2, '0')}--${digest.slice(0, 16)}`,
          revision: digest,
          contentHash: digest,
          workspaceGeneration: 1
        }
      });
    }
    const search = document.getElementById('articleWorkspaceSearch');
    search.value = 'qa pagination';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await refreshArticleWorkspaceOverview();
    return { workspaceIds };
  });
  await options.waitForFunction(() =>
    articleWorkspaceOverviewUi.loading === false &&
    document.getElementById('articleWorkspaceNextPage')?.disabled === false
  );
  await options.locator('#articleWorkspaceSort').selectOption('title_asc');
  await options.waitForFunction(() =>
    document.querySelector('.article-workspace-title')?.textContent === 'QA Pagination 01'
  );
  await options.locator('#articleWorkspaceSelectAll').check();
  const workspaceSelectionPageOneQa = await options.evaluate(() => ({
    sort: articleWorkspaceOverviewUi.sort,
    firstTitle: document.querySelector('.article-workspace-title')?.textContent || '',
    visibleCards: document.querySelectorAll('.article-workspace-card').length,
    selected: articleWorkspaceOverviewUi.selected.size,
    selectAllChecked: document.getElementById('articleWorkspaceSelectAll')?.checked === true,
    selectAllIndeterminate:
      document.getElementById('articleWorkspaceSelectAll')?.indeterminate === true,
    bulkClearEnabled:
      document.getElementById('clearSelectedArticleWorkspaces')?.disabled === false
  }));
  await options.locator('#articleWorkspaceNextPage').click();
  await options.waitForFunction(() =>
    articleWorkspaceOverviewUi.page === 2 &&
    document.querySelectorAll('#articleWorkspaceList .article-workspace-card').length === 1
  );
  const workspaceNextPageQa = await options.evaluate(() => ({
    page: articleWorkspaceOverviewUi.page,
    cards: document.querySelectorAll('#articleWorkspaceList .article-workspace-card').length,
    pageStatus: document.getElementById('articleWorkspacePageStatus')?.textContent || '',
    previousEnabled: document.getElementById('articleWorkspacePreviousPage')?.disabled === false,
    nextDisabled: document.getElementById('articleWorkspaceNextPage')?.disabled === true
  }));
  const workspaceSelectionBeforePageTwoQa = await options.evaluate(() => ({
    selected: articleWorkspaceOverviewUi.selected.size,
    selectAllChecked: document.getElementById('articleWorkspaceSelectAll')?.checked === true,
    selectAllIndeterminate:
      document.getElementById('articleWorkspaceSelectAll')?.indeterminate === true
  }));
  await options.locator('#articleWorkspaceSelectAll').check();
  const workspaceSelectionPageTwoQa = await options.evaluate(() => ({
    selected: articleWorkspaceOverviewUi.selected.size,
    selectAllChecked: document.getElementById('articleWorkspaceSelectAll')?.checked === true,
    bulkClearEnabled:
      document.getElementById('clearSelectedArticleWorkspaces')?.disabled === false
  }));
  await options.locator('#articleWorkspacePreviousPage').click();
  await options.waitForFunction(() => articleWorkspaceOverviewUi.page === 1);
  await options.locator('#articleWorkspaceSelectAll').uncheck();
  const workspaceSelectionAfterPageOneClearQa = await options.evaluate(() => ({
    selected: articleWorkspaceOverviewUi.selected.size,
    selectAllChecked: document.getElementById('articleWorkspaceSelectAll')?.checked === true,
    bulkClearEnabled:
      document.getElementById('clearSelectedArticleWorkspaces')?.disabled === false
  }));
  await options.locator('#articleWorkspaceNextPage').click();
  await options.waitForFunction(() => articleWorkspaceOverviewUi.page === 2);
  await options.locator('#articleWorkspaceSelectAll').uncheck();
  await options.locator('#articleWorkspacePreviousPage').click();
  await options.waitForFunction(() => articleWorkspaceOverviewUi.page === 1);
  const workspaceSelectionSortQa = {
    pageOne: workspaceSelectionPageOneQa,
    beforePageTwo: workspaceSelectionBeforePageTwoQa,
    pageTwo: workspaceSelectionPageTwoQa,
    afterPageOneClear: workspaceSelectionAfterPageOneClearQa,
    final: await options.evaluate(() => ({
      selected: articleWorkspaceOverviewUi.selected.size,
      selectAllChecked: document.getElementById('articleWorkspaceSelectAll')?.checked === true,
      bulkClearDisabled:
        document.getElementById('clearSelectedArticleWorkspaces')?.disabled === true
    }))
  };
  const workspacePaginationQa = {
    ...workspaceNextPageQa,
    returnedToFirst: await options.evaluate(() =>
      articleWorkspaceOverviewUi.page === 1 &&
      document.getElementById('articleWorkspacePreviousPage')?.disabled === true)
  };
  await options.evaluate(async workspaceIds => {
    for (const workspaceId of workspaceIds) {
      const started = await callBackground({
        type: 'ARTICLE_WORKSPACE_BEGIN_DELETE', workspaceId, coordinateOpenTabs: false
      });
      await callBackground({
        type: 'ARTICLE_WORKSPACE_FINALIZE_DELETE',
        workspaceId,
        tombstoneId: started.tombstoneId,
        coordinateOpenTabs: false
      });
    }
    const search = document.getElementById('articleWorkspaceSearch');
    search.value = '';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await refreshArticleWorkspaceOverview();
  }, workspacePaginationFixture.workspaceIds);
  const activeWorkspaceBeforeDeletion = await worker.evaluate(async tabId => {
    await chrome.tabs.sendMessage(tabId, { action: 'saveArticleWorkspaceNow' });
    return chrome.tabs.sendMessage(tabId, { action: 'getArticleWorkspaceSnapshot' });
  }, fixtureTab.id);
  const activeWorkspaceId = activeWorkspaceBeforeDeletion?.snapshot?.localWorkspace?.workspaceId;
  const activeWorkspaceGeneration = Number(
    activeWorkspaceBeforeDeletion?.snapshot?.localWorkspace?.workspaceGeneration
  ) || 0;
  if (!activeWorkspaceId) throw new Error('Active article workspace was unavailable before deletion');
  await options.evaluate(() => {
    const search = document.getElementById('articleWorkspaceSearch');
    if (search) search.value = '';
    articleWorkspaceOverviewUi.query = '';
    articleWorkspaceOverviewUi.page = 1;
    return refreshArticleWorkspaceOverview();
  });
  await options.waitForFunction(workspaceId =>
    articleWorkspaceOverviewUi.loading === false &&
    articleWorkspaceOverviewUi.items.some(item => item.workspaceId === workspaceId),
  activeWorkspaceId);
  const lateFigureSetup = await worker.evaluate(async tabId => {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'ISOLATED',
      func: async () => {
        const figure = {
          figureId: 'figure-stale-qa',
          figureLabel: 'Figure stale QA',
          caption: 'A delayed Figure response must not survive workspace deletion.',
          panelHints: ['A'],
          contextParagraphs: [],
          imageElements: [],
          isSupplemental: false
        };
        figureWorkspaceInventory = [figure];
        figureWalkthroughState.set(figure.figureId, {
          figure,
          figureInputHash: '',
          standard: null,
          standardError: '',
          deep: null,
          activeDepth: 'standard',
          deepLoading: false,
          deepError: '',
          panelFollowups: {},
          panelFollowupHistories: {},
          panelFollowupLoading: {},
          panelFollowupErrors: {},
          panelAnalyses: {},
          panelAnalysisLoading: {},
          panelAnalysisErrors: {},
          expanded: true
        });
        const original = chrome.runtime.sendMessage.bind(chrome.runtime);
        globalThis.__sciQaOriginalFigureRuntimeSendMessage = original;
        globalThis.__sciQaResolveLateFigure = null;
        globalThis.__sciQaLateFigureOutcome = null;
        chrome.runtime.sendMessage = async message => {
          if (message?.type === 'LLM_ANALYZE_FIGURES' &&
              message.figures?.[0]?.figureId === figure.figureId) {
            return new Promise(resolve => {
              globalThis.__sciQaResolveLateFigure = resolve;
            });
          }
          return original(message);
        };
        globalThis.__sciQaLateFigurePromise = analyzeSingleFigureWithLLM(
          figure.figureId, { forceRefresh: true }
        ).then(value => {
          globalThis.__sciQaLateFigureOutcome = {
            settled: 'fulfilled', value
          };
          return globalThis.__sciQaLateFigureOutcome;
        }).catch(error => {
          globalThis.__sciQaLateFigureOutcome = {
            settled: 'rejected',
            code: String(error?.code || ''),
            message: String(error?.message || '')
          };
          return globalThis.__sciQaLateFigureOutcome;
        });
        const startedAt = Date.now();
        while (!globalThis.__sciQaResolveLateFigure && Date.now() - startedAt < 1500) {
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        return {
          deferred: typeof globalThis.__sciQaResolveLateFigure === 'function',
          promiseAttached: Boolean(figureDepthAnalysisPromise),
          operationActive: Boolean(figureOperationState.active),
          progressSize: figureProgressById.size,
          lifecycle: articleWorkspaceLifecycleGeneration
        };
      }
    });
    return result;
  }, fixtureTab.id);
  if (!lateFigureSetup?.deferred) {
    throw new Error(`Unable to establish deferred Figure QA: ${JSON.stringify(lateFigureSetup)}`);
  }
  options.once('dialog', dialog => dialog.accept());
  await options.evaluate(workspaceId => clearArticleWorkspaces([workspaceId]), activeWorkspaceId);
  await fixture.bringToFront();
  const deletionSynced = await sidePanel.waitForFunction(previousGeneration => {
    const workspace = currentWorkspaceSnapshot?.localWorkspace;
    const figures = currentWorkspaceSnapshot?.figures?.figures || [];
    return Number(workspace?.workspaceGeneration || 0) > previousGeneration &&
      Number(currentWorkspaceSnapshot?.chat?.totalTurns || 0) === 0 &&
      figures.every(figure => !figure.standard && !figure.deep);
  }, activeWorkspaceGeneration, { timeout: 5000 }).then(() => true).catch(() => false);
  if (!deletionSynced) {
    const [contentState] = await worker.evaluate(async tabId => {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'ISOLATED',
        func: () => ({
          workspaceId: currentArticleWorkspace?.workspaceId || '',
          workspaceGeneration: Number(currentArticleWorkspace?.workspaceGeneration) || 0,
          lifecycle: articleWorkspaceLifecycleGeneration,
          pendingDeletionId: pendingExternalWorkspaceDeletionId,
          writesFrozen: articleWorkspaceSaveFrozen,
          chatTurns: articleChatState.turns.length,
          analyzedFigures: Array.from(figureWalkthroughState.values())
            .filter(figure => figure.standard || figure.deep).length
        })
      });
      return [result];
    }, fixtureTab.id);
    const panelState = await sidePanel.evaluate(() => ({
      workspaceId: currentWorkspaceSnapshot?.localWorkspace?.workspaceId || '',
      workspaceGeneration: Number(
        currentWorkspaceSnapshot?.localWorkspace?.workspaceGeneration
      ) || 0,
      chatTurns: Number(currentWorkspaceSnapshot?.chat?.totalTurns) || 0,
      analyzedFigures: (currentWorkspaceSnapshot?.figures?.figures || [])
        .filter(figure => figure.standard || figure.deep).length,
      status: document.getElementById('articleNavigationStatus')?.textContent || ''
    }));
    const optionsState = await options.evaluate(workspaceId => ({
      status: document.getElementById('articleWorkspaceOverviewStatus')?.textContent || '',
      loading: articleWorkspaceOverviewUi.loading,
      listed: articleWorkspaceOverviewUi.items.some(item => item.workspaceId === workspaceId)
    }), activeWorkspaceId);
    throw new Error(`Active workspace deletion did not synchronize: ${JSON.stringify({
      activeWorkspaceId,
      activeWorkspaceGeneration,
      contentState,
      panelState,
      optionsState
    })}`);
  }
  const activeWorkspaceAfterDeletion = await worker.evaluate(
    tabId => chrome.tabs.sendMessage(tabId, { action: 'getArticleWorkspaceSnapshot' }),
    fixtureTab.id
  );
  const paragraphTextsBeforeDeletion = (
    activeWorkspaceBeforeDeletion?.snapshot?.paragraphs || []
  ).map(paragraph => paragraph.text);
  const paragraphTextsAfterDeletion = (
    activeWorkspaceAfterDeletion?.snapshot?.paragraphs || []
  ).map(paragraph => paragraph.text);
  await options.evaluate(() => refreshArticleWorkspaceOverview());
  await options.waitForFunction(workspaceId =>
    articleWorkspaceOverviewUi.loading === false &&
    articleWorkspaceOverviewUi.items.some(item => item.workspaceId === workspaceId) &&
    articleWorkspaceOverviewUi.details.has(workspaceId),
  activeWorkspaceId);
  const activeWorkspaceDeletionQa = await options.evaluate((input) => {
    const detail = articleWorkspaceOverviewUi.details.get(input.workspaceId);
    return {
      workspaceIdStable: input.workspaceId === input.afterWorkspaceId,
      generationBefore: input.generationBefore,
      generationAfter: input.generationAfter,
      paragraphCountBefore: input.paragraphCountBefore,
      paragraphCountAfter: input.paragraphCountAfter,
      addedParagraphs: input.addedParagraphs,
      removedParagraphs: input.removedParagraphs,
      recreatedInOverview: articleWorkspaceOverviewUi.items.some(item =>
        item.workspaceId === input.workspaceId
      ),
      storedChatTurns: Number(detail?.chatTurnCount) || 0,
      clearStatus: document.getElementById('articleWorkspaceOverviewStatus')?.textContent || ''
    };
  }, {
    workspaceId: activeWorkspaceId,
    afterWorkspaceId: activeWorkspaceAfterDeletion?.snapshot?.localWorkspace?.workspaceId || '',
    generationBefore: activeWorkspaceGeneration,
    generationAfter: Number(
      activeWorkspaceAfterDeletion?.snapshot?.localWorkspace?.workspaceGeneration
    ) || 0,
    paragraphCountBefore: paragraphTextsBeforeDeletion.length,
    paragraphCountAfter: paragraphTextsAfterDeletion.length,
    addedParagraphs: paragraphTextsAfterDeletion.filter(text =>
      !paragraphTextsBeforeDeletion.includes(text)
    ),
    removedParagraphs: paragraphTextsBeforeDeletion.filter(text =>
      !paragraphTextsAfterDeletion.includes(text)
    )
  });
  Object.assign(activeWorkspaceDeletionQa, await sidePanel.evaluate(() => ({
    sidePanelChatTurns: Number(currentWorkspaceSnapshot?.chat?.totalTurns) || 0,
    analyzedFigures: (currentWorkspaceSnapshot?.figures?.figures || [])
      .filter(figure => figure.standard || figure.deep).length,
    navigationStatus: document.getElementById('articleNavigationStatus')?.textContent || '',
    workspaceGeneration: Number(
      currentWorkspaceSnapshot?.localWorkspace?.workspaceGeneration
    ) || 0
  })));
  const lateFigureBeforeRelease = await worker.evaluate(async tabId => {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'ISOLATED',
      func: () => ({
        promiseDetached: !figureDepthAnalysisPromise,
        operationActive: Boolean(figureOperationState.active),
        progressSize: figureProgressById.size,
        statusPhase: String(figureAnalysisStatus.phase || ''),
        statusRunning: figureAnalysisStatus.running === true,
        lifecycle: articleWorkspaceLifecycleGeneration
      })
    });
    return result;
  }, fixtureTab.id);
  const lateFigureResolved = await worker.evaluate(async tabId => {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'ISOLATED',
      func: async () => {
        const resolve = globalThis.__sciQaResolveLateFigure;
        if (typeof resolve !== 'function') return false;
        resolve({
          success: true,
          data: {
            figureResults: [{
              figureId: 'figure-stale-qa',
              figureLabel: 'Figure stale QA',
              analysisDepth: 'standard',
              panels: [],
              argumentChain: []
            }],
            route: { effectiveProfileName: 'Deferred Figure QA', model: 'qa-model' }
          }
        });
        await globalThis.__sciQaLateFigurePromise;
        return true;
      }
    });
    return result;
  }, fixtureTab.id);
  const lateFigureDeletionQa = await worker.evaluate(async tabId => {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'ISOLATED',
      func: () => {
        const outcome = globalThis.__sciQaLateFigureOutcome;
        const snapshot = {
          responseReleased: true,
          outcome,
          promiseDetached: !figureDepthAnalysisPromise,
          operationActive: Boolean(figureOperationState.active),
          progressSize: figureProgressById.size,
          progressIds: [...figureProgressById.keys()],
          statusPhase: String(figureAnalysisStatus.phase || ''),
          statusRunning: figureAnalysisStatus.running === true,
          staleFigurePresent: figureWalkthroughState.has('figure-stale-qa'),
          lifecycle: articleWorkspaceLifecycleGeneration
        };
        if (globalThis.__sciQaOriginalFigureRuntimeSendMessage) {
          chrome.runtime.sendMessage = globalThis.__sciQaOriginalFigureRuntimeSendMessage;
          delete globalThis.__sciQaOriginalFigureRuntimeSendMessage;
        }
        delete globalThis.__sciQaResolveLateFigure;
        delete globalThis.__sciQaLateFigurePromise;
        delete globalThis.__sciQaLateFigureOutcome;
        return snapshot;
      }
    });
    return result;
  }, fixtureTab.id);
  lateFigureDeletionQa.responseReleased = lateFigureResolved === true;
  lateFigureDeletionQa.beforeRelease = lateFigureBeforeRelease;
  const lateChatSetup = await worker.evaluate(async tabId => {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'ISOLATED',
      func: async () => {
        const original = chrome.runtime.sendMessage.bind(chrome.runtime);
        globalThis.__sciQaOriginalRuntimeSendMessage = original;
        globalThis.__sciQaResolveLateChat = null;
        const intercepted = function(message, ...args) {
          if (message?.type === 'LLM_ASK_ARTICLE' &&
              message.question === '__SCI_QA_STALE_CHAT__') {
            return new Promise(resolve => {
              globalThis.__sciQaResolveLateChat = resolve;
            });
          }
          return original(message, ...args);
        };
        chrome.runtime.sendMessage = intercepted;
        const queued = await askArticleWithLLM(
          '__SCI_QA_STALE_CHAT__', 'profile_qa_deferred'
        );
        const startedAt = Date.now();
        while (!globalThis.__sciQaResolveLateChat && Date.now() - startedAt < 1500) {
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        return {
          patched: chrome.runtime.sendMessage === intercepted,
          queued: queued?.queued === true,
          deferred: typeof globalThis.__sciQaResolveLateChat === 'function',
          generation: Number(currentArticleWorkspace?.workspaceGeneration) || 0,
          chatTurns: articleChatState.turns.length,
          loading: articleChatState.loading
        };
      }
    });
    return result;
  }, fixtureTab.id);
  if (!lateChatSetup.patched || !lateChatSetup.queued || !lateChatSetup.deferred) {
    throw new Error(`Unable to establish deferred chat QA: ${JSON.stringify(lateChatSetup)}`);
  }
  await options.evaluate(() => {
    articleWorkspaceOverviewUi.query = '';
    articleWorkspaceOverviewUi.page = 1;
    return refreshArticleWorkspaceOverview();
  });
  await options.waitForFunction(workspaceId =>
    articleWorkspaceOverviewUi.loading === false &&
    articleWorkspaceOverviewUi.items.some(item => item.workspaceId === workspaceId),
  activeWorkspaceId);
  options.once('dialog', dialog => dialog.accept());
  await options.evaluate(workspaceId => clearArticleWorkspaces([workspaceId]), activeWorkspaceId);
  const lateChatResolved = await worker.evaluate(async tabId => {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'ISOLATED',
      func: () => {
        const resolve = globalThis.__sciQaResolveLateChat;
        if (typeof resolve !== 'function') return false;
        resolve({
          success: true,
          data: {
            message: {
              status: 'completed',
              summary: 'This stale answer must never survive deletion.',
              answerBlocks: [{
                blockId: 'stale-block',
                markdown: 'STALE ANSWER MUST NOT BE SAVED',
                evidence: []
              }]
            },
            route: { effectiveProfileName: 'Deferred QA', model: 'qa-model' },
            plan: {},
            coverage: {}
          }
        });
        globalThis.__sciQaResolveLateChat = null;
        return true;
      }
    });
    return result;
  }, fixtureTab.id);
  await fixture.bringToFront();
  await sidePanel.waitForFunction(previousGeneration =>
    Number(currentWorkspaceSnapshot?.localWorkspace?.workspaceGeneration || 0) >
      previousGeneration &&
    Number(currentWorkspaceSnapshot?.chat?.totalTurns || 0) === 0,
  activeWorkspaceDeletionQa.generationAfter, { timeout: 5000 });
  await sidePanel.waitForTimeout(250);
  const lateChatDeletionQa = await worker.evaluate(async tabId => {
    await new Promise(resolve => setTimeout(resolve, 50));
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'ISOLATED',
      func: () => {
        const state = {
          chatTurns: articleChatState.turns.length,
          loading: articleChatState.loading,
          workspaceGeneration: Number(currentArticleWorkspace?.workspaceGeneration) || 0,
          staleTextInMemory: JSON.stringify(articleChatState).includes(
            'STALE ANSWER MUST NOT BE SAVED'
          )
        };
        if (globalThis.__sciQaOriginalRuntimeSendMessage) {
          chrome.runtime.sendMessage = globalThis.__sciQaOriginalRuntimeSendMessage;
          delete globalThis.__sciQaOriginalRuntimeSendMessage;
        }
        delete globalThis.__sciQaResolveLateChat;
        return state;
      }
    });
    return result;
  }, fixtureTab.id);
  const lateChatDetail = await options.evaluate(
    workspaceId => callBackground({ type: 'ARTICLE_WORKSPACE_DETAIL', workspaceId }),
    activeWorkspaceId
  );
  lateChatDeletionQa.storedChatTurns = Number(lateChatDetail?.chatTurnCount) || 0;
  lateChatDeletionQa.staleTextStored = JSON.stringify(lateChatDetail || {}).includes(
    'STALE ANSWER MUST NOT BE SAVED'
  );
  lateChatDeletionQa.responseReleased = lateChatResolved === true;
  Object.assign(lateChatDeletionQa, await sidePanel.evaluate(() => ({
    sidePanelChatTurns: Number(currentWorkspaceSnapshot?.chat?.totalTurns) || 0,
    staleTextInSidePanel: document.body.textContent.includes(
      'STALE ANSWER MUST NOT BE SAVED'
    )
  })));
  await options.evaluate(() => {
    if (onboardingUi.active || document.body.classList.contains('is-onboarding')) {
      leaveOnboardingLayout();
    }
    activateSettingsPage('data');
  });
  await options.locator('#localData').waitFor({ state: 'visible' });
  const migrationDirectoryQa = await options.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getDirectoryHandle(
      'migration-directory-sentinel', { create: true }
    );
    await SciLLM.saveDirectoryHandle(indexedDB, handle);
    globalThis.__qaMigrationDirectoryHandle = handle;
    userDataUi.directoryHandle = handle;
    userDataUi.handleLoaded = true;
    const portableProbe = await callBackground({ type: 'PORTABLE_CONFIG_PROBE' });
    let portableStatus = portableProbe;
    if (portableProbe?.state === 'missing') {
      portableStatus = await callBackground({
        type: 'PORTABLE_CONFIG_CREATE',
        passphrase: 'brevess migration directory qa'
      });
    } else if (portableProbe?.state !== 'ready' || portableProbe?.pending) {
      throw new Error('QA_PORTABLE_CONFIG_UNEXPECTED_STATE');
    }
    if (portableStatus?.state !== 'ready' || portableStatus?.pending) {
      throw new Error('QA_PORTABLE_CONFIG_NOT_READY');
    }
    await callBackground({ type: 'USER_DATA_SYNC_NOW' });
    await refreshUserDataStatus();
    return {
      permission: await handle.queryPermission({ mode: 'readwrite' }),
      directoryName: handle.name,
      portableState: portableStatus.state,
      portablePending: portableStatus.pending,
      displayedDirectory:
        document.getElementById('userDataDirectory')?.textContent || ''
    };
  });
  await options.evaluate(() => {
    // This block validates the ordinary settings controls. A fresh QA profile
    // can still carry the onboarding-only CSS gate until the later dedicated
    // onboarding scenario, so expose the ordinary action row for this isolated
    // interaction test without changing production state or styles.
    onboardingUi.active = false;
    document.body.classList.remove('is-onboarding');
    delete document.body.dataset.onboardingStep;
    document.querySelectorAll('#directorySyncSettings .sync-actions > button')
      .forEach(button => { button.style.display = 'inline-flex'; });
  });
  await options.locator('#syncUserDataNow').evaluate(button => button.click());
  await options.waitForFunction(() =>
    userDataUi.pendingAction === false &&
    /\u540c\u6b65\u5b8c\u6210/.test(document.getElementById('userDataStatus')?.textContent || '')
  );
  const directorySyncButtonQa = await options.evaluate(() => ({
    pendingReleased: userDataUi.pendingAction === false,
    status: document.getElementById('userDataStatus')?.textContent || '',
    syncEnabled: document.getElementById('syncUserDataNow')?.disabled === false
  }));
  await options.evaluate(() => {
    userDataUi.lastStatus = { ...(userDataUi.lastStatus || {}), permission: 'prompt' };
    updateUserDataActionButtons();
  });
  await options.locator('#reauthorizeUserDataDirectory').evaluate(button => button.click());
  await options.waitForFunction(() =>
    userDataUi.pendingAction === false &&
    /\u6743\u9650\u5df2\u6062\u590d/.test(
      document.getElementById('userDataStatus')?.textContent || ''
    )
  );
  const directoryReauthorizationQa = await options.evaluate(() => ({
    pendingReleased: userDataUi.pendingAction === false,
    permission: userDataUi.lastStatus?.permission || '',
    status: document.getElementById('userDataStatus')?.textContent || ''
  }));
  const [userDataDownload] = await Promise.all([
    options.waitForEvent('download', { timeout: 30000 }),
    options.locator('#exportUserDataBundle').evaluate(button => button.click())
  ]);
  const userDataExport = await readDiagnosticDownload(userDataDownload);
  const userDataExportQa = {
    filename: userDataExport.filename,
    bytes: userDataExport.bytes,
    containsSecrets: /apiKey|authorization/i.test(JSON.stringify(userDataExport.bundle)),
    hasSettings: Boolean(userDataExport.bundle.settings || userDataExport.bundle.categories),
    buttonRecovered: await options.locator('#exportUserDataBundle').isEnabled()
  };
  await options.locator('#rebuildUserDataIndex').evaluate(button => button.click());
  await options.locator('#rebuildUserDataDialog[open]').waitFor({ state: 'visible' });
  const rebuildDialogQa = await options.evaluate(() => ({
    open: document.getElementById('rebuildUserDataDialog')?.open === true,
    description: document.getElementById('rebuildUserDataDialogDescription')?.textContent || ''
  }));
  await options.locator('#confirmRebuildUserDataIndex').click();
  await options.waitForFunction(() =>
    userDataUi.pendingAction === false &&
    /\u91cd\u5efa\u5b8c\u6210/.test(document.getElementById('userDataStatus')?.textContent || '')
  );
  const directoryRebuildQa = {
    ...rebuildDialogQa,
    completed: true,
    status: await options.locator('#userDataStatus').textContent(),
    dialogClosed: await options.locator('#rebuildUserDataDialog').isHidden()
  };
  reportQaStage('directory persistence scenarios completed');
  await options.evaluate(async () => {
    for (const [index, documentHash] of ['qa-corpus-a', 'qa-corpus-b', 'qa-corpus-c'].entries()) {
      await callBackground({
        type: 'LLM_RECORD_FEEDBACK',
        sample: {
          documentHash,
          paragraphId: `qa-corpus-p-${index + 1}`,
          quote: `We found that QA corpus treatment ${index + 1} improved survival.`,
          categoryId: 'result',
          userAction: 'accepted',
          url: 'https://must-not-export.example/secret'
        }
      });
    }
    await refreshCorpusStatus();
  });
  const [corpusJsonlDownload] = await Promise.all([
    options.waitForEvent('download', { timeout: 30000 }),
    options.locator('#exportCorpusJsonl').click()
  ]);
  const corpusJsonl = await readTextDownload(corpusJsonlDownload);
  const [corpusCsvDownload] = await Promise.all([
    options.waitForEvent('download', { timeout: 30000 }),
    options.locator('#exportCorpusCsv').click()
  ]);
  const corpusCsv = await readTextDownload(corpusCsvDownload);
  const [distilledRulesDownload] = await Promise.all([
    options.waitForEvent('download', { timeout: 30000 }),
    options.locator('#distillRules').click()
  ]);
  const distilledRules = await readDiagnosticDownload(distilledRulesDownload);
  const corpusControlsQa = {
    jsonlFilename: corpusJsonl.filename,
    jsonlLines: corpusJsonl.content.trim().split(/\r?\n/).filter(Boolean).length,
    jsonlContainsForbiddenUrl: corpusJsonl.content.includes('must-not-export.example'),
    csvFilename: corpusCsv.filename,
    csvHasHeader: /documentHash|document_hash/i.test(corpusCsv.content.split(/\r?\n/, 1)[0]),
    csvContainsForbiddenUrl: corpusCsv.content.includes('must-not-export.example'),
    distilledFilename: distilledRules.filename,
    distilledResultPatterns: distilledRules.bundle?.result?.patterns || [],
    downloadsNonEmpty:
      corpusJsonl.bytes > 0 && corpusCsv.bytes > 0 && distilledRules.bytes > 0
  };
  await options.locator('[data-settings-nav="models"]').first().click();
  await options.locator('#providerSettings').waitFor({ state: 'visible' });
  const initialProfileCount = await options.locator(
    '#apiProfileList [data-profile-id]'
  ).count();
  await options.locator('#addApiProfile').click();
  await options.waitForFunction(expected =>
    document.querySelectorAll('#apiProfileList [data-profile-id]').length === expected &&
    /API Profile 已新增/.test(document.getElementById('status')?.textContent || ''),
  initialProfileCount + 1);
  await options.locator('#profileName').fill('Migration QA Profile');
  await options.locator('#providerId').selectOption('deepseek');
  await options.locator('#model').fill('deepseek-v4-pro');
  await options.locator('#apiKey').fill('qa-migration-secret');
  await options.locator('#consentGranted').check();
  await options.locator('#saveSettings').click();
  await options.waitForFunction(() =>
    /模型与路由设置已保存/.test(document.getElementById('status')?.textContent || '') &&
    document.getElementById('saveSettings')?.disabled === false &&
    document.getElementById('apiKey')?.value === '');
  const migrationProfileId = await options.evaluate(() => selectedProfileId);
  await options.locator('#globalProfileId').selectOption(migrationProfileId);
  await options.locator('#routeFigure').selectOption(migrationProfileId);
  await options.locator('#routeCrossFigure').selectOption(migrationProfileId);
  await options.locator('#saveSettings').click();
  await options.waitForFunction(profileId =>
    state?.settings?.globalProfileId === profileId &&
    state?.settings?.taskRoutes?.figure?.profileId === profileId &&
    state?.settings?.taskRoutes?.crossFigure?.profileId === profileId,
  migrationProfileId);
  await options.locator('#duplicateApiProfile').click();
  await options.waitForFunction(expected =>
    document.querySelectorAll('#apiProfileList [data-profile-id]').length === expected &&
    /API Profile 已复制/.test(document.getElementById('status')?.textContent || ''),
  initialProfileCount + 2);
  const duplicatedProfileQa = await options.evaluate(sourceProfileId => ({
    profileId: selectedProfileId,
    isDistinct: selectedProfileId !== sourceProfileId,
    name: document.getElementById('profileName')?.value || '',
    apiKeyMasked: /已保存/.test(document.getElementById('apiKey')?.placeholder || '')
  }), migrationProfileId);
  await options.locator('#deleteApiProfile').click();
  await options.waitForFunction((expected) =>
    document.querySelectorAll('#apiProfileList [data-profile-id]').length === expected &&
    /API Profile 已删除/.test(document.getElementById('status')?.textContent || ''),
  initialProfileCount + 1);
  const profileMutationQa = await options.evaluate(profileId => ({
    selectedOriginalAfterDuplicateDelete: selectedProfileId === profileId,
    globalProfileId: state?.settings?.globalProfileId || '',
    figureRouteProfileId: state?.settings?.taskRoutes?.figure?.profileId || '',
    crossFigureRouteProfileId:
      state?.settings?.taskRoutes?.crossFigure?.profileId || '',
    profileCount: document.querySelectorAll('#apiProfileList [data-profile-id]').length
  }), migrationProfileId);
  await options.locator('[data-settings-nav="data"]').first().click();
  await options.locator('#localData').waitFor({ state: 'visible' });
  const [migrationDownload] = await Promise.all([
    options.waitForEvent('download', { timeout: 30000 }),
    options.locator('#exportMigrationBundle').click()
  ]);
  const migrationExport = await readDiagnosticDownload(migrationDownload);
  const migrationExportQa = {
    kind: migrationExport.bundle.kind,
    schemaVersion: migrationExport.bundle.schemaVersion,
    containsApiKey:
      migrationExport.bundle.settings?.profiles?.[migrationProfileId]
        ?.config?.apiKey === 'qa-migration-secret',
    globalProfileId: migrationExport.bundle.settings?.globalProfileId || '',
    figureRouteProfileId:
      migrationExport.bundle.settings?.taskRoutes?.figure?.profileId || '',
    crossFigureRouteProfileId:
      migrationExport.bundle.settings?.taskRoutes?.crossFigure?.profileId || '',
    bytes: migrationExport.bytes
  };
  await options.locator('[data-settings-nav="models"]').first().click();
  await options.locator('#providerSettings').waitFor({ state: 'visible' });
  await options.locator('#deleteApiProfile').click();
  await options.waitForFunction(({ profileId, expected }) =>
    !state?.settings?.profiles?.[profileId] &&
    document.querySelectorAll('#apiProfileList [data-profile-id]').length === expected,
  { profileId: migrationProfileId, expected: initialProfileCount });
  await options.locator('[data-settings-nav="data"]').first().click();
  await options.locator('#localData').waitFor({ state: 'visible' });
  await options.locator('#importMigrationBundle').setInputFiles(migrationExport.path);
  await options.locator('#migrationImportDialog[open]').waitFor({ state: 'visible' });
  const migrationDialogQa = await options.evaluate(() => ({
    open: document.getElementById('migrationImportDialog')?.open === true,
    description:
      document.getElementById('migrationImportDialogDescription')?.textContent || '',
    pendingBundleReady: Boolean(pendingMigrationBundle)
  }));
  await options.locator('#confirmMigrationImport').click();
  await options.waitForFunction(profileId =>
    userDataUi.pendingAction === false &&
    Boolean(state?.settings?.profiles?.[profileId]) &&
    /迁移完成/.test(document.getElementById('migrationStatus')?.textContent || ''),
  migrationProfileId, { timeout: 10000 });
  await options.locator('[data-settings-nav="models"]').first().click();
  await options.locator('#providerSettings').waitFor({ state: 'visible' });
  await options.locator(
    `#apiProfileList [data-profile-id="${migrationProfileId}"]`
  ).click();
  const migrationImportQa = await options.evaluate(async profileId => {
    const loadedDirectory = await SciLLM.loadDirectoryHandle(indexedDB);
    const originalDirectory = globalThis.__qaMigrationDirectoryHandle;
    const stored = await chrome.storage.local.get('sciLlmSettingsV2');
    const storedSettings = stored.sciLlmSettingsV2 || {};
    return {
      profileRestored: Boolean(state?.settings?.profiles?.[profileId]),
      profileName: document.getElementById('profileName')?.value || '',
      apiKeyCleared: document.getElementById('apiKey')?.value === '',
      apiKeyMasked: /已保存/.test(document.getElementById('apiKey')?.placeholder || ''),
      apiKeyStored:
        storedSettings.profiles?.[profileId]?.config?.apiKey === 'qa-migration-secret',
      globalProfileId: state?.settings?.globalProfileId || '',
      figureRouteProfileId: state?.settings?.taskRoutes?.figure?.profileId || '',
      crossFigureRouteProfileId:
        state?.settings?.taskRoutes?.crossFigure?.profileId || '',
      directoryHandlePresent: Boolean(loadedDirectory),
      directoryName: loadedDirectory?.name || '',
      directoryPermission: loadedDirectory
        ? await loadedDirectory.queryPermission({ mode: 'readwrite' }) : 'unconfigured',
      sameDirectoryHandle: Boolean(originalDirectory && loadedDirectory &&
        await originalDirectory.isSameEntry(loadedDirectory)),
      displayedDirectory:
        document.getElementById('userDataDirectory')?.textContent || '',
      status: document.getElementById('migrationStatus')?.textContent || '',
      importButtonRecovered:
        document.getElementById('exportMigrationBundle')?.disabled === false
    };
  }, migrationProfileId);
  const modelConfigurationQa = await options.evaluate(async () => {
    const provider = document.getElementById('providerId');
    const model = document.getElementById('model');
    const suggestions = () => Array.from(
      document.querySelectorAll('#modelSuggestions option')
    ).map(option => option.value);
    const change = element => element.dispatchEvent(
      new Event('change', { bubbles: true })
    );
    provider.value = 'openai';
    change(provider);
    provider.value = 'deepseek';
    change(provider);
    const deepseekDefault = model.value;
    const deepseekSuggestions = suggestions();
    model.value = 'deepseek-private-science-model';
    model.dispatchEvent(new Event('input', { bubbles: true }));
    const customModelAccepted = model.value === 'deepseek-private-science-model';

    provider.value = 'openai-compatible';
    change(provider);
    const compatibleFieldsVisible =
      document.getElementById('compatibleFields')?.hidden === false;
    const preset = document.getElementById('compatiblePreset');
    preset.value = 'qwen';
    change(preset);
    const presetResult = {
      model: model.value,
      baseUrl: document.getElementById('baseUrl').value,
      suggestions: suggestions()
    };

    model.value = 'private-compatible-model';
    model.dispatchEvent(new Event('input', { bubbles: true }));
    const customCompatibleModelAccepted = model.value === 'private-compatible-model';
    const sentinel = document.getElementById('articleWorkspacePreviousPage');
    const sentinelWasDisabled = sentinel?.disabled === true;
    document.getElementById('baseUrl').value = 'not-a-valid-url';
    let rejected = false;
    try {
      await persistForm(false);
    } catch (_) {
      rejected = true;
    }
    const failureStatus = document.getElementById('status')?.textContent || '';
    const result = {
      deepseekDefault,
      deepseekSuggestions,
      customModelAccepted,
      compatibleFieldsVisible,
      presetResult,
      customCompatibleModelAccepted,
      rejected,
      failureStatus,
      saveButtonRecovered: document.getElementById('saveSettings')?.disabled === false,
      testButtonRecovered: document.getElementById('testProvider')?.disabled === false,
      preDisabledButtonPreserved: sentinelWasDisabled && sentinel?.disabled === true,
      saveGuardReleased: profileActionInFlight.save !== true
    };
    profileEditorDirty = false;
    renderProfileEditor();
    renderRouteOptions();
    return result;
  });
  await options.locator(
    `#apiProfileList [data-profile-id="${migrationProfileId}"]`
  ).click();
  await options.locator('#contextWindowTokens').fill('131072');
  await options.locator('#routeHighlight').selectOption(migrationProfileId);
  await options.locator('#autoAnalyze').check();
  await options.locator('#saveSettings').click();
  await options.waitForFunction(() => profileActionInFlight.save !== true &&
    document.getElementById('saveSettings')?.disabled === false);
  const automaticTokenLiveQa = await options.evaluate(profileId => {
    const profile = state?.settings?.profiles?.[profileId];
    return {
      mode: profile?.tokenPolicy?.mode || '',
      manualMax: profile?.tokenPolicy?.manualMax ?? null,
      autoCap: profile?.tokenPolicy?.autoCap ?? null,
      contextWindowTokens: profile?.contextWindowTokens || 0,
      highlightRouteMode: state?.settings?.taskRoutes?.highlight?.mode || '',
      highlightRoute: state?.settings?.taskRoutes?.highlight?.profileId || '',
      autoAnalyze: state?.settings?.autoAnalyze === true,
      dirty: profileEditorDirty,
      status: document.getElementById('status')?.textContent || ''
    };
  }, migrationProfileId);
  const automaticTokenStoredQa = await options.evaluate(async profileId => {
    const stored = await chrome.storage.local.get('sciLlmSettingsV2');
    const profile = stored.sciLlmSettingsV2?.profiles?.[profileId];
    return {
      mode: profile?.tokenPolicy?.mode || '',
      manualMax: profile?.tokenPolicy?.manualMax ?? null,
      autoCap: profile?.tokenPolicy?.autoCap ?? null,
      contextWindowTokens: profile?.contextWindowTokens || 0,
      highlightRoute: stored.sciLlmSettingsV2?.taskRoutes?.highlight?.profileId || '',
      autoAnalyze: stored.sciLlmSettingsV2?.autoAnalyze === true
    };
  }, migrationProfileId);
  await options.reload({ waitUntil: 'domcontentloaded' });
  await options.waitForFunction(profileId =>
    Boolean(state?.settings?.profiles?.[profileId]) &&
    selectedProfileId === profileId && userDataUi.handleLoaded === true,
  migrationProfileId);
  const automaticTokenReloadQa = await options.evaluate(profileId => ({
    mode: state?.settings?.profiles?.[profileId]?.tokenPolicy?.mode || '',
    manualMax: state?.settings?.profiles?.[profileId]?.tokenPolicy?.manualMax ?? null,
    autoCap: state?.settings?.profiles?.[profileId]?.tokenPolicy?.autoCap ?? null,
    contextValue: document.getElementById('contextWindowTokens')?.value || '',
    highlightRoute: document.getElementById('routeHighlight')?.value || '',
    autoAnalyze: document.getElementById('autoAnalyze')?.checked === true,
    selectedProfileId,
    profileId
  }), migrationProfileId);
  await options.locator('#contextWindowTokens').fill('');
  await options.locator('#saveSettings').click();
  await options.waitForFunction(() => profileActionInFlight.save !== true &&
    document.getElementById('saveSettings')?.disabled === false);
  const clearedContextLiveQa = await options.evaluate(profileId => {
    const profile = state?.settings?.profiles?.[profileId];
    return {
      mode: profile?.tokenPolicy?.mode || '',
      manualMax: profile?.tokenPolicy?.manualMax ?? null,
      autoCap: profile?.tokenPolicy?.autoCap ?? null,
      contextWindowTokens: profile?.contextWindowTokens ?? null,
      highlightRouteMode: state?.settings?.taskRoutes?.highlight?.mode || '',
      highlightRoute: state?.settings?.taskRoutes?.highlight?.profileId || '',
      autoAnalyze: state?.settings?.autoAnalyze === true,
      dirty: profileEditorDirty,
      status: document.getElementById('status')?.textContent || ''
    };
  }, migrationProfileId);
  await options.reload({ waitUntil: 'domcontentloaded' });
  await options.waitForFunction(profileId =>
    Boolean(state?.settings?.profiles?.[profileId]) &&
    selectedProfileId === profileId && userDataUi.handleLoaded === true,
  migrationProfileId);
  const clearedContextReloadQa = await options.evaluate(profileId => ({
    mode: state?.settings?.profiles?.[profileId]?.tokenPolicy?.mode || '',
    manualMax: state?.settings?.profiles?.[profileId]?.tokenPolicy?.manualMax ?? null,
    autoCap: state?.settings?.profiles?.[profileId]?.tokenPolicy?.autoCap ?? null,
    contextValue: document.getElementById('contextWindowTokens')?.value || '',
    highlightRoute: document.getElementById('routeHighlight')?.value || '',
    autoAnalyze: document.getElementById('autoAnalyze')?.checked === true,
    selectedProfileId,
    profileId,
    saveButtonRecovered: document.getElementById('saveSettings')?.disabled === false,
    dirtyCleared: profileEditorDirty === false
  }), migrationProfileId);
  const tokenRoutingUiQa = {
    automaticLive: automaticTokenLiveQa,
    automaticStored: automaticTokenStoredQa,
    automaticReload: automaticTokenReloadQa,
    clearedContextLive: clearedContextLiveQa,
    clearedContextReload: clearedContextReloadQa
  };
  reportQaStage('automatic token policy save and reload scenarios completed');
  const onboardingAlreadyOpen = await options.evaluate(() =>
    onboardingUi.active === true &&
    document.body.dataset.onboardingStep === 'storage'
  );
  if (!onboardingAlreadyOpen) {
    // This long-running QA may leave the options document in a PDF-return or
    // partially open onboarding state where the header control is intentionally
    // hidden. Exercise the same handler directly instead of waiting on layout.
    await options.evaluate(() => reopenOnboarding());
  }
  await options.waitForFunction(() =>
    onboardingUi.active === true &&
    document.body.dataset.onboardingStep === 'storage'
  );
  const onboardingReopenQa = await options.evaluate(() => ({
    active: onboardingUi.active,
    step: onboardingUi.step,
    acknowledged: onboardingUi.state?.acknowledged === true,
    sourceTabId: onboardingUi.state?.sourceTab?.tabId || null
  }));
  await options.evaluate(() => continueOnboarding());
  await options.waitForFunction(() => document.body.dataset.onboardingStep === 'api');
  const onboardingContinueQa = await options.evaluate(() => ({
    step: onboardingUi.step,
    storageState: onboardingUi.state?.steps?.storage || ''
  }));
  await options.locator('#onboardingBack').click();
  await options.waitForFunction(() =>
    activeSettingsPage === 'overview' && onboardingUi.active === true
  );
  await options.evaluate(() => openOnboardingStep('storage'));
  await options.waitForFunction(() => document.body.dataset.onboardingStep === 'storage');
  const onboardingBackQa = await options.evaluate(() => ({
    step: onboardingUi.step,
    guideVisible: document.getElementById('onboardingGuide')?.hidden === false
  }));
  // Directory persistence was exercised earlier in this end-to-end run, so
  // reopening onboarding correctly marks storage complete and hides Skip.
  // Reset only the onboarding step state to exercise the separate skip path.
  await options.evaluate(async () => {
    await setOnboardingStepState('storage', 'pending');
    onboardingUi.step = 'storage';
    renderOnboarding();
  });
  await options.waitForFunction(() =>
    document.getElementById('onboardingSkip')?.hidden === false
  );
  await options.locator('#onboardingSkip').click();
  await options.waitForFunction(() =>
    document.body.dataset.onboardingStep === 'api' &&
    onboardingUi.state?.steps?.storage === 'skipped'
  );
  const onboardingSkipQa = await options.evaluate(() => ({
    step: onboardingUi.step,
    storageState: onboardingUi.state?.steps?.storage || ''
  }));
  await options.evaluate(async () => {
    await setOnboardingStepState('storage', 'completed');
    onboardingUi.step = 'api';
    renderOnboarding();
  });
  const onboardingControlsQa = {
    reopen: onboardingReopenQa,
    continue: onboardingContinueQa,
    back: onboardingBackQa,
    skip: onboardingSkipQa
  };
  await options.waitForFunction(() =>
    document.body.dataset.onboardingStep === 'api' &&
    document.getElementById('providerSettings')?.hidden === false
  );
  const settingsDatabaseQa = await options.evaluate(async () => {
    const database = await SciLLM.openUserDataDatabase(indexedDB);
    return {
      moduleAvailable: typeof SciLLM.openUserDataDatabase === 'function',
      directoryStoreAvailable: database.objectStoreNames.contains('directoryHandles'),
      configuredDirectorySkipsStorage:
        document.body.dataset.onboardingStep === 'api' &&
        onboardingUi.state?.steps?.storage === 'completed'
    };
  });
  settingsDatabaseQa.continuedToApi =
    await options.locator('#providerSettings').isVisible();
  await options.locator('#profileName').fill('QA onboarding profile');
  await options.locator('#providerId').selectOption('openai-compatible');
  await options.locator('#model').fill('qa-onboarding-model');
  await options.locator('#apiKey').fill('qa-onboarding-secret');
  await options.locator('#baseUrl').fill(providerBaseUrl);
  await options.locator('#authHeader').fill('Authorization');
  await options.locator('#authPrefix').fill('Bearer');
  await options.locator('#consentGranted').check();
  await options.locator('#testProvider').click();
  await Promise.race([
    providerRequestObserved,
    new Promise((_, reject) => setTimeout(() =>
      reject(new Error('Timed out waiting for the onboarding connection-test request')), 20000))
  ]);
  const providerPendingUiQa = await options.evaluate(() => ({
    disabled: document.getElementById('testProvider')?.disabled === true,
    busy: document.getElementById('testProvider')?.getAttribute('aria-busy') === 'true',
    saveDisabled: document.getElementById('saveSettings')?.disabled === true,
    status: document.getElementById('status')?.textContent || '',
    testGuardActive: profileActionInFlight.test === true
  }));
  releaseProviderResponse();
  await options.waitForFunction(() =>
    /连接成功/.test(document.getElementById('status')?.textContent || '') &&
    document.getElementById('testProvider')?.disabled === false &&
    document.getElementById('onboardingFinish')?.disabled === false,
  null, { timeout: 10000 });
  const providerCompletedUiQa = await options.evaluate(() => ({
    testRecovered: document.getElementById('testProvider')?.disabled === false,
    saveRecovered: document.getElementById('saveSettings')?.disabled === false,
    busyReleased: document.getElementById('testProvider')?.getAttribute('aria-busy') !== 'true',
    status: document.getElementById('status')?.textContent || '',
    apiKeyCleared: document.getElementById('apiKey')?.value === '',
    apiKeyMasked: /已保存/.test(document.getElementById('apiKey')?.placeholder || ''),
    finishEnabled: document.getElementById('onboardingFinish')?.disabled === false,
    testGuardReleased: profileActionInFlight.test !== true
  }));
  reportQaStage('onboarding provider scenarios completed');
  await options.evaluate(() => returnToSettingsOverview());
  await options.waitForFunction(() =>
    document.getElementById('onboardingFinish')?.hidden === false &&
    document.getElementById('onboardingFinish')?.disabled === false
  );
  const optionsClosed = options.waitForEvent('close', { timeout: 10000 })
    .then(() => true, () => false);
  await options.locator('#onboardingFinish').click().catch(error => {
    if (!options.isClosed()) throw error;
  });
  const onboardingOptionsClosed = await optionsClosed;
  const onboardingReturnQa = await worker.evaluate(async tabId => {
    const [tab, activeTabs, panelOptions, activated, stored] = await Promise.all([
      chrome.tabs.get(tabId),
      chrome.tabs.query({ active: true, currentWindow: true }),
      chrome.sidePanel.getOptions({ tabId }),
      chrome.tabs.get(tabId).then(current =>
        SciLLM.isTabActivated(chrome.storage.session, current)),
      onboardingController.get()
    ]);
    return {
      sourceTabStillOpen: Boolean(tab?.id),
      sourceTabActive: activeTabs[0]?.id === tabId,
      sidePanelEnabled: panelOptions.enabled === true,
      activated,
      acknowledged: stored.acknowledged === true,
      storageStep: stored.steps?.storage || '',
      apiStep: stored.steps?.api || ''
    };
  }, fixtureTab.id);
  await fixture.bringToFront();
  const createdSettingsPage = context.waitForEvent('page', { timeout: 3000 });
  await sidePanel.locator('#openSidePanelSettings').click();
  const reopenedSettingsPage = await createdSettingsPage;
  await reopenedSettingsPage.waitForURL(url =>
    url.pathname.endsWith('/options.html') && url.hash === '#categoryWorkspace'
  );
  await reopenedSettingsPage.waitForLoadState('domcontentloaded');
  const settingsUrl = new URL(reopenedSettingsPage.url());
  const sidePanelSettingsShortcutQa = {
    openedOptionsPage: settingsUrl.pathname.endsWith('/options.html'),
    categoryWorkspaceHash: settingsUrl.hash === '#categoryWorkspace',
    categoryWorkspaceVisible: await reopenedSettingsPage.locator('#categoryWorkspace').isVisible(),
    categoryHeadingVisible: await reopenedSettingsPage.locator('#categoryInspectorTitle').isVisible(),
    gearRecovered: await sidePanel.locator('#openSidePanelSettings').isEnabled(),
    legacyMenuRemoved: await sidePanel.locator('#sidePanelSettingsMenu').count() === 0
  };
  await reopenedSettingsPage.close();
  reportQaStage('all browser interactions completed; evaluating assertions');

  const results = {
    extensionId,
    legacySidePanelRepair,
    sidePanelOptions,
    beforeActivationRevision,
    afterActivationRevision,
    activated,
    publisherSingleColumnQa,
    dynamicNaturePanelQa,
    structuredNaturePanelQa,
    figureInventoryCacheQa,
    nestedFigureIsolationQa,
    notificationCenterQa,
    notificationPageOverlayCount,
    globalToolbarFeedbackQa,
    multiTab,
    navigationLifecycleQa,
    pageOverlayCount,
    archive: {
      kind: archive.kind,
      documentId: archive.documentId,
      title: archive.title,
      containsSecrets: /apiKey|authorization|data:image|pageHtml/i.test(archiveText),
      bytes: Buffer.byteLength(archiveText, 'utf8')
    },
    restored,
    navigationStatus,
    automaticHighlightsCreated,
    manualSelectionQa,
    manualAnnotationCreatedQa,
    manualDistributionBeforeClearQa,
    afterAutomaticClearQa,
    manualClearCancelledQa,
    manualAnnotationLifecycleQa,
    articleArchiveControlsQa,
    navigationControlsQa,
    figureIncrementalQa,
    quickNavPreHover,
    figureVisualQa,
    panelFollowupAnswerQa,
    quickNavSwitchQa,
    quickNavExitQa,
    figureToolbarControlsQa,
    taskControlButtonsQa,
    figureKeyboardQa,
    figureControlReleaseQa,
    analysisCategoryControlsQa,
    figureBatchButtonQa,
    crossFigureButtonQa,
    paperMetaExtractionQa,
    paragraphSummaryActionQa,
    articleChatQa,
    streamingProfileQa,
    fullTextHighlightQa,
    streamingComposerQa,
    streamingMidUiQa,
    streamingMidStateQa,
    streamingContinuationQa,
    streamingFinalUiQa,
    streamingFinalStateQa,
    streamingPersistedQa,
    streamingPersistedDetails,
    panelCapacityQa,
    panelTruncationQa,
    unlabeledSingleFigureQa,
    panelUiEndToEndQa,
    largeChatHistorySetup,
    largeChatInitialQa,
    largeChatPage2Qa,
    largeChatPage3Qa,
    largeChatPage4Qa,
    largeChatDeleteQa,
    chatMutationQa,
    dynamicParagraphQa,
    dynamicRemovalAndTextQa,
    articleRootReplacementQa,
    panelPromptResetQa,
    categoryEditorControlsQa,
    customCategoryControlsQa,
    workspaceOverviewFixture,
    workspaceOverviewQa,
    workspaceSelectionSortQa,
    workspacePaginationQa,
    activeWorkspaceDeletionQa,
    lateFigureSetup,
    lateFigureDeletionQa,
    lateChatSetup,
    lateChatDeletionQa,
    migrationControls,
    supportEmail,
    migrationDirectoryQa,
    directorySyncButtonQa,
    directoryReauthorizationQa,
    userDataExportQa,
    directoryRebuildQa,
    corpusControlsQa,
    duplicatedProfileQa,
    profileMutationQa,
    migrationExportQa,
    migrationDialogQa,
    migrationImportQa,
    modelConfigurationQa,
    tokenRoutingUiQa,
    onboardingControlsQa,
    settingsDatabaseQa,
    providerRequestQa,
    providerPendingUiQa,
    providerCompletedUiQa,
    onboardingOptionsClosed,
    onboardingReturnQa,
    sidePanelSettingsShortcutQa,
    adapterDiagnostic: {
      extension: path.extname(firstDiagnostic.filename),
      filename: firstDiagnostic.filename,
      bytes: firstDiagnostic.bytes,
      kind: firstDiagnostic.bundle.kind,
      schemaVersion: firstDiagnostic.bundle.schemaVersion,
      hasRenderedDom: firstDiagnostic.bundle.dom?.documentHtml
        ?.includes('OA mechanism review test') === true,
      selectorCoverage: firstDiagnostic.bundle.selectorCoverage?.length || 0,
      traceCount: firstDiagnostic.bundle.trace?.length || 0,
      extractionFailureRecorded: failureDiagnostic.bundle.trace?.some(record =>
        record.status === 'failed' &&
        /FORCED_EXTRACTOR_FAILURE_FOR_DIAGNOSTIC/.test(record.error?.message || '')) || false,
      survivesExtractionFailure:
        failureDiagnostic.bundle.kind === firstDiagnostic.bundle.kind,
      failedConnectionUi,
      patchResult
    },
    consoleErrors,
    pageErrors
  };
  const passed =
    beforeActivationRevision === '' &&
    afterActivationRevision === '1.0.1-ai-reliability-v2' &&
    results.legacySidePanelRepair.before.enabled === false &&
    // The background tab listener can win the race and repair the deliberately
    // disabled option before this explicit probe runs. The observable contract
    // is the enabled popup path, not which concurrent repair reports "true".
    [true, false].includes(results.legacySidePanelRepair.repaired) &&
    results.legacySidePanelRepair.after.enabled === true &&
    results.legacySidePanelRepair.after.path === 'popup.html' &&
    sidePanelOptions.path === 'popup.html' &&
    sidePanelOptions.enabled === true &&
    activated.viewCount === 6 &&
    activated.navCount === 5 &&
    activated.applyActionAboveEngine &&
    activated.analysisIconVisible &&
    activated.removedAnalysisActions &&
    activated.feedbackRemoved &&
    activated.migrationScriptsLoaded &&
    results.publisherSingleColumnQa.enabled &&
    results.publisherSingleColumnQa.extrasDisplay === 'none' &&
    results.publisherSingleColumnQa.companionDisplay === 'none' &&
    results.publisherSingleColumnQa.mainFloat === 'none' &&
    Math.abs(
      results.publisherSingleColumnQa.mainWidth - results.publisherSingleColumnQa.hostWidth
    ) <= 1 &&
    results.dynamicNaturePanelQa.initial.found &&
    results.dynamicNaturePanelQa.initial.panelHints.length === 0 &&
    results.dynamicNaturePanelQa.updated.found &&
    JSON.stringify(results.dynamicNaturePanelQa.updated.panelHints) ===
      JSON.stringify(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']) &&
    results.dynamicNaturePanelQa.cleanup &&
    JSON.stringify(results.structuredNaturePanelQa.panels) ===
      JSON.stringify(['A', 'B', 'C', 'D', 'E', 'F']) &&
    results.structuredNaturePanelQa.excludesGlossaryInitials &&
    results.structuredNaturePanelQa.cleanup &&
    results.figureInventoryCacheQa.freshnessChecks <= 1 &&
    results.figureInventoryCacheQa.extractions === 0 &&
    JSON.stringify(results.nestedFigureIsolationQa.figure90Panels) ===
      JSON.stringify(['A', 'B', 'C']) &&
    JSON.stringify(results.nestedFigureIsolationQa.figure91Panels) ===
      JSON.stringify(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M']) &&
    !/Figure 91/.test(results.nestedFigureIsolationQa.figure90Caption) &&
    !/Figure 90/.test(results.nestedFigureIsolationQa.figure91Caption) &&
    results.nestedFigureIsolationQa.figure90Focused &&
    !results.nestedFigureIsolationQa.figure91Focused &&
    results.nestedFigureIsolationQa.cleanup &&
    results.notificationCenterQa.open &&
    /Panel B 解读已完成/.test(results.notificationCenterQa.latest) &&
    /^\d{2}:\d{2}:\d{2}$/.test(results.notificationCenterQa.latestTime) &&
    results.notificationCenterQa.history.length >= 2 &&
    /Panel B 解读已完成/.test(results.notificationCenterQa.history[0]) &&
    /Panel A 解读已完成/.test(results.notificationCenterQa.history[1]) &&
    results.notificationCenterQa.unreadCleared &&
    results.notificationPageOverlayCount === 0 &&
    results.globalToolbarFeedbackQa.saveFailure.figureViewActive &&
    results.globalToolbarFeedbackQa.saveFailure.visible &&
    /\u5c1a\u672a\u8bbe\u7f6e\u672c\u5730\u4fdd\u5b58\u6587\u4ef6\u5939/.test(
      results.globalToolbarFeedbackQa.saveFailure.text
    ) &&
    results.globalToolbarFeedbackQa.saveFailure.buttonRecovered &&
    results.globalToolbarFeedbackQa.saveFailure.busyReleased &&
    results.globalToolbarFeedbackQa.timerIsolation.latestTextRetained &&
    results.globalToolbarFeedbackQa.timerIsolation.latestStillVisible &&
    results.globalToolbarFeedbackQa.timerIsolation.timerActive &&
    multiTab.untouchedRevision === '' &&
    multiTab.untouchedSidePanelEnabled === true &&
    multiTab.activatedSidePanelEnabled === true &&
    multiTab.restoredSidePanelEnabled === true &&
    multiTab.secondActivatedRevision === '1.0.1-ai-reliability-v2' &&
    multiTab.activeTitleAfterSwitchBack === 'OA mechanism review test' &&
    // A warm canonical snapshot legitimately needs no new extraction; a cold
    // return may perform exactly one. More than one indicates duplicate work.
    Number.isInteger(multiTab.switchExtractionRuns) &&
    multiTab.switchExtractionRuns >= 0 && multiTab.switchExtractionRuns <= 1 &&
    multiTab.switchBackMs < 1500 &&
    !multiTab.restoreHandleVisible &&
    multiTab.restoreHandleCleared &&
    results.navigationLifecycleQa.awayKeptOpen &&
    results.navigationLifecycleQa.awayNotActivated &&
    results.navigationLifecycleQa.activationPreservedWhileAway &&
    results.navigationLifecycleQa.returnedEnabled &&
    !results.navigationLifecycleQa.returnRestoreHandleVisible &&
    results.navigationLifecycleQa.returnRestoreHandleCleared &&
    results.navigationLifecycleQa.returnedActivated &&
    results.navigationLifecycleQa.rememberedDocumentUrls.includes(
      'https://example.org/oa-mechanism-review'
    ) &&
    results.navigationLifecycleQa.refreshContentInjected &&
    results.navigationLifecycleQa.refreshSidePanelEnabled &&
    results.navigationLifecycleQa.titleAfterRefresh === 'OA mechanism review test' &&
    pageOverlayCount === 0 &&
    results.automaticHighlightsCreated > 0 &&
    results.manualSelectionQa.toolbarVisible &&
    (results.manualSelectionQa.categoryActions > 0 || results.manualSelectionQa.hasMore) &&
    results.manualSelectionQa.modeSwitched &&
    results.manualSelectionQa.categoriesChanged &&
    // Cold first render creates 47 category actions; allow one scheduling frame
    // of desktop CI jitter while keeping the warm path well below 100 ms.
    results.manualSelectionQa.firstOpenMs < 240 &&
    results.manualSelectionQa.secondOpenMs < 80 &&
    results.manualAnnotationCreatedQa.created &&
    results.manualAnnotationCreatedQa.categoryName.length > 0 &&
    results.manualAnnotationCreatedQa.createdMs < 2500 &&
    results.manualDistributionBeforeClearQa.totalHighlights > 1 &&
    results.manualDistributionBeforeClearQa.manualCount === 1 &&
    results.manualDistributionBeforeClearQa.regexCount > 0 &&
    results.manualDistributionBeforeClearQa.manualCells > 0 &&
    results.manualDistributionBeforeClearQa.regexCells > 0 &&
    results.manualDistributionBeforeClearQa.manualJumpFocused &&
    results.manualDistributionBeforeClearQa.regexJumpFocused &&
    results.afterAutomaticClearQa.automaticMarks === 0 &&
    results.afterAutomaticClearQa.manualMarks === 1 &&
    results.afterAutomaticClearQa.annotationCount === 1 &&
    results.afterAutomaticClearQa.lastRegexRequestCleared &&
    results.afterAutomaticClearQa.lastLlmAnalysisCleared &&
    results.afterAutomaticClearQa.persistedActiveEngine === '' &&
    results.afterAutomaticClearQa.persistedRegexRequest === null &&
    results.afterAutomaticClearQa.persistedManualAnnotations === 1 &&
    results.afterAutomaticClearQa.persistedLlmAnalysis === null &&
    results.manualClearCancelledQa.marks === 1 &&
    results.manualClearCancelledQa.annotations === 1 &&
    results.manualAnnotationLifecycleQa.marksAfterConfirm === 0 &&
    results.manualAnnotationLifecycleQa.annotationsAfterConfirm === 0 &&
    results.articleArchiveControlsQa.exportKind === 'sci-logic-highlighter-article' &&
    Number(results.articleArchiveControlsQa.exportSchemaVersion) >= 1 &&
    results.articleArchiveControlsQa.exportBytes > 0 &&
    !results.articleArchiveControlsQa.exportContainsSecrets &&
    results.articleArchiveControlsQa.importInputCleared &&
    results.articleArchiveControlsQa.loadPromptHidden &&
    results.articleArchiveControlsQa.reanalyze.promptHidden &&
    results.articleArchiveControlsQa.reanalyze.analysisActive &&
    results.articleArchiveControlsQa.reanalyze.rememberedDecision === 'skipped' &&
    results.articleArchiveControlsQa.reentry.hadResults &&
    results.articleArchiveControlsQa.reentry.promptHidden &&
    results.articleArchiveControlsQa.reentry.decision === 'current-workspace' &&
    archive.kind === 'sci-logic-highlighter-article' &&
    !results.archive.containsSecrets &&
    restored?.success === true &&
    results.navigationControlsQa.branchCount > 0 &&
    results.navigationControlsQa.expandedAll &&
    results.navigationControlsQa.openAfterCollapse === 0 &&
    results.figureIncrementalQa.cardCount === 3 &&
    results.figureIncrementalQa.firstHasPartialResult &&
    results.figureIncrementalQa.firstPanelCatalogSize === 3 &&
    results.figureIncrementalQa.firstAnalyzedPanels === 2 &&
    !results.figureIncrementalQa.secondHasResult &&
    results.figureIncrementalQa.stablePollingKeepsQuickNavNode &&
    results.figureIncrementalQa.stablePollingKeepsHoverState &&
    results.figureIncrementalQa.elapsedUpdatedWithoutRebuild &&
    results.figureIncrementalQa.changedProgressRebuilds &&
    /Figure 1/.test(results.figureIncrementalQa.summaries[0]) &&
    /当前 Panel 分批已保存/.test(results.figureIncrementalQa.summaries[0]) &&
    /待解读/.test(results.figureIncrementalQa.summaries[1]) &&
    /待解读/.test(results.figureIncrementalQa.summaries[2]) &&
    results.figureIncrementalQa.reportsBatchCount &&
    results.figureIncrementalQa.reportsIgnoredPanels &&
    results.figureVisualQa.figureOpen &&
    results.figureVisualQa.panelOpen &&
    results.figureVisualQa.followupOpen &&
    results.figureVisualQa.draftPreserved &&
    results.figureVisualQa.quickNavVisible &&
    results.figureVisualQa.figureMarkers === 3 &&
    results.figureVisualQa.figureLabels === 3 &&
    results.figureVisualQa.panelButtons === 6 &&
    results.figureVisualQa.panelPopoverOpen &&
    results.figureVisualQa.panelOrder.join('|') === '1A|1B|1C' &&
    results.figureVisualQa.panelSingleColumn &&
    results.figureVisualQa.panelPopoverVisual?.opacity === '1' &&
    results.figureVisualQa.collapsedResultSections &&
    results.panelFollowupAnswerQa.rendered &&
    results.panelFollowupAnswerQa.revealed &&
    results.panelFollowupAnswerQa.followupVisible &&
    results.panelFollowupAnswerQa.panelOpen &&
    results.panelFollowupAnswerQa.inputBasisSelector === 'workspace-panel-input-basis' &&
    results.panelFollowupAnswerQa.inputBasisVisible &&
    /本次依据：最佳单张 Figure 图/.test(results.panelFollowupAnswerQa.inputBasisText) &&
    /isolates the treatment effect/.test(results.panelFollowupAnswerQa.answerText) &&
    /回答已生成并显示在下方/.test(results.panelFollowupAnswerQa.statusText) &&
    results.panelFollowupAnswerQa.focused &&
    results.panelFollowupAnswerQa.inViewport &&
    results.quickNavSwitchQa.expandedFigureIds.length === 1 &&
    results.quickNavSwitchQa.expandedFigureIds[0] === 'figure-2' &&
    !results.quickNavSwitchQa.firstFigureStillExpanded &&
    results.quickNavExitQa.expandedItems === 0 &&
    results.quickNavExitQa.hoveredItems === 0 &&
    results.quickNavExitQa.focusedItems === 0 &&
    results.figureToolbarControlsQa.totalFigures === 3 &&
    results.figureToolbarControlsQa.expandedAll &&
    results.figureToolbarControlsQa.collapsedFigures === 0 &&
    results.figureToolbarControlsQa.collapsedPanels === 0 &&
    results.figureToolbarControlsQa.refreshedFigures === 3 &&
    results.taskControlButtonsQa.calls.join('|') ===
      'highlight:pause|highlight:resume|highlight:cancel|' +
      'figure:pause|figure:resume|figure:cancel' &&
    results.taskControlButtonsQa.highlightControlsHidden &&
    results.taskControlButtonsQa.figureControlsHidden &&
    results.figureKeyboardQa.openFigures.length === 1 &&
    results.figureKeyboardQa.openFigures[0] === 'figure-2' &&
    results.figureKeyboardQa.panelBOpen &&
    /已跳转到 2B/.test(results.figureKeyboardQa.latestNotification) &&
    results.figureControlReleaseQa.staleReleased &&
    results.figureControlReleaseQa.immediateRelease.running === false &&
    results.figureControlReleaseQa.immediateRelease.controlsHidden &&
    results.figureControlReleaseQa.finalRelease.running === false &&
    results.figureControlReleaseQa.finalRelease.controlsHidden &&
    results.figureControlReleaseQa.finalRelease.pending &&
    /界面已立即释放/.test(results.figureControlReleaseQa.finalRelease.notification) &&
    results.analysisCategoryControlsQa.more.expanded === 'true' &&
    results.analysisCategoryControlsQa.more.panelVisible &&
    results.analysisCategoryControlsQa.more.searchFocused &&
    results.analysisCategoryControlsQa.more.groupCount > 0 &&
    results.analysisCategoryControlsQa.moreCollapsed &&
    results.analysisCategoryControlsQa.restoreCalls.length === 1 &&
    results.analysisCategoryControlsQa.restoreVisible &&
    !results.figureBatchButtonQa.disabledAfterCompletion &&
    /跨图综合已生成/.test(results.figureBatchButtonQa.status) &&
    !results.crossFigureButtonQa.disabledAfterCompletion &&
    !results.crossFigureButtonQa.running &&
    results.crossFigureButtonQa.roles.join('|') === 'phenomenon|mechanism' &&
    results.crossFigureButtonQa.evidenceLevels.join('|') ===
      'association|mechanistic_support' &&
    results.crossFigureButtonQa.relationTypes.join('|') ===
      'phenomenon_to_mechanism' &&
    results.crossFigureButtonQa.generatedNodes >= 2 &&
    results.crossFigureButtonQa.generatedEdges >= 1 &&
    results.crossFigureButtonQa.providerConfigured &&
    results.crossFigureButtonQa.providerCalls === 1 &&
    results.crossFigureButtonQa.mechanismViewVisible &&
    results.crossFigureButtonQa.mechanismNodes >= 2 &&
    results.crossFigureButtonQa.mechanismEdges >= 1 &&
    results.crossFigureButtonQa.evidenceMatrixVisible &&
    results.crossFigureButtonQa.evidenceMatrixItems >= 1 &&
    results.crossFigureButtonQa.evidenceMatrixClasses.every(value =>
      value === 'is-sufficiency' || value === 'is-necessity' || value === 'is-other') &&
    results.crossFigureButtonQa.returnedViaBack &&
    results.paperMetaExtractionQa.backgroundItems >= 1 &&
    results.paperMetaExtractionQa.scientificQuestions >= 1 &&
    results.paperMetaExtractionQa.innovationPoints >= 1 &&
    results.paperMetaExtractionQa.limitationPoints >= 1 &&
    results.paperMetaExtractionQa.hasCoreQuestion &&
    results.paperMetaExtractionQa.progressionCount >= 1 &&
    results.paperMetaExtractionQa.researchLogicTabs.join('|') ===
      '核心问题|为什么值得问|论文如何推进|证据强度' &&
    results.paperMetaExtractionQa.sourceChipCount >= 1 &&
    results.paperMetaExtractionQa.atomicEvidenceCalls === 1 &&
    results.paperMetaExtractionQa.providerStages.join('|') ===
      'atomic_evidence|question_trace|progression|audit|innovation|limitations' &&
    results.paragraphSummaryActionQa.globalGeneratorRemoved &&
    results.paragraphSummaryActionQa.actionCount >= 1 &&
    results.paragraphSummaryActionQa.calls.includes('analyzeFiguresWithLLM') &&
    results.paragraphSummaryActionQa.calls.includes('analyzeCrossFigureLogicWithLLM') &&
    results.paragraphSummaryActionQa.calls.includes('analyzeReviewParagraphWithLLM') &&
    results.articleChatQa.active &&
    results.articleChatQa.profileOptions === 2 &&
    results.articleChatQa.messages === 4 &&
    results.articleChatQa.userLabels === 0 &&
    results.articleChatQa.assistantLabels === 2 &&
    results.articleChatQa.boldNodes >= 6 &&
    results.articleChatQa.superscriptNodes === 1 &&
    !results.articleChatQa.literalSupTagsVisible &&
    results.articleChatQa.listItems >= 7 &&
    results.articleChatQa.orderedLists === 2 &&
    results.articleChatQa.secondQuestionVisible &&
    results.articleChatQa.citationButtons === 39 &&
    new Set(results.articleChatQa.citationParagraphIds).size >= 2 &&
    new Set(results.articleChatQa.citationSourceKeys).size >= 2 &&
    results.articleChatQa.fallbackCitationRows === 0 &&
    results.articleChatQa.limitationsCollapsed &&
    results.articleChatQa.messagesOverflowY === 'auto' &&
    results.articleChatQa.messagesScrollable &&
    results.articleChatQa.scrolledToLatest &&
    results.articleChatQa.returnLatestVisible &&
    results.articleChatQa.returnLatestRestored &&
    results.articleChatQa.composerOutsideMessages &&
    results.articleChatQa.citationJumpFocused &&
    results.articleChatQa.cancelControl.calls.length === 1 &&
    results.articleChatQa.cancelControl.calls[0].action === 'cancelArticleChatWithLLM' &&
    results.articleChatQa.cancelControl.sameButtonWhileLoading &&
    results.articleChatQa.cancelControl.restoredAfterCompletion &&
    results.streamingProfileQa.profileSaved &&
    results.streamingProfileQa.preferencesSaved &&
    results.streamingProfileQa.routingSaved &&
    results.streamingProfileQa.effectiveMode === 'llm' &&
    results.fullTextHighlightQa.requestCount === 4 &&
    results.fullTextHighlightQa.requests
      .flatMap(request => request.paragraphIds).length === 6 &&
    new Set(results.fullTextHighlightQa.requests
      .flatMap(request => request.paragraphIds)).size === 6 &&
    results.fullTextHighlightQa.requests.every(request => request.categoryBounded) &&
    results.fullTextHighlightQa.requests.every(request => request.maxTokens >= 512) &&
    results.fullTextHighlightQa.evidenceLedgerRequestCount === 1 &&
    results.fullTextHighlightQa.evidenceLedgerRequests[0].hasValidatedAnnotation &&
    results.fullTextHighlightQa.progressive.marks === 1 &&
    /One major limitation of this study/.test(
      results.fullTextHighlightQa.progressive.markText
    ) &&
    results.fullTextHighlightQa.progressive.diagnosticsStage === 'streaming' &&
    results.fullTextHighlightQa.progressive.inMemoryAnnotations === 1 &&
    results.fullTextHighlightQa.progressive.persistedActiveEngine === 'llm' &&
    results.fullTextHighlightQa.progressive.persistedAnnotations === 1 &&
    results.fullTextHighlightQa.progressive.persistedDiagnosticsStage === 'streaming' &&
    results.fullTextHighlightQa.completed.marks === 1 &&
    results.fullTextHighlightQa.completed.diagnosticsStage === 'complete' &&
    results.fullTextHighlightQa.completed.persistedActiveEngine === 'llm' &&
    results.fullTextHighlightQa.completed.persistedAnnotations === 1 &&
    results.fullTextHighlightQa.completed.persistedDiagnosticsStage === 'complete' &&
    !results.fullTextHighlightQa.completed.workspaceTaskRunning &&
    results.streamingComposerQa.effectiveMode === 'llm' &&
    results.streamingComposerQa.selectValue === 'profile_qa_stream' &&
    !results.streamingComposerQa.sendDisabled &&
    results.streamingMidUiQa.renderedBlocks === 1 &&
    /锁定候选通路/.test(results.streamingMidUiQa.visibleText) &&
    /正在继续生成/.test(results.streamingMidUiQa.visibleText) &&
    results.streamingMidUiQa.citationButtons === 1 &&
    results.streamingMidUiQa.actionsHiddenWhileGenerating &&
    results.streamingMidStateQa.status === 'generating' &&
    results.streamingMidStateQa.blocks === 1 &&
    results.streamingMidStateQa.continuationCount === 1 &&
    results.streamingMidStateQa.loading &&
    results.streamingContinuationQa.requestCountBeforeRelease === 2 &&
    results.streamingContinuationQa.promptIncludesPriorBlock &&
    results.streamingContinuationQa.promptIncludesContinuationContract &&
    results.streamingContinuationQa.firstMaxOutputTokens >= 4096 &&
    results.streamingContinuationQa.continuationMaxOutputTokens >
      results.streamingContinuationQa.firstMaxOutputTokens &&
    results.streamingFinalUiQa.renderedBlocks === 2 &&
    new Set(results.streamingFinalUiQa.blockIds).size === 2 &&
    results.streamingFinalUiQa.blockIds[0] === 'stream-step-1' &&
    results.streamingFinalUiQa.blockIds[1] === 'stream-step-2' &&
    results.streamingFinalUiQa.citationButtons === 2 &&
    JSON.stringify(results.streamingFinalUiQa.citationNumbers) ===
      JSON.stringify(['1', '2']) &&
    results.streamingFinalUiQa.statusText === '' &&
    results.streamingFinalUiQa.actions.includes('delete-answer') &&
    results.streamingFinalUiQa.actions.includes('regenerate') &&
    results.streamingFinalStateQa.status === 'completed' &&
    results.streamingFinalStateQa.blocks === 2 &&
    results.streamingFinalStateQa.continuationCount === 1 &&
    results.streamingFinalStateQa.model === 'qa-stream-model' &&
    !results.streamingFinalStateQa.loading &&
    results.streamingPersistedQa &&
    results.panelCapacityQa.success &&
    results.panelCapacityQa.requestCount === 3 &&
    new Set(results.panelCapacityQa.imageLengths).size === 1 &&
    JSON.stringify(results.panelCapacityQa.outputBudgets) ===
      JSON.stringify([3072, 1024, 768]) &&
    results.panelCapacityQa.allRequestsHaveImages &&
    results.panelCapacityQa.panel === 'A' &&
    results.panelCapacityQa.basis === 'vision_text' &&
    results.panelCapacityQa.attempts === 3 &&
    results.panelCapacityQa.inputMode === 'figure_image' &&
    results.panelCapacityQa.imageMaxEdge === 1200 &&
    results.panelCapacityQa.outputBudgetTokens === 768 &&
    results.panelCapacityQa.routeModel === 'qa-stream-model' &&
    results.panelTruncationQa.success &&
    results.panelTruncationQa.requestCount === 2 &&
    new Set(results.panelTruncationQa.imageLengths).size === 1 &&
    JSON.stringify(results.panelTruncationQa.outputBudgets) ===
      JSON.stringify([3072, 5376]) &&
    results.panelTruncationQa.allRequestsHaveImages &&
    results.panelTruncationQa.panel === 'A' &&
    results.panelTruncationQa.attempts === 2 &&
    results.panelTruncationQa.imageMaxEdge === 1200 &&
    results.panelTruncationQa.outputBudgetTokens === 5376 &&
    results.unlabeledSingleFigureQa.setup.figureId === 'figure-77' &&
    results.unlabeledSingleFigureQa.setup.panelHints === 0 &&
    results.unlabeledSingleFigureQa.setup.snapshotFigures === 1 &&
    results.unlabeledSingleFigureQa.requestCount === 1 &&
    results.unlabeledSingleFigureQa.requests[0].pass === 'unlabeled_figure_overview' &&
    results.unlabeledSingleFigureQa.requests[0].hasCompactSchema &&
    !results.unlabeledSingleFigureQa.requests[0].hasImage &&
    results.unlabeledSingleFigureQa.requests[0].maxTokens >= 1024 &&
    results.unlabeledSingleFigureQa.ui.cardOpen &&
    results.unlabeledSingleFigureQa.ui.completed &&
    results.unlabeledSingleFigureQa.ui.noteVisible &&
    results.unlabeledSingleFigureQa.ui.conclusionVisible &&
    results.unlabeledSingleFigureQa.ui.boundaryVisible &&
    results.unlabeledSingleFigureQa.ui.overviewFields >= 3 &&
    results.unlabeledSingleFigureQa.ui.panelCards === 0 &&
    results.unlabeledSingleFigureQa.ui.fakePanelLabels === 0 &&
    /解图|重新精读此图/.test(results.unlabeledSingleFigureQa.ui.buttonText) &&
    /已完成 figure-77 的单图精读/.test(results.unlabeledSingleFigureQa.ui.statusText) &&
    results.unlabeledSingleFigureQa.persisted.inMemory &&
    results.unlabeledSingleFigureQa.persisted.persisted &&
    results.unlabeledSingleFigureQa.persisted.argumentSteps === 1 &&
    results.unlabeledSingleFigureQa.persisted.panels === 0 &&
    results.unlabeledSingleFigureQa.persisted.standardError === '' &&
    results.panelUiEndToEndQa.setup.figureId === 'figure-78' &&
    JSON.stringify(results.panelUiEndToEndQa.setup.panels) === JSON.stringify(['A']) &&
    results.panelUiEndToEndQa.setup.snapshotFigures === 1 &&
    results.panelUiEndToEndQa.interpretationRequests.length === 2 &&
    !results.panelUiEndToEndQa.interpretationRequests[0].repairPass &&
    results.panelUiEndToEndQa.interpretationRequests[1].repairPass &&
    results.panelUiEndToEndQa.interpretationRequests.every(item =>
      item.figureId === 'figure-78' && item.panel === 'A' && !item.hasImage &&
      item.maxTokens === 3072) &&
    results.panelUiEndToEndQa.interpretation.figureOpen &&
    results.panelUiEndToEndQa.interpretation.panelOpen &&
    /重新解读此 Panel/.test(results.panelUiEndToEndQa.interpretation.buttonText) &&
    /比较处理组与匹配对照组/.test(results.panelUiEndToEndQa.interpretation.text) &&
    /图注与相关正文/.test(results.panelUiEndToEndQa.interpretation.inputBasis) &&
    results.panelUiEndToEndQa.interpretation.error === '' &&
    results.panelUiEndToEndQa.interpretation.attempts === 2 &&
    results.panelUiEndToEndQa.interpretation.inputMode === 'caption_context' &&
    results.panelUiEndToEndQa.followupRequests.length === 2 &&
    !results.panelUiEndToEndQa.followupRequests[0].repairPass &&
    results.panelUiEndToEndQa.followupRequests[1].repairPass &&
    results.panelUiEndToEndQa.followupRequests.every(item =>
      item.figureId === 'figure-78' && item.panel === 'A' && !item.hasImage &&
      item.maxTokens === 4096 && item.topics.includes('grouping') &&
      item.customQuestion === '为什么匹配对照对于解释这个 Panel 很重要?') &&
    results.panelUiEndToEndQa.followup.rendered &&
    results.panelUiEndToEndQa.followup.panelOpen &&
    /匹配对照使主要差异集中于处理因素/.test(
      results.panelUiEndToEndQa.followup.answerText) &&
    /为什么匹配对照对于解释这个 Panel 很重要/.test(
      results.panelUiEndToEndQa.followup.questionText) &&
    /回答已生成并显示在下方/.test(results.panelUiEndToEndQa.followup.statusText) &&
    results.panelUiEndToEndQa.followup.focused &&
    results.panelUiEndToEndQa.followup.inViewport &&
    results.panelUiEndToEndQa.followup.historyLength === 2 &&
    !results.panelUiEndToEndQa.followup.loading &&
    results.panelUiEndToEndQa.followup.error === '' &&
    results.panelUiEndToEndQa.followup.attempts === 2 &&
    results.panelUiEndToEndQa.persisted.analysisInMemory &&
    results.panelUiEndToEndQa.persisted.followupInMemory &&
    results.panelUiEndToEndQa.persisted.historyInMemory === 2 &&
    results.panelUiEndToEndQa.persisted.analysisPersisted &&
    results.panelUiEndToEndQa.persisted.followupPersisted &&
    results.panelUiEndToEndQa.persisted.historyPersisted === 2 &&
    results.largeChatHistorySetup.totalTurns === 95 &&
    results.largeChatInitialQa.totalTurns === 95 &&
    results.largeChatInitialQa.snapshotTurns === 30 &&
    results.largeChatInitialQa.renderedTurns === 30 &&
    results.largeChatInitialQa.firstTurnId === 'turn-history-066' &&
    results.largeChatInitialQa.lastTurnId === 'turn-history-095' &&
    /65/.test(results.largeChatInitialQa.remainingLabel) &&
    results.largeChatPage2Qa.snapshotTurns === 60 &&
    results.largeChatPage2Qa.renderedTurns === 60 &&
    results.largeChatPage2Qa.firstTurnId === 'turn-history-036' &&
    results.largeChatPage2Qa.anchorShiftPx <= 3 &&
    results.largeChatPage2Qa.loadMs < 500 &&
    results.largeChatPage3Qa.snapshotTurns === 90 &&
    results.largeChatPage3Qa.renderedTurns === 90 &&
    results.largeChatPage3Qa.firstTurnId === 'turn-history-006' &&
    results.largeChatPage3Qa.anchorShiftPx <= 3 &&
    results.largeChatPage3Qa.loadMs < 500 &&
    results.largeChatPage4Qa.snapshotTurns === 95 &&
    results.largeChatPage4Qa.renderedTurns === 95 &&
    results.largeChatPage4Qa.firstTurnId === 'turn-history-001' &&
    results.largeChatPage4Qa.loadButtonHidden &&
    results.largeChatPage4Qa.anchorShiftPx <= 3 &&
    results.largeChatPage4Qa.loadMs < 500 &&
    results.largeChatDeleteQa.totalTurns === 94 &&
    results.largeChatDeleteQa.snapshotTurns === 94 &&
    results.largeChatDeleteQa.renderedTurns === 94 &&
    results.largeChatDeleteQa.deletedAbsent &&
    results.chatMutationQa.queuedDeleted &&
    !results.chatMutationQa.queuedRemaining &&
    results.chatMutationQa.answerDeleteState.status === 'unanswered' &&
    results.chatMutationQa.answerDeleteState.answerBlocks === 0 &&
    results.chatMutationQa.regenerateState.status === 'completed' &&
    /重新生成成功/.test(results.chatMutationQa.regenerateState.answer) &&
    !results.chatMutationQa.regenerateState.loading &&
    results.chatMutationQa.finalStoredTurns === 0 &&
    results.chatMutationQa.finalIndexTurns === 0 &&
    results.dynamicParagraphQa.paragraphCount === 7 &&
    results.dynamicRemovalAndTextQa.paragraphCount === 6 &&
    results.dynamicRemovalAndTextQa.removedResponsiveCopies &&
    results.dynamicRemovalAndTextQa.characterDataUpdated &&
    results.articleRootReplacementQa.replaced &&
    results.articleRootReplacementQa.paragraphCount === 7 &&
    results.articleRootReplacementQa.replacementIndexed &&
    /7 段正文/.test(results.dynamicParagraphQa.status) &&
    results.panelPromptResetQa.restored &&
    results.panelPromptResetQa.expectedLength > 0 &&
    results.panelPromptResetQa.presetCount ===
      results.panelPromptResetQa.expectedPresetCount &&
    results.panelPromptResetQa.editorDirty &&
    results.categoryEditorControlsQa.categoryIds.length === 2 &&
    results.categoryEditorControlsQa.regexLab.regexSelected &&
    results.categoryEditorControlsQa.regexLab.promptPanelHidden &&
    results.categoryEditorControlsQa.regexLab.matchCount > 0 &&
    results.categoryEditorControlsQa.regexLab.matchedText === 'QA_MATCH_TOKEN' &&
    results.categoryEditorControlsQa.cancelNavigation.stayedOnCategory &&
    results.categoryEditorControlsQa.cancelNavigation.dirtyPreserved &&
    results.categoryEditorControlsQa.cancelNavigation.promptSelected &&
    results.categoryEditorControlsQa.discardNavigation.navigated &&
    results.categoryEditorControlsQa.discardNavigation.dirtyCleared &&
    results.categoryEditorControlsQa.savedOverride.overridden &&
    results.categoryEditorControlsQa.savedOverride.dirtyCleared &&
    /QA Override$/.test(results.categoryEditorControlsQa.savedOverride.name) &&
    results.categoryEditorControlsQa.resetRestoredBuiltIn &&
    !/QA Override$/.test(results.categoryEditorControlsQa.resetName) &&
    results.customCategoryControlsQa.created &&
    results.customCategoryControlsQa.formCleared &&
    results.customCategoryControlsQa.deleted &&
    results.workspaceOverviewFixture.ensured &&
    results.workspaceOverviewFixture.assetSaved &&
    results.workspaceOverviewFixture.turnSaved &&
    results.workspaceOverviewQa.listItemFound &&
    results.workspaceOverviewQa.detailLoaded &&
    results.workspaceOverviewQa.detailCounts?.chatTurns === 1 &&
    results.workspaceOverviewQa.detailCounts?.figures === 2 &&
    results.workspaceOverviewQa.detailCounts?.panels === 3 &&
    results.workspaceOverviewQa.filteredCardCount === 1 &&
    results.workspaceOverviewQa.matchingTitle === 'QA Workspace Search Target' &&
    /问答 1/.test(results.workspaceOverviewQa.metrics) &&
    /Figure 2/.test(results.workspaceOverviewQa.metrics) &&
    /Panel 3/.test(results.workspaceOverviewQa.metrics) &&
    results.workspaceOverviewQa.bulkClearEnabledAfterSelect &&
    results.workspaceOverviewQa.bulkClearDisabledAfterDeselect &&
    results.workspaceOverviewQa.exportedWorkspaceId ===
      results.workspaceOverviewFixture.workspaceId &&
    !results.workspaceOverviewQa.exportContainsSecrets &&
    results.workspaceOverviewQa.restoreWithoutDirectoryExplained &&
    results.workspaceOverviewQa.deletedFromOverview &&
    /已清除 1 篇论文工作区/.test(results.workspaceOverviewQa.clearStatus) &&
    results.workspaceSelectionSortQa.pageOne.sort === 'title_asc' &&
    results.workspaceSelectionSortQa.pageOne.firstTitle === 'QA Pagination 01' &&
    results.workspaceSelectionSortQa.pageOne.visibleCards === 20 &&
    results.workspaceSelectionSortQa.pageOne.selected === 20 &&
    results.workspaceSelectionSortQa.pageOne.selectAllChecked &&
    !results.workspaceSelectionSortQa.pageOne.selectAllIndeterminate &&
    results.workspaceSelectionSortQa.pageOne.bulkClearEnabled &&
    results.workspaceSelectionSortQa.beforePageTwo.selected === 20 &&
    !results.workspaceSelectionSortQa.beforePageTwo.selectAllChecked &&
    !results.workspaceSelectionSortQa.beforePageTwo.selectAllIndeterminate &&
    results.workspaceSelectionSortQa.pageTwo.selected === 21 &&
    results.workspaceSelectionSortQa.pageTwo.selectAllChecked &&
    results.workspaceSelectionSortQa.pageTwo.bulkClearEnabled &&
    results.workspaceSelectionSortQa.afterPageOneClear.selected === 1 &&
    !results.workspaceSelectionSortQa.afterPageOneClear.selectAllChecked &&
    results.workspaceSelectionSortQa.afterPageOneClear.bulkClearEnabled &&
    results.workspaceSelectionSortQa.final.selected === 0 &&
    !results.workspaceSelectionSortQa.final.selectAllChecked &&
    results.workspaceSelectionSortQa.final.bulkClearDisabled &&
    results.workspacePaginationQa.page === 2 &&
    results.workspacePaginationQa.cards === 1 &&
    results.workspacePaginationQa.previousEnabled &&
    results.workspacePaginationQa.nextDisabled &&
    results.workspacePaginationQa.returnedToFirst &&
    results.activeWorkspaceDeletionQa.workspaceIdStable &&
    results.activeWorkspaceDeletionQa.generationAfter >
      results.activeWorkspaceDeletionQa.generationBefore &&
    results.activeWorkspaceDeletionQa.paragraphCountAfter ===
      results.activeWorkspaceDeletionQa.paragraphCountBefore &&
    results.activeWorkspaceDeletionQa.addedParagraphs.length === 0 &&
    results.activeWorkspaceDeletionQa.removedParagraphs.length === 0 &&
    results.activeWorkspaceDeletionQa.workspaceGeneration ===
      results.activeWorkspaceDeletionQa.generationAfter &&
    results.activeWorkspaceDeletionQa.recreatedInOverview &&
    results.activeWorkspaceDeletionQa.storedChatTurns === 0 &&
    results.activeWorkspaceDeletionQa.sidePanelChatTurns === 0 &&
    results.activeWorkspaceDeletionQa.analyzedFigures === 0 &&
    !/读取失败|WORKSPACE_|Cannot access contents/i.test(
      results.activeWorkspaceDeletionQa.navigationStatus || ''
    ) &&
    results.lateFigureSetup.deferred &&
    results.lateFigureSetup.promiseAttached &&
    results.lateFigureSetup.operationActive &&
    results.lateFigureDeletionQa.responseReleased &&
    results.lateFigureDeletionQa.beforeRelease.promiseDetached &&
    !results.lateFigureDeletionQa.beforeRelease.operationActive &&
    results.lateFigureDeletionQa.beforeRelease.progressSize === 0 &&
    results.lateFigureDeletionQa.beforeRelease.statusPhase === 'idle' &&
    !results.lateFigureDeletionQa.beforeRelease.statusRunning &&
    results.lateFigureDeletionQa.promiseDetached &&
    !results.lateFigureDeletionQa.operationActive &&
    results.lateFigureDeletionQa.progressSize === 0 &&
    results.lateFigureDeletionQa.statusPhase === 'idle' &&
    !results.lateFigureDeletionQa.statusRunning &&
    !results.lateFigureDeletionQa.staleFigurePresent &&
    results.lateChatSetup.loading &&
    results.lateChatDeletionQa.responseReleased &&
    results.lateChatDeletionQa.workspaceGeneration >
      results.activeWorkspaceDeletionQa.generationAfter &&
    results.lateChatDeletionQa.chatTurns === 0 &&
    results.lateChatDeletionQa.storedChatTurns === 0 &&
    results.lateChatDeletionQa.sidePanelChatTurns === 0 &&
    !results.lateChatDeletionQa.staleTextInMemory &&
    !results.lateChatDeletionQa.staleTextStored &&
    !results.lateChatDeletionQa.staleTextInSidePanel &&
    !/读取失败|Cannot access contents/i.test(navigationStatus || '') &&
    migrationControls === 3 &&
    supportEmail?.includes('GitHub Issues') &&
    results.migrationDirectoryQa.permission === 'granted' &&
    results.migrationDirectoryQa.directoryName === 'migration-directory-sentinel' &&
    results.migrationDirectoryQa.portableState === 'ready' &&
    !results.migrationDirectoryQa.portablePending &&
    results.migrationDirectoryQa.displayedDirectory === 'migration-directory-sentinel' &&
    results.directorySyncButtonQa.pendingReleased &&
    results.directorySyncButtonQa.syncEnabled &&
    results.directoryReauthorizationQa.pendingReleased &&
    results.directoryReauthorizationQa.permission === 'granted' &&
    results.userDataExportQa.bytes > 0 &&
    !results.userDataExportQa.containsSecrets &&
    results.userDataExportQa.hasSettings &&
    results.userDataExportQa.buttonRecovered &&
    results.directoryRebuildQa.open &&
    results.directoryRebuildQa.description.length > 0 &&
    results.directoryRebuildQa.completed &&
    results.directoryRebuildQa.dialogClosed &&
    results.corpusControlsQa.jsonlLines >= 3 &&
    !results.corpusControlsQa.jsonlContainsForbiddenUrl &&
    results.corpusControlsQa.csvHasHeader &&
    !results.corpusControlsQa.csvContainsForbiddenUrl &&
    results.corpusControlsQa.distilledResultPatterns.includes('we found') &&
    results.corpusControlsQa.downloadsNonEmpty &&
    results.duplicatedProfileQa.isDistinct &&
    /Migration QA Profile 副本/.test(results.duplicatedProfileQa.name) &&
    results.duplicatedProfileQa.apiKeyMasked &&
    results.profileMutationQa.selectedOriginalAfterDuplicateDelete &&
    results.profileMutationQa.globalProfileId === migrationProfileId &&
    results.profileMutationQa.figureRouteProfileId === migrationProfileId &&
    results.profileMutationQa.crossFigureRouteProfileId === migrationProfileId &&
    results.profileMutationQa.profileCount === initialProfileCount + 1 &&
    results.migrationExportQa.kind === 'sci-logic-highlighter-migration' &&
    results.migrationExportQa.schemaVersion === 1 &&
    results.migrationExportQa.containsApiKey &&
    results.migrationExportQa.globalProfileId === migrationProfileId &&
    results.migrationExportQa.figureRouteProfileId === migrationProfileId &&
    results.migrationExportQa.crossFigureRouteProfileId === migrationProfileId &&
    results.migrationExportQa.bytes > 0 &&
    results.migrationDialogQa.open &&
    results.migrationDialogQa.pendingBundleReady &&
    /完整模型与分类配置/.test(results.migrationDialogQa.description) &&
    /当前浏览器已有的目录授权不会改变/.test(
      results.migrationDialogQa.description
    ) &&
    !/本地目录需稍后重新选择/.test(results.migrationDialogQa.description) &&
    results.migrationImportQa.profileRestored &&
    results.migrationImportQa.profileName === 'Migration QA Profile' &&
    results.migrationImportQa.apiKeyCleared &&
    results.migrationImportQa.apiKeyMasked &&
    results.migrationImportQa.apiKeyStored &&
    results.migrationImportQa.globalProfileId === migrationProfileId &&
    results.migrationImportQa.figureRouteProfileId === migrationProfileId &&
    results.migrationImportQa.crossFigureRouteProfileId === migrationProfileId &&
    results.migrationImportQa.directoryHandlePresent &&
    results.migrationImportQa.directoryName === 'migration-directory-sentinel' &&
    results.migrationImportQa.directoryPermission === 'granted' &&
    results.migrationImportQa.sameDirectoryHandle &&
    results.migrationImportQa.displayedDirectory === 'migration-directory-sentinel' &&
    /当前本地目录授权保持不变/.test(results.migrationImportQa.status) &&
    !/请重新选择本地保存目录/.test(results.migrationImportQa.status) &&
    results.migrationImportQa.importButtonRecovered &&
    results.modelConfigurationQa.deepseekDefault === 'deepseek-v4-flash' &&
    results.modelConfigurationQa.deepseekSuggestions.includes('deepseek-v4-pro') &&
    results.modelConfigurationQa.deepseekSuggestions.includes('deepseek-v4-flash') &&
    results.modelConfigurationQa.customModelAccepted &&
    results.modelConfigurationQa.compatibleFieldsVisible &&
    results.modelConfigurationQa.presetResult.model === 'qwen-flash' &&
    results.modelConfigurationQa.presetResult.baseUrl ===
      'https://dashscope.aliyuncs.com/compatible-mode/v1' &&
    results.modelConfigurationQa.presetResult.suggestions.includes('qwen-flash') &&
    results.modelConfigurationQa.customCompatibleModelAccepted &&
    results.modelConfigurationQa.rejected &&
    /Base URL 格式不正确/.test(results.modelConfigurationQa.failureStatus) &&
    results.modelConfigurationQa.saveButtonRecovered &&
    results.modelConfigurationQa.testButtonRecovered &&
    results.modelConfigurationQa.preDisabledButtonPreserved &&
    results.modelConfigurationQa.saveGuardReleased &&
    results.tokenRoutingUiQa.automaticLive.mode === 'auto' &&
    results.tokenRoutingUiQa.automaticLive.manualMax === null &&
    results.tokenRoutingUiQa.automaticLive.autoCap === null &&
    results.tokenRoutingUiQa.automaticLive.contextWindowTokens === 131072 &&
    results.tokenRoutingUiQa.automaticLive.highlightRouteMode === 'profile' &&
    results.tokenRoutingUiQa.automaticLive.highlightRoute === migrationProfileId &&
    results.tokenRoutingUiQa.automaticLive.autoAnalyze &&
    !results.tokenRoutingUiQa.automaticLive.dirty &&
    /模型与路由设置已保存/.test(results.tokenRoutingUiQa.automaticLive.status) &&
    results.tokenRoutingUiQa.automaticStored.mode === 'auto' &&
    results.tokenRoutingUiQa.automaticStored.manualMax === null &&
    results.tokenRoutingUiQa.automaticStored.autoCap === null &&
    results.tokenRoutingUiQa.automaticStored.contextWindowTokens === 131072 &&
    results.tokenRoutingUiQa.automaticStored.highlightRoute === migrationProfileId &&
    results.tokenRoutingUiQa.automaticStored.autoAnalyze &&
    results.tokenRoutingUiQa.automaticReload.mode === 'auto' &&
    results.tokenRoutingUiQa.automaticReload.manualMax === null &&
    results.tokenRoutingUiQa.automaticReload.autoCap === null &&
    results.tokenRoutingUiQa.automaticReload.contextValue === '131072' &&
    results.tokenRoutingUiQa.automaticReload.highlightRoute === migrationProfileId &&
    results.tokenRoutingUiQa.automaticReload.autoAnalyze &&
    results.tokenRoutingUiQa.automaticReload.selectedProfileId === migrationProfileId &&
    results.tokenRoutingUiQa.clearedContextLive.mode === 'auto' &&
    results.tokenRoutingUiQa.clearedContextLive.manualMax === null &&
    results.tokenRoutingUiQa.clearedContextLive.autoCap === null &&
    results.tokenRoutingUiQa.clearedContextLive.contextWindowTokens === null &&
    results.tokenRoutingUiQa.clearedContextLive.highlightRouteMode === 'profile' &&
    results.tokenRoutingUiQa.clearedContextLive.highlightRoute === migrationProfileId &&
    results.tokenRoutingUiQa.clearedContextLive.autoAnalyze &&
    !results.tokenRoutingUiQa.clearedContextLive.dirty &&
    /模型与路由设置已保存/.test(results.tokenRoutingUiQa.clearedContextLive.status) &&
    results.tokenRoutingUiQa.clearedContextReload.mode === 'auto' &&
    results.tokenRoutingUiQa.clearedContextReload.manualMax === null &&
    results.tokenRoutingUiQa.clearedContextReload.autoCap === null &&
    results.tokenRoutingUiQa.clearedContextReload.contextValue === '' &&
    results.tokenRoutingUiQa.clearedContextReload.highlightRoute === migrationProfileId &&
    results.tokenRoutingUiQa.clearedContextReload.autoAnalyze &&
    results.tokenRoutingUiQa.clearedContextReload.selectedProfileId === migrationProfileId &&
    results.tokenRoutingUiQa.clearedContextReload.saveButtonRecovered &&
    results.tokenRoutingUiQa.clearedContextReload.dirtyCleared &&
    results.onboardingControlsQa.reopen.active &&
    results.onboardingControlsQa.reopen.step === 'storage' &&
    typeof results.onboardingControlsQa.reopen.acknowledged === 'boolean' &&
    results.onboardingControlsQa.reopen.sourceTabId === fixtureTab.id &&
    results.onboardingControlsQa.continue.step === 'api' &&
    results.onboardingControlsQa.continue.storageState === 'completed' &&
    results.onboardingControlsQa.back.step === 'storage' &&
    results.onboardingControlsQa.back.guideVisible &&
    results.onboardingControlsQa.skip.step === 'api' &&
    results.onboardingControlsQa.skip.storageState === 'skipped' &&
    results.settingsDatabaseQa.moduleAvailable &&
    results.settingsDatabaseQa.directoryStoreAvailable &&
    results.settingsDatabaseQa.configuredDirectorySkipsStorage &&
    results.settingsDatabaseQa.continuedToApi &&
    results.providerRequestQa.method === 'POST' &&
    results.providerRequestQa.path === '/v1/chat/completions' &&
    results.providerRequestQa.model === 'qa-onboarding-model' &&
    results.providerRequestQa.authorizationPresent &&
    results.providerRequestQa.connectivityPromptPresent &&
    results.providerRequestQa.streamingRequested &&
    results.providerPendingUiQa.disabled &&
    results.providerPendingUiQa.busy &&
    results.providerPendingUiQa.saveDisabled &&
    results.providerPendingUiQa.testGuardActive &&
    results.providerCompletedUiQa.testRecovered &&
    results.providerCompletedUiQa.saveRecovered &&
    results.providerCompletedUiQa.busyReleased &&
    /连接成功/.test(results.providerCompletedUiQa.status) &&
    results.providerCompletedUiQa.apiKeyCleared &&
    results.providerCompletedUiQa.apiKeyMasked &&
    results.providerCompletedUiQa.finishEnabled &&
    results.providerCompletedUiQa.testGuardReleased &&
    results.onboardingOptionsClosed &&
    results.onboardingReturnQa.sourceTabStillOpen &&
    results.onboardingReturnQa.sourceTabActive &&
    results.onboardingReturnQa.sidePanelEnabled &&
    results.onboardingReturnQa.activated &&
    results.onboardingReturnQa.acknowledged &&
    results.onboardingReturnQa.storageStep === 'completed' &&
    results.onboardingReturnQa.apiStep === 'completed' &&
    results.sidePanelSettingsShortcutQa.openedOptionsPage &&
    results.sidePanelSettingsShortcutQa.categoryWorkspaceHash &&
    results.sidePanelSettingsShortcutQa.categoryWorkspaceVisible &&
    results.sidePanelSettingsShortcutQa.categoryHeadingVisible &&
    results.sidePanelSettingsShortcutQa.gearRecovered &&
    results.sidePanelSettingsShortcutQa.legacyMenuRemoved &&
    results.adapterDiagnostic.kind === 'sci-publisher-adapter-diagnostic' &&
    results.adapterDiagnostic.schemaVersion === 2 &&
    results.adapterDiagnostic.hasRenderedDom &&
    results.adapterDiagnostic.selectorCoverage > 0 &&
    results.adapterDiagnostic.traceCount > 0 &&
    results.adapterDiagnostic.extractionFailureRecorded &&
    results.adapterDiagnostic.survivesExtractionFailure &&
    results.adapterDiagnostic.patchResult.patched === true &&
    results.adapterDiagnostic.patchResult.response?.success === false &&
    results.adapterDiagnostic.failedConnectionUi.retryVisible === false &&
    /generic/i.test(results.adapterDiagnostic.failedConnectionUi.status) &&
    pageErrors.length === 0;

  if (!passed) {
    const qaSource = fs.readFileSync(__filename, 'utf8');
    const diagnosticBlockStart = qaSource.indexOf(
      '\n  if (!passed) {\n    const qaSource'
    );
    const qaStart = qaSource.lastIndexOf('\n  const passed =\n', diagnosticBlockStart);
    const qaEnd = diagnosticBlockStart;
    const qaExpression = qaSource
      .slice(qaStart + '\n  const passed ='.length, qaEnd)
      .replace(/;\s*$/, '')
      .trim();
    const checks = qaExpression.split(/&&\r?\n    (?=\S)/);
    results.failedQaChecks = checks.map((source, index) => {
      try {
        return {
          index: index + 1,
          passed: Boolean(eval(source)),
          source: source.replace(/\s+/g, ' ').trim().slice(0, 320)
        };
      } catch (error) {
        return {
          index: index + 1,
          passed: false,
          source: source.replace(/\s+/g, ' ').trim().slice(0, 320),
          error: error.message
        };
      }
    }).filter(item => !item.passed);
  }
  results.qaPassed = passed;
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(
    path.join(outputDir, 'edge-native-side-panel-qa.json'),
    `${JSON.stringify(results, null, 2)}\n`,
    'utf8'
  );
  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
  await context.close();
  activeContext = null;
  await closeHttpServer(providerServer);
  providerServer = null;
  fs.rmSync(userDataDir, { recursive: true, force: true });
  fs.rmSync(extensionDir, { recursive: true, force: true });
  if (!passed) process.exitCode = 1;
})().catch(async error => {
  console.error(error.stack || error);
  try { releaseProviderResponse?.(); } catch (_) {}
  try { await activeContext?.close(); } catch (_) {}
  activeContext = null;
  try {
    if (analysisProviderServer) await closeHttpServer(analysisProviderServer);
  } catch (_) {}
  analysisProviderServer = null;
  try {
    if (providerServer) await closeHttpServer(providerServer);
  } catch (_) {}
  providerServer = null;
  try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (_) {}
  try { fs.rmSync(extensionDir, { recursive: true, force: true }); } catch (_) {}
  process.exitCode = 1;
});
