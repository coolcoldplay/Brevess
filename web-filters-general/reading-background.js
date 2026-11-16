(function(g){'use strict';function install({browser:b,getLegacy=()=>null}){
 const M=g.WFGReadingModules,S=g.WFGSchema,repo=M.repository({readRaw:async()=>(await b.storage.local.get(M.KEY))[M.KEY],writeRaw:s=>b.storage.local.set({[M.KEY]:s})}),queue=g.WFGReadingPubmed.queue(),bindings=new Map();
 function drop(id){const prior=bindings.get(id);if(prior)queue.cancel(prior.owner);bindings.delete(id);}
 async function content(sender){if(sender.id!==b.runtime.id||!sender.tab||sender.frameId!==0)throw Error('READING_CONTENT_REQUIRED');const tab=await b.tabs.get(sender.tab.id),frame=(await b.webNavigation.getAllFrames({tabId:tab.id})||[]).find(f=>f.frameId===0);if(!frame||frame.url!==sender.url||tab.url!==sender.url||!S.permitted(sender.url))throw Error('READING_PAGE_CHANGED');return tab;}
 async function settings(sender){if(sender.id!==b.runtime.id)throw Error('READING_SETTINGS_REQUIRED');const u=new URL(sender.url);if(u.origin!==new URL(b.runtime.getURL('')).origin||u.pathname!=='/options.html')throw Error('READING_SETTINGS_REQUIRED');const contexts=await b.runtime.getContexts({});u.hash='';if(!sender.documentId||!contexts.some(c=>{try{const current=new URL(c.documentUrl);current.hash='';return current.href===u.href&&c.documentId===sender.documentId;}catch{return false;}}))throw Error('READING_SETTINGS_REQUIRED');}
 async function notify(){for(const tab of await b.tabs.query({}))if(S.permitted(tab.url))void b.tabs.sendMessage(tab.id,{type:'WFG_FRAME',command:'READING_RELOAD'},{frameId:0}).catch(()=>{});}
 async function handle(m,s){
  if(['CONFIG','ABSTRACT','CANCEL_ABSTRACTS'].includes(m.command)){
   const tab=await content(s);if(typeof m.session!=='string'||m.session.length>100)throw Error('READING_SESSION_REQUIRED');let bound=bindings.get(tab.id);
   if(m.command==='CONFIG'){if(!bound||bound.url!==s.url||bound.documentId!==s.documentId||bound.session!==m.session){drop(tab.id);bound={url:s.url,documentId:s.documentId,session:m.session,owner:tab.id+':'+crypto.randomUUID()};bindings.set(tab.id,bound);}return repo.read();}
   if(!bound||bound.url!==s.url||bound.documentId!==s.documentId||bound.session!==m.session)throw Error('READING_PAGE_CHANGED');
   if(m.command==='CANCEL_ABSTRACTS'){queue.cancel(bound.owner);return true;}
   const u=new URL(s.url);if(u.origin!=='https://pubmed.ncbi.nlm.nih.gov'||u.pathname!=='/'||!(u.searchParams.has('term')||u.searchParams.has('page')))throw Error('PUBMED_RESULTS_REQUIRED');
   const xml=await queue.load(m.pmid,bound.owner);if(bindings.get(tab.id)!==bound||(await b.tabs.get(tab.id)).url!==bound.url)throw Error('READING_PAGE_CHANGED');return {xml};
  }
  await settings(s);
  if(m.command==='LIST')return {modules:await repo.read(),legacy:await getLegacy()?.read()};
  if(m.command==='EXPORT'){const e=(await repo.read()).entries.find(e=>e.module.id===m.id);if(!e)throw Error('MODULE_NOT_FOUND');return {raw:M.exported(e.module),name:e.module.name};}
  let result;if(m.command==='SAVE')result=await repo.save(m.module,m.generation);else if(m.command==='ENABLE')result=await repo.setEnabled(m.id,m.enabled,m.generation);else if(m.command==='DELETE')result=await repo.remove(m.id,m.generation);else if(m.command==='COPY')result=await repo.copy(m.id,m.generation);else if(m.command==='IMPORT')result=await repo.import(m.raw,m.generation);else if(m.command==='RESTORE')result=await repo.restoreBuiltins(m.generation);
  else if(m.command.startsWith('LEGACY_')){const legacy=getLegacy();if(!legacy)throw Error('LEGACY_UNAVAILABLE');const store=await legacy.read(),e=store.entries.find(e=>e.plan.id===m.id);if(m.command==='LEGACY_IMPORT'){await legacy.import(m.raw,m.generation);}else{if(!e)throw Error('TEMPLATE_NOT_FOUND');if(m.command==='LEGACY_EXPORT')return {raw:S.exported(e.plan),name:e.plan.name};if(m.command==='LEGACY_DELETE')await legacy.remove(m.id,m.generation);else if(m.command==='LEGACY_DISABLE')await legacy.disable(m.id,m.generation);else if(m.command==='LEGACY_ENABLE')await legacy.activate(e.plan,m.generation);else throw Error('READING_COMMAND_INVALID');}}
  else throw Error('READING_COMMAND_INVALID');await notify();return {modules:result||await repo.read(),legacy:await getLegacy()?.read()};
 }
 b.runtime.onMessage.addListener((m,s,reply)=>{if(m?.type!=='WFG_READING')return false;handle(m,s).then(data=>reply({ok:true,data}),e=>reply({ok:false,error:e.message}));return true;});
 b.tabs.onRemoved.addListener(drop);b.tabs.onUpdated.addListener((id,c)=>{if(c.url||c.status==='loading')drop(id);});
 return {repo,handle,notify,queue};
}g.WFGReadingBackground={install};})(globalThis);
