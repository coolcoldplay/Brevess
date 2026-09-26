(() => {
  if (window.top !== window || globalThis.__sciPageLoadIndicator) return;
  globalThis.__sciPageLoadIndicator = true;
  const SETTLE_MS = 900;
  const ignored = '[data-sci-plugin-ui],[id^="sci-"],[id^="brevess-"],.sci-manual-note-marker,script,style,noscript,template,input,textarea,select,option,[contenteditable]:not([contenteditable="false"])';
  const marks = '.sci-highlight,.sci-llm-highlight,.sci-manual-highlight,.sci-manual-note-marker,.pdf-native-semantic-search-hit,.pdf-native-regex-hit,.pdf-native-automatic-hit';
  let enabled = false, busy = false, sequence = 0, settleTimer = null;
  const text = value => String(value || '').replace(/\s+/g, ' ').trim();
  function excluded(node) {
    const element = node?.nodeType === 1 ? node : node?.parentElement;
    return Boolean(element?.closest?.(ignored));
  }
  function relevant(record) {
    if (excluded(record.target)) return false;
    if (record.type === 'characterData') return text(record.oldValue) !== text(record.target.nodeValue);
    const added = Array.from(record.addedNodes).filter(node => !excluded(node));
    const removed = Array.from(record.removedNodes).filter(node => !excluded(node));
    const changed = [...added, ...removed];
    if (!changed.length) return false;
    return changed.some(node => node.nodeType === 1 || (node.nodeType === 3 && text(node.nodeValue)));
  }
  function annotationOnlyBatch(records, relevantRecords) {
    const containsMark = node => node?.nodeType === 1 && (node.matches(marks) || node.querySelector(marks));
    if (!records.some(record => record.target.parentElement?.closest(marks) ||
        (record.target.nodeType === 1 && record.target.matches(marks)) ||
        [...record.addedNodes, ...record.removedNodes].some(containsMark))) return false;
    // Range.extractContents/insertNode and normalize emit several records, including
    // text splits before the mark exists. Reconstruct their previous child/text
    // values virtually, without touching the live page or scanning it on normal edits.
    const childrenBefore = new Map(), textBefore = new Map();
    for (const record of [...records].reverse()) {
      if (record.type === 'characterData') { textBefore.set(record.target, record.oldValue || ''); continue; }
      const children = childrenBefore.get(record.target) || Array.from(record.target.childNodes);
      for (const node of record.addedNodes) { const index = children.indexOf(node); if (index >= 0) children.splice(index, 1); }
      let index = record.nextSibling ? children.indexOf(record.nextSibling) : -1;
      if (index < 0 && record.previousSibling) {
        const previous = children.indexOf(record.previousSibling);
        if (previous >= 0) index = previous + 1;
      }
      if (index < 0) index = children.length;
      children.splice(index, 0, ...record.removedNodes);
      childrenBefore.set(record.target, children);
    }
    let region = null;
    for (const record of relevantRecords) {
      const element = record.target.nodeType === 1 ? record.target : record.target.parentElement;
      if (!element?.isConnected) continue;
      if (!region) region = element;
      while (region && !region.contains(element)) region = region.parentElement;
    }
    if (!region) return false;
    function signature(before) {
      const parts = [], stack = [{ node: region }];
      while (stack.length) {
        const { node, close } = stack.pop();
        if (close) { parts.push(close); continue; }
        if (node.nodeType === 3) {
          parts.push(String(before && textBefore.has(node) ? textBefore.get(node) : node.nodeValue || '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));
          continue;
        }
        if (node.nodeType !== 1 || node.matches(ignored)) continue;
        if (!node.matches(marks)) {
          parts.push(`<${node.localName}>`); stack.push({ close: `</${node.localName}>` });
        }
        const children = before && childrenBefore.has(node) ? childrenBefore.get(node) : node.childNodes;
        for (let index = children.length - 1; index >= 0; index--) stack.push({ node: children[index] });
      }
      return text(parts.join(''));
    }
    return signature(true) === signature(false);
  }
  async function publish() {
    const currentSequence = ++sequence;
    try {
      const response = await chrome.runtime.sendMessage({ type: 'PAGE_LOAD_INDICATOR_STATE', sequence: currentSequence, busy: busy || document.readyState !== 'complete' });
      if (currentSequence !== sequence || !response?.success) return;
      setEnabled(response.active === true);
    } catch { setEnabled(false); }
  }
  function settle() {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => { busy = false; if (enabled) publish(); }, SETTLE_MS);
  }
  const observer = new MutationObserver(records => {
    if (!enabled) return;
    const relevantRecords = records.filter(relevant);
    if (!relevantRecords.length || annotationOnlyBatch(records, relevantRecords)) return;
    if (!busy) { busy = true; publish(); }
    settle();
  });
  function setEnabled(next) {
    if (enabled === next) return;
    enabled = next;
    observer.disconnect(); clearTimeout(settleTimer);
    busy = false;
    if (enabled) observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, characterDataOldValue: true });
  }
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.action !== 'setPageLoadIndicatorEnabled' || sender.id !== chrome.runtime.id || sender.tab) return;
    setEnabled(message.enabled === true);
    publish(); respond({ success: true });
    return false;
  });
  window.addEventListener('load', () => { if (enabled) publish(); });
  window.addEventListener('pagehide', () => { observer.disconnect(); clearTimeout(settleTimer); });
  window.addEventListener('pageshow', () => { setEnabled(false); publish(); });
  publish();
})();
