const test = require('node:test');
const assert = require('node:assert/strict');

let messenger = {};
try {
  messenger = require('../core/tab-messenger.js');
} catch {
  // The first red run intentionally exercises the missing recovery module.
}

test('reinjects the content script and retries when a tab has no message receiver', async () => {
  assert.equal(typeof messenger.sendTabMessageWithRecovery, 'function');

  const calls = [];
  let attempts = 0;
  const chromeApi = {
    tabs: {
      async sendMessage(tabId, message) {
        calls.push(['sendMessage', tabId, message.action]);
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
    'sendMessage',
    'injectionState',
    'insertCSS',
    'executeScript',
    'injectionState',
    'sendMessage'
  ]);
  assert.deepEqual(calls[2][2], ['content.css']);
  assert.deepEqual(calls[3][2], messenger.CONTENT_SCRIPT_FILES);
  assert.ok(
    calls[3][2].indexOf('core/article-structure.js') <
      calls[3][2].indexOf('core/article-extractor.js'),
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
    files: ['core/figure-extractor.js']
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

test('stale DOM revision markers never suppress reinjection after a receiver failure', async () => {
  const dataset = {
    sciLlmContentRevision: '2.4.0-article-workspaces-r2',
    [messenger.CONTENT_INJECTION_READY]: messenger.CONTENT_SCRIPT_REVISION,
    [messenger.CONTENT_INJECTION_CLAIM]: messenger.CONTENT_SCRIPT_REVISION
  };
  let injected = false;
  let scriptCount = 0;
  const chromeApi = {
    tabs: {
      async sendMessage() {
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
          scriptCount += 1;
          assert.ok(details.files.includes('core/result-validator.js'));
          injected = true;
          return [];
        }
        const previousDocument = global.document;
        global.document = { documentElement: { dataset } };
        try {
          return [{ result: details.func(...(details.args || [])) }];
        } finally {
          if (previousDocument === undefined) delete global.document;
          else global.document = previousDocument;
        }
      }
    }
  };

  const result = await messenger.sendTabMessageWithRecovery(
    chromeApi,
    77,
    { action: 'extractArticleForLLM' }
  );

  assert.deepEqual(result, { success: true });
  assert.equal(scriptCount, 1);
  assert.equal(
    dataset[messenger.CONTENT_INJECTION_READY],
    messenger.CONTENT_SCRIPT_REVISION
  );
  assert.equal(dataset[messenger.CONTENT_INJECTION_CLAIM], undefined);
});

test('coalesces concurrent recovery injection for the same tab', async () => {
  let receiverReady = false;
  let sendCount = 0;
  let cssCount = 0;
  let scriptCount = 0;
  const chromeApi = {
    tabs: {
      async sendMessage() {
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
      async executeScript() {
        scriptCount += 1;
        if (scriptCount === 1) return [{ result: 'claimed' }];
        if (scriptCount === 2) receiverReady = true;
        return [{ result: 'ready' }];
      }
    }
  };

  const results = await Promise.all([
    messenger.sendTabMessageWithRecovery(chromeApi, 77, { action: 'first' }),
    messenger.sendTabMessageWithRecovery(chromeApi, 77, { action: 'second' })
  ]);

  assert.deepEqual(results, [{ success: true }, { success: true }]);
  assert.equal(cssCount, 1);
  assert.equal(scriptCount, 3);
  assert.equal(sendCount, 4);
});

test('waits for an injection claimed by another extension context', async () => {
  let receiverReady = false;
  let stateChecks = 0;
  let injectedFiles = 0;
  const chromeApi = {
    tabs: {
      async sendMessage() {
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
  assert.equal(stateChecks, 2);
});
