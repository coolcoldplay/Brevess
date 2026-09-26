const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'options.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'options.css'), 'utf8');
const script = fs.readFileSync(path.join(root, 'options.js'), 'utf8');

function functionSource(name) {
  const start = script.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing ${name}`);
  const next = script.indexOf('\nfunction ', start + 1);
  return script.slice(start, next === -1 ? script.length : next);
}

test('reading scenarios expose unrestricted CRUD, duplication, and explicit built-in restore', () => {
  for (const id of [
    'addAnalysisMode', 'duplicateAnalysisMode', 'deleteAnalysisMode',
    'restoreAnalysisMode', 'saveAnalysisModes', 'analysisModeCategoryList',
    'deletedBuiltInAnalysisModeList'
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(script, /function duplicateAnalysisMode\(/);
  assert.match(script, /function restoreAnalysisModeById\(/);
  assert.match(script, /analysisModeDefaults\(\)\.filter\(mode => !activeIds\.has\(mode\.id\)\)/);
  assert.match(script, /categoryIds:\s*\[\.\.\.new Set\(source\.categoryIds \|\| \[\]\)\]/);
  assert.doesNotMatch(script, /densityTier|density_tier|scenarioDensity/);
});

test('scenario persistence sends settings only and does not reset canonical combinations', () => {
  const save = functionSource('saveAnalysisModes');
  assert.match(save, /type:\s*'LLM_UPDATE_PREFERENCES'/);
  assert.match(save, /analysisModes:\s*modes/);
  assert.match(save, /readingViewId/);
  assert.doesNotMatch(save, /viewCategoryOverrides/);
  assert.doesNotMatch(save, /ANALYZ|CALL_PROVIDER|TEST_PROVIDER|TEST_PROFILE/);
});

test('category editor exposes the full semantic schema and duplicates a full local definition', () => {
  for (const id of [
    'categoryDecisionQuestion', 'categoryIncludeWhen', 'categoryExcludeWhen',
    'categoryPositiveExamples', 'categoryNegativeExamples', 'categoryRequiredSlots',
    'categoryAllowedQuoteRoles', 'categoryClaimMode', 'categoryRelationRequired',
    'categoryRegexPhrases', 'categoryRegexExcludePhrases',
    'categoryRegexExpressions', 'duplicateSelectedCategory'
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /反例（建议填写容易混淆的难反例/);
  assert.doesNotMatch(html, /id="categoryHardNegativeExamples"/);
  const duplicate = functionSource('duplicateCategoryPayload');
  assert.match(duplicate, /enabledEngines/);
  assert.match(duplicate, /decisionQuestion/);
  assert.match(duplicate, /negativeExamples/);
  assert.match(duplicate, /requiredSlots/);
  assert.match(duplicate, /allowedQuoteRoles/);
  assert.match(duplicate, /claimMode/);
  assert.match(duplicate, /relationRequired/);
  assert.match(duplicate, /regex:\s*structuredClone/);
});

test('unsaved category and scenario drafts are guarded and narrow layouts cover 390px and 320px', () => {
  const unload = functionSource('handleSettingsBeforeUnload');
  assert.match(unload, /categoryEditor\.dirty/);
  assert.match(unload, /analysisModeEditorDirty/);
  assert.match(unload, /event\.preventDefault\(\)/);
  assert.match(script, /unsavedCategoryDialog/);
  assert.match(script, /handleAnalysisModeListKeydown/);
  assert.match(css, /@media \(max-width:480px\)/);
  assert.match(css, /\.analysis-mode-list\{grid-template-columns:1fr;\}/);
});
