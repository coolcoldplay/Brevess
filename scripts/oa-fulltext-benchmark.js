const fs = require('node:fs');
const path = require('node:path');

require('../core/category-store.js');
require('../core/adaptive-catalog.js');
require('../providers/provider-utils.js');
require('../core/prompt-compiler.js');
require('../core/chunker.js');
require('../core/result-validator.js');
const { OA_PAPER_BENCHMARK } = require('../tests/helpers/oa-paper-benchmark.js');

const shared = globalThis.SciLLM;
const inputPath = process.argv[2];
const reportPath = process.argv[3] || '';

if (!inputPath) {
  throw new Error('Usage: node scripts/oa-fulltext-benchmark.js <paragraphs.json> [report.json]');
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

function splitSentences(text) {
  return String(text || '').split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
    .map(item => item.trim()).filter(item => item.length >= 20);
}

const benchmarkById = new Map(OA_PAPER_BENCHMARK.map(item => [
  item.id.replace(/^pmc/i, 'PMC'), item
]));
const papers = readJson(inputPath);
const categories = shared.createAdaptiveCategoryCatalog();
const report = {
  revision: '2.0.1-study-type-r1',
  generatedAt: new Date().toISOString(),
  source: 'Europe PMC fullTextXML OA subset',
  papers: [],
  totals: {
    papers: 0, paragraphs: 0, characters: 0, chunks: 0,
    resultsChunks: 0, hypothesisObjectiveSentences: 0,
    hypothesisObjectiveRejectedAsNovelty: 0,
    nonCausalAssociationSentences: 0,
    nonCausalAssociationRejectedAsCausal: 0
  }
};

for (const paper of papers) {
  let inheritedKind = 'article';
  const paragraphs = paper.paragraphs.map(item => {
    const majorTitle = item.majorSectionTitle || item.sectionTitle || '';
    const explicitMajorKind = sectionKindFromTitle(majorTitle, '');
    const explicitNearestKind = sectionKindFromTitle(item.sectionTitle || '', '');
    inheritedKind = explicitMajorKind || explicitNearestKind || inheritedKind;
    return { ...item, sectionKind: item.sectionKind || inheritedKind };
  });
  const paragraphIds = new Set(paragraphs.map(item => item.paragraphId));
  if (paragraphIds.size !== paragraphs.length) {
    throw new Error(`${paper.id}: duplicate paragraph ids`);
  }
  if (paragraphs.length < 10) throw new Error(`${paper.id}: insufficient body paragraphs`);

  const chunks = shared.chunkParagraphs(paragraphs, { maxChars: 12000, overlapParagraphs: 1 });
  const covered = new Set(chunks.flatMap(chunk => chunk.paragraphs.map(item => item.paragraphId)));
  if (covered.size !== paragraphIds.size || [...paragraphIds].some(id => !covered.has(id))) {
    throw new Error(`${paper.id}: full-text chunk coverage failed`);
  }
  if (chunks.some(chunk => chunk.sectionKind !== (chunk.paragraphs[0]?.sectionKind || ''))) {
    throw new Error(`${paper.id}: chunk section kind mismatch`);
  }

  let resultsChunks = 0;
  let resultsPromptsWithNullGuidance = 0;
  for (const chunk of chunks) {
    const prompt = shared.compileAnalysisPrompt({
      categories: [categories.key_result, categories.significance_novelty],
      chunkId: chunk.chunkId,
      sectionTitle: chunk.sectionTitle,
      sectionKind: chunk.sectionKind,
      paragraphs: chunk.paragraphs,
      viewId: 'quick_story',
      paperBlueprint: { research_question: paper.title },
      studyProfile: null
    });
    if (chunk.sectionKind === 'results') {
      resultsChunks += 1;
      if (/important null, negative, or selectivity result/i.test(prompt.systemPrompt)) {
        resultsPromptsWithNullGuidance += 1;
      }
    }
  }
  if (resultsChunks && resultsPromptsWithNullGuidance !== resultsChunks) {
    throw new Error(`${paper.id}: Results subsection prompt lost null/selectivity guidance`);
  }

  const sentences = paragraphs.flatMap(item => splitSentences(item.text));
  const prospective = sentences.filter(sentence =>
    /\b(?:we|the authors?)\s+(?:hypothes\w*|predict\w*|postulat\w*|speculat\w*|propos(?:e|ed)\s+that|sought to|aimed to|set out to)\b|\b(?:objective|purpose|aim).{0,40}\bwas to\b/i
      .test(sentence)
  );
  const rejectedProspective = prospective.filter(sentence =>
    !shared.validateAnnotationSemantics({
      quote: sentence, categoryId: 'significance_novelty'
    }).valid
  );
  if (rejectedProspective.length !== prospective.length) {
    throw new Error(`${paper.id}: prospective statement escaped novelty guard`);
  }

  const explicitCausal = /\b(?:because|due to|owing to|caus\w*|led to|resulted in|mediated|promoted|inhibited|induced|triggered|drove)\b/i;
  const nonCausalAssociations = sentences.filter(sentence =>
    /\b(?:associated with|association between|correlated with|correlation between|linked to)\b/i.test(sentence) &&
    !explicitCausal.test(sentence)
  );
  const rejectedAssociations = nonCausalAssociations.filter(sentence =>
    !shared.validateAnnotationSemantics({
      quote: sentence, categoryId: 'causal_effect'
    }).valid
  );
  if (rejectedAssociations.length !== nonCausalAssociations.length) {
    const escaped = nonCausalAssociations.find(sentence =>
      shared.validateAnnotationSemantics({
        quote: sentence, categoryId: 'causal_effect'
      }).valid
    );
    throw new Error(`${paper.id}: association escaped causal-effect guard: ${escaped}`);
  }

  const metadata = benchmarkById.get(String(paper.id).toUpperCase()) || {};
  const characters = paragraphs.reduce((sum, item) => sum + item.text.length, 0);
  report.papers.push({
    id: paper.id,
    title: paper.title,
    expectedPrimaryType: metadata.expectedPrimaryType || '',
    expectedSecondaryType: metadata.expectedSecondaryType || null,
    sourceXmlSha256: paper.sourceXmlSha256 || '',
    paragraphs: paragraphs.length,
    characters,
    chunks: chunks.length,
    resultsChunks,
    resultsPromptsWithNullGuidance,
    hypothesisObjectiveSentences: prospective.length,
    hypothesisObjectiveRejectedAsNovelty: rejectedProspective.length,
    nonCausalAssociationSentences: nonCausalAssociations.length,
    nonCausalAssociationRejectedAsCausal: rejectedAssociations.length,
    fullTextCoverage: true,
    figureAndReferenceParagraphs: 0
  });
  report.totals.papers += 1;
  report.totals.paragraphs += paragraphs.length;
  report.totals.characters += characters;
  report.totals.chunks += chunks.length;
  report.totals.resultsChunks += resultsChunks;
  report.totals.hypothesisObjectiveSentences += prospective.length;
  report.totals.hypothesisObjectiveRejectedAsNovelty += rejectedProspective.length;
  report.totals.nonCausalAssociationSentences += nonCausalAssociations.length;
  report.totals.nonCausalAssociationRejectedAsCausal += rejectedAssociations.length;
}

if (report.totals.papers < 3) throw new Error('At least three OA full texts are required');
if (reportPath) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
