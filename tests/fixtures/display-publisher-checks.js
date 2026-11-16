// Live-page QA helper. Loaded only by the development browser runner, never the extension.
window.runPublisherReadingChecks=async function(spec){
 const M=WFGReadingModules,engine=WFGEngine.create({document}),reading=WFGReadingPage.create({document});
 const config=entries=>({version:1,generation:0,entries,deletedBuiltins:[]});
 const baseline=M.builtins().filter(e=>e.builtinId!=='personal-reading');reading.setConfig(config(baseline));
 const content=document.querySelector(spec.root),text=content.textContent,images=[...content.querySelectorAll('img')].map(n=>[n,n.getAttribute('src')]),links=[...content.querySelectorAll('a')].map(n=>[n,n.getAttribute('href')]);
 const results=[];
 for(const item of spec.cases){let module;try{
  const nodes=[...document.querySelectorAll(item.selector)];if(!nodes.length)throw Error('No targets');
  const plan={schemaVersion:2,id:'publisher-qa',revision:0,name:item.name,scope:await WFGSchema.scope(location.href),operations:[{type:item.hide?'hide':'style',target:{frame:'top',roots:[],selector:item.selector},...(item.hide?{}:{styles:item.styles})}]};
  reading.setPreview(true);const receipt=engine.apply(plan,engine.session());if(!receipt.verified)throw Error('Preview unverified');
  const verify=()=>{for(const n of nodes){const s=getComputedStyle(n);if(s.getPropertyValue(item.property)!==item.expected)throw Error('Computed '+item.property+': '+s.getPropertyValue(item.property));}if(content.textContent!==text||images.some(([n,src])=>!n.isConnected||n.getAttribute('src')!==src)||links.some(([n,href])=>!n.isConnected||n.getAttribute('href')!==href))throw Error('Original content changed');};
  verify();module=reading.validatePlan(plan,{reusable:false});module.match.pathPrefixes=[location.pathname];module.match.pathMode='exact';const q=M.pageQuery(location.href);if(q)module.match.queryEquals=q;
  engine.undo();reading.setPreview(false);reading.setConfig(config([{module,enabled:true,builtinId:null}]));verify();
  const snapshot=reading.snapshot();if(!['applied','partial'].includes(snapshot.reading.phase))throw Error('Replay '+JSON.stringify(snapshot.reading));
  results.push({name:item.name,selector:item.selector,matches:nodes.length,passed:true,notices:snapshot.reading.notices,preservedImages:images.length,preservedLinks:links.length});
 }catch(e){results.push({name:item.name,selector:item.selector,passed:false,error:e.message});}finally{engine.undo();reading.setPreview(false);reading.setConfig(config(baseline));}}
 const readingSnapshot=reading.snapshot();engine.destroy();reading.destroy();return {url:location.href,title:document.title,results,baseline:readingSnapshot.reading.phase};
};
