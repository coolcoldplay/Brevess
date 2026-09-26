const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../background.js'),'utf8');
const start=source.indexOf("  if (message?.type === 'LOCAL_READING_LIBRARY_QUERY') {");
const end=source.indexOf("  if (message?.type === 'EXPORT_FETCH_IMAGE_RESOURCE')",start);
test('real background query branch forwards tag mode with keyword/scope/paging unchanged',async()=>{
 let args;let reply;const done=new Promise(resolve=>{reply=resolve;});
 const library={marker:'actual loaded library'};
 const env={chrome:{},loadLocalReadingLibrary:async()=>library,SciLLM:{keepAliveUntil:p=>p,queryLocalReadingLibrary:(data,options)=>{assert.equal(data,library);args=options;return {total:1};}}};
 vm.runInNewContext(`globalThis.handler=function(message,sendResponse){${source.slice(start,end)}}`,env);
 assert.equal(env.handler({type:'LOCAL_READING_LIBRARY_QUERY',kind:'articles',query:'repair',scope:'notes',page:3,pageSize:12,tags:['免疫','Repair'],tagMode:'all'},reply),true);
 assert.equal((await done).success,true);assert.deepEqual(Array.from(args.tags||[]),['免疫','Repair']);assert.equal(args.tagMode,'all');assert.equal(args.query,'repair');assert.equal(args.scope,'notes');assert.equal(args.page,3);
});
