#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
process.chdir(repoRoot);
require('../core/category-store.js');
const { createUnifiedCategoryCatalog } = require('../core/adaptive-catalog.js');
const {
  VIEW_VISIBILITY_OVERRIDES,
  STUDY_VIEW_RECOMMENDATIONS,
  categoryVisibleAtDensity
} = require('../core/highlight-presentation.js');

const FORMAT_VERSION = 1;
const SPLIT_SEED = 'brevess-checkpoint2-cluster-split-20260808';
const CORPUS_ROOT = path.resolve(process.env.ZOTERO_MINERU_ROOT || path.join(
  os.homedir(), 'Zotero', 'llm-for-zotero-mineru'
));
const ZOTERO_STORAGE_ROOT = path.resolve(process.env.ZOTERO_STORAGE_ROOT || path.join(
  os.homedir(), 'Zotero', 'storage'
));
const OUT = path.join(repoRoot, 'benchmarks', 'checkpoint2');
const ASSET_DIR = path.join(OUT, 'review-assets', 'figures');
const HIGH_RISK = Object.freeze([
  'causal_effect',
  'mechanism_mediator',
  'necessity_evidence',
  'sufficiency_evidence',
  'rescue_evidence',
  'confounding_reverse_causality',
  'causal_overreach',
  'alternative_explanation',
  'evidence_consensus',
  'conflicting_evidence',
  'heterogeneity_source',
  'replication_external_validation'
]);
const ACTIVE_SECTIONS = new Set([
  'abstract', 'introduction', 'results', 'discussion', 'conclusion'
]);
const SECTION_RULES = [
  ['abstract', /^(?:abstract|summary|highlights?|key points?|research in context)$/i],
  ['introduction', /^(?:introduction|background|context)$/i],
  ['results', /^(?:results?|findings?)$/i],
  ['discussion', /^(?:discussion|general discussion)$/i],
  ['conclusion', /^(?:conclusions?|concluding remarks?|summary and conclusions?)$/i],
  ['methods', /^(?:methods?|materials? and methods?|methods? and materials?|experimental procedures?|patients? and methods?|subjects? and methods?|study design|statistical analysis|star[★*]methods)$/i],
  ['references', /^(?:references|bibliography|literature cited)$/i],
  ['utility', /^(?:acknowledg(?:e)?ments?|author information|author contributions?|funding|conflicts? of interest|competing interests?|ethics declarations?|declarations?|data availability|code availability|resource availability|additional information|supplementary information|supplemental information|extended data|supporting information|appendix|appendices)$/i]
];
const STRUCTURED_LABEL_CATEGORY = Object.freeze({
  OBJECTIVE: 'objective', AIM: 'objective', PURPOSE: 'objective',
  DESIGN: 'method', 'DESIGN, SETTING, AND PARTICIPANTS': 'method',
  'DESIGN AND PARTICIPANTS': 'method', SETTING: 'method', PARTICIPANTS: 'method',
  INTERVENTION: 'method', INTERVENTIONS: 'method', EXPOSURE: 'method',
  EXPOSURES: 'method', 'MAIN OUTCOMES AND MEASURES': 'method',
  METHODS: 'method', METHOD: 'method', RESULTS: 'result', RESULT: 'result',
  CONCLUSION: 'conclusion', CONCLUSIONS: 'conclusion',
  'CONCLUSIONS AND RELEVANCE': 'conclusion', LIMITATIONS: 'limitation',
  LIMITATION: 'limitation'
});
const BARE_STRUCTURED_LABEL_PATTERN = new RegExp(
  `^(${Object.keys(STRUCTURED_LABEL_CATEGORY)
    .sort((left, right) => right.length - left.length)
    .map(escapeRegex).join('|')})\\s*[:.]?$`, 'i'
);
const REVIEW_FIELDS = Object.freeze({
  decision: '', correctedCategory: '', contextInsufficient: false,
  quoteStart: null, quoteEnd: null, quote: '', reviewerNote: ''
});
const FIGURE_REVIEW_FIELDS = Object.freeze({
  panelLabels: [], captionPairing: '', groups: [], comparisons: [], methods: [],
  directObservations: [], evidenceLevel: '', unsupportedConclusions: [], reviewerNote: ''
});
const SENTENCE_SEGMENTER = typeof Intl?.Segmenter === 'function'
  ? new Intl.Segmenter('en', { granularity: 'sentence' }) : null;

if (!fs.existsSync(CORPUS_ROOT)) {
  throw new Error(`MinerU corpus not found: ${CORPUS_ROOT}`);
}
fs.mkdirSync(ASSET_DIR, { recursive: true });

const catalog = createUnifiedCategoryCatalog();
const matchers = Object.values(catalog)
  .filter(category => category.categoryId !== 'semantic_match')
  .map(compileCategory);
const matcherById = new Map(matchers.map(item => [item.categoryId, item]));
const documentDirs = fs.readdirSync(CORPUS_ROOT, { withFileTypes: true })
  .filter(entry => entry.isDirectory() && fs.existsSync(path.join(
    CORPUS_ROOT, entry.name, 'full.md'
  )))
  .map(entry => entry.name)
  .sort((left, right) => left.localeCompare(right, 'en', { numeric: true }));

const documents = [];
const parsedById = new Map();
let parsedDirectoryCount = 0;
for (const directory of documentDirs) {
  const directoryPath = path.join(CORPUS_ROOT, directory);
  const markdownPath = path.join(directoryPath, 'full.md');
  const markdown = fs.readFileSync(markdownPath, 'utf8');
  const parsed = parseMarkdown(markdown);
  const source = readJson(path.join(directoryPath, '_llm_source.json')) || {};
  const manifest = readJson(path.join(directoryPath, 'manifest.json')) || {};
  const title = extractTitle(markdown, source.sourceFilename);
  const normalizedTitle = normalizeTitle(title);
  const identifiers = extractIdentifiers(markdown);
  const pdf = resolveSourcePdf(source);
  const figureEntries = extractFigureEntries(manifest, directoryPath);
  const document = {
    documentId: `attachment-${String(source.attachmentId || directory)}`,
    attachmentId: Number(source.attachmentId) || Number(directory) || null,
    attachmentKey: String(source.attachmentKey || ''),
    parentItemKey: String(source.parentItemKey || ''),
    sourceFilename: String(source.sourceFilename || ''),
    mineruDirectory: directory,
    markdownPath: `${directory}/full.md`,
    markdownSha256: sha(markdown),
    normalizedTextSha256: sha(normalizeFullText(markdown)),
    title,
    normalizedTitle,
    doi: identifiers.doi,
    pmid: identifiers.pmid,
    pmcid: identifiers.pmcid,
    publicationYear: extractYear(markdown, source.sourceFilename),
    firstAuthor: extractFirstAuthor(markdown, source.sourceFilename),
    articleLike: parsed.isArticleLike,
    studyType: inferStudyType(title, parsed.sentences.slice(0, 120).map(item => item.text).join(' ')),
    quality: {
      characters: markdown.length,
      words: wordCount(markdown),
      paragraphs: parsed.paragraphs.length,
      sentences: parsed.sentences.length,
      activeSentences: parsed.sentences.filter(item => ACTIVE_SECTIONS.has(item.sectionKind)).length,
      scientificSectionKinds: [...parsed.sectionKinds].sort(),
      headingCount: parsed.headingCount,
      imageReferenceCount: (markdown.match(/!\[[^\]]*]\([^)]+\)/g) || []).length,
      extractedFigureCount: figureEntries.length,
      sourcePdfAvailable: Boolean(pdf.path),
      sourcePdfBytes: pdf.bytes,
      qualityScore: qualityScore(parsed, markdown, figureEntries, pdf),
      flags: qualityFlags(parsed, markdown, figureEntries, pdf)
    },
    sourcePdf: pdf.path ? {
      aliasPath: `$ZOTERO_STORAGE/${source.attachmentKey}/${path.basename(pdf.path)}`,
      bytes: pdf.bytes,
      sha256: null
    } : null,
    figureEntries
  };
  documents.push(document);
  parsedById.set(document.documentId, parsed);
  parsedDirectoryCount += 1;
  if (parsedDirectoryCount % 100 === 0 || parsedDirectoryCount === documentDirs.length) {
    console.error(`metadata:${parsedDirectoryCount}/${documentDirs.length}`);
  }
}

const articleDocuments = documents.filter(item => item.articleLike);
if (process.argv.includes('--parse-only')) {
  console.log(JSON.stringify({
    discoveredDocuments: documents.length,
    articleDocuments: articleDocuments.length,
    activeSentences: articleDocuments.reduce(
      (sum, item) => sum + Number(item.quality.activeSentences || 0), 0
    )
  }, null, 2));
  process.exit(0);
}
console.error(`dedup:start:${articleDocuments.length}`);
const pairingCandidates = discoverDuplicatePairs(articleDocuments);
hashDuplicatePdfGroups(pairingCandidates, articleDocuments);
const clusters = buildClusters(articleDocuments, pairingCandidates);
console.error(`dedup:done:${clusters.length}`);
const clusterByDocument = new Map();
clusters.forEach(cluster => cluster.documentIds.forEach(documentId => {
  clusterByDocument.set(documentId, cluster.clusterId);
}));
articleDocuments.forEach(document => {
  document.clusterId = clusterByDocument.get(document.documentId);
});
const split = buildSplit(clusters, articleDocuments);
const splitByCluster = new Map(split.clusters.map(item => [item.clusterId, item.split]));
articleDocuments.forEach(document => {
  document.split = splitByCluster.get(document.clusterId);
});
clusters.forEach(cluster => { cluster.split = splitByCluster.get(cluster.clusterId); });

const analysis = analyzeCorpus(articleDocuments, parsedById);
const reviewQueue = buildReviewQueue(analysis.reviewCandidates, articleDocuments);
const figureQueue = buildFigureQueue(articleDocuments);

writeJsonl('corpus-manifest.jsonl', documents.map(publicDocumentManifest));
writeJson('duplicate-clusters.json', {
  formatVersion: FORMAT_VERSION,
  generatedAt: new Date().toISOString(),
  corpusRoot: '$ZOTERO_MINERU_ROOT',
  articleDocumentCount: articleDocuments.length,
  clusterCount: clusters.length,
  duplicateClusterCount: clusters.filter(item => item.documentIds.length > 1).length,
  clusters
});
writeCsv('pairing-report.csv', [
  'left_document_id', 'right_document_id', 'same_cluster', 'confidence', 'reasons',
  'title_similarity', 'exact_pdf_sha256', 'normalized_text_sha256', 'doi', 'pmid',
  'parent_item_key'
], pairingCandidates.map(pair => ({
  left_document_id: pair.leftId,
  right_document_id: pair.rightId,
  same_cluster: clusterByDocument.get(pair.leftId) === clusterByDocument.get(pair.rightId),
  confidence: pair.confidence,
  reasons: pair.reasons.join('|'),
  title_similarity: pair.titleSimilarity,
  exact_pdf_sha256: pair.exactPdfSha256 || '',
  normalized_text_sha256: pair.normalizedTextSha256 || '',
  doi: pair.doi || '', pmid: pair.pmid || '', parent_item_key: pair.parentItemKey || ''
})));
writeCsv('quality-report.csv', [
  'document_id', 'cluster_id', 'split', 'article_like', 'study_type', 'title',
  'characters', 'words', 'paragraphs', 'sentences', 'active_sentences',
  'heading_count', 'image_reference_count', 'extracted_figure_count',
  'source_pdf_available', 'source_pdf_bytes', 'quality_score', 'quality_flags'
], documents.map(document => ({
  document_id: document.documentId,
  cluster_id: document.clusterId || '',
  split: document.split || '',
  article_like: document.articleLike,
  study_type: document.studyType,
  title: document.title,
  characters: document.quality.characters,
  words: document.quality.words,
  paragraphs: document.quality.paragraphs,
  sentences: document.quality.sentences,
  active_sentences: document.quality.activeSentences,
  heading_count: document.quality.headingCount,
  image_reference_count: document.quality.imageReferenceCount,
  extracted_figure_count: document.quality.extractedFigureCount,
  source_pdf_available: document.quality.sourcePdfAvailable,
  source_pdf_bytes: document.quality.sourcePdfBytes,
  quality_score: document.quality.qualityScore,
  quality_flags: document.quality.flags.join('|')
})));
const splitManifest = {
  formatVersion: FORMAT_VERSION,
  seed: SPLIT_SEED,
  unit: 'document_cluster',
  policy: {
    targetRatios: { development: 0.7, validation: 0.15, locked_test: 0.15 },
    clusterIntegrity: 'All versions and attachments in one cluster share one split.',
    promptDevelopmentVisibility: ['development', 'validation'],
    lockedTestLabelsVisibleDuringPromptDevelopment: false
  },
  counts: split.counts,
  clusters: split.clusters
};
const splitText = stableJson(splitManifest);
fs.writeFileSync(path.join(OUT, 'split-manifest.json'), splitText, 'utf8');
fs.writeFileSync(path.join(OUT, 'split-manifest.lock'), stableJson({
  algorithm: 'sha256', bytes: Buffer.byteLength(splitText), sha256: sha(splitText),
  seed: SPLIT_SEED
}), 'utf8');
writeJson('human-review-queue.json', reviewQueue);
writeJson('figure-review-queue.json', figureQueue);
writeJson('conflict-analysis.json', analysis.conflicts);
writeCsv('Checkpoint2_Conflict_Analysis.csv', [
  'rank', 'category_left', 'category_right', 'count', 'per_1000_active_sentences',
  'audit_classification', 'classification_reason', 'example_document_id',
  'example_cluster_id', 'example_split', 'example_study_type', 'example_section',
  'example_text', 'suggested_action'
], analysis.conflicts.topPairs.flatMap(pair => pair.examples.map((example, index) => ({
  rank: pair.rank,
  category_left: pair.left,
  category_right: pair.right,
  count: pair.count,
  per_1000_active_sentences: pair.per1000ActiveSentences,
  audit_classification: pair.auditClassification,
  classification_reason: pair.classificationReason,
  example_document_id: example.documentId,
  example_cluster_id: example.clusterId,
  example_split: example.split,
  example_study_type: example.studyType,
  example_section: example.sectionKind,
  example_text: example.text,
  suggested_action: pair.suggestedAction,
  example_index: index + 1
}))));

const report = buildCorpusReport(documents, articleDocuments, clusters, pairingCandidates,
  splitManifest, analysis, reviewQueue, figureQueue);
fs.writeFileSync(path.join(OUT, 'Checkpoint2_Corpus_And_Split_Report.md'), report, 'utf8');
console.log(JSON.stringify({
  outputDirectory: OUT,
  discoveredDocuments: documents.length,
  articleDocuments: articleDocuments.length,
  clusters: clusters.length,
  duplicateClusters: clusters.filter(item => item.documentIds.length > 1).length,
  splitCounts: split.counts,
  activeSentences: analysis.conflicts.denominatorActiveSentences,
  collisions: analysis.conflicts.totalActiveConflictSentences,
  collisionRatePer1000: analysis.conflicts.activeConflictRatePer1000,
  reviewQueueItems: reviewQueue.items.length,
  figureQueueItems: figureQueue.items.length
}, null, 2));

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function sha(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
}

function stableJson(value) {
  return `${JSON.stringify(stableValue(value), null, 2)}\n`;
}

function writeJson(name, value) {
  fs.writeFileSync(path.join(OUT, name), stableJson(value), 'utf8');
}

function writeJsonl(name, values) {
  const text = values.map(value => JSON.stringify(stableValue(value))).join('\n') + '\n';
  fs.writeFileSync(path.join(OUT, name), text, 'utf8');
}

function csvCell(value) {
  const text = Array.isArray(value) ? value.join('|') : String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function writeCsv(name, headers, rows) {
  const lines = [headers.join(',')];
  rows.forEach(row => lines.push(headers.map(header => csvCell(row[header])).join(',')));
  fs.writeFileSync(path.join(OUT, name), `${lines.join('\n')}\n`, 'utf8');
}

function normalizeFullText(value) {
  return String(value || '').normalize('NFKC').toLowerCase()
    .replace(/!\[[^\]]*]\([^)]+\)/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\b(?:copyright|all rights reserved)\b[^\n]*/gi, ' ')
    .replace(/\s+/g, ' ').trim();
}

function extractTitle(markdown, filename) {
  const heading = String(markdown || '').match(/^#\s+(.{8,500})$/m)?.[1];
  if (heading) return cleanText(heading).slice(0, 500);
  return String(filename || '')
    .replace(/\.pdf$/i, '')
    .replace(/^.+?\s+-\s+\d{4}\s+-\s+/, '')
    .trim().slice(0, 500);
}

function normalizeTitle(value) {
  return cleanText(value).toLowerCase()
    .replace(/\b(?:preprint|accepted manuscript|author manuscript|supplementary material)\b/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ').trim();
}

function cleanText(value) {
  return String(value || '').normalize('NFKC')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ').trim();
}

function extractIdentifiers(markdown) {
  const head = String(markdown || '').slice(0, 30000);
  const doi = head.match(/\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+\b/i)?.[0]
    ?.replace(/[.,;:)\]]+$/, '').toLowerCase() || '';
  const pmcid = head.match(/\bPMC\d{4,12}\b/i)?.[0]?.toUpperCase() || '';
  const pmid = head.match(/\bPMID\s*[:#]?\s*(\d{5,12})\b/i)?.[1] || '';
  return { doi, pmid, pmcid };
}

function extractYear(markdown, filename) {
  const source = `${String(markdown || '').slice(0, 6000)} ${filename || ''}`;
  const values = [...source.matchAll(/\b(?:19|20)\d{2}\b/g)]
    .map(match => Number(match[0])).filter(year => year >= 1900 && year <= 2026);
  return values[0] || null;
}

function extractFirstAuthor(markdown, filename) {
  const lines = String(markdown || '').split(/\r?\n/).slice(0, 20);
  const headingIndex = lines.findIndex(line => /^#\s+/.test(line));
  const after = lines.slice(Math.max(0, headingIndex + 1)).find(line => {
    const text = cleanText(line);
    return text.length >= 4 && text.length <= 500 && !/^(?:abstract|importance|objective)\b/i.test(text);
  });
  const source = after || String(filename || '').split(/\s+-\s+/)[0] || '';
  return cleanText(source).split(/[,;]|\band\b/i)[0].slice(0, 120);
}

function resolveSourcePdf(source) {
  const key = String(source.attachmentKey || '');
  if (!key) return { path: '', bytes: 0 };
  const directory = path.join(ZOTERO_STORAGE_ROOT, key);
  if (!fs.existsSync(directory)) return { path: '', bytes: 0 };
  const preferred = path.join(directory, String(source.sourceFilename || ''));
  const candidate = fs.existsSync(preferred) ? preferred : fs.readdirSync(directory)
    .filter(name => /\.pdf$/i.test(name)).map(name => path.join(directory, name))[0];
  if (!candidate || !fs.existsSync(candidate)) return { path: '', bytes: 0 };
  return { path: candidate, bytes: fs.statSync(candidate).size };
}

function hashFile(file) {
  const hash = crypto.createHash('sha256');
  const descriptor = fs.openSync(file, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let count;
    while ((count = fs.readSync(descriptor, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, count));
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest('hex');
}

function parseMarkdown(markdown) {
  const source = String(markdown || '').normalize('NFKC')
    .replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '');
  const lines = source.split('\n');
  const paragraphs = [];
  const sectionKinds = new Set();
  let sectionKind = 'front';
  let pendingStructuredLabel = '';
  let buffer = [];
  let headingCount = 0;
  let inFence = false;
  let frontMatter = lines[0]?.trim() === '---';
  function flush() {
    const raw = buffer.join(' ').replace(/\s+/g, ' ').trim();
    buffer = [];
    if (!raw) return;
    const cleaned = cleanMarkdownText(raw);
    if (!cleaned || cleaned.length < 12 || isNoise(cleaned)) return;
    const text = pendingStructuredLabel
      ? `${pendingStructuredLabel}: ${cleaned}` : cleaned;
    pendingStructuredLabel = '';
    paragraphs.push({ sectionKind, text });
  }
  lines.forEach((lineValue, index) => {
    const line = lineValue.trim();
    if (frontMatter) {
      if (index > 0 && line === '---') frontMatter = false;
      return;
    }
    if (/^```/.test(line)) { flush(); inFence = !inFence; return; }
    if (inFence) return;
    if (!line) { flush(); return; }
    if (/^(?:!\[[^\]]*]\([^)]+\)|<img\b[^>]*>)$/i.test(line) ||
        /^\|.*\|$/.test(line) || /^[-:| ]{5,}$/.test(line)) {
      flush(); return;
    }
    const heading = line.match(/^#{1,6}\s+(.+?)\s*#*$/);
    if (heading) {
      flush(); headingCount += 1;
      const next = classifySection(cleanHeading(heading[1]), sectionKind);
      if (next) { sectionKind = next; sectionKinds.add(next); }
      return;
    }
    const bareLabel = line.match(BARE_STRUCTURED_LABEL_PATTERN);
    if (bareLabel) {
      flush();
      pendingStructuredLabel = normalizeStructuredLabel(bareLabel[1]);
      const categoryId = STRUCTURED_LABEL_CATEGORY[pendingStructuredLabel];
      if (['objective', 'method', 'result', 'conclusion'].includes(categoryId)) {
        sectionKind = sectionKind === 'front' ? 'abstract' : sectionKind;
        sectionKinds.add(sectionKind);
      }
      return;
    }
    const inlineLabel = matchStructuredLabelLine(line);
    if (inlineLabel) {
      flush();
      pendingStructuredLabel = normalizeStructuredLabel(inlineLabel[1]);
      if (sectionKind === 'front') {
        sectionKind = 'abstract';
        sectionKinds.add(sectionKind);
      }
      buffer.push(inlineLabel[2]);
      flush();
      return;
    }
    buffer.push(line);
  });
  flush();
  const sentences = [];
  paragraphs.forEach((paragraph, paragraphIndex) => {
    splitSentences(paragraph.text).forEach(text => sentences.push({
      paragraphIndex, sectionKind: paragraph.sectionKind, text
    }));
  });
  const scientific = [...sectionKinds].filter(kind =>
    ['abstract', 'introduction', 'results', 'discussion', 'conclusion', 'methods', 'references']
      .includes(kind)
  );
  const patentLike = /\b(?:patent|claims?|inventors?|publication number)\b/i
    .test(sentences.slice(0, 30).map(item => item.text).join(' ')) &&
    !sectionKinds.has('results');
  const isArticleLike = !patentLike && (scientific.length >= 2 || (
    sectionKinds.has('abstract') && scientific.some(kind => kind !== 'abstract')
  ));
  return { paragraphs, sentences, sectionKinds, headingCount, isArticleLike };
}

function cleanMarkdownText(value) {
  return String(value || '')
    .replace(/!\[([^\]]*)]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[*_`~]/g, '')
    .replace(/^\s*(?:[-+*]|\d+[.)])\s+/, '')
    .replace(/\s+/g, ' ').trim();
}

function normalizeStructuredLabel(value) {
  return String(value || '').toUpperCase().replace(/\s+/g, ' ').trim();
}

function matchStructuredLabelLine(line) {
  const source = String(line || '');
  const upper = source.toUpperCase();
  for (const label of Object.keys(STRUCTURED_LABEL_CATEGORY)
    .sort((left, right) => right.length - left.length)) {
    if (!upper.startsWith(label)) continue;
    const suffix = source.slice(label.length);
    const punctuation = suffix.match(/^\s*[:.\-–—]\s*(.*)$/);
    if (punctuation) return [source, label, punctuation[1]];
    if (source.startsWith(label)) {
      const whitespace = suffix.match(/^\s+(.*)$/);
      if (whitespace) return [source, label, whitespace[1]];
    }
  }
  return null;
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function classifySection(value, current) {
  const heading = cleanHeading(value)
    .replace(/^(?:\d+(?:\.\d+)*|[ivxlcdm]+)[.)]?\s+/i, '')
    .replace(/\s+/g, ' ').trim();
  for (const [kind, pattern] of SECTION_RULES) if (pattern.test(heading)) return kind;
  return current === 'front' ? null : current;
}

function cleanHeading(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, '')
    .replace(/[*_`~]/g, '')
    .replace(/\[[^\]]+]\([^)]+\)/g,
      match => match.replace(/\]\([^)]+\)$/, '').slice(1))
    .trim();
}

function splitSentences(text) {
  if (SENTENCE_SEGMENTER) {
    return [...SENTENCE_SEGMENTER.segment(text)]
      .map(item => cleanText(item.segment)).filter(item => item.length >= 12);
  }
  return (String(text).match(/[^.!?。！？]+[.!?。！？]?/gu) || [text])
    .map(cleanText).filter(item => item.length >= 12);
}

function isNoise(text) {
  if (/^(?:https?:\/\/|doi:|copyright\b|download\b)/i.test(text)) return true;
  if (/^(?:figure|fig\.?|table|supplementary (?:figure|table))\s*[s\d]+[.:]/i.test(text)) return true;
  const letters = (text.match(/\p{L}/gu) || []).length;
  return letters < 8 || letters / Math.max(1, text.length) < 0.35;
}

function wordCount(value) {
  return (String(value || '').match(/[\p{L}\p{N}]+/gu) || []).length;
}

function qualityScore(parsed, markdown, figures, pdf) {
  let score = 0;
  score += Math.min(35, Math.log10(Math.max(10, markdown.length)) * 7);
  score += Math.min(25, parsed.sectionKinds.size * 4);
  score += parsed.isArticleLike ? 20 : 0;
  score += Math.min(10, figures.length);
  score += pdf.path ? 10 : 0;
  return Number(Math.min(100, score).toFixed(1));
}

function qualityFlags(parsed, markdown, figures, pdf) {
  const flags = [];
  if (!parsed.isArticleLike) flags.push('non_article_like');
  if (markdown.length < 10000) flags.push('short_text');
  if (parsed.sectionKinds.size < 3) flags.push('few_scientific_sections');
  if (!figures.length) flags.push('no_extracted_figures');
  if (!pdf.path) flags.push('source_pdf_not_resolved');
  if (/\uFFFD/.test(markdown)) flags.push('replacement_characters');
  return flags;
}

function inferStudyType(title, sample) {
  const text = `${title} ${sample}`.toLowerCase();
  if (/systematic review|meta-analysis|meta analysis|prisma|umbrella review/.test(text)) {
    return 'systematic_review_meta';
  }
  if (/\breview\b|state of the art|scoping review/.test(text) &&
      !/randomi[sz]ed|cohort|participants/.test(text)) return 'narrative_review';
  if (/diagnostic|prognostic|prediction model|area under the curve|receiver operating/.test(text)) {
    return 'diagnostic_prognostic';
  }
  if (/randomi[sz]ed|clinical trial|phase [1-4iv]+|participants|patients were assigned/.test(text)) {
    return 'clinical_trial';
  }
  if (/cohort|case-control|cross-sectional|observational|population-based/.test(text)) {
    return 'observational';
  }
  if (/single[- ]cell|rna-seq|transcriptom|proteom|metabolom|genome-wide|multi-omics/.test(text)) {
    return 'omics_high_throughput';
  }
  if (/protocol|software|resource|atlas|database|benchmark|workflow|method for/.test(text)) {
    return 'methods_resource';
  }
  if (/xenograft|mouse|mice|murine|rat|animal model|organoid/.test(text)) {
    return 'preclinical_translational';
  }
  return 'basic_mechanistic';
}

function extractFigureEntries(manifest, directoryPath) {
  const values = [];
  const append = item => {
    const relativePath = String(item?.path || '').replace(/\\/g, '/');
    const absolutePath = path.resolve(directoryPath, relativePath);
    if (!relativePath || !absolutePath.startsWith(path.resolve(directoryPath) + path.sep) ||
        !fs.existsSync(absolutePath)) return;
    const label = cleanText(item?.label);
    const caption = cleanText(item?.caption);
    if (/^table\b/i.test(label) && !/\bfig(?:ure)?\b/i.test(caption)) return;
    values.push({
      label, caption, page: Number(item?.page) || null,
      relativePath, absolutePath
    });
  };
  (Array.isArray(manifest?.allFigures) ? manifest.allFigures : []).forEach(append);
  (Array.isArray(manifest?.sections) ? manifest.sections : []).forEach(section => {
    (Array.isArray(section?.figures) ? section.figures : []).forEach(append);
    (Array.isArray(section?.tables) ? section.tables : [])
      .filter(item => /\bfig(?:ure)?\b/i.test(`${item?.label || ''} ${item?.caption || ''}`))
      .forEach(append);
  });
  const seen = new Set();
  return values.filter(item => {
    const key = path.resolve(item.absolutePath).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}

function titleSimilarity(left, right) {
  const leftTokens = new Set(String(left || '').split(' ').filter(token => token.length > 2));
  const rightTokens = new Set(String(right || '').split(' ').filter(token => token.length > 2));
  if (!leftTokens.size || !rightTokens.size) return 0;
  const shared = [...leftTokens].filter(token => rightTokens.has(token)).length;
  return Number((shared / Math.max(leftTokens.size, rightTokens.size)).toFixed(4));
}

function discoverDuplicatePairs(items) {
  const pairs = [];
  for (let leftIndex = 0; leftIndex < items.length; leftIndex += 1) {
    const left = items[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < items.length; rightIndex += 1) {
      const right = items[rightIndex];
      const reasons = [];
      if (left.normalizedTextSha256 === right.normalizedTextSha256) reasons.push('exact_normalized_text');
      if (left.parentItemKey && left.parentItemKey === right.parentItemKey) reasons.push('same_zotero_parent');
      if (left.doi && left.doi === right.doi) reasons.push('same_doi');
      if (left.pmid && left.pmid === right.pmid) reasons.push('same_pmid');
      if (left.pmcid && left.pmcid === right.pmcid) reasons.push('same_pmcid');
      const similarity = titleSimilarity(left.normalizedTitle, right.normalizedTitle);
      if (left.normalizedTitle.length >= 30 && left.normalizedTitle === right.normalizedTitle) {
        reasons.push('exact_normalized_title');
      } else if (similarity >= 0.94 &&
          Math.min(left.normalizedTitle.split(' ').length, right.normalizedTitle.split(' ').length) >= 6 &&
          (!left.publicationYear || !right.publicationYear ||
            Math.abs(left.publicationYear - right.publicationYear) <= 3)) {
        reasons.push('high_similarity_title_version_pair');
      }
      const samePdfSize = left.sourcePdf?.bytes && left.sourcePdf.bytes === right.sourcePdf?.bytes;
      if (!reasons.length && !samePdfSize) continue;
      pairs.push({
        leftId: left.documentId, rightId: right.documentId,
        reasons, titleSimilarity: similarity,
        normalizedTextSha256: reasons.includes('exact_normalized_text')
          ? left.normalizedTextSha256 : '',
        doi: reasons.includes('same_doi') ? left.doi : '',
        pmid: reasons.includes('same_pmid') ? left.pmid : '',
        parentItemKey: reasons.includes('same_zotero_parent') ? left.parentItemKey : '',
        samePdfSize, exactPdfSha256: '', confidence: pairConfidence(reasons)
      });
    }
  }
  return pairs;
}

function pairConfidence(reasons) {
  if (reasons.some(reason => [
    'exact_normalized_text', 'same_doi', 'same_pmid', 'same_pmcid'
  ].includes(reason))) return 'high';
  if (reasons.includes('same_zotero_parent') || reasons.includes('exact_normalized_title')) {
    return 'high';
  }
  return reasons.includes('high_similarity_title_version_pair') ? 'reviewed_rule' : 'candidate';
}

function hashDuplicatePdfGroups(pairs, items) {
  const byId = new Map(items.map(item => [item.documentId, item]));
  const candidateIds = new Set(pairs.filter(pair => pair.samePdfSize)
    .flatMap(pair => [pair.leftId, pair.rightId]));
  candidateIds.forEach(documentId => {
    const document = byId.get(documentId);
    if (!document?.sourcePdf) return;
    const alias = document.sourcePdf.aliasPath;
    const filename = alias.split('/').at(-1);
    const pdfPath = path.join(ZOTERO_STORAGE_ROOT, document.attachmentKey, filename);
    if (fs.existsSync(pdfPath)) document.sourcePdf.sha256 = hashFile(pdfPath);
  });
  pairs.forEach(pair => {
    if (!pair.samePdfSize) return;
    const left = byId.get(pair.leftId);
    const right = byId.get(pair.rightId);
    if (left?.sourcePdf?.sha256 && left.sourcePdf.sha256 === right?.sourcePdf?.sha256) {
      pair.exactPdfSha256 = left.sourcePdf.sha256;
      pair.reasons.unshift('exact_pdf');
      pair.confidence = 'high';
    }
  });
}

function buildClusters(items, pairs) {
  const parent = new Map(items.map(item => [item.documentId, item.documentId]));
  const find = id => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root);
    let current = id;
    while (current !== root) {
      const next = parent.get(current); parent.set(current, root); current = next;
    }
    return root;
  };
  const union = (left, right) => {
    const a = find(left); const b = find(right);
    if (a !== b) parent.set(b, a < b ? a : b);
  };
  pairs.filter(pair => pair.reasons.length).forEach(pair => union(pair.leftId, pair.rightId));
  const groups = new Map();
  items.forEach(item => {
    const root = find(item.documentId);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(item);
  });
  return [...groups.values()].map(group => {
    const ids = group.map(item => item.documentId).sort();
    const canonical = [...group].sort((left, right) =>
      right.quality.qualityScore - left.quality.qualityScore ||
      left.documentId.localeCompare(right.documentId)
    )[0];
    const relevantPairs = pairs.filter(pair => ids.includes(pair.leftId) && ids.includes(pair.rightId));
    return {
      clusterId: `cluster-${sha(ids.join('|')).slice(0, 16)}`,
      canonicalDocumentId: canonical.documentId,
      documentIds: ids,
      versionCount: ids.length,
      title: canonical.title,
      studyType: canonical.studyType,
      duplicateReasons: [...new Set(relevantPairs.flatMap(pair => pair.reasons))].sort(),
      identifiers: {
        doi: [...new Set(group.map(item => item.doi).filter(Boolean))],
        pmid: [...new Set(group.map(item => item.pmid).filter(Boolean))],
        pmcid: [...new Set(group.map(item => item.pmcid).filter(Boolean))]
      }
    };
  }).sort((left, right) => left.clusterId.localeCompare(right.clusterId));
}

function buildSplit(clusters, items) {
  const byType = new Map();
  clusters.forEach(cluster => {
    if (!byType.has(cluster.studyType)) byType.set(cluster.studyType, []);
    byType.get(cluster.studyType).push(cluster);
  });
  const rows = [];
  for (const [studyType, values] of byType) {
    values.sort((left, right) => sha(`${SPLIT_SEED}|${left.clusterId}`)
      .localeCompare(sha(`${SPLIT_SEED}|${right.clusterId}`)));
    const count = values.length;
    const validationStart = Math.floor(count * 0.7);
    const lockedStart = Math.floor(count * 0.85);
    values.forEach((cluster, index) => rows.push({
      clusterId: cluster.clusterId,
      split: index < validationStart ? 'development'
        : index < lockedStart ? 'validation' : 'locked_test',
      studyType,
      canonicalDocumentId: cluster.canonicalDocumentId,
      documentIds: cluster.documentIds
    }));
  }
  rows.sort((left, right) => left.clusterId.localeCompare(right.clusterId));
  const itemById = new Map(items.map(item => [item.documentId, item]));
  const counts = {};
  rows.forEach(row => {
    const target = counts[row.split] || { clusters: 0, documents: 0, studyTypes: {} };
    target.clusters += 1;
    target.documents += row.documentIds.filter(id => itemById.has(id)).length;
    target.studyTypes[row.studyType] = (target.studyTypes[row.studyType] || 0) + 1;
    counts[row.split] = target;
  });
  return { clusters: rows, counts };
}

function compileCategory(category) {
  const rules = [];
  const flags = category.regex.caseSensitive ? 'g' : 'gi';
  category.regex.phrases.forEach((phrase, index) => {
    if (phrase) rules.push({
      id: `phrase:${index}:${phrase}`, kind: 'phrase',
      value: category.regex.caseSensitive ? phrase : phrase.toLowerCase()
    });
  });
  category.regex.expressions.forEach((expression, index) => rules.push({
    id: `expression:${index}:${expression}`, kind: 'expression',
    regex: new RegExp(expression, flags)
  }));
  return {
    categoryId: category.categoryId,
    match(text) {
      const searchable = category.regex.caseSensitive ? text : text.toLowerCase();
      const hits = [];
      rules.forEach(rule => {
        if (rule.kind === 'phrase') {
          let start = searchable.indexOf(rule.value);
          while (start >= 0) {
            const end = start + rule.value.length;
            if (!category.regex.wholeWord || (
              !isWordCharacter(text[start - 1]) && !isWordCharacter(text[end])
            )) { hits.push({ rule: rule.id, start, end }); break; }
            start = searchable.indexOf(rule.value, Math.max(end, start + 1));
          }
          return;
        }
        rule.regex.lastIndex = 0;
        let match;
        while ((match = rule.regex.exec(text))) {
          if (!match[0]) { rule.regex.lastIndex += 1; continue; }
          const start = match.index; const end = start + match[0].length;
          if (!category.regex.wholeWord || (
            !isWordCharacter(text[start - 1]) && !isWordCharacter(text[end])
          )) { hits.push({ rule: rule.id, start, end }); break; }
        }
      });
      return hits;
    }
  };
}

function isWordCharacter(value) {
  return Boolean(value) && /[\p{L}\p{N}_]/u.test(value);
}

function analyzeCorpus(items, parsedMap) {
  const pairCounts = new Map();
  const pairExamples = new Map();
  const viewCounts = Object.fromEntries(Object.keys(VIEW_VISIBILITY_OVERRIDES)
    .map(viewId => [viewId, 0]));
  const studyCounts = {};
  const recommendedViewCounts = {};
  const reviewCandidates = Object.fromEntries(HIGH_RISK.map(id => [id, {
    positive: [], hardNegative: []
  }]));
  let activeSentences = 0;
  let conflictSentences = 0;
  items.forEach((document, documentIndex) => {
    const parsed = parsedMap.get(document.documentId);
    const sentences = parsed?.sentences || [];
    const study = studyCounts[document.studyType] || {
      activeSentences: 0, conflictSentences: 0, recommendedCoreConflicts: 0
    };
    const recommendedView = STUDY_VIEW_RECOMMENDATIONS[document.studyType]?.defaultViewId ||
      'quick_story';
    sentences.forEach((sentence, sentenceIndex) => {
      if (!ACTIVE_SECTIONS.has(sentence.sectionKind)) return;
      activeSentences += 1; study.activeSentences += 1;
      const matched = [];
      const hitsByCategory = {};
      matchers.forEach(matcher => {
        const hits = matcher.match(sentence.text);
        if (hits.length) { matched.push(matcher.categoryId); hitsByCategory[matcher.categoryId] = hits; }
      });
      const context = sentenceContext(sentences, sentenceIndex);
      const candidateBase = {
        documentId: document.documentId,
        clusterId: document.clusterId,
        split: document.split,
        studyType: document.studyType,
        title: document.title,
        sentenceIndex,
        sectionKind: sentence.sectionKind,
        text: sentence.text,
        contextBefore: context.before,
        contextAfter: context.after
      };
      HIGH_RISK.forEach(categoryId => {
        if (matched.includes(categoryId)) {
          pushBounded(reviewCandidates[categoryId].positive, {
            ...candidateBase,
            matchedRules: hitsByCategory[categoryId].map(hit => hit.rule),
            candidateCategory: categoryId,
            candidateKind: 'natural_positive_candidate'
          }, 600);
        } else if (hardNegativeFor(categoryId, sentence.text, matched)) {
          pushBounded(reviewCandidates[categoryId].hardNegative, {
            ...candidateBase,
            siblingMatches: matched.filter(id => HIGH_RISK.includes(id)),
            candidateCategory: categoryId,
            candidateKind: 'natural_hard_negative_candidate'
          }, 900);
        }
      });
      if (matched.length > 1) {
        conflictSentences += 1; study.conflictSentences += 1;
        const sorted = [...matched].sort();
        for (let left = 0; left < sorted.length; left += 1) {
          for (let right = left + 1; right < sorted.length; right += 1) {
            const key = `${sorted[left]} + ${sorted[right]}`;
            pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
            if (!pairExamples.has(key)) pairExamples.set(key, []);
            pushDiverse(pairExamples.get(key), candidateBase, 3);
          }
        }
      }
      Object.keys(viewCounts).forEach(viewId => {
        const visible = matched.filter(categoryId =>
          categoryVisibleAtDensity(viewId, categoryId, 'core', catalog[categoryId])
        );
        if (visible.length > 1) viewCounts[viewId] += 1;
      });
      const recommendedVisible = matched.filter(categoryId =>
        categoryVisibleAtDensity(recommendedView, categoryId, 'core', catalog[categoryId])
      );
      if (recommendedVisible.length > 1) {
        study.recommendedCoreConflicts += 1;
        recommendedViewCounts[recommendedView] =
          (recommendedViewCounts[recommendedView] || 0) + 1;
      }
    });
    studyCounts[document.studyType] = study;
    if ((documentIndex + 1) % 50 === 0 || documentIndex + 1 === items.length) {
      console.error(`regex:${documentIndex + 1}/${items.length}`);
    }
  });
  const topPairs = [...pairCounts.entries()]
    .sort((left, right) => right[1] - left[1]).slice(0, 20)
    .map(([key, count], index) => {
      const [left, right] = key.split(' + ');
      const classification = classifyConflictPair(left, right);
      return {
        rank: index + 1, left, right, count,
        per1000ActiveSentences: per1000(count, activeSentences),
        ...classification,
        examples: pairExamples.get(key) || []
      };
    });
  Object.values(studyCounts).forEach(value => {
    value.conflictRatePer1000 = per1000(value.conflictSentences, value.activeSentences);
    value.recommendedCoreConflictRatePer1000 = per1000(
      value.recommendedCoreConflicts, value.activeSentences
    );
  });
  const recommendedCoreTotal = Object.values(studyCounts)
    .reduce((sum, value) => sum + value.recommendedCoreConflicts, 0);
  return {
    reviewCandidates,
    conflicts: {
      formatVersion: FORMAT_VERSION,
      definition: 'An active-section sentence matched two or more configured category regexes. This is an overlap signal, not a false-positive judgment.',
      denominatorDefinition: 'All sentences in abstract, introduction, results, discussion, and conclusion of the 833 article-like MinerU documents.',
      denominatorActiveSentences: activeSentences,
      totalActiveConflictSentences: conflictSentences,
      activeConflictRatePer1000: per1000(conflictSentences, activeSentences),
      topPairs,
      byStudyType: studyCounts,
      uiCore: {
        definition: 'A sentence remains a visible conflict only when at least two matched categories are visible at core density for the applicable reading view.',
        byView: Object.fromEntries(Object.entries(viewCounts).map(([viewId, count]) => [viewId, {
          conflictSentences: count,
          ratePer1000ActiveSentences: per1000(count, activeSentences)
        }])),
        recommendedViewByStudyType: {
          conflictSentences: recommendedCoreTotal,
          ratePer1000ActiveSentences: per1000(recommendedCoreTotal, activeSentences),
          countsByView: recommendedViewCounts
        }
      }
    }
  };
}

function sentenceContext(sentences, index) {
  const section = sentences[index]?.sectionKind;
  const before = [];
  const after = [];
  for (let cursor = index - 1; cursor >= 0 && before.length < 2; cursor -= 1) {
    if (sentences[cursor].sectionKind !== section) break;
    before.unshift(sentences[cursor].text);
  }
  for (let cursor = index + 1; cursor < sentences.length && after.length < 2; cursor += 1) {
    if (sentences[cursor].sectionKind !== section) break;
    after.push(sentences[cursor].text);
  }
  return { before, after };
}

function hardNegativeFor(categoryId, text, matched) {
  if (matched.some(id => HIGH_RISK.includes(id))) return true;
  const patterns = {
    causal_effect: /caus|effect|induc|lead to|result in/i,
    mechanism_mediator: /mechanis|mediat|pathway|through/i,
    necessity_evidence: /necess|required|depend|block|knockout/i,
    sufficiency_evidence: /sufficien|alone|ectopic|overexpress|activation/i,
    rescue_evidence: /rescu|restore|revers|recover/i,
    confounding_reverse_causality: /confound|reverse caus|bidirectional|residual/i,
    causal_overreach: /causal|cause|prove|demonstrat/i,
    alternative_explanation: /alternativ|could reflect|cannot exclude|other explanation/i,
    evidence_consensus: /consensus|consistent|agreement|converge/i,
    conflicting_evidence: /conflict|inconsistent|discrepan|mixed evidence/i,
    heterogeneity_source: /heterogen|subgroup|between-study|variability/i,
    replication_external_validation: /replicat|external valid|independent cohort|reproduc/i
  };
  return patterns[categoryId]?.test(text) === true;
}

function pushBounded(values, value, limit) {
  if (values.length < limit) values.push(value);
}

function pushDiverse(values, value, limit) {
  if (values.length >= limit || values.some(item => item.documentId === value.documentId)) return;
  values.push(value);
}

function classifyConflictPair(left, right) {
  const pair = [left, right].sort().join('|');
  const generic = new Set(['evidence', 'causality', 'interpretation', 'result', 'comparison']);
  if (generic.has(left) || generic.has(right)) return {
    auditClassification: 'likely_redundant_or_overbroad',
    classificationReason: 'A generic legacy category overlaps a more specific category on the same sentence.',
    suggestedAction: 'Keep the specific category; demote or tighten the generic rule and rely on same-span visual merge meanwhile.'
  };
  const plausible = new Set([
    'causal_effect|mechanism_mediator',
    'mechanism_mediator|necessity_evidence',
    'mechanism_mediator|sufficiency_evidence',
    'necessity_evidence|rescue_evidence',
    'replication_external_validation|statistical_robustness',
    'conflicting_evidence|heterogeneity_source',
    'evidence_consensus|replication_external_validation',
    'alternative_explanation|confounding_reverse_causality'
  ]);
  if (plausible.has(pair)) return {
    auditClassification: 'plausible_multilabel',
    classificationReason: 'The two labels describe different evidence functions that can legitimately co-occur.',
    suggestedAction: 'Retain both labels; verify evidence spans and let the UI merge same-range presentation.'
  };
  if (pair === 'conflicting_evidence|evidence_consensus' ||
      pair === 'necessity_evidence|sufficiency_evidence') return {
    auditClassification: 'context_dependent_review_required',
    classificationReason: 'The labels may describe separate clauses or experiments, but are contradictory if applied to one unsupported span.',
    suggestedAction: 'Split clause-level spans and require distinct provenance before retaining both labels.'
  };
  return {
    auditClassification: 'review_required',
    classificationReason: 'Regex overlap alone cannot determine whether both scientific labels are valid.',
    suggestedAction: 'Send examples to the blind human queue before changing production rules.'
  };
}

function per1000(value, denominator) {
  return denominator ? Number((Number(value) * 1000 / denominator).toFixed(2)) : 0;
}

function selectDiverse(values, quota, allowedSplits) {
  const filtered = values.filter(item => allowedSplits.has(item.split));
  const byCluster = new Map();
  filtered.forEach(item => {
    if (!byCluster.has(item.clusterId)) byCluster.set(item.clusterId, []);
    byCluster.get(item.clusterId).push(item);
  });
  const clusters = [...byCluster.keys()].sort((left, right) =>
    sha(`${SPLIT_SEED}|queue|${left}`).localeCompare(sha(`${SPLIT_SEED}|queue|${right}`))
  );
  const selected = [];
  let round = 0;
  while (selected.length < quota) {
    let added = false;
    for (const clusterId of clusters) {
      const item = byCluster.get(clusterId)[round];
      if (!item) continue;
      selected.push(item); added = true;
      if (selected.length >= quota) break;
    }
    if (!added) break;
    round += 1;
  }
  return selected;
}

function buildReviewQueue(candidates, items) {
  const allowed = new Set(['development', 'validation']);
  const queueItems = [];
  const coverage = {};
  HIGH_RISK.forEach(categoryId => {
    const positives = selectDiverse(candidates[categoryId].positive, 15, allowed);
    const negatives = selectDiverse(candidates[categoryId].hardNegative, 30, allowed);
    const categoryItems = [
      ...positives.map(item => ({ ...item, stratum: 'candidate_positive' })),
      ...negatives.map(item => ({ ...item, stratum: 'hard_negative' }))
    ];
    const distinctClusters = new Set(categoryItems.map(item => item.clusterId));
    coverage[categoryId] = {
      naturalPositiveCandidates: positives.length,
      naturalHardNegatives: negatives.length,
      distinctPaperClusters: distinctClusters.size,
      positiveShortage: Math.max(0, 15 - positives.length),
      hardNegativeShortage: Math.max(0, 30 - negatives.length),
      paperShortage: Math.max(0, 5 - distinctClusters.size),
      syntheticExamplesUsed: 0
    };
    categoryItems.forEach((item, index) => queueItems.push({
      queueId: `hr-${categoryId}-${String(index + 1).padStart(3, '0')}`,
      blindOrderKey: sha(`${SPLIT_SEED}|${categoryId}|${item.documentId}|${item.sentenceIndex}`),
      targetCategory: categoryId,
      candidateKind: item.candidateKind,
      stratum: item.stratum,
      documentId: item.documentId,
      clusterId: item.clusterId,
      split: item.split,
      studyType: item.studyType,
      title: item.title,
      sectionKind: item.sectionKind,
      sentenceIndex: item.sentenceIndex,
      contextBefore: item.contextBefore,
      text: item.text,
      contextAfter: item.contextAfter,
      sourceRange: { start: 0, end: item.text.length },
      adjudication: { ...REVIEW_FIELDS }
    }));
  });
  queueItems.sort((left, right) => left.blindOrderKey.localeCompare(right.blindOrderKey));
  return {
    formatVersion: FORMAT_VERSION,
    generatedAt: new Date().toISOString(),
    queueKind: 'blind_high_risk_seed_gold',
    goldStatus: 'unadjudicated',
    candidateLabelsAreGold: false,
    promptDevelopmentSplits: ['development', 'validation'],
    lockedTestItemsIncluded: false,
    instructions: 'The UI must not show targetCategory, candidateKind, or stratum before adjudication.',
    coverage,
    items: queueItems
  };
}

function classifyFigure(entry) {
  const text = `${entry.label} ${entry.caption}`.toLowerCase();
  const modalities = [];
  if (/microscop|immunofluores|immunohist|stain|scale bar|confocal|histolog|image/.test(text)) {
    modalities.push('microscopy');
  }
  if (/western blot|immunoblot|\bwb\b|protein expression/.test(text)) modalities.push('western_blot');
  if (/flow cytometr|\bfacs\b|gating/.test(text)) modalities.push('flow_cytometry');
  if (/bar graph|line graph|time course|dose.response|quantification|mean [±+]/.test(text)) {
    modalities.push('bar_or_line');
  }
  if (/kaplan|survival|hazard ratio|cumulative incidence/.test(text)) modalities.push('survival_curve');
  if (/heatmap|umap|t-sne|tsne|cluster map/.test(text)) modalities.push('heatmap_or_umap');
  const labels = [...text.matchAll(/\(([a-z])\)|\bpanel\s+([a-z])\b/gi)]
    .map(match => (match[1] || match[2]).toUpperCase());
  if (new Set(labels).size >= 2 || /multi[- ]panel|panels? [a-z](?:[-–][a-z])?/.test(text)) {
    modalities.push('multi_panel');
  }
  if (!labels.length && (/^image[-_ ]?\d+$/i.test(entry.label) || !entry.caption)) {
    modalities.push('unstable_or_unlabeled_panels');
  }
  return { modalities: [...new Set(modalities)], panelLabels: [...new Set(labels)] };
}

function buildFigureQueue(items) {
  const candidates = [];
  items.filter(item => item.split !== 'locked_test').forEach(document => {
    document.figureEntries.forEach((entry, figureIndex) => {
      const classified = classifyFigure(entry);
      candidates.push({ document, entry, figureIndex, ...classified });
    });
  });
  const desired = [
    'microscopy', 'western_blot', 'flow_cytometry', 'bar_or_line',
    'survival_curve', 'heatmap_or_umap', 'multi_panel', 'unstable_or_unlabeled_panels'
  ];
  const selected = [];
  const usedImages = new Set();
  const clusterCounts = new Map();
  function add(candidate) {
    const imageKey = path.resolve(candidate.entry.absolutePath).toLowerCase();
    if (usedImages.has(imageKey)) return false;
    if ((clusterCounts.get(candidate.document.clusterId) || 0) >= 2) return false;
    usedImages.add(imageKey);
    clusterCounts.set(candidate.document.clusterId,
      (clusterCounts.get(candidate.document.clusterId) || 0) + 1);
    selected.push(candidate); return true;
  }
  desired.forEach(modality => {
    candidates.filter(candidate => candidate.modalities.includes(modality))
      .sort((left, right) => right.document.quality.qualityScore - left.document.quality.qualityScore)
      .slice(0, 12).forEach(candidate => {
        if (selected.filter(item => item.modalities.includes(modality)).length < 2) add(candidate);
      });
  });
  candidates.sort((left, right) =>
    right.modalities.length - left.modalities.length ||
    right.document.quality.qualityScore - left.document.quality.qualityScore
  ).forEach(candidate => { if (selected.length < 30) add(candidate); });
  const queueItems = selected.slice(0, 30).map((candidate, index) => {
    const extension = path.extname(candidate.entry.absolutePath).toLowerCase() || '.png';
    const assetName = `figure-${String(index + 1).padStart(3, '0')}${extension}`;
    fs.copyFileSync(candidate.entry.absolutePath, path.join(ASSET_DIR, assetName));
    return {
      queueId: `figure-${String(index + 1).padStart(3, '0')}`,
      documentId: candidate.document.documentId,
      clusterId: candidate.document.clusterId,
      split: candidate.document.split,
      studyType: candidate.document.studyType,
      title: candidate.document.title,
      figureLabel: candidate.entry.label,
      caption: candidate.entry.caption,
      pdfPage: candidate.entry.page,
      sourcePdfAlias: candidate.document.sourcePdf?.aliasPath || '',
      imageAsset: `review-assets/figures/${assetName}`,
      imageSha256: hashFile(candidate.entry.absolutePath),
      candidateModalities: candidate.modalities,
      stablePanelLabelsFound: candidate.panelLabels,
      adjudication: { ...FIGURE_REVIEW_FIELDS }
    };
  });
  const modalityCoverage = Object.fromEntries(desired.map(modality => [
    modality, queueItems.filter(item => item.candidateModalities.includes(modality)).length
  ]));
  return {
    formatVersion: FORMAT_VERSION,
    generatedAt: new Date().toISOString(),
    queueKind: 'blind_real_figure_seed_gold',
    goldStatus: 'unadjudicated',
    captionOnlyGoldAllowed: false,
    actualImageRequired: true,
    lockedTestItemsIncluded: false,
    requestedMinimum: 30,
    modalityCoverage,
    items: queueItems
  };
}

function publicDocumentManifest(document) {
  const { figureEntries, normalizedTitle, ...value } = document;
  return {
    ...value,
    clusterId: document.clusterId || null,
    split: document.split || null,
    sourcePdf: document.sourcePdf ? {
      ...document.sourcePdf,
      sha256: document.sourcePdf.sha256 || null
    } : null
  };
}

function buildCorpusReport(allDocuments, articleDocs, clusters, pairs, splitManifest,
  analysis, reviewQueue, figureQueue) {
  const duplicates = clusters.filter(item => item.documentIds.length > 1);
  const shortages = Object.entries(reviewQueue.coverage)
    .filter(([, value]) => value.positiveShortage || value.hardNegativeShortage || value.paperShortage);
  const studyRows = Object.entries(analysis.conflicts.byStudyType)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([studyType, value]) => `| ${studyType} | ${value.activeSentences} | ${value.conflictSentences} | ${value.conflictRatePer1000} | ${value.recommendedCoreConflictRatePer1000} |`)
    .join('\n');
  const coreRows = Object.entries(analysis.conflicts.uiCore.byView)
    .map(([viewId, value]) => `| ${viewId} | ${value.conflictSentences} | ${value.ratePer1000ActiveSentences} |`)
    .join('\n');
  return `# Checkpoint 2 Corpus And Split Report\n\n` +
    `生成时间：${new Date().toISOString()}\n\n` +
    `## 边界\n\n本报告只描述确定性语料构建、去重、拆分和未裁决审阅队列。候选规则标签不是人工 Gold；未运行 Provider；未报告 Prompt precision、recall 或 F1。\n\n` +
    `## 语料与去重\n\n` +
    `- MinerU 文档：${allDocuments.length}\n- article-like 文档：${articleDocs.length}\n` +
    `- document clusters：${clusters.length}\n- 含多个版本/附件的 clusters：${duplicates.length}\n` +
    `- 进入配对报告的候选对：${pairs.length}\n\n` +
    `去重证据包括 exact PDF（仅对同大小候选做全文件 SHA-256）、标准化全文、Zotero parent item、DOI、PMID/PMCID、标准化标题及高阈值标题版本配对。同一 cluster 只分配到一个 split。\n\n` +
    `## Cluster split\n\n\`split-manifest.lock\` 锁定 \`split-manifest.json\` 的 SHA-256。目标比例为 70/15/15，并按 cluster 的 study type 分层；小分层取整会造成轻微偏差。locked_test 只出现在 split manifest，未进入两个 Prompt 开发审阅页面。\n\n` +
    `| split | clusters | documents |\n|---|---:|---:|\n` +
    Object.entries(splitManifest.counts).map(([name, value]) =>
      `| ${name} | ${value.clusters} | ${value.documents} |`
    ).join('\n') + '\n\n' +
    `## 活跃句冲突\n\n定义：同一个 active-section 句子触发两个或更多类别 Regex。分母为 abstract、introduction、results、discussion、conclusion 中全部 ${analysis.conflicts.denominatorActiveSentences} 个句子。总冲突句 ${analysis.conflicts.totalActiveConflictSentences}，即 ${analysis.conflicts.activeConflictRatePer1000}/1000。该值是重叠信号，不是误报率。\n\n` +
    `### 研究类型分层\n\n| study type | active sentences | conflicts | raw /1000 | recommended core /1000 |\n|---|---:|---:|---:|---:|\n${studyRows}\n\n` +
    `### UI core 可见率\n\n| view | visible conflicts | /1000 active |\n|---|---:|---:|\n${coreRows}\n\n` +
    `按每篇论文推荐的默认 view 计算，core 模式可见冲突为 ${analysis.conflicts.uiCore.recommendedViewByStudyType.conflictSentences} 句，即 ${analysis.conflicts.uiCore.recommendedViewByStudyType.ratePer1000ActiveSentences}/1000。\n\n` +
    `## 人工 Gold 种子队列\n\n- 高风险类别：${HIGH_RISK.length}\n- 未裁决自然候选：${reviewQueue.items.length}\n- locked_test 项：0\n- 合成句：0\n` +
    (shortages.length
      ? `- 自然样本不足类别：${shortages.map(([id]) => id).join(', ')}（详见 human-review-queue.json.coverage；未用合成句补足）\n`
      : '- 每类达到至少 15 个自然正候选、30 个自然困难负例、5 个论文 cluster。\n') +
    `\n## Figure 队列\n\n- 实际提取图像：${figureQueue.items.length}\n- locked_test 项：0\n- 仅图注项：0（每个项目均复制实际图像资产）\n- 模态候选覆盖：${Object.entries(figureQueue.modalityCoverage).map(([id, count]) => `${id}=${count}`).join(', ')}\n\n` +
    `Figure 候选模态来自图注/标签启发式，仅用于分层抽样，不是视觉 Gold。Panel、图注配对、分组、比较、方法、直接观察、证据等级与不可支持结论均等待人工查看图像后填写。\n`;
}
