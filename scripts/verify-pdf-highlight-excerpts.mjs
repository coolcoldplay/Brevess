import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { chromium } from 'playwright';
const root = path.resolve(import.meta.dirname, '..');
const option = name => { const index = process.argv.indexOf(`--${name}`); return index >= 0 ? process.argv[index + 1] : ''; };
const extension = path.resolve(option('extension') || process.env.SCI_EXTENSION_ROOT || root);
const out = path.resolve(option('output') || path.join(root, 'output/playwright/r15-pdf-excerpt-acceptance'));
const pdf = path.join(root, 'tmp/public-pdf-acceptance/elife-83176-v2.pdf');
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
fs.mkdirSync(out, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-r15-pdf-excerpt-'));
const report = { acceptance: 'r15 PDF persistent highlight to excerpt bridge',
  source: 'production runtime; real 23-page public PDF; regex and explicitly marked LLM/manual record fixtures',
  extensionRoot: extension, pdfSha256: sha(pdf),
  sourceHashes: Object.fromEntries(['content.js', 'pdf-reader.js', 'pdf-native-reader.mjs',
    'core/highlight-distribution.js', 'core/pdf-annotations.js'].map(name => [name, sha(path.join(extension, name))])),
  productionApiValidated: false,
  providerCalls: 0, errors: [] };
let context;
try {
  context = await chromium.launchPersistentContext(profile, {
    channel: 'msedge', headless: true, viewport: { width: 1320, height: 960 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  });
  await context.route(/^https?:\/\//u, route => route.abort('blockedbyclient'));
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const reader = await context.newPage();
  reader.on('pageerror', error => report.errors.push(error.message));
  await reader.goto(`chrome-extension://${new URL(worker.url()).host}/pdf-reader.html`);
  await reader.locator('#pdfLocalFile').setInputFiles(pdf);
  await reader.waitForFunction(() => globalThis.__brevessPdfSemanticDocument?.indexedPageCount === 23 &&
    globalThis.__brevessNativePdfDocument?.getSemanticNavigation?.()?.sections?.length > 0,
  null, { timeout: 120000 });
  const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url).id, reader.url());
  const send = payload => worker.evaluate(({ tabId, payload }) => chrome.tabs.sendMessage(tabId, payload), { tabId, payload });
  report.before = (await send({ action: 'showArticleNavigator', tab: 'outline' })).snapshot.highlightDistribution;
  report.apply = await send({ action: 'applyHighlight', mode: 'word', analysisModeId: 'r15-excerpt-diagnostic',
    categories: { r15_microglia: { name: 'Microglia', patterns: ['microglia'], isRegex: false, color: '#ffe083' } } });
  report.runtime = await reader.evaluate(() => ({
    logicalItems: [...highlighter.nativePdfModes.values()].flatMap(entry => entry.items || entry.matches || []).length,
    renderedPdfRects: document.querySelectorAll('.pdf-native-regex-hit').length,
    webpageMarks: document.querySelectorAll('.sci-highlight,.sci-llm-highlight,.sci-manual-highlight').length,
    collectedOccurrences: collectPageHighlightOccurrences(getCanonicalArticleSnapshot().structure).length,
    sample: [...highlighter.nativePdfModes.values()].flatMap(entry => entry.items || []).slice(0, 2).map(item => ({ quote: item.quote, pageNumbers: item.pageNumbers, locator: item.locator }))
  }));
  const after = await send({ action: 'showArticleNavigator', tab: 'outline' });
  report.snapshotAction = { success: after.success, error: after.error };
  const fallback = after.snapshot ? after : await send({ action: 'showArticleNavigator', tab: 'outline' });
  const distribution = fallback.snapshot?.highlightDistribution;
  report.after = { totalHighlights: distribution.totalHighlights, sourceCounts: distribution.sourceCounts,
    unresolved: distribution.unresolved.length, rows: distribution.rows.length };
  assert.equal(report.apply.counts.r15_microglia, 112);
  assert.equal(report.runtime.logicalItems, 112);
  assert.equal(distribution.totalHighlights, 112);
  assert.equal(distribution.unresolved.length, 0);
  const occurrences = distribution.rows.flatMap(row => Object.values(row.cells).flatMap(cell => cell.items));
  report.sectionTargets = await reader.evaluate(rowIds => {
    const sections = flattenPdfSemanticNavigationSections(globalThis.__brevessNativePdfDocument.getSemanticNavigation().sections);
    const targetFor = section => section.target?.kind === 'paragraph' ? section.target : section.paragraphTargets?.[0];
    const candidates = sections.filter(section => rowIds.includes(section.sectionId) && Number(targetFor(section)?.pageNumber) > 5)
      .map(section => ({ section, target: targetFor(section), resolution:
        resolvePdfSemanticHighlightLocator(createPdfSemanticHighlightLocator(targetFor(section))) }));
    const far = candidates.find(item => item.resolution.status === 'resolved')?.section;
    return { totalSections: sections.length,
      sectionsWithSourceKey: sections.filter(section => typeof section.sourceKey === 'string' && section.sourceKey.length > 0).length,
      firstSectionId: sections[0]?.sectionId,
      candidates: candidates.map(item => ({ sectionId: item.section.sectionId, pageNumber: item.target.pageNumber,
        status: item.resolution.status, reasonCode: item.resolution.reasonCode })),
      targetSectionId: far?.sectionId, expectedPageNumber: targetFor(far || {})?.pageNumber };
  }, distribution.rows.map(row => row.sectionId));
  assert.ok(report.sectionTargets.targetSectionId);
  report.sectionFocus = await send({ action: 'focusArticleWorkspaceSource',
    target: { kind: 'section', sectionId: report.sectionTargets.targetSectionId } });
  report.invalidSectionFocus = await send({ action: 'focusArticleWorkspaceSource',
    target: { kind: 'section', sectionId: 'pdf-section:r15-nonexistent' } });
  assert.equal(report.sectionFocus.focused, true);
  assert.equal(report.sectionFocus.citationResult.pageNumber, report.sectionTargets.expectedPageNumber);
  assert.equal(report.invalidSectionFocus.focused, false);
  const unavailableSection = report.sectionTargets.candidates.find(item => item.status === 'unresolved');
  if (unavailableSection) {
    report.unavailableSectionFocus = await send({ action: 'focusArticleWorkspaceSource',
      target: { kind: 'section', sectionId: unavailableSection.sectionId } });
    assert.equal(report.unavailableSectionFocus.focused, false);
    assert.equal(report.unavailableSectionFocus.citationResult.reasonCode, 'PDF_FOCUS_RANGE_UNAVAILABLE');
  }
  const distant = occurrences.find(item => item.pageNumbers[0] > 5);
  assert.ok(distant);
  report.farFocus = await send({ action: 'focusArticleWorkspaceSource', target: { kind: 'highlight', highlightId: distant.highlightId } });
  assert.equal(report.farFocus.focused, true);
  assert.equal(report.farFocus.citationResult.pageNumber, distant.pageNumbers[0]);
  await reader.waitForFunction(page => [...document.querySelectorAll('.pdf-native-page')]
    .some(node => Number(node.dataset.pdfPageNumber) === page && node.querySelector('.pdf-native-regex-hit')), distant.pageNumbers[0]);
  report.afterScroll = await reader.evaluate(() => ({
    count: buildArticleWorkspaceSnapshot().highlightDistribution.totalHighlights,
    firstPageRects: document.querySelectorAll('.pdf-native-page[data-pdf-page-number="1"] .pdf-native-regex-hit').length,
    renderedRects: document.querySelectorAll('.pdf-native-regex-hit').length
  }));
  assert.equal(report.afterScroll.count, 112);
  const oldId = distant.highlightId;
  const replacedId = oldId.replace('6980dbe19945fd36ccd200841d8204a22c75404faedd432db23dbb0a70cef5f1', 'b'.repeat(64));
  report.staleFocus = await send({ action: 'focusArticleWorkspaceSource', target: { kind: 'highlight', highlightId: replacedId } });
  assert.equal(report.staleFocus.focused, false);
  report.visibility = await reader.evaluate(() => {
    const sample = document.querySelector('.pdf-native-regex-hit');
    const get = () => ({ background: getComputedStyle(sample).backgroundColor, shadow: getComputedStyle(sample).boxShadow });
    setHighlightSourceVisibility(['llm', 'manual']); const hidden = get();
    setHighlightSourceVisibility(['regex', 'llm', 'manual']); const visible = get();
    return { hidden, visible };
  });
  assert.equal(report.visibility.hidden.shadow, 'none');
  assert.notEqual(report.visibility.visible.shadow, 'none');
  report.virtualization = await reader.evaluate(async page => {
    const bridge = globalThis.__brevessPdfReaderBridge;
    const sample = () => ({ total: buildArticleWorkspaceSnapshot().highlightDistribution.totalHighlights,
      rects: document.querySelectorAll(`.pdf-native-page[data-pdf-page-number="${page}"] .pdf-native-regex-hit`).length });
    setHighlightSourceVisibility(['llm', 'manual']);
    globalThis.__brevessNativePdfDocument.focusPage(23);
    await bridge.command('updatePageWindow', 23, 23); const unmounted = sample();
    globalThis.__brevessNativePdfDocument.focusPage(page);
    await bridge.command('updatePageWindow', page, page); const remounted = sample();
    const mark = document.querySelector(`.pdf-native-page[data-pdf-page-number="${page}"] .pdf-native-regex-hit`);
    const hiddenAfterRemount = mark && getComputedStyle(mark).boxShadow === 'none';
    setHighlightSourceVisibility(['regex', 'llm', 'manual']);
    return { unmounted, remounted, hiddenAfterRemount };
  }, distant.pageNumbers[0]);
  assert.equal(report.virtualization.unmounted.total, 112);
  assert.equal(report.virtualization.unmounted.rects, 0);
  assert.equal(report.virtualization.remounted.total, 112);
  assert.ok(report.virtualization.remounted.rects > 0);
  assert.equal(report.virtualization.hiddenAfterRemount, true);
  await reader.screenshot({ path: path.join(out, 'pdf-highlights-far-page.png') });
  report.clear = await send({ action: 'clearHighlight' });
  report.afterClear = await reader.evaluate(() => buildArticleWorkspaceSnapshot().highlightDistribution.totalHighlights);
  assert.equal(report.afterClear, 0);
  report.clearedFocus = await send({ action: 'focusArticleWorkspaceSource', target: { kind: 'highlight', highlightId: oldId } });
  assert.equal(report.clearedFocus.focused, false);
  report.recordFixtures = await reader.evaluate(async occurrence => {
    const native = globalThis.__brevessNativePdfDocument;
    const identity = { documentHash: native.structure.documentHash, documentGeneration: native.documentGeneration };
    const item = { locator: occurrence.locator, quote: occurrence.quote,
      pageNumbers: occurrence.pageNumbers, paragraphId: occurrence.paragraphId };
    const category = { categoryId: 'method', categoryName: 'Fixture LLM method', color: '#A03030', confidence: 1 };
    const llm = { ...identity, analysisMeta: { readingViewId: 'r15-llm-fixture', ...identity }, categoryMap: {},
      items: [{ ...item, categories: [category], primary: category }] };
    const semantic = { ...identity, turnId: 'r15-semantic-fixture', items: [{ ...item,
      categoryId: 'semantic_match', categoryName: 'Fixture saved semantic', color: '#30A030' }] };
    nativePdfLlmHighlightsByMode.set('r15-llm-fixture', llm);
    nativePdfSemanticChatHighlightsByTurn.set('r15-semantic-fixture', semantic);
    paintNativePdfLlmPage(llm, occurrence.pageNumbers[0]);
    paintNativePdfSemanticChatPage(semantic, occurrence.pageNumbers[0]);
    const projection = globalThis.__brevessPdfReaderBridge.command('getPageProjection', occurrence.pageNumbers[0]);
    const raw = resolvePdfSemanticHighlightLocator(occurrence.locator).ranges.find(range => range.pageNumber === occurrence.pageNumbers[0]);
    const text = SciLLM.readPdfTextProjection(projection.textLayer, { mode: 'raw-offset' });
    const range = SciLLM.pdfProjectionRange(text, raw, document);
    const pdfAnchor = SciLLM.createPdfSelectionAnchor({ pageNumber: occurrence.pageNumbers[0],
      documentHash: identity.documentHash, contextHash: 'r15-explicit-record-fixture', quote: raw.quote,
      viewport: projection.viewport, pageRect: projection.pageElement.getBoundingClientRect(),
      clientRects: [...range.getClientRects()] });
    const original = currentManualDocument;
    const annotation = { annotationId: 'r15-manual-fixture', categoryId: 'method', quote: raw.quote,
      categorySnapshot: { name: 'Fixture manual method', color: '#3030A0' }, pdfAnchor,
      startOffset: raw.start, endOffset: raw.end, blockFingerprint: 'fixture-page', note: 'fixture note' };
    currentManualDocument = { ...original, record: { ...original.record, annotations: [annotation] } };
    publishNativePdfAnnotations();
    const snapshot = buildArticleWorkspaceSnapshot().highlightDistribution;
    const sample = () => Object.fromEntries([
      ['llm', '.pdf-native-automatic-hit[data-analysis-mode-id="r15-llm-fixture"]'],
      ['semantic', '.pdf-native-semantic-chat-hit[data-analysis-mode-id="r15-semantic-fixture"]'],
      ['manual', '.pdf-native-annotation-hit[data-annotation-id="r15-manual-fixture"]']
    ].map(([name, selector]) => { const mark = document.querySelector(selector); return [name,
      { count: document.querySelectorAll(selector).length, shadow: mark ? getComputedStyle(mark).boxShadow : null }]; }));
    setHighlightSourceVisibility(['regex', 'manual']); const llmHidden = sample();
    setHighlightSourceVisibility(['regex', 'llm']); const manualHidden = sample();
    setHighlightSourceVisibility(['regex', 'llm', 'manual']);
    const result = { explicitFixture: true, realModelOutput: false, total: snapshot.totalHighlights,
      sourceCounts: snapshot.sourceCounts, quotes: snapshot.rows.flatMap(row => Object.values(row.cells).flatMap(cell => cell.items.map(item => item.quote))),
      llmHidden, manualHidden };
    clearLlmHighlights('r15-llm-fixture'); clearNativePdfSemanticChatHighlights('r15-semantic-fixture');
    currentManualDocument = original; publishNativePdfAnnotations();
    return result;
  }, distant);
  assert.equal(report.recordFixtures.total, 3);
  assert.deepEqual(report.recordFixtures.sourceCounts, { manual: 1, llm: 1, regex: 0, other: 1 });
  assert.ok(report.recordFixtures.quotes.every(Boolean));
  assert.equal(report.recordFixtures.llmHidden.llm.shadow, 'none');
  assert.notEqual(report.recordFixtures.llmHidden.semantic.shadow, 'none');
  assert.notEqual(report.recordFixtures.llmHidden.manual.shadow, 'none');
  assert.equal(report.recordFixtures.manualHidden.semantic.shadow, 'none');
  assert.equal(report.recordFixtures.manualHidden.manual.shadow, 'none');
  assert.notEqual(report.recordFixtures.manualHidden.llm.shadow, 'none');
  assert.ok(Object.values(report.recordFixtures.llmHidden).every(item => item.count > 0));
  report.status = 'PASS';
} catch (error) { report.failure = error.stack; process.exitCode = 1; }
finally {
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await context?.close();
  const resolved = path.resolve(profile), tempRoot = path.resolve(os.tmpdir()) + path.sep;
  if (resolved.startsWith(tempRoot) && path.basename(resolved).startsWith('brevess-r15-pdf-excerpt-')) fs.rmSync(resolved, { recursive: true, force: true });
}
