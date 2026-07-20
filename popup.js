// DOM-independent popup UI helpers: start
const PopupUiHelpers = (() => {
    function getCategoryEntry(entries, categoryId) {
        const found = (Array.isArray(entries) ? entries : [])
            .find(([entryId]) => entryId === categoryId);
        return found || null;
    }

    function getCurrentViewCategoryEntries({
        entries,
        preparedState,
        configuredCategoryIds = []
    }) {
        const categoryIds = Array.isArray(preparedState?.activeCategories)
            ? preparedState.activeCategories.map(category => category.categoryId)
            : configuredCategoryIds;
        return [...new Set(categoryIds)]
            .map(categoryId => getCategoryEntry(entries, categoryId))
            .filter(Boolean);
    }

    function getMoreCategoryGroups({
        readingViews = {},
        activeCategoryIds = [],
        entries,
        searchTerm = ''
    }) {
        const active = new Set(activeCategoryIds);
        const query = String(searchTerm || '').trim().toLocaleLowerCase();
        return Object.entries(readingViews).map(([viewId, view]) => {
            const groupedEntries = [...new Set(view?.categoryIds || [])]
                .filter(categoryId => !active.has(categoryId))
                .map(categoryId => getCategoryEntry(entries, categoryId))
                .filter(Boolean)
                .filter(([categoryId, category]) => {
                    if (!query) return true;
                    return `${categoryId} ${category?.name || ''}`
                        .toLocaleLowerCase()
                        .includes(query);
                });
            return {
                viewId,
                name: view?.name || viewId,
                entries: groupedEntries
            };
        }).filter(group => group.entries.length > 0);
    }

    function createAsyncIntentQueue({ onPendingChange } = {}) {
        let tail = Promise.resolve();
        let latestIntent = 0;
        let latestCompletion = Promise.resolve();
        let pending = false;
        let pendingListener = onPendingChange;

        function publishPending(nextPending, intent) {
            if (pending === nextPending) return;
            pending = nextPending;
            if (pendingListener) pendingListener(nextPending, intent);
        }

        async function drainLatest() {
            const expectedIntent = latestIntent;
            const expectedCompletion = latestCompletion;
            try {
                await expectedCompletion;
            } catch {
                // A failed mutation is settled too; its rollback owns the UI state.
            }
            if (latestIntent !== expectedIntent || pending) {
                return drainLatest();
            }
        }

        return Object.freeze({
            beginIntent() {
                latestIntent += 1;
                return latestIntent;
            },
            currentIntent() {
                return latestIntent;
            },
            isCurrent(intent) {
                return intent === latestIntent;
            },
            isPending() {
                return pending;
            },
            setOnPendingChange(listener) {
                pendingListener = listener;
            },
            drainLatest,
            enqueue(intent, operation) {
                if (intent === latestIntent) publishPending(true, intent);
                const run = tail.then(() => operation({
                    intent,
                    isCurrent: () => intent === latestIntent
                }));
                const completion = run.finally(() => {
                    if (intent === latestIntent) publishPending(false, intent);
                });
                tail = completion.catch(() => undefined);
                if (intent === latestIntent) latestCompletion = completion;
                return completion;
            }
        });
    }

    function runSavedMutation({
        coordinator,
        intent,
        save,
        onSaved,
        refresh,
        onSaveFailed,
        onRefreshFailed
    }) {
        return coordinator.enqueue(intent, async ({ isCurrent }) => {
            let saved;
            try {
                saved = await save();
            } catch (error) {
                if (isCurrent() && onSaveFailed) await onSaveFailed(error);
                return { status: 'save_failed', error };
            }
            if (onSaved) await onSaved(saved, { isCurrent });
            if (!isCurrent()) return { status: 'superseded', saved };
            if (!refresh) return { status: 'saved', saved };
            try {
                const refreshed = await refresh(saved, { isCurrent });
                return isCurrent()
                    ? { status: 'refreshed', saved, refreshed }
                    : { status: 'superseded', saved };
            } catch (error) {
                if (isCurrent() && onRefreshFailed) await onRefreshFailed(error);
                return isCurrent()
                    ? { status: 'refresh_failed', saved, error }
                    : { status: 'superseded', saved };
            }
        });
    }

    function shouldApplyPreparedResult({
        isCurrent,
        expectedDocumentHash,
        expectedViewId,
        prepared
    }) {
        return Boolean(isCurrent) && Boolean(prepared) &&
            (!expectedDocumentHash || prepared.documentHash === expectedDocumentHash) &&
            prepared.readingViewId === expectedViewId;
    }

    function getAvailableCategoryEntries(availableCategories, engine) {
        return (Array.isArray(availableCategories) ? availableCategories : [])
            .filter(category => category?.categoryId && category.retired !== true)
            .filter(category => {
                const engines = Array.isArray(category.enabledEngines)
                    ? category.enabledEngines : ['llm', 'regex'];
                return engines.includes(engine);
            })
            .map(category => [category.categoryId, { ...category }]);
    }

    function escapeRegexPhrase(value) {
        return String(value || '')
            .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
            .replace(/\\\.\\\*/g, '.*?');
    }

    function translateUnifiedRegexCategories(details) {
        const translated = {};
        (Array.isArray(details) ? details : []).forEach(detail => {
            const category = detail?.category || detail;
            const categoryId = String(category?.categoryId || '');
            if (!categoryId || category.retired === true) return;
            const regex = category.regex || {};
            const phrases = (Array.isArray(regex.phrases) ? regex.phrases : [])
                .map(escapeRegexPhrase)
                .filter(Boolean)
                .map(expression => regex.wholeWord
                    ? `\\b(?:${expression})\\b` : `(?:${expression})`);
            const expressions = (Array.isArray(regex.expressions) ? regex.expressions : [])
                .map(value => String(value || '').trim())
                .filter(Boolean)
                .map(expression => `(?:${expression})`);
            const parts = [...phrases, ...expressions];
            if (!parts.length) return;
            translated[categoryId] = {
                name: String(category.name || categoryId),
                color: String(category.color || '#0B4778'),
                patterns: [`(?:${parts.join('|')})`],
                isRegex: true,
                isBuiltIn: category.builtIn !== false
            };
        });
        return translated;
    }

    function shouldApplyRegexSnapshot({
        requestId,
        currentRequestId,
        tabId,
        currentTabId,
        documentId,
        currentDocumentId,
        revision,
        currentRevision,
        selectedIds,
        currentSelectedIds
    }) {
        return requestId === currentRequestId && tabId === currentTabId &&
            String(documentId || '') === String(currentDocumentId || '') &&
            Number(revision || 0) === Number(currentRevision || 0) &&
            JSON.stringify([...(selectedIds || [])].sort()) ===
                JSON.stringify([...(currentSelectedIds || [])].sort());
    }

    async function resolveRegexDetailsAtomically({
        categoryIds,
        fetchDetail,
        refreshState,
        validate
    }) {
        const details = await Promise.all(
            [...(categoryIds || [])].map(categoryId => fetchDetail(categoryId))
        );
        const state = await refreshState();
        if (!await validate(state)) {
            const error = new Error('分类规则或当前论文已变化，请重新应用');
            error.code = 'STALE_POPUP_STATE';
            throw error;
        }
        return { details, state };
    }

    async function runManualClear({ documentId, clearDocument, unwrap }) {
        const cleared = await clearDocument({ documentId });
        if (cleared?.record?.documentId !== documentId ||
            (cleared?.record?.annotations || []).length !== 0) {
            throw new Error('手动标注数据未完成清除');
        }
        const completionType = 'ANNOTATION_CLEAR_DOCUMENT';
        const unwrapped = await unwrap({
            documentId,
            completed: true,
            completionType
        });
        if (!unwrapped?.success) {
            const error = new Error(unwrapped?.error || '页面标记清除失败');
            error.backgroundCleared = true;
            error.record = cleared.record;
            throw error;
        }
        return { record: cleared.record, completionType };
    }

    function createInFlightActionGuard() {
        let pending = null;
        const release = () => { pending = null; };
        return Object.freeze({
            isPending: () => Boolean(pending),
            run(operation) {
                if (pending) return pending;
                pending = Promise.resolve().then(operation);
                pending.then(release, release);
                return pending;
            }
        });
    }

    function createLatestStateRefresher({ load, apply }) {
        let latestRequest = 0;
        return Object.freeze({
            async refresh() {
                const requestId = ++latestRequest;
                const state = await load();
                if (requestId !== latestRequest) return { status: 'stale', state };
                apply(state);
                return { status: 'applied', state };
            }
        });
    }

    function getPublicRouteSummaryRows(settings) {
        const profiles = settings?.profiles || {};
        const global = profiles[settings?.globalProfileId];
        const profileLabel = profile => {
            if (!profile || typeof profile !== 'object') return '未配置';
            const name = String(profile.name || '').trim() || '未命名配置';
            const model = String(profile.config?.model || '').trim() || '未填写模型';
            return `${name} · ${model}`;
        };
        const routeLabel = taskType => {
            const route = settings?.taskRoutes?.[taskType];
            const profile = route?.mode === 'profile' ? profiles[route.profileId] : global;
            return profileLabel(profile);
        };
        return [
            ['全局', profileLabel(global)],
            ['高亮', routeLabel('highlight')],
            ['摘要', routeLabel('summary')],
            ['解图', routeLabel('figure')],
            ['多图', routeLabel('crossFigure')]
        ];
    }

    return Object.freeze({
        getCategoryEntry,
        getCurrentViewCategoryEntries,
        getMoreCategoryGroups,
        getAvailableCategoryEntries,
        translateUnifiedRegexCategories,
        shouldApplyRegexSnapshot,
        resolveRegexDetailsAtomically,
        runManualClear,
        createInFlightActionGuard,
        createLatestStateRefresher,
        getPublicRouteSummaryRows,
        createAsyncIntentQueue,
        runSavedMutation,
        shouldApplyPreparedResult
    });
})();
// DOM-independent popup UI helpers: end

const {
    getCategoryEntry,
    getCurrentViewCategoryEntries,
    getMoreCategoryGroups,
    getAvailableCategoryEntries,
    translateUnifiedRegexCategories,
    shouldApplyRegexSnapshot,
    resolveRegexDetailsAtomically,
    runManualClear,
    createInFlightActionGuard,
    createLatestStateRefresher,
    getPublicRouteSummaryRows,
    createAsyncIntentQueue,
    runSavedMutation,
    shouldApplyPreparedResult
} = PopupUiHelpers;

let selectedCategories = new Set();
let regexSelectionStored = false;
let llmSelectedCategories = new Set();
let highlightMode = 'word';
let analysisMode = 'regex';
let persistedAnalysisMode = 'regex';
let llmSettingsState = null;
const articleArchiveExportGuard = createInFlightActionGuard();
const settingsRouteSummaryRefresher = createLatestStateRefresher({
    load: () => sendLlmMessage({ type: 'LLM_GET_SETTINGS' }),
    apply: state => { llmSettingsState = state; }
});
let confidenceThreshold = 0.8;
let persistedConfidenceThreshold = 0.8;
let readingViewId = 'quick_story';
let persistedReadingViewId = 'quick_story';
let preparedDocumentState = null;
let currentArticleDocument = null;
let prepareState = 'idle';
let studyTypeSelectionInFlight = false;
let selectedStudyTypeOverride = '';
let regexApplySequence = 0;
let regexApplyPending = false;
let highlightTaskState = { running: false, paused: false, cancelled: false };
let automaticClearPending = false;
let manualClearPending = false;
let manualSummarySequence = 0;
let manualAnnotationState = {
    tabId: null,
    documentId: '',
    documentHash: '',
    canonicalUrl: '',
    title: '',
    annotationCount: 0,
    unresolvedCount: 0
};
const preferenceMutationCoordinator = createAsyncIntentQueue();
preferenceMutationCoordinator.setOnPendingChange(() => updateApplyButton());
let figureAnalysisState = {
    running: false,
    phase: 'idle',
    currentFigure: 0,
    totalFigures: 0,
    completedFigures: 0,
    failedFigures: 0,
    figureLabel: '',
    message: '',
    figureProgress: []
};
let figureProgressTimer = null;
let figureProgressPollingGeneration = 0;
let figureProgressRefreshSequence = 0;
let figureWorkspaceProgressSignature = '';
let crossFigureLogicRunning = false;
const figureExpansionState = new Map();
const figurePanelExpansionState = new Map();
const figureSectionExpansionState = new Map();
const panelFollowupDraftState = new Map();
let figureQuickNavActiveId = '';
let figureQuickNavHoverTimer = null;
let figureQuickNavExpandedFigureId = '';
const METHOD_CATEGORY_LABELS = Object.freeze({
    wet_lab: '\u6e7f\u5b9e\u9a8c',
    imaging: '\u6210\u50cf',
    bioinformatics: '\u751f\u7269\u4fe1\u606f\u5b66',
    clinical: '\u4e34\u5e8a',
    schematic: '\u793a\u610f\u56fe',
    other: '\u5176\u4ed6'
});
let figureTaskGeneration = 0;
let reviewOutlineState = {
    running: false,
    phase: 'idle',
    completedParagraphs: 0,
    totalParagraphs: 0,
    completedChunks: 0,
    totalChunks: 0,
    message: '',
    hasOutline: false,
    globalSynthesisAvailable: null
};
let reviewOutlineProgressTimer = null;
let matchCounts = {}; // 存储匹配计数
let activeWorkspaceView = 'analysis';
let currentWorkspaceSnapshot = null;
let articleChatSelectedProfileId = '';
const articleChatTurnElements = new Map();
const articleChatHistoryPageSize = 30;
let articleChatVisibleTurnCount = articleChatHistoryPageSize;
let articleChatFollowLatest = true;
let articleChatRenderedDocumentKey = '';
let articleChatScrollToLatestActive = false;
const workspaceParagraphSummaryState = new Map();
let reviewOutlineTaskGeneration = 0;
let paragraphSummaryTaskGeneration = 0;
let workspaceRefreshSequence = 0;
let currentArticleArchiveProbe = null;
let articlePreparationSequence = 0;
let lastArticlePreparationError = null;
const PANEL_TAB_STATE_CACHE_LIMIT = 6;
const panelTabStateCache = new Map();
let activePanelTabContext = {
    tabId: null,
    url: '',
    key: '',
    activated: false,
    tabContextSequence: 0
};
let panelUiReady = false;
let tabContextSequence = 0;
let tabContextRequestSequence = 0;
let tabContextSyncTimer = null;

function capturePanelContext(taskToken = 0) {
    return SciLLM.capturePanelContext(activePanelTabContext, taskToken);
}

function isCurrentPanelContext(panelContext) {
    return SciLLM.isCurrentPanelContext(activePanelTabContext, panelContext);
}

function isCurrentReviewOutlineTask(panelContext) {
    return isCurrentPanelContext(panelContext) &&
        Number(panelContext?.taskToken) === reviewOutlineTaskGeneration;
}

function isCurrentParagraphSummaryTask(panelContext) {
    return isCurrentPanelContext(panelContext) &&
        Number(panelContext?.taskToken) === paragraphSummaryTaskGeneration;
}

function panelTabDocumentKey(tab = {}) {
    const tabId = Number(tab.id);
    const url = SciLLM.normalizeTabDocumentUrl(tab.url || tab.pendingUrl);
    return Number.isInteger(tabId) && url ? `${tabId}|${url}` : '';
}

function cacheCurrentPanelTabState() {
    const key = activePanelTabContext.key;
    if (!key || !activePanelTabContext.activated || !currentWorkspaceSnapshot ||
        ['preparing', 'analyzing'].includes(prepareState)) return;
    panelTabStateCache.delete(key);
    panelTabStateCache.set(key, {
        preparedDocumentState,
        currentArticleDocument,
        prepareState,
        selectedStudyTypeOverride,
        manualAnnotationState: { ...manualAnnotationState },
        matchCounts: { ...matchCounts },
        currentWorkspaceSnapshot,
        currentArticleArchiveProbe,
        figureAnalysisState: { ...figureAnalysisState },
        reviewOutlineState: { ...reviewOutlineState }
    });
    while (panelTabStateCache.size > PANEL_TAB_STATE_CACHE_LIMIT) {
        panelTabStateCache.delete(panelTabStateCache.keys().next().value);
    }
}

function resetPanelArticleState() {
    articlePreparationSequence += 1;
    workspaceRefreshSequence += 1;
    manualSummarySequence += 1;
    regexApplySequence += 1;
    preferenceMutationCoordinator.beginIntent();
    stopFigureProgressPolling();
    figureWorkspaceProgressSignature = '';
    figureExpansionState.clear();
    figurePanelExpansionState.clear();
    figureSectionExpansionState.clear();
    panelFollowupDraftState.clear();
    figureQuickNavActiveId = '';
    figureQuickNavExpandedFigureId = '';
    clearTimeout(figureQuickNavHoverTimer);
    figureQuickNavHoverTimer = null;
    articleChatTurnElements.clear();
    articleChatVisibleTurnCount = articleChatHistoryPageSize;
    articleChatFollowLatest = true;
    articleChatRenderedDocumentKey = '';
    articleChatScrollToLatestActive = false;
    stopReviewOutlineProgressPolling();
    figureTaskGeneration += 1;
    reviewOutlineTaskGeneration += 1;
    paragraphSummaryTaskGeneration += 1;
    figureAnalysisState = {
        running: false, phase: 'idle', currentFigure: 0, totalFigures: 0,
        completedFigures: 0, failedFigures: 0, figureLabel: '', message: '', figureProgress: []
    };
    crossFigureLogicRunning = false;
    workspaceParagraphSummaryState.clear();
    reviewOutlineState = {
        running: false, phase: 'idle', completedParagraphs: 0, totalParagraphs: 0,
        completedChunks: 0, totalChunks: 0, message: '', hasOutline: false,
        globalSynthesisAvailable: null
    };
    preparedDocumentState = null;
    currentArticleDocument = null;
    prepareState = 'idle';
    selectedStudyTypeOverride = '';
    manualAnnotationState = {
        tabId: null,
        documentId: '',
        documentHash: '',
        canonicalUrl: '',
        title: '',
        annotationCount: 0,
        unresolvedCount: 0
    };
    matchCounts = {};
    currentWorkspaceSnapshot = null;
    currentArticleArchiveProbe = null;
    lastArticlePreparationError = null;
    setArticleArchivePrompt(null);
    renderArticleNavigationTree(null);
    renderEvidenceLedger(null);
    renderHighlightDistributionSnapshot(null);
    renderFigureWorkspaceSnapshot(null);
    renderArticleChatSnapshot(null);
    renderManualAnnotationSummary();
    renderStudyTypeChooser();
    renderCategories();
    updateApplyButton();
}

function isCurrentFigureTask(token, tabId) {
    return token === figureTaskGeneration &&
        Number(tabId) === Number(activePanelTabContext.tabId);
}

function renderInactiveTabState(tab = null) {
    document.getElementById('sidePanelApp')?.classList.add('is-tab-inactive');
    const title = document.getElementById('sidePanelPaperTitle');
    const statusText = document.getElementById('sidePanelDocumentStatusText');
    const status = document.getElementById('sidePanelDocumentStatus');
    const navigationStatus = document.getElementById('articleNavigationStatus');
    const retry = document.getElementById('retryArticlePreparation');
    if (title) title.textContent = tab?.title || '当前页面';
    if (statusText) statusText.textContent = '此标签页尚未激活，请点击扩展图标激活';
    if (navigationStatus) navigationStatus.textContent = '点击扩展图标后读取当前论文结构';
    status?.classList.remove('is-error', 'is-ready');
    status?.classList.add('is-idle');
    if (retry) retry.hidden = true;
}

function restorePanelTabState(cached) {
    preparedDocumentState = cached.preparedDocumentState || null;
    currentArticleDocument = cached.currentArticleDocument || null;
    prepareState = cached.prepareState || 'idle';
    selectedStudyTypeOverride = cached.selectedStudyTypeOverride || '';
    manualAnnotationState = { ...cached.manualAnnotationState };
    matchCounts = { ...cached.matchCounts };
    currentWorkspaceSnapshot = cached.currentWorkspaceSnapshot || null;
    currentArticleArchiveProbe = cached.currentArticleArchiveProbe || null;
    reviewOutlineState = { ...reviewOutlineState, ...cached.reviewOutlineState };
    document.getElementById('sidePanelApp')?.classList.remove('is-tab-inactive');
    renderArticleWorkspaceSnapshot(currentWorkspaceSnapshot);
    resumeFigureProgressFromWorkspaceSnapshot(currentWorkspaceSnapshot);
    setArticleArchivePrompt(currentArticleArchiveProbe);
    renderManualAnnotationSummary();
    syncPreparedSelection();
    renderStudyTypeChooser();
    renderCategories();
    updateApplyButton();
}

async function synchronizeActiveTabContext({ force = false } = {}) {
    if (!panelUiReady) return null;
    const requestId = ++tabContextRequestSequence;
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (requestId !== tabContextRequestSequence) return null;
    const key = panelTabDocumentKey(tab);
    const activated = Boolean(key &&
        await SciLLM.isTabActivated(chrome.storage.session, tab));
    if (requestId !== tabContextRequestSequence) return null;
    if (!force && activePanelTabContext.key === key &&
        activePanelTabContext.activated === activated) return activePanelTabContext;

    cacheCurrentPanelTabState();
    tabContextSequence += 1;
    activePanelTabContext = {
        tabId: tab?.id ?? null,
        url: SciLLM.normalizeTabDocumentUrl(tab?.url || tab?.pendingUrl),
        key,
        activated,
        tabContextSequence
    };
    resetPanelArticleState();

    if (!activated) {
        renderInactiveTabState(tab);
        return activePanelTabContext;
    }

    document.getElementById('sidePanelApp')?.classList.remove('is-tab-inactive');
    const cached = !force ? panelTabStateCache.get(key) : null;
    if (cached) {
        panelTabStateCache.delete(key);
        panelTabStateCache.set(key, cached);
        restorePanelTabState(cached);
        void refreshArticleWorkspace();
        return activePanelTabContext;
    }

    const snapshot = await initializeCurrentArticle();
    if (requestId === tabContextRequestSequence && snapshot) cacheCurrentPanelTabState();
    return activePanelTabContext;
}

function scheduleActiveTabContextSync(options = {}) {
    clearTimeout(tabContextSyncTimer);
    tabContextSyncTimer = setTimeout(() => {
        tabContextSyncTimer = null;
        void synchronizeActiveTabContext(options);
    }, 0);
}

function setupActiveTabSynchronization() {
    chrome.tabs.onActivated.addListener(() => scheduleActiveTabContextSync());
    chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
        if (changeInfo.url) {
            scheduleActiveTabContextSync();
        } else if (changeInfo.status === 'complete' &&
            tabId === activePanelTabContext.tabId && activePanelTabContext.activated) {
            scheduleActiveTabContextSync({ force: true });
        }
    });
    chrome.tabs.onRemoved.addListener(tabId => {
        const prefix = `${Number(tabId)}|`;
        [...panelTabStateCache.keys()].forEach(key => {
            if (key.startsWith(prefix)) panelTabStateCache.delete(key);
        });
    });
    chrome.runtime.onMessage.addListener((message, sender) => {
        if (message?.type === 'PANEL_TAB_ACTIVATED') scheduleActiveTabContextSync();
        if (message?.type === 'ARTICLE_STRUCTURE_CHANGED' &&
            Number(sender?.tab?.id) === Number(activePanelTabContext.tabId) &&
            activePanelTabContext.activated) {
            void refreshArticleWorkspace();
        }
        if (message?.type === 'ARTICLE_CHAT_STATE_CHANGED' &&
            Number(sender?.tab?.id) === Number(activePanelTabContext.tabId) &&
            activePanelTabContext.activated) {
            applyArticleChatStateEvent(message.event);
        }
    });
}

function switchWorkspaceView(viewId) {
    const target = ['analysis', 'navigation', 'highlights', 'figures', 'chat'].includes(viewId)
        ? viewId : 'analysis';
    activeWorkspaceView = target;
    document.querySelectorAll('[data-workspace-view]').forEach(view => {
        const active = view.dataset.workspaceView === target;
        view.hidden = !active;
        view.classList.toggle('active', active);
    });
    document.querySelectorAll('[data-workspace-target]').forEach(button => {
        button.setAttribute('aria-selected', String(button.dataset.workspaceTarget === target));
    });
}

function setAllOutlineLevelsExpanded(expanded) {
    const container = document.getElementById('articleNavigationTree');
    if (!container) return;
    if (!expanded) {
        container.querySelectorAll('details.workspace-tree-node')
            .forEach(details => { details.open = false; });
        return;
    }
    container.querySelectorAll('details.workspace-tree-node:not([data-leaf="true"])')
        .forEach(details => { details.open = true; });
}

function setAllFigureLevelsExpanded(expanded) {
    const container = document.getElementById('figureWorkspace');
    if (!container) return;
    container.querySelectorAll('details.workspace-figure-card').forEach(details => {
        details.open = expanded;
        if (details.dataset.figureId) {
            figureExpansionState.set(details.dataset.figureId, expanded);
        }
    });
    if (!expanded) {
        container.querySelectorAll('details.workspace-figure-panel-card').forEach(details => {
            details.open = false;
            figurePanelExpansionState.set(
                panelWorkspaceKey(details.dataset.figureId, details.dataset.panelId), false
            );
        });
    }
}

function setupWorkspaceNavigation() {
    document.querySelectorAll('[data-workspace-target]').forEach(button => {
        button.addEventListener('click', () => {
            const target = button.dataset.workspaceTarget;
            switchWorkspaceView(target);
            if (target !== 'analysis') void refreshArticleWorkspace();
        });
    });
    document.getElementById('refreshArticleNavigation')?.addEventListener('click', () => {
        void refreshArticleWorkspace({ announce: true });
    });
    document.getElementById('expandAllOutlineLevels')?.addEventListener('click', () => {
        setAllOutlineLevelsExpanded(true);
    });
    document.getElementById('collapseAllOutlineLevels')?.addEventListener('click', () => {
        setAllOutlineLevelsExpanded(false);
    });
    document.getElementById('expandAllFigureLevels')?.addEventListener('click', () => {
        setAllFigureLevelsExpanded(true);
    });
    document.getElementById('collapseAllFigureLevels')?.addEventListener('click', () => {
        setAllFigureLevelsExpanded(false);
    });
    document.getElementById('refreshFigureInventory')?.addEventListener('click', () => {
        void refreshArticleWorkspace({ announce: true });
    });
    document.getElementById('generateOutlineSummaries')?.addEventListener('click', () => {
        void runReviewOutlineAnalysis({
            forceRefresh: Boolean(currentWorkspaceSnapshot?.reviewOutline)
        });
    });
    switchWorkspaceView(activeWorkspaceView);
}

function closeSidePanelSettingsMenu({ restoreFocus = true } = {}) {
    const openSidePanelSettings = document.getElementById('openSidePanelSettings');
    const menu = document.getElementById('sidePanelSettingsMenu');
    if (!menu || menu.hidden) return;
    menu.hidden = true;
    openSidePanelSettings?.setAttribute('aria-expanded', 'false');
    if (restoreFocus && openSidePanelSettings) openSidePanelSettings.focus();
}

function setupSidePanelSettingsMenu() {
    const openSidePanelSettings = document.getElementById('openSidePanelSettings');
    const menu = document.getElementById('sidePanelSettingsMenu');
    const openLlmSettingsMenuItem = document.getElementById('openLlmSettingsMenuItem');
    if (!openSidePanelSettings || !menu) return;

    openSidePanelSettings.addEventListener('click', async () => {
        const expanded = openSidePanelSettings.getAttribute('aria-expanded') === 'true';
        if (expanded) {
            closeSidePanelSettingsMenu();
            return;
        }
        menu.hidden = false;
        openSidePanelSettings.setAttribute('aria-expanded', 'true');
        await refreshSettingsRouteSummary();
    });
    document.addEventListener('pointerdown', event => {
        if (!menu.hidden && !menu.contains(event.target) &&
            !openSidePanelSettings.contains(event.target)) {
            closeSidePanelSettingsMenu();
        }
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !menu.hidden) {
            event.preventDefault();
            closeSidePanelSettingsMenu();
        }
    });
    openLlmSettingsMenuItem?.addEventListener('click', () => {
        closeSidePanelSettingsMenu();
        chrome.runtime.openOptionsPage();
    });
}

function createWorkspaceElement(tagName, className = '', text = '') {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
}

async function refreshSettingsRouteSummary() {
    try {
        const result = await settingsRouteSummaryRefresher.refresh();
        if (result.status === 'applied') renderSettingsRouteSummary();
        return result;
    } catch (error) {
        return { status: 'failed', error };
    }
}

async function focusWorkspaceSource(target, panelContext = capturePanelContext()) {
    if (!isCurrentPanelContext(panelContext)) return false;
    const response = await sendTabMessage(panelContext.tabId, {
        action: 'focusArticleWorkspaceSource',
        target
    });
    if (!isCurrentPanelContext(panelContext)) return false;
    return Boolean(response?.success && response?.focused);
}

function buildOutlineSummaryIndex(outline, standaloneParagraphs = []) {
    const sections = new Map();
    const paragraphs = new Map();
    function visit(node) {
        const value = {
            summary: String(node?.summary || ''),
            paragraphs: Array.isArray(node?.paragraphs) ? node.paragraphs : []
        };
        if (node?.sectionId) sections.set(String(node.sectionId), value);
        const title = String(node?.title || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
        if (title) sections.set(`title:${title.toLowerCase()}`, value);
        value.paragraphs.forEach(paragraph => {
            const paragraphId = String(paragraph?.paragraphId || '');
            if (paragraphId) paragraphs.set(paragraphId, paragraph);
        });
        (Array.isArray(node?.children) ? node.children : []).forEach(visit);
    }
    (Array.isArray(outline?.nodes) ? outline.nodes : []).forEach(visit);
    (Array.isArray(standaloneParagraphs) ? standaloneParagraphs : [])
        .forEach(paragraph => {
            const paragraphId = String(paragraph?.paragraphId || '');
            if (paragraphId) paragraphs.set(paragraphId, paragraph);
        });
    return { sections, paragraphs };
}

function workspaceParagraphsForNode(snapshot, node) {
    return (Array.isArray(snapshot?.paragraphs) ? snapshot.paragraphs : [])
        .filter(paragraph =>
            String(paragraph.sectionId || '') === String(node.sectionId || ''));
}

async function runSingleParagraphSummary(
    paragraph,
    panelContext = capturePanelContext(paragraphSummaryTaskGeneration)
) {
    const paragraphId = String(paragraph?.paragraphId || '');
    if (!isCurrentParagraphSummaryTask(panelContext) || !paragraphId ||
        workspaceParagraphSummaryState.get(paragraphId)?.loading) return;
    workspaceParagraphSummaryState.set(paragraphId, { loading: true, error: '' });
    renderArticleNavigationTree(currentWorkspaceSnapshot);
    try {
        const response = await sendTabMessage(panelContext.tabId, {
            action: 'analyzeReviewParagraphWithLLM',
            paragraphId,
            sourceKey: String(paragraph?.sourceKey || ''),
            navigationRevision: Number(paragraph?.navigationRevision) || 0,
            documentId: preparedDocumentState?.documentId,
            documentHash: preparedDocumentState?.documentHash
        });
        if (!isCurrentParagraphSummaryTask(panelContext)) return;
        if (!response?.success) {
            const error = new Error(response?.error || '单段摘要生成失败');
            error.code = response?.code;
            throw error;
        }
        workspaceParagraphSummaryState.delete(paragraphId);
        await refreshArticleWorkspace({ panelContext });
        if (!isCurrentParagraphSummaryTask(panelContext)) return;
    } catch (error) {
        if (!isCurrentParagraphSummaryTask(panelContext)) return;
        if (error?.code === 'PARAGRAPH_STALE') {
            const message = '该段落已更新或不再存在，请刷新文章导航后重试';
            workspaceParagraphSummaryState.set(paragraphId, {
                loading: false,
                error: message
            });
            renderArticleNavigationTree(currentWorkspaceSnapshot);
            showStatus(message, 'error');
            return;
        }
        workspaceParagraphSummaryState.set(paragraphId, {
            loading: false,
            error: error.message || '单段摘要生成失败'
        });
        renderArticleNavigationTree(currentWorkspaceSnapshot);
        showStatus('单段摘要生成失败：' + error.message, 'error');
    }
}

function renderArticleNavigationTree(snapshot = currentWorkspaceSnapshot) {
    const container = document.getElementById('articleNavigationTree');
    if (!container) return;
    const hadTree = Boolean(container.querySelector('details.workspace-tree-node'));
    const previouslyOpen = new Set(
        Array.from(container.querySelectorAll('details.workspace-tree-node[open]'))
            .map(details => details.dataset.nodeKey).filter(Boolean)
    );
    container.replaceChildren();
    const nodes = Array.isArray(snapshot?.nodes) ? snapshot.nodes : [];
    if (!nodes.length) {
        container.appendChild(createWorkspaceElement(
            'div', 'workspace-empty', '暂未识别到稳定的正文标题。可等待页面加载完成后刷新。'
        ));
        return;
    }
    const summaryIndex = buildOutlineSummaryIndex(
        snapshot?.reviewOutline,
        snapshot?.paragraphSummaries
    );

    function appendNode(node, parent, depth = 0) {
        const children = Array.isArray(node.children) ? node.children : [];
        const leaf = children.length === 0;
        const nodeKey = String(node.sectionId || node.sourceKey ||
            `${depth}:${node.order || 0}:${node.title || ''}`);
        const details = createWorkspaceElement('details', 'workspace-tree-node');
        details.dataset.nodeKey = nodeKey;
        details.dataset.treeDepth = String(Math.min(3, Math.max(0, depth)));
        details.dataset.leaf = String(leaf);
        details.open = hadTree ? previouslyOpen.has(nodeKey) : depth === 0;
        const summary = createWorkspaceElement('summary', 'workspace-tree-summary');
        const toggle = createWorkspaceElement(
            'button', 'workspace-tree-toggle', details.open ? '\u2212' : '+'
        );
        toggle.type = 'button';
        toggle.disabled = leaf && Number(node.paragraphCount || 0) === 0;
        const updateToggle = () => {
            toggle.textContent = details.open ? '\u2212' : '+';
            const action = details.open ? '收起' : '展开';
            toggle.setAttribute('aria-label', leaf
                ? `${action}${node.title || '当前标题'}的段落摘要`
                : `${action}${node.title || '当前标题'}的下级标题`);
        };
        toggle.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            if (!toggle.disabled) details.open = !details.open;
        });
        details.addEventListener('toggle', updateToggle);
        updateToggle();
        const jump = createWorkspaceElement(
            'button', 'workspace-tree-jump', node.title || '未命名章节'
        );
        jump.type = 'button';
        jump.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            void focusWorkspaceSource({
                kind: 'section', sectionId: node.sectionId, sourceKey: node.sourceKey
            });
        });
        const count = createWorkspaceElement(
            'span', 'workspace-tree-count', `${node.paragraphCount || 0} 段`
        );
        summary.append(toggle, jump, count);
        details.appendChild(summary);
        if (leaf) {
            const nodeParagraphs = workspaceParagraphsForNode(snapshot, node);
            const list = createWorkspaceElement('div', 'workspace-paragraph-list');
            nodeParagraphs.forEach((paragraph, index) => {
                const paragraphId = String(paragraph.paragraphId || '');
                const saved = summaryIndex.paragraphs.get(paragraphId);
                const task = workspaceParagraphSummaryState.get(paragraphId) || {};
                let label = `第 ${index + 1} 段 · 点击生成摘要`;
                let className = 'workspace-paragraph-summary';
                if (task.loading) {
                    label = `正在生成第 ${index + 1} 段摘要…`;
                    className += ' is-loading';
                } else if (task.error) {
                    label = `第 ${index + 1} 段 · 生成失败，点击重试`;
                    className += ' is-error';
                } else if (saved?.summary) {
                    label = `第 ${index + 1} 段 · ${saved.summary}`;
                }
                const button = createWorkspaceElement('button', className, label);
                button.type = 'button';
                button.dataset.paragraphId = paragraphId;
                button.disabled = task.loading || reviewOutlineState.running;
                button.title = task.error || paragraph.text || label;
                button.addEventListener('click', async () => {
                    const panelContext = capturePanelContext(paragraphSummaryTaskGeneration);
                    const target = {
                        kind: 'paragraph',
                        paragraphId,
                        sourceKey: paragraph.sourceKey,
                        navigationRevision: Number(paragraph.navigationRevision ||
                            snapshot?.revision || 0)
                    };
                    const focused = await focusWorkspaceSource(target, panelContext);
                    if (!isCurrentParagraphSummaryTask(panelContext)) return;
                    if (!focused) {
                        showStatus('无法定位该段落：原文内容可能已更新，请刷新文章导航后重试', 'error');
                        return;
                    }
                    if (saved?.summary) {
                    } else if (llmSettingsState?.effectiveMode !== 'llm') {
                        showStatus('请先配置可用的 LLM API', 'error');
                    } else {
                        void runSingleParagraphSummary(paragraph, panelContext);
                    }
                });
                list.appendChild(button);
            });
            details.appendChild(list);
        }
        children.forEach(child => appendNode(child, details, depth + 1));
        parent.appendChild(details);
    }
    nodes.forEach(node => appendNode(node, container, 0));
}

function renderEvidenceLedger(snapshot = currentWorkspaceSnapshot) {
    const container = document.getElementById('evidenceLedger');
    if (!container) return;
    container.replaceChildren(createWorkspaceElement('h3', '', '论文证据台账'));
    const ledger = snapshot?.ledger;
    const relations = Array.isArray(ledger?.relationSummaries) ? ledger.relationSummaries : [];
    const warnings = Array.isArray(ledger?.reviewWarnings) ? ledger.reviewWarnings : [];
    const audits = Array.isArray(ledger?.auditItems) ? ledger.auditItems : [];
    if (!relations.length && !warnings.length && !audits.length) {
        container.appendChild(createWorkspaceElement(
            'div', 'workspace-empty', '完成 AI 分析后，核心证据与审读提醒会显示在这里。'
        ));
        return;
    }
    const groups = [
        ['核心证据', relations, item => `${item.labelZh || '证据关系'} · ${(item.annotationIds || []).length} 条`],
        ['审读提醒', warnings, item => item.reasonZh || '需要复核'],
        ['待核查', audits, item => item.messageZh || '待核查信息']
    ];
    groups.forEach(([label, items, format]) => {
        if (!items.length) return;
        container.appendChild(createWorkspaceElement('h4', 'workspace-result-heading', `${label}（${items.length}）`));
        items.forEach(item => {
            const button = createWorkspaceElement('button', 'workspace-result-item', format(item));
            button.type = 'button';
            button.addEventListener('click', () => void focusWorkspaceSource({
                kind: 'evidence',
                annotationIds: item.annotationIds || [
                    ...(item.claimAnnotationIds || []), ...(item.evidenceAnnotationIds || [])
                ],
                relationId: item.relationId || ''
            }));
            container.appendChild(button);
        });
    });
}

function renderHighlightDistributionSnapshot(snapshot = currentWorkspaceSnapshot) {
    const container = document.getElementById('highlightDistribution');
    if (!container) return;
    container.replaceChildren(createWorkspaceElement('h3', '', '高亮分布'));
    const distribution = snapshot?.highlightDistribution;
    if (!distribution?.totalHighlights) {
        container.appendChild(createWorkspaceElement('div', 'workspace-empty', '当前页面还没有可归类的高亮。'));
        return;
    }
    (distribution.rows || []).forEach(row => {
        const block = createWorkspaceElement('section', 'workspace-distribution-row');
        const title = createWorkspaceElement('button', 'workspace-distribution-title', row.title);
        title.type = 'button';
        title.addEventListener('click', () => void focusWorkspaceSource({
            kind: 'section', sectionId: row.sectionId
        }));
        block.appendChild(title);
        const cells = createWorkspaceElement('div', 'workspace-distribution-cells');
        (distribution.categories || []).forEach(category => {
            const value = row.cells?.[category.categoryId];
            if (!value?.count) return;
            const button = createWorkspaceElement(
                'button', 'workspace-distribution-cell', `${category.name} ${value.count}`
            );
            button.type = 'button';
            button.style.borderLeftColor = category.color || '#0b4778';
            button.addEventListener('click', () => void focusWorkspaceSource({
                kind: 'highlight', highlightId: value.items?.[0]?.highlightId || ''
            }));
            cells.appendChild(button);
        });
        block.appendChild(cells);
        container.appendChild(block);
    });
}

function appendFigureWorkspaceField(parent, label, value) {
    if (!value) return;
    const row = createWorkspaceElement('p', 'workspace-figure-field');
    row.append(
        createWorkspaceElement('strong', '', `${label}\uff1a`),
        document.createTextNode(String(value))
    );
    parent.appendChild(row);
}

function formatFigurePanelHeader(panel) {
    const safePanel = panel || {};
    const parts = [
        `Panel ${safePanel.panel || '?'}`,
        safePanel.role || '\u8bc1\u636e\u5355\u5143'
    ];
    if (safePanel.role === 'phenotype') {
        parts.push(safePanel.phenotypeName || '\u672a\u660e\u786e');
    }
    const methods = Array.isArray(safePanel.methods)
        ? safePanel.methods.filter(Boolean) : [];
    parts.push(methods.length
        ? methods.join('\u3001')
        : (METHOD_CATEGORY_LABELS[safePanel.methodCategory] || METHOD_CATEGORY_LABELS.other));
    return parts.filter(Boolean).join(' \u00b7 ');
}

const PANEL_FOLLOWUP_OPTIONS = Object.freeze([
    ['grouping', '分组含义与设置'],
    ['technique_principle', '实验技术原理'],
    ['axes_reading', '横纵坐标含义与读图方法'],
    ['sample_information', '实验所用样本信息']
]);

function panelWorkspaceKey(figureId, panelId) {
    return `${String(figureId || '')}::${String(panelId || '').toUpperCase()}`;
}

function formatFigurePanelInputBasis(value) {
    if (!value || typeof value !== 'object') return '';
    const mode = {
        panel_crop: 'Panel 裁切图',
        figure_image: '最佳单张 Figure 图',
        caption_context: '图注与相关正文（未发送图片）'
    }[value.inputMode] || '按容量规划的证据';
    const size = value.pixelsSupplied && value.imageWidth && value.imageHeight
        ? ` · ${value.imageWidth}×${value.imageHeight} px` : '';
    const retry = Number(value.attempts) > 1 ? ` · 第 ${value.attempts} 次降级请求` : '';
    return `${mode}${size}${retry}`;
}

function getPanelFollowupDraft(figureId, panelId) {
    const key = panelWorkspaceKey(figureId, panelId);
    if (!panelFollowupDraftState.has(key)) {
        panelFollowupDraftState.set(key, { open: false, topics: new Set(), question: '' });
    }
    return panelFollowupDraftState.get(key);
}

function createPanelFollowupControl(figure, panel) {
    const panelId = String(panel?.panel || '').toUpperCase();
    const followups = figure?.panelFollowups && typeof figure.panelFollowups === 'object'
        ? figure.panelFollowups : {};
    const errors = figure?.panelFollowupErrors && typeof figure.panelFollowupErrors === 'object'
        ? figure.panelFollowupErrors : {};
    const loading = figure?.panelFollowupLoading?.[panelId] === true;
    const draft = getPanelFollowupDraft(figure.figureId, panelId);
    const root = createWorkspaceElement('section', 'workspace-panel-followup');
    const toggle = createWorkspaceElement(
        'button', 'btn btn-secondary workspace-panel-followup-toggle', '追问此 Panel'
    );
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', String(draft.open));
    const chooser = createWorkspaceElement('div', 'workspace-panel-followup-chooser');
    chooser.hidden = !draft.open;
    const choices = createWorkspaceElement('div', 'workspace-panel-followup-options');
    PANEL_FOLLOWUP_OPTIONS.forEach(([topic, label]) => {
        const choice = createWorkspaceElement('label', 'workspace-panel-followup-option');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = topic;
        checkbox.checked = draft.topics.has(topic);
        checkbox.addEventListener('change', () => {
            if (checkbox.checked) draft.topics.add(topic);
            else draft.topics.delete(topic);
        });
        choice.append(checkbox, document.createTextNode(label));
        choices.appendChild(choice);
    });
    const customLabel = createWorkspaceElement('label', 'workspace-panel-followup-custom');
    customLabel.appendChild(createWorkspaceElement('span', '', '自定义问题（可单独提交）'));
    const customQuestion = document.createElement('textarea');
    customQuestion.rows = 3;
    customQuestion.maxLength = 1200;
    customQuestion.placeholder = '例如：为什么作者在这个 Panel 选择这一统计方法？';
    customQuestion.value = draft.question;
    customQuestion.addEventListener('input', () => { draft.question = customQuestion.value; });
    customLabel.appendChild(customQuestion);
    const submit = createWorkspaceElement('button', 'btn btn-primary workspace-panel-followup-submit',
        loading ? '正在向 LLM 追问…' : '提交追问');
    submit.type = 'button';
    submit.disabled = loading;
    submit.addEventListener('click', () => {
        const topics = Array.from(chooser.querySelectorAll('input[type="checkbox"]:checked'))
            .map(input => input.value);
        const question = customQuestion.value.trim();
        if (!topics.length && !question) {
            showStatus('请选择追问方向或输入自定义问题', 'error');
            return;
        }
        submit.disabled = true;
        submit.textContent = '正在向 LLM 追问…';
        void runFigurePanelFollowup(figure.figureId, panelId, topics, question)
            .catch(error => showStatus('Panel 追问失败：' + error.message, 'error'));
    });
    chooser.append(choices, customLabel, submit);
    toggle.addEventListener('click', () => {
        chooser.hidden = !chooser.hidden;
        draft.open = !chooser.hidden;
        toggle.setAttribute('aria-expanded', String(!chooser.hidden));
    });
    root.append(toggle, chooser);
    const answer = followups[panelId];
    if (answer?.answer) {
        const result = createWorkspaceElement('section', 'workspace-panel-followup-answer');
        result.appendChild(createWorkspaceElement('strong', '', 'LLM 追问回答'));
        if (answer.customQuestion) {
            result.appendChild(createWorkspaceElement(
                'p', 'workspace-panel-followup-question', `你的问题：${answer.customQuestion}`
            ));
        }
        result.appendChild(createWorkspaceElement('p', '', answer.answer));
        if (answer.claimBoundary) {
            result.appendChild(createWorkspaceElement('p', 'workspace-panel-followup-boundary',
                `解读边界：${answer.claimBoundary}`));
        }
        const inputBasis = formatFigurePanelInputBasis(answer.inputBasis);
        if (inputBasis) result.appendChild(createWorkspaceElement(
            'p', 'workspace-panel-input-basis', `本次依据：${inputBasis}`
        ));
        root.appendChild(result);
    } else if (errors[panelId]) {
        root.appendChild(createWorkspaceElement('p', 'workspace-figure-error', errors[panelId]));
    }
    return root;
}

function figureCatalogPanelIds(figure, result) {
    const seen = new Set();
    return [
        ...(Array.isArray(figure?.panelHints) ? figure.panelHints : []),
        ...(Array.isArray(result?.panels) ? result.panels.map(panel => panel?.panel) : []),
        ...Object.keys(figure?.panelAnalyses || {})
    ].map(value => String(value || '').trim().toUpperCase())
        .filter(value => /^[A-Z0-9][A-Z0-9.+-]{0,7}$/.test(value) &&
            !seen.has(value) && Boolean(seen.add(value)));
}

function appendFigurePanelCatalog(parent, figure, result) {
    const panelIds = figureCatalogPanelIds(figure, result);
    parent.appendChild(createWorkspaceElement(
        'h4', 'workspace-figure-section-title', 'Panel 目录与按需解读'
    ));
    if (!panelIds.length) {
        parent.appendChild(createWorkspaceElement(
            'p', 'workspace-figure-panel-empty',
            '图注中没有稳定的 Panel 标签；仍可使用上方“单图精读”。'
        ));
        return;
    }
    const resultPanels = Array.isArray(result?.panels) ? result.panels : [];
    panelIds.forEach(panelId => {
        const panel = resultPanels.find(item =>
            String(item?.panel || '').toUpperCase() === panelId) ||
            figure?.panelAnalyses?.[panelId] || { panel: panelId };
        const analyzed = Boolean(panel?.purpose || panel?.directObservation || panel?.contribution);
        const loading = figure?.panelAnalysisLoading?.[panelId] === true;
        const panelDetails = createWorkspaceElement('details', 'workspace-figure-panel-card');
        const panelKey = panelWorkspaceKey(figure.figureId, panelId);
        panelDetails.id = `panel-anchor-${workspaceAnchorToken(figure.figureId)}-${workspaceAnchorToken(panelId)}`;
        panelDetails.dataset.figureId = figure.figureId;
        panelDetails.dataset.panelId = panelId;
        panelDetails.open = figurePanelExpansionState.get(panelKey) === true;
        panelDetails.addEventListener('toggle', () => {
            figurePanelExpansionState.set(panelKey, panelDetails.open);
        });
        panelDetails.appendChild(createWorkspaceElement(
            'summary', '', analyzed
                ? formatFigurePanelHeader(panel)
                : `Panel ${panelId} · ${loading ? '正在解读' : '待解读'}`
        ));
        const actions = createWorkspaceElement('div', 'workspace-panel-actions');
        const analyze = createWorkspaceElement(
            'button', 'btn btn-figure workspace-panel-analyze',
            loading ? '正在解读此 Panel…' : (analyzed ? '重新解读此 Panel' : '解读此 Panel')
        );
        analyze.type = 'button';
        analyze.disabled = loading || llmSettingsState?.effectiveMode !== 'llm';
        analyze.addEventListener('click', () => {
            figureExpansionState.set(figure.figureId, true);
            figurePanelExpansionState.set(panelKey, true);
            void runSingleFigurePanelAnalysis(figure.figureId, panelId);
        });
        const ask = createWorkspaceElement(
            'button', 'btn btn-secondary workspace-panel-ask', '提问此 Panel'
        );
        ask.type = 'button';
        ask.disabled = llmSettingsState?.effectiveMode !== 'llm';
        actions.append(analyze, ask);
        panelDetails.appendChild(actions);
        if (analyzed) {
            [
                ['表型', panel.phenotypeName],
                ['方法类别', METHOD_CATEGORY_LABELS[panel.methodCategory]],
                ['方法', (panel.methods || []).join('、')],
                ['方法来源', panel.methodSource],
                ['目的', panel.purpose], ['设计', panel.design],
                ['比较', panel.comparison], ['直接观察', panel.directObservation],
                ['观察来源', panel.observationSource], ['局部推论', panel.localInference],
                ['对论证链的贡献', panel.contribution]
            ].forEach(([label, value]) => appendFigureWorkspaceField(panelDetails, label, value));
            appendFigureWorkspaceField(
                panelDetails,
                '本次解读依据',
                formatFigurePanelInputBasis(panel.inputBasis)
            );
        } else {
            panelDetails.appendChild(createWorkspaceElement(
                'p', 'workspace-figure-caption',
                '目录识别不消耗 Token。点击“解读此 Panel”后才会调用所配置的 Figure 模型。'
            ));
        }
        const error = figure?.panelAnalysisErrors?.[panelId];
        if (error) panelDetails.appendChild(createWorkspaceElement(
            'p', 'workspace-figure-error', error
        ));
        const followup = createPanelFollowupControl(figure, panel);
        const followupDraft = getPanelFollowupDraft(figure.figureId, panelId);
        const followupToggle = followup.querySelector('.workspace-panel-followup-toggle');
        const followupChooser = followup.querySelector('.workspace-panel-followup-chooser');
        if (followupToggle) followupToggle.hidden = true;
        if (followupChooser) followupChooser.hidden = false;
        followup.hidden = followupDraft.open !== true;
        ask.textContent = followup.hidden ? '提问此 Panel' : '收起提问';
        ask.addEventListener('click', () => {
            followup.hidden = !followup.hidden;
            followupDraft.open = !followup.hidden;
            ask.textContent = followup.hidden ? '提问此 Panel' : '收起提问';
            if (!followup.hidden) {
                panelDetails.open = true;
                figurePanelExpansionState.set(panelKey, true);
                followup.querySelector('textarea')?.focus();
            }
        });
        panelDetails.appendChild(followup);
        parent.appendChild(panelDetails);
    });
}

function createCollapsibleFigureResultSection(figureId, sectionId, title, count = 0) {
    const stateKey = `${figureId}::section::${sectionId}`;
    const details = createWorkspaceElement('details', 'workspace-figure-result-section');
    details.dataset.figureSection = sectionId;
    details.open = figureSectionExpansionState.get(stateKey) === true;
    details.addEventListener('toggle', () => {
        figureSectionExpansionState.set(stateKey, details.open);
    });
    const label = count > 0 ? `${title} · ${count}` : title;
    details.appendChild(createWorkspaceElement(
        'summary', 'workspace-figure-result-summary', label
    ));
    return details;
}

function renderCrossFigureLogicSnapshot(container, crossFigureLogic) {
    if (!crossFigureLogic) return;
    const logic = crossFigureLogic.result;
    if (!logic && !crossFigureLogic.loading && !crossFigureLogic.error) return;
    const details = createWorkspaceElement('details', 'workspace-cross-figure-card');
    details.open = Boolean(logic) || crossFigureLogic.loading === true;
    details.appendChild(createWorkspaceElement(
        'summary', 'workspace-cross-figure-summary',
        crossFigureLogic.loading
            ? '正在梳理主图之间的多米诺逻辑…'
            : '主图多米诺总链（跨图梳理）'
    ));
    if (crossFigureLogic.loading) {
        details.appendChild(createWorkspaceElement(
            'p', 'workspace-cross-figure-subtitle',
            '正在把每张主图的已建立证据、下一步必要性与补图支撑串成全文论证链。'
        ));
    }
    if (crossFigureLogic.error) {
        details.appendChild(createWorkspaceElement(
            'p', 'workspace-figure-error',
            `跨图总链生成失败：${crossFigureLogic.error}`
        ));
    }
    if (logic) {
        details.appendChild(createWorkspaceElement(
            'p', 'workspace-cross-figure-subtitle', logic.overallThesis
        ));
        const analyzedCount = Array.isArray(logic.analyzedMainFigureIds)
            ? logic.analyzedMainFigureIds.length : 0;
        const mainCount = Array.isArray(logic.mainFigureIds) ? logic.mainFigureIds.length : 0;
        details.appendChild(createWorkspaceElement(
            'p', 'workspace-figure-coverage',
            `主图证据输入：${analyzedCount}/${mainCount} 张已有逐图解读；其余按图注谨慎串联。`
        ));
        (Array.isArray(logic.nodes) ? logic.nodes : []).forEach((node, index) => {
            const block = createWorkspaceElement('section', 'workspace-cross-figure-node');
            const jump = createWorkspaceElement(
                'button', '', `${index + 1}. ${node.figureLabel || node.figureId}`
            );
            jump.type = 'button';
            jump.addEventListener('click', () => void focusWorkspaceSource({
                kind: 'figure', figureId: node.figureId
            }));
            block.appendChild(jump);
            appendFigureWorkspaceField(block, '本图任务', node.role);
            appendFigureWorkspaceField(block, '本图确立', node.established);
            appendFigureWorkspaceField(block, '为何进入下一图', node.transition);
            appendFigureWorkspaceField(block, '证据等级', node.evidenceLevel);
            details.appendChild(block);
        });
        const dominoChain = Array.isArray(logic.dominoChain) ? logic.dominoChain : [];
        if (dominoChain.length) {
            details.appendChild(createWorkspaceElement(
                'h4', 'workspace-figure-section-title', '跨图多米诺连接'
            ));
            dominoChain.forEach((link, index) => {
                const block = createWorkspaceElement('section', 'workspace-cross-figure-transition');
                appendFigureWorkspaceField(
                    block, `连接 ${index + 1}`,
                    `${link.fromFigureLabel || link.fromFigureId} → ${link.toFigureLabel || link.toFigureId}`
                );
                appendFigureWorkspaceField(block, '前图已确立', link.established);
                appendFigureWorkspaceField(block, '下一图的必要性', link.transition);
                appendFigureWorkspaceField(block, '证据边界', link.evidenceBoundary);
                details.appendChild(block);
            });
        }
        const support = Array.isArray(logic.supplementalSupport) ? logic.supplementalSupport : [];
        if (support.length) {
            details.appendChild(createWorkspaceElement(
                'h4', 'workspace-figure-section-title', '补图如何支撑主图'
            ));
            support.forEach(item => {
                const block = createWorkspaceElement('section', 'workspace-cross-figure-support');
                const jump = createWorkspaceElement(
                    'button', '', `${item.figureLabel || item.figureId} → ${item.supportsFigureLabel || item.supportsFigureId}`
                );
                jump.type = 'button';
                jump.addEventListener('click', () => void focusWorkspaceSource({
                    kind: 'figure', figureId: item.figureId
                }));
                block.appendChild(jump);
                appendFigureWorkspaceField(block, '支撑作用', item.contribution);
                details.appendChild(block);
            });
        }
        appendFigureWorkspaceField(details, '全链边界', logic.claimBoundary);
        if (Array.isArray(logic.missingFigureIds) && logic.missingFigureIds.length) {
            details.appendChild(createWorkspaceElement(
                'p', 'workspace-figure-coverage is-incomplete',
                `待补主图节点：${logic.missingFigureIds.join('、')}`
            ));
        }
    }
    container.appendChild(details);
}

function getFigureProgressEntries(status) {
    if (Array.isArray(status?.figureProgress)) return status.figureProgress;
    if (status?.figureProgressById && typeof status.figureProgressById === 'object') {
        return Object.values(status.figureProgressById);
    }
    return [];
}

function hasRunningFigureProgress(status = figureAnalysisState) {
    return status?.running === true || getFigureProgressEntries(status)
        .some(progress => progress?.running === true);
}

function resumeFigureProgressFromWorkspaceSnapshot(snapshot, {
    announce = false,
    tabId = activePanelTabContext.tabId
} = {}) {
    const status = snapshot?.figures?.status;
    if (!status || typeof status !== 'object') return null;
    const applied = applyFigureAnalysisProgress(status, announce);
    if (hasRunningFigureProgress(status) && tabId) {
        startFigureProgressPolling(tabId);
    }
    return applied;
}

function formatFigureElapsed(progress = {}, now = Date.now()) {
    const snapshotElapsed = Number(progress.elapsedSeconds);
    const started = Number(progress.startedAt) || 0;
    const elapsedSeconds = Number.isFinite(snapshotElapsed) && snapshotElapsed >= 0
        ? Math.floor(snapshotElapsed)
        : (!started || now < started ? 0 : Math.floor((now - started) / 1000));
    if (!started && !Number.isFinite(snapshotElapsed)) return '';
    if (elapsedSeconds < 60) return `已用时 ${elapsedSeconds} 秒`;
    return `已用时 ${Math.floor(elapsedSeconds / 60)} 分 ${elapsedSeconds % 60} 秒`;
}

function formatFigureProgress(progress = {}, now = Date.now()) {
    const phase = String(progress.phase || 'preparing');
    const expectedPanels = Array.isArray(progress.expectedPanels) ? progress.expectedPanels : [];
    const expectedPanelCount = Math.max(0, Number(progress.expectedPanelCount) || expectedPanels.length);
    const recognizedPanelCount = Number.isFinite(Number(progress.recognizedPanelCount))
        ? Math.max(0, Number(progress.recognizedPanelCount)) : null;
    const cancelledPhaseText = phase === 'cancelled'
        ? '本批 Figure 解读已取消' : '';
    const phaseText = cancelledPhaseText || {
        queued: '等待前面的 Figure 完成',
        paused: '已暂停，当前请求结束后不再发送新请求',
        preparing: '正在准备图片与正文上下文',
        caption_text_only: '仅使用图注与正文证据',
        figure_requesting: '正在发送 Figure 请求',
        figure_model_processing: '模型正在处理这张 Figure',
        figure_response_received: '已收到模型响应，正在检查返回内容',
        figure_validating: '正在校验返回结构',
        figure_assembling: '正在整理 Figure 解读',
        figure_panel_batch_complete: '当前 Panel 分批已保存，继续下一批',
        figure_synthesizing: 'Panel 已提取，正在综合整图证据链',
        figure_synthesis_complete: '整图证据链综合完成',
        figure_schema_retry: '返回结构不完整，正在自动修正',
        provider_telemetry: '模型已返回，正在读取用量与完成状态',
        figure: progress.cacheHit ? '已从本地缓存恢复解读' : 'Figure 解读已完成',
        failed: 'Figure 解读失败',
        figure_fallback: '视觉输入被拒绝，正在改用图注与正文',
        figure_retry: '请求暂时失败，正在等待自动重试',
        token_limit_retry: '正在调整输出令牌上限后重试',
        output_token_retry: '正在增加输出令牌后重试',
        output_compact_retry: '输出过长，正改用紧凑 JSON 重试'
    }[phase] || '正在处理 Figure';
    const details = [];
    const totalFigures = Math.max(0, Number(progress.totalFigures) || 0);
    if (totalFigures) {
        details.push(`批次进度：${Math.min(totalFigures, Math.max(0, Number(progress.completedFigures) || 0))}/${totalFigures} 张`);
    }
    if (expectedPanelCount) {
        details.push(`预期 Panel：${expectedPanels.length ? expectedPanels.join('、') : expectedPanelCount + ' 个'}`);
    } else {
        details.push('图注中未识别到可核验的 Panel 标签');
    }
    const totalPanelBatches = Math.max(0, Number(progress.totalPanelBatches) || 0);
    if (totalPanelBatches) {
        details.push(`Panel 分批：${Math.min(totalPanelBatches,
            Math.max(0, Number(progress.completedPanelBatches) || 0))}/${totalPanelBatches}`);
    }
    if (recognizedPanelCount !== null) details.push(`已识别 ${recognizedPanelCount} 个 Panel`);
    if (progress.capabilityMode === 'caption_text_only' || phase === 'caption_text_only') {
        details.push('当前有效模型不接收图片；本次仅发送图注与正文证据');
    }
    if (progress.visionFallback || phase === 'figure_fallback') {
        details.push('视觉请求未被接受，已回退到图注与正文证据');
    }
    if (phase === 'figure_retry') {
        const seconds = Math.max(1, Math.ceil((Number(progress.waitMs) || 0) / 1000));
        details.push(`${seconds} 秒后自动重试${progress.attempt ? `（第 ${progress.attempt} 次）` : ''}`);
    }
    const route = progress.route && typeof progress.route === 'object' ? progress.route : {};
    const effectiveProfileName = String(route.effectiveProfileName || route.name || '').trim();
    const routeModel = String(route.model || progress.model || '').trim();
    const capabilityMode = String(route.capabilityMode || progress.capabilityMode || '').trim();
    const fallbackReason = String(route.fallbackReason || '').trim();
    if (effectiveProfileName || routeModel || capabilityMode) {
        const target = [effectiveProfileName || progress.providerId || 'provider', routeModel]
            .filter(Boolean).join(' / ');
        details.push(`有效路由：${target}${capabilityMode ? `；能力：${capabilityMode}` : ''}`);
    }
    if (fallbackReason) {
        details.push(`路由回退：${fallbackReason}`);
    }
    const elapsed = formatFigureElapsed(progress, now);
    if (elapsed) details.push(elapsed);
    return { phaseText, details };
}

function renderFigureProgress(details, progress) {
    if (!progress) return;
    const display = formatFigureProgress(progress);
    const block = createWorkspaceElement(
        'section',
        `workspace-figure-progress${progress.failed ? ' is-error' : ''}${progress.running ? ' is-running' : ''}`
    );
    block.appendChild(createWorkspaceElement('p', 'workspace-figure-progress-phase', display.phaseText));
    display.details.forEach(detail => {
        block.appendChild(createWorkspaceElement('p', 'workspace-figure-progress-detail', detail));
    });
    details.appendChild(block);
}

function workspaceAnchorToken(value) {
    return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80) || 'item';
}

function navigateFigureQuickAnchor(figureId, panelId = '') {
    figureQuickNavActiveId = figureId;
    const figures = currentWorkspaceSnapshot?.figures?.figures || [];
    figures.forEach(figure => {
        figureExpansionState.set(figure.figureId, figure.figureId === figureId);
    });
    for (const key of figurePanelExpansionState.keys()) {
        if (!key.startsWith(`${figureId}::`)) figurePanelExpansionState.set(key, false);
    }
    figureExpansionState.set(figureId, true);
    if (panelId) figurePanelExpansionState.set(panelWorkspaceKey(figureId, panelId), true);
    renderFigureWorkspaceSnapshot(currentWorkspaceSnapshot);
    requestAnimationFrame(() => {
        const selector = panelId
            ? `.workspace-figure-panel-card[data-figure-id="${figureId}"][data-panel-id="${panelId}"]`
            : `.workspace-figure-card[data-figure-id="${figureId}"]`;
        const target = document.querySelector(selector);
        target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        target?.querySelector('summary')?.focus({ preventScroll: true });
    });
}

function renderFigureQuickNav(figures) {
    const nav = document.getElementById('figureQuickNav');
    if (!nav) return;
    clearTimeout(figureQuickNavHoverTimer);
    figureQuickNavHoverTimer = null;
    nav.replaceChildren();
    const items = Array.isArray(figures) ? figures : [];
    if (!items.length) {
        nav.hidden = true;
        return;
    }
    if (!items.some(figure => figure.figureId === figureQuickNavActiveId)) {
        figureQuickNavActiveId = items.find(figure => figure.standard || figure.deep)?.figureId ||
            items[0].figureId;
    }
    const figureMarkers = createWorkspaceElement('div', 'figure-quick-nav-figures');
    items.forEach(figure => {
        const item = createWorkspaceElement('div', 'figure-quick-nav-item');
        item.dataset.figureId = figure.figureId;
        const marker = createWorkspaceElement('button', 'figure-quick-nav-marker');
        marker.type = 'button';
        marker.setAttribute('aria-label', `跳转到 ${figure.figureLabel || figure.figureId}`);
        marker.setAttribute('aria-current', String(figure.figureId === figureQuickNavActiveId));
        marker.appendChild(createWorkspaceElement('span', 'figure-quick-nav-tick'));
        marker.addEventListener('click', () => navigateFigureQuickAnchor(figure.figureId));

        const flyout = createWorkspaceElement('div', 'figure-quick-nav-flyout');
        const panelIds = figureCatalogPanelIds(
            figure,
            figure.activeDepth === 'standard' ? figure.standard : (figure.deep || figure.standard)
        ).slice().sort((left, right) => String(left).localeCompare(String(right), undefined, {
            numeric: true,
            sensitivity: 'base'
        }));
        const panelPopover = createWorkspaceElement('div', 'figure-quick-nav-panel-popover');
        panelPopover.setAttribute('aria-label', `${figure.figureLabel || figure.figureId} 的 Panel`);
        panelIds.forEach(panelId => {
            const panelButton = createWorkspaceElement(
                'button', 'figure-quick-nav-panel-button', `Panel ${panelId}`
            );
            panelButton.type = 'button';
            panelButton.addEventListener('click', event => {
                event.stopPropagation();
                navigateFigureQuickAnchor(figure.figureId, panelId);
            });
            panelPopover.appendChild(panelButton);
        });
        const label = createWorkspaceElement(
            'button', 'figure-quick-nav-label', figure.figureLabel || figure.figureId
        );
        label.type = 'button';
        label.addEventListener('click', () => navigateFigureQuickAnchor(figure.figureId));
        flyout.append(panelPopover, label);

        const closePanels = () => {
            item.classList.remove('show-panels');
            if (figureQuickNavExpandedFigureId === figure.figureId) {
                figureQuickNavExpandedFigureId = '';
            }
        };
        const activateItem = () => {
            clearTimeout(figureQuickNavHoverTimer);
            figureQuickNavHoverTimer = null;
            nav.querySelectorAll('.figure-quick-nav-item.show-panels').forEach(other => {
                if (other !== item) other.classList.remove('show-panels');
            });
            if (figureQuickNavExpandedFigureId !== figure.figureId) {
                figureQuickNavExpandedFigureId = '';
            }
            figureQuickNavActiveId = figure.figureId;
            nav.querySelectorAll('.figure-quick-nav-marker').forEach(button => {
                const owner = button.closest('.figure-quick-nav-item');
                button.setAttribute('aria-current', String(owner?.dataset.figureId === figure.figureId));
            });
        };
        item.addEventListener('mouseenter', activateItem);
        label.addEventListener('mouseenter', () => {
            if (!panelIds.length) return;
            clearTimeout(figureQuickNavHoverTimer);
            figureQuickNavHoverTimer = setTimeout(() => {
                nav.querySelectorAll('.figure-quick-nav-item.show-panels')
                    .forEach(other => other.classList.remove('show-panels'));
                figureQuickNavExpandedFigureId = figure.figureId;
                item.classList.add('show-panels');
            }, 60);
        });
        item.addEventListener('mouseleave', () => {
            clearTimeout(figureQuickNavHoverTimer);
            figureQuickNavHoverTimer = setTimeout(closePanels, 70);
        });
        item.append(marker, flyout);
        figureMarkers.appendChild(item);
    });
    nav.appendChild(figureMarkers);
    nav.hidden = false;
}

function syncFigureQuickNavFromScroll() {
    const view = document.querySelector('.workspace-view[data-workspace-view="figures"]');
    if (!view || view.hidden) return;
    const cards = Array.from(view.querySelectorAll('.workspace-figure-card[data-figure-id]'));
    if (!cards.length) return;
    const viewTop = view.getBoundingClientRect().top + 24;
    const closest = cards.reduce((best, card) => {
        const distance = Math.abs(card.getBoundingClientRect().top - viewTop);
        return !best || distance < best.distance ? { card, distance } : best;
    }, null)?.card;
    const figureId = closest?.dataset.figureId || '';
    if (!figureId || figureId === figureQuickNavActiveId) return;
    figureQuickNavActiveId = figureId;
    renderFigureQuickNav(currentWorkspaceSnapshot?.figures?.figures || []);
}

function renderFigureWorkspaceSnapshot(snapshot = currentWorkspaceSnapshot) {
    const container = document.getElementById('figureWorkspace');
    if (!container) return;
    container.replaceChildren();
    const figures = Array.isArray(snapshot?.figures?.figures) ? snapshot.figures.figures : [];
    const snapshotStatus = snapshot?.figures?.status || null;
    const liveStatus = getFigureProgressEntries(figureAnalysisState).length
        ? figureAnalysisState : snapshotStatus;
    const figureProgress = new Map(getFigureProgressEntries(liveStatus)
        .map(progress => [String(progress?.figureId || ''), progress])
        .filter(([figureId]) => Boolean(figureId)));
    const summary = document.getElementById('figureWorkspaceSummary');
    if (summary) {
        const supplemental = figures.filter(figure => figure.isSupplemental).length;
        summary.textContent = figures.length
            ? `\u5df2\u53d1\u73b0 ${figures.length} \u5f20\u56fe\uff08${supplemental} \u5f20\u8865\u5145\u56fe\uff09`
            : '\u6b63\u5728\u8bfb\u53d6\u8bba\u6587\u56fe\u7247\u76ee\u5f55\u2026';
    }
    if (!figures.length) {
        container.appendChild(createWorkspaceElement(
            'div', 'workspace-empty', '\u6682\u672a\u8bc6\u522b\u5230\u56fe\uff1b\u8bf7\u5237\u65b0\u8bba\u6587\u5de5\u4f5c\u533a\u540e\u91cd\u8bd5\u3002'
        ));
        renderFigureQuickNav([]);
        return;
    }
    renderCrossFigureLogicSnapshot(container, snapshot?.figures?.crossFigureLogic || null);
    figures.forEach(figure => {
        const result = figure.activeDepth === 'standard' ? figure.standard : (figure.deep || figure.standard);
        const progress = figureProgress.get(figure.figureId) || null;
        const progressDisplay = progress ? formatFigureProgress(progress) : null;
        const loading = figure.deepLoading === true || progress?.running === true;
        const details = createWorkspaceElement('details', 'workspace-figure-card');
        details.id = `figure-anchor-${workspaceAnchorToken(figure.figureId)}`;
        details.dataset.figureId = figure.figureId;
        details.open = figureExpansionState.has(figure.figureId)
            ? figureExpansionState.get(figure.figureId) : figure.expanded === true;
        details.addEventListener('toggle', () => {
            figureExpansionState.set(figure.figureId, details.open);
            if (details.open) {
                figureQuickNavActiveId = figure.figureId;
                renderFigureQuickNav(figures);
            }
        });
        const status = progressDisplay?.phaseText || (loading ? '\u6b63\u5728\u7cbe\u8bfb' : result
            ? (result.analysisDepth === 'deep' ? '\u6df1\u5ea6\u5df2\u5b8c\u6210' : '\u6807\u51c6\u5df2\u5b8c\u6210')
            : '\u5f85\u89e3\u8bfb');
        const summary = createWorkspaceElement(
            'summary', 'workspace-figure-summary', `${figure.figureLabel || figure.figureId || 'Figure'} \u00b7 ${status}`
        );
        details.appendChild(summary);
        const actions = createWorkspaceElement('div', 'workspace-figure-actions');
        const jump = createWorkspaceElement('button', 'btn btn-secondary workspace-figure-action', '\u5b9a\u4f4d\u7f51\u9875\u56fe\u6ce8');
        jump.type = 'button';
        jump.addEventListener('click', () => void focusWorkspaceSource({
            kind: 'figure', figureId: figure.figureId
        }));
        const original = createWorkspaceElement(
            'button', 'btn btn-secondary workspace-figure-action', '查看高清原图'
        );
        original.type = 'button';
        original.disabled = !figure.hasImage;
        original.addEventListener('click', () => {
            void showFigureOriginalImage(figure.figureId).catch(error =>
                showStatus(error.message, 'error'));
        });
        const analyze = createWorkspaceElement(
            'button', 'btn btn-figure workspace-figure-action',
            loading ? '正在精读此图…' : (result ? '\u91cd\u65b0\u7cbe\u8bfb\u6b64\u56fe' : '\u5355\u56fe\u7cbe\u8bfb')
        );
        analyze.type = 'button';
        analyze.classList.add('workspace-figure-analyze-action');
        analyze.disabled = loading || llmSettingsState?.effectiveMode !== 'llm';
        analyze.addEventListener('click', () => void runSingleFigureAnalysis(figure.figureId));
        actions.append(jump, original, analyze);
        details.appendChild(actions);
        renderFigureProgress(details, progress);
        if (result) {
            [
                ['\u672c\u56fe\u95ee\u9898', result.figureQuestion],
                ['\u6838\u5fc3\u7ed3\u8bba', result.coreConclusion],
                ['\u8bc1\u636e\u8fb9\u754c', result.claimBoundary],
                ['\u7ec4\u56fe\u601d\u60f3', result.authorAssembly]
            ].forEach(([label, value]) => appendFigureWorkspaceField(details, label, value));
            const coverage = result.panelCoverage;
            if (coverage?.expectedPanels?.length) {
                const coverageText = coverage.missingPanels?.length
                    ? `Panel \u8986\u76d6\u5f85\u8865\uff1a${coverage.missingPanels.join('\u3001')}`
                    : `Panel \u8986\u76d6\u5b8c\u6574\uff1a${coverage.expectedPanels.join('\u3001')}`;
                details.appendChild(createWorkspaceElement(
                    'p', coverage.missingPanels?.length ? 'workspace-figure-coverage is-incomplete' : 'workspace-figure-coverage', coverageText
                ));
            }
            appendFigurePanelCatalog(details, figure, result);
            const argumentChain = Array.isArray(result.argumentChain) ? result.argumentChain : [];
            if (argumentChain.length) {
                const section = createCollapsibleFigureResultSection(
                    figure.figureId, 'argument-chain', '\u591a\u7c73\u8bfa\u8bba\u8bc1\u94fe', argumentChain.length
                );
                argumentChain.forEach((step, index) => {
                    const block = createWorkspaceElement('section', 'workspace-figure-chain-step');
                    appendFigureWorkspaceField(block, `\u6b65\u9aa4 ${index + 1} Panel`, (step.panels || []).join('\u3001'));
                    appendFigureWorkspaceField(block, '\u786e\u7acb\u4e86\u4ec0\u4e48', step.established);
                    appendFigureWorkspaceField(block, '\u4e3a\u4f55\u8fdb\u5165\u4e0b\u4e00\u6b65', step.handoff);
                    appendFigureWorkspaceField(block, '\u8bc1\u636e\u7b49\u7ea7', step.evidenceLevel);
                    section.appendChild(block);
                });
                details.appendChild(section);
            }
            const groups = Array.isArray(result.panelGroups) ? result.panelGroups : [];
            if (groups.length) {
                const section = createCollapsibleFigureResultSection(
                    figure.figureId, 'panel-groups', '\u8bc1\u636e\u7ec4\u7ec7', groups.length
                );
                groups.forEach(group => {
                    const block = createWorkspaceElement('section', 'workspace-figure-chain-step');
                    appendFigureWorkspaceField(block, 'Panel', (group.panels || []).join('\u3001'));
                    appendFigureWorkspaceField(block, '\u5171\u540c\u76ee\u6807', group.groupGoal);
                    appendFigureWorkspaceField(block, '\u7ec4\u5c0f\u7ed3', group.groupConclusion);
                    section.appendChild(block);
                });
                details.appendChild(section);
            }
            const bridges = Array.isArray(result.logicBridges) ? result.logicBridges : [];
            if (bridges.length) {
                const section = createCollapsibleFigureResultSection(
                    figure.figureId, 'logic-bridges', '\u7ec4\u95f4\u903b\u8f91\u8fde\u63a5', bridges.length
                );
                bridges.forEach(bridge => {
                    const block = createWorkspaceElement('section', 'workspace-figure-chain-step');
                    appendFigureWorkspaceField(block, '\u8fde\u63a5', [bridge.fromGroup, bridge.toGroup].filter(Boolean).join(' \u21d2 '));
                    appendFigureWorkspaceField(block, '\u5173\u7cfb', bridge.relationType);
                    appendFigureWorkspaceField(block, '\u4e0b\u4e00\u6b65\u5fc5\u8981\u6027', bridge.bridge);
                    section.appendChild(block);
                });
                details.appendChild(section);
            }
            if (result.analysisDepth === 'deep') {
                details.appendChild(createWorkspaceElement('h4', 'workspace-figure-section-title', '\u6df1\u5ea6\u8bc1\u636e\u5ba1\u67e5'));
                [
                    ['\u5b9a\u6027\u4e0e\u5b9a\u91cf\u4e92\u8bc1', result.qualitativeQuantitativeLink],
                    ['\u9634\u6027\u7ed3\u679c\u7684\u4ef7\u503c', result.negativeResultValue],
                    ['\u5168\u6587\u8bba\u8bc1\u89d2\u8272', result.paperArgumentRole],
                    ['\u6df1\u5c42\u7ec4\u56fe\u7b56\u7565', result.deepAuthorStrategy]
                ].forEach(([label, value]) => appendFigureWorkspaceField(details, label, value));
                (Array.isArray(result.controlAnalysis) ? result.controlAnalysis : []).forEach(control => {
                    const block = createWorkspaceElement('section', 'workspace-figure-chain-step');
                    appendFigureWorkspaceField(block, '\u5bf9\u7167 Panel', (control.panels || []).join('\u3001'));
                    appendFigureWorkspaceField(block, '\u5bf9\u7167\u7c7b\u578b', control.controlType);
                    appendFigureWorkspaceField(block, '\u6392\u9664\u7684\u66ff\u4ee3\u89e3\u91ca', control.excludedExplanation);
                    appendFigureWorkspaceField(block, '\u5bf9\u7167\u5145\u5206\u6027', control.adequacy);
                    details.appendChild(block);
                });
                (Array.isArray(result.evidenceRelations) ? result.evidenceRelations : []).forEach(relation => {
                    const block = createWorkspaceElement('section', 'workspace-figure-chain-step');
                    appendFigureWorkspaceField(block, 'Panel', (relation.panels || []).join('\u3001'));
                    appendFigureWorkspaceField(block, '\u8bc1\u636e\u5173\u7cfb', relation.relationLevel);
                    appendFigureWorkspaceField(block, '\u5224\u65ad\u4f9d\u636e', relation.rationale);
                    details.appendChild(block);
                });
                appendFigureWorkspaceField(
                    details,
                    '\u66ff\u4ee3\u89e3\u91ca',
                    (result.alternativeExplanations || []).join('\uff1b')
                );
                appendFigureWorkspaceField(
                    details,
                    '\u5220\u9664 Panel \u540e\u7f3a\u5931\u7684\u8bba\u8bc1',
                    (result.missingLinksIfPanelRemoved || []).join('\uff1b')
                );
            }
        } else if (figure.standardError || figure.deepError) {
            appendFigurePanelCatalog(details, figure, null);
            details.appendChild(createWorkspaceElement(
                'p', 'workspace-figure-error', figure.standardError || figure.deepError
            ));
        } else {
            appendFigurePanelCatalog(details, figure, null);
            details.appendChild(createWorkspaceElement(
                'p', 'workspace-figure-caption', '\u5df2\u5728\u76ee\u5f55\u4e2d\uff0c\u53ef\u76f4\u63a5\u5355\u56fe\u7cbe\u8bfb\u3002'
            ));
        }
        container.appendChild(details);
    });
    renderFigureQuickNav(figures);
}

function renderArticleWorkspaceSnapshot(snapshot) {
    currentWorkspaceSnapshot = snapshot || null;
    const status = document.getElementById('articleNavigationStatus');
    const title = document.getElementById('sidePanelPaperTitle');
    const statusText = document.getElementById('sidePanelDocumentStatusText');
    if (title) title.textContent = snapshot?.title || '当前页面';
    const diagnostics = snapshot?.diagnostics || {};
    const publisher = snapshot?.publisherFamily || 'generic';
    const summary = `${publisher} · ` +
        `${diagnostics.headingCount || 0} 个标题 · ${diagnostics.paragraphCount || 0} 段正文`;
    if (status) status.textContent = summary;
    if (statusText) statusText.textContent = `已激活 · ${publisher}`;
    const connectionStatus = document.getElementById('sidePanelDocumentStatus');
    connectionStatus?.classList.remove('is-error');
    connectionStatus?.classList.add('is-ready');
    const retry = document.getElementById('retryArticlePreparation');
    if (retry) retry.hidden = true;
    renderArticleNavigationTree(snapshot);
    renderEvidenceLedger(snapshot);
    renderHighlightDistributionSnapshot(snapshot);
    renderFigureWorkspaceSnapshot(snapshot);
    renderArticleChatSnapshot(snapshot);
}

function getArticleChatProfiles() {
    const profiles = llmSettingsState?.settings?.profiles || {};
    const order = Array.isArray(llmSettingsState?.settings?.profileOrder)
        ? llmSettingsState.settings.profileOrder : Object.keys(profiles);
    return order.map(profileId => [profileId, profiles[profileId]])
        .filter(([, profile]) => {
            const config = profile?.config || {};
            return config.hasApiKey === true && Boolean(String(config.model || '').trim()) &&
                (profile.providerId !== 'openai-compatible' || Boolean(String(config.baseUrl || '').trim()));
        });
}

function renderArticleChatProfileOptions() {
    const select = document.getElementById('articleChatProfile');
    if (!select) return;
    const profiles = getArticleChatProfiles();
    const preferred = articleChatSelectedProfileId ||
        llmSettingsState?.settings?.globalProfileId || profiles[0]?.[0] || '';
    select.replaceChildren();
    profiles.forEach(([profileId, profile]) => {
        const option = document.createElement('option');
        option.value = profileId;
        option.textContent = `${profile?.name || '未命名模型'} · ${profile?.config?.model || ''}`;
        select.appendChild(option);
    });
    if (!profiles.length) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = '尚未配置可用模型';
        select.appendChild(option);
    }
    articleChatSelectedProfileId = profiles.some(([profileId]) => profileId === preferred)
        ? preferred : (profiles[0]?.[0] || '');
    select.value = articleChatSelectedProfileId;
    select.disabled = profiles.length === 0;
}

function normalizeArticleChatCitationText(value) {
    return String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
}

function resolveArticleChatEvidenceTarget(item, snapshot) {
    return SciLLM.verifyArticleChatEvidence({
        ...item,
        documentRevision: Number(item?.documentRevision || snapshot?.revision) || 0
    }, snapshot);
}

function articleChatCitationStatusText(status, reason = '') {
    if (status === 'ambiguous') return '待核验：原文中存在多个相同或近似位置';
    if (status === 'stale') return '待核验：正文版本已经变化';
    if (reason === 'SOURCE_ANCHOR_MISSING') return '跳转失败：原文位置当前不可见';
    return '待核验：没有找到唯一对应的原文段落';
}

function applyArticleChatCitationState(button, verification, evidenceIndex = 0, label = '') {
    const status = verification?.status || 'missing';
    button.classList.remove('is-verified', 'is-ambiguous', 'is-missing', 'is-stale');
    button.classList.add(`is-${status}`);
    button.dataset.verificationStatus = status;
    button.dataset.candidateCount = String(verification?.candidateCount || 0);
    button.disabled = status !== 'verified';
    button.textContent = status === 'verified' ? String(evidenceIndex + 1) : '待核验';
    const statusText = status === 'verified'
        ? `参考原文 ${evidenceIndex + 1} · ${label || '正文段落'}`
        : articleChatCitationStatusText(status, verification?.reason);
    button.title = statusText;
    button.setAttribute('aria-label', statusText);
}

async function focusArticleChatCitation(item, snapshot, button = null) {
    const verification = resolveArticleChatEvidenceTarget(item, snapshot);
    if (verification.status !== 'verified' || !verification.target) return false;
    const target = {
        kind: 'article-chat-citation',
        evidence: {
            paragraphId: item?.paragraphId || verification.target.paragraphId,
            sourceKey: item?.sourceKey || verification.target.sourceKey,
            textHash: item?.textHash || verification.target.textHash,
            sectionTitle: item?.sectionTitle || verification.target.sectionTitle,
            sectionPath: item?.sectionPath || verification.target.sectionPath,
            quote: item?.quote || '',
            support: item?.support || ''
        },
        documentRevision: Number(snapshot?.revision) || 0
    };
    const panelContext = capturePanelContext();
    if (button) button.disabled = true;
    try {
        const response = await sendTabMessage(panelContext.tabId, {
            action: 'focusArticleWorkspaceSource',
            target
        });
        if (!isCurrentPanelContext(panelContext)) return false;
        const citationResult = response?.citationResult || {
            status: response?.focused ? 'verified' : 'missing',
            reason: response?.focused ? '' : 'SOURCE_ANCHOR_MISSING',
            candidateCount: 0
        };
        const focused = Boolean(response?.success && response?.focused);
        if (!focused && isCurrentPanelContext(panelContext)) {
            if (button?.isConnected) applyArticleChatCitationState(
                button, citationResult, Number(button.dataset.evidenceIndex) || 0,
                item?.sectionTitle || '正文段落'
            );
            showStatus(articleChatCitationStatusText(
                citationResult.status, citationResult.reason
            ), 'error');
        }
        return focused;
    } finally {
        if (button?.isConnected && button.dataset.verificationStatus === 'verified') {
            button.disabled = false;
        }
    }
}

function createArticleChatInlineCitation(item, evidenceIndex, snapshot) {
    const verification = resolveArticleChatEvidenceTarget(item, snapshot);
    const button = createWorkspaceElement(
        'button', 'article-chat-inline-citation', String(evidenceIndex + 1)
    );
    button.type = 'button';
    button.dataset.evidenceIndex = String(evidenceIndex);
    button.dataset.paragraphId = verification.target?.paragraphId || '';
    button.dataset.sourceKey = verification.target?.sourceKey || '';
    const label = item?.sectionTitle || '正文段落';
    const quote = String(item?.quote || item?.support || '').trim();
    applyArticleChatCitationState(button, verification, evidenceIndex, label);
    if (verification.status === 'verified' && quote) {
        button.title += `\n${quote}`;
    }
    if (verification.status === 'verified') button.addEventListener('click', () => {
        void focusArticleChatCitation(item, snapshot, button);
    });
    return button;
}

function appendArticleChatInlineMarkdown(parent, value, context = {}) {
    const text = String(value || '');
    const tokenPattern = /(\[\[\d{1,2}\]\]|`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_)/g;
    let cursor = 0;
    for (const match of text.matchAll(tokenPattern)) {
        if (match.index > cursor) parent.appendChild(document.createTextNode(text.slice(cursor, match.index)));
        const token = match[0];
        const citationMatch = token.match(/^\[\[(\d{1,2})\]\]$/);
        if (citationMatch) {
            const marker = citationMatch[1];
            const evidenceIndex = (Array.isArray(context.evidence) ? context.evidence : [])
                .findIndex(item => String(item?.marker || '') === marker);
            const evidenceItem = evidenceIndex >= 0 ? context.evidence[evidenceIndex] : null;
            if (evidenceItem) {
                parent.appendChild(createArticleChatInlineCitation(
                    evidenceItem, evidenceIndex, context.snapshot
                ));
                context.citationIndexes?.add(evidenceIndex);
            } else {
                parent.appendChild(document.createTextNode(token));
            }
        } else if (token.startsWith('`')) {
            parent.appendChild(createWorkspaceElement('code', '', token.slice(1, -1)));
        } else if (token.startsWith('**') || token.startsWith('__')) {
            parent.appendChild(createWorkspaceElement('strong', '', token.slice(2, -2)));
        } else {
            parent.appendChild(createWorkspaceElement('em', '', token.slice(1, -1)));
        }
        cursor = match.index + token.length;
    }
    if (cursor < text.length) parent.appendChild(document.createTextNode(text.slice(cursor)));
}

function normalizeArticleChatMarkdown(value) {
    return String(value || '')
        .replace(/\r\n?/g, '\n')
        .replace(/([。！？；;：:）)])[\t ]*(\d{1,2}[.)]\s+(?=\*\*|__|[\u3400-\u9fffA-Za-z]))/g, '$1\n\n$2')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function isArticleChatMarkdownBlockStart(line) {
    return /^(?:#{1,4}\s+|>\s?|```|[-*+]\s+|\d+[.)]\s+)/.test(line);
}

function renderArticleChatMarkdown(value, context = {}) {
    const root = createWorkspaceElement('div', 'article-chat-message-content');
    const renderContext = { ...context, citationIndexes: new Set() };
    const lines = normalizeArticleChatMarkdown(value).split('\n');
    let index = 0;
    while (index < lines.length) {
        const line = lines[index].trim();
        if (!line) {
            index += 1;
            continue;
        }
        if (line.startsWith('```')) {
            const language = line.slice(3).trim();
            const codeLines = [];
            index += 1;
            while (index < lines.length && !lines[index].trim().startsWith('```')) {
                codeLines.push(lines[index]);
                index += 1;
            }
            if (index < lines.length) index += 1;
            const pre = createWorkspaceElement('pre');
            const code = createWorkspaceElement('code', '', codeLines.join('\n'));
            if (language) code.dataset.language = language;
            pre.appendChild(code);
            root.appendChild(pre);
            continue;
        }
        const heading = line.match(/^(#{1,4})\s+(.+)$/);
        if (heading) {
            const element = createWorkspaceElement(`h${Math.min(4, heading[1].length + 2)}`);
            appendArticleChatInlineMarkdown(element, heading[2], renderContext);
            root.appendChild(element);
            index += 1;
            continue;
        }
        const listMatch = line.match(/^([-*+]|\d+[.)])\s+(.+)$/);
        if (listMatch) {
            const ordered = /^\d/.test(listMatch[1]);
            const list = createWorkspaceElement(ordered ? 'ol' : 'ul');
            while (index < lines.length) {
                const itemMatch = lines[index].trim().match(/^([-*+]|\d+[.)])\s+(.+)$/);
                if (!itemMatch || /^\d/.test(itemMatch[1]) !== ordered) break;
                const item = createWorkspaceElement('li');
                appendArticleChatInlineMarkdown(item, itemMatch[2], renderContext);
                list.appendChild(item);
                index += 1;
            }
            root.appendChild(list);
            continue;
        }
        if (line.startsWith('>')) {
            const quote = createWorkspaceElement('blockquote');
            appendArticleChatInlineMarkdown(quote, line.replace(/^>\s?/, ''), renderContext);
            root.appendChild(quote);
            index += 1;
            continue;
        }
        const paragraphLines = [line];
        index += 1;
        while (index < lines.length && lines[index].trim() &&
            !isArticleChatMarkdownBlockStart(lines[index].trim())) {
            paragraphLines.push(lines[index].trim());
            index += 1;
        }
        const paragraph = createWorkspaceElement('p');
        paragraphLines.forEach((paragraphLine, lineIndex) => {
            if (lineIndex) paragraph.appendChild(document.createElement('br'));
            appendArticleChatInlineMarkdown(paragraph, paragraphLine, renderContext);
        });
        root.appendChild(paragraph);
    }
    root.dataset.inlineCitationCount = String(renderContext.citationIndexes.size);
    root.dataset.inlineCitationIndexes = [...renderContext.citationIndexes].join(',');
    return root;
}

function appendArticleChatEvidence(parent, message, snapshot, inlineCitationIndexes = []) {
    const evidence = Array.isArray(message?.evidence) ? message.evidence : [];
    const limitations = String(message?.limitations || '').trim();
    const renderedIndexes = new Set(inlineCitationIndexes);
    const missingEvidence = evidence
        .map((item, evidenceIndex) => ({ item, evidenceIndex }))
        .filter(({ evidenceIndex }) => !renderedIndexes.has(evidenceIndex));
    if (missingEvidence.length) {
        const citations = createWorkspaceElement('section', 'article-chat-citation-fallback');
        citations.appendChild(createWorkspaceElement(
            'span', '',
            `${missingEvidence.length} 条证据没有绑定到回答中的具体句子，因此未生成跳转点。`
        ));
        parent.appendChild(citations);
    }
    if (limitations) {
        const details = createWorkspaceElement('details', 'article-chat-limitations');
        details.append(createWorkspaceElement('summary', '', '回答边界'));
        details.appendChild(renderArticleChatMarkdown(limitations));
        parent.appendChild(details);
    }
}

function articleChatStatusText(turn = {}) {
    if (turn.status === 'queued') return '已排队，等待上一轮完成';
    if (turn.status === 'generating') return turn.answerBlocks?.length
        ? '正在继续生成…' : '正在检索全文并组织回答…';
    if (turn.status === 'truncated') return '已保留完整回答；模型续写后仍达到输出上限';
    if (turn.status === 'cancelled') return '已取消；已完成的回答块已保留';
    if (turn.status === 'error') return turn.error || '回答失败';
    if (turn.status === 'unanswered') return '回答已删除，可以重新生成';
    return '';
}

function renderArticleChatBlock(block, turn, snapshot) {
    const element = createWorkspaceElement('section', 'article-chat-answer-block');
    element.dataset.blockId = String(block.blockId || '');
    const markdown = renderArticleChatMarkdown(block.markdown || '', {
        evidence: block.evidence,
        snapshot
    });
    element.appendChild(markdown);
    appendArticleChatEvidence(
        element,
        { evidence: block.evidence },
        snapshot,
        String(markdown.dataset.inlineCitationIndexes || '').split(',')
            .filter(Boolean).map(Number)
    );
    return element;
}

function createArticleChatTurnAction(action, label, turnId) {
    const button = createWorkspaceElement('button', 'article-chat-turn-action', label);
    button.type = 'button';
    button.dataset.articleChatAction = action;
    button.dataset.turnId = turnId;
    button.setAttribute('aria-label', `${label}：本轮问答`);
    return button;
}

function renderArticleChatTurn(turn, snapshot = currentWorkspaceSnapshot) {
    const container = document.getElementById('articleChatMessages');
    if (!container || !turn?.turnId) return null;
    const turnId = String(turn.turnId);
    let element = articleChatTurnElements.get(turnId) ||
        container.querySelector(`[data-turn-id="${turnId}"]`);
    if (!element) {
        element = createWorkspaceElement('article', 'article-chat-turn');
        element.dataset.turnId = turnId;
        const question = createWorkspaceElement(
            'div', 'article-chat-message is-user article-chat-question'
        );
        question.appendChild(createWorkspaceElement('div', 'article-chat-message-content'));
        const answer = createWorkspaceElement(
            'div', 'article-chat-message is-assistant article-chat-answer'
        );
        answer.append(
            createWorkspaceElement('header', 'article-chat-message-meta'),
            createWorkspaceElement('div', 'article-chat-answer-blocks'),
            createWorkspaceElement('p', 'article-chat-turn-status'),
            createWorkspaceElement('div', 'article-chat-turn-actions')
        );
        element.append(question, answer);
        articleChatTurnElements.set(turnId, element);
    }

    const questionContent = element.querySelector('.article-chat-question .article-chat-message-content');
    if (questionContent && questionContent.textContent !== String(turn.question || '')) {
        questionContent.textContent = String(turn.question || '');
    }
    const meta = element.querySelector('.article-chat-message-meta');
    const modelLabel = [turn.profileName, turn.model].filter(Boolean).join(' · ');
    if (meta) meta.textContent = modelLabel || (turn.status === 'queued' ? '等待调用模型' : 'LLM');

    const blocks = Array.isArray(turn.answerBlocks) ? turn.answerBlocks : [];
    const blockContainer = element.querySelector('.article-chat-answer-blocks');
    const expectedBlockIds = new Set(blocks.map(block => String(block.blockId || '')));
    blockContainer?.querySelectorAll('[data-block-id]').forEach(node => {
        if (!expectedBlockIds.has(node.dataset.blockId)) node.remove();
    });
    blocks.forEach(block => {
        const blockId = String(block.blockId || '');
        if (!blockId || blockContainer.querySelector(`[data-block-id="${blockId}"]`)) return;
        blockContainer.appendChild(renderArticleChatBlock(block, turn, snapshot));
    });

    const status = element.querySelector('.article-chat-turn-status');
    const statusText = articleChatStatusText(turn);
    if (status) {
        status.textContent = statusText;
        status.hidden = !statusText;
        status.classList.toggle('is-error', turn.status === 'error');
    }
    element.classList.toggle('is-queued', turn.status === 'queued');
    element.classList.toggle('is-generating', turn.status === 'generating');
    element.classList.toggle('is-interrupted', ['cancelled', 'truncated', 'error'].includes(turn.status));

    const actions = element.querySelector('.article-chat-turn-actions');
    if (actions) {
        actions.replaceChildren();
        if (turn.status === 'queued') {
            actions.appendChild(createArticleChatTurnAction(
                'delete-queued', '删除排队问题', turnId
            ));
        } else if (turn.status !== 'generating') {
            if (blocks.length) actions.appendChild(createArticleChatTurnAction(
                'delete-answer', '只删除回答', turnId
            ));
            actions.append(
                createArticleChatTurnAction('regenerate', '重新生成', turnId),
                createArticleChatTurnAction('delete-turn', '删除本轮', turnId)
            );
        }
    }
    return element;
}

function isArticleChatNearBottom(container = document.getElementById('articleChatMessages')) {
    if (!container) return true;
    return container.scrollHeight - container.scrollTop - container.clientHeight <= 72;
}

function updateArticleChatReturnLatest() {
    const button = document.getElementById('articleChatReturnLatest');
    if (button) button.hidden = articleChatFollowLatest ||
        isArticleChatNearBottom();
}

function scrollArticleChatToLatest({ smooth = false } = {}) {
    const container = document.getElementById('articleChatMessages');
    if (!container) return;
    articleChatFollowLatest = true;
    articleChatScrollToLatestActive = smooth;
    container.scrollTo({ top: container.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    updateArticleChatReturnLatest();
    if (smooth) setTimeout(() => {
        if (!container.isConnected) return;
        container.scrollTop = container.scrollHeight;
        articleChatScrollToLatestActive = false;
        articleChatFollowLatest = true;
        updateArticleChatReturnLatest();
    }, 180);
}

function renderArticleChatSnapshot(snapshot = currentWorkspaceSnapshot) {
    renderArticleChatProfileOptions();
    const container = document.getElementById('articleChatMessages');
    const coverage = document.getElementById('articleChatCoverage');
    if (!container || !coverage) return;
    const documentKey = `${snapshot?.url || ''}|${snapshot?.revision || ''}`;
    if (articleChatRenderedDocumentKey && articleChatRenderedDocumentKey !== documentKey) {
        container.querySelectorAll('[data-turn-id]').forEach(node => node.remove());
        articleChatTurnElements.clear();
        articleChatVisibleTurnCount = articleChatHistoryPageSize;
        articleChatFollowLatest = true;
    }
    articleChatRenderedDocumentKey = documentKey;

    const chat = snapshot?.chat || { turns: [], loading: false, error: '' };
    const turns = Array.isArray(chat.turns) ? chat.turns : [];
    const visibleStart = Math.max(0, turns.length - articleChatVisibleTurnCount);
    const visibleTurns = turns.slice(visibleStart);
    const visibleIds = new Set(visibleTurns.map(turn => String(turn.turnId || '')));
    const wasNearBottom = isArticleChatNearBottom(container);

    container.querySelectorAll(':scope > .workspace-empty').forEach(node => node.remove());
    container.querySelectorAll(':scope > [data-turn-id]').forEach(node => {
        if (!visibleIds.has(node.dataset.turnId)) {
            articleChatTurnElements.delete(node.dataset.turnId);
            node.remove();
        }
    });
    visibleTurns.forEach((turn, index) => {
        const element = renderArticleChatTurn(turn, snapshot);
        const current = container.children[index];
        if (element && current !== element) container.insertBefore(element, current || null);
    });
    if (!turns.length) container.appendChild(createWorkspaceElement(
        'div', 'workspace-empty',
        '可以询问结论、机制、方法、证据强弱、局限，或让模型跨章节比较。'
    ));

    const context = chat.coverage;
    coverage.textContent = context
        ? `本轮上下文：${context.sentParagraphs || 0}/${context.totalParagraphs || 0} 段` +
            (context.truncated ? ' · 已按问题覆盖相关章节' : ' · 已发送完整正文')
        : `当前网页已建立正文索引 · ${snapshot?.paragraphs?.length || 0} 段`;
    const loading = chat.loading === true;
    const send = document.getElementById('sendArticleChat');
    const cancel = document.getElementById('cancelArticleChat');
    const clear = document.getElementById('clearArticleChat');
    const loadEarlier = document.getElementById('articleChatLoadEarlier');
    if (send) send.disabled = !articleChatSelectedProfileId;
    if (cancel) cancel.hidden = !loading;
    if (clear) clear.disabled = loading || turns.length === 0;
    if (loadEarlier) {
        loadEarlier.hidden = visibleStart === 0;
        loadEarlier.textContent = visibleStart > 0
            ? `加载更早对话（还有 ${visibleStart} 轮）` : '已显示全部对话';
    }

    if (articleChatFollowLatest && wasNearBottom) {
        requestAnimationFrame(() => scrollArticleChatToLatest());
    } else {
        articleChatFollowLatest = false;
        updateArticleChatReturnLatest();
    }
}

function applyArticleChatStateEvent(event = {}) {
    if (!currentWorkspaceSnapshot) return;
    const currentChat = currentWorkspaceSnapshot.chat || { turns: [] };
    let turns = Array.isArray(currentChat.turns) ? [...currentChat.turns] : [];
    if (event.kind === 'chat_cleared') {
        turns = [];
    } else if (event.kind === 'turn_removed') {
        turns = turns.filter(turn => turn.turnId !== event.turnId);
    } else if (event.turn?.turnId) {
        const index = turns.findIndex(turn => turn.turnId === event.turn.turnId);
        if (index >= 0) turns[index] = event.turn;
        else turns.push(event.turn);
    }
    currentWorkspaceSnapshot = {
        ...currentWorkspaceSnapshot,
        chat: {
            ...currentChat,
            turns,
            totalTurns: Number(event.totalTurns) || turns.length,
            loading: event.loading === true,
            operationId: String(event.operationId || ''),
            activeTurnId: String(event.activeTurnId || ''),
            error: String(event.error || ''),
            coverage: event.coverage || currentChat.coverage || null,
            memoryNeedsRebuild: event.memoryNeedsRebuild === true
        }
    };
    renderArticleChatSnapshot(currentWorkspaceSnapshot);
    cacheCurrentPanelTabState();
}

async function submitArticleChat(event) {
    event?.preventDefault();
    const input = document.getElementById('articleChatQuestion');
    const question = String(input?.value || '').trim();
    const profileId = document.getElementById('articleChatProfile')?.value || '';
    if (!question) {
        input?.focus();
        return;
    }
    if (!profileId || llmSettingsState?.settings?.consentGranted !== true) {
        showStatus('请先在设置中配置可用模型并同意发送正文', 'error');
        return;
    }
    const panelContext = capturePanelContext();
    const queuedBehindActive = currentWorkspaceSnapshot?.chat?.loading === true;
    if (input) input.value = '';
    try {
        const response = await sendTabMessage(panelContext.tabId, {
            action: 'askArticleWithLLM', question, profileId,
            selectedProfileId: profileId
        });
        if (!isCurrentPanelContext(panelContext)) return;
        if (!response?.success) {
            const error = new Error(response?.error || 'ARTICLE_CHAT_FAILED');
            error.code = response?.code;
            throw error;
        }
        if (response.turn) {
            const existingTurns = currentWorkspaceSnapshot?.chat?.turns || [];
            const alreadyPresent = existingTurns.some(turn =>
                turn.turnId === response.turn.turnId
            );
            applyArticleChatStateEvent({
                kind: 'turn_added',
                turn: response.turn,
                totalTurns: existingTurns.length + (alreadyPresent ? 0 : 1),
                loading: currentWorkspaceSnapshot?.chat?.loading === true
            });
        }
        showStatus(queuedBehindActive
            ? '问题已加入队列，将使用提交时选择的模型。' : '问题已发送。', 'success');
    } catch (error) {
        if (!isCurrentPanelContext(panelContext)) return;
        if (input && !input.value) input.value = question;
        showStatus(`全文问答发送失败：${error.message}`, 'error');
    }
}

async function cancelArticleChat() {
    if (!currentWorkspaceSnapshot?.chat?.loading) return;
    const panelContext = capturePanelContext();
    const response = await sendTabMessage(panelContext.tabId, {
        action: 'cancelArticleChatWithLLM'
    });
    if (!isCurrentPanelContext(panelContext)) return;
    if (!response?.success) throw new Error(response?.error || 'ARTICLE_CHAT_CANCEL_FAILED');
}

async function clearArticleChatHistory() {
    const panelContext = capturePanelContext();
    const response = await sendTabMessage(panelContext.tabId, { action: 'clearArticleChat' });
    if (!isCurrentPanelContext(panelContext)) return;
    if (!response?.success) throw new Error(response?.error || 'ARTICLE_CHAT_CLEAR_FAILED');
    await refreshArticleWorkspace({ panelContext });
}

async function mutateArticleChatTurn(action, turnId) {
    const panelContext = capturePanelContext();
    const message = { action, turnId };
    if (action === 'regenerateArticleChatTurn') {
        message.profileId = document.getElementById('articleChatProfile')?.value || '';
    }
    const response = await sendTabMessage(panelContext.tabId, message);
    if (!isCurrentPanelContext(panelContext)) return;
    if (!response?.success) throw new Error(response?.error || 'ARTICLE_CHAT_MUTATION_FAILED');
    await refreshArticleWorkspace({ panelContext });
}

function handleArticleChatTurnAction(event) {
    const button = event.target.closest('[data-article-chat-action]');
    if (!button) return;
    const actions = {
        'delete-turn': { action: 'deleteArticleChatTurn' },
        'delete-answer': { action: 'deleteArticleChatAnswer' },
        'delete-queued': { action: 'deleteQueuedArticleChatTurn' },
        regenerate: { action: 'regenerateArticleChatTurn' }
    };
    const mutation = actions[button.dataset.articleChatAction];
    if (!mutation) return;
    button.disabled = true;
    void mutateArticleChatTurn(mutation.action, button.dataset.turnId).catch(error => {
        button.disabled = false;
        showStatus(`无法修改本轮问答：${error.message}`, 'error');
    });
}

function withPreparationDeadline(promise, timeoutMs = 15000) {
    let timer;
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            timer = setTimeout(() => {
                const error = new Error('提取超时：15 秒内未完成正文识别');
                error.code = 'ARTICLE_PREPARATION_TIMEOUT';
                reject(error);
            }, timeoutMs);
        })
    ]).finally(() => clearTimeout(timer));
}

function renderArticleConnectionStage(message, title = '') {
    const paperTitle = document.getElementById('sidePanelPaperTitle');
    const statusText = document.getElementById('sidePanelDocumentStatusText');
    const connectionStatus = document.getElementById('sidePanelDocumentStatus');
    if (paperTitle && title) paperTitle.textContent = title;
    if (statusText) statusText.textContent = message;
    connectionStatus?.classList.remove('is-error', 'is-ready');
    const retry = document.getElementById('retryArticlePreparation');
    if (retry) retry.hidden = true;
}

function renderArticleConnectionFailure(error) {
    prepareState = 'idle';
    const paperTitle = document.getElementById('sidePanelPaperTitle');
    const statusText = document.getElementById('sidePanelDocumentStatusText');
    const connectionStatus = document.getElementById('sidePanelDocumentStatus');
    const retry = document.getElementById('retryArticlePreparation');
    if (paperTitle) paperTitle.textContent = currentWorkspaceSnapshot?.title || '当前论文';
    if (statusText) {
        statusText.textContent = error?.code === 'ARTICLE_PREPARATION_TIMEOUT'
            ? '提取超时：可重新提取，或直接导出适配诊断包'
            : '提取失败：' + String(error?.message || '未识别到正文');
    }
    connectionStatus?.classList.remove('is-ready');
    connectionStatus?.classList.add('is-error');
    if (retry) {
        retry.hidden = false;
        retry.disabled = false;
    }
    renderStudyTypeChooser();
    updateApplyButton();
}

async function refreshArticleWorkspace({
    announce = false,
    panelContext = capturePanelContext()
} = {}) {
    const requestId = ++workspaceRefreshSequence;
    if (!isCurrentPanelContext(panelContext)) return null;
    try {
        const response = await sendTabMessage(panelContext.tabId, {
            action: 'getArticleWorkspaceSnapshot',
            forceRefresh: announce
        });
        if (!response?.success || !response.snapshot) {
            throw new Error(response?.error || '当前页面结构不可用');
        }
        if (requestId !== workspaceRefreshSequence || !isCurrentPanelContext(panelContext)) {
            return null;
        }
        renderArticleWorkspaceSnapshot(response.snapshot);
        resumeFigureProgressFromWorkspaceSnapshot(response.snapshot, {
            tabId: panelContext.tabId
        });
        if (announce) showStatus('论文侧栏已刷新', 'success');
        return response.snapshot;
    } catch (error) {
        if (requestId !== workspaceRefreshSequence || !isCurrentPanelContext(panelContext)) {
            return null;
        }
        const status = document.getElementById('articleNavigationStatus');
        if (status) status.textContent = '读取失败：' + error.message;
        if (announce) showStatus('论文侧栏刷新失败：' + error.message, 'error');
        return null;
    }
}

// 初始化
function currentArticleArchiveIdentity() {
    return {
        documentId: manualAnnotationState.documentId || preparedDocumentState?.documentId || '',
        documentHash: manualAnnotationState.documentHash || preparedDocumentState?.documentHash || '',
        canonicalUrl: manualAnnotationState.canonicalUrl || currentWorkspaceSnapshot?.url || '',
        title: manualAnnotationState.title || currentWorkspaceSnapshot?.title || ''
    };
}

function setArticleArchivePrompt(probe = null) {
    const prompt = document.getElementById('articleArchivePrompt');
    const summary = document.getElementById('articleArchivePromptSummary');
    currentArticleArchiveProbe = probe;
    if (!prompt || !summary) return;
    prompt.hidden = !probe?.found;
    if (!probe?.found) return;
    const parts = [];
    if (probe.savedAt) parts.push(`保存于 ${new Date(probe.savedAt).toLocaleString('zh-CN')}`);
    if (probe.annotationCount) parts.push(`${probe.annotationCount} 条手动标注`);
    if (probe.hasLlmAnalysis) parts.push('含 AI 全文分析');
    if (probe.hasReviewOutline) parts.push('含逐段摘要');
    if (probe.figureCount) parts.push(`${probe.figureCount} 个图解结果`);
    summary.textContent = `${parts.join(' · ') || '已找到本地档案'}。可加载上次结果，或跳过并重新分析。`;
}

async function probeCurrentArticleArchive() {
    const identity = currentArticleArchiveIdentity();
    if (!identity.documentId) {
        setArticleArchivePrompt(null);
        return null;
    }
    try {
        const probe = await sendLlmMessage({
            type: 'ARTICLE_ARCHIVE_PROBE',
            documentId: identity.documentId,
            canonicalUrl: identity.canonicalUrl
        });
        setArticleArchivePrompt(probe);
        return probe;
    } catch (error) {
        setArticleArchivePrompt(null);
        const statusText = document.getElementById('sidePanelDocumentStatusText');
        if (statusText && error.code === 'INVALID_JSON_ASSET') {
            statusText.textContent = '本地文献档案已损坏，可重新分析后覆盖保存';
        }
        return null;
    }
}

async function getCurrentArticleArchiveFromTab(panelContext = capturePanelContext()) {
    if (!isCurrentPanelContext(panelContext)) return null;
    const response = await sendTabMessage(panelContext.tabId, {
        action: 'getArticleArchiveSnapshot'
    });
    if (!isCurrentPanelContext(panelContext)) return null;
    if (!response?.success || !response.archive) {
        throw new Error(response?.error || '当前论文档案尚未准备完成');
    }
    return {
        tabId: panelContext.tabId,
        archive: SciLLM.validateArticleArchive(response.archive)
    };
}

async function persistCurrentArticleArchive({
    announce = false,
    panelContext = capturePanelContext()
} = {}) {
    const current = await getCurrentArticleArchiveFromTab(panelContext);
    if (!current || !isCurrentPanelContext(panelContext)) return null;
    const { archive } = current;
    const saved = await sendLlmMessage({ type: 'ARTICLE_ARCHIVE_SAVE', archive });
    if (!isCurrentPanelContext(panelContext)) return null;
    if (announce) showStatus('本文高亮、备注与分析结果已保存到本地目录', 'success');
    return { archive, saved };
}

async function applyLoadedArticleArchive(archive, { imported = false } = {}) {
    const identity = currentArticleArchiveIdentity();
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !identity.documentId) throw new Error('当前论文尚未准备完成');
    if (imported) {
        await sendLlmMessage({
            type: 'ARTICLE_ARCHIVE_LOAD',
            documentId: identity.documentId,
            documentHash: identity.documentHash,
            canonicalUrl: identity.canonicalUrl,
            archive,
            apply: true
        });
    }
    const applied = await sendTabMessage(tab.id, {
        action: 'applyArticleArchiveSnapshot',
        archive
    });
    if (!applied?.success) throw new Error(applied?.error || '档案无法恢复到当前页面');
    await refreshManualAnnotationSummary(tab.id);
    await refreshArticleWorkspace();
    setArticleArchivePrompt(null);
    const message = applied.partial
        ? '页面正文与存档版本不同：备注和分析卡片已恢复，旧 AI 文本范围未强行套用。'
        : '上次的高亮、备注与 AI 分析结果已恢复。';
    showStatus(message, applied.partial ? 'error' : 'success');
    return applied;
}

async function loadCurrentArticleArchive() {
    const identity = currentArticleArchiveIdentity();
    if (!identity.documentId) return;
    try {
        const loaded = await sendLlmMessage({
            type: 'ARTICLE_ARCHIVE_LOAD',
            documentId: identity.documentId,
            documentHash: identity.documentHash,
            canonicalUrl: identity.canonicalUrl,
            apply: true
        });
        await applyLoadedArticleArchive(loaded.archive);
    } catch (error) {
        showStatus(`加载本文档案失败：${error.message}`, 'error');
    }
}

function downloadArticleArchive(archive) {
    const blob = new Blob([`${JSON.stringify(archive, null, 2)}\n`], {
        type: 'application/json;charset=utf-8'
    });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const title = String(archive.title || 'article')
        .replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80) || 'article';
    link.href = objectUrl;
    link.download = `${title}.sci-archive.json`;
    link.click();
    URL.revokeObjectURL(objectUrl);
}

function exportCurrentArticleArchive() {
    return articleArchiveExportGuard.run(async () => {
        const button = document.getElementById('exportCurrentArticleArchive');
        if (button) {
            button.disabled = true;
            button.setAttribute('aria-busy', 'true');
        }
        try {
            const { archive } = await getCurrentArticleArchiveFromTab();
            downloadArticleArchive(archive);
            showStatus('本文档案已导出', 'success');
        } catch (error) {
            showStatus(`导出本文档案失败：${error.message}`, 'error');
        } finally {
            if (button) {
                button.disabled = false;
                button.removeAttribute('aria-busy');
            }
        }
    });
}

async function importCurrentArticleArchive(event) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
        const archive = SciLLM.validateArticleArchive(JSON.parse(await file.text()));
        const identity = currentArticleArchiveIdentity();
        if (SciLLM.articleArchiveRelativePath(archive) !==
            SciLLM.articleArchiveRelativePath(identity)) {
            throw new Error('所选档案不属于当前网页文献');
        }
        await sendLlmMessage({ type: 'ARTICLE_ARCHIVE_SAVE', archive });
        await applyLoadedArticleArchive(archive, { imported: true });
    } catch (error) {
        showStatus(`导入本文档案失败：${error.message}`, 'error');
    }
}

function setupArticleArchiveControls() {
    document.getElementById('loadArticleArchive')
        ?.addEventListener('click', loadCurrentArticleArchive);
    document.getElementById('reanalyzeArticle')?.addEventListener('click', () => {
        setArticleArchivePrompt(null);
        switchWorkspaceView('analysis');
        showStatus('已跳过旧档案，可按当前设置重新分析', 'success');
    });
    document.getElementById('exportCurrentArticleArchive')
        ?.addEventListener('click', exportCurrentArticleArchive);
    document.getElementById('importCurrentArticleArchive')
        ?.addEventListener('change', importCurrentArticleArchive);
}

function setupAdapterDiagnosticControls() {
    document.getElementById('exportAdapterDiagnosticBundle')
        ?.addEventListener('click', exportAdapterDiagnosticBundle);
    document.getElementById('retryArticlePreparation')
        ?.addEventListener('click', () => void initializeCurrentArticle({ retry: true }));
}

async function initializeCurrentArticle({ retry = false } = {}) {
    const requestId = ++articlePreparationSequence;
    const retryButton = document.getElementById('retryArticlePreparation');
    if (retryButton) {
        retryButton.hidden = true;
        retryButton.disabled = true;
    }
    renderArticleConnectionStage(
        retry ? '正在重新提取当前论文…' : '正在读取当前页面结构…',
        retry ? (currentWorkspaceSnapshot?.title || '当前论文') : '正在连接当前论文…'
    );
    try {
        const snapshot = await withPreparationDeadline((async () => {
            if (analysisMode === 'llm' && llmSettingsState?.effectiveMode === 'llm') {
                renderArticleConnectionStage('正在识别正文并建立文献指纹…');
                await prepareCurrentArticleForTypeChoice({
                    throwOnError: true,
                    forceRefresh: retry
                });
                if (!preparedDocumentState?.documentHash) {
                    throw lastArticlePreparationError || new Error('正文已显示，但适配器尚未识别出可用正文');
                }
            } else {
                await refreshManualAnnotationSummary();
                requestMatchCounts();
            }
            renderArticleConnectionStage('正在生成本地标题层级与段落索引…');
            const workspace = await refreshArticleWorkspace();
            if (!workspace) throw new Error('当前页面结构不可用');
            return workspace;
        })(), 15000);
        if (requestId !== articlePreparationSequence) return null;
        renderArticleWorkspaceSnapshot(snapshot);
        if (analysisMode === 'llm') {
            void Promise.allSettled([
                refreshLlmDiagnostics(),
                restoreFigureAnalysisProgress(),
                restoreReviewOutlineProgress()
            ]);
        }
        void probeCurrentArticleArchive();
        return snapshot;
    } catch (error) {
        if (requestId !== articlePreparationSequence) return null;
        renderArticleConnectionFailure(error);
        showStatus(
            `${error?.code === 'ARTICLE_PREPARATION_TIMEOUT' ? '正文提取超时' : '正文提取失败'}：` +
            '可重新提取，或导出适配诊断包用于修复',
            'error'
        );
        return null;
    } finally {
        if (requestId === articlePreparationSequence && retryButton && retryButton.hidden) {
            retryButton.disabled = false;
        }
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    setupWorkspaceNavigation();
    setupSidePanelSettingsMenu();
    setupArticleArchiveControls();
    setupAdapterDiagnosticControls();
    setupActiveTabSynchronization();
    try {
        // 设置读取也受同一截止时间保护，避免侧栏永久停在“正在连接”。
        await withPreparationDeadline(
            Promise.all([loadSettings(), loadLlmSettings()]),
            15000
        );
        reconcileRegexSelection();

        // 渲染界面
        renderCategories();
        setupEventListeners();

        // 恢复模式选择
        document.querySelector(`input[name="highlightMode"][value="${highlightMode}"]`).checked = true;
        const analysisRadio = document.querySelector(`input[name="analysisMode"][value="${analysisMode}"]`);
        if (analysisRadio) analysisRadio.checked = true;
        updateAnalysisModeUi();
        panelUiReady = true;
        await synchronizeActiveTabContext();
    } catch (error) {
        renderArticleConnectionFailure(error);
        showStatus('侧栏初始化失败：可重新提取或导出适配诊断包', 'error');
    }
});

// 加载设置
async function loadSettings() {
    const stored = await chrome.storage.local.get([
        'selectedCategories',
        'highlightMode'
    ]);

    if (Array.isArray(stored.selectedCategories)) {
        selectedCategories = new Set(stored.selectedCategories);
        regexSelectionStored = true;
    }
    if (stored.highlightMode) {
        highlightMode = stored.highlightMode;
    }
}

// 保存设置
async function saveSettings() {
    await chrome.storage.local.set({
        selectedCategories: Array.from(selectedCategories),
        highlightMode: highlightMode
    });
}

function getCategoryEntriesForEngine(engine = analysisMode) {
    return getAvailableCategoryEntries(
        llmSettingsState?.availableCategories,
        engine
    );
}

function reconcileRegexSelection() {
    const availableIds = getCategoryEntriesForEngine('regex').map(([categoryId]) => categoryId);
    const available = new Set(availableIds);
    selectedCategories = regexSelectionStored
        ? new Set([...selectedCategories].filter(categoryId => available.has(categoryId)))
        : new Set(availableIds);
}

async function sendLlmMessage(message) {
    const response = await chrome.runtime.sendMessage(message);
    if (!response?.success) {
        const error = new Error(response?.error?.message || 'LLM 操作失败');
        error.code = response?.error?.code;
        throw error;
    }
    return response.data;
}

async function loadLlmSettings() {
    try {
        llmSettingsState = await sendLlmMessage({ type: 'LLM_GET_SETTINGS' });
        analysisMode = llmSettingsState.settings.mode;
        persistedAnalysisMode = analysisMode;
        readingViewId = llmSettingsState.settings.readingViewId || 'quick_story';
        persistedReadingViewId = readingViewId;
        llmSelectedCategories = getConfiguredViewSelection();
        confidenceThreshold = Number(llmSettingsState.settings.confidenceThreshold) || 0.8;
        persistedConfidenceThreshold = confidenceThreshold;
    } catch (error) {
        analysisMode = 'regex';
        persistedAnalysisMode = 'regex';
        llmSettingsState = null;
    }
}

function getReadingViewDefinition(viewId = readingViewId) {
    return llmSettingsState?.readingViews?.[viewId] || { categoryIds: [] };
}

function getCurrentViewOverride(viewId = readingViewId) {
    const stored = llmSettingsState?.settings?.viewCategoryOverrides?.[viewId];
    return {
        add: Array.isArray(stored?.add) ? [...stored.add] : [],
        remove: Array.isArray(stored?.remove) ? [...stored.remove] : []
    };
}

function getConfiguredViewSelection(viewId = readingViewId) {
    const view = getReadingViewDefinition(viewId);
    const override = getCurrentViewOverride(viewId);
    const selected = new Set([...(view.categoryIds || []), ...override.add]);
    override.remove.forEach(categoryId => selected.delete(categoryId));
    return selected;
}

function getPreparedCategorySource(categoryId) {
    if (getCurrentViewOverride().add.includes(categoryId)) return 'manual';
    const source = preparedDocumentState?.categorySources
        ?.find(item => item.categoryId === categoryId)?.source;
    return source || '';
}

function syncPreparedSelection() {
    if (!Array.isArray(preparedDocumentState?.activeCategories)) {
        llmSelectedCategories = getConfiguredViewSelection();
        return;
    }
    const override = getCurrentViewOverride();
    const selected = new Set(
        (preparedDocumentState.activeCategories || []).map(category => category.categoryId)
    );
    override.add.forEach(categoryId => selected.add(categoryId));
    override.remove.forEach(categoryId => selected.delete(categoryId));
    llmSelectedCategories = selected;
}

function invalidatePreparedComposition() {
    if (preparedDocumentState) {
        preparedDocumentState = {
            ...preparedDocumentState,
            activeCategories: null,
            categorySources: []
        };
    }
    syncPreparedSelection();
}

function updateReadingViewControl() {
    const radio = document.querySelector(
        `input[name="readingView"][value="${readingViewId}"]`
    );
    if (radio) radio.checked = true;
}

function getSelectedStudyType() {
    const types = llmSettingsState?.studyTypes || {};
    const selected = selectedStudyTypeOverride ||
        preparedDocumentState?.studyProfile?.primaryType;
    return Object.prototype.hasOwnProperty.call(types, selected) ? selected : '';
}

function renderStudyTypeChooser() {
    const chooser = document.getElementById('studyTypeChooser');
    const options = document.getElementById('studyTypeOptions');
    chooser.hidden = analysisMode !== 'llm';
    options.innerHTML = '';
    const types = llmSettingsState?.studyTypes || {};
    const selectedType = getSelectedStudyType();
    const disabled = studyTypeSelectionInFlight || prepareState === 'preparing' ||
        prepareState === 'analyzing' || !preparedDocumentState?.documentHash;
    Object.entries(types).forEach(([typeId, definition]) => {
        const radioId = `study-type-${typeId}`;
        const label = document.createElement('label');
        label.className = 'study-type-option';
        label.htmlFor = radioId;
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'studyType';
        radio.id = radioId;
        radio.value = typeId;
        radio.checked = selectedType === typeId;
        radio.disabled = disabled;
        radio.addEventListener('change', handleStudyTypeChange);
        const text = document.createElement('span');
        text.textContent = definition.name;
        label.appendChild(radio);
        label.appendChild(text);
        options.appendChild(label);
    });
}

async function handleStudyTypeChange(event) {
    const selectedType = event.target.value;
    const types = llmSettingsState?.studyTypes || {};
    if (studyTypeSelectionInFlight) return;
    if (!preparedDocumentState?.documentHash ||
        !Object.prototype.hasOwnProperty.call(types, selectedType)) {
        renderStudyTypeChooser();
        showStatus('正文尚未准备好，暂时无法保存文献类型', 'error');
        return;
    }
    const previousSelectedType = getSelectedStudyType();
    const expectedDocumentHash = preparedDocumentState.documentHash;
    const expectedViewId = readingViewId;
    const intent = preferenceMutationCoordinator.beginIntent();
    selectedStudyTypeOverride = selectedType;
    studyTypeSelectionInFlight = true;
    renderStudyTypeChooser();
    updateApplyButton();
    try {
        const result = await runSavedMutation({
            coordinator: preferenceMutationCoordinator,
            intent,
            save: () => sendLlmMessage({
                type: 'LLM_SET_STUDY_TYPE',
                documentId: preparedDocumentState.documentId,
                documentHash: expectedDocumentHash,
                studyType: selectedType
            }),
            refresh: (corrected, { isCurrent }) => {
                reconcilePersistedLlmControls(llmSettingsState, isCurrent);
                if (!shouldApplyPreparedResult({
                    isCurrent: isCurrent(),
                    expectedDocumentHash,
                    expectedViewId,
                    prepared: corrected
                })) {
                    if (!isCurrent()) return { applied: false, reason: 'superseded' };
                    throw new Error('返回的文献类型与当前文献或阅读视图不一致');
                }
                applyPreparedComposition(corrected, currentArticleDocument ||
                    preparedDocumentState.document);
                return { applied: true };
            },
            onSaveFailed: error => {
                selectedStudyTypeOverride = previousSelectedType;
                renderStudyTypeChooser();
                showStatus(`保存文献类型失败，已恢复原选择：${error.message}`, 'error');
            },
            onRefreshFailed: error => {
                invalidatePreparedComposition();
                renderStudyTypeChooser();
                renderCategories();
                showStatus(`文献类型已保存，但正文组合刷新失败：${error.message}`, 'error');
            }
        });
        if (result.status === 'refreshed') {
            const selectedName = types[selectedType]?.name || selectedType;
            showStatus(`已选择文献类型：${selectedName}`, 'success');
        }
    } catch (error) {
        showStatus(`保存文献类型失败：${error.message}`, 'error');
    } finally {
        studyTypeSelectionInFlight = false;
        renderStudyTypeChooser();
        updateApplyButton();
    }
}

function updateApplyButton() {
    const applyButton = document.getElementById('applyHighlight');
    updateHighlightTaskControls();
    if (regexApplyPending) {
        applyButton.textContent = analysisMode === 'llm'
            ? '正在分析全文' : '正在应用高亮';
        applyButton.disabled = true;
        return;
    }
    if (preferenceMutationCoordinator.isPending()) {
        applyButton.textContent = '正在更新分析设置';
        applyButton.disabled = true;
        return;
    }
    if (analysisMode !== 'llm') {
        applyButton.textContent = regexApplyPending ? '正在应用高亮' : '应用高亮';
        applyButton.disabled = regexApplyPending || selectedCategories.size === 0;
        return;
    }
    const selectedType = getSelectedStudyType();
    if (llmSettingsState?.effectiveMode !== 'llm') {
        applyButton.textContent = '配置 LLM';
        applyButton.disabled = true;
    } else if (prepareState === 'preparing') {
        applyButton.textContent = '正在准备正文';
        applyButton.disabled = true;
    } else if (prepareState === 'analyzing') {
        applyButton.textContent = '正在分析全文';
        applyButton.disabled = true;
    } else if (!preparedDocumentState?.documentHash || !selectedType ||
        studyTypeSelectionInFlight) {
        applyButton.textContent = '请先选择文献类型';
        applyButton.disabled = true;
    } else if (llmSelectedCategories.size === 0) {
        applyButton.textContent = '请至少选择一个分类';
        applyButton.disabled = true;
    } else if (preparedDocumentState.fullTextAnalyzed) {
        applyButton.textContent = '重新分析全文';
        applyButton.disabled = false;
    } else {
        applyButton.textContent = '分析全文';
        applyButton.disabled = false;
    }
}

async function controlActiveAnalysis(scope, command) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('无法获取当前论文页面');
    const response = await sendTabMessage(tab.id, {
        action: 'controlLlmOperation', scope, command
    });
    if (!response?.success) {
        const error = new Error(response?.error || '无法控制分析任务');
        error.code = response?.code;
        throw error;
    }
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
        updateFigureButton();
        renderFigureWorkspaceSnapshot(currentWorkspaceSnapshot);
    }
    const label = command === 'cancel' ? '已取消' : command === 'pause' ? '已暂停' : '已继续';
    showStatus(`${label}${scope === 'figure' ? ' Figure 解读' : '全文 LLM 高亮'}`,
        command === 'cancel' ? 'error' : 'success');
    return response;
}

function updateHighlightTaskControls() {
    const controls = document.getElementById('highlightTaskControls');
    const pause = document.getElementById('pauseHighlightAnalysis');
    const cancel = document.getElementById('cancelHighlightAnalysis');
    if (!controls || !pause || !cancel) return;
    const active = highlightTaskState.running && !highlightTaskState.cancelled;
    controls.hidden = !active;
    pause.textContent = highlightTaskState.paused ? '继续分析' : '暂停分析';
    pause.disabled = !active;
    cancel.disabled = !active;
}

function updateFigureTaskControls() {
    const controls = document.getElementById('figureTaskControls');
    const pause = document.getElementById('pauseFigureAnalysis');
    const cancel = document.getElementById('cancelFigureAnalysis');
    if (!controls || !pause || !cancel) return;
    const active = figureAnalysisState.running === true;
    controls.hidden = !active;
    pause.textContent = figureAnalysisState.paused ? '继续图解' : '暂停图解';
    pause.disabled = !active;
    cancel.disabled = !active;
}

function updateFigureButton() {
    const figureButton = document.getElementById('analyzeFiguresFromFigures') ||
        document.getElementById('analyzeFigures');
    if (!figureButton) return;
    const isLlm = analysisMode === 'llm';
    const ready = isLlm && llmSettingsState?.effectiveMode === 'llm';
    const running = Boolean(figureAnalysisState.running);
    const crossFigureButton = document.getElementById('analyzeCrossFigureLogic');
    if (crossFigureButton) {
        crossFigureButton.hidden = !isLlm;
        crossFigureButton.disabled = !ready || running || crossFigureLogicRunning;
        crossFigureButton.textContent = crossFigureLogicRunning
            ? '正在串联主图逻辑…'
            : '一键梳理主图多米诺总链';
    }
    figureButton.hidden = !isLlm;
    figureButton.disabled = !ready || running;
    if (!running) {
        figureButton.textContent = '逐图解读';
    } else if (figureAnalysisState.totalFigures > 0 && figureAnalysisState.currentFigure > 0) {
        const label = String(figureAnalysisState.figureLabel || '').slice(0, 24);
        figureButton.textContent = `第 ${figureAnalysisState.currentFigure}/${figureAnalysisState.totalFigures} 张` +
            (label ? `：${label}` : '');
    } else {
        figureButton.textContent = '正在读取 Figure';
    }
    updateFigureTaskControls();
}

function updateReviewOutlineButton() {
    const button = document.getElementById('generateReviewOutline');
    const isLlm = analysisMode === 'llm';
    const ready = isLlm && llmSettingsState?.effectiveMode === 'llm';
    let statusText = '';
    if (!reviewOutlineState.running) {
        statusText = reviewOutlineState.hasOutline
            ? '重新生成整篇逐段摘要' : '生成整篇逐段摘要';
    } else if (reviewOutlineState.phase === 'review_reduce') {
        statusText = '正在综合章节结构';
    } else if (reviewOutlineState.totalParagraphs > 0) {
        statusText = `${reviewOutlineState.completedParagraphs}/` +
            `${reviewOutlineState.totalParagraphs} 段`;
    } else {
        statusText = '正在提取正文层级';
    }
    if (button) {
        button.hidden = !isLlm;
        button.disabled = !ready || reviewOutlineState.running;
        button.textContent = statusText;
    }
    const navigationButton = document.getElementById('generateOutlineSummaries');
    if (navigationButton) {
        navigationButton.disabled = !ready || reviewOutlineState.running;
        navigationButton.textContent = reviewOutlineState.running
            ? statusText
            : reviewOutlineState.hasOutline ? '更新逐段摘要' : '生成逐段摘要';
    }
}

async function openArticleNavigator() {
    switchWorkspaceView('navigation');
    const snapshot = await refreshArticleWorkspace({ announce: true });
    if (!snapshot) return;
    const headingCount = Number(snapshot.diagnostics?.headingCount) || 0;
    showStatus(
        headingCount
            ? `已生成本地大纲：${headingCount} 个标题`
            : '当前页面暂未识别到正文标题',
        headingCount ? 'success' : 'error'
    );
}

function validateAdapterDiagnosticBundle(value) {
    if (value?.kind !== 'sci-publisher-adapter-diagnostic' ||
        value?.schemaVersion !== 2 ||
        typeof value?.dom?.documentHtml !== 'string') {
        throw new Error('诊断包格式不完整');
    }
    return value;
}

async function diagnosticBlob(bundle) {
    const jsonBlob = new Blob([JSON.stringify(bundle, null, 2)], {
        type: 'application/json;charset=utf-8'
    });
    if (typeof CompressionStream !== 'function') {
        return { blob: jsonBlob, extension: '.json' };
    }
    const compressed = jsonBlob.stream().pipeThrough(new CompressionStream('gzip'));
    return {
        blob: await new Response(compressed).blob(),
        extension: '.json.gz'
    };
}

function diagnosticFilename(bundle, extension) {
    const hostname = String(bundle?.page?.hostname || 'page').toLowerCase()
        .replace(/[^a-z0-9.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'page';
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return `sci-adapter-diagnostic-${hostname}-${timestamp}${extension}`;
}

function downloadBlob(blob, filename) {
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = filename;
    link.hidden = true;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

let adapterDiagnosticExportPending = false;

async function exportAdapterDiagnosticBundle() {
    if (adapterDiagnosticExportPending) return;
    adapterDiagnosticExportPending = true;
    const buttons = [document.getElementById('exportAdapterDiagnosticBundle')].filter(Boolean);
    buttons.forEach(button => {
        button.disabled = true;
        button.dataset.originalText ||= button.textContent;
        button.textContent = '正在生成诊断包…';
    });
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) throw new Error('无法获取当前论文页面');
        const response = await sendTabMessage(tab.id, {
            action: 'buildAdapterDiagnosticBundle'
        });
        if (!response?.success) {
            throw new Error(response?.error || '页面没有返回适配诊断数据');
        }
        const bundle = validateAdapterDiagnosticBundle(response.bundle);
        const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (currentTab?.id !== tab.id) {
            throw new Error('活动页面已变化，请在目标论文页重新导出');
        }
        const output = await diagnosticBlob(bundle);
        const filename = diagnosticFilename(bundle, output.extension);
        downloadBlob(output.blob, filename);
        showStatus(
            `适配诊断包已导出：${bundle.publisher?.family || 'generic'} · ` +
            `${bundle.candidates?.length || 0} 个候选正文根节点`,
            'success'
        );
    } catch (error) {
        showStatus('适配诊断包导出失败：' + error.message, 'error');
    } finally {
        adapterDiagnosticExportPending = false;
        buttons.forEach(button => {
            button.disabled = false;
            button.textContent = button.dataset.originalText || '导出适配诊断包';
        });
    }
}

function stopReviewOutlineProgressPolling() {
    if (reviewOutlineProgressTimer !== null) {
        clearInterval(reviewOutlineProgressTimer);
        reviewOutlineProgressTimer = null;
    }
}

function applyReviewOutlineProgress(response, announce = true) {
    if (!response?.status || typeof response.status !== 'object') return null;
    reviewOutlineState = {
        ...reviewOutlineState,
        ...response.status,
        running: Boolean(response.status.running),
        hasOutline: Boolean(response.hasOutline || reviewOutlineState.hasOutline)
    };
    updateReviewOutlineButton();
    if (announce && reviewOutlineState.running) {
        const isRecovery = reviewOutlineState.phase === 'review_retry' ||
            reviewOutlineState.phase === 'review_split';
        const progressText = isRecovery && reviewOutlineState.message
            ? reviewOutlineState.message
            : reviewOutlineState.phase === 'review_reduce'
                ? '正在综合章节结构…'
                : reviewOutlineState.totalParagraphs > 0
                    ? `正在生成逐段摘要：${reviewOutlineState.completedParagraphs}/` +
                        `${reviewOutlineState.totalParagraphs} 段…`
                    : (reviewOutlineState.message || '正在提取正文层级…');
        showStatus(progressText, 'success');
    }
    return reviewOutlineState;
}

async function refreshReviewOutlineProgress(
    tabId,
    announce = true,
    panelContext = capturePanelContext(reviewOutlineTaskGeneration)
) {
    if (!isCurrentReviewOutlineTask(panelContext) ||
        Number(tabId) !== Number(panelContext.tabId)) return null;
    try {
        const response = await sendTabMessage(tabId, { action: 'getReviewOutlineStatus' });
        if (!isCurrentReviewOutlineTask(panelContext)) return null;
        if (!response?.success) return null;
        return applyReviewOutlineProgress(response, announce);
    } catch (error) {
        return null;
    }
}

function startReviewOutlineProgressPolling(
    tabId,
    panelContext = capturePanelContext(reviewOutlineTaskGeneration)
) {
    stopReviewOutlineProgressPolling();
    const poll = async () => {
        if (!isCurrentReviewOutlineTask(panelContext)) {
            stopReviewOutlineProgressPolling();
            return;
        }
        const status = await refreshReviewOutlineProgress(tabId, true, panelContext);
        if (!isCurrentReviewOutlineTask(panelContext)) return;
        if (status && !status.running) stopReviewOutlineProgressPolling();
    };
    void poll();
    reviewOutlineProgressTimer = setInterval(poll, 600);
}

async function restoreReviewOutlineProgress() {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) return;
        const status = await refreshReviewOutlineProgress(tab.id, false);
        if (hasRunningFigureProgress(status)) {
            startReviewOutlineProgressPolling(tab.id);
            applyReviewOutlineProgress({ status, hasOutline: status.hasOutline }, true);
        }
    } catch (error) {
        // 当前网页不支持内容脚本时保留普通按钮状态。
    }
}

function stopFigureProgressPolling() {
    figureProgressPollingGeneration += 1;
    figureProgressRefreshSequence += 1;
    if (figureProgressTimer !== null) {
        clearInterval(figureProgressTimer);
        figureProgressTimer = null;
    }
}

function applyFigureAnalysisProgress(status, announce = true) {
    if (!status || typeof status !== 'object') return null;
    const figureProgress = getFigureProgressEntries(status).map(item => ({ ...item }));
    const snapshot = { ...status, figureProgress };
    figureAnalysisState = {
        ...figureAnalysisState,
        ...snapshot,
        running: hasRunningFigureProgress(snapshot)
    };
    updateFigureButton();
    updateReviewOutlineButton();
    renderFigureWorkspaceSnapshot(currentWorkspaceSnapshot);
    if (announce && figureAnalysisState.running) {
        const activeProgress = figureProgress.find(item => item?.running === true) ||
            figureProgress[figureProgress.length - 1];
        const message = activeProgress
            ? `${activeProgress.figureLabel || activeProgress.figureId || 'Figure'}：` +
                formatFigureProgress(activeProgress).phaseText
            : figureAnalysisState.message || (
            figureAnalysisState.totalFigures > 0 && figureAnalysisState.currentFigure > 0
                ? `正在处理第 ${figureAnalysisState.currentFigure}/${figureAnalysisState.totalFigures} 张：` +
                    (figureAnalysisState.figureLabel || 'Figure')
                : '正在读取论文中的 Figure…');
        showStatus(message, 'success');
    }
    return figureAnalysisState;
}

async function refreshFigureAnalysisProgress(tabId, announce = true, taskToken = figureTaskGeneration) {
    const requestSequence = ++figureProgressRefreshSequence;
    try {
        const response = await sendTabMessage(tabId, {
            action: 'getFigureAnalysisStatus'
        });
        if (requestSequence !== figureProgressRefreshSequence) return null;
        if (!isCurrentFigureTask(taskToken, tabId)) return null;
        if (!response?.success) return null;
        const applied = applyFigureAnalysisProgress(response.status, announce);
        const signature = getFigureProgressEntries(applied).map(progress => [
            progress.figureId,
            progress.phase,
            progress.completedPanelBatches || 0,
            progress.recognizedPanelCount || 0,
            progress.completed === true
        ].join(':')).sort().join('|');
        const hasFreshResult = getFigureProgressEntries(applied).some(progress =>
            progress.phase === 'figure_panel_batch_complete' || progress.phase === 'figure'
        );
        if (hasFreshResult && signature && signature !== figureWorkspaceProgressSignature) {
            figureWorkspaceProgressSignature = signature;
            await refreshArticleWorkspace({ panelContext: capturePanelContext(taskToken) });
        }
        return applied;
    } catch (error) {
        return null;
    }
}

function startFigureProgressPolling(tabId, { waitForSnapshot = false } = {}) {
    if (figureProgressTimer !== null) return;
    const taskToken = figureTaskGeneration;
    const pollingGeneration = ++figureProgressPollingGeneration;
    let receivedRunningSnapshot = !waitForSnapshot;
    let pollInFlight = false;
    let pollSequence = 0;
    const poll = async () => {
        if (pollInFlight) return;
        pollInFlight = true;
        const currentPoll = ++pollSequence;
        try {
            const status = await refreshFigureAnalysisProgress(tabId, true, taskToken);
            if (pollingGeneration !== figureProgressPollingGeneration ||
                currentPoll !== pollSequence || !isCurrentFigureTask(taskToken, tabId)) return;
            if (status && hasRunningFigureProgress(status)) receivedRunningSnapshot = true;
            if (status && receivedRunningSnapshot && !hasRunningFigureProgress(status)) {
                stopFigureProgressPolling();
            }
        } finally {
            pollInFlight = false;
        }
    };
    void poll();
    figureProgressTimer = setInterval(poll, 600);
}

async function restoreFigureAnalysisProgress() {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) return;
        const status = await refreshFigureAnalysisProgress(tab.id, false);
        if (hasRunningFigureProgress(status)) {
            startFigureProgressPolling(tab.id);
            applyFigureAnalysisProgress(status, true);
        }
    } catch (error) {
        // 当前网页不支持内容脚本时保持普通按钮状态。
    }
}

globalThis.addEventListener?.('beforeunload', stopFigureProgressPolling);
globalThis.addEventListener?.('unload', stopFigureProgressPolling);

async function updateLlmPreferencesCore(preferences) {
    llmSettingsState = await sendLlmMessage({
        type: 'LLM_UPDATE_PREFERENCES',
        preferences
    });
    return llmSettingsState;
}

async function updateViewCategorySelection(categoryId, checked, targetViewId) {
    const override = getCurrentViewOverride(targetViewId);
    const baselineSource = getPreparedCategorySource(categoryId);
    const isBaseline = (getReadingViewDefinition(targetViewId).categoryIds || [])
        .includes(categoryId) ||
        ['view_default', 'primary_type'].includes(baselineSource);
    override.add = override.add.filter(item => item !== categoryId);
    override.remove = override.remove.filter(item => item !== categoryId);
    if (checked && !isBaseline) override.add.push(categoryId);
    if (!checked) override.remove.push(categoryId);
    const allOverrides = {
        ...(llmSettingsState?.settings?.viewCategoryOverrides || {}),
        [targetViewId]: override
    };
    return updateLlmPreferencesCore({ viewCategoryOverrides: allOverrides });
}

function applyPreparedComposition(prepared, document) {
    preparedDocumentState = { ...prepared, document };
    currentArticleDocument = document;
    selectedStudyTypeOverride = prepared.studyProfile?.primaryType || '';
    prepareState = 'prepared';
    syncPreparedSelection();
    renderStudyTypeChooser();
    renderCategories();
    updateApplyButton();
}

function queueReadingViewMutation(targetViewId) {
    const intent = preferenceMutationCoordinator.beginIntent();
    readingViewId = targetViewId;
    updateReadingViewControl();
    return runSavedMutation({
        coordinator: preferenceMutationCoordinator,
        intent,
        save: () => updateLlmPreferencesCore({ readingViewId: targetViewId }),
        onSaved: (saved, { isCurrent }) => {
            reconcilePersistedLlmControls(saved, isCurrent);
            persistedReadingViewId = saved.settings.readingViewId || targetViewId;
            invalidatePreparedComposition();
            if (isCurrent()) {
                updateReadingViewControl();
                renderCategories();
                updateApplyButton();
            }
        },
        refresh: (_saved, { isCurrent }) => refreshPreparedComposition({
            isCurrent,
            expectedViewId: targetViewId
        }),
        onSaveFailed: () => {
            readingViewId = persistedReadingViewId;
            updateReadingViewControl();
            syncPreparedSelection();
            renderCategories();
            updateApplyButton();
            showStatus('切换阅读视图失败，已恢复原选择', 'error');
        },
        onRefreshFailed: error => {
            renderCategories();
            updateApplyButton();
            showStatus(`阅读视图已保存，但正文组合刷新失败：${error.message}`, 'error');
        }
    }).then(result => {
        if (result.status === 'refreshed') {
            const viewName = llmSettingsState?.readingViews?.[targetViewId]?.name || targetViewId;
            showStatus(`已切换到${viewName}`, 'success');
        }
        return result;
    });
}

function queueCategorySelectionMutation(categoryId, checked, targetViewId) {
    const intent = preferenceMutationCoordinator.beginIntent();
    return runSavedMutation({
        coordinator: preferenceMutationCoordinator,
        intent,
        save: () => updateViewCategorySelection(categoryId, checked, targetViewId),
        onSaved: (saved, { isCurrent }) => {
            reconcilePersistedLlmControls(saved, isCurrent);
            invalidatePreparedComposition();
            if (isCurrent()) {
                renderCategories();
                updateApplyButton();
            }
        },
        refresh: (_saved, { isCurrent }) => refreshPreparedComposition({
            isCurrent,
            expectedViewId: targetViewId
        }),
        onSaveFailed: () => {
            syncPreparedSelection();
            renderCategories();
            updateApplyButton();
            showStatus('保存分类失败，已恢复原选择', 'error');
        },
        onRefreshFailed: error => {
            renderCategories();
            updateApplyButton();
            showStatus(`分类已保存，但正文组合刷新失败：${error.message}`, 'error');
        }
    });
}

function queueRestoreViewPreset(targetViewId) {
    const intent = preferenceMutationCoordinator.beginIntent();
    return runSavedMutation({
        coordinator: preferenceMutationCoordinator,
        intent,
        save: () => {
            const allOverrides = {
                ...(llmSettingsState?.settings?.viewCategoryOverrides || {}),
                [targetViewId]: { add: [], remove: [] }
            };
            return updateLlmPreferencesCore({ viewCategoryOverrides: allOverrides });
        },
        onSaved: (saved, { isCurrent }) => {
            reconcilePersistedLlmControls(saved, isCurrent);
            invalidatePreparedComposition();
            if (isCurrent()) {
                renderCategories();
                updateApplyButton();
            }
        },
        refresh: (_saved, { isCurrent }) => refreshPreparedComposition({
            isCurrent,
            expectedViewId: targetViewId
        }),
        onSaveFailed: () => {
            syncPreparedSelection();
            renderCategories();
            updateApplyButton();
            showStatus('恢复预设失败，已保留原分类选择', 'error');
        },
        onRefreshFailed: error => {
            renderCategories();
            updateApplyButton();
            showStatus(`预设已保存，但正文组合刷新失败：${error.message}`, 'error');
        }
    });
}

function reconcilePersistedLlmControls(saved, isCurrent) {
    const savedSettings = saved?.settings || {};
    persistedAnalysisMode = savedSettings.mode || persistedAnalysisMode;
    const savedConfidence = Number(savedSettings.confidenceThreshold);
    if (Number.isFinite(savedConfidence)) {
        persistedConfidenceThreshold = savedConfidence;
    }
    if (!isCurrent()) return;
    analysisMode = persistedAnalysisMode;
    confidenceThreshold = persistedConfidenceThreshold;
    const modeRadio = document.querySelector(
        `input[name="analysisMode"][value="${analysisMode}"]`
    );
    if (modeRadio) modeRadio.checked = true;
    matchCounts = {};
    updateAnalysisModeUi();
    renderCategories();
}

function queueAnalysisModeMutation(targetMode) {
    regexApplySequence += 1;
    const intent = preferenceMutationCoordinator.beginIntent();
    analysisMode = targetMode;
    const modeRadio = document.querySelector(
        `input[name="analysisMode"][value="${targetMode}"]`
    );
    if (modeRadio) modeRadio.checked = true;
    matchCounts = {};
    updateAnalysisModeUi();
    renderCategories();

    return runSavedMutation({
        coordinator: preferenceMutationCoordinator,
        intent,
        save: () => updateLlmPreferencesCore({ mode: targetMode }),
        onSaved: (saved, { isCurrent }) => {
            reconcilePersistedLlmControls(saved, isCurrent);
            if (isCurrent() && saved.settings.mode === 'llm') {
                invalidatePreparedComposition();
            }
        },
        refresh: async (saved, { isCurrent }) => {
            if (saved.settings.mode !== 'llm' || saved.effectiveMode !== 'llm') {
                prepareState = 'idle';
                stopFigureProgressPolling();
                stopReviewOutlineProgressPolling();
                requestMatchCounts();
                return { prepared: false };
            }
            return prepareCurrentArticleCore({
                isCurrent,
                expectedViewId: readingViewId
            });
        },
        onSaveFailed: () => {
            analysisMode = persistedAnalysisMode;
            confidenceThreshold = persistedConfidenceThreshold;
            const rollbackRadio = document.querySelector(
                `input[name="analysisMode"][value="${analysisMode}"]`
            );
            if (rollbackRadio) rollbackRadio.checked = true;
            updateAnalysisModeUi();
            renderCategories();
            showStatus('无法切换识别模式，已恢复原设置', 'error');
        },
        onRefreshFailed: error => {
            prepareState = 'idle';
            renderStudyTypeChooser();
            updateApplyButton();
            showStatus(`识别模式已保存，但正文准备失败：${error.message}`, 'error');
        }
    }).then(async result => {
        if (!preferenceMutationCoordinator.isCurrent(intent)) return result;
        if (analysisMode === 'llm' && result.status === 'refreshed') {
            await refreshLlmDiagnostics();
            await restoreFigureAnalysisProgress();
            await restoreReviewOutlineProgress();
        }
        return result;
    });
}

function queueConfidenceThresholdMutation(targetThreshold) {
    const intent = preferenceMutationCoordinator.beginIntent();
    confidenceThreshold = targetThreshold;
    renderConfidenceControl();

    return runSavedMutation({
        coordinator: preferenceMutationCoordinator,
        intent,
        save: () => updateLlmPreferencesCore({
            confidenceThreshold: targetThreshold
        }),
        onSaved: (saved, { isCurrent }) => {
            reconcilePersistedLlmControls(saved, isCurrent);
        },
        refresh: async (saved, { isCurrent }) => {
            if (saved.settings.mode === 'llm' && saved.effectiveMode === 'llm') {
                await prepareCurrentArticleCore({
                    isCurrent,
                    expectedViewId: readingViewId
                });
            }
            if (!isCurrent()) return { applied: false, reason: 'superseded' };
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab?.id) throw new Error('无法获取当前论文页面');
            const response = await sendTabMessage(tab.id, {
                action: 'applyLlmConfidenceThreshold',
                threshold: targetThreshold
            });
            if (isCurrent() && response?.applied) {
                matchCounts = response.counts || matchCounts;
                renderCategories();
            }
            return response;
        },
        onSaveFailed: () => {
            confidenceThreshold = persistedConfidenceThreshold;
            analysisMode = persistedAnalysisMode;
            const rollbackRadio = document.querySelector(
                `input[name="analysisMode"][value="${analysisMode}"]`
            );
            if (rollbackRadio) rollbackRadio.checked = true;
            updateAnalysisModeUi();
            renderCategories();
            showStatus('置信度保存失败，已恢复原设置', 'error');
        },
        onRefreshFailed: () => {
            renderConfidenceControl();
            showStatus('置信度已保存；刷新论文页面后重新分析即可应用', 'success');
        }
    }).then(async result => {
        if (!preferenceMutationCoordinator.isCurrent(intent)) return result;
        if (result.status === 'refreshed') {
            await refreshLlmDiagnostics();
            showStatus(
                `最低置信度已设为 ${Math.round(confidenceThreshold * 100)}%`,
                'success'
            );
        }
        return result;
    });
}

async function prepareArticleForAdaptiveAnalysis(tabId, {
    isCurrent = () => true,
    expectedViewId = readingViewId,
    forceRefresh = false
} = {}) {
    prepareState = 'preparing';
    renderStudyTypeChooser();
    updateApplyButton();
    const extracted = await sendTabMessage(tabId, {
        action: 'extractArticleForLLM',
        forceRefresh
    });
    if (!extracted?.success || !extracted.document?.paragraphs?.length) {
        throw new Error(extracted?.error || '未提取到论文正文');
    }
    if (!isCurrent()) return { stale: true };
    currentArticleDocument = extracted.document;
    const prepared = await sendLlmMessage({
        type: 'LLM_PREPARE_DOCUMENT',
        document: {
            title: extracted.document.title,
            paragraphs: extracted.document.paragraphs
        }
    });
    if (!shouldApplyPreparedResult({
        isCurrent: isCurrent(),
        expectedDocumentHash: null,
        expectedViewId,
        prepared
    })) {
        return { ...prepared, stale: true };
    }
    applyPreparedComposition(prepared, extracted.document);
    if (!isCurrent()) return { ...prepared, stale: true };
    await refreshManualAnnotationSummary(tabId);
    if (!isCurrent()) return { ...prepared, stale: true };
    return prepared;
}

async function prepareCurrentArticleCore({
    isCurrent = () => true,
    expectedViewId = readingViewId,
    forceRefresh = false
} = {}) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('无法获取当前论文页面');
    return prepareArticleForAdaptiveAnalysis(tab.id, {
        isCurrent,
        expectedViewId,
        forceRefresh
    });
}

async function prepareCurrentArticleForTypeChoice({
    throwOnError = false,
    forceRefresh = false
} = {}) {
    if (analysisMode !== 'llm' || llmSettingsState?.effectiveMode !== 'llm' ||
        prepareState === 'preparing' || prepareState === 'analyzing') return null;
    const intent = preferenceMutationCoordinator.beginIntent();
    const expectedViewId = readingViewId;
    lastArticlePreparationError = null;
    try {
        const prepared = await preferenceMutationCoordinator.enqueue(
            intent,
            ({ isCurrent }) => prepareCurrentArticleCore({
                isCurrent,
                expectedViewId,
                forceRefresh
            })
        );
        if (!prepared.stale && prepared.requiresStudyType) {
            showStatus('正文已准备，请先选择文献类型', 'success');
        }
        return prepared;
    } catch (error) {
        lastArticlePreparationError = error;
        if (preferenceMutationCoordinator.isCurrent(intent)) {
            prepareState = 'idle';
            renderStudyTypeChooser();
            updateApplyButton();
            showStatus(`正文准备失败：${error.message}`, 'error');
        }
        if (throwOnError) throw error;
        return null;
    }
}

async function refreshPreparedComposition({
    isCurrent = () => true,
    expectedViewId = readingViewId
} = {}) {
    const document = currentArticleDocument || preparedDocumentState?.document;
    if (!document) {
        syncPreparedSelection();
        renderCategories();
        return { applied: false, reason: 'document_unavailable' };
    }
    const expectedDocumentHash = preparedDocumentState?.documentHash || null;
    const prepared = await sendLlmMessage({
        type: 'LLM_PREPARE_DOCUMENT',
        document: {
            title: document.title,
            paragraphs: document.paragraphs
        }
    });
    const applies = shouldApplyPreparedResult({
        isCurrent: isCurrent(),
        expectedDocumentHash,
        expectedViewId,
        prepared
    });
    if (!applies) {
        if (!isCurrent()) return { applied: false, reason: 'superseded' };
        throw new Error('返回的正文组合与当前文献或阅读视图不一致');
    }
    applyPreparedComposition(prepared, document);
    return { applied: true, prepared };
}

function renderConfidenceControl() {
    const slider = document.getElementById('confidenceThreshold');
    slider.value = String(confidenceThreshold);
    document.getElementById('confidenceValue').textContent =
        `${Math.round(confidenceThreshold * 100)}%`;
}

function renderSettingsRouteSummary() {
    const target = document.getElementById('settingsRouteSummary');
    if (!target) return;
    target.replaceChildren();
    getPublicRouteSummaryRows(llmSettingsState?.settings).forEach(([label, value]) => {
        const row = createWorkspaceElement('div', 'settings-route-row');
        row.append(
            createWorkspaceElement('span', '', label),
            createWorkspaceElement('strong', '', value)
        );
        target.appendChild(row);
    });
}

function updateAnalysisModeUi() {
    const isLlm = analysisMode === 'llm';
    document.getElementById('spanModeSection').hidden = isLlm;
    document.getElementById('llmAdaptiveControls').hidden = !isLlm;
    document.getElementById('restoreViewPreset').hidden = !isLlm;
    document.getElementById('llmDiagnostics').hidden = !isLlm;
    document.getElementById('confidenceControl').hidden = !isLlm;
    updateReadingViewControl();
    renderStudyTypeChooser();
    updateApplyButton();
    updateFigureButton();
    updateReviewOutlineButton();
    renderConfidenceControl();
    renderSettingsRouteSummary();
}

async function refreshLlmDiagnostics() {
    const element = document.getElementById('llmDiagnostics');
    if (analysisMode !== 'llm') {
        element.hidden = true;
        return;
    }
    element.hidden = false;
    element.textContent = '正在读取当前页面的正文提取诊断…';
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const response = await sendTabMessage(tab.id, { action: 'getLlmDiagnostics' });
        if (!response?.success) throw new Error(response?.error || '诊断不可用');
        const diagnostics = response.diagnostics || {};
        const extraction = diagnostics.extraction || {};
        const selected = extraction.selected || {};
        const parts = [
            `提取器 ${extraction.version || '未知'}`,
            `候选区 ${extraction.candidateCount ?? 0}`,
            `已选 ${extraction.selectedRoot || '未知'}`,
            `正文 ${selected.paragraphCount ?? 0} 段`,
            '图注不参与分析',
            `共 ${selected.characterCount ?? 0} 字符`
        ];
        const unrecognized = Array.isArray(extraction.unrecognizedTextBlocks)
            ? extraction.unrecognizedTextBlocks
            : [];
        if (unrecognized.length) {
            const patterns = unrecognized.slice(0, 4)
                .map(item => `${item.root}×${item.count}/${item.characterCount}字`)
                .join('；');
            parts.push(
                `未识别长文本 ${extraction.unrecognizedTextBlockCount ?? 0} 块/` +
                `${extraction.unrecognizedCharacterCount ?? 0} 字：${patterns}`
            );
        }
        if (diagnostics.studyProfile) {
            const profile = diagnostics.studyProfile;
            const primaryName = llmSettingsState?.studyTypes?.[profile.primaryType]?.name ||
                profile.primaryType;
            parts.push(`类型 ${primaryName}（用户选择）`);
            parts.push(`视图 ${llmSettingsState?.readingViews?.[diagnostics.readingViewId]?.name || diagnostics.readingViewId}`);
            parts.push('类型已选择');
        }
        if (Number.isInteger(diagnostics.annotationCount)) {
            parts.push(`模型返回 ${diagnostics.annotationCount} 条`);
            parts.push(`成功应用 ${diagnostics.highlightedCount ?? 0} 条`);
            parts.push(`定位拒绝 ${diagnostics.rejectedCount ?? 0} 条`);
            parts.push(`阈值 ${Math.round((diagnostics.confidenceThreshold || 0.8) * 100)}%`);
            parts.push(`低于阈值隐藏 ${diagnostics.hiddenConfidenceCount || 0} 条`);
            parts.push(`语义拒绝 ${diagnostics.semanticRejectedCount || 0} 条`);
            parts.push(diagnostics.ledgerAvailable === false ? '台账复核不可用' :
                `台账关系 ${diagnostics.relationCount || 0} 条/审读 ${diagnostics.auditItemCount || 0} 条`);
        }
        element.textContent = parts.join('｜');
    } catch (error) {
        element.textContent = '提取诊断不可用，请刷新论文页面后重新打开插件。';
    }
}

// 渲染类别列表
function getLlmCategoryEntries() {
    return getCategoryEntriesForEngine('llm');
}

function openCategoryRuleEditor(categoryId) {
    const url = chrome.runtime.getURL('options.html#category=' +
        encodeURIComponent(categoryId));
    return chrome.tabs.create({ url }).catch(error => {
        showStatus(`无法打开分类规则设置：${error.message}`, 'error');
        return null;
    });
}

function createCategoryItem(key, rule, { checked, idSuffix = '' } = {}) {
        const item = document.createElement('div');
        item.className = analysisMode === 'llm'
            ? 'category-item category-item-compact'
            : 'category-item';
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = `cat-${key}${idSuffix}`;
        checkbox.checked = Boolean(checked);
        checkbox.setAttribute('aria-label', `${checkbox.checked ? '停用' : '启用'}${rule.name}`);
        checkbox.addEventListener('change', async (e) => {
            if (analysisMode === 'llm') {
                const targetViewId = readingViewId;
                try {
                    await queueCategorySelectionMutation(
                        key,
                        e.target.checked,
                        targetViewId
                    );
                } catch (error) {
                    syncPreparedSelection();
                    renderCategories();
                    showStatus(`保存分类失败，已恢复原选择：${error.message}`, 'error');
                }
            } else {
                const previous = new Set(selectedCategories);
                if (e.target.checked) selectedCategories.add(key);
                else selectedCategories.delete(key);
                try {
                    await saveSettings();
                    updateApplyButton();
                } catch (error) {
                    selectedCategories = previous;
                    renderCategories();
                    showStatus(`保存正则分类失败，已恢复原选择：${error.message}`, 'error');
                }
            }
        });

        const colorDiv = document.createElement('div');
        colorDiv.className = 'category-color';
        colorDiv.style.backgroundColor = rule.color;
        
        const infoDiv = document.createElement('div');
        infoDiv.className = 'category-info';
        
        const nameDiv = document.createElement('div');
        nameDiv.className = 'category-name';
        nameDiv.textContent = rule.name;
        
        // 显示匹配计数
        if (matchCounts[key] !== undefined && matchCounts[key] > 0) {
            const matchBadge = document.createElement('span');
            matchBadge.className = 'match-count';
            matchBadge.textContent = matchCounts[key];
            nameDiv.appendChild(matchBadge);
        }
        
        const countDiv = document.createElement('div');
        countDiv.className = 'category-count';
        if (analysisMode === 'llm') {
            const sourceLabels = {
                view_default: '视图预设',
                primary_type: '主要类型',
                manual: '用户添加'
            };
            const source = sourceLabels[getPreparedCategorySource(key)] ||
                ((getReadingViewDefinition().categoryIds || []).includes(key)
                    ? '视图预设' : '可选类别');
            countDiv.textContent = rule.persistence === 'one-off'
                ? `${source} · 仅本次会话`
                : `${source} · LLM 语义识别`;
        } else {
            countDiv.textContent = rule.persistence === 'one-off'
                ? '正则规则 · 仅本次会话'
                : '正则规则 · 可在设置中编辑';
        }
        
        infoDiv.appendChild(nameDiv);
        infoDiv.appendChild(countDiv);
        
        // 操作按钮
        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'category-actions';
        
        const editBtn = document.createElement('button');
        editBtn.className = 'category-rule-button';
        editBtn.textContent = '查看/编辑规则';
        editBtn.addEventListener('click', event => {
            event.stopPropagation();
            openCategoryRuleEditor(key);
        });
        
        actionsDiv.appendChild(editBtn);

        item.appendChild(checkbox);
        item.appendChild(colorDiv);
        item.appendChild(infoDiv);
        item.appendChild(actionsDiv);
        return item;
}

function renderMoreCategoryGroups(entries, activeCategoryIds) {
    const panel = document.getElementById('moreCategoriesPanel');
    const container = document.getElementById('moreCategoryGroups');
    container.innerHTML = '';
    if (panel.hidden) return;
    const groups = getMoreCategoryGroups({
        readingViews: llmSettingsState?.readingViews || {},
        activeCategoryIds,
        entries,
        searchTerm: document.getElementById('categorySearch').value
    });
    groups.forEach(group => {
        const section = document.createElement('section');
        section.className = 'more-category-group';
        const heading = document.createElement('h4');
        heading.textContent = group.name;
        section.appendChild(heading);
        group.entries.forEach(([key, rule], index) => {
            section.appendChild(createCategoryItem(key, rule, {
                checked: false,
                idSuffix: `-more-${group.viewId}-${index}`
            }));
        });
        container.appendChild(section);
    });
    if (!groups.length) {
        const empty = document.createElement('div');
        empty.className = 'more-categories-empty';
        empty.textContent = '没有匹配的其他分类';
        container.appendChild(empty);
    }
}

function renderCategories() {
    const container = document.getElementById('categoriesContainer');
    const moreButton = document.getElementById('moreCategories');
    const morePanel = document.getElementById('moreCategoriesPanel');
    container.innerHTML = '';

    if (analysisMode === 'llm') {
        const entries = getLlmCategoryEntries();
        const currentEntries = getCurrentViewCategoryEntries({
            entries,
            preparedState: preparedDocumentState,
            configuredCategoryIds: [...getConfiguredViewSelection()]
        });
        currentEntries.forEach(([key, rule]) => {
            container.appendChild(createCategoryItem(key, rule, { checked: true }));
        });
        moreButton.hidden = false;
        const activeCategoryIds = currentEntries.map(([categoryId]) => categoryId);
        renderMoreCategoryGroups(entries, activeCategoryIds);
    } else {
        moreButton.hidden = true;
        moreButton.setAttribute('aria-expanded', 'false');
        morePanel.hidden = true;
        document.getElementById('moreCategoryGroups').innerHTML = '';
        getCategoryEntriesForEngine('regex').forEach(([key, rule]) => {
            container.appendChild(createCategoryItem(key, rule, {
                checked: selectedCategories.has(key)
            }));
        });
    }
    
    // 更新总匹配数
    updateTotalMatchCount();
}

// 更新总匹配数
function updateTotalMatchCount() {
    const totalCount = Object.values(matchCounts).reduce((sum, count) => sum + count, 0);
    const badge = document.getElementById('totalMatchCount');
    if (totalCount > 0) {
        badge.textContent = `共 ${totalCount} 处匹配`;
        badge.style.display = 'inline-block';
    } else {
        badge.style.display = 'none';
    }
}

// 请求匹配计数
async function requestMatchCounts() {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id || analysisMode !== 'regex') return;
        const rules = await fetchCurrentRegexRules(tab.id);
        const response = await sendTabMessage(tab.id, {
            action: 'getMatchCounts',
            rules
        });
        
        if (response && response.counts) {
            matchCounts = response.counts;
            renderCategories();
        }
    } catch (error) {
        console.log('无法获取匹配计数:', error);
    }
}

async function fetchCurrentRegexRules(tabId) {
    const requestId = ++regexApplySequence;
    const selectedIds = getCategoryEntriesForEngine('regex')
        .map(([categoryId]) => categoryId)
        .filter(categoryId => selectedCategories.has(categoryId));
    const revision = Number(llmSettingsState?.settings?.userDataCategoryRevision) || 0;
    const documentId = manualAnnotationState.tabId === tabId
        ? manualAnnotationState.documentId : '';
    const resolved = await resolveRegexDetailsAtomically({
        categoryIds: selectedIds,
        fetchDetail: categoryId => sendLlmMessage({
            type: 'CATEGORY_GET',
            categoryId
        }),
        refreshState: () => sendLlmMessage({ type: 'LLM_GET_SETTINGS' }),
        validate: async refreshed => {
            const [currentTab] = await chrome.tabs.query({
                active: true,
                currentWindow: true
            });
            const currentRevision =
                Number(refreshed?.settings?.userDataCategoryRevision) || 0;
            const currentDocumentId = manualAnnotationState.tabId === currentTab?.id
                ? manualAnnotationState.documentId : '';
            return analysisMode === 'regex' && shouldApplyRegexSnapshot({
                requestId,
                currentRequestId: regexApplySequence,
                tabId,
                currentTabId: currentTab?.id,
                documentId,
                currentDocumentId,
                revision,
                currentRevision,
                selectedIds,
                currentSelectedIds: [...selectedCategories]
            });
        }
    });
    llmSettingsState = resolved.state;
    return translateUnifiedRegexCategories(resolved.details);
}

async function applyRegexOnTab(tabId) {
    const categories = await fetchCurrentRegexRules(tabId);
    return sendTabMessage(tabId, {
        action: 'applyHighlight',
        categories,
        mode: highlightMode
    });
}

async function sendTabMessage(tabId, message) {
    if (!activePanelTabContext.activated ||
        Number(tabId) !== Number(activePanelTabContext.tabId)) {
        const error = new Error('当前标签页尚未激活，请先点击扩展图标');
        error.code = 'PANEL_TAB_NOT_ACTIVATED';
        throw error;
    }
    return SciLLM.sendTabMessageWithRecovery(chrome, tabId, message);
}

async function runFigureAnalysis() {
    if (llmSettingsState?.effectiveMode !== 'llm') {
        showStatus('请先配置可用的 LLM API 并同意发送 Figure 内容', 'error');
        return;
    }
    let tab = null;
    let taskToken = null;
    try {
        [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) throw new Error('无法获取当前论文页面');
        taskToken = figureTaskGeneration;
        if (!isCurrentFigureTask(taskToken, tab.id)) return;
        figureAnalysisState = {
            running: true,
            paused: false,
            phase: 'extracting',
            currentFigure: 0,
            totalFigures: 0,
            completedFigures: 0,
            failedFigures: 0,
            figureLabel: '',
            message: '正在读取论文中的 Figure…'
        };
        updateFigureButton();
        showStatus('正在读取论文中的 Figure…', 'success');
        startFigureProgressPolling(tab.id);
        const response = await sendTabMessage(tab.id, {
            action: 'analyzeFiguresWithLLM',
            analysisDepth: 'standard'
        });
        if (!isCurrentFigureTask(taskToken, tab.id)) return;
        if (response?.cancelled || response?.code === 'CANCELLED') {
            const error = new Error('图解已取消，已完成结果会保留');
            error.code = 'CANCELLED';
            throw error;
        }
        if (!response?.success) {
            const error = new Error(response?.error || '逐图解读失败');
            error.code = response?.code;
            throw error;
        }
        const failedCount = Number(response.failedCount) || 0;
        const analyzedCount = Number(response.analyzedCount) || 0;
        const totalCount = Number(response.totalCount) || analyzedCount + failedCount;
        const routeStatus = response.route
            ? formatEffectiveRoute('逐图解读完成', response.route) : '';
        const details = [];
        if (response.cacheHits) details.push(response.cacheHits + ' 张来自缓存');
        if (response.visionFallbacks) {
            details.push(response.visionFallbacks + ' 张仅使用图注与正文');
        }
        if (failedCount > 0) {
            showStatus(
                `逐图解读完成 ${analyzedCount}/${totalCount} 张，${failedCount} 张失败；` +
                '成功结果已保留，重试时会复用缓存' +
                (details.length ? '（' + details.join('，') + '）' : ''),
                'error'
            );
        } else {
            showStatus(
                '逐图解读完成：' + analyzedCount + ' 张 Figure' +
                (details.length ? '（' + details.join('，') + '）' : ''),
                'success'
            );
        }
        if (routeStatus) showStatus(routeStatus, failedCount > 0 ? 'error' : 'success');
        figureAnalysisState = {
            ...figureAnalysisState,
            running: false,
            phase: failedCount > 0 ? 'partial' : 'completed',
            currentFigure: totalCount,
            totalFigures: totalCount,
            completedFigures: analyzedCount,
            failedFigures: failedCount,
            message: failedCount > 0
                ? `完成 ${analyzedCount}/${totalCount} 张，${failedCount} 张失败`
                : `完成 ${analyzedCount}/${totalCount} 张`
        };
    } catch (error) {
        if (!isCurrentFigureTask(taskToken, tab?.id)) return;
        const progress = tab?.id
            ? await refreshFigureAnalysisProgress(tab.id, false)
            : figureAnalysisState;
        const progressText = progress?.totalFigures
            ? `（已完成 ${progress.completedFigures || 0}/${progress.totalFigures} 张` +
                (progress.failedFigures ? `，失败 ${progress.failedFigures} 张` : '') + '）'
            : '';
        if (error?.code === 'CANCELLED' || figureAnalysisState.phase === 'cancelled') {
            showStatus('Figure 解读已取消，已完成结果会保留' + progressText, 'success');
        } else {
            showStatus('逐图解读失败' + progressText + '：' + error.message, 'error');
        }
    } finally {
        if (!isCurrentFigureTask(taskToken, tab?.id)) return;
        stopFigureProgressPolling();
        figureAnalysisState = { ...figureAnalysisState, running: false };
        updateFigureButton();
        switchWorkspaceView('figures');
        await refreshArticleWorkspace();
        await persistCurrentArticleArchive().catch(() => null);
    }
}

async function showFigureOriginalImage(figureId) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('无法获取当前论文页面');
    const response = await sendTabMessage(tab.id, {
        action: 'showFigureOriginalImage', figureId
    });
    if (!response?.success) {
        throw new Error(response?.code === 'IMAGE_NOT_FOUND'
            ? '未找到该 Figure 的高清原图' : '无法打开该 Figure 原图');
    }
}

async function runFigurePanelFollowup(figureId, panelId, topics, customQuestion = '') {
    if (llmSettingsState?.effectiveMode !== 'llm') {
        throw new Error('请先配置可用的 LLM API');
    }
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !isCurrentFigureTask(figureTaskGeneration, tab.id)) {
        throw new Error('当前论文页面已切换，请返回后重试');
    }
    showStatus(`正在追问 ${figureId} · Panel ${panelId}…`, 'success');
    const response = await sendTabMessage(tab.id, {
        action: 'askFigurePanelWithLLM', figureId, panelId, topics, customQuestion
    });
    if (!response?.success) {
        const error = new Error(response?.error || 'FIGURE_PANEL_FOLLOWUP_FAILED');
        error.code = response?.code;
        throw error;
    }
    panelFollowupDraftState.delete(panelWorkspaceKey(figureId, panelId));
    await refreshArticleWorkspace();
    await persistCurrentArticleArchive().catch(() => null);
    showStatus(`已完成 ${figureId} · Panel ${panelId} 的定向追问`, 'success');
    return response;
}

async function runSingleFigureAnalysis(figureId) {
    if (llmSettingsState?.effectiveMode !== 'llm') {
        showStatus('\u8bf7\u5148\u914d\u7f6e\u53ef\u7528\u7684 LLM API', 'error');
        return;
    }
    const taskToken = figureTaskGeneration;
    let tab = null;
    try {
        [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) throw new Error('ACTIVE_TAB_NOT_FOUND');
        if (!isCurrentFigureTask(taskToken, tab.id)) return;
        startFigureProgressPolling(tab.id, { waitForSnapshot: true });
        showStatus(`\u6b63\u5728\u7cbe\u8bfb ${figureId}\u2026`, 'success');
        const response = await sendTabMessage(tab.id, {
            action: 'analyzeSingleFigureWithLLM', figureId, forceRefresh: true
        });
        if (!isCurrentFigureTask(taskToken, tab.id)) return;
        if (!response?.success) {
            const error = new Error(response?.error || 'FIGURE_ANALYSIS_FAILED');
            error.code = response?.code;
            throw error;
        }
        showStatus(`\u5df2\u5b8c\u6210 ${figureId} \u7684\u5355\u56fe\u7cbe\u8bfb`, 'success');
    } catch (error) {
        if (!isCurrentFigureTask(taskToken, tab?.id)) return;
        showStatus(error?.code === 'CANCELLED'
            ? '单图精读已取消，已有结果会保留。'
            : '\u5355\u56fe\u7cbe\u8bfb\u5931\u8d25\uff1a' + error.message,
        error?.code === 'CANCELLED' ? 'success' : 'error');
    } finally {
        if (!isCurrentFigureTask(taskToken, tab?.id)) return;
        const progress = tab?.id
            ? await refreshFigureAnalysisProgress(tab.id, false, taskToken)
            : null;
        if (!hasRunningFigureProgress(progress)) stopFigureProgressPolling();
        renderFigureWorkspaceSnapshot(currentWorkspaceSnapshot);
        await refreshArticleWorkspace();
        await persistCurrentArticleArchive().catch(() => null);
    }
}

async function runSingleFigurePanelAnalysis(figureId, panelId) {
    if (llmSettingsState?.effectiveMode !== 'llm') {
        showStatus('请先配置可用的 LLM API', 'error');
        return;
    }
    const taskToken = figureTaskGeneration;
    let tab = null;
    try {
        [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) throw new Error('ACTIVE_TAB_NOT_FOUND');
        if (!isCurrentFigureTask(taskToken, tab.id)) return;
        figureExpansionState.set(figureId, true);
        figurePanelExpansionState.set(panelWorkspaceKey(figureId, panelId), true);
        startFigureProgressPolling(tab.id, { waitForSnapshot: true });
        showStatus(`正在解读 ${figureId} · Panel ${panelId}…`, 'success');
        const response = await sendTabMessage(tab.id, {
            action: 'analyzeSingleFigurePanelWithLLM',
            figureId,
            panelId,
            forceRefresh: true
        });
        if (!isCurrentFigureTask(taskToken, tab.id)) return;
        if (!response?.success) {
            const error = new Error(response?.error || 'FIGURE_PANEL_ANALYSIS_FAILED');
            error.code = response?.code;
            throw error;
        }
        showStatus(formatEffectiveRoute(
            `${figureId} · Panel ${panelId} 解读完成`, response.route
        ), 'success');
    } catch (error) {
        if (!isCurrentFigureTask(taskToken, tab?.id)) return;
        showStatus(error?.code === 'CANCELLED'
            ? 'Panel 解读已取消，已有结果会保留。'
            : `Panel 解读失败：${error.message}`,
        error?.code === 'CANCELLED' ? 'success' : 'error');
    } finally {
        if (!isCurrentFigureTask(taskToken, tab?.id)) return;
        const progress = tab?.id
            ? await refreshFigureAnalysisProgress(tab.id, false, taskToken)
            : null;
        if (!hasRunningFigureProgress(progress)) stopFigureProgressPolling();
        await refreshArticleWorkspace();
        await persistCurrentArticleArchive().catch(() => null);
    }
}

async function runCrossFigureLogic() {
    if (llmSettingsState?.effectiveMode !== 'llm') {
        showStatus('请先配置可用的 LLM API 并同意发送 Figure 内容', 'error');
        return;
    }
    let tab = null;
    let taskToken = null;
    try {
        [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) throw new Error('ACTIVE_TAB_NOT_FOUND');
        taskToken = figureTaskGeneration;
        if (!isCurrentFigureTask(taskToken, tab.id)) return;
        crossFigureLogicRunning = true;
        updateFigureButton();
        showStatus('正在串联主图之间的多米诺逻辑…', 'success');
        const response = await sendTabMessage(tab.id, {
            action: 'analyzeCrossFigureLogicWithLLM'
        });
        if (!isCurrentFigureTask(taskToken, tab.id)) return;
        if (!response?.success) {
            const error = new Error(response?.error || 'CROSS_FIGURE_LOGIC_FAILED');
            error.code = response?.code;
            throw error;
        }
        const result = response.result || {};
        const nodes = Array.isArray(result.nodes) ? result.nodes.length : 0;
        const links = Array.isArray(result.dominoChain) ? result.dominoChain.length : 0;
        showStatus(
            `主图多米诺总链已生成：${nodes} 个主图节点、${links} 条跨图连接` +
            (result.cacheHit ? '（已复用缓存）' : ''),
            'success'
        );
        switchWorkspaceView('figures');
    } catch (error) {
        if (!isCurrentFigureTask(taskToken, tab?.id)) return;
        showStatus('主图多米诺总链生成失败：' + error.message, 'error');
    } finally {
        if (!isCurrentFigureTask(taskToken, tab?.id)) return;
        crossFigureLogicRunning = false;
        updateFigureButton();
        await refreshArticleWorkspace();
        await persistCurrentArticleArchive().catch(() => null);
    }
}

async function runReviewOutlineAnalysis({ forceRefresh = false } = {}) {
    const panelContext = capturePanelContext(reviewOutlineTaskGeneration);
    if (!isCurrentReviewOutlineTask(panelContext)) return;
    if (llmSettingsState?.effectiveMode !== 'llm') {
        showStatus('请先配置可用的 LLM API 并同意发送正文', 'error');
        return;
    }
    const tabId = panelContext.tabId;
    try {
        if (!preparedDocumentState) {
            await prepareArticleForAdaptiveAnalysis(tabId, {
                isCurrent: () => isCurrentReviewOutlineTask(panelContext)
            });
            if (!isCurrentReviewOutlineTask(panelContext)) return;
        }
        if (!isCurrentReviewOutlineTask(panelContext)) return;
        const profileIsReview = preparedDocumentState?.studyProfile?.reviewSubtype !== 'not_review';
        showStatus(
            profileIsReview
                ? '正在生成综述逐段摘要…'
                : '当前类型不是综述，仍将按正文结构生成大纲…',
            profileIsReview ? 'success' : 'error'
        );
        reviewOutlineState = {
            ...reviewOutlineState,
            running: true,
            phase: 'extracting',
            completedParagraphs: 0,
            totalParagraphs: preparedDocumentState?.document?.paragraphs?.length || 0,
            message: '正在提取正文层级…'
        };
        updateReviewOutlineButton();
        startReviewOutlineProgressPolling(tabId, panelContext);
        const response = await sendTabMessage(panelContext.tabId, {
            action: 'analyzeReviewOutlineWithLLM',
            forceRefresh,
            documentId: preparedDocumentState.documentId,
            documentHash: preparedDocumentState.documentHash
        });
        if (!isCurrentReviewOutlineTask(panelContext)) return;
        if (!response?.success) {
            const error = new Error(response?.error || '综述大纲生成失败');
            error.code = response?.code;
            throw error;
        }
        reviewOutlineState = {
            ...reviewOutlineState,
            running: false,
            phase: 'completed',
            completedParagraphs: response.outline?.paragraphCount ||
                reviewOutlineState.totalParagraphs,
            hasOutline: true,
            globalSynthesisAvailable: response.outline?.globalSynthesisAvailable
        };
        switchWorkspaceView('navigation');
        await refreshArticleWorkspace({ panelContext });
        if (!isCurrentReviewOutlineTask(panelContext)) return;
        await persistCurrentArticleArchive({ panelContext }).catch(() => null);
        if (!isCurrentReviewOutlineTask(panelContext)) return;
        const notice = response.nonReviewNotice
            ? '；当前类型不是综述，结果按通用论文结构生成'
            : '';
        const synthesisNotice = response.outline?.globalSynthesisAvailable === false
            ? '；全局组织综合暂不可用，但逐段摘要已保留'
            : '';
        showStatus(
            `综述大纲已生成：${reviewOutlineState.completedParagraphs} 段` +
                notice + synthesisNotice,
            response.nonReviewNotice || response.outline?.globalSynthesisAvailable === false
                ? 'error' : 'success'
        );
        if (response.route) showStatus(
            formatEffectiveRoute('综述大纲已生成', response.route),
            response.nonReviewNotice || response.outline?.globalSynthesisAvailable === false
                ? 'error' : 'success'
        );
    } catch (error) {
        if (!isCurrentReviewOutlineTask(panelContext)) return;
        const progress = tabId
            ? await refreshReviewOutlineProgress(tabId, false, panelContext)
            : reviewOutlineState;
        if (!isCurrentReviewOutlineTask(panelContext)) return;
        const progressText = progress?.totalParagraphs
            ? `（已完成 ${progress.completedParagraphs || 0}/${progress.totalParagraphs} 段）`
            : '';
        const resumeNotice = Number(progress?.completedParagraphs) > 0
            ? '；已完成部分已保存，重新点击将从断点继续'
            : '';
        showStatus('综述大纲生成失败' + progressText + '：' + error.message +
            resumeNotice, 'error');
    } finally {
        if (!isCurrentReviewOutlineTask(panelContext)) return;
        stopReviewOutlineProgressPolling();
        reviewOutlineState = { ...reviewOutlineState, running: false };
        updateReviewOutlineButton();
    }
}

function renderManualAnnotationSummary() {
    const summary = document.getElementById('manualAnnotationSummary');
    if (!manualAnnotationState.documentId) {
        summary.textContent = '当前页面尚未准备好手动标注数据';
    } else {
        summary.textContent = `本文手动标注 ${manualAnnotationState.annotationCount} 条` +
            ` · 待重新定位 ${manualAnnotationState.unresolvedCount} 条`;
    }
    const automaticButton = document.getElementById('clearAutomaticHighlights');
    const manualButton = document.getElementById('clearManualAnnotations');
    if (automaticButton) automaticButton.disabled = automaticClearPending;
    if (manualButton) {
        manualButton.disabled = manualClearPending ||
            !manualAnnotationState.documentId || manualAnnotationState.annotationCount === 0;
    }
}

async function refreshManualAnnotationSummary(tabId = null) {
    const requestId = ++manualSummarySequence;
    try {
        let targetTabId = tabId;
        if (!targetTabId) {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            targetTabId = tab?.id;
        }
        if (!targetTabId) throw new Error('无法获取当前论文页面');
        const response = await sendTabMessage(targetTabId, {
            action: 'prepareManualAnnotations'
        });
        const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (requestId !== manualSummarySequence || currentTab?.id !== targetTabId) return null;
        if (!response?.success || !response.documentId) {
            throw new Error(response?.error || '手动标注数据不可用');
        }
        manualAnnotationState = {
            tabId: targetTabId,
            documentId: response.documentId,
            documentHash: response.documentHash || '',
            canonicalUrl: response.canonicalUrl || '',
            title: response.title || '',
            annotationCount: Math.max(0, Number(response.annotationCount) || 0),
            unresolvedCount: Math.max(0, Number(response.unresolvedCount) || 0)
        };
        renderManualAnnotationSummary();
        return manualAnnotationState;
    } catch (error) {
        if (requestId !== manualSummarySequence) return null;
        manualAnnotationState = {
            tabId: null,
            documentId: '',
            documentHash: '',
            canonicalUrl: '',
            title: '',
            annotationCount: 0,
            unresolvedCount: 0
        };
        renderManualAnnotationSummary();
        return null;
    }
}

async function clearAutomaticHighlightsFromCurrentTab() {
    if (automaticClearPending) return;
    automaticClearPending = true;
    renderManualAnnotationSummary();
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) throw new Error('无法获取当前论文页面');
        const response = await sendTabMessage(tab.id, {
            action: 'clearAutomaticHighlights'
        });
        if (!response?.success) throw new Error(response?.error || '清除自动高亮失败');
        matchCounts = {};
        renderCategories();
        showStatus('自动高亮已清除，手动标注保留不变', 'success');
    } catch (error) {
        showStatus(`清除自动高亮失败：${error.message}`, 'error');
    } finally {
        automaticClearPending = false;
        renderManualAnnotationSummary();
    }
}

function openManualClearConfirmation() {
    if (manualClearPending || !manualAnnotationState.documentId ||
        manualAnnotationState.annotationCount === 0) return;
    document.getElementById('clearManualDescription').textContent =
        `将删除本文 ${manualAnnotationState.annotationCount} 条手动标注，` +
        `其中 ${manualAnnotationState.unresolvedCount} 条待重新定位。自动高亮不会受影响。`;
    document.getElementById('clearManualDialog').showModal();
}

async function confirmManualAnnotationClear(event) {
    event.preventDefault();
    if (manualClearPending) return;
    const snapshot = { ...manualAnnotationState };
    if (!snapshot.documentId || snapshot.annotationCount === 0) return;
    manualClearPending = true;
    renderManualAnnotationSummary();
    const confirmButton = document.getElementById('confirmClearManual');
    confirmButton.disabled = true;
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.id !== snapshot.tabId ||
            manualAnnotationState.documentId !== snapshot.documentId) {
            throw new Error('当前论文已变化，请重新确认');
        }
        const currentDocument = await sendTabMessage(snapshot.tabId, {
            action: 'prepareManualAnnotations'
        });
        if (!currentDocument?.success ||
            currentDocument.documentId !== snapshot.documentId) {
            throw new Error('当前论文已变化，请重新确认');
        }
        await runManualClear({
            documentId: snapshot.documentId,
            clearDocument: ({ documentId }) => sendLlmMessage({
                type: 'ANNOTATION_CLEAR_DOCUMENT',
                documentId
            }),
            unwrap: message => sendTabMessage(snapshot.tabId, {
                action: 'clearManualAnnotations',
                ...message,
                completionType: 'ANNOTATION_CLEAR_DOCUMENT'
            })
        });
        manualAnnotationState = {
            ...snapshot,
            annotationCount: 0,
            unresolvedCount: 0
        };
        document.getElementById('clearManualDialog').close();
        await persistCurrentArticleArchive().catch(() => null);
        showStatus('本文手动标注已清除，自动高亮保留不变', 'success');
    } catch (error) {
        if (error?.backgroundCleared) {
            manualAnnotationState = {
                ...snapshot,
                annotationCount: 0,
                unresolvedCount: 0
            };
            document.getElementById('clearManualDialog').close();
            showStatus('手动标注数据已清除；请刷新页面以移除残留标记', 'error');
        } else {
            showStatus(`清除手动标注失败，页面标记保持不变：${error.message}`, 'error');
        }
    } finally {
        manualClearPending = false;
        confirmButton.disabled = false;
        renderManualAnnotationSummary();
    }
}

// 设置事件监听
function setupEventListeners() {
    document.querySelector('.workspace-view[data-workspace-view="figures"]')
        ?.addEventListener('scroll', syncFigureQuickNavFromScroll, { passive: true });
    document.getElementById('openArticleNavigator')?.addEventListener('click', openArticleNavigator);
    document.getElementById('analyzeFiguresFromFigures')?.addEventListener('click', runFigureAnalysis);
    document.getElementById('analyzeCrossFigureLogic')?.addEventListener('click', runCrossFigureLogic);
    document.getElementById('articleChatProfile')?.addEventListener('change', event => {
        articleChatSelectedProfileId = event.target.value;
        renderArticleChatSnapshot(currentWorkspaceSnapshot);
    });
    document.getElementById('articleChatForm')?.addEventListener('submit', event => {
        void submitArticleChat(event);
    });
    document.getElementById('articleChatMessages')?.addEventListener('scroll', event => {
        if (articleChatScrollToLatestActive) return;
        articleChatFollowLatest = isArticleChatNearBottom(event.currentTarget);
        updateArticleChatReturnLatest();
    }, { passive: true });
    document.getElementById('articleChatMessages')?.addEventListener(
        'click', handleArticleChatTurnAction
    );
    document.getElementById('articleChatLoadEarlier')?.addEventListener('click', () => {
        const container = document.getElementById('articleChatMessages');
        const previousHeight = container?.scrollHeight || 0;
        articleChatVisibleTurnCount += articleChatHistoryPageSize;
        articleChatFollowLatest = false;
        renderArticleChatSnapshot(currentWorkspaceSnapshot);
        requestAnimationFrame(() => {
            if (container) container.scrollTop += container.scrollHeight - previousHeight;
        });
    });
    document.getElementById('articleChatReturnLatest')?.addEventListener('click', () => {
        scrollArticleChatToLatest({ smooth: true });
    });
    document.getElementById('articleChatQuestion')?.addEventListener('keydown', event => {
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
            event.preventDefault();
            void submitArticleChat(event);
        }
    });
    document.getElementById('cancelArticleChat')?.addEventListener('click', () => {
        void cancelArticleChat().catch(error =>
            showStatus('无法取消全文问答：' + error.message, 'error'));
    });
    document.getElementById('clearArticleChat')?.addEventListener('click', () => {
        void clearArticleChatHistory().catch(error =>
            showStatus('无法清空全文问答：' + error.message, 'error'));
    });
    document.getElementById('pauseHighlightAnalysis')?.addEventListener('click', () => {
        const command = highlightTaskState.paused ? 'resume' : 'pause';
        void controlActiveAnalysis('highlight', command)
            .catch(error => showStatus('无法控制全文分析：' + error.message, 'error'));
    });
    document.getElementById('cancelHighlightAnalysis')?.addEventListener('click', () => {
        void controlActiveAnalysis('highlight', 'cancel')
            .catch(error => showStatus('无法取消全文分析：' + error.message, 'error'));
    });
    document.getElementById('pauseFigureAnalysis')?.addEventListener('click', () => {
        const command = figureAnalysisState.paused ? 'resume' : 'pause';
        void controlActiveAnalysis('figure', command)
            .catch(error => showStatus('无法控制 Figure 解读：' + error.message, 'error'));
    });
    document.getElementById('cancelFigureAnalysis')?.addEventListener('click', () => {
        void controlActiveAnalysis('figure', 'cancel')
            .catch(error => showStatus('无法取消 Figure 解读：' + error.message, 'error'));
    });
    document.getElementById('generateReviewOutline')?.addEventListener('click', () => {
        void runReviewOutlineAnalysis({ forceRefresh: reviewOutlineState.hasOutline });
    });

    // 模式选择
    document.querySelectorAll('input[name="highlightMode"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            highlightMode = e.target.value;
            saveSettings();
        });
    });

    document.querySelectorAll('input[name="analysisMode"]').forEach(radio => {
        radio.addEventListener('change', async (e) => {
            try {
                await queueAnalysisModeMutation(e.target.value);
            } catch (error) {
                showStatus(`无法切换识别模式：${error.message}`, 'error');
            }
        });
    });

    document.querySelectorAll('input[name="readingView"]').forEach(radio => {
        radio.addEventListener('change', async event => {
            try {
                await queueReadingViewMutation(event.target.value);
            } catch (error) {
                readingViewId = persistedReadingViewId;
                updateReadingViewControl();
                renderCategories();
                showStatus(`切换阅读视图失败，已恢复原选择：${error.message}`, 'error');
            }
        });
    });

    document.getElementById('restoreViewPreset').addEventListener('click', async () => {
        try {
            const targetViewId = readingViewId;
            const result = await queueRestoreViewPreset(targetViewId);
            if (result.status === 'refreshed') {
                showStatus('已恢复当前阅读视图预设', 'success');
            }
        } catch (error) {
            showStatus(`恢复预设失败，已保留原分类选择：${error.message}`, 'error');
        }
    });

    document.getElementById('moreCategories').addEventListener('click', event => {
        const panel = document.getElementById('moreCategoriesPanel');
        const expanded = event.currentTarget.getAttribute('aria-expanded') === 'true';
        event.currentTarget.setAttribute('aria-expanded', String(!expanded));
        panel.hidden = expanded;
        renderCategories();
        if (!expanded) document.getElementById('categorySearch').focus();
    });

    document.getElementById('categorySearch').addEventListener('input', () => {
        renderCategories();
    });

    const confidenceSlider = document.getElementById('confidenceThreshold');
    confidenceSlider.addEventListener('input', event => {
        confidenceThreshold = Number(event.target.value);
        renderConfidenceControl();
    });
    confidenceSlider.addEventListener('change', async event => {
        try {
            await queueConfidenceThresholdMutation(Number(event.target.value));
        } catch (error) {
            showStatus(`置信度保存失败：${error.message}`, 'error');
        }
    });

    // 应用高亮
    document.getElementById('applyHighlight').addEventListener('click', async () => {
        if (regexApplyPending) return;
        regexApplyPending = true;
        updateApplyButton();
        try {
            await preferenceMutationCoordinator.drainLatest();
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab?.id) throw new Error('无法获取当前论文页面');
            // The tab lookup yields; drain again before validating the final mode,
            // type and prepared composition used by the analysis request.
            await preferenceMutationCoordinator.drainLatest();

            if (analysisMode === 'llm') {
            if (llmSettingsState?.effectiveMode !== 'llm') {
                showStatus('请先完成 API、模型和正文发送许可设置', 'error');
                chrome.runtime.openOptionsPage();
                return;
            }
            if (!preparedDocumentState) {
                await prepareCurrentArticleForTypeChoice();
                return;
            }
            if (!getSelectedStudyType()) {
                showStatus('请先选择文献类型', 'error');
                return;
            }
            if (llmSelectedCategories.size === 0) {
                showStatus('请至少选择一个 LLM 识别类别', 'error');
                return;
            }
            try {
                prepareState = 'analyzing';
                highlightTaskState = { running: true, paused: false, cancelled: false };
                updateApplyButton();
                showStatus('正在提取并分析全文，可在页面右下角查看进度', 'success');
                const response = await sendTabMessage(tab.id, {
                    action: 'analyzeArticleWithLLM',
                    documentId: preparedDocumentState.documentId,
                    documentHash: preparedDocumentState.documentHash
                });
                if (response?.cancelled || response?.code === 'CANCELLED') {
                    const error = new Error('分析已取消，已完成分块结果会保留');
                    error.code = 'CANCELLED';
                    throw error;
                }
                if (!response?.success) {
                    const error = new Error(response?.error || 'LLM 分析失败');
                    error.code = response?.code;
                    throw error;
                }
                matchCounts = response.counts || {};
                prepareState = 'prepared';
                preparedDocumentState = {
                    ...preparedDocumentState,
                    fullTextAnalyzed: true
                };
                updateApplyButton();
                renderCategories();
                await refreshLlmDiagnostics();
                await refreshArticleWorkspace();
                await persistCurrentArticleArchive().catch(() => null);
                showStatus(formatEffectiveRoute(
                    `LLM 已高亮 ${response.highlightedCount || 0} 处`, response.analysis?.route
                ), 'success');
            } catch (error) {
                prepareState = 'prepared';
                updateApplyButton();
                if (error?.code === 'CANCELLED' || highlightTaskState.cancelled) {
                    showStatus('全文 LLM 高亮已取消，已完成分块结果会保留。', 'success');
                    await refreshArticleWorkspace();
                    return;
                }
                try {
                    const fallback = await applyRegexOnTab(tab.id);
                    matchCounts = fallback?.counts || {};
                    await queueAnalysisModeMutation('regex');
                    showStatus('LLM 分析失败，已回退到正则高亮', 'error');
                } catch {
                    showStatus('LLM 与正则回退均失败，请刷新页面后重试', 'error');
                }
            }
                return;
            }

            try {
                const response = await applyRegexOnTab(tab.id);
            
                if (response && response.counts) {
                    matchCounts = response.counts;
                    renderCategories();
                }
                await refreshArticleWorkspace();
                await persistCurrentArticleArchive().catch(() => null);
                showStatus('高亮已应用', 'success');
            } catch (error) {
                showStatus(`应用失败：${error.message}`, 'error');
            }
        } finally {
            regexApplyPending = false;
            highlightTaskState = { running: false, paused: false, cancelled: false };
            updateApplyButton();
        }
    });

    document.getElementById('clearAutomaticHighlights')
        .addEventListener('click', clearAutomaticHighlightsFromCurrentTab);
    document.getElementById('clearManualAnnotations')
        .addEventListener('click', openManualClearConfirmation);
    document.getElementById('confirmClearManual')
        .addEventListener('click', confirmManualAnnotationClear);

}

// 显示状态消息
function showStatus(message, type) {
    const statusEl = document.getElementById('statusMessage');
    statusEl.textContent = message;
    statusEl.className = `status-message ${type} show`;
    
    setTimeout(() => {
        statusEl.classList.remove('show');
    }, 3000);
}

function formatEffectiveRoute(status, route) {
    const safe = route && typeof route === 'object' ? route : {};
    const name = String(safe.effectiveProfileName || safe.name || '').trim();
    const model = String(safe.model || '').trim();
    if (!name && !model) return status;
    const target = [name, model].filter(Boolean).join(' / ');
    return safe.fallbackReason
        ? `${status} · 已回退到 ${target}`
        : `${status} · 使用 ${target}`;
}
