'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const api=require('../core/offline-article-workspace.js');
const W='workspace:'+'a'.repeat(64),base='chrome-extension://'+'a'.repeat(32)+'/',url=base+'offline-reader.html?workspaceId='+encodeURIComponent(W)+'&generation=2';
function setup(){
 const workspace={workspaceId:W,workspaceGeneration:2,canonicalUrl:'https://journal.test/paper',title:'Saved paper',contentHash:'body-hash',storageRevision:4};
 const metadata={schemaVersion:1,workspaceId:W,workspaceGeneration:2,documentHash:'source-hash',complete:true};
 const values={
  'article/offline-snapshot.html':'<html><head><meta name="brevess-offline-snapshot" content="'+encodeURIComponent(JSON.stringify(metadata))+'"></head><body>Saved source</body></html>',
  'article/structure.json':{documentId:'saved-doc',documentHash:'source-hash',title:'Saved paper',nodes:[{id:'section-1',title:'Results'}]},
  'article/paragraphs.json':{paragraphs:[{paragraphId:'p-1',text:'source sentence',sourceKey:'original-source-key'}]},
  'analysis/full-analysis.json':{ledger:{claims:['saved evidence']},reviewOutline:{title:'saved outline'},paragraphSummaries:[{paragraphId:'p-1',summary:'saved summary'}]},
  'annotations/highlights.json':{annotations:[{id:'manual-1',quote:'source sentence',note:'human edit'}]},
  'annotations/paragraph-notes.json':{notes:[{paragraphId:'p-1',note:'human paragraph note'}]},
  'annotations/abbreviations.json':{manualEntries:[{abbreviation:'QA',meaning:'human meaning'}]},
  'annotations/literature-note.json':{schemaVersion:3,templateId:'basic_research',valuesByTemplate:{basic_research:{research_background:'human literature note'}}},
  'figures/inventory.json':{figures:[{figureId:'figure-1',standard:{coreConclusion:'model result'}}]},
  'figures/workspace-draft.json':{figures:{'figure-1':{displayName:'human name',panels:{A:{panelId:'A',name:'human panel'}},unknownFutureField:{value:'retain'}}}},
  'chat/index.json':{turns:[{turnId:'turn-1',question:'Saved question',answer:'Saved answer',references:[{paragraphId:'p-1'}]}]},
  'logic-maps/index.json':{maps:[{id:'map-1',title:'human map'}]},
  'ui/state.json':{sidePanel:{activeView:'figures'}}
 };
 let reads=0;
 const assets=Object.entries(values).map(([relativePath,content])=>({workspaceId:W,workspaceGeneration:2,relativePath,content,contentHash:'receipt-'+relativePath,revision:1}));
 const store={getWorkspace:async()=>structuredClone(workspace),readPublicAssetCandidates:async()=>{reads++;return structuredClone(assets);},pageTurns:async()=>({items:[],hasMore:false,nextSequence:0}),putAsset(){throw Error('read must not write');}};
 return{workspace,metadata,values,assets,store,get reads(){return reads;}};
}
test('strict owned reader parser rejects foreign origins, paths, duplicate and malformed bindings',()=>{
 assert.equal(api.parseOfflineArticleReaderUrl(url,base).workspaceId,W);
 for(const bad of [url.replace('offline-reader.html','options.html'),url.replace(base,'chrome-extension://'+'b'.repeat(32)+'/'),url+'&workspaceId='+W,url.replace('generation=2','generation=0'),url.replace('workspace%3A','xworkspace%3A')])assert.equal(api.parseOfflineArticleReaderUrl(bad,base),null,bad);
 assert.equal(api.parseOfflineArticleReaderUrl(base+'offline-reader.html?workspaceId='+encodeURIComponent(W),base).workspaceGeneration,null,'legacy URL is syntax only; store supplies its generation');
});
test('read-only projection keeps every module, source references, manual draft and unknown draft fields',async()=>{
 const f=setup(),before=JSON.stringify(f.assets),result=await api.readOfflineArticleWorkspace({store:f.store,readerUrl:url,runtimeBaseUrl:base});
 assert.equal(result.binding.workspaceGeneration,2);assert.equal(result.snapshot.documentId,'saved-doc');
 assert.deepEqual(result.snapshot.ledger,f.values['analysis/full-analysis.json'].ledger);
 assert.deepEqual(result.snapshot.reviewOutline,f.values['analysis/full-analysis.json'].reviewOutline);
 assert.deepEqual(result.snapshot.paragraphSummaries,f.values['analysis/full-analysis.json'].paragraphSummaries);
 assert.deepEqual(result.snapshot.paragraphNotes,f.values['annotations/paragraph-notes.json'].notes);
 assert.deepEqual(result.snapshot.abbreviations.manualEntries,f.values['annotations/abbreviations.json'].manualEntries);
 assert.deepEqual(result.snapshot.figures.draft,f.values['figures/workspace-draft.json']);
 assert.deepEqual(result.snapshot.figures.figures,f.values['figures/inventory.json'].figures);
 assert.deepEqual(result.snapshot.chat.turns,f.values['chat/index.json'].turns);
 assert.deepEqual(result.snapshot.logicMaps,f.values['logic-maps/index.json']);
 assert.deepEqual(result.snapshot.manual.annotations,f.values['annotations/highlights.json'].annotations);
 assert.deepEqual(result.snapshot.literatureNote,f.values['annotations/literature-note.json']);
 assert.equal(result.snapshot.paragraphs[0].sourceKey,'original-source-key');assert.equal(result.snapshot.readOnly,true);
 assert.equal(JSON.stringify(f.assets),before);assert.equal(f.reads,2);
});
test('stale generation, deleted workspace and mismatched saved HTML ownership are rejected',async()=>{
 for(const mutate of [f=>{f.workspace.workspaceGeneration=3;},f=>{f.workspace.deletionPending=true;},f=>{f.assets[0].workspaceId='workspace:'+'b'.repeat(64);},f=>{f.assets[0].workspaceGeneration=1;}]){
  const f=setup();mutate(f);await assert.rejects(api.readOfflineArticleWorkspace({store:f.store,readerUrl:url,runtimeBaseUrl:base}));
 }
 const f=setup();f.assets[0].content=f.assets[0].content.replace('source-hash','different-hash');await assert.rejects(api.readOfflineArticleWorkspace({store:f.store,readerUrl:url,runtimeBaseUrl:base}),/OFFLINE_SOURCE_CHANGED/);
});
test('legacy unmarked HTML is readable only in its existing exact workspace and remains explicitly legacy',async()=>{
 const f=setup();f.assets[0].content='<html>Legacy local page</html>';
 const result=await api.readOfflineArticleWorkspace({store:f.store,readerUrl:base+'offline-reader.html?workspaceId='+encodeURIComponent(W),runtimeBaseUrl:base});
 assert.equal(result.binding.workspaceId,W);assert.equal(result.binding.workspaceGeneration,2);assert.equal(result.legacySnapshot,true);assert.equal(result.snapshot.readOnly,true);
});
test('inventory or workspace changes across a read prevent a mixed-generation projection',async()=>{
 const f=setup();let count=0;
 f.store.readPublicAssetCandidates=async()=>{const rows=structuredClone(f.assets);if(++count===2)rows[1].revision++;return rows;};
 await assert.rejects(api.readOfflineArticleWorkspace({store:f.store,readerUrl:url,runtimeBaseUrl:base}),/OFFLINE_SNAPSHOT_CHANGED/);
});
test('model and workspace mutations are refused while ordinary saved-record read commands are allowed',()=>{
 for(const type of ['LLM_ANALYZE_FIGURES','LLM_ASK_ARTICLE','LLM_SEMANTIC_FIND','LLM_CONTROL_OPERATION','ARTICLE_WORKSPACE_SAVE_ASSET','ANNOTATION_UPSERT'])assert.equal(api.isOfflineArticleMutationType(type),true,type);
 for(const type of ['LLM_GET_SETTINGS','LLM_GET_DIAGNOSTICS','ARTICLE_WORKSPACE_GET_ASSET','ARTICLE_WORKSPACE_LIST_ASSETS'])assert.equal(api.isOfflineArticleMutationType(type),false);
});
test('offline projection uses the existing public retry view and never exposes an unconfirmed Figure candidate',async()=>{
 const f=setup(),path='figures/inventory.json',row=f.assets.find(asset=>asset.relativePath===path),baseAsset=structuredClone(row);
 row.content.figures[0].standard.coreConclusion='unconfirmed provider candidate';row.revision=2;
 f.assets.push({workspaceId:W,workspaceGeneration:2,relativePath:'internal/figure-retry-staging/figure-retry-guard-offline001.json',revision:1,content:{kind:'figure_retry_candidate',status:'pending_confirmation',target:{relativePath:path},base:baseAsset,candidate:structuredClone(row)}});
 const before=JSON.stringify(f.assets),result=await api.readOfflineArticleWorkspace({store:f.store,readerUrl:url,runtimeBaseUrl:base});
 assert.equal(result.snapshot.figures.figures[0].standard.coreConclusion,'model result');assert.equal(JSON.stringify(f.assets),before);
});
test('public retry view preserves independent human changes beside a pending candidate',async()=>{
 const f=setup(),path='figures/inventory.json',row=f.assets.find(asset=>asset.relativePath===path),baseAsset=structuredClone(row);
 row.content.figures[0].standard.coreConclusion='pending conclusion';row.revision=2;const candidate=structuredClone(row);
 row.content.figures[0].manualEdits={standard:{coreConclusion:'human retained text'}};
 f.assets.push({workspaceId:W,workspaceGeneration:2,relativePath:'internal/figure-retry-staging/figure-retry-guard-offline002.json',revision:1,content:{kind:'figure_retry_candidate',status:'pending_confirmation',target:{relativePath:path},base:baseAsset,candidate}});
 const result=await api.readOfflineArticleWorkspace({store:f.store,readerUrl:url,runtimeBaseUrl:base});
 assert.equal(result.snapshot.figures.figures[0].standard.coreConclusion,'model result');
 assert.equal(result.snapshot.figures.figures[0].manualEdits.standard.coreConclusion,'human retained text');
});
test('direct turn revisions are compared even when owner timestamps do not change',async()=>{
 const f=setup();let reads=0;
 f.store.pageTurns=async()=>({items:[{workspaceId:W,workspaceGeneration:2,turnId:'direct-turn',sequence:1,revision:++reads===1?1:2,answer:'retained answer'}],hasMore:false});
 await assert.rejects(api.readOfflineArticleWorkspace({store:f.store,readerUrl:url,runtimeBaseUrl:base}),/OFFLINE_SNAPSHOT_CHANGED/);
});
test('empty optional modules remain readable and historical running flags never resume operations',async()=>{
 const f=setup();f.assets=f.assets.filter(row=>['article/offline-snapshot.html','article/structure.json','figures/inventory.json'].includes(row.relativePath));
 f.assets.find(row=>row.relativePath==='figures/inventory.json').content={figures:[],status:{running:true,paused:true,operationId:'old-op'}};
 f.store.readPublicAssetCandidates=async()=>structuredClone(f.assets);
 const result=await api.readOfflineArticleWorkspace({store:f.store,readerUrl:url,runtimeBaseUrl:base});
 assert.deepEqual(result.snapshot.figures.figures,[]);assert.equal(result.snapshot.figures.status.running,false);assert.equal(result.snapshot.figures.status.operationId,'');
 assert.deepEqual(result.snapshot.chat.turns,[]);assert.deepEqual(result.snapshot.manual.annotations,[]);assert.deepEqual(result.snapshot.paragraphNotes,[]);
});

function actualLegacyArchive(){
 return require('../core/article-archive.js').createArticleArchive({
  identity:{documentId:'sha256:'+'b'.repeat(64),documentHash:'legacy-source',canonicalUrl:'https://journal.test/legacy'},
  documentRecord:{documentId:'sha256:'+'b'.repeat(64),documentHash:'legacy-source',annotations:[]},
  workspace:{llm:{paragraphs:[{paragraphId:'old-p1',text:'Exact archived source.'}]},
   navigation:{nodes:[{id:'old-section',title:'Results'}]},ledger:{claims:['archived claim']},
   reviewOutline:{title:'archived outline'},paragraphSummaries:[{summary:'archived summary'}],
   figures:[{figureId:'figure-s1'}],figureWorkspace:{figures:[{figureId:'figure-s1'}],
    supplemental:{materials:[{id:'saved-supplement'}]},mechanismArtifacts:[{id:'saved-mechanism'}]}}
 });
}
test('actual legacy archive schema retains identity, paragraphs, navigation and complete figure workspace',()=>{
 const archive=actualLegacyArchive(),before=JSON.stringify(archive);
 const snapshot=api.projectOfflineArticleWorkspace({workspaceId:W,title:'Legacy',canonicalUrl:archive.canonicalUrl},
  [{relativePath:'legacy/archive.json',content:archive}]);
 assert.equal(snapshot.documentId,archive.documentId);assert.equal(snapshot.documentHash,archive.documentHash);
 assert.deepEqual(snapshot.paragraphs,archive.workspace.llm.paragraphs);
 assert.deepEqual(snapshot.nodes,archive.workspace.navigation.nodes);
 assert.deepEqual(snapshot.figures.supplemental,archive.workspace.figureWorkspace.supplemental);
 assert.deepEqual(snapshot.figures.mechanismArtifacts,archive.workspace.figureWorkspace.mechanismArtifacts);
 assert.equal(JSON.stringify(archive),before);
});
for(const wholeAsset of [false,true])test(`dedicated ${wholeAsset?'null analysis asset':'null result fields'} never resurrects cleared archive results`,()=>{
 const archive=actualLegacyArchive();
 const snapshot=api.projectOfflineArticleWorkspace({workspaceId:W},[
  {relativePath:'legacy/archive.json',content:archive},
  {relativePath:'analysis/full-analysis.json',content:wholeAsset?null:{ledger:null,reviewOutline:null,paragraphSummaries:[]}}
 ]);
 assert.equal(snapshot.ledger,null);assert.equal(snapshot.reviewOutline,null);
 assert.deepEqual(snapshot.paragraphSummaries,[]);
});

for(const matches of [true,false])test(`legacy fallback source ${matches?'matches':'cannot contradict'} the saved HTML binding`,async()=>{
 const f=setup(),archive=actualLegacyArchive();
 const metadata={...f.metadata,documentHash:matches?archive.documentHash:'different-html-source'};
 f.assets=[{...f.assets[0],content:'<html><head><meta name="brevess-offline-snapshot" content="'+encodeURIComponent(JSON.stringify(metadata))+'"></head><body>Saved source</body></html>'},
  {workspaceId:W,workspaceGeneration:2,relativePath:'legacy/archive.json',revision:1,contentHash:'legacy-receipt',content:archive}];
 f.store.readPublicAssetCandidates=async()=>structuredClone(f.assets);
 const reading=api.readOfflineArticleWorkspace({store:f.store,readerUrl:url,runtimeBaseUrl:base});
 if(!matches)await assert.rejects(reading,/OFFLINE_SOURCE_CHANGED/);
 else{const result=await reading;assert.equal(result.binding.documentHash,archive.documentHash);assert.equal(result.snapshot.documentHash,result.binding.documentHash);}
});

test('dedicated empty source and null module assets supersede legacy contents without mutation',()=>{
 const archive=actualLegacyArchive();archive.documentRecord.annotations=[{id:'old-note',quote:'source',note:'old note'}];
 const before=JSON.stringify(archive),snapshot=api.projectOfflineArticleWorkspace({workspaceId:W},[
  {relativePath:'legacy/archive.json',content:archive},{relativePath:'article/structure.json',content:{nodes:[]}},
  {relativePath:'article/paragraphs.json',content:{paragraphs:[]}},{relativePath:'figures/inventory.json',content:null},
  {relativePath:'annotations/highlights.json',content:null},{relativePath:'figures/workspace-draft.json',content:null}
 ]);
 assert.deepEqual(snapshot.nodes,[]);assert.deepEqual(snapshot.paragraphs,[]);assert.deepEqual(snapshot.figures.figures,[]);
 assert.equal(snapshot.figures.draft,null);assert.equal(snapshot.figures.supplemental,undefined);
 assert.deepEqual(snapshot.manual.annotations,[]);assert.equal(JSON.stringify(archive),before);
});
