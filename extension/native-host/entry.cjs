'use strict';
// Managed Node entry. The legacy Windows SEA remains self-contained in host.js.
// Chrome supplies the caller origin; never accept an extension ID from a message.
const path = require('node:path');
const fs = require('node:fs');
const { extensionIdsFromManifest } = require('../mcp/server.js');
const { control } = require('../mcp/connection-service.js');
const { CodexBridgeHost, createNativeMessageParser, encodeNativeMessage } = require('./host.js');
const root = path.resolve(__dirname, '..');
let origin;
try { origin = new URL(process.argv[2]); } catch { process.exit(1); }
if (origin.protocol !== 'chrome-extension:' || origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password || origin.port ||
    !extensionIdsFromManifest(path.join(root, 'manifest.json')).includes(origin.hostname)) process.exit(1);
const active = JSON.parse(fs.readFileSync(path.resolve(root, '..', '..', 'active.json'), 'utf8'));
if (fs.realpathSync(active.payloadRoot) !== fs.realpathSync(root) || !path.isAbsolute(active.nativeStateDir)) process.exit(1);
process.env.BREVESS_NATIVE_STATE_DIR = active.nativeStateDir;
const send = message => process.stdout.write(encodeNativeMessage(message));
const host = new CodexBridgeHost({ send });
let closed = false;
const agentJobs=new Set();
const logins=new Map();
const agentClients=require('../core/agent-setup-prompt.js').getAgentSetupClients();
const knownClient=id=>agentClients.some(client=>client.id===id);
function settingsCommand(message) {
  const {type,requestId,client} = message;
  const sendStage = data => { if (!closed) send({type:type+'.result',requestId,client,...data}); };
  const reject = error => sendStage({ok:false, error:{code:/^(AGENT_|CONFIG_|NODE_REQUIRED)/.test(error.code||'') ? error.code : 'AGENT_CONNECTION_FAILED'}});
  if (!requestId || !knownClient(client)) { reject({code:'AGENT_CLIENT_INVALID'}); return; }
  if (type === 'agent.settings.inspect') {
    const def=agentClients.find(item=>item.id===client);
    const cliAvailable=def.transport ? !!require('./workbench-agents.cjs').locate(client) : null;
    sendStage({ok:true,registered:configuredClients().includes(client),cliAvailable});return;
  }
  if (type === 'agent.settings.code') {
    try {
      const flow = logins.get(requestId);
      if (!flow || client !== 'antigravity') throw Object.assign(Error(),{code:'AGENT_LOGIN_EXPIRED'});
      flow.submit(message.code);
    } catch (error) { reject(error); }
    return;
  }
  const abort = new AbortController();
  agentJobs.add(abort);
  const timeout=setTimeout(()=>abort.abort(), type==='agent.settings.configure'?30000:600000);
  (async()=>{
    if(type === 'agent.settings.configure') {
      const {registerInstalledClient} = await import('../scripts/setup-agent-connection.mjs');
      const result=registerInstalledClient({payloadRoot:root,extensionId:origin.hostname,client});
      sendStage({ok:true,...result});
    } else {
      if(client!=='antigravity')throw Object.assign(Error(),{code:'AGENT_CLIENT_INVALID'});
      const runtime=require('./antigravity-runtime.cjs');
      const command=require('./workbench-agents.cjs').locate(client);
      if(type==='agent.settings.install') {
        if(!command)await runtime.install(active.nativeStateDir,abort.signal);
        sendStage({ok:true,stage:'installed'});
      } else {
        if(!command)throw Object.assign(Error(),{code:'AGENT_CLI_MISSING'});
        const flow=runtime.login(command, data=>sendStage({ok:true,...data}), abort.signal);
        logins.set(requestId,flow);await flow.done;sendStage({ok:true,stage:'complete'});
      }
    }
  })().catch(reject).finally(()=>{clearTimeout(timeout);logins.delete(requestId);agentJobs.delete(abort);});
}
const configuredClients=()=>{
  const current=JSON.parse(fs.readFileSync(path.resolve(root,'..','..','active.json'),'utf8'));
  return Array.isArray(current.configuredClients)?current.configuredClients:[];
};
const parse = createNativeMessageParser(message => {
  const type = String(message?.type || '');
  if (['agent.settings.inspect','agent.settings.configure','agent.settings.install','agent.settings.login','agent.settings.code'].includes(type)) {settingsCommand(message);return;}
  if (['agent.sdk.models','agent.sdk.turn','agent.sdk.probe'].includes(type)) {
    const abort=new AbortController();agentJobs.add(abort);
    const timeout=setTimeout(()=>abort.abort(),type.endsWith('.turn')?290000:26000);
    Promise.resolve().then(()=>require('./workbench-agents.cjs').run(type.split('.').pop(),message.args,configuredClients(),abort.signal))
      .then(data=>{if(!closed)send({requestId:message.requestId,success:true,data});},e=>{if(!closed)send({requestId:message.requestId,success:false,error:{code:/^[A-Z_]{3,80}$/.test(e.code)?e.code:'AGENT_CLIENT_UNAVAILABLE',message:/^[A-Z_]{3,80}$/.test(e.code)?e.message:'客户端暂时不可用。'}});})
      .finally(()=>{clearTimeout(timeout);agentJobs.delete(abort);});return;
  }
  if (type.startsWith('presentation.')) {
    const op = type.slice('presentation.'.length);
    if (!['open','image','publish','status','read','cancel','setup','clients','respond'].includes(op)) return;
    const respond = data => { if (!closed) send({type: type+'.result', requestId: message.requestId, ...data}); };
    if(op==='clients'){respond({success:true,data:configuredClients().filter(id=>Object.hasOwn(require('../core/article-presentation.js').agents,id))});return;}
    if (op === 'setup') {
      const agent = Object.hasOwn(require('../core/article-presentation.js').agents,message.args?.agent) ? message.args.agent : 'workbuddy';
      respond({success:true,data:{platform:process.platform,command:process.execPath,args:[path.join(root,'mcp','presentation-client.cjs'),agent]}});
      return;
    }
    require('../mcp/lib/presentation-jobs.cjs').createStore().command(op,message.args || {})
      .then(data => respond({success:true,data})).catch(e => respond({success:false,error:e.code || 'PPT_JOB_FAILED'}));
    return;
  }
  if (type.startsWith('agent.connection.')) {
    const action = type.slice('agent.connection.'.length);
    Promise.resolve().then(() => control({ action, extensionId: origin.hostname }, { payloadRoot: root }))
      .then(result => { if (!closed) send({ type: type + '.result', requestId: String(message.requestId || ''), ...result }); })
      .catch(error => { if (!closed) send({ type: 'agent.connection.error', requestId: String(message.requestId || ''),
        error: { code: /^AGENT_|^SERVICE_/u.test(error?.code) ? error.code : 'AGENT_CONNECTION_FAILED' } }); });
    return;
  }
  Promise.resolve(host.handle(message)).catch(() => { if (!closed) send({ type: 'host.error', requestId: String(message.requestId || ''), error: { code: 'BRIDGE_FAILURE' } }); });
});
process.stdin.on('data', parse);
process.stdin.on('end', () => { closed = true; for(const job of agentJobs)job.abort();host.close(); });
process.stdin.on('error', () => { closed = true; for(const job of agentJobs)job.abort();host.close(); });
