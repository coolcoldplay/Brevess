const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('Enter keeps a sole selected external source and restores native QA only after clearing selection', () => {
  const listeners = {}, question = {}, sent = [];
  let submitCount = 0;
  const form = { requestSubmit() { submitCount++; } };
  const listener = { addListener() {} };
  const context = {
    window: { addEventListener(name, fn) { (listeners[name] ||= []).push(fn); } },
    document: { readyState: 'loading', documentElement: {}, addEventListener() {}, getElementById(id) { return id === 'articleChatForm' ? form : question; } },
    chrome: { runtime: { onMessage: listener }, tabs: { onActivated: listener, onUpdated: listener, onRemoved: listener } },
    MutationObserver: class { observe() {} },
  };
  vm.createContext(context);
  const source = fs.readFileSync(require.resolve('../extension/web-filters-general/compare-composer.js'), 'utf8');
  vm.runInContext(source.replace(/\}\)\(\);\s*$/, 'window.inspect = s => { current = s; return payload(s); }; })();'), context);
  const enter = () => listeners.keydown[0]({ target: question, key: 'Enter', preventDefault() { sent.push('prevented'); }, stopImmediatePropagation() {} });
  const request = context.window.inspect({ tabId: 1, explicitSources: true, sources: [{ id: 2, number: 2 }] });
  assert.deepEqual(Array.from(request.tabIds), [2]);
  assert.deepEqual(Array.from(request.sourceNumbers), [2]);
  enter(); assert.equal(submitCount, 1);
  context.WFGWorkflow = { isDisplay: () => true };
  enter();
  const editing = { target: question, stopImmediatePropagation() { assert.fail('display commands were intercepted'); } };
  listeners.input[0](editing);
  listeners.submit[0]({ ...editing, target: form });
  assert.equal(submitCount, 1);
  context.WFGWorkflow = { isDisplay: () => false };
  context.window.inspect({ tabId: 1, explicitSources: true, sources: [] });
  enter(); assert.equal(submitCount, 1);
  context.window.inspect({ tabId: 1, sources: [{ id: 1, number: 1 }] });
  enter(); assert.equal(submitCount, 1);
  assert.equal(sent.length, 1);
});
