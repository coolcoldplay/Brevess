const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createSemanticFindLauncher } = require('../core/semantic-find-launcher.js');

test('standalone J defers unrelated article preindex until a reader action needs it', async () => {
  let injected;
  const sender = { id: 'extension', frameId: 0, documentId: 'document-1', tab: { id: 12 }, url: 'https://pubmed.ncbi.nlm.nih.gov/' };
  const launcher = createSemanticFindLauncher({ chromeApi: {
    runtime: { id: 'extension' },
    webNavigation: { getFrame: async () => ({ documentId: sender.documentId, documentLifecycle: 'active', url: sender.url }) },
    tabs: { sendMessage: async () => ({ success: true }) }
  }, getShortcutKey: async () => 'J', ensureContent: async (_id, options) => { injected = options; } });
  assert.equal((await launcher.handle({ type: 'SEMANTIC_FIND_OPEN' }, sender)).success, true);
  assert.equal(injected.deferArticlePreindex, true);
});

test('standalone bootstrap consumes its one-shot preindex hint while normal reader still warms', () => {
  const content = fs.readFileSync(require.resolve('../content.js'), 'utf8');
  const tail = content.slice(content.indexOf('// The injector owns the document-wide claim'));
  for (const defer of [true, false, undefined]) {
    const calls = [];
    const context = { __brevessDeferArticlePreindex: defer, scheduleArticlePreindex: value => calls.push(value), console: { log() {} } };
    vm.runInNewContext(tail, context);
    assert.deepEqual(calls, defer === true ? [] : ['content-script-ready']);
    assert.equal(Object.hasOwn(context, '__brevessDeferArticlePreindex'), false);
  }
});
