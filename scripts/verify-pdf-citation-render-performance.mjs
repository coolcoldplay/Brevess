import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

export const EXPECTED_PDF_SHA256 =
  '6980dbe19945fd36ccd200841d8204a22c75404faedd432db23dbb0a70cef5f1';
export const EXPECTED_PAGE_COUNT = 23;
export const DEFAULT_OUTPUT_NAME = 'pdf-citation-performance-20260921-01';

export function parseArguments(argv = []) {
  const result = { headed: false, citationOnly: false, output: '', pdf: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--headed') result.headed = true;
    else if (value === '--citation-only') result.citationOnly = true;
    else if (value === '--output') result.output = String(argv[++index] || '');
    else if (value === '--pdf') result.pdf = String(argv[++index] || '');
    else if (value === '--help') result.help = true;
    else throw new Error(`PDF_PERF_UNKNOWN_ARGUMENT_${String(value).replace(/\W+/gu, '_')}`);
  }
  return result;
}

export function stableFailureCode(error) {
  return String(error?.message || error || '').match(/\b[A-Z][A-Z0-9_]{2,79}\b/u)?.[0] ||
    'PDF_PERF_UNCLASSIFIED_FAILURE';
}

export function summarizeRenderTrace(events = [], pageNumber, startedAt, observedAt) {
  const rows = (Array.isArray(events) ? events : []).filter(event =>
    Number(event?.pageNumber) === Number(pageNumber) &&
    Number(event?.atMs) >= Number(startedAt) - 2 &&
    Number(event?.atMs) <= Number(observedAt) + 2);
  const first = name => rows.find(event => event.event === name)?.atMs ?? null;
  const lastBefore = (name, ceiling) => rows.filter(event => event.event === name &&
    Number(event.atMs) <= Number(ceiling)).at(-1)?.atMs ?? null;
  const pdfStart = first('pdfjs-render-start');
  const pdfComplete = first('pdfjs-render-complete');
  const queued = pdfStart === null ? first('render-queued') : lastBefore('render-queued', pdfStart);
  const renderStart = pdfStart === null ? first('render-start') : lastBefore('render-start', pdfStart);
  const pageRendered = pdfComplete === null ? first('page-rendered') :
    rows.find(event => event.event === 'page-rendered' && event.atMs >= pdfComplete)?.atMs ?? null;
  const overlayApplied = first('overlay-applied');
  const delta = (left, right) => left === null || right === null ? null : Math.max(0, right - left);
  return Object.freeze({
    eventCount: rows.length,
    focusToOverlayMs: delta(startedAt, overlayApplied),
    queueWaitMs: delta(queued, renderStart),
    textLayerMs: delta(renderStart, first('text-layer-ready')),
    pdfJsDecodePaintMs: delta(pdfStart, pdfComplete),
    postPdfJsCommitMs: delta(pdfComplete, pageRendered),
    focusToPageRenderedMs: delta(startedAt, pageRendered),
    verifierObservationLagMs: delta(Math.max(pageRendered || 0, overlayApplied || 0), observedAt),
    milestones: { queued, renderStart, pdfStart, pdfComplete, pageRendered, overlayApplied }
  });
}

export function summarizePdfJsSchedulerTrace(events = [], pageNumber, startedAt, observedAt) {
  const rows = (Array.isArray(events) ? events : []).filter(event =>
    Number(event?.pageNumber) === Number(pageNumber) &&
    Number(event?.atMs) >= Number(startedAt) - 2 &&
    Number(event?.atMs) <= Number(observedAt) + 2);
  const task = rows.find(event => event.event === 'pdfjs-task-created') || null;
  const complete = rows.find(event => event.event === 'pdfjs-render-complete') || null;
  const continuations = rows.filter(event => event.event === 'pdfjs-continuation');
  const probes = rows.filter(event => event.event === 'pdfjs-raf-probe');
  const probeBySequence = new Map(probes.map(event => [Number(event.sequence), event]));
  const waits = probes.map(event => Number(event.waitMs)).filter(Number.isFinite);
  const workSegments = continuations.map((event, index) => {
    const probe = probeBySequence.get(Number(event.sequence));
    const next = continuations[index + 1] || complete;
    if (!probe || !next) return null;
    return Math.max(0, Number(next.atMs) - Number(probe.atMs));
  }).filter(Number.isFinite);
  const gaps = continuations.slice(1).map((event, index) =>
    Math.max(0, Number(event.atMs) - Number(continuations[index].atMs)));
  const total = values => values.reduce((sum, value) => sum + value, 0);
  const maximum = values => values.length ? Math.max(...values) : null;
  return Object.freeze({
    taskCreatedAt: task?.atMs ?? null,
    taskCreateToFirstContinuationMs: task && continuations.length
      ? Math.max(0, continuations[0].atMs - task.atMs) : null,
    continuationCount: continuations.length,
    rafProbeCount: probes.length,
    totalRafWaitMs: total(waits),
    maxRafWaitMs: maximum(waits),
    totalPostRafWorkMs: total(workSegments),
    maxPostRafWorkMs: maximum(workSegments),
    maxContinuationGapMs: maximum(gaps),
    initialOperatorCount: Number(task?.operatorCount) || 0,
    finalOperatorCount: Number(continuations.at(-1)?.operatorCount || task?.operatorCount) || 0,
    finalOperatorIndex: Number(continuations.at(-1)?.operatorIndex) || 0,
    lastChunkAtFinalContinuation: continuations.at(-1)?.lastChunk === true
  });
}

function summarizeLongTasks(entries = [], startedAt, observedAt) {
  const rows = (Array.isArray(entries) ? entries : []).filter(entry =>
    Number(entry?.atMs) >= Number(startedAt) - 2 &&
    Number(entry?.atMs) <= Number(observedAt) + 2);
  const durations = rows.map(entry => Number(entry.durationMs)).filter(Number.isFinite);
  return Object.freeze({
    supported: Array.isArray(entries),
    count: durations.length,
    totalDurationMs: Math.round(durations.reduce((sum, value) => sum + value, 0)),
    maxDurationMs: durations.length ? Math.round(Math.max(...durations)) : 0
  });
}

export function summarizeCrossPageRenderAttribution(
  events = [], longTasks = [], startedAt, observedAt
) {
  const segments = (Array.isArray(events) ? events : []).filter(event =>
    event?.event === 'pdfjs-sync-end' &&
    Number(event?.atMs) >= Number(startedAt) - 2 &&
    Number(event?.startedAtMs) <= Number(observedAt) + 2)
    .map(event => ({
      pageNumber: Number(event.pageNumber) || 0,
      taskId: Number(event.taskId) || 0,
      syncSequence: Number(event.syncSequence) || 0,
      startedAtMs: Number(event.startedAtMs) || Number(event.atMs) || 0,
      endedAtMs: Number(event.atMs) || 0,
      durationMs: Math.max(0, Number(event.durationMs) || 0),
      operatorIndexBefore: Number(event.operatorIndexBefore) || 0,
      operatorIndexAfter: Number(event.operatorIndexAfter) || 0
    }));
  const pageRows = new Map();
  for (const segment of segments) {
    const row = pageRows.get(segment.pageNumber) || {
      pageNumber: segment.pageNumber, taskIds: new Set(), segmentCount: 0,
      totalSyncMs: 0, maxSyncMs: 0, operatorAdvance: 0
    };
    row.taskIds.add(segment.taskId);
    row.segmentCount += 1;
    row.totalSyncMs += segment.durationMs;
    row.maxSyncMs = Math.max(row.maxSyncMs, segment.durationMs);
    row.operatorAdvance += Math.max(0,
      segment.operatorIndexAfter - segment.operatorIndexBefore);
    pageRows.set(segment.pageNumber, row);
  }
  const attributedLongTasks = (Array.isArray(longTasks) ? longTasks : []).filter(entry =>
    Number(entry?.atMs) >= Number(startedAt) - 2 &&
    Number(entry?.atMs) <= Number(observedAt) + 2).map((entry, index) => {
    const longStart = Number(entry.atMs) || 0;
    const durationMs = Math.max(0, Number(entry.durationMs) || 0);
    const longEnd = longStart + durationMs;
    const candidates = segments.map(segment => ({
      pageNumber: segment.pageNumber,
      taskId: segment.taskId,
      syncSequence: segment.syncSequence,
      overlapMs: Math.max(0, Math.min(longEnd, segment.endedAtMs) -
        Math.max(longStart, segment.startedAtMs)),
      segmentDurationMs: segment.durationMs
    })).filter(candidate => candidate.overlapMs > 0)
      .sort((left, right) => right.overlapMs - left.overlapMs).slice(0, 3);
    const strongest = candidates[0] || null;
    return {
      sequence: index + 1, atMs: longStart, durationMs,
      attributedPage: strongest && strongest.overlapMs >= durationMs * 0.5
        ? strongest.pageNumber : 0,
      attributedOverlapMs: strongest?.overlapMs || 0,
      candidates
    };
  });
  return Object.freeze({
    pages: [...pageRows.values()].sort((left, right) => left.pageNumber - right.pageNumber)
      .map(row => ({
        pageNumber: row.pageNumber, taskCount: row.taskIds.size,
        segmentCount: row.segmentCount,
        totalSyncMs: Math.round(row.totalSyncMs),
        maxSyncMs: Math.round(row.maxSyncMs),
        operatorAdvance: row.operatorAdvance
      })),
    longTasks: attributedLongTasks,
    longestLongTaskAttributedPage: attributedLongTasks.slice().sort((left, right) =>
      right.durationMs - left.durationMs)[0]?.attributedPage || 0
  });
}

export function assertRedactedReport(report) {
  const forbiddenKeys = new Set(['quote', 'expectedNormalizedQuote', 'rawText', 'ranges', 'url']);
  const visit = value => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== 'object') {
      if (typeof value === 'string') {
        assert.doesNotMatch(value, /(?:https?:\/\/|file:|chrome-extension:|api[_-]?key)/iu,
          'PDF_PERF_REPORT_LOCATION_OR_SECRET_LEAK');
      }
      return;
    }
    for (const [key, entry] of Object.entries(value)) {
      assert.equal(forbiddenKeys.has(key), false, `PDF_PERF_REPORT_FORBIDDEN_KEY_${key}`);
      visit(entry);
    }
  };
  visit(report);
  return true;
}

function sha256File(filename) {
  return crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
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

export function instrumentNativeReaderSource(source) {
  source = String(source || '').replaceAll('\r\n', '\n');
  const replaceOnce = (needle, replacement, code) => {
    assert.equal(source.split(needle).length, 2, code);
    source = source.replace(needle, replacement);
  };
  const prefix = `\nconst __pdfPerfTrace = globalThis.__brevessPdfPerfTrace = [];\n` +
    `let __pdfPerfRenderTaskSequence = 0;\n` +
    `function __pdfPerf(event, pageNumber = 0, details = {}) {\n` +
    `  __pdfPerfTrace.push({ event, pageNumber: Number(pageNumber) || 0, atMs: Date.now(),\n` +
    `    visibility: document.visibilityState, ...details });\n` +
    `  if (__pdfPerfTrace.length > 2000) __pdfPerfTrace.splice(0, 500);\n` +
    `}\n`;
  replaceOnce("GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('vendor/pdfjs/build/pdf.worker.min.mjs');\n",
    "GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('vendor/pdfjs/build/pdf.worker.min.mjs');\n" + prefix,
    'PDF_PERF_INSTRUMENT_BOOTSTRAP_DRIFT');
  replaceOnce('async function renderMountedPage(record, token, signal) {\n',
    "async function renderMountedPage(record, token, signal) {\n  __pdfPerf('render-start', record?.pageNumber);\n",
    'PDF_PERF_INSTRUMENT_RENDER_START_DRIFT');
  replaceOnce('    await ensureMountedPageTextLayer(record, token, signal);\n',
    "    await ensureMountedPageTextLayer(record, token, signal);\n    __pdfPerf('text-layer-ready', record.pageNumber);\n",
    'PDF_PERF_INSTRUMENT_TEXT_LAYER_DRIFT');
  replaceOnce('      localTask = record.page.render({\n',
    "      __pdfPerf('pdfjs-render-start', record.pageNumber);\n      localTask = record.page.render({\n",
    'PDF_PERF_INSTRUMENT_PDFJS_START_DRIFT');
  replaceOnce('      record.renderTask = localTask;\n',
    "      record.renderTask = localTask;\n" +
    "      const __perfInternalTask = localTask?._internalRenderTask;\n" +
    "      const __perfTaskId = ++__pdfPerfRenderTaskSequence;\n" +
    "      let __perfContinuationSequence = 0;\n" +
    "      __pdfPerf('pdfjs-task-created', record.pageNumber, {\n" +
    "        taskId: __perfTaskId, pageIndex: Number(__perfInternalTask?._pageIndex) || 0,\n" +
    "        operatorCount: __perfInternalTask?.operatorList?.fnArray?.length || 0,\n" +
    "        lastChunk: __perfInternalTask?.operatorList?.lastChunk === true\n" +
    "      });\n" +
    "      localTask.onContinue = continuation => {\n" +
    "        const sequence = ++__perfContinuationSequence;\n" +
    "        const scheduledAt = performance.now();\n" +
    "        if (!__perfInternalTask.__brevessPerfExecuteWrapped && __perfInternalTask.gfx) {\n" +
    "          __perfInternalTask.__brevessPerfExecuteWrapped = true;\n" +
    "          const __perfGfx = __perfInternalTask.gfx;\n" +
    "          const __perfExecute = __perfGfx.executeOperatorList;\n" +
    "          let __perfSyncSequence = 0;\n" +
    "          __perfGfx.executeOperatorList = function (...args) {\n" +
    "            const syncSequence = ++__perfSyncSequence;\n" +
    "            const startedAtMs = Date.now();\n" +
    "            const startedAtPerf = performance.now();\n" +
    "            const operatorIndexBefore = Number(args[1]) || 0;\n" +
    "            let operatorIndexAfter = operatorIndexBefore;\n" +
    "            __pdfPerf('pdfjs-sync-start', record.pageNumber, { taskId: __perfTaskId,\n" +
    "              syncSequence, operatorIndexBefore });\n" +
    "            try {\n" +
    "              operatorIndexAfter = __perfExecute.apply(this, args);\n" +
    "              return operatorIndexAfter;\n" +
    "            } finally {\n" +
    "              __pdfPerf('pdfjs-sync-end', record.pageNumber, { taskId: __perfTaskId,\n" +
    "                syncSequence, startedAtMs,\n" +
    "                durationMs: Math.max(0, performance.now() - startedAtPerf),\n" +
    "                operatorIndexBefore, operatorIndexAfter: Number(operatorIndexAfter) || 0\n" +
    "              });\n" +
    "            }\n" +
    "          };\n" +
    "        }\n" +
    "        __pdfPerf('pdfjs-continuation', record.pageNumber, { taskId: __perfTaskId, sequence,\n" +
    "          operatorIndex: Number(__perfInternalTask?.operatorListIdx) || 0,\n" +
    "          operatorCount: __perfInternalTask?.operatorList?.fnArray?.length || 0,\n" +
    "          lastChunk: __perfInternalTask?.operatorList?.lastChunk === true\n" +
    "        });\n" +
    "        requestAnimationFrame(() => __pdfPerf('pdfjs-raf-probe', record.pageNumber, {\n" +
    "          taskId: __perfTaskId, sequence, waitMs: Math.max(0, performance.now() - scheduledAt)\n" +
    "        }));\n" +
    "        continuation();\n" +
    "      };\n",
    'PDF_PERF_INSTRUMENT_RENDER_TASK_DRIFT');
  replaceOnce("      await localTask.promise.catch(error => {\n        throw rememberRenderFailure(error, record.documentGeneration);\n      });\n",
    "      await localTask.promise.catch(error => {\n        throw rememberRenderFailure(error, record.documentGeneration);\n      });\n      __pdfPerf('pdfjs-render-complete', record.pageNumber, { taskId: __perfTaskId });\n",
    'PDF_PERF_INSTRUMENT_PDFJS_COMPLETE_DRIFT');
  replaceOnce("    record.section.classList.add('is-rendered');\n" +
    "    dispatchPageLifecycleEvent('brevess:pdf-page-rendered', record);\n",
    "    record.section.classList.add('is-rendered');\n" +
    "    dispatchPageLifecycleEvent('brevess:pdf-page-rendered', record);\n" +
    "    __pdfPerf('page-rendered', record.pageNumber, { canvasResident: record.canvasResident === true });\n",
    'PDF_PERF_INSTRUMENT_PAGE_RENDERED_DRIFT');
  replaceOnce('    const pending = renderQueue.schedule(({ signal }) => renderMountedPage(record, token, signal), {\n',
    "    __pdfPerf('render-queued', record.pageNumber, { current: current === true });\n" +
    '    const pending = renderQueue.schedule(({ signal }) => renderMountedPage(record, token, signal), {\n',
    'PDF_PERF_INSTRUMENT_QUEUE_DRIFT');
  replaceOnce('function applyNativePdfSemanticRangeFocus(entries) {\n',
    "function applyNativePdfSemanticRangeFocus(entries) {\n  const __perfPages = [...new Set((entries || []).map(entry => entry?.pageNumber).filter(Boolean))];\n",
    'PDF_PERF_INSTRUMENT_OVERLAY_START_DRIFT');
  replaceOnce('  layers.forEach(layer => layer.pageElement.appendChild(layer.element));\n',
    "  layers.forEach(layer => layer.pageElement.appendChild(layer.element));\n" +
    "  __perfPages.forEach(pageNumber => __pdfPerf('overlay-applied', pageNumber));\n",
    'PDF_PERF_INSTRUMENT_OVERLAY_COMMIT_DRIFT');
  return source;
}

function removeTemporary(target) {
  const temporaryRoot = path.resolve(os.tmpdir());
  const resolved = path.resolve(target);
  if (resolved.startsWith(`${temporaryRoot}${path.sep}`) &&
      path.basename(resolved).startsWith('brevess-pdf-perf-')) {
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}

async function waitForRaster(page, pageNumber, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  do {
    const result = await page.evaluate(number => {
      const section = document.querySelector(`.pdf-native-page[data-pdf-page-number="${number}"]`);
      const canvas = section?.querySelector('canvas.pdf-native-page-canvas');
      const hits = [...(section?.querySelectorAll('.pdf-native-semantic-focus-hit') || [])];
      if (!section?.classList.contains('is-rendered') || !canvas || canvas.width < 2 ||
          canvas.height < 2 || !hits.length) return null;
      const bounds = canvas.getBoundingClientRect();
      const pageBounds = section.getBoundingClientRect();
      if (bounds.width < 100 || bounds.height < 100 || bounds.bottom <= 0 ||
          bounds.top >= innerHeight) return null;
      const sample = document.createElement('canvas');
      sample.width = sample.height = 180;
      const context = sample.getContext('2d', { willReadFrequently: true });
      context.drawImage(canvas, 0, 0, 180, 180);
      const pixels = context.getImageData(0, 0, 180, 180).data;
      let inkPixels = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        if (pixels[index + 3] > 200 && pixels[index] < 220 &&
            pixels[index + 1] < 220 && pixels[index + 2] < 220) inkPixels += 1;
      }
      const hitRects = hits.map(hit => hit.getBoundingClientRect());
      const overlayWithinPage = hitRects.every(rect => rect.width > 0 && rect.height > 0 &&
        rect.left >= pageBounds.left - 1 && rect.right <= pageBounds.right + 1 &&
        rect.top >= pageBounds.top - 1 && rect.bottom <= pageBounds.bottom + 1);
      if (inkPixels < 50 || !overlayWithinPage) return null;
      return { observedAt: Date.now(), pageNumber: number, canvasWidth: canvas.width,
        canvasHeight: canvas.height, cssWidth: Math.round(bounds.width),
        cssHeight: Math.round(bounds.height), inkPixels, overlayRectCount: hitRects.length,
        overlayWithinPage };
    }, pageNumber);
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 25));
  } while (Date.now() < deadline);
  throw new Error('PDF_PERF_RASTER_TIMEOUT');
}

async function resetToFirstPage(page) {
  await page.bringToFront();
  await page.evaluate(async () => {
    globalThis.__brevessNativePdfDocument?.focusPage?.(1);
    await globalThis.__brevessPdfReaderBridge.command('updatePageWindow', 1, 1);
  });
  await page.waitForFunction(() => {
    const section = document.querySelector('.pdf-native-page[data-pdf-page-number="1"]');
    const canvas = section?.querySelector('canvas.pdf-native-page-canvas');
    return section?.classList.contains('is-rendered') && canvas?.width > 1 && canvas?.height > 1;
  }, null, { timeout: 30_000, polling: 25 });
}

async function measureFocus(page, targetName, mode = 'native') {
  const focus = await page.evaluate(async ({ name, focusMode }) => {
    const target = structuredClone(globalThis.__pdfPerfTargets[name]);
    globalThis.__brevessPdfPerfTrace.splice(0);
    const startedAt = Date.now();
    const result = focusMode === 'citation'
      ? await focusPdfSemanticCitationTarget(target)
      : await globalThis.__brevessNativePdfDocument.focusSemanticTarget(target);
    return { startedAt, returnedAt: Date.now(), result, traceAtReturn:
      structuredClone(globalThis.__brevessPdfPerfTrace) };
  }, { name: targetName, focusMode: mode });
  assert.equal(focus.result?.focused, true, 'PDF_PERF_FOCUS_FAILED');
  const rasterStateAtFocusReturn = await page.evaluate(pageNumber => {
    const section = document.querySelector(
      `.pdf-native-page[data-pdf-page-number="${pageNumber}"]`);
    const canvas = section?.querySelector('canvas.pdf-native-page-canvas');
    return { rendered: section?.classList.contains('is-rendered') === true,
      canvasResident: Boolean(canvas?.width > 1 && canvas?.height > 1),
      overlayCount: section?.querySelectorAll('.pdf-native-semantic-focus-hit').length || 0 };
  }, focus.result.pageNumber);
  const raster = await waitForRaster(page, focus.result.pageNumber);
  const trace = await page.evaluate(() => structuredClone(globalThis.__brevessPdfPerfTrace));
  const longTasks = await page.evaluate(({ startedAt, observedAt }) =>
    (globalThis.__pdfPerfLongTasks || []).filter(entry =>
      entry.atMs >= startedAt - 2 && entry.atMs <= observedAt + 2),
  { startedAt: focus.startedAt, observedAt: raster.observedAt });
  return {
    pageNumber: focus.result.pageNumber,
    precision: String(focus.result.precision || ''),
    focusReturnMs: focus.returnedAt - focus.startedAt,
    focusToRasterMs: raster.observedAt - focus.startedAt,
    rasterReadyWhenFocusReturned: rasterStateAtFocusReturn.rendered &&
      rasterStateAtFocusReturn.canvasResident && rasterStateAtFocusReturn.overlayCount > 0,
    overlayReadyWhenFocusReturned: focus.traceAtReturn.some(event =>
      event.event === 'overlay-applied' && event.pageNumber === focus.result.pageNumber),
    raster,
    breakdown: summarizeRenderTrace(trace, focus.result.pageNumber,
      focus.startedAt, raster.observedAt),
    pdfJsScheduler: summarizePdfJsSchedulerTrace(trace, focus.result.pageNumber,
      focus.startedAt, raster.observedAt),
    mainThreadLongTasks: summarizeLongTasks(longTasks, focus.startedAt, raster.observedAt),
    allPageRenderAttribution: summarizeCrossPageRenderAttribution(
      trace, longTasks, focus.startedAt, raster.observedAt
    )
  };
}

async function run(options = {}) {
  const root = path.resolve(import.meta.dirname, '..');
  const parsed = { ...parseArguments(process.argv.slice(2)), ...options };
  if (parsed.help) {
    console.log('Usage: node scripts/verify-pdf-citation-render-performance.mjs [--headed] [--citation-only] [--output dir]');
    return null;
  }
  const pdfPath = path.resolve(parsed.pdf || path.join(root, 'tmp', 'public-pdf-acceptance',
    'elife-83176-v2.pdf'));
  const outputDirectory = path.resolve(parsed.output || path.join(root, 'output', 'playwright',
    DEFAULT_OUTPUT_NAME));
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-pdf-perf-'));
  const extensionDirectory = path.join(temporaryRoot, 'extension');
  const profileDirectory = path.join(temporaryRoot, 'profile');
  const report = {
    schemaVersion: 2,
    status: 'RUNNING',
    scope: 'No-API native PDF citation render performance',
    source: { pdfSha256: EXPECTED_PDF_SHA256, pageCount: EXPECTED_PAGE_COUNT },
    browser: { engine: 'msedge', headed: parsed.headed === true, isolatedProfile: true,
      isolatedExtension: true },
    network: { httpRequests: 0, apiRequests: 0 },
    diagnostics: { pageErrors: 0, consoleErrors: 0, workerErrors: 0 },
    measurements: {},
    screenshots: []
  };
  let context;
  let reader;
  let foreground;
  let failureStage = 'SOURCE';
  try {
    assert.equal(sha256File(pdfPath), EXPECTED_PDF_SHA256, 'PDF_PERF_PUBLIC_PDF_HASH_MISMATCH');
    copyExtension(root, extensionDirectory);
    const readerModule = path.join(extensionDirectory, 'pdf-native-reader.mjs');
    fs.writeFileSync(readerModule, instrumentNativeReaderSource(fs.readFileSync(readerModule, 'utf8')));
    fs.mkdirSync(outputDirectory, { recursive: true });

    failureStage = 'BROWSER_LAUNCH';
    context = await chromium.launchPersistentContext(profileDirectory, {
      channel: 'msedge', headless: parsed.headed !== true, reducedMotion: 'reduce',
      viewport: { width: 1280, height: 900 },
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
      globalThis.__pdfPerfVisibility = [];
      globalThis.__pdfPerfLongTasks = [];
      try {
        const observer = new PerformanceObserver(list => {
          for (const entry of list.getEntries()) {
            globalThis.__pdfPerfLongTasks.push({
              atMs: Math.round(performance.timeOrigin + entry.startTime),
              durationMs: Math.round(entry.duration)
            });
          }
          if (globalThis.__pdfPerfLongTasks.length > 500) {
            globalThis.__pdfPerfLongTasks.splice(0, 100);
          }
        });
        observer.observe({ type: 'longtask', buffered: true });
        globalThis.__pdfPerfLongTaskObserver = observer;
      } catch (_) {}
      document.addEventListener('visibilitychange', () => {
        globalThis.__pdfPerfVisibility.push({ atMs: Date.now(), state: document.visibilityState });
      });
    });
    await reader.goto(`chrome-extension://${extensionId}/pdf-reader.html`, {
      waitUntil: 'domcontentloaded'
    });
    failureStage = 'COLD_DOCUMENT_LOAD';
    const inputStartedAt = Date.now();
    await reader.locator('#pdfLocalFile').setInputFiles(pdfPath);
    await reader.waitForFunction(({ hash, count }) => {
      const native = globalThis.__brevessNativePdfDocument;
      const semantic = globalThis.__brevessPdfSemanticDocument;
      const first = document.querySelector('.pdf-native-page[data-pdf-page-number="1"]');
      return native?.phase === 'text-ready' && native?.structure?.documentHash === hash &&
        semantic?.phase === 'text-ready' && semantic?.indexedPageCount === count &&
        first?.classList.contains('is-rendered') &&
        first.querySelector('canvas.pdf-native-page-canvas')?.width > 1;
    }, { hash: EXPECTED_PDF_SHA256, count: EXPECTED_PAGE_COUNT }, { timeout: 120_000 });
    report.measurements.coldDocumentReadyMs = Date.now() - inputStartedAt;

    failureStage = 'TARGET_SELECTION';
    const targets = await reader.evaluate(() => {
      const pending = [...(globalThis.__brevessNativePdfDocument?.getSemanticNavigation?.()
        ?.sections || [])];
      const all = [];
      while (pending.length) {
        const section = pending.shift();
        all.push(...(section?.paragraphTargets || []));
        pending.push(...(section?.children || []));
      }
      const compatibility = globalThis.__brevessPdfSemanticCompatibility;
      const rows = all.map(target => ({ target,
        request: compatibility?.createNativeFocusRequest?.(
          target.paragraphId, target.normalizedStart, target.normalizedEnd,
          target.expectedNormalizedQuote) })).filter(row => row.request?.mode === 'ranges');
      const far = rows.filter(row => row.request.pageNumber >= 15)
        .sort((left, right) => right.request.pageNumber - left.request.pageNumber)[0];
      const citation = rows.filter(row => row.target.expectedNormalizedQuote.length >= 400 &&
        row.request.ranges.some(range => range.pageNumber === 3))
        .flatMap(row => {
          const text = row.target.expectedNormalizedQuote;
          return [...new Intl.Segmenter('en', { granularity: 'sentence' }).segment(text)]
            .map(segment => ({ text: segment.segment.trim(), index: segment.index }))
            .filter(segment => segment.text.length >= 80 && segment.text.length <= 400 &&
              /[a-z]{4}/u.test(segment.text) && /[.!?]$/u.test(segment.text))
            .map(sentence => {
              const localStart = text.indexOf(sentence.text, sentence.index);
              const input = { ...structuredClone(row.target),
                normalizedStart: row.target.normalizedStart + localStart,
                normalizedEnd: row.target.normalizedStart + localStart + sentence.text.length,
                expectedNormalizedQuote: sentence.text };
              const request = compatibility.createNativeFocusRequest(
                input.paragraphId, input.normalizedStart, input.normalizedEnd,
                input.expectedNormalizedQuote);
              return request?.mode === 'ranges' && request.pageNumber === 3
                ? { input, request, paragraphCharacters: text.length } : null;
            }).filter(Boolean);
        }).sort((left, right) =>
          (left.request.ranges[0]?.start ?? Number.MAX_SAFE_INTEGER) -
          (right.request.ranges[0]?.start ?? Number.MAX_SAFE_INTEGER))[0];
      if (!far || !citation) return null;
      globalThis.__pdfPerfTargets = {
        far: structuredClone(far.target), citation: structuredClone(citation.input)
      };
      return { farPage: far.request.pageNumber, citationPage: citation.request.pageNumber,
        farRangeCount: far.request.ranges.length, citationRangeCount: citation.request.ranges.length,
        citationGranularity: 'sentence', citationBodyLike: true,
        citationParagraphCharacters: citation.paragraphCharacters,
        citationQuoteCharacters: citation.input.expectedNormalizedQuote.length,
        citationRawStart: citation.request.ranges[0]?.start ?? null,
        farParagraphIdHash: '', citationParagraphIdHash: '' };
    });
    assert.ok(targets, 'PDF_PERF_TARGETS_UNAVAILABLE');
    targets.farParagraphIdHash = crypto.createHash('sha256').update(
      await reader.evaluate(() => globalThis.__pdfPerfTargets.far.paragraphId)).digest('hex');
    targets.citationParagraphIdHash = crypto.createHash('sha256').update(
      await reader.evaluate(() => globalThis.__pdfPerfTargets.citation.paragraphId)).digest('hex');
    targets.citationQuoteHash = crypto.createHash('sha256').update(
      await reader.evaluate(() => globalThis.__pdfPerfTargets.citation.expectedNormalizedQuote))
      .digest('hex');
    report.targets = targets;

    if (!parsed.citationOnly) {
      failureStage = 'COLD_FAR_NAVIGATION';
      await resetToFirstPage(reader);
      report.measurements.coldFarNavigation = await measureFocus(reader, 'far', 'native');
      const farScreenshot = path.join(outputDirectory, '01-cold-far-original-overlay.png');
      await reader.locator(`.pdf-native-page[data-pdf-page-number="${targets.farPage}"]`)
        .screenshot({ path: farScreenshot });
      report.screenshots.push(path.basename(farScreenshot));

      failureStage = 'HOT_FAR_NAVIGATION';
      report.measurements.hotFarNavigation = await measureFocus(reader, 'far', 'native');
    }

    failureStage = 'FOREGROUND_CITATION';
    await resetToFirstPage(reader);
    report.measurements.foregroundCitation = await measureFocus(reader, 'citation', 'citation');
    const citationScreenshot = path.join(outputDirectory,
      parsed.citationOnly ? '01-results-body-citation-overlay.png'
        : '02-foreground-citation-overlay.png');
    await reader.locator(`.pdf-native-page[data-pdf-page-number="${targets.citationPage}"]`)
      .screenshot({ path: citationScreenshot });
    report.screenshots.push(path.basename(citationScreenshot));

    if (!parsed.citationOnly) {
      failureStage = 'BACKGROUND_CITATION';
      await resetToFirstPage(reader);
      foreground = await context.newPage();
      await foreground.goto(`chrome-extension://${extensionId}/popup.html`, {
        waitUntil: 'domcontentloaded'
      });
      await foreground.bringToFront();
      const beforeState = await reader.evaluate(() => document.visibilityState);
      const backgroundFocus = await reader.evaluate(async () => {
      globalThis.__brevessPdfPerfTrace.splice(0);
      const target = structuredClone(globalThis.__pdfPerfTargets.citation);
      const startedAt = Date.now();
      const result = await focusPdfSemanticCitationTarget(target);
      return { startedAt, returnedAt: Date.now(), result };
      });
      assert.equal(backgroundFocus.result?.focused, true, 'PDF_PERF_BACKGROUND_FOCUS_FAILED');
      await new Promise(resolve => setTimeout(resolve, 750));
      const beforeFront = await reader.evaluate(pageNumber => {
      const section = document.querySelector(`.pdf-native-page[data-pdf-page-number="${pageNumber}"]`);
      const canvas = section?.querySelector('canvas.pdf-native-page-canvas');
      return { observedAt: Date.now(), visibilityState: document.visibilityState,
        overlayCount: section?.querySelectorAll('.pdf-native-semantic-focus-hit').length || 0,
        rendered: section?.classList.contains('is-rendered') === true,
        canvasWidth: canvas?.width || 0, canvasHeight: canvas?.height || 0 };
      }, targets.citationPage);
      const bringStartedAt = Date.now();
      await reader.bringToFront();
      const bringReturnedAt = Date.now();
      const backgroundRaster = await waitForRaster(reader, targets.citationPage);
      const backgroundTrace = await reader.evaluate(() =>
        structuredClone(globalThis.__brevessPdfPerfTrace));
      report.measurements.backgroundCitation = {
      pageNumber: targets.citationPage,
      visibilityBeforeFocus: beforeState,
      focusReturnMs: backgroundFocus.returnedAt - backgroundFocus.startedAt,
      heldInBackgroundMs: beforeFront.observedAt - backgroundFocus.returnedAt,
      overlayReadyBeforeFront: beforeFront.overlayCount > 0,
      rasterReadyBeforeFront: beforeFront.rendered && beforeFront.canvasWidth > 1 &&
        beforeFront.canvasHeight > 1,
      bringToFrontCallMs: bringReturnedAt - bringStartedAt,
      frontToRasterMs: backgroundRaster.observedAt - bringReturnedAt,
      focusToRasterMs: backgroundRaster.observedAt - backgroundFocus.startedAt,
      raster: backgroundRaster,
      breakdown: summarizeRenderTrace(backgroundTrace, targets.citationPage,
        backgroundFocus.startedAt, backgroundRaster.observedAt),
        visibilityEvents: await reader.evaluate(() => structuredClone(globalThis.__pdfPerfVisibility))
      };
      const backgroundScreenshot = path.join(outputDirectory,
        '03-background-citation-after-front.png');
      await reader.locator(`.pdf-native-page[data-pdf-page-number="${targets.citationPage}"]`)
        .screenshot({ path: backgroundScreenshot });
      report.screenshots.push(path.basename(backgroundScreenshot));
    }

    failureStage = 'ASSERTIONS';
    const assertedMeasurements = parsed.citationOnly
      ? ['foregroundCitation']
      : ['coldFarNavigation', 'hotFarNavigation', 'foregroundCitation'];
    for (const key of assertedMeasurements) {
      const measurement = report.measurements[key];
      assert.equal(measurement.raster.overlayWithinPage, true,
        `PDF_PERF_${key.toUpperCase()}_OVERLAY_MISALIGNED`);
      assert.ok(measurement.raster.inkPixels > 50,
        `PDF_PERF_${key.toUpperCase()}_RASTER_BLANK`);
    }
    if (!parsed.citationOnly) {
      assert.equal(report.measurements.backgroundCitation.raster.overlayWithinPage, true,
        'PDF_PERF_BACKGROUND_OVERLAY_MISALIGNED');
    }
    assert.equal(report.network.apiRequests, 0, 'PDF_PERF_API_REQUEST_DETECTED');
    assert.equal(report.network.httpRequests, 0, 'PDF_PERF_HTTP_REQUEST_DETECTED');
    assert.equal(report.diagnostics.pageErrors, 0, 'PDF_PERF_PAGE_ERROR');
    assert.equal(report.diagnostics.workerErrors, 0, 'PDF_PERF_WORKER_ERROR');
    assertRedactedReport(report);
    report.status = 'PASS';
  } catch (error) {
    report.status = 'FAIL';
    report.failureStage = failureStage;
    report.failureCode = stableFailureCode(error);
    report.failureMessage = String(error?.message || error).slice(0, 300);
    report.failureDiagnostic = await reader?.evaluate(() => ({
      trace: (globalThis.__brevessPdfPerfTrace || []).slice(-30).map(event => ({
        event: String(event.event || ''), pageNumber: Number(event.pageNumber) || 0,
        atMs: Number(event.atMs) || 0, visibility: String(event.visibility || '')
      })),
      pages: [...document.querySelectorAll('.pdf-native-page')].map(section => {
        const canvas = section.querySelector('canvas.pdf-native-page-canvas');
        const bounds = canvas?.getBoundingClientRect();
        return { pageNumber: Number(section.dataset.pdfPageNumber) || 0,
          rendered: section.classList.contains('is-rendered'),
          canvasWidth: canvas?.width || 0, canvasHeight: canvas?.height || 0,
          boundsTop: Math.round(bounds?.top || 0), boundsBottom: Math.round(bounds?.bottom || 0),
          overlayCount: section.querySelectorAll('.pdf-native-semantic-focus-hit').length };
      }).filter(page => page.overlayCount || page.canvasWidth)
    })).catch(() => null);
    process.exitCode = 1;
  } finally {
    await foreground?.close().catch(() => undefined);
    await context?.close().catch(() => undefined);
    removeTemporary(temporaryRoot);
    fs.mkdirSync(outputDirectory, { recursive: true });
    fs.writeFileSync(path.join(outputDirectory, 'report.json'),
      `${JSON.stringify(report, null, 2)}\n`);
  }
  console.log(JSON.stringify({ status: report.status, failureStage: report.failureStage || '',
    failureCode: report.failureCode || '', outputDirectory }, null, 2));
  return report;
}

function directInvocation() {
  return Boolean(process.argv[1]) &&
    import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
}

if (directInvocation()) await run();
