const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  DEFAULT_LITERATURE_NOTE_TEMPLATES,
  normalizeLiteratureNoteTemplates,
  compileLiteratureNoteAutofillPrompt
} = require('../core/reading-tools.js');

const root = path.resolve(__dirname, '..');

test('normalizes bounded multiline field prompts while preserving existing field properties', () => {
  const prompt = `  先提取研究对象与关键条件。\r\n  再说明证据边界。\n${'证'.repeat(5000)}`;
  const template = normalizeLiteratureNoteTemplates([{
    id: 'custom_review', name: '自定义综述', studyFamily: 'review',
    fields: [{
      id: 'evidence_boundary', label: '证据边界', prompt,
      placeholder: '记录作者没有回答的问题', multiline: false, required: true
    }]
  }])[0];
  const field = template.fields[0];

  assert.equal(field.id, 'evidence_boundary');
  assert.equal(field.label, '证据边界');
  assert.match(field.prompt, /^先提取研究对象与关键条件。\n再说明证据边界。\n/u);
  assert.equal(field.prompt.includes('\r'), false);
  assert.ok(field.prompt.length <= 4000);
  assert.equal(field.placeholder, '记录作者没有回答的问题');
  assert.equal(field.multiline, false);
  assert.equal(field.required, true);
});

test('puts every field prompt into the evidence-bounded literature-note request', () => {
  const template = normalizeLiteratureNoteTemplates([{
    id: 'mechanism_note', name: '机制笔记', studyFamily: 'basic_research',
    fields: [{
      id: 'mechanism_chain', label: '机制链',
      prompt: '按“干预 → 直接观察 → 结论”组织，并指出缺失环节。',
      placeholder: '尚未填写', multiline: true, required: false
    }]
  }])[0];
  const compiled = compileLiteratureNoteAutofillPrompt(template, {
    version: '2', stableText: '[paragraph_id=p-1] 干预 X 后观察到 Y。',
    records: [{ paragraphId: 'p-1', text: '干预 X 后观察到 Y。' }]
  });
  const payload = JSON.parse(compiled.userPrompt.split(
    '\nLITERATURE_NOTE_REQUEST:\n'
  )[1]);

  assert.equal(payload.template.fields[0].id, 'mechanism_chain');
  assert.equal(payload.template.fields[0].label, '机制链');
  assert.equal(payload.template.fields[0].prompt,
    '按“干预 → 直接观察 → 结论”组织，并指出缺失环节。');
  assert.equal(payload.template.fields[0].placeholder, '尚未填写');
  assert.match(payload.instruction, /follow each field's prompt/i);
  assert.match(payload.instruction, /canonical article evidence/i);
  assert.match(compiled.stablePrefix, /Use only the canonical article evidence/u);
  assert.match(compiled.systemPrompt, /never reuse facts from another paper/i);
});

test('keeps default and legacy fields compatible with an empty prompt', () => {
  assert.ok(DEFAULT_LITERATURE_NOTE_TEMPLATES.every(template =>
    template.fields.every(field => field.prompt === '')));
  const legacy = normalizeLiteratureNoteTemplates([{
    id: 'legacy_note', name: '旧模板', studyFamily: 'custom',
    fields: [{ id: 'legacy_field', label: '旧字段', placeholder: '旧占位符' }]
  }])[0];
  assert.equal(legacy.fields[0].prompt, '');
  assert.equal(legacy.fields[0].placeholder, '旧占位符');
});

test('settings editor exposes named field rows and prompt-first CRUD without ID syntax', () => {
  const script = fs.readFileSync(path.join(root, 'options.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'options.html'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'options.css'), 'utf8');

  assert.match(script, /function createLiteratureNoteFieldRow\(/u);
  assert.match(script, /dataset\.literatureFieldId/u);
  assert.match(script, /dataLiteratureFieldLabel|literatureFieldLabel/u);
  assert.match(script, /dataLiteratureFieldPrompt|literatureFieldPrompt/u);
  assert.match(script, /dataAddLiteratureField|addLiteratureField/u);
  assert.match(script, /dataDeleteLiteratureField|deleteLiteratureField/u);
  assert.match(script, /updateLiteratureNoteDeleteStates/u);
  assert.doesNotMatch(script, /字段（每行“字段 ID \| 显示名称”）/u);
  assert.match(html, /id="literatureNoteTemplateDescription"/u);
  assert.match(script, /每个字段都可设置名称和 AI 提示词/u);
  assert.match(css, /\.literature-note-field-row/u);
  assert.match(css, /\.literature-note-field-list[^}]*max-height[^}]*overflow-y\s*:\s*auto/su);
});
