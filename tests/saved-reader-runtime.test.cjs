'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const api=require('../extension/core/saved-reader-runtime.js');
const urlApi=require('../extension/core/offline-article-workspace.js');
Object.assign(globalThis.SciLLM ||= {},urlApi);
const id='a'.repeat(32),workspaceId='workspace:'+'b'.repeat(64),documentHash='c'.repeat(64);
const base='chrome-extension://'+id+'/',url=base+'offline-reader.html?workspaceId='+encodeURIComponent(workspaceId)+'&generation=2';
function fixture(){
 const binding={workspaceId,workspaceGeneration:2,documentHash},workspace={...binding,title:'Saved paper',canonicalUrl:'https://paper.test/restricted'};
 const state={url,binding,workspace,structure:{...binding,content:{documentId:'doc-original',documentHash}}};
 const calls=[];const sender={id,url,frameId:0,documentId:'browser-document',tab:{id:7}};
 const guard=api.createSavedReaderOwnerGuard({sender,chromeApi:{runtime:{id,getURL:p=>base+p},tabs:{get:async()=>({url:state.url}),sendMessage:async(tab,message,options)=>{
  calls.push({tab,message,options});return{success:true,navigationIdentity:state.url,binding:state.binding};
 }}},store:{getWorkspace:async()=>state.workspace,getAsset:async()=>state.structure}});
 return{state,guard,calls,sender};
}
test('saved source uses the original document/workspace with an exact browser document receipt',async()=>{
 const f=fixture(),identity=await f.guard();assert.equal(identity.documentId,'doc-original');assert.equal(identity.canonicalUrl,'https://paper.test/restricted');
 assert.equal(f.calls.length,2);assert.ok(f.calls.every(c=>c.options.documentId==='browser-document'&&c.options.frameId===0));
});
for(const change of ['navigation','generation','hash','deletion','document'])test('saved source rejects changed '+change,async()=>{
 const f=fixture();await f.guard();
 if(change==='navigation')f.state.url='https://elsewhere.test/';
 if(change==='generation')f.state.workspace={...f.state.workspace,workspaceGeneration:3};
 if(change==='hash')f.state.structure.content.documentHash='d'.repeat(64);
 if(change==='deletion')f.state.workspace.deletionPending=true;
 if(change==='document')f.state.binding={...f.state.binding,documentHash:'d'.repeat(64)};
 await assert.rejects(f.guard(),{code:'SAVED_READER_CONTEXT_CHANGED'});
});
test('saved readers cannot write results into another paper or generation',async()=>{
 const identity=await fixture().guard();
 assert.equal(api.assertSavedReaderMessage({workspaceId,documentId:'doc-original',workspaceGeneration:2},identity),true);
 for(const message of [{workspaceId:'other'},{documentId:'other'},{workspaceTarget:{workspaceGeneration:3}},{document:{documentId:'other'}}])
  assert.throws(()=>api.assertSavedReaderMessage(message,identity),{code:'SAVED_READER_CONTEXT_CHANGED'});
});
