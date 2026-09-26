const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { requestText } = require('../providers/provider-utils.js');

const modulePath = path.join(__dirname, '..', 'core', 'offscreen-fetch.js');

function loadApi() {
  assert.equal(fs.existsSync(modulePath), true, 'offscreen fetch module must exist');
  return require(modulePath);
}

function loadNetworkWorker(fetchImpl) {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'offscreen-network-worker.js'), 'utf8'
  );
  const messages = [];
  const self = { postMessage(value) { messages.push(value); } };
  vm.runInNewContext(source, {
    self,
    fetch: fetchImpl,
    AbortController,
    TextDecoder,
    TextEncoder,
    Uint8Array
  }, { filename: 'offscreen-network-worker.js' });
  return {
    messages,
    async send(data) { await self.onmessage({ data }); }
  };
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

test('forwards Content-Type metadata so login pages are distinguishable from APIs', async () => {
  const { createOffscreenFetch } = loadApi();
  const chromeApi = {
    runtime: {
      getURL: pathName => `chrome-extension://extension-id/${pathName}`,
      async getContexts() { return [{ contextType: 'OFFSCREEN_DOCUMENT' }]; },
      async sendMessage() {
        return {
          success: true, status: 200, body: '<html>Campus login</html>',
          contentType: 'text/html; charset=utf-8'
        };
      }
    },
    offscreen: { async createDocument() {} }
  };
  const response = await createOffscreenFetch(chromeApi)('https://api.example/test', {});
  assert.equal(response.headers.get('Content-Type'), 'text/html; charset=utf-8');
});

test('non-stream offscreen fetch rechecks abort after listener registration and keeps it first', async () => {
  const { createOffscreenFetch } = loadApi();
  const posted = [];
  let abortedReads = 0;
  let listenerAdds = 0;
  let listenerRemoves = 0;
  const signal = {
    get aborted() {
      abortedReads += 1;
      return abortedReads >= 2;
    },
    addEventListener(type) {
      assert.equal(type, 'abort');
      listenerAdds += 1;
    },
    removeEventListener(type) {
      assert.equal(type, 'abort');
      listenerRemoves += 1;
    }
  };
  const chromeApi = {
    runtime: {
      getURL: pathName => `chrome-extension://extension-id/${pathName}`,
      async getContexts() { return [{ contextType: 'OFFSCREEN_DOCUMENT' }]; },
      sendMessage(message) {
        posted.push(message);
        if (message.type === 'SCI_OFFSCREEN_FETCH_CANCEL') {
          throw new Error('private unavailable cancel transport');
        }
        return Promise.resolve({ success: true, status: 200, body: '{"late":true}' });
      }
    },
    offscreen: { async createDocument() {} }
  };

  await assert.rejects(
    () => createOffscreenFetch(chromeApi, {
      requestIdFactory: () => 'non-stream-listener-race'
    })('https://api.example/test', { signal }),
    error => error.name === 'AbortError'
  );
  assert.equal(abortedReads, 2);
  assert.equal(listenerAdds, 1);
  assert.equal(listenerRemoves, 1);
  assert.deepEqual(posted.map(message => message.type), [
    'SCI_OFFSCREEN_FETCH', 'SCI_OFFSCREEN_FETCH_CANCEL'
  ]);
});

test('pre-cancelled non-stream offscreen fetch observes the abandoned pending request', async () => {
  const { createOffscreenFetch } = loadApi();
  const controller = new AbortController();
  controller.abort();
  let pendingObserved = 0;
  const pending = {
    then(resolve, reject) {
      pendingObserved += 1;
      reject(new Error('private abandoned request rejection'));
    }
  };
  const chromeApi = {
    runtime: {
      getURL: pathName => `chrome-extension://extension-id/${pathName}`,
      async getContexts() { return [{ contextType: 'OFFSCREEN_DOCUMENT' }]; },
      sendMessage(message) {
        return message.type === 'SCI_OFFSCREEN_FETCH_CANCEL' ? Promise.resolve() : pending;
      }
    },
    offscreen: { async createDocument() {} }
  };

  await assert.rejects(
    () => createOffscreenFetch(chromeApi, {
      requestIdFactory: () => 'non-stream-pre-cancelled'
    })('https://api.example/test', { signal: controller.signal }),
    error => error.name === 'AbortError' &&
      !JSON.stringify(error).includes('private abandoned request rejection')
  );
  await Promise.resolve();
  assert.equal(pendingObserved, 1);
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

test('aborting an offscreen stream terminalizes locally without a worker acknowledgement', async () => {
  const { createOffscreenFetch } = loadApi();
  const posted = [];
  let emitLate;
  const chromeApi = {
    runtime: {
      getURL: pathName => `chrome-extension://extension-id/${pathName}`,
      async getContexts() { return [{ contextType: 'OFFSCREEN_DOCUMENT' }]; },
      connect() {
        return createFakePort((message, emit) => {
          posted.push(message);
          emitLate = emit;
          if (message.type === 'SCI_OFFSCREEN_FETCH_STREAM') {
            queueMicrotask(() => {
              emit({
                requestId: message.requestId, type: 'started', status: 200, ok: true
              });
              emit({
                requestId: message.requestId, type: 'chunk', text: 'private buffered chunk'
              });
            });
          }
        });
      }
    },
    offscreen: { async createDocument() {} }
  };
  const controller = new AbortController();
  const iterator = createOffscreenFetch(chromeApi, {
    requestIdFactory: () => 'stream-local-cancel'
  }).stream('https://api.example/v1/chat', { signal: controller.signal })[Symbol.asyncIterator]();

  assert.equal((await iterator.next()).value.type, 'started');
  const terminal = iterator.next();
  controller.abort();
  const outcome = await Promise.race([
    terminal,
    new Promise(resolve => setTimeout(() => resolve({ hung: true }), 40))
  ]);

  assert.equal(outcome.hung, undefined);
  assert.equal(outcome.value.type, 'cancelled');
  assert.equal(posted.filter(message => message.type === 'SCI_OFFSCREEN_FETCH_CANCEL').length, 1);
  emitLate({
    requestId: 'stream-local-cancel', type: 'error',
    error: { name: 'TypeError', message: 'private late worker error' }
  });
  assert.equal((await iterator.next()).done, true);
});

test('offscreen stream rechecks cancellation after connecting and never starts a late request', async () => {
  const { createOffscreenFetch } = loadApi();
  const controller = new AbortController();
  const posted = [];
  const chromeApi = {
    runtime: {
      getURL: pathName => `chrome-extension://extension-id/${pathName}`,
      async getContexts() { return [{ contextType: 'OFFSCREEN_DOCUMENT' }]; },
      connect() {
        controller.abort();
        return createFakePort(message => { posted.push(message); });
      }
    },
    offscreen: { async createDocument() {} }
  };
  const iterator = createOffscreenFetch(chromeApi, {
    requestIdFactory: () => 'stream-connect-cancel'
  }).stream('https://api.example/v1/chat', { signal: controller.signal })[Symbol.asyncIterator]();

  const first = await Promise.race([
    iterator.next(),
    new Promise(resolve => setTimeout(() => resolve({ hung: true }), 40))
  ]);

  assert.equal(first.hung, undefined);
  assert.equal(first.value.type, 'cancelled');
  assert.equal(posted.filter(message => message.type === 'SCI_OFFSCREEN_FETCH_CANCEL').length, 1);
  assert.equal(posted.some(message => message.type === 'SCI_OFFSCREEN_FETCH_STREAM'), false);
  assert.equal((await iterator.next()).done, true);
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

test('offscreen worker successful streams enforce the exact cumulative UTF-8 byte boundary', async () => {
  const maximumBytes = 4 * 1024 * 1024;
  const encoder = new TextEncoder();
  const multibyte = encoder.encode('汉');
  const exactParts = [
    encoder.encode('a'.repeat(maximumBytes - multibyte.length)),
    multibyte.subarray(0, 1),
    multibyte.subarray(1)
  ];
  const states = [];
  const responseFor = parts => {
    const state = { reads: 0, cancelled: 0, released: 0 };
    states.push(state);
    return {
      ok: true,
      status: 200,
      headers: { get() { return null; } },
      body: {
        getReader() {
          return {
            async read() {
              const value = parts[state.reads++];
              return value ? { done: false, value } : { done: true };
            },
            cancel() { state.cancelled += 1; return Promise.resolve(); },
            releaseLock() { state.released += 1; }
          };
        }
      }
    };
  };
  const responses = [
    responseFor(exactParts),
    responseFor([...exactParts, encoder.encode('private overflow worker body')])
  ];
  const worker = loadNetworkWorker(async () => responses.shift());

  await worker.send({ type: 'stream', requestId: 'stream-exact', url: 'https://api.example' });
  const exactMessages = worker.messages.splice(0);
  assert.equal(exactMessages[0].type, 'started');
  assert.equal(exactMessages.at(-1).type, 'completed');
  const exactText = exactMessages
    .filter(message => message.type === 'chunk')
    .map(message => message.text).join('');
  assert.equal(encoder.encode(exactText).length, maximumBytes);
  assert.equal(exactText.endsWith('汉'), true);
  assert.deepEqual(states[0], {
    reads: exactParts.length + 1, cancelled: 0, released: 1
  });

  await worker.send({ type: 'stream', requestId: 'stream-overflow', url: 'https://api.example' });
  const overflowMessages = worker.messages.splice(0);
  assert.equal(overflowMessages[0].type, 'started');
  assert.equal(overflowMessages.at(-1).type, 'error');
  assert.equal(overflowMessages.some(message => message.type === 'completed'), false);
  assert.equal(overflowMessages.at(-1).error.name, 'ResponseLimitError');
  assert.equal(overflowMessages.at(-1).error.code, 'RESPONSE_BODY_TOO_LARGE');
  assert.equal(
    overflowMessages.at(-1).error.message,
    'Provider response body exceeded the 4 MiB limit'
  );
  assert.doesNotMatch(JSON.stringify(overflowMessages.at(-1)), /private overflow worker body/);
  assert.equal(states[1].cancelled, 1);
  assert.equal(states[1].released, 1);
});

test('offscreen worker text-only successful streams measure UTF-8 bytes before posting chunks', async () => {
  const maximumBytes = 4 * 1024 * 1024;
  const encoder = new TextEncoder();
  const exact = `a${'汉'.repeat((maximumBytes - 1) / 3)}`;
  const overflow = `aa${'汉'.repeat((maximumBytes - 1) / 3)}`;
  assert.equal(encoder.encode(exact).length, maximumBytes);
  assert.equal(encoder.encode(overflow).length, maximumBytes + 1);
  const bodies = [exact, overflow];
  const worker = loadNetworkWorker(async () => ({
    ok: true,
    status: 200,
    headers: { get() { return null; } },
    async text() { return bodies.shift(); }
  }));

  await worker.send({ type: 'stream', requestId: 'text-stream-exact', url: 'https://api.example' });
  const exactMessages = worker.messages.splice(0);
  assert.equal(exactMessages.at(-1).type, 'completed');
  assert.equal(encoder.encode(exactMessages
    .filter(message => message.type === 'chunk')
    .map(message => message.text).join('')).length, maximumBytes);

  await worker.send({ type: 'stream', requestId: 'text-stream-overflow', url: 'https://api.example' });
  const overflowMessages = worker.messages.splice(0);
  assert.equal(overflowMessages[0].type, 'started');
  assert.equal(overflowMessages.at(-1).type, 'error');
  assert.equal(overflowMessages.some(message => message.type === 'chunk'), false);
  assert.equal(overflowMessages.at(-1).error.name, 'ResponseLimitError');
  assert.equal(overflowMessages.at(-1).error.code, 'RESPONSE_BODY_TOO_LARGE');
  assert.equal(
    overflowMessages.at(-1).error.message,
    'Provider response body exceeded the 4 MiB limit'
  );
});

test('offscreen worker streams exactly 16 KiB of an HTTP error then cancels without waiting', async () => {
  const maximumBytes = 16 * 1024;
  const encoder = new TextEncoder();
  const multibyte = encoder.encode('汉');
  const parts = [
    encoder.encode('a'.repeat(maximumBytes - multibyte.length)),
    multibyte.subarray(0, 1),
    multibyte.subarray(1),
    encoder.encode('private HTTP error overflow')
  ];
  let reads = 0;
  let cancelled = 0;
  let released = 0;
  const worker = loadNetworkWorker(async () => ({
    ok: false,
    status: 429,
    headers: { get() { return null; } },
    body: {
      getReader() {
        return {
          async read() {
            const value = parts[reads++];
            return value ? { done: false, value } : { done: true };
          },
          cancel() {
            cancelled += 1;
            return new Promise(() => {});
          },
          releaseLock() { released += 1; }
        };
      }
    }
  }));

  const outcome = await Promise.race([
    worker.send({ type: 'stream', requestId: 'http-error-boundary', url: 'https://api.example' })
      .then(() => 'settled'),
    new Promise(resolve => setTimeout(() => resolve('cleanup-blocked'), 60))
  ]);
  assert.equal(outcome, 'settled');
  assert.equal(worker.messages[0].type, 'started');
  assert.equal(worker.messages[0].status, 429);
  assert.equal(worker.messages.at(-1).type, 'completed');
  const body = worker.messages
    .filter(message => message.type === 'chunk')
    .map(message => message.text).join('');
  assert.equal(encoder.encode(body).length, maximumBytes);
  assert.equal(body.endsWith('汉'), true);
  assert.doesNotMatch(body, /private HTTP error overflow/);
  assert.equal(reads, 3);
  assert.equal(cancelled, 1);
  assert.equal(released, 1);
});

test('offscreen worker rejects declared oversized success before reading or posting its body', async () => {
  const maximumBytes = 4 * 1024 * 1024;
  const secret = 'worker-oversized-body-secret';
  let reads = 0;
  let textCalls = 0;
  let cancelled = 0;
  let released = 0;
  const worker = loadNetworkWorker(async () => ({
    ok: true,
    status: 200,
    headers: {
      get(name) {
        const key = String(name).toLowerCase();
        if (key === 'content-length') return String(maximumBytes + 1);
        if (key === 'content-type') return 'application/json';
        return null;
      }
    },
    body: {
      getReader() {
        return {
          async read() { reads += 1; return { done: false, value: new TextEncoder().encode(secret) }; },
          async cancel() { cancelled += 1; },
          releaseLock() { released += 1; }
        };
      }
    },
    async text() { textCalls += 1; return secret; }
  }));

  await worker.send({ type: 'fetch', requestId: 'oversized-declared', url: 'https://api.example' });

  assert.equal(worker.messages.length, 1);
  const message = worker.messages[0];
  assert.equal(message.success, false);
  assert.equal(message.stage, 'response-body');
  assert.equal(message.status, 200);
  assert.equal(message.error.name, 'ResponseLimitError');
  assert.equal(message.error.message, 'Provider response body exceeded the 4 MiB limit');
  assert.equal(Object.hasOwn(message, 'body'), false);
  assert.doesNotMatch(JSON.stringify(message), new RegExp(secret));
  assert.equal(reads, 0);
  assert.equal(textCalls, 0);
  assert.equal(cancelled, 1);
  assert.equal(released, 1);
});

test('offscreen declared overflow remains authoritative after one hostile body cleanup lookup', async () => {
  const maximumBytes = 4 * 1024 * 1024;
  let bodyGetterCalls = 0;
  const response = {
    ok: true,
    status: 200,
    headers: {
      get(name) {
        return String(name).toLowerCase() === 'content-length'
          ? String(maximumBytes + 1) : null;
      }
    }
  };
  Object.defineProperty(response, 'body', {
    get() {
      bodyGetterCalls += 1;
      throw new Error('private hostile worker body getter');
    }
  });
  const worker = loadNetworkWorker(async () => response);

  await worker.send({ type: 'fetch', requestId: 'hostile-body', url: 'https://api.example' });

  assert.equal(bodyGetterCalls, 1);
  assert.equal(worker.messages.length, 1);
  assert.equal(worker.messages[0].success, false);
  assert.equal(worker.messages[0].stage, 'response-body');
  assert.equal(worker.messages[0].error.name, 'ResponseLimitError');
  assert.equal(worker.messages[0].error.message, 'Provider response body exceeded the 4 MiB limit');
  assert.equal(Object.hasOwn(worker.messages[0], 'body'), false);
  assert.doesNotMatch(JSON.stringify(worker.messages[0]), /private hostile worker body getter/);
});

test('offscreen worker confirms exact streamed bytes and rejects the first overflow byte', async () => {
  const maximumBytes = 4 * 1024 * 1024;
  const encoder = new TextEncoder();
  const multibyte = encoder.encode('汉');
  const exactChunks = [
    encoder.encode('a'.repeat(maximumBytes - multibyte.length)),
    multibyte.subarray(0, 2),
    multibyte.subarray(2)
  ];
  const states = [];
  const responseFor = (chunks, { cancelFails = false, releaseFails = false } = {}) => {
    const state = { reads: 0, cancelled: 0, released: 0 };
    states.push(state);
    return {
      ok: true,
      status: 200,
      headers: { get() { return null; } },
      body: {
        getReader() {
          return {
            async read() {
              const value = chunks[state.reads++];
              return value ? { done: false, value } : { done: true };
            },
            async cancel() {
              state.cancelled += 1;
              if (cancelFails) throw new Error('private cancel failure');
            },
            releaseLock() {
              state.released += 1;
              if (releaseFails) throw new Error('private release failure');
            }
          };
        }
      }
    };
  };
  const responses = [
    responseFor(exactChunks, { releaseFails: true }),
    responseFor([
      new Uint8Array(maximumBytes - 1).fill(97),
      new Uint8Array(0),
      encoder.encode('汉').buffer
    ], { cancelFails: true, releaseFails: true })
  ];
  const worker = loadNetworkWorker(async () => responses.shift());

  await worker.send({ type: 'fetch', requestId: 'exact', url: 'https://api.example' });
  const accepted = worker.messages.shift();
  assert.equal(accepted.success, true);
  assert.equal(encoder.encode(accepted.body).length, maximumBytes);
  assert.equal(accepted.body.endsWith('汉'), true);
  assert.deepEqual(states[0], {
    reads: exactChunks.length + 1, cancelled: 0, released: 1
  });

  await worker.send({ type: 'fetch', requestId: 'overflow', url: 'https://api.example' });
  const rejected = worker.messages.shift();
  assert.equal(rejected.success, false);
  assert.equal(rejected.error.name, 'ResponseLimitError');
  assert.equal(Object.hasOwn(rejected, 'body'), false);
  assert.deepEqual(states[1], { reads: 3, cancelled: 1, released: 1 });
});

test('offscreen worker measures text-only success fallback in UTF-8 bytes before messaging', async () => {
  const maximumBytes = 4 * 1024 * 1024;
  const multibyteCount = (maximumBytes - 1) / 3;
  const responses = [
    { contentLength: 'malformed-size', body: `a${'汉'.repeat(multibyteCount)}` },
    { contentLength: '1', body: `aa${'汉'.repeat(multibyteCount)}` }
  ];
  const worker = loadNetworkWorker(async () => {
    const response = responses.shift();
    return {
      ok: true,
      status: 200,
      headers: { get(name) { return String(name).toLowerCase() === 'content-length'
        ? response.contentLength : null; } },
      async text() { return response.body; }
    };
  });

  await worker.send({ type: 'fetch', requestId: 'text-exact', url: 'https://api.example' });
  const accepted = worker.messages.shift();
  assert.equal(accepted.success, true);
  assert.equal(new TextEncoder().encode(accepted.body).length, maximumBytes);

  await worker.send({ type: 'fetch', requestId: 'text-overflow', url: 'https://api.example' });
  const rejected = worker.messages.shift();
  assert.equal(rejected.success, false);
  assert.equal(rejected.stage, 'response-body');
  assert.equal(rejected.error.name, 'ResponseLimitError');
  assert.equal(Object.hasOwn(rejected, 'body'), false);
});

test('maps a ResponseLimitError rebuilt across the offscreen bridge to fixed provider diagnostics', async () => {
  const { createOffscreenFetch } = loadApi();
  const secret = 'remote-worker-private-message';
  const chromeApi = {
    runtime: {
      getURL: pathName => `chrome-extension://extension-id/${pathName}`,
      async getContexts() { return [{ contextType: 'OFFSCREEN_DOCUMENT' }]; },
      async sendMessage() {
        return {
          success: false,
          stage: 'response-body',
          status: 200,
          error: { name: 'ResponseLimitError', message: secret }
        };
      }
    },
    offscreen: { async createDocument() {} }
  };
  const fetchImpl = createOffscreenFetch(chromeApi, { requestIdFactory: () => 'limit-bridge' });

  await assert.rejects(
    () => requestText(fetchImpl, 'https://api.example/v1/chat', {}),
    error => {
      assert.equal(error.code, 'INVALID_RESPONSE');
      assert.equal(error.retryable, false);
      assert.equal(error.diagnosticStage, 'response-body');
      assert.equal(error.diagnosticType, 'ResponseLimitError');
      assert.equal(error.message, 'Provider response body exceeded the 4 MiB limit');
      assert.doesNotMatch(JSON.stringify(error), new RegExp(secret));
      return true;
    }
  );
});

test('offscreen worker cancels a pending success reader without ever posting its body', async () => {
  let markReadStarted;
  const readStarted = new Promise(resolve => { markReadStarted = resolve; });
  let cancelCalls = 0;
  let releaseCalls = 0;
  const worker = loadNetworkWorker(async (url, options) => ({
    ok: true,
    status: 200,
    headers: { get() { return null; } },
    body: {
      getReader() {
        return {
          read() {
            markReadStarted();
            return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => {
              reject(Object.assign(new Error('private aborted read'), { name: 'AbortError' }));
            }, { once: true }));
          },
          cancel() { cancelCalls += 1; return new Promise(() => {}); },
          releaseLock() { releaseCalls += 1; }
        };
      }
    }
  }));

  const running = worker.send({
    type: 'fetch', requestId: 'reader-abort', url: 'https://api.example'
  });
  await readStarted;
  await worker.send({ type: 'cancel', requestId: 'reader-abort' });
  const outcome = await Promise.race([
    running.then(() => 'settled'),
    new Promise(resolve => setTimeout(() => resolve('cleanup-blocked'), 40))
  ]);

  assert.equal(outcome, 'settled');
  assert.equal(worker.messages.length, 1);
  assert.equal(worker.messages[0].success, false);
  assert.equal(worker.messages[0].stage, 'response-body');
  assert.equal(worker.messages[0].error.name, 'AbortError');
  assert.equal(Object.hasOwn(worker.messages[0], 'body'), false);
  assert.equal(cancelCalls, 1);
  assert.equal(releaseCalls, 1);
});
