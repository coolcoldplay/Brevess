/* Rich inserts use the existing note editor and the article's own source and image stores. */
(() => {
  'use strict';
  const imageRef = /!\[([^\]\n]{0,240})\]\(brevess-image:([a-f0-9]{64})\)/g;
  const fallbackKey = id => 'brevessNoteImage:' + id;
  const path = id => 'literature-notes/images/' + id + '.json';
  const raster = value => typeof value === 'string' && /^data:image\/(?:png|jpeg|gif|webp|avif);base64,[a-z\d+/=]+$/i.test(value);
  async function fromWorkspace(target,id) {
    if (!target) return null;
    const response = await chrome.runtime.sendMessage({type:'ARTICLE_WORKSPACE_GET_ASSET',...target,relativePath:path(id)});
    if (!response?.success && response?.error?.code !== 'WORKSPACE_NOT_FOUND') throw Error('未能读取笔记图片');
    return response?.data?.asset?.content?.dataUrl;
  }
  async function readImage(context,id) {
    const stored = await fromWorkspace(context.target,id);
    if (raster(stored)) return stored;
    for (const peer of context.paperSources || []) {
      const image = await fromWorkspace({workspaceId:peer.workspaceId,workspaceGeneration:peer.workspaceGeneration},id);
      if (raster(image)) return image;
    }
    const key = fallbackKey(id);
    const local = (await chrome.storage.local.get(key))[key];
    if (!raster(local)) throw Error('此笔记图片不可用');
    // A draft can acquire a workspace after it already contains an image.
    if (context.target && isCurrentLiteratureNoteContext(context)) await writeWorkspaceImage(context.target,id,local);
    return local;
  }
  async function writeWorkspaceImage(target,id,dataUrl) {
    const response = await chrome.runtime.sendMessage({type:'ARTICLE_WORKSPACE_SAVE_ASSET',...target,
      relativePath:path(id),expectedRevision:0,content:{dataUrl}});
    if (response?.error?.code === 'WORKSPACE_NOT_FOUND') return false;
    if (!response?.success && !(response?.error?.code === 'ASSET_REVISION_CONFLICT' && await fromWorkspace(target,id) === dataUrl))
      throw Error(response?.error?.message || '未能保存笔记图片');
    return true;
  }
  async function storeImage(context,dataUrl) {
    if (!raster(dataUrl)) throw Error('图片格式无法读取');
    const digest = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(dataUrl));
    const id = Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
    if (!isCurrentLiteratureNoteContext(context)) throw Error('当前论文已切换');
    if (!context.target || !await writeWorkspaceImage(context.target,id,dataUrl))
      await chrome.storage.local.set({[fallbackKey(id)]:dataUrl});
    return id;
  }
  async function hydrate(root) {
    const context = captureLiteratureNoteContext();
    await Promise.all([...root.querySelectorAll('img[data-note-image]:not([src])')].map(async img=>{
      try {
        const url = await readImage(context,img.dataset.noteImage);
        if (img.isConnected && isCurrentLiteratureNoteContext(context)) img.src = url;
      } catch (error) { img.title = error.message; }
    }));
  }
  async function portable(text,context) {
    const urls = new Map();
    for (const match of text.matchAll(imageRef)) if (!urls.has(match[2])) urls.set(match[2],await readImage(context,match[2]));
    return text.replace(imageRef,(_,alt,id) => '![' + alt + '](' + urls.get(id) + ')');
  }
  function fileUrl(file) {
    return new Promise((resolve,reject) => {
      const reader=new FileReader();
      reader.onload=()=>resolve(reader.result); reader.onerror=()=>reject(Error('无法读取剪贴板图片'));
      reader.readAsDataURL(file);
    });
  }
  async function rasterize(file) {
    if (['image/png','image/jpeg','image/webp','image/gif','image/avif'].includes(file.type) && file.size <= 4*1024*1024) return fileUrl(file);
    const url=URL.createObjectURL(file);
    try {
      const img=new Image(); img.src=url; await img.decode();
      if (!img.naturalWidth || !img.naturalHeight) throw Error('图片没有可用的尺寸');
      const scale=Math.min(1,2400/Math.max(img.naturalWidth,img.naturalHeight));
      const canvas=document.createElement('canvas'); canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));
      canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
      canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
      return canvas.toDataURL('image/webp',0.9);
    } finally { URL.revokeObjectURL(url); }
  }
  function destination(field,start=field.selectionStart,end=field.selectionEnd) {
    const context=captureLiteratureNoteContext(), value=field.value, editor=literatureNoteEditors.get(field), bookmark=editor?.bookmark?.();
    const rich = editor?.rich;
    const valid=()=>field.isConnected && !field.disabled && !field.readOnly && editor?.rich===rich &&
      field.value===value && isCurrentLiteratureNoteContext(context);
    return { context, valid, insert(text) {
      if (!valid()) throw Error('字段或论文已变化，请重新插入');
      if (!(editor?.rich ? editor.insert(text,bookmark,{replaceAll:start===0&&end===value.length&&text===''}) : literatureNoteSourceEditors.get(field)?.replaceRange(text,start,end))) throw Error('请将光标放在完整引用标记之外，并检查字段长度');
      if (editor) editor.focus(); else field.focus({preventScroll:true});
    }};
  }
  function mark(alt,id) { return '![' + String(alt || '图片').replace(/[\n\r\[\]\\]/g,' ').slice(0,240) + '](brevess-image:' + id + ')'; }
  function sources() {
    const entries = new Map(), snapshot=currentWorkspaceSnapshot;
    function add(id,text,section) {
      if (/^(p-|pdf-paragraph:)[a-f0-9]{16}$/.test(id) && text && !entries.has(id))
        entries.set(id,{id,text:String(text),section:String(section || '正文')});
    }
    for (const p of [...(snapshot?.paragraphs||[]),...(snapshot?.literatureNoteCaptionSources||[])]) {
      if (p.sourceKey) add(p.paragraphId,p.text,p.sectionTitle);
    }
    const pdf = currentPdfSemanticNavigation;
    if (pdf && pdf.documentId===snapshot?.documentId && pdf.documentHash===snapshot?.documentHash) {
      const visit=sections=>{ for (const section of sections||[]) {
        for (const t of section.paragraphTargets||[]) if(isTrustedPopupPdfParagraphTarget(t,pdf))
          add(t.paragraphId,t.expectedNormalizedQuote,section.title);
        visit(section.children);
      }};
      visit(pdf.sections);
    }
    return [...entries.values()];
  }
  function node(tag, text) {
    const el=document.createElement(tag); if (text) el.textContent=text; return el;
  }
  function figureIdOf(item) {
    const id = String(item.figureId || '').toLowerCase();
    return /^figure-(?:s|ed)?[1-9]\d{0,2}$/.test(id) ? id : SciLLM.parseFigureLabel(item.name)?.figureId;
  }
  async function resolvePanelMention(job, valid) {
    const scope = job.context.panel;
    const items = await BrevessNotePanels.list(scope);
    if (!valid()) return null;
    const matching = prefix => items.filter(item => figureIdOf(item) === 'figure-' + prefix + job.number);
    let candidates = matching(job.series);
    // The quick navigator labels Extended Data as FS as well. An actual S
    // figure takes precedence, and FED remains an explicit Extended Data target.
    if (!candidates.length && job.series === 's') candidates = matching('ed');
    if (!candidates.length) throw Error('当前论文未找到对应图号');
    const direct = candidates.filter(item => item.direct?.toUpperCase() === job.label);
    let matches = direct;
    if (!direct.length) {
      matches = [];
      for (const item of candidates.filter(item => !item.direct)) {
        const labels = await BrevessNotePanels.labels(scope, item);
        if (!valid()) return null;
        if (labels.some(label => String(label).toUpperCase() === job.label)) matches.push(item);
      }
    }
    if (!matches.length) throw Error('未找到对应裁片，可在图解中核对 Panel');
    if (matches.length !== 1) throw Error('多张原图含有相同 Panel 编号，请核对图解');
    const item = matches[0];
    const crop = await BrevessNotePanels.crop(scope, item, job.label);
    if (!valid()) return null;
    const id = await storeImage(job.context.note, crop.dataUrl);
    const alt = (crop.name || item.name) + ' · Panel ' + job.label;
    return {id, alt, markdown:mark(alt, id)};
  }
  function action(field,kind) {
    try {
      if(kind==='citation') void selectCitation(field);
      if(kind==='image') { const input=node('input');input.type='file';input.accept='image/*';input.multiple=true;const dest=destination(field);input.onchange=()=>void insertFiles([...input.files],dest);input.click(); }
      if(kind==='table') destination(field).insert('\n\n| 项目 | 结果 |\n| --- | --- |\n|  |  |\n\n');
      if(kind==='clear') destination(field,0,field.value.length).insert('');
    } catch(e){showStatus(e.message,'error');}
  }
  async function insertFiles(files,dest) {
    try {
      const inserts=[];
      for(const file of files){if(!dest.valid())throw Error('字段或论文已变化，请重新插入');inserts.push(mark(file.name,await storeImage(dest.context,await rasterize(file))));}
      if(inserts.length)dest.insert(inserts.join('\n'));
    }catch(e){showStatus(e.message,'error');}
  }
  let pendingCitation;
  async function selectCitation(field) {
    pendingCitation?.cancel();
    const dest=destination(field),scope=capturePanelContext();
    const bar=node('div');bar.className='note-citation-prompt';bar.setAttribute('role','status');
    bar.append(node('span','请在当前论文原文划选句子，松开即插入引文。'));
    const stop=node('button','取消（Esc）');stop.type='button';bar.append(stop);field.closest('.literature-note-field').prepend(bar);
    const port=chrome.tabs.connect(scope.tabId,{name:'brevess-note-citation'});
    let done=false;
    const cancel=()=>{if(done)return;done=true;clearInterval(timer);port.disconnect();bar.remove();document.removeEventListener('keydown',escape,true);if(pendingCitation?.cancel===cancel)pendingCitation=null;};
    const escape=e=>{if(e.key==='Escape'){e.preventDefault();cancel();}};
    const timer=setInterval(()=>{if(!dest.valid()||!isCurrentPanelContext(scope))cancel();},200);
    pendingCitation={cancel};stop.onclick=cancel;document.addEventListener('keydown',escape,true);
    port.onDisconnect.addListener(()=>{void chrome.runtime.lastError;if(!done){cancel();showStatus('引文选择已结束；可重新点击插入引文。','info');}});
    port.onMessage.addListener(m=>{
      if(m.cancelled){cancel();return;}
      if(m.error){bar.firstChild.textContent=m.error;return;}
      if(!dest.valid()||!isCurrentPanelContext(scope)){cancel();return;}
      if(!Array.isArray(m.ids)||!m.ids.length||m.ids.some(id=>!sources().some(p=>p.id===id))){bar.firstChild.textContent='原文位置尚未就绪，请稍候重新划选。';return;}
      try{dest.insert(m.ids.map(id=>'('+id+')').join(''));cancel();showStatus('已插入原文引文。','success');}catch(e){cancel();showStatus(e.message,'error');}
    });
  }
  function bind(field) {
    const editor = literatureNoteEditors.get(field);
    const rich = editor?.surface;
    if (rich) {
      SciLLM.attachLiteratureNotePanelMentions({
        field, editor, sourceEditor:literatureNoteSourceEditors.get(field), resolve:resolvePanelMention,
        context:() => ({note:captureLiteratureNoteContext(), panel:capturePanelContext()}),
        isCurrent:context => isCurrentLiteratureNoteContext(context.note) && isCurrentPanelContext(context.panel)
      });
      rich.addEventListener('paste', event => {
        const files = [...(event.clipboardData?.items || [])]
          .filter(item => item.kind === 'file' && item.type.startsWith('image/'))
          .map(item => item.getAsFile()).filter(Boolean);
        if (files.length) {
          event.preventDefault();
          void insertFiles(files, destination(field));
        }
      });
    }
    field.addEventListener('paste',async e=>{
      const files=[...(e.clipboardData?.items||[])].filter(i=>i.kind==='file' && i.type.startsWith('image/')).map(i=>i.getAsFile()).filter(Boolean);
      if(!files.length)return;
      e.preventDefault(); const dest=destination(field);
      try{
        const inserts=[];
        for(const file of files){
          if(!dest.valid())throw Error('字段或论文已变化，请重新粘贴');
          inserts.push(mark(file.name,await storeImage(dest.context,await rasterize(file))));
        }
        dest.insert(inserts.join('\n'));
      }catch(error){showStatus(error.message || '粘贴图片失败','error');}
    });
    const media=node('div');media.className='literature-note-media';
    field.after(media);
    const refresh=()=>{
      const matches=[...field.value.matchAll(imageRef)];
      media.hidden=field.hidden||!matches.length;
      if(media.hidden)return;
      if(media.dataset.refs!==JSON.stringify(matches.map(m=>[m[1],m[2]]))){
        media.replaceChildren(); for(const [,alt,id] of matches){const img=node('img');img.alt=alt;img.dataset.noteImage=id;media.append(img);}
        media.dataset.refs=JSON.stringify(matches.map(m=>[m[1],m[2]]));
      }
      void hydrate(media);
    };
    new MutationObserver(refresh).observe(field,{attributes:true,attributeFilter:['hidden']});
    field.addEventListener('input',refresh);refresh();
  }
  globalThis.BrevessNoteInserts={bind,action,hydrate,portable};
})();
