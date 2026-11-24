(() => {
  'use strict';
  const $=id=>document.getElementById(id), {clamp,makeCanvas}=PanelEngine;
  const number=new Intl.NumberFormat('zh-CN');
  const nextFrame=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  let model=null, selected=-1, previewMode='clean', editMode='select';
  let busy=false, request=0, drag=null, history=[], geometry=null, figureName='',saveKind='zip',fallbackURL='';
  let mergeIds=new Set(),nextUid=0,blankMode=false,restoreIndex=0,diameter=32;
  const overview=panelViewport($('stage'),$('figureSurface'),$('overviewScale'));
  const panelView=panelViewport($('previewStage'),$('previewSurface'),$('panelScale'));
  const pixelView=panelViewport($('pixelScroll'),$('pixelSurface'),$('pixelScale'));
  const views=[overview,panelView,pixelView];
  const localTools=mode=>mode==='erase'||mode==='exclude';
  function status(message,tone='ok') {
    $('status').textContent=message; $('status').dataset.tone=tone;
  }
  function padding() {return clamp(Math.round(Number($('pad').value)||0),0,96);}
  function active() {return model?.items[selected];}
  function setPressed(el,on) {el.setAttribute('aria-pressed',String(on));}
  function controls() {
    const has=!!active(), any=!!model?.items.length;
    const pdfOpen=!$('pdfDesk').hidden;
    const empty=!model&&!pdfOpen;
    $('importStart').hidden=!empty;
    $('workIntro').hidden=empty;
    if(!pdfOpen)$('imageDesk').hidden=!model;
    for (const id of ['one','copy','rename','delete','fullPreview']) $(id).disabled=busy || !has;
    for (const id of ['all','pptBtn','jsonBtn','som','promptBtn','apply']) $(id).disabled=busy || !any;
    for (const id of ['pad','paper','outline','actual','fit']) $(id).disabled=busy || !model;
    for (const id of ['openBtn','openPdf','browseFile']) $(id).disabled=busy||PaperBatch.locked();
    $('blankSet').disabled=busy || !model;
    setPressed($('blankSet'),!!model&&!blankMode);
    $('ungroup').hidden=!active()?.sources;$('ungroup').disabled=busy||!active()?.sources;
    $('prev').disabled=busy || selected<=0; $('next').disabled=busy || !has || selected>=model.items.length-1;
    for(const b of document.querySelectorAll('[data-undo]'))b.disabled=busy||!history.length;
    for(const b of document.querySelectorAll('[data-zoom]'))b.disabled=busy||!has;
    for (const b of document.querySelectorAll('[data-edit]')) {
      b.disabled=busy || !model || (!has && !['new','lasso','select','pan'].includes(b.dataset.edit));
      if(b.dataset.edit==='merge')b.disabled=busy||!model||model.items.length<2;
      const tool=$('pixelDialog').contains(b)&&!localTools(editMode)?'pan':editMode;
      setPressed(b,b.dataset.edit===tool);
    }
    for (const b of $('tabs').querySelectorAll('button')) {
      b.disabled=busy || !has; setPressed(b,b.dataset.mode===previewMode);
    }
    for (const b of $('labels').querySelectorAll('button')) b.disabled=busy;
    updateZoomButtons();
  }
  function updateZoomButtons(){
    setPressed($('fit'),overview.mode==='fit');
    setPressed($('actual'),overview.mode==='actual');
  }

  function paths() {
    if (!model) return [];
    const sx=model.w/model.source.width,sy=model.h/model.source.height;
    return model.items.map((_,id)=>{
      const rect=PanelOutput.bounds(model,id,padding()),[x,y]=rect;
      const line=new Path2D(),fill=new Path2D();
      let last=[];
      const bands=PanelOutput.selection(model,id,rect).keep;
      for(const [t,b,runs] of [...bands,[rect[3]-y,rect[3]-y,[]]]) {
        const endpoints=[...last,...runs].sort((a,b)=>a-b);
        for(let i=0;i<endpoints.length;i+=2) {
          line.moveTo((x+endpoints[i])*sx,(y+t)*sy);line.lineTo((x+endpoints[i+1])*sx,(y+t)*sy);
        }
        for(let i=0;i<runs.length;i+=2) {
          const left=(x+runs[i])*sx,right=(x+runs[i+1])*sx;
          fill.rect(left,(y+t)*sy,right-left,(b-t)*sy);
          for(const edge of [left,right]) {line.moveTo(edge,(y+t)*sy);line.lineTo(edge,(y+b)*sy);}
        }
        last=runs;
      }
      return {line,fill};
    });
  }
  function overlay() {
    if (!model) return;
    const c=$('overlay'), ctx=c.getContext('2d'), {w,h}=model;
    ctx.clearRect(0,0,w,h);
    if ($('outline').checked) {
      geometry ||= paths();
      const stroke=Math.max(1,Math.min(w,h)/640);
      for (let id=0;id<model.items.length;id++) {
        if (id===selected) continue;
        ctx.strokeStyle='rgba(65,92,113,.72)';ctx.lineWidth=stroke;
        ctx.stroke(geometry[id].line);
      }
      if (active()) {
        ctx.fillStyle='rgba(32,98,175,.09)';ctx.fill(geometry[selected].fill);
        ctx.strokeStyle='#155bb0';ctx.lineWidth=stroke*2;ctx.stroke(geometry[selected].line);
        if (previewMode!=='clean') {
          const box=PanelOutput.bounds(model,selected,0,true);
          const [l,t,r,b]=box.map((v,i)=>v*(i%2?model.h/model.source.height:model.w/model.source.width));
          ctx.strokeStyle='#ba553f';ctx.lineWidth=stroke*1.7;ctx.setLineDash([6,4]);ctx.strokeRect(l,t,r-l,b-t);ctx.setLineDash([]);
        }
      }
    }
    if(editMode==='merge'&&mergeIds.size){
      geometry||=paths();ctx.fillStyle='rgba(16,103,174,.20)';ctx.strokeStyle='#174c85';ctx.lineWidth=Math.max(2,w/440);
      for(const id of mergeIds){ctx.fill(geometry[id].fill);ctx.stroke(geometry[id].line);}
    }
    const guideView=drag&&drag.mode!=='pan'&&drag.mode!=='erase'?drag.view:null;
    if(guideView)guideView.drawGuide(ctx=>drawDraft(ctx,guideView));
    if(drag && drag.mode!=='pan' && guideView!==overview){
      ctx.save();ctx.scale(w/model.source.width,h/model.source.height);drawDraft(ctx,overview);ctx.restore();
    }
    for(const v of [panelView,pixelView]){
      if(v.surface.hidden || (v===pixelView&&!$('pixelDialog').open))continue;
      const canvas=v.surface.querySelector('.draft'),cx=canvas.getContext('2d');
      cx.clearRect(0,0,canvas.width,canvas.height);
      if(!drag||guideView===v||!localTools(drag.mode)||previewMode!=='clean')continue;
      const [l,t,r,b]=v.box;cx.save();cx.scale(canvas.width/(r-l),canvas.height/(b-t));cx.translate(-l,-t);
      drawDraft(cx,v);cx.restore();
    }
  }
  function drawDraft(ctx,view){
    if(drag.mode==='erase'){
      if(view!==overview){
        geometry||=paths();const sx=model.source.width/model.w,sy=model.source.height/model.h;
        ctx.scale(sx,sy);ctx.clip(geometry[selected].fill);ctx.scale(1/sx,1/sy);
      }
      ctx.lineCap=ctx.lineJoin='round';
      ctx.strokeStyle=ctx.fillStyle=view===overview?'rgba(208,48,68,.55)':'#ffffff';
      for(const segment of drag.segments){
        const p=segment.points;ctx.lineWidth=segment.size;ctx.beginPath();
        if(p.length===1){ctx.arc(...p[0],segment.size/2,0,2*Math.PI);ctx.fill();}
        else {ctx.moveTo(...p[0]);for(let i=1;i<p.length;i++)ctx.lineTo(...p[i]);ctx.stroke();}
      }
      return;
    }
    ctx.beginPath();
    if(drag.points){drag.points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();}
    else {const [l,t,r,b]=dragBox(drag.from,drag.to);ctx.rect(l,t,r-l,b-t);}
    ctx.fillStyle=drag.mode==='exclude'?'rgba(210,55,76,.2)':'rgba(11,103,84,.15)';
    ctx.strokeStyle=drag.mode==='exclude'?'#bc2644':'#07765d';ctx.lineWidth=1.5/view.scale;
    ctx.setLineDash([5/view.scale,3/view.scale]);ctx.fill('evenodd');ctx.stroke();
  }
  let drawFrame=0;
  function scheduleOverlay(){if(!drawFrame)drawFrame=requestAnimationFrame(()=>{drawFrame=0;overlay();});}

  function refreshList() {
    const group=$('labels');group.replaceChildren();
    for (const [id,item] of (model?.items||[]).entries()) {
      const b=document.createElement('button');b.type='button';b.textContent=item.label;
      b.setAttribute('aria-label','Panel '+item.label);setPressed(b,id===selected);
      b.onclick=()=>select(id);group.append(b);
    }
    $('panelCount').textContent=(model?.items.length||0)+' 个';
  }
  function setupDraft(v,box,preset){
    v.layout(box,preset);
    const c=v.surface.querySelector('.draft'),w=box[2]-box[0],h=box[3]-box[1];
    const k=Math.min(1,1600/Math.max(w,h)),cw=Math.max(1,Math.round(w*k)),ch=Math.max(1,Math.round(h*k));
    if(c.width!==cw||c.height!==ch){c.width=cw;c.height=ch;}
  }
  function syncPixel(preset=null){
    if(!$('pixelDialog').open||!active())return;
    const original=$('preview'),copy=$('pixelCanvas');
    if(copy.width!==original.width||copy.height!==original.height){copy.width=original.width;copy.height=original.height;}
    const ctx=copy.getContext('2d');ctx.clearRect(0,0,copy.width,copy.height);ctx.drawImage(original,0,0);
    $('pixelTitle').textContent=original.getAttribute('aria-label');$('pixelMeta').textContent=copy.width+' × '+copy.height+' px';
    setupDraft(pixelView,panelView.box,preset);
  }
  function preview(reset=false) {
    const item=active(), old=$('preview');
    $('panelEvidence').hidden=!model?.evidence||!item;
    if(model?.evidence&&item){
      const text=PaperCaption.forItem(model.evidence,item);
      $('panelAuthorCaption').textContent=text.targetText||'未匹配到此 Panel 的独立图注，请核对完整作者图注。';
      $('panelSharedCaption').textContent=text.sharedLegend;
      $('panelSharedCaption').parentElement.hidden=!text.sharedLegend;
      $('panelEvidenceStatus').textContent=text.recovered.length?'图像字母已回查并补齐图注':'作者 Panel 图注';
    }
    panelView.surface.hidden=!item;$('noPreview').hidden=!!item;
    if (!item) {
      if($('pixelDialog').open)$('pixelDialog').close();for(const v of views)v.cursor(null);
      $('panelTitle').textContent='Panel 预览';$('panelMeta').textContent='—';
      $('previewCaption').textContent='点击「矩形选取」或「套索圈选」，在原图上绘制。';return;
    }
    const crop=PanelOutput.paint(model,selected,previewMode,padding(),$('paper').value);
    crop.id='preview';crop.setAttribute('aria-label','Panel '+item.label+' '+{clean:'清理后',raw:'矩形初裁',removed:'剔除位置'}[previewMode]);
    old.replaceWith(crop);
    old.width=old.height=1;
    setupDraft(panelView,PanelOutput.bounds(model,selected,padding(),previewMode!=='clean'),reset?'fit':null);
    syncPixel();
    const count=item.edited?0:(item.foreign??=PanelOutput.removedCount(model,selected));
    const unit=(model.w===model.source.width && model.h===model.source.height)?'像素':'分析像素';
    let note=previewMode==='clean'?'已从初裁中剔除 '+number.format(count)+' 个外来前景'+unit+'。':
      previewMode==='raw'?'初裁保留了边缘余量，包含 '+number.format(count)+' 个外来前景'+unit+'。':
      '红色标出初裁中归属邻区或手动剔除的前景。';
    if(item.edited) note=(item.shape?.type==='lasso'?'套索选区':item.shape?.type==='rect'?'矩形选区':'已校正选区')+(item.brush?.length?' · 已应用手动遮罩':'')+((item.cuts?.length||0)?' · 白色剪除 '+item.cuts.length+' 处':'')+'。';
    if(item.members)note='已合并 '+item.members.join('、')+'。'+(item.edited&&(item.brush?.length||item.cuts?.length)?'已应用手动遮罩。':'');
    if(item.whole&&!item.edited)note='按整幅 Figure 保留。可在原图上手动选取。';
    if (item.review) note+=' 边界需复核。';
    if (item.description) note+=' '+item.description;
    $('panelTitle').textContent='Panel '+item.label;
    $('panelMeta').textContent=crop.width+' × '+crop.height+' px'+(item.edited?'  ·  手动校正':'');
    $('previewCaption').textContent=note;
    PanelIcons.set($('fullPreview'),'maximize-2',previewMode==='clean'?'放大编辑':'放大查看');
  }
  function select(id) {
    if (!model || busy) return;
    if(drag)return;selected=id;for(const v of views)v.cursor(null);refreshList();preview(true);overlay();controls();
  }
  function cancelDrag(){
    const prev=drag;drag=null;
    if(!prev)return;
    prev.view.drawGuide(null);
    prev.view.stage.classList.remove('is-panning');
    if(prev.view.stage.hasPointerCapture(prev.pointer))prev.view.stage.releasePointerCapture(prev.pointer);
  }
  function setEdit(mode) {
    cancelDrag();editMode=mode;
    if(localTools(mode)&&previewMode!=='clean'){previewMode='clean';preview();}
    for(const v of views){
      v.cursor(null);
      v.stage.dataset.tool=mode==='pan'?'pan':localTools(mode)?(mode==='erase'?'erase':'draw'):v!==overview?'pan':mode==='select'?'select':'draw';
    }
    $('mergeTools').hidden=mode!=='merge';mergeIds=new Set();
    $('stageHint').textContent={select:'点击选择 Panel，滚轮缩放整图',pan:'按住鼠标拖动以移动整图，滚轮围绕指针缩放',new:'拖出矩形新建 Panel，可从图外灰色区域起笔',lasso:'从图内或灰色区域沿轮廓拖动，松开闭合套索',include:'在整图或四周灰色区域起笔，拖出要补选的矩形',exclude:'在整图或清理后视图拖出矩形填白，可从图外起笔',erase:'拖动擦除当前 Panel，滚轮调整橡皮檫大小',replace:'拖出矩形重画当前 Panel，可从图外起笔',replaceLasso:'沿轮廓拖动以重画当前选区，可从图外起笔'}[mode];
    if(mode==='merge'){$('stageHint').textContent='在原图中点击或勾选两个以上的 Panel，然后确认合并';mergeOptions();}
    controls();overlay();
  }
  function mount(data,state={}){
    cancelDrag();model=data;history=state.history||[];geometry=null;figureName=state.figureName||'';
    model.automaticItems??=structuredClone(model.items);
    blankMode=state.blankMode??false;restoreIndex=state.restoreIndex??0;
    selected=model.items.length?clamp(state.selected??0,0,model.items.length-1):-1;
    previewMode='clean';editMode='select';
    $('pad').value=state.pad??0;$('paper').value=state.paper||'paper';
    const source=model.source;source.id='sourceView';source.setAttribute('aria-label','原始整图');
    if($('sourceView')!==source)$('sourceView').replaceWith(source);
    $('overlay').width=model.w;$('overlay').height=model.h;$('figureSurface').hidden=false;
    $('review').value='';$('fileMeta').textContent=model.name+'  ·  '+source.width+' × '+source.height+' px';
    overview.layout([0,0,source.width,source.height],'fit');refreshList();preview(true);setEdit(blankMode&&selected<0?'new':'select');
  }
  function snapshot(){return {model,selected,history,figureName,blankMode,restoreIndex,pad:padding(),paper:$('paper').value};}
  function clear() {
    cancelDrag();
    model=null;selected=-1;history=[];geometry=null;figureName='';blankMode=false;restoreIndex=0;previewMode='clean';
    const emptySource=makeCanvas(1,1);
    emptySource.id='sourceView';emptySource.setAttribute('aria-label','原始整图');
    $('sourceView').replaceWith(emptySource);$('figureSurface').hidden=true;
    $('preview').width=$('preview').height=1;
    $('overlay').width=$('overlay').height=1;
    $('review').value='';$('fileMeta').textContent='—';
    refreshList();preview();setEdit('select');
  }
  async function loadImage(file) {
    const token=++request;
    const url=URL.createObjectURL(file);
    if ($('pixelDialog').open) $('pixelDialog').close();
    busy=true;cancelDrag();controls();status('正在读取图片并计算 Panel 边界…','busy');
    try {
      const img=new Image();img.src=url;await img.decode();
      if (!img.naturalWidth || !img.naturalHeight) throw Error('空图片');
      const source=makeCanvas(img.naturalWidth,img.naturalHeight);
      source.getContext('2d',{willReadFrequently:true}).drawImage(img,0,0);
      await nextFrame();if (token!==request) return;
      const data=PanelEngine.analyze(source);
      data.items.forEach((p,i)=>p.autoId=i);
      PaperBatch.leave(false);
      mount({...data,source,name:file.name||'粘贴的图片'});
      if (model.items.length) {
        const flagged=model.items.filter(p=>p.review).length;
        status('已自动提取 '+model.items.length+' 个 Panel'+(flagged?'，其中 '+flagged+' 个边界建议复核。':'。'),flagged?'warn':'ok');
      } else {
        status('没有找到可靠的连续字母标签。可用矩形或套索手动选取。','warn');
      }
    } catch (err) {
      if (token===request) status('读取失败。'+(err.message||'请使用可解码的图片。'),'warn');
    } finally {
      URL.revokeObjectURL(url);
      if (token===request) {busy=false;controls();}
    }
  }
  const isPdf=file=>file.type.toLowerCase()==='application/pdf'||/\.pdf$/i.test(file.name);
  const isImage=file=>file.type.startsWith('image/')||/\.(?:png|jpe?g|webp|gif|avif|bmp|svg|ico)$/i.test(file.name);
  function importLocked(){return busy||PaperBatch.locked()||!!document.querySelector('dialog[open]');}
  async function fromFile(file) {
    if (window.parent !== window) return;
    if (!file||importLocked()) return;
    let pdf=isPdf(file);
    const generic=!file.type||file.type==='application/octet-stream';
    if(!pdf&&generic&&!isImage(file)){
      // Some clipboard providers expose a PDF as an unnamed binary file.
      busy=true;controls();
      try{pdf=(await file.slice(0,1024).text()).includes('%PDF-');}
      catch{status('无法读取文件，请重新选择或拖入。','warn');return;}
      finally{busy=false;controls();}
    }
    if(pdf)return PaperBatch.load(file);
    if(isImage(file)||generic)return loadImage(file);
    status('请选择图片或 PDF 文件。','warn');
  }
  function transferredFile(data) {
    if(!data)return null;
    const files=Array.from(data.files||[]);
    if(!files.length)for(const item of data.items||[]){
      if(item.kind!=='file')continue;
      const file=item.getAsFile();if(file)files.push(file);
    }
    return files.find(isPdf)||files.find(isImage)||files[0];
  }
  $('browseFile').onclick=()=>$('importFile').click();
  $('openBtn').onclick=()=>$('file').click();
  $('openPdf').onclick=()=>$('pdfFile').click();
  for(const id of ['file','pdfFile','importFile'])$(id).onchange=e=>{
    const file=e.target.files[0];e.target.value='';fromFile(file);
  };
  if(/Mac|iPad|iPhone/i.test(navigator.platform))$('pasteModifier').textContent='⌘';
  document.addEventListener('paste',e=>{
    if(e.target.closest?.('input,textarea,[contenteditable="true"]')||importLocked())return;
    const file=transferredFile(e.clipboardData);
    if(file){e.preventDefault();fromFile(file);}
  });
  document.addEventListener('dragover',e=>{
    if (e.dataTransfer?.types.includes('Files')) {e.preventDefault();e.dataTransfer.dropEffect=importLocked()?'none':'copy';document.body.classList.toggle('dragfile',!importLocked());}
  });
  document.addEventListener('dragleave',e=>{if (!e.relatedTarget) document.body.classList.remove('dragfile');});
  document.addEventListener('drop',e=>{
    document.body.classList.remove('dragfile');
    const file=transferredFile(e.dataTransfer);if(!file)return;
    e.preventDefault();fromFile(file);
  });
  $('outline').onchange=overlay;
  $('fit').onclick=()=>{overview.zoom('fit');updateZoomButtons();};
  $('actual').onclick=()=>{overview.zoom('actual');updateZoomButtons();};
  $('prev').onclick=()=>select(Math.max(0,selected-1));
  $('next').onclick=()=>select(Math.min(model.items.length-1,selected+1));
  $('tabs').onclick=e=>{
    const mode=e.target.closest('button')?.dataset.mode;
    if (!mode || busy) return;
    if(mode!=='clean'&&localTools(editMode))setEdit('select');
    previewMode=mode;preview();overlay();controls();
  };
  $('pad').oninput=()=>{geometry=null;preview();overlay();PaperBatch.changed();};
  $('pad').onchange=()=>{$('pad').value=padding();};
  $('paper').onchange=()=>{preview();PaperBatch.changed();};
  $('fullPreview').onclick=()=>{
    if (!active()) return;
    $('pixelDialog').showModal();syncPixel('fit');
    if(pixelView.scale<1)pixelView.zoom('actual');
    controls();overlay();
  };
  $('pixelDialog').addEventListener('cancel',e=>{if(drag){e.preventDefault();cancelDrag();overlay();}});
  $('pixelDialog').addEventListener('close',()=>{
    if(drag?.view===pixelView){cancelDrag();overlay();}
    pixelView.cursor(null);const c=$('pixelCanvas'),d=pixelView.surface.querySelector('.draft');
    c.width=c.height=d.width=d.height=1;
  });
  document.addEventListener('click',e=>{
    const b=e.target.closest('button');if(!b||b.disabled)return;
    if(b.dataset.edit){setEdit(b.dataset.edit);return;}
    if(b.dataset.zoom){
      const v=b.dataset.zoom==='panel'?panelView:pixelView,k=b.dataset.step;
      v.zoom(k==='fit'||k==='actual'?k:k==='1'?1.3:1/1.3);v.cursor(null);
    }
    if(b.matches('[data-undo]'))undo();
  });
  document.addEventListener('keydown',e=>{
    const target=e.target instanceof Element?e.target:document.body;
    if(e.defaultPrevented||e.isComposing||busy||target.isContentEditable||
      target.closest('textarea,select,input:not([type=checkbox]):not([type=button])'))return;
    const modal=document.querySelector('dialog[open]');
    if(/^Arrow(Left|Right|Up|Down)$/.test(e.key)&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&!e.shiftKey){
      if(drag||$('pageDialog').open)return;
      const horizontal=e.key==='ArrowLeft'||e.key==='ArrowRight',step=e.key==='ArrowLeft'||e.key==='ArrowUp'?-1:1;
      if(($('batchDialog').open||$('pngDialog').open)&&PaperBatch.navigatePreview(horizontal,step,target)){e.preventDefault();return;}
      const largeImage=$('pngDialog').open;
      if(modal&&modal!==$('pixelDialog')&&!largeImage)return;
      if(!horizontal){if(PaperBatch.stepFigure(step))e.preventDefault();return;}
      if(!$('imageDesk').hidden&&model?.items.length){
        e.preventDefault();if(PaperBatch.locked())return;
        const next=clamp(selected+step,0,model.items.length-1);
        if(next!==selected){select(next);if(largeImage)showSelectedImage();}
      }
      return;
    }
    if(!model||PaperBatch.locked()||(modal&&modal!==$('pixelDialog')))return;
    if((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase()==='c' && active() && !drag && getSelection()?.isCollapsed) {
      e.preventDefault();if(!e.repeat) copySelected();return;
    }
    if((e.ctrlKey || e.metaKey) && e.key.toLowerCase()==='z' && (history.length||drag)) {
      e.preventDefault();if(drag){cancelDrag();overlay();}else undo();return;
    }
    if(modal)return;
    if (e.key==='Escape') setEdit('select');
  });
  async function showSelectedImage(){
    const original=model,id=selected,c=clean(id);
    try{
      const blob=await PanelOutput.png(c);
      if(model===original&&id===selected&&$('pngDialog').open)
        await PaperBatch.showImage(blob,'Panel '+model.items[id].label,c.width+' × '+c.height+' px');
    }finally{c.width=c.height=1;}
  }
  function dragBox(a,b) {return [Math.floor(Math.min(a[0],b[0])),Math.floor(Math.min(a[1],b[1])),Math.ceil(Math.max(a[0],b[0])),Math.ceil(Math.max(a[1],b[1]))];}
  function remember() {
    history.push({items:structuredClone(model.items),selected,blankMode,restoreIndex});
    if (history.length>35) history.shift();
  }
  function memberLabels(item){return item.members||[item.label];}
  function mergeInfo(){
    const ids=[...mergeIds].sort((a,b)=>a-b),members=ids.flatMap(i=>memberLabels(model.items[i]));
    const labels=members.map(v=>/^[a-z]$/i.test(v)?v.toUpperCase():v);
    if(labels.every(v=>/^[A-Z]$/.test(v)))labels.sort();
    const ranges=[];
    for(let i=0;i<labels.length;i++){
      const start=labels[i];
      while(i+1<labels.length&&/^[A-Z]$/.test(labels[i])&&/^[A-Z]$/.test(labels[i+1])&&labels[i+1].charCodeAt(0)===labels[i].charCodeAt(0)+1)i++;
      ranges.push(start===labels[i]?start:start+'-'+labels[i]);
    }
    return {ids,members,label:ranges.join('+')};
  }
  function mergeOptions(){
    const g=$('mergeLabels');g.replaceChildren();
    for(const [i,item] of model.items.entries()){
      const label=document.createElement('label'),cb=document.createElement('input');cb.type='checkbox';cb.value=i;cb.checked=mergeIds.has(i);
      cb.onchange=()=>{if(cb.checked)mergeIds.add(i);else mergeIds.delete(i);mergeState();overlay();};
      label.append(cb,document.createTextNode(item.label));g.append(label);
    }
    mergeState();
  }
  function mergeState(){
    const {ids,label}=mergeInfo(),dup=model.items.some((v,i)=>!mergeIds.has(i)&&v.label.toUpperCase()===label.toUpperCase());
    $('doMerge').disabled=$('previewMerge').disabled=ids.length<2||dup;
    $('mergeName').textContent=dup?'合并名称与现有 Panel 重复':ids.length<2?'勾选至少两个 Panel':'合并为 '+label;
  }
  function mergedItem(){
    const {ids,members,label}=mergeInfo();
    return {label,members,shape:PanelOutput.unionShape(model,ids),description:'',anchor:null,review:ids.some(i=>model.items[i].review),edited:true,pack:true};
  }
  $('previewMerge').onclick=()=>task(async()=>{
    const merged=mergedItem(),c=PanelOutput.paint({...model,items:[merged]},0,'clean',padding(),$('paper').value);
    try{await PaperBatch.showImage(await PanelOutput.png(c),'Panel '+merged.label,c.width+' × '+c.height+' px · 合并预览');}finally{c.width=c.height=1;}
  });
  $('doMerge').onclick=()=>{
    if($('doMerge').disabled)return;
    const {ids}=mergeInfo(),merged=mergedItem();remember();
    for(const p of model.items)p.uid??='panel-'+(++nextUid);
    merged.sources=ids.map(i=>({item:model.items[i],next:model.items.find((_,j)=>j>i&&!mergeIds.has(j))?.uid||null}));
    const first=ids[0];
    model.items=model.items.filter((_,i)=>!mergeIds.has(i));model.items.splice(first,0,merged);selected=first;
    edited('已合并为 Panel '+merged.label+'，将导出为一张 PNG。');
  };
  $('ungroup').onclick=()=>{
    const group=active();if(!group?.sources)return;remember();
    model.items.splice(selected,1);let first=model.items.length;
    for(const {item,next} of group.sources){
      const found=model.items.findIndex(q=>next&&q.uid===next),at=found>=0?found:model.items.length;
      model.items.splice(at,0,item);first=Math.min(first,at);
    }
    selected=first;edited('已恢复合并时的各成员。');
  };
  function edited(message,mode='select',resetView=false) {
    for (const p of model.items) delete p.foreign;
    geometry=null;setEdit(mode);refreshList();preview(resetView);overlay();controls();status(message);PaperBatch.changed();
  }
  function chooseLabel(initial,except=-1) {
    const answer=prompt('Panel 标签',initial);
    if (answer===null) return null;
    const name=answer.trim();
    if (!/^[\p{L}\p{N}][\p{L}\p{N}_-]{0,23}$/u.test(name) ||
        model.items.some((p,i)=>i!==except && [p.label,...memberLabels(p)].some(l=>l.toLowerCase()===name.toLowerCase()))) {
      status('标签须唯一，可使用 1–24 个字母、数字、下划线或短横线。','warn');return null;
    }
    return name;
  }
  function newLabel() {
    for (const s of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') if (!model.items.some(p=>memberLabels(p).some(v=>v.toUpperCase()===s)||p.label.toUpperCase()===s)) return s;
    let n=model.items.length+1;
    while (model.items.some(p=>p.label==='P'+n)) n++;
    return 'P'+n;
  }
  function addPoint(points,p) {
    const last=points.at(-1);
    if(!last || Math.hypot(p[0]-last[0],p[1]-last[1])>=.5) points.push(p);
  }
  function panelAt(pos){
    for(let i=model.items.length-1;i>=0;i--)if(PanelOutput.contains(model,i,...pos))return i;
    return -1;
  }
  function moveDrag(v,e){
    if(drag.mode==='pan'){
      v.pan(e.clientX-drag.clientX,e.clientY-drag.clientY);drag.clientX=e.clientX;drag.clientY=e.clientY;updateZoomButtons();return;
    }
    const points=drag.mode==='erase'?drag.segments.at(-1).points:drag.points;
    if(points){for(const sample of e.getCoalescedEvents?.()||[])addPoint(points,v.point(sample));}
    drag.to=v.point(e);if(points)addPoint(points,drag.to);scheduleOverlay();
  }
  function finishErase(current){
    const ops=current.segments.map(s=>PanelBrush.erase(model,selected,s,padding())).filter(Boolean);
    if(!ops.length){overlay();return;}
    remember();const item=active();(item.brush??=[]).push(...ops);item.edited=true;
    edited('已擦除 Panel '+item.label+' 的选中像素。','erase');
  }
  function bindView(v){
    const stage=v.stage,ready=()=>model&&!busy&&(v===overview||active());
    const owns=e=>drag?.view===v&&drag.pointer===e.pointerId;
    stage.addEventListener('wheel',e=>{
      if(!ready()||!e.deltaY)return;
      e.preventDefault();
      if(drag&&(drag.view!==v||drag.mode!=='erase'))return;
      const delta=clamp(e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?stage.clientHeight:1),-240,240);
      if(editMode==='erase'&&!e.ctrlKey&&!e.metaKey){
        const next=clamp(diameter-Math.sign(delta)*Math.max(1,Math.round(diameter*Math.abs(delta)*.0016)),1,512);
        if(next!==diameter&&drag){
          const pt=v.point(e);addPoint(drag.segments.at(-1).points,pt);
          drag.segments.push({size:next,points:[pt]});scheduleOverlay();
        }
        diameter=next;v.cursor(e,diameter);
      }else if(!drag){
        v.zoom(Math.exp(-delta*.0023),e);updateZoomButtons();
        if(editMode==='erase')v.cursor(e,diameter);
      }
    },{passive:false});
    stage.addEventListener('pointerdown',e=>{
      if(!ready()||drag||(e.button!==0&&e.button!==1))return;
      const pan=e.button===1||editMode==='pan'||(v!==overview&&!localTools(editMode));
      const mode=pan?'pan':editMode;
      if((mode==='select'||mode==='merge')&&!v.hit(e))return;
      e.preventDefault();if(document.activeElement instanceof HTMLElement)document.activeElement.blur();
      getSelection()?.removeAllRanges();
      const pos=v.point(e);
      if(mode==='select'||mode==='merge'){
        const id=panelAt(pos);if(id<0)return;
        if(mode==='select')select(id);
        else{if(mergeIds.has(id))mergeIds.delete(id);else mergeIds.add(id);mergeOptions();overlay();}
        return;
      }
      drag={mode,view:v,pointer:e.pointerId,from:pos,to:pos};
      if(pan){drag.clientX=e.clientX;drag.clientY=e.clientY;stage.classList.add('is-panning');v.cursor(null);}
      else if(mode==='erase'){drag.segments=[{size:diameter,points:[pos]}];v.cursor(e,diameter);}
      else if(mode==='lasso'||mode==='replaceLasso')drag.points=[pos];
      stage.setPointerCapture(e.pointerId);scheduleOverlay();
    });
    stage.addEventListener('pointermove',e=>{
      if(!ready())return;
      if(editMode==='erase'&&(!drag||drag.mode==='erase')&&e.pointerType!=='touch')v.cursor(e,diameter);
      if(owns(e))moveDrag(v,e);
    });
    stage.addEventListener('pointerleave',()=>v.cursor(null));
    stage.addEventListener('pointercancel',e=>{if(owns(e)){cancelDrag();v.cursor(null);overlay();}});
    stage.addEventListener('lostpointercapture',e=>{if(owns(e)&&!stage.hasPointerCapture(e.pointerId)){cancelDrag();v.cursor(null);overlay();}});
    stage.addEventListener('pointerup',e=>{
      if(!owns(e))return;
      const current=drag;
      if(!ready()){cancelDrag();overlay();return;}
      moveDrag(v,e);cancelDrag();
      if(current.mode==='pan')return;
      if(current.mode==='erase'){finishErase(current);v.cursor(e.pointerType==='touch'?null:e,diameter);return;}
      finishShape(current);
    });
  }
  views.forEach(bindView);
  // Intersect the closed lasso with each image edge. Projecting individual
  // vertices onto the edge would change diagonal strokes and cut corners off.
  function clipLasso(points,[left,top,right,bottom]){
    for(const [axis,edge,direction] of [[0,left,1],[0,right,-1],[1,top,1],[1,bottom,-1]]){
      const inside=p=>(p[axis]-edge)*direction>=0;
      if(!points.length||points.every(inside))continue;
      const clipped=[];
      let previous=points.at(-1),wasInside=inside(previous);
      for(const point of points){
        const isInside=inside(point);
        if(isInside!==wasInside){
          const t=(edge-previous[axis])/(point[axis]-previous[axis]);
          const other=previous[1-axis]+t*(point[1-axis]-previous[1-axis]);
          clipped.push(axis===0?[edge,other]:[other,edge]);
        }
        if(isInside)clipped.push(point);
        previous=point;wasInside=isInside;
      }
      points=clipped;
    }
    return points;
  }
  function finishShape(current){
    const end=current.to,frame=current.view.box;
    let points=current.points;
    let box=dragBox(current.from,end);
    if(points) {
      addPoint(points,end);points=clipLasso(points,frame);
      if(points.length<3) {overlay();return;}
      let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
      for(const [x,y] of points){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
      box=dragBox([left,top],[right,bottom]);
    }
    box=[Math.max(box[0],frame[0]),Math.max(box[1],frame[1]),Math.min(box[2],frame[2]),Math.min(box[3],frame[3])];
    const min=editMode==='exclude'?1:2;
    if(box[2]-box[0]<min||box[3]-box[1]<min||(end[0]===current.from[0]&&end[1]===current.from[1]&&!points)) {overlay();return;}
    if(editMode==='exclude') {
      const base=PanelOutput.bounds(model,selected,padding());
      box=[Math.max(box[0],base[0]),Math.max(box[1],base[1]),Math.min(box[2],base[2]),Math.min(box[3],base[3])];
      if(box[0]>=box[2] || box[1]>=box[3] || !PanelOutput.selection(model,selected,box).keep.some(row=>row[2].length)) {
        overlay();status('剪除矩形与当前选区没有交集。','warn');return;
      }
    }
    const shape=points?{type:'lasso',points,box}:{type:'rect',box};
    if(points && !PanelOutput.selection({ ...model,items:[{shape}] },0,box).keep.some(row=>row[2].length)) {
      overlay();status('套索没有围出有效面积。','warn');return;
    }
    remember();
    if(editMode==='new' || editMode==='lasso') {
      if(model.items.length===1&&model.items[0].whole)model.items=[];
      const label=newLabel();selected=model.items.length;
      model.items.push({label,shape,anchor:null,description:'',edited:true});
    } else if(editMode==='replace' || editMode==='replaceLasso') {
      Object.assign(active(),{shape,anchor:null,additions:[],cuts:[],brush:[],review:false,whole:false});
    } else if(active().brush?.length&&['include','exclude'].includes(editMode)){
      active().brush.push({kind:editMode==='include'?'add':'erase',box,bands:[[box[1],box[3],[box[0],box[2]]]]});
    } else if(editMode==='include') (active().additions??=[]).push(box);
    else if(editMode==='exclude') (active().cuts??=[]).push(box);
    active().edited=true;previewMode='clean';
    edited('已更新 Panel '+active().label+'。',['new','lasso','exclude'].includes(editMode)?editMode:'select',editMode!=='exclude');
  }
  $('blankSet').onclick=()=>{
    if(!model||busy)return;remember();
    if(blankMode){
      model.items=structuredClone(model.automaticItems);
      selected=model.items.length?clamp(restoreIndex,0,model.items.length-1):-1;
      blankMode=false;previewMode='clean';
      edited(model.items.length?'已恢复 '+model.items.length+' 个自动划分的 Panel。':'此图未识别到自动 Panel。',selected<0?'new':'select',true);
    }else{
      restoreIndex=active()?.autoId??0;blankMode=true;model.items=[];selected=-1;
      edited('已切到空白手动划分，可从 Panel A 开始绘制。','new',true);
    }
  };
  $('rename').onclick=()=>{
    const label=chooseLabel(active().label,selected);if (!label) return;
    remember();active().label=label;active().edited=true;edited('已更新 Panel 标签。');
  };
  $('delete').onclick=()=>{
    if (!active()) return;
    remember();const id=selected;
    model.items.splice(id,1);selected=Math.min(id,model.items.length-1);edited('已删除所选 Panel，可撤销。');
  };
  function undo(){
    const past=history.pop();if (!past) return;
    const same=selected===past.selected&&blankMode===!!past.blankMode;
    model.items=past.items;selected=past.selected;blankMode=!!past.blankMode;restoreIndex=past.restoreIndex??0;
    edited('已撤销上一步。',active()&&localTools(editMode)?editMode:blankMode&&selected<0?'new':'select',!same);
  }
  function manifest() {return PanelOutput.regions(model,padding(),$('paper').value);}
  function jsonBlob(data) {return new Blob([JSON.stringify(data,null,2)],{type:'application/json'});}
  async function task(job) {
    if (!model || busy) return;
    busy=true;controls();
    try {await job();} catch (err) {status('操作失败。'+err.message,'warn');}
    finally {busy=false;controls();}
  }
  function clean(id) {return PanelOutput.paint(model,id,'clean',padding(),$('paper').value);}
  const filename=PanelFiles.filename;
  function packIds(){return saveKind==='one'?[selected]:[...$('packLabels').querySelectorAll('input:checked')].map(b=>Number(b.value));}
  function savePreview() {
    const name=$('figureName').value.trim(),ids=packIds();
    const bad=!PanelFiles.validName(name);
    $('confirmSave').disabled=bad || !ids.length;
    $('singleSlidePreview').disabled=!ids.length;
    $('namePreview').textContent=bad?'请输入可用作文件名的 Figure 名称。':!ids.length?'至少勾选一个 Panel。':
      saveKind==='ppt'?name+'.pptx · 一张幻灯片，'+ids.length+' 张独立图片':ids.length===1?filename(name,model.items[ids[0]]):filename(name,model.items[ids[0]])+' 等 '+ids.length+' 张 PNG';
  }
  function openSave(kind) {
    saveKind=kind;$('saveTitle').textContent=kind==='ppt'?'导出本图幻灯片':kind==='zip'?'打包 Panel 图片':'下载当前 Panel';
    PanelIcons.set($('confirmSave'),kind==='ppt'?'presentation':kind==='zip'?'file-archive':'image-down',
      kind==='ppt'?'下载 PPTX':kind==='zip'?'导出 ZIP':'下载 PNG');
    $('singleSlidePreview').hidden=kind!=='ppt';$('packPicker').hidden=kind==='one';$('figureName').value=figureName||'Fig 1';$('packLabels').replaceChildren();
    for(const [id,p] of model.items.entries()) {
      const label=document.createElement('label'),cb=document.createElement('input');
      cb.type='checkbox';cb.value=id;cb.checked=p.pack!==false;label.append(cb,document.createTextNode(p.label));
      $('packLabels').append(label);
    }
    savePreview();$('saveDialog').showModal();$('figureName').focus();$('figureName').select();
  }
  $('one').onclick=()=>openSave('one');$('all').onclick=()=>openSave('zip');$('pptBtn').onclick=()=>openSave('ppt');
  async function singleSheet(ids,name){
    return {name,size:[model.source.width,model.source.height],physical:model.physical||[model.source.width*.75,model.source.height*.75],
      outputs:await PanelFiles.outputs(model,padding(),$('paper').value,ids)};
  }
  $('singleSlidePreview').onclick=()=>task(async()=>{
    if(!packIds().length)return;const sheet=await singleSheet(packIds(),$('figureName').value.trim()||'Fig 1');
    await PaperBatch.showImage(await PanelSlides.preview(sheet,[sheet]),sheet.name,'PPT 排版 · '+sheet.outputs.length+' 张独立图片');
  });
  $('cancelSave').onclick=()=>$('saveDialog').close();
  $('figureName').oninput=savePreview;$('packLabels').onchange=savePreview;
  for(const id of ['pickAll','pickNone']) $(id).onclick=()=>{
    for(const cb of $('packLabels').querySelectorAll('input')) cb.checked=id==='pickAll';
    savePreview();
  };
  $('saveForm').onsubmit=e=>{
    e.preventDefault();savePreview();if($('confirmSave').disabled) return;
    const ids=packIds(),kind=saveKind;figureName=$('figureName').value.trim();
    if(kind!=='one'){model.items.forEach((item,id)=>item.pack=ids.includes(id));PaperBatch.changed();}
    $('saveDialog').close();
    task(async()=>{
      if(kind==='ppt'){
        const sheet=await singleSheet(ids,figureName);PanelOutput.save(await PanelSlides.make([sheet]),figureName+'.pptx');
        status('已导出一张幻灯片，共 '+ids.length+' 张独立图片。');return;
      }
      const files=[];
      for(const id of ids) {
        status('正在生成 '+(files.length+1)+' / '+ids.length+'…','busy');
        const c=clean(id);files.push({name:filename(figureName,model.items[id]),blob:await PanelOutput.png(c)});c.width=c.height=1;
      }
      if(kind==='zip') {PanelOutput.save(await PanelOutput.zip(files),figureName+'.zip');status('已打包 '+files.length+' 张 PNG。');}
      else {PanelOutput.save(files[0].blob,files[0].name);status('已生成 '+files[0].name+'。');}
    });
  };
  function copySelected() {
    if(busy || !active()) return;
    task(async()=>{
      const item=active(),c=clean(selected),promise=PanelOutput.png(c);
      try {
        await navigator.clipboard.write([new ClipboardItem({'image/png':promise})]);
        status('已复制 Panel '+item.label+' 的 PNG，可在 PowerPoint 等软件中按 Ctrl+V 粘贴。');
      } catch {
        const blob=await promise,img=new Image();fallbackURL=URL.createObjectURL(blob);
        img.src=fallbackURL;img.alt='Panel '+item.label+' PNG';$('copyImage').replaceChildren(img);$('copyDialog').showModal();
        status('可在预览图上右键复制图像。','warn');
      }
    });
  }
  $('copy').onclick=copySelected;
  $('copyDialog').addEventListener('close',()=>{if(fallbackURL) URL.revokeObjectURL(fallbackURL);fallbackURL='';$('copyImage').replaceChildren();});
  $('jsonBtn').onclick=()=>PanelOutput.save(jsonBlob(manifest()),'panel_regions.json');
  $('som').onclick=()=>task(async()=>{
    const c=makeCanvas(model.source.width,model.source.height), ctx=c.getContext('2d');
    ctx.drawImage(model.source,0,0);ctx.scale(c.width/model.w,c.height/model.h);
    geometry ||= paths();
    const size=Math.max(12,Math.min(model.w,model.h)/65);
    ctx.font='bold '+size+'px Arial';ctx.textBaseline='top';ctx.lineWidth=Math.max(1.3,size/8);
    for (const [id,item] of model.items.entries()) {
      ctx.strokeStyle='#08775c';ctx.stroke(geometry[id].line);
      const bounds=PanelOutput.bounds(model,id,0),x=bounds[0]*model.w/model.source.width,y=Math.max(0,bounds[1]*model.h/model.source.height-size-3);
      ctx.fillStyle='#08654f';ctx.fillRect(x,y,ctx.measureText(item.label).width+7,size+3);
      ctx.fillStyle='white';ctx.fillText(item.label,x+3,y+1);
    }
    PanelOutput.save(await PanelOutput.png(c),'panel_overview.png');status('已生成带编号的整图。');
  });
  $('promptBtn').onclick=()=>{
    const list=manifest().panels.map(({id,bbox})=>({id,bbox}));
    $('review').value='请对照原始 Figure 和带编号整图核对以下 Panel。检查编号、完整性、邻区残留，并概述每个 Panel。图坐标为原图像素 x,y,width,height。\n'+JSON.stringify(list)+
      '\n请返回 {"panels":[{"id":"a","description":"…","review_required":false}]}。';
    $('review').focus();$('review').select();status('复核提示词已选中，可复制。');
  };
  $('apply').onclick=()=>{
    try {
      const input=JSON.parse($('review').value);
      if (!Array.isArray(input.panels)) throw Error('缺少 panels 数组');
      const changes=[];
      for (const row of input.panels) {
        const label=String(row?.id||row?.label||'').toLowerCase();
        const item=model.items.find(p=>p.label.toLowerCase()===label);
        if (item && (typeof row.description==='string' || typeof row.review_required==='boolean')) changes.push([item,row]);
      }
      if (!changes.length) throw Error('没有可匹配的 Panel');
      remember();
      for (const [item,row] of changes) {
        if (typeof row.description==='string') item.description=row.description.slice(0,1600);
        if (typeof row.review_required==='boolean') item.review=row.review_required;
      }
      preview();controls();status('已更新 '+changes.length+' 条复核记录。');
    } catch (err) {status('复核 JSON 无法导入。'+err.message,'warn');}
  };
  $('openNotices').onclick=()=>$('licenseDialog').showModal();
  globalThis.PanelEditor={mount,clear,snapshot,controls,status,select};
  PaperBatch.init();controls();
})();
