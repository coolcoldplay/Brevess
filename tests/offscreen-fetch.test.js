const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const modulePath = path.join(__dirname, '..', 'core', 'offscreen-fetch.js');

function loadApi() {
  assert.equal(fs.existsSync(modulePath), true, 'offscreen fetch module must exist');
  return require(modulePath);
}

test('creates one hidden worker document and returns a Response-like result', async () => {
  const { createOffscreenFetch } = loadApi();
  const created = [];
  const messages = [];
  let contexts = [];
  const chromeApi = {
    runtime: {
      getURL: pathName => `chrome-extension://extension-id/${pathName}`,
      async getContexts() { return contexts; },
      async sendMessage(message) {
        messages.push(message);
        return { success: true, status: 200, body: '{"ok":true}' };
      }
    },
    offscreen: {
      async createDocument(options) {
        created.push(options);
        contexts = [{ contextType: 'OFFSCREEN_DOCUMENT' }];
      }
    }
  };
  const fetchImpl = createOffscreenFetch(chromeApi, { requestIdFactory: () => 'request-1' });

  const response = await fetchImpl('https://api.example/v1/chat', {
    method: 'POST', headers: { Authorization: 'Bearer internal' }, body: '{}'
  });

  assert.equal(created.length, 1);
  assert.deepEqual(created[0].reasons, ['WORKERS']);
  assert.equal(created[0].url, 'offscreen.html');
  assert.match(created[0].justification, /provider network requests/i);
  assert.equal(messages[0].target, 'sci-offscreen-network');
  assert.equal(messages[0].requestId, 'request-1');
  assert.equal(messages[0].options.signal, undefined);
  assert.equal(response.ok, true);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), '{"ok":true}');
});

test('preserves a response-body stream failure for provider diagnostics', async () => {
  const { createOffscreenFetch } = loadApi();
  const chromeApi = {
    runtime: {
      getURL: pathName => `chrome-extension://extension-id/${pathName}`,
      async getContexts() { return [{ contextType: 'OFFSCREEN_DOCUMENT' }]; },
      async sendMessage() {
        return {
          success: false,
          stage: 'response-body',
          status: 200,
          error: { name: 'TypeError', message: 'Failed to fetch' }
        };
      }
    },
    offscreen: { async createDocument() {} }
  };
  const fetchImpl = createOffscreenFetch(chromeApi, { requestIdFactory: () => 'request-2' });

  const response = await fetchImpl('https://api.example/v1/chat', {});

  assert.equal(response.ok, true);
  assert.equal(response.status, 200);
  await assert.rejects(response.text(), error =>
    error.name === 'TypeError' && error.message === 'Failed to fetch'
  );
});

test('forwards Retry-After metadata from the network worker', async () => {
  const { createOffscreenFetch } = loadApi();
  const chromeApi = {
    runtime: {
      getURL: pathName => `chrome-extension://extension-id/${pathName}`,
      async getContexts() { return [{ contextType: 'OFFSCREEN_DOCUMENT' }]; },
      async sendMessage() {
        return { success: true, status: 503, body: '', retryAfter: '9' };
      }
    },
    offscreen: { async createDocument() {} }
  };
  const response = await createOffscreenFetch(chromeApi)('https://api.example/v1/chat', {});
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('Retry-After'), '9');
});
