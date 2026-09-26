import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../core/category-store.js');
require('../core/adaptive-catalog.js');
require('../providers/provider-utils.js');
require('../core/prompt-compiler.js');
require('../core/figure-panel-planner.js');
require('../core/figure-analysis.js');

const shared = globalThis.SciLLM;
const catalog = shared.createAdaptiveCategoryCatalog();
const categories = [
  catalog.key_result,
  catalog.causal_effect,
  catalog.mechanism_mediator,
  catalog.effect_uncertainty,
  catalog.cross_system_validation,
  catalog.significance_novelty
];
const paragraphs = Array.from({ length: 8 }, (_, index) => ({
  paragraphId: `p${index + 1}`,
  sectionTitle: 'Results', sectionKind: 'results',
  text: `Treatment group ${index + 1} changed the measured outcome relative to control, with an independent validation result.`
}));
const promptInput = {
  categories, chunkId: 'benchmark-1', sectionTitle: 'Results', sectionKind: 'results',
  paragraphs, viewId: 'quick_story',
  paperBlueprint: { research_question: 'Does the intervention change the outcome?' },
  studyProfile: { primaryType: 'basic_mechanistic' }
};
const legacy = shared.compileAnalysisPrompt(promptInput);
const compact = shared.compileAnalysisStreamPrompt(promptInput);
const legacyChars = legacy.systemPrompt.length + legacy.userPrompt.length;
const compactChars = compact.systemPrompt.length + compact.userPrompt.length;

const caption = [
  'Figure 4. Values are mean ± SEM; treated and control groups are shown.',
  ...'ABCDEFGH'.split('').map(panel =>
    `(${panel}) ${panel} panel reports a distinct assay, comparison, and validation outcome.`)
].join(' ');
const figureInput = {
  figureId: 'figure-4', figureLabel: 'Figure 4', caption,
  panelHints: ['A', 'B'],
  contextParagraphs: Array.from({ length: 12 }, (_, index) => ({
    paragraphId: `figure-p${index + 1}`,
    sectionTitle: index < 2 ? 'Methods' : 'Results',
    text: `Figure 4${index % 2 ? 'B' : 'A'} paragraph ${index + 1}: ${'evidence '.repeat(80)}`
  }))
};
const naiveFigurePayload = JSON.stringify({
  caption: figureInput.caption,
  related_body_context: figureInput.contextParagraphs,
  expected_panel_labels: figureInput.panelHints
});
const figureContextPayload = shared.compileFigurePanelBatchPrompt(
  figureInput, { visualInput: false, analysisDepth: 'standard' }
).userPrompt;

const metrics = {
  highlighter: {
    legacyChars,
    compactChars,
    compactRatio: Number((compactChars / legacyChars).toFixed(3)),
    savedPercent: Number(((1 - compactChars / legacyChars) * 100).toFixed(1))
  },
  figureBatch: {
    naiveChars: naiveFigurePayload.length,
    figureContextChars: figureContextPayload.length,
    compactRatio: Number((figureContextPayload.length / naiveFigurePayload.length).toFixed(3)),
    savedPercent: Number(((1 - figureContextPayload.length / naiveFigurePayload.length) * 100).toFixed(1))
  }
};

console.log(JSON.stringify(metrics, null, 2));
if (metrics.highlighter.compactRatio >= 0.65) {
  throw new Error('Compact highlighter prompt regression: expected < 65% of legacy');
}
if (metrics.figureBatch.compactRatio >= 0.75) {
  throw new Error('FigureContext regression: expected < 75% of repeated full context');
}
