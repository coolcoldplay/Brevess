const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const source=process.env.SHARING_QA_SOURCE?path.resolve(process.env.SHARING_QA_SOURCE):path.resolve(__dirname,'../..');
const {normalizePageToolsSettings,createPageToolsService,PAGE_TOOLS_STORAGE_KEY}=require(path.join(source,'core/page-tools.js'));
test('fresh, absent and invalid selection preferences default to enabled',()=>{for(const value of [undefined,null,{}, {semantic:false},{selection:null},{selection:'false'}])assert.equal(normalizePageToolsSettings(value).selection,true);});
test('explicit false and unrelated saved preferences survive normalization roundtrip',()=>{const settings={semantic:false,selection:false,pageTranslation:false};assert.deepEqual(normalizePageToolsSettings(JSON.parse(JSON.stringify(settings))),settings);});
test('fresh document bootstrap installs selection tools; explicit off persists and prevents later bootstrap installation',async()=>{
 let stored={},installs=0;const frame={documentId:'doc',documentLifecycle:'active',url:'https://publisher.example/article'},tab={id:1,url:frame.url};
 const chromeApi={runtime:{id:'test',getURL:p=>'chrome-extension://test/'+p},storage:{local:{get:async key=>({[key]:stored[key]}),set:async value=>Object.assign(stored,value)}},webNavigation:{getFrame:async()=>frame},tabs:{get:async()=>tab,sendMessage:async()=>({success:true})},scripting:{executeScript:async()=>{},insertCSS:async()=>{}}};
 const service=createPageToolsService({chromeApi,getSnapshot:()=>({createdAt:Date.now(),tab,documentId:'doc'}),ensureContent:async()=>{installs++;},getShortcutKey:async()=>'J'});
 const publisher={id:'test',frameId:0,tab,documentId:'doc',url:frame.url};assert.equal((await service.handle({type:'PAGE_TOOLS_BOOTSTRAP'},publisher)).success,true);assert.equal(installs,1);
 assert.equal((await service.handle({type:'PAGE_TOOLS_SET',nonce:'qa',tabId:1,tool:'selection',enabled:false},{id:'test',url:chromeApi.runtime.getURL('action-popup.html')})).success,true);
 assert.equal(stored[PAGE_TOOLS_STORAGE_KEY].selection,false);assert.equal((await service.handle({type:'PAGE_TOOLS_BOOTSTRAP'},publisher)).success,true);assert.equal(installs,1);assert.equal((await service.read()).selection,false);
});
