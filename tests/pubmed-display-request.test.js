const test = require('node:test');
const assert = require('node:assert/strict');
const research = require('../extension/web-filters-general/research.js');
const model = require('../extension/web-filters-general/model.js');
const schema = require('../extension/web-filters-general/schema.js');

const url = 'https://pubmed.ncbi.nlm.nih.gov/?term=GBM';
const target = {frame:'top', roots:[], selector:'article.full-docsum'};
const op = {type:'pubmedAbstracts', target};
const source = {id:'s1', title:'PubMed', url, frames:[{frameId:0, ok:true, data:{sample:[],total:10}}]};
async function request(question, options = {}, createTask = () => {throw Error('MODEL_REQUIRED');}) {
  const unified = {mode:'display', targetSource:'s1', scope:await schema.scope(url),
    targets:[], references:[], previousTargets:[], layout:{regions:[], capabilities:[op]}, ...options};
  return research.answer({question, sources:[source], unified, createTask});
}

test('full-abstract request works with previously selected elements and preserves prior edits', async () => {
  const prior = {type:'style', target:{...target,selector:'.docsum-title'}, styles:{color:'pink'}};
  const previous = model.planReply({kind:'plan',name:'Title color',operations:[prior]}, {scope:await schema.scope(url)});
  const {plan,steps} = await request('所有检索到的文献显示完整摘要，并把摘要字号改成18px', {previous, targets:[{id:'n1'}]});
  assert.equal(steps,0);
  assert.deepEqual(plan.operations,[prior,op,{type:'style',target:{...target,selector:'article.full-docsum .docsum-snippet'},styles:{'font-size':'18px'}}]);
});
test('ambiguous, negative, selective and unsupported requests are left to the configured model', async () => {
  for (const q of ['不要显示完整摘要','只展开第一篇的摘要','这个摘要说了什么','显示完整摘要，同时隐藏广告']) {
    await assert.rejects(request(q),/MODEL_REQUIRED/);
  }
  await assert.rejects(request('显示完整摘要', {targets:[{id:'n1'}]}),/MODEL_REQUIRED/);
  await assert.rejects(request('显示所有检索结果的完整摘要',{layout:null}),/MODEL_REQUIRED/);
});
test('only the verified result-card target is accepted for full abstracts', async () => {
  for (const bad of [{...target,selector:'body'},{...target,frame:'frame1'},{...target,roots:['main']}]) {
    assert.throws(()=>schema.validate({schemaVersion:2,id:'case',revision:0,name:'preview',scope:{mode:'route',origin:'https://pubmed.ncbi.nlm.nih.gov',path:'/',exactHash:''},operations:[{...op,target:bad}]}));
  }
});
test('a single fenced JSON object with surrounding prose can be read, ambiguous or executable output cannot', () => {
  const fenced=['```json','{"kind":"plan"}','```'].join('\n');
  assert.deepEqual(model.parseReply('方案如下。\n'+fenced+'\n请查看预览。'),{kind:'plan'});
  for (const raw of [fenced+'\n'+fenced, fenced+'\n{"kind":"unsupported"}',fenced.replace('json','js'),'[]']) assert.throws(()=>model.parseReply(raw));
});
test('a malformed tool request can be corrected into a combined display plan without executing the malformed call', async () => {
  const replies=[{kind:'tool',source:'s1',tool:'inspect',args:{frameId:0,selector:'unknown'}},
    {kind:'plan',name:'摘要和标题',operations:[op,{type:'style',target:{...target,selector:'.docsum-title'},styles:{'font-weight':'bold'}}]}];
  const createTask=()=>({adapter:{async *generateTextStream(input){
    const payload=JSON.parse(input.userPrompt);
    assert.equal(payload.unified.layout.capabilities[0].type,'pubmedAbstracts');
    if(replies.length===1)assert.equal(payload.correction.code,'TOOL_ARGUMENT_INVALID');
    yield {type:'text_delta',text:JSON.stringify(replies.shift())};yield {type:'completed'};
  }}});
  const result=await request('展开本页摘要，并将标题加粗',{},createTask);
  assert.equal(result.repairs,1);
  assert.deepEqual(result.plan.operations.map(x=>x.type),['pubmedAbstracts','style']);
});
