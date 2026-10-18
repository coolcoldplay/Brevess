(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.SciLLM=root.SciLLM||{};root.SciLLM.SidebarUI=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
 function viewportPopoverRect({anchor,viewport,width,height,margin=8,gap=6}){
  const left=Number(viewport.left)||0,top=Number(viewport.top)||0;
  const vw=Math.max(0,Number(viewport.width)||0),vh=Math.max(0,Number(viewport.height)||0);
  const w=Math.min(Math.max(0,width),Math.max(0,vw-2*margin));
  const above=clamp(anchor.top-top-gap-margin,0,Math.max(0,vh-2*margin));
  const below=clamp(top+vh-margin-anchor.bottom-gap,0,Math.max(0,vh-2*margin));
  const placement=height<=below||below>=above?'below':'above';
  const maxHeight=Math.max(0,placement==='below'?below:above);
  const h=Math.min(Math.max(0,height),maxHeight);
  return {left:clamp(anchor.right-w,left+margin,left+vw-margin-w),
   top:clamp(placement==='below'?anchor.bottom+gap:anchor.top-gap-h,top+margin,top+vh-margin-h),
   width:w,height:h,maxHeight,placement};
 }
 function positionViewportPanel(panel,anchor,view){
  if(panel.hidden||!anchor?.isConnected)return null;
  const vv=view.visualViewport;
  const viewport={left:vv?.offsetLeft||0,top:vv?.offsetTop||0,width:vv?.width||view.innerWidth,height:vv?.height||view.innerHeight};
  const rect=viewportPopoverRect({anchor:anchor.getBoundingClientRect(),viewport,width:240,height:panel.scrollHeight||panel.getBoundingClientRect().height});
  Object.assign(panel.style,{position:'fixed',right:'auto',bottom:'auto',left:rect.left+'px',top:rect.top+'px',width:rect.width+'px',maxHeight:rect.maxHeight+'px',overflowY:'auto'});
  panel.dataset.placement=rect.placement;return rect;
 }
 function createFigureGesture({onLocate,onAnalyze,onInspect,onFeedback,isCurrent=()=>true,setTimer=setTimeout,clearTimer=clearTimeout,singleDelay=500,longDelay=1000}){
  let press=null,longTimer=null,singleTimer=null,suppress=false,disposed=false;
  const clear=()=>{clearTimer(longTimer);clearTimer(singleTimer);longTimer=singleTimer=null;};
  const feedback=state=>{if(!disposed)onFeedback?.(state);};
  const fire=(fn,state,event)=>{if(!disposed&&isCurrent()){feedback(state);fn?.(event);}else feedback('idle');};
  function cancel(){if(press||longTimer!==null)suppress=true;press=null;clear();feedback('idle');}
  return {
   pointerDown(event){if(disposed||event.button!==0||event.isPrimary===false)return;clear();suppress=false;
    press={id:event.pointerId,x:event.clientX,y:event.clientY};
    feedback('pressing');
    longTimer=setTimer(()=>{longTimer=null;if(press&&!disposed&&isCurrent()){suppress=true;fire(onInspect,'inspect');}else feedback('idle');},longDelay);
   },
   pointerMove(event){if(press&&event.pointerId===press.id&&Math.hypot(event.clientX-press.x,event.clientY-press.y)>8)cancel();},
   pointerUp(event){if(!press||event.pointerId!==press.id)return;clearTimer(longTimer);longTimer=null;press=null;if(!suppress)feedback('idle');},
   click(event){if(disposed||suppress||!isCurrent())return;clearTimer(singleTimer);singleTimer=null;
    if(event.detail>1)return;
    if(event.detail===0)fire(onLocate,'locate');
    else {feedback('pending');singleTimer=setTimer(()=>{singleTimer=null;fire(onLocate,'locate');},singleDelay);}
   },
   doubleClick(event){clearTimer(singleTimer);singleTimer=null;if(!suppress)fire(onAnalyze,'analyze',event);},
   keyboard(event){if(event.key!=='Enter'&&event.key!==' ')return false;clear();
    fire(event.altKey?onInspect:event.shiftKey?onAnalyze:onLocate,event.altKey?'inspect':event.shiftKey?'analyze':'locate',event);return true;
   },cancel,
   dispose(){cancel();disposed=true;}
  };
 }
 function bindFigureGesture(button,options){
  const view=button.ownerDocument.defaultView,doc=button.ownerDocument;
  const setTimer=options.setTimer||view.setTimeout.bind(view),clearTimer=options.clearTimer||view.clearTimeout.bind(view);
  let feedbackTimer=null;
  const setFeedback=state=>{
   clearTimer(feedbackTimer);feedbackTimer=null;button.dataset.figureGesture=state;
   options.onFeedback?.(state);
   if(['locate','analyze','inspect'].includes(state))feedbackTimer=setTimer(()=>{feedbackTimer=null;button.dataset.figureGesture='idle';},600);
  };
  button.style.setProperty('--figure-hold-duration',`${options.longDelay??1000}ms`);
  const g=createFigureGesture({...options,setTimer,clearTimer,onFeedback:setFeedback}),listeners=[];
  const listen=(target,type,handler,config)=>{target.addEventListener(type,handler,config);listeners.push(()=>target.removeEventListener(type,handler,config));};
  const isolated=fn=>event=>{event.stopPropagation();fn(event);};
  listen(button,'pointerdown',isolated(g.pointerDown));
  listen(button,'pointermove',isolated(g.pointerMove));
  listen(button,'pointerup',isolated(g.pointerUp));
  listen(button,'pointerleave',()=>g.cancel());
  listen(button,'pointercancel',()=>g.cancel());
  listen(button,'click',event=>{event.preventDefault();event.stopPropagation();g.click(event);});
  listen(button,'dblclick',event=>{event.preventDefault();event.stopPropagation();g.doubleClick(event);});
  listen(button,'keydown',event=>{if(event.key==='Escape'){g.cancel();return;}if(g.keyboard(event)){event.preventDefault();event.stopPropagation();}});
  listen(doc,'keydown',event=>{if(event.key==='Escape')g.cancel();});
  listen(doc,'scroll',()=>g.cancel(),true);listen(view,'blur',()=>g.cancel());
  return ()=>{g.dispose();clearTimer(feedbackTimer);feedbackTimer=null;delete button.dataset.figureGesture;listeners.forEach(fn=>fn());};
 }
 function isSidebarTaskGenerating(task,{pendingStop=false}={}){
  if(!task||task.status!=='running'||task.terminal===true||task.cancelRequested||pendingStop||task.backendModule==='highlight-regex')return false;
  return ![task.phase,task.stage].some(value=>['stopping','outcome_unknown','pending-receipt','awaiting_ack','awaiting-ack','saving','validating','backoff'].includes(value));
 }
 const labels={preparing:'准备中',running:'执行中',retrying:'自动重试',backoff:'等待重试',validating:'核验中',saving:'保存中',stopping:'正在停止',outcome_unknown:'结果待确认',stopped:'已停止',partial:'部分完成',failed:'失败',completed:'已完成',saveFailed:'保存失败',blocked:'需处理'};
 function projectSidebarTask(input){
  if(!input||!['navigation','highlights','figures','note'].includes(input.module)||!input.operationId||!input.documentId||
   !Number.isSafeInteger(input.epoch)||input.epoch<0||!Number.isSafeInteger(input.workspaceLifecycle)||input.workspaceLifecycle<0||
   !Number.isSafeInteger(input.eventSequence)||input.eventSequence<0)return null;
  const total=Math.max(0,Number(input.totalUnits)||0),done=clamp(Number(input.completedUnits)||0,0,total);
  const complete=input.status==='completed'&&input.terminal===true&&!input.cancelRequested;
  const percent=complete?100:total?Math.min(99,Math.floor(done/total*100)):null;
  return {...input,totalUnits:total,completedUnits:done,percent,
   label:input.cancelRequested&&['outcome_unknown','pending-receipt'].includes(input.status)?'停止确认中':labels[input.status]||'等待状态',
   busy:input.terminal!==true||['stopping','outcome_unknown','pending-receipt'].includes(input.status)};
 }
 function createSidebarTaskStore(){
  const states=new Map(),backendStates=new Map();
  return {accept(input){const next=projectSidebarTask(input);if(!next)return false;
   const key=next.documentId+'|'+next.module,backendKey=key+'|'+(next.backendModule||next.module);
   const latest=states.get(key),old=backendStates.get(backendKey);
   if(latest&&next.workspaceLifecycle<latest.workspaceLifecycle)return false;
   if(old){
    if(next.workspaceLifecycle<old.workspaceLifecycle)return false;
    if(next.workspaceLifecycle===old.workspaceLifecycle){
     if(next.epoch<old.epoch||next.epoch===old.epoch&&next.operationId!==old.operationId)return false;
     if(next.operationId===old.operationId&&(next.eventSequence<=old.eventSequence||old.terminal===true&&next.status!==old.status&&old.status!=='outcome_unknown'))return false;
    }
   }backendStates.set(backendKey,next);states.set(key,next);return true;
  },retireExact(expected,receipt){
   const key=expected?.documentId+'|'+expected?.module,current=states.get(key),task=receipt?.task;
   if(!current||receipt?.receiptOnly!==true||task?.terminal!==true||task.module!=='figures'||task.documentId!==expected.contentDocumentIdentity||current.terminal||
    !['operationId','epoch','workspaceLifecycle'].every(field=>current[field]===expected[field]&&task[field]===expected[field])||
    current.contentDocumentIdentity!==expected.contentDocumentIdentity||current.contentDocumentIdentity!==receipt.contentDocumentIdentity||
    receipt.navigationIdentity!==expected.navigationIdentity||
    !['completed','partial','failed','stopped'].includes(task.status))return false;
   const retired={...projectSidebarTask({...current,status:task.status,terminal:true,cancelRequested:task.cancelRequested===true,
    completedUnits:task.completedUnits,totalUnits:task.totalUnits}),retired:true,receiptOnly:true,
    cancellationOrigin:receipt.cancellationOrigin||'',label:receipt.cancellationOrigin==='article-source-changed'?'正文已更新':task.status==='completed'?'已完成':'已停止'};
   states.set(key,retired);backendStates.set(key+'|'+(current.backendModule||current.module),retired);return true;
  },get:(documentId,module)=>states.get(documentId+'|'+module)||null};
 }
 function parseArtworkPages(value,pageCount){
  if(!Number.isSafeInteger(pageCount)||pageCount<1)throw new Error('当前 PDF 页数不可用，请重新绑定文献。');
  const pages=[];
  for(const part of String(value||'').trim().split(/[,，\s]+/u).filter(Boolean)){
   const match=/^(\d+)(?:[-–](\d+))?$/u.exec(part);
   if(!match)throw new Error('请使用物理页码或范围，例如 5-6。');
   const start=Number(match[1]),end=Number(match[2]||match[1]);
   if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<1||end<start||end>pageCount||end-start>3)throw new Error(`物理页码须在 1–${pageCount} 内，最多 4 页。`);
   for(let page=start;page<=end;page++)pages.push(page);
  }
  if(!pages.length||pages.length>4||new Set(pages).size!==pages.length)throw new Error('请选择 1–4 个不重复的物理页码。');
  return pages;
 }
 function translationStatusLabel(state={}){
  const n=key=>Math.max(0,Number(state[key])||0);
  const progress=n('total')?` · 已保存 ${n('completed')}/${n('total')}`:'';
  const attempts=n('attempts')?` · 尝试 ${n('attempts')} / 重试 ${n('retries')}`:'';
  let label;
  if(n('stopPending')||n('stopUnknown')||['stopping','pending-receipt'].includes(state.phase))label='停止确认中（仅查询回执）';
  else if(n('saveFailed')||state.phase==='saveFailed')label='译文保存失败';
  else if(n('blocked')||state.phase==='blocked')label='翻译已阻塞，请检查模型配置/额度';
  else if(n('unknown'))label='等待原请求回执，不重复推理';
  else if(n('saving')||state.phase==='saving')label='正在保存译文';
  else if(n('retrying')||state.phase==='retrying')label='翻译自动重试中';
  else if(state.enabled===false&&n('unfinished'))label=`翻译已停止 · 未完成 ${n('unfinished')}，点击继续`;
  else if(state.phase==='complete')label='当前范围译文已全部保存；点击停止，译文保留';
  else if(state.enabled)label='翻译进行中；点击停止，保留已保存译文';
  else label='开启/继续全文翻译，复用已保存译文';
  return label+progress+attempts;
 }
 return {viewportPopoverRect,positionViewportPanel,createFigureGesture,bindFigureGesture,isSidebarTaskGenerating,projectSidebarTask,createSidebarTaskStore,translationStatusLabel,parseArtworkPages};
});
