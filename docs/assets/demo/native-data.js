/* Public, curated AlphaFold data. The UI is the production BREVESS UI. */
(() => {
  const d=window.BV_DEMO_DATA, demo=window.__websiteDemo;
  demo.workspaceId='workspace:'+'a'.repeat(64);
  demo.reading={figures:[],annotations:[],notes:{},chat:[]};
  demo.profile={settings:{consentGranted:true,globalProfileId:'example',profileOrder:['example'],profiles:{example:{name:'预置 AI 示例',providerId:'deepseek',config:{model:'prepared-example',hasApiKey:true}}},taskPolicies:{}}};
  demo.figureResult=f=>({figureId:'Fig'+f.id,figureQuestion:f.title,coreConclusion:f.takeaway[0],claimBoundary:'预置阅读示例；依据公开论文和图注整理。请结合原文核对。',panels:f.panels.flatMap(g=>{
    const parts=g[0].split('–'),letters=parts.length===2?Array.from({length:parts[1].charCodeAt(0)-parts[0].charCodeAt(0)+1},(_,i)=>String.fromCharCode(parts[0].charCodeAt(0)+i)):[parts[0]];
    return letters.map(panelId=>({panelId,panel:panelId,purpose:g[1],evidenceType:'论文图示',directObservation:g[2],observationSource:'caption_statement',localInference:f.takeaway[0],design:letters.length>1?'此段合并说明 panels '+g[0]:'',methods:[],statisticalMethods:[]}));
  })});
  demo.figures=()=>d.figures.map(f=>({figureId:'Fig'+f.id,figureLabel:'Fig'+f.id,label:'Fig'+f.id,title:f.title,caption:'Fig. '+f.id+': '+f.title,imageUrl:new URL('../figure-'+f.id+'.png',demo.base).href,activeDepth:'standard',...(demo.reading.figures.includes(f.id)?{standard:demo.figureResult(f),analysis:demo.figureResult(f)}:{}),panelDirectoryTrusted:true,panelHints:demo.figureResult(f).panels.map(p=>p.panelId)}));
  demo.structure=()=>({title:d.title,url:d.source,localWorkspace:{workspaceId:demo.workspaceId,workspaceGeneration:1,canonicalUrl:d.source,contentHash:'a'.repeat(64)},documentId:'alphafold-example',documentHash:'a'.repeat(64),revision:1,paragraphs:d.paragraphs.map(p=>({paragraphId:p.id,sectionId:p.id,text:p.text})),nodes:d.paragraphs.map((p,i)=>({sectionId:p.id,title:p.heading,level:2,order:i,children:[],paragraphCount:1,analysisSectionIds:[p.id],analysisSelected:true}))});
  demo.paper=()=>({paperId:'alphafold-2021',title:d.title,doi:'10.1038/s41586-021-03819-2',authors:'John Jumper, Richard Evans, Alexander Pritzel et al.',journal:'Nature',publicationDate:'2021-07-15',url:d.source,createdAt:'2021-07-15T00:00:00Z',abstract:d.paragraphs[0].text,sourceDocuments:[{workspaceId:demo.workspaceId,workspaceGeneration:1,title:d.title,sourceKind:'article',url:d.source,hasOfflineSnapshot:true,offlineSnapshotStatus:'complete'}]});
  demo.assets=()=>[
    {relativePath:'article/structure.json',content:demo.structure()},
    {relativePath:'figures/inventory.json',content:{figures:demo.figures()}},
    ...(demo.reading.draft?[{relativePath:'figures/workspace-draft.json',content:demo.reading.draft}]:[]),
  ].map(a=>({...a,revision:a.relativePath==='figures/workspace-draft.json'?Math.max(1,Number(a.content.revision)||1):1,contentHash:'a'.repeat(64)}));
  demo.handleMessage=async m=>{
    const ok=data=>({success:true,data});
    if(m.type==='ACTION_POPUP_GET_STATE')return ok({tabId:1,pageDocumentId:'public-alphafold-demo',pageUrl:d.source,title:d.title,nonce:'public-demo',readable:true,setupPending:false,pageTools:structuredClone(parent.__bvPageTools)});
    if(m.type==='PAGE_TOOLS_APPLY')return ok(structuredClone(parent.__bvPageTools));
    if(m.type==='PAGE_TOOLS_SET'){
      const state=parent.__bvPageTools;state.preferences[m.tool]=m.enabled===true;
      demo.send('page-tools-change',{tool:m.tool,enabled:m.enabled});return ok(structuredClone(state));
    }
    if(m.type==='PAGE_TOOLS_OPEN_SEARCH'){demo.send('semantic-open');return ok({});}
    if(m.type==='PAGE_TOOLS_TRANSLATE'){
      const state=parent.__bvPageTools;state.translation={enabled:m.enabled===true,phase:m.enabled?'completed':'stopped'};
      demo.send('body-translation',{enabled:m.enabled});return ok(structuredClone(state));
    }
    if(m.type==='ACTION_POPUP_START_READING'){demo.send('show-sidebar');return ok({});}
    if(m.type==='LLM_GET_SETTINGS')return ok(demo.profile);
    if(m.type==='WFG_UX'){
      if(parent.BV_FILTER_DEMO)return parent.BV_FILTER_DEMO.handle(m,demo);
      const state={tabId:1,navigationUrl:d.source,url:d.source,documentKey:'alphafold-example',title:d.title,sourceIds:[1],referenceIds:[],targets:[],turns:[],adjusting:false,adjustmentMode:'display',busy:false,plan:null,notice:''};
      if(m.command==='LIST')return {ok:true,data:[{id:1,url:d.source,title:d.title}]};
      if(m.command==='OUTLINE')return {ok:true,data:{tabId:1,nodes:[]}};
      return {ok:true,data:state};
    }
    if(m.type==='LOCAL_READING_LIBRARY_QUERY'){
      const match=!m.query||[d.title,'AlphaFold','Nature','protein','结构'].some(s=>s.toLowerCase().includes(m.query.toLowerCase()));
      return ok({items:match?[demo.paper()]:[],page:1,pageCount:1,matchedCount:match?1:0});
    }
    if(m.type==='ARTICLE_WORKSPACE_LIST_ASSETS')return ok({workspaceGeneration:1,assets:demo.assets()});
    if(m.type==='ARTICLE_WORKSPACE_GET_ASSET')return ok({found:true,workspaceGeneration:1,asset:demo.assets().find(a=>a.relativePath===m.relativePath)});
    if(m.type==='RESEARCH_WORKBENCH_LOCATE_SOURCE'){demo.send('jump',{id:m.target?.figureId?'figure-'+m.target.figureId.replace(/\D/g,''):m.target?.paragraphId||'abstract'});return ok({ready:true,focused:true,target:m.target,precision:m.target?.kind==='paragraph'?'paragraph':'figure',navigationIdentity:m.expectedNavigationIdentity,documentIdentity:m.expectedDocumentIdentity});}
    if(m.type==='RESEARCH_WORKBENCH_SYNC')return ok({state:'localSaved'});
    if(m.action==='focusArticleWorkspaceSource'){demo.send('jump',{id:m.target?.evidence?.paragraphId||m.target?.paragraphId||m.target?.sectionId||'abstract'});return {success:true,focused:true};}
    if(m.action==='updateFigureWorkspaceDraft'){
      try{demo.draft=SciLLM.applyFigureWorkspaceMutation(demo.draft,m.mutation);demo.reading.draft=structuredClone(demo.draft);return {success:true,draft:demo.draft};}catch(e){return {success:false,error:e.message,code:e.code};}
    }
    if(m.action==='flushFigureWorkspaceDraft')return {success:true,draft:demo.draft};
    if(m.action==='getArticleWorkspaceSnapshot')return {success:true,snapshot:demo.snapshot?.()||demo.structure()};
    if(m.action==='setArticleSectionAnalysisSelected')return {success:true};
    if(m.action==='setHighlightSourceVisibility'){demo.send('highlight-visibility',{sources:m.visibleSources});return {success:true};}
    return ok({items:[],entries:[],results:[],pageCount:1,permission:'unavailable'});
  };
})();
