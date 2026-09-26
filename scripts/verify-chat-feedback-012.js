// QA-012: real isolated extension UI/storage/transport; synthetic local provider, zero real API.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const http=require('node:http');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'brevess-qa012-'));
const extension=path.join(temporary,'extension'),profile=path.join(temporary,'profile');
const output=fs.mkdtempSync(path.join(fs.mkdirSync(path.join(root,'output/playwright/r16-feedback-qa012'),
  {recursive:true})||path.join(root,'output/playwright/r16-feedback-qa012'),'run-'));
const articleUrl='https://example.org/brevess-qa012',title='QA-012 synthetic 47 paragraph article';
const paragraphs=Array.from({length:47},(_,i)=>
  'Measurement '+i+' was recorded in the matched control and treatment groups using an independent assay. This synthetic paragraph is only a local software test fixture.');
const report={taskId:'QA-012',status:'RUNNING',realApiCalls:0,source:'synthetic local 47-paragraph article',
  checks:[],requests:[],sourceHashes:{},artifacts:[],error:''};
let context,panel,server,serverUrl,mode='simple';
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const check=(name,pass)=>{assert.ok(pass,name);report.checks.push({name,passed:true});console.log('PASS '+name);};
function fixture(){
  return '<!doctype html><html><head><title>'+title+'</title><link rel="canonical" href="'+articleUrl+
    '"></head><body><main><article><h1>'+title+'</h1><h2>Results</h2>'+
    paragraphs.map((p,i)=>'<p id="p'+i+'">'+p+'</p>').join('')+'</article></main></body></html>';
}
function records(body,table){
  const user=body.messages.find(m=>m.role==='user').content;
  const input=JSON.parse(user.split('ARTICLE_CONTEXT\n')[1].split('\nCHAT_REQUEST')[0]);
  const sources=input.article.chunks.flatMap(chunk=>{
    const texts=chunk.text.split('\n\n');
    return chunk.sourceSpans.map((span,i)=>({...span,quote:texts[i]}));
  }).slice(0,table?25:1);
  assert.equal(sources.length,table?25:1,'source count');
  const evidence=sources.map((s,i)=>({marker:String(i+1),paragraph_id:s.paragraphId,
    source_key:s.sourceKey,text_hash:s.textHash,quote:s.quote}));
  const markdown=table?'| Item | Purpose |\n| --- | --- |\n'+sources.map((_,i)=>
    '| Item '+i+' | Measurement recorded. [['+(i+1)+']] |').join('\n'):'Measurement recorded. [[1]]';
  return [{type:'answer_block',block_id:'answer',markdown,evidence},
    {type:'turn_summary',summary:'The source measurements were summarized.'},
    {type:'final',status:'completed'}];
}
function prepare(){
  fs.mkdirSync(extension,{recursive:true});
  for(const dir of ['core','providers','vendor','icons','_locales'])
    fs.cpSync(path.join(root,dir),path.join(extension,dir),{recursive:true});
  for(const file of fs.readdirSync(root))if(/\.(js|mjs|html|css)$/.test(file)||file==='manifest.json')
    fs.copyFileSync(path.join(root,file),path.join(extension,file));
  for(const file of ['content.js','popup.js','popup.css','core/article-chat.js',
    'core/article-chat-stream.js','core/background-router.js','providers/deepseek.js'])
    report.sourceHashes[file]=hash(fs.readFileSync(path.join(extension,file)));
  const boundary='const qaFetch=globalThis.fetch.bind(globalThis);globalThis.fetch=(url,options)=>{'+
    'const parsed=new URL(String(url));if(parsed.origin!=="https://api.deepseek.com"||'+
    'parsed.pathname!=="/chat/completions")throw Error("QA_REMOTE_FETCH_BLOCKED");'+
    'return qaFetch('+JSON.stringify(serverUrl)+'+parsed.pathname,options);};\n';
  const worker=path.join(extension,'offscreen-network-worker.js');
  fs.writeFileSync(worker,boundary+fs.readFileSync(worker,'utf8'));
}
async function setup(){
  await panel.evaluate(async()=>{
    for(const message of [
      {type:'LLM_SAVE_PROFILE',profile:{id:'profile_qa012',name:'QA local fixture',providerId:'deepseek',
        config:{apiKey:'fixture-not-a-real-key',model:'deepseek-flash',maxOutputTokens:8192,reasoningEnabled:false}}},
      {type:'LLM_UPDATE_PROFILE_ROUTING',globalProfileId:'profile_qa012',taskRoutes:{}},
      {type:'LLM_UPDATE_PREFERENCES',preferences:{mode:'llm',consentGranted:true}}
    ]){const r=await chrome.runtime.sendMessage(message);if(!r?.success)throw Error('PROFILE_SETUP_FAILED:'+message.type+':'+String(r?.error?.code||''));}
    await loadLlmSettings();await refreshArticleWorkspace();switchWorkspaceView('chat');
    const select=document.getElementById('articleChatProfile');select.value='profile_qa012';
    select.dispatchEvent(new Event('change',{bubbles:true}));
  });
}
async function archive(){
  return panel.evaluate(async()=> (await getCurrentArticleArchiveFromTab()).archive);
}
async function settled(count,status){
  const deadline=Date.now()+45000;
  while(Date.now()<deadline){
    const value=await archive();
    const turns=value?.workspace?.chat?.turns||[];
    if(turns.length===count&&turns[count-1]?.status===status){
      await panel.waitForFunction(()=>currentWorkspaceSnapshot?.chat?.loading!==true);
      return turns;
    }
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  report.lastArchive=await archive().then(value=>({turns:(value.workspace?.chat?.turns||[])
    .map(t=>({status:t.status,errorCode:t.errorCode,error:t.error})),loading:value.workspace?.chat?.loading}));
  throw Error('TURN_SETTLE_TIMEOUT_'+status);
}
async function submit(question){
  const before=await panel.locator('.article-chat-turn').count();
  await panel.locator('#articleChatQuestion').fill(question);
  await panel.locator('#sendArticleChat').click();
  await panel.waitForFunction(count=>document.querySelectorAll('.article-chat-turn').length>count||
    /发送失败|请先/.test(document.getElementById('statusMessage')?.textContent||''),before,{timeout:15000});
  const status=await panel.locator('#statusMessage').textContent();
  if(/发送失败|请先/.test(status))throw Error(status);
}
async function screenshot(name){
  await panel.screenshot({path:path.join(output,name),fullPage:false});report.artifacts.push(name);
}
(async()=>{
  server=http.createServer(async(request,reply)=>{
    reply.setHeader('Access-Control-Allow-Origin','*');reply.setHeader('Access-Control-Allow-Headers','*');
    if(request.method==='OPTIONS'){reply.writeHead(204);reply.end();return;}
    try {
      let raw='';for await(const part of request){raw+=part;if(raw.length>2*1024*1024)throw Error('REQUEST_BOUND');}
      const body=JSON.parse(raw);
      report.requests.push({mode,stream:body.stream===true});
      const invalidStream=mode==='bad-stream'||mode==='fail';
      if(body.stream&&invalidStream){reply.setHeader('Content-Type','application/json');reply.end('invalid synthetic envelope');return;}
      const selected=mode==='fail'?[{type:'unsupported'}]:records(body,mode==='table');
      if(!body.stream){
        reply.setHeader('Content-Type','application/json');
        reply.end(JSON.stringify({choices:[{message:{content:JSON.stringify({records:selected})},finish_reason:'stop'}]}));return;
      }
      const text=selected.map(JSON.stringify).join('\n')+'\n';
      const chunks=[{choices:[{delta:{content:text},finish_reason:null}]},
        {choices:[{delta:{},finish_reason:'stop'}],usage:{prompt_tokens:200,completion_tokens:100}}];
      reply.setHeader('Content-Type','text/event-stream');
      reply.end(chunks.map(c=>'data: '+JSON.stringify(c)+'\n\n').join('')+'data: [DONE]\n\n');
    }catch(error){report.serverError=error.message;reply.writeHead(500);reply.end('synthetic fixture error');}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  serverUrl='http://127.0.0.1:'+server.address().port;prepare();
  context=await chromium.launchPersistentContext(profile,{channel:'msedge',headless:true,
    viewport:{width:1280,height:900},args:['--disable-extensions-except='+extension,'--load-extension='+extension]});
  await context.route(/^https?:\/\//,route=>{
    const url=route.request().url();
    if(url===articleUrl)return route.fulfill({contentType:'text/html',body:fixture()});
    if(url.startsWith(serverUrl+'/'))return route.continue();
    return route.abort('blockedbyclient');
  });
  const paper=context.pages()[0]||await context.newPage();await paper.goto(articleUrl);
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  const id=new URL(worker.url()).host;
  const tab=await worker.evaluate(async url=>(await chrome.tabs.query({})).find(t=>t.url===url),articleUrl);
  await worker.evaluate(async tab=>{
    const activation=await SciLLM.markTabActivated(chrome.storage.session,tab);
    await chrome.runtime.sendMessage({type:'PANEL_TAB_ACTIVATED',activation}).catch(()=>{});
  },tab);
  panel=await context.newPage();await panel.setViewportSize({width:620,height:960});
  await panel.goto('chrome-extension://'+id+'/popup.html');await paper.bringToFront();
  await panel.waitForFunction(t=>document.getElementById('sidePanelPaperTitle')?.textContent===t,title);
  await setup();
  for(let i=1;i<=3;i++){await submit('解释测量结果 '+i);await settled(i,'completed');}
  check('three ordinary turns complete',report.requests.length===3);
  mode='table';await submit('列表格总结全部工具及其用途');const table=await settled(4,'completed');
  check('fourth turn table has all 25 verified citations',table[3].answerBlocks[0].evidence.length===25&&
    table[3].answerBlocks[0].evidence.every(e=>e.verificationStatus==='verified'||e.verification?.status==='verified'));
  check('table completes in one provider response',report.requests.filter(r=>r.mode==='table').length===1);
  const tableTurn=panel.locator('.article-chat-turn').nth(3);
  check('actual rendered table has 25 body rows',await tableTurn.locator('table tbody tr').count()===25);
  await tableTurn.scrollIntoViewIfNeeded();await screenshot('table-25-citations.png');
  mode='bad-stream';await submit('检查流式格式错误兜底');await settled(5,'completed');
  check('two invalid streams use one JSON fallback',JSON.stringify(report.requests.filter(r=>r.mode==='bad-stream').map(r=>r.stream))==='[true,true,false]');
  mode='fail';await submit('保留错误以核对操作按钮');const failed=await settled(6,'error');
  check('failed fallback remains bounded',report.requests.filter(r=>r.mode==='fail').length===3);
  const failedTurn=panel.locator('.article-chat-turn').nth(5);
  check('retry and delete are enabled after failure',await failedTurn.locator('[data-article-chat-action="regenerate"]').isEnabled()&&
    await failedTurn.locator('[data-article-chat-action="delete-turn"]').isEnabled());
  report.errorActionInitial=await failedTurn.locator('.article-chat-turn-actions')
    .evaluate(element=>({opacity:getComputedStyle(element).opacity,
      transition:getComputedStyle(element).transition,
      turnClass:element.closest('.article-chat-turn').className,
      selectorMatches:element.matches('.article-chat-turn.is-interrupted .article-chat-turn-actions'),
      animations:element.getAnimations().map(a=>({playState:a.playState,currentTime:a.currentTime}))}));
  await panel.waitForFunction(id=>{
    const element=document.querySelector('[data-turn-id="'+id+'"] .article-chat-turn-actions');
    return element&&getComputedStyle(element).opacity==='1';
  },failed[5].turnId,{timeout:2000});
  check('failed actions remain visible without hover',true);
  check('format message avoids speculative provider blame',!failed[5].error.includes('接口协议'));
  await failedTurn.scrollIntoViewIfNeeded();await screenshot('recoverable-format-error.png');
  mode='simple';await failedTurn.locator('[data-article-chat-action="regenerate"]').click();await settled(6,'completed');
  check('actual regenerate click recovers same turn',(await archive()).workspace.chat.turns.length===6);
  mode='fail';await submit('删除失败问题不会删除此前回答');await settled(7,'error');
  await panel.locator('.article-chat-turn').nth(6).locator('[data-article-chat-action="delete-turn"]').click();
  await panel.waitForFunction(()=>currentWorkspaceSnapshot.chat.turns.length===6);
  check('actual delete click preserves previous answers',(await archive()).workspace.chat.turns.every(t=>t.status==='completed'));
  await panel.reload();await paper.bringToFront();
  await panel.waitForFunction(t=>document.getElementById('sidePanelPaperTitle')?.textContent===t,title);await setup();
  const reloaded=(await archive()).workspace.chat.turns;
  check('reload preserves 25 citations and all six completed turns',reloaded.length===6&&reloaded[3].answerBlocks[0].evidence.length===25);
  await panel.locator('.article-chat-turn').last().scrollIntoViewIfNeeded();await screenshot('reloaded-history.png');
  check('source files remained unchanged',Object.entries(report.sourceHashes).every(([file,digest])=>hash(fs.readFileSync(path.join(root,file)))===digest));
  report.status='PASS';
})().catch(async error=>{
  report.status='FAIL';report.error=error.message;process.exitCode=1;
  if(panel){
    report.failureText=await panel.locator('body').textContent().catch(()=> '');
    await screenshot('failure.png').catch(()=>{});
  }
}).finally(async()=>{
  await context?.close();if(server)await new Promise(resolve=>server.close(resolve));
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({status:report.status,checks:report.checks.length,requests:report.requests.length,error:report.error,output}));
});
