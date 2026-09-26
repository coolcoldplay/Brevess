const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const node = () => ({ textContent: '', value: '', disabled: false, hidden: false, dataset: {},
  setAttribute(key, value) { this[key] = value; }, focus() { this.focused = true; } });
function openApi(reply) {
  const source = read('options-local-library.js'), start = source.indexOf('  async function openArticleDirectory('), end = source.indexOf('  function coverageText(');
  assert.ok(start >= 0 && end > start, 'real document folder-open handler must exist');
  const nodes = { '[data-library-directory-status]': node(), '[data-library-directory-settings]': node(), '[data-library-directory-notice]': node() };
  const open = node(); open.dataset.workspaceId = 'workspace:one';
  const root = { querySelector: key => nodes[key], querySelectorAll: () => [open] };
  const state = { directoryOpening: '' }, calls = [];
  const chrome = { runtime: { sendMessage: async message => { calls.push(message); return reply(message); } } };
  const handler = new Function('state', 'chrome', source.slice(start, end) + ';return openArticleDirectory;')(state, chrome);
  return { run: () => handler(root, { workspaceId: 'workspace:one', title: '<img> Paper', directoryName: 'UNTRUSTED', url: 'file:///private' }), nodes, open, calls };
}
function nativeApi(call) {
  const source = read('options.js');
  const start = source.indexOf('// Native directory binding UI: start.');
  const end = source.indexOf('// Native directory binding UI: end.');
  assert.ok(start >= 0 && end > start, 'explicit native directory settings must exist');
  const nodes = Object.fromEntries(['nativeDirectoryPath', 'nativeDirectoryStatus', 'bindNativeDirectory', 'checkNativeDirectory', 'nativeDirectorySettings'].map(key => [key, node()]));
  const calls = [], pending = [], pages = [];
  const api = new Function('document', 'callBackground', 'userDataUi', 'setUserDataActionPending', 'activateSettingsPage',
    source.slice(start, end) + ';return {bindNativeDirectory, refreshNativeDirectoryStatus};')(
      { getElementById: key => nodes[key] }, async message => { calls.push(message); return call(message); },
      { pendingAction: false }, value => pending.push(value), value => pages.push(value));
  return { ...api, nodes, calls, pending };
}
test('open sends only stable workspace identity and suppresses double clicks', async () => {
  let finish; const wait = new Promise(resolve => { finish = resolve; });
  const ui = openApi(() => wait); const first = ui.run(); await ui.run();
  assert.deepEqual(ui.calls, [{ type: 'LOCAL_READING_LIBRARY_OPEN_DIRECTORY', workspaceId: 'workspace:one' }]);
  assert.equal(ui.open.disabled, true);
  finish({ success: true, data: { opened: true } }); await first;
  assert.equal(ui.open.disabled, false);
  assert.match(ui.nodes['[data-library-directory-status]'].textContent, /已请求系统打开/);
});
test('backend failure stays literal and offers directory settings without claiming success', async () => {
  const ui = openApi(() => ({ success: false, error: { code: 'ROOT_MISMATCH', message: '目录不匹配 <b>保留原文</b>', retryable: false } }));
  await ui.run();
  const status = ui.nodes['[data-library-directory-status]'].textContent;
  assert.match(status, /目录不匹配 <b>保留原文<\/b>/);
  assert.doesNotMatch(status, /已请求系统打开|已打开/);
  assert.equal(ui.nodes['[data-library-directory-settings]'].hidden, false);
  assert.equal(ui.open.disabled, false);
});
test('success envelope without opened true never announces an opened folder', async () => {
  for (const data of [{}, { opened: false }, { opened: 'true' }]) {
    const ui = openApi(() => ({ success: true, data })); await ui.run();
    assert.doesNotMatch(ui.nodes['[data-library-directory-status]'].textContent, /已请求系统打开|已打开/);
  }
});
test('binding is explicit, keeps path on failure, and never guesses a path or opens a picker', async () => {
  const ui = nativeApi(() => { throw Object.assign(new Error('指定路径与当前保存目录不匹配'), { code: 'ROOT_MISMATCH' }); });
  ui.nodes.nativeDirectoryPath.value = 'D:\\研究资料\\Brevess';
  assert.equal(ui.calls.length, 0);
  await ui.bindNativeDirectory();
  assert.deepEqual(ui.calls, [{ type: 'USER_DATA_DIRECTORY_NATIVE_BIND', absolutePath: 'D:\\研究资料\\Brevess' }]);
  assert.equal(ui.nodes.nativeDirectoryPath.value, 'D:\\研究资料\\Brevess');
  assert.match(ui.nodes.nativeDirectoryStatus.textContent, /指定路径与当前保存目录不匹配/);
  assert.equal(ui.nodes.bindNativeDirectory.disabled, false);
});
test('empty binding input makes no native call and bound false is not a successful bind', async () => {
  const ui = nativeApi(() => ({ bound: false, rootName: 'Only a name' }));
  await ui.bindNativeDirectory(); assert.equal(ui.calls.length, 0);
  ui.nodes.nativeDirectoryPath.value = 'D:\\资料'; await ui.bindNativeDirectory();
  assert.doesNotMatch(ui.nodes.nativeDirectoryStatus.textContent, /绑定成功/);
});
test('status check is read-only and never replaces the user absolute-path draft with a basename', async () => {
  const ui = nativeApi(() => ({ available: true, bound: true, rootName: 'Brevess' }));
  ui.nodes.nativeDirectoryPath.value = 'D:\\用户尚未提交'; await ui.refreshNativeDirectoryStatus();
  assert.deepEqual(ui.calls, [{ type: 'USER_DATA_DIRECTORY_NATIVE_STATUS' }]);
  assert.equal(ui.nodes.nativeDirectoryPath.value, 'D:\\用户尚未提交');
  assert.match(ui.nodes.nativeDirectoryStatus.textContent, /Brevess/);
});

test('pending bind suppresses repeated bind and status, then unlocks every control', async () => {
  let finish; const reply = new Promise(resolve => { finish = resolve; });
  const ui = nativeApi(() => reply);
  ui.nodes.nativeDirectoryPath.value = 'D:\\资料\\Brevess';
  const first = ui.bindNativeDirectory();
  await ui.bindNativeDirectory(); await ui.refreshNativeDirectoryStatus();
  assert.equal(ui.calls.length, 1);
  for (const key of ['nativeDirectoryPath', 'bindNativeDirectory', 'checkNativeDirectory']) assert.equal(ui.nodes[key].disabled, true);
  finish({ bound: true, rootName: 'Brevess' }); await first;
  for (const key of ['nativeDirectoryPath', 'bindNativeDirectory', 'checkNativeDirectory']) assert.equal(ui.nodes[key].disabled, false);
  assert.deepEqual(ui.pending, [true, false]);
});

test('unavailable and outdated helper status preserves precise backend message and code', async () => {
  const ui = nativeApi(() => ({ available: false, bound: false, code: 'WORKSPACE_DIRECTORY_HOST_UPDATE_REQUIRED', message: '请更新本机助手 <b>原文</b>' }));
  await ui.refreshNativeDirectoryStatus();
  assert.equal(ui.nodes.nativeDirectoryStatus.textContent, '请更新本机助手 <b>原文</b>（WORKSPACE_DIRECTORY_HOST_UPDATE_REQUIRED）');
  assert.notEqual(ui.nodes.nativeDirectoryStatus.dataset.state, 'success');
  assert.equal(ui.calls.length, 1);
});

test('timeout opens no automatic retry and releases busy state', async () => {
  const ui = openApi(() => { throw Object.assign(new Error('未获系统打开确认，请先查看文件管理器'), { code: 'WORKSPACE_DIRECTORY_TIMEOUT' }); });
  await ui.run(); await Promise.resolve();
  assert.equal(ui.calls.length, 1);
  assert.equal(ui.open.disabled, false);
  assert.match(ui.nodes['[data-library-directory-status]'].textContent, /未获系统打开确认/);
  assert.doesNotMatch(ui.nodes['[data-library-directory-status]'].textContent, /已请求系统打开|已打开/);
});

test('malformed helper status is not reported as a successful capability check', async () => {
  for (const reply of [{}, { available: 'true', bound: true }, { available: true, bound: 'false' }]) {
    const ui = nativeApi(() => reply); await ui.refreshNativeDirectoryStatus();
    assert.equal(ui.nodes.nativeDirectoryStatus.dataset.state, 'error');
    assert.match(ui.nodes.nativeDirectoryStatus.textContent, /未收到有效的助手状态/);
    assert.equal(ui.nodes.checkNativeDirectory.disabled, false);
  }
});
