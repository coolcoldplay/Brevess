import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';

const require = createRequire(import.meta.url);

require('../extension/core/category-store.js');
require('../extension/core/adaptive-catalog.js');
require('../extension/core/study-profile.js');
require('../extension/core/confidence-policy.js');
require('../extension/core/settings-store.js');
require('../extension/providers/provider-utils.js');
require('../extension/core/prompt-compiler.js');
require('../extension/core/chunker.js');
require('../extension/core/result-validator.js');
require('../extension/core/evidence-ledger.js');
require('../extension/core/figure-analysis.js');
require('../extension/core/figure-panel-planner.js');
const { buildArticleChatIndex } = require('../extension/core/article-chat-index.js');
require('../extension/core/article-chat-tokenizer.js');
const { retrieveArticleChatContext } = require('../extension/core/article-chat-retrieval.js');
const {
  buildArticleChatMemory,
  retrieveArticleChatMemory
} = require('../extension/core/article-chat-memory.js');
const { verifyArticleChatEvidence } = require('../extension/core/article-chat-citations.js');
require('../extension/core/article-chat-stream.js');
require('../extension/core/article-chat.js');
require('../extension/core/cross-figure-logic.js');
require('../extension/core/review-outline.js');
require('../extension/core/cache-planner.js');
require('../extension/core/article-workspace.js');
require('../extension/core/article-archive.js');
require('../extension/core/migration-bundle.js');
require('../extension/core/analysis-pipeline.js');
require('../extension/core/analysis-cache.js');
require('../extension/core/review-outline-pipeline.js');
require('../extension/core/corpus-store.js');
require('../extension/core/manual-annotations.js');
require('../extension/core/document-store.js');
require('../extension/providers/openai.js');
require('../extension/providers/anthropic.js');
require('../extension/providers/gemini.js');
require('../extension/providers/deepseek.js');
require('../extension/providers/openai-compatible.js');
require('../extension/providers/provider-registry.js');
require('../extension/core/task-profile-router.js');
require('../extension/core/token-budget.js');
require('../extension/core/article-chat-context-planner.js');
require('../extension/core/operation-control.js');
const { createBackgroundRouter } = require('../extension/core/background-router.js');

function paragraphs(count) {
  const sections = [
    ['Abstract', 'abstract'], ['Introduction', 'introduction'],
    ['Results', 'results'], ['Discussion', 'discussion'], ['Conclusion', 'conclusion']
  ];
  return Array.from({ length: count }, (_, index) => {
    const [sectionTitle, sectionKind] = sections[index % sections.length];
    const distinctive = index === count - 17
      ? 'rare-neuroaxis-CRISPR rescue restored thermoregulation without changing food intake.'
      : `Replicate ${index + 1} measured heat stress, metabolism, signaling, and controls.`;
    return {
      paragraphId: `benchmark-p-${index + 1}`,
      sourceKey: `benchmark-source-${index + 1}`,
      textHash: `benchmark-hash-${index + 1}`,
      sectionId: `benchmark-${sectionKind}`,
      sectionTitle,
      sectionKind,
      sectionPath: [sectionTitle],
      text: `${distinctive} This paragraph preserves a stable scientific evidence record.`
    };
  });
}

function storageDouble() {
  const values = {};
  return {
    get(key, callback) { callback({ [key]: values[key] }); },
    set(value, callback) { Object.assign(values, value); callback(); }
  };
}

function workspaceFixture(index) {
  const suffix = index.toString(16).padStart(64, '0');
  return {
    schemaVersion: 1,
    workspaceId: `workspace:${suffix}`,
    canonicalUrl: `https://example.org/article/${index}`,
    aliases: [],
    title: `Benchmark article ${index}`,
    directoryName: `Benchmark article ${index}--${suffix.slice(0, 16)}`,
    revision: suffix,
    contentHash: suffix,
    workspaceGeneration: 1,
    storageRevision: 1,
    summary: {
      assetCount: 7,
      assetBytes: 1000,
      turnCount: 3,
      turnBytes: 200,
      chatTurnCount: 3,
      figureCount: 2,
      panelCount: 6,
      highlightCount: 4
    }
  };
}

function workspaceStoreDouble(workspaces) {
  const byId = new Map(workspaces.map(workspace => [workspace.workspaceId, workspace]));
  return {
    async listWorkspaces() {
      return [...byId.values()].map(value => structuredClone(value));
    },
    async getWorkspace(id) {
      return byId.has(id) ? structuredClone(byId.get(id)) : null;
    },
    async putAsset(id, relativePath, content) {
      const serialized = JSON.stringify(content);
      return {
        workspaceId: id,
        relativePath,
        content: structuredClone(content),
        revision: 2,
        contentHash: `benchmark-${serialized.length}`,
        byteSize: new TextEncoder().encode(serialized).byteLength,
        updatedAt: new Date().toISOString()
      };
    }
  };
}

function measure(operation) {
  const started = performance.now();
  const value = operation();
  return { value, milliseconds: performance.now() - started };
}

async function measureAsync(operation) {
  const started = performance.now();
  const value = await operation();
  return { value, milliseconds: performance.now() - started };
}

async function main() {
  const source100 = paragraphs(100);
  const source500 = paragraphs(500);
  const index100Timing = measure(() => buildArticleChatIndex({
    documentHash: 'benchmark-100', revision: 1, paragraphs: source100
  }, { minChars: 80, targetChars: 220, maxChars: 360 }));
  const index500Timing = measure(() => buildArticleChatIndex({
    documentHash: 'benchmark-500', revision: 1, paragraphs: source500
  }, { minChars: 80, targetChars: 220, maxChars: 360 }));
  const broadTiming = await measureAsync(() => retrieveArticleChatContext(
    index100Timing.value,
    'Give an overview of the full paper background, main findings, and conclusion.',
    { maxChars: 12000, limit: 8, neighborRadius: 0 }
  ));
  const narrowTiming = await measureAsync(() => retrieveArticleChatContext(
    index500Timing.value,
    'What did the rare-neuroaxis-CRISPR rescue do to food intake?',
    { maxChars: 4000, limit: 6, neighborRadius: 1 }
  ));

  const turns = Array.from({ length: 5000 }, (_, index) => ({
    turnId: `benchmark-turn-${index + 1}`,
    question: index === 16
      ? 'What did the rare-synaptic-lipid result show?'
      : `Question ${index + 1} about the common result`,
    answer: index === 16
      ? 'The rare-synaptic-lipid response was reversible.'
      : `Answer ${index + 1} summarizes a common result.`,
    createdAt: index + 1
  }));
  const memoryTiming = measure(() => buildArticleChatMemory(turns));
  const memorySearchTiming = measure(() => retrieveArticleChatMemory(
    memoryTiming.value, 'rare-synaptic-lipid reversible', { limit: 4 }
  ));

  const repeatedQuote = 'This repeated evidence sentence is intentionally non-unique.';
  const duplicateParagraphs = source500.map((paragraph, index) => ({
    ...paragraph,
    text: index % 25 === 0 ? repeatedQuote : paragraph.text
  }));
  const citationTiming = measure(() => verifyArticleChatEvidence(
    { quote: repeatedQuote }, { revision: 1, paragraphs: duplicateParagraphs }
  ));

  const workspaces = Array.from({ length: 1000 }, (_, index) => workspaceFixture(index));
  const workspaceStore = workspaceStoreDouble(workspaces);
  const router = createBackgroundRouter({
    storageArea: storageDouble(),
    articleWorkspaceStore: workspaceStore,
    directorySync: {
      async listWorkspaceManifests() {
        return { permission: 'granted', manifests: [], invalidManifests: 0 };
      },
      async status() {
        return { permission: 'granted', pendingCount: 0, conflictCount: 0 };
      }
    },
    fetchImpl: async () => { throw new Error('benchmark must remain local'); }
  });
  const overviewTiming = await measureAsync(() => router.handle({
    type: 'ARTICLE_WORKSPACE_LIST'
  }));
  const submissionTiming = await measureAsync(() => router.handle({
    type: 'ARTICLE_WORKSPACE_SAVE_ASSET',
    workspaceId: workspaces[0].workspaceId,
    relativePath: 'chat/index.json',
    content: { schemaVersion: 1, turns: turns.slice(0, 20) }
  }));

  const correctness = {
    broadQueryCoversFiveCoreSections: ['abstract', 'introduction', 'results', 'discussion', 'conclusion']
      .every(kind => broadTiming.value.coverage.selectedSectionKinds.includes(kind)),
    narrowQueryFindsDistinctiveEvidence: narrowTiming.value.chunks
      .some(chunk => chunk.text.includes('rare-neuroaxis-CRISPR')),
    fiveThousandTurnsRemainSearchable:
      memorySearchTiming.value[0]?.turnId === 'benchmark-turn-17',
    duplicateCitationRejected:
      citationTiming.value.status === 'ambiguous' && citationTiming.value.target === null,
    thousandWorkspaceOverviewIsSummaryOnly:
      overviewTiming.value.success === true &&
      overviewTiming.value.data.workspaces.length === 1000,
    localSubmissionAccepted: submissionTiming.value.success === true
  };
  const targets = {
    workspaceOverview1000Ms: 2000,
    localSubmissionProxyMs: 100
  };
  const measurements = {
    buildIndex100Ms: index100Timing.milliseconds,
    buildIndex500Ms: index500Timing.milliseconds,
    broadRetrieval100Ms: broadTiming.milliseconds,
    narrowRetrieval500Ms: narrowTiming.milliseconds,
    buildMemory5000Ms: memoryTiming.milliseconds,
    searchMemory5000Ms: memorySearchTiming.milliseconds,
    verifyDuplicateCitation500Ms: citationTiming.milliseconds,
    workspaceOverview1000Ms: overviewTiming.milliseconds,
    localSubmissionProxyMs: submissionTiming.milliseconds
  };
  const report = {
    fixture: { paragraphs: [100, 500], turns: 5000, workspaces: 1000 },
    targets,
    measurements: Object.fromEntries(Object.entries(measurements)
      .map(([key, value]) => [key, Number(value.toFixed(2))])),
    withinTarget: {
      workspaceOverview1000:
        measurements.workspaceOverview1000Ms <= targets.workspaceOverview1000Ms,
      localSubmissionProxy:
        measurements.localSubmissionProxyMs <= targets.localSubmissionProxyMs
    },
    correctness,
    note: 'The submission measurement uses the same background route with an in-memory store proxy; browser IndexedDB is verified by the Edge smoke test.'
  };
  console.log(JSON.stringify(report, null, 2));
  if (Object.values(correctness).some(value => value !== true)) process.exitCode = 1;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
