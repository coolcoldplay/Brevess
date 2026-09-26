const test = require('node:test');
const assert = require('node:assert/strict');

const { createPdfSemanticSidecarCoordinator } =
  require('../core/pdf-semantic-sidecar.js');

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

function sourceInput(overrides = {}) {
  const documentHash = overrides.documentHash || HASH_A;
  return {
    nativeDocument: overrides.nativeDocument || {},
    nativeDocumentKey: '__brevessNativePdfDocument',
    documentHash,
    documentGeneration: overrides.documentGeneration ?? 3,
    revision: overrides.revision ?? 7,
    expectedPageCount: overrides.expectedPageCount ?? 6,
    workspaceDocumentId: `sha256:${documentHash}`,
    ...overrides
  };
}

function canonicalPage(pageNumber, contentHash, overrides = {}) {
  const documentHash = overrides.documentHash || HASH_A;
  const documentGeneration = overrides.documentGeneration ?? 3;
  const revision = overrides.revision ?? 7;
  const text = overrides.text || `Page ${pageNumber} body`;
  return {
    schemaVersion: 1,
    recordType: 'pdf-canonical-page',
    canonicalPageId: `pdf-canonical:${documentHash}:${documentGeneration}:${revision}:${pageNumber}:page-${contentHash}`,
    binding: { documentHash, documentGeneration, revision },
    pageNumber,
    text,
    spans: [{ text, start: 0, end: text.length }],
    contentHash,
    pageHash: overrides.pageHash || `page-${contentHash}`,
    legacyParagraphId: `pdf-page-${pageNumber}`,
    sourceIdentity: `pdf:${pageNumber}`,
    ...overrides
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

async function microtasks(count = 4) {
  for (let index = 0; index < count; index += 1) await Promise.resolve();
}

function delay(milliseconds = 0) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function waitFor(predicate, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('waitFor timeout');
    await delay(1);
  }
}

test('exports a semantic sidecar coordinator factory', () => {
  const api = require('../core/pdf-semantic-sidecar.js');
  assert.equal(typeof api.createPdfSemanticSidecarCoordinator, 'function');
});

test('source identity preserves native and workspace contracts with a cloneable token', () => {
  const coordinator = createPdfSemanticSidecarCoordinator({ buildIndex: async () => ({}) });
  const source = sourceInput();
  const token = coordinator.activateSource(source);
  assert.deepEqual(structuredClone(token), token);
  assert.deepEqual(token, { sourceId: 1, documentHash: HASH_A,
    documentGeneration: 3, revision: 7 });
  assert.throws(() => coordinator.activateSource({ ...source,
    nativeDocumentKey: 'other' }), { code: 'PDF_SIDECAR_NATIVE_DOCUMENT_KEY' });
  assert.throws(() => coordinator.activateSource({ ...source,
    workspaceDocumentId: HASH_A }), { code: 'PDF_SIDECAR_WORKSPACE_ID' });
});

test('rejects stale object, hash, generation, and source revision page work', () => {
  const coordinator = createPdfSemanticSidecarCoordinator({ buildIndex: async () => ({}) });
  const source = sourceInput();
  const token = coordinator.activateSource(source);
  const page = canonicalPage(1, 'content-a');
  const attempts = [
    { sourceToken: token, nativeDocument: {}, record: page },
    { sourceToken: { ...token, documentHash: HASH_B },
      nativeDocument: source.nativeDocument, record: page },
    { sourceToken: { ...token, documentGeneration: 4 },
      nativeDocument: source.nativeDocument, record: page },
    { sourceToken: { ...token, revision: 6 },
      nativeDocument: source.nativeDocument, record: page }
  ];
  for (const attempt of attempts) {
    assert.deepEqual(coordinator.upsertCanonicalPage(attempt),
      { accepted: false, changed: false, reason: 'stale-source' });
  }
  assert.equal(coordinator.getSnapshot().counts.canonicalPages, 0);
});

test('same-content remount ignores pageHash and does not increment revision', async () => {
  const coordinator = createPdfSemanticSidecarCoordinator({ buildIndex: async input =>
    ({ pageNumbers: input.pages.map(page => page.pageNumber) }) });
  const source = sourceInput();
  const token = coordinator.activateSource(source);
  const first = coordinator.upsertCanonicalPage({ sourceToken: token,
    nativeDocument: source.nativeDocument, record: canonicalPage(2, 'same') });
  const remount = coordinator.upsertCanonicalPage({ sourceToken: token,
    nativeDocument: source.nativeDocument,
    record: canonicalPage(2, 'same', { pageHash: 'revision-dependent-other-value' }) });
  assert.equal(first.changed, true);
  assert.equal(first.revision, 8);
  assert.equal(remount.changed, false);
  assert.equal(remount.revision, 8);
  await coordinator.flush();
  assert.equal(coordinator.getSnapshot().revision, 8);
});

test('new or changed canonical content increments revision exactly once', async () => {
  const coordinator = createPdfSemanticSidecarCoordinator({ buildIndex: async () => ({}) });
  const source = sourceInput();
  const token = coordinator.activateSource(source);
  const revisions = [];
  for (const page of [canonicalPage(1, 'a'), canonicalPage(1, 'a'),
    canonicalPage(2, 'b'), canonicalPage(1, 'c')]) {
    revisions.push(coordinator.upsertCanonicalPage({ sourceToken: token,
      nativeDocument: source.nativeDocument, record: page }).revision);
  }
  assert.deepEqual(revisions, [8, 8, 9, 10]);
  await coordinator.flush();
});

test('rejects an async build completed after the canonical revision changed', async () => {
  const builds = [];
  const coordinator = createPdfSemanticSidecarCoordinator({ buildIndex: input => {
    const wait = deferred();
    builds.push({ input, wait });
    return wait.promise;
  } });
  const source = sourceInput();
  const token = coordinator.activateSource(source);
  coordinator.setVisiblePage({ sourceToken: token, nativeDocument: source.nativeDocument,
    pageNumber: 1 });
  coordinator.upsertCanonicalPage({ sourceToken: token,
    nativeDocument: source.nativeDocument, record: canonicalPage(1, 'before') });
  await waitFor(() => builds.length === 1);
  assert.equal(builds.length, 1);
  coordinator.upsertCanonicalPage({ sourceToken: token,
    nativeDocument: source.nativeDocument, record: canonicalPage(1, 'after') });
  builds[0].wait.resolve({ marker: 'stale' });
  await waitFor(() => builds.length === 2);
  assert.equal(builds.length, 2);
  assert.equal(coordinator.getSnapshot().index, null);
  const available = coordinator.whenIndexAvailable();
  builds[1].wait.resolve({ marker: 'current' });
  const snapshot = await available;
  assert.equal(snapshot.index.marker, 'current');
  assert.equal(snapshot.counts.staleBuilds, 1);
});

test('old object, hash, generation, and source revision builds cannot commit after replacement', async () => {
  const variants = [
    current => ({ ...current, nativeDocument: {} }),
    current => sourceInput({ nativeDocument: current.nativeDocument,
      documentHash: HASH_B }),
    current => sourceInput({ nativeDocument: current.nativeDocument,
      documentGeneration: 4 }),
    current => sourceInput({ nativeDocument: current.nativeDocument, revision: 8 })
  ];
  for (const replacement of variants) {
    const pending = deferred();
    const coordinator = createPdfSemanticSidecarCoordinator({ buildIndex: () => pending.promise });
    const source = sourceInput();
    const token = coordinator.activateSource(source);
    coordinator.setVisiblePage({ sourceToken: token, nativeDocument: source.nativeDocument,
      pageNumber: 1 });
    coordinator.upsertCanonicalPage({ sourceToken: token,
      nativeDocument: source.nativeDocument, record: canonicalPage(1, 'old') });
    await waitFor(() => coordinator.getSnapshot().counts.buildsStarted === 1);
    const next = replacement(source);
    coordinator.activateSource(next);
    pending.resolve({ marker: 'must-not-commit' });
    await microtasks(8);
    const snapshot = coordinator.getSnapshot();
    assert.equal(snapshot.index, null);
    assert.equal(snapshot.counts.canonicalPages, 0);
  }
});

test('builds a visible and adjacent partial index before the merged full index', async () => {
  const calls = [];
  const coordinator = createPdfSemanticSidecarCoordinator({ buildIndex: async input => {
    calls.push(input.pages.map(page => page.pageNumber));
    return { built: true };
  } });
  const source = sourceInput({ expectedPageCount: 8 });
  const token = coordinator.activateSource(source);
  coordinator.setVisiblePage({ sourceToken: token, nativeDocument: source.nativeDocument,
    pageNumber: 5 });
  for (const pageNumber of [8, 1, 6, 4, 5]) {
    coordinator.upsertCanonicalPage({ sourceToken: token,
      nativeDocument: source.nativeDocument,
      record: canonicalPage(pageNumber, `content-${pageNumber}`) });
  }
  await waitFor(() => calls.length === 1);
  assert.deepEqual(calls[0], [5, 4, 6]);
  await coordinator.flush();
  assert.deepEqual(calls, [[5, 4, 6], [1, 4, 5, 6, 8]]);
});

test('publishes first-page and partial-index availability without waiting for the full document', async () => {
  const pending = deferred();
  const coordinator = createPdfSemanticSidecarCoordinator({ buildIndex: () => pending.promise });
  const source = sourceInput({ expectedPageCount: 20 });
  const token = coordinator.activateSource(source);
  coordinator.setVisiblePage({ sourceToken: token, nativeDocument: source.nativeDocument,
    pageNumber: 9 });
  const firstPageReady = coordinator.whenFirstPageAvailable();
  const indexReady = coordinator.whenIndexAvailable();
  coordinator.upsertCanonicalPage({ sourceToken: token,
    nativeDocument: source.nativeDocument, record: canonicalPage(9, 'first') });
  const first = await firstPageReady;
  assert.equal(first.counts.canonicalPages, 1);
  assert.equal(first.phase, 'partial');
  let indexSettled = false;
  indexReady.then(() => { indexSettled = true; });
  await microtasks();
  assert.equal(indexSettled, false);
  pending.resolve({ marker: 'partial-index' });
  const indexed = await indexReady;
  assert.equal(indexed.phase, 'partial');
  assert.equal(indexed.index.marker, 'partial-index');
});

test('coalesces page arrivals and performs at most one follow-up build during an in-flight build', async () => {
  const builds = [];
  const coordinator = createPdfSemanticSidecarCoordinator({ buildIndex: input => {
    const wait = deferred();
    builds.push({ pages: input.pages.map(page => page.pageNumber), wait });
    return wait.promise;
  } });
  const source = sourceInput();
  const token = coordinator.activateSource(source);
  coordinator.setVisiblePage({ sourceToken: token, nativeDocument: source.nativeDocument,
    pageNumber: 2 });
  for (const pageNumber of [1, 2, 3]) coordinator.upsertCanonicalPage({
    sourceToken: token, nativeDocument: source.nativeDocument,
    record: canonicalPage(pageNumber, `initial-${pageNumber}`)
  });
  await waitFor(() => builds.length === 1);
  assert.equal(builds.length, 1);
  for (const pageNumber of [4, 5, 6]) coordinator.upsertCanonicalPage({
    sourceToken: token, nativeDocument: source.nativeDocument,
    record: canonicalPage(pageNumber, `later-${pageNumber}`)
  });
  assert.equal(coordinator.markCollectionComplete({ sourceToken: token,
    nativeDocument: source.nativeDocument }).accepted, true);
  assert.equal(builds.length, 1);
  builds[0].wait.resolve({ marker: 'stale-batch' });
  await waitFor(() => builds.length === 2);
  assert.equal(builds.length, 2);
  assert.deepEqual(builds[1].pages, [1, 2, 3, 4, 5, 6]);
  builds[1].wait.resolve({ marker: 'merged-follow-up' });
  await coordinator.flush();
  assert.equal(coordinator.getSnapshot().index.marker, 'merged-follow-up');
});

test('virtual unmount and view deactivation retain canonical records and index', async () => {
  const coordinator = createPdfSemanticSidecarCoordinator({ buildIndex: async () =>
    ({ marker: 'retained' }) });
  const source = sourceInput();
  const token = coordinator.activateSource(source);
  coordinator.upsertCanonicalPage({ sourceToken: token,
    nativeDocument: source.nativeDocument, record: canonicalPage(1, 'retained') });
  await coordinator.flush();
  coordinator.markPageUnmounted({ sourceToken: token,
    nativeDocument: source.nativeDocument, pageNumber: 1 });
  coordinator.deactivateView({ sourceToken: token, nativeDocument: source.nativeDocument });
  const snapshot = coordinator.getSnapshot();
  assert.equal(snapshot.counts.canonicalPages, 1);
  assert.equal(snapshot.index.marker, 'retained');
  assert.equal(snapshot.viewActive, false);
});

test('source replacement clears records and index and aborts old work', async () => {
  const pending = deferred();
  let oldSignal;
  const coordinator = createPdfSemanticSidecarCoordinator({ buildIndex: (_input, context) => {
    oldSignal = context.signal;
    return pending.promise;
  } });
  const first = sourceInput();
  const token = coordinator.activateSource(first);
  coordinator.setVisiblePage({ sourceToken: token, nativeDocument: first.nativeDocument,
    pageNumber: 1 });
  coordinator.setVisiblePage({ sourceToken: token, nativeDocument: first.nativeDocument,
    pageNumber: 1 });
  coordinator.upsertCanonicalPage({ sourceToken: token,
    nativeDocument: first.nativeDocument, record: canonicalPage(1, 'old') });
  await waitFor(() => Boolean(oldSignal));
  coordinator.activateSource(sourceInput({ nativeDocument: {}, documentHash: HASH_B }));
  assert.equal(oldSignal.aborted, true);
  const snapshot = coordinator.getSnapshot();
  assert.equal(snapshot.counts.canonicalPages, 0);
  assert.equal(snapshot.index, null);
  pending.resolve({ marker: 'old' });
});

test('dispose clears state, aborts work, and prevents reactivation', async () => {
  const pending = deferred();
  let signal;
  const coordinator = createPdfSemanticSidecarCoordinator({ buildIndex: (_input, context) => {
    signal = context.signal;
    return pending.promise;
  } });
  const source = sourceInput();
  const token = coordinator.activateSource(source);
  coordinator.setVisiblePage({ sourceToken: token, nativeDocument: source.nativeDocument,
    pageNumber: 1 });
  coordinator.upsertCanonicalPage({ sourceToken: token,
    nativeDocument: source.nativeDocument, record: canonicalPage(1, 'old') });
  await waitFor(() => Boolean(signal));
  coordinator.dispose();
  assert.equal(signal.aborted, true);
  assert.equal(coordinator.getSnapshot().phase, 'disposed');
  assert.equal(coordinator.getSnapshot().counts.canonicalPages, 0);
  assert.throws(() => coordinator.activateSource(source), { code: 'PDF_SIDECAR_DISPOSED' });
  pending.resolve({ marker: 'old' });
});

test('terminal fallback clears canonical and index state and cancels old commits', async () => {
  const pending = deferred();
  let signal;
  const coordinator = createPdfSemanticSidecarCoordinator({ buildIndex: (_input, context) => {
    signal = context.signal;
    return pending.promise;
  } });
  const source = sourceInput();
  const token = coordinator.activateSource(source);
  coordinator.setVisiblePage({ sourceToken: token, nativeDocument: source.nativeDocument,
    pageNumber: 1 });
  coordinator.upsertCanonicalPage({ sourceToken: token,
    nativeDocument: source.nativeDocument, record: canonicalPage(1, 'old') });
  await waitFor(() => Boolean(signal));
  coordinator.enterTerminalFallback({ sourceToken: token,
    nativeDocument: source.nativeDocument, errorCode: 'PDF_NATIVE_TEXT_UNAVAILABLE' });
  assert.equal(signal.aborted, true);
  const snapshot = coordinator.getSnapshot();
  assert.equal(snapshot.phase, 'fallback');
  assert.equal(snapshot.counts.canonicalPages, 0);
  assert.equal(snapshot.index, null);
  pending.resolve({ marker: 'old' });
});

test('progress events expose only approved metadata and sanitize build failures', async () => {
  const events = [];
  const coordinator = createPdfSemanticSidecarCoordinator({ buildIndex: async () => {
    const failure = new Error('secret body at C:\\private\\paper.pdf');
    failure.code = 'unsafe error with spaces';
    throw failure;
  } });
  const unsubscribe = coordinator.subscribe(event => events.push(event));
  const source = sourceInput();
  const token = coordinator.activateSource(source);
  coordinator.upsertCanonicalPage({ sourceToken: token,
    nativeDocument: source.nativeDocument,
    record: canonicalPage(1, 'private', { text: 'unpublished manuscript title' }) });
  await coordinator.flush();
  unsubscribe();
  const allowedKeys = ['phase', 'documentGeneration', 'revision', 'counts'];
  assert.ok(events.length >= 3);
  for (const event of events) {
    assert.deepEqual(Object.keys(event), allowedKeys);
    assert.ok(Object.isFrozen(event));
    assert.ok(Object.isFrozen(event.counts));
    assert.doesNotThrow(() => structuredClone(event));
  }
  const serialized = JSON.stringify(events);
  assert.doesNotMatch(serialized, /unpublished|manuscript|private|paper\.pdf|secret|unsafe error/iu);
  assert.equal(coordinator.getSnapshot().errorCode, 'PDF_SIDECAR_BUILD_FAILED');
});

test('build input preserves legacy identities and is structured-cloneable', async () => {
  let observed;
  const coordinator = createPdfSemanticSidecarCoordinator({ buildIndex: async input => {
    observed = input;
    assert.doesNotThrow(() => structuredClone(input));
    return { nested: { pages: input.pages.map(page => page.legacyParagraphId) } };
  } });
  const source = sourceInput();
  const token = coordinator.activateSource(source);
  const record = canonicalPage(4, 'legacy');
  coordinator.upsertCanonicalPage({ sourceToken: token,
    nativeDocument: source.nativeDocument, record });
  record.text = 'caller mutation';
  await coordinator.flush();
  assert.equal(observed.nativeDocumentKey, '__brevessNativePdfDocument');
  assert.equal(observed.workspaceDocumentId, `sha256:${HASH_A}`);
  assert.equal(observed.pages[0].legacyParagraphId, 'pdf-page-4');
  assert.equal(observed.pages[0].sourceIdentity, 'pdf:4');
  assert.equal(observed.pages[0].text, 'Page 4 body');
  const snapshot = coordinator.getSnapshot();
  assert.ok(Object.isFrozen(snapshot));
  assert.ok(Object.isFrozen(snapshot.index));
  assert.ok(Object.isFrozen(snapshot.index.nested));
  assert.doesNotThrow(() => structuredClone(snapshot));
  assert.equal('cache' in snapshot, false);
  assert.equal('persistentCache' in snapshot, false);
});

test('an uncloneable build result becomes a sanitized degraded state', async () => {
  const coordinator = createPdfSemanticSidecarCoordinator({ buildIndex: async () =>
    ({ forbidden: () => 'not cloneable' }) });
  const source = sourceInput();
  const token = coordinator.activateSource(source);
  coordinator.upsertCanonicalPage({ sourceToken: token,
    nativeDocument: source.nativeDocument, record: canonicalPage(1, 'clone-failure') });
  await coordinator.flush();
  const snapshot = coordinator.getSnapshot();
  assert.equal(snapshot.degraded, true);
  assert.equal(snapshot.errorCode, 'PDF_SIDECAR_INDEX_NOT_CLONEABLE');
  assert.equal(snapshot.index, null);
  assert.equal(snapshot.counts.buildsFailed, 1);
});

test('source replacement resolves every flush waiter only after publishing the new boundary', async () => {
  const pending = deferred();
  const coordinator = createPdfSemanticSidecarCoordinator({ buildIndex: () => pending.promise });
  const first = sourceInput();
  const token = coordinator.activateSource(first);
  coordinator.setVisiblePage({ sourceToken: token, nativeDocument: first.nativeDocument,
    pageNumber: 1 });
  coordinator.upsertCanonicalPage({ sourceToken: token,
    nativeDocument: first.nativeDocument, record: canonicalPage(1, 'old-source') });
  await waitFor(() => coordinator.getSnapshot().counts.buildsStarted === 1);
  const waiters = [coordinator.flush(), coordinator.flush(), coordinator.flush()];
  coordinator.activateSource(sourceInput({ nativeDocument: {}, documentHash: HASH_B }));
  const snapshots = await Promise.all(waiters);
  for (const snapshot of snapshots) {
    assert.equal(snapshot.source.documentHash, HASH_B);
    assert.equal(snapshot.phase, 'loading');
    assert.equal(snapshot.counts.canonicalPages, 0);
    assert.equal(snapshot.index, null);
  }
  pending.resolve({ marker: 'old-source' });
});

test('terminal fallback and dispose settle flush waiters with post-boundary snapshots', async () => {
  for (const boundary of ['fallback', 'dispose']) {
    const pending = deferred();
    const coordinator = createPdfSemanticSidecarCoordinator({ buildIndex: () => pending.promise });
    const source = sourceInput();
    const token = coordinator.activateSource(source);
    coordinator.setVisiblePage({ sourceToken: token, nativeDocument: source.nativeDocument,
      pageNumber: 1 });
    coordinator.upsertCanonicalPage({ sourceToken: token,
      nativeDocument: source.nativeDocument, record: canonicalPage(1, `old-${boundary}`) });
    await waitFor(() => coordinator.getSnapshot().counts.buildsStarted === 1);
    const waits = [coordinator.flush(), coordinator.flush()];
    if (boundary === 'fallback') coordinator.enterTerminalFallback({ sourceToken: token,
      nativeDocument: source.nativeDocument, errorCode: 'PDF_NATIVE_TEXT_UNAVAILABLE' });
    else coordinator.dispose();
    const snapshots = await Promise.all(waits);
    for (const snapshot of snapshots) {
      assert.equal(snapshot.phase, boundary === 'fallback' ? 'fallback' : 'disposed');
      assert.equal(snapshot.counts.canonicalPages, 0);
      assert.equal(snapshot.index, null);
    }
    pending.resolve({ marker: 'old-boundary' });
  }
});

test('default batch gate coalesces page arrivals from separate event-loop tasks', async () => {
  const calls = [];
  const coordinator = createPdfSemanticSidecarCoordinator({ buildIndex: async input => {
    calls.push(input.pages.map(page => page.pageNumber));
    return { marker: `build-${calls.length}` };
  } });
  const source = sourceInput();
  const token = coordinator.activateSource(source);
  for (const pageNumber of [1, 2, 3]) {
    coordinator.upsertCanonicalPage({ sourceToken: token,
      nativeDocument: source.nativeDocument,
      record: canonicalPage(pageNumber, `task-${pageNumber}`) });
    await delay(0);
  }
  await coordinator.flush();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], [1, 2, 3]);
});

test('even a synchronous heavy builder is never invoked inside the upsert call stack', async () => {
  let insideUpsert = false;
  let calledInsideUpsert = null;
  const coordinator = createPdfSemanticSidecarCoordinator({ buildIndex: () => {
    calledInsideUpsert = insideUpsert;
    for (let index = 0; index < 10_000; index += 1) Math.sqrt(index);
    return { marker: 'sync-builder-result' };
  } });
  const source = sourceInput();
  const token = coordinator.activateSource(source);
  insideUpsert = true;
  coordinator.upsertCanonicalPage({ sourceToken: token,
    nativeDocument: source.nativeDocument, record: canonicalPage(1, 'async-boundary') });
  insideUpsert = false;
  assert.equal(calledInsideUpsert, null);
  await coordinator.flush();
  assert.equal(calledInsideUpsert, false);
});

test('index waiters settle with a degraded snapshot after reject or clone failure', async () => {
  for (const buildIndex of [
    async () => { throw new Error('private failure text'); },
    async () => ({ uncloneable: () => null })
  ]) {
    const coordinator = createPdfSemanticSidecarCoordinator({ buildIndex });
    const source = sourceInput();
    const token = coordinator.activateSource(source);
    coordinator.setVisiblePage({ sourceToken: token, nativeDocument: source.nativeDocument,
      pageNumber: 1 });
    const available = coordinator.whenIndexAvailable();
    coordinator.upsertCanonicalPage({ sourceToken: token,
      nativeDocument: source.nativeDocument, record: canonicalPage(1, 'failure') });
    const outcome = await Promise.race([
      available,
      delay(500).then(() => ({ timeout: true }))
    ]);
    assert.notEqual(outcome.timeout, true);
    assert.equal(outcome.phase, 'partial');
    assert.equal(outcome.degraded, true);
    assert.match(outcome.errorCode, /^PDF_SIDECAR_/u);
  }
});

test('ready requires exact 1..expected coverage and rejects out-of-range pages', async () => {
  const coordinator = createPdfSemanticSidecarCoordinator({ buildIndex: async () =>
    ({ marker: 'not-ready-with-hole' }) });
  const source = sourceInput({ expectedPageCount: 3 });
  const token = coordinator.activateSource(source);
  coordinator.setVisiblePage({ sourceToken: token, nativeDocument: source.nativeDocument,
    pageNumber: 1 });
  for (const pageNumber of [1, 2]) coordinator.upsertCanonicalPage({
    sourceToken: token, nativeDocument: source.nativeDocument,
    record: canonicalPage(pageNumber, `coverage-${pageNumber}`)
  });
  assert.deepEqual(coordinator.upsertCanonicalPage({ sourceToken: token,
    nativeDocument: source.nativeDocument, record: canonicalPage(99, 'out-of-range') }),
  { accepted: false, changed: false, reason: 'out-of-range' });
  await coordinator.flush();
  const snapshot = coordinator.getSnapshot();
  assert.equal(snapshot.phase, 'partial');
  assert.equal(snapshot.counts.canonicalPages, 2);
  assert.equal(snapshot.coverage.complete, false);
});

test('exact 1..expected coverage becomes ready after the full index commits', async () => {
  const coordinator = createPdfSemanticSidecarCoordinator({ buildIndex: async input =>
    ({ pageNumbers: input.pages.map(page => page.pageNumber) }) });
  const source = sourceInput({ expectedPageCount: 3 });
  const token = coordinator.activateSource(source);
  for (const pageNumber of [3, 1, 2]) coordinator.upsertCanonicalPage({
    sourceToken: token, nativeDocument: source.nativeDocument,
    record: canonicalPage(pageNumber, `complete-${pageNumber}`)
  });
  await coordinator.flush();
  const snapshot = coordinator.getSnapshot();
  assert.equal(snapshot.phase, 'ready');
  assert.equal(snapshot.coverage.complete, true);
  assert.equal(snapshot.counts.pendingPages, 0);
  assert.deepEqual(snapshot.index.pageNumbers, [1, 2, 3]);
});

test('pendingPages stays nonzero while a newer page set is scheduled or in flight', async () => {
  const pending = deferred();
  const coordinator = createPdfSemanticSidecarCoordinator({ buildIndex: () => pending.promise });
  const source = sourceInput({ expectedPageCount: 3 });
  const token = coordinator.activateSource(source);
  coordinator.setVisiblePage({ sourceToken: token, nativeDocument: source.nativeDocument,
    pageNumber: 1 });
  coordinator.upsertCanonicalPage({ sourceToken: token,
    nativeDocument: source.nativeDocument, record: canonicalPage(1, 'pending') });
  await waitFor(() => coordinator.getSnapshot().counts.buildsStarted === 1);
  const inFlight = coordinator.getSnapshot();
  assert.ok(inFlight.counts.pendingPages > 0);
  assert.equal(inFlight.counts.indexedPages, 0);
  pending.resolve({ marker: 'complete' });
  await coordinator.flush();
});

test('slow unsealed arrivals build only bounded previews until collection seal', async () => {
  const calls = [];
  const coordinator = createPdfSemanticSidecarCoordinator({ batchDelayMs: 10,
    buildIndex: async input => {
      calls.push(input.pages.map(page => page.pageNumber));
      return { call: calls.length };
    } });
  const source = sourceInput({ expectedPageCount: 5 });
  const token = coordinator.activateSource(source);
  coordinator.setVisiblePage({ sourceToken: token, nativeDocument: source.nativeDocument,
    pageNumber: 1 });
  for (const pageNumber of [1, 2, 3, 4, 5]) {
    coordinator.upsertCanonicalPage({ sourceToken: token,
      nativeDocument: source.nativeDocument,
      record: canonicalPage(pageNumber, `slow-${pageNumber}`) });
    await delay(25);
  }
  assert.ok(calls.length >= 2);
  assert.ok(calls.every(call => call.length <= 2));
  assert.ok(calls.every(call => call.every(pageNumber => pageNumber <= 2)));
  assert.equal(calls.filter(call => call.length === 5).length, 0);
  assert.deepEqual(coordinator.markCollectionComplete({ sourceToken: token,
    nativeDocument: source.nativeDocument }),
  { accepted: true, changed: true, sealed: true, revision: 12 });
  await coordinator.flush();
  assert.deepEqual(calls.at(-1), [1, 2, 3, 4, 5]);
  assert.equal(calls.filter(call => call.length === 5).length, 1);
});

test('content revision invalidates the public index and index waiter targets the new revision', async () => {
  const newer = deferred();
  let callCount = 0;
  const coordinator = createPdfSemanticSidecarCoordinator({ batchDelayMs: 0,
    buildIndex: input => {
      callCount += 1;
      return callCount === 1 ? Promise.resolve({ revision: input.revision, marker: 'old' })
        : newer.promise;
    } });
  const source = sourceInput({ expectedPageCount: 1 });
  const token = coordinator.activateSource(source);
  coordinator.upsertCanonicalPage({ sourceToken: token,
    nativeDocument: source.nativeDocument, record: canonicalPage(1, 'old') });
  assert.equal(coordinator.markCollectionComplete({ sourceToken: token,
    nativeDocument: source.nativeDocument }).accepted, true);
  await coordinator.flush();
  assert.equal(coordinator.getSnapshot().index.marker, 'old');
  coordinator.setVisiblePage({ sourceToken: token, nativeDocument: source.nativeDocument,
    pageNumber: 1 });
  coordinator.upsertCanonicalPage({ sourceToken: token,
    nativeDocument: source.nativeDocument, record: canonicalPage(1, 'new') });
  const invalidated = coordinator.getSnapshot();
  assert.equal(invalidated.index, null);
  assert.equal(invalidated.counts.indexedPages, 0);
  let settled = false;
  const currentIndex = coordinator.whenIndexAvailable().then(snapshot => {
    settled = true;
    return snapshot;
  });
  await microtasks();
  assert.equal(settled, false);
  await waitFor(() => callCount === 2);
  newer.resolve({ revision: invalidated.revision, marker: 'new' });
  const snapshot = await currentIndex;
  assert.equal(snapshot.revision, invalidated.revision);
  assert.equal(snapshot.index.marker, 'new');
});

test('a stale preview does not suppress the next revision visible preview', async () => {
  const builds = [];
  const coordinator = createPdfSemanticSidecarCoordinator({ batchDelayMs: 0,
    buildIndex: input => {
      const wait = deferred();
      builds.push({ pages: input.pages.map(page => page.pageNumber),
        revision: input.revision, wait });
      return wait.promise;
    } });
  const source = sourceInput({ expectedPageCount: 6 });
  const token = coordinator.activateSource(source);
  coordinator.setVisiblePage({ sourceToken: token, nativeDocument: source.nativeDocument,
    pageNumber: 5 });
  coordinator.upsertCanonicalPage({ sourceToken: token,
    nativeDocument: source.nativeDocument, record: canonicalPage(1, 'background') });
  coordinator.upsertCanonicalPage({ sourceToken: token,
    nativeDocument: source.nativeDocument, record: canonicalPage(5, 'visible') });
  await waitFor(() => builds.length === 1);
  assert.deepEqual(builds[0].pages, [5]);
  coordinator.upsertCanonicalPage({ sourceToken: token,
    nativeDocument: source.nativeDocument, record: canonicalPage(4, 'adjacent') });
  const newRevision = coordinator.getSnapshot().revision;
  const available = coordinator.whenIndexAvailable();
  builds[0].wait.resolve({ marker: 'stale-preview' });
  await waitFor(() => builds.length === 2);
  assert.equal(builds[1].revision, newRevision);
  assert.deepEqual(builds[1].pages, [5, 4]);
  builds[1].wait.resolve({ marker: 'current-preview' });
  const snapshot = await available;
  assert.equal(snapshot.index.marker, 'current-preview');
  assert.equal(snapshot.revision, newRevision);
  assert.equal(snapshot.counts.staleBuilds, 1);
});

test('markCollectionComplete validates source and coverage and is idempotent', async () => {
  const coordinator = createPdfSemanticSidecarCoordinator({ buildIndex: async () => ({}) });
  const first = sourceInput({ expectedPageCount: 2 });
  const staleToken = coordinator.activateSource(first);
  const source = sourceInput({ nativeDocument: {}, expectedPageCount: 2, revision: 8 });
  const token = coordinator.activateSource(source);
  assert.deepEqual(coordinator.markCollectionComplete({ sourceToken: staleToken,
    nativeDocument: first.nativeDocument }),
  { accepted: false, changed: false, reason: 'stale-source' });
  coordinator.upsertCanonicalPage({ sourceToken: token, nativeDocument: source.nativeDocument,
    record: canonicalPage(1, 'one', { revision: 8 }) });
  assert.deepEqual(coordinator.markCollectionComplete({ sourceToken: token,
    nativeDocument: source.nativeDocument }),
  { accepted: false, changed: false, reason: 'incomplete-collection' });
  coordinator.upsertCanonicalPage({ sourceToken: token, nativeDocument: source.nativeDocument,
    record: canonicalPage(2, 'two', { revision: 8 }) });
  const sealed = coordinator.markCollectionComplete({ sourceToken: token,
    nativeDocument: source.nativeDocument });
  assert.deepEqual(sealed,
    { accepted: true, changed: true, sealed: true, revision: 10 });
  assert.deepEqual(coordinator.markCollectionComplete({ sourceToken: token,
    nativeDocument: source.nativeDocument }),
  { accepted: true, changed: false, sealed: true, revision: 10 });
  await coordinator.flush();
});

test('sealed collections keep same-content remounts but content changes invalidate seal and index', async () => {
  const coordinator = createPdfSemanticSidecarCoordinator({ buildIndex: async input =>
    ({ revision: input.revision }) });
  const source = sourceInput({ expectedPageCount: 2 });
  const token = coordinator.activateSource(source);
  coordinator.upsertCanonicalPage({ sourceToken: token, nativeDocument: source.nativeDocument,
    record: canonicalPage(1, 'one') });
  coordinator.upsertCanonicalPage({ sourceToken: token, nativeDocument: source.nativeDocument,
    record: canonicalPage(2, 'two') });
  coordinator.markCollectionComplete({ sourceToken: token,
    nativeDocument: source.nativeDocument });
  await coordinator.flush();
  assert.equal(coordinator.getSnapshot().collectionSealed, true);
  const remount = coordinator.upsertCanonicalPage({ sourceToken: token,
    nativeDocument: source.nativeDocument,
    record: canonicalPage(1, 'one', { pageHash: 'remount-page-hash' }) });
  assert.equal(remount.changed, false);
  assert.equal(coordinator.getSnapshot().collectionSealed, true);
  const changed = coordinator.upsertCanonicalPage({ sourceToken: token,
    nativeDocument: source.nativeDocument, record: canonicalPage(1, 'one-updated') });
  assert.equal(changed.changed, true);
  assert.equal(coordinator.getSnapshot().collectionSealed, false);
  assert.equal(coordinator.getSnapshot().index, null);
  assert.deepEqual(coordinator.upsertCanonicalPage({ sourceToken: token,
    nativeDocument: source.nativeDocument, record: canonicalPage(3, 'new-out-of-range') }),
  { accepted: false, changed: false, reason: 'out-of-range' });
});

test('visible target changes make an in-flight same-revision preview stale', async () => {
  const builds = [];
  const coordinator = createPdfSemanticSidecarCoordinator({ batchDelayMs: 0,
    buildIndex: input => {
      const wait = deferred();
      builds.push({ pages: input.pages.map(page => page.pageNumber),
        revision: input.revision, wait });
      return wait.promise;
    } });
  const source = sourceInput({ expectedPageCount: 6 });
  const token = coordinator.activateSource(source);
  coordinator.setVisiblePage({ sourceToken: token, nativeDocument: source.nativeDocument,
    pageNumber: 1 });
  for (const pageNumber of [1, 4, 5]) coordinator.upsertCanonicalPage({
    sourceToken: token, nativeDocument: source.nativeDocument,
    record: canonicalPage(pageNumber, `visible-switch-${pageNumber}`)
  });
  await waitFor(() => builds.length === 1);
  assert.deepEqual(builds[0].pages, [1]);
  const revision = builds[0].revision;
  coordinator.setVisiblePage({ sourceToken: token, nativeDocument: source.nativeDocument,
    pageNumber: 5 });
  assert.equal(coordinator.getSnapshot().revision, revision);
  let settled = false;
  const available = coordinator.whenIndexAvailable().then(snapshot => {
    settled = true;
    return snapshot;
  });
  builds[0].wait.resolve({ marker: 'wrong-visible-target' });
  await microtasks(8);
  assert.equal(settled, false);
  await waitFor(() => builds.length === 2);
  assert.equal(builds[1].revision, revision);
  assert.deepEqual(builds[1].pages, [5, 4]);
  builds[1].wait.resolve({ marker: 'current-visible-target' });
  const snapshot = await available;
  assert.equal(snapshot.index.marker, 'current-visible-target');
  assert.equal(snapshot.visiblePageNumber, 5);
});

test('slow preview collection materializes pages linearly and snapshots only for consumers', async () => {
  const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'structuredClone');
  const originalStructuredClone = globalThis.structuredClone;
  let snapshotCalls = 0;
  let snapshotPageUnits = 0;
  let buildPageUnits = 0;
  const calls = [];
  Object.defineProperty(globalThis, 'structuredClone', { configurable: true, writable: true,
    value(value, options) {
      if (value?.phase && Array.isArray(value.pages)) {
        snapshotCalls += 1;
        snapshotPageUnits += value.pages.length;
      }
      return originalStructuredClone(value, options);
    } });
  try {
    const pageCount = 20;
    const coordinator = createPdfSemanticSidecarCoordinator({ batchDelayMs: 0,
      buildIndex: async input => {
        const pageNumbers = input.pages.map(page => page.pageNumber);
        calls.push(pageNumbers);
        buildPageUnits += pageNumbers.length;
        return { call: calls.length };
      } });
    const source = sourceInput({ expectedPageCount: pageCount });
    const token = coordinator.activateSource(source);
    coordinator.setVisiblePage({ sourceToken: token, nativeDocument: source.nativeDocument,
      pageNumber: 1 });
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      coordinator.upsertCanonicalPage({ sourceToken: token,
        nativeDocument: source.nativeDocument,
        record: canonicalPage(pageNumber, `linear-${pageNumber}`) });
      await waitFor(() => calls.length === pageNumber);
    }
    assert.ok(calls.slice(0, -1).every(call => call.length <= 2));
    assert.deepEqual(coordinator.markCollectionComplete({ sourceToken: token,
      nativeDocument: source.nativeDocument }),
    { accepted: true, changed: true, sealed: true, revision: 27 });
    const finalSnapshot = await coordinator.flush();
    assert.deepEqual(calls.at(-1), Array.from({ length: pageCount },
      (_value, index) => index + 1));
    assert.ok(buildPageUnits <= pageCount * 3);
    assert.equal(snapshotCalls, 1);
    assert.equal(snapshotPageUnits, pageCount);
    assert.equal(finalSnapshot.counts.canonicalPages, pageCount);
  } finally {
    if (originalDescriptor) Object.defineProperty(globalThis, 'structuredClone', originalDescriptor);
    else delete globalThis.structuredClone;
  }
});
