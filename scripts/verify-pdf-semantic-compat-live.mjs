import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const pdfPath = path.join(root, 'tmp', 'public-pdf-acceptance', 'elife-83176-v2.pdf');
const outputDirectory = path.join(root, 'output', 'playwright',
  'pdf-semantic-compat-b2-live-r8-20260913');
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-pdf-semantic-b2-'));
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
      path.basename(resolved).startsWith('brevess-pdf-semantic-b2-')) {
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}

const report = {
  schemaVersion: 1,
  status: 'RUNNING',
  acceptance: 'P2-B2 semantic compatibility production lifecycle',
  source: { pdfSha256: expectedHash, pageCount: 23 },
  isolation: { temporaryExtension: true, temporaryProfile: true,
    computerUseUsed: false, dailyBrowserUsed: false },
  network: { httpRequests: 0, apiRequests: 0 },
  diagnostics: { pageErrorCount: 0, consoleErrorCount: 0, workerErrorCount: 0 },
  metrics: {},
  limitations: [
    'This verifies the in-process compatibility lifecycle and real normalized-to-raw mapping on one public 23-page native-text PDF.',
    'It does not establish OCR, downstream B3-B6 consumer migration, or the final 120/80/30 corpus gate.'
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
    globalThis.__b2ResolveSample = adapter => {
      const navigation = adapter?.semanticNavigation ||
        globalThis.__brevessNativePdfDocument?.getSemanticNavigation?.();
      const targets = [];
      const pending = Array.isArray(navigation?.sections)
        ? [...navigation.sections] : [];
      while (pending.length) {
        const section = pending.shift();
        targets.push(...(Array.isArray(section?.paragraphTargets)
          ? section.paragraphTargets : []));
        pending.push(...(Array.isArray(section?.children) ? section.children : []));
      }
      targets.sort((left, right) =>
        Number(right?.normalizedStart) - Number(left?.normalizedStart));
      for (const target of targets) {
        const quote = String(target?.expectedNormalizedQuote || '');
        const start = Number(target?.normalizedStart);
        const end = Number(target?.normalizedEnd);
        if (!target?.paragraphId || !Number.isSafeInteger(start) || start <= 0 ||
            !Number.isSafeInteger(end) || end <= start || quote.length < 8 ||
            end - start !== quote.length) continue;
        const result = adapter?.resolvePdfSemanticRange?.(
          target.paragraphId, start, end, quote);
        if (result?.status === 'resolved') {
          return { paragraphId: target.paragraphId, start, end, quote, result };
        }
      }
      return null;
    };
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
    const compat = globalThis.__brevessPdfSemanticCompatibility;
    return native?.phase === 'text-ready' && native?.structure?.documentHash === hash &&
      semantic?.phase === 'text-ready' && semantic?.documentHash === hash &&
      semantic?.pageCount === 23 && semantic?.indexedPageCount === 23 &&
      semantic?.index?.document?.pageCount === 23 && compat?.documentHash === hash &&
      compat?.documentGeneration === native?.documentGeneration &&
      compat?.revision === semantic?.revision;
  }, expectedHash, { timeout: 120_000 });
  report.metrics.fullSemanticIndexMs = Date.now() - startAt;

  const firstGeneration = await page.evaluate(hash => {
    const native = globalThis.__brevessNativePdfDocument;
    const semantic = globalThis.__brevessPdfSemanticDocument;
    const compat = globalThis.__brevessPdfSemanticCompatibility;
    const events = globalThis.__b1Events;
    const nativeInteractive = events.find(item => item.kind === 'native' &&
      ['interactive', 'indexing', 'text-ready'].includes(item.phase));
    const semanticCommit = events.find(item => item.kind === 'semantic' &&
      Number(item.counts?.buildsCommitted) > 0);
    const navigationTargets = [];
    const pendingSections = Array.isArray(compat?.semanticNavigation?.sections)
      ? [...compat.semanticNavigation.sections] : [];
    while (pendingSections.length) {
      const section = pendingSections.shift();
      navigationTargets.push(...(Array.isArray(section?.paragraphTargets)
        ? section.paragraphTargets : []));
      pendingSections.push(...(Array.isArray(section?.children) ? section.children : []));
    }
    const orderedNavigationRanges = navigationTargets.map(target => ({
      start: Number(target?.normalizedStart), end: Number(target?.normalizedEnd)
    })).sort((left, right) => left.start - right.start || left.end - right.end);
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
      compatibilityDocumentId: compat?.documentId,
      compatibilityAdapterId: compat?.adapterId,
      compatibilityHash: compat?.documentHash,
      compatibilityGeneration: compat?.documentGeneration,
      compatibilityRevision: compat?.revision,
      compatibilityStructureHasPrivateRuns:
        JSON.stringify(compat?.articleStructure || {}).includes('positionRuns'),
      compatibilityStructureLeaksInternalDocumentId:
        JSON.stringify(compat?.articleStructure || {}).includes('pdf-document:'),
      navigationTargetCount: navigationTargets.length,
      navigationLengthMismatchCount: navigationTargets.filter(target =>
        Number(target?.normalizedEnd) - Number(target?.normalizedStart) !==
          String(target?.expectedNormalizedQuote || '').length).length,
      navigationOverlapCount: orderedNavigationRanges.slice(1).filter((range, index) =>
        range.start < orderedNavigationRanges[index].end).length,
      sampleResolution: globalThis.__b2ResolveSample(compat),
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
  assert.equal(firstGeneration.compatibilityDocumentId, firstGeneration.expectedDocumentId);
  assert.equal(firstGeneration.compatibilityAdapterId, 'pdf-native');
  assert.equal(firstGeneration.compatibilityHash, expectedHash);
  assert.equal(firstGeneration.compatibilityGeneration, firstGeneration.nativeGeneration);
  assert.equal(firstGeneration.compatibilityRevision, firstGeneration.semanticRevision);
  assert.equal(firstGeneration.compatibilityStructureHasPrivateRuns, false);
  assert.equal(firstGeneration.compatibilityStructureLeaksInternalDocumentId, false);
  assert.ok(firstGeneration.navigationTargetCount > 1,
    'B2_NAVIGATION_TARGETS_EMPTY');
  assert.equal(firstGeneration.navigationLengthMismatchCount, 0,
    'B2_NAVIGATION_TARGET_LENGTH_MISMATCH');
  assert.equal(firstGeneration.navigationOverlapCount, 0,
    'B2_NAVIGATION_TARGET_OFFSETS_OVERLAP');
  assert.equal(firstGeneration.sampleResolution?.result?.status, 'resolved');
  assert.equal(firstGeneration.sampleResolution?.result?.verified, true);
  assert.ok(firstGeneration.sampleResolution?.start > 0,
    'B2_SAMPLE_DID_NOT_USE_DOCUMENT_GLOBAL_OFFSET');
  assert.ok(['exact-raw', 'normalized-equivalent'].includes(
    firstGeneration.sampleResolution?.result?.precision));
  assert.ok(firstGeneration.sampleResolution?.result?.ranges?.length >= 1);
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
    compatibilityPrecision: firstGeneration.sampleResolution.result.precision,
    compatibilityRangeCount: firstGeneration.sampleResolution.result.ranges.length,
    sampleUsesNonzeroDocumentOffset: firstGeneration.sampleResolution.start > 0,
    navigationTargetCount: firstGeneration.navigationTargetCount,
    navigationLengthMismatchCount: firstGeneration.navigationLengthMismatchCount,
    navigationOverlapCount: firstGeneration.navigationOverlapCount,
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
  const afterVirtualization = await page.evaluate(() => ({
    cacheKey: globalThis.__brevessPdfSemanticDocument?.index?.cacheKey || '',
    sample: globalThis.__b2ResolveSample(globalThis.__brevessPdfSemanticCompatibility)
  }));
  assert.equal(afterVirtualization.cacheKey, beforeVirtualization,
    'B1_VIRTUALIZATION_CHANGED_SEMANTIC_INDEX');
  assert.equal(afterVirtualization.sample?.result?.status, 'resolved',
    'B2_VIRTUALIZATION_INVALIDATED_COMPATIBILITY');

  const replacementRuns = [];
  let previousGeneration = firstGeneration.nativeGeneration;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const replacementAt = Date.now();
    stage = `REPLACEMENT_${attempt}`;
    const invalidation = await page.evaluate(() => {
      const oldAdapter = globalThis.__brevessPdfSemanticCompatibility;
      const oldSample = globalThis.__b2ResolveSample(oldAdapter);
      globalThis.__b2ReplacementPromise =
        globalThis.__brevessPdfReaderBridge.command('replaceDocument');
      const stale = oldSample && oldAdapter.resolvePdfSemanticRange(
        oldSample.paragraphId, oldSample.start, oldSample.end, oldSample.quote);
      return { companionPresent: Boolean(globalThis.__brevessPdfSemanticCompatibility), stale };
    });
    assert.equal(invalidation.companionPresent, false,
      'B2_REPLACEMENT_DID_NOT_CLEAR_COMPANION_SYNCHRONOUSLY');
    assert.equal(invalidation.stale?.reasonCode, 'PDF_SEMANTIC_SOURCE_STALE');
    assert.deepEqual(invalidation.stale?.ranges || [], []);
    await page.waitForFunction(previous =>
      Number(globalThis.__brevessNativePdfDocument?.documentGeneration) > previous &&
      globalThis.__brevessNativePdfDocument?.phase === 'text-ready' &&
      Number(globalThis.__brevessPdfSemanticDocument?.documentGeneration) > previous &&
      globalThis.__brevessPdfSemanticDocument?.phase === 'text-ready' &&
      globalThis.__brevessPdfSemanticDocument?.indexedPageCount === 23 &&
      Number(globalThis.__brevessPdfSemanticCompatibility?.documentGeneration) > previous,
    previousGeneration, { timeout: 120_000 });

    const replacement = await page.evaluate(previous => {
      const semantic = globalThis.__brevessPdfSemanticDocument;
      const compat = globalThis.__brevessPdfSemanticCompatibility;
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
        compatibilityGeneration: compat?.documentGeneration,
        sampleResolution: globalThis.__b2ResolveSample(compat),
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
    assert.equal(replacement.compatibilityGeneration, replacement.generation);
    assert.equal(replacement.sampleResolution?.result?.status, 'resolved');
    assert.equal(replacement.sampleResolution?.result?.verified, true);
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
    replacement.sampleResolution = {
      status: replacement.sampleResolution.result.status,
      precision: replacement.sampleResolution.result.precision,
      verified: replacement.sampleResolution.result.verified === true,
      rangeCount: replacement.sampleResolution.result.ranges.length
    };
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
  report.failureCode = `B2_LIVE_${stage}_FAILED`;
  report.failureAssertion = /^[A-Z][A-Z0-9_]{2,79}$/u.test(String(error?.message || ''))
    ? String(error.message) : String(error?.code || 'UNCLASSIFIED_ASSERTION_FAILURE');
  try {
    report.failureState = await page?.evaluate(() => {
      const native = globalThis.__brevessNativePdfDocument;
      const semantic = globalThis.__brevessPdfSemanticDocument;
      const compat = globalThis.__brevessPdfSemanticCompatibility;
      const events = Array.isArray(globalThis.__b1Events) ? globalThis.__b1Events : [];
      const currentGeneration = Math.max(Number(native?.documentGeneration) || 0,
        Number(semantic?.documentGeneration) || 0);
      let adapterErrorCode = '';
      try {
        globalThis.SciLLM?.createPdfSemanticCompatibilityAdapter?.({
          semanticDocument: semantic,
          nativeDocument: native,
          getCurrentSemanticDocument: () => semantic,
          getCurrentNativeDocument: () => native
        });
      } catch (adapterError) {
        adapterErrorCode = String(adapterError?.code || 'UNCLASSIFIED_ADAPTER_FAILURE');
      }
      const nativeParagraphs = Array.isArray(native?.structure?.paragraphs)
        ? native.structure.paragraphs : [];
      const semanticParagraphs = Array.isArray(semantic?.index?.paragraphs)
        ? semantic.index.paragraphs : [];
      const semanticSections = Array.isArray(semantic?.index?.sections)
        ? semantic.index.sections : [];
      const nativeTextByPage = new Map(nativeParagraphs.map(paragraph => [
        Number(paragraph?.pageNumber), String(paragraph?.text || '')
      ]));
      const semanticMappings = Array.isArray(semantic?.index?.mappings)
        ? semantic.index.mappings : [];
      const resolutionDiagnostics = {};
      const navigationTargets = [];
      const pendingNavigationSections = Array.isArray(compat?.semanticNavigation?.sections)
        ? [...compat.semanticNavigation.sections] : [];
      while (pendingNavigationSections.length) {
        const section = pendingNavigationSections.shift();
        navigationTargets.push(...(Array.isArray(section?.paragraphTargets)
          ? section.paragraphTargets : []));
        pendingNavigationSections.push(...(Array.isArray(section?.children)
          ? section.children : []));
      }
      for (const target of navigationTargets.slice(0, 50)) {
        const quote = String(target?.expectedNormalizedQuote || '');
        const start = Number(target?.normalizedStart);
        const end = Number(target?.normalizedEnd);
        if (!target?.paragraphId || !Number.isSafeInteger(start) ||
            !Number.isSafeInteger(end) || end <= start || quote.length < 8 ||
            end - start !== quote.length) continue;
        const result = compat?.resolvePdfSemanticRange?.(
          target.paragraphId, start, end, quote);
        const key = `${String(result?.status || 'missing')}:${String(result?.reasonCode || 'none')}`;
        resolutionDiagnostics[key] = (resolutionDiagnostics[key] || 0) + 1;
      }
      return {
        viewerState: String(document.querySelector('#pdfNativeViewer')?.dataset?.state || ''),
        htmlReady: document.documentElement.dataset.brevessNativePdfReady === 'true',
        nativePhase: String(native?.phase || ''),
        nativeGeneration: Number(native?.documentGeneration) || 0,
        nativeParagraphCount: Number(native?.structure?.diagnostics?.paragraphCount) || 0,
        nativeTextCoverage: Number(native?.structure?.diagnostics?.textCoverage) || 0,
        nativeResidentParagraphCount: nativeParagraphs.length,
        nativeNonemptyParagraphCount: nativeParagraphs.filter(paragraph =>
          String(paragraph?.text || '').length > 0).length,
        semanticPhase: String(semantic?.phase || ''),
        semanticGeneration: Number(semantic?.documentGeneration) || 0,
        semanticRevision: Number(semantic?.revision) || 0,
        semanticPageCount: Number(semantic?.indexedPageCount) || 0,
        semanticMappingCount: Array.isArray(semantic?.index?.mappings)
          ? semantic.index.mappings.length : 0,
        exactCanonicalPageTextMatches: semanticMappings.filter(mapping =>
          nativeTextByPage.get(Number(mapping?.pageNumber)) === String(mapping?.rawText || '')
        ).length,
        semanticParagraphCount: semanticParagraphs.length,
        semanticSectionCount: semanticSections.length,
        semanticParagraphsWithSectionCount: semanticParagraphs.filter(paragraph =>
          typeof paragraph?.sectionId === 'string' && paragraph.sectionId.length > 0).length,
        semanticSectionParagraphRefCount: semanticSections.reduce((count, section) =>
          count + (Array.isArray(section?.paragraphIds) ? section.paragraphIds.length : 0), 0),
        compatibilityPresent: Boolean(compat),
        compatibilityHashMatches: Boolean(compat?.documentHash) &&
          compat.documentHash === semantic?.documentHash,
        compatibilityGeneration: Number(compat?.documentGeneration) || 0,
        compatibilityRevision: Number(compat?.revision) || 0,
        compatibilityStructureHasPrivateRuns:
          JSON.stringify(compat?.articleStructure || {}).includes('positionRuns'),
        compatibilityStructureLeaksInternalDocumentId:
          JSON.stringify(compat?.articleStructure || {}).includes('pdf-document:'),
        sampleResolution: (() => {
          const sample = globalThis.__b2ResolveSample?.(compat);
          return sample ? {
            status: String(sample.result?.status || ''),
            precision: String(sample.result?.precision || ''),
            verified: sample.result?.verified === true,
            rangeCount: Array.isArray(sample.result?.ranges) ? sample.result.ranges.length : 0,
            reasonCode: String(sample.result?.reasonCode || '')
          } : null;
        })(),
        resolutionDiagnostics,
        adapterFactoryType: typeof globalThis.SciLLM?.createPdfSemanticCompatibilityAdapter,
        adapterErrorCode,
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
