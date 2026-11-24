/* @@ selects explicit sources; normal single-document QA retains its own route. */
(function () {
  'use strict';
  const sessions = new Map();
  let current = null, picker = null, preview = null, sequence = 0, rendering = false;
  const form = () => document.getElementById('articleChatForm');
  const input = () => document.getElementById('articleChatQuestion');
  const el = (tag, cls, text) => { const n = document.createElement(tag); n.className = cls || ''; if (text) n.textContent = text; return n; };
  function button(text, action, cls = '') { const b = el('button', cls, text); b.type = 'button'; b.onclick = action; return b; }
  async function call(command, fields = {}) {
    const response = await chrome.runtime.sendMessage({ type: 'WFG_RESEARCH', command, ...fields });
    if (!response?.ok) throw Error(response?.error || '请求未完成');
    return response.data;
  }
  function payload(s) { return { tabIds: s.sources.map(t => t.id), sourceNumbers: s.sources.map(t => t.number) }; }
  function usesSelectedSources(s) { return !!s?.explicitSources && s.sources.length > 0; }
  function notice(text) { if (current) current.notice = text; render(); }
  function errorText(e) {
    const code = String(e?.message || e);
    return ({ BODY_CITATIONS_MISSING:'已读取正文，但模型没有给出能核对的引用。请重试或切换模型。', SOURCE_BODY_UNAVAILABLE:'所选来源没有可读取的正文。请在原标签页打开全文，再重新发送。', BODY_REVIEW_INVALID:'模型未能完成分批阅读，请重试或切换模型。', MODEL_JSON_INVALID: '模型返回格式不完整，请重试。', MODEL_TIMEOUT: '模型响应超时，请稍后重试。', TOOL_ARGUMENT_INVALID: '模型请求的原文位置无效，请重试。', PDF_SOURCE_NOT_READY: '这份 PDF 还在读取文字，请稍后重试。',
      SOURCE_CLOSED_OR_NAVIGATED: '所选网页已关闭或跳转，请重新选择后发送。',
      SOURCE_DOCUMENT_CHANGED: '所选内容发生了变化，请重新发送以使用最新正文。',
      PAGE_NOT_PERMITTED: '这个页面暂时不能读取，请改选普通网页或 BREVESS PDF 阅读器。',
      RESEARCH_CANCELLED: '已停止生成', RESEARCH_BUSY: '上一条问题仍在处理，请稍后再发送。',
      SOURCE_CITATION_NOT_LOCATED: '原文引用暂时无法定位，请核对来源。'
    })[code] || code;
  }
  function closePicker(focus = false) { picker?.remove(); picker = null; if (focus) input()?.focus(); }
  async function sync() {
    const seq = ++sequence;
    closePicker();
    closePreview();
    current = null;
    const { id: windowId } = await chrome.windows.getCurrent();
    const [tab] = await chrome.tabs.query({ active: true, windowId });
    if (seq !== sequence || !tab) return;
    const key = tab.id + ':' + tab.url;
    if (!sessions.has(key)) sessions.set(key, { key, tabId: tab.id, sources: [{ id: tab.id, title: tab.title, number: 1 }], nextNumber: 2, turns: [], notice: '', busy: false });
    current = sessions.get(key);
    render();
  }
  async function history(s) {
    if (!usesSelectedSources(s) || s.busy) return;
    const identity = JSON.stringify(payload(s));
    try {
      const result = await call('HISTORY', payload(s));
      if (identity !== JSON.stringify(payload(s))) return;
      s.turns = result.items || []; render();
    } catch (e) { if (s === current) notice(errorText(e)); }
  }
  async function chooseSources() {
    if (!current) await sync();
    const s = current;
    if (!s || s.busy) return;
    closePicker();
    try {
      const { id: windowId } = await chrome.windows.getCurrent();
      const tabs = await call('LIST', { windowId });
      if (s !== current) return;
      if (!tabs.some(t => t.id === s.tabId)) throw Error('PAGE_NOT_PERMITTED');
      if (!s.sources.length) { s.sources.push({ ...tabs.find(t => t.id === s.tabId), number: 1 }); s.nextNumber = 2; }
      for (const source of s.sources) source.title = tabs.find(t => t.id === source.id)?.title || source.title;
      s.explicitSources = true;
      render();
      const box = el('section', 'brevess-compare-picker'); picker = box;
      box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', '选择网页或 PDF');
      const head = el('div', 'brevess-compare-picker-head');
      const dismiss=button('×', () => { closePicker(true); void history(s); });
      dismiss.setAttribute('aria-label','关闭');head.append(el('strong', '', '选择网页或 PDF'),dismiss);
      const search = el('input'); search.type = 'search'; search.placeholder = '搜索已打开的标签页'; search.setAttribute('aria-label', search.placeholder);
      const rows = el('div', 'brevess-compare-rows');
      const hint = el('small', '', '最多 6 篇 · 提问时可写“网页 1”和“网页 2”');
      function list() {
        rows.replaceChildren();
        for (const tab of tabs.filter(t => (t.title + ' ' + t.url).toLowerCase().includes(search.value.toLowerCase()))) {
          const row = el('label', 'brevess-compare-source');
          const check = el('input'); check.type = 'checkbox'; check.checked = s.sources.some(t => t.id === tab.id);
          check.disabled = !check.checked && s.sources.length >= 6;
          const selected = s.sources.find(t => t.id === tab.id);
          const text = el('span'); text.append(el('span', 'brevess-compare-source-name', tab.title || tab.url), el('small', '', (selected ? '网页 ' + selected.number + ' · ' : '') + (tab.kind === 'pdf' ? 'PDF' : tab.url) + (tab.id === s.tabId ? ' · 当前页' : '')));
          check.onchange = () => {
            if (check.checked) s.sources.push({ ...tab, number: s.nextNumber++ });
            else s.sources = s.sources.filter(t => t.id !== tab.id);
            s.turns = []; s.notice = ''; list(); render();
          };
          row.append(check, text); rows.append(row);
        }
        if (!rows.childElementCount) rows.append(el('p', '', '没有匹配的标签页'));
      }
      search.oninput = list;
      box.append(head, search, rows, hint); document.body.append(box);
      const rect = input().getBoundingClientRect();
      box.style.left = Math.max(8, rect.left) + 'px';
      box.style.width = Math.min(rect.width, innerWidth - 16) + 'px';
      box.style.bottom = Math.max(8, innerHeight - rect.top + 8) + 'px';
      list(); search.focus();
    } catch (e) { notice(errorText(e)); }
  }
  async function locate(turn, ref, sources) {
    try { await call('LOCATE', { ...sources, turnId: turn.turnId, citation: ref.citation }); }
    catch (e) { notice(errorText(e)); }
  }
  function closePreview(restoreFocus = false) {
    if (!preview) return;
    const anchor = preview.anchor; preview.remove(); preview = null;
    if (restoreFocus && anchor?.isConnected) anchor.focus();
  }
  function showSource(turn, ref, sources, anchor) {
    closePicker(); closePreview();
    const box = el('section', 'brevess-source-preview'); preview = box; box.anchor = anchor;
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', '引用来源');
    const head = el('div', 'brevess-compare-picker-head');
    const close = button('×', () => closePreview(true)); close.setAttribute('aria-label', '关闭引用来源');
    head.append(el('strong', '', '引用来源'), close);
    const title = el('div', 'brevess-source-title', ref.title);
    const pages = ref.target?.nativePdf?.pageNumbers;
    const page = pages?.length ? pages.join('、') : ref.target?.nativePdf?.pageNumber;
    let location = page ? 'PDF · 第 ' + page + ' 页' : ref.target?.nativePdf ? 'PDF' : '';
    if (!location) try { location = new URL(ref.sourceUrl).hostname; } catch {}
    const quote = String(ref.quote || ref.text || ''), context = String(ref.excerpt || quote);
    const body = el('blockquote', 'brevess-source-excerpt');
    const at = context.indexOf(quote);
    if (at >= 0 && quote) body.append(document.createTextNode(context.slice(0, at)), el('mark', '', quote), document.createTextNode(context.slice(at + quote.length)));
    else body.textContent = quote;
    const open = button('打开原文 ↗', () => { closePreview(); void locate(turn, ref, sources); }, 'brevess-source-open');
    box.append(head, title, el('small', '', location), body, open); document.body.append(box);
    const anchorRect = anchor.getBoundingClientRect();
    box.style.left = '12px'; box.style.right = '12px';
    box.style.top = Math.max(12, Math.min(anchorRect.bottom + 8, innerHeight - box.offsetHeight - 16)) + 'px';
    close.focus();
  }
  function turnCard(turn, s) {
    const card = el('article', 'article-chat-turn');
    card.dataset.compareTurn = turn.turnId;
    card.append(el('div', 'article-chat-message is-user article-chat-question', turn.question));
    card.append(createSaveQuestionButton(() => turn.question));
    const answer = el('div', 'article-chat-message is-assistant article-chat-answer');if(typeof articleChatResponseModelLabel==='function')answer.append(el('div','article-chat-answer-heading',articleChatResponseModelLabel(turn)));
    const sources = payload(s);
    const refs = (turn.multiSources || []).map(c => ({ ...c, marker: String(c.citation) }));
    const renderer = BrevessChatMessageUI.createRenderer({ createCitation: ref => {
      const b = button('[' + ref.citation + ']', () => showSource(turn, ref, sources, b), 'article-chat-inline-citation');
      b.title = ref.title + '\n' + ref.quote; b.setAttribute('aria-label', '原文 ' + ref.citation + ' · ' + ref.title); return b;
    } });
    const markdown = String(turn.answer || '').replace(/\[(\d+)\]/g, '[[$1]]');
    answer.append(renderer.renderArticleChatMarkdown(markdown || (turn.status === 'pending' ? '正在读取所选文献…' : errorText(turn.error || turn.status)), { evidence: refs }));
    const footer = el('div', 'brevess-compare-meta', '多文献问答' + (turn.model ? ' · ' + turn.model : ''));
    if (turn.coverage?.some(c=>Number.isInteger(c.availablePassages))) {
      const details=el('details','article-chat-source-details'), summary=el('summary','','正文来源 · '+turn.coverage.length);
      details.append(summary);for(const c of turn.coverage)details.append(el('div','',c.title+' · 已读 '+(c.reviewedPassages??c.readElements)+' / '+c.availablePassages+' 段'+((c.reviewedPassages||0)>c.readElements?' · 本轮作答选用 '+c.readElements+' 段':'')+(c.indexTruncated?' · 部分内容不可读':'')));answer.append(details);
    }
    if (turn.status === 'failed' || turn.status === 'cancelled') footer.append(button('重试', () => { input().value = turn.question; input().focus(); }));
    if (turn.status === 'complete') footer.append(button('复制', () => navigator.clipboard.writeText(turn.answer).catch(e => notice(e.message))));
    answer.append(footer); card.append(answer); return card;
  }
  function render() {
    if (rendering || !current || !form()) return;
    rendering = true;
    try {
      const s = current, f = form();
      let deck = f.querySelector('[data-compare-sources]');
      if (!deck) { deck = el('div', 'brevess-compare-chips'); deck.dataset.compareSources = ''; (f.querySelector('.wfg-composer-deck') || f).append(deck); }
      const signature = JSON.stringify([s.sources, s.busy, s.explicitSources]);
      if (deck.dataset.signature !== signature) {
        deck.dataset.signature = signature; deck.replaceChildren(); deck.hidden = !usesSelectedSources(s);
        if (usesSelectedSources(s)) for (const source of s.sources) {
          const chip = el('span', 'brevess-compare-chip');
          const label = el('span', '', '网页 ' + source.number + ' · ' + source.title); label.title = label.textContent;
          chip.append(label);
          const remove = button('×', () => { s.sources = s.sources.filter(t => t.id !== source.id); s.turns = []; s.notice = ''; closePreview(); render(); void history(s); });
          remove.disabled = s.busy; remove.setAttribute('aria-label', '移除网页 ' + source.number); remove.title = '移除网页 ' + source.number; chip.append(remove);
          deck.append(chip);
        }
      }
      let status = f.querySelector('[data-compare-status]');
      if (!status) { status = el('div', 'brevess-compare-status'); status.dataset.compareStatus = ''; status.setAttribute('role', 'status'); f.append(status); }
      const statusText = s.notice || '';
      if (status.dataset.text !== statusText + s.busy) { status.dataset.text = statusText + s.busy; status.replaceChildren(document.createTextNode(statusText)); if (s.busy) status.append(button('停止', () => void call('CANCEL'))); status.hidden = !statusText && !s.busy; }
      const log = document.getElementById('articleChatMessages');
      if (log) {
        let thread = log.querySelector('[data-compare-thread]');
        const sig = JSON.stringify([s.key, s.turns]);
        if (s.turns.length && (!thread || thread.dataset.signature !== sig)) {
          const next = el('section'); next.dataset.compareThread = ''; next.dataset.signature = sig;
          for (const turn of s.turns) next.append(turnCard(turn, s));
          const follow = s.scrollToLatest || log.scrollHeight - log.scrollTop - log.clientHeight < 100;
          if (thread) thread.replaceWith(next); else log.append(next);
          if (follow) { log.scrollTop = log.scrollHeight; s.scrollToLatest = false; }
        } else if (!s.turns.length) thread?.remove();
      }
    } finally { rendering = false; }
  }
  async function ask() {
    const s = current, question = input()?.value.trim();
    if (!s || s.busy || !question) return;
    if (typeof llmSettingsState === 'undefined' || llmSettingsState?.settings?.consentGranted !== true) { notice('请先在设置中配置模型并确认正文发送。'); return; }
    if (typeof articleChatContextScopes !== 'undefined' && articleChatContextScopes.size) { notice('跨文献问答使用所选文献，请先移除单篇章节限定。'); return; }
    const request = { ...payload(s), profileId: document.getElementById('articleChatProfile')?.value || '', question,
      attachments: typeof articleChatAttachments !== 'undefined' ? articleChatAttachments : [], requestId: crypto.randomUUID() };
    s.scrollToLatest = true; s.busy = true; s.notice = '正在比较 ' + s.sources.length + ' 篇文献'; s.requestId = request.requestId;
    const pending = { turnId: request.requestId, question, answer: '', status: 'pending' }; s.turns.push(pending);
    input().value = ''; closePicker(); render();
    try {
      const result = await call('ASK', request);
      s.turns = s.turns.filter(t => t !== pending).concat(result.turn); s.notice = '';
      if (typeof articleChatAttachments !== 'undefined' && articleChatAttachments === request.attachments) { articleChatAttachments = []; renderArticleChatAttachmentChips(); }
    } catch (e) { pending.status = 'failed'; pending.error = errorText(e); s.notice = ''; }
    finally { s.busy = false; render(); }
  }
  window.addEventListener('input', event => {
    if (event.target !== input() || event.isComposing || globalThis.WFGWorkflow?.isDisplay(form())) return;
    const field = event.target, at = field.selectionStart;
    if (field.value.slice(0, at).endsWith('@@')) {
      event.stopImmediatePropagation(); field.setRangeText('', at - 2, at, 'end');
      if (typeof closeArticleChatCommandMenu === 'function') closeArticleChatCommandMenu();
      void chooseSources();
    }
  }, true);
  window.addEventListener('keydown', event => {
    if (globalThis.WFGWorkflow?.isDisplay(form()) || document.getElementById('articleChatCommandMenu')?.hidden === false) return;
    if (event.target !== input() || !usesSelectedSources(current) || event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    event.preventDefault(); event.stopImmediatePropagation();
    form().requestSubmit();
  }, true);
  window.addEventListener('submit', event => {
    if (event.target !== form() || !usesSelectedSources(current) || globalThis.WFGWorkflow?.isDisplay(form())) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (globalThis.BrevessUnifiedComposer?.isEditing()) { notice('请先退出网页滤镜，再进行跨文献问答。'); return; }
    void ask();
  }, true);
  window.addEventListener('click', event => { if (event.target.closest?.('[data-add-sources]')) { event.preventDefault(); event.stopImmediatePropagation(); void chooseSources(); } }, true);
  document.addEventListener('pointerdown', event => { if (preview && !preview.contains(event.target) && !event.target.closest?.('.article-chat-inline-citation')) closePreview(); if (picker && !picker.contains(event.target)) { closePicker(); if (current) void history(current); } });
  document.addEventListener('keydown', event => { if (preview && event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); closePreview(true); } if (picker && event.key === 'Escape') { event.preventDefault(); closePicker(true); if (current) void history(current); } }, true);
  chrome.runtime.onMessage.addListener((m, sender) => {
    if (sender.id !== chrome.runtime.id || m?.type !== 'BREVESS_COMPARE_PROGRESS') return;
    const s = [...sessions.values()].find(s => s.busy && s.requestId === m.requestId); if (!s) return;
    const pending = s.turns.find(t => t.turnId === m.requestId);
    if (m.event?.type === 'public_summary') { s.notice = m.event.text; render(); }
    if (pending && m.event?.type === 'answer_preview') { pending.answer = String(m.event.text || '').slice(0,32768); render(); }
  });
  chrome.tabs.onActivated.addListener(() => void sync());
  chrome.tabs.onUpdated.addListener((id, change) => { if (id === current?.tabId && change.url) void sync(); });
  chrome.tabs.onRemoved.addListener(id => { for (const [key, s] of sessions) if (s.tabId === id) sessions.delete(key); });
  let queued = false;
  new MutationObserver(() => { if (queued) return; queued = true; queueMicrotask(() => { queued = false; render(); }); }).observe(document.documentElement, { childList: true, subtree: true });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => void sync()); else void sync();
})();
