const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const native = require('../core/pdf-native-reader-state.js');

test('native reading positions are bound to original bytes with bounded page-relative geometry', () => {
  const hash = 'd'.repeat(64);
  const position = { version: 1, documentHash: hash, pageNumber: 11, scale: 1.7, pageOffset: 0.35 };
  assert.deepEqual(native.normalizePdfNativeReadingPosition(position, hash, 14), position);
  for (const patch of [{ documentHash: 'e'.repeat(64) }, { pageNumber: 15 },
    { pageNumber: 0 }, { pageNumber: 1.5 }, { pageOffset: -0.1 }, { pageOffset: 1.1 },
    { scale: Infinity }, { scale: 0 }, { version: 2 }]) {
    assert.equal(native.normalizePdfNativeReadingPosition({ ...position, ...patch }, hash, 14), null);
  }
  assert.equal(native.normalizePdfNativeReadingPosition(null, hash, 14), null);
  assert.equal(native.normalizePdfNativeReadingPosition(position, 'unbound', 14), null);
});

test('normalizes and clamps native PDF zoom to two decimal places', () => {
  const state = native.createPdfNativeReaderState({
    initialScale: 1.35,
    minScale: 0.5,
    maxScale: 3
  });

  assert.equal(state.getScale(), 1.35);
  assert.equal(state.setScale(1.236), 1.24);
  assert.equal(state.setScale(0.1), 0.5);
  assert.equal(state.setScale(9), 3);
  assert.equal(state.setScale('1.999'), 2);

  const fractionalBounds = native.createPdfNativeReaderState({
    initialScale: 9, minScale: 0.504, maxScale: 1.236
  });
  assert.equal(fractionalBounds.getScale(), 1.23);
  assert.equal(fractionalBounds.setScale(0.1), 0.51);
  assert.equal(fractionalBounds.setScale(9), 1.23);

  const hostileBounds = native.createPdfNativeReaderState({
    minScale: Number.MAX_VALUE,
    maxScale: Number.MAX_VALUE
  });
  assert.equal(hostileBounds.getScale(), 1.35);
  assert.equal(hostileBounds.setScale(9), 3);
});

test('fits width and keeps a bounded overscanned page window', () => {
  const state = native.createPdfNativeReaderState({
    minScale: 0.5, maxScale: 3, overscan: 1, maxLivePages: 7
  });

  assert.equal(state.fitWidth({
    pageWidth: 612, containerWidth: 1000, padding: 32
  }), 1.58);
  assert.deepEqual(state.pageWindow({
    firstVisible: 8, lastVisible: 10, pageCount: 30
  }), [7, 8, 9, 10, 11]);
  assert.equal(state.setScale(9), 3);
});

test('page window respects document bounds and maxLivePages', () => {
  const state = native.createPdfNativeReaderState({ overscan: 2, maxLivePages: 5 });

  assert.deepEqual(state.pageWindow({
    firstVisible: 1, lastVisible: 2, pageCount: 12
  }), [1, 2, 3, 4]);
  assert.deepEqual(state.pageWindow({
    firstVisible: 10, lastVisible: 12, pageCount: 12
  }), [8, 9, 10, 11, 12]);
  assert.deepEqual(state.pageWindow({
    firstVisible: 4, lastVisible: 10, pageCount: 20
  }), [4, 5, 6, 7, 8]);

  const oversizedOverscan = native.createPdfNativeReaderState({
    overscan: 20, maxLivePages: 5
  });
  assert.deepEqual(oversizedOverscan.pageWindow({
    firstVisible: 8, lastVisible: 10, pageCount: 30
  }), [7, 8, 9, 10, 11]);
});

test('invalid scale, fit-width, options, and window input stay safe', () => {
  const state = native.createPdfNativeReaderState({
    initialScale: 'invalid',
    minScale: -1,
    maxScale: 0,
    overscan: -4,
    maxLivePages: 0
  });

  assert.equal(state.getScale(), 1.35);
  assert.equal(state.setScale(NaN), 1.35);
  assert.equal(state.setScale(Infinity), 1.35);
  assert.equal(state.fitWidth({ pageWidth: 0, containerWidth: 1000 }), 1.35);
  assert.equal(state.fitWidth({ pageWidth: 612, containerWidth: 20, padding: 32 }), 1.35);
  assert.equal(state.fitWidth(null), 1.35);
  assert.deepEqual(state.pageWindow({
    firstVisible: 0, lastVisible: 99, pageCount: 3
  }), [1, 2, 3]);
  assert.deepEqual(state.pageWindow({ firstVisible: 1, lastVisible: 1, pageCount: 0 }), []);
  assert.deepEqual(state.pageWindow(null), []);

  const invertedBounds = native.createPdfNativeReaderState({
    initialScale: 'invalid', minScale: 4, maxScale: 2
  });
  assert.equal(invertedBounds.getScale(), 2);
  assert.equal(invertedBounds.setScale(0.1), 2);

  const highMinimum = native.createPdfNativeReaderState({
    initialScale: 'invalid', minScale: 2, maxScale: 4
  });
  assert.equal(highMinimum.getScale(), 2);

  const throwsOnConversion = {
    valueOf() { throw new Error('conversion must be contained'); }
  };
  assert.doesNotThrow(() => state.setScale(Symbol('scale')));
  assert.equal(state.setScale(throwsOnConversion), 1.35);
  assert.doesNotThrow(() => state.fitWidth({
    pageWidth: throwsOnConversion,
    containerWidth: Symbol('width')
  }));
  assert.deepEqual(state.pageWindow({
    firstVisible: Symbol('first'),
    lastVisible: throwsOnConversion,
    pageCount: 3
  }), [1, 2]);
});

test('page window clamps hostile capacities and never performs a large allocation', () => {
  const state = native.createPdfNativeReaderState({
    overscan: 4294967296,
    maxLivePages: 4294967296
  });

  const pages = state.pageWindow({
    firstVisible: 1000,
    lastVisible: 1000,
    pageCount: Number.MAX_VALUE
  });
  assert.equal(pages.length, 64);
  assert.equal(pages.includes(1000), true);
  assert.equal(pages.every(Number.isSafeInteger), true);
});

test('reader loads the dependency-free state module before the native ES module', () => {
  const html = fs.readFileSync(path.join(root, 'pdf-reader.html'), 'utf8');
  const source = fs.readFileSync(
    path.join(root, 'core/pdf-native-reader-state.js'), 'utf8'
  );
  const stateScript = '<script src="core/pdf-native-reader-state.js"></script>';
  const readerScript = '<script type="module" src="pdf-native-reader.mjs"></script>';

  assert.doesNotMatch(source, /\b(?:document|window)\b/);
  assert.doesNotMatch(source, /\brequire\s*\(|^\s*import(?:\s|\{|\*)/m);
  assert.match(html, /<script src="core\/pdf-native-reader-state\.js"><\/script>/);
  assert.ok(html.indexOf(stateScript) < html.indexOf(readerScript));
});

test('queued native commands preserve semantic order and derive deltas at replay time', () => {
  const queue = native.createPdfNativeCommandQueue({ maxCommands: 8 });
  let scale = 1.35;
  const calls = [];
  const api = {
    fitWidth() {
      calls.push('fit');
      scale = 1.5;
      return scale;
    },
    zoomBy(delta) {
      calls.push(`delta:${delta}`);
      scale = Math.round((scale + delta) * 100) / 100;
      return scale;
    }
  };

  queue.enqueue('fitWidth');
  queue.enqueue('zoomBy', 0.1);
  queue.enqueue('zoomBy', 0.1);
  assert.equal(queue.size(), 3);
  assert.deepEqual(queue.drain(api), [1.5, 1.6, 1.7]);
  assert.deepEqual(calls, ['fit', 'delta:0.1', 'delta:0.1']);
  assert.equal(queue.size(), 0);
});

test('bridge controller replays queued commands on ready and forwards native state', () => {
  const states = [];
  let readyApi = null;
  let scale = 1;
  const bridge = native.createPdfNativeBridgeController({
    onReady: api => { readyApi = api; },
    onState: next => states.push(next)
  });

  bridge.command('fitWidth');
  bridge.command('zoomBy', 0.1);
  const api = {
    fitWidth: () => (scale = 1.4),
    zoomBy: delta => (scale += delta)
  };
  assert.deepEqual(bridge.onReady(api), [1.4, 1.5]);
  assert.equal(readyApi, api);
  assert.equal(bridge.command('zoomBy', 0.2), 1.7);
  bridge.onState({ scale: 1.7, ready: true });
  assert.deepEqual(states, [{ scale: 1.7, ready: true }]);
});

test('native page geometry is relative to the scrollable viewer', () => {
  const selected = native.selectPdfNativePage([
    { pageNumber: 1, top: -500, bottom: 80 },
    { pageNumber: 2, top: 110, bottom: 690 },
    { pageNumber: 3, top: 710, bottom: 1290 }
  ], { top: 100, bottom: 700 });

  assert.equal(selected.pageNumber, 2);
  assert.equal(native.pdfNativeScrollDelta(130, 165), 35);
  assert.equal(native.pdfNativeAnchoredScrollTop({
    scrollTop: 420, anchorTop: 130, nextAnchorTop: 165
  }), 455);
  assert.equal(native.pdfNativeContentWidth({
    clientWidth: 1000, paddingLeft: '18px', paddingRight: '22px'
  }), 960);
  const fakePage = { getViewport: ({ scale }) => ({ width: 612 * scale }) };
  assert.equal(native.pdfNativeUnscaledPageWidth(fakePage), 612);
});

test('surface and render helpers make fallback exclusive and cancel stale work', () => {
  const viewer = { hidden: false };
  const frame = { hidden: true };
  const cancelled = [];
  const records = [1, 2].map(pageNumber => ({
    renderTask: { cancel: () => cancelled.push(pageNumber) }
  }));

  native.cancelPdfNativeRenders(records);
  native.setPdfNativeSurface({ viewer, frame }, 'fallback');
  assert.deepEqual(cancelled, [1, 2]);
  assert.deepEqual({ viewer: viewer.hidden, frame: frame.hidden }, {
    viewer: true, frame: false
  });
  native.setPdfNativeSurface({ viewer, frame }, 'native');
  assert.deepEqual({ viewer: viewer.hidden, frame: frame.hidden }, {
    viewer: false, frame: true
  });
});

test('reader view surface switches reversibly and activates only the original view', () => {
  let activations = 0;
  let deactivations = 0;
  const originalViewer = { hidden: true };
  const parsedWorkspace = { hidden: false };
  const control = { hidden: false, dataset: { state: 'idle' } };
  const attributes = {};
  const toggle = {
    textContent: '',
    setAttribute(name, value) { attributes[name] = value; }
  };
  const surface = {
    originalViewer,
    parsedWorkspace,
    control,
    toggle,
    nativeReader: {
      activate: () => { activations += 1; },
      deactivate: () => { deactivations += 1; }
    }
  };

  assert.equal(native.setPdfReaderViewSurface(surface, 'original'), 'original');
  assert.equal(originalViewer.hidden, false);
  assert.equal(parsedWorkspace.hidden, true);
  assert.equal(control.hidden, true);
  assert.equal(toggle.textContent, '返回解析结果');
  assert.equal(attributes['aria-pressed'], 'true');
  assert.equal(activations, 1);

  assert.equal(native.setPdfReaderViewSurface(surface, 'parsed'), 'parsed');
  assert.equal(originalViewer.hidden, true);
  assert.equal(parsedWorkspace.hidden, false);
  assert.equal(control.hidden, false);
  assert.equal(toggle.textContent, '查看原始 PDF');
  assert.equal(attributes['aria-pressed'], 'false');
  assert.equal(activations, 1);
  assert.equal(deactivations, 1);
});

test('fit mode survives resize scheduling and manual zoom exits it', () => {
  const state = native.createPdfNativeReaderState();
  assert.equal(state.fitWidth({ pageWidth: 500, containerWidth: 900, padding: 0 }), 1.8);
  assert.equal(state.isFitWidth(), true);
  state.setScale(2);
  assert.equal(state.isFitWidth(), false);

  const callbacks = new Map();
  let timerId = 0;
  const fired = [];
  const scheduler = native.createPdfNativeResizeScheduler(
    () => fired.push('fit'),
    {
      delay: 80,
      setTimer(callback) {
        const id = ++timerId;
        callbacks.set(id, callback);
        return id;
      },
      clearTimer(id) { callbacks.delete(id); }
    }
  );
  scheduler.schedule();
  scheduler.schedule();
  assert.equal(callbacks.size, 1);
  callbacks.values().next().value();
  assert.deepEqual(fired, ['fit']);
});

test('render generation rejects stale completions', () => {
  const generation = native.createPdfNativeRenderGeneration();
  const first = generation.next();
  const second = generation.next();
  assert.equal(generation.isCurrent(first), false);
  assert.equal(generation.isCurrent(second), true);
});

test('render generations abort active work and never let an old token become current', () => {
  const generations = native.createPdfNativeRenderGeneration();
  const first = generations.capture();
  let aborted = 0;
  first.signal.addEventListener('abort', () => { aborted += 1; });
  generations.next();
  const second = generations.capture();
  assert.equal(first.signal.aborted, true);
  assert.equal(aborted, 1);
  assert.equal(generations.isCurrent(first), false);
  assert.equal(generations.isCurrent(second), true);
  assert.notEqual(first.signal, second.signal);
});

test('an old render finally cannot clear a newer task and current blank pages reschedule', () => {
  const oldTask = { id: 'old' };
  const newTask = { id: 'new' };
  const record = {
    renderTask: newTask, renderingGeneration: 2,
    mounted: true, rendered: false
  };
  let rescheduled = 0;
  assert.equal(native.completePdfNativeRender(record, {
    task: oldTask, generation: 1, currentGeneration: 2,
    wanted: true, reschedule: () => { rescheduled += 1; }
  }), false);
  assert.equal(record.renderTask, newTask);
  assert.equal(record.renderingGeneration, 2);
  assert.equal(rescheduled, 0);

  assert.equal(native.completePdfNativeRender(record, {
    task: newTask, generation: 2, currentGeneration: 2,
    wanted: true, reschedule: () => { rescheduled += 1; }
  }), true);
  assert.equal(record.renderTask, null);
  assert.equal(record.renderingGeneration, 0);
  assert.equal(rescheduled, 1);
});

test('terminal render failure prevents an initialization tail from reviving native view', () => {
  const lifecycle = native.createPdfNativeLifecycle();
  const viewer = { hidden: false, dataset: { state: 'loading' } };
  const frame = { hidden: true };
  const initialization = lifecycle.begin();

  lifecycle.fail();
  native.setPdfNativeSurface({ viewer, frame }, 'fallback');
  viewer.dataset.state = 'error';

  if (lifecycle.canCommit(initialization)) {
    viewer.dataset.state = 'ready';
    native.setPdfNativeSurface({ viewer, frame }, 'native');
  }

  assert.equal(lifecycle.isTerminal(), true);
  assert.equal(lifecycle.canCommit(initialization), false);
  assert.equal(viewer.dataset.state, 'error');
  assert.equal(viewer.hidden, true);
  assert.equal(frame.hidden, false);
});

test('bounded task queue caps concurrency and prioritizes the current page', async () => {
  const queue = native.createPdfNativeTaskQueue({ concurrency: 2 });
  const started = [];
  const releases = new Map();
  const task = name => queue.schedule(() => new Promise(resolve => {
    started.push(name);
    releases.set(name, resolve);
  }), { priority: name === 'current' ? 100 : 0 });

  const first = task('first');
  const second = task('second');
  const later = task('later');
  const current = task('current');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(started, ['first', 'second']);
  assert.equal(queue.activeCount(), 2);

  releases.get('first')();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(started, ['first', 'second', 'current']);
  releases.get('second')();
  releases.get('current')();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(started, ['first', 'second', 'current', 'later']);
  releases.get('later')();
  await Promise.all([first, second, later, current]);
  assert.deepEqual(queue.stats(), { active: 0, pending: 0, concurrency: 2 });
});

test('bounded task queue cancels pending work without leaking private payloads', async () => {
  const queue = native.createPdfNativeTaskQueue({ concurrency: 1 });
  let release;
  const active = queue.schedule(() => new Promise(resolve => { release = resolve; }));
  const pending = queue.schedule(() => 'private full text');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(queue.cancelPending(), 1);
  await assert.rejects(pending, error => {
    assert.equal(error.name, 'AbortError');
    assert.doesNotMatch(error.message, /private full text/);
    return true;
  });
  release('done');
  assert.equal(await active, 'done');
});

test('bounded queue deduplicates keys, bounds pending scroll work, and prunes stale generations', async () => {
  const queue = native.createPdfNativeTaskQueue({ concurrency: 1, maxPending: 2 });
  const executed = [];
  let release;
  const active = queue.schedule(({ signal }) => new Promise(resolve => {
    executed.push(`active:${signal.aborted}`);
    release = resolve;
  }), { key: 'page-1', generation: 1 });
  const duplicate = queue.schedule(() => executed.push('duplicate'), {
    key: 'page-1', generation: 1
  });
  assert.equal(active, duplicate);
  const stale = queue.schedule(() => executed.push('stale'), {
    key: 'page-2', generation: 1, priority: 50
  });
  const wanted = queue.schedule(() => executed.push('wanted'), {
    key: 'page-8', generation: 2, priority: 100, wanted: () => true
  });
  const dropped = queue.schedule(() => executed.push('dropped'), {
    key: 'page-9', generation: 2, priority: 1
  });
  await assert.rejects(dropped, { name: 'AbortError' });
  assert.equal(queue.pendingCount() <= 2, true);
  assert.equal(queue.pruneGeneration(2) >= 1, true);
  await assert.rejects(stale, { name: 'AbortError' });
  release('done');
  await active;
  await wanted;
  assert.deepEqual(executed, ['active:false', 'wanted']);
});

test('canvas budget bounds DPR by total pixels and evicts least-recent offscreen pages', () => {
  const budget = native.createPdfNativeCanvasBudget({
    maxPixels: 2_000_000,
    maxBytes: 8_000_000,
    maxLivePages: 2,
    maxOutputScale: 2.5
  });
  assert.equal(budget.outputScale({
    width: 1000, height: 1000, requestedScale: 2.5, usedPixels: 0, current: true
  }), 1.41);
  assert.equal(budget.outputScale({
    width: 1000, height: 1000, requestedScale: 2.5, offscreen: true
  }), 1);
  assert.equal(budget.outputScale({
    width: 10000, height: 10000, requestedScale: 2.5, current: true
  }), 0, 'a page that cannot fit even a low-resolution backing surface must not mount');

  assert.deepEqual(budget.admit(1, { pixels: 900_000, bytes: 3_600_000 }), {
    accepted: true, evicted: []
  });
  assert.deepEqual(budget.admit(2, { pixels: 900_000, bytes: 3_600_000 }), {
    accepted: true, evicted: []
  });
  budget.touch(1);
  assert.deepEqual(budget.admit(3, {
    pixels: 900_000, bytes: 3_600_000, protectedPages: [3]
  }), { accepted: true, evicted: [2] });
  assert.deepEqual(budget.usage(), {
    pixels: 1_800_000, bytes: 7_200_000, livePages: 2
  });
  budget.clear();
  assert.deepEqual(budget.usage(), { pixels: 0, bytes: 0, livePages: 0 });
});

test('canvas budget never goes below DPR 1 and rolls back a rejected admission', () => {
  const budget = native.createPdfNativeCanvasBudget({
    maxPixels: 1_000_000, maxBytes: 4_000_000, maxLivePages: 1
  });
  assert.equal(budget.outputScale({
    width: 800, height: 800, requestedScale: 2.5, current: true
  }), 1.25);
  assert.equal(budget.outputScale({
    width: 1200, height: 1200, requestedScale: 2.5, current: true
  }), 0);
  assert.deepEqual(budget.admit(1, {
    pixels: 900_000, bytes: 3_600_000, protectedPages: [1]
  }), { accepted: true, evicted: [] });
  assert.deepEqual(budget.admit(2, {
    pixels: 900_000, bytes: 3_600_000, protectedPages: [1, 2]
  }), { accepted: false, evicted: [] });
  assert.deepEqual(budget.usage(), {
    pixels: 900_000, bytes: 3_600_000, livePages: 1
  });
});

test('canvas budget accounts staging memory and rolls upgrades back transactionally', () => {
  const budget = native.createPdfNativeCanvasBudget({
    maxPixels: 3_000_000, maxBytes: 12_000_000, maxLivePages: 2
  });
  assert.deepEqual(budget.admit(1, {
    pixels: 800_000, bytes: 3_200_000
  }), { accepted: true, evicted: [] });
  const upgrade = budget.reserve(1, {
    pixels: 1_600_000, bytes: 6_400_000, protectedPages: [1]
  });
  assert.equal(upgrade.accepted, true);
  assert.ok(upgrade.reservation);
  assert.deepEqual(budget.usage(), {
    pixels: 2_400_000, bytes: 9_600_000, livePages: 2
  }, 'the old bitmap and staging bitmap both count until commit');
  assert.equal(budget.rollback(upgrade.reservation), true);
  assert.deepEqual(budget.usage(), {
    pixels: 800_000, bytes: 3_200_000, livePages: 1
  }, 'a cancelled upgrade restores the exact committed budget');

  const committed = budget.reserve(1, {
    pixels: 1_600_000, bytes: 6_400_000, protectedPages: [1]
  });
  assert.equal(committed.accepted, true);
  assert.equal(budget.commit(committed.reservation), true);
  assert.deepEqual(budget.usage(), {
    pixels: 1_600_000, bytes: 6_400_000, livePages: 1
  });
  assert.equal(budget.commit(committed.reservation), false,
    'a consumed reservation cannot commit twice');

  const rejected = budget.reserve(2, {
    pixels: 1_600_000, bytes: 6_400_000, protectedPages: [1, 2]
  });
  assert.deepEqual(rejected, { accepted: false, evicted: [], reservation: null });
  assert.deepEqual(budget.usage(), {
    pixels: 1_600_000, bytes: 6_400_000, livePages: 1
  });
});

test('resource destruction has one owner and source reset revokes only the owned URL', async () => {
  const calls = [];
  await native.destroyPdfNativeDocumentResources({
    pdfDocument: { destroy: async () => calls.push('document') },
    loadingTask: { destroy: async () => calls.push('task') }
  });
  assert.deepEqual(calls, ['document']);
  await native.destroyPdfNativeDocumentResources({
    loadingTask: { destroy: async () => calls.push('task-only') }
  });
  assert.deepEqual(calls, ['document', 'task-only']);

  const reset = [];
  assert.deepEqual(native.resetPdfReaderSourceOwnership({
    objectUrl: 'blob:owned',
    revokeObjectURL: url => reset.push(`revoke:${url}`),
    nativeReader: { replaceDocument: () => reset.push('replace') }
  }), { objectUrl: '', nativePdfBytesPromise: null, localFileBytes: null });
  assert.deepEqual(reset, ['revoke:blob:owned', 'replace']);
});

test('normalized page text is bounded without retaining raw text items', () => {
  const content = { items: Array.from({ length: 100 }, () => ({ str: 'private evidence '.repeat(100) })) };
  const normalized = native.normalizePdfNativePageText(content, { maxLength: 5000 });
  assert.equal(normalized.length, 5000);
  assert.equal(typeof normalized, 'string');
});

test('page mount controller reacquires raw text after virtualization and reactivation', async () => {
  let active = true;
  let disposed = false;
  let textRequests = 0;
  let renders = 0;
  const record = {
    pageNumber: 2,
    mounted: false,
    textContent: null,
    page: {
      async getTextContent() {
        textRequests += 1;
        return { items: [{ str: `page two request ${textRequests}` }] };
      }
    }
  };
  const controller = native.createPdfNativePageMountController({
    getRecord: pageNumber => pageNumber === 2 ? record : null,
    isActive: () => active,
    isDisposed: () => disposed,
    mountLayers(current) {
      current.mounted = true;
      current.canvas = {};
      current.textLayer = {};
    },
    async scheduleRender(current) {
      assert.ok(current.textContent);
      current.rendered = true;
      renders += 1;
    }
  });

  await controller.mount(2, true);
  assert.deepEqual({ textRequests, renders, mounted: record.mounted }, {
    textRequests: 1, renders: 1, mounted: true
  });

  // Virtualization releases all heavy/raw page state.
  Object.assign(record, {
    mounted: false, rendered: false, textContent: null, canvas: null, textLayer: null
  });
  active = false;
  assert.equal(await controller.mount(2), record);
  assert.equal(textRequests, 1);

  active = true;
  await controller.mount(2, true);
  assert.deepEqual({ textRequests, renders, mounted: record.mounted }, {
    textRequests: 2, renders: 2, mounted: true
  });
  disposed = true;
  assert.equal(await controller.mount(2), record);
  assert.equal(textRequests, 2);
});

test('page mount controller reports text extraction failures without exposing page text', async () => {
  const failures = [];
  const record = {
    pageNumber: 9,
    mounted: false,
    textContent: null,
    page: { getTextContent: async () => { throw new Error('private page payload'); } }
  };
  const controller = native.createPdfNativePageMountController({
    getRecord: () => record,
    mountLayers: record => { record.mounted = true; },
    onError: error => failures.push(error.name)
  });
  await assert.rejects(controller.mount(9), /private page payload/);
  assert.deepEqual(failures, ['Error']);
});

test('concurrent page mounts share one in-flight text extraction', async () => {
  let releaseText;
  const textGate = new Promise(resolve => { releaseText = resolve; });
  let textRequests = 0;
  let renders = 0;
  const record = {
    pageNumber: 6,
    mounted: false,
    textContent: null,
    page: {}
  };
  const controller = native.createPdfNativePageMountController({
    getRecord: () => record,
    mountLayers(current) { current.mounted = true; },
    async getTextContent() {
      textRequests += 1;
      await textGate;
      return { items: [{ str: 'shared page text' }] };
    },
    async scheduleRender(current) {
      assert.ok(current.textContent);
      renders += 1;
    }
  });

  const mounts = Array.from({ length: 5 }, () => controller.mount(6, true));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(textRequests, 1);
  releaseText();
  await Promise.all(mounts);
  assert.equal(textRequests, 1);
  assert.equal(renders, 5);
  assert.equal(record.textContent.items[0].str, 'shared page text');
});

test('a replaced page record cannot receive an old text load or failure', async () => {
  let releaseText;
  const textGate = new Promise(resolve => { releaseText = resolve; });
  const oldRecord = { pageNumber: 6, mounted: false, textContent: null, page: {} };
  const newRecord = { pageNumber: 6, mounted: true, textContent: null, page: {} };
  let currentRecord = oldRecord;
  let renders = 0;
  let textFailures = 0;
  const controller = native.createPdfNativePageMountController({
    getRecord: () => currentRecord,
    mountLayers(record) { record.mounted = true; },
    async getTextContent() {
      await textGate;
      throw new Error('old document text failure');
    },
    onTextError() { textFailures += 1; return true; },
    async scheduleRender() { renders += 1; }
  });

  const oldMount = controller.mount(6, true);
  await new Promise(resolve => setImmediate(resolve));
  currentRecord = newRecord;
  releaseText();
  assert.equal(await oldMount, newRecord);
  assert.equal(oldRecord.textContent, null);
  assert.equal(newRecord.textContent, null);
  assert.equal(textFailures, 0);
  assert.equal(renders, 0);
});

test('page mount controller can keep the original canvas usable after a handled text failure', async () => {
  const record = {
    pageNumber: 4, mounted: false, textContent: null,
    page: { getTextContent: async () => { throw new Error('page text failed'); } }
  };
  let renders = 0;
  const controller = native.createPdfNativePageMountController({
    getRecord: () => record,
    mountLayers: current => { current.mounted = true; },
    onTextError(error, current) {
      current.textStatus = 'failed';
      current.textError = error.name;
      return true;
    },
    scheduleRender: async current => {
      assert.equal(current.textContent, null);
      assert.equal(current.textStatus, 'failed');
      renders += 1;
    }
  });

  assert.equal(await controller.mount(4, true), record);
  assert.equal(renders, 1);
  assert.equal(record.textError, 'Error');
});

test('native page content classification distinguishes blank pages from scanned images', () => {
  const imageOps = { paintImageXObject: 85, paintInlineImageXObject: 86,
    paintImageMaskXObject: 83, paintSolidColorImageMask: 90 };
  assert.deepEqual(native.classifyPdfNativePageContent({ items: [] }, { fnArray: [] }, imageOps), {
    textStatus: 'empty', hasVisualContent: false, ocrCandidate: false
  });
  assert.deepEqual(native.classifyPdfNativePageContent({ items: [] }, { fnArray: [10, 85] }, imageOps), {
    textStatus: 'empty', hasVisualContent: true, ocrCandidate: true
  });
  assert.deepEqual(native.classifyPdfNativePageContent({ items: [{ str: 'Native text' }] },
    { fnArray: [85] }, imageOps), {
    textStatus: 'full', hasVisualContent: true, ocrCandidate: false
  });
});

test('document text budget rejects background retention after its total character cap', () => {
  const budget = native.createPdfNativeTextBudget({ maxChars: 100 });
  assert.deepEqual(budget.retain(1, 'a'.repeat(60)), { accepted: true, text: 'a'.repeat(60) });
  assert.deepEqual(budget.retain(2, 'b'.repeat(60)), { accepted: false, text: '' });
  assert.deepEqual(budget.usage(), { characters: 60, pages: 1, maxChars: 100 });
  budget.release(1);
  assert.deepEqual(budget.retain(2, 'b'.repeat(60)), { accepted: true, text: 'b'.repeat(60) });
  budget.clear();
  assert.deepEqual(budget.usage(), { characters: 0, pages: 0, maxChars: 100 });
});
