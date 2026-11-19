
;/* native-transport.js */
/* Isolated website adapter. Does not connect to the installed extension. */
(() => {
  'use strict';
  try{document.documentElement.lang=parent.document.documentElement.lang||'zh-CN';}catch{}
  if(document.documentElement.style)document.documentElement.style.overscrollBehaviorY='contain';
  const events=()=>({addListener(){},removeListener(){},hasListener(){return false;}});
  const tablePage=location.pathname.endsWith('/table-viewer.html');
  const actionPage=location.pathname.endsWith('/action-popup.html');
  const tableKey='brevess.tableView.'+location.hash.slice(1);
  const values={sciLlmSettingsV2:{language:document.documentElement.lang},...(tablePage&&parent!==window?{[tableKey]:parent.__bvTableSnapshots?.[tableKey]}:{})};
  if(tablePage){delete parent.__bvTableSnapshots?.[tableKey];window.close=()=>parent.postMessage({source:'brevess-native-demo',type:'close-table'},location.origin);}
  const store={get:async keys=>keys==null?{...values}:typeof keys==='string'?{[keys]:values[keys]}:Array.isArray(keys)?Object.fromEntries(keys.map(k=>[k,values[k]])):{...keys,...values},set:async x=>{Object.assign(values,x);},remove:async keys=>{for(const k of [].concat(keys))delete values[k];}};
  const sourceURL=new URL(document.baseURI);
  const base=new URL(sourceURL.pathname.includes('/workbench/')||sourceURL.pathname.includes('/literature-radar/')?'../':'./',sourceURL);
  const endpoint={onMessage:events(),onDisconnect:events(),postMessage(){},disconnect(){}};
  window.__websiteDemo={errors:[],messages:[],base,send:(type,data={})=>parent.postMessage({source:'brevess-native-demo',type,...data},location.origin)};
  if(actionPage)window.close=()=>__websiteDemo.send('close-tools');
  document.addEventListener('pointerdown',()=>{let view=parent;while(view!==window){try{view.postMessage({source:'brevess-native-demo',type:'pointerdown'},location.origin);if(view===view.parent)break;view=view.parent;}catch{break;}}},true);
  addEventListener('error',e=>__websiteDemo.errors.push(e.message));addEventListener('unhandledrejection',e=>__websiteDemo.errors.push(String(e.reason?.stack||e.reason)));
  const call=async m=>{
    __websiteDemo.messages.push(m.type||m.action);
    if(__websiteDemo.messages.length>100)__websiteDemo.messages.shift();
    if(window.__websiteDemo.handleMessage)return __websiteDemo.handleMessage(m);
    return {success:true,data:{items:[],entries:[],pageCount:1,results:[],permission:'unavailable'}};
  };
  const runtimeCall=(m,callback)=>{const pending=call(m);if(callback){pending.then(callback,error=>callback({success:false,error:{message:error.message}}));return;}return pending;};
  window.chrome={storage:{local:store,sync:store,session:store,onChanged:events()},i18n:{getMessage:k=>k,getUILanguage:()=>document.documentElement.lang||'zh-CN'},runtime:{id:'brevess-website-demo',getURL:p=>new URL(p,base).href,getManifest:()=>({name:'BREVESS',version:'1.0.2'}),onMessage:events(),onConnect:events(),connect:()=>endpoint,sendMessage:runtimeCall,openOptionsPage:()=>__websiteDemo.send('install')},tabs:{query:async()=>[{id:1,url:window.BV_DEMO_DATA?.source||'https://www.nature.com/articles/s41586-021-03819-2',title:window.BV_DEMO_DATA?.title||'Highly accurate protein structure prediction with AlphaFold',active:true}],get:async()=>({id:1,url:window.BV_DEMO_DATA?.source||'https://www.nature.com/articles/s41586-021-03819-2'}),onActivated:events(),onUpdated:events(),onRemoved:events(),sendMessage:async(id,m)=>call(m),create:async options=>{__websiteDemo.send(options?.url?.includes('/workbench/index.html')?'workbench':'install');return {id:1};}},windows:{create:async options=>{const u=new URL(options.url);if(u.origin===location.origin&&u.pathname.endsWith('/table-viewer.html')){const key='brevess.tableView.'+u.hash.slice(1);__websiteDemo.send('table',{url:u.href,key,value:values[key]});delete values[key];return {id:1};}__websiteDemo.send('install');return {id:1};},getCurrent:async()=>({id:1}),onFocusChanged:events()},permissions:{contains:async()=>false},sidePanel:{setOptions:async()=>{}},scripting:{executeScript:async()=>[]}};
  // Account setup and local-file imports need extension privileges. Keep those
  // routes explicit instead of opening a half-configured website copy.
  const installOnly=new Set(['external-agent','agent','upload','import','import-share','library-import','sync']);
  document.addEventListener('click',e=>{
    const b=e.target.closest('button,a'), action=b?.dataset.action;
    const link=b?.tagName==='A'&&/\/(?:options|history|pdf-reader)\.html/.test(b.getAttribute('href')||'');
    if(installOnly.has(action)||link){e.preventDefault();e.stopImmediatePropagation();__websiteDemo.send('install');}
  },true);
  addEventListener('keydown',e=>{if(e.key==='Escape'&&!e.defaultPrevented&&!document.querySelector('dialog[open]'))__websiteDemo.send('escape');});
  // The production popup's connection/bootstrap is replaced; its renderers and UI code remain unchanged.
  const add=document.addEventListener.bind(document);
  document.addEventListener=function(type,listener,options){if(type==='DOMContentLoaded'&&document.currentScript?.src.endsWith('/popup.js'))return;return add(type,listener,options);};
})();


;/* paper-data.js */
/* Public-paper excerpts, with editorial translations and example interpretations.
 * Jumper et al., Nature (2021), DOI 10.1038/s41586-021-03819-2, CC BY 4.0.
 * No API responses or personal reading records are loaded by this demo. */
window.BV_DEMO_DATA = {
  title: 'Highly accurate protein structure prediction with AlphaFold',
  source: 'https://www.nature.com/articles/s41586-021-03819-2',
  paragraphs: [
    { id: 'abstract', heading: 'Abstract', text: 'Proteins are essential to life, and understanding their structure can facilitate a mechanistic understanding of their function. Through an enormous experimental effort, the structures of around 100,000 unique proteins have been determined, but this represents a small fraction of the billions of known protein sequences.', zh: '蛋白质对生命至关重要，理解其结构有助于从机制上理解其功能。经过大量实验工作，约十万种独特蛋白质的结构已被测定，但这仅占数十亿条已知蛋白质序列的一小部分。', summary: ['从序列预测结构，弥补实验解析的规模瓶颈。', 'Predicting structure from sequence addresses the scale limit of experimental structure determination.'] },
    { id: 'accuracy', heading: 'The accuracy of AlphaFold', text: 'Here we provide the first computational method that can regularly predict protein structures with atomic accuracy even in cases in which no similar structure is known. We validated an entirely redesigned version of our neural network-based model, AlphaFold, in the challenging 14th Critical Assessment of protein Structure Prediction (CASP14), demonstrating accuracy competitive with experimental structures in a majority of cases and greatly outperforming other methods.', zh: '本文提出一种计算方法，即使没有已知的相似结构，也能经常以原子级精度预测蛋白质结构。作者在第十四届蛋白质结构预测关键评估（CASP14）中验证了重新设计的 AlphaFold 神经网络模型，多数情况下的精度可与实验结构相媲美，并显著优于其他方法。', summary: ['CASP14 盲测检验预测精度；高精度不代表所有目标都可靠。', 'CASP14 blind assessment tests accuracy; high overall accuracy does not guarantee every target.'] },
    { id: 'network', heading: 'The AlphaFold network', text: 'Underpinning the latest version of AlphaFold is a novel machine learning approach that incorporates physical and biological knowledge about protein structure, leveraging multi-sequence alignments, into the design of the deep learning algorithm.', zh: '这一版 AlphaFold 的核心是一种新的机器学习方法：借助多序列比对，将蛋白质结构的物理与生物学知识纳入深度学习算法设计。', summary: ['MSA 与残基对表示在 Evoformer 中交互，再由结构模块输出坐标。', 'MSA and pair representations interact in the Evoformer before the structure module predicts coordinates.'] },
    { id: 'interpretation', heading: 'Interpreting the neural network', text: 'a, Ablation results on two target sets: the CASP14 set of domains (n = 87 protein domains) and the PDB test set of chains with template coverage of ≤30% at 30% identity (n = 2,261 protein chains). Domains are scored with GDT and chains are scored with lDDT-Cα.', zh: 'a，两个目标集合上的消融结果：CASP14 结构域集合（87 个蛋白质结构域），以及在 30% 序列同一性下模板覆盖率不超过 30% 的 PDB 链测试集（2,261 条蛋白质链）。结构域使用 GDT 评分，链使用 lDDT-Cα 评分。', caption: true, summary: ['消融实验比较不同组件对精度的贡献；注意两个测试集使用不同指标。', 'Ablations compare component contributions; the two test sets use different accuracy metrics.'] },
    { id: 'msa', heading: 'MSA depth and cross-chain contacts', text: 'The model uses MSAs and the accuracy decreases substantially when the median alignment depth is less than around 30 sequences (see Fig. 5a for details). We observe a threshold effect where improvements in MSA depth over around 100 sequences lead to small gains.', zh: '该模型使用多序列比对（MSA）；当比对深度中位数低于约 30 条序列时，精度明显下降（见图 5a）。作者观察到阈值效应：深度超过约 100 条序列后，进一步增加深度带来的收益较小。', summary: ['MSA 很浅时精度明显下降；超过约 100 条序列后收益趋缓。', 'Very shallow MSAs reduce accuracy; gains become smaller beyond roughly 100 sequences.'] }
  ],
  figures: [
    { id: 1, width: 1200, height: 768, section: 'accuracy', title: 'AlphaFold produces highly accurate structures.', takeaway: ['先看盲测总体表现，再核对具体结构与模型流程。', 'Start with blind-test performance, then inspect individual structures and the model pipeline.'], panels: [
      ['a', 'CASP14 整体表现', '比较 87 个蛋白质结构域上的预测表现。点与误差区间报告中位数及其 95% 置信区间；这是总体表现，不是每个蛋白都达到同样精度。', 'CASP14 performance', 'Compares predictions on 87 protein domains. Points and intervals report the median and its 95% confidence interval, not a guarantee for every protein.'],
      ['b–d', '预测结构与实验结构', 'b：T1049；c：T1056 的锌结合位点，模型并未显式预测锌离子；d：2,180 残基的 T1044，展示结构域堆积。蓝色为预测，绿色为实验结构。', 'Predictions against experimental structures', 'b: T1049. c: the zinc-binding site of T1056, although zinc itself is not explicitly predicted. d: domain packing in the 2,180-residue T1044. Blue is predicted; green is experimental.'],
      ['e', '端到端模型流程', '沿箭头追踪 MSA、成对表示和结构模块之间的信息流。该 panel 展示架构；不能仅凭流程图推断某一组件的独立贡献。', 'End-to-end architecture', 'Follow information flow through MSA, pair representation and the structure module. Architecture alone does not establish each component’s contribution.']
    ] },
    { id: 2, width: 1057, height: 1741, section: 'accuracy', title: 'Accuracy of AlphaFold on recent PDB structures.', takeaway: ['区分局部置信度与整链构象的可靠性。', 'Distinguish local confidence from reliability of whole-chain structure.'], panels: [
      ['a', '独立时间测试集', '测试结构晚于训练集。经模板和冗余过滤，3,144 条蛋白质链的骨架 RMSD 中位数为 1.46 Å；该指标对结构域堆积敏感。', 'A temporally held-out test set', 'Test structures postdate training data. After filtering, 3,144 chains have a median backbone RMSD of 1.46 Å, a metric sensitive to domain packing.'],
      ['b–d', '精度与置信度', 'b 比较骨架与侧链准确度；c 检验 pLDDT 与实际局部精度的关系；d 检验 pTM 与整链 TM-score 的关系。置信度可辅助筛选，但不是实验验证。', 'Accuracy and confidence', 'b compares backbone and side-chain accuracy; c relates pLDDT to local accuracy; d relates pTM to whole-chain TM-score. Confidence helps prioritization but does not replace experiments.']
    ] },
    { id: 3, width: 1200, height: 899, section: 'network', title: 'Architectural details.', takeaway: ['从共进化信息到几何约束，再到三维坐标。', 'From co-evolutionary information to geometric constraints and 3D coordinates.'], panels: [
      ['a–c', 'Evoformer 与三角更新', 'a 展示 MSA 与成对表示的交互；b 将残基对理解为有向图的边；c 通过三角乘法更新和三角自注意力，整合残基间的几何关系。', 'Evoformer and triangle updates', 'a links MSA and pair representations; b treats residue pairs as directed graph edges; c integrates geometric relationships via triangle multiplication and attention.'],
      ['d–f', '结构模块与训练误差', 'd 为含 IPA 的结构模块；e 用独立刚体和侧链角表示残基；f 为帧对齐点误差 FAPE。结构模块将表示转成坐标，FAPE 用于衡量预测与真实结构的偏差。', 'Structure module and training error', 'd shows the IPA-containing structure module; e represents residues as rigid bodies and side-chain angles; f shows frame-aligned point error, comparing predicted and true structures.']
    ] },
    { id: 4, width: 1061, height: 1389, section: 'interpretation', title: 'Interpreting the neural network.', takeaway: ['用消融检验组件，用轨迹观察迭代精化。', 'Ablations test components; trajectories reveal iterative refinement.'], panels: [
      ['a', '消融实验', '比较 CASP14 结构域与 PDB 链测试集，相对三个基线种子的平均值报告精度变化。两个集合使用不同评分，不能直接把纵轴当作同一个量比较。', 'Ablation experiments', 'Accuracy changes are relative to three baseline seeds on CASP14 domains and PDB chains. The two sets use different scores, so their vertical axes are not interchangeable.'],
      ['b', 'Recycling 迭代轨迹', '每轮 recycling 包含 48 个 Evoformer blocks。T1024 较早达到正确结构，T1064 则经历多次变化；不同蛋白对网络深度的依赖并不相同。', 'Recycling trajectories', 'Each recycle contains 48 Evoformer blocks. T1024 converges early, while T1064 changes repeatedly; dependence on network depth varies by target.']
    ] },
    { id: 5, width: 1200, height: 426, section: 'msa', title: 'Effect of MSA depth and cross-chain contacts.', takeaway: ['把序列信息深度作为后续实验验证的一个线索。', 'Use sequence-information depth as one clue when prioritizing experimental validation.'], panels: [
      ['a', 'MSA 深度与精度', '按模板覆盖率分组比较骨架精度与 MSA 深度。阴影为 bootstrap 95% 置信区间。正文指出低于约 30 条序列时精度下降，超过约 100 条后收益较小。', 'MSA depth and accuracy', 'Backbone accuracy is compared with MSA depth in template-coverage groups. Shading is the bootstrap 95% confidence interval. The text notes lower accuracy below about 30 sequences and smaller gains beyond about 100.'],
      ['b', '同源多聚体示例', '6SK0 为相互缠绕的同源三聚体：蓝色为预测，绿色为实验。这个成功示例不能推广为模型能可靠预测所有复合物。', 'A homomeric example', '6SK0 is an intertwined homotrimer: blue is predicted, green is experimental. This successful example does not demonstrate reliable prediction of every complex.']
    ] }
  ],
  questions: [
    { id: 'msa', q: ['AlphaFold 为什么需要 MSA？', 'Why does AlphaFold need an MSA?'], answer: ['MSA 提供同源序列中的变化模式，帮助模型推断哪些残基之间可能存在结构约束。Evoformer 让 MSA 表示与成对表示持续交换信息，结构模块再把这些信息转为三维坐标。', 'MSAs provide patterns of variation across homologous sequences, helping the model infer structural constraints between residues. The Evoformer exchanges information between MSA and pair representations before the structure module predicts 3D coordinates.'], details: ['图 5a 与正文给出了一个实际边界：当比对深度中位数低于约 30 条序列时，准确度明显下降；超过约 100 条后，收益趋缓。这是所分析数据的观察，不是对每个蛋白的硬阈值。', 'Figure 5a and the text show a practical limitation: accuracy falls when median alignment depth is below about 30 sequences, while gains diminish above about 100. This is an observation in the analyzed data, not a hard threshold for each protein.'], refs: [3,5] },
    { id: 'architecture', q: ['Evoformer、结构模块和 recycling 如何分工？', 'How do Evoformer, the structure module and recycling work together?'], answer: ['Evoformer 处理 MSA 和残基对表示；结构模块通过几何推理生成三维结构；recycling 将上一轮预测的信息送回网络，继续精化。它们分别承担信息整合、坐标生成和迭代改进。', 'The Evoformer processes MSA and residue-pair representations. The structure module produces 3D structure through geometric reasoning. Recycling feeds information from a previous prediction back into the network for refinement.'], details: ['图 3 展示模块内部结构，图 4b 展示不同蛋白的迭代轨迹。有的目标很早收敛，有的需要接近完整网络深度，因此不能把单个成功案例当作所有目标的规律。', 'Figure 3 shows the component architecture; Figure 4b shows trajectories for different proteins. Some converge early and others need nearly the full depth, so a single successful case is not a universal rule.'], refs: [3,4] },
    { id: 'limits', q: ['哪些结论还需要实验验证？', 'Which conclusions still need experimental validation?'], answer: ['高结构预测精度不等于已经证明蛋白质的生物学功能、相互作用或动态构象。pLDDT 反映模型的局部置信度，也不能单独证明这些机制。', 'High structure-prediction accuracy does not establish biological function, interactions or dynamic conformations. Local pLDDT confidence cannot by itself prove those mechanisms.'], details: ['阅读时可以把低置信区域、浅 MSA 和依赖链间接触的区域列为核对重点，再结合具体生物学问题设计实验。这里的验证优先级是一种研究规划示例，不是原论文报告的实验结论。', 'Flag low-confidence regions, shallow MSAs and regions depending on inter-chain contacts, then design experiments around the biological question. This prioritization is a research-planning example, not an experimental result of the paper.'], refs: [2,5] }
  ]
};


;/* native-data.js */
/* Public, curated reading data. The UI is the production BREVESS UI. */
(() => {
  const d=window.BV_DEMO_DATA, demo=window.__websiteDemo;
  const en=()=>document.documentElement.lang==='en',t=value=>window.BV_I18N?.text(value)||value;
  demo.workspaceId='workspace:'+'a'.repeat(64);
  demo.reading={figures:[],annotations:[],notes:{},chat:[]};
  demo.profile={settings:{language:'zh-CN',consentGranted:true,globalProfileId:'example',profileOrder:['example'],profiles:{example:{name:en()?'Prepared AI example':'预置 AI 示例',providerId:'deepseek',config:{model:'prepared-example',hasApiKey:true}}},taskPolicies:{}}};
  demo.figureResult=f=>({figureId:'Fig'+f.id,figureQuestion:f.title,coreConclusion:f.takeaway[en()?1:0],claimBoundary:t('预置阅读示例；依据公开论文和图注整理。请结合原文核对。'),panels:f.panels.flatMap(g=>{
    const parts=g[0].split('–'),letters=parts.length===2?Array.from({length:parts[1].charCodeAt(0)-parts[0].charCodeAt(0)+1},(_,i)=>String.fromCharCode(parts[0].charCodeAt(0)+i)):[parts[0]];
    return letters.map(panelId=>({panelId,panel:panelId,purpose:g[en()?3:1],evidenceType:t('论文图示'),directObservation:g[en()?4:2],observationSource:'caption_statement',localInference:f.takeaway[en()?1:0],design:letters.length>1?(en()?'Combined explanation of panels ':'此段合并说明 panels ')+g[0]:'',methods:[],statisticalMethods:[]}));
  })});
  demo.figures=()=>d.figures.map(f=>({figureId:'Fig'+f.id,figureLabel:'Fig'+f.id,label:'Fig'+f.id,title:f.title,caption:'Fig. '+f.id+': '+f.title,imageUrl:new URL('../figure-'+f.id+'.png',demo.base).href,activeDepth:'standard',...(demo.reading.figures.includes(f.id)?{standard:demo.figureResult(f),analysis:demo.figureResult(f)}:{}),panelDirectoryTrusted:true,panelHints:demo.figureResult(f).panels.map(p=>p.panelId)}));
  demo.structure=()=>({title:d.title,url:d.source,localWorkspace:{workspaceId:demo.workspaceId,workspaceGeneration:1,canonicalUrl:d.source,contentHash:'a'.repeat(64)},documentId:d.documentId||'alphafold-example',documentHash:'a'.repeat(64),revision:1,paragraphs:d.paragraphs.map(p=>({paragraphId:p.id,sectionId:p.sectionId||p.id,text:p.text})),nodes:d.outline||d.paragraphs.map((p,i)=>({sectionId:p.id,title:p.heading,level:p.level||2,order:i,children:[],paragraphCount:1,analysisSectionIds:[p.id],analysisSelected:true}))});
  demo.paper=()=>({...(d.web?{paperId:d.documentId,sourceKind:'webpage',journal:d.publisher}:{paperId:'alphafold-2021',doi:'10.1038/s41586-021-03819-2',authors:'John Jumper, Richard Evans, Alexander Pritzel et al.',journal:'Nature',publicationDate:'2021-07-15',createdAt:'2021-07-15T00:00:00Z'}),title:d.title,url:d.source,abstract:d.paragraphs[0].text,sourceDocuments:[{workspaceId:demo.workspaceId,workspaceGeneration:1,title:d.title,sourceKind:d.web?'webpage':'article',url:d.source,hasOfflineSnapshot:true,offlineSnapshotStatus:'complete'}]});
  demo.assets=()=>[
    {relativePath:'article/structure.json',content:demo.structure()},
    {relativePath:'figures/inventory.json',content:{figures:demo.figures()}},
    ...(demo.reading.draft?[{relativePath:'figures/workspace-draft.json',content:demo.reading.draft}]:[]),
  ].map(a=>({...a,revision:a.relativePath==='figures/workspace-draft.json'?Math.max(1,Number(a.content.revision)||1):1,contentHash:'a'.repeat(64)}));
  demo.handleMessage=async m=>{
    const ok=data=>({success:true,data});
    if(m.type==='ACTION_POPUP_GET_STATE')return ok({tabId:1,pageDocumentId:d.documentId||'public-alphafold-demo',pageUrl:d.source,title:d.title,nonce:'public-demo',readable:true,setupPending:false,pageTools:structuredClone(parent.__bvPageTools)});
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
      const state={tabId:1,navigationUrl:d.source,url:d.source,documentKey:d.documentId||'alphafold-example',title:d.title,sourceIds:[1],referenceIds:[],targets:[],turns:[],adjusting:false,adjustmentMode:'display',busy:false,plan:null,notice:''};
      if(m.command==='LIST')return {ok:true,data:[{id:1,url:d.source,title:d.title}]};
      if(m.command==='OUTLINE')return {ok:true,data:{tabId:1,nodes:[]}};
      return {ok:true,data:state};
    }
    if(m.type==='LOCAL_READING_LIBRARY_QUERY'){
      const match=!m.query||[d.title,d.publisher||'Nature',...d.paragraphs.map(p=>p.text)].some(s=>s.toLowerCase().includes(m.query.toLowerCase()));
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


;/* native/core/translation-checkpoint.js */
(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BrevessTranslationCheckpoint = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  'use strict';
  const VERSION = 1;
  const LOCAL_SIGNATURE = 'browser-translator:en:zh:validated-prefix-v2';
  function navigationIdentity(value) {
    try { const url = new URL(value); url.hash = ''; return url.href; }
    catch { return String(value || '').replace(/#.*/, ''); }
  }
  function stableBinding(value) {
    const url = navigationIdentity(value?.pageUrl || value?.navigationIdentity || value?.url);
    if (!/^https?:\/\//u.test(url)) return null;
    return { url, ...(typeof value?.documentHash === 'string' && value.documentHash
      ? { documentHash: value.documentHash } : {}) };
  }
  function sourceKey(element) {
    const path = [];
    for (let node = element; node?.nodeType === 1; node = node.parentElement) {
      const tag = String(node.tagName || '').toLowerCase();
      if (!tag) return null;
      // Plugin output never changes paragraph positions in this anchor.
      const siblings = [...(node.parentElement?.children || node.parentElement?.childNodes || [])]
        .filter(item => item.nodeType === 1 && item.tagName === node.tagName &&
          !item.matches?.('[data-sci-plugin-ui],[data-sci-translation]'));
      path.unshift(`${tag}:${Math.max(0, siblings.indexOf(node))}`);
      if (path.length > 64) return null;
    }
    return path.length ? `dom:${path.join('/')}` : null;
  }
  function normalizeScientificContext(sourceText, value) {
    if (value == null || value === '') return [];
    if (!Array.isArray(value) || value.length > 2000 || JSON.stringify(value).length > 200000) throw error('TRANSLATION_INVALID_REQUEST');
    let end = 0;
    return value.flatMap(item => {
      if (!item || Object.keys(item).some(key => !['sourceStart','sourceEnd','text','displayText'].includes(key)) ||
          !Number.isSafeInteger(item.sourceStart) || item.sourceStart < end || !Number.isSafeInteger(item.sourceEnd) ||
          item.sourceEnd <= item.sourceStart || item.sourceEnd > sourceText.length ||
          typeof item.text !== 'string' || item.text !== sourceText.slice(item.sourceStart, item.sourceEnd) ||
          typeof item.displayText !== 'string') throw error('TRANSLATION_INVALID_REQUEST');
      end = item.sourceEnd;
      const displayText = item.displayText.trim();
      return !displayText || displayText === item.text ? [] : [{sourceStart:item.sourceStart, sourceEnd:item.sourceEnd, text:item.text, displayText}];
    });
  }
  function sliceScientificContext(sourceText, value, start, end) {
    return normalizeScientificContext(sourceText, value).flatMap(item => {
      if (item.sourceEnd <= start || item.sourceStart >= end) return [];
      if (item.sourceStart < start || item.sourceEnd > end) throw error('TRANSLATION_INVALID_REQUEST');
      return [{...item, sourceStart:item.sourceStart-start, sourceEnd:item.sourceEnd-start}];
    });
  }
  function normalizeEntry(value) {
    if (!value || typeof value.sourceKey !== 'string' || !value.sourceKey ||
        typeof value.sourceText !== 'string' || !value.sourceText || value.sourceText.length > 200000 ||
        typeof value.translatedText !== 'string' || !value.translatedText.trim() || value.translatedText.length > 200000 ||
        value.sourceStart !== 0 || !Number.isInteger(value.sourceEnd) || value.sourceEnd <= 0 || value.sourceEnd > value.sourceText.length ||
        typeof value.engineSignature !== 'string' || !value.engineSignature ||
        value.sourceLanguage !== 'en' || value.targetLanguage !== 'zh' || value.confirmed !== true) return null;
    let scientificContext;
    try { scientificContext = normalizeScientificContext(value.sourceText, value.scientificContext);
      sliceScientificContext(value.sourceText, scientificContext, 0, value.sourceEnd); }
    catch { return null; }
    const partial = value.sourceEnd < value.sourceText.length;
    // Manual edits remain valid confirmed output but never become native-model prefixes.
    return { sourceKey: value.sourceKey, sourceText: value.sourceText, translatedText: value.translatedText,
      sourceStart: 0, sourceEnd: value.sourceEnd, partial, sourceLanguage: 'en', targetLanguage: 'zh',
      engineSignature: value.engineSignature, confirmed: true, manuallyEdited: value.manuallyEdited === true,
      ...(scientificContext.length ? { scientificContext } : {}) };
  }
  function error(code) { return Object.assign(new Error(code), { code }); }
  async function sha256(value, cryptoApi = globalThis.crypto) {
    if (!cryptoApi?.subtle?.digest) throw error('TRANSLATION_CHECKPOINT_DIGEST_UNAVAILABLE');
    const bytes = await cryptoApi.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }
  // Instantiate once in the background. Serialization must span every tab, not
  // just one content script. No schema migration or deletion of older data.
  function createStore({ storage, crypto: cryptoApi = globalThis.crypto } = {}) {
    let tail = Promise.resolve();
    function serialize(run) {
      const next = tail.then(run, run); tail = next.catch(() => {}); return next;
    }
    async function keyFor(binding, engineSignature) {
      const documentBinding = stableBinding(binding);
      if (!documentBinding || typeof engineSignature !== 'string' || !engineSignature) throw error('TRANSLATION_CHECKPOINT_IDENTITY_REQUIRED');
      return { documentBinding, key: 'brevess.translation.checkpoint.v1.' + await sha256(JSON.stringify([documentBinding, engineSignature]), cryptoApi) };
    }
    function read(binding, engineSignature) { return serialize(async () => {
      const { key, documentBinding } = await keyFor(binding, engineSignature);
      const saved = (await storage.get(key))?.[key];
      if (!saved) return { version: VERSION, documentBinding, engineSignature, revision: 0, translations: [] };
      if (saved.version !== VERSION || JSON.stringify(saved.documentBinding) !== JSON.stringify(documentBinding) || saved.engineSignature !== engineSignature) {
        throw error('TRANSLATION_CHECKPOINT_IDENTITY_MISMATCH');
      }
      return { version: VERSION, documentBinding, engineSignature, revision: Number(saved.revision) || 0,
        translations: (Array.isArray(saved.translations) ? saved.translations : []).map(normalizeEntry).filter(Boolean) };
    }); }
    function write(binding, engineSignature, incoming, { expectedRevision } = {}) { return serialize(async () => {
      const { key, documentBinding } = await keyFor(binding, engineSignature);
      const saved = (await storage.get(key))?.[key];
      if (saved && (saved.version !== VERSION || JSON.stringify(saved.documentBinding) !== JSON.stringify(documentBinding) || saved.engineSignature !== engineSignature)) {
        throw error('TRANSLATION_CHECKPOINT_IDENTITY_MISMATCH');
      }
      if (expectedRevision !== undefined && expectedRevision !== (Number(saved?.revision) || 0)) throw error('TRANSLATION_CHECKPOINT_REVISION_STALE');
      const identity = entry => JSON.stringify([entry.sourceKey, entry.sourceText,
        ...(entry.scientificContext ? [entry.scientificContext] : [])]);
      const entries = new Map((saved?.translations || []).map(normalizeEntry).filter(Boolean).map(entry => [identity(entry), entry]));
      for (const value of incoming || []) {
        const entry = normalizeEntry(value);
        if (!entry || entry.engineSignature !== engineSignature) continue;
        const old = entries.get(identity(entry));
        // Automatic writes cannot replace manual output or regress a prefix.
        if (old?.sourceText === entry.sourceText && ((old.manuallyEdited && !(entry.manuallyEdited && expectedRevision !== undefined)) ||
            (!entry.manuallyEdited && old.sourceEnd > entry.sourceEnd))) continue;
        entries.set(identity(entry), entry);
      }
      const translations = [...entries.values()];
      if (translations.length > 2000 || JSON.stringify(translations).length > 2000000) throw error('TRANSLATION_CHECKPOINT_LIMIT');
      const result = { version: VERSION, documentBinding, engineSignature,
        revision: (Number(saved?.revision) || 0) + 1, translations };
      await storage.set({ [key]: result }); return result;
    }); }
    return { read, write };
  }
  return { VERSION, LOCAL_SIGNATURE, stableBinding, sourceKey, normalizeEntry, createStore, normalizeScientificContext, sliceScientificContext };
});

