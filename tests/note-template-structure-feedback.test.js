const test = require('node:test');
const assert = require('node:assert/strict');
const note = require('../core/reading-tools.js');
const templates = () => note.normalizeLiteratureNoteTemplates();
function payload(template, language = 'zh-CN') {
  return JSON.parse(note.compileLiteratureNoteAutofillPrompt(template,
    { stableText: '[paragraph_id=p1] Figure 1 shows a measured change.' },
    { outputLanguage: language }).userPrompt.split('\nLITERATURE_NOTE_REQUEST:\n')[1]);
}
const guidance = (value, id) => value.template.fields.find(field => field.id === id).prompt;

test('basic research background has three explicit ordered sections and term definitions', () => {
  const value = guidance(payload(templates()[0]), 'research_background');
  assert.match(value, /关键概念[\s\S]*现状与已知[\s\S]*未知与矛盾/);
  assert.match(value, /term.*definition/i);
  assert.match(value, /logical.*order/i);
  assert.match(value, /do not invent/i);
});

test('main findings are conclusions grouped by source-supported Figure, not fabricated coverage', () => {
  const value = guidance(payload(templates()[0]), 'main_findings');
  assert.match(value, /each.*Figure/i);
  assert.match(value, /conclusion/i);
  assert.match(value, /Panel/i);
  assert.match(value, /do not invent/i);
  assert.match(value, /supplement/i);
});

test('legacy empty built-in prompts gain guidance only at request time', () => {
  const template = templates()[0];
  const before = structuredClone(template);
  assert.ok(template.fields.every(field => field.prompt === ''));
  assert.match(guidance(payload(template), 'main_findings'), /Figure/);
  assert.deepEqual(template, before);
  assert.ok(note.DEFAULT_LITERATURE_NOTE_TEMPLATES.every(item => item.fields.every(field => field.prompt === '')));
});

test('single-field regeneration retains background organization and English localization', () => {
  const template = templates()[0];
  template.fields = template.fields.filter(field => field.id === 'research_background');
  const value = payload(template, 'en');
  assert.equal(value.template.fields.length, 1);
  assert.match(value.template.fields[0].prompt, /Key concepts.*Current knowledge.*Unknowns and contradictions/);
  assert.doesNotMatch(value.template.fields[0].prompt, /关键概念/);
});

test('custom prompts and repurposed or custom template fields keep their meaning', () => {
  const template = templates()[0];
  template.fields[0].prompt = '只提炼一句已知背景，保留否定。';
  assert.equal(guidance(payload(template), 'research_background'), template.fields[0].prompt);
  template.fields[0].prompt = '';
  template.fields[0].label = '我的药物剂量记录';
  assert.equal(guidance(payload(template), 'research_background'), '');
  template.id = 'custom_basic_copy';
  assert.equal(guidance(payload(template), 'main_findings'), '');
});

test('other six study families get relevant organization without a Figure mandate', () => {
  const expected = {
    clinical_study: /primary.*secondary/i,
    systematic_review: /heterogeneity/i,
    narrative_review: /consensus.*contradict/i,
    case_report: /timeline/i,
    methods_resource: /input.*output/i,
    guideline_consensus: /recommendation.*strength/i
  };
  for (const template of templates().slice(1)) {
    const prompts = payload(template).template.fields.map(field => field.prompt);
    assert.ok(prompts.every(Boolean), template.id);
    assert.match(prompts.join('\n'), expected[template.id]);
    assert.doesNotMatch(prompts.join('\n'), /each.*Figure/i);
  }
});

test('generation guidance never rewrites already saved notes or user empty values', () => {
  const saved = { schemaVersion: 3, templateId: 'basic_research', updatedAt: 20,
    valuesByTemplate: { basic_research: { research_background: '既有人工背景', main_findings: '' } },
    fieldUpdatedAtByTemplate: { basic_research: { research_background: 19, main_findings: 20 } } };
  const normalized = note.normalizeLiteratureNoteDocumentState(saved);
  const before = JSON.stringify(normalized);
  payload(templates()[0]);
  assert.equal(JSON.stringify(normalized), before);
  assert.equal(normalized.valuesByTemplate.basic_research.research_background, '既有人工背景');
  assert.equal(normalized.valuesByTemplate.basic_research.main_findings, undefined);
  assert.equal(normalized.fieldUpdatedAtByTemplate.basic_research.main_findings, 20);
});
