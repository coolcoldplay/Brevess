(function initializePdfReader() {
  const params = new URLSearchParams(location.search);
  const sourceUrl = SciLLM.normalizePdfSourceUrl(params.get('source'));
  const sourceTitle = String(params.get('title') || '').normalize('NFKC').trim();
  const isLocalSource = sourceUrl.startsWith('file:');
  const supplementalPdfBinding = SciLLM.readSupplementalPdfBinding(location.href);
  const state = {
    settings: SciLLM.normalizeMineruPdfSettings(),
    localFile: null,
    runId: 0,
    assetUrls: [],
    originalObjectUrl: '',
    quotaText: '',
    view: 'parsed',
    zoom: 1,
    jumpStack: [],
    workspaceSourceUrl: sourceUrl,
    localFileBytes: null,
    nativePdfBytesPromise: null,
    nativeFigureAbortController: null,
    translationClient: null,
    translationHandoffStarted: false
  };

  function element(id) {
    return document.getElementById(id);
  }

  const readerPreferenceKey = `brevess-pdf-reader:${
    SciLLM.stableHash?.(sourceUrl || location.href) || 'current'
  }`;

  function readReaderPreferences() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(readerPreferenceKey) || '{}');
      state.zoom = Math.max(0.75, Math.min(1.6, Number(saved.zoom) || 1));
      if (Number.isFinite(Number(saved.scrollY))) {
        requestAnimationFrame(() => globalThis.scrollTo({
          top: Math.max(0, Number(saved.scrollY)), behavior: 'auto'
        }));
      }
    } catch (_) {}
  }

  function saveReaderPreferences() {
    try {
      sessionStorage.setItem(readerPreferenceKey, JSON.stringify({
        zoom: state.zoom,
        scrollY: Math.max(0, Math.round(globalThis.scrollY || 0))
      }));
    } catch (_) {}
  }

  function currentReadingAnchor() {
    const toolbarBottom = element('pdfReaderWorkspace')?.getBoundingClientRect?.().top > 0
      ? 84 : 84;
    const candidate = document.elementFromPoint(
      Math.min(globalThis.innerWidth - 16, Math.max(16, globalThis.innerWidth * 0.58)),
      Math.min(globalThis.innerHeight - 16, toolbarBottom + 24)
    )?.closest?.('h1,h2,h3,h4,h5,h6,p,figure,table,li');
    return candidate ? {
      element: candidate,
      offset: candidate.getBoundingClientRect().top
    } : null;
  }

  function setReaderZoom(value, { preserveAnchor = true } = {}) {
    const anchor = preserveAnchor ? currentReadingAnchor() : null;
    state.zoom = Math.max(0.75, Math.min(1.6, Math.round(Number(value) * 20) / 20));
    document.documentElement.style.setProperty(
      '--pdf-font-size', `${Math.round(16 * state.zoom * 10) / 10}px`
    );
    document.documentElement.style.setProperty(
      '--pdf-page-width', `${Math.round(980 * state.zoom)}px`
    );
    element('pdfReaderZoomValue').textContent = `${Math.round(state.zoom * 100)}%`;
    saveReaderPreferences();
    if (anchor?.element?.isConnected) {
      requestAnimationFrame(() => {
        const delta = anchor.element.getBoundingClientRect().top - anchor.offset;
        if (Math.abs(delta) > 1) globalThis.scrollBy({ top: delta, behavior: 'auto' });
      });
    }
  }

  function flashJumpTarget(target) {
    target.classList.remove('pdf-reader-jump-flash');
    void target.offsetWidth;
    target.classList.add('pdf-reader-jump-flash');
    setTimeout(() => target.classList.remove('pdf-reader-jump-flash'), 1500);
  }

  function jumpToReaderTarget(target, { remember = true } = {}) {
    if (!target?.scrollIntoView) return false;
    if (remember) {
      state.jumpStack.push(Math.max(0, Math.round(globalThis.scrollY || 0)));
      state.jumpStack = state.jumpStack.slice(-20);
      element('pdfReaderJumpBack').hidden = false;
    }
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    flashJumpTarget(target);
    return true;
  }

  function safeReaderAnchorId(text, prefix, index) {
    const slug = String(text || '').normalize('NFKC').toLowerCase()
      .replace(/[^a-z0-9\u3400-\u9fff]+/g, '-')
      .replace(/^-+|-+$/g, '').slice(0, 54);
    return `${prefix}-${slug || index + 1}-${index + 1}`;
  }

  function installReaderControls() {
    readReaderPreferences();
    setReaderZoom(state.zoom, { preserveAnchor: false });
    element('pdfReaderZoomOut').addEventListener('click', () =>
      setReaderZoom(state.zoom - 0.1));
    element('pdfReaderZoomIn').addEventListener('click', () =>
      setReaderZoom(state.zoom + 0.1));
    element('pdfReaderZoomReset').addEventListener('click', () =>
      setReaderZoom(1));
    element('pdfReaderJumpBack').addEventListener('click', () => {
      const top = state.jumpStack.pop();
      if (!Number.isFinite(top)) return;
      globalThis.scrollTo({ top, behavior: 'smooth' });
      element('pdfReaderJumpBack').hidden = state.jumpStack.length === 0;
    });
    document.addEventListener('keydown', event => {
      if (!event.ctrlKey && !event.metaKey) return;
      if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        setReaderZoom(state.zoom + 0.1);
      } else if (event.key === '-') {
        event.preventDefault();
        setReaderZoom(state.zoom - 0.1);
      } else if (event.key === '0') {
        event.preventDefault();
        setReaderZoom(1);
      }
    });
    let saveTimer = null;
    globalThis.addEventListener('scroll', () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(saveReaderPreferences, 160);
    }, { passive: true });
    globalThis.addEventListener('beforeunload', saveReaderPreferences);
  }

  async function inlineTranslationPageImages(articleClone) {
    const images = Array.from(articleClone.querySelectorAll('img'));
    for (const image of images) {
      const source = String(image.getAttribute('src') || '');
      if (!source || /^data:image\//i.test(source) || /^https?:/i.test(source)) continue;
      try {
        const response = await fetch(source);
        if (!response.ok) continue;
        const blob = await response.blob();
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onerror = () => reject(reader.error || new Error('IMAGE_READ_FAILED'));
          reader.onload = () => resolve(String(reader.result || ''));
          reader.readAsDataURL(blob);
        });
        if (/^data:image\//i.test(dataUrl)) image.setAttribute('src', dataUrl);
      } catch (_) {
        image.removeAttribute('src');
      }
      image.removeAttribute('loading');
      image.removeAttribute('decoding');
    }
  }

  async function handoffToInlineTranslationPage() {
    if (state.translationHandoffStarted) return false;
    const article = element('pdfReaderArticle');
    if (!article?.querySelector?.('p,h1,h2,h3,h4,h5,h6')) return false;
    state.translationHandoffStarted = true;
    try {
      const clone = article.cloneNode(true);
      clone.querySelectorAll('[data-sci-plugin-ui]').forEach(node => node.remove());
      await inlineTranslationPageImages(clone);
      state.translationClient ||= SciLLM.createPdfFigureNativeClient(chrome.runtime);
      const result = await state.translationClient.publishTranslationPage({
        title: document.title || sourceTitle || 'Parsed PDF',
        articleHtml: clone.outerHTML,
        sourceUrl: workspaceSourceUrl(),
        timeoutMs: 60000
      });
      if (!/^http:\/\/127\.0\.0\.1:\d+\/brevess-pdf\/[a-f0-9]{48}$/.test(
        String(result?.url || '')
      )) throw new Error('PDF_TRANSLATION_URL_INVALID');
      document.documentElement.dataset.pdfTranslationReady = 'true';
      element('pdfReaderSubtitle').textContent = '正在进入可直接沉浸翻译的阅读视图…';
      globalThis.location.replace(result.url);
      return true;
    } catch (error) {
      state.translationHandoffStarted = false;
      document.documentElement.dataset.pdfTranslationError = String(
        error?.message || error || 'PDF_TRANSLATION_PAGE_FAILED'
      ).slice(0, 180);
      return false;
    }
  }

  function setProgress(percent, message, title = '') {
    const normalized = Math.min(100, Math.max(4, Number(percent) || 4));
    element('pdfReaderProgressBar').style.width = `${normalized}%`;
    if (message) element('pdfReaderStatus').textContent = message;
    if (title) element('pdfReaderStatusTitle').textContent = title;
  }

  function showReaderActions({
    retry = false,
    settings = false,
    localFallback = false
  } = {}) {
    element('pdfReaderRetry').hidden = !retry;
    element('pdfReaderOpenSettings').hidden = !settings;
    element('pdfLocalFileFallback').hidden = !localFallback;
  }

  async function openMineruSettings() {
    const currentTab = await chrome.tabs.getCurrent().catch(() => null);
    const url = new URL(chrome.runtime.getURL('options.html'));
    if (Number.isInteger(currentTab?.id)) {
      url.searchParams.set('returnPdfTab', String(currentTab.id));
    }
    url.hash = 'pdf-mineru';
    return chrome.tabs.create({ url: url.href });
  }

  async function returnToParentArticle() {
    const parentTabId = Number(supplementalPdfBinding?.parentTabId);
    const currentTab = await chrome.tabs.getCurrent().catch(() => null);
    const fallbackUrl = String(
      supplementalPdfBinding?.parentCanonicalUrl || ''
    ).trim();
    if (Number.isInteger(parentTabId) && parentTabId >= 0) {
      try {
        if (Number(currentTab?.id) === parentTabId && fallbackUrl) {
          await chrome.tabs.update(parentTabId, { url: fallbackUrl, active: true });
          return;
        }
        const parentTab = await chrome.tabs.get(parentTabId);
        await chrome.tabs.update(parentTabId, { active: true });
        if (Number.isInteger(parentTab?.windowId)) {
          await chrome.windows.update(parentTab.windowId, { focused: true });
        }
        return;
      } catch (_) {
        // The original tab may have been closed. Fall through to its canonical URL.
      }
    }
    if (fallbackUrl) {
      if (Number.isInteger(currentTab?.id)) {
        await chrome.tabs.update(currentTab.id, { url: fallbackUrl, active: true });
      } else {
        await chrome.tabs.create({ url: fallbackUrl });
      }
      return;
    }
    setProgress(
      100,
      '原论文标签页已经关闭，且没有可恢复的原文网址。',
      '无法返回原论文'
    );
  }

  async function syncParsedSupplementalInventory(parsedDocument = null) {
    if (!supplementalPdfBinding) return null;
    if (typeof globalThis.syncParsedSupplementalInventoryToParent === 'function') {
      const result = await globalThis.syncParsedSupplementalInventoryToParent(
        parsedDocument
      );
      if (result?.saved !== true) throw new Error('SUPPLEMENTAL_PARENT_SYNC_FAILED');
      return result;
    }
    const currentTab = await chrome.tabs.getCurrent().catch(() => null);
    if (!Number.isInteger(currentTab?.id)) return null;
    const response = await chrome.tabs.sendMessage(currentTab.id, {
      action: 'syncSupplementalFigureInventoryToParent',
      parsedDocument
    });
    if (!response?.success || response?.saved !== true) {
      throw new Error(response?.error || 'SUPPLEMENTAL_PARENT_SYNC_FAILED');
    }
    return response;
  }

  async function apiJson(url, options = {}) {
    const response = await fetch(url, options);
    let payload = null;
    try {
      payload = await response.json();
    } catch (_) {
      // Keep the HTTP status as the actionable error when the response is not JSON.
    }
    if (!response.ok || !payload || Number(payload.code) !== 0) {
      const error = new Error(
        String(payload?.msg || payload?.message || `MinerU HTTP ${response.status}`)
      );
      error.code = String(payload?.code ?? `HTTP_${response.status}`);
      throw error;
    }
    return payload.data || {};
  }

  function mineruRequestBody() {
    return {
      language: state.settings.language,
      enable_table: state.settings.enableTable,
      is_ocr: state.settings.isOcr,
      enable_formula: state.settings.enableFormula
    };
  }

  function fileNameForSource() {
    if (state.localFile?.name) return state.localFile.name;
    try {
      const name = decodeURIComponent(new URL(sourceUrl).pathname.split('/').pop() || '');
      return /\.pdf$/i.test(name) ? name : 'article.pdf';
    } catch (_) {
      return 'article.pdf';
    }
  }

  function workspaceSourceUrl() {
    return state.workspaceSourceUrl || sourceUrl;
  }

  async function prepareLocalPdfWorkspaceIdentity() {
    if (!(state.localFile instanceof Blob) || sourceUrl) return workspaceSourceUrl();
    const bytes = await state.localFile.arrayBuffer();
    state.localFileBytes = bytes;
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hash = Array.from(new Uint8Array(digest), value =>
      value.toString(16).padStart(2, '0')
    ).join('');
    state.workspaceSourceUrl = SciLLM.buildLocalPdfWorkspaceUrl(
      fileNameForSource(), hash
    );
    document.documentElement.dataset.pdfSourceUrl = state.workspaceSourceUrl;
    return state.workspaceSourceUrl;
  }

  async function uploadLocalFile(uploadUrl) {
    if (!(state.localFile instanceof Blob)) {
      throw new Error('PDF_LOCAL_FILE_MISSING');
    }
    // MinerU's signed OSS upload explicitly expects no Content-Type header.
    // Passing a File/Blob directly makes Chromium add its MIME type, which
    // causes the signed PUT to be aborted. ArrayBuffer preserves the exact
    // bytes without adding that header.
    const bytes = state.localFileBytes || await state.localFile.arrayBuffer();
    let response;
    try {
      response = await fetch(uploadUrl, { method: 'PUT', body: bytes });
    } finally {
      state.localFileBytes = null;
    }
    if (!response.ok) throw new Error(`PDF_UPLOAD_HTTP_${response.status}`);
  }

  function canRelayBrowserSessionSource() {
    return Boolean(
      supplementalPdfBinding?.sourceUrl &&
      Number.isInteger(supplementalPdfBinding?.parentTabId) &&
      supplementalPdfBinding.parentTabId >= 0
    );
  }

  async function uploadPdfSource(uploadUrl) {
    if (state.localFile instanceof Blob) {
      await uploadLocalFile(uploadUrl);
      return;
    }
    if (!canRelayBrowserSessionSource()) {
      throw Object.assign(new Error('PDF_BROWSER_SESSION_SOURCE_UNAVAILABLE'), {
        code: 'PDF_BROWSER_SESSION_SOURCE_UNAVAILABLE'
      });
    }
    setProgress(17, '正在使用当前出版社登录会话下载补充 PDF 并直传 MinerU…');
    const response = await chrome.runtime.sendMessage({
      type: 'PDF_BROWSER_SESSION_UPLOAD',
      sourceTabId: supplementalPdfBinding.parentTabId,
      sourceUrl: supplementalPdfBinding.sourceUrl,
      expectedParentUrl: supplementalPdfBinding.parentCanonicalUrl,
      uploadUrl,
      maxBytes: SciLLM.PDF_MINERU_MAX_FILE_BYTES
    });
    if (!response?.success) {
      const error = new Error(
        String(response?.error?.message || response?.error?.code || 'PDF_RELAY_FAILED')
      );
      error.code = String(response?.error?.code || 'PDF_RELAY_FAILED');
      error.details = response?.error?.details || null;
      throw error;
    }
  }

  async function readMineruUsageLedger() {
    const stored = await chrome.storage.local.get(SciLLM.PDF_MINERU_USAGE_KEY);
    return SciLLM.normalizeMineruUsageLedger(
      stored?.[SciLLM.PDF_MINERU_USAGE_KEY]
    );
  }

  async function recordCompletedMineruUsage(usage = null) {
    if (!usage?.taskId || !Number(usage.pages)) return readMineruUsageLedger();
    const current = await readMineruUsageLedger();
    const next = SciLLM.recordMineruUsage(current, usage);
    if (next.pagesUsed !== current.pagesUsed ||
        next.taskIds.length !== current.taskIds.length) {
      await chrome.storage.local.set({ [SciLLM.PDF_MINERU_USAGE_KEY]: next });
    }
    return next;
  }

  async function queryOfficialMineruQuota() {
    if (state.settings.mode !== 'precise' || !state.settings.token ||
        !state.settings.quotaUserId) return null;
    try {
      const data = await apiJson(`${SciLLM.PDF_MINERU_PRECISE_BASE}/quota`, {
        headers: {
          Authorization: `Bearer ${state.settings.token}`,
          token: state.settings.quotaUserId
        }
      });
      return SciLLM.normalizeMineruQuotaData(data);
    } catch (_) {
      return null;
    }
  }

  async function updateMineruQuotaStatus(usage = null) {
    const quotaNode = element('pdfMineruQuotaStatus');
    if (!quotaNode) return '';
    if (state.settings.mode !== 'precise') {
      state.quotaText = 'MinerU 轻量解析按 IP 限频，官方未提供实时剩余量。';
    } else {
      const ledger = await recordCompletedMineruUsage(usage);
      const official = await queryOfficialMineruQuota();
      if (official) {
        const parts = [];
        if (official.userLeftQuota !== null) {
          parts.push(`个人剩余 ${official.userLeftQuota} 页`);
        }
        if (official.totalLeftQuota !== null) {
          parts.push(`组织剩余 ${official.totalLeftQuota} 页`);
        }
        state.quotaText = `MinerU 官方额度：${parts.join(' · ')}（结果可能延迟更新）`;
      } else {
        const remaining = Math.max(
          0,
          SciLLM.PDF_MINERU_PRIORITY_PAGE_QUOTA - ledger.pagesUsed
        );
        state.quotaText =
          `MinerU 高优先级页额度估算：剩余 ${remaining}/` +
          `${SciLLM.PDF_MINERU_PRIORITY_PAGE_QUOTA} 页；今日本浏览器已解析 ` +
          `${ledger.pagesUsed} 页（不含其他设备或直接 API 调用）`;
      }
    }
    quotaNode.textContent = state.quotaText;
    quotaNode.hidden = false;
    return state.quotaText;
  }

  function originalPdfViewUrl() {
    if (state.localFile instanceof Blob) {
      if (!state.originalObjectUrl) {
        state.originalObjectUrl = URL.createObjectURL(state.localFile);
      }
      return state.originalObjectUrl;
    }
    return sourceUrl;
  }

  function setReaderView(view = 'parsed') {
    const next = view === 'original' ? 'original' : 'parsed';
    const viewer = element('pdfOriginalViewer');
    const frame = element('pdfOriginalFrame');
    const parsedPage = element('pdfReaderWorkspace');
    const control = element('pdfReaderControl');
    const toggle = element('pdfReaderViewToggle');
    const originalUrl = originalPdfViewUrl();
    if (next === 'original' && !originalUrl) return;
    state.view = next;
    document.body.dataset.pdfView = next;
    viewer.hidden = next !== 'original';
    parsedPage.hidden = next === 'original';
    control.hidden = next === 'original';
    if (next === 'original' && frame.src !== originalUrl) frame.src = originalUrl;
    toggle.textContent = next === 'original' ? '返回解析结果' : '查看原始 PDF';
    toggle.setAttribute('aria-pressed', String(next === 'original'));
  }

  function focusOriginalPdfPage(value) {
    const page = Math.max(1, Math.floor(Number(value) || 0));
    const originalUrl = originalPdfViewUrl();
    if (!originalUrl || !page) return false;
    setReaderView('original');
    const frame = element('pdfOriginalFrame');
    const pageUrl = `${String(originalUrl).replace(/#.*$/, '')}#page=${page}`;
    if (frame.src !== pageUrl) frame.src = pageUrl;
    return true;
  }

  async function loadOpenedLocalPdf() {
    if (!isLocalSource || state.localFile) return state.localFile;
    setProgress(7, '正在读取浏览器中已经打开的本地 PDF…', '正在准备本地 PDF');
    const blob = await new Promise((resolve, reject) => {
      const request = new XMLHttpRequest();
      request.open('GET', sourceUrl, true);
      request.responseType = 'blob';
      request.onload = () => {
        if ((request.status === 0 || request.status === 200) &&
            request.response instanceof Blob &&
            request.response.size > 0) {
          resolve(request.response);
          return;
        }
        reject(new Error(`PDF_LOCAL_FILE_HTTP_${request.status}`));
      };
      request.onerror = () => reject(new Error('PDF_LOCAL_FILE_ACCESS_REQUIRED'));
      request.send();
    });
    if (blob.size > 300 * 1024 * 1024) {
      throw new Error('PDF_LOCAL_FILE_TOO_LARGE');
    }
    state.localFile = new File(
      [blob],
      fileNameForSource(),
      { type: blob.type || 'application/pdf' }
    );
    return state.localFile;
  }

  function setPdfFigureEngineStatus(message = '', status = '') {
    const target = element('pdfFigureEngineStatus');
    if (!target) return;
    target.hidden = !message;
    target.textContent = String(message || '');
    if (status) target.dataset.state = status;
    else delete target.dataset.state;
  }

  async function pdfBytesForNativeFigures() {
    if (state.nativePdfBytesPromise) return state.nativePdfBytesPromise;
    state.nativePdfBytesPromise = (async () => {
      let bytes;
      if (state.localFile instanceof Blob) {
        bytes = new Uint8Array(
          state.localFileBytes || await state.localFile.arrayBuffer()
        );
      } else if (sourceUrl) {
        const response = await fetch(sourceUrl, {
          method: 'GET',
          credentials: 'include',
          cache: 'no-store',
          redirect: 'follow'
        });
        if (!response.ok) {
          const error = new Error(`PDF_FIGURE_SOURCE_HTTP_${response.status}`);
          error.code = `PDF_FIGURE_SOURCE_HTTP_${response.status}`;
          throw error;
        }
        const declared = Math.max(0, Number(response.headers.get('content-length')) || 0);
        if (declared > SciLLM.PDF_FIGURE_MAX_BYTES) {
          throw Object.assign(new Error('PDF_FIGURE_INPUT_TOO_LARGE'), {
            code: 'PDF_FIGURE_INPUT_TOO_LARGE'
          });
        }
        bytes = new Uint8Array(await response.arrayBuffer());
      } else {
        throw Object.assign(new Error('PDF_FIGURE_SOURCE_UNAVAILABLE'), {
          code: 'PDF_FIGURE_SOURCE_UNAVAILABLE'
        });
      }
      if (bytes.byteLength < 5 || bytes.byteLength > SciLLM.PDF_FIGURE_MAX_BYTES ||
          String.fromCharCode(...bytes.subarray(0, 5)) !== '%PDF-') {
        throw Object.assign(new Error('PDF_FIGURE_INPUT_INVALID'), {
          code: bytes.byteLength > SciLLM.PDF_FIGURE_MAX_BYTES
            ? 'PDF_FIGURE_INPUT_TOO_LARGE' : 'PDF_FIGURE_INPUT_INVALID'
        });
      }
      return bytes;
    })();
    try {
      return await state.nativePdfBytesPromise;
    } catch (error) {
      state.nativePdfBytesPromise = null;
      throw error;
    }
  }

  async function sha256PdfBytes(bytes) {
    const digest = await crypto.subtle.digest(
      'SHA-256',
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    );
    return Array.from(new Uint8Array(digest), value =>
      value.toString(16).padStart(2, '0')).join('');
  }

  function pdfFigureWorkspacePath(figure, index, mimeType) {
    const extension = /jpeg/i.test(mimeType) ? 'jpg'
      : /webp/i.test(mimeType) ? 'webp' : 'png';
    const slug = String(figure?.figureLabel || `figure-${index + 1}`)
      .normalize('NFKC').toLowerCase()
      .replace(/^figure\s+/, 'figure-')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || `figure-${index + 1}`;
    const kind = supplementalPdfBinding ? 'supplemental' : 'main';
    const materialPrefix = supplementalPdfBinding
      ? `supp-${String(SciLLM.stableHash?.(
        supplementalPdfBinding.materialId || sourceUrl || 'supplemental'
      ) || 'material').slice(0, 10)}-`
      : '';
    return `pdf/figures/${kind}/${materialPrefix}${slug}.${extension}`;
  }

  async function extractWholePdfFigures(runId) {
    let client;
    let taskId = '';
    let controller = null;
    try {
      client = SciLLM.createPdfFigureNativeClient(chrome.runtime);
      const health = await client.health({ timeoutMs: 15000 });
      if (!health?.available) {
        const error = new Error(String(health?.reason || 'PDF_FIGURE_ENGINE_UNAVAILABLE'));
        error.code = String(health?.reason || 'PDF_FIGURE_ENGINE_UNAVAILABLE');
        throw error;
      }
      if (runId !== state.runId) throw new DOMException('Superseded', 'AbortError');
      setPdfFigureEngineStatus('正在本机提取完整 Figure 与图注…');
      const pdfBytes = await pdfBytesForNativeFigures();
      const documentFingerprint = await sha256PdfBytes(pdfBytes);
      controller = new AbortController();
      state.nativeFigureAbortController?.abort?.();
      state.nativeFigureAbortController = controller;
      let result = null;
      for await (const event of client.extract({
        pdfBytes,
        documentFingerprint,
        fileName: fileNameForSource(),
        kind: supplementalPdfBinding ? 'supplemental' : 'main',
        signal: controller.signal
      })) {
        if (runId !== state.runId) {
          controller.abort();
          throw new DOMException('Superseded', 'AbortError');
        }
        if (event.type === 'result') {
          result = event;
          taskId = event.taskId;
        } else if (event.type === 'error') {
          const error = new Error(String(event.error?.message || 'PDF_FIGURE_EXTRACTION_FAILED'));
          error.code = String(event.error?.code || 'PDF_FIGURE_EXTRACTION_FAILED');
          throw error;
        } else if (event.type === 'cancelled') {
          throw new DOMException('Cancelled', 'AbortError');
        }
      }
      if (!result) throw Object.assign(new Error('PDF_FIGURE_RESULT_MISSING'), {
        code: 'PDF_FIGURE_RESULT_MISSING'
      });
      const imageByIndex = [];
      const runtimeImageByFigureIndex = [];
      const binaryAssets = [];
      for (let index = 0; index < result.figures.length; index += 1) {
        const raw = result.figures[index];
        const image = await client.readImage({
          taskId: result.taskId,
          imageId: raw.imageId,
          byteLength: raw.byteLength,
          sha256: raw.sha256,
          mimeType: raw.mimeType
        });
        const provisional = SciLLM.normalizePdffigures2Figure(raw, {
          kind: supplementalPdfBinding ? 'supplemental' : 'main',
          documentFingerprint,
          fallbackNumber: index + 1
        });
        const workspacePath = pdfFigureWorkspacePath(provisional, index, image.mimeType);
        const dataUrl = SciLLM.encodePdfImageDataUrl(image.bytes, image.mimeType);
        imageByIndex.push({
          mimeType: image.mimeType,
          sha256: image.sha256,
          workspacePath,
          imageFile: workspacePath.split('/').at(-1)
        });
        runtimeImageByFigureIndex.push(dataUrl);
        binaryAssets.push({
          relativePath: workspacePath,
          mimeType: image.mimeType,
          sha256: image.sha256,
          byteLength: image.bytes.byteLength,
          dataUrl
        });
      }
      const figures = SciLLM.normalizePdffigures2Figures(result.figures, {
        kind: supplementalPdfBinding ? 'supplemental' : 'main',
        documentFingerprint,
        extractorVersion: result.extractorVersion,
        imageByIndex
      });
      const runtimeImageByFigureId = {};
      figures.forEach(figure => {
        runtimeImageByFigureId[figure.figureId] =
          runtimeImageByFigureIndex[figure.sourceIndex] || '';
      });
      const manifest = SciLLM.createPdfFigureManifest(figures, {
        status: 'ready',
        documentFingerprint,
        extractorVersion: result.extractorVersion
      });
      setPdfFigureEngineStatus(
        `已在本机提取 ${figures.length} 张完整 Figure；MinerU 碎片图不会进入正文。`,
        'ready'
      );
      return { manifest, runtimeImageByFigureId, binaryAssets };
    } finally {
      if (taskId && client) await client.release(taskId).catch(() => undefined);
      client?.disconnect?.();
      if (state.nativeFigureAbortController === controller) {
        state.nativeFigureAbortController = null;
      }
    }
  }

  function wait(delayMs) {
    return new Promise(resolve => setTimeout(resolve, delayMs));
  }

  async function pollAgentTask(taskId, runId) {
    const startedAt = Date.now();
    for (let attempt = 0; attempt < 240; attempt += 1) {
      if (runId !== state.runId) throw new DOMException('Superseded', 'AbortError');
      const data = await apiJson(
        `${SciLLM.PDF_MINERU_AGENT_BASE}/parse/${encodeURIComponent(taskId)}`
      );
      if (data.state === 'done' && data.markdown_url) {
        setProgress(74, '版面解析完成，正在下载结构化正文与图片…');
        const response = await fetch(data.markdown_url);
        if (!response.ok) throw new Error(`PDF_MARKDOWN_HTTP_${response.status}`);
        return {
          markdown: await response.text(),
          markdownUrl: String(data.markdown_url),
          entries: null,
          markdownEntry: ''
        };
      }
      if (data.state === 'failed') {
        const error = new Error(String(data.err_msg || 'MinerU 轻量解析失败'));
        error.code = String(data.err_code || 'PDF_MINERU_AGENT_FAILED');
        throw error;
      }
      const elapsed = Math.round((Date.now() - startedAt) / 1000);
      const stage = data.state === 'uploading' ? '正在读取 PDF'
        : data.state === 'pending' ? '正在排队'
          : data.state === 'waiting-file' ? '等待文件上传' : '正在识别版面';
      setProgress(
        Math.min(68, 22 + attempt * 1.4),
        `${stage} · 已等待 ${elapsed} 秒；页面可以保持在后台`
      );
      await wait(Math.min(4000, 1500 + attempt * 100));
    }
    throw new Error('PDF_MINERU_TIMEOUT');
  }

  async function parseWithAgent(runId) {
    const body = mineruRequestBody();
    let taskId = '';
    if (state.localFile || canRelayBrowserSessionSource()) {
      setProgress(10, '正在申请 PDF 安全上传地址…');
      const created = await apiJson(`${SciLLM.PDF_MINERU_AGENT_BASE}/parse/file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, file_name: fileNameForSource() })
      });
      taskId = String(created.task_id || '');
      if (!taskId || !created.file_url) throw new Error('PDF_MINERU_UPLOAD_URL_MISSING');
      setProgress(17, '正在上传 PDF 到 MinerU…');
      await uploadPdfSource(created.file_url);
    } else {
      setProgress(10, '正在把 PDF 地址提交到 MinerU 轻量解析…');
      const created = await apiJson(`${SciLLM.PDF_MINERU_AGENT_BASE}/parse/url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...body,
          url: sourceUrl,
          file_name: fileNameForSource()
        })
      });
      taskId = String(created.task_id || '');
    }
    if (!taskId) throw new Error('PDF_MINERU_TASK_ID_MISSING');
    return pollAgentTask(taskId, runId);
  }

  function preciseHeaders() {
    if (!state.settings.token) {
      const error = new Error('精准解析需要先填写 MinerU Token');
      error.code = 'PDF_MINERU_TOKEN_REQUIRED';
      throw error;
    }
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${state.settings.token}`
    };
  }

  async function pollPreciseSingleTask(taskId, runId) {
    let observedPages = 0;
    for (let attempt = 0; attempt < 360; attempt += 1) {
      if (runId !== state.runId) throw new DOMException('Superseded', 'AbortError');
      const data = await apiJson(
        `${SciLLM.PDF_MINERU_PRECISE_BASE}/extract/task/${encodeURIComponent(taskId)}`,
        { headers: preciseHeaders() }
      );
      observedPages = Math.max(
        observedPages,
        Number(data?.extract_progress?.total_pages) ||
          Number(data?.page_count) || Number(data?.total_pages) || 0
      );
      if (data.state === 'done' && data.full_zip_url) {
        return {
          zipUrl: String(data.full_zip_url),
          taskId,
          pages: Math.max(
            0,
            observedPages
          )
        };
      }
      if (data.state === 'failed') {
        throw new Error(String(data.err_msg || 'MinerU 精准解析失败'));
      }
      updatePreciseProgress(data, attempt);
      await wait(Math.min(5000, 1800 + attempt * 120));
    }
    throw new Error('PDF_MINERU_TIMEOUT');
  }

  async function pollPreciseBatchTask(batchId, runId) {
    let observedPages = 0;
    for (let attempt = 0; attempt < 360; attempt += 1) {
      if (runId !== state.runId) throw new DOMException('Superseded', 'AbortError');
      const data = await apiJson(
        `${SciLLM.PDF_MINERU_PRECISE_BASE}/extract-results/batch/` +
          encodeURIComponent(batchId),
        { headers: preciseHeaders() }
      );
      const result = Array.isArray(data.extract_result) ? data.extract_result[0] : null;
      observedPages = Math.max(
        observedPages,
        Number(result?.extract_progress?.total_pages) ||
          Number(result?.page_count) || Number(result?.total_pages) || 0
      );
      if (result?.state === 'done' && result.full_zip_url) {
        return {
          zipUrl: String(result.full_zip_url),
          taskId: batchId,
          pages: Math.max(
            0,
            observedPages
          )
        };
      }
      if (result?.state === 'failed') {
        throw new Error(String(result.err_msg || 'MinerU 精准解析失败'));
      }
      updatePreciseProgress(result || {}, attempt);
      await wait(Math.min(5000, 1800 + attempt * 120));
    }
    throw new Error('PDF_MINERU_TIMEOUT');
  }

  function updatePreciseProgress(data, attempt) {
    const extracted = Number(data?.extract_progress?.extracted_pages) || 0;
    const total = Number(data?.extract_progress?.total_pages) || 0;
    const suffix = total > 0 ? ` · ${Math.min(extracted, total)}/${total} 页` : '';
    setProgress(
      Math.min(68, 20 + attempt * 0.8),
      `MinerU VLM 正在精准解析${suffix}；页面可以保持在后台`
    );
  }

  async function loadPreciseZip(zipUrl) {
    setProgress(74, '精准解析完成，正在读取 Markdown 与 Figure 图片…');
    const response = await fetch(zipUrl);
    if (!response.ok) throw new Error(`PDF_ZIP_HTTP_${response.status}`);
    const entries = await SciLLM.extractZipEntries(await response.arrayBuffer());
    const markdownEntry = SciLLM.selectMineruMarkdownEntry(entries);
    if (!markdownEntry) throw new Error('PDF_MARKDOWN_MISSING');
    const markdown = new TextDecoder('utf-8').decode(entries.get(markdownEntry));
    return { markdown, markdownUrl: zipUrl, entries, markdownEntry };
  }

  async function parseWithPrecise(runId) {
    const body = {
      ...mineruRequestBody(),
      model_version: 'vlm'
    };
    let completed = null;
    if (state.localFile || canRelayBrowserSessionSource()) {
      setProgress(10, '正在申请 MinerU 精准解析上传地址…');
      const created = await apiJson(
        `${SciLLM.PDF_MINERU_PRECISE_BASE}/file-urls/batch`,
        {
          method: 'POST',
          headers: preciseHeaders(),
          body: JSON.stringify({
            ...body,
            files: [{
              name: fileNameForSource(),
              data_id: `brevess_${Date.now()}`
            }]
          })
        }
      );
      const uploadUrl = Array.isArray(created.file_urls) ? created.file_urls[0] : '';
      if (!created.batch_id || !uploadUrl) {
        throw new Error('PDF_MINERU_UPLOAD_URL_MISSING');
      }
      setProgress(17, '正在上传 PDF 到 MinerU 精准解析…');
      await uploadPdfSource(uploadUrl);
      completed = await pollPreciseBatchTask(String(created.batch_id), runId);
    } else {
      setProgress(10, '正在把 PDF 地址提交到 MinerU VLM 精准解析…');
      const created = await apiJson(
        `${SciLLM.PDF_MINERU_PRECISE_BASE}/extract/task`,
        {
          method: 'POST',
          headers: preciseHeaders(),
          body: JSON.stringify({ ...body, url: sourceUrl })
        }
      );
      if (!created.task_id) throw new Error('PDF_MINERU_TASK_ID_MISSING');
      completed = await pollPreciseSingleTask(String(created.task_id), runId);
    }
    const parsed = await loadPreciseZip(completed?.zipUrl);
    parsed.mineruUsage = {
      taskId: completed?.taskId || '',
      pages: Math.max(0, Math.floor(Number(completed?.pages) || 0))
    };
    return parsed;
  }

  function revokeAssetUrls() {
    state.assetUrls.splice(0).forEach(url => URL.revokeObjectURL(url));
  }

  function remoteAssetUrl(reference, markdownUrl) {
    try {
      return new URL(String(reference || ''), markdownUrl).href;
    } catch (_) {
      return '';
    }
  }

  function imageUrlForBlock(block, parsed) {
    const reference = String(block?.source || '');
    const cachedSource = parsed?.cachedImageByReference?.[reference];
    if (/^data:image\//i.test(String(cachedSource || ''))) return cachedSource;
    if (/^(?:data:|blob:|https?:)/i.test(reference)) return reference;
    if (parsed.entries instanceof Map) {
      const entry = SciLLM.resolveMineruAssetEntry(
        parsed.entries,
        parsed.markdownEntry,
        reference
      );
      if (entry) {
        const url = URL.createObjectURL(new Blob(
          [parsed.entries.get(entry)],
          { type: SciLLM.mimeTypeForPdfAsset(entry) }
        ));
        state.assetUrls.push(url);
        return url;
      }
    }
    return remoteAssetUrl(reference, parsed.markdownUrl);
  }

  async function cacheRemoteParsedImages(parsed, runId) {
    if (parsed?.entries instanceof Map || parsed?.restored === true) return;
    const blocks = SciLLM.normalizePdfDocumentBlocks(
      SciLLM.markdownToPdfBlocks(parsed?.markdown || '')
    );
    if (!blocks.some(block => block.type === 'image')) return;
    setProgress(80, '正在将高清 Figure 缓存到本地工作区…');
    const cached = await SciLLM.buildRemotePdfImageCache(
      blocks,
      reference => remoteAssetUrl(reference, parsed?.markdownUrl),
      globalThis.fetch.bind(globalThis),
      { existing: parsed?.cachedImageByReference || {} }
    );
    if (runId !== state.runId) throw new DOMException('Superseded', 'AbortError');
    parsed.cachedImageByReference = {
      ...(parsed.cachedImageByReference || {}),
      ...cached.images
    };
  }

  function appendMarkdownInline(target, value) {
    const tokens = SciLLM.markdownInlineTokens?.(value) || [{
      type: 'text', text: SciLLM.normalizeScientificInline?.(value) || String(value || '')
    }];
    tokens.forEach(token => {
      let node = null;
      if (token.type === 'strong') node = document.createElement('strong');
      else if (token.type === 'emphasis') node = document.createElement('em');
      else if (token.type === 'code') node = document.createElement('code');
      else if (token.type === 'superscript') node = document.createElement('sup');
      else if (token.type === 'subscript') node = document.createElement('sub');
      else if (token.type === 'link' && token.href) {
        node = document.createElement('a');
        node.href = token.href;
        node.target = '_blank';
        node.rel = 'noreferrer';
      }
      if (!node) {
        target.appendChild(document.createTextNode(token.text));
        return;
      }
      node.textContent = token.text;
      target.appendChild(node);
    });
  }

  function renderParsedDocument(parsed) {
    const mineruBlocks = SciLLM.cleanPdfReflowBlocks(
      SciLLM.normalizePdfDocumentBlocks(
        SciLLM.markdownToPdfBlocks(parsed.markdown)
      )
    );
    const nativeManifest = parsed?.pdfFigureManifest &&
      parsed.pdfFigureManifest.status === 'ready'
      ? parsed.pdfFigureManifest : null;
    const nativeFigures = Array.isArray(nativeManifest?.figures)
      ? nativeManifest.figures : [];
    const nativePlan = nativeFigures.length
      ? SciLLM.buildPdfFigureArticlePlan(mineruBlocks, nativeFigures)
      : null;
    const blocks = nativePlan?.blocks || mineruBlocks;
    const captionPairs = nativePlan ? [] : SciLLM.buildPdfFigureSemanticCaptions(
      blocks,
      SciLLM.associatePdfFigureCaptions(blocks)
    );
    const figureGroups = nativePlan ? [] : SciLLM.buildPdfFigureGroups(blocks, captionPairs);
    const figureGroupByAnchor = new Map(
      figureGroups.map(group => [group.anchorIndex, group])
    );
    const groupedBlockIndices = new Set(
      figureGroups.flatMap(group => group.consumedBlockIndices || [])
    );
    const nativeFiguresByAnchor = new Map();
    (nativePlan?.figures || []).forEach(figure => {
      const anchor = Math.max(0, Math.min(blocks.length, Number(figure.anchorIndex) || 0));
      const values = nativeFiguresByAnchor.get(anchor) || [];
      values.push(figure);
      nativeFiguresByAnchor.set(anchor, values);
    });
    const article = element('pdfReaderArticle');
    article.replaceChildren();
    article.dataset.brevessPdfArticle = 'true';
    article.setAttribute('data-article-body', 'true');
    revokeAssetUrls();
    const fallbackTitle = sourceTitle.replace(/\.pdf.*$/i, '') ||
      fileNameForSource().replace(/\.pdf$/i, '');
    const title = SciLLM.pdfDocumentTitle(blocks, fallbackTitle) || 'PDF 文献';
    const hasDocumentHeading = blocks.some(block =>
      block.type === 'heading' && !SciLLM.isPdfFigureCaptionText(block.text) &&
      block.text === title
    );
    if (!hasDocumentHeading) {
      const documentHeading = document.createElement('h1');
      documentHeading.dataset.brevessDocumentTitle = 'true';
      documentHeading.textContent = title;
      article.appendChild(documentHeading);
    }

    function renderNativeFiguresAt(anchorIndex) {
      (nativeFiguresByAnchor.get(anchorIndex) || []).forEach((nativeFigure, index) => {
        const figure = document.createElement('figure');
        figure.dataset.brevessPdfFigure = 'true';
        figure.dataset.pdfFigureSource = 'pdffigures2';
        figure.dataset.figureId = String(nativeFigure.figureId || '');
        figure.dataset.figureLabel = String(nativeFigure.figureLabel || '');
        figure.dataset.pdfPageIndex = String(Math.max(0, Number(nativeFigure.pageIndex) || 0));
        const plate = document.createElement('div');
        plate.className = 'pdf-reader-figure-plate';
        plate.dataset.imageCount = '1';
        const imageSource = String(
          parsed?.runtimeImageByFigureId?.[nativeFigure.figureId] || ''
        );
        if (imageSource) {
          const image = document.createElement('img');
          image.src = imageSource;
          image.alt = String(nativeFigure.figureLabel || `PDF Figure ${index + 1}`);
          image.loading = anchorIndex < 8 ? 'eager' : 'lazy';
          image.decoding = 'async';
          image.dataset.pdfWholeFigure = 'true';
          image.dataset.pdfFigureAssetPath = String(
            nativeFigure.image?.workspacePath || ''
          );
          image.dataset.pdfFigureSha256 = String(nativeFigure.image?.sha256 || '');
          plate.appendChild(image);
        }
        const caption = document.createElement('figcaption');
        caption.textContent = nativeFigure.caption || nativeFigure.figureLabel || '';
        caption.dataset.brevessFigureCaption = 'true';
        figure.id = String(nativeFigure.figureId || '') || safeReaderAnchorId(
          nativeFigure.figureLabel,
          'pdf-figure',
          anchorIndex + index
        );
        figure.append(plate, caption);
        article.appendChild(figure);
      });
    }

    let paragraphIndex = 0;
    blocks.forEach((block, blockIndex) => {
      renderNativeFiguresAt(blockIndex);
      if (nativePlan?.consumedCaptionIndices?.has(blockIndex)) return;
      const figureGroup = figureGroupByAnchor.get(blockIndex);
      if (figureGroup) {
        const figure = document.createElement('figure');
        figure.dataset.brevessPdfFigure = 'true';
        const plate = document.createElement('div');
        plate.className = 'pdf-reader-figure-plate';
        plate.dataset.imageCount = String(figureGroup.imageIndices.length);
        const panelHints = typeof SciLLM.extractPanelHints === 'function'
          ? SciLLM.extractPanelHints(figureGroup.caption) : [];
        figureGroup.imageIndices.forEach((imageIndex, imageOrdinal) => {
          const imageBlock = blocks[imageIndex];
          const imageSource = imageUrlForBlock(imageBlock, parsed);
          if (!imageSource && parsed?.restored === true) return;
          const image = document.createElement('img');
          image.src = imageSource;
          image.alt = imageBlock?.alt ||
            `${String(figureGroup.caption || 'PDF Figure').split(/[\r\n]/, 1)[0]} · ${imageOrdinal + 1}`;
          image.loading = imageOrdinal === 0 ? 'eager' : 'lazy';
          image.decoding = 'async';
          image.dataset.pdfImageBlock = String(imageIndex);
          if (panelHints.length === figureGroup.imageIndices.length) {
            image.dataset.panel = panelHints[imageOrdinal];
            image.alt = `${String(figureGroup.caption || 'PDF Figure')
              .split(/[\r\n.。]/, 1)[0]} · Panel ${panelHints[imageOrdinal]}`;
          }
          plate.appendChild(image);
        });
        const caption = document.createElement('figcaption');
        caption.textContent = figureGroup.caption || '';
        caption.dataset.brevessFigureCaption = 'true';
        figure.id = safeReaderAnchorId(
          figureGroup.caption,
          'pdf-figure',
          figureGroup.groupIndex
        );
        figure.append(plate, caption);
        article.appendChild(figure);
        return;
      }
      if (groupedBlockIndices.has(blockIndex)) return;
      if (block.type === 'image') {
        const imageSource = imageUrlForBlock(block, parsed);
        if (!imageSource && parsed?.restored === true) return;
        const wrapper = document.createElement('div');
        wrapper.className = 'pdf-reader-inline-asset';
        const image = document.createElement('img');
        image.src = imageSource;
        image.alt = block.alt || 'PDF 插图';
        image.loading = 'lazy';
        image.decoding = 'async';
        wrapper.appendChild(image);
        article.appendChild(wrapper);
        return;
      }
      if (block.type === 'heading') {
        const heading = document.createElement(`h${block.level}`);
        appendMarkdownInline(heading, block.markdown || block.text);
        heading.id = safeReaderAnchorId(block.text, 'pdf-section', blockIndex);
        if (!SciLLM.isPdfFigureCaptionText(block.text) && block.text === title) {
          heading.dataset.brevessDocumentTitle = 'true';
        }
        article.appendChild(heading);
      } else if (block.type === 'code') {
        const pre = document.createElement('pre');
        pre.textContent = block.text;
        article.appendChild(pre);
      } else if (block.type === 'list') {
        const list = document.createElement(block.ordered ? 'ol' : 'ul');
        (block.items || []).forEach(item => {
          const listItem = document.createElement('li');
          appendMarkdownInline(listItem, item.markdown || item.text);
          list.appendChild(listItem);
        });
        article.appendChild(list);
      } else if (block.type === 'blockquote') {
        const quote = document.createElement('blockquote');
        appendMarkdownInline(quote, block.markdown || block.text);
        article.appendChild(quote);
      } else if (block.type === 'table') {
        const table = document.createElement('table');
        const header = document.createElement('thead');
        const headerRow = document.createElement('tr');
        (block.header || []).forEach(value => {
          const cell = document.createElement('th');
          appendMarkdownInline(cell, value);
          headerRow.appendChild(cell);
        });
        header.appendChild(headerRow);
        const body = document.createElement('tbody');
        (block.rows || []).forEach(row => {
          const tableRow = document.createElement('tr');
          row.forEach(value => {
            const cell = document.createElement('td');
            appendMarkdownInline(cell, value);
            tableRow.appendChild(cell);
          });
          body.appendChild(tableRow);
        });
        table.append(header, body);
        article.appendChild(table);
      } else if (block.type === 'divider') {
        article.appendChild(document.createElement('hr'));
      } else {
        const paragraph = document.createElement('p');
        appendMarkdownInline(paragraph, block.markdown || block.text);
        paragraph.id = `pdf-paragraph-${++paragraphIndex}`;
        paragraph.dataset.pdfParagraphIndex = String(paragraphIndex);
        article.appendChild(paragraph);
      }
    });
    renderNativeFiguresAt(blocks.length);

    if (!article.querySelector('p, h1, h2, h3, h4, h5, h6')) {
      throw new Error('PDF_MARKDOWN_EMPTY');
    }
    document.title = title;
    element('pdfReaderSubtitle').textContent = `${title} · PDF 解析工作区`;
    document.documentElement.dataset.pdfWorkspaceRendered = 'true';
    document.documentElement.dataset.pdfWorkspaceReady = 'false';
    document.documentElement.dataset.pdfSourceUrl = workspaceSourceUrl();
    setProgress(100, 'PDF 正文与 Figure 已准备完成。', '解析完成');
    element('pdfReaderControl').dataset.state = 'ready';
    element('pdfReaderViewToggle').hidden = !originalPdfViewUrl();
    element('pdfReaderReparse').hidden = false;
    setReaderView('parsed');
    const requestedHashTarget = document.getElementById(
      decodeURIComponent(String(location.hash || '').replace(/^#/, ''))
    );
    if (requestedHashTarget) requestAnimationFrame(() =>
      jumpToReaderTarget(requestedHashTarget, { remember: false })
    );
    chrome.runtime.sendMessage({
      type: 'PDF_WORKSPACE_READY',
      sourceUrl: workspaceSourceUrl(),
      title,
      paragraphCount: article.querySelectorAll('p').length,
      figureCount: article.querySelectorAll('figure[data-brevess-pdf-figure]').length,
      mineruQuotaText: state.quotaText
    }).catch(() => undefined);
    const cachedImages = SciLLM.buildPersistablePdfImageCache?.(
      blocks,
      parsed.entries,
      parsed.markdownEntry,
      parsed.cachedImageByReference
    ) || { images: {}, cachedImageCount: 0, omittedImageCount: 0, cachedBytes: 0 };
    Object.entries(parsed?.runtimeImageByFigureId || {}).forEach(([figureId, dataUrl]) => {
      if (/^data:image\//i.test(String(dataUrl || ''))) {
        cachedImages.images[`brevess-pdffigures2:${figureId}`] = dataUrl;
      }
    });
    cachedImages.cachedImageCount = Object.keys(cachedImages.images).length;
    setTimeout(() => {
      void globalThis.refreshParsedPdfWorkspace?.({
        title,
        sourceUrl,
        markdown: String(parsed.markdown || ''),
        paragraphCount: article.querySelectorAll('p').length,
        figureCount: article.querySelectorAll('figure[data-brevess-pdf-figure]').length,
        cachedImageByReference: cachedImages.images,
        cachedImageCount: cachedImages.cachedImageCount,
        omittedImageCount: cachedImages.omittedImageCount,
        cachedImageBytes: cachedImages.cachedBytes,
        pdfFigureManifest: nativeManifest,
        pdfFigureBinaryAssets: Array.isArray(parsed?.pdfFigureBinaryAssets)
          ? parsed.pdfFigureBinaryAssets : []
      }).then(() => {
        if (!supplementalPdfBinding) return handoffToInlineTranslationPage();
        return false;
      }).catch(error => {
        document.documentElement.dataset.pdfWorkspaceIndexError = String(
          error?.message || error || 'PDF_WORKSPACE_INDEX_FAILED'
        ).slice(0, 180);
      });
    }, 0);
    if (supplementalPdfBinding) {
      // Parsing is the import boundary. Sync the complete inventory now so the
      // parent article can show and analyze supplemental figures immediately;
      // later Figure analyses overwrite the same asset with richer results.
      setTimeout(() => {
        void syncParsedSupplementalInventory({
          schemaVersion: 1,
          title,
          fileName: fileNameForSource(),
          markdown: String(parsed.markdown || ''),
          imageReferences: blocks
            .filter(block => block.type === 'image')
            .map(block => String(block.source || ''))
            .filter(Boolean),
          pdfFigureManifest: nativeManifest,
          pdfFigureBinaryAssets: Array.isArray(parsed?.pdfFigureBinaryAssets)
            ? parsed.pdfFigureBinaryAssets : [],
          savedAt: new Date().toISOString()
        }).then(() => {
          document.documentElement.dataset.pdfSupplementalSync = 'synced';
          return handoffToInlineTranslationPage();
        }).catch(error => {
          document.documentElement.dataset.pdfSupplementalSync = 'error';
          document.documentElement.dataset.pdfSupplementalSyncError = String(
            error?.message || error || 'SUPPLEMENTAL_PARENT_SYNC_FAILED'
          ).slice(0, 200);
          console.warn('Brevess: 补充图目录同步失败', error?.message || error);
        });
      }, 0);
    }
  }

  async function restoreCachedPdfDocument() {
    if (supplementalPdfBinding ||
        typeof globalThis.getWorkspaceAssetCheckpoint !== 'function') return false;
    try {
      const asset = await globalThis.getWorkspaceAssetCheckpoint('pdf/document.json');
      const saved = asset?.content && typeof asset.content === 'object'
        ? asset.content : null;
      const markdown = String(saved?.markdown || '').trim();
      if (!markdown) return false;
      const savedSource = SciLLM.normalizePdfSourceUrl(saved?.sourceUrl);
      if (savedSource && sourceUrl && savedSource !== sourceUrl) return false;
      const pdfFigureManifest = saved?.pdfFigureManifest &&
        typeof saved.pdfFigureManifest === 'object'
        ? saved.pdfFigureManifest : null;
      const runtimeImageByFigureId = {};
      Object.entries(saved.cachedImageByReference || {}).forEach(([reference, dataUrl]) => {
        const match = String(reference).match(/^brevess-pdffigures2:(.+)$/);
        if (match && /^data:image\//i.test(String(dataUrl || ''))) {
          runtimeImageByFigureId[match[1]] = String(dataUrl);
        }
      });
      if (pdfFigureManifest &&
          Object.keys(runtimeImageByFigureId).length < Number(pdfFigureManifest.figureCount || 0) &&
          typeof globalThis.restorePdfFigureBinaryAssets === 'function') {
        Object.assign(
          runtimeImageByFigureId,
          await globalThis.restorePdfFigureBinaryAssets(pdfFigureManifest).catch(() => ({}))
        );
      }
      renderParsedDocument({
        markdown,
        markdownUrl: '',
        entries: null,
        markdownEntry: '',
        cachedImageByReference: saved.cachedImageByReference || {},
        pdfFigureManifest,
        runtimeImageByFigureId,
        restored: true
      });
      if (SciLLM.pdfFigureManifestNeedsRefresh?.(pdfFigureManifest)) {
        document.documentElement.dataset.pdfFigureCacheUpgrade = 'pending';
        setTimeout(() => {
          void refreshCachedNativeFigures(saved).catch(() => undefined);
        }, 0);
      }
      document.documentElement.dataset.pdfWorkspaceRestored = 'true';
      setProgress(
        100,
        `已从本地论文工作区恢复正文、分层大纲与 ${Number(saved.figureCount) || 0} 张完整 Figure。`,
        '已恢复解析结果'
      );
      if (pdfFigureManifest?.figureCount) {
        setPdfFigureEngineStatus(
          `已从论文工作区恢复 ${Number(pdfFigureManifest.figureCount) || 0} 张完整 Figure。`,
          'ready'
        );
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  async function refreshCachedNativeFigures(saved) {
    const markdown = String(saved?.markdown || '').trim();
    if (!markdown) return false;
    const runId = ++state.runId;
    try {
      if (isLocalSource && !state.localFile) await loadOpenedLocalPdf();
      state.nativePdfBytesPromise = null;
      setPdfFigureEngineStatus(
        '正在用新版完整图引擎升级旧缓存；正文不会重新发送到 MinerU…'
      );
      const nativeFigures = await extractWholePdfFigures(runId);
      if (runId !== state.runId || !nativeFigures?.manifest?.figureCount) return false;
      renderParsedDocument({
        markdown,
        markdownUrl: '',
        entries: null,
        markdownEntry: '',
        cachedImageByReference: saved.cachedImageByReference || {},
        pdfFigureManifest: nativeFigures.manifest,
        runtimeImageByFigureId: nativeFigures.runtimeImageByFigureId,
        pdfFigureBinaryAssets: nativeFigures.binaryAssets,
        restored: true
      });
      document.documentElement.dataset.pdfFigureCacheUpgrade = 'complete';
      setProgress(
        100,
        `旧缓存已就地升级为 ${Number(nativeFigures.manifest.figureCount) || 0} 张完整 Figure；正文未重新解析。`,
        '本地缓存已升级'
      );
      return true;
    } catch (error) {
      if (runId !== state.runId || error?.name === 'AbortError') return false;
      document.documentElement.dataset.pdfFigureCacheUpgrade = 'deferred';
      document.documentElement.dataset.pdfFigureCacheUpgradeError = String(
        error?.code || error?.message || 'PDF_FIGURE_CACHE_UPGRADE_FAILED'
      ).slice(0, 160);
      setPdfFigureEngineStatus(
        '已保留原缓存；新版完整图可在本地伴侣可用后再自动升级。',
        'fallback'
      );
      return false;
    }
  }

  async function getCachedSupplementalAsset() {
    if (!supplementalPdfBinding) return null;
    const response = await chrome.runtime.sendMessage({
      type: 'ARTICLE_WORKSPACE_GET_ASSET',
      workspaceId: supplementalPdfBinding.parentWorkspaceId,
      relativePath: SciLLM.supplementalFigureAssetPath(
        supplementalPdfBinding.materialId
      )
    }).catch(() => null);
    return response?.success ? response.data?.asset?.content || null : null;
  }

  async function restoreSupplementalPdfFigureBinaryAssets(manifest) {
    const figures = Array.isArray(manifest?.figures) ? manifest.figures : [];
    const workspaceId = String(supplementalPdfBinding?.parentWorkspaceId || '');
    if (!workspaceId || !figures.length) return {};
    const restored = {};
    for (const figure of figures.slice(0, 300)) {
      const relativePath = String(figure?.image?.workspacePath || '');
      if (!figure?.figureId ||
          !/^pdf\/figures\/supplemental\/[^/]+\.(?:png|jpe?g|webp)$/i.test(relativePath)) {
        continue;
      }
      const response = await chrome.runtime.sendMessage({
        type: 'ARTICLE_WORKSPACE_GET_BINARY_ASSET',
        workspaceId,
        relativePath,
        mimeType: String(figure?.image?.mimeType || 'image/png')
      }).catch(() => null);
      if (!response?.success || !response.data?.found ||
          !/^data:image\//i.test(String(response.data.dataUrl || ''))) continue;
      const expectedHash = String(figure?.image?.sha256 || '').toLowerCase();
      if (expectedHash && String(response.data.sha256 || '').toLowerCase() !== expectedHash) {
        continue;
      }
      restored[String(figure.figureId)] = String(response.data.dataUrl);
    }
    return restored;
  }

  function reconstructedSupplementalMarkdown(asset) {
    const figures = Array.isArray(asset?.figures) ? asset.figures : [];
    const lines = [`# ${String(asset?.title || sourceTitle || '补充材料')}`, ''];
    const imageReferences = [];
    const cachedImageByReference = {};
    figures.forEach((figure, index) => {
      const label = String(figure?.figureLabel || `Figure S${index + 1}`);
      const reference = `brevess-restored-figure-${index + 1}.jpg`;
      const image = (Array.isArray(figure?.analysisImages)
        ? figure.analysisImages : []).find(candidate =>
        /^data:image\//i.test(String(candidate?.dataUrl || ''))
      );
      if (image?.dataUrl) {
        lines.push(`![${label}](${reference})`, '');
        imageReferences.push(reference);
        cachedImageByReference[reference] = image.dataUrl;
      }
      const caption = String(figure?.caption || '').trim();
      lines.push(`## ${label}${caption ? `. ${caption}` : ''}`, '');
      (Array.isArray(figure?.captionBlocks) ? figure.captionBlocks : [])
        .filter(block => String(block?.text || '').trim())
        .forEach(block => lines.push(String(block.text).trim(), ''));
    });
    return {
      markdown: lines.join('\n'),
      imageReferences,
      cachedImageByReference
    };
  }

  async function restoreCachedSupplementalDocument() {
    const asset = await getCachedSupplementalAsset();
    if (!asset) return false;
    const saved = asset.parsedDocument && typeof asset.parsedDocument === 'object'
      ? asset.parsedDocument : null;
    const reconstructed = reconstructedSupplementalMarkdown(asset);
    const markdown = String(saved?.markdown || reconstructed.markdown || '').trim();
    if (!markdown) return false;
    const cachedImageByReference = { ...reconstructed.cachedImageByReference };
    const assetFigures = Array.isArray(asset.figures) ? asset.figures : [];
    const pdfFigureManifest = saved?.pdfFigureManifest &&
      saved.pdfFigureManifest.source === 'pdffigures2' &&
      Array.isArray(saved.pdfFigureManifest.figures)
      ? saved.pdfFigureManifest : null;
    const runtimeImageByFigureId = {};
    (pdfFigureManifest?.figures || []).forEach(manifestFigure => {
      const sourceFigure = assetFigures.find(candidate =>
        String(candidate?.figureId || '') === String(manifestFigure?.figureId || '') ||
        String(candidate?.originalFigureId || '') === String(manifestFigure?.figureId || '') ||
        String(candidate?.figureLabel || '').replace(/\s+/g, ' ').toLowerCase() ===
          String(manifestFigure?.figureLabel || '').replace(/\s+/g, ' ').toLowerCase()
      );
      const image = (Array.isArray(sourceFigure?.analysisImages)
        ? sourceFigure.analysisImages : []).find(candidate =>
        /^data:image\//i.test(String(candidate?.dataUrl || ''))
      );
      if (image?.dataUrl) {
        runtimeImageByFigureId[String(manifestFigure.figureId)] = String(image.dataUrl);
      }
    });
    if (pdfFigureManifest &&
        Object.keys(runtimeImageByFigureId).length < Number(pdfFigureManifest.figureCount || 0)) {
      Object.assign(
        runtimeImageByFigureId,
        await restoreSupplementalPdfFigureBinaryAssets(pdfFigureManifest)
      );
    }
    const blocks = SciLLM.markdownToPdfBlocks(markdown);
    const captionPairs = SciLLM.buildPdfFigureSemanticCaptions(
      blocks,
      SciLLM.associatePdfFigureCaptions(blocks)
    );
    captionPairs.forEach(pair => {
      const label = String(pair?.caption || '').match(/\bFigure\s+S\s*\d+/i)?.[0]
        ?.replace(/\s+/g, ' ').toLowerCase() || '';
      const figure = assetFigures.find(candidate =>
        String(candidate?.figureLabel || '').replace(/\s+/g, ' ').toLowerCase() === label
      );
      const image = (Array.isArray(figure?.analysisImages)
        ? figure.analysisImages : []).find(candidate =>
        /^data:image\//i.test(String(candidate?.dataUrl || ''))
      );
      const reference = String(blocks[pair?.imageIndex]?.source || '');
      if (reference && image?.dataUrl) cachedImageByReference[reference] = image.dataUrl;
    });
    renderParsedDocument({
      markdown,
      markdownUrl: '',
      entries: null,
      markdownEntry: '',
      cachedImageByReference,
      pdfFigureManifest,
      runtimeImageByFigureId,
      restored: true
    });
    if (pdfFigureManifest?.figureCount) {
      setPdfFigureEngineStatus(
        `已从父论文工作区恢复 ${Number(pdfFigureManifest.figureCount) || 0} 张完整补充 Figure。`,
        'ready'
      );
    }
    setProgress(
      100,
      '已从原论文工作区恢复解析正文与补充图；如需查看原始 PDF，可在下方重新选择本地文件。',
      '已恢复解析结果'
    );
    document.documentElement.dataset.pdfWorkspaceRestored = 'true';
    showReaderActions({ settings: true, localFallback: true });
    return true;
  }

  function friendlyParseError(error) {
    const code = String(error?.code || error?.message || '');
    if (code === '-30003' || /page count|20\s*页|limit/i.test(String(error?.message || ''))) {
      return '这篇 PDF 超过轻量解析限制。请在 Brevess“模型与分析”设置页切换精准解析并填写 MinerU Token。';
    }
    if (code === 'PDF_MINERU_TOKEN_REQUIRED') {
      return '精准解析需要 MinerU Token，请在 Brevess“模型与分析”设置页填写；Token 只保存在当前浏览器。';
    }
    if (/A0202|A0211|Token/i.test(code)) {
      return 'MinerU Token 无效或已过期，请更新后重试。';
    }
    if (/PDF_ZIP_DECOMPRESSION_UNAVAILABLE/.test(code)) {
      return '当前浏览器不支持解压 MinerU 结果，请升级浏览器或改用轻量解析。';
    }
    if (/PDF_RELAY_SOURCE_TAB_CHANGED|PDF_RELAY_SOURCE_ORIGIN_MISMATCH/.test(code)) {
      return '原论文标签页已经变化，无法继续使用该出版社会话。请返回原论文后重新点击“解析并纳入”，或在下方选择已下载的补充 PDF。';
    }
    if (/PDF_RELAY_SOURCE_HTTP|PDF_RELAY_NETWORK_FAILED|PDF_RELAY_NOT_PDF/.test(code)) {
      return '浏览器自动读取出版社补充 PDF 失败。请确认原论文仍可正常打开并重试；也可以在下方选择已下载的补充 PDF。';
    }
    if (/PDF_RELAY_FILE_TOO_LARGE/.test(code)) {
      return '这个补充 PDF 超过 MinerU 的 200 MB 文件限制。';
    }
    if (/PDF_RELAY_UPLOAD_HTTP/.test(code)) {
      return '补充 PDF 已读取，但直传 MinerU 失败，请重新解析；若仍失败可在下方手动选择文件。';
    }
    return `PDF 解析失败：${String(error?.message || error || '未知错误')}`;
  }

  async function runParse() {
    const runId = ++state.runId;
    state.nativeFigureAbortController?.abort?.();
    const stored = await chrome.storage.local.get(SciLLM.PDF_MINERU_SETTINGS_KEY);
    state.settings = SciLLM.normalizeMineruPdfSettings(
      stored?.[SciLLM.PDF_MINERU_SETTINGS_KEY]
    );
    const settings = state.settings;
    await updateMineruQuotaStatus();
    if (isLocalSource && !state.localFile) {
      try {
        await loadOpenedLocalPdf();
      } catch (error) {
        element('pdfReaderControl').dataset.state = 'error';
        setProgress(
          4,
          '暂时无法直接读取这个本地 PDF。请允许 Brevess 访问文件网址后重试，或在下方重新选择当前文件。',
          '需要本地文件访问权限'
        );
        showReaderActions({ retry: true, localFallback: true });
        return;
      }
    }
    if (settings.mode === 'precise' && !settings.token) {
      setProgress(
        4,
        '精准解析需要 MinerU Token，请在 Brevess“模型与分析”设置页填写。',
        '需要 MinerU Token'
      );
      showReaderActions({ retry: true, settings: true });
      return;
    }
    element('pdfReaderControl').dataset.state = 'loading';
    showReaderActions();
    try {
      const nativeFiguresPromise = extractWholePdfFigures(runId).catch(error => {
        if (error?.name === 'AbortError') throw error;
        document.documentElement.dataset.pdfFigureEngineError = String(
          error?.code || error?.message || 'PDF_FIGURE_ENGINE_UNAVAILABLE'
        ).slice(0, 160);
        setPdfFigureEngineStatus(
          '未能使用本地完整图引擎；本次先保留 MinerU 图像结果。安装或重新加载 Brevess 本地伴侣后可重试。',
          'fallback'
        );
        return null;
      });
      const mineruPromise = settings.mode === 'precise'
        ? parseWithPrecise(runId)
        : parseWithAgent(runId);
      const [parsed, nativeFigures] = await Promise.all([
        mineruPromise, nativeFiguresPromise
      ]);
      if (runId !== state.runId) return;
      await updateMineruQuotaStatus(parsed?.mineruUsage);
      if (nativeFigures?.manifest?.figureCount) {
        parsed.pdfFigureManifest = nativeFigures.manifest;
        parsed.runtimeImageByFigureId = nativeFigures.runtimeImageByFigureId;
        parsed.pdfFigureBinaryAssets = nativeFigures.binaryAssets;
      } else {
        await cacheRemoteParsedImages(parsed, runId);
      }
      setProgress(84, '正在合并正文结构、完整 Figure 与分层大纲…');
      renderParsedDocument(parsed);
    } catch (error) {
      state.nativeFigureAbortController?.abort?.();
      if (runId !== state.runId || error?.name === 'AbortError') return;
      element('pdfReaderControl').dataset.state = 'error';
      document.documentElement.dataset.pdfErrorCode =
        String(error?.code || error?.message || 'PDF_PARSE_FAILED').slice(0, 160);
      setProgress(6, friendlyParseError(error), 'PDF 尚未准备完成');
      showReaderActions({
        retry: true,
        settings: true,
        localFallback: Boolean(supplementalPdfBinding)
      });
      chrome.runtime.sendMessage({
        type: 'PDF_WORKSPACE_ERROR',
        sourceUrl,
        error: String(error?.message || error || 'PDF_PARSE_FAILED'),
        mineruQuotaText: state.quotaText
      }).catch(() => undefined);
    } finally {
      if (runId === state.runId) state.localFileBytes = null;
    }
  }

  async function initialize() {
    installReaderControls();
    const returnToArticle = element('pdfReaderReturnToArticle');
    returnToArticle.hidden = !Boolean(
      supplementalPdfBinding && (
        Number.isInteger(Number(supplementalPdfBinding.parentTabId)) ||
        supplementalPdfBinding.parentCanonicalUrl
      )
    );
    returnToArticle.addEventListener('click', () => {
      void returnToParentArticle();
    });
    const original = element('pdfReaderOpenOriginalTab');
    original.href = sourceUrl || '#';
    original.hidden = !sourceUrl;
    if (supplementalPdfBinding && sourceUrl) {
      original.textContent = '打开附件下载页';
    }
    element('pdfReaderSubtitle').textContent = sourceTitle || fileNameForSource();
    const stored = await chrome.storage.local.get(SciLLM.PDF_MINERU_SETTINGS_KEY);
    state.settings = SciLLM.normalizeMineruPdfSettings(
      stored?.[SciLLM.PDF_MINERU_SETTINGS_KEY]
    );
    await updateMineruQuotaStatus();
    if (supplementalPdfBinding) {
      if (await restoreCachedSupplementalDocument()) return;
      const fallback = element('pdfLocalFileFallback');
      const heading = fallback?.querySelector('strong');
      const copy = fallback?.querySelector('p');
      if (heading) heading.textContent = '请选择已经下载到本机的补充 PDF';
      if (copy) {
        copy.textContent =
          'Brevess 不再尝试自动下载或代传期刊附件。选择文件后会在本页完成 MinerU 解析，' +
          '并可随时切换查看原始 PDF、解析正文和补充图解读。';
      }
      setProgress(
        4,
        sourceUrl
          ? '请先点击右上角“打开附件下载页”自行下载，再在下方选择该 PDF。'
          : '请先从期刊页面自行下载补充材料，再在下方选择该 PDF。',
        '请选择补充材料 PDF'
      );
      showReaderActions({ settings: true, localFallback: true });
    }
    element('pdfReaderViewToggle').addEventListener('click', () => {
      setReaderView(state.view === 'original' ? 'parsed' : 'original');
    });
    element('pdfReaderReparse').addEventListener('click', () => void runParse());
    element('pdfReaderSettingsToggle').addEventListener('click', () => {
      void openMineruSettings();
    });
    element('pdfReaderOpenSettings').addEventListener('click', () => {
      void openMineruSettings();
    });
    element('pdfReaderRetry').addEventListener('click', () => void runParse());
    element('pdfLocalFile').addEventListener('change', event => {
      state.localFile = event.target.files?.[0] || null;
      if (state.localFile) {
        element('pdfReaderViewToggle').hidden = false;
        showReaderActions({ retry: true });
        setProgress(
          5,
          `已选择 ${state.localFile.name}，正在开始解析…`,
          '本地 PDF 已就绪'
        );
        void (async () => {
          await prepareLocalPdfWorkspaceIdentity();
          if (await restoreCachedPdfDocument()) {
            state.localFileBytes = null;
            return;
          }
          await runParse();
        })().catch(error => {
          state.localFileBytes = null;
          document.documentElement.dataset.pdfErrorCode = String(
            error?.code || error?.message || 'PDF_LOCAL_IDENTITY_FAILED'
          ).slice(0, 160);
          setProgress(6, friendlyParseError(error), 'PDF 尚未准备完成');
          showReaderActions({ retry: true, settings: true, localFallback: true });
        });
      }
    });
    if (supplementalPdfBinding) return;
    if (!sourceUrl) {
      const fallback = element('pdfLocalFileFallback');
      const heading = fallback?.querySelector('strong');
      const copy = fallback?.querySelector('p');
      if (heading) heading.textContent = '选择这篇论文的补充材料 PDF';
      if (copy) {
        copy.textContent =
          '选择后会按当前 MinerU 设置解析；完成的补充 Figure 会自动同步回原论文工作区。';
      }
      setProgress(
        4,
        '出版社未提供可直接读取的补充 PDF 链接，请在下方选择已下载的补充材料。',
        '请选择补充材料 PDF'
      );
      showReaderActions({ settings: true, localFallback: true });
      return;
    }
    if (await restoreCachedPdfDocument()) return;
    void runParse();
  }

  document.addEventListener('DOMContentLoaded', () => void initialize());
  document.addEventListener('brevess:pdf-focus-page', event => {
    focusOriginalPdfPage(event?.detail?.page);
  });
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes?.[SciLLM.PDF_MINERU_SETTINGS_KEY]) return;
    state.settings = SciLLM.normalizeMineruPdfSettings(
      changes[SciLLM.PDF_MINERU_SETTINGS_KEY].newValue
    );
    if (element('pdfReaderControl')?.dataset.state === 'error') void runParse();
  });
  window.addEventListener('pagehide', revokeAssetUrls);
  window.addEventListener('pagehide', () => {
    state.nativeFigureAbortController?.abort?.();
    if (state.originalObjectUrl) URL.revokeObjectURL(state.originalObjectUrl);
    state.originalObjectUrl = '';
  });
})();
