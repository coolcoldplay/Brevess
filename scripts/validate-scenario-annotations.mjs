#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCandidateFreeze } from './benchmark-scenario-prompts.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const privateDir = path.join(repoRoot, 'tmp', 'scenario-corpus-v1');
const corpusRoot = path.resolve(process.env.ZOTERO_MINERU_ROOT || path.join(
  os.homedir(), 'Zotero', 'llm-for-zotero-mineru'
));
const allowedSplits = new Set(['development', 'validation', 'locked_test']);
const categoryIds = Object.freeze([
  'known_background', 'scientific_question', 'method', 'result', 'interpretation',
  'limitation', 'significance_novelty', 'future', 'necessity_evidence',
  'sufficiency_evidence', 'rescue_evidence', 'design_control', 'review_question',
  'review_scope_thesis', 'evidence_consensus', 'conflicting_evidence',
  'evidence_quality_certainty'
]);
const categorySet = new Set(categoryIds);

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function readJsonl(file) {
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); } catch (error) {
      throw new Error(`${file}:${index + 1}: invalid JSON: ${error.message}`);
    }
  });
}

function parseArgs(argv) {
  const splitIndex = argv.indexOf('--split');
  const split = splitIndex >= 0 ? argv[splitIndex + 1] : '';
  if (!allowedSplits.has(split)) {
    throw new Error('Use --split development, validation, or locked_test.');
  }
  return { split, writeReport: argv.includes('--write-report') };
}

export function validateFreezeGate() {
  const freezeFile = path.join(privateDir, 'candidate-freeze.json');
  assert(fs.existsSync(freezeFile), 'locked_test gate closed: candidate-freeze.json is missing');
  const freezeText = fs.readFileSync(freezeFile, 'utf8');
  const freeze = JSON.parse(freezeText);
  const candidateGate = validateCandidateFreeze({
    split: 'locked_test',
    freezePath: freezeFile,
    rootDir: repoRoot,
    compatibilityPath: path.join(repoRoot, 'benchmarks', 'scenarios-v1', 'default-compatibility.json')
  });
  assert(freeze.rubricVersion === 'scenario-v1-20260908',
    'locked_test gate closed: frozen rubric version is invalid');
  assert(typeof freeze.frozenAt === 'string' && Number.isFinite(Date.parse(freeze.frozenAt)),
    'locked_test gate closed: frozenAt is invalid');
  assert(typeof freeze.candidate === 'string' && freeze.candidate.trim(),
    'locked_test gate closed: candidate identifier is missing');
  assert(freeze.sourceHashes && typeof freeze.sourceHashes === 'object' &&
    Object.keys(freeze.sourceHashes).length >= 3,
  'locked_test gate closed: a multi-file source freeze is required');
  assert(freeze.sourceHashes['core/prompt-compiler.js'] === freeze.promptSha256,
    'locked_test gate closed: prompt SHA does not match the frozen prompt-compiler SHA');
  assert(candidateGate.freezeSha256 === sha256(freezeText),
    'locked_test gate closed: candidate gate validated a different freeze');
  const developmentAnnotations = path.join(privateDir, 'development.annotations.jsonl');
  assert(fs.existsSync(developmentAnnotations),
    'locked_test gate closed: frozen development reference is missing');
  assert(sha256(fs.readFileSync(developmentAnnotations)) === freeze.referenceDevelopmentSha256,
    'locked_test gate closed: development reference differs from the frozen hash');
  return {
    freezeFile: 'tmp/scenario-corpus-v1/candidate-freeze.json',
    freezeSha256: sha256(freezeText),
    frozenAt: freeze.frozenAt,
    candidate: freeze.candidate,
    promptSha256: freeze.promptSha256,
    rubricVersion: freeze.rubricVersion,
    sourceHashes: freeze.sourceHashes,
    referenceDevelopmentSha256: freeze.referenceDevelopmentSha256,
    currentSourceHashes: candidateGate.compatibilitySourceHashes || candidateGate.sourceHashes,
    defaultCompatibilitySha256: candidateGate.defaultCompatibilitySha256,
    derivedFromFrozenDefaults: candidateGate.derivedFromFrozenDefaults
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function validateSourceRecord(record) {
  const sourceFile = path.join(corpusRoot, record.source.markdownPath);
  assert(fs.existsSync(sourceFile), `${record.recordId}: source markdown missing`);
  const source = fs.readFileSync(sourceFile, 'utf8');
  assert(sha256(source) === record.source.markdownSha256,
    `${record.recordId}: source markdown hash mismatch`);
  assert(source.slice(record.window.startOffset, record.window.endOffset) === record.window.text,
    `${record.recordId}: window offsets do not reproduce exact source text`);
  assert(sha256(record.window.text) === record.window.sha256,
    `${record.recordId}: window text hash mismatch`);
  for (const paragraph of record.window.paragraphs) {
    assert(source.slice(paragraph.startOffset, paragraph.endOffset) === paragraph.text,
      `${record.recordId}/${paragraph.paragraphId}: source offsets do not reproduce paragraph`);
    assert(sha256(paragraph.text) === paragraph.sha256,
      `${record.recordId}/${paragraph.paragraphId}: paragraph hash mismatch`);
  }
}

export function validateSplit(split) {
  if (!allowedSplits.has(split)) throw new Error(`Disallowed split: ${split}`);
  const freezeGate = split === 'locked_test' ? validateFreezeGate() : null;
  const corpusFile = path.join(privateDir, `${split}.jsonl`);
  const annotationFile = path.join(privateDir, `${split}.annotations.jsonl`);
  assert(fs.existsSync(corpusFile), `Missing corpus file: ${corpusFile}`);
  assert(fs.existsSync(annotationFile), `Missing annotation file: ${annotationFile}`);
  const records = readJsonl(corpusFile);
  const annotations = readJsonl(annotationFile);
  let independentReview = null;
  let independentReviewSha256 = '';
  if (split === 'development') {
    const reviewFile = path.join(privateDir, 'development-independent-review.json');
    assert(fs.existsSync(reviewFile), `Missing independent review file: ${reviewFile}`);
    const reviewText = fs.readFileSync(reviewFile, 'utf8');
    independentReview = JSON.parse(reviewText);
    independentReviewSha256 = sha256(reviewText);
  }
  const annotationById = new Map();
  for (const annotation of annotations) {
    assert(!annotationById.has(annotation.recordId), `Duplicate annotation: ${annotation.recordId}`);
    annotationById.set(annotation.recordId, annotation);
  }
  assert(annotations.length === records.length,
    `${split}: expected ${records.length} annotations, found ${annotations.length}`);

  const labelCounts = Object.fromEntries(categoryIds.map(categoryId => [categoryId, 0]));
  let abstentionCount = 0;
  let reviewedParagraphCount = 0;
  let labeledWindows = 0;
  let rowsWithReviewProvenance = 0;
  let revisionLogEntries = 0;
  let pendingHumanReviewSuggestions = 0;
  const pendingSuggestionKeys = new Set();
  const seenRecords = new Set();

  for (const record of records) {
    validateSourceRecord(record);
    const annotation = annotationById.get(record.recordId);
    assert(annotation, `${record.recordId}: annotation missing`);
    seenRecords.add(record.recordId);
    assert(annotation.annotationStatus === 'assistant_annotated_silver',
      `${record.recordId}: incorrect annotationStatus`);
    assert(annotation.annotator === 'gpt-5.6-sol/high', `${record.recordId}: incorrect annotator`);
    assert(annotation.rubricVersion === 'scenario-v1-20260908',
      `${record.recordId}: incorrect rubricVersion`);
    if (split === 'locked_test') {
      const provenance = annotation.freezeProvenance;
      assert(provenance && typeof provenance === 'object',
        `${record.recordId}: freezeProvenance missing`);
      assert(provenance.freezeFile === freezeGate.freezeFile &&
        provenance.freezeSha256 === freezeGate.freezeSha256 &&
        provenance.frozenAt === freezeGate.frozenAt &&
        provenance.candidate === freezeGate.candidate &&
        provenance.promptSha256 === freezeGate.promptSha256 &&
        provenance.rubricVersion === freezeGate.rubricVersion,
      `${record.recordId}: freezeProvenance does not match the validated gate`);
      assert(provenance.blindAnnotation === true &&
        provenance.providerPredictionsRead === false,
      `${record.recordId}: blind-annotation provenance is invalid`);
    }
    const paragraphIds = record.window.paragraphs.map(paragraph => paragraph.paragraphId);
    assert(JSON.stringify(annotation.reviewedParagraphIds) === JSON.stringify(paragraphIds),
      `${record.recordId}: reviewedParagraphIds must exactly cover the window in source order`);
    reviewedParagraphCount += paragraphIds.length;
    const paragraphById = new Map(record.window.paragraphs.map(paragraph => [paragraph.paragraphId, paragraph]));
    const duplicateLabels = new Set();
    for (const label of annotation.labels) {
      assert(categorySet.has(label.categoryId),
        `${record.recordId}: unknown category ${label.categoryId}`);
      const paragraph = paragraphById.get(label.paragraphId);
      assert(paragraph, `${record.recordId}: label paragraph is outside the window`);
      assert(Number.isInteger(label.start) && Number.isInteger(label.end) &&
        label.start >= 0 && label.end > label.start && label.end <= paragraph.text.length,
      `${record.recordId}/${label.paragraphId}: invalid UTF-16 offsets`);
      assert(paragraph.text.slice(label.start, label.end) === label.quote,
        `${record.recordId}/${label.paragraphId}: quote does not equal text.slice(start,end)`);
      assert(label.quote.trim() === label.quote && label.quote.length >= 8,
        `${record.recordId}/${label.paragraphId}: quote must be a nontrivial trimmed span`);
      assert(typeof label.rationale === 'string' && label.rationale.trim().length >= 20,
        `${record.recordId}/${label.paragraphId}: rationale is missing or too short`);
      assert(label.ambiguity === false,
        `${record.recordId}/${label.paragraphId}: ambiguous decisions belong in abstentions`);
      const duplicateKey = `${label.paragraphId}|${label.categoryId}|${label.start}|${label.end}`;
      assert(!duplicateLabels.has(duplicateKey), `${record.recordId}: duplicate label ${duplicateKey}`);
      duplicateLabels.add(duplicateKey);
      labelCounts[label.categoryId] += 1;
    }
    if (split === 'development') {
      const provenance = annotation.reviewProvenance;
      assert(provenance && typeof provenance === 'object',
        `${record.recordId}: independent-review provenance missing`);
      assert(provenance.reviewFile === 'tmp/scenario-corpus-v1/development-independent-review.json',
        `${record.recordId}: incorrect independent-review path`);
      assert(provenance.reviewSha256 === independentReviewSha256,
        `${record.recordId}: independent-review hash mismatch`);
      assert(provenance.reviewer === independentReview.reviewer &&
        provenance.reviewedAt === independentReview.reviewedAt &&
        provenance.reviewStatus === independentReview.reviewStatus,
      `${record.recordId}: independent-review identity/status mismatch`);
      rowsWithReviewProvenance += 1;
      assert(Array.isArray(annotation.revisionLog), `${record.recordId}: revisionLog missing`);
      assert(Array.isArray(annotation.pendingHumanReview),
        `${record.recordId}: pendingHumanReview missing`);
      for (const revision of annotation.revisionLog) {
        const paragraph = paragraphById.get(revision.paragraphId);
        assert(paragraph, `${record.recordId}: revision paragraph is outside the window`);
        assert(categorySet.has(revision.categoryId),
          `${record.recordId}: revision uses unknown category ${revision.categoryId}`);
        if (revision.oldSpan) {
          assert(Number.isInteger(revision.oldSpan.start) && Number.isInteger(revision.oldSpan.end),
            `${record.recordId}: invalid old revision span`);
          const oldStillScored = annotation.labels.some(label =>
            label.paragraphId === revision.paragraphId &&
            label.categoryId === revision.categoryId &&
            label.start === revision.oldSpan.start && label.end === revision.oldSpan.end);
          assert(!oldStillScored, `${record.recordId}: superseded span remains in scoring labels`);
        }
        if (revision.newSpan) {
          const newIsScored = annotation.labels.some(label =>
            label.paragraphId === revision.paragraphId &&
            label.categoryId === revision.categoryId &&
            label.start === revision.newSpan.start && label.end === revision.newSpan.end);
          assert(newIsScored, `${record.recordId}: revised/added span is absent from scoring labels`);
        }
        if (revision.action === 'remove_label_to_abstention') {
          assert(annotation.abstentions.some(item => item.paragraphId === revision.paragraphId),
            `${record.recordId}: removed ambiguous label has no abstention record`);
        }
        revisionLogEntries += 1;
      }
      for (const suggestion of annotation.pendingHumanReview) {
        assert(suggestion.status === 'pending_human_review_excluded_from_scoring',
          `${record.recordId}: pending suggestion has incorrect status`);
        const paragraph = paragraphById.get(suggestion.paragraphId);
        assert(paragraph, `${record.recordId}: pending suggestion paragraph is outside the window`);
        assert(paragraph.text.slice(suggestion.start, suggestion.end) === suggestion.quote,
          `${record.recordId}: pending suggestion quote offsets are invalid`);
        const isScored = annotation.labels.some(label =>
          label.paragraphId === suggestion.paragraphId &&
          label.categoryId === suggestion.categoryId &&
          label.start === suggestion.start && label.end === suggestion.end);
        assert(!isScored, `${record.recordId}: pending suggestion leaked into scoring labels`);
        const key = `${record.recordId}|${suggestion.paragraphId}|${suggestion.categoryId}|${suggestion.start}|${suggestion.end}`;
        assert(!pendingSuggestionKeys.has(key), `${record.recordId}: duplicate pending suggestion`);
        pendingSuggestionKeys.add(key);
        pendingHumanReviewSuggestions += 1;
      }
    }
    if (annotation.labels.length) labeledWindows += 1;
    for (const abstention of annotation.abstentions) {
      assert(paragraphById.has(abstention.paragraphId),
        `${record.recordId}: abstention paragraph is outside the window`);
      assert(typeof abstention.reason === 'string' && abstention.reason.trim().length >= 20,
        `${record.recordId}/${abstention.paragraphId}: abstention reason is missing or too short`);
      abstentionCount += 1;
    }
  }
  assert(seenRecords.size === annotationById.size, `${split}: annotation contains unknown record IDs`);
  if (split === 'development') {
    assert(rowsWithReviewProvenance === records.length,
      'development: not every row preserves independent-review provenance');
    assert(revisionLogEntries === 5,
      `development: expected 5 adjudicated revision-log entries, found ${revisionLogEntries}`);
    assert(pendingHumanReviewSuggestions === 4,
      `development: expected 4 pending human-review suggestions, found ${pendingHumanReviewSuggestions}`);
    const acceptedKey = 'scenario-2741fd479edce41a3a38|attachment-22566:p0020|design_control|393|476';
    const acceptedPresent = annotations.some(annotation => annotation.labels.some(label =>
      `${annotation.recordId}|${label.paragraphId}|${label.categoryId}|${label.start}|${label.end}` === acceptedKey));
    assert(acceptedPresent, 'development: accepted sham-plus-PBS design control is missing');
  }

  return {
    reportType: 'assistant_silver_annotation_validation',
    split,
    rubricVersion: 'scenario-v1-20260908',
    goldStandardClaimed: false,
    sourceVerification: {
      corpusRecordsChecked: records.length,
      sourceMarkdownHashesChecked: records.length,
      exactWindowsChecked: records.length,
      exactParagraphsChecked: records.reduce((sum, record) => sum + record.window.paragraphs.length, 0),
      quoteOffsetsChecked: Object.values(labelCounts).reduce((sum, count) => sum + count, 0)
    },
    coverage: {
      corpusWindows: records.length,
      annotationRows: annotations.length,
      fullyReviewedWindows: records.length,
      labeledWindows,
      emptyLabelWindows: records.length - labeledWindows,
      reviewedParagraphs: reviewedParagraphCount,
      expectedParagraphs: records.reduce((sum, record) => sum + record.window.paragraphs.length, 0)
    },
    labels: {
      total: Object.values(labelCounts).reduce((sum, count) => sum + count, 0),
      byCategory: labelCounts
    },
    abstentions: { total: abstentionCount },
    independentReview: split === 'development' ? {
      reviewSha256: independentReviewSha256,
      rowsWithProvenance: rowsWithReviewProvenance,
      revisionLogEntries,
      acceptedProposedAdditions: 1,
      pendingHumanReviewSuggestions,
      pendingSuggestionsExcludedFromScoring: true
    } : null,
    freezeGate: split === 'locked_test' ? freezeGate : null,
    disclaimer: 'Assistant-annotated silver reference set; it is not human gold and no accuracy claim is made.'
  };
}

export function main(argv = process.argv.slice(2)) {
  const { split, writeReport } = parseArgs(argv);
  const report = validateSplit(split);
  if (writeReport) {
    const reportFile = path.join(privateDir, `${split}.annotation-report.json`);
    fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    report.reportFile = reportFile;
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
