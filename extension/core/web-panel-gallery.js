(() => {
  const dialog = document.getElementById('webPanelGallery');
  const el = key => dialog.querySelector('[data-'+key+']');
  const figures=el('figures'), status=el('status'), content=el('content'), tiles=el('panels');
  const original=el('original'), image=original.querySelector('img'), region=el('region'), edit=el('edit');
  let session, model, active, serial=0, box, start;
  const current = token => dialog.open && token===serial && session.scopeValid(session.scope);
  function outline(rect) {
    region.hidden=!rect;
    if (rect) Object.assign(region.style,{left:(rect.x*100)+'%',top:(rect.y*100)+'%',width:(rect.width*100)+'%',height:(rect.height*100)+'%'});
  }
  function select(label) {
    active=model?.panels.find(p=>p.label===label) || null;
    outline(active?.rect);
    el('caption').textContent=active ? [active.caption,active.needsReview?'建议核对边界':''].filter(Boolean).join(' · ') : '';
    for (const b of tiles.children) b.setAttribute('aria-pressed',String(b.dataset.label===label));
    el('ask').disabled=el('draw').disabled=!active;
  }
  function editing(mode) {
    edit.hidden=!mode; el('actions').hidden=!!mode; original.classList.toggle('is-editing',!!mode);
    tiles.inert=!!mode; start=null; box=null;
    if(mode) {
      edit.querySelector('input').value=mode==='new' ? model.expected.find(l=>!model.panels.some(p=>p.label===l)) || '' : active.label;
      edit.querySelector('input').readOnly=mode!=='new';
      status.textContent='在原图上拖动，框住整个 Panel。'; outline(null);
      if(mode==='new') edit.querySelector('input').focus();
    } else if(model) {
      status.textContent=model.panels.length ? model.panels.length+' 个裁片 · 原图 '+model.width+' × '+model.height : '未定位到 Panel 字母，可在原图上补选。';
      select(active?.label || model.panels[0]?.label);
    }
  }
  function render(data,label) {
    model=data; content.hidden=false; image.src=data.original; tiles.replaceChildren();
    for (const panel of data.panels) {
      const button=document.createElement('button'), thumb=document.createElement('img'), name=document.createElement('span');
      button.type='button'; button.dataset.label=panel.label;
      thumb.src=panel.thumb; thumb.alt=''; name.textContent=panel.label;
      button.setAttribute('aria-label','Panel '+panel.label+(panel.needsReview?'，待核对':''));
      button.append(thumb,name);button.onclick=()=>select(panel.label);tiles.append(button);
    }
    active=null; editing(null); select(label || data.panels[0]?.label);
  }
  async function load(label) {
    const n=++serial, option=session.items[Number(figures.value)];
    model=null;active=null;content.hidden=true;tiles.replaceChildren();image.removeAttribute('src');
    status.textContent='正在读取原图并识别 Panel…';
    try {
      const data=await session.request(session.scope,'inspectWebPanelFigure',{figureId:option.figureId,index:option.index});
      if(current(n))render(data,label);
    } catch(e) { if(current(n))status.textContent=e.message; }
  }
  async function open(scope,request,onAsk,scopeValid,figureId,label) {
    if(dialog.open)dialog.close();
    session={scope,request,onAsk,scopeValid,lastSequence:scope.tabContextSequence,items:[]};
    dialog.showModal(); const n=++serial;
    content.hidden=true;figures.replaceChildren();status.textContent='正在读取网页 Figure…';
    try {
      const items=await request(scope,'listWebPanelFigures');
      if(!current(n))return;
      session.items=items;
      if (!items.length) {status.textContent='当前网页没有可读取的 Figure 原图。';return;}
      for (const [i,item] of items.entries()) figures.add(new Option(item.name,String(i)));
      const match=items.findIndex(item=>item.figureId===figureId && (!item.direct || item.direct===label));
      figures.value=String(match>=0?match:0);
      await load(label);
    } catch(e) { if(current(n))status.textContent=e.message; }
  }
  figures.onchange=()=>load();
  el('close').onclick=()=>dialog.close();
  el('draw').onclick=()=>editing('current'); el('add').onclick=()=>editing('new'); el('cancel').onclick=()=>editing(null);
  function point(e) {
    const b=original.getBoundingClientRect();
    return {x:Math.max(0,Math.min(1,(e.clientX-b.left)/b.width)),y:Math.max(0,Math.min(1,(e.clientY-b.top)/b.height))};
  }
  original.onpointerdown=e=>{
    if(edit.hidden || e.button!==0)return;
    e.preventDefault();start=point(e);box=null;original.setPointerCapture(e.pointerId);
  };
  function update(e) {
    if(!start)return;
    const p=point(e); box={x:Math.min(start.x,p.x),y:Math.min(start.y,p.y),width:Math.abs(start.x-p.x),height:Math.abs(start.y-p.y)};
    outline(box);
  }
  original.onpointermove=update;original.onpointerup=e=>{update(e);start=null;};
  original.onpointercancel=()=>{start=null;box=null;outline(null);};
  edit.onsubmit=async e=>{
    e.preventDefault(); const label=edit.querySelector('input').value.trim().toUpperCase();
    if(!box || box.width*model.width<4 || box.height*model.height<4){status.textContent='请先在原图上框选 Panel。';return;}
    const n=++serial, button=edit.querySelector('button'); button.disabled=true;
    try {
      const data=await session.request(session.scope,'correctWebPanel',{figureId:model.figureId,index:model.index,
        edit:{label,rect:box,fingerprint:model.fingerprint}});
      if(current(n))render(data,label);
    } catch(err){if(current(n))status.textContent=err.message;}
    finally {button.disabled=false;}
  };
  el('ask').onclick=async()=>{
    if(!active)return;
    const n=serial;const {label}=active;el('ask').disabled=true;
    try {
      const p=await session.request(session.scope,'readWebPanelCrop',{figureId:model.figureId,index:model.index,label,edge:1400});
      if(current(n)&&active?.label===label){session.onAsk(p);dialog.close();}
    } catch(e){if(current(n))status.textContent=e.message;}
    finally {if(current(n))el('ask').disabled=!active;}
  };
  dialog.addEventListener('close',()=>{
    if(dialog.open)return;
    serial++;model=null;active=null;session=null;image.removeAttribute('src');tiles.replaceChildren();status.textContent='';
  });
  globalThis.BrevessWebPanelGallery={open,check(){
    if(!dialog.open || !session)return;
    if(!session.scopeValid(session.scope)){dialog.close();return;}
    const seq=capturePanelContext().tabContextSequence;
    if(session.lastSequence!==seq && session.scope.panelDocumentIdentity) {
      const old=session;session.lastSequence=seq;
      session.request(session.scope,'webPanelDocumentIdentity').catch(()=>{if(dialog.open && session===old)dialog.close();});
    }
  }};
})();
