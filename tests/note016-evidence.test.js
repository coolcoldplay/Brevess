// Offline source-selection contracts. Inventory captions are reconstructed current
// input, not a record of the historical request or a scientific output verdict.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const note = require('../core/reading-tools.js');
const evidence = require('../core/research-evidence.js');
const clone = value => structuredClone(value);
const scope = { evidencePurpose: 'literature-note' };
const basic = () => note.normalizeLiteratureNoteTemplates()[0];
const clean = value => value.normalize('NFKC').replace(/<[^>]*>/gu, '').replace(/\s+/gu, ' ').trim();
function build(paragraphs, template = basic(), options = {}) {
  const policy = note.resolveLiteratureNoteEvidencePolicy(template, { sourceKind: 'html-canonical' });
  const document = evidence.buildResearchEvidenceDocument({ sourceKind: 'html-canonical', documentHash: 'note016', paragraphs },
    { ...scope, maxCharacters: policy.captionFirst ? 128000 : 36000, noteEvidencePolicy: policy, ...options });
  const prompt = note.compileLiteratureNoteAutofillPrompt(template, document, { noteEvidencePolicy: policy });
  const request = JSON.parse(prompt.userPrompt.split('LITERATURE_NOTE_REQUEST:\n')[1]);
  return { document, policy, prompt, request };
}
const body = [
  { paragraphId: 'a', sectionKind: 'abstract', text: 'Summary.' },
  { paragraphId: 'm', sectionKind: 'main', sectionTitle: 'Result of comparison', text: 'The control comparison found a measured difference (Fig. 1).' },
  { paragraphId: 'method', sectionKind: 'methods', sectionTitle: 'Methods', text: 'Assay method with a calibration control.' },
  { paragraphId: 'method-summary', sectionKind: 'methods', sectionTitle: 'Reporting summary', text: 'The reported calibration used a shared control.' },
  { paragraphId: 'ref', sectionKind: 'references', text: 'Reference list.' },
  { paragraphId: 'ed-link', sectionKind: 'extended-data', text: 'Source data' }
];

test('HTML literature-note scope preserves neutral main and methods through build and compact only', () => {
  const input = clone(body), before = JSON.stringify(input), result = build(input);
  assert.equal(result.document.records.find(r => r.paragraphId === 'm')?.sectionKind, 'main');
  assert.equal(result.document.records.find(r => r.paragraphId === 'method')?.sectionKind, 'methods');
  assert.equal(result.document.records.find(r => r.paragraphId === 'method-summary')?.sectionKind, 'methods');
  assert.ok(!result.document.records.some(r => ['ref', 'ed-link'].includes(r.paragraphId)));
  const compact = evidence.compactResearchEvidenceDocument(result.document, { maxCharacters: 4000 });
  assert.equal(compact.records.find(r => r.paragraphId === 'm')?.sectionKind, 'main');
  assert.ok(compact.records.some(r => r.paragraphId === 'method'));
  assert.equal(JSON.stringify(input), before);
  const snapshot = { sourceKind: 'html-canonical', paragraphs: input };
  const legacy = evidence.buildResearchEvidenceDocument(snapshot);
  assert.ok(!legacy.records.some(r => r.paragraphId === 'method'));
  assert.deepEqual(evidence.buildResearchEvidenceDocument({ ...snapshot, sourceKind: 'pdf-semantic' }, scope),
    evidence.buildResearchEvidenceDocument({ ...snapshot, sourceKind: 'pdf-semantic' }));
});

test('other HTML templates gain main/methods with unchanged 36k input and 12-source limits', () => {
  for (const template of note.normalizeLiteratureNoteTemplates().filter(t => t.id !== 'basic_research')) {
    const result = build(body, template);
    assert.equal(result.policy.captionFirst, false);
    assert.ok(result.document.records.some(r => r.paragraphId === 'method'));
    assert.ok(result.document.characterCount <= 36000);
    for (const schema of Object.values(result.prompt.responseSchema.properties.sources.properties)) assert.equal(schema.maxItems, 12);
  }
});

test('batch activates caption-first only for original default main_findings and retains per-field source bounds', () => {
  const template = basic();
  const records = Array.from({ length: 33 }, (_, i) => ({ paragraphId: `p${i}`, sectionKind: 'results', text: `Result ${i}.` }));
  const result = build(records, template);
  assert.equal(result.policy.captionFirst, true);
  const schemas = result.prompt.responseSchema.properties.sources.properties;
  assert.equal(schemas.main_findings.maxItems, 32);
  assert.equal(schemas.important_methods.maxItems, 12);
  const value = { values: {}, statuses: {}, sources: {} };
  for (const field of template.fields) { value.values[field.id] = 'Supported point.'; value.statuses[field.id] = 'supported'; value.sources[field.id] = ['p0']; }
  value.sources.main_findings = records.slice(0, 32).map(r => r.paragraphId);
  const options = { noteEvidencePolicy: result.policy };
  assert.equal(note.validateLiteratureNoteAutofillResponse(value, template, result.document, options).sources.main_findings.length, 32);
  value.sources.important_methods = records.slice(0, 13).map(r => r.paragraphId);
  assert.throws(() => note.validateLiteratureNoteAutofillResponse(value, template, result.document, options), { code: 'INVALID_RESPONSE' });
  const closed = note.finalizeLiteratureNoteAutofillFailClosed(value, template, result.document, options);
  assert.equal(closed.statuses.main_findings, 'supported');
  assert.equal(closed.statuses.important_methods, 'missing');
  for (const mutate of [t => t.fields.find(f => f.id === 'main_findings').prompt = 'Custom',
    t => t.fields.find(f => f.id === 'main_findings').label = 'Other', t => t.id = 'custom']) {
    const t = basic(); mutate(t); assert.equal(build(body, t).policy.captionFirst, false);
  }
});

function caption(text, index) { return { paragraphId: `caption-${index}`, sourceKey: `caption-source-${index}`, recordType: 'figure-caption', text }; }
test('complete explicit Extended Data labels remain distinct from main and supplementary numbers', () => {
  const template = basic(); template.fields = template.fields.filter(f => f.id === 'main_findings');
  const result = build(['Fig. 1: Measured main comparison.', 'Extended Data Fig. 1: Additional control.',
    'Extended Data Figure 8. Additional comparison.', 'Figure S1. Separate supplement.'].map(caption), template);
  const guide = result.request.template.fields.find(f => f.id === 'main_findings').prompt;
  assert.match(guide, /Verified complete-caption Figure order: Fig\. 1; Extended Data Fig\. 1; Extended Data Figure 8; Figure S1\./);
  assert.equal(note.LITERATURE_NOTE_HTML_FINDINGS_GUIDANCE_VERSION, '6');
});
test('Extended Data references, ranges, panels and duplicate aliases cannot supply a guessed outline', () => {
  for (const captions of [['See Extended Data Fig. 1: Later citation.'], ['Extended Data Fig. 1a: Panel.'],
    ['Extended Data Fig. 1–2: Range.'], ['Extended Data Fig. 1.2: Decimal.'],
    ['Extended Data Fig. 1: First.', 'Extended Data Figure 1. Duplicate.']]) {
    const template = basic(); template.fields = template.fields.filter(f => f.id === 'main_findings');
    const result = build(captions.map(caption), template);
    assert.doesNotMatch(result.request.template.fields.find(f => f.id === 'main_findings').prompt, /Verified complete-caption Figure order:/);
  }
});
test('explicit ED whitespace-title labels work but unlabelled captions retain the old all-or-nothing outline', () => {
  const template = basic(); template.fields = template.fields.filter(f => f.id === 'main_findings');
  const result = build(['Fig. 1: Main result.',
    'Extended Data Fig. 8 Depletion strategy of macrophages. a, Measured control.'].map(caption), template);
  const guide = result.request.template.fields[0].prompt;
  assert.match(guide, /Verified complete-caption Figure order: Fig\. 1; Extended Data Fig\. 8\./);
  assert.doesNotMatch(guide, /Figure 2|Fig\. 2/);
  const incomplete = build(['Fig. 1: Main result.', 'a, Unlabelled panel observations.',
    'Extended Data Fig. 8 Depletion strategy of macrophages. a, Measured control.'].map(caption), template);
  assert.doesNotMatch(incomplete.request.template.fields[0].prompt, /Verified complete-caption Figure order:/);
  for (const title of ['and 9', 'to 9', 'A, Measured panel', 'A) Measured panel', 'a to c Measured panels',
    'a–c, Measured panels', '2: Decimal continuation', '–9: Range']) {
    const f = build([`Extended Data Fig. 8 ${title}`].map(caption), template);
    assert.doesNotMatch(f.request.template.fields[0].prompt, /Verified complete-caption Figure order:/);
  }
});

const realSource = path.join(__dirname, '../output/note016-nature-source-20260925/source.json');
test('audited Nature projection retains all 11 original neutral-main result paragraphs and current 13 captions',
  { skip: !fs.existsSync(realSource) && 'Local audited projection is not distributed with this test' }, () => {
    const source = JSON.parse(fs.readFileSync(realSource, 'utf8')), before = JSON.stringify(source);
    // Explicitly test-only IDs: inventory did not contain canonical caption IDs.
    const captions = source.figures.map((figure, index) => caption(figure.caption, index));
    const result = build([...source.paragraphs, ...captions]);
    const mainResults = source.paragraphs.filter(p => p.sectionKind === 'main' && p.sectionTitle !== 'Main');
    assert.equal(mainResults.length, 11);
    for (const original of mainResults) {
      const actual = result.document.records.find(p => p.paragraphId === original.paragraphId);
      assert.equal(actual?.sectionKind, 'main', original.sourceKey);
      assert.equal(actual?.text, clean(original.text));
      assert.equal(actual?.sourceKey, original.sourceKey);
      assert.equal(actual?.textHash, original.textHash);
    }
    assert.equal(result.document.captionCoverage.completeParagraphIds.length, 13);
    assert.ok(result.document.characterCount <= 128000);
    const guide = result.request.template.fields.find(f => f.id === 'main_findings').prompt;
    assert.doesNotMatch(guide, /Verified complete-caption Figure order:/,
      'Inventory Fig4/5 captions lack starting identifiers, so the existing bounded fallback is retained');
    assert.match(result.document.stableText, /Extended Data Fig\. 8/);
    assert.ok(result.document.records.every(p => !/references|authors|extended-data/.test(p.sectionKind)));
    assert.equal(JSON.stringify(source), before);
  });
