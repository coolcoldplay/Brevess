const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const popup = read('popup.js');
const html = read('popup.html');

function between(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `missing or reversed boundary: ${startMarker}`);
  return source.slice(start, end);
}

// Execute the existing contract against mutated markup: a negative assertion
// must actually reject a regression, not just succeed on an empty slice.
function runEnrichmentContract(markup) {
  const source = between(read('tests/reading-view-ui-contract.test.js'),
    "test('popup presents paragraph summaries as optional enrichment after the local tree'",
    "test('merged excerpts keep one full-text action in top tools above highlighter settings'");
  vm.runInNewContext(source, {
    test: (_name, callback) => callback(), assert,
    read: name => name === 'popup.html' ? markup : read(name)
  });
}

test('enrichment contract accepts the real merged highlighter markup', () => {
  assert.doesNotThrow(() => runEnrichmentContract(html));
});

test('enrichment contract rejects a missing highlighter boundary', () => {
  assert.throws(() => runEnrichmentContract(html.replace('id="highlightControls"', 'id="missingControls"')));
});

test('enrichment contract rejects removed actions reintroduced inside highlighter controls', () => {
  for (const id of ['generateReviewOutline', 'openArticleNavigator']) {
    const negative = html.replace('<details id="highlightControls" class="highlight-controls">',
      `<details id="highlightControls" class="highlight-controls"><button id="${id}"></button>`);
    assert.notEqual(negative, html);
    assert.throws(() => runEnrichmentContract(negative), `the contract missed ${id}`);
  }
});

for (const file of ['scripts/verify-native-side-panel-extension.js',
  'scripts/verify-typesafe-highlighting.mjs', 'scripts/verify-ai-button-progress.mjs',
  'scripts/capture-edge-store-screenshots.mjs']) {
  test(`${file} locates the merged highlighter instead of removed analysis DOM`, () => {
    const source = read(file);
    assert.doesNotMatch(source, /data-workspace-(?:target|view)="analysis"/);
    assert.match(source, /highlightControls/);
  });
}

test('progress verifier requires its real fixture host instead of silently omitting it', () => {
  assert.match(read('scripts/verify-ai-button-progress.mjs'), /if \(!host\) throw new Error\(/);
  assert.doesNotMatch(read('scripts/verify-ai-button-progress.mjs'), /\?\.appendChild\(fixture\)/);
});

const paragraphButton = between(popup, "                const paragraphId = String(paragraph.paragraphId || '');",
  '                const summarize = createWorkspaceElement(');

test('paragraph navigation no longer installs an unreachable automatic-summary handler', () => {
  assert.equal((paragraphButton.match(/button\.addEventListener\('click'/g) || []).length, 1);
  assert.doesNotMatch(paragraphButton, /runSingleParagraphSummary|点击生成摘要|workspace-paragraph-summary'/);
  assert.match(paragraphButton, /event\.stopImmediatePropagation\(\)/);
  assert.match(paragraphButton, /capture: true/);
});

test('paragraph jump dispatch preserves propagation isolation and makes no model call', async () => {
  const listeners = [];
  let focusCalls = 0;
  let modelCalls = 0;
  const context = {
    paragraph: { paragraphId: 'p1', sourceKey: 'source-p1', text: 'Synthetic paragraph' },
    index: 0, snapshot: { revision: 2 }, summaryIndex: { paragraphs: new Map() },
    workspaceParagraphSummaryState: new Map(), reviewOutlineState: { running: false },
    paragraphSummaryTaskGeneration: 1,
    createWorkspaceElement: () => ({ dataset: {}, addEventListener: (type, fn, options) => listeners.push({type, fn, options}) }),
    capturePanelContext: () => ({ generation: 1 }),
    focusWorkspaceSource: async () => { focusCalls += 1; return true; },
    isCurrentParagraphSummaryTask: () => true, showStatus: () => {},
    hasUsableLlm: () => true, runSingleParagraphSummary: () => { modelCalls += 1; }
  };
  vm.runInNewContext(paragraphButton, context);
  const event = { stopped: false, prevented: false,
    preventDefault() { this.prevented = true; },
    stopImmediatePropagation() { this.stopped = true; } };
  for (const listener of [...listeners].sort((a, b) => Number(Boolean(b.options?.capture)) - Number(Boolean(a.options?.capture)))) {
    await listener.fn(event);
    if (event.stopped) break;
  }
  assert.equal(focusCalls, 1);
  assert.equal(modelCalls, 0);
  assert.equal(event.prevented, true);
  assert.equal(event.stopped, true);
});

test('explicit summary action remains the only paragraph model trigger', () => {
  const action = between(popup, '                const summarize = createWorkspaceElement(',
    '                const note = createWorkspaceElement(');
  let summarize;
  let modelCalls = 0;
  vm.runInNewContext(action, {
    task: {}, reviewOutlineState: { running: false }, paragraph: { paragraphId: 'p1' },
    paragraphSummaryTaskGeneration: 1,
    createWorkspaceElement: () => ({ addEventListener: (_type, handler) => { summarize = handler; } }),
    hasUsableLlm: () => true, capturePanelContext: () => ({}),
    runSingleParagraphSummary: () => { modelCalls += 1; }
  });
  summarize({ preventDefault() {}, stopPropagation() {} });
  assert.equal(modelCalls, 1);
});

test('family controls retain archival behavior without dead legend construction', () => {
  const renderer = between(popup, 'function renderHighlightPresentationControls()', 'function getCurrentViewOverride(');
  const controls = { hidden: false };
  const details = { open: false };
  let cleared = 0;
  const radios = [{ value: 'all', checked: false }, { value: 'compact', checked: true }];
  vm.runInNewContext(renderer + '\nrenderHighlightPresentationControls();', {
    document: { getElementById: id => ({ highlightPresentationControls: controls,
      fineCategoryDetails: details, highlightFamilyLegend: { replaceChildren() { cleared += 1; } } })[id],
    querySelectorAll: () => radios }, fineCategoryDetailsTouched: false, presentationDensity: 'all'
  });
  assert.equal(controls.hidden, true);
  assert.equal(details.open, true);
  assert.equal(cleared, 1);
  assert.deepEqual(radios.map(r => r.checked), [true, false]);
  assert.doesNotMatch(renderer, /categoriesByFamily|DISPLAY_FAMILIES|highlight-family-chip/);
  assert.doesNotMatch(popup, /function currentPresentationCategoryEntries\(/);
  assert.match(popup, /sciLlmHighlightPresentationV1/);
  assert.match(popup, /hiddenFamilyIds: \[\.\.\.hiddenDisplayFamilyIds\]/);
});
