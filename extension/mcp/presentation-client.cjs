'use strict';
// Stdio connector. Only the named client's explicitly released paper jobs are visible.
const readline = require('node:readline');
const {createStore} = require('./lib/presentation-jobs.cjs');
const {agents} = require('../core/article-presentation.js');
const agent=process.argv[2];
if(!Object.hasOwn(agents,agent))process.exit(2);
const store=createStore();
const send=m=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',...m})+'\n');
const result=x=>({content:[{type:'text',text:JSON.stringify(x)}]});
const stringId={type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$'};
const questionProperties={type:'object',additionalProperties:false,required:['id','prompt','options'],properties:{
  id:stringId,prompt:{type:'string',minLength:1,maxLength:360},header:{type:'string',maxLength:120},multiple:{type:'boolean'},allowText:{type:'boolean'},
  options:{type:'array',maxItems:10,items:{type:'object',required:['id','label'],additionalProperties:false,properties:{
    id:stringId,label:{type:'string',minLength:1,maxLength:120},description:{type:'string',maxLength:200}}}}
}};
const tools=[
  ['brevess_wait_for_task','Wait for a task this reader assigned to this client. Returns task IDs and kinds, without paper contents.',{waitSeconds:{type:'integer',minimum:0,maximum:50}},[]],
  ['brevess_claim_task','Claim a BREVESS chat or presentation task. Use only the provided brief and authorized materials.',{id:{type:'string'}},['id']],
  ['brevess_complete_task','Return your final Markdown answer to the originating BREVESS paper chat after all reader questions are resolved.',{id:{type:'string'},answer:{type:'string',minLength:1,maxLength:98304}},['id','answer']],
  ['brevess_report_progress','Show the reader a short, factual task update in the originating paper chat, e.g. which figures have been checked.',{id:{type:'string'},message:{type:'string',minLength:1,maxLength:360}},['id','message']],
  ['brevess_wait_for_ppt','Wait for a paper presentation explicitly delegated to this client. Returns job IDs only. An empty list means there is no pending request.',{waitSeconds:{type:'integer',minimum:0,maximum:50}},[]],
  ['brevess_claim_ppt','Get the authorized paper, instructions, figure directory and exact output path for one requested deck. Read these local files with your normal tools, then create a genuine editable .pptx.',{id:{type:'string'}},['id']],
  ['brevess_deliver_ppt','Validate the finished presentation.pptx and deliver it to the paper chat. Success includes the slide count and SHA-256.',{id:{type:'string'}},['id']],
  ['brevess_ask_user','Ask the reader directly inside the originating BREVESS chat. Keep a stable requestId on retry. Supply original option labels, descriptions and selection mode. For text only, send empty options and allowText:true. Never use this to approve a tool or to collect credentials.',{id:{type:'string'},requestId:stringId,questions:{type:'array',minItems:1,maxItems:6,items:questionProperties}},['id','requestId','questions']],
  ['brevess_get_user_answer','Wait for answers to ONE question in ONE BREVESS task. Repeat while waiting. On answered use the chosen values and continue the same task. On dismissed or cancelled do not assume agreement.',{id:{type:'string'},requestId:stringId,waitSeconds:{type:'integer',minimum:0,maximum:45}},['id','requestId']]
].map(([name,description,properties,required])=>({name,description,inputSchema:{type:'object',properties,required,additionalProperties:false}}));
let closed=false;
const requests=new Map();
async function waitForAnswer(args, signal) {
  const end=Date.now()+1000*Math.max(0,Math.min(45,Number(args.waitSeconds) || 0));
  for(;;){
    const data=await store.command('answer',args,agent);
    if(data.state!=='waiting'||Date.now()>=end||closed||signal?.aborted)return data;
    await new Promise(resolve=>setTimeout(resolve,Math.min(500,end-Date.now())));
  }
}
async function handle(m){
 if(m.method==='notifications/cancelled'){requests.get(m.params?.requestId)?.abort();return;}
 if(!('id'in m))return;
 if(m.method==='initialize'){send({id:m.id,result:{protocolVersion:['2025-11-25','2025-06-18','2025-03-26','2024-11-05'].includes(m.params?.protocolVersion)?m.params.protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'brevess-presentations',version:'1.1.0'},instructions:'Wait for a task assigned to you. Claim the task and use its authorized materials. Send meaningful milestones using brevess_report_progress. When you need reader input use brevess_ask_user, then wait for their answer before continuing. Return the Markdown answer or editable deck to that same task.'}});return;}
 if(m.method==='tools/list'){send({id:m.id,result:{tools}});return;}
 if(m.method==='ping'){send({id:m.id,result:{}});return;}
 if(m.method!=='tools/call'){send({id:m.id,error:{code:-32601,message:'Method not found'}});return;}
 const name=m.params?.name,args=m.params?.arguments||{},controller=new AbortController();requests.set(m.id,controller);
 try{let data;
   if(name==='brevess_wait_for_ppt'||name==='brevess_wait_for_task'){const expiry=Date.now()+1000*Math.max(0,Math.min(50,Number(args.waitSeconds) || 0));
     do{data=(await store.list(agent)).filter(r=>name==='brevess_wait_for_task'||r.kind!=='chat').map(({id,state,kind})=>({id,state,kind:kind||'ppt'}));if(data.length||Date.now()>=expiry||closed||controller.signal.aborted)break;await new Promise(r=>setTimeout(r,500));}while(!closed);
   }else if(name==='brevess_claim_ppt'||name==='brevess_claim_task')data=await store.command('claim',{id:args.id},agent);
   else if(name==='brevess_complete_task')data=await store.command('complete',{id:args.id,answer:args.answer},agent);
   else if(name==='brevess_report_progress')data=await store.command('progress',{id:args.id,message:args.message},agent);
   else if(name==='brevess_deliver_ppt')data=await store.command('deliver',{id:args.id},agent);
   else if(name==='brevess_ask_user')data=await store.command('ask',args,agent);
   else if(name==='brevess_get_user_answer')data=await waitForAnswer(args,controller.signal);
   else throw Error('PPT_TOOL_UNKNOWN');
   if(!closed)send({id:m.id,result:result(data)});
 }catch(e){if(!closed)send({id:m.id,result:{...result({error:e.code||'PPT_JOB_FAILED'}),isError:true}});}
 finally{requests.delete(m.id);}
}
// Some desktop sessions do not hot-load a newly registered MCP server. The
// single-job command follows the same ownership, validation and receipt rules.
if (process.argv[3]) {
  const [flag,id,parameter] = process.argv.slice(3);
  const operation = {'--claim':'claim', '--deliver':'deliver','--ask':'ask','--wait-answer':'answer','--reply':'complete','--progress':'progress'}[flag];
  if (!operation || process.argv.length !== (['ask','answer','complete','progress'].includes(operation)?6:5)) process.exit(2);
  let args={id};
  if(operation==='complete')args.answer=parameter;
  if(operation==='progress')args.message=parameter;
  if(operation==='ask') {
    try { if(parameter.length>64512)throw Error(); const {requestId, questions}=JSON.parse(parameter);args={id,requestId,questions}; }
    catch {process.stderr.write('AGENT_QUESTION_INVALID\n');process.exit(2);}
  }
  const task=operation==='answer'?waitForAnswer({id,requestId:parameter,waitSeconds:40}):store.command(operation,args,agent);
  task
    .then(data => process.stdout.write(JSON.stringify(data) + '\n'))
    .catch(error => {process.stderr.write(String(error.code || 'PPT_JOB_FAILED') + '\n'); process.exitCode = 1;});
} else {
  const input = readline.createInterface({input:process.stdin, crlfDelay:Infinity});
  input.on('line', line => {
    try { void handle(JSON.parse(line)).catch(() => {}); } catch {}
  });
  input.on('close', () => { closed = true; });
}
