const test=require('node:test'),assert=require('node:assert/strict');
const {createReadingJobController}=require('../extension/core/reading-job-controller.js');
const {createReadingAgentTools,readingAgentDefinitions}=require('../extension/core/reading-agent-tools.js');
const {buildReadingPackEntries}=require('../extension/core/reading-pack.js');
const {createRegistry}=require('../extension/mcp/lib/registry.js');
const bind=id=>({tabId:id,url:`https://journal.test/paper${id}`,documentIdentity:'document'+id,navigationIdentity:'nav'+id,documentHash:'hash'+id,figureIds:['fig2']});
function fixture(saved=[]){
  const records={},calls=[],tasks=[];let changed=false,delay=null;
  const browser={storage:{session:{get:async()=>({'brevess-reading-jobs-v1':saved}),set:async v=>Object.assign(records,v)}},tabs:{query:async()=>[{id:1,title:'Paper',url:bind(1).url},{id:2,url:'chrome://settings'}],get:async id=>({id,url:changed?'https://journal.test/another':bind(id).url}),create:async options=>({id:3,...options}),sendMessage:async(id,message)=>{
    calls.push({id,message});
    if(message.action==='getReadingAgentSnapshot')return{success:true,data:{binding:bind(id),figures:[{figureId:'fig1'},{figureId:'fig2'}],status:{running:false}}};
    if(message.action==='analyzeFiguresWithLLM'){if(delay)await delay;return{success:true,totalFigures:1};}
    if(message.action==='getFigureAnalysisStatus')return{success:true,status:{operationId:calls.findLast(c=>c.id===id&&c.message.action==='analyzeFiguresWithLLM')?.message.operationId,phase:'completed',completedFigures:1,totalFigures:1}};
    return{success:true};
  }}};
  const controller=createReadingJobController({browser,ensureContent:async()=>{},save:async binding=>({complete:true,workspaceId:'saved'+binding.tabId}),bundle:async a=>a,keepAlive:task=>{tasks.push(task);return task;}});
  return{controller,calls,records,tasks,change:()=>changed=true,delay:p=>delay=p};
}
test('read tools are discoverable and schemas preserve selected figures',async()=>{
  const tools=createReadingAgentTools({call:async m=>({success:true,data:m.args})});
  await assert.rejects(()=>tools.execute('reading_start',{requestId:'x',task:'figures',targets:[{...bind(1),figureIds:[]}]}),/READING_ARGUMENT_INVALID/);
  await assert.rejects(()=>tools.execute('reading_inspect',{tabId:1,apiKey:'not-accepted'}),/READING_ARGUMENT_INVALID/);
  const registry=createRegistry({hub:{call:async()=>({})}});
  const names=registry.list().map(t=>t.name);
  for(const name of ['list_tabs','inspect','start','status','cancel','bundle','open'])assert.ok(names.includes('reading.'+name));
  assert.equal(readingAgentDefinitions.length,7);
});
test('batch analyzes exact selection, saves each target and deduplicates request',async()=>{
  const f=fixture(),args={requestId:'one',task:'figures',targets:[bind(1),bind(2)]};
  const job=await f.controller.handle('reading_start',args);await Promise.all(f.tasks);
  const result=await f.controller.handle('reading_status',{jobId:job.jobId});
  assert.match(result.targets[0].operationId,/^figure-[a-f0-9-]{36}$/i);assert.equal(result.state,'completed');assert.equal(result.targets[1].saved.workspaceId,'saved2');
  assert.deepEqual(f.calls.filter(c=>c.message.action==='analyzeFiguresWithLLM').map(c=>c.message.figureIds),[['fig2'],['fig2']]);
  assert.equal((await f.controller.handle('reading_start',args)).jobId,job.jobId);assert.equal(f.tasks.length,1);
  await assert.rejects(()=>f.controller.handle('reading_start',{...args,task:'save'}),/READING_REQUEST_ID_REUSED/);
});
test('navigation change prevents processing a different paper',async()=>{
  const f=fixture();f.change();const job=await f.controller.handle('reading_start',{requestId:'change',task:'figures',targets:[bind(1)]});await Promise.all(f.tasks);
  const result=await f.controller.handle('reading_status',{jobId:job.jobId});assert.equal(result.state,'failed');assert.equal(result.targets[0].error.code,'READING_TARGET_CHANGED');assert.equal(f.calls.length,0);
});
test('cancel retains completed work, never starts next paper or cancels an unrelated operation',async()=>{
  const f=fixture();let release;f.delay(new Promise(r=>release=r));
  const job=await f.controller.handle('reading_start',{requestId:'cancel',task:'figures',targets:[bind(1),bind(2)]});
  for(let i=0;i<10&&!f.calls.some(c=>c.message.action==='analyzeFiguresWithLLM');i++)await new Promise(r=>setImmediate(r));
  await f.controller.handle('reading_cancel',{jobId:job.jobId});release();await Promise.all(f.tasks);
  const result=await f.controller.handle('reading_status',{jobId:job.jobId});assert.equal(result.state,'cancelled');assert.equal(result.targets[1].state,'cancelled');assert.equal(f.calls.filter(c=>c.message.action==='analyzeFiguresWithLLM').length,1);
});
test('worker restart reports interruption and never silently repeats paid analysis',async()=>{
  const f=fixture([{jobId:'old',requestId:'old',state:'running',targets:[{state:'running',binding:bind(1)}]}]);const result=await f.controller.handle('reading_status',{jobId:'old'});assert.equal(result.state,'interrupted');assert.equal(result.targets[0].state,'interrupted');assert.equal(f.calls.length,0);
});
test('readiness errors and full package data remain explicit',()=>{
  assert.throws(()=>buildReadingPackEntries({workspace:{workspaceId:'w'},assets:[]}),/完整离线/);
  const snapshot='<html><head><meta name="brevess-offline-snapshot" content="'+encodeURIComponent(JSON.stringify({complete:false,savedAt:'today'}))+'"></head><body>paper</body></html>';
  const pack=buildReadingPackEntries({workspace:{workspaceId:'w',title:'<script>title</script>'},assets:[{relativePath:'article/offline-snapshot.html',content:snapshot},{relativePath:'notes/main.json',content:{text:'</script><script>bad()</script>'}},{relativePath:'internal/secret',content:'internal'},{relativePath:'exports/old.zip',content:'old'}],turns:[{question:'Why?',answer:'Evidence.'}]});
  assert.equal(pack.complete,false);assert.equal(pack.assetCount,2);assert.equal(pack.turnCount,1);
  const data=JSON.parse(pack.entries.find(e=>e.path==='reading-data.json').data);assert.equal(data.turns[0].answer,'Evidence.');assert.equal(data.assets.length,2);
  const html=pack.entries[0].data;assert.ok(html.includes('sandbox'));assert.ok(!html.includes('<script>bad()'));assert.ok(html.includes('\\u003c/script>'));
});
test('Agent can inspect an owned saved reader without injecting or visiting the publisher',async()=>{
  const offline=require('../extension/core/offline-article-workspace.js');Object.assign(globalThis.SciLLM ||= {},offline);
  const base='chrome-extension://'+'a'.repeat(32)+'/',url=base+'offline-reader.html?workspaceId='+encodeURIComponent('workspace:'+'b'.repeat(64))+'&generation=1';
  const calls=[];const browser={runtime:{getURL:p=>base+p},storage:{session:{get:async()=>({}),set:async()=>{}}},tabs:{query:async()=>[{id:1,url},{id:2,url:base+'options.html'}],get:async()=>({id:1,url}),sendMessage:async(id,message)=>{
    calls.push(message.action);if(message.action==='validateSavedArticleReader')return{success:true,binding:{workspaceId:'workspace:'+'b'.repeat(64)}};
    return{success:true,data:{binding:{documentIdentity:'same-doc',navigationIdentity:url,documentHash:'hash'},figures:[{figureId:'fig2'}]}};
  }}};
  const controller=createReadingJobController({browser,ensureContent:()=>{throw Error('must not inject saved reader');}});
  assert.equal((await controller.handle('reading_list_tabs',{})).tabs.length,1);
  assert.equal((await controller.handle('reading_inspect',{tabId:1})).binding.url,url);
  assert.deepEqual(calls,['validateSavedArticleReader','getReadingAgentSnapshot']);
});
