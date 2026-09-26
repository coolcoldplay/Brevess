import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const pdfPath = path.join(root, 'tmp', 'public-pdf-acceptance', 'elife-83176-v2.pdf');
const outputDirectory = path.join(root, 'output', 'playwright',
  'pdf-semantic-sidecar-b1-live-r6-20260913');
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-pdf-semantic-b1-'));
const temporaryExtension = path.join(temporaryRoot, 'extension');
const profileDirectory = path.join(temporaryRoot, 'profile');
const expectedHash = '6980dbe19945fd36ccd200841d8204a22c75404faedd432db23dbb0a70cef5f1';

const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const sha256File = filename => sha256(fs.readFileSync(filename));

function copyExtension() {
  fs.mkdirSync(temporaryExtension, { recursive: true });
  for (const directory of ['core', 'providers', 'vendor', 'icons', '_locales']) {
    fs.cpSync(path.join(root, directory), path.join(temporaryExtension, directory), {
      recursive: true
    });
  }
  for (const file of fs.readdirSync(root)) {
    if (/\.(?:js|mjs|html|css)$/u.test(file) || file === 'manifest.json') {
      fs.copyFileSync(path.join(root, file), path.join(temporaryExtension, file));
    }
  }
}

function removeTemporary(target) {
  const temp = path.resolve(os.tmpdir());
  const resolved = path.resolve(target);
  if (resolved.startsWith(`${temp}${path.sep}`) &&
      path.basename(resolved).startsWith('brevess-pdf-semantic-b1-')) {
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}

const report = {
  schemaVersion: 1,
  status: 'RUNNING',
  acceptance: 'P2-B1 semantic sidecar production lifecycle',
  source: { pdfSha256: expectedHash, pageCount: 23 },
  isolation: { temporaryExtension: true, temporaryProfile: true,
    computerUseUsed: false, dailyBrowserUsed: false },
  network: { httpRequests: 0, apiRequests: 0 },
  diagnostics: { pageErrorCount: 0, consoleErrorCount: 0, workerErrorCount: 0 },
  metrics: {},
  limitations: [
    'This verifies native-text sidecar lifecycle on one public 23-page PDF.',
    'It does not establish OCR, B2 semantic-range migration, or the final 120/80/30 corpus gate.'
  ]
};

let context;
let page;
let stage = 'SOURCE';
try {
  assert.equal(sha256File(pdfPath), expectedHash, 'B1_PUBLIC_PDF_HASH_MISMATCH');
  copyExtension();
  fs.mkdirSync(outputDirectory, { recursive: true });
  stage = 'BROWSER_LAUNCH';
  context = await chromium.launchPersistentContext(profileDirectory, {
    channel: 'msedge', headless: true, reducedMotion: 'reduce',
    viewport: { width: 1280, height: 900 },
    args: [`--disable-extensions-except=${temporaryExtension}`,
      `--load-extension=${temporaryExtension}`]
  });
  await context.route(/^https?:\/\//u, route => route.abort('blockedbyclient'));
  context.on('request', request => {
    if (!/^https?:\/\//u.test(request.url())) return;
    report.network.httpRequests += 1;
    if (/(?:api\.|openai|deepseek|mineru|chat\/completions|responses)/iu.test(request.url())) {
      report.network.apiRequests += 1;
    }
  });
  const extensionWorker = context.serviceWorkers()[0] ||
    await context.waitForEvent('serviceworker', { timeout: 15_000 });
  extensionWorker.on('console', message => {
    if (message.type() === 'error') report.diagnostics.workerErrorCount += 1;
  });
  const extensionId = new URL(extensionWorker.url()).host;
  page = await context.newPage();
  page.on('pageerror', () => { report.diagnostics.pageErrorCount += 1; });
  page.on('console', message => {
    if (message.type() === 'error') report.diagnostics.consoleErrorCount += 1;
  });
  await page.addInitScript(() => {
    globalThis.__b1Events = [];
    globalThis.__b1WorkerJobs = [];
    const NativeWorker = globalThis.Worker;
    globalThis.Worker = new Proxy(NativeWorker, {
      construct(Target, args, NewTarget) {
        const worker = Reflect.construct(Target, args, NewTarget);
        const nativePostMessage = worker.postMessage.bind(worker);
        worker.postMessage = (message, transfer) => {
          if (message?.type === 'build' && message?.input) {
            globalThis.__b1WorkerJobs.push({
              documentGeneration: Number(message.input.documentGeneration) || 0,
              revision: Number(message.input.revision) || 0,
              buildScope: String(message.input.buildScope || ''),
              pageCount: Array.isArray(message.input.pages) ? message.input.pages.length : 0
            });
          }
          return transfer === undefined
            ? nativePostMessage(message)
            : nativePostMessage(message, transfer);
        };
        return worker;
      }
    });
    const capture = (kind, detail) => globalThis.__b1Events.push({
      kind, at: performance.now(),
      phase: String(detail?.phase || ''),
      documentGeneration: Number(detail?.documentGeneration) || 0,
      revision: Number(detail?.revision) || 0,
      counts: detail?.counts ? {
        canonicalPages: Number(detail.counts.canonicalPages) || 0,
        indexedPages: Number(detail.counts.indexedPages) || 0,
        pendingPages: Number(detail.counts.pendingPages) || 0,
        buildsStarted: Number(detail.counts.buildsStarted) || 0,
        buildsCommitted: Number(detail.counts.buildsCommitted) || 0,
        staleBuilds: Number(detail.counts.staleBuilds) || 0
      } : null,
      coverage: detail?.coverage ? {
        expectedPages: Number(detail.coverage.expectedPages) || 0,
        availablePages: Number(detail.coverage.availablePages) || 0,
        indexedPages: Number(detail.coverage.indexedPages) || 0
      } : null,
      degraded: detail?.degraded === true,
      errorCode: detail?.errorCode ? String(detail.errorCode) : ''
    });
    document.addEventListener('brevess:native-pdf-ready', event =>
      capture('native', event.detail));
    document.addEventListener('brevess:pdf-semantic-ready', event =>
      capture('semantic', event.detail));
  });
  await page.goto(`chrome-extension://${extensionId}/pdf-reader.html`, {
    waitUntil: 'domcontentloaded'
  });
  const startAt = Date.now();
  stage = 'FIRST_PAGE';
  await page.locator('#pdfLocalFile').setInputFiles(pdfPath);
  await page.waitForFunction(hash => {
    const native = globalThis.__brevessNativePdfDocument;
    return document.querySelector('#pdfNativeViewer')?.dataset?.state === 'ready' &&
      native?.structure?.documentHash === hash &&
      ['interactive', 'indexing', 'partial-index', 'text-ready'].includes(native?.phase);
  }, expectedHash, { timeout: 45_000 });
  report.metrics.firstPageReadableMs = Date.now() - startAt;

  await page.evaluate(() => globalThis.__brevessPdfReaderBridge?.command?.('focusPage', 15));
  stage = 'FIRST_SEMANTIC';
  await page.waitForFunction(() => {
    const semantic = globalThis.__brevessPdfSemanticDocument;
    return semantic?.index && semantic.indexedPageCount >= 1;
  }, null, { timeout: 45_000 });
  report.metrics.firstSemanticIndexMs = Date.now() - startAt;

  stage = 'FULL_SEMANTIC';
  await page.waitForFunction(hash => {
    const native = globalThis.__brevessNativePdfDocument;
    const semantic = globalThis.__brevessPdfSemanticDocument;
    return native?.phase === 'text-ready' && native?.structure?.documentHash === hash &&
      semantic?.phase === 'text-ready' && semantic?.documentHash === hash &&
      semantic?.pageCount === 23 && semantic?.indexedPageCount === 23 &&
      semantic?.index?.document?.pageCount === 23;
  }, expectedHash, { timeout: 120_000 });
  report.metrics.fullSemanticIndexMs = Date.now() - startAt;

  const firstGeneration = await page.evaluate(hash => {
    const native = globalThis.__brevessNativePdfDocument;
    const semantic = globalThis.__brevessPdfSemanticDocument;
    const events = globalThis.__b1Events;
    const nativeInteractive = events.find(item => item.kind === 'native' &&
      ['interactive', 'indexing', 'text-ready'].includes(item.phase));
    const semanticCommit = events.find(item => item.kind === 'semantic' &&
      Number(item.counts?.buildsCommitted) > 0);
    return {
      nativeDocumentId: native?.structure?.documentId,
      nativeAdapterId: native?.structure?.adapterId,
      nativeHash: native?.structure?.documentHash,
      nativeGeneration: native?.documentGeneration,
      semanticDocumentId: semantic?.documentId,
      semanticAdapterId: semantic?.adapterId,
      semanticHash: semantic?.documentHash,
      semanticGeneration: semantic?.documentGeneration,
      semanticRevision: semantic?.revision,
      semanticCacheKey: semantic?.index?.cacheKey,
      sentenceCount: semantic?.index?.sentences?.length || 0,
      headingCount: semantic?.index?.headings?.length || 0,
      nativeBeforeSemantic: Boolean(nativeInteractive && semanticCommit &&
        nativeInteractive.at <= semanticCommit.at),
      events: events.filter(item => item.documentGeneration === native?.documentGeneration),
      workerJobs: globalThis.__b1WorkerJobs.filter(item =>
        item.documentGeneration === native?.documentGeneration),
      expectedDocumentId: `sha256:${hash}`
    };
  }, expectedHash);
  assert.equal(firstGeneration.nativeDocumentId, firstGeneration.expectedDocumentId);
  assert.equal(firstGeneration.nativeAdapterId, 'pdf-native');
  assert.equal(firstGeneration.semanticDocumentId, firstGeneration.expectedDocumentId);
  assert.equal(firstGeneration.semanticAdapterId, 'pdf-native');
  assert.equal(firstGeneration.nativeHash, expectedHash);
  assert.equal(firstGeneration.semanticHash, expectedHash);
  assert.equal(firstGeneration.nativeGeneration, firstGeneration.semanticGeneration);
  assert.equal(firstGeneration.nativeBeforeSemantic, true);
  assert.ok(firstGeneration.sentenceCount > 0, 'B1_SENTENCE_INDEX_EMPTY');
  assert.ok(firstGeneration.headingCount > 0, 'B1_HEADING_INDEX_EMPTY');
  assert.ok(firstGeneration.events.every(event => !event.errorCode && !event.degraded),
    'B1_FIRST_GENERATION_DEGRADED');
  const firstPreviewJobs = firstGeneration.workerJobs.filter(job =>
    job.buildScope === 'visible-adjacent-preview');
  const firstFullJobs = firstGeneration.workerJobs.filter(job => job.buildScope === 'full');
  assert.ok(firstPreviewJobs.every(job => job.pageCount >= 1 && job.pageCount <= 3),
    'B1_PREVIEW_SCOPE_UNBOUNDED');
  assert.equal(firstFullJobs.length, 1, 'B1_FULL_BUILD_COUNT');
  assert.equal(firstFullJobs[0].pageCount, 23, 'B1_FULL_BUILD_PAGE_COUNT');
  report.metrics.firstGeneration = {
    generation: firstGeneration.nativeGeneration,
    revision: firstGeneration.semanticRevision,
    sentenceCount: firstGeneration.sentenceCount,
    headingCount: firstGeneration.headingCount,
    nativeBeforeSemantic: firstGeneration.nativeBeforeSemantic,
    eventCount: firstGeneration.events.length,
    buildStarts: Math.max(...firstGeneration.events.map(item =>
      Number(item.counts?.buildsStarted) || 0)),
    buildCommits: Math.max(...firstGeneration.events.map(item =>
      Number(item.counts?.buildsCommitted) || 0)),
    workerJobs: {
      previews: firstPreviewJobs.length,
      maxPreviewPages: Math.max(0, ...firstPreviewJobs.map(job => job.pageCount)),
      full: firstFullJobs.length,
      fullPages: firstFullJobs[0].pageCount
    }
  };

  const beforeVirtualization = firstGeneration.semanticCacheKey;
  stage = 'VIRTUALIZATION';
  await page.evaluate(async () => {
    await globalThis.__brevessPdfReaderBridge.command('updatePageWindow', 1, 1);
    globalThis.__brevessPdfReaderBridge.command('deactivate');
    globalThis.__brevessPdfReaderBridge.command('activate');
    await globalThis.__brevessPdfReaderBridge.command('updatePageWindow', 15, 15);
  });
  const afterVirtualization = await page.evaluate(() =>
    globalThis.__brevessPdfSemanticDocument?.index?.cacheKey || '');
  assert.equal(afterVirtualization, beforeVirtualization,
    'B1_VIRTUALIZATION_CHANGED_SEMANTIC_INDEX');

  const replacementRuns = [];
  let previousGeneration = firstGeneration.nativeGeneration;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const replacementAt = Date.now();
    stage = `REPLACEMENT_${attempt}`;
    await page.evaluate(() => globalThis.__brevessPdfReaderBridge.command('replaceDocument'));
    await page.waitForFunction(previous =>
      Number(globalThis.__brevessNativePdfDocument?.documentGeneration) > previous &&
      globalThis.__brevessNativePdfDocument?.phase === 'text-ready' &&
      Number(globalThis.__brevessPdfSemanticDocument?.documentGeneration) > previous &&
      globalThis.__brevessPdfSemanticDocument?.phase === 'text-ready' &&
      globalThis.__brevessPdfSemanticDocument?.indexedPageCount === 23,
    previousGeneration, { timeout: 120_000 });

    const replacement = await page.evaluate(previous => {
      const semantic = globalThis.__brevessPdfSemanticDocument;
      const events = globalThis.__b1Events;
      const firstNew = events.findIndex(item => item.kind === 'semantic' &&
        item.documentGeneration > previous);
      const later = firstNew >= 0 ? events.slice(firstNew) : [];
      const workerJobs = globalThis.__b1WorkerJobs.filter(item =>
        item.documentGeneration > previous);
      return {
        generation: semantic?.documentGeneration,
        pageCount: semantic?.indexedPageCount,
        phase: semantic?.phase,
        oldSemanticAfterNew: later.filter(item => item.kind === 'semantic' &&
          item.documentGeneration <= previous).length,
        degradedAfterNew: later.filter(item => item.kind === 'semantic' &&
          (item.degraded || item.errorCode)).length,
        eventCount: later.length,
        workerJobs
      };
    }, previousGeneration);
    assert.ok(replacement.generation > previousGeneration,
      'B1_GENERATION_DID_NOT_ADVANCE');
    assert.equal(replacement.pageCount, 23);
    assert.equal(replacement.phase, 'text-ready');
    assert.equal(replacement.oldSemanticAfterNew, 0, 'B1_STALE_EVENT_AFTER_REPLACEMENT');
    assert.equal(replacement.degradedAfterNew, 0, 'B1_REPLACEMENT_DEGRADED');
    const replacementPreviewJobs = replacement.workerJobs.filter(job =>
      job.buildScope === 'visible-adjacent-preview');
    const replacementFullJobs = replacement.workerJobs.filter(job => job.buildScope === 'full');
    assert.ok(replacementPreviewJobs.every(job => job.pageCount >= 1 && job.pageCount <= 3),
      'B1_REPLACEMENT_PREVIEW_SCOPE_UNBOUNDED');
    assert.equal(replacementFullJobs.length, 1, 'B1_REPLACEMENT_FULL_BUILD_COUNT');
    assert.equal(replacementFullJobs[0].pageCount, 23,
      'B1_REPLACEMENT_FULL_BUILD_PAGE_COUNT');
    replacement.readyMs = Date.now() - replacementAt;
    replacement.workerJobs = {
      previews: replacementPreviewJobs.length,
      maxPreviewPages: Math.max(0, ...replacementPreviewJobs.map(job => job.pageCount)),
      full: replacementFullJobs.length,
      fullPages: replacementFullJobs[0].pageCount
    };
    replacementRuns.push(replacement);
    previousGeneration = replacement.generation;
  }
  report.metrics.replacementReadyMs = replacementRuns[0].readyMs;
  report.metrics.replacement = replacementRuns[0];
  report.metrics.replacementRuns = replacementRuns;

  assert.equal(report.network.httpRequests, 0, 'B1_NETWORK_REQUEST_DETECTED');
  assert.equal(report.network.apiRequests, 0, 'B1_API_REQUEST_DETECTED');
  assert.equal(report.diagnostics.pageErrorCount, 0, 'B1_PAGE_ERROR');
  assert.equal(report.diagnostics.consoleErrorCount, 0, 'B1_CONSOLE_ERROR');
  assert.equal(report.diagnostics.workerErrorCount, 0, 'B1_EXTENSION_WORKER_ERROR');
  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL';
  report.failureStage = stage;
  report.failureCode = `B1_LIVE_${stage}_FAILED`;
  try {
    report.failureState = await page?.evaluate(() => {
      const native = globalThis.__brevessNativePdfDocument;
      const semantic = globalThis.__brevessPdfSemanticDocument;
      const events = Array.isArray(globalThis.__b1Events) ? globalThis.__b1Events : [];
      const currentGeneration = Math.max(Number(native?.documentGeneration) || 0,
        Number(semantic?.documentGeneration) || 0);
      return {
        viewerState: String(document.querySelector('#pdfNativeViewer')?.dataset?.state || ''),
        htmlReady: document.documentElement.dataset.brevessNativePdfReady === 'true',
        nativePhase: String(native?.phase || ''),
        nativeGeneration: Number(native?.documentGeneration) || 0,
        nativeParagraphCount: Number(native?.structure?.diagnostics?.paragraphCount) || 0,
        nativeTextCoverage: Number(native?.structure?.diagnostics?.textCoverage) || 0,
        semanticPhase: String(semantic?.phase || ''),
        semanticGeneration: Number(semantic?.documentGeneration) || 0,
        semanticRevision: Number(semantic?.revision) || 0,
        semanticPageCount: Number(semantic?.indexedPageCount) || 0,
        currentGenerationEventCount: events.filter(item =>
          item.documentGeneration === currentGeneration).length,
        lastCurrentGenerationEvents: events.filter(item =>
          item.documentGeneration === currentGeneration).slice(-12),
        currentGenerationWorkerJobs: (globalThis.__b1WorkerJobs || []).filter(item =>
          item.documentGeneration === currentGeneration)
      };
    });
  } catch { report.failureState = { unavailable: true }; }
  process.exitCode = 1;
} finally {
  try { await context?.close(); } catch {}
  removeTemporary(temporaryRoot);
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(path.join(outputDirectory, 'report.json'),
    `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
