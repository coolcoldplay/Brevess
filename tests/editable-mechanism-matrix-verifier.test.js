const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const verifierPath = path.join(root, 'scripts', 'verify-editable-mechanism-matrix.mjs');
const matrixPath = path.join(
  root, 'docs', 'qa', '2026-08-17-editable-mechanism-matrix-matrix.md'
);

async function verifier() {
  return import(`${pathToFileURL(verifierPath).href}?test=${Date.now()}-${Math.random()}`);
}

test('editable matrix verifier names the three mandatory real papers', async () => {
  const { requiredPapers } = await verifier();
  assert.deepEqual(requiredPapers.map(({ key, title }) => ({ key, title })), [
    {
      key: 'neuron-2026-dopamine-circuits',
      title: 'Receptor and cell-type-specific mechanisms in mesocortical dopamine circuits gate chronic pain and comorbid symptoms'
    },
    {
      key: 'neuron-2020-hippocampal-ripples',
      title: 'Routing of Hippocampal Ripples to Subcortical Structures via the Lateral Septum'
    },
    {
      key: 'nat-neuro-2020-srpx2',
      title: 'The endogenous neuronal complement inhibitor SRPX2 protects against complement-mediated synapse elimination during development'
    }
  ]);
});

test('Panel coverage audit rejects missing dispositions and phantom table chips', async () => {
  const { auditPanelCoverage } = await verifier();
  const ledger = [
    { figureId: 'figure-1', panelId: 'A', disposition: 'linked' },
    { figureId: 'figure-1', panelId: 'B', disposition: '' },
    { figureId: 'figure-2', panelId: 'A', disposition: 'excluded' }
  ];
  const audit = auditPanelCoverage({
    ledger,
    originalPanels: [
      { figureId: 'figure-1', panelId: 'A' },
      { figureId: 'figure-1', panelId: 'B' },
      { figureId: 'figure-2', panelId: 'A' }
    ],
    tableChips: [
      { figureId: 'figure-1', panelId: 'A' },
      { figureId: 'figure-9', panelId: 'Z' }
    ]
  });
  assert.equal(audit.ok, false);
  assert.deepEqual(audit.missingDispositions, ['figure-1\u0000B']);
  assert.deepEqual(audit.phantomTableChips, ['figure-9\u0000Z']);
  assert.deepEqual(audit.linkedMissingFromTable, []);
});

test('malformed Panel identities fail closed without recursion', async () => {
  const { auditPanelCoverage } = await verifier();
  const result = auditPanelCoverage({
    ledger: [{}, { panelKey: '' }], originalPanels: [{}], tableChips: [{}]
  });
  assert.equal(result.ok, false);
  assert.equal(result.counts.discovered, 0);
});

test('Panel coverage audit accepts linked cells plus explicit non-linked dispositions', async () => {
  const { auditPanelCoverage } = await verifier();
  const audit = auditPanelCoverage({
    ledger: [
      { figureId: 'f1', panelId: 'A', disposition: 'linked' },
      { figureId: 'f1', panelId: 'B', disposition: 'unlinked' },
      { figureId: 'f1', panelId: 'C', disposition: 'excluded' },
      { figureId: 'f1', panelId: 'D', disposition: 'ambiguous' }
    ],
    originalPanels: ['f1\u0000A', 'f1\u0000B', 'f1\u0000C', 'f1\u0000D'],
    tableChips: [{ figureId: 'f1', panelId: 'A' }]
  });
  assert.equal(audit.ok, true);
  assert.deepEqual(audit.counts, {
    discovered: 4, linked: 1, unlinked: 1, excluded: 1, ambiguous: 1,
    tableChips: 1
  });
});

test('non-linked dispositions must be visibly represented in the audit UI', async () => {
  const { auditPanelCoverage } = await verifier();
  const input = {
    ledger: [
      { figureId: 'f1', panelId: 'A', disposition: 'linked' },
      { figureId: 'f1', panelId: 'B', disposition: 'unlinked' }
    ],
    originalPanels: ['f1\u0000A', 'f1\u0000B'],
    tableChips: [{ figureId: 'f1', panelId: 'A' }],
    visibleDispositionKeys: []
  };
  const hidden = auditPanelCoverage(input);
  assert.equal(hidden.ok, false);
  assert.deepEqual(hidden.nonLinkedMissingFromAuditUi, ['f1\u0000B']);
  assert.equal(auditPanelCoverage({
    ...input, visibleDispositionKeys: ['f1\u0000B']
  }).ok, true);
  const contradictory = auditPanelCoverage({
    ...input,
    tableChips: [{ figureId: 'f1', panelId: 'A' }, { figureId: 'f1', panelId: 'B' }],
    visibleDispositionKeys: ['f1\u0000B']
  });
  assert.equal(contradictory.ok, false);
  assert.deepEqual(contradictory.nonLinkedPresentInTable, ['f1\u0000B']);
});

test('original-article Panel comparison requires an explicit human inspection record', async () => {
  const { auditOriginalPanelInspection } = await verifier();
  assert.equal(auditOriginalPanelInspection({ status: 'PASS' }).ok, false);
  assert.equal(auditOriginalPanelInspection({
    status: 'PASS', originalArticleReviewed: true,
    observation: 'All captioned Panels were checked against the original article.'
  }).ok, true);
  assert.equal(auditOriginalPanelInspection({
    status: 'PASS', originalArticleReviewed: true, observation: 'Checked.',
    paperKey: 'paper-a', pdfSha256: 'a'.repeat(64), archiveSha256: 'b'.repeat(64),
    panelManifestSha256: 'c'.repeat(64)
  }, {
    paperKey: 'paper-b', pdfSha256: 'a'.repeat(64), archiveSha256: 'b'.repeat(64),
    panelManifestSha256: 'c'.repeat(64)
  }).ok, false);
  const source = fs.readFileSync(verifierPath, 'utf8');
  assert.match(source, /PENDING_EXTERNAL_INPUT: original-article Panel inspection missing/);
});

test('paper identity gate binds PDF archive Panel manifest and live article title', async () => {
  const { auditPaperBindings } = await verifier();
  const expected = {
    key: 'paper-a', title: 'A receptor mechanism in neuronal circuits',
    sha256: 'a'.repeat(64), archiveSha256: 'b'.repeat(64),
    panelManifestSha256: 'c'.repeat(64), pageCount: 12
  };
  assert.equal(auditPaperBindings(expected, {
    pdfSha256: 'a'.repeat(64), archiveSha256: 'b'.repeat(64),
    panelManifestSha256: 'c'.repeat(64), pageCount: 12,
    archiveTitle: expected.title, liveArticleTitle: `${expected.title} | Journal`
  }).ok, true);
  assert.equal(auditPaperBindings(expected, {
    pdfSha256: 'd'.repeat(64), archiveSha256: 'b'.repeat(64),
    panelManifestSha256: 'c'.repeat(64), pageCount: 12,
    archiveTitle: expected.title, liveArticleTitle: expected.title
  }).ok, false);
});

test('live title gate waits for an asynchronously populated real article title', async () => {
  const { waitForMatchingArticleTitle } = await verifier();
  const titles = [
    'Europe PMC',
    'Europe PMC',
    'Routing of Hippocampal Ripples to Subcortical Structures via the Lateral Septum. - Abstract - Europe PMC'
  ];
  let reads = 0;
  const page = {
    title: async () => titles[Math.min(reads++, titles.length - 1)],
    waitForTimeout: async () => undefined
  };
  const result = await waitForMatchingArticleTitle(
    page,
    'Routing of Hippocampal Ripples to Subcortical Structures via the Lateral Septum',
    { timeoutMs: 1000, pollMs: 1 }
  );
  assert.equal(result.matched, true);
  assert.equal(result.title, titles.at(-1));
  assert.equal(reads, 3);
});

test('live title gate times out without weakening the identity audit', async () => {
  const { waitForMatchingArticleTitle, auditPaperBindings } = await verifier();
  const result = await waitForMatchingArticleTitle({
    title: async () => 'Europe PMC', waitForTimeout: async () => undefined
  }, 'A receptor mechanism in neuronal circuits', { timeoutMs: 2, pollMs: 1 });
  assert.equal(result.matched, false);
  assert.equal(auditPaperBindings({
    title: 'A receptor mechanism in neuronal circuits', sha256: 'a'.repeat(64),
    archiveSha256: 'b'.repeat(64), panelManifestSha256: 'c'.repeat(64), pageCount: 12
  }, {
    pdfSha256: 'a'.repeat(64), archiveSha256: 'b'.repeat(64),
    panelManifestSha256: 'c'.repeat(64), pageCount: 12,
    archiveTitle: 'A receptor mechanism in neuronal circuits',
    liveArticleTitle: result.title
  }).ok, false);
});

test('real article reaches browser load completion before activation opens the popup', () => {
  const source = fs.readFileSync(verifierPath, 'utf8');
  const runPaper = source.indexOf('async function runPaper(');
  const load = source.indexOf("waitForLoadState('load'", runPaper);
  const activate = source.indexOf('activateArticle(worker, articlePage)', runPaper);
  const open = source.indexOf('openPanel(context, worker, extensionId, tab, archive)', activate);

  assert.ok(load > runPaper);
  assert.ok(activate > load);
  assert.ok(open > activate);
});

test('live article identity preparation retries until the current tab has a documentId', async () => {
  const { prepareLiveArticleIdentity } = await verifier();
  const states = [
    { ready: false, stale: false, documentId: '' },
    { ready: false, stale: false, documentId: '' },
    { ready: true, stale: false, documentId: `sha256:${'a'.repeat(64)}` }
  ];
  let calls = 0;
  const worker = { evaluate: async () => states[Math.min(calls++, states.length - 1)] };
  const result = await prepareLiveArticleIdentity(worker, {
    id: 91, url: 'https://example.test/article', pendingUrl: ''
  }, { timeoutMs: 1000, pollMs: 1, wait: async () => undefined });
  assert.equal(result.ready, true);
  assert.equal(result.stale, false);
  assert.equal(calls, 3);
});

test('live article identity preparation fails closed on stale tab generation', async () => {
  const { prepareLiveArticleIdentity } = await verifier();
  let waited = false;
  const result = await prepareLiveArticleIdentity({
    evaluate: async () => ({ ready: false, stale: true, documentId: '' })
  }, { id: 91, url: 'https://example.test/article', pendingUrl: '' }, {
    timeoutMs: 1000, pollMs: 1, wait: async () => { waited = true; }
  });
  assert.deepEqual(result, { ready: false, stale: true, documentId: '' });
  assert.equal(waited, false);
});

test('live article identity preparation keeps an exact double-prepare execution proof', () => {
  const source = fs.readFileSync(verifierPath, 'utf8');
  const start = source.indexOf('export async function prepareLiveArticleIdentity');
  const end = source.indexOf('\nexport function sameLiveArticleIdentity', start);
  const preparation = source.slice(start, end);
  assert.equal((preparation.match(/action:\s*'prepareManualAnnotations'/gu) || []).length, 2);
  assert.match(preparation, /contentWorldNonce:\s*String\(/u);
  assert.match(preparation, /documentEpoch:\s*Number\(/u);
  assert.match(preparation, /sameLiveArticleIdentityProof\(firstProof, secondProof\)/u);
});

test('restore transaction navigation sandwich is zero-write and identity matching is exact', async () => {
  const { applyArchiveRestoreTransaction, sameLiveArticleIdentity } = await verifier();
  const identity = {
    documentId: `sha256:${'a'.repeat(64)}`, documentHash: 'b'.repeat(64),
    canonicalUrl: 'https://example.test/paper',
    contentWorldNonce: 'c'.repeat(32), documentEpoch: 4
  };
  assert.equal(sameLiveArticleIdentity(identity, { ...identity }), true);
  assert.equal(sameLiveArticleIdentity(identity, { ...identity, documentHash: 'c'.repeat(64) }), false);
  assert.equal(sameLiveArticleIdentity(identity, {
    ...identity, contentWorldNonce: 'd'.repeat(32)
  }), false);
  assert.equal(sameLiveArticleIdentity(identity, { ...identity, documentEpoch: 5 }), false);
  let writes = 0;
  await assert.rejects(applyArchiveRestoreTransaction({
    prepare: async () => ({ ...identity, ready: true, stale: false }),
    verifyTab: async () => false,
    commit: async () => { writes += 1; }
  }), /live article tab changed/u);
  assert.equal(writes, 0);
});

test('restore transaction retries the whole bounded snapshot after a strict target mismatch', async () => {
  const { applyArchiveRestoreTransaction } = await verifier();
  const identity = {
    ready: true, stale: false, documentId: `sha256:${'a'.repeat(64)}`,
    documentHash: 'b'.repeat(64), canonicalUrl: 'https://example.test/paper'
  };
  let prepares = 0;
  let commits = 0;
  const result = await applyArchiveRestoreTransaction({
    attempts: 2,
    prepare: async () => { prepares += 1; return { ...identity }; },
    verifyTab: async () => true,
    commit: async () => {
      commits += 1;
      if (commits === 1) throw new Error('ARTICLE_WORKSPACE_RESTORE_TARGET_MISMATCH');
      return 'applied';
    },
    wait: async () => undefined
  });
  assert.equal(result.result, 'applied');
  assert.equal(prepares, 2);
  assert.equal(commits, 2);
});

test('restore transaction retries the whole snapshot when popup identity refresh is superseded', async () => {
  const { applyArchiveRestoreTransaction } = await verifier();
  const identity = {
    ready: true, stale: false, documentId: `sha256:${'a'.repeat(64)}`,
    documentHash: 'b'.repeat(64), canonicalUrl: 'https://example.test/paper'
  };
  let prepares = 0;
  let commits = 0;
  const result = await applyArchiveRestoreTransaction({
    attempts: 2,
    prepare: async () => { prepares += 1; return { ...identity }; },
    verifyTab: async () => true,
    commit: async () => {
      commits += 1;
      if (commits === 1) throw new Error('EDITABLE_MATRIX_POPUP_IDENTITY_RACE');
      return 'applied';
    },
    wait: async () => undefined
  });
  assert.equal(result.result, 'applied');
  assert.equal(prepares, 2);
  assert.equal(commits, 2);
});

test('openPanel advances only to the exact post-commit manual execution proof', async () => {
  const { postCommitLiveArticleIdentity } = await verifier();
  const frozen = {
    ready: true, stale: false,
    documentId: `sha256:${'a'.repeat(64)}`,
    documentHash: 'b'.repeat(64), canonicalUrl: 'https://example.test/paper',
    contentWorldNonce: 'c'.repeat(32), documentEpoch: 4
  };
  const proof = {
    documentId: frozen.documentId, documentHash: frozen.documentHash,
    canonicalUrl: frozen.canonicalUrl,
    contentWorldNonce: frozen.contentWorldNonce, documentEpoch: 5,
    annotationCount: 2, unresolvedCount: 0
  };
  assert.deepEqual(postCommitLiveArticleIdentity({
    success: true, manualExecutionProof: proof
  }, frozen), { ...proof, ready: true, stale: false });
  for (const invalid of [
    { ...proof, documentHash: 'd'.repeat(64) },
    { ...proof, contentWorldNonce: 'e'.repeat(32) },
    { ...proof, documentEpoch: frozen.documentEpoch }
  ]) assert.equal(postCommitLiveArticleIdentity({
    success: true, manualExecutionProof: invalid
  }, frozen), null);
  assert.equal(postCommitLiveArticleIdentity({
    success: false, manualExecutionProof: proof
  }, frozen), null);

  const source = fs.readFileSync(verifierPath, 'utf8');
  const open = source.indexOf('async function openPanel');
  const commit = source.indexOf('commit: identity => page.evaluate', open);
  const applied = source.indexOf('const applied = await applyLoadedArticleArchive(', commit);
  const afterTab = source.indexOf('chrome.tabs.get(expected.id)', applied);
  const proofUse = source.indexOf('postCommitLiveArticleIdentity', applied);
  const selected = source.indexOf('const preparedIdentity = transaction.result', proofUse);
  assert.ok(open >= 0 && commit > open && applied > commit && afterTab > applied &&
    proofUse > afterTab && selected > proofUse);
});

test('post-commit proof diagnostics expose only status and boolean match dimensions', async () => {
  const {
    safePostCommitProofDiagnostics,
    safePostCommitProofDiagnosticsFromError,
    safeFigureWorkspacePersistenceProbe
  } = await verifier();
  const frozen = {
    documentId: 'private-document-value', documentHash: 'private-hash-value',
    canonicalUrl: 'https://private.example/paper',
    contentWorldNonce: 'a'.repeat(32), documentEpoch: 7
  };
  const diagnostics = safePostCommitProofDiagnostics({
    success: false, committed: true, retryable: false,
    postCommitStatus: 'content-reinitialize-proof-failed',
    manualExecutionProof: {
      ...frozen, documentHash: 'different-private-hash', documentEpoch: 8
    }
  }, frozen);
  assert.deepEqual(Object.keys(diagnostics), [
    'success', 'committed', 'retryable', 'postCommitStatus', 'proofPresent',
    'documentIdMatch', 'documentHashMatch', 'canonicalUrlMatch',
    'contentWorldNonceMatch', 'documentEpochAdvanced'
  ]);
  assert.equal(diagnostics.success, false);
  assert.equal(diagnostics.committed, true);
  assert.equal(diagnostics.postCommitStatus, 'content-reinitialize-proof-failed');
  assert.equal(diagnostics.proofPresent, true);
  assert.equal(diagnostics.documentIdMatch, true);
  assert.equal(diagnostics.documentHashMatch, false);
  assert.equal(diagnostics.documentEpochAdvanced, true);
  assert.doesNotMatch(JSON.stringify(diagnostics),
    /private-document|private-hash|private\.example|different-private/u);
  assert.equal(safePostCommitProofDiagnostics({
    postCommitStatus: 'unsafe secret value / path'
  }, frozen).postCommitStatus, 'invalid');
  const wrapped = `page.evaluate: Error: ` +
    `EDITABLE_MATRIX_POPUP_POST_COMMIT_IDENTITY_MISMATCH:${JSON.stringify(diagnostics)}` +
    `\n    at chrome-extension://private-stack-location`;
  assert.deepEqual(safePostCommitProofDiagnosticsFromError(wrapped), diagnostics);
  assert.equal(safePostCommitProofDiagnosticsFromError(
    'EDITABLE_MATRIX_POPUP_POST_COMMIT_IDENTITY_MISMATCH:{"success":"secret"}'
  )?.success, false);
  assert.deepEqual(safeFigureWorkspacePersistenceProbe({
    success: false, code: 'FIGURE_WORKSPACE_REVISION_CONFLICT',
    error: 'private message and path'
  }), { success: false, code: 'FIGURE_WORKSPACE_REVISION_CONFLICT' });
  assert.deepEqual(safeFigureWorkspacePersistenceProbe({
    success: false, code: 'unsafe private code / path'
  }), { success: false, code: 'FIGURE_WORKSPACE_PROBE_INVALID_CODE' });
});

test('popup recovery injects the content script before live identity preparation', () => {
  const source = fs.readFileSync(verifierPath, 'utf8');
  const openPanel = source.indexOf('async function openPanel');
  const activate = source.indexOf('chrome.tabs.update(tabId, { active: true })', openPanel);
  const initialize = source.indexOf('await initializeCurrentArticle()', activate);
  const transaction = source.indexOf('applyArchiveRestoreTransaction({', activate);
  const prepare = source.indexOf('prepareLiveArticleIdentity(worker, tab)', transaction);
  const refresh = source.indexOf('await refreshManualAnnotationSummary(', prepare);
  const rebind = source.indexOf('activePanelTabContext = {', refresh);
  const applyIdentity = source.indexOf('applyManualAnnotationStateEvent(', rebind);
  const apply = source.indexOf('await applyLoadedArticleArchive(', applyIdentity);
  assert.ok(openPanel >= 0 && activate > openPanel && initialize > activate);
  assert.ok(transaction > initialize && prepare > transaction &&
    refresh > prepare && rebind > refresh &&
    applyIdentity > rebind && apply > applyIdentity);
});

test('popup commit requires exact refreshed manual identity and a second normalized URL check', () => {
  const source = fs.readFileSync(verifierPath, 'utf8');
  const transaction = source.indexOf('applyArchiveRestoreTransaction({');
  const secondTabRead = source.indexOf('chrome.tabs.get(expected.id)', transaction);
  const refreshed = source.indexOf('const refreshedIdentity = await refreshManualAnnotationSummary(', transaction);
  const exact = source.indexOf('sameLiveArticleIdentity(refreshedIdentity, identity)', refreshed);
  const apply = source.indexOf('await applyLoadedArticleArchive(', exact);
  assert.ok(transaction >= 0 && secondTabRead > transaction && refreshed > secondTabRead &&
    exact > refreshed && apply > exact);
});

test('populated evidence editor opens only after the resized matrix has stabilized', () => {
  const source = fs.readFileSync(verifierPath, 'utf8');
  const scenario = source.indexOf('completed.add_evidence_to_empty_cell = true;');
  const viewport = source.indexOf('await page.setViewportSize({ width: 700, height: 1000 })', scenario);
  const stable = source.indexOf('await page.waitForFunction(', viewport);
  const populated = source.indexOf('const populated = await evidenceOutsideCell(', stable);
  const click = source.indexOf('await populated.click()', scenario);
  const alias = source.indexOf("const alias = page.locator('.workspace-mechanism-matrix-cell-editor '", click);
  const resizeAfterClick = source.indexOf('await page.setViewportSize(', click);
  assert.ok(scenario >= 0 && viewport > scenario && stable > viewport && populated > stable &&
    click > populated && alias > click);
  assert.ok(resizeAfterClick < 0 || resizeAfterClick > alias,
    'viewport must not resize between opening the editor and locating its controls');
});

test('evidence deletion restores a stable desktop viewport before native click', () => {
  const source = fs.readFileSync(verifierPath, 'utf8');
  const narrowShot = source.indexOf(
    "await screenshot(page, artifactDir, 'narrow-long-alias-ellipsis.png')"
  );
  const desktop = source.indexOf('await page.setViewportSize({ width: 700, height: 1000 })', narrowShot);
  const stable = source.indexOf('await page.waitForFunction(', desktop);
  const locate = source.indexOf('const addedCell = await matrixCellFor(', stable);
  const click = source.indexOf("addedCell.locator('.workspace-mechanism-matrix-evidence').first().click()", locate);
  assert.ok(narrowShot >= 0 && desktop > narrowShot && stable > desktop &&
    locate > stable && click > locate);
  assert.doesNotMatch(source.slice(narrowShot, click), /\.click\s*\(\s*\{[^}]*force\s*:\s*true/u);
});

test('popup reload revalidates the same live article identity before workspace refresh', () => {
  const source = fs.readFileSync(verifierPath, 'utf8');
  const rebind = source.indexOf('async function rebindPanelAfterReload');
  const activate = source.indexOf('chrome.tabs.update(tabId, { active: true })', rebind);
  const transaction = source.indexOf('applyArchiveRestoreTransaction({', activate);
  const prepare = source.indexOf('prepareLiveArticleIdentity(worker, articleTab)', transaction);
  const context = source.indexOf('activePanelTabContext = {', prepare);
  const manual = source.indexOf('const refreshedIdentity = await refreshManualAnnotationSummary(', context);
  const identityCheck = source.indexOf('PENDING_EXTERNAL_INPUT: live article identity changed', manual);
  const state = source.indexOf('applyManualAnnotationStateEvent(', manual);
  const workspace = source.indexOf('await refreshArticleWorkspace({ force: true })', state);
  assert.ok(rebind >= 0 && activate > rebind && transaction > activate && prepare > transaction &&
    context > prepare && manual > context && identityCheck > manual &&
    state > manual && workspace > state);
});

test('graph stability audit is byte-exact and rejects Panel names in Mermaid or SVG', async () => {
  const { auditGraphStability } = await verifier();
  const clean = auditGraphStability({
    before: { mermaid: 'flowchart TD\nA[Source] --> B[Target]', svg: '<svg>Source Target</svg>' },
    afterAlias: { mermaid: 'flowchart TD\nA[Source] --> B[Target]', svg: '<svg>Source Target</svg>' },
    afterClass: { mermaid: 'flowchart TD\nA[Source] --> B[Target]', svg: '<svg>Source Target</svg>' },
    forbiddenPanelNames: ['1A', 'reviewed alias']
  });
  assert.equal(clean.ok, true);
  assert.equal(clean.byteExactAfterAlias, true);
  assert.equal(clean.byteExactAfterClass, true);

  const leaked = auditGraphStability({
    before: { mermaid: 'flowchart TD\nA[Source]', svg: '<svg>Source</svg>' },
    afterAlias: { mermaid: 'flowchart TD\nA[reviewed alias]', svg: '<svg>reviewed alias</svg>' },
    afterClass: { mermaid: 'flowchart TD\nA[Source]', svg: '<svg class="Panel">Source</svg>' },
    forbiddenPanelNames: ['reviewed alias']
  });
  assert.equal(leaked.ok, false);
  assert.equal(leaked.panelFree, false);
  const singleCharacterLeak = auditGraphStability({
    before: { mermaid: 'flowchart TD\nA[Q]', svg: '<svg><text>Q</text></svg>' },
    afterAlias: { mermaid: 'flowchart TD\nA[Q]', svg: '<svg><text>Q</text></svg>' },
    afterClass: { mermaid: 'flowchart TD\nA[Q]', svg: '<svg><text>Q</text></svg>' },
    forbiddenPanelNames: ['Q']
  });
  assert.equal(singleCharacterLeak.panelFree, false);
  const benignNodeId = auditGraphStability({
    before: { mermaid: 'flowchart TD\nA[Activation]', svg: '<svg><text>Activation</text></svg>' },
    afterAlias: { mermaid: 'flowchart TD\nA[Activation]', svg: '<svg><text>Activation</text></svg>' },
    afterClass: { mermaid: 'flowchart TD\nA[Activation]', svg: '<svg><text>Activation</text></svg>' },
    forbiddenPanelNames: ['A']
  });
  assert.equal(benignNodeId.panelFree, true);
});

test('public result redacts local paths, article text, credentials, prompts, and responses', async () => {
  const { publicPaperResult } = await verifier();
  const privatePath = path.win32.join(
    ...['X:', 'reader-profile', 'private-library', 'attachment.pdf']
  );
  const credentialSentinel = ['credential', 'sentinel'].join('-');
  const result = publicPaperResult({
    key: 'nat-neuro-2020-srpx2', title: 'SRPX2 title', doi: '10.1038/example',
    pmid: '12345678', sha256: 'a'.repeat(64), pageCount: 19,
    pdfPath: privatePath,
    archivePath: privatePath, fullText: 'private paper text',
    [['api', 'Key'].join('')]: credentialSentinel,
    prompt: 'raw prompt', response: 'raw model response',
    coverage: { ok: true, archivePath: privatePath },
    edits: { ok: true, fullText: 'nested private paper text' },
    exports: { ok: true, prompt: 'nested raw prompt' },
    screenshots: { ok: true, files: ['safe.png'], pdfPath: privatePath },
    nativeInspection: {
      ok: true, [['api', 'Key'].join('')]: credentialSentinel
    },
    diagnostics: { unhandledErrors: 0 }, pass: true
  });
  assert.deepEqual(Object.keys(result), [
    'key', 'title', 'doi', 'pmid', 'sha256', 'pageCount', 'coverage', 'edits',
    'exports', 'screenshots', 'nativeInspection', 'diagnostics', 'pass'
  ]);
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(
    serialized,
    /reader-profile|private-library|credential-sentinel|raw prompt|raw model/i
  );
});

test('native inspection is bound to the current screenshot hash and dimensions', async () => {
  const { auditNativeInspection } = await verifier();
  const evidence = [{
    filename: 'desktop-full-matrix-graph.png', sha256: 'a'.repeat(64),
    width: 700, height: 1000
  }];
  const valid = { screenshots: { 'desktop-full-matrix-graph.png': {
    status: 'PASS', nativeResolution: true, observation: 'No clipping.',
    sha256: 'a'.repeat(64), width: 700, height: 1000
  } } };
  assert.equal(auditNativeInspection(valid, evidence).ok, true);
  assert.equal(auditNativeInspection({ screenshots: {
    'desktop-full-matrix-graph.png': {
      ...valid.screenshots['desktop-full-matrix-graph.png'], sha256: 'b'.repeat(64)
    }
  } }, evidence).ok, false);
});

test('alias and class graph baseline is captured only after node and edge edits', () => {
  const source = fs.readFileSync(verifierPath, 'utf8');
  const feedback = source.indexOf('completed.create_feedback_cycle = true');
  const evidenceEdge = source.indexOf('completed.add_evidence_to_empty_cell = true');
  const baseline = source.indexOf('const graphOnlyBaseline = await graphBytes(page)');
  const alias = source.indexOf('completed.change_panel_alias = true');
  assert.ok(feedback >= 0 && evidenceEdge > feedback && baseline > evidenceEdge && alias > baseline);
  assert.match(source, /graph:\s*\{\s*baseline:\s*graphOnlyBaseline,/);
});

test('reload rebinds the real-paper tab and regeneration preserves the reviewed alias', () => {
  const source = fs.readFileSync(verifierPath, 'utf8');
  const reload = source.indexOf("await page.reload({ waitUntil: 'domcontentloaded' })");
  const rebind = source.indexOf(
    'await rebindPanelAfterReload(page, worker, articleTab, expectedIdentity)', reload
  );
  const reloadAlias = source.indexOf('reloaded.aliases.includes(longAlias)', rebind);
  const regenerate = source.indexOf('seedMechanismChainFromCrossFigure', reloadAlias);
  const regeneratedAlias = source.indexOf('regenerated.aliases.includes(longAlias)', regenerate);
  assert.ok(reload >= 0 && rebind > reload && reloadAlias > rebind);
  assert.ok(regenerate > reloadAlias && regeneratedAlias > regenerate);
});

test('regeneration preserves reviewed nodes and edges without freezing unreviewed model topology', () => {
  const source = fs.readFileSync(verifierPath, 'utf8');
  const chainState = source.indexOf('async function chainState');
  const nodeReview = source.indexOf('humanReviewed: node?.label?.humanReviewed === true', chainState);
  const emptyReviewedLabel = source.indexOf(
    "label: typeof node?.label === 'object' ? String(node.label?.value || '')", chainState
  );
  const edgeReview = source.indexOf('humanReviewed: edge?.humanReviewed === true', chainState);
  const scenario = source.indexOf('const missingReviewedNodes =', edgeReview);
  const reviewedNodeFilter = source.indexOf(".filter(expected => expected.humanReviewed)", scenario);
  const reviewedEdges = source.indexOf('const reviewedEdgesSurvive =', reviewedNodeFilter);
  const reviewedEdgeFilter = source.indexOf(".filter(expected => expected.humanReviewed)", reviewedEdges);
  assert.ok(emptyReviewedLabel > chainState && nodeReview > emptyReviewedLabel &&
    edgeReview > chainState && scenario > edgeReview &&
    reviewedNodeFilter > scenario && reviewedEdges > reviewedNodeFilter &&
    reviewedEdgeFilter > reviewedEdges);
});

test('verifier source covers every required edit, screenshot, Edge, and failure gate', () => {
  const source = fs.readFileSync(verifierPath, 'utf8');
  for (const token of [
    'rename_node', 'add_node', 'delete_node', 'create_branch',
    'create_feedback_cycle', 'add_evidence_to_empty_cell', 'change_panel_alias',
    'switch_evidence_classes', 'delete_evidence', 'reload', 'regenerate', 'export'
  ]) assert.match(source, new RegExp(`['"]${token}['"]`), token);
  for (const token of [
    'full-matrix-graph', 'sticky-headers-scrolled', 'empty-cell-editor',
    'populated-cell-editor', 'long-alias-ellipsis', 'bottom-legend',
    'cycle-feedback-graph', 'reloaded-state'
  ]) assert.match(source, new RegExp(token), token);
  assert.match(source, /channel:\s*['"]msedge['"]/);
  assert.match(source, /HEADLESS/);
  assert.match(source, /unhandledErrors/);
  assert.match(source, /nativeInspection/);
  assert.match(source, /process\.exitCode\s*=\s*1/);
});

test('runtime uses canonical live ledger, visible audit dispositions, and real UI downloads', () => {
  const source = fs.readFileSync(verifierPath, 'utf8');
  assert.doesNotMatch(source, /paper\.panelLedger\s*\|\|/);
  assert.match(source, /panelLedgerCore\.buildPanelLedger\(initial\.ledgerFigures\)/);
  assert.match(source, /visibleDispositionKeys:\s*initial\.visibleDispositionKeys/);
  assert.match(source, /waitForEvent\('download'/);
  assert.match(source, /\[data-mechanism-export="\$\{format\}"\]/);
  assert.doesNotMatch(source, /const exports = await page\.evaluate\(async \(\) => \{[\s\S]*mechanismSvgToPngBlob/);
});

test('runtime attaches diagnostics before popup initialization and emits safe failure codes', () => {
  const source = fs.readFileSync(verifierPath, 'utf8');
  const newPage = source.indexOf('const page = await context.newPage()',
    source.indexOf('async function openPanel'));
  const diagnostics = source.indexOf('diagnosticsFor(page)', newPage);
  const navigation = source.indexOf('await page.goto(', newPage);
  assert.ok(newPage >= 0 && diagnostics > newPage && diagnostics < navigation);
  assert.match(source, /diagnosticsForWorker/);
  assert.match(source, /safeRuntimeFailure/);
  assert.doesNotMatch(source, /error:\s*clean\(error\?\.message/);
  assert.match(source, /diagnosticsFor\(articlePage, \{ strictConsole: false \}\)/);
  assert.match(source, /publisherConsoleErrors/);
});

test('each paper reacquires an MV3 worker and normal idle close is not an error', () => {
  const source = fs.readFileSync(verifierPath, 'utf8');
  assert.match(source, /async function liveExtensionWorker\(context, extensionId\)/);
  assert.match(source, /for \(const paper of papers\)[\s\S]*liveExtensionWorker\(context, extensionId\)/);
  assert.doesNotMatch(source, /worker\.on\('close',[\s\S]*unhandledErrors\.push/);
});

test('live MV3 worker acquisition reuses a live generation and wakes a replacement', async () => {
  const { liveExtensionWorker } = await verifier();
  const first = { url: () => 'chrome-extension://build-id/background.js' };
  const second = { url: () => 'chrome-extension://build-id/background.js' };
  let workers = [first];
  let wakeCount = 0;
  const context = {
    serviceWorkers: () => workers,
    waitForEvent: async (_name, options) => {
      assert.equal(options.predicate(second), true);
      return second;
    },
    newPage: async () => ({
      goto: async () => { wakeCount += 1; workers = [second]; },
      close: async () => undefined
    })
  };
  assert.equal(await liveExtensionWorker(context, 'build-id'), first);
  assert.equal(wakeCount, 0);
  workers = [];
  assert.equal(await liveExtensionWorker(context, 'build-id'), second);
  assert.equal(wakeCount, 1);
});

test('regeneration rejects a revision-only no-op and mismatched generated structure', async () => {
  const { auditRegeneration } = await verifier();
  const before = {
    revision: 4, nodes: [{ id: 'a', label: 'A' }],
    edges: [{ id: 'e', from: 'a', to: 'b', polarity: 'positive' }]
  };
  const generated = {
    nodes: [{ id: 'a', label: 'A regenerated' }],
    edges: [{ id: 'e', from: 'a', to: 'b', polarity: 'positive' }]
  };
  assert.equal(auditRegeneration({
    success: true, before, generated, after: { ...before, revision: 5 }
  }).ok, false);
  assert.equal(auditRegeneration({
    success: true, before, generated,
    after: { ...generated, revision: 5 }
  }).ok, true);
  assert.equal(auditRegeneration({
    success: true, before, generated,
    after: { ...generated, revision: 5, nodes: [{ id: 'wrong', label: 'Wrong' }] }
  }).ok, false);
});

test('a failed run atomically replaces any stale PASS report', () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-verifier-contract-'));
  const reportPath = path.join(outputDir, 'qa-result.json');
  try {
    fs.writeFileSync(reportPath, JSON.stringify({ pass: true }), 'utf8');
    const run = spawnSync(process.execPath, [verifierPath, '--output', outputDir], {
      cwd: root, encoding: 'utf8',
      env: { ...process.env, MATRIX_QA_INPUT: '', MATRIX_NATIVE_INSPECTION: '' }
    });
    assert.equal(run.status, 1);
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    assert.equal(report.pass, false);
    assert.equal(report.status, 'FAILED');
    assert.match(report.runId, /^[a-f0-9-]{36}$/i);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test('the default report is invalidated before private input validation', () => {
  const source = fs.readFileSync(verifierPath, 'utf8');
  const main = source.indexOf('async function main()');
  const defaultOutput = source.indexOf("path.join(root, 'output', 'playwright'", main);
  const begin = source.indexOf('beginReport(outputDir)', defaultOutput);
  const inputValidation = source.indexOf("if (!inputValue)", main);
  assert.ok(defaultOutput > main && begin > defaultOutput && begin < inputValidation);
});

test('the verifier requires an explicit extension and reports a safe build binding', () => {
  const source = fs.readFileSync(verifierPath, 'utf8');
  assert.doesNotMatch(source, /readdirSync\(dist/);
  assert.match(source, /PENDING_EXTERNAL_INPUT: set --extension or EXTENSION_PATH/);
  assert.match(source, /extensionBuild:\s*extensionBuild/);
  assert.match(source, /manifestSha256/);
  assert.match(source, /buildSha256/);
});

test('UI edit completion flags follow observable business-state assertions', () => {
  const source = fs.readFileSync(verifierPath, 'utf8');
  for (const token of [
    'aliasVisibleInTable', 'classVisibleInTable', 'evidenceCountAfterAdd',
    'evidenceCountAfterDelete', 'feedbackEdgeVisible', 'branchNodeVisible'
  ]) assert.match(source, new RegExp(token), token);
});

test('committed QA matrix records the final bounded real-paper PASS evidence', () => {
  const markdown = fs.readFileSync(matrixPath, 'utf8');
  for (const key of [
    'neuron-2026-dopamine-circuits',
    'neuron-2020-hippocampal-ripples',
    'nat-neuro-2020-srpx2'
  ]) assert.match(markdown, new RegExp(key));
  assert.match(markdown, /^Status: `PASS`$/m);
  assert.match(markdown, /native-resolution/i);
  assert.match(markdown, /Native inspection result: 27\/27 reviewed, 0 missing, 0 mismatched, `PASS`\./);
  const screenshotRows = markdown.match(/^\| (?:neuron-2026-dopamine-circuits|neuron-2020-hippocampal-ripples|nat-neuro-2020-srpx2) \| `[^`]+\.png` \| `[0-9a-f]{64}` \| \d+×\d+ \| .+ \| `PASS` \|$/gm) || [];
  assert.equal(screenshotRows.length, 27);
  assert.doesNotMatch(markdown, /PENDING_EXTERNAL_INPUT/);
  assert.doesNotMatch(markdown, /[A-Z]:\\|Zotero[\\/]|sk-[A-Za-z0-9]/i);
});

test('verifier fails honestly when the private real-paper input is unavailable', () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-verifier-missing-'));
  try {
    const run = spawnSync(process.execPath, [verifierPath, '--output', outputDir], {
      cwd: root, encoding: 'utf8',
      env: { ...process.env, MATRIX_QA_INPUT: '', MATRIX_NATIVE_INSPECTION: '' }
    });
    assert.equal(run.status, 1);
    assert.match(`${run.stdout}\n${run.stderr}`, /PENDING_EXTERNAL_INPUT/);
    assert.doesNotMatch(`${run.stdout}\n${run.stderr}`, /EISDIR/);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});
