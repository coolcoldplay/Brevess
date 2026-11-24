'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),{spawn}=require('node:child_process'),readline=require('node:readline');
const sdkNames={workbuddy:'codebuddy',codebuddy:'codebuddy',claude:'claude'};
const acpNames={gemini:['gemini','--acp'],opencode:['opencode','acp'],copilot:['copilot','--acp'],qwen:['qwen','--acp'],kimi:['kimi','acp']};
const failure=(code,message)=>Object.assign(new Error(message||code),{code});
const token=s=>typeof s==='string'&&s.length>0&&s.length<=256&&!/[\x00-\x1f]/.test(s)&&!s.startsWith('-');
function file(p){try{return fs.statSync(p).isFile();}catch{return false;}}
function locate(id){
  if(id==='workbuddy'){
    const roots=process.platform==='darwin'?['/Applications/WorkBuddy.app/Contents/Resources',path.join(os.homedir(),'Applications/WorkBuddy.app/Contents/Resources')]:process.platform==='win32'?[path.join(process.env.LOCALAPPDATA||'','Programs','WorkBuddy','resources'),path.join(process.env.ProgramFiles||'C:\\Program Files','WorkBuddy','resources')]:[];
    for(const root of roots){const cli=path.join(root,'app.asar.unpacked','cli'),module=path.join(cli,'dist','codebuddy-lite-wb.mjs');if(file(module))return {cmd:process.execPath,args:[module],product:path.join(cli,'product.json'),sdk:true};}
  }
  const name=sdkNames[id]||acpNames[id]?.[0];if(!name)return null;
  const dirs=[...(process.env.PATH||'').split(path.delimiter),path.join(os.homedir(),'.local','bin'),'/opt/homebrew/bin','/usr/local/bin'].filter(x=>path.isAbsolute(x));
  const packages={claude:'@anthropic-ai/claude-code',gemini:'@google/gemini-cli',qwen:'@qwen-code/qwen-code',copilot:'@github/copilot',opencode:'opencode-ai'};
  for(const dir of dirs){
    const cmd=path.join(dir,name+(process.platform==='win32'?'.exe':''));if(file(cmd))return {cmd,args:acpNames[id]?.slice(1)||[],sdk:!!sdkNames[id]};
    if(process.platform==='win32'&&packages[id]){
      const root=path.join(dir,'node_modules',packages[id]);
      try{
        const manifest=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
        const entry=typeof manifest.bin==='string'?manifest.bin:manifest.bin?.[name];
        if(typeof entry!=='string')continue;
        const target=path.resolve(root,entry);
        if(target.startsWith(root+path.sep)&&/\.[cm]?js$/i.test(target)&&file(target))return {cmd:process.execPath,args:[target,...(acpNames[id]?.slice(1)||[])],sdk:!!sdkNames[id]};
      }catch{}
    }
  }
  return null;
}
function sdkModels(info,product=[]){
  return (info.models||[]).flatMap(m=>{
    const id=m.id||m.value;if(!token(id))return [];
    const meta=product.find(v=>v.id===id)||{};
    const declared=m.supportedEffortLevels??m.supportedReasoningEfforts??meta.supportedEffortLevels??meta.reasoning?.efforts;
    const levels=m.supportsEffort===false||meta.supportsReasoning===false?[]:
      Array.isArray(declared)?declared:[];
    return [{id,name:m.name||m.displayName||id,reasoningEfforts:levels,defaultReasoningEffort:meta.reasoning?.effort}];
  });
}
function acpOptions(session){
  const opts=session.configOptions||[];
  const model=opts.find(o=>o.category==='model'),effort=opts.find(o=>o.category==='thought_level');
  const values=o=>(o?.options||[]).flatMap(v=>Array.isArray(v.options)?v.options:[v]).filter(v=>token(v.value));
  const selected=model?.currentValue||session.models?.currentModelId||'auto';
  const models=model?values(model).map(v=>({id:v.value,name:v.name})):
    (session.models?.availableModels||[]).filter(v=>token(v.modelId)).map(v=>({id:v.modelId,name:v.name}));
  if(!models.length)models.push({id:selected,name:selected});
  return {model,effort,selected,models:models.map(m=>({...m,reasoningEfforts:m.id===selected?values(effort).map(v=>v.value):[]}))};
}
async function withChild(command,args,signal,work){
  if(signal.aborted)throw failure('CANCELLED');
  const cwd=await fs.promises.mkdtemp(path.join(os.tmpdir(),'brevess-agent-')),child=spawn(command.cmd,[...command.args,...args],{cwd,stdio:['pipe','pipe','ignore'],windowsHide:true,shell:false});
  const lines=readline.createInterface({input:child.stdout}),listeners=new Set();let rejectExit;
  const ended=new Promise((_,reject)=>{rejectExit=reject;});
  child.once('error',()=>rejectExit(failure('AGENT_CONNECTOR_UNAVAILABLE','未找到可运行的客户端。')));child.once('close',()=>rejectExit(failure('AGENT_CLIENT_EXITED','客户端已退出，请检查登录状态。')));child.stdin.on('error',()=>{});
  const abort=()=>rejectExit(failure('CANCELLED'));signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
  lines.on('line',line=>{if(line.length>2000000){rejectExit(failure('OUTPUT_TOO_LARGE'));return;}let m;try{m=JSON.parse(line);}catch{return;}for(const f of listeners)f(m);});
  const send=x=>child.stdin.write(JSON.stringify(x)+'\n'),next=match=>new Promise(resolve=>{const f=m=>{if(match(m)){listeners.delete(f);resolve(m);}};listeners.add(f);});
  const timer=setTimeout(()=>rejectExit(failure('REQUEST_TIMEOUT','客户端响应超时。')),290000);
  try{return await Promise.race([work({cwd,send,next,listen:f=>listeners.add(f)}),ended]);}
  finally{clearTimeout(timer);signal.removeEventListener('abort',abort);lines.close();listeners.clear();child.stdin.destroy();child.kill();const killer=setTimeout(()=>child.kill('SIGKILL'),800);killer.unref();await fs.promises.rm(cwd,{recursive:true,force:true}).catch(()=>{});}
}
async function sdk(command,id,op,a,signal){
  const args=['-p','--input-format','stream-json','--output-format','stream-json','--verbose','--tools','','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--no-session-persistence'];
  if(op==='turn'){if(!token(a.model))throw failure('MODEL_UNAVAILABLE');args.push('--model',a.model);if(a.reasoningEffort&&a.reasoningEffort!=='auto'){if(!/^[a-z][a-z0-9_-]{0,63}$/.test(a.reasoningEffort))throw failure('INVALID_SETTINGS');args.push('--effort',a.reasoningEffort);}}
  return withChild(command,args,signal,async({send,next,listen})=>{
    const init=crypto.randomUUID();const response=next(m=>m.type==='control_response'&&m.response?.request_id===init);
    send({type:'control_request',request_id:init,request:{subtype:'initialize'}});
    const ack=(await response).response;if(ack.subtype!=='success')throw failure('AGENT_CLIENT_INIT_FAILED');
    let product=[];if(command.product)try{product=JSON.parse(await fs.promises.readFile(command.product,'utf8')).models||[];}catch{}
    const models=sdkModels(ack.response||{},product),selected=ack.response?.currentModelId||models[0]?.id,info={models,model:selected,label:id==='workbuddy'?'WorkBuddy':id==='claude'?'Claude Code':'CodeBuddy Code'};
    if(op==='models')return info;
    const entry=models.find(m=>m.id===a.model);if(!entry||a.reasoningEffort!=='auto'&&a.reasoningEffort&&!entry.reasoningEfforts.includes(a.reasoningEffort))throw failure('WORKBENCH_AGENT_EFFORT_CHANGED');
    listen(m=>{if(m.type==='control_request')send({type:'control_response',response:{subtype:'error',request_id:m.request_id,error:'This connector only returns text to BREVESS.'}});});
    const result=next(m=>m.type==='result');
    send({type:'user',message:{role:'user',content:[{type:'text',text:a.systemPrompt+'\n\n'+a.userPrompt}]}});
    const end=await result;
    if(end.is_error && /authentication required|not (?:logged|signed) in|unauthenticated|sign in to your account/i.test(JSON.stringify(end.errors||end.result||'')))throw failure('AGENT_CLIENT_LOGIN_REQUIRED','该客户端的命令行尚未登录；可选择客户端接单。');
    if(end.is_error||end.subtype!=='success'||typeof end.result!=='string')throw failure('AGENT_CLIENT_TURN_FAILED','客户端未完成本轮，请检查该客户端的登录与模型可用性。');
    return end.result;
  });
}
async function acp(command,id,op,a,signal){
  return withChild(command,[],signal,async({cwd,send,next,listen})=>{
    let seq=0,text='';const rpc=async(method,params)=>{const n=++seq,p=next(m=>m.id===n&&!m.method);send({jsonrpc:'2.0',id:n,method,params});const ack=await p;if(ack.error)throw failure('AGENT_CLIENT_REQUEST_FAILED','客户端未接受 '+method+'。');return ack.result||{};};
    listen(m=>{
      if(m.method==='session/update'&&m.params?.update?.sessionUpdate==='agent_message_chunk'&&m.params.update.content?.type==='text'){text+=m.params.update.content.text;if(text.length>262144)text=text.slice(0,262145);}
      if(m.id!=null&&m.method){send(m.method==='session/request_permission'?{jsonrpc:'2.0',id:m.id,result:{outcome:{outcome:'cancelled'}}}:{jsonrpc:'2.0',id:m.id,error:{code:-32601,message:'Not supported'}});}
    });
    await rpc('initialize',{protocolVersion:1,clientCapabilities:{fs:{readTextFile:false,writeTextFile:false},terminal:false},clientInfo:{name:'BREVESS',version:'1'}});
    const session=await rpc('session/new',{cwd,mcpServers:[]});const sid=session.sessionId;let cap=acpOptions(session);
    if(a.model&&a.model!==cap.selected){
      if(!cap.models.some(row=>row.id===a.model))throw failure('MODEL_UNAVAILABLE');
      if(cap.model){const result=await rpc('session/set_config_option',{sessionId:sid,configId:cap.model.id,value:a.model});cap=acpOptions({...session,...result});}
      else{await rpc('session/set_model',{sessionId:sid,modelId:a.model});cap={...cap,selected:a.model};}
    }
    if(op==='models')return {models:cap.models,model:cap.selected,perModel:true,label:id};
    if(a.reasoningEffort&&a.reasoningEffort!=='auto'){
      if(!cap.effort||!cap.models.find(v=>v.id===a.model)?.reasoningEfforts.includes(a.reasoningEffort))throw failure('WORKBENCH_AGENT_EFFORT_CHANGED');
      await rpc('session/set_config_option',{sessionId:sid,configId:cap.effort.id,value:a.reasoningEffort});
    }
    const end=await rpc('session/prompt',{sessionId:sid,prompt:[{type:'text',text:a.systemPrompt+'\n\n'+a.userPrompt}]});
    if(end.stopReason!=='end_turn'||!text||text.length>262144)throw failure('AGENT_CLIENT_TURN_FAILED');return text;
  });
}
async function delegated(id,op,a,signal,store){
  if(op==='models')return {model:'auto',models:[{id:'auto',name:'由客户端选择',reasoningEfforts:[]}],label:id+' · 客户端接单',delegated:true};
  if(!['auto','client-default'].includes(a.model)||a.reasoningEffort&&a.reasoningEffort!=='auto')throw failure('MODEL_UNAVAILABLE');
  store ||= require('../mcp/lib/presentation-jobs.cjs').createStore();
  const job=crypto.randomUUID(),hash='workbench:'+job;
  let delivered=false;
  try{
    await store.command('open',{id:job,agent:id,kind:'chat',documentHash:hash,instructions:'Read paper.json. Apply its systemPrompt to task, then return the JSON answer using brevess_complete_task.',materials:{systemPrompt:a.systemPrompt,task:a.userPrompt}});
    await store.command('publish',{id:job});
    while(!signal.aborted){
      const state=await store.command('status',{id:job});if(state.state==='ready'){delivered=true;return state.answer;}if(['failed','cancelled','expired'].includes(state.state))throw failure('AGENT_CLIENT_TURN_FAILED');
      try{await require('node:timers/promises').setTimeout(800,null,{signal});}
      catch(error){if(signal.aborted)throw failure('CANCELLED');throw error;}
    }
    throw failure('CANCELLED');
  }finally{if(!delivered)await store.command('cancel',{id:job}).catch(()=>{});}
}
async function run(op,a,registered,signal){
  if(!['models','turn'].includes(op)||!registered.includes(a?.source))throw failure('AGENT_CLIENT_NOT_REGISTERED','此客户端尚未登记。');
  if(op==='turn'&&(typeof a.systemPrompt!=='string'||typeof a.userPrompt!=='string'||a.systemPrompt.length>524288||a.userPrompt.length>1048576))throw failure('INVALID_REQUEST');
  if(op==='turn'&&a.images?.length)throw failure('AGENT_CLIENT_IMAGES_UNSUPPORTED','此连接器当前仅接收文本。');
  const command=locate(a.source);
  if(!command||op==='turn'&&a.model==='client-default')return delegated(a.source,op,a,signal);
  const direct=command.sdk?sdk:acp;
  if(op==='turn')return direct(command,a.source,op,a,signal);
  try{
    const info=await direct(command,a.source,op,a.model==='client-default'?{...a,model:undefined}:a,signal);
    info.models.push({id:'client-default',name:'桌面客户端接单',reasoningEfforts:[]});
    if(a.source==='workbuddy'&&!a.model)info.model='client-default';
    info.delegated=a.model==='client-default'||info.model==='client-default';
    return info;
  }catch(error){
    if(signal.aborted||error.code==='MODEL_UNAVAILABLE')throw error;
    return delegated(a.source,op,a,signal);
  }
}
module.exports={run,locate,sdkModels,acpOptions,delegated};
