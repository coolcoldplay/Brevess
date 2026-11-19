/* Public README excerpts and an authored conversation. No account or chat history. */
(() => {
 const kind=new URLSearchParams(location.search).get('web');
 if(!['github','chatgpt'].includes(kind))return;
 const github={
  title:'BREVESS · Brevity · Evidence · Essence',publisher:'GitHub',source:'https://github.com/coolcoldplay/Brevess',
  paragraphs:[
   {id:'overview',heading:'BREVESS',text:'Turn reliable information into structured knowledge for research. Manual and AI-assisted reading, from papers and evidence to hypotheses and figure planning.',zh:'将可靠信息转化为服务研究的知识结构。人工阅读与 AI 辅助相结合，从论文和证据走向假说与组图规划。',summary:['将信息获取、证据积累与研究规划连成一条工作流。']},
   {id:'reading',heading:'五个阅读模块',text:'大纲 → 高亮 → 解图 → 问答 → 笔记。大部分功能支持手动完成，也可由 AI 辅助。从大纲、标注和笔记，到证据整理、假说与组图规划，按自己的节奏积累知识。',zh:'Outline → Highlights → Figures → Q&A → Notes. Most features work manually, with AI assistance when you want it. Build knowledge at your own pace, from reading and annotation to evidence, hypotheses and figure planning.',summary:['五个模块依次支持概览、摘取、理解、追问和沉淀。']},
   {id:'evidence',heading:'课题工作台',text:'文献雷达 → 文献总库 → 假说梳理 → 组图规划。从手动整理开始，也可借助 AI 辅助完善研究思路。支持多套方案、本机保存、撤销重做与导入导出。',zh:'Literature Radar → Library → Hypotheses → Figure Planning. Start manually, then use AI to develop your research ideas. Multiple plans, local saving, undo and redo, import and export are supported.',summary:['阅读材料可进入课题，继续组织证据、假说和实验方案。']},
   {id:'access',heading:'安装预览版',text:'大纲导航、离线规则、手动高亮、笔记编辑和工作台无需 API Key。部分增强功能需要可选本机伴侣，当前浏览器 ZIP 不包含本机二进制。',zh:'Outline navigation, offline rules, manual highlights, note editing and the workbench need no API key. Some advanced features require an optional local companion; the browser ZIP does not include native binaries.',summary:['基础阅读和整理不依赖 API；增强能力可按需接入。']},
   {id:'source',heading:'源码与构建',text:'插件源码集中在 extension/，构建脚本在 scripts/，回归测试在 tests/，官网和文档在 docs/。Release ZIP 的安装方式不变，仍选择解压后直接包含 manifest.json 的文件夹。',zh:'Extension source lives in extension/, build scripts in scripts/, regression tests in tests/, and the website and documentation in docs/. For the release ZIP, load the extracted folder that directly contains manifest.json.',summary:['源码和发布包各有明确的加载目录。']}
  ],
  questions:[
   {q:['不配置 API 可以用哪些功能？','What works without an API key?'],match:/api|密钥|key|免费|手动/i,answer:['可以使用大纲导航、离线规则、手动高亮、笔记编辑和工作台。'],details:['网页明确将这些基础功能与模型增强功能区分；接入模型后，可按需要使用 AI 辅助。'],evidenceIds:['access']},
   {q:['阅读材料怎样进入研究规划？'],match:/材料|联动|研究|规划|workflow/i,answer:['先在侧栏完成阅读与整理，再把材料用于课题工作台。'],details:['工作台顺序是文献雷达、文献总库、假说梳理、组图规划。核心是让阅读所得继续支撑假说与实验设计。'],evidenceIds:['reading','evidence']}
  ]
 };
 const chat={
  title:'如何把 AI 对话变成可追溯的研究材料',publisher:'ChatGPT',source:'https://chatgpt.com/',
  prompt:'读完一篇论文后，我还会和 AI 讨论。怎样把有用的对话内容留下来，并避免把猜想当成结论？',
  paragraphs:[
   {id:'overview',heading:'先分清证据与想法',text:'Treat an AI response as a starting point, not as evidence. Keep the original source attached to each claim, and label hypotheses separately from observations.',zh:'将 AI 回答视为起点，而不是证据。为每个论断保留原始来源，并将假说与观察结果分别标记。',summary:['AI 回答需要回到原始来源核验；假说不能替代观察。']},
   {id:'reading',heading:'留下有价值的原句',text:'Highlight the sentences that change your understanding. Add a short note explaining why they matter, what remains uncertain, and which source you need to check.',zh:'高亮那些改变你理解的句子。附上一条简短备注，说明它们为何重要、还有什么不确定，以及需要核对哪个来源。',summary:['记录重点，同时记录判断理由和待核查的问题。']},
   {id:'evidence',heading:'把阅读连接到下一步研究',text:'A useful research note connects a question to supporting evidence and a possible test. Move those materials into a hypothesis map, then plan the experiments that could support or challenge the idea.',zh:'有用的研究笔记将问题、支撑证据与可行的验证联系起来。将这些材料整理进假说图，再规划能够支持或挑战这一想法的实验。',summary:['用问题、证据、验证连接阅读与研究设计。']},
   {id:'access',heading:'需要时，按意思找回来',text:'You may remember an idea without remembering its exact wording. Semantic search can help you return to the relevant passage; check that passage in context before reusing it.',zh:'你可能记得一个想法，却不记得它的原话。语义检索能帮助你找回相关段落；再次使用前，仍要结合上下文核对。',summary:['按语义找回内容后，仍应核对原文上下文。']},
   {id:'source',heading:'让积累可复查',text:'Keep annotations, translations, questions and notes with their source page. When you revisit the material, you should be able to see both the original statement and your own reasoning.',zh:'将标注、译文、问题和笔记与来源网页一起保存。再次阅读时，应能同时看到原始表述和自己的推理。',summary:['让来源与自己的判断保持关联，便于日后复查。']}
  ],
  questions:[
   {q:['这段对话最重要的提醒是什么？'],match:/提醒|总结|重点|证据|猜想|结论|summary/i,answer:['区分 AI 生成的建议、文献中的观察和你提出的假说。'],details:['回答的第一条建议是保留论断的原始来源，并把假说单独标记。高亮和备注的作用，是记录判断与不确定性，帮助后续核查。'],evidenceIds:['overview','reading']},
   {q:['怎么把对话内容用于课题？'],match:/课题|研究|规划|材料|实验|hypothes/i,answer:['从对话中提取问题、可能的支撑证据和可行的验证。'],details:['将相关材料加入假说梳理，再规划能够支持或挑战假说的实验；这条路径保留了从原句到研究想法的联系。'],evidenceIds:['evidence','source']}
  ]
 };
 const d=kind==='github'?github:chat;
 d.web=kind;d.documentId='public-web-'+kind;d.figures=[];
 d.highlightTerms=[['term_brevess','阅读与整理','#4ECDC4','BREVESS|高亮|笔记|annotations?|notes?|reading'],['term_ai','AI 与模型','#FFB6C1','\\b(?:AI|API|LLM)\\b'],['term_evidence','证据与假说','#87CEEB','证据|假说|evidence|hypothes[ie]s|observations?']];
 d.highlightSlices=d.paragraphs.map((p,i)=>[p.id,['known_background','method','method','limitation','method'][i],0,null,.92,p.summary[0]]);
 d.selectionExplanation='这段内容强调将原始表述与自己的判断区分，并保留来源以供核查。';
 d.notes={research_background:d.paragraphs[0].zh,scientific_questions:kind==='github'?'如何将阅读材料连接到研究规划？':'怎样把 AI 对话转化为可追溯的研究材料？',main_findings:d.paragraphs[2].summary[0],limitations:'本页为公开介绍或编写的演示对话；这些建议不构成科学证据。',transferable_ideas:d.paragraphs[4].summary[0]};
 d.readerExamples={title:kind==='chatgpt'?'Turn AI conversations into traceable research materials':d.title,headings:Object.fromEntries(d.paragraphs.map((p,i)=>[p.id,(kind==='chatgpt'?['Separate evidence from ideas','Keep the sentences that matter','Connect reading to your next research step','Find it again by meaning','Keep your reasoning reviewable']:['BREVESS','Five reading modules','Research workbench','Install the preview','Source and build'])[i]])),figures:[],abbreviations:[{abbreviation:'AI',fullName:'artificial intelligence',paragraphId:'overview',meaningZh:'人工智能',definitionZh:'本演示中指辅助理解和组织信息的模型；生成内容需要核查。'}],semanticQueries:[
  {query:kind==='github'?'哪些功能不需要付费接入模型？':'怎样避免把 AI 建议当成事实？',aliases:kind==='github'?/api|付费|模型|免费|接入|手动|without/i:/事实|证据|建议|猜想|可靠|核查|evidence/i,score:s=>s.paragraphId===(kind==='github'?'access':'overview')?.98:s.paragraphId==='reading'?.74:.12},
  {query:'阅读材料如何帮助规划下一步研究？',aliases:/研究|材料|规划|课题|实验|下一步|research/i,score:s=>s.paragraphId==='evidence'?.97:s.paragraphId==='source'?.76:.12}
 ]};
 window.BV_DEMO_DATA=d;
})();
