(function(g){'use strict';function install({browser:b,broker,multi,createTask}){const S=g.WFGSchema,states=new Map(),repo=S.repository({readRaw:async()=>(await b.storage.local.get(S.KEY))[S.KEY],writeRaw:x=>b.storage.local.set({[S.KEY]:x})});
const files=['schema.js','engine.js','reading-modules.js','reading-pubmed.js','reading-page.js','ux-page.js','ux-entry.js'].map(f=>'web-filters-general/'+f);
const generalization=g.WFGGeneralization.create({browser:b,broker,createTask,repository:()=>g.BrevessReadingModulesController.repo,notify:()=>g.BrevessReadingModulesController.notify(),onChange:()=>{for(const st of states.values())publish(st);}});
async function panel(sender){if(sender.id!==b.runtime.id||sender.tab)throw Error('PANEL_REQUIRED');const cs=await b.runtime.getContexts({contextTypes:['SIDE_PANEL']});const c=cs.filter(c=>c.documentUrl===sender.url&&(!sender.documentId||sender.documentId===c.documentId));if(c.length!==1)throw Error('PANEL_REQUIRED');return c[0];}
async function ensure(tab){
 const frames=await b.webNavigation.getAllFrames({tabId:tab.id})||[];
 await Promise.all(frames.map(async f=>{
  try{await broker.rpc(tab.id,f.frameId,'OPEN');}
  catch{try{await b.scripting.executeScript({target:{tabId:tab.id,frameIds:[f.frameId]},files});}catch{/* Inaccessible frame. */}}
 }));
}
async function state(tab){
 if(!tab||!S.permitted(tab.url))throw Error('PAGE_NOT_PERMITTED');
 const frames=await b.webNavigation.getAllFrames({tabId:tab.id})||[],documentId=frames.find(f=>f.frameId===0)?.documentId||'';
 let st=states.get(tab.id);
 if(st&&(st.url!==tab.url||(documentId&&st.documentId&&documentId!==st.documentId))){st.epoch++;abandonPending(st);multi.cancel?.(st.runOwner,st.tabId);states.delete(tab.id);st=null;}
 if(!st){st={tabId:tab.id,windowId:tab.windowId,documentId,documentKey:crypto.randomUUID(),adjusting:false,url:tab.url,title:tab.title||S.safeURL(tab.url),sourceIds:[tab.id],targets:[],referenceIds:[],plan:null,preview:false,saved:false,feedback:null,undo:[],epoch:0,busy:false,turns:[]};states.set(tab.id,st);}else if(tab.title)st.title=tab.title;return st;
}
async function assertStateCurrent(st){
 const tab=await b.tabs.get(st.tabId);
 const frames=await b.webNavigation.getAllFrames({tabId:st.tabId})||[],documentId=frames.find(f=>f.frameId===0)?.documentId||'';
 if(states.get(st.tabId)!==st||tab.url!==st.url||(st.documentId&&documentId&&st.documentId!==documentId))throw Error('PAGE_CHANGED');
}
function view(st){const u=new URL(st.url),range='当前网页路径 '+u.pathname+(g.WFGReadingModules.pageQuery(st.url)?' · 文献 id='+g.WFGReadingModules.pageQuery(st.url).id:'（查询参数可变）')+'；相似网页须补充样例验证';return {generalization:generalization.summary(st.windowId),adjustmentMode:st.adjustmentMode||'display',hasAuxiliarySources:!!st.hasAuxiliarySources,adjusting:!!st.adjusting,saveScopeLabel:range,tabId:st.tabId,documentKey:st.documentKey,navigationUrl:st.url,url:S.safeURL(st.url),title:st.title,sourceIds:st.sourceIds,targets:st.targets,referenceIds:st.referenceIds,plan:st.plan,preview:st.preview,saved:st.saved,automaticModuleView:!!st.automaticModuleView,saveConfirmation:st.pendingSave?{token:st.pendingSave.token,scopeLabel:st.pendingSave.scopeLabel,scopeUrl:st.pendingSave.scopeUrl,replaces:st.pendingSave.competing.length}:null,layoutReview:st.preview&&!st.saved&&st.layoutReview?.plan===st.plan?st.layoutReview.label:'',sampleReady:!!st.sampleEvidence&&st.feedback?.every(f=>f.verified),feedback:st.feedback,busy:st.busy,turns:st.turns,canUndo:!!st.undo.length,scopeLabel:st.scopeLabel||'',notice:st.notice||st.readingNotice||''};}
function abandonPending(st){st.busy=false;st.turns=st.turns.map(t=>t.status==='pending'?{...t,status:'cancelled',error:'QUESTION_CANCELLED'}:t);}
function publish(st){if(states.get(st.tabId)!==st)return;void b.runtime.sendMessage({type:'WFG_UX_STATE',state:view(st)}).catch(()=>{});}
async function snapshot(st){if((await b.tabs.get(st.tabId)).url!==st.url)throw Error('PAGE_CHANGED');await ensure(await b.tabs.get(st.tabId));const o=await broker.overview(st.tabId);if(!o.frames.some(f=>f.frameId===0&&f.ok))throw Error('PAGE_UNAVAILABLE');return o;}
async function bind(st){const o=await snapshot(st);st.binding=o.frames.filter(f=>f.ok).map(f=>({frameId:f.frameId,session:f.data.session,version:f.data.version}));return Object.fromEntries(st.binding.map(f=>[f.frameId,f.session]));}
async function guard(st){const o=await snapshot(st);if(st.binding)for(const old of st.binding){const now=o.frames.find(f=>f.frameId===old.frameId&&f.ok);if(!now||now.data.session!==old.session||now.data.version!==old.version)throw Error('PREVIEW_DOCUMENT_CHANGED');}return o;}
async function rebaseSelectedAfterOwnEdit(st){
 const key=t=>JSON.stringify([t?.frame,t?.roots,t?.selector]);
 const colorRefresh=!!st.plan?.operations.length&&st.plan.operations.every(op=>op.type==='replaceColor'&&st.planTargets?.some(proof=>st.binding?.some(frame=>frame.frameId===proof.frameId&&frame.session===proof.session)&&proof.groups?.some(group=>key(group.target)===key(op.target)&&Array.isArray(group.ids)&&group.ids.length>0)));
 const updated=[];for(const t of st.targets){
  const current=await broker.rpc(st.tabId,t.frameId,'TOOL',{tool:'inspect',args:{session:t.session,id:t.id}});
  if(current.id!==t.id||current.tag!==t.tag||key(current.target)!==key(t.target)||(colorRefresh&&(current.hidden||current.redacted))||(!colorRefresh&&current.contentVersion!==t.contentVersion))throw Error('SOURCE_TARGET_CHANGED');
  // This host check resolves the exact selector uniquely to the same node. The fresh record
  // then enters multitab's existing selection/scope verification before and during the turn.
  const verified=await broker.rpc(st.tabId,t.frameId,'TOOL',{tool:'verifyRecords',args:{session:t.session,records:[{kind:'inspect',record:current,selection:true}]}});
  if(verified?.verified!==true||verified.session!==t.session)throw Error('SOURCE_TARGET_CHANGED');
  updated.push({...t,...current,displayText:colorRefresh?current.text:t.displayText||t.text,session:t.session,tabId:t.tabId,frameId:t.frameId,sourceTitle:t.sourceTitle,sameKind:t.sameKind});
 }st.targets=updated;st.selectionRebase=false;
}
async function capturePlanTargets(st){
 const o=await snapshot(st),proof=[];
 for(const frame of o.frames.filter(f=>f.ok)){const targets=[...new Map(st.plan.operations.filter(op=>op.type==='replaceColor'&&op.target.frame===frame.data.frame).map(op=>[JSON.stringify(op.target),op.target])).values()];if(!targets.length)continue;
 const result=await broker.rpc(st.tabId,frame.frameId,'TOOL',{tool:'planTargets',args:{session:frame.data.session,targets}});
 if(!result?.groups?.length)throw Error('SOURCE_TARGET_CHANGED');proof.push({frameId:frame.frameId,session:frame.data.session,groups:result.groups.map(({target,ids})=>({target,ids}))});}
 st.planTargets=proof;
}
async function captureSampleEvidence(st){
 st.sampleEvidence=null;
 if(!st.plan?.operations.length||st.plan.operations.length>16||st.plan.operations.some(op=>!['style','hide','replaceColor'].includes(op.type)||op.target.frame!=='top'||op.target.roots.length))return;
 const frame=(await snapshot(st)).frames.find(f=>f.ok&&f.frameId===0);if(!frame)return;
 const proof=await broker.rpc(st.tabId,0,'TOOL',{tool:'planTargets',args:{session:frame.data.session,targets:st.plan.operations.map(op=>op.target)}});
 st.sampleEvidence={session:frame.data.session,groups:proof.groups};
}
async function guardFollowup(st){
 if(st.automaticModuleView&&st.saved){
  // Auto-applied modules belong to the reading renderer. A rotating ad can
  // change its frame version without changing the article or the saved rule.
  await assertStateCurrent(st);
  const current=await broker.rpc(st.tabId,0,'READING_SNAPSHOT');
  if(current.session!==st.readingViewSession||!current.reading?.moduleIds?.includes(st.readingModuleId))throw Error('PREVIEW_DOCUMENT_CHANGED');
  await broker.rpc(st.tabId,0,'READING_VALIDATE_PLAN',{plan:st.plan,reusable:false});
  return;
 }
 if(st.preview&&st.sampleEvidence?.groups?.length&&!st.plan?.operations.some(op=>op.type==='replaceColor')){
  const frame=(await snapshot(st)).frames.find(f=>f.frameId===0&&f.ok),proof=st.sampleEvidence;
  if(frame?.data.session!==proof.session)throw Error('PREVIEW_DOCUMENT_CHANGED');
  const result=await broker.rpc(st.tabId,0,'TOOL',{tool:'verifyRecords',args:{session:proof.session,records:proof.groups.flatMap(group=>group.items.map(record=>({kind:'inspect',record,selection:true})))}});
  if(!result?.verified)throw Error('SOURCE_TARGET_CHANGED');
  return;
 }
 if(!st.plan?.operations.some(op=>op.type==='replaceColor'))return guard(st);const o=await snapshot(st);for(const old of st.binding||[]){const now=o.frames.find(f=>f.frameId===old.frameId&&f.ok);if(!now||now.data.session!==old.session)throw Error('PREVIEW_DOCUMENT_CHANGED');}if(st.plan&&!st.planTargets?.length)throw Error('SOURCE_TARGET_CHANGED');}
function abstractReview(feedback){
 const counts=(feedback||[]).flatMap(f=>f.operations||[]).find(op=>op.abstracts)?.abstracts;
 if(!counts)return '';
 const parts=['本页 '+counts.total+' 条','已显示完整摘要 '+counts.shown+' 条'];
 if(counts.unavailable)parts.push('PubMed 未收录 '+counts.unavailable+' 条');
 if(counts.failed)parts.push('未能核实 '+counts.failed+' 条');
 return parts.join(' · ');
}
function feedbackNotice(feedback){const missing=(feedback||[]).reduce((n,f)=>n+(f.operations||[]).filter(op=>op.matches===0).length,0),conflicts=(feedback||[]).reduce((n,f)=>n+(f.conflicts||[]).length,0);if(missing)return '有 '+missing+' 项目标未匹配，预览未全部完成且不能保存；请重新选择目标或调整要求。';if(conflicts||!(feedback||[]).every(f=>f.verified))return '页面发生变化，预览未全部完成且不能保存；请检查目标后重试。';return abstractReview(feedback)||'已在原网页临时预览；继续在这里提出修改，满意后保存。';}
async function preview(st,plan,history=true,requestBinding=null){st.pendingSave=null;const old=st.plan;if(history)st.undo.push(old);try{let sessions=await bind(st),guards=null;if(requestBinding){const source=requestBinding.sources.find(s=>s.tabId===st.tabId&&s.url===st.url);if(!source)throw Error('SOURCE_CLOSED_OR_NAVIGATED');for(const f of source.frames)if(sessions[f.frameId]!==f.session)throw Error('SOURCE_DOCUMENT_CHANGED');sessions=Object.fromEntries(source.frames.map(f=>[f.frameId,f.session]));guards=Object.fromEntries(source.frames.map(f=>[f.frameId,f.guard]));}st.feedback=await broker.action(st.tabId,st.url,S.validate(plan),sessions,'preview',guards);st.automaticModuleView=false;st.plan=plan;st.preview=true;st.saved=false;await bind(st);await capturePlanTargets(st);await captureSampleEvidence(st).catch(()=>{st.sampleEvidence=null;});st.layoutReview=null;
 if(st.adjustmentMode==='display'&&st.feedback.every(f=>f.verified)){
  const layout=await broker.rpc(st.tabId,0,'READING_LAYOUT').catch(()=>null);
  const body=layout?.regions?.find(r=>r.role==='content'),figures=layout?.regions?.find(r=>r.role==='figures');
  const width=st.feedback.find(f=>f.frameId===0)?.textWidth;
  const text=width?(width.before===width.after?'正文宽度未变 · '+width.after+' px':'正文 '+width.before+' → '+width.after+' px'):body?.visible?'正文容器 '+body.width+' px':'';
  if(text)st.layoutReview={plan,label:text+(figures?' · '+figures.visibleCount+' 张图可见':'')};
 }
 const abstracts=abstractReview(st.feedback);if(abstracts)st.layoutReview={plan,label:abstracts};
 st.selectionRebase=true;st.notice=feedbackNotice(st.feedback);publish(st);return view(st);}catch(e){if(history)st.undo.pop();if(/^(SOURCE_|DOCUMENT_CHANGED|SELECTION_STALE)/.test(e.message)){st.plan=st.saved?old:null;st.preview=false;st.feedback=null;st.undo=[];publish(st);}else if(old){await broker.action(st.tabId,st.url,old,await bind(st),'preview').then(async()=>{if(old.operations.some(op=>op.type==='outline'&&op.extraction))await bind(st);}).catch(()=>{});}throw e;}}
function merge(previous,operations){const ops=S.clone(previous?.operations||[]);for(const op of operations){const key=JSON.stringify(op.target),i=ops.findIndex(x=>x.type===op.type&&JSON.stringify(x.target)===key);if(i>=0)ops[i]=op.type==='style'?{...op,styles:{...ops[i].styles,...op.styles}}:op;else ops.push(op);}return ops;}

async function syncCurrentReadingModule(st){
 if(st.plan||!g.BrevessReadingModulesController)return;
 const url=st.url,epoch=st.epoch,key=st.documentKey||'';
 const current=await broker.rpc(st.tabId,0,'READING_SNAPSHOT');
 if(!current?.reading?.moduleIds?.length||current.reading.outlineDefault)return;
 const store=await g.BrevessReadingModulesController.repo.read();
 const entry=store.entries.find(e=>e.enabled&&!e.builtinId&&current.reading.moduleIds.includes(e.module.id)&&e.module.rules.operations.length&&g.WFGReadingModules.matches(e.module,url));
 if(!entry)return;
 const module=entry.module,plan=S.validate({schemaVersion:2,id:module.id,revision:module.revision,name:module.name,scope:await S.scope(url),operations:module.rules.operations});
 await snapshot(st);
 if(st.plan||st.url!==url||st.epoch!==epoch||(st.documentKey||'')!==key)return;
 st.plan=plan;st.saved=true;st.preview=!current.reading.originalView&&['applied','partial'].includes(current.reading.phase);st.automaticModuleView=true;st.readingViewSession=current.session;st.readingModuleId=module.id;
 st.scopeLabel=g.WFGGeneralization.scopeLabel(module);
 await bind(st);await capturePlanTargets(st);
}
async function toggleAutomaticFilter(st){
 await snapshot(st);
 const current=await broker.rpc(st.tabId,0,'READING_VIEW',{session:st.readingViewSession,original:st.preview});
 st.preview=!current.reading.originalView&&['applied','partial'].includes(current.reading.phase);
 st.notice=st.preview?'':current.reading.originalView?'':(current.reading.notices||[]).map(n=>n.message).join('；');
 await bind(st);publish(st);return view(st);
}
async function prepareFilterSave(st, scopeUrl, similar=false){
 if(st.busy)throw Error('QUESTION_RUNNING');
 if(!st.plan||!st.preview)throw Error('PREVIEW_FIRST');
 await guard(st);
 if(!st.feedback?.length||!st.feedback.every(r=>r.verified))throw Error('PREVIEW_NOT_VERIFIED');
 const baseUrl=new URL(st.url), selectedUrl=new URL(scopeUrl || baseUrl.origin+baseUrl.pathname);
 if(selectedUrl.pathname!==baseUrl.pathname)throw Error('GENERALIZE_TWO_PAGES_REQUIRED');
 if(selectedUrl.origin!==baseUrl.origin||selectedUrl.username||selectedUrl.password||selectedUrl.search||selectedUrl.hash||!baseUrl.pathname.startsWith(selectedUrl.pathname)||selectedUrl.pathname.length>200)throw Error('SAVE_SCOPE_INVALID');
 const pending={scopeUrl:selectedUrl.href,token:crypto.randomUUID(),url:st.url,documentKey:st.documentKey||'',epoch:st.epoch,planJSON:JSON.stringify(st.plan)};
 if(g.BrevessReadingModulesController){
  const M=g.WFGReadingModules,repository=g.BrevessReadingModulesController.repo,store=await repository.read();
  const module=await broker.rpc(st.tabId,0,'READING_VALIDATE_PLAN',{plan:st.plan,reusable:false});
  const old=store.entries.find(e=>e.module.id===st.readingModuleId);
  if(old&&['exact','pubmed-results'].includes(old.module.match.pathMode)&&old.module.match.pathPrefixes.includes(baseUrl.pathname)&&(!(module.rules.operations||[]).some(op=>op.extraction)||(old.module.rules.operations||[]).some(op=>op.extraction))){module.id=old.module.id;module.revision=old.module.revision;}
  const extraction=(module.rules.operations||[]).some(op=>op.type==='outline'&&op.extraction);
  if(extraction&&selectedUrl.pathname!==baseUrl.pathname)throw Error('SAVE_SCOPE_EXTRACTION');
  module.match.hosts=[baseUrl.hostname];module.match.pathPrefixes=[selectedUrl.pathname];module.match.pathMode=module.rules.operations.some(op=>op.type==='pubmedAbstracts')?'pubmed-results':'exact';const identity=g.WFGReadingModules.pageQuery(st.url);if(identity)module.match.queryEquals=identity;else delete module.match.queryEquals;M.validate(module);
  if(similar){
   const prefix=new URL('.',baseUrl).pathname;
   if(extraction||prefix==='/'||!module.rules.required.length||!module.rules.roots.length||
      module.rules.operations.some(op=>!['style','hide','replaceColor'].includes(op.type)||op.target.frame!=='top'||op.target.roots.length||/:(?:nth-|first-|last-)/i.test(op.target.selector)))throw Error('GENERALIZE_STRUCTURE_REQUIRED');
   const candidates=(await b.tabs.query({windowId:st.windowId})).filter(t=>{
    if(!S.permitted(t.url))return false;const u=new URL(t.url);
    return u.origin===baseUrl.origin&&u.pathname!==baseUrl.pathname&&new URL('.',u).pathname===prefix;
   });
   module.match.pathPrefixes=[prefix];module.match.pathMode='any';delete module.match.queryEquals;
   let peer=null;
   for(const tab of candidates.slice(0,6)){
    try{
     await ensure(tab);
     const check=await broker.rpc(tab.id,0,'READING_VALIDATE_MODULE',{module});
     if(check?.verified&&(await b.tabs.get(tab.id)).url===tab.url){peer=tab;break;}
    }catch{/* Try another open paper from the same section. */}
   }
   if(!peer)throw Error('未找到第二篇结构匹配的已打开论文。可先保存到当前网页。');
   pending.peer={id:peer.id,url:peer.url};pending.scopeUrl=new URL(prefix,baseUrl).href;
   const prior=store.entries.find(e=>!e.builtinId&&M.matchKey(e.module.match)===M.matchKey(module.match)&&e.module.name===module.name);
   if(prior){module.id=prior.module.id;module.revision=prior.module.revision;}
   else if(old?.module.id===module.id){module.id='reading-'+crypto.randomUUID();module.revision=0;}
  }
  pending.kind='module';pending.value=module;pending.generation=store.generation;
  pending.competing=store.entries.filter(e=>e.enabled&&!e.builtinId&&e.module.id!==module.id&&e.module.rules.kind==='extract'&&e.module.rules.pageType===module.rules.pageType&&((module.rules.operations||[]).some(op=>op.extraction)?M.matches(e.module,st.url):M.matchKey(e.module.match)===M.matchKey(module.match))).map(e=>e.module.id);
  pending.scopeLabel=(module.rules.operations||[]).some(op=>op.type==='outline'&&op.extraction)?module.match.hosts.join(', ')+' · 路径 '+new URL(st.url).pathname+'（查询参数可变），匹配已核验条目结构':module.match.pathMode==='pubmed-results'?'PubMed 检索结果页（更换检索式、翻页）':module.match.hosts.join(', ')+' · 同类正文结构';
 }else{
  const u=new URL(st.url),pubmed=u.origin==='https://pubmed.ncbi.nlm.nih.gov'&&u.pathname==='/'&&(u.searchParams.has('term')||u.searchParams.has('page'));
  const plan=S.validate({...st.plan,scope:await S.scope(st.url,pubmed?'pubmed-results':'route')}),store=await repo.read();
  pending.kind='recipe';pending.value=plan;pending.generation=store.generation;pending.competing=[];
  for(const e of store.entries)if(e.plan.id!==plan.id&&e.enabled&&e.autoApply&&await S.matches(e.plan.scope,st.url))pending.competing.push(e.plan.id);
  pending.scopeLabel=pubmed?'PubMed 检索结果页（更换检索式、翻页）':'同站点 '+u.pathname+'（查询参数变化时）';
 }
 await guard(st);
 if(st.epoch!==pending.epoch||st.url!==pending.url||(st.documentKey||'')!==pending.documentKey||JSON.stringify(st.plan)!==pending.planJSON||!st.preview)throw Error('SAVE_CONFIRMATION_EXPIRED');
 if(pending.kind==='recipe'&&pending.value.scope.mode!=='pubmed-results'){pending.value.scope=await S.scope(g.WFGReadingModules.pageQuery(st.url)?st.url:selectedUrl.href,g.WFGReadingModules.pageQuery(st.url)?'exact':'route',selectedUrl.pathname);S.validate(pending.value);}
 pending.scopeLabel=pending.value.match?g.WFGGeneralization.scopeLabel(pending.value):pending.value.scope.mode==='pubmed-results'?pending.scopeLabel:'当前网页路径 '+selectedUrl.pathname+'（查询参数可变，不包含其他路径）';
 st.pendingSave=pending;publish(st);return view(st);
}
async function commitFilterSave(st,token){
 const pending=st.pendingSave;
 if(!pending||!token||token!==pending.token||st.busy||pending.epoch!==st.epoch||pending.url!==st.url||pending.documentKey!==(st.documentKey||'')||pending.planJSON!==JSON.stringify(st.plan))throw Error('SAVE_CONFIRMATION_EXPIRED');
 if(!st.preview)throw Error('PREVIEW_FIRST');
 await guard(st);
 if(!st.feedback?.length||!st.feedback.every(r=>r.verified))throw Error('PREVIEW_NOT_VERIFIED');
 if(st.pendingSave!==pending||pending.epoch!==st.epoch||pending.url!==st.url||pending.documentKey!==(st.documentKey||''))throw Error('SAVE_CONFIRMATION_EXPIRED');
 if(pending.peer){
  const peer=await b.tabs.get(pending.peer.id);
  if(peer.url!==pending.peer.url||!(await broker.rpc(peer.id,0,'READING_VALIDATE_MODULE',{module:pending.value})).verified)throw Error('GENERALIZE_SAMPLE_CHANGED');
  await assertStateCurrent(st);
  if(st.pendingSave!==pending)throw Error('SAVE_CONFIRMATION_EXPIRED');
 }
 st.pendingSave=null;
 if(pending.value.match){
  await g.BrevessReadingModulesController.repo.activate(pending.value,pending.generation,pending.competing);
  st.readingModuleId=pending.value.id;
 }else{
  const saved=await repo.activate(pending.value,pending.generation,pending.competing);
  st.plan=saved.entries.find(x=>x.plan.id===pending.value.id).plan;
 }
 st.saved=true;st.scopeLabel=pending.scopeLabel;st.notice='已保存到本地，将自动套用于'+pending.scopeLabel+'。';
 const result=await leaveDisplay(st);
 if(pending.value.match)await refreshSavedScripts(url=>g.WFGReadingModules.matches(pending.value,url),false);
 return result;
}
async function confirmPendingFilterSave(st,question){
 const explicit=String(question||'').trim().replace(/[。！!！]$/u,'');
 if(!st.pendingSave||!['确认保存','确认自动套用','确认保存并自动套用','确认保存到本地并自动套用'].includes(explicit))return null;
 return commitFilterSave(st,st.pendingSave.token);
}

async function leaveDisplay(st){
 // Leaving a window-wide filter task clears every sample's editing UI.
 if(generalization.summary(st.windowId)?.busy)throw Error('GENERALIZE_BUSY');
 const participants=[...states.values()].filter(other=>other===st||other.windowId===st.windowId&&other.adjusting);
 await generalization.cancel(st.windowId);
 for(const page of participants){
  page.adjusting=false;page.epoch++;abandonPending(page);multi.cancel?.(page.runOwner,page.tabId);page.busy=false;
  const frames=(await snapshot(page).catch(()=>({frames:[]}))).frames.filter(f=>f.ok);
  for(const f of frames)await broker.rpc(page.tabId,f.frameId,'UX_CLEAR').catch(()=>{});
  if(page.plan&&!page.saved){await broker.allUndo(page.tabId);page.plan=null;page.preview=false;page.feedback=null;}
  page.pendingSave=null;page.targets=[];page.referenceIds=[];page.sourceIds=[page.tabId];page.selectionRebase=false;
  page.undo=[];if(!page.saved)page.planTargets=[];page.sampleEvidence=null;page.displayConversation=[];page.outlineFailure=null;page.lastDisplayRequest='';page.notice='';
  await bind(page).catch(()=>{});publish(page);
 }
 return view(st);
}
async function savedScripts(st){
 const url=st.url;
 const modules=await g.BrevessReadingModulesController.repo.read(),legacy=await repo.read();
 const scripts=modules.entries.map(e=>({kind:'module',builtin:Boolean(e.builtinId),id:e.module.id,name:e.module.name,
  version:e.module.revision,scope:g.WFGGeneralization.scopeLabel(e.module),enabled:e.enabled,matches:g.WFGReadingModules.matches(e.module,url),generation:modules.generation}));
 for(const e of legacy.entries)scripts.push({kind:'recipe',id:e.plan.id,name:e.plan.name,version:e.plan.revision,
  scope:e.plan.scope.origin+e.plan.scope.path,enabled:e.enabled&&e.autoApply,matches:await S.matches(e.plan.scope,url),generation:legacy.generation});
 if(st.preview && !st.saved && st.plan){
  scripts.unshift({kind:'preview',id:st.plan.id,name:st.plan.name,version:st.plan.revision,
   matches:true,enabled:true,documentKey:st.documentKey,scope:S.safeURL(url)});
 }
 return scripts;
}
async function refreshSavedScripts(matches,replaceSavedPreview,refreshDraftConfig=false){
 const tabs=await b.tabs.query({});
 await Promise.all(tabs.map(async tab=>{
  if(!S.permitted(tab.url)||!await matches(tab.url))return;
  const current=states.get(tab.id);
  try{
   if(current?.busy||current?.plan&&!current.saved){
    if(refreshDraftConfig)await broker.rpc(tab.id,0,'READING_REFRESH_CONFIG');
    return;
   }
   if(current?.saved&&!replaceSavedPreview&&current.preview)return;
   await broker.rpc(tab.id,0,'READING_RELOAD');
  }catch{/* New or discarded documents read configuration on first load. */}
 }));
}
async function handle(m,sender){await generalization.ready;const content=sender.id===b.runtime.id&&sender.tab&&Number.isInteger(sender.frameId);let st,ctx;
if(content){if(!['AUTO','DIRECT','PAGE_CHANGED','OUTLINE_CHANGED'].includes(m.command))throw Error('PANEL_REQUIRED');const frame=(await b.webNavigation.getAllFrames({tabId:sender.tab.id})||[]).find(f=>f.frameId===sender.frameId);if(!frame||frame.url!==sender.url||(m.command==='AUTO'&&sender.frameId!==0))throw Error('PAGE_CHANGED');st=await state(await b.tabs.get(sender.tab.id));}
else{ctx=await panel(sender);if(ctx.windowId<0){if(!Number.isInteger(m.windowId)||m.windowId<0)throw Error('PANEL_WINDOW_REQUIRED');await b.windows.get(m.windowId);ctx={...ctx,windowId:m.windowId};}const tabs=await b.tabs.query({active:true,windowId:ctx.windowId});st=await state(tabs[0]);}
if(!content&&m.expectedContext){const expected=m.expectedContext;await assertStateCurrent(st);if(expected.tabId!==st.tabId||expected.navigationUrl!==st.url||expected.documentKey!==st.documentKey)throw Error('PAGE_CHANGED');}
if(m.command==='APPLY_VERSION'){
 if(st.busy)throw Error('QUESTION_RUNNING');
 const history=await multi.handle({type:'WFG_RESEARCH',command:'HISTORY',tabIds:st.sourceIds},sender);
 const turn=history.items.find(t=>t.turnId===m.turnId&&t.status==='complete'&&t.displayPlan);
 if(!turn||!await S.matches(turn.displayPlan.scope,st.url))throw Error('PAGE_CHANGED');
 await assertStateCurrent(st);if(st.busy||!(await b.tabs.get(st.tabId)).active)throw Error('PAGE_CHANGED');st.adjusting=true;st.adjustmentMode='display';
 return preview(st,turn.displayPlan);
}
if(m.command==='SCRIPTS_LIST')return savedScripts(st);
if(m.command==='SCRIPT_DISMISS_PREVIEW'){
 const plan=st.plan;
 if(st.busy||!st.preview||st.saved||!plan||m.id!==plan.id||m.version!==plan.revision||m.documentKey!==st.documentKey)throw Error('PAGE_CHANGED');
 await handle({command:'CANCEL',windowId:st.windowId,expectedContext:{tabId:st.tabId,navigationUrl:st.url,documentKey:st.documentKey}},sender);
 return savedScripts(st);
}
if(m.command==='SCRIPT_ENABLE'||m.command==='SCRIPT_DELETE'){
 const deleting=m.command==='SCRIPT_DELETE';
 if(!deleting&&typeof m.enabled!=='boolean')throw Error('MODULE_FLAGS');
 const controller=g.BrevessReadingModulesController;
 let matches,wasActive;
 if(m.kind==='module'){
  const entry=(await controller.repo.read()).entries.find(e=>e.module.id===m.id);
  if(!entry)throw Error('MODULE_NOT_FOUND');
  wasActive=entry.enabled;
  if(deleting)await controller.repo.remove(entry.module.id,m.generation);
  else await controller.repo.setEnabled(entry.module.id,m.enabled,m.generation);
  matches=url=>g.WFGReadingModules.matches(entry.module,url);
 }else if(m.kind==='recipe'){
  const entry=(await repo.read()).entries.find(e=>e.plan.id===m.id);
  if(!entry)throw Error('TEMPLATE_NOT_FOUND');
  wasActive=entry.enabled&&entry.autoApply;
  if(deleting)await repo.remove(entry.plan.id,m.generation);
  else if(m.enabled)await repo.activate(entry.plan,m.generation);
  else await repo.disable(entry.plan.id,m.generation);
  matches=url=>S.matches(entry.plan.scope,url);
 }else throw Error('MODULE_NOT_FOUND');
 if(!deleting||wasActive)await refreshSavedScripts(matches,true,deleting&&m.kind==='module');
 return savedScripts(st);
}
if(m.command.startsWith('GENERALIZE_')){
 if(content)throw Error('PANEL_REQUIRED');
 if(m.command==='GENERALIZE_PREVIEW'){
 if(!st.adjusting||st.targets.some(t=>t.frameId!==0))throw Error('GENERALIZE_SELECT_REQUIRED');
 if(generalization.summary(st.windowId)?.wholePage){
  if(st.busy)throw Error('QUESTION_RUNNING');
  const initialPlan=st.plan;
  if(initialPlan){if(!st.saved||!st.automaticModuleView)throw Error('GENERALIZE_REPLACE_PREVIEW');await guardFollowup(st);}
  const epoch=st.epoch,{plan,structure}=await generalization.wholePagePlan(st.windowId,st.url);
  const o=await snapshot(st),frame=o.frames.find(f=>f.frameId===0&&f.ok);
  const proof=await broker.rpc(st.tabId,0,'TOOL',{tool:'planTargets',args:{session:frame.data.session,targets:plan.operations.map(op=>op.target)}});
  const checked=await broker.rpc(st.tabId,0,'READING_VALIDATE_PLAN',{plan});
  if(!checked?.rules||!structure.roots.some(s=>checked.rules.roots.includes(s))||proof.groups?.length!==plan.operations.length||proof.groups.some(g=>!g.ids.length))throw Error('GENERALIZE_TARGET_MISMATCH');
  await assertStateCurrent(st);
  if(st.epoch!==epoch||!st.adjusting||st.plan!==initialPlan||st.busy||(initialPlan&&(!st.saved||!st.automaticModuleView)))throw Error('PAGE_CHANGED');
  return preview(st,plan,true,{sources:[{tabId:st.tabId,url:st.url,frames:[{frameId:0,session:frame.data.session,guard:{session:frame.data.session,version:proof.version,allowRefresh:true,records:proof.groups.flatMap(group=>group.items.map(record=>({kind:'inspect',record,selection:true})))}}]}]});
 }
 if(!st.targets.length)throw Error('GENERALIZE_SELECT_REQUIRED');
 if(st.busy)throw Error('QUESTION_RUNNING');
 const effect=await generalization.effect(st.windowId);
 if(st.plan)throw Error('GENERALIZE_REPLACE_PREVIEW');
 const records=st.targets.map(t=>({kind:'inspect',record:t,selection:true}));
 for(const t of st.targets){const proof=await broker.rpc(st.tabId,0,'TOOL',{tool:'verifyRecords',args:{session:t.session,records:[records[st.targets.indexOf(t)]]}});if(!proof?.verified)throw Error('SOURCE_TARGET_CHANGED');}
 const selectors=[...new Set(st.targets.map(t=>(t.sameKind&&t.similarTarget||t.target).selector))];
 let target={frame:'top',roots:[],selector:selectors.join(', ')};
 // A model may hide the outer bar while a person clicks its visually identical
 // inner wrapper. Reuse that ancestor only after a fresh, unique, related hit.
 if(effect.singleTarget&&st.targets.length===1&&!st.targets[0].sameKind){
   try {const proof=await broker.rpc(st.tabId,0,'TOOL',{tool:'planTargets',args:{session:st.targets[0].session,targets:[effect.verifiedTarget],selectedIds:[st.targets[0].id]}});
     if(proof.groups?.length===1&&proof.groups[0].ids.length===1&&proof.groups[0].selectionRelated===true)target=effect.verifiedTarget;
   }catch{/* A page-specific selector falls back to the user's explicit selection. */}
 }
 return preview(st,S.validate({schemaVersion:2,id:crypto.randomUUID(),revision:0,name:effect.name,scope:await S.scope(st.url),operations:effect.operations.map(op=>({...op,target}))}));
 }
 else if(m.command==='GENERALIZE_ADD'){if(!st.sampleEvidence)throw Error('PREVIEW_DOCUMENT_CHANGED');await generalization.add(st);}
 else if(m.command==='GENERALIZE_GENERATE')await generalization.generate(st.windowId,m.profileId||'');
 else if(m.command==='GENERALIZE_SAVE')await generalization.save(st.windowId,m.token);
 else if(m.command==='GENERALIZE_REMOVE')await generalization.remove(st.windowId,m.tabId);
 else if(m.command==='GENERALIZE_CANCEL')await generalization.cancel(st.windowId);
 else throw Error('COMMAND_INVALID');
 publish(st);return view(st);
}
if(m.command==='MODE'){if(typeof m.active!=='boolean'||m.mode!==undefined&&!['display','outline'].includes(m.mode))throw Error('DISPLAY_MODE_INVALID');if(!m.active)return leaveDisplay(st);const mode=m.mode||'display';if(!st.adjusting||st.adjustmentMode!==mode){st.adjusting=true;st.adjustmentMode=mode;st.epoch++;abandonPending(st);multi.cancel?.(st.runOwner,st.tabId);st.notice=mode==='outline'?'正在调整插件大纲：描述条目、字段和层级；原网页保持不变。':'正在调整显示：点选元素，或在下方描述修改。';publish(st);}return view(st);}
if(['PICK','FINISH_PICK','TARGETS','LOCATE_TARGET','DIRECT'].includes(m.command)&&!st.adjusting)throw Error('DISPLAY_MODE_REQUIRED');
if(m.command==='OUTLINE_CHANGED'){try{const r=await broker.rpc(st.tabId,0,'READING_SNAPSHOT');st.reading=r.reading;st.hasAuxiliarySources=!!r.auxiliarySources?.some(x=>x.complete&&x.status==='available');st.readingNotice=(r.reading?.notices||[]).filter(n=>n.code!=='ORIGINAL_VIEW').map(n=>n.message).join('；');}catch{}publish(st);return true;}
if(m.command==='OUTLINE'){if(!st.plan||!st.preview||st.automaticModuleView){await ensure(await b.tabs.get(st.tabId));const result=await broker.rpc(st.tabId,0,'READING_SNAPSHOT').catch(()=>({groups:[]}));const detected=await broker.rpc(st.tabId,0,'UX_OUTLINE').catch(()=>null);const search=detected?.searchResults?detected:!result.groups?.length?detected:null;const outline=search||result;return {tabId:st.tabId,temporary:false,provider:search?'search-default':'reading-module',reading:result.reading,currentId:result.currentId,frames:outline.groups?.length?[{tabId:st.tabId,frameId:0,url:(await b.tabs.get(st.tabId)).url,...outline}]:[]};}const frames=[];for(const f of (await snapshot(st)).frames.filter(f=>f.ok)){const result=await broker.rpc(st.tabId,f.frameId,'UX_OUTLINE');frames.push({tabId:st.tabId,frameId:f.frameId,url:f.url,...result});}return {tabId:st.tabId,temporary:true,frames};}
if(m.command==='LOCATE_OUTLINE'){if(m.ref?.tabId!==st.tabId)throw Error('OUTLINE_PAGE_CHANGED');if(String(m.ref.id).startsWith('reading:')){if(st.preview&&st.plan&&!st.automaticModuleView)throw Error('OUTLINE_PAGE_CHANGED');return broker.rpc(st.tabId,m.ref.frameId,'READING_LOCATE',{ref:m.ref});}if(String(m.ref.id).startsWith('search:')){if(st.preview&&st.plan&&!st.automaticModuleView)throw Error('OUTLINE_PAGE_CHANGED');return broker.rpc(st.tabId,m.ref.frameId,'UX_OUTLINE_LOCATE',{ref:m.ref});}if(!st.preview||!st.plan)throw Error('OUTLINE_PAGE_CHANGED');return broker.rpc(st.tabId,m.ref.frameId,'UX_OUTLINE_LOCATE',{ref:m.ref});}
if(m.command==='SWITCH_TAB'){if(st.busy||generalization.summary(st.windowId)?.busy)throw Error('QUESTION_RUNNING');const tab=await b.tabs.get(m.tabId);if(tab.windowId!==ctx.windowId||!S.permitted(tab.url))throw Error('SOURCE_NOT_IN_WINDOW');const next=await state(tab);next.adjusting=true;next.adjustmentMode='display';await ensure(tab);await b.tabs.update(tab.id,{active:true});return {switchedTabId:tab.id};}
if(m.command==='STATE'){const draft=generalization.summary(st.windowId);if(draft&&!draft.saved){st.adjusting=true;st.adjustmentMode='display';}await ensure(await b.tabs.get(st.tabId));if(st.adjusting&&st.targets.length)for(const f of (await snapshot(st)).frames.filter(f=>f.ok))await broker.rpc(st.tabId,f.frameId,'UX_TARGETS',{targets:st.targets.filter(t=>t.frameId===f.frameId)}).catch(()=>{});await syncCurrentReadingModule(st);await assertStateCurrent(st);return view(st);}
if(m.command==='LIST'){return (await b.tabs.query({windowId:ctx.windowId})).filter(t=>S.permitted(t.url)).map(t=>({id:t.id,title:t.title,url:S.safeURL(t.url),active:t.id===st.tabId}));}
if(m.command==='SOURCES'){if(!Array.isArray(m.tabIds)||m.tabIds.length>6||!m.tabIds.includes(st.tabId)||new Set(m.tabIds).size!==m.tabIds.length)throw Error('SOURCES_INVALID');for(const id of m.tabIds){const t=await b.tabs.get(id);if(t.windowId!==ctx.windowId||!S.permitted(t.url))throw Error('SOURCE_NOT_IN_WINDOW');}if(JSON.stringify(st.sourceIds)!==JSON.stringify(m.tabIds)){st.outlineFailure=null;st.displayConversation=[];st.pendingSave=null;}st.sourceIds=m.tabIds;st.referenceIds=(st.adjusting?(m.referenceIds||[]):[]).filter(id=>st.sourceIds.includes(id)&&id!==st.tabId);st.epoch++;abandonPending(st);multi.cancel?.(st.runOwner,st.tabId);publish(st);return view(st);}
if(m.command==='PICK'){const seq=st.epoch;await ensure(await b.tabs.get(st.tabId));const frames=(await snapshot(st)).frames.filter(f=>f.ok);let selected;try{selected=await Promise.any(frames.map(async f=>({frameId:f.frameId,items:await broker.rpc(st.tabId,f.frameId,'UX_PICK')})));}catch{throw Error('SELECTION_CANCELLED');}finally{if(seq===st.epoch)for(const f of frames)if(f.frameId!==selected?.frameId)void broker.rpc(st.tabId,f.frameId,'UX_CLEAR').catch(()=>{});}if(seq!==st.epoch||!st.adjusting)throw Error('SELECTION_CANCELLED');st.targets=selected.items.map(x=>({...x,tabId:st.tabId,frameId:selected.frameId,sourceTitle:st.title}));st.selectionRebase=false;await bind(st);publish(st);return view(st);}
if(m.command==='FINISH_PICK'||m.command==='CANCEL_PICK'){const fs=(await snapshot(st)).frames.filter(f=>f.ok);const results=await Promise.all(fs.map(f=>broker.rpc(st.tabId,f.frameId,m.command==='FINISH_PICK'?'UX_FINISH_PICK':'UX_CLEAR').catch(()=>false)));if(m.command==='FINISH_PICK'&&!results.some(Boolean))throw Error('请先在网页选择元素');return true;}
if(m.command==='EDIT_FILTER'){
 if(st.busy)throw Error('QUESTION_RUNNING');
 if(m.basePlan!==JSON.stringify(st.plan||null))throw Error('滤镜已更新，请重新打开后编辑');
 const u=new URL(st.url),scope=new URL(m.scopeUrl);
 if(scope.origin!==u.origin||scope.username||scope.password||scope.search||scope.hash||!u.pathname.startsWith(scope.pathname))throw Error('SAVE_SCOPE_INVALID');
 if(typeof m.raw!=='string'||m.raw.length>64000)throw Error('PLAN_TOO_LARGE');
 const parsed=JSON.parse(m.raw);
 const source=parsed?.module?g.WFGReadingModules.imported(m.raw):parsed;
 if(source.rules)g.WFGReadingModules.validate(source);
 else if(source.schemaVersion)S.validate(source);
 else if(Object.keys(source).some(key=>key!=='operations'))throw Error('UNKNOWN_OR_INVALID_FIELDS');
 const plan=S.validate({schemaVersion:2,id:st.plan?.id||crypto.randomUUID(),revision:st.plan?.revision||0,name:source.name||st.plan?.name||'网页滤镜',scope:await S.scope(st.url),operations:source.rules?.operations||source.operations});
 await assertStateCurrent(st);st.adjusting=true;st.adjustmentMode='display';
 await preview(st,plan);await prepareFilterSave(st,m.scopeUrl);
 return commitFilterSave(st,st.pendingSave.token);
}
if(m.command==='IMPORT_MODULE'){st.adjusting=true;st.adjustmentMode='display';const M=g.WFGReadingModules,module=M.imported(m.raw),repo=g.BrevessReadingModulesController.repo,store=await repo.read();const saved=await repo.save(module,store.generation,{enabled:false}),entry=saved.entries.find(e=>e.module.id===module.id);if(module.rules.operations.length){const plan=S.validate({schemaVersion:2,id:crypto.randomUUID(),revision:0,name:module.name,scope:await S.scope(st.url),operations:module.rules.operations});await preview(st,plan);st.readingModuleId=entry.module.id;st.notice='已导入阅读模块，当前仅预览；保存后启用。';}else st.notice='已导入阅读模块，默认停用；可在设置的阅读偏好中检查后启用。';publish(st);return view(st);}
if(m.command==='EXPORT'&&st.readingModuleId){const s=await g.BrevessReadingModulesController.repo.read(),e=s.entries.find(e=>e.module.id===st.readingModuleId);if(!e)throw Error('MODULE_NOT_FOUND');return {raw:g.WFGReadingModules.exported(e.module),id:e.module.id};}
if(m.command==='EXPORT'){if(!st.plan)throw Error('NO_FILTER');return {raw:S.exported(st.plan),id:st.plan.id};}
if(m.command==='IMPORT'){st.adjusting=true;const store=await repo.read(),saved=await repo.import(m.raw,store.generation),entry=saved.entries.at(-1);await preview(st,entry.plan);st.notice='已导入停用的新滤镜；预览后可保存，适用范围保持原设置。';publish(st);return view(st);}
if(m.command==='TARGETS'){if(!Array.isArray(m.targets))throw Error('TARGETS_INVALID');st.targets=m.targets.map(t=>{const old=st.targets.find(x=>x.id===t.id&&x.session===t.session);if(!old)throw Error('TARGET_UNKNOWN');return {...old,sameKind:!!t.sameKind};});for(const f of (await snapshot(st)).frames.filter(f=>f.ok))await broker.rpc(st.tabId,f.frameId,'UX_TARGETS',{targets:st.targets.filter(t=>t.frameId===f.frameId)});publish(st);return view(st);}
if(m.command==='LOCATE_TARGET'){const t=st.targets.find(t=>t.id===m.id);if(!t)throw Error('TARGET_UNKNOWN');await broker.rpc(st.tabId,t.frameId,'UX_LOCATE',{target:t.target});return true;}
if(m.command==='RUN'){const confirmed=await confirmPendingFilterSave(st,m.question);if(confirmed)return confirmed;st.pendingSave=null;const route=g.WFGUXContext.route({...st,question:m.question,contextScope:m.contextScope||{},webSearch:m.webSearch||{mode:'off'}});if(route.kind==='original')throw Error('ORIGINAL_CONTEXT_REQUIRES_NATIVE_FLOW');if(['display','outline'].includes(route.kind))st.adjustmentMode=route.kind;if(st.busy)throw Error('QUESTION_RUNNING');const seq=++st.epoch;st.busy=true;st.notice='';st.runOwner='panel:'+(ctx.contextId||ctx.documentId);publish(st);try{if(st.adjusting&&(st.plan||st.selectionRebase)){await guardFollowup(st);if(st.selectionRebase&&st.targets.length)await rebaseSelectedAfterOwnEdit(st);}const result=await multi.handle({type:'WFG_RESEARCH',command:'ASK',mode:'configured',question:m.question,profileId:m.profileId||'',tabIds:st.sourceIds,attachments:m.attachments||[],...(['display','outline'].includes(route.kind)?{unified:{mode:route.kind==='outline'?'outline':'display',targetTabId:st.tabId,targets:st.targets,previous:st.plan,previousTargets:st.planTargets||[],conversation:st.displayConversation||[],feedback:st.outlineFailure?{previousPreview:st.feedback,failedPreview:st.outlineFailure}:st.feedback,referenceIds:st.referenceIds,attachments:m.attachments||[]}}:{})},sender,progress=>{
      if(seq!==st.epoch||states.get(st.tabId)!==st)return;
      const turn={...progress.turn,status:'pending'};
      if(!st.turns.some(t=>t.turnId===turn.turnId)){st.turns.push(turn);st.turns=st.turns.slice(-20);publish(st);}
      void b.runtime.sendMessage({type:'WFG_UX_PROGRESS',tabId:st.tabId,url:S.safeURL(st.url),navigationUrl:st.url,documentKey:st.documentKey,turnId:turn.turnId,event:progress.event}).catch(()=>{});
    });if(seq!==st.epoch)throw Error('QUESTION_CANCELLED');if(['display','outline'].includes(route.kind)){st.displayConversation=[...(st.displayConversation||[]),{question:String(m.question||'').slice(0,1000),answer:String(result.turn.answer||'').slice(0,1000)}].slice(-6);}st.turns=st.turns.filter(t=>t.turnId!==result.turn.turnId);st.turns.push(result.turn);st.turns=st.turns.slice(-20);if(result.plan){try{await preview(st,result.plan,true,result.binding);const review=st.layoutReview?.label||feedbackNotice(st.feedback);
    result.turn.displayReview=review;
    await multi.recordDisplayReview?.(st.runOwner,result.turn,review).catch(()=>{});
    st.lastDisplayRequest=String(m.question||'').slice(0,2000);st.outlineFailure=null;}catch(error){
  const outline=route.kind==='outline'&&result.plan.operations.some(op=>op.type==='outline'&&op.extraction);
  if(!(seq===st.epoch&&states.get(st.tabId)===st))throw Error('QUESTION_CANCELLED');
  const failed=await multi.recordPreviewFailure(st.runOwner,result.turn,error.message,outline);
  if(!(seq===st.epoch&&states.get(st.tabId)===st))throw Error('QUESTION_CANCELLED');
  st.outlineFailure=outline?{...failed.outcome,proposal:failed.turn.displayProposal}:null;
  st.displayConversation=st.displayConversation.slice(0,-1).concat({question:String(m.question||'').slice(0,1000),answer:failed.outcome.message});
  const failure=Error(failed.persisted?failed.outcome.code:'PREVIEW_OUTCOME_WRITE_FAILED');failure.previewFailureTurn=failed.turn;throw failure;
 }}st.notice=result.plan?feedbackNotice(st.feedback):'回答与引用已保存。';st.busy=false;if(result.saveRequested){await prepareFilterSave(st);}return view(st);}catch(e){if(seq===st.epoch&&states.get(st.tabId)===st){st.notice=e.message;try{const failed=await multi.handle({type:'WFG_RESEARCH',command:'HISTORY',tabIds:st.sourceIds},sender);if(seq===st.epoch&&states.get(st.tabId)===st)st.turns=failed.items.slice(-20);}catch{}if(e.previewFailureTurn&&seq===st.epoch&&states.get(st.tabId)===st){st.turns=st.turns.filter(t=>t.turnId!==e.previewFailureTurn.turnId).concat(e.previewFailureTurn).slice(-20);}}throw e;}finally{if(seq===st.epoch&&states.get(st.tabId)===st){st.busy=false;publish(st);}}}
if(m.command==='RESET_OUTLINE'){
 if(st.busy)throw Error('QUESTION_RUNNING');const remaining=(st.plan?.operations||[]).filter(op=>op.type!=='outline');
 if(remaining.length)return preview(st,{...st.plan,operations:remaining});
 const previous=st.plan;if(previous)st.undo.push(previous);await broker.allUndo(st.tabId);const reading=await broker.rpc(st.tabId,0,'READING_SNAPSHOT');if(reading?.session)await broker.rpc(st.tabId,0,'READING_OUTLINE_DEFAULT',{session:reading.session,active:true});st.plan=null;st.preview=false;st.saved=false;st.feedback=null;st.pendingSave=null;st.notice='已恢复当前页面的默认大纲；已保存规则仍保留，可在阅读偏好管理。';await bind(st);publish(st);return view(st);}
if(m.command==='CANCEL'||m.command==='PAGE_CHANGED'){st.outlineFailure=null;st.pendingSave=null;st.displayConversation=[];st.epoch++;abandonPending(st);multi.cancel?.(st.runOwner,st.tabId);for(const f of (await snapshot(st)).frames.filter(f=>f.ok))await broker.rpc(st.tabId,f.frameId,'UX_CLEAR').catch(()=>{});if(st.plan&&(m.command==='PAGE_CHANGED'||!st.saved))await broker.allUndo(st.tabId);st.plan=null;st.preview=false;st.saved=false;st.automaticModuleView=false;st.readingModuleId=null;st.readingViewSession=null;st.scopeLabel='';st.targets=[];st.selectionRebase=false;st.feedback=null;st.undo=[];st.notice='已取消临时改动并恢复原貌。';await bind(st);publish(st);return view(st);}
if(m.command==='PREPARE_SAVE')return prepareFilterSave(st,m.scopeUrl,m.similar===true);
if(m.command==='CANCEL_SAVE'){st.pendingSave=null;publish(st);return view(st);}
if(m.command==='SAVE')return commitFilterSave(st,m.confirmationToken);
if(m.command==='TOGGLE'){st.pendingSave=null;if(st.automaticModuleView)return toggleAutomaticFilter(st);if(!st.plan)throw Error('NO_PREVIEW');if(!st.preview){const current=await snapshot(st);for(const old of st.binding||[]){const frame=current.frames.find(f=>f.frameId===old.frameId&&f.ok);if(!frame||frame.data.session!==old.session)throw Error('PREVIEW_DOCUMENT_CHANGED');if(frame.data.version!==old.version&&!st.plan.operations.every(op=>op.type==='outline'&&op.placement==='sidebar'))throw Error('PREVIEW_DOCUMENT_CHANGED');}}if(st.preview){await broker.allUndo(st.tabId);if(st.readingViewSession)await broker.rpc(st.tabId,0,'READING_VIEW',{session:st.readingViewSession,original:true});st.preview=false;}else{st.feedback=await broker.action(st.tabId,st.url,st.plan,await bind(st),'preview');st.preview=true;}await bind(st);st.selectionRebase=true;publish(st);return view(st);}
if(m.command==='UNDO'){await guard(st);if(!st.undo.length)throw Error('NOTHING_TO_UNDO');const old=st.undo.pop();if(old)await preview(st,old,false);else{await broker.allUndo(st.tabId);st.plan=null;st.preview=false;await bind(st);st.selectionRebase=true;publish(st);}return view(st);}
if(m.command==='DIRECT'){if(st.busy)throw Error('QUESTION_RUNNING');const o=await snapshot(st),f=o.frames.find(f=>f.frameId===sender.frameId&&f.ok);if(!f||f.data.session!==m.session)throw Error('SELECTION_STALE');if(st.plan)await guard(st);const plan=S.validate({schemaVersion:2,id:st.plan?.id||crypto.randomUUID(),revision:st.plan?.revision||0,name:st.plan?.name||'我的网页布局',scope:await S.scope(st.url),operations:merge(st.plan,m.operations)});st.notice='拖动已成为临时预览，可继续提要求或撤销。';return preview(st,plan);}
if(m.command==='DISABLE'&&st.readingModuleId){const repo=g.BrevessReadingModulesController.repo,s=await repo.read();await repo.setEnabled(st.readingModuleId,false,s.generation);await broker.allUndo(st.tabId);st.plan=null;st.saved=false;st.preview=false;st.readingModuleId=null;st.notice='阅读模块已停用。';await g.BrevessReadingModulesController.notify();await bind(st);publish(st);return view(st);}
if(m.command==='DISABLE'){if(!st.plan)throw Error('NO_TEMPLATE');const store=await repo.read();await repo.disable(st.plan.id,store.generation);await broker.allUndo(st.tabId);st.plan=null;st.saved=false;st.preview=false;st.notice='已停用滤镜并恢复原貌。';await bind(st);publish(st);return view(st);}
if(m.command==='AUTO'){const saved=await repo.read(),matched=[];for(const e of saved.entries)if(e.enabled&&e.autoApply&&await S.matches(e.plan.scope,st.url))matched.push(e);if(matched.length===1){try{await preview(st,matched[0].plan,false);st.saved=true;st.scopeLabel=matched[0].plan.scope.mode==='pubmed-results'?'PubMed 检索结果页（含翻页）':'同站点 '+matched[0].plan.scope.path;if(!st.feedback?.every(r=>r.verified)){await broker.allUndo(st.tabId);st.preview=false;st.notice='已保存滤镜未匹配当前结构，页面已恢复；可继续提要求调整。';await bind(st);}else st.notice='已自动套用：'+matched[0].plan.name;}catch(e){await broker.allUndo(st.tabId);st.preview=false;st.notice='已保存滤镜未能套用：'+e.message;}publish(st);}else if(matched.length>1){st.notice='多个已保存滤镜匹配，本页未自动修改。';publish(st);}publish(st);return view(st);}
if(m.command==='HISTORY'){const epoch=st.epoch;const result=await multi.handle({type:'WFG_RESEARCH',command:'HISTORY',tabIds:st.sourceIds},sender);await assertStateCurrent(st);if(epoch!==st.epoch)throw Error('PAGE_CHANGED');st.turns=result.items.slice(-20);publish(st);return view(st);}
if(m.command==='LOCATE')return multi.handle({...m,type:'WFG_RESEARCH'},sender);
throw Error('COMMAND_INVALID');}
b.runtime.onMessage.addListener((m,s,reply)=>{if(m?.type!=='WFG_UX')return false;handle(m,s).then(data=>reply({ok:true,data}),e=>reply({ok:false,error:e.message}));return true;});
b.tabs.onRemoved.addListener(id=>{void generalization.invalidate(id);const st=states.get(id);if(st){st.epoch++;abandonPending(st);multi.cancel?.(st.runOwner,st.tabId);states.delete(id);}});
b.tabs.onActivated?.addListener(async({tabId,windowId})=>{for(const st of states.values())if(st.tabId!==tabId&&st.windowId===windowId&&st.adjusting){st.epoch++;abandonPending(st);multi.cancel?.(st.runOwner,st.tabId);st.pendingSave=null;for(const f of (await snapshot(st).catch(()=>({frames:[]}))).frames.filter(f=>f.ok))await broker.rpc(st.tabId,f.frameId,'UX_CLEAR').catch(()=>{});publish(st);}});
b.tabs.onUpdated?.addListener((id,c)=>{if(c.status==='loading'||c.url)void generalization.invalidate(id);const st=states.get(id);if(st&&(c.status==='loading'||(c.url&&c.url!==st.url))){st.adjusting=false;st.epoch++;abandonPending(st);multi.cancel?.(st.runOwner,st.tabId);states.delete(id);}});
return {handle,states,legacy:repo};}
g.WFGUX={install};
})(globalThis);
