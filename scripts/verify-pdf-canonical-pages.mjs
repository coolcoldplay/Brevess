import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

const require = createRequire(import.meta.url);
const { createCanonicalPdfPageRecord } = require('../core/pdf-canonical-page.js');
const { canonicalPdfPageToNativePage } = require('../core/pdf-native-document.js');
const { buildPdfSemanticIndex } = require('../core/pdf-semantic-index.js');
const { orderPdfTextContentForReading } = require('../core/pdf-text-projection.js');
const repositoryRoot = path.resolve(import.meta.dirname, '..');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || fallback) : fallback;
}

function safeError(error) {
  const detail = String(error?.stack || error?.message || error);
  return {
    name: String(error?.name || 'Error').slice(0, 80),
    code: String(error?.code || error?.message || 'FAILED')
      .replace(/[A-Za-z]:\\[^\r\n]*/gu, '[local-path]').slice(0, 160),
    detailSha256: sha256(detail), detailBytes: Buffer.byteLength(detail)
  };
}

export function assessCanonicalPageAcceptance(observation = {}, options = {}) {
  const checks = {
    realCorpus: Number(observation.sampleCount) >= 3 && Number(observation.pageAudits) >= 30,
    exactOffsets: Number(observation.offsetErrors) === 0 &&
      Number(observation.overlapErrors) === 0 && Number(observation.boundsErrors) === 0,
    truthfulGeometry: Number(observation.positionedSpans) > 0 &&
      Number(observation.fallbackSpans) >= 0 &&
      Number(observation.rotationsCovered) === 4 &&
      observation.syntheticMixedGeometryPassed === true &&
      observation.syntheticBlankPagePassed === true,
    identityAndAdapter: Number(observation.bindingErrors) === 0 &&
      Number(observation.adapterErrors) === 0,
    stableAndSerializable: observation.stableRecords === true,
    privateAndOffline: Number(observation.apiCalls) === 0 &&
      Number(observation.ocrCalls) === 0 && Number(observation.externalRequests) === 0 &&
      Number(observation.absolutePathLeaks) === 0 && Number(observation.rawTextLeaks) === 0,
    noCacheClaim: observation.persistentCacheUsed === false
  };
  if (options.requireIndependentOracle === true) {
    checks.independentOracle = Number(observation.independentTextAudits) >= 30 &&
      Number(observation.independentTextErrors) === 0 &&
      Number(observation.independentGeometryAudits) >= 30 &&
      Number(observation.independentGeometryErrors) === 0 &&
      Number(observation.structuredCloneAudits) >= 30 &&
      Number(observation.structuredCloneErrors) === 0 &&
      observation.exactRotationCoordinatesPassed === true;
  }
  return { pass: Object.values(checks).every(Boolean), checks };
}

export function summarizeCanonicalPageRecord(record = {}) {
  const coverage = record.coverage || {};
  return {
    pageNumber: Number(record.pageNumber) || 0,
    textBytes: Buffer.byteLength(String(record.text || '')),
    coverage: {
      spanCount: Number(coverage.spanCount) || 0,
      positionedSpanCount: Number(coverage.positionedSpanCount) || 0,
      fallbackSpanCount: Number(coverage.fallbackSpanCount) || 0,
      droppedItemCount: Number(coverage.droppedItemCount) || 0,
      positionedPercent: Number(coverage.positionedPercent) || 0,
      textStatus: coverage.textStatus === 'full' ? 'full' : 'empty'
    },
    contentSummarySha256: sha256(JSON.stringify([
      record.contentHash || '', String(record.text || '').length,
      (record.spans || []).map(span => [span.start, span.end, span.geometryStatus,
        span.fallbackReason || '', span.rect || null])
    ]))
  };
}

function syntheticItem(str, x, y, options = {}) {
  return { str, width: options.width ?? 30, height: options.height ?? 10,
    transform: options.transform || [10, 0, 0, 10, x, y],
    hasEOL: options.hasEOL === true, fontName: 'Synthetic' };
}

function syntheticViewport(rotation) {
  return {
    0: { width: 600, height: 800, transform: [1, 0, 0, -1, 0, 800] },
    90: { width: 800, height: 600, transform: [0, 1, 1, 0, 0, 0] },
    180: { width: 600, height: 800, transform: [-1, 0, 0, 1, 600, 0] },
    270: { width: 800, height: 600, transform: [0, -1, -1, 0, 800, 600] }
  }[rotation];
}

function runSyntheticAcceptance() {
  const documentHash = 'f'.repeat(64);
  const expectedRects = {
    0: { left: 100, top: 90, right: 130, bottom: 100 },
    90: { left: 700, top: 100, right: 710, bottom: 130 },
    180: { left: 470, top: 700, right: 500, bottom: 710 },
    270: { left: 90, top: 470, right: 100, bottom: 500 }
  };
  const rotations = [0, 90, 180, 270].map(rotation => {
    const viewport = syntheticViewport(rotation);
    const record = createCanonicalPdfPageRecord({ documentHash, documentGeneration: 1,
      revision: 1, pageNumber: rotation / 90 + 1,
      page: { view: [0, 0, 600, 800], rotate: rotation },
      viewport: { ...viewport, rotation, scale: 1 },
      textContent: { items: [syntheticItem(`R${rotation}`, 100, 700)] } });
    const rect = record.spans[0].rect;
    return rect && JSON.stringify(rect) === JSON.stringify(expectedRects[rotation]);
  });
  const mixed = createCanonicalPdfPageRecord({ documentHash, documentGeneration: 1,
    revision: 1, pageNumber: 5, page: { view: [0, 0, 600, 800], rotate: 0 },
    viewport: { ...syntheticViewport(0), rotation: 0, scale: 1 },
    textContent: { items: [syntheticItem('Valid', 50, 700),
      syntheticItem('Zero', 50, 680, { width: 0 }),
      syntheticItem('A\u0001B', 50, 660),
      syntheticItem('Bad', 50, 640, { transform: [10, 0, 0, 10, NaN, 640] })] } });
  const blank = createCanonicalPdfPageRecord({ documentHash, documentGeneration: 1,
    revision: 1, pageNumber: 6, page: { view: [0, 0, 600, 800], rotate: 0 },
    viewport: { ...syntheticViewport(0), rotation: 0, scale: 1 },
    textContent: { items: [] } });
  return {
    rotationsCovered: rotations.filter(Boolean).length,
    exactRotationCoordinatesPassed: rotations.every(Boolean),
    mixedGeometryPassed: mixed.coverage.positionedSpanCount === 1 &&
      mixed.coverage.fallbackSpanCount === 3 && mixed.spans.slice(1).every(span =>
        !span.rect && !span.quadPoints && span.geometryPrecision === 'fallback'),
    blankPagePassed: blank.text === '' && blank.coverage.textStatus === 'empty'
  };
}

function independentCanonicalItem(item) {
  if (typeof item?.str !== 'string') return null;
  const hadControl = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(item.str);
  const value = item.str.normalize('NFKC')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, '')
    .replace(/\s+/gu, ' ').trim();
  return value ? { value, hadControl } : null;
}

function independentCanonicalOracle(textContent, page) {
  const sourceItems = Array.isArray(textContent?.items) ? textContent.items : [];
  const ordered = orderPdfTextContentForReading(textContent, page);
  const sourceIndexes = new Map();
  sourceItems.forEach((item, index) => {
    const indexes = sourceIndexes.get(item) || [];
    indexes.push(index);
    sourceIndexes.set(item, indexes);
  });
  const occurrences = new Map();
  const takeSourceIndex = item => {
    const occurrence = occurrences.get(item) || 0;
    occurrences.set(item, occurrence + 1);
    return (sourceIndexes.get(item) || [])[occurrence] ?? -1;
  };
  const entries = [];
  for (const item of ordered?.items || []) {
    const sourceOrder = takeSourceIndex(item);
    const canonical = independentCanonicalItem(item);
    if (!canonical) continue;
    entries.push({ item, sourceOrder, readingOrder: entries.length, ...canonical });
  }
  let text = '';
  const spans = entries.map((entry, index) => {
    const start = text.length;
    text += entry.value;
    const end = text.length;
    if (index < entries.length - 1) text += entry.item.hasEOL ? '\n' : ' ';
    return { text: entry.value, start, end, sourceOrder: entry.sourceOrder,
      readingOrder: entry.readingOrder };
  });
  return { text, spans, entries };
}

function independentItemRect(item, viewport) {
  const width = Number(item?.width);
  const transform = Array.isArray(item?.transform) ? item.transform.map(Number) : [];
  if (!Number.isFinite(width) || width <= 0 || transform.length < 6 ||
      !transform.slice(0, 6).every(Number.isFinite) ||
      typeof viewport?.convertToViewportPoint !== 'function') return null;
  const baselineLength = Math.hypot(transform[0], transform[1]);
  const verticalLength = Math.hypot(transform[2], transform[3]);
  const declaredHeight = Number(item?.height);
  const height = Number.isFinite(declaredHeight) && declaredHeight > 0
    ? declaredHeight : verticalLength;
  const determinant = transform[0] * transform[3] - transform[1] * transform[2];
  if (baselineLength <= 1e-7 || verticalLength <= 1e-7 || height <= 0 ||
      Math.abs(determinant) <= 1e-7) return null;
  const horizontal = [transform[0] / baselineLength, transform[1] / baselineLength];
  const vertical = [transform[2] / verticalLength, transform[3] / verticalLength];
  const corners = [[transform[4], transform[5]],
    [transform[4] + horizontal[0] * width, transform[5] + horizontal[1] * width],
    [transform[4] + vertical[0] * height, transform[5] + vertical[1] * height],
    [transform[4] + horizontal[0] * width + vertical[0] * height,
      transform[5] + horizontal[1] * width + vertical[1] * height]]
    .map(point => viewport.convertToViewportPoint(point[0], point[1]))
    .map(point => ({ x: Number(point[0]), y: Number(point[1]) }));
  if (!corners.every(point => Number.isFinite(point.x) && Number.isFinite(point.y))) return null;
  const rect = { left: Math.min(...corners.map(point => point.x)),
    top: Math.min(...corners.map(point => point.y)),
    right: Math.max(...corners.map(point => point.x)),
    bottom: Math.max(...corners.map(point => point.y)) };
  if (rect.left < -1e-5 || rect.top < -1e-5 || rect.right > viewport.width + 1e-5 ||
      rect.bottom > viewport.height + 1e-5 || rect.right - rect.left <= 1e-5 ||
      rect.bottom - rect.top <= 1e-5) return null;
  return { left: Math.max(0, rect.left), top: Math.max(0, rect.top),
    right: Math.min(viewport.width, rect.right),
    bottom: Math.min(viewport.height, rect.bottom) };
}

function inspectIndependentOracle(record, oracle, viewport) {
  const textMatched = record.text === oracle.text && record.spans.length === oracle.spans.length &&
    oracle.spans.every((expected, index) => {
      const actual = record.spans[index];
      return actual?.text === expected.text && actual.start === expected.start &&
        actual.end === expected.end && actual.rawStart === expected.start &&
        actual.rawEnd === expected.end && actual.sourceOrder === expected.sourceOrder &&
        actual.readingOrder === expected.readingOrder;
    });
  const valid = oracle.entries.map((entry, index) => ({ index,
    rect: entry.hadControl ? null : independentItemRect(entry.item, viewport) }))
    .filter(item => item.rect);
  const selectedIndexes = [...new Set(valid.length ?
    [0, Math.floor((valid.length - 1) / 2), valid.length - 1] : [])];
  let geometryErrors = 0;
  for (const selectedIndex of selectedIndexes) {
    const expected = valid[selectedIndex];
    const actual = record.spans[expected.index]?.rect;
    if (!actual || ['left', 'top', 'right', 'bottom'].some(key =>
      Math.abs(Number(actual[key]) - Number(expected.rect[key])) > 1e-6)) {
      geometryErrors += 1;
    }
  }
  return { textMatched, geometryAudits: selectedIndexes.length, geometryErrors };
}

function inspectRecord(record, expectedBinding) {
  let offsetErrors = 0;
  let overlapErrors = 0;
  let boundsErrors = 0;
  let previousEnd = 0;
  for (const span of record.spans) {
    if (!Number.isInteger(span.start) || !Number.isInteger(span.end) ||
        span.start !== span.rawStart || span.end !== span.rawEnd ||
        record.text.slice(span.start, span.end) !== span.text) offsetErrors += 1;
    if (span.start < previousEnd) overlapErrors += 1;
    previousEnd = Math.max(previousEnd, span.end);
    if (span.start < 0 || span.end <= span.start || span.end > record.text.length) {
      boundsErrors += 1;
    }
    if (span.geometryStatus === 'positioned') {
      const rect = span.rect || {};
      if (span.geometryPrecision !== 'exact-native-item' ||
          ![rect.left, rect.top, rect.right, rect.bottom].every(Number.isFinite) ||
          rect.left < 0 || rect.top < 0 || rect.right <= rect.left ||
          rect.bottom <= rect.top || rect.right > record.pageWidth ||
          rect.bottom > record.pageHeight || span.quadPoints) boundsErrors += 1;
    } else if (span.geometryPrecision !== 'fallback' || span.rect || span.quadPoints) {
      boundsErrors += 1;
    }
  }
  const bindingErrors = JSON.stringify(record.binding) === JSON.stringify(expectedBinding) ? 0 : 1;
  return { offsetErrors, overlapErrors, boundsErrors, bindingErrors };
}

export function canonicalRecordsAcceptedBySemanticIndex(records, documentHash, revision) {
  try {
    const semantic = buildPdfSemanticIndex({ documentHash, revision, pages: records });
    if (!semantic.cacheKey) return false;
    const pages = new Map(records.map(record => [record.pageNumber, record]));
    const ranges = [
      ...semantic.spans.map(item => ({ pageNumber: item.pageNumber,
        start: item.start, end: item.end })),
      ...semantic.headings.map(item => item.range),
      ...semantic.paragraphs.flatMap(item => item.ranges || []),
      ...semantic.sentences.flatMap(item => item.ranges || []),
      ...semantic.sections.flatMap(item => item.ranges || [])
    ];
    if (!ranges.every(range => {
      const page = pages.get(range?.pageNumber);
      return page && Number.isInteger(range.start) && Number.isInteger(range.end) &&
        range.start >= 0 && range.end > range.start && range.end <= page.text.length;
    })) return false;
    return semantic.sentences.every(sentence => (sentence.rawQuoteByPage || []).every(item =>
      pages.get(item.pageNumber)?.text.slice(item.start, item.end) === item.quote));
  } catch {
    return false;
  }
}

export async function runCanonicalPageVerifier(options = {}) {
  const manifestPath = path.resolve(options.manifestPath || argument('--manifest',
    path.join(repositoryRoot, 'tmp', 'pdf-eval-corpus-private-20260911.json')));
  const outputDirectory = path.resolve(options.outputDirectory || argument('--output',
    path.join(repositoryRoot, 'output', 'playwright',
      'pdf-canonical-page-p2b0-20260912-r1')));
  if (fs.existsSync(path.join(outputDirectory, 'report.json'))) {
    const existing = new Error('P2B0_REPORT_ALREADY_EXISTS');
    existing.code = 'P2B0_REPORT_ALREADY_EXISTS';
    throw existing;
  }
  const sampleIds = ['P2-T02', 'P2-T04', 'P2-T08'];
  const report = {
    schemaVersion: 1, status: 'RUNNING',
    scope: 'P2-B0 canonical PDF page records; no reader lifecycle integration',
    contract: {
      factory: 'synchronous pure per-page or bounded batch; structured-cloneable input/output',
      inputOrder: 'source PDF.js textContent by default; reading-order requires pdf-reading-order-v1 contract',
      coordinates: 'scale=1 page viewport CSS pixels with 0/90/180/270 rotation applied',
      nativeGeometryPrecision: 'exact-native-item',
      fallbackGeometryPrecision: 'fallback without rect or quadPoints',
      futureOcrBoundary: 'OCR geometry must use an approximate-ocr precision in a future adapter and is not admitted here',
      legacyIdentity: 'pdf-page-N and pdf:N retained by the explicit native adapter'
    },
    independentOracle: {
      textOracleMethod: 'separate reconstruction from raw PDF.js items after explicit reading-order projection',
      geometryOracleMethod: 'fixed first/middle/last valid items checked with PageViewport.convertToViewportPoint',
      factoryHelpersUsed: false
    },
    privacy: { pathsPersisted: false, rawTextPersisted: false, summaryHashesOnly: true },
    cache: { persistentCacheUsed: false, claim: 'none' },
    network: { externalRequests: 0, apiCalls: 0, ocrCalls: 0 },
    synthetic: runSyntheticAcceptance(), samples: [], pageAudits: [],
    acceptance: {}, error: null
  };
  try {
    const privateManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const selected = sampleIds.map(sampleId => privateManifest.documents.find(item =>
      item.sampleId === sampleId));
    assert.equal(selected.every(Boolean), true, 'P2B0_REAL_SAMPLE_MISSING');
    const canvas = require('@napi-rs/canvas');
    globalThis.DOMMatrix ||= canvas.DOMMatrix;
    globalThis.ImageData ||= canvas.ImageData;
    globalThis.Path2D ||= canvas.Path2D;
    const pdfjs = await import(pathToFileURL(
      require.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href);
    pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
      require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')).href;

    let offsetErrors = 0;
    let overlapErrors = 0;
    let boundsErrors = 0;
    let bindingErrors = 0;
    let adapterErrors = 0;
    let positionedSpans = 0;
    let fallbackSpans = 0;
    let stableRecords = true;
    let independentTextAudits = 0;
    let independentTextErrors = 0;
    let independentGeometryAudits = 0;
    let independentGeometryErrors = 0;
    let structuredCloneAudits = 0;
    let structuredCloneErrors = 0;
    for (const descriptor of selected) {
      const bytes = fs.readFileSync(descriptor.absolutePath);
      assert.equal(sha256(bytes), descriptor.sha256, 'P2B0_SOURCE_HASH_MISMATCH');
      const document = await pdfjs.getDocument({ data: new Uint8Array(bytes),
        disableFontFace: true, useSystemFonts: false }).promise;
      const pageLimit = Math.min(10, document.numPages);
      const records = [];
      const started = performance.now();
      for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
        const page = await document.getPage(pageNumber);
        const viewport = page.getViewport({ scale: 1 });
        const textContent = await page.getTextContent({ includeMarkedContent: true,
          disableNormalization: true });
        const input = { documentHash: descriptor.sha256, documentGeneration: 1,
          revision: 1, pageNumber, page: { view: [...page.view], rotate: page.rotate },
          viewport: { width: viewport.width, height: viewport.height,
            rotation: viewport.rotation, transform: [...viewport.transform], scale: 1 },
          textContent };
        const record = createCanonicalPdfPageRecord(input);
        const repeated = createCanonicalPdfPageRecord(input);
        stableRecords &&= record.contentHash === repeated.contentHash &&
          JSON.stringify(record) === JSON.stringify(repeated);
        const inspection = inspectRecord(record, { documentHash: descriptor.sha256,
          documentGeneration: 1, revision: 1 });
        offsetErrors += inspection.offsetErrors;
        overlapErrors += inspection.overlapErrors;
        boundsErrors += inspection.boundsErrors;
        bindingErrors += inspection.bindingErrors;
        const independent = inspectIndependentOracle(record,
          independentCanonicalOracle(textContent,
            { view: [...page.view], rotate: page.rotate }), viewport);
        independentTextAudits += 1;
        independentTextErrors += independent.textMatched ? 0 : 1;
        independentGeometryAudits += independent.geometryAudits;
        independentGeometryErrors += independent.geometryErrors;
        structuredCloneAudits += 1;
        let structuredCloneMatched = true;
        try {
          const clone = structuredClone(record);
          structuredCloneMatched = JSON.stringify(clone) === JSON.stringify(record);
        } catch { structuredCloneMatched = false; }
        if (!structuredCloneMatched) structuredCloneErrors += 1;
        positionedSpans += record.coverage.positionedSpanCount;
        fallbackSpans += record.coverage.fallbackSpanCount;
        try {
          const nativePage = canonicalPdfPageToNativePage(record);
          if (nativePage.paragraphId !== `pdf-page-${pageNumber}` ||
              nativePage.sourceIdentity !== `pdf:${pageNumber}` ||
              nativePage.canonicalPage !== record) adapterErrors += 1;
        } catch { adapterErrors += 1; }
        records.push(record);
        report.pageAudits.push({ sampleId: descriptor.sampleId,
          ...summarizeCanonicalPageRecord(record),
          independentTextOracleMatched: independent.textMatched,
          independentGeometryAudits: independent.geometryAudits,
          independentGeometryErrors: independent.geometryErrors,
          structuredCloneMatched });
      }
      if (!canonicalRecordsAcceptedBySemanticIndex(records, descriptor.sha256, 1)) {
        adapterErrors += 1;
      }
      const sampleAudits = report.pageAudits.filter(item => item.sampleId === descriptor.sampleId);
      report.samples.push({ sampleId: descriptor.sampleId, sha256: descriptor.sha256,
        bytes: descriptor.fileSizeBytes, pageCount: document.numPages, pagesRead: pageLimit,
        positionedSpanCount: sampleAudits.reduce((sum, item) =>
          sum + item.coverage.positionedSpanCount, 0),
        fallbackSpanCount: sampleAudits.reduce((sum, item) =>
          sum + item.coverage.fallbackSpanCount, 0),
        emptyPageCount: sampleAudits.filter(item => item.coverage.textStatus === 'empty').length,
        elapsedMs: Number((performance.now() - started).toFixed(3)),
        pageSummarySha256: sha256(JSON.stringify(sampleAudits)) });
      await document.destroy();
    }
    const preliminary = {
      sampleCount: report.samples.length, pageAudits: report.pageAudits.length,
      offsetErrors, overlapErrors, boundsErrors, bindingErrors, adapterErrors,
      positionedSpans, fallbackSpans,
      rotationsCovered: report.synthetic.rotationsCovered,
      syntheticMixedGeometryPassed: report.synthetic.mixedGeometryPassed,
      syntheticBlankPagePassed: report.synthetic.blankPagePassed,
      exactRotationCoordinatesPassed: report.synthetic.exactRotationCoordinatesPassed,
      stableRecords,
      independentTextAudits, independentTextErrors,
      independentGeometryAudits, independentGeometryErrors,
      structuredCloneAudits, structuredCloneErrors,
      apiCalls: report.network.apiCalls, ocrCalls: report.network.ocrCalls,
      externalRequests: report.network.externalRequests,
      absolutePathLeaks: 0, rawTextLeaks: 0,
      persistentCacheUsed: report.cache.persistentCacheUsed
    };
    report.acceptance = { observation: preliminary,
      ...assessCanonicalPageAcceptance(preliminary, { requireIndependentOracle: true }) };
    assert.equal(report.acceptance.pass, true, 'P2B0_ACCEPTANCE_FAILED');
    report.status = 'PASS';
  } catch (error) {
    report.status = 'FAIL';
    report.error = safeError(error);
  }
  let serialized = JSON.stringify(report, null, 2);
  const absolutePathLeaks = (serialized.match(/(?:[A-Za-z]:\\|file:\/\/|\\\\[^"\s]+\\|"\/(?:Users|home|tmp)\/)/gu) || []).length;
  const rawTextLeaks = (serialized.match(/"(?:text|rawText|normalizedText|quote|absolutePath|path|title)"\s*:/gu) || []).length;
  if (absolutePathLeaks || rawTextLeaks) {
    report.status = 'FAIL';
    report.error = { name: 'PrivacyError', code: 'P2B0_REPORT_PRIVACY_LEAK',
      detailSha256: sha256(`${absolutePathLeaks}:${rawTextLeaks}`), detailBytes: 3 };
    report.acceptance = { ...report.acceptance, pass: false };
    serialized = JSON.stringify(report, null, 2);
  }
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(path.join(outputDirectory, 'report.json'), `${serialized}\n`, 'utf8');
  return report;
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isCli) {
  const report = await runCanonicalPageVerifier();
  console.log(JSON.stringify({ status: report.status, samples: report.samples,
    acceptance: report.acceptance, network: report.network, error: report.error }));
  if (report.status !== 'PASS') process.exitCode = 1;
}
