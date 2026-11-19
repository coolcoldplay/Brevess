
;/* native/core/chat-message-ui.js */
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


;/* web-chrome.js */
/* Faithful reading surfaces; navigation links lead to their real public destinations. */
window.BVWebChrome=(d,meta)=>{
 const e=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const paths={folder:'M3 6h7l2 2h9v12H3z',file:'M6 3h8l5 5v13H6z M14 3v6h5',branch:'M6 3v13a4 4 0 0 0 8 0V8 M3 3h6 M11 8h6',star:'m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z',code:'m8 6-6 6 6 6m8-12 6 6-6 6',issue:'M12 8v5m0 3h.01 M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',pull:'M6 5v14m10 0V9c0-3-2-4-5-4m0 0 3-3m-3 3 3 3',play:'m9 7 8 5-8 5Z M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',menu:'M4 5h16v14H4z M9 5v14',edit:'m15 4 5 5-11 11H4v-5z M13 6l5 5',search:'M20 20l-5-5 M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0',arrow:'M12 20V4m-6 6 6-6 6 6',plus:'M12 4v16M4 12h16',copy:'M9 9h11v11H9z M5 15H3V3h12v2',audio:'M4 10v4m4-8v12m4-15v18m4-15v12m4-8v4',chevron:'m6 9 6 6 6-6',share:'M12 16V3m-5 5 5-5 5 5 M5 13v7h14v-7',thumb:'M7 10v10H3V10z M7 10l5-8 3 2v6h6l-3 10H7',more:'M4 12h1m6 0h1m6 0h1'};
 const icon=n=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[n]||paths.more}"/></svg>`;
 const button=(name,label,action)=>`<button type="button" title="${label}" aria-label="${label}" data-action="${action}">${icon(name)}</button>`;
 const repo='https://github.com/coolcoldplay/Brevess';
 if(d.web==='chatgpt')return {
  rail:`<nav class="chat-rail" aria-label="对话导航">${button('menu','展开对话导航','chat-menu')}${button('edit','打开 ChatGPT','chat-open')}${button('search','搜索当前对话','search')}<span></span><div class="chat-profile" aria-label="对话阅读预览">○</div></nav><div class="chat-drawer" hidden><strong>ChatGPT</strong><button data-action="chat-menu">${e(d.title)}</button></div>`,
  header:`<header class="chat-head"><button data-action="chat-model">ChatGPT ${icon('chevron')}</button><div>${button('share','复制当前演示链接','share')}${button('more','对话选项','chat-menu')}</div></header>`,
  before:`<div class="chat-question">${e(d.prompt)}</div><div class="chat-thought">思考完毕 <span aria-hidden="true">›</span></div>`,
  after:`<div class="chat-response-actions">${button('copy','复制完整回答','chat-copy')}${button('thumb','反馈此演示','feedback')}${button('audio','朗读回答','chat-speak')}${button('share','复制演示链接','share')}</div>`,
  composer:`<div class="chat-composer"><form><input aria-label="在 BREVESS 中追问当前对话" placeholder="询问 ChatGPT" autocomplete="off"><div><button type="button" data-action="chat-followup" title="使用 BREVESS 追问">${icon('plus')}</button><span>更多思考</span><button type="submit" title="在 BREVESS 侧栏中提问" aria-label="在 BREVESS 侧栏中提问">${icon('audio')}</button></div></form><small>ChatGPT 也可能会犯错。请核查重要信息。</small></div>`
 };
 const r=meta.repo,c=meta.commit;
 return {rail:'',header:`<header class="github-head"><div class="github-global"><img class="github-symbol" src="../site/github.svg" alt="GitHub" width="24" height="24"><a href="${repo}" target="_blank" rel="noopener">coolcoldplay / <strong>Brevess</strong></a><a class="github-public" href="${repo}" target="_blank" rel="noopener">Public</a></div><nav class="github-menu" aria-label="仓库导航"><a aria-current="page" href="${repo}" target="_blank">${icon('code')} Code</a><a href="${repo}/issues" target="_blank">${icon('issue')} Issues</a><a href="${repo}/pulls" target="_blank">${icon('pull')} Pull requests</a><a href="${repo}/actions" target="_blank">${icon('play')} Actions</a></nav></header>`,
 before:`<div class="github-repo-controls"><a href="${repo}/tree/main" target="_blank">${icon('branch')} main ${icon('chevron')}</a><span></span><a href="${repo}" target="_blank">${icon('star')} Star <span>${e(r.stargazers_count??'')}</span></a><a class="github-code" href="${repo}" target="_blank">${icon('code')} Code ${icon('chevron')}</a></div><div class="github-files">${c?`<a class="github-commit" href="${e(c.html_url)}" target="_blank"><strong>coolcoldplay</strong><span>${e(c.commit?.message?.split('\n')[0])}</span><code>${e(c.sha?.slice(0,7))}</code></a>`:''}${(Array.isArray(meta.files)?meta.files:[]).map(f=>`<a href="${e(f.html_url)}" target="_blank" rel="noopener">${icon(f.type==='dir'?'folder':'file')}<span class="github-filename">${e(f.name)}</span></a>`).join('')}</div><div class="github-file">☷ &nbsp; README &nbsp; · &nbsp; AGPL-3.0</div>`,
 after:`<footer><a href="${repo}" target="_blank" rel="noopener">GitHub ↗</a><span>仓库界面演示</span></footer>`,composer:''};
};


;/* web-source.js */
/* Complete public repository snapshot and authorized conversation. No live accounts. */
(() => {
 const repo='https://github.com/coolcoldplay/Brevess';
 const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text)n.textContent=text;return n;};
 async function get(url){const r=await fetch(url,{credentials:'omit',signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('暂时无法读取演示素材（'+r.status+'）。');return r.json();}
 function safeHtml(html){
  const parsed=new DOMParser().parseFromString(html,'text/html');
  const allowed=new Set('ARTICLE DIV SPAN P H1 H2 H3 H4 H5 H6 A IMG STRONG B EM I S DEL CODE PRE UL OL LI TABLE THEAD TBODY TR TH TD BLOCKQUOTE HR BR DETAILS SUMMARY FIGURE FIGCAPTION KBD SUP SUB'.split(' '));
  const url=(value,image)=>{try{if(image){if(value==='extension/icons/Brevess-logo.svg')return new URL('../site/logo.svg',document.baseURI).href;if(value.startsWith('docs/assets/'))return new URL('../'+value.slice('docs/assets/'.length),document.baseURI).href;}const u=new URL(value,repo+'/blob/main/');return /^https?:$/.test(u.protocol)||(!image&&u.protocol==='mailto:')?u.href:'';}catch{return '';}};
  function clone(n){if(n.nodeType===3)return document.createTextNode(n.textContent);if(n.nodeType!==1)return document.createTextNode('');if(['SCRIPT','STYLE','IFRAME','FORM','INPUT','BUTTON','OBJECT','EMBED','SVG'].includes(n.tagName))return document.createTextNode('');const out=allowed.has(n.tagName)?document.createElement(n.tagName.toLowerCase()):document.createElement('span');
   if(n.tagName==='A'){const href=url(n.getAttribute('href')||'',false);if(href){out.href=href;out.target='_blank';out.rel='noopener noreferrer';}if(n.classList.contains('anchor'))return document.createTextNode('');}
   if(n.tagName==='IMG'){out.src=url(n.getAttribute('src')||'',true);out.alt=n.getAttribute('alt')||'';out.loading='lazy';out.referrerPolicy='no-referrer';if(/^\d+$/.test(n.getAttribute('width')||''))out.width=Number(n.getAttribute('width'));}
   if(['TH','TD'].includes(n.tagName))for(const a of ['colspan','rowspan'])if(/^\d+$/.test(n.getAttribute(a)||''))out.setAttribute(a,n.getAttribute(a));
   if(n.getAttribute('align')==='center')out.classList.add('source-centered');
   if(n.classList.contains('markdown-heading'))out.classList.add('markdown-heading');
   out.append(...[...n.childNodes].map(clone));return out;
  }
  const result=el('div','source-markdown');result.append(...[...(parsed.querySelector('article')||parsed.body).childNodes].map(clone));return result;
 }
 function corpus(content,d){
  const nodes=[],paragraphs=[];let current=null;
  for(const n of content.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,td,th,blockquote')){
   const text=n.textContent.trim();if(!text||n.querySelector('p,li,td,th,blockquote'))continue;
   const heading=/^H[1-6]$/.test(n.tagName),id=paragraphs.length?'p'+paragraphs.length:'overview';
   n.id='bv-'+id;n.dataset.paragraph=id;
   if(heading||!current){current={sectionId:id,title:text,level:heading?Number(n.tagName.slice(1)):1,order:nodes.length,children:[],paragraphCount:0,analysisSectionIds:[],analysisSelected:true};if(!heading)current.title=d.web==='chatgpt'?'回答':'README';nodes.push(current);}
   current.paragraphCount++;current.analysisSectionIds.push(id);
   paragraphs.push({id,heading:current.title,sectionId:current.sectionId,text:n.textContent,zh:'',summary:[n.textContent]});
  }
  const roots=[],stack=[];for(const node of nodes){while(stack.length&&stack.at(-1).level>=node.level)stack.pop();(stack.length?stack.at(-1).children:roots).push(node);stack.push(node);}
  d.paragraphs=paragraphs;d.outline=roots;
  const opening=paragraphs.find(p=>p.text.length>65&&!/^#/.test(p.text));d.sampleId=opening?.id||paragraphs[0]?.id;
  if(d.web==='chatgpt'&&opening)opening.zh='After reviewing the repository, I think BREVESS’s strongest advantage is connecting figure-by-figure paper reading, evidence checking, mechanism mapping, hypothesis building and experimental figure planning into a workflow that supports continuous accumulation and human revision. This direction has clear value for researchers reading mechanistic papers, preparing journal clubs, writing proposals and designing experiments.';
  if(d.web==='github')for(const p of paragraphs){if(p.text.trim()==='快速凝练真实、有用的信息，构建知识结构，推动科学研究。')p.zh='Quickly distill reliable, useful information, build a structure of knowledge, and advance scientific research.';if(p.text.includes('Manual and AI-assisted reading'))p.zh='人工阅读与 AI 辅助相结合，从论文与证据走向假说与组图规划。';}
  if(d.web==='github')d.sampleId=paragraphs.find(p=>p.zh)?.id||d.sampleId;
 }
 window.BVLoadWebSource=async kind=>{
  const d={web:kind,source:kind==='github'?repo:'https://chatgpt.com/',publisher:kind==='github'?'GitHub':'ChatGPT'};
  let content,meta={};
  if(kind==='github'){
   const snapshot=await get('github-repository.json');
   content=safeHtml(snapshot.readmeHtml);d.title=snapshot.title;meta=snapshot.meta;
  }else{
   const chat=await get('chatgpt-conversation.json');d.title=chat.title;d.prompt=chat.prompt;d.originalMarkdown=chat.markdown;
   const markdown=chat.markdown.replace(/:chatgpt-content-reference\{index="(\d+)"\}/g,(_,n)=>'〔来源 '+(Number(n)+1)+'〕');
   content=el('div','source-markdown');content.append(BrevessChatMessageUI.createRenderer().renderArticleChatMarkdown(markdown));
   const headings=[...chat.markdown.matchAll(/^(#{1,6})\s+(.+)$/gm)];
   [...content.querySelectorAll('h3,h4')].forEach((h,i)=>{if(!headings[i])return;const real=el('h'+headings[i][1].length);real.append(...h.childNodes);h.replaceWith(real);});
  }
  corpus(content,d);if(!d.paragraphs.length)throw Error('来源正文尚未就绪，请重试。');
  return {data:window.BVPrepareWebData(d),content,meta};
 };
})();


;/* web-data.js */
/* Shared data for the reader and its isolated production sidebar. */
(() => {
 window.BVPrepareWebData=d=>{
  d.documentId='public-web-'+d.web;d.figures=[];
  d.highlightTerms=[['term_brevess','阅读与整理','#4ECDC4','BREVESS|高亮|笔记|annotations?|notes?|reading'],['term_ai','AI 与模型','#FFB6C1','\\b(?:AI|API|LLM)\\b'],['term_evidence','证据与假说','#87CEEB','证据|假说|evidence|hypothes[ie]s|observations?']];
  const relevant=(re)=>d.paragraphs.filter(p=>re.test(p.text));
  const evidence=relevant(/假说|Panel|证据|研究规划/),manual=relevant(/无需 API|手动|人工|模型/),limits=relevant(/限制|失败|尚未|不能|不代表/);
  const target=re=>relevant(re)[0]||d.paragraphs[0];
  d.highlightSlices=[...new Set([...evidence.slice(0,3),...manual.slice(0,2),...limits.slice(0,2)])].map(p=>[p.id,limits.includes(p)?'limitation':'method',0,null,.94,p.text]);
  d.selectionExplanation='本段保留了作者的原始表述。可以分别标注功能、证据和限制，并通过链接核对来源。';
  const q1=target(/无需 API|手动|人工优先|人工修订/),q2=target(/假说.*Panel|假说.*组图|文献雷达/);
  d.questions=[{q:[d.web==='github'?'不配置 API 可以用哪些功能？':'这段对话认为 BREVESS 的核心优势是什么？'],match:/api|模型|手动|优势|核心|重点|总结|advantage|features|core|summary/i,answer:[d.web==='github'?'基础阅读与整理可以手动完成，AI 辅助按需接入。':'对话强调将文献证据、假说和实验组图连接成可持续积累、人工修订的工作流。'],details:[q1.text],evidenceIds:[q1.id]},{q:['阅读材料怎样进入研究规划？'],match:/材料|联动|研究|规划|workflow|research|planning|materials/i,answer:['从阅读中保留材料和证据，再用于假说梳理与组图规划。'],details:[q2.text],evidenceIds:[q2.id]}];
  d.questions[0].q[1]=d.web==='github'?'Which features work without an API?':'What does this conversation identify as BREVESS’s main advantage?';
  d.questions[0].answer[1]=d.web==='github'?'Core reading and organization work manually. AI assistance can be connected when needed.':'The conversation emphasizes a workflow that connects literature evidence, hypotheses and figure planning, while allowing ongoing accumulation and manual revision.';
  d.questions[0].details[1]=d.web==='github'?'The repository describes manual reading tools and optional model connections. Follow the citation to check the original description.':'The author highlights how reading materials can be retained and reused in a research project. Follow the citation to inspect the original wording.';
  d.questions[1].q[1]='How do reading materials feed into research planning?';
  d.questions[1].answer[1]='Retain materials and evidence while reading, then reuse them in hypothesis mapping and figure planning.';
  d.questions[1].details[1]='The cited source connects papers, figures and panels with research-planning objects. Open the citation to verify the passage.';
  d.notes={research_background:d.paragraphs[0].text,scientific_questions:'如何把阅读材料连接到研究规划？',main_findings:q2.text,limitations:limits[0]?.text||'请结合原文核对。',transferable_ideas:q1.text};
  d.readerExamples={title:d.title,headings:{},figures:[],abbreviations:[{abbreviation:'AI',fullName:'artificial intelligence',paragraphId:target(/AI/).id,meaningZh:'人工智能',definitionZh:'辅助理解和组织信息的模型，生成内容需要核查。'},{abbreviation:'API',fullName:'application programming interface',paragraphId:target(/API/).id,meaningZh:'应用程序接口',definitionZh:'用于连接模型等服务的接口。'}],semanticQueries:[
   {query:'人工整理和 AI 辅助如何配合？',aliases:/api|付费|模型|免费|接入|手动|人工|without/i,score:s=>manual.some(p=>p.id===s.paragraphId)?.96:.08},
   {query:'阅读材料如何帮助规划下一步研究？',aliases:/研究|材料|规划|课题|实验|下一步|research|证据|假说/i,score:s=>evidence.some(p=>p.id===s.paragraphId)?.96:.08}
  ]};
  return d;
 };
 const kind=new URLSearchParams(location.search).get('web');
 if(['github','chatgpt'].includes(kind)&&parent!==window&&parent.BV_DEMO_DATA?.web===kind)window.BV_DEMO_DATA=parent.BV_DEMO_DATA;
})();

