const startButton = document.getElementById('startReading');
const pdfButton = document.getElementById('openPdf');
const historyButton = document.getElementById('openHistory');
const settingsButton = document.getElementById('openSettings');
const pageTitle = document.getElementById('pageTitle');
const pageStatus = document.getElementById('pageStatus');
const root = document.querySelector('.action-popup');

let currentState = null;

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

async function initializeActionPopup() {
  await globalThis.SciLLM?.bootstrapInterfaceLanguage?.();
  await loadState();
}

void initializeActionPopup();
