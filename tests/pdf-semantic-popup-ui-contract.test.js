const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Citations = require('../core/article-chat-citations.js');

function read(file) {
  return fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
}

function deferred() {
  let resolve;
  const promise = new Promise(resolvePromise => { resolve = resolvePromise; });
  return { promise, resolve };
}

function loadPopupUiHelpers() {
  const script = read('popup.js');
  const startMarker = '// DOM-independent popup UI helpers: start';
  const endMarker = '// DOM-independent popup UI helpers: end';
  const start = script.indexOf(startMarker);
  const end = script.indexOf(endMarker);
  assert.ok(start >= 0 && end > start);
  const context = {};
  vm.runInNewContext(
    `${script.slice(start + startMarker.length, end)}\n` +
      'globalThis.popupUiHelpers = PopupUiHelpers;',
    context
  );
  return context.popupUiHelpers;
}

function popupFunctionSource(name) {
  const script = read('popup.js');
  let start = script.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} must exist`);
  if (script.slice(Math.max(0, start - 6), start) === 'async ') start -= 6;
  const signatureEnd = script.indexOf(') {', start);
  assert.ok(signatureEnd >= 0);
  const bodyStart = signatureEnd + 2;
  let depth = 0;
  let end = -1;
  for (let index = bodyStart; index < script.length; index += 1) {
    if (script[index] === '{') depth += 1;
    if (script[index] === '}') depth -= 1;
    if (depth === 0) { end = index + 1; break; }
  }
  assert.ok(end > bodyStart);
  return script.slice(start, end);
}

function executablePopupFunction(name, dependencies = {}) {
  return Function(
    ...Object.keys(dependencies),
    `return (${popupFunctionSource(name)});`
  )(...Object.values(dependencies));
}

function executablePopupFunctions(names, dependencies = {}) {
  return Function(
    ...Object.keys(dependencies),
    `${names.map(popupFunctionSource).join('\n')}\nreturn { ${names.join(', ')} };`
  )(...Object.values(dependencies));
}

function semanticNavigation(label = 'a', overrides = {}) {
  const documentHash = label.repeat(64);
  const identity = {
    documentId: `sha256:${documentHash}`,
    documentHash,
    documentGeneration: 3,
    revision: 8,
    semanticCacheKey: `cache-${label}-8`,
    semanticProvenanceKey: `proof-${label}-8`
  };
  const paragraphTexts = overrides.paragraphTexts || [
    'Alpha effect was observed.',
    'The discussion limits interpretation.'
  ];
  const paragraphStarts = overrides.paragraphStarts ||
    paragraphTexts.map((_text, index) => 100 + index * 800);
  const targets = paragraphTexts.map((text, index) => ({
    kind: 'paragraph', ...identity,
    paragraphId: `semantic-${label}-${index + 1}`,
    pageNumber: index + 4,
    pageNumbers: [index + 4],
    normalizedStart: paragraphStarts[index],
    normalizedEnd: paragraphStarts[index] + text.length,
    expectedNormalizedQuote: text
  }));
  return {
    schemaVersion: 1,
    type: 'pdf-semantic-navigation',
    ...identity,
    ...overrides.identity,
    sections: [{
      sectionId: `section-${label}`,
      title: 'Results',
      level: 1,
      paragraphTargets: targets.map(target => ({ ...target, ...overrides.identity })),
      children: []
    }]
  };
}

function semanticEvidence(navigation, paragraphIndex = 0, overrides = {}) {
  const target = navigation.sections[0].paragraphTargets[paragraphIndex];
  return {
    locatorKind: 'pdf-semantic',
    documentId: target.documentId,
    documentHash: target.documentHash,
    documentGeneration: target.documentGeneration,
    revision: target.revision,
    semanticCacheKey: target.semanticCacheKey,
    semanticProvenanceKey: target.semanticProvenanceKey,
    paragraphId: target.paragraphId,
    normalizedStart: target.normalizedStart,
    normalizedEnd: target.normalizedEnd,
    expectedNormalizedQuote: target.expectedNormalizedQuote,
    quote: target.expectedNormalizedQuote,
    ...overrides
  };
}

function citationHelpers() {
  return executablePopupFunctions([
    'isTrustedPopupPdfParagraphTarget',
    'resolvePopupPdfArticleChatEvidence',
    'resolveArticleChatEvidenceTarget',
    'isArticleChatCitationFocusable',
    'createArticleChatCitationFocusTarget',
    'articleChatCitationStatusText',
    'applyArticleChatCitationState'
  ], { SciLLM: Citations, currentPdfSemanticNavigation: null });
}

test('semantic PDF focus feedback distinguishes exact, normalized, page-only and stale results', () => {
  const { describePdfSemanticFocusResult } = loadPopupUiHelpers();
  assert.deepEqual(
    JSON.parse(JSON.stringify(describePdfSemanticFocusResult({
      success: true, citationResult: {
        focused: true, focusedGranularity: 'sentence', precision: 'exact-raw'
      }
    }))),
    { state: 'exact', message: '句子精确定位完成。' }
  );
  assert.equal(describePdfSemanticFocusResult({
    success: true, citationResult: {
      focused: true, focusedGranularity: 'paragraph', precision: 'normalized-equivalent'
    }
  }).message, '已按规范化等价文本定位到段落。');
  assert.equal(describePdfSemanticFocusResult({
    success: true, citationResult: {
      focused: true, focusedGranularity: 'page', precision: 'page-only', pageNumber: 23
    }
  }).message, '仅定位到第 23 页。');
  assert.equal(describePdfSemanticFocusResult({
    success: true, citationResult: {
      focused: false, reasonCode: 'PDF_FOCUS_STALE'
    }
  }).state, 'stale');
});

test('semantic PDF focus coordinator publishes only the latest click result', async () => {
  const { createPdfSemanticFocusCoordinator } = loadPopupUiHelpers();
  const first = deferred();
  const second = deferred();
  const pending = [];
  const announcements = [];
  const coordinator = createPdfSemanticFocusCoordinator({
    focus: target => target.id === 'first' ? first.promise : second.promise,
    isCurrent: () => true,
    setPending: (value, target) => pending.push([value, target?.id || '']),
    announce: description => announcements.push(description.message)
  });
  const firstRun = coordinator.run({ id: 'first' }, {});
  const secondRun = coordinator.run({ id: 'second' }, {});
  first.resolve({ success: true, focused: true, citationResult: {
    focused: true, focusedGranularity: 'paragraph', precision: 'exact-raw'
  } });
  assert.equal((await firstRun).applied, false);
  second.resolve({ success: true, focused: true, citationResult: {
    focused: true, focusedGranularity: 'page', precision: 'page-only', pageNumber: 7
  } });
  assert.equal((await secondRun).applied, true);
  assert.deepEqual(announcements, ['仅定位到第 7 页。']);
  assert.deepEqual(pending, [
    [true, 'first'], [true, 'second'], [false, 'second']
  ]);
});

test('latest semantic focus clears its own pending state when the tree refreshes', async () => {
  const { createPdfSemanticFocusCoordinator } = loadPopupUiHelpers();
  const result = deferred();
  const pending = [];
  const announcements = [];
  let current = true;
  const coordinator = createPdfSemanticFocusCoordinator({
    focus: () => result.promise,
    isCurrent: () => current,
    setPending: value => pending.push(value),
    announce: description => announcements.push(description)
  });
  const run = coordinator.run({ id: 'only' }, {});
  current = false;
  result.resolve({ success: true, focused: true, citationResult: {
    focused: true, focusedGranularity: 'paragraph', precision: 'exact-raw'
  } });
  const outcome = await run;
  assert.equal(outcome.applied, false);
  assert.deepEqual(pending, [true, false]);
  assert.equal(announcements.length, 1);
  assert.equal(announcements[0].state, 'stale');
  assert.match(announcements[0].message, /刷新|失效/);
});

test('detailed focus helper retains citationResult while boolean callers stay compatible', async () => {
  const citationResult = {
    focused: true, focusedGranularity: 'paragraph', precision: 'normalized-equivalent'
  };
  const detailed = executablePopupFunction('focusWorkspaceSourceDetailed', {
    capturePanelContext: () => ({ tabId: 41 }),
    isCurrentPanelContext: () => true,
    sendTabMessage: async () => ({ success: true, focused: true, citationResult })
  });
  const response = await detailed({ kind: 'paragraph' }, { tabId: 41 });
  assert.equal(response.focused, true);
  assert.equal(response.citationResult, citationResult);

  const booleanHelper = executablePopupFunction('focusWorkspaceSource', {
    capturePanelContext: () => ({ tabId: 41 }),
    focusWorkspaceSourceDetailed: async () => response
  });
  assert.equal(await booleanHelper({}, { tabId: 41 }), true);
});

test('PDF citation preflight migrates against current semantic navigation instead of page snapshot', () => {
  const { resolveArticleChatEvidenceTarget } = citationHelpers();
  const navigation = semanticNavigation('a');
  const pageSnapshot = {
    documentHash: navigation.documentHash,
    revision: navigation.revision,
    paragraphs: [{ paragraphId: 'pdf-page-4', text: 'unrelated page snapshot' }]
  };
  const verification = resolveArticleChatEvidenceTarget(
    semanticEvidence(navigation), pageSnapshot, navigation);

  assert.equal(verification.semanticMigration, true);
  assert.equal(verification.status, 'verified');
  assert.equal(verification.candidateCount, 1);
  assert.equal(verification.locator.paragraphId, 'semantic-a-1');
  assert.equal(verification.locator.normalizedStart, 100);
  assert.equal(verification.locator.expectedNormalizedQuote,
    'Alpha effect was observed.');
});

test('PDF citation preflight does not invent a first-page fallback for a multi-page paragraph', () => {
  const { resolveArticleChatEvidenceTarget } = citationHelpers();
  const navigation = semanticNavigation('m');
  const target = navigation.sections[0].paragraphTargets[0];
  target.pageNumbers = [target.pageNumber, target.pageNumber + 1];
  const verification = resolveArticleChatEvidenceTarget(
    semanticEvidence(navigation), {}, navigation);
  assert.equal(verification.status, 'verified');
  assert.equal(verification.locator.paragraphId, target.paragraphId);
  assert.equal(verification.pageAnchor, null);
});

test('duplicate parent and child projection of one trusted semantic paragraph is verified once', () => {
  const { resolveArticleChatEvidenceTarget } = citationHelpers();
  const navigation = semanticNavigation('a');
  const target = navigation.sections[0].paragraphTargets[0];
  navigation.sections[0].children.push({
    sectionId: 'section-a-child', title: 'Nested results', level: 2,
    paragraphTargets: [{ ...target }], children: []
  });
  const verification = resolveArticleChatEvidenceTarget(
    semanticEvidence(navigation), {}, navigation);
  assert.equal(verification.status, 'verified');
  assert.equal(verification.locator.paragraphId, target.paragraphId);
});

test('conflicting semantic targets with one paragraph id fail closed and cannot focus', () => {
  const { resolveArticleChatEvidenceTarget, isArticleChatCitationFocusable } = citationHelpers();
  const navigation = semanticNavigation('a');
  const target = navigation.sections[0].paragraphTargets[0];
  const conflictingText = 'Conflicting semantic paragraph.';
  navigation.sections[0].children.push({
    sectionId: 'section-a-child', title: 'Nested results', level: 2,
    paragraphTargets: [{
      ...target,
      normalizedEnd: target.normalizedStart + conflictingText.length,
      expectedNormalizedQuote: conflictingText
    }],
    children: []
  });
  const verification = resolveArticleChatEvidenceTarget(
    semanticEvidence(navigation), {}, navigation);
  assert.equal(verification.status, 'invalid');
  assert.equal(verification.degradedReasonCode, 'PDF_EVIDENCE_INVALID');
  assert.equal(isArticleChatCitationFocusable(verification), false);
});

test('semantic migration receives and preserves real sparse document-global offsets', () => {
  const migrationCalls = [];
  const helpers = executablePopupFunctions([
    'isTrustedPopupPdfParagraphTarget',
    'resolvePopupPdfArticleChatEvidence',
    'resolveArticleChatEvidenceTarget'
  ], {
    SciLLM: {
      ...Citations,
      migratePdfArticleChatEvidence(input, context) {
        migrationCalls.push({ input, context });
        return Citations.migratePdfArticleChatEvidence(input, context);
      }
    },
    currentPdfSemanticNavigation: null
  });
  const navigation = semanticNavigation('g', {
    paragraphStarts: [250000, 900000]
  });
  const evidence = semanticEvidence(navigation);
  const verification = helpers.resolveArticleChatEvidenceTarget(evidence, {}, navigation);

  assert.equal(verification.status, 'verified');
  assert.equal(verification.locator.normalizedStart, 250000);
  assert.equal(migrationCalls[0].input.locator.normalizedStart, 250000);
  assert.deepEqual(migrationCalls[0].context.paragraphs.map(item => item.normalizedStart),
    [250000, 900000]);
  const source = popupFunctionSource('resolvePopupPdfArticleChatEvidence');
  assert.doesNotMatch(source, /migrationStart|translateLocator|restoreLocator|\bcursor\b/);
});

test('PDF citation migration enables exact and rebound targets but disables stale and ambiguous ones', () => {
  const { resolveArticleChatEvidenceTarget, isArticleChatCitationFocusable } = citationHelpers();
  const current = semanticNavigation('a');
  const exact = resolveArticleChatEvidenceTarget(semanticEvidence(current), {}, current);
  assert.equal(isArticleChatCitationFocusable(exact), true);

  const old = semanticEvidence(current, 0, {
    paragraphId: 'semantic-old-results', revision: 7,
    semanticCacheKey: 'cache-a-7', semanticProvenanceKey: 'proof-a-7'
  });
  const rebound = resolveArticleChatEvidenceTarget(old, {}, current);
  assert.equal(rebound.status, 'verified');
  assert.equal(rebound.rebound, true);
  assert.equal(isArticleChatCitationFocusable(rebound), true);

  const replacement = semanticNavigation('b');
  const stale = resolveArticleChatEvidenceTarget(semanticEvidence(current), {}, replacement);
  assert.equal(stale.status, 'stale');
  assert.equal(stale.degradedReasonCode, 'PDF_DOCUMENT_CHANGED');
  assert.equal(isArticleChatCitationFocusable(stale), false);

  const duplicate = semanticNavigation('a', {
    paragraphTexts: ['Alpha effect was observed.', 'Alpha effect was observed.']
  });
  const ambiguous = resolveArticleChatEvidenceTarget(old, {}, duplicate);
  assert.equal(ambiguous.status, 'ambiguous');
  assert.equal(ambiguous.degradedReasonCode, 'PDF_SEMANTIC_QUOTE_AMBIGUOUS');
  assert.equal(isArticleChatCitationFocusable(ambiguous), false);
});

test('legacy page-only citation stays clickable but is visibly pending verification', () => {
  const {
    resolveArticleChatEvidenceTarget,
    isArticleChatCitationFocusable,
    createArticleChatCitationFocusTarget,
    applyArticleChatCitationState
  } = citationHelpers();
  const navigation = semanticNavigation('a');
  const degraded = resolveArticleChatEvidenceTarget({
    paragraphId: 'pdf-page-4', pageNumber: 4
  }, {}, navigation);
  assert.equal(degraded.status, 'degraded');
  assert.equal(degraded.precision, 'page-only');
  assert.equal(isArticleChatCitationFocusable(degraded), true);

  const classes = new Set();
  const button = {
    classList: {
      add: value => classes.add(value),
      remove: (...values) => values.forEach(value => classes.delete(value))
    },
    dataset: {},
    disabled: true,
    textContent: '',
    title: '',
    setAttribute(name, value) { this[name] = value; }
  };
  applyArticleChatCitationState(button, degraded, 1, 'Results');
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, '页级·待核验');
  assert.equal(button.dataset.verificationStatus, 'degraded');
  assert.equal(button.dataset.precision, 'page-only');
  assert.match(button.title, /待核验/);
  assert.match(button.title, /第 4 页/);
  assert.equal(classes.has('is-verified'), false);
  assert.equal(classes.has('is-degraded'), true);
  const target = createArticleChatCitationFocusTarget({}, degraded, { revision: 8 });
  assert.deepEqual(target.evidence.pageAnchor,
    { paragraphId: 'pdf-page-4', pageNumber: 4 });
  assert.equal(target.evidence.precision, 'page-only');
  assert.equal(target.evidence.status, 'degraded');
  assert.equal(Object.hasOwn(target.evidence, 'locator'), false);
  assert.equal(Object.hasOwn(target.evidence, 'expectedNormalizedQuote'), false);
});

test('semantic citation click target forwards full locator and migration state', () => {
  const { resolveArticleChatEvidenceTarget, createArticleChatCitationFocusTarget } =
    citationHelpers();
  const navigation = semanticNavigation('a');
  const item = semanticEvidence(navigation);
  const verification = resolveArticleChatEvidenceTarget(item, {}, navigation);
  const target = createArticleChatCitationFocusTarget(item, verification, { revision: 91 });

  assert.equal(target.kind, 'article-chat-citation');
  assert.equal(target.documentRevision, 91);
  assert.deepEqual(target.evidence.locator, verification.locator);
  for (const field of [
    'locatorKind', 'documentId', 'documentHash', 'documentGeneration', 'revision',
    'semanticCacheKey', 'semanticProvenanceKey', 'paragraphId', 'normalizedStart',
    'normalizedEnd', 'expectedNormalizedQuote'
  ]) assert.equal(target.evidence[field], verification.locator[field]);
  assert.equal(target.evidence.quote, verification.locator.expectedNormalizedQuote);
  assert.equal(target.evidence.status, 'verified');
  assert.equal(target.evidence.precision, 'normalized-exact');
  assert.equal(target.evidence.degradedReasonCode, '');
  assert.equal(target.evidence.rebound, false);
  assert.deepEqual(target.evidence.pageAnchor,
    { paragraphId: 'pdf-page-4', pageNumber: 4 });
  const focusSource = popupFunctionSource('focusArticleChatCitation');
  assert.match(focusSource,
    /documentHash:\s*item\?\.documentHash \|\| snapshot\?\.documentHash/);
  assert.match(focusSource,
    /createArticleChatCitationFocusTarget\(focusItem, verification, snapshot\)/);
  assert.match(focusSource,
    /sendTabMessage\(panelContext\.tabId,\s*\{[\s\S]*?action:\s*'focusArticleWorkspaceSource',[\s\S]*?target/);
});

test('HTML citation preflight retains the existing verifier and focus payload', () => {
  let received = null;
  const expected = { status: 'verified', candidateCount: 1,
    target: { paragraphId: 'html-p1', sourceKey: 'source-1' } };
  const helpers = executablePopupFunctions([
    'isTrustedPopupPdfParagraphTarget',
    'resolvePopupPdfArticleChatEvidence',
    'resolveArticleChatEvidenceTarget',
    'isArticleChatCitationFocusable',
    'createArticleChatCitationFocusTarget'
  ], {
    SciLLM: {
      migratePdfArticleChatEvidence: Citations.migratePdfArticleChatEvidence,
      verifyArticleChatEvidence(item, snapshot) {
        received = { item, snapshot };
        return expected;
      }
    },
    currentPdfSemanticNavigation: null
  });
  const item = { paragraphId: 'html-p1', quote: 'HTML evidence', documentRevision: 4 };
  const snapshot = { revision: 5, paragraphs: [] };
  const verification = helpers.resolveArticleChatEvidenceTarget(item, snapshot, null);
  assert.equal(verification, expected);
  assert.equal(received.item.documentRevision, 4);
  assert.equal(received.snapshot, snapshot);
  const target = helpers.createArticleChatCitationFocusTarget(item, verification, snapshot);
  assert.equal(target.evidence.paragraphId, 'html-p1');
  assert.equal(target.evidence.quote, 'HTML evidence');
});

test('semantic PDF tree is navigation-only and keeps nested inferred sections and paragraphs', () => {
  const script = read('popup.js');
  const start = script.indexOf('function renderPopupPdfSemanticNavigation');
  const end = script.indexOf('\nasync function runSingleParagraphSummary', start);
  const renderer = script.slice(start, end);
  assert.match(renderer, /section\.children\.forEach\(child => appendSection\(child, body, depth \+ 1\)\)/);
  assert.match(renderer, /section\.title \|\| '未命名章节'/);
  assert.match(renderer, /startsWith\('implicit-'\)[\s\S]*?workspace-pdf-semantic-inferred/);
  assert.match(renderer, /section\.paragraphTargets\.forEach/);
  assert.match(renderer, /dataset\.pdfSemanticFocus = 'paragraph'/);
  assert.match(script, /kind:\s*'paragraph'/);
  assert.match(script, /quote:\s*target\.expectedNormalizedQuote/);
  assert.doesNotMatch(renderer,
    /workspace-section-analysis-toggle|runSingleParagraphSummary|openParagraphNoteEditor/);
});

test('semantic PDF navigation is transient and HTML or legacy PDF keeps snapshot fallback', () => {
  const script = read('popup.js');
  const html = read('popup.html');
  const css = read('popup.css');
  const cacheStart = script.indexOf('function cacheCurrentPanelTabState');
  const cacheEnd = script.indexOf('\nfunction resetPanelArticleState', cacheStart);
  const uiSaveStart = script.indexOf('function scheduleActiveWorkspaceUiStateSave');
  const uiSaveEnd = script.indexOf('\nfunction setAllOutlineLevelsExpanded', uiSaveStart);
  const rendererStart = script.indexOf('function renderArticleNavigationTree');
  const rendererEnd = script.indexOf('\nfunction renderEvidenceLedger', rendererStart);
  assert.doesNotMatch(script.slice(cacheStart, cacheEnd), /currentPdfSemanticNavigation/);
  assert.doesNotMatch(script.slice(uiSaveStart, uiSaveEnd), /pdfSemanticNavigation/);
  assert.match(script.slice(rendererStart, rendererEnd),
    /if \(semanticNavigation\)[\s\S]*?const nodes = Array\.isArray\(snapshot\?\.nodes\)/);
  assert.match(script, /response\.pdfSemanticNavigation \?\? null/);
  assert.match(script, /message\?\.type === 'ARTICLE_STRUCTURE_CHANGED'[\s\S]*?refreshArticleWorkspace/);
  // UI025 removes the static heading copy; keep the accessible local refresh in the top toolbar.
  const toolbarStart = html.indexOf('<div class="side-panel-global-tools"');
  const toolbarEnd = html.indexOf('<details id="sidePanelMoreTools"', toolbarStart);
  assert.ok(toolbarStart >= 0 && toolbarEnd > toolbarStart);
  const refresh = html.slice(toolbarStart, toolbarEnd)
    .match(/<button id="refreshArticleNavigation"[^>]*>[\s\S]*?<\/button>/)?.[0] || '';
  assert.match(refresh, /data-workspace-tools="navigation"/);
  assert.match(refresh, /aria-label="[^"]+"/);
  assert.match(refresh, /<svg\b[^>]*aria-hidden="true"/);
  assert.match(html, /id="articleNavigationFocusStatus"[\s\S]*?aria-live="polite"/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /\[data-pdf-semantic-focus\]\.is-pending/);
});

test('content responses expose semantic navigation beside snapshots and retain detailed focus', () => {
  const content = read('content.js');
  const showStart = content.indexOf('function showArticleNavigator');
  const showEnd = content.indexOf('\nfunction renderReviewOutlinePanel', showStart);
  const getStart = content.indexOf("request.action === 'getArticleWorkspaceSnapshot'");
  const getEnd = content.indexOf("request.action === 'getArticleAbbreviations'", getStart);
  const focusStart = content.indexOf("request.action === 'focusArticleWorkspaceSource'");
  const focusEnd = content.indexOf("request.action === 'armSidePanelRestore'", focusStart);
  assert.match(content.slice(showStart, showEnd),
    /withCurrentPdfSemanticNavigation\(\{[\s\S]*?snapshot:/);
  assert.match(content.slice(getStart, getEnd),
    /withCurrentPdfSemanticNavigation\(\{[\s\S]*?snapshot/);
  assert.match(content.slice(focusStart, focusEnd),
    /citationResult[\s\S]*?focused:/);
});

test('semantic structure events deduplicate identical coverage and trailing-coalesce to latest', async () => {
  const { createArticleStructureRefreshCoordinator } = loadPopupUiHelpers();
  assert.equal(typeof createArticleStructureRefreshCoordinator, 'function');
  const timers = new Map();
  let nextTimer = 1;
  const refreshed = [];
  const coordinator = createArticleStructureRefreshCoordinator({
    schedule: callback => {
      const id = nextTimer++;
      timers.set(id, callback);
      return id;
    },
    cancelSchedule: id => timers.delete(id),
    refresh: async message => { refreshed.push(message.revision || 'legacy'); }
  });
  const semantic = revision => ({
    type: 'ARTICLE_STRUCTURE_CHANGED',
    documentId: 'doc-1',
    documentHash: 'a'.repeat(64),
    documentGeneration: 3,
    revision,
    semanticCacheKey: `cache-${revision}`,
    semanticProvenanceKey: `proof-${revision}`,
    coverage: { sectionCount: revision, paragraphCount: revision * 2, pageCount: revision }
  });
  coordinator.enqueue(semantic(1), 44, { key: 'paper' });
  coordinator.enqueue(semantic(1), 44, { key: 'paper' });
  coordinator.enqueue(semantic(2), 44, { key: 'paper' });
  coordinator.enqueue(semantic(3), 44, { key: 'paper' });
  assert.equal(timers.size, 1);
  const callback = [...timers.values()][0];
  timers.clear();
  await callback();
  assert.deepEqual(refreshed, [3]);
  coordinator.enqueue(semantic(3), 44, { key: 'paper' });
  assert.equal(timers.size, 0, 'an already dispatched semantic identity stays deduplicated');

  coordinator.enqueue({ type: 'ARTICLE_STRUCTURE_CHANGED', source: 'legacy-html' },
    44, { key: 'paper' });
  coordinator.enqueue({ type: 'ARTICLE_STRUCTURE_CHANGED', source: 'legacy-html' },
    44, { key: 'paper' });
  await Promise.resolve();
  assert.deepEqual(refreshed, [3, 'legacy', 'legacy']);
});

test('semantic structure refresh retains only the latest event arriving during a refresh', async () => {
  const { createArticleStructureRefreshCoordinator } = loadPopupUiHelpers();
  const timers = new Map();
  let nextTimer = 1;
  const firstRefresh = deferred();
  const refreshed = [];
  const coordinator = createArticleStructureRefreshCoordinator({
    schedule: callback => {
      const id = nextTimer++;
      timers.set(id, callback);
      return id;
    },
    cancelSchedule: id => timers.delete(id),
    refresh: message => {
      refreshed.push(message.revision);
      return message.revision === 1 ? firstRefresh.promise : Promise.resolve(true);
    }
  });
  const semantic = revision => ({
    type: 'ARTICLE_STRUCTURE_CHANGED', documentId: 'doc', documentHash: 'b'.repeat(64),
    documentGeneration: 1, revision, semanticCacheKey: `cache-${revision}`,
    semanticProvenanceKey: `proof-${revision}`,
    coverage: { sectionCount: revision, paragraphCount: revision, pageCount: revision }
  });
  coordinator.enqueue(semantic(1), 9, {});
  const firstTimer = [...timers.values()][0];
  timers.clear();
  const firstRun = firstTimer();
  await Promise.resolve();
  coordinator.enqueue(semantic(2), 9, {});
  coordinator.enqueue(semantic(3), 9, {});
  assert.equal(timers.size, 0, 'running refresh owns the timer until it settles');
  firstRefresh.resolve(true);
  await firstRun;
  assert.equal(timers.size, 1);
  const trailing = [...timers.values()][0];
  timers.clear();
  await trailing();
  assert.deepEqual(refreshed, [1, 3]);
});

test('an active duplicate semantic event retries once only when the active refresh fails', async () => {
  const { createArticleStructureRefreshCoordinator } = loadPopupUiHelpers();
  const timers = new Map();
  let nextTimer = 1;
  let calls = 0;
  const first = deferred();
  const coordinator = createArticleStructureRefreshCoordinator({
    schedule: callback => { const id = nextTimer++; timers.set(id, callback); return id; },
    cancelSchedule: id => timers.delete(id),
    refresh: () => ++calls === 1 ? first.promise : Promise.resolve(true)
  });
  const message = {
    type: 'ARTICLE_STRUCTURE_CHANGED', documentId: 'doc', documentHash: 'c'.repeat(64),
    documentGeneration: 1, revision: 5, semanticCacheKey: 'cache-5',
    semanticProvenanceKey: 'proof-5',
    coverage: { sectionCount: 5, paragraphCount: 9, pageCount: 4 }
  };
  coordinator.enqueue(message, 7, {});
  const activeTimer = [...timers.values()][0];
  timers.clear();
  const activeRun = activeTimer();
  await Promise.resolve();
  coordinator.enqueue(message, 7, {});
  first.resolve(null);
  await activeRun;
  assert.equal(timers.size, 1, 'the swallowed active duplicate becomes one trailing retry');
  const retryTimer = [...timers.values()][0];
  timers.clear();
  await retryTimer();
  assert.equal(calls, 2);
  assert.equal(timers.size, 0, 'the successful bounded retry cannot self-schedule again');
});

test('an active duplicate semantic event is discarded when the active refresh succeeds', async () => {
  const { createArticleStructureRefreshCoordinator } = loadPopupUiHelpers();
  const timers = new Map();
  let nextTimer = 1;
  let calls = 0;
  const first = deferred();
  const coordinator = createArticleStructureRefreshCoordinator({
    schedule: callback => { const id = nextTimer++; timers.set(id, callback); return id; },
    cancelSchedule: id => timers.delete(id),
    refresh: () => { calls += 1; return first.promise; }
  });
  const message = {
    type: 'ARTICLE_STRUCTURE_CHANGED', documentId: 'doc', documentHash: 'd'.repeat(64),
    documentGeneration: 1, revision: 6, semanticCacheKey: 'cache-6',
    semanticProvenanceKey: 'proof-6',
    coverage: { sectionCount: 6, paragraphCount: 12, pageCount: 6 }
  };
  coordinator.enqueue(message, 8, {});
  const activeTimer = [...timers.values()][0];
  timers.clear();
  const activeRun = activeTimer();
  await Promise.resolve();
  coordinator.enqueue(message, 8, {});
  first.resolve(true);
  await activeRun;
  assert.equal(calls, 1);
  assert.equal(timers.size, 0);
});

test('the bounded semantic retry cannot loop after a second active duplicate and failure', async () => {
  const { createArticleStructureRefreshCoordinator } = loadPopupUiHelpers();
  const timers = new Map();
  let nextTimer = 1;
  const attempts = [deferred(), deferred()];
  let calls = 0;
  const coordinator = createArticleStructureRefreshCoordinator({
    schedule: callback => { const id = nextTimer++; timers.set(id, callback); return id; },
    cancelSchedule: id => timers.delete(id),
    refresh: () => attempts[calls++].promise
  });
  const message = {
    type: 'ARTICLE_STRUCTURE_CHANGED', documentId: 'doc', documentHash: 'e'.repeat(64),
    documentGeneration: 1, revision: 7, semanticCacheKey: 'cache-7',
    semanticProvenanceKey: 'proof-7',
    coverage: { sectionCount: 7, paragraphCount: 14, pageCount: 7 }
  };
  coordinator.enqueue(message, 10, {});
  let timer = [...timers.values()][0];
  timers.clear();
  let run = timer();
  await Promise.resolve();
  coordinator.enqueue(message, 10, {});
  attempts[0].resolve(null);
  await run;
  timer = [...timers.values()][0];
  timers.clear();
  run = timer();
  await Promise.resolve();
  coordinator.enqueue(message, 10, {});
  attempts[1].resolve(null);
  await run;
  assert.equal(calls, 2);
  assert.equal(timers.size, 0);
});

test('runtime semantic structure notifications use the bounded coordinator and reset invalidates it', () => {
  const script = read('popup.js');
  const branchStart = script.indexOf("message?.type === 'ARTICLE_STRUCTURE_CHANGED'");
  const branchEnd = script.indexOf("message?.type === 'ABBREVIATION_MEMORY_CHANGED'", branchStart);
  const branch = script.slice(branchStart, branchEnd);
  assert.match(branch, /ensureArticleStructureRefreshCoordinator\(\)\.enqueue/);
  assert.doesNotMatch(branch, /void refreshArticleWorkspace\(/);
  const resetStart = script.indexOf('function resetPanelArticleState');
  const resetEnd = script.indexOf('\nfunction isCurrentFigureTask', resetStart);
  assert.match(script.slice(resetStart, resetEnd),
    /articleStructureRefreshCoordinator\?\.invalidate\(\)/);
  const signatureStart = script.indexOf('function semanticArticleStructureEventSignature');
  const signatureEnd = script.indexOf('\n    function createArticleStructureRefreshCoordinator', signatureStart);
  const signature = script.slice(signatureStart, signatureEnd);
  for (const field of [
    'senderTabId', 'documentId', 'documentHash', 'documentGeneration', 'revision',
    'semanticCacheKey', 'semanticProvenanceKey', 'sectionCount', 'paragraphCount', 'pageCount'
  ]) assert.match(signature, new RegExp(field));
});
