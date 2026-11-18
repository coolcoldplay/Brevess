(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.SciLLM=root.SciLLM||{};root.SciLLM.SidebarSort=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 function figureDropIds(ids,movingId,rows,y){
  if(!Array.isArray(ids)||ids.length>128||new Set(ids).size!==ids.length||!ids.includes(movingId))return null;
  const others=ids.filter(id=>id!==movingId),bounds=new Map(rows.map(row=>[row.id,row]));
  let insertion=others.findIndex(id=>{const row=bounds.get(id);return row&&y<(row.top+row.bottom)/2;});
  if(insertion<0)insertion=others.length;
  others.splice(insertion,0,movingId);return others;
 }
 function createFigureSortSession(options){
  const o=options||{},set=o.setTimer||setTimeout,clear=o.clearTimer||clearTimeout;
  let phase='idle',record=null,timer=null,generation=0;
  const current=()=>record&&o.isCurrent?.(record.context)!==false;
  function reset(){clear(timer);timer=null;record=null;phase='idle';o.onBusy?.(false);}
  function cancel(force=false){
   if(phase==='idle'||phase==='saving'&&!force)return false;
   generation++;clear(timer);timer=null;o.onRollback?.();reset();return true;
  }
  return {state:()=>phase,cancel,
   down(event){if(phase!=='idle'||event.button!==0||event.isPrimary===false)return false;
    record={pointerId:event.pointerId,x:event.clientX,y:event.clientY,context:o.captureContext?.()};phase='holding';
    timer=set(()=>{timer=null;if(!current()){cancel();return;}
     try{if(o.onStart?.(record)===false){cancel();return;}phase='dragging';o.onBusy?.(true);}catch(error){o.onError?.(error);cancel();}},400);return true;
   },
   move(event){if(!record||event.pointerId!==record.pointerId)return false;
    if(!current()){cancel(true);return false;}
    if(phase==='holding'&&Math.hypot(event.clientX-record.x,event.clientY-record.y)>6){cancel();return false;}
    if(phase==='dragging'){record.order=o.getOrder?.(event);o.onPreview?.(event,record.order);return true;}return false;
   },
   async up(event){if(!record||event.pointerId!==record.pointerId)return false;
    if(phase==='holding'){reset();return false;}if(phase!=='dragging')return false;
    if(!current()){cancel();return false;}
    const order=o.getOrder?.(event)||record.order;if(!order){cancel();return false;}
    const token=generation,context=record.context;phase='saving';o.onSaving?.();
    try{const ack=await o.persist(order,context);
     if(token!==generation)return false;
     if(ack?.success!==true||!ack.draft||ack.stale)throw new Error(ack?.code||'展示顺序保存未确认');
     o.onCommit?.(ack,order);return true;
    }catch(error){if(token===generation){o.onRollback?.();o.onError?.(error);}return false;
    }finally{if(token===generation)reset();}
   }
  };
 }
 function bindFigureSort({summary,card,container,ids,captureContext,isCurrent,persist,setEditing,onError,onActive}){
  const doc=card.ownerDocument,view=doc.defaultView;
  const scroll=container.closest('[data-workspace-view]')||container;
  const reduced=view.matchMedia?.('(prefers-reduced-motion: reduce)').matches===true;
  const duration=reduced?0:180;
  let placeholder=null,originalNext=null,originalStyles=null,offsetX=0,offsetY=0,pointer=null,raf=null,lastEvent=null,suppress=false,disposed=false,keyboardSaving=false;
  const listeners=[],styles=new Map();
  const cards=()=>[...container.querySelectorAll(':scope > .workspace-figure-card[data-figure-id]')].filter(item=>item!==card);
  const listen=(target,type,fn,opts)=>{target.addEventListener(type,fn,opts);listeners.push(()=>target.removeEventListener(type,fn,opts));};
  const bounds=()=>cards().map(item=>({id:item.dataset.figureId,...item.getBoundingClientRect().toJSON?.(),top:item.getBoundingClientRect().top,bottom:item.getBoundingClientRect().bottom}));
  function cleanup(commit=false){
   if(raf!==null)view.cancelAnimationFrame(raf);raf=null;
   if(placeholder){
    if(commit)container.insertBefore(card,placeholder);
    else if(originalNext?.parentNode===container)container.insertBefore(card,originalNext);
    placeholder.remove();placeholder=null;
   }
   if(originalStyles!==null){card.setAttribute('style',originalStyles);originalStyles=null;}
   card.classList.remove('is-display-sorting');card.removeAttribute('aria-grabbed');card.removeAttribute('aria-busy');
   for(const [item,style]of styles){item.setAttribute('style',style);item.classList.remove('is-sort-neighbor');}styles.clear();
   if(pointer!==null){try{summary.releasePointerCapture(pointer);}catch{}pointer=null;}
   // Keep suppression through the browser's synthesized click after pointerup.
   view.setTimeout(()=>{suppress=false;},0);
  }
  function flip(before){
   for(const item of cards()){
    const old=before.get(item),next=item.getBoundingClientRect();
    item.style.transition='none';item.style.transform=`translateY(${old?old.top-next.top:0}px) scale(.98)`;
    view.requestAnimationFrame(()=>{if(disposed||!placeholder)return;item.style.transition=`transform ${duration}ms ease`;item.style.transform='scale(.98)';});
   }
  }
  function preview(event,order){
   lastEvent=event;
   if(!placeholder||!order)return;
   card.style.left=(event.clientX-offsetX)+'px';card.style.top=(event.clientY-offsetY)+'px';
   const insertion=order.indexOf(card.dataset.figureId),others=cards();
   const nextId=order[insertion+1],next=others.find(item=>item.dataset.figureId===nextId)||null;
   if(placeholder.nextElementSibling!==next){
    const before=new Map(others.map(item=>[item,item.getBoundingClientRect()]));
    container.insertBefore(placeholder,next);flip(before);
   }
  }
  const session=createFigureSortSession({captureContext,isCurrent,
   onStart(record){if(disposed||!card.isConnected)return false;
    onActive?.(()=>session.cancel(true));originalNext=card.nextSibling;originalStyles=card.getAttribute('style')||'';
    const rect=card.getBoundingClientRect();offsetX=record.x-rect.left;offsetY=record.y-rect.top;
    placeholder=doc.createElement('div');placeholder.className='workspace-figure-sort-placeholder';
    placeholder.style.height=rect.height+'px';placeholder.style.boxSizing='border-box';
    const computed=view.getComputedStyle(card);placeholder.style.marginTop=computed.marginTop;placeholder.style.marginBottom=computed.marginBottom;
    container.insertBefore(placeholder,card);suppress=true;pointer=record.pointerId;
    try{summary.setPointerCapture(pointer);}catch{}
    for(const item of cards()){styles.set(item,item.getAttribute('style')||'');item.classList.add('is-sort-neighbor');item.style.transition=`transform ${duration}ms ease`;item.style.transform='scale(.98)';}
    card.classList.add('is-display-sorting');card.setAttribute('aria-grabbed','true');
    Object.assign(card.style,{position:'fixed',left:rect.left+'px',top:rect.top+'px',width:rect.width+'px',height:rect.height+'px',maxHeight:rect.height+'px',overflow:'hidden',margin:'0',zIndex:'1050',transform:'scale(1.03)',transition:`transform ${duration}ms ease`,pointerEvents:'none'});
    lastEvent={clientX:record.x,clientY:record.y,pointerId:record.pointerId};
    const tick=()=>{
     if(session.state()!=='dragging'||!placeholder){raf=null;return;}
     const viewport=scroll.getBoundingClientRect(),y=lastEvent?.clientY;
     const velocity=y<viewport.top+44?-Math.min(12,(viewport.top+44-y)/3):y>viewport.bottom-44?Math.min(12,(y-viewport.bottom+44)/3):0;
     if(velocity){scroll.scrollTop+=velocity;session.move(lastEvent);}
     raf=view.requestAnimationFrame(tick);
    };raf=view.requestAnimationFrame(tick);return true;
   },
   getOrder:event=>figureDropIds(ids,card.dataset.figureId,bounds(),event.clientY),onPreview:preview,
   onSaving(){card.setAttribute('aria-busy','true');},persist,
   onCommit(){cleanup(true);},onRollback(){cleanup(false);},onBusy:value=>setEditing?.(value),onError
  });
  summary.setAttribute('aria-keyshortcuts','Alt+ArrowUp Alt+ArrowDown');
  summary.title='在 Fig 色块以外长按 0.4 秒拖动排序；Alt+↑/↓ 调整展示位置';
  listen(summary,'pointerdown',event=>{
   if(event.ctrlKey||event.metaKey||event.shiftKey||event.target.closest('button,input,select,textarea,a,[contenteditable="true"]'))return;
   session.down(event);
  });
  listen(summary,'pointermove',event=>{if(session.move(event))event.preventDefault();});
  listen(summary,'pointerup',event=>{if(session.state()==='dragging')event.preventDefault();void session.up(event);});
  listen(summary,'pointercancel',()=>session.cancel());
  listen(summary,'pointerleave',()=>{if(session.state()==='holding')session.cancel();});
  listen(summary,'lostpointercapture',()=>session.cancel());
  listen(summary,'contextmenu',event=>{if(session.state()!=='idle'){event.preventDefault();session.cancel();}});
  listen(summary,'click',event=>{if(suppress){event.preventDefault();event.stopImmediatePropagation();}},true);
  listen(summary,'keydown',event=>{
   if(event.target!==summary||!event.altKey||event.ctrlKey||event.metaKey||!['ArrowUp','ArrowDown'].includes(event.key)||session.state()!=='idle'||keyboardSaving)return;
   event.preventDefault();const index=ids.indexOf(card.dataset.figureId),target=index+(event.key==='ArrowUp'?-1:1);if(target<0||target>=ids.length)return;
   const order=ids.slice();[order[index],order[target]]=[order[target],order[index]];
   keyboardSaving=true;setEditing?.(true);void persist(order,captureContext()).then(ack=>{if(!ack?.success||!ack.draft||ack.stale)throw new Error('排序保存未确认');}).catch(onError).finally(()=>{keyboardSaving=false;setEditing?.(false);});
  });
  listen(doc,'keydown',event=>{if(event.key==='Escape')session.cancel();});
  listen(view,'blur',()=>session.cancel());
  return ()=>{if(disposed)return;disposed=true;session.cancel(true);cleanup();listeners.forEach(fn=>fn());};
 }
 return {figureDropIds,createFigureSortSession,bindFigureSort};
});
