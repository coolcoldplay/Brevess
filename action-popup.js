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
  toolsStatus.textContent = message;
  toolsStatus.dataset.tone = tone;
}
function renderPageTools() {
  const state = currentState?.pageTools;
  for (const [key, input] of Object.entries(toolInputs)) {
    if (!input) continue;
    input.checked = state?.preferences?.[key] === true;
    input.disabled = !state?.supported || pageToolsBusy;
  }
  if (searchPageButton) searchPageButton.disabled = !state?.supported || !state.preferences.semantic || pageToolsBusy;
  if (translatePageButton) {
    translatePageButton.disabled = !state?.supported || !state.preferences.pageTranslation || pageToolsBusy;
    translatePageButton.textContent = state?.translation?.enabled ? '停止整页翻译' : '翻译当前页';
  }
  const shortcut = document.getElementById('semanticShortcut');
  if (shortcut) { shortcut.textContent = state?.shortcut || ''; shortcut.hidden = !state?.shortcut; }
}
async function pageToolAction(type, fields = {}) {
  if (pageToolsBusy || !currentState?.pageTools?.supported) return;
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
      const translation = data.translation;
      toolsNotice(translation?.error || (translation?.phase === 'awaiting-user' ? '请到网页中确认启用本地翻译。' :
        fields.enabled ? '已启动整页翻译，可在网页中查看进度。' : '整页翻译已停止，已有译文保留。'), translation?.error ? 'error' : '');
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

function runtimeMessage(message) {
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

async function loadState() {
  try {
    currentState = await runtimeMessage({ type: 'ACTION_POPUP_GET_STATE' });
    pageTitle.textContent = currentState.title || '当前页面';
    updatePrimaryLabel(currentState.primaryLabel || '开始研读');
    startButton.disabled = currentState.readable !== true;
    if (currentState.pageTools?.supported) {
      pageToolsBusy = true;
      try {
        await runtimeMessage({ type: 'PAGE_TOOLS_APPLY', tabId: currentState.tabId, nonce: currentState.nonce });
      } catch (error) {
        toolsNotice(String(error?.message || '工具未能加载，请刷新网页后重试。'), 'error');
        pageToolsBusy = false;
        renderPageTools();
        return;
      }
      pageToolsBusy = false;
    }
    renderPageTools();
    toolsNotice(currentState.pageTools?.supported ? '开启开关后，按需检索、划句或翻译。' : '请在普通网页使用；浏览器内部页面及 PDF 请使用对应阅读入口。');
    setStatus(currentState.readable
      ? ''
      : '当前页面暂不支持直接研读，仍可查看历史或设置。');
  } catch (error) {
    console.warn('Brevess action popup state unavailable', error);
    startButton.disabled = true;
    setStatus('暂时无法读取当前页面，请关闭后重试。', 'error');
  }
}

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
  chrome.tabs.create({ url: chrome.runtime.getURL('workbench/index.html') })
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

void initializeActionPopup();
