const test = require('node:test');
const assert = require('node:assert/strict');
require('../providers/provider-utils.js');
require('../core/figure-panel-planner.js');
const api = require('../core/figure-analysis.js');

const input = {
  figureId: 'figure-2', figureLabel: 'Figure 2', panelId: 'A', panel: { panel: 'A' },
  panelHints: ['A'], caption: 'Figure 2. (A) Imaging readout under two conditions.',
  contextParagraphs: [{ paragraphId: 'p1', text:
    'The same subjects were imaged in fixed order at a ten-day interval. A smaller subset received the final condition.' }]
};
function rawPanel(source) {
  return { figure_id: 'figure-2', panel: 'A', basis: 'caption_context',
    panel_interpretation: {
      panel: 'A', role: 'quantification', phenotype_name_zh: '', method_category: 'imaging',
      methods: ['双光子成像'], evidence_type_zh: '成像定量',
      experimental_methods: ['双光子成像'], statistical_methods: [], method_source: source,
      purpose_zh: '比较条件下的读出', design_zh: '同一批对象按固定顺序成像',
      comparison_zh: '条件一与条件二', direct_observation_zh: '图注描述不同条件的成像读出',
      observation_source: 'caption_statement', local_inference_zh: '仅支持条件比较',
      contribution_zh: '提供条件相关的成像证据'
    }, claim_boundary_zh: '顺序与时间效应未排除'
  };
}

test('mixed caption/body method provenance survives schema and normalization in both routes', () => {
  const schema = api.createFigurePanelInterpretationSchema();
  assert.ok(schema.properties.panel_interpretation.properties.method_source.enum.includes('multi_source'));
  for (const visualInput of [false, true]) {
    const raw = rawPanel('multi_source');
    if (visualInput) raw.basis = 'vision_text';
    const result = api.validateFigurePanelInterpretation(raw, input, { visualInput });
    assert.equal(result.methodSource, 'multi_source');
    assert.equal(result.methodCategory, 'imaging');
    assert.equal(result.observationSource, 'caption_statement',
      'mixed methods must not relabel observation provenance');
  }
  for (const source of ['caption', 'body', 'inference']) {
    assert.equal(api.validateFigurePanelInterpretation(rawPanel(source), input).methodSource, source);
  }
  assert.throws(() => api.validateFigurePanelInterpretation(rawPanel('unsupported-source'), input));
});

test('full, batch, and standalone prompts preserve design facts and cross-field causal consistency', () => {
  for (const compile of [api.compileFigureAnalysisPrompt,
    api.compileFigurePanelBatchPrompt, api.compileFigurePanelInterpretationPrompt]) {
    for (const visualInput of [false, true]) {
      const prompt = compile(input, { visualInput });
      assert.match(prompt.systemPrompt, /reuse of the same subjects, condition order, interval/);
      assert.match(prompt.systemPrompt, /preserve those facts in design_zh/);
      assert.match(prompt.systemPrompt, /compare contribution_zh with local_inference_zh and claim_boundary_zh/);
      assert.match(prompt.systemPrompt, /supported drug\/gene intervention can justify/);
      assert.match(prompt.systemPrompt, /method_source covers the concrete facts in methods and experimental_methods/);
    }
  }
  const payload = JSON.parse(api.compileFigurePanelInterpretationPrompt(input).userPrompt);
  assert.match(JSON.stringify(payload), /ten-day interval/);
});

test('all Panel interpretation routes enforce quantitative, visual, and intervention fidelity', () => {
  for (const compile of [api.compileFigureAnalysisPrompt,
    api.compileFigurePanelBatchPrompt, api.compileFigurePanelInterpretationPrompt]) {
    const prompt = compile(input, { visualInput: true }).systemPrompt;
    assert.match(prompt, /mean ordering.*does not establish.*pairwise significance/i);
    assert.match(prompt, /same subjects.*fixed order.*paired statistical test/i);
    assert.match(prompt, /raw percentage.*percentage-point.*relative percent.*fold/i);
    assert.match(prompt, /derived ratio.*not a directly measured value/i);
    assert.match(prompt, /individual points.*connecting lines.*mean.*SEM.*axis break/i);
    assert.match(prompt, /do not call.*bar/i);
    assert.match(prompt, /TTX.*does not by itself establish neuronal mediation/i);
    assert.match(prompt, /direct drug effects.*order.*carry-over/i);
    assert.match(prompt, /article-specific limitations.*only when.*supplied source/i);
  }
});

test('Panel follow-up requires claim-matched exact quotes and excludes unsupported references', () => {
  const prompt = api.compilePanelFollowupPrompt({
    ...input,
    topics: ['axes_reading'],
    customQuestion: 'Explain the numerical and mechanistic result.'
  }, { visualInput: true }).systemPrompt;

  assert.match(prompt, /every important numerical claim.*mechanistic claim.*corresponding/i);
  assert.match(prompt, /non-empty exact quote/i);
  assert.match(prompt, /exclude.*source_refs.*do not support/i);
  assert.match(prompt, /delete.*unsupported expansion/i);
  assert.match(prompt, /mean ordering.*pairwise significance/i);
  assert.match(prompt, /raw percentage.*percentage-point.*relative percent.*fold/i);
  assert.match(prompt, /individual points.*axis break/i);
  assert.match(prompt, /TTX.*neuronal mediation/i);
});
