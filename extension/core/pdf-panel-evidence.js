/* PDF artwork is addressed by the SHA-256 of its original bytes. The index
 * stores page-space geometry and author text. Pixels are rendered on demand. */
(() => {
  const revision = 'panel-extract-8f90c70-2';
  const hashPattern = /^[a-f0-9]{64}$/;
  function open() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('brevess-pdf-panel-evidence-v1', 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('papers', {keyPath:'hash'});
        request.result.createObjectStore('figures', {keyPath:['hash','key']})
          .createIndex('paper', 'hash');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async function transaction(names, mode, work) {
    const db = await open();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(names, mode);
        let result;
        tx.oncomplete = () => resolve(result);
        tx.onerror = tx.onabort = () => reject(tx.error || new Error('Panel 索引写入失败'));
        work(tx, value => { result = value; });
      });
    } finally { db.close(); }
  }
  function figureId(rec) {
    const prefix = {main:'figure-',supp:'figure-s',ed:'figure-ed'}[rec.kind];
    return prefix && Number.isInteger(rec.n) ? prefix + rec.n : '';
  }
  function key(rec) {
    return rec.brevessKey || (figureId(rec) || rec.kind + '-' + rec.page) + '/' + (rec.captionPage || rec.page);
  }
  async function read(hash) {
    if (!hashPattern.test(hash)) throw new Error('PDF 文档标识无效');
    return transaction(['papers','figures'], 'readonly', (tx, done) => {
      const rows = {complete:false, figures:[]};
      tx.objectStore('papers').get(hash).onsuccess = e => {
        rows.complete = e.target.result?.revision === revision; done(rows);
      };
      tx.objectStore('figures').index('paper').getAll(hash).onsuccess = e => {
        rows.figures = e.target.result.filter(r => r.revision === revision || (r.edit && (r.restore || r.galleryEdit))); done(rows);
      };
    });
  }
  async function put(hash, row, manual, expectedEdit) {
    if (!hashPattern.test(hash) || !row.key) throw new Error('无法绑定 PDF 原图');
    const saved = await transaction(['figures'], 'readwrite', (tx, done) => {
      const s = tx.objectStore('figures');
      s.get([hash,row.key]).onsuccess = e => {
        const prev = e.target.result;
        if (prev?.edit && (!manual || (expectedEdit || '') !== prev.edit)) {
          done(manual ? null : prev); return;
        }
        const record = {...row, hash, revision, edit:manual ? crypto.randomUUID() : ''};
        s.put(record); done(record);
      };
    });
    if (!saved) throw new Error('另一标签页已保存这幅图的新校正，请重新打开核对');
    return saved;
  }
  async function complete(hash) {
    if (hashPattern.test(hash)) await transaction(['papers'],'readwrite',tx =>
      tx.objectStore('papers').put({hash,revision}));
  }
  async function remove(hash) {
    if (!hashPattern.test(hash)) return;
    await transaction(['papers','figures'],'readwrite',tx => {
      tx.objectStore('papers').delete(hash);
      tx.objectStore('figures').index('paper').openKeyCursor(hash).onsuccess = e => {
        const cursor = e.target.result;
        if (cursor) { tx.objectStore('figures').delete(cursor.primaryKey); cursor.continue(); }
      };
    });
  }
  function find(catalog, figure, label) {
    const hits = [];
    for (const row of catalog?.figures || []) {
      if (row.figureId !== figure) continue;
      for (const panel of row.panels) {
        if (panel.label.toUpperCase() === String(label).toUpperCase()) hits.push({row,panel});
      }
    }
    return hits.length === 1 ? hits[0] : null;
  }
  function pageRect(box, figure, pixels, page) {
    if (![box,figure].every(r => r?.length === 4 && r.every(Number.isFinite)) ||
        ![pixels,page].every(r => r?.length === 2 && r.every(v => Number.isFinite(v) && v > 0))) return null;
    const scaleX = (figure[2] - figure[0]) / pixels[0];
    const scaleY = (figure[3] - figure[1]) / pixels[1];
    const x = Math.max(0,(figure[0] + box[0] * scaleX) / page[0]);
    const y = Math.max(0,(figure[1] + box[1] * scaleY) / page[1]);
    const width = Math.min(1,(figure[0] + box[2] * scaleX) / page[0]) - x;
    const height = Math.min(1,(figure[1] + box[3] * scaleY) / page[1]) - y;
    return width > 0 && height > 0 ? {x,y,width,height} : null;
  }
  // Manual edits use normalized rectangles relative to the whole panel crop.
  // Use rectangle differences so two inclusions may be disjoint or form an L.
  function validCuts(cuts = []) {
    return Array.isArray(cuts) && cuts.length <= 256 && cuts.every(r => r &&
      [r.x,r.y,r.width,r.height].every(Number.isFinite) && r.x >= 0 && r.y >= 0 &&
      r.width > 0 && r.height > 0 && r.x + r.width <= 1.000001 && r.y + r.height <= 1.000001);
  }
  function sameRect(a,b) {
    return a && b && ['x','y','width','height'].every(k => Math.abs(a[k]-b[k]) < 1e-7);
  }
  function project(rect, frame) {
    return {x:frame.x + rect.x*frame.width, y:frame.y + rect.y*frame.height,
      width:rect.width*frame.width, height:rect.height*frame.height};
  }
  function relative(rect,frame) {
    return {x:Math.max(0,(rect.x-frame.x)/frame.width),y:Math.max(0,(rect.y-frame.y)/frame.height),
      width:rect.width/frame.width,height:rect.height/frame.height};
  }
  function subtract(a,b) {
    const right=a.x+a.width, bottom=a.y+a.height;
    const l=Math.max(a.x,b.x), t=Math.max(a.y,b.y), r=Math.min(right,b.x+b.width), d=Math.min(bottom,b.y+b.height);
    if (r<=l || d<=t) return [a];
    return [{x:a.x,y:a.y,width:a.width,height:t-a.y}, {x:a.x,y:d,width:a.width,height:bottom-d},
      {x:a.x,y:t,width:l-a.x,height:d-t}, {x:r,y:t,width:right-r,height:d-t}]
      .filter(rect => rect.width>1e-8 && rect.height>1e-8);
  }
  function editRegion(previous, rect, exclude) {
    if (!previous) return exclude ? null : {rect,cuts:[]};
    const old=previous.rect;
    if (exclude) {
      const clipped = {x:Math.max(old.x,rect.x), y:Math.max(old.y,rect.y)};
      clipped.width=Math.min(old.x+old.width,rect.x+rect.width)-clipped.x;
      clipped.height=Math.min(old.y+old.height,rect.y+rect.height)-clipped.y;
      if (clipped.width<=0 || clipped.height<=0) return previous;
      const cut=relative(clipped,old);
      const added=previous.cuts.reduce((parts,c) => parts.flatMap(p=>subtract(p,c)),[cut]);
      const cuts=[...previous.cuts,...added];
      if (cuts.reduce((area,c)=>area+c.width*c.height,0) >= 1-1e-8) throw Error('请至少保留一部分 Panel。');
      if (!validCuts(cuts)) throw Error('剪除区域过多，请重新框选。');
      return {rect:old,cuts};
    }
    const x=Math.min(old.x,rect.x), y=Math.min(old.y,rect.y);
    const bounds={x,y,width:Math.max(old.x+old.width,rect.x+rect.width)-x,height:Math.max(old.y+old.height,rect.y+rect.height)-y};
    const holes=[...subtract(bounds,old), ...previous.cuts.map(c=>project(c,old))];
    const cuts=holes.flatMap(h=>subtract(h,rect)).map(h=>relative(h,bounds));
    if (!validCuts(cuts)) throw Error('选区过于复杂，请重新框选。');
    return {rect:bounds,cuts};
  }
  function paintMask(ctx,mask,width,height) {
    if (mask?.width && mask.height && mask.hidden?.length) {
      const sx=width/mask.width, sy=height/mask.height;
      ctx.save();
      const fill = boxes => {
        for (const [x,y,right,bottom] of boxes) {
          const x0=Math.round(x*sx),y0=Math.round(y*sy);
          ctx.fillRect(x0,y0,Math.round(right*sx)-x0,Math.round(bottom*sy)-y0);
        }
      };
      ctx.fillStyle='rgb('+mask.paper.join(',')+')'; fill(mask.hidden);
      ctx.fillStyle='#fff'; fill(mask.white || []);
      ctx.restore();
    }
    if (mask?.cuts?.length) {
      ctx.save(); ctx.fillStyle='#fff';
      for (const c of mask.cuts) {
        const left=Math.round(c.x*width), top=Math.round(c.y*height);
        ctx.fillRect(left,top,Math.round((c.x+c.width)*width)-left,Math.round((c.y+c.height)*height)-top);
      }
      ctx.restore();
    }
  }
  async function renderCrop(page, rect, pageSize, edge, signal, thumbnail = false, mask) {
    const viewport = page.getViewport({scale:1});
    if (!Array.isArray(pageSize) || pageSize.length !== 2 ||
        !pageSize.every(Number.isFinite) || Math.abs(pageSize[0]-viewport.width) > .1 ||
        Math.abs(pageSize[1]-viewport.height) > .1) throw Error('PDF_PANEL_PAGE_SIZE_MISMATCH');
    if (!rect || ![rect.x,rect.y,rect.width,rect.height].every(Number.isFinite) ||
        rect.x < 0 || rect.y < 0 || rect.width <= 0 || rect.height <= 0 ||
        rect.x + rect.width > 1.00001 || rect.y + rect.height > 1.00001) throw Error('PDF_PANEL_BOUNDS_INVALID');
    const width = rect.width * viewport.width, height = rect.height * viewport.height;
    const scale = Math.min(5, Math.max(96,Math.min(1600,Number(edge)||1200))/Math.max(width,height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1,Math.ceil(width*scale));
    canvas.height = Math.max(1,Math.ceil(height*scale));
    let task;
    const abort = () => task?.cancel();
    signal?.addEventListener('abort',abort,{once:true});
    try {
      if (signal?.aborted) throw Error('PDF_PANEL_SOURCE_CHANGED');
      task = page.render({canvas,viewport:page.getViewport({scale}),background:'white',annotationMode:0,
        transform:[1,0,0,1,-rect.x*viewport.width*scale,-rect.y*viewport.height*scale]});
      await task.promise;
      paintMask(canvas.getContext('2d'),mask,canvas.width,canvas.height);
      let dataUrl = thumbnail ? canvas.toDataURL('image/jpeg',.82) : canvas.toDataURL('image/png');
      if (dataUrl.length > 2.6e6) dataUrl = canvas.toDataURL('image/jpeg',.88);
      if (dataUrl.length > 2.6e6) dataUrl = canvas.toDataURL('image/jpeg',.68);
      if (dataUrl.length > 2.6e6) throw Error('PDF_PANEL_IMAGE_TOO_LARGE');
      return {dataUrl,mediaType:dataUrl.slice(5,dataUrl.indexOf(';')),width:canvas.width,height:canvas.height};
    } finally {
      signal?.removeEventListener('abort',abort);
      canvas.width = canvas.height = 0;
    }
  }
  function references(question) {
    const out = [];
    const pattern = /(?:\b(extended\s+data|supplement(?:ary|al)?)\s+)?(?:\bfig(?:ure)?\.?|图)\s*(s?)\s*(\d+)\s*(?:的\s*)?(?:panels?\s+)?[（(]?\s*([a-z])(?=[)）\s.,:;，。？！、!?–—-]|[^\x00-\x7f]|$)/giu;
    const input = String(question || '');
    for (const m of input.matchAll(pattern)) {
      const series = /^extended/i.test(m[1]) ? 'ed' : m[1] || m[2] ? 's' : '';
      const figureId = 'figure-' + series + Number(m[3]);
      const add = label => {
        if (!out.some(x => x.figureId === figureId && x.label === label)) out.push({figureId,label});
      };
      let previous = m[4].toUpperCase();
      add(previous);
      let tail = input.slice(m.index+m[0].length);
      const next = /^\s*([–—-]|[,，、/&]|and\b|和|与|及)\s*([a-z])(?![a-z0-9])/iu;
      for (let n; (n = next.exec(tail)); tail = tail.slice(n[0].length)) {
        const last = n[2].toUpperCase();
        if (['–','—','-'].includes(n[1]) && last>previous)
          for (let c=previous.charCodeAt(0)+1;c<last.charCodeAt(0);c++) add(String.fromCharCode(c));
        add(last); previous = last;
      }
    }
    return out;
  }
  function attachmentId(hash,figure,label) {
    return hashPattern.test(hash) && /^figure-(?:ed|s)?\d+$/.test(figure) && /^[a-z0-9_-]{1,24}$/i.test(label)
      ? 'pdf-panel:'+hash+':'+figure+':'+label.toUpperCase() : '';
  }
  function applyArtworkPages(figures, catalog, hash) {
    for (const figure of figures || []) {
      if (figure.sourceFingerprint !== hash || figure.sourceExternal ||
          ['manifest','user-selection'].includes(figure.artworkPageEvidence)) continue;
      const matches = catalog.figures.filter(row => row.figureId === figure.figureId);
      const row = matches.length === 1 ? matches[0] : null;
      if (row?.verifiedPage && (figure.captionPageNumbers || [figure.pageNumber]).includes(row.captionPage)) {
        figure.artworkPageEvidence = 'verified-page-regions';
        figure.artworkPageNumbers = [row.page];
        figure.artworkCoverage = 'complete';
      } else if (figure.artworkPageEvidence === 'verified-page-regions' && figure.panelExtractPageIndex) {
        figure.artworkPageEvidence = 'caption-anchor-page';
        figure.artworkPageNumbers = [figure.pageNumber];
        figure.artworkCoverage = 'partial';
      } else continue;
      figure.panelExtractPageIndex = !!row?.verifiedPage;
    }
  }
  const api = {revision, figureId, key, read, put, complete, remove, find, pageRect, validCuts, sameRect, project, relative, editRegion, paintMask, renderCrop, references, attachmentId, applyArtworkPages};
  globalThis.SciLLM = Object.assign(globalThis.SciLLM || {}, {PdfPanelEvidence:api});
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
