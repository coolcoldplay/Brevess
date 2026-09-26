const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'popup.js'), 'utf8');
const start = source.indexOf('const sidePanelShortcutPublications = new Map();');
const end = source.indexOf('\nfunction capturePanelContext(', start);
assert.ok(start >= 0 && end > start);
const senderStart = source.indexOf('async function sendTabMessage(');
const senderEnd = source.indexOf('\n}', senderStart) + 2;
const production = source.slice(start, end) + '\n' + source.slice(senderStart, senderEnd);
const tick = () => new Promise(setImmediate);

function harness({ probeSuccess = true, probeIdentity = true, connectThrows = false, postThrows = false } = {}) {
  const messages = [], ports = [], timers = new Map();
  let timerId = 0;
  let releaseProbe = null;
  let releaseFalse = null;
  let scopePort = null;
  const events = () => {
    const listeners = new Set();
    return { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn),
      emit: message => [...listeners].forEach(fn => fn(message)), count: () => listeners.size };
  };
  const context = vm.createContext({
    console,
    setTimeout: fn => { timers.set(++timerId, fn); return timerId; },
    clearTimeout: id => timers.delete(id),
    currentKeyboardShortcuts: () => ({ figures: 'F' }),
    activePanelTabContext: { tabId: 45, activated: true, url: 'https://www.cell.com/cell/fulltext/one', key: 'one' },
    chrome: { tabs: { connect(tabId, options) {
      if (connectThrows) throw Error('no connection');
      const port = { tabId, options, messages: [], disconnected: false,
        onMessage: events(), onDisconnect: events(),
        postMessage(message) { if (postThrows) throw Error('closed before post'); this.messages.push(message); scopePort = this; },
        disconnect() { if (this.disconnected) return; this.disconnected = true;
          if (scopePort === this) scopePort = null; this.onDisconnect.emit(); }
      };
      ports.push(port); return port;
    } } },
    SciLLM: {
      async sendTabMessageWithRecovery(chrome, tabId, message, options) {
        messages.push({ kind: 'recovery', tabId, message, options });
        if (releaseProbe) await new Promise(resolve => { releaseProbe.resolve = resolve; });
        return { success: probeSuccess, ...(probeIdentity ? {
          documentIdentity: 'browser-document-one', navigationIdentity: 'https://www.cell.com/cell/fulltext/one'
        } : {}) };
      },
      async sendTabMessageIfPresent(chrome, tabId, message) {
        messages.push({ kind: 'present', tabId, message });
        if (releaseFalse) await new Promise(resolve => { releaseFalse.resolve = resolve; });
        // Browser boundary receiver model: an ordinary global false always
        // clears; a compatibility-only false cannot remove a newer live port.
        if (message.enabled === false && !(message.portScoped === true && scopePort)) scopePort = null;
        return { success: true };
      }
    }
  });
  vm.runInContext(production, context, { filename: 'popup.js:scope-port-production' });
  return { messages, ports, timers, context,
    publish: (enabled = true) => context.publishSidePanelShortcutScope(45, enabled),
    ack: (index = ports.length - 1, data = { success: true, enabled: true }) => ports[index].onMessage.emit(data),
    pauseProbe() { releaseProbe = {}; return () => { releaseProbe.resolve(); releaseProbe = null; }; },
    pauseFalse() { releaseFalse = {}; return () => { releaseFalse.resolve(); releaseFalse = null; }; },
    scopeEnabled: () => Boolean(scopePort),
    expire() { for (const fn of [...timers.values()]) fn(); },
    retainedPorts: () => vm.runInContext('typeof sidePanelShortcutPorts === "undefined" ? -1 : sidePanelShortcutPorts.size', context)
  };
}

test('popup probes without enabling, connects top frame, sends expected URL, and waits for positive ACK', async () => {
  const h = harness(); let completed = false;
  const pending = h.publish().then(value => { completed = true; return value; }); await tick();
  assert.equal(h.messages[0].message.action, 'prepareSidePanelShortcutScope');
  assert.equal(h.messages[0].message.enabled, undefined);
  assert.equal(h.ports.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(h.ports[0].options)), { name: 'brevess-side-panel-scope-v1', frameId: 0 });
  assert.deepEqual(JSON.parse(JSON.stringify(h.ports[0].messages[0])), {
    action: 'setSidePanelShortcutScope', enabled: true, shortcuts: { figures: 'F' }, expectedUrl: 'https://www.cell.com/cell/fulltext/one',
    expectedDocumentIdentity: 'browser-document-one', expectedNavigationIdentity: 'https://www.cell.com/cell/fulltext/one'
  });
  assert.equal(completed, false); h.ack(); assert.equal(await pending, true);
  assert.equal(h.retainedPorts(), 1); assert.equal(h.timers.size, 0);
});

test('disable synchronously disconnects an ACKed port and uses only non-injecting legacy false', async () => {
  const h = harness(), pending = h.publish(); await tick(); h.ack(); assert.equal(await pending, true);
  const disabled = h.publish(false); assert.equal(h.ports[0].disconnected, true);
  assert.equal(h.retainedPorts(), 0); assert.equal(await disabled, true);
  assert.deepEqual(h.messages.map(item => [item.kind, item.message.action, item.message.enabled]), [
    ['recovery', 'prepareSidePanelShortcutScope', undefined], ['present', 'setSidePanelShortcutScope', false]
  ]);
});

test('replacement cancels pending ACK and stale ACK/disconnect cannot revive or remove the new lease', async () => {
  const h = harness(), old = h.publish(); await tick(); assert.equal(h.ports.length, 1);
  const latest = h.publish(); assert.equal(h.ports[0].disconnected, true); await tick();
  assert.equal(await old, false); h.ack(0); h.ports[0].onDisconnect.emit();
  assert.equal(h.retainedPorts(), 1); assert.equal(h.ports[1].disconnected, false);
  h.ack(1); assert.equal(await latest, true); assert.equal(h.retainedPorts(), 1);
});

test('close during ACK wait cancels the publication even if the context stays activated', async () => {
  const h = harness(), pending = h.publish(); await tick(); assert.equal(h.ports.length, 1);
  await h.publish(false); h.ack(0); assert.equal(await pending, false); assert.equal(h.retainedPorts(), 0);
});

test('delayed compatibility false cannot clear the new port after close and reopen', async () => {
  const h = harness(), first = h.publish(); await tick(); h.ack(); assert.equal(await first, true);
  const release = h.pauseFalse(), close = h.publish(false); assert.equal(h.ports[0].disconnected, true);
  await tick(); const reopen = h.publish(); await tick(); h.ack(); assert.equal(await reopen, true);
  assert.equal(h.scopeEnabled(), true); release(); assert.equal(await close, true);
  assert.equal(h.scopeEnabled(), true, 'late legacy compatibility cleanup must not disable a newer acknowledged lease');
  assert.equal(h.messages.find(item => item.kind === 'present').message.portScoped, true);
});

test('browser port disconnect before ACK rejects and after ACK releases the retained port', async () => {
  const h = harness(), first = h.publish(); await tick(); assert.equal(h.ports.length, 1);
  h.ports[0].disconnect(); assert.equal(await first, false); assert.equal(h.retainedPorts(), 0);
  const second = h.publish(); await tick(); h.ack(); assert.equal(await second, true);
  h.ports[1].disconnect(); assert.equal(h.retainedPorts(), 0);
});

test('ACK timeout disconnects and never falls back to legacy enable', async () => {
  const h = harness(), pending = h.publish(); await tick(); assert.equal(h.ports.length, 1);
  h.expire(); assert.equal(await pending, false); assert.equal(h.ports[0].disconnected, true);
  assert.equal(h.retainedPorts(), 0); assert.ok(h.messages.every(item => item.message.enabled !== true));
});

test('negative or incomplete ACK cannot retain an enabled lease', async () => {
  for (const reply of [{ success: false }, { success: true, enabled: false }, { success: true }]) {
    const h = harness(), pending = h.publish(); await tick(); assert.equal(h.ports.length, 1);
    h.ack(0, reply); assert.equal(await pending, false); assert.equal(h.ports[0].disconnected, true);
  }
});

test('failed probe does not connect or send legacy true', async () => {
  const h = harness({ probeSuccess: false }); assert.equal(await h.publish(), false);
  assert.equal(h.ports.length, 0); assert.ok(h.messages.every(item => item.message.enabled !== true));
});

test('probe without document/navigation proof cannot open a port', async () => {
  const h = harness({ probeIdentity: false }); assert.equal(await h.publish(), false);
  assert.equal(h.ports.length, 0); assert.ok(h.messages.every(item => item.message.enabled !== true));
});

test('context replacement, URL mutation, or deactivation during probe prevents a late connection', async () => {
  for (const mutate of [
    h => { h.context.activePanelTabContext = { ...h.context.activePanelTabContext }; },
    h => { h.context.activePanelTabContext.url = 'https://www.cell.com/cell/fulltext/two'; },
    h => { h.context.activePanelTabContext.activated = false; }
  ]) {
    const h = harness(), release = h.pauseProbe(), pending = h.publish(); await tick();
    mutate(h); release(); assert.equal(await pending, false); assert.equal(h.ports.length, 0);
  }
});

test('context change while ACK is pending disconnects rather than accepting a stale ACK', async () => {
  const h = harness(), pending = h.publish(); await tick(); assert.equal(h.ports.length, 1);
  h.context.activePanelTabContext = { ...h.context.activePanelTabContext };
  h.ack(); assert.equal(await pending, false); assert.equal(h.ports[0].disconnected, true);
});

test('missing connect capability, connect errors and post errors fail closed without legacy true', async () => {
  for (const options of [{}, { connectThrows: true }, { postThrows: true }]) {
    const h = harness(options);
    if (!options.connectThrows && !options.postThrows) delete h.context.chrome.tabs.connect;
    assert.equal(await h.publish(), false);
    assert.ok(h.messages.every(item => item.message.enabled !== true)); assert.equal(h.retainedPorts(), 0);
  }
});
