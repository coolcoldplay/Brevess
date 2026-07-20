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
    'insertCSS',
    'executeScript',
    'sendMessage'
  ]);
  assert.deepEqual(calls[1][2], ['content.css']);
  assert.deepEqual(calls[2][2], messenger.CONTENT_SCRIPT_FILES);
  assert.ok(
    calls[2][2].indexOf('core/article-structure.js') <
      calls[2][2].indexOf('core/article-extractor.js'),
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
        receiverReady = true;
      }
    }
  };

  const results = await Promise.all([
    messenger.sendTabMessageWithRecovery(chromeApi, 77, { action: 'first' }),
    messenger.sendTabMessageWithRecovery(chromeApi, 77, { action: 'second' })
  ]);

  assert.deepEqual(results, [{ success: true }, { success: true }]);
  assert.equal(cssCount, 1);
  assert.equal(scriptCount, 1);
  assert.equal(sendCount, 4);
});
