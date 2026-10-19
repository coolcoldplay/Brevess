const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { chromium } = require('playwright');
const sourceRoot = path.resolve(__dirname, '../..');
const content = fs.readFileSync(path.join(sourceRoot, 'content.js'), 'utf8');
const popup = fs.readFileSync(path.join(sourceRoot, 'popup.js'), 'utf8');
function fn(source, name) {
  const match = new RegExp('(?:async )?function ' + name + '\\(').exec(source);
  assert.ok(match, name);
  const tail = source.slice(match.index), next = /\n(?:async )?function /u.exec(tail.slice(1));
  return tail.slice(0, next ? next.index + 1 : undefined);
}
const annotation = { annotationId: 'manual-A', quote: 'Source quote', prefix: 'before', suffix: 'after',
  blockFingerprint: 'block-A', startOffset: 0, endOffset: 12, note: '人工判断\n下一步',
  categoryId: 'result', categorySnapshot: { name: '结果', color: '#112233' },
  privatePath: 'C:\\private\\paper.pdf' };
const record = { documentId: 'sha256:' + 'a'.repeat(64), title: '来源论文',
  canonicalUrl: 'https://example.org/paper?secret=private#page=1', doi: '10.1000/example', annotations: [annotation] };
const context = { tabId: 1, documentKey: 'file:///C:/private/paper.pdf',
  workspaceId: 'workspace:' + 'b'.repeat(64), workspaceGeneration: 2,
  workspaceContentHash: 'c'.repeat(64), workspaceCanonicalUrl: 'https://example.org/paper?secret=private#p' };
const descriptor = { scope: 'panel', figureId: 'fig-1', panelId: 'A', field: 'note' };

test('note sharing projects only authored text and allowed source fields with stable identities', () => {
  const env = { URL, buildFigureWorkspaceEditTarget: c => ({ workspaceId: c.workspaceId,
    workspaceGeneration: c.workspaceGeneration, contentHash: c.workspaceContentHash, canonicalUrl: c.workspaceCanonicalUrl }) };
  vm.createContext(env);
  vm.runInContext(fn(content, 'buildManualNoteSharingRequest') + '\n' + fn(popup, 'buildPanelNoteSharingRequest'), env);
  const before = JSON.stringify(record);
  const a = env.buildManualNoteSharingRequest(record, annotation, 'd'.repeat(64));
  const b = env.buildManualNoteSharingRequest({ ...record, title: 'changed' }, { ...annotation, note: '' }, 'd'.repeat(64));
  assert.equal(a.localKey, b.localKey);
  assert.equal(b.text, '');
  assert.equal(a.text, annotation.note);
  assert.equal(a.source.url, 'https://example.org/paper');
  assert.deepEqual(Object.keys(a.source).sort(), ['annotationId', 'blockFingerprint', 'documentHash', 'doi', 'endOffset', 'prefix', 'quote', 'startOffset', 'suffix', 'url']);
  assert.equal(a.source.quote, annotation.quote);
  assert.doesNotMatch(JSON.stringify(a), /privatePath|secret|C:\\\\/);
  assert.equal(JSON.stringify(record), before);
  assert.notEqual(a.localKey, env.buildManualNoteSharingRequest(record, { ...annotation, annotationId: 'manual-B' }, 'd'.repeat(64)).localKey);
  const p = env.buildPanelNoteSharingRequest(context, descriptor, '');
  assert.equal(p.text, '');
  assert.equal(p.source.documentHash, context.workspaceContentHash);
  assert.equal(p.source.url, 'https://example.org/paper');
  assert.doesNotMatch(JSON.stringify(p), /file:|private|snapshot/);
  assert.notEqual(p.localKey, env.buildPanelNoteSharingRequest({ ...context, workspaceGeneration: 3 }, descriptor, '').localKey);
  assert.notEqual(p.localKey, env.buildPanelNoteSharingRequest(context, { ...descriptor, panelId: 'B' }, '').localKey);
  const bounded = env.buildManualNoteSharingRequest(record, { ...annotation, quote: 'x'.repeat(1000), prefix: 'p'.repeat(200), suffix: 's'.repeat(200) });
  assert.equal(bounded.source.quote.length, 500);
  assert.equal(bounded.source.prefix.length, 120);
  assert.equal(bounded.source.suffix, '');
  assert.equal(bounded.source.endOffset - bounded.source.startOffset, 500);
});

test('reader source navigation rejects other document versions and ambiguous locations', () => {
  const manual = require(path.join(sourceRoot, 'core/manual-annotations.js'));
  const element = { isConnected: true, scrollIntoView() {}, classList: { add() {}, remove() {} } };
  const block = { blockId: 'p1', blockFingerprint: 'block-A', text: annotation.quote, element };
  const env = { currentManualDocument: { documentHash: 'a'.repeat(64) }, currentManualBlocks: [block],
    SciLLM: manual, manualReadableText: () => annotation.quote, setTimeout: () => {} };
  vm.createContext(env);
  vm.runInContext(fn(content, 'sharedNoteDocumentHash') + '\n' + fn(content, 'locateSharedHighlightNote'), env);
  assert.equal(env.locateSharedHighlightNote({ ...annotation, documentHash: 'b'.repeat(64) }), null);
  assert.equal(env.locateSharedHighlightNote({ ...annotation, documentHash: 'a'.repeat(64) }), block);
  env.currentManualBlocks.push({ ...block, blockId: 'p2' });
  assert.equal(env.locateSharedHighlightNote({ ...annotation, documentHash: 'a'.repeat(64) }), null);
});

test('explicit navigation and newer navigation intent survive a stale persisted UI snapshot', async () => {
  async function run(sourceText, options, changedWhilePending = false) {
    const restored = []; let resolveResponse;
    const response = new Promise(resolve => { resolveResponse = resolve; });
    const env = { workspaceRefreshSequence: 0, workspaceNavigationIntentRevision: 1,
      currentWorkspaceSnapshot: {}, activePanelTabContext: { pdfMode: false }, SciLLM: {},
      articleChatHistoryPageSize: 10, articleChatVisibleTurnCount: 10,
      capturePanelContext: () => ({ tabId: 1, key: 'source-A', pdfMode: false }), isCurrentPanelContext: () => true,
      sendTabMessage: () => response, mergeRefreshedFigureCatalog: value => value,
      updatePopupPdfSemanticNavigation() {}, renderArticleWorkspaceSnapshot: value => value,
      restoreSnapshotSidePanelUiState: value => restored.push(value.activeWorkspaceView),
      restoreMechanismGenerationFromLiveSnapshot() {}, resumeFigureProgressFromWorkspaceSnapshot() {} };
    vm.createContext(env); vm.runInContext(fn(sourceText, 'performArticleWorkspaceRefresh'), env);
    const pending = env.performArticleWorkspaceRefresh(options);
    if (changedWhilePending) env.workspaceNavigationIntentRevision++;
    resolveResponse({ success: true, snapshot: { documentHash: 'a'.repeat(64) }, sidePanelUiState: { activeWorkspaceView: 'highlights' } });
    assert.ok(await pending); return restored;
  }
  assert.deepEqual(await run(popup, {}), ['highlights'], 'initialization still restores saved UI');
  assert.deepEqual(await run(popup, { preserveUiState: true }), [], 'explicit navigation remains authoritative');
  assert.deepEqual(await run(popup, {}, true), [], 'pending pre-navigation refresh cannot restore an obsolete view');
  // Original R36 statement reproduces the bug against exactly the same delayed response.
  const oldStatement = popup.replace(/if \(!preserveUiState && navigationIntentRevision === workspaceNavigationIntentRevision\) \{\s*restoreSnapshotSidePanelUiState\(response.sidePanelUiState\);\s*\}/u,
    'restoreSnapshotSidePanelUiState(response.sidePanelUiState);');
  assert.deepEqual(await run(oldStatement, { preserveUiState: true }), ['highlights'], 'old bytes overwrite the new figures selection');
});

test('a delayed public-note state read cannot re-enable a newly closed switch', async () => {
  let resolveResponse;
  const response = new Promise(resolve => { resolveResponse = resolve; });
  const toggle = { checked: true, disabled: false };
  const env = { document: { getElementById: () => toggle }, sharingHighlightControlRevision: 0,
    capturePanelContext: () => ({ tabId: 1 }), isCurrentPanelContext: () => true, sendTabMessage: () => response };
  vm.createContext(env); vm.runInContext(fn(popup, 'syncSharedHighlightNoteControls').split("\ndocument.addEventListener('DOMContentLoaded'")[0], env);
  const pending = env.syncSharedHighlightNoteControls();
  env.sharingHighlightControlRevision++; toggle.checked = false;
  resolveResponse({ success: true, enabled: true }); await pending;
  assert.equal(toggle.checked, false);
  env.sendTabMessage = async () => ({ success: true, enabled: true });
  await env.syncSharedHighlightNoteControls(); assert.equal(toggle.checked, true, 'fresh read still restores actual state');
});

test('legacy notes retain manual metadata and blanks through existing source normalization', () => {
  const manual = require(path.join(sourceRoot, 'core/manual-annotations.js'));
  const figure = require(path.join(sourceRoot, 'core/figure-workspace.js'));
  const old = { ...annotation, note: '' };
  const result = manual.normalizeManualAnnotation(old);
  assert.equal(result.note, '');
  assert.equal(result.privatePath, old.privatePath);
  assert.equal(result.blockFingerprint, old.blockFingerprint);
  const draft = figure.createFigureWorkspaceDraft([{ figureId: 'fig-1', figureLabel: '1', panels: [{ panel: 'A' }] }]);
  const changed = figure.applyFigureWorkspaceMutation(draft, { type: 'set_panel_field',
    figureId: 'fig-1', panelId: 'A', field: 'note', value: '', expectedRevision: draft.revision }, 1234);
  assert.equal(changed.figures['fig-1'].panels.A.note.value, '');
  assert.equal(changed.figures['fig-1'].panels.A.note.humanReviewed, true);
  assert.equal(changed.figures['fig-1'].panels.A.note.editedAt, 1234);
  assert.doesNotMatch(fn(content, 'appendManualNoteSharingControls'), /ANNOTATION_UPSERT|saveManualAnnotation\(/);
  assert.doesNotMatch(fn(popup, 'appendPanelNoteSharingControl'), /set_panel_field|mutateFigureWorkspace/);
  assert.match(fn(content, 'showManualSelectionToolbar'), /appendManualNoteSharingControls\(noteSharing/);
  assert.match(fn(popup, 'appendFigureWorkspaceViewField'), /field\?\.key === 'note'.*appendPanelNoteSharingControl/);
});

test('real browser note controls preserve edits, reject stale source, handle per-note visibility and reopen', async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const evidenceDir = path.join(__dirname, 'evidence');
  fs.mkdirSync(evidenceDir, { recursive: true });
  try {
    const page = await browser.newPage({ viewport: { width: 400, height: 700 } });
    await page.route('**/*', route => route.abort());
    await page.setContent('<main><section id="sci-manual-toolbar" class="sci-selection-surface"><h3>高亮备注</h3><textarea id="note"></textarea><div id="sharing" class="sci-selection-note-sharing-controls"></div></section><section id="panel"><h3>Panel 笔记</h3></section><p id="status" role="status"></p></main>');
    await page.addStyleTag({ path: path.join(sourceRoot, 'content.css') });
    await page.addStyleTag({ path: path.join(sourceRoot, 'popup.css') });
    await page.addStyleTag({ content: 'body{padding:16px;margin:0;font-family:Arial}#sci-manual-toolbar{position:static!important;width:auto!important;max-width:100%;transform:none!important}#panel{margin-top:20px}textarea{width:100%;box-sizing:border-box}main{max-width:360px}' });
    await page.evaluate(({ record, context, descriptor }) => {
      window.currentManualDocument = { documentId: record.documentId, documentHash: 'd'.repeat(64), record };
      window.manualAnnotationById = id => currentManualDocument.record.annotations.find(row => row.annotationId === id);
      window.calls = []; window.localState = {}; window.nextVisibility = 'group'; window.sourceCurrent = true; window.editing = { active: null };
      window.BrevessSharing = {
        getLocalState: async key => localState[key] || { visibility: 'private' },
        open: async request => { calls.push(structuredClone(request)); localState[request.localKey] = { visibility: nextVisibility }; return { status: 'saved' }; }
      };
      window.surface = { annotations: structuredClone(record.annotations), validSource: () => sourceCurrent };
      window.announce = text => { document.querySelector('#status').textContent = text; };
      window.showStatus = announce;
      window.fixtureContext = context; window.fixtureDescriptor = descriptor;
      window.captureFigureWorkspaceEditContext = () => ({ ...fixtureContext });
      window.isCurrentFigureWorkspaceEditContext = () => sourceCurrent;
      window.buildFigureWorkspaceEditTarget = c => ({ workspaceId: c.workspaceId, workspaceGeneration: c.workspaceGeneration,
        contentHash: c.workspaceContentHash, canonicalUrl: c.workspaceCanonicalUrl });
      window.figureWorkspaceInlineEditController = { getState: () => editing };
      window.createWorkspaceElement = (tag, cls, text) => { const el = document.createElement(tag); el.className = cls || ''; el.textContent = text || ''; return el; };
      window.figureWorkspaceEditDescriptorKey = d => JSON.stringify(d);
      window.openFigureWorkspaceInlineEditor = () => {};
      document.querySelector('#note').value = record.annotations[0].note;
    }, { record, context, descriptor });
    await page.addScriptTag({ content: [
      fn(content, 'manualAnnotationSourceIdentity'), fn(content, 'buildManualNoteSharingRequest'),
      fn(content, 'appendManualNoteSharingControls'), fn(popup, 'buildPanelNoteSharingRequest'),
      fn(popup, 'appendPanelNoteSharingControl'), fn(popup, 'appendFigureWorkspaceViewField')
    ].join('\n') });
    await page.evaluate(() => {
      appendManualNoteSharingControls(document.querySelector('#sharing'), surface, document.querySelector('#note'), announce);
      appendFigureWorkspaceViewField(document.querySelector('#panel'), { key: 'note', label: '人工笔记', value: '' }, fixtureDescriptor);
    });
    assert.equal(await page.locator('.sci-selection-note-sharing').count(), 1);
    assert.match(await page.locator('.sci-selection-note-sharing').textContent(), /仅个人可见/);
    await page.locator('#note').fill('尚未保存');
    await page.locator('.sci-selection-note-sharing').click();
    assert.equal(await page.evaluate(() => calls.length), 0);
    assert.match(await page.locator('#status').textContent(), /先保存/);
    assert.equal(await page.locator('#note').inputValue(), '尚未保存');
    await page.locator('#note').fill(annotation.note);
    await page.locator('.sci-selection-note-sharing').click();
    assert.equal(await page.evaluate(() => calls[0].kind), 'highlight_note');
    assert.match(await page.locator('.sci-selection-note-sharing').textContent(), /课题组内共享/);
    await page.evaluate(() => { sourceCurrent = false; });
    await page.locator('.workspace-panel-note-sharing').click();
    assert.equal(await page.evaluate(() => calls.length), 1);
    assert.match(await page.locator('#status').textContent(), /文献已变化/);
    await page.evaluate(() => { sourceCurrent = true; editing = { active: { dirty: true } }; });
    await page.locator('.workspace-panel-note-sharing').click();
    assert.equal(await page.evaluate(() => calls.length), 1);
    await page.evaluate(() => { editing = { active: null }; });
    await page.locator('.workspace-panel-note-sharing').click();
    assert.equal(await page.evaluate(() => calls[1].text), '');
    assert.equal(await page.evaluate(() => calls[1].kind), 'panel_note');
    await page.evaluate(() => {
      currentManualDocument.record.annotations[0].note = '';
      document.querySelector('#note').value = '';
      surface.annotations = structuredClone(currentManualDocument.record.annotations);
      appendManualNoteSharingControls(document.querySelector('#sharing'), surface, document.querySelector('#note'), announce);
    });
    await page.locator('.sci-selection-note-sharing').click();
    assert.equal(await page.evaluate(() => calls[2].text), '');
    assert.equal(await page.evaluate(() => calls[2].localKey === calls[0].localKey), true);
    await page.evaluate(() => {
      const second = { ...currentManualDocument.record.annotations[0], annotationId: 'manual-B' };
      currentManualDocument.record.annotations.push(second); surface.annotations.push(second);
      appendManualNoteSharingControls(document.querySelector('#sharing'), surface, document.querySelector('#note'), announce);
    });
    assert.equal(await page.locator('.sci-selection-note-sharing').count(), 2);
    await page.locator('[data-annotation-id="manual-B"]').click();
    assert.notEqual(await page.evaluate(() => calls[3].localKey), await page.evaluate(() => calls[0].localKey));
    await page.evaluate(() => { nextVisibility = 'public'; });
    await page.locator('[data-annotation-id="manual-B"]').click();
    assert.match(await page.locator('[data-annotation-id="manual-B"]').textContent(), /公开/);
    await page.evaluate(() => { nextVisibility = 'private'; });
    await page.locator('[data-annotation-id="manual-B"]').click();
    assert.match(await page.locator('[data-annotation-id="manual-B"]').textContent(), /仅个人可见/);
    await page.evaluate(() => { currentManualDocument.record.annotations[0].blockFingerprint = 'changed-source'; });
    await page.locator('[data-annotation-id="manual-A"]').click();
    assert.equal(await page.evaluate(() => calls.length), 6);
    assert.match(await page.locator('#status').textContent(), /标注来源已变化/);
    await page.evaluate(() => { document.querySelector('#status').textContent = ''; });
    await page.screenshot({ path: path.join(evidenceDir, 'notes-controls.png'), fullPage: true });
    fs.writeFileSync(path.join(evidenceDir, 'notes-controls-report.json'), JSON.stringify({
      status: 'PASS', boundary: 'Extracted production renderer functions in isolated Edge; sharing transport mocked, no real notes',
      checks: ['private default', 'unsaved edit retained and rejected', 'group label refresh', 'stale source rejected',
        'active edit rejected', 'blank Panel note preserved', 'cleared highlight retained', 'reopen stable key',
        'each annotation independently keyed', 'public and private labels', 'changed annotation anchor rejected'],
      requests: await page.evaluate(() => calls.map(({ kind, text, localKey, source }) => ({ kind, text, localKey, source })))
    }, null, 2));
  } finally { await browser.close(); }
});
