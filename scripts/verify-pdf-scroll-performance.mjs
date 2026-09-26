import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

export const DEFAULT_EXPECTED_PAGES = 23;
export const DEFAULT_TARGET_PAGE = 12;
export const DEFAULT_PDF_SHA256 =
  '6980dbe19945fd36ccd200841d8204a22c75404faedd432db23dbb0a70cef5f1';

function positiveInteger(value, code) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(code);
  return parsed;
}

function boundedNumber(value, minimum, maximum, code) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) throw new Error(code);
  return parsed;
}

export function parseArguments(argv = []) {
  const result = {
    headed: false, pdf: '', expectedPages: DEFAULT_EXPECTED_PAGES,
    output: '', targetPage: DEFAULT_TARGET_PAGE, deviceScaleFactor: 1,
    dprTwoPage: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--headed') result.headed = true;
    else if (value === '--pdf') result.pdf = String(argv[++index] || '');
    else if (value === '--expected-pages') {
      result.expectedPages = positiveInteger(argv[++index], 'PDF_SCROLL_INVALID_EXPECTED_PAGES');
    } else if (value === '--output') result.output = String(argv[++index] || '');
    else if (value === '--target-page') {
      result.targetPage = positiveInteger(argv[++index], 'PDF_SCROLL_INVALID_TARGET_PAGE');
    } else if (value === '--device-scale-factor') {
      result.deviceScaleFactor = boundedNumber(argv[++index], 1, 3,
        'PDF_SCROLL_INVALID_DEVICE_SCALE_FACTOR');
    } else if (value === '--dpr-two-page') result.dprTwoPage = true;
    else if (value === '--help') result.help = true;
    else throw new Error(`PDF_SCROLL_UNKNOWN_ARGUMENT_${String(value).replace(/\W+/gu, '_')}`);
  }
  return result;
}

function percentile(values, fraction) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function durations(events, name) {
  return events.filter(event => event.event === name)
    .map(event => Number(event.durationMs)).filter(Number.isFinite);
}

function maximum(values) {
  return values.length ? Math.max(...values) : 0;
}

export function summarizeScrollTrace(input = {}) {
  const startedAt = Number(input.startedAt) || 0;
  const endedAt = Number(input.endedAt) || startedAt;
  const events = (Array.isArray(input.events) ? input.events : []).filter(event =>
    Number(event?.atMs) >= startedAt - 2 && Number(event?.atMs) <= endedAt + 2);
  const frameGaps = (Array.isArray(input.frameGaps) ? input.frameGaps : [])
    .map(Number).filter(Number.isFinite);
  const longTaskDurations = (Array.isArray(input.longTasks) ? input.longTasks : [])
    .filter(entry => Number(entry?.atMs) >= startedAt - 2 &&
      Number(entry?.atMs) <= endedAt + 2)
    .map(entry => Number(entry.durationMs)).filter(Number.isFinite);
  const rendered = events.filter(event => event.event === 'page-rendered');
  const renderCounts = new Map();
  for (const event of rendered) {
    const pageNumber = Number(event.pageNumber) || 0;
    renderCounts.set(pageNumber, (renderCounts.get(pageNumber) || 0) + 1);
  }
  const queueWaits = [];
  const pendingQueued = new Map();
  for (const event of events) {
    const pageNumber = Number(event.pageNumber) || 0;
    if (event.event === 'render-queued') pendingQueued.set(pageNumber, Number(event.atMs));
    if (event.event === 'render-start' && pendingQueued.has(pageNumber)) {
      queueWaits.push(Math.max(0, Number(event.atMs) - pendingQueued.get(pageNumber)));
      pendingQueued.delete(pageNumber);
    }
  }
  const unmountedAt = new Map();
  const reloadDurations = [];
  for (const event of events) {
    const pageNumber = Number(event.pageNumber) || 0;
    if (event.event === 'page-unmount') unmountedAt.set(pageNumber, Number(event.atMs));
    if (event.event === 'page-rendered' && unmountedAt.has(pageNumber)) {
      reloadDurations.push(Math.max(0, Number(event.atMs) - unmountedAt.get(pageNumber)));
      unmountedAt.delete(pageNumber);
    }
  }
  const pdfRenders = events.filter(event => event.event === 'pdfjs-render-complete');
  const canvasPixels = pdfRenders.map(event =>
    Math.max(0, Number(event.canvasWidth) || 0) * Math.max(0, Number(event.canvasHeight) || 0));
  const pagesSeen = events.filter(event => event.event === 'scroll')
    .map(event => Number(event.firstVisible)).filter(value => value > 0);
  const stageSummary = name => {
    const values = durations(events, name);
    return { count: values.length, totalMs: Math.round(values.reduce((sum, value) => sum + value, 0)),
      maxMs: Math.round(maximum(values)) };
  };
  return Object.freeze({
    elapsedMs: Math.max(0, endedAt - startedAt),
    frames: {
      samples: frameGaps.length,
      p95GapMs: Math.round(percentile(frameGaps, 0.95)),
      maxGapMs: Math.round(maximum(frameGaps)),
      gapsOver50Ms: frameGaps.filter(value => value > 50).length,
      gapsOver100Ms: frameGaps.filter(value => value > 100).length
    },
    longTasks: {
      count: longTaskDurations.length,
      totalMs: Math.round(longTaskDurations.reduce((sum, value) => sum + value, 0)),
      maxMs: Math.round(maximum(longTaskDurations))
    },
    input: {
      wheelEvents: events.filter(event => event.event === 'wheel').length,
      scrollEvents: events.filter(event => event.event === 'scroll').length,
      firstVisibleMin: pagesSeen.length ? Math.min(...pagesSeen) : 0,
      firstVisibleMax: pagesSeen.length ? Math.max(...pagesSeen) : 0
    },
    render: {
      renderCount: rendered.length,
      pagesRendered: [...renderCounts.keys()].sort((a, b) => a - b),
      repeatedRenderPages: [...renderCounts.values()].filter(count => count > 1).length,
      maxQueueWaitMs: Math.round(maximum(queueWaits)),
      maxPdfJsPaintMs: stageSummary('pdfjs-render-complete').maxMs,
      totalPdfJsPaintMs: stageSummary('pdfjs-render-complete').totalMs,
      maxCanvasPixels: Math.round(maximum(canvasPixels)),
      maxQueueActive: Math.round(maximum(events.map(event => Number(event.queueActive) || 0))),
      maxQueuePending: Math.round(maximum(events.map(event => Number(event.queuePending) || 0)))
    },
    text: {
      contentLoads: stageSummary('text-content-complete'),
      textLayers: stageSummary('text-layer-complete'),
      semanticInspection: stageSummary('semantic-inspect-complete')
    },
    lifecycle: {
      mountCount: events.filter(event => event.event === 'page-mount').length,
      unmountCount: events.filter(event => event.event === 'page-unmount').length,
      canvasReleaseCount: events.filter(event => event.event === 'canvas-release').length,
      reloadCount: reloadDurations.length,
      maxUnmountToRenderedMs: Math.round(maximum(reloadDurations))
    },
    window: {
      updates: stageSummary('window-complete').count,
      totalUpdateMs: stageSummary('window-complete').totalMs,
      maxUpdateMs: stageSummary('window-complete').maxMs
    }
  });
}

export function assertClearCanvas(sample) {
  assert.ok(Number(sample?.canvasWidth) > 1 && Number(sample?.canvasHeight) > 1,
    'PDF_SCROLL_CANVAS_MISSING');
  assert.ok(Number(sample?.canvasWidth) >= Number(sample?.cssWidth) * 0.95 &&
    Number(sample?.canvasHeight) >= Number(sample?.cssHeight) * 0.95,
  'PDF_SCROLL_CANVAS_LOW_RESOLUTION');
  assert.ok(Number(sample?.inkPixels) >= 50, 'PDF_SCROLL_CANVAS_BLANK');
  return true;
}

export function assertTwoVisibleClearCanvases(samples, expectedDpr) {
  const rows = Array.isArray(samples) ? samples : [];
  const requested = boundedNumber(expectedDpr, 1, 3,
    'PDF_SCROLL_INVALID_DEVICE_SCALE_FACTOR');
  assert.ok(rows.length >= 2, 'PDF_SCROLL_TWO_VISIBLE_PAGES_REQUIRED');
  assert.ok(new Set(rows.map(row => row.pageNumber)).size >= 2,
    'PDF_SCROLL_TWO_DISTINCT_PAGES_REQUIRED');
  for (const row of rows.slice(0, 2)) {
    assert.ok(Number(row.overlapPixels) >= 50,
      'PDF_SCROLL_VISIBLE_PAGE_OVERLAP_TOO_SMALL');
    assertClearCanvas(row);
    assert.ok(Number(row.backingScaleX) + 0.01 >= requested &&
      Number(row.backingScaleY) + 0.01 >= requested,
    'PDF_SCROLL_VISIBLE_PAGE_DPR_REDUCED');
    assert.equal(row.budgetReducedBelowRequestedDpr, false,
      'PDF_SCROLL_VISIBLE_PAGE_BUDGET_REDUCED');
    assert.equal(row.canvasResident, true,
      'PDF_SCROLL_VISIBLE_PAGE_CANVAS_NOT_RESIDENT');
  }
  return true;
}

function copyExtension(root, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const directory of ['core', 'providers', 'vendor', 'icons', '_locales']) {
    fs.cpSync(path.join(root, directory), path.join(destination, directory), { recursive: true });
  }
  for (const file of fs.readdirSync(root)) {
    if (/\.(?:js|mjs|html|css)$/u.test(file) || file === 'manifest.json') {
      fs.copyFileSync(path.join(root, file), path.join(destination, file));
    }
  }
}

export function instrumentNativeReaderSource(value) {
  let source = String(value || '').replaceAll('\r\n', '\n');
  const replaceOnce = (needle, replacement, code) => {
    assert.equal(source.split(needle).length, 2, code);
    source = source.replace(needle, replacement);
  };
  const prefix = `\nconst __pdfScrollPerfTrace = globalThis.__brevessPdfScrollPerfTrace = [];\n` +
    `let __pdfScrollPerfCancelGate = null;\n` +
    `function __pdfScrollPerf(event, pageNumber = 0, details = {}) {\n` +
    `  __pdfScrollPerfTrace.push({ event, pageNumber: Number(pageNumber) || 0, atMs: Date.now(), ...details });\n` +
    `  if (__pdfScrollPerfTrace.length > 50000) __pdfScrollPerfTrace.splice(0, 10000);\n` +
    `}\n`;
  replaceOnce("GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('vendor/pdfjs/build/pdf.worker.min.mjs');\n",
    "GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('vendor/pdfjs/build/pdf.worker.min.mjs');\n" + prefix,
    'PDF_SCROLL_INSTRUMENT_BOOTSTRAP_DRIFT');
  replaceOnce('const pageRecords = new Map();\n', `const pageRecords = new Map();\n` +
    `globalThis.__brevessPdfScrollPerfSnapshot = () => ({\n` +
    `  scale: stateController.getScale(), queue: renderQueue.stats(),\n` +
    `  canvasUsage: canvasBudget.usage(), textUsage: textBudget.usage(),\n` +
    `  currentPage: currentPageRecord()?.pageNumber || 0, scrollTop: viewer?.scrollTop || 0,\n` +
    `  pages: [...pageRecords.values()].map(record => ({ pageNumber: record.pageNumber,\n` +
    `    mounted: record.mounted === true, rendering: record.rendering === true,\n` +
    `    rendered: record.rendered === true, canvasResident: record.canvasResident === true,\n` +
    `    outputScale: Number(record.outputScale) || 0, canvasWidth: record.canvas?.width || 0,\n` +
    `    canvasHeight: record.canvas?.height || 0 }))\n` +
    `});\n`, 'PDF_SCROLL_INSTRUMENT_SNAPSHOT_DRIFT');
  replaceOnce('  const pending = effectivePageTextContent(page, normalizedPage).then(textContent => {\n',
    `  const __scrollTextStarted = performance.now();\n` +
    `  __pdfScrollPerf('text-content-start', normalizedPage);\n` +
    `  const pending = effectivePageTextContent(page, normalizedPage).then(textContent => {\n` +
    `    __pdfScrollPerf('text-content-complete', normalizedPage, {\n` +
    `      durationMs: performance.now() - __scrollTextStarted, itemCount: textContent?.items?.length || 0\n` +
    `    });\n`, 'PDF_SCROLL_INSTRUMENT_TEXT_CONTENT_DRIFT');
  replaceOnce('async function inspectNativePdfPageContent(record, textContent) {\n',
    `async function inspectNativePdfPageContent(record, textContent) {\n` +
    `  const __scrollSemanticStarted = performance.now();\n`,
    'PDF_SCROLL_INSTRUMENT_SEMANTIC_START_DRIFT');
  replaceOnce('  return { normalizedText, classification };\n}\n\nfunction withOcrProvenance',
    `  __pdfScrollPerf('semantic-inspect-complete', record?.pageNumber, {\n` +
    `    durationMs: performance.now() - __scrollSemanticStarted, characters: normalizedText.length\n` +
    `  });\n  return { normalizedText, classification };\n}\n\nfunction withOcrProvenance`,
    'PDF_SCROLL_INSTRUMENT_SEMANTIC_END_DRIFT');
  replaceOnce('function unmountHeavyLayers(record, options = {}) {\n  if (!record?.mounted) return;\n',
    `function unmountHeavyLayers(record, options = {}) {\n  if (!record?.mounted) return;\n` +
    `  __pdfScrollPerf('page-unmount', record.pageNumber, { canvasResident: record.canvasResident === true,\n` +
    `    canvasWidth: record.canvas?.width || 0, canvasHeight: record.canvas?.height || 0 });\n`,
    'PDF_SCROLL_INSTRUMENT_UNMOUNT_DRIFT');
  replaceOnce('function releaseNativePdfCanvas(record) {\n  if (!record?.mounted) return false;\n',
    `function releaseNativePdfCanvas(record) {\n  if (!record?.mounted) return false;\n` +
    `  __pdfScrollPerf('canvas-release', record.pageNumber, { canvasWidth: record.canvas?.width || 0,\n` +
    `    canvasHeight: record.canvas?.height || 0 });\n`,
    'PDF_SCROLL_INSTRUMENT_CANVAS_RELEASE_DRIFT');
  replaceOnce('async function ensureMountedPageTextLayer(record, token, signal) {\n',
    `async function ensureMountedPageTextLayer(record, token, signal) {\n` +
    `  const __scrollTextLayerStarted = performance.now();\n`,
    'PDF_SCROLL_INSTRUMENT_TEXT_LAYER_START_DRIFT');
  replaceOnce(`      await layer.render().catch(error => {\n        throw rememberRenderFailure(error, record.documentGeneration);\n      });\n`,
    `      await layer.render().catch(error => {\n        throw rememberRenderFailure(error, record.documentGeneration);\n      });\n` +
    `      __pdfScrollPerf('text-layer-complete', record.pageNumber, {\n` +
    `        durationMs: performance.now() - __scrollTextLayerStarted, spanCount: stagedLayer.childElementCount\n` +
    `      });\n`, 'PDF_SCROLL_INSTRUMENT_TEXT_LAYER_END_DRIFT');
  replaceOnce('async function renderMountedPage(record, token, signal) {\n',
    `globalThis.__brevessPdfScrollPerfCancelUpgrade = async pageNumber => {\n` +
    `  const record = pageRecords.get(Number(pageNumber));\n` +
    `  if (!record?.mounted || !record.canvasResident || !record.canvas?.isConnected) {\n` +
    `    return { started: false, reason: 'CANVAS_NOT_READY' };\n` +
    `  }\n` +
    `  const previousCanvas = record.canvas;\n` +
    `  const previousOutputScale = record.outputScale;\n` +
    `  const previous = { width: previousCanvas.width, height: previousCanvas.height };\n` +
    `  record.outputScale = 1; record.rendered = true; record.rendering = false;\n` +
    `  const gate = __pdfScrollPerfCancelGate = { pageNumber: record.pageNumber,\n` +
    `    release: null, cancelled: false };\n` +
    `  const pending = scheduleMountedPageRender(record, true);\n` +
    `  const deadline = performance.now() + 5000;\n` +
    `  while ((!record.renderTask || !gate.release) && performance.now() < deadline) {\n` +
    `    await new Promise(resolve => setTimeout(resolve, 0));\n` +
    `  }\n` +
    `  const started = Boolean(record.renderTask && gate.release);\n` +
    `  try { record.renderTask?.cancel?.(); } catch (_) {}\n` +
    `  const preservedImmediately = record.canvas === previousCanvas &&\n` +
    `    previousCanvas.isConnected && previousCanvas.width === previous.width &&\n` +
    `    previousCanvas.height === previous.height;\n` +
    `  gate.cancelled = true; gate.release?.();\n` +
    `  await pending.catch(() => undefined);\n` +
    `  const preservedAfterCancellation = record.canvas === previousCanvas &&\n` +
    `    previousCanvas.isConnected && previousCanvas.width === previous.width &&\n` +
    `    previousCanvas.height === previous.height;\n` +
    `  if (record.canvas === previousCanvas) record.outputScale = previousOutputScale;\n` +
    `  if (__pdfScrollPerfCancelGate === gate) __pdfScrollPerfCancelGate = null;\n` +
    `  return { started, pageNumber: record.pageNumber, previous,\n` +
    `    previousOutputScale, restoredOutputScale: record.outputScale,\n` +
    `    preservedImmediately, preservedAfterCancellation };\n` +
    `};\n\n` +
    `async function renderMountedPage(record, token, signal) {\n` +
    `  const __scrollRenderStarted = performance.now();\n` +
    `  __pdfScrollPerf('render-start', record?.pageNumber, { queueActive: renderQueue.activeCount(),\n` +
    `    queuePending: renderQueue.pendingCount() });\n`, 'PDF_SCROLL_INSTRUMENT_RENDER_START_DRIFT');
  replaceOnce('      localTask = record.page.render({\n',
    `      const __scrollPdfJsStarted = performance.now();\n` +
    `      __pdfScrollPerf('pdfjs-render-start', record.pageNumber, { outputScale });\n` +
    `      localTask = record.page.render({\n`, 'PDF_SCROLL_INSTRUMENT_PDFJS_START_DRIFT');
  replaceOnce('      record.renderTask = localTask;\n      const abort = () =>',
    `      record.renderTask = localTask;\n` +
    `      const __scrollCancelGate = __pdfScrollPerfCancelGate?.pageNumber === record.pageNumber\n` +
    `        ? __pdfScrollPerfCancelGate : null;\n` +
    `      if (__scrollCancelGate) {\n` +
    `        await new Promise(resolve => { __scrollCancelGate.release = resolve; });\n` +
    `        if (__scrollCancelGate.cancelled) {\n` +
    `          await localTask.promise.catch(() => undefined);\n` +
    `          const error = new Error('cancelled by DPR probe');\n` +
    `          error.name = 'RenderingCancelledException';\n` +
    `          throw error;\n` +
    `        }\n` +
    `      }\n` +
    `      const abort = () =>`,
    'PDF_SCROLL_INSTRUMENT_CANCEL_GATE_DRIFT');
  replaceOnce(`      await localTask.promise.catch(error => {\n        throw rememberRenderFailure(error, record.documentGeneration);\n      });\n`,
    `      await localTask.promise.catch(error => {\n        throw rememberRenderFailure(error, record.documentGeneration);\n      });\n` +
    `      __pdfScrollPerf('pdfjs-render-complete', record.pageNumber, {\n` +
    `        durationMs: performance.now() - __scrollPdfJsStarted, outputScale,\n` +
    `        canvasWidth: canvas.width, canvasHeight: canvas.height\n` +
    `      });\n`, 'PDF_SCROLL_INSTRUMENT_PDFJS_END_DRIFT');
  replaceOnce("    record.section.classList.add('is-rendered');\n" +
    "    dispatchPageLifecycleEvent('brevess:pdf-page-rendered', record);\n",
    `    record.section.classList.add('is-rendered');\n` +
    `    __pdfScrollPerf('page-rendered', record.pageNumber, {\n` +
    `      durationMs: performance.now() - __scrollRenderStarted, canvasResident: record.canvasResident === true\n` +
    `    });\n` +
    `    dispatchPageLifecycleEvent('brevess:pdf-page-rendered', record);\n`,
    'PDF_SCROLL_INSTRUMENT_PAGE_RENDERED_DRIFT');
  replaceOnce('function mountPageLayers(record) {\n  if (!record.mounted) {\n',
    `function mountPageLayers(record) {\n  if (!record.mounted) {\n` +
    `    __pdfScrollPerf('page-mount', record.pageNumber);\n`, 'PDF_SCROLL_INSTRUMENT_MOUNT_DRIFT');
  replaceOnce('    const pending = renderQueue.schedule(({ signal }) => renderMountedPage(record, token, signal), {\n',
    `    __pdfScrollPerf('render-queued', record.pageNumber, { current: current === true,\n` +
    `      queueActive: renderQueue.activeCount(), queuePending: renderQueue.pendingCount() });\n` +
    `    const pending = renderQueue.schedule(({ signal }) => renderMountedPage(record, token, signal), {\n`,
    'PDF_SCROLL_INSTRUMENT_QUEUE_DRIFT');
  replaceOnce('async function updatePageWindow(firstVisible, lastVisible) {\n',
    `async function updatePageWindow(firstVisible, lastVisible) {\n` +
    `  const __scrollWindowStarted = performance.now();\n` +
    `  __pdfScrollPerf('window-start', Number(firstVisible) || 0, { firstVisible, lastVisible });\n`,
    'PDF_SCROLL_INSTRUMENT_WINDOW_START_DRIFT');
  replaceOnce('  return pages;\n}\n\nfunction notifyState',
    `  __pdfScrollPerf('window-complete', current, { firstVisible, lastVisible, pages,\n` +
    `    durationMs: performance.now() - __scrollWindowStarted, queueActive: renderQueue.activeCount(),\n` +
    `    queuePending: renderQueue.pendingCount() });\n  return pages;\n}\n\nfunction notifyState`,
    'PDF_SCROLL_INSTRUMENT_WINDOW_END_DRIFT');
  replaceOnce('function applyScale(scale, options = {}) {\n',
    `function applyScale(scale, options = {}) {\n` +
    `  __pdfScrollPerf('scale-apply', currentPageRecord()?.pageNumber || 0, { scale });\n`,
    'PDF_SCROLL_INSTRUMENT_SCALE_DRIFT');
  replaceOnce("viewer?.addEventListener('scroll', () => {\n",
    `viewer?.addEventListener('scroll', () => {\n` +
    `  __pdfScrollPerf('reader-scroll', currentPageRecord()?.pageNumber || 0, { scrollTop: viewer.scrollTop });\n`,
    'PDF_SCROLL_INSTRUMENT_SCROLL_DRIFT');
  return source;
}

function sha256File(filename) {
  return crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
}

function logProgress(stage, details = {}) {
  console.log(JSON.stringify({ pdfScrollProgress: stage, at: new Date().toISOString(), ...details }));
}

function removeTemporary(target) {
  const temporaryRoot = path.resolve(os.tmpdir());
  const resolved = path.resolve(target);
  if (resolved.startsWith(`${temporaryRoot}${path.sep}`) &&
      path.basename(resolved).startsWith('brevess-pdf-scroll-')) {
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}

async function waitForStable(page, timeout = 60_000, label = 'stability') {
  const deadline = Date.now() + timeout;
  let stableSince = 0;
  let stableFingerprint = '';
  let nextLog = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const state = await page.evaluate(() => {
      const snapshot = globalThis.__brevessPdfScrollPerfSnapshot?.();
      const trace = globalThis.__brevessPdfScrollPerfTrace || [];
      return { snapshot, lastEventAt: Number(trace.at(-1)?.atMs) || 0 };
    });
    const quiet = state.snapshot && state.snapshot.queue?.active === 0 &&
      state.snapshot.queue?.pending === 0 &&
      !state.snapshot.pages.some(record => record.rendering);
    const fingerprint = state.snapshot ? JSON.stringify({
      currentPage: state.snapshot.currentPage,
      scrollTop: Math.round(state.snapshot.scrollTop),
      queue: state.snapshot.queue,
      pages: state.snapshot.pages
    }) : '';
    if (quiet && fingerprint === stableFingerprint) {
      stableSince ||= Date.now();
      if (Date.now() - stableSince >= 250) return state.snapshot;
    } else {
      stableFingerprint = fingerprint;
      stableSince = 0;
    }
    if (Date.now() >= nextLog) {
      logProgress(label, { currentPage: state.snapshot?.currentPage || 0,
        queue: state.snapshot?.queue || null,
        renderingPages: state.snapshot?.pages?.filter(record => record.rendering)
          .map(record => record.pageNumber) || [] });
      nextLog = Date.now() + 5_000;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('PDF_SCROLL_STABILITY_TIMEOUT');
}

async function setScaleAndFirstPage(page, mode) {
  const scale = await page.evaluate(async selectedMode => {
    const bridge = globalThis.__brevessPdfReaderBridge;
    const next = selectedMode === 'fitWidth'
      ? bridge.command('fitWidth') : bridge.command('setScale', 1.97);
    bridge.command('focusPage', 1);
    await bridge.command('updatePageWindow', 1, 1);
    return Number(next);
  }, mode);
  await waitForStable(page, 60_000, `${mode}-scale-stability`);
  return scale;
}

async function currentVisiblePage(page) {
  return page.evaluate(() => {
    const viewer = document.getElementById('pdfNativeViewer');
    const bounds = viewer.getBoundingClientRect();
    const pages = [...viewer.querySelectorAll('.pdf-native-page')].map(section => {
      const rect = section.getBoundingClientRect();
      const overlap = Math.max(0, Math.min(bounds.bottom, rect.bottom) - Math.max(bounds.top, rect.top));
      return { pageNumber: Number(section.dataset.pdfPageNumber) || 0, overlap };
    }).filter(item => item.overlap > 0).sort((left, right) => right.overlap - left.overlap);
    return pages[0]?.pageNumber || 1;
  });
}

async function clearScenarioTrace(page) {
  await page.evaluate(() => {
    globalThis.__brevessPdfScrollPerfTrace.splice(0);
    globalThis.__pdfScrollFrames.splice(0);
    globalThis.__pdfScrollLongTasks.splice(0);
  });
}

async function canvasSample(page) {
  return page.evaluate(() => {
    const viewer = document.getElementById('pdfNativeViewer');
    const viewerBounds = viewer.getBoundingClientRect();
    const section = [...viewer.querySelectorAll('.pdf-native-page')].map(element => {
      const bounds = element.getBoundingClientRect();
      return { element, bounds, overlap: Math.max(0,
        Math.min(viewerBounds.bottom, bounds.bottom) - Math.max(viewerBounds.top, bounds.top)) };
    }).filter(row => row.overlap > 0).sort((left, right) => right.overlap - left.overlap)[0]?.element;
    const canvas = section?.querySelector('canvas.pdf-native-page-canvas');
    if (!section || !canvas) return null;
    const bounds = canvas.getBoundingClientRect();
    const sample = document.createElement('canvas');
    sample.width = sample.height = 180;
    const context = sample.getContext('2d', { willReadFrequently: true });
    context.drawImage(canvas, 0, 0, 180, 180);
    const pixels = context.getImageData(0, 0, 180, 180).data;
    let inkPixels = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index + 3] > 200 && pixels[index] < 225 &&
          pixels[index + 1] < 225 && pixels[index + 2] < 225) inkPixels += 1;
    }
    const canvasStyle = getComputedStyle(canvas);
    const sectionStyle = getComputedStyle(section);
    const actualScaleX = bounds.width > 0 ? canvas.width / bounds.width : 0;
    const actualScaleY = bounds.height > 0 ? canvas.height / bounds.height : 0;
    const requestedDpr = Math.min(2.5, Math.max(1, devicePixelRatio || 1));
    return {
      pageNumber: Number(section.dataset.pdfPageNumber) || 0,
      canvasWidth: canvas.width, canvasHeight: canvas.height,
      cssWidth: Math.round(bounds.width), cssHeight: Math.round(bounds.height), inkPixels,
      devicePixelRatio, requestedDpr,
      backingScaleX: Math.round(actualScaleX * 1000) / 1000,
      backingScaleY: Math.round(actualScaleY * 1000) / 1000,
      budgetReducedBelowRequestedDpr: actualScaleX + 0.01 < requestedDpr ||
        actualScaleY + 0.01 < requestedDpr,
      canvasTransform: canvasStyle.transform,
      canvasZoom: canvasStyle.zoom,
      sectionTransform: sectionStyle.transform,
      sectionScaleFactor: sectionStyle.getPropertyValue('--scale-factor').trim(),
      sectionTotalScaleFactor: sectionStyle.getPropertyValue('--total-scale-factor').trim(),
      sectionUserUnit: sectionStyle.getPropertyValue('--user-unit').trim(),
      sectionScaleRoundX: sectionStyle.getPropertyValue('--scale-round-x').trim(),
      sectionScaleRoundY: sectionStyle.getPropertyValue('--scale-round-y').trim()
    };
  });
}

async function visibleCanvasSamples(page) {
  return page.evaluate(() => {
    const viewer = document.getElementById('pdfNativeViewer');
    const viewerBounds = viewer.getBoundingClientRect();
    const perf = globalThis.__brevessPdfScrollPerfSnapshot?.();
    const records = new Map((perf?.pages || []).map(record => [record.pageNumber, record]));
    return [...viewer.querySelectorAll('.pdf-native-page')].map(section => {
      const sectionBounds = section.getBoundingClientRect();
      const overlapPixels = Math.max(0, Math.min(viewerBounds.bottom, sectionBounds.bottom) -
        Math.max(viewerBounds.top, sectionBounds.top));
      return { section, sectionBounds, overlapPixels };
    }).filter(row => row.overlapPixels >= 50).sort((left, right) =>
      left.sectionBounds.top - right.sectionBounds.top
    ).map(row => {
      const canvas = row.section.querySelector('canvas.pdf-native-page-canvas');
      const bounds = canvas?.getBoundingClientRect?.() || { width: 0, height: 0 };
      const sample = document.createElement('canvas');
      sample.width = sample.height = 180;
      const context = sample.getContext('2d', { willReadFrequently: true });
      let inkPixels = 0;
      if (canvas?.width > 1 && canvas?.height > 1) {
        context.drawImage(canvas, 0, 0, 180, 180);
        const pixels = context.getImageData(0, 0, 180, 180).data;
        for (let index = 0; index < pixels.length; index += 4) {
          if (pixels[index + 3] > 200 && pixels[index] < 225 &&
              pixels[index + 1] < 225 && pixels[index + 2] < 225) inkPixels += 1;
        }
      }
      const pageNumber = Number(row.section.dataset.pdfPageNumber) || 0;
      const record = records.get(pageNumber);
      const actualScaleX = bounds.width > 0 ? canvas.width / bounds.width : 0;
      const actualScaleY = bounds.height > 0 ? canvas.height / bounds.height : 0;
      const requestedDpr = Math.min(2.5, Math.max(1, devicePixelRatio || 1));
      return {
        pageNumber, overlapPixels: Math.round(row.overlapPixels),
        canvasWidth: canvas?.width || 0, canvasHeight: canvas?.height || 0,
        cssWidth: Math.round(bounds.width), cssHeight: Math.round(bounds.height), inkPixels,
        devicePixelRatio, requestedDpr,
        backingScaleX: Math.round(actualScaleX * 1000) / 1000,
        backingScaleY: Math.round(actualScaleY * 1000) / 1000,
        budgetReducedBelowRequestedDpr: actualScaleX + 0.01 < requestedDpr ||
          actualScaleY + 0.01 < requestedDpr,
        canvasResident: record?.canvasResident === true,
        recordOutputScale: Number(record?.outputScale) || 0
      };
    });
  });
}

async function positionTwoVisiblePages(page, firstPage = 2) {
  await page.evaluate(async ({ firstPage }) => {
    const bridge = globalThis.__brevessPdfReaderBridge;
    bridge.command('setScale', 1);
    bridge.command('focusPage', firstPage);
    await bridge.command('updatePageWindow', firstPage, firstPage + 1);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const viewer = document.getElementById('pdfNativeViewer');
    const next = viewer.querySelector(
      `.pdf-native-page[data-pdf-page-number="${firstPage + 1}"]`
    );
    const viewerBounds = viewer.getBoundingClientRect();
    const nextBounds = next.getBoundingClientRect();
    viewer.scrollTop += nextBounds.top - viewerBounds.top - viewer.clientHeight / 2;
    await bridge.command('updatePageWindow', firstPage, firstPage + 1);
  }, { firstPage });
  await waitForStable(page, 60_000, 'dpr-two-page-stability');
  return visibleCanvasSamples(page);
}

async function runDprTwoPageScenario(page, outputDirectory, expectedDpr) {
  logProgress('dpr-two-page-start', { expectedDpr });
  const beforeCancellation = await positionTwoVisiblePages(page, 2);
  assertTwoVisibleClearCanvases(beforeCancellation, expectedDpr);
  const targetPage = beforeCancellation[0].pageNumber;
  const cancellation = await page.evaluate(pageNumber =>
    globalThis.__brevessPdfScrollPerfCancelUpgrade?.(pageNumber), targetPage);
  logProgress('dpr-cancel-result', { cancellation });
  assert.equal(cancellation?.started, true, 'PDF_SCROLL_UPGRADE_NOT_STARTED');
  assert.equal(cancellation?.preservedImmediately, true,
    'PDF_SCROLL_UPGRADE_CANCEL_DROPPED_OLD_CANVAS');
  assert.equal(cancellation?.preservedAfterCancellation, true,
    'PDF_SCROLL_UPGRADE_CANCEL_CLEARED_OLD_CANVAS');
  await waitForStable(page, 60_000, 'dpr-upgrade-cancel-stability');
  const afterCancellation = await visibleCanvasSamples(page);
  assertTwoVisibleClearCanvases(afterCancellation, expectedDpr);
  const screenshot = path.join(outputDirectory, '01-dpr2-two-visible-pages.png');
  await page.screenshot({ path: screenshot });
  const result = {
    scale: 1,
    expectedDpr,
    beforeCancellation,
    cancellation,
    afterCancellation,
    canvasUsage: await page.evaluate(() =>
      globalThis.__brevessPdfScrollPerfSnapshot?.()?.canvasUsage || null),
    screenshot: path.basename(screenshot)
  };
  logProgress('dpr-two-page-complete', {
    pages: afterCancellation.map(row => row.pageNumber),
    dimensions: afterCancellation.map(row => [row.canvasWidth, row.canvasHeight]),
    cancellation
  });
  return result;
}

async function scrollUntil(page, direction, targetPage, maximumSteps = 120) {
  await page.locator('#pdfNativeViewer').hover();
  const delta = direction === 'down' ? 820 : -820;
  const deadline = Date.now() + 90_000;
  let steps = 0;
  let visiblePage = await currentVisiblePage(page);
  while (Date.now() < deadline && steps < maximumSteps && (direction === 'down'
    ? visiblePage < targetPage : visiblePage > targetPage)) {
    await page.mouse.wheel(0, delta);
    steps += 1;
    if (steps % 3 === 0) visiblePage = await currentVisiblePage(page);
    if (steps % 12 === 0) logProgress(`wheel-${direction}`,
      { steps, visiblePage, targetPage });
    await new Promise(resolve => setTimeout(resolve, 12));
  }
  visiblePage = await currentVisiblePage(page);
  const complete = direction === 'down' ? visiblePage >= targetPage : visiblePage <= targetPage;
  return { steps, visiblePage, complete };
}

async function measureScroll(page, direction, targetPage, traceFilename = '') {
  logProgress(`measure-${direction}-start`, { targetPage,
    initialVisiblePage: await currentVisiblePage(page) });
  await clearScenarioTrace(page);
  const startedAt = Date.now();
  const movement = await scrollUntil(page, direction, targetPage);
  await waitForStable(page, 60_000, `${direction}-scroll-stability`);
  const endedAt = Date.now();
  const raw = await page.evaluate(({ startedAt, endedAt }) => ({
    events: structuredClone(globalThis.__brevessPdfScrollPerfTrace || []),
    frameGaps: (globalThis.__pdfScrollFrames || []).filter(item =>
      item.atMs >= startedAt - 2 && item.atMs <= endedAt + 2).map(item => item.gapMs),
    longTasks: (globalThis.__pdfScrollLongTasks || []).filter(item =>
      item.atMs >= startedAt - 2 && item.atMs <= endedAt + 2)
  }), { startedAt, endedAt });
  if (traceFilename) {
    fs.writeFileSync(traceFilename, `${JSON.stringify({ startedAt, endedAt, ...raw }, null, 2)}\n`);
  }
  const result = { ...summarizeScrollTrace({ startedAt, endedAt, ...raw }), ...movement,
    clarity: await canvasSample(page),
    ...(traceFilename ? { traceFile: path.basename(traceFilename) } : {}) };
  logProgress(`measure-${direction}-complete`, { targetPage, steps: result.steps,
    visiblePage: result.visiblePage, complete: result.complete, elapsedMs: result.elapsedMs,
    maxFrameGapMs: result.frames.maxGapMs, maxLongTaskMs: result.longTasks.maxMs });
  return result;
}

async function pageTwoTextLayerCssProbe(page) {
  await page.evaluate(async () => {
    const bridge = globalThis.__brevessPdfReaderBridge;
    bridge.command('focusPage', 2);
    await bridge.command('updatePageWindow', 2, 2);
  });
  await waitForStable(page, 60_000, 'page2-css-probe-stability');
  return page.evaluate(() => {
    const section = document.querySelector('.pdf-native-page[data-pdf-page-number="2"]');
    const span = [...(section?.querySelectorAll('.pdf-native-text-layer span') || [])]
      .find(item => String(item.textContent || '').trim().length >= 4);
    const sectionStyle = section ? getComputedStyle(section) : null;
    const spanStyle = span ? getComputedStyle(span) : null;
    return {
      pageNumber: 2,
      spanTextLength: String(span?.textContent || '').length,
      spanComputedFontSize: spanStyle?.fontSize || '',
      spanComputedTransform: spanStyle?.transform || '',
      spanFontHeight: spanStyle?.getPropertyValue('--font-height').trim() || '',
      spanTotalScaleFactor: spanStyle?.getPropertyValue('--total-scale-factor').trim() || '',
      sectionScaleFactor: sectionStyle?.getPropertyValue('--scale-factor').trim() || '',
      sectionTotalScaleFactor: sectionStyle?.getPropertyValue('--total-scale-factor').trim() || '',
      sectionUserUnit: sectionStyle?.getPropertyValue('--user-unit').trim() || '',
      sectionScaleRoundX: sectionStyle?.getPropertyValue('--scale-round-x').trim() || '',
      sectionScaleRoundY: sectionStyle?.getPropertyValue('--scale-round-y').trim() || ''
    };
  });
}

async function waitForDocumentReady(page, expected, timeout = 180_000) {
  const deadline = Date.now() + timeout;
  let nextLog = 0;
  let last = null;
  while (Date.now() < deadline) {
    last = await page.evaluate(({ hash, count }) => {
      const native = globalThis.__brevessNativePdfDocument;
      const semantic = globalThis.__brevessPdfSemanticDocument;
      const first = document.querySelector('.pdf-native-page[data-pdf-page-number="1"]');
      const canvas = first?.querySelector('canvas.pdf-native-page-canvas');
      return {
        ready: native?.phase === 'text-ready' && native?.structure?.documentHash === hash &&
          native?.pageCount === count && semantic?.phase === 'text-ready' &&
          semantic?.indexedPageCount === count && first?.classList.contains('is-rendered') &&
          canvas?.width > 1,
        nativePhase: String(native?.phase || ''), nativePageCount: Number(native?.pageCount) || 0,
        nativeParagraphCount: Number(native?.structure?.diagnostics?.paragraphCount) || 0,
        semanticPhase: String(semantic?.phase || ''),
        semanticIndexedPageCount: Number(semantic?.indexedPageCount) || 0,
        firstRendered: first?.classList.contains('is-rendered') === true,
        firstCanvas: [canvas?.width || 0, canvas?.height || 0],
        perfSnapshot: globalThis.__brevessPdfScrollPerfSnapshot?.() || null
      };
    }, expected);
    if (last.ready) return last;
    if (Date.now() >= nextLog) {
      logProgress('document-load', last);
      nextLog = Date.now() + 10_000;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const error = new Error('PDF_SCROLL_DOCUMENT_READY_TIMEOUT');
  error.diagnostic = last;
  throw error;
}

async function writePageTwoGeometry(page, filename) {
  const geometry = await page.evaluate(async () => {
    const result = await globalThis.__brevessPdfReaderBridge.command('readPageTextContent', 2);
    const content = result?.textContent || {};
    return {
      pageNumber: 2,
      itemCount: Array.isArray(content.items) ? content.items.length : 0,
      items: (content.items || []).map((item, index) => ({
        index, str: String(item.str || ''), dir: String(item.dir || ''),
        width: Number(item.width) || 0, height: Number(item.height) || 0,
        transform: Array.isArray(item.transform) ? item.transform.map(Number) : [],
        fontName: String(item.fontName || ''), hasEOL: item.hasEOL === true
      })),
      styles: Object.fromEntries(Object.entries(content.styles || {}).map(([key, style]) =>
        [key, { fontFamily: String(style?.fontFamily || ''), ascent: Number(style?.ascent) || 0,
          descent: Number(style?.descent) || 0, vertical: style?.vertical === true }]))
    };
  });
  fs.writeFileSync(filename, `${JSON.stringify(geometry, null, 2)}\n`);
  return { pageNumber: 2, itemCount: geometry.itemCount, file: path.basename(filename) };
}

async function run(options = {}) {
  const root = path.resolve(import.meta.dirname, '..');
  const extensionSource = path.resolve(process.env.SCI_EXTENSION_ROOT || root);
  const parsed = { ...parseArguments(process.argv.slice(2)), ...options };
  if (parsed.help) {
    console.log('Usage: node scripts/verify-pdf-scroll-performance.mjs --pdf file --expected-pages N [--headed] [--target-page N] [--device-scale-factor N] [--dpr-two-page] [--output dir]');
    return null;
  }
  const pdfPath = path.resolve(parsed.pdf || path.join(root, 'tmp', 'public-pdf-acceptance',
    'elife-83176-v2.pdf'));
  const expectedPages = positiveInteger(parsed.expectedPages, 'PDF_SCROLL_INVALID_EXPECTED_PAGES');
  const targetPage = Math.min(expectedPages, positiveInteger(parsed.targetPage,
    'PDF_SCROLL_INVALID_TARGET_PAGE'));
  const outputDirectory = path.resolve(parsed.output || path.join(root, 'output', 'playwright',
    `pdf-scroll-performance-${Date.now()}`));
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-pdf-scroll-'));
  const extensionDirectory = path.join(temporaryRoot, 'extension');
  const profileDirectory = path.join(temporaryRoot, 'profile');
  const pdfSha256 = sha256File(pdfPath);
  const report = {
    schemaVersion: 1, status: 'RUNNING',
    scope: parsed.dprTwoPage
      ? 'No-API native PDF DPR2 two-visible-page clarity and Canvas cancellation'
      : 'No-API native PDF sustained wheel scroll performance',
    source: { pdfSha256, expectedPages, extensionRoot: extensionSource },
    targetPage,
    browser: { engine: 'msedge', headed: parsed.headed === true, isolatedProfile: true,
      isolatedExtension: true, deviceScaleFactor: parsed.deviceScaleFactor,
      viewport: { width: 1280, height: parsed.dprTwoPage ? 1100 : 900 } },
    network: { httpRequests: 0, apiRequests: 0 },
    diagnostics: { pageErrors: 0, consoleErrors: 0, workerErrors: 0 },
    implementation: {
      nativeReaderSha256: sha256File(path.join(extensionSource, 'pdf-native-reader.mjs')),
      textProjectionSha256: sha256File(path.join(extensionSource, 'core', 'pdf-text-projection.js'))
    },
    initialization: null, measurements: {}, screenshots: []
  };
  let context;
  let reader;
  let failureStage = 'SOURCE';
  const persistReport = () => {
    fs.mkdirSync(outputDirectory, { recursive: true });
    fs.writeFileSync(path.join(outputDirectory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  };
  try {
    if (!parsed.pdf) assert.equal(pdfSha256, DEFAULT_PDF_SHA256,
      'PDF_SCROLL_DEFAULT_PDF_HASH_MISMATCH');
    copyExtension(extensionSource, extensionDirectory);
    const readerModule = path.join(extensionDirectory, 'pdf-native-reader.mjs');
    fs.writeFileSync(readerModule,
      instrumentNativeReaderSource(fs.readFileSync(readerModule, 'utf8')));
    fs.mkdirSync(outputDirectory, { recursive: true });

    failureStage = 'BROWSER_LAUNCH';
    context = await chromium.launchPersistentContext(profileDirectory, {
      channel: 'msedge', headless: parsed.headed !== true, reducedMotion: 'no-preference',
      viewport: report.browser.viewport,
      deviceScaleFactor: parsed.deviceScaleFactor,
      args: [`--disable-extensions-except=${extensionDirectory}`,
        `--load-extension=${extensionDirectory}`]
    });
    await context.route(/^https?:\/\//u, route => route.abort('blockedbyclient'));
    context.on('request', request => {
      if (!/^https?:\/\//u.test(request.url())) return;
      report.network.httpRequests += 1;
      if (/(?:api\.|openai|deepseek|chat\/completions|responses)/iu.test(request.url())) {
        report.network.apiRequests += 1;
      }
    });
    const worker = context.serviceWorkers()[0] ||
      await context.waitForEvent('serviceworker', { timeout: 15_000 });
    worker.on('console', message => {
      if (message.type() === 'error') report.diagnostics.workerErrors += 1;
    });
    const extensionId = new URL(worker.url()).host;
    reader = await context.newPage();
    reader.on('pageerror', () => { report.diagnostics.pageErrors += 1; });
    reader.on('console', message => {
      if (message.type() === 'error') report.diagnostics.consoleErrors += 1;
    });
    await reader.addInitScript(() => {
      globalThis.__pdfScrollFrames = [];
      globalThis.__pdfScrollLongTasks = [];
      let lastFrame = 0;
      const frame = timestamp => {
        if (lastFrame) globalThis.__pdfScrollFrames.push({ atMs: Date.now(), gapMs: timestamp - lastFrame });
        lastFrame = timestamp;
        if (globalThis.__pdfScrollFrames.length > 50000) globalThis.__pdfScrollFrames.splice(0, 10000);
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
      try {
        const observer = new PerformanceObserver(list => {
          for (const entry of list.getEntries()) {
            globalThis.__pdfScrollLongTasks.push({
              atMs: Math.round(performance.timeOrigin + entry.startTime),
              durationMs: Math.round(entry.duration)
            });
          }
        });
        observer.observe({ type: 'longtask', buffered: true });
      } catch (_) {}
      addEventListener('wheel', event => {
        globalThis.__brevessPdfScrollPerfTrace?.push({ event: 'wheel', atMs: Date.now(),
          deltaY: Number(event.deltaY) || 0 });
      }, { capture: true, passive: true });
      addEventListener('scroll', event => {
        if (event.target?.id !== 'pdfNativeViewer') return;
        const viewer = event.target;
        const bounds = viewer.getBoundingClientRect();
        const first = [...viewer.querySelectorAll('.pdf-native-page')].find(section =>
          section.getBoundingClientRect().bottom > bounds.top + 1);
        globalThis.__brevessPdfScrollPerfTrace?.push({ event: 'scroll', atMs: Date.now(),
          scrollTop: viewer.scrollTop, firstVisible: Number(first?.dataset?.pdfPageNumber) || 0 });
      }, true);
    });
    await reader.goto(`chrome-extension://${extensionId}/pdf-reader.html`, {
      waitUntil: 'domcontentloaded'
    });

    failureStage = 'DOCUMENT_LOAD';
    logProgress('document-load-start', { expectedPages, targetPage });
    const loadStartedAt = Date.now();
    await reader.locator('#pdfLocalFile').setInputFiles(pdfPath);
    await waitForDocumentReady(reader, { hash: pdfSha256, count: expectedPages });
    await waitForStable(reader, 60_000, 'document-load-stability');
    const loadEndedAt = Date.now();
    const loadRaw = await reader.evaluate(({ startedAt, endedAt }) => ({
      events: structuredClone(globalThis.__brevessPdfScrollPerfTrace || []),
      frameGaps: (globalThis.__pdfScrollFrames || []).filter(item =>
        item.atMs >= startedAt && item.atMs <= endedAt).map(item => item.gapMs),
      longTasks: (globalThis.__pdfScrollLongTasks || []).filter(item =>
        item.atMs >= startedAt && item.atMs <= endedAt)
    }), { startedAt: loadStartedAt, endedAt: loadEndedAt });
    report.initialization = summarizeScrollTrace({
      startedAt: loadStartedAt, endedAt: loadEndedAt, ...loadRaw
    });
    report.pageTwoGeometry = await writePageTwoGeometry(reader,
      path.join(outputDirectory, 'page-2-textcontent-geometry.json'));
    report.pageTwoTextLayerCss = await pageTwoTextLayerCssProbe(reader);
    logProgress('document-load-complete', { elapsedMs: loadEndedAt - loadStartedAt,
      pageTwoTextLayerCss: report.pageTwoTextLayerCss });
    persistReport();

    if (parsed.dprTwoPage) {
      failureStage = 'DPR_TWO_PAGE';
      report.measurements.dprTwoPage = await runDprTwoPageScenario(
        reader, outputDirectory, parsed.deviceScaleFactor
      );
      report.screenshots.push(report.measurements.dprTwoPage.screenshot);
      persistReport();
    } else {
    failureStage = 'SCALE_197';
    logProgress('scale-197-start');
    const scale197 = await setScaleAndFirstPage(reader, 'scale197');
    report.measurements.scale197 = { scale: scale197 };
    assert.equal(scale197, 1.97, 'PDF_SCROLL_SCALE_197_NOT_APPLIED');
    report.measurements.scale197.downwardFirstPass =
      await measureScroll(reader, 'down', targetPage,
        path.join(outputDirectory, 'trace-scale-197-down.json'));
    persistReport();
    assert.equal(report.measurements.scale197.downwardFirstPass.complete, true,
      'PDF_SCROLL_DOWN_TARGET_NOT_REACHED');
    assertClearCanvas(report.measurements.scale197.downwardFirstPass.clarity);
    const scaleScreenshot = path.join(outputDirectory, '01-scale-197-downward.png');
    await reader.screenshot({ path: scaleScreenshot });
    report.screenshots.push(path.basename(scaleScreenshot));
    persistReport();
    report.measurements.scale197.upwardReturnPass = await measureScroll(reader, 'up', 1,
      path.join(outputDirectory, 'trace-scale-197-up.json'));
    persistReport();
    assert.equal(report.measurements.scale197.upwardReturnPass.complete, true,
      'PDF_SCROLL_UP_TARGET_NOT_REACHED');
    assertClearCanvas(report.measurements.scale197.upwardReturnPass.clarity);
    logProgress('scale-197-complete', { scale: scale197 });

    failureStage = 'FIT_WIDTH';
    logProgress('fit-width-start');
    const fitScale = await setScaleAndFirstPage(reader, 'fitWidth');
    report.measurements.fitWidth = { scale: fitScale };
    report.measurements.fitWidth.downwardFirstPass =
      await measureScroll(reader, 'down', targetPage,
        path.join(outputDirectory, 'trace-fit-width-down.json'));
    persistReport();
    assert.equal(report.measurements.fitWidth.downwardFirstPass.complete, true,
      'PDF_SCROLL_DOWN_TARGET_NOT_REACHED');
    assertClearCanvas(report.measurements.fitWidth.downwardFirstPass.clarity);
    const fitScreenshot = path.join(outputDirectory, '02-fit-width-downward.png');
    await reader.screenshot({ path: fitScreenshot });
    report.screenshots.push(path.basename(fitScreenshot));
    persistReport();
    report.measurements.fitWidth.upwardReturnPass = await measureScroll(reader, 'up', 1,
      path.join(outputDirectory, 'trace-fit-width-up.json'));
    persistReport();
    assert.equal(report.measurements.fitWidth.upwardReturnPass.complete, true,
      'PDF_SCROLL_UP_TARGET_NOT_REACHED');
    assertClearCanvas(report.measurements.fitWidth.upwardReturnPass.clarity);
    logProgress('fit-width-complete', { scale: fitScale });
    }

    failureStage = 'ASSERTIONS';
    assert.equal(report.network.apiRequests, 0, 'PDF_SCROLL_API_REQUEST_DETECTED');
    assert.equal(report.network.httpRequests, 0, 'PDF_SCROLL_HTTP_REQUEST_DETECTED');
    assert.equal(report.diagnostics.pageErrors, 0, 'PDF_SCROLL_PAGE_ERROR');
    assert.equal(report.diagnostics.workerErrors, 0, 'PDF_SCROLL_WORKER_ERROR');
    report.status = 'PASS';
  } catch (error) {
    report.status = 'FAIL';
    report.failureStage = failureStage;
    report.failureCode = String(error?.message || error).match(/\b[A-Z][A-Z0-9_]{2,100}\b/u)?.[0] ||
      'PDF_SCROLL_UNCLASSIFIED_FAILURE';
    report.failureMessage = String(error?.message || error).slice(0, 500);
    if (error?.diagnostic) report.failureDiagnostic = error.diagnostic;
    report.failureSnapshot = await reader?.evaluate(() =>
      globalThis.__brevessPdfScrollPerfSnapshot?.()).catch(() => null);
    process.exitCode = 1;
  } finally {
    await context?.close().catch(() => undefined);
    removeTemporary(temporaryRoot);
    persistReport();
  }
  console.log(JSON.stringify({ status: report.status, failureStage: report.failureStage || '',
    failureCode: report.failureCode || '', outputDirectory }, null, 2));
  return report;
}

function directInvocation() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
}

if (directInvocation()) await run();
