// Read-only acceptance metadata. No secrets or arbitrary profile fields are serialized.
import fs from 'node:fs';
import path from 'node:path';
import {createHash,webcrypto} from 'node:crypto';
import {createRequire} from 'node:module';
import {readSecretFromTty} from './probe-deepseek-figure-recovery.mjs';
const require=createRequire(import.meta.url),codec=require('../core/portable-config.js');
const {api}=require('../tests/helpers/note016-runtime.js');
const root=path.resolve(import.meta.dirname,'..');
const file=path.resolve(process.argv[2]),expected=process.argv[3];
const hash=b=>createHash('sha256').update(b).digest('hex');
const bytes=fs.readFileSync(file);
if(bytes.length>2*1024*1024||hash(bytes)!==expected)throw Error('CONFIG_BASELINE_MISMATCH');
const envelope=JSON.parse(bytes);codec.validatePortableEnvelope(envelope);
let password=await readSecretFromTty({prompt:'Portable config password (hidden): '}),key,payload;
try{key=await codec.derivePortableConfigKey(password,{salt:codec.fromBase64(envelope.encryption.salt),iterations:envelope.encryption.iterations,cryptoRef:webcrypto});({payload}=await codec.decryptPortableConfig(envelope,{keyBytes:key,cryptoRef:webcrypto}));}
catch{throw Error('CONFIG_UNLOCK_FAILED');}finally{key?.fill(0);password='';}
const settings=api.mergeSettings(payload.settings);
const routes=['figure_walkthrough','figure_panel_interpretation','figure_panel_followup'].map(taskId=>{
 try{const r=api.resolveTaskProfile(settings,taskId);return {taskId,providerId:r.providerId,profileName:r.publicProfile?.name,model:r.config?.model,officialEndpoint:!r.config?.baseUrl||new URL(r.config.baseUrl).hostname==='api.deepseek.com',capabilityMode:r.capabilityMode,supportsVision:r.publicProfile?.supportsVision,allowTextFallback:settings.taskPolicies[taskId]?.allowTextFallback};}
 catch(e){return{taskId,errorCode:['NO_USABLE_PROFILE','CAPABILITY_MISMATCH','INVALID_SETTINGS'].includes(e.code)?e.code:'ROUTE_FAILED'};}
});
const report={at:new Date().toISOString(),revision:envelope.revision,configSha256:expected,routes,configUnchanged:hash(fs.readFileSync(file))===expected,realApiCalls:0};
payload=undefined;
const out=fs.mkdtempSync(path.join(root,'output/fig023-current-routes-'));
fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({...report,output:out}));
