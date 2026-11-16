const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../extension/core/article-chat-research.js');
require('../extension/providers/provider-utils.js');
require('../extension/core/article-chat-web-sources.js');
const {createDeepSeekAdapter} = require('../extension/providers/deepseek.js');
const input = {question:'请查询通讯作者背景与前期研究，用表格说明启发关系',document:{title:'Intestinal macrophages modulate synucleinopathy along the gut–brain axis',url:'https://www.nature.com/articles/paper',authorMetadata:{publicationDate:'2026/03/11',authors:[
 {name:'Soyon Hong',corresponding:true,affiliations:['UCL']}, {name:'Tim Bartels',corresponding:true,affiliations:['UCL']}, {name:'Other Researcher',corresponding:null,affiliations:['Institute']} ]}}};
test('author background prioritizes verified people, short topical queries and publication cutoff',()=>{
 const p=R.planArticleAuthorResearch(input);assert.equal(p.authors.length,2);assert.equal(p.queries.length,4);
 assert.match(p.queries[0],/"Soyon Hong"/);assert.match(p.queries[1],/"Tim Bartels"/);
 assert.ok(p.queries.every(q=>Array.from(q).length<=128&&!q.includes('表格')&&q.includes('before:2026-03-11')));
});
test('named non-corresponding author is searchable; section exclusion and article-only questions respected',()=>{
 const p=R.planArticleAuthorResearch({...input,question:'查找 Other Researcher 的前期研究'});assert.deepEqual(p.authors.map(x=>x.name),['Other Researcher']);
 assert.equal(R.planArticleAuthorResearch({...input,question:'作者通过哪些实验发现巨噬细胞作用'}),null);
 assert.equal(R.planArticleAuthorResearch(input,{publicationMetadataStatus:'excluded-by-section-scope'}),null);
});
test('common before-publication wording activates named-author verification',()=>{
 for(const question of ['核对通讯作者 Tim Bartels，查找本文之前的两篇原始研究','Tim Bartels 的早期工作','Find Tim Bartels research before this paper']) {
  const plan=R.planArticleAuthorResearch({...input,question});assert.deepEqual(plan.authors.map(a=>a.name),['Tim Bartels']);
 }
});
test('direct-citation rows require the same paper title in the admitted bibliography',()=>{
 const title='Parkinson-causing mutations shift native tetramers to monomers';
 const sources=[{url:'https://publisher.org/2015',title}];
 const table=relation=>'| Paper | Year | Relation |\n|---|---|---|\n| '+title+' | 2015 | '+relation+' [S1] |';
 const plan={url:input.document.url,referenceText:'Nuber et al. 2018. A different study.'};
 assert.throws(()=>R.validateAuthorResearchTable(table('直接引用：正文的模型引用18'),sources,plan));
 assert.doesNotThrow(()=>R.validateAuthorResearchTable(table('主题关联，未证实直接引用'),sources,plan));
 assert.doesNotThrow(()=>R.validateAuthorResearchTable(table('直接引用'),sources,{...plan,referenceText:title+' (2015)'}));
 const scoped=R.planArticleAuthorResearch({...input,document:{...input.document,references:title}},{chunks:[{sectionTitle:'Results',text:title}]});
 assert.equal(scoped.referenceText,'');
});
test('publisher bibliography is retained separately from short article excerpts',()=>{
 const entries=Array.from({length:68},(_,i)=>`${i+1}. Study title ${i+1} (2022).`).join('\n');
 const text='# Article\nLong body\n## References\n'+entries+'\n## Author information\nNot a reference';
 assert.equal(R.researchBibliography(text),entries);
 assert.equal(R.researchBibliography('A paragraph mentioning References without a heading.'),'');
 assert.equal(R.researchBibliography(text,20).length,20);
});
test('unknown identity starts with paper lookup; invented or ungrounded identities are rejected',()=>{
 const p=R.planArticleAuthorResearch({...input,document:{title:'Example research',url:input.document.url}});assert.equal(p.queries.length,1);assert.equal(p.authors.length,0);
 const sources=[{url:input.document.url,content:'Correspondence to Soyon Hong and Tim Bartels.'}];
 assert.deepEqual(R.verifiedResearchAuthors({authors:[{name:'Invented Name',sourceIndex:0,quote:sources[0].content}]},sources),[]);
 assert.equal(R.verifiedResearchAuthors({authors:[{name:'Soyon Hong',sourceIndex:0,quote:sources[0].content}]},sources).length,1);
 assert.deepEqual(R.verifiedResearchAuthors({authors:[{name:'Soyon Hong',sourceIndex:0,quote:'Soyon Hong'}]},sources),[]);
});
test('source budget represents every query and deduplicates URLs',()=>{
 const groups=Array.from({length:4},(_,g)=>Array.from({length:6},(_,i)=>({url:`https://publisher.org/${g}/${i}`})));
 const sources=R.balancedResearchSources(groups);assert.equal(sources.length,12);assert.deepEqual(sources.slice(0,4).map(s=>s.url),groups.map(g=>g[0].url));
 assert.equal(R.balancedResearchSources([[groups[0][0]],[groups[0][0]]]).length,1);
});
function stream(answer, n=1) {return new Response('data: '+JSON.stringify({object:'chat.completion.chunk',id:'chat-test-'+n,model:'deepseek-flash',choices:[{index:0,delta:{content:answer},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({object:'chat.completion.chunk',id:'chat-test-'+n,model:'deepseek-flash',choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:30}})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});}
async function collect(adapter,request){const events=[];for await(const e of adapter.generateWebSearchTextStream(request))events.push(e);return events;}
test('streamed search retains usage and retries malformed citation formatting without repeating searches',async()=>{
 let search=0,answer=0;const adapter=createDeepSeekAdapter({model:'deepseek-flash',apiKey:'fixture'},async(url)=>{
  if(url.endsWith('/search')){search++;return new Response(JSON.stringify({results:[{url:'https://www.nature.com/articles/paper',title:'Paper',content:'Evidence'}]}));}
  answer++;return stream(answer===1?'<span>bad</span> [S1]':'Verified evidence [S1].',answer);
 });
 const events=await collect(adapter,{webSearchQueries:['paper'],userPrompt:'Question',maxOutputTokens:4096});
 assert.equal(search,1);assert.equal(answer,2);assert.equal(events.at(-1).type,'completed',JSON.stringify(events.at(-1)));
 assert.deepEqual(events.find(e=>e.type==='usage').usage,{inputTokens:200,outputTokens:60,reasoningTokens:0,cacheHitTokens:0,cacheMissTokens:0});
 assert.ok(events.find(e=>e.type==='text_delta').text.includes('https://www.nature.com/articles/paper'));
});
test('all query groups are searched even after twelve early hits',async()=>{
 let search=0;const adapter=createDeepSeekAdapter({model:'deepseek-flash',apiKey:'fixture'},async(url)=>{
 if(url.endsWith('/search')) {search++;return new Response(JSON.stringify({results:Array.from({length:6},(_,i)=>({url:`https://publisher.org/${search}/${i}`,title:`Paper ${search} ${i}`,content:'Evidence'}))}));}
 return stream('Sources [S1] [S2] [S3] [S4].');});
 const events=await collect(adapter,{webSearchQueries:['q1','q2','q3','q4'],userPrompt:'Question'});
 assert.equal(search,4);assert.equal(events.at(-1).type,'completed',JSON.stringify(events.at(-1)));
 assert.deepEqual(events.find(e=>e.type==='web_grounding').grounding.sources.map(s=>s.url),[1,2,3,4].map(n=>`https://publisher.org/${n}/0`));
});
test('planned searches retain every author, prefer PubMed on second pass and preserve cutoff',()=>{
 const plan=R.planArticleAuthorResearch(input);
 const queries=R.validatedResearchQueries({queries:['"Soyon Hong" microglia mechanisms','"Soyon Hong" prior work','"Tim Bartels" synuclein','"Tim Bartels" publications']},plan);
 assert.equal(queries.length,4);assert.match(queries[1],/site:pubmed/);assert.match(queries[3],/site:pubmed/);
 assert.ok(queries.every(q=>q.endsWith('before:2026-03-11')&&q.length<=128));
 assert.deepEqual(R.validatedResearchQueries({queries:['"Soyon Hong" works']},plan),plan.queries);
});
test('PubMed table validation rejects a reference mistaken for the source paper, wrong year, foreign author and missing citation',()=>{
 const record={title:'Actual prior study',publicationDate:'2020 Jan',publicationTypes:['Journal Article'],authors:[{name:'Soyon Hong'}]};
 const sources=[{bibliographicRecord:record}];const plan=R.planArticleAuthorResearch(input);
 const table=row=>'| Paper | Year | Source |\n|---|---|---|\n'+row;
 assert.doesNotThrow(()=>R.validateAuthorResearchTable(table('| Actual prior study | 2020 | [S1] |'),sources,plan));
 for(const row of ['| Different reference | 2020 | [S1] |','| Actual prior study | 2018 | [S1] |','| Actual prior study | 2020 | none |'])assert.throws(()=>R.validateAuthorResearchTable(table(row),sources,plan),{code:'WEB_SEARCH_GROUNDING_MISSING'});
 assert.throws(()=>R.validateAuthorResearchTable(table('| Actual prior study | 2020 | [S1] |'),[{bibliographicRecord:{...record,authors:[{name:'Someone Else'}]}}],plan));
});
test('structured PubMed verification follows a documented erratum and replaces misleading search snippets',async()=>{
 const xml=(id,title,extra='')=>`<PubmedArticle><MedlineCitation><PMID>${id}</PMID><Article><ArticleTitle>${title}</ArticleTitle><Journal><Title>Cell</Title><JournalIssue><PubDate><Year>2018</Year></PubDate></JournalIssue></Journal><AuthorList><Author><ForeName>Soyon</ForeName><LastName>Hong</LastName><AffiliationInfo><Affiliation>UCL</Affiliation></AffiliationInfo></Author></AuthorList><Abstract><AbstractText>Original experimental evidence.</AbstractText></Abstract></Article>${extra}</MedlineCitation></PubmedArticle>`;
 const bodies=[];const sources=[{url:'https://pubmed.ncbi.nlm.nih.gov/1001/#1',hostname:'pubmed.ncbi.nlm.nih.gov',title:'Misleading reference title',content:'unreliable snippet'}];
 const result=await R.enrichAuthorResearchPubmed(sources,{fetchImpl:async(url,opt)=>{bodies.push(opt.body);assert.ok(!opt.headers.Authorization);return new Response('<PubmedArticleSet>'+ (bodies.length===1?xml('1001','Correction','<CommentsCorrectionsList><CommentsCorrections RefType="ErratumFor"><PMID>1002</PMID></CommentsCorrections></CommentsCorrectionsList>'):xml('1002','Actual original study'))+'</PubmedArticleSet>');}});
 assert.equal(bodies.length,2);assert.match(bodies[1],/id=1002/);assert.equal(result[0].url,'https://pubmed.ncbi.nlm.nih.gov/1002/');assert.equal(result[0].title,'Actual original study');
 assert.equal(result[0].bibliographicRecord.authors[0].name,'Soyon Hong');assert.ok(!result[0].content.includes('Misleading reference'));
});
test('aborted author research never sends planning, search or fetch requests',async()=>{
 let calls=0;const controller=new AbortController();controller.abort();
 const adapter=createDeepSeekAdapter({model:'deepseek-flash',apiKey:'fixture'},async()=>{calls++;throw Error('unexpected')});
 const events=await collect(adapter,{authorResearch:R.planArticleAuthorResearch(input),webSearchQueries:['query'],signal:controller.signal});
 assert.equal(calls,0);assert.equal(events.at(-1).error.code,'CANCELLED');
});
