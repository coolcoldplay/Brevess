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

export function flattenSemanticParagraphTargets(navigation) {
  const targets = [];
  const pending = [...(Array.isArray(navigation?.sections) ? navigation.sections : [])];
  while (pending.length) {
    const section = pending.shift();
    targets.push(...(Array.isArray(section?.paragraphTargets)
      ? section.paragraphTargets : []));
    pending.push(...(Array.isArray(section?.children) ? section.children : []));
  }
  return targets;
}

export function assertMultiPageOverlayCoverage(requested = [], observed = [],
  code = 'B3_MULTI_PAGE_OVERLAY_INCOMPLETE') {
  const normalize = values => [...new Set((Array.isArray(values) ? values : [])
    .map(Number).filter(value => Number.isSafeInteger(value) && value > 0))]
    .sort((left, right) => left - right);
  const requestPages = normalize(requested);
  const overlayPages = normalize(observed);
  assert.ok(requestPages.length >= 2, 'B3_MULTI_PAGE_TARGET_UNAVAILABLE');
  assert.deepEqual(overlayPages, requestPages, code);
  return true;
}

export function safeFocusResult(result) {
  return Object.freeze({
    focused: result?.focused === true,
    focusedGranularity: ['sentence', 'paragraph', 'page', 'none']
      .includes(result?.focusedGranularity) ? result.focusedGranularity : 'none',
    precision: ['exact-raw', 'normalized-equivalent', 'page-only', 'none']
      .includes(result?.precision) ? result.precision : 'none',
    reasonCode: /^[A-Z][A-Z0-9_]{2,79}$/u.test(String(result?.reasonCode || ''))
      ? String(result.reasonCode) : '',
    pageNumber: Number.isSafeInteger(result?.pageNumber) && result.pageNumber > 0
      ? result.pageNumber : null
  });
}

export function assertRedactedReport(report) {
  const forbiddenKeys = new Set([
    'rawText', 'rawOffsets', 'normalizedStart', 'normalizedEnd',
    'expectedNormalizedQuote', 'quote', 'ranges', 'url', 'signedUrl', 'signature'
  ]);
  const visit = value => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== 'object') {
      if (typeof value === 'string') {
        assert.doesNotMatch(value, /(?:https?:\/\/|file:|chrome-extension:|[?&](?:sig|token)=)/iu,
          'B3_REPORT_LOCATION_OR_SIGNATURE_LEAK');
      }
      return;
    }
    for (const [key, entry] of Object.entries(value)) {
      assert.equal(forbiddenKeys.has(key), false, `B3_REPORT_FORBIDDEN_KEY_${key}`);
      visit(entry);
    }
  };
  visit(report);
  return true;
}

export function stableFailureCode(error) {
  const message = String(error?.message || error || '');
  const code = message.match(/\b[A-Z][A-Z0-9_]{2,79}\b/u)?.[0] || '';
  return code || 'B3_LIVE_UNCLASSIFIED_FAILURE';
}

function directInvocation() {
  const entry = process.argv[1];
  return Boolean(entry) && import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

function copyExtension(root, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const directory of ['core', 'providers', 'vendor', 'icons', '_locales']) {
    fs.cpSync(path.join(root, directory), path.join(destination, directory), {
      recursive: true
    });
  }
  for (const file of fs.readdirSync(root)) {
    if (/\.(?:js|mjs|html|css)$/u.test(file) || file === 'manifest.json') {
      fs.copyFileSync(path.join(root, file), path.join(destination, file));
    }
  }
}

function removeTemporary(target) {
  const temp = path.resolve(os.tmpdir());
  const resolved = path.resolve(target);
  if (resolved.startsWith(`${temp}${path.sep}`) &&
      path.basename(resolved).startsWith('brevess-pdf-semantic-b3-')) {
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}

async function run() {
  const root = path.resolve(import.meta.dirname, '..');
  const pdfPath = path.join(root, 'tmp', 'public-pdf-acceptance', 'elife-83176-v2.pdf');
  const outputDirectory = path.join(root, 'output', 'playwright',
    'pdf-semantic-focus-b3-live-r1-20260913');
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-pdf-semantic-b3-'));
  const temporaryExtension = path.join(temporaryRoot, 'extension');
  const profileDirectory = path.join(temporaryRoot, 'profile');
  const digest = filename => crypto.createHash('sha256').update(fs.readFileSync(filename))
    .digest('hex');
  const report = {
    schemaVersion: 1,
    status: 'RUNNING',
    acceptance: 'P2-B3 native PDF semantic focus live acceptance',
    source: { pdfSha256: EXPECTED_PDF_SHA256, pageCount: EXPECTED_PAGE_COUNT },
    isolation: { temporaryExtension: true, temporaryProfile: true, edgeChannel: true },
    network: { httpRequests: 0, apiRequests: 0 },
    diagnostics: { pageErrorCount: 0, consoleErrorCount: 0, workerErrorCount: 0 },
    checks: {},
    limitations: []
  };
  let context;
  let page;
  let panel;
  let stage = 'SOURCE';
  try {
    assert.equal(digest(pdfPath), EXPECTED_PDF_SHA256, 'B3_PUBLIC_PDF_HASH_MISMATCH');
    copyExtension(root, temporaryExtension);
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
      if (/(?:api\.|openai|deepseek|mineru|chat\/completions|responses)/iu
        .test(request.url())) report.network.apiRequests += 1;
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
      globalThis.__b3WorkerErrorCount = 0;
      globalThis.__b3LegacyRace = { armed: false, nativeStarted: false,
        semanticStarted: false, baselineGeneration: 0, legacyPageNumber: 23,
        legacyInitialFocused: null, observation: null };
      const NativeWorker = globalThis.Worker;
      globalThis.Worker = new Proxy(NativeWorker, {
        construct(Target, args, NewTarget) {
          const worker = Reflect.construct(Target, args, NewTarget);
          worker.addEventListener('error', () => { globalThis.__b3WorkerErrorCount += 1; });
          worker.addEventListener('messageerror', () => {
            globalThis.__b3WorkerErrorCount += 1;
          });
          return worker;
        }
      });
      const targets = navigation => {
        const found = [];
        const pending = [...(Array.isArray(navigation?.sections)
          ? navigation.sections : [])];
        while (pending.length) {
          const section = pending.shift();
          found.push(...(Array.isArray(section?.paragraphTargets)
            ? section.paragraphTargets : []));
          pending.push(...(Array.isArray(section?.children) ? section.children : []));
        }
        return found;
      };
      document.addEventListener('brevess:native-pdf-ready', event => {
        const race = globalThis.__b3LegacyRace;
        const generation = Number(
          globalThis.__brevessNativePdfDocument?.documentGeneration) || 0;
        if (!race?.armed || race.nativeStarted || generation <= race.baselineGeneration) return;
        race.nativeStarted = true;
        race.legacyInitialFocused = globalThis.__brevessNativePdfDocument?.focusPage?.(
          race.legacyPageNumber) === true;
      });
      document.addEventListener('brevess:pdf-semantic-ready', () => {
        const race = globalThis.__b3LegacyRace;
        const native = globalThis.__brevessNativePdfDocument;
        const compatibility = globalThis.__brevessPdfSemanticCompatibility;
        const navigation = native?.getSemanticNavigation?.();
        if (!race?.armed || !race.nativeStarted || race.semanticStarted ||
            !compatibility || !navigation) return;
        const target = targets(navigation).find(candidate => {
          const request = compatibility.createNativeFocusRequest?.(
            candidate.paragraphId, candidate.normalizedStart, candidate.normalizedEnd,
            candidate.expectedNormalizedQuote);
          return request?.mode === 'ranges';
        });
        if (!target) return;
        race.semanticStarted = true;
        Promise.resolve(globalThis.__brevessNativePdfDocument?.focusSemanticTarget?.(
          structuredClone(target))).then(result => {
          const pageNumber = Number(result?.pageNumber) || null;
          const pageElement = pageNumber
            ? document.querySelector(`.pdf-native-page[data-pdf-page-number="${pageNumber}"]`)
            : null;
          race.observation = {
            focused: result?.focused === true,
            focusedGranularity: String(result?.focusedGranularity || 'none'),
            precision: String(result?.precision || 'none'),
            reasonCode: String(result?.reasonCode || ''),
            pageNumber,
            semanticOverlayCount: pageElement?.querySelectorAll(
              '.pdf-native-semantic-focus-hit').length || 0,
            oldLegacyPageFocused: document.querySelector(
              `.pdf-native-page[data-pdf-page-number="${race.legacyPageNumber}"]`)
              ?.classList.contains('pdf-native-page-focus') === true
          };
        });
      });
    });

    await page.goto(`chrome-extension://${extensionId}/pdf-reader.html`, {
      waitUntil: 'domcontentloaded'
    });
    stage = 'FULL_INDEX';
    await page.locator('#pdfLocalFile').setInputFiles(pdfPath);
    await page.waitForFunction(({ hash, count }) => {
      const native = globalThis.__brevessNativePdfDocument;
      const semantic = globalThis.__brevessPdfSemanticDocument;
      const compatibility = globalThis.__brevessPdfSemanticCompatibility;
      return native?.phase === 'text-ready' && native?.structure?.documentHash === hash &&
        semantic?.phase === 'text-ready' && semantic?.documentHash === hash &&
        semantic?.indexedPageCount === count && compatibility?.documentHash === hash &&
        compatibility?.documentGeneration === native?.documentGeneration &&
        native?.getSemanticNavigation?.()?.documentGeneration === native?.documentGeneration;
    }, { hash: EXPECTED_PDF_SHA256, count: EXPECTED_PAGE_COUNT }, { timeout: 120_000 });

    stage = 'TARGET_SELECTION';
    await page.evaluate(async () => {
      await globalThis.__brevessPdfReaderBridge.command('updatePageWindow', 1, 1);
    });
    const selected = await page.evaluate(() => {
      const native = globalThis.__brevessNativePdfDocument;
      const compatibility = globalThis.__brevessPdfSemanticCompatibility;
      const pending = [...(native?.getSemanticNavigation?.()?.sections || [])];
      const targets = [];
      while (pending.length) {
        const section = pending.shift();
        targets.push(...(section?.paragraphTargets || []));
        pending.push(...(section?.children || []));
      }
      let pageOnly = null;
      let attempts = 0;
      for (const target of targets) {
        const text = String(target.expectedNormalizedQuote || '');
        const candidates = new Set([0, Math.max(0, text.length - 1)]);
        for (let index = 1; index < text.length && candidates.size < 64; index += 1) {
          if (/\s|[.,;:()\[\]{}-]/u.test(text[index]) ||
              /\s|[.,;:()\[\]{}-]/u.test(text[index - 1])) candidates.add(index);
        }
        for (const localStart of candidates) {
          if (localStart >= text.length || attempts >= 5000) break;
          attempts += 1;
          const start = target.normalizedStart + localStart;
          const end = start + 1;
          const request = compatibility.createNativeFocusRequest?.(
            target.paragraphId, start, end, text.slice(localStart, localStart + 1));
          if (request?.mode === 'page-only') {
            pageOnly = { target: structuredClone(target), selection: {
              normalizedStart: start, normalizedEnd: end,
              expectedNormalizedQuote: text.slice(localStart, localStart + 1)
            }, pageNumber: request.pageNumber };
            break;
          }
        }
        if (pageOnly || attempts >= 5000) break;
      }
      const far = targets.map(target => ({ target,
        request: compatibility.createNativeFocusRequest?.(
          target.paragraphId, target.normalizedStart, target.normalizedEnd,
          target.expectedNormalizedQuote) }))
        .filter(item => item.request?.mode === 'ranges' && item.request.pageNumber >= 15 &&
          new Set(item.request.ranges.map(range => range.pageNumber)).size >= 2)
        .sort((left, right) => right.request.pageNumber - left.request.pageNumber)[0];
      if (!far) return null;
      const sidebar = targets.map(target => ({ target,
        request: compatibility.createNativeFocusRequest?.(
          target.paragraphId, target.normalizedStart, target.normalizedEnd,
          target.expectedNormalizedQuote) }))
        .filter(item => item.target.paragraphId !== far.target.paragraphId &&
          item.request?.mode === 'ranges' &&
          new Set(item.request.ranges.map(range => range.pageNumber)).size >= 2)
        .sort((left, right) => right.request.pageNumber - left.request.pageNumber)[0];
      if (!sidebar) return null;
      globalThis.__b3FarTarget = structuredClone(far.target);
      globalThis.__b3SidebarTarget = structuredClone(sidebar.target);
      globalThis.__b3PageOnly = pageOnly;
      const section = document.querySelector(
        `.pdf-native-page[data-pdf-page-number="${far.request.pageNumber}"]`);
      return { pageNumber: far.request.pageNumber,
        precision: far.request.precision,
        sidebarParagraphId: sidebar.target.paragraphId,
        sidebarPageNumbers: [...new Set(sidebar.request.ranges.map(range => range.pageNumber))],
        sidebarDistinct: sidebar.target.paragraphId !== far.target.paragraphId,
        initiallyMounted: Boolean(section &&
          !section.classList.contains('pdf-native-page-placeholder') &&
          section.querySelector('.pdf-native-text-layer')),
        pageOnlyApplicable: Boolean(pageOnly), pageOnlyPageNumber: pageOnly?.pageNumber || null,
        pageOnlyScanAttempts: attempts };
    });
    assert.ok(selected, 'B3_REAL_FAR_EXACT_TARGET_UNAVAILABLE');
    assert.equal(selected.sidebarDistinct, true, 'B3_SIDEBAR_TARGET_REUSED_EXACT_TARGET');
    assert.equal(selected.initiallyMounted, false, 'B3_FAR_TARGET_ALREADY_MOUNTED');

    stage = 'EXACT_FOCUS';
    const exact = await page.evaluate(async () => {
      const target = globalThis.__b3FarTarget;
      const nativeBefore = globalThis.__brevessNativePdfDocument;
      const navigationBefore = nativeBefore?.getSemanticNavigation?.();
      const compatibility = globalThis.__brevessPdfSemanticCompatibility;
      const request = compatibility.createNativeFocusRequest(
        target.paragraphId, target.normalizedStart, target.normalizedEnd,
        target.expectedNormalizedQuote);
      const focusStartedAt = performance.now();
      const result = await globalThis.__brevessNativePdfDocument.focusSemanticTarget(
        structuredClone(target));
      const focusReturnedAt = performance.now();
      const nativeAfter = globalThis.__brevessNativePdfDocument;
      const navigationAfter = nativeAfter?.getSemanticNavigation?.();
      const requestPages = new Set((request.ranges || []).map(range => range.pageNumber));
      const captureFocusLayers = elapsedMs => {
        const requested = [...requestPages];
        const pageRows = requested.map(pageNumber => {
          const pageNode = document.querySelector(
            `.pdf-native-page[data-pdf-page-number="${pageNumber}"]`);
          const placeholder = !pageNode ||
            pageNode.classList.contains('pdf-native-page-placeholder') ||
            !pageNode.querySelector('.pdf-native-text-layer');
          const layers = [...(pageNode?.querySelectorAll(
            '.pdf-native-semantic-focus-layer') || [])];
          const hits = layers.flatMap(layer => [...layer.querySelectorAll(
            '.pdf-native-semantic-focus-hit')]);
          const nonzeroHits = hits.filter(hit => {
            const rect = hit.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          });
          return { pageNumber, placeholder, layerCount: layers.length,
            hitCount: hits.length, nonzeroHitCount: nonzeroHits.length };
        });
        return {
          elapsedMs: Math.max(0, Math.round(elapsedMs)),
          placeholderCount: pageRows.filter(row => row.placeholder).length,
          placeholderPageNumbers: pageRows.filter(row => row.placeholder)
            .map(row => row.pageNumber),
          layerCount: pageRows.reduce((sum, row) => sum + row.layerCount, 0),
          hitCount: pageRows.reduce((sum, row) => sum + row.hitCount, 0),
          nonzeroHitCount: pageRows.reduce((sum, row) => sum + row.nonzeroHitCount, 0),
          layerPageNumbers: pageRows.filter(row => row.layerCount > 0)
            .map(row => row.pageNumber),
          hitPageNumbers: pageRows.filter(row => row.hitCount > 0)
            .map(row => row.pageNumber),
          overlayPageNumbers: pageRows.filter(row => row.nonzeroHitCount > 0)
            .map(row => row.pageNumber)
        };
      };
      const immediateFocus = captureFocusLayers(focusReturnedAt - focusStartedAt);
      const normalize = value => String(value || '').normalize('NFKC')
        .replace(/\s+/gu, ' ').trim();
      const targetText = normalize(target.expectedNormalizedQuote);
      for (const pageNumber of requestPages) {
        await globalThis.__brevessPdfReaderBridge.command(
          'updatePageWindow', pageNumber, pageNumber);
      }
      const afterWindowFocus = captureFocusLayers(performance.now() - focusStartedAt);
      const textPositionBound = [...requestPages].some(pageNumber => {
        const pageNode = document.querySelector(
          `.pdf-native-page[data-pdf-page-number="${pageNumber}"]`);
        const hitRects = [...(pageNode?.querySelectorAll(
          '.pdf-native-semantic-focus-hit') || [])]
          .map(hit => hit.getBoundingClientRect())
          .filter(rect => rect.width > 0 && rect.height > 0);
        const spans = [...(pageNode?.querySelectorAll('.pdf-native-text-layer span') || [])];
        return hitRects.some(hitRect => spans.some(span => {
          const rect = span.getBoundingClientRect();
          const overlaps = rect.left < hitRect.right && rect.right > hitRect.left &&
            rect.top < hitRect.bottom && rect.bottom > hitRect.top;
          const tokens = normalize(span.textContent).match(/[\p{L}\p{N}]{3,}/gu) || [];
          return overlaps && tokens.some(token => targetText.includes(token));
        }));
      });
      const rangeDiagnostics = (request.ranges || []).map(range => {
        const rangePage = document.querySelector(
          `.pdf-native-page[data-pdf-page-number="${range.pageNumber}"]`);
        const textLayer = rangePage?.querySelector('.pdf-native-text-layer');
        const projection = textLayer
          ? globalThis.SciLLM.readPdfTextProjection?.(textLayer, { mode: 'raw-offset' })
          : null;
        const sliceMatches = Boolean(projection &&
          projection.text.slice(range.start, range.end) === range.quote);
        const domRange = sliceMatches
          ? globalThis.SciLLM.pdfProjectionRange?.(projection, range, document) : null;
        const rects = domRange ? [...domRange.getClientRects()]
          .filter(rect => rect.width > 0 && rect.height > 0) : [];
        return { sliceMatches, domRange: Boolean(domRange), nonzeroRects: rects.length > 0 };
      });
      return {
        focused: result?.focused === true,
        focusedGranularity: String(result?.focusedGranularity || 'none'),
        precision: String(result?.precision || 'none'),
        reasonCode: String(result?.reasonCode || ''),
        pageNumber: Number(result?.pageNumber) || null,
        mounted: afterWindowFocus.placeholderCount === 0,
        overlayRectCount: afterWindowFocus.nonzeroHitCount,
        requestPageNumbers: [...requestPages],
        overlayPageNumbers: afterWindowFocus.overlayPageNumbers,
        immediateFocus,
        afterWindowFocus,
        textPositionBound,
        targetRevision: Number(target?.revision) || null,
        beforeRevision: Number(navigationBefore?.revision) || null,
        afterRevision: Number(navigationAfter?.revision) || null,
        beforeGeneration: Number(nativeBefore?.documentGeneration) || null,
        afterGeneration: Number(nativeAfter?.documentGeneration) || null,
        nativeWrapperChanged: nativeBefore !== nativeAfter,
        navigationChanged: navigationBefore !== navigationAfter,
        requestRangeCount: rangeDiagnostics.length,
        sliceMatchCount: rangeDiagnostics.filter(item => item.sliceMatches).length,
        domRangeCount: rangeDiagnostics.filter(item => item.domRange).length,
        nonzeroRectRangeCount: rangeDiagnostics.filter(item => item.nonzeroRects).length
      };
    });
    report.checks.exactFocusObserved = {
      focused: exact.focused,
      pageNumber: exact.pageNumber,
      precision: exact.precision,
      focusedGranularity: exact.focusedGranularity,
      mounted: exact.mounted,
      overlayRectCount: exact.overlayRectCount,
      requestPageNumbers: exact.requestPageNumbers,
      overlayPageNumbers: exact.overlayPageNumbers,
      immediateFocus: exact.immediateFocus,
      afterWindowFocus: exact.afterWindowFocus,
      textPositionBound: exact.textPositionBound,
      reasonCode: exact.reasonCode,
      targetRevision: exact.targetRevision,
      beforeRevision: exact.beforeRevision,
      afterRevision: exact.afterRevision,
      beforeGeneration: exact.beforeGeneration,
      afterGeneration: exact.afterGeneration,
      nativeWrapperChanged: exact.nativeWrapperChanged,
      navigationChanged: exact.navigationChanged,
      requestRangeCount: exact.requestRangeCount,
      sliceMatchCount: exact.sliceMatchCount,
      domRangeCount: exact.domRangeCount,
      nonzeroRectRangeCount: exact.nonzeroRectRangeCount
    };
    assert.equal(exact.focused, true, 'B3_EXACT_FOCUS_FAILED');
    assert.equal(exact.focusedGranularity, 'paragraph', 'B3_EXACT_GRANULARITY_INVALID');
    assert.ok(['exact-raw', 'normalized-equivalent'].includes(exact.precision),
      'B3_EXACT_PRECISION_INVALID');
    assert.equal(exact.immediateFocus.placeholderCount, 0,
      'B3_IMMEDIATE_FOCUS_PAGE_PLACEHOLDER');
    assert.ok(exact.immediateFocus.layerCount > 0 && exact.immediateFocus.hitCount > 0,
      'B3_IMMEDIATE_FOCUS_LAYER_EMPTY');
    assertMultiPageOverlayCoverage(exact.requestPageNumbers,
      exact.immediateFocus.layerPageNumbers, 'B3_IMMEDIATE_FOCUS_LAYER_PAGE_MISMATCH');
    assertMultiPageOverlayCoverage(exact.requestPageNumbers,
      exact.immediateFocus.hitPageNumbers, 'B3_IMMEDIATE_FOCUS_HIT_PAGE_MISMATCH');
    assertMultiPageOverlayCoverage(exact.requestPageNumbers,
      exact.immediateFocus.overlayPageNumbers, 'B3_IMMEDIATE_FOCUS_OVERLAY_INCOMPLETE');
    assert.equal(exact.afterWindowFocus.placeholderCount, 0,
      'B3_AFTER_WINDOW_FOCUS_PAGE_PLACEHOLDER');
    assert.ok(exact.afterWindowFocus.layerCount > 0 && exact.afterWindowFocus.hitCount > 0,
      'B3_AFTER_WINDOW_FOCUS_LAYER_EMPTY');
    assertMultiPageOverlayCoverage(exact.requestPageNumbers,
      exact.afterWindowFocus.layerPageNumbers, 'B3_AFTER_WINDOW_FOCUS_LAYER_PAGE_MISMATCH');
    assertMultiPageOverlayCoverage(exact.requestPageNumbers,
      exact.afterWindowFocus.hitPageNumbers, 'B3_AFTER_WINDOW_FOCUS_HIT_PAGE_MISMATCH');
    assertMultiPageOverlayCoverage(exact.requestPageNumbers,
      exact.afterWindowFocus.overlayPageNumbers, 'B3_AFTER_WINDOW_FOCUS_OVERLAY_INCOMPLETE');
    assert.equal(exact.mounted, true, 'B3_FAR_PAGE_NOT_MOUNTED');
    assert.ok(exact.overlayRectCount > 0, 'B3_EXACT_OVERLAY_EMPTY');
    assertMultiPageOverlayCoverage(exact.requestPageNumbers, exact.overlayPageNumbers,
      'B3_MULTI_PAGE_OVERLAY_INCOMPLETE');
    assert.equal(exact.sliceMatchCount, exact.requestRangeCount,
      'B3_MULTI_PAGE_RAW_SLICE_MISMATCH');
    assert.equal(exact.domRangeCount, exact.requestRangeCount,
      'B3_MULTI_PAGE_DOM_RANGE_MISSING');
    assert.equal(exact.nonzeroRectRangeCount, exact.requestRangeCount,
      'B3_MULTI_PAGE_PROJECTED_RECTS_MISSING');
    assert.equal(exact.textPositionBound, true, 'B3_OVERLAY_TEXT_POSITION_NOT_BOUND');
    report.checks.exactFocus = { pageNumber: exact.pageNumber, precision: exact.precision,
      focusedGranularity: exact.focusedGranularity, mountedFromVirtual: true,
      overlayRectCount: exact.overlayRectCount, textPositionBound: true };

    stage = 'SIDEBAR_NAVIGATION';
    const readerTabId = await page.evaluate(async () =>
      Number((await chrome.tabs.getCurrent())?.id) || 0);
    assert.ok(readerTabId > 0, 'B3_SIDEBAR_READER_TAB_UNAVAILABLE');
    const contentWorkspace = await extensionWorker.evaluate(async tabId => {
      try {
        const response = await chrome.tabs.sendMessage(tabId, {
          action: 'getArticleWorkspaceSnapshot', forceRefresh: false
        });
        return {
          success: response?.success === true,
          code: String(response?.code || ''),
          snapshotAvailable: Boolean(response?.snapshot),
          snapshotDocumentHashPresent: Boolean(response?.snapshot?.documentHash),
          semanticAvailable: Boolean(response?.pdfSemanticNavigation?.documentHash),
          semanticSectionCount: Array.isArray(response?.pdfSemanticNavigation?.sections)
            ? response.pdfSemanticNavigation.sections.length : 0
        };
      } catch (error) {
        return { success: false, code: String(error?.code || 'TAB_MESSAGE_FAILED'),
          snapshotAvailable: false, snapshotDocumentHashPresent: false,
          semanticAvailable: false, semanticSectionCount: 0 };
      }
    }, readerTabId);
    report.checks.contentWorkspace = contentWorkspace;
    assert.equal(contentWorkspace.success, true, 'B3_CONTENT_WORKSPACE_READ_FAILED');
    assert.equal(contentWorkspace.snapshotAvailable, true,
      'B3_CONTENT_WORKSPACE_SNAPSHOT_MISSING');
    assert.equal(contentWorkspace.snapshotDocumentHashPresent, true,
      'B3_CONTENT_WORKSPACE_IDENTITY_MISSING');
    assert.equal(contentWorkspace.semanticAvailable, true,
      'B3_CONTENT_SEMANTIC_NAVIGATION_MISSING');
    assert.ok(contentWorkspace.semanticSectionCount > 0,
      'B3_CONTENT_SEMANTIC_SECTIONS_EMPTY');
    await page.locator('#pdfReaderStudy').click();
    panel = await context.newPage();
    await panel.setViewportSize({ width: 520, height: 900 });
    panel.on('pageerror', () => { report.diagnostics.pageErrorCount += 1; });
    panel.on('console', message => {
      if (message.type() === 'error') report.diagnostics.consoleErrorCount += 1;
    });
    await panel.goto(`chrome-extension://${extensionId}/popup.html`, {
      waitUntil: 'domcontentloaded'
    });
    await extensionWorker.evaluate(tabId => chrome.tabs.update(tabId, { active: true }),
      readerTabId);
    await page.bringToFront();
    await panel.waitForFunction(() =>
      typeof panelUiReady !== 'undefined' && panelUiReady === true,
      null, { timeout: 30_000 });
    await panel.evaluate(async () => {
      await synchronizeActiveTabContext({ force: true });
      if (!activePanelTabContext?.activated) {
        await activateCurrentTabFromSidePanel();
        await synchronizeActiveTabContext({ force: true });
      }
      switchWorkspaceView('navigation', { persist: false });
      globalThis.__b3SidebarRefreshResult = await refreshArticleWorkspace({
        announce: true, throwOnError: true
      });
    });
    const sidebarParagraphId = selected.sidebarParagraphId;
    const sidebarInitial = await panel.evaluate(paragraphId => ({
      activated: activePanelTabContext?.activated === true,
      pdfMode: activePanelTabContext?.pdfMode === true,
      snapshotAvailable: Boolean(currentWorkspaceSnapshot?.documentHash),
      snapshotMatches: Boolean(currentWorkspaceSnapshot?.documentHash &&
        currentPdfSemanticNavigation?.documentHash &&
        currentWorkspaceSnapshot.documentHash === currentPdfSemanticNavigation.documentHash),
      semanticAvailable: Boolean(currentPdfSemanticNavigation?.documentHash),
      sectionCount: document.querySelectorAll(
        '#articleNavigationTree details.workspace-pdf-semantic-node').length,
      paragraphCount: document.querySelectorAll(
        '#articleNavigationTree [data-pdf-semantic-focus="paragraph"]').length,
      targetAvailable: [...document.querySelectorAll(
        '#articleNavigationTree [data-pdf-semantic-focus="paragraph"]')]
        .some(candidate => candidate.dataset.paragraphId === paragraphId),
      refreshReturnedSnapshot: Boolean(globalThis.__b3SidebarRefreshResult?.documentHash),
      preparationErrorCode: String(lastArticlePreparationError?.code || '')
    }), sidebarParagraphId);
    report.checks.sidebarInitial = sidebarInitial;
    assert.equal(sidebarInitial.activated, true, 'B3_SIDEBAR_ARTICLE_NOT_ACTIVATED');
    assert.equal(sidebarInitial.pdfMode, true, 'B3_SIDEBAR_NOT_BOUND_TO_PDF');
    await panel.waitForFunction(paragraphId => {
      const navigation = currentPdfSemanticNavigation;
      const button = [...document.querySelectorAll(
        '#articleNavigationTree [data-pdf-semantic-focus="paragraph"]')]
        .find(candidate => candidate.dataset.paragraphId === paragraphId);
      return navigation?.documentHash && button;
    }, sidebarParagraphId, { timeout: 60_000 });
    await page.evaluate(async () => {
      await globalThis.__brevessPdfReaderBridge.command('updatePageWindow', 1, 1);
    });
    const sidebarFocusReset = await page.evaluate(() => {
      document.querySelectorAll('.pdf-native-semantic-focus-layer')
        .forEach(layer => layer.remove());
      return {
        layerCount: document.querySelectorAll('.pdf-native-semantic-focus-layer').length,
        hitCount: document.querySelectorAll('.pdf-native-semantic-focus-hit').length
      };
    });
    assert.deepEqual(sidebarFocusReset, { layerCount: 0, hitCount: 0 },
      'B3_SIDEBAR_PRECLICK_FOCUS_NOT_CLEARED');
    await panel.evaluate(paragraphId => {
      globalThis.__b3SidebarPendingObserved = false;
      const button = [...document.querySelectorAll(
        '#articleNavigationTree [data-pdf-semantic-focus="paragraph"]')]
        .find(candidate => candidate.dataset.paragraphId === paragraphId);
      const observer = new MutationObserver(() => {
        if (button?.classList.contains('is-pending') &&
            button.getAttribute('aria-busy') === 'true') {
          globalThis.__b3SidebarPendingObserved = true;
        }
      });
      observer.observe(button, { attributes: true,
        attributeFilter: ['class', 'aria-busy'] });
      button.click();
    }, sidebarParagraphId);
    await panel.waitForFunction(() => {
      const status = document.getElementById('articleNavigationFocusStatus');
      return status?.dataset?.state && status.dataset.state !== 'pending';
    }, null, { timeout: 60_000 });
    const sidebar = await panel.evaluate(paragraphId => {
      const container = document.getElementById('articleNavigationTree');
      const status = document.getElementById('articleNavigationFocusStatus');
      const targetButton = [...container.querySelectorAll(
        '[data-pdf-semantic-focus="paragraph"]')]
        .find(candidate => candidate.dataset.paragraphId === paragraphId);
      return {
        semanticTree: container.dataset.pdfSemanticNavigation === 'true',
        sectionCount: container.querySelectorAll('details.workspace-pdf-semantic-node').length,
        paragraphCount: container.querySelectorAll(
          '[data-pdf-semantic-focus="paragraph"]').length,
        nestedSectionCount: container.querySelectorAll(
          '.workspace-pdf-semantic-children details.workspace-pdf-semantic-node').length,
        pendingObserved: globalThis.__b3SidebarPendingObserved === true,
        pendingCleared: !targetButton?.classList.contains('is-pending') &&
          !targetButton?.hasAttribute('aria-busy'),
        statusState: String(status?.dataset?.state || ''),
        statusAnnounced: String(status?.textContent || '').trim().length > 0,
        transientSibling: !Object.prototype.hasOwnProperty.call(
          currentWorkspaceSnapshot || {}, 'pdfSemanticNavigation'),
        sameDocument: currentPdfSemanticNavigation?.documentHash ===
          currentWorkspaceSnapshot?.documentHash
      };
    }, sidebarParagraphId);
    const sidebarReader = await page.evaluate(pageNumbers => {
      const rows = pageNumbers.map(pageNumber => {
        const targetPage = document.querySelector(
          `.pdf-native-page[data-pdf-page-number="${pageNumber}"]`);
        const overlayRectCount = [...(targetPage?.querySelectorAll(
          '.pdf-native-semantic-focus-hit') || [])]
          .map(hit => hit.getBoundingClientRect())
          .filter(rect => rect.width > 0 && rect.height > 0).length;
        return { pageNumber,
          mounted: Boolean(targetPage &&
            !targetPage.classList.contains('pdf-native-page-placeholder') &&
            targetPage.querySelector('.pdf-native-text-layer')),
          overlayRectCount };
      });
      const overlayHits = [...document.querySelectorAll(
        '.pdf-native-semantic-focus-layer .pdf-native-semantic-focus-hit')];
      return { allMounted: rows.every(row => row.mounted),
        overlayRectCount: overlayHits.map(hit => hit.getBoundingClientRect())
          .filter(rect => rect.width > 0 && rect.height > 0).length,
        overlayPageNumbers: [...new Set(overlayHits.map(hit => Number(hit.closest(
          '.pdf-native-page')?.dataset?.pdfPageNumber)).filter(Boolean))] };
    }, selected.sidebarPageNumbers);
    assert.equal(sidebar.semanticTree, true, 'B3_SIDEBAR_SEMANTIC_TREE_MISSING');
    assert.ok(sidebar.sectionCount > 0 && sidebar.paragraphCount > 0,
      'B3_SIDEBAR_SEMANTIC_CONTENT_EMPTY');
    assert.ok(sidebar.nestedSectionCount > 0, 'B3_SIDEBAR_NESTED_SECTIONS_MISSING');
    assert.equal(sidebar.pendingObserved, true, 'B3_SIDEBAR_PENDING_NOT_OBSERVED');
    assert.equal(sidebar.pendingCleared, true, 'B3_SIDEBAR_PENDING_NOT_CLEARED');
    assert.ok(['exact', 'normalized'].includes(sidebar.statusState),
      'B3_SIDEBAR_FOCUS_STATUS_NOT_PRECISE');
    assert.equal(sidebar.statusAnnounced, true, 'B3_SIDEBAR_FOCUS_NOT_ANNOUNCED');
    assert.equal(sidebar.transientSibling, true, 'B3_SEMANTIC_DATA_ENTERED_SNAPSHOT');
    assert.equal(sidebar.sameDocument, true, 'B3_SIDEBAR_SEMANTIC_DOCUMENT_MISMATCH');
    assert.equal(sidebarReader.allMounted, true, 'B3_SIDEBAR_TARGET_PAGE_NOT_MOUNTED');
    assert.ok(sidebarReader.overlayRectCount > 0, 'B3_SIDEBAR_TARGET_OVERLAY_EMPTY');
    assertMultiPageOverlayCoverage(selected.sidebarPageNumbers,
      sidebarReader.overlayPageNumbers, 'B3_SIDEBAR_MULTI_PAGE_OVERLAY_INCOMPLETE');
    report.checks.sidebarNavigation = {
      semanticTree: true,
      sectionCount: sidebar.sectionCount,
      paragraphCount: sidebar.paragraphCount,
      nestedSectionCount: sidebar.nestedSectionCount,
      pendingObserved: true,
      pendingCleared: true,
      statusState: sidebar.statusState,
      statusAnnounced: true,
      transientSibling: true,
      sameDocument: true,
      mounted: true,
      overlayRectCount: sidebarReader.overlayRectCount
    };

    stage = 'PAGE_ONLY';
    if (selected.pageOnlyApplicable) {
      const pageOnly = await page.evaluate(async () => {
        const sample = globalThis.__b3PageOnly;
        const result = await globalThis.__brevessNativePdfDocument.focusSemanticTarget(
          structuredClone(sample.target),
          structuredClone(sample.selection));
        return {
          focused: result?.focused === true,
          focusedGranularity: String(result?.focusedGranularity || 'none'),
          precision: String(result?.precision || 'none'),
          reasonCode: String(result?.reasonCode || ''),
          pageNumber: Number(result?.pageNumber) || null,
          remainingExactOverlayCount: document.querySelectorAll(
            '.pdf-native-semantic-focus-layer').length
        };
      });
      assert.equal(pageOnly.focused, true, 'B3_PAGE_ONLY_FOCUS_FAILED');
      assert.equal(pageOnly.focusedGranularity, 'page');
      assert.equal(pageOnly.precision, 'page-only');
      assert.equal(pageOnly.reasonCode, 'PDF_FOCUS_PAGE_ONLY');
      assert.equal(pageOnly.remainingExactOverlayCount, 0,
        'B3_PAGE_ONLY_DID_NOT_CLEAR_EXACT_OVERLAY');
      report.checks.pageOnly = { applicable: true, pageNumber: pageOnly.pageNumber,
        precision: pageOnly.precision, reasonCode: pageOnly.reasonCode,
        clearedExactOverlay: true, scanAttempts: selected.pageOnlyScanAttempts };
    } else {
      report.checks.pageOnly = { applicable: false, pageNumber: null, precision: 'none',
        reasonCode: 'PDF_FOCUS_PAGE_ONLY_SAMPLE_UNAVAILABLE', clearedExactOverlay: null,
        scanAttempts: selected.pageOnlyScanAttempts };
      report.limitations.push('PDF_FOCUS_PAGE_ONLY_SAMPLE_UNAVAILABLE');
    }

    stage = 'REPLACEMENT_RACE';
    await page.evaluate(() => globalThis.__brevessPdfReaderBridge.command(
      'updatePageWindow', 1, 1));
    const replacement = await page.evaluate(async () => {
      const beforeGeneration = globalThis.__brevessNativePdfDocument?.documentGeneration;
      const viewer = document.querySelector('#pdfNativeViewer');
      let raceScrollCount = 0;
      const originalScrollTo = viewer.scrollTo.bind(viewer);
      viewer.scrollTo = (...args) => {
        raceScrollCount += 1;
        return originalScrollTo(...args);
      };
      const pending = globalThis.__brevessNativePdfDocument.focusSemanticTarget(
        structuredClone(globalThis.__b3FarTarget));
      const replacing = globalThis.__brevessPdfReaderBridge.command('replaceDocument');
      const [result] = await Promise.all([pending, replacing]);
      viewer.scrollTo = originalScrollTo;
      return {
        focused: result?.focused === true,
        focusedGranularity: String(result?.focusedGranularity || 'none'),
        precision: String(result?.precision || 'none'),
        reasonCode: String(result?.reasonCode || ''),
        pageNumber: Number(result?.pageNumber) || null,
        beforeGeneration,
        compatibilityCleared: !globalThis.__brevessPdfSemanticCompatibility,
        raceScrollCount,
        overlayCount: document.querySelectorAll('.pdf-native-semantic-focus-layer').length
      };
    });
    assert.equal(replacement.focused, false, 'B3_STALE_FOCUS_REPORTED_SUCCESS');
    assert.equal(replacement.reasonCode, 'PDF_FOCUS_STALE');
    assert.equal(replacement.compatibilityCleared, true,
      'B3_REPLACEMENT_DID_NOT_CLEAR_COMPATIBILITY');
    assert.equal(replacement.raceScrollCount, 0, 'B3_STALE_FOCUS_SCROLLED_REPLACEMENT');
    assert.equal(replacement.overlayCount, 0, 'B3_STALE_FOCUS_LEFT_OVERLAY');
    stage = 'REPLACEMENT_READY';
    await page.waitForFunction(({ hash, count }) => {
      const native = globalThis.__brevessNativePdfDocument;
      const semantic = globalThis.__brevessPdfSemanticDocument;
      return native?.phase === 'text-ready' && native?.structure?.documentHash === hash &&
        semantic?.phase === 'text-ready' && semantic?.indexedPageCount === count &&
        globalThis.__brevessPdfSemanticCompatibility?.documentGeneration ===
          native.documentGeneration;
    }, { hash: EXPECTED_PDF_SHA256, count: EXPECTED_PAGE_COUNT }, { timeout: 120_000 });
    const replacementGenerationAdvanced = await page.evaluate(previous =>
      Number(globalThis.__brevessNativePdfDocument?.documentGeneration) > previous,
    replacement.beforeGeneration);
    assert.equal(replacementGenerationAdvanced, true,
      'B3_REPLACEMENT_GENERATION_DID_NOT_ADVANCE');
    report.checks.replacementRace = { pageNumber: replacement.pageNumber,
      precision: replacement.precision, reasonCode: replacement.reasonCode,
      generationAdvanced: true, compatibilityCleared: true, scrollCount: 0,
      overlayCount: 0 };

    stage = 'LEGACY_FOCUS';
    const legacy = await page.evaluate(async () => {
      await globalThis.__brevessPdfReaderBridge.command('updatePageWindow', 1, 1);
      const focused = globalThis.__brevessPdfReaderBridge.command('focusPage', 1) === true;
      return { focused, pageNumber: 1,
        pageIndicated: document.querySelector(
          '.pdf-native-page[data-pdf-page-number="1"]')
          ?.classList.contains('pdf-native-page-focus') === true };
    });
    assert.equal(legacy.focused, true, 'B3_LEGACY_FOCUS_PAGE_FAILED');
    assert.equal(legacy.pageIndicated, true, 'B3_LEGACY_FOCUS_PAGE_NOT_INDICATED');
    report.checks.legacyFocus = { pageNumber: legacy.pageNumber, focused: true,
      pageIndicated: true };

    stage = 'LEGACY_SUPERSESSION';
    await page.evaluate(() => {
      const race = globalThis.__b3LegacyRace;
      race.armed = true;
      race.baselineGeneration = globalThis.__brevessNativePdfDocument?.documentGeneration || 0;
      globalThis.__brevessPdfReaderBridge.command('replaceDocument');
    });
    await page.waitForFunction(() => globalThis.__b3LegacyRace?.observation,
      null, { timeout: 120_000 });
    const supersession = await page.evaluate(() => ({
      legacyPageNumber: globalThis.__b3LegacyRace.legacyPageNumber,
      legacyInitialFocused: globalThis.__b3LegacyRace.legacyInitialFocused,
      ...globalThis.__b3LegacyRace.observation
    }));
    assert.equal(supersession.legacyInitialFocused, false,
      'B3_LEGACY_FOCUS_WAS_NOT_DEFERRED');
    assert.equal(supersession.focused, true, 'B3_NEWER_SEMANTIC_FOCUS_FAILED');
    assert.ok(['exact-raw', 'normalized-equivalent'].includes(supersession.precision),
      'B3_NEWER_SEMANTIC_PRECISION_INVALID');
    assert.ok(supersession.semanticOverlayCount > 0,
      'B3_NEWER_SEMANTIC_OVERLAY_EMPTY');
    assert.equal(supersession.oldLegacyPageFocused, false,
      'B3_DEFERRED_LEGACY_OVERRODE_SEMANTIC');
    report.checks.legacySupersession = {
      legacyPageNumber: supersession.legacyPageNumber,
      legacyInitialFocused: false,
      semanticPageNumber: supersession.pageNumber,
      semanticPrecision: supersession.precision,
      semanticReasonCode: supersession.reasonCode,
      semanticOverlayCount: supersession.semanticOverlayCount,
      oldLegacyPageFocused: false
    };

    stage = 'FINAL_DIAGNOSTICS';
    report.diagnostics.workerErrorCount += await page.evaluate(() =>
      Number(globalThis.__b3WorkerErrorCount) || 0);
    assert.equal(report.network.httpRequests, 0, 'B3_NETWORK_REQUEST_DETECTED');
    assert.equal(report.network.apiRequests, 0, 'B3_API_REQUEST_DETECTED');
    assert.equal(report.diagnostics.pageErrorCount, 0, 'B3_PAGE_ERROR');
    assert.equal(report.diagnostics.consoleErrorCount, 0, 'B3_CONSOLE_ERROR');
    assert.equal(report.diagnostics.workerErrorCount, 0, 'B3_WORKER_ERROR');
    report.status = 'PASS';
  } catch (error) {
    report.status = 'FAIL';
    report.failureStage = stage;
    report.failureCode = stableFailureCode(error);
    process.exitCode = 1;
  } finally {
    try { await context?.close(); } catch {}
    removeTemporary(temporaryRoot);
    assertRedactedReport(report);
    fs.mkdirSync(outputDirectory, { recursive: true });
    fs.writeFileSync(path.join(outputDirectory, 'report.json'),
      `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  }
}

if (directInvocation()) await run();
