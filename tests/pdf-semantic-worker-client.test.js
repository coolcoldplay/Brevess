const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const {
  createPdfSemanticWorkerClient
} = require('../core/pdf-semantic-worker-client.js');

class FakeWorker {
  static instances = [];

  constructor(url, options) {
    this.url = url;
    this.options = options;
    this.messages = [];
    this.listeners = new Map();
    this.terminated = false;
    FakeWorker.instances.push(this);
  }

  addEventListener(type, listener) {
    const list = this.listeners.get(type) || [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  postMessage(message) {
    if (this.terminated) throw new Error('terminated');
    this.messages.push(structuredClone(message));
  }

  emit(type, value) {
    for (const listener of this.listeners.get(type) || []) listener(value);
  }

  terminate() {
    this.terminated = true;
  }
}

function client(options = {}) {
  FakeWorker.instances.length = 0;
  return createPdfSemanticWorkerClient({
    WorkerCtor: FakeWorker,
    workerUrl: 'chrome-extension://test/core/pdf-semantic-worker.mjs',
    ...options
  });
}

test('worker client uses a module worker and resolves the matching immutable result', async () => {
  const api = client();
  const pending = api.build({ documentHash: 'a'.repeat(64), revision: 1, pages: [] });
  const worker = FakeWorker.instances[0];
  assert.deepEqual(worker.options, { type: 'module', name: 'brevess-pdf-semantic' });
  assert.equal(worker.messages.length, 1);
  assert.equal(worker.messages[0].type, 'build');
  worker.emit('message', { data: {
    type: 'result', requestId: worker.messages[0].requestId,
    result: { schemaVersion: 2, sentenceCount: 3 }
  } });
  const result = await pending;
  assert.deepEqual(result, { schemaVersion: 2, sentenceCount: 3 });
  assert.ok(Object.isFrozen(result));
});

test('worker client maps concurrent responses by request id and ignores unknown messages', async () => {
  const api = client();
  const first = api.build({ revision: 1 });
  const second = api.build({ revision: 2 });
  const worker = FakeWorker.instances[0];
  worker.emit('message', { data: { type: 'result', requestId: 'unknown', result: {} } });
  worker.emit('message', { data: { type: 'result', requestId: worker.messages[1].requestId,
    result: { revision: 2 } } });
  worker.emit('message', { data: { type: 'result', requestId: worker.messages[0].requestId,
    result: { revision: 1 } } });
  assert.equal((await first).revision, 1);
  assert.equal((await second).revision, 2);
});

test('aborting a build terminates the occupied worker and rejects every in-flight request', async () => {
  const api = client();
  const controller = new AbortController();
  const first = api.build({ revision: 1 }, { signal: controller.signal });
  const second = api.build({ revision: 2 });
  const worker = FakeWorker.instances[0];
  controller.abort();
  await assert.rejects(first, error => error.code === 'PDF_SEMANTIC_BUILD_ABORTED');
  await assert.rejects(second, error => error.code === 'PDF_SEMANTIC_WORKER_RESET');
  assert.equal(worker.terminated, true);
  const third = api.build({ revision: 3 });
  assert.equal(FakeWorker.instances.length, 2);
  const replacement = FakeWorker.instances[1];
  replacement.emit('message', { data: { type: 'result',
    requestId: replacement.messages[0].requestId, result: { revision: 3 } } });
  assert.equal((await third).revision, 3);
});

test('worker errors expose only fixed codes and never raw error text', async () => {
  const api = client();
  const pending = api.build({ revision: 1 });
  const worker = FakeWorker.instances[0];
  worker.emit('message', { data: { type: 'error', requestId: worker.messages[0].requestId,
    code: 'PDF_SEMANTIC_INPUT_INVALID', message: 'C:\\private\\paper.pdf secret title' } });
  await assert.rejects(pending, error => {
    assert.equal(error.code, 'PDF_SEMANTIC_INPUT_INVALID');
    assert.equal(error.message, 'PDF_SEMANTIC_INPUT_INVALID');
    assert.doesNotMatch(JSON.stringify(error), /private|paper|secret/iu);
    return true;
  });
});

test('transport failure resets the worker with a fixed code and dispose prevents reuse', async () => {
  const api = client();
  const pending = api.build({ revision: 1 });
  const worker = FakeWorker.instances[0];
  worker.emit('error', { message: 'C:\\private\\paper.pdf failed' });
  await assert.rejects(pending, error => error.code === 'PDF_SEMANTIC_WORKER_FAILED');
  assert.equal(worker.terminated, true);
  api.dispose();
  await assert.rejects(api.build({ revision: 2 }),
    error => error.code === 'PDF_SEMANTIC_WORKER_DISPOSED');
});

test('module worker loads local semantic dependencies and emits fixed-code envelopes', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'core',
    'pdf-semantic-worker.mjs'), 'utf8');
  assert.match(source, /import ['"]\.\/pdf-heading-extractor\.js['"]/u);
  assert.match(source, /import ['"]\.\/pdf-semantic-index\.js['"]/u);
  assert.match(source, /SciLLM\.buildPdfSemanticIndex/u);
  assert.match(source, /type:\s*['"]result['"]/u);
  assert.match(source, /type:\s*['"]error['"]/u);
  assert.doesNotMatch(source, /message:\s*String\(error/u);
});
