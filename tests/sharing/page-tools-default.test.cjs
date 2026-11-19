const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const source=process.env.SHARING_QA_SOURCE?path.resolve(process.env.SHARING_QA_SOURCE):path.resolve(__dirname,'../../extension');
const {normalizePageToolsSettings,createPageToolsService,PAGE_TOOLS_STORAGE_KEY}=require(path.join(source,'core/page-tools.js'));
test('fresh, absent and invalid selection preferences default to enabled',()=>{for(const value of [undefined,null,{}, {semantic:false},{selection:null},{selection:'false'}])assert.equal(normalizePageToolsSettings(value).selection,true);});
test('explicit false and unrelated saved preferences survive normalization roundtrip',()=>{const settings={semantic:false,selection:false,pageTranslation:false};assert.deepEqual(normalizePageToolsSettings(JSON.parse(JSON.stringify(settings))),settings);});
test('bootstrap keeps independent figure controls available while selection-off remains persisted',async()=>{
 let stored={},installs=0;const frame={documentId:'doc',documentLifecycle:'active',url:'https://publisher.example/article'},tab={id:1,url:frame.url};
 const chromeApi={runtime:{id:'test',getURL:p=>'chrome-extension://test/'+p},storage:{local:{get:async key=>({[key]:stored[key]}),set:async value=>Object.assign(stored,value)}},webNavigation:{getFrame:async()=>frame},tabs:{get:async()=>tab,sendMessage:async()=>({success:true})},scripting:{executeScript:async()=>{},insertCSS:async()=>{}}};
 const service=createPageToolsService({chromeApi,getSnapshot:()=>({createdAt:Date.now(),tab,documentId:'doc'}),ensureContent:async()=>{installs++;},getShortcutKey:async()=>'J'});
 const publisher={id:'test',frameId:0,tab,documentId:'doc',url:frame.url};assert.equal((await service.handle({type:'PAGE_TOOLS_BOOTSTRAP'},publisher)).success,true);assert.equal(installs,1);
 assert.equal((await service.handle({type:'PAGE_TOOLS_SET',nonce:'qa',tabId:1,tool:'selection',enabled:false},{id:'test',url:chromeApi.runtime.getURL('action-popup.html')})).success,true);
 assert.equal(stored[PAGE_TOOLS_STORAGE_KEY].selection,false);assert.equal((await service.handle({type:'PAGE_TOOLS_BOOTSTRAP'},publisher)).success,true);assert.equal(installs,2);assert.equal((await service.read()).selection,false);
});
test('page tools bootstrap follows same-document SPA navigation but rejects a replaced document', async () => {
 const frame={documentId:'same-document',documentLifecycle:'active',url:'https://chatgpt.com/c/demo-conversation'},tab={id:2,url:frame.url};
 let installs=0;
 const chromeApi={runtime:{id:'test',getURL:p=>'chrome-extension://test/'+p},storage:{local:{get:async()=>({})}},webNavigation:{getFrame:async()=>({...frame})},tabs:{sendMessage:async()=>({success:true})},scripting:{executeScript:async()=>{}}};
 const service=createPageToolsService({chromeApi,ensureContent:async(id,opts)=>{assert.equal(opts.expectedUrl,frame.url);installs++;},getShortcutKey:async()=>'J'});
 const sender={id:'test',frameId:0,tab,documentId:'same-document',url:'https://chatgpt.com/'};
 assert.equal((await service.handle({type:'PAGE_TOOLS_BOOTSTRAP'},sender)).success,true);
 frame.documentId='another-document';
 assert.equal((await service.handle({type:'PAGE_TOOLS_BOOTSTRAP'},sender)).error.code,'PAGE_TOOLS_PAGE_CHANGED');
 assert.equal(installs,1);
});
test('toolbar reinjection initializes shortcut dependencies in a fresh extension context', async () => {
 const vm=require('node:vm'),fs=require('node:fs');
 const frame={documentId:'doc',documentLifecycle:'active',url:'https://example.org/reading'},tab={id:3,url:frame.url};
 const listeners=[];
 const content=vm.createContext({location:new URL(frame.url),document:{addEventListener:(type,fn)=>listeners.push(type)},chrome:{runtime:{onMessage:{addListener(){}},sendMessage:async m=>m.type==='BREVESS_PUBLIC_PAGE_STORAGE'?{success:true,data:{sciPageToolsV1:{}}}:{success:true,key:'J'}}}});
 const chromeApi={runtime:{id:'test',getURL:p=>'chrome-extension://test/'+p},storage:{local:{get:async()=>({})}},webNavigation:{getFrame:async()=>frame},tabs:{get:async()=>tab,sendMessage:async()=>({success:true})},scripting:{executeScript:async opts=>{for(const file of opts.files||[])vm.runInContext(fs.readFileSync(path.join(source,file),'utf8'),content,{filename:file});},insertCSS:async()=>{}}};
 const service=createPageToolsService({chromeApi,getSnapshot:()=>({createdAt:Date.now(),tab,documentId:'doc'}),ensureContent:async()=>{},getShortcutKey:async()=>'J'});
 const result=await service.handle({type:'PAGE_TOOLS_APPLY',nonce:'demo',tabId:3},{id:'test',url:chromeApi.runtime.getURL('action-popup.html')});
 assert.equal(result.success,true,JSON.stringify(result.error));
 assert.equal(typeof content.SciLLM.onPublicPreferencesChanged,'function');
 assert.equal(listeners.filter(t=>t==='keydown').length,1);
});
