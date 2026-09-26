const test = require('node:test');
const assert = require('node:assert/strict');
const categoryStore = require('../core/category-store.js');
const { READING_VIEWS, composeReadingView, createUnifiedCategoryCatalog } = require('../core/adaptive-catalog.js');
const { createDefaultSettings, mergeSettings } = require('../core/settings-store.js');
const { compileAnalysisStreamPrompt } = require('../core/prompt-compiler.js');
const { materializeHighlightStreamRecord, validateChunkResult } = require('../core/result-validator.js');

test('three default scenarios use the accepted catalog while legacy definitions survive', () => {
  assert.deepEqual(createDefaultSettings().analysisModes.map(mode => mode.id), ['quick_story','critical_review','review_synthesis']);
  assert.ok(READING_VIEWS.mechanism_chain.legacyOnly);
  assert.deepEqual(READING_VIEWS.quick_story.categoryIds, ['known_background','scientific_question','method','result','interpretation','limitation','significance_novelty','future']);
});

test('a user scenario is authoritative over legacy and type overlays', () => {
  const result = composeReadingView({ viewId: 'quick_story', viewDefinition: { id: 'quick_story', categoryIds: ['scientific_question'] },
    studyProfile: { primaryType: 'narrative_review' }, override: { add: ['method'], remove: ['scientific_question'] } });
  assert.deepEqual(result.categoryIds, ['scientific_question']);
  const deleted = composeReadingView({ viewId: 'quick_story', viewDefinition: { categoryIds: ['scientific_question'] }, deletedBuiltInCategoryIds: ['scientific_question'] });
  assert.deepEqual(deleted.categoryIds, []);
});

test('deleting presets and editing a builtin combination persists through merge', () => {
  const saved = { ...createDefaultSettings(), analysisModes: [{ id: 'quick_story', name: '我的主线', description: '', categoryIds: ['result'] }] };
  assert.deepEqual(mergeSettings(mergeSettings(saved)).analysisModes, saved.analysisModes);
});

test('only untouched legacy presets migrate and their previous values are retained', () => {
  const legacy = [{"id":"quick_story","name":"快速主线","description":"为什么做、如何验证、发现什么、说明什么","categoryIds":["known_background","knowledge_gap","objective","hypothesis","study_strategy","method","result","key_result","interpretation","conclusion","significance_novelty","limitation"]},{"id":"mechanism_chain","name":"机制证据链","description":"起始因素、机制中介、证据强度与下游结局","categoryIds":["driver_intervention","association_evidence","causal_effect","mechanism_mediator","necessity_evidence","sufficiency_evidence","rescue_evidence","temporal_dose_evidence","cross_system_validation","mechanism_gap","alternative_mechanism","evidence","interpretation"]},{"id":"critical_review","name":"批判性审读","description":"设计、统计、因果边界、替代解释与复现性","categoryIds":["design_control","sample_population","measurement_validity","effect_uncertainty","statistical_robustness","confounding_reverse_causality","causal_overreach","alternative_explanation","replication_external_validation","generalizability","statistical_vs_practical_significance","limitation","transparency_reproducibility"]},{"id":"review_synthesis","name":"综述证据综合","description":"范围、共识、矛盾、异质性、证据质量与作者综合判断","categoryIds":["review_scope_thesis","evidence_consensus","conflicting_evidence","heterogeneity_source","evidence_quality_certainty","integrative_framework","author_synthesis","knowledge_gap","evidence","conclusion","limitation","future"]}];
  const migrated = mergeSettings({analysisModes:legacy,readingViewId:'quick_story'});
  assert.deepEqual(migrated.analysisModes.map(mode=>mode.id),['quick_story','critical_review','review_synthesis']);
  assert.deepEqual(migrated.previousScenarioPresets,legacy);
  assert.equal(migrated.scenarioPresetVersion,1);
  const edited = structuredClone(legacy); edited[0].name='用户保留的主线';
  assert.deepEqual(mergeSettings({analysisModes:edited}).analysisModes,edited);
  assert.deepEqual(mergeSettings({analysisModes:legacy.slice(1)}).analysisModes,legacy.slice(1));
});

test('long duplicate scenario identifiers receive bounded distinct suffixes', () => {
  const id='a'.repeat(80);
  const settings=mergeSettings({analysisModes:[{id,name:'A',categoryIds:['result']},{id,name:'B',categoryIds:['method']}]});
  assert.equal(new Set(settings.analysisModes.map(mode=>mode.id)).size,2);
  assert.ok(settings.analysisModes.every(mode=>mode.id.length<=80));
});

test('custom create/duplicate round trips full prompt, regex, engines and semantics', () => {
  const original = categoryStore.toUnifiedCategory({ ...createUnifiedCategoryCatalog().necessity_evidence,
    categoryId: 'custom_necessity', builtIn: false, enabledEngines: ['llm'], regex: { phrases: ['loss of function'], expressions: [], excludePhrases: ['associated with'], wholeWord: true, caseSensitive: true } });
  const copy = categoryStore.normalizeCustomCategory(original);
  assert.deepEqual(copy.prompt, original.prompt);
  assert.deepEqual(copy.regex, original.regex);
  assert.deepEqual(copy.enabledEngines, ['llm']);
  assert.equal(copy.relationRequired, true);
  assert.deepEqual(categoryStore.validateUnifiedCategory(copy), []);
});

test('stream prompt retains long custom rules and every example without a hidden truncation', () => {
  const rule = 'Important custom criterion. '.repeat(45);
  const category = categoryStore.normalizeCustomCategory({ name: 'custom', categoryId: 'custom_rule', definition: rule,
    includeWhen: Array.from({ length: 10 }, (_, i) => `${i}: ${rule}`), positiveExamples: ['A'], negativeExamples: ['B'] });
  const compiled = compileAnalysisStreamPrompt({ categories: [category], chunkId: 'c', paragraphs: [{ paragraphId:'p',text:'Plain text.' }] });
  const spec = JSON.parse(compiled.userPrompt).task_spec[0];
  assert.equal(spec.def, rule.trim());
  assert.equal(spec.in.length, 10);
  assert.ok(spec.in[9].length > 500);
  assert.deepEqual(spec.pos, ['A']); assert.deepEqual(spec.neg, ['B']);
});

test('continuations preserve completed paragraphs for support without requesting them twice', () => {
  const compiled = compileAnalysisStreamPrompt({ categories: [createUnifiedCategoryCatalog().result], chunkId:'c',
    paragraphs:[{paragraphId:'p0',text:'The control was untreated.'},{paragraphId:'p1',text:'Survival increased.'}],completedIndices:[0] });
  const input = JSON.parse(compiled.userPrompt);
  assert.deepEqual(compiled.pendingIndices, [1]);
  assert.equal(input.context_data[0].x, 'The control was untreated.');
  assert.deepEqual(input.source_data.map(p => p.i), [1]);
});

test('custom/ordinary-category stream slots cannot introduce unquoted concepts', () => {
  const category = createUnifiedCategoryCatalog().scientific_question;
  const paragraphs = [{ paragraphId:'p',text:'We asked whether activity changes survival.' }];
  const record = { paragraphIndex:0,annotations:[{ categoryId:category.categoryId,provenance:'current',
    displayQuotes:[{paragraphIndex:0,quote:paragraphs[0].text,role:'question_statement'}],supportQuotes:[],slots:[] }] };
  const response = materializeHighlightStreamRecord({record,paragraphs,categories:[category]});
  response.annotations[0].slots = [{name:'research_question',value:'an invented entity'}];
  const checked = validateChunkResult({paragraphs,requestedCategories:[category],requestedCategoryIds:[category.categoryId],response});
  assert.equal(checked.annotations.length, 0);
  assert.equal(checked.rejected[0].reason, 'SLOT_VALUE_NOT_GROUNDED');
});

test('explicitly redefined builtin semantics replace old ID-specific gates while exact evidence remains mandatory', () => {
  const catalog=createUnifiedCategoryCatalog();
  for (const id of ['necessity_evidence','significance_novelty']) {
    const category={...catalog[id],definition:'An explicitly stated testable hypothesis.',
      requiredSlots:[],allowedQuoteRoles:['statement'],claimMode:'explicit',relationRequired:false};
    const paragraphs=[{paragraphId:'p',text:'We hypothesized that treatment would increase survival.'}];
    const prompt=compileAnalysisStreamPrompt({categories:[category],paragraphs,chunkId:'custom'});
    assert.match(prompt.systemPrompt,/USER_REDEFINED_CATEGORIES/);
    if (id==='necessity_evidence') assert.doesNotMatch(prompt.systemPrompt,/Necessity evidence needs a loss/);
    if (id==='significance_novelty') assert.deepEqual(JSON.parse(prompt.userPrompt).gates,[]);
    const response=materializeHighlightStreamRecord({paragraphs,categories:[category],record:{paragraphIndex:0,
      annotations:[{categoryId:id,provenance:'current',displayQuotes:[{paragraphIndex:0,quote:paragraphs[0].text,role:'statement'}],supportQuotes:[],slots:[]}]}});
    const checked=validateChunkResult({paragraphs,requestedCategories:[category],response});
    assert.equal(checked.annotations.length,1,JSON.stringify(checked.rejected));
    response.annotations[0].slots=[{name:'test',value:'fabricated'}];
    assert.equal(validateChunkResult({paragraphs,requestedCategories:[category],response}).rejected[0].reason,'SLOT_VALUE_NOT_GROUNDED');
    assert.equal(categoryStore.usesBuiltInCategorySemantics({...catalog[id],name:'Renamed',color:'#abcdef'},catalog[id]),true);
  }
});
