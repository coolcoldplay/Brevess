// 内容脚本 - 在网页上执行高亮
document.documentElement.dataset.sciLlmContentRevision =
    '1.0.0-build1-store-release';
document.documentElement.dataset.sciReaderSingleColumn = 'true';
document.documentElement.dataset.sciPublisherFamily =
    globalThis.SciLLM?.selectPublisherAdapter?.(location)?.family || 'generic';
class SciPaperHighlighter {
    constructor() {
        this.highlightedElements = [];
        this.originalContents = new Map();
        this.matchCounts = {}; // 存储每个类别的匹配次数
        this.activeAnalysisModeId = '';
    }

    // 应用高亮
    applyHighlight(categories, mode, options = {}) {
        const analysisModeId = String(options.analysisModeId || 'regex-default');
        this.activeAnalysisModeId = analysisModeId;
        this.allowedParagraphIds = options.allowedParagraphIds instanceof Set
            ? options.allowedParagraphIds
            : Array.isArray(options.allowedParagraphIds)
                ? new Set(options.allowedParagraphIds.map(String)) : null;
        // 仅替换当前分析模式的正则高亮，保留其他模式已生成的结果。
        this.clearHighlight(analysisModeId);
        this.activeAnalysisModeId = analysisModeId;
        
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
        
        this.activeAnalysisModeId = '';
        return this.matchCounts;
    }

    // 构建正则表达式
    buildRegexes(categories) {
        const regexes = [];
        
        Object.entries(categories).forEach(([key, category]) => {
            const excludeRegexes = (Array.isArray(category.excludePatterns)
                ? category.excludePatterns : [])
                .map(pattern => {
                    try { return new RegExp(pattern, 'gi'); } catch (_) { return null; }
                })
                .filter(Boolean);
            if (category.isRegex) {
                // 正则表达式模式
                const regex = new RegExp(category.patterns[0], 'gi');
                regexes.push({
                    regex: regex,
                    category: key,
                    color: category.color,
                    name: category.name,
                    originalPattern: category.patterns[0],
                    isRegex: true,
                    excludeRegexes
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
                        isRegex: false,
                        excludeRegexes
                    });
                });
            }
        });
        
        return regexes;
    }

    // 查找匹配
    findMatches(text, regexes, mode) {
        const matches = [];
        
        regexes.forEach(({
            regex, category, color, name, originalPattern, excludeRegexes = []
        }) => {
            const excludedRanges = [];
            excludeRegexes.forEach(excludeRegex => {
                excludeRegex.lastIndex = 0;
                let excluded;
                while ((excluded = excludeRegex.exec(text)) !== null) {
                    if (!excluded[0]) {
                        excludeRegex.lastIndex = Math.max(
                            excludeRegex.lastIndex + 1, excluded.index + 1
                        );
                        continue;
                    }
                    excludedRanges.push({
                        start: excluded.index,
                        end: excluded.index + excluded[0].length
                    });
                }
            });
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
                if (excludedRanges.some(range =>
                    range.start < highlightEnd && range.end > highlightStart
                )) {
                    continue;
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
        span.dataset.analysisModeId = this.activeAnalysisModeId || 'regex-default';
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
        span.tabIndex = 0;
        span.setAttribute('role', 'button');
        span.setAttribute(
            'aria-label',
            `${match.name}：${match.matchedText || match.matchedKeyword || ''}。按回车可修改类别或备注`
        );
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
        const openEditor = async event => {
            event.preventDefault();
            event.stopPropagation();
            const manualMark = await ensureAutomaticHighlightAnnotation(
                span, { sourceType: 'regex', match }
            );
            if (manualMark) showHighlightContextPopover(manualMark);
        };
        span.addEventListener('click', event => { void openEditor(event); });
        span.addEventListener('keydown', event => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            void openEditor(event);
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
        tooltip.replaceChildren(...this.createTooltipContent(element, match));
        
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
    createTooltipContent(element, match = {}) {
        const manualMark = element?.matches?.('.sci-manual-highlight')
            ? element : element?.closest?.('.sci-manual-highlight');
        const annotation = manualMark
            ? manualAnnotationById(manualMark.dataset.annotationId) : null;
        const categoryName = annotation?.categorySnapshot?.name ||
            match.name || element?.dataset?.categoryName || '未分类';
        const categoryColor = annotation?.categorySnapshot?.color ||
            match.color || element?.dataset?.categoryColor || '#F2D978';
        const heading = document.createElement('div');
        heading.style.cssText =
            `font-weight:600;margin-bottom:4px;color:${categoryColor};`;
        heading.textContent = categoryName;
        const children = [heading];
        const matchedKeyword = String(
            match.matchedKeyword || annotation?.sourceQuery || ''
        ).trim();
        if (matchedKeyword) {
            const detail = document.createElement('div');
            detail.style.cssText = 'font-size:11px;opacity:.9;';
            detail.textContent = annotation?.sourceType === 'semantic'
                ? `检索意图：${matchedKeyword}` : `匹配词：${matchedKeyword}`;
            children.push(detail);
        }
        if (String(annotation?.note || '').trim()) {
            const note = document.createElement('div');
            note.style.cssText =
                'margin-top:6px;padding-top:6px;border-top:1px solid rgba(255,255,255,.24);font-size:11px;';
            note.textContent = `备注：${annotation.note}`;
            children.push(note);
        }
        return children;
    }

    hideTooltip() {
        const tooltip = document.getElementById('sci-highlight-tooltip');
        if (tooltip) {
            tooltip.remove();
        }
    }

    // 获取匹配计数（不应用高亮，只统计）
    getMatchCounts(rules) {
        const previousAnalysisModeId = this.activeAnalysisModeId;
        this.activeAnalysisModeId = '__count__';
        const counts = {};
        Object.keys(rules).forEach(key => {
            counts[key] = 0;
        });
        
        const textNodes = this.getTextNodes(document.body);
        const categoryRegexes = this.buildRegexes(rules);
        
        textNodes.forEach(node => {
            if (this.shouldSkipNode(node)) return;
            
            const text = node.textContent;
            
            categoryRegexes.forEach(({ regex, category, excludeRegexes = [] }) => {
                const excludedRanges = [];
                excludeRegexes.forEach(excludeRegex => {
                    excludeRegex.lastIndex = 0;
                    let excluded;
                    while ((excluded = excludeRegex.exec(text)) !== null) {
                        if (!excluded[0]) {
                            excludeRegex.lastIndex = Math.max(
                                excludeRegex.lastIndex + 1, excluded.index + 1
                            );
                            continue;
                        }
                        excludedRanges.push({
                            start: excluded.index,
                            end: excluded.index + excluded[0].length
                        });
                    }
                });
                regex.lastIndex = 0;
                let match;
                while ((match = regex.exec(text)) !== null) {
                    if (excludedRanges.some(range =>
                        range.start < match.index + match[0].length &&
                        range.end > match.index
                    )) continue;
                    counts[category]++;
                }
            });
        });
        this.activeAnalysisModeId = previousAnalysisModeId;
        return counts;
    }

    // 清除高亮
    clearHighlight(analysisModeId = '') {
        // 隐藏tooltip
        this.hideTooltip();

        // 正则高亮独立清除，只解包插件创建的 sci-highlight 节点。
        // 手动编辑正则高亮会重建外层注释 DOM，不能只依赖旧的内存节点引用。
        const targetId = String(analysisModeId || '');
        const matchesTargetMode = element =>
            !targetId ||
            String(element?.dataset?.analysisModeId || 'regex-default') === targetId;
        const trackedTargets = this.highlightedElements.filter(matchesTargetMode);
        const connectedTargets = [...document.querySelectorAll(
            '.sci-highlight[data-source="regex"]'
        )].filter(matchesTargetMode);
        const targets = [...new Set([...connectedTargets, ...trackedTargets])];
        [...targets].reverse().forEach(element => {
            const parent = element?.parentNode;
            if (!parent) return;
            while (element.firstChild) parent.insertBefore(element.firstChild, element);
            element.remove();
            parent.normalize();
        });
        
        this.highlightedElements = targetId
            ? this.highlightedElements.filter(
                element => !targets.includes(element) && element?.isConnected
            )
            : [];
        if (!targetId) this.originalContents.clear();
        this.matchCounts = {};
        
        console.log(targetId
            ? `SCI高亮助手: 已替换分析模式 ${targetId} 的高亮`
            : 'SCI高亮助手: 已清除所有高亮');
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
        if (this.allowedParagraphIds instanceof Set) {
            const element = parent.nodeType === Node.ELEMENT_NODE
                ? parent : parent.parentElement;
            const paragraph = element?.closest?.('[data-sci-llm-paragraph-id]');
            const paragraphId = String(paragraph?.dataset?.sciLlmParagraphId || '');
            if (!paragraphId || !this.allowedParagraphIds.has(paragraphId)) return true;
        }
        const tagName = parent.tagName ? parent.tagName.toLowerCase() : '';
        
        // 跳过的标签
        const skipTags = ['script', 'style', 'noscript', 'iframe', 'object', 'embed', 'textarea', 'code', 'pre'];
        if (skipTags.includes(tagName)) return true;
        
        // 跳过已经高亮的元素
        if (parent.classList && parent.classList.contains('sci-highlight')) {
            const parentModeId = String(
                parent.dataset?.analysisModeId || 'regex-default'
            );
            if (!this.activeAnalysisModeId || parentModeId === this.activeAnalysisModeId) {
                return true;
            }
        }
        
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
let articleWorkspaceSaveTimer = null;
let currentArticleWorkspace = null;
let articleWorkspaceEnsurePromise = null;
let articleWorkspaceMutationTail = Promise.resolve();
let articleWorkspaceSaveFrozen = false;
let articleWorkspaceGenerationOverride = 1;
let articleWorkspaceLifecycleGeneration = 0;
let pendingExternalWorkspaceDeletionId = '';
let articleWorkspaceSidePanelUiState = null;
let restoredWorkspaceLlmTask = null;
const articleWorkspaceAssetFingerprints = new Map();
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
let figureWorkspaceInventoryInitialized = false;
let figureWorkspaceInventoryDirty = true;
let figureWorkspaceLastFreshnessCheckAt = 0;
let figureWorkspaceChangeNotificationTimer = null;
const FIGURE_WORKSPACE_FRESHNESS_TTL_MS = 2000;
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
let articleStructureObservedRoots = new Set();
let articleStructureBoundaryRoots = new Map();
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
    expandedSectionIds: new Set(),
    analysisSectionSelection: new Map()
};
const DEFAULT_ANALYSIS_SECTION_KINDS = new Set([
    'abstract', 'main', 'introduction', 'results', 'discussion', 'conclusion'
]);

function defaultArticleAnalysisSectionSelection(sectionKind) {
    return DEFAULT_ANALYSIS_SECTION_KINDS.has(String(sectionKind || '').toLowerCase());
}

function articleAnalysisSectionSelected(sectionId, sectionKind) {
    const key = String(sectionId || '');
    if (articleNavigatorState.analysisSectionSelection.has(key)) {
        return articleNavigatorState.analysisSectionSelection.get(key) === true;
    }
    return defaultArticleAnalysisSectionSelection(sectionKind);
}

function selectedArticleAnalysisParagraphIds(snapshot = getCanonicalArticleSnapshot()) {
    return new Set((Array.isArray(snapshot?.paragraphs) ? snapshot.paragraphs : [])
        .filter(paragraph => articleAnalysisSectionSelected(
            paragraph.sectionId,
            paragraph.sectionKind
        ))
        .flatMap(paragraph => [
            String(paragraph.paragraphId || ''),
            String(paragraph.sourceKey || '')
        ])
        .filter(Boolean));
}

function filterParagraphsForArticleAnalysis(paragraphs = []) {
    return (Array.isArray(paragraphs) ? paragraphs : []).filter(paragraph =>
        articleAnalysisSectionSelected(paragraph.sectionId, paragraph.sectionKind)
    );
}

function setArticleAnalysisSectionSelection(sectionIds, selected) {
    const ids = (Array.isArray(sectionIds) ? sectionIds : [sectionIds])
        .map(String).filter(Boolean);
    ids.forEach(sectionId => {
        articleNavigatorState.analysisSectionSelection.set(sectionId, selected === true);
    });
    const allowedParagraphIds = selectedArticleAnalysisParagraphIds();
    if (lastRegexHighlightRequest?.categories) {
        highlighter.applyHighlight(
            lastRegexHighlightRequest.categories,
            lastRegexHighlightRequest.mode || 'word',
            {
                allowedParagraphIds,
                analysisModeId: lastRegexHighlightRequest.analysisModeId
            }
        );
    }
    if (lastLlmAnalysis?.rawAnalysis && Array.isArray(lastLlmAnalysis.paragraphs)) {
        renderLlmAnalysis(
            lastLlmAnalysis.rawAnalysis,
            lastLlmAnalysis.paragraphs,
            lastLlmAnalysis.threshold || 0.8,
            lastLlmAnalysis.extractionDiagnostics
        );
    }
    scheduleArticleWorkspaceArtifactsSave({ immediate: true });
    scheduleCurrentArticleArchiveSave();
    return {
        success: true,
        snapshot: buildArticleWorkspaceSnapshot(),
        selectedParagraphCount: allowedParagraphIds.size
    };
}
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
const FIGURE_IMAGE_LOAD_TIMEOUT_MS = 8000;
const FIGURE_IMAGE_PREPARATION_TIMEOUT_MS = 12000;
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
    const error = new Error(`正在精读 ${activeLabel}，请完成后再分析 ${requestedFigureId}`);
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
    restoredWorkspaceLlmTask = null;
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

async function sendLlmOperationControlWithDeadline(operationId, command, timeoutMs = 1800) {
    let timer = null;
    try {
        const response = await Promise.race([
            chrome.runtime.sendMessage({
                type: 'LLM_CONTROL_OPERATION',
                operationId,
                command
            }),
            new Promise(resolve => {
                timer = setTimeout(() => resolve({
                    success: true,
                    pending: true,
                    reason: 'CONTROL_CONFIRMATION_TIMEOUT'
                }), timeoutMs);
            })
        ]);
        return response || { success: true, pending: true };
    } catch (error) {
        return {
            success: true,
            pending: true,
            reason: 'CONTROL_CONFIRMATION_FAILED',
            error: error?.message || String(error)
        };
    } finally {
        if (timer !== null) clearTimeout(timer);
    }
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
        if (command === 'cancel') {
            cancelPendingFigureProgress(figureWorkspaceInventory, {
                completedFigures: figureAnalysisStatus.completedFigures,
                errorCode: 'CANCELLED'
            });
        }
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
    const response = await sendLlmOperationControlWithDeadline(
        operation.operationId,
        command
    );
    if (!response?.success) {
        const error = new Error(response?.error?.message || '无法控制分析任务');
        error.code = response?.error?.code;
        throw error;
    }
    return { success: true, scope, command, operationId: operation.operationId,
        paused: operation.paused, cancelled: operation.cancelled, active: true,
        backendAcknowledged: response.pending !== true,
        backendPendingReason: response.pending === true ? response.reason : '' };
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
    const batchRecognizedPanelCount = Number.isFinite(Number(progress.batchRecognizedPanelCount))
        ? Math.max(0, Math.min(30, Math.floor(Number(progress.batchRecognizedPanelCount))))
        : null;
    const unexpectedPanels = sanitizeFigureProgressPanels(progress.unexpectedPanels);
    return {
        figureId: sanitizeFigureProgressText(progress.figureId, 80),
        figureLabel: sanitizeFigureProgressText(progress.figureLabel, 120),
        expectedPanels,
        expectedPanelCount: Math.max(0, Math.min(30,
            Math.floor(Number(progress.expectedPanelCount) || expectedPanels.length))),
        recognizedPanelCount,
        batchRecognizedPanelCount,
        unexpectedPanels,
        ignoredUnexpectedPanelCount: Math.max(0, Math.min(30,
            Math.floor(Number(progress.ignoredUnexpectedPanelCount) || unexpectedPanels.length))),
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
    if (progress.phase === 'figure_panel_schema_retry') return `${label}${position}：Panel 返回结构不完整，正在按精确字段要求重试。`;
    if (progress.phase === 'figure_panel_transient_retry') {
        const seconds = Math.max(1, Math.ceil((Number(progress.waitMs) || 0) / 1000));
        return `${label}${position}：Panel 请求暂时失败，${seconds} 秒后自动重试。`;
    }
    if (progress.phase === 'figure_compact_fallback') return `${label}${position}：整图结构连续不稳定，已切换为 Panel 提取后再综合。`;
    if (progress.phase === 'figure_panel_batch_complete') {
        const ignored = Number(progress.ignoredUnexpectedPanelCount) || 0;
        const ignoredNotice = ignored
            ? `，已忽略模型重复返回的 ${ignored} 个批次外 Panel`
            : '';
        return `${label}${position}：已完成 Panel 分批 ${progress.completedPanelBatches}/${progress.totalPanelBatches}${ignoredNotice}，正在继续下一批。`;
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
        figure_panel_planning: '正在规划 Panel 证据输入',
        figure_panel_schema_retry: '正在修正 Panel 返回结构',
        figure_panel_transient_retry: 'Panel 请求暂时失败，正在等待重试',
        figure_panel_token_retry: '正在调整 Panel 输出令牌上限',
        figure_panel_output_retry: '正在增加 Panel 输出令牌上限',
        figure_panel_retry: '正在降低 Panel 输入容量',
        figure_panel_complete: 'Panel 解读已完成',
        figure_compact_fallback: '已切换为 Panel 提取后再综合',
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
        scheduleArticleWorkspaceArtifactsSave({ immediate: true });
        if (state?.figure) {
            notifyFigureWorkspaceStateChanged('figure_checkpoint', state.figure, {
                analysisDepth: depth,
                completedPanelBatches: Number(progress.completedPanelBatches) || 0,
                totalPanelBatches: Number(progress.totalPanelBatches) || 0
            });
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

function clearLlmHighlights(analysisModeId = '') {
    closeLlmFeedbackPopover();
    const targetId = String(analysisModeId || '');
    [...document.querySelectorAll('.sci-llm-highlight')]
        .filter(mark => !targetId ||
            String(mark.dataset.analysisModeId || 'llm-default') === targetId)
        .reverse().forEach(mark => {
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
    panel.setAttribute('aria-label', '论文分析模式');

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
    const analysisModeId = String(
        analysisMeta.readingViewId || 'llm-default'
    );
    clearLlmHighlights(analysisModeId);
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
            mark.dataset.analysisModeId = analysisModeId;
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
    const allowedParagraphIds = selectedArticleAnalysisParagraphIds();
    const applied = applyLlmHighlights(filtered.annotations.filter(annotation =>
        allowedParagraphIds.has(String(annotation?.paragraphId || ''))
    ), {
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
    // Paragraph-level Claim Census results are durable immediately instead of
    // waiting for every remaining chunk and the evidence-ledger pass.
    scheduleCurrentArticleArchiveSave();
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
    scheduleArticleWorkspaceArtifactsSave({ immediate: true });
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
let currentManualAnalysisModes = [];
let currentManualAnalysisModeId = '';
let currentManualPreparedAnalysisModeId = '';
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

function announceSidePanelDocumentReady() {
    chrome.runtime.sendMessage({
        type: 'SIDE_PANEL_DOCUMENT_READY',
        url: location.href
    }).then(response => {
        if (response?.success && response.shouldArmRestore) armSidePanelRestore();
        else if (response?.success) disarmSidePanelRestore();
    }).catch(() => {});
}

window.addEventListener('pageshow', announceSidePanelDocumentReady, true);
setTimeout(announceSidePanelDocumentReady, 0);

let sidePanelShortcutScope = {
    enabled: false,
    shortcuts: {}
};

function setSidePanelShortcutScope(scope = {}) {
    const source = scope?.shortcuts && typeof scope.shortcuts === 'object'
        ? scope.shortcuts : {};
    sidePanelShortcutScope = {
        enabled: scope?.enabled === true,
        shortcuts: Object.fromEntries(
            Object.entries(source)
                .map(([actionId, key]) => [
                    String(actionId || ''),
                    String(key || '').normalize('NFKC').trim().toUpperCase()
                ])
                .filter(([actionId, key]) =>
                    Boolean(actionId) && /^[A-Z0-9]$/.test(key))
        )
    };
    return sidePanelShortcutScope.enabled;
}

function isPageShortcutEditableTarget(target) {
    return target instanceof Element && Boolean(target.closest(
        'input, textarea, select, option, [contenteditable]:not([contenteditable="false"]), ' +
        '[role="textbox"], dialog'
    ));
}

function handleSidePanelGlobalShortcut(event) {
    if (!sidePanelShortcutScope.enabled || event.defaultPrevented ||
        event.isComposing || event.repeat || event.ctrlKey || event.metaKey ||
        event.altKey || isPageShortcutEditableTarget(event.target) ||
        getFigureImageViewerState().open) return;
    const key = String(event.key || '').normalize('NFKC').trim().toUpperCase();
    if (!key || !Object.values(sidePanelShortcutScope.shortcuts).includes(key)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    try {
        chrome.runtime.sendMessage({
            type: 'SIDE_PANEL_GLOBAL_SHORTCUT',
            key
        }).catch(() => undefined);
    } catch (_) {
        // Reloading an unpacked extension invalidates old content contexts.
    }
}

document.addEventListener('keydown', handleSidePanelGlobalShortcut, true);

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

function applyManualAnalysisSettings(publicState = {}, { prepared = false } = {}) {
    const readingViews = publicState?.readingViews &&
        typeof publicState.readingViews === 'object'
        ? publicState.readingViews : {};
    currentManualAnalysisModes = Object.entries(readingViews).map(([id, mode]) => ({
        id: String(id || ''),
        name: String(mode?.name || id || '未命名模式'),
        categoryIds: [...new Set((Array.isArray(mode?.categoryIds)
            ? mode.categoryIds : []).map(String).filter(Boolean))]
    })).filter(mode => mode.id);
    const configuredModeId = String(publicState?.settings?.readingViewId || '');
    currentManualAnalysisModeId = currentManualAnalysisModes.some(mode =>
        mode.id === configuredModeId)
        ? configuredModeId
        : (currentManualAnalysisModes[0]?.id || '');
    if (prepared) currentManualPreparedAnalysisModeId = currentManualAnalysisModeId;
}

function manualCategoriesForAnalysisMode(modeId = currentManualAnalysisModeId) {
    const selectedModeId = String(modeId || '');
    if (selectedModeId && selectedModeId === currentManualPreparedAnalysisModeId &&
        currentManualActiveCategories.length) {
        return currentManualActiveCategories;
    }
    const mode = currentManualAnalysisModes.find(item => item.id === selectedModeId);
    if (!mode) {
        return currentManualActiveCategories.length
            ? currentManualActiveCategories : currentManualCategories;
    }
    const categoriesById = new Map(currentManualCategories.map(category => [
        category.categoryId, category
    ]));
    return mode.categoryIds.map(categoryId => categoriesById.get(categoryId))
        .filter(Boolean);
}

async function refreshManualAnalysisSettings() {
    try {
        const publicState = await sendManualMessage({ type: 'LLM_GET_SETTINGS' });
        applyManualAnalysisSettings(publicState);
        if (currentManualSelection?.anchor) {
            showManualSelectionToolbar({
                ...currentManualSelection,
                manualAnalysisModeId: currentManualAnalysisModeId
            });
        }
    } catch (_) {
        // Keep the last valid mode and categories while settings are being rewritten.
    }
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
    currentManualAnalysisModes = [];
    currentManualAnalysisModeId = '';
    currentManualPreparedAnalysisModeId = '';
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

function notifyManualAnnotationStateChanged(kind = 'updated') {
    const record = currentManualDocument?.record;
    if (!currentManualDocument?.documentId || !record) return;
    chrome.runtime.sendMessage({
        type: 'MANUAL_ANNOTATION_STATE_CHANGED',
        event: {
            kind,
            documentId: currentManualDocument.documentId,
            documentHash: record.documentHash || '',
            canonicalUrl: record.canonicalUrl || location.href,
            title: record.title || document.title,
            annotationCount: record.annotations?.length || 0,
            unresolvedCount: currentManualUnresolved.length
        }
    }).catch(() => {});
}

function updateCurrentManualRecord(record) {
    if (!currentManualDocument || !record) return;
    currentManualDocument = { ...currentManualDocument, record };
    scheduleArticleWorkspaceArtifactsSave({ immediate: true });
    notifyManualAnnotationStateChanged('mutated');
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
    if (annotation.sourceType === 'regex') mark.classList.add('sci-automatic-annotation');
    if (annotation.sourceType === 'semantic') mark.classList.add(
        'sci-automatic-annotation', 'sci-semantic-annotation'
    );
    mark.dataset.annotationId = annotation.annotationId;
    mark.dataset.categoryId = annotation.categoryId;
    mark.dataset.categoryName = annotation.categorySnapshot?.name || annotation.categoryId;
    mark.dataset.categoryColor = annotation.categorySnapshot?.color || '';
    mark.dataset.source = annotation.sourceType || 'manual';
    mark.dataset.sourceQuery = String(annotation.sourceQuery || '');
    mark.style.setProperty('--sci-manual-color', pastelManualColor(annotation.categorySnapshot?.color));
    mark.style.setProperty(
        '--sci-annotation-color',
        annotation.categorySnapshot?.color || '#2F80ED'
    );
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
    mark.addEventListener('mouseenter', () => {
        highlighter.showTooltip(mark, {
            name: annotation.categorySnapshot?.name || annotation.categoryId,
            color: annotation.categorySnapshot?.color || '#F2D978',
            matchedKeyword: annotation.sourceQuery || ''
        });
    });
    mark.addEventListener('mouseleave', () => highlighter.hideTooltip());
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
        applyManualAnalysisSettings(publicState, { prepared: true });
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

function automaticAnnotationId(sourceType = 'automatic') {
    return globalThis.crypto?.randomUUID?.() ||
        `${sourceType}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function buildAutomaticAnnotation(block, startOffset, endOffset, options = {}) {
    const blockText = manualReadableText(block?.element);
    const quote = blockText.slice(startOffset, endOffset);
    const category = manualCategoryById(options.categoryId) || normalizeManualUiCategory({
        categoryId: options.categoryId || 'semantic_match',
        name: options.categoryName || '智能检索匹配',
        color: options.categoryColor || '#2F80ED'
    });
    const timestamp = new Date().toISOString();
    return {
        annotationId: automaticAnnotationId(options.sourceType),
        categoryId: category.categoryId,
        categorySnapshot: { name: category.name, color: category.color },
        quote,
        prefix: blockText.slice(Math.max(0, startOffset - 180), startOffset),
        suffix: blockText.slice(endOffset, endOffset + 180),
        sectionTitle: block.sectionTitle || '',
        blockFingerprint: block.blockFingerprint,
        startOffset,
        endOffset,
        note: '',
        status: 'located',
        sourceType: options.sourceType || 'automatic',
        sourceQuery: String(options.sourceQuery || '').slice(0, 4000),
        createdAt: timestamp,
        updatedAt: timestamp
    };
}

async function saveAutomaticAnnotation(block, startOffset, endOffset, options = {}) {
    if (!block?.element || endOffset <= startOffset) return null;
    const candidate = buildAutomaticAnnotation(block, startOffset, endOffset, options);
    if (!candidate.quote.trim()) return null;
    const duplicate = currentManualDocument?.record?.annotations?.find(annotation =>
        annotation.blockFingerprint === candidate.blockFingerprint &&
        annotation.startOffset === candidate.startOffset &&
        annotation.endOffset === candidate.endOffset &&
        annotation.sourceType === candidate.sourceType
    );
    if (duplicate) {
        if (duplicate.categoryId !== candidate.categoryId ||
            duplicate.sourceQuery !== candidate.sourceQuery) {
            await saveManualAnnotation({
                ...duplicate,
                categoryId: candidate.categoryId,
                categorySnapshot: candidate.categorySnapshot,
                sourceQuery: candidate.sourceQuery,
                updatedAt: candidate.updatedAt
            });
        }
        return document.querySelector(
            `.sci-manual-highlight[data-annotation-id="${manualCssEscape(duplicate.annotationId)}"]`
        );
    }
    await saveManualAnnotation(candidate);
    return document.querySelector(
        `.sci-manual-highlight[data-annotation-id="${manualCssEscape(candidate.annotationId)}"]`
    );
}

async function ensureAutomaticHighlightAnnotation(mark, options = {}) {
    const existing = mark?.matches?.('.sci-manual-highlight')
        ? mark : mark?.closest?.('.sci-manual-highlight');
    if (existing) return existing;
    try {
        await (manualPreparePromise || prepareManualDocument());
        if (!mark?.isConnected) return null;
        const block = findManualBlock(mark);
        if (!block) throw new Error('AUTOMATIC_HIGHLIGHT_BLOCK_NOT_FOUND');
        const range = document.createRange();
        range.selectNodeContents(mark);
        const startOffset = manualBoundaryOffset(
            block.element, range.startContainer, range.startOffset
        );
        const endOffset = manualBoundaryOffset(
            block.element, range.endContainer, range.endOffset
        );
        return await saveAutomaticAnnotation(block, startOffset, endOffset, {
            sourceType: options.sourceType || 'regex',
            sourceQuery: options.match?.matchedKeyword || '',
            categoryId: options.match?.category || mark.dataset.categoryId,
            categoryName: options.match?.name || mark.dataset.categoryName,
            categoryColor: options.match?.color || mark.style.borderBottomColor
        });
    } catch (error) {
        showManualStatus(
            error?.message === 'AUTOMATIC_HIGHLIGHT_BLOCK_NOT_FOUND'
                ? '无法把该规则高亮定位到正文段落。请刷新导航后重试。'
                : `无法打开高亮编辑：${error.message}`,
            'error'
        );
        return null;
    }
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

function replaceManualCategoryFromDetail(detail) {
    const category = normalizeManualUiCategory(detail?.category || detail);
    if (!category.categoryId) return;
    const replace = list => {
        const next = list.filter(item => item.categoryId !== category.categoryId);
        next.push(category);
        return uniqueManualCategories(next);
    };
    currentManualCategories = replace(currentManualCategories);
    if (currentManualActiveCategories.some(item =>
        item.categoryId === category.categoryId
    )) {
        currentManualActiveCategories = replace(currentManualActiveCategories);
    }
}

function escapeManualFixedPhrase(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function refreshRegexHighlightsAfterPhraseAppend(detail, listType, phrase) {
    const category = detail?.category;
    const categoryId = String(category?.categoryId || '');
    const request = lastRegexHighlightRequest;
    const legacy = request?.categories?.[categoryId];
    if (!categoryId || !legacy || !Array.isArray(legacy.patterns) ||
        !legacy.patterns[0]) return false;
    const escaped = escapeManualFixedPhrase(phrase);
    const expression = category.regex?.wholeWord
        ? `\\b(?:${escaped})\\b` : `(?:${escaped})`;
    if (listType === 'exclude') {
        legacy.excludePatterns = [...new Set([
            ...(Array.isArray(legacy.excludePatterns) ? legacy.excludePatterns : []),
            expression
        ])];
    } else {
        legacy.patterns = [`(?:${legacy.patterns[0]}|${expression})`];
    }
    highlighter.applyHighlight(request.categories, request.mode, {
        allowedParagraphIds: selectedArticleAnalysisParagraphIds(),
        analysisModeId: request.analysisModeId
    });
    scheduleCurrentArticleArchiveSave();
    return true;
}

async function appendManualFixedPhrase(categoryId, listType, descriptor, controls = []) {
    const phrase = String(descriptor?.text || descriptor?.anchor?.quote || '')
        .normalize('NFKC').replace(/\s+/g, ' ').trim();
    if (!phrase) return;
    controls.forEach(control => { control.disabled = true; });
    try {
        const detail = await sendManualMessage({
            type: 'CATEGORY_APPEND_FIXED_PHRASE',
            categoryId,
            analysisModeId: descriptor?.manualAnalysisModeId || '',
            listType,
            phrase
        });
        replaceManualCategoryFromDetail(detail);
        const reapplied = refreshRegexHighlightsAfterPhraseAppend(
            detail, listType, phrase
        );
        releaseSelectionAfterManualAction();
        const target = listType === 'exclude' ? '黑名单' : '白名单';
        showManualStatus(
            detail.appended
                ? `已加入“${detail.category?.name || categoryId}”${target}` +
                    (reapplied ? '，当前正则高亮已更新' : '')
                : `该短语已存在于“${detail.category?.name || categoryId}”${target}`,
            'success'
        );
    } catch (error) {
        controls.forEach(control => { control.disabled = false; });
        showManualStatus(`规则短语保存失败：${error.message}`, 'error');
    }
}

function showManualSelectionToolbar(descriptor) {
    closeManualSelectionToolbar();
    const selectedModeId = String(
        descriptor?.manualAnalysisModeId || currentManualAnalysisModeId || ''
    );
    const toolbarDescriptor = { ...descriptor, manualAnalysisModeId: selectedModeId };
    const toolbarCategories = manualCategoriesForAnalysisMode(selectedModeId);
    currentManualSelection = toolbarDescriptor;
    manualUiLifecycle.retain({ selection: toolbarDescriptor });
    const toolbar = document.createElement('div');
    toolbar.id = 'sci-manual-toolbar';
    toolbar.dataset.sciPluginUi = 'true';
    toolbar.setAttribute('role', 'toolbar');
    toolbar.setAttribute('aria-label', '手动荧光笔高亮');
    toolbar.dataset.openNote = String(descriptor?.openNote === true);
    toolbar.addEventListener('mousedown', event => {
        // Keep the article selection while category/action buttons are clicked,
        // but allow native controls such as the analysis-mode <select> to open.
        if (event.target.closest('button')) event.preventDefault();
    });

    if (currentManualAnalysisModes.length) {
        const modeRow = document.createElement('label');
        modeRow.className = 'sci-manual-mode-row';
        const modeLabel = document.createElement('span');
        modeLabel.textContent = '分析模式';
        const modeSelect = document.createElement('select');
        modeSelect.setAttribute('aria-label', '切换手动高亮规则的分析模式');
        currentManualAnalysisModes.forEach(mode => {
            const option = document.createElement('option');
            option.value = mode.id;
            option.textContent = mode.name;
            option.selected = mode.id === selectedModeId;
            modeSelect.appendChild(option);
        });
        modeSelect.addEventListener('change', () => {
            toolbarDescriptor.manualAnalysisModeId = modeSelect.value;
            showManualSelectionToolbar({
                ...toolbarDescriptor,
                manualAnalysisModeId: modeSelect.value,
                openNote: toolbar.dataset.openNote === 'true'
            });
        });
        modeRow.append(modeLabel, modeSelect);
        toolbar.appendChild(modeRow);
    }

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
        toolbarCategories.slice(0, 8).forEach(category => {
            const button = makeManualButton(category.name, 'sci-manual-category');
            button.style.setProperty('--sci-category-color', pastelManualColor(category.color));
            button.addEventListener('click', () =>
                createManualAnnotation(category, toolbar.dataset.openNote === 'true')
            );
            primaryRow.appendChild(button);
        });
    }
    toolbar.appendChild(primaryRow);

    if (!currentManualRebindId && toolbarCategories.length) {
        const ruleRow = document.createElement('div');
        ruleRow.className = 'sci-manual-rule-row';
        const ruleLabel = document.createElement('span');
        ruleLabel.textContent = '所选文字加入规则';
        const ruleCategory = document.createElement('select');
        ruleCategory.setAttribute('aria-label', '选择要填入固定短语的高亮规则');
        toolbarCategories.forEach(category => {
            const option = document.createElement('option');
            option.value = category.categoryId;
            option.textContent = category.name;
            ruleCategory.appendChild(option);
        });
        const include = makeManualButton('加入白名单', 'sci-manual-rule-include');
        include.title = '正则匹配到这段固定短语时高亮';
        const exclude = makeManualButton('加入黑名单', 'sci-manual-rule-exclude');
        exclude.title = '正则匹配到这段固定短语时排除';
        include.addEventListener('click', () => {
            void appendManualFixedPhrase(
                ruleCategory.value, 'include', toolbarDescriptor,
                [ruleCategory, include, exclude]
            );
        });
        exclude.addEventListener('click', () => {
            void appendManualFixedPhrase(
                ruleCategory.value, 'exclude', toolbarDescriptor,
                [ruleCategory, include, exclude]
            );
        });
        ruleRow.append(ruleLabel, ruleCategory, include, exclude);
        toolbar.appendChild(ruleRow);
    }

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

    const primaryIds = new Set(toolbarCategories.slice(0, 8)
        .map(category => category.categoryId));
    const remaining = toolbarCategories.filter(category => !primaryIds.has(category.categoryId));
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
            positionManualFloating(toolbar, toolbarDescriptor.rect);
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
            positionManualFloating(toolbar, toolbarDescriptor.rect);
        });
    }
    toolbar.insertBefore(secondaryRow, primaryRow.nextSibling);
    document.documentElement.appendChild(toolbar);
    positionManualFloating(toolbar, toolbarDescriptor.rect);
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

async function clearAutomaticHighlightsAndPersist() {
    clearAutomaticHighlights();
    lastRegexHighlightRequest = null;
    lastLlmAnalysis = null;
    llmProgressiveAnalysis = null;
    lastLlmDiagnostics = null;
    restoredWorkspaceLlmTask = null;
    try {
        await persistArticleWorkspaceArtifacts({ force: true });
        return { success: true, persisted: true };
    } catch (error) {
        return {
            success: true,
            persisted: false,
            persistenceError: String(error?.message || error || '本地状态保存失败')
        };
    }
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
    notifyManualAnnotationStateChanged('cleared');
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
        manualClosest(event.target, '.sci-manual-highlight,.sci-llm-highlight,.sci-highlight')) return;
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
    currentManualAnalysisModes = [];
    currentManualAnalysisModeId = '';
    currentManualPreparedAnalysisModeId = '';
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

chrome.storage?.onChanged?.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes?.sciLlmSettingsV2) return;
    void refreshManualAnalysisSettings();
});
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
    document.getElementById('sci-llm-status')?.remove();
    if (!message) {
        return;
    }
    chrome.runtime.sendMessage({
        type: 'ARTICLE_NOTIFICATION',
        message: String(message).normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, 600),
        level: type === 'error' ? 'error' : type === 'success' ? 'success' : 'info',
        timestamp: Date.now(),
        pageUrl: location.href
    }).catch(() => undefined);
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
        counts: highlighter.applyHighlight(
            categories,
            stored.highlightMode || 'word',
            {
                allowedParagraphIds: selectedArticleAnalysisParagraphIds(),
                analysisModeId: 'regex-fallback'
            }
        )
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
    const paragraphs = filterParagraphsForArticleAnalysis(
        extracted.map(({ sourceIndex, ...paragraph }) => paragraph)
    );
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
    scheduleArticleWorkspaceArtifactsSave({ immediate: true });
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
    const workspaceLifecycle = articleWorkspaceLifecycleGeneration;
    llmAnalysisPromise = (async () => {
        setLlmErrorDiagnostics(null);
        showLlmPageStatus('正在提取论文正文…');
        const extractionDiagnostics = diagnoseArticleWithTrace('analyze_article');
        const extracted = extractArticleWithTrace('analyze_article');
        lastLlmDiagnostics = { extraction: extractionDiagnostics, stage: 'extracted' };
        if (options.auto && !isLikelyAcademicArticle(extracted)) {
            showLlmPageStatus(null);
            return { success: false, skipped: true, reason: 'PAGE_NOT_CONFIDENTLY_ACADEMIC' };
        }
        const paragraphs = filterParagraphsForArticleAnalysis(
            extracted.map(({ sourceIndex, ...paragraph }) => paragraph)
        );
        if (!paragraphs.length) throw new Error('未找到可分析的论文正文');
        llmProgressiveAnalysis = {
            rawAnalysis: {
                annotations: [],
                rejected: [],
                readingViewId: lastPreparedStudy?.readingViewId ||
                    options.readingViewId || 'llm-default',
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
            workspaceLifecycle,
            operationId: operation.operationId,
            document: {
                documentId: options.documentId,
                previousDocumentHash: options.documentHash,
                title: document.title,
                paragraphs
            }
        });
        assertCurrentArticleWorkspaceLifecycle(workspaceLifecycle);
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
        scheduleArticleWorkspaceArtifactsSave({ immediate: true });
        return { success: true, ...applied, analysis: response.data };
    })();

    try {
        return await llmAnalysisPromise;
    } catch (error) {
        const staleWorkspace = workspaceLifecycle !== articleWorkspaceLifecycleGeneration;
        if (staleWorkspace) {
            return {
                success: false,
                cancelled: true,
                code: 'CANCELLED',
                operationId: operation.operationId
            };
        }
        llmProgressiveAnalysis = null;
        if (error?.code === 'CANCELLED' || operation.cancelled) {
            lastLlmDiagnostics = {
                ...(lastLlmDiagnostics || {}),
                stage: 'cancelled',
                errorCode: 'CANCELLED'
            };
            showLlmPageStatus('全文 LLM 高亮已取消，已完成分块的高亮会保留。', 'success');
            scheduleArticleWorkspaceArtifactsSave({ immediate: true });
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
        scheduleArticleWorkspaceArtifactsSave({ immediate: true });
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
        if (workspaceLifecycle === articleWorkspaceLifecycleGeneration) {
            llmAnalysisPromise = null;
        }
        finishLlmHighlightOperation(operation);
        // Success/error checkpoints are captured before the active operation is
        // released. Save once more afterwards so a reopened workspace never
        // mistakes a completed analysis for a still-running task.
        if (workspaceLifecycle === articleWorkspaceLifecycleGeneration) {
            scheduleArticleWorkspaceArtifactsSave({ immediate: true });
        }
    }
}

function figureDataUrlBytes(value) {
    const base64 = String(value || '').split(',')[1] || '';
    return Math.floor(base64.length * 3 / 4);
}

function figureImageTimeoutError() {
    const error = new Error('Figure image loading timed out');
    error.code = 'FIGURE_IMAGE_TIMEOUT';
    return error;
}

function loadFigureImage(source, timeoutMs = FIGURE_IMAGE_LOAD_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        let settled = false;
        const finish = (handler, value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            image.onload = null;
            image.onerror = null;
            handler(value);
        };
        const timer = setTimeout(() => {
            finish(reject, figureImageTimeoutError());
            image.src = '';
        }, Math.max(250, Number(timeoutMs) || FIGURE_IMAGE_LOAD_TIMEOUT_MS));
        image.crossOrigin = 'anonymous';
        image.onload = () => finish(resolve, image);
        image.onerror = () => finish(reject, new Error('Figure image could not be loaded'));
        image.src = source;
    });
}

async function fetchFigureImage(source, timeoutMs = FIGURE_IMAGE_LOAD_TIMEOUT_MS) {
    const deadline = Date.now() + Math.max(
        250, Number(timeoutMs) || FIGURE_IMAGE_LOAD_TIMEOUT_MS
    );
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(),
        Math.max(250, deadline - Date.now()));
    try {
        const response = await fetch(source, {
            credentials: 'include', signal: controller.signal
        });
        if (!response.ok) throw new Error('Figure image request failed');
        const blob = await response.blob();
        if (!/^image\//i.test(blob.type || '')) throw new Error('Figure source was not an image');
        const objectUrl = URL.createObjectURL(blob);
        try {
            return await loadFigureImage(objectUrl, Math.max(250, deadline - Date.now()));
        } finally {
            URL.revokeObjectURL(objectUrl);
        }
    } catch (error) {
        if (error?.name === 'AbortError') throw figureImageTimeoutError();
        throw error;
    } finally {
        clearTimeout(timeout);
    }
}

function normalizePanelCropGeometry(value, sourceWidth, sourceHeight) {
    if (!value || value.reliable !== true) return null;
    let x = Number(value.x);
    let y = Number(value.y);
    let width = Number(value.width);
    let height = Number(value.height);
    if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
    if (x >= 0 && y >= 0 && x <= 1 && y <= 1 && width <= 1 && height <= 1) {
        x *= sourceWidth;
        y *= sourceHeight;
        width *= sourceWidth;
        height *= sourceHeight;
    }
    x = Math.max(0, Math.round(x));
    y = Math.max(0, Math.round(y));
    width = Math.min(sourceWidth - x, Math.round(width));
    height = Math.min(sourceHeight - y, Math.round(height));
    if (width < 96 || height < 72 || width * height < sourceWidth * sourceHeight * .02) return null;
    return { x, y, width, height };
}

function encodeFigureImageVariant(sourceImage, maxEdge, cropGeometry = null) {
    const sourceWidth = Number(sourceImage.naturalWidth || sourceImage.width) || 0;
    const sourceHeight = Number(sourceImage.naturalHeight || sourceImage.height) || 0;
    if (!sourceWidth || !sourceHeight) throw new Error('Figure image has no dimensions');
    const crop = normalizePanelCropGeometry(cropGeometry, sourceWidth, sourceHeight) || {
        x: 0, y: 0, width: sourceWidth, height: sourceHeight
    };
    const requestedEdge = Math.max(256, Math.min(FIGURE_IMAGE_MAX_EDGE, Number(maxEdge) || 1200));
    const scale = Math.min(1, requestedEdge / Math.max(crop.width, crop.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(crop.width * scale));
    canvas.height = Math.max(1, Math.round(crop.height * scale));
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Canvas is unavailable');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(
        sourceImage,
        crop.x, crop.y, crop.width, crop.height,
        0, 0, canvas.width, canvas.height
    );
    for (const quality of [0.86, 0.78, 0.68, 0.58, 0.48]) {
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        if (figureDataUrlBytes(dataUrl) <= FIGURE_IMAGE_MAX_BYTES) {
            return {
                mediaType: 'image/jpeg', dataUrl,
                width: canvas.width, height: canvas.height,
                maxEdge: Math.max(canvas.width, canvas.height)
            };
        }
    }
    throw new Error('Figure image remains too large after compression');
}

function encodeFigureImage(sourceImage) {
    const { width, height, maxEdge, ...image } = encodeFigureImageVariant(
        sourceImage, FIGURE_IMAGE_MAX_EDGE
    );
    return image;
}

async function loadPreparedFigureSource(imageElement, deadline =
    Date.now() + FIGURE_IMAGE_LOAD_TIMEOUT_MS) {
    const fallbackSource = imageElement?.currentSrc || imageElement?.src ||
        imageElement?.getAttribute?.('src') ||
        imageElement?.getAttribute?.('data-src') ||
        imageElement?.getAttribute?.('data-original') ||
        imageElement?.getAttribute?.('data-lazy-src') || '';
    const candidates = await resolveFigureImageSources({
        imageElements: [imageElement]
    });
    if (!candidates.length && fallbackSource) candidates.push(fallbackSource);
    if (!candidates.length) throw new Error('Figure image source is missing');
    let lastError = null;
    for (const source of candidates) {
        if (Date.now() >= deadline) {
            lastError = figureImageTimeoutError();
            break;
        }
        const remainingMs = () => Math.max(250, deadline - Date.now());
        try {
            return imageElement.complete && imageElement.naturalWidth &&
                (imageElement.currentSrc === source || imageElement.src === source)
                ? imageElement : await loadFigureImage(source, remainingMs());
        } catch (error) {
            lastError = error;
            if (Date.now() >= deadline) break;
            try {
                return await fetchFigureImage(source, remainingMs());
            } catch (fetchError) {
                lastError = fetchError;
            }
        }
    }
    throw lastError || new Error('Figure image could not be loaded');
}

async function prepareFigureImage(imageElement, deadline) {
    return encodeFigureImage(await loadPreparedFigureSource(imageElement, deadline));
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
    const deadline = Date.now() + FIGURE_IMAGE_PREPARATION_TIMEOUT_MS;
    for (const imageElement of Array.from(figure?.imageElements || [])) {
        if (prepared.length >= FIGURE_IMAGE_LIMIT || Date.now() >= deadline) break;
        try {
            prepared.push(await prepareFigureImage(imageElement, deadline));
        } catch (error) {
            console.warn('SCI 逐图解读：跳过无法读取的图片', error.message);
        }
    }
    return prepared;
}

function figureImagePixelArea(imageElement) {
    const width = Number(imageElement?.naturalWidth || imageElement?.width) || 0;
    const height = Number(imageElement?.naturalHeight || imageElement?.height) || 0;
    return width * height;
}

function findDedicatedPanelImageElement(figure, panelId) {
    const panel = String(panelId || '').toUpperCase();
    const marker = new RegExp(`^(?:panel\\s*)?${panel}$`, 'i');
    return Array.from(figure?.imageElements || []).find(imageElement => {
        const values = [
            imageElement?.getAttribute?.('data-panel'),
            imageElement?.getAttribute?.('data-panel-id'),
            imageElement?.getAttribute?.('data-subfigure'),
            imageElement?.getAttribute?.('aria-label'),
            imageElement?.getAttribute?.('alt')
        ].map(value => String(value || '').normalize('NFKC').trim());
        return values.some(value => marker.test(value));
    }) || null;
}

async function prepareFigurePanelImageVariants(figure, panelId) {
    if (!await figureRouteSupportsVision()) return [];
    const allImages = Array.from(figure?.imageElements || [])
        .sort((left, right) => figureImagePixelArea(right) - figureImagePixelArea(left));
    const dedicated = findDedicatedPanelImageElement(figure, panelId);
    const imageElement = dedicated || allImages[0];
    if (!imageElement) return [];
    let sourceImage;
    try {
        sourceImage = await loadPreparedFigureSource(imageElement);
    } catch (error) {
        console.warn('SCI Panel 解读：图片读取失败，改用图注与相关正文', error.message);
        return [];
    }
    const geometry = dedicated ? null : (
        figure?.panelGeometries?.[String(panelId || '').toUpperCase()] || null
    );
    const sourceWidth = Number(sourceImage.naturalWidth || sourceImage.width) || 0;
    const sourceHeight = Number(sourceImage.naturalHeight || sourceImage.height) || 0;
    const reliableCrop = normalizePanelCropGeometry(geometry, sourceWidth, sourceHeight);
    const inputMode = dedicated || reliableCrop ? 'panel_crop' : 'figure_image';
    const variants = [];
    const seenDimensions = new Set();
    for (const maxEdge of [1200, 960, 768]) {
        let encoded;
        try {
            encoded = encodeFigureImageVariant(sourceImage, maxEdge, reliableCrop ? {
                ...reliableCrop,
                reliable: true
            } : null);
        } catch (error) {
            console.warn(`SCI Panel 解读：跳过 ${maxEdge}px 图片版本`, error.message);
            continue;
        }
        const key = `${encoded.width}x${encoded.height}`;
        if (seenDimensions.has(key)) continue;
        seenDimensions.add(key);
        variants.push({ ...encoded, inputMode, pixelsSupplied: true });
    }
    return variants;
}

const FIGURE_IMAGE_VIEWER_ID = 'sci-figure-image-viewer';
let figureImageViewerKeyHandler = null;
let figureImageViewerObjectUrl = '';
let figureImageViewerGeneration = 0;
let figureImageCachePreference = null;

async function figureImageCacheMode() {
    if (figureImageCachePreference &&
        Date.now() - figureImageCachePreference.capturedAt < 30000) {
        return figureImageCachePreference.enabled ? 'read-write' : 'none';
    }
    let enabled = true;
    try {
        const response = await chrome.runtime.sendMessage({ type: 'LLM_GET_SETTINGS' });
        enabled = response?.data?.settings?.autoCacheFigureImages !== false;
    } catch (_) {
        // Default-on keeps repeat Figure views fast during transient failures.
    }
    figureImageCachePreference = { enabled, capturedAt: Date.now() };
    return enabled ? 'read-write' : 'none';
}

async function resolveFigureImageSources(figure) {
    const localSources = typeof SciLLM.collectFigureImageSources === 'function'
        ? SciLLM.collectFigureImageSources(figure, document.baseURI)
        : [SciLLM.selectFigureImageSource(figure, document.baseURI)].filter(Boolean);
    const displayedSources = new Set();
    const explicitOriginalSources = new Set();
    Array.from(figure?.imageElements || []).forEach(imageElement => {
        [
            imageElement?.currentSrc,
            imageElement?.src || imageElement?.getAttribute?.('src'),
            imageElement?.getAttribute?.('data-src'),
            imageElement?.getAttribute?.('data-lazy-src')
        ].forEach(value => {
            const safe = typeof SciLLM.safeFigureSource === 'function'
                ? SciLLM.safeFigureSource(value, document.baseURI) : String(value || '');
            if (safe) displayedSources.add(safe);
        });
        [
            'data-original', 'data-original-src', 'data-full', 'data-full-src',
            'data-full-image', 'data-hires', 'data-high-res-src', 'data-large',
            'data-large-src', 'data-zoom-src'
        ].forEach(name => {
            const safe = typeof SciLLM.safeFigureSource === 'function'
                ? SciLLM.safeFigureSource(
                    imageElement?.getAttribute?.(name),
                    document.baseURI
                ) : '';
            if (safe) explicitOriginalSources.add(safe);
        });
    });
    const hasPromotedDirectSource = localSources.slice(0, 3).some(source =>
        (/^data:image\//i.test(source) ||
            /\.(?:avif|bmp|gif|jpe?g|png|svg|tiff?|webp)(?:$|[?#])/i.test(source)) &&
        (!displayedSources.has(source) || explicitOriginalSources.has(source))
    );
    const viewerLinks = [];
    const linkSet = new Set();
    if (typeof SciLLM.collectFigureViewerLinks === 'function') {
        Array.from(figure?.imageElements || []).forEach(imageElement => {
            SciLLM.collectFigureViewerLinks(imageElement, document.baseURI)
                .forEach(link => {
                    if (linkSet.has(link)) return;
                    linkSet.add(link);
                    viewerLinks.push(link);
                });
        });
    }
    const resolved = [];
    const resolvedSet = new Set();
    const addResolved = value => {
        const safe = typeof SciLLM.safeFigureSource === 'function'
            ? SciLLM.safeFigureSource(value, document.baseURI) : String(value || '');
        if (!safe || resolvedSet.has(safe)) return;
        resolvedSet.add(safe);
        resolved.push(safe);
    };
    await Promise.all((hasPromotedDirectSource ? [] : viewerLinks.slice(0, 6))
        .map(async link => {
        try {
            const response = await chrome.runtime.sendMessage({
                type: 'FIGURE_RESOLVE_IMAGE_CANDIDATES',
                url: link,
                documentUrl: location.href
            });
            if (response?.success) {
                (response.data?.candidates || []).slice(0, 30).forEach(addResolved);
            }
        } catch (_) {
            // Viewer-page resolution is additive; direct candidates remain.
        }
        }));
    localSources.forEach(addResolved);
    return resolved;
}

async function selectBestFigureImageResource(sources, cacheMode) {
    let best = null;
    const candidates = Array.from(new Set(sources || [])).slice(0, 14);
    for (const [candidateIndex, source] of candidates.entries()) {
        try {
            const measured = await measureExportImageResource(
                await fetchExportImageSource(source, { cacheMode })
            );
            const candidate = { ...measured, requestedSourceUrl: source, candidateIndex };
            if (!best || compareExportImageQuality(best, candidate) > 0) best = candidate;
            const area = Math.max(0, Number(candidate.pixelWidth) || 0) *
                Math.max(0, Number(candidate.pixelHeight) || 0);
            if (area >= 1600000) break;
        } catch (_) {
            // HTML wrappers, expired signatures, and anti-hotlink responses are
            // normal fallbacks in a cross-publisher candidate list.
        }
    }
    return best;
}

function adjacentFigureViewerId(figureId, direction) {
    const figures = getFigureWorkspaceInventory();
    if (!figures.length) return '';
    const foundIndex = figures.findIndex(item => item.figureId === figureId);
    const currentIndex = foundIndex >= 0 ? foundIndex : 0;
    if (direction === 'first') return figures[0].figureId;
    if (direction === 'last') return figures.at(-1).figureId;
    const offset = direction === 'previous' ? -1 : 1;
    return figures[(currentIndex + offset + figures.length) % figures.length].figureId;
}

function publishFigureImageViewerState(state) {
    chrome.runtime.sendMessage({
        type: 'FIGURE_ORIGINAL_VIEWER_STATE_CHANGED',
        open: state?.open === true,
        figureId: String(state?.figureId || ''),
        loading: state?.loading === true,
        captionVisible: state?.captionVisible === true
    }).catch(() => undefined);
}

function closeFigureImageViewer({ notify = true } = {}) {
    const previous = getFigureImageViewerState();
    figureImageViewerGeneration += 1;
    document.getElementById(FIGURE_IMAGE_VIEWER_ID)?.remove();
    if (figureImageViewerObjectUrl) {
        URL.revokeObjectURL(figureImageViewerObjectUrl);
        figureImageViewerObjectUrl = '';
    }
    if (figureImageViewerKeyHandler) {
        document.removeEventListener('keydown', figureImageViewerKeyHandler, true);
        figureImageViewerKeyHandler = null;
    }
    if (notify && previous.open) {
        publishFigureImageViewerState({
            open: false,
            figureId: previous.figureId,
            loading: false
        });
    }
    return { success: true, open: false, figureId: '' };
}

function getFigureImageViewerState() {
    const viewer = document.getElementById(FIGURE_IMAGE_VIEWER_ID);
    return {
        success: true,
        open: Boolean(viewer),
        figureId: String(viewer?.dataset?.figureId || ''),
        loading: viewer?.dataset?.loading === 'true',
        captionVisible: viewer?.dataset?.captionVisible === 'true'
    };
}

async function navigateFigureImageViewer(direction, figureNumber = 0) {
    const allowedDirections = new Set(['previous', 'next', 'first', 'last']);
    const viewerState = getFigureImageViewerState();
    if (!viewerState.open) {
        return { ...viewerState, success: false, code: 'VIEWER_NOT_OPEN' };
    }
    const requestedFigureNumber = Number(figureNumber);
    let targetId = '';
    if (Number.isInteger(requestedFigureNumber) && requestedFigureNumber > 0) {
        const requestedFigure = getFigureWorkspaceInventory().find(item =>
            item.isSupplemental !== true &&
            Number(item.figureNumber) === requestedFigureNumber
        );
        if (!requestedFigure) {
            return {
                ...viewerState,
                success: false,
                code: 'FIGURE_NOT_FOUND',
                requestedFigureNumber
            };
        }
        targetId = requestedFigure.figureId;
    } else if (!allowedDirections.has(direction)) {
        return { ...viewerState, success: false, code: 'INVALID_DIRECTION' };
    } else {
        targetId = adjacentFigureViewerId(viewerState.figureId, direction);
    }
    if (!targetId || targetId === viewerState.figureId) return viewerState;
    return showFigureImageViewer(targetId, {
        captionVisible: viewerState.captionVisible === true
    });
}

function legacyFigureImageViewer(figureId) {
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

async function showFigureImageViewer(figureId, {
    captionVisible = false
} = {}) {
    const figure = getFigureWorkspaceInventory().find(item => item.figureId === figureId);
    if (!figure) return { success: false, code: 'FIGURE_NOT_FOUND' };
    closeFigureImageViewer({ notify: false });
    const generation = figureImageViewerGeneration;

    const viewer = document.createElement('section');
    viewer.id = FIGURE_IMAGE_VIEWER_ID;
    viewer.dataset.figureId = figure.figureId || figureId;
    viewer.dataset.loading = 'true';
    viewer.dataset.captionVisible = String(captionVisible === true);
    viewer.setAttribute('role', 'dialog');
    viewer.setAttribute('aria-modal', 'true');
    viewer.setAttribute('aria-label', `${figure.figureLabel || figureId} 高清原图`);

    const header = document.createElement('header');
    const title = document.createElement('strong');
    title.textContent = `${figure.figureLabel || figureId} · 高清原图`;
    const shortcutHint = document.createElement('span');
    shortcutHint.className = 'sci-figure-viewer-shortcuts';
    shortcutHint.textContent =
        '←/→ 相邻 Figure　↑ 第一张　↓ 最后一张　1–9/0 直达 Figure';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'sci-figure-viewer-close';
    close.textContent = '×';
    close.setAttribute('aria-label', '关闭高清原图');
    header.append(title, shortcutHint, close);

    const canvas = document.createElement('div');
    canvas.className = 'sci-figure-viewer-canvas';
    canvas.tabIndex = 0;
    const stage = document.createElement('div');
    stage.className = 'sci-figure-viewer-stage';
    const loading = document.createElement('p');
    loading.className = 'sci-figure-viewer-loading';
    loading.setAttribute('role', 'status');
    loading.setAttribute('aria-live', 'polite');
    loading.textContent = `正在加载 ${figure.figureLabel || figureId} 高清原图…`;
    stage.appendChild(loading);
    canvas.appendChild(stage);

    const image = document.createElement('img');
    image.alt = figure.figureLabel || figureId;
    image.draggable = false;
    const controls = document.createElement('div');
    controls.className = 'sci-figure-viewer-controls';
    controls.hidden = true;
    let scale = 1;
    const label = document.createElement('span');
    label.setAttribute('aria-live', 'polite');
    const qualityLabel = document.createElement('span');
    qualityLabel.className = 'sci-figure-viewer-quality';
    const revealLoadedImage = () => {
        if (generation !== figureImageViewerGeneration) return;
        viewer.dataset.loading = 'false';
        stage.replaceChildren(image);
        controls.hidden = false;
        applyScale(1);
    };
    image.addEventListener('load', revealLoadedImage);
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
    const fitControl = makeControl('适配窗口', '使原图适配窗口', () => {
        applyScale(1);
        canvas.scrollTo({ left: 0, top: 0 });
    });
    const captionControl = makeControl(
        captionVisible ? '隐藏图注' : '查看图注',
        captionVisible ? '隐藏当前 Figure 图注' : '查看当前 Figure 图注',
        () => {
            const visible = viewer.dataset.captionVisible !== 'true';
            viewer.dataset.captionVisible = String(visible);
            captionControl.textContent = visible ? '隐藏图注' : '查看图注';
            captionControl.setAttribute(
                'aria-label',
                visible ? '隐藏当前 Figure 图注' : '查看当前 Figure 图注'
            );
            captionControl.setAttribute('aria-pressed', String(visible));
            publishFigureImageViewerState(getFigureImageViewerState());
        }
    );
    captionControl.classList.add('sci-figure-viewer-caption-toggle');
    captionControl.setAttribute('aria-pressed', String(captionVisible === true));
    controls.append(
        makeControl('−', '缩小原图', () => applyScale(scale - .25)),
        label,
        makeControl('+', '放大原图', () => applyScale(scale + .25)),
        fitControl,
        captionControl,
        qualityLabel
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

    figureImageViewerKeyHandler = event => {
        const direction = {
            ArrowLeft: 'previous',
            ArrowRight: 'next',
            ArrowUp: 'first',
            ArrowDown: 'last'
        }[event.key];
        const figureNumber = /^[0-9]$/.test(event.key)
            ? (event.key === '0' ? 10 : Number(event.key)) : 0;
        if (event.key === 'Escape') {
            event.preventDefault();
            closeFigureImageViewer();
            return;
        }
        if (!direction && !figureNumber) return;
        event.preventDefault();
        event.stopPropagation();
        if (figureNumber) {
            void navigateFigureImageViewer('', figureNumber);
            return;
        }
        const targetId = adjacentFigureViewerId(figureId, direction);
        if (targetId && targetId !== figureId) {
            void showFigureImageViewer(targetId, {
                captionVisible: viewer.dataset.captionVisible === 'true'
            });
        }
    };
    document.addEventListener('keydown', figureImageViewerKeyHandler, true);
    viewer.addEventListener('click', event => {
        if (event.target === viewer) closeFigureImageViewer();
    });
    close.addEventListener('click', closeFigureImageViewer);
    viewer.append(header, canvas, controls);
    document.documentElement.appendChild(viewer);
    publishFigureImageViewerState({
        open: true,
        figureId: figure.figureId || figureId,
        loading: true,
        captionVisible: viewer.dataset.captionVisible === 'true'
    });
    close.focus();

    const sources = await resolveFigureImageSources(figure);
    if (generation !== figureImageViewerGeneration) {
        return { success: false, code: 'VIEWER_SUPERSEDED' };
    }
    if (!sources.length) {
        viewer.dataset.loading = 'false';
        loading.className = 'sci-figure-viewer-error';
        loading.textContent = '没有找到可用的 Figure 图片地址。';
        return { success: false, code: 'IMAGE_NOT_FOUND' };
    }

    const cacheMode = await figureImageCacheMode();
    const resource = await selectBestFigureImageResource(sources, cacheMode);
    if (generation !== figureImageViewerGeneration) {
        return { success: false, code: 'VIEWER_SUPERSEDED' };
    }
    if (resource?.bytes?.length) {
        const blob = new Blob([resource.bytes], {
            type: resource.contentType || 'application/octet-stream'
        });
        figureImageViewerObjectUrl = URL.createObjectURL(blob);
        image.src = figureImageViewerObjectUrl;
        qualityLabel.textContent = [
            resource.pixelWidth && resource.pixelHeight
                ? `${resource.pixelWidth} × ${resource.pixelHeight}` : '',
            resource.cacheHit ? '本地缓存' :
                (cacheMode === 'read-write' ? '已自动缓存' : '')
        ].filter(Boolean).join(' · ');
        return {
            success: true,
            open: true,
            figureId,
            sourceUrl: resource.sourceUrl,
            pixelWidth: resource.pixelWidth,
            pixelHeight: resource.pixelHeight,
            cacheHit: resource.cacheHit === true,
            captionVisible: viewer.dataset.captionVisible === 'true'
        };
    }

    let sourceIndex = 0;
    image.addEventListener('error', () => {
        sourceIndex += 1;
        if (sourceIndex < sources.length) {
            image.src = sources[sourceIndex];
            return;
        }
        const failure = document.createElement('p');
        failure.className = 'sci-figure-viewer-error';
        failure.textContent = '高清原图加载失败；出版社可能要求在正文会话中直接读取。';
        viewer.dataset.loading = 'false';
        stage.replaceChildren(failure);
        controls.hidden = true;
    });
    image.src = sources[sourceIndex];
    return {
        success: true,
        open: true,
        figureId,
        fallback: true,
        captionVisible: viewer.dataset.captionVisible === 'true'
    };
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
        contextParagraphs: figure?.contextParagraphs || []
    });
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

function getFigureWorkspaceInventory({ forceRefresh = false } = {}) {
    const now = Date.now();
    let inventoryChanged = forceRefresh || figureWorkspaceInventoryDirty ||
        !figureWorkspaceInventoryInitialized;
    const freshnessCheckDue = !inventoryChanged &&
        now - figureWorkspaceLastFreshnessCheckAt >= FIGURE_WORKSPACE_FRESHNESS_TTL_MS;
    if (freshnessCheckDue) {
        figureWorkspaceLastFreshnessCheckAt = now;
        inventoryChanged = typeof SciLLM.figureInventoryNeedsRefresh === 'function' &&
            SciLLM.figureInventoryNeedsRefresh(figureWorkspaceInventory);
    }
    if (!inventoryChanged) {
        return figureWorkspaceInventory;
    }
    clearFigureWalkthroughs();
    const extractedParagraphs = extractArticleWithTrace('figure_workspace_inventory');
    figureWorkspaceInventory = SciLLM.extractArticleFigures(document, extractedParagraphs);
    figureWorkspaceInventoryInitialized = true;
    figureWorkspaceInventoryDirty = false;
    figureWorkspaceLastFreshnessCheckAt = Date.now();
    figureWorkspaceInventory.forEach(figure => {
        const state = figureWalkthroughState.get(figure.figureId);
        if (state?.figure) state.figure = figure;
    });
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
        figureInputHash: String(restored?.figureInputHash || ''),
        standard: restored?.standard || null,
        standardError: String(restored?.standardError || ''),
        deep: restored?.deep || null,
        activeDepth: restored?.activeDepth === 'standard' ? 'standard' : 'deep',
        deepLoading: false,
        deepError: String(restored?.deepError || ''),
        panelFollowups: restored?.panelFollowups || {},
        panelFollowupHistories: restored?.panelFollowupHistories || {},
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
    getFigureWorkspaceInventory();
    const state = figureWalkthroughState.get(figureId);
    if (!state?.standard || !state.figure) throw new Error('请先生成该图的标准解读');
    const operation = beginFigureOperation('single', figureId);
    const workspaceLifecycle = articleWorkspaceLifecycleGeneration;
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
            const currentFigureInputHash = buildFigureInputHash(state.figure, images);
            if (state.figureInputHash && currentFigureInputHash !== state.figureInputHash) {
                throw new Error('Figure 内容已变化，请先重新生成标准解读');
            }
            state.figureInputHash = currentFigureInputHash;
            const response = await chrome.runtime.sendMessage({
                type: 'LLM_ANALYZE_FIGURES',
                workspaceLifecycle,
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
            scheduleArticleWorkspaceArtifactsSave({ immediate: true });
        } catch (error) {
            if (workspaceLifecycle === articleWorkspaceLifecycleGeneration) {
                state.deepError = error?.message || '深度解读失败';
                state.activeDepth = 'standard';
                finishSingleFigureProgress(state.figure, error, operation);
                scheduleArticleWorkspaceArtifactsSave({ immediate: true });
            }
            throw error;
        } finally {
            if (workspaceLifecycle === articleWorkspaceLifecycleGeneration) {
                state.deepLoading = false;
                if (!state.deepError) finishSingleFigureProgress(state.figure, null, operation);
                figureDepthAnalysisPromise = null;
                figureDepthAnalysisId = '';
            }
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
    getFigureWorkspaceInventory();
    const operation = beginFigureOperation('single', figureId);
    const workspaceLifecycle = articleWorkspaceLifecycleGeneration;
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
                workspaceLifecycle,
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
            scheduleArticleWorkspaceArtifactsSave({ immediate: true });
            return {
                success: true,
                figureId,
                operationId: operation.operationId,
                result: operationResult,
                route: response.data.route || null
            };
        } catch (error) {
            if (workspaceLifecycle === articleWorkspaceLifecycleGeneration) {
                state.standardError = error?.message || 'FIGURE_ANALYSIS_FAILED';
                finishSingleFigureProgress(state.figure, error, operation);
                scheduleArticleWorkspaceArtifactsSave({ immediate: true });
            }
            throw error;
        } finally {
            if (workspaceLifecycle === articleWorkspaceLifecycleGeneration) {
                state.deepLoading = false;
                if (!state.standardError) {
                    finishSingleFigureProgress(state.figure, null, operation);
                }
                figureDepthAnalysisPromise = null;
                figureDepthAnalysisId = '';
            }
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

async function computePageDocumentHash() {
    const snapshot = getCanonicalArticleSnapshot();
    const known = String(snapshot?.documentHash || '').replace(/^sha256:/i, '').toLowerCase();
    if (/^[a-f0-9]{64}$/.test(known)) return known;
    const canonical = JSON.stringify((Array.isArray(snapshot?.paragraphs)
        ? snapshot.paragraphs : []).map(item => ({
        paragraphId: String(item?.paragraphId || ''),
        sectionTitle: String(item?.sectionTitle || ''),
        sectionPath: Array.isArray(item?.sectionPath) ? item.sectionPath : [],
        text: String(item?.text || '').normalize('NFKC').replace(/\s+/g, ' ').trim()
    })));
    if (globalThis.crypto?.subtle) {
        const digest = await globalThis.crypto.subtle.digest(
            'SHA-256', new TextEncoder().encode(canonical)
        );
        return Array.from(new Uint8Array(digest), value =>
            value.toString(16).padStart(2, '0')).join('');
    }
    let fallback = 2166136261;
    for (let index = 0; index < canonical.length; index += 1) {
        fallback ^= canonical.charCodeAt(index);
        fallback = Math.imul(fallback, 16777619);
    }
    return (fallback >>> 0).toString(16).padStart(8, '0').repeat(8);
}

async function analyzeSingleFigurePanelWithLLM(
    figureId,
    panelId,
    { forceRefresh = false } = {}
) {
    const workspaceLifecycle = articleWorkspaceLifecycleGeneration;
    const normalizedPanelId = normalizeRequestedPanelId(panelId);
    getFigureWorkspaceInventory();
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
            await waitForLocalOperation(operation);
            const [documentHash, imageVariants] = await Promise.all([
                computePageDocumentHash(),
                prepareFigurePanelImageVariants(state.figure, normalizedPanelId)
            ]);
            await waitForLocalOperation(operation);
            const response = await chrome.runtime.sendMessage({
                type: 'LLM_ANALYZE_FIGURE_PANEL',
                workspaceLifecycle,
                forceRefresh: forceRefresh === true,
                operationId: operation.operationId,
                documentHash,
                document: { title: document.title, documentHash },
                figure: {
                    figureId: state.figure.figureId,
                    figureLabel: state.figure.figureLabel,
                    caption: state.figure.caption,
                    panelHints: [normalizedPanelId],
                    contextParagraphs: state.figure.contextParagraphs,
                    imageVariants
                },
                panel: { panel: normalizedPanelId }
            });
            if (!response?.success) {
                const error = new Error(response?.error?.message || 'FIGURE_PANEL_ANALYSIS_FAILED');
                error.code = response?.error?.code || 'FIGURE_PANEL_ANALYSIS_FAILED';
                throw error;
            }
            if (!isCurrentFigureOperation(operation)) throwStaleFigureOperation(operation);
            const panel = response.data?.panelAnalysis;
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
            scheduleArticleWorkspaceArtifactsSave({ immediate: true });
            return {
                success: true,
                figureId,
                panelId: normalizedPanelId,
                panel,
                route: response.data.route || null,
                operationId: operation.operationId
            };
        } catch (error) {
            if (workspaceLifecycle === articleWorkspaceLifecycleGeneration) {
                state.panelAnalysisErrors[normalizedPanelId] =
                    error?.message || 'FIGURE_PANEL_ANALYSIS_FAILED';
                finishSingleFigureProgress(state.figure, error, operation);
                scheduleArticleWorkspaceArtifactsSave({ immediate: true });
            }
            throw error;
        } finally {
            if (workspaceLifecycle === articleWorkspaceLifecycleGeneration) {
                state.panelAnalysisLoading[normalizedPanelId] = false;
                if (!state.panelAnalysisErrors[normalizedPanelId]) {
                    finishSingleFigureProgress(state.figure, null, operation);
                }
                figureDepthAnalysisPromise = null;
                figureDepthAnalysisId = '';
            }
            finishFigureOperation(operation);
        }
    })();
    return figureDepthAnalysisPromise;
}

async function askFigurePanelWithLLM(
    figureId,
    panelId,
    topics = [],
    customQuestion = '',
    historyLabel = ''
) {
    const workspaceLifecycle = articleWorkspaceLifecycleGeneration;
    getFigureWorkspaceInventory();
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
    const normalizedHistoryLabel = String(historyLabel || '').normalize('NFKC')
        .replace(/\s+/g, ' ').trim().slice(0, 1200);
    if (!state?.figure || !panel || (!selectedTopics.length && !normalizedQuestion)) {
        const error = new Error('FIGURE_PANEL_FOLLOWUP_INVALID');
        error.code = 'FIGURE_PANEL_FOLLOWUP_INVALID';
        throw error;
    }
    const panelKey = String(panel.panel || '').toUpperCase();
    state.panelFollowups ||= {};
    state.panelFollowupHistories ||= {};
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
        const [documentHash, imageVariants] = await Promise.all([
            computePageDocumentHash(),
            prepareFigurePanelImageVariants(state.figure, panelKey)
        ]);
        const history = Array.isArray(state.panelFollowupHistories[panelKey])
            ? state.panelFollowupHistories[panelKey] : [];
        const response = await chrome.runtime.sendMessage({
            type: 'LLM_ASK_FIGURE_PANEL',
            workspaceLifecycle,
            documentHash,
            document: { title: document.title, documentHash },
            figure: {
                figureId: state.figure.figureId,
                figureLabel: state.figure.figureLabel,
                caption: state.figure.caption,
                panelHints: state.figure.panelHints,
                contextParagraphs: state.figure.contextParagraphs,
                imageVariants
            },
            panel,
            topics: selectedTopics,
            customQuestion: normalizedQuestion,
            history
        });
        assertCurrentArticleWorkspaceLifecycle(workspaceLifecycle);
        if (!response?.success || !response.data?.panelFollowup) {
            const error = new Error(response?.error?.message || 'FIGURE_PANEL_FOLLOWUP_FAILED');
            error.code = response?.error?.code || 'FIGURE_PANEL_FOLLOWUP_FAILED';
            throw error;
        }
        state.panelFollowups[panelKey] = response.data.panelFollowup;
        state.panelFollowupHistories[panelKey] = [
            ...history,
            {
                historyId: `panel-question-${Date.now()}`,
                role: 'user',
                content: normalizedHistoryLabel || normalizedQuestion || selectedTopics.join(', ')
            },
            {
                historyId: `panel-answer-${Date.now()}`,
                role: 'assistant',
                content: response.data.panelFollowup.answer
            }
        ];
        scheduleCurrentArticleArchiveSave();
        scheduleArticleWorkspaceArtifactsSave({ immediate: true });
        return {
            success: true,
            figureId,
            panel: panelKey,
            panelFollowup: response.data.panelFollowup,
            route: response.data.route || null
        };
    } catch (error) {
        if (workspaceLifecycle !== articleWorkspaceLifecycleGeneration) throw error;
        state.panelFollowupErrors[panelKey] = error?.message || 'FIGURE_PANEL_FOLLOWUP_FAILED';
        scheduleArticleWorkspaceArtifactsSave({ immediate: true });
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

function normalizeArticleChatContextScope(value) {
    const source = value && typeof value === 'object' ? value : {};
    const unique = values => [...new Set((Array.isArray(values) ? values : [])
        .map(item => String(item || '').normalize('NFKC').trim().slice(0, 240))
        .filter(Boolean))];
    return {
        sectionIds: unique(source.sectionIds).slice(0, 160),
        sectionTitles: unique(source.sectionTitles).slice(0, 40)
    };
}

function publicArticleChatTurn(turn = {}) {
    const allowedStatuses = new Set([
        'queued', 'generating', 'interrupted', 'completed', 'truncated', 'incomplete', 'cancelled', 'error',
        'unanswered'
    ]);
    const route = turn.route && typeof turn.route === 'object' ? turn.route : {};
    const usage = turn.usage && typeof turn.usage === 'object' ? turn.usage : null;
    return {
        turnId: String(turn.turnId || '').slice(0, 160),
        question: String(turn.question || '').slice(0, 4000),
        intent: turn.intent === 'highlight' ? 'highlight' : 'answer',
        highlightCategoryId: String(turn.highlightCategoryId || '').slice(0, 160),
        highlightCategoryName: String(turn.highlightCategoryName || '').slice(0, 160),
        highlightColor: /^#[0-9a-f]{6}$/i.test(String(turn.highlightColor || ''))
            ? String(turn.highlightColor).toUpperCase() : '#2F80ED',
        contextScope: normalizeArticleChatContextScope(turn.contextScope),
        matchCount: Math.max(0, Number(turn.matchCount) || 0),
        highlightError: String(turn.highlightError || '').slice(0, 1000),
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

function getPublicArticleChatState(options = {}) {
    const totalTurns = articleChatState.turns.length;
    const requestedLimit = Math.max(0, Math.floor(Number(options.limit) || 0));
    const windowStart = requestedLimit > 0
        ? Math.max(0, totalTurns - requestedLimit) : 0;
    const visibleTurns = articleChatState.turns.slice(windowStart);
    return {
        turns: visibleTurns.map(publicArticleChatTurn),
        totalTurns,
        returnedTurns: visibleTurns.length,
        windowStart,
        hasEarlier: windowStart > 0,
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

function notifyFigureWorkspaceStateChanged(kind, figure = null, extra = {}) {
    const event = {
        kind,
        figureId: String(figure?.figureId || extra.figureId || ''),
        figureLabel: String(figure?.figureLabel || extra.figureLabel || ''),
        operationId: String(figureAnalysisStatus.operationId || ''),
        completedFigures: Number(figureAnalysisStatus.completedFigures) || 0,
        failedFigures: Number(figureAnalysisStatus.failedFigures) || 0,
        totalFigures: Number(figureAnalysisStatus.totalFigures) || 0,
        ...extra
    };
    chrome.runtime.sendMessage({
        type: 'FIGURE_WORKSPACE_STATE_CHANGED', event
    }).catch(() => {});
}

function articleWorkspaceLifecycleError() {
    const error = new Error('ARTICLE_WORKSPACE_LIFECYCLE_CHANGED');
    error.code = 'CANCELLED';
    return error;
}

function assertCurrentArticleWorkspaceLifecycle(generation) {
    if (generation !== articleWorkspaceLifecycleGeneration) {
        throw articleWorkspaceLifecycleError();
    }
}

function cancelWorkspaceOperation(operation) {
    if (!operation) return;
    operation.cancelled = true;
    operation.paused = false;
    operation.waiters?.splice(0).forEach(resolve => resolve());
    if (operation.operationId) {
        chrome.runtime.sendMessage({
            type: 'LLM_CONTROL_OPERATION',
            operationId: operation.operationId,
            command: 'cancel'
        }).catch(() => {});
    }
}

function invalidateArticleWorkspaceLifecycle() {
    articleWorkspaceLifecycleGeneration += 1;
    articleChatGeneration += 1;
    const chatOperationId = String(articleChatState.operationId || '');
    cancelWorkspaceOperation(llmOperationState.active);
    cancelWorkspaceOperation(figureOperationState.active);
    llmOperationState.generation += 1;
    figureOperationState.generation += 1;
    llmOperationState.active = null;
    figureOperationState.active = null;
    llmProgressiveAnalysis = null;
    llmAnalysisPromise = null;
    figureAnalysisPromise = null;
    figureDepthAnalysisPromise = null;
    figureDepthAnalysisId = '';
    crossFigureLogicPromise = null;
    reviewOutlinePromise = null;
    articleChatPumpPromise = null;
    articleWorkspaceMutationTail = Promise.resolve();
    if (chatOperationId) {
        chrome.runtime.sendMessage({
            type: 'LLM_CONTROL_OPERATION',
            operationId: chatOperationId,
            command: 'cancel'
        }).catch(() => {});
    }
    return articleWorkspaceLifecycleGeneration;
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
        const paragraphs = filterParagraphsForArticleAnalysis(
            Array.isArray(snapshot.paragraphs) ? snapshot.paragraphs : []
        )
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
        turn.status = progress.status === 'truncated' ? 'truncated'
            : progress.status === 'incomplete' ? 'incomplete' : 'completed';
        changed = true;
    }
    if (!changed) return false;
    turn.updatedAt = Date.now();
    notifyArticleChatStateChanged('turn_updated', turn, { phase });
    if (phase === 'chat_answer_block') {
        void persistArticleChatCheckpoint(turn).catch(() => undefined);
    }
    if (phase === 'chat_answer_block' || phase === 'chat_cancelled' ||
        phase === 'chat_completed' || phase === 'chat_error') {
        scheduleCurrentArticleArchiveSave();
        scheduleArticleWorkspaceArtifactsSave({ immediate: phase !== 'chat_answer_block' });
    }
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
        intent: options.intent === 'highlight' ? 'highlight' : 'answer',
        highlightCategoryId: String(options.categoryId || '').slice(0, 160),
        highlightCategoryName: String(options.categoryName || '').normalize('NFKC')
            .replace(/\s+/g, ' ').trim().slice(0, 160),
        highlightColor: /^#[0-9a-f]{6}$/i.test(String(options.highlightColor || ''))
            ? String(options.highlightColor).toUpperCase() : '#2F80ED',
        contextScope: normalizeArticleChatContextScope(options.contextScope),
        matchCount: 0,
        highlightError: '',
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

function articleChatFailureMessage(error) {
    const messages = {
        OUTPUT_TRUNCATED: '模型连续达到输出上限。插件已自动提高额度并续写，但仍未形成完整回答；请把问题拆成两个更具体的问题，或检查当前 Profile 的“自动上限”是否过低。',
        INVALID_RESPONSE: '模型连续两次没有返回可解析的回答格式。请重试；若仍失败，请检查当前 Profile 的 Provider 是否与 API 接口协议一致。',
        CONTEXT_BUDGET_EXCEEDED: '当前模型上下文不足以同时容纳问题、证据和回答，请提高该 Profile 的上下文窗口设置或缩小问题范围。',
        CODEX_NOT_AUTHENTICATED: '插件专用 Codex 会话未登录或已过期。请打开设置 → 模型设置，在“本机 Codex”中点击“登录 / 重新登录”。',
        CODEX_NOT_INSTALLED: '未找到本机 Codex。请先安装 Codex，并重新安装本机桥。',
        CODEX_BRIDGE_UNAVAILABLE: '本机 Codex 桥未安装、未注册或已断开。请重新安装本机桥并重载扩展。',
        CODEX_PROVIDER_REJECTED: '本机 Codex 拒绝了这次请求。请到设置页检查登录状态并运行连接测试。',
        PROVIDER_UNAVAILABLE: 'Codex 服务暂时不可用，请稍后重试；这不是论文内容或上下文容量错误。',
        QUOTA_EXHAUSTED: '当前 Codex 账户已达到使用限额，请等待额度恢复或切换其他模型。'
    };
    return messages[error?.code] || String(error?.message || '全文问答失败').slice(0, 1000);
}

function articleChatRequestQuestion(turn) {
    if (turn?.intent !== 'highlight') return turn?.question || '';
    return [
        '你正在执行“全文语义检索并高亮”，不是普通问答。',
        `用户的自然语言检索意图是：${turn.question}`,
        '请找出正文中所有直接匹配该意图的重要原文句子。',
        '回答要简短；每个匹配必须附带可逐字回定位的原文证据 citation。',
        '不要用推测补足证据，不要返回只在标题、作者、导航、参考文献或附加界面中出现的内容。'
    ].join('\n');
}

async function createSemanticAnnotationsFromTurn(turn) {
    if (turn?.intent !== 'highlight') return 0;
    await (manualPreparePromise || prepareManualDocument());
    const evidenceItems = (Array.isArray(turn.answerBlocks) ? turn.answerBlocks : [])
        .flatMap(block => Array.isArray(block?.evidence) ? block.evidence : [])
        .filter(item => item?.verificationStatus === 'verified' && item.quote)
        .slice(0, 80);
    const seen = new Set();
    let matched = 0;
    for (const evidence of evidenceItems) {
        const element = findManualBlockElement(evidence.paragraphId) ||
            findManualBlockElement(evidence.sourceKey);
        const block = findManualBlock(element);
        if (!block) continue;
        const sourceText = manualReadableText(block.element);
        const span = SciLLM.findCanonicalQuoteSourceSpan?.(sourceText, evidence.quote);
        if (!span || span.sourceEnd <= span.sourceStart) continue;
        const key = `${block.blockId}:${span.sourceStart}:${span.sourceEnd}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const mark = await saveAutomaticAnnotation(
            block,
            span.sourceStart,
            span.sourceEnd,
            {
                sourceType: 'semantic',
                sourceQuery: turn.question,
                categoryId: turn.highlightCategoryId || 'semantic_match',
                categoryName: turn.highlightCategoryName || '智能检索匹配',
                categoryColor: turn.highlightColor || '#2F80ED'
            }
        );
        if (mark) matched += 1;
    }
    turn.matchCount = matched;
    scheduleArticleWorkspaceArtifactsSave({ immediate: true });
    return matched;
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
        const selectedSectionIds = new Set(
            normalizeArticleChatContextScope(turn.contextScope).sectionIds
        );
        const paragraphs = filterParagraphsForArticleAnalysis(
            Array.isArray(snapshot.paragraphs) ? snapshot.paragraphs : []
        )
            .filter(item => !selectedSectionIds.size ||
                selectedSectionIds.has(String(item?.sectionId || '')))
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
        if (selectedSectionIds.size && !paragraphs.length) {
            const error = new Error('ARTICLE_CHAT_SCOPE_EMPTY');
            error.code = 'INVALID_SETTINGS';
            throw error;
        }
        const history = turn.intent === 'highlight' || selectedSectionIds.size
            ? [] : articleChatHistoryForTurn(turn.turnId);
        articleChatState.memoryNeedsRebuild = false;
        const response = await chrome.runtime.sendMessage({
            type: 'LLM_ASK_ARTICLE',
            workspaceLifecycle: articleWorkspaceLifecycleGeneration,
            operationId,
            turnId: turn.turnId,
            profileId: turn.selectedProfileId,
            question: articleChatRequestQuestion(turn),
            history,
            document: {
                title: document.title,
                url: globalThis.location?.href || '',
                documentHash: String(snapshot.documentHash || ''),
                revision: Math.max(1, Number(snapshot.revision) || 1),
                paragraphs
            }
        });
        if (turn.operationId !== operationId || generation !== articleChatGeneration) {
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
        turn.status = answer.status === 'truncated' ? 'truncated'
            : answer.status === 'incomplete' ? 'incomplete' : 'completed';
        turn.route = response.data.route || null;
        turn.profileName = String(response.data.route?.effectiveProfileName || '');
        turn.model = String(response.data.route?.model || '');
        turn.usage = response.data.usage || turn.usage;
        turn.plan = publicArticleChatPlan(response.data.plan);
        turn.coverage = response.data.coverage || turn.coverage;
        articleChatState.coverage = turn.coverage;
        if (turn.intent === 'highlight') {
            try {
                await createSemanticAnnotationsFromTurn(turn);
                turn.highlightError = '';
            } catch (error) {
                turn.highlightError = String(
                    error?.message || 'SEMANTIC_HIGHLIGHT_RENDER_FAILED'
                ).slice(0, 1000);
            }
        }
        turn.error = '';
        turn.updatedAt = Date.now();
        void persistArticleChatCheckpoint(turn).catch(() => undefined);
        scheduleCurrentArticleArchiveSave();
        notifyArticleChatStateChanged('turn_updated', turn, { phase: 'chat_completed' });
    } catch (error) {
        if (generation !== articleChatGeneration) return;
        const cancelled = error?.code === 'CANCELLED' || error?.name === 'AbortError';
        turn.status = cancelled ? 'cancelled' : 'error';
        turn.error = cancelled
            ? '本次提问已取消，已完成的回答内容已保留。'
            : articleChatFailureMessage(error);
        turn.updatedAt = Date.now();
        articleChatState.error = turn.error;
        void persistArticleChatCheckpoint(turn).catch(() => undefined);
        scheduleCurrentArticleArchiveSave();
        notifyArticleChatStateChanged('turn_updated', turn, {
            phase: cancelled ? 'chat_cancelled' : 'chat_error'
        });
    } finally {
        const currentGeneration = generation === articleChatGeneration;
        if (currentGeneration && articleChatState.operationId === operationId) {
            articleChatState.loading = false;
            articleChatState.operationId = '';
            articleChatState.activeTurnId = '';
        }
        if (currentGeneration) turn.operationId = '';
        chrome.runtime.sendMessage({
            type: 'LLM_CONTROL_OPERATION', operationId, command: 'release'
        }).catch(() => {});
        if (currentGeneration) {
            notifyArticleChatStateChanged('turn_updated', turn, { phase: 'chat_terminal' });
        }
    }
}

function pumpArticleChatQueue() {
    if (articleChatPumpPromise) return articleChatPumpPromise;
    const workspaceLifecycle = articleWorkspaceLifecycleGeneration;
    let pumpPromise;
    pumpPromise = (async () => {
        while (workspaceLifecycle === articleWorkspaceLifecycleGeneration) {
            const nextTurn = articleChatState.turns.find(turn => turn.status === 'queued');
            if (!nextTurn) break;
            await runArticleChatTurn(nextTurn);
        }
    })().finally(() => {
        if (articleChatPumpPromise === pumpPromise) {
            articleChatPumpPromise = null;
            const queued = articleChatState.turns.some(turn => turn.status === 'queued');
            if (queued) void pumpArticleChatQueue();
        }
    });
    articleChatPumpPromise = pumpPromise;
    return articleChatPumpPromise;
}

async function askArticleWithLLM(question, profileId = '', options = {}) {
    const turn = createArticleChatTurn(question, profileId, options);
    articleChatState.turns.push(turn);
    notifyArticleChatStateChanged('turn_added', turn);
    void persistArticleChatCheckpoint(turn, { append: true }).catch(() => undefined);
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
    void persistArticleChatCheckpoint(turn).catch(() => undefined);
    scheduleArticleWorkspaceArtifactsSave({ immediate: true });
    notifyArticleChatStateChanged('turn_updated', turn, { phase: 'chat_cancelled' });
    return { success: true, active: false, cancelled: true };
}

function removeArticleChatTurn(turnId, { queuedOnly = false } = {}) {
    const workspaceLifecycle = articleWorkspaceLifecycleGeneration;
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
    void deleteArticleChatCheckpoint(normalizedTurnId, { workspaceLifecycle })
        .catch(() => undefined);
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
    void persistArticleChatCheckpoint(turn).catch(() => undefined);
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
    turn.matchCount = 0;
    turn.highlightError = '';
    turn.status = 'queued';
    turn.selectedProfileId = String(profileId || turn.selectedProfileId).trim().slice(0, 100);
    turn.updatedAt = Date.now();
    articleChatState.memoryNeedsRebuild = true;
    void persistArticleChatCheckpoint(turn).catch(() => undefined);
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
    const workspaceLifecycle = articleWorkspaceLifecycleGeneration;
    articleChatGeneration += 1;
    const deletedTurnIds = articleChatState.turns.map(turn => turn.turnId).filter(Boolean);
    articleChatState = {
        turns: [], loading: false, error: '', operationId: '', activeTurnId: '',
        coverage: null, memoryNeedsRebuild: true
    };
    deletedTurnIds.forEach(turnId => {
        void deleteWorkspaceTurnCheckpoint(turnId, { workspaceLifecycle })
            .catch(() => undefined);
    });
    scheduleCurrentArticleArchiveSave();
    scheduleArticleWorkspaceArtifactsSave({ immediate: true });
    notifyArticleChatStateChanged('chat_cleared');
    return { success: true };
}

async function analyzeCrossFigureLogicWithLLM({ forceRefresh = false } = {}) {
    if (crossFigureLogicPromise) return crossFigureLogicPromise;
    const workspaceLifecycle = articleWorkspaceLifecycleGeneration;
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
                workspaceLifecycle,
                forceRefresh: forceRefresh === true,
                document: { title: document.title },
                figures
            });
            assertCurrentArticleWorkspaceLifecycle(workspaceLifecycle);
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
            scheduleArticleWorkspaceArtifactsSave({ immediate: true });
            return { success: true, result, route: response.data.route || null };
        } catch (error) {
            if (workspaceLifecycle !== articleWorkspaceLifecycleGeneration) throw error;
            crossFigureLogicState = {
                result: crossFigureLogicState.result,
                loading: false,
                error: error?.message || 'CROSS_FIGURE_LOGIC_FAILED'
            };
            scheduleArticleWorkspaceArtifactsSave({ immediate: true });
            throw error;
        } finally {
            if (workspaceLifecycle === articleWorkspaceLifecycleGeneration) {
                crossFigureLogicPromise = null;
            }
        }
    })();
    return crossFigureLogicPromise;
}

async function analyzeFiguresWithLLM(options = {}) {
    if (figureAnalysisPromise) return figureAnalysisPromise;
    const analysisDepth = options.analysisDepth === 'standard' ? 'standard' : 'deep';
    const operation = beginFigureOperation('batch');
    const workspaceLifecycle = articleWorkspaceLifecycleGeneration;
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
            figureWorkspaceInventoryInitialized = true;
            figureWorkspaceInventoryDirty = false;
            figureWorkspaceLastFreshnessCheckAt = Date.now();
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
                        panelFollowupHistories: previous?.panelFollowupHistories || {},
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
                        workspaceLifecycle,
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
                    await waitForLocalOperation(operation);
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
                    updateFigureProgress(figure.figureId, {
                        phase: 'figure',
                        running: false,
                        completed: true,
                        failed: false,
                        cancelled: false,
                        completedFigures: results.length,
                        totalFigures: figures.length,
                        figureLabel: figure.figureLabel,
                        cacheHit: Number(response.data.cacheHits) > 0,
                        visionFallback: Number(response.data.visionFallbacks) > 0,
                        route: response.data.route || null
                    });
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
                    scheduleArticleWorkspaceArtifactsSave({ immediate: true });
                    notifyFigureWorkspaceStateChanged('figure_completed', figure, {
                        analysisDepth
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
                    scheduleArticleWorkspaceArtifactsSave({ immediate: true });
                    notifyFigureWorkspaceStateChanged('figure_failed', figure, { failure });
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
            results.forEach(result => {
                const figure = figures.find(item => item.figureId === result.figureId);
                updateFigureProgress(result.figureId, {
                    phase: 'figure',
                    running: false,
                    completed: true,
                    failed: false,
                    cancelled: false,
                    completedFigures: results.length,
                    totalFigures: figures.length,
                    figureLabel: figure?.figureLabel || result.figureLabel || result.figureId
                });
            });
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
            if (workspaceLifecycle === articleWorkspaceLifecycleGeneration) {
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
            }
            throw error;
        }
    })();
    try {
        return await figureAnalysisPromise;
    } catch (error) {
        if (error?.code === 'CANCELLED' || operation.cancelled) {
            if (workspaceLifecycle === articleWorkspaceLifecycleGeneration) {
                showLlmPageStatus('Figure 解读已取消，已完成结果会保留。', 'success');
            }
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
        if (workspaceLifecycle === articleWorkspaceLifecycleGeneration) {
            figureAnalysisPromise = null;
        }
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
    articleStructureObservedRoots = new Set();
    articleStructureBoundaryRoots = new Map();
    if (articleStructureRefreshTimer !== null) {
        clearTimeout(articleStructureRefreshTimer);
        articleStructureRefreshTimer = null;
    }
}

function isArticleStructureMutation(mutation) {
    const changedNodes = mutation?.type === 'characterData'
        ? [mutation.target]
        : [...(mutation?.addedNodes || []), ...(mutation?.removedNodes || [])];
    const boundaryRoots = articleStructureBoundaryRoots.get(mutation?.target);
    if (boundaryRoots?.size && !changedNodes.some(node =>
        [...boundaryRoots].some(root => node === root || node?.contains?.(root)))) {
        return false;
    }
    const pluginRewrite = mutation?.type === 'childList' && changedNodes.some(node => {
        const element = node?.nodeType === Node.ELEMENT_NODE ? node : null;
        return Boolean(element && (
            element.closest?.('[data-sci-plugin-ui]') ||
            element.matches?.('.sci-highlight,.sci-llm-highlight,.sci-manual-highlight')
        ));
    });
    return changedNodes.some(node => {
        const element = node?.nodeType === Node.ELEMENT_NODE
            ? node : node?.parentElement || mutation?.target?.parentElement || mutation?.target;
        if (pluginRewrite && node?.nodeType !== Node.ELEMENT_NODE) return false;
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

function isFigureInventoryMutation(mutation) {
    const selector = [SciLLM.FIGURE_SELECTOR, SciLLM.CAPTION_SELECTOR]
        .filter(Boolean).join(',');
    if (!selector) return false;
    const changedNodes = mutation?.type === 'characterData'
        ? [mutation.target?.parentElement || mutation.target]
        : [...(mutation?.addedNodes || []), ...(mutation?.removedNodes || []), mutation?.target];
    return changedNodes.some(node => {
        const element = node?.nodeType === Node.ELEMENT_NODE
            ? node : node?.parentElement;
        if (!element || element.closest?.('[data-sci-plugin-ui]')) return false;
        try {
            return Boolean(
                element.matches?.(selector) ||
                element.closest?.(selector) ||
                element.querySelector?.(selector)
            );
        } catch (_) {
            return false;
        }
    });
}

function markFigureWorkspaceInventoryDirty({ notify = false } = {}) {
    figureWorkspaceInventoryDirty = true;
    figureWorkspaceLastFreshnessCheckAt = 0;
    if (!notify) return;
    if (figureWorkspaceChangeNotificationTimer !== null) {
        clearTimeout(figureWorkspaceChangeNotificationTimer);
    }
    figureWorkspaceChangeNotificationTimer = setTimeout(() => {
        figureWorkspaceChangeNotificationTimer = null;
        notifyFigureWorkspaceStateChanged('inventory_changed');
    }, 120);
}

function startArticleStructureObserver() {
    stopArticleStructureObserver();
    articleStructureObserver = new MutationObserver(mutations => {
        if (mutations.some(isFigureInventoryMutation)) {
            markFigureWorkspaceInventoryDirty({ notify: true });
        }
        if (!mutations.some(isArticleStructureMutation)) return;
        if (articleStructureRefreshTimer !== null) {
            clearTimeout(articleStructureRefreshTimer);
        }
        articleStructureRefreshTimer = setTimeout(() => {
            articleStructureRefreshTimer = null;
            const previousRevision = currentArticleStructure?.revision || 0;
            const next = extractCurrentArticleStructure({ forceRefresh: true });
            startArticleStructureObserver();
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
    const roots = getArticleStructureObserveRoots();
    articleStructureObservedRoots = new Set(roots);
    roots.forEach(root => {
        articleStructureObserver.observe(root, {
            childList: true,
            characterData: true,
            subtree: true
        });
        const parent = root.parentElement;
        if (!parent || articleStructureObservedRoots.has(parent)) return;
        const ownedRoots = articleStructureBoundaryRoots.get(parent) || new Set();
        ownedRoots.add(root);
        articleStructureBoundaryRoots.set(parent, ownedRoots);
    });
    articleStructureBoundaryRoots.forEach((ownedRoots, parent) => {
        if (ownedRoots.size) articleStructureObserver.observe(parent, { childList: true });
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

const ARTICLE_CHAT_CITATION_HIGHLIGHT_NAME = 'sci-article-citation-focus';
let articleChatCitationHighlightTimer = null;
let articleChatCitationHighlightSource = null;

function collectArticleSourceTextNodes(source) {
    const nodes = [];
    const walker = document.createTreeWalker(source, NodeFilter.SHOW_TEXT, {
        acceptNode: node => {
            const parent = node.parentElement;
            if (!node.textContent || parent?.closest?.(
                'script, style, noscript, [hidden], [aria-hidden="true"], #sci-reading-panel'
            )) {
                return NodeFilter.FILTER_REJECT;
            }
            return NodeFilter.FILTER_ACCEPT;
        }
    });
    let node;
    while ((node = walker.nextNode())) nodes.push(node);
    return nodes;
}

function locateArticleSourceTextOffset(nodes, requestedOffset, preferNextNode = false) {
    const offset = Math.max(0, Number(requestedOffset) || 0);
    let cursor = 0;
    for (let index = 0; index < nodes.length; index += 1) {
        const node = nodes[index];
        const next = cursor + node.textContent.length;
        if (offset < next || (
            offset === next && (!preferNextNode || index === nodes.length - 1)
        )) {
            return { node, offset: Math.max(0, Math.min(node.textContent.length, offset - cursor)) };
        }
        cursor = next;
    }
    const last = nodes.at(-1);
    return last ? { node: last, offset: last.textContent.length } : null;
}

function clearArticleChatCitationHighlight() {
    clearTimeout(articleChatCitationHighlightTimer);
    articleChatCitationHighlightTimer = null;
    try {
        globalThis.CSS?.highlights?.delete(ARTICLE_CHAT_CITATION_HIGHLIGHT_NAME);
    } catch (_) {
        // A browser without the Custom Highlight API still gets paragraph focus below.
    }
    articleChatCitationHighlightSource?.classList?.remove('sci-article-source-focus');
    articleChatCitationHighlightSource = null;
}

function focusArticleSourceQuote(anchor, quote) {
    const source = resolveArticleAnchor(anchor);
    const requestedQuote = String(quote || '').trim();
    if (!source || !requestedQuote || typeof SciLLM.findCanonicalQuoteSourceSpan !== 'function') {
        return false;
    }
    const nodes = collectArticleSourceTextNodes(source);
    const sourceText = nodes.map(node => node.textContent).join('');
    const quoteSpan = SciLLM.findCanonicalQuoteSourceSpan(sourceText, requestedQuote);
    if (!quoteSpan) return false;
    const start = locateArticleSourceTextOffset(nodes, quoteSpan.sourceStart, true);
    const end = locateArticleSourceTextOffset(nodes, quoteSpan.sourceEnd, false);
    if (!start || !end) return false;

    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    if (range.collapsed) return false;

    clearArticleChatCitationHighlight();
    articleChatCitationHighlightSource = source;
    source.classList.add('sci-article-source-focus');
    if (globalThis.CSS?.highlights && typeof globalThis.Highlight === 'function') {
        try {
            CSS.highlights.set(ARTICLE_CHAT_CITATION_HIGHLIGHT_NAME, new Highlight(range));
        } catch (_) {
            // The element outline remains as the fallback focus indication.
        }
    }

    const rect = range.getBoundingClientRect();
    if (rect && Number.isFinite(rect.top) && (rect.width > 0 || rect.height > 0)) {
        globalThis.scrollTo({
            top: Math.max(0, globalThis.scrollY + rect.top -
                (globalThis.innerHeight / 2) + (rect.height / 2)),
            behavior: 'smooth'
        });
    } else {
        source.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    articleChatCitationHighlightTimer = setTimeout(
        clearArticleChatCitationHighlight, 3200
    );
    return true;
}

function focusArticleSource(anchor) {
    const source = resolveArticleAnchor(anchor);
    if (!source) return false;
    clearArticleChatCitationHighlight();
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
        const enclosingManualMark = mark.closest?.('.sci-manual-highlight');
        if (enclosingManualMark && enclosingManualMark !== mark) return;
        const highlightId = mark.dataset.sciDistributionId ||
            `sci-distribution-${markIndex + 1}`;
        mark.dataset.sciDistributionId = highlightId;
        const paragraphElement = mark.closest?.('[data-sci-llm-paragraph-id]') || null;
        const paragraphSourceId = paragraphElement?.dataset?.sciLlmParagraphId || '';
        const paragraph = paragraphsBySource.get(paragraphSourceId);
        let sourceStart = null;
        if (paragraphElement && typeof document.createRange === 'function') {
            try {
                const prefixRange = document.createRange();
                prefixRange.selectNodeContents(paragraphElement);
                prefixRange.setEndBefore(mark);
                sourceStart = prefixRange.toString().length;
            } catch (_) {
                sourceStart = null;
            }
        }
        const source = mark.dataset.source ||
            (mark.classList.contains('sci-manual-highlight') ? 'manual' :
                mark.classList.contains('sci-llm-highlight') ? 'llm' : 'regex');
        const manualAnnotation = mark.classList.contains('sci-manual-highlight')
            ? manualAnnotationById(mark.dataset.annotationId) : null;
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
                quote: normalizeArticleNavigatorText(mark.textContent).slice(0, 240),
                sourceStart,
                sourceEnd: Number.isInteger(sourceStart)
                    ? sourceStart + String(mark.textContent || '').length : null,
                note: String(manualAnnotation?.note || '').slice(0, 1000),
                sourceQuery: String(manualAnnotation?.sourceQuery || '').slice(0, 1000)
            });
        });
    });
    return occurrences;
}

function serializeArticleWorkspaceNode(node, paragraphCounts, sectionKinds) {
    const children = (Array.isArray(node?.children) ? node.children : [])
        .map(child => serializeArticleWorkspaceNode(child, paragraphCounts, sectionKinds));
    const sectionId = String(node?.sectionId || '');
    const ownKind = String(sectionKinds.get(sectionId) || node?.sectionKind || '');
    const analysisSectionIds = [
        ...(paragraphCounts.get(sectionId) ? [sectionId] : []),
        ...children.flatMap(child => child.analysisSectionIds || [])
    ].filter((value, index, values) => value && values.indexOf(value) === index);
    const analysisStates = analysisSectionIds.map(id =>
        articleAnalysisSectionSelected(id, sectionKinds.get(id))
    );
    return {
        sectionId,
        sourceKey: String(node?.sourceKey || ''),
        title: normalizeArticleNavigatorText(node?.title) || '未命名章节',
        displayTitle: String(node?.displayTitle || node?.title || '未命名章节')
            .replace(/\s+/g, ' ').trim().slice(0, 1000),
        level: Math.max(1, Number(node?.level) || 1),
        order: Number(node?.order) || 0,
        paragraphCount: paragraphCounts.get(sectionId) || 0,
        sectionKind: ownKind,
        analysisSectionIds,
        analysisSelected: analysisStates.length > 0 && analysisStates.every(Boolean),
        analysisIndeterminate: analysisStates.some(Boolean) && !analysisStates.every(Boolean),
        children
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
        const caption = normalizeArticleNavigatorText(figure?.caption).slice(0, 12000);
        const captionBlocks = typeof SciLLM.splitFigureCaptionByPanelGroups === 'function'
            ? SciLLM.splitFigureCaptionByPanelGroups(caption)
                .slice(0, 60)
                .map(block => ({
                    kind: block?.kind === 'panels' ? 'panels' : 'overview',
                    panels: Array.isArray(block?.panels)
                        ? block.panels.map(String).slice(0, 26) : [],
                    text: normalizeArticleNavigatorText(block?.text).slice(0, 6000)
                }))
                .filter(block => block.text)
            : [];
        return {
            figureId: String(figure?.figureId || ''),
            figureLabel: String(figure?.figureLabel || ''),
            hasImage: Boolean(SciLLM.selectFigureImageSource(figure, document.baseURI)),
            caption,
            captionBlocks,
            isSupplemental: figure?.isSupplemental === true,
            panelHints: Array.isArray(figure?.panelHints) ? figure.panelHints.slice(0, 30) : [],
            figureInputHash: String(source.figureInputHash || ''),
            activeDepth: source.activeDepth === 'standard' ? 'standard' : 'deep',
            standard: source.standard || null,
            standardError: String(source.standardError || ''),
            deep: source.deep || null,
            deepLoading: source.deepLoading === true,
            deepError: String(source.deepError || ''),
            panelFollowups: source.panelFollowups || {},
            panelFollowupHistories: source.panelFollowupHistories || {},
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

function buildArticleWorkspaceSnapshot({ forceRefresh = false, chatLimit = 0 } = {}) {
    const canonicalSnapshot = getCanonicalArticleSnapshot({ forceRefresh });
    const structure = canonicalSnapshot.structure;
    const paragraphCounts = new Map();
    const sectionKinds = new Map();
    canonicalSnapshot.paragraphs.forEach(paragraph => {
        const sectionId = String(paragraph.sectionId || '');
        paragraphCounts.set(sectionId, (paragraphCounts.get(sectionId) || 0) + 1);
        if (paragraph.sectionKind) sectionKinds.set(sectionId, paragraph.sectionKind);
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
            serializeArticleWorkspaceNode(node, paragraphCounts, sectionKinds)),
        paragraphs: canonicalSnapshot.paragraphs.map(paragraph => ({
            paragraphId: String(paragraph.paragraphId || ''),
            sourceKey: String(paragraph.sourceKey || ''),
            textHash: String(paragraph.textHash || ''),
            navigationRevision: Number(structure.revision) || 0,
            sectionId: String(paragraph.sectionId || ''),
            sectionKind: String(paragraph.sectionKind || ''),
            sectionTitle: normalizeArticleNavigatorText(paragraph.sectionTitle),
            displaySectionTitle: String(
                paragraph.displaySectionTitle || paragraph.sectionTitle || ''
            ).replace(/\s+/g, ' ').trim().slice(0, 1000),
            sectionPath: (Array.isArray(paragraph.headingPath) ? paragraph.headingPath : [])
                .map(item => normalizeArticleNavigatorText(item?.title)).filter(Boolean),
            text: normalizeArticleNavigatorText(paragraph.text).slice(0, 4000),
            displayText: String(paragraph.displayText || paragraph.text || '')
                .replace(/\s+/g, ' ').trim().slice(0, 4000)
        })),
        highlightDistribution,
        ledger: lastLlmAnalysis?.rawAnalysis?.ledger || null,
        readingViewId: lastLlmAnalysis?.rawAnalysis?.readingViewId || '',
        studyProfile: lastLlmAnalysis?.rawAnalysis?.studyProfile || null,
        reviewOutline: lastReviewOutline || null,
        paragraphSummaries: Array.from(standaloneReviewParagraphSummaries.values()),
        chat: getPublicArticleChatState({ limit: chatLimit }),
        llmTask: llmOperationState.active ? {
            running: Boolean(llmOperationState.active && !llmOperationState.active.cancelled),
            paused: llmOperationState.active?.paused === true,
            canPause: Boolean(llmOperationState.active && !llmOperationState.active.cancelled),
            cancelled: llmOperationState.active?.cancelled === true,
            operationId: llmOperationState.active?.operationId || '',
            phase: llmOperationState.active?.cancelled
                ? 'cancelled' : llmOperationState.active?.paused ? 'paused'
                    : 'analyzing'
        } : restoredWorkspaceLlmTask || {
            running: false, paused: false, canPause: false, cancelled: false,
            operationId: '', phase: 'idle'
        },
        figures: buildFigureWorkspaceSnapshot({ forceRefresh })
    };
}

function articleWorkspaceMetadata() {
    const canonicalUrl = document.querySelector('link[rel="canonical"]')?.href || location.href;
    const doi = document.querySelector(
        'meta[name="citation_doi"],meta[name="dc.identifier"],meta[name="DC.Identifier"]'
    )?.content || '';
    return { canonicalUrl, doi, title: document.title };
}

async function ensureCurrentArticleWorkspace({ forceRefresh = false } = {}) {
    if (articleWorkspaceSaveFrozen) throw new Error('WORKSPACE_WRITES_FROZEN');
    const workspaceLifecycle = articleWorkspaceLifecycleGeneration;
    const snapshot = getCanonicalArticleSnapshot({ forceRefresh });
    const metadata = articleWorkspaceMetadata();
    const content = snapshot.paragraphs.map(paragraph => String(paragraph?.text || '')).join('\n\n');
    const identity = await SciLLM.createArticleWorkspaceIdentity({ ...metadata, content });
    assertCurrentArticleWorkspaceLifecycle(workspaceLifecycle);
    identity.workspaceGeneration = Math.max(1, articleWorkspaceGenerationOverride);
    if (!forceRefresh && currentArticleWorkspace?.workspaceId === identity.workspaceId &&
        currentArticleWorkspace?.contentHash === identity.contentHash &&
        !currentArticleWorkspace?.deletionPending) {
        return currentArticleWorkspace;
    }
    if (articleWorkspaceEnsurePromise) return articleWorkspaceEnsurePromise;
    const ensurePromise = chrome.runtime.sendMessage({
        type: 'ARTICLE_WORKSPACE_ENSURE',
        workspace: identity
    }).then(response => {
        assertCurrentArticleWorkspaceLifecycle(workspaceLifecycle);
        if (!response?.success || !response.data?.workspace) {
            throw new Error(response?.error?.message || 'ARTICLE_WORKSPACE_ENSURE_FAILED');
        }
        currentArticleWorkspace = response.data.workspace;
        articleWorkspaceGenerationOverride = Math.max(
            articleWorkspaceGenerationOverride,
            Number(currentArticleWorkspace.workspaceGeneration) || 1
        );
        return currentArticleWorkspace;
    }).finally(() => {
        if (articleWorkspaceEnsurePromise === ensurePromise) {
            articleWorkspaceEnsurePromise = null;
        }
    });
    articleWorkspaceEnsurePromise = ensurePromise;
    return ensurePromise;
}

function articleWorkspaceAssetFingerprint(content) {
    try { return JSON.stringify(content); } catch (_) { return ''; }
}

function persistWorkspaceAssetCheckpoint(relativePath, content, { force = false } = {}) {
    if (articleWorkspaceSaveFrozen) return Promise.resolve({ saved: false, frozen: true });
    const workspaceLifecycle = articleWorkspaceLifecycleGeneration;
    const path = String(relativePath || '');
    const fingerprint = articleWorkspaceAssetFingerprint(content);
    if (!force && fingerprint && articleWorkspaceAssetFingerprints.get(path) === fingerprint) {
        return Promise.resolve({ saved: false, unchanged: true });
    }
    const mutation = articleWorkspaceMutationTail.then(async () => {
        if (workspaceLifecycle !== articleWorkspaceLifecycleGeneration) {
            return { saved: false, stale: true };
        }
        if (articleWorkspaceSaveFrozen) return { saved: false, frozen: true };
        if (!force && fingerprint && articleWorkspaceAssetFingerprints.get(path) === fingerprint) {
            return { saved: false, unchanged: true };
        }
        const workspace = await ensureCurrentArticleWorkspace();
        assertCurrentArticleWorkspaceLifecycle(workspaceLifecycle);
        const response = await chrome.runtime.sendMessage({
            type: 'ARTICLE_WORKSPACE_SAVE_ASSET',
            workspaceId: workspace.workspaceId,
            workspaceGeneration: Number(workspace.workspaceGeneration) || 1,
            relativePath: path,
            content
        });
        assertCurrentArticleWorkspaceLifecycle(workspaceLifecycle);
        if (!response?.success) {
            throw new Error(response?.error?.message || 'ARTICLE_WORKSPACE_SAVE_FAILED');
        }
        if (fingerprint) articleWorkspaceAssetFingerprints.set(path, fingerprint);
        return response.data;
    });
    articleWorkspaceMutationTail = mutation.catch(() => undefined);
    return mutation;
}

function persistWorkspaceTurnCheckpoint(turn, { append = false, force = false } = {}) {
    if (!turn?.turnId || articleWorkspaceSaveFrozen) {
        return Promise.resolve({ saved: false, frozen: articleWorkspaceSaveFrozen });
    }
    const workspaceLifecycle = articleWorkspaceLifecycleGeneration;
    const publicTurn = publicArticleChatTurn(turn);
    const turnPath = `chat/turns/${encodeURIComponent(publicTurn.turnId).slice(0, 240)}.json`;
    const fingerprint = articleWorkspaceAssetFingerprint(publicTurn);
    const mutation = articleWorkspaceMutationTail.then(async () => {
        if (workspaceLifecycle !== articleWorkspaceLifecycleGeneration) {
            return { saved: false, stale: true };
        }
        if (articleWorkspaceSaveFrozen) return { saved: false, frozen: true };
        if (!append && !force && fingerprint &&
            articleWorkspaceAssetFingerprints.get(turnPath) === fingerprint) {
            return { saved: false, unchanged: true };
        }
        const workspace = await ensureCurrentArticleWorkspace();
        assertCurrentArticleWorkspaceLifecycle(workspaceLifecycle);
        const response = await chrome.runtime.sendMessage({
            type: append ? 'ARTICLE_WORKSPACE_SAVE_TURN' : 'ARTICLE_WORKSPACE_UPDATE_TURN',
            workspaceId: workspace.workspaceId,
            workspaceGeneration: Number(workspace.workspaceGeneration) || 1,
            turnId: publicTurn.turnId,
            turn: publicTurn
        });
        assertCurrentArticleWorkspaceLifecycle(workspaceLifecycle);
        if (!response?.success && !append && response?.error?.code === 'TURN_NOT_FOUND') {
            const fallback = await chrome.runtime.sendMessage({
                type: 'ARTICLE_WORKSPACE_SAVE_TURN',
                workspaceId: workspace.workspaceId,
                workspaceGeneration: Number(workspace.workspaceGeneration) || 1,
                turn: publicTurn
            });
            assertCurrentArticleWorkspaceLifecycle(workspaceLifecycle);
            if (!fallback?.success) {
                throw new Error(fallback?.error?.message || 'ARTICLE_WORKSPACE_TURN_SAVE_FAILED');
            }
            return fallback.data;
        }
        if (!response?.success) {
            throw new Error(response?.error?.message || 'ARTICLE_WORKSPACE_TURN_SAVE_FAILED');
        }
        if (fingerprint) articleWorkspaceAssetFingerprints.set(turnPath, fingerprint);
        return response.data;
    });
    articleWorkspaceMutationTail = mutation.catch(() => undefined);
    return mutation;
}

function deleteWorkspaceTurnCheckpoint(turnId, options = {}) {
    if (articleWorkspaceSaveFrozen) {
        return Promise.resolve({ deleted: false, frozen: true });
    }
    const workspaceLifecycle = Number.isInteger(options.workspaceLifecycle)
        ? options.workspaceLifecycle : articleWorkspaceLifecycleGeneration;
    const normalizedTurnId = String(turnId || '').slice(0, 160);
    if (!normalizedTurnId) return Promise.resolve({ deleted: false, missing: true });
    const mutation = articleWorkspaceMutationTail.then(async () => {
        if (workspaceLifecycle !== articleWorkspaceLifecycleGeneration) {
            return { deleted: false, stale: true };
        }
        if (articleWorkspaceSaveFrozen) return { deleted: false, frozen: true };
        const workspace = await ensureCurrentArticleWorkspace();
        assertCurrentArticleWorkspaceLifecycle(workspaceLifecycle);
        const response = await chrome.runtime.sendMessage({
            type: 'ARTICLE_WORKSPACE_DELETE_TURN',
            workspaceId: workspace.workspaceId,
            workspaceGeneration: Number(workspace.workspaceGeneration) || 1,
            turnId: normalizedTurnId
        });
        assertCurrentArticleWorkspaceLifecycle(workspaceLifecycle);
        if (!response?.success) {
            throw new Error(response?.error?.message || 'ARTICLE_WORKSPACE_TURN_DELETE_FAILED');
        }
        articleWorkspaceAssetFingerprints.delete(
            `chat/turns/${encodeURIComponent(normalizedTurnId).slice(0, 240)}.json`
        );
        return response.data;
    });
    articleWorkspaceMutationTail = mutation.catch(() => undefined);
    return mutation;
}

async function persistArticleChatCheckpoint(turn, options = {}) {
    const turnResult = await persistWorkspaceTurnCheckpoint(turn, options);
    const indexResult = await persistWorkspaceAssetCheckpoint(
        'chat/index.json',
        getPublicArticleChatState(),
        { force: options.force === true }
    );
    return { turn: turnResult, index: indexResult };
}

async function deleteArticleChatCheckpoint(turnId, options = {}) {
    const turnResult = await deleteWorkspaceTurnCheckpoint(turnId, options);
    const indexResult = await persistWorkspaceAssetCheckpoint(
        'chat/index.json',
        getPublicArticleChatState(),
        { force: true }
    );
    return { turn: turnResult, index: indexResult };
}

function buildArticleWorkspaceAssets() {
    const snapshot = buildArticleWorkspaceSnapshot();
    const activeEngine = document.querySelector('.sci-llm-highlight')
        ? 'llm' : document.querySelector('.sci-highlight') ? 'regex' : '';
    const assets = new Map([
        ['article/structure.json', {
            title: snapshot.title,
            url: snapshot.url,
            publisherFamily: snapshot.publisherFamily,
            revision: snapshot.revision,
            diagnostics: snapshot.diagnostics,
            nodes: snapshot.nodes
        }],
        ['article/paragraphs.json', {
            revision: snapshot.revision,
            paragraphs: snapshot.paragraphs
        }],
        ['annotations/highlights.json', {
            activeEngine,
            lastRegexRequest: lastRegexHighlightRequest,
            annotations: currentManualDocument?.record?.annotations || [],
            highlightDistribution: snapshot.highlightDistribution
        }],
        ['analysis/full-analysis.json', {
            preparedStudy: lastPreparedStudy,
            llm: lastLlmAnalysis ? {
                rawAnalysis: lastLlmAnalysis.rawAnalysis,
                paragraphs: lastLlmAnalysis.paragraphs,
                extractionDiagnostics: lastLlmAnalysis.extractionDiagnostics,
                confidenceThreshold: lastLlmAnalysis.threshold ||
                    lastLlmDiagnostics?.confidenceThreshold || 0.8
            } : null,
            diagnostics: lastLlmDiagnostics,
            reviewOutline: lastReviewOutline,
            ledger: snapshot.ledger,
            paragraphSummaries: snapshot.paragraphSummaries,
            task: snapshot.llmTask
        }],
        ['chat/index.json', snapshot.chat],
        ['figures/inventory.json', snapshot.figures],
        ['ui/state.json', {
            navigator: {
                activeTab: articleNavigatorState.activeTab,
                depth: articleNavigatorState.depth,
                summariesVisible: articleNavigatorState.summariesVisible,
                expandedSectionIds: [...articleNavigatorState.expandedSectionIds],
                analysisSectionSelection: Object.fromEntries(
                    articleNavigatorState.analysisSectionSelection
                )
            },
            sidePanel: articleWorkspaceSidePanelUiState
        }]
    ]);
    return assets;
}

function buildArticleWorkspaceBaselineAssets() {
    const snapshot = buildArticleWorkspaceSnapshot();
    return new Map([
        ['article/structure.json', {
            title: snapshot.title,
            url: snapshot.url,
            publisherFamily: snapshot.publisherFamily,
            revision: snapshot.revision,
            diagnostics: snapshot.diagnostics,
            nodes: snapshot.nodes
        }],
        ['article/paragraphs.json', {
            revision: snapshot.revision,
            paragraphs: snapshot.paragraphs
        }]
    ]);
}

function captureArticleWorkspaceAssets() {
    const clone = value => {
        try {
            return typeof structuredClone === 'function'
                ? structuredClone(value) : JSON.parse(JSON.stringify(value));
        } catch (_) {
            return JSON.parse(JSON.stringify(value));
        }
    };
    return new Map(Array.from(buildArticleWorkspaceAssets(), ([path, content]) => [
        path, clone(content)
    ]));
}

async function persistArticleWorkspaceArtifacts({ force = false, assets = null } = {}) {
    if (articleWorkspaceSaveFrozen) return { saved: false, frozen: true };
    const checkpointAssets = assets instanceof Map ? assets : captureArticleWorkspaceAssets();
    await ensureCurrentArticleWorkspace();
    const results = [];
    for (const [path, content] of checkpointAssets) {
        results.push(await persistWorkspaceAssetCheckpoint(path, content, { force }));
    }
    return { saved: true, results };
}

async function persistArticleWorkspaceBaseline() {
    return persistArticleWorkspaceArtifacts({
        assets: buildArticleWorkspaceBaselineAssets()
    });
}

async function saveCurrentArticleWorkspaceNow() {
    const turnResults = [];
    for (const turn of articleChatState.turns) {
        turnResults.push(await persistWorkspaceTurnCheckpoint(turn, {
            append: false,
            force: true
        }));
    }
    const artifacts = await persistArticleWorkspaceArtifacts({ force: true });
    return {
        success: true,
        workspace: currentArticleWorkspace,
        assetCount: artifacts.results?.length || 0,
        turnCount: turnResults.length
    };
}

function scheduleArticleWorkspaceArtifactsSave({ immediate = false } = {}) {
    clearTimeout(articleWorkspaceSaveTimer);
    if (articleWorkspaceSaveFrozen) return;
    if (immediate) {
        const assets = captureArticleWorkspaceAssets();
        articleWorkspaceSaveTimer = null;
        void persistArticleWorkspaceArtifacts({ assets }).catch(() => undefined);
        return;
    }
    articleWorkspaceSaveTimer = setTimeout(() => {
        articleWorkspaceSaveTimer = null;
        void persistArticleWorkspaceArtifacts({ assets: captureArticleWorkspaceAssets() })
            .catch(() => undefined);
    }, 220);
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
    scheduleArticleWorkspaceArtifactsSave();
    articleArchiveSaveTimer = null;
}

function normalizeRestoredFigureWorkspace(input = null) {
    if (!input || typeof input !== 'object') return null;
    const status = input.status && typeof input.status === 'object' ? input.status : {};
    const figures = (Array.isArray(input.figures) ? input.figures : []).map(figure => ({
        ...figure,
        deepLoading: false,
        panelFollowupLoading: Object.fromEntries(Object.keys(
            figure?.panelFollowupLoading || {}
        ).map(key => [key, false])),
        panelAnalysisLoading: Object.fromEntries(Object.keys(
            figure?.panelAnalysisLoading || {}
        ).map(key => [key, false]))
    }));
    const figureWasRunning = status.running === true ||
        ['analyzing', 'retrying', 'paused', 'fallback'].includes(status.phase) ||
        (Array.isArray(input.figures) ? input.figures : []).some(figure =>
            figure?.deepLoading === true ||
            Object.values(figure?.panelFollowupLoading || {}).some(Boolean) ||
            Object.values(figure?.panelAnalysisLoading || {}).some(Boolean));
    return {
        ...input,
        figures,
        status: figureWasRunning ? {
            ...status,
            running: false,
            paused: false,
            canPause: false,
            operationId: '',
            phase: 'interrupted',
            message: '上次 Figure 任务已中断，请手动重新开始。',
            figureProgress: (Array.isArray(status.figureProgress)
                ? status.figureProgress : []).map(progress => ({
                ...progress, running: false, paused: false, operationId: '',
                phase: progress?.running ? 'interrupted' : progress?.phase
            }))
        } : status,
        crossFigureLogic: input.crossFigureLogic ? {
            ...input.crossFigureLogic,
            loading: false,
            error: input.crossFigureLogic.loading
                ? '上次组间逻辑任务已中断，请手动重新开始。'
                : String(input.crossFigureLogic.error || '')
        } : input.crossFigureLogic
    };
}

async function applyArticleArchiveSnapshot(input, { forceContentChanged = false } = {}) {
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
    const hashMatches = !forceContentChanged && (
        !archive.documentHash || !currentDocumentHash || archive.documentHash === currentDocumentHash
    );
    const workspace = archive.workspace || {};
    let regexHighlights = 0;
    let aiHighlights = 0;

    lastRegexHighlightRequest = workspace.lastRegexRequest || null;
    if (lastRegexHighlightRequest?.categories && workspace.activeEngine !== 'llm') {
        const counts = highlighter.applyHighlight(
            lastRegexHighlightRequest.categories,
            lastRegexHighlightRequest.mode || 'word',
            {
                allowedParagraphIds: selectedArticleAnalysisParagraphIds(),
                analysisModeId: lastRegexHighlightRequest.analysisModeId
            }
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
    restoredFigureWorkspaceSnapshot = normalizeRestoredFigureWorkspace(
        workspace.figureWorkspace || (
        Array.isArray(workspace.figures)
            ? { figures: workspace.figures, totalFigures: workspace.figures.length }
            : null
        )
    );
    if (restoredFigureWorkspaceSnapshot?.status?.phase === 'interrupted') {
        figureAnalysisStatus = {
            ...figureAnalysisStatus,
            ...restoredFigureWorkspaceSnapshot.status
        };
    }
    const archivedTask = workspace.navigation?.llmTask;
    restoredWorkspaceLlmTask = archivedTask?.running === true ||
        ['analyzing', 'paused', 'retrying'].includes(archivedTask?.phase)
        ? {
            ...archivedTask, running: false, paused: false, canPause: false,
            operationId: '', phase: 'interrupted',
            message: '上次全文分析已中断，请手动重新开始。'
        } : null;
    const restoredChat = workspace.chat;
    if (restoredChat && Array.isArray(restoredChat.turns)) {
        articleChatState = {
            turns: restoredChat.turns.map(publicArticleChatTurn).map(turn => ({
                ...turn,
                status: turn.status === 'generating' ? 'interrupted'
                    : turn.status === 'queued' ? 'interrupted' : turn.status,
                operationId: '',
                error: turn.status === 'generating' || turn.status === 'queued'
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

async function applyArticleWorkspaceAssets(input = {}) {
    const match = String(input.match || 'exact');
    const assets = Array.isArray(input.assets) ? input.assets : [];
    const byPath = new Map(assets.map(asset => [
        String(asset?.relativePath || asset?.path || ''),
        asset?.content === undefined ? asset?.data : asset.content
    ]).filter(([path]) => path));
    let archiveResult = null;
    if (byPath.has('legacy/archive.json')) {
        archiveResult = await applyArticleArchiveSnapshot(byPath.get('legacy/archive.json'), {
            forceContentChanged: match === 'content-changed'
        });
    }

    const savedAnalysis = byPath.get('analysis/full-analysis.json');
    if (!archiveResult && savedAnalysis && typeof savedAnalysis === 'object') {
        lastPreparedStudy = savedAnalysis.preparedStudy || null;
        const savedLlm = savedAnalysis.llm;
        if (savedLlm?.rawAnalysis && Array.isArray(savedLlm.paragraphs)) {
            lastLlmAnalysis = {
                rawAnalysis: savedLlm.rawAnalysis,
                paragraphs: savedLlm.paragraphs,
                extractionDiagnostics: savedLlm.extractionDiagnostics || null,
                threshold: Number(savedLlm.confidenceThreshold) || 0.8
            };
        }
        lastLlmDiagnostics = {
            ...(savedAnalysis.diagnostics || {}),
            ...(match === 'content-changed' ? { restoredWithoutRanges: true } : {})
        };
        lastReviewOutline = savedAnalysis.reviewOutline || null;
        standaloneReviewParagraphSummaries.clear();
        (Array.isArray(savedAnalysis.paragraphSummaries)
            ? savedAnalysis.paragraphSummaries : []).forEach(item => {
            const paragraphId = String(item?.paragraphId || '').trim();
            if (paragraphId) standaloneReviewParagraphSummaries.set(paragraphId, item);
        });
        const savedTask = savedAnalysis.task;
        restoredWorkspaceLlmTask = savedTask?.running === true ||
            ['analyzing', 'paused', 'retrying'].includes(savedTask?.phase)
            ? {
                ...savedTask,
                running: false,
                paused: false,
                canPause: false,
                operationId: '',
                phase: 'interrupted',
                message: '上次全文分析在浏览器关闭或页面离开时中断，请手动重新开始。'
            } : null;
    }

    const savedFigures = byPath.get('figures/inventory.json');
    if (!archiveResult && savedFigures && typeof savedFigures === 'object') {
        restoredFigureWorkspaceSnapshot = normalizeRestoredFigureWorkspace(savedFigures);
        if (restoredFigureWorkspaceSnapshot?.status?.phase === 'interrupted') {
            figureAnalysisStatus = {
            ...figureAnalysisStatus,
            ...restoredFigureWorkspaceSnapshot.status
            };
        }
        const restoredLogic = savedFigures.crossFigureLogic;
        if (restoredLogic?.result) {
            crossFigureLogicState = {
                result: restoredLogic.result, loading: false,
                error: String(restoredLogic.error || '')
            };
        }
    }

    const savedChat = byPath.get('chat/index.json') ||
        (archiveResult ? getPublicArticleChatState() : null);
    const restoredTurnsById = new Map();
    (Array.isArray(savedChat?.turns) ? savedChat.turns : []).forEach(turn => {
        const turnId = String(turn?.turnId || '');
        if (turnId) restoredTurnsById.set(turnId, turn);
    });
    (Array.isArray(input.turns) ? input.turns : []).forEach(turn => {
        const turnId = String(turn?.turnId || '');
        if (turnId) restoredTurnsById.set(turnId, turn);
    });
    const restoredTurns = [...restoredTurnsById.values()].sort((left, right) =>
        Number(left.sequence || 0) - Number(right.sequence || 0) ||
        Number(left.createdAt || 0) - Number(right.createdAt || 0) ||
        String(left.turnId || '').localeCompare(String(right.turnId || ''))
    );
    if (savedChat || restoredTurns.length) {
        articleChatState = {
            turns: restoredTurns.map(publicArticleChatTurn).map(turn => ({
                ...turn,
                status: turn.status === 'generating' ? 'interrupted'
                    : turn.status === 'queued' ? 'interrupted' : turn.status,
                operationId: '',
                error: turn.status === 'generating' || turn.status === 'queued'
                    ? '浏览器关闭或页面离开时任务已中断；已完成的回答块已保留，可手动重新生成。'
                    : turn.error
            })).filter(turn => turn.turnId && turn.question),
            loading: false,
            error: '',
            operationId: '',
            activeTurnId: '',
            coverage: savedChat?.coverage || null,
            memoryNeedsRebuild: savedChat?.memoryNeedsRebuild === true
        };
    }

    const savedUi = byPath.get('ui/state.json');
    if (savedUi?.navigator) {
        articleNavigatorState.activeTab = ['outline', 'figures'].includes(savedUi.navigator.activeTab)
            ? savedUi.navigator.activeTab : articleNavigatorState.activeTab;
        articleNavigatorState.depth = savedUi.navigator.depth === 'all' ? 'all' : 'major';
        articleNavigatorState.summariesVisible = savedUi.navigator.summariesVisible === true;
        articleNavigatorState.expandedSectionIds = new Set(
            Array.isArray(savedUi.navigator.expandedSectionIds)
                ? savedUi.navigator.expandedSectionIds.map(String) : []
        );
        articleNavigatorState.analysisSectionSelection = new Map(
            Object.entries(
                savedUi.navigator.analysisSectionSelection &&
                typeof savedUi.navigator.analysisSectionSelection === 'object'
                    ? savedUi.navigator.analysisSectionSelection : {}
            ).map(([sectionId, selected]) => [String(sectionId), selected === true])
        );
    }
    articleWorkspaceSidePanelUiState = savedUi?.sidePanel || null;

    if (match === 'content-changed') {
        lastLlmDiagnostics = { ...(lastLlmDiagnostics || {}), restoredWithoutRanges: true };
        articleWorkspaceAssetFingerprints.clear();
    } else {
        assets.forEach(asset => {
            const path = String(asset?.relativePath || asset?.path || '');
            const content = asset?.content === undefined ? asset?.data : asset.content;
            if (path) articleWorkspaceAssetFingerprints.set(
                path, articleWorkspaceAssetFingerprint(content)
            );
        });
        if (input.manifest?.workspaceId) {
            currentArticleWorkspace = { ...input.manifest };
            articleWorkspaceGenerationOverride = Math.max(
                articleWorkspaceGenerationOverride,
                Number(input.manifest.workspaceGeneration) || 1
            );
        }
    }
    articleChatState.loading = false;
    articleChatState.operationId = '';
    articleChatState.activeTurnId = '';
    // Rewrite the aggregate index only after turn-file recovery has completed.
    // This makes the self-healed history durable for the next browser start.
    scheduleArticleWorkspaceArtifactsSave({ immediate: true });
    notifyArticleChatStateChanged('workspace_restored');
    return {
        success: true,
        match,
        partial: match === 'content-changed' || archiveResult?.partial === true,
        restoredWithoutRanges: match === 'content-changed',
        assetCount: assets.length,
        chatTurns: articleChatState.turns.length,
        uiState: articleWorkspaceSidePanelUiState
    };
}

async function resetArticleWorkspaceState({ workspaceGeneration = 1 } = {}) {
    articleWorkspaceSaveFrozen = true;
    invalidateArticleWorkspaceLifecycle();
    clearTimeout(articleArchiveSaveTimer);
    clearTimeout(articleWorkspaceSaveTimer);
    articleArchiveSaveTimer = null;
    articleWorkspaceSaveTimer = null;
    clearAutomaticHighlights();
    lastRegexHighlightRequest = null;
    lastLlmAnalysis = null;
    llmProgressiveAnalysis = null;
    lastLlmDiagnostics = null;
    lastReviewOutline = null;
    articleNavigatorState.analysisSectionSelection.clear();
    standaloneReviewParagraphSummaries.clear();
    articleSectionOutlines.clear();
    reviewOutlineStatus = createInitialReviewOutlineStatus();
    restoredWorkspaceLlmTask = null;
    restoredFigureWorkspaceSnapshot = null;
    lastFigureAnalysis = null;
    figureWalkthroughState.clear();
    figureProgressById.clear();
    figureAnalysisStatus = createInitialFigureAnalysisStatus();
    crossFigureLogicState = { result: null, loading: false, error: '' };
    articleChatState = {
        turns: [], loading: false, error: '', operationId: '', activeTurnId: '',
        coverage: null, memoryNeedsRebuild: true
    };
    currentArticleWorkspace = null;
    articleWorkspaceEnsurePromise = null;
    articleWorkspaceAssetFingerprints.clear();
    articleWorkspaceSidePanelUiState = null;
    articleWorkspaceGenerationOverride = Math.max(1, Number(workspaceGeneration) || 1);
    articleWorkspaceSaveFrozen = false;
    const workspace = await ensureCurrentArticleWorkspace({ forceRefresh: true });
    await persistArticleWorkspaceArtifacts({ force: true });
    notifyArticleChatStateChanged('workspace_cleared');
    notifyFigureWorkspaceStateChanged('workspace_cleared');
    return { success: true, workspace };
}

function prepareExternalArticleWorkspaceDeletion(workspaceId) {
    const normalizedWorkspaceId = String(workspaceId || '');
    if (!normalizedWorkspaceId || (
        currentArticleWorkspace?.workspaceId !== normalizedWorkspaceId &&
        pendingExternalWorkspaceDeletionId !== normalizedWorkspaceId
    )) {
        return { success: true, matched: false };
    }
    if (pendingExternalWorkspaceDeletionId !== normalizedWorkspaceId) {
        pendingExternalWorkspaceDeletionId = normalizedWorkspaceId;
        articleWorkspaceSaveFrozen = true;
        clearTimeout(articleWorkspaceSaveTimer);
        clearTimeout(articleArchiveSaveTimer);
        articleWorkspaceSaveTimer = null;
        articleArchiveSaveTimer = null;
        invalidateArticleWorkspaceLifecycle();
    }
    return { success: true, matched: true, frozen: true };
}

async function finalizeExternalArticleWorkspaceDeletion(workspaceId, workspaceGeneration) {
    const normalizedWorkspaceId = String(workspaceId || '');
    if (!normalizedWorkspaceId || (
        currentArticleWorkspace?.workspaceId !== normalizedWorkspaceId &&
        pendingExternalWorkspaceDeletionId !== normalizedWorkspaceId
    )) {
        return { success: true, matched: false };
    }
    const reset = await resetArticleWorkspaceState({ workspaceGeneration });
    pendingExternalWorkspaceDeletionId = '';
    return { ...reset, matched: true };
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
    const quote = String(
        evidence.quote || evidence.support || verification.target?.quoteSpan?.text || ''
    ).trim();
    const focusedGranularity = paragraph && quote &&
        focusArticleSourceQuote(paragraph.anchor, quote)
        ? 'sentence'
        : paragraph && focusArticleSource(paragraph.anchor) ? 'paragraph' : '';
    if (!paragraph || !focusedGranularity) {
        return {
            ...verification,
            status: 'missing',
            reason: 'SOURCE_ANCHOR_MISSING',
            target: null,
            focused: false,
            revisionChanged
        };
    }
    return {
        ...verification,
        focused: true,
        focusedGranularity,
        revisionChanged
    };
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
    const workspaceLifecycle = articleWorkspaceLifecycleGeneration;
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
            const scopeSelectionProvided = options.scopeSelectionProvided === true;
            const paragraphs = requestedParagraphIds.size
                ? allParagraphs.filter(paragraph =>
                    requestedParagraphIds.has(String(paragraph.paragraphId || '')))
                : scopeSelectionProvided
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
                workspaceLifecycle,
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
            assertCurrentArticleWorkspaceLifecycle(workspaceLifecycle);
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
            scheduleArticleWorkspaceArtifactsSave({ immediate: true });
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
            if (workspaceLifecycle !== articleWorkspaceLifecycleGeneration) throw error;
            updateReviewOutlineStatus({
                running: false, phase: 'failed', message: error.message || '综述大纲生成失败'
            });
            showLlmPageStatus('综述大纲生成失败：' + error.message, 'error');
            scheduleArticleWorkspaceArtifactsSave({ immediate: true });
            throw error;
        }
    })();
    try {
        return await reviewOutlinePromise;
    } finally {
        if (workspaceLifecycle === articleWorkspaceLifecycleGeneration) {
            reviewOutlinePromise = null;
        }
    }
}

function decodeExportDataUrl(dataUrl) {
    const match = String(dataUrl || '').match(
        /^data:([^;,]+)?((?:;[^,]*)*?),(.*)$/s
    );
    if (!match) throw new Error('INVALID_EXPORT_DATA_URL');
    const contentType = String(match[1] || 'application/octet-stream').toLowerCase();
    const metadata = String(match[2] || '');
    const payload = String(match[3] || '');
    if (/;base64/i.test(metadata)) {
        const binary = atob(payload.replace(/\s+/g, ''));
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) {
            bytes[index] = binary.charCodeAt(index);
        }
        return { bytes, contentType };
    }
    return {
        bytes: new TextEncoder().encode(decodeURIComponent(payload)),
        contentType
    };
}

function exportImageExtension(contentType, sourceUrl = '') {
    const normalized = String(contentType || '').toLowerCase().split(';', 1)[0];
    const byType = {
        'image/avif': 'avif',
        'image/jpeg': 'jpg',
        'image/jpg': 'jpg',
        'image/png': 'png',
        'image/webp': 'webp',
        'image/gif': 'gif',
        'image/tiff': 'tiff',
        'image/bmp': 'bmp',
        'image/svg+xml': 'svg'
    };
    if (byType[normalized]) return byType[normalized];
    try {
        const extension = new URL(sourceUrl, document.baseURI).pathname
            .match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase();
        if (['avif', 'jpg', 'jpeg', 'png', 'webp', 'gif', 'tif', 'tiff', 'bmp', 'svg']
            .includes(extension)) {
            return extension === 'jpeg' ? 'jpg' : extension === 'tif' ? 'tiff' : extension;
        }
    } catch (_) {}
    return 'img';
}

function publicExportSourceUrl(value) {
    const source = String(value || '').trim();
    if (!source || /^data:/i.test(source)) return source ? 'embedded-data-url' : '';
    if (/^blob:/i.test(source)) return 'temporary-blob-url';
    try {
        const url = new URL(source, document.baseURI);
        url.username = '';
        url.password = '';
        url.search = '';
        url.hash = '';
        return url.href;
    } catch (_) {
        return '';
    }
}

async function fetchExportImageDirect(sourceUrl) {
    const response = await fetch(sourceUrl, {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
        redirect: 'follow'
    });
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    const contentType = String(response.headers.get('content-type') || '')
        .split(';', 1)[0].trim().toLowerCase();
    if (!/^image\//.test(contentType)) throw new Error('EXPORT_IMAGE_NOT_IMAGE');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length || bytes.length > 40 * 1024 * 1024) {
        throw new Error('EXPORT_IMAGE_EMPTY_OR_TOO_LARGE');
    }
    return {
        bytes,
        contentType,
        sourceUrl: response.url || sourceUrl
    };
}

async function fetchExportImageSource(sourceUrl, options = {}) {
    const source = String(sourceUrl || '').trim();
    if (!source) throw new Error('EXPORT_IMAGE_SOURCE_MISSING');
    const cacheMode = options.cacheMode ||
        (options.useFigureCache === false ? 'none' : await figureImageCacheMode());
    if (/^data:image\//i.test(source)) {
        const decoded = decodeExportDataUrl(source);
        return {
            ...decoded,
            sourceUrl: 'embedded-data-url',
            cacheHit: false
        };
    }
    if (/^blob:/i.test(source)) return fetchExportImageDirect(source);

    let parsed;
    try {
        parsed = new URL(source, document.baseURI);
    } catch (_) {
        throw new Error('EXPORT_INVALID_IMAGE_URL');
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error('EXPORT_INVALID_IMAGE_URL');
    }

    let backgroundError = null;
    try {
        const response = await chrome.runtime.sendMessage({
            type: 'EXPORT_FETCH_IMAGE_RESOURCE',
            url: parsed.href,
            documentUrl: location.href,
            cacheMode
        });
        if (response?.success && response.data?.dataUrl) {
            const decoded = decodeExportDataUrl(response.data.dataUrl);
            return {
                ...decoded,
                contentType: response.data.contentType || decoded.contentType,
                sourceUrl: response.data.sourceUrl || parsed.href,
                cacheHit: response.data.cacheHit === true
            };
        }
        backgroundError = new Error(
            response?.error?.message || response?.error?.code || 'EXPORT_IMAGE_FETCH_FAILED'
        );
    } catch (error) {
        backgroundError = error;
    }

    try {
        return await fetchExportImageDirect(parsed.href);
    } catch (directError) {
        const error = new Error(
            `无法下载高清图：${backgroundError?.message || directError.message}`
        );
        error.code = 'EXPORT_IMAGE_FETCH_FAILED';
        error.cause = directError;
        throw error;
    }
}

async function measureExportImageResource(resource) {
    const bytes = resource?.bytes instanceof Uint8Array
        ? resource.bytes : new Uint8Array(resource?.bytes || []);
    if (!bytes.length) return { ...resource, pixelWidth: 0, pixelHeight: 0 };
    const blob = new Blob([bytes], {
        type: String(resource?.contentType || 'application/octet-stream')
    });
    let width = 0;
    let height = 0;
    if (typeof createImageBitmap === 'function') {
        let bitmap = null;
        try {
            bitmap = await createImageBitmap(blob);
            width = Math.max(0, Math.round(Number(bitmap?.width) || 0));
            height = Math.max(0, Math.round(Number(bitmap?.height) || 0));
        } catch (_) {
            // Some browsers cannot decode SVG or older image formats with
            // createImageBitmap. The object-URL path below covers those cases.
        } finally {
            bitmap?.close?.();
        }
    }
    if (!width || !height) {
        const objectUrl = URL.createObjectURL(blob);
        try {
            const image = await loadFigureImage(objectUrl, 10000);
            width = Math.max(0, Math.round(Number(
                image?.naturalWidth || image?.width
            ) || 0));
            height = Math.max(0, Math.round(Number(
                image?.naturalHeight || image?.height
            ) || 0));
        } catch (_) {
            // Retain the resource. If no candidate exposes decodable dimensions,
            // selection falls back to byte size and publisher candidate order.
        } finally {
            URL.revokeObjectURL(objectUrl);
        }
    }
    return {
        ...resource,
        pixelWidth: width,
        pixelHeight: height
    };
}

function compareExportImageQuality(left, right) {
    const leftArea = Math.max(0, Number(left?.pixelWidth) || 0) *
        Math.max(0, Number(left?.pixelHeight) || 0);
    const rightArea = Math.max(0, Number(right?.pixelWidth) || 0) *
        Math.max(0, Number(right?.pixelHeight) || 0);
    if (rightArea !== leftArea) return rightArea - leftArea;
    const byteDifference = (Number(right?.bytes?.length) || 0) -
        (Number(left?.bytes?.length) || 0);
    if (byteDifference) return byteDifference;
    return (Number(left?.candidateIndex) || 0) -
        (Number(right?.candidateIndex) || 0);
}

async function collectExportFigureImages(figure, figureIndex) {
    const imageElements = Array.from(figure?.imageElements || []).slice(0, 40);
    const resources = [];
    const claimedSources = new Set();
    const fetchedCandidates = new Map();
    for (const [imageIndex, imageElement] of imageElements.entries()) {
        const candidates = await resolveFigureImageSources({
            ...figure,
            imageElements: [imageElement]
        });
        const measuredCandidates = [];
        for (const [candidateIndex, candidate] of candidates.slice(0, 12).entries()) {
            if (!candidate || claimedSources.has(candidate)) continue;
            try {
                if (!fetchedCandidates.has(candidate)) {
                    fetchedCandidates.set(candidate, (async () =>
                        measureExportImageResource(
                            await fetchExportImageSource(candidate)
                        ))());
                }
                const measured = await fetchedCandidates.get(candidate);
                measuredCandidates.push({
                    ...measured,
                    requestedSourceUrl: candidate,
                    candidateIndex
                });
            } catch (_) {
                // Full-size links can point to an HTML viewer. Continue to the
                // next candidate until an actual image is returned.
            }
        }
        measuredCandidates.sort(compareExportImageQuality);
        const resource = measuredCandidates.find(candidate =>
            !claimedSources.has(candidate.requestedSourceUrl) &&
            !claimedSources.has(candidate.sourceUrl)
        ) || null;
        if (!resource) continue;
        claimedSources.add(resource.requestedSourceUrl);
        claimedSources.add(resource.sourceUrl);
        const extension = exportImageExtension(resource.contentType, resource.sourceUrl);
        const folder = `figures/Figure_${String(figureIndex + 1).padStart(2, '0')}`;
        const path = `${folder}/image_${String(resources.length + 1).padStart(2, '0')}.${extension}`;
        resources.push({
            path,
            data: resource.bytes,
            contentType: resource.contentType,
            byteLength: resource.bytes.length,
            sourceUrl: resource.sourceUrl,
            requestedSourceUrl: resource.requestedSourceUrl,
            pixelWidth: resource.pixelWidth,
            pixelHeight: resource.pixelHeight,
            candidateCount: measuredCandidates.length,
            qualitySelection: 'largest-pixel-area',
            displayedWidth: Number(imageElement?.naturalWidth || imageElement?.width) || 0,
            displayedHeight: Number(imageElement?.naturalHeight || imageElement?.height) || 0,
            imageElementIndex: imageIndex
        });
    }
    return resources;
}

function exportFigureRecord(figure, snapshotFigure = {}) {
    return {
        figureId: String(figure?.figureId || snapshotFigure?.figureId || ''),
        figureLabel: String(figure?.figureLabel || snapshotFigure?.figureLabel || ''),
        caption: String(figure?.caption || snapshotFigure?.caption || ''),
        isSupplemental: figure?.isSupplemental === true ||
            snapshotFigure?.isSupplemental === true,
        panelHints: Array.isArray(figure?.panelHints)
            ? [...figure.panelHints]
            : [...(snapshotFigure?.panelHints || [])],
        contextParagraphs: (Array.isArray(figure?.contextParagraphs)
            ? figure.contextParagraphs : []).map(item => ({ ...item })),
        activeDepth: snapshotFigure?.activeDepth || 'deep',
        standard: snapshotFigure?.standard || null,
        standardError: String(snapshotFigure?.standardError || ''),
        deep: snapshotFigure?.deep || null,
        deepError: String(snapshotFigure?.deepError || ''),
        panelAnalyses: snapshotFigure?.panelAnalyses || {},
        panelAnalysisErrors: snapshotFigure?.panelAnalysisErrors || {},
        panelFollowups: snapshotFigure?.panelFollowups || {},
        panelFollowupHistories: snapshotFigure?.panelFollowupHistories || {},
        panelFollowupErrors: snapshotFigure?.panelFollowupErrors || {},
        imageFiles: [],
        images: []
    };
}

function collectCompleteExportFigures() {
    const inventory = getFigureWorkspaceInventory({ forceRefresh: true });
    const workspace = buildFigureWorkspaceSnapshot();
    const snapshotById = new Map(
        (workspace.figures || []).map(figure => [String(figure.figureId || ''), figure])
    );
    const records = inventory.map(figure =>
        exportFigureRecord(figure, snapshotById.get(String(figure.figureId || '')) || {})
    );
    const existingIds = new Set(records.map(figure => figure.figureId));
    (workspace.figures || []).forEach(figure => {
        if (!existingIds.has(String(figure.figureId || ''))) {
            records.push(exportFigureRecord(null, figure));
        }
    });
    return {
        records,
        inventoryById: new Map(inventory.map(figure => [String(figure.figureId || ''), figure])),
        crossFigureLogic: workspace.crossFigureLogic?.result || null,
        figureStatus: workspace.status || null
    };
}

function buildExportChatMarkdown(chat = {}) {
    const lines = ['# 文献全文问答', ''];
    (Array.isArray(chat.turns) ? chat.turns : []).forEach((turn, index) => {
        lines.push(`## 问答 ${index + 1}`, '', `**问题：** ${turn.question || ''}`, '');
        const blocks = Array.isArray(turn.answerBlocks) ? turn.answerBlocks : [];
        if (blocks.length) {
            blocks.forEach(block => lines.push(String(block.markdown || ''), ''));
        } else {
            lines.push(String(turn.summary || '无回答'), '');
        }
    });
    if (!(chat.turns || []).length) lines.push('暂无全文问答。', '');
    return lines.join('\n');
}

function buildPptBundleReadme(bundle) {
    return [
        '# Brevess：PPT 制作材料包',
        '',
        `论文：${bundle.title || ''}`,
        `原文：${bundle.url || ''}`,
        `导出时间：${bundle.exportedAt}`,
        '',
        '## 内容',
        '',
        '- `figures/`：逐 Figure 保存的最高质量原图；每个图片文件都在 manifest 中记录来源。',
        '- `analysis/figures/`：每张 Figure 的整图、Panel、Panel 追问及相关正文证据。',
        '- `analysis/cross-figure-logic.*`：主图多米诺跨图逻辑。',
        '- `analysis/fulltext-question-answer.*`：完整全文问答历史。',
        '- `analysis/manual-annotations.json`：手动高亮与注释。',
        '- `PROMPT_FOR_CODEX_OR_AGENT.md`：交给本地 Codex 或其他 Agent 的制图任务。',
        '',
        '请先核对 `manifest.json` 中的 `missingImageFigureIds`。缺图时不要凭空重建，',
        '应回到论文页面下载原图后再制作 PPT。',
        ''
    ].join('\n');
}

async function exportPptMaterialBundle() {
    if (typeof SciLLM.createZipBlob !== 'function' ||
        typeof SciLLM.buildPptAgentPrompt !== 'function') {
        throw new Error('EXPORT_BUNDLE_MODULE_UNAVAILABLE');
    }
    const article = buildArticleWorkspaceSnapshot({ forceRefresh: true, chatLimit: 0 });
    const collected = collectCompleteExportFigures();
    const entries = [];
    const missingImageFigureIds = [];
    let imageCount = 0;

    for (const [index, record] of collected.records.entries()) {
        const sourceFigure = collected.inventoryById.get(record.figureId);
        const images = sourceFigure
            ? await collectExportFigureImages(sourceFigure, index) : [];
        if (!images.length) missingImageFigureIds.push(record.figureId || record.figureLabel);
        images.forEach(image => {
            entries.push({ path: image.path, data: image.data });
            record.imageFiles.push(image.path);
            record.images.push({
                path: image.path,
                contentType: image.contentType,
                byteLength: image.byteLength,
                sourceUrl: publicExportSourceUrl(image.sourceUrl),
                requestedSourceUrl: publicExportSourceUrl(image.requestedSourceUrl),
                pixelWidth: image.pixelWidth,
                pixelHeight: image.pixelHeight,
                candidateCount: image.candidateCount,
                qualitySelection: image.qualitySelection,
                displayedWidth: image.displayedWidth,
                displayedHeight: image.displayedHeight
            });
            imageCount += 1;
        });
        const figureStem = `Figure_${String(index + 1).padStart(2, '0')}`;
        entries.push({
            path: `analysis/figures/${figureStem}.json`,
            data: SciLLM.exportJson(record)
        });
        entries.push({
            path: `analysis/figures/${figureStem}.md`,
            data: SciLLM.buildFigureMarkdown(record)
        });
    }

    const exportedAt = new Date().toISOString();
    const annotations = currentManualDocument?.record?.annotations || [];
    const bundle = {
        schemaVersion: 1,
        exportKind: 'sci-reader-ppt-materials',
        extensionVersion: chrome.runtime.getManifest?.().version || '',
        exportedAt,
        title: article.title,
        url: article.url,
        publisherFamily: article.publisherFamily,
        figures: collected.records,
        crossFigureLogic: collected.crossFigureLogic,
        chat: article.chat,
        manualAnnotations: annotations,
        missingImageFigureIds
    };
    entries.push(
        { path: 'manifest.json', data: SciLLM.exportJson(bundle) },
        {
            path: 'analysis/cross-figure-logic.json',
            data: SciLLM.exportJson(collected.crossFigureLogic || {})
        },
        {
            path: 'analysis/cross-figure-logic.md',
            data: `# 主图多米诺跨图逻辑\n\n\`\`\`json\n${
                JSON.stringify(SciLLM.cloneExportValue(collected.crossFigureLogic || {}), null, 2)
            }\n\`\`\`\n`
        },
        {
            path: 'analysis/fulltext-question-answer.json',
            data: SciLLM.exportJson(article.chat)
        },
        {
            path: 'analysis/fulltext-question-answer.md',
            data: buildExportChatMarkdown(article.chat)
        },
        {
            path: 'analysis/manual-annotations.json',
            data: SciLLM.exportJson(annotations)
        },
        {
            path: 'analysis/article-context.json',
            data: SciLLM.exportJson({
                title: article.title,
                url: article.url,
                publisherFamily: article.publisherFamily,
                paragraphs: article.paragraphs,
                reviewOutline: article.reviewOutline,
                paragraphSummaries: article.paragraphSummaries,
                ledger: article.ledger,
                studyProfile: article.studyProfile
            })
        },
        { path: 'PROMPT_FOR_CODEX_OR_AGENT.md', data: SciLLM.buildPptAgentPrompt(bundle) },
        { path: 'README.md', data: buildPptBundleReadme(bundle) }
    );
    const blob = await SciLLM.createZipBlob(entries);
    const filename = `${SciLLM.sanitizeExportFilename(
        article.title, 'SCI-article'
    )}-PPT-materials.zip`;
    downloadContentExportBlob(blob, filename);
    return {
        success: true,
        filename,
        figureCount: collected.records.length,
        imageCount,
        missingImageFigureIds,
        byteLength: blob.size
    };
}

function downloadContentExportBlob(blob, filename) {
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = filename;
    link.hidden = true;
    (document.body || document.documentElement).appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);
}

function absoluteSnapshotUrl(value) {
    const source = String(value || '').trim();
    if (!source || /^(?:data:|blob:|mailto:|tel:|#)/i.test(source)) return source;
    try {
        const url = new URL(source, document.baseURI);
        return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch (_) {
        return '';
    }
}

function encodeSnapshotImageDataUrl(bytes, contentType) {
    const value = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    const chunks = [];
    const chunkSize = 0x8000;
    for (let offset = 0; offset < value.length; offset += chunkSize) {
        chunks.push(String.fromCharCode(...value.subarray(offset, offset + chunkSize)));
    }
    return `data:${String(contentType || 'application/octet-stream')};base64,${
        btoa(chunks.join(''))
    }`;
}

function snapshotArticleRootScore(element) {
    if (!element?.querySelectorAll) return -1;
    const textLength = String(element.innerText || element.textContent || '')
        .replace(/\s+/g, ' ').trim().length;
    const paragraphCount = element.querySelectorAll(
        'p,[role="paragraph"],.Paragraph,.paragraph'
    ).length;
    const headingCount = element.querySelectorAll('h2,h3,h4,[role="heading"]').length;
    const figureCount = element.querySelectorAll(
        'figure,[role="figure"],.figure,.fig'
    ).length;
    const navigationCount = element.querySelectorAll(
        'nav,aside,[class*="sidebar" i],[class*="recommend" i],[class*="advert" i]'
    ).length;
    return Math.min(textLength, 400000) +
        Math.min(paragraphCount, 2000) * 300 +
        Math.min(headingCount, 300) * 180 +
        Math.min(figureCount, 200) * 700 -
        Math.min(navigationCount, 100) * 1000;
}

function resolveZoteroSnapshotArticleRoot() {
    const adapter = typeof SciLLM.selectPublisherAdapter === 'function'
        ? SciLLM.selectPublisherAdapter(globalThis.location)
        : null;
    const selectBest = selectors => {
        const candidates = [];
        const seen = new Set();
        (selectors || []).slice(0, 50).forEach(selector => {
            try {
                document.querySelectorAll(selector).forEach(element => {
                    if (!seen.has(element)) {
                        seen.add(element);
                        candidates.push(element);
                    }
                });
            } catch (_) {}
        });
        return candidates.reduce((best, candidate) =>
            !best || snapshotArticleRootScore(candidate) > snapshotArticleRootScore(best)
                ? candidate : best, null);
    };
    const specific = selectBest(adapter?.specificArticleRootSelectors || []);
    if (specific && snapshotArticleRootScore(specific) >= 1200) return specific;
    const general = selectBest([
        ...(adapter?.articleRootSelectors || []),
        'article', 'main article', 'main', '[role="main"]',
        '#article-body', '.article-body', '.article__body'
    ]);
    return general || document.querySelector('article,main,[role="main"]') || document.body;
}

function appendSnapshotAnnotationAppendix(targetBody, annotations) {
    if (!annotations.length) return;
    const outputDocument = targetBody.ownerDocument;
    const section = outputDocument.createElement('section');
    section.id = 'sci-reader-snapshot-annotations';
    const heading = outputDocument.createElement('h2');
    heading.textContent = `SCI 阅读助手：手动高亮与注释（${annotations.length}）`;
    section.appendChild(heading);
    const list = outputDocument.createElement('ol');
    annotations.forEach(annotation => {
        const item = outputDocument.createElement('li');
        const category = outputDocument.createElement('strong');
        category.textContent = annotation.categorySnapshot?.name ||
            annotation.categoryId || '手动标注';
        item.appendChild(category);
        const quote = outputDocument.createElement('blockquote');
        quote.textContent = String(annotation.quote || '');
        item.appendChild(quote);
        if (String(annotation.note || '').trim()) {
            const note = outputDocument.createElement('p');
            note.textContent = `注释：${annotation.note}`;
            item.appendChild(note);
        }
        list.appendChild(item);
    });
    section.appendChild(list);
    targetBody.appendChild(section);
}

function cleanZoteroSnapshotArticleRoot(
    liveRoot,
    clonedRoot,
    embeddedImageByElement,
    annotationById
) {
    const outputDocument = clonedRoot.ownerDocument;
    const liveImages = Array.from(liveRoot?.querySelectorAll?.('img') || []);
    const clonedImages = Array.from(clonedRoot.querySelectorAll('img'));
    const embeddedImageByUrl = new Map();
    embeddedImageByElement.forEach((resource, liveImage) => {
        [
            resource?.sourceUrl,
            resource?.requestedSourceUrl,
            liveImage?.currentSrc,
            liveImage?.src,
            liveImage?.getAttribute?.('src')
        ].forEach(candidate => {
            const absolute = absoluteSnapshotUrl(candidate);
            if (absolute && resource?.dataUrl && !embeddedImageByUrl.has(absolute)) {
                embeddedImageByUrl.set(absolute, resource);
            }
        });
    });
    clonedImages.forEach((image, index) => {
        const live = liveImages[index];
        const liveCandidates = typeof SciLLM.collectFigureImageCandidates === 'function'
            ? SciLLM.collectFigureImageCandidates(live, document.baseURI)
            : [live?.currentSrc, live?.src].filter(Boolean);
        const resource = embeddedImageByElement.get(live) ||
            liveCandidates.map(absoluteSnapshotUrl)
                .map(candidate => embeddedImageByUrl.get(candidate))
                .find(Boolean);
        if (resource?.dataUrl) {
            image.setAttribute('src', resource.dataUrl);
            image.setAttribute('data-sci-embedded-original', 'true');
            if (resource.pixelWidth) {
                image.setAttribute('data-sci-original-width', String(resource.pixelWidth));
            }
            if (resource.pixelHeight) {
                image.setAttribute('data-sci-original-height', String(resource.pixelHeight));
            }
            if (resource.anchorId) image.id = resource.anchorId;
            image.removeAttribute('srcset');
            image.removeAttribute('sizes');
            image.removeAttribute('loading');
            image.removeAttribute('decoding');
            image.closest('picture')?.querySelectorAll('source').forEach(source => {
                // A data URL contains a comma, which responsive-image srcset
                // parsing treats as a candidate separator. Keep the publisher
                // <source> elements but disable their URL attributes so the
                // valid high-resolution data URL on <img src> is selected.
                source.removeAttribute('srcset');
                source.removeAttribute('src');
                source.removeAttribute('sizes');
            });
        } else {
            const source = absoluteSnapshotUrl(
                live?.currentSrc || image.getAttribute('src') || liveCandidates[0]
            );
            if (source) image.setAttribute('src', source);
            const srcset = String(image.getAttribute('srcset') || '').trim();
            if (srcset) {
                const absoluteSrcset = srcset.split(',').map(candidate => {
                    const parts = candidate.trim().split(/\s+/);
                    const url = absoluteSnapshotUrl(parts.shift());
                    return url ? [url, ...parts].join(' ') : '';
                }).filter(Boolean).join(', ');
                if (absoluteSrcset) image.setAttribute('srcset', absoluteSrcset);
            }
        }
    });

    const highlightSelector = '.sci-highlight,.sci-llm-highlight,.sci-manual-highlight';
    Array.from(clonedRoot.querySelectorAll(highlightSelector))
        .filter(mark => !mark.parentElement?.closest?.(highlightSelector))
        .forEach((mark, highlightIndex) => {
            const annotationId = String(mark.getAttribute('data-annotation-id') || '');
            const annotation = annotationById.get(annotationId);
            const messages = [];
            const category = annotation?.categorySnapshot?.name ||
                mark.getAttribute('data-category-name') ||
                mark.getAttribute('data-category') ||
                mark.getAttribute('data-category-id') ||
                '高亮说明';
            if (String(mark.getAttribute('title') || '').trim()) {
                messages.push(String(mark.getAttribute('title')).trim());
            }
            mark.querySelectorAll('.sci-llm-highlight[title],.sci-highlight[title]')
                .forEach(child => {
                    const message = String(child.getAttribute('title') || '').trim();
                    if (message && !messages.includes(message)) messages.push(message);
                });
            if (String(annotation?.note || '').trim()) {
                messages.push(`备注：${String(annotation.note).trim()}`);
            }
            if (!messages.length) messages.push(category);

            const control = outputDocument.createElement('span');
            control.className = 'sci-snapshot-highlight-control';
            control.setAttribute('data-sci-highlight-source',
                mark.getAttribute('data-source') || (annotation ? 'manual' : ''));
            const toggle = outputDocument.createElement('input');
            toggle.type = 'checkbox';
            toggle.className = 'sci-snapshot-highlight-toggle';
            toggle.id = `sci-snapshot-highlight-toggle-${highlightIndex + 1}`;
            toggle.setAttribute('aria-label', `查看${category}说明`);
            const label = outputDocument.createElement('label');
            label.className = 'sci-snapshot-highlight-label';
            label.setAttribute('for', toggle.id);
            label.setAttribute('title', `点击查看${category}说明`);
            const popover = outputDocument.createElement('span');
            popover.className = 'sci-snapshot-highlight-popover';
            popover.setAttribute('role', 'note');
            const heading = outputDocument.createElement('strong');
            heading.textContent = category;
            const body = outputDocument.createElement('span');
            body.textContent = messages.join('\n');
            popover.append(heading, body);

            mark.removeAttribute('role');
            mark.removeAttribute('tabindex');
            mark.parentNode.insertBefore(control, mark);
            label.appendChild(mark);
            control.append(toggle, label, popover);
        });

    clonedRoot.querySelectorAll([
        '[data-sci-plugin-ui]',
        '#sci-reading-panel',
        '#sci-article-navigator-panel',
        '#sci-figure-image-viewer',
        '#sci-llm-feedback',
        '#sci-manual-toolbar',
        '#sci-highlight-context-popover',
        '#sci-manual-status',
        '#sci-side-panel-restore',
        '#sci-highlight-tooltip',
        '#esSidebar',
        '#esSideButton',
        '#epmt',
        '#immersive-translate-browser-popup',
        '#codex-agent-overlay-root',
        'script'
    ].join(',')).forEach(element => element.remove());

    clonedRoot.querySelectorAll('*').forEach(element => {
        Array.from(element.attributes || []).forEach(attribute => {
            if (/^on/i.test(attribute.name)) element.removeAttribute(attribute.name);
        });
    });
    clonedRoot.querySelectorAll('a[href],link[href],area[href]').forEach(element => {
        const original = String(element.getAttribute('href') || '');
        if (original.startsWith('#')) return;
        const href = absoluteSnapshotUrl(original);
        if (href && !/^javascript:/i.test(href)) {
            element.setAttribute('href', href);
            if (element.matches('a,area')) {
                element.setAttribute('rel', 'noopener noreferrer');
            }
        } else {
            element.removeAttribute('href');
        }
    });
    clonedRoot.querySelectorAll('[src]:not(img)').forEach(element => {
        const src = absoluteSnapshotUrl(element.getAttribute('src'));
        if (src) element.setAttribute('src', src);
    });
    clonedRoot.querySelectorAll('source[srcset]').forEach(source => {
        const srcset = String(source.getAttribute('srcset') || '');
        const absoluteSrcset = srcset.split(',').map(candidate => {
            const parts = candidate.trim().split(/\s+/);
            const url = absoluteSnapshotUrl(parts.shift());
            return url ? [url, ...parts].join(' ') : '';
        }).filter(Boolean).join(', ');
        if (absoluteSrcset) source.setAttribute('srcset', absoluteSrcset);
    });
    clonedRoot.querySelectorAll('[poster],[action]').forEach(element => {
        ['poster', 'action'].forEach(attribute => {
            if (!element.hasAttribute(attribute)) return;
            const absolute = absoluteSnapshotUrl(element.getAttribute(attribute));
            if (absolute) element.setAttribute(attribute, absolute);
        });
    });
}

function appendZoteroSnapshotFigureGallery(
    outputDocument,
    shell,
    liveRoot,
    galleryFigures
) {
    const figures = (Array.isArray(galleryFigures) ? galleryFigures : [])
        .map(figure => ({
            ...figure,
            images: (Array.isArray(figure.images) ? figure.images : [])
                .filter(image => !image.liveImage || !liveRoot?.contains?.(image.liveImage))
        }))
        .filter(figure => figure.images.length);
    if (!figures.length) return;
    const gallery = outputDocument.createElement('section');
    gallery.id = 'sci-reader-snapshot-figure-gallery';
    const heading = outputDocument.createElement('h2');
    heading.textContent = '正文外 Figure 高清图集';
    const explanation = outputDocument.createElement('p');
    explanation.textContent =
        '以下 Figure 位于出版社的弹层或扩展数据区域之外，已单独收录并内嵌最高质量原图。';
    gallery.append(heading, explanation);
    figures.forEach((figure, figureIndex) => {
        const card = outputDocument.createElement('figure');
        const title = outputDocument.createElement('h3');
        title.textContent = String(
            figure.figureLabel || figure.figureId || `Figure ${figureIndex + 1}`
        );
        card.appendChild(title);
        figure.images.forEach((image, imageIndex) => {
            const embedded = outputDocument.createElement('img');
            embedded.src = image.dataUrl;
            embedded.id = image.anchorId;
            embedded.alt = String(
                figure.figureLabel || figure.figureId || `Figure ${figureIndex + 1}`
            );
            embedded.setAttribute('data-sci-embedded-original', 'true');
            if (image.pixelWidth) {
                embedded.setAttribute('data-sci-original-width', String(image.pixelWidth));
            }
            if (image.pixelHeight) {
                embedded.setAttribute('data-sci-original-height', String(image.pixelHeight));
            }
            if (imageIndex > 0) {
                const subheading = outputDocument.createElement('h4');
                subheading.textContent = `原图 ${imageIndex + 1}`;
                card.appendChild(subheading);
            }
            card.appendChild(embedded);
        });
        if (String(figure.caption || '').trim()) {
            const caption = outputDocument.createElement('figcaption');
            caption.textContent = String(figure.caption);
            card.appendChild(caption);
        }
        gallery.appendChild(card);
    });
    shell.appendChild(gallery);
}

function appendZoteroSnapshotNavigation(outputDocument, articleContainer) {
    const headings = Array.from(articleContainer.querySelectorAll('h2,h3'))
        .filter(heading => String(heading.textContent || '').trim())
        .slice(0, 80);
    if (!headings.length) return;
    const nav = outputDocument.createElement('nav');
    nav.id = 'sci-reader-snapshot-navigation';
    const title = outputDocument.createElement('h2');
    title.textContent = '正文导航';
    const list = outputDocument.createElement('ol');
    headings.forEach((heading, index) => {
        if (!heading.id) heading.id = `sci-snapshot-section-${index + 1}`;
        const item = outputDocument.createElement('li');
        if (heading.tagName === 'H3') item.className = 'is-subsection';
        const link = outputDocument.createElement('a');
        link.href = `#${heading.id}`;
        link.textContent = String(heading.textContent || '').replace(/\s+/g, ' ').trim();
        item.appendChild(link);
        list.appendChild(item);
    });
    nav.append(title, list);
    articleContainer.before(nav);
}

function zoteroSnapshotStyle() {
    return `
      :root{color-scheme:light;font-family:Georgia,"Noto Serif SC","Songti SC",serif;
        font-size:18px;line-height:1.78;background:#eef2f5;color:#17212b}
      *{box-sizing:border-box}
      html{scroll-behavior:smooth}
      body{margin:0;background:#eef2f5;color:#17212b}
      a{color:#075985;text-decoration-thickness:1px;text-underline-offset:.15em}
      .sci-snapshot-shell{width:min(100% - 32px,980px);margin:28px auto 60px}
      .sci-snapshot-header{margin-bottom:18px;padding:28px 34px;border:1px solid #c7d3dc;
        border-radius:16px;background:#fff;box-shadow:0 8px 24px rgba(28,50,65,.08)}
      .sci-snapshot-kicker{margin:0 0 10px;color:#0b628c;font:700 13px/1.4
        -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;letter-spacing:.08em;
        text-transform:uppercase}
      .sci-snapshot-header h1{margin:0 0 14px;font-size:clamp(1.65rem,4vw,2.45rem);
        line-height:1.25;letter-spacing:-.02em}
      .sci-snapshot-meta{margin:0;color:#526575;font:14px/1.6
        -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
      #sci-reader-snapshot-navigation,#sci-reader-snapshot-annotations,
      #sci-reader-snapshot-figure-gallery,#sci-reader-snapshot-results,
      .sci-snapshot-article{
        margin:18px 0;padding:26px 34px;border:1px solid #cbd6de;border-radius:14px;
        background:#fff;box-shadow:0 5px 18px rgba(28,50,65,.06)}
      #sci-reader-snapshot-navigation{font:15px/1.55
        -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
      #sci-reader-snapshot-navigation h2{margin-top:0}
      #sci-reader-snapshot-navigation ol{columns:1;margin-bottom:0;padding-left:1.4em}
      #sci-reader-snapshot-navigation li{margin:.32em 0}
      #sci-reader-snapshot-navigation li.is-subsection{margin-left:1em;font-size:.93em}
      .sci-snapshot-article{overflow:hidden}
      .sci-snapshot-article,.sci-snapshot-article article,.sci-snapshot-article main,
      .sci-snapshot-article section,.sci-snapshot-article [class*="main-column" i],
      .sci-snapshot-article [class*="article-main" i],
      .sci-snapshot-article [class*="article-body" i]{
        float:none!important;clear:both!important;width:100%!important;max-width:100%!important;
        margin-left:0!important;margin-right:0!important}
      .sci-snapshot-article h1,.sci-snapshot-article h2,.sci-snapshot-article h3,
      #sci-reader-snapshot-results h1,#sci-reader-snapshot-results h2,
      #sci-reader-snapshot-results h3{scroll-margin-top:24px;line-height:1.3}
      .sci-snapshot-article h2,#sci-reader-snapshot-results h2{
        margin-top:2.2em;padding-bottom:.35em;border-bottom:2px solid #d9e2e8}
      .sci-snapshot-article h3,#sci-reader-snapshot-results h3{margin-top:1.7em}
      .sci-snapshot-article p{margin:0 0 1.15em;text-align:left;overflow-wrap:anywhere}
      .sci-snapshot-article figure,.sci-snapshot-article [role="figure"]{
        display:block!important;float:none!important;width:100%!important;max-width:100%!important;
        margin:2em 0!important;padding:18px!important;border:1px solid #ccd8e0;
        border-radius:12px;background:#f8fafb}
      #sci-reader-snapshot-figure-gallery figure{
        display:block;margin:2em 0;padding:18px;border:1px solid #ccd8e0;
        border-radius:12px;background:#f8fafb}
      .sci-snapshot-article img,.sci-snapshot-article svg,
      .sci-snapshot-article canvas,#sci-reader-snapshot-figure-gallery img{
        display:block;max-width:100%!important;width:auto!important;
        height:auto!important;margin:10px auto}
      .sci-snapshot-article img[data-sci-embedded-original="true"]{
        cursor:zoom-in;background:#fff;image-rendering:auto}
      .sci-snapshot-article img[data-sci-remote-fallback="true"]{
        outline:2px dashed #c77b30;outline-offset:3px}
      .sci-snapshot-article figcaption{margin-top:14px;color:#394d5c;font-size:.92em;
        line-height:1.65}
      .sci-snapshot-article table{display:block;width:100%!important;max-width:100%;
        overflow-x:auto;border-collapse:collapse;font-size:.88em}
      .sci-snapshot-article th,.sci-snapshot-article td{
        padding:.5em .65em;border:1px solid #cbd5dc;vertical-align:top}
      .sci-snapshot-article pre,#sci-reader-snapshot-results pre{
        overflow:auto;padding:14px;border-radius:8px;background:#f2f5f7;font-size:.78em}
      .sci-highlight,.sci-llm-highlight{display:inline;padding:1px 2px;border:0;
        border-bottom:3px solid;border-radius:2px;background:transparent!important;
        color:inherit;box-decoration-break:clone;-webkit-box-decoration-break:clone}
      .sci-llm-inferred-warning{border-bottom-style:dashed!important}
      .sci-manual-highlight{display:inline;padding:0 .08em;border:0;border-radius:2px;
        background:var(--sci-manual-color,#f4e89a)!important;color:inherit;
        box-decoration-break:clone;-webkit-box-decoration-break:clone}
      .sci-snapshot-note-marker{margin-left:.15em;color:#0b4778;font-weight:700}
      #sci-reader-snapshot-annotations blockquote,#sci-reader-snapshot-results blockquote{
        margin:.7em 0;padding:.7em 1em;border-left:4px solid #4d8cac;background:#f4f8fb}
      #sci-reader-snapshot-results{font:16px/1.7
        -apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans SC",sans-serif}
      #sci-reader-snapshot-results dl{margin:.6em 0 1.2em}
      #sci-reader-snapshot-results dt{margin-top:.7em;color:#234a62}
      #sci-reader-snapshot-results dd{margin:.2em 0 .7em 1.2em}
      #sci-reader-snapshot-results h5{margin:1.2em 0 .4em;padding:.4em .65em;
        border-radius:6px;background:#e9f2f7;font-size:1em}
      #sci-reader-snapshot-results p{margin:.5em 0 1em}
      @media(max-width:700px){
        :root{font-size:16px}
        .sci-snapshot-shell{width:min(100% - 16px,980px);margin-top:8px}
        .sci-snapshot-header,#sci-reader-snapshot-navigation,
        #sci-reader-snapshot-annotations,#sci-reader-snapshot-figure-gallery,
        #sci-reader-snapshot-results,
        .sci-snapshot-article{padding:19px 18px;border-radius:9px}
      }
      @media print{
        :root,body{background:#fff}
        .sci-snapshot-shell{width:100%;margin:0}
        .sci-snapshot-header,#sci-reader-snapshot-navigation,
        #sci-reader-snapshot-annotations,#sci-reader-snapshot-figure-gallery,
        #sci-reader-snapshot-results,
        .sci-snapshot-article{box-shadow:none;break-inside:auto}
        figure,img{break-inside:avoid}
      }
    `;
}

function zoteroFaithfulSnapshotStyle() {
    return `
      html[data-sci-reader-snapshot="faithful-v1"] :is(
        #js-enable-context-bar,.c-context-bar--sticky
      ){display:none!important}
      html[data-sci-reader-snapshot="faithful-v1"] body{
        overflow-x:hidden!important
      }
      html[data-sci-reader-snapshot="faithful-v1"] #content{
        box-sizing:border-box!important;width:min(calc(100% - 32px),1160px)!important;
        max-width:1160px!important;margin:28px auto 56px!important
      }
      html[data-sci-reader-snapshot="faithful-v1"] #content :is(
        main.c-article-main-column,article,.c-article-body,#article-body,
        .article-body,.article__body,[data-test="article-body"],
        [data-aa-name="article-body"]
      ){
        float:none!important;clear:both!important;width:100%!important;
        max-width:100%!important;margin-left:0!important;margin-right:0!important
      }
      html[data-sci-reader-snapshot="faithful-v1"] #content :is(
        .c-article-body,#article-body,.article-body,.article__body,
        [data-test="article-body"],[data-aa-name="article-body"]
      ){line-height:1.72!important}
      html[data-sci-reader-snapshot="faithful-v1"] #content :is(figure,[role="figure"]){
        float:none!important;max-width:100%!important;margin-left:auto!important;
        margin-right:auto!important
      }
      html[data-sci-reader-snapshot="faithful-v1"] .sci-snapshot-highlight-control{
        display:inline!important;position:relative!important;margin:0!important;
        padding:0!important;border:0!important
      }
      html[data-sci-reader-snapshot="faithful-v1"]
        .sci-snapshot-highlight-toggle{
        position:absolute!important;width:1px!important;height:1px!important;
        margin:0!important;padding:0!important;opacity:0!important;
        clip-path:inset(50%)!important;overflow:hidden!important
      }
      html[data-sci-reader-snapshot="faithful-v1"]
        .sci-snapshot-highlight-label{
        display:inline!important;margin:0!important;
        padding:0!important;cursor:pointer!important
      }
      html[data-sci-reader-snapshot="faithful-v1"]
        .sci-snapshot-highlight-toggle:focus-visible+.sci-snapshot-highlight-label{
        outline:2px solid #2874a6!important;outline-offset:2px!important
      }
      html[data-sci-reader-snapshot="faithful-v1"]
        .sci-snapshot-highlight-popover{
        display:none;position:absolute;left:0;top:calc(100% + 8px);z-index:2147483646;
        box-sizing:border-box;width:min(430px,82vw);max-height:320px;overflow:auto;
        padding:12px 14px;border:1px solid #c8c5bd;border-radius:8px;
        background:#fff;color:#202832;box-shadow:0 8px 28px rgba(28,37,44,.22);
        font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans SC",sans-serif;
        text-align:left;white-space:normal
      }
      html[data-sci-reader-snapshot="faithful-v1"]
        .sci-snapshot-highlight-toggle:checked~
        .sci-snapshot-highlight-popover{
        display:block
      }
      html[data-sci-reader-snapshot="faithful-v1"]
        .sci-snapshot-highlight-popover>strong{
        display:block;margin:0 0 5px;color:#0b4778;font-size:14px
      }
      html[data-sci-reader-snapshot="faithful-v1"]
        .sci-snapshot-highlight-popover>span{
        display:block;white-space:pre-wrap;overflow-wrap:anywhere
      }
      html[data-sci-reader-snapshot="faithful-v1"]
        img[data-sci-embedded-original="true"]{
        display:block!important;max-width:100%!important;width:auto!important;
        height:auto!important;margin-left:auto!important;margin-right:auto!important;
        image-rendering:auto
      }
      @media(max-width:700px){
        html[data-sci-reader-snapshot="faithful-v1"] #content{
          width:calc(100% - 16px)!important;margin:12px auto 32px!important
        }
      }
      @media print{
        .sci-snapshot-highlight-popover{display:none!important}
      }
    `;
}

async function loadZoteroSnapshotPluginCss() {
    try {
        const cssResponse = await fetch(chrome.runtime.getURL('content.css'), {
            cache: 'no-store'
        });
        if (!cssResponse.ok) throw new Error(`CONTENT_CSS_HTTP_${cssResponse.status}`);
        let css = await cssResponse.text();
        try {
            const fontResponse = await fetch(
                chrome.runtime.getURL('vendor/phosphor/Phosphor.woff2'),
                { cache: 'no-store' }
            );
            if (fontResponse.ok) {
                const fontDataUrl = encodeSnapshotImageDataUrl(
                    new Uint8Array(await fontResponse.arrayBuffer()),
                    fontResponse.headers.get('content-type') || 'font/woff2'
                );
                css = css.replace(
                    /url\((['"]?)vendor\/phosphor\/Phosphor\.woff2\1\)/g,
                    `url("${fontDataUrl}")`
                );
            }
        } catch (_) {}
        return css;
    } catch (error) {
        console.warn('SCI 阅读助手：未能读取快照样式，使用最小兼容样式', error);
        return `
          html[data-sci-reader-single-column="true"] :is(
            .c-article-main-column,.c-article-body,#article-body,.article-body,
            .article__body,[data-test="article-body"],[data-aa-name="article-body"]
          ){float:none!important;width:100%!important;max-width:100%!important}
          .sci-highlight,.sci-llm-highlight{border-bottom:3px solid}
        `;
    }
}

function serializeZoteroSnapshotDoctype() {
    const doctype = document.doctype;
    if (!doctype?.name) return '<!doctype html>';
    let serialized = `<!DOCTYPE ${doctype.name}`;
    if (doctype.publicId) {
        serialized += ` PUBLIC "${doctype.publicId.replace(/"/g, '&quot;')}"`;
    }
    if (doctype.systemId) {
        serialized += `${doctype.publicId ? '' : ' SYSTEM'} "${
            doctype.systemId.replace(/"/g, '&quot;')
        }"`;
    }
    return `${serialized}>`;
}

function buildEnhancedArticleSnapshotHtml(options = {}) {
    const article = options.article || {};
    const annotations = options.annotations ||
        currentManualDocument?.record?.annotations || [];
    const embeddedImageByElement = options.embeddedImageByElement || new Map();
    const annotationById = new Map(
        annotations.map(annotation => [String(annotation.annotationId || ''), annotation])
    );
    const liveRoot = document.documentElement;
    const clonedRoot = liveRoot.cloneNode(true);
    clonedRoot.setAttribute('data-sci-reader-single-column', 'true');
    clonedRoot.setAttribute(
        'data-sci-publisher-family',
        String(
            liveRoot.dataset.sciPublisherFamily ||
            article.publisherFamily ||
            'generic'
        )
    );
    clonedRoot.setAttribute('data-sci-reader-snapshot', 'faithful-v1');
    cleanZoteroSnapshotArticleRoot(
        liveRoot,
        clonedRoot,
        embeddedImageByElement,
        annotationById
    );

    const head = clonedRoot.querySelector('head');
    if (head) {
        let charset = head.querySelector('meta[charset]');
        if (!charset) charset = head.ownerDocument.createElement('meta');
        charset.setAttribute('charset', 'utf-8');
        head.prepend(charset);
        let base = head.querySelector('base');
        if (!base) {
            base = head.ownerDocument.createElement('base');
        }
        base.href = String(article.url || location.href);
        charset.after(base);
        head.querySelector('#sci-reader-snapshot-style')?.remove();
        const style = head.ownerDocument.createElement('style');
        style.id = 'sci-reader-snapshot-style';
        style.setAttribute('data-sci-reader-generated', 'true');
        style.textContent = [
            String(options.pluginCss || ''),
            zoteroFaithfulSnapshotStyle()
        ].join('\n');
        head.appendChild(style);
        const generator = head.ownerDocument.createElement('meta');
        generator.name = 'generator';
        generator.content = `SCI Reader faithful Zotero snapshot; ${
            options.exportedAt || new Date().toISOString()
        }`;
        head.appendChild(generator);
    }
    return `${serializeZoteroSnapshotDoctype()}\n${clonedRoot.outerHTML}`;
}

async function collectZoteroSnapshotFigureResources(collected) {
    const embeddedImageByElement = new Map();
    const galleryFigures = [];
    const missingImageFigureIds = [];
    let embeddedImageCount = 0;
    let embeddedImageBytes = 0;
    for (const [figureIndex, record] of collected.records.entries()) {
        const sourceFigure = collected.inventoryById.get(record.figureId);
        const images = sourceFigure
            ? await collectExportFigureImages(sourceFigure, figureIndex) : [];
        if (!images.length) {
            missingImageFigureIds.push(record.figureId || record.figureLabel);
            continue;
        }
        const galleryFigure = {
            figureId: record.figureId,
            figureLabel: record.figureLabel,
            caption: record.caption,
            images: []
        };
        images.forEach((image, imageIndex) => {
            const anchorId = `sci-snapshot-figure-${figureIndex + 1}-image-${imageIndex + 1}`;
            const dataUrl = encodeSnapshotImageDataUrl(image.data, image.contentType);
            const liveImage = sourceFigure.imageElements?.[image.imageElementIndex];
            if (liveImage && !embeddedImageByElement.has(liveImage)) {
                embeddedImageByElement.set(liveImage, {
                    ...image,
                    anchorId,
                    dataUrl
                });
            }
            galleryFigure.images.push({
                ...image,
                liveImage,
                anchorId,
                dataUrl
            });
            record.imageFiles.push(`snapshot.html#${anchorId}`);
            record.images.push({
                path: `snapshot.html#${anchorId}`,
                contentType: image.contentType,
                byteLength: image.byteLength,
                sourceUrl: publicExportSourceUrl(image.sourceUrl),
                requestedSourceUrl: publicExportSourceUrl(image.requestedSourceUrl),
                pixelWidth: image.pixelWidth,
                pixelHeight: image.pixelHeight,
                candidateCount: image.candidateCount,
                qualitySelection: image.qualitySelection,
                displayedWidth: image.displayedWidth,
                displayedHeight: image.displayedHeight
            });
            embeddedImageCount += 1;
            embeddedImageBytes += Number(image.byteLength) || 0;
        });
        galleryFigures.push(galleryFigure);
    }
    return {
        embeddedImageByElement,
        galleryFigures,
        missingImageFigureIds,
        embeddedImageCount,
        embeddedImageBytes
    };
}

async function exportEnhancedSnapshotToZotero() {
    if (typeof SciLLM.buildZoteroFigureNoteHtml !== 'function' ||
        typeof SciLLM.buildZoteroChatNoteHtml !== 'function' ||
        typeof SciLLM.createZipBlob !== 'function') {
        throw new Error('ZOTERO_EXPORT_MODULE_UNAVAILABLE');
    }
    const article = buildArticleWorkspaceSnapshot({ forceRefresh: true, chatLimit: 0 });
    const collected = collectCompleteExportFigures();
    const annotations = currentManualDocument?.record?.annotations || [];
    const exportedAt = new Date().toISOString();
    const imageBundle = await collectZoteroSnapshotFigureResources(collected);
    const sharedNoteInput = {
        title: article.title,
        url: article.url,
        exportedAt,
        figures: collected.records,
        crossFigureLogic: collected.crossFigureLogic,
        chat: article.chat,
        embeddedImageCount: imageBundle.embeddedImageCount
    };
    const figureNoteHtml = SciLLM.buildZoteroFigureNoteHtml(sharedNoteInput);
    const chatNoteHtml = SciLLM.buildZoteroChatNoteHtml(sharedNoteInput);
    const pluginCss = await loadZoteroSnapshotPluginCss();
    const snapshotContent = buildEnhancedArticleSnapshotHtml({
        article,
        annotations,
        exportedAt,
        pluginCss,
        embeddedImageByElement: imageBundle.embeddedImageByElement
    });
    const payload = {
        title: article.title,
        url: article.url,
        snapshotContent,
        figureNoteHtml,
        chatNoteHtml
    };
    let response = null;
    let directError = null;
    try {
        response = await chrome.runtime.sendMessage({
            type: 'ZOTERO_IMPORT_ENHANCED_SNAPSHOT',
            payload
        });
        if (response?.success && response.data?.imported) {
            return {
                success: true,
                imported: true,
                embeddedImageCount: imageBundle.embeddedImageCount,
                embeddedImageBytes: imageBundle.embeddedImageBytes,
                missingImageFigureIds: imageBundle.missingImageFigureIds,
                ...response.data
            };
        }
        directError = {
            code: response?.error?.code || 'ZOTERO_IMPORT_FAILED',
            message: response?.error?.message || 'Zotero 未接受增强快照'
        };
    } catch (error) {
        directError = {
            code: error?.code || 'ZOTERO_UNAVAILABLE',
            message: error?.message || 'Zotero 不可用'
        };
    }

    const fallbackMetadata = {
        schemaVersion: 1,
        exportKind: 'sci-reader-zotero-enhanced-snapshot',
        extensionVersion: chrome.runtime.getManifest?.().version || '',
        exportedAt,
        title: article.title,
        url: article.url,
        publisherFamily: article.publisherFamily,
        directImportError: directError,
        figureCount: collected.records.length,
        embeddedImageCount: imageBundle.embeddedImageCount,
        embeddedImageBytes: imageBundle.embeddedImageBytes,
        missingImageFigureIds: imageBundle.missingImageFigureIds,
        chatTurnCount: Number(article.chat?.totalTurns) || 0,
        manualAnnotationCount: annotations.length,
        zoteroChildNoteCount: 2
    };
    const fallbackZip = await SciLLM.createZipBlob([
        { path: 'snapshot.html', data: snapshotContent },
        {
            path: 'notes/SCI-Reader-Figure-Interpretation.html',
            data: figureNoteHtml
        },
        {
            path: 'notes/SCI-Reader-Fulltext-QA.html',
            data: chatNoteHtml
        },
        { path: 'metadata.json', data: SciLLM.exportJson(fallbackMetadata) },
        {
            path: 'README.md',
            data: SciLLM.buildZoteroFallbackReadme({
                title: article.title,
                url: article.url
            })
        }
    ]);
    const filename = `${SciLLM.sanitizeExportFilename(
        article.title, 'SCI-article'
    )}-Zotero-enhanced-snapshot.zip`;
    downloadContentExportBlob(fallbackZip, filename);
    return {
        success: true,
        imported: false,
        fallbackDownloaded: true,
        filename,
        embeddedImageCount: imageBundle.embeddedImageCount,
        embeddedImageBytes: imageBundle.embeddedImageBytes,
        missingImageFigureIds: imageBundle.missingImageFigureIds,
        directError
    };
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
    if (request.action === 'setSidePanelShortcutScope') {
        sendResponse({
            success: true,
            enabled: setSidePanelShortcutScope(request)
        });
    } else if (request.action === 'llmAnalysisProgress') {
        const progress = request.progress || {};
        const completedChunkCount = Number.isFinite(Number(progress.completedChunks))
            ? Math.max(0, Math.floor(Number(progress.completedChunks)))
            : 0;
        const totalChunkCount = Number.isFinite(Number(progress.totalChunks))
            ? Math.max(0, Math.floor(Number(progress.totalChunks)))
            : 0;
        const chunkProgressLabel = totalChunkCount > 0
            ? `${Math.min(completedChunkCount + 1, totalChunkCount)}/${totalChunkCount}`
            : '';
        if (Number.isInteger(progress.workspaceLifecycle) &&
            progress.workspaceLifecycle !== articleWorkspaceLifecycleGeneration) {
            sendResponse({ success: true, ignored: true, reason: 'STALE_WORKSPACE_LIFECYCLE' });
            return;
        }
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
            if (progress.phase === 'review_chunk_checkpoint') {
                (Array.isArray(progress.checkpointSummaries)
                    ? progress.checkpointSummaries : []).forEach(item => {
                    const paragraphId = String(item?.paragraphId || '').trim();
                    if (paragraphId) standaloneReviewParagraphSummaries.set(paragraphId, item);
                });
                articleNavigatorState.summariesVisible = true;
                scheduleArticleWorkspaceArtifactsSave({ immediate: true });
            }
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
                `${reason}，${waitSeconds} 秒后自动重试第 ${progress.attempt} 次` +
                (chunkProgressLabel ? `（${chunkProgressLabel}）…` : '…')
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
                `${reason}，已自动拆分为更小分块并继续分析` +
                (totalChunkCount > 0
                    ? `（已完成 ${completedChunkCount}/${totalChunkCount}）…`
                    : '…')
            );
        } else if (progress.phase === 'paragraph_checkpoint') {
            renderProgressiveLlmChunk(progress);
            showLlmPageStatus(
                `当前段落已完成并保存（${progress.checkpointedAnnotations || 0} 条候选），正在继续分析…`
            );
        } else if (progress.phase === 'chunk_checkpoint') {
            renderProgressiveLlmChunk(progress);
            showLlmPageStatus(
                `当前小块结果已渲染（${progress.checkpointedAnnotations || 0} 条候选），正在继续下一块…`
            );
        } else if (progress.phase === 'complete') {
            showLlmPageStatus(totalChunkCount > 0
                ? `LLM 已完成 ${completedChunkCount}/${totalChunkCount} 个分块…`
                : 'LLM 分析已完成。');
        } else {
            showLlmPageStatus(chunkProgressLabel
                ? `LLM 正在分析 ${chunkProgressLabel} 个分块…`
                : 'LLM 正在分析正文分块…');
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
        Promise.resolve().then(async () => {
            const snapshot = buildArticleWorkspaceSnapshot({
                forceRefresh: request.forceRefresh === true,
                chatLimit: Math.max(0, Math.floor(Number(request.chatLimit) || 0))
            });
            const localWorkspace = await ensureCurrentArticleWorkspace({
                forceRefresh: request.forceRefresh === true
            });
            if (!articleStructureObserver) startArticleStructureObserver();
            // This request is read-only. Scheduling a full checkpoint here
            // used to overwrite a valid on-disk chat/index.json with an empty
            // in-memory index before local restoration had a chance to run.
            // Every real mutation already schedules its own checkpoint.
            return {
                success: true,
                snapshot: { ...snapshot, localWorkspace }
            };
        }).then(sendResponse).catch(error => {
            sendResponse({ success: false, error: error.message });
        });
    } else if (request.action === 'ensureArticleWorkspace') {
        ensureCurrentArticleWorkspace({ forceRefresh: request.forceRefresh === true })
            .then(workspace => sendResponse({ success: true, workspace }))
            .catch(error => sendResponse({ success: false, error: error.message }));
    } else if (request.action === 'saveArticleWorkspaceBaseline') {
        persistArticleWorkspaceBaseline()
            .then(result => sendResponse({ success: true, ...result }))
            .catch(error => sendResponse({ success: false, error: error.message }));
    } else if (request.action === 'saveArticleWorkspaceNow') {
        saveCurrentArticleWorkspaceNow()
            .then(sendResponse)
            .catch(error => sendResponse({ success: false, error: error.message }));
    } else if (request.action === 'saveArticleWorkspaceUiState') {
        articleWorkspaceSidePanelUiState = request.uiState && typeof request.uiState === 'object'
            ? { ...request.uiState } : null;
        persistWorkspaceAssetCheckpoint('ui/state.json', {
            navigator: {
                activeTab: articleNavigatorState.activeTab,
                depth: articleNavigatorState.depth,
                summariesVisible: articleNavigatorState.summariesVisible,
                expandedSectionIds: [...articleNavigatorState.expandedSectionIds],
                analysisSectionSelection: Object.fromEntries(
                    articleNavigatorState.analysisSectionSelection
                )
            },
            sidePanel: articleWorkspaceSidePanelUiState
        }).then(() => sendResponse({ success: true }))
            .catch(error => sendResponse({ success: false, error: error.message }));
    } else if (request.action === 'prepareExternalArticleWorkspaceDeletion') {
        sendResponse(prepareExternalArticleWorkspaceDeletion(request.workspaceId));
    } else if (request.action === 'finalizeExternalArticleWorkspaceDeletion') {
        finalizeExternalArticleWorkspaceDeletion(
            request.workspaceId,
            request.workspaceGeneration
        ).then(result => sendResponse(result))
            .catch(error => sendResponse({ success: false, error: error.message, matched: true }));
    } else if (request.action === 'freezeArticleWorkspaceWrites') {
        articleWorkspaceSaveFrozen = true;
        clearTimeout(articleWorkspaceSaveTimer);
        clearTimeout(articleArchiveSaveTimer);
        articleWorkspaceSaveTimer = null;
        articleArchiveSaveTimer = null;
        invalidateArticleWorkspaceLifecycle();
        sendResponse({ success: true, frozen: true });
    } else if (request.action === 'applyArticleWorkspaceAssets') {
        applyArticleWorkspaceAssets(request.restore || request)
            .then(result => sendResponse(result))
            .catch(error => sendResponse({ success: false, error: error.message }));
    } else if (request.action === 'resetArticleWorkspaceState') {
        resetArticleWorkspaceState({ workspaceGeneration: request.workspaceGeneration })
            .then(result => sendResponse(result))
            .catch(error => sendResponse({ success: false, error: error.message }));
    } else if (request.action === 'getArticleArchiveSnapshot') {
        try {
            sendResponse({ success: true, archive: buildCurrentArticleArchive() });
        } catch (error) {
            sendResponse({ success: false, error: error.message });
        }
    } else if (request.action === 'exportPptMaterials') {
        exportPptMaterialBundle()
            .then(result => sendResponse(result))
            .catch(error => sendResponse({
                success: false,
                error: error.message,
                code: error.code || 'PPT_MATERIAL_EXPORT_FAILED'
            }));
    } else if (request.action === 'exportEnhancedSnapshotToZotero') {
        exportEnhancedSnapshotToZotero()
            .then(result => sendResponse(result))
            .catch(error => sendResponse({
                success: false,
                error: error.message,
                code: error.code || 'ZOTERO_ENHANCED_SNAPSHOT_EXPORT_FAILED'
            }));
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
    } else if (request.action === 'setArticleAnalysisSectionSelection') {
        try {
            sendResponse(setArticleAnalysisSectionSelection(
                request.sectionIds,
                request.selected
            ));
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
        clearAutomaticHighlightsAndPersist()
            .then(result => sendResponse(result))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
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
            const counts = highlighter.applyHighlight(
                request.categories,
                request.mode,
                {
                    allowedParagraphIds: selectedArticleAnalysisParagraphIds(),
                    analysisModeId: request.analysisModeId
                }
            );
            lastRegexHighlightRequest = {
                categories: request.categories,
                mode: request.mode === 'sentence' ? 'sentence' : 'word',
                analysisModeId: String(request.analysisModeId || 'regex-default')
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
            highlighter.allowedParagraphIds = selectedArticleAnalysisParagraphIds();
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
            documentHash: request.documentHash,
            readingViewId: request.readingViewId
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
            String(request.customQuestion || ''),
            String(request.historyLabel || '')
        )
            .then(result => sendResponse(result))
            .catch(error => sendResponse({ success: false, error: error.message, code: error.code }));
    } else if (request.action === 'highlightArticleMatchesWithLLM') {
        askArticleWithLLM(
            String(request.question || ''),
            String(request.profileId || ''),
            {
                intent: 'highlight',
                categoryId: String(request.categoryId || 'semantic_match'),
                categoryName: String(request.categoryName || ''),
                highlightColor: String(request.highlightColor || ''),
                contextScope: request.contextScope
            }
        )
            .then(result => sendResponse(result))
            .catch(error => sendResponse({ success: false, error: error.message, code: error.code }));
    } else if (request.action === 'askArticleWithLLM') {
        askArticleWithLLM(
            String(request.question || ''),
            String(request.profileId || ''),
            { contextScope: request.contextScope }
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
        showFigureImageViewer(String(request.figureId || ''))
            .then(sendResponse)
            .catch(error => sendResponse({
                success: false,
                code: String(error?.code || 'FIGURE_VIEWER_FAILED'),
                message: String(error?.message || 'Figure 高清原图打开失败')
            }));
    } else if (request.action === 'getFigureOriginalImageState') {
        sendResponse(getFigureImageViewerState());
    } else if (request.action === 'navigateFigureOriginalImage') {
        navigateFigureImageViewer(
            String(request.direction || ''),
            Number(request.figureNumber) || 0
        )
            .then(sendResponse)
            .catch(error => sendResponse({
                success: false,
                code: String(error?.code || 'FIGURE_VIEWER_NAVIGATION_FAILED'),
                message: String(error?.message || 'Figure 高清原图切换失败')
            }));
    } else if (request.action === 'closeFigureOriginalImage') {
        sendResponse(closeFigureImageViewer());
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
            documentHash: request.documentHash,
            scopeSectionIds: Array.isArray(request.scopeSectionIds)
                ? request.scopeSectionIds : [],
            scopeSelectionProvided: request.scopeSelectionProvided === true
        })
            .then(result => sendResponse(result))
            .catch(error => sendResponse({ success: false, error: error.message, code: error.code }));
    }
    
    return true; // 保持消息通道开放
});

console.log('Brevess 已加载');
