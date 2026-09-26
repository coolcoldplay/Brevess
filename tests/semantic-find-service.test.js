const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const { createSemanticFindService } = require('../core/semantic-find-service.js');

const runtimeId = 'brevess-runtime-id';

function sender(overrides = {}) {
  return {
    id: runtimeId,
    tab: { id: 17 },
    frameId: 3,
    documentId: 'doc-current',
    ...overrides
  };
}

function request(overrides = {}) {
  return {
    type: 'LLM_SEMANTIC_FIND',
    operationId: 'semantic-operation-0001',
    sourceKey: 'semantic-source-0001',
    query: '寻找讨论局限性的句子',
    paragraphs: [{ paragraphId: 'p1', sectionTitle: 'Discussion', text: 'One limitation.' }],
    ...overrides
  };
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('delivers bounded semantic progress only to the exact trusted sender', async () => {
  const deliveries = [];
  const service = createSemanticFindService({
    runtimeExtensionId: runtimeId,
    async runRequest(message, context) {
      assert.equal(context.semanticFindSignal.aborted, false);
      await context.onSemanticFindProgress({
        processed: 1, total: 1, skipped: 0,
        scores: [{ id: 'semantic_sentence_0', score: 0.875 }],
        done: true, coverage: 'full'
      });
      return { success: true, data: {
        processed: 1, total: 1, skipped: 0,
        scores: [{ id: 'semantic_sentence_0', score: 0.875 }],
        complete: true, coverage: 'full', route: { taskType: 'semantic_find' },
        operationId: message.operationId, sourceKey: message.sourceKey
      } };
    },
    async sendProgress(target, payload) { deliveries.push({ target, payload }); }
  });

  const response = await service.handle(request(), sender());
  assert.equal(response.success, true);
  assert.deepEqual(deliveries, [{
    target: { tabId: 17, frameId: 3, documentId: 'doc-current' },
    payload: {
      action: 'semanticFindProgress',
      operationId: 'semantic-operation-0001',
      sourceKey: 'semantic-source-0001',
      progress: {
        processed: 1, total: 1, skipped: 0,
        scores: [{ id: 'semantic_sentence_0', score: 0.875 }],
        done: true, coverage: 'full'
      }
    }
  }]);
});

test('rejects untrusted senders and malformed bounded inputs before routing', async () => {
  let routed = 0;
  const service = createSemanticFindService({
    runtimeExtensionId: runtimeId,
    async runRequest() { routed += 1; return { success: true, data: {} }; },
    async sendProgress() {}
  });
  const cases = [
    [request(), sender({ id: 'foreign-extension' })],
    [request(), sender({ documentId: '' })],
    [request({ operationId: 'short' }), sender()],
    [request({ sourceKey: '' }), sender()],
    [request({ query: 'x'.repeat(1001) }), sender()],
    [request({ paragraphs: [] }), sender()],
    [request({ paragraphs: [{ paragraphId: 'p1', text: 'x'.repeat(1000001) }] }), sender()],
    [request({ paragraphs: Array.from({ length: 5001 }, (_, index) => ({
      paragraphId: `p${index}`, text: 'Sentence.'
    })) }), sender()]
  ];
  for (const [message, origin] of cases) {
    const response = await service.handle(message, origin);
    assert.equal(response.success, false);
    assert.match(response.error.code, /^SEMANTIC_FIND_(?:OWNER_UNAVAILABLE|INVALID_REQUEST|LIMIT_EXCEEDED)$/u);
  }
  assert.equal(routed, 0);
});

test('a newer operation cancels the prior operation for the same owner without stale progress', async () => {
  const firstEntered = deferred();
  const releaseFirst = deferred();
  const deliveries = [];
  const service = createSemanticFindService({
    runtimeExtensionId: runtimeId,
    async runRequest(message, context) {
      if (message.operationId.endsWith('0001')) {
        firstEntered.resolve();
        await releaseFirst.promise;
        await context.onSemanticFindProgress({
          processed: 1, total: 1, skipped: 0,
          scores: [{ id: 'semantic_sentence_0', score: 0.1 }],
          done: true, coverage: 'full'
        });
      }
      return { success: true, data: { operationId: message.operationId } };
    },
    async sendProgress(_target, payload) { deliveries.push(payload); }
  });

  const first = service.handle(request(), sender());
  await firstEntered.promise;
  const second = await service.handle(request({
    operationId: 'semantic-operation-0002', sourceKey: 'semantic-source-0002'
  }), sender());
  releaseFirst.resolve();
  const stale = await first;

  assert.equal(second.success, true);
  assert.equal(stale.success, false);
  assert.equal(stale.error.code, 'CANCELLED');
  assert.deepEqual(deliveries, []);
});

test('cancel requires the exact owner, operation and source binding', async () => {
  const entered = deferred();
  const release = deferred();
  let observedSignal = null;
  const service = createSemanticFindService({
    runtimeExtensionId: runtimeId,
    async runRequest(_message, context) {
      observedSignal = context.semanticFindSignal;
      entered.resolve();
      await release.promise;
      return { success: true, data: {} };
    },
    async sendProgress() {}
  });
  const pending = service.handle(request(), sender());
  await entered.promise;

  for (const [message, origin] of [
    [request({ type: 'LLM_SEMANTIC_FIND_CANCEL', sourceKey: 'wrong-source' }), sender()],
    [request({ type: 'LLM_SEMANTIC_FIND_CANCEL', operationId: 'semantic-operation-9999' }), sender()],
    [request({ type: 'LLM_SEMANTIC_FIND_CANCEL' }), sender({ frameId: 4 })]
  ]) {
    const response = await service.handle(message, origin);
    assert.equal(response.success, true);
    assert.equal(response.data.cancelled, false);
    assert.equal(observedSignal.aborted, false);
  }

  const cancelled = await service.handle(request({ type: 'LLM_SEMANTIC_FIND_CANCEL' }), sender());
  assert.deepEqual(cancelled, { success: true, data: { cancelled: true } });
  assert.equal(observedSignal.aborted, true);
  release.resolve();
  assert.equal((await pending).error.code, 'CANCELLED');
});

test('document replacement and tab retirement cancel matching active owners', async () => {
  const signals = [];
  const releases = [deferred(), deferred()];
  const entered = [deferred(), deferred()];
  const service = createSemanticFindService({
    runtimeExtensionId: runtimeId,
    async runRequest(_message, context) {
      const index = signals.length;
      signals.push(context.semanticFindSignal);
      entered[index].resolve();
      await releases[index].promise;
      return { success: true, data: {} };
    },
    async sendProgress() {}
  });

  const replaced = service.handle(request(), sender());
  await entered[0].promise;
  const replacement = await service.commitTrustedDocument({
    senderExtensionId: runtimeId, senderTabId: 17, senderFrameId: 3,
    senderDocumentId: 'doc-next'
  });
  assert.equal(replacement.cancelled, 1);
  assert.equal(signals[0].aborted, true);
  releases[0].resolve();
  assert.equal((await replaced).error.code, 'CANCELLED');

  const retired = service.handle(request({ operationId: 'semantic-operation-0002' }),
    sender({ documentId: 'doc-next' }));
  await entered[1].promise;
  const retirement = await service.retireTrustedTab({
    senderExtensionId: runtimeId, senderTabId: 17
  });
  assert.equal(retirement.cancelled, 1);
  assert.equal(signals[1].aborted, true);
  releases[1].resolve();
  assert.equal((await retired).error.code, 'CANCELLED');
});

test('rejects malformed engine progress instead of forwarding score-like data', async () => {
  const deliveries = [];
  const service = createSemanticFindService({
    runtimeExtensionId: runtimeId,
    async runRequest(_message, context) {
      await context.onSemanticFindProgress({
        processed: 1, total: 1, skipped: 0,
        scores: [{ id: 'semantic_sentence_0', score: '0.9' }],
        done: true, coverage: 'full'
      });
      return { success: true, data: {} };
    },
    async sendProgress(target, payload) { deliveries.push({ target, payload }); }
  });
  const response = await service.handle(request(), sender());
  assert.equal(response.success, false);
  assert.equal(response.error.code, 'SEMANTIC_FIND_INVALID_PROGRESS');
  assert.deepEqual(deliveries, []);
});

test('service worker loads and wires the isolated semantic-find service and settings action', () => {
  const source = readFileSync(join(__dirname, '..', 'background.js'), 'utf8');
  const serviceSource = readFileSync(
    join(__dirname, '..', 'core', 'semantic-find-service.js'), 'utf8'
  );
  assert.ok(source.indexOf("'core/semantic-find.js'") >= 0);
  assert.ok(source.indexOf("'core/semantic-find-service.js'") >
    source.indexOf("'core/semantic-find.js'"));
  assert.ok(source.indexOf("'core/background-router.js'") >
    source.indexOf("'core/semantic-find-service.js'"));
  assert.match(source, /SciLLM\.createSemanticFindService\s*\(/u);
  assert.match(source, /semanticFindService\.handle\(message, sender\)/u);
  assert.match(serviceSource, /action:\s*'semanticFindProgress'/u);
  assert.match(source, /frameId:\s*target\.frameId/u);
  assert.match(source, /documentId:\s*target\.documentId/u);
  assert.match(source, /message\?\.type === 'SEMANTIC_FIND_OPEN_SETTINGS'/u);
  assert.match(source, /trustedOriginProgressTarget\(sender, chrome\.runtime\.id\)/u);
  assert.match(source, /options\.html#page=models&task=semantic_find/u);
});
