const test = require('node:test');
const assert = require('node:assert/strict');

require('../providers/provider-utils.js');
const {
  FIGURE_ANALYSIS_VERSION,
  createFigureAnalysisSchema,
  createFigurePanelBatchSchema,
  createFigureSynthesisSchema,
  createFigurePanelInterpretationSchema,
  createPanelFollowupSchema,
  compileFigureAnalysisPrompt,
  compileFigurePanelBatchPrompt,
  compileFigureSynthesisPrompt,
  compileFigurePanelInterpretationPrompt,
  compilePanelFollowupPrompt,
  isFatalFigureBatchError,
  validateFigureAnalysis,
  validateFigurePanelBatch,
  validateFigureSynthesis,
  validateFigurePanelInterpretation,
  validatePanelFollowup,
  normalizePanelFollowupPrompts
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
    figure_question_zh: '治疗是否抑制肿瘤生长？',
    panels: [{
      panel: 'A',
      role: 'phenotype',
      phenotype_name_zh: '\u80bf\u7624\u4f53\u79ef',
      method_category: 'wet_lab',
      methods: ['CCK-8'],
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

test('defines a versioned strict Figure walkthrough response schema', () => {
  assert.equal(FIGURE_ANALYSIS_VERSION, '6');
  const schema = createFigureAnalysisSchema('standard');
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.properties.basis.enum, ['vision_text', 'caption_context']);
  assert.ok(schema.required.includes('figure_id'));
  assert.ok(schema.required.includes('panels'));
  assert.ok(schema.required.includes('figure_question_zh'));
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
    'image', 'caption', 'body', 'inference'
  ]);
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
  const answer = validatePanelFollowup({
    figure_id: 'figure-2', panel: 'A', topics: ['grouping', 'axes_reading'],
    basis: 'vision_text', answer_zh: '分组按处理与对照比较；坐标仅按图中可见标签读取。',
    claim_boundary_zh: '未显示的信息不能推断。'
  }, input, { visualInput: true });
  assert.equal(answer.panel, 'A');
  assert.equal(answer.basis, 'vision_text');
  assert.equal(answer.customQuestion, '为什么作者使用这一统计方法?');
  assert.match(prompt.userPrompt, /existing_panel_interpretation/);
  const payload = JSON.parse(prompt.userPrompt);
  assert.equal(payload.custom_question, '为什么作者使用这一统计方法?');
  assert.equal(payload.requested_topic_instructions.grouping, '只解释本文实际采用的分组。');
  assert.equal(Object.keys(normalizePanelFollowupPrompts({})).length, 4);
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

test('prompt separates role, concrete phenotype, and recognized methods without guessing', () => {
  const prompt = compileFigureAnalysisPrompt(figureInput, { visualInput: true });
  assert.match(prompt.systemPrompt, /role, phenotype_name_zh, and methods separate/i);
  assert.match(prompt.systemPrompt, /role is "phenotype"/i);
  assert.match(prompt.systemPrompt, /WB, IF, IHC, H&E, CCK-8, Flow cytometry, RNA-seq, scRNA-seq, KEGG, GSEA/);
  assert.match(prompt.systemPrompt, /Do not guess a method/i);
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

test('validates fields strips duplicated labels and forces safe text provenance', () => {
  const raw = validStandardFigureOutput();
  raw.panels.unshift({
    ...raw.panels[0], panel: 'A<script>', design_zh: '<b>错误标签</b>'
  });
  raw.panels[1].design_zh = '实验设计：比较处理组与对照组';
  raw.panels[1].direct_observation_zh = '结果观察：处理组更低';
  raw.panels[1].observation_source = 'image_observation';
  raw.panels[0].panel = 'a';
  raw.panels[0].design_zh = '<b>\u5b9e\u9a8c\u8bbe\u8ba1\uff1a\u6bd4\u8f83\u5904\u7406\u7ec4\u4e0e\u5bf9\u7167\u7ec4</b>';
  raw.panels[0].direct_observation_zh = '\u7ed3\u679c\u89c2\u5bdf\uff1a\u5904\u7406\u7ec4\u66f4\u4f4e';
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

test('rejects malformed Figure panel fields and unsupported enum values before normalization', () => {
  const missingField = validStandardFigureOutput();
  delete missingField.panels[0].method_source;
  assert.throws(
    () => validateFigureAnalysis(missingField, figureInput, {
      visualInput: true, analysisDepth: 'standard'
    }),
    error => error.code === 'INVALID_RESPONSE'
  );

  const unknownEnum = validStandardFigureOutput();
  unknownEnum.panels[0].method_category = 'unknown_category';
  assert.throws(
    () => validateFigureAnalysis(unknownEnum, figureInput, {
      visualInput: true, analysisDepth: 'standard'
    }),
    error => error.code === 'INVALID_RESPONSE'
  );

  const malformedShape = validStandardFigureOutput();
  malformedShape.panels[0].methods = 'CCK-8';
  assert.throws(
    () => validateFigureAnalysis(malformedShape, figureInput, {
      visualInput: true, analysisDepth: 'standard'
    }),
    error => error.code === 'INVALID_RESPONSE'
  );
});

test('canonicalizes hinted panel identities, de-duplicates case variants, and rejects invented panels', () => {
  const raw = validStandardFigureOutput();
  raw.panels = [
    { ...raw.panels[0], panel: 'a' },
    { ...raw.panels[0], panel: 'A' }
  ];
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
  assert.deepEqual(normalized.panels[0].methods, ['WB', 'IF', 'CCK-8']);
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
    figureVersion: FIGURE_ANALYSIS_VERSION
  };
  assert.equal(buildFigureCacheKey(base), buildFigureCacheKey({ ...base }));
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
