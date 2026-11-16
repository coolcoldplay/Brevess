(function (g, factory) { const api=factory(g.WFGSchema || (typeof require==='function'?require('./schema.js'):null)); if(typeof module==='object') module.exports=api; g.WFGModel=api; })(globalThis,function(S){
  'use strict';
  const ERROR_CODES=new Set(['AUTH_INVALID','AUTH_MISSING','AUTH_FAILED','RATE_LIMITED','PROVIDER_UNAVAILABLE','NETWORK_ERROR','OUTPUT_TRUNCATED','REQUEST_TIMEOUT','TIMEOUT','CANCELLED','CONTENT_FILTERED','MODEL_NOT_FOUND','INVALID_REQUEST','CONTEXT_LENGTH_EXCEEDED','EMPTY_RESPONSE','INVALID_RESPONSE','STREAM_PARSE_ERROR']);
  function providerError(error){const raw=String(error?.code||'');const code=ERROR_CODES.has(raw)?raw:'PROVIDER_ERROR';const e=Error('MODEL_'+code);e.code=code;return e;}
  function parseReply(raw){let text=String(raw||'').trim();const fence=String.fromCharCode(96).repeat(3);if(text.startsWith(fence)){const lines=text.split('\n');if(!['','json'].includes(lines[0].slice(3).trim().toLowerCase())||lines.at(-1).trim()!==fence)throw Error('MODEL_JSON_INVALID');text=lines.slice(1,-1).join('\n').trim();}let reply;try{reply=JSON.parse(text);}catch{throw Error('MODEL_JSON_INVALID');}if(!reply||typeof reply!=='object'||Array.isArray(reply))throw Error('MODEL_REPLY_INVALID');return reply;}

  // Read only a top-level JSON string value, including a safely decoded unfinished
  // value. Never eval model output or mistake a nested evidence quote for an answer.
  function readArticleChatDraftString(raw, wanted) {
    const text=String(raw||'').trimStart(); if(text[0]!=='{')return null;
    let depth=0;
    for(let i=0;i<text.length;i++){
      const c=text[i]; if(c==='{'||c==='['){depth++;continue;} if(c==='}'||c===']'){depth--;continue;}
      if(c!=='"')continue;
      const start=i;let escaped=false;
      for(i++;i<text.length;i++){if(escaped){escaped=false;continue;}if(text[i]==='\\'){escaped=true;continue;}if(text[i]==='"')break;}
      if(i===text.length)return null;
      let key;try{key=JSON.parse(text.slice(start,i+1));}catch{return null;}
      let p=i+1;while(/\s/.test(text[p]||'')&&p<text.length)p++;
      if(depth!==1||text[p]!==':'||key!==wanted)continue;
      p++;while(/\s/.test(text[p]||'')&&p<text.length)p++;
      if(text[p]!== '"')return null;
      let result='';
      for(p++;p<text.length;p++){
        const ch=text[p];if(ch==='"')return result;if(ch<' ')return null;
        if(ch!=='\\'){result+=ch;continue;}
        const escape=text[++p];if(escape===undefined)break;
        if(escape==='u'){const hex=text.slice(p+1,p+5);if(!/^[0-9a-f]{4}$/i.test(hex))break;result+=String.fromCharCode(parseInt(hex,16));p+=4;}
        else {const map={'"':'"','\\':'\\','/':'/',b:'\b',f:'\f',n:'\n',r:'\r',t:'\t'};if(!Object.hasOwn(map,escape))return null;result+=map[escape];}
      }
      return result.replace(/[\uD800-\uDBFF]$/u,'');
    }
    return null;
  }

  async function collect({adapter,input,maxCharacters=50000,onProgress=()=>{}}){
    const report=e=>{try{onProgress(e);}catch{}};let lastDraft='';
    const controller=new AbortController(),signal=input.signal;let timer,iterator,finished=false,raw='',complete=false,rejectStop;
    const stop=new Promise((_,reject)=>{rejectStop=reject;});
    const cancel=()=>{controller.abort();rejectStop(Error('MODEL_CANCELLED'));};
    if(signal?.aborted)throw Error('MODEL_CANCELLED');
    signal?.addEventListener('abort',cancel,{once:true});
    timer=setTimeout(()=>{controller.abort();rejectStop(Error('MODEL_TIMEOUT'));},Math.max(1,Math.min(input.timeoutMs||120000,120000)));
    try{
      iterator=adapter.generateTextStream({...input,signal:controller.signal})[Symbol.asyncIterator]();
      for(;;){const next=await Promise.race([iterator.next(),stop]);if(next.done){finished=true;break;}const e=next.value||{};
        if(signal?.aborted)throw Error('MODEL_CANCELLED');
        if(['public_reasoning_delta','public_summary'].includes(e.type)&&e.visibility==='public'&&typeof e.text==='string'&&!complete)report({type:e.type,visibility:'public',text:e.text.slice(0,8192)});
        if(e.type==='text_delta'){if(complete||typeof e.text!=='string')throw Error('MODEL_STREAM_INVALID');raw+=e.text;if(raw.length>maxCharacters)throw Error('MODEL_OUTPUT_TOO_LARGE');
          const draft=readArticleChatDraftString(raw,'kind')==='answer'?readArticleChatDraftString(raw,'answer'):null;
          if(draft!==null&&draft!==lastDraft){lastDraft=draft;report({type:'answer_preview',text:draft.slice(0,32768)});}}

        if(e.type==='error')throw providerError(e.error);
        if(e.type==='cancelled')throw Error('MODEL_CANCELLED');
        if(e.type==='completed'){if(complete)throw Error('MODEL_STREAM_INVALID');if(['length','max_tokens'].includes(e.finishReason))throw providerError({code:'OUTPUT_TRUNCATED'});if(['content_filter','safety','refusal'].includes(e.finishReason))throw providerError({code:'CONTENT_FILTERED'});complete=true;}
      }
      if(!complete)throw Error('MODEL_INCOMPLETE');return raw;
    }catch(e){if(signal?.aborted)throw Error('MODEL_CANCELLED');if(/^MODEL_[A-Z_]+$/.test(e?.message||''))throw e;throw providerError(e);}
    finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);if(!finished){controller.abort();try{Promise.resolve(iterator?.return?.()).catch(()=>{});}catch{}}}
  }
  function planReply(reply,{previous,scope,sidebar=false}){
    if(Object.keys(reply).some(k=>!['kind','name','operations','removePrevious'].includes(k)))throw Error('MODEL_PLAN_FIELDS');
    const removal=reply.removePrevious===undefined?[]:reply.removePrevious;if(!Array.isArray(removal)||removal.some(i=>!Number.isInteger(i)||i<0||i>=(previous?.operations.length||0))||new Set(removal).size!==removal.length)throw Error('MODEL_REMOVAL_INVALID');
    const next=S.validate({schemaVersion:2,id:previous?.id||crypto.randomUUID(),revision:previous?.revision||0,name:reply.name,scope,operations:reply.operations?.map(op=>sidebar&&op?.type==='outline'&&op.placement===undefined?{...op,placement:'sidebar'}:op)});
    // A follow-up cannot accidentally erase earlier operations. The model explicitly
    // identifies indices to remove; schema/storage format stays version 2.
    const operations=(previous?.operations||[]).filter((_,i)=>!removal.includes(i)).map(S.clone);
    for(const op of next.operations){const key=JSON.stringify(op.target),index=operations.findIndex(old=>JSON.stringify(old.target)===key&&(old.type===op.type&&(op.type!=='replaceColor'||JSON.stringify([old.from,[...old.properties].sort()])===JSON.stringify([op.from,[...op.properties].sort()]))||(['hide','show'].includes(old.type)&&['hide','show'].includes(op.type))));if(index>=0){operations[index]=op.type==='style'&&operations[index].type==='style'?{...op,styles:{...operations[index].styles,...op.styles}}:op;}else operations.push(op);}
    return S.validate({...next,operations});
  }


  async function run({createTask,question,previous,feedback,selected,reference,tool,scope,signal,onStep=()=>{}}){
    if(typeof question!=='string'||!question.trim()||question.length>4000)throw Error('QUESTION_INVALID');
    const task=await createTask(); if(!task.adapter?.generateTextStream)throw Error('MODEL_UNAVAILABLE');
    let referenceData=reference?S.clone(reference):null;if(referenceData?.sourceStyle){const original=referenceData.sourceStyle.length,budget=Math.min(6000,Math.floor((task.maxCharacters||24000)*.25));while(referenceData.sourceStyle.length&&JSON.stringify(referenceData).length>budget)referenceData.sourceStyle.pop();referenceData.coverage={...referenceData.coverage,included:referenceData.sourceStyle.length,omitted:original-referenceData.sourceStyle.length};}const overview=await tool('overview',{}), history=[{question,reference:referenceData,selected:selected||null,previous:previous?S.validate(previous):null,feedback:feedback||null,overview}];
    let used=0,repairs=0,correction=null;
    for(let turn=0;turn<12;turn++){
      if(signal?.aborted)throw Error('MODEL_CANCELLED');
      const userPrompt=JSON.stringify({turn,history,...(correction?{correction}:{})}); if(userPrompt.length+S.protocol.length>Math.min(task.maxCharacters||24000,90000))throw Error('MODEL_CONTEXT_BUDGET_EXCEEDED');
      const raw=await collect({adapter:task.adapter,input:{systemPrompt:S.protocol,userPrompt,maxOutputTokens:task.maxOutputTokens||3000,timeoutMs:90000,signal,structuredOutput:false,conversationKey:'web-filter-general',conversationLabel:'通用网页滤镜'},maxCharacters:40000});used++;
      let reply;try{reply=parseReply(raw);}catch(e){if(e.message!=='MODEL_JSON_INVALID'||repairs>=1)throw e;repairs++;correction={code:e.message,message:'Return one complete valid JSON object under the same strict schema.'};continue;}correction=null;
      if(reply.kind==='plan'){
        const records=data=>data?.items||data?.frames?.flatMap(f=>f.data?.sample||[])||(data?.id?[data]:[]),known=[...records(overview),...(selected?.target?[selected]:[]),...history.flatMap(h=>records(h.result))],key=t=>JSON.stringify([t?.frame,t?.roots,t?.selector]);
        for(const op of reply.operations||[])if(op?.type==='replaceColor'&&!known.some(r=>key(r.target)===key(op.target)))throw Error('MODEL_PLAN_TARGET_UNREAD');
        try{return {plan:planReply(reply,{previous,scope}),steps:used,repairs};}catch(error){const failure=planFailure(error);if(repairs>=1)throw Error(failure.code);repairs++;correction={...failure,message:'Return one complete object under the exact schema; use no code or additional fields.'};continue;}}
      if(reply.kind==='unsupported')throw Error('MODEL_PLAN_UNSUPPORTED');
      if(reply.kind!=='tool'||!['overview','read','find','inspect'].includes(reply.tool)||Object.keys(reply).some(k=>!['kind','tool','args'].includes(k)))throw Error('MODEL_PROTOCOL_INVALID');
      const result=await tool(reply.tool,reply.args||{}); onStep({step:used,tool:reply.tool}); history.push({request:reply,result});
    }
    throw Error('MODEL_TOOL_LIMIT');
  }
  // Explicit protocol fixture, independent of the request wording. Not a natural-language parser.
  async function example({tool,scope,previous}) { const all=await tool('overview',{}), f=all.frames.find(f=>f.frameId===0&&f.ok); if(!f)throw Error('TOP_FRAME_UNAVAILABLE'); const found=await tool('find',{frameId:0,session:f.data.session,query:'h1',offset:0,limit:1}); const first=found.items[0] || (await tool('read',{frameId:0,session:f.data.session,offset:0,limit:1})).items[0]; if(!first)throw Error('NO_ELEMENTS'); const item=await tool('inspect',{frameId:0,session:f.data.session,id:first.id}); return {plan:S.validate({schemaVersion:2,id:previous?.id||crypto.randomUUID(),revision:previous?.revision||0,name:'协议示例：所选标题',scope,operations:[{type:'style',target:item.target,styles:{color:'#305c88','font-size':'32px'}},{type:'outline',target:item.target,label:'示例大纲'}]}),steps:3}; }
  function planFailure(error){const reason=String(error?.message||'').split(':')[0];return {code:reason==='UNKNOWN_OPERATION'?'MODEL_PLAN_UNSUPPORTED':'MODEL_PLAN_INVALID',reason};}
  return {run,example,parseReply,collect,providerError,planReply,planFailure};
});
