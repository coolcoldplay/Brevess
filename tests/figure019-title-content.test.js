const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('../providers/provider-utils.js');
require('../core/figure-panel-planner.js');
const analysis = require('../core/figure-analysis.js');
const ws = require('../core/figure-workspace.js');

// Synthetic contract fixtures, not captured model output or scientific acceptance.
const input = { figureId: 'figure-1', figureLabel: 'Figure 1', panelHints: ['A'],
  articleTitle: 'Synthetic contract fixture', caption: '(A) Treatment and control comparison.',
  contextParagraphs: [] };
function rawFixture(depth = 'standard') {
  const schema = analysis.createFigureAnalysisSchema(depth);
  const raw = Object.fromEntries(Object.entries(schema.properties).map(([key, spec]) =>
    [key, spec.type === 'array' ? [] : '']));
  Object.assign(raw, {
    figure_id: input.figureId, analysis_depth: depth, basis: 'caption_context',
    figure_title_zh: '原图标题的直接译文', figure_question_zh: '处理是否改变该模型的读出？',
    remaining_question_zh: '尚需检验其他模型。',
    core_conclusion_zh: '该模型中处理与读出降低相关，尚不支持因果关系。',
    author_assembly_zh: '通过处理与对照的读出比较限定本图能够支持的推断。',
    claim_boundary_zh: '仅限当前模型和时间点，未检验充分性。',
    panels: [{ panel: 'A', role: 'phenotype', phenotype_name_zh: '目标读出',
      method_category: 'other', methods: [], evidence_type_zh: '表型测量',
      experimental_methods: [], statistical_methods: ['Mann–Whitney U 检验'],
      method_source: 'caption', purpose_zh: '比较处理与对照',
      design_zh: '当前模型两组各6个样本；第2天测量。', comparison_zh: '处理组与对照组',
      direct_observation_zh: '图注报告读出降低，P = 0.03。', observation_source: 'caption_statement',
      local_inference_zh: '支持读出差异，尚不支持因果关系。', contribution_zh: '限定该模型的读出变化。' }],
    panel_groups: [{ panels: ['A'], group_goal_zh: '检验处理与目标读出的关系',
      group_conclusion_zh: '处理与该模型读出降低相关', upstream_context_zh: '围绕当前问题比较两组读出。' }],
    argument_chain: [{ panels: ['A'], established_zh: 'A：第2天处理组低于对照组；两组各6个样本，Mann–Whitney U 检验，P = 0.03。仅支持关联，不证明因果。',
      handoff_zh: '其他模型尚待检验。', evidence_level: 'association' }]
  });
  return raw;
}

test('FIG019 all Figure-title generation entry points explicitly separate short headings from detailed evidence', () => {
  for (const depth of ['standard', 'deep']) for (const visualInput of [false, true]) {
    const options = { analysisDepth: depth, visualInput };
    for (const prompt of [analysis.compileFigureAnalysisPrompt(input, options),
      analysis.compileFigureSynthesisPrompt(input, [], options),
      analysis.compileUnlabeledFigureOverviewPrompt({ ...input, panelHints: [] }, options)]) {
      assert.match(prompt.systemPrompt, /core_conclusion_zh 用作整图标题/);
      assert.match(prompt.systemPrompt, /一句精要的中文/);
      assert.match(prompt.systemPrompt, /科学准确性优先于字数/);
      assert.match(prompt.systemPrompt, /不得机械截取/);
      assert.match(prompt.systemPrompt, /样本量、P 值、统计方法/);
    }
    for (const prompt of [analysis.compileFigureAnalysisPrompt(input, options),
      analysis.compileFigureSynthesisPrompt(input, [], options)]) {
      assert.match(prompt.systemPrompt, /group_conclusion_zh 用作证据块标题/);
      assert.match(prompt.systemPrompt, /argument_chain.*established_zh.*详细证据/);
      assert.match(prompt.systemPrompt, /混合结果|阴性/);
    }
  }
});

test('FIG019 new response schema limits both titles without changing field names or stored version', () => {
  for (const depth of ['standard', 'deep']) {
    const full = analysis.createFigureAnalysisSchema(depth);
    assert.deepEqual(full.properties.panel_groups.items.required,
      ['panels', 'group_goal_zh', 'group_conclusion_zh', 'upstream_context_zh']);
    assert.deepEqual(full.properties.core_conclusion_zh, { type: 'string', maxLength: 80 });
    assert.deepEqual(full.properties.panel_groups.items.properties.group_conclusion_zh,
      { type: 'string', maxLength: 80 });
    assert.deepEqual(analysis.createUnlabeledFigureOverviewSchema(depth).properties.core_conclusion_zh,
      { type: 'string', maxLength: 80 });
    assert.deepEqual(full.properties.argument_chain.items.properties.established_zh, { type: 'string' });
    const synthesis = analysis.createFigureSynthesisSchema(depth);
    assert.deepEqual(synthesis.properties, Object.fromEntries(Object.entries(full.properties).filter(([key]) => key !== 'panels')));
    assert.equal(Object.hasOwn(full.properties, 'title'), false);
    assert.equal(Object.hasOwn(full.properties.panel_groups.items.properties, 'title'), false);
    const raw = rawFixture(depth);
    const serialized = JSON.stringify(raw);
    const options = { analysisDepth: depth, visualInput: false, requireEvidenceGroups: true };
    const result = analysis.validateFigureAnalysis(raw, input, options);
    assert.equal(result.coreConclusion, raw.core_conclusion_zh.normalize('NFKC'));
    assert.equal(result.panelGroups[0].groupConclusion, raw.panel_groups[0].group_conclusion_zh);
    assert.equal(JSON.stringify(raw), serialized);
  }
  assert.equal(analysis.FIGURE_ANALYSIS_VERSION, '14-evidence-block-upstream');
});

test('FIG019 synthetic concise headings and complete detailed evidence survive synthesis, cache and workspace projection', () => {
  const raw = rawFixture();
  const result = analysis.validateFigureAnalysis(raw, input, { requireEvidenceGroups: true });
  const { panels: ignored, ...synthesisRaw } = raw;
  const synthesized = analysis.validateFigureSynthesis(synthesisRaw, input, result.panels);
  const restored = analysis.validateCachedFigureAnalysis(JSON.parse(JSON.stringify(synthesized)), input);
  const view = ws.createFigureWorkspaceView({ figure: input, modelResult: restored });
  assert.equal(view.overview.find(field => field.key === 'coreConclusion').value, raw.core_conclusion_zh.normalize('NFKC'));
  assert.equal(view.evidenceBlocks[0].groupConclusion, raw.panel_groups[0].group_conclusion_zh);
  assert.equal(view.evidenceBlocks[0].established, raw.argument_chain[0].established_zh.normalize('NFKC'));
  assert.equal(restored.panels[0].design, raw.panels[0].design_zh.normalize('NFKC'));
  assert.equal(restored.panels[0].directObservation, raw.panels[0].direct_observation_zh.normalize('NFKC'));
  assert.equal(restored.claimBoundary, raw.claim_boundary_zh.normalize('NFKC'));
});

test('FIG019 legacy long and reviewed/cleared headings remain intact after regeneration and JSON roundtrip', () => {
  const raw = rawFixture();
  raw.core_conclusion_zh = '保留旧整图详细描述。'.repeat(30) + '不支持充分性。';
  raw.panel_groups[0].group_conclusion_zh = '保留旧证据块详细描述。'.repeat(30) + '不支持因果关系。';
  const oldModel = analysis.validateFigureAnalysis(rawFixture(), input);
  oldModel.coreConclusion = raw.core_conclusion_zh;
  oldModel.panelGroups[0].groupConclusion = raw.panel_groups[0].group_conclusion_zh;
  const cached = analysis.validateCachedFigureAnalysis(JSON.parse(JSON.stringify(oldModel)), input);
  assert.equal(cached.coreConclusion, raw.core_conclusion_zh);
  assert.equal(cached.panelGroups[0].groupConclusion, raw.panel_groups[0].group_conclusion_zh);
  for (const value of ['人工保留完整限定条件，不支持必要性。'.repeat(10), '']) {
    let draft = ws.mergeModelIntoFigureWorkspaceDraft(ws.createFigureWorkspaceDraft([input]), input, oldModel);
    draft = ws.applyFigureWorkspaceMutation(draft, { type: 'set_figure_field', figureId: input.figureId,
      field: 'coreConclusion', value, expectedRevision: draft.revision });
    draft = ws.applyFigureWorkspaceMutation(draft, { type: 'update_evidence_block', figureId: input.figureId,
      blockId: 'evidence-group-1', field: 'groupConclusion', value, expectedRevision: draft.revision });
    const serialized = JSON.stringify(ws.publicFigureWorkspaceDraft(draft));
    const regenerated = ws.mergeModelIntoFigureWorkspaceDraft(ws.normalizeFigureWorkspaceDraft(JSON.parse(serialized)),
      input, analysis.validateFigureAnalysis(rawFixture(), input));
    const view = ws.createFigureWorkspaceView({ figure: input, draft: regenerated });
    assert.equal(view.overview.find(field => field.key === 'coreConclusion').value, value.normalize('NFKC'));
    assert.equal(view.evidenceBlocks[0].groupConclusion, value.normalize('NFKC'));
    assert.equal(view.evidenceBlocks[0].fieldStates.groupConclusion.humanReviewed, true);
    assert.equal(regenerated.schemaVersion, draft.schemaVersion);
  }
});

test('FIG019 prompt revision changes request cache binding without changing persisted analysis version', () => {
  const source = fs.readFileSync(path.join(__dirname, '../core/background-router.js'), 'utf8');
  const start = source.indexOf('function figureRouteRequestBehavior(');
  const end = source.indexOf('\n    async function strongFigureRouteDigest', start);
  assert.ok(start >= 0 && end > start);
  const bind = shared => Function('shared', 'isPlainObject', `return (${source.slice(start, end).trim()});`)(
    shared, value => Boolean(value && typeof value === 'object'));
  const old = { ...analysis, FIGURE_ANALYSIS_PROMPT_VERSION: '13-concise-evidence-titles' };
  const route = { providerId: 'deepseek', model: 'synthetic-model', config: {} };
  assert.notDeepEqual(bind(analysis)({}, route, 'figure_walkthrough'), bind(old)({}, route, 'figure_walkthrough'));
  assert.equal(bind(analysis)({}, route, 'figure_walkthrough').implementationVersion,
    bind(old)({}, route, 'figure_walkthrough').implementationVersion);
});

test('FIG019 generated title limits use Unicode codepoints and reject, never slice, either title', () => {
  for (const depth of ['standard', 'deep']) for (const field of ['core', 'group']) {
    const raw = rawFixture(depth);
    const set = title => field === 'core' ? raw.core_conclusion_zh = title
      : raw.panel_groups[0].group_conclusion_zh = title;
    set('🧬'.repeat(80));
    const allowed = analysis.validateFigureAnalysis(raw, input, { analysisDepth: depth });
    assert.equal(field === 'core' ? allowed.coreConclusion : allowed.panelGroups[0].groupConclusion,
      '🧬'.repeat(80));
    for (const title of ['🧬'.repeat(81), '中'.repeat(81), 'ﬃ'.repeat(27)]) {
      set(title);
      const before = JSON.stringify(raw);
      assert.throws(() => analysis.validateFigureAnalysis(raw, input, { analysisDepth: depth }),
        error => error.code === 'INVALID_RESPONSE' && /80 Unicode code points/.test(error.message));
      assert.equal(JSON.stringify(raw), before);
    }
  }
});

test('FIG019 synthesis and unlabeled new-output entry points reject overlong titles', () => {
  for (const depth of ['standard', 'deep']) {
    const raw = rawFixture(depth);
    const panelEvidence = analysis.validateFigureAnalysis(raw, input, { analysisDepth: depth }).panels;
    for (const field of ['core', 'group']) {
      const { panels: ignored, ...synthesisRaw } = rawFixture(depth);
      if (field === 'core') synthesisRaw.core_conclusion_zh = '长'.repeat(81);
      else synthesisRaw.panel_groups[0].group_conclusion_zh = '长'.repeat(81);
      assert.throws(() => analysis.validateFigureSynthesis(synthesisRaw, input, panelEvidence,
        { analysisDepth: depth }), { code: 'INVALID_RESPONSE' });
    }
    const schema = analysis.createUnlabeledFigureOverviewSchema(depth);
    const overview = Object.fromEntries(Object.entries(schema.properties).map(([key, spec]) =>
      [key, spec.type === 'array' ? [] : '']));
    Object.assign(overview, { figure_id: input.figureId, analysis_depth: depth, basis: 'caption_context',
      core_conclusion_zh: '示意方案', figure_question_zh: '检验对象',
      evidence_steps: [{ source_zh: '图注', established_zh: '保留详细说明。'.repeat(40),
        handoff_zh: '后续研究验证。', evidence_level: 'other' }] });
    const result = analysis.validateUnlabeledFigureOverview(overview, input, { analysisDepth: depth });
    assert.ok(result.argumentChain[0].established.includes('保留详细说明。'.repeat(40)));
    overview.core_conclusion_zh = '长'.repeat(81);
    assert.throws(() => analysis.validateUnlabeledFigureOverview(overview, input,
      { analysisDepth: depth }), { code: 'INVALID_RESPONSE' });
  }
});

test('FIG019 long detailed evidence and decisive negative or mixed title qualifiers survive', () => {
  const raw = rawFixture();
  raw.core_conclusion_zh = '该模型读出降低但功能未显著改变，不支持因果关系';
  raw.panel_groups[0].group_conclusion_zh = 'A读出降低；未检验充分性';
  raw.argument_chain[0].established_zh = 'A：保留具体比较、统计信息与限制。'.repeat(40);
  raw.panels[0].design_zh = '保留完整实验设计。'.repeat(40);
  const result = analysis.validateFigureAnalysis(raw, input);
  assert.equal(result.coreConclusion, raw.core_conclusion_zh.normalize('NFKC'));
  assert.equal(result.panelGroups[0].groupConclusion, raw.panel_groups[0].group_conclusion_zh.normalize('NFKC'));
  assert.equal(result.argumentChain[0].established, raw.argument_chain[0].established_zh.normalize('NFKC'));
  assert.equal(result.panels[0].design, raw.panels[0].design_zh.normalize('NFKC'));
});

test('FIG019 overlong titles use the production bounded repair helper and cannot be saved clipped', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../core/background-router.js'), 'utf8');
  const start = source.indexOf('async function requestValidated({');
  const end = source.indexOf('\n      const incompleteFigureResults', start);
  assert.ok(start >= 0 && end > start);
  for (const field of ['core', 'group']) for (const repairSucceeds of [true, false]) {
    const requests = [];
    const events = [];
    const overlong = rawFixture();
    if (field === 'core') overlong.core_conclusion_zh = '长'.repeat(81);
    else overlong.panel_groups[0].group_conclusion_zh = '长'.repeat(81);
    const unchanged = JSON.stringify(overlong);
    const requestFigureJson = async (_adapter, request) => {
      requests.push(request);
      return requests.length === 2 && repairSucceeds ? rawFixture() : overlong;
    };
    const run = Function('figure', 'checkpointDispatches', 'requestFigureJson', 'adapter',
      'progress', 'operation', `return (${source.slice(start, end).trim()});`)(
      input, new Map(), requestFigureJson, {}, event => events.push(event), null);
    const prompt = analysis.compileFigureAnalysisPrompt(input);
    const pending = run({ prompt, request: prompt, progressDetails: {},
      validate: raw => analysis.validateFigureAnalysis(raw, input) });
    if (repairSucceeds) {
      const result = await pending;
      assert.equal(result.coreConclusion, rawFixture().core_conclusion_zh.normalize('NFKC'));
      assert.equal(result.argumentChain[0].established,
        rawFixture().argument_chain[0].established_zh.normalize('NFKC'));
    } else await assert.rejects(pending, { code: 'INVALID_RESPONSE' });
    assert.equal(requests.length, 2);
    assert.equal(events.filter(event => event.phase === 'figure_schema_retry').length, 1);
    assert.match(requests[1].systemPrompt, /SCHEMA_REPAIR_PASS/);
    assert.equal(requests[1].responseSchema.properties.core_conclusion_zh.maxLength, 80);
    assert.equal(requests[1].responseSchema.properties.panel_groups.items.properties.group_conclusion_zh.maxLength, 80);
    assert.equal(JSON.stringify(overlong), unchanged);
  }
});
