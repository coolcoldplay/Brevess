(function initializePdfReader() {
  const t = value => globalThis.SciLLM?.translateInterfaceText?.(value) || value;
  let subtitleSource = '';
  let subtitleIsAuthoredValue = false;
  function setPdfReaderSubtitle(message, authoredValueOnly = false) {
    subtitleSource = String(message || '');
    subtitleIsAuthoredValue = authoredValueOnly;
    const subtitle = element('pdfReaderSubtitle');
    if (!subtitle) return;
    subtitle.setAttribute('data-i18n-ignore', '');
    subtitle.textContent = subtitleIsAuthoredValue ? subtitleSource : t(subtitleSource);
  }
  globalThis.SciLLM?.onInterfaceLanguageChange?.(() => {
    if (subtitleSource) setPdfReaderSubtitle(subtitleSource, subtitleIsAuthoredValue);
  });
  const params = new URLSearchParams(location.search);
  const sourceUrl = SciLLM.normalizePdfSourceUrl(params.get('source'));
  const sourceTitle = String(params.get('title') || '').normalize('NFKC').trim();
  const isLocalSource = sourceUrl.startsWith('file:');
  const supplementalPdfBinding = SciLLM.readSupplementalPdfBinding(location.href);
  const supplementalImportToken = SciLLM.normalizeSupplementalPdfImportToken?.(
    params.get('supplementalImportToken')
  ) || '';
  const headlessSupplementalImport = Boolean(
    supplementalPdfBinding && supplementalImportToken &&
    params.get('headlessImport') === '1'
  );
  const state = {
    settings: SciLLM.normalizeMineruPdfSettings(),
    localFile: null,
    localFileHandle: null,
    openedPdfHash: '',
    saveBusy: false,
    saveOperation: 0,
    runId: 0,
    assetUrls: [],
    originalObjectUrl: '',
    quotaText: '',
    view: 'original',
    zoom: 1,
    nativeScale: 1.35,
    nativeReader: null,
    jumpStack: [],
    positionRestoreKey: '',
    positionRestoring: false,
    workspaceSourceUrl: sourceUrl,
    localFileBytes: null,
    nativePdfBytesPromise: null,
    nativeFigureAbortController: null,
    parsedPageBindingCleanup: null,
    translationClient: null,
    translationHandoffStarted: false,
    pdfMetadataTitle: '',
    documentTitle: ''
  };

  function element(id) {
    return document.getElementById(id);
  }

  function normalizeRemotePdfReaderSource(value) {
    const raw = String(value || '').normalize('NFKC').trim();
    if (!raw) {
      return { url: '', error: '请输入远程 PDF 的 HTTP(S) 地址。', code: 'PDF_REMOTE_URL_EMPTY' };
    }
    let parsed;
    try {
      parsed = new URL(raw);
    } catch (_) {
      return { url: '', error: '请输入有效的远程 PDF 地址。', code: 'PDF_REMOTE_URL_INVALID' };
    }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
      return {
        url: '',
        error: '远程 PDF 地址必须使用 http:// 或 https://，且不能包含用户名或密码。',
        code: 'PDF_REMOTE_URL_PROTOCOL'
      };
    }
    parsed.hash = '';
    return { url: parsed.href, error: '', code: '' };
  }

  function openRemotePdfReader(value) {
    const input = element('pdfRemoteUrl');
    const status = element('pdfRemoteUrlStatus');
    const normalized = normalizeRemotePdfReaderSource(value);
    if (!normalized.url) {
      input?.setAttribute('aria-invalid', 'true');
      if (status) {
        status.textContent = normalized.error;
        status.hidden = false;
      }
      return false;
    }
    const readerUrl = SciLLM.createPdfReaderUrl?.(
      chrome.runtime.getURL.bind(chrome.runtime), normalized.url
    );
    if (!readerUrl) {
      input?.setAttribute('aria-invalid', 'true');
      if (status) {
        status.textContent = '无法打开这个远程 PDF 地址，请检查后重试。';
        status.hidden = false;
      }
      return false;
    }
    input?.removeAttribute('aria-invalid');
    if (status) {
      status.textContent = '正在打开远程 PDF…';
      status.hidden = false;
    }
    location.assign(readerUrl);
    return true;
  }

  const readerPreferenceKey = `brevess-pdf-reader:${
    SciLLM.stableHash?.(sourceUrl || location.href) || 'current'
  }`;

  function readReaderPreferences() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(readerPreferenceKey) || '{}');
      state.zoom = Math.max(0.75, Math.min(1.6, Number(saved.zoom) || 1));
      if (state.view !== 'original' && Number.isFinite(Number(saved.scrollY))) {
        requestAnimationFrame(() => globalThis.scrollTo({
          top: Math.max(0, Number(saved.scrollY)), behavior: 'auto'
        }));
      }
    } catch (_) {}
  }

  function saveReaderPreferences() {
    try {
      if (state.view === 'original') {
        const native = globalThis.__brevessNativePdfDocument;
        const hash = native?.structure?.documentHash;
        if (!hash || state.positionRestoring || state.positionRestoreKey !==
            `${hash}:${native.documentGeneration}`) return;
        const viewer = element('pdfNativeViewer');
        const top = viewer.getBoundingClientRect().top;
        const page = [...viewer.querySelectorAll('.pdf-native-page')]
          .find(item => item.getBoundingClientRect().bottom > top + 1);
        if (!page) return;
        const bounds = page.getBoundingClientRect();
        const position = SciLLM.normalizePdfNativeReadingPosition({
          version: 1, documentHash: hash, scale: state.nativeScale,
          pageNumber: Number(page.dataset.pdfPageNumber),
          pageOffset: Math.max(0, Math.min(1, (top - bounds.top) / bounds.height))
        }, hash, native.pageCount);
        if (position) localStorage.setItem(`brevess-pdf-position:${hash}`, JSON.stringify(position));
        return;
      }
      sessionStorage.setItem(readerPreferenceKey, JSON.stringify({
        zoom: state.zoom,
        scrollY: Math.max(0, Math.round(globalThis.scrollY || 0))
      }));
    } catch (_) {}
  }

  async function restoreNativeReadingPosition() {
    const native = globalThis.__brevessNativePdfDocument;
    const hash = native?.structure?.documentHash;
    if (!hash || !['text-ready', 'partial-index'].includes(native.phase)) return;
    const key = `${hash}:${native.documentGeneration}`;
    if (state.positionRestoreKey === key) return;
    state.positionRestoreKey = key;
    state.positionRestoring = true;
    try {
      const position = SciLLM.normalizePdfNativeReadingPosition(
        JSON.parse(localStorage.getItem(`brevess-pdf-position:${hash}`) || 'null'),
        hash, native.pageCount
      );
      if (!position) return;
      nativeReaderCommand('setScale', position.scale);
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const current = globalThis.__brevessNativePdfDocument;
      if (current?.structure?.documentHash !== hash ||
          current.documentGeneration !== native.documentGeneration) return;
      nativeReaderCommand('focusPage', position.pageNumber);
      const viewer = element('pdfNativeViewer');
      // Index readiness may be published before the target page has hydrated.
      // focusPage queues that navigation; do not finish restoration (or save a
      // zero offset) until its real page has mounted and the queued jump ran.
      await new Promise((resolve, reject) => {
        const finish = error => {
          clearTimeout(timer);
          document.removeEventListener('brevess:pdf-page-rendered', check);
          document.removeEventListener('brevess:native-pdf-ready', check);
          error ? reject(error) : resolve();
        };
        const check = () => {
          const live = globalThis.__brevessNativePdfDocument;
          if (live?.structure?.documentHash !== hash ||
              live.documentGeneration !== native.documentGeneration) {
            finish(new Error('PDF_READING_POSITION_SOURCE_CHANGED')); return;
          }
          if (viewer.querySelector(`.pdf-native-page[data-pdf-page-number="${position.pageNumber}"].is-rendered`)) finish();
        };
        const timer = setTimeout(() => finish(new Error('PDF_READING_POSITION_PAGE_UNAVAILABLE')), 120000);
        document.addEventListener('brevess:pdf-page-rendered', check);
        document.addEventListener('brevess:native-pdf-ready', check);
        check();
      });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const live = globalThis.__brevessNativePdfDocument;
      if (live?.structure?.documentHash !== hash ||
          live.documentGeneration !== native.documentGeneration) return;
      const page = viewer.querySelector(`[data-pdf-page-number="${position.pageNumber}"]`);
      if (page) {
        const bounds = page.getBoundingClientRect();
        viewer.scrollTo({ top: viewer.scrollTop + bounds.top - viewer.getBoundingClientRect().top +
          bounds.height * position.pageOffset, behavior: 'instant' });
        element('pdfReaderPageNumber').value = String(position.pageNumber);
      }
    } catch (_) {
      // A malformed local preference cannot prevent opening the original PDF.
    } finally {
      if (state.positionRestoreKey === key) state.positionRestoring = false;
    }
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

  function setParsedReaderZoom(value, { preserveAnchor = true } = {}) {
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

  function nativeReaderCommand(name, ...args) {
    const result = nativeBridgeController.command(name, ...args);
    return result === undefined ? state.nativeScale : result;
  }

  function setReaderZoom(value, options = {}) {
    if (state.view === 'original') {
      return nativeReaderCommand('setScale', value, options);
    }
    return setParsedReaderZoom(value, options);
  }

  function adjustReaderZoom(delta) {
    if (state.view === 'original') return nativeReaderCommand('zoomBy', delta);
    return setReaderZoom(state.zoom + delta);
  }

  function fitReaderWidth() {
    if (state.view === 'original') {
      if (state.nativeReader) return state.nativeReader.fitWidth();
      return nativeReaderCommand('fitWidth');
    }
    return setParsedReaderZoom(1);
  }

  function syncNativeReaderControls(next = {}) {
    const scale = Number(next?.scale);
    if (Number.isFinite(scale) && scale > 0) state.nativeScale = scale;
    if (next?.sourceHash) state.openedPdfHash = String(next.sourceHash);
    syncPdfSaveActions();
    if (state.view === 'original') {
      element('pdfReaderZoomValue').textContent = `${Math.round(state.nativeScale * 100)}%`;
    }
  }

  const nativeBridgeController = SciLLM.createPdfNativeBridgeController({
    onReady(api) {
      state.nativeReader = api;
      syncPdfSaveActions();
      if (state.view === 'original') state.nativeReader?.activate?.();
      else state.nativeReader?.deactivate?.();
    },
    onState(next) {
      syncNativeReaderControls(next);
    }
  });

  function annotatedPdfName() {
    const name = fileNameForSource().replace(/\.pdf$/i, '') || 'paper';
    return `${name}-brevess-annotated.pdf`;
  }

  function syncPdfSaveActions() {
    const copy = element('pdfReaderSaveAnnotated');
    const overwrite = element('pdfReaderOverwriteAnnotated');
    if (!copy || !overwrite) return;
    copy.hidden = !state.nativeReader;
    copy.disabled = state.saveBusy;
    overwrite.hidden = !(state.nativeReader && state.localFileHandle);
    overwrite.disabled = state.saveBusy;
  }

  function setPdfSaveStatus(status, message) {
    const target = element('pdfReaderSaveStatus');
    if (!target) return;
    target.hidden = !message;
    target.textContent = String(message || '');
    if (status) target.dataset.state = status;
    else delete target.dataset.state;
  }

  function triggerPdfDownload(url, name) {
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.hidden = true;
    document.body.appendChild(link);
    try { link.click(); } finally { link.remove(); }
  }

  function capturePdfSaveOperation(mode) {
    if (state.saveBusy || !state.nativeReader) return null;
    const reader = state.nativeReader;
    const nativeState = reader.getState();
    const operation = ++state.saveOperation;
    return Object.freeze({
      operation,
      mode,
      reader,
      nativeDocumentHash: String(nativeState?.documentHash || ''),
      nativeGeneration: Number(nativeState?.documentGeneration) || 0,
      annotationsDigest: String(nativeState?.annotationsDigest || ''),
      sourceKind: state.localFileHandle ? 'local' : 'remote',
      sourceHandle: state.localFileHandle,
      suggestedName: annotatedPdfName(),
      openedHash: state.openedPdfHash
    });
  }

  function pdfSaveCaptureIsCurrent(capture, exportContext = null) {
    if (!capture || state.saveOperation !== capture.operation ||
        state.nativeReader !== capture.reader) return false;
    const current = capture.reader.getState();
    if (String(current?.documentHash || '') !== capture.nativeDocumentHash ||
        Number(current?.documentGeneration) !== capture.nativeGeneration ||
        String(current?.annotationsDigest || '') !== capture.annotationsDigest) return false;
    return !exportContext || capture.reader.isSaveContextCurrent(exportContext);
  }

  async function performPdfSave(capture, targetHandle = null) {
    if (!capture || !pdfSaveCaptureIsCurrent(capture)) return;
    state.saveBusy = true;
    syncPdfSaveActions();
    setPdfSaveStatus('saving', '正在写入批注并重新打开 PDF 核验…');
    try {
      const exported = await capture.reader.exportAnnotatedPdf();
      if (!pdfSaveCaptureIsCurrent(capture, exported)) {
        throw Object.assign(new Error('save_context_changed'), { code: 'save_context_changed' });
      }
      const assertCurrent = () => pdfSaveCaptureIsCurrent(capture, exported);
      const verify = written => capture.reader.verifyAnnotatedPdf(written, exported);
      const common = {
        bytes: exported.bytes,
        preflight: verify,
        verify,
        assertCurrent,
        sha256: value => SciLLM.sha256PdfBytes(value)
      };
      const result = capture.mode === 'overwrite'
        ? await SciLLM.overwriteAnnotatedPdf({
          ...common,
          sourceKind: capture.sourceKind,
          fileHandle: capture.sourceHandle,
          openedHash: capture.openedHash,
          confirm: message => globalThis.confirm(t(message)),
        })
        : await SciLLM.saveAnnotatedPdfCopy({
          ...common,
          suggestedName: capture.suggestedName,
          fileHandle: targetHandle,
          triggerDownload: triggerPdfDownload
        });
      if (capture.mode === 'overwrite' && result.actualHash) {
        const currentNative = capture.reader.getState();
        const sameDocument = state.nativeReader === capture.reader &&
          String(currentNative?.documentHash || '') === capture.nativeDocumentHash &&
          Number(currentNative?.documentGeneration) === capture.nativeGeneration;
        if (sameDocument) {
          capture.reader.adoptSavedSourceHash(exported, result.actualHash);
          state.openedPdfHash = result.actualHash;
        }
      }
      if (result.status === 'verified_snapshot_saved_context_changed') {
        setPdfSaveStatus(
          'verified_snapshot_saved_context_changed',
          '已保存点击时的批注快照；当前批注已变化。'
        );
      } else if (result.status === 'export_verified_download_started' ||
          result.status === 'export_verified_download_started_context_changed') {
        setPdfSaveStatus(
          'download_started',
          result.status.endsWith('_context_changed')
            ? '浏览器已开始下载点击时的批注快照；当前批注已变化，请在下载完成后确认文件。'
            : '批注导出已核验，浏览器已开始下载；请在下载完成后确认文件。'
        );
      } else {
        setPdfSaveStatus(
          'verified',
          `已从写入文件重新读取并逐页核验 ${result.verification.verifiedIds.length} 条批注。`
        );
      }
    } catch (error) {
      const code = String(error?.code || 'failed');
      if (code === 'save_cancelled' || code === 'confirmation_required') {
        setPdfSaveStatus('', '已取消保存，原文件未改变。');
      } else if (error?.committed) {
        setPdfSaveStatus('failed', '文件已经写入，但重新读取核验失败；请检查目标文件后再重试。');
      } else if (code === 'source_changed') {
        setPdfSaveStatus('source_changed', '原 PDF 已被其他程序修改，为避免覆盖新内容，本次保存已阻止。');
      } else if (code === 'save_context_changed' || error?.message === 'PDF_SAVE_CONTEXT_CHANGED') {
        setPdfSaveStatus('failed', '保存期间 PDF 或批注已变更，本次保存已取消，请重试。');
      } else {
        setPdfSaveStatus('failed', '批注 PDF 保存或核验失败，请重试或改用“保存带批注副本”。');
      }
    } finally {
      state.saveBusy = false;
      syncPdfSaveActions();
    }
  }

  async function startPdfCopySave() {
    const capture = capturePdfSaveOperation('copy');
    if (!capture) return;
    let handle = null;
    if (typeof globalThis.showSaveFilePicker === 'function') {
      state.saveBusy = true;
      syncPdfSaveActions();
      try {
        handle = await SciLLM.acquireAnnotatedPdfSaveHandle({
          suggestedName: capture.suggestedName,
          showSaveFilePicker: options => globalThis.showSaveFilePicker(options)
        });
        await SciLLM.assertDistinctPdfCopyTarget(handle, capture.sourceHandle);
        if (!pdfSaveCaptureIsCurrent(capture)) throw Object.assign(
          new Error('save_context_changed'), { code: 'save_context_changed' }
        );
      } catch (error) {
        state.saveBusy = false;
        syncPdfSaveActions();
        if (error?.code === 'save_cancelled') {
          setPdfSaveStatus('', '已取消保存，原文件未改变。');
          return;
        }
        if (error?.code === 'copy_target_is_source') {
          setPdfSaveStatus(
            'failed',
            '所选保存位置是当前原 PDF，请使用“覆盖原 PDF”并完成安全确认。'
          );
          return;
        }
        if (error?.code === 'copy_target_identity_failed') {
          setPdfSaveStatus('failed', '无法确认保存副本与原 PDF 是否为同一文件，已停止保存。');
          return;
        }
        setPdfSaveStatus('failed', '保存目标未准备完成，请重试。');
        return;
      }
      state.saveBusy = false;
    }
    await performPdfSave(capture, handle);
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
    let searchMatches = [], searchIndex = -1;
    function showSearchMatch() {
      const hit = searchMatches[searchIndex];
      document.querySelectorAll('.pdf-native-search-layer').forEach(layer => layer.remove());
      element('pdfReaderFindStatus').textContent = searchMatches.length ? `${searchIndex + 1}/${searchMatches.length}` : '';
      if (!hit) return;
      const projection = nativeReaderCommand('getPageProjection', hit.pageNumber);
      if (!projection?.textLayer) return;
      const map = SciLLM.readPdfTextProjection(projection.textLayer);
      const range = SciLLM.pdfProjectionRange(map, hit, document);
      if (!range) return;
      const layer = document.createElement('div');
      layer.className = 'pdf-native-search-layer';
      for (const rect of SciLLM.pdfProjectionRects(range, projection.pageElement.getBoundingClientRect())) {
        const mark = document.createElement('div');
        mark.className = 'pdf-native-search-hit';
        for (const [key, value] of Object.entries(rect)) mark.style[key] = `${value}px`;
        layer.appendChild(mark);
      }
      projection.pageElement.appendChild(layer);
    }
    function moveSearch(direction = 1) {
      if (!searchMatches.length) return;
      searchIndex = (searchIndex + direction + searchMatches.length) % searchMatches.length;
      const hit = searchMatches[searchIndex];
      nativeReaderCommand('focusPage', hit.pageNumber);
      element('pdfReaderPageNumber').value = String(hit.pageNumber);
      showSearchMatch();
    }
    element('pdfReaderFind').addEventListener('input', () => {
      const query = element('pdfReaderFind').value.normalize('NFKC').trim().toLowerCase();
      searchMatches = []; searchIndex = -1;
      document.querySelectorAll('.pdf-native-search-layer').forEach(layer => layer.remove());
      if (query) for (const paragraph of globalThis.__brevessNativePdfDocument?.structure?.paragraphs || []) {
        const value = paragraph.text.toLowerCase();
        let start = value.indexOf(query);
        while (start >= 0 && searchMatches.length < 10000) {
          searchMatches.push({ pageNumber: paragraph.pageNumber, start, end: start + query.length,
            quote: paragraph.text.slice(start, start + query.length) });
          start = value.indexOf(query, start + Math.max(1, query.length));
        }
      }
      element('pdfReaderFindStatus').textContent = query && !searchMatches.length ? '无匹配' : '';
      moveSearch(1);
    });
    element('pdfReaderFind').addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); moveSearch(event.shiftKey ? -1 : 1); }
    });
    element('pdfReaderFindNext').addEventListener('click', () => moveSearch(1));
    element('pdfReaderFindPrevious').addEventListener('click', () => moveSearch(-1));
    document.addEventListener('brevess:pdf-page-rendered', showSearchMatch);
    const navigatePage = value => {
      const count = globalThis.__brevessNativePdfDocument?.pageCount || 1;
      const page = Math.max(1, Math.min(count, Math.floor(Number(value) || 1)));
      element('pdfReaderPageNumber').value = String(page);
      nativeReaderCommand('focusPage', page);
    };
    element('pdfReaderPageNumber').addEventListener('change', event => navigatePage(event.target.value));
    element('pdfReaderPreviousPage').addEventListener('click', () => navigatePage(Number(element('pdfReaderPageNumber').value) - 1));
    element('pdfReaderNextPage').addEventListener('click', () => navigatePage(Number(element('pdfReaderPageNumber').value) + 1));
    let pageScrollFrame = 0;
    element('pdfNativeViewer').addEventListener('scroll', () => {
      if (pageScrollFrame) return;
      pageScrollFrame = requestAnimationFrame(() => {
        pageScrollFrame = 0;
        const viewerRect = element('pdfNativeViewer').getBoundingClientRect();
        const page = [...document.querySelectorAll('.pdf-native-page')].map(item => {
          const rect = item.getBoundingClientRect();
          const visibleHeight = Math.max(0, Math.min(rect.bottom, viewerRect.bottom) - Math.max(rect.top, viewerRect.top));
          return { element: item, visibleHeight };
        }).filter(item => item.visibleHeight > 0)
          .sort((left, right) => right.visibleHeight - left.visibleHeight)[0]?.element;
        if (page && document.activeElement !== element('pdfReaderPageNumber')) element('pdfReaderPageNumber').value = page.dataset.pdfPageNumber;
      });
    }, { passive: true });
    element('pdfReaderStudy').addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'PDF_READER_START_READING' }).then(response => {
        if (!response?.success) setPdfSaveStatus('error', response?.error?.message || '无法打开研读侧栏');
        else setPdfSaveStatus('', '');
      }).catch(error => setPdfSaveStatus('error', error.message));
    });
    readReaderPreferences();
    setParsedReaderZoom(state.zoom, { preserveAnchor: false });
    nativeReaderCommand('fitWidth');
    element('pdfReaderZoomOut').addEventListener('click', () =>
      adjustReaderZoom(-0.1));
    element('pdfReaderZoomIn').addEventListener('click', () =>
      adjustReaderZoom(0.1));
    element('pdfReaderZoomReset').addEventListener('click', () =>
      fitReaderWidth());
    element('pdfReaderJumpBack').addEventListener('click', () => {
      const top = state.jumpStack.pop();
      if (!Number.isFinite(top)) return;
      globalThis.scrollTo({ top, behavior: 'smooth' });
      element('pdfReaderJumpBack').hidden = state.jumpStack.length === 0;
    });
    document.addEventListener('keydown', event => {
      if (!event.ctrlKey && !event.metaKey) return;
      if (event.key.toLowerCase() === 'f') {
        event.preventDefault(); element('pdfReaderFind').focus(); element('pdfReaderFind').select();
      } else if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        adjustReaderZoom(0.1);
      } else if (event.key === '-') {
        event.preventDefault();
        adjustReaderZoom(-0.1);
      } else if (event.key === '0') {
        event.preventDefault();
        fitReaderWidth();
      }
    });
    let saveTimer = null;
    const rememberScroll = () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(saveReaderPreferences, 160);
    };
    globalThis.addEventListener('scroll', rememberScroll, { passive: true });
    element('pdfNativeViewer').addEventListener('scroll', rememberScroll, { passive: true });
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
      setPdfReaderSubtitle('正在进入可直接沉浸翻译的阅读视图…');
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
    start = false,
    retry = false,
    settings = false,
    localFallback = false
  } = {}) {
    element('pdfReaderStartParse').hidden = !start;
    element('pdfReaderRetry').hidden = !retry;
    element('pdfReaderOpenSettings').hidden = !settings;
    element('pdfLocalFileFallback').hidden = !localFallback;
  }

  function showUnparsedPdfPrompt() {
    element('pdfReaderControl').dataset.state = 'idle';
    element('pdfReaderViewToggle').hidden = true;
    element('pdfReaderReparse').hidden = true;
    setProgress(
      4,
      '正在直接读取 PDF 原页与本地文字索引。扫描件可主动使用增强识别。',
      '正在准备 PDF'
    );
    showReaderActions({ start: true, settings: true });
    setReaderView('original');
  }

  async function reportHeadlessSupplementalImport(stage, detail = {}) {
    if (!headlessSupplementalImport) return false;
    const key = SciLLM.supplementalPdfImportStatusKey?.(supplementalImportToken);
    if (!key) return false;
    await chrome.storage.session.set({
      [key]: {
        stage,
        message: String(detail.message || '').slice(0, 500),
        code: String(detail.code || '').slice(0, 100),
        figureCount: Math.max(0, Number(detail.figureCount) || 0),
        panelCount: Math.max(0, Number(detail.panelCount) || 0),
        sourceImagePersistence: detail.sourceImagePersistence || null,
        relativePath: String(detail.relativePath || ''),
        updatedAt: Date.now()
      }
    });
    return true;
  }

  async function closeHeadlessSupplementalReader() {
    if (!headlessSupplementalImport) return false;
    const tab = await chrome.tabs.getCurrent().catch(() => null);
    if (Number.isInteger(tab?.id)) {
      await chrome.tabs.remove(tab.id).catch(() => undefined);
    }
    return true;
  }

  function importedPanelCount() {
    const figures = buildFigureWorkspaceSnapshot?.({ forceRefresh: true })?.figures || [];
    return figures.reduce((sum, figure) => {
      const panels = figure?.panels && typeof figure.panels === 'object'
        ? Object.keys(figure.panels).length : 0;
      const panelIds = Array.isArray(figure?.panelIds) ? figure.panelIds.length : 0;
      return sum + Math.max(panels, panelIds);
    }, 0);
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
    const expectedImages = new Map();
    const manifest = parsedDocument?.pdfFigureManifest;
    const hasDeclaration = manifest?.source === 'pdffigures2';
    const imageError = code => Object.assign(new Error(
      '补充 PDF 图片尚未完成父论文保存核验，已保存结果保留。'
    ), { code });
    if (hasDeclaration) {
      if (!Array.isArray(manifest.figures) || manifest.figures.length > 300) {
        throw imageError('SUPPLEMENTAL_PARENT_SOURCE_IMAGES_INCOMPLETE');
      }
      for (const figure of SciLLM.supplementalPdfSourceImageEntries(manifest)) {
        const path = String(figure?.image?.workspacePath || '');
        const hash = String(figure?.image?.sha256 || '').toLowerCase();
        if (!/^pdf\/figures\/supplemental\/[^/]+\.(?:png|jpe?g|webp)$/i.test(path) ||
            path.includes('\\') || !/^[a-f0-9]{64}$/i.test(hash)) {
          throw imageError('SUPPLEMENTAL_PARENT_SOURCE_IMAGES_INCOMPLETE');
        }
        if (expectedImages.has(path) && expectedImages.get(path) !== hash) {
          throw imageError('SUPPLEMENTAL_PARENT_SOURCE_IMAGE_CONFLICT');
        }
        expectedImages.set(path, hash);
      }
    }
    const requireParentImages = result => {
      if (result?.saved !== true) throw new Error('SUPPLEMENTAL_PARENT_SYNC_FAILED');
      if (!hasDeclaration) return result;
      const proof = result.sourceImagePersistence;
      if (proof?.complete !== true || proof.workspaceId !== supplementalPdfBinding.parentWorkspaceId ||
          proof.workspaceGeneration !== supplementalPdfBinding.parentWorkspaceGeneration ||
          proof.canonicalUrl !== supplementalPdfBinding.parentCanonicalUrl ||
          (proof.documentHash || '') !== (supplementalPdfBinding.parentDocumentHash || '') ||
          !Array.isArray(proof.verifiedAssets)) {
        throw imageError('SUPPLEMENTAL_PARENT_SOURCE_IMAGES_INCOMPLETE');
      }
      for (const [path, hash] of expectedImages) {
        if (!proof.verifiedAssets.some(asset => asset?.relativePath === path &&
            String(asset.sha256 || '').toLowerCase() === hash && asset.verified === true &&
            Number.isSafeInteger(asset.byteLength) && asset.byteLength > 0)) {
          throw imageError('SUPPLEMENTAL_PARENT_SOURCE_IMAGES_INCOMPLETE');
        }
      }
      return result;
    };
    if (typeof globalThis.syncParsedSupplementalInventoryToParent === 'function') {
      const result = await globalThis.syncParsedSupplementalInventoryToParent(
        parsedDocument
      );
      return requireParentImages(result);
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
    return requireParentImages(response);
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

  function mineruRequestBody(settings = state.settings) {
    return {
      language: settings.language,
      enable_table: settings.enableTable,
      is_ocr: settings.isOcr,
      enable_formula: settings.enableFormula
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

  function normalizePdfReaderDocumentTitle(value) {
    if (typeof value !== 'string') return '';
    return value.normalize('NFKC')
      .replace(/[\u0000-\u001f\u007f]+/gu, ' ')
      .replace(/\s+/gu, ' ').trim().slice(0, 500);
  }

  function isPdfReaderPlaceholderTitle(title) {
    return /^(?:untitled(?: document)?|title|document\s*\d*|paper|article|presentation\s*\d*|parsed pdf|pdf(?: document| reader| 文献| 阅读工作区)?|brevess pdf 阅读工作区|microsoft (?:word|powerpoint)|powerpoint presentation|adobe acrobat|latex)$/iu
      .test(title) || /^[A-Za-z]:[\\/]/u.test(title) ||
      /^file:/iu.test(title) || /\.(?:docx?|pptx?)$/iu.test(title);
  }

  function resolvePdfReaderDocumentTitle({
    metadataTitle = '', fileName = '', requestedTitle = ''
  } = {}) {
    const metadata = normalizePdfReaderDocumentTitle(metadataTitle);
    if (metadata && !isPdfReaderPlaceholderTitle(metadata)) return metadata;
    const leaf = typeof fileName === 'string'
      ? fileName.split(/[\\/]/u).at(-1).replace(/\.pdf$/iu, '') : '';
    const fromFile = normalizePdfReaderDocumentTitle(leaf);
    if (fromFile) return fromFile;
    const requested = normalizePdfReaderDocumentTitle(requestedTitle);
    return requested && !isPdfReaderPlaceholderTitle(requested) ? requested : 'PDF 文献';
  }

  function applyPdfReaderDocumentTitle(metadataTitle = state.pdfMetadataTitle) {
    state.pdfMetadataTitle = normalizePdfReaderDocumentTitle(metadataTitle);
    const resolved = resolvePdfReaderDocumentTitle({
      metadataTitle: state.pdfMetadataTitle,
      fileName: fileNameForSource(),
      requestedTitle: sourceTitle
    });
    state.documentTitle = resolved;
    document.title = resolved;
    document.querySelector('title')?.setAttribute('data-i18n-ignore', '');
    const subtitle = element('pdfReaderSubtitle');
    const pageCount = Number(globalThis.__brevessNativePdfDocument?.pageCount) || 0;
    if (subtitle) {
      setPdfReaderSubtitle(pageCount ? `${resolved} · ${pageCount} 页` : resolved, !pageCount);
    }
    return resolved;
  }

  function workspaceSourceUrl() {
    return state.workspaceSourceUrl || sourceUrl;
  }

  async function prepareLocalPdfWorkspaceIdentity(
    localFile = state.localFile,
    selectionRunId = state.runId
  ) {
    if (!(localFile instanceof Blob)) return workspaceSourceUrl();
    const localFileName = String(localFile.name || fileNameForSource());
    const assertCurrentSelection = () => {
      if (selectionRunId !== state.runId || state.localFile !== localFile) {
        throw new DOMException('PDF_SOURCE_SELECTION_SUPERSEDED', 'AbortError');
      }
    };
    assertCurrentSelection();
    const bytes = await localFile.arrayBuffer();
    assertCurrentSelection();
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    assertCurrentSelection();
    const hash = Array.from(new Uint8Array(digest), value =>
      value.toString(16).padStart(2, '0')
    ).join('');
    assertCurrentSelection();
    await SciLLM.saveOriginalPdfSource(hash, localFile, localFileName);
    assertCurrentSelection();
    const nextWorkspaceSourceUrl = SciLLM.buildLocalPdfWorkspaceUrl(localFileName, hash);
    const readerUrl = SciLLM.withLocalPdfWorkspaceSource(
      location.href, nextWorkspaceSourceUrl
    );
    if (!readerUrl) throw new Error('PDF_LOCAL_IDENTITY_FAILED');
    assertCurrentSelection();
    state.localFileBytes = bytes;
    state.workspaceSourceUrl = nextWorkspaceSourceUrl;
    history.replaceState(history.state, '', readerUrl);
    document.documentElement.dataset.pdfSourceUrl = state.workspaceSourceUrl;
    return state.workspaceSourceUrl;
  }

  function capturePdfParseSource(runId = state.runId) {
    const file = state.localFile;
    const source = workspaceSourceUrl();
    const assertCurrent = () => {
      if (runId !== state.runId || state.localFile !== file || workspaceSourceUrl() !== source) {
        throw new DOMException('Superseded', 'AbortError');
      }
    };
    assertCurrent();
    return { file, source, fileName: fileNameForSource(), assertCurrent };
  }

  async function capturePdfUploadSource(runId = state.runId) {
    const source = capturePdfParseSource(runId);
    if (source.file instanceof Blob || canRelayBrowserSessionSource()) return source;
    // A publisher URL may require browser cookies or expire. Enhancement must
    // upload the exact bytes already opened locally, never ask MinerU to fetch
    // that URL in a different session or silently download a replacement file.
    const native = globalThis.__brevessNativePdfDocument;
    const documentHash = native?.structure?.documentHash;
    const generation = native?.documentGeneration;
    if (!documentHash || !state.nativePdfBytesPromise) {
      throw new Error('PDF_UPLOAD_ORIGINAL_NOT_READY');
    }
    const assertCurrent = () => {
      source.assertCurrent();
      const current = globalThis.__brevessNativePdfDocument;
      if (current?.structure?.documentHash !== documentHash ||
          current?.documentGeneration !== generation) {
        throw new DOMException('Superseded', 'AbortError');
      }
    };
    const bytes = await state.nativePdfBytesPromise;
    assertCurrent();
    const actualHash = await sha256PdfBytes(bytes);
    assertCurrent();
    if (actualHash !== documentHash) throw new Error('PDF_UPLOAD_SOURCE_HASH_MISMATCH');
    if (bytes.byteLength > SciLLM.PDF_FIGURE_MAX_BYTES) {
      throw new Error('PDF_FIGURE_INPUT_TOO_LARGE');
    }
    return { ...source, assertCurrent, documentHash,
      file: new File([bytes], source.fileName, { type: 'application/pdf' }) };
  }

  async function uploadLocalFile(uploadUrl, source = capturePdfParseSource()) {
    source.assertCurrent();
    if (!(source.file instanceof Blob)) {
      throw new Error('PDF_LOCAL_FILE_MISSING');
    }
    // MinerU's signed OSS upload explicitly expects no Content-Type header.
    // Passing a File/Blob directly makes Chromium add its MIME type, which
    // causes the signed PUT to be aborted. ArrayBuffer preserves the exact
    // bytes without adding that header.
    const bytes = await source.file.arrayBuffer();
    source.assertCurrent();
    const response = await fetch(uploadUrl, { method: 'PUT', body: bytes });
    source.assertCurrent();
    if (!response.ok) throw new Error(`PDF_UPLOAD_HTTP_${response.status}`);
  }

  function canRelayBrowserSessionSource() {
    return Boolean(
      supplementalPdfBinding?.sourceUrl &&
      Number.isInteger(supplementalPdfBinding?.parentTabId) &&
      supplementalPdfBinding.parentTabId >= 0
    );
  }

  async function uploadPdfSource(uploadUrl, source = capturePdfParseSource()) {
    source.assertCurrent();
    if (source.file instanceof Blob) {
      await uploadLocalFile(uploadUrl, source);
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
    source.assertCurrent();
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

  function resetNativePdfSourceOwnership() {
    // Change the source exactly once, after the new bytes/hash are published.
    // Replacing here would begin loading the preceding document again.
    const reset = SciLLM.resetPdfReaderSourceOwnership({
      objectUrl: state.originalObjectUrl,
      revokeObjectURL: url => URL.revokeObjectURL(url)
    });
    state.originalObjectUrl = reset.objectUrl;
    state.nativePdfBytesPromise = null;
    state.localFileBytes = null;
  }

  function setReaderView(view = 'original') {
    // Parsed content is an auxiliary index. The reading surface stays on the PDF.
    const next = 'original';
    const viewer = element('pdfOriginalViewer');
    const parsedPage = element('pdfReaderWorkspace');
    const control = element('pdfReaderControl');
    const toggle = element('pdfReaderViewToggle');
    const originalUrl = originalPdfViewUrl();
    if (next === 'original' && !originalUrl) return;
    state.view = SciLLM.setPdfReaderViewSurface({
      originalViewer: viewer,
      parsedWorkspace: parsedPage,
      control,
      toggle,
      nativeReader: state.nativeReader
    }, next);
    document.body.dataset.pdfView = state.view;
    toggle.hidden = true;
    if (next === 'original') {
      syncNativeReaderControls({ scale: state.nativeScale });
    } else {
      setParsedReaderZoom(state.zoom, { preserveAnchor: false });
    }
  }

  function focusOriginalPdfPage(value) {
    const page = Math.max(1, Math.floor(Number(value) || 0));
    const originalUrl = originalPdfViewUrl();
    if (!originalUrl || !page) return false;
    setReaderView('original');
    if (globalThis.__brevessNativePdfDocument?.focusPage?.(page)) return true;
    document.dispatchEvent(new CustomEvent('brevess:focus-native-pdf-page', {
      detail: { pageNumber: page }
    }));
    const frame = element('pdfOriginalFrame');
    if (element('pdfNativeViewer')?.dataset?.state === 'error') {
      const pageUrl = `${String(originalUrl).replace(/#.*$/, '')}#page=${page}`;
      if (frame.src !== pageUrl) frame.src = pageUrl;
    }
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
      const cachedHash = SciLLM.localPdfSourceHash(sourceUrl);
      let restoredHash = '';
      if (!state.localFile && cachedHash) {
        const cached = await SciLLM.loadOriginalPdfSource(cachedHash);
        if (!cached?.blob) throw new Error('PDF_LOCAL_SOURCE_MISSING');
        state.localFile = new File([cached.blob], cached.name, { type: 'application/pdf' });
        restoredHash = cachedHash;
      }
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
      if (restoredHash && await sha256PdfBytes(bytes) !== restoredHash) {
        throw new Error('PDF_LOCAL_SOURCE_HASH_MISMATCH');
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
    // A label identifies a logical Figure, not an extracted physical region.
    // Keep every native candidate distinct, including cross-page plates and
    // embedded labels which normalize to the same supplemental Figure number.
    const identity = String(figure?.figureId || '').normalize('NFKC')
      .toLowerCase().replace(/[^a-z0-9-]/g, '').slice(-80) || 'region';
    const sourceIndex = Number.isSafeInteger(index) && index >= 0 ? index + 1 : 1;
    return `pdf/figures/${kind}/${materialPrefix}${slug}-${identity}-src${sourceIndex}.${extension}`;
  }

  async function extractWholePdfFigures(runId) {
    let client;
    let taskId = '';
    let controller = null;
    const assertCurrent = () => {
      if (runId !== state.runId || controller?.signal.aborted) {
        throw new DOMException('Superseded', 'AbortError');
      }
    };
    try {
      assertCurrent();
      controller = new AbortController();
      state.nativeFigureAbortController?.abort?.();
      state.nativeFigureAbortController = controller;
      client = SciLLM.createPdfFigureNativeClient(chrome.runtime);
      const health = await client.health({ timeoutMs: 15000 });
      assertCurrent();
      if (!health?.available) {
        const error = new Error(String(health?.reason || 'PDF_FIGURE_ENGINE_UNAVAILABLE'));
        error.code = String(health?.reason || 'PDF_FIGURE_ENGINE_UNAVAILABLE');
        throw error;
      }
      if (runId !== state.runId) throw new DOMException('Superseded', 'AbortError');
      setPdfFigureEngineStatus('正在本机提取完整 Figure 与图注…', 'running');
      const pdfBytes = await pdfBytesForNativeFigures();
      assertCurrent();
      const documentFingerprint = await sha256PdfBytes(pdfBytes);
      assertCurrent();
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
        assertCurrent();
        const raw = result.figures[index];
        const image = await client.readImage({
          taskId: result.taskId,
          imageId: raw.imageId,
          byteLength: raw.byteLength,
          sha256: raw.sha256,
          mimeType: raw.mimeType
        });
        assertCurrent();
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
      const physicalFigures = SciLLM.normalizePdffigures2Figures(result.figures, {
        kind: supplementalPdfBinding ? 'supplemental' : 'main',
        documentFingerprint,
        extractorVersion: result.extractorVersion,
        imageByIndex
      });
      const figures = SciLLM.groupSupplementalPdfFigureRegions(physicalFigures);
      const runtimeImageByFigureId = {};
      SciLLM.supplementalPdfSourceImageEntries({ figures }).forEach(figure => {
        runtimeImageByFigureId[figure.figureId] =
          runtimeImageByFigureIndex[figure.sourceIndex] || '';
      });
      const manifest = SciLLM.createPdfFigureManifest(figures, {
        status: 'ready',
        documentFingerprint,
        extractorVersion: result.extractorVersion
      });
      assertCurrent();
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
    const source = await capturePdfUploadSource(runId);
    const body = mineruRequestBody();
    let taskId = '';
    if (source.file instanceof Blob || canRelayBrowserSessionSource()) {
      setProgress(10, '正在申请 PDF 安全上传地址…');
      const created = await apiJson(`${SciLLM.PDF_MINERU_AGENT_BASE}/parse/file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, file_name: source.fileName })
      });
      taskId = String(created.task_id || '');
      if (!taskId || !created.file_url) throw new Error('PDF_MINERU_UPLOAD_URL_MISSING');
      setProgress(17, '正在上传 PDF 到 MinerU…');
      source.assertCurrent();
      await uploadPdfSource(created.file_url, source);
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
    const pageEvidence = pageEvidenceFromMineruEntries(entries, markdownEntry);
    const layoutEntry = [...entries.keys()].find(name => /(?:^|\/)layout\.json$/i.test(name));
    let ocrPages = [];
    if (layoutEntry) {
      const layoutBytes = entries.get(layoutEntry);
      if (layoutBytes.byteLength <= 32 * 1024 * 1024) {
        ocrPages = SciLLM.extractMineruLayoutTextPages(JSON.parse(new TextDecoder().decode(layoutBytes)));
      }
    }
    return { markdown, markdownUrl: zipUrl, entries, markdownEntry, pageEvidence, ocrPages };
  }

  async function parseWithPrecise(runId, settings = state.settings) {
    const source = await capturePdfUploadSource(runId);
    const body = {
      ...mineruRequestBody(settings),
      model_version: 'vlm'
    };
    let completed = null;
    if (source.file instanceof Blob || canRelayBrowserSessionSource()) {
      setProgress(10, '正在申请 MinerU 精准解析上传地址…');
      const created = await apiJson(
        `${SciLLM.PDF_MINERU_PRECISE_BASE}/file-urls/batch`,
        {
          method: 'POST',
          headers: preciseHeaders(),
          body: JSON.stringify({
            ...body,
            files: [{
              name: source.fileName,
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
      source.assertCurrent();
      await uploadPdfSource(uploadUrl, source);
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
      else if (token.type === 'em') node = document.createElement('em');
      else if (token.type === 'code') node = document.createElement('code');
      else if (token.type === 'sup') node = document.createElement('sup');
      else if (token.type === 'sub') node = document.createElement('sub');
      else if (token.type === 'overline') {
        node = document.createElement('span');
        node.className = 'pdf-inline-overline';
      }
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

  function normalizePdfPageBindingText(value) {
    return String(value || '').normalize('NFKC')
      .replace(/<\/?[^>]+>/gu, ' ')
      .replace(/!\[([^\]]*)\]\([^)]+\)/gu, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/gu, '$1')
      .replace(/[\\`*_#$^{}\[\]|<>]+/gu, ' ')
      .replace(/[^\p{L}\p{N}+%<>=\-−±μ]+/gu, ' ')
      .replace(/\s+/gu, ' ').trim().toLowerCase();
  }

  function pageEvidenceFromMineruEntries(entries, markdownEntry) {
    if (!(entries instanceof Map)) return [];
    const markdownDirectory = String(markdownEntry || '').includes('/')
      ? String(markdownEntry).replace(/\/[^/]*$/u, '') : '';
    const names = [...entries.keys()].filter(name =>
      /(?:^|\/)[^/]*content_list\.json$/iu.test(String(name || '')) &&
      !/_v\d+\.json$/iu.test(String(name || ''))
    );
    const selected = names.find(name =>
      !markdownDirectory || String(name).startsWith(`${markdownDirectory}/`)
    ) || names[0];
    const bytes = selected ? entries.get(selected) : null;
    if (!bytes || Number(bytes.byteLength || bytes.length) > 32 * 1024 * 1024) return [];
    try {
      const records = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      if (!Array.isArray(records) || records.length > 100000) return [];
      return records.flatMap(record => {
        if (!record || !Number.isSafeInteger(record.page_idx) || record.page_idx < 0) return [];
        const text = [
          record.text,
          String(record.table_body || '').replace(/<[^>]+>/gu, ' '),
          ...(Array.isArray(record.img_caption) ? record.img_caption : []),
          ...(Array.isArray(record.table_caption) ? record.table_caption : []),
          ...(Array.isArray(record.table_footnote) ? record.table_footnote : [])
        ].map(value => String(value || '').replace(/\s+/gu, ' ').trim())
          .filter(Boolean).join(' ');
        return text ? [{ pageNumber: record.page_idx + 1, text }] : [];
      });
    } catch (_) {
      return [];
    }
  }

  function parsedBlockPageBindingTexts(block) {
    if (!block || typeof block !== 'object') return [];
    if (block.type === 'list') {
      return (block.items || []).map(item => String(item?.text || '')).filter(Boolean);
    }
    if (block.type === 'table') {
      return [
        ...(block.header || []),
        ...(block.rows || []).flat()
      ].map(value => String(value || '')).filter(Boolean);
    }
    return [block.text, block.alt].map(value => String(value || '')).filter(Boolean);
  }

  function bindParsedBlocksToPdfPages(blocks, inputEvidence, pageCount) {
    const maximumPage = Number.isSafeInteger(pageCount) && pageCount > 0 ? pageCount : 0;
    if (!maximumPage) return (Array.isArray(blocks) ? blocks : []).map(block => ({ ...block }));
    const pages = new Map();
    (Array.isArray(inputEvidence) ? inputEvidence : []).forEach(record => {
      if (!record || !Number.isSafeInteger(record.pageNumber) || record.pageNumber < 1 ||
          record.pageNumber > maximumPage) return;
      const text = normalizePdfPageBindingText(record.text);
      if (!text) return;
      const values = pages.get(record.pageNumber) || [];
      values.push(text);
      pages.set(record.pageNumber, values);
    });
    const pageTexts = [...pages].map(([pageNumber, values]) => ({
      pageNumber,
      values,
      text: values.join(' ')
    }));

    function pageForText(value) {
      const target = normalizePdfPageBindingText(value);
      if (target.length < 2) return 0;
      const exact = pageTexts.filter(page =>
        page.values.some(source => source === target || source.includes(target))
      );
      if (exact.length === 1) return exact[0].pageNumber;
      if (exact.length > 1) return 0;
      if (target.length < 24) return 0;
      const boundary = Math.min(120, Math.max(24, Math.floor(target.length / 3)));
      const start = target.slice(0, boundary).trim();
      const end = target.slice(-boundary).trim();
      const partial = pageTexts.filter(page =>
        start.length >= 20 && end.length >= 20 && page.values.some(source => {
          const startIndex = source.indexOf(start);
          const endIndex = source.indexOf(end, Math.max(0, startIndex + start.length));
          return startIndex >= 0 && endIndex >= startIndex + start.length;
        })
      );
      return partial.length === 1 ? partial[0].pageNumber : 0;
    }

    function bindBlock(block) {
      const next = { ...block };
      delete next.pageNumber;
      if (Array.isArray(block?.items)) {
        next.items = block.items.map(item => {
          const pageNumber = pageForText(item?.text);
          const rebound = { ...item };
          delete rebound.pageNumber;
          return pageNumber ? { ...rebound, pageNumber } : rebound;
        });
      }
      const candidates = parsedBlockPageBindingTexts(next)
        .map(pageForText).filter(pageNumber => pageNumber > 0);
      const frequencies = new Map();
      candidates.forEach(pageNumber =>
        frequencies.set(pageNumber, (frequencies.get(pageNumber) || 0) + 1)
      );
      const ranked = [...frequencies].sort((left, right) =>
        right[1] - left[1] || left[0] - right[0]
      );
      if (ranked.length && (ranked.length === 1 || ranked[0][1] > ranked[1][1])) {
        next.pageNumber = ranked[0][0];
      }
      return next;
    }
    return (Array.isArray(blocks) ? blocks : []).map(bindBlock);
  }

  function parsedPageBindingIdentity(nativeDocument) {
    const documentHash = String(nativeDocument?.structure?.documentHash || '')
      .trim().toLowerCase();
    const documentId = String(nativeDocument?.structure?.documentId || '').trim().toLowerCase();
    const identityMatch = /^sha256:([a-f0-9]{64})$/u.exec(documentId);
    const pageCount = nativeDocument?.pageCount;
    if (!/^[a-f0-9]{64}$/u.test(documentHash) || !identityMatch ||
        identityMatch[1] !== documentHash ||
        !Number.isSafeInteger(pageCount) || pageCount < 1) return null;
    return { documentHash, documentIdentity: identityMatch[1], pageCount };
  }

  function parsedPageBindingContentHash(blocks) {
    const canonical = (Array.isArray(blocks) ? blocks : []).map(block => ({
      id: String(block?.id || ''), type: String(block?.type || ''),
      level: Number(block?.level) || 0, ordered: block?.ordered === true,
      text: String(block?.text || ''), markdown: String(block?.markdown || ''),
      alt: String(block?.alt || ''),
      header: (block?.header || []).map(value => String(value || '')),
      rows: (block?.rows || []).map(row => (row || []).map(value => String(value || ''))),
      items: (block?.items || []).map(item => ({
        text: String(item?.text || ''), markdown: String(item?.markdown || '')
      }))
    }));
    const text = JSON.stringify(canonical);
    const hash = seed => {
      let value = seed >>> 0;
      for (let index = 0; index < text.length; index += 1) {
        value ^= text.charCodeAt(index);
        value = Math.imul(value, 16777619);
      }
      return (value >>> 0).toString(16).padStart(8, '0');
    };
    return `${hash(2166136261)}${hash(2246822507)}`;
  }

  function parsedPageBindingSnapshotQuality(snapshot) {
    if (!snapshot || snapshot.schemaVersion !== 2 ||
        !/^[a-f0-9]{64}$/u.test(String(snapshot.documentHash || '')) ||
        snapshot.documentIdentity !== snapshot.documentHash ||
        !/^[a-f0-9]{16}$/u.test(String(snapshot.contentHash || '')) ||
        !Number.isSafeInteger(snapshot.pageCount) || snapshot.pageCount < 1 ||
        snapshot.textReady !== true || !Array.isArray(snapshot.bindings)) return null;
    let coverage = 0;
    const ids = new Set();
    for (const binding of snapshot.bindings) {
      const id = String(binding?.id || '');
      const itemPages = binding?.itemPages;
      if (!/^pdf-block-[1-9]\d*$/u.test(id) || ids.has(id) ||
          !Number.isSafeInteger(binding?.pageNumber) || binding.pageNumber < 0 ||
          binding.pageNumber > snapshot.pageCount || !Array.isArray(itemPages) ||
          itemPages.some(value => !Number.isSafeInteger(value) || value < 0 ||
            value > snapshot.pageCount)) return null;
      ids.add(id);
      coverage += (binding.pageNumber > 0 ? 1 : 0) +
        itemPages.filter(value => value > 0).length;
    }
    if (coverage < 1 || snapshot.coverage !== coverage) return null;
    return { textReady: snapshot.textReady, coverage };
  }

  function createParsedPageBindingSnapshot(blocks, nativeDocument) {
    if (nativeDocument?.phase !== 'text-ready') return null;
    const identity = parsedPageBindingIdentity(nativeDocument);
    if (!identity) return null;
    const contentHash = parsedPageBindingContentHash(blocks);
    const bindings = [];
    const ids = new Set();
    for (const block of Array.isArray(blocks) ? blocks : []) {
      const id = String(block?.id || '');
      if (!/^pdf-block-[1-9]\d*$/u.test(id) || ids.has(id)) return null;
      ids.add(id);
      const pageNumber = block?.pageNumber;
      const itemPages = Array.isArray(block?.items)
        ? block.items.map(item => Number.isSafeInteger(item?.pageNumber) &&
          item.pageNumber > 0 && item.pageNumber <= identity.pageCount ? item.pageNumber : 0)
        : [];
      if (Number.isSafeInteger(pageNumber) && pageNumber > 0 &&
          pageNumber <= identity.pageCount) {
        bindings.push({ id, pageNumber, itemPages });
      } else if (itemPages.some(value => value > 0)) {
        bindings.push({ id, pageNumber: 0, itemPages });
      }
    }
    if (!bindings.length) return null;
    const coverage = bindings.reduce((total, binding) => total +
      (binding.pageNumber > 0 ? 1 : 0) + binding.itemPages.filter(value => value > 0).length, 0);
    return Object.freeze({
      schemaVersion: 2, ...identity, contentHash,
      textReady: true, coverage, bindings
    });
  }

  function applyParsedPageBindingSnapshot(blocks, snapshot, nativeDocument) {
    const source = (Array.isArray(blocks) ? blocks : []).map(block => ({
      ...block,
      ...(Array.isArray(block?.items)
        ? { items: block.items.map(item => ({ ...item })) } : {})
    }));
    source.forEach(block => {
      delete block.pageNumber;
      block.items?.forEach(item => delete item.pageNumber);
    });
    const identity = parsedPageBindingIdentity(nativeDocument);
    const quality = parsedPageBindingSnapshotQuality(snapshot);
    if (!identity || nativeDocument?.phase !== 'text-ready' || !quality ||
        snapshot.documentHash !== identity.documentHash ||
        snapshot.documentIdentity !== identity.documentIdentity ||
        snapshot.pageCount !== identity.pageCount ||
        snapshot.contentHash !== parsedPageBindingContentHash(source)) {
      return source;
    }
    const bindings = new Map();
    for (const binding of snapshot.bindings) {
      const id = String(binding?.id || '');
      const pageNumber = binding?.pageNumber;
      const itemPages = Array.isArray(binding?.itemPages) ? binding.itemPages : [];
      if (!/^pdf-block-[1-9]\d*$/u.test(id) || bindings.has(id) ||
          !Number.isSafeInteger(pageNumber) || pageNumber < 0 ||
          pageNumber > identity.pageCount || itemPages.some(value =>
            !Number.isSafeInteger(value) || value < 0 || value > identity.pageCount
          )) return source;
      bindings.set(id, { pageNumber, itemPages });
    }
    return source.map(block => {
      const binding = bindings.get(String(block.id || ''));
      if (!binding) return block;
      if (binding.pageNumber > 0) block.pageNumber = binding.pageNumber;
      block.items?.forEach((item, index) => {
        if (binding.itemPages[index] > 0) item.pageNumber = binding.itemPages[index];
      });
      return block;
    });
  }

  function parsedPageBindingStorageKey(documentHash) {
    return `sciPdfParsedPageBindingsV1:${documentHash}`;
  }

  async function persistParsedPageBindingSnapshot(snapshot) {
    if (!parsedPageBindingSnapshotQuality(snapshot)) return false;
    const key = parsedPageBindingStorageKey(snapshot.documentHash);
    await chrome.storage.local.set({ [key]: snapshot });
    return true;
  }

  function applyPdfPageBinding(node, block, pageCount) {
    const pageNumber = block?.pageNumber;
    if (Number.isSafeInteger(pageNumber) && pageNumber > 0 &&
        Number.isSafeInteger(pageCount) && pageNumber <= pageCount) {
      node.dataset.pdfPageNumber = String(pageNumber);
    } else if (node?.dataset) {
      delete node.dataset.pdfPageNumber;
    }
    return node;
  }

  function appendPageBoundBlock(article, node, block, pageCount) {
    applyPdfPageBinding(node, block, pageCount);
    article.appendChild(node);
    return node;
  }

  async function waitForOriginalPdfIndex(currentSource = workspaceSourceUrl(), expectedHash = '') {
    expectedHash ||= currentSource.match(/^file:\/\/\/brevess-local-pdf\/([a-f0-9]{64})\//)?.[1] || '';
    const initialGeneration = globalThis.__brevessNativePdfDocument?.documentGeneration;
    const failure = state.nativeReaderFailure;
    if (failure?.sourceUrl === currentSource &&
        (!failure.documentGeneration || !initialGeneration || failure.documentGeneration === initialGeneration) &&
        (!failure.documentHash || !expectedHash || failure.documentHash === expectedHash)) {
      throw new Error(failure.message);
    }
    const ready = () => {
      const native = globalThis.__brevessNativePdfDocument;
      return ['text-ready', 'partial-index'].includes(native?.phase) &&
        (!expectedHash || native?.structure?.documentHash === expectedHash);
    };
    if (!ready()) await new Promise((resolve, reject) => {
      const finish = error => {
        clearTimeout(timer);
        document.removeEventListener('brevess:native-pdf-ready', check);
        document.removeEventListener('brevess:native-pdf-error', fail);
        document.removeEventListener('brevess:pdf-source-changing', supersede);
        error ? reject(error) : resolve();
      };
      const supersede = () => finish(new DOMException('Superseded', 'AbortError'));
      const fail = event => {
        const detail = event?.detail || {};
        const current = globalThis.__brevessNativePdfDocument;
        if (detail.sourceUrl && detail.sourceUrl !== currentSource) return;
        if (detail.documentGeneration && current?.documentGeneration &&
            detail.documentGeneration !== current.documentGeneration) return;
        if (detail.documentHash && expectedHash && detail.documentHash !== expectedHash) return;
        finish(new Error(String(detail.message || 'PDF_NATIVE_READER_FAILED')));
      };
      const check = () => {
        const current = globalThis.__brevessNativePdfDocument;
        if (currentSource !== workspaceSourceUrl()) finish(new Error('PDF_OCR_SOURCE_MISMATCH'));
        else if (initialGeneration && current?.documentGeneration &&
            initialGeneration !== current.documentGeneration) supersede();
        else if (ready()) finish();
      };
      const timer = setTimeout(() => finish(new Error('PDF_OCR_ORIGINAL_NOT_READY')), 120000);
      document.addEventListener('brevess:native-pdf-ready', check);
      document.addEventListener('brevess:native-pdf-error', fail);
      document.addEventListener('brevess:pdf-source-changing', supersede);
      check();
    });
    if (currentSource !== workspaceSourceUrl()) throw new Error('PDF_OCR_SOURCE_MISMATCH');
    return globalThis.__brevessNativePdfDocument;
  }

  async function applyParsedOcrToOriginal(parsed) {
    if (!parsed?.ocrTextLayer?.pages?.length && !parsed?.ocrPages?.length) {
      if (parsed?.requiresCoordinateOcr) throw new Error('PDF_OCR_COORDINATES_MISSING');
      return null;
    }
    const native = await waitForOriginalPdfIndex(workspaceSourceUrl(),
      parsed?.ocrTextLayer?.documentHash || parsed?.originalDocumentHash || '');
    const binding = parsed.ocrTextLayer || { schemaVersion: 1,
      documentHash: native.structure.documentHash,
      pages: parsed.ocrPages };
    const result = await nativeReaderCommand('installOcrTextLayer', binding);
    if (!Array.isArray(result?.installedPages)) throw new Error('PDF_OCR_TEXT_LAYER_UNAVAILABLE');
    if (result?.installedPages?.length) {
      setPdfFigureEngineStatus(`已为 ${result.installedPages.length} 页补充 OCR 文字层；文字与坐标来自 MinerU，基线位置为近似，请核对原页。`, 'ready');
    }
    return binding;
  }

  async function renderParsedDocument(parsed) {
    const renderSource = workspaceSourceUrl();
    const renderRunId = state.runId;
    const assertRenderCurrent = () => {
      if (renderSource !== workspaceSourceUrl() || renderRunId !== state.runId) {
        throw new Error('PDF_OCR_SOURCE_MISMATCH');
      }
    };
    // Attach the rejection handler immediately: native initialization can fail
    // before the deferred workspace refresh runs. Keep the failure explicit
    // when that refresh consumes the outcome, without an unhandled rejection.
    const ocrInstallation = applyParsedOcrToOriginal(parsed).then(
      value => ({ value }), error => ({ error })
    );
    const nativeDocument = globalThis.__brevessNativePdfDocument;
    const pageCount = Number.isSafeInteger(nativeDocument?.pageCount) &&
      nativeDocument.pageCount > 0 ? nativeDocument.pageCount : 0;
    const sourceEvidence = [
      ...(Array.isArray(parsed?.pageEvidence) ? parsed.pageEvidence : []),
      ...(Array.isArray(nativeDocument?.structure?.paragraphs)
        ? nativeDocument.structure.paragraphs : [])
    ];
    const cachedBlocks = applyParsedPageBindingSnapshot(
      SciLLM.markdownToPdfBlocks(parsed.markdown), parsed?.pageBindingSnapshot, nativeDocument
    );
    const sourceBlocks = bindParsedBlocksToPdfPages(
      cachedBlocks, sourceEvidence, pageCount
    );
    const bindingSnapshot = createParsedPageBindingSnapshot(sourceBlocks, nativeDocument);
    if (bindingSnapshot && parsed?.restored !== true) {
      void persistParsedPageBindingSnapshot(bindingSnapshot).catch(() => false);
    }
    const mineruBlocks = SciLLM.cleanPdfReflowBlocks(
      SciLLM.normalizePdfDocumentBlocks(
        sourceBlocks
      )
    );
    const nativeManifest = parsed?.pdfFigureManifest &&
      parsed.pdfFigureManifest.status === 'ready'
      ? parsed.pdfFigureManifest : null;
    const nativeFigures = Array.isArray(nativeManifest?.figures)
      ? nativeManifest.figures : [];
    const nativePlan = nativeFigures.length
      ? SciLLM.buildPdfFigureArticlePlan(mineruBlocks, nativeFigures, {
          isCaptionContinuationText: SciLLM.isPdfCaptionContinuationText
        })
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
    const readerTitle = state.documentTitle || applyPdfReaderDocumentTitle();
    const hasDocumentHeading = blocks.some(block =>
      block.type === 'heading' && !SciLLM.isPdfFigureCaptionText(block.text) &&
      block.text === title
    );
    if (!hasDocumentHeading) {
      const documentHeading = document.createElement('h1');
      documentHeading.dataset.brevessDocumentTitle = 'true';
      documentHeading.textContent = title;
      const [titleBinding] = bindParsedBlocksToPdfPages(
        [{ type: 'heading', text: title }], sourceEvidence, pageCount
      );
      appendPageBoundBlock(article, documentHeading, titleBinding, pageCount);
    }

    function renderNativeFiguresAt(anchorIndex) {
      (nativeFiguresByAnchor.get(anchorIndex) || []).forEach((nativeFigure, index) => {
        const figure = document.createElement('figure');
        figure.dataset.brevessPdfFigure = 'true';
        figure.dataset.pdfFigureSource = 'pdffigures2';
        figure.dataset.figureId = String(nativeFigure.figureId || '');
        figure.dataset.figureLabel = String(nativeFigure.figureLabel || '');
        const nativePageIndex = nativeFigure.pageIndex;
        const nativePageNumber = Number.isSafeInteger(nativePageIndex) && nativePageIndex >= 0
          ? nativePageIndex + 1 : 0;
        if (nativePageNumber) figure.dataset.pdfPageIndex = String(nativePageIndex);
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
        appendPageBoundBlock(
          article, figure, { pageNumber: nativePageNumber }, pageCount
        );
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
        appendPageBoundBlock(
          article, figure, blocks[figureGroup.captionIndex] || block, pageCount
        );
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
        appendPageBoundBlock(article, wrapper, block, pageCount);
        return;
      }
      if (block.type === 'heading') {
        const heading = document.createElement(`h${block.level}`);
        appendMarkdownInline(heading, block.markdown || block.text);
        heading.id = safeReaderAnchorId(block.text, 'pdf-section', blockIndex);
        if (!SciLLM.isPdfFigureCaptionText(block.text) && block.text === title) {
          heading.dataset.brevessDocumentTitle = 'true';
        }
        appendPageBoundBlock(article, heading, block, pageCount);
      } else if (block.type === 'code') {
        const pre = document.createElement('pre');
        pre.textContent = block.text;
        appendPageBoundBlock(article, pre, block, pageCount);
      } else if (block.type === 'list') {
        const list = SciLLM.renderPdfListBlock(document, block, appendMarkdownInline);
        [...list.children].forEach((item, index) =>
          applyPdfPageBinding(item, block.items?.[index], pageCount)
        );
        appendPageBoundBlock(article, list, block, pageCount);
      } else if (block.type === 'blockquote') {
        const quote = document.createElement('blockquote');
        appendMarkdownInline(quote, block.markdown || block.text);
        appendPageBoundBlock(article, quote, block, pageCount);
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
        appendPageBoundBlock(article, table, block, pageCount);
      } else if (block.type === 'divider') {
        appendPageBoundBlock(
          article, document.createElement('hr'), block, pageCount
        );
      } else {
        const paragraph = document.createElement('p');
        appendMarkdownInline(paragraph, block.markdown || block.text);
        paragraph.id = `pdf-paragraph-${++paragraphIndex}`;
        paragraph.dataset.pdfParagraphIndex = String(paragraphIndex);
        appendPageBoundBlock(article, paragraph, block, pageCount);
      }
    });
    renderNativeFiguresAt(blocks.length);

    if (!article.querySelector('p, h1, h2, h3, h4, h5, h6')) {
      throw new Error('PDF_MARKDOWN_EMPTY');
    }
    document.title = readerTitle;
    document.querySelector('title')?.setAttribute('data-i18n-ignore', '');
    setPdfReaderSubtitle(`${readerTitle} · PDF 解析工作区`);
    document.documentElement.dataset.pdfWorkspaceRendered = 'true';
    document.documentElement.dataset.pdfWorkspaceReady = 'false';
    document.documentElement.dataset.pdfSourceUrl = workspaceSourceUrl();
    setProgress(90, '正在补充原页文字层并保存解析结果…', '正在完成文本识别');
    element('pdfReaderControl').dataset.state = 'loading';
    element('pdfReaderViewToggle').hidden = true;
    element('pdfReaderReparse').hidden = false;
    setReaderView('parsed');
    const requestedHashTarget = document.getElementById(
      decodeURIComponent(String(location.hash || '').replace(/^#/, ''))
    );
    if (requestedHashTarget) requestAnimationFrame(() =>
      jumpToReaderTarget(requestedHashTarget, { remember: false })
    );
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
    const outcome = await ocrInstallation;
    assertRenderCurrent();
    if (typeof globalThis.refreshParsedPdfWorkspace !== 'function') {
      throw new Error('PDF_WORKSPACE_INDEX_UNAVAILABLE');
    }
    // Retain parsed evidence even if no usable coordinate text layer was
    // returned. A failed OCR installation must never discard the paid result.
    const workspaceResult = await globalThis.refreshParsedPdfWorkspace({
        title: readerTitle,
        sourceUrl: renderSource,
        originalDocumentHash: globalThis.__brevessNativePdfDocument?.structure?.documentHash,
        markdown: String(parsed.markdown || ''),
        paragraphCount: article.querySelectorAll('p').length,
        figureCount: article.querySelectorAll('figure[data-brevess-pdf-figure]').length,
        cachedImageByReference: cachedImages.images,
        cachedImageCount: cachedImages.cachedImageCount,
        omittedImageCount: cachedImages.omittedImageCount,
        cachedImageBytes: cachedImages.cachedBytes,
        pdfFigureManifest: nativeManifest,
        ocrTextLayer: outcome.value || parsed.ocrTextLayer || (parsed.ocrPages?.length ? {
          schemaVersion: 1,
          documentHash: parsed.originalDocumentHash || globalThis.__brevessNativePdfDocument?.structure?.documentHash,
          pages: parsed.ocrPages
        } : null),
        ocrError: String(outcome.error?.message || ''),
        pdfFigureBinaryAssets: Array.isArray(parsed?.pdfFigureBinaryAssets)
          ? parsed.pdfFigureBinaryAssets : []
      });
    assertRenderCurrent();
    if (!workspaceResult?.success) throw new Error('PDF_WORKSPACE_INDEX_FAILED');
    document.documentElement.dataset.pdfOcrError = String(outcome.error?.message || '');
    element('pdfReaderControl').dataset.state = outcome.error ? 'error' : 'ready';
    setProgress(100, outcome.error
      ? '解析结果已保存，但原页文字层未能建立。可重试增强识别；原始 PDF 仍可正常阅读。'
      : '辅助文本与 Figure 已保存；继续在 PDF 原页上阅读。',
      outcome.error ? '文字层增强未完成' : '文本识别已完成');
    if (outcome.error) showReaderActions({ retry: true, settings: true });
    chrome.runtime.sendMessage({
      type: 'PDF_WORKSPACE_READY', sourceUrl: renderSource, title: readerTitle,
      paragraphCount: workspaceResult.paragraphCount,
      figureCount: workspaceResult.figureCount,
      indexed: workspaceResult.indexed !== false,
      ocrError: String(outcome.error?.message || ''), mineruQuotaText: state.quotaText
    }).catch(() => undefined);
    if (supplementalPdfBinding) {
      // Parsing is the import boundary. Sync the complete inventory now so the
      // parent article can show and analyze supplemental figures immediately;
      // later Figure analyses overwrite the same asset with richer results.
      setTimeout(() => {
        void syncParsedSupplementalInventory({
          schemaVersion: 1,
          originalDocumentHash: parsed.originalDocumentHash,
          title: readerTitle,
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
        }).then(syncResult => {
          document.documentElement.dataset.pdfSupplementalSync = 'synced';
          if (headlessSupplementalImport) {
            return reportHeadlessSupplementalImport('complete', {
              figureCount: syncResult?.figureCount,
              panelCount: importedPanelCount(),
              sourceImagePersistence: syncResult?.sourceImagePersistence || null,
              relativePath: syncResult?.relativePath || ''
            }).then(() => closeHeadlessSupplementalReader());
          }
          return syncResult;
        }).catch(error => {
          document.documentElement.dataset.pdfSupplementalSync = 'error';
          document.documentElement.dataset.pdfSupplementalSyncError = String(
            error?.message || error || 'SUPPLEMENTAL_PARENT_SYNC_FAILED'
          ).slice(0, 200);
          console.warn('Brevess: 补充图目录同步失败', error?.message || error);
          if (headlessSupplementalImport) {
            void reportHeadlessSupplementalImport('error', {
              message: error?.message || 'SUPPLEMENTAL_PARENT_SYNC_FAILED',
              code: error?.code || 'SUPPLEMENTAL_PARENT_SYNC_FAILED'
            }).then(() => closeHeadlessSupplementalReader());
          }
        });
      }, 0);
    }
    return { ...workspaceResult, ocrError: outcome.error || null };
  }

  async function restoreCachedPdfDocument() {
    if (supplementalPdfBinding ||
        typeof globalThis.getWorkspaceAssetCheckpoint !== 'function') return false;
    try {
      await waitForOriginalPdfIndex();
      const asset = await globalThis.getWorkspaceAssetCheckpoint('pdf/document.json');
      const saved = asset?.content && typeof asset.content === 'object'
        ? asset.content : null;
      const markdown = String(saved?.markdown || '').trim();
      if (!markdown) return false;
      const savedSource = SciLLM.normalizePdfSourceUrl(saved?.sourceUrl);
      if (savedSource && savedSource !== workspaceSourceUrl()) return false;
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
      const cachedParsedDocument = {
        markdown,
        markdownUrl: '',
        entries: null,
        markdownEntry: '',
        cachedImageByReference: saved.cachedImageByReference || {},
        ocrTextLayer: saved.ocrTextLayer || null,
        originalDocumentHash: saved.originalDocumentHash || '',
        requiresCoordinateOcr: Boolean(saved.ocrError),
        pdfFigureManifest,
        runtimeImageByFigureId,
        restored: true
      };
      const restoredResult = await renderParsedDocument(cachedParsedDocument);
      void restoreCachedPageBindingsAfterNativeReady(cachedParsedDocument);
      if (SciLLM.pdfFigureManifestNeedsRefresh?.(pdfFigureManifest)) {
        document.documentElement.dataset.pdfFigureCacheUpgrade = 'pending';
        setTimeout(() => {
          void refreshCachedNativeFigures(saved).catch(() => undefined);
        }, 0);
      }
      document.documentElement.dataset.pdfWorkspaceRestored = 'true';
      if (restoredResult.ocrError) return true;
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
    } catch (error) {
      document.documentElement.dataset.pdfWorkspaceIndexError = String(error?.message || 'PDF_CACHE_RESTORE_FAILED');
      element('pdfReaderControl').dataset.state = 'error';
      setProgress(6, '解析缓存未能恢复，原始 PDF 可继续阅读。可重试增强识别。', '缓存恢复未完成');
      showReaderActions({ retry: true, settings: true });
      return true;
    }
  }

  async function restoreCachedPageBindingsAfterNativeReady(parsed) {
    state.parsedPageBindingCleanup?.();
    const capturedRunId = state.runId;
    let complete = false;
    let disposed = false;
    let inFlight = null;
    let rerunRequested = false;
    let expectedGeneration = 0;
    let expectedIdentity = null;
    let renderedSignature = '';
    const cleanup = () => {
      if (disposed) return;
      disposed = true;
      document.removeEventListener('brevess:native-pdf-ready', onReady);
      if (state.parsedPageBindingCleanup === cleanup) {
        state.parsedPageBindingCleanup = null;
      }
    };
    const attemptOnce = async () => {
      if (complete || disposed || state.runId !== capturedRunId) return complete;
      const nativeDocument = globalThis.__brevessNativePdfDocument;
      const identity = parsedPageBindingIdentity(nativeDocument);
      const generation = Number(nativeDocument?.documentGeneration);
      if (!identity || !Number.isSafeInteger(generation) || generation < 1) return false;
      if (!expectedIdentity) {
        expectedIdentity = identity;
        expectedGeneration = generation;
      } else if (generation !== expectedGeneration ||
          identity.documentHash !== expectedIdentity.documentHash ||
          identity.documentIdentity !== expectedIdentity.documentIdentity ||
          identity.pageCount !== expectedIdentity.pageCount) {
        cleanup();
        return false;
      }
      const key = parsedPageBindingStorageKey(identity.documentHash);
      const stored = await chrome.storage.local.get(key);
      const currentNative = globalThis.__brevessNativePdfDocument;
      const currentIdentity = parsedPageBindingIdentity(currentNative);
      if (disposed || state.runId !== capturedRunId ||
          Number(currentNative?.documentGeneration) !== expectedGeneration ||
          !currentIdentity || currentIdentity.documentHash !== expectedIdentity.documentHash ||
          currentIdentity.documentIdentity !== expectedIdentity.documentIdentity ||
          currentIdentity.pageCount !== expectedIdentity.pageCount) return false;
      const snapshot = stored?.[key];
      const cached = applyParsedPageBindingSnapshot(
        SciLLM.markdownToPdfBlocks(parsed?.markdown || ''), snapshot, currentNative
      );
      const rebound = bindParsedBlocksToPdfPages(
        cached,
        Array.isArray(currentNative?.structure?.paragraphs)
          ? currentNative.structure.paragraphs : [],
        identity.pageCount
      );
      const finalReady = currentNative.phase === 'text-ready';
      const refreshedSnapshot = createParsedPageBindingSnapshot(rebound, currentNative);
      const signature = refreshedSnapshot
        ? `${refreshedSnapshot.contentHash}:${refreshedSnapshot.textReady}:${refreshedSnapshot.coverage}`
        : 'final-unbound';
      if (finalReady && signature !== renderedSignature && !disposed &&
          state.runId === capturedRunId) {
        renderedSignature = signature;
        await renderParsedDocument({
          ...parsed,
          pageBindingSnapshot: refreshedSnapshot || null,
          restored: true
        });
        if (refreshedSnapshot) await persistParsedPageBindingSnapshot(refreshedSnapshot);
      }
      complete = finalReady;
      return complete;
    };
    const attempt = () => {
      if (inFlight) {
        rerunRequested = true;
        return inFlight;
      }
      inFlight = (async () => {
        let restored = false;
        do {
          rerunRequested = false;
          restored = await attemptOnce();
        } while (!restored && rerunRequested && !disposed &&
          state.runId === capturedRunId);
        return restored;
      })().finally(() => { inFlight = null; });
      return inFlight;
    };
    const onReady = () => {
      void attempt().then(restored => {
        if (restored) cleanup();
      }).catch(() => false);
    };
    document.addEventListener('brevess:native-pdf-ready', onReady);
    state.parsedPageBindingCleanup = cleanup;
    if (await attempt().catch(() => false)) {
      cleanup();
      return true;
    }
    return false;
  }

  async function refreshCachedNativeFigures(saved) {
    const markdown = String(saved?.markdown || '').trim();
    if (!markdown) return false;
    state.parsedPageBindingCleanup?.();
    const runId = ++state.runId;
    try {
      if (isLocalSource && !state.localFile) await loadOpenedLocalPdf();
      state.nativePdfBytesPromise = null;
      setPdfFigureEngineStatus(
        '正在用新版完整图引擎升级旧缓存；正文不会重新发送到 MinerU…'
      );
      const nativeFigures = await extractWholePdfFigures(runId);
      if (runId !== state.runId || !nativeFigures?.manifest?.figureCount) return false;
      await renderParsedDocument({
        markdown,
        markdownUrl: '',
        entries: null,
        markdownEntry: '',
        cachedImageByReference: saved.cachedImageByReference || {},
        ocrTextLayer: saved.ocrTextLayer || null,
        originalDocumentHash: saved.originalDocumentHash || '',
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
    const figures = SciLLM.supplementalPdfSourceImageEntries(manifest);
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
    await renderParsedDocument({
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
    if (/^PDF_UPLOAD_(?:ORIGINAL_NOT_READY|SOURCE_HASH_MISMATCH)$/.test(code)) {
      return '尚未取得与当前原页一致的 PDF 文件，未提交增强识别。请等待原页读取完成，或重新选择当前 PDF 后重试。';
    }
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

  function setPdfEnhancementState(phase, error = '') {
    const data = document.documentElement.dataset;
    const previousError = data.pdfEnhancementError;
    if (previousError && data.pdfErrorCode === previousError) delete data.pdfErrorCode;
    data.pdfEnhancementState = phase;
    if (error) data.pdfEnhancementError = String(error).slice(0, 160);
    else delete data.pdfEnhancementError;
    const control = element('pdfReaderControl');
    control.dataset.state = phase === 'running' ? 'loading'
      : ['blocked', 'error'].includes(phase) ? 'error' : 'idle';
    if (phase === 'ready' && data.pdfWorkspaceIndexError) {
      control.dataset.state = 'error';
      setProgress(100, '增强识别已完成，但文字索引尚未保存成功。原页仍可阅读，请重试保存或重新打开。',
        '文字索引保存未完成');
    }
    control.hidden = phase === 'ready' && data.pdfWorkspaceReady === 'true' &&
      !data.pdfWorkspaceIndexError;
  }

  async function importLocalSupplementalPdfSource() {
    const runId = ++state.runId;
    const assertCurrent = () => {
      if (state.runId !== runId) throw new DOMException('Superseded', 'AbortError');
    };
    try {
      await reportHeadlessSupplementalImport('parsing', { message: '正在本机提取补图与图注' });
      const native = await waitForOriginalPdfIndex();
      assertCurrent();
      const extracted = await extractWholePdfFigures(runId);
      assertCurrent();
      if (!extracted?.manifest?.figureCount) throw Object.assign(new Error('未能从原始 PDF 提取补图'), {
        code: 'PDF_FIGURE_NONE_FOUND'
      });
      if (native?.structure?.documentHash !== extracted.manifest.documentFingerprint) {
        throw Object.assign(new Error('PDF 来源已改变'), { code: 'PDF_OCR_SOURCE_MISMATCH' });
      }
      const markdown = (native.structure.paragraphs || []).map(paragraph =>
        String(paragraph.text || '').trim()).filter(Boolean).join('\n\n');
      if (!markdown) throw Object.assign(new Error('原始 PDF 没有可用文字层'), {
        code: 'PDF_WORKSPACE_PARAGRAPHS_EMPTY'
      });
      await renderParsedDocument({
        markdown, originalDocumentHash: extracted.manifest.documentFingerprint,
        pdfFigureManifest: extracted.manifest,
        runtimeImageByFigureId: extracted.runtimeImageByFigureId,
        pdfFigureBinaryAssets: extracted.binaryAssets
      });
      assertCurrent();
    } catch (error) {
      if (state.runId !== runId) return;
      state.nativeFigureAbortController?.abort?.();
      await reportHeadlessSupplementalImport('error', {
        message: error?.message || 'SUPPLEMENTAL_PDF_IMPORT_FAILED',
        code: error?.code || 'SUPPLEMENTAL_PDF_IMPORT_FAILED'
      });
      await closeHeadlessSupplementalReader();
    }
  }

  async function runParse() {
    if (headlessSupplementalImport) {
      await importLocalSupplementalPdfSource();
      return;
    }
    state.parsedPageBindingCleanup?.();
    const runId = ++state.runId;
    state.nativeFigureAbortController?.abort?.();
    setPdfEnhancementState('running');
    showReaderActions();
    setReaderView('parsed');
    setProgress(4, '正在准备 MinerU 解析…', '正在解析 PDF');
    try {
      const stored = await chrome.storage.local.get(SciLLM.PDF_MINERU_SETTINGS_KEY);
      if (runId !== state.runId) return;
      state.settings = SciLLM.normalizeMineruPdfSettings(
        stored?.[SciLLM.PDF_MINERU_SETTINGS_KEY]
      );
      let nativeSnapshot;
      try {
        nativeSnapshot = headlessSupplementalImport ? globalThis.__brevessNativePdfDocument
          : await waitForOriginalPdfIndex();
      } catch (error) {
        if (runId !== state.runId || error?.name === 'AbortError') return;
        setPdfEnhancementState('blocked', error?.message || 'PDF_OCR_ORIGINAL_NOT_READY');
        const waiting = error?.message === 'PDF_OCR_ORIGINAL_NOT_READY';
        setProgress(4, waiting
          ? '原始 PDF 尚未完成读取，增强识别没有启动。请稍后重试。'
          : `原页读取未完成：${String(error?.message || '读取失败')}。增强识别没有启动，请确认文件可打开后重试。`,
        waiting ? '等待原页就绪' : '原页读取失败');
        showReaderActions({ retry: true });
        return;
      }
      if (runId !== state.runId) return;
      const enhancementPlan = SciLLM.planOriginalPdfTextEnhancement(state.settings, nativeSnapshot);
      const settings = enhancementPlan.effectiveSettings;
      if (enhancementPlan.blocked) {
        setPdfEnhancementState('blocked', enhancementPlan.blockCode);
        setProgress(4, '扫描页需要带坐标的文字识别，请先在识别设置填写 MinerU Token。原始 PDF 可继续阅读。', '需要配置扫描页识别');
        showReaderActions({ retry: true, settings: true });
        return;
      }
      const originalDocumentHash = nativeSnapshot?.structure?.documentHash || '';
      await updateMineruQuotaStatus();
      if (runId !== state.runId) return;
      if (isLocalSource && !state.localFile) {
        try {
          await loadOpenedLocalPdf();
          if (runId !== state.runId) return;
        } catch (error) {
          if (runId !== state.runId || error?.name === 'AbortError') return;
          setPdfEnhancementState('blocked', error?.message || 'PDF_LOCAL_FILE_UNAVAILABLE');
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
        setPdfEnhancementState('blocked', 'PDF_MINERU_TOKEN_REQUIRED');
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
      const nativeFiguresPromise = extractWholePdfFigures(runId).catch(error => {
        if (runId !== state.runId) throw new DOMException('Superseded', 'AbortError');
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
        ? parseWithPrecise(runId, settings)
        : parseWithAgent(runId);
      const [parsed, nativeFigures] = await Promise.all([
        mineruPromise, nativeFiguresPromise
      ]);
      if (runId !== state.runId) return;
      parsed.originalDocumentHash = originalDocumentHash;
      parsed.requiresCoordinateOcr = enhancementPlan.requiresCoordinateOcr;
      await updateMineruQuotaStatus(parsed?.mineruUsage);
      if (runId !== state.runId) return;
      if (nativeFigures?.manifest?.figureCount) {
        parsed.pdfFigureManifest = nativeFigures.manifest;
        parsed.runtimeImageByFigureId = nativeFigures.runtimeImageByFigureId;
        parsed.pdfFigureBinaryAssets = nativeFigures.binaryAssets;
      } else {
        await cacheRemoteParsedImages(parsed, runId);
      }
      if (runId !== state.runId) return;
      setProgress(84, '正在合并正文结构、完整 Figure 与分层大纲…');
      await renderParsedDocument(parsed);
      if (runId !== state.runId) return;
      setPdfEnhancementState('ready');
      void restoreCachedPageBindingsAfterNativeReady(parsed);
    } catch (error) {
      if (runId !== state.runId) return;
      state.nativeFigureAbortController?.abort?.();
      if (element('pdfFigureEngineStatus')?.dataset.state === 'running') {
        setPdfFigureEngineStatus('本次图像提取已停止；已建立的图注目录仍保留。', 'cancelled');
      }
      if (error?.name === 'AbortError') {
        setPdfEnhancementState('cancelled');
        setProgress(4, '增强识别已取消，已读取的原页与索引仍保留。', '增强识别已取消');
        showReaderActions({ retry: true });
        return;
      }
      setPdfEnhancementState('error', error?.code || error?.message || 'PDF_PARSE_FAILED');
      const originalReadable = element('pdfNativeViewer')?.dataset.state === 'ready';
      const message = friendlyParseError(error) + (originalReadable ? ' 原页仍可阅读。' : '');
      setProgress(6, message, '增强识别未完成');
      showReaderActions({
        retry: true,
        settings: true,
        localFallback: Boolean(supplementalPdfBinding)
      });
      chrome.runtime.sendMessage({
        type: 'PDF_WORKSPACE_ERROR',
        sourceUrl: workspaceSourceUrl(),
        scope: 'enhancement',
        message,
        originalReadable,
        error: String(error?.message || error || 'PDF_PARSE_FAILED'),
        documentHash: globalThis.__brevessNativePdfDocument?.structure?.documentHash || ''
      }).catch(() => undefined);
      if (headlessSupplementalImport) {
        void reportHeadlessSupplementalImport('error', {
          message: friendlyParseError(error),
          code: error?.code || error?.message || 'PDF_PARSE_FAILED'
        }).then(() => closeHeadlessSupplementalReader());
      }
    } finally {
      if (runId === state.runId) state.localFileBytes = null;
    }
  }

  async function acceptSelectedLocalPdf(nextLocalFile, fileHandle = null) {
    if (!(nextLocalFile instanceof Blob)) return;
    if (nextLocalFile.size > 300 * 1024 * 1024) {
      throw Object.assign(new Error('PDF_LOCAL_FILE_TOO_LARGE'), {
        code: 'PDF_LOCAL_FILE_TOO_LARGE'
      });
    }
    const selectionRunId = ++state.runId;
    const selectedFileName = String(nextLocalFile.name || 'article.pdf');
    const assertCurrentSelection = () => {
      if (selectionRunId !== state.runId || state.localFile !== nextLocalFile) {
        throw new DOMException('PDF_SOURCE_SELECTION_SUPERSEDED', 'AbortError');
      }
    };
    document.dispatchEvent(new CustomEvent('brevess:pdf-source-changing'));
    saveReaderPreferences();
    state.parsedPageBindingCleanup?.();
    state.nativeFigureAbortController?.abort?.();
    state.positionRestoreKey = '';
    state.positionRestoring = false;
    resetNativePdfSourceOwnership();
    state.localFile = nextLocalFile;
    state.localFileHandle = fileHandle;
    state.openedPdfHash = '';
    state.pdfMetadataTitle = '';
    // The source-selection helper is also exercised in a headless VM without
    // the presentation helpers; the real reader always applies the title here.
    if (typeof applyPdfReaderDocumentTitle === 'function') {
      applyPdfReaderDocumentTitle();
    }
    syncPdfSaveActions();
    element('pdfReaderViewToggle').hidden = true;
    showReaderActions({ start: true });
    setProgress(
      5,
      `已选择 ${selectedFileName}，正在读取 PDF 原页与文字索引…`,
      '本地 PDF 已就绪'
    );
    await prepareLocalPdfWorkspaceIdentity(nextLocalFile, selectionRunId);
    assertCurrentSelection();
    setReaderView('original');
    // Reading a file never uploads it or requires a MinerU token.
    document.dispatchEvent(new CustomEvent('brevess:pdf-document-change'));
    if (headlessSupplementalImport) { await runParse(); return; }
    await waitForOriginalPdfIndex();
    assertCurrentSelection();
    await restoreCachedPdfDocument();
    assertCurrentSelection();
  }

  async function chooseLocalPdfWithHandle() {
    if (typeof globalThis.showOpenFilePicker !== 'function') return;
    let handles;
    try {
      handles = await globalThis.showOpenFilePicker({
        multiple: false,
        types: [{ description: 'PDF', accept: { 'application/pdf': ['.pdf'] } }]
      });
    } catch (error) {
      if (error?.name === 'AbortError') return;
      throw error;
    }
    const handle = handles?.[0];
    if (!handle?.getFile) throw new Error('PDF_LOCAL_FILE_HANDLE_MISSING');
    await acceptSelectedLocalPdf(await handle.getFile(), handle);
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
    applyPdfReaderDocumentTitle();
    const stored = await chrome.storage.local.get(SciLLM.PDF_MINERU_SETTINGS_KEY);
    state.settings = SciLLM.normalizeMineruPdfSettings(
      stored?.[SciLLM.PDF_MINERU_SETTINGS_KEY]
    );
    if (headlessSupplementalImport) {
      try {
        const imported = await SciLLM.consumeSupplementalPdfImportSession(
          supplementalImportToken
        );
        resetNativePdfSourceOwnership();
        state.localFile = new File([imported.blob], imported.name, {
          type: imported.type || 'application/pdf',
          lastModified: Date.now()
        });
        state.pdfMetadataTitle = '';
        applyPdfReaderDocumentTitle();
        await prepareLocalPdfWorkspaceIdentity();
        document.dispatchEvent(new CustomEvent('brevess:pdf-document-change'));
        await reportHeadlessSupplementalImport('parsing', {
          message: '正在本机提取补充 PDF 的图像与图注'
        });
      } catch (error) {
        await reportHeadlessSupplementalImport('error', {
          message: error?.message || 'SUPPLEMENTAL_PDF_IMPORT_EXPIRED',
          code: error?.code || 'SUPPLEMENTAL_PDF_IMPORT_EXPIRED'
        });
        await closeHeadlessSupplementalReader();
        return;
      }
    }
    if (supplementalPdfBinding) {
      if (!headlessSupplementalImport && await restoreCachedSupplementalDocument()) return;
      const fallback = element('pdfLocalFileFallback');
      const heading = fallback?.querySelector('strong');
      const copy = fallback?.querySelector('p');
      if (heading) heading.textContent = '请选择已经下载到本机的补充 PDF';
      if (copy) {
        copy.textContent =
          'Brevess 不再尝试自动下载或代传期刊附件。选择文件后会显示 PDF 原页；' +
          '增强识别结果用于侧栏索引和补充图解读。';
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
    element('pdfReaderStartParse').addEventListener('click', () => void runParse());
    element('pdfReaderReparse').addEventListener('click', () => void runParse());
    element('pdfReaderSettingsToggle').addEventListener('click', () => {
      void openMineruSettings();
    });
    element('pdfReaderOpenSettings').addEventListener('click', () => {
      void openMineruSettings();
    });
    element('pdfReaderRetry').addEventListener('click', () => void runParse());
    element('pdfReaderSaveAnnotated').addEventListener('click', () => {
      void startPdfCopySave();
    });
    element('pdfReaderOverwriteAnnotated').addEventListener('click', () => {
      const capture = capturePdfSaveOperation('overwrite');
      if (capture) void performPdfSave(capture, capture.sourceHandle);
    });
    const localPicker = element('pdfLocalFilePicker');
    localPicker.hidden = typeof globalThis.showOpenFilePicker !== 'function';
    localPicker.addEventListener('click', () => {
      void chooseLocalPdfWithHandle().catch(error => {
        if (error?.name === 'AbortError') return;
        document.documentElement.dataset.pdfErrorCode = String(
          error?.code || error?.message || 'PDF_LOCAL_FILE_PICKER_FAILED'
        ).slice(0, 160);
        setProgress(6, friendlyParseError(error), 'PDF 尚未准备完成');
      });
    });
    element('pdfLocalFile').addEventListener('change', event => {
      const nextLocalFile = event.target.files?.[0] || null;
      if (nextLocalFile) {
        void acceptSelectedLocalPdf(nextLocalFile, null).catch(error => {
          if (error?.name === 'AbortError') return;
          state.localFileBytes = null;
          document.documentElement.dataset.pdfErrorCode = String(
            error?.code || error?.message || 'PDF_LOCAL_IDENTITY_FAILED'
          ).slice(0, 160);
          setProgress(6, friendlyParseError(error), 'PDF 尚未准备完成');
          showReaderActions({ retry: true, settings: true, localFallback: true });
        });
      }
    });
    const remoteInput = element('pdfRemoteUrl');
    element('pdfRemoteUrlOpen').addEventListener('click', () => {
      openRemotePdfReader(remoteInput?.value);
    });
    remoteInput.addEventListener('input', () => {
      remoteInput.removeAttribute('aria-invalid');
      const status = element('pdfRemoteUrlStatus');
      if (status) {
        status.textContent = '';
        status.hidden = true;
      }
    });
    remoteInput.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      openRemotePdfReader(remoteInput.value);
    });
    if (supplementalPdfBinding) {
      if (headlessSupplementalImport) void runParse();
      return;
    }
    if (!sourceUrl) {
      const fallback = element('pdfLocalFileFallback');
      const heading = fallback?.querySelector('strong');
      const copy = fallback?.querySelector('p');
      if (heading) heading.textContent = '打开本地 PDF 文献';
      if (copy) {
        copy.textContent =
          '选择后直接显示 PDF 原页，自动建立本地文字索引；无需 MinerU。';
      }
      setProgress(
        4,
        '选择已下载的 PDF，即可在原页上选择文字、标注并提问。',
        '请选择 PDF 文献'
      );
      showReaderActions({ settings: true, localFallback: true });
      return;
    }
    if (await restoreCachedPdfDocument()) return;
    showUnparsedPdfPrompt();
  }

  globalThis.__brevessPdfReaderBridge = Object.freeze({
    getBytes: () => pdfBytesForNativeFigures(),
    originalUrl: () => originalPdfViewUrl(),
    focusPage: pageNumber => focusOriginalPdfPage(pageNumber),
    ensureFigureInventory: () => ensureNativeFigureInventory(),
    command(name, ...args) {
      return nativeBridgeController.command(name, ...args);
    },
    onReady(api) {
      return nativeBridgeController.onReady(api);
    },
    onState(next) {
      nativeBridgeController.onState(next);
    },
    onMetadata(metadata) {
      return applyPdfReaderDocumentTitle(metadata?.title);
    },
    get sourceUrl() { return workspaceSourceUrl(); },
    get title() { return state.documentTitle || resolvePdfReaderDocumentTitle({
      metadataTitle: state.pdfMetadataTitle,
      fileName: fileNameForSource(),
      requestedTitle: sourceTitle
    }); }
  });

  document.addEventListener('DOMContentLoaded', () => void initialize());
  let nativeFigureIndex = null;
  async function ensureNativeFigureInventory() {
    const native = globalThis.__brevessNativePdfDocument;
    if (!state.nativeReader || !native?.structure?.documentHash ||
        !['text-ready', 'partial-index'].includes(native.phase)) return [];
    const documentHash = native.structure.documentHash;
    const key = `${documentHash}:${native.documentGeneration}:${native.structure.diagnostics?.characterCount || 0}`;
    if (nativeFigureIndex?.key === key) return nativeFigureIndex.promise;
    const entry = { key, promise: null };
    nativeFigureIndex = entry;
    const current = () => nativeFigureIndex === entry &&
      globalThis.__brevessNativePdfDocument?.structure?.documentHash === documentHash &&
      globalThis.__brevessNativePdfDocument?.documentGeneration === native.documentGeneration;
    entry.promise = (async () => {
      const pages = [];
      for (let pageNumber = 1; pageNumber <= native.pageCount; pageNumber++) {
        const page = await state.nativeReader.readPageTextContent(pageNumber);
        if (!current() || page.documentHash !== documentHash) return [];
        pages.push({ pageNumber, textContent: page.textContent, view: page.view });
      }
      const figures = SciLLM.extractNativePdfFigures({ pages, documentHash });
      if (!current()) return [];
      const sourceRevision = await sha256PdfBytes(new TextEncoder().encode(JSON.stringify({
        documentHash, extractorVersion: 'native-caption-v3',
        figures: figures.map(({ figureId, caption, captionLineEvidence }) =>
          ({ figureId, caption, captionLineEvidence }))
      })));
      for (const figure of figures) {
        if (!current()) return [];
        figure.effectiveInventory = await SciLLM.createEffectivePdfFigureInventory({
          documentHash, sourceRevision, figure
        });
      }
      if (!current()) return [];
      globalThis.__brevessNativePdfFigures = { documentHash, sourceRevision, figures };
      document.dispatchEvent(new CustomEvent('brevess:pdf-figure-inventory-ready', {
        detail: { documentHash, sourceRevision, documentGeneration: native.documentGeneration, figureCount: figures.length }
      }));
      setPdfFigureEngineStatus(figures.length
        ? `已从 PDF 图注建立 ${figures.length} 张图的目录；解图前请核对包含完整图像的页码。`
        : globalThis.__brevessNativePdfDocument?.structure?.paragraphs?.length
          ? '未识别到明确图注。可使用增强识别补充图文索引。'
          : '原 PDF 没有可提取的文字层。原页可正常阅读；使用“增强文本识别”补充 OCR 后可进行划选、自动高亮和问答。',
        figures.length ? 'ready' : 'empty');
      return figures;
    })().catch(error => {
      if (current()) { nativeFigureIndex = null; setPdfFigureEngineStatus(`PDF 图注索引失败：${error.message}`, 'error'); }
      throw error;
    });
    return entry.promise;
  }
  document.addEventListener('brevess:native-pdf-ready', event => {
    const native = globalThis.__brevessNativePdfDocument;
    if (!native?.structure) return;
    const coverage = native.structure.diagnostics?.textCoverage || {};
    const ready = coverage.complete === true;
    const finished = ['text-ready', 'partial-index'].includes(native.phase);
    if (finished) {
      const previousFailure = state.nativeReaderFailure;
      if (previousFailure && document.documentElement.dataset.pdfErrorCode === previousFailure.message) {
        delete document.documentElement.dataset.pdfErrorCode;
      }
      state.nativeReaderFailure = null;
    }
    const enhancementOwnsStatus = ['running', 'blocked', 'error'].includes(
      document.documentElement.dataset.pdfEnhancementState);
    if (!enhancementOwnsStatus && !document.documentElement.dataset.pdfWorkspaceIndexError) {
      if (finished) showReaderActions({ start: true, settings: true });
      element('pdfReaderControl').dataset.state = ready || finished ? 'idle' : 'indexing';
      element('pdfReaderStatusTitle').textContent = finished && !native.structure.paragraphs.length
        ? '原页可读，需文字识别' : ready ? '原页与文字索引已就绪'
          : finished ? '文字索引不完整' : '正在建立文字索引';
      const checked = coverage.checkedPages ?? coverage.retainedPages ?? 0;
      const detail = [coverage.emptyPages ? `${coverage.emptyPages} 页无文字层` : '',
        coverage.failedPages ? `${coverage.failedPages} 页文字提取失败` : ''].filter(Boolean).join('，');
      element('pdfReaderStatus').textContent = `已检查 ${checked}/${coverage.totalPages || native.pageCount} 页` +
        (detail ? `（${detail}）` : '') + '；当前始终显示 PDF 原页。';
    }
    applyPdfReaderDocumentTitle();
    element('pdfReaderPageCount').textContent = `/ ${native.pageCount}`;
    element('pdfReaderPageNumber').max = String(native.pageCount);
    setReaderView('original');
    if (finished) void restoreNativeReadingPosition();
    if (finished && !native.structure.paragraphs.length) {
      setPdfFigureEngineStatus('原 PDF 没有可提取的文字层。原页可正常阅读；使用“增强文本识别”补充 OCR 后可进行划选、自动高亮和问答。', 'empty');
    }
    if (ready || native.phase === 'partial-index') void ensureNativeFigureInventory().catch(() => undefined);
  });
  document.addEventListener('brevess:native-pdf-error', event => {
    const detail = event?.detail || {};
    const current = globalThis.__brevessNativePdfDocument;
    if (detail.sourceUrl && detail.sourceUrl !== workspaceSourceUrl()) return;
    if (detail.documentGeneration && current?.documentGeneration &&
        detail.documentGeneration !== current.documentGeneration) return;
    state.nativeReaderFailure = { ...detail, sourceUrl: workspaceSourceUrl(),
      message: String(detail.message || 'PDF_NATIVE_READER_FAILED') };
  });
  document.addEventListener('brevess:pdf-source-changing', () => {
    nativeFigureIndex = null;
    state.nativeReaderFailure = null;
    const data = document.documentElement.dataset;
    delete data.pdfEnhancementState;
    delete data.pdfEnhancementError;
    delete data.pdfWorkspaceIndexError;
    delete data.pdfErrorCode;
    setPdfFigureEngineStatus();
  });
  document.addEventListener('brevess:pdf-focus-page', event => {
    focusOriginalPdfPage(event?.detail?.page);
  });
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes?.[SciLLM.PDF_MINERU_SETTINGS_KEY]) return;
    state.settings = SciLLM.normalizeMineruPdfSettings(
      changes[SciLLM.PDF_MINERU_SETTINGS_KEY].newValue
    );
  });
  window.addEventListener('pagehide', revokeAssetUrls);
  window.addEventListener('pagehide', () => {
    state.nativeFigureAbortController?.abort?.();
    state.nativeReader?.dispose?.();
    if (state.originalObjectUrl) URL.revokeObjectURL(state.originalObjectUrl);
    state.originalObjectUrl = '';
  });
})();
void globalThis.SciLLM?.bootstrapInterfaceLanguage?.();
