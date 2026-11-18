/* Public examples. Category definitions come from the shipping catalog. */
window.BVHighlightExamples = (api,d) => {
 const catalog=api.createUnifiedCategoryCatalog();
 const terms=[['term_msa','序列比对','#4ECDC4','\\b(?:MSAs?|multi-sequence alignments)\\b'],['term_model','模型与评估','#FFB6C1','\\b(?:AlphaFold|CASP14|PDB)\\b'],['term_metric','精度指标','#87CEEB','\\b(?:GDT|lDDT-Cα|atomic accuracy)\\b']];
 terms.forEach(([categoryId,name,color,expression])=>catalog[categoryId]=api.toUnifiedCategory({categoryId,name,color,builtIn:false,enabledEngines:['regex','llm'],regex:{phrases:[],expressions:[expression],excludePhrases:[],caseSensitive:false,wholeWord:false},prompt:{definition:'标记原文中的'+name}}));
 const views={quick_story:{name:'快速主线',categoryIds:['known_background','method','result','comparison','limitation','significance_novelty']},paper_terms:{name:'论文术语（示例情境）',categoryIds:terms.map(x=>x[0])}};
 const slices=[
  ['abstract','known_background',0,'Through an',.94,'说明结构知识与序列数量之间的背景差距。'],
  ['accuracy','significance_novelty',0,'We validated',.91,'作者声明的方法创新，需与后续验证结果分开阅读。'],
  ['accuracy','result','We validated',null,.95,'CASP14 验证结果；多数情况并不代表每一个目标。'],
  ['network','method',0,null,.9,'说明算法如何整合结构知识和多序列比对。'],
  ['interpretation','method',0,'Domains are',.89,'描述消融实验的两个测试集及样本量。'],
  ['interpretation','comparison','Domains are',null,.86,'不同测试集使用不同评分，比较时需区分指标。'],
  ['msa','limitation',0,'We observe',.95,'浅 MSA 下性能下降，是模型应用的边界。'],
  ['msa','result','We observe',null,.87,'超过约 100 条序列后的收益趋缓，是数据中观察到的结果。']
 ];
 const llm=slices.map(([p,categoryId,from,to,confidence,note],i)=>{
  const text=d.paragraphs.find(x=>x.id===p).text,start=typeof from==='number'?from:text.indexOf(from),end=to?text.indexOf(to):text.length;
  if(start<0||end<=start)throw Error('Invalid public highlight excerpt');
  const quote=text.slice(start,end).trimEnd();
  return{id:'llm-'+i,source:'llm',categoryId,confidence,note,segments:[{p,start,end:start+quote.length}],text:quote};
 });
 return{catalog,views,llm};
};
