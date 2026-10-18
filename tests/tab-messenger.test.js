const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createBackgroundNavigationHarness,
  createTabMessengerNavigationHarness
} = require('./helpers/tab-messenger-navigation-harness.js');

const PREINDEX_CONTENT_REVISION = require('../core/tab-messenger.js').CONTENT_SCRIPT_REVISION;
test('the actual content receiver announces the revision required by the background handshake', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '../content.js'), 'utf8');
  const assignment = source.match(/document\.documentElement\.dataset\.sciLlmContentRevision\s*=[\s\S]*?;/u);
  assert.ok(assignment, 'content receiver must announce its revision');
  const document = { documentElement: { dataset: {} } };
  require('node:vm').runInNewContext(assignment[0], { document });
  assert.equal(document.documentElement.dataset.sciLlmContentRevision, PREINDEX_CONTENT_REVISION);
});
const PREINDEX_PREDECESSOR_REVISION =
  '1.0.1-semantic-find-v1';

let messenger = {};
try {
  messenger = require('../core/tab-messenger.js');
} catch {
  // The first red run intentionally exercises the missing recovery module.
}

test('passive listeners returning no revision are recovered before bound business messages', async () => {
  const tabId = 9988, expectedUrl = 'https://example.test/passive-translation';
  const harness = createTabMessengerNavigationHarness({ tabId, url: expectedUrl,
    revision: PREINDEX_CONTENT_REVISION, receiver: false });
  const send = harness.chromeApi.tabs.sendMessage;
  harness.chromeApi.tabs.sendMessage = async (...args) => {
    if (!harness.current().receiver && args[1].action === 'getContentScriptRevision') return undefined;
    return send(...args);
  };
  harness.onAfterFiles(() => { harness.current().dataset.sciLlmContentRevision = PREINDEX_CONTENT_REVISION; });
  const result = await messenger.sendTabMessageWithRecovery(harness.chromeApi, tabId,
    { action: 'prepareManualAnnotations' }, { expectedUrl });
  assert.equal(result.success, true);
  assert.equal(harness.calls.filter(call => call.type === 'files').length, 1);
  assert.ok(harness.calls.filter(call => call.type === 'sendMessage')
    .find(call => call.message.action === 'prepareManualAnnotations').message.expectedDocumentIdentity);
});

test('queued recovery with another binding reuses the receiver established by the first injection', async()=>{
  const tabId=9941, expectedUrl='https://example.test/concurrent';
  const harness=createTabMessengerNavigationHarness({tabId,url:expectedUrl,
    revision:PREINDEX_CONTENT_REVISION,receiver:false});
  let release, started;
  const pending=new Promise(resolve=>{release=resolve;});
  const entered=new Promise(resolve=>{started=resolve;});
  harness.onBeforeFiles(async()=>{started();await pending;});
  harness.onAfterFiles(()=>{harness.current().dataset.sciLlmContentRevision=PREINDEX_CONTENT_REVISION;});
  const first=messenger.ensureContentScript(harness.chromeApi,tabId,{expectedUrl,contextKey:'warm-1'});
  await entered;
  const queued=messenger.ensureContentScript(harness.chromeApi,tabId,{expectedUrl});
  release();
  await Promise.all([first,queued]);
  assert.equal(harness.calls.filter(call=>call.type==='files').length,1,
    'a queued caller must probe again after the first receiver becomes ready');
});

test('background and sidebar contexts share one document injection despite different bindings', async()=>{
  const modulePath=require.resolve('../core/tab-messenger.js');
  const cached=require.cache[modulePath];
  delete require.cache[modulePath];
  const sidebarMessenger=require(modulePath);
  require.cache[modulePath]=cached;
  const tabId=9942,expectedUrl='https://example.test/sidebar-race';
  const harness=createTabMessengerNavigationHarness({tabId,url:expectedUrl,
    revision:PREINDEX_CONTENT_REVISION,receiver:false});
  let release,started,secondClaim;
  const pending=new Promise(resolve=>{release=resolve;});
  const entered=new Promise(resolve=>{started=resolve;});
  const inspected=new Promise(resolve=>{secondClaim=resolve;});
  let claims=0;
  const execute=harness.chromeApi.scripting.executeScript;
  harness.chromeApi.scripting.executeScript=async details=>{
    const result=await execute(details);
    if(details.func && details.args?.[0]===true && ++claims===2)secondClaim();
    return result;
  };
  harness.onBeforeFiles(async()=>{started();await pending;});
  harness.onAfterFiles(()=>{harness.current().dataset.sciLlmContentRevision=PREINDEX_CONTENT_REVISION;});
  const background=messenger.ensureContentScript(harness.chromeApi,tabId,{expectedUrl,contextKey:'navigation-5'});
  await entered;
  const sidebar=sidebarMessenger.ensureContentScript(harness.chromeApi,tabId,{expectedUrl,contextKey:'panel-context-2'});
  await inspected;
  release();
  await Promise.all([background,sidebar]);
  assert.equal(harness.calls.filter(call=>call.type==='files').length,1);
});

test('own PDF reader remains bound when activeTab metadata omits its URL', async () => {
  const expectedUrl = 'chrome-extension://brevess-test/pdf-reader.html?source=file%3A%2F%2F%2Fpaper.pdf';
  const harness = createTabMessengerNavigationHarness({ tabId: 9911, url: expectedUrl,
    revision: PREINDEX_CONTENT_REVISION });
  harness.chromeApi.runtime = { getURL: path => `chrome-extension://brevess-test/${path}` };
  harness.chromeApi.tabs.get = async () => ({ id: 9911, status: 'complete' });
  await messenger.ensureContentScriptForActivation(harness.chromeApi, 9911,
    { expectedUrl, contextKey: 'pdf-1' });
  const result = await messenger.sendTabMessageWithRecovery(harness.chromeApi, 9911,
    { action: 'extractArticleForLLM' }, { expectedUrl, contextKey: 'pdf-1' });
  assert.equal(result.success, true);
  harness.current().documentIdentity = 'a-replaced-document';
  await assert.rejects(messenger.sendTabMessageWithRecovery(harness.chromeApi, 9911,
    { action: 'extractArticleForLLM' }, { expectedUrl, contextKey: 'pdf-1' }), /TAB_MESSAGE_NAVIGATION_STALE/);
});

test('missing tab URLs cannot exempt web pages or a different extension from navigation guards', async () => {
  for (const [index, expectedUrl] of ['https://example.test/article',
    'chrome-extension://other-extension/pdf-reader.html'].entries()) {
    const tabId = 9920 + index;
    const harness = createTabMessengerNavigationHarness({ tabId, url: expectedUrl,
      revision: PREINDEX_CONTENT_REVISION });
    harness.chromeApi.runtime = { getURL: path => `chrome-extension://brevess-test/${path}` };
    harness.chromeApi.tabs.get = async () => ({ id: tabId, status: 'complete' });
    await assert.rejects(messenger.ensureContentScriptForActivation(harness.chromeApi, tabId,
      { expectedUrl }), /TAB_MESSAGE_NAVIGATION_STALE/);
    assert.equal(harness.calls.some(call => call.type === 'sendMessage'), false);
  }
});

test('reinjects the content script and retries when a tab has no message receiver', async () => {
  assert.equal(typeof messenger.sendTabMessageWithRecovery, 'function');

  const calls = [];
  let attempts = 0;
  const chromeApi = {
    tabs: {
      async sendMessage(tabId, message) {
        calls.push(['sendMessage', tabId, message.action]);
        if (message.action === 'getContentScriptRevision') {
          return { contentRevision: PREINDEX_CONTENT_REVISION };
        }
        attempts += 1;
        if (attempts === 1) {
          throw new Error('Could not establish connection. Receiving end does not exist.');
        }
        return { success: true };
      }
    },
    scripting: {
      async insertCSS(details) {
        calls.push(['insertCSS', details.target.tabId, details.files]);
      },
      async executeScript(details) {
        if (details.func) {
          calls.push(['injectionState', details.target.tabId, details.args]);
          return [{ result: details.args?.[0] ? 'claimed' : 'ready' }];
        }
        calls.push(['executeScript', details.target.tabId, details.files]);
      }
    }
  };

  const result = await messenger.sendTabMessageWithRecovery(
    chromeApi,
    42,
    { action: 'extractArticleForLLM' }
  );

  assert.deepEqual(result, { success: true });
  assert.deepEqual(calls.map(call => call[0]), [
    'injectionState',
    'sendMessage',
    'injectionState',
    'injectionState',
    'insertCSS',
    'executeScript',
    'injectionState',
    'sendMessage',
    'sendMessage'
  ]);
  assert.deepEqual(calls[4][2], ['content.css', 'semantic-find.css', 'bilingual-translation.css']);
  assert.deepEqual(calls[5][2], messenger.CONTENT_SCRIPT_FILES);
  assert.ok(
    calls[5][2].indexOf('core/article-structure.js') <
      calls[5][2].indexOf('core/article-extractor.js'),
    'article structure must load before article extraction'
  );
});

test('optional tab messages never inject a content script into inactive pages', async () => {
  let attempts = 0;
  const chromeApi = {
    tabs: {
      async sendMessage() {
        attempts += 1;
        throw new Error('Could not establish connection. Receiving end does not exist.');
      }
    }
  };
  const response = await messenger.sendTabMessageIfPresent(
    chromeApi,
    12,
    { action: 'setSidePanelShortcutScope', enabled: false }
  );
  assert.equal(response, null);
  assert.equal(attempts, 1);
});

test('Figure refresh hot-loads the latest extractor into an existing content world', async () => {
  const calls = [];
  const chromeApi = {
    scripting: {
      async executeScript(details) {
        calls.push(details);
        if (details.func) {
          return [{
            result: {
              revision: messenger.FIGURE_EXTRACTOR_REVISION,
              available: true,
              probeFigureId: 'figure-1',
              figures: [
                { figureId: 'figure-1', figureLabel: 'Figure 1' },
                { figureId: 'figure-2', figureLabel: 'Figure 2' }
              ]
            }
          }];
        }
        return [];
      }
    }
  };

  const result = await messenger.refreshFigureExtractorInTab(chromeApi, 42);

  assert.deepEqual(calls[0], {
    target: { tabId: 42 },
    files: ['core/supplemental-materials.js', 'core/figure-extractor.js']
  });
  assert.equal(typeof calls[1].func, 'function');
  assert.deepEqual(calls[1].args, [messenger.FIGURE_EXTRACTOR_REVISION]);
  assert.deepEqual(
    result.figures.map(figure => figure.figureId),
    ['figure-1', 'figure-2']
  );
  await assert.rejects(
    messenger.refreshFigureExtractorInTab(chromeApi, 'not-a-tab'),
    /INVALID_TAB_ID/
  );
});

test('Figure refresh fails loudly when the hot-loaded parser is not active', async () => {
  const chromeApi = {
    scripting: {
      async executeScript(details) {
        if (details.func) {
          return [{
            result: {
              available: true,
              probeFigureId: 'figure-360',
              figures: []
            }
          }];
        }
        return [];
      }
    }
  };

  await assert.rejects(
    messenger.refreshFigureExtractorInTab(chromeApi, 42),
    /FIGURE_EXTRACTOR_HOTLOAD_FAILED/
  );
});

test('recovery fails closed before redispatching a business message when its receiver omits the revision', async () => {
  const calls = [];
  let injected = false;
  const expectedUrl = 'https://publisher.example/article/a';
  const chromeApi = {
    tabs: {
      async get() {
        return { url: expectedUrl, status: 'complete' };
      },
      async sendMessage(_tabId, message) {
        calls.push(message.action);
        if (message.action === 'getContentScriptRevision') {
          if (!injected) {
            throw new Error('Could not establish connection. Receiving end does not exist.');
          }
          return { contentRevision: '' };
        }
        if (!injected) {
          throw new Error('Could not establish connection. Receiving end does not exist.');
        }
        return { success: true };
      }
    },
    scripting: {
      async insertCSS() {},
      async executeScript(details) {
        if (details.files) {
          injected = true;
          return [];
        }
        if (details.func && !details.args) return [{ result: '' }];
        return [{ result: details.args?.[0] ? 'claimed' : 'ready' }];
      }
    }
  };

  await assert.rejects(
    messenger.sendTabMessageWithRecovery(
      chromeApi,
      178,
      { action: 'extractArticleForLLM' },
      { expectedUrl, contextKey: 'generation-1' }
    ),
    /CONTENT_SCRIPT_RECEIVER_REVISION_MISMATCH/
  );
  assert.deepEqual(calls, [
    'getContentScriptRevision',
    'getContentScriptRevision'
  ]);
});

test('a bound message probes the live receiver identity before dispatching business work', async () => {
  const expectedUrl = 'https://publisher.example/article/a';
  const harness = createTabMessengerNavigationHarness({
    tabId: 179,
    url: expectedUrl,
    revision: PREINDEX_CONTENT_REVISION
  });
  harness.navigate(expectedUrl, {
    revision: PREINDEX_CONTENT_REVISION,
    navigationIdentity: 'https://publisher.example/article/b'
  });

  await assert.rejects(
    messenger.sendTabMessageWithRecovery(
      harness.chromeApi,
      179,
      { action: 'extractArticleForLLM' },
      { expectedUrl, contextKey: 'generation-1' }
    ),
    /CONTENT_SCRIPT_RECEIVER_IDENTITY_MISMATCH/
  );
  assert.deepEqual(harness.calls.map(call => [call.type, call.message?.action]), [
    ['pageFunction', undefined],
    ['sendMessage', 'getContentScriptRevision']
  ]);
});

test('a bound message rejects a receiver that omits its navigation identity', async () => {
  const expectedUrl = 'https://publisher.example/article/a';
  const harness = createTabMessengerNavigationHarness({
    tabId: 1791,
    url: expectedUrl,
    revision: PREINDEX_CONTENT_REVISION
  });
  harness.navigate(expectedUrl, {
    revision: PREINDEX_CONTENT_REVISION,
    navigationIdentity: undefined
  });

  await assert.rejects(
    messenger.sendTabMessageWithRecovery(
      harness.chromeApi,
      1791,
      { action: 'extractArticleForLLM' },
      { expectedUrl, contextKey: 'generation-1' }
    ),
    /CONTENT_SCRIPT_RECEIVER_IDENTITY_MISMATCH/
  );
  assert.equal(harness.calls.some(call =>
    call.type === 'sendMessage' && call.message.action === 'extractArticleForLLM'
  ), false);
});

test('a bound message rejects a receiver that omits its document identity', async () => {
  const expectedUrl = 'https://publisher.example/article/a';
  const harness = createTabMessengerNavigationHarness({
    tabId: 1792,
    url: expectedUrl,
    revision: PREINDEX_CONTENT_REVISION
  });
  harness.current().documentIdentity = undefined;

  await assert.rejects(
    messenger.sendTabMessageWithRecovery(
      harness.chromeApi,
      1792,
      { action: 'extractArticleForLLM' },
      { expectedUrl, contextKey: 'generation-1' }
    ),
    /CONTENT_SCRIPT_RECEIVER_DOCUMENT_IDENTITY_MISMATCH/
  );
  assert.equal(harness.calls.some(call =>
    call.type === 'sendMessage' && call.message.action === 'extractArticleForLLM'
  ), false);
});

test('a bound business message fails closed when navigation changes during dispatch', async () => {
  const articleA = 'https://publisher.example/article/a';
  const articleB = 'https://publisher.example/article/b';
  const harness = createTabMessengerNavigationHarness({
    tabId: 180,
    url: articleA,
    revision: PREINDEX_CONTENT_REVISION
  });
  harness.onBeforeBusinessMessage(async () => {
    harness.navigate(articleB, { revision: PREINDEX_CONTENT_REVISION });
  });

  await assert.rejects(
    messenger.sendTabMessageWithRecovery(
      harness.chromeApi,
      180,
      { action: 'warmArticleIndex' },
      { expectedUrl: articleA, contextKey: 'generation-1' }
    ),
    /TAB_MESSAGE_NAVIGATION_STALE/
  );
  const businessMessage = harness.calls.find(call =>
    call.type === 'sendMessage' && call.message.action === 'warmArticleIndex'
  )?.message;
  assert.equal(businessMessage?.expectedNavigationIdentity, articleA);
});

for (const [revisionIndex, predecessor] of [PREINDEX_PREDECESSOR_REVISION, '1.0.1-reliability-r29-evidence-v4', '1.0.1-reliability-r29-evidence-v5', '1.0.1-reliability-r29-evidence-v9', '1.0.1-reliability-r29-evidence-v10', '1.0.1-reliability-r30-evidence-v13'].entries())
test(`a bound ${predecessor} recovery reloads once and rehandshakes before business dispatch`, async () => {
  // Each browser tab owns a verification cache; a new fixture must not reuse
  // a predecessor case's already-verified tab/context tuple.
  const tabId = 1880 + revisionIndex;
  const expectedUrl = 'https://publisher.example/article/predecessor';
  const harness = createTabMessengerNavigationHarness({
    tabId,
    url: expectedUrl,
    revision: PREINDEX_CONTENT_REVISION,
    receiver: true
  });
  harness.current().dataset.sciLlmContentRevision = predecessor;
  harness.onAfterReload(async () => {
    harness.navigate(expectedUrl, {
      revision: '',
      receiver: false,
      dataset: {}
    });
  });

  const result = await messenger.sendTabMessageWithRecovery(
    harness.chromeApi,
    tabId,
    { action: 'warmArticleIndex' },
    { expectedUrl, contextKey: 'generation-2' }
  );

  assert.deepEqual(result, { success: true, action: 'warmArticleIndex' });
  assert.equal(harness.calls.filter(call => call.type === 'reload').length, 1);
  assert.equal(harness.calls.filter(call => call.type === 'files').length, 1);
  assert.equal(harness.calls.filter(call =>
    call.type === 'sendMessage' && call.message.action === 'getContentScriptRevision'
  ).length, 2);
  assert.equal(harness.calls.filter(call =>
    call.type === 'sendMessage' && call.message.action === 'warmArticleIndex'
  ).length, 1);
});

test('a bound predecessor recovery rejects a wrong or missing post-reload identity', async () => {
  for (const navigationIdentity of [
    'https://publisher.example/article/other',
    undefined
  ]) {
    const expectedUrl = 'https://publisher.example/article/predecessor';
    const harness = createTabMessengerNavigationHarness({
      tabId: 1802,
      url: expectedUrl,
      revision: PREINDEX_CONTENT_REVISION,
      receiver: true
    });
    harness.current().dataset.sciLlmContentRevision = PREINDEX_PREDECESSOR_REVISION;
    harness.onAfterReload(async () => {
      harness.navigate(expectedUrl, {
        revision: '',
        receiver: false,
        dataset: {}
      });
    });
    harness.onAfterFiles(async () => {
      harness.current().navigationIdentity = navigationIdentity;
    });

    await assert.rejects(
      messenger.sendTabMessageWithRecovery(
        harness.chromeApi,
        1802,
        { action: 'warmArticleIndex' },
        { expectedUrl, contextKey: 'generation-2' }
      ),
      /CONTENT_SCRIPT_RECEIVER_IDENTITY_MISMATCH/
    );
    assert.equal(harness.calls.filter(call => call.type === 'reload').length, 1);
    assert.equal(harness.calls.filter(call => call.type === 'files').length, 1);
    assert.equal(harness.calls.some(call =>
      call.type === 'sendMessage' && call.message.action === 'warmArticleIndex'
    ), false);
  }
});

test('a same-URL generation rebind rejects an older business send', async () => {
  const expectedUrl = 'https://publisher.example/article/reloaded';
  let currentGeneration = 4;
  const harness = createTabMessengerNavigationHarness({
    tabId: 1803,
    url: expectedUrl,
    revision: PREINDEX_CONTENT_REVISION
  });
  let handledMessages = 0;
  harness.onBeforeBusinessMessage(async () => {
    currentGeneration = 5;
    harness.navigate(expectedUrl, {
      revision: PREINDEX_CONTENT_REVISION,
      receiver: true
    });
  });
  harness.onBusinessMessage(() => { handledMessages += 1; });

  await assert.rejects(
    messenger.sendTabMessageWithRecovery(
      harness.chromeApi,
      1803,
      { action: 'warmArticleIndex' },
      {
        expectedUrl,
        contextKey: 'generation-4',
        isCurrent: () => currentGeneration === 4
      }
    ),
    /TAB_MESSAGE_NAVIGATION_STALE/
  );
  assert.equal(harness.calls.some(call => call.type === 'files'), false);
  assert.equal(handledMessages, 0);
});

test('the real background listener rejects an old tab generation after tab-id reuse', async () => {
  let resolveOldActivation;
  let activationChecks = 0;
  const harness = createBackgroundNavigationHarness({
    isTabActivated: () => {
      activationChecks += 1;
      if (activationChecks !== 1) return Promise.resolve(true);
      return new Promise(resolve => { resolveOldActivation = resolve; });
    }
  });

  await harness.emitUpdated(180, { status: 'complete' }, {
    id: 180, url: 'https://publisher.example/article/a', status: 'complete'
  });
  await harness.emitRemoved(180);
  await harness.emitUpdated(180, { status: 'complete' }, {
    id: 180, url: 'https://publisher.example/article/b', status: 'complete'
  });
  resolveOldActivation(true);
  await harness.flush();

  assert.deepEqual(
    harness.calls.filter(call => call.type === 'recoveryMessage')
      .map(call => call.args[2].expectedUrl),
    ['https://publisher.example/article/b']
  );
  assert.equal(
    harness.calls.filter(call => call.type === 'forget').length,
    3
  );
});

test('a wrong live receiver revision fails closed without reload, injection, or business work', async () => {
  const expectedUrl = 'https://publisher.example/article/a';
  const harness = createTabMessengerNavigationHarness({
    tabId: 181,
    url: expectedUrl,
    revision: 'forged-revision'
  });

  await assert.rejects(
    messenger.sendTabMessageWithRecovery(
      harness.chromeApi,
      181,
      { action: 'warmArticleIndex' },
      { expectedUrl, contextKey: 'generation-1' }
    ),
    /CONTENT_SCRIPT_RECEIVER_REVISION_MISMATCH/
  );
  assert.deepEqual(harness.calls.map(call => call.type), [
    'pageFunction',
    'sendMessage'
  ]);
});

test('a navigation drift during recovery cannot inject files into the replacement document', async () => {
  const articleA = 'https://publisher.example/article/a';
  const articleB = 'https://publisher.example/article/b?view=full';
  const harness = createTabMessengerNavigationHarness({
    tabId: 182,
    url: articleA,
    revision: '',
    receiver: false
  });
  harness.onBeforeCss(async () => {
    harness.navigate(articleB, { revision: '', receiver: false });
  });

  await assert.rejects(
    messenger.sendTabMessageWithRecovery(
      harness.chromeApi,
      182,
      { action: 'warmArticleIndex' },
      { expectedUrl: articleA, contextKey: 'generation-1' }
    ),
    /TAB_MESSAGE_NAVIGATION_STALE/
  );
  assert.equal(harness.calls.some(call => call.type === 'files'), false);
  assert.equal(harness.current().dataset[messenger.CONTENT_INJECTION_READY], undefined);
});

test('forget invalidates an in-flight recovery before it can inject into a reused tab id', async () => {
  const articleA = 'https://publisher.example/article/a';
  const articleB = 'https://publisher.example/article/b';
  let releaseCss;
  const cssGate = new Promise(resolve => { releaseCss = resolve; });
  const harness = createTabMessengerNavigationHarness({
    tabId: 183,
    url: articleA,
    revision: '',
    receiver: false
  });
  harness.onBeforeCss(() => cssGate);
  const pending = messenger.sendTabMessageWithRecovery(
    harness.chromeApi,
    183,
    { action: 'warmArticleIndex' },
    { expectedUrl: articleA, contextKey: 'generation-1' }
  );
  await new Promise(resolve => setImmediate(resolve));
  harness.navigate(articleB, { revision: '', receiver: false });
  messenger.forgetContentScriptState(183);
  releaseCss();

  await assert.rejects(pending, /TAB_MESSAGE_NAVIGATION_STALE/);
  assert.equal(harness.calls.some(call => call.type === 'files'), false);
  assert.equal(harness.current().dataset[messenger.CONTENT_INJECTION_READY], undefined);
});

test('coalesces concurrent recovery injection for the same tab', async () => {
  let receiverReady = false;
  let sendCount = 0;
  let cssCount = 0;
  let scriptCount = 0;
  const chromeApi = {
    tabs: {
      async sendMessage(_tabId, message) {
        if (message.action === 'getContentScriptRevision') {
          sendCount += 1;
          return { contentRevision: PREINDEX_CONTENT_REVISION };
        }
        sendCount += 1;
        if (!receiverReady) {
          throw new Error('Could not establish connection. Receiving end does not exist.');
        }
        return { success: true };
      }
    },
    scripting: {
      async insertCSS() {
        cssCount += 1;
        await new Promise(resolve => setImmediate(resolve));
      },
      async executeScript(details) {
        if (!details.args && !details.files) return [{ result: '' }];
        scriptCount += 1;
        if (scriptCount === 1) return [{ result: 'claimed' }];
        if (scriptCount === 2) receiverReady = true;
        return [{ result: 'ready' }];
      }
    }
  };

  const results = await Promise.all([
    messenger.sendTabMessageWithRecovery(chromeApi, 277, { action: 'first' }),
    messenger.sendTabMessageWithRecovery(chromeApi, 277, { action: 'second' })
  ]);

  assert.deepEqual(results, [{ success: true }, { success: true }]);
  assert.equal(cssCount, 1);
  assert.equal(scriptCount, 3);
  assert.equal(sendCount, 6);
});

test('waits for an injection claimed by another extension context', async () => {
  let receiverReady = false;
  let stateChecks = 0;
  let injectedFiles = 0;
  const chromeApi = {
    tabs: {
      async sendMessage(_tabId, message) {
        if (message.action === 'getContentScriptRevision') {
          return { contentRevision: PREINDEX_CONTENT_REVISION };
        }
        if (!receiverReady) {
          throw new Error('Could not establish connection. Receiving end does not exist.');
        }
        return { success: true };
      }
    },
    scripting: {
      async insertCSS() {
        throw new Error('the waiting context must not insert CSS');
      },
      async executeScript(details) {
        if (details.files) {
          injectedFiles += 1;
          return [];
        }
        stateChecks += 1;
        if (stateChecks === 1) return [{ result: 'waiting' }];
        receiverReady = true;
        return [{ result: 'ready' }];
      }
    }
  };

  const result = await messenger.sendTabMessageWithRecovery(
    chromeApi,
    91,
    { action: 'reuse-existing-injection' }
  );

  assert.deepEqual(result, { success: true });
  assert.equal(injectedFiles, 0);
  assert.equal(stateChecks, 3);
});

test('reloads and reinjects preindex when a live tab has the exact predecessor revision', async () => {
  const calls = [];
  let revision = PREINDEX_PREDECESSOR_REVISION;
  let receiverReady = true;
  const chromeApi = {
    tabs: {
      async sendMessage(_tabId, message) {
        calls.push(['sendMessage', message.action]);
        if (!receiverReady) {
          throw new Error('Could not establish connection. Receiving end does not exist.');
        }
        return { success: true, revision };
      },
      async reload(tabId) {
        calls.push(['reload', tabId]);
        receiverReady = false;
        revision = PREINDEX_CONTENT_REVISION;
      },
      async get() { return { status: 'complete' }; }
    },
    scripting: {
      async insertCSS() { calls.push(['insertCSS']); },
      async executeScript(details) {
        if (details.files) {
          receiverReady = true;
          calls.push(['executeScript', details.files]);
          return [];
        }
        if (details.func && !details.args) {
          return [{ result: revision }];
        }
        return [{ result: details.args?.[0] ? 'claimed' : 'ready' }];
      }
    }
  };

  const result = await messenger.sendTabMessageWithRecovery(
    chromeApi, 73, { action: 'askArticleWithLLM' }
  );

  assert.deepEqual(result, {
    success: true,
    revision: PREINDEX_CONTENT_REVISION
  });
  assert.equal(messenger.CONTENT_SCRIPT_REVISION, PREINDEX_CONTENT_REVISION);
  assert.equal(calls.filter(call => call[0] === 'reload').length, 1);
  const injection = calls.find(call => call[0] === 'executeScript');
  assert.ok(injection);
  assert.ok(injection[1].includes('core/article-preindex.js'));
  assert.equal(calls.filter(call => call[0] === 'sendMessage' &&
    call[1] === 'askArticleWithLLM').length, 1);
});

test('activation safety probe reuses a current live content world without reinjecting files', async () => {
  assert.equal(typeof messenger.ensureContentScriptForActivation, 'function');
  let fileInjectionCount = 0;
  let receiverChecks = 0;
  const chromeApi = {
    tabs: {
      async get() { return { status: 'complete' }; },
      async sendMessage(_tabId, message) {
        assert.deepEqual(message, { action: 'getContentScriptRevision' });
        receiverChecks += 1;
        return { contentRevision: PREINDEX_CONTENT_REVISION };
      }
    },
    scripting: {
      async executeScript(details) {
        if (details.files) {
          fileInjectionCount += 1;
          return [];
        }
        return [{ result: PREINDEX_CONTENT_REVISION }];
      },
      async insertCSS() {
        throw new Error('a current live content world must not receive CSS again');
      }
    }
  };

  await messenger.ensureContentScriptForActivation(chromeApi, 505);
  await messenger.ensureContentScriptForActivation(chromeApi, 505);
  assert.equal(fileInjectionCount, 0);
  assert.equal(receiverChecks, 2);
});

test('activation safety probe reinjects when a current DOM marker has no live receiver', async () => {
  let filesInjected = 0;
  let receiverAvailable = false;
  const chromeApi = {
    tabs: {
      async get() { return { status: 'complete' }; },
      async sendMessage(_tabId, message) {
        if (!receiverAvailable) {
          throw new Error('Could not establish connection. Receiving end does not exist.');
        }
        return { contentRevision: PREINDEX_CONTENT_REVISION };
      }
    },
    scripting: {
      async insertCSS() {},
      async executeScript(details) {
        if (details.files) {
          filesInjected += 1;
          receiverAvailable = true;
          return [];
        }
        if (details.func && !details.args) {
          return [{ result: PREINDEX_CONTENT_REVISION }];
        }
        return [{ result: details.args?.[0] ? 'claimed' : 'ready' }];
      }
    }
  };
  await messenger.ensureContentScriptForActivation(chromeApi, 506);
  assert.equal(filesInjected, 1);
});

test('a bound current marker with a missing receiver reinjects and rehandshakes', async () => {
  const expectedUrl = 'https://publisher.example/article/current';
  const harness = createTabMessengerNavigationHarness({
    tabId: 507,
    url: expectedUrl,
    revision: PREINDEX_CONTENT_REVISION,
    receiver: false
  });
  harness.current().dataset.sciLlmContentRevision = PREINDEX_CONTENT_REVISION;

  const result = await messenger.sendTabMessageWithRecovery(
    harness.chromeApi,
    507,
    { action: 'warmArticleIndex' },
    { expectedUrl, contextKey: 'generation-1' }
  );

  assert.deepEqual(result, { success: true, action: 'warmArticleIndex' });
  assert.equal(harness.calls.filter(call => call.type === 'files').length, 1);
  assert.equal(harness.calls.filter(call =>
    call.type === 'sendMessage' && call.message.action === 'getContentScriptRevision'
  ).length >= 3, true);
});

test('an arbitrary DOM revision marker authorizes neither reload nor injection', async () => {
  let reloads = 0;
  let injections = 0;
  let receiverAvailable = false;
  const chromeApi = {
    tabs: {
      async sendMessage(_tabId, message) {
        if (!receiverAvailable) {
          throw new Error('Could not establish connection. Receiving end does not exist.');
        }
        if (message.action === 'getContentScriptRevision') {
          return { contentRevision: PREINDEX_CONTENT_REVISION };
        }
        return { success: true };
      },
      async get() { return { status: 'complete' }; },
      async reload() { reloads += 1; }
    },
    scripting: {
      async insertCSS() {},
      async executeScript(details) {
        if (details.files) { injections += 1; receiverAvailable = true; return []; }
        if (details.func && !details.args) return [{ result: 'forged-revision' }];
        return [{ result: details.args?.[0] ? 'claimed' : 'ready' }];
      }
    }
  };
  await assert.rejects(
    messenger.sendTabMessageWithRecovery(chromeApi, 808, { action: 'warmArticleIndex' }),
    /CONTENT_SCRIPT_DOM_REVISION_MISMATCH/
  );
  assert.equal(reloads, 0);
  assert.equal(injections, 0);
});

test('a current bound receiver is reused without reload or reinjection', async () => {
  const expectedUrl = 'https://publisher.example/article/current';
  const harness = createTabMessengerNavigationHarness({
    tabId: 9073,
    url: expectedUrl,
    revision: PREINDEX_CONTENT_REVISION
  });
  const result = await messenger.sendTabMessageWithRecovery(
    harness.chromeApi,
    9073,
    { action: 'current-revision' },
    { expectedUrl, contextKey: 'generation-1' }
  );
  assert.deepEqual(result, { success: true, action: 'current-revision' });
  assert.equal(harness.calls.some(call => call.type === 'reload'), false);
  assert.equal(harness.calls.some(call => call.type === 'files'), false);
  assert.equal(
    harness.calls.find(call =>
      call.type === 'sendMessage' && call.message.action === 'current-revision'
    )?.message.expectedNavigationIdentity,
    expectedUrl
  );
});
