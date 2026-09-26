const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'popup.js'), 'utf8');
function fn(name, deps = {}) {
  let start = source.indexOf(`function ${name}(`); assert.ok(start >= 0, name);
  if (source.slice(start - 6, start) === 'async ') start -= 6;
  const next = source.slice(start + 1).search(/\n(?:async )?function /u);
  return Function(...Object.keys(deps), `return (${source.slice(start, next < 0 ? source.length : start + 1 + next).trim()});`)(...Object.values(deps));
}
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function guard() { let pending; return { isPending: () => Boolean(pending), run: task => { if (pending) return pending; pending = Promise.resolve().then(task); pending.then(() => { pending = null; }, () => { pending = null; }); return pending; } }; }
function element(text = '') { const attrs = new Map(); return { textContent: text, disabled: false, hidden: false, setAttribute: (k,v) => attrs.set(k,v), getAttribute: k => attrs.get(k) ?? null, removeAttribute: k => attrs.delete(k) }; }
function uiHarness() {
  const elements = Object.fromEntries(['loadArticleArchive','scanArticleWorkspace','reanalyzeArticle','articleArchivePrompt','articleArchivePromptSummary'].map(id => [id, element(id === 'loadArticleArchive' ? '加载上次结果' : id)]));
  let current = true; let requests = 0; let probe = { found: true, figureCount: 14 };
  const getProbe = () => probe;
  const context = { tabId: 4 };
  // Accessors let the production function read the actual current probe binding.
  const deps = { articleWorkspaceRestoreGuard: guard(), capturePanelContext: () => context,
    isCurrentPanelContext: () => current, beginArticleWorkspaceDirectoryPermissionRequest: () => { requests++; return 'ticket'; },
    document: { getElementById: id => elements[id] },
    setArticleArchivePrompt: value => { probe = value; }, currentArticleArchiveProbe: probe };
  return { elements, deps, getProbe, navigate: () => { current = false; }, requests: () => requests };
}
test('ARCH-009 load and scan share one operation and disable both triggers plus reanalysis', async () => {
  const h = uiHarness(); const wait = deferred(); let calls = 0;
  const run = fn('runArticleWorkspaceRestoreAction', h.deps);
  const first = run(async ({ panelContext, permissionTicket }) => { calls++; assert.equal(panelContext.tabId, 4); assert.equal(permissionTicket, 'ticket'); await wait.promise; return 'restored'; });
  const second = run(async () => { throw Error('duplicate restore'); });
  await Promise.resolve();
  assert.equal(calls, 1); assert.equal(h.requests(), 1);
  for (const id of ['loadArticleArchive','scanArticleWorkspace','reanalyzeArticle']) { assert.equal(h.elements[id].disabled, true); assert.equal(h.elements[id].getAttribute('aria-busy'), 'true'); }
  wait.resolve(); assert.equal(await first, 'restored'); assert.equal(await second, 'restored');
  for (const id of ['loadArticleArchive','scanArticleWorkspace','reanalyzeArticle']) { assert.equal(h.elements[id].disabled, false); assert.equal(h.elements[id].getAttribute('aria-busy'), null); }
});
test('ARCH-009 restore action releases controls after errors and preserves previously disabled controls', async () => {
  const h = uiHarness(); h.elements.reanalyzeArticle.disabled = true;
  const run = fn('runArticleWorkspaceRestoreAction', h.deps);
  await assert.rejects(run(async () => { throw Error('fixture failure'); }), /fixture failure/);
  assert.equal(h.elements.loadArticleArchive.disabled, false); assert.equal(h.elements.reanalyzeArticle.disabled, true);
});
test('ARCH-009 navigation before the scheduled action starts prevents restore work', async () => {
  const h = uiHarness(); const run = fn('runArticleWorkspaceRestoreAction', h.deps); let calls = 0;
  const pending = run(async () => { calls++; }); h.navigate(); await pending;
  assert.equal(calls, 0);
});
test('ARCH-009 archive prompt shows pending or failed verification without promising full recovery', () => {
  const h = uiHarness();
  const render = fn('setArticleArchivePrompt', { document: h.deps.document, currentArticleArchiveProbe: null });
  render({ found: true, figureCount: 14, restoreState: 'loading' });
  assert.match(h.elements.articleArchivePromptSummary.textContent, /14/);
  assert.match(h.elements.articleArchivePromptSummary.textContent, /正在.*核验|正在.*加载/);
  render({ found: true, figureCount: 14, restoreState: 'failed', restoreError: '身份校验未通过（ARTICLE_WORKSPACE_RESTORE_TARGET_MISMATCH）' });
  assert.match(h.elements.articleArchivePromptSummary.textContent, /身份校验未通过/);
  assert.doesNotMatch(h.elements.articleArchivePromptSummary.textContent, /可加载上次结果/);
});
test('ARCH-009 identity and receipt failures have distinct Chinese explanations and technical details', () => {
  const describe = fn('describeArticleWorkspaceRestoreError');
  const identity = describe(new Error('ARTICLE_WORKSPACE_RESTORE_TARGET_MISMATCH'));
  const receipt = describe(new Error('ARTICLE_RESTORE_RECEIPT_INVALID'));
  assert.match(identity, /身份|授权/); assert.match(identity, /ARTICLE_WORKSPACE_RESTORE_TARGET_MISMATCH/);
  assert.match(receipt, /回执/); assert.match(receipt, /ARTICLE_RESTORE_RECEIPT_INVALID/);
  assert.doesNotMatch(receipt, /未改任何|数据已丢失/);
});

test('ARCH-009 both public triggers enter the shared restore guard', async () => {
  for (const [name, inner] of [['loadCurrentArticleArchive', 'loadArticleArchiveForContext'], ['scanCurrentArticleWorkspace', 'scanArticleWorkspaceForContext']]) {
    const operation = () => 'fixture'; let received;
    const run = fn(name, { [inner]: operation, runArticleWorkspaceRestoreAction: task => { received = task; return task(); } });
    assert.equal(await run(), 'fixture'); assert.strictEqual(received, operation);
  }
});

test('ARCH-009 a legacy scan reuses its context directly without reacquiring the pending guard', async () => {
  const context = { tabId: 4 }; let calls = 0;
  const scan = fn('scanArticleWorkspaceForContext', {
    assertArticleWorkspaceRestorePanelReady: fn('assertArticleWorkspaceRestorePanelReady', {
      hasArticleWorkspaceRestorePanelDrafts: () => false
    }),
    currentArticleArchiveIdentity: () => ({documentId:'doc:paper'}),
    isCurrentPanelContext: () => true, currentArticleArchiveProbe: null,
    resolveArticleWorkspaceDirectoryPermission: async () => 'granted',
    sendTabMessage: async () => ({ success: true, workspace: { workspaceId: 'paper' } }),
    sendLlmMessage: async () => ({ permission: 'granted', matches: [{ match: 'legacy-imported' }] }),
    loadArticleArchiveForContext: async args => { calls++; assert.strictEqual(args.panelContext, context); assert.equal(args.permissionTicket, 'ticket'); return 'legacy'; }
  });
  assert.equal(await scan({ panelContext: context, permissionTicket: 'ticket' }), 'legacy');
  assert.equal(calls, 1);
});

test('ARCH-009 navigation during a legacy archive read prevents late application', async () => {
  let current = true; let applied = 0;
  const load = fn('loadArticleArchiveForContext', {
    currentArticleArchiveIdentity: () => ({ documentId: 'doc:paper' }),
    isCurrentPanelContext: () => current, currentArticleArchiveProbe: null,
    restoreCurrentArticleWorkspaceFromDirectory: async () => null,
    sendLlmMessage: async () => { current = false; return { archive: {} }; },
    applyLoadedArticleArchive: async () => { applied++; }
  });
  await load({ panelContext: { tabId: 4 }, permissionTicket: null });
  assert.equal(applied, 0);
});

test('ARCH-009 legacy application refuses a different target tab after the archive read', async () => {
  let ensured = 0;
  const apply = fn('applyLoadedArticleArchive', {
    isCurrentPanelContext: () => true,
    currentArticleArchiveIdentity: () => ({ documentId: 'doc:paper' }),
    queryPanelTargetTab: async () => ({ id: 5 }),
    sendTabMessage: async () => { ensured++; }
  });
  assert.equal(await apply({}, { panelContext: { tabId: 4 } }), null);
  assert.equal(ensured, 0);
});

for (const stage of ['before', 'manual-refresh', 'workspace-refresh']) {
  test(`ARCH-009 committed presentation leaves the new paper untouched on navigation ${stage}`, async () => {
    let current = stage !== 'before'; const changes = [];
    const present = fn('presentCommittedArticleRestoreResult', {
      describeCommittedArticleRestore: () => ({ message: 'Partial commit', type: 'warning' }),
      isCurrentPanelContext: () => current,
      applyRestoredSidePanelUiState: () => changes.push('ui'),
      refreshManualAnnotationSummary: async () => { if (stage === 'manual-refresh') current = false; },
      refreshArticleWorkspace: async () => { if (stage === 'workspace-refresh') current = false; },
      setArticleArchivePrompt: () => changes.push('card'), showStatus: () => changes.push('status'), t: value => value
    });
    await present({ committed: true }, { panelContext: { tabId: 4 }, tabId: 4, uiState: { view: 'figures' } });
    assert.deepEqual(changes, stage === 'before' ? [] : ['ui']);
  });
}
