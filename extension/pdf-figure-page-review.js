(function () {
  'use strict';
  const api = globalThis.SciLLM = globalThis.SciLLM || {};
  const t = value => api.translateInterfaceText?.(value) || value;

  // Nonmodal UI; save/focus adapters keep the existing PDF identity, source,
  // manual-selection and disk-confirmation guards authoritative.
  api.createPdfFigurePageReview = function ({ capture, current, parsePages, save }) {
    const viewer = document.getElementById('pdfNativeViewer'), trigger = document.getElementById('pdfReaderReviewFigurePages');
    let epoch = 0, context = null, active = false, busy = false, supplement = false, picks = [];
    const panel = document.createElement('section'); panel.id = 'pdfFigurePageReview'; panel.hidden = true;
    panel.className = 'pdf-figure-sequential-review'; panel.dataset.sciPluginUi = '';
    panel.setAttribute('aria-label', t('核对图像页'));
    const status = document.createElement('output'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const help = document.createElement('span'); help.textContent = t('点击图像所在页依次标记；按住 S 标记补图。滚轮翻页，再点“完成核对”保存。');
    const undo = document.createElement('button'); undo.type = 'button'; undo.textContent = t('撤销上次');
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = t('取消未保存');
    panel.append(status, help, undo, cancel); (document.getElementById('pdfOriginalViewer') || document.body).append(panel);
    const labels = () => picks.map(p => `${p.label} → p.${p.page}${p.saved ? ' ✓' : ''}`).join(' · ');
    function render(message = '') {
      document.querySelectorAll('[data-pdf-review-marker]').forEach(n => n.remove());
      for (const pick of picks) {
        const page = viewer?.querySelector(`[data-pdf-page-number="${pick.page}"]`); if (!page) continue;
        let rail = page.querySelector('[data-pdf-review-marker]');
        if (!rail) { rail = document.createElement('div'); rail.dataset.pdfReviewMarker = ''; rail.className = 'pdf-figure-review-marker'; page.append(rail); }
        const badge = document.createElement('span'); badge.textContent = pick.label + (pick.saved ? ' ✓' : ''); rail.append(badge);
      }
      status.textContent = message || labels() || t('待标记 Figure 1（按 S 切换补图）');
      undo.disabled = busy || !picks.length || picks.at(-1)?.saved; cancel.disabled = busy;
      if (trigger) { trigger.textContent = t(active ? (busy ? '正在保存…' : '完成核对') : '核对图像'); trigger.setAttribute('aria-pressed', String(active)); }
    }
    function close() { epoch++; active = false; busy = false; context = null; picks = []; supplement = false; panel.hidden = true; viewer?.classList.remove('is-checking-figure-pages'); render(); }
    function assertCurrent(token) { if (token !== epoch || !active || !context || !current(context)) throw new Error(t('文献或图像来源已变化，请取消后重新核对。')); }
    const numbered = figure => {
      const match = String(figure.figureLabel || figure.figureId || '').match(/(?:fig(?:ure)?\.?\s*[-_:]?\s*)?(S?)\s*(\d+)\s*$/iu);
      return match ? { supplement: !!match[1], number: Number(match[2]) } : null;
    };
    async function open() {
      if (active) return; const token = ++epoch; active = true; busy = true; picks = []; panel.hidden = false;
      viewer?.classList.add('is-checking-figure-pages'); document.dispatchEvent(new Event('brevess:pdf-review-start')); render(t('正在读取图像目录…'));
      try { const value = await capture(); if (token !== epoch || !active) return; context = value; assertCurrent(token); busy = false; render(); }
      catch (error) { if (token === epoch && active) { busy = false; render(error.message); } }
    }
    async function finish() {
      if (!active || busy) return; const token = epoch;
      try {
        assertCurrent(token); busy = true; render(t('正在保存图像页…'));
        for (const pick of picks) {
          if (pick.saved) continue; assertCurrent(token);
          const pages = parsePages(String(pick.page), pick.figure.pdfPageCount);
          const receipt = await save(pick.figure, pages, context); assertCurrent(token);
          if (receipt?.success !== true || receipt.figureId !== pick.figure.figureId || JSON.stringify(receipt.pageNumbers) !== JSON.stringify(pages))
            throw new Error(receipt?.error || t('缺少此 Figure 的保存回执'));
          pick.saved = true;
        }
        close(); document.dispatchEvent(new CustomEvent('brevess:pdf-page-review-saved'));
      } catch (error) { if (token === epoch && active) { busy = false; render(t('未全部保存，已确认项标有 ✓；可重试。') + ' ' + error.message + ' ' + labels()); } }
    }
    function click(event) {
      if (!active || busy || event.button !== 0 || event.detail > 1 || event.target.closest('[data-sci-plugin-ui],button,input,textarea')) return;
      const page = event.target.closest('.pdf-native-page[data-pdf-page-number]'); if (!page) return;
      event.preventDefault(); event.stopImmediatePropagation();
      try {
        assertCurrent(epoch);
        const pageNumber = Number(page.dataset.pdfPageNumber), number = picks.filter(p => p.supplement === supplement).length + 1;
        const candidates = (context.figures || []).filter(f => { const n = numbered(f); return n && n.supplement === supplement && n.number === number; });
        if (candidates.length !== 1) throw new Error(t('目录中缺少或不能唯一确定') + ` Figure ${supplement ? 'S' : ''}${number}` + t('；请先检查图注。'));
        const figure = candidates[0]; parsePages(String(pageNumber), figure.pdfPageCount);
        picks.push({ figure, page: pageNumber, supplement, label: `Figure ${supplement ? 'S' : ''}${number}`, saved: false }); render();
      } catch (error) { render(error.message); }
    }
    function keydown(event) {
      if (!active || event.target.closest?.('input,textarea,[contenteditable="true"]')) return;
      if (event.code === 'KeyS' && !event.ctrlKey && !event.metaKey && !event.altKey) { supplement = true; event.preventDefault(); }
      if (event.key === 'Escape' && !busy) close();
    }
    const keyup = event => { if (event.code === 'KeyS') supplement = false; }, blur = () => { supplement = false; };
    undo.onclick = () => { if (!busy && !picks.at(-1)?.saved) { picks.pop(); render(); } }; cancel.onclick = () => { if (!busy) close(); };
    viewer?.addEventListener('click', click, true); document.addEventListener('keydown', keydown); document.addEventListener('keyup', keyup); window.addEventListener('blur', blur);
    return { open, close, finish, toggle: () => active ? finish() : open(), destroy() { close(); viewer?.removeEventListener('click', click, true); document.removeEventListener('keydown', keydown); document.removeEventListener('keyup', keyup); window.removeEventListener('blur', blur); panel.remove(); } };
  };


  api.createPdfFigurePreflight = function ({ capture, current, check, saveCaption, focus, reviewPages }) {
    let epoch=0, context=null, rows=[], active='', saving=false;
    const drafts=new Map(); let owner=null;
    const make=(tag,text,cls='')=>{const n=document.createElement(tag);n.textContent=t(text||'');n.className=cls;return n;};
    const button=(text,action)=>{const n=make('button',text,'pdf-reader-button');n.type='button';n.onclick=action;return n;};
    const panel=make('section','','pdf-figure-page-review pdf-figure-preflight');panel.hidden=true;panel.id='pdfFigurePreflight';panel.dataset.sciPluginUi='';
    panel.setAttribute('role','region');panel.setAttribute('aria-label',t('全部 Figure 输入检查'));
    const header=make('header','','pdf-figure-page-review-heading');const title=make('strong','全部 Figure 输入检查');
    const host=document.getElementById('pdfOriginalViewer')||document.body;
    const close=()=>{panel.hidden=true;input.remove();if(!document.querySelector('.pdf-figure-page-review:not([hidden])'))host.classList.remove('pdf-figure-review-open');};
    header.append(title,button('×',close));
    const body=make('div','','pdf-figure-page-review-body');
    const summary=make('p','正在检查…');summary.setAttribute('role','status');
    const list=make('div','','pdf-preflight-list');
    const editor=make('div','','pdf-preflight-editor');
    const name=make('strong');const reason=make('p');const links=make('div','','pdf-figure-page-review-links');
    const original=make('details');original.append(make('summary','自动提取图注（保留原文）'));const originalText=make('pre');original.append(originalText);
    const label=make('label','完整图注（可手动补充或修正）');const input=make('textarea');input.rows=9;input.maxLength=20000;input.setAttribute('aria-label',t('完整图注（可手动补充或修正）'));input.dataset.preflightCaption='';label.append(input);
    const hint=make('p','请对照原页补齐完整图注。保存后作为用户补充用于解图，不冒充 PDF 原文。');
    const message=make('p');message.setAttribute('role','status');
    const save=button('确认图注并重新检查',()=>commit(false));save.dataset.preflightSave='';
    const reset=button('撤销人工图注',()=>commit(true));reset.dataset.preflightReset='';
    const pages=button('核对图像页',()=>{close();reviewPages();});
    editor.append(name,reason,links,original,label,hint,save,reset,pages,message);
    body.append(summary,button('重新检查全部图',()=>scan()),list,editor);panel.append(header,body);host.append(panel);
    // A dormant textarea must not look like an open workspace editor to the
    // restore guard. Its draft stays in this controller and is rebound on open.
    input.remove();
    function describe(row){
      if(row.status==='ready')return row.figure.userCaption?t('可解读 · 使用人工图注'):t('图注与正文检查通过');
      const reasons=row.figure.reviewReasons||[];
      if(row.code==='PDF_FIGURE_CAPTION_INCOMPLETE')return t(reasons.includes('unresolved-caption-control-glyph')?'图注含无法识别的字符，请对照原页修正。':'图注可能未完整提取，请补齐后重新检查。');
      const messages={PDF_FIGURE_CAPTION_BINDING_UNAVAILABLE:'图注与原文定位不一致，请查看原页并补充图注。',PDF_FIGURE_CONTEXT_INCOMPLETE:'相关正文证据不足，请等待索引就绪后重新检查。',PDF_FIGURE_USER_CAPTION_INVALID:'人工图注未能恢复或含无效字符，请核查并重新保存。',PDF_FIGURE_CONTEXT_STALE:'文献已变化，请重新检查。'};
      return t(messages[row.code]||'检查未通过，请重新检查或核查原页。')+' ('+(row.code||'UNKNOWN')+')';
    }
    function select(id){
      active=id;const row=rows.find(r=>r.figure.figureId===id);editor.hidden=!row;if(!row)return;
      const f=row.figure;name.textContent=f.figureLabel||id;reason.textContent=describe(row);originalText.textContent=f.caption;
      input.value=drafts.get(id)??f.userCaption?.text??f.caption.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu,'�');
      reset.disabled=saving||!f.userCaption;save.disabled=saving;input.disabled=saving;message.textContent='';links.replaceChildren();
      for(const page of f.captionPageNumbers||[]){const b=button('p. '+page,()=>void focus(f,page,context).catch(e=>{message.textContent=e.message;}));links.append(b);}
    }
    function render(){
      list.replaceChildren();for(const row of rows){const f=row.figure;const b=button((f.figureLabel||f.figureId)+' · '+(row.status==='ready'?t('可解读'):t('需核查'))+' · '+(f.artworkCoverage==='complete'?t('图像页已确认'):t('图像页待核查')),()=>{if(!saving)select(f.figureId);});b.dataset.preflightFigure=f.figureId;b.dataset.status=row.status;list.append(b);}
      summary.textContent=t('图注与正文检查通过')+' '+rows.filter(r=>r.status==='ready').length+' / '+rows.length+' · '+t('检查不调用模型');
      select(rows.some(r=>r.figure.figureId===active)?active:(rows.find(r=>r.status!=='ready')||rows[0])?.figure.figureId);
    }
    input.oninput=()=>{drafts.set(active,input.value);message.textContent=t('未保存');};
    async function scan(){
      if(saving)return;const token=++epoch;summary.textContent=t('正在检查…');
      try{
        const c=await capture();if(token!==epoch)return;
        if(owner!==c.native){drafts.clear();owner=c.native;}context=c;
        const next=[];
        for(const figure of c.figures){
          if(token!==epoch||!current(c))return;
          try{await check(figure,c);next.push({figure,status:'ready'});}catch(e){next.push({figure,status:'review',code:e.code||e.message});}
          await new Promise(resolve=>setTimeout(resolve,0));
        }
        if(token!==epoch||!current(c))return;rows=next;render();
        document.getElementById('pdfReaderCheckFigures')?.setAttribute('title',summary.textContent);
      }catch(e){if(token===epoch)summary.textContent=t('检查尚未就绪，请稍后重试。')+' '+(e.code||e.message);}
    }
    async function commit(clear){
      if(saving)return;const row=rows.find(r=>r.figure.figureId===active);if(!row||!current(context)){message.textContent=t('文献已变化，请重新检查。');return;}
      const token=++epoch;const c=context;const text=input.value;drafts.set(active,text);saving=true;save.disabled=true;reset.disabled=true;input.disabled=true;
      try{const result=await saveCaption(row.figure,text,clear,c);if(token!==epoch||!current(c))throw new Error(t('文献已变化，请重新检查。'));
        if(result?.success!==true||result.figureId!==row.figure.figureId)throw new Error(t('保存失败，请重试'));
        drafts.delete(row.figure.figureId);saving=false;await scan();message.textContent=t('已保存并重新检查。');
      }catch(e){message.textContent=t('保存失败，已保留输入。')+' '+(e.code||e.message);}
      finally{saving=false;save.disabled=false;input.disabled=false;reset.disabled=!rows.find(r=>r.figure.figureId===active)?.figure.userCaption;}
    }
    return {scan,close,async open(){panel.hidden=false;label.append(input);host.classList.add('pdf-figure-review-open');await scan();},destroy(){epoch++;close();panel.remove();}};
  };

  function initialize() {
    const trigger = document.getElementById('pdfReaderReviewFigurePages');
    if (!trigger || typeof globalThis.buildFigureWorkspaceSnapshot !== 'function' ||
        typeof globalThis.setPdfFigureArtworkPages !== 'function') return;
    const adapters = {
      parsePages: api.SidebarUI.parseArtworkPages,
      currentPage() {
        return globalThis.__brevessPdfReaderBridge?.command('getCurrentPageNumber');
      },
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
        await Promise.all((catalog?.figures || []).map(figure=>restorePdfFigureUserCaption(figure).catch(()=>undefined)));
        if (globalThis.__brevessNativePdfDocument !== native || globalThis.__brevessNativePdfFigures !== catalog) throw new Error('文献已变化，请重新打开。');
        // Read the catalog directly. Building a full workspace snapshot can
        // seed the editable Figure draft while startup restoration is pending.
        const snapshot = { workspaceLifecycle: articleWorkspaceLifecycleGeneration,
          figures: (catalog?.figures || []).map(figure => ({
            ...figure, documentHash: figure.sourceFingerprint,
            pdfDocumentGeneration: native.documentGeneration, pdfPageCount: native.pageCount,
            sourceRevision: catalog.sourceRevision,
            artworkOwnerSignature: pdfFigureArtworkOwnerSignature(figure, native)
          })) };
        return {
          native, catalog, revision: catalog?.sourceRevision, lifecycle: snapshot.workspaceLifecycle,
          figures: snapshot.figures.filter(figure => figure.sourceKind === 'pdf-page-caption').map(figure => ({
            ...figure,
            artworkRestoreError: restoreErrors.get(figure.figureId) || '',
            artworkPageCandidates: [...(catalog.figures.find(item => item.figureId === figure.figureId)?.artworkPageCandidates || [])],
            artworkPageRecommendation: [...(catalog.figures.find(item => item.figureId === figure.figureId)?.artworkPageRecommendation || [])]
          }))
        };
      },
      current(context) {
        return globalThis.__brevessNativePdfDocument === context.native &&
          globalThis.__brevessNativePdfFigures === context.catalog &&
          context.catalog?.sourceRevision === context.revision &&
          articleWorkspaceLifecycleGeneration === context.lifecycle;
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
      focus(figure, page, context) {
        return focusPdfFigureArtworkCandidate({
          figureId: figure.figureId, documentHash: figure.documentHash,
          documentGeneration: figure.pdfDocumentGeneration, sourceFingerprint: figure.sourceFingerprint,
          workspaceLifecycle: context.lifecycle, pageNumber: page
        });
      }
    };
    const review = api.createPdfFigurePageReview(adapters);
    const preflight = api.createPdfFigurePreflight({...adapters,reviewPages:()=>review.open(),
      async check(figure,context){
        const live=context.catalog.figures.find(f=>f.figureId===figure.figureId);
        if(!adapters.current(context))throw Object.assign(new Error('PDF_FIGURE_CONTEXT_STALE'),{code:'PDF_FIGURE_CONTEXT_STALE'});
        await buildPdfFigureProductionEnvelope(live,{route:'text-only'});
      },
      saveCaption(figure,text,clear,context){return setPdfFigureUserCaption({figureId:figure.figureId,
        documentHash:figure.documentHash,documentGeneration:figure.pdfDocumentGeneration,
        sourceRevision:figure.sourceRevision,workspaceLifecycle:context.lifecycle,
        artworkOwnerSignature:figure.artworkOwnerSignature,text,clear,confirmed:true});}
    });
    document.getElementById('pdfReaderCheckFigures')?.addEventListener('click',()=>{review.close();void preflight.open();});
    let checkTimer;
    const schedule=()=>{clearTimeout(checkTimer);checkTimer=setTimeout(()=>void preflight.scan(),300);};
    document.addEventListener('brevess:pdf-figure-inventory-ready',schedule);
    document.addEventListener('brevess:pdf-semantic-ready',schedule);
    document.addEventListener('brevess:pdf-source-changing',()=>preflight.close());
    window.addEventListener('pagehide',()=>{clearTimeout(checkTimer);preflight.destroy();},{once:true});
    schedule();
    trigger.addEventListener('click', () => {preflight.close();void review.toggle();});
    document.addEventListener('brevess:pdf-source-changing', () => review.close());
    document.addEventListener('brevess:pdf-annotations-start', () => review.close());
    window.addEventListener('pagehide', () => review.destroy(), { once: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})();
