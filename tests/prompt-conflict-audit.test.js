const test = require('node:test');
const assert = require('node:assert/strict');

require('../providers/provider-utils.js');
require('../core/figure-panel-planner.js');
const {
  compileFigurePanelBatchPrompt,
  compileFigureSynthesisPrompt
} = require('../core/figure-analysis.js');
const {
  auditPromptContract,
  auditPromptContracts
} = require('../core/prompt-audit.js');

const panelInput = {
  figureId: 'figure-1',
  figureLabel: 'Figure 1',
  articleTitle: 'Synthetic contract fixture',
  caption: 'Figure 1. (A) Treatment changes outcome. (B) Blockade tests the mediator.',
  panelHints: ['A', 'B'],
  contextParagraphs: []
};

test('detects MUST X together with MUST NOT X in one Prompt', () => {
  const issues = auditPromptContract({
    id: 'synthetic.conflict',
    systemPrompt: [
      'You must return argument_chain as an ordered chain.',
      'You must not generate argument_chain.'
    ].join('\n'),
    userPrompt: '{}',
    responseSchema: {
      type: 'object', properties: { argument_chain: { type: 'array' } }
    }
  });
  assert.ok(issues.some(issue => issue.code === 'PROMPT_MUST_MUST_NOT_CONFLICT'));
});

test('does not confuse a field requirement with a restriction on what determines it', () => {
  const issues = auditPromptContract({
    id: 'synthetic.scoped-field-rule',
    systemPrompt: [
      'method_category must describe the experimental acquisition or measured readout.',
      'Statistics alone must not determine method_category.'
    ].join('\n'),
    userPrompt: '{}',
    responseSchema: {
      type: 'object', properties: { method_category: { type: 'string' } }
    }
  });
  assert.deepEqual(issues, []);
});

test('detects required output fields that the response Schema does not contain', () => {
  const issues = auditPromptContract({
    id: 'synthetic.schema-mismatch',
    systemPrompt: 'Return argument_chain as an ordered chain.',
    userPrompt: '{}',
    responseSchema: {
      type: 'object', properties: { panels: { type: 'array' } }
    }
  });
  assert.ok(issues.some(issue =>
    issue.code === 'PROMPT_SCHEMA_FIELD_MISMATCH' && issue.field === 'argument_chain'
  ));
});

test('detects synthesis requirements leaking into a Panel extraction pass', () => {
  const issues = auditPromptContract({
    id: 'figure.panel-batch.synthetic.text',
    systemPrompt: 'Build an ordered domino chain from all Panels.',
    userPrompt: JSON.stringify({ pass: 'panel_extraction' }),
    responseSchema: {
      type: 'object', properties: { panels: { type: 'array' } }
    }
  });
  assert.ok(issues.some(issue => issue.code === 'EXTRACTION_PASS_SYNTHESIS_LEAK'));
});

test('all four production Panel extraction variants pass the static contract audit', () => {
  const records = [];
  for (const analysisDepth of ['standard', 'deep']) {
    for (const visualInput of [false, true]) {
      const compiled = compileFigurePanelBatchPrompt(panelInput, {
        analysisDepth, visualInput
      });
      records.push({
        id: `figure.panel-batch.${analysisDepth}.${visualInput ? 'vision' : 'text'}`,
        ...compiled
      });
    }
  }
  assert.deepEqual(auditPromptContracts(records), []);
});

test('Figure-level relationships remain owned by figure.synthesis variants', () => {
  const compiled = compileFigureSynthesisPrompt(panelInput, [{
    panel: 'A', role: 'phenotype', phenotypeName: 'outcome', methods: [],
    purpose: 'Measure outcome', design: 'Treatment versus control',
    comparison: 'treatment vs control', directObservation: 'Outcome changed.'
  }], { analysisDepth: 'standard', visualInput: false });
  assert.match(compiled.systemPrompt, /Figure-level question/i);
  assert.match(compiled.systemPrompt, /logic_bridges.*跨图分析.*内部衔接信息/);
  assert.match(compiled.systemPrompt, /upstream_context_zh 只写一句/);
  assert.match(compiled.systemPrompt, /ordered argument chain/i);
  assert.ok(Object.hasOwn(compiled.responseSchema.properties, 'argument_chain'));
  assert.ok(Object.hasOwn(compiled.responseSchema.properties, 'panel_groups'));
  assert.ok(Object.hasOwn(compiled.responseSchema.properties, 'logic_bridges'));
  assert.ok(Object.hasOwn(compiled.responseSchema.properties, 'author_assembly_zh'));
});
