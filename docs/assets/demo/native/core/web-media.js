(function(root){
  'use strict';
  const api=root.SciLLM ||= {};
  const excluded='[data-sci-plugin-ui],[data-brevess-magnifier],#sci-logic-panel,#sci-article-navigator,#sci-figure-image-viewer';
  function safeSource(value,base){if(!value)return "";try{const u=new URL(value,base);return ['http:','https:','blob:'].includes(u.protocol)||/^data:image\//i.test(value)?u.href:'';}catch{return '';}}
  function mediaId(source){
    // Stable local locator, not a permission or content-integrity credential.
    // Actions also bind the complete source and existing workspace identities.
    const words=[2166136261,2246822519,3266489917,668265263];
    for(let i=0;i<source.length;i++)for(let j=0;j<4;j++)words[j]=Math.imul(words[j]^source.charCodeAt(i),[16777619,2246822519,3266489917,668265263][j]);
    return 'web-media-'+words.map(x=>(x>>>0).toString(16).padStart(8,'0')).join('');
  }
  function collectWebMedia(doc){
    const found=[],seen=new Map();
    for(const element of doc.querySelectorAll('img,video')){
      if(element.closest(excluded))continue;
      const video=element.tagName==='VIDEO',box=element.getBoundingClientRect();
      if(!video&&Math.max(box.width,element.naturalWidth||0)<32&&Math.max(box.height,element.naturalHeight||0)<32)continue;
      const source=safeSource(video?(element.currentSrc||element.src||element.querySelector('source')?.src||element.poster):(element.currentSrc||element.src||element.dataset.src),doc.baseURI);
      if(!source)continue;
      const identity=(video?'video:':'image:')+source,id=mediaId(identity);
      if(seen.has(id)){if(seen.get(id).webMedia.identity===identity)seen.get(id).mediaElements.push(element);continue;}
      let thumbnail=video?safeSource(element.poster,doc.baseURI):source;
      if(video&&!element.poster&&element.readyState>=2){try{const c=doc.createElement('canvas'),scale=Math.min(1,640/element.videoWidth);c.width=element.videoWidth*scale;c.height=element.videoHeight*scale;c.getContext('2d').drawImage(element,0,0,c.width,c.height);thumbnail=c.toDataURL('image/png');}catch{thumbnail='';}}
      const caption=String(element.closest('figure')?.querySelector('figcaption')?.textContent||element.alt||element.title||element.getAttribute('aria-label')||'').trim().slice(0,4000);
      const item={figureId:id,figureLabel:(video?'视频':'图片')+' '+(found.length+1),caption,sourceKind:video?'web-video':'web-image',element,captionElement:element,imageElements:video?[]:[element],mediaElements:[element],panelHints:[],contextParagraphs:[],isSupplemental:false,
        webMedia:{kind:video?'video':'image',source,identity,thumbnail,title:caption||((video?'视频':'图片')+' '+(found.length+1))}};
      found.push(item);seen.set(id,item);
    }
    return found;
  }
  function renderWebMediaCards({document:doc=globalThis.document,mount,figures,getNote,onLocate,onSaveNote,onAsk,onAnnotate,drafts=new Map()}){
    const active=doc.activeElement,focused=mount.contains(active)&&active.tagName==='TEXTAREA'?{id:active.closest('[data-media-id]')?.dataset.mediaId,start:active.selectionStart,end:active.selectionEnd}:null;
    mount.replaceChildren();
    for(const figure of figures){
      const card=doc.createElement('section');card.className='brevess-web-media-card';card.dataset.mediaId=figure.figureId;
      card.style.cssText='border:1px solid var(--bv-line,#ddd);border-radius:8px;padding:12px;margin:10px 0;background:var(--bv-surface,#fff)';
      const title=doc.createElement('strong');title.textContent=figure.figureLabel;
      const preview=doc.createElement('div');preview.style.cssText='margin:8px 0;text-align:center;background:var(--bv-raised,#f7f7f7)';
      if(figure.webMedia.thumbnail){const image=doc.createElement('img');image.src=figure.webMedia.thumbnail;image.alt=figure.webMedia.title;image.loading='lazy';image.style.cssText='max-width:100%;max-height:220px;object-fit:contain';preview.append(image);}else preview.textContent='▶ 视频缩略图暂不可用';
      const caption=doc.createElement('p');caption.textContent=figure.webMedia.title;caption.style.cssText='font-size:12px;overflow-wrap:anywhere';
      const actions=doc.createElement('div');actions.style.cssText='display:flex;gap:8px;flex-wrap:wrap';
      const status=doc.createElement('output');status.setAttribute('aria-live','polite');status.style.cssText='display:block;font-size:12px;margin-top:6px';
      const action=(label,fn)=>{const b=doc.createElement('button');b.type='button';b.textContent=label;b.addEventListener('click',async()=>{b.disabled=true;try{await fn();}catch(e){status.textContent=e?.message||'操作失败';}finally{b.disabled=false;}});actions.append(b);return b;};
      const editor=doc.createElement('div');editor.hidden=!drafts.has(figure.figureId);
      const input=doc.createElement('textarea');input.setAttribute('aria-label',figure.figureLabel+'笔记');input.value=String(drafts.has(figure.figureId)?drafts.get(figure.figureId):getNote(figure)||'');input.addEventListener('input',()=>drafts.set(figure.figureId,input.value));input.maxLength=12000;input.style.cssText='width:100%;box-sizing:border-box;min-height:90px;margin-top:8px';
      const save=doc.createElement('button');save.type='button';save.textContent='保存笔记';
      const note=doc.createElement('p');note.style.cssText='white-space:pre-wrap;font-size:13px';note.textContent=String(getNote(figure)||'');
      save.addEventListener('click',async()=>{save.disabled=true;const value=input.value;try{await onSaveNote(figure,value);note.textContent=value;status.textContent='笔记已保存';if(drafts.get(figure.figureId)===value){drafts.delete(figure.figureId);if(input.value===value)editor.hidden=true;}}catch(e){status.textContent=e?.message||'保存失败，草稿已保留';}finally{save.disabled=false;}});
      editor.append(input,save);action('跳转',()=>onLocate(figure));action('笔记',()=>{editor.hidden=!editor.hidden;if(!editor.hidden)input.focus();});action('提问',()=>onAsk(figure));if(figure.webMedia.kind==='image'&&onAnnotate)action('标注',()=>onAnnotate(figure));
      card.append(title,preview,caption,actions,note,editor,status);mount.append(card);if(focused?.id===figure.figureId&&!editor.hidden){input.focus();input.setSelectionRange(Math.min(focused.start,input.value.length),Math.min(focused.end,input.value.length));}
    }
    if(!figures.length){const empty=doc.createElement('p');empty.textContent='当前页面尚未发现图片或视频；可在加载完成后刷新。';mount.append(empty);}
  }
  function openFigureNoteEditor({document:doc=globalThis.document,title='图片笔记',value='',onSave}){
    doc.querySelectorAll('[data-brevess-figure-note]').forEach(node=>node.remove());
    const host=doc.createElement('div');host.dataset.sciPluginUi='';host.dataset.brevessFigureNote='';
    host.style.cssText='position:fixed;right:24px;top:20%;z-index:2147483647;width:min(360px,calc(100vw - 32px));background:var(--bv-surface,white);color:var(--bv-text,#222);border:1px solid var(--bv-line-strong,#aaa);border-radius:8px;padding:16px;box-shadow:0 4px 24px #0003;font:14px/1.5 sans-serif';
    const label=doc.createElement('strong');label.textContent=title;const input=doc.createElement('textarea');input.value=value;input.maxLength=12000;input.setAttribute('aria-label','图片笔记');input.style.cssText='display:block;width:100%;box-sizing:border-box;min-height:120px;margin:12px 0';
    const save=doc.createElement('button');save.type='button';save.setAttribute('aria-label','保存');save.title='保存';save.innerHTML='<svg width=22 height=22 viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 3h13l3 3v15H4zM8 3v6h8V3M8 21v-8h8v8"/></svg>';const close=doc.createElement('button');close.type='button';close.setAttribute('aria-label','关闭');close.title='关闭';close.innerHTML='<svg width=22 height=22 viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>';close.style.marginLeft='8px';const status=doc.createElement('output');status.style.display='block';status.setAttribute('aria-live','polite');
    for(const b of [save,close])b.style.cssText='display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;padding:6px;border:1px solid var(--bv-line,#cbd5e1);border-radius:6px;background:var(--bv-raised,#f8fafc);color:var(--bv-text,#334155);cursor:pointer;margin-right:8px';
    host.addEventListener('click',e=>e.stopPropagation());host.addEventListener('keydown',e=>{if(e.key==='Escape'){e.stopPropagation();host.remove();}});
    save.addEventListener('click',async()=>{save.disabled=true;const submitted=input.value;try{await onSave(submitted);status.textContent=input.value===submitted?'已保存':'先前内容已保存；还有未保存修改';}catch(e){status.textContent=e?.message||'保存失败，草稿已保留';}finally{save.disabled=false;}});close.addEventListener('click',()=>host.remove());host.append(label,input,save,close,status);doc.documentElement.append(host);input.focus();return host;
  }
  Object.assign(api,{collectWebMedia,renderWebMediaCards,openFigureNoteEditor});
})(globalThis);
