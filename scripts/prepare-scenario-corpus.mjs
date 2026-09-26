#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FORMAT_VERSION = 1;
export const SAMPLING_SEED = 'brevess-scenarios-v1-pilot-20260908';
export const SPLIT_TARGETS = Object.freeze({ development: 24, validation: 12, locked_test: 12 });
export const STRATUM_TARGETS = Object.freeze({
  development: Object.freeze({ mechanism_preclinical: 8, review: 8, clinical_observational: 8 }),
  validation: Object.freeze({ mechanism_preclinical: 4, review: 4, clinical_observational: 4 }),
  locked_test: Object.freeze({ mechanism_preclinical: 4, review: 4, clinical_observational: 4 })
});

export const SCENARIO_CATEGORIES = Object.freeze({
  quick_story: Object.freeze([
    'known_background', 'scientific_question', 'method', 'result', 'interpretation',
    'limitation', 'significance_novelty', 'future'
  ]),
  critical_review: Object.freeze([
    'necessity_evidence', 'sufficiency_evidence', 'rescue_evidence',
    'design_control', 'review_question'
  ]),
  review_synthesis: Object.freeze([
    'review_scope_thesis', 'evidence_consensus', 'conflicting_evidence',
    'evidence_quality_certainty', 'future'
  ])
});

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const checkpointDir = path.join(repoRoot, 'benchmarks', 'checkpoint2');
const outputDir = path.join(repoRoot, 'benchmarks', 'scenarios-v1');
const privateDir = path.join(repoRoot, 'tmp', 'scenario-corpus-v1');
const corpusRoot = path.resolve(process.env.ZOTERO_MINERU_ROOT || path.join(
  os.homedir(), 'Zotero', 'llm-for-zotero-mineru'
));

const SECTION_KINDS = Object.freeze(['methods', 'results', 'discussion']);
const SPLIT_ORDER = Object.freeze(['development', 'validation', 'locked_test']);
const STRATUM_ORDER = Object.freeze([
  'mechanism_preclinical', 'review', 'clinical_observational'
]);
const STUDY_STRATA = Object.freeze({
  preclinical_translational: 'mechanism_preclinical',
  narrative_review: 'review',
  systematic_review_meta: 'review',
  clinical_trial: 'clinical_observational',
  diagnostic_prognostic: 'clinical_observational',
  observational: 'clinical_observational'
});
const SECTION_PREFERENCES = Object.freeze({
  mechanism_preclinical: Object.freeze([
    'methods', 'results', 'discussion', 'methods', 'results', 'discussion', 'methods', 'results'
  ]),
  review: Object.freeze([
    'discussion', 'discussion', 'discussion', 'discussion',
    'discussion', 'discussion', 'discussion', 'discussion'
  ]),
  clinical_observational: Object.freeze([
    'methods', 'results', 'discussion', 'methods', 'results', 'discussion', 'methods', 'results'
  ])
});

export function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
}

export function stableJson(value) {
  return `${JSON.stringify(stableValue(value), null, 2)}\n`;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readJsonl(file) {
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse);
}

function normalizeIdentifier(value) {
  return String(value || '').trim().toLowerCase().replace(/^https?:\/\/(?:dx\.)?doi\.org\//, '')
    .replace(/[.,;:)\]]+$/, '');
}

function sectionKindFromHeading(heading) {
  const value = String(heading || '').normalize('NFKC').toLowerCase()
    .replace(/^\s*(?:section\s+)?\d+(?:\.\d+)*[.):\s-]*/, '').trim();
  if (/\b(?:methods?|materials? and methods?|experimental procedures?|study design|patients? and methods?|subjects? and methods?)\b/.test(value)) return 'methods';
  if (/\b(?:results?|findings?)\b/.test(value)) return 'results';
  if (/\b(?:discussion|general discussion|conclusions?|concluding remarks|interpretation)\b/.test(value)) return 'discussion';
  if (/\b(?:references|bibliography|literature cited|acknowledg|supplement|appendix)\b/.test(value)) return 'excluded';
  return '';
}

function stripMarkdown(value) {
  return String(value || '')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[*_`~>#|]/g, ' ')
    .replace(/\\[a-zA-Z]+(?:\{[^}]*})?/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function wordCount(value) {
  return (stripMarkdown(value).match(/[\p{L}\p{N}]+(?:[-'][\p{L}\p{N}]+)*/gu) || []).length;
}

export function parseParagraphs(markdown) {
  const source = String(markdown || '');
  const linePattern = /[^\r\n]*(?:\r\n|\r|\n|$)/g;
  const lines = [];
  let match;
  while ((match = linePattern.exec(source)) && match[0]) {
    const raw = match[0];
    lines.push({ startOffset: match.index, endOffset: match.index + raw.length, raw });
  }

  const paragraphs = [];
  let sectionKind = 'front';
  let sectionHeading = '';
  let sectionHeadingStartOffset = null;
  let inFence = false;
  let buffer = [];

  function flush() {
    if (!buffer.length) return;
    const startOffset = buffer[0].startOffset;
    let endOffset = buffer.at(-1).endOffset;
    while (endOffset > startOffset && /[\r\n]/.test(source[endOffset - 1])) endOffset -= 1;
    const text = source.slice(startOffset, endOffset);
    const cleaned = stripMarkdown(text);
    if (cleaned) {
      paragraphs.push({
        paragraphIndex: paragraphs.length,
        startOffset,
        endOffset,
        sectionKind,
        sectionHeading,
        sectionHeadingStartOffset,
        text,
        sha256: sha256(text),
        wordCount: wordCount(text)
      });
    }
    buffer = [];
  }

  for (const line of lines) {
    const body = line.raw.replace(/[\r\n]+$/, '');
    if (/^\s*```/.test(body)) {
      flush();
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const headingMatch = body.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
    if (headingMatch) {
      flush();
      const detected = sectionKindFromHeading(headingMatch[1]);
      if (detected) sectionKind = detected;
      sectionHeading = stripMarkdown(headingMatch[1]);
      sectionHeadingStartOffset = line.startOffset;
      continue;
    }
    if (!body.trim()) {
      flush();
      continue;
    }
    buffer.push(line);
  }
  flush();
  return paragraphs;
}

function byteOffset(source, charOffset) {
  return Buffer.byteLength(source.slice(0, charOffset), 'utf8');
}

function buildWindowCandidates(markdown, document) {
  const paragraphs = parseParagraphs(markdown);
  const windows = [];
  for (let start = 0; start <= paragraphs.length - 3; start += 1) {
    const slice = paragraphs.slice(start, start + 3);
    const kind = slice[0].sectionKind;
    if (!SECTION_KINDS.includes(kind) || slice.some(item => item.sectionKind !== kind)) continue;
    if (slice.some(item => item.wordCount < 12)) continue;
    const startOffset = slice[0].startOffset;
    const endOffset = slice.at(-1).endOffset;
    const text = markdown.slice(startOffset, endOffset);
    const words = wordCount(text);
    if (words < 150 || words > 1400) continue;
    const paragraphsWithOffsets = slice.map(item => ({
      paragraphId: `${document.documentId}:p${String(item.paragraphIndex).padStart(4, '0')}`,
      paragraphIndex: item.paragraphIndex,
      startOffset: item.startOffset,
      endOffset: item.endOffset,
      startByteOffset: byteOffset(markdown, item.startOffset),
      endByteOffset: byteOffset(markdown, item.endOffset),
      sha256: item.sha256,
      text: item.text
    }));
    windows.push({
      sectionKind: kind,
      sectionHeading: slice[0].sectionHeading,
      sectionHeadingStartOffset: slice[0].sectionHeadingStartOffset,
      paragraphStartIndex: slice[0].paragraphIndex,
      paragraphEndIndex: slice.at(-1).paragraphIndex,
      startOffset,
      endOffset,
      startByteOffset: byteOffset(markdown, startOffset),
      endByteOffset: byteOffset(markdown, endOffset),
      paragraphCount: slice.length,
      characterCount: text.length,
      byteCount: Buffer.byteLength(text, 'utf8'),
      wordCount: words,
      sha256: sha256(text),
      text,
      paragraphs: paragraphsWithOffsets
    });
  }
  return windows;
}

function deterministicRank(...parts) {
  return sha256([SAMPLING_SEED, ...parts].join('|'));
}

function chooseWindow(windows, desiredSection, document) {
  const desired = windows.filter(item => item.sectionKind === desiredSection);
  const pool = desired.length ? desired : windows;
  return [...pool].sort((left, right) => {
    const leftRank = deterministicRank(document.clusterId, desiredSection, left.sha256);
    const rightRank = deterministicRank(document.clusterId, desiredSection, right.sha256);
    return leftRank.localeCompare(rightRank);
  })[0] || null;
}

function rawRecord(document, window, splitLock) {
  const recordId = `scenario-${sha256([
    SAMPLING_SEED, document.clusterId, document.documentId, window.sectionKind,
    window.startByteOffset, window.sha256
  ].join('|')).slice(0, 20)}`;
  const doi = normalizeIdentifier(document.doi);
  const pmcid = String(document.pmcid || '').trim().toUpperCase();
  return {
    formatVersion: FORMAT_VERSION,
    recordId,
    split: document.split,
    annotationStatus: 'pending',
    labels: [],
    research: {
      studyType: document.studyType,
      samplingStratum: STUDY_STRATA[document.studyType]
    },
    source: {
      documentId: document.documentId,
      clusterId: document.clusterId,
      attachmentId: document.attachmentId,
      zoteroItemKeys: {
        attachment: document.attachmentKey,
        parent: document.parentItemKey
      },
      title: document.title,
      publicationYear: document.publicationYear,
      doi,
      pmid: String(document.pmid || ''),
      pmcid,
      sourceFilename: document.sourceFilename,
      mineruDirectory: document.mineruDirectory,
      markdownPath: document.markdownPath,
      markdownSha256: document.markdownSha256,
      normalizedTextSha256: document.normalizedTextSha256,
      splitManifestSeed: splitLock.seed,
      splitManifestSha256: splitLock.sha256,
      provenance: 'local_zotero_mineru_checkpoint2'
    },
    providerDataPolicy: {
      rawTextVisibility: 'private_local_only',
      publicIdentifierPresent: Boolean(doi || pmcid),
      eligibility: 'public_identifier_present_requires_human_confirmation',
      confidentialityFlag: 'not_indicated_in_source_manifest',
      externalUploadPerformed: false
    },
    section: {
      kind: window.sectionKind,
      heading: window.sectionHeading,
      headingSha256: sha256(window.sectionHeading),
      headingStartOffset: window.sectionHeadingStartOffset
    },
    window: {
      offsetUnit: 'utf16_code_units_and_utf8_bytes',
      ...window
    }
  };
}

function sanitizedRecord(record) {
  return {
    formatVersion: record.formatVersion,
    recordId: record.recordId,
    split: record.split,
    annotationStatus: record.annotationStatus,
    labels: record.labels,
    research: record.research,
    source: {
      documentId: record.source.documentId,
      clusterId: record.source.clusterId,
      zoteroItemKeys: record.source.zoteroItemKeys,
      title: record.source.title,
      publicationYear: record.source.publicationYear,
      doi: record.source.doi,
      pmid: record.source.pmid,
      pmcid: record.source.pmcid,
      mineruAliasPath: `$ZOTERO_MINERU_ROOT/${record.source.markdownPath}`,
      markdownSha256: record.source.markdownSha256,
      normalizedTextSha256: record.source.normalizedTextSha256,
      splitManifestSeed: record.source.splitManifestSeed,
      splitManifestSha256: record.source.splitManifestSha256,
      provenance: record.source.provenance
    },
    providerDataPolicy: record.providerDataPolicy,
    section: {
      kind: record.section.kind,
      headingSha256: record.section.headingSha256,
      headingStartOffset: record.section.headingStartOffset
    },
    window: {
      offsetUnit: record.window.offsetUnit,
      paragraphStartIndex: record.window.paragraphStartIndex,
      paragraphEndIndex: record.window.paragraphEndIndex,
      startOffset: record.window.startOffset,
      endOffset: record.window.endOffset,
      startByteOffset: record.window.startByteOffset,
      endByteOffset: record.window.endByteOffset,
      paragraphCount: record.window.paragraphCount,
      characterCount: record.window.characterCount,
      byteCount: record.window.byteCount,
      wordCount: record.window.wordCount,
      sha256: record.window.sha256,
      paragraphIdentities: record.window.paragraphs.map(paragraph => ({
        paragraphId: paragraph.paragraphId,
        paragraphIndex: paragraph.paragraphIndex,
        startOffset: paragraph.startOffset,
        endOffset: paragraph.endOffset,
        startByteOffset: paragraph.startByteOffset,
        endByteOffset: paragraph.endByteOffset,
        sha256: paragraph.sha256
      }))
    }
  };
}

function countBy(records, selector) {
  const counts = {};
  for (const record of records) {
    const key = selector(record);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function verifyCheckpointLock() {
  const manifestPath = path.join(checkpointDir, 'split-manifest.json');
  const lockPath = path.join(checkpointDir, 'split-manifest.lock');
  const text = fs.readFileSync(manifestPath, 'utf8');
  const lock = readJson(lockPath);
  if (sha256(text) !== lock.sha256 || Buffer.byteLength(text) !== lock.bytes) {
    throw new Error('Checkpoint2 split manifest does not match its authoritative lock.');
  }
  return { manifest: JSON.parse(text), lock };
}

export function buildCorpus() {
  if (!fs.existsSync(corpusRoot)) throw new Error(`MinerU corpus not found: ${corpusRoot}`);
  const { manifest: splitManifest, lock: splitLock } = verifyCheckpointLock();
  const splitByCluster = new Map(splitManifest.clusters.map(item => [item.clusterId, item.split]));
  const rows = readJsonl(path.join(checkpointDir, 'corpus-manifest.jsonl'))
    .filter(item => item.articleLike && STUDY_STRATA[item.studyType])
    .filter(item => normalizeIdentifier(item.doi) || String(item.pmcid || '').trim())
    .filter(item => splitByCluster.get(item.clusterId) === item.split)
    .filter(item => fs.existsSync(path.join(corpusRoot, item.markdownPath)));

  const candidatesByCluster = new Map();
  for (const row of rows) {
    const markdownFile = path.join(corpusRoot, row.markdownPath);
    const markdown = fs.readFileSync(markdownFile, 'utf8');
    if (sha256(markdown) !== row.markdownSha256) {
      throw new Error(`Source hash drift for ${row.documentId}: ${row.markdownPath}`);
    }
    const windows = buildWindowCandidates(markdown, row);
    if (!windows.length) continue;
    const prior = candidatesByCluster.get(row.clusterId);
    const score = Number(row.quality?.qualityScore || 0);
    if (!prior || score > prior.score || (score === prior.score && row.documentId < prior.document.documentId)) {
      candidatesByCluster.set(row.clusterId, { document: row, markdown, windows, score });
    }
  }

  const pool = [...candidatesByCluster.values()];
  const selected = [];
  const usedClusters = new Set();
  const identifierSplit = new Map();
  for (const split of SPLIT_ORDER) {
    for (const stratum of STRATUM_ORDER) {
      const target = STRATUM_TARGETS[split][stratum];
      const preferences = SECTION_PREFERENCES[stratum].slice(0, target);
      for (let index = 0; index < target; index += 1) {
        const desiredSection = preferences[index];
        const eligible = pool.filter(candidate => {
          const document = candidate.document;
          if (document.split !== split || STUDY_STRATA[document.studyType] !== stratum) return false;
          if (usedClusters.has(document.clusterId)) return false;
          const ids = [normalizeIdentifier(document.doi), String(document.pmcid || '').trim().toLowerCase()].filter(Boolean);
          return ids.every(identifier => !identifierSplit.has(identifier) || identifierSplit.get(identifier) === split);
        }).sort((left, right) => {
          const leftHas = left.windows.some(item => item.sectionKind === desiredSection) ? 0 : 1;
          const rightHas = right.windows.some(item => item.sectionKind === desiredSection) ? 0 : 1;
          if (leftHas !== rightHas) return leftHas - rightHas;
          const leftRank = deterministicRank(split, stratum, desiredSection, index, left.document.clusterId);
          const rightRank = deterministicRank(split, stratum, desiredSection, index, right.document.clusterId);
          return leftRank.localeCompare(rightRank);
        });
        const chosen = eligible[0];
        if (!chosen) throw new Error(`Insufficient candidates for ${split}/${stratum}: wanted ${target}.`);
        const window = chooseWindow(chosen.windows, desiredSection, chosen.document);
        const record = rawRecord(chosen.document, window, splitLock);
        selected.push(record);
        usedClusters.add(chosen.document.clusterId);
        for (const identifier of [record.source.doi, record.source.pmcid.toLowerCase()].filter(Boolean)) {
          identifierSplit.set(identifier, split);
        }
      }
    }
  }

  const publicRecords = selected.map(sanitizedRecord).sort((a, b) => a.recordId.localeCompare(b.recordId));
  const manifest = {
    formatVersion: FORMAT_VERSION,
    corpusName: 'Brevess scenario corpus v1 pilot',
    samplingSeed: SAMPLING_SEED,
    annotationPolicy: {
      annotationStatus: 'pending',
      labelsInitiallyEmpty: true,
      humanGoldClaimed: false,
      lockedTestTextVisibility: 'private_local_artifact_only'
    },
    taxonomy: SCENARIO_CATEGORIES,
    samplingPolicy: {
      unit: 'one_window_per_checkpoint2_document_cluster',
      window: 'three contiguous source paragraphs from one section',
      sections: SECTION_KINDS,
      sourcePreference: 'published papers with DOI or PMCID in the checkpoint2 manifest',
      splitAuthority: 'benchmarks/checkpoint2/split-manifest.lock',
      splitTargets: SPLIT_TARGETS,
      stratumTargets: STRATUM_TARGETS
    },
    provenance: {
      checkpoint2SplitSeed: splitLock.seed,
      checkpoint2SplitManifestSha256: splitLock.sha256,
      checkpoint2CorpusManifestSha256: sha256(fs.readFileSync(path.join(checkpointDir, 'corpus-manifest.jsonl'))),
      mineruRootAlias: '$ZOTERO_MINERU_ROOT',
      zoteroAccess: 'read_only_local_files',
      externalApiOrModelRequests: 0
    },
    counts: {
      total: publicRecords.length,
      bySplit: countBy(publicRecords, item => item.split),
      bySection: countBy(publicRecords, item => item.section.kind),
      byStudyType: countBy(publicRecords, item => item.research.studyType),
      bySamplingStratum: countBy(publicRecords, item => item.research.samplingStratum)
    },
    records: publicRecords
  };
  return { manifest, rawRecords: selected };
}

function jsonl(records) {
  return `${records.map(item => JSON.stringify(stableValue(item))).join('\n')}\n`;
}

function expectedOutputs(corpus) {
  const manifestText = stableJson(corpus.manifest);
  return new Map([
    [path.join(outputDir, 'manifest.json'), manifestText],
    [path.join(outputDir, 'manifest.lock.json'), stableJson({
      algorithm: 'sha256',
      bytes: Buffer.byteLength(manifestText),
      sha256: sha256(manifestText),
      samplingSeed: SAMPLING_SEED
    })],
    ...SPLIT_ORDER.map(split => [
      path.join(privateDir, `${split}.jsonl`),
      jsonl(corpus.rawRecords.filter(item => item.split === split).sort((a, b) => a.recordId.localeCompare(b.recordId)))
    ])
  ]);
}

function writeOrVerify(outputs, verify) {
  if (!verify) {
    fs.mkdirSync(outputDir, { recursive: true });
    fs.mkdirSync(privateDir, { recursive: true });
  }
  for (const [file, expected] of outputs) {
    if (verify) {
      if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== expected) {
        throw new Error(`Generated artifact is missing or stale: ${file}`);
      }
    } else {
      fs.writeFileSync(file, expected, 'utf8');
    }
  }
}

export function main(argv = process.argv.slice(2)) {
  const verify = argv.includes('--verify');
  const corpus = buildCorpus();
  writeOrVerify(expectedOutputs(corpus), verify);
  const summary = {
    mode: verify ? 'verify' : 'write',
    trackedManifest: path.join(outputDir, 'manifest.json'),
    privateDirectory: privateDir,
    counts: corpus.manifest.counts
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
