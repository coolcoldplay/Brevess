const test = require('node:test');
const assert = require('node:assert/strict');
const { createWorkspaceDirectoryNativeClient } = require('../core/workspace-directory-native-client.js');
const { createWorkspaceDirectoryController, publicWorkspaceDirectoryError } = require('../core/workspace-directory-controller.js');

function runtimeFor(respond) {
  const sent = [], ports = [];
  return { sent, ports, connectNative(name) {
    assert.equal(name, 'com.sci_reader.codex_bridge');
    const messages = [], disconnects = [];
    const port = { closed:false,
      onMessage:{addListener:fn=>messages.push(fn)},
      onDisconnect:{addListener:fn=>disconnects.push(fn)},
      postMessage(message) { sent.push(message); queueMicrotask(()=>respond?.(message,
        value=>messages.forEach(fn=>fn(value)))); },
      disconnect() { this.closed=true; disconnects.forEach(fn=>fn()); }
    };
    ports.push(port); return port;
  }};
}
test('directory client is lazy and sends only the explicit directory protocol fields', async()=>{
  const runtime=runtimeFor((m,send)=>send({type:`${m.type}.result`,requestId:m.requestId,
    supported:true,bound:false,opened:true,rootId:m.rootId,workspaceId:m.workspaceId}));
  const client=createWorkspaceDirectoryNativeClient(runtime);
  assert.equal(runtime.ports.length,0);
  await client.status('root');
  await client.open({rootId:'root',workspaceId:'workspace:a',workspaceGeneration:1,
    canonicalUrl:'https://example.org/a',directoryName:'Article--aaaa',absolutePath:'C:\\Windows',type:'turn.start'});
  assert.deepEqual(runtime.sent.map(x=>x.type),['workspace.directory.status','workspace.directory.open']);
  assert.equal(Object.hasOwn(runtime.sent[1],'absolutePath'),false);
  assert.ok(runtime.ports.every(p=>p.closed));
});
test('directory client rejects old host, malformed results and late timeout confirmation', async()=>{
  const old=createWorkspaceDirectoryNativeClient(runtimeFor((m,send)=>send({type:'host.error',requestId:m.requestId,error:{code:'INVALID_SETTINGS'}})));
  await assert.rejects(old.status(''),{code:'WORKSPACE_DIRECTORY_HOST_UPDATE_REQUIRED'});
  const malformed=createWorkspaceDirectoryNativeClient(runtimeFor((m,send)=>send({type:'turn.completed',requestId:m.requestId})));
  await assert.rejects(malformed.status(''),{code:'WORKSPACE_DIRECTORY_PROTOCOL_INVALID'});
  const waiting=runtimeFor(()=>{}), timeout=createWorkspaceDirectoryNativeClient(waiting,{timeoutMs:5});
  await assert.rejects(timeout.open({rootId:'root'}),{code:'WORKSPACE_DIRECTORY_TIMEOUT'});
  assert.equal(waiting.sent.length,1); assert.equal(waiting.ports[0].closed,true);
});
test('directory client retains typed host errors and rejects unavailable native transport', async()=>{
  const client=createWorkspaceDirectoryNativeClient(runtimeFor((m,send)=>send({type:'workspace.directory.error',requestId:m.requestId,error:{code:'WORKSPACE_DIRECTORY_PATH_ESCAPE',message:'private path'}})));
  await assert.rejects(client.open({}),{code:'WORKSPACE_DIRECTORY_PATH_ESCAPE'});
  await assert.rejects(createWorkspaceDirectoryNativeClient({}).status(''),{code:'WORKSPACE_DIRECTORY_HOST_UNAVAILABLE'});
});

const rootId='27e47b7e-9044-45e7-b9cc-cdf1a17f1fb0';
const workspace={workspaceId:'workspace:'+'a'.repeat(64),workspaceGeneration:1,
  canonicalUrl:'https://example.org/a',directoryName:'Article--'+'a'.repeat(16)};
const sender={id:'test-extension',url:'chrome-extension://test-extension/options.html#page=storage',frameId:0};
function setup() {
  const calls=[]; const binding={rootId,rootName:'Brevess'};
  const directorySync={
    async readNativeDirectoryBinding(){calls.push('read');return {...binding};},
    async prepareNativeDirectoryBinding(){calls.push('prepare');return {...binding,challenge:'a'.repeat(64),expiresAt:Date.now()+300000};},
    async getWorkspaceDirectoryOpenTarget(w){calls.push('target');return {...binding,...w};}
  };
  const nativeClient={async status(id){calls.push('status');return {supported:true,bound:!!id,rootId:id};},
    async bind(input){calls.push(['bind',input]);return {supported:true,bound:true,rootId:input.rootId};},
    async open(input){calls.push(['open',input]);return {opened:true,rootId:input.rootId,workspaceId:input.workspaceId};}};
  const store={async getWorkspace(){return {...workspace};}};
  return {calls,binding,directorySync,nativeClient,store,controller:createWorkspaceDirectoryController({
    directorySync,nativeClient,articleWorkspaceStore:store,runtimeExtensionId:'test-extension'})};
}
test('only real options origin can request directory operations, before any storage or native access',async()=>{
  const h=setup();
  for(const bad of [{...sender,url:'https://example.org/options.html'},
    {...sender,id:'other'}, {...sender,url:'chrome-extension://test-extension/popup.html'},
    {...sender,frameId:1}, {}]) {
    await assert.rejects(h.controller.handle({type:'USER_DATA_DIRECTORY_NATIVE_BIND',absolutePath:'C:\\Brevess'},bad),{code:'WORKSPACE_DIRECTORY_FORBIDDEN'});
  }
  assert.deepEqual(h.calls,[]);
});
test('explicit binding checks host before writing proof and never returns the absolute path',async()=>{
  const h=setup(); const value=await h.controller.handle({type:'USER_DATA_DIRECTORY_NATIVE_BIND',absolutePath:'C:\\data\\Brevess'},sender);
  assert.deepEqual(value,{bound:true,rootName:'Brevess'});
  assert.deepEqual(h.calls.slice(0,2),['status','prepare']);
  assert.equal(h.calls.find(Array.isArray)[1].absolutePath,'C:\\data\\Brevess');
  const old=setup();old.nativeClient.status=async()=>{throw Object.assign(new Error(),{code:'WORKSPACE_DIRECTORY_HOST_UPDATE_REQUIRED'});};
  await assert.rejects(old.controller.handle({type:'USER_DATA_DIRECTORY_NATIVE_BIND',absolutePath:'C:\\Brevess'},sender));
  assert.deepEqual(old.calls,[]);
});
test('status missing binding is an accurate read-only state, without generating proof',async()=>{
  const h=setup();h.directorySync.readNativeDirectoryBinding=async()=>{throw Object.assign(new Error(),{code:'WORKSPACE_DIRECTORY_BINDING_MISSING'});};
  const result=await h.controller.handle({type:'USER_DATA_DIRECTORY_NATIVE_STATUS'},sender);
  assert.equal(result.available,true);assert.equal(result.bound,false);
  assert.equal(result.code,'WORKSPACE_DIRECTORY_BINDING_MISSING');
  assert.deepEqual(h.calls,['status']);
});
test('open derives target from stored workspace and directory; caller paths are ignored',async()=>{
  const h=setup();const value=await h.controller.handle({type:'LOCAL_READING_LIBRARY_OPEN_DIRECTORY',workspaceId:workspace.workspaceId,
    directoryName:'evil',absolutePath:'C:\\Windows'},sender);
  assert.equal(value.opened,true); const sent=h.calls.find(x=>Array.isArray(x)&&x[0]==='open')[1];
  assert.deepEqual(sent,{rootId,...workspace});
  assert.equal(h.calls.filter(x=>x==='target').length,2);
});
test('root switch and workspace generation change prevent native open',async()=>{
  const h=setup();let reads=0;h.directorySync.getWorkspaceDirectoryOpenTarget=async w=>({...w,rootName:'Brevess',rootId:++reads===1?rootId:'other'});
  await assert.rejects(h.controller.handle({type:'LOCAL_READING_LIBRARY_OPEN_DIRECTORY',workspaceId:workspace.workspaceId},sender),{code:'WORKSPACE_DIRECTORY_ROOT_CHANGED'});
  assert.equal(h.calls.some(Array.isArray),false);
  const changed=setup();let gets=0;changed.store.getWorkspace=async()=>({...workspace,workspaceGeneration:++gets});
  await assert.rejects(changed.controller.handle({type:'LOCAL_READING_LIBRARY_OPEN_DIRECTORY',workspaceId:workspace.workspaceId},sender),{code:'WORKSPACE_DIRECTORY_IDENTITY_MISMATCH'});
  assert.equal(changed.calls.some(Array.isArray),false);
});

test('existing normalized short workspace hashes remain valid for opening',async()=>{
  const {createWorkspaceManifest}=require('../core/article-workspace.js');
  const h=setup();
  const legacy=createWorkspaceManifest({...workspace,workspaceId:'workspace:abcdef123456',
    directoryName:'Legacy study--abcdef123456',contentHash:'b'.repeat(64),revision:1});
  h.store.getWorkspace=async()=>({...legacy});
  const result=await h.controller.handle({type:'LOCAL_READING_LIBRARY_OPEN_DIRECTORY',workspaceId:legacy.workspaceId},sender);
  assert.equal(result.opened,true);assert.equal(result.workspaceId,legacy.workspaceId);
});
test('unconfirmed native results cannot be called opened; mutation overlap is rejected',async()=>{
  const h=setup();let finish;h.nativeClient.open=()=>new Promise(r=>{finish=r;});
  const first=h.controller.handle({type:'LOCAL_READING_LIBRARY_OPEN_DIRECTORY',workspaceId:workspace.workspaceId},sender);
  while(!finish) await new Promise(r=>setImmediate(r));
  await assert.rejects(h.controller.handle({type:'USER_DATA_DIRECTORY_NATIVE_BIND',absolutePath:'C:\\Brevess'},sender),{code:'WORKSPACE_DIRECTORY_BUSY'});
  finish({opened:false});await assert.rejects(first,{code:'WORKSPACE_DIRECTORY_PROTOCOL_INVALID'});
});

test('deletion or generation change during final directory read is rejected before native open',async()=>{
  for (const update of [{deletionPending:true},{workspaceGeneration:2},{contentHash:'changed'},
    {revision:2},{storageRevision:2}]) {
    const h=setup();let current={...workspace}, targets=0;
    h.store.getWorkspace=async()=>({...current});
    h.directorySync.getWorkspaceDirectoryOpenTarget=async w=>{
      if(++targets===2) current={...current,...update};
      return {rootId,rootName:'Brevess',...w};
    };
    await assert.rejects(h.controller.handle({type:'LOCAL_READING_LIBRARY_OPEN_DIRECTORY',
      workspaceId:workspace.workspaceId},sender),{code:'WORKSPACE_DIRECTORY_IDENTITY_MISMATCH'});
    assert.equal(h.calls.some(Array.isArray),false);
  }
});
test('public failures give bounded Chinese causes without raw filesystem detail or blind-retry claims',()=>{
  const timeout=publicWorkspaceDirectoryError({code:'WORKSPACE_DIRECTORY_TIMEOUT',message:'C:\\private\\token'});
  assert.match(timeout.message,/未返回确认/); assert.equal(timeout.retryable,false);
  assert.doesNotMatch(JSON.stringify(timeout),/private|token/);
  assert.match(publicWorkspaceDirectoryError({code:'WORKSPACE_DIRECTORY_HOST_UPDATE_REQUIRED'}).message,/更新/);
  assert.match(publicWorkspaceDirectoryError({code:'WORKSPACE_DIRECTORY_NOT_SYNCED'}).message,/同步/);
});
