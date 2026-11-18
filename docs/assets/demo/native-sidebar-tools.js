/* Production outline and abbreviation controls; only the data boundary is adapted. */
window.BVSetupSidebarTools=({d,demo,send})=>{
 const examples=BV_READER_EXAMPLES,byId=id=>document.getElementById(id);
 const extracted=SciLLM.extractArticleAbbreviations(d.paragraphs.map(p=>({paragraphId:p.id,text:p.text})));
 let entries=examples.abbreviations.map(entry=>({...entry,meaningZh:'',definitionZh:'',sourceType:extracted.some(a=>a.abbreviation.toUpperCase()===entry.abbreviation.toUpperCase())?'automatic':'manual'})).sort((a,b)=>a.abbreviation.localeCompare(b.abbreviation));
 let memory=SciLLM.normalizeGlobalAbbreviationMemory({entries:[]});
 const snapshot=()=>({documentKey:panelTabDocumentKey({id:1,url:d.source}),documentHash:'a'.repeat(64),documentIdentity:'public-alphafold-demo',tabId:1,entries:structuredClone(entries),automaticCount:entries.filter(e=>e.sourceType==='automatic').length,manualCount:entries.filter(e=>e.sourceType==='manual').length,globalCount:0,translatedCount:entries.filter(e=>e.meaningZh).length,definedCount:entries.filter(e=>e.definitionZh).length});
 const handle=demo.handleMessage;
 demo.handleMessage=async m=>{
  if(m.action==='getArticleAbbreviations')return {success:true,abbreviations:snapshot()};
  if(m.action==='updateArticleAbbreviationTranslations'){
   for(const update of m.translations){const entry=entries.find(e=>abbreviationPairKey(e)===abbreviationPairKey(update));if(!entry)continue;for(const field of ['meaningZh','definitionZh'])if(update[field]!==undefined&&(!m.onlyEmpty||!entry[field]))entry[field]=update[field];}
   return {success:true,abbreviations:snapshot()};
  }
  if(m.action==='removeArticleAbbreviation'){entries=entries.filter(e=>e.abbreviation!==m.abbreviation);return {success:true};}
  if(m.type==='ABBREVIATION_MEMORY_GET')return {success:true,data:{memory}};
  if(m.type==='ABBREVIATION_MEMORY_MERGE'){const result=SciLLM.mergeGlobalAbbreviationMemory(memory,m.entries,{incrementSupport:m.incrementSupport});memory=result.memory;return {success:true,data:result};}
  return handle(m);
 };
 loadArticleAbbreviationSnapshot=async()=>currentArticleAbbreviationSnapshot=snapshot();
 enrichArticleAbbreviations=async({entry=null,fields=['meaningZh']}={})=>{
  const binding=abbreviationBinding(),targets=entry?[entry]:entries,updates=[];
  for(const target of targets){const example=examples.abbreviations.find(e=>abbreviationPairKey(e)===abbreviationPairKey(target));if(!example)continue;
   const update={abbreviation:target.abbreviation,fullName:target.fullName,origin:'prepared-example'};
   for(const field of fields)if(!target[field]&&!abbreviationDraft(target,field).value.trim())update[field]=example[field];
   updates.push(update);
  }
  const next=await persistArticleAbbreviationTranslations(updates,{binding,onlyEmpty:true});
  if(isCurrentAbbreviationBinding(binding,true))renderArticleAbbreviationTable(next);
  send('toast',{message:'已补齐空白项；保留手动填写内容。释义为预置示例，未调用在线模型。'});
 };
 setupAbbreviationDialogs();
 byId('showArticleAbbreviations').addEventListener('click',()=>{void showArticleAbbreviationTable();send('toast',{message:'5 项论文缩略词示例；可编辑，或点击一键获取补齐空白释义。'});});
 byId('translateArticleAbbreviations').addEventListener('click',()=>void enrichArticleAbbreviations());
 byId('importArticleAbbreviationsToGlobal').addEventListener('click',()=>void importCurrentArticleAbbreviationsToGlobal());
 byId('exportGlobalAbbreviationMemory').addEventListener('click',()=>void exportGlobalAbbreviationMemoryFile());
 byId('translateNavigationTitles').disabled=false;
 byId('translateNavigationTitles').title='翻译大纲标题';
 byId('translateNavigationTitles').addEventListener('click',()=>{
  for(const p of d.paragraphs)outlineTitleTranslations.set(outlineExpansionKey('html',p.id),['html',p.id,p.heading,examples.headings[p.id],'public-prepared-translation']);
  renderArticleNavigationTree(currentWorkspaceSnapshot);
  byId('translateNavigationTitles').disabled=false;
  send('toast',{message:'大纲已显示中英对照，可点击标题定位原文。译文为预置示例。'});
 });
 return {add(entry){
  const existing=entries.find(e=>abbreviationPairKey(e)===abbreviationPairKey(entry));
  if(!existing)entries.push({...entry,paragraphId:entry.paragraphId||entry.blockId||'msa',sourceType:'manual'});
  entries.sort((a,b)=>a.abbreviation.localeCompare(b.abbreviation));
  currentArticleAbbreviationSnapshot=snapshot();
  if(byId('articleAbbreviationDialog').open)renderArticleAbbreviationTable(currentArticleAbbreviationSnapshot);
 }};
};
