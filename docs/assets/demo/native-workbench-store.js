/* Keep website examples entirely in memory, using production model validation. */
(() => {
 const s=window.SciLLM, demo=window.__websiteDemo, d=window.BV_DEMO_DATA;
 if(s?.createMemoryResearchWorkbenchBackend){const create=s.createResearchWorkbenchStore;const backend=s.createMemoryResearchWorkbenchBackend();s.createResearchWorkbenchStore=options=>create({...options,backend});}
 if(window.BrevessLibraryAttachments){BrevessLibraryAttachments.createLibraryAttachmentStore=()=>({load:async()=>null,verify:async()=>({available:false}),close:async()=>{},save:async()=>{throw Error('请在已安装的插件中导入自己的文件。');}});}
 if(window.BrevessLibraryCatalog){const C=BrevessLibraryCatalog;let catalog=C.createEmptyLibraryCatalog();C.createLibraryCatalogStore=()=>({read:async()=>structuredClone(catalog),execute:async req=>{const update=C.applyLibraryCatalogCommand(catalog,req);catalog=update.catalog;return update.result;},close:async()=>{},restoreBackup:async()=>{throw Error('官网体验不导入私人备份；请在已安装插件中使用。');}});}
 if(window.BrevessWorkbenchLibraryImport){let entries=[];BrevessWorkbenchLibraryImport.createLibraryImportStore=()=>({readAll:async()=>structuredClone(entries),replace:async x=>{entries=structuredClone(x);return entries;},clear:async()=>{entries=[];}});}
 if(window.BrevessRadar?.createMemoryRadarBackend){
   const create=BrevessRadar.createRadarStore, at=Date.parse('2021-07-16T08:00:00Z');
   const initial={schema:1,active:null,radars:[{id:'radar-alphafold-example',name:'蛋白质结构预测',query:'AlphaFold AND protein structure',source:'pubmed',intervalHours:0,baselineDays:30,enabled:false,editVersion:1,createdAt:at,updatedAt:at,revisions:[{number:1,query:'AlphaFold AND protein structure',baselineDays:30,createdAt:at,windowStart:'2021-06-17',baselineAt:at,lastSuccessAt:at,lastAttemptAt:at,nextRetryAt:null,lastNewCount:1,warnings:[],error:null,queryTranslation:'AlphaFold AND protein structure',articles:[{id:'34265844',title:d.title,authors:['John Jumper','Richard Evans','Alexander Pritzel'],journal:'Nature',doi:'10.1038/s41586-021-03819-2',url:d.source,publicationDate:'2021-07-15',createdDay:'2021-07-15',firstSeenAt:at,isBaseline:false,read:false,abstract:d.paragraphs[0].text,abstractStatus:'ready'}]}]}]};
   const backend=BrevessRadar.createMemoryRadarBackend(initial);BrevessRadar.createRadarStore=options=>create({...options,backend});
 }
})();
