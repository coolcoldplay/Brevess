/* Render an image only when a saved PDF panel is actually used as a reference. */
(() => {
  const pending = new Map();
  async function thumbnail(resource) {
    const hash = resource.pdfPanelHash, figureId = resource.figureId, label = resource.panelId;
    const store = SciLLM.PdfPanelEvidence;
    const hit = store.find(await store.read(hash),figureId,label);
    if (!hit || hit.panel.ambiguous) return null;
    const meta = {documentHash:hash,figureId,label:hit.panel.label,page:hit.row.page,
      rect:{...hit.panel.rect},caption:hit.panel.authorText || '',needsReview:!!hit.panel.needsReview,edit:hit.row.edit || ''};
    const local = await SciLLM.loadOriginalPdfSource(hash);
    if (local?.blob) {
      const lib = await import('../vendor/pdfjs/build/pdf.min.mjs');
      const base = chrome.runtime.getURL('vendor/pdfjs/');
      lib.GlobalWorkerOptions.workerSrc = base+'build/pdf.worker.min.mjs';
      const loading = lib.getDocument({data:new Uint8Array(await local.blob.arrayBuffer()),
        cMapUrl:base+'cmaps/',cMapPacked:true,standardFontDataUrl:base+'standard_fonts/',wasmUrl:base+'wasm/',
        iccUrl:base+'iccs/',isEvalSupported:false,verbosity:0});
      const passwordRequired = new Promise((_,reject) => {
        loading.onPassword = () => reject(new Error('请在阅读器中解锁 PDF 原文'));
      });
      try {
        const doc = await Promise.race([loading.promise,passwordRequired]);
        const page = await doc.getPage(hit.row.page);
        const image = await store.renderCrop(page,hit.panel.rect,hit.row.pageSize,400,null,true,hit.panel.mask);
        return {...meta,image:image.dataUrl};
      } catch {
        // An already open reader can still own an unlocked copy.
      } finally { await loading.destroy(); }
    }
    const contexts = await chrome.runtime.getContexts({contextTypes:['TAB']});
    for (const context of contexts) {
      if (!Number.isInteger(context.tabId) || !context.documentUrl?.startsWith(chrome.runtime.getURL('pdf-reader.html'))) continue;
      const reply = await chrome.tabs.sendMessage(context.tabId,{action:'readPdfPanelCrop',documentHash:hash,
        figureId,label,edge:400},{frameId:0}).catch(() => null);
      const data = reply?.data;
      if (data?.documentHash === hash && data.page === meta.page && !data.ambiguous)
        return {...meta,image:data.dataUrl};
    }
    return null;
  }
  function reference(resource) {
    if (resource?.type !== 'panel' || resource.sourceMismatch || !/^[a-f0-9]{64}$/.test(resource.pdfPanelHash)) return null;
    if (resource.pdfPanelPreview?.documentHash === resource.pdfPanelHash) return resource.pdfPanelPreview;
    const key = JSON.stringify([resource.pdfPanelHash,resource.figureId,resource.panelId]);
    if (!pending.has(key)) pending.set(key,thumbnail(resource).catch(() => null).finally(() => pending.delete(key)));
    return pending.get(key);
  }
  globalThis.SciLLM.pdfPanelReference = reference;
})();
