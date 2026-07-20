const fs = require('node:fs');
const path = require('node:path');

require('../core/category-store.js');
require('../core/adaptive-catalog.js');
require('../providers/provider-utils.js');
require('../core/prompt-compiler.js');
require('../core/chunker.js');
require('../core/result-validator.js');
require('../core/analysis-pipeline.js');
const { OA_PAPER_BENCHMARK } = require('../tests/helpers/oa-paper-benchmark.js');

const shared = globalThis.SciLLM;
const inputPath = process.argv[2];
const reportPath = process.argv[3] || '';

if (!inputPath) {
  throw new Error('Usage: node scripts/oa-pipeline-stress.js <paragraphs.json> [report.json]');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function sectionKindFromTitle(value, fallback = 'article') {
  const normalized = String(value || '').trim()
    .replace(/^\s*(?:\d+(?:\.\d+)*|[IVXLC]+)[\s.):\-]+/i, '')
    .toLowerCase();
  if (/^(?:abstract|summary)\b/.test(normalized)) return 'abstract';
  if (/^(?:introduction|background)\b/.test(normalized)) return 'introduction';
  if (/^(?:materials? and methods?|methods?|methodology|experimental procedures?)\b/.test(normalized)) return 'methods';
  if (/^(?:results?|findings?)\b/.test(normalized)) return 'results';
  if (/^(?:discussion|limitations?|strengths? and limitations?)\b/.test(normalized)) return 'discussion';
  if (/^(?:conclusions?|concluding remarks?)\b/.test(normalized)) return 'conclusion';
  return fallback;
}

function normalizeParagraphs(items) {
  let inheritedKind = 'article';
  return items.map(item => {
    const majorTitle = item.majorSectionTitle || item.sectionTitle || '';
    const explicitMajorKind = sectionKindFromTitle(majorTitle, '');
    const explicitNearestKind = sectionKindFromTitle(item.sectionTitle || '', '');
    inheritedKind = explicitMajorKind || explicitNearestKind || inheritedKind;
    return { ...item, sectionKind: item.sectionKind || inheritedKind };
  });
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))];
}

function deepSeekBodyBytes(prompt) {
  const body = JSON.stringify({
    model: 'deepseek-v4-flash',
    messages: [
      { role: 'system', content: shared.withStructuredSchemaPrompt(prompt) },
      { role: 'user', content: prompt.userPrompt }
    ],
    thinking: { type: 'disabled' },
    response_format: { type: 'json_object' },
    max_tokens: 4096,
    stream: true,
    stream_options: { include_usage: false }
  });
  return Buffer.byteLength(body, 'utf8');
}

const metadataById = new Map(OA_PAPER_BENCHMARK.map(item => [
  item.id.replace(/^pmc/i, 'PMC'), item
]));

async function run() {
  const papers = readJson(inputPath);
  const report = {
    revision: '2.0.1-study-type-r1',
    generatedAt: new Date().toISOString(),
    source: 'Europe PMC fullTextXML OA subset; deterministic mock-provider pipeline stress',
    requestModel: 'deepseek-v4-flash',
    maxChunkCharacters: 12000,
    papers: [],
    totals: {
      papers: 0,
      paragraphs: 0,
      characters: 0,
      originalChunks: 0,
      successfulProviderCalls: 0,
      injectedFailures: 0,
      adaptiveSplits: 0,
      requestBytes: 0,
      maxRequestBytes: 0,
      maxParagraphCharacters: 0,
      coveredParagraphs: 0
    }
  };

  for (let paperIndex = 0; paperIndex < papers.length; paperIndex += 1) {
    const paper = papers[paperIndex];
    const paragraphs = normalizeParagraphs(paper.paragraphs || []);
    const metadata = metadataById.get(String(paper.id).toUpperCase()) || {};
    const studyProfile = {
      primaryType: metadata.expectedPrimaryType || 'basic_mechanistic',
      secondaryType: metadata.expectedSecondaryType || null,
      useTypeSpecificWarnings: true
    };
    const readingView = shared.composeReadingView({
      viewId: 'quick_story',
      studyProfile,
      override: null,
      customCategories: []
    });
    const chunks = shared.chunkParagraphs(paragraphs, {
      maxChars: 12000,
      overlapParagraphs: 1
    });
    const requestBytes = chunks.map(chunk => deepSeekBodyBytes(shared.compileAnalysisPrompt({
      categories: readingView.categories,
      chunkId: chunk.chunkId,
      sectionTitle: chunk.sectionTitle,
      sectionKind: chunk.sectionKind,
      paragraphs: chunk.paragraphs,
      viewId: 'quick_story',
      paperBlueprint: { research_question: paper.title },
      studyProfile
    })));

    const splittable = chunks
      .filter(chunk => chunk.paragraphs.length > 1)
      .sort((a, b) => b.paragraphs.reduce((sum, item) => sum + item.text.length, 0) -
        a.paragraphs.reduce((sum, item) => sum + item.text.length, 0))[0];
    const recoveryScenario = paperIndex % 2 === 0 ? 'timeout' : 'provider_busy';
    const failureTarget = splittable?.chunkId || '';
    const attempts = new Map();
    const successfulReviewed = new Set();
    const progress = [];
    let injectedFailures = 0;
    let successfulProviderCalls = 0;

    await shared.analyzeDocument({
      paragraphs,
      selectedCategories: readingView.categories,
      adapter: {
        async analyzeChunk(request) {
          const payload = JSON.parse(request.userPrompt);
          const chunkId = payload.chunk_id;
          const attempt = (attempts.get(chunkId) || 0) + 1;
          attempts.set(chunkId, attempt);
          if (chunkId === failureTarget &&
              ((recoveryScenario === 'timeout' && attempt === 1) ||
               (recoveryScenario === 'provider_busy' && attempt <= 2))) {
            injectedFailures += 1;
            throw Object.assign(new Error(recoveryScenario), {
              code: recoveryScenario === 'timeout' ? 'REQUEST_TIMEOUT' : 'PROVIDER_UNAVAILABLE',
              retryable: true
            });
          }
          successfulProviderCalls += 1;
          request.paragraphs.forEach(item => successfulReviewed.add(item.paragraphId));
          return {
            chunk_id: chunkId,
            paragraphs_reviewed: request.paragraphs.map(item => item.paragraphId),
            annotations: []
          };
        }
      },
      maxChars: 12000,
      viewId: 'quick_story',
      paperBlueprint: { research_question: paper.title },
      studyProfile,
      sleepImpl: async () => {},
      onProgress: event => progress.push(event)
    });

    const paragraphIds = new Set(paragraphs.map(item => item.paragraphId));
    const missing = [...paragraphIds].filter(id => !successfulReviewed.has(id));
    if (missing.length) throw new Error(`${paper.id}: pipeline missed ${missing.length} paragraphs`);
    const splitEvents = progress.filter(event => event.phase === 'split');
    if (failureTarget && !splitEvents.length) {
      throw new Error(`${paper.id}: injected ${recoveryScenario} did not trigger adaptive split`);
    }

    const characters = paragraphs.reduce((sum, item) => sum + item.text.length, 0);
    const maxParagraphCharacters = Math.max(...paragraphs.map(item => item.text.length), 0);
    const paperReport = {
      id: paper.id,
      title: paper.title,
      primaryType: studyProfile.primaryType,
      secondaryType: studyProfile.secondaryType,
      activeCategories: readingView.categoryIds.length,
      paragraphs: paragraphs.length,
      characters,
      maxParagraphCharacters,
      originalChunks: chunks.length,
      recoveryScenario,
      recoveryTarget: failureTarget,
      injectedFailures,
      adaptiveSplits: splitEvents.length,
      successfulProviderCalls,
      coveredParagraphs: successfulReviewed.size,
      requestBytes: {
        min: Math.min(...requestBytes),
        median: percentile(requestBytes, 0.5),
        p90: percentile(requestBytes, 0.9),
        max: Math.max(...requestBytes),
        total: requestBytes.reduce((sum, value) => sum + value, 0)
      },
      completedWithoutProviderNetwork: true
    };
    report.papers.push(paperReport);
    report.totals.papers += 1;
    report.totals.paragraphs += paragraphs.length;
    report.totals.characters += characters;
    report.totals.originalChunks += chunks.length;
    report.totals.successfulProviderCalls += successfulProviderCalls;
    report.totals.injectedFailures += injectedFailures;
    report.totals.adaptiveSplits += splitEvents.length;
    report.totals.requestBytes += paperReport.requestBytes.total;
    report.totals.maxRequestBytes = Math.max(report.totals.maxRequestBytes, paperReport.requestBytes.max);
    report.totals.maxParagraphCharacters = Math.max(
      report.totals.maxParagraphCharacters, maxParagraphCharacters
    );
    report.totals.coveredParagraphs += successfulReviewed.size;
  }

  if (report.totals.papers < 3) throw new Error('At least three OA full texts are required');
  if (reportPath) {
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

run().catch(error => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
