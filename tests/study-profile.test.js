const test = require('node:test');
const assert = require('node:assert/strict');

require('../core/category-store.js');
require('../core/adaptive-catalog.js');
const {
  selectStudyProfileInput,
  compileStudyProfilePrompt,
  createStudyProfileSchema,
  normalizeStudyProfile,
  createFallbackStudyProfile,
  applyStudyProfileOverride,
  createManualStudyProfile,
  deriveManualPaperBlueprint,
  classifyStudyDocument
} = require('../core/study-profile.js');
const {
  fixtureParagraphs,
  fixtureDocument,
  validBlueprint
} = require('./helpers/adaptive-fixtures.js');

test('uses title, full abstract, headings and bounded representative body text', () => {
  const input = selectStudyProfileInput({ title: 'Study', paragraphs: fixtureParagraphs }, 12000);
  assert.equal(input.title, 'Study');
  assert.match(input.abstract, /complete abstract sentence/);
  assert.ok(input.representative_paragraphs.length > 0);
  assert.ok(JSON.stringify(input).length <= 12000);
  assert.equal(JSON.stringify(input).includes('https://'), false);
});

test('trims representative paragraphs before the abstract under a tight budget', () => {
  const input = selectStudyProfileInput({
    title: 'Study',
    paragraphs: fixtureParagraphs.map(item => ({ ...item, text: `${item.text} ${'x'.repeat(700)}` }))
  }, 1800);
  assert.ok(JSON.stringify(input).length <= 1800);
  assert.match(input.abstract, /complete abstract sentence/);
});

test('compiles a strict study profile request without article URL', () => {
  const input = selectStudyProfileInput(fixtureDocument);
  const prompt = compileStudyProfilePrompt(input);
  assert.equal(prompt.schemaName, 'study_profile');
  assert.ok(prompt.responseSchema.required.includes('blueprint'));
  assert.match(prompt.systemPrompt, /Keywords alone do not establish study design/);
  assert.equal(prompt.userPrompt.includes('https://'), false);
});

test('normalizes one primary and at most one different secondary type', () => {
  const mixed = normalizeStudyProfile({
    primary_type: 'basic_mechanistic',
    secondary_type: 'observational',
    review_subtype: 'not_review',
    confidence: 0.91,
    reason_zh: '动物干预并包含患者组织验证',
    blueprint: validBlueprint
  });
  assert.equal(mixed.secondaryType, 'observational');
  const same = normalizeStudyProfile({
    primary_type: 'observational',
    secondary_type: 'observational',
    review_subtype: 'not_review',
    confidence: 0.8,
    reason_zh: 'same',
    blueprint: validBlueprint
  });
  assert.equal(same.secondaryType, null);
});

test('normalizes review subtype only for review papers', () => {
  const review = normalizeStudyProfile({
    primary_type: 'systematic_review_meta', secondary_type: null,
    review_subtype: 'scoping', confidence: 0.9, reason_zh: '范围综述',
    blueprint: validBlueprint
  });
  assert.equal(review.reviewSubtype, 'scoping');
  const research = normalizeStudyProfile({
    primary_type: 'basic_mechanistic', secondary_type: null,
    review_subtype: 'meta', confidence: 0.9, reason_zh: '机制研究',
    blueprint: validBlueprint
  });
  assert.equal(research.reviewSubtype, 'not_review');
});

test('study profile schema requires a bounded review subtype', () => {
  const schema = createStudyProfileSchema();
  assert.ok(schema.required.includes('review_subtype'));
  assert.deepEqual(schema.properties.review_subtype.enum, [
    'not_review', 'narrative', 'systematic', 'scoping', 'meta', 'umbrella'
  ]);
});

test('marks profiles below 0.65 as requiring confirmation', () => {
  const profile = normalizeStudyProfile({
    primary_type: 'omics_high_throughput',
    secondary_type: null,
    review_subtype: 'not_review',
    confidence: 0.61,
    reason_zh: '证据不足',
    blueprint: validBlueprint
  });
  assert.equal(profile.requiresConfirmation, true);
  assert.equal(profile.useTypeSpecificWarnings, false);
});

test('creates a generic confirmation-required profile after invalid classifier output', () => {
  const profile = createFallbackStudyProfile();
  assert.equal(profile.confidence, 0);
  assert.equal(profile.requiresConfirmation, true);
  assert.equal(profile.useTypeSpecificWarnings, false);
  assert.equal(profile.classifierFallback, true);
  assert.deepEqual(profile.paperBlueprint.primary_outcomes, []);
});

test('applies a manual override without changing the paper blueprint', () => {
  const original = normalizeStudyProfile({
    primary_type: 'observational',
    secondary_type: null,
    review_subtype: 'not_review',
    confidence: 0.59,
    reason_zh: '不确定',
    blueprint: validBlueprint
  });
  const corrected = applyStudyProfileOverride(original, {
    primaryType: 'preclinical_translational',
    secondaryType: 'basic_mechanistic'
  });
  assert.equal(corrected.primaryType, 'preclinical_translational');
  assert.equal(corrected.secondaryType, 'basic_mechanistic');
  assert.equal(corrected.manuallyOverridden, true);
  assert.equal(corrected.requiresConfirmation, false);
  assert.deepEqual(corrected.paperBlueprint, original.paperBlueprint);
});

test('creates an exactly-one-type manual study profile for a research article', () => {
  const profile = createManualStudyProfile('observational');

  assert.equal(profile.primaryType, 'observational');
  assert.equal(profile.secondaryType, null);
  assert.equal(profile.reviewSubtype, 'not_review');
  assert.equal(profile.confidence, 1);
  assert.equal(profile.reasonZh, '用户选择');
  assert.deepEqual(profile.paperBlueprint, {
    research_question: '',
    primary_hypothesis: '',
    population_or_model: [],
    interventions_or_exposures: [],
    comparators: [],
    primary_outcomes: [],
    claimed_contribution: ''
  });
  assert.equal(profile.requiresConfirmation, false);
  assert.equal(profile.useTypeSpecificWarnings, true);
  assert.equal(profile.manuallyOverridden, true);
  assert.equal(profile.classifierFallback, false);
});

test('creates a conservative paper blueprint from supplied article text without classifying study type', () => {
  const blueprint = deriveManualPaperBlueprint(fixtureDocument);
  const profile = createManualStudyProfile('basic_mechanistic', fixtureDocument);
  assert.equal(blueprint.research_question, fixtureDocument.title);
  assert.match(blueprint.claimed_contribution, /complete abstract sentence/);
  assert.equal(profile.primaryType, 'basic_mechanistic');
  assert.equal(profile.secondaryType, null);
  assert.deepEqual(profile.paperBlueprint, blueprint);
  assert.equal(profile.manuallyOverridden, true);
});

test('uses narrative review subtype for a manually selected review and rejects invalid types', () => {
  assert.equal(
    createManualStudyProfile('systematic_review_meta').reviewSubtype,
    'narrative'
  );
  assert.equal(
    createManualStudyProfile('narrative_review').reviewSubtype,
    'narrative'
  );
  assert.equal(createManualStudyProfile('not-a-study-type'), null);
  assert.equal(createManualStudyProfile(['observational', 'clinical_trial']), null);
});

test('classifies through the generic provider JSON interface', async () => {
  let captured;
  const result = await classifyStudyDocument({
    document: fixtureDocument,
    adapter: {
      async generateJson(request) {
        captured = request;
        return {
          primary_type: 'basic_mechanistic',
          secondary_type: null,
          review_subtype: 'not_review',
          confidence: 0.94,
          reason_zh: '干预实验检验机制',
          blueprint: validBlueprint
        };
      }
    }
  });
  assert.equal(captured.schemaName, 'study_profile');
  assert.equal(result.primaryType, 'basic_mechanistic');
  assert.equal(result.paperBlueprint.primary_outcomes[0], 'C1q deposition');
});
