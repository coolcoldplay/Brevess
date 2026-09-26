// LIB-010: actual background/IndexedDB RPC in an isolated browser profile.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
const root=path.resolve(import.meta.dirname,'..');
const output=path.join(root,'output/playwright/r16-feedback-lib010-tags-persistence');
fs.mkdirSync(output,{recursive:true});const run=fs.mkdtempSync(path.join(output,'run-'));
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'brevess-tags-'));
const extension=path.join(temporary,'extension');fs.mkdirSync(extension);
for(const directory of ['core','providers','vendor','icons','_locales']) fs.cpSync(path.join(root,directory),path.join(extension,directory),{recursive:true});
for(const file of fs.readdirSync(root)) if(/\.(js|mjs|html|css)$/u.test(file)||file==='manifest.json') fs.copyFileSync(path.join(root,file),path.join(extension,file));
const sha=text=>createHash('sha256').update(text).digest('hex');
const report={status:'FAIL',startedAt:new Date().toISOString(),checks:[],errors:[],realApiCalls:0,personalDataAccessed:false,
  scope:'Production workspace/tag/query RPC and IndexedDB; synthetic isolated workspaces; no folder authorization or restore receipt',
  sourceHashes:Object.fromEntries(['background.js','core/local-reading-library.js','core/local-library-tags.js','core/article-workspace-store.js'].map(file=>[file,sha(fs.readFileSync(path.join(extension,file)))]))};
let context,page;
const tagPath='annotations/library-tags.json';
const check=name=>report.checks.push({name});
async function launch(){
 context=await chromium.launchPersistentContext(path.join(temporary,'profile'),{channel:'msedge',headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
 await context.route(/^https?:\/\//u,route=>route.abort('blockedbyclient'));
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
 page=await context.newPage();page.on('pageerror',error=>report.errors.push(error.message));
 // A static extension page supplies a real extension sender without depending on
 // the concurrently developed options DOM. It does not replace the frontend UI gate.
 await page.goto(`chrome-extension://${new URL(worker.url()).host}/action-popup.html`);
}
const raw=message=>page.evaluate(message=>chrome.runtime.sendMessage(message),message);
async function rpc(message){const result=await raw(message);assert.equal(result?.success,true,JSON.stringify(result));return result.data;}
const content=(workspaceId,tags)=>({schemaVersion:1,workspaceId,tags});
const save=(workspaceId,tags,condition={})=>rpc({type:'ARTICLE_WORKSPACE_SAVE_ASSET',workspaceId,workspaceGeneration:1,relativePath:tagPath,content:content(workspaceId,tags),...condition});
const get=workspaceId=>rpc({type:'ARTICLE_WORKSPACE_GET_ASSET',workspaceId,relativePath:tagPath});
const query=(extra={})=>rpc({type:'LOCAL_READING_LIBRARY_QUERY',kind:'articles',page:1,pageSize:12,...extra});
try{
 await launch();const ids=[];
 for(let index=1;index<=15;index+=1){
  const canonicalUrl=`https://library.invalid/tags/${index}`,digest=sha(canonicalUrl),hash=sha('content-'+index),workspaceId='workspace:'+digest;ids.push(workspaceId);
  await rpc({type:'ARTICLE_WORKSPACE_ENSURE',workspace:{schemaVersion:1,workspaceId,canonicalUrl,aliases:[],title:index<=2?'同题文献':'文献 '+index,directoryName:'tags-'+index+'--'+digest.slice(0,16),revision:hash,contentHash:hash,workspaceGeneration:1}});
  await rpc({type:'ARTICLE_WORKSPACE_SAVE_ASSET',workspaceId,workspaceGeneration:1,relativePath:'annotations/literature-note.json',content:{schemaVersion:1,valuesByTemplate:{summary:index<=13?'needle in note':'other note'}}});
  await save(workspaceId,index<=14?['目标',index%2?'奇数':'偶数']:['其他'],{createOnly:true});
 }
 check('15 workspaces and workspace-owned tag assets saved through production RPC');
 const all=await query();assert.equal(all.total,15);assert.equal(all.items.length,12);assert.deepEqual(all.availableTags,['其他','奇数','偶数','目标'].sort());
 assert.ok(all.items.every(item=>item.tagState==='ready'&&item.tagRevision>0&&item.tagContentHash&&item.workspaceGeneration===1));
 check('query projects actual tag revision/hash/generation and full-library available tags');
 const combined=await query({tags:['目标'],scope:'notes',query:'needle',page:2});
 assert.equal(combined.total,13);assert.equal(combined.matchedCount,13);assert.equal(combined.items.length,1);assert.equal(combined.matchedCoverage.notes,13);assert.equal(combined.totals.coverage.notes,15);
 check('tag + keyword + scope filtering precedes paging and match coverage differs from whole library');
 assert.equal((await query({tags:['目标','偶数'],tagMode:'all'})).total,7);
 assert.equal((await query({tags:['其他','偶数'],tagMode:'any'})).total,8);
 check('explicit ALL and ANY use whole article set');
 const before=(await get(ids[0])).asset;
 const mutation={type:'ARTICLE_WORKSPACE_SAVE_ASSET',workspaceId:ids[0],workspaceGeneration:1,relativePath:tagPath,expectedRevision:before.revision,expectedContentHash:before.contentHash};
 const race=await Promise.all([raw({...mutation,content:content(ids[0],['外部更新甲'])}),raw({...mutation,content:content(ids[0],['外部更新乙'])})]);
 assert.equal(race.filter(result=>result.success).length,1);assert.equal(race.filter(result=>!result.success).length,1);
 assert.match(JSON.stringify(race.find(result=>!result.success).error),/ASSET_(REVISION|HASH)_CONFLICT/u);
 const afterRace=(await get(ids[0])).asset;assert.ok(afterRace.content.tags[0].startsWith('外部更新'));
 check('concurrent writes with the same expected version yield one success and one real CAS conflict');
 const sameTitleOther=(await get(ids[1])).asset;assert.ok(sameTitleOther.content.tags.includes('目标'));
 await save(ids[0],[],{expectedRevision:afterRace.revision,expectedContentHash:afterRace.contentHash});
 assert.deepEqual((await get(ids[0])).asset.content.tags,[]);assert.deepEqual((await get(ids[1])).asset.content.tags,sameTitleOther.content.tags);
 check('remove tags is local to workspace identity, including same-title papers');
 const now=await query({tags:['目标'],scope:'notes',query:'needle',page:2});assert.equal(now.total,12);assert.equal(now.page,1);assert.equal(now.items.length,12);
 check('deleting a last-page matching item updates cache/count and clamps to the previous page');
 const next=(await get(ids[1])).asset;
 await rpc({type:'ARTICLE_WORKSPACE_SAVE_ASSET',workspaceId:ids[1],workspaceGeneration:1,relativePath:'article/paragraphs.json',content:{schemaVersion:1,paragraphs:[{paragraphId:'p-example',text:'updated extracted paragraph'}]}});
 assert.deepEqual((await get(ids[1])).asset.content,next.content);
 const exported=await rpc({type:'ARTICLE_WORKSPACE_EXPORT',workspaceId:ids[1]});
 assert.deepEqual(exported.assets.find(asset=>asset.relativePath===tagPath).content,next.content);
 check('ordinary extracted-asset save keeps tags and production export includes the exact tag asset');
 const wrongGeneration=await raw({...mutation,workspaceGeneration:2,content:content(ids[0],['wrong'])});assert.equal(wrongGeneration.success,false);
 check('wrong workspace generation is refused without changing tags');
 const upgraded={schemaVersion:1,workspaceId:ids[14],canonicalUrl:'https://library.invalid/tags/15',
  aliases:[],title:'文献 15',directoryName:'tags-15--'+ids[14].slice(10,26),
  revision:sha('content-15'),contentHash:sha('content-15')};
 await rpc({type:'ARTICLE_WORKSPACE_ENSURE',workspace:{...upgraded,workspaceGeneration:2}});
 const obsolete=await raw({type:'ARTICLE_WORKSPACE_GET_ASSET',workspaceId:ids[14],relativePath:tagPath});
 assert.equal(obsolete.success,false);assert.match(JSON.stringify(obsolete.error),/WORKSPACE_GENERATION_CONFLICT/u);
 check('old-generation tag row cannot become a new-generation editor save baseline');
 await context.close();context=null;await launch();
 assert.deepEqual((await get(ids[0])).asset.content.tags,[]);assert.deepEqual((await get(ids[1])).asset.content,next.content);
 const reopened=await query({tags:['目标'],scope:'notes',query:'needle'});assert.equal(reopened.total,12);
 check('actual browser/service-worker restart restores tags, revisions and filtered query');
 assert.deepEqual(report.errors,[]);report.status='PASS';
}catch(error){report.failure=String(error.stack||error);process.exitCode=1;}
finally{await context?.close();report.completedAt=new Date().toISOString();fs.writeFileSync(path.join(run,'report.json'),JSON.stringify(report,null,2));fs.writeFileSync(path.join(output,'latest-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,checks:report.checks.length,report:path.join(run,'report.json'),failure:report.failure||null}));}
