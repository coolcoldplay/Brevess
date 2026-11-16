/* Shared with article QA. DOM-only Markdown; optional citation/diagram hooks keep their original owner. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.BrevessChatMessageUI=api;})(globalThis,()=>{
'use strict';
function createRenderer({document=globalThis.document,createElement,createCitation,createMermaid}={}){
 const createWorkspaceElement=createElement||((tag,className='',text='')=>{const node=document.createElement(tag);node.className=className;node.textContent=text;return node;});
 const createArticleChatInlineCitation=createCitation||(()=>document.createTextNode(''));
 const createArticleChatMermaid=createMermaid||(source=>{const pre=createWorkspaceElement('pre'),code=createWorkspaceElement('code','',source);code.dataset.language='mermaid';pre.append(code);return pre;});
function normalizeArticleChatMarkdownLinkUrl(value) {
    const rawUrl = String(value || '').trim();
    if (!rawUrl || rawUrl.length > 2048) return '';
    let parsed;
    try {
        parsed = new URL(rawUrl);
    } catch (_) {
        return '';
    }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password ||
        isUnsafeArticleChatWebHostname(parsed.hostname)) return '';
    return parsed.href.length <= 2048 ? parsed.href : '';
}

function createArticleChatMarkdownLink(label, value) {
    const url = normalizeArticleChatMarkdownLinkUrl(value);
    if (!url) return null;
    const link = createWorkspaceElement('a', 'article-chat-markdown-link', label || url);
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.referrerPolicy = 'no-referrer';
    link.dataset.sourceTrust = 'unverified';
    link.title = '在新标签页打开外部链接（来源未验证）';
    return link;
}

function articleChatMarkdownExplicitLinkAt(text, start) {
    if (text[start] !== '[' || text[start + 1] === '[') return null;
    let labelEnd = -1;
    for (let index = start + 1; index < text.length && text[index] !== '\n'; index += 1) {
        if (text[index] === '\\') {
            index += 1;
            continue;
        }
        if (text[index] === ']' && text[index + 1] === '(') {
            labelEnd = index;
            break;
        }
    }
    if (labelEnd < 0) return null;
    const destinationStart = labelEnd + 2;
    let parenthesisDepth = 0;
    for (let index = destinationStart; index < text.length && text[index] !== '\n'; index += 1) {
        const character = text[index];
        if (/\s/u.test(character)) return null;
        if (character === '\\') {
            index += 1;
            continue;
        }
        if (character === '(') {
            parenthesisDepth += 1;
        } else if (character === ')') {
            if (parenthesisDepth > 0) {
                parenthesisDepth -= 1;
                continue;
            }
            const label = text.slice(start + 1, labelEnd)
                .replace(/\\([\\[\]()])/g, '$1');
            const url = text.slice(destinationStart, index)
                .replace(/\\([\\()])/g, '$1');
            if (!label || !url) return null;
            return { kind: 'link', label, url, length: index - start + 1 };
        }
    }
    return null;
}

function articleChatMarkdownBareUrlAt(text, start) {
    const prefix = text.slice(start, start + 8);
    if (!/^https?:\/\//i.test(prefix)) return null;
    let end = start;
    while (end < text.length && !/[\s<>"'`]/u.test(text[end])) end += 1;
    let candidate = text.slice(start, end);
    while (/[.,;:!?。；，！？：]$/u.test(candidate)) candidate = candidate.slice(0, -1);
    for (const [opening, closing] of [['(', ')'], ['[', ']'], ['{', '}']]) {
        while (candidate.endsWith(closing) &&
            candidate.split(closing).length > candidate.split(opening).length) {
            candidate = candidate.slice(0, -1);
        }
    }
    return candidate ? { kind: 'link', label: candidate, url: candidate, length: candidate.length } : null;
}

function articleChatInlineMarkdownTokenAt(text, start) {
    const lineBreak = text.slice(start).match(/^<br\s*\/?>/i);
    if (lineBreak) return { kind: 'br', length: lineBreak[0].length };
    const citation = text.slice(start).match(/^\[\[(\d{1,3})\]\]/);
    if (citation) return { kind: 'citation', marker: citation[1], length: citation[0].length };
    const explicitLink = articleChatMarkdownExplicitLinkAt(text, start);
    if (explicitLink) return explicitLink;
    const autoLink = text.slice(start).match(/^<(https?:\/\/[^\s<>]+)>/i);
    if (autoLink) return {
        kind: 'link', label: autoLink[1], url: autoLink[1], length: autoLink[0].length
    };
    const scriptToken = text.slice(start).match(
        /^(?:<sup>[^<\n]+<\/sup>|<sub>[^<\n]+<\/sub>)/i
    );
    const scriptMatch = scriptToken?.[0].match(/^<(sup|sub)>([^<\n]+)<\/\1>$/i);
    if (scriptMatch) return {
        kind: 'script', tagName: scriptMatch[1].toLowerCase(), text: scriptMatch[2],
        length: scriptMatch[0].length
    };
    const delimiters = [
        ['`', 'code'], ['**', 'strong'], ['__', 'strong'], ['*', 'em'], ['_', 'em']
    ];
    for (const [delimiter, kind] of delimiters) {
        if (!text.startsWith(delimiter, start)) continue;
        const end = text.indexOf(delimiter, start + delimiter.length);
        if (end > start + delimiter.length && !text.slice(start, end).includes('\n')) {
            return {
                kind,
                text: text.slice(start + delimiter.length, end),
                length: end + delimiter.length - start
            };
        }
    }
    return articleChatMarkdownBareUrlAt(text, start);
}

function appendArticleChatInlineMarkdown(parent, value, context = {}) {
    const text = String(value || '');
    let cursor = 0;
    let plainTextStart = 0;
    while (cursor < text.length) {
        const token = articleChatInlineMarkdownTokenAt(text, cursor);
        if (!token) {
            cursor += 1;
            continue;
        }
        if (cursor > plainTextStart) {
            parent.appendChild(document.createTextNode(text.slice(plainTextStart, cursor)));
        }
        if (token.kind === 'citation') {
            const marker = token.marker;
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
                parent.appendChild(document.createTextNode(text.slice(cursor, cursor + token.length)));
            }
        } else if (token.kind === 'link') {
            parent.appendChild(createArticleChatMarkdownLink(token.label, token.url) ||
                document.createTextNode(text.slice(cursor, cursor + token.length)));
        } else if (token.kind === 'script') {
            const scriptMatch = ['', token.tagName, token.text];
            parent.appendChild(createWorkspaceElement(
                scriptMatch[1], '', scriptMatch[2]
            ));
        } else if (['strong', 'em'].includes(token.kind) &&
            (Number(context.inlineDepth) || 0) < 8) {
            const formatted = createWorkspaceElement(token.kind);
            appendArticleChatInlineMarkdown(formatted, token.text, {
                ...context, inlineDepth: (Number(context.inlineDepth) || 0) + 1
            });
            parent.appendChild(formatted);
        } else {
            parent.appendChild(createWorkspaceElement(token.kind, '', token.text));
        }
        cursor += token.length;
        plainTextStart = cursor;
    }
    if (plainTextStart < text.length) {
        parent.appendChild(document.createTextNode(text.slice(plainTextStart)));
    }
}

function normalizeArticleChatMarkdown(value) {
    let fence = null;
    return String(value || '').replace(/\r\n?/g, '\n').split('\n').map(line => {
        const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
        if (marker) {
            if (!fence) fence = marker[1];
            else if (marker[1][0] === fence[0] && marker[1].length >= fence.length &&
                line.slice(marker[0].length).trim() === '') fence = null;
            return line;
        }
        // List repair is for prose only: never change table structure or literal code.
        if (fence || line.includes('|') || line.includes('`') || /^(?: {4}|\t)/.test(line)) return line;
        return line.replace(/([。！？；;：:）)])[\t ]*(\d{1,2}[.)]\s+(?=\*\*|__|[\u3400-\u9fffA-Za-z]))/g, '$1\n\n$2');
    }).join('\n').trim();
}

function isArticleChatMarkdownBlockStart(line) {
    return /^(?:#{1,4}\s+|>\s?|```|[-*+]\s+|\d+[.)]\s+)/.test(line) ||
        /^\|?.+\|.+\|?$/u.test(line);
}

function parseArticleChatMarkdownTableRow(value) {
    let line = String(value || '').trim();
    if (!line.includes('|')) return null;
    if (line.startsWith('|')) line = line.slice(1);
    if (line.endsWith('|') && !line.endsWith('\\|')) line = line.slice(0, -1);
    const cells = [];
    let cell = '';
    let code = false;
    for (let index = 0; index < line.length; index += 1) {
        const character = line[index];
        if (character === '\\' && index + 1 < line.length) {
            const escaped = line[index + 1];
            if (['|', '\\', '`'].includes(escaped)) {
                cell += escaped;
                index += 1;
                continue;
            }
        }
        if (character === '`') code = !code;
        if (character === '|' && !code) {
            cells.push(cell.trim());
            cell = '';
        } else {
            cell += character;
        }
    }
    cells.push(cell.trim());
    return cells.length >= 2 ? cells : null;
}

function articleChatMarkdownTableAlignments(cells) {
    if (!Array.isArray(cells) || cells.length < 2) return null;
    const alignments = [];
    for (const value of cells) {
        const cell = String(value || '').trim();
        if (!/^:?-{3,}:?$/u.test(cell)) return null;
        alignments.push(cell.startsWith(':') && cell.endsWith(':')
            ? 'center' : cell.endsWith(':') ? 'right' : 'left');
    }
    return alignments;
}

function createArticleChatMarkdownTable(headerCells, alignments, bodyRows, context) {
    const wrapper = createWorkspaceElement('div', 'article-chat-markdown-table-wrap');
    wrapper.setAttribute('role', 'region');
    wrapper.setAttribute('aria-label', '回答中的表格');
    wrapper.tabIndex = 0;
    const table = createWorkspaceElement('table', 'article-chat-markdown-table');
    const head = document.createElement('thead');
    const headerRow = document.createElement('tr');
    headerCells.forEach((value, index) => {
        const cell = document.createElement('th');
        cell.scope = 'col';
        cell.style.textAlign = alignments[index];
        appendArticleChatInlineMarkdown(cell, value, context);
        headerRow.appendChild(cell);
    });
    head.appendChild(headerRow);
    const body = document.createElement('tbody');
    bodyRows.forEach(row => {
        const tableRow = document.createElement('tr');
        headerCells.forEach((_, index) => {
            const cell = document.createElement('td');
            cell.style.textAlign = alignments[index];
            appendArticleChatInlineMarkdown(cell, row[index] || '', context);
            tableRow.appendChild(cell);
        });
        body.appendChild(tableRow);
    });
    table.append(head, body);
    wrapper.appendChild(table);
    if (globalThis.BrevessTableViewer?.open) {
        const block = createWorkspaceElement('section', 'article-chat-table-block');
        const tools = createWorkspaceElement('div', 'article-chat-table-tools');
        const label = createWorkspaceElement('span', '', `${bodyRows.length} 行 · ${headerCells.length} 列`);
        const expand = createWorkspaceElement('button', 'article-chat-table-expand', '放大查看');
        expand.type = 'button';
        expand.setAttribute('aria-label', '在大窗口查看完整表格');
        expand.title = '打开独立大窗口，保留当前对话位置';
        const status = createWorkspaceElement('span', 'article-chat-table-status'); status.setAttribute('role', 'status');
        expand.addEventListener('click', async () => {
            if (expand.disabled) return;
            expand.disabled = true; status.textContent = '';
            try { await globalThis.BrevessTableViewer.open(table); }
            catch (e) { status.textContent = e.message || '无法打开表格，请重试。'; }
            finally { expand.disabled = false; }
        });
        tools.append(label, expand); block.append(tools, wrapper, status); return block;
    }
    return wrapper;
}

function articleChatOrderedListItemCount(value) {
    return normalizeArticleChatMarkdown(value).split('\n')
        .filter(line => /^\s*\d+[.)]\s+/.test(line)).length;
}

function renderArticleChatMarkdown(value, context = {}) {
    const root = createWorkspaceElement('div', 'article-chat-message-content');
    root.setAttribute('data-i18n-user-content', '');
    const renderContext = { ...context, citationIndexes: new Set() };
    const lines = normalizeArticleChatMarkdown(value).split('\n');
    let index = 0;
    let orderedItemsRendered = 0;
    while (index < lines.length) {
        const line = lines[index].trim();
        if (!line) {
            index += 1;
            continue;
        }
        const fenceMatch = line.match(/^(`{3,}|~{3,})(.*)$/);
        if (fenceMatch) {
            const language = fenceMatch[2].trim();
            const fenceEnd = new RegExp(`^${fenceMatch[1][0]}{${fenceMatch[1].length},}\\s*$`);
            const codeLines = [];
            index += 1;
            while (index < lines.length && !fenceEnd.test(lines[index].trim())) {
                codeLines.push(lines[index]);
                index += 1;
            }
            if (index < lines.length) index += 1;
            if (language.toLowerCase() === 'mermaid') {
                root.appendChild(createArticleChatMermaid(codeLines.join('\n')));
                continue;
            }
            const pre = createWorkspaceElement('pre');
            const code = createWorkspaceElement('code', '', codeLines.join('\n'));
            if (language) code.dataset.language = language;
            pre.appendChild(code);
            root.appendChild(pre);
            continue;
        }
        const tableHeader = parseArticleChatMarkdownTableRow(lines[index]);
        const tableDelimiter = index + 1 < lines.length
            ? parseArticleChatMarkdownTableRow(lines[index + 1]) : null;
        const tableAlignments = articleChatMarkdownTableAlignments(tableDelimiter);
        if (tableHeader && tableAlignments && tableHeader.length === tableAlignments.length) {
            const bodyRows = [];
            index += 2;
            while (index < lines.length && lines[index].trim()) {
                const row = parseArticleChatMarkdownTableRow(lines[index]);
                if (!row) break;
                bodyRows.push(row.slice(0, tableHeader.length));
                index += 1;
            }
            root.appendChild(createArticleChatMarkdownTable(
                tableHeader, tableAlignments, bodyRows, renderContext
            ));
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
            if (ordered) {
                const explicitStart = Number.parseInt(listMatch[1], 10);
                const continuedStart = Math.max(
                    1,
                    (Number(context.orderedListStart) || 1) + orderedItemsRendered
                );
                const start = Math.max(explicitStart || 1, continuedStart);
                if (start > 1) list.start = start;
            }
            let listItemCount = 0;
            while (index < lines.length) {
                const itemMatch = lines[index].trim().match(/^([-*+]|\d+[.)])\s+(.+)$/);
                if (!itemMatch || /^\d/.test(itemMatch[1]) !== ordered) break;
                const item = createWorkspaceElement('li');
                appendArticleChatInlineMarkdown(item, itemMatch[2], renderContext);
                list.appendChild(item);
                listItemCount += 1;
                index += 1;
            }
            if (ordered) orderedItemsRendered += listItemCount;
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

function isUnsafeArticleChatWebHostname(value) {
    const hostname = String(value || '').toLowerCase()
        .replace(/^\[|\]$/g, '').replace(/\.$/, '');
    if (!hostname || hostname === 'localhost' ||
        /(?:^|\.)(?:localhost|local|internal|intranet|home|lan|onion|test|invalid|example)$/.test(hostname)) {
        return true;
    }
    if (hostname.includes(':')) {
        const first = hostname.split(':', 1)[0];
        if (hostname === '::' || hostname === '::1' ||
            hostname.startsWith('::ffff:') ||
            /^(?:fc|fd)[0-9a-f]{0,2}$/i.test(first) ||
            /^fe[89ab][0-9a-f]?$/i.test(first) ||
            /^ff[0-9a-f]{0,2}$/i.test(first) ||
            hostname.startsWith('100:') ||
            hostname === '2001:db8::' || hostname.startsWith('2001:db8:') ||
            hostname.startsWith('2001:0:') || hostname.startsWith('2001:2:') ||
            hostname.startsWith('2002:') || hostname.startsWith('64:ff9b:1:')) {
            return true;
        }
        const mappedIpv4 = hostname.match(/:(\d{1,3}(?:\.\d{1,3}){3})$/)?.[1];
        return mappedIpv4 ? isUnsafeArticleChatWebHostname(mappedIpv4) : false;
    }
    if (/^\d+(?:\.\d+){3}$/.test(hostname)) {
        const octets = hostname.split('.').map(Number);
        if (octets.length !== 4 || octets.some(octet =>
            !Number.isInteger(octet) || octet < 0 || octet > 255)) return true;
        const [a, b, c] = octets;
        return a === 0 || a === 10 || a === 127 || a >= 224 ||
            (a === 100 && b >= 64 && b <= 127) ||
            (a === 169 && b === 254) ||
            (a === 172 && b >= 16 && b <= 31) ||
            (a === 192 && b === 0) ||
            (a === 192 && b === 168) ||
            (a === 198 && (b === 18 || b === 19)) ||
            (a === 198 && b === 51 && c === 100) ||
            (a === 203 && b === 0 && c === 113);
    }
    return !hostname.includes('.');
}

return {normalizeArticleChatMarkdownLinkUrl,createArticleChatMarkdownLink,articleChatMarkdownExplicitLinkAt,articleChatMarkdownBareUrlAt,articleChatInlineMarkdownTokenAt,appendArticleChatInlineMarkdown,normalizeArticleChatMarkdown,isArticleChatMarkdownBlockStart,parseArticleChatMarkdownTableRow,articleChatMarkdownTableAlignments,createArticleChatMarkdownTable,articleChatOrderedListItemCount,renderArticleChatMarkdown,isUnsafeArticleChatWebHostname};
}
return {createRenderer};
});
