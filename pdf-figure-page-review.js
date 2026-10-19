(function () {
  'use strict';
  const api = globalThis.SciLLM = globalThis.SciLLM || {};
  const t = value => api.translateInterfaceText?.(value) || value;

  // Nonmodal UI; save/focus adapters keep the existing PDF identity, source,
  // manual-selection and disk-confirmation guards authoritative.
  api.createPdfFigurePageReview = function ({ capture, current, parsePages, save, saveBatch, focus }) {
    let epoch = 0;
    let draftOwner = null;
    const drafts = new Map();
    const draftSourceIdentity = figure => figure.artworkOwnerSignature && figure.sourceFingerprint
      ? JSON.stringify([figure.figureId, figure.documentHash || '', figure.pdfDocumentGeneration ?? '',
        figure.sourceKind || '', figure.sourceFingerprint, figure.artworkOwnerSignature]) : null;
    const make = (tag, cls, text) => {
      const node = document.createElement(tag);
      if (cls) node.className = cls;
      if (text !== undefined) node.textContent = text;
      return node;
    };
    const panel = make('section', 'pdf-figure-page-review');
    panel.id = 'pdfFigurePageReview';
    panel.hidden = true;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'false');
    panel.setAttribute('aria-labelledby', 'pdfFigurePageReviewHeading');
    panel.dataset.sciPluginUi = '';
    const header = make('header', 'pdf-figure-page-review-heading');
    const heading = make('strong', '', 'Figure 图像页核对');
    heading.id = 'pdfFigurePageReviewHeading';
    const closeButton = make('button', 'pdf-reader-icon-button', '×');
    closeButton.id = 'pdfFigurePageReviewClose';
    closeButton.type = 'button';
    closeButton.setAttribute('aria-label', '关闭页码核对');
    header.append(heading, closeButton);
    const hint = make('p', 'pdf-figure-page-review-hint', '输入完整图像的物理页码，可多页；填写即人工指定。自动候选仅作参考，空白保持未指定。');
    const body = make('div', 'pdf-figure-page-review-body');
    const footer = make('footer', 'pdf-figure-page-review-footer');
    const saveButton = make('button', 'pdf-reader-button', '保存全部页码');
    saveButton.type = 'button';
    saveButton.dataset.reviewSaveAll = '';
    const feedback = make('p', 'pdf-figure-page-review-feedback');
    feedback.dataset.reviewBatchStatus = '';
    feedback.setAttribute('data-i18n-ignore', '');
    feedback.setAttribute('role', 'status');
    feedback.setAttribute('aria-live', 'polite');
    footer.append(saveButton, feedback);
    panel.append(header, hint, body, footer);
    document.body.append(panel);
    function close() {
      epoch++;
      panel.hidden = true;
      document.getElementById('pdfReaderReviewFigurePages')?.focus();
    }
    closeButton.addEventListener('click', close);
    const onKey = event => {
      if (!panel.hidden && event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault();
        close();
      }
    };
    document.addEventListener('keydown', onKey);
    function assertCurrent(context, token) {
      if (token !== epoch || panel.hidden || !current(context)) throw new Error('文献或图像来源已变化，请重新打开核对窗口。');
    }
    function render(context, token) {
      body.replaceChildren();
      const owner = context.native || context.identity || context.catalog || context;
      if (draftOwner !== owner) { drafts.clear(); draftOwner = owner; }
      feedback.textContent = t('');
      const entries = [];
      saveButton.disabled = !context.figures?.length;
      if (!context.figures?.length) {
        body.append(make('p', 'pdf-figure-page-review-empty', '当前没有可核对的 PDF Figure。待图注目录建立后可重新打开。'));
        return;
      }
      const table = make('table', 'pdf-figure-page-review-table');
      const head = make('thead');
      const headRow = make('tr');
      for (const label of ['Figure', '完整图像页']) {
        const cell = make('th', '', label);
        cell.setAttribute('scope', 'col');
        headRow.append(cell);
      }
      head.append(headRow);
      const rows = make('tbody');
      for (const figure of context.figures) {
        const row = make('tr');
        row.dataset.pdfPageReviewRow = figure.figureId;
        const name = make('th');
        name.setAttribute('scope', 'row');
        const label = figure.figureLabel || figure.figureId;
        const nameText = make('strong', '', label);
        nameText.setAttribute('data-i18n-ignore', '');
        name.append(nameText);
        const captionPages = (figure.captionPageNumbers || []).join(', ');
        if (captionPages) name.append(make('small', '', '图注 p. ' + captionPages));
        const cell = make('td');
        const input = make('input', 'pdf-figure-page-review-input');
        input.type = 'text';
        input.placeholder = '例如 5-6';
        input.setAttribute('aria-label', label + ' 完整图像页码');
        const manual = figure.artworkPageEvidence === 'user-selection';
        const initial = manual ? figure.artworkPageNumbers : [];
        // A current lower-layer lease cannot detect that a draft came from an
        // older owner. Reuse only stable Figure source proof, not catalog revision.
        const sourceIdentity = draftSourceIdentity(figure);
        const draft = drafts.get(figure.figureId);
        if (draft && (!sourceIdentity || draft.sourceIdentity !== sourceIdentity)) drafts.delete(figure.figureId);
        input.value = drafts.get(figure.figureId)?.value ?? (Array.isArray(initial) ? initial.join(', ') : '');
        const pagesBar = make('div', 'pdf-figure-page-review-links');
        const candidateHint = make('small', 'pdf-figure-page-review-candidates');
        if (!manual && figure.artworkPageCandidates?.length) candidateHint.textContent = '自动候选 p. ' + figure.artworkPageCandidates.join(', ');
        if (figure.artworkRestoreError) feedback.textContent += t(label + ': ' + t(figure.artworkRestoreError) + ' ');
        function drawLinks() {
          pagesBar.replaceChildren();
          let pages;
          try { pages = input.value.trim() ? parsePages(input.value, figure.pdfPageCount) : (figure.artworkPageCandidates || []); }
          catch (_) { return; }
          for (const page of pages) {
            const button = make('button', 'pdf-figure-page-review-link', 'p. ' + page);
            button.type = 'button';
            button.dataset.reviewPage = String(page);
            button.setAttribute('aria-label', label + ' 查看图像候选第 ' + page + ' 页');
            button.addEventListener('click', async () => {
              try {
                assertCurrent(context, token);
                const result = await focus(figure, page, context);
                assertCurrent(context, token);
                if (result?.success !== true || result.focused === false) throw new Error('无法定位此页，请用阅读器页码框查看。');
                feedback.textContent = t('正在查看物理第 ' + page + ' 页');
              } catch (error) { if (token === epoch && !panel.hidden) feedback.textContent = t(error.message); }
            });
            pagesBar.append(button);
          }
        }
        input.addEventListener('input', () => {
          drafts.set(figure.figureId, { value: input.value, sourceIdentity });
          input.removeAttribute('aria-invalid');
          feedback.textContent = t('');
          drawLinks();
        });
        entries.push({ figure, label, input, drawLinks, sourceIdentity, hasManualPages: manual && initial?.length > 0 });
        drawLinks();
        cell.append(input, candidateHint, pagesBar);
        row.append(name, cell);
        rows.append(row);
      }
      table.append(head, rows);
      body.append(table);
      saveButton.onclick = async () => {
        if (saveButton.disabled) return;
        const selected = [];
        let unspecified = 0;
        try {
          assertCurrent(context, token);
          // Validate every non-empty row before the first write. Empty values
          // do not silently clear saved choices or confirm automatic candidates.
          for (const entry of entries) {
            entry.input.removeAttribute('aria-invalid');
            if (!entry.input.value.trim()) {
              if (entry.hasManualPages) {
                entry.input.setAttribute('aria-invalid', 'true');
                entry.input.focus();
                throw new Error(entry.label + '：已有人工页码暂不支持清空，请填写替代页码；本次未保存任何行。');
              }
              unspecified++;
              continue;
            }
            try {
              entry.pages = parsePages(entry.input.value, entry.figure.pdfPageCount).sort((a, b) => a - b);
              selected.push(entry);
            }
            catch (error) {
              entry.input.setAttribute('aria-invalid', 'true');
              entry.input.focus();
              throw new Error(entry.label + ': ' + t(error.message));
            }
          }
          if (!selected.length) { feedback.textContent = t('没有可保存页码 · ' + unspecified + ' 张未指定；原记录未改动。'); return; }
          saveButton.disabled = true;
          entries.forEach(entry => { entry.input.disabled = true; });
          feedback.textContent = t('正在保存 ' + selected.length + ' 张 Figure…');
          const receipts = [];
          let validated = true;
          if (typeof saveBatch === 'function') {
            const batch = await saveBatch(selected.map(entry => ({ figure: entry.figure, pageNumbers: entry.pages })), context);
            assertCurrent(context, token);
            validated = batch?.validated !== false;
            // A batch HTTP success without per-Figure receipts proves nothing.
            for (const entry of selected) {
              const result = batch?.receipts?.find(item => item.figureId === entry.figure.figureId);
              receipts.push({ entry, result: result
                ? { ...result, success: validated && result.success === true && result.saved === true }
                : { success: false, error: '缺少此 Figure 的保存回执' } });
            }
          } else {
            for (const entry of selected) {
              assertCurrent(context, token);
              let result;
              try { result = await save(entry.figure, entry.pages, context); }
              catch (error) { result = { success: false, error: error.message }; }
              assertCurrent(context, token);
              receipts.push({ entry, result });
              feedback.textContent = t('已收到回执 ' + receipts.length + '/' + selected.length);
            }
          }
          let saved = 0;
          const failures = [];
          for (const { entry, result } of receipts) {
            if (result?.success === true) {
              saved++;
              entry.hasManualPages = true;
              entry.input.value = entry.pages.join(', ');
              drafts.delete(entry.figure.figureId);
              entry.drawLinks();
            } else {
              drafts.set(entry.figure.figureId, { value: entry.input.value, sourceIdentity: entry.sourceIdentity });
              entry.input.setAttribute('aria-invalid', 'true');
              failures.push(entry.label + ': ' + t(result?.error || '保存失败，请重试'));
            }
          }
          feedback.textContent = t((!validated ? '整表校验失败，未保存任何行' : failures.length ? '部分保存' : '已保存') + ' · ' + saved + '/' + selected.length + ' 张 · ' + unspecified + ' 张未指定' +
            (failures.length ? '；失败（草稿已保留）：' + failures.join('；') : '。'));
        } catch (error) {
          if (token === epoch && !panel.hidden) feedback.textContent = t(error.message);
        } finally {
          if (token === epoch && !panel.hidden) {
            saveButton.disabled = false;
            entries.forEach(entry => { entry.input.disabled = false; });
          }
        }
      };
    }
    async function open() {
      const token = ++epoch;
      panel.hidden = false;
      saveButton.disabled = true;
      feedback.textContent = t('');
      body.replaceChildren(make('p', 'pdf-figure-page-review-empty', '正在读取 Figure 与已保存页码…'));
      closeButton.focus();
      try {
        const context = await capture();
        assertCurrent(context, token);
        render(context, token);
      } catch (error) {
        if (token === epoch && !panel.hidden) body.replaceChildren(make('p', 'pdf-figure-page-review-empty', error.message));
      }
    }
    return { open, close, destroy() { epoch++; document.removeEventListener('keydown', onKey); panel.remove(); } };
  };

  function initialize() {
    const trigger = document.getElementById('pdfReaderReviewFigurePages');
    if (!trigger || typeof globalThis.buildFigureWorkspaceSnapshot !== 'function' ||
        typeof globalThis.setPdfFigureArtworkPages !== 'function') return;
    const review = api.createPdfFigurePageReview({
      parsePages: api.SidebarUI.parseArtworkPages,
      async capture() {
        const native = globalThis.__brevessNativePdfDocument;
        if (!native?.structure || !native.pageCount) throw new Error('PDF 原页尚未就绪，请稍后重试。');
        await globalThis.__brevessPdfReaderBridge?.ensureFigureInventory?.();
        if (globalThis.__brevessNativePdfDocument !== native) throw new Error('文献已变化，请重新打开。');
        const catalog = globalThis.__brevessNativePdfFigures;
        const restoreErrors = new Map();
        await Promise.all((catalog?.figures || []).map(async figure => {
          try { await restoreNativePdfFigureArtworkSelection(figure); }
          catch (_) { restoreErrors.set(figure.figureId, '旧页码记录未能恢复，请重新核对；其他 Figure 不受影响。'); }
        }));
        if (globalThis.__brevessNativePdfDocument !== native || globalThis.__brevessNativePdfFigures !== catalog) throw new Error('文献已变化，请重新打开。');
        const snapshot = buildFigureWorkspaceSnapshot();
        return {
          native, catalog, revision: catalog?.sourceRevision, lifecycle: snapshot.workspaceLifecycle,
          figures: snapshot.figures.filter(figure => figure.sourceKind === 'pdf-page-caption').map(figure => ({
            ...figure,
            artworkRestoreError: restoreErrors.get(figure.figureId) || '',
            artworkPageCandidates: [...(catalog.figures.find(item => item.figureId === figure.figureId)?.artworkPageCandidates || [])]
          }))
        };
      },
      current(context) {
        return globalThis.__brevessNativePdfDocument === context.native &&
          globalThis.__brevessNativePdfFigures === context.catalog &&
          context.catalog?.sourceRevision === context.revision &&
          buildFigureWorkspaceSnapshot().workspaceLifecycle === context.lifecycle;
      },
      save(figure, pages, context) {
        return setPdfFigureArtworkPages({
          figureId: figure.figureId, documentHash: figure.documentHash,
          documentGeneration: figure.pdfDocumentGeneration,
          sourceRevision: figure.sourceRevision, artworkOwnerSignature: figure.artworkOwnerSignature,
          sourceFingerprint: figure.sourceFingerprint, workspaceLifecycle: context.lifecycle,
          pageNumbers: pages, coverageConfirmed: true
        });
      },
      async saveBatch(entries, context) {
        const result = await setPdfFigureArtworkPagesBatch({ requests: entries.map(({ figure, pageNumbers }) => ({
          figureId: figure.figureId, documentHash: figure.documentHash,
          documentGeneration: figure.pdfDocumentGeneration,
          sourceRevision: figure.sourceRevision, artworkOwnerSignature: figure.artworkOwnerSignature,
          sourceFingerprint: figure.sourceFingerprint, workspaceLifecycle: context.lifecycle,
          pageNumbers, coverageConfirmed: true
        })) });
        return { validated: result?.validated, receipts: result?.results };
      },
      focus(figure, page, context) {
        return focusPdfFigureArtworkCandidate({
          figureId: figure.figureId, documentHash: figure.documentHash,
          documentGeneration: figure.pdfDocumentGeneration, sourceFingerprint: figure.sourceFingerprint,
          workspaceLifecycle: context.lifecycle, pageNumber: page
        });
      }
    });
    trigger.addEventListener('click', () => void review.open());
    document.addEventListener('brevess:pdf-source-changing', () => review.close());
    window.addEventListener('pagehide', () => review.destroy(), { once: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})();
