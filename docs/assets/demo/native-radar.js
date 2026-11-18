/* The real radar renders a public, dated example; no scheduled network scans. */
(() => {
 const demo=window.__websiteDemo;demo.surface='radar';
 const notify=message=>{const n=document.getElementById('notice');n.textContent=message;};
 const needsInstall=new Set(['connections','toggle-radar','check-radar','check-all','confirm-history','score-papers','backfill-abstracts','validate-query']);
 document.addEventListener('click',e=>{
   const b=e.target.closest('button');
   if(needsInstall.has(b?.id)){e.preventDefault();e.stopImmediatePropagation();notify('官网展示 AlphaFold 公开示例；实时检索、定时追踪和模型评分请在插件中使用。');return;}
   if(b?.id==='generate-query'){e.preventDefault();e.stopImmediatePropagation();document.getElementById('query-candidate-area').hidden=false;document.getElementById('query-candidate').value='AlphaFold[Title/Abstract] AND protein structure[Title/Abstract]';document.getElementById('query-ai-status').textContent='预置检索式示例，请按研究问题修改。';return;}
   const link=e.target.closest('a');if((link?.closest('h3')&&link.href.includes('34265844'))||link?.href===BV_DEMO_DATA.source){e.preventDefault();parent.parent.postMessage({source:'brevess-native-demo',type:'jump',id:'abstract'},location.origin);}
 },true);
 document.getElementById('radar-form').addEventListener('submit',e=>{e.preventDefault();e.stopImmediatePropagation();notify('已预览检索式。实际保存与追踪请在插件中完成。');document.getElementById('editor').close();},true);
 addEventListener('message',e=>{if(e.source===parent&&e.origin===location.origin&&e.data?.source==='brevess-website'&&e.data.type==='language')SciLLM.setInterfaceLanguage(e.data.language,document);});
})();
