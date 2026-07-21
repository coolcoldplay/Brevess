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

function createFakePort(handlePost) {
  const messageListeners = [];
  const disconnectListeners = [];
  return {
    onMessage: { addListener(listener) { messageListeners.push(listener); } },
    onDisconnect: { addListener(listener) { disconnectListeners.push(listener); } },
    postMessage(message) { handlePost(message, value => messageListeners.forEach(fn => fn(value))); },
    disconnect() { disconnectListeners.forEach(listener => listener()); }
  };
}

test('streams ordered worker chunks without buffering the full provider response', async () => {
  const { createOffscreenFetch } = loadApi();
  const posted = [];
  const chromeApi = {
    runtime: {
      getURL: pathName => `chrome-extension://extension-id/${pathName}`,
      async getContexts() { return [{ contextType: 'OFFSCREEN_DOCUMENT' }]; },
      connect() {
        return createFakePort((message, emit) => {
          posted.push(message);
          if (message.type !== 'SCI_OFFSCREEN_FETCH_STREAM') return;
          queueMicrotask(() => {
            emit({ requestId: message.requestId, type: 'started', status: 200, ok: true });
            emit({ requestId: message.requestId, type: 'chunk', text: 'data: first\n\n' });
            emit({ requestId: message.requestId, type: 'chunk', text: 'data: second\n\n' });
            emit({ requestId: message.requestId, type: 'completed' });
          });
        });
      }
    },
    offscreen: { async createDocument() {} }
  };
  const fetchImpl = createOffscreenFetch(chromeApi, {
    requestIdFactory: () => 'stream-request-1'
  });

  const events = [];
  for await (const event of fetchImpl.stream('https://api.example/v1/chat', {
    method: 'POST', body: '{}'
  })) events.push(event);

  assert.deepEqual(events.map(event => event.type), [
    'started', 'chunk', 'chunk', 'completed'
  ]);
  assert.equal(events[1].text, 'data: first\n\n');
  assert.equal(posted[0].options.signal, undefined);
  assert.equal(posted[0].requestId, 'stream-request-1');
});

test('aborting an offscreen stream sends cancellation to the network worker', async () => {
  const { createOffscreenFetch } = loadApi();
  const posted = [];
  const chromeApi = {
    runtime: {
      getURL: pathName => `chrome-extension://extension-id/${pathName}`,
      async getContexts() { return [{ contextType: 'OFFSCREEN_DOCUMENT' }]; },
      connect() {
        return createFakePort((message, emit) => {
          posted.push(message);
          if (message.type === 'SCI_OFFSCREEN_FETCH_STREAM') {
            queueMicrotask(() => emit({
              requestId: message.requestId, type: 'started', status: 200, ok: true
            }));
          }
          if (message.type === 'SCI_OFFSCREEN_FETCH_CANCEL') {
            queueMicrotask(() => emit({ requestId: message.requestId, type: 'cancelled' }));
          }
        });
      }
    },
    offscreen: { async createDocument() {} }
  };
  const controller = new AbortController();
  const iterator = createOffscreenFetch(chromeApi, {
    requestIdFactory: () => 'stream-request-2'
  }).stream('https://api.example/v1/chat', { signal: controller.signal })[Symbol.asyncIterator]();

  assert.equal((await iterator.next()).value.type, 'started');
  const terminal = iterator.next();
  controller.abort();
  assert.equal((await terminal).value.type, 'cancelled');
  assert.equal(posted.at(-1).type, 'SCI_OFFSCREEN_FETCH_CANCEL');
  assert.equal(posted.at(-1).requestId, 'stream-request-2');
});

test('offscreen worker stream branch reads response chunks and bounds each event', () => {
  const worker = fs.readFileSync(
    path.join(__dirname, '..', 'offscreen-network-worker.js'), 'utf8'
  );
  const bridge = fs.readFileSync(path.join(__dirname, '..', 'offscreen.js'), 'utf8');
  assert.match(worker, /message\.type === 'stream'/);
  assert.match(worker, /response\.body\?\.getReader/);
  assert.match(worker, /MAX_STREAM_EVENT_BYTES/);
  assert.match(worker, /controllers\.get\(message\.requestId\)\?\.abort\(\)/);
  assert.match(bridge, /chrome\.runtime\.onConnect/);
  assert.match(bridge, /SCI_OFFSCREEN_FETCH_STREAM/);
});

test('offscreen worker preserves only a bounded HTTP error body for token-limit classification', () => {
  const worker = fs.readFileSync(
    path.join(__dirname, '..', 'offscreen-network-worker.js'), 'utf8'
  );

  assert.match(worker, /MAX_ERROR_RESPONSE_BYTES\s*=\s*16\s*\*\s*1024/);
  assert.match(worker, /readBoundedResponseText\(response\)/);
  assert.match(worker, /body\s*=\s*await readBoundedResponseText\(response\)/);
  assert.match(worker, /status:\s*response\.status,\s*\n\s*body,/);
  assert.doesNotMatch(worker, /status:\s*response\.status,\s*\n\s*body:\s*''/);
});
