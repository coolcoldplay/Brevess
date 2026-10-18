(function(root,factory){
 const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
 Object.assign(root.SciLLM||(root.SciLLM={}),api);
})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const clone=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
 const fail=code=>{throw Object.assign(new Error(code),{code});};
 const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
 const receipt=value=>JSON.stringify(stable(value));
 function parseOfflineArticleReaderUrl(value,runtimeBaseUrl){
  try{
   const url=new URL(String(value||'')),base=new URL(String(runtimeBaseUrl||''));
   if(!['chrome-extension:','moz-extension:'].includes(base.protocol)||url.protocol!==base.protocol||url.host!==base.host||url.pathname!==new URL('offline-reader.html',base).pathname||url.username||url.password||url.hash)return null;
   const keys=[...url.searchParams.keys()];if(keys.some(key=>!['workspaceId','generation'].includes(key))||url.searchParams.getAll('workspaceId').length!==1||url.searchParams.getAll('generation').length>1)return null;
   const workspaceId=url.searchParams.get('workspaceId');if(!/^workspace:[a-f0-9]{64}$/.test(workspaceId||''))return null;
   const raw=url.searchParams.get('generation'),workspaceGeneration=raw===null?null:Number(raw);
   if(raw!==null&&(!/^[1-9][0-9]*$/.test(raw)||!Number.isSafeInteger(workspaceGeneration)))return null;
   return{workspaceId,workspaceGeneration,readerUrl:url.href};
  }catch{return null;}
 }
 function isOfflineArticleMutationType(type){
  return /^LLM_(?:ANALYZE|ASK|AUTOFILL|TRANSLATE|SEMANTIC_FIND|TEST_PROVIDER|DISTILL|CONTROL_OPERATION|PREPARE_DOCUMENT|SET_STUDY_TYPE|ADVANCE_FIGURE)/.test(String(type||''))||
   /^(?:ANNOTATION_(?:UPSERT|DELETE|CLEAR)|DOCUMENT_PREPARE|ARTICLE_ARCHIVE_(?:SAVE|COMMIT)|ARTICLE_WORKSPACE_(?:ENSURE|SAVE|UPDATE|DELETE|COMMIT|CONFIRM|FINALIZE|ABORT|COMPENSATE|MIRROR|BEGIN_DELETE)|LITERATURE_NOTE_COMMIT)/.test(String(type||''));
 }
 function offlineMetadata(html){
  const tag=String(html||'').match(/<meta\b[^>]*\bname=["']brevess-offline-snapshot["'][^>]*>/i);
  if(!tag)return null;const content=tag[0].match(/\bcontent=["']([^"']*)["']/i);
  try{return JSON.parse(decodeURIComponent(content?.[1]||''));}catch{return fail('OFFLINE_METADATA_INVALID');}
 }
 function projectOfflineArticleWorkspace(workspace,assets,turns=[]){
  const byPath=new Map(assets.map(asset=>[asset.relativePath,clone(asset.content)]));
  const object=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
  const field=(value,key,fallback)=>value&&Object.hasOwn(value,key)?value[key]:fallback;
  const saved=(path,fallback)=>byPath.has(path)?byPath.get(path):fallback;
  const archive=byPath.get('legacy/archive.json')||{},legacy=archive.workspace||{};
  const structure=object(saved('article/structure.json',legacy.navigation));
  const analysis=object(byPath.get('analysis/full-analysis.json'));
  // A dedicated full snapshot, including an explicit null tombstone, supersedes
  // archive analysis. Null fields are saved clears rather than missing values.
  const analysisFallback=byPath.has('analysis/full-analysis.json')?{}:legacy;
  const paragraphs=saved('article/paragraphs.json',null);
  const sourceParagraphs=byPath.has('article/paragraphs.json')?field(paragraphs,'paragraphs',[]):
   field(analysis.preparedStudy,'paragraphs',field(analysis.llm,'paragraphs',field(legacy.llm,'paragraphs',[])));
  const highlights=byPath.get('annotations/highlights.json')||{};
  const legacyFigures=object(legacy.figureWorkspace);
  const inventory=object(saved('figures/inventory.json',{...legacyFigures,figures:field(legacyFigures,'figures',legacy.figures||[])}));
  const draft=saved('figures/workspace-draft.json',field(inventory,'draft',byPath.has('figures/inventory.json')?null:legacy.figureWorkspaceDraft??null));
  const chat=object(saved('chat/index.json',legacy.chat||{turns:[]})),chatTurns=new Map();
  for(const turn of chat.turns||[])if(turn?.turnId)chatTurns.set(turn.turnId,turn);
  for(const row of turns){const turn=row.content&&typeof row.content==='object'?{...row.content,turnId:row.turnId,sequence:row.sequence}:row;if(turn?.turnId)chatTurns.set(turn.turnId,clone(turn));}
  const idle=value=>({...clone(value||{}),running:false,paused:false,canPause:false,operationId:'',phase:value?.running||value?.paused?'interrupted':value?.phase||'idle'});
  const figures={...inventory,draft,figures:clone(inventory.figures||[]).map(figure=>{
   if(Object.hasOwn(figure,'deepLoading'))figure.deepLoading=false;
   for(const key of ['panelAnalysisLoading','panelFollowupLoading'])if(figure[key])figure[key]=Object.fromEntries(Object.keys(figure[key]).map(id=>[id,false]));
   return figure;
  }),status:idle(inventory.status),workspaceLifecycle:0};
  const raw=object(field(analysis.llm,'rawAnalysis',field(analysisFallback.llm,'rawAnalysis',{})));
  const abbreviationState=object(saved('annotations/abbreviations.json',legacy.abbreviations||{}));
  const abbreviationApi=typeof globalThis.SciLLM?.composeArticleAbbreviations==='function'?globalThis.SciLLM:
   typeof require==='function'?require('./abbreviation-extractor.js'):null;
  const readingParagraphs=Array.isArray(sourceParagraphs)?sourceParagraphs:[];
  const abbreviations={...clone(abbreviationState),...(abbreviationApi?.composeArticleAbbreviations?.({paragraphs:readingParagraphs,articleState:abbreviationState})||{})};
  return{...structure,title:structure.title||workspace.title,url:workspace.canonicalUrl,documentId:structure.documentId||archive.documentId||'',
   documentHash:structure.documentHash||archive.documentHash||'',publisherFamily:structure.publisherFamily||'generic',
   nodes:clone(structure.nodes||[]),paragraphs:clone(readingParagraphs),diagnostics:clone(structure.diagnostics||{paragraphCount:readingParagraphs.length}),
   ledger:clone(field(analysis,'ledger',field(raw,'ledger',field(analysisFallback,'ledger',null)))),reviewOutline:clone(field(analysis,'reviewOutline',field(analysisFallback,'reviewOutline',null))),
   paragraphSummaries:clone(field(analysis,'paragraphSummaries',field(analysisFallback,'paragraphSummaries',[]))),
   sectionOutlines:clone(field(analysis,'sectionOutlines',field(legacy,'sectionOutlines',[]))),
   paragraphNotes:clone(field(saved('annotations/paragraph-notes.json',null),'notes',byPath.has('annotations/paragraph-notes.json')?[]:legacy.paragraphNotes||[])),
   abbreviations,figures,logicMaps:clone(saved('logic-maps/index.json',legacy.logicMaps||{})),
   chat:{...chat,turns:[...chatTurns.values()].sort((a,b)=>(Number(a.sequence)||0)-(Number(b.sequence)||0)),loading:false,operationId:'',activeTurnId:''},
   highlightDistribution:clone(field(highlights,'highlightDistribution',byPath.has('annotations/highlights.json')?{}:legacy.highlightDistribution||{})),
   manual:{...clone(archive.documentRecord||{}),annotations:clone(field(highlights,'annotations',byPath.has('annotations/highlights.json')?[]:archive.documentRecord?.annotations||[]))},
   literatureNote:clone(saved('annotations/literature-note.json',legacy.literatureNote||null)),
   llmTask:idle(field(analysis,'task',analysisFallback.navigation?.llmTask)),localWorkspace:{...clone(workspace)},uiState:clone(saved('ui/state.json',legacy.uiState||{})),readOnly:true,offlineMode:true};
 }
 async function readOfflineArticleWorkspace({store,readerUrl,runtimeBaseUrl}){
  const parsed=parseOfflineArticleReaderUrl(readerUrl,runtimeBaseUrl);if(!parsed)fail('OFFLINE_READER_BINDING_INVALID');
  if(typeof store?.getWorkspace!=='function'||typeof store?.readPublicAssetCandidates!=='function')fail('OFFLINE_STORE_UNAVAILABLE');
  const workspace=await store.getWorkspace(parsed.workspaceId);
  if(!workspace||workspace.deletionPending||workspace.workspaceId!==parsed.workspaceId)fail('OFFLINE_WORKSPACE_UNAVAILABLE');
  const generation=Number(workspace.workspaceGeneration||1);
  if(!Number.isSafeInteger(generation)||generation<1||parsed.workspaceGeneration!==null&&parsed.workspaceGeneration!==generation)fail('OFFLINE_GENERATION_CHANGED');
  const assets=await store.readPublicAssetCandidates(parsed.workspaceId);
  if(!Array.isArray(assets))fail('OFFLINE_ASSETS_UNAVAILABLE');
  const seen=new Set();for(const asset of assets){
   if(asset.workspaceId!==parsed.workspaceId||Number(asset.workspaceGeneration||1)!==generation)fail('OFFLINE_ASSET_OWNERSHIP_MISMATCH');
   if(!asset.relativePath||seen.has(asset.relativePath))fail('OFFLINE_ASSETS_AMBIGUOUS');seen.add(asset.relativePath);
  }
  const html=assets.find(asset=>asset.relativePath==='article/offline-snapshot.html');
  if(typeof html?.content!=='string'||!html.content)fail('OFFLINE_HTML_UNAVAILABLE');
  const metadata=offlineMetadata(html.content);
  if(metadata&&(metadata.schemaVersion!==1||metadata.workspaceId!==parsed.workspaceId||Number(metadata.workspaceGeneration||1)!==generation))fail('OFFLINE_METADATA_BINDING_MISMATCH');
  const structure=assets.find(asset=>asset.relativePath==='article/structure.json')?.content;
  if(metadata?.documentHash&&structure?.documentHash&&metadata.documentHash!==structure.documentHash)fail('OFFLINE_SOURCE_CHANGED');
  async function readTurns(){const turns=[];if(typeof store.pageTurns==='function'){
   let afterSequence=0;for(let pageIndex=0;pageIndex<100;pageIndex++){
    const page=await store.pageTurns(parsed.workspaceId,{limit:1000,afterSequence});
    for(const turn of page.items||[]){if(turn.workspaceId!==parsed.workspaceId||Number(turn.workspaceGeneration||1)!==generation)fail('OFFLINE_TURN_OWNERSHIP_MISMATCH');turns.push(turn);}
    if(!page.hasMore)break;if(!(page.nextSequence>afterSequence)||pageIndex===99)fail('OFFLINE_TURNS_INCOMPLETE');afterSequence=page.nextSequence;
   }
  }return turns;}
  const turns=await readTurns();
  const again=await store.readPublicAssetCandidates(parsed.workspaceId),current=await store.getWorkspace(parsed.workspaceId);
  if(receipt(assets)!==receipt(again)||receipt(workspace)!==receipt(current)||receipt(turns)!==receipt(await readTurns()))fail('OFFLINE_SNAPSHOT_CHANGED');
  const projector=globalThis.SciLLM?.projectPublicArticleWorkspaceAssets||
   (typeof require==='function'?require('./background-router.js').projectPublicArticleWorkspaceAssets:null);
  if(typeof projector!=='function')fail('OFFLINE_PUBLIC_VIEW_UNAVAILABLE');
  const publicAssets=projector(assets);
  const snapshot=projectOfflineArticleWorkspace(workspace,publicAssets,turns);
  if(metadata?.documentHash&&snapshot.documentHash&&metadata.documentHash!==snapshot.documentHash)fail('OFFLINE_SOURCE_CHANGED');
  const binding={workspaceId:parsed.workspaceId,workspaceGeneration:generation,readerUrl:parsed.readerUrl,documentHash:snapshot.documentHash||metadata?.documentHash||''};
  return{binding,snapshot,legacySnapshot:!metadata,metadata:clone(metadata),assetReceipt:{revision:html.revision,contentHash:html.contentHash},assetCount:publicAssets.length};
 }
 return{parseOfflineArticleReaderUrl,isOfflineArticleMutationType,readOfflineArticleWorkspace,projectOfflineArticleWorkspace};
});
