/* Use the real workbench, its editing session, canvas and material projection. */
(() => {
 const demo=window.__websiteDemo,d=window.BV_DEMO_DATA;
 const start=async()=>{
  const r=window.__workbenchRuntime;if(!r){setTimeout(start,50);return;}
  try{
   const M=window.Workbench,p=M.project('AlphaFold · 可靠性与验证','如何依据结构预测的置信度安排实验验证？');
   const h=M.hypothesis('从结构预测到实验验证');
   h.nodes=[['序列与 MSA','输入',50,80],['预测结构与置信度','模型',350,80],['实验验证优先级','待检验假说',650,80]].map(([label,kind,x,y])=>({id:M.uid('node'),label,kind:'bio',x,y,w:210,h:90}));
   h.edges=[{id:M.uid('edge'),source:h.nodes[0].id,target:h.nodes[1].id,claim:'提供共进化信息',condition:'序列与同源信息',status:'pending',bindings:[]},{id:M.uid('edge'),source:h.nodes[1].id,target:h.nodes[2].id,claim:'提出可检验的问题',condition:'需要独立实验验证',status:'pending',bindings:[]}];
   const pl=M.plan('结构可靠性验证方案'),f=M.figure('从预测到验证');
   f.question='如何独立核对结构预测的适用边界？';
   f.panels=[['MSA 深度与精度','按序列信息深度分组',50],['置信度与局部误差','比较置信度和实验结构',350],['实验验证','为低置信区域设计对照',650]].map(([title,purpose,x])=>({...M.panel(title,{x,y:80}),purpose,experiment:'研究规划示例，非原论文实验结果',status:'planned'}));
   pl.figures=[f];pl.hypothesisIds=[h.id];p.hypotheses=[h];p.plans=[pl];
   await r.session.create(p);await r.navigate({mode:'hypothesis',hypothesisId:h.id});
   r.ui.view={zoom:.8,x:20,y:60,selection:[]};r.ui.inspectorCollapsed=true;r.render();
   await r.loadGlobalLibrary();
   demo.receiveReading=async reading=>{
     demo.reading=structuredClone(reading);await r.loadGlobalLibrary();
     if(r.ui.materialPaperEntry)await r.loadMaterialPaper(r.ui.materialPaperEntry);
     r.toast('论文、图解与阅读记录已更新到体验文献库');
   };
   addEventListener('message',e=>{if(e.source!==parent||e.origin!==location.origin||e.data?.source!=='brevess-website')return;const m=e.data;
     if(m.type==='reading')void demo.receiveReading(m.reading);
     if(m.type==='language'){SciLLM.setInterfaceLanguage(m.language,document);document.getElementById('literature-radar-frame')?.contentWindow?.postMessage(m,location.origin);}
     if(m.type==='module')document.querySelector(`[data-action="mode-${m.module}"]`)?.click();
   });
   // Browser-only services and account actions are deliberately kept outside this demo.
   document.addEventListener('click',e=>{
     const a=e.target.closest('a');if(a?.href===d.source){e.preventDefault();demo.send('jump',{id:'abstract'});}
     const action=e.target.closest('[data-action]')?.dataset.action;
     if(action?.startsWith('mode-')){demo.send('workbench-module',{module:action.slice(5)});if(['mode-hypothesis','mode-figure'].includes(action))requestAnimationFrame(()=>document.querySelector('[data-action=fit]')?.click());}
   });
   const status=document.getElementById('save-status');
   const updateStatus=()=>{if(status&&status.textContent!=='体验中 · 仅本页保存'){status.textContent='体验中 · 仅本页保存';status.title='刷新页面将重置示例；不会写入已安装插件或本地文件夹。';}};
   new MutationObserver(updateStatus).observe(status,{childList:true});updateStatus();
   document.querySelector('[data-action=mode-radar]').click();
   demo.ready=true;demo.send('ready',{surface:'workbench'});
  }catch(e){demo.errors.push(e.stack);console.error(e);}
 };void start();
})();
