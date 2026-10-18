#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baselineDir = path.join(root, 'benchmarks', 'baseline');
const out = path.join(root, 'benchmarks', 'checkpoint2');
fs.mkdirSync(out, { recursive: true });

require('../core/category-store.js');
require('../core/adaptive-catalog.js');
require('../providers/provider-utils.js');
require('../core/prompt-compiler.js');
require('../core/figure-panel-planner.js');
require('../core/figure-analysis.js');
require('../core/provider-probes.js');
const categories = require('../core/category-store.js');
const promptCompiler = require('../core/prompt-compiler.js');
const figure = require('../core/figure-analysis.js');
const probesApi = require('../core/provider-probes.js');

const baseline = readJson(path.join(baselineDir, 'prompt-manifest.json'));
const schemas = readJson(path.join(baselineDir, 'schema-manifest.json'));
const schemaById = new Map(schemas.schemas.map(item => [item.id, item]));

const hashGroups = new Map();
for (const item of baseline.prompts) {
  if (!hashGroups.has(item.compiledSha256)) hashGroups.set(item.compiledSha256, []);
  hashGroups.get(item.compiledSha256).push(item);
}
const orderedGroups = [...hashGroups.values()].sort((left, right) =>
  left[0].id.localeCompare(right[0].id));
const recordIdByHash = new Map(orderedGroups.map((group, index) => [
  group[0].compiledSha256, `prompt-record-${String(index + 1).padStart(3, '0')}`
]));
const mapRows = [];
for (const item of baseline.prompts) {
  const group = hashGroups.get(item.compiledSha256);
  const shared = group.length > 1;
  const schema = item.responseSchemaId ? schemaById.get(item.responseSchemaId) : null;
  mapRows.push({
    record_id: recordIdByHash.get(item.compiledSha256),
    variant_id: item.id,
    compiler: item.compiler,
    source: item.source,
    schema: schema?.schemaName || item.responseSchemaId || '',
    included_in_51: 'yes',
    included_in_52: 'yes',
    difference_reason: shared
      ? `Compiled Prompt text is shared by ${group.map(entry => entry.id).join(' + ')}; response Schema/variant semantics differ, so one review record maps to ${group.length} production variants.`
      : 'One compiled Prompt review record maps to one production variant.'
  });
}
const mapCsv = csv(mapRows);
fs.writeFileSync(path.join(baselineDir, 'prompt-record-to-variant-map.csv'), mapCsv, 'utf8');
fs.writeFileSync(path.join(out, 'Checkpoint2_Prompt_Record_Variant_Map.csv'), mapCsv, 'utf8');

const figureInput = {
  figureId: 'figure-2', figureLabel: 'Figure 2', articleTitle: 'Synthetic mechanism paper',
  caption: 'Figure 2. (A) Treatment reduced the outcome. (B) Mediator blockade abolished the treatment effect.',
  panelHints: ['A', 'B'], contextParagraphs: [
    { paragraphId: 'baseline-results-1', sectionTitle: 'Results', sectionKind: 'results',
      text: 'Blocking mediator M reduced the treatment-induced outcome, whereas reactivating M restored the same outcome in an independent model.' },
    { paragraphId: 'baseline-discussion-1', sectionTitle: 'Discussion', sectionKind: 'discussion',
      text: 'The authors interpret mediator M as necessary but note that the evidence does not establish sufficiency in humans.' }
  ]
};
const currentRecords = baseline.prompts
  .filter(item => item.id !== 'provider.codex-local.connection-test')
  .map(item => structuredClone(item));
const panelDiffs = [];
for (const analysisDepth of ['standard', 'deep']) {
  for (const visualInput of [false, true]) {
    const suffix = `${analysisDepth}.${visualInput ? 'vision' : 'text'}`;
    const id = `figure.panel-batch.${suffix}`;
    const item = currentRecords.find(record => record.id === id);
    const before = baseline.prompts.find(record => record.id === id);
    const compiledRaw = figure.compileFigurePanelBatchPrompt(
      figureInput, { analysisDepth, visualInput }
    );
    const responseSchema = compiledRaw.responseSchema;
    const compiled = structuredClone(compiledRaw);
    delete compiled.responseSchema;
    item.compiled = compiled;
    item.compiledSha256 = sha(stableJson(compiled));
    item.size = sizeOf(compiled);
    panelDiffs.push({ id, before, after: item, responseSchema });
  }
}
for (const probe of probesApi.compileProviderCapabilityProbes({ supportsVision: true })) {
  const compiled = structuredClone(probe.request);
  const responseSchema = compiled.responseSchema;
  delete compiled.responseSchema;
  const id = `provider.probe.${probe.id}`;
  currentRecords.push({
    id,
    compiler: 'compileProviderCapabilityProbes',
    variant: { mode: probe.mode, required: probe.required },
    source: 'core/provider-probes.js',
    responseSchema: responseSchema || null,
    compiledSha256: sha(stableJson(compiled)),
    size: sizeOf(compiled),
    compiled
  });
}
currentRecords.sort((left, right) => left.id.localeCompare(right.id));
const currentReview = {
  formatVersion: 1,
  generatedAt: new Date().toISOString(),
  status: 'candidate_review_only',
  productionDefaultPromotion: false,
  frozenBaselineVariants: 52,
  currentReviewVariants: currentRecords.length,
  providerCalls: 0,
  prompts: currentRecords
};
fs.writeFileSync(path.join(out, 'prompt-review-current.json'), stableJson(currentReview), 'utf8');
fs.writeFileSync(path.join(out, 'prompt-review-current.md'), promptReviewMarkdown(currentReview), 'utf8');
fs.writeFileSync(path.join(out, 'Checkpoint2_Prompt_Diff.md'), promptDiffMarkdown(panelDiffs), 'utf8');

const connectionParagraphs = [
  { paragraphId: 'connection-p1', sectionTitle: '', text: 'Treatment increased survival.' }
];
const oldConnection = promptCompiler.compileAnalysisPrompt({
  categories: [categories.createBuiltInCategories().result],
  chunkId: 'connection-test', sectionTitle: '', paragraphs: connectionParagraphs
});
const oldTokens = estimatePrompt(oldConnection);
const probeRows = probesApi.compileProviderCapabilityProbes({ supportsVision: true }).map(probe => ({
  probe_id: probe.id,
  mode: probe.mode,
  required: probe.required,
  input_tokens: probe.estimatedInputTokens,
  token_source: 'estimated',
  provider_calls_in_report: 0
}));
const newTotal = probeRows.reduce((sum, row) => sum + row.input_tokens, 0);
const tokenReport = {
  formatVersion: 1,
  generatedAt: new Date().toISOString(),
  comparisonStatus: 'offline_compiled_estimate',
  providerCalls: 0,
  measuredProviderTokens: null,
  estimator: 'ceil((systemPrompt chars + userPrompt chars)/4) + 256 per probe image',
  legacyFullAnalysisConnectionTest: {
    inputTokens: oldTokens, systemChars: oldConnection.systemPrompt.length,
    userChars: oldConnection.userPrompt.length
  },
  minimalCapabilityProbes: { inputTokens: newTotal, probes: probeRows },
  estimatedReduction: {
    tokens: oldTokens - newTotal,
    percent: Number(((oldTokens - newTotal) / oldTokens * 100).toFixed(2))
  },
  qualification: 'Estimated comparison only. Runtime measured tokens are captured from provider telemetry when probes are actually run.'
};
fs.writeFileSync(path.join(out, 'token-probe-comparison.json'), stableJson(tokenReport), 'utf8');
fs.writeFileSync(path.join(out, 'token-probe-comparison.csv'), csv([
  { probe_id: 'legacy_full_analysis_connection_test', mode: 'structured', required: true,
    input_tokens: oldTokens, token_source: 'estimated', provider_calls_in_report: 0 },
  ...probeRows,
  { probe_id: 'minimal_probe_suite_total', mode: 'all', required: true,
    input_tokens: newTotal, token_source: 'estimated', provider_calls_in_report: 0 }
]), 'utf8');
fs.writeFileSync(path.join(out, 'Checkpoint2_Token_Probe_Comparison.md'), tokenMarkdown(tokenReport), 'utf8');

console.log(JSON.stringify({
  baselineVariants: baseline.prompts.length,
  baselineReviewRecords: hashGroups.size,
  currentReviewVariants: currentRecords.length,
  panelVariantsChanged: panelDiffs.length,
  legacyConnectionEstimatedTokens: oldTokens,
  minimalProbeSuiteEstimatedTokens: newTotal,
  estimatedReductionPercent: tokenReport.estimatedReduction.percent
}, null, 2));

function sizeOf(compiled) {
  const systemChars = String(compiled.systemPrompt || '').length;
  const userChars = String(compiled.userPrompt || compiled.agentPrompt || '').length;
  return { systemChars, userChars, totalChars: systemChars + userChars,
    estimatedTokensMethod: 'ceil(totalChars/4); provider usage remains authoritative',
    estimatedTokens: Math.ceil((systemChars + userChars) / 4) };
}
function estimatePrompt(compiled) { return sizeOf(compiled).estimatedTokens; }
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function sha(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function stable(value) { return Array.isArray(value) ? value.map(stable)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value; }
function stableJson(value) { return `${JSON.stringify(stable(value), null, 2)}\n`; }
function csv(rows) {
  const headers = Object.keys(rows[0]);
  const esc = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
  return `${headers.map(esc).join(',')}\n${rows.map(row =>
    headers.map(header => esc(row[header])).join(',')).join('\n')}\n`;
}
function promptReviewMarkdown(review) {
  const lines = [
    '# Checkpoint 2 Current Prompt Review', '',
    `- Frozen baseline variants: ${review.frozenBaselineVariants}`,
    `- Current review variants: ${review.currentReviewVariants}`,
    '- Status: candidate review only; no quality-based production promotion',
    '- Provider calls in this artifact: 0', ''
  ];
  for (const item of review.prompts) {
    lines.push(`## ${item.id}`, '', `Compiler: \`${item.compiler}\`  `,
      `Source: \`${item.source}\`  `, `Compiled SHA-256: \`${item.compiledSha256}\`  `,
      `Estimated input tokens: ${item.size.estimatedTokens}`, '', '```text',
      String(item.compiled.systemPrompt || item.compiled.agentPrompt || ''), '```', '',
      ...(item.compiled.userPrompt ? ['```json', item.compiled.userPrompt, '```', ''] : []));
  }
  return `${lines.join('\n')}\n`;
}
function promptDiffMarkdown(items) {
  const lines = ['# Checkpoint 2 Panel Extraction Prompt Diff', '',
    'Only the four Panel extraction variants changed. Figure-level synthesis remains owned by `figure.synthesis.*`.', ''];
  for (const item of items) {
    const before = String(item.before.compiled.systemPrompt || '');
    const after = String(item.after.compiled.systemPrompt || '');
    lines.push(`## ${item.id}`, '',
      `- Before SHA-256: \`${item.before.compiledSha256}\` (${item.before.size.estimatedTokens} estimated input tokens)`,
      `- After SHA-256: \`${item.after.compiledSha256}\` (${item.after.size.estimatedTokens} estimated input tokens)`,
      `- Removed extraction-pass synthesis fields: ${['argument_chain','panel_groups','logic_bridges','author_assembly'].filter(term => before.includes(term) && !after.includes(term)).join(', ') || 'confirmed absent'}`,
      '', '### Before', '', '```text', before, '```', '', '### After', '', '```text', after, '```', '');
  }
  return `${lines.join('\n')}\n`;
}
function tokenMarkdown(report) {
  const rows = report.minimalCapabilityProbes.probes.map(item =>
    `| ${item.probe_id} | ${item.mode} | ${item.input_tokens} | estimated |`).join('\n');
  return `# Checkpoint 2 Provider Probe Token Comparison\n\n` +
    `No Provider was called for this report. Values are compiled-input estimates, not measured billing tokens.\n\n` +
    `| Probe | Mode | Input tokens | Source |\n|---|---:|---:|---|\n` +
    `| legacy full analysis connection test | structured | ${report.legacyFullAnalysisConnectionTest.inputTokens} | estimated |\n` +
    `${rows}\n| minimal suite total | all | ${report.minimalCapabilityProbes.inputTokens} | estimated |\n\n` +
    `Estimated suite reduction: ${report.estimatedReduction.tokens} tokens (${report.estimatedReduction.percent}%). ` +
    `Measured per-probe input tokens will be reported from Provider telemetry after an authorized real run.\n`;
}
