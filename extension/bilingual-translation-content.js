// TRANS-055: local bilingual display only. Never rewrite or persist source nodes.
(function attach(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.BrevessBilingualTranslationContent = api;
    if (root.document && root.chrome?.runtime?.id && root.top === root &&
        !root.__brevessBilingualTranslation) {
        root.__brevessBilingualTranslation = api.createPageTranslator({
            document: root.document, window: root
        });
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
    const UI = '[data-sci-plugin-ui],[data-sci-translation]';
    // Exclude only identified translated output, never generic .notranslate source text.
    const FOREIGN_TRANSLATION = '.immersive-translate-target-wrapper,[data-immersive-translate-translation-element-mark="1"]';
    const INTERACTIVE = 'a[href],button,input,textarea,select,summary,[role="button"],[role="link"],[role="menuitem"]';
    const OMIT_TEXT = UI + ',' + FOREIGN_TRANSLATION + ',script,style,template,noscript,input,textarea,select,button,math,.MathJax,.katex,[role="math"]';
    const OMIT_SOURCE = OMIT_TEXT + ',nav,footer,form,aside,[role="navigation"],' +
        '[role="dialog"],[role="menu"],[role="doc-bibliography"],[contenteditable]:not([contenteditable="false"]),' +
        '#references,.references,.ref-list,[id^="ref-list"],.c-article-references,' +
        'math,.MathJax,.katex,[role="math"],svg,canvas,pre,code';
    const READING = 'article,main,[role="main"],#main-content,#content,#article-body,#body,.Body,' +
        '.article-body,.articleBody,.article__body,.article__sections,.article-content,' +
        '.article-section__content,.c-article-body,.abstract-content,.highwire-markup,' +
        '.widget-ArticleFulltext,.hlFld-Fulltext,#artText,.JournalFullText,.art-text,' +
        '#pnlArticleContent,.bodySection,.article-full-text,.o-article-body';
    const SEMANTIC_CANDIDATE = 'p,h1,h2,h3,h4,h5,h6,figcaption,.fig-caption,.figure-caption,' +
        '.c-article-section__figure-caption,.figcaption,.caption,.article-title,.c-article-title,.title-text,' +
        '[role="paragraph"],[role="heading"],.para,.paragraph,.section-paragraph,.html-p,' +
        '.section-title,.section__title,.article-section-title,.c-article-section__title';
    // Reading extraction has already identified these DIVs as paragraphs. Publisher
    // IDs cover the same source before extraction or focus-layout markers arrive.
    const CANDIDATE = SEMANTIC_CANDIDATE + ',div[data-sci-llm-paragraph-id],div[id^="p"],div[id^="fspara"]';
    function readSourceText(element) {
        if (globalThis.BrevessTranslationSource?.readSourceText) {
            return globalThis.BrevessTranslationSource.readSourceText(element, {
                allowHiddenRoot: element?.matches?.('.full-view-snippet') === true
            });
        }
        const parts = [];
        const stack = [element];
        while (stack.length) {
            const node = stack.pop();
            if (node.nodeType === 3) { parts.push(node.nodeValue || ''); continue; }
            if (node.nodeType !== 1 || node.matches?.(OMIT_TEXT)) continue;
            if (node.tagName === 'BR') { parts.push(' '); continue; }
            const children = node.childNodes || [];
            for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
        }
        return parts.join('').replace(/\s+/gu, ' ').trim();
    }
    function readSourceProjection(element) {
        return globalThis.BrevessTranslationSource?.extractSource?.(element, {
            allowHiddenRoot: element?.matches?.('.full-view-snippet') === true
        }) || {text:readSourceText(element)};
    }
    function sameScientificContext(a, b) { return JSON.stringify(a || []) === JSON.stringify(b || []); }
    function sourceMatches(record) {
        const source = readSourceProjection(record.element);
        return source.text === record.text && sameScientificContext(source.scientificContext, record.scientificContext);
    }
    function localTranslationErrorMessage(error) {
        const code = typeof error === 'string' ? error : error?.code || error?.name || '';
        const messages = {
            API_UNAVAILABLE: '当前页面环境没有可用的官方 Translator 接口。请检查浏览器支持与策略；未调用云端服务。',
            LANGUAGE_UNAVAILABLE: '浏览器暂未提供本地英译中资源，请检查模型与浏览器状态。',
            NATIVE_UNAVAILABLE: '本机翻译模型或服务暂不可用，浏览器未提供具体原因。自动重试后仍失败时，请保存工作并完全退出、重启浏览器；若持续失败，检查并安装浏览器更新后再试。',
            MODEL_NOT_READY: '浏览器仍在检查设备或准备本地模型，自动重试后仍未就绪；可继续重试。',
            CAPABILITY_TIMEOUT: '浏览器能力检查超时，可继续重试；原文保持不变。',
            INITIALIZATION_TIMEOUT: '本地模型准备长时间无进展或超过时限，可继续重试。',
            TRANSLATION_POLICY_BLOCKED: '当前网页的权限策略阻止浏览器本地翻译。',
            TRANSLATION_CONTEXT_UNAVAILABLE: '当前页面不是安全上下文，浏览器未提供本地翻译权限。',
            USER_ACTIVATION_REQUIRED: '浏览器需要原网页上的操作；操作后会自动继续本地翻译。',
            NotAllowedError: '浏览器需要原网页上的操作或权限；操作后会自动继续本地翻译。',
            INITIALIZATION_FAILED: '本地英译中模型下载或初始化失败。请检查网络、可用磁盘空间及浏览器状态，关闭后重试；未调用云端服务。',
            TRANSLATION_FAILED: '当前段落的本地翻译失败，其他有效译文仍保留；可关闭后重试，未调用云端服务。',
            TRANSLATION_TIMEOUT: '本地翻译等待超时，已保留原文和已完成的部分译文；可关闭后重试。',
            EMPTY_TRANSLATION: '本地模型返回空译文，原文保持不变；可关闭后重试。',
            INVALID_TRANSLATION: '本地模型返回的译文异常，已保留原文；其他有效译文不受影响。',
            NOT_INITIALIZED: '本地翻译会话尚未初始化，请关闭后重新开启。',
            ABORTED: '本地翻译已取消。'
        };
        return messages[code] || '本地翻译失败；未调用云端服务。请关闭后重试。';
    }
    function documentIdentity(value) {
        // Match contentNavigationIdentity: fragments identify a position in the
        // same document, while the path and query still distinguish documents.
        try {
            const address = new URL(String(value || ''));
            address.hash = '';
            return address.href;
        } catch { return String(value || '').replace(/#.*/, ''); }
    }
    // The storage record is shared with chat, highlighting and display settings.
    // Compare only dependencies of the full-text route; do not retire a live
    // translator merely because another task saved its preferences. This is an
    // in-memory comparison only: credentials are never logged or persisted here.
    function translationSettingsIdentity(settings) {
        const plain = value => value && typeof value === 'object' && !Array.isArray(value);
        const stable = (value, depth = 0) => {
            if (depth > 32) throw new TypeError('Translation settings are too deeply nested.');
            if (!value || typeof value !== 'object') return value;
            if (Array.isArray(value)) return value.map(item => stable(item, depth + 1));
            return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key], depth + 1)]));
        };
        const encode = value => JSON.stringify(stable(value));
        // Older/unknown formats need the existing conservative invalidation.
        if (!plain(settings) || settings.version !== 6 || !plain(settings.taskPolicies)) return encode(settings);
        const policy = settings.taskPolicies.full_text_translation;
        if (!plain(policy)) return encode(settings);
        const mode = policy.mode;
        if (!['local', 'global', 'profile'].includes(mode)) return encode(settings);
        // Both current native and remote tasks are fixed en -> zh. UI language
        // is not their output language. Bind explicit task language fields too.
        if (mode === 'local') return encode({ mode, sourceLanguage: policy.sourceLanguage, targetLanguage: policy.targetLanguage });
        const profileId = String(mode === 'profile' ? policy.profileId || '' : settings.globalProfileId || '');
        const profile = Object.hasOwn(settings.profiles || {}, profileId) ? settings.profiles[profileId] : null;
        if (!plain(profile) || !plain(profile.config)) return encode({ mode, profileId, policy, profile, consentGranted: settings.consentGranted === true });
        const config = { ...profile.config };
        // The router validates the original profile before task overrides. Only
        // fields omitted below need these checks; all other config changes are
        // retained verbatim. Keep this independent of provider-registry loading
        // because the content world does not always include that helper.
        const defaultModel = String(config.model || '').trim();
        const defaultEffort = String(config.reasoningEffort || 'auto');
        const profileUsable = Boolean(defaultModel) &&
            (profile.providerId !== 'deepseek-harness' || defaultModel !== 'auto') &&
            (profile.providerId !== 'codex-local' || ['auto', 'low', 'medium', 'high', 'xhigh'].includes(defaultEffort)) &&
            (profile.providerId !== 'deepseek-harness' || ['auto', 'off', 'low', 'high', 'max'].includes(defaultEffort));
        if (!profileUsable) return encode(settings);
        // Mirror taskModelForProfile and resolveTaskProfile: these profile
        // defaults are replaced by the task's explicit model/reasoning policy.
        const taskModel = policy.modelProfileId === profileId &&
            (!policy.modelProviderId || policy.modelProviderId === profile.providerId) &&
            (policy.modelPresetId === undefined || policy.modelPresetId === String(config.presetId || ''))
            ? String(policy.model || '').trim() : '';
        if (taskModel) config.model = taskModel;
        delete config.thinking; delete config.reasoningEnabled; delete config.reasoningEffort;
        return encode({ mode, profileId, providerId: profile.providerId, config, policy,
            tokenPolicy: profile.tokenPolicy || {}, consentGranted: settings.consentGranted === true });
    }
    function createPageTranslator({ document, window: view = document.defaultView,
        provider: suppliedProvider, createController = view.BrevessBilingualTranslation?.createController } = {}) {
        const pageId = view.crypto?.randomUUID?.() || String(Date.now()) + '-' + Math.random();
        let standaloneLifecycle = 0, activeDocumentBinding = null;
        let url = documentIdentity(document.location.href);
        let state = { enabled: false, active: false, mode: 'off', phase: 'idle', availability: '', progress: 0,
            completed: 0, total: 0, error: '', errorCode: '', errorDetails: null, url, pageId };
        let epoch = 0, serial = 0, initializing = null, destroyed = false;
        let selectionPreparation = null;
        let scanTimer = null, publishTimer = null, pruneTimer = null, notice = null;
        let mutationObserver = null, intersectionObserver = null;
        const records = new Map(), elements = new WeakMap(), anchors = new WeakMap(), scans = new Map();
        const selectedSources = new Set(), displaySources = new WeakMap();
        let wholePageScope = false;
        const standaloneTranslationAllowed = () => view.__brevessPageToolsReaderActivated === true ||
            view.__brevessPageToolsPreferences?.pageTranslation !== false;
        const selectionTasks = new Set();
        const paragraphTasks = new Map();
        let pageTask = null, taskSequence = 0;
        let scope = null, resuming = false;
        let hiddenSources = new WeakSet(), hoveredSource = null, altSource = null, hoverPoint = null;
        const checkpointApi = view.BrevessTranslationCheckpoint || globalThis.BrevessTranslationCheckpoint ||
            (typeof require === 'function' ? require('./core/translation-checkpoint.js') : null);
        const translationBridge = view.__brevessTranslationTasks || (!suppliedProvider && view.chrome?.runtime?.id
            ? view.BrevessLocalTranslator?.createRuntimeBridge?.({ runtime: view.chrome.runtime }) : null);
        let checkpoints = new Map(), acknowledgedResults = new Map(), persistenceTail = Promise.resolve(), checkpointRevision = 0, checkpointRevisionKey = null;
        const knownSources = new Map();
        let noticeDismissed = false, translationsHidden = false;
        let lastEngineSignature = checkpointApi?.LOCAL_SIGNATURE || 'browser-translator:en:zh:validated-prefix-v2';
        let settingsPreparation = null, settingsEpoch = 0;
        let settingsResumption = null;
        const engineSignature = () => provider?.getState?.().engineSignature || lastEngineSignature;
        function captureBinding() {
            let binding;
            try { binding = translationBridge?.capture?.() || view.__brevessLocalTranslationTaskNotifications?.capture?.(); } catch { /* Optional bridge. */ }
            // The always-injected translator owns this nonce before content.js
            // exists. Background still verifies the browser's tab/frame/document.
            return { ...(binding || { documentIdentity: pageId, workspaceLifecycle: standaloneLifecycle }), navigationIdentity: documentIdentity(document.location.href),
                pageUrl: binding?.pageUrl || url, pageId };
        }
        function matchesIdentity(expected, binding = captureBinding()) {
            if (typeof expected === 'string') return documentIdentity(expected) === binding.navigationIdentity;
            if (!expected || typeof expected !== 'object') return false;
            const keys = Object.keys(expected);
            return keys.length > 0 && keys.every(key => Object.hasOwn(binding, key) && expected[key] === binding[key]);
        }
        function checkpointIdentity(key, text, signature = engineSignature(), context) { return JSON.stringify([key, text, signature, ...(context?.length ? [context] : [])]); }
        function exportIdentity(key, text, context) { return JSON.stringify([key, text, ...(context?.length ? [context] : [])]); }
        function revisionIdentity(binding, signature) { return JSON.stringify([checkpointApi?.stableBinding(binding) || binding, signature]); }
        function observeRevision(binding, signature, revision) {
            const key = revisionIdentity(binding, signature);
            checkpointRevision = key === checkpointRevisionKey ? Math.max(checkpointRevision, revision) : revision;
            checkpointRevisionKey = key;
        }
        function confirmedEntry(record) {
            const saved = record.checkpoint;
            if (!saved || !record.translation?.isConnected) return saved;
            const displayed = record.translation.textContent;
            if (record.lastPaintedText !== undefined && displayed !== record.lastPaintedText && displayed !== saved.translatedText && typeof displayed === 'string' && displayed.trim()) {
                record.checkpoint = { ...saved, translatedText: displayed, manuallyEdited: true };
                record.persisted = false;
                if (record.reused) { record.reused = false; reusedCount--; }
                checkpoints.set(checkpointIdentity(record.checkpoint.sourceKey, record.text, record.checkpoint.engineSignature, record.scientificContext), { ...record.checkpoint });
                cachedResults.set(record.element, { url, text: record.text, ...record.checkpoint, persisted: false });
            }
            return record.checkpoint;
        }
        function remember(record, translatedText, sourceEnd) {
            if (!checkpointApi || !record.sourceKey) return Promise.resolve();
            const existing = confirmedEntry(record);
            if (existing?.manuallyEdited) {
                if (record.persisted === true) return Promise.resolve();
                if (record.persistencePending && record.persistenceEpoch === epoch && record.persistenceEntry === existing) return record.persistence;
                return persistRecord(record, existing);
            }
            const entry = checkpointApi.normalizeEntry({ sourceKey: record.sourceKey, sourceText: record.text, scientificContext: record.scientificContext,
                translatedText, sourceStart: 0, sourceEnd, confirmed: true,
                sourceLanguage: 'en', targetLanguage: 'zh', engineSignature: engineSignature() });
            if (!entry) return Promise.resolve();
            // Final output repeats the last validated progress snapshot. Reuse
            // its exact ACK instead of writing the same whole-page checkpoint
            // twice; failed or retired writes still need a fresh persistence.
            if (existing && JSON.stringify(existing) === JSON.stringify(entry)) {
                if (record.persisted === true) return Promise.resolve();
                if (record.persistencePending && record.persistenceEpoch === epoch && record.persistenceEntry === existing) return record.persistence;
            }
            record.checkpoint = entry;
            checkpoints.set(checkpointIdentity(entry.sourceKey, entry.sourceText, undefined, entry.scientificContext), entry);
            return persistRecord(record, entry);
        }
        function persistRecord(record, entry) {
            cachedResults.set(record.element, { url, text: record.text, ...entry, persisted: false });
            const token = epoch;
            record.persisted = false; record.persistencePending = true; record.persistenceError = false; record.persistenceEntry = entry; record.persistenceEpoch = token;
            if (current(token)) {
                if (state.enabled && !pageTask) pageTask = beginTask('全文翻译');
                update({ ...scopeProgress(), ...(state.enabled && !state.paused ? { phase: 'translating', progress: Math.min(.99, state.progress) } : {}) });
            }
            const operation = persistEntries([entry]).then(() => {
                if (token !== epoch || destroyed) return;
                // Keep the last acknowledged revision even if the displayed draft changed while saving.
                acknowledgedResults.set(exportIdentity(entry.sourceKey, entry.sourceText, entry.scientificContext), { ...entry });
                if (record.checkpoint !== entry) return;
                record.persisted = true;
                if (entry.manuallyEdited && !record.reused) { record.reused = true; reusedCount++; }
                cachedResults.set(record.element, { url, text: record.text, ...record.checkpoint, persisted: true });
                view.dispatchEvent?.(new view.CustomEvent('brevess-translation-saved'));
            }, error => {
                if (token === epoch && record.checkpoint === entry) record.persistenceError = true;
                throw error;
            }).finally(() => {
                if (record.persistence !== operation) return;
                record.persistencePending = false;
                if (current(token)) { update(scopeProgress()); maybeFinishPageTask(); }
            });
            record.persistence = operation;
            record.persistence.catch(() => {});
            return record.persistence;
        }
        function persistEntries(entries) {
            if (!translationBridge?.writeCheckpoint || !entries.length) return Promise.resolve();
            const binding = captureBinding(), signature = engineSignature();
            const token = epoch;
            persistenceTail = persistenceTail.catch(() => {}).then(async () => {
                if (token !== epoch || !matchesIdentity(binding) || signature !== engineSignature() || destroyed) throw Object.assign(Error('Translation save cancelled.'), { code: 'ABORTED' });
                try {
                    const saved = await translationBridge.writeCheckpoint(binding, signature, entries, {
                        expectedRevision: checkpointRevisionKey === revisionIdentity(binding, signature) ? checkpointRevision : 0 });
                    if (!matchesIdentity(binding) || signature !== engineSignature() || destroyed) return;
                    // A retired write can finish after same-document restart. Its ACK updates only the
                    // serial CAS cursor; the current epoch must save its own revision before completing.
                    observeRevision(binding, signature, saved.revision);
                    if (token !== epoch) return;
                    update({ checkpointPersistence: 'saved', checkpointError: '' });
                } catch (error) {
                    if (token === epoch && matchesIdentity(binding) && !destroyed) update({ checkpointPersistence: 'failed', checkpointError: error?.code || 'TRANSLATION_CHECKPOINT_SAVE_FAILED' });
                    throw error;
                }
            });
            persistenceTail.catch(() => {});
            return persistenceTail;
        }
        async function restoreCheckpoints(token) {
            if (!translationBridge?.readCheckpoint || !checkpointApi) return;
            const binding = captureBinding(), signature = engineSignature();
            const saved = await translationBridge.readCheckpoint(binding, signature);
            if (!current(token) || !matchesIdentity(binding) || signature !== engineSignature()) return;
            if (saved?.version !== 1 || saved.engineSignature !== signature ||
                JSON.stringify(saved.documentBinding) !== JSON.stringify(checkpointApi.stableBinding(binding))) return;
            observeRevision(binding, signature, saved.revision);
            for (const value of saved.translations || []) {
                const entry = checkpointApi.normalizeEntry(value);
                if (entry?.engineSignature === signature) {
                    checkpoints.set(checkpointIdentity(entry.sourceKey, entry.sourceText, undefined, entry.scientificContext), entry);
                    acknowledgedResults.set(exportIdentity(entry.sourceKey, entry.sourceText, entry.scientificContext), { ...entry });
                }
            }
            update({ checkpointPersistence: 'saved', checkpointError: '' });
        }
        let displayRestoreGeneration = 0;
        async function restoreSavedTranslations({ snapshot, expectedIdentity } = {}) {
            if (destroyed || state.active) return { restored: 0, skipped: true };
            checkNavigation();
            const generation = ++displayRestoreGeneration, token = epoch, binding = captureBinding();
            if (expectedIdentity && !matchesIdentity(expectedIdentity, binding)) throw Object.assign(Error('Translation history target changed.'), { code: 'TRANSLATION_CONTEXT_STALE' });
            const valid = () => !destroyed && !state.active && token === epoch && generation === displayRestoreGeneration && matchesIdentity(binding);
            let saved = snapshot;
            if (!saved) {
                if (!translationBridge?.readCheckpoint || !provider) return { restored: 0 };
                // Resolves the saved engine route only; never creates a model/session.
                await provider.availability();
                if (!valid()) return { restored: 0, stale: true };
                saved = await translationBridge.readCheckpoint(binding, engineSignature());
            }
            if (!valid()) return { restored: 0, stale: true };
            if (!saved || saved.version !== 1 || !checkpointApi ||
                JSON.stringify(checkpointApi.stableBinding(saved.documentBinding)) !== JSON.stringify(checkpointApi.stableBinding(binding))) {
                throw Object.assign(Error('Translation history belongs to another document.'), { code: 'TRANSLATION_CHECKPOINT_IDENTITY_MISMATCH' });
            }
            if (!Array.isArray(saved.translations) || saved.translations.length > 2000 || JSON.stringify(saved.translations).length > 2000000) {
                throw Object.assign(Error('Translation history exceeds its bound.'), { code: 'TRANSLATION_CHECKPOINT_LIMIT' });
            }
            bindControllerDocument();
            const entries = new Map(saved.translations.map(checkpointApi.normalizeEntry).filter(Boolean)
                .map(entry => [exportIdentity(entry.sourceKey, entry.sourceText, entry.scientificContext), entry]));
            if (!snapshot) observeRevision(binding, engineSignature(), saved.revision);
            let restored = 0;
            for (const element of document.querySelectorAll(CANDIDATE)) {
                const anchor = sourceAnchor(element);
                if (!anchor || !element.isConnected) continue;
                const {text, scientificContext} = readSourceProjection(element), sourceKey = checkpointApi.sourceKey(element);
                const entry = entries.get(exportIdentity(sourceKey, text, scientificContext));
                if (!entry) continue;
                const existing = elements.get(element);
                // An explicit history display never overwrites an unsaved/manual edit.
                if (existing && (confirmedEntry(existing)?.manuallyEdited || existing.persisted === false)) continue;
                if (existing) forget(existing);
                const record = { id: 'bilingual-' + (++serial), element, anchor, text, scientificContext, sourceKey, epoch,
                    priority: priority(anchor), foreground: false, translation: null,
                    checkpoint: { ...entry }, persisted: true, reused: !entry.partial || entry.manuallyEdited };
                if (record.reused) reusedCount++;
                records.set(record.id, record); elements.set(element, record); anchors.set(anchor, record);
                knownSources.set(sourceKey, { element, text, scientificContext });
                checkpoints.set(checkpointIdentity(sourceKey, text, entry.engineSignature, scientificContext), { ...entry });
                acknowledgedResults.set(exportIdentity(sourceKey, text, scientificContext), { ...entry });
                cachedResults.set(element, { url, text, ...entry, persisted: true });
                paintTranslation(record, entry.translatedText, { partial: entry.partial });
                restored++;
            }
            update({ restoredTranslations: restored, checkpointPersistence: 'saved', checkpointError: '' });
            return { restored };
        }
        // Weak keys tie cached results to the actual source node, not just matching text.
        // A closed reader can reuse completed results without retaining detached DOM.
        let cachedResults = new WeakMap(), reusedCount = 0;
        const now = () => view.performance.now();
        const schedule = callback => view.setTimeout(callback, 0);
        const isUi = node => Boolean((node?.nodeType === 1 ? node : node?.parentElement)?.closest?.(UI));
        const current = token => !destroyed && state.active && token === epoch && documentIdentity(document.location.href) === url &&
            (!activeDocumentBinding || matchesIdentity(activeDocumentBinding));
        const getState = () => ({ ...state });
        const wallNow = () => view.Date?.now?.() ?? Date.now();
        function beginTask(label) {
            let binding = null;
            try { binding = view.__brevessLocalTranslationTaskNotifications?.capture?.() || null; } catch { /* Optional task observer. */ }
            return { taskId: `local-translation:${pageId}:${++taskSequence}`, label, startedAt: wallNow(), binding };
        }
        function finishTask(task, status) {
            if (!task || task.finished) return;
            task.finished = true;
            if (!task.binding) return;
            // The content bridge owns the nonce and rechecks source identity.
            // No source text, translated text or arbitrary provider errors enter metadata.
            try {
                const operation = view.__brevessLocalTranslationTaskNotifications?.emit?.({
                    taskId: task.taskId, label: task.label, status,
                    engine: '浏览器本地翻译', models: [], requests: 0,
                    elapsedMs: Math.max(0, wallNow() - task.startedAt),
                    inputTokens: null, outputTokens: null, totalTokens: null,
                    usageState: 'unavailable', missingUsageRequests: 0, estimated: false
                }, task.binding);
                operation?.catch?.(() => {});
            } catch { /* Notification delivery must not interrupt translation or cancellation. */ }
        }
        function finishParagraphTask(source, status) {
            const task = paragraphTasks.get(source);
            paragraphTasks.delete(source);
            finishTask(task, status);
        }
        function finishPageTask(status) {
            const task = pageTask;
            pageTask = null;
            finishTask(task, status);
        }
        function finishPendingTasks(status) {
            finishPageTask(status);
            for (const source of paragraphTasks.keys()) finishParagraphTask(source, status);
        }
        function maybeFinishPageTask(value = controller?.getState?.()) {
            if (!pageTask || !state.active || !state.enabled || destroyed ||
                scans.size || scanTimer !== null || publishTimer !== null || initializing || resuming ||
                !value?.enabled || value.phase !== 'ready' || state.paused || !scope) return;
            const progress = scopeProgress();
            if (progress.pending !== 0) return;
            const failed = progress.failed > 0 || progress.unknown > 0 || progress.completed !== progress.total;
            update({ ...progress, phase: failed ? 'partial' : 'complete', progress: failed ? Math.min(.99, progress.total ? progress.completed / progress.total : 0) : 1 });
            finishPageTask(failed ? 'failed' : 'success');
            if ([...records.keys()].some(id => !scope.has(id))) queuePublish();
        }
        function scopeProgress() {
            const result = { total: scope?.size || 0, completed: 0, pending: 0, failed: 0, retrying: 0, unknown: 0, blocked: 0, saving: 0, saveFailed: 0 };
            for (const [id, text] of scope || []) {
                const record = records.get(id);
                if (!record || record.text !== text) { result.failed++; result.blocked++; continue; }
                if (record.persisted === false && record.checkpoint?.manuallyEdited) {
                    if (record.persistencePending) { result.pending++; result.saving++; }
                    else if (record.persistenceError) { result.failed++; result.saveFailed++; }
                    else result.pending++;
                    continue;
                }
                if (record.reused || record.entryStatus === 'done') { result.completed++; continue; }
                const status = record.entryStatus || 'pending';
                if (['pending', 'translating', 'retrying', 'saving', 'cancelled'].includes(status)) result.pending++;
                if (['failed', 'blocked', 'unknown', 'save-failed'].includes(status)) result.failed++;
                if (record.retryBlocked) result.unknown++;
                if (status === 'retrying') result.retrying++;
                if (status === 'blocked') result.blocked++;
                if (status === 'saving') result.saving++;
                if (status === 'save-failed') result.saveFailed++;
            }
            return result;
        }
        function sendState() {
            try {
                const result = view.chrome?.runtime?.sendMessage({
                    type: 'BREVESS_TRANSLATION_STATE', state: getState()
                });
                result?.catch?.(() => {});
            } catch { /* Extension can be reloaded while the page remains open. */ }
        }
        function update(patch) {
            state = { ...state, ...patch, url, pageId };
            renderNotice();
            sendState();
        }
        function errorText(error) {
            const code = typeof error === 'string' ? error : error?.code || error?.name || '';
            const messages = {
                NO_USABLE_PROFILE: '已保存的翻译专用模型不可用，请修正配置后继续。',
                LLM_NOT_READY: '请先保存可用模型配置并确认正文发送授权。',
                TRANSLATION_BRIDGE_UNAVAILABLE: '翻译后台暂不可用，已保留译文和原文。',
                TRANSLATION_ROUTE_INVALID: '翻译引擎配置身份无效，请检查已保存配置。',
                TRANSLATION_ROUTE_STALE: '翻译模型配置已变化，请重新开启翻译。',
                TRANSLATION_CONTEXT_STALE: '当前文献或原文已变化，本次译文未提交。',
                TRANSLATION_OUTCOME_UNKNOWN: '本段请求完成状态未知，已阻止重复调用；等待原请求回执。',
                AUTH_INVALID: '翻译模型认证失败，请修正已保存的配置后继续。',
                QUOTA_EXHAUSTED: '翻译模型额度不足，已保留合格译文。',
                RATE_LIMITED: '翻译服务仍在限流，已保留译文和未完成段落。',
                TRANSLATION_RECOVERY_EXHAUSTED: '自动恢复已达到累计请求、重试或无进展上限，已保留合格译文。',
                TRANSLATION_CHECKPOINT_SAVE_FAILED: '译文已通过校验，但保存未成功；继续只重试保存。'
            };
            if (messages[code]) return messages[code];
            if (provider?.getState?.().mode && provider.getState().mode !== 'local') return '所选模型翻译失败，已保留有效译文和原文。';
            return localTranslationErrorMessage(error);
        }
        function removeNotice() { notice?.remove(); notice = null; }
        function renderNotice() {
            if (!document.body) return;
            const phases = ['checking', 'awaiting-user', 'initializing', 'downloading', 'error', 'unavailable'];
            phases.push('paused', 'partial');
            if (noticeDismissed || !phases.includes(state.phase)) { removeNotice(); return; }
            if (!notice) {
                notice = document.createElement('section');
                notice.className = 'sci-translation-notice';
                notice.setAttribute('data-brevess-interface', '');
                notice.setAttribute('data-sci-plugin-ui', '');
                notice.setAttribute('aria-label', 'Brevess 双语阅读');
                const text = document.createElement('span');
                text.className = 'sci-translation-notice-text';
                text.setAttribute('role', 'status'); text.setAttribute('aria-live', 'polite');
                const progress = document.createElement('progress');
                progress.className = 'sci-translation-progress';
                progress.max = 1; progress.setAttribute('aria-label', '本地翻译模型下载进度');
                const initialize = document.createElement('button');
                initialize.type = 'button'; initialize.className = 'sci-translation-initialize';
                initialize.addEventListener('click', () => {
                    // This call must stay synchronously inside the real page click.
                    void initializeFromPage();
                });
                const close = document.createElement('button');
                close.type = 'button'; close.className = 'sci-translation-dismiss';
                close.textContent = '收起提示'; close.title = '仅收起提示，保留译文和翻译进度';
                close.setAttribute('aria-label', close.title);
                close.addEventListener('click', dismissNotice);
                const pauseButton = document.createElement('button');
                pauseButton.type = 'button'; pauseButton.className = 'sci-translation-pause';
                pauseButton.addEventListener('click', () => { if (state.paused) void resume(); else pause(); });
                const retry = document.createElement('button');
                retry.type = 'button'; retry.className = 'sci-translation-retry'; retry.textContent = '继续未完成翻译';
                retry.addEventListener('click', () => { void resume({ retryFailed: true }); });
                const hide = document.createElement('button');
                hide.type = 'button'; hide.className = 'sci-translation-hide';
                hide.addEventListener('click', () => hideTranslations(!translationsHidden));
                notice.append(text, progress, initialize, pauseButton, retry, hide, close);
                document.body.appendChild(notice);
            }
            const messages = {
                checking: '正在检查翻译引擎配置与可用性…',
                'awaiting-user': '等待网页操作，浏览器允许后自动加载本地翻译资源。',
                initializing: '正在初始化浏览器本地翻译模型…',
                downloading: '浏览器正在准备本地翻译资源：' + Math.round((Number(state.progress) || 0) * 100) + '%（需要时下载）',
                unavailable: state.error || '当前浏览器的本地英译中接口不可用，未启用云端翻译。',
                error: state.error || '本段翻译失败，已保留有效译文。',
                partial: state.error || '全文部分完成，已保留合格译文；请处理阻塞或保存失败后继续。',
                paused: state.configurationStale ? '翻译设置已更新，旧引擎已停止。已保留译文；点击继续后按已保存配置翻译未完成部分。'
                    : '翻译已暂停，已完成和部分译文均保留。'
            };
            notice.querySelector('.sci-translation-notice-text').textContent = messages[state.phase] || '';
            const diagnostic = provider?.getState?.().diagnostic;
            notice.querySelector('.sci-translation-notice-text').title = diagnostic ? [diagnostic.stage, diagnostic.name, diagnostic.message].filter(Boolean).join(' · ') : '';
            const progress = notice.querySelector('progress');
            progress.hidden = state.phase !== 'downloading';
            progress.value = Math.max(0, Math.min(1, Number(state.progress) || 0));
            const button = notice.querySelector('.sci-translation-initialize');
            button.hidden = state.phase !== 'awaiting-user' || provider?.getState?.().mode === 'local';
            button.textContent = '开启本地翻译';
            const pauseButton = notice.querySelector('.sci-translation-pause');
            pauseButton.hidden = !state.active;
            pauseButton.textContent = state.paused ? '继续翻译' : '暂停翻译';
            notice.querySelector('.sci-translation-retry').hidden = !state.active || !['error', 'partial'].includes(state.phase) || state.retrying > 0;
            const hide = notice.querySelector('.sci-translation-hide');
            hide.hidden = !records.size;
            hide.textContent = translationsHidden ? '显示译文' : '隐藏译文';
        }
        function providerState(value = {}) {
            if (!state.active && ['stopping', 'pending-receipt'].includes(state.phase)) {
                update({ stopPending: value.stopPending || 0, stopUnknown: value.stopUnknown || 0,
                    phase: value.stopPending > 0 ? 'stopping' : value.stopUnknown > 0 ? 'pending-receipt' : 'stopped' });
            }
            if (value.engineSignature && !state.configurationStale) lastEngineSignature = value.engineSignature;
            for (const task of selectionTasks) {
                if (!task.controller.signal.aborted) {
                    try { task.onState?.({ ...value }); } catch { /* Display listeners cannot break the provider. */ }
                }
            }
            if (!state.active || state.paused) return;
            const patch = {};
            if (value.availability) patch.availability = value.availability;
            if (Object.hasOwn(value, 'error')) patch.errorCode = value.error || '';
            if (Object.hasOwn(value, 'diagnostic')) patch.nativeDiagnostic = value.diagnostic ? { ...value.diagnostic } : null;
            if (Number.isFinite(value.progress)) patch.progress = Math.max(0, Math.min(1, value.progress));
            if (['checking', 'initializing', 'downloading'].includes(value.phase) &&
                state.phase !== 'awaiting-user') patch.phase = value.phase;
            if (value.phase === 'ready' && state.phase !== 'awaiting-user') patch.phase = 'translating';
            update(patch);
        }
        const localProvider = suppliedProvider || view.BrevessLocalTranslator?.createProvider({
            Translator: view.Translator, onState: providerState
        });
        const provider = !suppliedProvider && translationBridge && view.BrevessLocalTranslator?.createTaskProvider
            ? view.BrevessLocalTranslator.createTaskProvider({ taskId: 'full_text_translation', localProvider,
                bridge: translationBridge, captureIdentity: captureBinding, isCurrent: matchesIdentity, onState: providerState })
            : localProvider;
        function probeSelectionAvailability() {
            // Capability inspection does not create a session or download a model.
            try { localProvider?.availability?.()?.catch?.(() => {}); } catch (_) { /* Explicit use reports errors. */ }
        }
        probeSelectionAvailability();
        function releaseSelectionPreparation() {
            const preparation = selectionPreparation;
            selectionPreparation = null;
            preparation?.abort();
        }
        function prepareSelection(event) {
            const modelState = localProvider?.getState?.();
            if (destroyed || selectionPreparation || modelState?.phase === 'ready' || event?.isTrusted !== true ||
                !['mousedown', 'pointerdown'].includes(event.type) || event.button !== 0 ||
                event.isPrimary === false ||
                event.ctrlKey || event.altKey || event.metaKey || event.shiftKey ||
                view.navigator?.userActivation?.isActive !== true ||
                (modelState?.availability !== 'available' && !(provider?.getState?.().mode === 'local' &&
                    ['downloadable', 'downloading'].includes(modelState?.availability)))) return;
            const target = event.target?.nodeType === 3 ? event.target.parentElement : event.target;
            if (!target?.closest || target.closest('a,button,input,textarea,select,[role="button"]') ||
                editable(target) || isUi(target)) return;
            if (!hoveredCandidate(target) && !target.closest('.pdf-native-text-layer')) return;
            const preparation = new view.AbortController(); selectionPreparation = preparation;
            // Retire this attempt, not a newer gesture's waiter. Cancellation or
            // failure must not exhaust cached-model preparation for the document.
            const settled = () => { if (selectionPreparation === preparation) selectionPreparation = null; };
            // This synchronous call uses cached availability and retains the real
            // pointerdown activation even if dragging takes longer than its lease.
            try { Promise.resolve(localProvider.initialize({ signal: preparation.signal })).then(settled, settled); }
            catch (_) { releaseSelectionPreparation(); }
        }
        async function translateSelection(text, { signal, onState, onProgress } = {}) {
            const cancelled = () => Object.assign(new Error('Local selection translation cancelled.'), { code: 'ABORTED' });
            if (destroyed || signal?.aborted) throw cancelled();
            if (typeof text !== 'string' || !text.trim()) {
                throw Object.assign(new Error('Select text to translate.'), { code: 'EMPTY_SELECTION' });
            }
            checkNavigation();
            if (!localProvider) throw Object.assign(new Error('Official Translator unavailable.'), { code: 'API_UNAVAILABLE' });
            const identity = documentIdentity(document.location.href);
            const task = { controller: new AbortController(), onState };
            const cancel = () => task.controller.abort();
            signal?.addEventListener('abort', cancel, { once: true });
            selectionTasks.add(task);
            const valid = () => !destroyed && !task.controller.signal.aborted &&
                identity === documentIdentity(document.location.href);
            let rejectAbort;
            const aborted = new Promise((resolve, reject) => { rejectAbort = () => reject(cancelled()); });
            task.controller.signal.addEventListener('abort', rejectAbort, { once: true });
            const run = async () => {
                // Text-only path: no scan, paragraph expansion, DOM paint, or cloud fallback.
                const initialization = localProvider.initialize({ signal: task.controller.signal });
                // Register this consumer before retiring the pointerdown waiter.
                releaseSelectionPreparation();
                await initialization;
                if (!valid()) throw cancelled();
                const result = await localProvider.translate(text, { signal: task.controller.signal, priority: 0, foreground: true,
                    onProgress(value) {
                        if (!valid()) return;
                        try { onProgress?.({ ...value }); } catch { /* Optional selection display observer. */ }
                    }
                });
                if (!valid()) throw cancelled();
                if (typeof result !== 'string' || !result.trim()) {
                    throw Object.assign(new Error('Empty local translation.'), { code: 'EMPTY_TRANSLATION' });
                }
                return result;
            };
            try { return await Promise.race([run(), aborted]); }
            finally {
                signal?.removeEventListener('abort', cancel);
                task.controller.signal.removeEventListener('abort', rejectAbort);
                selectionTasks.delete(task);
            }
        }
        const controller = typeof createController === 'function' && provider
            ? createController({
                provider, autoRecovery: true,
                onState(value = {}) {
                    if (!state.active || destroyed || state.configurationStale) return;
                    const patch = {};
                    for (const key of ['completed', 'total']) if (Number.isFinite(value[key])) patch[key] = value[key] + reusedCount;
                    for (const key of ['failed', 'pending', 'unknown', 'retrying', 'blocked', 'saving', 'saveFailed', 'attempts', 'retries']) if (Number.isFinite(value[key])) patch[key] = value[key];
                    if (['running', 'translating', 'ready', 'complete', 'completed', 'idle'].includes(value.phase) &&
                        !['awaiting-user', 'checking', 'initializing', 'downloading', 'error'].includes(state.phase)) patch.phase = 'translating';
                    if (scope) { Object.assign(patch, scopeProgress()); patch.progress = Math.min(.99, patch.total ? patch.completed / patch.total : 0); }
                    if (!pageTask && scope && patch.completed === patch.total && patch.pending === 0 && patch.failed === 0 && !resuming && !state.paused) {
                        patch.phase = 'complete'; patch.progress = 1;
                    }
                    update(patch);
                    maybeFinishPageTask(value);
                },
                onEntryState(entry, value = {}) {
                    const record = records.get(entry?.id);
                    if (!record || !current(record.epoch) || record.text !== entry.text ||
                        !record.element.isConnected || !record.anchor.isConnected) return;
                    if (record.entryVersion && entry.version < record.entryVersion) return;
                    record.entryVersion = entry.version;
                    record.entryStatus = value.status;
                    record.retryBlocked = entry.retryBlocked === true;
                    if (['pending', 'translating', 'retrying', 'saving'].includes(value.status)) paintPending(record);
                    else clearPending(record);
                },
                async onResult(entry, translatedText) {
                    const record = records.get(entry.id);
                    if (!record || !current(record.epoch) || record.text !== entry.text ||
                        !record.element.isConnected || !record.anchor.isConnected ||
                        !sourceMatches(record)) {
                        if (record && current(record.epoch) && record.text === entry.text) finishParagraphTask(record.element, 'cancelled');
                        throw Object.assign(Error('Translation source changed before saving.'), { code: 'TRANSLATION_CONTEXT_STALE' });
                    }
                    if (typeof translatedText !== 'string' || !translatedText.trim()) return;
                    const saved = remember(record, translatedText, entry.text.length);
                    paintTranslation(record, record.checkpoint?.translatedText || translatedText, { partial: record.checkpoint?.partial === true });
                    await saved;
                    if (!current(record.epoch) || !record.element.isConnected || !record.anchor.isConnected || !sourceMatches(record)) {
                        throw Object.assign(Error('Translation source changed after saving.'), { code: 'TRANSLATION_CONTEXT_STALE' });
                    }
                    finishParagraphTask(record.element, 'success');
                },
                onProgress(entry, value) {
                    const record = records.get(entry?.id);
                    if (!record || !current(record.epoch) || record.text !== entry.text || entry.version !== record.entryVersion ||
                        !record.element.isConnected || !record.anchor.isConnected || !sourceMatches(record) ||
                        typeof value?.translatedText !== 'string' || !value.translatedText.trim() ||
                        value.sourceStart !== 0 || !(value.sourceEnd > 0 && value.sourceEnd <= entry.text.length)) return;
                    remember(record, value.translatedText, value.sourceEnd);
                    paintTranslation(record, record.checkpoint?.translatedText || value.translatedText, { partial: value.sourceEnd < entry.text.length });
                },
                onError(entry, error) {
                    const record = records.get(entry?.id);
                    if (!record || !current(record.epoch) || record.text !== entry.text ||
                        !record.element.isConnected || !record.anchor.isConnected ||
                        !sourceMatches(record)) {
                        if (record && current(record.epoch) && record.text === entry.text) finishParagraphTask(record.element, 'cancelled');
                        return;
                    }
                    paintFailure(record, error);
                    record.errorCode = error?.code || '';
                    if (!entry.recovering) finishParagraphTask(record.element, 'failed');
                    noticeDismissed = false;
                    update({ phase: 'error', error: entry.recovering ? error?.code === 'TRANSLATION_OUTCOME_UNKNOWN'
                        ? '正在查询已发请求的回执，已阻止重复推理。' : '正在自动继续未完成译文，合格译文和原文已保留。'
                        : entry.status === 'save-failed' ? '译文已通过校验，但保存未成功；继续只重试保存。' : errorText(error),
                        errorCode: error?.code || '', errorDetails: error?.translationDetails ? { ...error.translationDetails,
                            failures: (error.translationDetails.failures || []).map(value => ({ ...value })) } : null });
                }
            }) : null;
        let controllerDocumentKey = null;
        const bindControllerDocument = () => {
            const key = JSON.stringify(checkpointApi?.stableBinding(captureBinding()) || { url });
            if (controllerDocumentKey !== null && key !== controllerDocumentKey) {
                for (const record of [...records.values()]) forget(record);
                cachedResults = new WeakMap(); checkpoints = new Map(); acknowledgedResults = new Map(); knownSources.clear(); checkpointRevision = 0; checkpointRevisionKey = null; scope = null;
            }
            controllerDocumentKey = key; controller?.setDocument?.(key);
        };
        bindControllerDocument();
        async function confirmStopped() {
            await provider?.confirmStopped?.();
            return getState();
        }
        function paintTranslation(record, translatedText, { partial = false } = {}) {
            const confirmed = confirmedEntry(record);
            if (confirmed?.manuallyEdited && translatedText !== confirmed.translatedText) return;
            if (!partial) clearPending(record);
            clearFailure(record);
            if (!record.translation?.isConnected) {
                record.translation = document.createElement('div');
                record.translation.className = 'sci-bilingual-translation';
                record.translation.setAttribute('data-sci-plugin-ui', '');
                record.translation.setAttribute('data-sci-translation', '');
                record.translation.setAttribute('lang', 'zh');
                record.translation.setAttribute('dir', 'auto');
                record.translation.setAttribute('translate', 'no');
                record.translation.addEventListener('input', () => {
                    if (destroyed || record.epoch !== epoch || !checkNavigation() || !sourceMatches(record)) return;
                    const entry = confirmedEntry(record);
                    if (entry?.manuallyEdited) persistRecord(record, entry);
                });
                displaySources.set(record.translation, record.element);
            }
            record.partial = partial;
            if (partial) record.translation.setAttribute('data-sci-translation-partial', '');
            else record.translation.removeAttribute('data-sci-translation-partial');
            record.translation.textContent = translatedText;
            record.lastPaintedText = translatedText;
            record.translation.hidden = translationsHidden;
            record.anchor.after(record.translation);
        }
        function clearFailure(record) {
            if (!record.failure) return;
            record.failure.remove(); record.failure = null;
            if (state.active && state.phase === 'error' && ![...records.values()].some(item => item.failure)) {
                update({ phase: 'translating', error: '', errorCode: '', errorDetails: null });
            }
        }
        function paintFailure(record, error) {
            const partial = error?.partialTranslation;
            if (typeof partial?.translatedText === 'string' && partial.translatedText.trim() && partial.sourceStart === 0 &&
                partial.sourceEnd > 0 && partial.sourceEnd <= record.text.length) {
                remember(record, partial.translatedText, partial.sourceEnd);
                paintTranslation(record, record.checkpoint?.translatedText || partial.translatedText, { partial: true });
            }
            clearPending(record);
            if (!record.checkpoint) { record.translation?.remove(); record.translation = null; }
            if (!record.failure?.isConnected) {
                record.failure = document.createElement('div');
                record.failure.className = 'sci-bilingual-error';
                record.failure.setAttribute('data-brevess-interface', '');
                record.failure.setAttribute('data-sci-plugin-ui', '');
                record.failure.setAttribute('data-sci-translation', '');
                record.failure.setAttribute('lang', 'zh');
                record.failure.setAttribute('dir', 'auto');
                record.failure.setAttribute('translate', 'no');
                record.failure.setAttribute('role', 'note');
                displaySources.set(record.failure, record.element);
            }
            record.failure.textContent = record.partial ? '本段部分译文未完成，已保留合格译文和原文。'
                : error?.code === 'TRANSLATION_TIMEOUT' ? '本段翻译等待超时，已保留原文。'
                : error?.code === 'INVALID_TRANSLATION' ? '本段译文异常，已保留原文。'
                : error?.code === 'EMPTY_TRANSLATION' ? '本段未返回译文，已保留原文。'
                : error?.code === 'TRANSLATION_OUTCOME_UNKNOWN' ? '本段请求完成状态未知，已暂停再次调用；请先核对后台状态。' : '本段翻译失败，已保留原文。';
            (record.translation?.isConnected ? record.translation : record.anchor).after(record.failure);
        }
        const isPubmed = document.location.hostname === 'pubmed.ncbi.nlm.nih.gov';
        function isSourceCandidate(element) {
            if (element.matches(SEMANTIC_CANDIDATE)) return true;
            if (element.tagName !== 'DIV') return false;
            if (element.getAttribute('data-sci-llm-paragraph-id')?.trim()) return true;
            return /(^|\.)sciencedirect\.com$/i.test(document.location.hostname) &&
                /^(?:p|fspara)\d+$/.test(element.id) && Boolean(element.closest(READING));
        }
        function closestSourceCandidate(target, extra = '') {
            const selector = CANDIDATE + (extra ? ',' + extra : '');
            let source = target?.closest(selector);
            // Prefix selectors are only discovery hints. An unrelated inner ID
            // must not hide a real source from hover, mutation or viewport scans.
            while (source && !isSourceCandidate(source) && !(extra && source.matches(extra))) {
                source = source.parentElement?.closest(selector);
            }
            return source || null;
        }
        function sourceAnchor(element, explicitlySelected = selectedSources.has(element)) {
            if (!element?.isConnected || element.closest(OMIT_SOURCE)) return null;
            if (isPubmed && element.closest('article.full-docsum .docsum-snippet')) {
                const container = element.closest('.docsum-snippet');
                const expanded = container.querySelector('[data-wfg-complete="true"] [data-wfg-abstract-body]:not([hidden])');
                if (expanded && readSourceText(expanded)) return element === expanded ? expanded : null;
                const full = container.querySelector('.full-view-snippet');
                const source = full && readSourceText(full) ? full : container.querySelector('.short-view-snippet');
                return source === element ? container : null;
            }
            if (!isSourceCandidate(element) || (!wholePageScope && !explicitlySelected && !element.closest(READING) &&
                !element.matches('h1,.article-title,.c-article-title,.title-text'))) return null;
            if (element.closest('header') && !element.closest(READING)) return null;
            if (element.closest('[hidden],[aria-hidden="true"]')) return null;
            // A caption wrapper containing paragraph candidates must not duplicate them.
            for (const candidate of element.querySelectorAll(CANDIDATE)) {
                if (isSourceCandidate(candidate) && !candidate.closest(FOREIGN_TRANSLATION)) return null;
            }
            return element;
        }
        function priority(anchor) {
            const rect = anchor.getBoundingClientRect();
            if (!anchor.getClientRects().length) return 2;
            if (rect.bottom >= 0 && rect.top <= view.innerHeight) return 0;
            if (rect.bottom >= -view.innerHeight && rect.top <= view.innerHeight * 2) return 1;
            return 2;
        }
        function queuePublish() {
            if (publishTimer !== null || !state.active) return;
            publishTimer = view.setTimeout(() => {
                publishTimer = null;
                if (!current(epoch)) return;
                publishEntries();
            }, 30);
        }
        function publishEntries() {
            // Admission is sliced; freeze only after the initial reading scan finishes.
            if (!scope && (scans.size || scanTimer !== null)) return;
            if (!scope || (!pageTask && [...records.keys()].some(id => !scope.has(id)))) {
                if (!pageTask && state.enabled) pageTask = beginTask('全文翻译');
                scope = new Map([...records.values()].map(record => [record.id, record.text]));
                update({ rangeFrozen: true, logicalOperationId: pageTask?.taskId || '', total: scope.size });
            }
            controller?.setEntries([...records.values()].filter(record => !record.reused && (scope.has(record.id) || record.foreground)).map(record => ({
                id: record.id, sourceKey: record.sourceKey, text: record.text, scientificContext: record.scientificContext, priority: record.priority, foreground: record.foreground,
                automaticRecovery: state.enabled === true,
                confirmedTranslation: record.checkpoint && (!record.checkpoint.partial || record.checkpoint.manuallyEdited) && record.persisted === false ? record.checkpoint.translatedText : undefined,
                resumeFrom: record.checkpoint && !record.checkpoint.manuallyEdited ? { ...record.checkpoint } : undefined
            })));
            update(scopeProgress());
            maybeFinishPageTask();
        }
        function forget(record) {
            finishParagraphTask(record.element, 'cancelled');
            clearPending(record);
            if (record.reused) reusedCount--;
            clearFailure(record);
            record.translation?.remove();
            intersectionObserver?.unobserve(record.anchor);
            records.delete(record.id); elements.delete(record.element); anchors.delete(record.anchor);
        }
        function admit(element) {
            if (hiddenSources.has(element) || (!state.enabled && !selectedSources.has(element))) return;
            const anchor = sourceAnchor(element);
            let existing = elements.get(element);
            if (!anchor) { if (existing) { forget(existing); queuePublish(); } return; }
            // PubMed's loaded full excerpt is hidden, but its container remains visible.
            if (!anchor.getClientRects().length) {
                if (existing) { forget(existing); queuePublish(); }
                return;
            }
            const {text, scientificContext} = readSourceProjection(element);
            if (text.length < 3 || !/[A-Za-z]{2}/u.test(text)) {
                if (existing) { forget(existing); queuePublish(); } return;
            }
            if (existing && existing.text === text && sameScientificContext(existing.scientificContext, scientificContext) && existing.anchor === anchor) return;
            if (existing) forget(existing);
            const record = { id: 'bilingual-' + (++serial), element, anchor, text, scientificContext, sourceKey: checkpointApi?.sourceKey(element),
                priority: priority(anchor), foreground: selectedSources.has(element), epoch, translation: null };
            if (record.sourceKey) knownSources.set(record.sourceKey, { element, text, scientificContext });
            const nodeCache = cachedResults.get(element);
            const cached = nodeCache?.url === url && nodeCache.text === text && sameScientificContext(nodeCache.scientificContext, scientificContext) && (nodeCache.manuallyEdited || nodeCache.engineSignature === engineSignature())
                ? nodeCache : checkpoints.get(checkpointIdentity(record.sourceKey, text, undefined, scientificContext));
            if ((cached?.manuallyEdited || cached?.engineSignature === engineSignature()) && cached?.sourceText === text && sameScientificContext(cached.scientificContext, scientificContext)) {
                record.checkpoint = { ...cached };
                record.persisted = cached.persisted !== false;
                if ((!cached.partial || cached.manuallyEdited) && record.persisted) { record.reused = true; reusedCount++; }
                paintTranslation(record, cached.translatedText, { partial: cached.partial });
                if (!cached.partial) finishParagraphTask(record.element, 'success');
            }
            records.set(record.id, record); elements.set(element, record); anchors.set(anchor, record);
            if (!record.reused) paintPending(record);
            intersectionObserver?.observe(anchor);
            queuePublish();
        }
        function clearPending(record) {
            record.pending?.remove(); record.pending = null;
        }
        function paintPending(record) {
            if (state.paused || record.pending?.isConnected || record.reused || !current(record.epoch) ||
                ['awaiting-user', 'unavailable'].includes(state.phase)) return;
            const spinner = document.createElement('span');
            spinner.className = 'sci-bilingual-pending';
            spinner.setAttribute('data-brevess-interface', '');
            spinner.setAttribute('data-sci-plugin-ui', '');
            spinner.setAttribute('data-sci-translation', '');
            spinner.setAttribute('role', 'status');
            spinner.setAttribute('aria-label', '正在本地翻译此段');
            spinner.setAttribute('title', '正在本地翻译此段');
            record.pending = spinner;
            record.anchor.appendChild(spinner);
        }
        function clearAllPending() { for (const record of records.values()) clearPending(record); }
        function pumpScan() {
            scanTimer = null;
            if (!state.active || !checkNavigation()) return;
            const started = now();
            let steps = 0;
            while (scans.size && steps < 160 && now() - started < 6) {
                const [scope, work] = scans.entries().next().value;
                if (!scope.isConnected) { scans.delete(scope); continue; }
                const element = work.first ? (work.first = false, scope) : work.walker.nextNode();
                if (!element) { scans.delete(scope); continue; }
                if (element.nodeType === 1 && !element.closest(OMIT_SOURCE)) admit(element);
                steps++;
            }
            if (scans.size) scanTimer = schedule(pumpScan);
            else { queuePublish(); maybeFinishPageTask(); }
        }
        function queueScan(scope) {
            if (!state.active || !scope || scope.nodeType !== 1 || isUi(scope)) return;
            if (!state.enabled) {
                for (const source of selectedSources) {
                    if (scope === source || scope.contains(source) || source.contains(scope)) admit(source);
                }
                return;
            }
            if (!scans.has(scope)) {
                scans.set(scope, { first: true, walker: document.createTreeWalker(scope, 1, {
                    acceptNode: element => element.matches(OMIT_SOURCE) ? 2 : 1
                }) });
            }
            if (scanTimer === null) scanTimer = schedule(pumpScan);
        }
        function pruneDetached() {
            pruneTimer = null;
            for (const record of records.values()) {
                if (!record.element.isConnected || !record.anchor.isConnected) {
                    selectedSources.delete(record.element); forget(record);
                }
            }
            if (!state.enabled && selectedSources.size === 0) { stop(); return; }
            queuePublish();
        }
        function sourceMutations(mutations) {
            if (!state.active || !checkNavigation()) return;
            for (const change of mutations) {
                if (isUi(change.target)) continue;
                const added = [...(change.addedNodes || [])], removed = [...(change.removedNodes || [])];
                if (change.type === 'childList' && [...added, ...removed].length &&
                    [...added, ...removed].every(isUi)) continue;
                const parent = change.target.nodeType === 1 ? change.target : change.target.parentElement;
                // Only changed source candidates and newly added subtrees, not their whole article.
                const candidate = closestSourceCandidate(parent, '.full-view-snippet,.short-view-snippet');
                if (candidate) queueScan(candidate);
                if (change.type === 'attributes') queueScan(parent);
                for (const node of added) if (node.nodeType === 1 && !isUi(node)) queueScan(node);
                if (removed.length && pruneTimer === null) pruneTimer = schedule(pruneDetached);
            }
        }
        function observe() {
            if (mutationObserver) return;
            mutationObserver = new view.MutationObserver(sourceMutations);
            mutationObserver.observe(document.body, { subtree: true, childList: true, characterData: true,
                attributes: true, attributeFilter: ['hidden', 'aria-hidden', 'class', 'style', 'id', 'data-sci-llm-paragraph-id',
                    'mathvariant', 'linethickness', 'notation', 'accent', 'accentunder', 'stretchy', 'fence',
                    'separator', 'columnspan', 'rowspan', 'open', 'close', 'separators'] });
            if (view.IntersectionObserver) {
                intersectionObserver = new view.IntersectionObserver(entries => {
                    if (!state.active) return;
                    let changed = false;
                    for (const item of entries) {
                        const record = anchors.get(item.target);
                        if (record) {
                            const next = priority(record.anchor);
                            if (next !== record.priority) { record.priority = next; changed = true; }
                        }
                    }
                    if (changed) queuePublish();
                }, { rootMargin: '0px' });
            }
            if (!state.enabled) {
                for (const source of selectedSources) queueScan(source);
                return;
            }
            // Seed the reading viewport before walking a long article from its top.
            // A bounded hit-test avoids a synchronous whole-document layout scan.
            const step = Math.max(48, Math.ceil(view.innerHeight / 12));
            for (let y = 12; y < view.innerHeight; y += step) {
                for (const x of [view.innerWidth * .25, view.innerWidth * .5, view.innerWidth * .75]) {
                    for (const element of document.elementsFromPoint(x, y)) {
                        if (isUi(element)) continue;
                        const candidate = closestSourceCandidate(element, '.docsum-snippet');
                        if (candidate) queueScan(candidate);
                    }
                }
            }
            queueScan(document.body);
        }
        async function startController(token) {
            if (!current(token)) return;
            observe();
            queuePublish();
            update({ phase: 'translating', error: '' });
            try { await controller.start(); }
            catch (error) {
                if (!current(token)) return;
                clearAllPending();
                if (error?.name === 'NotAllowedError' || /gesture|activation/i.test(error?.code || error?.message || '')) {
                    update({ phase: 'awaiting-user', error: '' });
                } else {
                    update({ phase: 'error', error: errorText(error), errorCode: error?.code || '' });
                    finishPendingTasks('failed');
                }
            }
        }
        async function initializeFromPage() {
            if (!state.active || initializing || !provider) return;
            const token = epoch;
            initializing = new view.AbortController();
            update({ phase: 'initializing', error: '' });
            try {
                const operation = provider.initialize({ signal: initializing.signal });
                await operation;
                if (current(token)) {
                    update({ availability: 'available', phase: 'translating' });
                    await startController(token);
                }
            } catch (error) {
                if (current(token)) { clearAllPending(); update({ phase: 'error', error: errorText(error), errorCode: error?.code || '' }); finishPendingTasks('failed'); }
            } finally { if (epoch === token) { initializing = null; maybeFinishPageTask(); } }
        }
        function dismissNotice() { noticeDismissed = true; removeNotice(); return getState(); }
        function hideTranslations(hidden = true) {
            translationsHidden = hidden === true;
            for (const record of records.values()) if (record.translation) record.translation.hidden = translationsHidden;
            update({ translationsHidden }); return getState();
        }
        function pause() {
            if (!state.active || state.paused) return getState();
            noticeDismissed = false;
            update({ paused: true, phase: 'paused' });
            controller?.pause(); clearAllPending();
            for (const record of records.values()) {
                const entry = confirmedEntry(record);
                if (entry?.manuallyEdited && record.persisted !== true && (!record.persistencePending || record.persistenceEpoch !== epoch)) persistRecord(record, entry);
            }
            return getState();
        }
        async function resume({ retryFailed = false } = {}) {
            if (!state.active) return setEnabled(true);
            if (!checkNavigation()) return getState();
            if (state.configurationStale) return resumeWithSavedSettings();
            noticeDismissed = false;
            const resumption = {}; resuming = resumption;
            if (state.enabled && !pageTask) pageTask = beginTask('全文翻译');
            update({ paused: false, phase: 'translating', error: '', errorCode: '', errorDetails: null });
            // Freeze manually edited paragraphs before retrying any unfinished work.
            for (const record of records.values()) if (confirmedEntry(record)?.manuallyEdited) {
                if (record.persisted !== false && !record.reused) { record.reused = true; reusedCount++; }
            }
            publishEntries();
            for (const record of records.values()) if (retryFailed) clearFailure(record);
            try { await controller?.resume({ retryFailed }); }
            catch (error) { if (state.active) update({ phase: 'error', error: errorText(error), errorCode: error?.code || '' }); }
            finally { if (resuming === resumption) resuming = false; maybeFinishPageTask(); }
            return getState();
        }
        async function primeSavedSettings(revision = settingsEpoch) {
            settingsPreparation?.abort();
            const preparation = new view.AbortController(); settingsPreparation = preparation;
            const navigation = documentIdentity(document.location.href);
            try {
                const availability = await provider?.availability({ signal: preparation.signal });
                if (destroyed || preparation.signal.aborted || revision !== settingsEpoch || navigation !== documentIdentity(document.location.href)) return;
                update({ availability: availability || 'unavailable', configurationRouteReady: true });
                return availability;
            } catch (error) {
                if (!destroyed && !preparation.signal.aborted && revision === settingsEpoch && navigation === documentIdentity(document.location.href)) {
                    update({ configurationRouteReady: false, errorCode: error?.code || 'TRANSLATION_ROUTE_INVALID', error: errorText(error) });
                }
            } finally { if (settingsPreparation === preparation) settingsPreparation = null; }
        }
        function onSettingsChanged(changes, areaName) {
            if (!destroyed && areaName === 'local' && changes?.sciPageToolsV1) {
                view.__brevessPageToolsPreferences = changes.sciPageToolsV1.newValue || {};
                if (!standaloneTranslationAllowed()) stop({ preserveTranslations: true });
            }
            const change = changes?.sciLlmSettingsV2;
            if (destroyed || areaName !== 'local' || !change) return;
            try { if (translationSettingsIdentity(change.oldValue) === translationSettingsIdentity(change.newValue)) return; } catch { /* Invalidate unreadable changes conservatively. */ }
            lastEngineSignature = engineSignature();
            noticeDismissed = false;
            for (const record of records.values()) confirmedEntry(record);
            finishPendingTasks('cancelled');
            releaseSelectionPreparation();
            for (const task of selectionTasks) task.controller.abort();
            initializing?.abort(); initializing = null;
            settingsResumption = null;
            epoch++; settingsEpoch++;
            for (const record of records.values()) record.epoch = epoch;
            update({ paused: state.active, configurationStale: true, configurationRouteReady: false,
                ...(state.active ? { phase: 'paused' } : {}), errorCode: 'TRANSLATION_ROUTE_STALE',
                error: '翻译设置已更新，旧引擎已停止；已确认译文保留，点击继续后应用已保存配置。' });
            // Stop also resets the controller's readiness; it cannot pump a
            // destroyed native session before explicit user continuation.
            if (controller) controller.stop(); else provider?.destroy?.();
            clearAllPending();
            void primeSavedSettings(); // Route/capability only: no model initialization or text dispatch.
        }
        function resumeWithSavedSettings() {
            if (settingsResumption) return settingsResumption;
            const revision = settingsEpoch, token = epoch;
            const valid = () => current(token) && revision === settingsEpoch;
            const run = async () => {
                noticeDismissed = false;
                try {
                    const availability = state.configurationRouteReady ? state.availability : await primeSavedSettings(revision);
                    if (!valid()) return getState();
                    if (!availability || availability === 'unavailable') throw Object.assign(new Error('Translation engine unavailable.'), { code: state.errorCode || 'LANGUAGE_UNAVAILABLE' });
                    // When route prewarming completed, this native call happens
                    // before the first await and retains the real click activation.
                    const initialization = provider.initialize();
                    await initialization;
                    if (!valid()) return getState();
                    lastEngineSignature = engineSignature(); checkpointRevision = 0; checkpointRevisionKey = null;
                    update({ configurationStale: false, paused: false, phase: 'translating', error: '', errorCode: '', errorDetails: null });
                    try { await restoreCheckpoints(token); }
                    catch (error) { if (valid()) update({ checkpointPersistence: 'failed', checkpointError: error?.code || 'TRANSLATION_CHECKPOINT_READ_FAILED' }); }
                    if (!valid()) return getState();
                    reusedCount = 0;
                    for (const record of records.values()) {
                        const confirmed = confirmedEntry(record);
                        record.reused = Boolean(confirmed && (!confirmed.partial || confirmed.manuallyEdited) && record.persisted !== false);
                        if (!record.reused && !confirmed?.manuallyEdited) {
                            const saved = checkpoints.get(checkpointIdentity(record.sourceKey, record.text, undefined, record.scientificContext));
                            if (saved) { record.checkpoint = { ...saved }; record.persisted = true; record.reused = !saved.partial || saved.manuallyEdited; }
                        }
                        if (record.reused) reusedCount++;
                    }
                    // Fresh entries remove old engine partials held inside the
                    // controller. Providers independently enforce prefix signatures.
                    controller?.setEntries([]); publishEntries();
                    if (state.enabled) pageTask = beginTask('全文翻译');
                    await startController(token);
                } catch (error) {
                    if (valid()) update({ paused: true, configurationStale: true, phase: 'paused', errorCode: error?.code || '', error: errorText(error) });
                }
                return getState();
            };
            const operation = run(); settingsResumption = operation;
            void operation.finally(() => { if (settingsResumption === operation) settingsResumption = null; });
            return operation;
        }
        function captureExportSnapshot(expectedIdentity) {
            const binding = captureBinding();
            if (!matchesIdentity(expectedIdentity, binding) || documentIdentity(document.location.href) !== url ||
                JSON.stringify(checkpointApi?.stableBinding(binding) || { url }) !== controllerDocumentKey) {
                throw Object.assign(new Error('Translation export source changed.'), { code: 'TRANSLATION_EXPORT_IDENTITY_STALE' });
            }
            const translations = [], draftTranslations = [], capturedKeys = new Set();
            const captureEntry = (sourceKey, text, context, candidate, persistence) => {
                const saved = checkpointApi?.normalizeEntry(acknowledgedResults.get(exportIdentity(sourceKey, text, context)));
                const draft = checkpointApi?.normalizeEntry(candidate);
                if (saved) {
                    const { confirmed: internalConfirmed, ...exported } = saved;
                    translations.push(exported);
                }
                if (draft && (persistence?.persisted === false || JSON.stringify(draft) !== JSON.stringify(saved))) {
                    const { confirmed: internalConfirmed, ...exported } = draft;
                    draftTranslations.push({ ...exported, persistenceStatus: persistence?.persistencePending ? 'pending' : persistence?.persistenceError ? 'failed' : 'unsaved' });
                }
                capturedKeys.add(sourceKey);
            };
            for (const record of records.values()) {
                if (!record.element.isConnected || !record.anchor.isConnected || !sourceMatches(record)) continue;
                captureEntry(record.sourceKey, record.text, record.scientificContext, confirmedEntry(record), record);
            }
            for (const [sourceKey, source] of knownSources) {
                if (capturedKeys.has(sourceKey) || !source.element.isConnected ||
                    checkpointApi?.sourceKey(source.element) !== sourceKey || !sourceMatches(source)) continue;
                const cached = cachedResults.get(source.element);
                const candidate = cached?.url === url && cached.text === source.text && sameScientificContext(cached.scientificContext, source.scientificContext) ? cached : checkpoints.get(checkpointIdentity(sourceKey, source.text, undefined, source.scientificContext));
                captureEntry(sourceKey, source.text, source.scientificContext, candidate, candidate);
            }
            if (!matchesIdentity(binding)) throw Object.assign(new Error('Translation export source changed.'), { code: 'TRANSLATION_EXPORT_IDENTITY_STALE' });
            return { version: 1, documentBinding: { ...binding }, translations, draftTranslations,
                status: state.pending || state.failed || state.unknown || state.unfinished || state.stopUnknown || draftTranslations.length || translations.some(value => value.partial) ? 'partial' : translations.length ? 'complete' : 'pending' };
        }
        function captureSavedTranslations() {
            const snapshot = captureExportSnapshot(captureBinding());
            return { version: 1, documentBinding: checkpointApi.stableBinding(snapshot.documentBinding),
                translations: snapshot.translations.map(entry => ({ ...entry, confirmed: true })) };
        }
        function stop({ preserveTranslations = false } = {}) {
            const retainedProgress = preserveTranslations && scope ? scopeProgress() : null;
            resuming = false;
            settingsPreparation?.abort(); settingsPreparation = null; settingsEpoch++;
            settingsResumption = null;
            finishPendingTasks('cancelled');
            releaseSelectionPreparation();
            for (const task of selectionTasks) task.controller.abort();
            epoch++;
            state.enabled = false; state.active = false;
            initializing?.abort(); initializing = null;
            controller?.stop();
            // Completed display results live in the source-node WeakMap. Retire old
            // task entries so re-enable cannot restart stale pending work before scanning.
            controller?.setEntries([]);
            mutationObserver?.disconnect(); mutationObserver = null;
            intersectionObserver?.disconnect(); intersectionObserver = null;
            for (const timer of [scanTimer, publishTimer, pruneTimer]) if (timer !== null) view.clearTimeout(timer);
            scanTimer = publishTimer = pruneTimer = null;
            scans.clear();
            for (const record of records.values()) {
                const confirmed = confirmedEntry(record);
                clearPending(record);
                record.failure?.remove(); record.failure = null;
                if (!preserveTranslations) { record.translation?.remove(); elements.delete(record.element); anchors.delete(record.anchor); }
            }
            if (!preserveTranslations) records.clear();
            selectedSources.clear(); hiddenSources = new WeakSet(); altSource = null;
            reusedCount = 0;
            const stopped = provider?.getState?.() || {};
            update({ enabled: false, active: false, paused: false, configurationStale: false, configurationRouteReady: false,
                mode: 'off', phase: stopped.stopPending > 0 ? 'stopping' : stopped.stopUnknown > 0 ? 'pending-receipt' : 'idle',
                stopPending: stopped.stopPending || 0, stopUnknown: stopped.stopUnknown || 0,
                completed: retainedProgress?.completed || 0, total: retainedProgress?.total || 0,
                unfinished: retainedProgress ? retainedProgress.total - retainedProgress.completed : 0,
                pending: 0, failed: retainedProgress?.failed || 0, unknown: retainedProgress?.unknown || 0,
                retrying: 0, saving: 0, blocked: retainedProgress?.blocked || 0, saveFailed: retainedProgress?.saveFailed || 0, error: '', errorCode: '', errorDetails: null });
            removeNotice();
        }
        function checkNavigation() {
            const nextUrl = documentIdentity(document.location.href);
            if (nextUrl === url) {
                if (activeDocumentBinding && !matchesIdentity(activeDocumentBinding)) {
                    // A newly activated reader owns a different lifecycle. Retire
                    // old work before a later gesture starts under that binding.
                    stop({ preserveTranslations: true }); activeDocumentBinding = null;
                    return false;
                }
                return true;
            }
            stop(); cachedResults = new WeakMap(); checkpoints = new Map(); acknowledgedResults = new Map(); knownSources.clear(); checkpointRevision = 0; checkpointRevisionKey = null; url = nextUrl; update({ url });
            standaloneLifecycle++; activeDocumentBinding = null;
            bindControllerDocument();
            probeSelectionAvailability();
            return false;
        }
        async function setEnabled(enabled, options = {}) {
            if (!enabled) { stop({ preserveTranslations: true }); return getState(); }
            if (destroyed) return getState();
            const expandScope = options.wholePage === true && !wholePageScope;
            if (!state.active || options.wholePage === true) wholePageScope = options.wholePage === true;
            checkNavigation();
            if (state.active) {
                if (state.configurationStale) return resumeWithSavedSettings();
                if (!state.enabled) {
                    pageTask = beginTask('全文翻译');
                    hiddenSources = new WeakSet();
                    update({ enabled: true, mode: 'page' });
                    if (mutationObserver) queueScan(document.body);
                    maybeFinishPageTask();
                }
                if (expandScope && mutationObserver) queueScan(document.body);
                return getState();
            }
            selectedSources.clear(); hiddenSources = new WeakSet();
            return activate('page');
        }
        function prepareLocalDemand() {
            // A saved local route is the user's choice. Create the native session
            // during this gesture, before route revalidation/checkpoint I/O awaits.
            // This never sends text and does not replace the route identity checks.
            if (provider?.getState?.().mode !== 'local') return;
            try { return Promise.resolve(provider.initialize()).then(() => ({ ready: true }), error => ({ error })); }
            catch (error) { return Promise.resolve({ error }); }
        }
        function resumeLocalDemand(event) {
            if (destroyed || !state.active || state.paused || !(state.phase === 'awaiting-user' ||
                (state.phase === 'error' && ['MODEL_NOT_READY', 'NATIVE_UNAVAILABLE', 'CAPABILITY_TIMEOUT', 'USER_ACTIVATION_REQUIRED'].includes(state.errorCode))) ||
                event?.isTrusted !== true || event.defaultPrevented ||
                view.navigator?.userActivation?.isActive !== true || provider?.getState?.().mode !== 'local') return;
            if (event.type === 'pointerdown' && (event.button !== 0 || event.isPrimary === false)) return;
            if (event.type === 'keydown' && (event.repeat || event.isComposing || event.key === 'Escape')) return;
            // Resume a previously requested translation with the browser's real
            // activation. No synthetic events or additional consent dialog.
            if (controller?.getState?.().initializationError) void resume({ retryFailed: true });
            else void initializeFromPage();
        }
        async function activate(mode) {
            noticeDismissed = false;
            scope = null; resuming = false;
            if (mode === 'page') pageTask = beginTask('全文翻译');
            if (document.contentType === 'application/pdf' || !/^https?:$/i.test(document.location.protocol)) {
                update({ enabled: false, phase: 'unavailable', error: '本批双语阅读仅支持 HTML 网页。' });
                finishPendingTasks('failed');
                return getState();
            }
            const nextUrl = documentIdentity(document.location.href);
            if (url !== nextUrl) cachedResults = new WeakMap();
            url = nextUrl;
            epoch++;
            activeDocumentBinding = captureBinding();
            const token = epoch;
            update({ enabled: mode === 'page', active: true, paused: false, configurationStale: false, mode, phase: 'checking', error: '', errorCode: '', errorDetails: null, progress: 0, rangeFrozen: false, unfinished: 0 });
            if (!provider || !controller) {
                update({ enabled: false, active: false, mode: 'off', phase: 'unavailable', errorCode: 'API_UNAVAILABLE', error: errorText('API_UNAVAILABLE') }); finishPendingTasks('failed'); return getState();
            }
            // Show feedback at the chosen paragraph before any asynchronous
            // availability/model work. It is a plugin-only node, never source text.
            if (mode === 'paragraph') for (const source of selectedSources) admit(source);
            let localPreparation = prepareLocalDemand();
            try {
                const availability = await provider.availability();
                if (!current(token)) return getState();
                if (!localPreparation && availability !== 'unavailable') localPreparation = prepareLocalDemand();
                lastEngineSignature = engineSignature();
                bindControllerDocument();
                try { await restoreCheckpoints(token); }
                catch (error) { if (current(token)) update({ checkpointPersistence: 'failed', checkpointError: error?.code || 'TRANSLATION_CHECKPOINT_READ_FAILED' }); }
                if (!current(token)) return getState();
                reusedCount = 0;
                for (const record of [...records.values()]) {
                    if (!record.element.isConnected || !sourceMatches(record)) { forget(record); continue; }
                    record.epoch = epoch;
                    const saved = confirmedEntry(record);
                    record.reused = Boolean(saved && (!saved.partial || saved.manuallyEdited) && record.persisted !== false);
                    if (record.reused) reusedCount++;
                    if (saved && saved.engineSignature !== engineSignature() && !saved.manuallyEdited && saved.partial) record.checkpoint = null;
                }
                update({ availability });
                if (localPreparation) {
                    const prepared = await localPreparation;
                    if (!current(token)) return getState();
                    if (prepared.error) {
                        // This demand already exhausted its one preparation round.
                        // Slow checkpoint I/O must not silently start another.
                        clearAllPending();
                        const needsGesture = prepared.error.code === 'USER_ACTIVATION_REQUIRED';
                        update({ phase: needsGesture ? 'awaiting-user' : 'error', error: needsGesture ? '' : errorText(prepared.error), errorCode: prepared.error.code || '' });
                        if (!needsGesture) finishPendingTasks('failed');
                        return getState();
                    }
                }
                if (availability === 'unavailable' && !(provider?.getState?.().mode === 'local' &&
                    ['MODEL_NOT_READY', 'NATIVE_UNAVAILABLE', 'CAPABILITY_TIMEOUT', 'USER_ACTIVATION_REQUIRED'].includes(provider.getState().error))) {
                    clearAllPending();
                    const errorCode = provider.getState?.().error || state.errorCode || 'LANGUAGE_UNAVAILABLE';
                    update({ enabled: false, active: false, mode: 'off', phase: 'unavailable', errorCode, error: errorText(errorCode) });
                    finishPendingTasks('failed');
                }
                // The user's translation action also authorizes initialization.
                // Only a real browser activation error needs an on-page retry.
                else void startController(token);
            } catch (error) {
                if (current(token)) { clearAllPending(); update({ phase: 'error', error: errorText(error), errorCode: error?.code || '' }); finishPendingTasks('failed'); }
            }
            return getState();
        }
        function toggleParagraph(source) {
            if (destroyed) return;
            checkNavigation();
            if (!sourceAnchor(source, true) || readSourceText(source).length < 3 || !/[A-Za-z]{2}/u.test(readSourceText(source))) return;
            const record = elements.get(source);
            if (state.active && state.enabled && !hiddenSources.has(source) && !selectedSources.has(source) &&
                (!record || ['pending', 'translating'].includes(record.entryStatus))) {
                selectedSources.add(source);
                paragraphTasks.set(source, beginTask('段落翻译'));
                if (record) record.foreground = true; else admit(source);
                publishEntries();
                return;
            }
            if (state.active && !hiddenSources.has(source) && (state.enabled || record || selectedSources.has(source))) {
                selectedSources.delete(source); hiddenSources.add(source);
                if (record) forget(record);
                // Retire a pending entry synchronously; late results cannot redisplay it.
                publishEntries();
                if (!state.enabled && selectedSources.size === 0) stop();
                return;
            }
            if (!state.active) { selectedSources.clear(); hiddenSources = new WeakSet(); }
            selectedSources.add(source); hiddenSources.delete(source);
            paragraphTasks.set(source, beginTask('段落翻译'));
            if (!state.active) void activate('paragraph');
            else if (mutationObserver) queueScan(source);
        }
        function editable(target) {
            return Boolean(target?.isContentEditable || target?.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="combobox"],#brevess-mechanism-drawing-host'));
        }
        function hoveredCandidate(target) {
            if (!target?.closest || editable(target) || target.closest(INTERACTIVE) || target.closest(FOREIGN_TRANSLATION)) return null;
            const display = target.closest('[data-sci-translation]');
            if (display) return displaySources.get(display) || null;
            if (isUi(target)) return null;
            if (isPubmed) {
                const snippet = target.closest('article.full-docsum .docsum-snippet');
                if (snippet) {
                    const expanded = snippet.querySelector('[data-wfg-complete="true"] [data-wfg-abstract-body]:not([hidden])');
                    if (expanded && readSourceText(expanded)) return sourceAnchor(expanded) ? expanded : null;
                    const full = snippet.querySelector('.full-view-snippet');
                    const source = full && readSourceText(full) ? full : snippet.querySelector('.short-view-snippet');
                    return source && sourceAnchor(source) ? source : null;
                }
            }
            const source = closestSourceCandidate(target);
            return source && sourceAnchor(source, true) ? source : null;
        }
        function onPointer(event) { hoverPoint = {x:event.clientX,y:event.clientY}; hoveredSource = hoveredCandidate(event.target); }
        function refreshHoveredSource() {
            // The adapter may be injected while the pointer is already stationary.
            // Resolve the live hover chain instead of requiring a new pointerover.
            const hovered = document.querySelectorAll?.(':hover');
            if (hovered?.length) hoveredSource = hoveredCandidate(hovered[hovered.length - 1]);
            else hoveredSource = hoverPoint ? hoveredCandidate(document.elementFromPoint(hoverPoint.x,hoverPoint.y)) : null;
        }
        function resetShortcut() { altSource = null; }
        function leaveDocument(event) {
            if (event.type === 'blur' || !event.relatedTarget) { hoveredSource = null; hoverPoint = null; resetShortcut(); releaseSelectionPreparation(); }
        }
        function editingEvent(event) {
            const interactive = target => editable(target) || Boolean(target?.closest?.(INTERACTIVE));
            return interactive(event.target) || interactive(document.activeElement) || event.composedPath?.().some(interactive);
        }
        function onKeyDown(event) {
            if (!standaloneTranslationAllowed()) { resetShortcut(); return; }
            if (event.key !== 'Alt') { resetShortcut(); return; }
            if (event.repeat) return;
            refreshHoveredSource();
            altSource = !event.defaultPrevented && !event.isComposing && !event.ctrlKey && !event.metaKey && !event.shiftKey &&
                !event.getModifierState?.('AltGraph') && !editingEvent(event) ? hoveredSource : null;
        }
        function requestTranslationPersistence() {
            const admit = view.__brevessAdmitTranslationPersistence;
            if (typeof admit !== 'function') return;
            const requestedUrl = document.location.href;
            void Promise.resolve(admit(requestedUrl)).catch(error => {
                view.console?.warn?.('Brevess: translation library checkpoint not saved', error?.code || error?.message);
            });
        }
        function onKeyUp(event) {
            if (!standaloneTranslationAllowed()) { resetShortcut(); return; }
            if (event.key !== 'Alt') { resetShortcut(); return; }
            refreshHoveredSource();
            const source = altSource; resetShortcut();
            if (!source || source !== hoveredSource || !source.isConnected || event.defaultPrevented || event.isComposing ||
                event.ctrlKey || event.metaKey || event.shiftKey || event.getModifierState?.('AltGraph') || editingEvent(event)) return;
            event.preventDefault();
            if (event.isTrusted === true) requestTranslationPersistence();
            toggleParagraph(source);
        }
        function onMessage(message, sender, respond) {
            if (sender?.id && sender.id !== view.chrome?.runtime?.id) return;
            if (message?.action === 'validateTranslationContext') {
                if (!view.chrome?.runtime?.id || sender?.id !== view.chrome.runtime.id) return;
                try {
                    const binding = validateTranslationContext(message.request);
                    respond({ success: true, data: { documentBinding: binding } });
                } catch (error) {
                    respond({ success: false, error: { code: error?.code || 'TRANSLATION_CONTEXT_STALE' } });
                }
                return;
            }
            if (message?.action === 'BREVESS_TRANSLATION_GET_STATE') {
                checkNavigation(); respond({ success: true, state: getState() }); return;
            }
            if (['BREVESS_TRANSLATION_SET_ENABLED', 'BREVESS_TRANSLATION_PAUSE', 'BREVESS_TRANSLATION_RESUME',
                'BREVESS_TRANSLATION_HIDE', 'BREVESS_TRANSLATION_DISMISS', 'BREVESS_TRANSLATION_CONFIRM_STOP'].includes(message?.action)) {
                if (typeof message.expectedNavigationIdentity !== 'string' || !message.expectedNavigationIdentity ||
                    documentIdentity(message.expectedNavigationIdentity) !== documentIdentity(document.location.href) ||
                    (message.expectedPageId !== undefined && message.expectedPageId !== pageId)) {
                    respond({ success: false, error: {
                        code: 'TAB_MESSAGE_NAVIGATION_STALE', message: 'TAB_MESSAGE_NAVIGATION_STALE'
                    } });
                    return;
                }
                checkNavigation();
                if (sender?.id === view.chrome?.runtime?.id &&
                    ((message.action === 'BREVESS_TRANSLATION_SET_ENABLED' && message.enabled === true) ||
                        message.action === 'BREVESS_TRANSLATION_RESUME')) requestTranslationPersistence();
                const operation = message.action === 'BREVESS_TRANSLATION_PAUSE' ? pause()
                    : message.action === 'BREVESS_TRANSLATION_CONFIRM_STOP' ? confirmStopped()
                    : message.action === 'BREVESS_TRANSLATION_RESUME' ? resume({ retryFailed: message.retryFailed === true })
                    : message.action === 'BREVESS_TRANSLATION_HIDE' ? hideTranslations(message.hidden === true)
                    : message.action === 'BREVESS_TRANSLATION_DISMISS' ? dismissNotice() : setEnabled(message.enabled === true, { wholePage: message.wholePage === true });
                void Promise.resolve(operation).then(state => respond({ success: true, state }),
                    () => respond({ success: false, error: 'LOCAL_TRANSLATION_FAILED' }));
                return true;
            }
        }
        function onNavigation() { checkNavigation(); }
        function validateTranslationContext(request) {
            const stale = () => Object.assign(new Error('Translation source context changed.'), { code: 'TRANSLATION_CONTEXT_STALE' });
            if (destroyed || documentIdentity(document.location.href) !== url || request?.taskId !== 'full_text_translation') throw stale();
            const binding = captureBinding(), expected = request.documentBinding;
            const required = ['navigationIdentity', 'pageUrl', 'pageId'];
            if (binding.documentIdentity !== undefined) required.push('documentIdentity', 'workspaceLifecycle');
            if (!expected || required.some(key => !Object.hasOwn(expected, key) || !Object.hasOwn(binding, key) || expected[key] !== binding[key]) ||
                !matchesIdentity(expected, binding)) throw stale();
            function sourceFor(sourceKey, sourceText) {
                const source = knownSources.get(sourceKey);
                if (!source || !source.element.isConnected || !sourceAnchor(source.element) ||
                    checkpointApi?.sourceKey(source.element) !== sourceKey || !sourceMatches(source) ||
                    (sourceText !== undefined && sourceText !== source.text)) throw stale();
                return source;
            }
            if (['LLM_TRANSLATE_TEXT', 'TRANSLATION_RECEIPT_GET'].includes(request.type)) {
                if (state.configurationStale) throw stale();
                const source = sourceFor(request.sourceKey);
                if (request.expectedEngineSignature !== engineSignature() || !Number.isInteger(request.sourceStart) || !Number.isInteger(request.sourceEnd) ||
                    request.sourceStart < 0 || request.sourceEnd <= request.sourceStart || request.sourceEnd > source.text.length ||
                    source.text.slice(request.sourceStart, request.sourceEnd) !== request.sourceText) throw stale();
                let context;
                try { context = checkpointApi.sliceScientificContext(source.text, source.scientificContext, request.sourceStart, request.sourceEnd); }
                catch { throw stale(); }
                if (!sameScientificContext(request.scientificContext, context)) throw stale();
            } else if (request.type === 'TRANSLATION_CHECKPOINT_WRITE') {
                if (request.engineSignature !== engineSignature() || !Array.isArray(request.translations) || request.translations.length > 2000) throw stale();
                for (const value of request.translations) {
                    const entry = checkpointApi?.normalizeEntry(value);
                    if (!entry || entry.engineSignature !== request.engineSignature) throw stale();
                    const source = sourceFor(entry.sourceKey, entry.sourceText);
                    if (!sameScientificContext(entry.scientificContext, source.scientificContext)) throw stale();
                }
            } else if (request.type === 'LLM_CONTROL_OPERATION') {
                if (request.command !== 'cancel' || typeof request.operationId !== 'string' || !/^translation-[A-Za-z0-9_-]{1,180}$/u.test(request.operationId)) throw stale();
            } else if (!['TRANSLATION_TASK_ROUTE_GET', 'TRANSLATION_CHECKPOINT_READ'].includes(request.type)) throw stale();
            return { ...binding };
        }
        function onPageHide() { stop(); }
        view.chrome?.runtime?.onMessage?.addListener(onMessage);
        view.chrome?.storage?.onChanged?.addListener(onSettingsChanged);
        view.addEventListener('popstate', onNavigation);
        view.addEventListener('hashchange', onNavigation);
        view.addEventListener('pagehide', onPageHide);
        document.addEventListener?.('pointerdown', resumeLocalDemand, true);
        document.addEventListener?.('keydown', resumeLocalDemand, true);
        document.addEventListener?.('pointerover', onPointer, true);
        document.addEventListener?.('pointerout', leaveDocument, true);
        document.addEventListener?.('keydown', onKeyDown, true);
        document.addEventListener?.('keyup', onKeyUp, true);
        view.addEventListener('blur', leaveDocument);
        // SPA pushState has no DOM event; a cheap URL check also cancels quiet navigations.
        const navigationTimer = view.setInterval(() => { if (state.active || records.size || selectionTasks.size || selectionPreparation) checkNavigation(); }, 500);
        // A reopened document may display saved output without enabling translation.
        if (!suppliedProvider && translationBridge) view.setTimeout(() => {
            void restoreSavedTranslations().catch(error => {
                if (!destroyed && !state.active) update({ checkpointPersistence: 'failed', checkpointError: error?.code || 'TRANSLATION_CHECKPOINT_READ_FAILED' });
            });
        }, 0);
        function destroy() {
            stop(); cachedResults = new WeakMap(); destroyed = true; controller?.destroy(); provider?.destroy();
            view.clearInterval(navigationTimer);
            view.chrome?.runtime?.onMessage?.removeListener(onMessage);
            view.chrome?.storage?.onChanged?.removeListener(onSettingsChanged);
            view.removeEventListener('popstate', onNavigation);
            view.removeEventListener('hashchange', onNavigation);
            view.removeEventListener('pagehide', onPageHide);
            document.removeEventListener?.('pointerdown', resumeLocalDemand, true);
            document.removeEventListener?.('keydown', resumeLocalDemand, true);
            document.removeEventListener?.('pointerover', onPointer, true);
            document.removeEventListener?.('pointerout', leaveDocument, true);
            document.removeEventListener?.('keydown', onKeyDown, true);
            document.removeEventListener?.('keyup', onKeyUp, true);
            view.removeEventListener('blur', leaveDocument);
        }
        return { setEnabled, getState, pause, resume, confirmStopped, hideTranslations, dismissNotice, captureExportSnapshot, captureSavedTranslations, restoreSavedTranslations,
            validateTranslationContext,
            captureDocumentBinding: captureBinding, sourceKeyForElement: checkpointApi?.sourceKey,
            captureTranslationSourceMap: () => new Map([...knownSources].filter(([sourceKey, source]) => source.element.isConnected &&
                checkpointApi?.sourceKey(source.element) === sourceKey && sourceMatches(source))
                .map(([sourceKey, source]) => [source.element, sourceKey])),
            translateSelection, prepareSelection, releaseSelectionPreparation, destroy };
    }
    return { createPageTranslator, readSourceText, localTranslationErrorMessage };
});
