/* Only loaded by the extension-owned PDF reader. The editor and its second
 * PDF worker exist on demand. An indexed paper needs neither for a preview. */
(() => {
  const store = SciLLM.PdfPanelEvidence;
  const workerHost = document.getElementById('pdfPanelWorkerHost');
  const bridge = () => globalThis.__brevessPdfReaderBridge;
  let session = null;
  function identity() {
    const native = globalThis.__brevessNativePdfDocument;
    return {hash:native?.structure?.documentHash, generation:native?.documentGeneration,
      url:bridge()?.sourceUrl};
  }
  function matches(owner) {
    const now = identity();
    return !!owner.hash && owner.hash === now.hash && owner.generation === now.generation && owner.url === now.url;
  }
  function current(owner) {
    if (!matches(owner)) throw new Error('PDF 已切换，请在当前论文重试');
  }
  function dispose(entry) {
    if (!entry) return;
    if (!entry.done) entry.cancel?.();
    entry.frame.remove();
    if (session === entry) session = null;
  }
  async function start(owner, preferred) {
    current(owner);
    if (session && matches(session.owner)) {
      if (session.preferred === preferred) return session.ready;
      await session.ready;
      return start(owner,preferred);
    }
    dispose(session);
    const frame = document.createElement('iframe');
    frame.title = 'Figure 与 Panel 裁图编辑器';
    const loaded = new Promise((resolve,reject) => {
      frame.onload = () => resolve();
      frame.onerror = () => reject(new Error('Panel 编辑器加载失败'));
    });
    frame.src = chrome.runtime.getURL('vendor/panel-extract/reader.html');
    const entry = {frame,owner,preferred,done:false};
    const cancelled = new Promise((_,reject) => {
      entry.cancel = () => reject(new Error('提取已取消'));
    });
    session = entry;
    workerHost.append(frame);
    const indexing = (async () => {
      const [bytes] = await Promise.all([bridge().getBytes(),loaded]);
      current(owner);
      if (session !== entry) throw new Error('提取已取消');
      const api = frame.contentWindow.BrevessPanelFrame;
      if (!api) throw new Error('Panel 编辑器未就绪');
      const title = (bridge().title || '论文').replace(/\.pdf$/i,'');
      await api.load(new File([bytes],title + '.pdf',{type:'application/pdf'}),owner.hash,preferred,true);
      current(owner);
      if (session !== entry) throw new Error('提取已取消');
      const catalog = await store.read(owner.hash);
      current(owner);
      const live = globalThis.__brevessNativePdfFigures;
      if (live?.documentHash === owner.hash) {
        store.applyArtworkPages(live.figures,catalog,owner.hash);
        document.dispatchEvent(new CustomEvent('brevess:pdf-figure-inventory-ready',{detail:{
          documentHash:owner.hash,documentGeneration:owner.generation,sourceRevision:live.sourceRevision,figureCount:live.figures.length}}));
      }
      entry.done = true;
      dispose(entry);
      return entry;
    })();
    entry.ready = Promise.race([indexing,cancelled]).catch(e => { dispose(entry); throw e; });
    return entry.ready;
  }
  function open(figureId = '', label = '', onAsk) {
    return globalThis.BrevessArticleFigures.openGallery({figureId,label},galleryReader(),onAsk);
  }
  async function lookupArtwork(owner, figureId, select, extract = true) {
    current(owner);
    let catalog = await store.read(owner.hash);
    let found = select(catalog);
    if (!found && !catalog.complete && extract) {
      await start(owner,figureId);
      catalog = await store.read(owner.hash);
      found = select(catalog);
    }
    current(owner);
    return found;
  }
  function lookup(figureId, label, {extract=true} = {}) {
    return lookupArtwork(identity(), figureId, catalog => store.find(catalog,figureId,label), extract);
  }
  async function renderArtwork(owner, row, rect, edge, mask) {
    current(owner);
    if (!bridge().panelCropReady) {
      await new Promise((resolve,reject) => {
        const ready = () => finish(resolve);
        const finish = (fn,value) => {
          clearTimeout(timeout);
          document.removeEventListener('brevess:pdf-panel-renderer-ready',ready);
          fn(value);
        };
        const timeout = setTimeout(() => finish(reject,new Error('PDF 原页尚未就绪，请稍后再试')),15000);
        document.addEventListener('brevess:pdf-panel-renderer-ready',ready);
        if (bridge().panelCropReady) ready();
      });
      current(owner);
    }
    const image = await bridge().command('renderPanelCrop',row.page,rect,row.pageSize,owner.hash,edge,mask);
    current(owner);
    if (!image?.dataUrl || image.documentHash !== owner.hash) throw new Error('未能读取当前 PDF 的裁图');
    return image;
  }
  function artworkRows(catalog,id) {
    return catalog.figures.filter(r=>r.figureId===id && store.pageRect([0,0,1,1],r.figureBox,[1,1],r.pageSize))
      .sort((a,b)=>a.page-b.page || a.key.localeCompare(b.key));
  }
  function rowsFor(owner,id) {
    return lookupArtwork(owner,id,catalog=>{
      const rows=artworkRows(catalog,id);
      return rows.length ? rows : null;
    });
  }
  async function artworkAnchor(figureId,preferredPages=[],restrict=false) {
    const rows=await rowsFor(identity(),figureId);
    if (!rows) return null;
    const row=preferredPages.map(page=>rows.find(r=>r.page===page)).find(Boolean) || (!restrict && rows[0]);
    if (!row) return null;
    const rect=store.pageRect([0,0,1,1],row.figureBox,[1,1],row.pageSize);
    return {page:row.page,top:rect.y*row.pageSize[1]};
  }
  async function preview(figureId, requestedEdge = 900) {
    const maxEdge = Math.max(256, Math.min(2400, Number(requestedEdge) || 900));
    const owner = identity();
    const rows = await rowsFor(owner,figureId);
    if (!rows) throw Error('未找到这幅 Figure 的原图区域，可打开原页核对');
    const images = [];
    for (const row of rows) {
      const rect = store.pageRect([0,0,1,1], row.figureBox, [1,1], row.pageSize);
      if (!rect) throw Error('这幅 Figure 的原图边界需要核对');
      images.push(await renderArtwork(owner, row, rect, Math.ceil(maxEdge / Math.sqrt(rows.length))));
    }
    return {name:rows[0].name, caption:rows[0].title, pages:[...new Set(rows.map(row => row.page))], images};
  }
  async function picture(figureId,label,edge,index) {
    const owner = identity();
    let hit;
    if (Number.isInteger(index) && index >= 0) {
      const row=(await rowsFor(owner,figureId))?.[index];
      const panel=row?.panels.find(p=>p.label.toUpperCase()===String(label).toUpperCase());
      if (panel) hit={row,panel};
    } else hit=await lookup(figureId,label);
    if (!hit) throw new Error('未找到唯一对应的 Panel，可打开原页补选或校正');
    const {row,panel} = hit;
    const image = await renderArtwork(owner, row, panel.rect, edge, panel.mask);
    return {...image,figureId,label:panel.label,page:row.page,name:row.name,title:row.title,
      attachmentId:store.attachmentId(owner.hash,figureId,panel.label),
      caption:panel.authorText,legend:panel.legend,needsReview:panel.needsReview,ambiguous:panel.ambiguous};
  }
  function galleryReader() {
    // This adapter belongs to the PDF generation for which the dialog was opened.
    const owner=identity();
    async function list(preferred) {
      current(owner);
      const live=globalThis.__brevessNativePdfFigures;
      if (live?.documentHash!==owner.hash) throw Error('请等待 PDF 图像目录就绪。');
      const ids=live.figures.map(f=>f.figureId);
      if (preferred && ids.includes(preferred)) await rowsFor(owner,preferred);
      const catalog=await store.read(owner.hash);
      current(owner);
      const result=[];
      for (const id of new Set([...ids,...catalog.figures.map(r=>r.figureId).filter(Boolean)])) {
        const rows=artworkRows(catalog,id);
        const name=live.figures.find(f=>f.figureId===id)?.figureLabel || rows[0]?.name || id;
        if (!rows.length) result.push({figureId:id,index:0,name});
        rows.forEach((r,index)=>result.push({figureId:id,index,name:rows.length===1 ? name : name+' · 第 '+r.page+' 页'}));
      }
      return result;
    }
    async function rowFor(id,index) {
      const row=(await rowsFor(owner,id))?.[index];
      if (!row) throw Error('未找到这幅图的原图区域。');
      return row;
    }
    const fullRect=row=>store.pageRect([0,0,1,1],row.figureBox,[1,1],row.pageSize);
    const fingerprint=row=>JSON.stringify([owner.hash,row.key,row.page,row.figureBox,row.edit]);
    async function inspect(id,index,edit) {
      let row=await rowFor(id,index);
      const full=fullRect(row), [width,height]=row.sourcePixels;
      if (edit) {
        const {label,rect,cuts=[]}=edit;
        if (fingerprint(row)!==edit.fingerprint) throw Error('校正记录已更新，请重新打开原图。');
        if (!/^[A-Z]$/.test(label) || !store.validCuts([rect]) || !store.validCuts(cuts) ||
            rect.width*width<4 || rect.height*height<4) throw Error('请在当前原图重新框选 Panel。');
        const previous=row.panels.find(p=>p.label.toUpperCase()===label);
        const pageRect=store.project(rect,full);
        const keep=edit.preserveMask && store.sameRect(previous?.rect,pageRect);
        const panel={...previous,label,rect:pageRect,pixelBox:[rect.x*width,rect.y*height,(rect.x+rect.width)*width,(rect.y+rect.height)*height],
          mask:{...(keep ? previous.mask : null),cuts},method:'manual',needsReview:false,ambiguous:false};
        current(owner);
        row=await store.put(owner.hash,{...row,galleryEdit:true,panels:[...row.panels.filter(p=>p!==previous),panel]
          .sort((a,b)=>a.label.localeCompare(b.label))},true,row.edit);
        current(owner);
      }
      const panels=[];
      // Keep PDF rasterization sequential and bounded to the selected plate.
      for (const panel of row.panels) {
        const thumb=await renderArtwork(owner,row,panel.rect,180,panel.mask);
        panels.push({label:panel.label,rect:store.relative(panel.rect,full),cuts:panel.mask?.cuts || [],
          thumb:thumb.dataUrl,caption:panel.authorText,needsReview:panel.needsReview});
      }
      return {figureId:id,index,width,height,panels,expected:panels.map(p=>p.label),fingerprint:fingerprint(row)};
    }
    async function drawOriginal(id,index,canvas,stillCurrent) {
      const row=await rowFor(id,index);
      const crop=await renderArtwork(owner,row,fullRect(row),1600);
      const img=new Image(); img.src=crop.dataUrl; await img.decode();
      current(owner);
      if (stillCurrent()) {
        canvas.width=img.naturalWidth; canvas.height=img.naturalHeight;
        canvas.getContext('2d').drawImage(img,0,0);
      }
    }
    async function labels(id,index) {
      const row = await rowFor(id,index);
      return row.panels.map(p => p.label);
    }
    return {list,labels,inspect,drawOriginal,picture:(...args)=>{current(owner);return picture(...args);}};
  }
  document.getElementById('pdfReaderPanels').addEventListener('click',() => open());
  document.addEventListener('brevess:native-pdf-ready',() => {
    if (session && !matches(session.owner)) dispose(session);
  });
  addEventListener('pagehide',() => dispose(session),{once:true});
  globalThis.__brevessPdfPanels = {open,lookup,picture,preview,artworkAnchor,galleryReader};
})();
