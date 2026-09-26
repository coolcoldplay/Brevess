// Compiler contracts, not a claim that a model follows the instructions.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const note = require('../core/reading-tools.js');
const { buildResearchEvidenceDocument } = require('../core/research-evidence.js');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const single = () => { const t = note.normalizeLiteratureNoteTemplates()[0]; t.fields = t.fields.filter(f => f.id === 'main_findings'); return t; };
const captions = [
  { paragraphId: 'p-0000000000000001', sourceIdentity: 'caption:2', sourceKey: 'fig-2', textHash: 'h2', recordType: 'figure-caption', sectionTitle: 'Figure 2',
    text: 'Figure 2. Compartment-specific responses. (A) Extracellular Agent X did not prevent injury; treated animals retained the control injury phenotype. (B) Intracellular Agent Y prevented injury relative to vehicle.' },
  { paragraphId: 'p-0000000000000002', sourceIdentity: 'caption:15', sourceKey: 'fig-15', textHash: 'h15', recordType: 'figure-caption', sectionTitle: 'Figure 15',
    text: 'Figure 15. Compare control, early and late injury. Blue pseudocoloring denotes cells with intact junctions; arrows label detached cells. These colors identify structures across conditions and alone do not state which condition preserves junctions.' },
  { paragraphId: 'p-0000000000000003', sourceIdentity: 'caption:S9', sourceKey: 'fig-s9', textHash: 'hs9', recordType: 'figure-caption', sectionTitle: 'Figure S9',
    text: 'Figure S9. Independent validation. Assay Q confirmed reduced target activity in the edited group relative to the vehicle group; the companion comparison showed no detectable effect.' }
];
function compile(template = single(), sourceKind = 'html-canonical', language = 'en') {
  const policy = note.resolveLiteratureNoteEvidencePolicy(template, { sourceKind });
  const document = buildResearchEvidenceDocument({ title: 'Synthetic independent evidence', documentHash: 'unit-guidance', sourceKind,
    paragraphs: [...captions, { paragraphId: 'p-0000000000000004', sourceKey: 'body', textHash: 'hb', sectionKind: 'results', text: 'Figure 99 is mentioned only as an external citation; it supplies no result from this paper.' }] }, { maxCharacters: 36000, noteEvidencePolicy: policy });
  const prompt = note.compileLiteratureNoteAutofillPrompt(template, document, { outputLanguage: language, noteEvidencePolicy: policy });
  const [prefix, serialized] = prompt.userPrompt.split('\nLITERATURE_NOTE_REQUEST:\n');
  const payload = JSON.parse(serialized);
  const records = prefix.split('\n').flatMap(line => { try { const v = JSON.parse(line); return v.paragraphId ? [v] : []; } catch { return []; } });
  return { prompt, payload, records, document, policy, guide: payload.template.fields.find(f => f.id === 'main_findings')?.prompt };
}

test('compiled request couples actual main/supplementary evidence to a final coverage check under output pressure', () => {
  const c = compile();
  assert.equal(c.document.captionCoverage.complete, true);
  assert.deepEqual(c.document.captionCoverage.completeParagraphIds, captions.map(r => r.paragraphId));
  for (const input of captions) {
    const actual = c.records.find(r => r.paragraphId === input.paragraphId);
    assert.equal(actual.text, input.text); assert.equal(actual.sourceIdentity, input.sourceIdentity); assert.equal(actual.textHash, input.textHash);
  }
  assert.match(c.guide, /inventory.*main.*supplementary/is);
  assert.match(c.guide, /final.*(?:groups|coverage).*(?:inventory|supplied)/is);
  assert.match(c.guide, /(?:shorten|compress).*(?:each|every).*group/is);
  assert.match(c.guide, /(?:do not|never).*(?:silently|drop|omit)/is);
  assert.match(c.guide, /(?:citation|mentioned only)/is);
  assert.equal(c.prompt.responseSchema.properties.sources.properties.main_findings.maxItems, 32);
});

test('actual opposite intervention evidence stays separate and instructions require group/outcome/direction checks', () => {
  const c = compile(), contrast = c.records.find(r => r.sourceKey === 'fig-2').text;
  assert.match(contrast, /Agent X did not prevent injury/); assert.match(contrast, /Agent Y prevented injury relative to vehicle/);
  assert.match(c.guide, /(?:treatment|intervention).*(?:control|comparator).*(?:outcome|readout).*(?:direction|effect)/is);
  assert.match(c.guide, /(?:no effect|ineffective|negative control)/i);
  assert.match(c.guide, /(?:same|both|shared).*(?:effect|outcome)/is);
  // No paper-specific answer or entity is injected into the general guidance.
  assert.doesNotMatch(c.guide, /Agent X|Agent Y|BAPTA|RTX/);
});

test('caption display keys remain verbatim evidence and are explicitly separated from condition-specific findings', () => {
  const c = compile(), legend = c.records.find(r => r.sourceKey === 'fig-15').text;
  assert.match(legend, /Blue pseudocoloring denotes cells with intact junctions/);
  assert.match(c.guide, /(?:color|colour).*(?:arrow|symbol|legend)/is);
  assert.match(c.guide, /(?:legend|label|key).*(?:not|never).*(?:result|finding|effect)/is);
  assert.match(c.guide, /(?:condition|group).*(?:explicit|reported|supported)/is);
});

test('guidance version is exported for only the active-policy router cache input', () => {
  assert.equal(note.LITERATURE_NOTE_HTML_FINDINGS_GUIDANCE_VERSION, '6');
  assert.equal(compile().policy.id, 'html-basic-main-findings-v1');
  assert.equal(compile().prompt.schemaName, 'literature_note_autofill');
});

test('causal exclusions retain the tested perturbation and attach to the measured outcome, including headings', () => {
  for (const language of ['en', 'zh-CN']) {
    const c = compile(single(), 'html-canonical', language);
    assert.match(c.guide, /causal exclusions.*exact.*perturbation.*outcome/is);
    assert.match(c.guide, /(?:loss|removal).*not.*(?:function|signaling)/is);
    assert.match(c.guide, /Figure heading.*same.*(?:scope|qualifier)/is);
    assert.doesNotMatch(c.guide, /MeSC|RTX|BAPTA|nocicept|Figure S1/i);
  }
});

const legacyHashes = {
  "pdfSemantic": "3e8fdaa415f6294fffffcadd1bf15d0f5d8c7ed065ddab9b3eee57ef924c48fc",
  "pdfNative": "3e8fdaa415f6294fffffcadd1bf15d0f5d8c7ed065ddab9b3eee57ef924c48fc",
  "noPolicy": "3e8fdaa415f6294fffffcadd1bf15d0f5d8c7ed065ddab9b3eee57ef924c48fc",
  "custom": "929c142909214848a3d86aac2aa1acd7a70db5abfb8d0f63049e7637c8eacf9c",
  "renamed": "efe10e597e25c3329ea9ea3ce477f247994cdd09e652ef504cf458c63316682b",
  "multiField": "6c9e88dbdeb327e93e9ce4aa6abeaaa37785ece275f3e5507e65e436716169f7",
  "otherFamily": "415d9c4dfd7c5e21e86b015e79329ccbe9e30764f1916471a0e455bc7415dc84"
}; // NOTE016 multiField activates the existing caption policy; all other recorded contracts are unchanged.
function legacyCases() {
  const pdf = single(), custom = single(), renamed = single(), other = note.normalizeLiteratureNoteTemplates()[1];
  custom.fields[0].prompt = 'My precise custom instruction, including null effects.';
  renamed.fields[0].label = 'My reused field';
  return { pdfSemantic: compile(pdf, 'pdf-semantic').prompt, pdfNative: compile(pdf, 'pdf-native').prompt,
    noPolicy: compile(single(), '').prompt, custom: compile(custom).prompt, renamed: compile(renamed).prompt,
    multiField: compile(note.normalizeLiteratureNoteTemplates()[0]).prompt, otherFamily: compile(other).prompt };
}
test('compiled unrelated requests retain recorded contracts while batch default findings gains the caption policy', () => {
  const actual = Object.fromEntries(Object.entries(legacyCases()).map(([k, v]) => [k, hash(v)]));
  assert.deepEqual(actual, legacyHashes);
});

test('guidance is request-only and cannot rewrite manual text, explicit clears or custom field meaning', () => {
  const template = single(), beforeTemplate = JSON.stringify(template);
  const saved = { schemaVersion: 3, templateId: 'basic_research', valuesByTemplate: { basic_research: { main_findings: 'User analysis', innovations: 'Manual sibling' } },
    fieldUpdatedAtByTemplate: { basic_research: { main_findings: 21, limitations: 22 } }, updatedAt: 22 };
  const beforeSaved = JSON.stringify(saved);
  compile(template, 'html-canonical', 'zh-CN');
  assert.equal(JSON.stringify(template), beforeTemplate); assert.equal(JSON.stringify(saved), beforeSaved);
  assert.equal(template.fields[0].prompt, '');
  const custom = single(); custom.fields[0].prompt = 'Only one short custom claim.';
  assert.equal(compile(custom).guide, custom.fields[0].prompt);
});
