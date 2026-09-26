const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const { createSemanticFindLauncher } = require('../core/semantic-find-launcher.js');

function backgroundFixture() {
  const calls = [];
  let documentId = 'document-1';
  const sender = { id: 'extension', frameId: 0, documentId,
    tab: { id: 8 }, url: 'https://example.org/article' };
  const chromeApi = {
    runtime: { id: 'extension' },
    tabs: { sendMessage: async (...args) => { calls.push(['open', ...args]); return { success: true }; } },
    webNavigation: { getFrame: async () => ({
      documentId, frameId: 0, url: sender.url, documentLifecycle: 'active'
    }) }
  };
  const launcher = createSemanticFindLauncher({
    chromeApi, getShortcutKey: async () => 'K',
    ensureContent: async (...args) => { calls.push(['inject', ...args]); }
  });
  return { launcher, sender, calls, chromeApi, navigate: () => { documentId = 'document-2'; } };
}
test('standalone opening loads the reader in the requesting document without sidebar activation', async () => {
  const f = backgroundFixture();
  assert.deepEqual(await f.launcher.handle({ type: 'SEMANTIC_FIND_GET_SHORTCUT' }, f.sender),
    { success: true, key: 'K' });
  assert.equal(f.calls.length, 0);
  assert.equal((await f.launcher.handle({ type: 'SEMANTIC_FIND_OPEN' }, f.sender)).success, true);
  assert.equal(f.calls[0][0], 'inject');
  assert.equal(f.calls[0][1], 8);
  assert.equal(f.calls[0][2].expectedUrl, f.sender.url);
  assert.deepEqual(f.calls[1], ['open', 8, { action: 'openSemanticFind' }, { documentId: 'document-1' }]);
});
test('untrusted callers and frames cannot request reader injection', async () => {
  for (const patch of [{ id: 'other' }, { frameId: 1 }, { documentId: '' },
    { url: 'chrome://settings' }, { tab: null }]) {
    const f = backgroundFixture();
    assert.equal((await f.launcher.handle({ type: 'SEMANTIC_FIND_OPEN' }, { ...f.sender, ...patch })).success, false);
    assert.equal(f.calls.length, 0);
  }
});
test('same-URL document replacement cannot open the new document', async () => {
  const f = backgroundFixture();
  const launcher = createSemanticFindLauncher({
    chromeApi: f.chromeApi, getShortcutKey: async () => 'J',
    ensureContent: async () => f.navigate()
  });
  assert.equal((await launcher.handle({ type: 'SEMANTIC_FIND_OPEN' }, f.sender)).success, false);
  assert.equal(f.calls.length, 0);
});
test('receiver failures remain visible to the shortcut caller', async () => {
  const f = backgroundFixture();
  f.chromeApi.tabs.sendMessage = async () => ({ success: false });
  assert.equal((await f.launcher.handle({ type: 'SEMANTIC_FIND_OPEN' }, f.sender)).success, false);
});

async function pageFixture(key = 'J') {
  const handlers = {}, calls = [];
  let changed;
  class Element { closest() { return this.editable ? {} : null; } }
  const context = { Element, console, globalThis: null,
    document: { addEventListener: (name, handler) => { handlers[name] = handler; } },
    chrome: {
      runtime: { sendMessage: async message => {
        calls.push(message.type);
        return message.type === 'SEMANTIC_FIND_GET_SHORTCUT' ? { success: true, key } : { success: true };
      } },
      storage: { onChanged: { addListener: handler => { changed = handler; } } }
    }
  };
  context.globalThis = context;
  vm.runInNewContext(fs.readFileSync(path.join(root, 'semantic-find-launcher.js'), 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  return {
    calls, context, changeKey: async value => { key = value; changed({ sciLlmSettingsV2: {} }, 'local');
      await new Promise(resolve => setImmediate(resolve)); },
    press: async (overrides = {}) => {
      const event = { key: 'j', target: new Element(),
        preventDefault() { this.prevented = true; }, stopImmediatePropagation() {},
        ...overrides };
      handlers.keydown(event);
      await new Promise(resolve => setImmediate(resolve));
      return event;
    }, Element
  };
}
test('lightweight listener opens once on J and yields to an existing full reader', async () => {
  const f = await pageFixture();
  assert.equal((await f.press()).prevented, true);
  assert.equal(f.calls.filter(type => type === 'SEMANTIC_FIND_OPEN').length, 1);
  f.context.__brevessSemanticFind = {};
  assert.equal((await f.press()).prevented, undefined);
  assert.equal(f.calls.filter(type => type === 'SEMANTIC_FIND_OPEN').length, 1);
});
test('typing, IME, modifiers, repeats and consumed events do not launch', async () => {
  const f = await pageFixture();
  const editable = new f.Element(); editable.editable = true;
  for (const event of [{ target: editable }, { isComposing: true }, { ctrlKey: true },
    { altKey: true }, { metaKey: true }, { repeat: true }, { defaultPrevented: true }, { key: 'x' }]) {
    assert.equal((await f.press(event)).prevented, undefined);
  }
  assert.equal(f.calls.filter(type => type === 'SEMANTIC_FIND_OPEN').length, 0);
});
test('saved remapping and disabling work before the reader exists', async () => {
  const f = await pageFixture('K');
  assert.equal((await f.press()).prevented, undefined);
  assert.equal((await f.press({ key: 'k' })).prevented, true);
  await f.changeKey('');
  assert.equal((await f.press({ key: 'k' })).prevented, undefined);
});
