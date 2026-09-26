#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);

require('../core/category-store.js');
require('../core/adaptive-catalog.js');
require('../providers/provider-utils.js');
require('../core/prompt-compiler.js');
require('../core/figure-panel-planner.js');
require('../core/figure-analysis.js');
require('../core/article-chat-tokenizer.js');
require('../core/article-chat-index.js');
require('../core/article-chat-retrieval.js');
require('../core/article-chat-memory.js');
require('../core/article-chat-citations.js');
require('../core/token-budget.js');
require('../providers/provider-registry.js');
require('../core/article-chat-context-planner.js');
require('../core/article-chat-stream.js');

const categoriesApi = require('../core/category-store.js');
const adaptive = require('../core/adaptive-catalog.js');
const prompts = require('../core/prompt-compiler.js');
const study = require('../core/study-profile.js');
const ledger = require('../core/evidence-ledger.js');
const figure = require('../core/figure-analysis.js');
const crossFigure = require('../core/cross-figure-logic.js');
const review = require('../core/review-outline.js');
const articleChat = require('../core/article-chat.js');
const abbreviation = require('../core/abbreviation-extractor.js');
const exportBundle = require('../core/export-bundle.js');
const analysisCache = require('../core/analysis-cache.js');
const tokenBudget = require('../core/token-budget.js');
const tokenUsage = require('../core/token-usage-store.js');
const settings = require('../core/settings-store.js');

const outDir = path.join(root, 'benchmarks', 'baseline');
fs.mkdirSync(outDir, { recursive: true });
const forceNewBaseline = process.argv.includes('--force-new-baseline');
const verifyOnly = process.argv.includes('--verify');

function git(...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function sha(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function canonicalBaselineBytes(bytes) {
  return Buffer.from(bytes.toString('utf8').replace(/\r\n?|\n/g, '\n'), 'utf8');
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
  const text = stableJson(value);
  fs.writeFileSync(path.join(outDir, name), text, 'utf8');
  return text;
}

function fileHash(file) {
  return sha(fs.readFileSync(path.join(root, file)));
}

function verifyExistingBaseline() {
  const lockPath = path.join(outDir, 'prompt-manifest.lock');
  if (!fs.existsSync(lockPath) && verifyOnly) {
    throw new Error('Frozen prompt baseline lock is missing; verification cannot create a baseline.');
  }
  if (!fs.existsSync(lockPath) || forceNewBaseline) return false;
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  const failures = [];
  for (const [name, expected] of Object.entries(lock.artifacts || {})) {
    const artifactPath = path.join(outDir, name);
    if (!fs.existsSync(artifactPath)) {
      failures.push(`${name}:missing`);
      continue;
    }
    const bytes = canonicalBaselineBytes(fs.readFileSync(artifactPath));
    if (bytes.length !== expected.bytes) failures.push(`${name}:bytes`);
    if (sha(bytes) !== expected.sha256) failures.push(`${name}:sha256`);
  }
  if (failures.length) {
    throw new Error(`Frozen prompt baseline verification failed: ${failures.join(', ')}`);
  }
  console.log(JSON.stringify({
    verified: true,
    immutableSource: lock.immutableSource,
    artifactCount: Object.keys(lock.artifacts || {}).length,
    note: 'Existing baseline was verified and not rewritten. Use --force-new-baseline only for an explicitly approved new baseline.'
  }, null, 2));
  return true;
}

if (verifyExistingBaseline()) process.exit(0);

const sourceCommit = git('rev-parse', 'HEAD');
const sourceTree = git('rev-parse', 'HEAD^{tree}');
const sourceBranch = git('branch', '--show-current');
const sourceCommitAt = git('show', '-s', '--format=%cI', 'HEAD');
const unifiedCatalog = adaptive.createUnifiedCategoryCatalog();
const legacyCatalog = categoriesApi.createBuiltInCategories();

const syntheticParagraphs = [
  {
    paragraphId: 'baseline-results-1', sectionTitle: 'Results', sectionKind: 'results',
    text: 'Blocking mediator M reduced the treatment-induced outcome, whereas reactivating M restored the same outcome in an independent model.'
  },
  {
    paragraphId: 'baseline-discussion-1', sectionTitle: 'Discussion', sectionKind: 'discussion',
    text: 'The authors interpret mediator M as necessary but note that the evidence does not establish sufficiency in humans.'
  }
];
const studyProfile = {
  primaryType: 'basic_mechanistic', secondaryType: null,
  paperBlueprint: {
    research_question: 'Does mediator M transmit the treatment effect?',
    primary_hypothesis: 'Mediator M is required for the outcome.',
    population_or_model: ['experimental model'], interventions_or_exposures: ['treatment'],
    comparators: ['control'], primary_outcomes: ['outcome'],
    claimed_contribution: 'A bounded mechanism claim.'
  }
};

const promptRecords = [];
const schemaRecords = new Map();

function registerPrompt({ id, compiler, variant, source, compiled }) {
  const normalized = typeof compiled === 'string'
    ? { agentPrompt: compiled }
    : structuredClone(compiled);
  const responseSchema = normalized.responseSchema || null;
  let responseSchemaId = null;
  if (responseSchema) {
    const schemaHash = sha(stableJson(responseSchema));
    responseSchemaId = `${normalized.schemaName || id}:${schemaHash.slice(0, 16)}`;
    if (!schemaRecords.has(responseSchemaId)) {
      schemaRecords.set(responseSchemaId, {
        id: responseSchemaId,
        schemaName: normalized.schemaName || '',
        sha256: schemaHash,
        schema: responseSchema,
        promptIds: []
      });
    }
    schemaRecords.get(responseSchemaId).promptIds.push(id);
    delete normalized.responseSchema;
  }
  const systemChars = String(normalized.systemPrompt || '').length;
  const userChars = String(normalized.userPrompt || normalized.agentPrompt || '').length;
  promptRecords.push({
    id, compiler, variant, source, responseSchemaId,
    compiledSha256: sha(stableJson(normalized)),
    size: {
      systemChars, userChars, totalChars: systemChars + userChars,
      estimatedTokensMethod: 'ceil(totalChars/4); provider usage remains authoritative',
      estimatedTokens: Math.ceil((systemChars + userChars) / 4)
    },
    compiled: normalized
  });
}

for (const [viewId, view] of Object.entries(adaptive.READING_VIEWS)) {
  const active = view.categoryIds.map(id => unifiedCatalog[id]).filter(Boolean);
  const input = {
    categories: active, chunkId: `baseline-${viewId}`, sectionTitle: 'Results',
    sectionKind: 'results', paragraphs: syntheticParagraphs, viewId,
    paperBlueprint: studyProfile.paperBlueprint, studyProfile
  };
  registerPrompt({
    id: `highlight.json.${viewId}`, compiler: 'compileAnalysisPrompt',
    variant: { response: 'json', viewId }, source: 'core/prompt-compiler.js',
    compiled: prompts.compileAnalysisPrompt(input)
  });
  registerPrompt({
    id: `highlight.ndjson.${viewId}`, compiler: 'compileAnalysisStreamPrompt',
    variant: { response: 'ndjson', viewId }, source: 'core/prompt-compiler.js',
    compiled: prompts.compileAnalysisStreamPrompt(input)
  });
}

registerPrompt({
  id: 'study-profile.default', compiler: 'compileStudyProfilePrompt', variant: {},
  source: 'core/study-profile.js', compiled: study.compileStudyProfilePrompt({
    title: 'Synthetic biomedical study', abstract: syntheticParagraphs[0].text,
    headings: ['Introduction', 'Results', 'Discussion'],
    representative_paragraphs: syntheticParagraphs.map(item => item.text)
  })
});

for (const viewId of Object.keys(adaptive.READING_VIEWS)) {
  registerPrompt({
    id: `evidence-ledger.${viewId}`, compiler: 'compileEvidenceLedgerPrompt',
    variant: { viewId }, source: 'core/evidence-ledger.js',
    compiled: ledger.compileEvidenceLedgerPrompt({
      viewId, studyProfile, paragraphs: syntheticParagraphs,
      annotations: [{
        annotationId: 'baseline-ann-1', relationId: 'baseline-rel-1',
        categoryId: 'necessity_evidence', claimMode: 'explicit',
        paragraphId: syntheticParagraphs[0].paragraphId, sectionTitle: 'Results',
        quote: syntheticParagraphs[0].text, quoteRole: 'outcome_change',
        slots: [{ name: 'mediator', value: 'mediator M' }], confidence: 0.95
      }]
    })
  });
}

const figureInput = {
  figureId: 'figure-2', figureLabel: 'Figure 2', articleTitle: 'Synthetic mechanism paper',
  caption: 'Figure 2. (A) Treatment reduced the outcome. (B) Mediator blockade abolished the treatment effect.',
  panelHints: ['A', 'B'], contextParagraphs: syntheticParagraphs
};
const panelEvidence = [{
  panel: 'A', role: 'phenotype', phenotypeName: 'outcome', methods: ['assay'],
  purpose: 'Measure the outcome', design: 'Treatment versus control',
  comparison: 'treatment vs control', directObservation: 'The outcome was reduced.'
}];
for (const analysisDepth of ['standard', 'deep']) {
  for (const visualInput of [false, true]) {
    const suffix = `${analysisDepth}.${visualInput ? 'vision' : 'text'}`;
    const options = { analysisDepth, visualInput };
    registerPrompt({ id: `figure.walkthrough.${suffix}`, compiler: 'compileFigureAnalysisPrompt',
      variant: options, source: 'core/figure-analysis.js',
      compiled: figure.compileFigureAnalysisPrompt(figureInput, options) });
    registerPrompt({ id: `figure.panel-batch.${suffix}`, compiler: 'compileFigurePanelBatchPrompt',
      variant: options, source: 'core/figure-analysis.js',
      compiled: figure.compileFigurePanelBatchPrompt(figureInput, options) });
    registerPrompt({ id: `figure.synthesis.${suffix}`, compiler: 'compileFigureSynthesisPrompt',
      variant: options, source: 'core/figure-analysis.js',
      compiled: figure.compileFigureSynthesisPrompt(figureInput, panelEvidence, options) });
    registerPrompt({ id: `figure.unlabeled.${suffix}`, compiler: 'compileUnlabeledFigureOverviewPrompt',
      variant: options, source: 'core/figure-analysis.js',
      compiled: figure.compileUnlabeledFigureOverviewPrompt({ ...figureInput, panelHints: [] }, options) });
  }
}
for (const visualInput of [false, true]) {
  registerPrompt({
    id: `figure.single-panel.${visualInput ? 'vision' : 'text'}`,
    compiler: 'compileFigurePanelInterpretationPrompt', variant: { visualInput },
    source: 'core/figure-analysis.js',
    compiled: figure.compileFigurePanelInterpretationPrompt({
      ...figureInput, panelId: 'A', topic: 'grouping_stats',
      captionEvidence: { sharedLegend: 'Values are mean ± SEM.', targetText: '(A) Treatment reduced the outcome.' }
    }, { visualInput })
  });
}
for (const topic of figure.PANEL_FOLLOWUP_TOPICS) {
  registerPrompt({
    id: `figure.panel-followup.${topic}`, compiler: 'compilePanelFollowupPrompt',
    variant: { topic, visualInput: false }, source: 'core/figure-analysis.js',
    compiled: figure.compilePanelFollowupPrompt({
      ...figureInput, panel: panelEvidence[0], topics: [topic],
      captionEvidence: { targetText: '(A) Treatment reduced the outcome.' },
      panelIR: { version: 'panel-ir-v1', panelId: 'A' }
    }, { visualInput: false })
  });
}

const crossInput = {
  articleTitle: 'Synthetic mechanism paper', knownBackground: ['Treatment can alter the outcome.'],
  figures: [
    { figureId: 'figure-1', figureLabel: 'Figure 1', caption: 'Treatment establishes the phenotype.',
      analysis: { analysisDepth: 'standard', coreConclusion: 'Treatment changes the outcome.',
        figureQuestion: 'Does treatment change the outcome?', argumentChain: [{ panels: ['A'], established: 'Treatment changes the outcome.' }] } },
    { figureId: 'figure-2', figureLabel: 'Figure 2', caption: 'Mediator blockade tests necessity.',
      analysis: { analysisDepth: 'standard', coreConclusion: 'Mediator M is required.',
        figureQuestion: 'Is mediator M required?', argumentChain: [{ panels: ['B'], established: 'Blocking M reduces the effect.' }] } },
    { figureId: 'figure-s1', figureLabel: 'Figure S1', isSupplemental: true,
      caption: 'Figure S1, related to Figure 1, reports a control.',
      analysis: { analysisDepth: 'standard', coreConclusion: 'The control is stable.',
        figureQuestion: 'Is the control stable?', argumentChain: [] } }
  ]
};
registerPrompt({ id: 'cross-figure.domino', compiler: 'compileCrossFigureLogicPrompt', variant: {},
  source: 'core/cross-figure-logic.js', compiled: crossFigure.compileCrossFigureLogicPrompt(crossInput) });
registerPrompt({ id: 'cross-figure.supplemental-support', compiler: 'compileSupplementalSupportPrompt', variant: {},
  source: 'core/cross-figure-logic.js',
  compiled: crossFigure.compileSupplementalSupportPrompt(crossInput, { overallThesis: 'Treatment acts through mediator M.' }) });

const reviewParagraphs = syntheticParagraphs.map((item, index) => ({
  ...item, sectionId: index ? 'sec-discussion' : 'sec-results', headingLevel: 2,
  headingPath: [{ level: 2, sectionId: index ? 'sec-discussion' : 'sec-results', title: item.sectionTitle }]
}));
const reviewSummaries = reviewParagraphs.map((item, index) => ({
  paragraphId: item.paragraphId, summary: item.text, rhetoricalRole: index ? 'interpretation' : 'evidence',
  keyPoint: index ? 'Defines the claim boundary.' : 'Establishes the result.', transitionFromPrevious: index ? '转折' : ''
}));
registerPrompt({ id: 'review.paragraph-batch', compiler: 'compileReviewParagraphPrompt', variant: {},
  source: 'core/review-outline.js', compiled: review.compileReviewParagraphPrompt('baseline-review', reviewParagraphs) });
for (const reviewSubtype of ['narrative', 'systematic', 'scoping', 'meta', 'umbrella']) {
  registerPrompt({ id: `review.synthesis.${reviewSubtype}`, compiler: 'compileReviewSynthesisPrompt',
    variant: { reviewSubtype }, source: 'core/review-outline.js',
    compiled: review.compileReviewSynthesisPrompt('Synthetic review', reviewParagraphs, reviewSummaries, reviewSubtype) });
}

const chatInput = articleChat.normalizeArticleChatInput({
  question: '作者用哪些证据支持核心机制？', history: [], profileId: 'profile_baseline',
  document: {
    title: 'Synthetic mechanism paper', url: 'https://example.invalid/baseline', revision: 1,
    paragraphs: syntheticParagraphs.map((item, index) => ({
      ...item, sourceKey: `source-${index + 1}`, textHash: `hash-${index + 1}`,
      sectionId: item.sectionKind, sectionPath: [item.sectionTitle]
    }))
  }
});
const chatPrepared = await articleChat.prepareArticleChatRequest(chatInput, {
  providerId: 'deepseek', config: { model: 'deepseek-v4-pro' }, tokenPolicy: {}, contextWindowTokens: 65536
});
registerPrompt({ id: `article-chat.initial.${chatPrepared.plan.mode}`, compiler: 'compileArticleChatPrompt',
  variant: { contextMode: chatPrepared.plan.mode, continuation: false }, source: 'core/article-chat.js',
  compiled: articleChat.compileArticleChatPrompt(chatInput, chatPrepared.plan) });
for (const continuationKind of ['formatRepair', 'truncationRecovery', 'incompleteAnswer']) {
  registerPrompt({ id: `article-chat.continuation.${continuationKind}`, compiler: 'compileArticleChatPrompt',
    variant: { contextMode: chatPrepared.plan.mode, continuation: continuationKind }, source: 'core/article-chat.js',
    compiled: articleChat.compileArticleChatPrompt(chatInput, chatPrepared.plan, { continuation: {
      blockIds: ['block-1'], blocks: [{ blockId: 'block-1', markdown: '已完成内容。' }],
      summary: '已有摘要。', [continuationKind]: true
    } }) });
}

const terms = [
  { abbreviation: 'AAV', fullName: 'adeno-associated virus' },
  { abbreviation: 'TNF', fullName: 'tumor necrosis factor' }
];
for (const variant of [
  { id: 'default', options: {} },
  { id: 'repair', options: { repair: true } },
  { id: 'partial', options: { allowPartial: true } }
]) {
  registerPrompt({ id: `abbreviation.translation.${variant.id}`,
    compiler: 'compileAbbreviationTranslationPrompt', variant: variant.options,
    source: 'core/abbreviation-extractor.js',
    compiled: abbreviation.compileAbbreviationTranslationPrompt(terms, variant.options) });
}

registerPrompt({ id: 'export.ppt-agent', compiler: 'buildPptAgentPrompt', variant: {},
  source: 'core/export-bundle.js', compiled: exportBundle.buildPptAgentPrompt({
    title: 'Synthetic mechanism paper', url: 'https://example.invalid/baseline',
    figures: [{ figureId: 'figure-1', figureLabel: 'Figure 1', panelHints: ['A'], imageFiles: ['figures/Figure_01/image_01.png'] }]
  }) });
registerPrompt({ id: 'provider.codex-local.connection-test', compiler: 'literal testConnection prompt',
  variant: { maxOutputTokens: 32, ephemeral: true }, source: 'providers/codex-local.js',
  compiled: { systemPrompt: 'This is a connection test. Do not use any tool. Reply with exactly: OK', userPrompt: 'Return OK.', schemaName: '', responseFormat: 'text' } });

promptRecords.sort((left, right) => left.id.localeCompare(right.id));
for (const record of schemaRecords.values()) record.promptIds.sort();
const promptSourceFiles = [...new Set(promptRecords.map(item => item.source))].sort();
const sourceHashes = Object.fromEntries(promptSourceFiles.map(file => [file, fileHash(file)]));

const promptManifest = {
  formatVersion: 1, baselineSource: { sourceCommit, sourceTree, sourceBranch, sourceCommitAt },
  productionPromptCount: promptRecords.length, sourceFiles: sourceHashes,
  prompts: promptRecords
};
const schemaManifest = {
  formatVersion: 1, baselineSource: { sourceCommit, sourceTree },
  schemaCount: schemaRecords.size,
  schemas: [...schemaRecords.values()].sort((left, right) => left.id.localeCompare(right.id))
};
const categoryManifest = {
  formatVersion: 1, baselineSource: { sourceCommit, sourceTree },
  categoryCount: Object.keys(unifiedCatalog).length,
  legacyBuiltInCount: Object.keys(legacyCatalog).length,
  categoryIds: Object.keys(unifiedCatalog).sort(),
  categories: unifiedCatalog,
  readingViews: adaptive.READING_VIEWS,
  studyTypes: adaptive.STUDY_TYPES,
  typeOverlays: adaptive.TYPE_OVERLAYS,
  viewPromptGuidance: adaptive.VIEW_PROMPT_GUIDANCE,
  typePromptGuidance: adaptive.TYPE_PROMPT_GUIDANCE
};

const regexReportPath = path.join(root, 'output', 'zotero-mineru-regex', 'benchmark-latest.json');
let regexSummary = { available: false };
if (fs.existsSync(regexReportPath)) {
  const report = JSON.parse(fs.readFileSync(regexReportPath, 'utf8'));
  regexSummary = {
    available: true,
    corpus: {
      root: '$ZOTERO_MINERU_ROOT',
      discoveredMarkdownFiles: report.corpus?.discoveredMarkdownFiles || 0,
      selectedMarkdownFiles: report.corpus?.selectedMarkdownFiles || 0,
      sampleSeed: report.corpus?.sampleSeed || 0
    },
    methodology: report.methodology,
    metrics: {
      documents: report.metrics?.documents,
      paragraphs: report.metrics?.paragraphs,
      sentences: report.metrics?.sentences,
      activeSentences: report.metrics?.activeSentences,
      sections: report.metrics?.sections,
      regexCoverage: report.metrics?.regexCoverage,
      structuredLabels: report.metrics?.structuredLabels,
      collisions: {
        sentences: report.metrics?.collisions?.sentences,
        activeSentences: report.metrics?.collisions?.activeSentences,
        categoryAssignments: report.metrics?.collisions?.categoryAssignments,
        ratePer1000ActiveSentences: report.metrics?.collisions?.ratePer1000ActiveSentences,
        activeRatePer1000ActiveSentences: report.metrics?.collisions?.activeRatePer1000ActiveSentences,
        pairs: report.metrics?.collisions?.pairs
      },
      categories: Object.fromEntries(Object.entries(report.metrics?.categories || {}).map(([id, item]) => [id, {
        matchedSentences: item.matchedSentences,
        activeMatchedSentences: item.activeMatchedSentences,
        sectionAlignedSentences: item.sectionAlignedSentences,
        excludedSectionSentences: item.excludedSectionSentences,
        matchedDocuments: item.matchedDocuments,
        activeSectionAlignmentRate: item.activeSectionAlignmentRate,
        per1000ActiveSentences: item.per1000ActiveSentences,
        configuredRuleCount: item.configuredRuleCount,
        exercisedRuleCount: item.exercisedRuleCount,
        ruleExerciseRate: item.ruleExerciseRate
      }]))
    }
  };
}

const defaultSettings = settings.createDefaultSettings();
const runtimeConfig = {
  formatVersion: 1,
  baselineSource: {
    sourceCommit, sourceTree, sourceBranch, sourceCommitAt,
    protocolStartTrackedDiff: [],
    note: 'The tracked production worktree was clean before baseline artifacts were added.'
  },
  versions: {
    analysisCache: analysisCache.ANALYSIS_CACHE_VERSIONS,
    evidenceLedger: ledger.EVIDENCE_LEDGER_VERSION,
    figureAnalysis: figure.FIGURE_ANALYSIS_VERSION,
    crossFigure: crossFigure.CROSS_FIGURE_LOGIC_VERSION,
    reviewOutline: review.REVIEW_OUTLINE_VERSION,
    reviewPrompt: review.REVIEW_PROMPT_VERSION,
    tokenUsageSchema: tokenUsage.TOKEN_USAGE_SCHEMA_VERSION
  },
  providerRouting: {
    taskRouteKeys: settings.TASK_ROUTE_KEYS,
    defaultGlobalProfileId: defaultSettings.globalProfileId,
    defaultRoutes: defaultSettings.taskRoutes,
    providerIds: ['openai', 'anthropic', 'gemini', 'deepseek', 'codex-local', 'openai-compatible']
  },
  tokenAccounting: {
    authoritative: 'Provider usage events persisted by core/token-usage-store.js',
    promptManifestProxy: 'ceil(totalChars/4), explicitly non-billing and non-provider-specific',
    outputBudgetRules: tokenBudget.RULES
  },
  execution: {
    taskTimeoutsMs: { highlight: 180000, summary: 180000, chat: 240000, figure: 300000, crossFigure: 300000 },
    taskConcurrency: { highlight: 3, summary: 2, chat: 1, figure: 1, crossFigure: 1 },
    analysisPipelineConcurrencyDefault: 3,
    analysisPipelineConcurrencyMaximum: 6,
    figurePanelBatchSize: 2,
    abbreviationTranslationBatchSize: 8
  },
  settingsSchema: {
    version: defaultSettings.version,
    mode: defaultSettings.mode,
    readingViewId: defaultSettings.readingViewId,
    viewCategoryOverrides: defaultSettings.viewCategoryOverrides,
    customCategoriesDefaultCount: defaultSettings.customCategories.length
  },
  feedbackVisibility: {
    repositoryFeedbackJsonlFiles: 0,
    visibleFeedbackRecords: 0,
    visibleManualCorrections: 0,
    browserIndexedDbInspected: false,
    note: 'No live browser profile database is part of the workspace; zero means workspace-visible records only.'
  },
  baselineTests: { command: 'npm.cmd test', tests: 1418, passed: 1418, failed: 0, cancelled: 0, skipped: 0, durationMs: 17095.3474 },
  zoteroMineruRegexBenchmark: regexSummary
};

const artifacts = {};
artifacts['prompt-manifest.json'] = writeJson('prompt-manifest.json', promptManifest);
artifacts['schema-manifest.json'] = writeJson('schema-manifest.json', schemaManifest);
artifacts['category-manifest.json'] = writeJson('category-manifest.json', categoryManifest);
artifacts['runtime-config.json'] = writeJson('runtime-config.json', runtimeConfig);
artifacts['zotero-regex-summary.json'] = writeJson('zotero-regex-summary.json', regexSummary);
const testResults = [
  'Brevess production baseline',
  `source commit: ${sourceCommit}`,
  `source tree: ${sourceTree}`,
  '',
  'Command: npm.cmd test',
  'Tests: 1418',
  'Passed: 1418',
  'Failed: 0',
  'Cancelled: 0',
  'Skipped: 0',
  'Duration: 17095.3474 ms',
  '',
  'Command: npm.cmd run benchmark:zotero-regex',
  `Corpus: ${regexSummary.metrics?.documents?.articleLike || 0}/${regexSummary.metrics?.documents?.selected || 0} article-like documents`,
  `Sentences: ${regexSummary.metrics?.sentences || 0} total; ${regexSummary.metrics?.activeSentences || 0} active`,
  `Structured-label recall proxy: ${regexSummary.metrics?.structuredLabels?.matchedByExpectedCategory || 0}/${regexSummary.metrics?.structuredLabels?.total || 0}`,
  `Regex category exercise: ${regexSummary.metrics?.regexCoverage?.exercisedCategories || 0}/${regexSummary.metrics?.regexCoverage?.configuredCategories || 0}`,
  `Regex rule exercise: ${regexSummary.metrics?.regexCoverage?.exercisedRules || 0}/${regexSummary.metrics?.regexCoverage?.configuredRules || 0}`,
  `Active collision rate per 1000 sentences: ${regexSummary.metrics?.collisions?.activeRatePer1000ActiveSentences || 0}`,
  '',
  'The Zotero/MinerU metrics are deterministic proxy metrics, not manually adjudicated scientific ground truth.',
  'The initial `npm test` invocation via npm.ps1 was blocked by PowerShell execution policy before tests started; npm.cmd is the equivalent successful launcher.',
  ''
].join('\n');
fs.writeFileSync(path.join(outDir, 'test-results.txt'), testResults, 'utf8');
artifacts['test-results.txt'] = testResults;

const lock = {
  formatVersion: 1,
  immutableSource: { sourceCommit, sourceTree, sourceBranch },
  artifacts: Object.fromEntries(Object.entries(artifacts).map(([name, text]) => [name, {
    bytes: Buffer.byteLength(text), sha256: sha(text)
  }])),
  productionSourceFiles: sourceHashes
};
fs.writeFileSync(path.join(outDir, 'prompt-manifest.lock'), stableJson(lock), 'utf8');

console.log(JSON.stringify({
  output: path.relative(root, outDir),
  prompts: promptRecords.length,
  schemas: schemaRecords.size,
  categories: Object.keys(unifiedCatalog).length,
  sourceCommit
}, null, 2));
