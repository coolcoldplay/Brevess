const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
// Reuse the real router/store fixture, without registering its existing tests.
const source=fs.readFileSync(path.join(__dirname,'archive-newer-copy-feedback.test.js'),'utf8');
const setup=source.slice(source.indexOf("require('../core/user-data-database.js');"),source.indexOf("test('control:"));
const fixtureFactory=Function('require','__dirname','assert','readFileSync','join',setup+'\nreturn createCapturedCopyFixture;')(require,__dirname,assert,fs.readFileSync,path.join);
const nonce='arch009-prepared-operation-1';
async function fixture(){
 const f=await fixtureFactory();
 const scan=await f.router.handle({type:'ARTICLE_WORKSPACE_SCAN_RESTORE',identity:f.identity,operationNonce:nonce});
 assert.equal(scan.success,true,JSON.stringify(scan));
 const restore=scan.data.restore;
 const binding={kind:'workspace',current:f.identity,documentId:f.identity.documentId,manifest:restore.manifest,match:restore.match,operationNonce:nonce};
 const context={trustedContentScript:true,senderTabId:9,senderUrl:f.identity.canonicalUrl,
  senderFrameId:0,senderDocumentId:'browser-document-fixture',assertTrustedOwnerCurrent:async()=>{}};
 const message={type:'ARTICLE_WORKSPACE_COMMIT_PREPARED_RESTORE',planId:restore.restorePlanId,binding};
 return {...f,scan,restore,binding,context,message,commit(){return f.router.handle(message,context);}};
}
test('scan returns opaque bounded plan, no local baseline or write',async()=>{
 const f=await fixture();assert.match(f.restore.restorePlanId,/^restore-plan-/u);
 assert.equal(f.restore.expectedLocal,undefined);assert.equal(f.scan.data.expectedLocal,undefined);
 assert.equal((await f.store.getAsset(f.identity.workspaceId,'annotations/paragraph-notes.json')).revision,f.savedOld.revision);
 assert.equal(f.queued.length,0);
});
test('trusted prepared stage durably commits the stored candidate before any page receipt',async()=>{
 const f=await fixture();const result=await f.commit();assert.equal(result.success,true,JSON.stringify(result));
 assert.equal(result.data.persistenceCommitted,true);assert.equal(result.data.committed,true);
 assert.equal(result.data.restore.assets[0].revision,f.savedOld.revision+1);
 assert.equal(result.data.restoreReceipt,undefined); // Prepared is not page-applied proof.
});
test('untrusted sender cannot turn a scan plan into commit authority',async()=>{
 const f=await fixture();const before=await f.store.captureRestoreBaseline(f.identity.workspaceId);
 const result=await f.router.handle(f.message,{...f.context,trustedContentScript:false});
 assert.equal(result.success,false);assert.deepEqual(await f.store.captureRestoreBaseline(f.identity.workspaceId),before);
});
test('prepared binding must match scan nonce, identity and sender URL',async()=>{
 for(const change of ['nonce','hash','sender']){
  const f=await fixture();const message=structuredClone(f.message),context={...f.context};
  if(change==='nonce')message.binding.operationNonce='another-operation-123';
  if(change==='hash')message.binding.current.contentHash='2'.repeat(64);
  if(change==='sender')context.senderUrl='https://example.org/other';
  const result=await f.router.handle(message,context);assert.equal(result.success,false,change);
  assert.equal((await f.store.getAsset(f.identity.workspaceId,'annotations/paragraph-notes.json')).revision,f.savedOld.revision);
 }
});
test('caller-mutated candidate is never used by prepared commit',async()=>{
 const f=await fixture();f.message.restore=structuredClone(f.restore);f.message.restore.assets[0].content={notes:[{note:'injected'}]};
 const result=await f.commit();assert.equal(result.success,true,JSON.stringify(result));
 assert.deepEqual((await f.store.getAsset(f.identity.workspaceId,'annotations/paragraph-notes.json')).content,f.savedOld.content);
});
test('after-scan manual edit fails before page apply and leaves the entire store untouched',async()=>{
 const f=await fixture();await f.saveManualEdit();const before=await f.store.captureRestoreBaseline(f.identity.workspaceId);
 const result=await f.commit();assert.equal(result.success,false);assert.equal(result.error.code,'WORKSPACE_RESTORE_CONFLICT');
 assert.deepEqual(await f.store.captureRestoreBaseline(f.identity.workspaceId),before);assert.equal(f.queued.length,0);
});
test('repeating the same prepared operation returns one durable result without rewriting',async()=>{
 const f=await fixture();const first=await f.commit();assert.equal(first.success,true,JSON.stringify(first));
 const before=await f.store.captureRestoreBaseline(f.identity.workspaceId);const queued=f.queued.length;
 const second=await f.commit();assert.deepEqual(second,first);
 assert.deepEqual(await f.store.captureRestoreBaseline(f.identity.workspaceId),before);assert.equal(f.queued.length,queued);
});
test('legacy post-apply commit requires a stored scan plan and rejects a tampered candidate',async()=>{
 const f=await fixture();const receipt=await f.router.handle({type:'ARTICLE_RESTORE_REGISTER_COMMIT',binding:f.binding},f.context);
 assert.equal(receipt.success,true);const restore=structuredClone(f.restore);restore.assets[0].content={notes:[]};
 const result=await f.router.handle({type:'ARTICLE_WORKSPACE_COMMIT_RESTORE',identity:f.identity,restore,receipt:receipt.data.receipt,operationNonce:nonce});
 assert.equal(result.success,false);assert.equal((await f.store.getAsset(f.identity.workspaceId,'annotations/paragraph-notes.json')).revision,f.savedOld.revision);
});
