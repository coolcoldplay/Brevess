const startButton = document.getElementById('startReading');
const pdfButton = document.getElementById('openPdf');
const historyButton = document.getElementById('openHistory');
const settingsButton = document.getElementById('openSettings');
const workbenchButton = document.getElementById('openWorkbench');
const pageTitle = document.getElementById('pageTitle');
const pageStatus = document.getElementById('pageStatus');
const root = document.querySelector('.action-popup');

let currentState = null;
let pageToolsBusy = false;
const toolInputs = {
  semantic: document.getElementById('toolSemantic'),
  selection: document.getElementById('toolSelection'),
  pageTranslation: document.getElementById('toolTranslation')
};
const searchPageButton = document.getElementById('openPageSearch');
const translatePageButton = document.getElementById('translatePage');
const toolsStatus = document.getElementById('pageToolsStatus');
function toolsNotice(message, tone = '') {
  if (!toolsStatus) return;
  toolsStatus.hidden = !message;
  toolsStatus.textContent = message;
  toolsStatus.dataset.tone = tone;
}
function showTranslationStatus(state) {
  if (!state?.enabled) return false;
  const count = state.total > 0 ? ` ${state.completed || 0}/${state.total}` : '';
  if (state.error) toolsNotice(state.error, 'error');
  else if (state.phase === 'awaiting-user') toolsNotice('请到网页中确认启用本地翻译。');
  else if (state.phase === 'complete' && state.total > 0) toolsNotice(`整页翻译完成${count} · 悬停译句可对照原文`);
  else if (state.phase === 'partial') toolsNotice(`整页翻译部分完成${count}`, 'error');
  else if (state.paused) toolsNotice(`整页翻译已暂停${count}`);
  else toolsNotice(`整页翻译中${count}`);
  return true;
}
function renderPageTools() {
  const state = currentState?.pageTools;
  for (const [key, input] of Object.entries(toolInputs)) {
    if (!input) continue;
    input.checked = state?.preferences?.[key] === true;
    input.disabled = !state?.supported || !currentState?.pageDocumentId || pageToolsBusy;
  }
  if (searchPageButton) searchPageButton.disabled = !state?.supported || !currentState?.pageDocumentId || !state.preferences.semantic || pageToolsBusy;
  if (translatePageButton) {
    translatePageButton.disabled = !state?.supported || !currentState?.pageDocumentId || !state.preferences.pageTranslation || pageToolsBusy;
    translatePageButton.title = state?.translation?.enabled ? '停止整页翻译' : '翻译当前页';
    translatePageButton.setAttribute('aria-label',translatePageButton.title);
    translatePageButton.setAttribute('aria-pressed',String(state?.translation?.enabled===true));
  }
  const shortcut = document.getElementById('semanticShortcut');
  if (shortcut) { shortcut.textContent = state?.shortcut || ''; shortcut.hidden = !state?.shortcut; }
}
async function pageToolAction(type, fields = {}) {
  if (pageToolsBusy || !currentState?.pageTools?.supported) return;
  actionsStarted++;
  pageToolsBusy = true;
  renderPageTools();
  toolsNotice('正在应用…');
  try {
    // Refresh the short-lived document receipt without redirecting an open popup
    // to a different active tab. The service also binds the actual document ID.
    const fresh = await runtimeMessage({ type: 'ACTION_POPUP_GET_STATE' });
    if (fresh.tabId !== currentState.tabId || fresh.pageDocumentId !== currentState.pageDocumentId || fresh.pageUrl !== currentState.pageUrl) throw new Error('当前网页已变化，请重新打开扩展菜单。');
    const data = await runtimeMessage({ type, tabId: currentState.tabId, nonce: fresh.nonce, ...fields });
    currentState = fresh;
    currentState.pageTools = { ...fresh.pageTools, ...data };
    if (type === 'PAGE_TOOLS_OPEN_SEARCH') { window.close(); return; }
    if (type === 'PAGE_TOOLS_TRANSLATE') {
      if (!showTranslationStatus(data.translation)) {
        toolsNotice(data.translation?.error || (fields.enabled ? '已启动整页翻译，可在网页中查看进度。' : '整页翻译已停止，已有译文保留。'), data.translation?.error ? 'error' : '');
      }
    } else toolsNotice('设置已保存；点击工具按钮或划选文字即可使用。');
  } catch (error) {
    try {
      const latest = await runtimeMessage({ type: 'ACTION_POPUP_GET_STATE' });
      if (latest.tabId === currentState.tabId && latest.pageDocumentId === currentState.pageDocumentId && latest.pageUrl === currentState.pageUrl) currentState = latest;
    } catch (_) { /* Keep the operation error visible. */ }
    toolsNotice(String(error?.message || '操作失败，请刷新网页后重试。'), 'error');
  } finally {
    pageToolsBusy = false;
    renderPageTools();
  }
}
for (const [tool, input] of Object.entries(toolInputs)) input?.addEventListener('change', () => {
  void pageToolAction('PAGE_TOOLS_SET', { tool, enabled: input.checked });
});
searchPageButton?.addEventListener('click', () => void pageToolAction('PAGE_TOOLS_OPEN_SEARCH'));
translatePageButton?.addEventListener('click', () => void pageToolAction('PAGE_TOOLS_TRANSLATE', {
  enabled: currentState?.pageTools?.translation?.enabled !== true
}));

chrome.runtime.onMessage?.addListener((message, sender) => {
  if (message?.type !== 'BREVESS_TRANSLATION_STATE' || !currentState?.pageDocumentId ||
      sender.tab?.id !== currentState.tabId || sender.documentId !== currentState.pageDocumentId || sender.frameId !== 0) return;
  if (currentState.pageTools) currentState.pageTools.translation = message.state;
  if (!pageToolsBusy) { renderPageTools(); showTranslationStatus(message.state); }
});

async function runtimeMessage(message) {
  if (['ACTION_POPUP_GET_STATE', 'QUICK_SETUP_OPEN'].includes(message.type)) {
    const owner = await chrome.windows.getCurrent();
    message = { ...message, windowId: owner.id };
  }
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, response => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        reject(new Error(lastError.message));
        return;
      }
      if (!response?.success) {
        const error = new Error(response?.error?.message || '操作失败');
        error.code = response?.error?.code || 'ACTION_POPUP_FAILED';
        reject(error);
        return;
      }
      resolve(response.data || {});
    });
  });
}

function setStatus(message, tone = '') {
  const normalized = String(message || '').trim();
  pageStatus.textContent = normalized;
  pageStatus.hidden = !normalized;
  if (tone) pageStatus.dataset.tone = tone;
  else delete pageStatus.dataset.tone;
}

function updatePrimaryLabel(label) {
  const strong = startButton.querySelector('strong');
  if (strong) strong.textContent = label;
}

let retryStateTimer, stateAttempt = 0, loadingState = false;
let actionsStarted = 0;
const warmDocument = new Set();

function refreshSoon() {
  clearTimeout(retryStateTimer);
  retryStateTimer = setTimeout(loadState, Math.min(200 * 2 ** Math.min(stateAttempt++, 4), 2500));
}

async function loadState() {
  if (loadingState) return;
  loadingState = true;
  try {
    const next = await runtimeMessage({ type: 'ACTION_POPUP_GET_STATE' });
    if (currentState && currentState.tabId !== next.tabId) { window.close(); return; }
    currentState = next;
    pageTitle.textContent = next.title || '当前页面';
    document.getElementById('resumeQuickSetup').hidden = !next.setupPending;
    startButton.classList.toggle('action-popup__button--primary', !next.setupPending);
    updatePrimaryLabel('侧栏打开工作台');
    startButton.disabled = !next.readable;
    if (next.pageTools?.supported && !next.pageDocumentId) {
      renderPageTools();
      setStatus('正在读取当前网页…');
      refreshSoon();
      return;
    }
    stateAttempt = 0;
    renderPageTools();
    setStatus('');
    if (!next.pageTools?.supported) {
      toolsNotice('请在普通网页使用；浏览器内部页面及 PDF 请使用对应阅读入口。');
      return;
    }
    if (!showTranslationStatus(next.pageTools.translation)) toolsNotice('');
    // A confirmed document and its saved preferences are enough to edit a switch.
    // Installing the content tools can continue while the popup remains interactive.
    const key = next.pageDocumentId + '|' + next.pageUrl;
    if (!warmDocument.has(key)) {
      warmDocument.add(key);
      const initialAction = actionsStarted;
      void runtimeMessage({ type: 'PAGE_TOOLS_APPLY', tabId: next.tabId, nonce: next.nonce }).catch(error => {
        warmDocument.delete(key);
        if (currentState === next && initialAction === actionsStarted)
          toolsNotice(String(error?.message || '网页工具未就绪。'), 'error');
      });
    }
  } catch (error) {
    if (!currentState) startButton.disabled = true;
    setStatus('正在等待当前网页…');
    refreshSoon();
  } finally {
    loadingState = false;
  }
}

chrome.tabs.onUpdated.addListener((id, change) => {
  if (currentState?.tabId === id && change.status === 'complete' && !currentState.pageDocumentId) refreshSoon();
});
window.addEventListener('pagehide', () => clearTimeout(retryStateTimer), { once: true });

startButton.addEventListener('click', () => {
  if (!currentState || startButton.disabled) return;
  startButton.disabled = true;
  root.classList.add('is-busy');
  setStatus('正在打开研读侧栏…');
  runtimeMessage({
    type: 'ACTION_POPUP_START_READING',
    tabId: currentState.tabId,
    nonce: currentState.nonce
  }).then(() => window.close()).catch(error => {
    root.classList.remove('is-busy');
    startButton.disabled = false;
    setStatus(String(error?.message || '无法打开研读侧栏。'), 'error');
  });
});

historyButton.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('options.html#page=data') });
});

pdfButton.addEventListener('click', () => {
  pdfButton.disabled = true;
  chrome.tabs.create({ url: chrome.runtime.getURL('pdf-reader.html') })
    .then(() => window.close())
    .catch(error => {
      pdfButton.disabled = false;
      setStatus(String(error?.message || '无法打开 PDF 阅读器。'), 'error');
    });
});

settingsButton.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('options.html#page=overview') });
});

workbenchButton.addEventListener('click', () => {
  workbenchButton.disabled = true;
  chrome.tabs.create({ url: chrome.runtime.getURL('workbench/index.html#library') })
    .then(() => window.close())
    .catch(error => {
      workbenchButton.disabled = false;
      setStatus(String(error?.message || '无法打开课题工作台。'), 'error');
    });
});

async function initializeActionPopup() {
  await globalThis.SciLLM?.bootstrapInterfaceLanguage?.();
  await loadState();
}

document.getElementById('resumeQuickSetup').addEventListener('click', () => {
  runtimeMessage({ type: 'QUICK_SETUP_OPEN' }).then(() => window.close()).catch(() => setStatus('请点击下方「打开设置」，再选「快速配置」。', 'error'));
});

document.getElementById('dismissPopup').addEventListener('click', () => window.close());
document.addEventListener('keydown', event => { if (event.key === 'Escape') window.close(); });
void initializeActionPopup();
