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
            const excludePatterns = (Array.isArray(regex.excludePhrases)
                ? regex.excludePhrases : [])
                .map(escapeRegexPhrase)
                .filter(Boolean)
                .map(expression => regex.wholeWord
                    ? `\\b(?:${expression})\\b` : `(?:${expression})`);
            const parts = [...phrases, ...expressions];
            if (!parts.length) return;
            translated[categoryId] = {
                name: String(category.name || categoryId),
                color: String(category.color || '#0B4778'),
                patterns: [`(?:${parts.join('|')})`],
                excludePatterns,
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
const articleWorkspaceSaveGuard = createInFlightActionGuard();
const pptMaterialExportGuard = createInFlightActionGuard();
const zoteroSnapshotExportGuard = createInFlightActionGuard();
let articleWorkspaceDirectoryHandle = null;
let articleWorkspaceDirectoryHandleLoaded = false;
let articleWorkspaceDirectoryHandleReady = Promise.resolve(null);
function refreshArticleWorkspaceDirectoryHandle() {
    articleWorkspaceDirectoryHandleReady = (
        typeof SciLLM.loadDirectoryHandle === 'function'
            ? SciLLM.loadDirectoryHandle(indexedDB)
            : Promise.resolve(null)
    ).then(handle => {
        articleWorkspaceDirectoryHandle = handle || null;
        articleWorkspaceDirectoryHandleLoaded = true;
        return articleWorkspaceDirectoryHandle;
    }).catch(() => {
        articleWorkspaceDirectoryHandle = null;
        articleWorkspaceDirectoryHandleLoaded = true;
        return null;
    });
    return articleWorkspaceDirectoryHandleReady;
}
refreshArticleWorkspaceDirectoryHandle();
let confidenceThreshold = 0.8;
let persistedConfidenceThreshold = 0.8;
let readingViewId = 'quick_story';
let persistedReadingViewId = 'quick_story';
let preparedDocumentState = null;
let currentArticleDocument = null;
let prepareState = 'idle';
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
let figureProgressRenderSignature = '';
let crossFigureLogicRunning = false;
const figureExpansionState = new Map();
const figurePanelExpansionState = new Map();
const figureSectionExpansionState = new Map();
const panelFollowupDraftState = new Map();
let panelFollowupRevealKey = '';
let figureQuickNavActiveId = '';
let figureQuickNavHoverTimer = null;
let figureQuickNavExpandedFigureId = '';
let figureKeyboardShortcutArmed = false;
let lastFigureModuleShortcutPress = {
    key: '',
    pressedAt: 0
};
let figureOriginalViewerState = {
    open: false,
    tabId: null,
    figureId: '',
    captionVisible: false,
    requestSequence: 0
};
let figureCaptionSidebarState = {
    visible: false,
    figureId: ''
};
const SIDE_PANEL_NOTIFICATION_HISTORY_LIMIT = 40;
let sidePanelNotificationHistory = [];
const METHOD_CATEGORY_LABELS = Object.freeze({
    wet_lab: '\u6e7f\u5b9e\u9a8c',
    imaging: '\u6210\u50cf',
    bioinformatics: '\u751f\u7269\u4fe1\u606f\u5b66',
    clinical: '\u4e34\u5e8a',
    schematic: '\u793a\u610f\u56fe',
    other: '\u5176\u4ed6'
});
const CROSS_FIGURE_ROLE_LABELS = Object.freeze({
    problem_setup: '提出问题/建立模型', phenomenon: '建立现象', association: '建立关联',
    mechanism: '解析机制', causal_test: '因果检验', necessity: '必要性检验',
    sufficiency: '充分性检验', rescue: '挽救实验', functional_outcome: '功能结局',
    translation: '转化验证', other: '尚无法归类'
});
const CROSS_FIGURE_EVIDENCE_LABELS = Object.freeze({
    association: '关联证据', intervention_effect: '干预效应', necessity: '必要性证据',
    sufficiency: '充分性证据', rescue: '挽救证据', mechanistic_support: '机制支持',
    functional_validation: '功能验证', other: '证据等级待确认'
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
let workspaceGeneration = 1;
let workspaceUiSaveTimer = null;
let currentWorkspaceSnapshot = null;
let articleChatSelectedProfileId = '';
const articleChatTurnElements = new Map();
const articleChatHistoryPageSize = 30;
let articleChatVisibleTurnCount = articleChatHistoryPageSize;
let articleChatFollowLatest = true;
let articleChatRenderedDocumentKey = '';
let articleChatScrollToLatestActive = false;
const articleChatContextScopes = new Map();
let articleChatCommandItems = [];
let articleChatCommandActiveIndex = -1;
let articleChatCommandTrigger = null;
const workspaceParagraphSummaryState = new Map();
let reviewOutlineTaskGeneration = 0;
let paragraphSummaryTaskGeneration = 0;
let workspaceRefreshSequence = 0;
let currentArticleArchiveProbe = null;
let articlePreparationSequence = 0;
let lastArticlePreparationError = null;
const PANEL_TAB_STATE_CACHE_LIMIT = 6;
const ARTICLE_ARCHIVE_PROMPT_DECISION_PREFIX = 'sciArticleArchivePromptDecision:';
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

async function queryPanelTargetTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab || null;
}

async function publishSidePanelShortcutScope(
    tabId = activePanelTabContext.tabId,
    enabled = activePanelTabContext.activated
) {
    const numericTabId = Number(tabId);
    if (!Number.isInteger(numericTabId)) return false;
    const message = {
        action: 'setSidePanelShortcutScope',
        enabled: enabled === true,
        shortcuts: enabled === true ? currentKeyboardShortcuts() : {}
    };
    try {
        const response = enabled === true
            ? await sendTabMessage(numericTabId, message)
            : await SciLLM.sendTabMessageIfPresent(chrome, numericTabId, message);
        return response?.success === true;
    } catch (_) {
        return false;
    }
}

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

function notificationSessionStorageKey(panelKey = activePanelTabContext.key) {
    const source = String(panelKey || '');
    if (!source) return '';
    let hash = 2166136261;
    for (let index = 0; index < source.length; index += 1) {
        hash ^= source.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    const tabId = Number(source.split('|', 1)[0]) || 0;
    return `sci-side-panel-notifications-v1-${tabId}-${(hash >>> 0).toString(16)}`;
}

function formatSidePanelNotificationTime(timestamp, includeDate = false) {
    const date = new Date(Number(timestamp) || Date.now());
    const options = {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    };
    if (includeDate) {
        options.month = '2-digit';
        options.day = '2-digit';
    }
    return new Intl.DateTimeFormat('zh-CN', options).format(date);
}

function renderSidePanelNotificationHistory() {
    const center = document.getElementById('sidePanelNotificationCenter');
    const latest = document.getElementById('sidePanelNotificationLatest');
    const time = document.getElementById('sidePanelNotificationTime');
    const history = document.getElementById('sidePanelNotificationHistory');
    if (!center || !latest || !time || !history) return;
    const newest = sidePanelNotificationHistory[0] || null;
    latest.textContent = newest?.message || '暂无通知';
    latest.title = newest?.message || '暂无通知';
    time.textContent = newest
        ? formatSidePanelNotificationTime(newest.timestamp) : '--:--';
    time.dateTime = newest ? new Date(newest.timestamp).toISOString() : '';
    center.classList.toggle('has-error', newest?.type === 'error');
    history.replaceChildren();
    if (!sidePanelNotificationHistory.length) {
        history.appendChild(createWorkspaceElement(
            'li', 'side-panel-notification-empty', '还没有通知'
        ));
        return;
    }
    const today = new Date().toDateString();
    sidePanelNotificationHistory.forEach(item => {
        const row = createWorkspaceElement(
            'li',
            `side-panel-notification-item${item.type === 'error' ? ' is-error' : ''}`
        );
        const rowTime = document.createElement('time');
        const includeDate = new Date(item.timestamp).toDateString() !== today;
        rowTime.dateTime = new Date(item.timestamp).toISOString();
        rowTime.textContent = formatSidePanelNotificationTime(item.timestamp, includeDate);
        row.append(rowTime, createWorkspaceElement('span', '', item.message));
        history.appendChild(row);
    });
}

function persistSidePanelNotificationHistory() {
    const storageKey = notificationSessionStorageKey();
    if (!storageKey || !chrome.storage?.session) return;
    void chrome.storage.session.set({
        [storageKey]: sidePanelNotificationHistory.map(item => ({ ...item }))
    }).catch(() => undefined);
}

async function loadSidePanelNotificationHistory(panelKey = activePanelTabContext.key) {
    const storageKey = notificationSessionStorageKey(panelKey);
    if (!storageKey || !chrome.storage?.session) return [];
    try {
        const stored = await chrome.storage.session.get(storageKey);
        if (panelKey !== activePanelTabContext.key) return [];
        sidePanelNotificationHistory = (Array.isArray(stored?.[storageKey])
            ? stored[storageKey] : []).slice(0, SIDE_PANEL_NOTIFICATION_HISTORY_LIMIT)
            .map(item => ({
                message: String(item?.message || '').trim().slice(0, 600),
                type: item?.type === 'error' ? 'error'
                    : item?.type === 'success' ? 'success' : 'info',
                timestamp: Math.max(0, Number(item?.timestamp) || 0) || Date.now()
            }))
            .filter(item => item.message);
        renderSidePanelNotificationHistory();
        return sidePanelNotificationHistory;
    } catch (_) {
        return [];
    }
}

function recordSidePanelNotification(message, type = 'info', timestamp = Date.now()) {
    const normalizedMessage = String(message || '').normalize('NFKC')
        .replace(/\s+/g, ' ').trim().slice(0, 600);
    if (!normalizedMessage) return null;
    const normalizedType = type === 'error' ? 'error'
        : type === 'success' ? 'success' : 'info';
    const normalizedTimestamp = Math.max(0, Number(timestamp) || 0) || Date.now();
    const newest = sidePanelNotificationHistory[0];
    if (newest?.message === normalizedMessage &&
        normalizedTimestamp - newest.timestamp < 1500) {
        newest.timestamp = normalizedTimestamp;
        newest.type = normalizedType;
    } else {
        sidePanelNotificationHistory.unshift({
            message: normalizedMessage,
            type: normalizedType,
            timestamp: normalizedTimestamp
        });
        sidePanelNotificationHistory =
            sidePanelNotificationHistory.slice(0, SIDE_PANEL_NOTIFICATION_HISTORY_LIMIT);
    }
    const center = document.getElementById('sidePanelNotificationCenter');
    if (center && !center.open) center.classList.add('has-unread');
    renderSidePanelNotificationHistory();
    persistSidePanelNotificationHistory();
    return sidePanelNotificationHistory[0];
}

function setupSidePanelNotificationCenter() {
    const center = document.getElementById('sidePanelNotificationCenter');
    if (!center) return;
    center.addEventListener('toggle', () => {
        if (center.open) center.classList.remove('has-unread');
    });
    document.addEventListener('pointerdown', event => {
        if (center.open && !center.contains(event.target)) center.open = false;
    });
    renderSidePanelNotificationHistory();
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
        manualAnnotationState: { ...manualAnnotationState },
        matchCounts: { ...matchCounts },
        activeWorkspaceView,
        workspaceGeneration,
        currentWorkspaceSnapshot,
        articleChatVisibleTurnCount,
        currentArticleArchiveProbe,
        sidePanelNotificationHistory: sidePanelNotificationHistory.map(item => ({ ...item })),
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
    figureProgressRenderSignature = '';
    figureExpansionState.clear();
    figurePanelExpansionState.clear();
    figureSectionExpansionState.clear();
    panelFollowupDraftState.clear();
    figureQuickNavActiveId = '';
    figureQuickNavExpandedFigureId = '';
    figureKeyboardShortcutArmed = false;
    lastFigureModuleShortcutPress = {
        key: '',
        pressedAt: 0
    };
    figureOriginalViewerState = {
        open: false,
        tabId: null,
        figureId: '',
        captionVisible: false,
        requestSequence: figureOriginalViewerState.requestSequence + 1
    };
    figureCaptionSidebarState = {
        visible: false,
        figureId: ''
    };
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
    activeWorkspaceView = 'analysis';
    workspaceGeneration = 1;
    clearTimeout(workspaceUiSaveTimer);
    workspaceUiSaveTimer = null;
    currentWorkspaceSnapshot = null;
    currentArticleArchiveProbe = null;
    sidePanelNotificationHistory = [];
    renderSidePanelNotificationHistory();
    lastArticlePreparationError = null;
    setArticleArchivePrompt(null);
    renderArticleNavigationTree(null);
    renderEvidenceLedger(null);
    renderHighlightDistributionSnapshot(null);
    renderFigureWorkspaceSnapshot(null);
    renderArticleChatSnapshot(null);
    renderManualAnnotationSummary();
    renderCategories();
    updateApplyButton();
    switchWorkspaceView('analysis', { persist: false });
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
    manualAnnotationState = { ...cached.manualAnnotationState };
    matchCounts = { ...cached.matchCounts };
    activeWorkspaceView = cached.activeWorkspaceView || 'analysis';
    workspaceGeneration = Math.max(1, Number(cached.workspaceGeneration) || 1);
    currentWorkspaceSnapshot = cached.currentWorkspaceSnapshot || null;
    articleChatVisibleTurnCount = Math.max(
        articleChatHistoryPageSize,
        Number(cached.articleChatVisibleTurnCount) ||
            Number(currentWorkspaceSnapshot?.chat?.turns?.length) || 0
    );
    currentArticleArchiveProbe = cached.currentArticleArchiveProbe || null;
    sidePanelNotificationHistory = (Array.isArray(cached.sidePanelNotificationHistory)
        ? cached.sidePanelNotificationHistory : []).map(item => ({ ...item }));
    renderSidePanelNotificationHistory();
    reviewOutlineState = { ...reviewOutlineState, ...cached.reviewOutlineState };
    document.getElementById('sidePanelApp')?.classList.remove('is-tab-inactive');
    renderArticleWorkspaceSnapshot(currentWorkspaceSnapshot);
    resumeFigureProgressFromWorkspaceSnapshot(currentWorkspaceSnapshot);
    setArticleArchivePrompt(currentArticleArchiveProbe);
    renderManualAnnotationSummary();
    syncPreparedSelection();
    renderCategories();
    updateApplyButton();
    switchWorkspaceView(activeWorkspaceView, { persist: false });
}

async function synchronizeActiveTabContext({ force = false } = {}) {
    if (!panelUiReady) return null;
    const requestId = ++tabContextRequestSequence;
    const tab = await queryPanelTargetTab();
    if (requestId !== tabContextRequestSequence) return null;
    const key = panelTabDocumentKey(tab);
    const activated = Boolean(key &&
        await SciLLM.isTabActivated(chrome.storage.session, tab));
    if (requestId !== tabContextRequestSequence) return null;
    if (!force && activePanelTabContext.key === key &&
        activePanelTabContext.activated === activated) {
        void publishSidePanelShortcutScope(tab?.id, activated);
        return activePanelTabContext;
    }

    const previousTabId = activePanelTabContext.tabId;
    const previousActivated = activePanelTabContext.activated;
    cacheCurrentPanelTabState();
    tabContextSequence += 1;
    activePanelTabContext = {
        tabId: tab?.id ?? null,
        url: SciLLM.normalizeTabDocumentUrl(tab?.url || tab?.pendingUrl),
        key,
        activated,
        tabContextSequence
    };
    if (previousActivated && Number(previousTabId) !== Number(tab?.id)) {
        void publishSidePanelShortcutScope(previousTabId, false);
    }
    void publishSidePanelShortcutScope(tab?.id, activated);
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

    await loadSidePanelNotificationHistory(key);
    if (requestId !== tabContextRequestSequence) return null;
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
        if (message?.type === 'PANEL_TAB_ACTIVATED') {
            scheduleActiveTabContextSync();
        }
        if (message?.type === 'SIDE_PANEL_GLOBAL_SHORTCUT' &&
            Number(sender?.tab?.id) === Number(activePanelTabContext.tabId) &&
            activePanelTabContext.activated) {
            runGlobalKeyboardShortcutKey(String(message.key || ''));
        }
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
        if (message?.type === 'FIGURE_WORKSPACE_STATE_CHANGED' &&
            Number(sender?.tab?.id) === Number(activePanelTabContext.tabId) &&
            activePanelTabContext.activated) {
            void refreshArticleWorkspace();
        }
        if (message?.type === 'FIGURE_ORIGINAL_VIEWER_STATE_CHANGED' &&
            Number(sender?.tab?.id) === Number(activePanelTabContext.tabId) &&
            activePanelTabContext.activated) {
            const previousCaptionVisible = figureOriginalViewerState.captionVisible === true;
            figureOriginalViewerState = {
                open: message.open === true,
                tabId: sender.tab.id,
                figureId: String(message.figureId || ''),
                captionVisible: message.captionVisible === true,
                requestSequence: figureOriginalViewerState.requestSequence + 1
            };
            if (message.open === true && message.captionVisible === true &&
                message.figureId) {
                showFigureCaptionSidebar(String(message.figureId));
            } else if (previousCaptionVisible) {
                hideFigureCaptionSidebar(String(message.figureId || ''));
            } else if (message.open === true && message.figureId) {
                followFigureOriginalViewerInSidebar(String(message.figureId));
            }
        }
        if (message?.type === 'MANUAL_ANNOTATION_STATE_CHANGED' &&
            Number(sender?.tab?.id) === Number(activePanelTabContext.tabId) &&
            activePanelTabContext.activated) {
            applyManualAnnotationStateEvent(message.event, sender.tab.id);
            void refreshArticleWorkspace();
        }
        if (message?.type === 'ARTICLE_NOTIFICATION' &&
            Number(sender?.tab?.id) === Number(activePanelTabContext.tabId) &&
            activePanelTabContext.activated) {
            recordSidePanelNotification(
                message.message,
                message.level,
                message.timestamp
            );
        }
    });
}

function switchWorkspaceView(viewId, { persist = true } = {}) {
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
    if (persist) scheduleActiveWorkspaceUiStateSave();
}

function scheduleActiveWorkspaceUiStateSave() {
    clearTimeout(workspaceUiSaveTimer);
    const workspace = currentWorkspaceSnapshot?.localWorkspace;
    const tabId = activePanelTabContext.tabId;
    if (!workspace?.workspaceId || !activePanelTabContext.activated || !tabId) return;
    workspaceUiSaveTimer = setTimeout(() => {
        workspaceUiSaveTimer = null;
        const uiState = {
            activeWorkspaceView,
            figureExpansion: [...figureExpansionState.entries()],
            figurePanelExpansion: [...figurePanelExpansionState.entries()]
        };
        void sendTabMessage(tabId, {
            action: 'saveArticleWorkspaceUiState',
            relativePath: 'ui/state.json',
            uiState
        }).catch(() => undefined);
    }, 160);
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

function collapseAllFigurePanels() {
    for (const key of figurePanelExpansionState.keys()) {
        figurePanelExpansionState.set(key, false);
    }
    document.querySelectorAll(
        '#figureWorkspace details.workspace-figure-panel-card'
    ).forEach(details => {
        details.open = false;
        figurePanelExpansionState.set(
            panelWorkspaceKey(details.dataset.figureId, details.dataset.panelId),
            false
        );
    });
    scheduleActiveWorkspaceUiStateSave();
}

function openWorkspaceView(viewId) {
    switchWorkspaceView(viewId);
    if (viewId !== 'analysis') void refreshArticleWorkspace();
    if (viewId === 'analysis') void refreshManualAnnotationSummary();
}

async function jumpToArticleAbbreviationSource(entry, dialog) {
    const status = document.getElementById('articleAbbreviationStatus');
    const abbreviation = String(entry?.abbreviation || '').trim();
    const target = {
        kind: 'paragraph',
        paragraphId: String(entry?.paragraphId || ''),
        sourceKey: String(entry?.sourceKey || ''),
        navigationRevision: Math.max(0, Number(entry?.navigationRevision) || 0)
    };
    if (!target.paragraphId && !target.sourceKey) {
        if (status) status.textContent = `无法定位 ${abbreviation || '该缩写'} 的原文位置。`;
        return false;
    }
    const focused = await focusWorkspaceSource(target);
    if (!focused) {
        if (status) status.textContent = `未找到 ${abbreviation || '该缩写'} 在当前正文中的首次出现位置。`;
        return false;
    }
    if (dialog?.open) dialog.close();
    showStatus(`已定位 ${abbreviation} 在正文中的首次出现位置。`, 'success');
    return true;
}

async function showArticleAbbreviationTable() {
    const dialog = document.getElementById('articleAbbreviationDialog');
    const body = document.getElementById('articleAbbreviationTableBody');
    const status = document.getElementById('articleAbbreviationStatus');
    const empty = document.getElementById('articleAbbreviationEmpty');
    if (!dialog || !body || !status || !empty) return;
    let snapshot = currentWorkspaceSnapshot;
    if (!Array.isArray(snapshot?.paragraphs) || !snapshot.paragraphs.length) {
        snapshot = await refreshArticleWorkspace();
    }
    const abbreviationParagraphs = (Array.isArray(snapshot?.paragraphs)
        ? snapshot.paragraphs : []).filter(paragraph =>
        String(paragraph?.sectionKind || '').toLowerCase() !== 'reference');
    const entries = SciLLM.extractArticleAbbreviations?.(abbreviationParagraphs) || [];
    body.replaceChildren();
    entries.forEach(entry => {
        const row = document.createElement('tr');
        row.className = 'abbreviation-table-row';
        row.title = `跳转到 ${entry.abbreviation} 在正文中首次出现的位置`;
        const createJumpCell = (text, label) => {
            const cell = document.createElement('td');
            const button = createWorkspaceElement(
                'button', 'abbreviation-table-jump', text
            );
            button.type = 'button';
            button.setAttribute(
                'aria-label',
                `${label}；跳转到正文首次出现位置`
            );
            button.addEventListener('click', () => {
                void jumpToArticleAbbreviationSource(entry, dialog);
            });
            cell.appendChild(button);
            return cell;
        };
        const abbreviation = createJumpCell(
            entry.abbreviation,
            `缩写 ${entry.abbreviation}`
        );
        const fullName = createJumpCell(
            entry.fullName,
            `${entry.abbreviation} 的全称 ${entry.fullName}`
        );
        row.append(abbreviation, fullName);
        body.appendChild(row);
    });
    empty.hidden = entries.length > 0;
    status.textContent = entries.length
        ? `本地提取 ${entries.length} 项 · 未调用 LLM · 已按缩写字母顺序排列`
        : '未调用 LLM；仅保留正文中有明确全称对应关系的缩写。';
    if (!dialog.open) dialog.showModal();
}

function setupWorkspaceNavigation() {
    document.querySelectorAll('[data-workspace-target]').forEach(button => {
        button.addEventListener('click', () => {
            openWorkspaceView(button.dataset.workspaceTarget);
        });
    });
    document.getElementById('refreshArticleNavigation')?.addEventListener('click', () => {
        void refreshArticleWorkspace({ announce: true });
    });
    document.getElementById('showArticleAbbreviations')?.addEventListener('click', () => {
        void showArticleAbbreviationTable();
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
    setupFigureKeyboardNavigation();
    setupGlobalKeyboardShortcuts();
    switchWorkspaceView(activeWorkspaceView);
}

function setupSidePanelSettingsShortcut() {
    const openSidePanelSettings = document.getElementById('openSidePanelSettings');
    if (!openSidePanelSettings) return;
    openSidePanelSettings.addEventListener('click', async () => {
        if (openSidePanelSettings.dataset.pending === 'true') return;
        openSidePanelSettings.dataset.pending = 'true';
        openSidePanelSettings.disabled = true;
        try {
            await chrome.tabs.create({
                url: chrome.runtime.getURL('options.html#categoryWorkspace')
            });
        } catch (error) {
            showStatus(`打开设置页面失败：${error.message}`, 'error');
        } finally {
            delete openSidePanelSettings.dataset.pending;
            openSidePanelSettings.disabled = false;
        }
    });
}

function appendScientificInlineText(parent, value) {
    const text = String(value ?? '');
    const tokenPattern = /<(sup|sub)>([^<\n]*)<\/\1>/gi;
    let cursor = 0;
    for (const match of text.matchAll(tokenPattern)) {
        if (match.index > cursor) {
            parent.appendChild(document.createTextNode(text.slice(cursor, match.index)));
        }
        const script = document.createElement(match[1].toLowerCase());
        script.textContent = match[2];
        parent.appendChild(script);
        cursor = match.index + match[0].length;
    }
    if (cursor < text.length) {
        parent.appendChild(document.createTextNode(text.slice(cursor)));
    }
    return parent;
}

function createWorkspaceElement(tagName, className = '', text = '') {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (text !== '' && text !== null && text !== undefined) {
        appendScientificInlineText(element, text);
    }
    return element;
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
    if (!requireUsableLlm('段落概述')) return;
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
        details.open = hadTree
            ? previouslyOpen.has(nodeKey)
            : depth === 0 && !leaf;
        const summary = createWorkspaceElement('summary', 'workspace-tree-summary');
        const analysisToggle = document.createElement('input');
        analysisToggle.type = 'checkbox';
        analysisToggle.className = 'workspace-section-analysis-toggle';
        analysisToggle.checked = node.analysisSelected === true;
        analysisToggle.indeterminate = node.analysisIndeterminate === true;
        analysisToggle.disabled = !Array.isArray(node.analysisSectionIds) ||
            node.analysisSectionIds.length === 0;
        analysisToggle.setAttribute(
            'aria-label',
            `${node.displayTitle || node.title || '当前章节'}参与规则和 LLM 分析`
        );
        analysisToggle.addEventListener('click', event => event.stopPropagation());
        analysisToggle.addEventListener('change', async event => {
            event.stopPropagation();
            const panelContext = capturePanelContext();
            analysisToggle.disabled = true;
            try {
                const response = await sendTabMessage(panelContext.tabId, {
                    action: 'setArticleAnalysisSectionSelection',
                    sectionIds: node.analysisSectionIds,
                    selected: analysisToggle.checked
                });
                if (!isCurrentPanelContext(panelContext)) return;
                if (!response?.success || !response.snapshot) {
                    throw new Error(response?.error || 'SECTION_SELECTION_FAILED');
                }
                renderArticleWorkspaceSnapshot(response.snapshot);
                showStatus(
                    `已更新分析范围：当前包含 ${response.selectedParagraphCount || 0} 段正文。`,
                    'success'
                );
            } catch (error) {
                if (!isCurrentPanelContext(panelContext)) return;
                analysisToggle.checked = !analysisToggle.checked;
                analysisToggle.disabled = false;
                showStatus(`无法更新章节分析范围：${error.message}`, 'error');
            }
        });
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
            'button', 'workspace-tree-jump',
            node.displayTitle || node.title || '未命名章节'
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
        summary.append(analysisToggle, toggle, jump, count);
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
                label = saved?.summary
                    ? `第 ${index + 1} 段 · ${saved.summary}`
                    : `第 ${index + 1} 段 · ${String(
                        paragraph.displayText || paragraph.text || ''
                    ).slice(0, 96)}`;
                className = 'workspace-paragraph-jump' +
                    (task.loading ? ' is-loading' : '') +
                    (task.error ? ' is-error' : '');
                const button = createWorkspaceElement('button', className, label);
                button.type = 'button';
                button.dataset.paragraphId = paragraphId;
                button.disabled = task.loading || reviewOutlineState.running;
                button.title = task.error || paragraph.text || label;
                button.addEventListener('click', async event => {
                    event.preventDefault();
                    event.stopImmediatePropagation();
                    const panelContext = capturePanelContext(paragraphSummaryTaskGeneration);
                    const focused = await focusWorkspaceSource({
                        kind: 'paragraph',
                        paragraphId,
                        sourceKey: paragraph.sourceKey,
                        navigationRevision: Number(paragraph.navigationRevision ||
                            snapshot?.revision || 0)
                    }, panelContext);
                    if (!isCurrentParagraphSummaryTask(panelContext)) return;
                    if (!focused) {
                        showStatus('无法定位该段落；请刷新文章导航后重试。', 'error');
                    }
                }, { capture: true });
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
                    } else if (!hasUsableLlm()) {
                        showStatus(llmUnavailableMessage('段落概述'), 'error');
                    } else {
                        void runSingleParagraphSummary(paragraph, panelContext);
                    }
                });
                const summarize = createWorkspaceElement(
                    'button',
                    'workspace-paragraph-summary-action',
                    '概述'
                );
                summarize.type = 'button';
                summarize.disabled = task.loading || reviewOutlineState.running;
                summarize.title = task.error
                    ? `概述生成失败：${task.error}` : '生成该段概述';
                summarize.addEventListener('click', event => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (!hasUsableLlm()) {
                        showStatus(llmUnavailableMessage('段落概述'), 'error');
                        return;
                    }
                    const panelContext = capturePanelContext(paragraphSummaryTaskGeneration);
                    void runSingleParagraphSummary(paragraph, panelContext);
                });
                const row = createWorkspaceElement('div', 'workspace-paragraph-row');
                row.append(button, summarize);
                list.appendChild(row);
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
    const sourceMeta = {
        semantic: { label: '智能检索', className: 'is-semantic' },
        manual: { label: '手动标注', className: 'is-manual' },
        llm: { label: 'AI 自动', className: 'is-llm' },
        regex: { label: '规则自动', className: 'is-regex' },
        other: { label: '其他来源', className: 'is-other' }
    };
    const legend = createWorkspaceElement('div', 'workspace-distribution-legend');
    Object.entries(sourceMeta).forEach(([source, meta]) => {
        const count = Number(distribution.sourceCounts?.[source]) || 0;
        if (!count) return;
        legend.appendChild(createWorkspaceElement(
            'span', `workspace-distribution-legend-item ${meta.className}`,
            `${meta.label} ${count}`
        ));
    });
    if (legend.childElementCount) container.appendChild(legend);
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
            const sourceGroups = value.sources && typeof value.sources === 'object'
                ? value.sources : Object.fromEntries((value.items || []).map(item => [
                    item.source || 'other', {
                        count: (value.items || []).filter(candidate =>
                            (candidate.source || 'other') === (item.source || 'other')).length,
                        items: (value.items || []).filter(candidate =>
                            (candidate.source || 'other') === (item.source || 'other'))
                    }
                ]));
            Object.entries(sourceMeta).forEach(([source, meta]) => {
                const sourceValue = sourceGroups[source];
                if (!sourceValue?.count) return;
                const button = createWorkspaceElement(
                    'button', `workspace-distribution-cell ${meta.className}`,
                    `${meta.label} · ${category.name} ${sourceValue.count}`
                );
                button.type = 'button';
                button.style.setProperty('--workspace-highlight-color', category.color || '#0b4778');
                button.title = (sourceValue.items || []).slice(0, 8).map(item => {
                    const lines = [item.quote || ''];
                    if (item.sourceQuery) lines.push(`检索意图：${item.sourceQuery}`);
                    if (item.note) lines.push(`备注：${item.note}`);
                    return lines.filter(Boolean).join('\n');
                }).filter(Boolean).join('\n\n');
                button.addEventListener('click', () => void focusWorkspaceSource({
                    kind: 'highlight', highlightId: sourceValue.items?.[0]?.highlightId || ''
                }));
                cells.appendChild(button);
            });
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

function appendFigurePanelSummary(summary, panel, {
    panelId = '',
    loading = false,
    analyzed = false,
    formattedHeader = ''
} = {}) {
    const normalizedPanelId = String(panel?.panel || panelId || '?').toUpperCase();
    const label = createWorkspaceElement(
        'span', 'workspace-panel-id', `Panel ${normalizedPanelId}`
    );
    let detail = loading ? '正在解读' : '待解读';
    if (analyzed) {
        detail = String(formattedHeader || formatFigurePanelHeader(panel))
            .replace(new RegExp(`^Panel\\s+${normalizedPanelId}\\s*·\\s*`, 'i'), '');
    }
    const description = createWorkspaceElement(
        'span', 'workspace-panel-description', detail
    );
    summary.replaceChildren(label, description);
    return summary;
}

function panelFollowupPresetOptions() {
    return (Array.isArray(llmSettingsState?.settings?.figurePanelFollowupPresets)
        ? llmSettingsState.settings.figurePanelFollowupPresets : [])
        .filter(preset => preset?.id && preset?.name && preset?.prompt)
        .map(preset => ({
            id: String(preset.id),
            topic: String(preset.topic || ''),
            name: String(preset.name),
            prompt: String(preset.prompt)
        }));
}

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
    const retry = Number(value.attempts) > 1 ? ` · 共 ${value.attempts} 次模型请求` : '';
    return `${mode}${size}${retry}`;
}

function getPanelFollowupDraft(figureId, panelId) {
    const key = panelWorkspaceKey(figureId, panelId);
    if (!panelFollowupDraftState.has(key)) {
        panelFollowupDraftState.set(key, { open: false, topics: new Set(), question: '' });
    }
    return panelFollowupDraftState.get(key);
}

function appendPanelFollowupHistory(root, figure, panelId, currentAnswer = null) {
    const history = Array.isArray(figure?.panelFollowupHistories?.[panelId])
        ? figure.panelFollowupHistories[panelId] : [];
    const priorHistory = currentAnswer?.answer && history.length >= 2
        ? history.slice(0, -2) : history;
    if (!priorHistory.length) return;

    const details = document.createElement('details');
    details.className = 'workspace-panel-followup-history';
    details.open = true;
    const summary = document.createElement('summary');
    summary.textContent = `历史追问（${Math.ceil(priorHistory.length / 2)} 轮）`;
    details.appendChild(summary);
    const turns = createWorkspaceElement('div', 'workspace-panel-followup-history-turns');
    for (let index = 0; index < priorHistory.length; index += 2) {
        const round = createWorkspaceElement('section', 'workspace-panel-followup-history-round');
        round.appendChild(createWorkspaceElement(
            'strong',
            'workspace-panel-followup-history-round-title',
            `第 ${Math.floor(index / 2) + 1} 轮`
        ));
        priorHistory.slice(index, index + 2).forEach(item => {
            const assistant = item?.role === 'assistant';
            const message = createWorkspaceElement(
                'p',
                `workspace-panel-followup-history-message is-${assistant ? 'assistant' : 'user'}`
            );
            message.textContent = `${assistant ? '回答' : '问题'}：${String(item?.content || '')}`;
            round.appendChild(message);
        });
        turns.appendChild(round);
    }
    details.appendChild(turns);
    root.appendChild(details);
}

function createPanelFollowupControl(figure, panel) {
    const panelId = String(panel?.panel || '').toUpperCase();
    const followupKey = panelWorkspaceKey(figure.figureId, panelId);
    const followups = figure?.panelFollowups && typeof figure.panelFollowups === 'object'
        ? figure.panelFollowups : {};
    const errors = figure?.panelFollowupErrors && typeof figure.panelFollowupErrors === 'object'
        ? figure.panelFollowupErrors : {};
    const loading = figure?.panelFollowupLoading?.[panelId] === true;
    const draft = getPanelFollowupDraft(figure.figureId, panelId);
    const root = createWorkspaceElement('section', 'workspace-panel-followup');
    root.dataset.panelFollowupKey = followupKey;
    const toggle = createWorkspaceElement(
        'button', 'btn btn-secondary workspace-panel-followup-toggle', '追问此 Panel'
    );
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', String(draft.open));
    const chooser = createWorkspaceElement('div', 'workspace-panel-followup-chooser');
    chooser.hidden = !draft.open;
    const choices = createWorkspaceElement('div', 'workspace-panel-followup-options');
    const presets = panelFollowupPresetOptions();
    presets.forEach(preset => {
        const choice = createWorkspaceElement('label', 'workspace-panel-followup-option');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = preset.id;
        checkbox.checked = draft.topics.has(preset.id);
        checkbox.addEventListener('change', () => {
            if (checkbox.checked) draft.topics.add(preset.id);
            else draft.topics.delete(preset.id);
        });
        choice.title = preset.prompt;
        choice.append(checkbox, document.createTextNode(preset.name));
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
        const presetIds = Array.from(chooser.querySelectorAll('input[type="checkbox"]:checked'))
            .map(input => input.value);
        const selectedPresets = presets.filter(preset => presetIds.includes(preset.id));
        const topics = [...new Set(selectedPresets.map(preset => preset.topic).filter(Boolean))];
        const customPresetQuestions = selectedPresets
            .filter(preset => !preset.topic)
            .map(preset => `${preset.name}：${preset.prompt}`);
        const question = [
            customQuestion.value.trim(),
            ...customPresetQuestions
        ].filter(Boolean).join('\n\n');
        const historyLabel = [
            selectedPresets.map(preset => preset.name).join('、'),
            customQuestion.value.trim()
        ].filter(Boolean).join('；');
        if (!presetIds.length && !question) {
            showStatus('请选择追问方向或输入自定义问题', 'error');
            return;
        }
        submit.disabled = true;
        submit.textContent = '正在向 LLM 追问…';
        const localStatus = root.querySelector('.workspace-panel-followup-status');
        if (localStatus) {
            localStatus.classList.add('is-loading');
            localStatus.textContent = `正在生成 Panel ${panelId} 的回答，完成后会自动定位到这里…`;
        }
        void runFigurePanelFollowup(
            figure.figureId, panelId, topics, question, historyLabel
        )
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
    root.appendChild(createWorkspaceElement(
        'p', `workspace-panel-followup-status${loading ? ' is-loading' : ''}`,
        loading
            ? `正在生成 Panel ${panelId} 的回答，完成后会自动定位到这里…`
            : (answer?.answer ? '回答已生成并显示在下方。' : '提交后，回答会直接显示在此 Panel 内。')
    ));
    appendPanelFollowupHistory(root, figure, panelId, answer);
    if (answer?.answer) {
        const result = createWorkspaceElement('section', 'workspace-panel-followup-answer');
        result.tabIndex = -1;
        result.setAttribute('aria-live', 'polite');
        result.dataset.panelFollowupAnswer = followupKey;
        if (panelFollowupRevealKey === followupKey) {
            result.classList.add('is-newly-revealed');
        }
        result.appendChild(createWorkspaceElement('strong', '', `Panel ${panelId} 追问回答`));
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

function revealPanelFollowupAnswer(followupKey) {
    const selector = `[data-panel-followup-answer="${CSS.escape(followupKey)}"]`;
    const answer = document.querySelector(selector);
    if (!answer) return false;
    answer.classList.add('is-newly-revealed');
    answer.scrollIntoView({ behavior: 'smooth', block: 'center' });
    answer.focus({ preventScroll: true });
    setTimeout(() => answer.classList.remove('is-newly-revealed'), 520);
    return true;
}

function stabilizePanelFollowupAnswer(followupKey) {
    const selector = `[data-panel-followup-answer="${CSS.escape(followupKey)}"]`;
    const answer = document.querySelector(selector);
    if (!answer) return false;
    const view = answer.closest('[data-workspace-view="figures"]');
    const answerRect = answer.getBoundingClientRect();
    const viewRect = view?.getBoundingClientRect();
    const inViewport = Boolean(viewRect && answerRect.bottom >= viewRect.top &&
        answerRect.top <= viewRect.bottom);
    if (!inViewport) answer.scrollIntoView({ behavior: 'auto', block: 'center' });
    if (document.activeElement !== answer) answer.focus({ preventScroll: true });
    return true;
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
            '图注中没有稳定的 Panel 标签；仍可使用上方“解图”。'
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
        panelDetails.appendChild(appendFigurePanelSummary(
            createWorkspaceElement('summary'),
            panel,
            {
                panelId,
                loading,
                analyzed,
                formattedHeader: analyzed ? formatFigurePanelHeader(panel) : ''
            }
        ));
        const actions = createWorkspaceElement('div', 'workspace-panel-actions');
        const analyze = createWorkspaceElement(
            'button', 'btn btn-figure workspace-panel-analyze',
            loading ? '正在解读此 Panel…' : (analyzed ? '重新解读此 Panel' : '解读此 Panel')
        );
        analyze.type = 'button';
        analyze.disabled = loading;
        analyze.title = hasUsableLlm()
            ? '解读此 Panel'
            : llmUnavailableMessage('Panel 解读');
        analyze.addEventListener('click', () => {
            figureExpansionState.set(figure.figureId, true);
            figurePanelExpansionState.set(panelKey, true);
            void runSingleFigurePanelAnalysis(figure.figureId, panelId);
        });
        const ask = createWorkspaceElement(
            'button', 'btn btn-secondary workspace-panel-ask', '提问此 Panel'
        );
        ask.type = 'button';
        ask.disabled = false;
        ask.title = hasUsableLlm()
            ? '围绕此 Panel 继续追问'
            : llmUnavailableMessage('Panel 追问');
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
            appendFigureWorkspaceField(
                block, '本图任务', CROSS_FIGURE_ROLE_LABELS[node.role] || node.role
            );
            appendFigureWorkspaceField(block, '本图确立', node.established);
            appendFigureWorkspaceField(block, '为何进入下一图', node.transition);
            appendFigureWorkspaceField(
                block, '证据等级',
                CROSS_FIGURE_EVIDENCE_LABELS[node.evidenceLevel] || node.evidenceLevel
            );
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
    const phase = String(status?.phase || '').toLowerCase();
    if (status?.running === false ||
        ['idle', 'completed', 'partial', 'failed', 'cancelled'].includes(phase)) {
        return false;
    }
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
    const batchRecognizedPanelCount = Number.isFinite(Number(progress.batchRecognizedPanelCount))
        ? Math.max(0, Number(progress.batchRecognizedPanelCount)) : null;
    const unexpectedPanels = Array.isArray(progress.unexpectedPanels)
        ? progress.unexpectedPanels.map(String).slice(0, 30) : [];
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
        figure_panel_planning: '正在规划 Panel 证据输入',
        figure_panel_schema_retry: 'Panel 返回结构不完整，正在自动修正',
        figure_panel_transient_retry: 'Panel 请求暂时失败，正在等待自动重试',
        figure_panel_token_retry: '正在调整 Panel 输出令牌上限',
        figure_panel_output_retry: '正在增加 Panel 输出令牌上限',
        figure_panel_retry: '正在降低 Panel 输入容量',
        figure_panel_complete: 'Panel 解读已完成',
        figure_compact_fallback: '整图返回不稳定，已切换为 Panel 提取后再综合',
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
    if (batchRecognizedPanelCount !== null) {
        details.push(`本批有效 Panel：${batchRecognizedPanelCount}`);
    }
    const ignoredUnexpectedPanelCount = Math.max(
        0, Number(progress.ignoredUnexpectedPanelCount) || unexpectedPanels.length
    );
    if (ignoredUnexpectedPanelCount) {
        const labels = unexpectedPanels.length ? `（${unexpectedPanels.join('、')}）` : '';
        details.push(`已忽略模型重复返回的 ${ignoredUnexpectedPanelCount} 个批次外 Panel${labels}`);
    }
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
    block.dataset.figureId = String(progress.figureId || '');
    block.appendChild(createWorkspaceElement('p', 'workspace-figure-progress-phase', display.phaseText));
    display.details.forEach(detail => {
        const line = createWorkspaceElement('p', 'workspace-figure-progress-detail', detail);
        if (detail.startsWith('已用时 ')) line.dataset.figureElapsed = 'true';
        block.appendChild(line);
    });
    details.appendChild(block);
}

function figureProgressUiSignature(status = {}) {
    const progressEntries = getFigureProgressEntries(status).map(progress => {
        const route = progress?.route && typeof progress.route === 'object'
            ? progress.route : {};
        return {
            figureId: String(progress?.figureId || ''),
            figureLabel: String(progress?.figureLabel || ''),
            phase: String(progress?.phase || ''),
            running: progress?.running === true,
            failed: progress?.failed === true,
            completed: progress?.completed === true,
            cacheHit: progress?.cacheHit === true,
            expectedPanels: Array.isArray(progress?.expectedPanels)
                ? progress.expectedPanels.map(String) : [],
            expectedPanelCount: Number(progress?.expectedPanelCount) || 0,
            recognizedPanelCount: Number(progress?.recognizedPanelCount) || 0,
            batchRecognizedPanelCount: Number(progress?.batchRecognizedPanelCount) || 0,
            unexpectedPanels: Array.isArray(progress?.unexpectedPanels)
                ? progress.unexpectedPanels.map(String) : [],
            ignoredUnexpectedPanelCount:
                Number(progress?.ignoredUnexpectedPanelCount) || 0,
            completedPanelBatches: Number(progress?.completedPanelBatches) || 0,
            totalPanelBatches: Number(progress?.totalPanelBatches) || 0,
            completedFigures: Number(progress?.completedFigures) || 0,
            totalFigures: Number(progress?.totalFigures) || 0,
            capabilityMode: String(progress?.capabilityMode || ''),
            visionFallback: progress?.visionFallback === true,
            waitMs: Number(progress?.waitMs) || 0,
            attempt: Number(progress?.attempt) || 0,
            providerId: String(progress?.providerId || ''),
            model: String(progress?.model || ''),
            route: {
                effectiveProfileName: String(route.effectiveProfileName || ''),
                name: String(route.name || ''),
                model: String(route.model || ''),
                capabilityMode: String(route.capabilityMode || ''),
                fallbackReason: String(route.fallbackReason || '')
            }
        };
    }).sort((left, right) => left.figureId.localeCompare(right.figureId));
    return JSON.stringify(progressEntries);
}

function updateFigureElapsedLabels(status = {}) {
    const progressById = new Map(getFigureProgressEntries(status)
        .map(progress => [String(progress?.figureId || ''), progress])
        .filter(([figureId]) => Boolean(figureId)));
    document.querySelectorAll('.workspace-figure-progress[data-figure-id]').forEach(block => {
        const progress = progressById.get(block.dataset.figureId || '');
        if (!progress) return;
        const elapsed = formatFigureElapsed(progress);
        let line = block.querySelector('[data-figure-elapsed="true"]');
        if (!elapsed) {
            line?.remove();
            return;
        }
        if (!line) {
            line = createWorkspaceElement('p', 'workspace-figure-progress-detail');
            line.dataset.figureElapsed = 'true';
            block.appendChild(line);
        }
        if (line.textContent !== elapsed) line.textContent = elapsed;
    });
}

function workspaceAnchorToken(value) {
    return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80) || 'item';
}

function navigateFigureQuickAnchor(figureId, panelId = '', {
    collapsePanels = false
} = {}) {
    figureQuickNavActiveId = figureId;
    const figures = currentWorkspaceSnapshot?.figures?.figures || [];
    figures.forEach(figure => {
        figureExpansionState.set(figure.figureId, figure.figureId === figureId);
    });
    for (const key of figurePanelExpansionState.keys()) {
        if (collapsePanels || !key.startsWith(`${figureId}::`)) {
            figurePanelExpansionState.set(key, false);
        }
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

function followFigureOriginalViewerInSidebar(figureId) {
    if (!figureId) return;
    switchWorkspaceView('figures');
    navigateFigureQuickAnchor(figureId, '', { collapsePanels: true });
}

function figureCaptionPanelLabel(block, blockCount) {
    const panels = Array.isArray(block?.panels)
        ? block.panels.map(value => String(value || '').toUpperCase()).filter(Boolean)
        : [];
    if (!panels.length) return blockCount > 1 ? '整图说明' : '整图图注';
    const contiguous = panels.every((panel, index) =>
        index === 0 ||
        panel.charCodeAt(0) === panels[index - 1].charCodeAt(0) + 1
    );
    return contiguous && panels.length > 1
        ? `Panel ${panels[0]}–${panels.at(-1)}`
        : `Panel ${panels.join('、')}`;
}

function figureCaptionBlocks(figure) {
    const stored = Array.isArray(figure?.captionBlocks)
        ? figure.captionBlocks.filter(block => String(block?.text || '').trim())
        : [];
    if (stored.length) return stored;
    if (typeof SciLLM.splitFigureCaptionByPanelGroups === 'function') {
        return SciLLM.splitFigureCaptionByPanelGroups(figure?.caption || '');
    }
    const caption = String(figure?.caption || '').trim();
    return caption ? [{ kind: 'overview', panels: [], text: caption }] : [];
}

function renderFigureCaptionSidebarSnapshot(
    snapshot = currentWorkspaceSnapshot,
    figureId = figureCaptionSidebarState.figureId
) {
    const container = document.getElementById('figureWorkspace');
    if (!container) return;
    container.classList.add('is-caption-mode');
    container.replaceChildren();
    const figures = Array.isArray(snapshot?.figures?.figures)
        ? snapshot.figures.figures : [];
    const figure = figures.find(item => item.figureId === figureId) || null;
    const summary = document.getElementById('figureWorkspaceSummary');
    if (summary) {
        summary.textContent = figure
            ? `${figure.figureLabel || figure.figureId} · 图注`
            : '正在读取当前 Figure 图注…';
    }
    renderFigureQuickNav([]);
    if (!figure) {
        container.appendChild(createWorkspaceElement(
            'div',
            'workspace-empty',
            '暂未取得当前 Figure 图注，正在刷新论文图片目录…'
        ));
        return;
    }
    const heading = createWorkspaceElement(
        'section',
        'workspace-figure-caption-heading'
    );
    heading.append(
        createWorkspaceElement(
            'h3',
            'workspace-figure-caption-title',
            figure.figureLabel || figure.figureId || 'Figure 图注'
        ),
        createWorkspaceElement(
            'p',
            'workspace-figure-caption-hint',
            '以下内容直接来自网页图注；合并描述的 Panel 保持为同一块。'
        )
    );
    container.appendChild(heading);
    const blocks = figureCaptionBlocks(figure);
    if (!blocks.length) {
        container.appendChild(createWorkspaceElement(
            'div',
            'workspace-empty',
            '该 Figure 暂无可读取的网页图注。'
        ));
        return;
    }
    blocks.forEach(block => {
        const section = createWorkspaceElement(
            'section',
            'workspace-figure-caption-block'
        );
        const panels = Array.isArray(block?.panels)
            ? block.panels.map(String).filter(Boolean) : [];
        section.dataset.panels = panels.join(',');
        section.append(
            createWorkspaceElement(
                'h4',
                'workspace-figure-caption-block-title',
                figureCaptionPanelLabel(block, blocks.length)
            ),
            createWorkspaceElement(
                'p',
                'workspace-figure-caption-block-text',
                String(block?.text || '').trim()
            )
        );
        container.appendChild(section);
    });
}

function showFigureCaptionSidebar(figureId) {
    if (!figureId) return;
    figureCaptionSidebarState = {
        visible: true,
        figureId
    };
    switchWorkspaceView('figures');
    renderFigureCaptionSidebarSnapshot(currentWorkspaceSnapshot, figureId);
    const figures = currentWorkspaceSnapshot?.figures?.figures || [];
    if (!figures.some(figure => figure.figureId === figureId)) {
        void refreshArticleWorkspace();
    }
}

function hideFigureCaptionSidebar(figureId = '') {
    const restoreFigureId = String(
        figureId || figureCaptionSidebarState.figureId || ''
    );
    figureCaptionSidebarState = {
        visible: false,
        figureId: ''
    };
    const container = document.getElementById('figureWorkspace');
    container?.classList.remove('is-caption-mode');
    renderFigureWorkspaceSnapshot(currentWorkspaceSnapshot);
    if (restoreFigureId) {
        followFigureOriginalViewerInSidebar(restoreFigureId);
    }
}

function isEditableKeyboardTarget(target) {
    return target instanceof Element && Boolean(target.closest(
        'input, textarea, select, [contenteditable="true"], [contenteditable=""], dialog'
    ));
}

function figureKeyboardNumber(figure) {
    const direct = Number(figure?.figureNumber);
    if (Number.isInteger(direct) && direct > 0) return direct;
    const labelMatch = String(figure?.figureLabel || '')
        .match(/\b(?:figure|fig\.?)\s*([0-9]{1,3})\b/i);
    if (labelMatch) return Number(labelMatch[1]);
    const idMatch = String(figure?.figureId || '').match(/^figure-([0-9]{1,3})$/i);
    return idMatch ? Number(idMatch[1]) : 0;
}

function currentFigureKeyboardTarget(figures) {
    const items = Array.isArray(figures) ? figures : [];
    return items.find(figure => figure.figureId === figureQuickNavActiveId) ||
        items.find(figure => figureExpansionState.get(figure.figureId) === true) ||
        items.find(figure => !figure.isSupplemental) ||
        items[0] || null;
}

function navigateFigureKeyboardTarget(figure, panelId = '') {
    if (!figure?.figureId) return false;
    const normalizedPanelId = String(panelId || '').trim().toUpperCase();
    if (normalizedPanelId) {
        const result = figure.activeDepth === 'standard'
            ? figure.standard : (figure.deep || figure.standard);
        const panelIds = figureCatalogPanelIds(figure, result);
        if (!panelIds.includes(normalizedPanelId)) {
            showStatus(
                `${figure.figureLabel || figure.figureId} 没有可跳转的 Panel ${normalizedPanelId}`,
                'error'
            );
            return false;
        }
    }
    switchWorkspaceView('figures');
    navigateFigureQuickAnchor(figure.figureId, normalizedPanelId);
    void focusWorkspaceSource({
        kind: 'figure',
        figureId: figure.figureId
    }).catch(() => false);
    showStatus(
        normalizedPanelId
            ? `已跳转到 ${figure.figureLabel || figure.figureId} · Panel ${normalizedPanelId}`
            : `已跳转到 ${figure.figureLabel || figure.figureId}`,
        'success'
    );
    return true;
}

function figureKeyboardResult(figure) {
    return figure?.activeDepth === 'standard'
        ? figure.standard : (figure?.deep || figure?.standard);
}

function currentFigurePanelKeyboardTarget(figure, panelIds) {
    const focusedPanel = document.activeElement instanceof Element
        ? document.activeElement.closest('.workspace-figure-panel-card[data-panel-id]')
        : null;
    if (focusedPanel?.dataset?.figureId === figure?.figureId &&
        panelIds.includes(String(focusedPanel.dataset.panelId || '').toUpperCase())) {
        return String(focusedPanel.dataset.panelId || '').toUpperCase();
    }
    return panelIds.find(panelId =>
        figurePanelExpansionState.get(panelWorkspaceKey(figure.figureId, panelId)) === true
    ) || panelIds[0] || '';
}

function adjacentFigureKeyboardTarget(figures, currentFigure, offset) {
    if (!figures.length) return null;
    const foundIndex = figures.findIndex(figure =>
        figure.figureId === currentFigure?.figureId
    );
    const currentIndex = foundIndex >= 0 ? foundIndex : 0;
    return figures[(currentIndex + offset + figures.length) % figures.length] || null;
}

function handleFigureKeyboardShortcut(event) {
    if (!figureKeyboardShortcutArmed || event.defaultPrevented || event.isComposing ||
        event.repeat || event.ctrlKey || event.metaKey || event.altKey ||
        isEditableKeyboardTarget(event.target)) return;
    const figures = Array.isArray(currentWorkspaceSnapshot?.figures?.figures)
        ? currentWorkspaceSnapshot.figures.figures : [];
    if (!figures.length) return;
    let handled = false;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        const currentFigure = currentFigureKeyboardTarget(figures);
        const targetFigure = adjacentFigureKeyboardTarget(
            figures,
            currentFigure,
            event.key === 'ArrowLeft' ? -1 : 1
        );
        if (targetFigure) {
            const panelIds = figureCatalogPanelIds(
                targetFigure,
                figureKeyboardResult(targetFigure)
            );
            handled = navigateFigureKeyboardTarget(
                targetFigure,
                panelIds.includes('A') ? 'A' : (panelIds[0] || '')
            );
        }
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        const figure = currentFigureKeyboardTarget(figures);
        if (figure) {
            const panelIds = figureCatalogPanelIds(figure, figureKeyboardResult(figure));
            const currentPanelId = currentFigurePanelKeyboardTarget(figure, panelIds);
            const currentIndex = Math.max(0, panelIds.indexOf(currentPanelId));
            const targetIndex = Math.max(
                0,
                Math.min(
                    panelIds.length - 1,
                    currentIndex + (event.key === 'ArrowUp' ? -1 : 1)
                )
            );
            if (panelIds[targetIndex]) {
                handled = navigateFigureKeyboardTarget(figure, panelIds[targetIndex]);
            }
        }
    } else if (/^[1-9]$/.test(event.key)) {
        const requestedNumber = Number(event.key);
        const figure = figures.find(item =>
            !item.isSupplemental && figureKeyboardNumber(item) === requestedNumber
        );
        if (figure) {
            handled = navigateFigureKeyboardTarget(figure);
        } else {
            showStatus(`当前论文没有 Figure ${requestedNumber}`, 'error');
            handled = true;
        }
    }
    if (handled) event.preventDefault();
}

function currentKeyboardShortcuts() {
    return SciLLM.normalizeKeyboardShortcuts(
        llmSettingsState?.settings?.keyboardShortcuts
    );
}

function clickShortcutControl(elementId) {
    const control = document.getElementById(elementId);
    if (!control) return false;
    control.click();
    return true;
}

function runGlobalKeyboardShortcut(actionId) {
    const workspaceTargets = {
        figures: 'figures',
        navigation: 'navigation',
        analysis: 'analysis',
        highlights: 'highlights',
        chat: 'chat'
    };
    if (workspaceTargets[actionId]) {
        openWorkspaceView(workspaceTargets[actionId]);
        return true;
    }
    if (actionId === 'collapseFigurePanels') {
        if (activeWorkspaceView !== 'figures') return false;
        collapseAllFigurePanels();
        return true;
    }
    const controlIds = {
        zotero: 'exportEnhancedSnapshotToZotero',
        ppt: 'exportPptMaterials',
        scanLocal: 'scanArticleWorkspace',
        saveLocal: 'saveCurrentArticleWorkspace',
        deleteLocal: 'clearArticleWorkspace',
        exportJson: 'exportCurrentArticleArchive',
        importJson: 'importCurrentArticleArchiveButton',
        settings: 'openSidePanelSettings'
    };
    return clickShortcutControl(controlIds[actionId]);
}

async function openFigureOneOriginalFromShortcut() {
    switchWorkspaceView('figures');
    let snapshot = currentWorkspaceSnapshot;
    let figures = Array.isArray(snapshot?.figures?.figures)
        ? snapshot.figures.figures : [];
    if (!figures.length) {
        snapshot = await refreshArticleWorkspace();
        figures = Array.isArray(snapshot?.figures?.figures)
            ? snapshot.figures.figures : [];
    }
    const figure = figures.find(item =>
        !item.isSupplemental && figureKeyboardNumber(item) === 1
    );
    if (!figure?.figureId) {
        showStatus('当前论文没有可打开的 Figure 1', 'error');
        return false;
    }
    followFigureOriginalViewerInSidebar(figure.figureId);
    try {
        await showFigureOriginalImage(figure.figureId);
        return true;
    } catch (error) {
        showStatus(error.message, 'error');
        return false;
    }
}

function runGlobalKeyboardShortcutKey(value) {
    if (figureOriginalViewerState.open) return false;
    const key = SciLLM.normalizeKeyboardShortcutKey(value, '');
    if (!key) return false;
    const shortcuts = currentKeyboardShortcuts();
    const definition = SciLLM.KEYBOARD_SHORTCUT_DEFINITIONS.find(item =>
        shortcuts[item.actionId] === key
    );
    if (!definition) return false;
    if (definition.actionId === 'figures') {
        const pressedAt = Date.now();
        const doublePressed = lastFigureModuleShortcutPress.key === key &&
            pressedAt - lastFigureModuleShortcutPress.pressedAt <= 450;
        lastFigureModuleShortcutPress = doublePressed
            ? { key: '', pressedAt: 0 }
            : { key, pressedAt };
        if (doublePressed) {
            void openFigureOneOriginalFromShortcut();
            return true;
        }
    } else {
        lastFigureModuleShortcutPress = {
            key: '',
            pressedAt: 0
        };
    }
    return runGlobalKeyboardShortcut(definition.actionId);
}

function handleGlobalKeyboardShortcut(event) {
    if (event.defaultPrevented || event.isComposing ||
        event.repeat || event.ctrlKey || event.metaKey || event.altKey ||
        isEditableKeyboardTarget(event.target) ||
        !runGlobalKeyboardShortcutKey(event.key)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
}

function setupGlobalKeyboardShortcuts() {
    document.addEventListener('keydown', handleGlobalKeyboardShortcut, true);
    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local' || !changes.sciLlmSettingsV2) return;
        void sendLlmMessage({ type: 'LLM_GET_SETTINGS' })
            .then(nextState => {
                llmSettingsState = nextState;
                return publishSidePanelShortcutScope();
            })
            .catch(() => undefined);
    });
}

function figureOriginalViewerDirection(key) {
    return {
        ArrowLeft: 'previous',
        ArrowRight: 'next',
        ArrowUp: 'first',
        ArrowDown: 'last'
    }[key] || '';
}

async function syncFigureOriginalViewerState() {
    const tab = await queryPanelTargetTab();
    if (!tab?.id || !activePanelTabContext.activated ||
        Number(tab.id) !== Number(activePanelTabContext.tabId)) {
        const previousCaptionVisible = figureOriginalViewerState.captionVisible === true;
        figureOriginalViewerState = {
            open: false,
            tabId: tab?.id ?? null,
            figureId: '',
            captionVisible: false,
            requestSequence: figureOriginalViewerState.requestSequence + 1
        };
        if (previousCaptionVisible) hideFigureCaptionSidebar();
        return figureOriginalViewerState;
    }
    const requestSequence = ++figureOriginalViewerState.requestSequence;
    try {
        const response = await sendTabMessage(tab.id, {
            action: 'getFigureOriginalImageState'
        });
        if (requestSequence !== figureOriginalViewerState.requestSequence) {
            return figureOriginalViewerState;
        }
        const previousCaptionVisible = figureOriginalViewerState.captionVisible === true;
        figureOriginalViewerState = {
            open: response?.success === true && response?.open === true,
            tabId: tab.id,
            figureId: String(response?.figureId || ''),
            captionVisible: response?.captionVisible === true,
            requestSequence
        };
        if (figureOriginalViewerState.open &&
            figureOriginalViewerState.captionVisible &&
            figureOriginalViewerState.figureId) {
            showFigureCaptionSidebar(figureOriginalViewerState.figureId);
        } else if (previousCaptionVisible) {
            hideFigureCaptionSidebar(figureOriginalViewerState.figureId);
        }
    } catch (_) {
        if (requestSequence === figureOriginalViewerState.requestSequence) {
            const previousCaptionVisible = figureOriginalViewerState.captionVisible === true;
            figureOriginalViewerState = {
                open: false,
                tabId: tab.id,
                figureId: '',
                captionVisible: false,
                requestSequence
            };
            if (previousCaptionVisible) hideFigureCaptionSidebar();
        }
    }
    return figureOriginalViewerState;
}

async function forwardFigureOriginalViewerKey(key) {
    const tabId = Number(figureOriginalViewerState.tabId);
    if (!Number.isInteger(tabId)) return;
    const requestSequence = ++figureOriginalViewerState.requestSequence;
    const direction = figureOriginalViewerDirection(key);
    const figureNumber = /^[0-9]$/.test(key)
        ? (key === '0' ? 10 : Number(key)) : 0;
    const isNavigation = Boolean(direction || figureNumber);
    if (key === 'Escape') {
        const previousCaptionVisible = figureOriginalViewerState.captionVisible === true;
        figureOriginalViewerState = {
            open: false,
            tabId,
            figureId: '',
            captionVisible: false,
            requestSequence
        };
        if (previousCaptionVisible) hideFigureCaptionSidebar();
    }
    try {
        const response = await sendTabMessage(tabId, isNavigation ? {
            action: 'navigateFigureOriginalImage',
            direction,
            figureNumber
        } : {
            action: 'closeFigureOriginalImage'
        });
        if (requestSequence !== figureOriginalViewerState.requestSequence) return;
        if (isNavigation && response?.success) {
            figureOriginalViewerState = {
                open: response.open !== false,
                tabId,
                figureId: String(response.figureId || ''),
                captionVisible: response.captionVisible === true,
                requestSequence
            };
            if (response.figureId) {
                if (response.captionVisible === true) {
                    showFigureCaptionSidebar(String(response.figureId));
                } else {
                    followFigureOriginalViewerInSidebar(String(response.figureId));
                }
            }
        } else if (!isNavigation || response?.code === 'VIEWER_NOT_OPEN') {
            const previousCaptionVisible = figureOriginalViewerState.captionVisible === true;
            figureOriginalViewerState = {
                open: false,
                tabId,
                figureId: '',
                captionVisible: false,
                requestSequence
            };
            if (previousCaptionVisible) hideFigureCaptionSidebar();
        }
    } catch (_) {
        if (requestSequence === figureOriginalViewerState.requestSequence) {
            const previousCaptionVisible = figureOriginalViewerState.captionVisible === true;
            figureOriginalViewerState = {
                open: false,
                tabId,
                figureId: '',
                captionVisible: false,
                requestSequence
            };
            if (previousCaptionVisible) hideFigureCaptionSidebar();
        }
    }
}

function handleFigureOriginalViewerKeyboard(event) {
    const direction = figureOriginalViewerDirection(event.key);
    const figureNumberKey = /^[0-9]$/.test(event.key);
    if (!figureOriginalViewerState.open ||
        (!direction && !figureNumberKey && event.key !== 'Escape') ||
        event.defaultPrevented || event.isComposing || event.repeat ||
        event.ctrlKey || event.metaKey || event.altKey ||
        isEditableKeyboardTarget(event.target)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void forwardFigureOriginalViewerKey(event.key);
}

function setupFigureKeyboardNavigation() {
    const eligibleSelector = '#sidePanelApp';
    document.addEventListener('keydown', handleFigureOriginalViewerKeyboard, true);
    document.addEventListener('pointermove', event => {
        figureKeyboardShortcutArmed = event.target instanceof Element &&
            Boolean(event.target.closest(eligibleSelector));
    }, { passive: true });
    document.addEventListener('pointerleave', () => {
        figureKeyboardShortcutArmed = false;
    });
    document.addEventListener('keydown', handleFigureKeyboardShortcut);
    document.querySelector(eligibleSelector)?.addEventListener('pointerenter', () => {
        void syncFigureOriginalViewerState();
    });
    window.addEventListener('focus', () => {
        void syncFigureOriginalViewerState();
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
            figureQuickNavExpandedFigureId = panelIds.length ? figure.figureId : '';
            item.classList.toggle('show-panels', panelIds.length > 0);
            figureQuickNavActiveId = figure.figureId;
            nav.querySelectorAll('.figure-quick-nav-marker').forEach(button => {
                const owner = button.closest('.figure-quick-nav-item');
                button.setAttribute('aria-current', String(owner?.dataset.figureId === figure.figureId));
            });
        };
        item.addEventListener('mouseenter', activateItem);
        item.addEventListener('focusin', activateItem);
        item.addEventListener('mouseleave', () => {
            clearTimeout(figureQuickNavHoverTimer);
            figureQuickNavHoverTimer = setTimeout(closePanels, 45);
        });
        item.addEventListener('focusout', event => {
            if (item.contains(event.relatedTarget)) return;
            clearTimeout(figureQuickNavHoverTimer);
            figureQuickNavHoverTimer = setTimeout(closePanels, 45);
        });
        item.append(marker, flyout);
        figureMarkers.appendChild(item);
    });
    nav.appendChild(figureMarkers);
    const closeAllPanelFlyouts = () => {
        nav.querySelectorAll('.figure-quick-nav-item.show-panels').forEach(item => {
            item.classList.remove('show-panels');
        });
        figureQuickNavExpandedFigureId = '';
    };
    const scheduleCloseAllPanelFlyouts = () => {
        clearTimeout(figureQuickNavHoverTimer);
        figureQuickNavHoverTimer = setTimeout(() => {
            if (!nav.matches(':hover') && !nav.matches(':focus-within')) {
                closeAllPanelFlyouts();
            }
        }, 45);
    };
    // Item-level leave handlers cover normal pointer travel. These container
    // handlers also close a flyout after fast movement, forced pointer events,
    // or a focus transition that skips the originating item.
    nav.onmouseleave = scheduleCloseAllPanelFlyouts;
    nav.onfocusout = event => {
        if (!nav.contains(event.relatedTarget)) scheduleCloseAllPanelFlyouts();
    };
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
    document.querySelectorAll('#figureQuickNav .figure-quick-nav-marker').forEach(marker => {
        const owner = marker.closest('.figure-quick-nav-item');
        marker.setAttribute('aria-current', String(owner?.dataset.figureId === figureId));
    });
}

function renderFigureWorkspaceSnapshot(snapshot = currentWorkspaceSnapshot) {
    const container = document.getElementById('figureWorkspace');
    if (!container) return;
    if (figureCaptionSidebarState.visible) {
        renderFigureCaptionSidebarSnapshot(
            snapshot,
            figureCaptionSidebarState.figureId
        );
        return;
    }
    container.classList.remove('is-caption-mode');
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
        const jump = createWorkspaceElement(
            'button', 'btn btn-secondary workspace-figure-action', '图注'
        );
        jump.type = 'button';
        jump.addEventListener('click', () => void focusWorkspaceSource({
            kind: 'figure', figureId: figure.figureId
        }));
        const original = createWorkspaceElement(
            'button', 'btn btn-secondary workspace-figure-action', '原图'
        );
        original.type = 'button';
        original.disabled = !figure.hasImage;
        original.addEventListener('click', () => {
            void showFigureOriginalImage(figure.figureId).catch(error =>
                showStatus(error.message, 'error'));
        });
        const analyze = createWorkspaceElement(
            'button', 'btn btn-figure workspace-figure-action',
            loading ? '解图中…' : '解图'
        );
        analyze.type = 'button';
        analyze.classList.add('workspace-figure-analyze-action');
        analyze.disabled = loading;
        analyze.title = hasUsableLlm()
            ? '解读此 Figure'
            : llmUnavailableMessage('Figure 解读');
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
            if (result.unlabeledOverview === true) {
                details.appendChild(createWorkspaceElement(
                    'p', 'workspace-figure-coverage',
                    '网页图注未提供稳定的 Panel 标签；以下为整图证据概览，未臆造 Panel 编号。'
                ));
            }
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
                    const panelRefs = (step.panels || []).join('\u3001');
                    if (panelRefs) {
                        appendFigureWorkspaceField(block, `\u6b65\u9aa4 ${index + 1} Panel`, panelRefs);
                    }
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
                    const panelRefs = (relation.panels || []).join('\u3001');
                    if (panelRefs) appendFigureWorkspaceField(block, 'Panel', panelRefs);
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
    workspaceGeneration = Math.max(1,
        Number(snapshot?.localWorkspace?.workspaceGeneration) || workspaceGeneration || 1
    );
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
            return (profile.providerId === 'codex-local' || config.hasApiKey === true) &&
                Boolean(String(config.model || '').trim()) &&
                (profile.providerId !== 'openai-compatible' || Boolean(String(config.baseUrl || '').trim()));
        });
}

function hasUsableLlm() {
    if (llmSettingsState?.llmReady === true) return true;
    if (llmSettingsState?.settings?.consentGranted !== true) return false;
    return getArticleChatProfiles().length > 0;
}

function llmUnavailableMessage(featureLabel = '该功能') {
    const profiles = getArticleChatProfiles();
    if (profiles.length > 0 &&
        llmSettingsState?.settings?.consentGranted !== true) {
        return `${featureLabel}的模型已配置；请在设置的“正文发送许可”中勾选同意并保存。`;
    }
    return `请先在设置中保存可供${featureLabel}使用的模型。`;
}

function requireUsableLlm(featureLabel) {
    if (hasUsableLlm()) return true;
    showStatus(llmUnavailableMessage(featureLabel), 'error');
    return false;
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

function renderArticleChatHighlightCategoryOptions() {
    const select = document.getElementById('articleChatHighlightCategory');
    if (!select) return;
    const previous = select.value;
    const previousColor = document.getElementById('articleChatHighlightColor')?.value;
    const categories = getAvailableCategoryEntries(
        llmSettingsState?.availableCategories,
        'llm'
    );
    select.replaceChildren();
    categories.forEach(([categoryId, category]) => {
        const option = document.createElement('option');
        option.value = categoryId;
        option.textContent = category.name || categoryId;
        option.dataset.categoryName = category.name || categoryId;
        option.dataset.categoryColor = category.color || '#2F80ED';
        select.appendChild(option);
    });
    const preferred = categories.some(([categoryId]) => categoryId === previous)
        ? previous
        : categories.some(([categoryId]) => categoryId === 'semantic_match')
            ? 'semantic_match' : (categories[0]?.[0] || '');
    select.value = preferred;
    select.disabled = categories.length === 0;
    if (!(previous && preferred === previous && /^#[0-9a-f]{6}$/i.test(previousColor || ''))) {
        syncArticleChatHighlightColor();
    }
}

function syncArticleChatHighlightColor() {
    const select = document.getElementById('articleChatHighlightCategory');
    const color = document.getElementById('articleChatHighlightColor');
    const selected = select?.selectedOptions?.[0];
    if (color && selected?.dataset.categoryColor) {
        color.value = selected.dataset.categoryColor;
    }
}

function articleChatOutlineScopes(snapshot = currentWorkspaceSnapshot) {
    const results = [];
    const seen = new Set();
    const visit = (nodes, depth = 0) => {
        (Array.isArray(nodes) ? nodes : []).forEach(node => {
            const sectionId = String(node?.sectionId || '');
            const title = String(node?.displayTitle || node?.title || '').trim();
            const sectionIds = (Array.isArray(node?.analysisSectionIds)
                ? node.analysisSectionIds : [sectionId])
                .map(value => String(value || '')).filter(Boolean);
            const paragraphCount = (Array.isArray(snapshot?.paragraphs)
                ? snapshot.paragraphs : []).filter(paragraph =>
                sectionIds.includes(String(paragraph?.sectionId || ''))
            ).length;
            if (sectionId && title && sectionIds.length && !seen.has(sectionId) &&
                paragraphCount > 0) {
                seen.add(sectionId);
                results.push({
                    id: sectionId,
                    name: title,
                    detail: `${String(node?.sectionKind || '章节')} · ${paragraphCount} 段`,
                    sectionIds,
                    depth: Math.max(0, depth)
                });
            }
            visit(node?.children, depth + 1);
        });
    };
    visit(snapshot?.nodes);
    return results.slice(0, 120);
}

function selectedWorkspaceAnalysisSectionIds(snapshot = currentWorkspaceSnapshot) {
    const selected = new Set();
    const visit = nodes => {
        (Array.isArray(nodes) ? nodes : []).forEach(node => {
            if (node?.analysisSelected === true) {
                (Array.isArray(node.analysisSectionIds) ? node.analysisSectionIds : [])
                    .map(String).filter(Boolean).forEach(sectionId => selected.add(sectionId));
                return;
            }
            visit(node?.children);
        });
    };
    visit(snapshot?.nodes);
    return [...selected];
}

function articleChatQuickPrompts() {
    return (Array.isArray(llmSettingsState?.settings?.articleChatQuickPrompts)
        ? llmSettingsState.settings.articleChatQuickPrompts : [])
        .filter(item => item?.id && item?.name && item?.prompt)
        .map(item => ({
            id: String(item.id),
            name: String(item.name),
            detail: String(item.prompt),
            prompt: String(item.prompt)
        }));
}

function renderArticleChatContextScopes() {
    const container = document.getElementById('articleChatContextScopes');
    if (!container) return;
    container.replaceChildren();
    articleChatContextScopes.forEach(scope => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'article-chat-context-chip';
        button.dataset.scopeId = scope.id;
        button.title = `移除章节范围：${scope.name}`;
        const label = document.createElement('span');
        appendScientificInlineText(label, `@${scope.name}`);
        const icon = document.createElement('i');
        icon.className = 'ph ph-x';
        icon.setAttribute('aria-hidden', 'true');
        button.append(label, icon);
        container.appendChild(button);
    });
    container.hidden = articleChatContextScopes.size === 0;
}

function articleChatContextScopePayload() {
    const sectionIds = [];
    const sectionTitles = [];
    const seen = new Set();
    articleChatContextScopes.forEach(scope => {
        sectionTitles.push(scope.name);
        scope.sectionIds.forEach(sectionId => {
            if (!seen.has(sectionId)) {
                seen.add(sectionId);
                sectionIds.push(sectionId);
            }
        });
    });
    return { sectionIds, sectionTitles };
}

function articleChatInputTrigger(input) {
    const caret = Math.max(0, Number(input?.selectionStart) || 0);
    const prefix = String(input?.value || '').slice(0, caret);
    const match = prefix.match(/(^|\s)([@/])([^\s@/]*)$/u);
    if (!match) return null;
    return {
        symbol: match[2],
        query: match[3].normalize('NFKC').toLowerCase(),
        start: caret - match[2].length - match[3].length,
        end: caret
    };
}

function closeArticleChatCommandMenu() {
    const menu = document.getElementById('articleChatCommandMenu');
    if (menu) {
        menu.hidden = true;
        menu.replaceChildren();
    }
    articleChatCommandItems = [];
    articleChatCommandActiveIndex = -1;
    articleChatCommandTrigger = null;
}

function setArticleChatCommandActive(index) {
    if (!articleChatCommandItems.length) return;
    articleChatCommandActiveIndex =
        (index + articleChatCommandItems.length) % articleChatCommandItems.length;
    document.querySelectorAll('.article-chat-command-option').forEach((node, itemIndex) => {
        const active = itemIndex === articleChatCommandActiveIndex;
        node.classList.toggle('is-active', active);
        node.setAttribute('aria-selected', active ? 'true' : 'false');
        if (active) node.scrollIntoView({ block: 'nearest' });
    });
}

function updateArticleChatCommandMenu() {
    const input = document.getElementById('articleChatQuestion');
    const menu = document.getElementById('articleChatCommandMenu');
    if (!input || !menu) return;
    const trigger = articleChatInputTrigger(input);
    if (!trigger) {
        closeArticleChatCommandMenu();
        return;
    }
    const source = trigger.symbol === '@'
        ? articleChatOutlineScopes()
        : articleChatQuickPrompts();
    const items = source.filter(item => {
        if (!trigger.query) return true;
        return `${item.name} ${item.detail}`.normalize('NFKC').toLowerCase()
            .includes(trigger.query);
    }).slice(0, 12);
    if (!items.length) {
        closeArticleChatCommandMenu();
        return;
    }
    articleChatCommandTrigger = trigger;
    articleChatCommandItems = items;
    articleChatCommandActiveIndex = 0;
    menu.replaceChildren();
    items.forEach((item, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'article-chat-command-option';
        button.dataset.commandIndex = String(index);
        button.setAttribute('role', 'option');
        button.setAttribute('aria-selected', index === 0 ? 'true' : 'false');
        const name = document.createElement('strong');
        appendScientificInlineText(name, `${trigger.symbol}${item.name}`);
        const meta = document.createElement('em');
        meta.textContent = trigger.symbol === '@' ? item.detail : '快捷提示';
        const detail = document.createElement('small');
        detail.textContent = item.detail;
        button.append(name, meta, detail);
        menu.appendChild(button);
    });
    menu.hidden = false;
}

function selectArticleChatCommand(index = articleChatCommandActiveIndex) {
    const item = articleChatCommandItems[index];
    const trigger = articleChatCommandTrigger;
    const input = document.getElementById('articleChatQuestion');
    if (!item || !trigger || !input) return false;
    if (trigger.symbol === '@') {
        articleChatContextScopes.set(item.id, item);
        input.setRangeText('', trigger.start, trigger.end, 'end');
        renderArticleChatContextScopes();
    } else {
        const replacement = `${item.prompt} `;
        input.setRangeText(replacement, trigger.start, trigger.end, 'end');
    }
    closeArticleChatCommandMenu();
    input.focus();
    return true;
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

function applyArticleChatCitationState(button, verification, citationNumber = 1, label = '') {
    const status = verification?.status || 'missing';
    button.classList.remove('is-verified', 'is-ambiguous', 'is-missing', 'is-stale');
    button.classList.add(`is-${status}`);
    button.dataset.verificationStatus = status;
    button.dataset.candidateCount = String(verification?.candidateCount || 0);
    button.disabled = status !== 'verified';
    button.textContent = status === 'verified' ? String(citationNumber) : '待核验';
    const statusText = status === 'verified'
        ? `参考原文 ${citationNumber} · ${label || '正文段落'}`
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
                button, citationResult, Number(button.dataset.citationNumber) || 1,
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

function createArticleChatInlineCitation(item, evidenceIndex, snapshot, citationNumber) {
    const verification = resolveArticleChatEvidenceTarget(item, snapshot);
    const button = createWorkspaceElement(
        'button', 'article-chat-inline-citation', String(citationNumber)
    );
    button.type = 'button';
    button.dataset.evidenceIndex = String(evidenceIndex);
    button.dataset.citationNumber = String(citationNumber);
    button.dataset.paragraphId = verification.target?.paragraphId || '';
    button.dataset.sourceKey = verification.target?.sourceKey || '';
    const label = item?.sectionTitle || '正文段落';
    const quote = String(item?.quote || item?.support || '').trim();
    applyArticleChatCitationState(button, verification, citationNumber, label);
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
    const tokenPattern = /(\[\[\d{1,3}\]\]|<sup>[^<\n]+<\/sup>|<sub>[^<\n]+<\/sub>|`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_)/gi;
    let cursor = 0;
    for (const match of text.matchAll(tokenPattern)) {
        if (match.index > cursor) parent.appendChild(document.createTextNode(text.slice(cursor, match.index)));
        const token = match[0];
        const citationMatch = token.match(/^\[\[(\d{1,3})\]\]$/);
        const scriptMatch = token.match(/^<(sup|sub)>([^<\n]+)<\/\1>$/i);
        if (citationMatch) {
            const marker = citationMatch[1];
            const evidenceIndex = (Array.isArray(context.evidence) ? context.evidence : [])
                .findIndex(item => String(item?.marker || '') === marker);
            const evidenceItem = evidenceIndex >= 0 ? context.evidence[evidenceIndex] : null;
            if (evidenceItem) {
                parent.appendChild(createArticleChatInlineCitation(
                    evidenceItem,
                    evidenceIndex,
                    context.snapshot,
                    Math.max(0, Number(context.citationNumberOffset) || 0) + evidenceIndex + 1
                ));
                context.citationIndexes?.add(evidenceIndex);
            } else {
                parent.appendChild(document.createTextNode(token));
            }
        } else if (scriptMatch) {
            parent.appendChild(createWorkspaceElement(
                scriptMatch[1].toLowerCase(), '', scriptMatch[2]
            ));
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
    if (turn.intent === 'highlight' && turn.highlightError) {
        return `检索已完成，但原文高亮定位失败：${turn.highlightError}`;
    }
    if (turn.intent === 'highlight' && turn.status === 'completed') {
        return `智能检索完成，已在原文高亮 ${Number(turn.matchCount) || 0} 处匹配。`;
    }
    if (turn.intent === 'highlight' && turn.status === 'generating') {
        return '正在理解检索意图并核对可回定位的原文证据…';
    }
    if (turn.status === 'queued') return '已排队，等待上一轮完成';
    if (turn.status === 'generating') return turn.answerBlocks?.length
        ? '正在继续生成…' : '正在检索全文并组织回答…';
    if (turn.status === 'truncated') return '已保留已完成的回答片段；模型续写后仍达到实际输出上限';
    if (turn.status === 'incomplete') return '已保留通过校验的回答片段；模型续写后仍未形成完整回答';
    if (turn.status === 'cancelled') return '已取消；已完成的回答块已保留';
    if (turn.status === 'interrupted') return '已中断；已完成的回答块已保留，可手动重新生成';
    if (turn.status === 'error') return turn.error || '回答失败';
    if (turn.status === 'unanswered') return '回答已删除，可以重新生成';
    return '';
}

function renderArticleChatBlock(block, turn, snapshot, citationNumberOffset = 0) {
    const element = createWorkspaceElement('section', 'article-chat-answer-block');
    element.dataset.blockId = String(block.blockId || '');
    element.dataset.citationNumberOffset = String(citationNumberOffset);
    const markdown = renderArticleChatMarkdown(block.markdown || '', {
        evidence: block.evidence,
        snapshot,
        citationNumberOffset
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
    let citationNumberOffset = 0;
    blocks.forEach(block => {
        const blockId = String(block.blockId || '');
        const blockEvidenceCount = Array.isArray(block?.evidence) ? block.evidence.length : 0;
        if (!blockId) {
            citationNumberOffset += blockEvidenceCount;
            return;
        }
        const existing = blockContainer.querySelector(`[data-block-id="${blockId}"]`);
        if (!existing) {
            blockContainer.appendChild(renderArticleChatBlock(
                block, turn, snapshot, citationNumberOffset
            ));
        } else if (Number(existing.dataset.citationNumberOffset) !== citationNumberOffset) {
            existing.replaceWith(renderArticleChatBlock(
                block, turn, snapshot, citationNumberOffset
            ));
        }
        citationNumberOffset += blockEvidenceCount;
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
    element.classList.toggle('is-interrupted',
        ['interrupted', 'cancelled', 'truncated', 'incomplete', 'error'].includes(turn.status));

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
    renderArticleChatHighlightCategoryOptions();
    const container = document.getElementById('articleChatMessages');
    const coverage = document.getElementById('articleChatCoverage');
    if (!container || !coverage) return;
    const documentKey = `${snapshot?.url || ''}|${snapshot?.revision || ''}`;
    if (articleChatRenderedDocumentKey && articleChatRenderedDocumentKey !== documentKey) {
        container.querySelectorAll('[data-turn-id]').forEach(node => node.remove());
        articleChatTurnElements.clear();
        articleChatVisibleTurnCount = articleChatHistoryPageSize;
        articleChatFollowLatest = true;
        articleChatContextScopes.clear();
        renderArticleChatContextScopes();
        closeArticleChatCommandMenu();
    }
    articleChatRenderedDocumentKey = documentKey;

    const chat = snapshot?.chat || { turns: [], loading: false, error: '' };
    const turns = Array.isArray(chat.turns) ? chat.turns : [];
    const totalTurns = Math.max(turns.length, Number(chat.totalTurns) || 0);
    const visibleStart = Math.max(
        0,
        Number.isFinite(Number(chat.windowStart))
            ? Number(chat.windowStart) : totalTurns - turns.length
    );
    const visibleTurns = turns;
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
    const highlight = document.getElementById('highlightArticleChatMatches');
    const cancel = document.getElementById('cancelArticleChat');
    const clear = document.getElementById('clearArticleChat');
    const loadEarlier = document.getElementById('articleChatLoadEarlier');
    if (send) send.disabled = !articleChatSelectedProfileId;
    if (highlight) highlight.disabled = !articleChatSelectedProfileId ||
        !document.getElementById('articleChatHighlightCategory')?.value;
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
    if (turns.length > articleChatVisibleTurnCount) {
        turns = turns.slice(-articleChatVisibleTurnCount);
    }
    const eventTotalTurns = Number(event.totalTurns);
    const totalTurns = Number.isFinite(eventTotalTurns)
        ? Math.max(0, eventTotalTurns)
        : Math.max(turns.length, Number(currentChat.totalTurns) || 0);
    currentWorkspaceSnapshot = {
        ...currentWorkspaceSnapshot,
        chat: {
            ...currentChat,
            turns,
            totalTurns,
            returnedTurns: turns.length,
            windowStart: Math.max(0, totalTurns - turns.length),
            hasEarlier: totalTurns > turns.length,
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
    const contextScope = articleChatContextScopePayload();
    if (input) input.value = '';
    closeArticleChatCommandMenu();
    try {
        const response = await sendTabMessage(panelContext.tabId, {
            action: 'askArticleWithLLM', question, profileId,
            selectedProfileId: profileId,
            contextScope
        });
        if (!isCurrentPanelContext(panelContext)) return;
        if (!response?.success) {
            const error = new Error(response?.error || 'ARTICLE_CHAT_FAILED');
            error.code = response?.code;
            throw error;
        }
        if (response.turn) {
            const existingTurns = currentWorkspaceSnapshot?.chat?.turns || [];
            const existingTotalTurns = Math.max(
                existingTurns.length,
                Number(currentWorkspaceSnapshot?.chat?.totalTurns) || 0
            );
            const alreadyPresent = existingTurns.some(turn =>
                turn.turnId === response.turn.turnId
            );
            applyArticleChatStateEvent({
                kind: 'turn_added',
                turn: response.turn,
                totalTurns: existingTotalTurns + (alreadyPresent ? 0 : 1),
                loading: currentWorkspaceSnapshot?.chat?.loading === true
            });
        }
        articleChatContextScopes.clear();
        renderArticleChatContextScopes();
        showStatus(queuedBehindActive
            ? '问题已加入队列，将使用提交时选择的模型。' : '问题已发送。', 'success');
    } catch (error) {
        if (!isCurrentPanelContext(panelContext)) return;
        if (input && !input.value) input.value = question;
        showStatus(`全文问答发送失败：${error.message}`, 'error');
    }
}

async function submitArticleSemanticHighlight(event) {
    event?.preventDefault();
    const input = document.getElementById('articleChatQuestion');
    const question = String(input?.value || '').trim();
    const profileId = document.getElementById('articleChatProfile')?.value || '';
    const categoryId = document.getElementById('articleChatHighlightCategory')?.value || '';
    const categoryOption = document.getElementById('articleChatHighlightCategory')
        ?.selectedOptions?.[0];
    const categoryName = String(
        categoryOption?.dataset.categoryName || categoryOption?.textContent || ''
    );
    const highlightColor = document.getElementById('articleChatHighlightColor')
        ?.value || '#2F80ED';
    if (!question) {
        input?.focus();
        return;
    }
    if (!profileId || !categoryId ||
        llmSettingsState?.settings?.consentGranted !== true) {
        showStatus('请先配置可用模型，并选择智能检索的高亮类别。', 'error');
        return;
    }
    const panelContext = capturePanelContext();
    const contextScope = articleChatContextScopePayload();
    if (input) input.value = '';
    closeArticleChatCommandMenu();
    try {
        const response = await sendTabMessage(panelContext.tabId, {
            action: 'highlightArticleMatchesWithLLM',
            question,
            profileId,
            categoryId,
            categoryName,
            highlightColor,
            contextScope
        });
        if (!isCurrentPanelContext(panelContext)) return;
        if (!response?.success) {
            const error = new Error(response?.error || 'ARTICLE_SEMANTIC_HIGHLIGHT_FAILED');
            error.code = response?.code;
            throw error;
        }
        if (response.turn) {
            const existingTurns = currentWorkspaceSnapshot?.chat?.turns || [];
            const totalTurns = Math.max(
                existingTurns.length,
                Number(currentWorkspaceSnapshot?.chat?.totalTurns) || 0
            );
            const exists = existingTurns.some(turn => turn.turnId === response.turn.turnId);
            applyArticleChatStateEvent({
                kind: 'turn_added',
                turn: response.turn,
                totalTurns: totalTurns + (exists ? 0 : 1),
                loading: currentWorkspaceSnapshot?.chat?.loading === true
            });
        }
        articleChatContextScopes.clear();
        renderArticleChatContextScopes();
        showStatus('智能检索已加入队列；匹配完成后会直接在原文中高亮。', 'success');
    } catch (error) {
        if (!isCurrentPanelContext(panelContext)) return;
        if (input && !input.value) input.value = question;
        showStatus(`智能检索发送失败：${error.message}`, 'error');
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

async function loadEarlierArticleChatHistory() {
    const container = document.getElementById('articleChatMessages');
    const button = document.getElementById('articleChatLoadEarlier');
    const totalTurns = Math.max(
        0, Number(currentWorkspaceSnapshot?.chat?.totalTurns) || 0
    );
    if (!container || !button || button.disabled ||
        articleChatVisibleTurnCount >= totalTurns) return;
    const previousCount = articleChatVisibleTurnCount;
    const containerRect = container.getBoundingClientRect();
    const anchor = Array.from(container.querySelectorAll(':scope > [data-turn-id]'))
        .find(node => node.getBoundingClientRect().bottom > containerRect.top) ||
        container.querySelector(':scope > [data-turn-id]');
    const anchorTop = anchor?.getBoundingClientRect().top || 0;
    const previousOverflowAnchor = container.style.overflowAnchor;
    button.disabled = true;
    container.style.overflowAnchor = 'none';
    try {
        articleChatFollowLatest = false;
        articleChatVisibleTurnCount = Math.min(
            totalTurns,
            articleChatVisibleTurnCount + articleChatHistoryPageSize
        );
        const snapshot = await refreshArticleWorkspace();
        if (!snapshot) {
            articleChatVisibleTurnCount = previousCount;
            throw new Error('ARTICLE_CHAT_HISTORY_LOAD_FAILED');
        }
        if (anchor?.isConnected) {
            // Newly prepended answer cards can settle over the next two frames
            // (layout containment, fonts, and entry animations). Correcting
            // immediately left the old first visible turn about one line lower.
            // A native side panel can be background-throttled while the paper
            // tab owns focus, so requestAnimationFrame is not a reliable
            // completion signal here.
            await new Promise(resolve => setTimeout(resolve, 32));
            for (let attempt = 0; attempt < 3; attempt += 1) {
                const offset = anchor.getBoundingClientRect().top - anchorTop;
                if (Math.abs(offset) < 0.25) break;
                container.scrollTop += offset;
                await new Promise(resolve => setTimeout(resolve, 16));
            }
        }
    } finally {
        container.style.overflowAnchor = previousOverflowAnchor;
        button.disabled = false;
    }
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
    updateApplyButton();
}

function mergeRefreshedFigureCatalog(snapshot, refreshResult) {
    const liveFigures = Array.isArray(refreshResult?.figures)
        ? refreshResult.figures.filter(figure => figure?.figureId) : [];
    if (!snapshot || !liveFigures.length) return snapshot;
    const workspace = snapshot.figures && typeof snapshot.figures === 'object'
        ? snapshot.figures : {};
    const storedFigures = Array.isArray(workspace.figures) ? workspace.figures : [];
    const storedById = new Map(
        storedFigures.map(figure => [String(figure?.figureId || ''), figure])
    );
    const liveIds = new Set(liveFigures.map(figure => String(figure.figureId)));
    const mergedFigures = liveFigures.map(liveFigure => {
        const stored = storedById.get(String(liveFigure.figureId)) || {};
        return {
            figureInputHash: '',
            activeDepth: 'deep',
            standard: null,
            standardError: '',
            deep: null,
            deepLoading: false,
            deepError: '',
            panelFollowups: {},
            panelFollowupHistories: {},
            panelFollowupLoading: {},
            panelFollowupErrors: {},
            panelAnalyses: {},
            panelAnalysisLoading: {},
            panelAnalysisErrors: {},
            expanded: false,
            ...stored,
            ...liveFigure
        };
    });
    storedFigures.forEach(figure => {
        if (figure?.figureId && !liveIds.has(String(figure.figureId))) {
            mergedFigures.push(figure);
        }
    });
    return {
        ...snapshot,
        figures: {
            ...workspace,
            figures: mergedFigures,
            totalFigures: mergedFigures.length,
            extractorRevision: String(refreshResult?.revision || ''),
            extractorProbeFigureId: String(refreshResult?.probeFigureId || '')
        }
    };
}

async function refreshArticleWorkspace({
    announce = false,
    panelContext = capturePanelContext()
} = {}) {
    const requestId = ++workspaceRefreshSequence;
    if (!isCurrentPanelContext(panelContext)) return null;
    try {
        let figureRefreshResult = null;
        if ((announce || !currentWorkspaceSnapshot) &&
            typeof SciLLM.refreshFigureExtractorInTab === 'function') {
            figureRefreshResult = await SciLLM.refreshFigureExtractorInTab(
                chrome,
                panelContext.tabId
            );
        }
        const response = await sendTabMessage(panelContext.tabId, {
            action: 'getArticleWorkspaceSnapshot',
            forceRefresh: announce,
            chatLimit: Math.max(articleChatHistoryPageSize, articleChatVisibleTurnCount)
        });
        if (!response?.success || !response.snapshot) {
            throw new Error(response?.error || '当前页面结构不可用');
        }
        if (requestId !== workspaceRefreshSequence || !isCurrentPanelContext(panelContext)) {
            return null;
        }
        const snapshot = mergeRefreshedFigureCatalog(
            response.snapshot,
            figureRefreshResult
        );
        renderArticleWorkspaceSnapshot(snapshot);
        resumeFigureProgressFromWorkspaceSnapshot(snapshot, {
            tabId: panelContext.tabId
        });
        if (announce) {
            const figureLabels = (snapshot?.figures?.figures || [])
                .map(figure => figure.figureLabel || figure.figureId)
                .filter(Boolean);
            showStatus(
                figureLabels.length
                    ? `Figure 目录已刷新：${figureLabels.join('、')}`
                    : '论文侧栏已刷新',
                'success'
            );
        }
        return snapshot;
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

function articleArchivePromptDecisionKey(identity = currentArticleArchiveIdentity()) {
    const documentId = String(identity?.documentId || '').trim();
    return documentId ? `${ARTICLE_ARCHIVE_PROMPT_DECISION_PREFIX}${documentId}` : '';
}

async function readArticleArchivePromptDecision(identity = currentArticleArchiveIdentity()) {
    const key = articleArchivePromptDecisionKey(identity);
    if (!key || !chrome.storage?.session) return null;
    const stored = await chrome.storage.session.get(key).catch(() => ({}));
    return stored?.[key] || null;
}

function rememberArticleArchivePromptDecision(
    decision,
    identity = currentArticleArchiveIdentity()
) {
    const key = articleArchivePromptDecisionKey(identity);
    if (!key || !chrome.storage?.session) return Promise.resolve(false);
    return chrome.storage.session.set({
        [key]: {
            decision: String(decision || 'handled'),
            documentId: String(identity.documentId || ''),
            canonicalUrl: String(identity.canonicalUrl || ''),
            decidedAt: Date.now()
        }
    }).then(() => true).catch(() => false);
}

function workspaceAlreadyHasArticleResults(snapshot = currentWorkspaceSnapshot) {
    if (!snapshot) return false;
    if (Number(manualAnnotationState?.annotationCount) > 0) return true;
    if (Number(snapshot.highlightDistribution?.totalHighlights) > 0) return true;
    if (Number(snapshot.chat?.totalTurns) > 0) return true;
    if (snapshot.ledger || snapshot.reviewOutline) return true;
    if (Array.isArray(snapshot.paragraphSummaries) && snapshot.paragraphSummaries.length) {
        return true;
    }
    if (snapshot.figures?.crossFigureLogic?.result) return true;
    return (Array.isArray(snapshot.figures?.figures) ? snapshot.figures.figures : [])
        .some(figure => Boolean(
            figure?.standard || figure?.deep ||
            Object.keys(figure?.panelAnalyses || {}).length ||
            Object.keys(figure?.panelFollowupHistories || {}).length
        ));
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
    if (workspaceAlreadyHasArticleResults()) {
        setArticleArchivePrompt(null);
        void rememberArticleArchivePromptDecision('current-workspace', identity);
        return null;
    }
    try {
        const handled = await readArticleArchivePromptDecision(identity);
        if (handled || currentArticleArchiveIdentity().documentId !== identity.documentId) {
            setArticleArchivePrompt(null);
            return null;
        }
        const probe = await sendLlmMessage({
            type: 'ARTICLE_ARCHIVE_PROBE',
            documentId: identity.documentId,
            canonicalUrl: identity.canonicalUrl
        });
        if (currentArticleArchiveIdentity().documentId !== identity.documentId) return null;
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
    const tab = await queryPanelTargetTab();
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
    void rememberArticleArchivePromptDecision(
        imported ? 'imported' : 'loaded',
        identity
    );
    const message = applied.partial
        ? '页面正文与存档版本不同：备注和分析卡片已恢复，旧 AI 文本范围未强行套用。'
        : '上次的高亮、备注与 AI 分析结果已恢复。';
    showStatus(message, applied.partial ? 'error' : 'success');
    return applied;
}

async function loadCurrentArticleArchive() {
    const permissionTicket = beginArticleWorkspaceDirectoryPermissionRequest();
    const identity = currentArticleArchiveIdentity();
    if (!identity.documentId) return;
    try {
        const workspaceRestore = await restoreCurrentArticleWorkspaceFromDirectory({
            panelContext: capturePanelContext(),
            announce: false,
            allowMissing: true,
            permissionTicket
        });
        if (workspaceRestore?.applied?.success) {
            setArticleArchivePrompt(null);
            await rememberArticleArchivePromptDecision('workspace-loaded', identity);
            const turnCount = Number(workspaceRestore.applied.chatTurns) || 0;
            showStatus(
                turnCount
                    ? `已从本地工作区恢复全部结果和 ${turnCount} 轮历史问答`
                    : '已从本地工作区恢复上次保存的分析结果',
                'success'
            );
            return workspaceRestore.applied;
        }
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
    const title = String(archive.title || 'article')
        .replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80) || 'article';
    downloadBlob(blob, `${title}.sci-archive.json`);
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

function runArticleContentExport({
    guard,
    buttonId,
    action,
    pendingMessage,
    onSuccess
}) {
    return guard.run(async () => {
        const button = document.getElementById(buttonId);
        const panelContext = capturePanelContext();
        if (!Number.isInteger(Number(panelContext.tabId))) {
            showStatus('当前论文页面尚未准备完成', 'error');
            return;
        }
        if (button) {
            button.disabled = true;
            button.setAttribute('aria-busy', 'true');
        }
        showStatus(pendingMessage, 'success');
        try {
            const response = await sendTabMessage(panelContext.tabId, { action });
            if (!response?.success) {
                const error = new Error(response?.error || '导出失败');
                error.code = response?.code || 'CONTENT_EXPORT_FAILED';
                throw error;
            }
            if (isCurrentPanelContext(panelContext)) onSuccess(response);
        } catch (error) {
            if (isCurrentPanelContext(panelContext)) {
                showStatus(`导出失败：${error.message}`, 'error');
            }
        } finally {
            if (button) {
                button.disabled = false;
                button.removeAttribute('aria-busy');
            }
        }
    });
}

function exportPptMaterials() {
    return runArticleContentExport({
        guard: pptMaterialExportGuard,
        buttonId: 'exportPptMaterials',
        action: 'exportPptMaterials',
        pendingMessage: '正在下载所有 Figure 的最高质量图片并整理 PPT 制作材料…',
        onSuccess(response) {
            const missing = Array.isArray(response.missingImageFigureIds)
                ? response.missingImageFigureIds.length : 0;
            showStatus(
                `PPT 材料包已导出：${response.figureCount || 0} 张 Figure、` +
                `${response.imageCount || 0} 个高清图文件` +
                (missing ? `；${missing} 张 Figure 未能下载原图，请查看 manifest` : ''),
                missing ? 'error' : 'success'
            );
        }
    });
}

function exportEnhancedSnapshotToZotero() {
    return runArticleContentExport({
        guard: zoteroSnapshotExportGuard,
        buttonId: 'exportEnhancedSnapshotToZotero',
        action: 'exportEnhancedSnapshotToZotero',
        pendingMessage: '正在下载 Figure 高清原图、固化原网页单栏快照并连接 Zotero…',
        onSuccess(response) {
            const imageCount = Number(response.embeddedImageCount) || 0;
            const missing = Array.isArray(response.missingImageFigureIds)
                ? response.missingImageFigureIds.length : 0;
            if (response.imported) {
                const target = response.collectionName || response.libraryName || '当前文库';
                showStatus(
                    `已保存到 Zotero「${target}」：原网页单栏增强快照内嵌 ${imageCount} 张高清原图，` +
                    `图解与全文问答已分别保存为两个子笔记` +
                    (missing ? `；${missing} 张 Figure 未能获取原图` : ''),
                    missing ? 'error' : 'success'
                );
                return;
            }
            const reason = response.directError?.message || 'Zotero 当前不可用';
            showStatus(
                `未能直接导入 Zotero（${reason}）；已下载内嵌 ${imageCount} 张高清原图的` +
                `单栏增强快照 ZIP`,
                'error'
            );
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

function currentLocalArticleWorkspace() {
    return currentWorkspaceSnapshot?.localWorkspace || null;
}

function beginArticleWorkspaceDirectoryPermissionRequest() {
    const handle = articleWorkspaceDirectoryHandle;
    if (!handle || typeof handle.requestPermission !== 'function') {
        // The settings tab may have selected a directory after this side panel
        // was opened. Reloading the handle is enough when that new permission
        // is already granted; if it is "prompt", the next click can invoke
        // requestPermission synchronously with the refreshed handle.
        const promise = refreshArticleWorkspaceDirectoryHandle().then(async refreshed => {
            if (!refreshed) return 'unconfigured';
            try {
                return await refreshed.queryPermission({ mode: 'readwrite' });
            } catch (_) {
                return 'unknown';
            }
        });
        return { started: false, promise };
    }
    try {
        // This call must happen synchronously inside the click handler. Sending
        // it through the service worker or awaiting article preparation first
        // loses the browser user activation and leaves permission at "prompt".
        const promise = Promise.resolve(
            handle.requestPermission({ mode: 'readwrite' })
        ).catch(() => 'unknown');
        return { started: true, promise };
    } catch (_) {
        return { started: true, promise: Promise.resolve('unknown') };
    }
}

async function resolveArticleWorkspaceDirectoryPermission(ticket) {
    const directPermission = await ticket?.promise;
    if (directPermission === 'granted') return 'granted';
    await articleWorkspaceDirectoryHandleReady;
    const handle = articleWorkspaceDirectoryHandle;
    if (!handle) return 'unconfigured';
    try {
        return await handle.queryPermission({ mode: 'readwrite' });
    } catch (_) {
        return 'unknown';
    }
}

function directorySyncFailureMessage(result = {}) {
    if (result.requiresReselection === true) {
        return '原文件夹句柄已失效或目录被移动，请在设置页重新选择同一个基础目录';
    }
    if (result.requiresReauthorization === true || result.permission !== 'granted') {
        return '本地文件夹权限已失效；请再次点击保存，并在浏览器提示中允许访问';
    }
    const code = String(result.errorCode || result.lastErrorCode || '').trim();
    const type = String(result.errorName || result.lastErrorName || '').trim();
    const path = String(result.failedPath || result.lastErrorPath || '').trim();
    const detail = String(result.message || result.lastError || '').trim();
    const suffix = [path, code || type, detail].filter(Boolean).join('：');
    return suffix
        ? `目录写入未完成（${suffix}），数据仍保留在待同步队列中`
        : '目录写入未完成，数据仍保留在待同步队列中，可稍后重试';
}

async function saveCurrentArticleWorkspace() {
    const permissionTicket = beginArticleWorkspaceDirectoryPermissionRequest();
    return articleWorkspaceSaveGuard.run(async () => {
        const button = document.getElementById('saveCurrentArticleWorkspace');
        const panelContext = capturePanelContext();
        if (!isCurrentPanelContext(panelContext)) return;
        if (button) {
            button.disabled = true;
            button.setAttribute('aria-busy', 'true');
        }
        try {
            const directPermission = await resolveArticleWorkspaceDirectoryPermission(
                permissionTicket
            );
            if (directPermission !== 'granted') {
                throw new Error(directPermission === 'unconfigured'
                    ? '尚未设置本地保存文件夹，请先到设置页面选择文件夹'
                    : '未获得本地文件夹读写权限；请再次点击保存并允许访问');
            }
            const ensured = await sendTabMessage(panelContext.tabId, {
                action: 'ensureArticleWorkspace', forceRefresh: true
            });
            if (!ensured?.success || !ensured.workspace) {
                throw new Error(ensured?.error || '无法识别当前论文的本地工作区');
            }
            const permission = await sendLlmMessage({
                type: 'ARTICLE_WORKSPACE_SCAN_RESTORE',
                identity: ensured.workspace,
                requestPermission: false,
                permissionOnly: true
            });
            if (permission.permission !== 'granted') {
                throw new Error(permission.permission === 'unconfigured'
                    ? '尚未设置本地保存文件夹，请先到设置页面选择文件夹'
                    : '未获得本地文件夹读写权限，请再次点击并允许访问');
            }
            const saved = await sendTabMessage(panelContext.tabId, {
                action: 'saveArticleWorkspaceNow'
            });
            if (!saved?.success) {
                throw new Error(saved?.error || '当前论文工作区保存失败');
            }
            const syncResult = await sendLlmMessage({
                type: 'USER_DATA_SYNC_NOW',
                drain: true
            });
            if (syncResult.permission !== 'granted' || Number(syncResult.failed) > 0 ||
                Number(syncResult.pendingCount) > 0) {
                throw new Error(directorySyncFailureMessage(syncResult));
            }
            if (!isCurrentPanelContext(panelContext)) return;
            showStatus(
                `已保存 ${saved.assetCount || 0} 个工作区文件和 ${saved.turnCount || 0} 轮问答到本地文件夹`,
                'success'
            );
        } catch (error) {
            showStatus(`保存到本地文件夹失败：${error.message}`, 'error');
        } finally {
            if (button) {
                button.disabled = false;
                button.removeAttribute('aria-busy');
            }
        }
    });
}

function applyRestoredSidePanelUiState(uiState = null) {
    if (!uiState || typeof uiState !== 'object') return;
    if (Array.isArray(uiState.figureExpansion)) {
        figureExpansionState.clear();
        uiState.figureExpansion.forEach(entry => {
            if (Array.isArray(entry) && entry.length >= 2) {
                figureExpansionState.set(String(entry[0]), entry[1] === true);
            }
        });
    }
    if (Array.isArray(uiState.figurePanelExpansion)) {
        figurePanelExpansionState.clear();
        uiState.figurePanelExpansion.forEach(entry => {
            if (Array.isArray(entry) && entry.length >= 2) {
                figurePanelExpansionState.set(String(entry[0]), entry[1] === true);
            }
        });
    }
    if (['analysis', 'navigation', 'highlights', 'figures', 'chat']
        .includes(uiState.activeWorkspaceView)) {
        switchWorkspaceView(uiState.activeWorkspaceView, { persist: false });
    }
}

async function restoreCurrentArticleWorkspaceFromDirectory({
    panelContext = capturePanelContext(),
    announce = true,
    allowMissing = false,
    requestPermission = true,
    permissionTicket = null
} = {}) {
    if (!isCurrentPanelContext(panelContext)) return null;
    if (requestPermission === true) {
        const permission = await resolveArticleWorkspaceDirectoryPermission(permissionTicket);
        if (permission !== 'granted') {
            if (allowMissing) return null;
            throw new Error(permission === 'unconfigured'
                ? '尚未设置本地保存文件夹，请先到设置页面选择文件夹'
                : '未获得本地文件夹读取权限；请再次点击并允许访问');
        }
    }
    const ensured = await sendTabMessage(panelContext.tabId, {
        action: 'ensureArticleWorkspace',
        forceRefresh: true
    });
    if (!ensured?.success || !ensured.workspace) {
        if (allowMissing) return null;
        throw new Error(ensured?.error || '无法识别当前论文的本地工作区');
    }
    const scanned = await sendLlmMessage({
        type: 'ARTICLE_WORKSPACE_SCAN_RESTORE',
        identity: ensured.workspace,
        requestPermission: false
    });
    if (!isCurrentPanelContext(panelContext)) return null;
    if (scanned.permission !== 'granted') {
        if (allowMissing) return null;
        throw new Error(scanned.permission === 'unconfigured'
            ? '尚未设置本地保存文件夹，请先到设置页面选择文件夹'
            : '未获得本地文件夹读取权限，请再次点击并允许访问');
    }
    if (!scanned.restore) {
        if (allowMissing) return null;
        showStatus('本地文件夹中没有匹配当前网页的工作区', 'error');
        return null;
    }
    const applied = await sendTabMessage(panelContext.tabId, {
        action: 'applyArticleWorkspaceAssets',
        restore: scanned.restore
    });
    if (!applied?.success) {
        throw new Error(applied?.error || '本地工作区恢复失败');
    }
    applyRestoredSidePanelUiState(applied.uiState);
    await refreshManualAnnotationSummary(panelContext.tabId);
    await refreshArticleWorkspace({ panelContext });
    applyRestoredSidePanelUiState(applied.uiState);
    if (announce) {
        const turnCount = Number(applied.chatTurns) || 0;
        showStatus(
            applied.partial
                ? '已安全恢复问答、图解和分析卡片；正文已变化，旧文本范围未强行套用'
                : turnCount
                    ? `已恢复当前网页的本地工作区和 ${turnCount} 轮历史问答`
                    : '已恢复当前网页的本地工作区',
            applied.partial ? 'error' : 'success'
        );
    }
    return { scanned, applied };
}

async function tryAutoRestoreCurrentArticleWorkspace(
    panelContext = capturePanelContext()
) {
    if (!isCurrentPanelContext(panelContext) ||
        workspaceAlreadyHasArticleResults(currentWorkspaceSnapshot)) {
        return null;
    }
    try {
        const restored = await restoreCurrentArticleWorkspaceFromDirectory({
            panelContext,
            announce: false,
            allowMissing: true,
            requestPermission: false
        });
        if (!restored?.applied?.success || !isCurrentPanelContext(panelContext)) {
            return null;
        }
        setArticleArchivePrompt(null);
        await rememberArticleArchivePromptDecision(
            'workspace-auto-restored',
            currentArticleArchiveIdentity()
        );
        const turnCount = Number(restored.applied.chatTurns) || 0;
        showStatus(
            turnCount
                ? `已自动恢复本地工作区和 ${turnCount} 轮历史问答`
                : '已自动恢复当前网页的本地工作区',
            'success'
        );
        return restored;
    } catch (_) {
        // Automatic restoration must never block article reading. If the
        // browser requires a fresh directory gesture, the existing explicit
        // load/scan control remains available.
        return null;
    }
}

async function scanCurrentArticleWorkspace() {
    const permissionTicket = beginArticleWorkspaceDirectoryPermissionRequest();
    const button = document.getElementById('scanArticleWorkspace');
    const panelContext = capturePanelContext();
    if (!isCurrentPanelContext(panelContext)) return;
    if (button) button.disabled = true;
    try {
        const directPermission = await resolveArticleWorkspaceDirectoryPermission(
            permissionTicket
        );
        if (directPermission !== 'granted') {
            throw new Error(directPermission === 'unconfigured'
                ? '尚未设置本地保存文件夹，请先到设置页面选择文件夹'
                : '未获得本地文件夹读取权限；请再次点击扫描并允许访问');
        }
        const ensured = await sendTabMessage(panelContext.tabId, {
            action: 'ensureArticleWorkspace', forceRefresh: true
        });
        if (!ensured?.success || !ensured.workspace) {
            throw new Error(ensured?.error || '无法识别当前论文的本地工作区');
        }
        const identity = ensured.workspace;
        const scanned = await sendLlmMessage({
            type: 'ARTICLE_WORKSPACE_SCAN_RESTORE',
            identity,
            requestPermission: false
        });
        if (!isCurrentPanelContext(panelContext)) return;
        if (scanned.permission !== 'granted') {
            throw new Error(scanned.permission === 'unconfigured'
                ? '尚未设置本地保存文件夹，请先到设置页面选择文件夹'
                : '未获得本地文件夹读取权限，请再次点击并允许访问');
        }
        if (!scanned.restore && scanned.matches?.[0]?.match === 'legacy-imported') {
            await loadCurrentArticleArchive();
            return;
        }
        if (!scanned.restore) {
            showStatus('本地文件夹中没有匹配当前网页的工作区', 'error');
            return;
        }
        const applied = await sendTabMessage(panelContext.tabId, {
            action: 'applyArticleWorkspaceAssets',
            restore: scanned.restore
        });
        if (!applied?.success) throw new Error(applied?.error || '本地工作区恢复失败');
        applyRestoredSidePanelUiState(applied.uiState);
        await refreshManualAnnotationSummary(panelContext.tabId);
        await refreshArticleWorkspace({ panelContext });
        applyRestoredSidePanelUiState(applied.uiState);
        showStatus(applied.partial
            ? '已安全恢复问答、图解和分析卡片；正文已变化，旧文本范围未强行套用'
            : '已恢复当前网页的本地工作区', applied.partial ? 'error' : 'success');
    } catch (error) {
        showStatus(`扫描本地工作区失败：${error.message}`, 'error');
    } finally {
        if (button) button.disabled = false;
    }
}

async function clearCurrentArticleWorkspace() {
    const permissionTicket = beginArticleWorkspaceDirectoryPermissionRequest();
    const button = document.getElementById('clearArticleWorkspace');
    const workspace = currentLocalArticleWorkspace();
    const panelContext = capturePanelContext();
    if (!workspace?.workspaceId || !isCurrentPanelContext(panelContext)) {
        showStatus('当前网页尚未建立本地工作区', 'error');
        return;
    }
    const counts = currentWorkspaceSnapshot?.diagnostics || {};
    const accepted = confirm(
        `确定清除“${currentWorkspaceSnapshot?.title || '当前论文'}”的本地工作区吗？\n` +
        `包含 ${currentWorkspaceSnapshot?.chat?.totalTurns || 0} 轮问答、` +
        `${currentWorkspaceSnapshot?.figures?.totalFigures || 0} 个 Figure 结果和` +
        `${counts.paragraphCount || 0} 段正文索引。此操作不可撤销。`
    );
    if (!accepted) return;
    if (button) button.disabled = true;
    try {
        const directPermission = await resolveArticleWorkspaceDirectoryPermission(
            permissionTicket
        );
        if (directPermission !== 'granted') {
            throw new Error(directPermission === 'unconfigured'
                ? '尚未设置本地保存文件夹，请先到设置页面选择文件夹'
                : '未获得本地文件夹读写权限；请再次点击清除并允许访问');
        }
        await sendLlmMessage({
            type: 'ARTICLE_WORKSPACE_SCAN_RESTORE', identity: workspace,
            requestPermission: false
        }).catch(() => null);
        const begun = await sendLlmMessage({
            type: 'ARTICLE_WORKSPACE_BEGIN_DELETE', workspaceId: workspace.workspaceId
        });
        await sendTabMessage(panelContext.tabId, { action: 'freezeArticleWorkspaceWrites' });
        const finalized = await sendLlmMessage({
            type: 'ARTICLE_WORKSPACE_FINALIZE_DELETE',
            workspaceId: workspace.workspaceId,
            tombstoneId: begun.tombstoneId
        });
        if (!finalized.deleted) {
            throw new Error('本地文件夹权限不足，清除已暂停；再次授权后可继续');
        }
        workspaceGeneration = Math.max(
            workspaceGeneration + 1,
            Number(begun.workspaceGeneration || workspace.workspaceGeneration || 1) + 1
        );
        const reset = await sendTabMessage(panelContext.tabId, {
            action: 'resetArticleWorkspaceState', workspaceGeneration
        });
        if (!reset?.success) throw new Error(reset?.error || '页面状态重置失败');
        activeWorkspaceView = 'analysis';
        await refreshArticleWorkspace({ panelContext });
        switchWorkspaceView('analysis');
        showStatus('当前网页的本地内容已清除，并已建立新的空工作区', 'success');
    } catch (error) {
        showStatus(`清除当前页本地内容失败：${error.message}`, 'error');
    } finally {
        if (button) button.disabled = false;
    }
}

function setupArticleArchiveControls() {
    document.getElementById('loadArticleArchive')
        ?.addEventListener('click', loadCurrentArticleArchive);
    document.getElementById('reanalyzeArticle')?.addEventListener('click', () => {
        void rememberArticleArchivePromptDecision('skipped');
        setArticleArchivePrompt(null);
        switchWorkspaceView('analysis');
        showStatus('已跳过旧档案，可按当前设置重新分析', 'success');
    });
    document.getElementById('exportCurrentArticleArchive')
        ?.addEventListener('click', exportCurrentArticleArchive);
    document.getElementById('exportPptMaterials')
        ?.addEventListener('click', exportPptMaterials);
    document.getElementById('exportEnhancedSnapshotToZotero')
        ?.addEventListener('click', exportEnhancedSnapshotToZotero);
    document.getElementById('saveCurrentArticleWorkspace')
        ?.addEventListener('click', saveCurrentArticleWorkspace);
    document.getElementById('importCurrentArticleArchive')
        ?.addEventListener('change', importCurrentArticleArchive);
    document.getElementById('importCurrentArticleArchiveButton')
        ?.addEventListener('click', () => {
            document.getElementById('importCurrentArticleArchive')?.click();
        });
    document.getElementById('scanArticleWorkspace')
        ?.addEventListener('click', scanCurrentArticleWorkspace);
    document.getElementById('clearArticleWorkspace')
        ?.addEventListener('click', clearCurrentArticleWorkspace);
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
        const panelContext = capturePanelContext();
        const restored = await tryAutoRestoreCurrentArticleWorkspace(panelContext);
        if (requestId !== articlePreparationSequence ||
            !isCurrentPanelContext(panelContext)) return null;
        // Create the per-article directory as soon as the page is activated, but
        // only after restoration has had the first chance to read existing data.
        // The baseline action writes structure/paragraphs only; it cannot replace
        // a saved chat index, Figure result, highlight, or analysis with empties.
        await sendTabMessage(panelContext.tabId, {
            action: 'saveArticleWorkspaceBaseline'
        }).catch(() => null);
        if (requestId !== articlePreparationSequence ||
            !isCurrentPanelContext(panelContext)) return null;
        if (analysisMode === 'llm') {
            void Promise.allSettled([
                refreshLlmDiagnostics(),
                restoreFigureAnalysisProgress(),
                restoreReviewOutlineProgress()
            ]);
        }
        if (!restored) void probeCurrentArticleArchive();
        return currentWorkspaceSnapshot || snapshot;
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
    setupSidePanelNotificationCenter();
    setupWorkspaceNavigation();
    setupSupplementalFigureImport();
    setupSidePanelSettingsShortcut();
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

window.addEventListener('focus', () => {
    void refreshArticleWorkspaceDirectoryHandle();
});
window.addEventListener('pagehide', () => {
    void publishSidePanelShortcutScope(activePanelTabContext.tabId, false);
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
    const configured = [...getConfiguredViewSelection()]
        .filter(categoryId => available.has(categoryId));
    selectedCategories = configured.length
        ? new Set(configured)
        : regexSelectionStored
            ? new Set([...selectedCategories].filter(categoryId => available.has(categoryId)))
            : new Set(availableIds);
}

async function sendLlmMessage(message) {
    const response = await chrome.runtime.sendMessage(message);
    if (!response?.success) {
        const error = new Error(response?.error?.message || 'LLM 操作失败');
        error.code = response?.error?.code;
        error.diagnosticType = response?.error?.diagnosticType;
        error.diagnosticMessage = response?.error?.diagnosticMessage;
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
        const language = llmSettingsState.settings.language || 'zh-CN';
        updateSidePanelLanguageButton(language);
        SciLLM.setInterfaceLanguage?.(language);
    } catch (error) {
        analysisMode = 'regex';
        persistedAnalysisMode = 'regex';
        llmSettingsState = null;
    }
}

function updateSidePanelLanguageButton(language) {
    const button = document.getElementById('sidePanelLanguage');
    if (!button) return;
    const normalized = String(language || '').toLowerCase().startsWith('en')
        ? 'en' : 'zh-CN';
    button.dataset.language = normalized;
    button.textContent = normalized === 'en' ? 'EN' : 'CH';
    const current = normalized === 'en' ? '英文' : '中文';
    const target = normalized === 'en' ? '中文' : '英文';
    button.setAttribute('aria-label', `当前为${current}，点击切换为${target}`);
    button.title = `点击切换为${target}`;
}

function getReadingViewDefinition(viewId = readingViewId) {
    return llmSettingsState?.readingViews?.[viewId] || { categoryIds: [] };
}

function getCurrentViewOverride(viewId = readingViewId) {
    void viewId;
    return { add: [], remove: [] };
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
    const container = document.getElementById('readingViewOptions');
    if (!container) return;
    const views = llmSettingsState?.readingViews || {};
    container.replaceChildren();
    Object.entries(views).forEach(([viewId, definition], index) => {
        const label = document.createElement('label');
        label.title = definition?.description || '';
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'readingView';
        radio.value = viewId;
        radio.checked = viewId === readingViewId ||
            (!Object.prototype.hasOwnProperty.call(views, readingViewId) && index === 0);
        const text = document.createElement('span');
        text.textContent = definition?.name || viewId;
        label.append(radio, text);
        container.appendChild(label);
    });
}

function updateApplyButton() {
    const applyButton = document.getElementById('applyHighlight');
    delete applyButton.dataset.settingsCta;
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
    if (llmSettingsState?.effectiveMode !== 'llm') {
        applyButton.textContent = '先配置 API';
        applyButton.disabled = false;
        applyButton.dataset.settingsCta = 'true';
    } else if (prepareState === 'preparing') {
        applyButton.textContent = '正在准备正文';
        applyButton.disabled = true;
    } else if (prepareState === 'analyzing') {
        applyButton.textContent = '正在分析全文';
        applyButton.disabled = true;
    } else if (!preparedDocumentState?.documentHash) {
        applyButton.textContent = '正在读取正文';
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
    const tab = await queryPanelTargetTab();
    if (!tab?.id) throw new Error('无法获取当前论文页面');
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
        if (command === 'cancel') stopFigureProgressPolling();
        figureAnalysisState = {
            ...figureAnalysisState,
            running: command !== 'cancel',
            paused: command === 'pause' ? true : command === 'resume' ? false
                : figureAnalysisState.paused,
            phase: command === 'cancel' ? 'cancelled'
                : command === 'pause' ? 'paused' : 'analyzing',
            figureProgress: getFigureProgressEntries(figureAnalysisState).map(progress => ({
                ...progress,
                running: command === 'cancel' ? false : progress.running,
                cancelled: command === 'cancel' && !progress.completed && !progress.failed
                    ? true : progress.cancelled,
                phase: command === 'cancel' && !progress.completed && !progress.failed
                    ? 'cancelled' : progress.phase
            }))
        };
        updateFigureButton();
        renderFigureWorkspaceSnapshot(currentWorkspaceSnapshot);
    }
    let timer = null;
    let response = null;
    try {
        response = await Promise.race([
            sendTabMessage(tab.id, {
                action: 'controlLlmOperation', scope, command
            }),
            new Promise(resolve => {
                timer = setTimeout(() => resolve({
                    success: true,
                    pending: true,
                    code: 'CONTROL_CONFIRMATION_TIMEOUT'
                }), 2200);
            })
        ]);
    } catch (error) {
        response = {
            success: true,
            pending: true,
            code: error?.code || 'CONTROL_CONFIRMATION_FAILED'
        };
    } finally {
        if (timer !== null) clearTimeout(timer);
    }
    if (!response?.success) {
        const error = new Error(response?.error || '无法控制分析任务');
        error.code = response?.code;
        throw error;
    }
    if (scope === 'figure' && response.pending && figureAnalysisState.operationId) {
        void chrome.runtime.sendMessage({
            type: 'LLM_CONTROL_OPERATION',
            operationId: figureAnalysisState.operationId,
            command
        }).catch(() => undefined);
    }
    if (scope === 'figure' && command !== 'cancel') {
        startFigureProgressPolling(tab.id);
    }
    const label = command === 'cancel' ? '已取消' : command === 'pause' ? '已暂停' : '已继续';
    showStatus(
        `${label}${scope === 'figure' ? ' Figure 解读' : '全文 LLM 高亮'}` +
            (response.pending ? '；后台确认稍有延迟，界面已立即释放' : ''),
        'success'
    );
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
    const active = hasRunningFigureProgress(figureAnalysisState);
    controls.hidden = !active;
    pause.textContent = figureAnalysisState.paused ? '继续图解' : '暂停图解';
    pause.disabled = !active;
    cancel.disabled = !active;
}

function updateFigureButton() {
    const figureButton = document.getElementById('analyzeFiguresFromFigures') ||
        document.getElementById('analyzeFigures');
    if (!figureButton) return;
    const ready = hasUsableLlm();
    const running = hasRunningFigureProgress(figureAnalysisState);
    const crossFigureButton = document.getElementById('analyzeCrossFigureLogic');
    if (crossFigureButton) {
        crossFigureButton.hidden = false;
        crossFigureButton.disabled = running || crossFigureLogicRunning;
        crossFigureButton.title = ready
            ? '串联主图证据'
            : llmUnavailableMessage('主图串解');
        crossFigureButton.textContent = crossFigureLogicRunning
            ? '主图串解中…'
            : '主图串解';
    }
    figureButton.hidden = false;
    figureButton.disabled = running;
    figureButton.title = ready
        ? '逐图解读'
        : llmUnavailableMessage('逐图解读');
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
    const ready = hasUsableLlm();
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
        button.hidden = false;
        button.disabled = reviewOutlineState.running;
        button.title = ready
            ? '生成整篇逐段摘要'
            : llmUnavailableMessage('逐段摘要');
        button.textContent = statusText;
    }
    const navigationButton = document.getElementById('generateOutlineSummaries');
    if (navigationButton) {
        navigationButton.disabled = reviewOutlineState.running;
        navigationButton.title = ready
            ? '为已勾选章节生成逐段摘要'
            : llmUnavailableMessage('逐段摘要');
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
        const tab = await queryPanelTargetTab();
        if (!tab?.id) throw new Error('无法获取当前论文页面');
        const response = await sendTabMessage(tab.id, {
            action: 'buildAdapterDiagnosticBundle'
        });
        if (!response?.success) {
            throw new Error(response?.error || '页面没有返回适配诊断数据');
        }
        const bundle = validateAdapterDiagnosticBundle(response.bundle);
        const currentTab = await queryPanelTargetTab();
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
        const tab = await queryPanelTargetTab();
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
    const running = hasRunningFigureProgress(status);
    const figureProgress = getFigureProgressEntries(status).map(item => ({
        ...item,
        running: running ? item.running === true : false
    }));
    const snapshot = { ...status, figureProgress };
    figureAnalysisState = {
        ...figureAnalysisState,
        ...snapshot,
        running
    };
    updateFigureButton();
    updateReviewOutlineButton();
    const renderSignature = figureProgressUiSignature(figureAnalysisState);
    if (renderSignature !== figureProgressRenderSignature) {
        figureProgressRenderSignature = renderSignature;
        renderFigureWorkspaceSnapshot(currentWorkspaceSnapshot);
    } else {
        updateFigureElapsedLabels(figureAnalysisState);
    }
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
        const tab = await queryPanelTargetTab();
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
    const modes = (llmSettingsState?.settings?.analysisModes || []).map(mode => ({
        ...mode,
        categoryIds: Array.isArray(mode.categoryIds) ? [...mode.categoryIds] : []
    }));
    const mode = modes.find(item => item.id === targetViewId);
    if (!mode) throw new Error('分析模式不存在');
    const selected = new Set(mode.categoryIds);
    if (checked) selected.add(categoryId);
    else selected.delete(categoryId);
    mode.categoryIds = [...selected];
    return updateLlmPreferencesCore({
        analysisModes: modes,
        viewCategoryOverrides: {
            ...(llmSettingsState?.settings?.viewCategoryOverrides || {}),
            [targetViewId]: { add: [], remove: [] }
        }
    });
}

function applyPreparedComposition(prepared, document) {
    preparedDocumentState = { ...prepared, document };
    currentArticleDocument = document;
    prepareState = 'prepared';
    syncPreparedSelection();
    renderCategories();
    updateApplyButton();
}

function queueReadingViewMutation(targetViewId) {
    const intent = preferenceMutationCoordinator.beginIntent();
    readingViewId = targetViewId;
    reconcileRegexSelection();
    updateReadingViewControl();
    return runSavedMutation({
        coordinator: preferenceMutationCoordinator,
        intent,
        save: () => updateLlmPreferencesCore({ readingViewId: targetViewId }),
        onSaved: (saved, { isCurrent }) => {
            reconcilePersistedLlmControls(saved, isCurrent);
            persistedReadingViewId = saved.settings.readingViewId || targetViewId;
            if (analysisMode === 'llm') invalidatePreparedComposition();
            else reconcileRegexSelection();
            if (isCurrent()) {
                updateReadingViewControl();
                renderCategories();
                updateApplyButton();
            }
        },
        refresh: (_saved, { isCurrent }) => analysisMode === 'llm'
            ? refreshPreparedComposition({
                isCurrent,
                expectedViewId: targetViewId
            })
            : Promise.resolve({ prepared: false }),
        onSaveFailed: () => {
            readingViewId = persistedReadingViewId;
            updateReadingViewControl();
            if (analysisMode === 'llm') syncPreparedSelection();
            else reconcileRegexSelection();
            renderCategories();
            updateApplyButton();
            showStatus('切换分析模式失败，已恢复原选择', 'error');
        },
        onRefreshFailed: error => {
            renderCategories();
            updateApplyButton();
            showStatus(`分析模式已保存，但正文组合刷新失败：${error.message}`, 'error');
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
    const llmSelection = analysisMode === 'llm';
    return runSavedMutation({
        coordinator: preferenceMutationCoordinator,
        intent,
        save: () => updateViewCategorySelection(categoryId, checked, targetViewId),
        onSaved: (saved, { isCurrent }) => {
            reconcilePersistedLlmControls(saved, isCurrent);
            if (llmSelection) invalidatePreparedComposition();
            else reconcileRegexSelection();
            if (isCurrent()) {
                renderCategories();
                updateApplyButton();
            }
        },
        refresh: (_saved, { isCurrent }) => llmSelection
            ? refreshPreparedComposition({
                isCurrent,
                expectedViewId: targetViewId
            })
            : Promise.resolve({ prepared: false }),
        onSaveFailed: () => {
            if (llmSelection) syncPreparedSelection();
            else reconcileRegexSelection();
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
    const llmSelection = analysisMode === 'llm';
    return runSavedMutation({
        coordinator: preferenceMutationCoordinator,
        intent,
        save: () => {
            const fallback = (llmSettingsState?.analysisModeDefaults || [])
                .find(mode => mode.id === targetViewId);
            if (!fallback) throw new Error('自定义分析模式没有内置预设');
            const modes = (llmSettingsState?.settings?.analysisModes || []).map(mode =>
                mode.id === targetViewId
                    ? { ...mode, categoryIds: [...fallback.categoryIds] }
                    : { ...mode, categoryIds: [...(mode.categoryIds || [])] }
            );
            return updateLlmPreferencesCore({
                analysisModes: modes,
                viewCategoryOverrides: {
                    ...(llmSettingsState?.settings?.viewCategoryOverrides || {}),
                    [targetViewId]: { add: [], remove: [] }
                }
            });
        },
        onSaved: (saved, { isCurrent }) => {
            reconcilePersistedLlmControls(saved, isCurrent);
            if (llmSelection) invalidatePreparedComposition();
            else reconcileRegexSelection();
            if (isCurrent()) {
                renderCategories();
                updateApplyButton();
            }
        },
        refresh: (_saved, { isCurrent }) => llmSelection
            ? refreshPreparedComposition({
                isCurrent,
                expectedViewId: targetViewId
            })
            : Promise.resolve({ prepared: false }),
        onSaveFailed: () => {
            if (llmSelection) syncPreparedSelection();
            else reconcileRegexSelection();
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
    if (targetMode === 'regex') reconcileRegexSelection();
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
            } else if (isCurrent()) {
                reconcileRegexSelection();
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
            const tab = await queryPanelTargetTab();
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
    const tab = await queryPanelTargetTab();
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
        return prepared;
    } catch (error) {
        lastArticlePreparationError = error;
        if (preferenceMutationCoordinator.isCurrent(intent)) {
            prepareState = 'idle';
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
        throw new Error('返回的正文组合与当前文献或分析模式不一致');
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

function updateAnalysisModeUi() {
    const isLlm = analysisMode === 'llm';
    document.getElementById('spanModeSection').hidden = isLlm;
    document.getElementById('llmAdaptiveControls').hidden = false;
    const hasPreset = (llmSettingsState?.analysisModeDefaults || [])
        .some(mode => mode.id === readingViewId);
    document.getElementById('restoreViewPreset').hidden = !hasPreset;
    document.getElementById('llmDiagnostics').hidden = !isLlm;
    document.getElementById('confidenceControl').hidden = !isLlm;
    updateReadingViewControl();
    updateApplyButton();
    updateFigureButton();
    updateReviewOutlineButton();
    renderConfidenceControl();
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
        const tab = await queryPanelTargetTab();
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
            parts.push(`模式 ${llmSettingsState?.readingViews?.[diagnostics.readingViewId]?.name || diagnostics.readingViewId}`);
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
            const targetViewId = readingViewId;
            try {
                await queueCategorySelectionMutation(
                    key,
                    e.target.checked,
                    targetViewId
                );
                if (analysisMode === 'regex') {
                    await saveSettings();
                }
            } catch (error) {
                if (analysisMode === 'llm') syncPreparedSelection();
                else reconcileRegexSelection();
                renderCategories();
                showStatus(`保存分类失败，已恢复原选择：${error.message}`, 'error');
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
        const tab = await queryPanelTargetTab();
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
        mode: highlightMode,
        analysisModeId: readingViewId
    });
}

function createSupplementalFigureImportTools(dependencies = {}) {
    const shared = dependencies.shared || {};
    const chromeApi = dependencies.chromeApi || globalThis.chrome;
    const cryptoApi = dependencies.cryptoApi || globalThis.crypto;
    const createImageBitmapImpl = dependencies.createImageBitmapImpl ||
        globalThis.createImageBitmap;
    const ImageImpl = dependencies.ImageImpl || globalThis.Image;
    const urlApi = dependencies.urlApi || globalThis.URL;
    const createCanvas = dependencies.createCanvas ||
        (() => globalThis.document?.createElement('canvas'));
    const btoaImpl = dependencies.btoaImpl || globalThis.btoa;
    const now = dependencies.now || (() => new Date().toISOString());
    const sendTabMessageWithRecovery = dependencies.sendTabMessageWithRecovery ||
        shared.sendTabMessageWithRecovery;
    const imageMaxSourceBytes = 20 * 1024 * 1024;
    const imageMaxBytes = Number(shared.SUPPLEMENTAL_TRANSIENT_IMAGE_MAX_BYTES) ||
        1572864;
    const imageMaxEdge = Number(shared.SUPPLEMENTAL_TRANSIENT_IMAGE_MAX_EDGE) || 1600;
    const imageMimeTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);
    const extensionMimeTypes = Object.freeze({
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        webp: 'image/webp'
    });

    function importError(code, message, fieldId = '') {
        const error = new Error(message || code);
        error.code = code;
        error.fieldId = fieldId;
        return error;
    }

    function syncSourceMode(root, requestedMode) {
        const modes = ['pdf', 'image', 'caption'];
        const mode = modes.includes(String(requestedMode)) ? String(requestedMode) : 'pdf';
        const radios = [...(root?.querySelectorAll?.(
            'input[name="supplementalFigureSourceMode"]'
        ) || [])];
        const panes = [...(root?.querySelectorAll?.(
            '[data-supplemental-source-pane]'
        ) || [])];
        radios.forEach(radio => {
            radio.checked = radio.value === mode;
        });
        panes.forEach(pane => {
            pane.hidden = pane.dataset?.supplementalSourcePane !== mode;
        });
        return mode;
    }

    function validateTarget(input = {}) {
        const workspaceId = String(input.workspaceId || '').trim().toLowerCase();
        const workspaceGeneration = Number(input.workspaceGeneration);
        const targetArticleTabId = Number(input.targetArticleTabId);
        const rawCanonicalUrl = String(input.canonicalUrl || '').trim();
        const canonicalUrl = typeof shared.normalizeSupplementalUrl === 'function'
            ? shared.normalizeSupplementalUrl(rawCanonicalUrl)
            : rawCanonicalUrl;
        const rawDocumentHash = String(input.documentHash || '').trim().toLowerCase();
        const documentHashHex = rawDocumentHash.replace(/^sha256:/, '');
        const documentHash = /^[a-f0-9]{64}$/.test(documentHashHex)
            ? `sha256:${documentHashHex}` : '';
        if (!/^workspace:[a-f0-9]{64}$/.test(workspaceId) ||
            !Number.isSafeInteger(workspaceGeneration) || workspaceGeneration < 1 ||
            !Number.isSafeInteger(targetArticleTabId) || targetArticleTabId < 0 ||
            !canonicalUrl ||
            (rawDocumentHash && !documentHash)) {
            throw importError(
                'SUPPLEMENTAL_TARGET_INVALID',
                '当前论文工作区尚未准备完成，请刷新后重试'
            );
        }
        const target = {
            workspaceId,
            workspaceGeneration,
            targetArticleTabId,
            canonicalUrl
        };
        if (documentHash) target.documentHash = documentHash;
        return Object.freeze(target);
    }

    function buildTarget(snapshot, targetArticleTabId, documentHash = '') {
        const workspace = snapshot?.localWorkspace || {};
        return validateTarget({
            workspaceId: workspace.workspaceId,
            workspaceGeneration: workspace.workspaceGeneration,
            targetArticleTabId,
            canonicalUrl: snapshot?.url || workspace.canonicalUrl,
            documentHash: documentHash || snapshot?.documentHash || workspace.documentHash
        });
    }

    function validateImageFile(file) {
        const name = String(file?.name || '').trim();
        const mediaType = String(file?.type || '').trim().toLowerCase();
        const size = Number(file?.size);
        const extension = name.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() || '';
        if (!file || !imageMimeTypes.has(mediaType) ||
            extensionMimeTypes[extension] !== mediaType ||
            !Number.isSafeInteger(size) || size <= 0 || size > imageMaxSourceBytes ||
            typeof file.arrayBuffer !== 'function') {
            throw importError(
                'SUPPLEMENTAL_IMAGE_INVALID',
                '请选择不超过 20 MiB 的 PNG、JPEG 或 WebP 图片，且扩展名与文件类型一致',
                'supplementalFigureImageFile'
            );
        }
        return file;
    }

    function normalizeCaption(value) {
        const caption = String(value || '').trim();
        if (!caption) {
            throw importError(
                'SUPPLEMENTAL_CAPTION_EMPTY', '请粘贴完整图注',
                'supplementalFigureCaption'
            );
        }
        if (caption.length > 8000) {
            throw importError(
                'SUPPLEMENTAL_CAPTION_TOO_LONG', '图注不能超过 8000 个字符',
                'supplementalFigureCaption'
            );
        }
        return caption;
    }

    function normalizeOptionalCaption(value) {
        const caption = String(value || '').trim();
        if (caption.length > 8000) {
            throw importError(
                'SUPPLEMENTAL_CAPTION_TOO_LONG', '图注不能超过 8000 个字符',
                'supplementalFigureImageCaption'
            );
        }
        return caption;
    }

    async function sha256Fingerprint(value) {
        if (!cryptoApi?.subtle?.digest) {
            throw importError('SUPPLEMENTAL_CRYPTO_UNAVAILABLE', '当前环境无法计算文件指纹');
        }
        const bytes = typeof value === 'string'
            ? new TextEncoder().encode(value)
            : value instanceof ArrayBuffer
                ? new Uint8Array(value)
                : new Uint8Array(value?.buffer || value || []);
        const digest = new Uint8Array(await cryptoApi.subtle.digest('SHA-256', bytes));
        return `sha256:${[...digest]
            .map(byte => byte.toString(16).padStart(2, '0')).join('')}`;
    }

    async function decodeImageFile(file) {
        let bitmapError = null;
        if (typeof createImageBitmapImpl === 'function') {
            try {
                const bitmap = await createImageBitmapImpl(file);
                return {
                    source: bitmap,
                    width: Number(bitmap?.width),
                    height: Number(bitmap?.height),
                    dispose: () => bitmap?.close?.()
                };
            } catch (error) {
                bitmapError = error;
            }
        }
        if (typeof ImageImpl === 'function' && urlApi?.createObjectURL) {
            const objectUrl = urlApi.createObjectURL(file);
            try {
                const image = new ImageImpl();
                await new Promise((resolve, reject) => {
                    image.onload = resolve;
                    image.onerror = () => reject(bitmapError ||
                        importError('SUPPLEMENTAL_IMAGE_DECODE', '图片无法解码'));
                    image.src = objectUrl;
                });
                return {
                    source: image,
                    width: Number(image.naturalWidth || image.width),
                    height: Number(image.naturalHeight || image.height),
                    dispose: () => urlApi.revokeObjectURL?.(objectUrl)
                };
            } catch (error) {
                urlApi.revokeObjectURL?.(objectUrl);
                throw error;
            }
        }
        if (bitmapError) throw bitmapError;
        throw importError('SUPPLEMENTAL_IMAGE_DECODE', '图片无法解码');
    }

    function canvasToBlob(canvas, mediaType, quality) {
        return new Promise((resolve, reject) => {
            try {
                canvas.toBlob(blob => {
                    if (blob) resolve(blob);
                    else reject(importError('SUPPLEMENTAL_IMAGE_ENCODE', '图片压缩失败'));
                }, mediaType, quality);
            } catch (error) {
                reject(error);
            }
        });
    }

    async function blobToDataUrl(blob, mediaType) {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let binary = '';
        for (let index = 0; index < bytes.length; index += 32768) {
            binary += String.fromCharCode(...bytes.subarray(index, index + 32768));
        }
        return `data:${mediaType};base64,${btoaImpl(binary)}`;
    }

    async function prepareTransientImage(file) {
        validateImageFile(file);
        const sourceBytes = await file.arrayBuffer();
        const sourceFingerprint = await sha256Fingerprint(sourceBytes);
        let decoded;
        try {
            decoded = await decodeImageFile(file);
        } catch (_) {
            throw importError(
                'SUPPLEMENTAL_IMAGE_DECODE', '无法解码这张图片，请重新导出后再试',
                'supplementalFigureImageFile'
            );
        }
        const sourceWidth = Number(decoded?.width);
        const sourceHeight = Number(decoded?.height);
        if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) ||
            sourceWidth <= 0 || sourceHeight <= 0) {
            decoded?.dispose?.();
            throw importError(
                'SUPPLEMENTAL_IMAGE_DECODE', '图片宽高无效，请重新选择',
                'supplementalFigureImageFile'
            );
        }
        const canvas = createCanvas();
        const context = canvas?.getContext?.('2d', { alpha: true });
        if (!canvas || !context || typeof canvas.toBlob !== 'function') {
            decoded?.dispose?.();
            throw importError('SUPPLEMENTAL_IMAGE_ENCODE', '当前环境无法处理图片');
        }
        let longestEdge = Math.min(imageMaxEdge, Math.max(sourceWidth, sourceHeight));
        let encoded = null;
        let outputWidth = 0;
        let outputHeight = 0;
        const qualities = file.type === 'image/png'
            ? [undefined]
            : [0.92, 0.84, 0.76, 0.68, 0.58];
        try {
            while (longestEdge >= 1 && !encoded) {
                const scale = Math.min(1, longestEdge / Math.max(sourceWidth, sourceHeight));
                outputWidth = Math.max(1, Math.round(sourceWidth * scale));
                outputHeight = Math.max(1, Math.round(sourceHeight * scale));
                canvas.width = outputWidth;
                canvas.height = outputHeight;
                context.drawImage(decoded.source, 0, 0, outputWidth, outputHeight);
                for (const quality of qualities) {
                    const candidate = await canvasToBlob(canvas, file.type, quality);
                    if (candidate.size > 0 && candidate.size <= imageMaxBytes) {
                        encoded = candidate;
                        break;
                    }
                }
                if (!encoded) {
                    if (longestEdge === 1) break;
                    longestEdge = Math.max(1, Math.floor(longestEdge * 0.82));
                }
            }
        } finally {
            decoded.dispose?.();
        }
        if (!encoded) {
            throw importError(
                'SUPPLEMENTAL_TRANSIENT_IMAGE_TOO_LARGE',
                '图片压缩后仍超过 1.5 MiB，请裁剪后重试',
                'supplementalFigureImageFile'
            );
        }
        const mediaType = imageMimeTypes.has(String(encoded.type).toLowerCase())
            ? String(encoded.type).toLowerCase() : file.type;
        const transient = {
            mediaType,
            dataUrl: await blobToDataUrl(encoded, mediaType),
            width: outputWidth,
            height: outputHeight,
            sourceFingerprint
        };
        return typeof shared.normalizeSupplementalTransientImage === 'function'
            ? shared.normalizeSupplementalTransientImage(transient, sourceFingerprint)
            : transient;
    }

    function sourceMaterialId(mode, sourceFingerprint) {
        return `manual-${mode}-${String(sourceFingerprint || '')
            .replace(/^sha256:/, '').slice(0, 16)}`;
    }

    function createImageImport(file, transientImage, caption = '') {
        validateImageFile(file);
        const sourceFingerprint = String(transientImage?.sourceFingerprint || '');
        const draftInput = {
            sourceMode: 'image',
            sourceMaterialId: sourceMaterialId('image', sourceFingerprint),
            sourceFileName: file.name,
            sourceMimeType: file.type,
            sourceFileSize: file.size,
            sourceImportedAt: now(),
            sourceFingerprint,
            caption: normalizeOptionalCaption(caption),
            figureLabel: file.name.replace(/\.[^.]+$/, '') || 'Supplemental Figure'
        };
        const draft = shared.createSupplementalFigureImportDraft(draftInput);
        return { draft, transientImage };
    }

    async function createCaptionImport(value) {
        const caption = normalizeCaption(value);
        const sourceFingerprint = await sha256Fingerprint(caption);
        const draft = shared.createSupplementalFigureImportDraft({
            sourceMode: 'caption',
            sourceMaterialId: sourceMaterialId('caption', sourceFingerprint),
            sourceImportedAt: now(),
            sourceFingerprint,
            caption,
            figureLabel: 'Supplemental Figure'
        });
        return { draft };
    }

    function isClosedTabError(error) {
        const code = String(error?.code || '').trim().toUpperCase();
        if ([
            'TAB_NOT_FOUND',
            'NO_TAB',
            'INVALID_TAB_ID',
            'TAB_CLOSED',
            'TARGET_TAB_CLOSED'
        ].includes(code)) return true;
        return /No tab with id|Invalid tab ID|tab (?:was )?closed|tab not found/i
            .test(String(error?.message || error || ''));
    }

    function responseError(response, fallbackCode, fallbackMessage) {
        const structured = response?.error && typeof response.error === 'object'
            ? response.error : null;
        return importError(
            response?.code || structured?.code || fallbackCode,
            structured?.message || response?.error || fallbackMessage
        );
    }

    async function deliverImport(targetInput, request = {}) {
        const target = validateTarget(targetInput);
        const draft = request?.draft;
        if (!draft || typeof draft !== 'object' || Array.isArray(draft)) {
            throw importError('SUPPLEMENTAL_DRAFT_INVALID', '补充 Figure 草稿无效');
        }
        const message = {
            action: 'importSupplementalFigureDraft',
            target,
            draft
        };
        if (request.transientImage) {
            const transientImage = shared.normalizeSupplementalTransientImage(
                request.transientImage,
                request.transientImage.sourceFingerprint
            );
            message.transientImage = {
                mediaType: transientImage.mediaType,
                dataUrl: transientImage.dataUrl,
                width: transientImage.width,
                height: transientImage.height,
                sourceFingerprint: transientImage.sourceFingerprint
            };
        }
        try {
            const response = await sendTabMessageWithRecovery(
                chromeApi, target.targetArticleTabId, message
            );
            if (response?.success === false) {
                throw responseError(
                    response,
                    'SUPPLEMENTAL_IMPORT_FAILED',
                    '无法导入补充 Figure 草稿'
                );
            }
            return response;
        } catch (error) {
            if (!isClosedTabError(error)) throw error;
            const fallback = await chromeApi.runtime.sendMessage({
                type: 'ARTICLE_WORKSPACE_SAVE_SUPPLEMENTAL_DRAFT',
                target,
                draft,
                ...(message.transientImage
                    ? { transientImage: message.transientImage }
                    : {})
            });
            if (fallback?.success === false) {
                throw responseError(
                    fallback,
                    'SUPPLEMENTAL_DRAFT_SAVE_FAILED',
                    '无法保存补充 Figure 草稿'
                );
            }
            return { ...(fallback || {}), savedAsDraft: true };
        }
    }

    return {
        syncSourceMode,
        validateTarget,
        buildTarget,
        validateImageFile,
        normalizeCaption,
        normalizeOptionalCaption,
        prepareTransientImage,
        createImageImport,
        createCaptionImport,
        deliverImport
    };
}

const supplementalFigureImportTools = createSupplementalFigureImportTools({
    shared: SciLLM,
    chromeApi: chrome
});

async function openSupplementalMaterialPdf(material, target) {
    target = supplementalFigureImportTools.validateTarget(target);
    const readerUrl = SciLLM.createSupplementalPdfReaderUrl?.(
        chrome.runtime.getURL.bind(chrome.runtime),
        {
            sourceUrl: material?.url,
            title: material?.title,
            materialId: material?.materialId,
            parentWorkspaceId: target.workspaceId,
            parentWorkspaceGeneration: target.workspaceGeneration,
            parentCanonicalUrl: target.canonicalUrl,
            parentDocumentHash: target.documentHash,
            parentTabId: target.targetArticleTabId
        }
    );
    if (!readerUrl) {
        showStatus('这个补充材料不是可直接解析的 PDF 链接', 'error');
        return;
    }
    const tab = await chrome.tabs.create({ url: readerUrl, active: true });
    await SciLLM.markTabActivated?.(chrome.storage.session, {
        ...tab,
        url: readerUrl,
        pendingUrl: readerUrl,
        title: material?.title || '补充材料 PDF'
    });
    showStatus('已在新标签页打开补充 PDF 工作区；请选择本地 PDF，解析结果会自动纳入原论文', 'success');
}

let supplementalFigureImportTarget = null;

function supplementalFigureImportMode(form = document.getElementById(
    'supplementalFigureImportForm'
)) {
    return form?.querySelector?.(
        'input[name="supplementalFigureSourceMode"]:checked'
    )?.value || 'pdf';
}

function setSupplementalFigureImportStatus(message = '', { error = false } = {}) {
    const status = document.getElementById('supplementalFigureImportStatus');
    if (!status) return;
    status.textContent = String(message || '');
    status.classList.toggle('is-error', error);
}

function focusSupplementalFigureImportError(error) {
    const field = error?.fieldId ? document.getElementById(error.fieldId) : null;
    if (field) {
        field.setAttribute('aria-invalid', 'true');
        field.focus();
    } else {
        document.getElementById('supplementalFigureImportStatus')?.focus?.();
    }
}

function openSupplementalFigureImportDialog() {
    const dialog = document.getElementById('supplementalFigureImportDialog');
    try {
        supplementalFigureImportTarget = supplementalFigureImportTools.buildTarget(
            currentWorkspaceSnapshot,
            activePanelTabContext.tabId,
            preparedDocumentState?.documentHash || manualAnnotationState.documentHash
        );
    } catch (error) {
        showStatus(error.message, 'error');
        return;
    }
    setSupplementalFigureImportStatus('');
    supplementalFigureImportTools.syncSourceMode(
        dialog,
        supplementalFigureImportMode(dialog)
    );
    dialog?.showModal();
}

function closeSupplementalFigureImportDialog() {
    document.getElementById('supplementalFigureImportDialog')?.close();
}

async function submitSupplementalFigureImport(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = document.getElementById('submitSupplementalFigureImport');
    const mode = supplementalFigureImportMode(form);
    form.querySelectorAll('[aria-invalid="true"]').forEach(field =>
        field.removeAttribute('aria-invalid')
    );
    if (submit?.disabled) return;
    if (submit) submit.disabled = true;
    setSupplementalFigureImportStatus('正在验证来源…');
    try {
        const target = supplementalFigureImportTools.validateTarget(
            supplementalFigureImportTarget
        );
        if (mode === 'pdf') {
            await openSupplementalMaterialPdf({
                materialId: `manual-supplement-${Date.now()}`,
                title: '本地补充材料 PDF',
                url: ''
            }, target);
        } else if (mode === 'image') {
            const fileInput = document.getElementById('supplementalFigureImageFile');
            const file = supplementalFigureImportTools.validateImageFile(
                fileInput?.files?.[0]
            );
            setSupplementalFigureImportStatus('正在本地校验、缩放并压缩图片…');
            const transientImage = await supplementalFigureImportTools
                .prepareTransientImage(file);
            const caption = document.getElementById(
                'supplementalFigureImageCaption'
            )?.value;
            const request = supplementalFigureImportTools.createImageImport(
                file, transientImage, caption
            );
            await supplementalFigureImportTools.deliverImport(target, request);
        } else {
            const caption = document.getElementById('supplementalFigureCaption')?.value;
            const request = await supplementalFigureImportTools.createCaptionImport(caption);
            await supplementalFigureImportTools.deliverImport(target, request);
        }
        setSupplementalFigureImportStatus(
            mode === 'pdf' ? '已在新标签页打开 PDF 工作区' : '已发出补充 Figure 草稿'
        );
        closeSupplementalFigureImportDialog();
        showStatus(
            mode === 'pdf'
                ? '已在新标签页打开补充 PDF 工作区'
                : '补充 Figure 已提交；接收端接入后会自动加入图目录',
            'success'
        );
    } catch (error) {
        setSupplementalFigureImportStatus(error.message, { error: true });
        focusSupplementalFigureImportError(error);
    } finally {
        if (submit) submit.disabled = false;
    }
}

function setupSupplementalFigureImport() {
    const dialog = document.getElementById('supplementalFigureImportDialog');
    const form = document.getElementById('supplementalFigureImportForm');
    document.getElementById('openSupplementalFigureImport')?.addEventListener(
        'click', openSupplementalFigureImportDialog
    );
    document.getElementById('closeSupplementalFigureImport')?.addEventListener(
        'click', closeSupplementalFigureImportDialog
    );
    document.getElementById('cancelSupplementalFigureImport')?.addEventListener(
        'click', closeSupplementalFigureImportDialog
    );
    form?.addEventListener('change', event => {
        if (event.target?.name !== 'supplementalFigureSourceMode') return;
        supplementalFigureImportTools.syncSourceMode(dialog, event.target.value);
        setSupplementalFigureImportStatus('');
    });
    form?.addEventListener('submit', event => {
        void submitSupplementalFigureImport(event);
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
    if (!requireUsableLlm('逐图解读')) return;
    let tab = null;
    let taskToken = null;
    try {
        tab = await queryPanelTargetTab();
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
    const tab = await queryPanelTargetTab();
    if (!tab?.id) throw new Error('无法获取当前论文页面');
    const requestSequence = ++figureOriginalViewerState.requestSequence;
    figureOriginalViewerState = {
        open: true,
        tabId: tab.id,
        figureId,
        captionVisible: false,
        requestSequence
    };
    let response;
    try {
        response = await sendTabMessage(tab.id, {
            action: 'showFigureOriginalImage', figureId
        });
    } catch (error) {
        if (requestSequence === figureOriginalViewerState.requestSequence) {
            figureOriginalViewerState = {
                open: false,
                tabId: tab.id,
                figureId: '',
                captionVisible: false,
                requestSequence
            };
        }
        throw error;
    }
    if (requestSequence !== figureOriginalViewerState.requestSequence) return;
    if (!response?.success) {
        figureOriginalViewerState = {
            open: false,
            tabId: tab.id,
            figureId: '',
            captionVisible: false,
            requestSequence
        };
        throw new Error(response?.code === 'IMAGE_NOT_FOUND'
            ? '未找到该 Figure 的高清原图' : '无法打开该 Figure 原图');
    }
    figureOriginalViewerState = {
        open: true,
        tabId: tab.id,
        figureId: String(response.figureId || figureId),
        captionVisible: response.captionVisible === true,
        requestSequence
    };
}

async function runFigurePanelFollowup(
    figureId,
    panelId,
    topics,
    customQuestion = '',
    historyLabel = ''
) {
    if (!hasUsableLlm()) throw new Error(llmUnavailableMessage('Panel 追问'));
    const tab = await queryPanelTargetTab();
    if (!tab?.id || !isCurrentFigureTask(figureTaskGeneration, tab.id)) {
        throw new Error('当前论文页面已切换，请返回后重试');
    }
    showStatus(`正在追问 ${figureId} · Panel ${panelId}…`, 'success');
    const response = await sendTabMessage(tab.id, {
        action: 'askFigurePanelWithLLM',
        figureId,
        panelId,
        topics,
        customQuestion,
        historyLabel
    });
    if (!response?.success) {
        const error = new Error(response?.error || 'FIGURE_PANEL_FOLLOWUP_FAILED');
        error.code = response?.code;
        throw error;
    }
    const followupKey = panelWorkspaceKey(figureId, panelId);
    const draft = getPanelFollowupDraft(figureId, panelId);
    draft.open = true;
    draft.topics.clear();
    draft.question = '';
    figureExpansionState.set(figureId, true);
    figurePanelExpansionState.set(followupKey, true);
    panelFollowupRevealKey = followupKey;
    await refreshArticleWorkspace();
    await persistCurrentArticleArchive().catch(() => null);
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            revealPanelFollowupAnswer(followupKey);
            setTimeout(() => {
                if (panelFollowupRevealKey !== followupKey) return;
                stabilizePanelFollowupAnswer(followupKey);
                panelFollowupRevealKey = '';
            }, 280);
        });
    });
    showStatus(`已完成 ${figureId} · Panel ${panelId} 的定向追问`, 'success');
    return response;
}

async function runSingleFigureAnalysis(figureId) {
    if (!requireUsableLlm('Figure 解读')) return;
    const taskToken = figureTaskGeneration;
    let tab = null;
    try {
        tab = await queryPanelTargetTab();
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
            ? '解图已取消，已有结果会保留。'
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
    if (!requireUsableLlm('Panel 解读')) return;
    const taskToken = figureTaskGeneration;
    let tab = null;
    try {
        tab = await queryPanelTargetTab();
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
    if (!requireUsableLlm('主图串解')) return;
    let tab = null;
    let taskToken = null;
    try {
        tab = await queryPanelTargetTab();
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
    if (!requireUsableLlm('逐段摘要')) return;
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
            documentHash: preparedDocumentState.documentHash,
            scopeSectionIds: selectedWorkspaceAnalysisSectionIds(),
            scopeSelectionProvided: true
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

function applyManualAnnotationStateEvent(event = {}, tabId = null) {
    const documentId = String(event.documentId || '');
    if (!documentId || Number(tabId) !== Number(activePanelTabContext.tabId)) return false;
    manualSummarySequence += 1;
    manualAnnotationState = {
        tabId: Number(tabId),
        documentId,
        documentHash: String(event.documentHash || ''),
        canonicalUrl: String(event.canonicalUrl || ''),
        title: String(event.title || ''),
        annotationCount: Math.max(0, Number(event.annotationCount) || 0),
        unresolvedCount: Math.max(0, Number(event.unresolvedCount) || 0)
    };
    renderManualAnnotationSummary();
    return true;
}

async function refreshManualAnnotationSummary(tabId = null) {
    const requestId = ++manualSummarySequence;
    try {
        let targetTabId = tabId;
        if (!targetTabId) {
            const tab = await queryPanelTargetTab();
            targetTabId = tab?.id;
        }
        if (!targetTabId) throw new Error('无法获取当前论文页面');
        const response = await sendTabMessage(targetTabId, {
            action: 'prepareManualAnnotations'
        });
        const currentTab = await queryPanelTargetTab();
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
        const tab = await queryPanelTargetTab();
        if (!tab?.id) throw new Error('无法获取当前论文页面');
        const response = await sendTabMessage(tab.id, {
            action: 'clearAutomaticHighlights'
        });
        if (!response?.success) throw new Error(response?.error || '清除自动高亮失败');
        matchCounts = {};
        renderCategories();
        await persistCurrentArticleArchive().catch(() => null);
        showStatus(response.persisted === false
            ? `自动高亮已清除，手动标注保留不变；本地状态保存失败：` +
                `${response.persistenceError || '请稍后重试'}`
            : '自动高亮已清除，手动标注保留不变',
        response.persisted === false ? 'error' : 'success');
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
        const tab = await queryPanelTargetTab();
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
    document.getElementById('sidePanelLanguage')?.addEventListener('click', async event => {
        const current = event.currentTarget.dataset.language === 'en' ? 'en' : 'zh-CN';
        const language = current === 'en' ? 'zh-CN' : 'en';
        updateSidePanelLanguageButton(language);
        SciLLM.setInterfaceLanguage?.(language);
        try {
            llmSettingsState = await sendLlmMessage({
                type: 'LLM_UPDATE_PREFERENCES',
                preferences: { language }
            });
        } catch (error) {
            updateSidePanelLanguageButton(current);
            SciLLM.setInterfaceLanguage?.(current);
            showStatus(`语言设置保存失败：${error.message}`, 'error');
        }
    });
    document.getElementById('analyzeFiguresFromFigures')?.addEventListener('click', runFigureAnalysis);
    document.getElementById('analyzeCrossFigureLogic')?.addEventListener('click', runCrossFigureLogic);
    document.getElementById('articleChatProfile')?.addEventListener('change', event => {
        articleChatSelectedProfileId = event.target.value;
        renderArticleChatSnapshot(currentWorkspaceSnapshot);
    });
    document.getElementById('articleChatForm')?.addEventListener('submit', event => {
        void submitArticleChat(event);
    });
    document.getElementById('highlightArticleChatMatches')?.addEventListener('click', event => {
        void submitArticleSemanticHighlight(event);
    });
    document.getElementById('articleChatHighlightCategory')?.addEventListener(
        'change', syncArticleChatHighlightColor
    );
    document.getElementById('articleChatMessages')?.addEventListener('scroll', event => {
        if (articleChatScrollToLatestActive) return;
        articleChatFollowLatest = isArticleChatNearBottom(event.currentTarget);
        updateArticleChatReturnLatest();
    }, { passive: true });
    document.getElementById('articleChatMessages')?.addEventListener(
        'click', handleArticleChatTurnAction
    );
    document.getElementById('articleChatLoadEarlier')?.addEventListener('click', () => {
        void loadEarlierArticleChatHistory().catch(error =>
            showStatus('无法加载更早问答：' + error.message, 'error'));
    });
    document.getElementById('articleChatReturnLatest')?.addEventListener('click', () => {
        scrollArticleChatToLatest({ smooth: true });
    });
    document.getElementById('articleChatQuestion')?.addEventListener('input', () => {
        updateArticleChatCommandMenu();
    });
    document.getElementById('articleChatQuestion')?.addEventListener('click', () => {
        updateArticleChatCommandMenu();
    });
    document.getElementById('articleChatQuestion')?.addEventListener('keydown', event => {
        if (!document.getElementById('articleChatCommandMenu')?.hidden) {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                setArticleChatCommandActive(articleChatCommandActiveIndex +
                    (event.key === 'ArrowDown' ? 1 : -1));
                return;
            }
            if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
                event.preventDefault();
                selectArticleChatCommand();
                return;
            }
            if (event.key === 'Escape') {
                event.preventDefault();
                closeArticleChatCommandMenu();
                return;
            }
        }
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
            event.preventDefault();
            void submitArticleChat(event);
        }
    });
    document.getElementById('articleChatCommandMenu')?.addEventListener('click', event => {
        const option = event.target.closest('[data-command-index]');
        if (option) selectArticleChatCommand(Number(option.dataset.commandIndex));
    });
    document.addEventListener('pointerdown', event => {
        const menu = document.getElementById('articleChatCommandMenu');
        if (!menu || menu.hidden) return;
        const input = document.getElementById('articleChatQuestion');
        const scopes = document.getElementById('articleChatContextScopes');
        if (menu.contains(event.target) || input?.contains(event.target) ||
            scopes?.contains(event.target)) return;
        closeArticleChatCommandMenu();
    });
    document.getElementById('articleChatContextScopes')?.addEventListener('click', event => {
        const chip = event.target.closest('[data-scope-id]');
        if (!chip) return;
        articleChatContextScopes.delete(chip.dataset.scopeId);
        renderArticleChatContextScopes();
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

    document.getElementById('readingViewControl')?.addEventListener('change', async event => {
        if (!event.target.matches('input[name="readingView"]')) return;
        try {
            await queueReadingViewMutation(event.target.value);
        } catch (error) {
            readingViewId = persistedReadingViewId;
            updateReadingViewControl();
            renderCategories();
            showStatus(`切换分析模式失败，已恢复原选择：${error.message}`, 'error');
        }
    });

    document.getElementById('restoreViewPreset').addEventListener('click', async () => {
        try {
            const targetViewId = readingViewId;
            const result = await queueRestoreViewPreset(targetViewId);
            if (result.status === 'refreshed') {
                showStatus('已恢复当前分析模式预设', 'success');
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
            const tab = await queryPanelTargetTab();
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
                    documentHash: preparedDocumentState.documentHash,
                    readingViewId
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
let statusMessageTimer = null;

function showStatus(message, type) {
    const statusEl = document.getElementById('statusMessage');
    recordSidePanelNotification(message, type);
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.className = `status-message side-panel-global-status ${type} show`;

    if (statusMessageTimer !== null) clearTimeout(statusMessageTimer);
    statusMessageTimer = setTimeout(() => {
        statusEl.classList.remove('show');
        statusMessageTimer = null;
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
