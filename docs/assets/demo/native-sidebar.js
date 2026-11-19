/* Bind prepared data to production renderers. No HTML/CSS imitation of the sidebar. */
(() => {
 const start=()=>{
  try {
   const d=window.BV_DEMO_DATA, demo=window.__websiteDemo;
   let busy=false, mode='navigation';
   figurePanelHeaderFieldsState={purpose:true,evidenceType:false,experimentalMethods:false,statisticalMethods:false,comparison:false,directObservation:false};
   const send=(type,data)=>demo.send(type,data), byId=id=>document.getElementById(id);
   pollSidebarRuntimeTasks=async()=>{};
   refreshArticleWorkspace=async()=>currentWorkspaceSnapshot;
   // The website has no extension receiver handshake. Keep the native controls,
   // and route their content-script commands to this isolated in-memory adapter.
   sendTabMessage=async(tabId,message)=>chrome.tabs.sendMessage(tabId,message);
   llmSettingsState=demo.profile;
   activePanelTabContext={...activePanelTabContext,tabId:1,url:d.source,title:d.title,activated:true,key:d.source};
   demo.draft=SciLLM.createFigureWorkspaceDraft(demo.figures());
   demo.snapshot=()=>currentWorkspaceSnapshot;
   currentWorkspaceSnapshot={...demo.structure(),publisher:d.publisher||'springer-nature',figures:{figures:demo.figures(),inventoryReady:true,workspaceLifecycle:1,draft:demo.draft},chat:{turns:[]}};
   if(d.web)for(const node of d.outline||[])outlineExpansionState.set(outlineExpansionKey('html',node.sectionId),true);
   manualAnnotationState={documentId:d.documentId||'alphafold-example',annotationCount:0,unresolvedCount:0};
   focusWorkspaceSource=async target=>{target.kind==='highlight'?send('annotation',{id:target.highlightId}):send('jump',{id:target.evidence?.paragraphId||target.sectionId||target.paragraphId||'abstract'});return true;};
   handleFigureWorkspaceJump=async figure=>send('jump',{id:'figure-'+String(figure.figureId).replace(/\D/g,'')});
   async function generate(module=mode, specific){
     if(busy)return;busy=true;send('generation',{module});
     const button=document.querySelector(`[data-workspace-target="${module==='note'?'notes':module}"]`);
     button?.setAttribute('aria-busy','true');
     try {
       // The brief transition only reveals prepared output, not model latency.
       await new Promise(r=>setTimeout(r,350));
       if(module==='figures'){
         const ids=specific?[Number(specific.replace(/\D/g,''))]:figureSelectedIds.size?[...figureSelectedIds].map(id=>Number(id.replace(/\D/g,''))):d.figures.map(f=>f.id);
         demo.reading.figures=[...new Set([...demo.reading.figures,...ids])];
         demo.draft=SciLLM.createFigureWorkspaceDraft(demo.figures(),demo.draft);demo.reading.draft=structuredClone(demo.draft);
         currentWorkspaceSnapshot.figures={figures:demo.figures(),inventoryReady:true,workspaceLifecycle:1,draft:demo.draft};
         figureWorkspaceViewState.clear?.();
         figureExpansionState.set('Fig'+ids[0],true);
         renderFigureWorkspaceSnapshot(currentWorkspaceSnapshot,{coordinated:true});
       } else if(module==='navigation') {
         currentWorkspaceSnapshot.paragraphSummaries=d.paragraphs.map(p=>({paragraphId:p.id,summary:p.summary[0]}));
         d.paragraphs.forEach(p=>outlineExpansionState.set(outlineExpansionKey('html',p.id),true));
         renderArticleNavigationTree(currentWorkspaceSnapshot);
         document.querySelectorAll('#articleNavigationTree details.workspace-tree-node').forEach(n=>{n.open=true;});
       } else if(module==='highlights') {highlights.run();}
       else if(module==='notes'||module==='note'){
         const fields=d.notes||{research_background:'蛋白质序列数量远多于已解析结构，结构预测可以帮助缩小这一差距。',scientific_questions:'如何在没有已知相似结构时，从氨基酸序列预测可靠的三维结构？',experimental_design:'CASP14 盲测；训练时间之后的 PDB 测试集；组件消融；MSA 深度分析。',important_methods:'MSA 与残基对表示；Evoformer；Invariant Point Attention；recycling。',main_findings:'在多数 CASP14 目标上取得很高精度。低 MSA 深度仍是重要的适用边界（Fig 5a）。',innovations:'将共进化信息与几何推理整合到端到端网络。',limitations:'高局部置信度不等于已验证生物学功能；浅 MSA 和链间接触仍需谨慎。',open_questions:'哪些低置信区域值得优先实验验证？',transferable_ideas:'先用结构与置信度提出可检验的问题，再结合实验对照验证。'};
         literatureNoteDocumentState={schemaVersion:3,templateId:'basic_research',valuesByTemplate:{basic_research:{...fields,...demo.reading.notes}},fieldStatusByTemplate:{basic_research:Object.fromEntries(Object.keys(fields).map(k=>[k,'supported']))},fieldEvidenceByTemplate:{},fieldUpdatedAtByTemplate:{},updatedAt:Date.now()};
         demo.reading.notes=literatureNoteDocumentState.valuesByTemplate.basic_research;renderLiteratureNoteDrawer();
       } else if(module==='chat') await answer(d.questions[0].q[0]);
       send('generated',{module,reading:demo.reading});
     }finally{busy=false;button?.setAttribute('aria-busy','false');}
   }
   function switchMode(view){mode=view;switchWorkspaceView(view,{persist:false,loadNotes:false});if(view==='notes')renderLiteratureNoteDrawer();if(view==='chat')renderArticleChatSnapshot(currentWorkspaceSnapshot);send('module',{module:view});}
   runSingleFigureAnalysis=async id=>generate('figures',id);
   performSidebarModuleBatch=async module=>generate(module);
   generateSelectedLiteratureNoteFields=async()=>generate('notes');
   runSingleFigurePanelAnalysis=async id=>generate('figures',id);
   persistLiteratureNote=async()=>{};
   async function answer(question){
     const q=d.questions.find(x=>x.q.includes(question)||x.match?.test(question))||(d.web?null:(/msa|比对|序列/i.test(question)?d.questions[0]:/evoformer|recycl|结构模块|架构|流程/i.test(question)?d.questions[1]:/局限|验证|置信|可靠|不足/i.test(question)?d.questions[2]:null));
     const turn={turnId:'example-'+Date.now(),question,status:'completed',answer:q?`${q.answer[0]}\n\n${q.details[0]}\n\n${d.web?'**依据当前网页内容整理。**':'**回到原图核对：** '+q.refs.map(i=>`Fig ${i}`).join(' · ')}\n\n*预置示例，未调用在线模型。*`:'这是官网预置体验。试问：'+d.questions.map(x=>x.q[0]).join('；')+'。安装插件后可向已配置的模型自由提问。',createdAt:Date.now(),profileName:'预置 AI 示例'};
     if(q){
       const evidenceIds=q.evidenceIds||(q===d.questions[0]?['msa']:[]);
       if(evidenceIds.length)turn.answer=turn.answer.replace(q.details[0],q.details[0]+' '+evidenceIds.map((_,i)=>'[['+(i+1)+']]').join(' '));
       const evidence=evidenceIds.map((id,index)=>{const p=d.paragraphs.find(p=>p.id===id);return {marker:String(index+1),paragraphId:id,sectionTitle:p.heading,quote:p.text,documentRevision:1};});
       if(!d.web&&q===d.questions[1])turn.answer+='\n\n| 组件 | 作用 |\n| --- | --- |\n| Evoformer | 让 MSA 与残基对表示交换信息 |\n| 结构模块 | 将表示转成三维坐标 |\n| Recycling | 把预测反馈给网络继续精炼 |';
       turn.answerBlocks=[{blockId:turn.turnId+'-answer',markdown:turn.answer,evidence}];
     }
     currentWorkspaceSnapshot.chat.turns.push(turn);demo.reading.chat=currentWorkspaceSnapshot.chat.turns;
     renderArticleChatSnapshot(currentWorkspaceSnapshot);byId('articleChatQuestion').value='';
     byId('articleChatMessages').scrollTop=byId('articleChatMessages').scrollHeight;
     send('generated',{module:'chat',reading:demo.reading});
   }
   submitArticleChat=async event=>{event?.preventDefault();const q=byId('articleChatQuestion').value.trim();if(q)await answer(q);};
   const highlights=BVSetupHighlights({d,demo,send});
   byId('sidePanelPaperTitle').textContent=d.title;
   byId('articleNavigationStatus').textContent=d.web?d.publisher+' · 完整正文':'springer-nature · 5 个标题 · 论文节选';
   byId('sidePanelDocumentStatusText').textContent='已激活 · '+(d.publisher||'springer-nature')+' · 网页滤镜';
   renderArticleNavigationTree(currentWorkspaceSnapshot);renderFigureWorkspaceSnapshot(currentWorkspaceSnapshot,{coordinated:true});renderHighlightDistributionSnapshot(currentWorkspaceSnapshot);renderManualAnnotationSummary();renderLiteratureNoteDrawer();
   highlights.sync();
   const readerTools=BVSetupSidebarTools({d,demo,send});
   setupSidebarBatchActions();setupOutlineLevelControl();setupFigurePanelHeaderFieldsMenu();setupFigureKeyboardNavigation();
   byId('collapseAllFigureLevels').addEventListener('click',()=>setAllFigureLevelsExpanded(false));
   byId('toggleLiteratureNoteMarkdown').addEventListener('click',()=>setLiteratureNotePreview(!literatureNotePreviewing,{userInitiated:true}));
   byId('copyLiteratureNote').addEventListener('click',()=>void copyLiteratureNote());
   byId('exportLiteratureNoteMarkdown').addEventListener('click',()=>exportLiteratureNoteMarkdown());
   byId('articleChatMessages').addEventListener('click',async e=>{
     const button=e.target.closest('[data-article-chat-action]');if(!button)return;
     const turns=currentWorkspaceSnapshot.chat.turns,turn=turns.find(t=>t.turnId===button.dataset.turnId);if(!turn)return;
     const action=button.dataset.articleChatAction;
     if(action==='copy-answer'){try{await navigator.clipboard.writeText(turn.answer);send('toast',{message:'已复制回答'});}catch{send('toast',{message:'浏览器未允许复制，可选中回答手动复制。'});}return;}
     if(action==='delete-answer'){turn.answer='';turn.answerBlocks=[];}
     else {currentWorkspaceSnapshot.chat.turns=turns.filter(t=>t!==turn);if(action==='regenerate')await answer(turn.question);}
     demo.reading.chat=currentWorkspaceSnapshot.chat.turns;renderArticleChatSnapshot(currentWorkspaceSnapshot);
   });
   byId('literatureNoteTemplateSelect').addEventListener('change',()=>{
     literatureNoteDocumentState ||= {schemaVersion:3,valuesByTemplate:{},fieldStatusByTemplate:{},fieldEvidenceByTemplate:{},fieldUpdatedAtByTemplate:{}};
     literatureNoteDocumentState.templateId=byId('literatureNoteTemplateSelect').value;
     renderLiteratureNoteDrawer();
   });
   byId('clearArticleChat').addEventListener('click',()=>{currentWorkspaceSnapshot.chat.turns=[];demo.reading.chat=[];renderArticleChatSnapshot(currentWorkspaceSnapshot);});
   byId('refreshFigureInventory').addEventListener('click',()=>renderFigureWorkspaceSnapshot(currentWorkspaceSnapshot,{coordinated:true}));
   document.querySelectorAll('[data-workspace-target]').forEach(b=>{
     b.addEventListener('click',()=>switchMode(b.dataset.workspaceTarget));
     if(['notes','chat'].includes(b.dataset.workspaceTarget))b.addEventListener('dblclick',()=>generate(b.dataset.workspaceTarget));
   });
   document.addEventListener('submit',e=>{if(e.target.id==='articleChatForm'&&!window.BrevessUnifiedComposer?.isEditing()){e.preventDefault();e.stopImmediatePropagation();void submitArticleChat(e);}},true);
   byId('articleChatQuestion').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!window.BrevessUnifiedComposer?.isEditing()){e.preventDefault();void submitArticleChat(e);}});
   byId('saveCurrentArticleWorkspace').addEventListener('click',()=>send('save',{reading:demo.reading}));
   byId('refreshArticleNavigation').addEventListener('click',()=>{renderArticleNavigationTree(currentWorkspaceSnapshot);send('toast',{message:'大纲已刷新'});});
   document.querySelector('[aria-label="打开识别规则与模型设置"]')?.addEventListener('click',()=>send('install'));
   document.addEventListener('click',e=>{const a=e.target.closest('a');if(a?.hash.startsWith('#figure-')){e.preventDefault();send('jump',{id:a.hash.slice(1)});}});
   byId('literatureNoteForm').addEventListener('input',()=>{
     for(const field of document.querySelectorAll('[data-literature-note-field]'))demo.reading.notes[field.dataset.literatureNoteField]=field.value;
     if(literatureNoteDocumentState)literatureNoteDocumentState.valuesByTemplate[literatureNoteDocumentState.templateId]={...demo.reading.notes};
   });
   // Keep generated content, user edits and highlights on this page only.
   addEventListener('message',e=>{if(e.source!==parent||e.origin!==location.origin||e.data?.source!=='brevess-website')return;
     const m=e.data;if(m.type==='module')switchMode(m.module);if(m.type==='generate')generate(m.module||mode);if(m.type==='ask'){switchMode('chat');void answer(m.question);}
     if(m.type==='language')SciLLM.setInterfaceLanguage(m.language,document);
     if(m.type==='highlight-complete')highlights.complete();
     if(m.type==='annotations')highlights.receive(m);
     if(m.type==='abbreviation-add')readerTools.add(m.entry);
     if(m.type==='image-note'){
       demo.draft=SciLLM.applyFigureWorkspaceMutation(demo.draft,{type:'set_figure_field',figureId:m.figureId,field:'note',value:m.value,expectedRevision:demo.draft.revision});
       demo.reading.draft=structuredClone(demo.draft);currentWorkspaceSnapshot.figures.draft=demo.draft;
       renderFigureWorkspaceSnapshot(currentWorkspaceSnapshot,{coordinated:true});
     }
     if(m.type==='image-viewer'){
       const previous=figureOriginalViewerState.captionVisible;figureOriginalViewerState={...figureOriginalViewerState,...m.state};
       if(m.state.open&&m.state.captionVisible){switchMode('figures');showFigureCaptionSidebar(m.state.figureId);}
       else if(previous)hideFigureCaptionSidebar(m.state.figureId);
     }
   });
   switchMode('navigation');demo.ready=true;demo.generate=generate;demo.send('ready',{surface:'sidebar'});
  }catch(e){__websiteDemo.errors.push(e.stack);console.error(e);}
 };
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
