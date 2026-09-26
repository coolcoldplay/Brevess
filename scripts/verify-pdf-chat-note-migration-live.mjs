import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { readSecretFromTty } from './probe-deepseek-figure-recovery.mjs';
import {
  dragSelectAcrossNativePdfPages,
  inspectPreparedNativePdfSelectionEvidence
} from './pdf-selection-evidence-helper.mjs';

export const EXPECTED_PDF_SHA256 =
  '6980dbe19945fd36ccd200841d8204a22c75404faedd432db23dbb0a70cef5f1';
export const EXPECTED_PAGE_COUNT = 23;
const recordedSelectionEndpoints = Object.freeze([
  Object.freeze({ pageNumber: 1, offset: 9,
    contentSha256: 'be0061a98fdf8449d0ec5dca15827eea81ea64f1c2a09e57f59a7cff9350de3e',
    geometry: Object.freeze({ left: 39.609375, top: 751.25, width: 166.3707275390625, height: 12 }) }),
  Object.freeze({ pageNumber: 2, offset: 70,
    contentSha256: '4a39e1553cde9a42790abf78425b972c3c1754859a6fb2413f23a79755189995',
    geometry: Object.freeze({ left: 180.328125, top: 96.515625, width: 560.740966796875, height: 12 }) })
]);

export const RECORDED_SELECTION_BASELINES = Object.freeze([
  Object.freeze({ id: 'fixed-02-original-source-order', pdfSha256: EXPECTED_PDF_SHA256,
    projectionSha256: 'cadece04fcb99739161b3284d32c062cc85f7029c11370dc948b53e074da56f0',
    scale: 1.07, rawCharacters: 573, normalizedCharacters: 535,
    rawSha256: '4a8d2de17e4e296fb5096add212b8fc02acadf426e34f51d8891ff0da97551ef',
    normalizedSha256: '9be49dd083cea38d948def406109aa804506893ccc36c33363fc5c5c90659f65',
    endpoints: Object.freeze(recordedSelectionEndpoints.map((point, i) => Object.freeze({ ...point,
      index: i === 0 ? 92 : 20 }))) }),
  // Explicitly approved after real old/current mouse-selection comparison:
  // identical physical endpoints; three source spans moved before the start.
  Object.freeze({ id: 'integrated-reading-order-20260919', pdfSha256: EXPECTED_PDF_SHA256,
    projectionSha256: 'cbc1d5dfa1d798aedc2f1aa1e74fb268a3d32dd84582a752fdb89555567e392c',
    scale: 1.07, rawCharacters: 546, normalizedCharacters: 508,
    rawSha256: '215c62ae5bcc08e5bd4d1b410b64b8061a96bec2022d7f835e86168372d414ea',
    normalizedSha256: 'e114437d9669160cc60efe7ca5beaae612ab05f3e612a4964fefa82b46576b5d',
    endpoints: Object.freeze(recordedSelectionEndpoints.map((point, i) => Object.freeze({ ...point,
      index: i === 0 ? 95 : 20 }))) })
]);

export function recordedSelectionBaseline(pdfSha256, projectionSha256) {
  const baseline = RECORDED_SELECTION_BASELINES.find(item =>
    item.pdfSha256 === pdfSha256 && item.projectionSha256 === projectionSha256);
  assert.ok(baseline, 'B5_RECORDED_SELECTION_BASELINE_UNKNOWN');
  return baseline;
}

export function assertRecordedSelectionEndpoint(observed, expected) {
  for (const key of ['pageNumber', 'index', 'offset', 'contentSha256']) {
    assert.equal(observed?.[key], expected?.[key], `B5_RECORDED_ENDPOINT_${key.toUpperCase()}_MISMATCH`);
  }
  for (const key of ['left', 'top', 'width', 'height']) {
    assert.ok(Number.isFinite(observed?.geometry?.[key]) &&
      Math.abs(observed.geometry[key] - expected.geometry[key]) <= 0.75,
    `B5_RECORDED_ENDPOINT_GEOMETRY_${key.toUpperCase()}_MISMATCH`);
  }
  return true;
}
const DUMMY_SECRET = 'pdf-b5-loopback-fixture-only';
const PROVIDER_ORIGIN = 'https://api.deepseek.com';
const ALLOWED_PROVIDER_PATHS = new Set(['/chat/completions']);
const ROOT = path.resolve(import.meta.dirname, '..');

function codedError(code, cause = null) {
  const error = new Error(code);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function stateIdentityDigest(value) {
  const canonical = item => Array.isArray(item) ? item.map(canonical) :
    item && typeof item === 'object' ? Object.fromEntries(Object.keys(item).sort()
      .map(key => [key, canonical(item[key])])) : item;
  return sha256(JSON.stringify(canonical(value)));
}

export function noteContentIdentityDigest(value) {
  const { updatedAt: _saveTimestamp, ...content } = value || {};
  return stateIdentityDigest(content);
}

export function selectionLocatorIdentityDigest(evidence = null) {
  const segments = Array.isArray(evidence?.segments)
    ? evidence.segments : (evidence ? [evidence] : []);
  return sha256(JSON.stringify(segments.map(segment => ({
    text: String(segment?.text || ''),
    pageNumber: Number(segment?.pageNumber) || 0,
    paragraphId: String(segment?.paragraphId || ''),
    paragraphTextHash: String(segment?.paragraphTextHash || ''),
    semanticLocator: segment?.semanticLocator || null,
    pageAnchor: segment?.pageAnchor || null
  }))));
}

function sha256File(filename) {
  const hash = crypto.createHash('sha256');
  const handle = fs.openSync(filename, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let read;
    while ((read = fs.readSync(handle, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, read));
    }
  } finally { fs.closeSync(handle); }
  return hash.digest('hex');
}

export function normalizeOptions(argv = process.argv.slice(2), overrides = {}) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = String(argv[index] || '');
    if (!item.startsWith('--')) continue;
    const key = item.slice(2).replace(/-([a-z])/gu, (_match, letter) => letter.toUpperCase());
    const next = argv[index + 1];
    if (next !== undefined && !String(next).startsWith('--')) {
      parsed[key] = String(next);
      index += 1;
    } else parsed[key] = true;
  }
  const input = { ...parsed, ...overrides };
  const provider = String(input.provider || 'loopback');
  assert.ok(['loopback', 'deepseek'].includes(provider), 'B5_PROVIDER_MODE_INVALID');
  const maxProviderCalls = Number(input.maxProviderCalls || 5);
  assert.ok(Number.isSafeInteger(maxProviderCalls) && maxProviderCalls >= 1 &&
    maxProviderCalls <= 5, 'B5_PROVIDER_CALL_CAP_INVALID');
  return Object.freeze({
    pdfPath: path.resolve(input.pdf || path.join(ROOT, 'tmp',
      'public-pdf-acceptance', 'elife-83176-v2.pdf')),
    extensionRoot: path.resolve(input.extension || ROOT),
    outputDirectory: path.resolve(input.output || path.join(ROOT, 'output',
      'playwright', 'pdf-chat-note-migration-b5')),
    headed: input.headed === true,
    provider,
    model: String(input.model || 'deepseek-chat'),
    maxProviderCalls
  });
}

export function helpText() {
  return [
    'Usage: node scripts/verify-pdf-chat-note-migration-live.mjs [options]',
    '  --pdf <file>       Default: public 23-page eLife PDF',
    '  --extension <dir>  Unpacked extension source; default: repository root',
    '  --output <dir>     Redacted report directory',
    '  --headed           Show the isolated Edge window',
    '  --provider loopback|deepseek  Default: deterministic local loopback',
    '  --model <model>     DeepSeek model; default: deepseek-chat',
    '  --max-provider-calls <1..5>  In-process hard cap; complete run needs 5',
    '',
    'The default is a deterministic loopback-fixture acceptance with zero real API calls.',
    'DeepSeek mode reads a key from hidden TTY input, keeps it only in the local process',
    'boundary, and records redacted request/response receipts without provider content.'
  ].join('\n');
}

export function stableFailureCode(error) {
  const text = `${String(error?.message || '')} ${String(error?.code || '')} ${String(error || '')}`
    .toUpperCase();
  return text.match(/\bB5_[A-Z0-9_]{3,100}\b/u)?.[0] || 'B5_LIVE_ACCEPTANCE_FAILED';
}

export function assertRedactedReport(report) {
  const forbidden = new Set([
    'apiKey', 'authorization', 'rawText', 'providerBody', 'requestBody',
    'expectedNormalizedQuote', 'quote', 'ranges', 'url', 'signedUrl', 'text'
  ]);
  const visit = value => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (typeof value === 'string') {
      assert.doesNotMatch(value,
        /(?:https?:\/\/|file:|chrome-extension:|Bearer\s+\S+|sk-[A-Za-z0-9_-]{8,})/iu,
      'B5_REPORT_SECRET_OR_LOCATION_LEAK');
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      assert.equal(forbidden.has(key), false, `B5_REPORT_FORBIDDEN_KEY_${key}`);
      visit(child);
    }
  };
  visit(report);
  return true;
}

export function assertAcceptanceEvidence(checks = {}) {
  assert.equal(checks.chat?.savedSemanticLocator, true,
    'B5_CHAT_SEMANTIC_LOCATOR_NOT_SAVED');
  assert.equal(checks.chat?.rawPageAnchorVerified, true,
    'B5_CHAT_PAGE_ANCHOR_NOT_RAW_FIRST_PAGE');
  assert.equal(checks.chat?.continuationPageQuote, true,
    'B5_CHAT_CONTINUATION_PAGE_QUOTE_NOT_PRESERVED');
  assert.equal(checks.chat?.reopened, true, 'B5_CHAT_NOT_REOPENED');
  assert.equal(checks.chat?.sentenceFocusBeforeReopen, true,
    'B5_CHAT_SENTENCE_FOCUS_INITIAL_FAILED');
  assert.equal(checks.chat?.sentenceFocusAfterReopen, true,
    'B5_CHAT_SENTENCE_FOCUS_REOPEN_FAILED');
  assert.equal(checks.selection?.semanticLocatorSaved, true,
    'B5_SELECTION_SEMANTIC_LOCATOR_NOT_SAVED');
  assert.equal(checks.selection?.globalQuoteSpanVerified, true,
    'B5_SELECTION_GLOBAL_QUOTE_SPAN_INVALID');
  assert.equal(checks.selection?.rawPageAnchorVerified, true,
    'B5_SELECTION_PAGE_ANCHOR_NOT_RAW_FIRST_PAGE');
  assert.equal(checks.selection?.reopened, true, 'B5_SELECTION_NOT_REOPENED');
  assert.equal(checks.selection?.regenerated, true, 'B5_SELECTION_NOT_REGENERATED');
  assert.equal(checks.selection?.regeneratedIdentityPreserved, true,
    'B5_SELECTION_REGENERATED_LOCATOR_IDENTITY_CHANGED');
  assert.equal(checks.selection?.citationFocusBeforeReopen, true,
    'B5_SELECTION_CITATION_FOCUS_INITIAL_FAILED');
  assert.equal(checks.selection?.citationFocusAfterReopen, true,
    'B5_SELECTION_CITATION_FOCUS_REOPEN_FAILED');
  assert.equal(checks.selection?.citationFocusAfterRegenerate, true,
    'B5_SELECTION_CITATION_FOCUS_REGENERATED_FAILED');
  assert.equal(checks.duplicate?.locatorDisambiguated, true,
    'B5_DUPLICATE_LOCATOR_DID_NOT_DISAMBIGUATE');
  assert.equal(checks.duplicate?.quoteOnlyAmbiguous, true,
    'B5_DUPLICATE_QUOTE_DID_NOT_FAIL_CLOSED');
  assert.equal(checks.duplicate?.ambiguousScrollCount, 0,
    'B5_DUPLICATE_AMBIGUOUS_SCROLLED');
  assert.equal(checks.revision?.rebound, true, 'B5_REVISION_REBOUND_NOT_RECORDED');
  assert.equal(checks.revision?.duplicateRejected, true, 'B5_REVISION_DUPLICATE_NOT_REJECTED');
  assert.equal(checks.revision?.duplicateScrollCount, 0, 'B5_REVISION_DUPLICATE_SCROLLED');
  assert.equal(checks.replacement?.stale, true, 'B5_REPLACEMENT_NOT_STALE');
  assert.equal(checks.replacement?.scrollCount, 0, 'B5_REPLACEMENT_STALE_SCROLLED');
  assert.equal(checks.legacy?.usable, true, 'B5_LEGACY_PAGE_ANCHOR_UNUSABLE');
  assert.equal(checks.legacy?.pageLevelDegraded, true,
    'B5_LEGACY_PAGE_ANCHOR_NOT_DEGRADED');
  assert.equal(checks.note?.wholeTableEvidenceSaved, true,
    'B5_NOTE_TABLE_EVIDENCE_NOT_SAVED');
  assert.equal(checks.note?.singleFieldEvidenceSaved, true,
    'B5_NOTE_FIELD_EVIDENCE_NOT_SAVED');
  assert.equal(checks.note?.otherFieldsUnchanged, true,
    'B5_NOTE_FIELD_UPDATE_CHANGED_SIBLINGS');
  assert.equal(checks.note?.persistedContentIdentical, true,
    'B5_NOTE_SAVED_CONTENT_MISMATCH');
  assert.equal(checks.note?.reopenedIdentical, true, 'B5_NOTE_REOPEN_MISMATCH');
  assert.equal(checks.legacyNote?.visible, true, 'B5_NOTE_V2_VALUE_NOT_VISIBLE');
  assert.equal(checks.legacyNote?.historicalSourceLabel, true,
    'B5_NOTE_V2_SOURCE_LABEL_MISSING');
  return true;
}

export function assertExactCitationFocusEvidence(evidence = {},
  code = 'B5_CITATION_FOCUS_NOT_EXACT') {
  assert.equal(evidence.resolved, true, `${code}_UNRESOLVED`);
  assert.ok(Number(evidence.expectedRangeCount) > 0, `${code}_RANGES_EMPTY`);
  assert.equal(Number(evidence.quoteMatchCount), Number(evidence.expectedRangeCount),
    `${code}_RAW_QUOTE_MISMATCH`);
  assert.deepEqual(evidence.overlayPageNumbers, evidence.expectedPageNumbers,
    `${code}_PAGE_MISMATCH`);
  assert.ok(Number(evidence.expectedRectCount) > 0, `${code}_EXPECTED_RECTS_EMPTY`);
  assert.equal(Number(evidence.overlayRectCount), Number(evidence.expectedRectCount),
    `${code}_RECT_COUNT_MISMATCH`);
  assert.equal(evidence.geometryMatches, true, `${code}_GEOMETRY_MISMATCH`);
  return true;
}

export function normalizedCitationLocatorIdentity(evidence = null) {
  const verification = evidence?.verification && typeof evidence.verification === 'object'
    ? evidence.verification : null;
  const locator = evidence?.locator && typeof evidence.locator === 'object'
    ? evidence.locator
    : evidence?.semanticLocator && typeof evidence.semanticLocator === 'object'
      ? evidence.semanticLocator
      : verification?.locator && typeof verification.locator === 'object'
        ? verification.locator
        : evidence?.locatorKind === 'pdf-semantic' ? evidence : null;
  const rawAnchor = evidence?.pageAnchor || verification?.pageAnchor || locator?.pageAnchor;
  return Object.freeze({
    locatorKind: String(locator?.locatorKind || ''),
    documentId: String(locator?.documentId || ''),
    documentHash: String(locator?.documentHash || ''),
    documentGeneration: Number(locator?.documentGeneration) || 0,
    revision: Number(locator?.revision) || 0,
    semanticCacheKey: String(locator?.semanticCacheKey || ''),
    semanticProvenanceKey: String(locator?.semanticProvenanceKey || ''),
    paragraphId: String(locator?.paragraphId || ''),
    normalizedStart: Number.isSafeInteger(Number(locator?.normalizedStart))
      ? Number(locator.normalizedStart) : -1,
    normalizedEnd: Number.isSafeInteger(Number(locator?.normalizedEnd))
      ? Number(locator.normalizedEnd) : -1,
    quote: String(locator?.expectedNormalizedQuote || locator?.quote || ''),
    pageAnchor: Object.freeze({
      paragraphId: String(rawAnchor?.paragraphId || ''),
      pageNumber: Number(rawAnchor?.pageNumber) || 0
    })
  });
}

export function assertCitationLocatorIdentity(expectedEvidence, capturedEvidence,
  code = 'B5_CITATION_UI_LOCATOR_IDENTITY_MISMATCH', { allowMissingPageAnchor = false } = {}) {
  const expected = normalizedCitationLocatorIdentity(expectedEvidence);
  const captured = normalizedCitationLocatorIdentity(capturedEvidence);
  for (const [field, value] of Object.entries(expected)) {
    if (field === 'pageAnchor') continue;
    assert.notEqual(value, field === 'normalizedStart' || field === 'normalizedEnd' ? -1 : '',
      `${code}_EXPECTED_${field.toUpperCase()}_MISSING`);
  }
  assert.equal(expected.locatorKind, 'pdf-semantic', `${code}_EXPECTED_KIND_INVALID`);
  assert.ok(expected.documentGeneration > 0 && expected.revision > 0,
    `${code}_EXPECTED_VERSION_MISSING`);
  assert.ok(expected.normalizedStart >= 0 && expected.normalizedEnd > expected.normalizedStart,
    `${code}_EXPECTED_SPAN_INVALID`);
  assert.ok(expected.pageAnchor.pageNumber > 0 && expected.pageAnchor.paragraphId,
    `${code}_EXPECTED_PAGE_ANCHOR_MISSING`);
  const anchorProvided = [capturedEvidence?.pageAnchor,
    capturedEvidence?.verification?.pageAnchor, capturedEvidence?.locator?.pageAnchor,
    capturedEvidence?.semanticLocator?.pageAnchor].some(value => value != null);
  const compared = allowMissingPageAnchor && !anchorProvided
    ? { ...captured, pageAnchor: expected.pageAnchor } : captured;
  try { assert.deepEqual(compared, expected, code); }
  catch (error) {
    error.locatorIdentityDifference = Object.keys(expected).filter(field =>
      JSON.stringify(expected[field]) !== JSON.stringify(compared[field]));
    throw error;
  }
  return true;
}

async function inspectExactCitationFocus(page, locator,
  code = 'B5_CITATION_FOCUS_NOT_EXACT') {
  await page.waitForFunction(candidate => {
    const resolved = globalThis.__brevessNativePdfDocument
      ?.resolveSemanticHighlight?.(candidate);
    const expectedPages = [...new Set((resolved?.ranges || [])
      .map(range => Number(range?.pageNumber)).filter(Boolean))].sort((a, b) => a - b);
    const overlayPages = [...new Set([...document.querySelectorAll(
      '.pdf-native-semantic-focus-layer .pdf-native-semantic-focus-hit')]
      .map(hit => Number(hit.closest('.pdf-native-page')?.dataset?.pdfPageNumber))
      .filter(Boolean))].sort((a, b) => a - b);
    return resolved?.status === 'resolved' && expectedPages.length > 0 &&
      expectedPages.length === overlayPages.length &&
      expectedPages.every((value, index) => value === overlayPages[index]);
  }, locator, { timeout: 30_000 });
  const evidence = await page.evaluate(async candidate => {
    const digest = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256',
      new TextEncoder().encode(String(value || ''))))].map(byte => byte.toString(16).padStart(2, '0')).join('');
    const native = globalThis.__brevessNativePdfDocument;
    const resolved = native?.resolveSemanticHighlight?.(candidate);
    const ranges = Array.isArray(resolved?.ranges) ? resolved.ranges : [];
    const expectedPages = [...new Set(ranges.map(range => Number(range?.pageNumber))
      .filter(Boolean))].sort((left, right) => left - right);
    const overlayPages = [...new Set([...document.querySelectorAll(
      '.pdf-native-semantic-focus-layer .pdf-native-semantic-focus-hit')]
      .map(hit => Number(hit.closest('.pdf-native-page')?.dataset?.pdfPageNumber))
      .filter(Boolean))].sort((left, right) => left - right);
    const expectedRects = [];
    const rangeDetails = [];
    let quoteMatchCount = 0;
    for (const range of ranges) {
      const pageNode = document.querySelector(
        `.pdf-native-page[data-pdf-page-number="${range.pageNumber}"]`);
      const textLayer = pageNode?.querySelector('.pdf-native-text-layer');
      const projection = textLayer
        ? globalThis.SciLLM.readPdfTextProjection?.(textLayer, { mode: 'raw-offset' })
        : null;
      if (projection?.text?.slice(range.start, range.end) === range.quote) {
        quoteMatchCount += 1;
      }
      const domRange = projection
        ? globalThis.SciLLM.pdfProjectionRange?.(projection, range, document) : null;
      const pageRect = pageNode?.getBoundingClientRect();
      const rects = domRange && pageRect
        ? globalThis.SciLLM.pdfProjectionRects?.(domRange, pageRect) || [] : [];
      rangeDetails.push({ pageNumber: Number(range.pageNumber), start: range.start, end: range.end,
        quoteCharacters: String(range.quote || '').length, quoteSha256: await digest(range.quote),
        rawSliceSha256: await digest(projection?.text?.slice(range.start, range.end)),
        domRangeCharacters: String(domRange || '').length,
        domRangeSha256: await digest(String(domRange || '')), rectCount: rects.length,
        startSpanIndex: domRange ? [...textLayer.querySelectorAll('span')].indexOf(
          domRange.startContainer.parentElement?.closest('span')) : -1,
        endSpanIndex: domRange ? [...textLayer.querySelectorAll('span')].indexOf(
          domRange.endContainer.parentElement?.closest('span')) : -1 });
      for (const rect of rects) expectedRects.push({
        pageNumber: Number(range.pageNumber), ...rect
      });
    }
    const overlayRects = [...document.querySelectorAll(
      '.pdf-native-semantic-focus-layer .pdf-native-semantic-focus-hit')].map(hit => ({
      pageNumber: Number(hit.closest('.pdf-native-page')?.dataset?.pdfPageNumber) || 0,
      left: Number.parseFloat(hit.style.left), top: Number.parseFloat(hit.style.top),
      width: Number.parseFloat(hit.style.width), height: Number.parseFloat(hit.style.height)
    }));
    const near = (left, right) => Math.abs(Number(left) - Number(right)) <= 0.75;
    const remaining = [...overlayRects];
    const geometryMatches = expectedRects.every(expected => {
      const index = remaining.findIndex(actual => actual.pageNumber === expected.pageNumber &&
        near(actual.left, expected.left) && near(actual.top, expected.top) &&
        near(actual.width, expected.width) && near(actual.height, expected.height));
      if (index < 0) return false;
      remaining.splice(index, 1);
      return true;
    }) && remaining.length === 0;
    return {
      resolved: resolved?.status === 'resolved',
      expectedRangeCount: ranges.length,
      quoteMatchCount,
      expectedPageNumbers: expectedPages,
      overlayPageNumbers: overlayPages,
      expectedRectCount: expectedRects.length,
      overlayRectCount: overlayRects.length,
      geometryMatches,
      locatorDiagnostic: { paragraphId: candidate.paragraphId, revision: candidate.revision,
        documentGeneration: candidate.documentGeneration, normalizedStart: candidate.normalizedStart,
        normalizedEnd: candidate.normalizedEnd,
        quoteSha256: await digest(candidate.expectedNormalizedQuote || candidate.quote) },
      rangeDetails, expectedRects, overlayRects
    };
  }, locator);
  try { assertExactCitationFocusEvidence(evidence, code); }
  catch (error) { error.focusEvidence = evidence; throw error; }
  return Object.freeze(evidence);
}

async function armCitationFocusCapture(panel) {
  await panel.evaluate(() => {
    globalThis.__b5LastCitationFocusTarget = null;
    globalThis.__b5LastCitationFocusResponse = null;
    if (globalThis.__b5CitationFocusCaptureInstalled === true) return;
    const original = sendTabMessage;
    sendTabMessage = async (...args) => {
      const message = args?.[1];
      const isCitation = message?.action === 'focusArticleWorkspaceSource' &&
          message?.target?.kind === 'article-chat-citation';
      if (isCitation) {
        globalThis.__b5LastCitationFocusTarget = structuredClone(message.target);
      }
      const response = await original(...args);
      if (isCitation) globalThis.__b5LastCitationFocusResponse = structuredClone(response);
      return response;
    };
    globalThis.__b5CitationFocusCaptureInstalled = true;
  });
}

async function clickAndInspectCitation(panel, reader, button, expectedEvidence,
  code = 'B5_CITATION_FOCUS_NOT_EXACT') {
  await armCitationFocusCapture(panel);
  await reader.evaluate(() => document.querySelectorAll(
    '.pdf-native-semantic-focus-layer').forEach(layer => layer.remove()));
  await button.click();
  await panel.waitForFunction(() => Boolean(
    globalThis.__b5LastCitationFocusTarget?.evidence &&
    globalThis.__b5LastCitationFocusResponse), null, { timeout: 30_000 });
  const target = await panel.evaluate(() =>
    structuredClone(globalThis.__b5LastCitationFocusTarget));
  assert.equal(target?.kind, 'article-chat-citation', `${code}_UI_TARGET_MISSING`);
  const allowMissingPageAnchor = await reader.evaluate(paragraphId => {
    const pending = [...(globalThis.__brevessNativePdfDocument
      ?.getSemanticNavigation?.()?.sections || [])];
    while (pending.length) {
      const section = pending.shift();
      pending.push(...(section.children || []));
      const paragraph = (section.paragraphTargets || []).find(item =>
        item.paragraphId === paragraphId);
      if (paragraph) return paragraph.pageNumbers?.length > 1;
    }
    return false;
  }, normalizedCitationLocatorIdentity(expectedEvidence).paragraphId);
  assertCitationLocatorIdentity(expectedEvidence, target?.evidence,
    `${code}_UI_LOCATOR_IDENTITY_MISMATCH`, { allowMissingPageAnchor });
  const locator = target?.evidence?.locator || target?.evidence;
  assert.equal(locator?.locatorKind, 'pdf-semantic', `${code}_UI_LOCATOR_MISSING`);
  const exactFocus = await inspectExactCitationFocus(reader, locator, code);
  const response = await panel.evaluate(() => globalThis.__b5LastCitationFocusResponse);
  assert.equal(response?.success, true, `${code}_UI_RESPONSE_FAILED`);
  assert.equal(response?.focused, true, `${code}_NATIVE_FOCUS_FAILED`);
  const nativeResult = response.citationResult;
  assert.equal(nativeResult?.focused, true, `${code}_NATIVE_RESULT_MISSING`);
  assert.equal(Number(nativeResult?.pageNumber), exactFocus.expectedPageNumbers[0],
    `${code}_NATIVE_PAGE_MISMATCH`);
  return Object.freeze({ ...exactFocus, nativeResponsePageNumber: Number(nativeResult.pageNumber),
    nativeResponsePrecision: String(nativeResult.precision || ''),
    owningParagraphSpansPages: allowMissingPageAnchor,
    uiFallbackPageAnchorOmitted: target?.evidence?.pageAnchor == null });
}

function writeReport(filename, report) {
  assertRedactedReport(report);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: 'utf8', mode: 0o600
  });
  fs.renameSync(temporary, filename);
}

function copyExtension(source, destination, proxyUrl) {
  fs.mkdirSync(destination, { recursive: true });
  for (const directory of ['core', 'providers', 'vendor', 'icons', '_locales']) {
    const from = path.join(source, directory);
    if (fs.existsSync(from)) fs.cpSync(from, path.join(destination, directory), {
      recursive: true
    });
  }
  for (const file of fs.readdirSync(source)) {
    if (/\.(?:js|mjs|html|css)$/u.test(file) || file === 'manifest.json') {
      fs.copyFileSync(path.join(source, file), path.join(destination, file));
    }
  }
  const worker = path.join(destination, 'offscreen-network-worker.js');
  const boundary = `const b5NativeFetch = globalThis.fetch.bind(globalThis);\n` +
    `globalThis.fetch = (url, options = {}) => {\n` +
    `  const parsed = new URL(String(url));\n` +
    `  if (parsed.origin !== ${JSON.stringify(PROVIDER_ORIGIN)} || ` +
    `parsed.pathname !== '/chat/completions') throw new Error('B5_REMOTE_FETCH_BLOCKED');\n` +
    `  return b5NativeFetch(${JSON.stringify(proxyUrl)} + parsed.pathname, options);\n` +
    `};\n`;
  fs.writeFileSync(worker, boundary + fs.readFileSync(worker, 'utf8'));
}

function removeTemporary(target) {
  const temporaryRoot = path.resolve(os.tmpdir());
  const resolved = path.resolve(target);
  if (resolved.startsWith(`${temporaryRoot}${path.sep}`) &&
      path.basename(resolved).startsWith('brevess-pdf-b5-')) {
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}

async function readBody(stream, maximum = 16 * 1024 * 1024) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of stream) {
    bytes += chunk.length;
    if (bytes > maximum) throw codedError('B5_FIXTURE_REQUEST_TOO_LARGE');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function messageText(message) {
  if (typeof message?.content === 'string') return message.content;
  if (!Array.isArray(message?.content)) return '';
  return message.content.map(item => typeof item === 'string' ? item : item?.text || '').join('\n');
}

function parseChatContext(body) {
  const user = messageText(body?.messages?.findLast(item => item?.role === 'user'));
  const start = user.indexOf('ARTICLE_CONTEXT\n');
  const end = user.indexOf('\nCHAT_REQUEST\n', start + 1);
  if (start < 0 || end < 0) throw codedError('B5_FIXTURE_CHAT_CONTEXT_MISSING');
  return JSON.parse(user.slice(start + 'ARTICLE_CONTEXT\n'.length, end));
}

function parseChatRequest(body) {
  const user = messageText(body?.messages?.findLast(item => item?.role === 'user'));
  const marker = '\nCHAT_REQUEST\n';
  const start = user.indexOf(marker);
  if (start < 0) throw codedError('B5_FIXTURE_CHAT_REQUEST_MISSING');
  return JSON.parse(user.slice(start + marker.length));
}

function cleanFixtureQuote(value, maximum = 220) {
  const compact = String(value || '').normalize('NFKC').replace(/\s+/gu, ' ').trim();
  if (!compact) return '';
  const sentence = compact.match(/^.{24,220}?[.!?](?:\s|$)/u)?.[0] || compact.slice(0, maximum);
  return sentence.trim();
}

export function chatFixture(body) {
  const context = parseChatContext(body);
  const request = parseChatRequest(body);
  const selectedSources = Array.isArray(request?.selected_citation_sources)
    ? request.selected_citation_sources : [];
  if (selectedSources.length) {
    const handles = selectedSources.map(item => String(item?.id || ''))
      .filter(id => /^S\d+$/u.test(id));
    if (handles.length !== selectedSources.length) {
      throw codedError('B5_FIXTURE_SELECTED_SOURCE_HANDLE_MISSING');
    }
    const records = [
      { type: 'answer_block', block_id: `b5-selection-${handles.length}`,
        markdown: `确定性选中文段回答。${handles.map(id => `[[${id}]]`).join('')}`,
        evidence: [] },
      { type: 'turn_summary', summary: '确定性 PDF 选中文段引用验收。' },
      { type: 'final', status: 'completed' }
    ];
    return records.map(item => JSON.stringify(item)).join('\n');
  }
  const chunks = context?.article?.chunks || [];
  const requestedQuote = String(request?.current_question || '')
    .match(/^B5_CONTINUATION_QUOTE\s+([\s\S]+)$/u)?.[1]?.trim() || '';
  let chunk = requestedQuote
    ? chunks.find(item => String(item?.text || '').includes(requestedQuote)) : null;
  if (requestedQuote && !chunk) {
    throw codedError('B5_FIXTURE_REQUESTED_QUOTE_NOT_IN_CONTEXT');
  }
  if (!chunk) {
    chunk = chunks.find(item => item?.sourceSpans?.length && String(item.text || '').trim());
  }
  const units = String(chunk?.text || '').split('\n\n');
  const unitIndex = requestedQuote
    ? units.findIndex(unit => unit.includes(requestedQuote)) : 0;
  const span = chunk?.sourceSpans?.[unitIndex >= 0 ? unitIndex : 0];
  if (!chunk || !span) throw codedError('B5_FIXTURE_CHAT_SOURCE_MISSING');
  const quote = requestedQuote || cleanFixtureQuote(units[unitIndex >= 0 ? unitIndex : 0]);
  if (!quote) throw codedError('B5_FIXTURE_CHAT_QUOTE_MISSING');
  const sectionPath = (Array.isArray(chunk.headingPath) ? chunk.headingPath : [])
    .map(item => String(item?.title || '')).filter(Boolean);
  const records = [
    { type: 'answer_block', block_id: 'b5-block-1',
      markdown: '确定性本地验收回答已绑定到论文中的指定句子。[[1]]',
      evidence: [{ marker: '1', paragraph_id: String(span.paragraphId || ''),
        source_key: String(span.sourceKey || span.paragraphId || ''),
        text_hash: String(span.textHash || ''), quote, section_path: sectionPath }] },
    { type: 'turn_summary', summary: '确定性 PDF 语义引用验收。' },
    { type: 'final', status: 'completed' }
  ];
  return records.map(item => JSON.stringify(item)).join('\n');
}

function noteFixture(body, sequence) {
  const user = messageText(body?.messages?.findLast(item => item?.role === 'user'));
  const marker = '\nLITERATURE_NOTE_REQUEST:\n';
  const split = user.lastIndexOf(marker);
  if (split < 0) throw codedError('B5_FIXTURE_NOTE_REQUEST_MISSING');
  const request = JSON.parse(user.slice(split + marker.length));
  const stable = user.slice(0, split).split('\n').slice(4);
  const records = stable.map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(item => item?.paragraphId && item?.text);
  const record = records[0];
  const fields = request?.template?.fields || [];
  if (!record || !fields.length) throw codedError('B5_FIXTURE_NOTE_SOURCE_MISSING');
  const values = {};
  const statuses = {};
  const sources = {};
  for (const field of fields) {
    values[field.id] = `${fields.length === 1 ? 'B5单字段' : 'B5整表'}-${field.id}-${sequence}`;
    statuses[field.id] = 'supported';
    sources[field.id] = [record.paragraphId];
  }
  return { values, statuses, sources };
}

function sseReply(content, model = 'deepseek-chat') {
  const first = { id: 'b5-fixture', model,
    choices: [{ index: 0, delta: { content }, finish_reason: null }] };
  const last = { id: 'b5-fixture', model,
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    usage: { prompt_tokens: 200, completion_tokens: 80, total_tokens: 280 } };
  return `data: ${JSON.stringify(first)}\n\ndata: ${JSON.stringify(last)}\n\ndata: [DONE]\n\n`;
}

async function startFixtureServer(report) {
  const state = { calls: 0, streamCalls: 0, jsonCalls: 0, errors: 0,
    rejectedByCap: false };
  const server = http.createServer(async (request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Headers', 'authorization,content-type');
    if (request.method === 'OPTIONS') {
      response.writeHead(204); response.end(); return;
    }
    try {
      assert.equal(request.method, 'POST', 'B5_FIXTURE_METHOD_REJECTED');
      assert.equal(ALLOWED_PROVIDER_PATHS.has(request.url), true,
        'B5_FIXTURE_PATH_REJECTED');
      assert.equal(request.headers.authorization, `Bearer ${DUMMY_SECRET}`,
        'B5_FIXTURE_AUTH_REJECTED');
      const bytes = await readBody(request);
      const body = JSON.parse(bytes.toString('utf8'));
      const sequence = ++state.calls;
      report.network.fixtureCalls = state.calls;
      report.network.requestDigests.push({ sequence, streaming: body.stream === true,
        bytes: bytes.length, sha256: sha256(bytes) });
      if (body.stream === true) {
        state.streamCalls += 1;
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        response.end(sseReply(chatFixture(body), String(body.model || 'deepseek-chat')));
      } else {
        state.jsonCalls += 1;
        const fixture = noteFixture(body, state.jsonCalls);
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ id: 'b5-fixture', model: body.model,
          choices: [{ index: 0, message: { role: 'assistant',
            content: JSON.stringify(fixture) }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 200, completion_tokens: 80, total_tokens: 280 } }));
      }
    } catch (error) {
      state.errors += 1;
      response.writeHead(500, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { code: stableFailureCode(error) } }));
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return { server, state, url: `http://127.0.0.1:${server.address().port}` };
}

async function startDeepSeekBoundary(report, secret, model, maxProviderCalls) {
  const state = { calls: 0, streamCalls: 0, jsonCalls: 0, errors: 0,
    responses: [], rejectedByCap: false };
  const server = http.createServer((request, response) => {
    void (async () => {
      response.setHeader('Access-Control-Allow-Origin', '*');
      response.setHeader('Access-Control-Allow-Headers', 'authorization,content-type');
      if (request.method === 'OPTIONS') {
        response.writeHead(204); response.end(); return;
      }
      assert.equal(request.method, 'POST', 'B5_PROVIDER_METHOD_REJECTED');
      assert.equal(ALLOWED_PROVIDER_PATHS.has(request.url), true,
        'B5_PROVIDER_PATH_REJECTED');
      assert.equal(request.headers.authorization, `Bearer ${DUMMY_SECRET}`,
        'B5_PROVIDER_DUMMY_AUTH_REJECTED');
      const bytes = await readBody(request);
      const body = JSON.parse(bytes.toString('utf8'));
      if (state.calls >= maxProviderCalls) {
        state.rejectedByCap = true;
        response.writeHead(429, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: { code: 'B5_PROVIDER_CALL_CAP_EXCEEDED' } }));
        return;
      }
      const sequence = ++state.calls;
      if (body.stream === true) state.streamCalls += 1;
      else state.jsonCalls += 1;
      report.execution.realApiCalls = state.calls;
      report.network.providerCalls = state.calls;
      report.network.requestDigests.push({ sequence, streaming: body.stream === true,
        bytes: bytes.length, sha256: sha256(bytes) });
      const startedAt = Date.now();
      const upstream = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${secret}` },
        body: JSON.stringify({ ...body, model }),
        signal: AbortSignal.timeout(180_000)
      });
      const responseBytes = Buffer.from(await upstream.arrayBuffer());
      if (responseBytes.length > 8 * 1024 * 1024) {
        throw codedError('B5_PROVIDER_RESPONSE_TOO_LARGE');
      }
      let usage = {};
      if (body.stream !== true) {
        try { usage = JSON.parse(responseBytes.toString('utf8'))?.usage || {}; } catch {}
      }
      state.responses.push({ sequence, status: upstream.status,
        elapsedMs: Date.now() - startedAt, bytes: responseBytes.length,
        usage: { promptTokens: Number(usage.prompt_tokens) || 0,
          completionTokens: Number(usage.completion_tokens) || 0,
          totalTokens: Number(usage.total_tokens) || 0 } });
      report.network.providerResponses = state.responses;
      response.writeHead(upstream.status, {
        'content-type': upstream.headers.get('content-type') || 'application/json'
      });
      response.end(responseBytes);
    })().catch(error => {
      state.errors += 1;
      if (!response.headersSent) {
        response.writeHead(502, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: { code: stableFailureCode(error) } }));
      } else response.destroy();
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return { server, state, url: `http://127.0.0.1:${server.address().port}` };
}

async function activeTabId(reader) {
  const tabId = await reader.evaluate(async () =>
    Number((await chrome.tabs.getCurrent())?.id) || 0);
  if (!Number.isSafeInteger(tabId) || tabId < 1) throw codedError('B5_READER_TAB_MISSING');
  return tabId;
}

async function tabMessage(worker, tabId, payload) {
  return worker.evaluate(async ({ tabId: id, payload: message }) => {
    try { return await chrome.tabs.sendMessage(id, message); }
    catch (error) { return { success: false, error: String(error?.message || error) }; }
  }, { tabId, payload });
}

async function bindPanel(panel, worker, reader, readerTabId) {
  try {
    await worker.evaluate(id => chrome.tabs.update(id, { active: true }), readerTabId);
    await reader.bringToFront();
  } catch (error) { throw codedError('B5_PANEL_TARGET_ACTIVATION_FAILED', error); }
  try {
    await panel.waitForFunction(() => typeof panelUiReady !== 'undefined' &&
      panelUiReady === true, null, { timeout: 30_000 });
  } catch (error) { throw codedError('B5_PANEL_UI_NOT_READY', error); }
  try {
    await panel.evaluate(async () => {
      await synchronizeActiveTabContext({ force: true });
      if (!activePanelTabContext?.activated) {
        await activateCurrentTabFromSidePanel();
        await synchronizeActiveTabContext({ force: true });
      }
      await refreshArticleWorkspace({ announce: false, throwOnError: true });
    });
  } catch (error) { throw codedError('B5_PANEL_WORKSPACE_BIND_FAILED', error); }
}

async function openPanel(context, extensionId, worker, reader, readerTabId, diagnostics) {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 560, height: 920 });
  panel.on('pageerror', () => { diagnostics.pageErrors += 1; });
  panel.on('console', message => {
    if (message.type() === 'error') diagnostics.consoleErrors += 1;
  });
  try {
    await panel.goto(`chrome-extension://${extensionId}/popup.html`, {
      waitUntil: 'domcontentloaded'
    });
  } catch (error) { throw codedError('B5_PANEL_PAGE_OPEN_FAILED', error); }
  await bindPanel(panel, worker, reader, readerTabId);
  return panel;
}

async function setupProfile(panel, model = 'deepseek-chat') {
  return panel.evaluate(async ({ dummy, selectedModel }) => {
    const profileId = 'profile_pdf_b5_fixture';
    for (const message of [
      { type: 'LLM_SAVE_PROFILE', profile: { id: profileId,
        name: 'PDF B5 deterministic fixture', providerId: 'deepseek',
        capabilities: { vision: false }, config: { apiKey: dummy,
          model: selectedModel, maxOutputTokens: 4096,
          reasoningEnabled: false, reasoningEffort: 'auto' } } },
      { type: 'LLM_UPDATE_PROFILE_ROUTING', globalProfileId: profileId, taskRoutes: {} },
      { type: 'LLM_UPDATE_PREFERENCES', preferences: {
        mode: 'llm', consentGranted: true } }
    ]) {
      const response = await chrome.runtime.sendMessage(message);
      if (response?.success !== true) throw new Error('B5_PROFILE_SETUP_FAILED');
    }
    await loadLlmSettings();
    renderArticleChatProfileOptions();
    renderLiteratureNoteModelStatus();
    await refreshArticleWorkspace({ announce: false, throwOnError: true });
    return { profileId, ready: llmSettingsState?.llmReady === true,
      mode: String(llmSettingsState?.effectiveMode || '') };
  }, { dummy: DUMMY_SECRET, selectedModel: model });
}

async function collectPanelFailureDiagnostics(panel) {
  if (!panel || panel.isClosed()) return null;
  try {
    return await panel.evaluate(() => {
      const allowedStatuses = new Set([
        'queued', 'generating', 'completed', 'truncated', 'incomplete',
        'cancelled', 'interrupted', 'error', 'unanswered'
      ]);
      const safeCode = value => {
        const token = String(value || '').trim().toUpperCase();
        if (!token) return '';
        return /^[A-Z][A-Z0-9_]{2,100}$/u.test(token) ? token : 'NON_CODE_ERROR';
      };
      const turns = Array.isArray(currentWorkspaceSnapshot?.chat?.turns)
        ? currentWorkspaceSnapshot.chat.turns : [];
      const latest = turns.at(-1) || null;
      const selected = String(document.getElementById('articleChatProfile')?.value || '');
      const configured = llmSettingsState?.settings?.profiles || {};
      const globalProfileId = String(llmSettingsState?.settings?.globalProfileId || '');
      const citationButtons = [...document.querySelectorAll(
        '.article-chat-inline-citation')];
      return {
        llmReady: llmSettingsState?.llmReady === true,
        effectiveModeLlm: llmSettingsState?.effectiveMode === 'llm',
        consentGranted: llmSettingsState?.settings?.consentGranted === true,
        fixtureProfileConfigured: Boolean(configured.profile_pdf_b5_fixture),
        fixtureProfileSelected: selected === 'profile_pdf_b5_fixture',
        fixtureProfileGlobal: globalProfileId === 'profile_pdf_b5_fixture',
        sendDisabled: document.getElementById('sendArticleChat')?.disabled === true,
        submitPending: articleChatSubmitPending === true,
        chatLoading: currentWorkspaceSnapshot?.chat?.loading === true,
        turnCount: turns.length,
        latestTurnStatus: allowedStatuses.has(String(latest?.status || ''))
          ? String(latest.status) : '',
        latestTurnErrorCode: safeCode(latest?.errorCode || latest?.code || latest?.error),
        activeTurnPresent: Boolean(currentWorkspaceSnapshot?.chat?.activeTurnId),
        paragraphCount: Array.isArray(currentWorkspaceSnapshot?.paragraphs)
          ? currentWorkspaceSnapshot.paragraphs.length : 0,
        semanticNavigationReady: Boolean(currentPdfSemanticNavigation?.sections?.length),
        citationButtons: citationButtons.length,
        citationStates: citationButtons.reduce((counts, button) => {
          const state = String(button.dataset.verificationStatus || 'unset');
          counts[state] = (counts[state] || 0) + 1;
          return counts;
        }, {}),
        chatDispatch: globalThis.__b5ChatDispatch || null
      };
    });
  } catch (_) {
    return { unavailable: true };
  }
}

async function run(options = {}) {
  const config = options?.pdfPath ? Object.freeze({ ...options }) : normalizeOptions([], options);
  if (options.help) return { help: helpText() };
  const reportFile = path.join(config.outputDirectory, 'report.json');
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-pdf-b5-'));
  const extensionDir = path.join(tempRoot, 'extension');
  const profileDir = path.join(tempRoot, 'profile');
  const report = {
    schemaVersion: 1, status: 'RUNNING',
    acceptance: 'P2-B5 PDF chat and literature-note migration live acceptance',
    execution: { realBrowser: true, browser: 'msedge', isolatedProfile: true,
      isolatedExtension: true, providerMode: config.provider,
      deterministicFixture: config.provider === 'loopback', realApiCalls: 0,
      providerModel: config.model, providerCallCap: config.maxProviderCalls,
      fixedSavedAnswer: false, scientificAnswerQualityEvaluated: false,
      nativeIndexTimingFixture: true, coldStartPerformanceEvaluated: false },
    source: {}, network: { externalHttpRequests: 0, fixtureCalls: 0,
      providerCalls: 0, requestDigests: [], providerResponses: [], fixtureErrors: 0 },
    diagnostics: { pageErrors: 0, consoleErrors: 0, workerErrors: 0 },
    screenshots: [],
    checks: {}, failureStage: '', failureCode: ''
  };
  let stage = 'SOURCE';
  let context = null;
  let fixture = null;
  let panel = null;
  let reader = null;
  let selectionBaseline = null;
  const persist = () => writeReport(reportFile, report);
  const capture = async (page, name) => {
    if (!page || page.isClosed()) return;
    const filename = `${name}.png`;
    await page.screenshot({ path: path.join(config.outputDirectory, filename),
      fullPage: false, animations: 'disabled' });
    report.screenshots.push({ filename,
      sha256: sha256File(path.join(config.outputDirectory, filename)) });
    persist();
  };
  persist();
  try {
    assert.ok(fs.existsSync(config.pdfPath), 'B5_PUBLIC_PDF_MISSING');
    assert.equal(sha256File(config.pdfPath), EXPECTED_PDF_SHA256,
      'B5_PUBLIC_PDF_HASH_MISMATCH');
    report.source = { pdfSha256: EXPECTED_PDF_SHA256, pageCount: EXPECTED_PAGE_COUNT,
      contentSha256: sha256File(path.join(config.extensionRoot, 'content.js')),
      popupSha256: sha256File(path.join(config.extensionRoot, 'popup.js')),
      readerSha256: sha256File(path.join(config.extensionRoot, 'pdf-native-reader.mjs')) };
    report.source.projectionSha256 = sha256File(path.join(config.extensionRoot, 'core/pdf-text-projection.js'));
    selectionBaseline = recordedSelectionBaseline(report.source.pdfSha256, report.source.projectionSha256);
    report.execution.selectionBaselineVersion = selectionBaseline.id;
    if (config.provider === 'deepseek') {
      const secret = await readSecretFromTty({ prompt: 'DeepSeek API key: ' });
      fixture = await startDeepSeekBoundary(report, secret, config.model,
        config.maxProviderCalls);
    } else fixture = await startFixtureServer(report);
    copyExtension(config.extensionRoot, extensionDir, fixture.url);
    fs.mkdirSync(config.outputDirectory, { recursive: true });

    stage = 'BROWSER_LAUNCH';
    context = await chromium.launchPersistentContext(profileDir, {
      channel: 'msedge', headless: !config.headed, reducedMotion: 'reduce',
      viewport: { width: 1320, height: 960 },
      args: [`--disable-extensions-except=${extensionDir}`,
        `--load-extension=${extensionDir}`]
    });
    await context.route(/^https?:\/\//u, route => {
      if (route.request().url().startsWith(`${fixture.url}/`)) return route.continue();
      report.network.externalHttpRequests += 1;
      return route.abort('blockedbyclient');
    });
    const worker = context.serviceWorkers()[0] ||
      await context.waitForEvent('serviceworker', { timeout: 15_000 });
    worker.on('console', message => {
      if (message.type() === 'error') report.diagnostics.workerErrors += 1;
    });
    const extensionId = new URL(worker.url()).host;
    stage = 'READER_OPEN';
    reader = await context.newPage();
    reader.on('pageerror', () => { report.diagnostics.pageErrors += 1; });
    reader.on('console', message => {
      if (message.type() === 'error') report.diagnostics.consoleErrors += 1;
    });
    await reader.goto(`chrome-extension://${extensionId}/pdf-reader.html`, {
      waitUntil: 'domcontentloaded'
    });
    stage = 'READER_TAB_ID';
    const readerTabId = await activeTabId(reader);
    stage = 'PDF_LOAD';
    await reader.evaluate(() => {
      globalThis.__b5PublishedNavigations = [];
      globalThis.__b5DelayedIndexTasks = 0;
      const createQueue = globalThis.SciLLM.createPdfNativeTaskQueue;
      globalThis.SciLLM.createPdfNativeTaskQueue = options => {
        const queue = createQueue(options);
        return Object.freeze({ ...queue, schedule(task, scheduleOptions) {
          return queue.schedule(async input => {
            if (/^index-/u.test(String(scheduleOptions?.key || '')) &&
                globalThis.__b5PublishedNavigations.length === 0) {
              globalThis.__b5DelayedIndexTasks += 1;
              // Deterministically expose the real first-page worker publication
              // before remaining source pages arrive. All task results, worker
              // output, source bytes and reader ownership stay production-owned.
              await new Promise(resolve => {
                const done = () => {
                  if (!globalThis.__b5PublishedNavigations.length) return;
                  clearTimeout(timer);
                  document.removeEventListener('brevess:pdf-semantic-ready', done);
                  resolve();
                };
                const timer = setTimeout(() => {
                  document.removeEventListener('brevess:pdf-semantic-ready', done);
                  resolve();
                }, 5000);
                document.addEventListener('brevess:pdf-semantic-ready', done);
              });
            }
            return task(input);
          }, scheduleOptions);
        } });
      };
      document.addEventListener('brevess:pdf-semantic-ready', () => {
        const navigation = globalThis.__brevessNativePdfDocument?.getSemanticNavigation?.();
        const snapshots = globalThis.__b5PublishedNavigations;
        if (navigation?.sections?.length && !snapshots.some(item =>
          item.documentGeneration === navigation.documentGeneration &&
          item.revision === navigation.revision)) {
          snapshots.push(structuredClone(navigation));
        }
      });
    });
    await reader.locator('#pdfLocalFile').setInputFiles(config.pdfPath);
    stage = 'SEMANTIC_READY';
    await reader.waitForFunction(({ hash, pages }) => {
      const native = globalThis.__brevessNativePdfDocument;
      const semantic = globalThis.__brevessPdfSemanticDocument;
      return native?.phase === 'text-ready' && native?.structure?.documentHash === hash &&
        native?.pageCount === pages && semantic?.phase === 'text-ready' &&
        semantic?.indexedPageCount === pages &&
        native?.getSemanticNavigation?.()?.sections?.length > 0;
    }, { hash: EXPECTED_PDF_SHA256, pages: EXPECTED_PAGE_COUNT }, { timeout: 120_000 });
    await reader.locator('#pdfReaderStudy').click();
    stage = 'PANEL_OPEN';
    panel = await openPanel(context, extensionId, worker, reader, readerTabId,
      report.diagnostics);
    const profile = await setupProfile(panel, config.model);
    assert.equal(profile.ready, true, 'B5_PROFILE_NOT_READY');

    stage = 'CHAT_VIEW';
    await panel.evaluate(() => switchWorkspaceView('chat'));
    stage = 'CHAT_READY';
    await panel.waitForFunction(() => document.getElementById('sendArticleChat')?.disabled === false,
      null, { timeout: 30_000 });
    const priorTurns = await panel.evaluate(() =>
      (currentWorkspaceSnapshot?.chat?.turns || []).map(item => String(item.turnId || '')));
    const continuationSample = await reader.evaluate(() => {
      const native = globalThis.__brevessNativePdfDocument;
      const navigation = native?.getSemanticNavigation?.();
      const diagnostics = { targets: 0, resolved: 0, rangeCount: 0,
        continuationRanges: 0, exactContinuationRanges: 0,
        sufficientlyLongContinuationRanges: 0, rawQuoteInNormalizedText: 0,
        exactSubquotesResolved: 0, resolutionStates: {}, subquoteStates: {},
        subquoteReasons: {}, subquoteFirstPageMatchesTarget: 0,
        normalizedStartTypes: {} };
      globalThis.__b5ContinuationDiagnostics = diagnostics;
      const targets = [];
      const pending = Array.isArray(navigation?.sections) ? [...navigation.sections] : [];
      while (pending.length) {
        const section = pending.shift();
        targets.push(...(Array.isArray(section?.paragraphTargets)
          ? section.paragraphTargets : []));
        pending.push(...(Array.isArray(section?.children) ? section.children : []));
      }
      diagnostics.targets = targets.length;
      for (const target of targets) {
        const text = String(target?.expectedNormalizedQuote || '');
        const resolved = native?.resolveSemanticHighlight?.({
          locatorKind: 'pdf-semantic',
          documentId: navigation.documentId,
          documentHash: navigation.documentHash,
          documentGeneration: navigation.documentGeneration,
          revision: navigation.revision,
          semanticCacheKey: navigation.semanticCacheKey,
          semanticProvenanceKey: navigation.semanticProvenanceKey,
          paragraphId: target.paragraphId,
          normalizedStart: target.normalizedStart,
          normalizedEnd: target.normalizedEnd,
          expectedNormalizedQuote: text
        });
        const status = String(resolved?.status || 'missing');
        diagnostics.resolutionStates[status] =
          (diagnostics.resolutionStates[status] || 0) + 1;
        if (status === 'resolved') diagnostics.resolved += 1;
        diagnostics.rangeCount += (resolved?.ranges || []).length;
        const continuations = (resolved?.ranges || []).filter(range =>
          Number(range?.pageNumber) !== Number(target?.pageNumber));
        diagnostics.continuationRanges += continuations.length;
        diagnostics.exactContinuationRanges += continuations.filter(range =>
          range?.precision === 'exact-raw').length;
        const continuation = (resolved?.ranges || []).find(range =>
          Number(range?.pageNumber) !== Number(target?.pageNumber) &&
          range?.precision === 'exact-raw' && String(range?.quote || '').length >= 48);
        if (!continuation) continue;
        diagnostics.sufficientlyLongContinuationRanges += 1;
        const rawQuote = String(continuation.quote || '');
        const localStart = text.indexOf(rawQuote);
        if (localStart < 0) continue;
        diagnostics.rawQuoteInNormalizedText += 1;
        // The production citation verifier rejects prefixes cut inside a word.
        const quote = rawQuote.match(/^[\s\S]{32,180}(?=\s|$)/u)?.[0]?.trim() || '';
        const quoteStart = text.indexOf(quote, localStart);
        if (quoteStart < 0 || quote.length < 32) continue;
        const exact = native.resolveSemanticHighlight({
          locatorKind: 'pdf-semantic',
          documentId: navigation.documentId,
          documentHash: navigation.documentHash,
          documentGeneration: navigation.documentGeneration,
          revision: navigation.revision,
          semanticCacheKey: navigation.semanticCacheKey,
          semanticProvenanceKey: navigation.semanticProvenanceKey,
          paragraphId: target.paragraphId,
          normalizedStart: target.normalizedStart + quoteStart,
          normalizedEnd: target.normalizedStart + quoteStart + quote.length,
          expectedNormalizedQuote: quote
        });
        const subStatus = String(exact?.status || 'missing');
        const subReason = String(exact?.reasonCode || 'none');
        const startType = typeof target.normalizedStart;
        diagnostics.normalizedStartTypes[startType] =
          (diagnostics.normalizedStartTypes[startType] || 0) + 1;
        diagnostics.subquoteStates[subStatus] =
          (diagnostics.subquoteStates[subStatus] || 0) + 1;
        diagnostics.subquoteReasons[subReason] =
          (diagnostics.subquoteReasons[subReason] || 0) + 1;
        if (Number(exact?.ranges?.[0]?.pageNumber) === Number(target.pageNumber)) {
          diagnostics.subquoteFirstPageMatchesTarget += 1;
        }
        if (exact?.status !== 'resolved' || !exact.ranges?.length ||
            Number(exact.ranges[0].pageNumber) === Number(target.pageNumber)) continue;
        diagnostics.exactSubquotesResolved += 1;
        return { quote, paragraphId: target.paragraphId,
          targetPageNumber: Number(target.pageNumber) || 0,
          rawPageNumber: Number(exact.ranges[0].pageNumber) || 0 };
      }
      return null;
    });
    report.diagnostics.continuationSample = await reader.evaluate(() =>
      globalThis.__b5ContinuationDiagnostics);
    persist();
    assert.ok(continuationSample, 'B5_CONTINUATION_PAGE_QUOTE_UNAVAILABLE');
    await panel.evaluate(() => {
      const original = sendTabMessage;
      const safeCode = value => {
        const token = String(value || '').trim().toUpperCase();
        if (!token) return '';
        return /^[A-Z][A-Z0-9_]{2,100}$/u.test(token) ? token : 'NON_CODE_ERROR';
      };
      const safeErrorClass = value => {
        const message = String(value || '').toLowerCase();
        if (!message) return '';
        if (/receiving end|establish connection|message port/u.test(message)) {
          return 'MESSAGE_RECEIVER_MISSING';
        }
        if (/revoked|proxy/u.test(message)) return 'PROXY_ACCESS_ERROR';
        if (/structured clone|could not be cloned/u.test(message)) return 'CLONE_ERROR';
        if (/is not defined/u.test(message)) return 'UNDEFINED_SYMBOL';
        if (/not a function/u.test(message)) return 'NOT_A_FUNCTION';
        if (/cannot read|undefined|null/u.test(message)) return 'PROPERTY_ACCESS_ERROR';
        if (/scope|section|paragraph/u.test(message)) return 'SCOPE_OR_PARAGRAPH_ERROR';
        if (/context invalidated/u.test(message)) return 'EXTENSION_CONTEXT_INVALIDATED';
        return 'UNCLASSIFIED_ERROR';
      };
      sendTabMessage = async (...args) => {
        const action = String(args?.[1]?.action || '');
        try {
          const response = await original(...args);
          if (action === 'askArticleWithLLM') {
            globalThis.__b5ChatDispatch = {
              returned: true,
              success: response?.success === true,
              code: safeCode(response?.code || response?.error?.code || response?.error),
              errorClass: safeErrorClass(response?.error?.message || response?.error),
              hasTurn: Boolean(response?.turn?.turnId),
              turnStatus: ['queued', 'generating', 'completed', 'error']
                .includes(String(response?.turn?.status || ''))
                ? String(response.turn.status) : ''
            };
          }
          return response;
        } catch (error) {
          if (action === 'askArticleWithLLM') {
            globalThis.__b5ChatDispatch = {
              returned: false, success: false,
              code: safeCode(error?.code || error?.message),
              errorClass: safeErrorClass(error?.message),
              hasTurn: false, turnStatus: ''
            };
          }
          throw error;
        }
      };
    });
    stage = 'CHAT_SUBMIT';
    await panel.locator('#articleChatQuestion').fill(
      `B5_CONTINUATION_QUOTE\n${continuationSample.quote}`);
    await panel.locator('#sendArticleChat').click();
    await panel.waitForFunction(() => Boolean(globalThis.__b5ChatDispatch), null,
      { timeout: 30_000 });
    const chatDispatch = await panel.evaluate(() => globalThis.__b5ChatDispatch);
    report.checks.chatDispatch = chatDispatch;
    assert.equal(chatDispatch?.returned, true, 'B5_CHAT_DISPATCH_THROWN');
    assert.equal(chatDispatch?.success, true, 'B5_CHAT_DISPATCH_REJECTED');
    assert.equal(chatDispatch?.hasTurn, true, 'B5_CHAT_DISPATCH_TURN_MISSING');
    stage = 'CHAT_COMPLETE';
    await panel.waitForFunction(known => {
      const prior = new Set(known);
      return (currentWorkspaceSnapshot?.chat?.turns || []).some(turn =>
        !prior.has(String(turn.turnId || '')) && turn.status === 'completed' &&
        (turn.answerBlocks || []).some(block => (block.evidence || []).length));
    }, priorTurns, { timeout: 90_000 });
    stage = 'CHAT_LOCATOR';
    const chat = await panel.evaluate(({ known, continuation }) => {
      const prior = new Set(known);
      const turn = (currentWorkspaceSnapshot?.chat?.turns || []).findLast(item =>
        !prior.has(String(item.turnId || '')) && item.status === 'completed');
      const evidence = turn?.answerBlocks?.flatMap(block => block.evidence || [])[0];
      const citationButtons = [...document.querySelectorAll(
        '.article-chat-inline-citation')];
      const targets = [];
      const pendingSections = Array.isArray(currentPdfSemanticNavigation?.sections)
        ? [...currentPdfSemanticNavigation.sections] : [];
      while (pendingSections.length) {
        const section = pendingSections.shift();
        targets.push(...(Array.isArray(section?.paragraphTargets)
          ? section.paragraphTargets : []));
        pendingSections.push(...(Array.isArray(section?.children) ? section.children : []));
      }
      const uniqueTargets = [...new Map(targets.map(target => [
        String(target?.paragraphId || ''), target
      ])).values()];
      const orderedRanges = uniqueTargets.map(target => ({
        start: Number(target?.normalizedStart), end: Number(target?.normalizedEnd)
      })).sort((left, right) => left.start - right.start || left.end - right.end);
      const target = uniqueTargets.find(candidate =>
        candidate?.paragraphId === evidence?.paragraphId);
      const relativeStart = Number(evidence?.normalizedStart) -
        Number(target?.normalizedStart);
      const relativeEnd = Number(evidence?.normalizedEnd) - Number(target?.normalizedStart);
      return { turnId: String(turn?.turnId || ''), evidence: evidence || null,
        targetPageNumber: Number(target?.pageNumber) || 0,
        savedSemanticLocator: evidence?.locatorKind === 'pdf-semantic' &&
          !String(evidence?.paragraphId || '').startsWith('pdf-page-') &&
          Number.isSafeInteger(evidence?.normalizedStart) &&
          Number.isSafeInteger(evidence?.normalizedEnd) &&
          Boolean(evidence?.semanticCacheKey && evidence?.semanticProvenanceKey),
        citationCount: document.querySelectorAll(
          '.article-chat-inline-citation.is-verified').length,
        citationButtons: citationButtons.length,
        citationStates: citationButtons.reduce((counts, button) => {
          const state = String(button.dataset.verificationStatus || 'unset');
          counts[state] = (counts[state] || 0) + 1;
          return counts;
        }, {}),
        semanticNavigationReady: Boolean(currentPdfSemanticNavigation?.sections?.length),
        locatorShape: {
          targetFound: Boolean(target),
          spanLength: Number(evidence?.normalizedEnd) - Number(evidence?.normalizedStart),
          quoteLength: String(evidence?.expectedNormalizedQuote || '').length,
          quoteMatchesTarget: Boolean(target && relativeStart >= 0 &&
            relativeEnd > relativeStart && String(target.expectedNormalizedQuote || '')
              .slice(relativeStart, relativeEnd) === evidence?.expectedNormalizedQuote),
          documentIdMatches: evidence?.documentId === currentPdfSemanticNavigation?.documentId,
          documentHashMatches: evidence?.documentHash === currentPdfSemanticNavigation?.documentHash,
          generationMatches: evidence?.documentGeneration ===
            currentPdfSemanticNavigation?.documentGeneration,
          revisionMatches: evidence?.revision === currentPdfSemanticNavigation?.revision,
          cacheKeyMatches: evidence?.semanticCacheKey ===
            currentPdfSemanticNavigation?.semanticCacheKey,
          provenanceKeyMatches: evidence?.semanticProvenanceKey ===
            currentPdfSemanticNavigation?.semanticProvenanceKey
        },
        semanticContextShape: {
          uniqueParagraphs: uniqueTargets.length,
          paragraphLengthMismatches: uniqueTargets.filter(target =>
            Number(target?.normalizedEnd) - Number(target?.normalizedStart) !==
              String(target?.expectedNormalizedQuote || '').length).length,
          overlappingRanges: orderedRanges.slice(1).filter((range, index) =>
            range.start < orderedRanges[index].end).length
        } };
    }, { known: priorTurns, continuation: continuationSample });
    // The native PDF document belongs to the reader realm, never the popup realm.
    const rawLocatorShape = await reader.evaluate(({ evidence, continuation, targetPage }) => {
      const rawResolution = evidence?.locatorKind === 'pdf-semantic'
        ? globalThis.__brevessNativePdfDocument?.resolveSemanticHighlight?.(evidence) : null;
      const firstRawPage = Number(rawResolution?.ranges?.[0]?.pageNumber) || 0;
      return {
        pageAnchorMatchesRaw: rawResolution?.status === 'resolved' && firstRawPage > 0 &&
          Number(evidence?.pageAnchor?.pageNumber) === firstRawPage &&
          String(evidence?.pageAnchor?.paragraphId || '') === `pdf-page-${firstRawPage}`,
        continuationPageQuote: evidence?.paragraphId === continuation.paragraphId &&
          evidence?.expectedNormalizedQuote === continuation.quote &&
          firstRawPage === continuation.rawPageNumber && firstRawPage !== targetPage
      };
    }, { evidence: chat.evidence, continuation: continuationSample,
      targetPage: chat.targetPageNumber });
    Object.assign(chat.locatorShape, rawLocatorShape);
    report.checks.chatObserved = { turnPresent: Boolean(chat.turnId),
      evidencePresent: Boolean(chat.evidence),
      savedSemanticLocator: chat.savedSemanticLocator,
      citationCount: chat.citationCount,
      citationButtons: chat.citationButtons,
      citationStates: chat.citationStates,
      semanticNavigationReady: chat.semanticNavigationReady,
      locatorShape: chat.locatorShape,
      semanticContextShape: chat.semanticContextShape };
    persist();
    assert.equal(chat.savedSemanticLocator, true, 'B5_CHAT_SEMANTIC_LOCATOR_NOT_SAVED');
    assert.equal(chat.locatorShape.pageAnchorMatchesRaw, true,
      'B5_CHAT_PAGE_ANCHOR_NOT_RAW_FIRST_PAGE');
    assert.equal(chat.locatorShape.continuationPageQuote, true,
      'B5_CHAT_CONTINUATION_PAGE_QUOTE_NOT_PRESERVED');
    assert.ok(chat.citationCount > 0, 'B5_CHAT_CITATION_UI_MISSING');
    const chatTurnSelector = `.article-chat-turn[data-turn-id="${chat.turnId}"]`;
    const firstFocus = await clickAndInspectCitation(panel, reader, panel.locator(
      `${chatTurnSelector} .article-chat-inline-citation.is-verified`).first(),
    chat.evidence, 'B5_CHAT_INITIAL_CITATION');
    await capture(panel, '01-chat-answer');
    await capture(reader, '02-chat-exact-citation');

    stage = 'CHAT_REOPEN';
    await panel.close();
    panel = await openPanel(context, extensionId, worker, reader, readerTabId,
      report.diagnostics);
    await panel.evaluate(() => switchWorkspaceView('chat'));
    await panel.waitForFunction(id =>
      (currentWorkspaceSnapshot?.chat?.turns || []).some(turn => turn.turnId === id) &&
      document.querySelector('.article-chat-inline-citation.is-verified'),
    chat.turnId, { timeout: 30_000 });
    const reopenedFocus = await clickAndInspectCitation(panel, reader, panel.locator(
      `${chatTurnSelector} .article-chat-inline-citation.is-verified`).first(),
    chat.evidence, 'B5_CHAT_REOPEN_CITATION');
    await capture(panel, '03-chat-reopened');
    report.checks.chat = { savedSemanticLocator: chat.savedSemanticLocator,
      rawPageAnchorVerified: chat.locatorShape.pageAnchorMatchesRaw,
      continuationPageQuote: chat.locatorShape.continuationPageQuote, reopened: true,
      sentenceFocusBeforeReopen: firstFocus.geometryMatches,
      sentenceFocusAfterReopen: reopenedFocus.geometryMatches,
      exactFocusBeforeReopen: firstFocus, exactFocusAfterReopen: reopenedFocus };

    try {
    stage = 'SELECTION_GESTURE';
    await reader.bringToFront();
    // Expose the lower-page prose during sampling so the helper can exclude
    // citation-link overlays using its real elementFromPoint hit test.
    for (let step = 0; step < 12; step += 1) {
      const scale = await reader.evaluate(() => Number(
        globalThis.__brevessPdfReaderBridge.command('getState').scale));
      if (scale <= 1.1) break;
      await reader.locator('#pdfReaderZoomOut').click();
    }
    report.diagnostics.selectionScale = await reader.evaluate(() => Number(
      globalThis.__brevessPdfReaderBridge.command('getState').scale));
    assert.equal(report.diagnostics.selectionScale, selectionBaseline.scale,
      'B5_RECORDED_SELECTION_SCALE_CHANGED');
    await reader.evaluate(() => {
      globalThis.__b5AnchorDiagnostics = [];
      document.addEventListener('brevess:pdf-selection-anchor-request', event => {
        const layer = event.target?.closest?.('.pdf-native-text-layer');
        const pageNumber = Number(layer?.dataset?.pdfPageNumber) || 0;
        const projection = globalThis.__brevessPdfReaderBridge.command('getPageProjection', pageNumber);
        const pageRect = projection?.pageElement?.getBoundingClientRect();
        const viewport = projection?.viewport;
        const detail = event.detail || {};
        const rects = Array.isArray(detail.clientRects) ? detail.clientRects : [];
        const relative = pageRect ? rects.map(rect => ({
          left: rect.left - pageRect.left, top: rect.top - pageRect.top,
          right: rect.right - pageRect.left, bottom: rect.bottom - pageRect.top
        })) : [];
        let anchorCode = 'PROJECTION_UNAVAILABLE';
        if (projection) {
          try {
            globalThis.SciLLM.createPdfSelectionAnchor({ ...detail, pageNumber,
              pageRect, viewport });
            anchorCode = 'VALID';
          } catch (error) {
            const code = String(error?.code || error?.message || '');
            anchorCode = /^[A-Z][A-Z0-9_]{2,100}$/u.test(code) ? code : 'NON_CODE_ERROR';
          }
        }
        const row = { pageNumber, clientRectCount: rects.length,
          projectionPresent: Boolean(projection), layerMatches: projection?.textLayer === layer,
          pageWidth: Number(pageRect?.width) || 0, pageHeight: Number(pageRect?.height) || 0,
          viewportWidth: Number(viewport?.width) || 0, viewportHeight: Number(viewport?.height) || 0,
          quoteCharacters: String(detail.quote || '').length,
          prefixCharacters: String(detail.prefix || '').length,
          suffixCharacters: String(detail.suffix || '').length,
          contextHashPresent: Boolean(detail.contextHash),
          requestHashMatchesManual: detail.documentHash === currentManualDocument?.record?.documentHash,
          requestHashMatchesNative: detail.documentHash === globalThis.__brevessNativePdfDocument?.structure?.documentHash,
          requestGenerationMatchesNative: detail.documentGeneration === globalThis.__brevessNativePdfDocument?.documentGeneration,
          anchorCode,
          relativeBounds: relative.length ? { left: Math.min(...relative.map(r => r.left)),
            top: Math.min(...relative.map(r => r.top)), right: Math.max(...relative.map(r => r.right)),
            bottom: Math.max(...relative.map(r => r.bottom)) } : null,
          maximumOverflow: relative.length && viewport ? Math.max(0, ...relative.flatMap(r =>
            [-r.left, -r.top, r.right - viewport.width, r.bottom - viewport.height])) : 0 };
        globalThis.__b5AnchorDiagnostics.push(row);
        if (globalThis.__b5AnchorDiagnostics.length > 12) globalThis.__b5AnchorDiagnostics.shift();
      });
    });
    const measuredReader = new Proxy(reader, {
      get(target, property) {
        if (property === 'locator') return selector => {
          const locator = target.locator(selector);
          const match = /^\.pdf-native-page\[data-pdf-page-number="([12])"\] \.pdf-native-text-layer span$/u
            .exec(selector);
          if (!match) return locator;
          // Pin the recorded failed gesture. A detached collapsed Range only
          // measures a caret; the helper still creates the selection with real
          // mouse-down, wheel, move and mouse-up events.
          const pageNumber = Number(match[1]);
          const pinned = selectionBaseline.endpoints.find(point => point.pageNumber === pageNumber);
          return new Proxy(locator, { get(spanLocator, method) {
            if (method === 'evaluateAll') return async () => {
              const selected = await spanLocator.evaluateAll((nodes, point) => {
              const span = nodes[point.index];
              const node = span?.firstChild;
              if (!node || node.nodeType !== Node.TEXT_NODE || node.textContent.length < point.offset) {
                throw new Error('B5_RECORDED_SELECTION_ENDPOINT_MISSING');
              }
              const caret = document.createRange();
              caret.setStart(node, point.offset); caret.collapse(true);
              const bounds = span.getBoundingClientRect(), position = caret.getBoundingClientRect();
              const pageBounds = span.closest('.pdf-native-page').getBoundingClientRect();
              return { index: point.index, hitFraction: (position.left + 0.1 - bounds.left) / bounds.width,
                content: node.textContent, offset: point.offset, spanCount: nodes.length,
                spanBounds: bounds.toJSON(), caretBounds: position.toJSON(),
                geometry: { left: bounds.left - pageBounds.left, top: bounds.top - pageBounds.top,
                  width: bounds.width, height: bounds.height },
                pointerEvents: getComputedStyle(span).pointerEvents };
              }, pinned);
              report.diagnostics.selectionPinnedEndpoints ||= [];
              const { content, ...details } = selected;
              const observed = { pageNumber, ...details,
                contentCharacters: content.length, contentSha256: sha256(content) };
              report.diagnostics.selectionPinnedEndpoints.push(observed);
              assertRecordedSelectionEndpoint(observed, pinned);
              return { index: selected.index, hitFraction: selected.hitFraction };
            };
            const member = Reflect.get(spanLocator, method);
            return typeof member === 'function' ? member.bind(spanLocator) : member;
          } });
        };
        if (property === 'evaluate') return async (fn, argument) => {
          const value = await target.evaluate(fn, argument);
          if (typeof value?.textSpan === 'boolean' && Number.isFinite(argument?.x) &&
              Number.isFinite(argument?.y)) {
            report.diagnostics.selectionHitTests ||= [];
            report.diagnostics.selectionHitTests.push({ ...value, ...argument });
          }
          if (value?.rangeCount === 1 && typeof value.text === 'string' &&
              Number.isFinite(value.startPage) && Number.isFinite(value.endPage)) {
            report.diagnostics.selectionGestureObserved = {
              characterCount: value.text.length, textSha256: sha256(value.text),
              startPage: value.startPage, endPage: value.endPage, pageRects: value.pageRects,
              endpoints: await target.evaluate(() => {
                const range = document.getSelection().getRangeAt(0);
                const endpoint = (node, offset) => {
                  const span = (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement)
                    ?.closest('.pdf-native-text-layer span');
                  const layer = span?.closest('.pdf-native-text-layer');
                  return { pageNumber: Number(layer?.dataset?.pdfPageNumber) || 0,
                    spanIndex: layer ? [...layer.querySelectorAll('span')].indexOf(span) : -1,
                    offset, nodeType: node.nodeType };
                };
                return { start: endpoint(range.startContainer, range.startOffset),
                  end: endpoint(range.endContainer, range.endOffset) };
              })
            };
          }
          if (typeof value?.textSpan === 'boolean' && value.textSpan === false &&
              Number.isFinite(argument?.x) && Number.isFinite(argument?.y)) {
            report.diagnostics.selectionHitTest = await target.evaluate(position => ({
              point: position,
              elements: document.elementsFromPoint(position.x, position.y).slice(0, 5)
                .map(element => ({ tag: element.tagName, id: element.id,
                  classes: String(element.className || '').slice(0, 200),
                  pointerEvents: getComputedStyle(element).pointerEvents,
                  bounds: element.getBoundingClientRect().toJSON(),
                  parent: { tag: element.parentElement?.tagName || '',
                    classes: String(element.parentElement?.className || '').slice(0, 200) } })),
              renderedPageOneSpans: document.querySelectorAll(
                '.pdf-native-page[data-pdf-page-number="1"] .pdf-native-text-layer span').length
            }), argument);
          }
          return value;
        };
        const value = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      }
    });
    const selectionGesture = await dragSelectAcrossNativePdfPages(measuredReader, {
      startPage: 1, endPage: 2, minimumCharacters: 20, prepareEvidence: true
    });
    const rawSelection = await reader.evaluate(() => String(document.getSelection() || ''));
    report.diagnostics.selectionGestureObserved.rawCharacters = rawSelection.length;
    report.diagnostics.selectionGestureObserved.rawSha256 = sha256(rawSelection);
    assert.equal(report.diagnostics.selectionGestureObserved?.textSha256,
      selectionBaseline.normalizedSha256,
      'B5_RECORDED_SELECTION_TEXT_CHANGED');
    assert.equal(report.diagnostics.selectionGestureObserved.characterCount,
      selectionBaseline.normalizedCharacters, 'B5_RECORDED_SELECTION_LENGTH_CHANGED');
    assert.equal(rawSelection.length, selectionBaseline.rawCharacters, 'B5_RECORDED_SELECTION_RAW_LENGTH_CHANGED');
    assert.equal(sha256(rawSelection), selectionBaseline.rawSha256, 'B5_RECORDED_SELECTION_RAW_TEXT_CHANGED');
    assert.deepEqual(report.diagnostics.selectionGestureObserved.endpoints,
      { start: { pageNumber: 1, spanIndex: selectionBaseline.endpoints[0].index,
        offset: selectionBaseline.endpoints[0].offset, nodeType: 3 },
        end: { pageNumber: 2, spanIndex: selectionBaseline.endpoints[1].index,
          offset: selectionBaseline.endpoints[1].offset, nodeType: 3 } },
      'B5_RECORDED_SELECTION_ACTUAL_ENDPOINTS_CHANGED');
    const preparedSelectionDiagnostics = await inspectPreparedNativePdfSelectionEvidence(
      reader, selectionGesture.selectionEvidence
    );
    assert.ok(preparedSelectionDiagnostics.selectedPageCount >= 2,
      'B5_SELECTION_DISTINCT_PAGES_MISSING');
    const priorSelectionTurnCount = await reader.evaluate(() =>
      articleChatState?.turns?.length || 0);
    await reader.locator('#sci-manual-toolbar').waitFor({ state: 'visible', timeout: 10_000 });
    await reader.locator('#sci-manual-toolbar .sci-manual-llm-action')
      .filter({ hasText: '释义' }).click();
    stage = 'SELECTION_COMPLETE';
    await reader.waitForFunction(prior =>
      (articleChatState?.turns || []).slice(prior).some(turn =>
        turn?.status === 'completed' && turn?.selectionEvidence),
    priorSelectionTurnCount, { timeout: 90_000 });
    const selectionTurn = await reader.evaluate(prior => {
      const turn = (articleChatState?.turns || []).slice(prior)
        .findLast(item => item?.status === 'completed' && item?.selectionEvidence);
      return turn ? { turnId: String(turn.turnId || ''), updatedAt: Number(turn.updatedAt) || 0,
        selectionEvidence: structuredClone(turn.selectionEvidence),
        citationEvidence: structuredClone(
          turn.answerBlocks?.flatMap(block => block.evidence || [])?.[0] || null
        ) } : null;
    }, priorSelectionTurnCount);
    assert.ok(selectionTurn?.turnId, 'B5_SELECTION_TURN_MISSING');
    const savedSelectionDiagnostics = await inspectPreparedNativePdfSelectionEvidence(
      reader, selectionTurn.selectionEvidence
    );
    const savedSelectionDigest = sha256(JSON.stringify(selectionTurn.selectionEvidence));
    const savedSelectionLocatorIdentity = selectionLocatorIdentityDigest(
      selectionTurn.selectionEvidence);
    report.checks.selectionProgress = {
      gesturePrepared: preparedSelectionDiagnostics,
      completedTurnSaved: true,
      savedEvidence: savedSelectionDiagnostics
    };

    stage = 'SELECTION_CITATION';
    await bindPanel(panel, worker, reader, readerTabId);
    await panel.evaluate(async () => {
      await refreshArticleWorkspace({ announce: false, throwOnError: true });
      switchWorkspaceView('chat');
    });
    const selectionTurnSelector = `.article-chat-turn[data-turn-id="${selectionTurn.turnId}"]`;
    const selectionCitation = panel.locator(
      `${selectionTurnSelector} .article-chat-inline-citation.is-verified`).first();
    await selectionCitation.waitFor({ state: 'visible', timeout: 30_000 });
    const selectionFocusBeforeReopen = await clickAndInspectCitation(
      panel, reader, selectionCitation, selectionTurn.citationEvidence,
      'B5_SELECTION_INITIAL_CITATION');

    stage = 'SELECTION_REOPEN';
    await panel.close();
    panel = await openPanel(context, extensionId, worker, reader, readerTabId,
      report.diagnostics);
    await panel.evaluate(() => switchWorkspaceView('chat'));
    const reopenedSelectionTurn = panel.locator(selectionTurnSelector);
    await reopenedSelectionTurn.waitFor({ state: 'visible', timeout: 30_000 });
    const reopenedSelectionState = await panel.evaluate(turnId => {
      const turn = currentWorkspaceSnapshot?.chat?.turns?.find(item => item?.turnId === turnId);
      return turn?.selectionEvidence ? {
        selectionEvidence: structuredClone(turn.selectionEvidence),
        citationEvidence: structuredClone(
          turn.answerBlocks?.flatMap(block => block.evidence || [])?.[0] || null
        )
      } : null;
    }, selectionTurn.turnId);
    const reopenedSelectionDiagnostics = await inspectPreparedNativePdfSelectionEvidence(
      reader, reopenedSelectionState?.selectionEvidence
    );
    const reopenedSelectionCitation = reopenedSelectionTurn.locator(
      '.article-chat-inline-citation.is-verified').first();
    await reopenedSelectionCitation.waitFor({ state: 'visible', timeout: 30_000 });
    const selectionFocusAfterReopen = await clickAndInspectCitation(
      panel, reader, reopenedSelectionCitation, reopenedSelectionState?.citationEvidence,
      'B5_SELECTION_REOPEN_CITATION');

    stage = 'SELECTION_REGENERATE';
    const callsBeforeSelectionRegenerate = fixture.state.streamCalls;
    const regenerate = reopenedSelectionTurn.locator(
      '[data-article-chat-action="regenerate"]').first();
    await regenerate.waitFor({ state: 'visible', timeout: 20_000 });
    await regenerate.click();
    await reader.waitForFunction(expected => {
      const turn = articleChatState?.turns?.find(item => item?.turnId === expected.turnId);
      return Number(turn?.updatedAt) > expected.updatedAt && turn?.status === 'completed';
    }, { turnId: selectionTurn.turnId, updatedAt: selectionTurn.updatedAt },
    { timeout: 90_000 });
    const regeneratedSelection = await reader.evaluate(turnId => {
      const turn = articleChatState?.turns?.find(item => item?.turnId === turnId);
      return turn ? { updatedAt: Number(turn.updatedAt) || 0,
        selectionEvidence: structuredClone(turn.selectionEvidence),
        citationEvidence: structuredClone(
          turn.answerBlocks?.flatMap(block => block.evidence || [])?.[0] || null
        ) } : null;
    }, selectionTurn.turnId);
    const regeneratedSelectionDiagnostics = await inspectPreparedNativePdfSelectionEvidence(
      reader, regeneratedSelection?.selectionEvidence
    );
    await panel.waitForFunction(turnId => {
      const turn = currentWorkspaceSnapshot?.chat?.turns?.find(item => item?.turnId === turnId);
      return turn?.status === 'completed';
    }, selectionTurn.turnId, { timeout: 30_000 });
    const regeneratedCitation = reopenedSelectionTurn.locator(
      '.article-chat-inline-citation.is-verified').first();
    await regeneratedCitation.waitFor({ state: 'visible', timeout: 30_000 });
    const selectionFocusAfterRegenerate = await clickAndInspectCitation(
      panel, reader, regeneratedCitation, regeneratedSelection?.citationEvidence,
      'B5_SELECTION_REGENERATED_CITATION');
    await capture(panel, '04-selection-regenerated');
    await capture(reader, '05-selection-exact-citation');
    report.checks.selection = {
      semanticLocatorSaved: savedSelectionDiagnostics.semanticLocatorCount ===
        savedSelectionDiagnostics.segmentCount,
      globalQuoteSpanVerified: savedSelectionDiagnostics.globalQuoteSpanCount ===
        savedSelectionDiagnostics.segmentCount,
      rawPageAnchorVerified: savedSelectionDiagnostics.pageAnchorMatchesRawCount ===
        savedSelectionDiagnostics.segmentCount,
      reopened: await reopenedSelectionTurn.count() === 1 &&
        sha256(JSON.stringify(reopenedSelectionState?.selectionEvidence)) ===
          savedSelectionDigest &&
        reopenedSelectionDiagnostics.semanticLocatorCount ===
          reopenedSelectionDiagnostics.segmentCount &&
        reopenedSelectionDiagnostics.globalQuoteSpanCount ===
          reopenedSelectionDiagnostics.segmentCount &&
        reopenedSelectionDiagnostics.pageAnchorMatchesRawCount ===
          reopenedSelectionDiagnostics.segmentCount,
      regenerated: regeneratedSelection?.updatedAt > selectionTurn.updatedAt &&
        fixture.state.streamCalls > callsBeforeSelectionRegenerate &&
        regeneratedSelectionDiagnostics.segmentCount === savedSelectionDiagnostics.segmentCount &&
        regeneratedSelectionDiagnostics.semanticLocatorCount ===
          regeneratedSelectionDiagnostics.segmentCount &&
        regeneratedSelectionDiagnostics.globalQuoteSpanCount ===
          regeneratedSelectionDiagnostics.segmentCount &&
        regeneratedSelectionDiagnostics.pageAnchorMatchesRawCount ===
          regeneratedSelectionDiagnostics.segmentCount,
      regeneratedIdentityPreserved: selectionLocatorIdentityDigest(
        regeneratedSelection?.selectionEvidence) === savedSelectionLocatorIdentity,
      citationFocusBeforeReopen: selectionFocusBeforeReopen.geometryMatches,
      citationFocusAfterReopen: selectionFocusAfterReopen.geometryMatches,
      citationFocusAfterRegenerate: selectionFocusAfterRegenerate.geometryMatches,
      exactFocusBeforeReopen: selectionFocusBeforeReopen,
      exactFocusAfterReopen: selectionFocusAfterReopen,
      exactFocusAfterRegenerate: selectionFocusAfterRegenerate,
      selectedPageCount: savedSelectionDiagnostics.selectedPageCount,
      segmentCount: savedSelectionDiagnostics.segmentCount
    };
    } catch (error) {
      const rawCode = String(error?.code || '');
      report.groupFailures ||= {};
      report.groupFailures.selection = { failureStage: stage,
        failureCode: stableFailureCode(error),
        underlyingCode: /^[A-Z][A-Z0-9_]{2,100}$/u.test(rawCode) ? rawCode : '',
        errorClass: String(error?.name || 'Error').slice(0, 50),
        failureFrames: [...String(error?.stack || '').matchAll(
          /([A-Za-z0-9_-]+\.(?:mjs|js)):(\d+):(\d+)/gu
        )].map(match => `${match[1]}:${match[2]}:${match[3]}`).slice(0, 5),
        dependentChecks: ['selection-reopen', 'selection-regenerate', 'selection-citation-focus'] };
      if (error?.evidence) {
        assertRedactedReport(error.evidence);
        report.groupFailures.selection.helperEvidence = error.evidence;
      }
      report.diagnostics.selectionPanelState = await collectPanelFailureDiagnostics(panel);
      report.diagnostics.selectionState = await reader.evaluate(() => {
        const live = describeCurrentManualSelection();
        return { liveValid: live?.validation?.valid === true,
          liveCode: String(live?.validation?.code || ''),
          selectedCharacters: String(document.getSelection() || '').length,
          anchorSegments: live?.anchorSegments?.length || 0,
          manualDocumentReady: Boolean(currentManualDocument?.documentId) };
      });
      report.diagnostics.selectionAnchorRequests = await reader.evaluate(() =>
        globalThis.__b5AnchorDiagnostics || []);
      report.diagnostics.selectionPinnedProspectiveSpan = await reader.evaluate(async baseline => {
        const first = document.querySelectorAll('.pdf-native-page[data-pdf-page-number="1"] .pdf-native-text-layer span')[baseline.endpoints[0].index]?.firstChild;
        const last = document.querySelectorAll('.pdf-native-page[data-pdf-page-number="2"] .pdf-native-text-layer span')[baseline.endpoints[1].index]?.firstChild;
        if (first?.nodeType !== Node.TEXT_NODE || last?.nodeType !== Node.TEXT_NODE ||
            first.textContent.length < 9 || last.textContent.length < 70) return { available: false };
        const detached = document.createRange(); detached.setStart(first, 9); detached.setEnd(last, 70);
        const raw = detached.toString(), normalized = raw.normalize('NFKC').replace(/\s+/gu, ' ').trim();
        const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder()
          .encode(normalized)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
        return { available: true, diagnosticOnly: true, injectedSelection: false,
          rawCharacters: raw.length, normalizedCharacters: normalized.length, normalizedSha256: hash,
          matchesRecordedSelection: hash === baseline.normalizedSha256 };
      }, selectionBaseline);
      await capture(panel, 'failure-selection-group-panel');
      await capture(reader, 'failure-selection-group-reader');
      await reader.evaluate(() => {
        document.getSelection()?.removeAllRanges();
        closeManualSelectionToolbar();
      });
      persist();
    }

    stage = 'DUPLICATE_AND_LEGACY';
    await bindPanel(panel, worker, reader, readerTabId);
    const samples = await reader.evaluate(() => {
      const navigation = globalThis.__brevessNativePdfDocument.getSemanticNavigation();
      const targets = [];
      const visit = sections => (sections || []).forEach(section => {
        targets.push(...(section.paragraphTargets || [])); visit(section.children);
      });
      visit(navigation.sections);
      const occurrences = new Map();
      for (const target of targets) {
        const words = String(target.expectedNormalizedQuote || '').match(/[A-Za-z]{7,18}/gu) || [];
        for (const word of new Set(words.map(item => item.toLowerCase()))) {
          const pattern = new RegExp(`\\b${word}\\b`, 'giu');
          const matches = [...target.expectedNormalizedQuote.matchAll(pattern)];
          if (matches.length !== 1) continue;
          const list = occurrences.get(word) || [];
          list.push({ target, index: matches[0].index, word: matches[0][0] });
          occurrences.set(word, list);
        }
      }
      const duplicate = [...occurrences.values()]
        .map(list => list.filter(item => item.word === list[0].word))
        .find(list => list.length >= 2);
      if (!duplicate) throw new Error('B5_DUPLICATE_SAMPLE_MISSING');
      const make = item => ({ locatorKind: 'pdf-semantic',
        documentId: navigation.documentId, documentHash: navigation.documentHash,
        documentGeneration: navigation.documentGeneration, revision: navigation.revision,
        semanticCacheKey: navigation.semanticCacheKey,
        semanticProvenanceKey: navigation.semanticProvenanceKey,
        paragraphId: item.target.paragraphId,
        normalizedStart: item.target.normalizedStart + item.index,
        normalizedEnd: item.target.normalizedStart + item.index + item.word.length,
        expectedNormalizedQuote: item.word,
        quote: item.word });
      const legacyParagraph = globalThis.__brevessNativePdfDocument.structure.paragraphs
        .find(item => item.pageNumber === 1);
      const legacyWord = String(legacyParagraph?.text || '').match(/[A-Za-z]{10,}/u)?.[0] || '';
      return { first: make(duplicate[0]), second: make(duplicate[1]),
        duplicateWord: duplicate[0].word,
        legacy: { paragraphId: 'pdf-page-1', pageNumber: 1, quote: legacyWord,
          documentHash: navigation.documentHash } };
    });
    const focus = async evidence => {
      const response = await tabMessage(worker, readerTabId, {
        action: 'focusArticleWorkspaceSource', target: { kind: 'article-chat-citation', evidence }
      });
      assert.equal(response?.success, true, 'B5_CITATION_MESSAGE_FAILED');
      assert.ok(response?.citationResult, 'B5_CITATION_RESULT_MISSING');
      return response.citationResult;
    };
    const firstDuplicate = await focus(samples.first);
    const secondDuplicate = await focus(samples.second);
    await reader.evaluate(() => {
      const viewer = document.getElementById('pdfNativeViewer');
      globalThis.__b5AmbiguousScrolls = 0;
      const original = viewer.scrollTo.bind(viewer);
      viewer.scrollTo = (...args) => {
        globalThis.__b5AmbiguousScrolls += 1;
        return original(...args);
      };
    });
    const ambiguousResponse = await focus({ quote: samples.duplicateWord,
      documentHash: EXPECTED_PDF_SHA256 });
    const ambiguousScrollCount = await reader.evaluate(() =>
      Number(globalThis.__b5AmbiguousScrolls) || 0);
    const legacyWithQuoteResponse = await focus(samples.legacy);
    const legacyResponse = await focus({ paragraphId: samples.legacy.paragraphId,
      pageNumber: samples.legacy.pageNumber, documentHash: samples.legacy.documentHash });
    report.diagnostics.legacyWithQuote = {
      focused: legacyWithQuoteResponse?.focused === true,
      status: legacyWithQuoteResponse?.status || '',
      reasonCode: legacyWithQuoteResponse?.reasonCode || '',
      precision: legacyWithQuoteResponse?.precision || ''
    };
    report.checks.duplicate = {
      locatorDisambiguated: firstDuplicate?.focused === true && secondDuplicate?.focused === true &&
        firstDuplicate?.paragraphId !== secondDuplicate?.paragraphId,
      quoteOnlyAmbiguous: ambiguousResponse?.focused !== true &&
        (ambiguousResponse?.status === 'ambiguous' ||
          ambiguousResponse?.reasonCode === 'PDF_FOCUS_QUOTE_AMBIGUOUS'),
      ambiguousScrollCount
    };
    report.checks.legacy = { usable: legacyResponse?.focused === true,
      pageLevelDegraded: legacyResponse?.precision === 'page-only' &&
        Boolean(legacyResponse?.degradedReasonCode || legacyResponse?.reasonCode) };

    stage = 'NOTE_UI';
    await panel.locator('#openLiteratureNote').click();
    await panel.locator('#literatureNoteDrawer').waitFor({ state: 'visible', timeout: 20_000 });
    await panel.locator('#autofillLiteratureNote').click();
    await panel.waitForFunction(() => !literatureNoteAutofillPromise &&
      literatureNoteDocumentState?.schemaVersion === 3 &&
      Object.values(literatureNoteDocumentState.fieldEvidenceByTemplate || {})
        .some(fields => Object.values(fields || {}).some(item => item?.locators?.length)),
    null, { timeout: 90_000 });
    const whole = await panel.evaluate(() => {
      const templateId = literatureNoteDocumentState.templateId;
      return { templateId, state: structuredClone(literatureNoteDocumentState),
        fieldIds: Object.keys(literatureNoteDocumentState.valuesByTemplate?.[templateId] || {}) };
    });
    assert.ok(whole.fieldIds.length >= 2, 'B5_NOTE_TABLE_FIELDS_INSUFFICIENT');
    const targetField = whole.fieldIds[0];
    const otherBefore = JSON.stringify({
      values: Object.fromEntries(Object.entries(
        whole.state.valuesByTemplate[whole.templateId]).filter(([key]) => key !== targetField)),
      evidence: Object.fromEntries(Object.entries(
        whole.state.fieldEvidenceByTemplate[whole.templateId]).filter(([key]) => key !== targetField))
    });
    await panel.locator(`[data-generate-literature-note-field="${targetField}"]`).click();
    await panel.waitForFunction(({ templateId, fieldId, previous }) =>
      !literatureNoteAutofillPromise && String(
        literatureNoteDocumentState?.valuesByTemplate?.[templateId]?.[fieldId] || '') !== previous,
    { templateId: whole.templateId, fieldId: targetField,
      previous: whole.state.valuesByTemplate[whole.templateId][targetField] },
    { timeout: 90_000 });
    const afterField = await panel.evaluate(({ templateId, fieldId }) => {
      const state = literatureNoteDocumentState;
      return { state: structuredClone(state),
        evidence: structuredClone(state.fieldEvidenceByTemplate?.[templateId]?.[fieldId] || null),
        other: JSON.stringify({ values: Object.fromEntries(Object.entries(
          state.valuesByTemplate?.[templateId] || {}).filter(([key]) => key !== fieldId)),
        evidence: Object.fromEntries(Object.entries(
          state.fieldEvidenceByTemplate?.[templateId] || {}).filter(([key]) => key !== fieldId)) }) };
    }, { templateId: whole.templateId, fieldId: targetField });
    const noteDigest = noteContentIdentityDigest(afterField.state);
    const persistedNote = await panel.evaluate(async () => {
      const stored = await chrome.storage.local.get('sciLiteratureNotesV1');
      return structuredClone(stored?.sciLiteratureNotesV1?.entries?.[
        literatureNoteDocumentKey()] || null);
    });
    await panel.close();
    panel = await openPanel(context, extensionId, worker, reader, readerTabId,
      report.diagnostics);
    await panel.locator('#openLiteratureNote').click();
    await panel.locator('#literatureNoteDrawer').waitFor({ state: 'visible', timeout: 20_000 });
    const reopenedNote = await panel.evaluate(() => structuredClone(literatureNoteDocumentState));
    report.diagnostics.noteReopen = {
      serializedOrderIdentical: JSON.stringify(afterField.state) === JSON.stringify(reopenedNote),
      contentAndFieldRevisionsIdentical:
        noteContentIdentityDigest(reopenedNote) === noteDigest,
      documentSaveTimestampMonotonic:
        Number(reopenedNote?.updatedAt) >= Number(afterField.state?.updatedAt),
      changedTopLevelProperties: [...new Set([...Object.keys(afterField.state || {}),
        ...Object.keys(reopenedNote || {})])].filter(key =>
        stateIdentityDigest(afterField.state?.[key] ?? null) !==
          stateIdentityDigest(reopenedNote?.[key] ?? null))
    };
    await capture(panel, '06-note-reopened');
    report.checks.note = {
      wholeTableEvidenceSaved: whole.fieldIds.every(fieldId =>
        whole.state.fieldEvidenceByTemplate?.[whole.templateId]?.[fieldId]
          ?.locators?.length > 0),
      singleFieldEvidenceSaved: afterField.evidence?.locators?.length > 0,
      otherFieldsUnchanged: afterField.other === otherBefore,
      persistedContentIdentical: noteContentIdentityDigest(persistedNote) === noteDigest,
      reopenedIdentical: noteContentIdentityDigest(reopenedNote) === noteDigest
    };

    stage = 'LEGACY_NOTE_UI';
    const legacyNote = await panel.evaluate(async () => {
      currentWorkspaceSnapshot.localWorkspace = null;
      const key = literatureNoteDocumentKey();
      const template = literatureNoteTemplates()[0];
      const field = template?.fields?.[0];
      if (!key || !template || !field) throw new Error('B5_LEGACY_NOTE_TARGET_MISSING');
      await chrome.storage.local.set({ sciLiteratureNotesV1: { schemaVersion: 1,
        entries: { [key]: { schemaVersion: 2, templateId: template.id,
          valuesByTemplate: { [template.id]: { [field.id]: 'B5 历史笔记仍可见' } },
          fieldStatusByTemplate: { [template.id]: { [field.id]: 'supported' } },
          updatedAt: 1 } } } });
      literatureNoteDocumentState = null;
      await loadLiteratureNoteDocumentState();
      renderLiteratureNoteDrawer();
      const textarea = document.querySelector(
        `[data-literature-note-field="${field.id}"]`);
      const status = textarea?.closest('.literature-note-field')?.querySelector(
        '.literature-note-field-source');
      return { visible: textarea?.value === 'B5 历史笔记仍可见',
        historicalSourceLabel: /历史|来源未保存/u.test(String(status?.textContent || '')),
        schemaVersion: literatureNoteDocumentState?.schemaVersion || 0 };
    });
    report.checks.legacyNote = legacyNote;
    await capture(panel, '07-note-legacy-source-label');

    stage = 'REVISION_REBIND';
    const revisionSamples = await reader.evaluate(() => {
      const current = readPdfSemanticNavigationContext();
      const currentTargets = pdfSemanticParagraphTargets(current.navigation);
      const snapshots = (globalThis.__b5PublishedNavigations || []).filter(item =>
        item.documentHash === current.documentHash &&
        item.documentGeneration === current.documentGeneration &&
        item.revision < current.revision);
      const make = (navigation, target, quote, localStart) => ({
        locatorKind: 'pdf-semantic', documentId: navigation.documentId,
        documentHash: navigation.documentHash, documentGeneration: navigation.documentGeneration,
        revision: navigation.revision, semanticCacheKey: navigation.semanticCacheKey,
        semanticProvenanceKey: navigation.semanticProvenanceKey, paragraphId: target.paragraphId,
        normalizedStart: target.normalizedStart + localStart,
        normalizedEnd: target.normalizedStart + localStart + quote.length,
        expectedNormalizedQuote: quote, quote
      });
      let unique = null, duplicate = null;
      const countOccurrences = (text, quote) => {
        let count = 0, start = 0;
        while ((start = text.indexOf(quote, start)) >= 0) { count += 1; start += quote.length; }
        return count;
      };
      for (const previous of snapshots) {
        for (const target of pdfSemanticParagraphTargets(previous)) {
          const paragraph = String(target.expectedNormalizedQuote || '');
          if (!unique) {
            const quote = paragraph.match(/^[\s\S]{32,180}(?=\s|$)/u)?.[0]?.trim() || '';
            const candidates = quote ? currentTargets.filter(item =>
              countOccurrences(item.expectedNormalizedQuote, quote) === 1) : [];
            const total = quote ? currentTargets.reduce((sum, item) => sum +
              countOccurrences(item.expectedNormalizedQuote, quote), 0) : 0;
            if (total === 1 && candidates.length === 1) {
              const currentTarget = candidates[0];
              unique = { old: make(previous, target, quote, paragraph.indexOf(quote)),
                current: make(current, currentTarget, quote,
                  currentTarget.expectedNormalizedQuote.indexOf(quote)) };
            }
          }
          if (!duplicate) {
            for (const word of paragraph.match(/[A-Za-z]{7,18}/gu) || []) {
              if (currentTargets.reduce((sum, item) => sum +
                countOccurrences(item.expectedNormalizedQuote, word), 0) > 1) {
                duplicate = make(previous, target, word, paragraph.indexOf(word));
                break;
              }
            }
          }
          if (unique && duplicate) break;
        }
        if (unique && duplicate) break;
      }
      return { unique, duplicate, currentRevision: current.revision,
        delayedIndexTasks: Number(globalThis.__b5DelayedIndexTasks) || 0,
        publishedRevisions: (globalThis.__b5PublishedNavigations || []).map(item => item.revision) };
    });
    report.diagnostics.publishedSemanticRevisions = revisionSamples.publishedRevisions;
    report.execution.nativeIndexTimingFixture = true;
    report.diagnostics.delayedNativeIndexTasks = revisionSamples.delayedIndexTasks;
    assert.ok(revisionSamples.unique && revisionSamples.duplicate,
      'B5_EARLIER_NATIVE_REVISION_SAMPLE_MISSING');
    const reboundResponse = await focus(revisionSamples.unique.old);
    report.diagnostics.revisionRebindResponse = {
      focused: reboundResponse?.focused === true, rebound: reboundResponse?.rebound === true,
      pageNumber: Number(reboundResponse?.pageNumber) || 0,
      originalRevision: revisionSamples.unique.old.revision, currentRevision: revisionSamples.currentRevision
    };
    const reboundResolution = await inspectExactCitationFocus(reader,
      revisionSamples.unique.current, 'B5_REVISION_CITATION_NOT_EXACT');
    const duplicateScrollsBeforeRevisionFocus = await reader.evaluate(() =>
      Number(globalThis.__b5AmbiguousScrolls) || 0);
    const duplicateRevisionResponse = await focus(revisionSamples.duplicate);
    const revisionDuplicateScrollCount = await reader.evaluate(() =>
      Number(globalThis.__b5AmbiguousScrolls) || 0) - duplicateScrollsBeforeRevisionFocus;
    report.checks.revision = {
      fixture: 'earlier-native-publication',
      originalRevision: revisionSamples.unique.old.revision,
      currentRevision: revisionSamples.currentRevision,
      revisionAdvanced: revisionSamples.currentRevision > revisionSamples.unique.old.revision,
      rebound: reboundResponse?.focused === true && reboundResponse?.rebound === true &&
        Number(reboundResponse.pageNumber) === reboundResolution.expectedPageNumbers[0] &&
        reboundResolution.geometryMatches,
      exactFocus: reboundResolution,
      duplicateRejected: duplicateRevisionResponse?.focused !== true &&
        duplicateRevisionResponse?.migrationStatus === 'ambiguous' &&
        duplicateRevisionResponse?.degradedReasonCode === 'PDF_SEMANTIC_QUOTE_AMBIGUOUS',
      duplicateScrollCount: revisionDuplicateScrollCount };

    stage = 'DOCUMENT_REPLACEMENT';
    const oldEvidence = chat.evidence;
    const beforeGeneration = await reader.evaluate(() =>
      globalThis.__brevessNativePdfDocument.documentGeneration);
    await reader.evaluate(() => globalThis.__brevessPdfReaderBridge.command('replaceDocument'));
    await reader.waitForFunction(({ hash, before }) =>
      globalThis.__brevessNativePdfDocument?.phase === 'text-ready' &&
      globalThis.__brevessNativePdfDocument?.structure?.documentHash === hash &&
      globalThis.__brevessNativePdfDocument?.documentGeneration > before &&
      globalThis.__brevessPdfSemanticCompatibility,
    { hash: EXPECTED_PDF_SHA256, before: beforeGeneration }, { timeout: 120_000 });
    const scrollBefore = await reader.evaluate(() => {
      globalThis.__b5ReplacementScrolls = 0;
      const viewer = document.getElementById('pdfNativeViewer');
      const original = viewer.scrollTo.bind(viewer);
      viewer.scrollTo = (...args) => {
        globalThis.__b5ReplacementScrolls += 1; return original(...args);
      };
      return globalThis.__b5ReplacementScrolls;
    });
    const staleResponse = await focus(oldEvidence);
    const replacementScrolls = await reader.evaluate(() =>
      Number(globalThis.__b5ReplacementScrolls) || 0);
    report.checks.replacement = { stale: staleResponse?.focused !== true &&
      (staleResponse?.status === 'stale' ||
        ['PDF_FOCUS_STALE', 'PDF_DOCUMENT_CHANGED'].includes(
          staleResponse?.reasonCode || staleResponse?.degradedReasonCode)),
      scrollCount: replacementScrolls - scrollBefore };

    stage = 'FINAL';
    report.network.fixtureErrors = fixture.state.errors;
    assertAcceptanceEvidence(report.checks);
    assert.ok(fixture.state.streamCalls >= 3, 'B5_CHAT_PROVIDER_CALLS_MISSING');
    assert.ok(fixture.state.jsonCalls >= 2, 'B5_NOTE_PROVIDER_CALLS_MISSING');
    assert.equal(fixture.state.calls, 5, 'B5_PROVIDER_CALL_COUNT_CHANGED');
    assert.equal(fixture.state.rejectedByCap, false, 'B5_PROVIDER_CALL_CAP_EXCEEDED');
    assert.equal(fixture.state.errors, 0, 'B5_PROVIDER_ERROR');
    assert.equal(report.network.externalHttpRequests, 0, 'B5_EXTERNAL_HTTP_DETECTED');
    assert.equal(report.diagnostics.pageErrors, 0, 'B5_PAGE_ERROR');
    assert.equal(report.diagnostics.consoleErrors, 0, 'B5_CONSOLE_ERROR');
    assert.equal(report.diagnostics.workerErrors, 0, 'B5_WORKER_ERROR');
    report.status = 'PASS';
  } catch (error) {
    report.status = 'FAIL';
    report.failureStage = stage;
    report.failureCode = stableFailureCode(error);
    const rawFailureCode = String(error?.code || '');
    report.diagnostics.underlyingCode = /^[A-Z][A-Z0-9_]{2,100}$/u.test(rawFailureCode)
      ? rawFailureCode : String(error?.message || '')
        .match(/\b(?:B5|PDF)_[A-Z0-9_]{3,100}\b/u)?.[0] || '';
    report.diagnostics.failureFrames = [...String(error?.stack || '').matchAll(
      /([A-Za-z0-9_-]+\.(?:mjs|js)):(\d+):(\d+)/gu
    )].map(match => `${match[1]}:${match[2]}:${match[3]}`).slice(0, 5);
    if (error?.evidence) {
      try { assertRedactedReport(error.evidence);
        report.diagnostics.helperEvidence = error.evidence; } catch {}
    }
    if (error?.focusEvidence) report.diagnostics.focusEvidence = error.focusEvidence;
    if (Array.isArray(error?.locatorIdentityDifference)) {
      report.diagnostics.locatorIdentityDifference = error.locatorIdentityDifference;
    }
    report.diagnostics.failureState = await collectPanelFailureDiagnostics(panel);
    if (stage.startsWith('SELECTION') && reader && !reader.isClosed()) {
      try { report.diagnostics.selectionState = await reader.evaluate(() => {
        const live = describeCurrentManualSelection();
        const cached = currentManualSelection;
        return { liveValid: live?.validation?.valid === true,
          liveCode: String(live?.validation?.code || ''),
          cachedValid: cached?.validation?.valid === true,
          cachedCode: String(cached?.validation?.code || ''),
          selectedCharacters: String(document.getSelection() || '').length,
          anchorSegments: live?.anchorSegments?.length || 0,
          manualDocumentReady: Boolean(currentManualDocument?.documentId) };
      }); } catch {}
    }
    try { await capture(panel, `failure-${stage.toLowerCase()}-panel`); } catch {}
    try { await capture(reader, `failure-${stage.toLowerCase()}-reader`); } catch {}
    process.exitCode = 1;
  } finally {
    report.network.fixtureErrors = fixture?.state?.errors || report.network.fixtureErrors;
    report.network.providerCalls = config.provider === 'deepseek'
      ? fixture?.state?.calls || report.network.providerCalls : 0;
    report.network.providerResponses = config.provider === 'deepseek'
      ? fixture?.state?.responses || report.network.providerResponses : [];
    try { await panel?.close(); } catch {}
    try { await context?.close(); } catch {}
    try { await new Promise(resolve => fixture?.server?.close(resolve) || resolve()); } catch {}
    removeTemporary(tempRoot);
    persist();
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  }
  return report;
}

function directInvocation() {
  const entry = process.argv[1];
  return Boolean(entry) && import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

export { run };

if (directInvocation()) {
  if (process.argv.includes('--help')) process.stdout.write(`${helpText()}\n`);
  else await run(normalizeOptions());
}
