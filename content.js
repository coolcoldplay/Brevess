// 内容脚本 - 在网页上执行高亮
document.documentElement.dataset.sciLlmContentRevision = '2.3.0-panel-chat-r3';
class SciPaperHighlighter {
    constructor() {
        this.highlightedElements = [];
        this.originalContents = new Map();
        this.matchCounts = {}; // 存储每个类别的匹配次数
    }

    // 应用高亮
    applyHighlight(categories, mode) {
        // 先清除之前的高亮
        this.clearHighlight();
        
        // 重置匹配计数
        this.matchCounts = {};
        Object.keys(categories).forEach(key => {
            this.matchCounts[key] = 0;
        });

        // 为每个类别创建正则表达式
        const categoryRegexes = this.buildRegexes(categories);

        if (mode === 'sentence') {
            this.applySentenceHighlights(document.body, categoryRegexes);
        } else {
            // 短语模式仍按独立文本节点处理
            const textNodes = this.getTextNodes(document.body);
            textNodes.forEach(node => {
                if (this.shouldSkipNode(node)) return;
                const text = node.textContent;
                const matches = this.findMatches(text, categoryRegexes, mode);
                if (matches.length > 0) this.highlightNode(node, matches, mode);
            });
        }

        console.log(`SCI高亮助手: 已高亮 ${this.highlightedElements.length} 个元素`);
        console.log('匹配计数:', this.matchCounts);
        
        return this.matchCounts;
    }

    // 构建正则表达式
    buildRegexes(categories) {
        const regexes = [];
        
        Object.entries(categories).forEach(([key, category]) => {
            if (category.isRegex) {
                // 正则表达式模式
                const regex = new RegExp(category.patterns[0], 'gi');
                regexes.push({
                    regex: regex,
                    category: key,
                    color: category.color,
                    name: category.name,
                    originalPattern: category.patterns[0],
                    isRegex: true
                });
            } else {
                // 简单列表模式
                category.patterns.forEach(pattern => {
                    // 转义特殊字符，但保留.*用于通配
                    let regexPattern = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
                    regexPattern = regexPattern.replace(/\\\.\\\*/g, '.*?'); // 恢复.*的通配功能
                    
                    // 添加单词边界（忽略大小写）
                    const regex = new RegExp(`\\b${regexPattern}\\b`, 'gi');
                    
                    regexes.push({
                        regex: regex,
                        category: key,
                        color: category.color,
                        name: category.name,
                        originalPattern: pattern,
                        isRegex: false
                    });
                });
            }
        });
        
        return regexes;
    }

    // 查找匹配
    findMatches(text, regexes, mode) {
        const matches = [];
        
        regexes.forEach(({ regex, category, color, name, originalPattern }) => {
            regex.lastIndex = 0; // 重置正则状态
            let match;
            
            while ((match = regex.exec(text)) !== null) {
                const matchedText = match[0];
                const startIndex = match.index;
                const endIndex = startIndex + matchedText.length;
                
                // 如果是句子模式，扩展到整个句子
                let highlightStart = startIndex;
                let highlightEnd = endIndex;
                
                if (mode === 'sentence') {
                    const bounds = SciLLM.findScientificSentenceBounds(text, startIndex, endIndex);
                    highlightStart = bounds.start;
                    highlightEnd = bounds.end;
                }
                
                matches.push({
                    start: highlightStart,
                    end: highlightEnd,
                    color: color,
                    category: category,
                    name: name,
                    matchedText: text.substring(highlightStart, highlightEnd),
                    matchedKeyword: matchedText, // 实际匹配到的关键词
                    originalPattern: originalPattern
                });
                
                // 增加计数
                if (!this.matchCounts[category]) {
                    this.matchCounts[category] = 0;
                }
                this.matchCounts[category]++;
            }
        });
        
        // 按位置排序并合并重叠区域
        matches.sort((a, b) => a.start - b.start);
        return this.mergeOverlappingMatches(matches).map(item => ({
            ...item,
            matchedText: text.substring(item.start, item.end)
        }));
    }

    // 合并重叠的匹配
    mergeOverlappingMatches(matches) {
        if (matches.length === 0) return matches;
        
        const merged = [];
        let current = matches[0];
        
        for (let i = 1; i < matches.length; i++) {
            const next = matches[i];
            
            if (next.start <= current.end) {
                // 重叠，扩展当前匹配（保留第一个匹配的颜色和信息）
                if (next.end > current.end) {
                    current.end = next.end;
                }
            } else {
                merged.push(current);
                current = next;
            }
        }
        merged.push(current);
        
        return merged;
    }

    getSentenceBlocks(root) {
        const blocks = new Set();
        const blockSelector = 'p, li, blockquote, dd, dt, td, th, figcaption, h1, h2, h3, h4, h5, h6, [role="paragraph"]';
        this.getTextNodes(root).forEach(node => {
            const parent = node.parentElement || node.parentNode;
            if (!parent?.closest) return;
            const block = parent.closest('p, li, blockquote, dd, dt, td, th, figcaption, h1, h2, h3, h4, h5, h6, [role="paragraph"]') || parent;
            if (root.contains(block)) blocks.add(block);
        });
        return [...blocks].filter(block => block.matches?.(blockSelector) || block.parentNode);
    }

    collectSentenceTextNodes(element) {
        const nodes = [];
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
            acceptNode: node => {
                if (this.shouldSkipNode(node) || !node.textContent.length) {
                    return NodeFilter.FILTER_REJECT;
                }
                return NodeFilter.FILTER_ACCEPT;
            }
        });
        let node;
        while ((node = walker.nextNode())) nodes.push(node);
        return nodes;
    }

    locateSentenceOffset(nodes, offset, preferNextNode) {
        let cursor = 0;
        for (let index = 0; index < nodes.length; index += 1) {
            const node = nodes[index];
            const next = cursor + node.textContent.length;
            if (offset < next || (offset === next && (!preferNextNode || index === nodes.length - 1))) {
                return { node, offset: Math.max(0, offset - cursor) };
            }
            cursor = next;
        }
        return null;
    }

    createHighlightSpan(match, mode) {
        const span = document.createElement('span');
        span.className = 'sci-highlight';
        span.dataset.highlightMode = mode;
        span.dataset.source = 'regex';
        span.dataset.categoryId = match.category;
        span.dataset.categoryName = match.name;
        span.setAttribute('data-category', match.category);
        span.setAttribute('data-category-name', match.name);
        span.setAttribute('data-matched-keyword', match.matchedKeyword);
        span.style.borderBottomColor = match.color;
        span.style.color = '#000';
        span.style.padding = '2px 4px';
        span.style.borderRadius = '3px';
        span.style.cursor = 'help';
        span.style.transition = 'all 0.2s';
        span.style.position = 'relative';
        const tooltipText = mode === 'sentence'
            ? `${match.name}\n匹配词：${match.matchedKeyword}`
            : match.name;
        span.setAttribute('title', tooltipText);
        span.addEventListener('mouseenter', event => {
            event.target.style.transform = 'scale(1.02)';
            event.target.style.boxShadow = '0 2px 8px rgba(0,0,0,0.2)';
            event.target.style.zIndex = '1000';
            this.showTooltip(event.target, match);
        });
        span.addEventListener('mouseleave', event => {
            event.target.style.transform = 'scale(1)';
            event.target.style.boxShadow = 'none';
            event.target.style.zIndex = 'auto';
            this.hideTooltip();
        });
        return span;
    }

    applySentenceHighlights(root, regexes) {
        this.getSentenceBlocks(root).forEach(block => {
            const nodes = this.collectSentenceTextNodes(block);
            const text = nodes.map(node => node.textContent).join('');
            if (!text.trim()) return;
            const matches = this.findMatches(text, regexes, 'sentence');
            const ranges = matches.map(match => ({
                match,
                start: this.locateSentenceOffset(nodes, match.start, true),
                end: this.locateSentenceOffset(nodes, match.end, false)
            })).filter(item => item.start && item.end)
                .sort((a, b) => b.match.start - a.match.start);

            ranges.forEach(item => {
                const range = document.createRange();
                range.setStart(item.start.node, item.start.offset);
                range.setEnd(item.end.node, item.end.offset);
                const span = this.createHighlightSpan(item.match, 'sentence');
                span.appendChild(range.extractContents());
                range.insertNode(span);
                this.highlightedElements.push(span);
            });
        });
    }

    // 高亮节点
    highlightNode(node, matches, mode) {
        const parent = node.parentNode;
        if (!parent) return;
        
        // 保存原始内容
        if (!this.originalContents.has(parent)) {
            this.originalContents.set(parent, parent.innerHTML);
        }
        
        const text = node.textContent;
        const fragment = document.createDocumentFragment();
        let lastIndex = 0;
        
        matches.forEach(match => {
            // 添加匹配之前的文本
            if (match.start > lastIndex) {
                fragment.appendChild(document.createTextNode(text.substring(lastIndex, match.start)));
            }
            
            // 创建高亮元素
            const span = this.createHighlightSpan(match, mode);
            span.textContent = text.substring(match.start, match.end);
            
            fragment.appendChild(span);
            this.highlightedElements.push(span);
            
            lastIndex = match.end;
        });
        
        // 添加剩余文本
        if (lastIndex < text.length) {
            fragment.appendChild(document.createTextNode(text.substring(lastIndex)));
        }
        
        // 替换原节点
        parent.replaceChild(fragment, node);
    }

    // 显示自定义tooltip
    showTooltip(element, match) {
        // 移除已存在的tooltip
        this.hideTooltip();
        
        const tooltip = document.createElement('div');
        tooltip.id = 'sci-highlight-tooltip';
        tooltip.style.cssText = `
            position: absolute;
            background: rgba(0, 0, 0, 0.9);
            color: white;
            padding: 8px 12px;
            border-radius: 6px;
            font-size: 12px;
            line-height: 1.4;
            z-index: 10000;
            pointer-events: none;
            max-width: 300px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        `;
        
        // 设置内容
        const content = `
            <div style="font-weight: 600; margin-bottom: 4px; color: ${match.color};">
                📋 ${match.name}
            </div>
            <div style="font-size: 11px; opacity: 0.9;">
                匹配词：<strong>${match.matchedKeyword}</strong>
            </div>
        `;
        tooltip.innerHTML = content;
        
        document.body.appendChild(tooltip);
        
        // 计算位置
        const rect = element.getBoundingClientRect();
        const tooltipRect = tooltip.getBoundingClientRect();
        
        let top = rect.bottom + window.scrollY + 5;
        let left = rect.left + window.scrollX + (rect.width / 2) - (tooltipRect.width / 2);
        
        // 确保不超出视口
        if (left < 0) left = 10;
        if (left + tooltipRect.width > window.innerWidth) {
            left = window.innerWidth - tooltipRect.width - 10;
        }
        
        // 如果tooltip会超出底部，显示在上方
        if (top + tooltipRect.height > window.innerHeight + window.scrollY) {
            top = rect.top + window.scrollY - tooltipRect.height - 5;
        }
        
        tooltip.style.top = top + 'px';
        tooltip.style.left = left + 'px';
        
        // 添加淡入动画
        tooltip.style.opacity = '0';
        setTimeout(() => {
            tooltip.style.transition = 'opacity 0.2s';
            tooltip.style.opacity = '1';
        }, 10);
    }

    // 隐藏tooltip
    hideTooltip() {
        const tooltip = document.getElementById('sci-highlight-tooltip');
        if (tooltip) {
            tooltip.remove();
        }
    }

    // 获取匹配计数（不应用高亮，只统计）
    getMatchCounts(rules) {
        const counts = {};
        Object.keys(rules).forEach(key => {
            counts[key] = 0;
        });
        
        const textNodes = this.getTextNodes(document.body);
        const categoryRegexes = this.buildRegexes(rules);
        
        textNodes.forEach(node => {
            if (this.shouldSkipNode(node)) return;
            
            const text = node.textContent;
            
            categoryRegexes.forEach(({ regex, category }) => {
                regex.lastIndex = 0;
                let match;
                while ((match = regex.exec(text)) !== null) {
                    counts[category]++;
                }
            });
        });
        
        return counts;
    }

    // 清除高亮
    clearHighlight() {
        // 隐藏tooltip
        this.hideTooltip();

        // 正则高亮独立清除，只解包本实例创建的 sci-highlight 节点。
        this.highlightedElements.forEach(element => {
            const parent = element?.parentNode;
            if (!parent) return;
            while (element.firstChild) parent.insertBefore(element.firstChild, element);
            element.remove();
            parent.normalize();
        });
        
        this.highlightedElements = [];
        this.originalContents.clear();
        this.matchCounts = {};
        
        console.log('SCI高亮助手: 已清除所有高亮');
    }

    // 获取所有文本节点
    getTextNodes(element) {
        const textNodes = [];
        const walker = document.createTreeWalker(
            element,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode: (node) => {
                    // 跳过脚本、样式等
                    if (this.shouldSkipNode(node)) {
                        return NodeFilter.FILTER_REJECT;
                    }
                    // 跳过空白节点
                    if (!node.textContent.trim()) {
                        return NodeFilter.FILTER_REJECT;
                    }
                    return NodeFilter.FILTER_ACCEPT;
                }
            }
        );
        
        let node;
        while (node = walker.nextNode()) {
            textNodes.push(node);
        }
        
        return textNodes;
    }

    // 判断是否应该跳过节点
    shouldSkipNode(node) {
        if (!node || !node.parentNode) return true;
        
        const parent = node.parentNode;
        const tagName = parent.tagName ? parent.tagName.toLowerCase() : '';
        
        // 跳过的标签
        const skipTags = ['script', 'style', 'noscript', 'iframe', 'object', 'embed', 'textarea', 'code', 'pre'];
        if (skipTags.includes(tagName)) return true;
        
        // 跳过已经高亮的元素
        if (parent.classList && parent.classList.contains('sci-highlight')) return true;
        
        // 跳过输入框等
        if (parent.isContentEditable) return true;
        
        return false;
    }
}

// DOM-independent manual annotation UI helpers: start
const ManualAnnotationUiHelpers = (() => {
    const ANCHOR_FIELDS = Object.freeze([
        'quote', 'prefix', 'suffix', 'sectionTitle', 'blockFingerprint',
        'startOffset', 'endOffset'
    ]);

    function validateManualSelectionDescriptor(descriptor = {}) {
        if (descriptor.collapsed || !String(descriptor.text || '').trim()) {
            return { valid: false, code: 'EMPTY_SELECTION', message: '请选择需要标注的文字' };
        }
        if (descriptor.insidePluginUi) {
            return { valid: false, code: 'PLUGIN_UI', message: '插件界面内不创建正文标注' };
        }
        if (descriptor.blockedRegion || descriptor.effectiveContentEditable ||
            descriptor.intersectsForbiddenRegion) {
            return { valid: false, code: 'BLOCKED_REGION', message: '此区域不支持文字标注' };
        }
        if (!descriptor.startBlockId || !descriptor.endBlockId) {
            return { valid: false, code: 'OUTSIDE_ARTICLE', message: '请在论文正文段落内选择文字' };
        }
        if (descriptor.startBlockId !== descriptor.endBlockId) {
            return { valid: false, code: 'CROSS_BLOCK', message: '一次请选择同一段落内的文字' };
        }
        return { valid: true };
    }

    function planManualAnnotationRestore(records, blocks, locate) {
        const located = [];
        const unresolved = [];
        (Array.isArray(records) ? records : []).forEach(annotation => {
            const result = locate(annotation, blocks);
            if (result?.status === 'located') located.push({ annotation, location: result });
            else unresolved.push(annotation);
        });
        return { located, unresolved };
    }

    function buildReanchoredAnnotation(annotation, anchor) {
        const next = { ...annotation };
        ANCHOR_FIELDS.forEach(field => {
            if (Object.prototype.hasOwnProperty.call(anchor || {}, field)) next[field] = anchor[field];
        });
        next.status = 'located';
        return next;
    }

    function createManualUiLifecycle() {
        let initialized = false;
        let epoch = 0;
        let documentId = '';
        let blocks = [];
        let unresolved = [];
        let selection = null;
        const bindings = [];

        function releaseRetainedState() {
            blocks = [];
            unresolved = [];
            selection = null;
        }

        return {
            initialize(nextBindings = []) {
                if (initialized) return false;
                nextBindings.forEach(binding => {
                    if (!binding?.target?.addEventListener || typeof binding.handler !== 'function') return;
                    const options = binding.options === undefined ? false : binding.options;
                    binding.target.addEventListener(binding.type, binding.handler, options);
                    bindings.push({ ...binding, options });
                });
                initialized = true;
                return true;
            },
            beginDocument(nextDocumentId) {
                epoch += 1;
                documentId = String(nextDocumentId || '');
                releaseRetainedState();
                return Object.freeze({ epoch, documentId });
            },
            isCurrent(token, responseDocumentId) {
                return Boolean(token) && token.epoch === epoch && token.documentId === documentId &&
                    String(responseDocumentId || '') === documentId;
            },
            retain(next = {}) {
                blocks = Array.isArray(next.blocks) ? next.blocks : blocks;
                unresolved = Array.isArray(next.unresolved) ? next.unresolved : unresolved;
                selection = next.selection === undefined ? selection : next.selection;
            },
            disable() {
                while (bindings.length) {
                    const binding = bindings.pop();
                    binding.target.removeEventListener?.(
                        binding.type, binding.handler, binding.options
                    );
                }
                initialized = false;
                epoch += 1;
                documentId = '';
                releaseRetainedState();
            },
            snapshot() {
                return {
                    initialized,
                    documentId,
                    blockCount: blocks.length,
                    unresolvedCount: unresolved.length,
                    hasSelection: Boolean(selection)
                };
            }
        };
    }

    function splitManualToolbarCategories({
        activeCategories = [], allCategories = [], primaryLimit = 8, moreLimit = 40
    } = {}) {
        const seen = new Set();
        const unique = items => (Array.isArray(items) ? items : []).filter(category => {
            const id = String(category?.categoryId || '');
            if (!id || category?.retired === true || seen.has(id)) return false;
            seen.add(id);
            return true;
        });
        const active = unique(activeCategories);
        const remaining = unique(allCategories);
        const primary = active.slice(0, Math.max(0, primaryLimit));
        const overflow = [...active.slice(primary.length), ...remaining];
        const more = overflow.slice(0, Math.max(0, moreLimit));
        return { primary, more, hiddenMoreCount: Math.max(0, overflow.length - more.length) };
    }

    function isManualMutationCandidateCurrent({
        currentDocumentId = '', selectionDocumentId = '', blockId = '', blocks = []
    } = {}) {
        if (!currentDocumentId || currentDocumentId !== selectionDocumentId || !blockId) {
            return false;
        }
        const block = (Array.isArray(blocks) ? blocks : [])
            .find(candidate => candidate?.blockId === blockId);
        return Boolean(block?.element?.isConnected);
    }

    return {
        validateManualSelectionDescriptor,
        planManualAnnotationRestore,
        buildReanchoredAnnotation,
        createManualUiLifecycle,
        splitManualToolbarCategories,
        isManualMutationCandidateCurrent
    };
})();
// DOM-independent manual annotation UI helpers: end

let llmAnalysisPromise = null;
const llmOperationState = {
    active: null,
    generation: 0
};
let lastLlmDiagnostics = null;
let lastLlmAnalysis = null;
let llmProgressiveAnalysis = null;
let lastPreparedStudy = null;
let lastRegexHighlightRequest = null;
let restoredFigureWorkspaceSnapshot = null;
let articleArchiveSaveTimer = null;
let figureAnalysisPromise = null;
let figureDepthAnalysisPromise = null;
let figureDepthAnalysisId = '';
const figureOperationState = {
    active: null,
    generation: 0
};
let lastFigureAnalysis = null;
const figureWalkthroughState = new Map();
const figureProgressById = new Map();
let figureWorkspaceInventory = [];
let figureAnalysisStatus = createInitialFigureAnalysisStatus();
let crossFigureLogicPromise = null;
let crossFigureLogicState = {
    result: null,
    loading: false,
    error: ''
};
let articleChatState = {
    turns: [],
    loading: false,
    error: '',
    operationId: '',
    activeTurnId: '',
    coverage: null,
    memoryNeedsRebuild: false
};
let articleChatGeneration = 0;
let articleChatTurnSequence = 0;
let articleChatPumpPromise = null;
let reviewOutlinePromise = null;
let lastReviewOutline = null;
const standaloneReviewParagraphSummaries = new Map();
let reviewOutlineDepth = 'major';
let reviewOutlineStatus = createInitialReviewOutlineStatus();
let currentArticleStructure = null;
let articleStructureObserver = null;
let articleStructureRefreshTimer = null;
const extractionTrace = SciLLM.createExtractionTraceRecorder({ limit: 40 });
let lastSuccessfulExtraction = null;
let lastSuccessfulStructure = null;
const ARTICLE_EXTRACTION_CACHE_TTL_MS = 15000;
let articleExtractionCache = null;
let canonicalArticleSnapshotCache = null;
const articleSectionOutlines = new Map();
const articleNavigatorState = {
    activeTab: 'outline',
    depth: 'major',
    summariesVisible: false,
    expandedSectionIds: new Set()
};
const REVIEW_ROLE_LABELS = Object.freeze({
    article_meta: '文章信息',
    introduction: '引言',
    introduction_and_thesis: '引言与主旨',
    scope_and_thesis: '范围与主旨',
    overview: '概览',
    conceptual_foundation: '概念基础',
    topic_setup: '主题引入',
    definition: '概念定义',
    historical_development: '历史演进',
    evidence_support: '证据支持',
    evidence_contrast: '证据对照',
    methodology_comparison: '方法比较',
    synthesis: '综合判断',
    limitation: '局限',
    gap: '知识缺口',
    implication: '研究启示',
    future_direction: '未来方向',
    future_directions: '未来方向',
    technology_development: '技术进展',
    challenges: '挑战',
    transition: '承上启下',
    conclusion: '结论',
    other: '其他'
});
const FIGURE_IMAGE_MAX_EDGE = 1600;
const FIGURE_IMAGE_MAX_BYTES = 1572864;
const FIGURE_IMAGE_LIMIT = 4;
const FIGURE_ROUTE_CAPABILITY_TTL_MS = 30000;
let figureRouteCapabilityCache = null;
const llmFeedbackByMark = new WeakMap();
const llmHighlightInteractions = new WeakSet();

function summarizeExtractedParagraphs(paragraphs) {
    const list = Array.isArray(paragraphs) ? paragraphs : [];
    const typed = typeof SciLLM.summarizeArticleRecords === 'function'
        ? SciLLM.summarizeArticleRecords(list) : null;
    return {
        paragraphCount: typed?.bodyParagraphCount ?? list.length,
        recordCount: typed?.recordCount ?? list.length,
        figureCaptionCount: typed?.figureCaptionCount ?? 0,
        tableCaptionCount: typed?.tableCaptionCount ?? 0,
        referenceCount: typed?.referenceCount ?? 0,
        characterCount: list.reduce((sum, item) =>
            sum + String(item?.text || '').length, 0)
    };
}

function getCachedArticleExtraction() {
    if (!articleExtractionCache ||
        articleExtractionCache.url !== String(globalThis.location?.href || '') ||
        Date.now() - articleExtractionCache.capturedAt > ARTICLE_EXTRACTION_CACHE_TTL_MS) {
        return null;
    }
    return articleExtractionCache.records;
}

function extractArticleWithTrace(source = 'unknown', { forceRefresh = false } = {}) {
    const operationId = extractionTrace.begin({ source, stage: 'extract_article' });
    try {
        const cachedRecords = forceRefresh ? null : getCachedArticleExtraction();
        if (cachedRecords) {
            const cached = cachedRecords.filter(item => item?.recordType !== 'reference' &&
                !['figure-caption', 'table-caption'].includes(item?.recordType));
            lastSuccessfulExtraction = cached;
            extractionTrace.complete(operationId, {
                ...summarizeExtractedParagraphs(cached),
                cacheHit: true
            });
            return cached;
        }
        const records = SciLLM.extractArticle(document, { includeTyped: true });
        const paragraphs = records.filter(item => item?.recordType === 'body');
        lastSuccessfulExtraction = paragraphs;
        articleExtractionCache = {
            url: String(globalThis.location?.href || ''),
            capturedAt: Date.now(),
            records
        };
        extractionTrace.complete(operationId, summarizeExtractedParagraphs(records));
        return paragraphs;
    } catch (error) {
        extractionTrace.fail(operationId, error);
        throw error;
    }
}

function diagnoseArticleWithTrace(source = 'unknown') {
    const operationId = extractionTrace.begin({ source, stage: 'diagnose_article' });
    try {
        const diagnostics = SciLLM.diagnoseArticleExtraction(document);
        extractionTrace.complete(operationId, {
            publisherFamily: diagnostics?.publisherFamily || diagnostics?.publisher?.family || '',
            candidateCount: diagnostics?.candidates?.length || 0
        });
        return diagnostics;
    } catch (error) {
        extractionTrace.fail(operationId, error);
        throw error;
    }
}

function extractArticleStructureWithTrace(source = 'unknown', { forceRefresh = false } = {}) {
    const operationId = extractionTrace.begin({ source, stage: 'extract_structure' });
    try {
        let records = forceRefresh ? null : getCachedArticleExtraction();
        const cacheHit = Boolean(records);
        if (!records) {
            records = SciLLM.extractArticle(document, { includeTyped: true });
            lastSuccessfulExtraction = records.filter(item => item?.recordType === 'body');
            articleExtractionCache = {
                url: String(globalThis.location?.href || ''),
                capturedAt: Date.now(),
                records
            };
        }
        const structure = typeof SciLLM.buildArticleStructureFromRecords === 'function'
            ? SciLLM.buildArticleStructureFromRecords(document, records, {
                locationLike: globalThis.location,
                strategy: cacheHit ? 'cached-records' : 'canonical-records'
            })
            : SciLLM.extractArticleStructure(document, {
                locationLike: globalThis.location
            });
        lastSuccessfulStructure = structure;
        extractionTrace.complete(operationId, {
            headingCount: structure?.diagnostics?.headingCount || 0,
            paragraphCount: structure?.diagnostics?.paragraphCount ||
                structure?.paragraphs?.length || 0,
            publisherFamily: structure?.publisherFamily || '',
            cacheHit
        });
        return structure;
    } catch (error) {
        extractionTrace.fail(operationId, error);
        throw error;
    }
}

function serializeLastExtractionForDiagnostic() {
    return (Array.isArray(lastSuccessfulExtraction) ? lastSuccessfulExtraction : [])
        .map(paragraph => ({
            paragraphId: String(paragraph?.paragraphId || ''),
            sectionId: String(paragraph?.sectionId || ''),
            sectionTitle: String(paragraph?.sectionTitle || ''),
            headingPath: Array.isArray(paragraph?.headingPath)
                ? paragraph.headingPath.map(heading => ({
                    sectionId: String(heading?.sectionId || ''),
                    title: String(heading?.title || ''),
                    level: Number(heading?.level || 0)
                })) : [],
            text: String(paragraph?.text || ''),
            sourceIndex: Number(paragraph?.sourceIndex || 0)
        }));
}

function createInitialFigureAnalysisStatus() {
    return {
        running: false,
        paused: false,
        phase: 'idle',
        currentFigure: 0,
        totalFigures: 0,
        completedFigures: 0,
        failedFigures: 0,
        figureLabel: '',
        message: '',
        failures: [],
        cacheHits: 0,
        visionFallbacks: 0,
        operationId: '',
        startedAt: null,
        updatedAt: Date.now()
    };
}

function throwFigureOperationBusy(requestedFigureId) {
    const active = figureOperationState.active;
    const activeLabel = active?.figureId || active?.mode || figureDepthAnalysisId || 'Figure';
    const error = new Error(`姝ｅ湪绮捐 ${activeLabel}锛岃瀹屾垚鍚庡啀鍒嗘瀽 ${requestedFigureId}`);
    error.code = 'FIGURE_ANALYSIS_BUSY';
    error.requestedFigureId = requestedFigureId;
    error.activeFigureId = active?.figureId || figureDepthAnalysisId;
    error.activeOperationId = active?.operationId || '';
    throw error;
}

function beginFigureOperation(mode, figureId = '') {
    if (figureOperationState.active) throwFigureOperationBusy(figureId || mode);
    const generation = ++figureOperationState.generation;
    const operation = {
        operationId: `figure-${generation}-${Date.now()}`,
        generation,
        mode: mode === 'batch' ? 'batch' : 'single',
        figureId: sanitizeFigureProgressText(figureId, 80),
        paused: false,
        cancelled: false,
        waiters: []
    };
    figureOperationState.active = operation;
    return operation;
}

function isCurrentFigureOperation(operation) {
    const active = figureOperationState.active;
    const operationId = typeof operation === 'string'
        ? operation : operation?.operationId;
    const generation = typeof operation === 'object' ? operation?.generation : null;
    return Boolean(active && operationId && active.operationId === operationId &&
        (generation === null || active.generation === generation));
}

function finishFigureOperation(operation) {
    if (!isCurrentFigureOperation(operation)) return;
    operation.waiters.splice(0).forEach(resolve => resolve());
    figureOperationState.active = null;
    chrome.runtime.sendMessage({
        type: 'LLM_CONTROL_OPERATION',
        operationId: operation.operationId,
        command: 'release'
    }).catch(() => {});
}

function beginLlmHighlightOperation() {
    const generation = ++llmOperationState.generation;
    const operation = {
        operationId: `highlight-${generation}-${Date.now()}`,
        generation,
        paused: false,
        cancelled: false,
        waiters: []
    };
    llmOperationState.active = operation;
    return operation;
}

function finishLlmHighlightOperation(operation) {
    if (llmOperationState.active?.operationId !== operation?.operationId) return;
    operation.waiters.splice(0).forEach(resolve => resolve());
    llmOperationState.active = null;
    chrome.runtime.sendMessage({
        type: 'LLM_CONTROL_OPERATION',
        operationId: operation.operationId,
        command: 'release'
    }).catch(() => {});
}

function cancelledOperationError() {
    const error = new Error('分析已取消，已完成结果会保留');
    error.code = 'CANCELLED';
    return error;
}

async function waitForLocalOperation(operation) {
    if (!operation || operation.cancelled) throw cancelledOperationError();
    if (operation.paused) {
        await new Promise(resolve => operation.waiters.push(resolve));
    }
    if (operation.cancelled) throw cancelledOperationError();
}

async function controlLlmOperation(scope, command) {
    const operation = scope === 'figure'
        ? figureOperationState.active : llmOperationState.active;
    if (!operation) return { success: true, active: false };
    if (command === 'pause') operation.paused = true;
    if (command === 'resume') {
        operation.paused = false;
        operation.waiters.splice(0).forEach(resolve => resolve());
    }
    if (command === 'cancel') {
        operation.cancelled = true;
        operation.paused = false;
        operation.waiters.splice(0).forEach(resolve => resolve());
    }
    if (scope === 'figure') {
        updateFigureAnalysisStatus({
            paused: operation.paused,
            running: !operation.cancelled,
            phase: operation.cancelled ? 'cancelled' : operation.paused ? 'paused' : 'analyzing',
            operationId: operation.operationId,
            message: operation.cancelled
                ? 'Figure 解读已取消，已完成结果会保留。'
                : operation.paused
                    ? '已暂停；当前模型请求结束后不会继续发送新请求。'
                    : '已继续 Figure 解读。'
        });
    }
    const response = await chrome.runtime.sendMessage({
        type: 'LLM_CONTROL_OPERATION',
        operationId: operation.operationId,
        command
    });
    if (!response?.success) {
        const error = new Error(response?.error?.message || '无法控制分析任务');
        error.code = response?.error?.code;
        throw error;
    }
    return { success: true, scope, command, operationId: operation.operationId,
        paused: operation.paused, cancelled: operation.cancelled, active: true };
}

function throwStaleFigureOperation(operation) {
    const error = new Error('FIGURE_ANALYSIS_STALE');
    error.code = 'FIGURE_ANALYSIS_STALE';
    error.operationId = operation?.operationId || '';
    throw error;
}

function sanitizeFigureProgressText(value, maxLength = 160) {
    return String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function sanitizeFigureProgressPanels(value) {
    return (Array.isArray(value) ? value : []).slice(0, 30)
        .map(item => sanitizeFigureProgressText(item, 20).toUpperCase())
        .filter(item => /^[A-Z0-9][A-Z0-9.+-]{0,7}$/.test(item));
}

function sanitizeFigureProgressRoute(route) {
    if (!route || typeof route !== 'object') return null;
    return {
        taskType: sanitizeFigureProgressText(route.taskType, 40),
        requestedProfileId: sanitizeFigureProgressText(route.requestedProfileId, 100),
        effectiveProfileId: sanitizeFigureProgressText(route.effectiveProfileId, 100),
        effectiveProfileName: sanitizeFigureProgressText(route.effectiveProfileName, 120),
        name: sanitizeFigureProgressText(route.name, 120),
        providerId: sanitizeFigureProgressText(route.providerId, 80),
        model: sanitizeFigureProgressText(route.model, 160),
        capabilityMode: sanitizeFigureProgressText(route.capabilityMode, 40),
        fallbackReason: sanitizeFigureProgressText(route.fallbackReason, 160)
    };
}

function sanitizeFigureProgressSnapshot(progress = {}) {
    const expectedPanels = sanitizeFigureProgressPanels(progress.expectedPanels);
    const startedAt = Math.max(0, Math.floor(Number(progress.startedAt) || 0)) || null;
    const recognizedPanelCount = Number.isFinite(Number(progress.recognizedPanelCount))
        ? Math.max(0, Math.min(30, Math.floor(Number(progress.recognizedPanelCount))))
        : null;
    return {
        figureId: sanitizeFigureProgressText(progress.figureId, 80),
        figureLabel: sanitizeFigureProgressText(progress.figureLabel, 120),
        expectedPanels,
        expectedPanelCount: Math.max(0, Math.min(30,
            Math.floor(Number(progress.expectedPanelCount) || expectedPanels.length))),
        recognizedPanelCount,
        panelBatchIndex: Math.max(0, Math.floor(Number(progress.panelBatchIndex) || 0)),
        completedPanelBatches: Math.max(0, Math.floor(Number(progress.completedPanelBatches) || 0)),
        totalPanelBatches: Math.max(0, Math.floor(Number(progress.totalPanelBatches) || 0)),
        phase: sanitizeFigureProgressText(progress.phase, 80) || 'preparing',
        running: progress.running === true,
        completed: progress.completed === true,
        failed: progress.failed === true,
        cancelled: progress.cancelled === true,
        operationId: sanitizeFigureProgressText(progress.operationId, 100),
        completedFigures: Math.max(0, Math.floor(Number(progress.completedFigures) || 0)),
        totalFigures: Math.max(0, Math.floor(Number(progress.totalFigures) || 0)),
        cacheHit: progress.cacheHit === true,
        visionFallback: progress.visionFallback === true,
        basis: sanitizeFigureProgressText(progress.basis, 80),
        attempt: Math.max(0, Math.floor(Number(progress.attempt) || 0)),
        waitMs: Math.max(0, Math.floor(Number(progress.waitMs) || 0)),
        errorCode: sanitizeFigureProgressText(progress.errorCode, 80),
        providerId: sanitizeFigureProgressText(progress.providerId, 80),
        model: sanitizeFigureProgressText(progress.model, 160),
        capabilityMode: sanitizeFigureProgressText(progress.capabilityMode, 40),
        route: sanitizeFigureProgressRoute(progress.route),
        startedAt,
        elapsedSeconds: startedAt ? Math.max(0, Math.floor((Date.now() - startedAt) / 1000)) : 0,
        updatedAt: Math.max(0, Math.floor(Number(progress.updatedAt) || 0)) || Date.now()
    };
}

function updateFigureProgress(figureId, patch = {}) {
    const normalizedId = sanitizeFigureProgressText(figureId || patch.figureId, 80);
    if (!normalizedId) return null;
    const previous = figureProgressById.get(normalizedId) || {};
    const requestedOperationId = sanitizeFigureProgressText(
        patch.operationId || previous.operationId || figureOperationState.active?.operationId,
        100
    );
    if (patch.operationId && !isCurrentFigureOperation(patch.operationId)) return null;
    const phase = sanitizeFigureProgressText(patch.phase || previous.phase, 80) || 'preparing';
    const terminal = phase === 'figure' || phase === 'failed' || phase === 'cancelled';
    const next = sanitizeFigureProgressSnapshot({
        ...previous,
        ...patch,
        figureId: normalizedId,
        expectedPanels: patch.expectedPanels === undefined
            ? previous.expectedPanels : patch.expectedPanels,
        expectedPanelCount: patch.expectedPanelCount === undefined
            ? previous.expectedPanelCount : patch.expectedPanelCount,
        startedAt: patch.resetStartedAt === true
            ? (patch.startedAt || Date.now())
            : (previous.startedAt || patch.startedAt || Date.now()),
        phase,
        operationId: requestedOperationId,
        running: patch.running === undefined ? !terminal : patch.running,
        completed: patch.completed === undefined ? (phase === 'figure' || previous.completed === true)
            : patch.completed,
        failed: patch.failed === undefined ? (phase === 'failed' || previous.failed === true)
            : patch.failed,
        cancelled: patch.cancelled === undefined
            ? (phase === 'cancelled' || previous.cancelled === true)
            : patch.cancelled,
        updatedAt: Date.now()
    });
    figureProgressById.set(normalizedId, next);
    return next;
}

function getFigureProgressSnapshot() {
    return [...figureProgressById.values()]
        .map(item => sanitizeFigureProgressSnapshot(item))
        .sort((left, right) => {
            const leftStarted = Number(left.startedAt) || 0;
            const rightStarted = Number(right.startedAt) || 0;
            return leftStarted - rightStarted || left.figureId.localeCompare(right.figureId);
        });
}

function formatFigureProgressMessage(progress = {}) {
    const label = progress.figureLabel || progress.figureId || 'Figure';
    const position = progress.totalFigures > 0
        ? `（${Math.min(progress.completedFigures + (progress.completed ? 0 : 1), progress.totalFigures)}/${progress.totalFigures}）`
        : '';
    if (progress.phase === 'caption_text_only') {
        return `${label}${position}：当前模型仅使用图注与正文证据。`;
    }
    if (progress.phase === 'figure_fallback') {
        return `${label}${position}：视觉输入未被接受，正回退到图注与正文。`;
    }
    if (progress.phase === 'figure_retry') {
        const seconds = Math.max(1, Math.ceil((Number(progress.waitMs) || 0) / 1000));
        return `${label}${position}：请求暂时失败，${seconds} 秒后自动重试。`;
    }
    if (progress.phase === 'token_limit_retry') return `${label}${position}：正在调整输出令牌上限后重试。`;
    if (progress.phase === 'output_token_retry') return `${label}${position}：正在增加输出令牌后重试。`;
    if (progress.phase === 'output_compact_retry') return `${label}${position}：输出过长，正改用紧凑 JSON 重试。`;
    if (progress.phase === 'figure_schema_retry') return `${label}${position}：返回结构不完整，正在按精确字段要求重试。`;
    if (progress.phase === 'figure_panel_batch_complete') {
        return `${label}${position}：已完成 Panel 分批 ${progress.completedPanelBatches}/${progress.totalPanelBatches}，正在继续下一批。`;
    }
    if (progress.phase === 'figure_synthesizing') {
        return `${label}${position}：Panel 已提取，正在综合整图证据链。`;
    }
    if (progress.phase === 'figure_synthesis_complete') {
        return `${label}${position}：整图证据链综合完成。`;
    }
    if (progress.phase === 'cancelled') {
        return `${label}${position}：Figure 解读已取消。`;
    }
    const phaseText = {
        preparing: '正在准备图片与上下文',
        figure_requesting: '正在发送 Figure 请求',
        figure_model_processing: '模型正在处理 Figure',
        figure_response_received: '已收到模型响应，等待校验',
        figure_validating: '正在校验返回结构',
        figure_assembling: '正在整理 Figure 解读',
        figure_panel_batch_complete: '已保存当前 Panel 分批结果',
        figure_synthesizing: '正在综合整图证据链',
        figure_synthesis_complete: '整图证据链综合完成',
        provider_telemetry: '模型已返回，正在读取完成状态',
        figure_schema_retry: '正在修正模型返回结构',
        figure: 'Figure 解读已完成',
        failed: 'Figure 解读失败'
    }[progress.phase] || '正在处理 Figure';
    return `${label}${position}：${phaseText}。`;
}

function applyFigureProgressEvent(progress = {}) {
    const figureId = sanitizeFigureProgressText(progress.figureId, 80);
    if (!figureId) return null;
    const operationId = sanitizeFigureProgressText(progress.operationId, 100);
    if ((operationId && !isCurrentFigureOperation(operationId)) ||
        (!operationId && figureOperationState.active)) return null;
    const phase = sanitizeFigureProgressText(progress.phase, 80) || 'preparing';
    const partialResult = progress.partialFigureResult || progress.figureResult;
    if (partialResult && typeof partialResult === 'object') {
        const state = figureWalkthroughState.get(figureId);
        const depth = partialResult.analysisDepth === 'standard' ? 'standard' : 'deep';
        if (state && Array.isArray(partialResult.panels)) {
            state[depth] = { ...partialResult, operationId };
            state.activeDepth = depth;
            state.standardError = '';
            state.deepError = '';
        }
    }
    const entry = updateFigureProgress(figureId, {
        ...progress,
        phase,
        running: phase !== 'figure' && phase !== 'failed' && phase !== 'cancelled',
        completed: phase === 'figure',
        failed: phase === 'failed',
        cancelled: phase === 'cancelled'
    });
    const entries = getFigureProgressSnapshot();
    const completedFigures = Math.max(
        Number(progress.completedFigures) || 0,
        entries.filter(item => item.completed).length
    );
    const failedFigures = entries.filter(item => item.failed).length;
    updateFigureAnalysisStatus({
        phase,
        currentFigure: Math.max(0, Math.min(
            Number(progress.totalFigures) || figureAnalysisStatus.totalFigures || entries.length,
            (Number(progress.completedFigures) || 0) + (phase === 'figure' ? 0 : 1)
        )),
        totalFigures: Number(progress.totalFigures) || figureAnalysisStatus.totalFigures || entries.length,
        completedFigures,
        failedFigures,
        figureLabel: entry.figureLabel,
        message: formatFigureProgressMessage(entry),
        route: entry.route,
        providerId: entry.providerId,
        model: entry.model,
        capabilityMode: entry.capabilityMode
    });
    return entry;
}

function updateFigureAnalysisStatus(patch = {}) {
    if (patch.operationId && !isCurrentFigureOperation(patch.operationId)) {
        return figureAnalysisStatus;
    }
    const nextFailures = Array.isArray(patch.failures)
        ? patch.failures.slice(-20).map(item => ({
            figureId: String(item?.figureId || '').slice(0, 120),
            figureLabel: String(item?.figureLabel || '').slice(0, 120),
            code: String(item?.code || 'FIGURE_FAILED').slice(0, 80),
            message: String(item?.message || 'Figure 解读失败').slice(0, 500)
        }))
        : figureAnalysisStatus.failures;
    figureAnalysisStatus = {
        ...figureAnalysisStatus,
        ...patch,
        operationId: sanitizeFigureProgressText(
            patch.operationId || figureOperationState.active?.operationId ||
                figureAnalysisStatus.operationId,
            100
        ),
        failures: nextFailures,
        updatedAt: Date.now()
    };
    return figureAnalysisStatus;
}

function getPublicFigureAnalysisStatus() {
    const figureProgress = getFigureProgressSnapshot();
    const activeOperation = figureOperationState.active;
    return {
        ...figureAnalysisStatus,
        running: Boolean(activeOperation && !activeOperation.cancelled),
        paused: activeOperation?.paused === true,
        canPause: Boolean(activeOperation && !activeOperation.cancelled),
        operationId: activeOperation?.operationId || figureAnalysisStatus.operationId,
        failures: figureAnalysisStatus.failures.map(item => ({ ...item })),
        figureProgress,
        figureProgressById: Object.fromEntries(
            figureProgress.map(item => [item.figureId, { ...item }])
        )
    };
}

function createInitialReviewOutlineStatus() {
    return {
        running: false,
        phase: 'idle',
        completedParagraphs: 0,
        totalParagraphs: 0,
        completedChunks: 0,
        totalChunks: 0,
        message: '',
        globalSynthesisAvailable: null,
        updatedAt: Date.now()
    };
}

function updateReviewOutlineStatus(patch = {}) {
    reviewOutlineStatus = {
        ...reviewOutlineStatus,
        ...patch,
        updatedAt: Date.now()
    };
    return reviewOutlineStatus;
}

function getPublicReviewOutlineStatus() {
    return { ...reviewOutlineStatus };
}

function closeReadingPanel() {
    document.getElementById('sci-reading-panel')?.remove();
}

function closeArticleNavigationPanels() {
    document.getElementById('sci-article-navigator-host')?.remove();
    document.getElementById('sci-review-outline-host')?.remove();
    document.getElementById('sci-review-outline-panel')?.remove();
}

function clearLlmHighlights() {
    closeLlmFeedbackPopover();
    document.querySelectorAll('.sci-llm-highlight').forEach(mark => {
        const parent = mark.parentNode;
        if (!parent) return;
        while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
        parent.removeChild(mark);
        parent.normalize();
    });
    document.getElementById('sci-llm-status')?.remove();
    closeReadingPanel();
}

function collectLlmTextNodes(element) {
    const nodes = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) nodes.push(node);
    return nodes;
}

function locateRawOffset(nodes, rawOffset) {
    let cursor = 0;
    for (const node of nodes) {
        const next = cursor + node.textContent.length;
        if (rawOffset <= next) return { node, offset: Math.max(0, rawOffset - cursor) };
        cursor = next;
    }
    return null;
}

function rangesOverlap(first, second) {
    return first.start < second.end && second.start < first.end;
}

function annotationIdsForMark(mark) {
    return String(mark?.dataset?.annotationIds || '').split(',').filter(Boolean);
}

function relationIdsForMark(mark) {
    return String(mark?.dataset?.relationIds || '').split(',').filter(Boolean);
}

function bindLlmHighlightInteraction(mark) {
    if (!mark || llmHighlightInteractions.has(mark)) return;
    llmHighlightInteractions.add(mark);
    mark.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        showHighlightContextPopover(mark);
    });
    mark.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        event.stopPropagation();
        showHighlightContextPopover(mark);
    });
}

function focusRelatedHighlights({ annotationIds = [], relationId = '' }) {
    const annotationSet = new Set(annotationIds);
    const marks = [...document.querySelectorAll('.sci-llm-highlight')].filter(mark =>
        annotationIdsForMark(mark).some(id => annotationSet.has(id)) ||
        (relationId && relationIdsForMark(mark).includes(relationId))
    );
    marks.forEach(mark => {
        mark.classList.add('sci-llm-related-focus');
        setTimeout(() => mark.classList.remove('sci-llm-related-focus'), 1800);
    });
    marks[0]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function appendPanelList(section, items, renderItem) {
    if (!items.length) return;
    const list = document.createElement('div');
    list.className = 'sci-reading-list';
    items.forEach(item => list.appendChild(renderItem(item)));
    section.appendChild(list);
}

function createPanelButton(label, clickHandler) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sci-reading-item';
    button.textContent = label;
    button.addEventListener('click', clickHandler);
    return button;
}

function prependUiIcon(element, iconName) {
    if (!element || !iconName) return element;
    const icon = document.createElement('i');
    icon.className = `ph ph-${iconName}`;
    icon.setAttribute('aria-hidden', 'true');
    element.prepend(icon);
    return element;
}

function setIconButtonLabel(button, iconName, label) {
    button.replaceChildren();
    prependUiIcon(button, iconName);
    button.append(document.createTextNode(label));
}

function formatEvidenceStrength(value) {
    return ({
        strong: '证据强',
        moderate: '证据中等',
        weak: '证据有限'
    })[String(value || '').toLowerCase()] || '证据待定';
}

function appendReadingSectionTitle(section, label, count) {
    const heading = document.createElement('div');
    heading.className = 'sci-reading-section-title';
    heading.textContent = `${label}（${count}）`;
    section.appendChild(heading);
}

function renderReadingPanel(analysis) {
    closeReadingPanel();
    closeArticleNavigationPanels();
    const ledger = analysis?.ledger;
    const hasContent = ledger && (
        ledger.relationSummaries?.length || ledger.reviewWarnings?.length || ledger.auditItems?.length
    );
    if (!hasContent) return;

    const viewNames = {
        quick_story: '快速主线',
        mechanism_chain: '机制证据链',
        critical_review: '批判性审读'
    };
    const panel = document.createElement('aside');
    panel.id = 'sci-reading-panel';
    panel.setAttribute('aria-label', '论文阅读视图');

    const header = document.createElement('div');
    header.className = 'sci-reading-header';
    const title = document.createElement('strong');
    title.textContent = viewNames[analysis.readingViewId] || '论文证据台账';
    const actions = document.createElement('div');
    actions.className = 'sci-reading-actions';
    const toggle = document.createElement('button');
    toggle.type = 'button';
    setIconButtonLabel(toggle, 'caret-up', '收起');
    toggle.setAttribute('aria-expanded', 'true');
    toggle.addEventListener('click', () => {
        panel.classList.toggle('collapsed');
        const collapsed = panel.classList.contains('collapsed');
        setIconButtonLabel(toggle, collapsed ? 'caret-down' : 'caret-up', collapsed ? '展开' : '收起');
        toggle.setAttribute('aria-expanded', String(!collapsed));
    });
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'sci-reading-close';
    close.textContent = '关闭';
    close.setAttribute('aria-label', '关闭论文证据台账');
    close.addEventListener('click', closeReadingPanel);
    actions.append(toggle, close);
    header.append(title, actions);
    panel.appendChild(header);

    const body = document.createElement('div');
    body.className = 'sci-reading-body';
    const profile = analysis.studyProfile;
    if (profile) {
        const summary = document.createElement('div');
        summary.className = 'sci-reading-profile';
        const primaryTypeName = profile.primaryTypeName || profile.primaryType;
        summary.textContent = `研究类型：${primaryTypeName}`;
        body.appendChild(summary);
    }

    const relationSummaries = ledger.relationSummaries || [];
    if (relationSummaries.length) appendReadingSectionTitle(body, '核心证据', relationSummaries.length);
    appendPanelList(body, relationSummaries, relation =>
        createPanelButton(
            `${relation.labelZh} · ${(relation.annotationIds || []).length}条证据 · ` +
                formatEvidenceStrength(relation.evidenceStrength),
            () => focusRelatedHighlights({
                annotationIds: relation.annotationIds,
                relationId: relation.relationId
            })
        )
    );

    const reviewWarnings = ledger.reviewWarnings || [];
    if (reviewWarnings.length) appendReadingSectionTitle(body, '审读提醒', reviewWarnings.length);
    appendPanelList(body, reviewWarnings, warning => {
        const button = createPanelButton(
            `${warning.reasonZh}（${Math.round(warning.confidence * 100)}%）`,
            () => focusRelatedHighlights({
                annotationIds: [
                    ...(warning.claimAnnotationIds || []),
                    ...(warning.evidenceAnnotationIds || [])
                ]
            })
        );
        button.classList.add('warning');
        prependUiIcon(button, 'warning');
        return button;
    });

    const auditItems = ledger.auditItems || [];
    if (auditItems.length) {
        const auditDetails = document.createElement('details');
        auditDetails.className = 'sci-reading-audit-details';
        auditDetails.open = analysis.readingViewId === 'critical_review';
        const auditSummary = document.createElement('summary');
        auditSummary.textContent = `待核查信息（${auditItems.length}）`;
        auditDetails.appendChild(auditSummary);
        appendPanelList(auditDetails, auditItems, item => {
            const row = document.createElement('div');
            row.className = 'sci-reading-audit-item';
            const message = String(item.messageZh || '').trim();
            row.textContent = message.startsWith('待核查：') ? message : `待核查：${message}`;
            return row;
        });
        body.appendChild(auditDetails);
    }

    panel.appendChild(body);
    document.documentElement.appendChild(panel);
}

function applyLlmHighlights(annotations, analysisMeta = {}) {
    clearLlmHighlights();
    const categoryMap = SciLLM.createBuiltInCategories();
    (Array.isArray(analysisMeta.categories) ? analysisMeta.categories : []).forEach(category => {
        categoryMap[category.categoryId] = category;
    });
    const paragraphMetadata = new Map(
        (Array.isArray(analysisMeta.paragraphs) ? analysisMeta.paragraphs : [])
            .map(paragraph => [paragraph.paragraphId, paragraph])
    );
    const elements = new Map(
        [...document.querySelectorAll('[data-sci-llm-paragraph-id]')]
            .map(element => [element.dataset.sciLlmParagraphId, element])
    );
    const byParagraph = new Map();
    (Array.isArray(annotations) ? annotations : []).forEach(annotation => {
        const items = byParagraph.get(annotation.paragraphId) || [];
        items.push(annotation);
        byParagraph.set(annotation.paragraphId, items);
    });

    const counts = {};
    let highlightedCount = 0;
    let rejectedCount = 0;

    byParagraph.forEach((items, paragraphId) => {
        const element = elements.get(paragraphId);
        if (!element) {
            rejectedCount += items.length;
            return;
        }
        const acceptedRanges = [];
        items.sort((a, b) => b.start - a.start).forEach(annotation => {
            if (acceptedRanges.some(range => rangesOverlap(range, annotation))) {
                rejectedCount += 1;
                return;
            }
            const nodes = collectLlmTextNodes(element);
            const rawText = nodes.map(node => node.textContent).join('');
            const normalized = SciLLM.normalizeTextWithOffsets(rawText);
            if (normalized.text.slice(annotation.start, annotation.end) !== annotation.quote ||
                annotation.start < 0 || annotation.end <= annotation.start) {
                rejectedCount += 1;
                return;
            }
            const rawStart = normalized.rawStarts[annotation.start];
            const rawEnd = normalized.rawEnds[annotation.end - 1];
            const start = locateRawOffset(nodes, rawStart);
            const end = locateRawOffset(nodes, rawEnd);
            if (!start || !end) {
                rejectedCount += 1;
                return;
            }

            const categories = Array.isArray(annotation.categories) ? annotation.categories : [];
            const primary = categoryMap[categories[0]?.categoryId] || {
                name: categories[0]?.categoryId || 'LLM 标注',
                color: '#8EC5FF'
            };
            const mark = document.createElement('mark');
            mark.className = 'sci-llm-highlight';
            mark.tabIndex = 0;
            mark.setAttribute('role', 'button');
            mark.dataset.source = 'llm';
            mark.dataset.categoryId = categories[0]?.categoryId || '';
            mark.dataset.categories = categories.map(item => item.categoryId).join(',');
            mark.dataset.annotationIds = categories.map(item => item.annotationId).filter(Boolean).join(',');
            mark.dataset.relationIds = categories.map(item => item.relationId).filter(Boolean).join(',');
            if (categories.some(item => item.claimMode === 'inferred')) {
                mark.classList.add('sci-llm-inferred-warning');
            }
            mark.style.borderBottomColor = primary.color;
            mark.title = categories.map(item => {
                const category = categoryMap[item.categoryId] || { name: item.categoryId };
                const confidence = Number.isFinite(item.confidence) ? ` ${Math.round(item.confidence * 100)}%` : '';
                const mode = item.claimMode === 'inferred' ? 'AI 推断警示' : '作者明确陈述';
                const role = item.quoteRole ? ` · ${item.quoteRole}` : '';
                const slots = (item.slots || []).map(slot => `${slot.name}=${slot.value}`).join('；');
                return `${category.name}${confidence} · ${mode}${role}` +
                    `${item.reasonZh ? `：${item.reasonZh}` : ''}` +
                    `${slots ? `\n${slots}` : ''}`;
            }).join('\n');
            mark.setAttribute(
                'aria-label',
                `${primary.name}高亮：${annotation.quote.slice(0, 100)}。按回车可提供反馈`
            );

            const primaryRelation = categories[0] || {};
            const metadata = paragraphMetadata.get(paragraphId) || {};
            llmFeedbackByMark.set(mark, {
                documentHash: analysisMeta.documentHash || '',
                paragraphId,
                sectionTitle: metadata.sectionTitle || '',
                contextBefore: normalized.text.slice(Math.max(0, annotation.start - 240), annotation.start),
                quote: annotation.quote,
                contextAfter: normalized.text.slice(annotation.end, annotation.end + 240),
                categoryId: primaryRelation.categoryId || '',
                confidence: primaryRelation.confidence,
                reasonZh: primaryRelation.reasonZh || '',
                availableCategories: Object.values(categoryMap).map(category => ({
                    categoryId: category.categoryId,
                    name: category.name
                }))
            });
            bindLlmHighlightInteraction(mark);

            const range = document.createRange();
            range.setStart(start.node, start.offset);
            range.setEnd(end.node, end.offset);
            mark.appendChild(range.extractContents());
            range.insertNode(mark);
            acceptedRanges.push({ start: annotation.start, end: annotation.end });
            highlightedCount += 1;
            categories.forEach(item => {
                counts[item.categoryId] = (counts[item.categoryId] || 0) + 1;
            });
        });
    });

    return { highlightedCount, rejectedCount, counts };
}

function renderLlmAnalysis(rawAnalysis, paragraphs, threshold, extractionDiagnostics) {
    const filtered = SciLLM.filterAnnotationGroupsByConfidence(
        rawAnalysis.annotations,
        threshold
    );
    const applied = applyLlmHighlights(filtered.annotations, {
        ...rawAnalysis,
        paragraphs
    });
    lastLlmAnalysis = { rawAnalysis, paragraphs, extractionDiagnostics, threshold: filtered.threshold };
    lastLlmDiagnostics = {
        extraction: extractionDiagnostics,
        stage: 'complete',
        annotationCount: Array.isArray(rawAnalysis.annotations) ? rawAnalysis.annotations.length : 0,
        providerRejectedCount: Array.isArray(rawAnalysis.rejected) ? rawAnalysis.rejected.length : 0,
        semanticRejectedCount: rawAnalysis.semanticRejectedCount || 0,
        confidenceThreshold: filtered.threshold,
        hiddenConfidenceCount: filtered.hiddenCount,
        highlightedCount: applied.highlightedCount,
        rejectedCount: applied.rejectedCount,
        studyProfile: rawAnalysis.studyProfile || null,
        readingViewId: rawAnalysis.readingViewId || '',
        profileCacheHit: Boolean(rawAnalysis.profileCacheHit),
        ledgerAvailable: rawAnalysis.ledger?.available !== false,
        ledgerCacheHit: Boolean(rawAnalysis.ledgerCacheHit),
        relationCount: rawAnalysis.ledger?.relationSummaries?.length || 0,
        auditItemCount: rawAnalysis.ledger?.auditItems?.length || 0
    };
    return { ...applied, ...filtered };
}

function renderProgressiveLlmChunk(progress = {}) {
    const state = llmProgressiveAnalysis;
    const checkpointAnnotations = Array.isArray(progress.checkpointAnnotations)
        ? progress.checkpointAnnotations : [];
    if (!state || !checkpointAnnotations.length) return null;
    const prior = Array.isArray(state.rawAnalysis.annotations)
        ? state.rawAnalysis.annotations : [];
    state.rawAnalysis.annotations = typeof SciLLM.mergeAnnotations === 'function'
        ? SciLLM.mergeAnnotations([...prior, ...checkpointAnnotations])
        : [...prior, ...checkpointAnnotations];
    state.rawAnalysis.rejected = [
        ...(Array.isArray(state.rawAnalysis.rejected) ? state.rawAnalysis.rejected : []),
        ...(Array.isArray(progress.checkpointRejected) ? progress.checkpointRejected : [])
    ];
    const filtered = SciLLM.filterAnnotationGroupsByConfidence(
        state.rawAnalysis.annotations,
        state.threshold
    );
    const applied = applyLlmHighlights(filtered.annotations, {
        ...state.rawAnalysis,
        paragraphs: state.paragraphs
    });
    // Keep the normal feedback and archive paths usable while the later
    // chunks are still running. The final response replaces this partial view.
    lastLlmAnalysis = {
        rawAnalysis: state.rawAnalysis,
        paragraphs: state.paragraphs,
        extractionDiagnostics: state.extractionDiagnostics,
        threshold: filtered.threshold
    };
    lastLlmDiagnostics = {
        extraction: state.extractionDiagnostics,
        stage: 'streaming',
        annotationCount: state.rawAnalysis.annotations.length,
        providerRejectedCount: state.rawAnalysis.rejected.length,
        confidenceThreshold: filtered.threshold,
        hiddenConfidenceCount: filtered.hiddenCount,
        highlightedCount: applied.highlightedCount,
        rejectedCount: applied.rejectedCount
    };
    return { ...applied, ...filtered };
}

function closeLlmFeedbackPopover() {
    document.getElementById('sci-llm-feedback')?.remove();
    document.getElementById('sci-highlight-context-popover')?.remove();
}

async function recordLlmFeedback(mark, userAction, correctedCategoryId = '') {
    const sample = llmFeedbackByMark.get(mark);
    if (!sample) return;
    const response = await chrome.runtime.sendMessage({
        type: 'LLM_RECORD_FEEDBACK',
        sample: { ...sample, userAction, correctedCategoryId }
    });
    if (!response?.success) {
        showLlmPageStatus(response?.error?.message || '反馈保存失败', 'error');
        return;
    }

    mark.classList.remove('feedback-accepted', 'feedback-rejected', 'feedback-corrected');
    mark.classList.add(`feedback-${userAction}`);
    mark.dataset.feedback = userAction;
    closeLlmFeedbackPopover();
    showLlmPageStatus(
        response.data.suggestExport
            ? '已积累多篇已确认语料，可在 API 设置页导出语料或生成离线规则'
            : '反馈已保存到本地语料库',
        'success'
    );
    setTimeout(() => showLlmPageStatus(null), 4500);
}

function showLlmFeedbackPopover(mark) {
    showHighlightContextPopover(mark);
}

// Manual annotation UI: start
const MANUAL_MORE_RENDER_LIMIT = 40;
const MANUAL_UNRESOLVED_RENDER_LIMIT = 20;
const MANUAL_CONTEXT_CATEGORY_LIMIT = 100;
const MANUAL_FORBIDDEN_SCAN_LIMIT = 600;
const MANUAL_UI_SELECTOR = [
    '#sci-manual-toolbar', '#sci-highlight-context-popover', '#sci-manual-status',
    '#sci-reading-panel', '#sci-review-outline-panel', '.sci-figure-walkthrough',
    '.sci-figure-badge', '[data-sci-plugin-ui]'
].join(',');
const MANUAL_BLOCKED_SELECTOR = [
    'input', 'textarea', 'select', 'option', 'button', 'pre', 'code',
    '[contenteditable]:not([contenteditable="false"])', '[role="textbox"]'
].join(',');
const MANUAL_CLEAR_COMPLETION_TYPE = 'ANNOTATION_CLEAR_DOCUMENT';
const manualUiLifecycle = ManualAnnotationUiHelpers.createManualUiLifecycle();
let currentManualDocument = null;
let currentManualBlocks = [];
let currentManualCategories = [];
let currentManualActiveCategories = [];
let currentManualUnresolved = [];
let currentManualSelection = null;
let currentManualRebindId = '';
let manualSelectionTimer = null;
let manualPrepareTimer = null;
let manualPreparePromise = null;
let manualPreparedHref = '';
let manualStatusTimer = null;
let manualPointerSelecting = false;
let manualPrepareSequence = 0;
let manualRestoreFocus = null;
let sidePanelRestoreArmed = false;

function disarmSidePanelRestore() {
    sidePanelRestoreArmed = false;
    document.removeEventListener('pointerdown', restoreSidePanelFromUserGesture, true);
    document.removeEventListener('keydown', restoreSidePanelFromUserGesture, true);
    document.getElementById('sci-side-panel-restore')?.remove();
}

function restoreSidePanelFromUserGesture(event) {
    if (!sidePanelRestoreArmed || event?.isTrusted === false) return;
    if (event?.type === 'keydown' && ['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) return;
    disarmSidePanelRestore();
    chrome.runtime.sendMessage({ type: 'SIDE_PANEL_RESTORE_FROM_USER_GESTURE' })
        .then(response => {
            if (!response?.success) armSidePanelRestore();
        })
        .catch(() => armSidePanelRestore());
}

function armSidePanelRestore() {
    if (sidePanelRestoreArmed) return true;
    sidePanelRestoreArmed = true;
    document.addEventListener('pointerdown', restoreSidePanelFromUserGesture, true);
    document.addEventListener('keydown', restoreSidePanelFromUserGesture, true);
    let button = document.getElementById('sci-side-panel-restore');
    if (!button) {
        button = document.createElement('button');
        button.id = 'sci-side-panel-restore';
        button.type = 'button';
        button.dataset.sciPluginUi = 'true';
        button.textContent = '恢复论文侧栏';
        button.setAttribute('aria-label', '恢复此论文页面的插件侧栏');
        button.title = 'Edge 暂时隐藏了此标签页的侧栏，点击即可恢复';
        document.documentElement.appendChild(button);
    }
    return true;
}

function manualElementForNode(node) {
    if (!node) return null;
    return node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
}

function manualClosest(node, selector) {
    return manualElementForNode(node)?.closest?.(selector) || null;
}

function manualCssEscape(value) {
    return globalThis.CSS?.escape
        ? CSS.escape(String(value))
        : String(value).replace(/["\\]/g, '\\$&');
}

function manualReadableText(root) {
    if (!root) return '';
    const nodes = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: node => manualClosest(node, MANUAL_UI_SELECTOR)
            ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
    });
    let node;
    while ((node = walker.nextNode())) nodes.push(node.textContent || '');
    return nodes.join('');
}

function collectManualTextNodes(root) {
    const nodes = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: node => manualClosest(node, MANUAL_UI_SELECTOR)
            ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
    });
    let node;
    while ((node = walker.nextNode())) nodes.push(node);
    return nodes;
}

function manualBoundaryOffset(block, container, offset) {
    const before = document.createRange();
    before.selectNodeContents(block);
    before.setEnd(container, offset);
    return before.toString().length;
}

function locateManualDomOffset(nodes, rawOffset) {
    let cursor = 0;
    for (const node of nodes) {
        const next = cursor + node.textContent.length;
        if (rawOffset <= next) return { node, offset: Math.max(0, rawOffset - cursor) };
        cursor = next;
    }
    return null;
}

function findManualBlockElement(blockId) {
    return document.querySelector(
        `[data-sci-llm-paragraph-id="${manualCssEscape(blockId)}"]`
    );
}

function findManualBlock(node) {
    const element = manualClosest(node, '[data-sci-llm-paragraph-id]');
    if (!element) return null;
    const blockId = element.dataset.sciLlmParagraphId;
    const existing = currentManualBlocks.find(block => block.blockId === blockId);
    if (existing) return existing;
    const structureParagraph = currentArticleStructure?.paragraphs?.find(paragraph =>
        paragraph?.sourceKey === blockId || paragraph?.paragraphId === blockId);
    const block = {
        blockId,
        paragraphId: blockId,
        blockFingerprint: blockId,
        sectionTitle: String(structureParagraph?.sectionTitle || ''),
        text: manualReadableText(element),
        element
    };
    if (!block.text.trim()) return null;
    currentManualBlocks.push(block);
    manualUiLifecycle.retain({ blocks: currentManualBlocks });
    return block;
}

function getManualDocumentInputAndBlocks() {
    const extracted = extractArticleWithTrace('manual_annotations');
    const paragraphs = extracted.map(({ sourceIndex, ...paragraph }) => paragraph);
    const blocks = paragraphs.map(paragraph => {
        const element = findManualBlockElement(paragraph.paragraphId);
        return {
            blockId: paragraph.paragraphId,
            paragraphId: paragraph.paragraphId,
            blockFingerprint: paragraph.paragraphId,
            sectionTitle: paragraph.sectionTitle || '',
            text: element ? manualReadableText(element) : String(paragraph.text || ''),
            element
        };
    }).filter(block => block.element && block.text.trim());
    const canonicalUrl = document.querySelector('link[rel="canonical"]')?.href || location.href;
    const doi = document.querySelector(
        'meta[name="citation_doi"],meta[name="dc.identifier"],meta[name="DC.Identifier"]'
    )?.content || '';
    return {
        input: { title: document.title, canonicalUrl, doi, paragraphs },
        blocks
    };
}

async function sendManualMessage(message) {
    const response = await chrome.runtime.sendMessage(message);
    if (!response?.success) {
        throw new Error(response?.error?.message || '手动标注操作失败');
    }
    return response.data;
}

function normalizeManualUiCategory(category) {
    const categoryId = String(category?.categoryId || '');
    const name = String(category?.name || categoryId || '未命名类别').slice(0, 200);
    const color = /^#[0-9a-f]{6}$/i.test(String(category?.color || ''))
        ? String(category.color).toUpperCase() : '#F2D978';
    return { ...category, categoryId, name, color };
}

function uniqueManualCategories(categories) {
    const seen = new Set();
    return (Array.isArray(categories) ? categories : []).map(normalizeManualUiCategory)
        .filter(category => {
            if (!category.categoryId || category.retired === true || seen.has(category.categoryId)) {
                return false;
            }
            seen.add(category.categoryId);
            return true;
        });
}

function showManualStatus(message, type = 'info', persistent = false) {
    clearTimeout(manualStatusTimer);
    manualStatusTimer = null;
    let status = document.getElementById('sci-manual-status');
    if (!message) {
        status?.remove();
        return;
    }
    if (!status) {
        status = document.createElement('div');
        status.id = 'sci-manual-status';
        status.dataset.sciPluginUi = 'true';
        status.setAttribute('role', type === 'error' ? 'alert' : 'status');
        status.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
        document.documentElement.appendChild(status);
    }
    status.className = type;
    status.textContent = message;
    if (!persistent) {
        const expected = message;
        manualStatusTimer = setTimeout(() => {
            manualStatusTimer = null;
            if (status.textContent === expected) status.remove();
        }, 4200);
    }
}

function closeManualSelectionToolbar() {
    document.getElementById('sci-manual-toolbar')?.remove();
    currentManualSelection = null;
    manualUiLifecycle.retain({ selection: null });
}

function closeHighlightContextPopover({ restoreFocus = false } = {}) {
    document.getElementById('sci-highlight-context-popover')?.remove();
    if (restoreFocus && manualRestoreFocus?.isConnected) manualRestoreFocus.focus();
    manualRestoreFocus = null;
}

function closeManualTransientUi(options = {}) {
    closeManualSelectionToolbar();
    closeHighlightContextPopover(options);
}

function clearManualBrowserSelection() {
    const selection = document.getSelection?.();
    if (selection?.rangeCount) selection.removeAllRanges();
    currentManualSelection = null;
    manualUiLifecycle.retain({ selection: null });
}

function clearManualHighlightMarks() {
    closeManualTransientUi();
    document.querySelectorAll('.sci-manual-note-marker').forEach(marker => marker.remove());
    document.querySelectorAll('.sci-manual-highlight').forEach(mark => {
        const parent = mark.parentNode;
        if (!parent) return;
        while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
        mark.remove();
        parent.normalize();
    });
}

function freezeManualDocumentInteraction() {
    clearTimeout(manualSelectionTimer);
    manualSelectionTimer = null;
    clearManualHighlightMarks();
    clearManualBrowserSelection();
    closeManualTransientUi();
    currentManualDocument = null;
    currentManualBlocks = [];
    currentManualCategories = [];
    currentManualActiveCategories = [];
    currentManualUnresolved = [];
    currentManualRebindId = '';
    manualUiLifecycle.retain({ blocks: [], unresolved: [], selection: null });
}

function pastelManualColor(color) {
    const value = /^#[0-9a-f]{6}$/i.test(String(color || '')) ? color.slice(1) : 'F2D978';
    const channels = [0, 2, 4].map(index => parseInt(value.slice(index, index + 2), 16));
    const mixed = channels.map(channel => Math.round(channel * 0.42 + 255 * 0.58));
    return `rgb(${mixed.join(', ')})`;
}

function manualAnnotationById(annotationId) {
    return currentManualDocument?.record?.annotations?.find(
        annotation => annotation.annotationId === annotationId
    ) || null;
}

function manualCategoryById(categoryId) {
    return currentManualCategories.find(category => category.categoryId === categoryId) || null;
}

function updateCurrentManualRecord(record) {
    if (!currentManualDocument || !record) return;
    currentManualDocument = { ...currentManualDocument, record };
}

function rehydrateLlmFeedbackInsideManualMark(manualMark, samplesByAnnotationIds) {
    manualMark.querySelectorAll('.sci-llm-highlight').forEach(llmMark => {
        const key = String(llmMark.dataset.annotationIds || '');
        if (!llmFeedbackByMark.has(llmMark) && key && samplesByAnnotationIds.has(key)) {
            llmFeedbackByMark.set(llmMark, samplesByAnnotationIds.get(key));
        }
        bindLlmHighlightInteraction(llmMark);
    });
}

function renderManualAnnotation(annotation, location) {
    const block = currentManualBlocks.find(item => item.blockId === location.blockId);
    const element = block?.element;
    if (!element) return null;
    const nodes = collectManualTextNodes(element);
    const text = nodes.map(node => node.textContent).join('');
    if (text.slice(location.startOffset, location.endOffset) !== annotation.quote) return null;
    const start = locateManualDomOffset(nodes, location.startOffset);
    const end = locateManualDomOffset(nodes, location.endOffset);
    if (!start || !end) return null;
    const llmSamplesByAnnotationIds = new Map();
    element.querySelectorAll('.sci-llm-highlight').forEach(llmMark => {
        const key = String(llmMark.dataset.annotationIds || '');
        const sample = llmFeedbackByMark.get(llmMark);
        if (key && sample) llmSamplesByAnnotationIds.set(key, sample);
    });

    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    const mark = document.createElement('mark');
    mark.className = 'sci-manual-highlight';
    mark.dataset.annotationId = annotation.annotationId;
    mark.dataset.categoryId = annotation.categoryId;
    mark.dataset.categoryName = annotation.categorySnapshot?.name || annotation.categoryId;
    mark.dataset.categoryColor = annotation.categorySnapshot?.color || '';
    mark.style.setProperty('--sci-manual-color', pastelManualColor(annotation.categorySnapshot?.color));
    mark.tabIndex = 0;
    mark.setAttribute('role', 'button');
    mark.setAttribute('aria-label',
        `${annotation.categorySnapshot?.name || '手动'}高亮：${annotation.quote.slice(0, 100)}。按回车编辑`
    );
    mark.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        showHighlightContextPopover(mark);
    });
    mark.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        event.stopPropagation();
        showHighlightContextPopover(mark);
    });
    mark.appendChild(range.extractContents());
    range.insertNode(mark);
    rehydrateLlmFeedbackInsideManualMark(mark, llmSamplesByAnnotationIds);

    if (String(annotation.note || '').trim()) {
        const marker = document.createElement('button');
        marker.type = 'button';
        marker.className = 'sci-manual-note-marker';
        marker.dataset.annotationId = annotation.annotationId;
        marker.dataset.sciPluginUi = 'true';
        marker.textContent = '备注';
        marker.setAttribute('aria-label', `打开${annotation.categorySnapshot?.name || '此'}标注的备注`);
        marker.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            showHighlightContextPopover(mark, { focusNote: true });
        });
        mark.after(marker);
    }
    return mark;
}

function restoreManualAnnotations(records = currentManualDocument?.record?.annotations || []) {
    clearManualHighlightMarks();
    currentManualBlocks.forEach(block => { block.text = manualReadableText(block.element); });
    const planned = ManualAnnotationUiHelpers.planManualAnnotationRestore(
        records,
        currentManualBlocks,
        SciLLM.locateAnnotationInBlocks
    );
    planned.located.sort((first, second) =>
        first.location.blockId.localeCompare(second.location.blockId) ||
        second.location.startOffset - first.location.startOffset
    ).forEach(item => renderManualAnnotation(item.annotation, item.location));
    currentManualUnresolved = planned.unresolved;
    manualUiLifecycle.retain({
        blocks: currentManualBlocks,
        unresolved: currentManualUnresolved,
        selection: null
    });
    if (currentManualUnresolved.length) {
        showManualStatus(
            `${currentManualUnresolved.length} 条手动标注待重新定位；选择正文可重新绑定`,
            'info',
            true
        );
    } else {
        showManualStatus(null);
    }
    return planned;
}

async function prepareManualDocument({ force = false } = {}) {
    const href = String(location.href || '');
    const reusable = currentManualDocument?.documentId && manualPreparedHref === href &&
        currentManualBlocks.length > 0 &&
        currentManualBlocks.every(block => block?.element?.isConnected);
    if (!force && reusable) {
        scheduleManualSelectionInspection(0);
        return currentManualDocument;
    }
    if (manualPreparePromise) return manualPreparePromise;
    manualPreparePromise = prepareManualDocumentFresh(href);
    try {
        return await manualPreparePromise;
    } finally {
        manualPreparePromise = null;
    }
}

async function prepareManualDocumentFresh(href) {
    const requestNumber = ++manualPrepareSequence;
    const requestKey = `manual:${requestNumber}:${href}`;
    const token = manualUiLifecycle.beginDocument(requestKey);
    freezeManualDocumentInteraction();
    let extracted;
    try {
        extracted = getManualDocumentInputAndBlocks();
    } catch (error) {
        console.warn('SCI高亮助手: 无法准备手动标注正文', error.message);
        return;
    }
    if (!extracted.input.paragraphs.length || !extracted.blocks.length) return;
    currentManualBlocks = extracted.blocks;
    if (!currentManualCategories.length && typeof SciLLM.createBuiltInCategories === 'function') {
        currentManualCategories = uniqueManualCategories(
            Object.values(SciLLM.createBuiltInCategories())
        );
        currentManualActiveCategories = currentManualCategories;
    }
    manualUiLifecycle.retain({ blocks: currentManualBlocks });
    scheduleManualSelectionInspection(0);
    try {
        const [prepared, publicState] = await Promise.all([
            sendManualMessage({ type: 'DOCUMENT_PREPARE', document: extracted.input }),
            sendManualMessage({ type: 'LLM_GET_SETTINGS' })
        ]);
        if (requestNumber !== manualPrepareSequence ||
            !manualUiLifecycle.isCurrent(token, requestKey)) return;
        currentManualDocument = prepared;
        currentManualBlocks = extracted.blocks;
        currentManualActiveCategories = uniqueManualCategories(prepared.activeCategories);
        currentManualCategories = uniqueManualCategories([
            ...currentManualActiveCategories,
            ...(publicState.availableCategories || [])
        ]);
        manualPreparedHref = href;
        manualUiLifecycle.beginDocument(prepared.documentId);
        restoreManualAnnotations(prepared.record?.annotations || []);
        scheduleManualSelectionInspection(0);
        return currentManualDocument;
    } catch (error) {
        if (requestNumber !== manualPrepareSequence) return;
        showManualStatus(`手动标注暂不可用：${error.message}`, 'error');
    }
}

function isCurrentManualMutationCandidate(descriptor) {
    return ManualAnnotationUiHelpers.isManualMutationCandidateCurrent({
        currentDocumentId: currentManualDocument?.documentId || '',
        selectionDocumentId: descriptor?.documentId || '',
        blockId: descriptor?.blockId || '',
        blocks: currentManualBlocks
    });
}

function isEffectiveManualContentEditable(element) {
    if (!element) return false;
    if (element.isContentEditable) return true;
    return Boolean(element.closest?.('[contenteditable]:not([contenteditable="false"])'));
}

function isManualForbiddenElement(element) {
    if (!element) return false;
    return isEffectiveManualContentEditable(element) || Boolean(
        element.matches?.(MANUAL_BLOCKED_SELECTOR) ||
        element.closest?.(MANUAL_UI_SELECTOR)
    );
}

function rangeIntersectsManualForbiddenRegion(range, blockElement) {
    if (!range || !blockElement) return true;
    const commonElement = manualElementForNode(range.commonAncestorContainer);
    const scanRoot = commonElement && blockElement.contains(commonElement)
        ? commonElement : blockElement;
    if (isManualForbiddenElement(scanRoot)) return true;
    const walker = document.createTreeWalker(scanRoot, NodeFilter.SHOW_ELEMENT);
    let scanned = 0;
    let element;
    while ((element = walker.nextNode())) {
        scanned += 1;
        if (scanned > MANUAL_FORBIDDEN_SCAN_LIMIT) return true;
        if (!isManualForbiddenElement(element)) continue;
        try {
            if (range.intersectsNode(element)) return true;
        } catch (_error) {
            return true;
        }
    }
    return false;
}

function describeCurrentManualSelection() {
    const selection = document.getSelection?.();
    if (!selection || selection.rangeCount !== 1) return null;
    const range = selection.getRangeAt(0);
    const startBlock = findManualBlock(range.startContainer);
    const endBlock = findManualBlock(range.endContainer);
    const startElement = manualElementForNode(range.startContainer);
    const endElement = manualElementForNode(range.endContainer);
    const insidePluginUi = Boolean(
        manualClosest(range.startContainer, MANUAL_UI_SELECTOR) ||
        manualClosest(range.endContainer, MANUAL_UI_SELECTOR)
    );
    const blockedRegion = Boolean(
        startElement?.closest?.(MANUAL_BLOCKED_SELECTOR) ||
        endElement?.closest?.(MANUAL_BLOCKED_SELECTOR)
    );
    const effectiveContentEditable = Boolean(
        isEffectiveManualContentEditable(startElement) ||
        isEffectiveManualContentEditable(endElement)
    );
    const intersectsForbiddenRegion = startBlock && startBlock === endBlock
        ? rangeIntersectsManualForbiddenRegion(range, startBlock.element)
        : false;
    const base = {
        text: selection.toString(),
        collapsed: selection.isCollapsed || range.collapsed,
        startBlockId: startBlock?.blockId || '',
        endBlockId: endBlock?.blockId || '',
        insidePluginUi,
        blockedRegion,
        effectiveContentEditable,
        intersectsForbiddenRegion
    };
    const validation = ManualAnnotationUiHelpers.validateManualSelectionDescriptor(base);
    if (!validation.valid) return { ...base, validation };
    const startOffset = manualBoundaryOffset(startBlock.element, range.startContainer, range.startOffset);
    const endOffset = manualBoundaryOffset(startBlock.element, range.endContainer, range.endOffset);
    const blockText = manualReadableText(startBlock.element);
    const quote = blockText.slice(startOffset, endOffset);
    const rect = range.getBoundingClientRect();
    return {
        ...base,
        text: quote,
        documentId: currentManualDocument?.documentId || '',
        blockId: startBlock.blockId,
        validation,
        rect: { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right },
        anchor: {
            quote,
            prefix: blockText.slice(Math.max(0, startOffset - 180), startOffset),
            suffix: blockText.slice(endOffset, endOffset + 180),
            sectionTitle: startBlock.sectionTitle,
            blockFingerprint: startBlock.blockFingerprint,
            startOffset,
            endOffset
        }
    };
}

function positionManualFloating(element, rect) {
    const width = Math.min(element.offsetWidth, window.innerWidth - 16);
    const left = Math.max(8, Math.min(
        (rect.left + rect.right - width) / 2,
        window.innerWidth - width - 8
    ));
    const preferredTop = rect.bottom + 8;
    const top = preferredTop + element.offsetHeight <= window.innerHeight - 8
        ? preferredTop : Math.max(8, rect.top - element.offsetHeight - 8);
    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
}

function makeManualButton(label, className = '') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = label;
    return button;
}

function releaseSelectionAfterManualAction() {
    closeManualSelectionToolbar();
    clearManualBrowserSelection();
}

async function saveManualAnnotation(annotation, { openNote = false } = {}) {
    const documentId = currentManualDocument?.documentId;
    if (!documentId) return null;
    const response = await sendManualMessage({
        type: 'ANNOTATION_UPSERT',
        documentId,
        annotation
    });
    if (currentManualDocument?.documentId !== documentId) return null;
    updateCurrentManualRecord(response.record);
    restoreManualAnnotations(response.record.annotations);
    scheduleCurrentArticleArchiveSave();
    const mark = document.querySelector(
        `.sci-manual-highlight[data-annotation-id="${manualCssEscape(annotation.annotationId)}"]`
    );
    if (openNote && mark) showHighlightContextPopover(mark, { focusNote: true });
    return response.annotation;
}

async function createManualAnnotation(category, openNote = false) {
    let descriptor = currentManualSelection;
    if (!currentManualDocument?.documentId) {
        await (manualPreparePromise || prepareManualDocument());
        if (descriptor?.anchor && currentManualDocument?.documentId) {
            descriptor = {
                ...descriptor,
                documentId: currentManualDocument.documentId
            };
            currentManualSelection = descriptor;
            manualUiLifecycle.retain({ selection: descriptor });
        }
    }
    if (!descriptor?.anchor || !category || !isCurrentManualMutationCandidate(descriptor)) {
        showManualStatus('页面正文已变化，请重新选择文字', 'error');
        releaseSelectionAfterManualAction();
        return;
    }
    const timestamp = new Date().toISOString();
    const annotationId = globalThis.crypto?.randomUUID?.() ||
        `manual-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const annotation = {
        annotationId,
        categoryId: category.categoryId,
        categorySnapshot: { name: category.name, color: category.color },
        ...descriptor.anchor,
        note: '',
        status: 'located',
        createdAt: timestamp,
        updatedAt: timestamp
    };
    try {
        await saveManualAnnotation(annotation, { openNote });
    } catch (error) {
        showManualStatus(error.message, 'error');
    } finally {
        releaseSelectionAfterManualAction();
    }
}

async function reanchorManualAnnotation(annotationId = currentManualRebindId) {
    const descriptor = currentManualSelection;
    const annotation = manualAnnotationById(annotationId);
    if (!descriptor?.anchor || !annotation || !isCurrentManualMutationCandidate(descriptor)) {
        showManualStatus('页面正文已变化，请重新选择文字', 'error');
        releaseSelectionAfterManualAction();
        return;
    }
    try {
        const rebound = ManualAnnotationUiHelpers.buildReanchoredAnnotation(
            annotation,
            descriptor.anchor
        );
        await saveManualAnnotation(rebound);
        currentManualRebindId = '';
        showManualStatus('手动标注已重新绑定', 'success');
    } catch (error) {
        showManualStatus(error.message, 'error');
    } finally {
        releaseSelectionAfterManualAction();
    }
}

function appendUnresolvedManualList(toolbar) {
    const panel = document.createElement('div');
    panel.className = 'sci-manual-unresolved-list';
    panel.hidden = true;
    let offset = 0;
    const renderPage = () => {
        panel.replaceChildren();
        const page = currentManualUnresolved.slice(offset, offset + MANUAL_UNRESOLVED_RENDER_LIMIT);
        page.forEach(annotation => {
            const categoryName = annotation.categorySnapshot?.name || '未分类';
            const button = makeManualButton('', 'sci-manual-unresolved-item');
            const summary = document.createElement('span');
            summary.className = 'sci-manual-unresolved-summary';
            summary.textContent = `${categoryName} · ${annotation.quote.slice(0, 64)}`;
            button.appendChild(summary);
            if (annotation.note) {
                const visibleNote = document.createElement('span');
                visibleNote.className = 'sci-manual-unresolved-note';
                visibleNote.textContent = annotation.note;
                if (visibleNote.textContent.length > 240) {
                    visibleNote.textContent = `${visibleNote.textContent.slice(0, 240)}…`;
                }
                button.appendChild(visibleNote);
            }
            button.setAttribute(
                'aria-label',
                `${categoryName}。${annotation.quote.slice(0, 120)}` +
                (annotation.note ? `。备注：${annotation.note}` : '')
            );
            button.addEventListener('click', () => {
                currentManualRebindId = annotation.annotationId;
                closeManualSelectionToolbar();
                showManualStatus('请重新选择同一段落内的文字，然后点击“重新绑定此标注”', 'info', true);
            });
            panel.appendChild(button);
        });
        if (currentManualUnresolved.length > MANUAL_UNRESOLVED_RENDER_LIMIT) {
            const next = makeManualButton('显示下一批', 'sci-manual-page-button');
            next.addEventListener('click', () => {
                offset = (offset + MANUAL_UNRESOLVED_RENDER_LIMIT) % currentManualUnresolved.length;
                renderPage();
            });
            panel.appendChild(next);
        }
    };
    renderPage();
    toolbar.appendChild(panel);
    return panel;
}

function showManualSelectionToolbar(descriptor) {
    closeManualSelectionToolbar();
    currentManualSelection = descriptor;
    manualUiLifecycle.retain({ selection: descriptor });
    const toolbar = document.createElement('div');
    toolbar.id = 'sci-manual-toolbar';
    toolbar.dataset.sciPluginUi = 'true';
    toolbar.setAttribute('role', 'toolbar');
    toolbar.setAttribute('aria-label', '手动荧光笔高亮');
    toolbar.addEventListener('mousedown', event => event.preventDefault());

    const primaryRow = document.createElement('div');
    primaryRow.className = 'sci-manual-primary-row';
    if (currentManualRebindId && manualAnnotationById(currentManualRebindId)) {
        const annotation = manualAnnotationById(currentManualRebindId);
        const rebind = makeManualButton(
            `重新绑定：${annotation.categorySnapshot?.name || '手动标注'}`,
            'sci-manual-primary-action'
        );
        rebind.addEventListener('click', () => reanchorManualAnnotation(annotation.annotationId));
        primaryRow.appendChild(rebind);
    } else {
        currentManualActiveCategories.slice(0, 8).forEach(category => {
            const button = makeManualButton(category.name, 'sci-manual-category');
            button.style.setProperty('--sci-category-color', pastelManualColor(category.color));
            button.addEventListener('click', () =>
                createManualAnnotation(category, toolbar.dataset.openNote === 'true')
            );
            primaryRow.appendChild(button);
        });
    }
    toolbar.appendChild(primaryRow);

    const secondaryRow = document.createElement('div');
    secondaryRow.className = 'sci-manual-secondary-row';
    const note = makeManualButton('高亮后写备注', 'sci-manual-text-action');
    prependUiIcon(note, 'note-pencil');
    note.setAttribute('aria-pressed', 'false');
    note.addEventListener('click', () => {
        const active = toolbar.dataset.openNote !== 'true';
        toolbar.dataset.openNote = String(active);
        note.setAttribute('aria-pressed', String(active));
        setIconButtonLabel(note, 'note-pencil', active ? '已启用备注' : '高亮后写备注');
    });
    secondaryRow.appendChild(note);

    const primaryIds = new Set(currentManualActiveCategories.slice(0, 8)
        .map(category => category.categoryId));
    const remaining = currentManualCategories.filter(category => !primaryIds.has(category.categoryId));
    if (remaining.length) {
        const more = makeManualButton('更多', 'sci-manual-text-action');
        more.setAttribute('aria-expanded', 'false');
        const morePanel = document.createElement('div');
        morePanel.className = 'sci-manual-more-panel';
        morePanel.hidden = true;
        let offset = 0;
        const renderMore = () => {
            morePanel.replaceChildren();
            remaining.slice(offset, offset + MANUAL_MORE_RENDER_LIMIT).forEach(category => {
                const button = makeManualButton(category.name, 'sci-manual-category');
                button.style.setProperty('--sci-category-color', pastelManualColor(category.color));
                button.addEventListener('click', () =>
                    createManualAnnotation(category, toolbar.dataset.openNote === 'true')
                );
                morePanel.appendChild(button);
            });
            if (remaining.length > MANUAL_MORE_RENDER_LIMIT) {
                const next = makeManualButton('显示下一批', 'sci-manual-page-button');
                next.addEventListener('click', () => {
                    offset = (offset + MANUAL_MORE_RENDER_LIMIT) % remaining.length;
                    renderMore();
                });
                morePanel.appendChild(next);
            }
        };
        renderMore();
        more.addEventListener('click', () => {
            morePanel.hidden = !morePanel.hidden;
            more.setAttribute('aria-expanded', String(!morePanel.hidden));
            positionManualFloating(toolbar, descriptor.rect);
        });
        secondaryRow.appendChild(more);
        toolbar.appendChild(morePanel);
    }
    if (currentManualUnresolved.length) {
        const unresolved = makeManualButton(
            `待重新定位 ${currentManualUnresolved.length}`,
            'sci-manual-text-action'
        );
        unresolved.setAttribute('aria-expanded', 'false');
        secondaryRow.appendChild(unresolved);
        const panel = appendUnresolvedManualList(toolbar);
        unresolved.addEventListener('click', () => {
            panel.hidden = !panel.hidden;
            unresolved.setAttribute('aria-expanded', String(!panel.hidden));
            positionManualFloating(toolbar, descriptor.rect);
        });
    }
    toolbar.insertBefore(secondaryRow, toolbar.children[1] || null);
    document.documentElement.appendChild(toolbar);
    positionManualFloating(toolbar, descriptor.rect);
    toolbar.querySelector('button')?.focus({ preventScroll: true });
}

function inspectManualSelection() {
    if (!currentManualBlocks.length || !currentManualCategories.length) return;
    const descriptor = describeCurrentManualSelection();
    if (!descriptor) {
        closeManualSelectionToolbar();
        return;
    }
    if (!descriptor.validation.valid) {
        closeManualSelectionToolbar();
        if (descriptor.validation.code === 'CROSS_BLOCK') {
            showManualStatus(descriptor.validation.message, 'error');
        }
        return;
    }
    showManualSelectionToolbar(descriptor);
}

function scheduleManualSelectionInspection(delay = 0) {
    clearTimeout(manualSelectionTimer);
    manualSelectionTimer = setTimeout(() => {
        manualSelectionTimer = null;
        if (!manualPointerSelecting) inspectManualSelection();
    }, delay);
}

function appendManualEditor(popover, annotation, mark, focusNote) {
    const section = document.createElement('section');
    section.className = 'sci-context-section sci-context-manual';
    const heading = document.createElement('strong');
    heading.textContent = '手动荧光笔标注';
    section.appendChild(heading);

    const categoryLabel = document.createElement('label');
    categoryLabel.textContent = '类别';
    const categorySelect = document.createElement('select');
    categorySelect.setAttribute('aria-label', '手动标注类别');
    const contextCategories = currentManualCategories.slice(0, MANUAL_CONTEXT_CATEGORY_LIMIT);
    if (!contextCategories.some(category => category.categoryId === annotation.categoryId)) {
        const historicalOption = document.createElement('option');
        historicalOption.value = annotation.categoryId;
        historicalOption.textContent = `${annotation.categorySnapshot?.name || annotation.categoryId}（已停用）`;
        historicalOption.disabled = true;
        historicalOption.selected = true;
        categorySelect.appendChild(historicalOption);
    }
    contextCategories.forEach(category => {
        const option = document.createElement('option');
        option.value = category.categoryId;
        option.textContent = category.name;
        option.selected = category.categoryId === annotation.categoryId;
        categorySelect.appendChild(option);
    });
    categoryLabel.appendChild(categorySelect);
    section.appendChild(categoryLabel);

    const noteLabel = document.createElement('label');
    noteLabel.textContent = '备注';
    const note = document.createElement('textarea');
    note.maxLength = 4000;
    note.rows = 4;
    note.value = annotation.note || '';
    note.placeholder = '写下判断、疑问或后续线索';
    noteLabel.appendChild(note);
    section.appendChild(noteLabel);

    const meta = document.createElement('div');
    meta.className = 'sci-context-meta';
    meta.textContent = `创建 ${annotation.createdAt || '未知'} · 更新 ${annotation.updatedAt || '未知'}`;
    section.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'sci-context-actions';
    const save = makeManualButton('保存修改', 'sci-manual-primary-action');
    prependUiIcon(save, 'floppy-disk');
    save.addEventListener('click', async () => {
        const category = manualCategoryById(categorySelect.value) || {
            categoryId: annotation.categoryId,
            ...annotation.categorySnapshot
        };
        save.disabled = true;
        try {
            await saveManualAnnotation({
                ...annotation,
                categoryId: category.categoryId,
                categorySnapshot: { name: category.name, color: category.color },
                note: note.value,
                updatedAt: new Date().toISOString()
            });
            showManualStatus('手动标注已保存', 'success');
        } catch (error) {
            save.disabled = false;
            showManualStatus(error.message, 'error');
        }
    });
    const remove = makeManualButton('删除标注', 'sci-manual-danger-action');
    prependUiIcon(remove, 'x');
    remove.addEventListener('click', async () => {
        const documentId = currentManualDocument?.documentId;
        if (!documentId) return;
        remove.disabled = true;
        try {
            const response = await sendManualMessage({
                type: 'ANNOTATION_DELETE',
                documentId,
                annotationId: annotation.annotationId
            });
            if (currentManualDocument?.documentId !== documentId) return;
            updateCurrentManualRecord(response.record);
            restoreManualAnnotations(response.record.annotations);
            scheduleCurrentArticleArchiveSave();
            showManualStatus('手动标注已删除', 'success');
        } catch (error) {
            remove.disabled = false;
            showManualStatus(error.message, 'error');
        }
    });
    actions.append(save, remove);
    section.appendChild(actions);
    popover.appendChild(section);
    queueMicrotask(() => {
        const target = focusNote ? note : categorySelect;
        if (target.isConnected) target.focus();
    });
}

function appendAiFeedbackEditor(popover, llmMark) {
    const sample = llmFeedbackByMark.get(llmMark);
    const section = document.createElement('section');
    section.className = 'sci-context-section sci-context-ai';
    const heading = document.createElement('strong');
    heading.textContent = 'AI 自动高亮';
    section.appendChild(heading);
    const detail = document.createElement('p');
    detail.textContent = sample
        ? `${sample.categoryId || '未分类'}${sample.reasonZh ? `：${sample.reasonZh}` : ''}`
        : (llmMark.title || '自动高亮详情暂不可用');
    section.appendChild(detail);
    if (sample) {
        const actions = document.createElement('div');
        actions.className = 'sci-context-actions';
        [['准确', 'accepted'], ['不匹配', 'rejected']].forEach(([label, action]) => {
            const button = makeManualButton(label);
            button.addEventListener('click', () => recordLlmFeedback(llmMark, action));
            actions.appendChild(button);
        });
        section.appendChild(actions);
        const correction = document.createElement('div');
        correction.className = 'sci-context-correction';
        const select = document.createElement('select');
        select.setAttribute('aria-label', 'AI 高亮正确类别');
        (sample.availableCategories || []).slice(0, MANUAL_CONTEXT_CATEGORY_LIMIT)
            .forEach(category => {
                const option = document.createElement('option');
                option.value = category.categoryId;
                option.textContent = category.name;
                option.selected = category.categoryId === sample.categoryId;
                select.appendChild(option);
            });
        const correct = makeManualButton('改为此类别');
        correct.addEventListener('click', () =>
            recordLlmFeedback(llmMark, 'corrected', select.value)
        );
        correction.append(select, correct);
        section.appendChild(correction);
    }
    popover.appendChild(section);
}

function showHighlightContextPopover(mark, options = {}) {
    closeHighlightContextPopover();
    const manualMark = mark?.matches?.('.sci-manual-highlight')
        ? mark : mark?.closest?.('.sci-manual-highlight');
    const llmMark = mark?.matches?.('.sci-llm-highlight')
        ? mark
        : manualMark?.querySelector?.('.sci-llm-highlight') || mark?.closest?.('.sci-llm-highlight');
    const annotation = manualMark
        ? manualAnnotationById(manualMark.dataset.annotationId) : null;
    if (!annotation && !llmMark) return;
    manualRestoreFocus = mark;
    const popover = document.createElement('div');
    popover.id = 'sci-highlight-context-popover';
    popover.dataset.sciPluginUi = 'true';
    popover.setAttribute('role', 'dialog');
    popover.setAttribute('aria-modal', 'false');
    popover.setAttribute('aria-label', '高亮详情与编辑');
    popover.addEventListener('click', event => event.stopPropagation());
    if (annotation) appendManualEditor(popover, annotation, manualMark, options.focusNote);
    if (llmMark) appendAiFeedbackEditor(popover, llmMark);
    document.documentElement.appendChild(popover);
    positionManualFloating(popover, mark.getBoundingClientRect());
}

function clearAutomaticHighlights() {
    highlighter.clearHighlight();
    clearLlmHighlights();
}

function clearManualAnnotationsAfterBackground(completionType) {
    if (completionType !== MANUAL_CLEAR_COMPLETION_TYPE) return false;
    clearManualHighlightMarks();
    if (currentManualDocument?.record) {
        currentManualDocument = {
            ...currentManualDocument,
            record: { ...currentManualDocument.record, annotations: [] }
        };
    }
    currentManualUnresolved = [];
    manualUiLifecycle.retain({ unresolved: [], selection: null });
    showManualStatus(null);
    return true;
}

function handleManualPointerDown(event) {
    if (manualClosest(event.target, MANUAL_UI_SELECTOR)) return;
    manualPointerSelecting = true;
    closeManualSelectionToolbar();
}

function handleManualPointerUp(event) {
    if (manualClosest(event.target, MANUAL_UI_SELECTOR)) return;
    manualPointerSelecting = false;
    scheduleManualSelectionInspection(0);
}

function handleManualSelectionChange() {
    if (!manualPointerSelecting) scheduleManualSelectionInspection(16);
}

function handleManualKeyDown(event) {
    if (event.key !== 'Escape') return;
    closeManualTransientUi({ restoreFocus: true });
}

function handleManualOutsideClick(event) {
    if (manualClosest(event.target, MANUAL_UI_SELECTOR) ||
        manualClosest(event.target, '.sci-manual-highlight,.sci-llm-highlight')) return;
    closeManualTransientUi();
}

function handleManualViewportChange(event) {
    if (manualClosest(event?.target, MANUAL_UI_SELECTOR)) return;
    closeManualTransientUi();
}

function disableManualAnnotationUi() {
    clearTimeout(manualSelectionTimer);
    clearTimeout(manualPrepareTimer);
    clearTimeout(manualStatusTimer);
    manualSelectionTimer = null;
    manualPrepareTimer = null;
    manualPreparePromise = null;
    manualPreparedHref = '';
    manualStatusTimer = null;
    manualPrepareSequence += 1;
    manualUiLifecycle.disable();
    clearManualHighlightMarks();
    currentManualDocument = null;
    currentManualBlocks = [];
    currentManualCategories = [];
    currentManualActiveCategories = [];
    currentManualUnresolved = [];
    currentManualRebindId = '';
    manualPointerSelecting = false;
    showManualStatus(null);
}

function initializeManualAnnotationUi() {
    const initialized = manualUiLifecycle.initialize([
        { target: document, type: 'mousedown', handler: handleManualPointerDown, options: true },
        { target: document, type: 'mouseup', handler: handleManualPointerUp, options: true },
        { target: document, type: 'pointerup', handler: handleManualPointerUp, options: true },
        { target: document, type: 'touchend', handler: handleManualPointerUp, options: true },
        { target: document, type: 'selectionchange', handler: handleManualSelectionChange },
        { target: document, type: 'keydown', handler: handleManualKeyDown, options: true },
        { target: document, type: 'click', handler: handleManualOutsideClick },
        { target: window, type: 'scroll', handler: handleManualViewportChange, options: true },
        { target: window, type: 'resize', handler: handleManualViewportChange },
        { target: window, type: 'pagehide', handler: disableManualAnnotationUi }
    ]);
    return initialized;
}
// Manual annotation UI: end

function isLikelyAcademicArticle(paragraphs) {
    const totalCharacters = paragraphs.reduce((sum, item) => sum + item.text.length, 0);
    const academicHeading = /^(abstract|introduction|background|methods?|materials?|results?|discussion|conclusions?)\b/i;
    const headingCount = new Set(
        paragraphs.filter(item => academicHeading.test(item.sectionTitle || '')).map(item => item.sectionId)
    ).size;
    const citationMetadata = document.querySelector(
        'meta[name="citation_title"],meta[name="citation_doi"],meta[name="dc.identifier"]'
    );
    return Boolean(citationMetadata) || (paragraphs.length >= 4 && totalCharacters >= 1000 && headingCount >= 2);
}

function showLlmPageStatus(message, type = 'info') {
    let status = document.getElementById('sci-llm-status');
    if (!message) {
        status?.remove();
        return;
    }
    if (!status) {
        status = document.createElement('div');
        status.id = 'sci-llm-status';
        document.documentElement.appendChild(status);
    }
    status.className = type;
    status.textContent = message;
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

function setLlmErrorDiagnostics(error = null) {
    const root = document.documentElement;
    if (!root) return;
    if (!error) {
        delete root.dataset.sciLlmErrorCode;
        delete root.dataset.sciLlmErrorMessage;
        delete root.dataset.sciLlmDiagnosticType;
        delete root.dataset.sciLlmDiagnosticMessage;
        delete root.dataset.sciLlmDiagnosticStage;
        delete root.dataset.sciLlmDiagnosticRequestBytes;
        delete root.dataset.sciLlmDiagnosticElapsedMs;
        delete root.dataset.sciLlmHttpStatus;
        delete root.dataset.sciLlmRetryAfterMs;
        delete root.dataset.sciLlmBackgroundRevision;
        return;
    }
    root.dataset.sciLlmErrorCode = String(error.code || 'UNKNOWN').slice(0, 80);
    root.dataset.sciLlmErrorMessage = String(error.message || 'LLM analysis failed').slice(0, 240);
    if (error.diagnosticType) {
        root.dataset.sciLlmDiagnosticType = String(error.diagnosticType).slice(0, 80);
    }
    if (error.diagnosticMessage) {
        root.dataset.sciLlmDiagnosticMessage = String(error.diagnosticMessage).slice(0, 240);
    }
    if (error.runtimeRevision) {
        root.dataset.sciLlmBackgroundRevision = String(error.runtimeRevision).slice(0, 80);
    }
    if (error.diagnosticStage) {
        root.dataset.sciLlmDiagnosticStage = String(error.diagnosticStage).slice(0, 80);
    }
    if (Number.isFinite(error.requestBytes)) {
        root.dataset.sciLlmDiagnosticRequestBytes = String(Math.max(0, Math.round(error.requestBytes)));
    }
    if (Number.isFinite(error.elapsedMs)) {
        root.dataset.sciLlmDiagnosticElapsedMs = String(Math.max(0, Math.round(error.elapsedMs)));
    }
    if (Number.isFinite(error.status) && error.status > 0) {
        root.dataset.sciLlmHttpStatus = String(Math.max(0, Math.round(error.status)));
    }
    if (Number.isFinite(error.retryAfterMs) && error.retryAfterMs > 0) {
        root.dataset.sciLlmRetryAfterMs = String(Math.max(0, Math.round(error.retryAfterMs)));
    }
}

async function applyStoredRegexFallback() {
    const stored = await chrome.storage.local.get(['allRules', 'selectedCategories', 'highlightMode']);
    if (!stored.allRules || !Object.keys(stored.allRules).length) return null;
    const selected = Array.isArray(stored.selectedCategories)
        ? stored.selectedCategories
        : Object.keys(stored.allRules);
    const categories = {};
    selected.forEach(categoryId => {
        if (stored.allRules[categoryId]) categories[categoryId] = stored.allRules[categoryId];
    });
    if (!Object.keys(categories).length) return null;
    return {
        counts: highlighter.applyHighlight(categories, stored.highlightMode || 'word')
    };
}

async function prepareArticleProfileWithLLM(options = {}) {
    showLlmPageStatus('正在准备论文正文与所选文献类型…');
    const extractionDiagnostics = diagnoseArticleWithTrace('prepare_article_profile');
    const extracted = extractArticleWithTrace('prepare_article_profile');
    if (options.auto && !isLikelyAcademicArticle(extracted)) {
        showLlmPageStatus(null);
        return { success: false, skipped: true, reason: 'PAGE_NOT_CONFIDENTLY_ACADEMIC' };
    }
    const paragraphs = extracted.map(({ sourceIndex, ...paragraph }) => paragraph);
    if (!paragraphs.length) throw new Error('未找到可分析的论文正文');
    const response = await chrome.runtime.sendMessage({
        type: 'LLM_PREPARE_DOCUMENT',
        document: { title: document.title, paragraphs }
    });
    if (!response?.success) {
        const error = new Error(response?.error?.message || '论文准备失败');
        error.code = response?.error?.code;
        throw error;
    }
    lastPreparedStudy = response.data;
    lastLlmDiagnostics = {
        extraction: extractionDiagnostics,
        stage: 'prepared',
        studyProfile: response.data.studyProfile,
        readingViewId: response.data.readingViewId,
        profileCacheHit: response.data.profileCacheHit
    };
    const profile = response.data.studyProfile;
    const preparedTypeName = profile?.primaryTypeName || profile?.primaryType;
    showLlmPageStatus(preparedTypeName
        ? `已准备文献类型：${preparedTypeName}，可以开始分析全文`
        : '论文正文已准备，请先在插件中单选一个文献类型', 'success');
    setTimeout(() => showLlmPageStatus(null), 6000);
    return { success: true, ...response.data };
}

async function analyzeArticleWithLLM(options = {}) {
    if (llmAnalysisPromise) return llmAnalysisPromise;
    const operation = beginLlmHighlightOperation();
    llmAnalysisPromise = (async () => {
        setLlmErrorDiagnostics(null);
        highlighter.clearHighlight();
        showLlmPageStatus('正在提取论文正文…');
        const extractionDiagnostics = diagnoseArticleWithTrace('analyze_article');
        const extracted = extractArticleWithTrace('analyze_article');
        lastLlmDiagnostics = { extraction: extractionDiagnostics, stage: 'extracted' };
        if (options.auto && !isLikelyAcademicArticle(extracted)) {
            showLlmPageStatus(null);
            return { success: false, skipped: true, reason: 'PAGE_NOT_CONFIDENTLY_ACADEMIC' };
        }
        const paragraphs = extracted.map(({ sourceIndex, ...paragraph }) => paragraph);
        if (!paragraphs.length) throw new Error('未找到可分析的论文正文');
        llmProgressiveAnalysis = {
            rawAnalysis: {
                annotations: [],
                rejected: [],
                categories: Array.isArray(lastPreparedStudy?.activeCategories)
                    ? lastPreparedStudy.activeCategories : []
            },
            paragraphs,
            extractionDiagnostics,
            threshold: lastLlmAnalysis?.threshold || 0.8
        };
        showLlmPageStatus(`正在使用 LLM 分析 ${paragraphs.length} 个正文单元…`);
        const response = await chrome.runtime.sendMessage({
            type: 'LLM_ANALYZE_DOCUMENT',
            operationId: operation.operationId,
            document: {
                documentId: options.documentId,
                previousDocumentHash: options.documentHash,
                title: document.title,
                paragraphs
            }
        });
        if (!response?.success) {
            const error = new Error(response?.error?.message || 'LLM 分析失败');
            error.code = response?.error?.code;
            error.diagnosticType = response?.error?.diagnosticType;
            error.diagnosticMessage = response?.error?.diagnosticMessage;
            error.diagnosticStage = response?.error?.diagnosticStage;
            error.requestBytes = response?.error?.requestBytes;
            error.elapsedMs = response?.error?.elapsedMs;
            error.runtimeRevision = response?.error?.runtimeRevision;
            throw error;
        }
        const applied = renderLlmAnalysis(
            response.data,
            paragraphs,
            response.data.confidenceThreshold,
            extractionDiagnostics
        );
        llmProgressiveAnalysis = null;
        lastPreparedStudy = {
            documentId: response.data.documentId,
            documentHash: response.data.documentHash,
            studyProfile: response.data.studyProfile,
            paperBlueprint: response.data.paperBlueprint,
            readingViewId: response.data.readingViewId,
            activeCategories: response.data.categories,
            categorySources: response.data.categorySources
        };
        showLlmPageStatus(formatEffectiveRoute(
            `LLM 分析完成：已高亮 ${applied.highlightedCount} 处`, response.data.route
        ), 'success');
        setTimeout(() => showLlmPageStatus(null), 4000);
        scheduleCurrentArticleArchiveSave();
        return { success: true, ...applied, analysis: response.data };
    })();

    try {
        return await llmAnalysisPromise;
    } catch (error) {
        llmProgressiveAnalysis = null;
        if (error?.code === 'CANCELLED' || operation.cancelled) {
            lastLlmDiagnostics = {
                ...(lastLlmDiagnostics || {}),
                stage: 'cancelled',
                errorCode: 'CANCELLED'
            };
            showLlmPageStatus('全文 LLM 高亮已取消，已完成分块的高亮会保留。', 'success');
            return {
                success: false,
                cancelled: true,
                code: 'CANCELLED',
                operationId: operation.operationId
            };
        }
        lastLlmDiagnostics = {
            ...(lastLlmDiagnostics || {
                extraction: diagnoseArticleWithTrace('analyze_article_error')
            }),
            stage: 'error',
            errorCode: error.code || 'UNKNOWN',
            errorMessage: error.message,
            diagnosticType: error.diagnosticType,
            diagnosticMessage: error.diagnosticMessage
        };
        setLlmErrorDiagnostics(error);
        if (options.auto) {
            const fallback = await applyStoredRegexFallback();
            if (fallback) {
                showLlmPageStatus('LLM 分析失败，已自动回退到正则高亮', 'error');
                return { success: false, fallback: true, ...fallback, code: error.code };
            }
        }
        showLlmPageStatus(`LLM 分析失败：${error.message}`, 'error');
        throw error;
    } finally {
        llmAnalysisPromise = null;
        finishLlmHighlightOperation(operation);
    }
}

function figureDataUrlBytes(value) {
    const base64 = String(value || '').split(',')[1] || '';
    return Math.floor(base64.length * 3 / 4);
}

function loadFigureImage(source) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.crossOrigin = 'anonymous';
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('Figure image could not be loaded'));
        image.src = source;
    });
}

async function fetchFigureImage(source) {
    const response = await fetch(source, { credentials: 'include' });
    if (!response.ok) throw new Error('Figure image request failed');
    const blob = await response.blob();
    if (!/^image\//i.test(blob.type || '')) throw new Error('Figure source was not an image');
    const objectUrl = URL.createObjectURL(blob);
    try {
        return await loadFigureImage(objectUrl);
    } finally {
        URL.revokeObjectURL(objectUrl);
    }
}

function encodeFigureImage(sourceImage) {
    const sourceWidth = Number(sourceImage.naturalWidth || sourceImage.width) || 0;
    const sourceHeight = Number(sourceImage.naturalHeight || sourceImage.height) || 0;
    if (!sourceWidth || !sourceHeight) throw new Error('Figure image has no dimensions');
    const scale = Math.min(1, FIGURE_IMAGE_MAX_EDGE / Math.max(sourceWidth, sourceHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(sourceWidth * scale));
    canvas.height = Math.max(1, Math.round(sourceHeight * scale));
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Canvas is unavailable');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(sourceImage, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.86, 0.78, 0.68, 0.58, 0.48]) {
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        if (figureDataUrlBytes(dataUrl) <= FIGURE_IMAGE_MAX_BYTES) {
            return { mediaType: 'image/jpeg', dataUrl };
        }
    }
    throw new Error('Figure image remains too large after compression');
}

async function prepareFigureImage(imageElement) {
    const fallbackSource = imageElement?.currentSrc || imageElement?.src ||
        imageElement?.getAttribute?.('src') ||
        imageElement?.getAttribute?.('data-src') ||
        imageElement?.getAttribute?.('data-original') ||
        imageElement?.getAttribute?.('data-lazy-src') || '';
    const candidates = typeof SciLLM.collectFigureImageCandidates === 'function'
        ? SciLLM.collectFigureImageCandidates(imageElement, document.baseURI)
        : [fallbackSource].filter(Boolean);
    if (!candidates.length) throw new Error('Figure image source is missing');
    let lastError = null;
    for (const source of candidates) {
        try {
            const sourceImage = imageElement.complete && imageElement.naturalWidth &&
                (imageElement.currentSrc === source || imageElement.src === source)
                ? imageElement : await loadFigureImage(source);
            return encodeFigureImage(sourceImage);
        } catch (error) {
            lastError = error;
            try {
                const fetched = await fetchFigureImage(source);
                return encodeFigureImage(fetched);
            } catch (fetchError) {
                lastError = fetchError;
            }
        }
    }
    throw lastError || new Error('Figure image could not be loaded');
}

async function figureRouteSupportsVision() {
    if (figureRouteCapabilityCache &&
        Date.now() - figureRouteCapabilityCache.capturedAt < FIGURE_ROUTE_CAPABILITY_TTL_MS) {
        return figureRouteCapabilityCache.supportsVision;
    }
    try {
        const response = await chrome.runtime.sendMessage({ type: 'LLM_GET_SETTINGS' });
        const settings = response?.data?.settings;
        const route = settings?.taskRoutes?.figure;
        const profileId = route?.mode === 'profile'
            ? route.profileId : settings?.globalProfileId;
        const profile = settings?.profiles?.[profileId];
        const supportsVision = profile?.capabilities?.vision === true;
        figureRouteCapabilityCache = { supportsVision, capturedAt: Date.now() };
        return supportsVision;
    } catch (_) {
        // Preserve image quality when route discovery is temporarily unavailable.
        return true;
    }
}

async function prepareFigureImages(figure) {
    if (!await figureRouteSupportsVision()) return [];
    const prepared = [];
    for (const imageElement of Array.from(figure?.imageElements || [])) {
        if (prepared.length >= FIGURE_IMAGE_LIMIT) break;
        try {
            prepared.push(await prepareFigureImage(imageElement));
        } catch (error) {
            console.warn('SCI 逐图解读：跳过无法读取的图片', error.message);
        }
    }
    return prepared;
}

const FIGURE_IMAGE_VIEWER_ID = 'sci-figure-image-viewer';
let figureImageViewerKeyHandler = null;

function closeFigureImageViewer() {
    document.getElementById(FIGURE_IMAGE_VIEWER_ID)?.remove();
    if (figureImageViewerKeyHandler) {
        document.removeEventListener('keydown', figureImageViewerKeyHandler, true);
        figureImageViewerKeyHandler = null;
    }
}

function showFigureImageViewer(figureId) {
    const figure = getFigureWorkspaceInventory()
        .find(item => item.figureId === figureId);
    if (!figure) return { success: false, code: 'FIGURE_NOT_FOUND' };
    const sources = typeof SciLLM.collectFigureImageSources === 'function'
        ? SciLLM.collectFigureImageSources(figure, document.baseURI)
        : [SciLLM.selectFigureImageSource(figure, document.baseURI)].filter(Boolean);
    if (!sources.length) return { success: false, code: 'IMAGE_NOT_FOUND' };
    closeFigureImageViewer();

    const viewer = document.createElement('section');
    viewer.id = FIGURE_IMAGE_VIEWER_ID;
    viewer.setAttribute('role', 'dialog');
    viewer.setAttribute('aria-modal', 'true');
    viewer.setAttribute('aria-label', `${figure.figureLabel || figureId} 高清原图`);

    const header = document.createElement('header');
    const title = document.createElement('strong');
    title.textContent = `${figure.figureLabel || figureId} · 高清原图`;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'sci-figure-viewer-close';
    close.textContent = '×';
    close.setAttribute('aria-label', '关闭高清原图');
    header.append(title, close);

    const canvas = document.createElement('div');
    canvas.className = 'sci-figure-viewer-canvas';
    canvas.tabIndex = 0;
    const stage = document.createElement('div');
    stage.className = 'sci-figure-viewer-stage';
    const image = document.createElement('img');
    let sourceIndex = 0;
    image.src = sources[sourceIndex];
    image.alt = figure.figureLabel || figureId;
    image.draggable = false;
    stage.appendChild(image);
    canvas.appendChild(stage);

    const controls = document.createElement('div');
    controls.className = 'sci-figure-viewer-controls';
    let scale = 1;
    const label = document.createElement('span');
    label.setAttribute('aria-live', 'polite');
    const applyScale = next => {
        scale = Math.min(4, Math.max(.25, next));
        const overflowScale = Math.max(1, scale);
        stage.style.width = `${overflowScale * 100}%`;
        stage.style.height = `${overflowScale * 100}%`;
        image.style.maxWidth = `${100 / overflowScale}%`;
        image.style.maxHeight = `${100 / overflowScale}%`;
        image.style.transform = `scale(${scale})`;
        label.textContent = `${Math.round(scale * 100)}%`;
    };
    const makeControl = (text, ariaLabel, handler) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = text;
        button.setAttribute('aria-label', ariaLabel);
        button.addEventListener('click', handler);
        return button;
    };
    controls.append(
        makeControl('−', '缩小原图', () => applyScale(scale - .25)),
        label,
        makeControl('+', '放大原图', () => applyScale(scale + .25)),
        makeControl('适配窗口', '使原图适配窗口', () => {
            applyScale(1);
            canvas.scrollTo({ left: 0, top: 0 });
        })
    );

    let dragState = null;
    canvas.addEventListener('pointerdown', event => {
        if (event.button !== 0) return;
        dragState = {
            x: event.clientX,
            y: event.clientY,
            left: canvas.scrollLeft,
            top: canvas.scrollTop
        };
        canvas.classList.add('is-dragging');
        canvas.setPointerCapture?.(event.pointerId);
    });
    canvas.addEventListener('pointermove', event => {
        if (!dragState) return;
        canvas.scrollLeft = dragState.left - (event.clientX - dragState.x);
        canvas.scrollTop = dragState.top - (event.clientY - dragState.y);
    });
    const stopDragging = event => {
        dragState = null;
        canvas.classList.remove('is-dragging');
        if (event?.pointerId !== undefined && canvas.hasPointerCapture?.(event.pointerId)) {
            canvas.releasePointerCapture(event.pointerId);
        }
    };
    canvas.addEventListener('pointerup', stopDragging);
    canvas.addEventListener('pointercancel', stopDragging);

    image.addEventListener('error', () => {
        sourceIndex += 1;
        if (sourceIndex < sources.length) {
            image.src = sources[sourceIndex];
            return;
        }
        const failure = document.createElement('p');
        failure.className = 'sci-figure-viewer-error';
        failure.textContent = '高清原图加载失败，请关闭后重试。';
        canvas.replaceChildren(failure);
        controls.hidden = true;
    });
    figureImageViewerKeyHandler = event => {
        if (event.key === 'Escape') closeFigureImageViewer();
    };
    document.addEventListener('keydown', figureImageViewerKeyHandler, true);
    viewer.addEventListener('click', event => {
        if (event.target === viewer) closeFigureImageViewer();
    });
    close.addEventListener('click', closeFigureImageViewer);
    viewer.append(header, canvas, controls);
    document.documentElement.appendChild(viewer);
    applyScale(1);
    close.focus();
    return { success: true, figureId };
}

function clearFigureWalkthroughs() {
    document.querySelectorAll('.sci-figure-badge,.sci-figure-walkthrough')
        .forEach(element => element.remove());
    document.querySelectorAll('.sci-figure-caption-analyzed')
        .forEach(element => element.classList.remove('sci-figure-caption-analyzed'));
}

function buildFigureInputHash(figure, images) {
    const value = JSON.stringify({
        figureId: figure?.figureId || '',
        caption: figure?.caption || '',
        panelHints: figure?.panelHints || [],
        contextParagraphs: figure?.contextParagraphs || [],
        images: (Array.isArray(images) ? images : []).map(image => image.dataUrl)
    });
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

function getFigureWorkspaceInventory({ forceRefresh = false } = {}) {
    if (!forceRefresh && figureWorkspaceInventory.length) return figureWorkspaceInventory;
    clearFigureWalkthroughs();
    const extractedParagraphs = extractArticleWithTrace('figure_workspace_inventory');
    figureWorkspaceInventory = SciLLM.extractArticleFigures(document, extractedParagraphs);
    return figureWorkspaceInventory;
}

function getActiveFigureAnalysisForDomino(state) {
    if (!state) return null;
    return state.activeDepth === 'standard'
        ? (state.standard || state.deep || null)
        : (state.deep || state.standard || null);
}

function buildCrossFigureLogicInput() {
    return getFigureWorkspaceInventory().map(figure => {
        const state = figureWalkthroughState.get(figure.figureId);
        const result = getActiveFigureAnalysisForDomino(state);
        return {
            figureId: figure.figureId,
            figureLabel: figure.figureLabel,
            caption: figure.caption,
            isSupplemental: figure.isSupplemental === true,
            analysis: result ? {
                analysisDepth: result.analysisDepth,
                figureQuestion: result.figureQuestion,
                coreConclusion: result.coreConclusion,
                authorAssembly: result.authorAssembly,
                claimBoundary: result.claimBoundary,
                argumentChain: result.argumentChain
            } : null
        };
    });
}

function invalidateCrossFigureLogic() {
    crossFigureLogicState = { result: null, loading: false, error: '' };
}

function ensureFigureWalkthroughState(figureId) {
    const existing = figureWalkthroughState.get(figureId);
    if (existing?.figure) return existing;
    const figure = getFigureWorkspaceInventory().find(item => item.figureId === figureId);
    if (!figure) return null;
    const restored = (Array.isArray(restoredFigureWorkspaceSnapshot?.figures)
        ? restoredFigureWorkspaceSnapshot.figures : [])
        .find(item => String(item?.figureId || '') === String(figureId));
    const state = {
        figure,
        figureInputHash: '',
        standard: restored?.standard || null,
        standardError: String(restored?.standardError || ''),
        deep: restored?.deep || null,
        activeDepth: restored?.activeDepth === 'standard' ? 'standard' : 'deep',
        deepLoading: false,
        deepError: String(restored?.deepError || ''),
        panelFollowups: restored?.panelFollowups || {},
        panelFollowupLoading: {},
        panelFollowupErrors: restored?.panelFollowupErrors || {},
        panelAnalyses: restored?.panelAnalyses || {},
        panelAnalysisLoading: {},
        panelAnalysisErrors: restored?.panelAnalysisErrors || {},
        expanded: restored?.expanded === true
    };
    figureWalkthroughState.set(figureId, state);
    return state;
}


function throwBusyFigureAnalysis(requestedFigureId) {
    const error = new Error(`正在精读 ${figureDepthAnalysisId}，请完成后再分析 ${requestedFigureId}`);
    error.code = 'FIGURE_ANALYSIS_BUSY';
    error.requestedFigureId = requestedFigureId;
    error.activeFigureId = figureDepthAnalysisId;
    throw error;
}

function beginSingleFigureProgress(figure, operation = null) {
    const startedAt = Date.now();
    updateFigureProgress(figure.figureId, {
        figureId: figure.figureId,
        figureLabel: figure.figureLabel,
        expectedPanels: figure.panelHints,
        expectedPanelCount: Array.isArray(figure.panelHints) ? figure.panelHints.length : 0,
        phase: 'preparing',
        running: true,
        completed: false,
        failed: false,
        cancelled: false,
        operationId: operation?.operationId || '',
        completedFigures: 0,
        totalFigures: 1,
        startedAt,
        resetStartedAt: true
    });
    updateFigureAnalysisStatus({
        running: true,
        phase: 'preparing',
        currentFigure: 1,
        totalFigures: 1,
        completedFigures: 0,
        failedFigures: 0,
        operationId: operation?.operationId || '',
        figureLabel: figure.figureLabel,
        message: `${figure.figureLabel || figure.figureId}：正在准备图片与正文上下文。`,
        startedAt
    });
}

function finishSingleFigureProgress(figure, error = null, operation = null) {
    if (operation && !isCurrentFigureOperation(operation)) return;
    const cancelled = error?.code === 'CANCELLED';
    if (error) {
        updateFigureProgress(figure.figureId, {
            phase: cancelled ? 'cancelled' : 'failed',
            running: false,
            completed: false,
            failed: !cancelled,
            cancelled,
            operationId: operation?.operationId || '',
            completedFigures: 0,
            totalFigures: 1,
            figureLabel: figure.figureLabel,
            errorCode: error.code || 'FIGURE_ANALYSIS_FAILED'
        });
    } else if (figureProgressById.get(figure.figureId)?.running === true) {
        updateFigureProgress(figure.figureId, {
            phase: 'figure',
            running: false,
            completed: true,
            failed: false,
            cancelled: false,
            operationId: operation?.operationId || '',
            completedFigures: 1,
            totalFigures: 1,
            figureLabel: figure.figureLabel
        });
    }
    const current = sanitizeFigureProgressSnapshot(figureProgressById.get(figure.figureId) || {});
    updateFigureAnalysisStatus({
        running: current.running === true,
        paused: false,
        phase: cancelled ? 'cancelled' : error ? 'failed' : 'figure',
        currentFigure: 1,
        totalFigures: 1,
        completedFigures: current.completed ? 1 : 0,
        failedFigures: current.failed ? 1 : 0,
        operationId: operation?.operationId || '',
        figureLabel: figure.figureLabel,
        message: cancelled
            ? `${figure.figureLabel || figure.figureId}：Figure 解读已取消。`
            : error
            ? `${figure.figureLabel || figure.figureId}：Figure 解读失败。`
            : `${figure.figureLabel || figure.figureId}：Figure 解读已完成。`
    });
}

function cancelPendingFigureProgress(figures, {
    completedFigures = 0,
    errorCode = 'FIGURE_BATCH_CANCELLED'
} = {}) {
    (Array.isArray(figures) ? figures : []).forEach(figure => {
        const figureId = sanitizeFigureProgressText(figure?.figureId, 80);
        const progress = figureProgressById.get(figureId);
        if (!figureId || progress?.completed || progress?.failed || progress?.cancelled) return;
        updateFigureProgress(figureId, {
            phase: 'cancelled',
            running: false,
            completed: false,
            failed: false,
            cancelled: true,
            completedFigures,
            totalFigures: figures.length,
            figureLabel: figure?.figureLabel || figureId,
            errorCode
        });
    });
}

async function analyzeSingleFigureDeep(figureId) {
    if (figureDepthAnalysisPromise) {
        if (figureDepthAnalysisId === figureId) return figureDepthAnalysisPromise;
        throwBusyFigureAnalysis(figureId);
    }
    const state = figureWalkthroughState.get(figureId);
    if (!state?.standard || !state.figure) throw new Error('请先生成该图的标准解读');
    const operation = beginFigureOperation('single', figureId);
    state.deepLoading = true; // deep Figure operation
    state.deepError = '';
    state.expanded = true;
    figureDepthAnalysisId = figureId;
    beginSingleFigureProgress(state.figure, operation);
    figureDepthAnalysisPromise = (async () => {
        try {
            const extractedParagraphs = extractArticleWithTrace('analyze_figure_deep');
            const paragraphs = extractedParagraphs.map(({ sourceIndex, ...paragraph }) => paragraph);
            await waitForLocalOperation(operation);
            const images = await prepareFigureImages(state.figure);
            await waitForLocalOperation(operation);
            if (buildFigureInputHash(state.figure, images) !== state.figureInputHash) {
                throw new Error('Figure 内容已变化，请先重新生成标准解读');
            }
            const response = await chrome.runtime.sendMessage({
                type: 'LLM_ANALYZE_FIGURES',
                analysisDepth: 'deep',
                operationId: operation.operationId,
                document: { title: document.title, paragraphs },
                figures: [{
                    figureId: state.figure.figureId,
                    figureLabel: state.figure.figureLabel,
                    caption: state.figure.caption,
                    panelHints: state.figure.panelHints,
                    contextParagraphs: state.figure.contextParagraphs,
                    images
                }]
            });
            if (!response?.success) {
                const error = new Error(response?.error?.message || '深度解读失败');
                error.code = response?.error?.code;
                throw error;
            }
            if (!isCurrentFigureOperation(operation)) throwStaleFigureOperation(operation);
            const result = response.data?.figureResults?.[0];
            if (!result || result.analysisDepth !== 'deep') {
                throw new Error('深度解读未返回有效结果');
            }
            state.deep = { ...result, operationId: operation.operationId };
            state.activeDepth = 'deep';
            invalidateCrossFigureLogic();
        } catch (error) {
            state.deepError = error?.message || '深度解读失败';
            state.activeDepth = 'standard';
            finishSingleFigureProgress(state.figure, error);
            throw error;
        } finally {
            state.deepLoading = false;
            if (!state.deepError) finishSingleFigureProgress(state.figure);
            figureDepthAnalysisPromise = null;
            figureDepthAnalysisId = '';
            finishFigureOperation(operation); // deep Figure operation
        }
    })();
    return figureDepthAnalysisPromise;
}

async function analyzeSingleFigureWithLLM(figureId, { forceRefresh = false } = {}) {
    if (figureDepthAnalysisPromise) {
        if (figureDepthAnalysisId === figureId) return figureDepthAnalysisPromise;
        throwBusyFigureAnalysis(figureId);
    }
    const operation = beginFigureOperation('single', figureId);
    const state = ensureFigureWalkthroughState(figureId);
    if (!state?.figure) {
        finishFigureOperation(operation);
        const error = new Error('FIGURE_NOT_FOUND');
        error.code = 'FIGURE_NOT_FOUND';
        throw error;
    }
    state.deepLoading = true;
    state.standardError = '';
    state.expanded = true;
    figureDepthAnalysisId = figureId;
    beginSingleFigureProgress(state.figure, operation);
    figureDepthAnalysisPromise = (async () => {
        try {
            const extractedParagraphs = extractArticleWithTrace('analyze_single_figure');
            const paragraphs = extractedParagraphs.map(({ sourceIndex, ...paragraph }) => paragraph);
            await waitForLocalOperation(operation);
            const images = await prepareFigureImages(state.figure);
            await waitForLocalOperation(operation);
            state.figureInputHash = buildFigureInputHash(state.figure, images);
            const response = await chrome.runtime.sendMessage({
                type: 'LLM_ANALYZE_FIGURES',
                analysisDepth: 'standard',
                forceRefresh: forceRefresh === true,
                operationId: operation.operationId,
                document: { title: document.title, paragraphs },
                figures: [{
                    figureId: state.figure.figureId,
                    figureLabel: state.figure.figureLabel,
                    caption: state.figure.caption,
                    panelHints: state.figure.panelHints,
                    contextParagraphs: state.figure.contextParagraphs,
                    images
                }]
            });
            if (!response?.success) {
                const error = new Error(response?.error?.message || 'FIGURE_ANALYSIS_FAILED');
                error.code = response?.error?.code || 'FIGURE_ANALYSIS_FAILED';
                throw error;
            }
            if (!isCurrentFigureOperation(operation)) throwStaleFigureOperation(operation);
            const result = response.data?.figureResults?.[0];
            if (!result || result.analysisDepth !== 'standard') {
                const error = new Error('INVALID_FIGURE_RESULT');
                error.code = 'INVALID_RESPONSE';
                throw error;
            }
            const operationResult = { ...result, operationId: operation.operationId };
            state.standard = operationResult;
            state.activeDepth = 'standard';
            invalidateCrossFigureLogic();
            lastFigureAnalysis = {
                figures: Array.from(figureWalkthroughState.values())
                    .filter(item => item.standard || item.deep).length,
                totalFigures: getFigureWorkspaceInventory().length,
                failedFigures: 0,
                cacheHits: Number(response.data.cacheHits) || 0,
                visionFallbacks: Number(response.data.visionFallbacks) || 0,
                route: response.data.route || null,
                failures: [],
                operationId: operation.operationId,
                results: [operationResult]
            };
            scheduleCurrentArticleArchiveSave();
            return {
                success: true,
                figureId,
                operationId: operation.operationId,
                result: operationResult,
                route: response.data.route || null
            };
        } catch (error) {
            state.standardError = error?.message || 'FIGURE_ANALYSIS_FAILED';
            finishSingleFigureProgress(state.figure, error);
            throw error;
        } finally {
            state.deepLoading = false;
            if (!state.standardError) finishSingleFigureProgress(state.figure);
            figureDepthAnalysisPromise = null;
            figureDepthAnalysisId = '';
            finishFigureOperation(operation);
        }
    })();
    return figureDepthAnalysisPromise;
}

function normalizeRequestedPanelId(value) {
    const panelId = String(value || '').normalize('NFKC').trim().toUpperCase();
    return /^[A-Z0-9][A-Z0-9.+-]{0,7}$/.test(panelId) ? panelId : '';
}

function mergeSinglePanelIntoFigureResult(result, panel, figure) {
    if (!result || !panel) return result;
    const panelId = normalizeRequestedPanelId(panel.panel);
    const panels = (Array.isArray(result.panels) ? result.panels : [])
        .filter(item => normalizeRequestedPanelId(item?.panel) !== panelId);
    panels.push(panel);
    const expectedPanels = Array.isArray(figure?.panelHints) ? figure.panelHints : [];
    const returnedPanels = panels.map(item => normalizeRequestedPanelId(item?.panel)).filter(Boolean);
    return {
        ...result,
        panels,
        panelCoverage: {
            expectedPanels,
            returnedPanels,
            missingPanels: expectedPanels.filter(item => !returnedPanels.includes(item))
        }
    };
}

async function analyzeSingleFigurePanelWithLLM(
    figureId,
    panelId,
    { forceRefresh = false } = {}
) {
    const normalizedPanelId = normalizeRequestedPanelId(panelId);
    const state = ensureFigureWalkthroughState(figureId);
    if (!state?.figure || !normalizedPanelId ||
        !state.figure.panelHints.includes(normalizedPanelId)) {
        const error = new Error('FIGURE_PANEL_NOT_FOUND');
        error.code = 'FIGURE_PANEL_NOT_FOUND';
        throw error;
    }
    if (figureDepthAnalysisPromise) throwBusyFigureAnalysis(`${figureId} · Panel ${normalizedPanelId}`);
    const operation = beginFigureOperation('single', `${figureId}:${normalizedPanelId}`);
    state.panelAnalyses ||= {};
    state.panelAnalysisLoading ||= {};
    state.panelAnalysisErrors ||= {};
    state.panelAnalysisLoading[normalizedPanelId] = true;
    state.panelAnalysisErrors[normalizedPanelId] = '';
    state.expanded = true;
    figureDepthAnalysisId = `${figureId}:${normalizedPanelId}`;
    beginSingleFigureProgress(state.figure, operation);
    updateFigureProgress(figureId, {
        expectedPanels: [normalizedPanelId],
        expectedPanelCount: 1,
        message: `${state.figure.figureLabel} · Panel ${normalizedPanelId}`
    });
    figureDepthAnalysisPromise = (async () => {
        try {
            const paragraphs = extractArticleWithTrace('analyze_single_figure_panel')
                .map(item => ({
                    paragraphId: String(item?.paragraphId || ''),
                    sectionTitle: String(item?.sectionTitle || ''),
                    text: String(item?.text || '')
                }));
            await waitForLocalOperation(operation);
            const images = await prepareFigureImages(state.figure);
            await waitForLocalOperation(operation);
            const response = await chrome.runtime.sendMessage({
                type: 'LLM_ANALYZE_FIGURES',
                analysisDepth: 'standard',
                forceRefresh: forceRefresh === true,
                operationId: operation.operationId,
                document: { title: document.title, paragraphs },
                figures: [{
                    figureId: state.figure.figureId,
                    figureLabel: state.figure.figureLabel,
                    caption: state.figure.caption,
                    panelHints: [normalizedPanelId],
                    contextParagraphs: state.figure.contextParagraphs,
                    images
                }]
            });
            if (!response?.success) {
                const error = new Error(response?.error?.message || 'FIGURE_PANEL_ANALYSIS_FAILED');
                error.code = response?.error?.code || 'FIGURE_PANEL_ANALYSIS_FAILED';
                throw error;
            }
            if (!isCurrentFigureOperation(operation)) throwStaleFigureOperation(operation);
            const result = response.data?.figureResults?.[0];
            const panel = (Array.isArray(result?.panels) ? result.panels : [])
                .find(item => normalizeRequestedPanelId(item?.panel) === normalizedPanelId);
            if (!panel) {
                const error = new Error('FIGURE_PANEL_RESULT_MISSING');
                error.code = 'INVALID_RESPONSE';
                throw error;
            }
            state.panelAnalyses[normalizedPanelId] = panel;
            if (state.standard) {
                state.standard = mergeSinglePanelIntoFigureResult(
                    state.standard,
                    panel,
                    state.figure
                );
            }
            state.panelAnalysisErrors[normalizedPanelId] = '';
            scheduleCurrentArticleArchiveSave();
            return {
                success: true,
                figureId,
                panelId: normalizedPanelId,
                panel,
                route: response.data.route || null,
                operationId: operation.operationId
            };
        } catch (error) {
            state.panelAnalysisErrors[normalizedPanelId] =
                error?.message || 'FIGURE_PANEL_ANALYSIS_FAILED';
            finishSingleFigureProgress(state.figure, error, operation);
            throw error;
        } finally {
            state.panelAnalysisLoading[normalizedPanelId] = false;
            if (!state.panelAnalysisErrors[normalizedPanelId]) {
                finishSingleFigureProgress(state.figure, null, operation);
            }
            figureDepthAnalysisPromise = null;
            figureDepthAnalysisId = '';
            finishFigureOperation(operation);
        }
    })();
    return figureDepthAnalysisPromise;
}

async function askFigurePanelWithLLM(figureId, panelId, topics = [], customQuestion = '') {
    const state = ensureFigureWalkthroughState(figureId);
    const result = getActiveFigureAnalysisForDomino(state);
    const requestedPanel = normalizeRequestedPanelId(panelId);
    const panel = (Array.isArray(result?.panels) ? result.panels : [])
        .find(item => normalizeRequestedPanelId(item?.panel) === requestedPanel) ||
        state?.panelAnalyses?.[requestedPanel] ||
        (state?.figure?.panelHints?.includes(requestedPanel) ? { panel: requestedPanel } : null);
    const selectedTopics = typeof SciLLM.normalizePanelFollowupTopics === 'function'
        ? SciLLM.normalizePanelFollowupTopics(topics) : [];
    const normalizedQuestion = typeof SciLLM.normalizePanelCustomQuestion === 'function'
        ? SciLLM.normalizePanelCustomQuestion(customQuestion) : String(customQuestion || '').trim();
    if (!state?.figure || !panel || (!selectedTopics.length && !normalizedQuestion)) {
        const error = new Error('FIGURE_PANEL_FOLLOWUP_INVALID');
        error.code = 'FIGURE_PANEL_FOLLOWUP_INVALID';
        throw error;
    }
    const panelKey = String(panel.panel || '').toUpperCase();
    state.panelFollowups ||= {};
    state.panelFollowupLoading ||= {};
    state.panelFollowupErrors ||= {};
    if (state.panelFollowupLoading[panelKey]) {
        const error = new Error('FIGURE_PANEL_FOLLOWUP_BUSY');
        error.code = 'FIGURE_PANEL_FOLLOWUP_BUSY';
        throw error;
    }
    state.panelFollowupLoading[panelKey] = true;
    state.panelFollowupErrors[panelKey] = '';
    try {
        const images = await prepareFigureImages(state.figure);
        const response = await chrome.runtime.sendMessage({
            type: 'LLM_ASK_FIGURE_PANEL',
            document: { title: document.title },
            figure: {
                figureId: state.figure.figureId,
                figureLabel: state.figure.figureLabel,
                caption: state.figure.caption,
                panelHints: state.figure.panelHints,
                contextParagraphs: state.figure.contextParagraphs,
                images
            },
            panel,
            topics: selectedTopics,
            customQuestion: normalizedQuestion
        });
        if (!response?.success || !response.data?.panelFollowup) {
            const error = new Error(response?.error?.message || 'FIGURE_PANEL_FOLLOWUP_FAILED');
            error.code = response?.error?.code || 'FIGURE_PANEL_FOLLOWUP_FAILED';
            throw error;
        }
        state.panelFollowups[panelKey] = response.data.panelFollowup;
        scheduleCurrentArticleArchiveSave();
        return {
            success: true,
            figureId,
            panel: panelKey,
            panelFollowup: response.data.panelFollowup,
            route: response.data.route || null
        };
    } catch (error) {
        state.panelFollowupErrors[panelKey] = error?.message || 'FIGURE_PANEL_FOLLOWUP_FAILED';
        throw error;
    } finally {
        state.panelFollowupLoading[panelKey] = false;
    }
}

function normalizeArticleChatEvidence(item = {}) {
    const verification = item.verification && typeof item.verification === 'object'
        ? item.verification : {};
    return {
        marker: String(item.marker || '').slice(0, 12),
        paragraphId: String(item.paragraphId || '').slice(0, 160),
        sourceKey: String(item.sourceKey || item.paragraphId || '').slice(0, 160),
        textHash: String(item.textHash || '').slice(0, 160),
        sectionTitle: String(item.sectionTitle || '').slice(0, 300),
        sectionPath: (Array.isArray(item.sectionPath) ? item.sectionPath : [])
            .slice(-12).map(entry => String(
                typeof entry === 'string' ? entry : entry?.title || ''
            ).slice(0, 300)).filter(Boolean),
        quote: String(item.quote || '').slice(0, 2400),
        support: String(item.support || '').slice(0, 1600),
        documentRevision: Math.max(0, Number(item.documentRevision) || 0),
        verificationStatus: String(
            item.verificationStatus || verification.status || ''
        ).slice(0, 32),
        candidateCount: Math.max(
            0, Number(item.candidateCount ?? verification.candidateCount) || 0
        ),
        verificationReason: String(
            item.verificationReason || verification.reason || ''
        ).slice(0, 160)
    };
}

function publicArticleChatBlock(block = {}) {
    return {
        blockId: String(block.blockId || block.id || '').slice(0, 160),
        markdown: String(block.markdown || block.content || '').slice(0, 65536),
        evidence: (Array.isArray(block.evidence) ? block.evidence : [])
            .map(normalizeArticleChatEvidence),
        createdAt: Math.max(0, Number(block.createdAt) || Date.now())
    };
}

function publicArticleChatPlan(plan = null) {
    if (!plan || typeof plan !== 'object') return null;
    return {
        mode: String(plan.mode || '').slice(0, 40),
        indexId: String(plan.indexId || '').slice(0, 160),
        contextWindowTokens: Math.max(0, Number(plan.contextWindowTokens) || 0),
        inputBudgetTokens: Math.max(0, Number(plan.inputBudgetTokens) || 0),
        outputBudgetTokens: plan.outputBudgetTokens && typeof plan.outputBudgetTokens === 'object'
            ? { ...plan.outputBudgetTokens } : null,
        estimatedInputTokens: Math.max(0, Number(plan.estimatedInputTokens) || 0),
        chunkIds: (Array.isArray(plan.chunkIds) ? plan.chunkIds : [])
            .map(value => String(value).slice(0, 160)),
        includedHistoryIds: (Array.isArray(plan.includedHistoryIds)
            ? plan.includedHistoryIds : []).map(value => String(value).slice(0, 160)),
        retrievedOldTurnIds: (Array.isArray(plan.retrievedOldTurnIds)
            ? plan.retrievedOldTurnIds : []).map(value => String(value).slice(0, 160)),
        sectionCoverage: (Array.isArray(plan.sectionCoverage)
            ? plan.sectionCoverage : []).map(value => String(value).slice(0, 300)),
        cacheDecision: plan.cacheDecision && typeof plan.cacheDecision === 'object'
            ? { ...plan.cacheDecision } : null,
        retrievalCoverage: plan.retrievalCoverage &&
            typeof plan.retrievalCoverage === 'object' ? { ...plan.retrievalCoverage } : null
    };
}

function publicArticleChatTurn(turn = {}) {
    const allowedStatuses = new Set([
        'queued', 'generating', 'completed', 'truncated', 'cancelled', 'error', 'unanswered'
    ]);
    const route = turn.route && typeof turn.route === 'object' ? turn.route : {};
    const usage = turn.usage && typeof turn.usage === 'object' ? turn.usage : null;
    return {
        turnId: String(turn.turnId || '').slice(0, 160),
        question: String(turn.question || '').slice(0, 4000),
        answerBlocks: (Array.isArray(turn.answerBlocks) ? turn.answerBlocks : [])
            .map(publicArticleChatBlock).filter(block => block.blockId && block.markdown),
        summary: String(turn.summary || '').slice(0, 2000),
        status: allowedStatuses.has(turn.status) ? turn.status : 'unanswered',
        selectedProfileId: String(
            turn.selectedProfileId || turn.profileId || ''
        ).slice(0, 100),
        profileName: String(turn.profileName || route.effectiveProfileName || '').slice(0, 200),
        model: String(turn.model || route.model || '').slice(0, 200),
        route: {
            effectiveProfileId: String(route.effectiveProfileId || '').slice(0, 100),
            effectiveProfileName: String(route.effectiveProfileName || '').slice(0, 200),
            providerId: String(route.providerId || '').slice(0, 80),
            model: String(route.model || '').slice(0, 200),
            capabilityMode: String(route.capabilityMode || '').slice(0, 40),
            fallbackReason: String(route.fallbackReason || '').slice(0, 120)
        },
        usage: usage ? {
            inputTokens: Math.max(0, Number(usage.inputTokens) || 0),
            outputTokens: Math.max(0, Number(usage.outputTokens) || 0),
            cacheHitTokens: Math.max(0, Number(usage.cacheHitTokens) || 0)
        } : null,
        plan: publicArticleChatPlan(turn.plan),
        coverage: turn.coverage && typeof turn.coverage === 'object'
            ? { ...turn.coverage } : null,
        operationId: String(turn.operationId || '').slice(0, 100),
        error: String(turn.error || '').slice(0, 1000),
        createdAt: Math.max(0, Number(turn.createdAt) || Date.now()),
        updatedAt: Math.max(0, Number(turn.updatedAt) || Date.now())
    };
}

function getPublicArticleChatState() {
    return {
        turns: articleChatState.turns.map(publicArticleChatTurn),
        totalTurns: articleChatState.turns.length,
        loading: articleChatState.loading === true,
        error: String(articleChatState.error || ''),
        operationId: String(articleChatState.operationId || ''),
        activeTurnId: String(articleChatState.activeTurnId || ''),
        coverage: articleChatState.coverage ? { ...articleChatState.coverage } : null,
        memoryNeedsRebuild: articleChatState.memoryNeedsRebuild === true
    };
}

function notifyArticleChatStateChanged(kind, turn = null, extra = {}) {
    const event = {
        kind,
        turnId: String(turn?.turnId || extra.turnId || ''),
        turn: turn ? publicArticleChatTurn(turn) : null,
        loading: articleChatState.loading === true,
        operationId: String(articleChatState.operationId || ''),
        activeTurnId: String(articleChatState.activeTurnId || ''),
        error: String(articleChatState.error || ''),
        coverage: articleChatState.coverage ? { ...articleChatState.coverage } : null,
        totalTurns: articleChatState.turns.length,
        memoryNeedsRebuild: articleChatState.memoryNeedsRebuild === true,
        ...extra
    };
    chrome.runtime.sendMessage({ type: 'ARTICLE_CHAT_STATE_CHANGED', event }).catch(() => {});
}

function attachArticleChatEvidenceIdentity(evidence, snapshot) {
    return (Array.isArray(evidence) ? evidence : []).map(item => {
        const candidate = {
            ...item,
            documentRevision: Number(snapshot?.revision) || 0
        };
        const verification = SciLLM.verifyArticleChatEvidence(candidate, snapshot);
        return {
            ...candidate,
            paragraphId: verification.target?.paragraphId || candidate.paragraphId || '',
            sourceKey: verification.target?.sourceKey || candidate.sourceKey || '',
            textHash: verification.target?.textHash || candidate.textHash || '',
            sectionTitle: verification.target?.sectionTitle || candidate.sectionTitle || '',
            sectionPath: verification.target?.sectionPath || candidate.sectionPath || [],
            verificationStatus: verification.status,
            candidateCount: verification.candidateCount,
            verificationReason: verification.reason
        };
    });
}

/* Legacy flat-message workflow retained only for archive migration reference.
async function legacyAskArticleWithLLM(question, profileId = '') {
    const normalizedQuestion = String(question || '').normalize('NFKC').trim().slice(0, 4000);
    const normalizedProfileId = String(profileId || '').trim().slice(0, 100);
    if (!normalizedQuestion) {
        const error = new Error('ARTICLE_CHAT_QUESTION_REQUIRED');
        error.code = 'INVALID_SETTINGS';
        throw error;
    }
    if (articleChatState.loading) {
        const error = new Error('ARTICLE_CHAT_BUSY');
        error.code = 'ARTICLE_CHAT_BUSY';
        throw error;
    }
    const generation = ++articleChatGeneration;
    const operationId = `chat-${generation}-${Date.now()}`;
    const history = articleChatState.messages.map(publicArticleChatMessage)
        .map(message => ({ role: message.role, content: message.content }));
    articleChatState.messages.push(publicArticleChatMessage({
        role: 'user',
        content: normalizedQuestion,
        profileId: normalizedProfileId,
        createdAt: Date.now()
    }));
    articleChatState.loading = true;
    articleChatState.error = '';
    articleChatState.operationId = operationId;
    articleChatState.activeProfileId = normalizedProfileId;
    try {
        const snapshot = getCanonicalArticleSnapshot();
        const paragraphs = (Array.isArray(snapshot.paragraphs) ? snapshot.paragraphs : [])
            .map(item => ({
            paragraphId: String(item?.paragraphId || ''),
            sourceKey: String(item?.sourceKey || ''),
            textHash: String(item?.textHash || ''),
            sectionTitle: String(item?.sectionTitle || ''),
            sectionPath: Array.isArray(item?.sectionPath) ? item.sectionPath : [],
            text: String(item?.text || '')
        }));
        const response = await chrome.runtime.sendMessage({
            type: 'LLM_ASK_ARTICLE',
            operationId,
            profileId: normalizedProfileId,
            question: normalizedQuestion,
            history,
            document: {
                title: document.title,
                url: globalThis.location?.href || '',
                paragraphs
            }
        });
        if (generation !== articleChatGeneration) {
            const error = new Error('ARTICLE_CHAT_STALE');
            error.code = 'CANCELLED';
            throw error;
        }
        if (!response?.success || !response.data?.message?.answer) {
            const error = new Error(response?.error?.message || 'ARTICLE_CHAT_FAILED');
            error.code = response?.error?.code || 'ARTICLE_CHAT_FAILED';
            throw error;
        }
        const answer = response.data.message;
        const route = response.data.route || {};
        const assistantMessage = publicArticleChatMessage({
            role: 'assistant',
            content: answer.answer,
            profileId: route.effectiveProfileId || normalizedProfileId,
            profileName: route.effectiveProfileName || route.name || '',
            model: route.model || '',
            evidence: attachArticleChatEvidenceIdentity(answer.evidence, snapshot),
            limitations: answer.limitations,
            createdAt: Date.now()
        });
        articleChatState.messages.push(assistantMessage);
        articleChatState.coverage = response.data.coverage || null;
        scheduleCurrentArticleArchiveSave();
        return {
            success: true,
            message: assistantMessage,
            coverage: articleChatState.coverage,
            route
        };
    } catch (error) {
        articleChatState.error = error?.code === 'CANCELLED'
            ? '本次提问已取消。' : (error?.message || 'ARTICLE_CHAT_FAILED');
        throw error;
    } finally {
        if (generation === articleChatGeneration) {
            articleChatState.loading = false;
            articleChatState.operationId = '';
            articleChatState.activeProfileId = '';
        }
        chrome.runtime.sendMessage({
            type: 'LLM_CONTROL_OPERATION', operationId, command: 'release'
        }).catch(() => {});
    }
}

async function legacyCancelArticleChatWithLLM() {
    const operationId = articleChatState.operationId;
    if (!articleChatState.loading || !operationId) return { success: true, active: false };
    articleChatGeneration += 1;
    articleChatState.loading = false;
    articleChatState.error = '本次提问已取消。';
    articleChatState.operationId = '';
    articleChatState.activeProfileId = '';
    const response = await chrome.runtime.sendMessage({
        type: 'LLM_CONTROL_OPERATION', operationId, command: 'cancel'
    });
    if (!response?.success) {
        const error = new Error(response?.error?.message || 'ARTICLE_CHAT_CANCEL_FAILED');
        error.code = response?.error?.code;
        throw error;
    }
    return { success: true, active: false, cancelled: true };
}

function legacyClearArticleChat() {
    if (articleChatState.loading) {
        const error = new Error('ARTICLE_CHAT_BUSY');
        error.code = 'ARTICLE_CHAT_BUSY';
        throw error;
    }
    articleChatGeneration += 1;
    articleChatState = {
        messages: [], loading: false, error: '', operationId: '',
        activeProfileId: '', coverage: null
    };
    scheduleCurrentArticleArchiveSave();
    return { success: true };
}

*/
function applyArticleChatProgress(progress = {}) {
    const operationId = String(progress.operationId || '').slice(0, 100);
    const turnId = String(progress.turnId || '').slice(0, 160);
    if (!operationId || !turnId) return false;
    const turn = articleChatState.turns.find(item => item.turnId === turnId);
    if (!turn || progress.operationId !== turn.operationId || progress.turnId !== turn.turnId) {
        return false;
    }
    const phase = String(progress.phase || '');
    let changed = false;
    if (progress.route && typeof progress.route === 'object') {
        turn.route = { ...progress.route };
        turn.profileName = String(progress.effectiveProfileName ||
            progress.route.effectiveProfileName || '');
        turn.model = String(progress.route.model || '');
        changed = true;
    }
    if (phase === 'chat_started') {
        turn.status = 'generating';
        changed = true;
    } else if (phase === 'chat_context_ready') {
        turn.coverage = progress.coverage && typeof progress.coverage === 'object'
            ? { ...progress.coverage } : null;
        articleChatState.coverage = turn.coverage;
        changed = true;
    } else if (phase === 'chat_answer_block' && progress.block) {
        const snapshot = getCanonicalArticleSnapshot();
        const block = publicArticleChatBlock({
            ...progress.block,
            evidence: attachArticleChatEvidenceIdentity(progress.block.evidence, snapshot)
        });
        if (block.blockId && block.markdown &&
            !turn.answerBlocks.some(item => item.blockId === block.blockId)) {
            turn.answerBlocks.push(block);
            changed = true;
        }
    } else if (phase === 'chat_usage') {
        turn.usage = progress.usage && typeof progress.usage === 'object'
            ? { ...progress.usage } : null;
        changed = true;
    } else if (phase === 'chat_continuing') {
        turn.status = 'generating';
        turn.continuationCount = Math.max(1, Number(progress.continuation) || 1);
        changed = true;
    } else if (phase === 'chat_cancelled') {
        turn.status = 'cancelled';
        turn.error = '本次提问已取消，已完成的回答内容已保留。';
        changed = true;
    } else if (phase === 'chat_error') {
        turn.status = 'error';
        turn.error = String(progress.errorCode || 'ARTICLE_CHAT_FAILED').slice(0, 1000);
        changed = true;
    } else if (phase === 'chat_completed') {
        turn.status = progress.status === 'truncated' ? 'truncated' : 'completed';
        changed = true;
    }
    if (!changed) return false;
    turn.updatedAt = Date.now();
    notifyArticleChatStateChanged('turn_updated', turn, { phase });
    if (phase === 'chat_answer_block' || phase === 'chat_cancelled' ||
        phase === 'chat_completed') scheduleCurrentArticleArchiveSave();
    return true;
}

function createArticleChatTurn(question, selectedProfileId, options = {}) {
    const normalizedQuestion = String(question || '').normalize('NFKC').trim().slice(0, 4000);
    const normalizedProfileId = String(selectedProfileId || '').trim().slice(0, 100);
    if (!normalizedQuestion) {
        const error = new Error('ARTICLE_CHAT_QUESTION_REQUIRED');
        error.code = 'INVALID_SETTINGS';
        throw error;
    }
    if (!normalizedProfileId) {
        const error = new Error('ARTICLE_CHAT_PROFILE_REQUIRED');
        error.code = 'INVALID_SETTINGS';
        throw error;
    }
    const createdAt = Date.now();
    articleChatTurnSequence += 1;
    return {
        turnId: String(options.turnId ||
            `turn-${createdAt.toString(36)}-${articleChatTurnSequence.toString(36)}`),
        question: normalizedQuestion,
        answerBlocks: [],
        summary: '',
        status: 'queued',
        selectedProfileId: normalizedProfileId,
        route: null,
        usage: null,
        plan: null,
        coverage: null,
        operationId: '',
        error: '',
        createdAt,
        updatedAt: createdAt
    };
}

function articleChatHistoryForTurn(turnId) {
    return articleChatState.turns.filter(turn => turn.turnId !== turnId &&
        turn.status !== 'queued' && turn.status !== 'generating' &&
        turn.status !== 'unanswered' && turn.status !== 'error' &&
        (turn.answerBlocks.length > 0 || Boolean(turn.summary)))
        .map(publicArticleChatTurn).map(turn => ({
            turnId: turn.turnId,
            question: turn.question,
            answerBlocks: turn.answerBlocks.map(block => ({
                blockId: block.blockId,
                markdown: block.markdown
            })),
            summary: turn.summary,
            createdAt: turn.createdAt
        }));
}

function mergeArticleChatAnswerBlocks(turn, answer, snapshot) {
    const blocks = Array.isArray(answer?.answerBlocks) ? answer.answerBlocks : [];
    blocks.forEach(value => {
        const block = publicArticleChatBlock({
            ...value,
            evidence: attachArticleChatEvidenceIdentity(value?.evidence, snapshot)
        });
        if (block.blockId && block.markdown &&
            !turn.answerBlocks.some(item => item.blockId === block.blockId)) {
            turn.answerBlocks.push(block);
        }
    });
}

async function runArticleChatTurn(turn) {
    const generation = ++articleChatGeneration;
    const operationId = `chat-${generation}-${Date.now()}`;
    turn.status = 'generating';
    turn.operationId = operationId;
    turn.error = '';
    turn.updatedAt = Date.now();
    articleChatState.loading = true;
    articleChatState.error = '';
    articleChatState.operationId = operationId;
    articleChatState.activeTurnId = turn.turnId;
    notifyArticleChatStateChanged('turn_updated', turn, { phase: 'chat_started' });
    try {
        const snapshot = getCanonicalArticleSnapshot();
        const paragraphs = (Array.isArray(snapshot.paragraphs) ? snapshot.paragraphs : [])
            .map(item => ({
                paragraphId: String(item?.paragraphId || ''),
                sourceKey: String(item?.sourceKey || ''),
                textHash: String(item?.textHash || ''),
                recordType: String(item?.recordType || 'body'),
                sectionId: String(item?.sectionId || ''),
                sectionTitle: String(item?.sectionTitle || ''),
                sectionKind: String(item?.sectionKind || ''),
                sectionPath: Array.isArray(item?.sectionPath) ? item.sectionPath : [],
                text: String(item?.text || '')
            }));
        const history = articleChatHistoryForTurn(turn.turnId);
        articleChatState.memoryNeedsRebuild = false;
        const response = await chrome.runtime.sendMessage({
            type: 'LLM_ASK_ARTICLE',
            operationId,
            turnId: turn.turnId,
            profileId: turn.selectedProfileId,
            question: turn.question,
            history,
            document: {
                title: document.title,
                url: globalThis.location?.href || '',
                documentHash: String(snapshot.documentHash || ''),
                revision: Math.max(1, Number(snapshot.revision) || 1),
                paragraphs
            }
        });
        if (turn.operationId !== operationId || generation > articleChatGeneration) {
            const error = new Error('ARTICLE_CHAT_STALE');
            error.code = 'CANCELLED';
            throw error;
        }
        if (!response?.success || !response.data?.message) {
            const error = new Error(response?.error?.message || 'ARTICLE_CHAT_FAILED');
            error.code = response?.error?.code || 'ARTICLE_CHAT_FAILED';
            throw error;
        }
        const answer = response.data.message;
        mergeArticleChatAnswerBlocks(turn, answer, snapshot);
        turn.summary = String(answer.summary || '').slice(0, 2000);
        turn.status = answer.status === 'truncated' ? 'truncated' : 'completed';
        turn.route = response.data.route || null;
        turn.profileName = String(response.data.route?.effectiveProfileName || '');
        turn.model = String(response.data.route?.model || '');
        turn.usage = response.data.usage || turn.usage;
        turn.plan = publicArticleChatPlan(response.data.plan);
        turn.coverage = response.data.coverage || turn.coverage;
        articleChatState.coverage = turn.coverage;
        turn.error = '';
        turn.updatedAt = Date.now();
        scheduleCurrentArticleArchiveSave();
        notifyArticleChatStateChanged('turn_updated', turn, { phase: 'chat_completed' });
    } catch (error) {
        const cancelled = error?.code === 'CANCELLED' || error?.name === 'AbortError';
        turn.status = cancelled ? 'cancelled' : 'error';
        turn.error = cancelled
            ? '本次提问已取消，已完成的回答内容已保留。'
            : String(error?.message || 'ARTICLE_CHAT_FAILED').slice(0, 1000);
        turn.updatedAt = Date.now();
        articleChatState.error = turn.error;
        scheduleCurrentArticleArchiveSave();
        notifyArticleChatStateChanged('turn_updated', turn, {
            phase: cancelled ? 'chat_cancelled' : 'chat_error'
        });
    } finally {
        if (articleChatState.operationId === operationId) {
            articleChatState.loading = false;
            articleChatState.operationId = '';
            articleChatState.activeTurnId = '';
        }
        turn.operationId = '';
        chrome.runtime.sendMessage({
            type: 'LLM_CONTROL_OPERATION', operationId, command: 'release'
        }).catch(() => {});
        notifyArticleChatStateChanged('turn_updated', turn, { phase: 'chat_terminal' });
    }
}

function pumpArticleChatQueue() {
    if (articleChatPumpPromise) return articleChatPumpPromise;
    articleChatPumpPromise = (async () => {
        while (true) {
            const nextTurn = articleChatState.turns.find(turn => turn.status === 'queued');
            if (!nextTurn) break;
            await runArticleChatTurn(nextTurn);
        }
    })().finally(() => {
        articleChatPumpPromise = null;
        const queued = articleChatState.turns.some(turn => turn.status === 'queued');
        if (queued) void pumpArticleChatQueue();
    });
    return articleChatPumpPromise;
}

async function askArticleWithLLM(question, profileId = '') {
    const turn = createArticleChatTurn(question, profileId);
    articleChatState.turns.push(turn);
    notifyArticleChatStateChanged('turn_added', turn);
    scheduleCurrentArticleArchiveSave();
    void pumpArticleChatQueue();
    return { success: true, queued: true, turn: publicArticleChatTurn(turn) };
}

async function cancelArticleChatWithLLM() {
    const operationId = articleChatState.operationId;
    const turn = articleChatState.turns.find(item =>
        item.turnId === articleChatState.activeTurnId && item.operationId === operationId
    );
    if (!articleChatState.loading || !operationId || !turn) {
        return { success: true, active: false };
    }
    const response = await chrome.runtime.sendMessage({
        type: 'LLM_CONTROL_OPERATION', operationId, command: 'cancel'
    });
    if (!response?.success) {
        const error = new Error(response?.error?.message || 'ARTICLE_CHAT_CANCEL_FAILED');
        error.code = response?.error?.code;
        throw error;
    }
    turn.status = 'cancelled';
    turn.error = '本次提问已取消，已完成的回答内容已保留。';
    turn.updatedAt = Date.now();
    notifyArticleChatStateChanged('turn_updated', turn, { phase: 'chat_cancelled' });
    return { success: true, active: false, cancelled: true };
}

function removeArticleChatTurn(turnId, { queuedOnly = false } = {}) {
    const normalizedTurnId = String(turnId || '').slice(0, 160);
    const index = articleChatState.turns.findIndex(turn => turn.turnId === normalizedTurnId);
    if (index < 0) return { success: true, deleted: false };
    const turn = articleChatState.turns[index];
    if (turn.status === 'generating' || (queuedOnly && turn.status !== 'queued')) {
        const error = new Error(turn.status === 'generating'
            ? 'ARTICLE_CHAT_TURN_ACTIVE' : 'ARTICLE_CHAT_TURN_NOT_QUEUED');
        error.code = 'ARTICLE_CHAT_BUSY';
        throw error;
    }
    articleChatState.turns.splice(index, 1);
    articleChatState.memoryNeedsRebuild = true;
    scheduleCurrentArticleArchiveSave();
    notifyArticleChatStateChanged('turn_removed', null, { turnId: normalizedTurnId });
    return { success: true, deleted: true, turnId: normalizedTurnId };
}

function deleteArticleChatAnswer(turnId) {
    const turn = articleChatState.turns.find(item => item.turnId === String(turnId || ''));
    if (!turn) return { success: true, deleted: false };
    if (turn.status === 'generating' || turn.status === 'queued') {
        const error = new Error('ARTICLE_CHAT_TURN_ACTIVE');
        error.code = 'ARTICLE_CHAT_BUSY';
        throw error;
    }
    turn.answerBlocks = [];
    turn.summary = '';
    turn.usage = null;
    turn.plan = null;
    turn.error = '';
    turn.status = 'unanswered';
    turn.updatedAt = Date.now();
    articleChatState.memoryNeedsRebuild = true;
    scheduleCurrentArticleArchiveSave();
    notifyArticleChatStateChanged('turn_updated', turn, { phase: 'answer_deleted' });
    return { success: true, deleted: true, turn: publicArticleChatTurn(turn) };
}

function regenerateArticleChatTurn(turnId, profileId = '') {
    const turn = articleChatState.turns.find(item => item.turnId === String(turnId || ''));
    if (!turn) {
        const error = new Error('ARTICLE_CHAT_TURN_NOT_FOUND');
        error.code = 'INVALID_SETTINGS';
        throw error;
    }
    if (turn.status === 'generating' || turn.status === 'queued') {
        const error = new Error('ARTICLE_CHAT_TURN_ACTIVE');
        error.code = 'ARTICLE_CHAT_BUSY';
        throw error;
    }
    turn.answerBlocks = [];
    turn.summary = '';
    turn.usage = null;
    turn.plan = null;
    turn.coverage = null;
    turn.route = null;
    turn.profileName = '';
    turn.model = '';
    turn.error = '';
    turn.status = 'queued';
    turn.selectedProfileId = String(profileId || turn.selectedProfileId).trim().slice(0, 100);
    turn.updatedAt = Date.now();
    articleChatState.memoryNeedsRebuild = true;
    scheduleCurrentArticleArchiveSave();
    notifyArticleChatStateChanged('turn_updated', turn, { phase: 'regenerated' });
    void pumpArticleChatQueue();
    return { success: true, queued: true, turn: publicArticleChatTurn(turn) };
}

function clearArticleChat() {
    if (articleChatState.loading) {
        const error = new Error('ARTICLE_CHAT_BUSY');
        error.code = 'ARTICLE_CHAT_BUSY';
        throw error;
    }
    articleChatGeneration += 1;
    articleChatState = {
        turns: [], loading: false, error: '', operationId: '', activeTurnId: '',
        coverage: null, memoryNeedsRebuild: true
    };
    scheduleCurrentArticleArchiveSave();
    notifyArticleChatStateChanged('chat_cleared');
    return { success: true };
}

async function analyzeCrossFigureLogicWithLLM({ forceRefresh = false } = {}) {
    if (crossFigureLogicPromise) return crossFigureLogicPromise;
    const figures = buildCrossFigureLogicInput();
    const mainFigures = figures.filter(item => !item.isSupplemental);
    if (mainFigures.length < 2) {
        const error = new Error('CROSS_FIGURE_LOGIC_REQUIRES_TWO_MAIN_FIGURES');
        error.code = 'CROSS_FIGURE_LOGIC_REQUIRES_TWO_MAIN_FIGURES';
        throw error;
    }
    crossFigureLogicState = {
        result: crossFigureLogicState.result,
        loading: true,
        error: ''
    };
    crossFigureLogicPromise = (async () => {
        try {
            const response = await chrome.runtime.sendMessage({
                type: 'LLM_ANALYZE_CROSS_FIGURE_LOGIC',
                forceRefresh: forceRefresh === true,
                document: { title: document.title },
                figures
            });
            if (!response?.success) {
                const error = new Error(response?.error?.message || 'CROSS_FIGURE_LOGIC_FAILED');
                error.code = response?.error?.code || 'CROSS_FIGURE_LOGIC_FAILED';
                throw error;
            }
            const result = response.data?.crossFigureLogic;
            if (!result || !Array.isArray(result.nodes) || !result.nodes.length) {
                const error = new Error('INVALID_CROSS_FIGURE_LOGIC');
                error.code = 'INVALID_RESPONSE';
                throw error;
            }
            crossFigureLogicState = {
                result, loading: false, error: '', route: response.data.route || null
            };
            scheduleCurrentArticleArchiveSave();
            return { success: true, result, route: response.data.route || null };
        } catch (error) {
            crossFigureLogicState = {
                result: crossFigureLogicState.result,
                loading: false,
                error: error?.message || 'CROSS_FIGURE_LOGIC_FAILED'
            };
            throw error;
        } finally {
            crossFigureLogicPromise = null;
        }
    })();
    return crossFigureLogicPromise;
}

async function analyzeFiguresWithLLM(options = {}) {
    if (figureAnalysisPromise) return figureAnalysisPromise;
    const analysisDepth = options.analysisDepth === 'standard' ? 'standard' : 'deep';
    const operation = beginFigureOperation('batch');
    figureAnalysisPromise = (async () => {
        const startedAt = Date.now();
        const results = [];
        const failures = [];
        let figures = [];
        let cacheHits = 0;
        let visionFallbacks = 0;
        figureProgressById.clear();
        updateFigureAnalysisStatus({
            running: true,
            phase: 'extracting',
            currentFigure: 0,
            totalFigures: 0,
            completedFigures: 0,
            failedFigures: 0,
            figureLabel: '',
            message: '正在识别论文中的主文 Figure…',
            failures: [],
            cacheHits: 0,
            visionFallbacks: 0,
            startedAt
        });

        try {
            const previousFigureState = new Map(figureWalkthroughState);
            invalidateCrossFigureLogic();
            figureWalkthroughState.clear();
            clearFigureWalkthroughs();
            const extractedParagraphs = extractArticleWithTrace('analyze_figures');
            figures = SciLLM.extractArticleFigures(document, extractedParagraphs);
            figureWorkspaceInventory = figures;
            if (!figures.length) {
                const error = new Error('未找到可识别的主文 Figure');
                error.code = 'NO_FIGURES';
                throw error;
            }
            const paragraphs = extractedParagraphs.map(({ sourceIndex, ...paragraph }) => paragraph);
            figures.forEach((figure, index) => {
                updateFigureProgress(figure.figureId, {
                    figureId: figure.figureId,
                    figureLabel: figure.figureLabel,
                    expectedPanels: figure.panelHints,
                    expectedPanelCount: Array.isArray(figure.panelHints) ? figure.panelHints.length : 0,
                    phase: 'queued',
                    running: false,
                    completedFigures: 0,
                    totalFigures: figures.length,
                    startedAt,
                    queueIndex: index
                });
            });
            updateFigureAnalysisStatus({
                phase: 'preparing',
                totalFigures: figures.length,
                message: '共发现 ' + figures.length + ' 张主文 Figure，正在准备第 1 张…'
            });

            for (let index = 0; index < figures.length; index += 1) {
                await waitForLocalOperation(operation);
                const figure = figures[index];
                const currentFigure = index + 1;
                updateFigureAnalysisStatus({
                    phase: 'preparing',
                    currentFigure,
                    totalFigures: figures.length,
                    figureLabel: figure.figureLabel,
                    message: '正在准备第 ' + currentFigure + '/' + figures.length + ' 张：' + figure.figureLabel
                });
                updateFigureProgress(figure.figureId, {
                    phase: 'preparing',
                    running: true,
                    completedFigures: results.length,
                    totalFigures: figures.length,
                    figureLabel: figure.figureLabel,
                    expectedPanels: figure.panelHints,
                    expectedPanelCount: Array.isArray(figure.panelHints) ? figure.panelHints.length : 0
                });
                showLlmPageStatus(
                    '正在准备 ' + figure.figureLabel + '（' + currentFigure + '/' + figures.length + '）…'
                );

                try {
                    const images = await prepareFigureImages(figure);
                    await waitForLocalOperation(operation);
                    const figureInputHash = buildFigureInputHash(figure, images);
                    const previous = previousFigureState.get(figure.figureId);
                    figureWalkthroughState.set(figure.figureId, {
                        figure,
                        figureInputHash,
                        standard: analysisDepth === 'standard'
                            ? null : (previous?.figureInputHash === figureInputHash ? previous.standard : null),
                        standardError: '',
                        deep: analysisDepth === 'deep'
                            ? null : (previous?.figureInputHash === figureInputHash ? previous.deep : null),
                        activeDepth: analysisDepth,
                        deepLoading: false,
                        deepError: '',
                        panelFollowups: previous?.panelFollowups || {},
                        panelFollowupLoading: {},
                        panelFollowupErrors: previous?.panelFollowupErrors || {},
                        panelAnalyses: previous?.panelAnalyses || {},
                        panelAnalysisLoading: {},
                        panelAnalysisErrors: previous?.panelAnalysisErrors || {},
                        expanded: previous?.expanded === true
                    });
                    updateFigureAnalysisStatus({
                        phase: 'analyzing',
                        message: '正在解读第 ' + currentFigure + '/' + figures.length + ' 张：' + figure.figureLabel
                    });
                    const response = await chrome.runtime.sendMessage({
                        type: 'LLM_ANALYZE_FIGURES',
                        analysisDepth,
                        operationId: operation.operationId,
                        document: { title: document.title, paragraphs },
                        figureProgressOffset: index,
                        figureProgressTotal: figures.length,
                        figures: [{
                            figureId: figure.figureId,
                            figureLabel: figure.figureLabel,
                            caption: figure.caption,
                            panelHints: figure.panelHints,
                            contextParagraphs: figure.contextParagraphs,
                            images
                        }]
                    });
                    if (!response?.success) {
                        const error = new Error(response?.error?.message || 'Figure 解读失败');
                        error.code = response?.error?.code || 'FIGURE_FAILED';
                        throw error;
                    }
                    if (!isCurrentFigureOperation(operation)) throwStaleFigureOperation(operation);
                    const result = response.data?.figureResults?.[0];
                    if (!result) {
                        const error = new Error('Figure 解读未返回结果');
                        error.code = 'INVALID_RESPONSE';
                        throw error;
                    }
                    const operationResult = { ...result, operationId: operation.operationId };
                    const state = figureWalkthroughState.get(figure.figureId);
                    if (state) {
                        state[analysisDepth] = operationResult;
                        state.standardError = '';
                    }
                    results.push(operationResult);
                    cacheHits += Number(response.data.cacheHits) || 0;
                    visionFallbacks += Number(response.data.visionFallbacks) || 0;
                    lastFigureAnalysis = {
                        figures: results.length,
                        totalFigures: figures.length,
                        failedFigures: failures.length,
                        cacheHits,
                        visionFallbacks,
                        route: response.data.route || null,
                        failures: [...failures],
                        operationId: operation.operationId,
                        results: [...results]
                    };
                    updateFigureAnalysisStatus({
                        phase: 'analyzing',
                        completedFigures: results.length,
                        failedFigures: failures.length,
                        cacheHits,
                        visionFallbacks,
                        message: figure.figureLabel + ' 已完成，准备下一张…'
                    });
                } catch (error) {
                    if (error?.code === 'CANCELLED' || operation.cancelled) throw error;
                    const failure = {
                        figureId: figure.figureId,
                        figureLabel: figure.figureLabel,
                        code: error?.code || 'FIGURE_FAILED',
                        message: error?.message || 'Figure 解读失败'
                    };
                    const state = figureWalkthroughState.get(figure.figureId);
                    if (state) {
                        state.standard = null;
                        state.standardError = `${failure.code}: ${failure.message}`;
                        state.activeDepth = 'standard';
                    }
                    failures.push(failure);
                    updateFigureProgress(figure.figureId, {
                        phase: 'failed',
                        running: false,
                        completed: false,
                        failed: true,
                        completedFigures: results.length,
                        totalFigures: figures.length,
                        figureLabel: figure.figureLabel,
                        errorCode: failure.code
                    });
                    lastFigureAnalysis = {
                        figures: results.length,
                        totalFigures: figures.length,
                        failedFigures: failures.length,
                        cacheHits,
                        visionFallbacks,
                        failures: [...failures],
                        results: [...results]
                    };
                    updateFigureAnalysisStatus({
                        phase: SciLLM.isFatalFigureBatchError(error) ? 'failed' : 'analyzing',
                        completedFigures: results.length,
                        failedFigures: failures.length,
                        failures,
                        cacheHits,
                        visionFallbacks,
                        message: '第 ' + currentFigure + '/' + figures.length + ' 张失败：' +
                            figure.figureLabel + '；' +
                            (SciLLM.isFatalFigureBatchError(error) ? '无法继续处理' : '继续下一张')
                    });
                    if (SciLLM.isFatalFigureBatchError(error)) throw error;
                    showLlmPageStatus(
                        figure.figureLabel + ' 解读失败，已保留成功结果并继续下一张：' + failure.message,
                        'error'
                    );
                    continue;
                }
            }

            if (!results.length) {
                const error = new Error('全部 ' + figures.length + ' 张 Figure 解读失败');
                error.code = 'FIGURE_BATCH_FAILED';
                error.failures = failures;
                throw error;
            }

            const partial = failures.length > 0;
            lastFigureAnalysis = {
                figures: results.length,
                totalFigures: figures.length,
                failedFigures: failures.length,
                cacheHits,
                visionFallbacks,
                operationId: operation.operationId,
                route: lastFigureAnalysis?.route || null,
                failures: [...failures],
                results: [...results]
            };
            const finalMessage = partial
                ? '逐图解读完成 ' + results.length + '/' + figures.length + ' 张，' + failures.length + ' 张失败'
                : '逐图解读完成：' + results.length + ' 张 Figure';
            updateFigureAnalysisStatus({
                running: false,
                phase: partial ? 'partial' : 'completed',
                completedFigures: results.length,
                failedFigures: failures.length,
                figureLabel: '',
                message: finalMessage,
                failures,
                cacheHits,
                visionFallbacks,
                route: lastFigureAnalysis?.route || null
            });
            showLlmPageStatus(
                finalMessage +
                (visionFallbacks ? '，其中 ' + visionFallbacks + ' 张仅使用图注与正文' : '') +
                (partial ? '；成功结果已保留，重试会复用缓存' : ''),
                partial ? 'error' : 'success'
            );
            setTimeout(() => showLlmPageStatus(null), partial ? 8000 : 5000);
            scheduleCurrentArticleArchiveSave();
            return {
                success: true,
                analyzedCount: results.length,
                failedCount: failures.length,
                totalCount: figures.length,
                partial,
                operationId: operation.operationId,
                failures,
                cacheHits,
                visionFallbacks
            };
        } catch (error) {
            const cancelled = error?.code === 'CANCELLED' || operation.cancelled;
            cancelPendingFigureProgress(figures, {
                completedFigures: results.length,
                errorCode: cancelled ? 'CANCELLED' : (error?.code || 'FIGURE_BATCH_CANCELLED')
            });
            updateFigureAnalysisStatus({
                running: false,
                paused: false,
                phase: cancelled ? 'cancelled' : 'failed',
                totalFigures: figures.length,
                completedFigures: results.length,
                failedFigures: failures.length,
                message: cancelled
                    ? 'Figure 解读已取消，已完成结果会保留。'
                    : (error?.message || '逐图解读失败'),
                failures,
                cacheHits,
                visionFallbacks
            });
            throw error;
        }
    })();
    try {
        return await figureAnalysisPromise;
    } catch (error) {
        if (error?.code === 'CANCELLED' || operation.cancelled) {
            showLlmPageStatus('Figure 解读已取消，已完成结果会保留。', 'success');
            return {
                success: false,
                cancelled: true,
                code: 'CANCELLED',
                operationId: operation.operationId
            };
        }
        showLlmPageStatus('逐图解读失败：' + error.message, 'error');
        throw error;
    } finally {
        figureAnalysisPromise = null;
        finishFigureOperation(operation);
    }
}

function setReviewOutlineDepth(depth) {
    if (!['major', 'all_sections', 'paragraphs'].includes(depth)) return;
    reviewOutlineDepth = depth;
    if (lastReviewOutline) renderReviewOutlinePanel(lastReviewOutline);
}

function formatReviewRole(value, fallback = '') {
    const raw = String(value || '').trim();
    if (!raw) return fallback;
    const normalized = raw.toLowerCase().replace(/[\s-]+/g, '_');
    if (REVIEW_ROLE_LABELS[normalized]) return REVIEW_ROLE_LABELS[normalized];
    return /[\u3400-\u9fff]/.test(raw) ? raw : raw.replace(/_/g, ' ');
}

function normalizeArticleNavigatorText(value) {
    return String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
}

function safeArticleQuery(selector) {
    if (!selector) return null;
    try {
        return document.querySelector(selector);
    } catch (_) {
        return null;
    }
}

function extractCurrentArticleStructure({ forceRefresh = false } = {}) {
    const extracted = extractArticleStructureWithTrace('article_workspace', { forceRefresh });
    currentArticleStructure = typeof SciLLM.reconcileArticleStructure === 'function'
        ? SciLLM.reconcileArticleStructure(currentArticleStructure, extracted)
        : extracted;
    canonicalArticleSnapshotCache = null;
    return currentArticleStructure;
}

function getCanonicalArticleSnapshot({ forceRefresh = false } = {}) {
    const structure = forceRefresh || !currentArticleStructure
        ? extractCurrentArticleStructure({ forceRefresh })
        : currentArticleStructure;
    const documentHash = String(
        currentManualDocument?.record?.documentHash ||
        lastPreparedStudy?.documentHash ||
        SciLLM.structureSignature?.(structure) || ''
    );
    const revision = Math.max(1, Number(structure?.revision) || 1);
    const key = `${documentHash}:${revision}`;
    const url = String(globalThis.location?.href || '');
    if (!forceRefresh && canonicalArticleSnapshotCache?.key === key &&
        canonicalArticleSnapshotCache?.url === url) {
        return canonicalArticleSnapshotCache.snapshot;
    }
    const paragraphs = Array.isArray(structure?.paragraphs)
        ? structure.paragraphs : [];
    const typedRecords = Array.isArray(structure?.typedRecords)
        ? structure.typedRecords : paragraphs;
    const bodyParagraphCount = paragraphs.length;
    const archiveParagraphCount = bodyParagraphCount;
    const chatParagraphCount = bodyParagraphCount;
    const snapshot = Object.freeze({
        key,
        documentHash,
        revision,
        url,
        structure,
        typedRecords,
        paragraphs,
        bodyParagraphCount,
        archiveParagraphCount,
        chatParagraphCount,
        diagnostics: Object.freeze({
            ...(structure?.diagnostics || {}),
            paragraphCount: bodyParagraphCount,
            bodyParagraphCount,
            recordCount: typedRecords.length
        })
    });
    canonicalArticleSnapshotCache = { key, url, snapshot };
    return snapshot;
}

function getArticleStructureObserveRoots() {
    const adapter = typeof SciLLM.selectPublisherAdapter === 'function'
        ? SciLLM.selectPublisherAdapter(globalThis.location)
        : null;
    const selectors = [
        ...(adapter?.stabilitySelectors || []),
        ...(adapter?.articleRootSelectors || [])
    ];
    const candidates = [];
    selectors.slice(0, 60).forEach(selector => {
        try {
            document.querySelectorAll(selector).forEach(element => {
                if (element && !candidates.includes(element)) candidates.push(element);
            });
        } catch (_) { /* Ignore stale publisher selectors. */ }
    });
    if (!candidates.length && document.body) candidates.push(document.body);
    return candidates
        .filter(candidate => !candidates.some(other =>
            other !== candidate && other.contains?.(candidate)))
        .slice(0, 6);
}

function stopArticleStructureObserver() {
    if (articleStructureObserver) articleStructureObserver.disconnect();
    articleStructureObserver = null;
    if (articleStructureRefreshTimer !== null) {
        clearTimeout(articleStructureRefreshTimer);
        articleStructureRefreshTimer = null;
    }
}

function isArticleStructureMutation(mutation) {
    return [...(mutation?.addedNodes || [])].some(node => {
        const element = node?.nodeType === Node.ELEMENT_NODE
            ? node : node?.parentElement;
        if (!element || element.closest?.('[data-sci-plugin-ui]')) return false;
        if (element.matches?.('.sci-highlight,.sci-llm-highlight,.sci-manual-highlight')) {
            return false;
        }
        const selector =
            'article,section,h1,h2,h3,h4,h5,h6,[role="heading"],p,li,caption,' +
            'blockquote,dd,[role="paragraph"],div[class*="paragraph" i],div[class*="para" i]';
        if (element.matches?.(selector) || element.querySelector?.(selector)) return true;
        const adapter = typeof SciLLM.selectPublisherAdapter === 'function'
            ? SciLLM.selectPublisherAdapter(globalThis.location) : null;
        return [...(adapter?.headingSelectors || []), ...(adapter?.paragraphSelectors || [])]
            .some(adapterSelector => {
                try {
                    return element.matches?.(adapterSelector) ||
                        Boolean(element.querySelector?.(adapterSelector));
                } catch (_) {
                    return false;
                }
            });
    });
}

function startArticleStructureObserver() {
    stopArticleStructureObserver();
    articleStructureObserver = new MutationObserver(mutations => {
        if (!mutations.some(isArticleStructureMutation)) return;
        if (articleStructureRefreshTimer !== null) {
            clearTimeout(articleStructureRefreshTimer);
        }
        articleStructureRefreshTimer = setTimeout(() => {
            articleStructureRefreshTimer = null;
            const previousRevision = currentArticleStructure?.revision || 0;
            const next = extractCurrentArticleStructure({ forceRefresh: true });
            if (next.revision !== previousRevision &&
                document.getElementById('sci-article-navigator-host')) {
                renderArticleNavigator(next);
            }
            if (next.revision !== previousRevision) {
                chrome.runtime.sendMessage({
                    type: 'ARTICLE_STRUCTURE_CHANGED',
                    revision: Number(next.revision) || 0,
                    paragraphCount: next.paragraphs?.length || 0
                }).catch(() => {});
            }
        }, 450);
    });
    getArticleStructureObserveRoots().forEach(root => {
        articleStructureObserver.observe(root, { childList: true, subtree: true });
    });
}

function flattenArticleNodes(nodes = currentArticleStructure?.nodes || []) {
    return typeof SciLLM.flattenStructureNodes === 'function'
        ? SciLLM.flattenStructureNodes(nodes)
        : nodes.flatMap(node => [node, ...flattenArticleNodes(node.children || [])]);
}

function resolveArticleAnchor(anchor = {}) {
    const direct = safeArticleQuery(anchor.dataSelector);
    if (direct) return direct;
    if (anchor.domId) {
        const byId = document.getElementById(anchor.domId);
        if (byId) return byId;
    }
    const headingText = normalizeArticleNavigatorText(anchor.headingText).toLowerCase();
    if (!headingText) return null;
    const adapter = typeof SciLLM.selectPublisherAdapter === 'function'
        ? SciLLM.selectPublisherAdapter(globalThis.location)
        : null;
    const selectors = [
        ...(adapter?.headingSelectors || []),
        'h1,h2,h3,h4,h5,h6,[role="heading"]'
    ];
    const seen = new Set();
    const candidates = [];
    for (const selector of selectors) {
        let headings = [];
        try {
            headings = [...document.querySelectorAll(selector)];
        } catch (_) {
            continue;
        }
        const exact = headings.find(element => {
            if (seen.has(element)) return false;
            seen.add(element);
            candidates.push(element);
            return normalizeArticleNavigatorText(element.textContent).toLowerCase() === headingText;
        });
        if (exact) return exact;
    }
    return candidates.find(element => {
        const candidate = normalizeArticleNavigatorText(element.textContent).toLowerCase();
        return candidate && (
            candidate.includes(headingText) || headingText.includes(candidate)
        );
    }) || null;
}

function focusArticleSource(anchor) {
    const source = resolveArticleAnchor(anchor);
    if (!source) return false;
    source.scrollIntoView({ behavior: 'smooth', block: 'center' });
    source.classList.add('sci-article-source-focus');
    setTimeout(() => source.classList.remove('sci-article-source-focus'), 1800);
    return true;
}

function buildArticleSummaryIndex() {
    const sections = new Map();
    const paragraphs = new Map();
    const outlines = [
        lastReviewOutline,
        ...articleSectionOutlines.values()
    ].filter(Boolean);
    function visit(node) {
        const sectionId = String(node?.sectionId || '');
        const titleKey = normalizeArticleNavigatorText(node?.title).toLowerCase();
        if (node?.summary || node?.sectionRole) {
            const value = {
                summary: node.summary || '',
                sectionRole: node.sectionRole || '',
                transitionFromPrevious: node.transitionFromPrevious || ''
            };
            if (sectionId) sections.set(sectionId, value);
            if (titleKey && !sections.has(`title:${titleKey}`)) {
                sections.set(`title:${titleKey}`, value);
            }
        }
        (Array.isArray(node?.paragraphs) ? node.paragraphs : []).forEach(paragraph => {
            paragraphs.set(String(paragraph.paragraphId || ''), paragraph);
        });
        (Array.isArray(node?.children) ? node.children : []).forEach(visit);
    }
    outlines.forEach(outline => (outline.nodes || []).forEach(visit));
    return { sections, paragraphs };
}

function collectPageHighlightOccurrences(structure) {
    const categoryMap = {
        ...(typeof SciLLM.createBuiltInCategories === 'function'
            ? SciLLM.createBuiltInCategories() : {})
    };
    (lastLlmAnalysis?.rawAnalysis?.categories || []).forEach(category => {
        categoryMap[category.categoryId] = category;
    });
    currentManualCategories.forEach(category => {
        categoryMap[category.categoryId] = category;
    });
    const paragraphsBySource = new Map();
    (structure?.paragraphs || []).forEach(paragraph => {
        paragraphsBySource.set(String(paragraph.sourceKey || ''), paragraph);
        paragraphsBySource.set(String(paragraph.paragraphId || ''), paragraph);
    });
    const occurrences = [];
    const marks = [...document.querySelectorAll(
        '.sci-highlight,.sci-llm-highlight,.sci-manual-highlight'
    )];
    marks.forEach((mark, markIndex) => {
        const highlightId = mark.dataset.sciDistributionId ||
            `sci-distribution-${markIndex + 1}`;
        mark.dataset.sciDistributionId = highlightId;
        const paragraphSourceId = mark.closest?.('[data-sci-llm-paragraph-id]')
            ?.dataset?.sciLlmParagraphId || '';
        const paragraph = paragraphsBySource.get(paragraphSourceId);
        const source = mark.dataset.source ||
            (mark.classList.contains('sci-manual-highlight') ? 'manual' :
                mark.classList.contains('sci-llm-highlight') ? 'llm' : 'regex');
        const categoryIds = source === 'llm'
            ? String(mark.dataset.categories || mark.dataset.categoryId || '')
                .split(',').filter(Boolean)
            : [mark.dataset.categoryId || mark.dataset.category || 'uncategorized'];
        categoryIds.forEach(categoryId => {
            const category = categoryMap[categoryId] || {};
            occurrences.push({
                highlightId,
                paragraphId: paragraph?.paragraphId || '',
                sectionId: paragraph?.sectionId || '',
                categoryId,
                categoryName: mark.dataset.categoryName || category.name || categoryId,
                color: mark.dataset.categoryColor || category.color ||
                    mark.style.borderBottomColor || '#D9D6CE',
                source,
                quote: normalizeArticleNavigatorText(mark.textContent).slice(0, 240)
            });
        });
    });
    return occurrences;
}

function serializeArticleWorkspaceNode(node, paragraphCounts) {
    return {
        sectionId: String(node?.sectionId || ''),
        sourceKey: String(node?.sourceKey || ''),
        title: normalizeArticleNavigatorText(node?.title) || '未命名章节',
        level: Math.max(1, Number(node?.level) || 1),
        order: Number(node?.order) || 0,
        paragraphCount: paragraphCounts.get(String(node?.sectionId || '')) || 0,
        children: (Array.isArray(node?.children) ? node.children : [])
            .map(child => serializeArticleWorkspaceNode(child, paragraphCounts))
    };
}

function buildFigureWorkspaceSnapshot({ forceRefresh = false } = {}) {
    const inventory = getFigureWorkspaceInventory({ forceRefresh });
    const restoredById = new Map(
        (Array.isArray(restoredFigureWorkspaceSnapshot?.figures)
            ? restoredFigureWorkspaceSnapshot.figures : [])
            .map(figure => [String(figure?.figureId || ''), figure])
    );
    const figures = inventory.map(figure => {
        const state = figureWalkthroughState.get(figure.figureId);
        const restored = restoredById.get(String(figure.figureId || '')) || null;
        const source = state || restored || {};
        return {
            figureId: String(figure?.figureId || ''),
            figureLabel: String(figure?.figureLabel || ''),
            hasImage: Boolean(SciLLM.selectFigureImageSource(figure, document.baseURI)),
            caption: normalizeArticleNavigatorText(figure?.caption).slice(0, 2400),
            isSupplemental: figure?.isSupplemental === true,
            panelHints: Array.isArray(figure?.panelHints) ? figure.panelHints.slice(0, 30) : [],
            activeDepth: source.activeDepth === 'standard' ? 'standard' : 'deep',
            standard: source.standard || null,
            standardError: String(source.standardError || ''),
            deep: source.deep || null,
            deepLoading: source.deepLoading === true,
            deepError: String(source.deepError || ''),
            panelFollowups: source.panelFollowups || {},
            panelFollowupLoading: source.panelFollowupLoading || {},
            panelFollowupErrors: source.panelFollowupErrors || {},
            panelAnalyses: source.panelAnalyses || {},
            panelAnalysisLoading: source.panelAnalysisLoading || {},
            panelAnalysisErrors: source.panelAnalysisErrors || {},
            expanded: source.expanded === true
        };
    });
    if (!figures.length && restoredFigureWorkspaceSnapshot) {
        return {
            ...restoredFigureWorkspaceSnapshot,
            figures: Array.isArray(restoredFigureWorkspaceSnapshot.figures)
                ? restoredFigureWorkspaceSnapshot.figures : []
        };
    }
    return {
        status: getPublicFigureAnalysisStatus(),
        figures,
        totalFigures: figures.length,
        failedFigures: Number(lastFigureAnalysis?.failedFigures) || 0,
        crossFigureLogic: {
            result: crossFigureLogicState.result,
            loading: crossFigureLogicState.loading === true,
            error: String(crossFigureLogicState.error || '')
        }
    };
}

function buildArticleWorkspaceSnapshot({ forceRefresh = false } = {}) {
    const canonicalSnapshot = getCanonicalArticleSnapshot({ forceRefresh });
    const structure = canonicalSnapshot.structure;
    const paragraphCounts = new Map();
    canonicalSnapshot.paragraphs.forEach(paragraph => {
        const sectionId = String(paragraph.sectionId || '');
        paragraphCounts.set(sectionId, (paragraphCounts.get(sectionId) || 0) + 1);
    });
    const highlightDistribution = SciLLM.buildHighlightDistribution(
        structure,
        collectPageHighlightOccurrences(structure)
    );
    return {
        title: document.title,
        url: globalThis.location?.href || '',
        publisherFamily: structure.publisherFamily || 'generic',
        revision: Number(structure.revision) || 0,
        diagnostics: {
            headingCount: Number(structure.diagnostics?.headingCount) || 0,
            paragraphCount: canonicalSnapshot.bodyParagraphCount,
            bodyParagraphCount: canonicalSnapshot.bodyParagraphCount,
            archiveParagraphCount: canonicalSnapshot.archiveParagraphCount,
            chatParagraphCount: canonicalSnapshot.chatParagraphCount,
            figureCaptionCount: Number(structure.diagnostics?.figureCaptionCount) || 0,
            tableCaptionCount: Number(structure.diagnostics?.tableCaptionCount) || 0,
            referenceCount: Number(structure.diagnostics?.referenceCount) || 0,
            warnings: [...(structure.diagnostics?.warnings || [])]
        },
        nodes: (structure.nodes || []).map(node =>
            serializeArticleWorkspaceNode(node, paragraphCounts)),
        paragraphs: canonicalSnapshot.paragraphs.map(paragraph => ({
            paragraphId: String(paragraph.paragraphId || ''),
            sourceKey: String(paragraph.sourceKey || ''),
            textHash: String(paragraph.textHash || ''),
            navigationRevision: Number(structure.revision) || 0,
            sectionId: String(paragraph.sectionId || ''),
            sectionTitle: normalizeArticleNavigatorText(paragraph.sectionTitle),
            sectionPath: (Array.isArray(paragraph.headingPath) ? paragraph.headingPath : [])
                .map(item => normalizeArticleNavigatorText(item?.title)).filter(Boolean),
            text: normalizeArticleNavigatorText(paragraph.text).slice(0, 4000)
        })),
        highlightDistribution,
        ledger: lastLlmAnalysis?.rawAnalysis?.ledger || null,
        readingViewId: lastLlmAnalysis?.rawAnalysis?.readingViewId || '',
        studyProfile: lastLlmAnalysis?.rawAnalysis?.studyProfile || null,
        reviewOutline: lastReviewOutline || null,
        paragraphSummaries: Array.from(standaloneReviewParagraphSummaries.values()),
        chat: getPublicArticleChatState(),
        llmTask: {
            running: Boolean(llmOperationState.active && !llmOperationState.active.cancelled),
            paused: llmOperationState.active?.paused === true,
            canPause: Boolean(llmOperationState.active && !llmOperationState.active.cancelled),
            cancelled: llmOperationState.active?.cancelled === true,
            operationId: llmOperationState.active?.operationId || '',
            phase: llmOperationState.active?.cancelled
                ? 'cancelled' : llmOperationState.active?.paused ? 'paused'
                    : llmOperationState.active ? 'analyzing' : 'idle'
        },
        figures: buildFigureWorkspaceSnapshot({ forceRefresh })
    };
}

function buildCurrentArticleArchive() {
    const documentRecord = currentManualDocument?.record || lastPreparedStudy?.record;
    const documentId = currentManualDocument?.documentId ||
        lastPreparedStudy?.documentId || documentRecord?.documentId;
    if (!documentId || !documentRecord) {
        throw new Error('ARTICLE_ARCHIVE_DOCUMENT_NOT_READY');
    }
    const snapshot = buildArticleWorkspaceSnapshot();
    const figureWorkspace = buildFigureWorkspaceSnapshot();
    const activeEngine = document.querySelector('.sci-llm-highlight')
        ? 'llm' : document.querySelector('.sci-highlight') ? 'regex' : '';
    return SciLLM.createArticleArchive({
        revision: Date.now(),
        extensionVersion: chrome.runtime.getManifest?.().version || '',
        identity: {
            documentId,
            documentHash: currentManualDocument?.record?.documentHash ||
                lastPreparedStudy?.documentHash || '',
            canonicalUrl: documentRecord.canonicalUrl || snapshot.url,
            title: documentRecord.title || snapshot.title,
            publisher: snapshot.publisherFamily
        },
        documentRecord,
        workspace: {
            navigation: snapshot,
            activeEngine,
            lastRegexRequest: lastRegexHighlightRequest,
            llm: lastLlmAnalysis ? {
                rawAnalysis: lastLlmAnalysis.rawAnalysis,
                paragraphs: lastLlmAnalysis.paragraphs,
                extractionDiagnostics: lastLlmAnalysis.extractionDiagnostics,
                confidenceThreshold: lastLlmAnalysis.threshold ||
                    lastLlmDiagnostics?.confidenceThreshold || 0.8
            } : null,
            diagnostics: lastLlmDiagnostics,
            reviewOutline: lastReviewOutline,
            figureWorkspace,
            figures: figureWorkspace.figures,
            chat: snapshot.chat,
            ledger: snapshot.ledger,
            highlightDistribution: snapshot.highlightDistribution
        }
    });
}

async function persistCurrentArticleArchive() {
    const archive = buildCurrentArticleArchive();
    const response = await chrome.runtime.sendMessage({
        type: 'ARTICLE_ARCHIVE_SAVE',
        archive
    });
    if (!response?.success) {
        throw new Error(response?.error?.message || 'ARTICLE_ARCHIVE_SAVE_FAILED');
    }
    return response.data;
}

function scheduleCurrentArticleArchiveSave() {
    clearTimeout(articleArchiveSaveTimer);
    articleArchiveSaveTimer = setTimeout(() => {
        articleArchiveSaveTimer = null;
        persistCurrentArticleArchive().catch(() => undefined);
    }, 350);
}

async function applyArticleArchiveSnapshot(input) {
    const archive = SciLLM.validateArticleArchive(input);
    const currentDocumentId = currentManualDocument?.documentId || lastPreparedStudy?.documentId || '';
    const currentCanonicalUrl = currentManualDocument?.record?.canonicalUrl || location.href;
    if (currentDocumentId && archive.documentId !== currentDocumentId) {
        const currentPath = SciLLM.articleArchiveRelativePath({
            documentId: currentDocumentId,
            canonicalUrl: currentCanonicalUrl
        });
        if (SciLLM.articleArchiveRelativePath(archive) !== currentPath) {
            throw new Error('ARCHIVE_IDENTITY_MISMATCH');
        }
    }
    const currentDocumentHash = currentManualDocument?.record?.documentHash ||
        lastPreparedStudy?.documentHash || '';
    const hashMatches = !archive.documentHash || !currentDocumentHash ||
        archive.documentHash === currentDocumentHash;
    const workspace = archive.workspace || {};
    let regexHighlights = 0;
    let aiHighlights = 0;

    lastRegexHighlightRequest = workspace.lastRegexRequest || null;
    if (lastRegexHighlightRequest?.categories && workspace.activeEngine !== 'llm') {
        const counts = highlighter.applyHighlight(
            lastRegexHighlightRequest.categories,
            lastRegexHighlightRequest.mode || 'word'
        );
        regexHighlights = Object.values(counts || {})
            .reduce((sum, value) => sum + (Number(value) || 0), 0);
    }

    const savedLlm = workspace.llm;
    if (savedLlm?.rawAnalysis && Array.isArray(savedLlm.paragraphs)) {
        if (hashMatches && workspace.activeEngine !== 'regex') {
            const rendered = renderLlmAnalysis(
                savedLlm.rawAnalysis,
                savedLlm.paragraphs,
                Number(savedLlm.confidenceThreshold) || 0.8,
                savedLlm.extractionDiagnostics || null
            );
            aiHighlights = Number(rendered.highlightedCount) || 0;
        } else {
            lastLlmAnalysis = {
                rawAnalysis: savedLlm.rawAnalysis,
                paragraphs: savedLlm.paragraphs,
                extractionDiagnostics: savedLlm.extractionDiagnostics || null,
                threshold: Number(savedLlm.confidenceThreshold) || 0.8
            };
            lastLlmDiagnostics = {
                ...(workspace.diagnostics || {}),
                restoredWithoutRanges: true
            };
        }
    }
    lastReviewOutline = workspace.reviewOutline || null;
    restoredFigureWorkspaceSnapshot = workspace.figureWorkspace || (
        Array.isArray(workspace.figures)
            ? { figures: workspace.figures, totalFigures: workspace.figures.length }
            : null
    );
    const restoredChat = workspace.chat;
    if (restoredChat && Array.isArray(restoredChat.turns)) {
        articleChatState = {
            turns: restoredChat.turns.map(publicArticleChatTurn).map(turn => ({
                ...turn,
                status: turn.status === 'generating' ? 'cancelled' : turn.status,
                operationId: '',
                error: turn.status === 'generating'
                    ? '浏览器关闭前的回答已中断，完整回答块已保留。' : turn.error
            })).filter(turn => turn.turnId && turn.question),
            loading: false,
            error: '',
            operationId: '',
            activeTurnId: '',
            coverage: restoredChat.coverage || null,
            memoryNeedsRebuild: restoredChat.memoryNeedsRebuild === true
        };
    } else if (restoredChat && Array.isArray(restoredChat.messages)) {
        articleChatState = {
            messages: restoredChat.messages.map(message => ({
                role: message?.role === 'assistant' ? 'assistant' : 'user',
                content: String(message?.content || '').slice(0, 32000),
                profileId: String(message?.profileId || '').slice(0, 100),
                profileName: String(message?.profileName || '').slice(0, 200),
                model: String(message?.model || '').slice(0, 200),
                evidence: (Array.isArray(message?.evidence) ? message.evidence : []).slice(0, 12)
                    .map(item => ({
                        paragraphId: String(item?.paragraphId || '').slice(0, 120),
                        sourceKey: String(item?.sourceKey || item?.paragraphId || '').slice(0, 120),
                        textHash: String(item?.textHash || '').slice(0, 120),
                        sectionTitle: String(item?.sectionTitle || '').slice(0, 300),
                        sectionPath: (Array.isArray(item?.sectionPath) ? item.sectionPath : [])
                            .slice(-12).map(entry => String(
                                typeof entry === 'string' ? entry : entry?.title || ''
                            ).slice(0, 300)).filter(Boolean),
                        quote: String(item?.quote || '').slice(0, 2000),
                        support: String(item?.support || '').slice(0, 1600),
                        documentRevision: Math.max(0, Number(item?.documentRevision) || 0),
                        verificationStatus: String(item?.verificationStatus || '').slice(0, 32),
                        candidateCount: Math.max(0, Number(item?.candidateCount) || 0),
                        verificationReason: String(item?.verificationReason || '').slice(0, 120)
                    })),
                limitations: String(message?.limitations || '').slice(0, 4000),
                createdAt: Number(message?.createdAt) || Date.now()
            })).filter(message => message.content),
            loading: false,
            error: '',
            operationId: '',
            activeProfileId: '',
            coverage: restoredChat.coverage || null
        };
    }
    if (Array.isArray(articleChatState.messages)) {
        const legacyMessages = articleChatState.messages;
        const migratedTurns = [];
        legacyMessages.forEach(message => {
            if (message.role === 'user') {
                migratedTurns.push(createArticleChatTurn(
                    message.content,
                    message.profileId || 'profile_legacy',
                    { turnId: `turn-legacy-${migratedTurns.length + 1}` }
                ));
                return;
            }
            const turn = migratedTurns.at(-1);
            if (!turn || turn.answerBlocks.length) return;
            turn.answerBlocks = [publicArticleChatBlock({
                blockId: `block-legacy-${migratedTurns.length}`,
                markdown: message.content,
                evidence: message.evidence,
                createdAt: message.createdAt
            })];
            turn.status = 'completed';
            turn.profileName = message.profileName;
            turn.model = message.model;
            turn.updatedAt = message.createdAt;
        });
        articleChatState = {
            turns: migratedTurns,
            loading: false,
            error: '',
            operationId: '',
            activeTurnId: '',
            coverage: restoredChat?.coverage || null,
            memoryNeedsRebuild: true
        };
    }
    const restoredCrossFigureLogic = restoredFigureWorkspaceSnapshot?.crossFigureLogic;
    if (restoredCrossFigureLogic?.result) {
        crossFigureLogicState = {
            result: restoredCrossFigureLogic.result,
            loading: false,
            error: String(restoredCrossFigureLogic.error || '')
        };
    }
    await prepareManualDocument();
    return {
        success: true,
        partial: !hashMatches,
        hashMatches,
        regexHighlights,
        aiHighlights,
        manualAnnotations: currentManualDocument?.record?.annotations?.length || 0,
        reviewOutlineRestored: Boolean(lastReviewOutline),
        figuresRestored: restoredFigureWorkspaceSnapshot?.figures?.length || 0
    };
}

function resolveWorkspaceParagraph(target = {}) {
    let structure = currentArticleStructure || extractCurrentArticleStructure();
    const targetRevision = Number(target?.navigationRevision);
    const navigationRevisionMismatch = Number.isFinite(targetRevision) && targetRevision > 0 &&
        targetRevision !== Number(structure?.revision || 0);
    let paragraph = SciLLM.resolveArticleStructureParagraph(structure, target);
    if (!paragraph || navigationRevisionMismatch) {
        structure = extractCurrentArticleStructure({ forceRefresh: true });
        paragraph = SciLLM.resolveArticleStructureParagraph(structure, target);
    }
    return paragraph || null;
}

function verifyAndFocusArticleChatCitation(target = {}) {
    let snapshot = getCanonicalArticleSnapshot();
    const requestedRevision = Math.max(
        0,
        Number(target?.documentRevision || target?.navigationRevision) || 0
    );
    const revisionChanged = Boolean(requestedRevision &&
        requestedRevision !== Number(snapshot?.revision || 0));
    if (revisionChanged) snapshot = getCanonicalArticleSnapshot({ forceRefresh: true });
    const evidence = {
        ...(target?.evidence || target),
        documentRevision: Number(snapshot?.revision) || 0
    };
    const verification = SciLLM.verifyArticleChatEvidence(evidence, snapshot);
    if (verification.status !== 'verified' || !verification.target) {
        return { ...verification, focused: false, revisionChanged };
    }
    const paragraph = resolveWorkspaceParagraph(verification.target);
    if (!paragraph || !focusArticleSource(paragraph.anchor)) {
        return {
            ...verification,
            status: 'missing',
            reason: 'SOURCE_ANCHOR_MISSING',
            target: null,
            focused: false,
            revisionChanged
        };
    }
    return { ...verification, focused: true, revisionChanged };
}

function focusArticleWorkspaceSource(target = {}) {
    if (target.kind === 'article-chat-citation') {
        return verifyAndFocusArticleChatCitation(target);
    }
    if (target.kind === 'highlight') {
        return focusHighlightOccurrence({ highlightId: target.highlightId });
    }
    if (target.kind === 'evidence') {
        focusRelatedHighlights({
            annotationIds: Array.isArray(target.annotationIds) ? target.annotationIds : [],
            relationId: String(target.relationId || '')
        });
        return true;
    }
    if (target.kind === 'figure') {
        const figure = getFigureWorkspaceInventory().find(item => item.figureId === target.figureId);
        const element = figure?.captionElement || figure?.element;
        if (!element?.scrollIntoView) return false;
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        element.classList?.add('sci-article-source-focus');
        setTimeout(() => element.classList?.remove('sci-article-source-focus'), 1800);
        return true;
    }
    if (target.kind === 'paragraph') {
        const paragraph = resolveWorkspaceParagraph(target);
        return paragraph ? focusArticleSource(paragraph.anchor) : false;
    }
    const structure = currentArticleStructure || extractCurrentArticleStructure();
    const node = flattenArticleNodes(structure.nodes).find(item =>
        item.sectionId === target.sectionId || item.sourceKey === target.sourceKey);
    return node ? focusArticleSource(node.anchor) : false;
}

function focusHighlightOccurrence(occurrence) {
    const id = String(occurrence?.highlightId || '');
    const escaped = globalThis.CSS?.escape
        ? CSS.escape(id) : id.replace(/["\\]/g, '\\$&');
    const mark = safeArticleQuery(`[data-sci-distribution-id="${escaped}"]`);
    if (!mark) return false;
    mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
    mark.classList.add('sci-article-source-focus');
    setTimeout(() => mark.classList.remove('sci-article-source-focus'), 1800);
    return true;
}

function renderHighlightDistribution(container, structure) {
    const distribution = SciLLM.buildHighlightDistribution(
        structure,
        collectPageHighlightOccurrences(structure)
    );
    if (!distribution.totalHighlights) {
        const empty = document.createElement('div');
        empty.className = 'sci-article-empty';
        empty.textContent = '当前页面还没有可归类的自动或手动高亮。';
        container.appendChild(empty);
        return;
    }

    const scroll = document.createElement('div');
    scroll.className = 'sci-highlight-matrix-scroll';
    const table = document.createElement('table');
    table.className = 'sci-highlight-matrix';
    const head = document.createElement('thead');
    const headRow = document.createElement('tr');
    const sectionHead = document.createElement('th');
    sectionHead.scope = 'col';
    sectionHead.textContent = '章节';
    headRow.appendChild(sectionHead);
    distribution.categories.forEach(category => {
        const cell = document.createElement('th');
        cell.scope = 'col';
        cell.textContent = category.name;
        cell.style.borderTopColor = category.color;
        headRow.appendChild(cell);
    });
    head.appendChild(headRow);
    table.appendChild(head);

    const body = document.createElement('tbody');
    const nodeMap = new Map(flattenArticleNodes(structure.nodes)
        .map(node => [node.sectionId, node]));
    distribution.rows.forEach(row => {
        const tableRow = document.createElement('tr');
        const labelCell = document.createElement('th');
        labelCell.scope = 'row';
        const jump = document.createElement('button');
        jump.type = 'button';
        jump.className = 'sci-highlight-matrix-section';
        jump.textContent = row.title;
        jump.addEventListener('click', () => {
            const node = nodeMap.get(row.sectionId);
            if (node) focusArticleSource(node.anchor);
        });
        labelCell.appendChild(jump);
        tableRow.appendChild(labelCell);
        distribution.categories.forEach(category => {
            const cell = document.createElement('td');
            const value = row.cells[category.categoryId];
            if (value?.count) {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'sci-highlight-matrix-cell';
                button.textContent = String(value.count);
                button.setAttribute(
                    'aria-label',
                    `${row.title}中的${category.name}高亮 ${value.count} 处`
                );
                button.addEventListener('click', () =>
                    focusHighlightOccurrence(value.items[0]));
                cell.appendChild(button);
            }
            tableRow.appendChild(cell);
        });
        body.appendChild(tableRow);
    });
    table.appendChild(body);
    scroll.appendChild(table);
    container.appendChild(scroll);

    if (distribution.unresolved.length) {
        const unresolved = document.createElement('p');
        unresolved.className = 'sci-article-diagnostic';
        unresolved.textContent =
            `${distribution.unresolved.length} 处高亮暂未绑定到章节，但仍保留在正文中。`;
        container.appendChild(unresolved);
    }
}

function findArticleNode(sectionId) {
    return flattenArticleNodes().find(node => node.sectionId === sectionId) || null;
}

function descendantArticleSectionIds(node) {
    return [
        node.sourceKey || node.sectionId,
        ...(node.children || []).flatMap(descendantArticleSectionIds)
    ];
}

async function summarizeArticleSection(sectionId) {
    const node = findArticleNode(sectionId);
    if (!node) throw new Error('无法定位当前章节');
    return analyzeReviewOutlineWithLLM({
        documentId: lastPreparedStudy?.documentId,
        documentHash: lastPreparedStudy?.documentHash,
        sectionId,
        scopeSectionIds: descendantArticleSectionIds(node)
    });
}

function renderArticleOutline(container, structure) {
    const flat = flattenArticleNodes(structure.nodes);
    const minimumLevel = flat.reduce(
        (minimum, node) => Math.min(minimum, Number(node.level) || 6),
        6
    );
    const majorLimit = Math.min(6, minimumLevel + 1);
    const summaryIndex = buildArticleSummaryIndex();
    const structureParagraphs = new Map(
        (structure.paragraphs || []).map(paragraph => [paragraph.sectionId, []])
    );
    (structure.paragraphs || []).forEach(paragraph => {
        structureParagraphs.get(paragraph.sectionId)?.push(paragraph);
    });

    const toolbar = document.createElement('div');
    toolbar.className = 'sci-article-toolbar';
    const depthOptions = [
        ['major', '主章节'],
        ['all', '全部标题']
    ];
    depthOptions.forEach(([value, label]) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        button.setAttribute('aria-pressed', String(articleNavigatorState.depth === value));
        button.addEventListener('click', () => {
            articleNavigatorState.depth = value;
            renderArticleNavigator(structure);
        });
        toolbar.appendChild(button);
    });
    const hasSummaries = Boolean(lastReviewOutline || articleSectionOutlines.size);
    const summaries = document.createElement('button');
    summaries.type = 'button';
    summaries.textContent = hasSummaries
        ? (articleNavigatorState.summariesVisible ? '隐藏摘要' : '显示摘要')
        : '生成逐段摘要';
    summaries.addEventListener('click', () => {
        if (hasSummaries) {
            articleNavigatorState.summariesVisible =
                !articleNavigatorState.summariesVisible;
            renderArticleNavigator(structure);
            return;
        }
        analyzeReviewOutlineWithLLM({
            documentId: lastPreparedStudy?.documentId,
            documentHash: lastPreparedStudy?.documentHash
        }).then(() => {
            articleNavigatorState.summariesVisible = true;
            renderArticleNavigator(currentArticleStructure);
        }).catch(() => {});
    });
    toolbar.appendChild(summaries);
    container.appendChild(toolbar);

    const tree = document.createElement('div');
    tree.className = 'sci-article-tree';
    tree.setAttribute('role', 'tree');

    function renderNode(node, parent) {
        if (articleNavigatorState.depth === 'major' &&
            Number(node.level) > majorLimit) return;
        const item = document.createElement('section');
        item.className = 'sci-article-node';
        item.dataset.level = String(node.level);
        item.setAttribute('role', 'treeitem');
        const initiallyExpanded = Number(node.level) <= minimumLevel;
        const expanded = articleNavigatorState.expandedSectionIds.has(node.sectionId) ||
            initiallyExpanded;
        const row = document.createElement('div');
        row.className = 'sci-article-node-row';

        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'sci-article-node-toggle';
        toggle.textContent = expanded ? '收起' : '展开';
        toggle.setAttribute('aria-expanded', String(expanded));
        toggle.setAttribute('aria-label', `${expanded ? '收起' : '展开'}${node.title}`);
        row.appendChild(toggle);

        const jump = document.createElement('button');
        jump.type = 'button';
        jump.className = 'sci-article-node-jump';
        jump.textContent = node.title || '未命名章节';
        jump.addEventListener('click', () => focusArticleSource(node.anchor));
        row.appendChild(jump);

        const count = document.createElement('span');
        count.className = 'sci-article-node-count';
        count.textContent = `${(structureParagraphs.get(node.sectionId) || []).length} 段`;
        row.appendChild(count);
        item.appendChild(row);

        const children = document.createElement('div');
        children.className = 'sci-article-node-children';
        children.hidden = !expanded;
        toggle.addEventListener('click', () => {
            const nextExpanded = children.hidden;
            children.hidden = !nextExpanded;
            toggle.textContent = nextExpanded ? '收起' : '展开';
            toggle.setAttribute('aria-expanded', String(nextExpanded));
            if (nextExpanded) articleNavigatorState.expandedSectionIds.add(node.sectionId);
            else articleNavigatorState.expandedSectionIds.delete(node.sectionId);
        });

        if (articleNavigatorState.summariesVisible) {
            const sectionSummary = summaryIndex.sections.get(node.sourceKey) ||
                summaryIndex.sections.get(node.sectionId) ||
                summaryIndex.sections.get(
                    `title:${normalizeArticleNavigatorText(node.title).toLowerCase()}`
                );
            if (sectionSummary?.summary) {
                const summary = document.createElement('p');
                summary.className = 'sci-article-section-summary';
                summary.textContent = sectionSummary.summary;
                children.appendChild(summary);
            }
            (structureParagraphs.get(node.sectionId) || []).forEach(paragraph => {
                const paragraphSummary = summaryIndex.paragraphs.get(paragraph.sourceKey) ||
                    summaryIndex.paragraphs.get(paragraph.paragraphId);
                if (!paragraphSummary) return;
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'sci-article-paragraph-summary';
                button.textContent = paragraphSummary.summary || '暂无摘要';
                button.addEventListener('click', () => focusArticleSource(paragraph.anchor));
                children.appendChild(button);
            });
        }

        if ((structureParagraphs.get(node.sectionId) || []).length) {
            const sectionSummaryAction = document.createElement('button');
            sectionSummaryAction.type = 'button';
            sectionSummaryAction.className = 'sci-article-section-summary-action';
            sectionSummaryAction.textContent = '摘要本节';
            sectionSummaryAction.addEventListener('click', () => {
                sectionSummaryAction.disabled = true;
                sectionSummaryAction.textContent = '正在摘要本节';
                summarizeArticleSection(node.sectionId)
                    .then(() => {
                        articleNavigatorState.summariesVisible = true;
                        renderArticleNavigator(currentArticleStructure);
                    })
                    .catch(() => {
                        sectionSummaryAction.disabled = false;
                        sectionSummaryAction.textContent = '摘要本节';
                    });
            });
            children.appendChild(sectionSummaryAction);
        }

        (node.children || []).forEach(child => renderNode(child, children));
        item.appendChild(children);
        parent.appendChild(item);
    }

    (structure.nodes || []).forEach(node => renderNode(node, tree));
    if (!tree.children.length) {
        const empty = document.createElement('div');
        empty.className = 'sci-article-empty';
        empty.textContent = '暂未识别到稳定的正文标题；页面继续加载时会自动补全。';
        tree.appendChild(empty);
    }
    container.appendChild(tree);
}

function renderArticleNavigator(structure = currentArticleStructure) {
    closeReadingPanel();
    document.getElementById('sci-article-navigator-host')?.remove();
    document.getElementById('sci-review-outline-host')?.remove();
    if (!structure) return null;

    const host = document.createElement('div');
    host.id = 'sci-article-navigator-host';
    host.dataset.sciPluginUi = 'article-navigator';
    host.style.setProperty('all', 'initial', 'important');
    host.style.setProperty('display', 'block', 'important');
    const shadowRoot = host.attachShadow({ mode: 'open' });
    const stylesheet = document.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = chrome.runtime.getURL('content.css');
    shadowRoot.appendChild(stylesheet);

    const panel = document.createElement('aside');
    panel.id = 'sci-article-navigator-panel';
    panel.setAttribute('aria-label', '论文导航');
    const header = document.createElement('header');
    header.className = 'sci-article-navigator-header';
    const title = document.createElement('strong');
    title.textContent = '论文导航';
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = '关闭';
    close.addEventListener('click', () => {
        stopArticleStructureObserver();
        host.remove();
    });
    header.append(title, close);
    panel.appendChild(header);

    const tabs = document.createElement('div');
    tabs.className = 'sci-article-tabs';
    tabs.setAttribute('role', 'tablist');
    [
        ['outline', '结构大纲'],
        ['highlights', '高亮分布']
    ].forEach(([value, label]) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.setAttribute('role', 'tab');
        button.textContent = label;
        button.setAttribute('aria-selected', String(articleNavigatorState.activeTab === value));
        button.addEventListener('click', () => {
            articleNavigatorState.activeTab = value;
            renderArticleNavigator(structure);
        });
        tabs.appendChild(button);
    });
    panel.appendChild(tabs);

    const status = document.createElement('div');
    status.className = 'sci-article-status';
    const extractionWarnings = Array.isArray(structure.diagnostics?.warnings)
        ? structure.diagnostics.warnings : [];
    const challengeBlocked = extractionWarnings.includes('NON_ARTICLE_CHALLENGE');
    status.classList.toggle('sci-article-status-warning', challengeBlocked);
    status.textContent = challengeBlocked
        ? '\u9875\u9762\u5904\u4e8e\u51fa\u7248\u793e\u5b89\u5168\u9a8c\u8bc1\uff1b\u5b8c\u6210\u9a8c\u8bc1\u5e76\u5237\u65b0\u540e\u518d\u751f\u6210\u5927\u7eb2'
        : `${structure.publisherFamily || 'generic'} · ` +
          `${structure.diagnostics?.headingCount || 0} 个标题 · ` +
          `${structure.diagnostics?.paragraphCount || 0} 段正文`;
    panel.appendChild(status);

    const content = document.createElement('div');
    content.className = 'sci-article-content';
    if (articleNavigatorState.activeTab === 'highlights') {
        renderHighlightDistribution(content, structure);
    } else {
        renderArticleOutline(content, structure);
    }
    panel.appendChild(content);
    shadowRoot.appendChild(panel);
    document.body.appendChild(host);
    return panel;
}

function showArticleNavigator(options = {}) {
    if (options.tab === 'outline' || options.tab === 'highlights') {
        articleNavigatorState.activeTab = options.tab;
    }
    const structure = extractCurrentArticleStructure();
    const warnings = Array.isArray(structure.diagnostics?.warnings)
        ? structure.diagnostics.warnings : [];
    const challengeBlocked = warnings.includes('NON_ARTICLE_CHALLENGE');
    return {
        success: true,
        blocked: challengeBlocked,
        warnings,
        headingCount: structure.diagnostics?.headingCount || 0,
        paragraphCount: structure.diagnostics?.paragraphCount || 0,
        publisherFamily: structure.publisherFamily,
        strategy: structure.strategy,
        snapshot: buildArticleWorkspaceSnapshot()
    };
}

function renderReviewOutlinePanel(outline) {
    closeReadingPanel();
    document.getElementById('sci-review-outline-host')?.remove();
    document.getElementById('sci-review-outline-panel')?.remove();
    if (!outline || !Array.isArray(outline.nodes)) return null;

    const host = document.createElement('div');
    host.id = 'sci-review-outline-host';
    host.style.setProperty('all', 'initial', 'important');
    host.style.setProperty('display', 'block', 'important');
    const shadowRoot = host.attachShadow({ mode: 'open' });
    const stylesheet = document.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = chrome.runtime.getURL('content.css');
    shadowRoot.appendChild(stylesheet);

    const panel = document.createElement('aside');
    panel.id = 'sci-review-outline-panel';
    panel.setAttribute('aria-label', '综述结构大纲');

    const header = document.createElement('header');
    header.className = 'sci-review-outline-header';
    const heading = document.createElement('strong');
    heading.textContent = '综述结构大纲';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'sci-review-outline-close';
    close.textContent = '关闭';
    close.addEventListener('click', () => host.remove());
    header.append(heading, close);
    panel.appendChild(header);

    const depthBar = document.createElement('div');
    depthBar.className = 'sci-review-outline-depth';
    const depthLabels = {
        major: '主要层级',
        all_sections: '全部章节',
        paragraphs: '深入到段落'
    };
    Object.entries(depthLabels).forEach(([depth, label]) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        button.setAttribute('aria-pressed', String(reviewOutlineDepth === depth));
        button.addEventListener('click', () => setReviewOutlineDepth(depth));
        depthBar.appendChild(button);
    });
    panel.appendChild(depthBar);

    const content = document.createElement('div');
    content.className = 'sci-review-outline-content';

    function appendText(parent, label, value, className = '') {
        if (!value) return;
        const row = document.createElement('p');
        if (className) row.className = className;
        const strong = document.createElement('strong');
        strong.textContent = label + '：';
        const text = document.createElement('span');
        text.textContent = String(value);
        row.append(strong, text);
        parent.appendChild(row);
    }

    appendText(content, '全文中心命题', outline.paperThesis, 'sci-review-outline-thesis');
    appendText(content, '作者组织策略', outline.organizationStrategy,
        'sci-review-outline-strategy');

    if (!outline.globalSynthesisAvailable) {
        const fallback = document.createElement('div');
        fallback.className = 'sci-review-outline-fallback';
        const fallbackText = document.createElement('span');
        fallbackText.textContent = '全局组织综合暂不可用；以下标题层级和逐段摘要仍可正常阅读。';
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.textContent = '重试全局综合';
        retry.addEventListener('click', () => {
            analyzeReviewOutlineWithLLM({ forceRefresh: true }).catch(() => {});
        });
        fallback.append(fallbackText, retry);
        content.appendChild(fallback);
    }

    function focusSourceParagraph(paragraphId) {
        const escaped = globalThis.CSS?.escape
            ? CSS.escape(paragraphId)
            : String(paragraphId).replace(/["\\]/g, '\\$&');
        const source = document.querySelector(
            '[data-sci-llm-paragraph-id="' + escaped + '"]'
        );
        if (!source) return;
        source.scrollIntoView({ behavior: 'smooth', block: 'center' });
        source.classList.add('sci-review-source-focus');
        setTimeout(() => source.classList.remove('sci-review-source-focus'), 1800);
    }

    function renderNode(node, parent) {
        if (reviewOutlineDepth === 'major' && Number(node.level) > 2) return;
        const details = document.createElement('details');
        details.className = 'sci-review-outline-node';
        details.dataset.level = String(Number(node.level) || 1);
        details.open = Number(node.level) <= 1;
        const summary = document.createElement('summary');
        const title = document.createElement('span');
        title.className = 'sci-review-outline-title';
        title.textContent = node.title || '未命名章节';
        summary.appendChild(title);
        if (node.sectionRole) {
            const role = document.createElement('span');
            role.className = 'sci-review-outline-role';
            role.textContent = formatReviewRole(node.sectionRole);
            summary.appendChild(role);
        }
        details.appendChild(summary);
        appendText(details, '本节作用', node.summary, 'sci-review-outline-section-summary');
        appendText(details, '与前节关系', node.transitionFromPrevious,
            'sci-review-outline-transition');

        if (reviewOutlineDepth === 'paragraphs') {
            (Array.isArray(node.paragraphs) ? node.paragraphs : []).forEach(paragraph => {
                const item = document.createElement('button');
                item.type = 'button';
                item.className = 'sci-review-outline-paragraph';
                item.dataset.paragraphId = paragraph.paragraphId;
                const role = document.createElement('span');
                role.className = 'sci-review-outline-role';
                role.textContent = formatReviewRole(paragraph.rhetoricalRole, '其他');
                const summaryText = document.createElement('span');
                summaryText.className = 'sci-review-outline-paragraph-summary';
                summaryText.textContent = paragraph.summary || '暂无摘要';
                item.append(role, summaryText);
                if (paragraph.keyPoint) {
                    const keyPoint = document.createElement('small');
                    keyPoint.textContent = '论证贡献：' + paragraph.keyPoint;
                    item.appendChild(keyPoint);
                }
                if (paragraph.transitionFromPrevious) {
                    const transition = document.createElement('small');
                    transition.textContent = '段间关系：' + paragraph.transitionFromPrevious;
                    item.appendChild(transition);
                }
                item.addEventListener('click', () => focusSourceParagraph(paragraph.paragraphId));
                details.appendChild(item);
            });
        }

        (Array.isArray(node.children) ? node.children : [])
            .forEach(child => renderNode(child, details));
        parent.appendChild(details);
    }

    outline.nodes.forEach(node => renderNode(node, content));

    if (Array.isArray(outline.keyTensions) && outline.keyTensions.length) {
        const tensions = document.createElement('details');
        tensions.className = 'sci-review-outline-tensions';
        const summary = document.createElement('summary');
        summary.textContent = '关键分歧与开放问题';
        tensions.appendChild(summary);
        outline.keyTensions.forEach(tension => {
            const block = document.createElement('section');
            appendText(block, '议题', tension.topic);
            (Array.isArray(tension.positions) ? tension.positions : []).forEach(position => {
                const text = document.createElement('p');
                text.textContent = '• ' + position;
                block.appendChild(text);
            });
            appendText(block, '当前解决或开放状态', tension.resolutionOrOpenQuestion);
            tensions.appendChild(block);
        });
        content.appendChild(tensions);
    }

    panel.appendChild(content);
    shadowRoot.appendChild(panel);
    document.body.appendChild(host);
    return panel;
}

async function analyzeReviewParagraphWithLLM(target = {}) {
    const paragraph = resolveWorkspaceParagraph(target);
    if (!paragraph) {
        const error = new Error('该段落已更新或不再存在，请刷新文章导航后重试');
        error.code = 'PARAGRAPH_STALE';
        throw error;
    }
    const structure = currentArticleStructure || extractCurrentArticleStructure();
    const preparedParagraphs = SciLLM.toReviewParagraphRecords(structure);
    const paragraphId = String(paragraph.paragraphId || '');
    return analyzeReviewOutlineWithLLM({
        documentId: target.documentId,
        documentHash: target.documentHash,
        scopeId: `paragraph:${paragraphId}`,
        scopeParagraphIds: [paragraphId],
        preparedParagraphs: preparedParagraphs
    });
}

async function analyzeReviewOutlineWithLLM(options = {}) {
    if (reviewOutlinePromise) {
        const error = new Error('逐段摘要任务正在运行，请稍候');
        error.code = 'REVIEW_OUTLINE_BUSY';
        throw error;
    }
    reviewOutlinePromise = (async () => {
        updateReviewOutlineStatus({
            running: true, phase: 'extracting', completedParagraphs: 0,
            totalParagraphs: 0, completedChunks: 0, totalChunks: 0,
            message: '正在提取综述正文与标题层级…',
            globalSynthesisAvailable: null
        });
        showLlmPageStatus('正在提取综述正文与标题层级…');
        try {
            const suppliedParagraphs = Array.isArray(options.preparedParagraphs)
                ? options.preparedParagraphs : null;
            const extracted = suppliedParagraphs
                ? null : extractArticleWithTrace('review_outline');
            const preparedOutlineParagraphs = suppliedParagraphs ||
                SciLLM.prepareReviewOutlineParagraphs(
                    extracted, { articleTitle: document.title }
                );
            const allParagraphs = preparedOutlineParagraphs
                .map(({ sourceIndex, ...paragraph }) => paragraph);
            const requestedParagraphIds = new Set(
                (Array.isArray(options.scopeParagraphIds) ? options.scopeParagraphIds : [])
                    .map(value => String(value || '').trim()).filter(Boolean)
            );
            const scopeSectionIds = new Set(
                Array.isArray(options.scopeSectionIds) ? options.scopeSectionIds : []
            );
            const paragraphs = requestedParagraphIds.size
                ? allParagraphs.filter(paragraph =>
                    requestedParagraphIds.has(String(paragraph.paragraphId || '')))
                : scopeSectionIds.size
                    ? allParagraphs.filter(paragraph =>
                        scopeSectionIds.has(paragraph.sectionId) ||
                        (paragraph.headingPath || []).some(heading =>
                            scopeSectionIds.has(heading.sectionId)))
                    : allParagraphs;
            if (!paragraphs.length) throw new Error('未找到可生成大纲的论文正文');
            const paragraphOnly = requestedParagraphIds.size === 1;
            const outlineSectionCount = new Set(
                paragraphs.map(paragraph => paragraph.sectionId).filter(Boolean)
            ).size;
            const excludedOutlineUnitCount = Math.max(
                0, (extracted?.length || preparedOutlineParagraphs.length) -
                    preparedOutlineParagraphs.length
            );
            const coverageNotice = outlineSectionCount
                ? '，已锁定 ' + outlineSectionCount + ' 个正文章节'
                : '';
            const exclusionNotice = excludedOutlineUnitCount
                ? '，已排除 ' + excludedOutlineUnitCount + ' 个网页功能区或非正文单元'
                : '';
            updateReviewOutlineStatus({
                phase: 'review_map', totalParagraphs: paragraphs.length,
                message: '正在生成逐段摘要（0/' + paragraphs.length + '）' +
                    coverageNotice + exclusionNotice + '…'
            });
            showLlmPageStatus(
                '已确认 ' + paragraphs.length + ' 个综述正文段落' +
                coverageNotice + exclusionNotice + '，正在分析…'
            );
            const response = await chrome.runtime.sendMessage({
                type: 'LLM_ANALYZE_REVIEW_OUTLINE',
                forceRefresh: options.forceRefresh === true,
                paragraphOnly,
                document: {
                    documentId: options.documentId,
                    previousDocumentHash: options.documentHash,
                    title: document.title,
                    paragraphs: paragraphOnly ? paragraphs : allParagraphs
                },
                documentProof: {
                    documentId: options.documentId,
                    documentHash: options.documentHash
                },
                scopeId: options.scopeId || options.sectionId || '',
                scopeParagraphIds: paragraphs.map(paragraph => paragraph.paragraphId)
            });
            if (!response?.success) {
                const error = new Error(response?.error?.message || '综述大纲生成失败');
                error.code = response?.error?.code;
                throw error;
            }
            const completedOutline = response.data.outline;
            const scopedSummaries = SciLLM.collectReviewParagraphSummaries(completedOutline);
            if (requestedParagraphIds.size) {
                scopedSummaries.forEach(item =>
                    standaloneReviewParagraphSummaries.set(item.paragraphId, item));
            } else if (options.sectionId) {
                articleSectionOutlines.set(options.sectionId, completedOutline);
            } else {
                lastReviewOutline = { ...completedOutline, route: response.data.route || null };
            }
            articleNavigatorState.summariesVisible = true;
            updateReviewOutlineStatus({
                running: false, phase: 'completed',
                completedParagraphs: completedOutline.paragraphCount || paragraphs.length,
                totalParagraphs: paragraphs.length,
                message: response.data.cacheHit ? '已从缓存恢复综述大纲' : '综述大纲已生成',
                globalSynthesisAvailable: completedOutline.globalSynthesisAvailable
            });
            showLlmPageStatus(formatEffectiveRoute(
                completedOutline.globalSynthesisAvailable
                    ? '综述大纲已生成' : '逐段大纲已生成；全局组织综合暂不可用', response.data.route
            ),
                completedOutline.globalSynthesisAvailable ? 'success' : 'error'
            );
            setTimeout(() => showLlmPageStatus(null), 6000);
            scheduleCurrentArticleArchiveSave();
            return {
                success: true,
                outline: completedOutline,
                paragraphSummary: requestedParagraphIds.size === 1
                    ? scopedSummaries.find(item =>
                        requestedParagraphIds.has(item.paragraphId)) || null
                    : null,
                cacheHit: response.data.cacheHit,
                nonReviewNotice: response.data.nonReviewNotice,
                route: response.data.route || null
            };
        } catch (error) {
            updateReviewOutlineStatus({
                running: false, phase: 'failed', message: error.message || '综述大纲生成失败'
            });
            showLlmPageStatus('综述大纲生成失败：' + error.message, 'error');
            throw error;
        }
    })();
    try {
        return await reviewOutlinePromise;
    } finally {
        reviewOutlinePromise = null;
    }
}

async function maybeAutoAnalyzeWithLLM() {
    try {
        const response = await chrome.runtime.sendMessage({ type: 'LLM_GET_SETTINGS' });
        if (response?.success && response.data.effectiveMode === 'llm' && response.data.settings.autoAnalyze) {
            await prepareArticleProfileWithLLM({ auto: true });
        }
    } catch (error) {
        console.warn('SCI高亮助手: 自动 LLM 分析未启动', error.message);
    }
}

// 创建高亮器实例
const highlighter = new SciPaperHighlighter();

// 监听来自popup的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'llmAnalysisProgress') {
        const progress = request.progress || {};
        if (progress.taskType === 'chat' || String(progress.phase || '').startsWith('chat_')) {
            applyArticleChatProgress(progress);
            sendResponse({ success: true });
            return;
        }
        if (progress.taskType === 'figure' || progress.figureId) {
            const figureProgress = applyFigureProgressEvent(progress);
            if (figureProgress) {
                showLlmPageStatus(formatFigureProgressMessage(figureProgress),
                    figureProgress.failed ? 'error' : undefined);
            }
            sendResponse({ success: true });
            return;
        }
        if (progress.phase === 'token_limit_retry') {
            showLlmPageStatus('模型不接受当前输出长度，正在降低令牌上限后重试…');
        } else if (progress.phase === 'output_token_retry') {
            showLlmPageStatus('输出长度不足，正在增加令牌上限后重试…');
        } else if (progress.phase === 'output_compact_retry') {
            showLlmPageStatus('输出被截断，正在改用紧凑 JSON 格式重试…');
        } else if (String(progress.phase || '').startsWith('review_')) {
            const completedParagraphs = Number(progress.completedParagraphs) || 0;
            const totalParagraphs = Number(progress.totalParagraphs) ||
                reviewOutlineStatus.totalParagraphs;
            const completedChunks = Number(progress.completedChunks) || 0;
            const totalChunks = Number(progress.totalChunks) || reviewOutlineStatus.totalChunks;
            let message = '正在生成逐段摘要（' + completedParagraphs + '/' + totalParagraphs + '）…';
            if (progress.phase === 'review_retry') {
                const seconds = Math.max(1, Math.ceil((Number(progress.waitMs) || 0) / 1000));
                const stageName = progress.stage === 'reduce' ? '全局组织综合' : '逐段摘要';
                message = progress.errorCode === 'INVALID_RESPONSE'
                    ? stageName + '格式不符合要求，正在自动纠正，' + seconds + ' 秒后重试…'
                    : stageName + '暂时繁忙，' + seconds + ' 秒后重试…';
            } else if (progress.phase === 'review_split') {
                message = progress.errorCode === 'INVALID_RESPONSE'
                    ? '当前返回格式仍不稳定，已自动拆小并继续（' +
                        completedParagraphs + '/' + totalParagraphs + '）…'
                    : '当前摘要分块过大或超时，已自动拆分并继续（' +
                        completedParagraphs + '/' + totalParagraphs + '）…';
            } else if (progress.phase === 'review_reduce') {
                message = '逐段摘要已完成，正在综合全文组织逻辑…';
            } else if (progress.phase === 'review_complete') {
                message = progress.globalSynthesisAvailable
                    ? '综述结构大纲已完成' : '逐段大纲已完成，全局组织综合暂不可用';
            }
            updateReviewOutlineStatus({
                phase: progress.phase,
                completedParagraphs,
                totalParagraphs,
                completedChunks,
                totalChunks,
                message,
                globalSynthesisAvailable: progress.phase === 'review_complete'
                    ? Boolean(progress.globalSynthesisAvailable)
                    : reviewOutlineStatus.globalSynthesisAvailable
            });
            showLlmPageStatus(message,
                progress.phase === 'review_complete' && !progress.globalSynthesisAvailable
                    ? 'error' : undefined);
        } else if (progress.phase === 'figure_retry') {
            const seconds = Math.max(1, Math.ceil((Number(progress.waitMs) || 0) / 1000));
            updateFigureAnalysisStatus({
                phase: 'retrying',
                currentFigure: (Number(progress.completedFigures) || 0) + 1,
                totalFigures: Number(progress.totalFigures) || figureAnalysisStatus.totalFigures,
                figureLabel: progress.figureLabel || figureAnalysisStatus.figureLabel,
                message: (progress.figureLabel || '当前 Figure') + ' 请求暂时失败，' +
                    seconds + ' 秒后自动重试第 ' + (Number(progress.attempt) || 1) + ' 次'
            });
            showLlmPageStatus(
                progress.figureLabel + ' 请求暂时失败，' + seconds + ' 秒后自动重试…'
            );
        } else if (progress.phase === 'figure_fallback') {
            updateFigureAnalysisStatus({
                phase: 'fallback',
                currentFigure: (Number(progress.completedFigures) || 0) + 1,
                totalFigures: Number(progress.totalFigures) || figureAnalysisStatus.totalFigures,
                figureLabel: progress.figureLabel || figureAnalysisStatus.figureLabel,
                message: (progress.figureLabel || '当前 Figure') +
                    ' 的视觉输入不受模型支持，正改用图注与正文继续'
            });
            showLlmPageStatus(
                progress.figureLabel + ' 的模型不支持当前视觉输入，已改用图注与正文继续解读…'
            );
        } else if (progress.phase === 'figure') {
            updateFigureAnalysisStatus({
                phase: 'analyzing',
                currentFigure: Number(progress.completedFigures) || figureAnalysisStatus.currentFigure,
                totalFigures: Number(progress.totalFigures) || figureAnalysisStatus.totalFigures,
                completedFigures: Number(progress.completedFigures) || figureAnalysisStatus.completedFigures,
                figureLabel: progress.figureLabel || figureAnalysisStatus.figureLabel,
                message: (progress.figureLabel || '当前 Figure') + ' 已完成'
            });
            showLlmPageStatus(
                '逐图解读 ' + progress.completedFigures + '/' + progress.totalFigures +
                '：' + progress.figureLabel + ' 已完成…'
            );
        } else if (progress.phase === 'retry') {
            const waitSeconds = Math.max(1, Math.ceil((Number(progress.waitMs) || 0) / 1000));
            const reason = progress.errorCode === 'RATE_LIMITED'
                ? '请求频率受限'
                : progress.errorCode === 'PROVIDER_UNAVAILABLE'
                    ? '模型服务暂时过载'
                    : '模型连接暂时不稳定';
            showLlmPageStatus(
                `${reason}，${waitSeconds} 秒后自动重试第 ${progress.attempt} 次（${progress.completedChunks + 1}/${progress.totalChunks}）…`
            );
        } else if (progress.phase === 'split') {
            const reason = progress.errorCode === 'REQUEST_TIMEOUT'
                ? '当前分块分析超时'
                : progress.errorCode === 'PROVIDER_UNAVAILABLE'
                    ? '模型持续繁忙'
                    : progress.errorCode === 'OUTPUT_TRUNCATED'
                        ? '当前分块输出过长'
                        : '当前分块需要降载';
            showLlmPageStatus(
                `${reason}，已自动拆分为更小分块并继续分析（已完成 ${progress.completedChunks}/${progress.totalChunks}）…`
            );
        } else if (progress.phase === 'chunk_checkpoint') {
            renderProgressiveLlmChunk(progress);
            showLlmPageStatus(
                `当前小块结果已渲染（${progress.checkpointedAnnotations || 0} 条候选），正在继续下一块…`
            );
        } else if (progress.phase === 'complete') {
            showLlmPageStatus(`LLM 已完成 ${progress.completedChunks}/${progress.totalChunks} 个分块…`);
        } else {
            showLlmPageStatus(`LLM 正在分析 ${progress.completedChunks + 1}/${progress.totalChunks} 个分块…`);
        }
        sendResponse({ success: true });
    } else if (request.action === 'getReviewOutlineStatus') {
        sendResponse({
            success: true,
            status: getPublicReviewOutlineStatus(),
            hasOutline: Boolean(lastReviewOutline),
            outline: lastReviewOutline ? {
                paragraphCount: lastReviewOutline.paragraphCount,
                globalSynthesisAvailable: lastReviewOutline.globalSynthesisAvailable,
                reviewSubtype: lastReviewOutline.reviewSubtype
            } : null
        });
    } else if (request.action === 'showReviewOutline') {
        if (lastReviewOutline) {
            sendResponse({ success: true, shown: true, outline: lastReviewOutline });
        } else {
            sendResponse({ success: true, shown: false, reason: 'NO_REVIEW_OUTLINE' });
        }
    } else if (request.action === 'getArticleWorkspaceSnapshot') {
        try {
            const snapshot = buildArticleWorkspaceSnapshot({
                forceRefresh: request.forceRefresh === true
            });
            if (!articleStructureObserver) startArticleStructureObserver();
            sendResponse({
                success: true,
                snapshot
            });
        } catch (error) {
            sendResponse({ success: false, error: error.message });
        }
    } else if (request.action === 'getArticleArchiveSnapshot') {
        try {
            sendResponse({ success: true, archive: buildCurrentArticleArchive() });
        } catch (error) {
            sendResponse({ success: false, error: error.message });
        }
    } else if (request.action === 'applyArticleArchiveSnapshot') {
        applyArticleArchiveSnapshot(request.archive)
            .then(result => sendResponse(result))
            .catch(error => sendResponse({ success: false, error: error.message }));
    } else if (request.action === 'focusArticleWorkspaceSource') {
        try {
            const focusResult = focusArticleWorkspaceSource(request.target || {});
            const citationResult = focusResult && typeof focusResult === 'object'
                ? focusResult : null;
            sendResponse({
                success: true,
                focused: citationResult ? citationResult.focused === true : Boolean(focusResult),
                citationResult
            });
        } catch (error) {
            sendResponse({ success: false, error: error.message });
        }
    } else if (request.action === 'armSidePanelRestore') {
        sendResponse({ success: true, armed: armSidePanelRestore() });
    } else if (request.action === 'disarmSidePanelRestore') {
        disarmSidePanelRestore();
        sendResponse({ success: true });
    } else if (request.action === 'getFigureWorkspaceSnapshot') {
        sendResponse({ success: true, snapshot: buildFigureWorkspaceSnapshot() });
    } else if (request.action === 'showArticleNavigator') {
        try {
            sendResponse(showArticleNavigator({ tab: request.tab }));
        } catch (error) {
            sendResponse({ success: false, error: error.message });
        }
    } else if (request.action === 'getFigureAnalysisStatus') {
        sendResponse({
            success: true,
            status: getPublicFigureAnalysisStatus(),
            analysis: lastFigureAnalysis ? {
                figures: lastFigureAnalysis.figures,
                totalFigures: lastFigureAnalysis.totalFigures,
                failedFigures: lastFigureAnalysis.failedFigures
            } : null
        });
    } else if (request.action === 'prepareManualAnnotations') {
        initializeManualAnnotationUi();
        prepareManualDocument()
            .then(() => sendResponse({
                success: true,
                documentId: currentManualDocument?.documentId || '',
                documentHash: currentManualDocument?.record?.documentHash || '',
                canonicalUrl: currentManualDocument?.record?.canonicalUrl || '',
                title: currentManualDocument?.record?.title || document.title,
                annotationCount: currentManualDocument?.record?.annotations?.length || 0,
                unresolvedCount: currentManualUnresolved.length
            }))
            .catch(error => sendResponse({ success: false, error: error.message }));
    } else if (request.action === 'clearAutomaticHighlights') {
        clearAutomaticHighlights();
        sendResponse({ success: true });
    } else if (request.action === 'clearManualAnnotations') {
        const cleared = request.completed === true &&
            clearManualAnnotationsAfterBackground(request.completionType);
        sendResponse({
            success: cleared,
            error: cleared ? undefined : '请先完成 ANNOTATION_CLEAR_DOCUMENT'
        });
    } else if (request.action === 'disableManualAnnotations') {
        disableManualAnnotationUi();
        sendResponse({ success: true });
    } else if (request.action === 'reinitializeManualAnnotations') {
        disableManualAnnotationUi();
        initializeManualAnnotationUi();
        prepareManualDocument()
            .then(() => sendResponse({
                success: true,
                documentId: currentManualDocument?.documentId || ''
            }))
            .catch(error => sendResponse({ success: false, error: error.message }));
    } else if (request.action === 'applyHighlight') {
        try {
            const counts = highlighter.applyHighlight(request.categories, request.mode);
            lastRegexHighlightRequest = {
                categories: request.categories,
                mode: request.mode === 'sentence' ? 'sentence' : 'word'
            };
            scheduleCurrentArticleArchiveSave();
            sendResponse({ success: true, counts: counts });
        } catch (error) {
            console.error('应用高亮失败:', error);
            sendResponse({ success: false, error: error.message });
        }
    } else if (request.action === 'clearHighlight') {
        try {
            highlighter.clearHighlight();
            sendResponse({ success: true });
        } catch (error) {
            console.error('清除高亮失败:', error);
            sendResponse({ success: false, error: error.message });
        }
    } else if (request.action === 'getMatchCounts') {
        try {
            const counts = highlighter.getMatchCounts(request.rules);
            sendResponse({ success: true, counts: counts });
        } catch (error) {
            console.error('获取匹配计数失败:', error);
            sendResponse({ success: false, error: error.message });
        }
    } else if (request.action === 'extractArticleForLLM') {
        try {
            const paragraphs = extractArticleWithTrace('popup_document_prepare', {
                forceRefresh: request.forceRefresh === true
            })
                .map(({ sourceIndex, ...paragraph }) => paragraph);
            sendResponse({
                success: true,
                document: {
                    title: document.title,
                    paragraphs
                }
            });
        } catch (error) {
            sendResponse({ success: false, error: error.message });
        }
    } else if (request.action === 'applyLlmConfidenceThreshold') {
        if (!lastLlmAnalysis) {
            sendResponse({ success: true, applied: false, reason: 'NO_ANALYSIS_ON_PAGE' });
        } else {
            const rendered = renderLlmAnalysis(
                lastLlmAnalysis.rawAnalysis,
                lastLlmAnalysis.paragraphs,
                request.threshold,
                lastLlmAnalysis.extractionDiagnostics
            );
            sendResponse({
                success: true,
                applied: true,
                highlightedCount: rendered.highlightedCount,
                hiddenConfidenceCount: rendered.hiddenCount,
                counts: rendered.counts,
                threshold: rendered.threshold
            });
        }
    } else if (request.action === 'getLlmDiagnostics') {
        try {
            if (!lastLlmDiagnostics) {
                lastLlmDiagnostics = {
                    extraction: diagnoseArticleWithTrace('popup_diagnostics'),
                    stage: 'ready'
                };
            }
            sendResponse({ success: true, diagnostics: lastLlmDiagnostics });
        } catch (error) {
            sendResponse({ success: false, error: error.message });
        }
    } else if (request.action === 'buildAdapterDiagnosticBundle') {
        try {
            const bundle = SciLLM.buildAdapterDiagnosticBundle(document, {
                extensionVersion: chrome.runtime.getManifest?.().version || '',
                contentRevision: document.documentElement.dataset.sciLlmContentRevision || '',
                trace: extractionTrace.snapshot(),
                extraction: {
                    available: Boolean(lastLlmDiagnostics || lastSuccessfulExtraction),
                    diagnostics: lastLlmDiagnostics?.extraction || null,
                    lastStage: lastLlmDiagnostics?.stage || '',
                    paragraphs: serializeLastExtractionForDiagnostic()
                },
                structure: lastSuccessfulStructure
            });
            sendResponse({ success: true, bundle });
        } catch (error) {
            sendResponse({ success: false, error: error.message });
        }
    } else if (request.action === 'exportPublisherDiagnostic') {
        try {
            const report = SciLLM.buildPublisherDiagnostic(document, {
                extensionVersion: chrome.runtime.getManifest?.().version || '',
                contentRevision: document.documentElement.dataset.sciLlmContentRevision || '',
                trace: extractionTrace.snapshot(),
                extraction: {
                    available: Boolean(lastLlmDiagnostics || lastSuccessfulExtraction),
                    diagnostics: lastLlmDiagnostics?.extraction || null,
                    lastStage: lastLlmDiagnostics?.stage || '',
                    paragraphs: serializeLastExtractionForDiagnostic()
                },
                structure: lastSuccessfulStructure
            });
            const filename = SciLLM.downloadPublisherDiagnostic(report, document);
            sendResponse({
                success: true,
                filename,
                candidateCount: report.candidates?.length || 0,
                publisherFamily: report.publisher?.family || 'generic'
            });
        } catch (error) {
            sendResponse({ success: false, error: error.message });
        }
    } else if (request.action === 'analyzeArticleWithLLM') {
        analyzeArticleWithLLM({
            auto: false,
            documentId: request.documentId,
            documentHash: request.documentHash
        })
            .then(result => sendResponse(result))
            .catch(error => sendResponse({ success: false, error: error.message, code: error.code }));
    } else if (request.action === 'controlLlmOperation') {
        controlLlmOperation(
            request.scope === 'figure' ? 'figure' : 'highlight',
            String(request.command || '')
        )
            .then(result => sendResponse(result))
            .catch(error => sendResponse({ success: false, error: error.message, code: error.code }));
    } else if (request.action === 'analyzeFiguresWithLLM') {
        analyzeFiguresWithLLM({ analysisDepth: request.analysisDepth })
            .then(result => sendResponse(result))
            .catch(error => sendResponse({ success: false, error: error.message, code: error.code }));
    } else if (request.action === 'analyzeSingleFigureWithLLM') {
        analyzeSingleFigureWithLLM(String(request.figureId || ''), {
            forceRefresh: request.forceRefresh === true
        })
            .then(result => sendResponse(result))
            .catch(error => sendResponse({ success: false, error: error.message, code: error.code }));
    } else if (request.action === 'analyzeSingleFigurePanelWithLLM') {
        analyzeSingleFigurePanelWithLLM(
            String(request.figureId || ''),
            String(request.panelId || ''),
            { forceRefresh: request.forceRefresh === true }
        )
            .then(result => sendResponse(result))
            .catch(error => sendResponse({ success: false, error: error.message, code: error.code }));
    } else if (request.action === 'askFigurePanelWithLLM') {
        askFigurePanelWithLLM(
            String(request.figureId || ''),
            String(request.panelId || ''),
            Array.isArray(request.topics) ? request.topics : [],
            String(request.customQuestion || '')
        )
            .then(result => sendResponse(result))
            .catch(error => sendResponse({ success: false, error: error.message, code: error.code }));
    } else if (request.action === 'askArticleWithLLM') {
        askArticleWithLLM(
            String(request.question || ''),
            String(request.profileId || '')
        )
            .then(result => sendResponse(result))
            .catch(error => sendResponse({ success: false, error: error.message, code: error.code }));
    } else if (request.action === 'cancelArticleChatWithLLM') {
        cancelArticleChatWithLLM()
            .then(result => sendResponse(result))
            .catch(error => sendResponse({ success: false, error: error.message, code: error.code }));
    } else if (request.action === 'deleteArticleChatTurn') {
        try {
            sendResponse(removeArticleChatTurn(String(request.turnId || '')));
        } catch (error) {
            sendResponse({ success: false, error: error.message, code: error.code });
        }
    } else if (request.action === 'deleteArticleChatAnswer') {
        try {
            sendResponse(deleteArticleChatAnswer(String(request.turnId || '')));
        } catch (error) {
            sendResponse({ success: false, error: error.message, code: error.code });
        }
    } else if (request.action === 'deleteQueuedArticleChatTurn') {
        try {
            sendResponse(removeArticleChatTurn(
                String(request.turnId || ''), { queuedOnly: true }
            ));
        } catch (error) {
            sendResponse({ success: false, error: error.message, code: error.code });
        }
    } else if (request.action === 'regenerateArticleChatTurn') {
        try {
            sendResponse(regenerateArticleChatTurn(
                String(request.turnId || ''), String(request.profileId || '')
            ));
        } catch (error) {
            sendResponse({ success: false, error: error.message, code: error.code });
        }
    } else if (request.action === 'clearArticleChat') {
        try {
            sendResponse(clearArticleChat());
        } catch (error) {
            sendResponse({ success: false, error: error.message, code: error.code });
        }
    } else if (request.action === 'showFigureOriginalImage') {
        sendResponse(showFigureImageViewer(String(request.figureId || '')));
    } else if (request.action === 'analyzeCrossFigureLogicWithLLM') {
        analyzeCrossFigureLogicWithLLM({ forceRefresh: request.forceRefresh === true })
            .then(result => sendResponse(result))
            .catch(error => sendResponse({ success: false, error: error.message, code: error.code }));
    } else if (request.action === 'analyzeReviewParagraphWithLLM') {
        const target = {
            paragraphId: String(request.paragraphId || '').trim(),
            sourceKey: String(request.sourceKey || '').trim(),
            navigationRevision: request.navigationRevision,
            documentId: request.documentId,
            documentHash: request.documentHash
        };
        analyzeReviewParagraphWithLLM(target)
            .then(result => sendResponse({
                ...result,
                paragraphSummary: result.paragraphSummary ||
                    standaloneReviewParagraphSummaries.get(target.paragraphId) || null
            }))
            .catch(error => sendResponse({
                success: false, error: error.message, code: error.code
            }));
    } else if (request.action === 'analyzeReviewOutlineWithLLM') {
        analyzeReviewOutlineWithLLM({
            forceRefresh: request.forceRefresh === true,
            documentId: request.documentId,
            documentHash: request.documentHash
        })
            .then(result => sendResponse(result))
            .catch(error => sendResponse({ success: false, error: error.message, code: error.code }));
    }
    
    return true; // 保持消息通道开放
});

console.log('SCI论文逻辑关系高亮助手已加载');
