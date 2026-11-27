const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRenderer } = require('../extension/core/chat-message-ui.js');
const { connectAndTestAgent } = require('../extension/core/agent-connection-ui.js');

function setupClient(reply) {
  const calls = [];
  const scope = {
    crypto: { randomUUID: () => 'sample-challenge' },
    BrevessRiskGate: { requireAcknowledgement: async () => true },
    BrevessAgentConnections: { bridgeRequest: async (op, args) => {
      calls.push([op, args]);
      return op === 'agent.sdk.probe' ? { model:'sample', models:[{id:'sample'}] } : reply;
    } },
    SciLLM: { getAgentSetupClients: () => [{id:'antigravity', label:'Antigravity'}] }
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../extension/core/agent-settings-client.js'), 'utf8'), scope);
  return { api:scope.BrevessAgentSetup, calls };
}

test('WorkBuddy hands off only its own synthetic task and verifies the matching reply', async () => {
  const script = fs.readFileSync(require.resolve('../extension/core/article-presentation-background.js'),'utf8');
  for (const good of [true,false]) {
    let listener, result, task; const events = [], ops = [];
    let report;
    const done = new Promise(resolve => { report = resolve; });
    const runtime = {
      id:'local', getURL:path=>'chrome-extension://local/'+path, onConnect:{addListener:fn=>{listener=fn}}, onMessage:{addListener(){}},
      connectNative() {
        let receive;
        return {onMessage:{addListener:fn=>{receive=fn}},onDisconnect:{addListener(){}},disconnect(){},postMessage(msg) {
          const op=msg.type.split('.')[1]; ops.push(op);
          if(op==='open') task=msg.args;
          if(task) assert.equal(msg.args.id,task.id);
          const marker=task.materials.task.split(' ').at(-1);
          const data=op==='status'?{...task,state:'ready',answer:JSON.stringify({message:good?marker:'other-task',calls:[]})}:{};
          queueMicrotask(()=>receive({type:msg.type+'.result',requestId:msg.requestId,success:true,data}));
        }};
      }
    };
    vm.runInNewContext(script,{chrome:{runtime,storage:{local:{get:async key=>({[key]:{version:1,acknowledged:true,updatedAt:1}})}}},
      crypto:require('node:crypto').webcrypto,setTimeout,clearTimeout});
    listener({name:'brevess-workbuddy-setup-test',sender:{id:'local',frameId:0,url:runtime.getURL('options.html')},
      onDisconnect:{addListener(){}},postMessage(value){events.push(value);if(['passed','error'].includes(value.stage)){result=value;report();}}});
    await done;
    assert.equal(task.agent,'workbuddy'); assert.equal(task.kind,'chat');
    assert.equal(events.find(e=>e.stage==='pending').id,task.id);
    assert.equal(result.stage, good?'passed':'error');
    if(!good) assert.equal(result.code,'AGENT_MODEL_TEST_FAILED');
    assert.deepEqual(ops.slice(0,3),['open','publish','status']);
  }
});

test('Antigravity reports the provider region denial separately from an invalid model reply', async () => {
  const denied = 'Your current account is not eligible for Gemini Code Assist for individuals because it is not currently available in your location.';
  await assert.rejects(setupClient(denied).api.testClient('antigravity'), {code:'AGENT_ACCOUNT_REGION_UNAVAILABLE'});
  await assert.rejects(setupClient('no answer').api.testClient('antigravity'), {code:'AGENT_MODEL_TEST_FAILED'});
});

test('a waking registered bridge may briefly report offline before the real connectivity check', async () => {
  const states = ['unpaired','offline','offline','offline','connected','connected'];
  let pairs = 0, checks = 0;
  const result = await connectAndTestAgent({
    native: async () => ({serverUrl:'http://127.0.0.1:4532',pairing:{token:'fixture'}}),
    pair: async () => {pairs++}, status: async () => ({bridge:{state:states.shift()||'connected',configured:true}}),
    check: async () => {checks++}, sleep: async () => {}
  });
  assert.equal(result.bridge.state, 'connected');
  assert.equal(pairs, 1);
  assert.equal(checks, 1);
});

test('chat renders identifiers with underscores literally and preserves ordinary emphasis', () => {
  const { articleChatInlineMarkdownTokenAt: token } = createRenderer();
  const id = 'SAMPLE_TASK_ID_42';
  for (let i = 0; i < id.length; i++) assert.equal(token(id, i), null);
  assert.equal(token('_hello_world_!', 0).text, 'hello_world');
  assert.equal(token('__hello__', 0).kind, 'strong');
});
