
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
  window.chrome={storage:{local:store,sync:store,session:store,onChanged:events()},i18n:{getMessage:k=>k,getUILanguage:()=>document.documentElement.lang||'zh-CN'},runtime:{id:'brevess-website-demo',getURL:p=>new URL(p,base).href,getManifest:()=>({name:'BREVESS',version:'1.0.2'}),onMessage:events(),onConnect:events(),connect:()=>endpoint,sendMessage:runtimeCall,openOptionsPage:()=>__websiteDemo.send('install')},tabs:{getCurrent:async()=>({id:1,windowId:1,url:document.baseURI}),query:async()=>[{id:1,url:window.BV_DEMO_DATA?.source||'https://www.nature.com/articles/s41586-021-03819-2',title:window.BV_DEMO_DATA?.title||'Highly accurate protein structure prediction with AlphaFold',active:true}],get:async()=>({id:1,url:window.BV_DEMO_DATA?.source||'https://www.nature.com/articles/s41586-021-03819-2'}),onActivated:events(),onUpdated:events(),onRemoved:events(),sendMessage:async(id,m)=>call(m),create:async options=>{__websiteDemo.send(options?.url?.includes('/workbench/index.html')?'workbench':'install');return {id:1};}},windows:{create:async options=>{const u=new URL(options.url);if(u.origin===location.origin&&u.pathname.endsWith('/table-viewer.html')){const key='brevess.tableView.'+u.hash.slice(1);__websiteDemo.send('table',{url:u.href,key,value:values[key]});delete values[key];return {id:1};}__websiteDemo.send('install');return {id:1};},getCurrent:async()=>({id:1}),onFocusChanged:events()},permissions:{contains:async()=>false},sidePanel:{setOptions:async()=>{}},scripting:{executeScript:async()=>[]}};
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


;/* native/ui-focus.js */
/* Text inputs match :focus-visible after a click too; track actual input modality. */
(() => {
  document.documentElement.dataset.brevessFocus='pointer';
  document.addEventListener('pointerdown',()=>{document.documentElement.dataset.brevessFocus='pointer';},true);
  document.addEventListener('keydown',event=>{if(!event.metaKey&&!event.ctrlKey&&!event.altKey&&['Tab','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End'].includes(event.key))document.documentElement.dataset.brevessFocus='keyboard';},true);
})();


;/* native/core/ui-action-icons.js */
(function(root,factory){
  if(root.SciLLM?.ACTION_ICONS_REVISION==='r18'&&!(typeof module==='object'&&module.exports))return;
  const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;
  Object.assign(root.SciLLM ||= {},api);
})(globalThis,function(root){
  'use strict';
  // Explicit interface labels only. Do not infer actions from article/user text
  // or collapse distinct export formats, authorization decisions and toggles.
  const labels={
    close:['关闭','关闭原图','关闭图表梳理','关闭论文证据台账','关闭编辑面板','关闭步骤编辑','关闭可见性设置','取消','收起提示','Close','Close original image','Cancel','Dismiss','×','✕','✖','✖️'],
    refresh:['刷新','刷新状态','刷新共享库','刷新权限','刷新访问权限','刷新音色','↻ 共享课题','读取最新标签','Refresh','Refresh status','Reload'],
    save:['保存','保存笔记','保存名称','保存人工修订','保存功能设置','保存显示列','保存朗读设置','保存标签','保存步骤','保存组','保存网址白名单','保存证据块','保存连接','保存阅读场景','保存雷达','保存 PDF 解析设置','Save','Save notes'],
    copy:['复制','复制笔记','复制配置提示词','Copy'],
    trash:['删除','删除字段','删除当前场景','删除标注','删除模板','删除笔记','删除组','删除联系','删除节点','删除所选节点','删除证据块','移除','移除组','移除条目','移除关联','移除引用','移除此证据','移除绑定','移除表格','移除附加项','移入回收站','移出','清空选择','Delete','Remove'],
    edit:['编辑','编辑情境与类别','编辑拐点','编辑检索式','编辑规则','编辑证据块','编辑资料','修改判断 / 备注','查看/编辑规则','Edit'],
    search:['搜索','打开检索','Search'],
    add:['添加','新增','创建','新增动作','新增场景','新增字段','新增提示词','新增文献','新增标签组','新增模板','新增缩略词','新增追问','添加标签','添加步骤','添加识别类别','增加列','增加行','＋ 节点','Add','New','+','＋'],
    minus:['−'],
    undo:['撤销','↶','Undo'],redo:['重做','↷','Redo'],
    retry:['重试','重试保存','重试同步','重试本地翻译','Retry'],
    download:['导出','完整导出','导出原件','导出词库','导出本类别','备份标签与资料','立即备份配置','Export','Download'],
    upload:['导入 JSON','导入资料备份','添加 PDF / HTML 附件','＋ 自有图片','Import','Upload'],
    back:['← 返回','← 返回 PDF','← 返回原论文正文','返回上处','返回整图','返回登录','返回缩写表','返回设置概览','返回账号','Back'],
    previous:['上一页','上一图','‹','Previous'],next:['下一页','›','Next'],
    up:['上移','↑','Move up'],down:['下移','↓','Move down'],
    more:['更多','⋯','More'],help:['帮助','Help'],
    done:['完成','确认','Done','Confirm'],
    open:['打开','打开 PDF','打开原文','打开远程 PDF','查看原始 PDF','Open'],
    logout:['退出登录','Log out','Sign out'],
    stop:['停止','停止朗读','停止检查','停止生成','取消分析','取消图解','取消导出','取消机制链生成','Stop'],
    pause:['暂停分析','暂停图解','暂停自动检查','Pause'],
    play:['点击播放','试听中文','试听英文','Play'],
    restore:['恢复','恢复组','恢复条目','恢复关联','恢复草稿','恢复预设','恢复默认','Restore','Reset'],
    folder:['打开文件夹','选择目录','Open folder'],
    zoomIn:['放大','Zoom in'],zoomOut:['缩小','Zoom out'],
    fit:['适宽','适应','适应画布','适应文字高度','Fit'],
    chat:['AI 提问','AI提问','Panel 追问','Ask AI'],
    settings:['模型设置','翻译设置','识别设置','打开 MinerU 设置','Settings'],
    link:['Agent 连接','Agent connection'],
    check:['检测连接','检查连接','检测连接组件','Check connection'],
    reconnect:['重连 MCP','Reconnect MCP']
  };
  // One monochrome, 24-unit line vocabulary. No font, image or network dependency.
  const paths={
    close:'M6 6l12 12M18 6 6 18',
    save:'M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12l4 4v12a2 2 0 0 1-2 2ZM7 3v6h10V3M7 21v-8h10v8',
    copy:'M9 9h12v12H9zM15 9V3H3v12h6',
    trash:'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7',
    edit:'m16 3 5 5-12 12-6 1 1-6L16 3ZM13 6l5 5',
    search:'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
    add:'M12 5v14M5 12h14',minus:'M5 12h14',undo:'M3 10h11a6 6 0 0 1 0 12M3 10l5-5M3 10l5 5',redo:'M21 10H10a6 6 0 0 0 0 12M21 10l-5-5M21 10l-5 5',
    download:'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',upload:'M12 15V3m-5 5 5-5 5 5M4 16v5h16v-5',
    back:'M20 12H4m6-6-6 6 6 6',previous:'m15 5-7 7 7 7',next:'m9 5 7 7-7 7',up:'M12 20V4m-6 6 6-6 6 6',down:'M12 4v16m-6-6 6 6 6-6',
    more:'M3 12h2M11 12h2M19 12h2',help:'M9 8a3 3 0 1 1 5 2c-2 1-2 2-2 3M12 17h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
    stop:'M5 5h14v14H5z',pause:'M7 4v16M17 4v16',play:'m6 3 15 9-15 9V3Z',
    restore:'M3 4v6h6M3 10a9 9 0 1 1 2 8M12 7v5l3 3',folder:'M3 20V4h6l3 3h9v13H3Z',
    zoomIn:'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0ZM6 10h8M10 6v8',
    zoomOut:'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0ZM6 10h8',
    fit:'M3 9V3h6M15 3h6v6M21 15v6h-6M9 21H3v-6',
    chat:'M21 3H3v14h5v4l5-4h8V3ZM7 8h10M7 12h6',
    settings:'M4 7h16M4 17h16M8 4v6M16 14v6',
    link:'m10 13 4-4M8 16l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0M16 8l1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0',
    check:'m6 12 4 4 8-8M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
    reconnect:'M9 2v4M15 2v4M5 6h14M7 6v5a5 5 0 0 0 10 0V6M12 16v6',
    done:'m5 12 4 4L19 6',open:'M14 3h7v7M10 14 21 3M10 3H3v18h18v-7',
    logout:'M9 3H3v18h6M8 12h13m-5-5 5 5-5 5',
    busy:'M12 3a9 9 0 1 1-9 9'
  };
  // Phosphor Icons 2.1.2 regular outlines, extracted from the existing bundled
  // font. MIT license: vendor/phosphor/LICENSE.
  const filledPaths={"refresh":"M21 4.5V9Q21 9.305 20.777 9.527Q20.555 9.75 20.25 9.75H15.75Q15.445 9.75 15.223 9.527Q15 9.305 15 9Q15 8.695 15.223 8.473Q15.445 8.25 15.75 8.25H18.445L17.062 6.867Q16.055 5.859 14.707 5.273Q13.359 4.688 11.812 4.688H11.766Q11.766 4.688 11.754 4.688Q11.742 4.688 11.742 4.688Q10.219 4.688 8.871 5.262Q7.523 5.836 6.516 6.82Q6.422 6.914 6.293 6.961Q6.164 7.008 6.023 7.008Q5.695 7.008 5.484 6.797Q5.273 6.586 5.273 6.258Q5.273 6.117 5.32 5.977Q5.367 5.836 5.484 5.742Q6.703 4.547 8.32 3.867Q9.938 3.188 11.766 3.188Q13.641 3.188 15.281 3.891Q16.922 4.594 18.141 5.812L19.5 7.195V4.5Q19.5 4.195 19.723 3.973Q19.945 3.75 20.25 3.75Q20.555 3.75 20.777 3.973Q21 4.195 21 4.5ZM17.484 17.18Q16.453 18.164 15.105 18.738Q13.758 19.312 12.234 19.312Q10.688 19.312 9.316 18.727Q7.945 18.141 6.938 17.133L5.555 15.75H8.25Q8.555 15.75 8.777 15.527Q9 15.305 9 15Q9 14.695 8.777 14.473Q8.555 14.25 8.25 14.25H3.75Q3.445 14.25 3.223 14.473Q3 14.695 3 15V19.5Q3 19.805 3.223 20.027Q3.445 20.25 3.75 20.25Q4.055 20.25 4.277 20.027Q4.5 19.805 4.5 19.5V16.805L5.883 18.188Q7.078 19.406 8.707 20.109Q10.336 20.812 12.188 20.812H12.234Q12.234 20.812 12.246 20.812Q12.258 20.812 12.258 20.812Q14.086 20.812 15.703 20.133Q17.32 19.453 18.516 18.258Q18.633 18.164 18.691 18.023Q18.75 17.883 18.75 17.742Q18.75 17.414 18.527 17.203Q18.305 16.992 18 16.992Q17.836 16.992 17.707 17.039Q17.578 17.086 17.484 17.18Z","retry":"M21 12Q21 12 21 12Q21 12 21 12Q21 13.852 20.297 15.469Q19.617 17.109 18.41 18.328Q17.203 19.547 15.586 20.25Q13.969 20.977 12.117 21H12Q12 21 11.988 21Q11.977 21 11.977 21Q10.195 21 8.613 20.344Q7.031 19.688 5.812 18.539Q5.719 18.445 5.648 18.305Q5.578 18.164 5.578 18Q5.578 17.695 5.801 17.473Q6.023 17.25 6.328 17.25Q6.492 17.25 6.621 17.309Q6.75 17.367 6.844 17.461Q7.852 18.398 9.176 18.949Q10.5 19.5 12 19.5Q13.547 19.5 14.93 18.914Q16.289 18.328 17.309 17.309Q18.328 16.289 18.914 14.906Q19.5 13.547 19.5 12Q19.5 10.453 18.914 9.07Q18.328 7.711 17.309 6.691Q16.289 5.672 14.93 5.086Q13.547 4.5 12 4.5Q10.453 4.5 9.082 5.086Q7.711 5.672 6.703 6.703Q6.68 6.703 6.68 6.703Q6.68 6.703 6.68 6.727L4.172 9H6.75Q7.055 9 7.277 9.223Q7.5 9.445 7.5 9.75Q7.5 10.055 7.277 10.277Q7.055 10.5 6.75 10.5H2.25Q1.945 10.5 1.723 10.277Q1.5 10.055 1.5 9.75V5.25Q1.5 4.945 1.723 4.723Q1.945 4.5 2.25 4.5Q2.555 4.5 2.777 4.723Q3 4.945 3 5.25V8.039L5.648 5.625Q6.867 4.406 8.508 3.703Q10.148 3 12 3Q13.875 3 15.492 3.703Q17.133 4.406 18.363 5.637Q19.594 6.867 20.297 8.508Q21 10.125 21 12Z"};
  const exact=new Map(Object.entries(labels).flatMap(([icon,values])=>values.map(value=>[value,icon])));
  let translator,translated;
  function invalidateActionIconTranslations(){translated=null;}
  function actionIconForLabel(label){
    const text=String(label||'').trim().replace(/\s+/gu,' ');
    const direct=exact.get(text);if(direct)return direct;
    const translate=root.SciLLM?.translateInterfaceText;
    // Rebuild only when a surface registers a dictionary, not for every button
    // mutation; the shared interface observer must stay cheap at startup.
    if(translate){
      if(translator!==translate||!translated){translator=translate;translated=new Map();for(const [source,icon]of exact)translated.set(translate(source,'en'),icon);}
      return translated.get(text)||'';
    }
    return '';
  }
  const marker='data-brevess-action-icon',owned=new WeakMap(),styles=new WeakMap();
  // Only established BREVESS control rows, not forms, article contents or menu
  // lists. Keep their grid/column structure and hidden state authoritative.
  const actionRows=['agent-actions','navigation-outline-controls','navigation-translation-recovery-actions','analysis-task-controls','workspace-mechanism-toolbar-actions','literature-note-export-actions','abbreviation-dialog-actions','figure-result-editor-footer','paragraph-note-dialog-footer','supplemental-figure-import-footer','ppt-export-preview-actions','confirmation-dialog-actions','setup-focus-actions','setup-check-actions','section-heading-actions','settings-actions','tts-actions','codex-auth-actions','profile-editor-actions','workspace-pagination','portable-config-actions','dialog-actions','pdf-reader-page-controls','pdf-reader-search-controls','pdf-reader-zoom','pdf-reader-toolbar-actions','offline-header','page-tools__actions','logic-map-recovery','logic-map-save-bar','history','brandbar','catalog-toolbar','pane-title','batch-actions','actions','ai-actions','form-actions','modal-actions','md-header-actions','md-toolbar','md-inspector-row','md-inspector-bottom','md-story-editor-save','md-story-editor-nav','manual-evidence-actions'].map(name=>'.'+name).join(',')+',#viewport-controls,[data-action-icon-row]';
  const excluded='[data-action-icon="none"],[data-i18n-ignore],[translate="no"],[contenteditable="true"],#pdfNativeViewer,#pdfReaderArticle,.pdf-native-text-layer';
  const css=`
    button[${marker}]:not([hidden]) {
      box-sizing:border-box!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;
      width:32px!important;min-width:32px!important;max-width:none!important;height:32px!important;min-height:32px!important;
      padding:6px!important;gap:0!important;flex:0 0 auto!important;vertical-align:middle;
      font-size:0!important;line-height:0!important;border-radius:0!important;box-shadow:none!important;
    }
    button[${marker}] > * {display:none!important}
    button[${marker}]::before {display:none!important}
    button[${marker}]::after {
      content:""!important;display:block!important;position:static!important;width:18px!important;height:18px!important;
      flex:none;background:currentColor!important;opacity:1!important;pointer-events:none;
      mask:var(--brevess-action-mask) center/contain no-repeat!important;
      -webkit-mask:var(--brevess-action-mask) center/contain no-repeat!important;
      border:0!important;transform:none!important;
    }
    button[${marker}]:focus-visible {outline:2px solid currentColor;outline-offset:3px}
    button[${marker}]:not(.btn-primary,.primary,.is-primary,.active,.is-active,.danger,.btn-danger,.is-danger,.md-danger,[aria-pressed="true"],[aria-busy="true"]) {
      color:var(--bv-text,var(--swiss-ink,#202020));border-color:var(--bv-line,var(--swiss-line,#d5d5d5));background:var(--bv-surface,#fff);
    }
    button[${marker}]:hover:not(:disabled) {border-color:var(--bv-text,var(--swiss-ink,#202020));background:var(--bv-hover,#ededed);color:var(--bv-text,var(--swiss-ink,#202020))}
    button[${marker}]:active:not(:disabled) {background:var(--bv-selected,var(--swiss-ink,#202020));color:var(--bv-on-selected,#fff)}
    [data-brevess-action-row] {align-items:center!important;column-gap:8px!important;row-gap:8px!important}
    [data-brevess-action-row] > button:not([hidden]) {
      box-sizing:border-box!important;min-height:32px!important;height:32px!important;
      margin-block:0!important;padding:6px 10px;line-height:18px;vertical-align:middle;
      border-radius:0!important;align-self:center;
    }
    button[${marker}="busy"]::after {animation:brevess-action-spin .9s linear infinite}
    [data-brevess-dialog] { --brevess-dialog-edge:12px }
    [data-brevess-dialog] :is(h2,h3):first-of-type { padding-inline-end:28px }
    [data-brevess-dialog] [data-brevess-dialog-close],button[data-brevess-dialog-close][data-brevess-dialog-close] {
      position:absolute!important;inset:var(--brevess-dialog-edge,12px) var(--brevess-dialog-edge,12px) auto auto!important;
      display:grid!important;place-items:center!important;width:26px!important;height:26px!important;min-width:0!important;min-height:0!important;
      padding:3px!important;margin:0!important;border:0!important;border-radius:0!important;box-shadow:none!important;
      color:var(--bv-text,#202020)!important;background:transparent!important;font-size:0!important;line-height:1!important;z-index:2;
    }
    button[data-brevess-dialog-close] > * {display:none!important}
    button[data-brevess-dialog-close][data-brevess-dialog-close]::after {
      content:""!important;display:block!important;position:static!important;width:16px!important;height:16px!important;
      background:currentColor!important;mask:var(--brevess-close-mask) center/contain no-repeat!important;
      -webkit-mask:var(--brevess-close-mask) center/contain no-repeat!important;pointer-events:none;
    }
    button[data-brevess-dialog-close][data-brevess-dialog-close]:hover {color:var(--bv-red,#bd2927)!important}
    [data-brevess-dialog-footer] {display:flex;align-items:center;justify-content:flex-end;gap:8px}
    [data-brevess-dialog-save] {order:5;margin-inline-start:auto!important}
    @supports (anchor-name:--brevess-save) and (anchor-scope:--brevess-save) {
      [data-brevess-dialog]{anchor-scope:--brevess-save}
      [data-brevess-dialog-save]{anchor-name:--brevess-save}
      [data-brevess-dialog]:has([data-brevess-dialog-save]) [data-brevess-dialog-close] {
        right:anchor(--brevess-save right,var(--brevess-dialog-edge,12px))!important;
      }
    }
    [data-brevess-dialog] [data-brevess-extra-cancel] {display:none!important}
    @keyframes brevess-action-spin {to{rotate:360deg}}
    @media(prefers-reduced-motion:reduce){button[${marker}="busy"]::after{animation:none}}
  `;
  function ensureStyle(button){
    const scope=button.getRootNode?.(),doc=button.ownerDocument;
    const parent=scope?.nodeType===11&&scope.host?scope:doc?.head;
    if(!parent)return;
    const old=styles.get(parent);if(old?.parentNode===parent)return;
    // Hosted pages use an external sheet under their strict CSP; shadow roots
    // and extension surfaces retain the scoped runtime stylesheet.
    const external=parent.querySelector?.('link[rel="stylesheet"][data-brevess-action-icons]');
    if(external){styles.set(parent,external);return;}
    const style=doc.createElement('style');style.dataset.brevessActionIcons='r18';style.textContent=css;parent.appendChild(style);styles.set(parent,style);
  }
  function setOwnedAttribute(button,state,name,value){
    const current=button.getAttribute(name);
    const t=root.SciLLM?.translateInterfaceText;
    const localized=state[name]&&t&&(current===t(state[name],'en')||t(current,'en')===state[name]);
    if(current!==null&&current!==state[name]&&!localized){delete state[name];return;}
    if(current!==value)button.setAttribute(name,value);
    state[name]=value;
  }
  function clear(button,state){
    button.removeAttribute(marker);button.style.removeProperty('--brevess-action-mask');
    for(const name of ['title','aria-label'])if(state?.[name]===button.getAttribute(name))button.removeAttribute(name);
    owned.delete(button);
  }
  function decorateButton(button){
    if(!button?.matches?.('button'))return;
    const state=owned.get(button)||{};
    if(button.closest(excluded)||button.matches('[role="tab"],[role="switch"],[aria-selected],[data-filter],[data-settings-nav],[data-reading-settings-target]')||button.closest('[data-i18n-user-content]')&&!button.hasAttribute('data-i18n-interface-text')){if(owned.has(button))clear(button,state);return;}
    let label=(button.textContent||'').trim().replace(/\s+/gu,' ');
    let icon=actionIconForLabel(label);
    // Existing pictographic controls keep their established icon vocabulary.
    // All dismissal controls use this shared cross, including old glyphs.
    if(icon!=='close'&&button.querySelector('svg,img,i,[class*="icon"],input'))icon='';
    if(icon==='close'&&button.hasAttribute('aria-pressed'))icon='';
    if(button.getAttribute('aria-busy')==='true'&&(icon||state.icon))icon='busy';
    if(!icon){if(owned.has(button))clear(button,state);return;}
    if(/^[×✕✖️]+$/u.test(label))label=button.getAttribute('aria-label')||button.title||root.SciLLM?.translateInterfaceText?.('关闭')||'关闭';
    // Respect specific descriptions/keyboard shortcuts provided by each view.
    setOwnedAttribute(button,state,'aria-label',label);
    setOwnedAttribute(button,state,'title',button.getAttribute('aria-label')||label);
    state.icon=icon;owned.set(button,state);ensureStyle(button);
    const parent=button.parentElement;
    if(parent?.matches(actionRows)&&!parent.hasAttribute('data-brevess-action-row'))parent.setAttribute('data-brevess-action-row','');
    if(button.getAttribute(marker)!==icon){
      const svg=filledPaths[icon]?`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="black"><path d="${filledPaths[icon]}"/></svg>`:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="${paths[icon]}"/></svg>`;
      button.style.setProperty('--brevess-action-mask',`url("data:image/svg+xml,${encodeURIComponent(svg)}")`);
      button.setAttribute(marker,icon);
    }
  }
  const dialogSelector='dialog,[role="dialog"],[role="alertdialog"],#focusControls';
  const boundEscape=new WeakSet(),dismissals=new WeakSet();
  function registerEscape(scope){
    if(boundEscape.has(scope))return;
    boundEscape.add(scope);
    scope.addEventListener('keydown',event=>{
      if(event.key!=='Escape'||event.isComposing||event.defaultPrevented)return;
      const native=scope.querySelector('dialog:modal');
      const buttons=[...scope.querySelectorAll('[data-brevess-dialog-close]')].reverse();
      const close=buttons.find(button=>{
        const owner=button.closest(dialogSelector);
        return dismissals.has(button)&&owner&&owner.localName!=='dialog'&&(!native||native.contains(owner))&&button.getClientRects().length;
      });
      if(close){event.preventDefault();event.stopPropagation();close.click();}
    });
  }
  function prepareDialog(dialog){
    const doc=dialog.ownerDocument,scope=dialog.getRootNode();
    const ownedPage=/^(?:chrome|moz)-extension:$/.test(doc.location?.protocol)||doc.body?.hasAttribute('data-ui-surface');
    if(!ownedPage&&!dialog.closest('[data-sci-plugin-ui],[data-brevess-ui]')&&!scope.host?.matches('[data-sci-plugin-ui]'))return;
    if(!dialog.childElementCount||dialog.closest('[data-i18n-user-content]'))return;
    const controls=[...dialog.querySelectorAll('button')].filter(b=>b.closest(dialogSelector)===dialog);
    const label=b=>(b.textContent||'').trim();
    const cancel=b=>/^(取消|Cancel)$/i.test(label(b));
    const close=controls.find(b=>!b.hasAttribute('data-brevess-auto-close')&&
      (b.matches('[data-close],[data-dialog-dismiss],#focusCollapse')||/^(?:[×✕✖]|关闭|Close)$/iu.test(label(b))||/^(关闭|Close\b)/i.test(b.getAttribute('aria-label')||'')))||
      controls.find(cancel)||controls.find(b=>b.hasAttribute('data-brevess-auto-close'));
    let dismiss=close;
    if(!dismiss&&dialog.localName==='dialog'){
      dismiss=doc.createElement('button');dismiss.type='button';dismiss.textContent='×';
      dismiss.setAttribute('aria-label',root.SciLLM?.translateInterfaceText?.('关闭')||'关闭');
      dismiss.dataset.brevessAutoClose='';
      dismiss.addEventListener('click',()=>{
        if(typeof dialog.requestClose==='function')dialog.requestClose('cancel');
        else if(dialog.dispatchEvent(new Event('cancel',{cancelable:true})))dialog.close('cancel');
      });
      dialog.append(dismiss);
    }
    if(!dismiss)return;
    if(!dialog.hasAttribute('data-brevess-dialog'))dialog.dataset.brevessDialog='';
    for(const old of controls.filter(b=>b!==dismiss&&b.hasAttribute('data-brevess-dialog-close'))){
      if(old.hasAttribute('data-brevess-auto-close'))old.remove();else old.removeAttribute('data-brevess-dialog-close');
    }
    if(!dismiss.hasAttribute('data-brevess-dialog-close')){
      dismiss.dataset.brevessDialogClose='';dismissals.add(dismiss);
      const cross='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round"><path d="'+paths.close+'"/></svg>';
      dismiss.style.setProperty('--brevess-close-mask','url("data:image/svg+xml,'+encodeURIComponent(cross)+'")');
      ensureStyle(dismiss);registerEscape(scope);
    }
    for(const b of controls){
      const footer=b.closest('footer,.form-actions,.modal-actions,.dialog-actions,[class$="-footer"],.confirmation-dialog-actions,.batch-foot,.form-foot');
      if(!footer||footer.closest(dialogSelector)!==dialog)continue;
      // Some forms have an independent cancel for an edit inside the dialog.
      if(cancel(b)&&b!==dismiss&&/^cancel-(?:editor|history)$/.test(b.id))b.dataset.brevessExtraCancel='';
      if((b.getAttribute(marker)==='save'||/^(保存|Save\b)/i.test(label(b)))&&!b.hasAttribute('data-brevess-dialog-save')){
        b.dataset.brevessDialogSave='';footer.dataset.brevessDialogFooter='';
      }
    }
  }
  function decorateActionIcons(scope){
    if(!scope)return;
    // Called only by the existing interface-root localization lifecycle. Never
    // install a whole-article observer or traverse into unregistered shadows.
    const element=scope.nodeType===3?scope.parentElement:scope;
    const button=element?.closest?.('button');if(button)decorateButton(button);
    element?.querySelectorAll?.('button').forEach(decorateButton);
    const parent=element?.closest?.(dialogSelector);if(parent)prepareDialog(parent);
    element?.querySelectorAll?.(dialogSelector).forEach(prepareDialog);
  }
  // Standalone extension pages can open native dialogs without the localization observer.
  if(/^(?:chrome|moz)-extension:$/.test(root.location?.protocol)){
    root.document?.addEventListener('toggle',event=>{
      if(event.target?.matches?.('dialog[open]'))prepareDialog(event.target);
    },true);
  }
  return{ACTION_ICONS_REVISION:'r18',actionIconForLabel,decorateActionIcons,invalidateActionIconTranslations};
});

