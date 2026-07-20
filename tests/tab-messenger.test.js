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
