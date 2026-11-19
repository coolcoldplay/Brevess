/* Shared data for the reader and its isolated production sidebar. */
(() => {
 window.BVPrepareWebData=d=>{
  d.documentId='public-web-'+d.web;d.figures=[];
  d.highlightTerms=[['term_brevess','阅读与整理','#4ECDC4','BREVESS|高亮|笔记|annotations?|notes?|reading'],['term_ai','AI 与模型','#FFB6C1','\\b(?:AI|API|LLM)\\b'],['term_evidence','证据与假说','#87CEEB','证据|假说|evidence|hypothes[ie]s|observations?']];
  const relevant=(re)=>d.paragraphs.filter(p=>re.test(p.text));
  const evidence=relevant(/假说|Panel|证据|研究规划/),manual=relevant(/无需 API|手动|人工|模型/),limits=relevant(/限制|失败|尚未|不能|不代表/);
  const target=re=>relevant(re)[0]||d.paragraphs[0];
  d.highlightSlices=[...new Set([...evidence.slice(0,3),...manual.slice(0,2),...limits.slice(0,2)])].map(p=>[p.id,limits.includes(p)?'limitation':'method',0,null,.94,p.text]);
  d.selectionExplanation='本段保留了作者的原始表述。可以分别标注功能、证据和限制，并通过链接核对来源。';
  const q1=target(/无需 API|手动|人工优先|人工修订/),q2=target(/假说.*Panel|假说.*组图|文献雷达/);
  d.questions=[{q:[d.web==='github'?'不配置 API 可以用哪些功能？':'这段对话认为 BREVESS 的核心优势是什么？'],match:/api|模型|手动|优势|核心|重点|总结|advantage|features|core|summary/i,answer:[d.web==='github'?'基础阅读与整理可以手动完成，AI 辅助按需接入。':'对话强调将文献证据、假说和实验组图连接成可持续积累、人工修订的工作流。'],details:[q1.text],evidenceIds:[q1.id]},{q:['阅读材料怎样进入研究规划？'],match:/材料|联动|研究|规划|workflow|research|planning|materials/i,answer:['从阅读中保留材料和证据，再用于假说梳理与组图规划。'],details:[q2.text],evidenceIds:[q2.id]}];
  d.questions[0].q[1]=d.web==='github'?'Which features work without an API?':'What does this conversation identify as BREVESS’s main advantage?';
  d.questions[0].answer[1]=d.web==='github'?'Core reading and organization work manually. AI assistance can be connected when needed.':'The conversation emphasizes a workflow that connects literature evidence, hypotheses and figure planning, while allowing ongoing accumulation and manual revision.';
  d.questions[0].details[1]=d.web==='github'?'The repository describes manual reading tools and optional model connections. Follow the citation to check the original description.':'The author highlights how reading materials can be retained and reused in a research project. Follow the citation to inspect the original wording.';
  d.questions[1].q[1]='How do reading materials feed into research planning?';
  d.questions[1].answer[1]='Retain materials and evidence while reading, then reuse them in hypothesis mapping and figure planning.';
  d.questions[1].details[1]='The cited source connects papers, figures and panels with research-planning objects. Open the citation to verify the passage.';
  d.notes={research_background:d.paragraphs[0].text,scientific_questions:'如何把阅读材料连接到研究规划？',main_findings:q2.text,limitations:limits[0]?.text||'请结合原文核对。',transferable_ideas:q1.text};
  d.readerExamples={title:d.title,headings:{},figures:[],abbreviations:[{abbreviation:'AI',fullName:'artificial intelligence',paragraphId:target(/AI/).id,meaningZh:'人工智能',definitionZh:'辅助理解和组织信息的模型，生成内容需要核查。'},{abbreviation:'API',fullName:'application programming interface',paragraphId:target(/API/).id,meaningZh:'应用程序接口',definitionZh:'用于连接模型等服务的接口。'}],semanticQueries:[
   {query:'人工整理和 AI 辅助如何配合？',aliases:/api|付费|模型|免费|接入|手动|人工|without/i,score:s=>manual.some(p=>p.id===s.paragraphId)?.96:.08},
   {query:'阅读材料如何帮助规划下一步研究？',aliases:/研究|材料|规划|课题|实验|下一步|research|证据|假说/i,score:s=>evidence.some(p=>p.id===s.paragraphId)?.96:.08}
  ]};
  return d;
 };
 const kind=new URLSearchParams(location.search).get('web');
 if(['github','chatgpt'].includes(kind)&&parent!==window&&parent.BV_DEMO_DATA?.web===kind)window.BV_DEMO_DATA=parent.BV_DEMO_DATA;
})();
