// ARCH-009: native IndexedDB gate for the restore-only store API, not router/UI acceptance.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
const root=path.resolve(import.meta.dirname,'..');
const output=path.join(root,'output/playwright/r16-feedback-arch009-atomic');
fs.mkdirSync(output,{recursive:true});
const run=fs.mkdtempSync(path.join(output,'run-'));
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'brevess-atomic-'));
const extension=path.join(temporary,'extension');fs.mkdirSync(extension);
for(const directory of ['core','providers','vendor','icons','_locales']) fs.cpSync(path.join(root,directory),path.join(extension,directory),{recursive:true});
for(const file of fs.readdirSync(root)) if(/\.(js|mjs|html|css)$/u.test(file)||file==='manifest.json') fs.copyFileSync(path.join(root,file),path.join(extension,file));
const sha=value=>createHash('sha256').update(value).digest('hex');
const report={status:'FAIL',startedAt:new Date().toISOString(),checks:[],realApiCalls:0,personalDataAccessed:false,
  scope:'Production restore store API in actual extension service-worker IndexedDB; synthetic isolated data; no directory authorization, router or page restore claim',
  sourceHashes:Object.fromEntries(['core/article-workspace-store.js','core/article-workspace.js','core/user-data-database.js'].map(file=>[file,sha(fs.readFileSync(path.join(extension,file)))]))};
let context,worker;
const check=name=>report.checks.push({name});
async function launch(){
 context=await chromium.launchPersistentContext(path.join(temporary,'profile'),{channel:'msedge',headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
 await context.route(/^https?:\/\//u,route=>route.abort('blockedbyclient'));
 worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
 await worker.evaluate(async()=>{
  globalThis.atomicTest={id:'workspace:'+'a'.repeat(64),A:'annotations/paragraph-notes.json',B:'unknown/private-manual.json'};
  atomicTest.identity={schemaVersion:1,workspaceId:atomicTest.id,canonicalUrl:'https://example.org/atomic',title:'Atomic restore',aliases:[],directoryName:'Atomic--'+'a'.repeat(12),contentHash:'1'.repeat(64),revision:'1'.repeat(64),workspaceGeneration:1};
  atomicTest.request=baseline=>({identity:atomicTest.identity,expectedLocal:baseline,assets:[{relativePath:atomicTest.A,content:{notes:[]}}],turns:[{turnId:'t-1',answer:'恢复回答'},{turnId:'t-new',question:'新恢复问题'}]});
 });
}
try{
 await launch();
 const initial=await worker.evaluate(async()=>{
  const {id,A,B,identity}=atomicTest;
  await articleWorkspaceStore.ensureWorkspace(identity);
  await articleWorkspaceStore.putAsset(id,A,{notes:[{note:'人工原值'}]});
  await articleWorkspaceStore.putAsset(id,B,{text:'',unknown:['keep']});
  await articleWorkspaceStore.appendTurn(id,{turnId:'t-1',question:'原问题',answer:'原回答'});
  await articleWorkspaceStore.appendTurn(id,{turnId:'t-keep',question:'保留问题',answer:''});
  return articleWorkspaceStore.captureRestoreBaseline(id);
 });
 assert.equal(initial.assets.length,2);assert.equal(initial.turns.length,2);assert.equal(initial.tombstones.length,0);
 assert.ok(initial.assets.every(row=>!Object.hasOwn(row,'content')));
 check('same-transaction baseline captures complete isolated workspace row sets');
 const assetRace=await worker.evaluate(async()=>{
  const {id,A}=atomicTest;const baseline=await articleWorkspaceStore.captureRestoreBaseline(id);
  await articleWorkspaceStore.putAsset(id,A,{notes:[{note:'扫描后人工新值'}]});
  const before=await articleWorkspaceStore.captureRestoreBaseline(id);
  let error;try{await articleWorkspaceStore.commitRestoreIfUnchanged(atomicTest.request(baseline));}catch(e){error=e.message;}
  return {error,before,after:await articleWorkspaceStore.captureRestoreBaseline(id),asset:await articleWorkspaceStore.getAsset(id,A)};
 });
 assert.match(assetRace.error,/WORKSPACE_RESTORE_CONFLICT/u);assert.deepEqual(assetRace.after,assetRace.before);
 assert.equal(assetRace.asset.content.notes[0].note,'扫描后人工新值');
 check('asset edited after capture prevents every batch write and retains manual value');
 const turnRace=await worker.evaluate(async()=>{
  const {id}=atomicTest;const baseline=await articleWorkspaceStore.captureRestoreBaseline(id);
  await articleWorkspaceStore.updateTurn(id,'t-1',{answer:'改回答'});
  const before=await articleWorkspaceStore.captureRestoreBaseline(id);
  let error;try{await articleWorkspaceStore.commitRestoreIfUnchanged(atomicTest.request(baseline));}catch(e){error=e.message;}
  return {error,before,after:await articleWorkspaceStore.captureRestoreBaseline(id)};
 });
 assert.match(turnRace.error,/WORKSPACE_RESTORE_CONFLICT/u);assert.deepEqual(turnRace.after,turnRace.before);
 check('same-length turn edit is detected independently of workspace storage revision');
 const malformed=await worker.evaluate(async()=>{
  const baseline=await articleWorkspaceStore.captureRestoreBaseline(atomicTest.id);const input=atomicTest.request(baseline);
  input.assets.push({relativePath:'../invalid.json',content:{bad:true}});
  let error;try{await articleWorkspaceStore.commitRestoreIfUnchanged(input);}catch(e){error=e.message;}
  return {error,before:baseline,after:await articleWorkspaceStore.captureRestoreBaseline(atomicTest.id)};
 });
 assert.match(malformed.error,/INVALID_WORKSPACE_PATH/u);assert.deepEqual(malformed.after,malformed.before);
 check('invalid second candidate aborts without partial first-asset or turn write');
 const legal=await worker.evaluate(async()=>{
  const {id,B}=atomicTest;const unknown=await articleWorkspaceStore.getAsset(id,B);
  const keep=(await articleWorkspaceStore.pageTurns(id)).items.find(row=>row.turnId==='t-keep');
  const baseline=await articleWorkspaceStore.captureRestoreBaseline(id);
  const result=await articleWorkspaceStore.commitRestoreIfUnchanged(atomicTest.request(baseline));
  return {result,unknown,unknownAfter:await articleWorkspaceStore.getAsset(id,B),keep,keepAfter:(await articleWorkspaceStore.pageTurns(id)).items.find(row=>row.turnId==='t-keep')};
 });
 assert.equal(legal.result.committed,true);assert.equal(legal.result.assets[0].revision,3);
 assert.equal(legal.result.turns[0].sequence,1);assert.equal(legal.result.turns[0].revision,3);
 assert.equal(legal.result.turns[1].sequence,3);assert.equal(legal.result.turns[1].revision,1);
 assert.deepEqual(legal.unknownAfter,legal.unknown);assert.deepEqual(legal.keepAfter,legal.keep);
 check('legal native transaction commits asset and turn revisions while retaining unrelated local rows');
 const concurrent=await worker.evaluate(async()=>{
  const baseline=await articleWorkspaceStore.captureRestoreBaseline(atomicTest.id);
  const input=atomicTest.request(baseline);
  const results=await Promise.allSettled([articleWorkspaceStore.commitRestoreIfUnchanged(input),articleWorkspaceStore.commitRestoreIfUnchanged(input)]);
  return results.map(result=>result.status==='fulfilled'?{status:result.status,committed:result.value.committed}:{status:result.status,error:result.reason.message});
 });
 assert.equal(concurrent.filter(result=>result.status==='fulfilled').length,1);
 assert.match(concurrent.find(result=>result.status==='rejected').error,/WORKSPACE_RESTORE_CONFLICT/u);
 check('native transaction scheduling allows only one concurrent commit of the same baseline');
 const deleted=await worker.evaluate(async()=>{
  const {id}=atomicTest;const baseline=await articleWorkspaceStore.captureRestoreBaseline(id);
  await articleWorkspaceStore.deleteTurn(id,'t-1');const afterDelete=await articleWorkspaceStore.captureRestoreBaseline(id);
  let staleError,currentError;
  try{await articleWorkspaceStore.commitRestoreIfUnchanged(atomicTest.request(baseline));}catch(e){staleError=e.message;}
  try{await articleWorkspaceStore.commitRestoreIfUnchanged(atomicTest.request(afterDelete));}catch(e){currentError=e.message;}
  return {staleError,currentError,afterDelete,after:await articleWorkspaceStore.captureRestoreBaseline(id),turns:await articleWorkspaceStore.pageTurns(id)};
 });
 assert.match(deleted.staleError,/WORKSPACE_RESTORE_CONFLICT/u);assert.match(deleted.currentError,/WORKSPACE_RESTORE_TOMBSTONE_CONFLICT/u);
 assert.deepEqual(deleted.after,deleted.afterDelete);assert.ok(!deleted.turns.items.some(row=>row.turnId==='t-1'));
 check('turn deletion invalidates stale baseline and matching current baseline cannot resurrect its tombstone');
 await context.close();context=null;await launch();
 const durable=await worker.evaluate(async()=>({asset:await articleWorkspaceStore.getAsset(atomicTest.id,atomicTest.A),turns:await articleWorkspaceStore.pageTurns(atomicTest.id),baseline:await articleWorkspaceStore.captureRestoreBaseline(atomicTest.id)}));
 assert.deepEqual(durable.asset.content,{notes:[]});assert.ok(durable.turns.items.some(row=>row.turnId==='t-new'));
 assert.ok(!durable.turns.items.some(row=>row.turnId==='t-1'));assert.ok(durable.baseline.tombstones.length>0);
 check('browser restart retains committed batch, unrelated rows and deletion protection');
 report.status='PASS';
}catch(error){report.failure=String(error.stack||error);process.exitCode=1;}
finally{await context?.close();report.completedAt=new Date().toISOString();fs.writeFileSync(path.join(run,'report.json'),JSON.stringify(report,null,2));fs.writeFileSync(path.join(output,'latest-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,checks:report.checks.length,report:path.join(run,'report.json'),failure:report.failure||null}));}
