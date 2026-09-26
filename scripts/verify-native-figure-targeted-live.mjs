// Compare the remaining difficult Panels through the real, existing Codex bridge.
// Original complete Figure regions and production prompts; no expected answers.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  loadCapturedSynthesisInput,
  assertExactPartition
} from './verify-figure-group-synthesis-live.mjs';
const require = createRequire(import.meta.url);
require('../providers/provider-utils.js');
require('../core/figure-panel-planner.js');
const api = require('../core/figure-analysis.js');
const root = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const live = args.includes('--live');
const index = args.indexOf('--output-dir');
assert.ok(index >= 0 && args[index + 1]);
const out = path.resolve(args[index + 1]);
const synthesisSourceIndex = args.indexOf('--synthesis-source-dir');
const synthesisSourceDir = synthesisSourceIndex >= 0
  ? path.resolve(args[synthesisSourceIndex + 1] || '') : '';
const synthesisMode = Boolean(synthesisSourceDir);
assert.equal(synthesisSourceIndex < 0 || Boolean(args[synthesisSourceIndex + 1]), true,
  '--synthesis-source-dir requires a directory');
assert.ok(!fs.existsSync(out), 'Refuse to overwrite evidence');
fs.mkdirSync(out, {recursive:true});
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const hashFile = file => sha(fs.readFileSync(file));
const save = (name, value) => fs.writeFileSync(path.join(out,name), JSON.stringify(value,null,2)
  .replace(/\bsk-[A-Za-z0-9_-]{3,}\b/g,'[REDACTED_SECRET]'));
const sourceRoot = path.join(root,'output/playwright/figure-detail-tiles-source-r12');
const receipt = synthesisMode ? null
  : JSON.parse(fs.readFileSync(path.join(sourceRoot,'source-receipt.json')));
if (receipt) assert.equal(receipt.status,'PASS');
const plans = [
  {id:'figure-1', requestFile:'provider-request-006-redacted.json', count:26, targets:['F','J','M','N','O']},
  {id:'figure-2', requestFile:'provider-request-009-redacted.json', count:11, targets:['D','J','K']}
];
const materials = plans.map(plan => {
  const expectedPanels = Array.from({length:plan.count},(_,i)=>String.fromCharCode(65+i));
  const {input} = loadCapturedSynthesisInput(path.join(root,'tmp/figure-speed-r5-live-vision'),{...plan,expectedPanels});
  if(synthesisMode){
    const panelFile=path.join(synthesisSourceDir,`${plan.id}-fresh-panels-normalized-redacted.json`);
    const panelBytes=fs.readFileSync(panelFile),panelEvidence=JSON.parse(panelBytes);
    assert.deepEqual(panelEvidence.map(panel=>String(panel?.panel||'').trim().toUpperCase()),expectedPanels);
    assert.equal(new Set(panelEvidence.map(panel=>panel.panel)).size,expectedPanels.length);
    const compiled=api.compileFigureSynthesisPrompt({...input,panelHints:expectedPanels},panelEvidence,
      {visualInput:true,analysisDepth:'standard'});
    const request={
      type:'turn.start',requestId:`r12-native-synthesis-${plan.id}`,conversationKey:'',
      conversationLabel:'Brevess structured task',profileId:'r12_native_figure_synthesis_acceptance',
      model:'gpt-5.6-sol',reasoningEffort:'high',ephemeral:true,
      systemPrompt:compiled.systemPrompt+'\nReturn only one JSON object that validates against this JSON Schema:\n'+JSON.stringify(compiled.responseSchema),
      userPrompt:compiled.userPrompt,images:[],maxOutputTokens:30000
    };
    return {plan:{...plan,expectedPanels},requestInput:{...input,panelHints:expectedPanels},
      request,panelEvidence,panelFile,panelFileSha256:sha(panelBytes),tiles:[]};
  }
  const requestInput = {...input,panelHints:plan.targets};
  const compiled = api.compileFigurePanelBatchPrompt(requestInput,{visualInput:true,analysisDepth:'standard'});
  const tiles = receipt.figures.find(f=>f.figureId===plan.id).tiles;
  const images = tiles.map(tile=>{
    const file=path.join(sourceRoot,tile.outputFile), bytes=fs.readFileSync(file);
    assert.equal(sha(bytes),tile.outputSha256);
    return {mediaType:'image/jpeg',dataUrl:`data:image/jpeg;base64,${bytes.toString('base64')}`};
  });
  assert.equal(images.length,4);
  const request = {
    type:'turn.start',requestId:`r12-native-${plan.id}`,conversationKey:'',
    conversationLabel:'Brevess structured task',profileId:'r12_native_figure_acceptance',
    model:'gpt-5.6-sol',reasoningEffort:'high',ephemeral:true,
    systemPrompt:compiled.systemPrompt+'\nReturn only one JSON object that validates against this JSON Schema:\n'+JSON.stringify(compiled.responseSchema),
    userPrompt:compiled.userPrompt,images,maxOutputTokens:30000
  };
  return {plan,requestInput,request,tiles};
});
const report = {status:live?'LIVE_STARTED':'PREPARED_ZERO_MODEL_CALLS',
  realNativeTurns:0,hardNativeTurnCap:2,automaticRetries:0,
  requestedModel:'gpt-5.6-sol',requestedReasoningEffort:'high',
  effectiveModelReportedByBridge:false,
  scope:synthesisMode?{mode:'two_figure_text_synthesis',totalPanelRecords:37,newTextSynthesis:true,
    originalImageRead:false,imagesSent:0,expectedAnswersEmbedded:false,priorSynthesisAnswersIncluded:false,
    responseReplay:false,reasoningAcceptedAsAnswer:false,scientificAcceptance:false,
    source:'37 retained normalized Panel records from the explicitly supplied source directory; captions and article context from the same captured public inputs'}
    :{originalImageRead:true,expectedAnswersEmbedded:false,replay:false,scientificAcceptance:false,
      requestedPanels:8,source:'same official Figure regions used in DeepSeek runs; no manually marked Panel crops'},
  sourceReceiptSha256:synthesisMode?'':hashFile(path.join(sourceRoot,'source-receipt.json')),
  synthesisSourceDirectory:synthesisMode?path.relative(root,synthesisSourceDir).replace(/\\/g,'/'):'',
  sourceHashes:Object.fromEntries(['core/figure-analysis.js','native-host/host.js','scripts/verify-native-figure-targeted-live.mjs'].map(f=>[f,hashFile(path.join(root,f))])),
  turns:materials.map(m=>({figureId:m.plan.id,
    panels:synthesisMode?m.plan.expectedPanels:m.plan.targets,requestSha256:sha(JSON.stringify(m.request)),
    promptSha256:sha(m.request.systemPrompt+'\n'+m.request.userPrompt),imageHashes:m.tiles.map(t=>t.outputSha256),
    ...(synthesisMode?{sourcePanelFile:path.relative(root,m.panelFile).replace(/\\/g,'/'),
      sourcePanelFileSha256:m.panelFileSha256,panelHashes:Object.fromEntries(m.panelEvidence.map(panel=>
        [panel.panel,sha(JSON.stringify(panel))]))}:{}),status:'NOT_STARTED'}))};
save('report.json',report);
if(live){
  const child=spawn(process.execPath,[path.join(root,'native-host/host.js'),'chrome-extension://finhfnjbpidfakpmkghkfjlfcfpoandh/'],{
    cwd:root,stdio:['pipe','pipe','pipe'],windowsHide:true
  });
  let buffer=Buffer.alloc(0);
  const listeners=new Map();
  const send=message=>{
    const body=Buffer.from(JSON.stringify(message)),header=Buffer.alloc(4);header.writeUInt32LE(body.length);
    child.stdin.write(Buffer.concat([header,body]));
  };
  child.stderr.on('data',()=>{}); // Do not persist host configuration/authentication diagnostics.
  child.stdout.on('data',data=>{
    buffer=Buffer.concat([buffer,data]);
    while(buffer.length>=4){
      const size=buffer.readUInt32LE();assert.ok(size<=16*1024*1024);
      if(buffer.length<size+4)break;
      const value=JSON.parse(buffer.subarray(4,size+4).toString());buffer=buffer.subarray(size+4);
      listeners.get(value.requestId)?.(value);
    }
  });
  try{
    const results=await Promise.allSettled(materials.map((m,i)=>new Promise((resolve,reject)=>{
      let text='';const result=report.turns[i],started=Date.now();
      const timer=setTimeout(()=>{send({type:'turn.cancel',requestId:m.request.requestId,reason:'acceptance-timeout'});reject(new Error('NATIVE_ACCEPTANCE_TIMEOUT'));},300000);
      const fail=error=>{clearTimeout(timer);result.status='FAIL';result.error=String(error.message||error).slice(0,500);save('report.json',report);reject(error);};
      child.once('error',fail);
      listeners.set(m.request.requestId,message=>{
        if(message.type==='turn.delta')text+=String(message.text||'');
        if(message.type==='turn.started'){result.started=true;result.threadId=message.threadId;result.turnId=message.turnId;save('report.json',report);}
        if(message.type==='turn.usage')result.usage=message.usage;
        if(!['turn.completed','turn.error','turn.cancelled'].includes(message.type))return;
        clearTimeout(timer);result.elapsedMs=Date.now()-started;result.terminalType=message.type;
        save(`${m.plan.id}-native-response.json`,{text,terminal:message});
        if(message.type!=='turn.completed')return fail(new Error(message.error?.code||message.type));
        try{
          const raw=globalThis.SciLLM.parseJsonText(text);
          if(synthesisMode){
            const memberships=assertExactPartition(raw,m.plan);
            const normalized=api.validateFigureSynthesis(raw,m.requestInput,m.panelEvidence,
              {visualInput:true,analysisDepth:'standard',repairResponse:false,requireCompletePanels:true});
            assert.deepEqual(normalized.panels.map(p=>p.panel),m.plan.expectedPanels);
            save(`${m.plan.id}-fresh-panels-normalized-redacted.json`,m.panelEvidence);
            save(`${m.plan.id}-synthesis-normalized-redacted.json`,normalized);
            result.panelGroups=memberships;
            result.outputPanelHashes=Object.fromEntries(m.panelEvidence.map(panel=>
              [panel.panel,sha(JSON.stringify(panel))]));
            assert.deepEqual(result.outputPanelHashes,result.panelHashes);
          }else{
            const normalized=api.validateFigurePanelBatch(raw,m.requestInput,{visualInput:true,analysisDepth:'standard',repairResponse:false});
            assert.deepEqual(normalized.panels.map(p=>p.panel),m.plan.targets);
            save(`${m.plan.id}-refreshed-panels.json`,normalized.panels);
          }
          result.status='STRUCTURAL_PASS_SCIENTIFIC_REVIEW_REQUIRED';save('report.json',report);resolve();
        }catch(error){fail(error);}
      });
      result.status='SENT';report.realNativeTurns+=1;assert.ok(report.realNativeTurns<=2);save('report.json',report);send(m.request);
    })));
    report.status=results.every(r=>r.status==='fulfilled')?'STRUCTURAL_PASS_SCIENTIFIC_REVIEW_REQUIRED':'FAIL';
  }finally{
    save('report.json',report);child.stdin.end();setTimeout(()=>child.kill(),1000).unref();
  }
}
console.log(JSON.stringify({status:report.status,realNativeTurns:report.realNativeTurns,scope:report.scope}));
if(report.status==='FAIL')process.exitCode=1;
