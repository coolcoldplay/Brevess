#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const ANNOTATION_SCHEMA_VERSION = 'brevess.pdf-semantic-corpus.annotations.v1';
export const RESULT_SCHEMA_VERSION = 'brevess.pdf-semantic-corpus.results.v1';

export const PDF_SEMANTIC_CORPUS_THRESHOLDS = Object.freeze({
  documents: 8,
  sentences: 120,
  headings: 80,
  sectionRanges: 30,
  sentenceAccuracy: 0.98,
  headingPrecision: 0.95,
  headingRecall: 0.90,
  sectionRangeAccuracy: 1
});

const LIMITS = Object.freeze({
  fileBytes: 16 * 1024 * 1024,
  records: 20_000,
  documents: 100,
  sentences: 5_000,
  headings: 5_000,
  sectionRanges: 2_000,
  pageNumbers: 64,
  idChars: 160,
  textChars: 8_192,
  latencyMs: 3_600_000
});

class CorpusInputError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CorpusInputError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new CorpusInputError(code, message);
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function boundedString(value, name, { max = LIMITS.idChars, allowEmpty = false } = {}) {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0) || value.length > max ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)) {
    fail('INVALID_STRING', `${name} must be a bounded string`);
  }
  return value;
}

function validHash(value, name) {
  const output = boundedString(value, name, { max: 64 });
  if (!/^[a-f0-9]{64}$/u.test(output)) fail('INVALID_SHA256', `${name} must be lowercase SHA-256`);
  return output;
}

function boundedArray(value, name, max) {
  if (!Array.isArray(value) || value.length > max) {
    fail('INVALID_ARRAY', `${name} must be an array with at most ${max} entries`);
  }
  return value;
}

function positiveInteger(value, name, { zero = false } = {}) {
  if (!Number.isSafeInteger(value) || value < (zero ? 0 : 1)) {
    fail('INVALID_INTEGER', `${name} must be a ${zero ? 'non-negative' : 'positive'} integer`);
  }
  return value;
}

function finiteLatency(value, name) {
  if (!Number.isFinite(value) || value < 0 || value > LIMITS.latencyMs) {
    fail('INVALID_LATENCY', `${name} must be between 0 and ${LIMITS.latencyMs} ms`);
  }
  return Number(value);
}

function exactPageNumbers(value, name) {
  const pages = boundedArray(value, name, LIMITS.pageNumbers).map((page, index) =>
    positiveInteger(page, `${name}[${index}]`));
  if (pages.length === 0 || new Set(pages).size !== pages.length ||
      pages.some((page, index) => index > 0 && page <= pages[index - 1])) {
    fail('INVALID_PAGE_EXPECTATION', `${name} must be a non-empty, strictly increasing page list`);
  }
  return pages;
}

function textExpectation(record, prefix, name) {
  const hashKey = `${prefix}Sha256`;
  const textKey = prefix.replace(/Sha256$/u, '');
  const suppliedHash = record?.[hashKey];
  const suppliedText = record?.[textKey];
  if (suppliedText !== undefined) {
    boundedString(suppliedText, `${name}.${textKey}`, { max: LIMITS.textChars, allowEmpty: true });
  }
  if (suppliedHash === undefined && suppliedText === undefined) {
    fail('MISSING_TEXT_EXPECTATION', `${name} needs ${hashKey} or ${textKey}`);
  }
  const computed = suppliedText === undefined ? null : sha256(suppliedText);
  if (suppliedHash !== undefined && validHash(suppliedHash, `${name}.${hashKey}`) !== computed && computed) {
    fail('TEXT_HASH_MISMATCH', `${name}.${textKey} does not match ${hashKey}`);
  }
  return suppliedHash === undefined ? computed : suppliedHash;
}

function rangePoint(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('INVALID_RANGE_POINT', `${name} must be an object`);
  }
  return {
    pageNumber: positiveInteger(value.pageNumber, `${name}.pageNumber`),
    offset: positiveInteger(value.offset, `${name}.offset`, { zero: true })
  };
}

function rangeIsOrdered(start, end) {
  return start.pageNumber < end.pageNumber ||
    (start.pageNumber === end.pageNumber && start.offset < end.offset);
}

function uniqueRecords(records, key, name) {
  const seen = new Set();
  for (const record of records) {
    const value = boundedString(record?.[key], `${name}.${key}`);
    if (seen.has(value)) fail('DUPLICATE_ID', `duplicate ${name}.${key}: ${value}`);
    seen.add(value);
  }
}

function recordsToBundle(records, expectedVersion) {
  boundedArray(records, 'records', LIMITS.records);
  const meta = records.filter(record => record?.recordType === 'meta');
  if (meta.length !== 1) fail('INVALID_JSONL_META', 'JSONL requires exactly one meta record');
  const base = { ...meta[0] };
  delete base.recordType;
  if (expectedVersion === ANNOTATION_SCHEMA_VERSION) {
    return {
      ...base,
      documents: records.filter(record => record?.recordType === 'document'),
      sentences: records.filter(record => record?.recordType === 'sentence'),
      headings: records.filter(record => record?.recordType === 'heading'),
      sectionRanges: records.filter(record => record?.recordType === 'section-range')
    };
  }
  return {
    ...base,
    sentences: records.filter(record => record?.recordType === 'sentence-result'),
    headings: records.filter(record => record?.recordType === 'heading-result'),
    sectionRanges: records.filter(record => record?.recordType === 'section-range-result'),
    performance: records.filter(record => record?.recordType === 'performance')
  };
}

export function readVersionedCorpusFile(filePath, expectedVersion) {
  const resolved = path.resolve(boundedString(filePath, 'filePath', { max: 4_096 }));
  let stats;
  try {
    stats = fs.statSync(resolved);
  } catch {
    fail('FILE_NOT_FOUND', `input file is not available: ${path.basename(resolved)}`);
  }
  if (!stats.isFile() || stats.size <= 0 || stats.size > LIMITS.fileBytes) {
    fail('INVALID_FILE_SIZE', `input must be a non-empty file no larger than ${LIMITS.fileBytes} bytes`);
  }
  const source = fs.readFileSync(resolved, 'utf8');
  let parsed;
  try {
    if (/\.jsonl$/iu.test(resolved)) {
      const lines = source.split(/\r?\n/u).filter(line => line.trim());
      if (lines.length > LIMITS.records) fail('TOO_MANY_RECORDS', 'JSONL record limit exceeded');
      parsed = recordsToBundle(lines.map((line, index) => {
        if (Buffer.byteLength(line, 'utf8') > 512 * 1024) {
          fail('JSONL_LINE_TOO_LARGE', `JSONL line ${index + 1} exceeds 512 KiB`);
        }
        try { return JSON.parse(line); } catch { fail('INVALID_JSONL', `invalid JSONL line ${index + 1}`); }
      }), expectedVersion);
    } else {
      parsed = JSON.parse(source);
      if (Array.isArray(parsed)) parsed = recordsToBundle(parsed, expectedVersion);
    }
  } catch (error) {
    if (error instanceof CorpusInputError) throw error;
    fail('INVALID_JSON', 'input is not valid JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    fail('INVALID_BUNDLE', 'input must be a JSON object or typed JSONL records');
  }
  if (parsed.schemaVersion !== expectedVersion) {
    fail('SCHEMA_VERSION_MISMATCH', `expected schemaVersion ${expectedVersion}`);
  }
  return parsed;
}

function normalizeAnnotations(input) {
  boundedString(input.corpusId, 'annotations.corpusId');
  const provenance = input.provenance;
  if (!provenance || typeof provenance !== 'object' || Array.isArray(provenance)) {
    fail('INVALID_PROVENANCE', 'annotations.provenance is required');
  }
  const documents = boundedArray(input.documents, 'annotations.documents', LIMITS.documents)
    .map((record, index) => ({
      documentId: boundedString(record?.documentId, `documents[${index}].documentId`),
      documentSha256: validHash(record?.documentSha256, `documents[${index}].documentSha256`)
    }));
  uniqueRecords(documents, 'documentId', 'document');
  const documentMap = new Map(documents.map(record => [record.documentId, record]));
  const normalizeOwner = (record, name) => {
    const documentId = boundedString(record?.documentId, `${name}.documentId`);
    if (!documentMap.has(documentId)) fail('UNKNOWN_DOCUMENT', `${name} references an unknown document`);
    return documentId;
  };
  const sentences = boundedArray(input.sentences, 'annotations.sentences', LIMITS.sentences)
    .map((record, index) => {
      const name = `sentences[${index}]`;
      return {
        id: boundedString(record?.id, `${name}.id`),
        documentId: normalizeOwner(record, name),
        rawSha256: textExpectation(record, 'expectedRawText', name),
        normalizedSha256: textExpectation(record, 'expectedNormalizedText', name),
        pageNumbers: exactPageNumbers(record?.expectedPageNumbers, `${name}.expectedPageNumbers`)
      };
    });
  const headings = boundedArray(input.headings, 'annotations.headings', LIMITS.headings)
    .map((record, index) => {
      const name = `headings[${index}]`;
      if (!['positive', 'negative'].includes(record?.label)) {
        fail('INVALID_HEADING_LABEL', `${name}.label must be positive or negative`);
      }
      return {
        id: boundedString(record?.id, `${name}.id`),
        documentId: normalizeOwner(record, name),
        label: record.label,
        rawSha256: textExpectation(record, 'expectedRawText', name),
        pageNumber: positiveInteger(record?.expectedPageNumber, `${name}.expectedPageNumber`)
      };
    });
  const sectionRanges = boundedArray(input.sectionRanges, 'annotations.sectionRanges',
    LIMITS.sectionRanges).map((record, index) => {
    const name = `sectionRanges[${index}]`;
    const start = rangePoint(record?.expectedStart, `${name}.expectedStart`);
    const end = rangePoint(record?.expectedEnd, `${name}.expectedEnd`);
    if (!rangeIsOrdered(start, end)) fail('INVALID_SECTION_RANGE', `${name} must have a positive span`);
    return {
      id: boundedString(record?.id, `${name}.id`),
      documentId: normalizeOwner(record, name), start, end
    };
  });
  uniqueRecords(sentences, 'id', 'sentence');
  uniqueRecords(headings, 'id', 'heading');
  uniqueRecords(sectionRanges, 'id', 'sectionRange');
  return {
    corpusId: input.corpusId,
    provenance: {
      annotationKind: provenance.annotationKind,
      humanReviewed: provenance.humanReviewed === true,
      containsSynthetic: provenance.containsSynthetic === true
    },
    documents, sentences, headings, sectionRanges
  };
}

function normalizeResults(input, annotations) {
  if (input.corpusId !== annotations.corpusId) fail('CORPUS_ID_MISMATCH', 'result corpusId differs from annotations');
  const documentMap = new Map(annotations.documents.map(record => [record.documentId, record]));
  const normalizeDocument = (record, name) => ({
    documentId: boundedString(record?.documentId, `${name}.documentId`),
    documentSha256: validHash(record?.documentSha256, `${name}.documentSha256`)
  });
  const sentences = boundedArray(input.sentences, 'results.sentences', LIMITS.sentences)
    .map((record, index) => {
      const name = `results.sentences[${index}]`;
      return {
        annotationId: boundedString(record?.annotationId, `${name}.annotationId`),
        ...normalizeDocument(record, name),
        rawSha256: textExpectation(record, 'rawText', name),
        normalizedSha256: textExpectation(record, 'normalizedText', name),
        pageNumbers: exactPageNumbers(record?.pageNumbers, `${name}.pageNumbers`)
      };
    });
  const headings = boundedArray(input.headings, 'results.headings', LIMITS.headings)
    .map((record, index) => {
      const name = `results.headings[${index}]`;
      if (typeof record?.predicted !== 'boolean') fail('INVALID_PREDICTION', `${name}.predicted must be boolean`);
      return {
        annotationId: boundedString(record?.annotationId, `${name}.annotationId`),
        ...normalizeDocument(record, name), predicted: record.predicted,
        pageNumber: record.predicted
          ? positiveInteger(record.pageNumber, `${name}.pageNumber`) : null,
        rawSha256: record.predicted ? textExpectation(record, 'rawText', name) : null
      };
    });
  const sectionRanges = boundedArray(input.sectionRanges, 'results.sectionRanges',
    LIMITS.sectionRanges).map((record, index) => {
    const name = `results.sectionRanges[${index}]`;
    const start = rangePoint(record?.start, `${name}.start`);
    const end = rangePoint(record?.end, `${name}.end`);
    if (!rangeIsOrdered(start, end)) fail('INVALID_SECTION_RANGE', `${name} must have a positive span`);
    return { annotationId: boundedString(record?.annotationId, `${name}.annotationId`),
      ...normalizeDocument(record, name), start, end };
  });
  const performance = boundedArray(input.performance, 'results.performance', LIMITS.documents)
    .map((record, index) => ({
      documentId: boundedString(record?.documentId, `results.performance[${index}].documentId`),
      coldMs: finiteLatency(record?.coldMs, `results.performance[${index}].coldMs`),
      hotMs: finiteLatency(record?.hotMs, `results.performance[${index}].hotMs`)
    }));
  uniqueRecords(sentences, 'annotationId', 'sentenceResult');
  uniqueRecords(headings, 'annotationId', 'headingResult');
  uniqueRecords(sectionRanges, 'annotationId', 'sectionRangeResult');
  uniqueRecords(performance, 'documentId', 'performance');
  for (const item of performance) {
    if (!documentMap.has(item.documentId)) fail('UNKNOWN_DOCUMENT', 'performance references an unknown document');
  }
  return { sentences, headings, sectionRanges, performance };
}

function quantile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1);
  return Number(sorted[index].toFixed(3));
}

function summarizeLatency(records, key) {
  const values = records.map(record => record[key]);
  return {
    samples: values.length,
    minMs: values.length ? Number(Math.min(...values).toFixed(3)) : null,
    medianMs: quantile(values, 0.5),
    p95Ms: quantile(values, 0.95),
    maxMs: values.length ? Number(Math.max(...values).toFixed(3)) : null
  };
}

function equalPages(left, right) {
  return left.length === right.length && left.every((page, index) => page === right[index]);
}

function equalPoint(left, right) {
  return left.pageNumber === right.pageNumber && left.offset === right.offset;
}

function ratio(numerator, denominator) {
  return denominator > 0 ? Number((numerator / denominator).toFixed(6)) : 0;
}

function notReady(code, reason, details = {}) {
  return {
    schemaVersion: 1,
    status: 'NOT_READY',
    eligibleForRelease: false,
    code, reason,
    thresholds: PDF_SEMANTIC_CORPUS_THRESHOLDS,
    ...details
  };
}

export function evaluatePdfSemanticCorpus(annotationsInput, resultsInput, options = {}) {
  if (annotationsInput?.schemaVersion !== ANNOTATION_SCHEMA_VERSION) {
    fail('SCHEMA_VERSION_MISMATCH', `expected schemaVersion ${ANNOTATION_SCHEMA_VERSION}`);
  }
  const annotations = normalizeAnnotations(annotationsInput);
  const annotationDocumentCoverage = {
    sentences: new Set(annotations.sentences.map(item => item.documentId)).size,
    headings: new Set(annotations.headings.map(item => item.documentId)).size,
    sectionRanges: new Set(annotations.sectionRanges.map(item => item.documentId)).size
  };
  const counts = {
    documents: annotations.documents.length,
    sentences: annotations.sentences.length,
    headings: annotations.headings.length,
    headingPositives: annotations.headings.filter(item => item.label === 'positive').length,
    headingNegatives: annotations.headings.filter(item => item.label === 'negative').length,
    sectionRanges: annotations.sectionRanges.length
  };
  const realHumanAnnotations = annotations.provenance.annotationKind === 'human' &&
    annotations.provenance.humanReviewed && !annotations.provenance.containsSynthetic;
  if (!realHumanAnnotations && options.syntheticTestMode !== true) {
    return notReady('REAL_HUMAN_ANNOTATIONS_REQUIRED',
      'A versioned, human-reviewed, non-synthetic annotation corpus is required.',
      { counts, annotationDocumentCoverage });
  }
  const quotaReady = counts.documents >= PDF_SEMANTIC_CORPUS_THRESHOLDS.documents &&
    counts.sentences >= PDF_SEMANTIC_CORPUS_THRESHOLDS.sentences &&
    counts.headings >= PDF_SEMANTIC_CORPUS_THRESHOLDS.headings &&
    counts.headingPositives > 0 && counts.headingNegatives > 0 &&
    counts.sectionRanges >= PDF_SEMANTIC_CORPUS_THRESHOLDS.sectionRanges &&
    Object.values(annotationDocumentCoverage).every(count => count === counts.documents);
  if (!quotaReady) {
    return notReady('ANNOTATION_QUOTA_INCOMPLETE',
      'The human annotation corpus has not reached the release-gate quota or document coverage.',
      { counts, annotationDocumentCoverage });
  }
  if (!resultsInput) {
    return notReady('RESULTS_REQUIRED', 'A result bundle is required to score the corpus.',
      { counts, annotationDocumentCoverage });
  }
  if (resultsInput.schemaVersion !== RESULT_SCHEMA_VERSION) {
    fail('SCHEMA_VERSION_MISMATCH', `expected schemaVersion ${RESULT_SCHEMA_VERSION}`);
  }
  const results = normalizeResults(resultsInput, annotations);
  const resultMaps = {
    sentences: new Map(results.sentences.map(item => [item.annotationId, item])),
    headings: new Map(results.headings.map(item => [item.annotationId, item])),
    sectionRanges: new Map(results.sectionRanges.map(item => [item.annotationId, item]))
  };
  const expectedIds = {
    sentences: new Set(annotations.sentences.map(item => item.id)),
    headings: new Set(annotations.headings.map(item => item.id)),
    sectionRanges: new Set(annotations.sectionRanges.map(item => item.id))
  };
  for (const type of ['sentences', 'headings', 'sectionRanges']) {
    if ([...resultMaps[type].keys()].some(id => !expectedIds[type].has(id))) {
      fail('UNKNOWN_ANNOTATION', `${type} results include an unknown annotation id`);
    }
  }
  const coverage = {
    documents: ratio(new Set(results.performance.map(item => item.documentId)).size, counts.documents),
    sentences: ratio(annotations.sentences.filter(item => resultMaps.sentences.has(item.id)).length,
      counts.sentences),
    headings: ratio(annotations.headings.filter(item => resultMaps.headings.has(item.id)).length,
      counts.headings),
    sectionRanges: ratio(annotations.sectionRanges.filter(item =>
      resultMaps.sectionRanges.has(item.id)).length, counts.sectionRanges)
  };
  if (Object.values(coverage).some(value => value !== 1)) {
    return notReady('RESULT_COVERAGE_INCOMPLETE',
      'Every annotated target and document latency must have exactly one result.', { counts, coverage });
  }

  const documents = new Map(annotations.documents.map(item => [item.documentId, item]));
  let wrongDocumentCount = 0;
  let wrongPageCount = 0;
  let sentenceCorrect = 0;
  for (const expected of annotations.sentences) {
    const actual = resultMaps.sentences.get(expected.id);
    const expectedDocument = documents.get(expected.documentId);
    const documentCorrect = actual.documentId === expected.documentId &&
      actual.documentSha256 === expectedDocument.documentSha256;
    const pageCorrect = equalPages(actual.pageNumbers, expected.pageNumbers);
    if (!documentCorrect) wrongDocumentCount += 1;
    if (!pageCorrect) wrongPageCount += 1;
    if (documentCorrect && pageCorrect && actual.rawSha256 === expected.rawSha256 &&
        actual.normalizedSha256 === expected.normalizedSha256) sentenceCorrect += 1;
  }

  let headingTruePositive = 0;
  let headingFalsePositive = 0;
  let headingFalseNegative = 0;
  for (const expected of annotations.headings) {
    const actual = resultMaps.headings.get(expected.id);
    const expectedDocument = documents.get(expected.documentId);
    const documentCorrect = actual.documentId === expected.documentId &&
      actual.documentSha256 === expectedDocument.documentSha256;
    if (!documentCorrect) wrongDocumentCount += 1;
    const pageCorrect = !actual.predicted || actual.pageNumber === expected.pageNumber;
    const rawCorrect = !actual.predicted || actual.rawSha256 === expected.rawSha256;
    if (!pageCorrect) wrongPageCount += 1;
    if (expected.label === 'positive') {
      if (actual.predicted && documentCorrect && pageCorrect && rawCorrect) headingTruePositive += 1;
      else {
        headingFalseNegative += 1;
        if (actual.predicted) headingFalsePositive += 1;
      }
    } else if (actual.predicted) {
      headingFalsePositive += 1;
    }
  }

  let sectionRangeCorrect = 0;
  for (const expected of annotations.sectionRanges) {
    const actual = resultMaps.sectionRanges.get(expected.id);
    const expectedDocument = documents.get(expected.documentId);
    const documentCorrect = actual.documentId === expected.documentId &&
      actual.documentSha256 === expectedDocument.documentSha256;
    const pageCorrect = actual.start.pageNumber === expected.start.pageNumber &&
      actual.end.pageNumber === expected.end.pageNumber;
    if (!documentCorrect) wrongDocumentCount += 1;
    if (!pageCorrect) wrongPageCount += 1;
    if (documentCorrect && equalPoint(actual.start, expected.start) &&
        equalPoint(actual.end, expected.end)) sectionRangeCorrect += 1;
  }

  const metrics = {
    sentenceAccuracy: ratio(sentenceCorrect, counts.sentences),
    headingPrecision: ratio(headingTruePositive, headingTruePositive + headingFalsePositive),
    headingRecall: ratio(headingTruePositive, headingTruePositive + headingFalseNegative),
    sectionRangeAccuracy: ratio(sectionRangeCorrect, counts.sectionRanges),
    wrongDocumentCount,
    wrongPageCount
  };
  const checks = {
    sentenceAccuracy: metrics.sentenceAccuracy >= PDF_SEMANTIC_CORPUS_THRESHOLDS.sentenceAccuracy,
    headingPrecision: metrics.headingPrecision >= PDF_SEMANTIC_CORPUS_THRESHOLDS.headingPrecision,
    headingRecall: metrics.headingRecall >= PDF_SEMANTIC_CORPUS_THRESHOLDS.headingRecall,
    sectionRangesExact: metrics.sectionRangeAccuracy >=
      PDF_SEMANTIC_CORPUS_THRESHOLDS.sectionRangeAccuracy,
    noWrongDocument: metrics.wrongDocumentCount === 0,
    noWrongPage: metrics.wrongPageCount === 0
  };
  const testOnly = options.syntheticTestMode === true && !realHumanAnnotations;
  const pass = Object.values(checks).every(Boolean);
  return {
    schemaVersion: 1,
    status: testOnly ? (pass ? 'TEST_PASS' : 'TEST_FAIL') : (pass ? 'PASS' : 'FAIL'),
    eligibleForRelease: !testOnly && pass,
    corpusIdSha256: sha256(annotations.corpusId),
    counts, annotationDocumentCoverage, coverage, metrics, checks,
    latency: {
      cold: summarizeLatency(results.performance, 'coldMs'),
      hot: summarizeLatency(results.performance, 'hotMs')
    },
    thresholds: PDF_SEMANTIC_CORPUS_THRESHOLDS,
    privacy: { rawTextReported: false, absolutePathsReported: false },
    execution: { networkRequests: 0, inputFilesOnly: true },
    ...(testOnly ? { limitation: 'Synthetic fixtures validate the gate implementation only.' } : {})
  };
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
}

export function runPdfSemanticCorpusCli(argv = process.argv) {
  const previous = process.argv;
  process.argv = argv;
  try {
    const annotationPath = argument('--annotations');
    const resultPath = argument('--results');
    if (!annotationPath) {
      return notReady('ANNOTATIONS_REQUIRED',
        'Provide a versioned JSON or JSONL human annotation bundle with --annotations.');
    }
    let annotations;
    try {
      annotations = readVersionedCorpusFile(annotationPath, ANNOTATION_SCHEMA_VERSION);
    } catch (error) {
      if (['FILE_NOT_FOUND', 'INVALID_FILE_SIZE'].includes(error?.code)) {
        return notReady('ANNOTATIONS_UNAVAILABLE', error.message);
      }
      throw error;
    }
    if (!resultPath) return evaluatePdfSemanticCorpus(annotations, null);
    let results;
    try {
      results = readVersionedCorpusFile(resultPath, RESULT_SCHEMA_VERSION);
    } catch (error) {
      if (['FILE_NOT_FOUND', 'INVALID_FILE_SIZE'].includes(error?.code)) {
        return notReady('RESULTS_UNAVAILABLE', error.message);
      }
      throw error;
    }
    return evaluatePdfSemanticCorpus(annotations, results);
  } catch (error) {
    return {
      schemaVersion: 1,
      status: 'INVALID', eligibleForRelease: false,
      code: error?.code || 'INVALID_INPUT',
      reason: String(error?.message || error).slice(0, 240),
      thresholds: PDF_SEMANTIC_CORPUS_THRESHOLDS
    };
  } finally {
    process.argv = previous;
  }
}

export function pdfSemanticCorpusExitCode(report) {
  if (report?.status === 'PASS') return 0;
  if (report?.status === 'NOT_READY') return 2;
  return 1;
}

function isMainModule() {
  return process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
}

if (isMainModule()) {
  const report = runPdfSemanticCorpusCli(process.argv);
  fs.writeFileSync(process.stdout.fd, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.exit(pdfSemanticCorpusExitCode(report));
}
