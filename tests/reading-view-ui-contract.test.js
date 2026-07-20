const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

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

test('popup exposes four reading views and one manual study type chooser', () => {
  const html = read('popup.html');
  const script = read('popup.js');
  assert.match(html, /id="readingViewControl"/);
  assert.match(html, /value="quick_story"/);
  assert.match(html, /value="mechanism_chain"/);
  assert.match(html, /value="critical_review"/);
  assert.match(html, /name="readingView"\s+value="review_synthesis"/);
  assert.match(html, /综述脉络/);
  assert.match(html, /id="studyTypeChooser"/);
  assert.match(script, /radio\.name\s*=\s*'studyType'/);
  assert.match(script, /Object\.entries\(types\)/);
  assert.match(script, /LLM_SET_STUDY_TYPE/);
  assert.doesNotMatch(html, /secondaryStudyType|primaryStudyType|studyTypeReason|studyTypeWarning/);
  assert.doesNotMatch(script, /LLM_SAVE_STUDY_TYPE_OVERRIDE/);
  assert.match(html, /id="restoreViewPreset"/);
  assert.match(script, /LLM_PREPARE_DOCUMENT/);
  assert.match(script, /viewCategoryOverrides/);
});

test('current-view helpers resolve active entries and group searchable non-active categories', () => {
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
    ['active']
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

test('archive export disables while guarded and gear opening reloads public route settings', () => {
  const script = read('popup.js');
  const archiveStart = script.indexOf('function exportCurrentArticleArchive');
  const archiveEnd = script.indexOf('async function importCurrentArticleArchive', archiveStart);
  const archive = script.slice(archiveStart, archiveEnd);
  assert.match(archive, /articleArchiveExportGuard\.run/);
  assert.match(archive, /button\.disabled\s*=\s*true/);
  assert.match(archive, /finally[\s\S]*button\.disabled\s*=\s*false/);

  const menuStart = script.indexOf('function setupSidePanelSettingsMenu');
  const menuEnd = script.indexOf('function createWorkspaceElement', menuStart);
  const menu = script.slice(menuStart, menuEnd);
  assert.match(menu, /await refreshSettingsRouteSummary\(\)/);
  assert.match(script, /load:\s*\(\)\s*=>\s*sendLlmMessage\(\{ type: 'LLM_GET_SETTINGS' \}\)/);
  assert.match(script, /createLatestStateRefresher/);
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

test('popup routes view category and study-type mutations through one guarded queue', () => {
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
  assert.match(script, /chrome\.runtime\.getURL\('options\.html#category='/);
  assert.match(script, /chrome\.tabs\.create/);
});

test('popup reading view and status controls expose keyboard and live-region semantics', () => {
  const html = read('popup.html');
  const css = read('popup.css');
  assert.match(html, /<fieldset[^>]*id="readingViewControl"/);
  assert.match(html, /<legend[^>]*>阅读视图<\/legend>/);
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
  assert.doesNotMatch(css, /linear-gradient|#667eea|#764ba2/i);
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
    { categoryId: 'llm_only', enabledEngines: ['llm'] }
  ];
  assert.deepEqual(
    plain(getAvailableCategoryEntries(available, 'regex').map(([id]) => id)),
    ['result']
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

test('LLM analysis waits for a prepared document and one selected study type', () => {
  const script = read('popup.js');
  assert.match(script, /preparedDocumentState\?\.documentHash/);
  assert.match(script, /studyTypeSelectionInFlight/);
  assert.match(script, /documentHash:\s*(?:preparedDocumentState\.documentHash|expectedDocumentHash)/);
  assert.match(script, /studyType:\s*event\.target\.value|studyType:\s*selectedType/);
  assert.match(script, /applyButton\.disabled/);
  assert.match(script, /请先选择文献类型/);
  assert.match(script, /正在分析全文/);
  assert.match(script, /重新分析全文/);
  assert.doesNotMatch(script, /正在识别论文类型|已识别为/);
  const applyStart = script.indexOf("document.getElementById('applyHighlight').addEventListener");
  const applyEnd = script.indexOf('// 清除高亮', applyStart);
  const applyHandler = script.slice(applyStart, applyEnd);
  assert.match(applyHandler, /await preferenceMutationCoordinator\.drainLatest\(\)/);
  assert.match(applyHandler, /await prepareCurrentArticleForTypeChoice\(\)/);
  assert.doesNotMatch(applyHandler, /await prepareArticleForAdaptiveAnalysis\(/);
});

test('popup starts a review outline and displays paragraph progress', () => {
  const html = read('popup.html');
  const script = read('popup.js');
  assert.match(html, /id="generateOutlineSummaries"/);
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

test('side panel keeps one compact paper header and one gear-owned diagnostic action', () => {
  const html = read('popup.html');
  const script = read('popup.js');
  const css = read('popup.css');
  assert.doesNotMatch(html, /side-panel-brand-icon/);
  assert.doesNotMatch(html, />SCI 论文逻辑助手</);
  assert.doesNotMatch(html, /<h1>分析工作区<\/h1>/);
  assert.doesNotMatch(html, /class="llm-provider-row"/);
  assert.equal((html.match(/导出适配诊断包/g) || []).length, 1);
  assert.match(html, /id="sidePanelSettingsMenu"/);
  assert.match(html, /id="settingsRouteSummary"/);
  assert.match(script, /Escape/);
  assert.match(script, /pointerdown/);
  assert.match(script, /openSidePanelSettings\.focus/);
  assert.match(script, /openLlmSettingsMenuItem[\s\S]*openOptionsPage/);
  assert.match(css, /\.compact-paper-header\s*\{[^}]*position:\s*relative/s);
  assert.match(css, /\.side-panel-settings-menu\s*\{[^}]*position:\s*absolute/s);
  assert.match(css, /\.settings-route-row\s*\{[^}]*grid-template-columns:\s*42px\s+minmax\(0,\s*1fr\)/s);
});

test('side panel exposes one gear-owned adapter diagnostic export', () => {
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
  assert.match(render, /status\.textContent\s*=\s*summary/);
  assert.match(render, /statusText\.textContent\s*=\s*`已激活 · \$\{publisher\}`/);
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

test('disabled study types use a normal disabled cursor', () => {
  const css = read('popup.css');
  assert.doesNotMatch(css,
    /\.study-type-option:has\(input:disabled\)[^{]*\{[^}]*cursor:\s*wait/s);
  assert.match(css,
    /\.study-type-option:has\(input:disabled\)[^{]*\{[^}]*cursor:\s*not-allowed/s);
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
  const analysis = html.slice(
    html.indexOf('data-workspace-view="analysis"'),
    html.indexOf('data-workspace-view="navigation"')
  );
  assert.doesNotMatch(analysis, /id="generateReviewOutline"|id="openArticleNavigator"/);
  assert.match(html, /id="generateOutlineSummaries"/);
  assert.match(html, /生成逐段摘要/);
});

test('analysis workspace keeps the full-text action at the top and owns a visible icon', () => {
  const html = read('popup.html');
  const icons = read('vendor/phosphor/icons.css');
  const analysis = html.slice(
    html.indexOf('data-workspace-view="analysis"'),
    html.indexOf('data-workspace-view="navigation"')
  );
  assert.ok(analysis.indexOf('id="applyHighlight"') < analysis.indexOf('analysis-engine-section'));
  assert.match(analysis, /id="applyHighlight"[\s\S]*ph-file-magnifying-glass/);
  assert.match(html, /data-workspace-target="analysis"[\s\S]*ph-file-magnifying-glass/);
  assert.match(icons, /ph\.ph-file-magnifying-glass::before/);
});

test('new chat and migration controls use bundled visible icons', () => {
  const popup = read('popup.html');
  const options = read('options.html');
  const icons = read('vendor/phosphor/icons.css');

  assert.match(popup, /data-workspace-target="chat"[\s\S]*ph-chats-circle/);
  assert.match(popup, /id="sendArticleChat"[\s\S]*ph-paper-plane-tilt/);
  assert.match(options, /id="exportMigrationBundle"[\s\S]*ph-export/);
  assert.match(options, /ph-upload[\s\S]*id="importMigrationBundle"/);
  for (const icon of ['chats-circle', 'paper-plane-tilt', 'upload', 'export']) {
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

test('popup warns but does not block outline generation for non-review papers', () => {
  const script = read('popup.js');
  assert.match(script, /nonReviewNotice/);
  assert.match(script, /当前类型不是综述/);
  const start = script.indexOf('async function runReviewOutlineAnalysis');
  const end = script.indexOf('function renderManualAnnotationSummary', start);
  assert.doesNotMatch(
    script.slice(start, end),
    /if\s*\(\s*(?:response\.)?nonReviewNotice\s*\)\s*return/
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
  const listenerEnd = script.lastIndexOf("console.log('SCI论文逻辑关系高亮助手已加载')");
  const bootTail = script.slice(listenerEnd);
  assert.doesNotMatch(bootTail, /initializeManualAnnotationUi\(\)/);
  assert.doesNotMatch(bootTail, /maybeAutoAnalyzeWithLLM/);
  assert.match(script, /request\.action === 'prepareManualAnnotations'/);
});

test('popup is a full-height native side-panel workspace with five internal views', () => {
  const html = read('popup.html');
  const css = read('popup.css');
  const script = read('popup.js');
  assert.match(html, /id="sidePanelHeader"/);
  assert.match(html, /id="sidePanelDocumentStatus"/);
  for (const viewId of ['analysis', 'navigation', 'highlights', 'figures', 'chat']) {
    assert.match(html, new RegExp(`data-workspace-view="${viewId}"`));
    assert.match(html, new RegExp(`data-workspace-target="${viewId}"`));
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
});

test('side panel ignores stale workspace refreshes after the active tab changes', () => {
  const script = read('popup.js');
  assert.match(script, /let workspaceRefreshSequence\s*=\s*0/);
  assert.match(script, /const requestId\s*=\s*\+\+workspaceRefreshSequence/);
  assert.match(script, /requestId\s*!==\s*workspaceRefreshSequence/);
  assert.match(script, /currentTab\?\.id\s*!==\s*tab\.id/);
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
  assert.match(html, /id="generateOutlineSummaries"/);
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
