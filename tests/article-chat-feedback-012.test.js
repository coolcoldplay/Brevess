const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const fixture=fs.readFileSync(path.join(__dirname,'article-chat.test.js'),'utf8');
const {runArticleChat,normalizeArticleChatInput,articleMessage,profile,blockLine}=
  new Function('require',fixture.slice(0,fixture.indexOf('\ntest('))+
    '\nreturn {runArticleChat,normalizeArticleChatInput,articleMessage,profile,blockLine};')(require);
const {createArticleChatNdjsonParser}=require('../core/article-chat-stream.js');

function tableFixture(count=25) {
  const paragraphs=Array.from({length:47},(_,i)=>({paragraphId:'p-'+i,
    sourceKey:'methods:'+i,textHash:'hash-'+i,sectionId:'methods',sectionTitle:'Methods',
    sectionPath:['Methods'],text:'Measurement '+i+' was reported in the source.'}));
  const rows=Array.from({length:count},(_,i)=>'| Item '+i+' | Measurement recorded. [['+(i+1)+']] |');
  const record={type:'answer_block',block_id:'table',markdown:
    '| Item | Purpose |\n| --- | --- |\n'+rows.join('\n'),
    evidence:Array.from({length:count},(_,i)=>({marker:String(i+1),
      paragraph_id:'p-'+(i%47),source_key:'methods:'+(i%47),text_hash:'hash-'+(i%47),
      quote:paragraphs[i%47].text}))};
  return {paragraphs,record};
}
function responseRecords(block) {
  return [block,{type:'turn_summary',summary:'The requested evidence was listed.'},
    {type:'final',status:'completed'}];
}
function streamRecords(records) {
  return (async function*(){
    for(const record of records)yield {type:'text_delta',text:JSON.stringify(record)+'\n'};
    yield {type:'completed',finishReason:'stop'};
  })();
}

test('25-row evidence table preserves every validated citation instead of silently dropping row 25',()=>{
  const {paragraphs,record}=tableFixture();
  const parser=createArticleChatNdjsonParser({snapshot:{revision:1,paragraphs},requireExactEvidence:true});
  parser.push(responseRecords(record).map(JSON.stringify).join('\n')+'\n');
  assert.equal(parser.finish(),true);
  const block=parser.snapshot().blocks[0];
  assert.equal(block.evidence.length,25);
  assert.ok(block.evidence.every(e=>e.verification.status==='verified'));
});

test('several successful turns followed by a 47-paragraph table query do not enter format repair',async()=>{
  const {paragraphs,record}=tableFixture();
  const history=[];
  let calls=0;
  for(let i=0;i<4;i++){
    const table=i===3;
    const block=table?record:{...record,block_id:'answer-'+i,
      markdown:'Measurement recorded. [[1]]',evidence:[record.evidence[0]]};
    const input=normalizeArticleChatInput(articleMessage({history:[...history],
      question:table?'列表格总结这篇文献用到的所有工具，并简要概括各自用途。':'说明测量结果',
      document:{title:'Synthetic 47 paragraph paper',url:'https://example.org/table',revision:1,paragraphs}}));
    const result=await runArticleChat({input,profile,adapter:{generateTextStream(){
      calls++;return streamRecords(responseRecords(block));}}});
    assert.equal(result.message.status,'completed');
    assert.equal(result.message.answerBlocks[0].evidence.length,table?25:1);
    history.push({turnId:'turn-'+i,question:input.question,answerBlocks:result.message.answerBlocks,
      summary:result.message.summary});
  }
  assert.equal(calls,4);
});

test('oversized or unmatched citations remain rejected without discarding an accepted prefix',()=>{
  const {paragraphs,record}=tableFixture(129);
  const parser=createArticleChatNdjsonParser({snapshot:{revision:1,paragraphs}});
  parser.push(JSON.stringify({type:'answer_block',block_id:'prefix',markdown:'Introduction.',evidence:[]})+'\n');
  assert.throws(()=>parser.push(JSON.stringify(record)+'\n'),e=>e.code==='INVALID_RESPONSE');
  assert.equal(parser.snapshot().blocks.length,1);
  const missing=tableFixture().record;missing.evidence.pop();
  assert.throws(()=>parser.push(JSON.stringify(missing)+'\n'),e=>e.code==='INVALID_RESPONSE');
});

test('two provider format-error events reach the existing single strict JSON fallback',async()=>{
  let streams=0,json=0;
  const events=[];
  const result=await runArticleChat({input:normalizeArticleChatInput(articleMessage()),profile,
    onProgress:e=>events.push(e),adapter:{
      generateTextStream(){streams++;return(async function*(){
        yield {type:'error',error:{code:'INVALID_RESPONSE',message:'synthetic invalid completed stream'}};
      })();},
      async generateJson(){json++;return {records:responseRecords(
        JSON.parse(blockLine('recovered','证据支持这条结论。[[1]]')))};}
    }});
  assert.equal(streams,2);assert.equal(json,1);
  assert.equal(result.message.status,'completed');
  assert.ok(events.some(e=>e.phase==='chat_json_fallback'));
});

test('failed JSON fallback remains bounded and next turn can succeed without old failure state',async()=>{
  let streams=0,json=0;
  const input=normalizeArticleChatInput(articleMessage());
  await assert.rejects(()=>runArticleChat({input,profile,adapter:{
    generateTextStream(){streams++;return(async function*(){
      yield {type:'error',error:{code:'INVALID_RESPONSE',message:'synthetic invalid stream'}};
    })();},
    async generateJson(){json++;return {records:[{type:'unsupported'}]};}
  }}),e=>e.code==='INVALID_RESPONSE');
  assert.equal(streams,2);assert.equal(json,1);
  const result=await runArticleChat({input,profile,adapter:{generateTextStream(){
    return streamRecords(responseRecords(JSON.parse(blockLine('next','下一轮保留准确证据。[[1]]'))));
  }}});
  assert.equal(result.message.status,'completed');
});

test('format failure message does not assert an unproven provider configuration fault or exactly two calls',()=>{
  const content=fs.readFileSync(path.join(__dirname,'../content.js'),'utf8');
  const start=content.indexOf('function articleChatFailureMessage(');
  const end=content.indexOf('\nfunction ',start+1);
  const scope={};vm.createContext(scope);vm.runInContext(content.slice(start,end),scope);
  const message=scope.articleChatFailureMessage({code:'INVALID_RESPONSE'});
  assert.doesNotMatch(message,/连续两次|Provider.*一致|接口协议/);
  assert.match(message,/格式|引用/);
});
