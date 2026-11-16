// Reader adapter for temporary semantic search. Loaded after content.js so
// source locations and confirmed annotations use the existing reader contracts.
(function attachSemanticFind() {
    if (globalThis.__brevessSemanticFind || !SciLLM.createSemanticFindController) return;
    let corpus = null;
    let paintedHits = [];
    let selectedId = '';
    let sourceObserver = null;
    let shortcutKey = 'J';
    let searchStyle = null;
    const shadowStyles = new Map();
    let focusOwnerToken = '';
    let lease = 0;
    let ownedSelectionRange = null;
    let ownedConfirmation = null;
    let confirmationSequence = 0;
    const names = Array.from({ length: 101 }, (_, index) => `sci-semantic-search-${index}`);
    const currentName = 'sci-semantic-search-current';
    const additionalCollections = new WeakMap();

    function fail(message, code = 'SEMANTIC_FIND_SOURCE_UNAVAILABLE') {
        throw Object.assign(new Error(message), { code });
    }

    function sourceIdentity() {
        const native = currentNativePdfSemanticHighlightState();
        if (activeNativePdfStructure()) {
            if (!native.ready) return null;
            const context = native.context;
            return {
                kind: 'pdf', documentId: context.documentId,
                documentHash: context.documentHash,
                documentGeneration: context.documentGeneration,
                revision: context.revision, semanticCacheKey: context.semanticCacheKey,
                semanticProvenanceKey: context.semanticProvenanceKey
            };
        }
        return { kind: 'html', url: contentNavigationIdentity(),
            documentIdentity: contentDocumentIdentity,
            lifecycle: articleWorkspaceLifecycleGeneration };
    }

    function isCurrent(candidate) {
        return Boolean(candidate && candidate.lease === lease &&
            JSON.stringify(sourceIdentity()) === candidate.identityKey &&
            (!candidate.dom || candidate.dom.isCurrent()));
    }

    function isHitCurrent(candidate, hit) {
        if (!isCurrent(candidate)) return false;
        if (candidate.identity.kind === 'html') return candidate.dom?.isHitCurrent(hit) === true;
        const target = candidate.targets.get(hit.paragraphId);
        return Boolean(target && target.expectedNormalizedQuote?.slice(hit.start, hit.end) === hit.text);
    }

    function requireCurrentHit(candidate, hit) {
        if (!isCurrent(candidate)) fail('文档已变化，请重新搜索。');
        if (!isHitCurrent(candidate, hit)) fail('这条原文已变化，请重新选择结果。');
    }

    function htmlRange(candidate, hit) {
        return candidate.dom?.range(hit) || null;
    }

    function htmlRanges(candidate, hit) {
        return candidate.dom?.ranges(hit) || [];
    }

    async function buildCorpus() {
        const sourceLease = lease;
        const identity = sourceIdentity();
        if (!identity) fail('PDF 文本索引仍在准备，请稍后再次按 Enter 搜索。');
        let paragraphs;
        let bindings = new Map();
        let dom = null;
        const targets = new Map();
        let coverage = 'full';
        let coverageMessage = '';
        let initialSentences = null;
        let admittedSentenceCount = 0;
        if (identity.kind === 'pdf') {
            const context = currentNativePdfSemanticHighlightState().context;
            const ordered = pdfSemanticParagraphTargets(context.navigation)
                .slice().sort((a, b) => a.normalizedStart - b.normalizedStart);
            paragraphs = ordered.map(target => {
                targets.set(target.paragraphId, target);
                return { paragraphId: target.paragraphId,
                    text: target.expectedNormalizedQuote, sectionTitle: '' };
            });
            const textCoverage = activeNativePdfStructure()?.diagnostics?.textCoverage;
            if (!textCoverage?.terminal || textCoverage.failedPages > 0 ||
                textCoverage.deferredPages > 0 || textCoverage.emptyPages > 0) {
                coverage = 'partial';
                coverageMessage = '仅搜索当前可提取的文字；未识别或尚未索引的页面不在结果中。';
            }
        } else {
            if (!globalThis.CSS?.highlights || typeof Highlight !== 'function') {
                fail('当前浏览器不支持临时语义高亮，请更新 Edge 或 Chrome。');
            }
            if (!SciLLM.createSemanticFindDomSnapshot) fail('网页检索组件未就绪，请刷新页面后重试。');
            sourceObserver?.disconnect();
            dom = SciLLM.createSemanticFindDomSnapshot(document, {
                normalizeTextWithOffsets: SciLLM.normalizeTextWithOffsets,
                validateAdditionalParagraphs(values, { initial }) {
                    const nextSentences = SciLLM.createSemanticFindSentences(values);
                    if (admittedSentenceCount + nextSentences.length > 10000) {
                        fail('当前网页已达到10000句累计上限；已有结果保留，停止自动补充检索。',
                            'SEMANTIC_FIND_LIMIT_EXCEEDED');
                    }
                    admittedSentenceCount += nextSentences.length;
                    if (initial) initialSentences = nextSentences;
                }
            });
            sourceObserver = dom;
            dom.watch(() => {
                if (sourceLease === lease) controller.invalidate('网页文字或可见范围已变化，请重新搜索。');
            }, () => {
                if (sourceLease !== lease) return;
                if (ownedConfirmation && !isHitCurrent(ownedConfirmation.candidate, ownedConfirmation.hit)) {
                    if (typeof currentManualSelection === 'object' &&
                        currentManualSelection?.semanticFindSourceKey === ownedConfirmation.key) {
                        releaseSelectionAfterManualAction();
                    }
                    ownedConfirmation = null;
                }
                // The controller filters retired hits, paints and updates its
                // selection/readout together. Do not repeat that paint here.
                controller.refreshSourceHits?.();
            }, () => {
                if (sourceLease === lease) controller.queueAdditionalSearch?.();
            });
            paragraphs = dom.paragraphs;
            bindings = dom.bindings;
            coverageMessage = '搜索本页已加载、可渲染的文字（含屏幕外与已存在的开放 Shadow DOM）；不含 iframe、封闭 Shadow DOM、画布或图片内文字。';
            if (dom.hasLoadedSummaries) coverageMessage += ' PubMed 结果卡片含已加载的折叠摘要摘录；未加载的摘要全文不在范围内。';
        }
        const sentences = initialSentences || SciLLM.createSemanticFindSentences(paragraphs);
        if (!sentences.length) { dom?.disconnect(); fail('当前页面没有可搜索的可见文字。'); }
        const identityKey = JSON.stringify(identity);
        const sourceBytes = new TextEncoder().encode(JSON.stringify({ identity, paragraphs }));
        const digest = await crypto.subtle.digest('SHA-256', sourceBytes);
        const sourceKey = Array.from(new Uint8Array(digest), value =>
            value.toString(16).padStart(2, '0')).join('');
        const candidate = { identity, identityKey, sourceKey, paragraphs: [...paragraphs], sentences, lease: sourceLease,
            bindings, targets, coverage, coverageMessage, dom };
        if (!isCurrent(candidate)) fail('文档已变化，请重新搜索。', 'SEMANTIC_FIND_SOURCE_STALE');
        return candidate;
    }

    function collectAdditionalCorpus(candidate) {
        if (candidate?.identity?.kind !== 'html') return Promise.resolve(null);
        const previous = additionalCollections.get(candidate) || Promise.resolve();
        const next = previous.catch(() => {}).then(async () => {
            if (!isCurrent(candidate)) fail('网页原文已变化，无法继续补充检索。', 'SEMANTIC_FIND_SOURCE_STALE');
            const paragraphs = candidate.dom.drainAdditionalParagraphs();
            if (!paragraphs.length) return null;
            const sentences = SciLLM.createSemanticFindSentences(paragraphs);
            const bytes = new TextEncoder().encode(JSON.stringify({ identity: candidate.identity, paragraphs }));
            const digest = await crypto.subtle.digest('SHA-256', bytes);
            if (!isCurrent(candidate)) fail('网页原文已变化，无法继续补充检索。', 'SEMANTIC_FIND_SOURCE_STALE');
            const sourceKey = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
            candidate.paragraphs.push(...paragraphs);
            return { sourceKey, paragraphs, sentences };
        });
        additionalCollections.set(candidate, next);
        return next;
    }

    function locatorFor(candidate, hit) {
        const target = candidate.targets.get(hit.paragraphId);
        return createPdfSemanticHighlightLocator(target, {
            normalizedStart: target?.normalizedStart + hit.start,
            normalizedEnd: target?.normalizedStart + hit.end,
            expectedNormalizedQuote: hit.text
        });
    }

    function removePaint() {
        for (const name of [...names, currentName]) globalThis.CSS?.highlights?.delete(name);
        document.querySelectorAll('.pdf-native-semantic-search-layer').forEach(layer => layer.remove());
    }

    function installStyle() {
        if (!searchStyle?.isConnected) {
            searchStyle = document.createElement('style');
            searchStyle.dataset.sciPluginUi = 'true';
            searchStyle.textContent = names.map((name, index) =>
                `::highlight(${name}){background-color:rgba(255,187,35,${SciLLM.semanticFindScoreAlpha(index / 100)});color:inherit;}`
            ).join('\n') + `\n::highlight(${currentName}){text-decoration:underline;text-decoration-color:#915600;text-decoration-thickness:2px;}`;
            document.head.appendChild(searchStyle);
        }
        for (const root of corpus?.dom?.roots || []) {
            if (root.nodeType !== 11 || shadowStyles.get(root)?.isConnected) continue;
            const style = searchStyle.cloneNode(true);
            root.appendChild(style);
            shadowStyles.set(root, style);
        }
    }

    function paintPage(pageNumber) {
        if (!corpus || corpus.identity.kind !== 'pdf') return;
        if (!isCurrent(corpus)) { controller.invalidate('PDF 已变化，请重新搜索。'); return; }
        const entry = { ...corpus.identity, items: paintedHits.map(hit => ({
            ...hit, locator: locatorFor(corpus, hit)
        })) };
        paintPdfSemanticHighlightPage(entry, pageNumber, {
            layerClass: 'pdf-native-semantic-search-layer', modeId: 'semantic_find',
            createMark: ({ item }) => {
                const mark = document.createElement('button');
                mark.type = 'button';
                mark.className = 'pdf-native-semantic-search-hit';
                mark.dataset.sciPluginUi = 'true';
                mark.dataset.semanticFindId = item.id;
                mark.dataset.score = String(item.score);
                mark.dataset.current = String(item.id === selectedId);
                mark.style.backgroundColor = `rgba(255,187,35,${SciLLM.semanticFindScoreAlpha(item.score)})`;
                mark.title = SciLLM.translateInterfaceText?.(`模型匹配分值 ${item.score.toFixed(3)} · 点击选择高亮类别`) || `模型匹配分值 ${item.score.toFixed(3)} · 点击选择高亮类别`;
                mark.setAttribute('aria-label', mark.title);
                mark.addEventListener('mousedown', event => event.preventDefault());
                mark.addEventListener('click', event => {
                    event.preventDefault();
                    event.stopPropagation();
                    void controller.confirm(item.id, mark.getBoundingClientRect());
                });
                return mark;
            }
        });
    }

    function paint(candidate, hits, currentId) {
        if (!isCurrent(candidate)) return;
        corpus = candidate;
        paintedHits = hits;
        selectedId = currentId;
        removePaint();
        if (candidate.identity.kind === 'pdf') {
            document.querySelectorAll('.pdf-native-text-layer[data-pdf-page-number]')
                .forEach(layer => paintPage(Number(layer.dataset.pdfPageNumber)));
            return;
        }
        installStyle();
        const groups = new Map();
        let selectedRange = null;
        for (const hit of hits) {
            const ranges = htmlRanges(candidate, hit);
            if (!ranges.length) continue;
            const bucket = Math.round(hit.score * 100);
            if (!groups.has(bucket)) groups.set(bucket, []);
            groups.get(bucket).push(...ranges);
            if (hit.id === currentId) selectedRange = ranges;
        }
        for (const [bucket, ranges] of groups) CSS.highlights.set(names[bucket], new Highlight(...ranges));
        if (selectedRange) CSS.highlights.set(currentName, new Highlight(...selectedRange));
    }

    async function focus(candidate, hit) {
        if (!isCurrent(candidate)) return;
        if (candidate.identity.kind === 'pdf') {
            const locator = locatorFor(candidate, hit);
            focusOwnerToken = `semantic-find:${crypto.randomUUID()}`;
            const result = await globalThis.__brevessPdfReaderBridge?.command(
                'focusSemanticTarget', candidate.targets.get(hit.paragraphId), locator,
                { ownerToken: focusOwnerToken });
            if (!result?.focused) fail('暂时无法定位这条原文，请重新搜索。');
        } else {
            if (candidate.dom?.reveal && !candidate.dom.reveal(hit)) fail('正文位置已变化，请重新搜索。');
            const range = htmlRanges(candidate, hit)[0];
            if (!range) fail('正文位置已变化，请重新搜索。');
            if (candidate.dom?.isVisible && !candidate.dom.isVisible(hit)) {
                fail('这条原文当前被网页折叠或隐藏；已有结果保留，请展开后再定位。');
            }
            range.startContainer.parentElement?.scrollIntoView({ block: 'center', behavior: 'instant' });
        }
    }

    function descriptorForRange(range) {
        const selection = document.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        ownedSelectionRange = range;
        const descriptor = describeCurrentManualSelection();
        if (!descriptor?.validation?.valid || !descriptor.anchor) {
            fail(descriptor?.validation?.message || '这条原文暂时无法保存为高亮。');
        }
        return descriptor;
    }

    function canonicalHtmlRange(candidate, hit) {
        const range = htmlRange(candidate, hit);
        if (!range || range.startContainer.getRootNode() !== document) return null;
        const scholarly = [...document.querySelectorAll(
            'meta[name="citation_doi"],meta[name="dc.identifier"],meta[name="DC.Identifier"],meta[name="citation_pmid"]')]
            .some(meta => {
                const value = String(meta.content || '').trim();
                if (String(meta.name || '').toLowerCase() === 'citation_pmid') return /^\d+$/u.test(value);
                // Reuse the DOI normalization used by the existing workspace;
                // Dublin Core identifiers may also be ordinary page IDs/URLs.
                const doi = SciLLM.normalizeWorkspaceDoi?.(value) || '';
                return /^10\.\d{4,9}\/[^\s<>]+$/u.test(doi);
            });
        if (!scholarly && !(typeof currentManualDocument === 'object' && currentManualDocument?.documentId)) return null;
        const canonicalBlock = () => {
            const start = range.startContainer.parentElement?.closest('[data-sci-llm-paragraph-id]');
            const end = range.endContainer.parentElement?.closest('[data-sci-llm-paragraph-id]');
            if (!start || start !== end) return null;
            const id = start.dataset.sciLlmParagraphId;
            const records = candidate.manualRecords ||
                (typeof currentArticleStructure === 'object' ? currentArticleStructure?.paragraphs : []) || [];
            const record = records.find(item => (item.paragraphId === id || item.sourceKey === id) &&
                (!item.recordType || item.recordType === 'body'));
            const normalize = value => SciLLM.normalizeTextWithOffsets(value).text;
            if (!record || normalize(manualReadableText(start)) !== normalize(record.text) ||
                normalize(range.toString()) !== hit.text) return null;
            return range;
        };
        let verified = canonicalBlock();
        if (verified || candidate.manualExtractionAttempted) return verified;
        // Only an explicit article identity can opt into on-demand canonical
        // extraction. General page search itself never creates article anchors.
        if (!scholarly) return null;
        candidate.manualExtractionAttempted = true;
        candidate.manualRecords = extractArticleWithTrace('semantic_find_confirm', { forceRefresh: true });
        verified = canonicalBlock();
        return verified;
    }

    async function confirm(candidate, hit, rect) {
        requireCurrentHit(candidate, hit);
        if (candidate.identity.kind === 'html' && !canonicalHtmlRange(candidate, hit)) {
            fail('这条网页文字仅支持临时语义高亮，尚无可验证的论文保存位置。');
        }
        await prepareManualDocument({ throwOnError: true });
        requireCurrentHit(candidate, hit);
        let descriptor;
        if (candidate.identity.kind === 'html') {
            const range = canonicalHtmlRange(candidate, hit);
            if (!range) fail('正文位置已变化，请重新搜索。');
            descriptor = descriptorForRange(range);
        } else {
            const locator = locatorFor(candidate, hit);
            const resolved = resolvePdfSemanticHighlightLocator(locator);
            if (resolved.status !== 'resolved') fail('原文坐标已变化，请重新搜索。');
            const descriptors = [];
            for (const raw of resolved.ranges) {
                let projection = globalThis.__brevessPdfReaderBridge?.command('getPageProjection', raw.pageNumber);
                if (!projection?.textLayer?.isConnected) {
                    await globalThis.__brevessPdfReaderBridge?.command('ensurePageIndexed',
                        raw.pageNumber, candidate.identity);
                    projection = globalThis.__brevessPdfReaderBridge?.command('getPageProjection', raw.pageNumber);
                }
                if (!isCurrent(candidate) || projection?.documentHash !== candidate.identity.documentHash ||
                    projection?.documentGeneration !== candidate.identity.documentGeneration) {
                    fail('PDF 已变化，请重新搜索。');
                }
                const text = SciLLM.readPdfTextProjection(projection.textLayer, { mode: 'raw-offset' });
                if (text.text.slice(raw.start, raw.end) !== raw.quote) fail('原文坐标不匹配，请重新搜索。');
                const range = SciLLM.pdfProjectionRange(text, raw, document);
                if (!range) fail('原文暂时不可见，请跳转到对应页面后重试。');
                descriptors.push(descriptorForRange(range));
            }
            descriptor = { ...descriptors[0], text: hit.text,
                anchorSegments: descriptors.flatMap(item => item.anchorSegments) };
        }
        requireCurrentHit(candidate, hit);
        const key = candidate.identity.kind === 'html'
            ? `${candidate.sourceKey}:hit:${++confirmationSequence}` : candidate.sourceKey;
        ownedConfirmation = { candidate, hit: { ...hit }, key };
        showManualSelectionToolbar({ ...descriptor, semanticFindSourceKey: key,
            rect: rect || descriptor.rect });
    }

    function clear() {
        lease += 1;
        if (focusOwnerToken) globalThis.__brevessPdfReaderBridge?.command('cancelOwnedSemanticFocus', focusOwnerToken);
        focusOwnerToken = '';
        sourceObserver?.disconnect();
        sourceObserver = null;
        removePaint();
        searchStyle?.remove();
        searchStyle = null;
        for (const style of shadowStyles.values()) style.remove();
        shadowStyles.clear();
        if (currentManualSelection?.semanticFindSourceKey) releaseSelectionAfterManualAction();
        const selection = document.getSelection?.();
        if (ownedSelectionRange && selection?.rangeCount === 1) {
            const live = selection.getRangeAt(0);
            if (live.startContainer === ownedSelectionRange.startContainer &&
                live.startOffset === ownedSelectionRange.startOffset &&
                live.endContainer === ownedSelectionRange.endContainer &&
                live.endOffset === ownedSelectionRange.endOffset) selection.removeAllRanges();
        }
        ownedSelectionRange = null;
        ownedConfirmation = null;
        corpus = null;
        paintedHits = [];
        selectedId = '';
    }

    const controller = SciLLM.createSemanticFindController({
        adapter: { buildCorpus, collectAdditionalCorpus, isCurrent, isHitCurrent, paint, focus, confirm, clear },
        document, window,
        sendMessage: message => chrome.runtime.sendMessage(message),
        openSettings: () => chrome.runtime.sendMessage({ type: 'SEMANTIC_FIND_OPEN_SETTINGS' })
    });

    function configure(publicState) {
        const saved = publicState?.settings?.keyboardShortcuts;
        if (saved && Object.prototype.hasOwnProperty.call(saved, 'semanticFind')) {
            shortcutKey = String(saved.semanticFind || '').normalize('NFKC').trim().toUpperCase();
        }
    }
    const refreshSettings = () => chrome.runtime.sendMessage({ type: 'LLM_GET_SETTINGS' })
        .then(response => { if (response?.success) configure(response.data); }).catch(() => {});
    void refreshSettings();
    chrome.storage?.onChanged?.addListener((changes, area) => {
        if (area === 'local' && changes.sciLlmSettingsV2) void refreshSettings();
    });
    globalThis.__brevessSemanticFind = {
        ...controller, configure,
        get shortcutKey() { return shortcutKey; },
        isCurrentSource: key => Boolean(ownedConfirmation?.key === key &&
            isHitCurrent(ownedConfirmation.candidate, ownedConfirmation.hit))
    };
    document.addEventListener('click', event => {
        const target = event.composedPath?.()[0] || event.target;
        if (!corpus || corpus.identity.kind !== 'html' || event.button !== 0 || !paintedHits.length ||
            target.closest?.('[data-sci-plugin-ui],input,textarea,select,button,a,[role="button"],[contenteditable],.sci-manual-highlight,.sci-llm-highlight')) return;
        // Plugin controls and other non-hit targets must not pay for a source
        // check. Actual source-hit clicks still validate before reading ranges.
        if (!isCurrent(corpus)) return;
        for (const hit of paintedHits) {
            const ranges = htmlRanges(corpus, hit);
            const rect = ranges.flatMap(range => [...range.getClientRects()]).find(item =>
                event.clientX >= item.left && event.clientX <= item.right &&
                event.clientY >= item.top && event.clientY <= item.bottom);
            if (!rect) continue;
            if (!canonicalHtmlRange(corpus, hit)) continue;
            event.preventDefault();
            event.stopImmediatePropagation();
            void controller.confirm(hit.id, rect);
            break;
        }
    }, true);
    document.addEventListener('brevess:pdf-page-rendered', event => paintPage(event.detail?.pageNumber));
    document.addEventListener('brevess:pdf-page-unmounted', event => {
        const pageNumber = Number(event.detail?.pageNumber);
        if (!Number.isSafeInteger(pageNumber) || pageNumber < 1) return;
        document.querySelectorAll(`.pdf-native-page[data-pdf-page-number="${pageNumber}"] .pdf-native-semantic-search-layer`)
            .forEach(layer => layer.remove());
    });
    document.addEventListener('brevess:pdf-source-changing', () => controller.invalidate('PDF 已更换。'));
    window.addEventListener('pagehide', () => controller.close());
})();
