#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baselineDir = path.join(root, 'benchmarks', 'baseline');
const config = readJson(path.join(root, 'benchmarks', 'prompt-eval-config.json'));
const promptManifest = readJson(path.join(baselineDir, 'prompt-manifest.json'));
const schemaManifest = readJson(path.join(baselineDir, 'schema-manifest.json'));
const categoryManifest = readJson(path.join(baselineDir, 'category-manifest.json'));
const corpusSummary = readJson(path.join(baselineDir, 'zotero-regex-summary.json'));
const lock = readJson(path.join(baselineDir, 'prompt-manifest.lock'));
const reportArg = process.argv.indexOf('--report');
const reportPath = path.resolve(root, reportArg >= 0 && process.argv[reportArg + 1]
  ? process.argv[reportArg + 1]
  : path.join('output', 'prompt-benchmark', 'benchmark-latest.json'));

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
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

function ratio(numerator, denominator) {
  return denominator ? numerator / denominator : 1;
}

function promptText(record) {
  return Object.values(record.compiled || {}).filter(value => typeof value === 'string').join('\n');
}

const failures = [];
const warnings = [];

for (const [name, expected] of Object.entries(lock.artifacts || {})) {
  const file = path.join(baselineDir, name);
  if (!fs.existsSync(file)) {
    failures.push(`baseline:${name}:missing`);
    continue;
  }
  const bytes = fs.readFileSync(file);
  if (bytes.length !== expected.bytes || sha(bytes) !== expected.sha256) {
    failures.push(`baseline:${name}:lock-mismatch`);
  }
}

const sourceParityFailures = [];
const approvedSourceChanges = [];
const approvedSourceHashes = config.gates.approvedDeterministicSourceChanges || {};
for (const [source, expectedHash] of Object.entries(lock.productionSourceFiles || {})) {
  const file = path.join(root, source);
  const actualHash = fs.existsSync(file) ? sha(fs.readFileSync(file)) : '';
  if (actualHash === expectedHash) continue;
  if (actualHash && actualHash === String(approvedSourceHashes[source] || '').toLowerCase()) {
    approvedSourceChanges.push({ source, sha256: actualHash });
  } else {
    sourceParityFailures.push(source);
  }
}
if (config.gates.requireFrozenSourceParity && sourceParityFailures.length) {
  failures.push(`production-prompt-source-parity:${sourceParityFailures.join(',')}`);
}

const prompts = promptManifest.prompts || [];
const promptIds = prompts.map(item => item.id);
const duplicatePromptIds = promptIds.filter((id, index) => promptIds.indexOf(id) !== index);
if (duplicatePromptIds.length) failures.push(`duplicate-prompt-ids:${duplicatePromptIds.join(',')}`);
if (prompts.length !== promptManifest.productionPromptCount) failures.push('prompt-count-manifest-mismatch');

const families = {};
prompts.forEach(record => {
  const family = record.id.split('.')[0];
  (families[family] ||= []).push(record);
  if (sha(stableJson(record.compiled)) !== record.compiledSha256) {
    failures.push(`compiled-hash:${record.id}`);
  }
});
for (const [family, familyConfig] of Object.entries(config.promptFamilies || {})) {
  const actual = families[family]?.length || 0;
  if (actual !== familyConfig.exactCount) failures.push(`family-count:${family}:${actual}`);
}
for (const family of Object.keys(families)) {
  if (!config.promptFamilies[family]) failures.push(`unconfigured-prompt-family:${family}`);
}

const schemasById = new Map((schemaManifest.schemas || []).map(schema => [schema.id, schema]));
let validSchemaReferences = 0;
let schemaReferenceCount = 0;
prompts.forEach(record => {
  if (!record.responseSchemaId) return;
  schemaReferenceCount += 1;
  const schema = schemasById.get(record.responseSchemaId);
  if (!schema) {
    failures.push(`schema-reference:${record.id}`);
    return;
  }
  if (sha(stableJson(schema.schema)) !== schema.sha256 ||
      !(schema.promptIds || []).includes(record.id)) {
    failures.push(`schema-integrity:${record.id}`);
    return;
  }
  validSchemaReferences += 1;
});

const guardTerms = config.groundingGuardTerms.map(term => term.toLowerCase());
const evidenceTerms = config.evidenceLocatorTerms.map(term => term.toLowerCase());
const guardedPrompts = prompts.filter(record => {
  const text = promptText(record).toLowerCase();
  return guardTerms.some(term => text.includes(term));
});
const evidenceApplicable = prompts.filter(record =>
  config.promptFamilies[record.id.split('.')[0]]?.evidenceLocatorRequired
);
const evidenceLocated = evidenceApplicable.filter(record => {
  const text = promptText(record).toLowerCase();
  return evidenceTerms.some(term => text.includes(term));
});

const categories = Object.values(categoryManifest.categories || {});
const categoriesWithPositive = categories.filter(category =>
  (category.positiveExamples || category.prompt?.positiveExamples || []).length
);
const categoriesWithHardNegative = categories.filter(category =>
  (category.hardNegativeExamples || category.prompt?.negativeExamples || []).length
);

const promptCoverage = ratio(prompts.length, promptManifest.productionPromptCount);
const schemaIntegrity = ratio(validSchemaReferences, schemaReferenceCount);
const positiveCoverage = ratio(categoriesWithPositive.length, categories.length);
const hardNegativeCoverage = ratio(categoriesWithHardNegative.length, categories.length);
const guardCoverage = ratio(guardedPrompts.length, prompts.length);
const evidenceCoverage = ratio(evidenceLocated.length, evidenceApplicable.length);
const metricGates = [
  ['productionPromptCoverage', promptCoverage],
  ['schemaReferenceIntegrity', schemaIntegrity],
  ['categoryPositiveExampleCoverage', positiveCoverage],
  ['categoryHardNegativeCoverage', hardNegativeCoverage],
  ['groundingGuardCoverage', guardCoverage],
  ['applicableEvidenceLocatorCoverage', evidenceCoverage]
];
metricGates.forEach(([name, value]) => {
  if (value < Number(config.gates[name] || 0)) failures.push(`gate:${name}:${value}`);
});

const realCorpusAvailable = corpusSummary.available === true &&
  Number(corpusSummary.corpus?.selectedMarkdownFiles) > 0 &&
  Number(corpusSummary.metrics?.documents?.articleLike) > 0;
if (config.gates.requireRealCorpusProxy && !realCorpusAvailable) {
  failures.push('real-corpus-proxy:missing');
}

const compiledHashGroups = Object.groupBy
  ? Object.groupBy(prompts, record => record.compiledSha256)
  : prompts.reduce((groups, record) => {
    (groups[record.compiledSha256] ||= []).push(record);
    return groups;
  }, {});
const exactPromptDuplicates = Object.values(compiledHashGroups)
  .filter(group => group.length > 1)
  .map(group => group.map(record => record.id));
const schemaHashGroups = (schemaManifest.schemas || []).reduce((groups, schema) => {
  (groups[schema.sha256] ||= []).push(schema.id);
  return groups;
}, {});
const duplicateSchemas = Object.values(schemaHashGroups).filter(group => group.length > 1);

const totalEstimatedTokens = prompts.reduce((sum, record) =>
  sum + Number(record.size?.estimatedTokens || 0), 0);
const byFamily = Object.fromEntries(Object.entries(families).map(([family, records]) => [family, {
  prompts: records.length,
  schemas: records.filter(record => record.responseSchemaId).length,
  estimatedTokens: records.reduce((sum, record) => sum + Number(record.size?.estimatedTokens || 0), 0),
  groundingGuardCoverage: ratio(
    records.filter(record => guardedPrompts.includes(record)).length, records.length
  )
}]));

if (!sourceParityFailures.length && !approvedSourceChanges.length) {
  warnings.push('No production Prompt source changed from the frozen baseline; no unproven Prompt edit was promoted.');
}
if (approvedSourceChanges.length) {
  warnings.push('Only exact-hash deterministic Checkpoint 2 source changes differ from the frozen baseline.');
}
warnings.push('Precision, recall, F1, evidence-location accuracy and hallucination rate remain unscored until human-adjudicated model outputs exist.');

const report = {
  formatVersion: 1,
  generatedAt: new Date().toISOString(),
  execution: {
    networkUsed: false,
    providerCalls: 0,
    externalUploads: 0,
    fineTuningJobs: 0,
    rawCorpusTextWrittenToReport: false
  },
  baselineSource: promptManifest.baselineSource,
  gates: {
    passed: failures.length === 0,
    failures,
    warnings
  },
  coverage: {
    productionPrompts: { covered: prompts.length, total: promptManifest.productionPromptCount, ratio: promptCoverage },
    promptFamilies: byFamily,
    responseSchemas: { validReferences: validSchemaReferences, totalReferences: schemaReferenceCount, unique: schemasById.size },
    categories: {
      positiveExamples: categoriesWithPositive.length,
      hardNegatives: categoriesWithHardNegative.length,
      total: categories.length
    },
    groundingGuards: { covered: guardedPrompts.length, total: prompts.length, ratio: guardCoverage },
    evidenceLocators: { covered: evidenceLocated.length, applicable: evidenceApplicable.length, ratio: evidenceCoverage }
  },
  efficiency: {
    totalEstimatedInputTokensAcrossCompiledVariants: totalEstimatedTokens,
    method: 'ceil(compiled characters / 4); comparison proxy only',
    exactPromptDuplicateGroups: exactPromptDuplicates,
    duplicateSchemaGroups: duplicateSchemas
  },
  realCorpusProxy: {
    available: realCorpusAvailable,
    corpus: corpusSummary.corpus,
    documents: corpusSummary.metrics?.documents,
    structuredLabels: corpusSummary.metrics?.structuredLabels,
    regexCoverage: corpusSummary.metrics?.regexCoverage,
    collisionRatePer1000ActiveSentences:
      corpusSummary.metrics?.collisions?.activeRatePer1000ActiveSentences,
    qualification: 'Deterministic development proxy; not human-adjudicated scientific ground truth.'
  },
  modelQuality: {
    precision: null,
    recall: null,
    f1: null,
    evidenceLocationRate: null,
    hallucinationRate: null,
    reason: 'No human-adjudicated locked output set is present. Model-generated labels are not treated as human gold.'
  },
  sourceParity: {
    passed: sourceParityFailures.length === 0,
    changedProductionPromptSources: sourceParityFailures,
    approvedDeterministicSourceChanges: approvedSourceChanges
  }
};

fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, stableJson(report), 'utf8');
console.log(JSON.stringify({
  passed: report.gates.passed,
  prompts: report.coverage.productionPrompts,
  schemas: report.coverage.responseSchemas,
  categories: report.coverage.categories,
  groundingGuards: report.coverage.groundingGuards,
  evidenceLocators: report.coverage.evidenceLocators,
  realCorpusDocuments: report.realCorpusProxy.documents,
  modelQuality: report.modelQuality,
  report: path.relative(root, reportPath),
  failures
}, null, 2));
if (failures.length) process.exitCode = 1;
