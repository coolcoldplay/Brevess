// HTML Figures keep their original publisher resource. The detector sees a
// bounded raster; the final crop always comes from the owning source image.
(() => {
  const whole = {x:0,y:0,width:1,height:1};
  const currentPage = () => location.href.split('#')[0];
  const letter = v => /^[a-z]$/i.test(String(v || '').trim()) ? String(v).trim().toUpperCase() : '';
  const cleanRect = value => {
    if (!value) return null;
    const {x,y,width,height} = value;
    return [x,y,width,height].every(Number.isFinite) && x>=0 && y>=0 && width>0 && height>0 &&
      x+width<=1.000001 && y+height<=1.000001 ? {x,y,width,height} : null;
  };
  function directLabel(img) {
    const explicit = img.closest('[data-panel-id],[data-subfigure],[data-panel]');
    for (const el of [...new Set([img,explicit])].filter(Boolean)) {
      for (const key of ['data-panel','data-panel-id','data-subfigure','aria-label','alt']) {
        const match = /^\s*(?:panel\s*)?\(?([a-z])\)?\s*$/i.exec(el.getAttribute(key) || '');
        if (match) return letter(match[1]);
      }
    }
    return '';
  }
  function sources(figure) {
    if (!figure || figure.sourceExternal || figure.sourceKind === 'pdf-page-caption') return [];
    const seen = new Set();
    return Array.from(figure.imageElements || []).filter(img => {
      if (!img?.isConnected) return false;
      const key = img.currentSrc || img.getAttribute('data-src') || img.src;
      if (!key || seen.has(key)) return false;
      seen.add(key); return true;
    });
  }
  function expected(figure) {
    return [...new Set((figure.panelHints || []).map(letter).filter(Boolean))].sort();
  }
  function captionFor(figure,label) {
    return (SciLLM.splitFigureCaptionByPanelGroups(figure.caption) || [])
      .filter(b => b.panels.includes(label)).map(b => b.text).join(' ').slice(0,4000);
  }
  function list() {
    return getFigureWorkspaceInventory().flatMap(figure => {
      const images = sources(figure);
      return images.map((img,index) => {
        const d = directLabel(img);
        const suffix = images.length>1 ? (d ? ' · '+d : ' · 图像 '+(index+1)) : '';
        return {figureId:figure.figureId,index,name:figure.figureLabel+suffix,title:figure.title || '',direct:d};
      });
    });
  }
  function signature(figure,img) {
    const saved = getSavedFigureOriginalAnalysisSource(img,figure);
    return JSON.stringify([currentPage(), figure.figureId, img.currentSrc, img.src,
      ...['srcset','data-src','data-original','data-viewer-src','data-lazy-src'].map(k => img.getAttribute(k)),
      img.closest('a[href]')?.getAttribute('href'), saved?.cacheKey, saved?.sha256, directLabel(img)]);
  }
  let recent;
  const loading = new WeakMap();
  function discard(entry) {
    if (!entry) return;
    clearTimeout(entry.timer); entry.expired=true;
    if (!entry.users && entry.source!==entry.img) releaseFigureImage(entry.source);
  }
  async function withSource(figure,img,work) {
    const sig = signature(figure,img);
    let entry = recent?.img===img && recent.sig===sig ? recent : null;
    if (!entry) {
      let load = loading.get(img);
      if (!load || load.sig!==sig) {
        const promise = loadPreparedFigureSource(img,Date.now()+24000,null,figure).then(source => {
          if (!img.isConnected || signature(figure,img)!==sig) {
            if (source!==img) releaseFigureImage(source);
            throw Error('网页原图已切换，请重新选择');
          }
          const next = {source,img,sig,users:0,expired:false};
          discard(recent); recent=next;
          next.timer=setTimeout(() => {if(recent===next){recent=null;discard(next);}},35000);
          return next;
        });
        load = {sig,promise}; loading.set(img,load);
        promise.finally(() => {if (loading.get(img)===load) loading.delete(img);}).catch(() => {});
      }
      entry=await load.promise;
    }
    if (entry.expired) throw Error('原图已切换，请重试');
    entry.users++;
    try {
      const result=await work(entry.source,sig);
      if (!img.isConnected || signature(figure,img)!==sig) throw Error('当前网页原图已变化，请重新提取');
      return result;
    } finally { if (--entry.users===0 && entry.expired && entry.source!==img) releaseFigureImage(entry.source); }
  }
  addEventListener('pagehide', () => {discard(recent); recent=null;});
  function raster(source) {
    const w = source.naturalWidth || source.width, h = source.naturalHeight || source.height;
    const scale = Math.min(1,1750/Math.max(w,h));
    const canvas = document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(w*scale)); canvas.height=Math.max(1,Math.round(h*scale));
    const ctx=canvas.getContext('2d',{alpha:false,willReadFrequently:true});
    ctx.fillStyle='white'; ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(source,0,0,canvas.width,canvas.height);
    const data=canvas.toDataURL('image/png');
    canvas.width=canvas.height=1;
    return data;
  }
  const recentModels = new Map(), sourceModels = new WeakMap(), warmed = new WeakMap();
  async function detect(source,labels,direct,w,h) {
    const data=raster(source);
    const hash = globalThis.crypto?.subtle ? Array.from(new Uint8Array(
      await crypto.subtle.digest('SHA-256',new TextEncoder().encode(data))), n=>n.toString(16).padStart(2,'0')).join('') : '';
    const key=hash && JSON.stringify([hash,w,h,direct,labels]);
    let result=key && recentModels.get(key);
    if (!result) {
      result=chrome.runtime.sendMessage({type:'WEB_FIGURE_PANEL_ANALYZE',job:{
        raster:data,expected:labels,direct,sourceWidth:w,sourceHeight:h
      }}).then(answer=>{
        if (!answer?.result) throw Error(answer?.error || '未能读取网页 Panel');
        return answer.result;
      });
      if (key) {
        recentModels.set(key,result);
        if (recentModels.size>12) recentModels.delete(recentModels.keys().next().value);
        result.catch(()=>{if(recentModels.get(key)===result)recentModels.delete(key);});
      }
    }
    return result;
  }
  async function describe(figure,img,source) {
    const labels = expected(figure), direct=directLabel(img), pageUrl=currentPage();
    const w=source.naturalWidth || source.width, h=source.naturalHeight || source.height;
    const sig=JSON.stringify([signature(figure,img),labels,w,h]);
    let model=sourceModels.get(source);
    if (model?.sig!==sig) {
      model={sig,promise:detect(source,labels,direct,w,h)};
      sourceModels.set(source,model);
      model.promise.catch(()=>{if(sourceModels.get(source)===model)sourceModels.delete(source);});
    }
    const {fingerprint,panels} = await model.promise;
    if(currentPage()!==pageUrl || !img.isConnected) throw Error('网页原图已切换');
    // A correction belongs to the exact image pixels and Figure. One key per
    // label also lets edits to different panels from two tabs coexist.
    const binding={figureId:figure.figureId,fingerprint,pageUrl};
    const possible=direct ? [direct] : [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'];
    const reply=await chrome.runtime.sendMessage({type:'WEB_FIGURE_PANEL_EDITS',binding,labels:possible});
    if (!reply?.rects) throw Error(reply?.error || '无法读取 Panel 校正记录');
    const output = new Map(panels.map(p=>[p.label,{...p}]));
    for (const label of possible) {
      const rect=cleanRect(reply.rects[label]);
      if (rect) {
        const saved=reply.rects[label], detected=output.get(label);
        const base=saved.preserveMask && SciLLM.PdfPanelEvidence.sameRect(rect,detected?.rect) ? detected.mask : null;
        const cuts=saved.cuts || [];
        output.set(label,{label,rect,mask:{...base,cuts},method:'manual',needsReview:false});
      }
    }
    return {fingerprint,binding,panels:[...output.values()].sort((a,b)=>a.label.localeCompare(b.label)),
      expected:direct ? [direct] : labels, sourceWidth:w,sourceHeight:h};
  }
  function getFigure(id) {
    const fig = findFigureAnalysisTarget(id);
    if (!fig || !sources(fig).length) throw Error('这幅 Figure 暂无可读取的网页原图');
    return fig;
  }
  function imageAt(figure,index) {
    const img = sources(figure)[index];
    if (!img) throw Error('原图已切换，请重新选择 Figure');
    return img;
  }
  function panelImage(figure,label) {
    const imgs=sources(figure), dedicated=imgs.filter(el=>directLabel(el)===label);
    if (dedicated.length===1) return dedicated[0];
    const composite=imgs.filter(el=>!directLabel(el));
    if (!dedicated.length && composite.length===1) return composite[0];
    throw Error('请在「提取与校正 Panel」选择对应的原图');
  }
  function encode(source,panel,edge) {
    return encodeFigureImageVariant(source,edge,{...panel.rect,reliable:true},true,panel.mask);
  }
  async function preview(figureId, requestedEdge = 900) {
    const maxEdge = Math.max(256, Math.min(2400, Number(requestedEdge) || 900));
    const savedPage = typeof activeSavedArticleDocument === 'function' && activeSavedArticleDocument();
    if (savedPage) {
      const local = Array.from(document.querySelectorAll('img[data-brevess-figure-id][data-brevess-image-index]'))
        .filter(img => img.dataset.brevessFigureId === figureId && /^data:image\/(png|jpeg|webp);base64,/i.test(img.getAttribute('src') || ''))
        .sort((a,b) => Number(a.dataset.brevessImageIndex) - Number(b.dataset.brevessImageIndex));
      if (!local.length) throw Error('这份本机文献未保存该 Figure 的图片');
      const images = [];
      for (const img of local) {
        await img.decode();
        if (activeSavedArticleDocument() !== savedPage || !img.isConnected) throw Error('本机文献已切换');
        images.push(encode(img, {rect:whole}, Math.ceil(maxEdge / Math.sqrt(local.length))));
      }
      return {name:findFigureAnalysisTarget(figureId)?.figureLabel || figureId, images};
    }
    const figure = findFigureAnalysisTarget(figureId);
    if (!figure) throw Error('当前文献没有这幅 Figure');
    const images = sources(figure);
    if (!images.length) {
      const saved = figure.sourceExternal ? await preparePersistedFigureImages(figure) : [];
      if (!saved.length) throw Error('这幅 Figure 暂无可预览的原图');
      return {name:figure.figureLabel, caption:figure.title, images:saved};
    }
    const page = currentPage();
    const edge = Math.max(256, Math.ceil(maxEdge / Math.sqrt(images.length)));
    const previews = [];
    for (const img of images) {
      if (currentPage() !== page) throw Error('当前文献已切换');
      previews.push(await withSource(figure, img, source => ({
        ...encode(source, {rect:whole}, edge), label:directLabel(img)
      })));
    }
    if (currentPage() !== page || images.some(img => !img.isConnected)) throw Error('网页原图已切换');
    return {name:figure.figureLabel, caption:figure.title, images:previews};
  }
  async function picture(id,rawLabel,edge,index) {
    const label=letter(rawLabel), fig=getFigure(id);
    if(!label) throw Error('Panel 字母无效');
    const img=index==null ? panelImage(fig,label) : imageAt(fig,index);
    return withSource(fig,img, async source=>{
      const data=await describe(fig,img,source), p=data.panels.find(x=>x.label===label);
      if (!p) throw Error('尚未定位到 Panel '+label+'，可在原图上框选');
      return {...encode(source,p,Math.max(256,Math.min(1400,Number(edge)||420))),
        attachmentId:'web-panel:'+String(getCanonicalArticleSnapshot().documentHash).replace(/[^A-Za-z0-9._-]/g,'_').slice(0,64)+':'+id+':'+label+':'+data.fingerprint.slice(0,16), label,
        name:fig.figureLabel,caption:captionFor(fig,label),method:p.method,needsReview:p.needsReview,ambiguous:p.needsReview};
    });
  }
  async function drawOriginal(id,index,canvas,stillCurrent) {
    const fig=getFigure(id),img=imageAt(fig,index);
    return withSource(fig,img,source=>{
      if(!stillCurrent())return;
      canvas.width=source.naturalWidth || source.width; canvas.height=source.naturalHeight || source.height;
      canvas.getContext('2d').drawImage(source,0,0);
    });
  }
  async function labels(id,index) {
    const figure = getFigure(id), img = imageAt(figure,index);
    return withSource(figure,img,async source => (await describe(figure,img,source)).panels.map(p => p.label));
  }
  async function inspect(id,index,edit) {
    const fig=getFigure(id),img=imageAt(fig,index);
    return withSource(fig,img,async source=>{
      const sig=signature(fig,img);
      const data=await describe(fig,img,source);
      if (!img.isConnected || signature(fig,img)!==sig) throw Error('网页原图已切换');
      if (edit) {
        const rect=cleanRect(edit.rect), label=letter(edit.label);
        if (edit.fingerprint!==data.fingerprint || !label || !rect || rect.width*data.sourceWidth<4 ||
            rect.height*data.sourceHeight<4 || (directLabel(img) && directLabel(img)!==label)) throw Error('请在当前原图重新框选 Panel');
        const previous=data.panels.find(p=>p.label===label), cuts=edit.cuts || [];
        if (!SciLLM.PdfPanelEvidence.validCuts(cuts)) throw Error('Panel 剪除范围无效');
        const preserveMask=!!previous?.mask?.hidden?.length && edit.preserveMask===true && SciLLM.PdfPanelEvidence.sameRect(previous.rect,rect);
        const mask={...(preserveMask ? previous.mask : null),cuts};
        const reply=await chrome.runtime.sendMessage({type:'WEB_FIGURE_PANEL_EDITS',binding:data.binding,labels:[label],edit:{label,rect,cuts,preserveMask}});
        if(!reply?.rects) throw Error(reply?.error || 'Panel 校正未能保存');
        data.panels = [...data.panels.filter(p=>p.label!==label),{label,rect,mask,method:'manual',needsReview:false}]
          .sort((a,b)=>a.label.localeCompare(b.label));
      }
      return {figureId:id,index,name:fig.figureLabel,fingerprint:data.fingerprint,expected:data.expected,
        width:data.sourceWidth,height:data.sourceHeight,original:encode(source,{rect:whole},1100).dataUrl,
        panels:data.panels.map(p=>({label:p.label,rect:p.rect,cuts:p.mask?.cuts || [],method:p.method,needsReview:p.needsReview,
          caption:captionFor(fig,p.label),thumb:encode(source,p,260).dataUrl}))};
    });
  }
  async function warm(id,index=0) {
    const fig=getFigure(id),img=imageAt(fig,index);
    const sig=JSON.stringify([signature(fig,img),expected(fig)]);
    if(warmed.get(img)===sig)return;
    await withSource(fig,img,source=>describe(fig,img,source));
    warmed.set(img,sig);
  }
  async function geometry(figure,label,img,source) {
    if (panelImage(figure,letter(label))!==img) return null;
    const sig=signature(figure,img);
    const data=await describe(figure,img,source);
    if(!img.isConnected || signature(figure,img)!==sig)return null;
    return data.panels.find(p=>p.label===letter(label) && !p.needsReview) || null;
  }
  globalThis.SciLLM = Object.assign(globalThis.SciLLM || {}, {webPanelReader:{list, labels, inspect, picture, preview, geometry, warm, drawOriginal,
    resolveSource(figure,label) {
      const img=panelImage(figure,letter(label));
      return {img,dedicated:directLabel(img)===letter(label)};
    }}});
})();
