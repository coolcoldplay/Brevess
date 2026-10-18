const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {
  normalizeLiteratureNoteDocumentState: normalizeCoreLiteratureNoteDocumentState
} = require('../core/reading-tools.js');
const ManualAnnotations = require('../core/manual-annotations.js');
const EvidenceFirstMechanism = require('../core/evidence-first-mechanism.js');
const FigureWorkspace = require('../core/figure-workspace.js');

function read(file) {
  return fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
}

function loadPopupUiHelpers() {
  const script = read('popup.js');
  const startMarker = '// DOM-independent popup UI helpers: start';
  const endMarker = '// DOM-independent popup UI helpers: end';
  const start = script.indexOf(startMarker);
  const end = script.indexOf(endMarker);
  assert.notEqual(start, -1, 'popup UI helper start marker should exist');
  assert.notEqual(end, -1, 'popup UI helper end marker should exist');
  const context = {};
  vm.runInNewContext(
    `${script.slice(start + startMarker.length, end)}\n` +
      'globalThis.popupUiHelpers = PopupUiHelpers;',
    context
  );
  return context.popupUiHelpers;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function executablePopupFunction(name, dependencies = {}) {
  const script = read('popup.js');
  let start = script.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} must be defined in popup.js`);
  if (script.slice(Math.max(0, start - 6), start) === 'async ') start -= 6;
  const signatureEnd = script.indexOf(') {', start);
  assert.ok(signatureEnd >= 0, `${name} must have a standard function signature`);
  const bodyStart = signatureEnd + 2;
  let depth = 0;
  let end = -1;
  for (let index = bodyStart; index < script.length; index += 1) {
    if (script[index] === '{') depth += 1;
    if (script[index] === '}') depth -= 1;
    if (depth === 0) {
      end = index + 1;
      break;
    }
  }
  assert.ok(end > bodyStart, `${name} must have a complete function body`);
  const dependencyNames = Object.keys(dependencies);
  return Function(
    ...dependencyNames,
    `return (${script.slice(start, end)});`
  )(...dependencyNames.map(key => dependencies[key]));
}

function executableContentFunction(name, dependencies = {}) {
  const script = read('content.js');
  let start = script.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} must be defined in content.js`);
  if (script.slice(Math.max(0, start - 6), start) === 'async ') start -= 6;
  const signatureEnd = script.indexOf(') {', start);
  assert.ok(signatureEnd >= 0, `${name} must have a standard function signature`);
  const bodyStart = signatureEnd + 2;
  let depth = 0;
  let end = -1;
  for (let index = bodyStart; index < script.length; index += 1) {
    if (script[index] === '{') depth += 1;
    if (script[index] === '}') depth -= 1;
    if (depth === 0) {
      end = index + 1;
      break;
    }
  }
  assert.ok(end > bodyStart, `${name} must have a complete function body`);
  const dependencyNames = Object.keys(dependencies);
  return Function(
    ...dependencyNames,
    `return (${script.slice(start, end)});`
  )(...dependencyNames.map(key => dependencies[key]));
}

test('archive import can identify a loaded chat workspace before manual annotations initialize', () => {
  const identity = executablePopupFunction('currentArticleArchiveIdentity', {
    manualAnnotationState: { documentId: '', documentHash: '', canonicalUrl: '', title: '' },
    preparedDocumentState: null,
    currentWorkspaceSnapshot: { documentId: 'sha256:current', documentHash: 'hash-current',
      url: 'https://example.org/current', title: 'Current article' }
  });
  assert.deepEqual(identity(), { documentId: 'sha256:current', documentHash: 'hash-current',
    canonicalUrl: 'https://example.org/current', title: 'Current article' });
});

test('archive identity remains unavailable after the panel context has been cleared', () => {
  const identity = executablePopupFunction('currentArticleArchiveIdentity', {
    manualAnnotationState: { documentId: '', documentHash: '', canonicalUrl: '', title: '' },
    preparedDocumentState: null, currentWorkspaceSnapshot: null
  });
  assert.deepEqual(identity(), { documentId: '', documentHash: '', canonicalUrl: '', title: '' });
});

test('committed archive restore failures report the exact post-commit stage without retry semantics', () => {
  const { describeCommittedArticleRestore } = loadPopupUiHelpers();

  assert.deepEqual(plain(describeCommittedArticleRestore({
    success: false,
    committed: true,
    retryable: false,
    durableFigureWorkspace: false,
    receiptRegistered: false,
    postCommitStatus: 'figure-workspace-persistence-failed'
  })), {
    committed: true,
    message: '恢复内容已应用，但图解工作区持久化失败；请勿再次执行恢复。',
    type: 'error'
  });
  assert.deepEqual(plain(describeCommittedArticleRestore({
    success: false,
    committed: true,
    retryable: false,
    postCommitStatus: 'archive-background-commit-failed'
  })), {
    committed: true,
    message: '恢复内容已应用且页面回执已登记，但本地档案提交失败；请勿再次执行恢复。',
    type: 'error'
  });
  assert.deepEqual(plain(describeCommittedArticleRestore({
    success: false,
    committed: true,
    retryable: false,
    postCommitStatus: 'content-reinitialize-proof-failed'
  })), {
    committed: true,
    message: '恢复内容与本地档案已提交，但页面重建后的身份校验失败；请勿再次执行恢复。',
    type: 'error'
  });
  assert.deepEqual(plain(describeCommittedArticleRestore({
    success: false,
    committed: true,
    retryable: false,
    durableFigureWorkspace: true,
    receiptRegistered: false,
    postCommitStatus: 'receipt-registration-failed'
  })), {
    committed: true,
    message: '恢复内容已应用并已持久化，但恢复回执登记失败；请勿再次执行恢复。',
    type: 'error'
  });
  assert.deepEqual(plain(describeCommittedArticleRestore({
    success: false,
    committed: true,
    retryable: false,
    workspaceApplied: false,
    receiptRegistered: false,
    postCommitStatus: 'workspace-commit-failed'
  })), {
    committed: true,
    message: '恢复已进入工作区应用提交阶段，但提交失败且可能已部分写入；请勿再次执行恢复。',
    type: 'error'
  });
  assert.deepEqual(plain(describeCommittedArticleRestore({
    success: false,
    committed: true,
    retryable: false,
    durableFigureWorkspace: true,
    receiptRegistered: false,
    postCommitStatus: 'target-changed-after-persistence'
  })), {
    committed: true,
    message: '恢复内容已应用并已持久化，但页面随后发生变化，恢复回执尚未登记；请勿再次执行恢复。',
    type: 'error'
  });
  assert.equal(describeCommittedArticleRestore({
    success: false, committed: false, retryable: true
  }), null);
  assert.equal(describeCommittedArticleRestore({ success: true, committed: true }), null);
});

test('popup handles a committed restore result before every ordinary restore failure throw', () => {
  const popup = read('popup.js');
  const archive = popup.slice(
    popup.indexOf('async function applyLoadedArticleArchive'),
    popup.indexOf('async function loadCurrentArticleArchive')
  );
  const directory = popup.slice(
    popup.indexOf('async function restoreCurrentArticleWorkspaceFromDirectory'),
    popup.indexOf('async function tryAutoRestoreCurrentArticleWorkspace')
  );
  const scan = popup.slice(
    popup.indexOf('async function scanCurrentArticleWorkspace'),
    popup.indexOf('async function clearCurrentArticleWorkspace')
  );

  for (const source of [archive, directory, scan]) {
    const handled = source.indexOf('describeCommittedArticleRestore(applied)');
    const failed = source.indexOf('if (!applied?.success)');
    assert.ok(handled >= 0 && failed > handled);
  }
  assert.doesNotMatch(archive, /committed[^}]{0,300}throw new Error/);
  assert.match(popup, /workspaceRestore\?\.applied\?\.success \|\|[\s\S]{0,80}workspaceRestore\?\.applied\?\.committed === true/);
  assert.match(popup, /restored\?\.applied\?\.committed !== true/);
});

test('archive restore commits only the current archive identity frozen after ensure', async () => {
  const oldIdentity = {
    documentId: `sha256:${'a'.repeat(64)}`,
    documentHash: `sha256:${'b'.repeat(64)}`,
    canonicalUrl: 'https://example.test/old'
  };
  const frozenIdentity = {
    documentId: `sha256:${'c'.repeat(64)}`,
    documentHash: `sha256:${'d'.repeat(64)}`,
    canonicalUrl: 'https://example.test/current'
  };
  const archive = {
    documentId: `sha256:${'e'.repeat(64)}`,
    documentHash: `sha256:${'f'.repeat(64)}`,
    canonicalUrl: frozenIdentity.canonicalUrl
  };
  let currentIdentity = oldIdentity;
  let releaseEnsure;
  const ensurePending = new Promise(resolve => { releaseEnsure = resolve; });
  let commitMessage = null;
  const messageOrder = [];
  const proof = {
    ...frozenIdentity,
    contentWorldNonce: '1'.repeat(32),
    documentEpoch: 7,
    title: 'Current paper',
    annotationCount: 4,
    unresolvedCount: 1
  };
  const buildTarget = executablePopupFunction('buildArticleArchiveRestoreTarget', {
    currentArticleArchiveIdentity: () => currentIdentity
  });
  const reinitialize = executablePopupFunction('reinitializeCommittedArticleRestore', {
    sendTabMessage: async (_tabId, message) => {
      messageOrder.push(message.action);
      if (message.action === 'reinitializeManualAnnotations') {
        return { success: true, ...proof, operationNonce: 'restore-token' };
      }
      return { success: true, ...proof };
    },
    queryPanelTargetTab: async () => ({ id: 41, url: frozenIdentity.canonicalUrl }),
    SciLLM: ManualAnnotations,
    manualSummarySequence: 0,
    manualAnnotationState: {},
    renderManualAnnotationSummary() {}
  });
  const sendLlmMessage = executablePopupFunction('sendLlmMessage', {
    activePanelTabContext: { tabId: 41 },
    tabContextSequence: 1,
    chrome: {
      runtime: {
        sendMessage: async message => {
          messageOrder.push(message.type);
          commitMessage = message;
          return {
            success: true,
            data: {
              archive,
              applied: true,
              permission: 'imported',
              relativePath: 'archives/current.json'
            }
          };
        }
      }
    }
  });
  const commitResultMatches = executablePopupFunction('articleArchiveCommitResultMatches');
  const apply = executablePopupFunction('applyLoadedArticleArchive', {
    currentArticleArchiveIdentity: () => currentIdentity,
    queryPanelTargetTab: async () => ({ id: 41, url: frozenIdentity.canonicalUrl }),
    sendTabMessage: async (_tabId, message) => {
      messageOrder.push(message.action);
      if (message.action === 'ensureArticleWorkspace') {
        await ensurePending;
        return {
          success: true,
          workspace: {
            workspaceId: `workspace:${'1'.repeat(64)}`,
            workspaceGeneration: 3,
            canonicalUrl: frozenIdentity.canonicalUrl,
            contentHash: '2'.repeat(64)
          },
          restoreAuthorization: { token: 'restore-token' }
        };
      }
      return {
        success: true,
        manualExecutionProof: proof,
        restoreReceipt: 'receipt-1',
        partial: false
      };
    },
    buildArticleArchiveRestoreTarget: buildTarget,
    describeCommittedArticleRestore: () => null,
    presentCommittedArticleRestoreResult: async () => false,
    rememberArticleArchivePromptDecision: async () => null,
    sendLlmMessage,
    articleArchiveCommitResultMatches: commitResultMatches,
    reinitializeCommittedArticleRestore: reinitialize,
    refreshArticleWorkspace: async () => { messageOrder.push('refreshArticleWorkspace'); },
    setArticleArchivePrompt() {},
    showStatus() {}
  });

  const pending = apply(archive);
  await Promise.resolve();
  currentIdentity = frozenIdentity;
  releaseEnsure();
  await pending;

  assert.equal(commitMessage.documentId, frozenIdentity.documentId);
  assert.equal(commitMessage.documentHash, frozenIdentity.documentHash);
  assert.equal(commitMessage.canonicalUrl, frozenIdentity.canonicalUrl);
  assert.deepEqual(commitMessage.currentArchive, frozenIdentity);
  assert.equal(commitMessage.allowContentChanged, true);
  assert.deepEqual(commitMessage.archive, archive);
  assert.deepEqual(messageOrder, [
    'ensureArticleWorkspace',
    'applyArticleArchiveSnapshot',
    'ARTICLE_ARCHIVE_COMMIT_RESTORE',
    'reinitializeManualAnnotations',
    'prepareManualAnnotations',
    'refreshArticleWorkspace'
  ]);
});

test('archive background commit failure is reported as committed and never reinitialized or retried', async () => {
  const identity = {
    documentId: `sha256:${'a'.repeat(64)}`,
    documentHash: `sha256:${'b'.repeat(64)}`,
    canonicalUrl: 'https://example.test/current'
  };
  const archive = { ...identity };
  const target = {
    authorizationToken: 'restore-token',
    current: { workspaceId: `workspace:${'1'.repeat(64)}` },
    currentArchive: identity,
    allowContentChanged: false
  };
  const actions = [];
  let presented = null;
  const commitResultMatches = executablePopupFunction('articleArchiveCommitResultMatches');
  const apply = executablePopupFunction('applyLoadedArticleArchive', {
    currentArticleArchiveIdentity: () => identity,
    queryPanelTargetTab: async () => ({ id: 52, url: identity.canonicalUrl }),
    sendTabMessage: async (_tabId, message) => {
      actions.push(message.action);
      if (message.action === 'ensureArticleWorkspace') {
        return { success: true, workspace: target.current, restoreAuthorization: { token: 'restore-token' } };
      }
      return { success: true, committed: true, retryable: false, restoreReceipt: 'receipt-2' };
    },
    buildArticleArchiveRestoreTarget: () => target,
    describeCommittedArticleRestore: result => result.success === false &&
      result.committed === true && result.retryable === false ? { message: 'committed', type: 'error' } : null,
    presentCommittedArticleRestoreResult: async result => { presented = result; return true; },
    rememberArticleArchivePromptDecision: async () => null,
    sendLlmMessage: async message => {
      actions.push(message.type);
      return {
        archive,
        applied: false,
        permission: 'imported',
        relativePath: 'archives/current.json',
        error: 'DIRECTORY_COMMIT_FAILED'
      };
    },
    articleArchiveCommitResultMatches: commitResultMatches,
    reinitializeCommittedArticleRestore: async () => {
      actions.push('unexpected-reinitialize');
      return {};
    },
    refreshArticleWorkspace: async () => { actions.push('unexpected-refresh'); },
    setArticleArchivePrompt() {},
    showStatus() {}
  });

  const result = await apply(archive);

  assert.equal(result.success, false);
  assert.equal(result.committed, true);
  assert.equal(result.retryable, false);
  assert.equal(result.postCommitStatus, 'archive-background-commit-failed');
  assert.equal(presented.postCommitStatus, 'archive-background-commit-failed');
  assert.deepEqual(actions, [
    'ensureArticleWorkspace',
    'applyArticleArchiveSnapshot',
    'ARTICLE_ARCHIVE_COMMIT_RESTORE'
  ]);
});

test('archive reinitialize proof rejection remains a truthful committed terminal result', async () => {
  const identity = {
    documentId: `sha256:${'a'.repeat(64)}`,
    documentHash: `sha256:${'b'.repeat(64)}`,
    canonicalUrl: 'https://example.test/current'
  };
  const applied = {
    success: true,
    committed: true,
    retryable: false,
    restoreReceipt: 'receipt-3',
    manualExecutionProof: {
      ...identity,
      contentWorldNonce: '2'.repeat(32),
      documentEpoch: 9
    }
  };
  let presented = null;
  let workspaceRefreshes = 0;
  const commitResultMatches = executablePopupFunction('articleArchiveCommitResultMatches');
  const apply = executablePopupFunction('applyLoadedArticleArchive', {
    currentArticleArchiveIdentity: () => identity,
    queryPanelTargetTab: async () => ({ id: 53, url: identity.canonicalUrl }),
    sendTabMessage: async (_tabId, message) => message.action === 'ensureArticleWorkspace'
      ? { success: true, workspace: { workspaceId: 'workspace-3' }, restoreAuthorization: { token: 'restore-token' } }
      : applied,
    buildArticleArchiveRestoreTarget: () => ({
      authorizationToken: 'restore-token',
      currentArchive: identity,
      allowContentChanged: false
    }),
    describeCommittedArticleRestore: result => result.success === false &&
      result.committed === true && result.retryable === false ? { message: 'committed', type: 'error' } : null,
    presentCommittedArticleRestoreResult: async result => { presented = result; return true; },
    rememberArticleArchivePromptDecision: async () => null,
    sendLlmMessage: async () => ({
      archive: identity,
      applied: true,
      permission: 'imported',
      relativePath: 'archives/current.json'
    }),
    articleArchiveCommitResultMatches: commitResultMatches,
    reinitializeCommittedArticleRestore: async () => {
      throw new Error('MANUAL_REPREPARE_TARGET_MISMATCH');
    },
    refreshArticleWorkspace: async () => { workspaceRefreshes += 1; },
    setArticleArchivePrompt() {},
    showStatus() {}
  });

  const result = await apply({ ...identity });

  assert.equal(result.success, false);
  assert.equal(result.committed, true);
  assert.equal(result.retryable, false);
  assert.equal(result.postCommitStatus, 'content-reinitialize-proof-failed');
  assert.equal(presented.postCommitStatus, 'content-reinitialize-proof-failed');
  assert.equal(workspaceRefreshes, 0);
});

function relativeLuminance(hex) {
  const rgb = hex.match(/[0-9a-f]{2}/gi).map(value => parseInt(value, 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

function contrastRatio(foreground, background) {
  const values = [relativeLuminance(foreground), relativeLuminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test('popup renders saved analysis modes and removes the paper-type chooser', () => {
  const html = read('popup.html');
  const script = read('popup.js');
  assert.match(html, /id="readingViewControl"/);
  assert.match(html, /id="readingViewOptions"/);
  assert.match(html, /<legend[^>]*>阅读情境<\/legend>/);
  assert.match(script, /Object\.entries\(views\)/);
  assert.match(script, /radio\.name\s*=\s*'readingView'/);
  assert.doesNotMatch(html, /studyTypeChooser|studyTypeOptions|name="studyType"/);
  assert.match(html, /id="restoreViewPreset"/);
  assert.match(script, /LLM_PREPARE_DOCUMENT/);
  assert.match(script, /analysisModes/);
});

test('current-view helpers keep the authoritative configured order and ignore prepared overlays', () => {
  const {
    getCategoryEntry,
    getCurrentViewCategoryEntries,
    getMoreCategoryGroups
  } = loadPopupUiHelpers();
  const entries = [
    ['active', { name: 'Active result' }],
    ['shared', { name: 'Shared evidence' }],
    ['gamma_id', { name: 'Gamma limitation' }]
  ];
  const readingViews = {
    quick: { name: 'Quick', categoryIds: ['active', 'shared'] },
    critical: { name: 'Critical', categoryIds: ['shared', 'gamma_id'] },
    empty: { name: 'Empty', categoryIds: ['missing'] }
  };

  assert.deepEqual(
    getCategoryEntry(entries, 'shared'),
    ['shared', { name: 'Shared evidence' }]
  );
  assert.equal(getCategoryEntry(entries, 'missing'), null);
  assert.deepEqual(
    plain(getCurrentViewCategoryEntries({
      entries,
      preparedState: { activeCategories: [{ categoryId: 'active' }] },
      configuredCategoryIds: ['shared']
    }).map(([categoryId]) => categoryId)),
    ['shared']
  );
  assert.deepEqual(
    plain(getCurrentViewCategoryEntries({
      entries,
      preparedState: null,
      configuredCategoryIds: ['shared']
    }).map(([categoryId]) => categoryId)),
    ['shared']
  );

  const groups = getMoreCategoryGroups({
    readingViews,
    activeCategoryIds: ['active'],
    entries
  });
  assert.deepEqual(
    plain(groups.map(group => ({
      viewId: group.viewId,
      ids: group.entries.map(([categoryId]) => categoryId)
    }))),
    [
      { viewId: 'quick', ids: ['shared'] },
      { viewId: 'critical', ids: ['shared', 'gamma_id'] }
    ]
  );
  assert.deepEqual(
    plain(getMoreCategoryGroups({
      readingViews,
      activeCategoryIds: ['active'],
      entries,
      searchTerm: 'GAMMA_ID'
    }).map(group => group.entries.map(([categoryId]) => categoryId))),
    [['gamma_id']]
  );
});

test('preference mutation intents serialize writes and preserve rapid category toggles', async () => {
  const { createAsyncIntentQueue, runSavedMutation } = loadPopupUiHelpers();
  const coordinator = createAsyncIntentQueue();
  const firstSaveGate = deferred();
  const events = [];
  const persisted = new Set();

  const firstIntent = coordinator.beginIntent();
  const first = runSavedMutation({
    coordinator,
    intent: firstIntent,
    save: async () => {
      events.push('save-a:start');
      await firstSaveGate.promise;
      persisted.add('a');
      events.push('save-a:end');
      return [...persisted];
    },
    onSaved: () => events.push('saved-a'),
    refresh: () => events.push('refresh-a')
  });
  const secondIntent = coordinator.beginIntent();
  const second = runSavedMutation({
    coordinator,
    intent: secondIntent,
    save: async () => {
      events.push('save-b:start');
      persisted.add('b');
      events.push('save-b:end');
      return [...persisted];
    },
    onSaved: () => events.push('saved-b'),
    refresh: () => events.push('refresh-b')
  });

  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, ['save-a:start']);
  firstSaveGate.resolve();
  const results = await Promise.all([first, second]);

  assert.deepEqual([...persisted], ['a', 'b']);
  assert.deepEqual(events, [
    'save-a:start', 'save-a:end', 'saved-a',
    'save-b:start', 'save-b:end', 'saved-b', 'refresh-b'
  ]);
  assert.deepEqual(plain(results.map(result => result.status)), ['superseded', 'refreshed']);
});

test('latest pending intent remains published until its own completion', async () => {
  const { createAsyncIntentQueue } = loadPopupUiHelpers();
  const pendingEvents = [];
  const coordinator = createAsyncIntentQueue({
    onPendingChange: pending => pendingEvents.push(pending)
  });
  const firstGate = deferred();
  const secondGate = deferred();
  const firstIntent = coordinator.beginIntent();
  const first = coordinator.enqueue(firstIntent, () => firstGate.promise);
  const secondIntent = coordinator.beginIntent();
  const second = coordinator.enqueue(secondIntent, () => secondGate.promise);

  assert.equal(coordinator.isPending(), true);
  firstGate.resolve('first');
  await first;
  assert.equal(coordinator.isPending(), true);
  assert.deepEqual(pendingEvents, [true]);
  secondGate.resolve('second');
  await second;
  assert.equal(coordinator.isPending(), false);
  assert.deepEqual(pendingEvents, [true, false]);
});

test('archive export guard coalesces rapid clicks and releases after completion', async () => {
  const { createInFlightActionGuard } = loadPopupUiHelpers();
  const guard = createInFlightActionGuard();
  const firstGate = deferred();
  const secondGate = deferred();
  let calls = 0;

  const first = guard.run(async () => {
    calls += 1;
    await firstGate.promise;
    return 'first archive';
  });
  const duplicate = guard.run(async () => {
    calls += 1;
    return 'duplicate archive';
  });

  assert.equal(first, duplicate);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  assert.equal(guard.isPending(), true);
  firstGate.resolve();
  assert.equal(await first, 'first archive');
  assert.equal(guard.isPending(), false);

  const next = guard.run(async () => {
    calls += 1;
    await secondGate.promise;
    return 'second archive';
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 2);
  secondGate.resolve();
  assert.equal(await next, 'second archive');
  assert.equal(guard.isPending(), false);
});

test('latest public settings refresh leaves the route summary on fresh external settings', async () => {
  const { createLatestStateRefresher, getPublicRouteSummaryRows } = loadPopupUiHelpers();
  const staleGate = deferred();
  const freshGate = deferred();
  const gates = [staleGate, freshGate];
  let request = 0;
  let renderedRows = [];
  const refresher = createLatestStateRefresher({
    load: () => gates[request++].promise,
    apply: settings => { renderedRows = getPublicRouteSummaryRows(settings); }
  });
  const stale = refresher.refresh();
  const fresh = refresher.refresh();
  freshGate.resolve({
    profiles: {
      profile_new: { name: 'Fresh profile', config: { model: 'fresh-model', apiKey: 'never-render' } }
    },
    globalProfileId: 'profile_new',
    taskRoutes: {}
  });
  assert.equal((await fresh).status, 'applied');
  assert.deepEqual(plain(renderedRows), [
    ['全局', 'Fresh profile · fresh-model'],
    ['高亮', 'Fresh profile · fresh-model'],
    ['摘要', 'Fresh profile · fresh-model'],
    ['解图', 'Fresh profile · fresh-model'],
    ['多图', 'Fresh profile · fresh-model']
  ]);
  assert.doesNotMatch(JSON.stringify(renderedRows), /never-render/);

  staleGate.resolve({
    profiles: {
      profile_old: { name: 'Stale profile', config: { model: 'stale-model' } }
    },
    globalProfileId: 'profile_old',
    taskRoutes: {}
  });
  assert.equal((await stale).status, 'stale');
  assert.equal(renderedRows[0][1], 'Fresh profile · fresh-model');
});

test('archive export disables while guarded and gear opens the category workspace directly', () => {
  const script = read('popup.js');
  const archiveStart = script.indexOf('function exportCurrentArticleArchive');
  const archiveEnd = script.indexOf('async function importCurrentArticleArchive', archiveStart);
  const archive = script.slice(archiveStart, archiveEnd);
  assert.match(archive, /articleArchiveExportGuard\.run/);
  assert.match(archive, /button\.disabled\s*=\s*true/);
  assert.match(archive, /finally[\s\S]*button\.disabled\s*=\s*false/);

  const shortcutStart = script.indexOf('async function openSidePanelSettingsPage');
  const shortcutEnd = script.indexOf('function createWorkspaceElement', shortcutStart);
  const shortcut = script.slice(shortcutStart, shortcutEnd);
  assert.match(shortcut, /chrome\.runtime\.getURL\('options\.html#categoryWorkspace'\)/);
  assert.match(shortcut, /chrome\.tabs\.create/);
  assert.match(shortcut, /trigger\.disabled = true/);
  assert.match(shortcut, /finally[\s\S]*trigger\.disabled = false/);
});

test('draining the latest mutation blocks analysis until settings settle', async () => {
  const { createAsyncIntentQueue } = loadPopupUiHelpers();
  const coordinator = createAsyncIntentQueue();
  const gate = deferred();
  const intent = coordinator.beginIntent();
  const mutation = coordinator.enqueue(intent, () => gate.promise);
  const providerMessages = [];
  const guardedAnalysis = (async () => {
    await coordinator.drainLatest();
    providerMessages.push('analyzeArticleWithLLM');
  })();

  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(providerMessages, []);
  gate.resolve();
  await Promise.all([mutation, guardedAnalysis]);
  assert.deepEqual(providerMessages, ['analyzeArticleWithLLM']);
});

test('category mode and confidence writes share one ordered settings channel', async () => {
  const { createAsyncIntentQueue, runSavedMutation } = loadPopupUiHelpers();
  const coordinator = createAsyncIntentQueue();
  const categoryGate = deferred();
  const events = [];
  let settings = { categories: [], mode: 'regex', confidenceThreshold: 0.8 };
  let analysisModeState = 'llm';

  const categoryIntent = coordinator.beginIntent();
  const category = runSavedMutation({
    coordinator,
    intent: categoryIntent,
    save: async () => {
      events.push('category:start');
      await categoryGate.promise;
      settings = { ...settings, categories: ['result'] };
      events.push('category:end');
      return settings;
    }
  });
  const modeIntent = coordinator.beginIntent();
  const mode = runSavedMutation({
    coordinator,
    intent: modeIntent,
    save: async () => {
      events.push('mode');
      settings = { ...settings, mode: 'llm' };
      return settings;
    },
    onSaved: (saved, { isCurrent }) => {
      if (isCurrent()) analysisModeState = saved.mode;
    }
  });
  const confidenceIntent = coordinator.beginIntent();
  const confidence = runSavedMutation({
    coordinator,
    intent: confidenceIntent,
    save: async () => {
      events.push('confidence');
      settings = { ...settings, confidenceThreshold: 0.9 };
      return settings;
    },
    onSaved: saved => {
      analysisModeState = saved.mode;
    }
  });

  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, ['category:start']);
  categoryGate.resolve();
  await Promise.all([category, mode, confidence]);
  assert.deepEqual(settings, {
    categories: ['result'],
    mode: 'llm',
    confidenceThreshold: 0.9
  });
  assert.equal(analysisModeState, settings.mode);
  assert.deepEqual(events, ['category:start', 'category:end', 'mode', 'confidence']);
});

test('saved mutation rolls back only when persistence fails', async () => {
  const { createAsyncIntentQueue, runSavedMutation } = loadPopupUiHelpers();
  const coordinator = createAsyncIntentQueue();
  const events = [];
  const saveIntent = coordinator.beginIntent();
  const saveFailure = await runSavedMutation({
    coordinator,
    intent: saveIntent,
    save: async () => { throw new Error('save failed'); },
    onSaved: () => events.push('saved'),
    refresh: () => events.push('refresh'),
    onSaveFailed: () => events.push('rollback'),
    onRefreshFailed: () => events.push('refresh-failed')
  });
  assert.equal(saveFailure.status, 'save_failed');
  assert.deepEqual(events, ['rollback']);

  const refreshIntent = coordinator.beginIntent();
  const refreshFailure = await runSavedMutation({
    coordinator,
    intent: refreshIntent,
    save: async () => 'persisted',
    onSaved: value => events.push(value),
    refresh: async () => { throw new Error('refresh failed'); },
    onSaveFailed: () => events.push('unexpected-rollback'),
    onRefreshFailed: () => events.push('refresh-failed')
  });
  assert.equal(refreshFailure.status, 'refresh_failed');
  assert.deepEqual(events, ['rollback', 'persisted', 'refresh-failed']);
});

test('prepared responses apply only to the current intent document and view', () => {
  const { shouldApplyPreparedResult } = loadPopupUiHelpers();
  const prepared = { documentHash: 'doc-a', readingViewId: 'critical_review' };
  assert.equal(shouldApplyPreparedResult({
    isCurrent: true,
    expectedDocumentHash: 'doc-a',
    expectedViewId: 'critical_review',
    prepared
  }), true);
  assert.equal(shouldApplyPreparedResult({
    isCurrent: false,
    expectedDocumentHash: 'doc-a',
    expectedViewId: 'critical_review',
    prepared
  }), false);
  assert.equal(shouldApplyPreparedResult({
    isCurrent: true,
    expectedDocumentHash: 'doc-b',
    expectedViewId: 'critical_review',
    prepared
  }), false);
  assert.equal(shouldApplyPreparedResult({
    isCurrent: true,
    expectedDocumentHash: 'doc-a',
    expectedViewId: 'quick_story',
    prepared
  }), false);
});

test('popup routes analysis-mode category mutations through one guarded queue', () => {
  const script = read('popup.js');
  assert.match(script, /const preferenceMutationCoordinator\s*=\s*createAsyncIntentQueue\(\)/);
  assert.match(script, /function queueReadingViewMutation/);
  assert.match(script, /function queueCategorySelectionMutation/);
  assert.match(script, /runSavedMutation\(\{/);
  assert.match(script, /onSaveFailed/);
  assert.match(script, /onRefreshFailed/);
  assert.match(script, /shouldApplyPreparedResult\(\{/);
  assert.match(script, /function queueAnalysisModeMutation/);
  assert.match(script, /function queueConfidenceThresholdMutation/);
  assert.doesNotMatch(script, /await updateLlmPreferences\(/);
});

test('LLM category UI focuses the current view and discloses grouped more categories', () => {
  const html = read('popup.html');
  const script = read('popup.js');
  assert.match(html, /id="moreCategories"[^>]*aria-expanded="false"[^>]*aria-controls="moreCategoriesPanel"/);
  assert.match(html, /id="moreCategoriesPanel"/);
  assert.match(html, /id="categorySearch"[^>]*(?:aria-label|type="search")/);
  assert.match(html, /id="moreCategoryGroups"/);
  assert.match(script, /getCurrentViewCategoryEntries/);
  assert.match(script, /getCategoryEntry/);
  assert.match(script, /getMoreCategoryGroups/);
  assert.match(script, /function openCategoryRuleEditor/);
  assert.match(script, /查看\/编辑规则/);
  assert.match(script, /chrome\.runtime\.getURL\('options\.html#page=categories&category='/);
  assert.match(script, /chrome\.tabs\.create/);
});

test('popup scenario category rows keep configured membership, engine status, and user color', () => {
  const script = read('popup.js');
  const renderStart = script.indexOf('function renderCategories()');
  const renderEnd = script.indexOf('// 更新总匹配数', renderStart);
  const itemStart = script.indexOf('function createCategoryItem(');
  const itemEnd = script.indexOf('function renderMoreCategoryGroups(', itemStart);
  const render = script.slice(renderStart, renderEnd);
  const item = script.slice(itemStart, itemEnd);

  assert.match(render, /getCategoryEntriesForEngine\(analysisMode,\s*\{\s*includeUnsupported:\s*true/);
  assert.match(render, /configuredCategoryIds:\s*\[\.\.\.getConfiguredViewSelection\(\)\]/);
  assert.doesNotMatch(render, /getCategoryEntriesForEngine\('regex'\)\.forEach/);
  assert.match(item, /colorDiv\.style\.backgroundColor\s*=\s*rule\.color/);
  assert.match(item, /需要 LLM 识别/);
  assert.doesNotMatch(item, /DISPLAY_FAMILIES|familyLabel|displayFamilyId/);
});

test('popup analysis mode and status controls expose keyboard and live-region semantics', () => {
  const html = read('popup.html');
  const css = read('popup.css');
  assert.match(html, /<fieldset[^>]*id="readingViewControl"/);
  assert.match(html, /<legend[^>]*>阅读情境<\/legend>/);
  assert.doesNotMatch(css, /\.reading-view-control input\s*\{\s*display:\s*none/);
  assert.match(css, /\.reading-view-control input[\s\S]*position:\s*absolute/);
  assert.match(html, /id="statusMessage"[^>]*role="status"[^>]*aria-live="polite"[^>]*aria-atomic="true"/);
});

test('LLM controls disable analysis for an empty category selection and update outline state', () => {
  const script = read('popup.js');
  const applyStart = script.indexOf('function updateApplyButton');
  const applyEnd = script.indexOf('function updateFigureButton', applyStart);
  assert.match(script.slice(applyStart, applyEnd), /llmSelectedCategories\.size\s*===\s*0/);
  const modeStart = script.indexOf('function updateAnalysisModeUi');
  const modeEnd = script.indexOf('async function refreshLlmDiagnostics', modeStart);
  assert.match(script.slice(modeStart, modeEnd), /updateReviewOutlineButton\(\)/);
  assert.match(script.slice(applyStart, applyEnd), /preferenceMutationCoordinator\.isPending\(\)/);
  assert.match(script.slice(applyStart, applyEnd), /正在更新分析设置/);
});

test('popup first-pass visual tokens follow the selected navy and pearl direction', () => {
  const html = read('popup.html');
  const css = read('popup.css');
  const script = read('popup.js');
  assert.match(css, /--color-primary:\s*#0b4778/i);
  assert.match(css, /--color-primary-strong:\s*#0a3f6b/i);
  assert.match(css, /--color-background:\s*#[0-9a-f]{6}/i);
  assert.match(css, /--color-surface:\s*#fff(?:fff)?/i);
  assert.match(css, /--color-text:\s*#[0-9a-f]{6}/i);
  assert.match(css, /--color-border:\s*#[0-9a-f]{6}/i);
  assert.doesNotMatch(css, /#667eea|#764ba2/i);
  assert.doesNotMatch(css, /(?:background|background-image):\s*linear-gradient/i);
  const buttonText = [...html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)]
    .map(match => match[1].replace(/<[^>]+>/g, ''))
    .join(' ');
  assert.doesNotMatch(buttonText, /[✨🔄🧭🗂➕📤📥💾🗑️✏️⚙️⏳]/u);
  assert.doesNotMatch(
    script,
    /(?:applyButton|figureButton|button|editBtn|deleteBtn)\.textContent\s*=\s*[`'"][^`'"]*[✨🔄🧭🗂➕📤📥💾🗑️✏️⚙️⏳]/u
  );
});

test('popup completes unified regex and independent manual-data controls', () => {
  const html = read('popup.html');
  const script = read('popup.js');
  assert.match(html, /id="clearAutomaticHighlights"/);
  assert.match(html, /id="clearManualAnnotations"/);
  assert.match(html, /id="manualAnnotationSummary"/);
  assert.match(html, /id="clearManualDialog"[^>]*aria-labelledby="clearManualTitle"[^>]*aria-describedby="clearManualDescription"/);
  assert.match(script, /availableCategories/);
  assert.match(script, /type:\s*'CATEGORY_GET'/);
  assert.match(script, /regex\.phrases/);
  assert.match(script, /regex\.expressions/);
  assert.match(script, /type:\s*'ANNOTATION_CLEAR_DOCUMENT'/);
  assert.match(script, /action:\s*'clearAutomaticHighlights'/);
  assert.match(script, /action:\s*'clearManualAnnotations'/);
  assert.doesNotMatch(script, /const DEFAULT_CATEGORIES\s*=/);
  assert.doesNotMatch(script, /chrome\.storage\.local\.set\(\{\s*allRules/);
});

test('popup runtime helpers translate edited regex rules and reject stale snapshots', () => {
  const {
    getAvailableCategoryEntries,
    translateUnifiedRegexCategories,
    shouldApplyRegexSnapshot
  } = loadPopupUiHelpers();
  const available = [
    { categoryId: 'result', enabledEngines: ['regex', 'llm'] },
    { categoryId: 'retired_result', retired: true, enabledEngines: ['regex'] },
    { categoryId: 'llm_only', enabledEngines: ['llm'] },
    { categoryId: 'disabled', enabledEngines: [] }
  ];
  assert.deepEqual(
    plain(getAvailableCategoryEntries(available, 'regex').map(([id]) => id)),
    ['result']
  );
  assert.deepEqual(
    plain(getAvailableCategoryEntries(available, 'regex', { includeUnsupported: true })
      .map(([id]) => id)),
    ['result', 'llm_only']
  );
  const translated = translateUnifiedRegexCategories([{
    category: {
      categoryId: 'result',
      name: '用户结果',
      color: '#0B4778',
      regex: {
        phrases: ['risk ratio'],
        expressions: ['p\\s*<\\s*0\\.05'],
        wholeWord: true
      }
    }
  }]);
  assert.equal(translated.result.name, '用户结果');
  assert.equal(translated.result.color, '#0B4778');
  assert.equal(translated.result.isRegex, true);
  assert.match(translated.result.patterns[0], /risk ratio/);
  assert.match(translated.result.patterns[0], /p\\s\*/);
  const snapshot = {
    requestId: 4,
    currentRequestId: 4,
    tabId: 9,
    currentTabId: 9,
    documentId: 'doc-a',
    currentDocumentId: 'doc-a',
    revision: 7,
    currentRevision: 7,
    selectedIds: ['result'],
    currentSelectedIds: ['result']
  };
  assert.equal(shouldApplyRegexSnapshot(snapshot), true);
  assert.equal(shouldApplyRegexSnapshot({ ...snapshot, currentRevision: 8 }), false);
  assert.equal(shouldApplyRegexSnapshot({ ...snapshot, currentTabId: 10 }), false);
  assert.equal(shouldApplyRegexSnapshot({ ...snapshot, currentDocumentId: 'doc-b' }), false);
});

test('failed manual clear never unwraps page marks', async () => {
  const { runManualClear } = loadPopupUiHelpers();
  let unwrapCalls = 0;
  await assert.rejects(runManualClear({
    documentId: 'doc-a',
    clearDocument: async () => { throw new Error('storage failed'); },
    unwrap: async () => {
      unwrapCalls += 1;
      return { success: true };
    }
  }), /storage failed/);
  assert.equal(unwrapCalls, 0);
});

test('manual clear revalidates the current content document before deleting', () => {
  const script = read('popup.js');
  const start = script.indexOf('async function confirmManualAnnotationClear');
  const end = script.indexOf('// 设置事件监听', start);
  const handler = script.slice(start, end);
  const prepareIndex = handler.indexOf("action: 'prepareManualAnnotations'");
  const clearIndex = handler.indexOf("type: 'ANNOTATION_CLEAR_DOCUMENT'");
  assert.ok(prepareIndex >= 0, 'manual clear should reprepare the content document');
  assert.ok(clearIndex > prepareIndex, 'background clear must follow document revalidation');
});

test('a partial category fetch failure aborts the atomic regex snapshot', async () => {
  const { resolveRegexDetailsAtomically } = loadPopupUiHelpers();
  let refreshCalls = 0;
  await assert.rejects(resolveRegexDetailsAtomically({
    categoryIds: ['result', 'limitation'],
    fetchDetail: async categoryId => {
      if (categoryId === 'limitation') throw new Error('detail unavailable');
      return { category: { categoryId } };
    },
    refreshState: async () => {
      refreshCalls += 1;
      return { settings: { userDataCategoryRevision: 4 } };
    },
    validate: async () => true
  }), /detail unavailable/);
  assert.equal(refreshCalls, 0);
});

test('LLM analysis waits for a prepared document but not a paper-type selection', () => {
  const script = read('popup.js');
  assert.match(script, /preparedDocumentState\?\.documentHash/);
  assert.match(script, /documentHash:\s*(?:preparedDocumentState\.documentHash|expectedDocumentHash)/);
  assert.match(script, /applyButton\.disabled/);
  assert.doesNotMatch(script, /请先选择文献类型/);
  assert.match(script, /正在分析全文/);
  assert.match(script, /重新分析全文/);
  assert.doesNotMatch(script, /正在识别论文类型|已识别为/);
  const applyHandler = executablePopupFunction('handleWorkspaceHighlightAnalysis').toString();
  assert.match(script, /getElementById\('applyHighlight'\)\?\.addEventListener\('click', \(\) => void handleWorkspaceHighlightAnalysis\(\)\)/);
  assert.match(applyHandler, /await preferenceMutationCoordinator\.drainLatest\(\)/);
  assert.match(applyHandler, /await prepareCurrentArticleForTypeChoice\(\)/);
  assert.doesNotMatch(applyHandler, /await prepareArticleForAdaptiveAnalysis\(/);
});

test('popup keeps paragraph summaries as per-paragraph actions without a global generator', () => {
  const html = read('popup.html');
  const script = read('popup.js');
  assert.doesNotMatch(html, /id="generateOutlineSummaries"/);
  assert.doesNotMatch(html, />生成逐段摘要</);
  assert.match(script, /runReviewOutlineAnalysis/);
  assert.match(script, /completedParagraphs/);
  assert.match(script, /段/);
});

test('popup exposes the local article navigator in regex and LLM modes', () => {
  const html = read('popup.html');
  const script = read('popup.js');
  assert.match(html, /data-workspace-view="navigation"/);
  assert.match(html, /data-workspace-target="navigation"/);
  assert.match(script, /async function openArticleNavigator/);
  assert.match(script, /action:\s*'getArticleWorkspaceSnapshot'/);
  assert.match(script, /switchWorkspaceView\('navigation'\)/);
  const handler = script.match(
    /async function openArticleNavigator\(\)\s*\{[\s\S]*?\n\}/
  )?.[0] || '';
  assert.doesNotMatch(handler, /effectiveMode|LLM|studyType/);
});

test('side panel keeps one compact paper header, a direct gear, and one diagnostic action', () => {
  const html = read('popup.html');
  const script = read('popup.js');
  const css = read('popup.css');
  assert.doesNotMatch(html, /side-panel-brand-icon/);
  const compactHeader = html.match(
    /<header id="sidePanelHeader"[\s\S]*?<\/header>/
  )?.[0] || '';
  assert.doesNotMatch(compactHeader, />\s*Brevess\s*</);
  assert.doesNotMatch(html, /<h1>分析工作区<\/h1>/);
  assert.doesNotMatch(html, /class="llm-provider-row"/);
  assert.equal((html.match(/id="exportAdapterDiagnosticBundle"/g) || []).length, 1);
  assert.doesNotMatch(html, /id="sidePanelSettingsMenu"/);
  assert.match(html, /id="openSidePanelSettings"[^>]*title="打开识别规则与模型设置"/);
  assert.match(script, /setupSidePanelSettingsShortcut/);
  assert.match(script, /options\.html#categoryWorkspace/);
  assert.match(css, /\.compact-paper-header\s*\{[^}]*position:\s*relative/s);
});

test('scenario display removes redundant density controls and still rerenders cached results only', () => {
  const html = read('popup.html');
  const popup = read('popup.js');
  const content = read('content.js');
  const styles = read('content.css');
  assert.doesNotMatch(html, /id="presentationDensityControl"|name="presentationDensity"/);
  assert.match(popup, /let presentationDensity = 'all'/);
  assert.match(html, /id="editReadingScenarios"/);
  assert.match(html, /id="highlightFamilyLegend"/);
  assert.match(html, /id="fineCategoryDetails"/);
  assert.match(popup, /sciLlmHighlightPresentationV1/);
  assert.match(popup, /function highlightPresentationStateKey/);
  assert.match(popup, /action: 'applyLlmPresentation'/);
  const applyStart = popup.indexOf('async function applyHighlightPresentationToPage');
  const applyEnd = popup.indexOf('function renderHighlightPresentationControls', applyStart);
  assert.ok(applyStart >= 0 && applyEnd > applyStart);
  assert.doesNotMatch(popup.slice(applyStart, applyEnd), /LLM_[A-Z_]+/);
  assert.match(content, /request\.action === 'applyLlmPresentation'/);
  assert.match(content, /renderLlmAnalysis\(/);
  assert.match(styles, /--sci-family-context/);
  assert.match(styles, /\.sci-llm-relation-anchor/);
  assert.match(styles, /\.sci-llm-audit-anchor/);
});

test('relation and audit cards use existing annotation fields and keep per-category feedback', () => {
  const content = read('content.js');
  assert.match(content, /function appendRelationEvidence/);
  assert.match(content, /category\.relationId/);
  assert.match(content, /category\.slots/);
  assert.match(content, /category\.supportSpans/);
  assert.match(content, /function appendAuditWarningEvidence/);
  assert.match(content, /作者主张/);
  assert.match(content, /支持证据/);
  assert.match(content, /当前仍不能确定/);
  assert.match(content, /targetCategoryId/);
  assert.doesNotMatch(
    content.slice(
      content.indexOf('function appendAiPresentationCards'),
      content.indexOf('function showHighlightContextPopover')
    ),
    /chrome\.runtime\.sendMessage|analyzeChunk|LLM_ANALYZE/
  );
});

test('an inactive side panel activates the current tab from any click', () => {
  const popup = read('popup.js');
  assert.match(popup, /function setupInactiveTabClickActivation\(\)/);
  assert.match(popup, /SIDE_PANEL_ACTIVATE_CURRENT_TAB/);
  assert.match(popup, /点击侧栏任意位置即可激活/);
  assert.match(
    popup,
    /setupActiveTabSynchronization\(\);\s*setupInactiveTabClickActivation\(\);/
  );
});

test('side panel exposes one toolbar adapter diagnostic export', () => {
  const html = read('popup.html');
  const script = read('popup.js');
  assert.match(html, /id="exportAdapterDiagnosticBundle"/);
  assert.match(html, /id="retryArticlePreparation"/);
  assert.doesNotMatch(html, /id="exportPublisherDiagnostic"/);
  assert.match(script, /async function exportAdapterDiagnosticBundle\(/);
  assert.match(script, /new CompressionStream\('gzip'\)/);
  assert.match(script, /action:\s*'buildAdapterDiagnosticBundle'/);
  const start = script.indexOf('async function exportAdapterDiagnosticBundle');
  const end = script.indexOf('function stopReviewOutlineProgressPolling', start);
  assert.doesNotMatch(script.slice(start, end), /preparedDocumentState\?\.documentHash/);
  assert.doesNotMatch(script, /exportPublisherDiagnostic/);
  assert.equal(
    (script.match(/exportAdapterDiagnosticBundle'\)\s*\?\.addEventListener\('click'/g) || []).length,
    1
  );
});

test('successful document status shows only activation and publisher; navigation owns counts', () => {
  const script = read('popup.js');
  const start = script.indexOf('function renderArticleWorkspaceSnapshot');
  const end = script.indexOf('function withPreparationDeadline', start);
  const render = script.slice(start, end);
  assert.match(render, /publisherFamily/);
  assert.match(render, /headingCount/);
  assert.match(render, /paragraphCount/);
  assert.match(render, /if \(status\) status\.textContent\s*=\s*warning\s*\?/);
  assert.match(render, /:\s*summary;/);
  assert.match(render,
    /statusText\.dataset\.layoutStatusBase\s*=\s*snapshot\?\.access\?\.status\s*===\s*'public_preview'[\s\S]*?`已激活 · 仅公开预览 · \$\{publisher\}`\s*:\s*`已激活 · \$\{publisher\}`/);
  assert.match(render, /statusText\.textContent\s*=\s*statusText\.dataset\.layoutStatusBase/);
  assert.doesNotMatch(render, /statusText\.textContent\s*=\s*['"`]已激活[^;]*headingCount/s);
  assert.doesNotMatch(render, /statusText\.textContent\s*=\s*['"`]已激活[^;]*paragraphCount/s);
});

test('article retry is hidden by default and lives only inside document status', () => {
  const html = read('popup.html');
  const script = read('popup.js');
  const statusStart = html.indexOf('id="sidePanelDocumentStatus"');
  const statusEnd = html.indexOf('</div>', statusStart);
  const statusMarkup = html.slice(statusStart, statusEnd);
  assert.match(statusMarkup, /id="retryArticlePreparation"[^>]*hidden/);
  assert.match(script, /function renderArticleConnectionFailure[\s\S]*retry\.hidden\s*=\s*false/);
  const readyStart = script.indexOf('function renderArticleWorkspaceSnapshot');
  const readyEnd = script.indexOf('function withPreparationDeadline', readyStart);
  assert.match(script.slice(readyStart, readyEnd), /retry\.hidden\s*=\s*true/);
});

test('removed paper-type controls cannot appear in popup markup', () => {
  const html = read('popup.html');
  const css = read('popup.css');
  assert.doesNotMatch(html, /study-type-option|studyTypeChooser|studyTypeOptions/);
  assert.doesNotMatch(css,
    /\.study-type-option:has\(input:disabled\)[^{]*\{[^}]*cursor:\s*wait/s);
});

test('article preparation has a deadline and exposes actionable failure state', () => {
  const script = read('popup.js');
  assert.match(script, /function withPreparationDeadline\(/);
  assert.match(script, /function renderArticleConnectionFailure\(/);
  assert.match(script, /提取超时/);
  assert.match(script, /retryArticlePreparation/);
  assert.match(script, /sidePanelDocumentStatusText/);
});

test('popup presents paragraph summaries as optional enrichment after the local tree', () => {
  const html = read('popup.html');
  const script = read('popup.js');
  const start = html.indexOf('id="highlightControls"');
  const end = html.indexOf('id="highlightDistribution"', start);
  assert.ok(start >= 0 && end > start, 'the actual highlighter controls must be present');
  const analysis = html.slice(start, end);
  assert.doesNotMatch(analysis, /id="generateReviewOutline"|id="openArticleNavigator"/);
  assert.doesNotMatch(html, /id="generateOutlineSummaries"/);
  assert.match(script, /概述/);
});

test('merged excerpts keep one full-text action in top tools above highlighter settings', () => {
  const html = read('popup.html');
  const icons = read('vendor/phosphor/icons.css');
  const analysis = html.slice(
    html.indexOf('id="highlightControls"'),
    html.indexOf('id="highlightDistribution"')
  );
  assert.equal((html.match(/id="applyHighlight"/g) || []).length, 1);
  assert.match(html, /id="highlightsModuleTools"/);
  assert.match(html, /data-workspace-tools="highlights"/);
  assert.ok(html.indexOf('id="applyHighlight"') < html.indexOf('id="highlightControls"'));
  assert.doesNotMatch(analysis, /id="applyHighlight"/);
  const applyButton = html.match(/<button\b[^>]*id="applyHighlight"[^>]*>[\s\S]*?<\/button>/)?.[0] || '';
  assert.match(applyButton, /\bdata-module-action\b/);
  assert.match(applyButton, /aria-label="应用高亮"/);
  assert.match(applyButton, /title="应用高亮"/);
  assert.match(applyButton, />高亮<\/button>/);
  assert.match(analysis, /<summary>[\s\S]*ph-list-magnifying-glass/);
  assert.match(icons, /ph\.ph-list-magnifying-glass::before/);
});

test('new chat and migration controls use bundled visible icons', () => {
  const popup = read('popup.html');
  const options = read('options.html');
  const icons = read('vendor/phosphor/icons.css');

  const chat = popup.match(/<button[^>]*data-workspace-target="chat"[^>]*>[\s\S]*?<\/button>/)[0];
  const send = popup.match(/<button[^>]*id="sendArticleChat"[^>]*>[\s\S]*?<\/button>/)[0];
  assert.match(chat, /aria-label="问答"/);
  assert.match(send, /aria-labelledby="sendArticleChatLabel"/);
  assert.match(chat, /<svg[^>]*viewBox="0 0 24 24"[^>]*aria-hidden="true"/);
  assert.match(chat, /<path d="[^"]+"/);
  assert.match(send, /<i class="ph ph-paper-plane-tilt" aria-hidden="true"><\/i>/);
  assert.match(send, /<span id="sendArticleChatLabel">发送<\/span>/);
  assert.match(options, /id="exportMigrationBundle"[\s\S]*ph-export/);
  assert.match(options, /ph-upload[\s\S]*id="importMigrationBundle"/);
  for (const icon of ['chat-circle-text', 'paper-plane-tilt', 'upload', 'export']) {
    assert.match(icons, new RegExp(`ph\\.ph-${icon}::before`));
  }
});

test('popup restores an in-flight outline job when reopened', () => {
  const script = read('popup.js');
  assert.match(script, /restoreReviewOutlineProgress/);
  assert.match(script, /getReviewOutlineStatus/);
  assert.match(script, /setInterval\([^,]+,\s*600\)/s);
});

test('popup explains that completed outline checkpoints survive a terminal failure', () => {
  const script = read('popup.js');
  assert.match(script, /已完成部分已保存/);
  assert.match(script, /重新点击将从断点继续/);
});

test('popup treats outline generation as a neutral article feature', () => {
  const script = read('popup.js');
  assert.doesNotMatch(script, /nonReviewNotice/);
  assert.doesNotMatch(script, /当前类型不是综述/);
  assert.match(script, /正在生成逐段摘要/);
  assert.match(script, /论文大纲已生成/);
  const start = script.indexOf('async function runReviewOutlineAnalysis');
  const end = script.indexOf('function renderManualAnnotationSummary', start);
  assert.doesNotMatch(
    script.slice(start, end),
    /profileIsReview|综述大纲|综述逐段摘要/
  );
});

test('content renderer distinguishes explicit evidence from inferred warnings', () => {
  const script = read('content.js');
  const css = read('content.css');
  assert.match(script, /sci-llm-inferred-warning/);
  assert.match(script, /dataset\.relationIds/);
  assert.match(script, /renderReadingPanel/);
  assert.match(script, /mark\.tabIndex\s*=\s*0/);
  assert.match(script, /mark\.setAttribute\('role', 'button'\)/);
  assert.match(script, /mark\.addEventListener\('keydown'/);
  assert.match(css, /border-bottom-style:\s*dashed/);
  assert.match(css, /\.sci-llm-highlight:focus-visible/);
});

test('reading panel renders mechanism relations and audit items without HTML injection', () => {
  const script = read('content.js');
  const css = read('content.css');
  assert.match(script, /sci-reading-panel/);
  assert.match(script, /relationSummaries/);
  assert.match(script, /auditItems/);
  assert.match(script, /formatEvidenceStrength/);
  assert.match(script, /证据强/);
  assert.match(script, /条证据/);
  assert.match(script, /startsWith\('待核查：'\)/);
  assert.match(script, /核心证据/);
  assert.match(script, /document\.createElement\('details'\)/);
  assert.match(script, /readingViewId === 'critical_review'/);
  assert.match(script, /aria-expanded/);
  assert.match(css, /sci-reading-section-title/);
  assert.match(css, /focus-visible/);
  assert.doesNotMatch(script, /panel\.innerHTML\s*=/);
});

test('reading ledger can close and cannot overlap the article navigator', () => {
  const script = read('content.js');
  const css = read('content.css');
  assert.match(script, /function closeReadingPanel\(\)/);
  assert.match(script, /className\s*=\s*'sci-reading-actions'/);
  assert.match(script, /className\s*=\s*'sci-reading-close'/);
  assert.match(script, /close\.addEventListener\('click', closeReadingPanel\)/);
  const navigatorRenderer = script.slice(
    script.indexOf('function renderArticleNavigator'),
    script.indexOf('function showArticleNavigator')
  );
  assert.match(navigatorRenderer, /closeReadingPanel\(\)/);
  assert.match(
    css,
    /#sci-reading-panel\.collapsed\s*\{[^}]*bottom:\s*auto;[^}]*width:\s*auto;/s
  );
});

test('automatic LLM startup prepares a profile instead of bypassing type confirmation', () => {
  const script = read('content.js');
  const autoFunction = script.match(/async function maybeAutoAnalyzeWithLLM\(\)[\s\S]*?\n}/)?.[0] || '';
  assert.match(autoFunction, /prepareArticleProfileWithLLM/);
  assert.doesNotMatch(autoFunction, /await analyzeArticleWithLLM/);
});

test('content script registers capabilities without scanning at module boot', () => {
  const script = read('content.js');
  const listenerEnd = script.lastIndexOf("console.log('Brevess 已加载')");
  const bootTail = script.slice(listenerEnd);
  assert.doesNotMatch(bootTail, /initializeManualAnnotationUi\(\)/);
  assert.doesNotMatch(bootTail, /maybeAutoAnalyzeWithLLM/);
  assert.match(script, /request\.action === 'prepareManualAnnotations'/);
});

test('reading assistant exposes a global local-workspace toolbar without the removed floating pin', () => {
  const html = read('popup.html');
  const script = read('popup.js');
  const css = read('popup.css');
  const background = read('background.js');
  const manifest = JSON.parse(read('manifest.json'));
  assert.equal(manifest.name, '__MSG_extensionName__');
  assert.equal(manifest.default_locale, 'zh_CN');
  assert.match(
    html,
    /<title>Brevess<\/title>/
  );
  assert.doesNotMatch(html, /toggleFloatingSidePanel|ph-push-pin|悬浮置顶/);
  const statusStart = html.indexOf('id="sidePanelDocumentStatus"');
  const statusEnd = html.indexOf('<section id="articleArchivePrompt"', statusStart);
  const statusMarkup = html.slice(statusStart, statusEnd);
  for (const id of [
    'scanArticleWorkspace', 'saveCurrentArticleWorkspace', 'clearArticleWorkspace',
    'exportCurrentArticleArchive', 'importCurrentArticleArchiveButton'
  ]) assert.match(statusMarkup, new RegExp(`id="${id}"`));
  const feedbackIndex = html.indexOf('id="statusMessage"');
  const workspaceMainIndex = html.indexOf('<main class="workspace-main">');
  assert.ok(feedbackIndex > statusStart && feedbackIndex < workspaceMainIndex);
  assert.match(statusMarkup, /id="statusMessage"[^>]*side-panel-global-status/);
  assert.match(css, /\.side-panel-global-status\s*\{/);
  assert.match(script, /if \(statusMessageTimer !== null\) clearTimeout\(statusMessageTimer\)/);
  assert.match(script, /statusMessageTimer = null;[\s\S]*function showStatus/);
  const highlightsStart = html.indexOf('data-workspace-view="highlights"');
  const highlightsEnd = html.indexOf('data-workspace-view="figures"', highlightsStart);
  assert.doesNotMatch(html.slice(highlightsStart, highlightsEnd), /article-archive-toolbar/);
  assert.match(css, /\.side-panel-global-tools\s*\{/);
  assert.doesNotMatch(
    script,
    /documentPictureInPicture|openFloating|floatingPanel|FLOATING_PANEL|displayMode.*pip/
  );
  assert.doesNotMatch(
    background,
    /FLOATING_SIDE_PANEL|floatingPanel|sciFloatingPanelPin/
  );
});

test('activated publisher pages use a family-aware single-column article layout', () => {
  const css = read('content.css');
  for (const family of [
    'elsevier', 'springer-nature', 'wiley', 'oup', 'taylor-francis',
    'plos', 'frontiers', 'mdpi', 'acs', 'rsc', 'aaas', 'jama', 'bmj',
    'nejm', 'pmc-jats', 'preprint'
  ]) assert.match(css, new RegExp(`data-sci-publisher-family="${family}"`));
  assert.match(css, /nav\[aria-label\*="article" i\]/);
  assert.match(css, /\.c-article-extras/);
  assert.match(css, /\.outline-panel/);
  assert.match(css, /\.pane-highwire-article-navigation/);
  for (const realPublisherSelector of [
    '.sticky-table-of-contents',
    '.core-sections-menu-outer',
    '.core-collateral-aside',
    '.RelatedContent',
    '#sidebar',
    '.ArticleDetailsV4__asideLeft',
    '#article_content-right',
    'article[data-has="right-rail"] > aside',
    '[data-core-aside="right-rail"]',
    '[class*="Article_RightRail" i]',
    '.sidebar-right-wrapper'
  ]) assert.match(css, new RegExp(realPublisherSelector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(css, /\.article-wrapper\.grid\.row[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(css, /\[data-core-wrapper="content"\]/);
  assert.match(css, /data-sci-publisher-family="aaas"[\s\S]*article\[data-has="right-rail"\][\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(css, /\.main-content-wrapper/);
  assert.match(css, /data-sci-reader-single-column="true"[\s\S]*?float:\s*none\s*!important/);
  assert.match(css, /data-sci-reader-single-column="true"[\s\S]*?width:\s*100%\s*!important/);
});

test('popup is a full-height native side-panel workspace with five internal views', () => {
  const html = read('popup.html');
  const css = read('popup.css');
  const script = read('popup.js');
  assert.match(html, /id="sidePanelHeader"/);
  assert.match(html, /id="sidePanelDocumentStatus"/);
  for (const viewId of ['navigation', 'highlights', 'figures', 'chat', 'notes']) {
    assert.match(html, new RegExp(`data-workspace-view="${viewId}"`));
    assert.match(html, new RegExp(`data-workspace-target="${viewId}"`));
  }
  const bottomNav = html.match(/<nav class="workspace-bottom-nav"[\s\S]*?<\/nav>/)?.[0] || '';
  const navButtons = [...bottomNav.matchAll(/<button[^>]*data-workspace-target="([^"]+)"[^>]*>[\s\S]*?<\/button>/g)];
  const navItems = navButtons.map(match => ({ target: match[1], label: match[0].match(/aria-label="([^"]+)"/)[1] }));
  assert.deepEqual(navItems, [
    { target: 'navigation', label: '导航' },
    { target: 'highlights', label: '摘句' },
    { target: 'figures', label: '图解' },
    { target: 'chat', label: '问答' },
    { target: 'notes', label: '笔记' }
  ]);
  for (const match of navButtons) {
    const button = match[0];
    assert.match(button, /role="tab"/);
    assert.match(button, /aria-selected="(?:true|false)"/);
    assert.match(button, /<svg[^>]*viewBox="0 0 24 24"[^>]*aria-hidden="true"/);
    assert.match(button, /<path d="[^"]+"/);
    const panelId = button.match(/aria-controls="([^"]+)"/)[1];
    assert.ok(html.includes(`id="${panelId}"`));
  }
  assert.match(script, /function switchWorkspaceView\(/);
  assert.match(script, /aria-selected/);
  assert.match(script, /setupWorkspaceNavigation/);
  assert.match(css, /\.side-panel-app\s*\{[^}]*min-height:\s*100vh/s);
  assert.match(css, /\.workspace-bottom-nav\s*\{[^}]*position:\s*sticky/s);
  assert.match(css, /\.workspace-view\s*\{[^}]*overflow-y:\s*auto/s);
  assert.match(css, /min-width:\s*360px/);
  assert.doesNotMatch(css, /body\s*\{[^}]*width:\s*380px/s);
});

test('side panel title row shows the latest timestamped notification and expandable history', () => {
  const html = read('popup.html');
  const css = read('popup.css');
  const script = read('popup.js');
  for (const id of [
    'sidePanelNotificationCenter',
    'sidePanelNotificationSummary',
    'sidePanelNotificationTime',
    'sidePanelNotificationLatest',
    'sidePanelNotificationHistory'
  ]) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /<time id="sidePanelNotificationTime"/);
  assert.match(html, /通知历史/);
  assert.match(script, /function recordSidePanelNotification/);
  assert.match(script, /SIDE_PANEL_NOTIFICATION_HISTORY_LIMIT\s*=\s*40/);
  assert.match(script, /function renderSidePanelNotificationHistory/);
  assert.match(script, /message\?\.type === 'ARTICLE_NOTIFICATION'/);
  assert.match(script, /chrome\.storage\.session\.set/);
  assert.match(script, /formatSidePanelNotificationTime/);
  assert.match(css, /\.side-panel-notification-popover\s*\{/);
  assert.match(css, /\.side-panel-notification-popover\s*\{[^}]*z-index:\s*110/s);
  assert.match(css, /\.side-panel-header\s*\{[^}]*z-index:\s*120/s);
  assert.match(css, /\.literature-note-drawer\s*\{[^}]*z-index:\s*85/s);
  assert.match(css, /max-height:[^;]+;/);
  assert.match(css, /\.side-panel-notification-history\s*\{[^}]*overflow-y:\s*auto/s);
});

test('side panel renders navigation, evidence, highlight distribution, and figure snapshots', () => {
  const script = read('popup.js');
  for (const helper of [
    'renderArticleWorkspaceSnapshot',
    'renderArticleNavigationTree',
    'renderEvidenceLedger',
    'renderHighlightDistributionSnapshot',
    'renderFigureWorkspaceSnapshot',
    'refreshArticleWorkspace'
  ]) assert.match(script, new RegExp(`function ${helper}\\(`));
  assert.match(script, /action:\s*'getArticleWorkspaceSnapshot'/);
  assert.match(script, /action:\s*'focusArticleWorkspaceSource'/);
  assert.match(script, /textContent/);
  assert.doesNotMatch(script, /articleNavigationTree\.innerHTML\s*=/);
  const distributionStart = script.indexOf('function renderHighlightDistributionSnapshot');
  const distributionEnd = script.indexOf('function appendFigureWorkspaceField', distributionStart);
  const distribution = script.slice(distributionStart, distributionEnd);
  assert.match(distribution, /workspace-distribution-group/);
  assert.match(distribution, /workspace-distribution-occurrence/);
  assert.match(distribution, /sourceValue\.items\.forEach/);
  assert.match(distribution, /occurrence\.dataset\.highlightId\s*=\s*item\.highlightId/);
  assert.match(distribution, /highlightId:\s*item\.highlightId/);
  assert.doesNotMatch(distribution, /highlightId:\s*sourceValue\.items\?\.\[0\]/);
});

test('side panel ignores stale workspace refreshes after the active tab changes', () => {
  const script = read('popup.js');
  assert.match(script, /let workspaceRefreshSequence\s*=\s*0/);
  assert.match(script, /const requestId\s*=\s*\+\+workspaceRefreshSequence/);
  assert.match(script, /requestId\s*!==\s*workspaceRefreshSequence/);
  assert.match(script, /currentTab\?\.id\s*!==\s*tab\.id/);
});

test('navigation first render opens exact root Results and preserves explicit manual expansion choices', () => {
  const popup = read('popup.js');
  const renderer = popup.slice(
    popup.indexOf('function renderArticleNavigationTree'),
    popup.indexOf('function renderEvidenceLedger')
  );
  assert.match(renderer, /details\.open\s*=\s*outlineNodeExpanded\('html', nodeKey, node, depth\)/);
  assert.doesNotMatch(renderer, /:\s*depth\s*===\s*0\s*&&\s*!leaf/);
  const functionSource = name => {
    const start = popup.indexOf(`function ${name}(`);
    assert.ok(start >= 0, name);
    const tail = popup.slice(start);
    const end = tail.search(/\n(?:async )?function /);
    assert.ok(end > 0, name);
    return tail.slice(0, end);
  };
  const context = { outlineExpansionState: new Map() };
  require('node:vm').runInNewContext(['outlineExpansionKey', 'defaultOutlineNodeExpanded',
    'outlineNodeExpanded'].map(functionSource).join('\n'), context);
  for (const title of ['Results', '2. Results:', '结果：', 'Results and Discussion']) {
    const node = { title, children: [{}] };
    assert.equal(context.outlineNodeExpanded('html', title, node, 0), true, title);
    assert.equal(context.outlineNodeExpanded('html', title, node, 1), false, title);
    assert.equal(context.outlineNodeExpanded('html', title, { ...node, children: [] }, 0), false, title);
  }
  const result = { title: 'Results', children: [{}] };
  context.outlineExpansionState.set(context.outlineExpansionKey('html', 'results'), false);
  assert.equal(context.outlineNodeExpanded('html', 'results', result, 0), false);
  context.outlineExpansionState.set(context.outlineExpansionKey('html', 'intro'), true);
  assert.equal(context.outlineNodeExpanded('html', 'intro', { title: 'Introduction', children: [{}] }, 0), true);
  assert.equal(context.outlineNodeExpanded('pdf', 'results', result, 0), true,
    'HTML explicit false must not affect a PDF source with the same section id');
});

test('side panel auto-restores a readable local workspace before showing a legacy prompt', () => {
  const script = fs.readFileSync(path.join(__dirname, '..', 'popup.js'), 'utf8');
  assert.match(
    script,
    /async function tryAutoRestoreCurrentArticleWorkspace\([\s\S]*?requestPermission:\s*false/
  );
  const initializeStart = script.indexOf('async function initializeCurrentArticle');
  const initializeEnd = script.indexOf("\ndocument.addEventListener('DOMContentLoaded'", initializeStart);
  const initialize = script.slice(initializeStart, initializeEnd);
  assert.match(initialize, /await tryAutoRestoreCurrentArticleWorkspace/);
  assert.ok(
    initialize.indexOf('await tryAutoRestoreCurrentArticleWorkspace') <
      initialize.indexOf('probeCurrentArticleArchive'),
    'directory auto-restore must run before the optional legacy archive prompt'
  );
  const content = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');
  const snapshotStart = content.indexOf(
    "} else if (request.action === 'getArticleWorkspaceSnapshot')"
  );
  const snapshotEnd = content.indexOf(
    "} else if (request.action === 'ensureArticleWorkspace')",
    snapshotStart
  );
  assert.doesNotMatch(
    content.slice(snapshotStart, snapshotEnd),
    /scheduleArticleWorkspaceArtifactsSave/,
    'a read-only snapshot must not overwrite the on-disk chat index before restore'
  );
});

test('completed full-text analysis persists an idle task after releasing the operation', () => {
  const source = read('content.js');
  const analyzeStart = source.indexOf(
    'async function analyzeArticleWithLLM(options = {})'
  );
  const analyzeEnd = source.indexOf('\nfunction figureDataUrlBytes', analyzeStart);
  assert.ok(analyzeStart >= 0 && analyzeEnd > analyzeStart);
  const analyzeSource = source.slice(analyzeStart, analyzeEnd);
  const finishIndex = analyzeSource.lastIndexOf('finishLlmHighlightOperation(operation);');
  const finalCheckpointIndex = analyzeSource.lastIndexOf(
    'scheduleArticleWorkspaceArtifactsSave({ immediate: true });'
  );
  assert.ok(finishIndex >= 0);
  assert.ok(
    finalCheckpointIndex > finishIndex,
    'the final workspace snapshot must be captured after the LLM operation is released'
  );
});

test('activation creates only a non-destructive article baseline after local restore', () => {
  const popupSource = read('popup.js');
  const initializeStart = popupSource.indexOf('async function initializeCurrentArticle');
  const initializeEnd = popupSource.indexOf(
    "\ndocument.addEventListener('DOMContentLoaded'",
    initializeStart
  );
  const initializeSource = popupSource.slice(initializeStart, initializeEnd);
  const restoreIndex = initializeSource.indexOf(
    'await tryAutoRestoreCurrentArticleWorkspace'
  );
  const baselineIndex = initializeSource.indexOf(
    "action: 'saveArticleWorkspaceBaseline'"
  );
  assert.ok(restoreIndex >= 0 && baselineIndex > restoreIndex);

  const contentSource = read('content.js');
  const baselineStart = contentSource.indexOf(
    'function buildArticleWorkspaceBaselineAssets()'
  );
  const baselineEnd = contentSource.indexOf(
    '\nfunction captureArticleWorkspaceAssets',
    baselineStart
  );
  const baselineSource = contentSource.slice(baselineStart, baselineEnd);
  assert.match(baselineSource, /article\/structure\.json/);
  assert.match(baselineSource, /article\/paragraphs\.json/);
  assert.doesNotMatch(baselineSource, /chat\/index\.json|figures\/|analysis\/|annotations\//);
  assert.match(contentSource, /request\.action === 'saveArticleWorkspaceBaseline'/);
  const restoreStart = contentSource.indexOf(
    'async function applyArticleWorkspaceAssets(input'
  );
  const restoreEnd = contentSource.indexOf(
    '\nasync function resetArticleWorkspaceState',
    restoreStart
  );
  const restoreSource = contentSource.slice(restoreStart, restoreEnd);
  assert.match(restoreSource, /runAuthorizedArticleWorkspaceRestore/);
  assert.match(restoreSource, /invalidateArticleWorkspaceLifecycle/);
  assert.match(restoreSource, /articleWorkspaceSaveFrozen\s*=\s*true/);
  assert.doesNotMatch(
    contentSource.slice(
      contentSource.indexOf('async function applyArticleWorkspaceAssetsUnsafe'),
      restoreStart
    ),
    /currentArticleWorkspace\s*=\s*\{\s*\.\.\.input\.manifest|articleWorkspaceGenerationOverride\s*=\s*Math\.max\([\s\S]*?input\.manifest/
  );
});

test('side-panel activation is local-first and never waits for an LLM document preparation call', () => {
  const popup = read('popup.js');
  const start = popup.indexOf('async function initializeCurrentArticle');
  const end = popup.indexOf("\ndocument.addEventListener('DOMContentLoaded'", start);
  const initialize = popup.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(initialize, /await refreshArticleWorkspace\(\{\s*throwOnError:\s*true,\s*forceRefresh:\s*retry\s*\}\)/);
  assert.doesNotMatch(initialize, /prepareCurrentArticleForTypeChoice/);
});

test('persistent analysis result overlays are not mounted into publisher pages', () => {
  const script = read('content.js');
  const applyStart = script.indexOf('function applyLlmHighlights');
  const applyEnd = script.indexOf('function renderLlmAnalysis', applyStart);
  assert.doesNotMatch(script.slice(applyStart, applyEnd), /renderReadingPanel\(/);
  const navigatorStart = script.indexOf('function showArticleNavigator');
  const navigatorEnd = script.indexOf('function renderReviewOutlinePanel', navigatorStart);
  assert.doesNotMatch(script.slice(navigatorStart, navigatorEnd), /renderArticleNavigator\(/);
  const outlineStart = script.indexOf('async function analyzeReviewOutlineWithLLM');
  const outlineEnd = script.indexOf('async function maybeAutoAnalyzeWithLLM', outlineStart);
  assert.doesNotMatch(script.slice(outlineStart, outlineEnd), /renderReviewOutlinePanel\(/);
});

test('navigation uses one complete tree with global expand and collapse controls', () => {
  const html = read('popup.html');
  const script = read('popup.js');
  assert.match(html, /id="expandAllOutlineLevels"/);
  assert.match(html, /id="collapseAllOutlineLevels"/);
  assert.doesNotMatch(html, /id="generateOutlineSummaries"/);
  assert.doesNotMatch(html, /data-outline-depth=/);
  assert.doesNotMatch(script, /workspaceOutlineDepth/);
  assert.match(script, /function setAllOutlineLevelsExpanded\(/);
  assert.match(script, /dataset\.treeDepth/);
});

test('global outline expansion leaves leaf paragraph drawers closed', () => {
  const script = read('popup.js');
  const start = script.indexOf('function setAllOutlineLevelsExpanded');
  const end = script.indexOf('function setupWorkspaceNavigation', start);
  const helper = script.slice(start, end);
  assert.match(helper, /workspace-tree-node:not\(\[data-leaf="true"\]\)/);
  assert.match(helper, /if \(!expanded\)/);
  assert.match(helper, /details\.open = false/);
});

test('navigation exposes a local high-precision abbreviation table', () => {
  const html = read('popup.html');
  const script = read('popup.js');
  const styles = read('popup.css');
  const abbreviationButtonIndex = html.indexOf('id="showArticleAbbreviations"');
  const scanButtonIndex = html.indexOf('id="scanArticleWorkspace"');
  assert.ok(abbreviationButtonIndex >= 0 && abbreviationButtonIndex < scanButtonIndex);
  assert.match(
    html.slice(abbreviationButtonIndex, scanButtonIndex),
    /side-panel-tool-letter[\s\S]*>A<\/span>/
  );
  assert.match(html, /id="articleAbbreviationDialog"/);
  assert.match(html, /id="articleAbbreviationAlphabetNav"/);
  assert.match(html, /<th scope="col">缩写<\/th>/);
  assert.match(html, /<th scope="col">英文全称<\/th>/);
  assert.match(html, /<span>中文含义<\/span>/);
  assert.match(html, /id="translateArticleAbbreviations"/);
  assert.match(html, /id="importArticleAbbreviationsToGlobal"/);
  assert.match(html, /id="importGlobalAbbreviationMemoryButton"/);
  assert.match(html, /id="exportGlobalAbbreviationMemory"/);
  assert.match(html, /core\/abbreviation-extractor\.js/);
  assert.match(script, /function showArticleAbbreviationTable/);
  assert.match(script, /action: 'getArticleAbbreviations'/);
  assert.match(script, /action: 'removeArticleAbbreviation'/);
  assert.match(script, /action: 'updateArticleAbbreviationTranslations'/);
  assert.match(script, /LLM_TRANSLATE_ABBREVIATIONS/);
  assert.match(script, /ABBREVIATION_MEMORY_MERGE/);
  assert.match(script, /createGlobalAbbreviationMemoryExport/);
  assert.match(script, /parseGlobalAbbreviationMemoryImport/);
  assert.match(script, /未调用 LLM/);
  assert.match(script, /function jumpToArticleAbbreviationSource/);
  assert.match(script, /function renderArticleAbbreviationAlphabetNav/);
  assert.match(script, /\[\.\.\.'ABCDEFGHIJKLMNOPQRSTUVWXYZ', '#'\]/);
  assert.match(script, /dataset\.abbreviationInitial/);
  assert.match(script, /kind: 'paragraph'/);
  assert.match(script, /paragraphId: String\(entry\?\.paragraphId/);
  const jump = executablePopupFunction('jumpToArticleAbbreviationSource').toString();
  assert.match(jump, /kind: 'abbreviation'/);
  for (const key of ['entryId', 'sourceKey', 'sourceIndex', 'documentHash', 'documentGeneration', 'navigationRevision']) {
    assert.ok(jump.includes(key), `abbreviation focus retains ${key}`);
  }
  assert.match(script, /navigationRevision: Math\.max\(0, Number\(entry\?\.navigationRevision/);
  assert.match(script, /正文中的首次出现位置/);
  assert.match(styles, /\.abbreviation-table-jump/);
  assert.match(styles, /\.abbreviation-alphabet-nav/);
  assert.match(styles, /\.abbreviation-alphabet-button/);
  assert.match(styles, /\.abbreviation-meaning-editor/);
  assert.match(styles, /\.abbreviation-source-badge/);
});

test('outline summaries preserve default, customized, and explicit batch scopes with frozen identity', async () => {
  const popup = read('popup.js');
  const start = popup.indexOf('async function runReviewOutlineAnalysis');
  const end = popup.indexOf('function initializeSettingsUI', start);
  const workflow = popup.slice(start, end);
  assert.ok(start >= 0);
  assert.match(workflow,
    /const selectionCustomized = scopeSelectionProvided \?\? \(scopeSnapshot\?\.analysisSelectionCustomized === true\)/);
  assert.match(workflow, /const requestedScope = Array\.isArray\(scopeSectionIds\) \? \[\.\.\.scopeSectionIds\] : selectedWorkspaceAnalysisSectionIds\(scopeSnapshot\)/);
  assert.match(workflow, /scopeSectionIds: requestedScope/);
  assert.match(workflow, /scopeSelectionProvided: selectionCustomized/);
  const source = executablePopupFunction('runReviewOutlineAnalysis').toString();
  const bindingSource = executablePopupFunction('refreshSidebarRuntimeDocumentBinding').toString();
  const selectionSource = executablePopupFunction('selectedWorkspaceAnalysisSectionIds').toString();
  for (const [customized, options, expected, ids] of [
    [false, {}, false, ['section-A']], [true, {}, true, ['section-A']],
    [true, { scopeSelectionProvided: false }, false, ['section-A']],
    [false, { scopeSelectionProvided: true, scopeSectionIds: ['section-B'] }, true, ['section-B']],
    [false, { scopeSelectionProvided: true, scopeSectionIds: [] }, true, []]
  ]) {
    const messages = [], statuses = [];
    const url = 'https://example.org/paper-A';
    const world = 'paper-A-content-world';
    const snapshot = {
      documentId: 'paper-A', documentHash: 'hash-A', url, revision: 3,
      documentGeneration: 4, figures: { workspaceLifecycle: 5 },
      analysisSelectionCustomized: customized,
      nodes: ids.map(id => ({ analysisSelected: true, analysisSectionIds: [id] }))
    };
    const context = vm.createContext({
      reviewOutlineTaskGeneration: 2, capturePanelContext: () => ({ tabId: 41, key: 'paper-A', url }),
      isCurrentPanelContext: () => true,
      isCurrentReviewOutlineTask: () => true, requireUsableLlm: () => true,
      // Prepared identity may differ; the request must use the selected source snapshot.
      preparedDocumentState: { documentId: 'prepared-A', documentHash: 'prepared-hash-A', document: { paragraphs: [] } },
      currentWorkspaceSnapshot: snapshot, reviewOutlineState: {},
      workspaceAnalysisSelectionPending: new Map(), sidebarRuntimeDocumentBinding: null,
      SciLLM: { normalizeTabDocumentUrl: value => new URL(value).href },
      showStatus: (...args) => statuses.push(args), updateReviewOutlineButton() {},
      startReviewOutlineProgressPolling() {}, stopReviewOutlineProgressPolling() {},
      isSidebarOperationStopping: () => false,
      sendTabMessage: async (tabId, message) => {
        assert.equal(tabId, 41);
        messages.push({ tabId, message });
        if (message.action === 'getContentScriptRevision') {
          return { documentIdentity: world, navigationIdentity: url };
        }
        assert.equal(message.expectedDocumentIdentity, world);
        assert.equal(message.expectedNavigationIdentity, url);
        if (message.action === 'getArticleWorkspaceSnapshot') return { success: true, snapshot };
        assert.equal(message.action, 'analyzeReviewOutlineWithLLM');
        return { success: true, outline: { paragraphCount: 0 } };
      },
      acceptSidebarRuntimeTask() {}, refreshArticleWorkspace: async () => {}, persistCurrentArticleArchive: async () => {},
      refreshReviewOutlineProgress: async () => { throw new Error('unexpected failure path'); }
    });
    vm.runInContext('globalThis.refreshSidebarRuntimeDocumentBinding = ' + bindingSource + ';\n' +
      'globalThis.selectedWorkspaceAnalysisSectionIds = ' + selectionSource + ';\n' +
      'globalThis.run = ' + source, context);
    const result = await context.run({ ...options, operationId: 'outline-A' });
    const dispatches = messages.filter(({ message }) => message.action === 'analyzeReviewOutlineWithLLM');
    assert.equal(dispatches.length, ids.length ? 1 : 0);
    const snapshotReads = messages.filter(({ message }) => message.action === 'getArticleWorkspaceSnapshot');
    assert.equal(snapshotReads.length, ids.length ? 3 : 2, 'canonical proof and live scope checks remain required');
    const worldProbes = messages.filter(({ message }) => message.action === 'getContentScriptRevision');
    assert.equal(worldProbes.length, ids.length ? 2 : 1, 'world is checked before dispatch and before consuming completion');
    if (!ids.length) {
      assert.deepEqual(plain(result), { notStarted: true });
      assert.equal(statuses.at(-1)[1], 'warning');
      assert.match(statuses.at(-1)[0], /当前没有发送模型请求/);
      continue;
    }
    assert.equal(dispatches[0].message.documentId, 'paper-A');
    assert.equal(dispatches[0].message.documentHash, 'hash-A');
    assert.equal(dispatches[0].message.operationId, 'outline-A');
    assert.equal(dispatches[0].message.scopeSelectionProvided, expected);
    assert.deepEqual(plain(dispatches[0].message.scopeSectionIds), ids);
    assert.equal(statuses.at(-1)[1], 'success');
  }
});

test('navigation renders immersive heading translations as a secondary line', () => {
  const popup = read('popup.js');
  const popupStyles = read('popup.css');
  const extractor = read('core/article-extractor.js');
  const structure = read('core/article-structure.js');
  assert.match(extractor, /INJECTED_TRANSLATION_SELECTOR/);
  assert.match(extractor, /function bilingualHeadingDisplayText/);
  assert.match(extractor, /join\('\\n'\)/);
  assert.match(structure, /function normalizeDisplay/);
  assert.match(popup, /function renderWorkspaceBilingualTitle/);
  assert.match(popup, /workspace-tree-title-translation/);
  assert.match(popupStyles, /\.workspace-tree-title-translation/);
});

test('manual selection toolbar can add an abbreviation to the article workspace', () => {
  const content = read('content.js');
  const styles = read('content.css');
  assert.match(content, /function appendManualAbbreviationEditor/);
  assert.match(content, /加入缩略词表/);
  assert.doesNotMatch(
    content,
    /if \(!currentManualRebindId\) \{\s*const abbreviationPanel = appendManualAbbreviationEditor/
  );
  const editor = executableContentFunction('appendManualAbbreviationEditor').toString();
  assert.match(editor, /makeManualButton\('加入缩略词表', 'sci-manual-primary-action'\)/);
  assert.match(editor, /paragraphId: descriptor\?\.blockId/);
  assert.match(editor, /sourceKey: descriptor\?\.blockId/);
  assert.match(editor, /navigationRevision: currentArticleStructure\?\.revision/);
  assert.match(editor, /await addCurrentArticleAbbreviation\(entry\)/);
  assert.match(editor, /options\.isCurrent && !options\.isCurrent\(\)/);
  assert.match(content, /addCurrentArticleAbbreviation/);
  assert.match(
    content,
    /function handleManualSelectionChange\(\)[\s\S]*manualClosest\(document\.activeElement, MANUAL_UI_SELECTOR\)/
  );
  assert.match(content, /annotations\/abbreviations\.json/);
  assert.match(styles, /\.sci-manual-abbreviation-panel/);
  assert.match(styles, /\.sci-manual-abbreviation-fields/);
});

test('analysis modes remain selectable in regex mode and preserve mode-specific highlights', () => {
  const popup = read('popup.js');
  const content = read('content.js');
  const updateStart = popup.indexOf('function updateAnalysisModeUi');
  const updateEnd = popup.indexOf('async function refreshLlmDiagnostics', updateStart);
  assert.match(popup.slice(updateStart, updateEnd), /llmAdaptiveControls'\)\.hidden = false/);
  assert.match(popup, /function reconcileRegexSelection/);
  assert.match(content, /dataset\.analysisModeId/);
  assert.match(content, /clearHighlight\(analysisModeId = '', preserveOperation = false\)/);
  assert.match(content, /if \(!preserveOperation\) this\.cancelRegexOperation\(\)/);
  assert.match(content, /clearLlmHighlights\(analysisModeId = ''\)/);
  assert.match(content, /options\.readingViewId \|\| 'llm-default'/);
  assert.match(content, /readingViewId:\s*request\.readingViewId/);
});

test('notes are an independent bottom module with persistent storage and AI filling', () => {
  const html = read('popup.html');
  const script = read('popup.js');
  assert.doesNotMatch(html, /id="sidePanelLanguage"/);
  const notes = html.match(/<button[^>]*id="openLiteratureNote"[^>]*>[\s\S]*?<\/button>/)[0];
  assert.match(notes, /data-workspace-target="notes"/);
  assert.match(notes, /aria-controls="literatureNoteDrawer"/);
  assert.match(notes, /aria-label="笔记"/);
  assert.match(notes, /<svg[^>]*aria-hidden="true"/);
  assert.doesNotMatch(html.match(/<header id="sidePanelHeader"[\s\S]*?<\/header>/)[0], /id="openLiteratureNote"/);
  assert.match(read('vendor/phosphor/icons.css'), /\.ph\.ph-note-pencil::before/);
  assert.match(html, /id="literatureNoteDrawer"/);
  assert.match(html, /id="literatureNoteTemplateSelect"/);
  assert.match(html, /id="literatureNoteFields"/);
  assert.match(html, /id="autofillLiteratureNote"/);
  assert.match(script, /function renderLiteratureNoteDrawer\(/);
  assert.match(script, /lastLiteratureNoteTemplateId/);
  assert.match(script, /LLM_UPDATE_PREFERENCES/);
  assert.match(script, /LITERATURE_NOTE_STORAGE_KEY/);
  assert.match(script, /LITERATURE_NOTE_WORKSPACE_PATH\s*=\s*'annotations\/literature-note\.json'/);
  assert.match(script, /ARTICLE_WORKSPACE_GET_ASSET/);
  assert.match(script, /ARTICLE_WORKSPACE_SAVE_ASSET/);
  assert.match(script, /literatureNoteDirtyFields/);
  assert.match(script, /function autofillLiteratureNoteWithLLM/);
  assert.match(script, /action:\s*'autofillLiteratureNoteWithLLM'/);
});

test('side panel renders active-tab LLM heartbeat stages instead of an indefinite spinner', () => {
  const script = read('popup.js');
  assert.match(script, /function formatPanelLlmOperationProgress/);
  assert.match(script, /message\?\.type === 'LLM_OPERATION_PROGRESS'/);
  assert.match(script, /Number\(sender\?\.tab\?\.id\) === Number\(activePanelTabContext\.tabId\)/);
  assert.match(script, /provider_waiting/);
  assert.match(script, /literature_note_schema_retry/);
  assert.match(script, /literature_note_fail_closed/);
  assert.match(script, /mechanism_coverage_fail_closed/);
  assert.match(script, /mechanism_edge_batch_repair/);
  assert.match(script, /mechanism_vocabulary_repair/);
});

test('mechanism generation controller rejects stale operations and exposes long-run state only on live heartbeats', async () => {
  const { createMechanismGenerationUiController, createMechanismOperationId } =
    loadPopupUiHelpers();
  const ids = new Set(Array.from({ length: 128 }, () =>
    createMechanismOperationId(123456, { randomUUID: () => '01234567-89ab-cdef-0123-456789abcdef' })
  ));
  assert.equal(ids.size, 128, 'the bounded local sequence must keep operation IDs unique');
  for (const id of ids) {
    assert.match(id, /^mechanism:[A-Za-z0-9:._-]{8,90}$/u);
    assert.ok(id.length <= 100);
  }
  let now = 1000;
  const cancelled = [];
  const controller = createMechanismGenerationUiController({
    now: () => now,
    cancel: async operation => {
      cancelled.push(operation.operationId);
      return { success: true, cancelled: true, operationId: operation.operationId,
        epoch: operation.epoch };
    }
  });
  const binding = {
    documentId: 'sha256:document', workspaceId: `workspace:${'c'.repeat(64)}`,
    workspaceGeneration: 2, workspaceLifecycle: 5, baseWorkspaceRevision: 9,
    mechanismChainFingerprint: 'mechanism-chain-v1-abcdef01'
  };
  const operationA = { operationId: 'mechanism:a-1234567890', epoch: 0, binding };
  const operationB = { operationId: 'mechanism:b-1234567890', epoch: 0, binding };
  controller.start(operationA);
  assert.equal(controller.progress({
    phase: 'collecting_panel_evidence', operationId: operationA.operationId,
    operationEpoch: 1, progressSequence: 1, ...binding
  }), true);
  now = 61_500;
  assert.equal(controller.progress({
    phase: 'collecting_panel_evidence', operationId: operationA.operationId,
    operationEpoch: 1, progressSequence: 2, ...binding
  }), true);
  assert.equal(controller.presentation().stillProcessing, true);
  now = 92_000;
  assert.equal(controller.presentation().stillProcessing, false,
    'still-processing copy must expire when legal heartbeats stop');
  controller.start(operationB);
  assert.equal(controller.progress({
    phase: 'assembling_graph', operationId: operationA.operationId,
    operationEpoch: 1, progressSequence: 3, ...binding
  }), false);
  assert.equal(controller.complete({
    status: 'complete', operationId: operationA.operationId, operationEpoch: 1, ...binding
  }), false, 'late A success must not replace B');
  assert.equal(controller.progress({
    phase: 'canonicalizing_nodes', operationId: operationB.operationId,
    operationEpoch: 2, progressSequence: 1, completed: 6, total: 6, ...binding
  }), true);
  now = 100_000;
  for (let index = 0; index < 50; index += 1) controller.presentation();
  assert.equal(controller.presentation().stillProcessing, false,
    'elapsed UI reads must never refresh the last upstream heartbeat');
  assert.equal(controller.progress({
    phase: 'mapping_claim_relations', operationId: operationB.operationId,
    operationEpoch: 2, progressSequence: 2, completed: 0, total: 0, ...binding
  }), true);
  assert.equal(controller.presentation().completed, 0,
    'a new stage must not inherit the previous stage count');
  assert.equal(controller.presentation().total, 0);
  assert.equal(controller.progress({
    phase: 'mapping_claim_relations', operationId: operationB.operationId,
    operationEpoch: 2, progressSequence: 3, completed: 2, total: 8, ...binding
  }), true);
  assert.equal(controller.progress({
    phase: 'mapping_claim_relations', operationId: operationB.operationId,
    operationEpoch: 2, progressSequence: 4, completed: 1, total: 8, ...binding
  }), true);
  assert.equal(controller.presentation().completed, 2,
    'counts remain monotonic within the same stage');
  const firstCancel = controller.cancel();
  const secondCancel = controller.cancel();
  assert.equal(firstCancel, secondCancel, 'cancel must be idempotent while durable work is pending');
  assert.equal(controller.presentation().status, 'cancelling');
  await firstCancel;
  assert.deepEqual(cancelled, [operationB.operationId]);
  assert.equal(controller.presentation().status, 'cancelled');
  assert.equal(controller.complete({
    status: 'complete', operationId: operationB.operationId, operationEpoch: 2, ...binding
  }), false, 'late success after cancellation must be ignored');
});

test('mechanism progress and terminal reports require the exact evidence-first tuple', () => {
  const { createMechanismGenerationUiController } = loadPopupUiHelpers();
  const versions = EvidenceFirstMechanism.EVIDENCE_FIRST_VERSIONS;
  const binding = {
    documentId: 'sha256:versioned-reports', workspaceId: `workspace:${'d'.repeat(64)}`,
    workspaceGeneration: 2, workspaceLifecycle: 6, baseWorkspaceRevision: 10,
    mechanismChainFingerprint: 'mechanism-chain-v1-aabbccdd'
  };
  const operationId = 'mechanism:versioned-reports-12345678';
  const invalidTuples = [undefined, ...Object.keys(versions).map(key => ({
    ...versions, [key]: `${versions[key]}-old`
  }))];
  for (const evidenceFirstVersions of invalidTuples) {
    const controller = createMechanismGenerationUiController({
      normalizeEvidenceFirstVersions: EvidenceFirstMechanism.normalizeEvidenceFirstVersions
    });
    controller.start({ operationId, epoch: 0, binding, evidenceFirstVersions: versions });
    assert.equal(controller.progress({
      phase: 'collecting_panel_evidence', operationId, operationEpoch: 1,
      progressSequence: 1, completed: 1, total: 2,
      evidenceFirstVersions, ...binding
    }), false);
    assert.equal(controller.complete({
      status: 'complete', operationId, operationEpoch: 1,
      evidenceFirstVersions, ...binding
    }), false);
    assert.equal(controller.presentation().status, 'queued');
  }
  const current = createMechanismGenerationUiController({
    normalizeEvidenceFirstVersions: EvidenceFirstMechanism.normalizeEvidenceFirstVersions
  });
  current.start({ operationId, epoch: 0, binding, evidenceFirstVersions: versions });
  assert.equal(current.progress({
    phase: 'collecting_panel_evidence', operationId, operationEpoch: 1,
    progressSequence: 1, completed: 1, total: 2,
    evidenceFirstVersions: versions, ...binding
  }), true);
  assert.equal(current.complete({
    status: 'complete', operationId, operationEpoch: 1,
    evidenceFirstVersions: versions, ...binding
  }), true);
});

test('mechanism controller restores only an exact active live snapshot', () => {
  const {
    createMechanismGenerationUiController,
    restoreMechanismGenerationControllerFromWorkspaceSnapshot
  } = loadPopupUiHelpers();
  let now = 80_000;
  const binding = {
    documentId: 'sha256:restore-document', workspaceId: `workspace:${'e'.repeat(64)}`,
    workspaceGeneration: 8, workspaceLifecycle: 21, baseWorkspaceRevision: 34,
    mechanismChainFingerprint: 'mechanism-chain-v1-feedbeef'
  };
  const controller = createMechanismGenerationUiController({ now: () => now });
  const snapshot = {
    operation: {
      operationId: 'mechanism:restore-live-12345678', epoch: 5, binding,
      startedAt: 1000, cancelled: false
    },
    status: 'working',
    progress: {
      stage: 'assembling_graph', completed: 3, total: 7,
      elapsedSeconds: 79, heartbeatAt: 75_000, progressSequence: 5
    }
  };
  assert.equal(controller.restore(snapshot, binding), true);
  assert.equal(controller.presentation().stage, 'assembling_graph');
  assert.equal(controller.presentation().completed, 3);
  assert.equal(controller.presentation().cancellable, true);
  assert.equal(controller.restore({ ...snapshot, status: 'complete' }, binding), false);
  assert.equal(createMechanismGenerationUiController({ now: () => now }).restore(
    snapshot, { ...binding, baseWorkspaceRevision: 35 }
  ), false, 'a stale workspace binding must fail closed');
  assert.equal(createMechanismGenerationUiController({ now: () => now }).restore({
    ...snapshot, progress: { ...snapshot.progress, stage: 'provider_waiting' }
  }, binding), false);
  const terminalController = createMechanismGenerationUiController({ now: () => now });
  terminalController.start({ operationId: snapshot.operation.operationId, epoch: 5, binding });
  assert.equal(terminalController.complete({
    status: 'complete', operationId: snapshot.operation.operationId,
    operationEpoch: 5, ...binding
  }), true);
  assert.equal(terminalController.restore(snapshot, binding), false,
    'a late working snapshot cannot reopen a locally terminal operation');

  const liveWorkspaceSnapshot = {
    documentId: binding.documentId,
    localWorkspace: {
      workspaceId: binding.workspaceId,
      workspaceGeneration: binding.workspaceGeneration
    },
    figures: {
      workspaceLifecycle: binding.workspaceLifecycle,
      draft: { revision: binding.baseWorkspaceRevision, mechanismChain: {
        nodes: [{ id: 'old-node' }], edges: []
      } },
      crossFigureLogic: snapshot
    }
  };
  const reopened = createMechanismGenerationUiController({ now: () => now });
  assert.equal(restoreMechanismGenerationControllerFromWorkspaceSnapshot(
    reopened, liveWorkspaceSnapshot, '', { stableHash: () => 'feedbeef' }
  ), true, 'a live side-panel snapshot restores the exact cancellable operation');
  assert.equal(reopened.presentation().operation.operationId,
    snapshot.operation.operationId);
  const staleWorkspace = {
    ...liveWorkspaceSnapshot,
    figures: {
      ...liveWorkspaceSnapshot.figures,
      draft: { ...liveWorkspaceSnapshot.figures.draft, revision: 35 }
    }
  };
  assert.equal(restoreMechanismGenerationControllerFromWorkspaceSnapshot(
    createMechanismGenerationUiController({ now: () => now }),
    staleWorkspace, '', { stableHash: () => 'feedbeef' }
  ), false);
});

test('live snapshot refresh cannot roll a cancelling mechanism operation back to working', async () => {
  const { createMechanismGenerationUiController } = loadPopupUiHelpers();
  let releaseCancel;
  const binding = {
    documentId: 'sha256:cancel-restore', workspaceId: `workspace:${'3'.repeat(64)}`,
    workspaceGeneration: 2, workspaceLifecycle: 8, baseWorkspaceRevision: 4,
    mechanismChainFingerprint: 'mechanism-chain-v1-33445566'
  };
  const operationId = 'mechanism:cancel-restore-12345678';
  const controller = createMechanismGenerationUiController({
    cancel: () => new Promise(resolve => { releaseCancel = resolve; })
  });
  controller.start({ operationId, epoch: 1, binding });
  const cancelPromise = controller.cancel();
  assert.equal(controller.presentation().status, 'cancelling');
  assert.equal(controller.progress({
    phase: 'repairing_unresolved', operationId, operationEpoch: 1,
    progressSequence: 1, completed: 2, total: 2, ...binding
  }), false, 'progress after the local cancel tombstone must be ignored synchronously');
  assert.equal(controller.presentation().status, 'cancelling');
  assert.equal(controller.restore({
    operation: { operationId, epoch: 1, binding,
      startedAt: Date.now() - 1000, cancelled: false },
    status: 'working',
    progress: { stage: 'assembling_graph', completed: 1, total: 2,
      heartbeatAt: Date.now(), progressSequence: 1 }
  }, binding), false);
  assert.equal(controller.presentation().status, 'cancelling');
  await Promise.resolve();
  releaseCancel({ success: true, cancelled: true, operationId, epoch: 1 });
  await cancelPromise;
  assert.equal(controller.presentation().status, 'cancelled');
});

test('terminal-linearized cancel rejection stays pending for the final complete response', async () => {
  const { createMechanismGenerationUiController } = loadPopupUiHelpers();
  const binding = {
    documentId: 'sha256:terminal-cancel-ui', workspaceId: `workspace:${'7'.repeat(64)}`,
    workspaceGeneration: 12, workspaceLifecycle: 42, baseWorkspaceRevision: 18,
    mechanismChainFingerprint: 'mechanism-chain-v1-7788aabb'
  };
  const operationId = 'mechanism:terminal-cancel-ui-12345678';
  const controller = createMechanismGenerationUiController({
    cancel: async operation => ({
      success: true, active: false, cancelled: false,
      operationId: operation.operationId, epoch: operation.epoch
    })
  });
  controller.start({ operationId, epoch: 1, binding });
  const cancellation = await controller.cancel();
  assert.equal(cancellation.success, true);
  assert.equal(cancellation.cancelled, false);
  assert.equal(controller.presentation().status, 'working',
    'a terminal-linearized rejection must not poison the pending final response');
  assert.equal(controller.presentation().cancellable, false);
  assert.equal(controller.complete({
    status: 'complete', operationId, operationEpoch: 1, ...binding
  }), true);
  assert.equal(controller.presentation().status, 'complete');
});

test('production live-snapshot restore rebinds the original cancellable tab operation', async () => {
  const helpers = loadPopupUiHelpers();
  const binding = {
    documentId: 'sha256:reopen-production', workspaceId: `workspace:${'4'.repeat(64)}`,
    workspaceGeneration: 9, workspaceLifecycle: 31, baseWorkspaceRevision: 12,
    mechanismChainFingerprint: 'mechanism-chain-v1-cafebabe'
  };
  const operationId = 'mechanism:reopen-production-12345678';
  const snapshot = {
    documentId: binding.documentId,
    localWorkspace: {
      workspaceId: binding.workspaceId,
      workspaceGeneration: binding.workspaceGeneration
    },
    figures: {
      workspaceLifecycle: binding.workspaceLifecycle,
      draft: { revision: binding.baseWorkspaceRevision,
        mechanismChain: { nodes: [], edges: [] } },
      crossFigureLogic: {
        operation: { operationId, epoch: 7, binding,
          startedAt: Date.now() - 30_000, cancelled: false },
        status: 'working',
        progress: { stage: 'repairing_unresolved', completed: 2, total: 5,
          heartbeatAt: Date.now() - 1000, progressSequence: 7 }
      }
    }
  };
  const cancelled = [];
  const created = [];
  const current = helpers.createMechanismGenerationUiController();
  const restore = executablePopupFunction('restoreMechanismGenerationFromLiveSnapshot', {
    activePanelTabContext: { tabId: 77 }, preparedDocumentState: null,
    manualAnnotationState: { documentId: '' },
    createLiveMechanismGenerationUiController: tabId => {
      const controller = helpers.createMechanismGenerationUiController({
        cancel: async operation => {
          cancelled.push({ tabId, operation });
          return { success: true, cancelled: true,
            operationId: operation.operationId, epoch: operation.epoch };
        }
      });
      created.push(controller);
      return controller;
    },
    restoreMechanismGenerationControllerFromWorkspaceSnapshot:
      helpers.restoreMechanismGenerationControllerFromWorkspaceSnapshot,
    SciLLM: { stableHash: () => 'cafebabe' },
    mechanismGenerationUiController: current,
    activeMechanismGenerationTabId: null,
    stopMechanismGenerationElapsedTimer: () => undefined,
    renderMechanismGenerationStatus: () => undefined
  });
  assert.equal(restore(snapshot, { tabId: 77 }), true);
  assert.equal(created[0].presentation().stage, 'repairing_unresolved');
  assert.equal(created[0].presentation().progressSequence, 7,
    'a reopened panel must preserve the content checkpoint ordinal');
  assert.equal(created[0].presentation().cancellable, true);
  await created[0].cancel();
  assert.equal(cancelled.length, 1);
  assert.equal(cancelled[0].tabId, 77);
  assert.equal(cancelled[0].operation.operationId, operationId);
  assert.deepEqual(plain(cancelled[0].operation.binding), binding);
});

test('stale live snapshot A cannot cancel or replace the active newer operation B', () => {
  const helpers = loadPopupUiHelpers();
  const binding = {
    documentId: 'sha256:restore-newer-operation',
    workspaceId: `workspace:${'5'.repeat(64)}`,
    workspaceGeneration: 10, workspaceLifecycle: 40, baseWorkspaceRevision: 16,
    mechanismChainFingerprint: 'mechanism-chain-v1-abcd1234'
  };
  const operationA = 'mechanism:stale-snapshot-a-12345678';
  const operationB = 'mechanism:active-newer-b-12345678';
  let cancelledB = 0;
  const current = helpers.createMechanismGenerationUiController({
    now: () => 20_000,
    cancel: async () => { cancelledB += 1; return { success: true, cancelled: true }; }
  });
  current.start({ operationId: operationB, epoch: 1, binding });
  current.progress({
    phase: 'mapping_claim_relations', operationId: operationB,
    operationEpoch: 1, progressSequence: 1, completed: 4, total: 8, ...binding
  });
  const staleSnapshot = {
    documentId: binding.documentId,
    localWorkspace: {
      workspaceId: binding.workspaceId,
      workspaceGeneration: binding.workspaceGeneration
    },
    figures: {
      workspaceLifecycle: binding.workspaceLifecycle,
      draft: { revision: binding.baseWorkspaceRevision,
        mechanismChain: { nodes: [], edges: [] } },
      crossFigureLogic: {
        operation: { operationId: operationA, epoch: 1, binding,
          startedAt: 10_000, cancelled: false },
        status: 'working',
        progress: { stage: 'canonicalizing_nodes', completed: 2, total: 8,
          heartbeatAt: 19_000, progressSequence: 1 }
      }
    }
  };
  const restore = executablePopupFunction('restoreMechanismGenerationFromLiveSnapshot', {
    activePanelTabContext: { tabId: 77 }, preparedDocumentState: null,
    manualAnnotationState: { documentId: '' },
    createLiveMechanismGenerationUiController: () =>
      helpers.createMechanismGenerationUiController({ now: () => 20_000 }),
    restoreMechanismGenerationControllerFromWorkspaceSnapshot:
      helpers.restoreMechanismGenerationControllerFromWorkspaceSnapshot,
    SciLLM: { stableHash: () => 'abcd1234' },
    mechanismGenerationUiController: current,
    activeMechanismGenerationTabId: 77,
    stopMechanismGenerationElapsedTimer: () => undefined,
    renderMechanismGenerationStatus: () => undefined
  });
  assert.equal(restore(staleSnapshot, { tabId: 77 }), false);
  assert.equal(cancelledB, 0, 'a stale snapshot must never issue cancellation for active B');
  assert.equal(current.presentation().operation.operationId, operationB);
  assert.equal(current.presentation().stage, 'mapping_claim_relations');
});

test('working snapshot A cannot replace a terminal controller B that still owns an operation', () => {
  const helpers = loadPopupUiHelpers();
  const binding = {
    documentId: 'sha256:terminal-restore-owner',
    workspaceId: `workspace:${'8'.repeat(64)}`,
    workspaceGeneration: 13, workspaceLifecycle: 43, baseWorkspaceRevision: 19,
    mechanismChainFingerprint: 'mechanism-chain-v1-8899ccdd'
  };
  const operationA = 'mechanism:working-snapshot-a-12345678';
  const operationB = 'mechanism:terminal-owner-b-12345678';
  const current = helpers.createMechanismGenerationUiController({ now: () => 20_000 });
  current.start({ operationId: operationB, epoch: 1, binding });
  assert.equal(current.complete({
    status: 'complete', operationId: operationB, operationEpoch: 1, ...binding
  }), true);
  const snapshot = {
    documentId: binding.documentId,
    localWorkspace: {
      workspaceId: binding.workspaceId,
      workspaceGeneration: binding.workspaceGeneration
    },
    figures: {
      workspaceLifecycle: binding.workspaceLifecycle,
      draft: { revision: binding.baseWorkspaceRevision,
        mechanismChain: { nodes: [], edges: [] } },
      crossFigureLogic: {
        operation: { operationId: operationA, epoch: 1, binding,
          startedAt: 10_000, cancelled: false },
        status: 'working',
        progress: { stage: 'assembling_graph', completed: 2, total: 6,
          heartbeatAt: 19_000, progressSequence: 1 }
      }
    }
  };
  const restore = executablePopupFunction('restoreMechanismGenerationFromLiveSnapshot', {
    activePanelTabContext: { tabId: 77 }, preparedDocumentState: null,
    manualAnnotationState: { documentId: '' },
    createLiveMechanismGenerationUiController: () =>
      helpers.createMechanismGenerationUiController({ now: () => 20_000 }),
    restoreMechanismGenerationControllerFromWorkspaceSnapshot:
      helpers.restoreMechanismGenerationControllerFromWorkspaceSnapshot,
    SciLLM: { stableHash: () => '8899ccdd' },
    mechanismGenerationUiController: current,
    activeMechanismGenerationTabId: 77,
    stopMechanismGenerationElapsedTimer: () => undefined,
    renderMechanismGenerationStatus: () => undefined
  });
  assert.equal(restore(snapshot, { tabId: 77 }), false);
  assert.equal(current.presentation().operation.operationId, operationB);
  assert.equal(current.presentation().status, 'complete');
});

test('same-operation restore rejects epoch heartbeat and stage regressions', () => {
  const { createMechanismGenerationUiController } = loadPopupUiHelpers();
  let now = 1000;
  const binding = {
    documentId: 'sha256:restore-monotonic', workspaceId: `workspace:${'6'.repeat(64)}`,
    workspaceGeneration: 11, workspaceLifecycle: 41, baseWorkspaceRevision: 17,
    mechanismChainFingerprint: 'mechanism-chain-v1-abcdef12'
  };
  const operationId = 'mechanism:restore-monotonic-12345678';
  const controller = createMechanismGenerationUiController({ now: () => now });
  controller.start({ operationId, epoch: 0, binding });
  now = 9000;
  assert.equal(controller.progress({
    phase: 'mapping_claim_relations', operationId, operationEpoch: 1,
    progressSequence: 1, completed: 5, total: 9, ...binding
  }), true);
  const before = plain(controller.presentation());
  assert.equal(controller.restore({
    operation: { operationId, epoch: 0, binding,
      startedAt: 1000, cancelled: false },
    status: 'working',
    progress: { stage: 'collecting_panel_evidence', completed: 1, total: 9,
      heartbeatAt: 5000, progressSequence: 0 }
  }, binding), false);
  assert.deepEqual(plain(controller.presentation()), before,
    'a stale same-operation snapshot must leave the live controller untouched');
  assert.equal(controller.restore({
    operation: { operationId, epoch: 1, binding,
      startedAt: 999, cancelled: false },
    status: 'working',
    progress: { stage: 'assembling_graph', completed: 1, total: 9,
      heartbeatAt: 9500, progressSequence: 2 }
  }, binding), false, 'startedAt is part of the immutable operation identity');
});

test('same-operation restore accepts router repair transitions into canonicalization or assembly', () => {
  const { createMechanismGenerationUiController } = loadPopupUiHelpers();
  const binding = {
    documentId: 'sha256:repair-transitions', workspaceId: `workspace:${'9'.repeat(64)}`,
    workspaceGeneration: 14, workspaceLifecycle: 44, baseWorkspaceRevision: 20,
    mechanismChainFingerprint: 'mechanism-chain-v1-99aabbcc'
  };
  const operationId = 'mechanism:repair-transitions-12345678';
  const restoreAfterRepair = nextStage => {
    let now = 1000;
    const controller = createMechanismGenerationUiController({ now: () => now });
    controller.start({ operationId, epoch: 0, binding });
    now = 5000;
    assert.equal(controller.progress({
      phase: 'repairing_unresolved', operationId, operationEpoch: 1,
      progressSequence: 1, completed: 2, total: 4, ...binding
    }), true);
    now = 7000;
    assert.equal(controller.restore({
      operation: { operationId, epoch: 1, binding,
        startedAt: 1000, cancelled: false },
      status: 'working',
      progress: { stage: nextStage, completed: 0, total: 8,
        heartbeatAt: 7000, progressSequence: 2 }
    }, binding), true);
    return controller.presentation();
  };
  assert.equal(restoreAfterRepair('canonicalizing_nodes').stage, 'canonicalizing_nodes');
  assert.equal(restoreAfterRepair('assembling_graph').stage, 'assembling_graph');
});

test('mechanism restore uses a strict progress checkpoint when heartbeat timestamps tie', () => {
  const { createMechanismGenerationUiController } = loadPopupUiHelpers();
  let now = 1000;
  const binding = {
    documentId: 'sha256:restore-checkpoint', workspaceId: `workspace:${'a'.repeat(64)}`,
    workspaceGeneration: 15, workspaceLifecycle: 45, baseWorkspaceRevision: 21,
    mechanismChainFingerprint: 'mechanism-chain-v1-aabbccdd'
  };
  const operationId = 'mechanism:restore-checkpoint-12345678';
  const controller = createMechanismGenerationUiController({ now: () => now });
  controller.start({ operationId, epoch: 0, binding });
  now = 9000;
  assert.equal(controller.progress({
    phase: 'mapping_claim_relations', operationId, operationEpoch: 1,
    progressSequence: 1, completed: 5, total: 9, ...binding
  }), true);
  assert.equal(controller.presentation().progressSequence, 1);
  now = 65_000;
  assert.equal(controller.progress({
    phase: 'mapping_claim_relations', operationId, operationEpoch: 1,
    progressSequence: 1, completed: 6, total: 9, ...binding
  }), false, 'a replayed checkpoint is not a legal upstream heartbeat');
  assert.equal(controller.presentation().progressSequence, 1,
    'reading elapsed state must not synthesize an upstream checkpoint');
  assert.equal(controller.presentation().stillProcessing, false,
    'a duplicate checkpoint must not refresh the legal heartbeat deadline');
  const before = plain(controller.presentation());
  assert.equal(controller.restore({
    operation: { operationId, epoch: 1, binding,
      startedAt: 1000, cancelled: false },
    status: 'working',
    progress: { stage: 'canonicalizing_nodes', completed: 0, total: 9,
      heartbeatAt: 9000, progressSequence: 1 }
  }, binding), false,
  'equal-ms older snapshots cannot use a reachable SCC path to roll stage backward');
  assert.deepEqual(plain(controller.presentation()), before);
  assert.equal(controller.restore({
    operation: { operationId, epoch: 1, binding,
      startedAt: 1000, cancelled: false },
    status: 'working',
    progress: { stage: 'repairing_unresolved', completed: 0, total: 9,
      heartbeatAt: 9000, progressSequence: 2 }
  }, binding), true);
  assert.equal(controller.presentation().progressSequence, 2);
});

test('higher mechanism checkpoint outranks an older producer heartbeat across channels', () => {
  const { createMechanismGenerationUiController } = loadPopupUiHelpers();
  let now = 5000;
  const binding = {
    documentId: 'sha256:cross-channel-checkpoint',
    workspaceId: `workspace:${'b'.repeat(64)}`,
    workspaceGeneration: 20, workspaceLifecycle: 50, baseWorkspaceRevision: 26,
    mechanismChainFingerprint: 'mechanism-chain-v1-bb223344'
  };
  const operationId = 'mechanism:cross-channel-checkpoint-12345678';
  const controller = createMechanismGenerationUiController({ now: () => now });
  controller.start({ operationId, epoch: 0, binding });
  assert.equal(controller.progress({
    phase: 'mapping_claim_relations', operationId, operationEpoch: 1,
    progressSequence: 1, heartbeatAt: 4000, completed: 2, total: 6, ...binding
  }), true);
  const replay = {
    operation: { operationId, epoch: 1, binding,
      startedAt: 5000, cancelled: false },
    status: 'working',
    progress: { stage: 'mapping_claim_relations', completed: 2, total: 6,
      heartbeatAt: 4000, progressSequence: 1 }
  };
  now = 6000;
  assert.equal(controller.restore(replay, binding), false,
    'an equal checkpoint is a replay and cannot refresh local receipt freshness');
  assert.equal(controller.restore({
    ...replay,
    progress: { stage: 'repairing_unresolved', completed: 0, total: 6,
      heartbeatAt: 4500, progressSequence: 2 }
  }, binding), true,
  'a higher checkpoint must be accepted even when producer time predates local receipt time');
  assert.equal(controller.presentation().progressSequence, 2);
  assert.equal(controller.presentation().stage, 'repairing_unresolved');
  assert.equal(controller.presentation().producerHeartbeatAt, 4500);
});

test('mechanism production wrappers preserve one exact v2 identity from popup to background', () => {
  const { createEvidenceFirstMechanismPopupRequest } = loadPopupUiHelpers();
  const versions = EvidenceFirstMechanism.EVIDENCE_FIRST_VERSIONS;
  const SciLLM = EvidenceFirstMechanism;
  const binding = Object.freeze({
    documentId: 'sha256:production-document',
    workspaceId: `workspace:${'d'.repeat(64)}`,
    workspaceGeneration: 7, workspaceLifecycle: 13, baseWorkspaceRevision: 21,
    mechanismChainFingerprint: 'mechanism-chain-v1-a1b2c3d4'
  });
  const request = createEvidenceFirstMechanismPopupRequest({
    evidenceFirstVersion: '2', evidenceFirstRouterVersion: '2',
    evidenceFirstVersions: versions,
    operationId: 'mechanism:production-wrapper-12345678',
    ...binding
  }, SciLLM);
  const normalize = executableContentFunction('normalizeEvidenceFirstMechanismRequest', {
    SciLLM
  });
  const normalized = normalize(request, binding);
  const buildBackground = executableContentFunction(
    'buildEvidenceFirstMechanismBackgroundMessage'
  );
  const routed = buildBackground(normalized, { title: 'Bound title' }, [{ figureId: 'f1' }]);
  assert.deepEqual(plain(routed), {
    type: 'LLM_ANALYZE_CROSS_FIGURE_LOGIC',
    evidenceFirstVersion: '2', evidenceFirstRouterVersion: '2',
    evidenceFirstVersions: plain(versions),
    operationId: request.operationId,
    documentId: binding.documentId, workspaceId: binding.workspaceId,
    baseWorkspaceRevision: 21, workspaceGeneration: 7, workspaceLifecycle: 13,
    mechanismChainFingerprint: binding.mechanismChainFingerprint,
    document: { title: 'Bound title' }, figures: [{ figureId: 'f1' }]
  });
  let getterReads = 0;
  const hostile = { ...request };
  Object.defineProperty(hostile, 'workspaceId', {
    enumerable: true,
    get() { getterReads += 1; return binding.workspaceId; }
  });
  assert.throws(() => createEvidenceFirstMechanismPopupRequest(hostile), error =>
    error?.code === 'MECHANISM_REQUEST_INVALID');
  assert.equal(getterReads, 0);
  for (const key of Object.keys(versions)) {
    const stale = {
      ...request,
      evidenceFirstVersions: { ...versions, [key]: `${versions[key]}-old` }
    };
    assert.throws(() => createEvidenceFirstMechanismPopupRequest(stale, SciLLM),
      error => error?.code === 'MECHANISM_REQUEST_INVALID', key);
    assert.throws(() => normalize(stale, binding),
      error => error?.code === 'MECHANISM_REQUEST_INVALID', key);
  }
});

test('mechanism progress UI is accessible, bounded, and contains no final graph semantics', () => {
  const html = read('popup.html');
  const styles = read('popup.css');
  const script = read('popup.js');
  assert.match(html, /id="mechanismGenerationStatus"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(html, /id="mechanismGenerationStage"/);
  assert.match(html, /id="mechanismGenerationDetail"/);
  assert.match(html, /id="cancelMechanismGeneration"[^>]*type="button"/);
  assert.match(html, /aria-controls="mechanismGenerationStatus"/);
  assert.match(styles, /\.mechanism-generation-status/);
  assert.match(styles, /@media[^]*\.mechanism-generation-status/s);
  assert.match(script, /function renderMechanismGenerationStatus/);
  assert.match(script, /function cancelActiveMechanismGeneration/);
  assert.doesNotMatch(
    html.slice(html.indexOf('id="mechanismGenerationStatus"'),
      html.indexOf('id="articleArchivePrompt"')),
    /matrix|mermaid|edge|node/i
  );
});

test('mechanism production run captures immutable revision and fingerprint once and seeds only complete', () => {
  const script = read('popup.js');
  const start = script.indexOf('async function runCrossFigureLogic');
  const end = script.indexOf('async function runReviewOutlineAnalysis', start);
  const run = script.slice(start, end);
  assert.equal((run.match(/captureFigureWorkspaceEditContext\(\)/g) || []).length, 1);
  assert.match(run, /generationContext\.draftRevision/);
  assert.match(run, /generationContext\.mechanismChainFingerprint/);
  assert.match(run, /responseStatus === 'complete'/);
  assert.match(run, /completedResponse = Object\.freeze\(\{/,
    'complete handoff must use a bounded safe projection');
  assert.doesNotMatch(run, /completedResponse = response\s*;/,
    'the raw response object must never reach finalization');
  assert.doesNotMatch(run, /forceRefresh:\s*true/);
  const completionGuard = run.indexOf("responseStatus === 'complete'");
  const handoff = run.indexOf('completedResponse = Object.freeze');
  assert.ok(completionGuard >= 0 && handoff > completionGuard);
});

test('production run rejects a terminal report missing the tuple with zero side effects', async () => {
  const helpers = loadPopupUiHelpers();
  const versions = EvidenceFirstMechanism.EVIDENCE_FIRST_VERSIONS;
  const binding = {
    documentId: 'sha256:popup-production', workspaceId: `workspace:${'6'.repeat(64)}`,
    workspaceGeneration: 5, workspaceLifecycle: 14, draftRevision: 22,
    mechanismChainFingerprint: 'mechanism-chain-v1-66778899'
  };
  const controller = helpers.createMechanismGenerationUiController();
  let captures = 0;
  let finalizes = 0;
  let seeds = 0;
  let refreshes = 0;
  const sent = [];
  const run = executablePopupFunction('runCrossFigureLogic', {
    activeWorkspaceView: 'figures',
    requireUsableLlm: () => true,
    queryPanelTargetTab: async () => ({ id: 41 }),
    figureTaskGeneration: 3,
    isCurrentFigureTask: () => true,
    captureFigureWorkspaceEditContext: () => {
      captures += 1;
      return { ...binding, tabId: 41, contextKey: 'ctx', documentKey: 'doc',
        workspaceCanonicalUrl: 'https://example.test/paper',
        workspaceContentHash: 'a'.repeat(64) };
    },
    capturePanelContext: () => ({ tabId: 41 }),
    isCurrentPanelContext: () => true,
    createMechanismOperationId: () => 'mechanism:popup-production-12345678',
    SciLLM: EvidenceFirstMechanism,
    createEvidenceFirstMechanismPopupRequest:
      helpers.createEvidenceFirstMechanismPopupRequest,
    replaceMechanismGenerationUiController: () => controller,
    mechanismGenerationUiController: controller,
    renderMechanismGenerationStatus: () => undefined,
    sendTabMessage: async (_tabId, request) => {
      sent.push(request);
      const response = {
        success: true, status: 'complete', operationId: request.operationId,
        operationEpoch: 1, workspaceCommitted: true,
        result: { mechanismEdges: [{ from: 'source', to: 'target' }] }
      };
      return response;
    },
    isSeedableMechanismGenerationResult:
      helpers.isSeedableMechanismGenerationResult,
    mechanismGenerationOwnData: helpers.mechanismGenerationOwnData,
    mechanismGenerationStatusLabel: () => '',
    showStatus: () => undefined,
    switchWorkspaceView: () => undefined,
    formatLlmFailureMessage: (_label, error) => error?.code || 'failed',
    refreshArticleWorkspace: async () => { refreshes += 1; return {}; },
    finalizeSuccessfulMechanismGeneration: async () => { finalizes += 1; },
    seedMechanismChainFromCrossFigure: async () => { seeds += 1; },
    isCurrentFigureWorkspaceEditContext: () => true,
    mechanismSnapshotMatchesContext: () => true,
    setMechanismChainSaveStatus: () => undefined,
    persistCurrentArticleArchive: async () => undefined,
    figureWorkspaceRenderCoordinator: { request: () => undefined },
    currentWorkspaceSnapshot: null
  });
  const response = await run({ returnView: 'figures', seedMode: 'explicit' });
  assert.equal(response, null);
  assert.equal(captures, 1, 'the production run captures one immutable edit context');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].evidenceFirstVersion, '2');
  assert.deepEqual(plain(sent[0].evidenceFirstVersions), plain(versions));
  assert.equal(sent[0].baseWorkspaceRevision, binding.draftRevision);
  assert.equal(sent[0].mechanismChainFingerprint, binding.mechanismChainFingerprint);
  assert.equal(controller.presentation().status, 'failed');
  assert.equal(controller.presentation().code, 'INVALID_RESPONSE');
  assert.equal(finalizes, 0);
  assert.equal(seeds, 0);
  assert.equal(refreshes, 2, 'refresh the binding before dispatch and the view after completion');
});

test('popup mechanism DTO validation rejects a revoked Proxy without executing traps', () => {
  const { isSeedableMechanismGenerationResult } = loadPopupUiHelpers();
  const revoked = Proxy.revocable({
    mechanismEdges: [{ from: 'node-a', to: 'node-b' }]
  }, {});
  revoked.revoke();
  assert.equal(isSeedableMechanismGenerationResult(revoked.proxy), false);
});

test('popup mechanism DTO validation never executes Proxy array getters', () => {
  const { isSeedableMechanismGenerationResult } = loadPopupUiHelpers();
  let getterReads = 0;
  const edges = new Proxy([{ from: 'node-a', to: 'node-b' }], {
    get() { getterReads += 1; throw new Error('ARRAY_GETTER_EXECUTED'); }
  });
  assert.equal(isSeedableMechanismGenerationResult({ mechanismEdges: edges }), true);
  assert.equal(getterReads, 0);
});

test('popup validates parallel generated relations with their bound audit metadata', () => {
  const popup = read('popup.js');
  assert.match(popup,
    /mechanismChainValidationIssues\(\s*chain,\s*evidenceFigures,\s*draft\?\.mechanismGeneration\s*\)/u);
});

test('popup rejects a forged complete counter-only result without a renderable edge', () => {
  const { isSeedableMechanismGenerationResult } = loadPopupUiHelpers();
  assert.equal(isSeedableMechanismGenerationResult({
    mechanismEdges: [],
    evidenceFirstMechanism: {
      status: 'complete', canonicalDigest: `mechanism-v3-sha256-${'a'.repeat(64)}`,
      nodes: [{ nodeId: `node-v1-${'1'.repeat(16)}` }],
      relations: [{ relationStatus: 'counter_only', renderable: false }]
    }
  }), false);
  assert.equal(isSeedableMechanismGenerationResult({ mechanismEdges: [] }), false,
    'legacy empty-edge payloads remain invalid');
});

test('production run reaches the content v2 wrapper with one frozen identity and hands off once', async () => {
  const helpers = loadPopupUiHelpers();
  const versions = EvidenceFirstMechanism.EVIDENCE_FIRST_VERSIONS;
  const SciLLM = EvidenceFirstMechanism;
  const normalize = executableContentFunction('normalizeEvidenceFirstMechanismRequest', {
    SciLLM
  });
  const buildBackground = executableContentFunction(
    'buildEvidenceFirstMechanismBackgroundMessage'
  );
  const crossFigureMechanismOwnData = executableContentFunction(
    'crossFigureMechanismOwnData'
  );
  const sameCrossFigureMechanismBinding = executableContentFunction(
    'sameCrossFigureMechanismBinding', { crossFigureMechanismOwnData }
  );
  const isSeedableCrossFigureLogicResult = executableContentFunction(
    'isSeedableCrossFigureLogicResult', { crossFigureMechanismOwnData }
  );
  const normalizeCrossFigureMechanismPendingPreview = executableContentFunction(
    'normalizeCrossFigureMechanismPendingPreview', {
      crossFigureMechanismOwnData, isSeedableCrossFigureLogicResult,
      SciLLM: FigureWorkspace
    }
  );
  const buildGeneratedMechanismV2WorkspaceMutation = executableContentFunction(
    'buildGeneratedMechanismV2WorkspaceMutation', {
      crossFigureMechanismOwnData, normalizeCrossFigureMechanismPendingPreview,
      createMechanismGenerationCandidateEnvelope:
        FigureWorkspace.createMechanismGenerationCandidateEnvelope
    }
  );
  const commitGeneratedMechanismV2ToWorkspace = executableContentFunction(
    'commitGeneratedMechanismV2ToWorkspace', {
      buildGeneratedMechanismV2WorkspaceMutation,
      crossFigureMechanismOwnData, sameCrossFigureMechanismBinding
    }
  );
  const finalize = executablePopupFunction('finalizeSuccessfulMechanismGeneration', {
    isSeedableMechanismGenerationResult: helpers.isSeedableMechanismGenerationResult
  });
  const context = {
    tabId: 42, contextKey: 'ctx', documentKey: 'doc',
    documentId: 'sha256:happy-production', workspaceId: `workspace:${'5'.repeat(64)}`,
    workspaceGeneration: 6, workspaceLifecycle: 17, draftRevision: 23,
    mechanismChainFingerprint: 'mechanism-chain-v1-55667788',
    workspaceCanonicalUrl: 'https://example.test/happy',
    workspaceContentHash: 'b'.repeat(64)
  };
  const binding = {
    documentId: context.documentId, workspaceId: context.workspaceId,
    workspaceGeneration: context.workspaceGeneration,
    workspaceLifecycle: context.workspaceLifecycle,
    baseWorkspaceRevision: context.draftRevision,
    mechanismChainFingerprint: context.mechanismChainFingerprint
  };
  const result = {
    nodes: [{ id: 'figure-1' }],
    mechanismEdges: [{
      from: 'signal', to: 'response', supportPanels: ['figure-1:A']
    }],
    evidenceFirstMechanism: {
      status: 'complete', canonicalDigest: `mechanism-v3-sha256-${'7'.repeat(64)}`,
      nodes: [
        { nodeId: `node-v2-${'1'.repeat(16)}`, label: 'signal', nodeType: 'intervention' },
        { nodeId: `node-v2-${'2'.repeat(16)}`, label: 'response', nodeType: 'outcome' }
      ],
      relations: [{
        relationId: `relation-v1-${'3'.repeat(16)}`,
        sourceNodeId: `node-v2-${'1'.repeat(16)}`,
        targetNodeId: `node-v2-${'2'.repeat(16)}`, relationKind: 'causal',
        relationStatus: 'supported', renderable: true, polarity: 'increases',
        context: {
          species: 'mouse', tissue: 'brain', cellType: '', compartment: '',
          condition: 'stimulated', timepoint: '', dose: ''
        },
        assignments: [{
          claimId: `claim-v1-${'4'.repeat(16)}`, panelKey: 'figure-1:A',
          evidenceClass: 'sufficiency', role: 'supporting',
          claimRelationKind: 'causal', sourceRefs: ['figure-1:A:directObservation']
        }]
      }],
      claims: [{
        claimId: `claim-v1-${'4'.repeat(16)}`, panelKey: 'figure-1:A',
        semantics: 'causal', causalTest: 'sufficiency', outcome: 'supports',
        effectSign: 'increases',
        sourceAnalysisDigest: `source-v2-${'5'.repeat(16)}`,
        sourceRefs: ['figure-1:A:directObservation']
      }]
    }
  };
  const controller = helpers.createMechanismGenerationUiController();
  const routed = [];
  let captures = 0;
  let seeds = 0;
  let refreshes = 0;
  const statuses = [];
  const workspaceMutations = [];
  const workspaceController = {
    mutate: async mutation => {
      workspaceMutations.push(mutation);
      return { success: true, draft: { revision: 24 } };
    },
    getDraft: () => ({ revision: 24 }), getCheckpoint: () => ({}), isDirty: () => false
  };
  const run = executablePopupFunction('runCrossFigureLogic', {
    activeWorkspaceView: 'figures', requireUsableLlm: () => true,
    queryPanelTargetTab: async () => ({ id: 42 }), figureTaskGeneration: 4,
    isCurrentFigureTask: () => true,
    captureFigureWorkspaceEditContext: () => { captures += 1; return context; },
    capturePanelContext: () => ({ tabId: 42 }),
    isCurrentPanelContext: () => true,
    createMechanismOperationId: () => 'mechanism:happy-production-12345678',
    SciLLM,
    createEvidenceFirstMechanismPopupRequest:
      helpers.createEvidenceFirstMechanismPopupRequest,
    replaceMechanismGenerationUiController: () => controller,
    mechanismGenerationUiController: controller,
    renderMechanismGenerationStatus: () => undefined,
    sendTabMessage: async (_tabId, request) => {
      const normalized = normalize(request, binding);
      routed.push(buildBackground(normalized, { title: 'Happy path' }, [
        { figureId: 'figure-1' }, { figureId: 'figure-2' }
      ]));
      const committed = await commitGeneratedMechanismV2ToWorkspace({
        providerStatus: 'complete', result,
        operation: {
          operationId: request.operationId, epoch: 2, binding,
          evidenceFirstVersions: request.evidenceFirstVersions
        },
        previousResult: null
      }, {
        captureBinding: () => binding,
        ensureController: async () => workspaceController,
        getActiveController: () => workspaceController,
        getLifecycle: () => binding.workspaceLifecycle,
        commitController: () => undefined
      });
      return {
        success: committed.success, status: committed.status,
        code: committed.code, operationId: request.operationId,
        operationEpoch: 2, result: committed.result,
        evidenceFirstVersions: request.evidenceFirstVersions,
        workspaceCommitted: committed.success
      };
    },
    isSeedableMechanismGenerationResult:
      helpers.isSeedableMechanismGenerationResult,
    mechanismGenerationOwnData: helpers.mechanismGenerationOwnData,
    mechanismGenerationStatusLabel: () => '',
    showStatus: message => { statuses.push(message); },
    switchWorkspaceView: () => undefined,
    formatLlmFailureMessage: (_label, error) => error?.code || 'failed',
    refreshArticleWorkspace: async () => { refreshes += 1; return { live: true }; },
    finalizeSuccessfulMechanismGeneration: finalize,
    seedMechanismChainFromCrossFigure: async () => { seeds += 1; return { success: true }; },
    isCurrentFigureWorkspaceEditContext: value => value === context,
    mechanismSnapshotMatchesContext: snapshot => snapshot?.live === true,
    setMechanismChainSaveStatus: () => undefined,
    persistCurrentArticleArchive: async () => undefined,
    figureWorkspaceRenderCoordinator: { request: () => undefined },
    currentWorkspaceSnapshot: null
  });
  const response = await run({ returnView: 'figures', seedMode: 'explicit' });
  assert.equal(response?.status, 'complete');
  assert.equal(captures, 1);
  assert.equal(routed.length, 1);
  assert.deepEqual(plain(routed[0]), {
    type: 'LLM_ANALYZE_CROSS_FIGURE_LOGIC',
    evidenceFirstVersion: '2', evidenceFirstRouterVersion: '2',
    evidenceFirstVersions: plain(versions),
    operationId: 'mechanism:happy-production-12345678',
    ...binding,
    document: { title: 'Happy path' },
    figures: [{ figureId: 'figure-1' }, { figureId: 'figure-2' }]
  });
  assert.equal(refreshes, 2, 'refresh once before admission and once after completion');
  assert.equal(workspaceMutations.length, 1);
  assert.equal(workspaceMutations[0].type, 'replace_generated_mechanism_v2');
  assert.equal(workspaceMutations[0].expectedRevision, 23);
  assert.equal(response?.workspaceCommitted, true);
  assert.ok(statuses.some(message => /2 个节点、1 条跨图连接/u.test(message)),
    'v2 success counts must come from the committed evidence-first preview');
  assert.equal(seeds, 0,
    'content-side CAS completion must never enter the legacy popup seed handoff');
});

test('LLM failures distinguish timeout connectivity authentication quota and response format', () => {
  const script = read('popup.js');
  assert.match(script, /function formatLlmFailureMessage/);
  for (const code of [
    'REQUEST_TIMEOUT', 'NETWORK_ERROR', 'AUTH_INVALID', 'QUOTA_EXHAUSTED',
    'RATE_LIMITED', 'INVALID_RESPONSE'
  ]) assert.match(script, new RegExp(code));
  assert.match(script, /formatLlmFailureMessage\('机制链生成'/);
  assert.match(script, /MECHANISM_GRAPH_EMPTY/);
  assert.match(script, /formatLlmFailureMessage\('文献笔记自动填写'/);
});

test('popup treats persisted literature-note v2 status as bounded untrusted state', () => {
  const script = read('popup.js');
  const normalizeStart = script.indexOf('function normalizeLiteratureNoteDocumentState');
  const normalizeEnd = script.indexOf('async function readLiteratureNoteWorkspaceState', normalizeStart);
  const normalizeBody = script.slice(normalizeStart, normalizeEnd);
  const mergeStart = script.indexOf('function mergeLiteratureNoteDocumentState');
  const mergeEnd = script.indexOf('function literatureNoteTemplates', mergeStart);
  const mergeBody = script.slice(mergeStart, mergeEnd);

  assert.match(normalizeBody, /schemaVersion:\s*2/);
  assert.match(normalizeBody, /fieldStatusByTemplate/);
  assert.match(normalizeBody, /\['supported', 'missing'\]/);
  assert.match(normalizeBody, /\.slice\(0,\s*20\)/);
  assert.match(normalizeBody, /\.slice\(0,\s*40\)/);
  assert.match(mergeBody, /fieldStatusByTemplate/);
  assert.match(mergeBody, /delete\s+merged\.fieldStatusByTemplate/);
  assert.match(script, /type:\s*'LITERATURE_NOTE_COMMIT_DELTA'/);

  const normalize = Function(
    `'use strict'; ${normalizeBody}; return normalizeLiteratureNoteDocumentState;`
  )();
  const merge = Function(
    `'use strict'; ${normalizeBody}; ${mergeBody}; return mergeLiteratureNoteDocumentState;`
  )();
  const migrated = normalize({
    schemaVersion: 1,
    templateId: 'basic_research',
    valuesByTemplate: {
      basic_research: { research_background: 'Reader note' }
    },
    fieldStatusByTemplate: {
      basic_research: { research_background: 'missing' }
    }
  });
  assert.equal(migrated.schemaVersion, 2);
  assert.equal(migrated.valuesByTemplate.basic_research.research_background, 'Reader note');
  assert.deepEqual(migrated.fieldStatusByTemplate, {});

  const merged = merge({
    schemaVersion: 2,
    valuesByTemplate: {},
    fieldStatusByTemplate: {
      basic_research: { research_background: 'missing' }
    }
  }, {
    schemaVersion: 2,
    valuesByTemplate: {
      basic_research: { research_background: 'Manual edit' }
    },
    fieldStatusByTemplate: {
      basic_research: { research_background: 'missing' }
    }
  }, new Set(['basic_research\u0000research_background']));
  assert.equal(merged.valuesByTemplate.basic_research.research_background, 'Manual edit');
  assert.equal(merged.fieldStatusByTemplate.basic_research.research_background, undefined);

  const reverseMerged = merge({
    schemaVersion: 2,
    valuesByTemplate: {
      basic_research: { research_background: 'Manual edit already on disk' }
    },
    fieldStatusByTemplate: {}
  }, {
    schemaVersion: 2,
    valuesByTemplate: {},
    fieldStatusByTemplate: {
      basic_research: { research_background: 'missing' }
    }
  }, new Set(['basic_research\u0000research_background']));
  assert.equal(
    reverseMerged.valuesByTemplate.basic_research.research_background,
    'Manual edit already on disk'
  );
  assert.equal(
    reverseMerged.fieldStatusByTemplate.basic_research.research_background,
    undefined
  );

  const readerCleared = merge({
    schemaVersion: 2,
    valuesByTemplate: {
      basic_research: { research_background: 'AI grounded value' }
    },
    fieldStatusByTemplate: {
      basic_research: { research_background: 'supported' }
    }
  }, {
    schemaVersion: 2,
    valuesByTemplate: {},
    fieldStatusByTemplate: {}
  }, new Set(['basic_research\u0000research_background']));
  assert.equal(readerCleared.valuesByTemplate.basic_research.research_background, '');
  assert.equal(
    readerCleared.fieldStatusByTemplate.basic_research.research_background,
    undefined
  );

  for (const updatedAt of [Infinity, -Infinity, NaN, -1, 1.5, Number.MAX_VALUE]) {
    assert.equal(normalize({ updatedAt }).updatedAt, 0);
  }
  assert.equal(normalize({ updatedAt: Number.MAX_SAFE_INTEGER }).updatedAt,
    Number.MAX_SAFE_INTEGER);

  const longId = `valid_${'x'.repeat(170)}`;
  const untrusted = JSON.parse(JSON.stringify({
    schemaVersion: 2,
    templateId: '__proto__',
    valuesByTemplate: Object.fromEntries([
      ['__proto__', { safe_field: 'ignored' }],
      ['constructor', { safe_field: 'ignored' }],
      ['prototype', { safe_field: 'ignored' }],
      ['Valid Template', Object.fromEntries([
        ['__proto__', 'ignored'],
        ['constructor', 'ignored'],
        ['prototype', 'ignored'],
        ['Field Name', 'kept'],
        [longId, 'bounded']
      ])]
    ]),
    fieldStatusByTemplate: Object.fromEntries([
      ['Valid Template', Object.fromEntries([
        ['__proto__', 'missing'],
        ['constructor', 'missing'],
        ['prototype', 'missing'],
        ['Other Field', 'missing'],
        [longId, 'supported']
      ])]
    ])
  }));
  const popupNormalized = normalize(untrusted);
  const coreNormalized = normalizeCoreLiteratureNoteDocumentState(untrusted);
  assert.equal(popupNormalized.templateId, coreNormalized.templateId);
  assert.deepEqual(
    Object.keys(popupNormalized.valuesByTemplate),
    Object.keys(coreNormalized.valuesByTemplate)
  );
  assert.deepEqual(
    Object.entries(popupNormalized.valuesByTemplate.valid_template || {}),
    Object.entries(coreNormalized.valuesByTemplate.valid_template || {})
  );
  assert.deepEqual(
    Object.entries(popupNormalized.fieldStatusByTemplate.valid_template || {}),
    Object.entries(coreNormalized.fieldStatusByTemplate.valid_template || {})
  );
});

test('literature-note autofill merges typed results without overwriting reader edits', () => {
  const {
    applyLiteratureNoteAutofillResult,
    applyLiteratureNoteManualInput,
    createLiteratureNoteAutofillSummary
  } = loadPopupUiHelpers();
  assert.equal(typeof applyLiteratureNoteAutofillResult, 'function');
  assert.equal(typeof applyLiteratureNoteManualInput, 'function');
  assert.equal(typeof createLiteratureNoteAutofillSummary, 'function');

  const template = {
    id: 'basic_research',
    fields: [
      { id: 'filled' },
      { id: 'missing' },
      { id: 'existing' },
      { id: 'in_flight' },
      { id: 'bad_missing' },
      { id: 'bad_supported' }
    ]
  };
  const state = {
    schemaVersion: 2,
    templateId: template.id,
    valuesByTemplate: {
      [template.id]: { existing: 'Reader note', in_flight: 'Edit made while waiting' }
    },
    fieldStatusByTemplate: {
      [template.id]: { existing: 'supported', in_flight: 'supported' }
    }
  };
  const merged = applyLiteratureNoteAutofillResult({
    template,
    state,
    initialValues: { existing: 'Reader note', in_flight: '' },
    initialFieldRevisions: new Map([
      ['basic_research\u0000in_flight', 0],
      ['basic_research\u0000cleared_in_flight', 0]
    ]),
    currentFieldRevisions: new Map([
      ['basic_research\u0000in_flight', 1],
      ['basic_research\u0000cleared_in_flight', 1]
    ]),
    result: {
      values: {
        filled: 'Grounded result',
        missing: '',
        existing: 'Must not overwrite',
        in_flight: 'Must not overwrite in-flight edit',
        bad_missing: '正文未提供',
        bad_supported: 'No evidence source'
      },
      fieldStatus: {
        filled: 'supported',
        missing: 'missing',
        existing: 'supported',
        in_flight: 'supported',
        bad_missing: 'missing',
        bad_supported: 'supported'
      },
      sources: {
        filled: ['paragraph-1'],
        missing: [],
        existing: ['paragraph-2'],
        in_flight: ['paragraph-3'],
        bad_missing: [],
        bad_supported: []
      }
    }
  });

  assert.deepEqual(plain(merged.counts), {
    filled: 1, missing: 1, preserved: 2, invalid: 2
  });
  assert.equal(state.valuesByTemplate.basic_research.filled, 'Grounded result');
  assert.equal(state.valuesByTemplate.basic_research.missing || '', '');
  assert.equal(state.fieldStatusByTemplate.basic_research.missing, 'missing');
  assert.equal(state.valuesByTemplate.basic_research.existing, 'Reader note');
  assert.equal(state.valuesByTemplate.basic_research.in_flight, 'Edit made while waiting');
  assert.equal(state.valuesByTemplate.basic_research.bad_missing || '', '');
  assert.equal(state.valuesByTemplate.basic_research.bad_supported || '', '');

  const manual = applyLiteratureNoteManualInput({
    state,
    templateId: template.id,
    fieldId: 'filled',
    value: 'Reader revision'
  });
  assert.equal(state.valuesByTemplate.basic_research.filled, 'Reader revision');
  assert.equal(state.fieldStatusByTemplate.basic_research.filled, undefined);
  assert.equal(manual.dirtyField, 'basic_research\u0000filled');

  const summary = createLiteratureNoteAutofillSummary({
    filled: 0, missing: 3, preserved: 1, invalid: 0
  });
  assert.equal(summary.success, false);
  assert.notEqual(summary.tone, 'success');
  assert.match(summary.message, /AI 已填写 0 个空白字段/);
  assert.match(summary.message, /3 个字段正文未提供/);
  assert.match(summary.message, /保留 1 个已有字段/);
});

test('literature-note autofill treats input then clear as an in-flight reader edit', () => {
  const { applyLiteratureNoteAutofillResult } = loadPopupUiHelpers();
  const state = {
    valuesByTemplate: { basic_research: {} },
    fieldStatusByTemplate: {}
  };
  const result = applyLiteratureNoteAutofillResult({
    template: { id: 'basic_research', fields: [{ id: 'cleared_in_flight' }] },
    state,
    initialValues: {},
    initialFieldRevisions: new Map([['basic_research\u0000cleared_in_flight', 0]]),
    currentFieldRevisions: new Map([['basic_research\u0000cleared_in_flight', 1]]),
    result: {
      values: { cleared_in_flight: 'Model result' },
      fieldStatus: { cleared_in_flight: 'supported' },
      sources: { cleared_in_flight: ['p-1'] }
    }
  });
  assert.deepEqual(plain(result.counts), {
    filled: 0, missing: 0, preserved: 1, invalid: 0
  });
  assert.equal(state.valuesByTemplate.basic_research.cleared_in_flight, undefined);
});

test('single-field literature-note generation replaces only its stable target', () => {
  const { applyLiteratureNoteAutofillResult } = loadPopupUiHelpers();
  const template = {
    id: 'custom_note',
    fields: [{ id: 'target' }, { id: 'untouched' }]
  };
  const state = {
    valuesByTemplate: { custom_note: {
      target: 'Existing target', untouched: 'Reader keeps this'
    } },
    fieldStatusByTemplate: { custom_note: {} }
  };
  const result = applyLiteratureNoteAutofillResult({
    template,
    state,
    initialValues: { target: 'Existing target', untouched: 'Reader keeps this' },
    initialFieldRevisions: new Map([['custom_note\u0000target', 3]]),
    currentFieldRevisions: new Map([['custom_note\u0000target', 3]]),
    replaceFieldIds: ['target'],
    result: {
      values: { target: 'Regenerated target' },
      fieldStatus: { target: 'supported' },
      sources: { target: ['p-1'] }
    }
  });

  assert.deepEqual(plain(result), {
    counts: { filled: 1, missing: 0, preserved: 1, invalid: 0 },
    changedFields: ['target'], sourceWarnings: []
  });
  assert.equal(state.valuesByTemplate.custom_note.target, 'Regenerated target');
  assert.equal(state.valuesByTemplate.custom_note.untouched, 'Reader keeps this');
});

test('single-field literature-note generation preserves in-flight edits and existing values on missing', () => {
  const { applyLiteratureNoteAutofillResult } = loadPopupUiHelpers();
  const template = { id: 'custom_note', fields: [{ id: 'target' }] };
  const editedState = {
    valuesByTemplate: { custom_note: { target: 'Typed while waiting' } },
    fieldStatusByTemplate: { custom_note: {} }
  };
  const edited = applyLiteratureNoteAutofillResult({
    template,
    state: editedState,
    initialValues: { target: 'Existing target' },
    initialFieldRevisions: new Map([['custom_note\u0000target', 4]]),
    currentFieldRevisions: new Map([['custom_note\u0000target', 5]]),
    replaceFieldIds: ['target'],
    result: {
      values: { target: 'Must not overwrite' },
      fieldStatus: { target: 'supported' },
      sources: { target: ['p-1'] }
    }
  });
  assert.equal(edited.counts.preserved, 1);
  assert.equal(editedState.valuesByTemplate.custom_note.target, 'Typed while waiting');

  const missingState = {
    valuesByTemplate: { custom_note: { target: 'Existing target' } },
    fieldStatusByTemplate: { custom_note: {} }
  };
  const missing = applyLiteratureNoteAutofillResult({
    template,
    state: missingState,
    initialValues: { target: 'Existing target' },
    replaceFieldIds: ['target'],
    result: {
      values: { target: '' }, fieldStatus: { target: 'missing' }, sources: { target: [] }
    }
  });
  assert.equal(missing.counts.preserved, 1);
  assert.equal(missingState.valuesByTemplate.custom_note.target, 'Existing target');
});

test('literature-note receiver verifies the complete template signature', () => {
  const {
    literatureNoteTemplateSignaturePayload,
    validateLiteratureNoteGenerationReceipt
  } = loadPopupUiHelpers();
  const template = {
    id: 'custom_note', name: 'Custom note', studyFamily: 'custom',
    fields: [{
      id: 'finding', label: 'Finding', prompt: 'Extract direct evidence.',
      placeholder: 'Evidence only', multiline: true, required: false
    }]
  };
  const stableHash = value => JSON.stringify(value);
  const signature = stableHash(literatureNoteTemplateSignaturePayload(template));
  const result = {
    operationReceipt: { cacheIdentity: { templateSignature: signature } },
    evidenceReceipt: { templateSignature: signature }
  };
  assert.equal(validateLiteratureNoteGenerationReceipt({
    result, template, stableHash
  }), true);
  assert.equal(validateLiteratureNoteGenerationReceipt({
    result,
    template: {
      ...template,
      fields: [{ ...template.fields[0], prompt: 'A changed instruction.' }]
    },
    stableHash
  }), false);
});

test('paper-meta note projection preserves readable Q0 progression and evidence boundaries', () => {
  const { createLiteratureNotePaperMetaProjection } = loadPopupUiHelpers();
  assert.equal(typeof createLiteratureNotePaperMetaProjection, 'function');
  const projection = createLiteratureNotePaperMetaProjection({
    meta: {
      researchLogic: {
        atomicEvidence: [{
          evidenceId: 'B1', type: 'background', statement: 'Known pathway context.',
          confidence: 'high', sourceRefs: [{
            paragraphId: 'p-1', sectionPath: ['Introduction']
          }]
        }],
        questionTrace: { coreQuestion: {
          questionId: 'Q0', text: 'What controls clearance?', evidenceIds: ['B1'],
          remainingGap: 'Human validation remains.'
        } },
        progression: [{
          questionId: 'Q1', text: 'Is route A necessary?', generatedFrom: ['Q0'],
          hypothesis: 'Blocking A reduces clearance.', test: 'Perturb route A.',
          warrantedConclusion: 'Route A is required in this model.',
          remainingGap: 'Other routes remain unresolved.', evidenceIds: ['B1']
        }]
      },
      paperMetaDetails: {
        innovationPoints: [{
          text: 'Links anatomy to function.', evidenceIds: ['B1'],
          scope: 'Validated in one model.', confidence: 'medium'
        }],
        limitationPoints: [{
          text: 'Evidence is model-specific.', evidenceIds: ['B1'],
          scope: 'No human cohort.', confidence: 'medium'
        }]
      }
    }
  });

  assert.match(projection.research_background,
    /^- Known pathway context\. \[正文证据来源：Introduction · p-1\]/m);
  assert.match(projection.scientific_questions, /^- Q0：What controls clearance\?/m);
  assert.match(projection.scientific_questions, /^- Q1：Is route A necessary\?/m);
  assert.match(projection.scientific_questions, /  - 来自：Q0/);
  assert.match(projection.scientific_questions, /  - 局限：Other routes remain unresolved\./);
  assert.match(projection.innovations, /\[正文证据来源：Introduction · p-1\]/);
  assert.match(projection.innovations, /\[局限：Validated in one model\.\]/);
  assert.match(projection.limitations, /\[局限：No human cohort\.\]/);
  assert.match(projection.research_logic, /研究背景\n- Known pathway context/);
  assert.match(projection.research_logic, /科学问题与逻辑子问题\n- Q0/);
});

test('paper-meta projection fills only compatible blank note fields and rejects in-flight edits', () => {
  const {
    createLiteratureNotePaperMetaProjection,
    applyLiteratureNotePaperMetaProjection
  } = loadPopupUiHelpers();
  const templates = [{
    id: 'basic_research', fields: [
      { id: 'research_background', label: '研究背景' },
      { id: 'scientific_questions', label: '科学问题与逻辑子问题' },
      { id: 'innovations', label: '研究创新点' },
      { id: 'limitations', label: '研究局限性' }
    ]
  }, {
    id: 'custom', fields: [{ id: 'reader_notes', label: '我的笔记' }]
  }];
  const state = {
    valuesByTemplate: { basic_research: { innovations: 'Reader innovation' } },
    fieldStatusByTemplate: {}
  };
  const projection = createLiteratureNotePaperMetaProjection({
    meta: {
      backgroundItems: [{ value: 'Existing background' }],
      scientificQuestions: [{ questionId: 'Q0', value: 'Existing question' }],
      innovationPoints: [{ value: 'Generated innovation' }],
      limitationPoints: [{ value: 'Generated limitation' }]
    }
  });
  const result = applyLiteratureNotePaperMetaProjection({
    templates, state, projection,
    initialFieldRevisions: new Map([
      ['basic_research\u0000scientific_questions', 0]
    ]),
    currentFieldRevisions: new Map([
      ['basic_research\u0000scientific_questions', 1]
    ])
  });

  assert.equal(state.valuesByTemplate.basic_research.research_background,
    '- Existing background');
  assert.equal(state.valuesByTemplate.basic_research.scientific_questions, undefined);
  assert.equal(state.valuesByTemplate.basic_research.innovations, 'Reader innovation');
  assert.equal(state.valuesByTemplate.basic_research.limitations,
    '- Generated limitation');
  assert.equal(state.valuesByTemplate.custom, undefined,
    'templates without compatible fields remain untouched during migration');
  assert.deepEqual(plain(result.changedFields), [
    { templateId: 'basic_research', fieldId: 'research_background' },
    { templateId: 'basic_research', fieldId: 'limitations' }
  ]);
  assert.equal(
    state.fieldStatusByTemplate.basic_research.research_background, 'supported'
  );
  const repeated = applyLiteratureNotePaperMetaProjection({
    templates: [{
      id: 'basic_research',
      fields: templates[0].fields.filter(field => field.id !== 'scientific_questions')
    }],
    state, projection,
    initialFieldRevisions: new Map(), currentFieldRevisions: new Map()
  });
  assert.deepEqual(plain(repeated.changedFields), []);
  assert.equal(state.valuesByTemplate.basic_research.research_background,
    '- Existing background', 'restoring the same workspace meta must not duplicate text');

  const roundTrip = normalizeCoreLiteratureNoteDocumentState({
    schemaVersion: 2,
    templateId: 'basic_research',
    valuesByTemplate: {
      basic_research: { scientific_questions: projection.scientific_questions }
    },
    fieldStatusByTemplate: {
      basic_research: { scientific_questions: 'supported' }
    }
  });
  assert.equal(
    roundTrip.valuesByTemplate.basic_research.scientific_questions,
    projection.scientific_questions,
    'workspace/browser normalization must preserve bullet line breaks'
  );
});

test('paper-meta extraction drops a response after the active paper changes', async () => {
  let panelCurrent = true;
  let refreshed = 0;
  let applied = 0;
  let persisted = 0;
  const noteContext = { id: 'paper-a' };
  const run = executablePopupFunction('runPaperMetaExtraction', {
    requireUsableLlm: () => true,
    paperMetaTaskState: {
      research_logic: { running: false, error: '' },
      innovation: { running: false, error: '' },
      limitations: { running: false, error: '' }
    },
    literatureNoteDocumentState: { valuesByTemplate: {}, fieldStatusByTemplate: {} },
    loadLiteratureNoteDocumentState: async () => {},
    captureLiteratureNoteContext: () => noteContext,
    literatureNoteFieldEditVersions: new Map(),
    currentWorkspaceSnapshot: { documentHash: 'hash-a' },
    preparedDocumentState: null,
    manualAnnotationState: {},
    updatePaperMetaTaskButtons: () => {},
    showStatus: () => {},
    queryPanelTargetTab: async () => ({ id: 7 }),
    capturePanelContext: () => ({ key: 'paper-a' }),
    sendTabMessage: async () => {
      panelCurrent = false;
      return { success: true, result: { documentHash: 'hash-a' } };
    },
    isCurrentPanelContext: () => panelCurrent,
    isCurrentLiteratureNoteContext: () => true,
    refreshArticleWorkspace: async () => { refreshed += 1; },
    applyCurrentPaperMetaToLiteratureNote: () => {
      applied += 1;
      return { projection: {}, changedFields: [] };
    },
    persistLiteratureNoteDocumentState: async () => { persisted += 1; },
    persistCurrentArticleArchive: async () => {}
  });

  assert.deepEqual(await run('innovation'), { stale: true });
  assert.equal(refreshed, 0);
  assert.equal(applied, 0);
  assert.equal(persisted, 0);
});

test('paper-meta extraction requires a matching document hash before note writes', async () => {
  let refreshed = 0;
  let applied = 0;
  const run = executablePopupFunction('runPaperMetaExtraction', {
    requireUsableLlm: () => true,
    paperMetaTaskState: {
      research_logic: { running: false, error: '' },
      innovation: { running: false, error: '' },
      limitations: { running: false, error: '' }
    },
    literatureNoteDocumentState: { valuesByTemplate: {}, fieldStatusByTemplate: {} },
    loadLiteratureNoteDocumentState: async () => {},
    captureLiteratureNoteContext: () => ({ id: 'paper-a' }),
    literatureNoteFieldEditVersions: new Map(),
    currentWorkspaceSnapshot: { documentHash: 'hash-a' },
    preparedDocumentState: null,
    manualAnnotationState: {},
    updatePaperMetaTaskButtons: () => {},
    showStatus: () => {},
    queryPanelTargetTab: async () => ({ id: 7 }),
    capturePanelContext: () => ({ key: 'paper-a' }),
    sendTabMessage: async () => ({ success: true, result: {} }),
    isCurrentPanelContext: () => true,
    isCurrentLiteratureNoteContext: () => true,
    refreshArticleWorkspace: async () => { refreshed += 1; },
    applyCurrentPaperMetaToLiteratureNote: () => {
      applied += 1;
      return { projection: {}, changedFields: [] };
    },
    persistLiteratureNoteDocumentState: async () => {},
    persistCurrentArticleArchive: async () => {}
  });

  const result = await run('limitations');
  assert.equal(result.success, false);
  assert.equal(result.code, 'LITERATURE_NOTE_DOCUMENT_CHANGED');
  assert.equal(refreshed, 0);
  assert.equal(applied, 0);
});

test('literature-note persistence serializes deferred commits and keeps newer edits dirty', async () => {
  const { createLiteratureNotePersistenceCoordinator } = loadPopupUiHelpers();
  assert.equal(typeof createLiteratureNotePersistenceCoordinator, 'function');
  let state = {
    schemaVersion: 2,
    templateId: 'basic_research',
    valuesByTemplate: { basic_research: { background: 'First edit' } },
    fieldStatusByTemplate: {}
  };
  const revisions = new Map([['basic_research\u0000background', 1]]);
  const localGate = deferred();
  const workspaceGate = deferred();
  const commits = [];
  let activeCommits = 0;
  let maxActiveCommits = 0;
  const coordinator = createLiteratureNotePersistenceCoordinator({
    clone: value => plain(value),
    merge: (committed, live, newerDirty) => {
      const next = plain(committed);
      for (const key of newerDirty) {
        const [templateId, fieldId] = key.split('\u0000');
        next.valuesByTemplate[templateId] ||= {};
        next.valuesByTemplate[templateId][fieldId] =
          live.valuesByTemplate?.[templateId]?.[fieldId] || '';
      }
      return next;
    },
    getState: () => state,
    setState: next => { state = next; },
    getDirtyRevisions: () => revisions,
    clearDirtyRevision: (key, version) => {
      if (revisions.get(key) === version) revisions.delete(key);
    }
  });
  const commit = async ({ snapshot }) => {
    activeCommits += 1;
    maxActiveCommits = Math.max(maxActiveCommits, activeCommits);
    commits.push(snapshot.valuesByTemplate.basic_research.background);
    if (commits.length === 1) {
      await localGate.promise;
      await workspaceGate.promise;
    }
    activeCommits -= 1;
    return { state: snapshot, clearDirty: true };
  };

  const first = coordinator.save(commit);
  await Promise.resolve();
  state.valuesByTemplate.basic_research.background = '';
  revisions.set('basic_research\u0000background', 2);
  const second = coordinator.save(commit);
  localGate.resolve();
  await Promise.resolve();
  assert.equal(state.valuesByTemplate.basic_research.background, '');
  workspaceGate.resolve();
  await first;
  assert.equal(state.valuesByTemplate.basic_research.background, '');
  assert.equal(revisions.get('basic_research\u0000background'), 2);
  await second;
  assert.deepEqual(commits, ['First edit', '']);
  assert.equal(maxActiveCommits, 1);
  assert.equal(revisions.size, 0);
});

test('queued literature-note saves do not replay fields already committed by an earlier save', async () => {
  const { createLiteratureNotePersistenceCoordinator } = loadPopupUiHelpers();
  let state = {
    valuesByTemplate: { basic_research: { background: 'A', methods: '' } },
    fieldStatusByTemplate: {}
  };
  const backgroundKey = 'basic_research\u0000background';
  const methodsKey = 'basic_research\u0000methods';
  const revisions = new Map([[backgroundKey, 1]]);
  const firstGate = deferred();
  const dirtyPerCommit = [];
  const coordinator = createLiteratureNotePersistenceCoordinator({
    clone: value => plain(value),
    merge: (committed, live, newerDirty) => {
      const next = plain(committed);
      for (const key of newerDirty) {
        const [templateId, fieldId] = key.split('\u0000');
        next.valuesByTemplate[templateId][fieldId] =
          live.valuesByTemplate[templateId][fieldId];
      }
      return next;
    },
    getState: () => state,
    setState: next => { state = next; },
    getDirtyRevisions: () => revisions,
    clearDirtyRevision: (key, version) => {
      if (revisions.get(key) === version) revisions.delete(key);
    }
  });
  const commit = async ({ snapshot, dirtyFields }) => {
    dirtyPerCommit.push([...dirtyFields]);
    if (dirtyPerCommit.length === 1) await firstGate.promise;
    return { state: snapshot, clearDirty: true };
  };
  const first = coordinator.save(commit);
  await Promise.resolve();
  state.valuesByTemplate.basic_research.methods = 'New methods edit';
  revisions.set(methodsKey, 2);
  const second = coordinator.save(commit);
  firstGate.resolve();
  await first;
  await second;
  assert.deepEqual(dirtyPerCommit, [[backgroundKey], [methodsKey]]);
});

test('queued note snapshots stay bound to paper A after the UI switches to paper B', async () => {
  const {
    createLiteratureNotePersistenceCoordinator,
    flushLiteratureNoteBeforeContextLeave
  } = loadPopupUiHelpers();
  assert.equal(typeof flushLiteratureNoteBeforeContextLeave, 'function');
  const key = 'basic_research\u0000background';
  let currentContextId = 'paper-a\u0000workspace-a\u00001';
  let state = { valuesByTemplate: { basic_research: { background: 'A1' } } };
  const revisions = new Map([[key, 1]]);
  const firstGate = deferred();
  const writes = [];
  let appliedToCurrentUi = 0;
  const coordinator = createLiteratureNotePersistenceCoordinator({
    clone: value => plain(value),
    merge: (committed, live, newerDirty) => {
      const next = plain(committed);
      for (const dirtyKey of newerDirty) {
        const [templateId, fieldId] = dirtyKey.split('\u0000');
        next.valuesByTemplate[templateId][fieldId] =
          live.valuesByTemplate[templateId][fieldId];
      }
      return next;
    },
    contextKey: context => context.id,
    getState: () => state,
    setState: next => { state = next; appliedToCurrentUi += 1; },
    getDirtyRevisions: () => revisions,
    clearDirtyRevision: (dirtyKey, version) => {
      if (revisions.get(dirtyKey) === version) revisions.delete(dirtyKey);
    },
    isCurrent: context => context.id === currentContextId
  });
  const contextA = {
    id: currentContextId,
    documentKey: 'paper-a',
    workspaceId: 'workspace-a',
    workspaceGeneration: 1
  };
  const commit = async ({ snapshot, dirtyFields, context }) => {
    writes.push({
      value: snapshot.valuesByTemplate.basic_research.background,
      dirty: [...dirtyFields],
      context: plain(context)
    });
    if (writes.length === 1) await firstGate.promise;
    return { state: snapshot, clearDirty: true };
  };
  const first = coordinator.save(commit, contextA);
  await Promise.resolve();
  state.valuesByTemplate.basic_research.background = 'A2';
  revisions.set(key, 2);
  let timerCancelled = false;
  let resetFinished = false;
  const second = flushLiteratureNoteBeforeContextLeave({
    cancelScheduledSave: () => { timerCancelled = true; },
    enqueueSave: () => coordinator.save(commit, contextA),
    resetContext: () => {
      currentContextId = 'paper-b\u0000workspace-b\u00002';
      state = { valuesByTemplate: { basic_research: { background: 'B' } } };
      revisions.clear();
      resetFinished = true;
    }
  });
  assert.equal(timerCancelled, true);
  assert.equal(resetFinished, true, 'context switch must not await storage');
  firstGate.resolve();
  const firstResult = await first;
  const secondResult = await second;
  assert.deepEqual(writes, [
    { value: 'A1', dirty: [key], context: contextA },
    { value: 'A2', dirty: [key], context: contextA }
  ]);
  assert.equal(firstResult.stale, true);
  assert.equal(secondResult.stale, true);
  assert.equal(appliedToCurrentUi, 0);
  assert.equal(state.valuesByTemplate.basic_research.background, 'B');
});

test('a rejected note commit does not block the next fixed-context snapshot', async () => {
  const { createLiteratureNotePersistenceCoordinator } = loadPopupUiHelpers();
  let currentContextId = 'paper-b';
  let state = { valuesByTemplate: { basic_research: { background: 'A' } } };
  const dirtyKey = 'basic_research\u0000background';
  const revisions = new Map([[dirtyKey, 1]]);
  const coordinator = createLiteratureNotePersistenceCoordinator({
    clone: value => plain(value),
    merge: committed => plain(committed),
    contextKey: context => context.id,
    getState: () => state,
    setState: next => { state = next; },
    getDirtyRevisions: () => revisions,
    clearDirtyRevision: () => {},
    isCurrent: context => context.id === currentContextId
  });
  const contextA = { id: 'paper-a' };
  const first = coordinator.save(async () => {
    throw new Error('storage unavailable');
  }, contextA);
  state.valuesByTemplate.basic_research.background = 'A retry';
  revisions.set(dirtyKey, 2);
  const second = coordinator.save(async ({ snapshot, context }) => ({
    state: snapshot, clearDirty: true, savedContext: context.id
  }), contextA);
  await assert.rejects(first, /storage unavailable/);
  const recovered = await second;
  assert.equal(recovered.savedContext, 'paper-a');
  assert.equal(recovered.state.valuesByTemplate.basic_research.background, 'A retry');
  assert.equal(recovered.stale, true);
});

test('a failed pre-leave save restores paper A dirty state and clears only after retry', async () => {
  const { createLiteratureNotePersistenceCoordinator } = loadPopupUiHelpers();
  const dirtyKey = 'basic_research\u0000background';
  let currentContextId = 'paper-a';
  let state = { valuesByTemplate: { basic_research: { background: 'Unsaved A' } } };
  const revisions = new Map([[dirtyKey, 7]]);
  const coordinator = createLiteratureNotePersistenceCoordinator({
    clone: value => plain(value),
    merge: (committed, live, dirty) => {
      const next = plain(committed);
      for (const key of dirty) {
        const [templateId, fieldId] = key.split('\u0000');
        next.valuesByTemplate[templateId] ||= {};
        next.valuesByTemplate[templateId][fieldId] =
          live.valuesByTemplate[templateId][fieldId];
      }
      return next;
    },
    contextKey: context => context.id,
    getState: () => state,
    setState: next => { state = next; },
    getDirtyRevisions: () => revisions,
    clearDirtyRevision: (key, version) => {
      if (revisions.get(key) === version) revisions.delete(key);
    },
    isCurrent: context => context.id === currentContextId
  });
  const contextA = { id: 'paper-a', documentKey: 'paper-a' };
  const failed = coordinator.save(async () => {
    throw new Error('workspace offline');
  }, contextA);
  currentContextId = 'paper-b';
  state = { valuesByTemplate: { basic_research: { background: 'B note' } } };
  revisions.clear();
  await assert.rejects(failed, /workspace offline/);
  const retry = coordinator.getRetrySnapshot(contextA);
  assert.equal(retry.state.valuesByTemplate.basic_research.background, 'Unsaved A');
  assert.deepEqual(plain([...retry.revisions]), [[dirtyKey, 7]]);
  assert.equal(state.valuesByTemplate.basic_research.background, 'B note');
  const retryStats = coordinator.getQueueStats();
  assert.ok(retryStats.retryContexts <= retryStats.maxPendingContexts);
  assert.ok(retryStats.retryBytes <= retryStats.maxPendingBytes);

  currentContextId = 'paper-a';
  state = { valuesByTemplate: { basic_research: { background: 'Older disk A' } } };
  coordinator.restoreRetrySnapshot(contextA, {
    apply: snapshot => {
      state = plain(snapshot.state);
      revisions.clear();
      snapshot.revisions.forEach((version, key) => revisions.set(key, version));
    }
  });
  assert.equal(state.valuesByTemplate.basic_research.background, 'Unsaved A');
  assert.equal(revisions.get(dirtyKey), 7);
  await coordinator.save(async ({ snapshot }) => ({
    state: snapshot, clearDirty: true
  }), contextA);
  assert.equal(coordinator.getRetrySnapshot(contextA), null);
  assert.equal(revisions.size, 0);
  const script = read('popup.js');
  const loadStart = script.indexOf('async function loadLiteratureNoteDocumentState');
  const loadEnd = script.indexOf('async function persistLiteratureNoteDocumentState', loadStart);
  const loadBody = script.slice(loadStart, loadEnd);
  assert.match(loadBody, /getRetrySnapshot/);
  assert.match(loadBody, /literatureNoteDirtyRevisions\.set/);
  assert.match(loadBody, /scheduleLiteratureNoteSave/);
});

test('literature-note save queue coalesces by context and stays count and byte bounded', async () => {
  const { createLiteratureNotePersistenceCoordinator } = loadPopupUiHelpers();
  const gate = deferred();
  let state = { valuesByTemplate: { basic_research: { background: 'active' } } };
  const revisions = new Map([['basic_research\u0000background', 1]]);
  const writes = [];
  const coordinator = createLiteratureNotePersistenceCoordinator({
    clone: value => plain(value),
    merge: committed => plain(committed),
    contextKey: context => context.id,
    getState: () => state,
    setState: next => { state = next; },
    getDirtyRevisions: () => revisions,
    clearDirtyRevision: () => {},
    isCurrent: () => false
  });
  const commit = async ({ snapshot, context }) => {
    writes.push([context.id, snapshot.valuesByTemplate.basic_research.background]);
    if (writes.length === 1) await gate.promise;
    return { state: snapshot, clearDirty: true };
  };
  const promises = [coordinator.save(commit, { id: 'active' })];
  const sameContextPromises = [];
  await Promise.resolve();
  for (let index = 0; index < 100; index += 1) {
    state = { valuesByTemplate: {
      basic_research: { background: `latest-${index}` }
    } };
    revisions.set('basic_research\u0000background', index + 2);
    const queued = coordinator.save(commit, { id: 'same-paper' });
    sameContextPromises.push(queued);
    promises.push(queued.catch(error => error));
  }
  for (let index = 0; index < 80; index += 1) {
    state = { valuesByTemplate: {
      basic_research: { background: `paper-${index}` }
    } };
    revisions.set('basic_research\u0000background', index + 200);
    promises.push(coordinator.save(commit, { id: `paper-${index}` }).catch(error => error));
  }
  const stats = coordinator.getQueueStats();
  assert.equal(stats.active, 1);
  assert.ok(stats.pendingContexts <= stats.maxPendingContexts);
  assert.ok(stats.pendingBytes <= stats.maxPendingBytes);
  assert.equal('snapshots' in stats, false, 'stats must not expose private note content');
  assert.equal(new Set(sameContextPromises).size, 1,
    'coalesced saves must share one bounded completion promise');
  gate.resolve();
  await Promise.allSettled(promises);
  const samePaperWrites = writes.filter(([context]) => context === 'same-paper');
  assert.deepEqual(samePaperWrites, [['same-paper', 'latest-99']]);
});

test('literature-note queue freezes only dirty field deltas, not a large full state', async () => {
  const { createLiteratureNotePersistenceCoordinator } = loadPopupUiHelpers();
  const dirtyKey = 'basic_research\u0000background';
  let state = {
    templateId: 'basic_research',
    valuesByTemplate: {
      basic_research: {
        background: 'small edit',
        untouched: 'x'.repeat(20000)
      }
    },
    fieldStatusByTemplate: { basic_research: { background: 'supported' } }
  };
  const revisions = new Map([[dirtyKey, 3]]);
  let received;
  const coordinator = createLiteratureNotePersistenceCoordinator({
    clone: value => plain(value),
    merge: committed => plain(committed),
    contextKey: context => context.id,
    getState: () => state,
    setState: next => { state = next; },
    getDirtyRevisions: () => revisions,
    clearDirtyRevision: () => {},
    isCurrent: () => false,
    maxPendingBytes: 1024
  });
  const reservation = coordinator.trySave(async payload => {
    received = plain(payload);
    return { state, clearDirty: true };
  }, { id: 'paper-a' });
  assert.equal(reservation.accepted, true);
  await reservation.promise;
  assert.deepEqual(received.delta.fields, [{
    key: dirtyKey,
    templateId: 'basic_research',
    fieldId: 'background',
    value: 'small edit',
    status: 'supported',
    revision: 3
  }]);
  assert.equal(JSON.stringify(received).includes('x'.repeat(100)), false);
});

test('note pre-leave capacity rejection prevents reset and preserves the only live draft', async () => {
  const {
    createLiteratureNotePersistenceCoordinator,
    flushLiteratureNoteBeforeContextLeave
  } = loadPopupUiHelpers();
  const gate = deferred();
  const dirtyKey = 'basic_research\u0000background';
  let state = { valuesByTemplate: { basic_research: { background: 'keep me' } } };
  const revisions = new Map([[dirtyKey, 1]]);
  const coordinator = createLiteratureNotePersistenceCoordinator({
    clone: value => plain(value), merge: committed => plain(committed),
    contextKey: context => context.id, getState: () => state,
    setState: next => { state = next; }, getDirtyRevisions: () => revisions,
    clearDirtyRevision: () => {}, isCurrent: () => false,
    maxPendingContexts: 2
  });
  const commit = async ({ delta }) => {
    await gate.promise;
    return { state, delta, clearDirty: true };
  };
  assert.equal(coordinator.trySave(commit, { id: 'active' }).accepted, true);
  await Promise.resolve();
  assert.equal(coordinator.trySave(commit, { id: 'queued' }).accepted, true);
  let reset = false;
  let warning = '';
  const leave = flushLiteratureNoteBeforeContextLeave({
    cancelScheduledSave() {},
    enqueueSave: () => coordinator.trySave(commit, { id: 'third' }),
    resetContext: () => { reset = true; state = null; },
    showWarning: message => { warning = message; }
  });
  assert.equal(leave.accepted, false);
  assert.equal(reset, false);
  assert.equal(state.valuesByTemplate.basic_research.background, 'keep me');
  assert.match(warning, /队列已满/);
  gate.resolve();
  await Promise.allSettled([leave.promise]);
});

test('clearDirty false reserves retry delta and stale retry rejection never mutates paper B', async () => {
  const { createLiteratureNotePersistenceCoordinator } = loadPopupUiHelpers();
  const key = 'basic_research\u0000background';
  let current = 'paper-a';
  let state = { valuesByTemplate: { basic_research: { background: 'A edit' } } };
  const revisions = new Map([[key, 4]]);
  let uiApplications = 0;
  const coordinator = createLiteratureNotePersistenceCoordinator({
    clone: value => plain(value), merge: committed => plain(committed),
    contextKey: context => context.id, getState: () => state,
    setState: next => { state = next; uiApplications += 1; },
    getDirtyRevisions: () => revisions, clearDirtyRevision: () => {},
    isCurrent: context => context.id === current
  });
  const first = coordinator.trySave(async () => ({
    state: { valuesByTemplate: { basic_research: { background: 'A edit' } } },
    clearDirty: false
  }), { id: 'paper-a' });
  assert.equal(first.accepted, true);
  await first.promise;
  assert.equal(coordinator.getRetrySnapshot({ id: 'paper-a' }).delta.fields[0].value,
    'A edit');
  const retryGate = deferred();
  const retry = coordinator.trySave(async () => {
    await retryGate.promise;
    throw new Error('still offline');
  }, { id: 'paper-a' });
  current = 'paper-b';
  state = { valuesByTemplate: { basic_research: { background: 'B note' } } };
  revisions.clear();
  retryGate.resolve();
  await assert.rejects(retry.promise, /still offline/);
  assert.equal(uiApplications, 1, 'only the non-stale first completion may update A');
  assert.equal(state.valuesByTemplate.basic_research.background, 'B note');
  assert.equal(coordinator.getRetrySnapshot({ id: 'paper-a' }).delta.fields[0].value,
    'A edit');
});

test('same-context overflow rejects replacement without discarding the accepted latest delta', async () => {
  const { createLiteratureNotePersistenceCoordinator } = loadPopupUiHelpers();
  const gate = deferred();
  const key = 'basic_research\u0000background';
  let state = { valuesByTemplate: { basic_research: { background: 'active' } } };
  const revisions = new Map([[key, 1]]);
  const writes = [];
  const coordinator = createLiteratureNotePersistenceCoordinator({
    clone: value => plain(value), merge: committed => plain(committed),
    contextKey: context => context.id, getState: () => state,
    setState: next => { state = next; }, getDirtyRevisions: () => revisions,
    clearDirtyRevision: () => {}, isCurrent: () => false,
    maxPendingBytes: 800
  });
  const commit = async ({ delta, context }) => {
    writes.push([context.id, delta.fields[0].value]);
    if (context.id === 'active') await gate.promise;
    return { state, clearDirty: true };
  };
  coordinator.trySave(commit, { id: 'active' });
  await Promise.resolve();
  state.valuesByTemplate.basic_research.background = 'accepted';
  revisions.set(key, 2);
  assert.equal(coordinator.trySave(commit, { id: 'same' }).accepted, true);
  state.valuesByTemplate.basic_research.background = 'y'.repeat(1000);
  revisions.set(key, 3);
  assert.equal(coordinator.trySave(commit, { id: 'same' }).accepted, false);
  gate.resolve();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(writes.filter(([id]) => id === 'same'), [['same', 'accepted']]);
});

test('literature-note capacity and recovery status have complete English UI translations', () => {
  const script = read('popup.js');
  assert.match(script, /t\(\s*'笔记保存队列已满，请稍后重试'\s*\)/);
  assert.match(script, /t\('已恢复未保存的编辑，正在重试'\)/);
  assert.match(script, /t\('保存失败'\)/);
});

test('retry stores only the execute-filtered delta after an earlier revision committed', async () => {
  const { createLiteratureNotePersistenceCoordinator } = loadPopupUiHelpers();
  const f1 = 'basic_research\u0000background';
  const f2 = 'basic_research\u0000methods';
  let state = { valuesByTemplate: { basic_research: {
    background: 'first', methods: ''
  } } };
  const revisions = new Map([[f1, 1]]);
  const gate = deferred();
  const coordinator = createLiteratureNotePersistenceCoordinator({
    clone: value => plain(value), merge: committed => plain(committed),
    contextKey: context => context.id, getState: () => state,
    setState: next => { state = next; }, getDirtyRevisions: () => revisions,
    clearDirtyRevision: (key, revision) => {
      if (revisions.get(key) === revision) revisions.delete(key);
    }, isCurrent: () => false
  });
  const first = coordinator.save(async payload => {
    await gate.promise;
    return { state: payload.snapshot, clearDirty: true };
  }, { id: 'paper-a' });
  await Promise.resolve();
  state.valuesByTemplate.basic_research.methods = 'second';
  revisions.set(f2, 2);
  const sent = [];
  const second = coordinator.save(async payload => {
    sent.push(payload.delta.fields.map(field => field.key));
    throw new Error('offline');
  }, { id: 'paper-a' });
  gate.resolve();
  await first;
  await assert.rejects(second, /offline/);
  assert.deepEqual(plain(sent), [[f2]]);
  const retry = coordinator.getRetrySnapshot({ id: 'paper-a' });
  assert.deepEqual(plain(retry.delta.fields.map(field => field.key)), [f2]);
  assert.deepEqual(plain([...retry.revisions]), [[f2, 2]]);
});

test('literature-note load revision guard rejects a deferred old load after a save intent', async () => {
  const { createContextRevisionGuard } = loadPopupUiHelpers();
  assert.equal(typeof createContextRevisionGuard, 'function');
  let current = 'paper-a';
  const guard = createContextRevisionGuard({
    isCurrent: context => context.id === current
  });
  const oldLoad = guard.begin({ id: 'paper-a' });
  const disk = deferred();
  let applied = '';
  const loading = disk.promise.then(value => {
    if (guard.isCurrent(oldLoad)) applied = value;
  });
  guard.invalidate();
  applied = 'new saved draft';
  disk.resolve('stale disk value');
  await loading;
  assert.equal(applied, 'new saved draft');
});

test('save-aware note load guard rejects loads begun during commit on success or failure', async () => {
  const { createContextRevisionGuard } = loadPopupUiHelpers();
  for (const outcome of ['success', 'failure']) {
    const guard = createContextRevisionGuard({ isCurrent: () => true });
    const mutation = guard.beginMutation({ id: 'paper-a' });
    const duringCommitLoad = guard.begin({ id: 'paper-a' });
    assert.equal(guard.isCurrent(duringCommitLoad), false,
      'storage must not apply while a save intent is outstanding');
    guard.endMutation(mutation, { outcome });
    assert.equal(guard.isCurrent(duringCommitLoad), false,
      `late load must stay stale after commit ${outcome}`);
    const freshLoad = guard.begin({ id: 'paper-a' });
    assert.equal(guard.isCurrent(freshLoad), true);
  }
});

test('literature-note delta chunks preserve 41 fields, template boundaries, and UTF-8 limits', () => {
  const { createLiteratureNoteDeltaChunks } = loadPopupUiHelpers();
  assert.equal(typeof createLiteratureNoteDeltaChunks, 'function');
  const fields = [
    ...Array.from({ length: 39 }, (_, index) => ({
      key: `template_a\u0000field_${index}`,
      templateId: 'template_a', fieldId: `field_${index}`,
      value: index === 0 ? '🧬'.repeat(6000) : `value-${index}`,
      status: 'supported', revision: index + 1
    })),
    ...Array.from({ length: 2 }, (_, index) => ({
      key: `template_b\u0000other_${index}`,
      templateId: 'template_b', fieldId: `other_${index}`,
      value: `other-${index}`, status: 'supported', revision: index + 50
    }))
  ];
  const chunks = createLiteratureNoteDeltaChunks({
    templateId: 'template_a', fields
  });
  assert.deepEqual(plain(chunks.map(chunk => chunk.fields.length)), [39, 2]);
  assert.deepEqual(plain(chunks.map(chunk =>
    [...new Set(chunk.fields.map(field => field.templateId))]
  )), [['template_a'], ['template_b']]);
  assert.equal(chunks.flatMap(chunk => chunk.fields).length, fields.length);
  for (const chunk of chunks) {
    assert.ok(Buffer.byteLength(JSON.stringify({
      documentKey: 'x'.repeat(800), legacyKey: 'f'.repeat(128), delta: chunk
    }), 'utf8') <= 2 * 1024 * 1024);
  }
});

test('failed chunk retry retains only chunks not already committed', async () => {
  const { createLiteratureNotePersistenceCoordinator } = loadPopupUiHelpers();
  const fields = Array.from({ length: 41 }, (_, index) => {
    const templateId = index < 39 ? 'template_a' : 'template_b';
    const fieldId = `field_${index}`;
    return {
      key: `${templateId}\u0000${fieldId}`, templateId, fieldId,
      value: `value-${index}`, status: 'supported', revision: index + 1
    };
  });
  const state = { templateId: 'template_a', valuesByTemplate: {
    template_a: Object.fromEntries(fields.slice(0, 39).map(field =>
      [field.fieldId, field.value])),
    template_b: Object.fromEntries(fields.slice(39).map(field =>
      [field.fieldId, field.value]))
  }, fieldStatusByTemplate: {} };
  const revisions = new Map(fields.map(field => [field.key, field.revision]));
  const coordinator = createLiteratureNotePersistenceCoordinator({
    clone: value => plain(value), merge: committed => plain(committed),
    contextKey: context => context.id, getState: () => state,
    setState() {}, getDirtyRevisions: () => revisions,
    clearDirtyRevision() {}, isCurrent: () => false
  });
  const save = coordinator.save(async ({ delta }) => {
    const error = new Error('second template failed');
    error.literatureNoteRemainingDelta = {
      templateId: delta.templateId,
      fields: delta.fields.filter(field => field.templateId === 'template_b')
    };
    throw error;
  }, { id: 'paper-a' });
  await assert.rejects(save, /second template failed/);
  const retry = coordinator.getRetrySnapshot({ id: 'paper-a' });
  assert.equal(retry.delta.fields.length, 2);
  assert.deepEqual(plain(retry.delta.fields.map(field => field.templateId)),
    ['template_b', 'template_b']);
  assert.deepEqual(plain([...retry.revisions.keys()]),
    fields.slice(39).map(field => field.key));
});

test('partial local chunk retry keeps all workspace fields across leave reload and retry', async () => {
  const { createLiteratureNotePersistenceCoordinator } = loadPopupUiHelpers();
  const fields = Array.from({ length: 41 }, (_, index) => {
    const templateId = index < 39 ? 'template_a' : 'template_b';
    const fieldId = `field_${index}`;
    return { key: `${templateId}\u0000${fieldId}`, templateId, fieldId,
      value: `value-${index}`, status: 'supported', revision: index + 1 };
  });
  const fullState = { templateId: 'template_a', valuesByTemplate: {
    template_a: Object.fromEntries(fields.slice(0, 39).map(field =>
      [field.fieldId, field.value])),
    template_b: Object.fromEntries(fields.slice(39).map(field =>
      [field.fieldId, field.value]))
  }, fieldStatusByTemplate: {} };
  let current = 'paper-a';
  let state = plain(fullState);
  const revisions = new Map(fields.map(field => [field.key, field.revision]));
  const coordinator = createLiteratureNotePersistenceCoordinator({
    clone: value => plain(value), merge: committed => plain(committed),
    contextKey: context => context.id, getState: () => state,
    setState: next => { state = next; }, getDirtyRevisions: () => revisions,
    clearDirtyRevision: (key, revision) => {
      if (revisions.get(key) === revision) revisions.delete(key);
    }, isCurrent: context => context.id === current
  });
  const contextA = { id: 'paper-a' };
  const failed = coordinator.save(async ({ localPendingDelta }) => {
    const error = new Error('chunk two failed');
    error.literatureNoteRemainingDelta = {
      templateId: localPendingDelta.templateId,
      fields: localPendingDelta.fields.filter(field =>
        field.templateId === 'template_b')
    };
    throw error;
  }, contextA);
  current = 'paper-b';
  state = { valuesByTemplate: { basic_research: { background: 'B' } } };
  revisions.clear();
  await assert.rejects(failed, /chunk two failed/);
  const cached = coordinator.getRetrySnapshot(contextA);
  assert.equal(cached.localPendingDelta.fields.length, 2);
  assert.equal(cached.localPendingRevisions.size, 2);
  assert.equal(cached.workspacePendingRevisions.size, 41);

  current = 'paper-a';
  state = plain(fullState); // chunk one came from durable browser-local storage
  coordinator.restoreRetrySnapshot(contextA, {
    apply: snapshot => {
      snapshot.localPendingDelta.fields.forEach(field => {
        state.valuesByTemplate[field.templateId][field.fieldId] = field.value;
      });
      snapshot.workspacePendingRevisions.forEach((revision, key) =>
        revisions.set(key, revision));
    }
  });
  let retryPayload;
  await coordinator.save(async payload => {
    retryPayload = payload;
    return { state: plain(fullState), clearDirty: true,
      localPendingDelta: { templateId: 'template_a', fields: [] } };
  }, contextA);
  assert.equal(retryPayload.localPendingDelta.fields.length, 2,
    'retry must not rewrite the successful first chunk');
  assert.equal(retryPayload.workspacePendingFieldKeys.size, 41,
    'workspace merge must still include the complete original transaction');
  assert.equal(revisions.size, 0);
  assert.equal(coordinator.getRetrySnapshot(contextA), null);
});

test('workspace-only retry reads current local state without rewriting it or losing external updates', async () => {
  const { createLiteratureNotePersistenceCoordinator } = loadPopupUiHelpers();
  const key = 'basic_research\u0000background';
  let state = { valuesByTemplate: { basic_research: { background: 'initial' } } };
  const revisions = new Map([[key, 1]]);
  const coordinator = createLiteratureNotePersistenceCoordinator({
    clone: value => plain(value), merge: committed => plain(committed),
    contextKey: context => context.id, getState: () => state,
    setState: next => { state = next; }, getDirtyRevisions: () => revisions,
    clearDirtyRevision: (fieldKey, revision) => {
      if (revisions.get(fieldKey) === revision) revisions.delete(fieldKey);
    }
  });
  await coordinator.save(async ({ localPendingDelta }) => ({
    state: plain(state), clearDirty: false,
    localPendingDelta: { templateId: localPendingDelta.templateId, fields: [] }
  }), { id: 'paper-a' });
  const cached = coordinator.getRetrySnapshot({ id: 'paper-a' });
  assert.equal(cached.localPendingDelta.fields.length, 0);
  assert.equal(cached.workspacePendingRevisions.size, 1);

  state.valuesByTemplate.basic_research.background = 'external newer local value';
  let localRewriteCount = 0;
  await coordinator.save(async payload => {
    localRewriteCount += payload.localPendingDelta.fields.length;
    assert.equal(payload.workspacePendingFieldKeys.has(key), true);
    return { state: plain(state), clearDirty: true,
      localPendingDelta: { templateId: 'basic_research', fields: [] } };
  }, { id: 'paper-a' });
  assert.equal(localRewriteCount, 0);
  assert.equal(state.valuesByTemplate.basic_research.background,
    'external newer local value');
  assert.equal(revisions.size, 0);
  assert.equal(coordinator.getRetrySnapshot({ id: 'paper-a' }), null);
});

test('production retry overlay applies only two local-pending fields while restoring 41 dirty revisions', () => {
  const { applyLiteratureNoteRetryOverlay } = loadPopupUiHelpers();
  assert.equal(typeof applyLiteratureNoteRetryOverlay, 'function');
  const localFields = Object.fromEntries(Array.from({ length: 39 }, (_, index) =>
    [`field_${index}`, `local-${index}`]));
  const resolvedState = { templateId: 'template_a', valuesByTemplate: {
    template_a: localFields, template_b: {}
  }, fieldStatusByTemplate: {} };
  const retryState = { templateId: 'template_a', valuesByTemplate: {
    template_b: { field_39: 'retry-39', field_40: 'retry-40' }
  }, fieldStatusByTemplate: {} };
  const localPendingRevisions = new Map([
    ['template_b\u0000field_39', 40], ['template_b\u0000field_40', 41]
  ]);
  const workspacePendingRevisions = new Map(Array.from({ length: 41 }, (_, index) => {
    const templateId = index < 39 ? 'template_a' : 'template_b';
    return [`${templateId}\u0000field_${index}`, index + 1];
  }));
  const retry = { state: retryState, localPendingRevisions,
    workspacePendingRevisions };
  const merge = (latest, draft, keys) => {
    const result = plain(latest);
    for (const key of keys) {
      const [templateId, fieldId] = key.split('\u0000');
      result.valuesByTemplate[templateId] ||= {};
      result.valuesByTemplate[templateId][fieldId] =
        draft.valuesByTemplate?.[templateId]?.[fieldId] || '';
    }
    return result;
  };
  const overlaid = applyLiteratureNoteRetryOverlay({
    resolvedState, retry, merge
  });
  assert.equal(Object.keys(overlaid.state.valuesByTemplate.template_a).length, 39);
  assert.equal(Object.keys(overlaid.state.valuesByTemplate.template_b).length, 2);
  assert.equal(overlaid.state.valuesByTemplate.template_a.field_0, 'local-0');
  assert.equal(overlaid.state.valuesByTemplate.template_b.field_40, 'retry-40');
  assert.equal(overlaid.dirtyRevisions.size, 41);
});

test('workspace target failures always retain workspace pending fields while no target clears locally', async () => {
  const { persistLiteratureNoteWorkspacePending } = loadPopupUiHelpers();
  assert.equal(typeof persistLiteratureNoteWorkspacePending, 'function');
  const committedState = { valuesByTemplate: {
    basic_research: { background: 'Evidence' }
  } };
  const workspacePendingFieldKeys = new Set(['basic_research\u0000background']);
  const target = { workspaceId: 'workspace:' + 'a'.repeat(64), workspaceGeneration: 2 };
  const merge = (_workspace, local) => plain(local);

  for (const readWorkspace of [
    async () => { throw new Error('GET threw'); },
    async () => null
  ]) {
    const result = await persistLiteratureNoteWorkspacePending({
      target, committedState, workspacePendingFieldKeys,
      readWorkspace, saveWorkspace: async () => ({ success: true }), merge
    });
    assert.equal(result.clearDirty, false);
    assert.equal(result.workspaceTargetFound, true);
    assert.equal(result.workspacePendingFieldKeys.size, 1);
  }
  const saveFailed = await persistLiteratureNoteWorkspacePending({
    target, committedState, workspacePendingFieldKeys,
    readWorkspace: async () => ({ target, state: null, revision: 0 }),
    saveWorkspace: async () => ({ success: false, error: { code: 'GET_FAILED' } }),
    merge
  });
  assert.equal(saveFailed.clearDirty, false);
  assert.equal(saveFailed.workspacePendingFieldKeys.size, 1);

  const noTarget = await persistLiteratureNoteWorkspacePending({
    target: null, committedState, workspacePendingFieldKeys,
    readWorkspace: async () => { throw new Error('must not read'); },
    saveWorkspace: async () => { throw new Error('must not save'); }, merge
  });
  assert.equal(noTarget.clearDirty, true);
  assert.equal(noTarget.workspaceTargetFound, false);
});

test('capacity-blocked tab sync resumes once after drain only for the same generation', async () => {
  const { scheduleContextSyncAfterDrain } = loadPopupUiHelpers();
  assert.equal(typeof scheduleContextSyncAfterDrain, 'function');
  const drain = deferred();
  let generation = 8;
  let scheduled = 0;
  const scheduledDrain = scheduleContextSyncAfterDrain({
    drain: drain.promise,
    generation: 8,
    currentGeneration: () => generation,
    schedule: () => { scheduled += 1; }
  });
  drain.resolve();
  await scheduledDrain;
  assert.equal(scheduled, 1);

  const staleDrain = deferred();
  const ignoredDrain = scheduleContextSyncAfterDrain({
    drain: staleDrain.promise,
    generation: 8,
    currentGeneration: () => generation,
    schedule: () => { scheduled += 1; }
  });
  generation = 9;
  staleDrain.resolve();
  await ignoredDrain;
  assert.equal(scheduled, 1);
});

test('literature-note result updates fields in place without disturbing active selection', () => {
  const { updateLiteratureNoteRenderedFields } = loadPopupUiHelpers();
  assert.equal(typeof updateLiteratureNoteRenderedFields, 'function');
  const makeField = (fieldId, value) => {
    const status = { className: '', textContent: '', setAttribute() {} };
    const input = {
      dataset: { literatureNoteField: fieldId }, value,
      selectionStart: 2, selectionEnd: 5, scrollTop: 31,
      closest: () => ({ querySelector: () => status })
    };
    return { input, status };
  };
  const active = makeField('reader_edit', 'typing now');
  const generated = makeField('generated', '');
  const resized = [];
  const fields = {
    replaceChildren() { throw new Error('result application must not rebuild the drawer'); },
    querySelectorAll() { return [active.input, generated.input]; }
  };
  updateLiteratureNoteRenderedFields({
    fields,
    templateId: 'basic_research',
    state: {
      valuesByTemplate: { basic_research: {
        reader_edit: 'typing now', generated: 'Grounded value'
      } },
      fieldStatusByTemplate: { basic_research: {
        generated: 'supported'
      } }
    },
    changedFields: ['generated'],
    translate: value => value,
    resize: input => resized.push(input.dataset.literatureNoteField)
  });
  assert.equal(active.input.value, 'typing now');
  assert.equal(active.input.selectionStart, 2);
  assert.equal(active.input.selectionEnd, 5);
  assert.equal(active.input.scrollTop, 31);
  assert.equal(generated.input.value, 'Grounded value');
  assert.equal(generated.status.textContent, '已由正文证据填写');
  assert.deepEqual(resized, ['generated']);
});

test('a cross-template literature-note save is one atomic local transaction', async () => {
  const fields = Array.from({ length: 41 }, (_, index) => {
    const templateId = index < 39 ? 'template_a' : 'template_b';
    return {
      key: `${templateId}\u0000field_${index}`, templateId,
      fieldId: `field_${index}`, value: 'x'.repeat(12000),
      status: 'supported', fieldUpdatedAt: index + 1, revision: index + 1
    };
  });
  let requests = 0;
  const durableFields = [];
  const commit = executablePopupFunction('commitLiteratureNoteDocumentDelta', {
    createLiteratureNoteDeltaChunks: loadPopupUiHelpers().createLiteratureNoteDeltaChunks,
    chrome: { runtime: { async sendMessage(message) {
      requests += 1;
      if (message.delta.fields.length > 40 || requests > 1) {
        return { success: false, error: { code: 'LITERATURE_NOTE_DOCUMENT_TOO_LARGE' } };
      }
      durableFields.push(...message.delta.fields);
      return { success: true, data: { state: {
        schemaVersion: 3, valuesByTemplate: {}, fieldStatusByTemplate: {},
        fieldEvidenceByTemplate: {}, fieldUpdatedAtByTemplate: {}
      } } };
    } } },
    t: value => value,
    normalizeLiteratureNoteDocumentState: value => value,
    literatureNoteDocumentState: {},
    persistLiteratureNoteWorkspacePending: async () => {
      throw new Error('workspace save must not run after local rejection');
    },
    readLiteratureNoteWorkspaceState: async () => null,
    LITERATURE_NOTE_WORKSPACE_PATH: 'annotations/literature-note.json'
  });
  await assert.rejects(() => commit({
    delta: { templateId: 'template_a', fields },
    dirtyFields: new Set(fields.map(field => field.key)),
    context: { documentKey: 'paper-a', legacyKey: '', target: null }
  }), error => error?.code === 'LITERATURE_NOTE_DOCUMENT_TOO_LARGE');
  assert.equal(requests, 1, 'one logical save must use one background transaction');
  assert.deepEqual(durableFields, [], 'a rejected transaction must not persist an early chunk');
});

test('literature-note textareas expand to scrollHeight without internal scrolling', () => {
  const resize = executablePopupFunction('resizeLiteratureNoteTextarea');
  const textarea = { style: {}, scrollHeight: 347 };
  assert.equal(resize(textarea), 349);
  assert.equal(textarea.style.height, '349px');
  assert.equal(textarea.style.overflowY, 'hidden');
});

test('literature-note drawer renders AI status outside empty textareas', () => {
  const script = read('popup.js');
  const css = read('popup.css');
  const renderStart = script.indexOf('function renderLiteratureNoteDrawer');
  const renderEnd = script.indexOf('async function autofillLiteratureNoteWithLLM', renderStart);
  const renderBody = script.slice(renderStart, renderEnd);
  const inputStart = script.indexOf("document.getElementById('literatureNoteFields')?.addEventListener('input'");
  const inputEnd = script.indexOf("document.getElementById('analyzeFiguresFromFigures')", inputStart);
  const inputBody = script.slice(inputStart, inputEnd);
  const autofillStart = script.indexOf('async function autofillLiteratureNoteWithLLM');
  const autofillEnd = script.indexOf('async function openLiteratureNoteDrawer', autofillStart);
  const autofillBody = script.slice(autofillStart, autofillEnd);

  assert.match(renderBody, /literature-note-field-status/);
  assert.match(renderBody, /fieldStatusByTemplate/);
  assert.match(renderBody, /fieldStatus === 'missing'\s*\?\s*t\('正文未提供'\)/);
  assert.match(renderBody, /label\.append\(title, textarea, statusText\)/);
  assert.doesNotMatch(renderBody, /textarea\.value\s*=.*正文未提供/);
  assert.match(inputBody, /applyLiteratureNoteManualInput/);
  assert.match(inputBody, /resizeLiteratureNoteTextarea\(input\)/);
  assert.match(autofillBody, /updateLiteratureNoteRenderedFields/);
  assert.doesNotMatch(autofillBody, /renderLiteratureNoteDrawer\(\)/);
  assert.match(autofillBody, /captureLiteratureNoteContext/);
  assert.match(autofillBody, /literatureNoteDocumentKey\(\)\s*!==\s*documentKey/);
  assert.match(autofillBody,
    /literatureNoteDocumentState\?\.templateId\s*!==\s*template\.id/);
  assert.match(autofillBody, /persisted\?\.stale/);
  assert.match(autofillBody, /stale:\s*true/);
  assert.match(css, /\.literature-note-field-status\.is-missing/);
  assert.match(css, /\.literature-note-field-status\.is-supported/);
  assert.match(renderBody, /resizeLiteratureNoteTextarea\(textarea\)/);
  assert.match(renderBody, /dataset\.generateLiteratureNoteField\s*=\s*field\.id/);
  assert.match(renderBody, /AI 生成/);
  assert.match(script, /async function autofillLiteratureNoteFieldWithLLM\(/);
  assert.match(script, /replaceFieldIds:\s*\[targetField\.id\]/);
  assert.match(script, /requestTemplate[\s\S]*fields:\s*\[targetField\]/);
  assert.match(script, /validateLiteratureNoteGenerationReceipt/);
  assert.match(script, /new ResizeObserver\([\s\S]*resizeLiteratureNoteTextareas/);
  assert.match(script, /addEventListener\('resize',[\s\S]*resizeLiteratureNoteTextareas/);
  assert.match(css,
    /\.literature-note-field textarea\s*\{[^}]*overflow-y:\s*hidden[^}]*resize:\s*none/s);
  assert.doesNotMatch(css,
    /\.literature-note-field textarea\s*\{[^}]*max-height\s*:/s);
  assert.match(css,
    /\.literature-note-form\s*\{[^}]*overflow-y:\s*auto/s);
  const missingColor = css.match(
    /\.literature-note-field-status\.is-missing\s*\{\s*color:\s*(#[0-9a-f]{6})/i
  )?.[1];
  assert.ok(missingColor, 'missing status should use an explicit six-digit color');
  assert.ok(contrastRatio(missingColor, '#f8fafb') >= 4.5,
    `missing status contrast should be >= 4.5, got ${contrastRatio(missingColor, '#f8fafb')}`);
});

test('navigation and figure refresh buttons animate immediately and while refreshing', () => {
  const html = read('popup.html');
  const script = read('popup.js');
  const css = read('popup.css');
  assert.match(html, /id="refreshArticleNavigation"[^>]*data-workspace-refresh/);
  assert.match(html, /id="refreshFigureInventory"[^>]*data-workspace-refresh/);
  assert.match(script, /async function runWorkspaceRefreshButton\(/);
  assert.match(script, /aria-busy/);
  assert.match(script, /is-refresh-clicked/);
  assert.match(css, /data-workspace-refresh.*aria-busy="true"/s);
  assert.match(css, /@keyframes workspace-refresh-spin/);
});

test('manual text selection exposes configured LLM actions and sends them directly to article chat', () => {
  const content = read('content.js');
  const styles = read('content.css');
  assert.match(content, /currentManualSelectionActions/);
  assert.match(content, /function runManualSelectionLlmAction\(/);
  assert.match(content, /compileSelectionActionPrompt/);
  assert.match(content, /askArticleWithLLM/);
  assert.match(content, /ARTICLE_CHAT_OPEN_REQUESTED/);
  assert.match(content, /currentManualSelectionActions\.filter\(action => action\.enabled !== false\)/);
  assert.match(content, /actions\.forEach\(action => actionSelect\.appendChild\(new Option\(action\.name, action\.id\)\)\)/);
  assert.match(content, /button\('AI', 'sci-selection-run-ai', '执行 AI 解读'\)/);
  assert.match(content, /type: 'LLM_ASK_SELECTION', operationId: id, turnId: id/);
  assert.match(content, /if \(!surface\.validSource\(\)\)/);
  assert.match(styles, /\.sci-manual-llm-action/);
});

test('literature notes remove the extra paper-meta section but retain compatibility migration', () => {
  const html = read('popup.html');
  const popup = read('popup.js');
  const renderStart = popup.indexOf('function renderFigureWorkspaceSnapshot');
  const renderEnd = popup.indexOf('function reconcileArticleWorkspaceSnapshot', renderStart);
  const figureWorkspaceRender = popup.slice(renderStart, renderEnd);
  assert.doesNotMatch(html, /id="literatureNotePaperMeta(?:Actions|Results)?"/);
  assert.doesNotMatch(popup, /function renderLiteratureNotePaperMetaTools\(/);
  assert.match(popup, /applyCurrentPaperMetaToLiteratureNote/);
  const openStart = popup.indexOf('async function openLiteratureNoteDrawer');
  const openEnd = popup.indexOf('function closeLiteratureNoteDrawer', openStart);
  const openBody = popup.slice(openStart, openEnd);
  assert.match(openBody, /applyCurrentPaperMetaToLiteratureNote/);
  assert.match(openBody,
    /drawer\.hidden\s*=\s*false[\s\S]*resizeLiteratureNoteTextareas\(\)/);
  assert.doesNotMatch(figureWorkspaceRender, /renderFigureWorkspaceMetaSnapshot/);
  assert.match(popup, /论文级提取已移至文献笔记/);
  assert.doesNotMatch(popup, /重试全部解图后会自动补齐/);
});
