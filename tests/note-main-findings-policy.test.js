const test = require('node:test');
const assert = require('node:assert/strict');
const note = require('../core/reading-tools.js');
const evidence = require('../core/research-evidence.js');
const storage = require('../core/literature-note-source-storage.js');
const { projectLiteratureNoteSources: project } = require('../core/literature-note-sources.js');
const ID = 'html-basic-main-findings-v1';
const context = { sourceKind: 'html-canonical' };
const template = () => { const t = note.normalizeLiteratureNoteTemplates()[0]; t.fields = t.fields.filter(f => f.id === 'main_findings'); return t; };
const policy = t => { assert.equal(typeof note.resolveLiteratureNoteEvidencePolicy, 'function'); return note.resolveLiteratureNoteEvidencePolicy(t || template(), context); };
const ids = n => Array.from({ length: n }, (_, i) => `p-${(i + 1).toString(16).padStart(16, '0')}`);
const document = n => ({ sourceKind: 'html-canonical', documentHash: 'same-document', records: ids(n).map((paragraphId, i) => ({ paragraphId, sourceIdentity: `caption-${i}`, sourceKey: `raw-${i}`, textHash: `hash-${i}`, text: `Caption ${i}` })) });
const response = n => ({ values: { main_findings: '- Figure 1: bounded finding.' }, statuses: { main_findings: 'supported' }, sources: { main_findings: ids(n) } });
const fixedPolicy = { id: ID, sourceKind: 'html-canonical', maxSources: 32, captionFirst: true };
const options = { noteEvidencePolicy: fixedPolicy };

test('HTML default main_findings activates alone or in a batch while old/default/PDF/custom paths stay 12', () => {
  assert.deepEqual(policy(), fixedPolicy);
  assert.ok(Object.isFrozen(policy()));
  for (const sourceKind of [undefined, '', 'pdf-semantic', 'pdf-native', 'html']) assert.equal(note.resolveLiteratureNoteEvidencePolicy(template(), { sourceKind }).maxSources, 12);
  const variants = [t => { t.fields[0].prompt = 'My custom meaning'; }, t => { t.fields[0].label = 'Repurposed'; },
    t => { t.id = 'copy'; }, t => { t.studyFamily = 'custom'; }];
  for (const change of variants) { const t = template(); change(t); assert.equal(note.resolveLiteratureNoteEvidencePolicy(t, context).maxSources, 12); }
  const batch = template(); batch.fields.push({ id: 'research_background', label: '研究背景', prompt: '' });
  assert.equal(note.resolveLiteratureNoteEvidencePolicy(batch, context).maxSources, 32);
  let reads = 0; const t = template(); Object.defineProperty(t.fields[0], 'prompt', { get() { reads++; return ''; } });
  assert.equal(note.resolveLiteratureNoteEvidencePolicy(t, context).maxSources, 12); assert.equal(reads, 0);
});

test('compiled schema and real validator accept 13, 14 and 32 only for selected policy', () => {
  const t = template();
  assert.equal(note.compileLiteratureNoteAutofillPrompt(t, {}, options).responseSchema.properties.sources.properties.main_findings.maxItems, 32);
  for (const n of [13, 14, 32]) assert.equal(note.validateLiteratureNoteAutofillResponse(response(n), t, document(n), options).sources.main_findings.length, n);
  assert.throws(() => note.validateLiteratureNoteAutofillResponse(response(33), t, document(33), options), { code: 'INVALID_RESPONSE' });
  assert.equal(note.compileLiteratureNoteAutofillPrompt(t, {}).responseSchema.properties.sources.properties.main_findings.maxItems, 12);
  assert.throws(() => note.validateLiteratureNoteAutofillResponse(response(13), t, document(13)), { code: 'INVALID_RESPONSE' });
});

test('custom/repurposed templates cannot obtain 32 via a supplied policy', () => {
  for (const change of [t => { t.fields[0].prompt = 'Custom'; }, t => { t.fields[0].label = 'Other'; }, t => { t.studyFamily = 'clinical'; }]) {
    const t = template(); change(t);
    assert.equal(note.compileLiteratureNoteAutofillPrompt(t, {}, options).responseSchema.properties.sources.properties.main_findings.maxItems, 12);
    assert.throws(() => note.validateLiteratureNoteAutofillResponse(response(13), t, document(13), options), { code: 'INVALID_RESPONSE' });
  }
  for (const p of [{ ...fixedPolicy, sourceKind: 'pdf-semantic' }, { ...fixedPolicy, id: 'unknown' }, { ...fixedPolicy, maxSources: 999 }]) {
    assert.equal(note.compileLiteratureNoteAutofillPrompt(template(), {}, { noteEvidencePolicy: p }).responseSchema.properties.sources.properties.main_findings.maxItems, 12);
  }
});

test('fail-closed accepts the same 32 bound but missing/unknown sources stay missing', () => {
  assert.equal(note.finalizeLiteratureNoteAutofillFailClosed(response(32), template(), document(32), options).statuses.main_findings, 'supported');
  for (const [raw, doc] of [[response(33), document(33)], [response(14), document(13)]]) {
    assert.equal(note.finalizeLiteratureNoteAutofillFailClosed(raw, template(), doc, options).statuses.main_findings, 'missing');
  }
  const invalid = response(14); invalid.sources.main_findings[0] = 3;
  assert.throws(() => note.validateLiteratureNoteAutofillResponse(invalid, template(), document(14), options), { code: 'INVALID_RESPONSE' });
});

function storeInput(n, extra = {}) {
  return { value: 'Original scientific statement with hard-bound conditions.', sourceIds: ids(n), documentHash: 'same-document',
    template: template(), noteEvidencePolicy: fixedPolicy,
    receipt: { documentHash: 'same-document', noteEvidencePolicyId: ID, records: document(n).records }, ...extra };
}
test('HTML 14/32 sources use existing groups of at most 12 without changing prose or schema3', () => {
  for (const n of [14, 32]) {
    const input = storeInput(n), result = storage.prepareLiteratureNoteHtmlSources(input);
    assert.equal(result.sourcesSaved, true); assert.equal(result.warning, ''); assert.ok(result.value.startsWith(input.value + '\n'));
    const p = project(result.value); assert.equal(p.ok, true); assert.deepEqual(p.references.flatMap(r => r.sourceIds), ids(n));
    assert.ok(p.references.every(r => r.sourceIds.length <= 12));
    const state = note.normalizeLiteratureNoteDocumentState({ schemaVersion: 3, templateId: 'basic_research', valuesByTemplate: { basic_research: { main_findings: result.value, innovations: 'manual' } }, fieldUpdatedAtByTemplate: { basic_research: { main_findings: 1, limitations: 2 } } });
    assert.equal(state.schemaVersion, 3); assert.equal(state.valuesByTemplate.basic_research.main_findings, result.value); assert.equal(state.valuesByTemplate.basic_research.innovations, 'manual'); assert.equal(state.fieldUpdatedAtByTemplate.basic_research.limitations, 2);
    assert.equal(storage.prepareLiteratureNoteHtmlSources({ ...input, value: result.value }).value, result.value);
  }
});
test('HTML 33/default/PDF/wrong receipt/unknown/ambiguous IDs fail without changing original text', () => {
  const inputs = [storeInput(33), storeInput(14, { noteEvidencePolicy: undefined }), storeInput(14, { noteEvidencePolicy: { ...fixedPolicy, sourceKind: 'pdf-semantic' } }),
    storeInput(14, { receipt: { documentHash: 'other', noteEvidencePolicyId: ID, records: document(14).records } }),
    storeInput(14, { receipt: { documentHash: 'same-document', records: document(14).records } }),
    storeInput(14, { receipt: { documentHash: 'same-document', noteEvidencePolicyId: ID, records: document(13).records } })];
  const duplicate = storeInput(14); duplicate.receipt.records.push(duplicate.receipt.records[0]); inputs.push(duplicate);
  const custom = storeInput(14); custom.template.fields[0].prompt = 'Custom'; inputs.push(custom);
  for (const input of inputs) { const r = storage.prepareLiteratureNoteHtmlSources(input); assert.equal(r.sourcesSaved, false); assert.equal(r.value, input.value); }
  const long = storeInput(32, { value: 'x'.repeat(11900) }); assert.equal(storage.prepareLiteratureNoteHtmlSources(long).value, long.value); assert.equal(storage.prepareLiteratureNoteHtmlSources(long).sourcesSaved, false);
});

function largeSnapshot() {
  const paragraphs = [];
  for (let i = 0; i < 14; i++) paragraphs.push({ paragraphId: `body-${i}`, sourceKey: `body-${i}`, sourceIdentity: `body-${i}`, textHash: `body-h-${i}`, sectionKind: i % 2 ? 'introduction' : 'discussion', text: `Premise ${i}. ` + 'e'.repeat(2500) });
  const captions = ids(14).map((paragraphId, i) => ({ paragraphId, sourceKey: `caption-${i}`, sourceIdentity: `caption-${i}`, textHash: `caption-h-${i}`,
    recordType: 'figure-caption', sectionKind: 'figure', sectionTitle: `Figure ${i + 1}`, text: `Figure ${i + 1}. ` + 'c'.repeat(1600) }));
  return { sourceKind: 'html-canonical', title: 'Same source', documentHash: 'same-document', paragraphs: [...paragraphs, ...captions] };
}
test('caption-first retains all 14 complete original captions before fitting other evidence into 36k', () => {
  const s = largeSnapshot(), before = JSON.stringify(s);
  const d = evidence.buildResearchEvidenceDocument(s, { maxCharacters: 36000, noteEvidencePolicy: fixedPolicy });
  for (const r of s.paragraphs.filter(p => p.recordType === 'figure-caption')) assert.deepEqual(d.records.find(p => p.paragraphId === r.paragraphId)?.text, r.text);
  assert.ok(d.characterCount <= 36000); assert.equal(d.noteEvidencePolicyId, ID); assert.equal(d.captionCoverage.complete, true);
  assert.deepEqual(d.captionCoverage.missingParagraphIds, []);
  assert.equal(JSON.stringify(s), before);
  for (const r of d.records) { const original = s.paragraphs.find(x => x.paragraphId === r.paragraphId); assert.equal(r.sourceIdentity, original.sourceIdentity); assert.equal(r.sourceKey, original.sourceKey); assert.equal(r.textHash, original.textHash); assert.equal(r.documentHash, s.documentHash); }
});
test('caption overflow is explicit partial, keeps complete records and never expands the 128k policy budget', () => {
  const s = largeSnapshot(); for (const r of s.paragraphs.filter(p => p.recordType === 'figure-caption')) r.text += 'x'.repeat(8200);
  const d = evidence.buildResearchEvidenceDocument(s, { maxCharacters: 900000, noteEvidencePolicy: fixedPolicy });
  assert.ok(d.characterCount <= 128000); assert.equal(d.captionCoverage.complete, false); assert.ok(d.captionCoverage.missingParagraphIds.length);
  for (const r of d.records.filter(r => ids(14).includes(r.paragraphId))) assert.equal(r.text, s.paragraphs.find(p => p.paragraphId === r.paragraphId).text);
});
test('old balanced/PDF paths and source signatures do not change; strategy identity isolates only its cache inputs', () => {
  const s = largeSnapshot(), old = evidence.buildResearchEvidenceDocument(s, { maxCharacters: 36000 });
  const p = note.resolveLiteratureNoteEvidencePolicy(template(), { sourceKind: 'pdf-semantic' });
  assert.deepEqual(evidence.buildResearchEvidenceDocument(s, { maxCharacters: 36000, noteEvidencePolicy: p }), old);
  assert.deepEqual(evidence.buildResearchEvidenceDocument({ ...s, sourceKind: 'pdf-semantic' }, { maxCharacters: 36000, noteEvidencePolicy: fixedPolicy }), old);
  const selected = evidence.buildResearchEvidenceDocument(s, { maxCharacters: 36000, noteEvidencePolicy: fixedPolicy });
  assert.notEqual(selected.signature, old.signature); assert.equal(old.noteEvidencePolicyId, undefined);
  const one = { ...s, paragraphs: [s.paragraphs.at(-1)] };
  const before = evidence.buildResearchEvidenceDocument(one), scoped = evidence.buildResearchEvidenceDocument(one, options);
  assert.equal(scoped.stableText, before.stableText); assert.notEqual(scoped.signature, before.signature);
  const compact = evidence.compactResearchEvidenceDocument(selected, { maxCharacters: 18000 });
  assert.equal(compact.noteEvidencePolicyId, ID); assert.equal(compact.captionCoverage.complete, false); assert.ok(compact.characterCount <= 18000);
});

test('explicit PDF document cannot activate HTML capacity even with a stale HTML policy option', () => {
  const pdf = { ...document(14), sourceKind: 'pdf-semantic' };
  assert.equal(note.compileLiteratureNoteAutofillPrompt(template(), pdf, options).responseSchema.properties.sources.properties.main_findings.maxItems, 12);
  assert.throws(() => note.validateLiteratureNoteAutofillResponse(response(14), template(), pdf, options), { code: 'INVALID_RESPONSE' });
  assert.equal(note.finalizeLiteratureNoteAutofillFailClosed(response(14), template(), pdf, options).statuses.main_findings, 'missing');
});
test('typed captions under Methods remain original caption evidence; too-long captions stay explicitly missing', () => {
  const s = largeSnapshot(); s.paragraphs = s.paragraphs.filter(p => p.recordType === 'figure-caption');
  for (const r of s.paragraphs) { r.sectionKind = 'methods'; r.sectionTitle = 'Methods'; }
  let d = evidence.buildResearchEvidenceDocument(s, { maxCharacters: 36000, noteEvidencePolicy: fixedPolicy });
  assert.equal(d.records.length, 14); assert.equal(d.captionCoverage.complete, true);
  for (const r of d.records) { assert.equal(r.sectionTitle, 'Methods'); assert.equal(r.text, s.paragraphs.find(p => p.paragraphId === r.paragraphId).text); }
  s.paragraphs[0].text = 'Long caption ' + 'x'.repeat(13000);
  d = evidence.buildResearchEvidenceDocument(s, { maxCharacters: 36000, noteEvidencePolicy: fixedPolicy });
  assert.equal(d.captionCoverage.complete, false); assert.ok(d.captionCoverage.missingParagraphIds.includes(s.paragraphs[0].paragraphId));
  assert.ok(!d.records.some(r => r.paragraphId === s.paragraphs[0].paragraphId));
});
test('new strategy never treats zero captions as complete or accepts conflicting source identities', () => {
  const s = largeSnapshot();
  const noCaptions = { ...s, paragraphs: s.paragraphs.filter(p => p.recordType !== 'figure-caption') };
  assert.equal(evidence.buildResearchEvidenceDocument(noCaptions, { noteEvidencePolicy: fixedPolicy }).captionCoverage.complete, false);
  const duplicate = structuredClone(s); duplicate.paragraphs.push({ ...duplicate.paragraphs[0], text: 'Conflicting text' });
  assert.throws(() => evidence.buildResearchEvidenceDocument(duplicate, { noteEvidencePolicy: fixedPolicy }), { code: 'RESEARCH_EVIDENCE_IDENTITY_CONFLICT' });
  const foreign = structuredClone(s); foreign.paragraphs.at(-1).documentHash = 'other-document';
  assert.throws(() => evidence.buildResearchEvidenceDocument(foreign, { noteEvidencePolicy: fixedPolicy }), { code: 'RESEARCH_EVIDENCE_IDENTITY_CONFLICT' });
});
