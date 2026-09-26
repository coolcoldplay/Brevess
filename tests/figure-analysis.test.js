const test = require('node:test');
const assert = require('node:assert/strict');

require('../providers/provider-utils.js');
require('../core/figure-panel-planner.js');
const {
  FIGURE_ANALYSIS_VERSION,
  FIGURE_ANALYSIS_PROMPT_VERSION,
  createFigureAnalysisSchema,
  createUnlabeledFigureOverviewSchema,
  createFigurePanelBatchSchema,
  createFigureSynthesisSchema,
  createFigurePanelInterpretationSchema,
  createPanelFollowupSchema,
  compileFigureAnalysisPrompt,
  compileFigurePanelBatchPrompt,
  compileFigurePanelRecoveryPrompt,
  compileFigureSynthesisPrompt,
  compileUnlabeledFigureOverviewPrompt,
  compileFigurePanelInterpretationPrompt,
  compilePanelFollowupPrompt,
  isFatalFigureBatchError,
  validateFigureAnalysis,
  validateCachedFigureAnalysis,
  validateFigurePanelBatch,
  validateFigurePanelRecoveryResult,
  validateFigureSynthesis,
  validateUnlabeledFigureOverview,
  validateFigurePanelInterpretation,
  validatePanelFollowup,
  normalizePanelFollowupPrompts,
  cleanPanelSourceText,
  resolvePanelSourceQuote,
  buildFigureContext,
  normalizeMethodEvidence,
  localizeFigureMethodLabel,
  isUsableFigureAnalysisResult
} = require('../core/figure-analysis.js');
const { buildFigureCacheKey } = require('../core/cache-planner.js');

const figureInput = {
  figureId: 'figure-2',
  figureLabel: 'Figure 2',
  caption: 'Figure 2. Treatment reduced tumor volume in panels A-D.',
  articleTitle: 'A mechanistic cancer study',
  contextParagraphs: [
    { paragraphId: 'p7', text: 'Figure 2 shows lower tumor volume after treatment.' }
  ]
};

function validStandardFigureOutput(depth = 'standard') {
  const value = {
    figure_id: 'figure-2',
    analysis_depth: depth,
    basis: 'vision_text',
    figure_title_zh: '',
    figure_question_zh: '治疗是否抑制肿瘤生长？',
    remaining_question_zh: '仍需解释治疗如何作用，因此需要下一张图检验机制。',
    panels: [{
      panel: 'A',
      role: 'phenotype',
      phenotype_name_zh: '\u80bf\u7624\u4f53\u79ef',
      method_category: 'wet_lab',
      methods: ['CCK-8'],
      evidence_type_zh: '表型测量',
      experimental_methods: ['CCK-8'],
      statistical_methods: [],
      method_source: 'image',
      purpose_zh: '比较治疗组与对照组的肿瘤体积',
      design_zh: '治疗后连续测量两组肿瘤体积',
      comparison_zh: '治疗组对照组',
      direct_observation_zh: '治疗组肿瘤体积低于对照组',
      observation_source: 'image_observation',
      local_inference_zh: '结果支持治疗抑制肿瘤生长',
      contribution_zh: '建立主要疗效表型'
    }],
    panel_groups: [{
      panels: ['A'],
      group_goal_zh: '确认治疗产生疗效',
      group_conclusion_zh: '治疗组肿瘤生长受到抑制'
    }],
    logic_bridges: [],
    argument_chain: [{
      panels: ['A'],
      established_zh: 'Treatment changed the phenotype relative to control.',
      handoff_zh: 'This establishes the effect that later mechanism panels must explain.',
      evidence_level: 'intervention_effect'
    }],
    author_assembly_zh: '作者先建立疗效表型，再限定其解释边界。',
    core_conclusion_zh: '该治疗在当前模型中抑制肿瘤生长。',
    claim_boundary_zh: '该结果本身不能证明直接分子机制。'
  };
  if (depth === 'deep') Object.assign(value, {
    control_analysis: [{
      panels: ['A'], control_type: 'matched_control',
      excluded_explanation_zh: '排除未处理自然变化',
      adequacy_zh: '仍需独立模型验证'
    }],
    evidence_relations: [{
      panels: ['A'], relation_level: 'intervention_effect',
      rationale_zh: '存在处理与对照比较'
    }],
    negative_result_value_zh: '当前输入未提供阴性结果。',
    qualitative_quantitative_link_zh: '定性与定量方向一致。',
    alternative_explanations: ['仍可能受模型特异性影响。'],
    missing_link_if_panel_removed: ['删除 Panel A 后失去主要疗效证据。'],
    paper_argument_role_zh: '建立治疗有效性的核心证据。',
    deep_author_strategy_zh: '先证明疗效，再讨论机制边界。'
  });
  return value;
}

test('full and synthesis prompts use the same one-sentence upstream and disjoint grouping contract', () => {
  const full = compileFigureAnalysisPrompt(figureInput);
  const synthesis = compileFigureSynthesisPrompt(figureInput, []);
  for (const prompt of [full, synthesis]) {
    assert.match(prompt.systemPrompt, /每个已提供的 Panel 恰好归属一个证据块/);
    assert.match(prompt.systemPrompt, /upstream_context_zh 只写一句/);
    assert.match(prompt.systemPrompt, /不要再写启下/);
    assert.match(prompt.systemPrompt, /不按固定数量平均分组/);
    assert.match(prompt.systemPrompt, /未显著、趋势、未变化不能概括成显著改善/);
    assert.match(prompt.systemPrompt, /统计结论必须绑定到提供该检验的确切 Panel、指标和比较/);
    assert.match(prompt.systemPrompt, /ns 不能转移给同块的时间轨迹、代表图或示意图/);
    assert.match(prompt.systemPrompt, /Panel 记录是可出错的中间证据/);
    assert.match(prompt.systemPrompt, /不得凭模型记忆补充药物类别/);
    assert.match(prompt.systemPrompt, /只有实验计划、没有实验结果/);
    assert.match(prompt.systemPrompt, /紧邻前一块/);
    assert.doesNotMatch(prompt.systemPrompt, /6 个 Panel 组|precise reason it licenses the next step/);
    assert.ok(prompt.responseSchema.properties.panel_groups.items.required.includes('upstream_context_zh'));
  }
});

test('evidence grouping preserves concrete experiment units without broad-theme merging', () => {
  const prompts = [
    compileFigureAnalysisPrompt(figureInput),
    compileFigureSynthesisPrompt(figureInput, [])
  ];
  for (const { systemPrompt } of prompts) {
    assert.match(systemPrompt, /最小完整实验单元/);
    assert.match(systemPrompt, /代表图、配套定量、必要对照.*必须留在同一块/);
    assert.match(systemPrompt, /不能把定性图与其定量拆开/);
    assert.match(systemPrompt,
      /共享处理条件、研究对象、总体方向或宏观健康主题不足以合并独立实验/);
    assert.match(systemPrompt, /组目标必须点明本块的局部实验问题/);
    assert.match(systemPrompt, /相邻、标签连续、同色或同种方法都不是合并依据/);
    assert.match(systemPrompt, /不为缩短输出而把多个独立实验塞入大块/);
    assert.match(systemPrompt,
      /不得声称前一块“未检验”“仅观察”.*前一块已经做过相应检验/);
    assert.match(systemPrompt, /承上不要求虚构“上一块遗留问题”/);
    assert.match(systemPrompt, /平行的独立实验.*不强称证据缺口、递进因果或机制依赖/);
    const groupingPolicy = systemPrompt.slice(systemPrompt.indexOf('panel_groups 是'));
    assert.doesNotMatch(groupingPolicy, /代谢笼|葡萄糖耐量|心超|寿命|J[–-]S|T[–-]Z/,
      'grouping policy must remain independent of one paper and its Panel labels');
  }
});

test('full, batch, and recovery prompts share exact design and Panel-binding fidelity rules', () => {
  const input = { ...figureInput, panelHints: ['A', 'B'] };
  const prompts = [
    compileFigureAnalysisPrompt(input, { visualInput: true }),
    compileFigurePanelBatchPrompt(input, { visualInput: true }),
    compileFigurePanelRecoveryPrompt(input, ['A'], {
      visualInput: true,
      inputMode: 'figure_image'
    })
  ];
  for (const { systemPrompt } of prompts) {
    assert.match(systemPrompt,
      /trace the start and end of each intervention bar separately from each recording bar/);
    assert.match(systemPrompt, /Do not carry a dosing frequency, age or timing from another Panel/);
    assert.match(systemPrompt,
      /list the actually labelled cohorts explicitly in design as well as comparison/);
    assert.match(systemPrompt, /bind each bracket to its two exact endpoints/);
    assert.match(systemPrompt, /No bracket is not ns/);
    assert.match(systemPrompt,
      /Bind named readouts and enriched pathways to the exact Panel, tissue and comparison/);
    assert.match(systemPrompt,
      /neighbouring tissue plot cannot supply missing entries for this Panel/);
    assert.match(systemPrompt,
      /Enrichment supports an association with a pathway, not its activation, inhibition or causal mediation/);
    assert.match(systemPrompt,
      /Label enrichment evidence as 通路富集\/功能注释, not expression\/localization unless expression or localization was actually measured/);
  }
});

test('full, batch, and recovery prompts share per-fact source, anatomy, and method boundaries', () => {
  const input = { ...figureInput, panelHints: ['A', 'B'] };
  const visualPrompts = [
    compileFigureAnalysisPrompt(input, { visualInput: true }),
    compileFigurePanelBatchPrompt(input, { visualInput: true }),
    compileFigurePanelRecoveryPrompt(input, ['A'], {
      visualInput: true,
      inputMode: 'figure_image'
    })
  ];
  for (const { systemPrompt } of visualPrompts) {
    assert.match(systemPrompt, /Assign provenance at the level of each concrete fact/i);
    assert.match(systemPrompt, /visible only in pixels.*image_observation/i);
    assert.match(systemPrompt, /multi_source.*same fact.*both/i);
    assert.match(systemPrompt, /Do not complete an anatomical series/i);
    assert.match(systemPrompt, /domain knowledge/i);
    assert.match(systemPrompt, /experimental acquisition or measured readout/i);
    assert.match(systemPrompt, /inferential tests only in statistical_methods/i);
    assert.match(systemPrompt, /statistics alone.*method_category/i);
    assert.match(systemPrompt, /image-only facts.*image_observation/i);
    assert.match(systemPrompt, /observation_source labels only direct_observation_zh/);
    assert.match(systemPrompt, /ANY claim.*depends on pixels.*choose image_observation/);
    assert.match(systemPrompt, /Merely receiving both image and text does not justify multi_source/);
    assert.match(systemPrompt, /numerical measurements extracted from those images are imaging/);
    assert.match(systemPrompt, /approximate plotted value.*exact numerical value/);
  }

  const textPrompts = [
    compileFigureAnalysisPrompt(input, { visualInput: false }),
    compileFigurePanelBatchPrompt(input, { visualInput: false }),
    compileFigurePanelRecoveryPrompt(input, ['A'], {
      visualInput: false,
      inputMode: 'caption_context'
    })
  ];
  for (const { systemPrompt } of textPrompts) {
    assert.match(systemPrompt, /Assign provenance at the level of each concrete fact/i);
    assert.match(systemPrompt, /Do not complete an anatomical series/i);
    assert.match(systemPrompt, /experimental acquisition or measured readout/i);
    assert.match(systemPrompt, /every concrete fact.*caption or body/i);
    assert.match(systemPrompt, /never use image_observation/i);
    assert.match(systemPrompt, /do not infer image-only labels/i);
  }
});

test('upstream survives result/cache normalization and v12/v13 saved results remain readable', () => {
  const input = { ...figureInput, panelHints: ['A'] };
  const raw = validStandardFigureOutput();
  raw.panel_groups[0].upstream_context_zh = '针对治疗能否影响肿瘤生长的问题，本块先检验疗效。';
  const result = validateFigureAnalysis(raw, input, { visualInput: true });
  assert.match(result.panelGroups[0].upstreamContext, /本块先检验疗效/);
  const cached = validateCachedFigureAnalysis(result, input, { visualInput: true });
  assert.equal(cached.panelGroups[0].upstreamContext, result.panelGroups[0].upstreamContext);
  for (const figureVersion of ['12-panel-specific-durable-results', '13-figure-evidence-fields']) {
    const old = structuredClone(result);
    old.figureVersion = figureVersion;
    delete old.panelGroups[0].upstreamContext;
    const restored = validateCachedFigureAnalysis(old, input, { visualInput: true });
    assert.equal(restored.panelGroups[0].upstreamContext, '');
    assert.equal(restored.panels.length, result.panels.length);
  }
});

test('normalization retains nine independent group records instead of silently dropping groups after six', () => {
  const raw = validStandardFigureOutput();
  raw.panels = Array.from({ length: 9 }, (_, i) => ({ ...raw.panels[0],
    panel: String.fromCharCode(65 + i), direct_observation_zh: `Independent observation ${i}`
  }));
  raw.panel_groups = raw.panels.map(panel => ({ panels: [panel.panel],
    group_goal_zh: `Question ${panel.panel}`, group_conclusion_zh: `Observation ${panel.panel}`,
    upstream_context_zh: `本块检验问题 ${panel.panel}。`
  }));
  const result = validateFigureAnalysis(raw, figureInput, { visualInput: true });
  assert.equal(result.panelGroups.length, 9);
  assert.deepEqual(result.panelGroups.map(group => group.panels), raw.panels.map(panel => [panel.panel]));
});

test('fresh synthesis rejects empty, missing, unknown and overlapping evidence group ownership', () => {
  const raw = validStandardFigureOutput();
  const input = { ...figureInput, panelHints: ['A'] };
  const evidence = validateFigureAnalysis(raw, input, { visualInput: true }).panels;
  const synthesis = { ...raw };
  delete synthesis.panels;
  for (const panel_groups of [[], [{ ...raw.panel_groups[0], panels: [] }],
    [{ ...raw.panel_groups[0], panels: ['Z'] }], [raw.panel_groups[0], raw.panel_groups[0]]]) {
    assert.throws(() => validateFigureSynthesis({ ...synthesis, panel_groups }, input, evidence,
      { visualInput: true }), /Figure evidence group/);
  }
  assert.equal(validateFigureSynthesis(synthesis, input, evidence, { visualInput: true }).panelGroups.length, 1);
});

test('defines a versioned strict Figure walkthrough response schema', () => {
  assert.equal(FIGURE_ANALYSIS_VERSION, '14-evidence-block-upstream');
  const schema = createFigureAnalysisSchema('standard');
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.properties.basis.enum, ['vision_text', 'caption_context']);
  assert.ok(schema.required.includes('figure_id'));
  assert.ok(schema.required.includes('panels'));
  assert.ok(schema.required.includes('figure_question_zh'));
  assert.ok(schema.required.includes('figure_title_zh'));
  assert.ok(schema.required.includes('panel_groups'));
  assert.ok(schema.required.includes('logic_bridges'));
  assert.ok(schema.required.includes('argument_chain'));
  assert.ok(schema.required.includes('author_assembly_zh'));
  assert.deepEqual(schema.properties.analysis_depth.enum, ['standard']);
  assert.ok(schema.properties.panels.items.properties.observation_source.enum
    .includes('caption_statement'));
  const panel = schema.properties.panels.items;
  assert.ok(panel.required.includes('phenotype_name_zh'));
  assert.ok(panel.required.includes('method_category'));
  assert.ok(panel.required.includes('methods'));
  assert.ok(panel.required.includes('method_source'));
  assert.deepEqual(panel.properties.method_category.enum, [
    'wet_lab', 'imaging', 'bioinformatics', 'clinical', 'schematic', 'other'
  ]);
  assert.deepEqual(panel.properties.method_source.enum, [
    'image', 'caption', 'body', 'multi_source', 'inference'
  ]);
});

test('uses a compact evidence overview when the webpage exposes no stable Panel labels', () => {
  const prompt = compileUnlabeledFigureOverviewPrompt(figureInput, {
    visualInput: false,
    analysisDepth: 'standard'
  });
  const schema = createUnlabeledFigureOverviewSchema('standard');
  const payload = JSON.parse(prompt.userPrompt);
  assert.equal(prompt.schemaName, 'figure_unlabeled_overview_standard');
  assert.equal(payload.pass, 'unlabeled_figure_overview');
  assert.deepEqual(payload.expected_panel_labels, []);
  assert.equal(schema.additionalProperties, false);
  assert.ok(schema.required.includes('evidence_steps'));
  assert.equal(Object.hasOwn(schema.properties, 'panels'), false);

  const result = validateUnlabeledFigureOverview({
    figure_id: 'figure-2',
    analysis_depth: 'standard',
    basis: 'caption_context',
    figure_question_zh: 'Does the treatment reduce tumor burden?',
    evidence_steps: [{
      source_zh: 'Figure caption',
      established_zh: 'Treatment reduced tumor volume relative to control.',
      handoff_zh: 'This motivates testing whether the effect is reproducible.',
      evidence_level: 'intervention_effect'
    }],
    author_assembly_zh: 'The author orders the evidence from phenotype to validation.',
    core_conclusion_zh: 'The treatment reduces tumor burden in the supplied model.',
    claim_boundary_zh: 'The supplied evidence does not establish a direct mechanism.'
  }, figureInput, { visualInput: false, analysisDepth: 'standard' });

  assert.equal(result.unlabeledOverview, true);
  assert.equal(result.panels.length, 0);
  assert.equal(result.argumentChain.length, 1);
  assert.match(result.argumentChain[0].established, /Figure caption/);
  assert.equal(result.argumentChain[0].evidenceLevel, 'intervention_effect');
  assert.equal(result.basis, 'caption_context');
  assert.equal(isUsableFigureAnalysisResult(
    result,
    { figureId: 'figure-2', panelHints: [] },
    { analysisDepth: 'standard' }
  ), true);
  assert.equal(isUsableFigureAnalysisResult(
    { ...result, argumentChain: [] },
    { figureId: 'figure-2', panelHints: [] },
    { analysisDepth: 'standard' }
  ), false);
});

test('remaining question and experimental methods are required by standard and deep Figure compilers', () => {
  for (const depth of ['standard', 'deep']) {
    const schema = createFigureAnalysisSchema(depth);
    const panel = schema.properties.panels.items;
    assert.ok(schema.required.includes('remaining_question_zh'), depth);
    assert.ok(panel.required.includes('evidence_type_zh'), depth);
    assert.ok(panel.required.includes('experimental_methods'), depth);
    assert.ok(panel.required.includes('statistical_methods'), depth);
    assert.ok(createFigurePanelBatchSchema(depth).properties.panels.items.required
      .includes('experimental_methods'), depth);
    assert.ok(createFigureSynthesisSchema(depth).required.includes('remaining_question_zh'), depth);

    const prompt = compileFigureAnalysisPrompt(figureInput, { analysisDepth: depth, visualInput: true });
    assert.match(prompt.systemPrompt, /remaining_question_zh.*next Figure/i, depth);
    assert.match(prompt.systemPrompt, /evidence_type_zh.*empty string.*unsupported|unsupported.*evidence_type_zh.*empty string/i, depth);
    assert.match(prompt.systemPrompt, /experimental_methods.*immunofluorescence.*western blot.*qPCR/i, depth);
    assert.match(prompt.systemPrompt, /statistical_methods.*do not infer.*ANOVA/i, depth);

    const batchPrompt = compileFigurePanelBatchPrompt(
      { ...figureInput, panelHints: ['A'] }, { analysisDepth: depth, visualInput: true }
    );
    assert.match(batchPrompt.systemPrompt,
      /evidence_type_zh.*empty string.*unsupported|unsupported.*evidence_type_zh.*empty string/i, depth);
  }
});

test('splits large Figure output into strict Panel extraction and synthesis passes', () => {
  const panelSchema = createFigurePanelBatchSchema('deep');
  const synthesisSchema = createFigureSynthesisSchema('deep');
  assert.deepEqual(panelSchema.required, ['figure_id', 'analysis_depth', 'basis', 'panels']);
  assert.equal(panelSchema.additionalProperties, false);
  assert.equal(Object.hasOwn(synthesisSchema.properties, 'panels'), false);
  assert.equal(synthesisSchema.required.includes('panels'), false);

  const panelPrompt = compileFigurePanelBatchPrompt(
    { ...figureInput, panelHints: ['A'] },
    { visualInput: false, analysisDepth: 'deep' }
  );
  const panelInput = JSON.parse(panelPrompt.userPrompt);
  assert.equal(panelPrompt.schemaName, 'figure_panel_batch_deep');
  assert.equal(panelInput.pass, 'panel_extraction');
  assert.deepEqual(panelInput.expected_panel_labels, ['A']);

  const full = validStandardFigureOutput('deep');
  const normalizedPanels = validateFigurePanelBatch({
    figure_id: full.figure_id,
    analysis_depth: full.analysis_depth,
    basis: 'caption_context',
    panels: full.panels.map(panel => ({
      ...panel,
      method_source: 'caption',
      observation_source: 'caption_statement'
    }))
  }, { ...figureInput, panelHints: ['A'] }, {
    visualInput: false, analysisDepth: 'deep'
  });
  assert.equal(normalizedPanels.panels.length, 1);
  assert.equal(normalizedPanels.coreConclusion, '');

  const synthesisPrompt = compileFigureSynthesisPrompt(
    figureInput, normalizedPanels.panels,
    { visualInput: false, analysisDepth: 'deep' }
  );
  const synthesisInput = JSON.parse(synthesisPrompt.userPrompt);
  assert.equal(synthesisPrompt.schemaName, 'figure_synthesis_deep');
  assert.equal(synthesisInput.pass, 'figure_synthesis');
  assert.equal(synthesisInput.panel_evidence.length, 1);
  const { panels, ...synthesisRaw } = {
    ...full,
    basis: 'caption_context'
  };
  const synthesized = validateFigureSynthesis(
    synthesisRaw, figureInput, normalizedPanels.panels,
    { visualInput: false, analysisDepth: 'deep' }
  );
  assert.equal(synthesized.panels.length, 1);
  assert.equal(synthesized.coreConclusion, '该治疗在当前模型中抑制肿瘤生长。');
});

test('all Panel batch variants contain only Panel extraction instructions', () => {
  const forbiddenSynthesisFields = [
    'argument_chain', 'panel_groups', 'logic_bridges', 'author_assembly'
  ];
  for (const analysisDepth of ['standard', 'deep']) {
    for (const visualInput of [false, true]) {
      const compiled = compileFigurePanelBatchPrompt(
        { ...figureInput, panelHints: ['A'] },
        { analysisDepth, visualInput }
      );
      const request = JSON.parse(compiled.userPrompt);
      assert.equal(request.pass, 'panel_extraction');
      assert.deepEqual(Object.keys(compiled.responseSchema.properties).sort(), [
        'analysis_depth', 'basis', 'figure_id', 'panels'
      ]);
      for (const field of forbiddenSynthesisFields) {
        assert.doesNotMatch(compiled.systemPrompt, new RegExp(field, 'i'),
          `${analysisDepth}/${visualInput ? 'vision' : 'caption-only'}:${field}`);
      }
      assert.match(compiled.systemPrompt, /only the requested Panels/i);
      assert.match(compiled.systemPrompt, /exactly one Panel record/i);
    }
  }
});

test('keeps requested Panel records when a batch response also repeats other Panels', () => {
  const full = validStandardFigureOutput('deep');
  const requested = ['A', 'B'];
  const panelFor = panel => ({
    ...full.panels[0], panel,
    method_source: 'caption', observation_source: 'caption_statement'
  });
  const normalized = validateFigurePanelBatch({
    figure_id: full.figure_id,
    analysis_depth: full.analysis_depth,
    basis: 'caption_context',
    panels: [panelFor('A'), panelFor('B'), panelFor('C'), panelFor('D')]
  }, { ...figureInput, panelHints: requested }, {
    visualInput: false, analysisDepth: 'deep'
  });

  assert.deepEqual(normalized.panels.map(panel => panel.panel), requested);
  assert.deepEqual(normalized.panelCoverage.returnedPanels, requested);
  assert.deepEqual(normalized.panelCoverage.missingPanels, []);
  assert.deepEqual(normalized.panelCoverage.unexpectedPanels, ['C', 'D']);
  assert.equal(normalized.panelCoverage.ignoredUnexpectedPanelCount, 2);
});

test('compiles and validates a bounded Panel follow-up request', () => {
  const panel = {
    panel: 'A', role: 'phenotype', phenotypeName: 'Tumor volume', methods: ['CCK-8'],
    purpose: 'Measure response', design: 'Treatment versus control', comparison: 'treated vs control',
    directObservation: 'Lower volume after treatment'
  };
  const input = {
    ...figureInput, panel, topics: ['grouping', 'axes_reading'],
    customQuestion: '为什么作者使用这一统计方法？'
  };
  const prompt = compilePanelFollowupPrompt(input, {
    visualInput: true,
    topicPrompts: { grouping: '只解释本文实际采用的分组。' }
  });
  assert.equal(prompt.schemaName, 'figure_panel_followup');
  assert.deepEqual(createPanelFollowupSchema().properties.topics.items.enum, [
    'grouping', 'technique_principle', 'axes_reading', 'sample_information'
  ]);
  assert.ok(createPanelFollowupSchema().required.includes('source_refs'));
  assert.equal(
    createPanelFollowupSchema().properties.source_refs.items.additionalProperties,
    false
  );
  const answer = validatePanelFollowup({
    figure_id: 'figure-2', panel: 'A', topics: ['grouping', 'axes_reading'],
    basis: 'vision_text', answer_zh: '分组按处理与对照比较；坐标仅按图中可见标签读取。',
    claim_boundary_zh: '未显示的信息不能推断。',
    source_refs: [
      { kind: 'paragraph', ref: 'p7', paragraph_id: 'p7', quote: 'lower tumor' },
      { kind: 'panel', ref: '2A', paragraph_id: '', quote: '' },
      { kind: 'paragraph', ref: 'unknown', paragraph_id: 'unknown', quote: 'hallucinated' },
      { kind: 'paragraph', ref: 'p7', paragraph_id: 'p7', quote: 'duplicate' }
    ]
  }, input, { visualInput: true });
  assert.equal(answer.panel, 'A');
  assert.equal(answer.basis, 'vision_text');
  assert.equal(answer.customQuestion, '为什么作者使用这一统计方法?');
  assert.deepEqual(answer.sourceRefs, [
    {
      kind: 'panel', ref: '2A', figureId: 'figure-2', panelId: 'A',
      paragraphId: '', quote: ''
    },
    { kind: 'paragraph', ref: 'p7', paragraphId: 'p7', quote: 'lower tumor' }
  ]);
  assert.match(prompt.userPrompt, /existing_panel_interpretation/);
  assert.match(prompt.systemPrompt, /Match the depth and length to the requested topics/i);
  assert.match(prompt.systemPrompt, /do not shorten a substantive answer merely for brevity/i);
  assert.doesNotMatch(prompt.systemPrompt, /Write concise Chinese prose/i);
  const payload = JSON.parse(prompt.userPrompt);
  assert.equal(payload.custom_question, '为什么作者使用这一统计方法?');
  assert.equal(payload.requested_topic_instructions.grouping, '只解释本文实际采用的分组。');
  assert.deepEqual(payload.available_source_refs, {
    panel: '2A',
    paragraph_ids: ['p7']
  });
  assert.match(prompt.systemPrompt, /source_refs/);
  assert.match(prompt.systemPrompt, /paragraph_id/i);
  assert.equal(Object.keys(normalizePanelFollowupPrompts({})).length, 4);
});

test('Panel follow-up always includes its deterministic Panel source and rejects source extras', () => {
  const input = {
    ...figureInput,
    panel: { panel: 'A' },
    topics: ['grouping'],
    customQuestion: ''
  };
  const raw = {
    figure_id: 'figure-2', panel: 'A', topics: ['grouping'],
    basis: 'caption_context', answer_zh: '处理组与对照组比较。',
    claim_boundary_zh: '仅限已提供证据。', source_refs: []
  };
  assert.deepEqual(
    validatePanelFollowup(raw, input, { visualInput: false }).sourceRefs,
    [{
      kind: 'panel', ref: '2A', figureId: 'figure-2', panelId: 'A',
      paragraphId: '', quote: ''
    }]
  );
  assert.throws(() => validatePanelFollowup({
    ...raw,
    source_refs: [{
      kind: 'paragraph', ref: 'p7', paragraph_id: 'p7', quote: 'result',
      selector: '#arbitrary'
    }]
  }, input, { visualInput: false }), /unsupported field/i);

  const contextOrdered = validatePanelFollowup({
    ...raw,
    source_refs: [
      { kind: 'paragraph', ref: 'p8', paragraph_id: 'p8', quote: 'not in context' },
      { kind: 'paragraph', ref: '', paragraph_id: 'p7', quote: '  first   result ' }
    ]
  }, {
    ...input,
    contextParagraphs: [
      { paragraphId: 'p7', text: 'The first result was replicated.' },
      { paragraphId: 'p8', text: 'second' }
    ]
  }, { visualInput: false });
  assert.deepEqual(contextOrdered.sourceRefs.map(source => source.ref), ['2A', 'p7', 'p8']);
  assert.equal(contextOrdered.sourceRefs[1].quote, 'first result');
  assert.equal(contextOrdered.sourceRefs[2].quote, '');

  const ambiguousDisplay = validatePanelFollowup({
    ...raw, panel: '1A', source_refs: []
  }, {
    ...input, panel: { panel: '1A' }
  }, { visualInput: false });
  assert.deepEqual(ambiguousDisplay.sourceRefs[0], {
    kind: 'panel', ref: '2·1A', figureId: 'figure-2', panelId: '1A',
    paragraphId: '', quote: ''
  });
});

test('Panel follow-up quotes recover exact source typography without weakening scientific text', () => {
  assert.equal(cleanPanelSourceText('p < 0.05 and x > 1'), 'p < 0.05 and x > 1');
  assert.equal(resolvePanelSourceQuote('<b>result</b>', 'result'), '');
  const source = 'The value was 69.9% ± 2.8%; Figure 1d ; the result was replicated.';
  assert.equal(
    resolvePanelSourceQuote(
      'The value was 69.9% ± 2.8%; Figure 1d; the result was replicated.', source
    ),
    source
  );
  assert.equal(resolvePanelSourceQuote(
    'The value was 69.8% ± 2.8%; Figure 1d; the result was replicated.', source
  ), '');
  assert.equal(resolvePanelSourceQuote(
    'The value was 69.9% - 2.8%; Figure 1d; the result was replicated.', source
  ), '');
  assert.equal(resolvePanelSourceQuote(
    'the result was replicated.',
    'the result was replicated. Another clause; the result was replicated.'
  ), '');
  assert.equal(resolvePanelSourceQuote('Dose was 102 units.', 'Dose was 10² units.'), '');
  assert.equal(resolvePanelSourceQuote('Dose was 10² units.', 'Dose was 10² units.'),
    'Dose was 10² units.');
  assert.equal(resolvePanelSourceQuote('result.', '🧪 result.'), 'result.');
  assert.equal(resolvePanelSourceQuote(
    'Value was 1.', '🧪 test. Value was 1. End.'
  ), 'Value was 1.');
  assert.equal(resolvePanelSourceQuote('5%', '15%'), '');
  assert.equal(resolvePanelSourceQuote('2.', 'Value = -2.'), '');
  assert.equal(resolvePanelSourceQuote('0.05', 'The result had p < 0.05.'), '0.05');
  assert.equal(resolvePanelSourceQuote('p < 0.05', 'The result had p < 0.051.'), '');
  assert.equal(resolvePanelSourceQuote(
    'ranked fifth PDF sentence at dose 102 units with p < 0.05',
    'Figure 2A reports the ranked fifth PDF sentence at dose 102 units with p < 0.05.'
  ), 'ranked fifth PDF sentence at dose 102 units with p < 0.05');
  assert.equal(resolvePanelSourceQuote('2', 'The value was 2.5.'), '');
  assert.equal(resolvePanelSourceQuote('05', 'The result had p < 0.05.'), '');

  const input = {
    ...figureInput,
    panel: { panel: 'A' }, topics: [], customQuestion: 'Quote the result.',
    contextParagraphs: [
      { paragraphId: 'p-layout', text: source },
      { paragraphId: 'p-duplicate',
        text: 'Repeated sentence. Another sentence. Repeated sentence.' }
    ]
  };
  const result = validatePanelFollowup({
    figure_id: 'figure-2', panel: 'A', topics: [], basis: 'caption_context',
    answer_zh: 'The supplied paragraph reports the result.',
    claim_boundary_zh: 'Limited to supplied evidence.',
    source_refs: [
      { kind: 'paragraph', ref: 'p-layout', paragraph_id: 'p-layout',
        quote: 'The value was 69.8% ± 2.8%; Figure 1d;' },
      { kind: 'paragraph', ref: 'p-layout', paragraph_id: 'p-layout', quote: '' },
      { kind: 'paragraph', ref: 'p-layout', paragraph_id: 'p-layout',
        quote: 'Figure 1d; the result was replicated.' },
      { kind: 'paragraph', ref: 'p-duplicate', paragraph_id: 'p-duplicate',
        quote: 'Repeated sentence.' }
    ]
  }, input, { visualInput: false });
  assert.deepEqual(result.sourceRefs.slice(1), [
    { kind: 'paragraph', ref: 'p-layout', paragraphId: 'p-layout',
      quote: 'Figure 1d ; the result was replicated.' },
    { kind: 'paragraph', ref: 'p-duplicate', paragraphId: 'p-duplicate', quote: '' }
  ]);

  const scientificInput = {
    ...input,
    contextParagraphs: [{ paragraphId: 'p-science',
      text: '🧪 Dose was 10² units; signed value was -2; p < 0.05 and x > 1.' }]
  };
  const scientificPrompt = JSON.parse(compilePanelFollowupPrompt(
    scientificInput, { visualInput: false }
  ).userPrompt);
  assert.equal(scientificPrompt.related_body_context[0].text,
    '🧪 Dose was 10² units; signed value was -2; p < 0.05 and x > 1.');
  const scientificResult = validatePanelFollowup({
    figure_id: 'figure-2', panel: 'A', topics: [], basis: 'caption_context',
    answer_zh: 'The paragraph reports the dose.',
    claim_boundary_zh: 'Limited to supplied evidence.',
    source_refs: [
      { kind: 'paragraph', ref: 'p-science', paragraph_id: 'p-science',
        quote: 'Dose was 102 units' },
      { kind: 'paragraph', ref: 'p-science', paragraph_id: 'p-science',
        quote: 'Dose was 10² units' }
    ]
  }, scientificInput, { visualInput: false });
  assert.equal(scientificResult.sourceRefs[1].quote, 'Dose was 10² units');
});

test('all Figure prompt compilers preserve scientific caption and body source text', () => {
  const caption =
    'Figure 7. Shared threshold p < 0.05 and x > 1. (A) 🧪 Dose was 10² units.';
  const sharedLegend = 'Figure 7. Shared threshold p < 0.05 and x > 1.';
  const targetCaption = '(A) 🧪 Dose was 10² units.';
  const bodyText = 'Figure 7A reports 🧪 10² units with p < 0.05 and x > 1.';
  const input = {
    figureId: 'figure-7', figureLabel: 'Figure 7', articleTitle: 'Source fidelity',
    caption, panelHints: ['A'],
    contextParagraphs: [{ paragraphId: 'p-science', sectionTitle: 'Results', text: bodyText }]
  };
  const full = JSON.parse(compileFigureAnalysisPrompt(input).userPrompt);
  assert.equal(full.caption, caption);
  assert.equal(full.related_body_context[0].text, bodyText);

  const batch = JSON.parse(compileFigurePanelBatchPrompt(input).userPrompt);
  assert.equal(batch.figure_context.shared_legend, sharedLegend);
  assert.equal(batch.figure_context.panel_caption_slices.A, targetCaption);
  assert.equal(batch.figure_context.body_registry['p-science'].text, bodyText);

  const recovery = compileFigurePanelRecoveryPrompt(input, ['A'], {
    inputMode: 'caption_context', visualInput: false
  }).userPayload;
  assert.equal(recovery.figure_context.shared_legend, sharedLegend);
  assert.equal(recovery.figure_context.panel_caption_slices.A, targetCaption);
  assert.equal(recovery.figure_context.body_registry['p-science'].text, bodyText);

  const synthesis = JSON.parse(compileFigureSynthesisPrompt(input, []).userPrompt);
  assert.equal(synthesis.caption, caption);
  assert.equal(synthesis.related_body_context[0].text, bodyText);
  const overview = JSON.parse(compileUnlabeledFigureOverviewPrompt(input).userPrompt);
  assert.equal(overview.caption, caption);
  assert.equal(overview.related_body_context[0].text, bodyText);

  const singleInput = {
    ...input, panelId: 'A', panel: { panel: 'A' }, topics: [], customQuestion: '',
    captionEvidence: { sharedLegend, targetText: targetCaption }
  };
  const interpretation = JSON.parse(
    compileFigurePanelInterpretationPrompt(singleInput).userPrompt
  );
  assert.equal(interpretation.shared_legend, sharedLegend);
  assert.equal(interpretation.target_panel_caption, targetCaption);
  assert.equal(interpretation.related_body_context[0].text, bodyText);
  const followup = JSON.parse(compilePanelFollowupPrompt(singleInput).userPrompt);
  assert.equal(followup.shared_legend, sharedLegend);
  assert.equal(followup.target_panel_caption, targetCaption);
  assert.equal(followup.related_body_context[0].text, bodyText);
});

test('custom-only Panel follow-up compiles and validates with empty requested topics', () => {
  const input = {
    ...figureInput,
    panel: { panel: 'A', purpose: 'Compare paired samples' },
    topics: [],
    customQuestion: '为什么作者在这里使用配对 t 检验？'
  };
  const prompt = compilePanelFollowupPrompt(input, { visualInput: false });
  const payload = JSON.parse(prompt.userPrompt);
  assert.deepEqual(payload.requested_topics, []);
  assert.equal(payload.custom_question, '为什么作者在这里使用配对 t 检验?');
  assert.match(prompt.systemPrompt, /topics is caller-supplied metadata, not a classification result/i);
  assert.match(prompt.systemPrompt, /when requested_topics is \[\], return topics: \[\]/i);
  assert.match(prompt.systemPrompt, /custom_question never authorizes inferring or adding/i);
  assert.match(prompt.systemPrompt, /Copy every quote character verbatim/i);

  for (const inferredTopics of [
    ['grouping', 'axes_reading', 'sample_information'],
    ['grouping', 'sample_information']
  ]) {
    assert.throws(() => validatePanelFollowup({
      figure_id: 'figure-2', panel: 'A', topics: inferredTopics, basis: 'caption_context',
      answer_zh: '配对 t 检验适用于比较同一对象或匹配对象的两次测量。',
      claim_boundary_zh: '具体配对方式须以方法部分为准。', source_refs: []
    }, input, { visualInput: false }), /topic/i);
  }

  const answer = validatePanelFollowup({
    figure_id: 'figure-2', panel: 'A', topics: [], basis: 'caption_context',
    answer_zh: '配对 t 检验适用于比较同一对象或匹配对象的两次测量。',
    claim_boundary_zh: '具体配对方式须以方法部分为准。', source_refs: []
  }, input, { visualInput: false });
  assert.deepEqual(answer.topics, []);
  assert.equal(answer.customQuestion, '为什么作者在这里使用配对 t 检验?');
});

test('Extended Data Panel follow-up uses the canonical ED short source ref', () => {
  const input = {
    ...figureInput,
    figureId: 'figure-ed1',
    figureLabel: 'Extended Data Fig. 1',
    panel: { panel: 'A' },
    topics: ['grouping'],
    customQuestion: ''
  };
  const answer = validatePanelFollowup({
    figure_id: 'figure-ed1', panel: 'A', topics: ['grouping'],
    basis: 'caption_context', answer_zh: 'Independent validation.',
    claim_boundary_zh: 'Limited to supplied evidence.', source_refs: []
  }, input, { visualInput: false });

  assert.equal(answer.sourceRefs[0].ref, 'ED1A');
});

test('uses a dedicated strict schema for one Panel without Figure synthesis fields', () => {
  const prompt = compileFigurePanelInterpretationPrompt({
    ...figureInput,
    panelId: 'A',
    topic: 'grouping_stats',
    captionEvidence: {
      sharedLegend: 'Values are mean ± SEM.',
      targetText: '(A) Treatment reduced tumor volume.'
    },
    contextParagraphs: [
      { paragraphId: 'r1', sectionTitle: 'Results', text: 'Figure 2A reports the comparison.' },
      { paragraphId: 'm1', sectionTitle: 'Methods', text: 'Groups were randomized.' }
    ]
  }, { visualInput: false });
  const schema = createFigurePanelInterpretationSchema();
  const payload = JSON.parse(prompt.userPrompt);
  assert.equal(prompt.schemaName, 'figure_panel_interpretation_v1');
  assert.equal(schema.additionalProperties, false);
  assert.equal(Object.hasOwn(schema.properties, 'panel_groups'), false);
  assert.equal(payload.panel, 'A');
  assert.equal(payload.target_panel_caption, '(A) Treatment reduced tumor volume.');
  assert.equal(payload.related_body_context.length, 2);
  assert.match(prompt.systemPrompt, /Assign provenance at the level of each concrete fact/i);
  assert.match(prompt.systemPrompt, /inferential tests only in statistical_methods/i);
  assert.match(prompt.systemPrompt, /statistics alone.*method_category/i);
  assert.match(prompt.systemPrompt, /nonsignificant ordinary difference test does not establish equivalence/i);
  assert.match(prompt.systemPrompt,
    /significant within-condition change.*nonsignificant change.*do not demonstrate/i);
  assert.match(prompt.systemPrompt, /never use image_observation/i);

  const rawPanel = validStandardFigureOutput().panels[0];
  const result = validateFigurePanelInterpretation({
    figure_id: 'figure-2', panel: 'A', basis: 'caption_context',
    panel_interpretation: {
      ...rawPanel,
      method_source: 'caption',
      observation_source: 'caption_statement'
    },
    claim_boundary_zh: 'The supplied evidence does not establish direct causality.'
  }, { ...figureInput, panelId: 'A' }, { visualInput: false });
  assert.equal(result.panel, 'A');
  assert.equal(result.basis, 'caption_context');
  assert.equal(result.observationSource, 'caption_statement');
  assert.match(result.claimBoundary, /direct causality/i);
});

test('single-Panel normalization separates explicit statistics and respects bilingual acquisition signals', () => {
  const rawPanel = {
    ...validStandardFigureOutput().panels[0],
    method_category: 'wet_lab',
    methods: [
      '双光子活体成像',
      'z-stack acquisition',
      '双通道图像定量',
      '单因素方差分析 (one-way ANOVA)',
      'Bonferroni 多重比较检验'
    ],
    experimental_methods: [
      '在同一动物中进行双光子活体成像和 z-stack 采集',
      'one-way ANOVA'
    ],
    statistical_methods: [
      "one-way ANOVA with Bonferroni's multiple comparison test",
      'F(2,13) = 10.22',
      'p = 0.0291'
    ],
    method_source: 'body',
    direct_observation_zh: '图注报告 p = 0.0291；正文报告均值为 60.2% 与 69.9%。',
    observation_source: 'caption_statement',
    local_inference_zh: '保留模型给出的局部科学推断。',
    contribution_zh: '保留模型给出的证据贡献。'
  };
  const result = validateFigurePanelInterpretation({
    figure_id: 'figure-2', panel: 'A', basis: 'caption_context',
    panel_interpretation: rawPanel,
    claim_boundary_zh: 'Limited to supplied caption and body evidence.'
  }, { ...figureInput, panelId: 'A' }, { visualInput: false });

  assert.equal(result.methodCategory, 'imaging');
  assert.deepEqual(result.methods,
    ['双光子活体成像', 'z-stack acquisition', '双通道图像定量']);
  assert.ok(result.methodDetails.every(item => item.methodFamily === 'imaging'));
  assert.deepEqual(result.experimentalMethods,
    ['在同一动物中进行双光子活体成像和 z-stack 采集']);
  assert.deepEqual(result.statisticalMethods, [
    "one-way ANOVA with Bonferroni's multiple comparison test",
    'F(2,13) = 10.22',
    'p = 0.0291'
  ]);
  assert.equal(result.observationSource, 'multi_source');
  assert.equal(result.localInference, '保留模型给出的局部科学推断。');
  assert.equal(result.contribution, '保留模型给出的证据贡献。');

  const mixedMethod = '双光子成像并用 one-way ANOVA 分析成像读数';
  const mixedResult = validateFigurePanelInterpretation({
    figure_id: 'figure-2', panel: 'A', basis: 'caption_context',
    panel_interpretation: {
      ...rawPanel,
      methods: [mixedMethod],
      experimental_methods: [mixedMethod],
      statistical_methods: [],
      direct_observation_zh: '正文未提供均值；图注报告 p = 0.0291。',
      observation_source: 'caption_statement'
    },
    claim_boundary_zh: 'Limited to supplied caption and body evidence.'
  }, { ...figureInput, panelId: 'A' }, { visualInput: false });
  assert.deepEqual(mixedResult.methods, [mixedMethod]);
  assert.deepEqual(mixedResult.experimentalMethods, [mixedMethod]);
  assert.deepEqual(mixedResult.statisticalMethods, []);
  assert.equal(mixedResult.methodCategory, 'imaging');
  assert.equal(mixedResult.observationSource, 'caption_statement');
});

test('single-Panel compatibility adds only v13 defaults and preserves strict legacy fields', () => {
  const legacyComplete = {
    ...validStandardFigureOutput().panels[0],
    method_source: 'caption',
    observation_source: 'caption_statement'
  };
  delete legacyComplete.evidence_type_zh;
  delete legacyComplete.experimental_methods;
  delete legacyComplete.statistical_methods;
  const response = panel => ({
    figure_id: 'figure-2', panel: 'A', basis: 'caption_context',
    panel_interpretation: panel,
    claim_boundary_zh: 'Limited to supplied evidence.'
  });
  const input = { ...figureInput, panelId: 'A' };

  const projected = validateFigurePanelInterpretation(
    response(legacyComplete), input, { visualInput: false }
  );
  assert.equal(projected.evidenceType, '');
  assert.deepEqual(projected.experimentalMethods, []);
  assert.deepEqual(projected.statisticalMethods, []);

  const missingLegacyRequired = { ...legacyComplete };
  delete missingLegacyRequired.purpose_zh;
  assert.throws(
    () => validateFigurePanelInterpretation(
      response(missingLegacyRequired), input, { visualInput: false }
    ),
    error => error?.code === 'INVALID_RESPONSE'
  );

  assert.throws(
    () => validateFigurePanelInterpretation(
      response({ ...legacyComplete, unsupported_extra: 'reject me' }),
      input,
      { visualInput: false }
    ),
    error => error?.code === 'INVALID_RESPONSE'
  );
});

test('deep Figure schema includes controls evidence levels and alternatives', () => {
  const schema = createFigureAnalysisSchema('deep');
  assert.deepEqual(schema.properties.analysis_depth.enum, ['deep']);
  assert.ok(schema.required.includes('control_analysis'));
  assert.ok(schema.required.includes('evidence_relations'));
  assert.ok(schema.required.includes('alternative_explanations'));
  assert.ok(schema.required.includes('missing_link_if_panel_removed'));
  assert.ok(schema.required.includes('paper_argument_role_zh'));
});

test('compiles the requested four-step panel walkthrough for visual input', () => {
  const prompt = compileFigureAnalysisPrompt(figureInput, { visualInput: true });
  assert.equal(prompt.schemaName, 'figure_walkthrough_standard');
  assert.match(prompt.systemPrompt, /实验设计/);
  assert.match(prompt.systemPrompt, /结果观察/);
  assert.match(prompt.systemPrompt, /结论推导/);
  assert.match(prompt.systemPrompt, /串联逻辑/);
  assert.match(prompt.systemPrompt, /高\/低|上升\/下降/);
  assert.match(prompt.systemPrompt, /逐个子图|panel/i);
  assert.doesNotMatch(prompt.userPrompt, /data:image|https?:\/\//);
  const payload = JSON.parse(prompt.userPrompt);
  assert.equal(payload.figure_id, 'figure-2');
  assert.equal(payload.analysis_basis, 'vision_text');
  assert.equal(payload.analysis_depth, 'standard');
  assert.deepEqual(payload.expected_panel_labels, []);
});

test('text evidence permits explicit caption descriptions but forbids invented image facts', () => {
  const prompt = compileFigureAnalysisPrompt(figureInput, { visualInput: false });
  assert.match(prompt.systemPrompt, /没有看到图片像素/);
  assert.match(prompt.systemPrompt, /可以准确复述图注和正文明确描述的视觉或定量结果/);
  assert.match(prompt.systemPrompt, /不得把未提供的信息当作观察结果/);
  assert.match(prompt.systemPrompt, /caption_statement|body_statement/);
  assert.equal(JSON.parse(prompt.userPrompt).analysis_basis, 'caption_context');
});

test('prompt separates role, phenotype, and open method evidence without guessing', () => {
  const prompt = compileFigureAnalysisPrompt(figureInput, { visualInput: true });
  assert.match(prompt.systemPrompt, /role, phenotype_name_zh, and methods separate/i);
  assert.match(prompt.systemPrompt, /role is "phenotype"/i);
  assert.match(prompt.systemPrompt, /open list of method phrases/i);
  assert.match(prompt.systemPrompt, /do not force it into a closed vocabulary/i);
  assert.match(prompt.systemPrompt, /do not guess/i);
});

test('prompt binds each concrete fact to its real source and keeps statistics out of experimental methods', () => {
  assert.equal(FIGURE_ANALYSIS_PROMPT_VERSION, '14-bounded-evidence-titles');
  const visual = compileFigureAnalysisPrompt(figureInput, { visualInput: true }).systemPrompt;
  assert.match(visual, /each concrete fact/i);
  assert.match(visual, /visible only in pixels.*image_observation/i);
  assert.match(visual, /multi_source.*same fact.*both/i);
  assert.match(visual, /Do not complete an anatomical series/i);
  assert.match(visual, /domain knowledge/i);
  assert.match(visual, /experimental acquisition or measured readout/i);
  assert.match(visual, /inferential tests only in statistical_methods/i);
  assert.match(visual, /statistics alone.*method_category/i);
  assert.match(visual, /image-only facts.*image_observation/i);

  const text = compileFigureAnalysisPrompt(figureInput, { visualInput: false }).systemPrompt;
  assert.match(text, /every concrete fact.*caption or body/i);
  assert.match(text, /never use image_observation/i);
  assert.match(text, /do not infer image-only labels/i);
});

test('deep prompt asks why panels are grouped and what breaks when one is removed', () => {
  const prompt = compileFigureAnalysisPrompt(figureInput, {
    visualInput: true,
    analysisDepth: 'deep'
  });
  assert.equal(prompt.schemaName, 'figure_walkthrough_deep');
  assert.match(prompt.systemPrompt, /为什么.*前一组.*后一组/);
  assert.match(prompt.systemPrompt, /删除.*Panel.*缺失/);
  assert.equal(JSON.parse(prompt.userPrompt).analysis_depth, 'deep');
});

test('validates fields strips unsafe markup and forces safe text provenance', () => {
  const raw = validStandardFigureOutput();
  raw.panels[0].panel = 'a';
  raw.panels[0].design_zh = '<b>\u5b9e\u9a8c\u8bbe\u8ba1\uff1a\u6bd4\u8f83\u5904\u7406\u7ec4\u4e0e\u5bf9\u7167\u7ec4</b>';
  raw.panels[0].direct_observation_zh = '\u7ed3\u679c\u89c2\u5bdf\uff1a\u5904\u7406\u7ec4\u66f4\u4f4e';
  raw.panels[0].observation_source = 'image_observation';
  raw.core_conclusion_zh = '<script>alert(1)</script>核心结论：治疗抑制肿瘤';
  const normalized = validateFigureAnalysis(raw, figureInput, {
    visualInput: false,
    analysisDepth: 'standard'
  });

  assert.equal(normalized.figureId, 'figure-2');
  assert.equal(normalized.basis, 'caption_context');
  assert.deepEqual(normalized.panels.map(item => item.panel), ['A']);
  assert.equal(normalized.panels[0].design, '比较处理组与对照组');
  assert.equal(normalized.panels[0].directObservation, '处理组更低');
  assert.equal(normalized.panels[0].observationSource, 'inference');
  assert.doesNotMatch(JSON.stringify(normalized), /<[^>]+>/);
  assert.equal(normalized.coreConclusion, '治疗抑制肿瘤');
  assert.equal(normalized.analysisDepth, 'standard');
  assert.equal(normalized.panelGroups.length, 1);
  assert.equal(normalized.argumentChain.length, 1);
});

test('repairs missing fields and enum aliases but still rejects incompatible field shapes', () => {
  const missingField = validStandardFigureOutput();
  delete missingField.panels[0].method_source;
  const repairedMissing = validateFigureAnalysis(missingField, figureInput, {
    visualInput: true, analysisDepth: 'standard'
  });
  assert.equal(repairedMissing.panels[0].methodSource, 'inference');

  const unknownEnum = validStandardFigureOutput();
  unknownEnum.panels[0].method_category = 'computational';
  unknownEnum.panels[0].role = '表型验证';
  unknownEnum.argument_chain[0].evidence_level = '干预效应';
  unknownEnum.panels[0].unsupported_extra = 'drop me';
  const repairedEnum = validateFigureAnalysis(unknownEnum, figureInput, {
    visualInput: true, analysisDepth: 'standard'
  });
  assert.equal(repairedEnum.panels[0].methodCategory, 'bioinformatics');
  assert.equal(repairedEnum.panels[0].role, 'phenotype');
  assert.equal(repairedEnum.argumentChain[0].evidenceLevel, 'intervention_effect');

  const malformedShape = validStandardFigureOutput();
  malformedShape.panels[0].methods = 'CCK-8';
  assert.throws(
    () => validateFigureAnalysis(malformedShape, figureInput, {
      visualInput: true, analysisDepth: 'standard'
    }),
    error => error.code === 'INVALID_RESPONSE'
  );
});

test('canonicalizes hinted panel identities and rejects invented panels', () => {
  const raw = validStandardFigureOutput();
  raw.panels = [{ ...raw.panels[0], panel: 'a' }];
  const hintedInput = { ...figureInput, panelHints: ['a', 'B', 'A'] };
  const normalized = validateFigureAnalysis(raw, hintedInput, {
    visualInput: true, analysisDepth: 'standard'
  });
  assert.deepEqual(normalized.panels.map(panel => panel.panel), ['A']);
  assert.deepEqual(normalized.panelCoverage.expectedPanels, ['A', 'B']);
  assert.deepEqual(normalized.panelCoverage.returnedPanels, ['A']);
  assert.deepEqual(normalized.panelCoverage.missingPanels, ['B']);

  raw.panels[0].panel = 'C';
  assert.throws(
    () => validateFigureAnalysis(raw, hintedInput, {
      visualInput: true, analysisDepth: 'standard'
    }),
    error => error.code === 'INVALID_RESPONSE'
  );
});

test('compiles a bounded recovery prompt for only the requested missing Panels', () => {
  const input = {
    ...figureInput,
    panelHints: ['A', 'B', 'C', 'D', 'E'],
    completedPanels: [
      { panel: 'A', directObservation: 'sensitive completed scientific result' },
      { panel: 'B', directObservation: 'second private completed result' },
      { panel: 'C', directObservation: 'third private completed result' }
    ]
  };
  const prompt = compileFigurePanelRecoveryPrompt(input, [' d ', 'E'], {
    visualInput: true,
    analysisDepth: 'standard'
  });
  const payload = JSON.parse(prompt.userPrompt);

  assert.deepEqual(prompt.userPayload, payload);
  assert.deepEqual(payload.requested_panel_labels, ['D', 'E']);
  assert.deepEqual(payload.completed_panel_labels, ['A', 'B', 'C']);
  assert.deepEqual(Object.keys(payload.figure_context.panel_caption_slices), ['D', 'E']);
  assert.equal(payload.analysis_basis, 'vision_text');
  assert.equal(payload.input_mode, 'figure_image');
  assert.equal(payload.analysis_depth, 'standard');
  assert.equal(payload.pass, 'missing_panel_recovery');
  assert.match(prompt.systemPrompt, /only the requested missing Panels/i);
  assert.match(prompt.systemPrompt, /strict Chinese JSON/i);
  assert.doesNotMatch(prompt.userPrompt, /sensitive completed scientific result/i);
  assert.equal(prompt.responseSchema.properties.panels.minItems, 2);
  assert.equal(prompt.responseSchema.properties.panels.maxItems, 2);
});

test('recovery prompt retains caption-only provenance and excludes completed Panel output', () => {
  const prompt = compileFigurePanelRecoveryPrompt({
    ...figureInput,
    panelHints: ['A', 'B'],
    panels: [{ panel: 'A', purpose: 'do not repeat this completed interpretation' }]
  }, ['B'], { visualInput: false, analysisDepth: 'deep' });
  const payload = prompt.userPayload;

  assert.equal(payload.analysis_basis, 'caption_context');
  assert.equal(payload.figure_context.version, 'figure-context-v1');
  assert.deepEqual(payload.requested_panel_labels, ['B']);
  assert.deepEqual(payload.completed_panel_labels, ['A']);
  assert.match(prompt.systemPrompt, /No Figure pixels are supplied/i);
  assert.doesNotMatch(prompt.userPrompt, /do not repeat this completed interpretation/i);
});

test('recovery prompt returns caller-owned validation context and a bounded real-source allowlist', () => {
  const prompt = compileFigurePanelRecoveryPrompt({
    ...figureInput, panelHints: ['A', 'D']
  }, ['D'], { visualInput: false, analysisDepth: 'standard' });

  assert.deepEqual(prompt.validationContext, {
    figureId: 'figure-2',
    analysisDepth: 'standard',
    visualInput: false,
    inputMode: 'caption_context',
    requestedPanels: ['D'],
    figureContext: prompt.userPayload.figure_context,
    allowedEvidenceRefsByPanel: {
      D: prompt.userPayload.available_evidence_refs_by_panel.D
    }
  });
  assert.ok(prompt.validationContext.allowedEvidenceRefsByPanel.D.includes('caption:panel_D'));
  assert.ok(prompt.validationContext.allowedEvidenceRefsByPanel.D.includes('paragraph:p7'));
  assert.ok(prompt.validationContext.allowedEvidenceRefsByPanel.D.every(ref =>
    !ref.startsWith('image:')
  ));
  assert.ok(prompt.userPayload.available_evidence_refs_by_panel.D.length <= 18);
});

test('validates exactly the requested recovery subset with explicit unresolved evidence', () => {
  const prompt = compileFigurePanelRecoveryPrompt({
    ...figureInput, panelHints: ['D', 'E']
  }, ['D', 'E'], { visualInput: false, analysisDepth: 'standard' });
  const full = validStandardFigureOutput();
  const panelD = {
    ...full.panels[0],
    panel: 'D',
    method_source: 'caption',
    observation_source: 'caption_statement'
  };
  const normalized = validateFigurePanelRecoveryResult({
    figure_id: 'figure-2',
    analysis_depth: 'standard',
    basis: 'caption_context',
    panels: [panelD, {
      panel: 'E',
      status: 'unresolved',
      reason_code: 'insufficient_panel_evidence',
      input_mode: 'caption_context',
      evidence_refs: ['caption:panel_E', 'paragraph:p7']
    }]
  }, ['D', 'E'], prompt.validationContext);

  assert.deepEqual(normalized.panels.map(panel => panel.panel), ['D', 'E']);
  assert.equal(normalized.panels[1].status, 'not_identifiable');
  assert.equal(Object.hasOwn(normalized.panels[1], 'directObservation'), false);
  assert.deepEqual(normalized.resolvedPanels, ['D']);
  assert.deepEqual(normalized.unresolvedPanels, ['E']);
  assert.deepEqual(normalized.panelCoverage, {
    requestedPanels: ['D', 'E'],
    returnedPanels: ['D', 'E'],
    resolvedPanels: ['D'],
    unresolvedPanels: ['E'],
    missingPanels: []
  });
});

test('recovery subset validator rejects completed, unrequested, duplicate, and missing labels safely', () => {
  const panel = label => ({
    ...validStandardFigureOutput().panels[0], panel: label,
    purpose_zh: `private result ${label}`
  });
  const response = panels => ({
    figure_id: 'figure-2', analysis_depth: 'standard', basis: 'vision_text', panels
  });
  const contextFor = requested => compileFigurePanelRecoveryPrompt({
    ...figureInput, panelHints: ['A', 'D', 'E']
  }, requested, { visualInput: true, analysisDepth: 'standard' }).validationContext;

  assert.throws(
    () => validateFigurePanelRecoveryResult(
      response([panel('A'), panel('D')]), ['D'], contextFor(['D'])
    ),
    error => error.code === 'FIGURE_PANEL_RECOVERY_UNEXPECTED' &&
      assert.deepEqual(error.unexpectedPanels, ['A']) === undefined &&
      !error.message.includes('private result')
  );
  assert.throws(
    () => validateFigurePanelRecoveryResult(
      response([panel('D'), panel(' d ')]), ['D'], contextFor(['D'])
    ),
    error => error.code === 'FIGURE_PANEL_DUPLICATED' &&
      assert.deepEqual(error.duplicatePanels, ['D']) === undefined
  );
  assert.throws(
    () => validateFigurePanelRecoveryResult(
      response([panel('D')]), ['D', 'E'], contextFor(['D', 'E'])
    ),
    error => error.code === 'FIGURE_PANEL_COVERAGE_INCOMPLETE' &&
      assert.deepEqual(error.missingPanels, ['E']) === undefined &&
      assert.deepEqual(error.receivedPanels, ['D']) === undefined
  );
});

test('recovery subset validator rejects unresolved records that add claims or lack evidence', () => {
  const validationContext = compileFigurePanelRecoveryPrompt({
    ...figureInput, panelHints: ['D']
  }, ['D'], { visualInput: false, analysisDepth: 'standard' }).validationContext;
  const unresolved = {
    panel: 'D', status: 'not_identifiable',
    reason_code: 'insufficient_panel_evidence', input_mode: 'caption_context',
    evidence_refs: ['caption:panel_D']
  };
  const response = panel => ({
    figure_id: 'figure-2', analysis_depth: 'standard',
    basis: 'caption_context', panels: [panel]
  });

  assert.throws(
    () => validateFigurePanelRecoveryResult(response({
      ...unresolved, local_inference_zh: 'invented claim'
    }), ['D'], validationContext),
    error => error.code === 'INVALID_RESPONSE' && !error.message.includes('invented claim')
  );
  assert.throws(
    () => validateFigurePanelRecoveryResult(response({
      ...unresolved, evidence_refs: []
    }), ['D'], validationContext),
    error => error.code === 'INVALID_RESPONSE'
  );
  assert.throws(
    () => validateFigurePanelRecoveryResult(response({
      ...unresolved, input_mode: 'figure_image', evidence_refs: ['image:panel_D']
    }), ['D'], validationContext),
    error => error.code === 'INVALID_RESPONSE'
  );
});

test('strict recovery context binds Figure identity depth and caller-owned visual provenance', () => {
  const prompt = compileFigurePanelRecoveryPrompt({
    ...figureInput, panelHints: ['A', 'D']
  }, ['D'], { visualInput: false, analysisDepth: 'standard' });
  const panel = {
    ...validStandardFigureOutput().panels[0], panel: 'D',
    method_source: 'caption', observation_source: 'caption_statement'
  };
  const response = overrides => ({
    figure_id: 'figure-2', analysis_depth: 'standard', basis: 'caption_context',
    panels: [panel], ...overrides
  });

  assert.throws(
    () => validateFigurePanelRecoveryResult(response({ figure_id: 'figure-9' }), ['D'],
      prompt.validationContext),
    error => error.code === 'INVALID_RESPONSE' && !error.message.includes('figure-9')
  );
  assert.throws(
    () => validateFigurePanelRecoveryResult(response({ analysis_depth: 'deep' }), ['D'],
      prompt.validationContext),
    error => error.code === 'INVALID_RESPONSE'
  );
  assert.throws(
    () => validateFigurePanelRecoveryResult(response({ basis: 'vision_text' }), ['D'],
      prompt.validationContext),
    error => error.code === 'INVALID_RESPONSE'
  );
  assert.throws(
    () => validateFigurePanelRecoveryResult(response({ panels: [{
      ...panel, method_source: 'image', observation_source: 'image_observation'
    }] }), ['D'], prompt.validationContext),
    error => error.code === 'INVALID_RESPONSE'
  );
});

test('strict recovery context accepts only actual target Panel evidence references', () => {
  const prompt = compileFigurePanelRecoveryPrompt({
    ...figureInput, panelHints: ['A', 'D', 'E']
  }, ['D'], { visualInput: false, analysisDepth: 'standard' });
  const unresolved = evidenceRefs => ({
    figure_id: 'figure-2', analysis_depth: 'standard', basis: 'caption_context',
    panels: [{
      panel: 'D', status: 'not_identifiable',
      reason_code: 'insufficient_panel_evidence', input_mode: 'caption_context',
      evidence_refs: evidenceRefs
    }]
  });

  const accepted = validateFigurePanelRecoveryResult(
    unresolved(['caption:panel_D', 'paragraph:p7']), ['D'], prompt.validationContext
  );
  assert.deepEqual(accepted.panels[0].evidenceRefs, ['caption:panel_D', 'paragraph:p7']);

  for (const ref of [
    'caption:panel_E', 'paragraph:not-in-context', 'image:figure_figure-2'
  ]) {
    assert.throws(
      () => validateFigurePanelRecoveryResult(unresolved([ref]), ['D'],
        prompt.validationContext),
      error => error.code === 'INVALID_RESPONSE' && !error.message.includes(ref),
      ref
    );
  }
});

test('recovery validation fails closed without a complete own-data trusted context', () => {
  const response = {
    figure_id: 'figure-2', analysis_depth: 'standard', basis: 'caption_context',
    panels: [{
      panel: 'D', status: 'not_identifiable',
      reason_code: 'insufficient_panel_evidence', input_mode: 'caption_context',
      evidence_refs: ['caption:panel_D']
    }]
  };
  for (const context of [undefined, {}, {
    figureId: 'figure-2', analysisDepth: 'standard', visualInput: false
  }]) {
    assert.throws(
      () => validateFigurePanelRecoveryResult(response, ['D'], context),
      error => error.code === 'INVALID_RESPONSE'
    );
  }

  let executions = 0;
  const hostileContext = {};
  Object.defineProperty(hostileContext, 'figureId', {
    enumerable: true,
    get() { executions += 1; return 'figure-2'; }
  });
  assert.throws(
    () => validateFigurePanelRecoveryResult(response, ['D'], hostileContext),
    error => error.code === 'INVALID_RESPONSE'
  );

  const validContext = compileFigurePanelRecoveryPrompt({
    ...figureInput, panelHints: ['D']
  }, ['D'], { visualInput: false, analysisDepth: 'standard' }).validationContext;
  const hostileRefs = [];
  Object.defineProperty(hostileRefs, 0, {
    enumerable: true,
    get() { executions += 1; return 'caption:panel_D'; }
  });
  hostileRefs.length = 1;
  const resolvedPanel = {
    ...validStandardFigureOutput().panels[0], panel: 'D',
    method_source: 'caption', observation_source: 'caption_statement'
  };
  assert.throws(
    () => validateFigurePanelRecoveryResult({
      figure_id: 'figure-2', analysis_depth: 'standard', basis: 'caption_context',
      panels: [resolvedPanel]
    }, ['D'], {
      ...validContext, allowedEvidenceRefsByPanel: { D: hostileRefs }
    }),
    error => error.code === 'INVALID_RESPONSE'
  );
  assert.equal(executions, 0);
});

test('recovery evidence refs are bound to caption, full-Figure, or actual Panel-crop mode', () => {
  const unresolvedResponse = (basis, inputMode, ref) => ({
    figure_id: 'figure-2', analysis_depth: 'standard', basis,
    panels: [{
      panel: 'D', status: 'not_identifiable',
      reason_code: 'insufficient_panel_evidence', input_mode: inputMode,
      evidence_refs: [ref]
    }]
  });
  const fullFigure = compileFigurePanelRecoveryPrompt({
    ...figureInput, panelHints: ['D']
  }, ['D'], {
    visualInput: true, analysisDepth: 'standard', inputMode: 'figure_image'
  });
  assert.equal(fullFigure.validationContext.inputMode, 'figure_image');
  assert.deepEqual(
    fullFigure.validationContext.allowedEvidenceRefsByPanel.D.filter(ref =>
      ref.startsWith('image:')
    ),
    ['image:figure_figure-2']
  );
  assert.equal(validateFigurePanelRecoveryResult(
    unresolvedResponse('vision_text', 'figure_image', 'image:figure_figure-2'),
    ['D'], fullFigure.validationContext
  ).unresolvedPanels[0], 'D');
  assert.throws(
    () => validateFigurePanelRecoveryResult(
      unresolvedResponse('vision_text', 'figure_image', 'image:panel_D'),
      ['D'], fullFigure.validationContext
    ),
    error => error.code === 'INVALID_RESPONSE' && !error.message.includes('image:panel_D')
  );

  const panelCrop = compileFigurePanelRecoveryPrompt({
    ...figureInput, panelHints: ['D']
  }, ['D'], {
    visualInput: true, analysisDepth: 'standard', inputMode: 'panel_crop',
    panelImageLabels: ['D']
  });
  assert.equal(panelCrop.validationContext.inputMode, 'panel_crop');
  assert.deepEqual(
    panelCrop.validationContext.allowedEvidenceRefsByPanel.D.filter(ref =>
      ref.startsWith('image:')
    ),
    ['image:panel_D']
  );
  assert.equal(validateFigurePanelRecoveryResult(
    unresolvedResponse('vision_text', 'panel_crop', 'image:panel_D'),
    ['D'], panelCrop.validationContext
  ).unresolvedPanels[0], 'D');
  assert.throws(
    () => validateFigurePanelRecoveryResult(
      unresolvedResponse('vision_text', 'panel_crop', 'image:figure_figure-2'),
      ['D'], panelCrop.validationContext
    ),
    error => error.code === 'INVALID_RESPONSE' &&
      !error.message.includes('image:figure_figure-2')
  );

  const captionOnly = compileFigurePanelRecoveryPrompt({
    ...figureInput, panelHints: ['D']
  }, ['D'], { visualInput: false, analysisDepth: 'standard' });
  assert.equal(captionOnly.validationContext.inputMode, 'caption_context');
  assert.ok(captionOnly.validationContext.allowedEvidenceRefsByPanel.D.every(ref =>
    !ref.startsWith('image:')
  ));
  assert.throws(
    () => validateFigurePanelRecoveryResult(
      unresolvedResponse('caption_context', 'caption_context', 'image:figure_figure-2'),
      ['D'], captionOnly.validationContext
    ),
    error => error.code === 'INVALID_RESPONSE'
  );

  assert.throws(
    () => compileFigurePanelRecoveryPrompt({
      ...figureInput, panelHints: ['D']
    }, ['D'], {
      visualInput: true, analysisDepth: 'standard', inputMode: 'panel_crop',
      panelImageLabels: []
    }),
    error => error.code === 'INVALID_RESPONSE'
  );
});

test('recovery label validation never invokes accessors or object coercion', () => {
  let executions = 0;
  const requested = [];
  Object.defineProperty(requested, 0, {
    enumerable: true,
    get() { executions += 1; return 'D'; }
  });
  requested.length = 1;
  assert.throws(
    () => validateFigurePanelRecoveryResult({}, requested),
    error => error.code === 'FIGURE_PANEL_RECOVERY_REQUEST_INVALID'
  );

  const hostileLabel = {
    toString() { executions += 1; return 'D'; }
  };
  const response = {
    figure_id: 'figure-2', analysis_depth: 'standard', basis: 'caption_context',
    panels: [{ panel: hostileLabel }]
  };
  const validationContext = compileFigurePanelRecoveryPrompt({
    ...figureInput, panelHints: ['D']
  }, ['D'], { visualInput: false, analysisDepth: 'standard' }).validationContext;
  assert.throws(
    () => validateFigurePanelRecoveryResult(response, ['D'], validationContext),
    error => error.code === 'INVALID_RESPONSE'
  );

  const accessorPanel = {};
  Object.defineProperty(accessorPanel, 'panel', {
    enumerable: true,
    get() { executions += 1; return 'D'; }
  });
  assert.throws(
    () => validateFigurePanelRecoveryResult(
      { ...response, panels: [accessorPanel] }, ['D'], validationContext
    ),
    error => error.code === 'INVALID_RESPONSE'
  );

  const accessorPanels = [];
  Object.defineProperty(accessorPanels, 0, {
    enumerable: true,
    get() { executions += 1; return { panel: 'D' }; }
  });
  accessorPanels.length = 1;
  assert.throws(
    () => validateFigurePanelRecoveryResult(
      { ...response, panels: accessorPanels }, ['D'], validationContext
    ),
    error => error.code === 'INVALID_RESPONSE'
  );
  assert.equal(executions, 0);
});

test('throws a safe structured error when requested Figure Panels are missing', () => {
  const raw = validStandardFigureOutput();
  const panelFor = panel => ({
    ...raw.panels[0],
    panel,
    methods: [`Method ${panel}`],
    experimental_methods: [`Method ${panel}`],
    purpose_zh: `Purpose ${panel}`,
    direct_observation_zh: `Observation ${panel}`,
    contribution_zh: `Contribution ${panel}`
  });
  raw.panels = ['a', 'B', 'c'].map(panelFor);
  const privateSentinel = 'PRIVATE_ARTICLE_IMAGE_API_KEY_SENTINEL';

  assert.throws(
    () => validateFigureAnalysis(raw, {
      ...figureInput,
      articleText: privateSentinel,
      imageData: privateSentinel,
      panelHints: ['a', 'B', 'c', 'D', 'e', 'F']
    }, {
      visualInput: true,
      analysisDepth: 'standard',
      requireCompletePanels: true
    }),
    error => {
      assert.equal(error.code, 'FIGURE_PANEL_COVERAGE_INCOMPLETE');
      assert.deepEqual(error.missingPanels, ['D', 'E', 'F']);
      assert.deepEqual(error.receivedPanels, ['A', 'B', 'C']);
      assert.doesNotMatch(JSON.stringify(error), new RegExp(privateSentinel));
      for (const unsafeField of [
        'rawResponse', 'payload', 'input', 'articleText', 'imageData', 'credentials', 'apiKey', 'cause'
      ]) {
        assert.equal(Object.hasOwn(error, unsafeField), false, unsafeField);
      }
      return true;
    }
  );
});

test('throws a safe structured error for duplicate normalized Figure Panel labels', () => {
  const raw = validStandardFigureOutput();
  raw.panels = [
    { ...raw.panels[0], panel: 'a' },
    { ...raw.panels[0], panel: 'A' }
  ];

  assert.throws(
    () => validateFigureAnalysis(raw, {
      ...figureInput,
      panelHints: ['A', 'B']
    }, { visualInput: true, analysisDepth: 'standard' }),
    error => {
      assert.equal(error.code, 'FIGURE_PANEL_DUPLICATED');
      assert.deepEqual(error.duplicatePanels, ['A']);
      assert.equal(Object.hasOwn(error, 'rawResponse'), false);
      assert.equal(Object.hasOwn(error, 'input'), false);
      return true;
    }
  );
});

test('normalizes recognized method aliases and panel phenotype provenance', () => {
  const raw = validStandardFigureOutput();
  raw.panels[0] = {
    ...raw.panels[0],
    phenotype_name_zh: '<b>\u8868\u578b\u540d\u79f0\uff1a\u80bf\u7624\u4f53\u79ef</b>',
    method_category: 'wet_lab',
    methods: ['Western blot', 'WB', 'Immunofluorescence', 'Cell Counting Kit-8', 'unknown assay'],
    method_source: 'image'
  };
  const normalized = validateFigureAnalysis(raw, figureInput, {
    visualInput: false,
    analysisDepth: 'standard'
  });

  assert.equal(normalized.panels[0].phenotypeName, '\u80bf\u7624\u4f53\u79ef');
  assert.deepEqual(normalized.panels[0].methods, ['WB', 'IF', 'CCK-8', 'unknown assay']);
  assert.deepEqual(normalized.panels[0].methodDetails.at(-1), {
    methodText: 'unknown assay', methodFamily: 'wet_lab', normalizedMethod: 'unknown assay'
  });
  assert.equal(normalized.panels[0].methodCategory, 'wet_lab');
  assert.equal(normalized.panels[0].methodSource, 'inference');
});

test('keeps phenotype names empty outside phenotype panels and falls back safely when absent', () => {
  const raw = validStandardFigureOutput();
  raw.panels[0] = {
    ...raw.panels[0],
    phenotype_name_zh: '',
    method_category: 'bioinformatics',
    methods: ['Gene Set Enrichment Analysis', 'single-cell RNA sequencing'],
    method_source: 'body'
  };
  raw.panels.push({
    ...raw.panels[0], panel: 'B', role: 'mechanism', phenotype_name_zh: '\u80bf\u7624\u4f53\u79ef'
  });
  const normalized = validateFigureAnalysis(raw, figureInput, {
    visualInput: true,
    analysisDepth: 'standard'
  });

  assert.equal(normalized.panels[0].phenotypeName, '\u672a\u660e\u786e');
  assert.deepEqual(normalized.panels[0].methods, ['GSEA', 'scRNA-seq']);
  assert.equal(normalized.panels[0].methodSource, 'body');
  assert.equal(normalized.panels[1].phenotypeName, '');
});

test('normalizes remaining question and experimental methods without inventing statistical methods', () => {
  const raw = validStandardFigureOutput();
  raw.remaining_question_zh = '<b>剩余问题：</b>没有直接证据解释分子机制，所以需要后续 Figure。';
  raw.panels[0].evidence_type_zh = '干预/因果';
  raw.panels[0].experimental_methods = ['Western blot', 'qPCR'];
  raw.panels[0].statistical_methods = [];

  const normalized = validateFigureAnalysis(raw, figureInput, {
    visualInput: true, analysisDepth: 'standard'
  });

  assert.match(normalized.remainingQuestion, /后续 Figure/);
  assert.equal(normalized.panels[0].evidenceType, '干预/因果');
  assert.deepEqual(normalized.panels[0].experimentalMethods, ['Western blot', 'qPCR']);
  assert.deepEqual(normalized.panels[0].statisticalMethods, []);
});

test('declared statistical methods stay separate from acquisition methods through cache replay', () => {
  const raw = validStandardFigureOutput();
  const input = { ...figureInput, panelHints: ['A'] };
  raw.panels[0].method_category = 'imaging';
  raw.panels[0].methods = ['双光子活体成像', '单因素方差分析', '成像及统计分析'];
  raw.panels[0].experimental_methods = ['双光子活体成像', '单因素方差分析'];
  raw.panels[0].statistical_methods = ['单因素方差分析', 'Bonferroni多重比较检验'];
  const untouched = JSON.stringify(raw);
  const result = validateFigureAnalysis(raw, input, { visualInput: true });
  assert.deepEqual(result.panels[0].methods, ['双光子活体成像', '成像及统计分析']);
  assert.deepEqual(result.panels[0].experimentalMethods, ['双光子活体成像']);
  assert.deepEqual(result.panels[0].statisticalMethods,
    ['单因素方差分析', 'Bonferroni多重比较检验']);
  assert.equal(result.panels[0].methodCategory, 'imaging');
  assert.equal(result.panels[0].methodDetails.length, 2);
  assert.equal(JSON.stringify(raw), untouched);
  assert.deepEqual(validateCachedFigureAnalysis(result, input, { analysisDepth: 'standard' }), result);

  // An undeclared method is retained; the normalizer does not invent provenance.
  raw.panels[0].statistical_methods = [];
  assert.ok(validateFigureAnalysis(raw, input, { visualInput: true })
    .panels[0].methods.includes('单因素方差分析'));

  // Parenthetical qualifiers are substantive, even when alias normalization
  // would collapse them. Do not discard a different test or a combined method.
  for (const [method, statistic] of [
    ['ANOVA (two-way)', 'ANOVA (one-way)'],
    ['ANOVA (with imaging-derived measurements)', 'ANOVA'],
    ['quantification (with imaging-derived measurements)', '定量分析']
  ]) {
    raw.panels[0].methods = [method];
    raw.panels[0].experimental_methods = [method];
    raw.panels[0].statistical_methods = [statistic];
    const qualifiedResult = validateFigureAnalysis(raw, input, { visualInput: true });
    const preserved = qualifiedResult.panels[0];
    assert.equal(preserved.methodDetails[0].methodText, method);
    assert.deepEqual(preserved.experimentalMethods, [method]);
    assert.deepEqual(preserved.statisticalMethods, [statistic]);
    assert.deepEqual(validateCachedFigureAnalysis(qualifiedResult, input,
      { analysisDepth: 'standard' }), qualifiedResult);
  }

  raw.panels[0].methods = ['quantification'];
  raw.panels[0].experimental_methods = ['quantification'];
  raw.panels[0].statistical_methods = ['定量分析'];
  const localized = validateFigureAnalysis(raw, input, { visualInput: true });
  assert.deepEqual(localized.panels[0].methods, []);
  assert.deepEqual(localized.panels[0].experimentalMethods, ['quantification']);
  assert.deepEqual(validateCachedFigureAnalysis(localized, input, { analysisDepth: 'standard' }), localized);

  for (const [statistics, qualified, translatedStatistics] of [
    ['ANOVA (one-way)', 'ANOVA (two-way)', 'ANOVA (one-way)'],
    ['quantification', 'quantification (with imaging-derived measurements)', '定量分析']
  ]) {
    for (const methods of [[statistics, qualified], [qualified, statistics]]) {
      raw.panels[0].methods = methods;
      raw.panels[0].experimental_methods = [qualified];
      raw.panels[0].statistical_methods = [translatedStatistics];
      const ordered = validateFigureAnalysis(raw, input, { visualInput: true });
      assert.deepEqual(ordered.panels[0].methods, [qualified]);
      assert.deepEqual(ordered.panels[0].experimentalMethods, [qualified]);
      assert.deepEqual(validateCachedFigureAnalysis(ordered, input,
        { analysisDepth: 'standard' }), ordered);
    }
  }
});

test('legacy Figure cache migrates methods into experimental methods without statistics', () => {
  const input = { ...figureInput, panelHints: ['A'] };
  for (const depth of ['standard', 'deep']) {
    const normalized = validateFigureAnalysis(validStandardFigureOutput(depth), input, {
      visualInput: true, analysisDepth: depth
    });
    const { remainingQuestion, ...legacyWithoutRemainingQuestion } = normalized;
    const legacy = {
      ...legacyWithoutRemainingQuestion,
      figureVersion: '12-panel-specific-durable-results',
      panels: normalized.panels.map(({ evidenceType, experimentalMethods, statisticalMethods, ...panel }) => panel)
    };
    const migrated = validateCachedFigureAnalysis(legacy, input, { analysisDepth: depth });
    assert.equal(migrated.remainingQuestion, '');
    assert.equal(migrated.panels[0].evidenceType, '');
    assert.deepEqual(migrated.panels[0].experimentalMethods, ['CCK-8']);
    assert.deepEqual(migrated.panels[0].statisticalMethods, []);
  }
});

test('current-version malformed statistical methods remain rejected', () => {
  const input = { ...figureInput, panelHints: ['A'] };
  const normalized = validateFigureAnalysis(validStandardFigureOutput(), input, {
    visualInput: true, analysisDepth: 'standard'
  });
  normalized.figureVersion = FIGURE_ANALYSIS_VERSION;
  normalized.panels[0].statisticalMethods = 't-test';
  assert.throws(
    () => validateCachedFigureAnalysis(normalized, input, { analysisDepth: 'standard' }),
    error => error?.code === 'INVALID_RESPONSE'
  );
});

test('current Figure cache preserves validated unresolved Panel records separately', () => {
  const input = {
    ...figureInput,
    panelHints: ['A', 'B'],
    images: [{ dataUrl: 'data:image/jpeg;base64,AA==' }]
  };
  const normalized = validateFigureAnalysis(validStandardFigureOutput(), input, {
    visualInput: true, analysisDepth: 'standard'
  });
  const cached = {
    ...normalized,
    panels: [...normalized.panels, {
      panel: ' b ',
      status: 'not_identifiable',
      reasonCode: 'insufficient_panel_evidence',
      inputMode: 'figure_image',
      evidenceRefs: ['image:figure_figure-2', 'caption:panel_B']
    }],
    unresolvedPanels: ['B'],
    panelCoverage: {
      expectedPanels: ['A', 'B'], returnedPanels: ['A', 'B'],
      resolvedPanels: ['A'], unresolvedPanels: ['B'], missingPanels: []
    }
  };

  const restored = validateCachedFigureAnalysis(cached, input, {
    analysisDepth: 'standard'
  });

  assert.deepEqual(restored.panels.map(panel => panel.panel), ['A', 'B']);
  assert.deepEqual(restored.panels[1], {
    panel: 'B',
    status: 'not_identifiable',
    reasonCode: 'insufficient_panel_evidence',
    inputMode: 'figure_image',
    evidenceRefs: ['image:figure_figure-2', 'caption:panel_B']
  });
  assert.deepEqual(restored.unresolvedPanels, ['B']);
  assert.deepEqual(restored.panelCoverage, {
    expectedPanels: ['A', 'B'], returnedPanels: ['A', 'B'],
    resolvedPanels: ['A'], unresolvedPanels: ['B'], missingPanels: []
  });
});

test('cached unresolved Panel records fail closed on malformed fields and evidence refs', () => {
  const input = {
    ...figureInput,
    panelHints: ['A', 'B'],
    images: [{ dataUrl: 'data:image/jpeg;base64,AA==' }]
  };
  const normalized = validateFigureAnalysis(validStandardFigureOutput(), input, {
    visualInput: true, analysisDepth: 'standard'
  });
  const unresolved = {
    panel: 'B', status: 'not_identifiable',
    reasonCode: 'insufficient_panel_evidence', inputMode: 'figure_image',
    evidenceRefs: ['image:figure_figure-2']
  };
  const cachedWith = record => ({
    ...normalized, panels: [...normalized.panels, record]
  });
  for (const record of [
    { ...unresolved, secret: 'private-cache-secret' },
    { ...unresolved, reasonCode: 'invented_reason' },
    { ...unresolved, inputMode: 'caption_context' },
    { ...unresolved, evidenceRefs: ['https://private.example/article'] },
    { ...unresolved, evidenceRefs: ['image:panel_B'] },
    { ...unresolved, evidenceRefs: [] }
  ]) {
    assert.throws(
      () => validateCachedFigureAnalysis(cachedWith(record), input, {
        analysisDepth: 'standard'
      }),
      error => error?.code === 'INVALID_RESPONSE' &&
        !error.message.includes('private-cache-secret') &&
        !error.message.includes('private.example')
    );
  }
});

test('cached Figure rejects a missing member of the original expected Panel partition', () => {
  const input = { ...figureInput, panelHints: ['A', 'B'] };
  const cached = validateFigureAnalysis(validStandardFigureOutput(), input, {
    visualInput: true, analysisDepth: 'standard'
  });

  assert.throws(
    () => validateCachedFigureAnalysis(cached, input, {
      analysisDepth: 'standard'
    }),
    error => error?.code === 'INVALID_RESPONSE'
  );
});

test('cached Figure rejects a Panel outside the original expected partition', () => {
  const input = { ...figureInput, panelHints: ['A', 'B'] };
  const cached = validateFigureAnalysis(validStandardFigureOutput(), input, {
    visualInput: true, analysisDepth: 'standard'
  });
  cached.panels[0] = { ...cached.panels[0], panel: 'Z' };

  assert.throws(
    () => validateCachedFigureAnalysis(cached, input, {
      analysisDepth: 'standard'
    }),
    error => error?.code === 'INVALID_RESPONSE'
  );
});

test('cached Figure rejects conflicting Panel identity aliases', () => {
  const input = { ...figureInput, panelHints: ['A'] };
  const cached = validateFigureAnalysis(validStandardFigureOutput(), input, {
    visualInput: true, analysisDepth: 'standard'
  });
  cached.panels[0] = { ...cached.panels[0], panelId: 'B' };

  assert.throws(
    () => validateCachedFigureAnalysis(cached, input, {
      analysisDepth: 'standard'
    }),
    error => error?.code === 'INVALID_RESPONSE'
  );
});

test('builds one compact FigureContext with Panel slices and deduplicated body references', () => {
  const input = {
    figureId: 'figure-3', figureLabel: 'Figure 3',
    caption: 'Figure 3. Values are mean ± SEM. (A) Western blot in treated and control cells. (B) Validation cohort by single-cell RNA sequencing.',
    contextParagraphs: [
      { paragraphId: 'r1', sectionTitle: 'Results', text: 'Figure 3A compares treated and control cells (n = 6).' },
      { paragraphId: 'r2', sectionTitle: 'Results', text: 'Figure 3B validates the finding in an independent cohort.' }
    ]
  };
  const context = buildFigureContext(input, ['A', 'B']);
  assert.equal(context.version, 'figure-context-v1');
  assert.match(context.shared_legend, /mean ± SEM/);
  assert.match(context.panel_caption_slices.A, /Western blot/);
  assert.doesNotMatch(context.panel_caption_slices.A, /Validation cohort/);
  assert.ok(context.method_registry.some(item => /Western blot/i.test(item)));
  assert.ok(context.method_registry.some(item => /single-cell RNA sequencing/i.test(item)));
  assert.ok(Object.keys(context.body_registry).length <= 2);
  assert.ok(context.panel_body_refs.A.includes('r1'));

  const prompt = compileFigurePanelBatchPrompt(
    { ...input, panelHints: ['A'] }, { visualInput: false, analysisDepth: 'standard' }
  );
  const payload = JSON.parse(prompt.userPrompt);
  assert.equal(payload.caption, undefined);
  assert.match(payload.figure_context.panel_caption_slices.A, /Western blot/);
  assert.doesNotMatch(JSON.stringify(payload.figure_context.panel_caption_slices), /Validation cohort/);
});

test('normalizes known methods locally while retaining new method text and family', () => {
  assert.deepEqual(normalizeMethodEvidence([
    'Western blot', 'spatial transcriptomics', 'patch-clamp electrophysiology'
  ], 'other'), [
    { methodText: 'Western blot', methodFamily: 'wet_lab', normalizedMethod: 'WB' },
    { methodText: 'spatial transcriptomics', methodFamily: 'bioinformatics', normalizedMethod: 'spatial transcriptomics' },
    { methodText: 'patch-clamp electrophysiology', methodFamily: 'wet_lab', normalizedMethod: '膜片钳电生理记录' }
  ]);
});

test('localizes descriptive experiment and chart labels while preserving assay names', () => {
  assert.equal(localizeFigureMethodLabel('schematic'), '实验示意图');
  assert.equal(localizeFigureMethodLabel('representative images'), '代表性图像');
  assert.equal(localizeFigureMethodLabel('histological reconstruction'), '组织学重建');
  assert.equal(localizeFigureMethodLabel('electrophysiology'), '电生理记录');
  assert.equal(localizeFigureMethodLabel('WB'), 'WB');
  assert.equal(localizeFigureMethodLabel('RNAscope FISH'), 'RNAscope FISH');
  assert.equal(localizeFigureMethodLabel('open field test'), '旷场实验');
  assert.equal(localizeFigureMethodLabel('EPM'), '高架十字迷宫实验');
  assert.equal(localizeFigureMethodLabel('tail suspension test'), '悬尾实验');
  assert.equal(localizeFigureMethodLabel('sucrose preference test'), '蔗糖偏好实验');
  assert.equal(localizeFigureMethodLabel('HPLC'), '高效液相色谱');
});

test('rejects a group-level behavioral assay list copied across Panels', () => {
  const raw = validStandardFigureOutput();
  raw.panels = ['A', 'B', 'C'].map(panel => ({
    ...raw.panels[0],
    panel,
    methods: [
      'open field test', 'elevated plus maze',
      'tail suspension test', 'sucrose preference test'
    ],
    purpose_zh: '比较同一组动物的全部行为学读出',
    design_zh: '依次开展全部行为学实验',
    comparison_zh: '模型组与对照组',
    direct_observation_zh: '模型组在全部行为学指标上发生变化',
    local_inference_zh: '整组行为学结果支持模型成立',
    contribution_zh: '提供整组行为学证据'
  }));
  assert.throws(
    () => validateFigureAnalysis(raw, {
      ...figureInput,
      panelHints: ['A', 'B', 'C']
    }, {
      visualInput: true,
      analysisDepth: 'standard',
      requireCompletePanels: true
    }),
    error => error?.code === 'INVALID_RESPONSE' && /copied/.test(error.message)
  );
});

test('keeps a durable Figure result usable when later extraction discovers more Panels', () => {
  const result = {
    figureId: 'figure-1',
    analysisDepth: 'standard',
    figureQuestion: '该图解决什么问题？',
    coreConclusion: '该图支持一个可复核的结论。',
    panels: [{
      panel: 'A',
      role: 'model_setup',
      methods: ['实验示意图'],
      purpose: '建立模型'
    }]
  };
  assert.equal(isUsableFigureAnalysisResult(
    result,
    { figureId: 'figure-1', panelHints: ['A', 'B', 'C'] },
    { analysisDepth: 'standard' }
  ), true);
  assert.equal(isUsableFigureAnalysisResult(
    result,
    { figureId: 'figure-s1' },
    { analysisDepth: 'standard' }
  ), false);
});

test('Figure usability checks never coerce hostile model fields or invoke accessors', () => {
  let calls = 0;
  const hostile = { toString() { calls += 1; throw new Error('must not coerce'); } };
  const result = {
    figureId: 'figure-1', analysisDepth: 'standard',
    figureQuestion: hostile,
    coreConclusion: 'conclusion',
    panels: [{ panel: 'A', purpose: 'purpose' }]
  };
  Object.defineProperty(result.panels[0], 'methods', {
    enumerable: true,
    get() { calls += 1; throw new Error('must not invoke getter'); }
  });
  assert.equal(isUsableFigureAnalysisResult(result, {
    figureId: 'figure-1'
  }, { analysisDepth: 'standard' }), false);
  assert.equal(calls, 0);
});

test('rejects a structurally valid but incomplete Figure before completion', () => {
  const missingConclusion = validStandardFigureOutput('standard');
  missingConclusion.core_conclusion_zh = '';
  assert.throws(
    () => validateFigureAnalysis(missingConclusion, figureInput, {
      visualInput: true,
      analysisDepth: 'standard',
      requireCompletePanels: true
    }),
    error => error.code === 'INVALID_RESPONSE' && /core conclusion/i.test(error.message)
  );

  const emptyPanel = validStandardFigureOutput('standard');
  Object.assign(emptyPanel.panels[0], {
    methods: [], purpose_zh: '', design_zh: '', comparison_zh: '',
    direct_observation_zh: '', local_inference_zh: '', contribution_zh: ''
  });
  assert.throws(
    () => validateFigureAnalysis(emptyPanel, figureInput, {
      visualInput: true,
      analysisDepth: 'standard',
      requireCompletePanels: true
    }),
    error => error.code === 'INVALID_RESPONSE' && /empty Panel/i.test(error.message)
  );
});

test('normalizes every required deep field', () => {
  const normalized = validateFigureAnalysis(
    validStandardFigureOutput('deep'), figureInput,
    { visualInput: true, analysisDepth: 'deep' }
  );
  assert.equal(normalized.analysisDepth, 'deep');
  assert.equal(normalized.controlAnalysis.length, 1);
  assert.equal(normalized.evidenceRelations[0].relationLevel, 'intervention_effect');
  assert.equal(normalized.alternativeExplanations.length, 1);
  assert.equal(normalized.missingLinksIfPanelRemoved.length, 1);
  assert.match(normalized.paperArgumentRole, /核心证据/);
});

test('reports panel coverage against explicit caption hints without inventing panels', () => {
  const raw = validStandardFigureOutput();
  const normalized = validateFigureAnalysis(raw, {
    ...figureInput,
    panelHints: ['A', 'B', 'C']
  }, { visualInput: true, analysisDepth: 'standard' });

  assert.deepEqual(normalized.panelCoverage.expectedPanels, ['A', 'B', 'C']);
  assert.deepEqual(normalized.panelCoverage.returnedPanels, ['A']);
  assert.deepEqual(normalized.panelCoverage.missingPanels, ['B', 'C']);
});

test('normalizes shuffled LLM Panels into expected canonical order without rewriting semantic groups', () => {
  const raw = validStandardFigureOutput();
  const makePanel = (panel, suffix) => ({
    ...raw.panels[0],
    panel,
    methods: [`Method ${suffix}`],
    experimental_methods: [`Method ${suffix}`],
    purpose_zh: `Purpose ${suffix}`,
    direct_observation_zh: `Observation ${suffix}`,
    contribution_zh: `Contribution ${suffix}`
  });
  raw.panels = [makePanel('C', 'C'), makePanel('A', 'A'), makePanel('B', 'B')];
  raw.panel_groups = [{
    panels: ['C', 'A'],
    group_goal_zh: 'Semantic group order',
    group_conclusion_zh: 'Grouped conclusion'
  }];

  const normalized = validateFigureAnalysis(raw, {
    ...figureInput,
    panelHints: ['A', 'B', 'C']
  }, {
    visualInput: true,
    analysisDepth: 'standard',
    requireCompletePanels: true
  });

  assert.deepEqual(normalized.panels.map(panel => panel.panel), ['A', 'B', 'C']);
  assert.deepEqual(normalized.panelGroups[0].panels, ['C', 'A']);
});

test('rejects a response assigned to another Figure', () => {
  assert.throws(
    () => validateFigureAnalysis({
      ...validStandardFigureOutput(),
      figure_id: 'figure-3'
    }, figureInput, { visualInput: true, analysisDepth: 'standard' }),
    error => error.code === 'INVALID_RESPONSE'
  );
});

test('builds stable Figure cache keys and invalidates changed image content or model', () => {
  const base = {
    documentHash: 'doc-a',
    providerId: 'openai',
    model: 'gpt-5.1',
    figureId: 'figure-2',
    figureHash: 'image-a',
    inputMode: 'figure_image',
    figureVersion: FIGURE_ANALYSIS_VERSION
  };
  assert.equal(buildFigureCacheKey(base), buildFigureCacheKey({ ...base }));
  assert.notEqual(buildFigureCacheKey(base), buildFigureCacheKey({
    ...base, inputMode: 'caption_context'
  }));
  assert.notEqual(buildFigureCacheKey(base), buildFigureCacheKey({ ...base, figureHash: 'image-b' }));
  assert.notEqual(buildFigureCacheKey(base), buildFigureCacheKey({ ...base, model: 'gpt-5.2' }));
  assert.notEqual(buildFigureCacheKey(base), buildFigureCacheKey({ ...base, figureVersion: '3' }));
});

test('only aborts a Figure batch for settings, authentication, quota or cancellation errors', () => {
  for (const code of [
    'INVALID_SETTINGS',
    'LLM_NOT_READY',
    'AUTH_INVALID',
    'QUOTA_EXHAUSTED',
    'CANCELLED'
  ]) {
    assert.equal(isFatalFigureBatchError({ code }), true, code);
  }

  for (const code of [
    'INVALID_RESPONSE',
    'REQUEST_TIMEOUT',
    'NETWORK_ERROR',
    'PROVIDER_UNAVAILABLE',
    'FIGURE_IMAGE_FAILED'
  ]) {
    assert.equal(isFatalFigureBatchError({ code }), false, code);
  }
});
