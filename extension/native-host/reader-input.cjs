'use strict';
const {randomUUID} = require('node:crypto');
const {setTimeout:delay} = require('node:timers/promises');
const {questionSet} = require('../core/article-presentation.js');
const {createStore} = require('../mcp/lib/presentation-jobs.cjs');

// This adapter handles the official reader-input request only. RPC IDs and
// the mapping back to native option labels never leave the owning host.
async function answerCodexQuestion(params,{documentHash,signal,publish,store=createStore(),interval=400}) {
  const source=params?.questions;
  if(!Array.isArray(source)||!source.length||source.length>6||source.some(q=>
    !q||q.isSecret===true||typeof q.id!=='string'||!q.id||q.id.length>160||
    (q.options!=null && !Array.isArray(q.options)))||new Set(source.map(q=>q.id)).size!==source.length)throw Error('AGENT_QUESTION_INVALID');
  const set=questionSet({requestId:randomUUID(),questions:source.map((q,i)=>({
    id:'q'+i,prompt:q.question,header:q.header,allowText:q.isOther===true||!q.options?.length,
    options:(q.options||[]).map((o,n)=>({id:'o'+n,label:o?.label,description:o?.description}))
  }))});
  if(!set||signal.aborted)throw Error('AGENT_QUESTION_INVALID');
  const id=randomUUID(),agent='codex';
  await store.command('openLive',{id,documentHash},agent);
  try{
    const waiting=await store.command('ask',{id,...set},agent);
    if(signal.aborted)throw Error('CANCELLED');
    publish({id,agent,documentHash,state:'working',interaction:waiting});
    for(;;){
      await delay(interval,undefined,{signal});
      const reply=await store.command('answer',{id,requestId:set.requestId},agent);
      if(reply.state==='waiting')continue;
      if(reply.state==='cancelled')throw Error('CANCELLED');
      publish({id,agent,documentHash,state:'working',interaction:reply});
      const answers=Object.create(null);
      if(reply.state==='answered')set.questions.forEach((q,i)=>{
        const a=reply.answers[q.id];
        answers[source[i].id]={answers:[...q.options.filter(o=>a.selected.includes(o.id)).map(o=>o.label),...(a.text?[a.text]:[])]};
      });
      return {answers};
    }
  }finally{await store.command('closeLive',{id},agent).catch(()=>{});}
}
module.exports={answerCodexQuestion};
