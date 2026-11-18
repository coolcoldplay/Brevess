const test = require('node:test');
const assert = require('node:assert/strict');
const { connectAndTestAgent, agentConnectionView, parseAgentPairingLink, startCodexAgentLogin, showAgentConnectionCenter } = require('../extension/core/agent-connection-ui.js');

function fixture(initial, overrides = {}) {
  let state = initial; const calls = []; let pairedConfig;
  const options = {
    status: async () => ({ bridge: { state } }),
    native: async action => { calls.push('native:' + action); return { serverUrl: 'http://127.0.0.1:9537', pairing: { token: 'test-token' } }; },
    pair: async config => { pairedConfig = config; calls.push('pair'); assert.equal(config.token, 'test-token'); state = 'waiting'; },
    openWorkbench: async ({ active }) => { calls.push('open:' + active); state = 'connected'; },
    check: async () => { calls.push('check'); },
    reconnect: async () => { calls.push('resume'); state = 'connected'; },
    sleep: async () => {}, pollAttempts: 3, ...overrides
  };
  return { options, calls, setState: value => { state = value; }, getPair: () => pairedConfig };
}

test('one action starts, pairs, opens a background workbench and probes; token is cleared', async () => {
  const f = fixture('unpaired'); const status = await connectAndTestAgent(f.options);
  assert.equal(status.bridge.state, 'connected');
  assert.deepEqual(f.calls, ['native:pair', 'pair', 'open:false', 'check']);
  assert.equal(f.getPair().token, '');
});

test('already connected testing does not re-pair, reopen tabs or revoke current scopes', async () => {
  const f = fixture('connected'); await connectAndTestAgent(f.options);
  assert.deepEqual(f.calls, ['check']);
});

test('saved pairing opens its missing host without asking users to copy credentials again', async () => {
  const f = fixture('waiting'); await connectAndTestAgent(f.options);
  assert.deepEqual(f.calls, ['open:false', 'check']);
});

test('paused connection resumes and multiple hosts never choose or close a research tab', async () => {
  const paused = fixture('paused'); await connectAndTestAgent(paused.options); assert.deepEqual(paused.calls, ['resume', 'check']);
  const multiple = fixture('multiple'); const result = await connectAndTestAgent(multiple.options);
  assert.equal(result.bridge.state, 'multiple'); assert.deepEqual(multiple.calls, []);
});

test('missing component stops before opening workbench; failed probe cannot report success', async () => {
  const missing = fixture('unpaired', { native: async () => { throw Object.assign(Error('missing'), { code: 'AGENT_NOT_INSTALLED' }); } });
  await assert.rejects(connectAndTestAgent(missing.options), { code: 'AGENT_NOT_INSTALLED' }); assert.deepEqual(missing.calls, []);
  const failed = fixture('connected'); failed.options.check = async () => failed.setState('offline');
  const result = await connectAndTestAgent(failed.options); assert.equal(result.bridge.state, 'offline');
  assert.notEqual(agentConnectionView(result, true).tone, 'success');
});

test('slow host reports waiting, cancellation prevents later pairing, and failures clear tokens', async () => {
  const f = fixture('waiting', { openWorkbench: async () => {}, sleep: async () => {} });
  assert.equal((await connectAndTestAgent(f.options)).bridge.state, 'waiting'); assert.ok(!f.calls.includes('check'));
  const abort = new AbortController(); const cancelled = fixture('unpaired', { signal: abort.signal, native: async () => { abort.abort(); return {}; } });
  await assert.rejects(connectAndTestAgent(cancelled.options), { code: 'CANCELLED' }); assert.deepEqual(cancelled.calls, []);
  let config;
  const failed = fixture('unpaired', { pair: async value => { config = value; throw Error('pair failure'); } });
  await assert.rejects(connectAndTestAgent(failed.options), /pair failure/); assert.equal(config.token, '');
});

test('manual pairing rejects remote links, duplicate tokens and fragment credentials', () => {
  assert.deepEqual(parseAgentPairingLink('http://127.0.0.1:9537/connect?token=unit-token'), { server: 'http://127.0.0.1:9537', token: 'unit-token' });
  for (const url of ['https://example.com/connect?token=unit-token', 'http://127.0.0.1/connect?token=a&token=b', 'http://127.0.0.1/connect?token=a#b']) assert.throws(() => parseAgentPairingLink(url));
});

test('new host registration may briefly report unpaired before the saved pairing connects', async () => {
  const f = fixture('waiting'); let reads = 0;
  f.options.status = async () => ({ bridge: { state: ['waiting', 'unpaired', 'connecting', 'connected'][Math.min(reads++, 3)], configured: true } });
  const status = await connectAndTestAgent(f.options);
  assert.equal(status.bridge.state, 'connected'); assert.deepEqual(f.calls, ['open:false', 'check']);
});

test('offline saved service is started once while manual pairing keeps its chosen endpoint', async () => {
  const managed = fixture('waiting');
  managed.options.openWorkbench = async () => managed.setState('offline');
  managed.options.pair = async () => { managed.calls.push('pair'); managed.setState('connected'); };
  assert.equal((await connectAndTestAgent(managed.options)).bridge.state, 'connected');
  assert.deepEqual(managed.calls, ['native:pair', 'pair', 'check']);
  const manual = fixture('offline', { manualPairing: true });
  assert.equal((await connectAndTestAgent(manual.options)).bridge.state, 'offline'); assert.deepEqual(manual.calls, []);
});

test('Codex login opens only official HTTPS pages without logging out an existing session', async () => {
  for (const authUrl of ['https://auth.openai.com/oauth/authorize', 'https://chatgpt.com/auth/login']) {
    const calls = [];
    await startCodexAgentLogin({
      request: async message => { calls.push(message); return { authUrl }; },
      openTab: async options => { calls.push(options); }
    });
    assert.deepEqual(calls, [{ type: 'CODEX_LOCAL_LOGIN_START', force: false }, { url: authUrl }]);
  }
  for (const authUrl of ['', 'http://auth.openai.com/', 'https://auth.openai.com.evil.test/', 'https://auth.openai.com:444/', 'https://user:pass@auth.openai.com/', 'javascript:alert(1)']) {
    await assert.rejects(startCodexAgentLogin({ request: async () => ({ authUrl }),
      openTab: async () => assert.fail('untrusted login must not open') }), { code: 'CODEX_PROVIDER_REJECTED' });
  }
});

function connectionDialogDocument() {
  const nodes = [];
  class Node extends EventTarget {
    constructor(tag) { super(); this.tag = tag; this.dataset = {}; this.children = []; this.hidden = false; }
    append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } }
    get isConnected() { return this.tag === 'body' || !!this.parent?.isConnected; }
    setAttribute(name, value) { this[name] = value; }
    removeAttribute(name) { delete this[name]; }
    showModal() { this.open = true; }
    close() { this.open = false; this.dispatchEvent(new Event('close')); }
    remove() { this.parent = null; }
  }
  const view = new EventTarget(); view.sessionStorage = { getItem: () => '', setItem() {} };
  return { nodes, defaultView: view, body: new Node('body'), visibilityState: 'visible',
    querySelector: () => null, createElement: tag => { const node = new Node(tag); nodes.push(node); return node; } };
}

test('connection dialog offers Codex login after auth failure and only reports model success after retest', async () => {
  const doc = connectionDialogDocument(), before = globalThis.SciLLM.getAgentSetupClients;
  globalThis.SciLLM.getAgentSetupClients = () => [{ id: 'codex', label: 'Codex', modelAdapter: 'codex-local' },
    { id: 'dsh', label: 'DSH', modelAdapter: 'deepseek-harness' }];
  let signedIn = false, loginCount = 0, modelTests = 0;
  const ui = showAgentConnectionCenter({ document: doc, settingsOwner: true, client: 'codex',
    status: async () => ({ bridge: { state: 'connected' } }), check: async () => {},
    connectModel: async () => { modelTests++; if (!signedIn) throw Object.assign(Error('sign in'), { code: 'CODEX_NOT_AUTHENTICATED' });
      return { name: 'Codex · Agent', model: 'auto' }; },
    loginModel: async client => { assert.equal(client, 'codex'); loginCount++; }
  });
  try {
    await ui.refresh();
    const login = doc.nodes.find(n => n.id === 'loginAgentModel');
    const testButton = doc.nodes.find(n => n.id === 'testAgentConnection');
    const title = doc.nodes.find(n => n.className === 'agent-result-title');
    assert.equal(login.hidden, true);
    await testButton.onclick();
    assert.equal(login.hidden, false); assert.match(title.textContent, /问答尚未就绪/);
    await login.onclick();
    assert.equal(loginCount, 1); assert.equal(modelTests, 1);
    assert.equal(title.textContent, '官方登录页已打开');
    const select = doc.nodes.find(n => n.id === 'agentSetupClient');
    select.value = 'dsh'; select.onchange(); assert.equal(login.hidden, true);
    select.value = 'codex'; select.onchange(); signedIn = true;
    await testButton.onclick();
    assert.equal(modelTests, 2); assert.equal(login.hidden, true);
    assert.equal(title.textContent, '浏览器与问答连接测试通过');
  } finally { ui.dialog.close(); globalThis.SciLLM.getAgentSetupClients = before; }
});
