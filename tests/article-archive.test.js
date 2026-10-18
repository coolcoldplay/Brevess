const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const crypto = require('node:crypto');

require('../core/cache-planner.js');
require('../core/article-workspace.js');
const ArticleChatWebSources = require('../core/article-chat-web-sources.js');
const {
  createFigureWorkspaceDraft,
  applyFigureWorkspaceMutation,
  publicFigureWorkspaceDraft,
  initializeFigureWorkspaceDraftState
} = require('../core/figure-workspace.js');
const {
  ARTICLE_ARCHIVE_KIND,
  articleArchiveRelativePath,
  createArticleArchive,
  validateArticleArchive,
  markArticleArchiveAsExternalImport,
  convertLegacyArticleArchiveToWorkspace
} = require('../core/article-archive.js');

function reviewedFigureDraft() {
  let draft = createFigureWorkspaceDraft([{
    figureId: 'figure-2', figureLabel: 'Figure 2', panelHints: ['A']
  }]);
  draft = applyFigureWorkspaceMutation(draft, {
    type: 'set_panel_field', expectedRevision: draft.revision,
    figureId: 'figure-2', panelId: 'A', field: 'note', value: 'archive note'
  }, 100);
  draft = applyFigureWorkspaceMutation(draft, {
    type: 'set_figure_field', expectedRevision: draft.revision,
    figureId: 'figure-2', field: 'claimBoundary', value: ''
  }, 101);
  return publicFigureWorkspaceDraft(draft);
}

function reviewedMechanismArchiveDraft() {
  let draft = reviewedFigureDraft();
  const apply = (mutation, now) => {
    draft = applyFigureWorkspaceMutation(draft, {
      ...mutation, expectedRevision: draft.revision
    }, now);
  };
  apply({
    type: 'replace_mechanism_chain', chain: {
      nodes: [
        { id: 'source', label: 'Source' },
        { id: 'result', label: 'Result' },
        { id: 'deleted', label: 'Delete me' }
      ],
      edges: [
        {
          id: 'source-result', from: 'source', to: 'result', label: 'supports',
          polarity: 'neutral', panelEvidence: [{
            figureId: 'figure-2', panelId: 'A', evidenceClass: 'other',
            evidenceClassSource: 'inferred'
          }]
        },
        {
          id: 'feedback', from: 'result', to: 'source', label: 'feedback',
          polarity: 'negative', panelEvidence: [{
            figureId: 'figure-2', panelId: 'A', evidenceClass: 'other',
            evidenceClassSource: 'inferred'
          }]
        },
        {
          id: 'deleted-edge', from: 'source', to: 'deleted', label: '',
          polarity: 'neutral', panelEvidence: []
        }
      ]
    }
  }, 200);
  apply({
    type: 'update_mechanism_node', nodeId: 'source', field: 'label', value: 'Reader source'
  }, 201);
  apply({
    type: 'update_mechanism_edge_evidence', edgeId: 'source-result', index: 0,
    expectedFigureId: 'figure-2', expectedPanelId: 'A',
    evidence: {
      figureId: 'figure-2', panelId: 'A', evidenceClass: 'necessity',
      evidenceClassSource: 'manual'
    }
  }, 202);
  apply({
    type: 'set_mechanism_panel_alias', figureId: 'figure-2', panelId: 'A', value: 'rescue'
  }, 203);
  apply({
    type: 'remove_mechanism_edge_evidence', edgeId: 'feedback', index: 0,
    expectedFigureId: 'figure-2', expectedPanelId: 'A'
  }, 204);
  apply({ type: 'remove_mechanism_node', nodeId: 'deleted' }, 205);
  return publicFigureWorkspaceDraft(draft);
}

function authoritativeFigureBinding() {
  return {
    documentId: `sha256:${'a'.repeat(64)}`,
    documentHash: 'doc-hash-1',
    canonicalUrl: 'https://example.org/article/1',
    workspaceId: `sha256:${'c'.repeat(64)}`,
    workspaceGeneration: 3
  };
}

function sampleArchiveInput() {
  const documentId = `sha256:${'a'.repeat(64)}`;
  return {
    revision: 7,
    extensionVersion: '2.1.0',
    identity: {
      documentId,
      documentHash: 'doc-hash-1',
      canonicalUrl: 'https://example.org/article/1?utm_source=test#results',
      title: 'Mechanism review',
      publisher: 'elsevier'
    },
    documentRecord: {
      schemaVersion: 1,
      documentId,
      documentHash: 'doc-hash-1',
      title: 'Mechanism review',
      canonicalUrl: 'https://example.org/article/1',
      studyType: 'narrative_review',
      revision: 4,
      updatedAt: '2026-07-17T08:00:00.000Z',
      annotations: [{
        annotationId: 'manual-1', categoryId: 'limitation',
        quote: 'sample size was small', note: 'Verify cohort size'
      }]
    },
    workspace: {
      lastRegexRequest: { mode: 'sentence', categories: [{ categoryId: 'limitation' }] },
      llm: {
        rawAnalysis: { annotations: [{ categoryId: 'key_result', quote: 'survival improved' }] },
        paragraphs: [{ paragraphId: 'p1', text: 'Survival improved in the treatment group.' }],
        confidenceThreshold: 0.8
      },
      reviewOutline: { sections: [{ title: 'Mechanisms', summary: 'A mechanism summary.' }] },
      figures: [{ figureId: 'fig-1', label: 'Figure 1', result: { summary: 'Pathway model.' } }],
      ledger: [{ categoryId: 'key_result', quote: 'survival improved' }],
      apiKey: 'sk-must-not-leak',
      headers: { Authorization: 'Bearer must-not-leak' },
      preview: 'data:image/png;base64,AAAA',
      pageHtml: '<html>whole page must not be archived</html>'
    }
  };
}

test('uses one deterministic bounded file path per document identity', () => {
  const first = articleArchiveRelativePath(`sha256:${'a'.repeat(64)}`);
  const second = articleArchiveRelativePath(`sha256:${'a'.repeat(64)}`);
  const other = articleArchiveRelativePath(`sha256:${'b'.repeat(64)}`);

  assert.equal(first, second);
  assert.notEqual(first, other);
  assert.match(first, /^articles\/[a-f0-9]{8}\.json$/);
  assert.ok(first.length < 80);
  assert.throws(() => articleArchiveRelativePath('../escape'), /INVALID_DOCUMENT_ID/);
});

test('creates a complete portable article archive while stripping secrets and page payloads', () => {
  const archive = createArticleArchive(sampleArchiveInput());

  assert.equal(archive.kind, ARTICLE_ARCHIVE_KIND);
  assert.equal(archive.schemaVersion, 1);
  assert.equal(archive.revision, 7);
  assert.equal(archive.documentRecord.annotations[0].note, 'Verify cohort size');
  assert.equal(archive.workspace.llm.rawAnalysis.annotations[0].categoryId, 'key_result');
  assert.equal(archive.workspace.reviewOutline.sections[0].title, 'Mechanisms');
  assert.equal(archive.workspace.figures[0].result.summary, 'Pathway model.');

  const serialized = JSON.stringify(archive);
  assert.doesNotMatch(serialized, /sk-must-not-leak|Bearer must-not-leak|data:image|whole page/);
  assert.doesNotMatch(serialized, /apiKey|Authorization|pageHtml|headers/);
  assert.deepEqual(validateArticleArchive(JSON.parse(serialized)), archive);
});

test('Figure draft archive round trip keeps the canonical public draft deeply equal', () => {
  const input = sampleArchiveInput();
  let draft = reviewedFigureDraft();
  draft = applyFigureWorkspaceMutation(draft, {
    type: 'set_mechanism_panel_alias', expectedRevision: draft.revision,
    figureId: 'figure-2', panelId: 'A', value: 'rescue'
  }, 102);
  draft.harmlessUnexpected = 'must be normalized away';
  input.workspace.figureWorkspaceDraft = draft;

  const archive = createArticleArchive(input);
  const restored = validateArticleArchive(JSON.parse(JSON.stringify(archive)));
  delete draft.harmlessUnexpected;
  assert.deepEqual(restored.workspace.figureWorkspaceDraft,
    JSON.parse(JSON.stringify(draft)));
  assert.equal(restored.workspace.figureWorkspaceDraft.figures['figure-2']
    .panels.A.note.humanReviewed, true);
  assert.deepEqual(restored.workspace.figureWorkspaceDraft.mechanismChain
    .panelAliases['figure-2:A'], {
      value: 'rescue', humanReviewed: true, editedAt: 102
    });
});

test('Figure draft archive round trip preserves reviewed matrix edits deletions and feedback', () => {
  const input = sampleArchiveInput();
  const edited = reviewedMechanismArchiveDraft();
  input.workspace.figureWorkspaceDraft = edited;

  const restored = validateArticleArchive(JSON.parse(JSON.stringify(
    createArticleArchive(input)
  ))).workspace.figureWorkspaceDraft;

  assert.deepEqual(restored, JSON.parse(JSON.stringify(edited)));
  assert.equal(restored.mechanismChain.nodes.find(node => node.id === 'source').label.value,
    'Reader source');
  assert.equal(restored.mechanismChain.nodes.some(node => node.id === 'deleted'), false);
  assert.equal(restored.mechanismChain.edges.some(edge => edge.id === 'deleted-edge'), false);
  assert.equal(restored.mechanismChain.edges.find(edge => edge.id === 'feedback')
    .panelEvidence.length, 0);
  assert.equal(restored.mechanismChain.edges.find(edge => edge.id === 'source-result')
    .panelEvidence[0].evidenceClassSource, 'manual');
  assert.deepEqual(restored.mechanismChain.panelAliases['figure-2:A'], {
    value: 'rescue', humanReviewed: true, editedAt: 203
  });
  assert.equal(restored.mechanismChain.reviewTombstones.nodes
    .some(item => item.id === 'deleted' && item.editedAt === 205), true);
  assert.equal(restored.mechanismChain.reviewTombstones.edges
    .some(item => item.id === 'deleted-edge' && item.editedAt === 205), true);
  assert.equal(restored.mechanismChain.reviewTombstones.evidence
    .some(item => item.edgeId === 'feedback' && item.panelId === 'A' &&
      item.editedAt === 204), true);
});

test('bound live Figure draft exports without its runtime binding and restores under current authority', () => {
  const binding = authoritativeFigureBinding();
  const boundDraft = publicFigureWorkspaceDraft({
    ...reviewedMechanismArchiveDraft(), binding
  });
  const expectedPortableDraft = JSON.parse(JSON.stringify(boundDraft));
  delete expectedPortableDraft.binding;
  const input = sampleArchiveInput();
  input.workspace.figureWorkspaceDraft = boundDraft;

  const archive = createArticleArchive(input);
  const portableDraft = archive.workspace.figureWorkspaceDraft;

  assert.equal(Object.hasOwn(portableDraft, 'binding'), false);
  assert.doesNotMatch(JSON.stringify(portableDraft),
    /(?:^|[^\p{L}\p{N}_])(?:data|blob|javascript|https?|file):(?=\S)/iu);
  assert.deepEqual(portableDraft, expectedPortableDraft,
    'all schema-v7 Figure, mechanism, evidence, and review edits must remain lossless');

  const restored = initializeFigureWorkspaceDraftState({
    durableAsset: {
      content: JSON.parse(JSON.stringify(portableDraft)),
      revision: 19,
      contentHash: 'portable-archive-hash'
    },
    binding,
    inventory: []
  });
  assert.deepEqual(restored.draft.binding, binding);
  assert.deepEqual(
    JSON.parse(JSON.stringify(restored.draft)),
    JSON.parse(JSON.stringify(boundDraft))
  );
});

test('raw archive validation still rejects bindings and every other Figure draft URL', () => {
  const input = sampleArchiveInput();
  input.workspace.figureWorkspaceDraft = reviewedMechanismArchiveDraft();
  const validArchive = createArticleArchive(input);

  const boundImport = JSON.parse(JSON.stringify(validArchive));
  boundImport.workspace.figureWorkspaceDraft.binding = authoritativeFigureBinding();
  assert.throws(() => validateArticleArchive(boundImport),
    error => error.code === 'INVALID_FIGURE_WORKSPACE_DRAFT');

  const nonUrlBoundImport = JSON.parse(JSON.stringify(validArchive));
  nonUrlBoundImport.workspace.figureWorkspaceDraft.binding = {
    ...authoritativeFigureBinding(),
    canonicalUrl: 'paper'
  };
  assert.throws(() => validateArticleArchive(nonUrlBoundImport),
    error => error.code === 'INVALID_FIGURE_WORKSPACE_DRAFT');

  const otherUrlImport = JSON.parse(JSON.stringify(validArchive));
  otherUrlImport.workspace.figureWorkspaceDraft.figures['figure-2']
    .panels.A.note.value = 'https://example.org/raw-figure-source';
  assert.throws(() => validateArticleArchive(otherUrlImport),
    error => error.code === 'INVALID_FIGURE_WORKSPACE_DRAFT');

  let bindingGetterCalls = 0;
  const accessorDraft = reviewedMechanismArchiveDraft();
  Object.defineProperty(accessorDraft, 'binding', {
    enumerable: true,
    get() {
      bindingGetterCalls += 1;
      return authoritativeFigureBinding();
    }
  });
  const accessorInput = sampleArchiveInput();
  accessorInput.workspace.figureWorkspaceDraft = accessorDraft;
  assert.throws(() => createArticleArchive(accessorInput),
    error => error.code === 'INVALID_FIGURE_WORKSPACE_DRAFT');
  assert.equal(bindingGetterCalls, 0);
});

test('raw archive validation rejects non-enumerable Figure fields before normalization', () => {
  const input = sampleArchiveInput();
  input.workspace.figureWorkspaceDraft = reviewedMechanismArchiveDraft();
  const validArchive = createArticleArchive(input);

  const hiddenBinding = JSON.parse(JSON.stringify(validArchive));
  Object.defineProperty(hiddenBinding.workspace.figureWorkspaceDraft, 'binding', {
    value: authoritativeFigureBinding(), enumerable: false
  });
  assert.throws(() => validateArticleArchive(hiddenBinding),
    error => error.code === 'INVALID_FIGURE_WORKSPACE_DRAFT');

  const hiddenUrl = JSON.parse(JSON.stringify(validArchive));
  Object.defineProperty(hiddenUrl.workspace.figureWorkspaceDraft.figures['figure-2']
    .panels.A.note, 'value', {
    value: 'https://example.org/non-enumerable-source', enumerable: false
  });
  assert.throws(() => validateArticleArchive(hiddenUrl),
    error => error.code === 'INVALID_FIGURE_WORKSPACE_DRAFT');
});

test('raw archive validation never re-reads a Proxy that hides binding from ownKeys', () => {
  const input = sampleArchiveInput();
  input.workspace.figureWorkspaceDraft = reviewedMechanismArchiveDraft();
  const rawArchive = JSON.parse(JSON.stringify(createArticleArchive(input)));
  const draft = rawArchive.workspace.figureWorkspaceDraft;
  draft.binding = authoritativeFigureBinding();
  rawArchive.workspace.figureWorkspaceDraft = new Proxy(draft, {
    ownKeys(target) {
      return Reflect.ownKeys(target).filter(key => key !== 'binding');
    }
  });

  assert.throws(() => validateArticleArchive(rawArchive),
    error => error.code === 'INVALID_FIGURE_WORKSPACE_DRAFT');
});

test('create path strips only an exact normalized schema-v7 runtime binding', () => {
  const binding = authoritativeFigureBinding();
  let nestedGetterCalls = 0;
  const accessorBinding = { ...binding };
  Object.defineProperty(accessorBinding, 'canonicalUrl', {
    enumerable: true,
    get() {
      nestedGetterCalls += 1;
      return binding.canonicalUrl;
    }
  });
  const revoked = Proxy.revocable({ ...binding }, {});
  revoked.revoke();
  const attempts = [
    { ...reviewedMechanismArchiveDraft(), binding: 123 },
    { ...reviewedMechanismArchiveDraft(), binding: null },
    {
      ...reviewedMechanismArchiveDraft(),
      binding: { ...binding, workspaceId: '' }
    },
    {
      ...reviewedMechanismArchiveDraft(),
      binding: { ...binding, sourceUrl: 'https://example.org/untrusted-extra' }
    },
    {
      ...reviewedMechanismArchiveDraft(), schemaVersion: 6, binding
    },
    {
      ...reviewedMechanismArchiveDraft(),
      binding: { ...binding, documentId: `sha256:${'d'.repeat(64)}` }
    },
    { ...reviewedMechanismArchiveDraft(), binding: accessorBinding },
    { ...reviewedMechanismArchiveDraft(), binding: revoked.proxy }
  ];

  for (const draft of attempts) {
    const input = sampleArchiveInput();
    input.workspace.figureWorkspaceDraft = draft;
    assert.throws(() => createArticleArchive(input),
      error => error.code === 'INVALID_FIGURE_WORKSPACE_DRAFT');
  }
  assert.equal(nestedGetterCalls, 0);
});

test('Figure draft archive accepts v1 through v6 and canonicalizes them to v7', () => {
  for (const schemaVersion of [1, 2, 3, 4, 5, 6]) {
    const input = sampleArchiveInput();
    input.workspace.figureWorkspaceDraft = {
      ...JSON.parse(JSON.stringify(reviewedFigureDraft())), schemaVersion
    };
    const archive = createArticleArchive(input);
    assert.equal(archive.workspace.figureWorkspaceDraft.schemaVersion, 7);
    assert.deepEqual(
      archive.workspace.figureWorkspaceDraft.mechanismChain.panelAliases,
      {}
    );
    assert.deepEqual(
      archive.workspace.figureWorkspaceDraft.mechanismChain.reviewTombstones,
      { nodes: [], edges: [], evidence: [] }
    );
  }
});

test('Figure draft archive rejects credentials dangerous URIs prototypes and accessors with one fixed error', () => {
  const attempts = [];
  const addAttempt = draft => {
    const input = sampleArchiveInput();
    input.workspace.figureWorkspaceDraft = draft;
    attempts.push(input);
  };
  addAttempt({ ...reviewedFigureDraft(), providerConfig: { apiKey: 'secret' } });
  addAttempt({ ...reviewedFigureDraft(), preview: 'data:image/png;base64,AAAA' });
  addAttempt({ ...reviewedFigureDraft(), sourceUrl: 'https://example.org/raw.png' });
  addAttempt(Object.assign(Object.create({ inherited: true }), reviewedFigureDraft()));
  let getterCalls = 0;
  const accessorDraft = reviewedFigureDraft();
  Object.defineProperty(accessorDraft, 'toJSON', {
    enumerable: true,
    get() { getterCalls += 1; throw new Error('must not call getter'); }
  });
  addAttempt(accessorDraft);

  attempts.forEach(input => assert.throws(
    () => createArticleArchive(input),
    error => error.code === 'INVALID_FIGURE_WORKSPACE_DRAFT'
  ));
  assert.equal(getterCalls, 0);
});

test('Figure draft archive accepts scientific metadata and cdata prose but rejects real URI schemes', () => {
  const accepted = reviewedFigureDraft();
  accepted.figures['figure-2'].panels.A.note.value =
    'metadata: cohort annotations; cdata: normalized fluorescence values';
  const acceptedInput = sampleArchiveInput();
  acceptedInput.workspace.figureWorkspaceDraft = accepted;
  const archive = createArticleArchive(acceptedInput);
  assert.match(archive.workspace.figureWorkspaceDraft.figures['figure-2']
    .panels.A.note.value, /metadata: cohort annotations/);
  assert.match(archive.workspace.figureWorkspaceDraft.figures['figure-2']
    .panels.A.note.value, /cdata: normalized fluorescence/);

  for (const unsafe of [
    'data:image/png;base64,AAAA', 'data:text/html,<script>alert(1)</script>',
    'blob:https://example.org/id', 'javascript:alert(1)', 'https://example.org/raw'
  ]) {
    const draft = reviewedFigureDraft();
    draft.figures['figure-2'].panels.A.note.value = unsafe;
    const input = sampleArchiveInput();
    input.workspace.figureWorkspaceDraft = draft;
    assert.throws(() => createArticleArchive(input),
      error => error.code === 'INVALID_FIGURE_WORKSPACE_DRAFT');
  }
});

test('article archives remove the complete credential and provider key family', () => {
  const input = sampleArchiveInput();
  input.workspace.scientificNote =
    'A basic science control remains. Authorization: Basic dXNlcjpwYXNz; ' +
    'Authorization: Token top-secret; Authorization: Digest response=secret';
  input.workspace.privacyAudit = {
    apiKey: 'secret-api-key',
    customHeaders: { Authorization: 'secret-authorization' },
    token: 'secret-generic-token',
    providerToken: 'secret-provider-token',
    providerId: 'secret-provider-id',
    provider: 'secret-provider',
    password: 'secret-password',
    bearer: 'secret-bearer',
    authToken: 'secret-auth-token',
    accessToken: 'secret-access-token',
    refreshToken: 'secret-refresh-token',
    credential: 'secret-credential',
    secret: 'secret-secret',
    apiToken: 'secret-api-token',
    githubToken: 'secret-github-token',
    privateToken: 'secret-private-token',
    personalAccessToken: 'secret-personal-access-token',
    webhookSecret: 'secret-webhook-secret',
    privateSecret: 'secret-private-secret',
    clientSecret: 'secret-client-secret',
    privateKey: 'secret-private-key',
    activeProvider: 'secret-active-provider',
    authorizationHeader: 'secret-authorization-header',
    authHeader: 'secret-auth-header',
    bearerToken: 'secret-bearer-token',
    databasePassword: 'secret-database-password',
    experimentalProtocol: 'retain protocol',
    secretoryPathway: 'retain secretory biology',
    secretome: 'retain secretome biology',
    tokenizationMethod: 'retain scientific tokenization',
    tokenUsage: { input: 12, output: 4 },
    tokenCount: 16,
    inputTokenCount: 12,
    headerTitle: 'retain section header',
    proteinAccess: 'retain assay access'
  };

  const archive = createArticleArchive(input);
  const audit = archive.workspace.privacyAudit;
  const serialized = JSON.stringify(archive);
  assert.match(archive.workspace.scientificNote, /basic science control remains/);
  assert.doesNotMatch(serialized,
    /dXNlcjpwYXNz|top-secret|response=secret|Authorization/);
  assert.doesNotMatch(
    serialized,
    /secret-api-key|secret-authorization|secret-generic-token|secret-provider-token|secret-provider-id|secret-provider|secret-password|secret-bearer|secret-auth-token|secret-access-token|secret-refresh-token|secret-credential|secret-secret|secret-api-token|secret-github-token|secret-private-token|secret-personal-access-token|secret-webhook-secret|secret-private-secret|secret-client-secret|secret-private-key|secret-active-provider|secret-authorization-header|secret-auth-header|secret-bearer-token|secret-database-password/u
  );
  assert.deepEqual(audit, {
    experimentalProtocol: 'retain protocol',
    secretoryPathway: 'retain secretory biology',
    secretome: 'retain secretome biology',
    tokenizationMethod: 'retain scientific tokenization',
    tokenUsage: { input: 12, output: 4 },
    tokenCount: 16,
    inputTokenCount: 12,
    headerTitle: 'retain section header',
    proteinAccess: 'retain assay access'
  });
});

test('article archives preserve only a canonical answer-bound web grounding receipt', () => {
  const input = sampleArchiveInput();
  const url = 'https://www.nih.gov/news-events/research-matters/example';
  const sourceId = `web-source-${crypto.createHash('sha256')
    .update(url).digest('hex').slice(0, 16)}`;
  const binding = {
    providerId: 'deepseek', model: 'deepseek-v4-flash-vision-exp',
    turnId: 'turn-portable-web', operationId: 'operation-portable-web',
    question: '最新进展是什么?', answer: '这是联网回答。',
    answerBlocks: [{ blockId: 'block-portable-web', markdown: '这是联网回答。' }]
  };
  const receipt = ArticleChatWebSources.createArticleChatWebGroundingReceipt({
    ...binding,
    grounding: {
      schemaVersion: 1,
      providerId: binding.providerId,
      model: binding.model,
      providerResponseId: 'response-portable-web',
      searched: true,
      sources: [{
        sourceId, url, title: 'NIH source', hostname: 'www.nih.gov',
        blockIds: ['block-portable-web']
      }]
    }
  });
  input.workspace.chat = {
    turns: [{
      turnId: binding.turnId,
      question: binding.question,
      intent: 'answer',
      answerBlocks: binding.answerBlocks,
      summary: '联网摘要',
      status: 'completed',
      route: { providerId: binding.providerId, model: binding.model },
      webSearch: {
        enabled: true, searched: true,
        completedOperationId: binding.operationId
      },
      webGrounding: receipt,
      createdAt: 1,
      updatedAt: 2
    }]
  };

  const archive = createArticleArchive(input);
  const portable = archive.workspace.chat.turns[0];
  assert.equal(portable.route.providerId, binding.providerId);
  assert.equal(portable.webSearch.searched, true);
  assert.equal(portable.webGrounding.receiptId, receipt.receiptId);
  assert.equal(portable.webGrounding.grounding.providerId, binding.providerId);
  assert.equal(portable.webGrounding.grounding.providerResponseId,
    'response-portable-web');
  assert.equal(portable.webGrounding.grounding.sources[0].url, url);
  assert.deepEqual(validateArticleArchive(archive).workspace.chat.turns[0], portable);

  const tampered = structuredClone(input);
  tampered.workspace.chat.turns[0].answerBlocks[0].markdown = '篡改后的回答。';
  const rejected = createArticleArchive(tampered).workspace.chat.turns[0];
  assert.equal(rejected.webGrounding, null);
  assert.equal(rejected.webSearch.searched, false);
  assert.equal('providerId' in rejected.route, false);
});

test('live unverified answers retain provenance through export and reload and become external on import', () => {
  const input = sampleArchiveInput();
  const provenance = { origin: 'provider_unverified', verification: 'unverified' };
  input.workspace.chat = { turns: [{
    turnId: 'live-unverified', question: '联网问题', intent: 'answer', status: 'completed',
    answerBlocks: [{ blockId: 'live-b1', markdown: '完整回答但来源未验证。' }],
    answerProvenance: provenance,
    webSearch: { enabled: true, searched: false, completedOperationId: '' },
    webGrounding: null
  }] };
  const portable = createArticleArchive(input);
  const restored = validateArticleArchive(JSON.parse(JSON.stringify(portable)));
  const turn = restored.workspace.chat.turns[0];
  assert.deepEqual(turn.answerProvenance, provenance);
  assert.equal(turn.answerBlocks[0].markdown, '完整回答但来源未验证。');
  assert.equal(turn.webGrounding, null);
  assert.equal(turn.webSearch.searched, false);
  assert.deepEqual(markArticleArchiveAsExternalImport(restored).workspace.chat.turns[0].answerProvenance,
    { origin: 'external_import', verification: 'unverified' });
});

test('external archive imports keep readable answers with persistent unverified provenance', () => {
  const input = sampleArchiveInput();
  const url = 'https://pubmed.ncbi.nlm.nih.gov/12345678/';
  const answerBlocks = [{
    blockId: 'block-external-web', markdown: 'Imported evidence remains readable.'
  }];
  const binding = {
    providerId: 'deepseek', model: 'deepseek-chat',
    turnId: 'turn-external-web', operationId: 'operation-external-web',
    question: 'What was imported?', answer: answerBlocks[0].markdown,
    answerBlocks
  };
  const receipt = ArticleChatWebSources.createArticleChatWebGroundingReceipt({
    ...binding,
    grounding: {
      schemaVersion: 1,
      providerId: binding.providerId,
      model: binding.model,
      providerResponseId: 'response-external-web',
      searched: true,
      sources: [{
        sourceId: `web-source-${crypto.createHash('sha256')
          .update(url).digest('hex').slice(0, 16)}`,
        url, title: 'PubMed source', hostname: 'pubmed.ncbi.nlm.nih.gov',
        blockIds: ['block-external-web']
      }]
    }
  });
  input.workspace.chat = { turns: [{
    turnId: binding.turnId,
    question: binding.question,
    intent: 'answer',
    answerBlocks,
    summary: 'Imported summary',
    status: 'completed',
    route: { providerId: binding.providerId, model: binding.model },
    webSearch: {
      enabled: true, searched: true,
      completedOperationId: binding.operationId
    },
    webGrounding: receipt,
    createdAt: 1,
    updatedAt: 2
  }, {
    turnId: 'turn-external-no-receipt',
    question: 'What if the receipt is missing?',
    intent: 'answer',
    answerBlocks: [{
      blockId: 'block-external-no-receipt',
      markdown: 'Readable imported answer without a receipt.'
    }],
    summary: 'Readable imported summary',
    status: 'completed',
    webSearch: { enabled: true, searched: true, completedOperationId: 'missing' },
    webGrounding: null,
    createdAt: 3,
    updatedAt: 4
  }] };

  const marked = markArticleArchiveAsExternalImport(createArticleArchive(input));
  for (const turn of marked.workspace.chat.turns) {
    assert.deepEqual(turn.answerProvenance, {
      origin: 'external_import', verification: 'unverified'
    });
    assert.equal(turn.answerBlocks.length, 1);
  }
  assert.equal(marked.workspace.chat.turns[0].webGrounding, null);
  assert.equal(marked.workspace.chat.turns[1].webGrounding, null);
  assert.equal(marked.workspace.chat.turns[1].webSearch.searched, false);

  const reloaded = validateArticleArchive(JSON.parse(JSON.stringify(marked)));
  assert.deepEqual(reloaded.workspace.chat.turns[1].answerProvenance, {
    origin: 'external_import', verification: 'unverified'
  });
  assert.equal(reloaded.workspace.chat.turns[1].answerBlocks[0].markdown,
    'Readable imported answer without a receipt.');

  const reexported = createArticleArchive({
    identity: reloaded,
    revision: reloaded.revision + 1,
    savedAt: '2026-09-05T01:00:00.000Z',
    documentRecord: reloaded.documentRecord,
    workspace: reloaded.workspace
  });
  assert.deepEqual(reexported.workspace.chat.turns[0].answerProvenance, {
    origin: 'external_import', verification: 'unverified'
  });

  const unsafe = createArticleArchive(input);
  unsafe.workspace.chat.turns[0].webGrounding.grounding.sources[0].url =
    'javascript:alert(1)';
  const sanitized = markArticleArchiveAsExternalImport(unsafe);
  assert.equal(sanitized.workspace.chat.turns[0].answerBlocks[0].markdown,
    'Imported evidence remains readable.');
  assert.equal(sanitized.workspace.chat.turns[0].webGrounding, null);
  assert.doesNotMatch(JSON.stringify(sanitized), /javascript:/i);
});

test('article archives fail closed for extension Authorization schemes without erasing science prose', () => {
  const credentials = [
    'Authorization: OAuth oauth-secret',
    'Authorization: DPoP eyJhbGciOiJFUzI1NiJ9.payload.signature',
    'Authorization = Hawk id="user", mac="hawk-secret"',
    'AUTHORIZATION: SCRAM data=c2NyYW0tc2VjcmV0',
    'AuThOrIzAtIoN: Foo extension-secret',
    'Authorization: "Foo quoted-secret"',
    '"Authorization": "Vendor.Auth quoted-key-secret"',
    '"Authorization": "AWS4-HMAC-SHA256 Credential=AKIA_TEST/20260812/cn/test/aws4_request; SignedHeaders=host;x-amz-date; Signature=aws-secret"',
    '\u2018AuThOrIzAtIoN\u2019 = Hawk id=unicode-key-secret',
    'Authorization: ‘Foo unicode-secret’',
    'Ａｕｔｈｏｒｉｚａｔｉｏｎ： fOo unicode-header-secret',
    'Authorization: "Foo unterminated-secret'
  ];
  credentials.forEach((scientificNote, index) => {
    const input = sampleArchiveInput();
    input.workspace.scientificNote = scientificNote;
    assert.equal(createArticleArchive(input).workspace.scientificNote, '',
      `archive credential variant ${index} must be removed atomically`);
  });

  const prose = 'authorization: basic science describes an authorization process ' +
    'in receptor trafficking.';
  const safe = sampleArchiveInput();
  safe.workspace.scientificNote = prose;
  assert.equal(createArticleArchive(safe).workspace.scientificNote, prose);

  const tailed = sampleArchiveInput();
  tailed.workspace.scientificNote =
    '"Authorization": "AWS4-HMAC-SHA256 Credential=AKIA/20260812/cn/test/aws4_request; ' +
    'SignedHeaders=host;x-amz-date; Signature=aws-secret". ' +
    'Independent scientific conclusion.';
  assert.equal(createArticleArchive(tailed).workspace.scientificNote,
    'Independent scientific conclusion.');
});

test('rejects mismatched identities, unsupported schemas, and oversized archives', () => {
  const mismatched = sampleArchiveInput();
  mismatched.documentRecord.documentId = `sha256:${'b'.repeat(64)}`;
  assert.throws(() => createArticleArchive(mismatched), /ARCHIVE_IDENTITY_MISMATCH/);

  const valid = createArticleArchive(sampleArchiveInput());
  assert.throws(
    () => validateArticleArchive({ ...valid, schemaVersion: 99 }),
    /INVALID_ARCHIVE_SCHEMA/
  );
  assert.throws(
    () => createArticleArchive({
      ...sampleArchiveInput(),
      workspace: { huge: 'x'.repeat(16 * 1024 * 1024) }
    }),
    /ARTICLE_ARCHIVE_TOO_LARGE/
  );
});

test('converts a legacy monolithic archive into workspace assets without changing its old path', async () => {
  const archive = createArticleArchive(sampleArchiveInput());
  const legacyPath = articleArchiveRelativePath(archive);
  const converted = await convertLegacyArticleArchiveToWorkspace(archive);

  assert.match(converted.workspace.workspaceId, /^workspace:[a-f0-9]{64}$/);
  assert.equal(converted.manifest.canonicalUrl, 'https://example.org/article/1');
  assert.ok(converted.assets.some(asset => asset.path === 'legacy/archive.json'));
  assert.equal(articleArchiveRelativePath(archive), legacyPath);
  assert.equal(converted.legacy.relativePath, legacyPath);
  assert.equal(converted.legacy.deleteAfterImport, false);
});

test('content and side panel expose archive snapshot, restore, probe, and portable file controls', () => {
  const root = join(__dirname, '..');
  const content = readFileSync(join(root, 'content.js'), 'utf8');
  const popup = readFileSync(join(root, 'popup.js'), 'utf8');
  const html = readFileSync(join(root, 'popup.html'), 'utf8');
  const messenger = readFileSync(join(root, 'core', 'tab-messenger.js'), 'utf8');
  const background = readFileSync(join(root, 'background.js'), 'utf8');

  assert.match(content, /function buildCurrentArticleArchive/);
  assert.match(content, /function applyArticleArchiveSnapshot/);
  assert.match(content, /lastRegexHighlightRequest/);
  assert.match(content, /action === 'getArticleArchiveSnapshot'/);
  assert.match(content, /action === 'applyArticleArchiveSnapshot'/);
  assert.ok(
    messenger.indexOf("'core/article-archive.js'") < messenger.indexOf("'content.js'")
  );
  assert.ok(
    background.indexOf("'core/figure-workspace.js'") <
      background.indexOf("'core/article-archive.js'")
  );

  assert.match(popup, /async function probeCurrentArticleArchive/);
  assert.match(popup, /workspaceAlreadyHasArticleResults/);
  assert.match(popup, /readArticleArchivePromptDecision/);
  assert.match(popup, /rememberArticleArchivePromptDecision\(\s*imported \? 'imported' : 'loaded'/);
  assert.match(popup, /rememberArticleArchivePromptDecision\('skipped'/);
  assert.match(popup, /async function loadCurrentArticleArchive/);
  assert.match(popup, /async function restoreCurrentArticleWorkspaceFromDirectory/);
  assert.match(
    popup,
    /loadCurrentArticleArchive\(\)[\s\S]*restoreCurrentArticleWorkspaceFromDirectory\([\s\S]*workspace-loaded/
  );
  assert.match(popup, /已从本地工作区恢复全部结果和 \$\{turnCount\} 轮历史问答/);
  assert.match(popup, /async function persistCurrentArticleArchive/);
  assert.match(popup, /ARTICLE_ARCHIVE_PROBE/);
  assert.match(popup, /ARTICLE_ARCHIVE_SAVE/);
  assert.match(popup, /ARTICLE_ARCHIVE_LOAD/);
  assert.match(
    popup,
    /function downloadArticleArchive\(archive\)[\s\S]*downloadBlob\(blob, `\$\{title\}\.sci-archive\.json`\)/
  );
  assert.match(html, /id="loadArticleArchive"/);
  assert.match(html, /id="reanalyzeArticle"/);
  assert.match(html, /id="exportCurrentArticleArchive"/);
  assert.match(html, /id="importCurrentArticleArchive"/);
  assert.ok(
    html.indexOf('core/article-archive.js') < html.indexOf('popup.js')
  );
});

test('workspace restore preserves changed-content safety and current-page clear controls', () => {
  const root = join(__dirname, '..');
  const content = readFileSync(join(root, 'content.js'), 'utf8');
  const popup = readFileSync(join(root, 'popup.js'), 'utf8');
  assert.match(content, /match === 'content-changed'/);
  assert.match(content, /restoredWithoutRanges/);
  assert.match(popup, /scanCurrentArticleWorkspace/);
  assert.match(popup, /clearCurrentArticleWorkspace/);
  assert.match(popup, /workspaceGeneration/);
});

test('active persistence uses bounded workspace assets while retaining legacy archive import', () => {
  const root = join(__dirname, '..');
  const content = readFileSync(join(root, 'content.js'), 'utf8');
  const router = readFileSync(join(root, 'core', 'background-router.js'), 'utf8');
  for (const relativePath of [
    'article/structure.json', 'article/paragraphs.json', 'annotations/highlights.json',
    'analysis/full-analysis.json', 'chat/index.json', 'figures/inventory.json', 'ui/state.json'
  ]) assert.match(content, new RegExp(relativePath.replace(/[./]/g, '\\$&')));
  assert.match(content, /ARTICLE_WORKSPACE_SAVE_ASSET/);
  assert.match(router, /convertLegacyArticleArchiveToWorkspace/);
  assert.match(router, /legacyPreserved\s*=\s*true/);
});
