// QA017/018: production popup/content/router/provider chain. Isolated profile only.
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import http from 'node:http';import crypto from 'node:crypto';import assert from 'node:assert/strict';import {chromium} from 'playwright';
import {loadLivePortableProfile,liveProfileMetadata} from './lib/live-portable-profile.mjs';
import {createCurlFetch} from './lib/live-curl-fetch.mjs';
const root=path.resolve(import.meta.dirname,'..'),live=process.argv[2]==='--live';
const source=path.resolve(process.env.SCI_EXTENSION_ROOT||root);
const out=fs.mkdtempSync(path.join(root,'output/qa017-messages-browser-'));
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'brevess-qa017-')),extension=path.join(temp,'extension');
const endpoint='https://api.deepseek.com/anthropic/v1/messages',token=crypto.randomBytes(24).toString('hex');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const report={startedAt:new Date().toISOString(),status:'RUNNING',live,realApiCalls:0,requests:[],checks:[],sourceHashes:{},boundary:'Isolated extension with synthetic public article; only network transport uses loopback broker. No user browser state or config write.'};
let profile,server,context,configBefore;
const save=()=>fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
const check=(name,value)=>{assert.ok(value,name);report.checks.push(name);save();};
const fixture={id:'msg_fixture_qa017',type:'message',role:'assistant',model:'deepseek-flash',stop_reason:'end_turn',content:[{type:'server_tool_use',id:'search_fixture',name:'web_search',input:{query:'Nobel Physics 2025'}},{type:'web_search_tool_result',tool_use_id:'search_fixture',content:[{type:'web_search_result',url:'https://www.nobelprize.org/prizes/physics/2025/press-release/',title:'Official Nobel Prize announcement',encrypted_content:'fixture-source-only'}]},{type:'text',text:'The answer is based on the [official announcement](https://www.nobelprize.org/prizes/physics/2025/press-release/).'}],usage:{input_tokens:12,output_tokens:32,server_tool_use:{web_search_requests:1}}};
try{
 if(live){configBefore=hash(fs.readFileSync(process.argv[3]));profile=await loadLivePortableProfile(process.argv[3],'DS',{expectedModel:'deepseek-flash'});assert.equal(profile.providerId,'deepseek');assert.ok(!profile.baseUrl||new URL(profile.baseUrl).hostname==='api.deepseek.com');report.profile=liveProfileMetadata(profile);}
 const transport=createCurlFetch({timeoutMs:120000});
 server=http.createServer(async(req,res)=>{try{
  assert.equal(req.method,'POST');assert.equal(req.url,'/'+token);let chunks=[],size=0;
  for await(const chunk of req){size+=chunk.length;assert.ok(size<=2*1024*1024);chunks.push(chunk);}
  const body=Buffer.concat(chunks).toString('utf8'),parsed=JSON.parse(body);
  assert.equal(report.requests.length,0,'one request cap');assert.equal(parsed.model,'deepseek-flash');assert.ok(parsed.max_tokens<=8192);assert.equal(parsed.stream,false);assert.equal(parsed.tools[0].name,'web_search');assert.equal(parsed.tools[0].max_uses,1);
  report.requests.push({model:parsed.model,maxTokens:parsed.max_tokens,tool:parsed.tools[0].type});
  fs.writeFileSync(path.join(out,'request-public.json'),body);save();
  let status=200,text=JSON.stringify(fixture);
  if(live){report.realApiCalls++;save();const response=await transport(endpoint,{method:'POST',headers:{'x-api-key':profile.apiKey,'anthropic-version':'2023-06-01','Content-Type':'application/json'},body});status=response.status;text=await response.text();assert.ok(!text.includes(profile.apiKey));}
  fs.writeFileSync(path.join(out,'response-public.json'),text);report.httpStatus=status;save();res.writeHead(status,{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});res.end(text);
 }catch(e){report.transportError=/^[A-Z_]+$/.test(e.code||'')?e.code:'BROKER_REQUEST_FAILED';save();res.writeHead(500,{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});res.end('{"error":{"message":"Acceptance transport failed"}}');}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const broker='http://127.0.0.1:'+server.address().port+'/'+token;
 fs.mkdirSync(extension);for(const e of fs.readdirSync(source,{withFileTypes:true}))if((e.isDirectory()&&['core','providers','vendor','icons','_locales'].includes(e.name))||(e.isFile()&&(/\.(js|mjs|html|css)$/.test(e.name)||e.name==='manifest.json')))fs.cpSync(path.join(source,e.name),path.join(extension,e.name),{recursive:true});
 report.source=source;
 for(const f of ['providers/deepseek.js','core/article-chat-web-sources.js','core/article-chat.js','core/background-router.js','content.js','popup.js'])report.sourceHashes[f]=hash(fs.readFileSync(path.join(source,f)));
 const boundary=`const acceptanceNativeFetch=globalThis.fetch.bind(globalThis);globalThis.fetch=(url,options={})=>{if(String(url)!==${JSON.stringify(endpoint)})throw Error('QA017_BLOCKED_NETWORK');return acceptanceNativeFetch(${JSON.stringify(broker)},{method:'POST',headers:{'Content-Type':'text/plain'},body:options.body,signal:options.signal});};\n`;
 for(const f of ['background.js','offscreen-network-worker.js'])fs.writeFileSync(path.join(extension,f),boundary+fs.readFileSync(path.join(extension,f),'utf8'));
 context=await chromium.launchPersistentContext(path.join(temp,'profile'),{channel:'msedge',headless:true,reducedMotion:'reduce',viewport:{width:1200,height:900},args:['--disable-extensions-except='+extension,'--load-extension='+extension]});
 const title='Public science news acceptance article',url='https://example.org/qa017-public-news';
 await context.route(/^https?:\/\//,route=>route.request().url().startsWith('http://127.0.0.1:')?route.continue():route.request().url()===url?route.fulfill({contentType:'text/html',body:`<!doctype html><meta charset="utf-8"><title>${title}</title><link rel="canonical" href="${url}"><article><h1>${title}</h1><h2>Background</h2><p>The Nobel Prize in Physics recognizes discoveries in physics. This synthetic article is only a public-information acceptance fixture, not a user document.</p><h2>Question</h2><p>The official Nobel Prize website publishes the names of laureates and the award motivation. Consult that source for the award announcement.</p></article>`}):route.request().isNavigationRequest()&&new URL(route.request().url()).hostname=='www.nobelprize.org'?route.fulfill({contentType:'text/html',body:'<title>Acceptance source navigation fixture</title><p>Requested source URL opened.</p>'}):route.abort());
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');const paper=context.pages()[0]||await context.newPage();await paper.goto(url);
 const tab=await worker.evaluate(async u=>(await chrome.tabs.query({})).find(t=>t.url===u),url);
 await worker.evaluate(async t=>{const activation=await SciLLM.markTabActivated(chrome.storage.session,t);await chrome.runtime.sendMessage({type:'PANEL_TAB_ACTIVATED',activation}).catch(()=>{});},tab);
 const panel=await context.newPage();await panel.setViewportSize({width:420,height:900});await panel.goto('chrome-extension://'+new URL(worker.url()).host+'/popup.html');await paper.bringToFront();
 await panel.waitForFunction(t=>document.getElementById('sidePanelPaperTitle')?.textContent===t,title,{timeout:30000});
 await panel.evaluate(async()=>{for(const m of [{type:'LLM_SAVE_PROFILE',profile:{id:'profile_qa017_browser',name:'DS isolated acceptance',providerId:'deepseek',config:{apiKey:'synthetic-broker-credential',model:'deepseek-flash',maxOutputTokens:8192,reasoningEnabled:false}}},{type:'LLM_UPDATE_PROFILE_ROUTING',globalProfileId:'profile_qa017_browser',taskRoutes:{}},{type:'LLM_UPDATE_PREFERENCES',preferences:{mode:'llm',consentGranted:true}}]){const r=await chrome.runtime.sendMessage(m);if(!r?.success)throw Error('SETUP_FAILED_'+m.type+'_'+String(r?.error?.code||r?.error||''));}await loadLlmSettings();await refreshArticleWorkspace();});
 await panel.locator('#workspace-tab-chat').click();await panel.locator('#articleChatProfile').selectOption('profile_qa017_browser');await panel.locator('#articleChatWebSearch').click();
 await panel.locator('#articleChatQuestion').fill('Search the official Nobel Prize website for the 2025 Nobel Prize in Physics. Give the laureates and award motivation with clickable official sources.');await panel.locator('#sendArticleChat').click();
 await panel.waitForFunction(()=>!currentWorkspaceSnapshot?.chat?.loading&&['completed','error','failed'].includes(currentWorkspaceSnapshot?.chat?.turns?.at(-1)?.status),null,{timeout:150000});
 report.turn=await panel.evaluate(()=>currentWorkspaceSnapshot.chat.turns.at(-1));save();
 check('production turn completed with genuine search receipt',report.turn.status==='completed'&&report.turn.webSearch?.searched===true&&Boolean(report.turn.webGrounding?.receiptId));
 const links=await panel.locator('.article-chat-turn').last().locator('a[href^="https://"]').evaluateAll(es=>es.map(e=>({href:e.href,text:e.textContent,target:e.target,rel:e.rel})));
 report.links=links;check('actual popup renders clickable HTTPS source links',links.some(l=>l.href.includes('nobelprize.org')));
 const sourceLink=panel.locator('.article-chat-turn').last().locator('a[href^="https://"]').first();const href=await sourceLink.getAttribute('href');
 const opened=context.waitForEvent('page');await sourceLink.click();const linked=await opened;await linked.waitForURL(href,{timeout:15000});check('source click opens exact href',linked.url()===href);report.clickedHref=href;report.remoteLoad='Navigation fulfilled by a local source fixture; exact requested URL checked, remote availability not claimed';await linked.close();
 await paper.bringToFront();await panel.screenshot({path:path.join(out,'answer-420.png'),fullPage:true});
 const before=report.turn;await panel.reload();await paper.bringToFront();await panel.waitForFunction(()=>currentWorkspaceSnapshot?.chat?.turns?.at(-1)?.status==='completed',null,{timeout:30000});
 const reopened=await panel.evaluate(()=>currentWorkspaceSnapshot.chat.turns.at(-1));check('saved turn and receipt survive popup reload',reopened.turnId===before.turnId&&reopened.webGrounding?.receiptId===before.webGrounding?.receiptId);
 report.status='PASS';
}catch(e){report.status='FAIL';report.error=e.code||e.message;process.exitCode=1;}
finally{await context?.close();await new Promise(resolve=>server?server.close(resolve):resolve());if(live)report.configUnchanged=hash(fs.readFileSync(process.argv[3]))===configBefore;profile=undefined;report.output=out;save();console.log(JSON.stringify({status:report.status,realApiCalls:report.realApiCalls,checks:report.checks,error:report.error,output:out}));}
