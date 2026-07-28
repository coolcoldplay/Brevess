const test = require('node:test');
const assert = require('node:assert/strict');
const { existsSync, mkdtempSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

require('../providers/provider-utils.js');
const { createCodexNativeClient } = require('../core/codex-native-client.js');
const { createCodexLocalAdapter } = require('../providers/codex-local.js');
const {
  CodexBridgeHost,
  TurnImageStore,
  ReaderEventStore,
  ThreadMap,
  createNativeMessageParser,
  encodeNativeMessage,
  codexSpawnSpec,
  classifyTurnError,
  codexHomeDirectory
} = require('../native-host/host.js');

function createFakeRuntime() {
  const messageListeners = [];
  const disconnectListeners = [];
  const sent = [];
  const port = {
    onMessage: { addListener(listener) { messageListeners.push(listener); } },
    onDisconnect: { addListener(listener) { disconnectListeners.push(listener); } },
    postMessage(message) { sent.push(message); },
    disconnect() { disconnectListeners.forEach(listener => listener()); }
  };
  return {
    runtime: {
      lastError: null,
      connectNative(name) {
        assert.equal(name, 'com.sci_reader.codex_bridge');
        return port;
      }
    },
    sent,
    emit(message) { messageListeners.forEach(listener => listener(message)); }
  };
}

test('local Codex client streams deltas and completion over Native Messaging', async () => {
  const fake = createFakeRuntime();
  const client = createCodexNativeClient(fake.runtime);
  const stream = client.streamTurn({
    conversationKey: 'paper-1',
    profileId: 'profile_codex',
    model: 'auto',
    systemPrompt: 'Return NDJSON.',
    userPrompt: 'Question',
    images: [{
      mediaType: 'image/png',
      dataUrl: 'data:image/png;base64,iVBORw0KGgo='
    }]
  });
  const requestId = fake.sent[0].requestId;
  assert.equal(fake.sent[0].images.length, 1);
  assert.equal(fake.sent[0].images[0].detail, 'high');
  fake.emit({ type: 'turn.started', requestId, threadId: 'thr-1', turnId: 'turn-1' });
  fake.emit({ type: 'turn.delta', requestId, text: '{"type":"final"}' });
  fake.emit({ type: 'turn.completed', requestId, finishReason: 'stop' });

  const events = [];
  for await (const event of stream) events.push(event);
  assert.deepEqual(events.map(event => event.type), [
    'metadata', 'text_delta', 'completed'
  ]);
  assert.equal(events[1].text, '{"type":"final"}');
});

test('local Codex client reports its own turn deadline as a timeout', async () => {
  const fake = createFakeRuntime();
  const client = createCodexNativeClient(fake.runtime);
  const stream = client.streamTurn({
    userPrompt: 'Connection test',
    timeoutMs: 1000
  });
  const requestId = fake.sent[0].requestId;
  await new Promise(resolve => setTimeout(resolve, 1050));
  assert.equal(fake.sent.at(-1).type, 'turn.cancel');
  fake.emit({ type: 'turn.cancelled', requestId });

  const events = [];
  for await (const event of stream) events.push(event);
  assert.equal(events.at(-1).type, 'error');
  assert.equal(events.at(-1).error.code, 'REQUEST_TIMEOUT');
  assert.equal(events.at(-1).error.retryable, true);
});

test('local Codex client publishes reverse-channel events and receives their paths', async () => {
  const fake = createFakeRuntime();
  const client = createCodexNativeClient(fake.runtime);
  const publishing = client.publishReaderEvent({
    eventType: 'reader.figure.progress',
    operationId: 'figure-op-1',
    progress: { figureId: 'figure-1', phase: 'figure_requesting' }
  });
  const request = fake.sent[0];
  assert.equal(request.type, 'reader.event.publish');
  fake.emit({
    type: 'reader.event.ack',
    requestId: request.requestId,
    success: true,
    latestEventPath: 'C:\\events\\latest.json',
    eventLogPath: 'C:\\events\\events.ndjson'
  });
  const result = await publishing;
  assert.equal(result.latestEventPath, 'C:\\events\\latest.json');
});

test('local Codex client supports plugin-scoped login and logout controls', async () => {
  const fake = createFakeRuntime();
  const client = createCodexNativeClient(fake.runtime);
  const loginPromise = client.startLogin({ force: true });
  const loginRequest = fake.sent[0];
  assert.equal(loginRequest.type, 'auth.login.start');
  assert.equal(loginRequest.force, true);
  fake.emit({
    type: 'auth.login.started',
    requestId: loginRequest.requestId,
    loginId: 'login-1',
    authUrl: 'https://auth.openai.com/oauth/authorize'
  });
  assert.deepEqual(await loginPromise, {
    loginId: 'login-1',
    authUrl: 'https://auth.openai.com/oauth/authorize'
  });

  const logoutPromise = client.logout();
  const logoutRequest = fake.sent[1];
  assert.equal(logoutRequest.type, 'auth.logout');
  fake.emit({
    type: 'auth.logout.result',
    requestId: logoutRequest.requestId,
    success: true
  });
  assert.deepEqual(await logoutPromise, { success: true });
});

test('local Codex adapter forwards per-paper thread identity without an API key', async () => {
  let captured = null;
  const adapter = createCodexLocalAdapter({
    model: 'auto',
    reasoningEffort: 'medium'
  }, {
    streamTurn(input) {
      captured = input;
      return {
        async *[Symbol.asyncIterator]() {
          yield { type: 'text_delta', text: 'answer' };
          yield { type: 'completed' };
        }
      };
    },
    async health() { return { connected: true, accountType: 'chatgpt' }; }
  });
  const events = [];
  for await (const event of adapter.generateTextStream({
    selectedProfileId: 'profile_codex_local',
    conversationKey: 'hash-123',
    conversationLabel: 'Paper title',
    systemPrompt: 'SYSTEM',
    userPrompt: 'USER',
    images: [{
      mediaType: 'image/jpeg',
      dataUrl: 'data:image/jpeg;base64,/9j/2Q=='
    }]
  })) events.push(event);
  assert.equal(captured.conversationKey, 'hash-123');
  assert.equal(captured.profileId, 'profile_codex_local');
  assert.equal(captured.reasoningEffort, 'medium');
  assert.equal(captured.images.length, 1);
  assert.equal(captured.images[0].detail, 'high');
  assert.deepEqual(events.map(event => event.type), ['text_delta', 'completed']);
});

test('bridge materializes Native Messaging Figure data as App Server localImage input', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'sci-codex-images-'));
  const sent = [];
  const requests = [];
  let notify = null;
  let imagePath = '';
  const server = {
    onNotification(listener) {
      notify = listener;
      return () => {};
    },
    async start() {},
    async request(method, params) {
      requests.push({ method, params });
      if (method === 'thread/start') return { thread: { id: 'thread-image' } };
      if (method === 'turn/start') {
        imagePath = params.input.find(item => item.type === 'localImage')?.path || '';
        assert.equal(existsSync(imagePath), true);
        return { turn: { id: 'turn-image' } };
      }
      throw new Error(`Unexpected request: ${method}`);
    },
    close() {}
  };
  const host = new CodexBridgeHost({
    server,
    imageStore: new TurnImageStore(join(directory, 'images')),
    eventStore: new ReaderEventStore(join(directory, 'events')),
    threadMap: { get() { return ''; }, set() {}, delete() {} },
    send(message) { sent.push(message); }
  });

  await host.startTurn({
    requestId: 'request-image',
    conversationKey: 'paper-image',
    profileId: 'profile-image',
    userPrompt: 'Read the attached Figure.',
    images: [{
      mediaType: 'image/png',
      dataUrl: 'data:image/png;base64,iVBORw0KGgo='
    }]
  });

  const turnRequest = requests.find(item => item.method === 'turn/start');
  assert.deepEqual(turnRequest.params.input.map(item => item.type), ['text', 'localImage']);
  assert.equal(turnRequest.params.input[1].detail, 'high');
  notify({
    method: 'turn/completed',
    params: {
      threadId: 'thread-image',
      turn: { id: 'turn-image', status: 'completed' }
    }
  });
  assert.equal(existsSync(imagePath), false);
  assert.equal(sent.at(-1).type, 'turn.completed');
});

test('reader reverse-channel event store keeps an append-only log and latest snapshot', () => {
  const directory = mkdtempSync(join(tmpdir(), 'sci-codex-events-'));
  const store = new ReaderEventStore(directory);
  const result = store.publish({
    eventType: 'reader.figure.result',
    streamKey: 'tab-1:figure-1',
    operationId: 'figure-op-1',
    source: { title: 'Paper', url: 'https://example.org/paper' },
    result: {
      figureResults: [{ figureId: 'figure-1', basis: 'vision_text' }],
      images: [{ dataUrl: 'data:image/png;base64,secret-pixels' }],
      apiKey: 'secret-key'
    }
  });
  const latest = JSON.parse(readFileSync(result.latestEventPath, 'utf8'));
  const log = readFileSync(result.eventLogPath, 'utf8').trim();
  assert.equal(latest.latest.eventType, 'reader.figure.result');
  assert.equal(latest.latest.result.figureResults[0].basis, 'vision_text');
  assert.equal(latest.latest.result.images, undefined);
  assert.equal(latest.latest.result.apiKey, undefined);
  assert.equal(JSON.parse(log).eventId, result.eventId);
});

test('local Codex connection test performs an ephemeral model turn after health', async () => {
  const calls = [];
  const adapter = createCodexLocalAdapter({
    model: 'auto',
    reasoningEffort: 'medium'
  }, {
    async health() {
      calls.push({ type: 'health' });
      return { connected: true, accountType: 'chatgpt', planType: 'plus' };
    },
    streamTurn(input) {
      calls.push({ type: 'turn', input });
      return {
        async *[Symbol.asyncIterator]() {
          yield { type: 'text_delta', text: 'OK' };
          yield { type: 'completed' };
        }
      };
    }
  });

  const result = await adapter.testConnection({ timeoutMs: 5000 });

  assert.equal(result.modelProbe, true);
  assert.equal(calls[0].type, 'health');
  assert.equal(calls[1].type, 'turn');
  assert.equal(calls[1].input.ephemeral, true);
  assert.equal(calls[1].input.reasoningEffort, 'low');
  assert.match(calls[1].input.systemPrompt, /Reply with exactly: OK/);
});

test('Native Messaging framing survives split input chunks', () => {
  const messages = [];
  const parse = createNativeMessageParser(message => messages.push(message));
  const encoded = encodeNativeMessage({ type: 'health.check', requestId: 'health-1' });
  parse(encoded.subarray(0, 3));
  parse(encoded.subarray(3, 9));
  parse(encoded.subarray(9));
  assert.deepEqual(messages, [{ type: 'health.check', requestId: 'health-1' }]);
});

test('thread mapping is stable per paper and profile without storing raw document keys', () => {
  const directory = mkdtempSync(join(tmpdir(), 'sci-codex-thread-map-'));
  const filePath = join(directory, 'threads.json');
  const map = new ThreadMap(filePath);
  map.set('document-secret-key', 'profile-a', 'thread-a', 'Paper');
  map.set('document-secret-key', 'profile-b', 'thread-b', 'Paper');
  assert.equal(map.get('document-secret-key', 'profile-a'), 'thread-a');
  assert.equal(map.get('document-secret-key', 'profile-b'), 'thread-b');
  assert.equal(readFileSync(filePath, 'utf8').includes('document-secret-key'), false);
});

test('bridge isolates Codex state and disables unrelated tools', () => {
  const isolatedHome = codexHomeDirectory().replaceAll('\\', '/');
  assert.match(isolatedHome, /SCIReaderCodexBridge\/codex-home$/);
  const launch = codexSpawnSpec('C:\\tools\\codex.exe');
  assert.deepEqual(launch.args.slice(0, 3), [
    'app-server', '--disable', 'shell_tool'
  ]);
  assert.equal(launch.args.includes('agents'), false);
  assert.ok(launch.args.includes('web_search="disabled"'));
});

test('bridge maps structured App Server failures to actionable public codes', () => {
  assert.equal(classifyTurnError({
    codexErrorInfo: 'unauthorized',
    message: 'request rejected'
  }).code, 'CODEX_NOT_AUTHENTICATED');
  const unavailable = classifyTurnError({
    codexErrorInfo: { httpConnectionFailed: { httpStatusCode: 502 } },
    message: 'upstream failed'
  });
  assert.equal(unavailable.code, 'PROVIDER_UNAVAILABLE');
  assert.equal(unavailable.retryable, true);
  assert.equal(unavailable.status, 502);
  assert.equal(classifyTurnError({
    codexErrorInfo: 'usageLimitExceeded',
    message: 'limit'
  }).code, 'QUOTA_EXHAUSTED');
});

test('bridge starts ChatGPT login inside the plugin session and clears old threads', async () => {
  const sent = [];
  const requests = [];
  let clearCount = 0;
  const server = {
    onNotification() { return () => {}; },
    async start() {},
    async request(method, params) {
      requests.push({ method, params });
      if (method === 'account/logout') return {};
      if (method === 'account/login/start') {
        return {
          type: 'chatgpt',
          loginId: 'login-plugin',
          authUrl: 'https://auth.openai.com/oauth/authorize'
        };
      }
      throw new Error(`Unexpected request: ${method}`);
    },
    close() {}
  };
  const host = new CodexBridgeHost({
    server,
    threadMap: { clear() { clearCount += 1; } },
    send(message) { sent.push(message); }
  });

  await host.handle({ type: 'auth.login.start', requestId: 'auth-1', force: true });

  assert.deepEqual(requests.map(item => item.method), [
    'account/logout', 'account/login/start'
  ]);
  assert.equal(clearCount, 1);
  assert.equal(sent[0].type, 'auth.login.started');
  assert.equal(sent[0].requestId, 'auth-1');
  assert.equal(sent[0].loginId, 'login-plugin');
});

test('bridge preserves fast turn notifications that arrive before turn/start resolves', async () => {
  const sent = [];
  let notify = null;
  const server = {
    onNotification(listener) {
      notify = listener;
      return () => {};
    },
    async start() {},
    async request(method) {
      if (method === 'thread/start') return { thread: { id: 'thread-fast' } };
      if (method === 'turn/start') {
        notify({
          method: 'turn/started',
          params: { threadId: 'thread-fast', turn: { id: 'turn-fast' } }
        });
        notify({
          method: 'item/agentMessage/delta',
          params: {
            threadId: 'thread-fast',
            turnId: 'turn-fast',
            itemId: 'message-fast',
            delta: 'fast answer'
          }
        });
        notify({
          method: 'turn/completed',
          params: {
            threadId: 'thread-fast',
            turn: { id: 'turn-fast', status: 'completed' }
          }
        });
        return { turn: { id: 'turn-fast' } };
      }
      throw new Error(`Unexpected request: ${method}`);
    },
    close() {}
  };
  const host = new CodexBridgeHost({
    server,
    threadMap: { get() { return ''; }, set() {}, delete() {} },
    send(message) { sent.push(message); }
  });

  await host.startTurn({
    requestId: 'request-fast',
    conversationKey: 'paper-fast',
    profileId: 'profile-fast',
    userPrompt: 'Question'
  });

  assert.deepEqual(sent.map(message => message.type), [
    'turn.started', 'turn.delta', 'turn.completed'
  ]);
  assert.equal(sent[1].text, 'fast answer');
});
