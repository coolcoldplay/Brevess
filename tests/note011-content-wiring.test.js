const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const note = require('../core/reading-tools.js');
const sources = require('../core/literature-note-sources.js');
const storage = require('../core/literature-note-source-storage.js');
const content = fs.readFileSync(require.resolve('../content.js'), 'utf8');
const template = () => { const t = note.normalizeLiteratureNoteTemplates()[0]; t.fields = t.fields.filter(f => f.id === 'main_findings'); return t; };
const record = (id, recordType = 'body') => ({ paragraphId: id, recordType, sourceKey: `source-${id}`, textHash: `hash-${id}`, text: `Original ${id}`, sectionTitle: 'Results' });
const body = record('p-0000000000000001'), caption = record('p-0000000000000002', 'figure-caption');
const snapshot = { documentHash: 'current-hash', revision: 3, paragraphs: [body], typedRecords: [body, caption] };
function loadFunction(name, endName, deps) {
  const start = content.indexOf(`async function ${name}(`);
  const end = content.indexOf(`\nfunction ${endName}(`, start);
  assert.ok(start >= 0 && end > start);
  return Function(...Object.keys(deps), `return (${content.slice(start, end)});`)(...Object.values(deps));
}
async function request(t, semantic = null, native = null) {
  let sent;
  const run = loadFunction('autofillLiteratureNoteWithLLM', 'buildFigureOperationProviderPlan', {
    articleWorkspaceLifecycleGeneration: 1, getCanonicalArticleSnapshot: () => snapshot,
    pdfSemanticArticleChatSnapshot: () => semantic, activeNativePdfStructure: () => native,
    SciLLM: note, document: { title: 'Original paper' },
    assertCurrentArticleWorkspaceLifecycle: () => {}, buildPdfLiteratureNoteFieldEvidence: () => ({}),
    chrome: { runtime: { sendMessage: async message => { sent = message; return { success: true, data: {
      templateId: t.id, evidenceReceipt: { documentHash: 'current-hash', records: [],
        noteEvidencePolicyId: note.resolveLiteratureNoteEvidencePolicy(t, { sourceKind: message.document.sourceKind }).id }
    } }; } } }
  });
  const result = await run(t); return { sent, result };
}
test('actual content request includes canonical captions only for the default HTML main findings', async () => {
  const { sent, result } = await request(template());
  assert.equal(sent.document.sourceKind, 'html-canonical');
  assert.deepEqual(sent.document.paragraphs.map(p => p.paragraphId), [body.paragraphId, caption.paragraphId]);
  assert.equal(sent.document.paragraphs[1].recordType, 'figure-caption');
  assert.equal(sent.document.paragraphs[1].textHash, caption.textHash);
  assert.equal(result.result.noteEvidencePolicy.maxSources, 32);
});
test('custom prompts, background and PDF do not receive HTML caption policy', async () => {
  const custom = template(); custom.fields[0].prompt = 'My instructions';
  const background = note.normalizeLiteratureNoteTemplates()[0]; background.fields = background.fields.filter(f => f.id === 'research_background');
  for (const [t, semantic, native] of [[custom, null, null], [background, null, null], [template(), snapshot, null], [template(), null, {}]]) {
    const { sent } = await request(t, semantic, native);
    assert.deepEqual(sent.document.paragraphs.map(p => p.paragraphId), [body.paragraphId]);
  }
});
test('actual popup receiver retains fourteen receipt-bound sources and manual sibling fields', () => {
  const popup = fs.readFileSync(require.resolve('../popup.js'), 'utf8');
  const ctx = { SciLLM: { ...note, ...sources, ...storage } };
  vm.runInNewContext(popup.slice(popup.indexOf('// DOM-independent popup UI helpers: start'),
    popup.indexOf('// DOM-independent popup UI helpers: end')) + '\nglobalThis.helpers=PopupUiHelpers;', ctx);
  const t = template(), policy = note.resolveLiteratureNoteEvidencePolicy(t, { sourceKind: 'html-canonical' });
  const ids = Array.from({ length: 14 }, (_, i) => `p-${i.toString(16).padStart(16, '0')}`);
  const state = { valuesByTemplate: { basic_research: { innovations: 'Manual text' } } };
  const result = ctx.helpers.applyLiteratureNoteAutofillResult({ template: t, state, replaceFieldIds: ['main_findings'], result: {
    values: { main_findings: 'Figure conclusions' }, fieldStatus: { main_findings: 'supported' }, sources: { main_findings: ids },
    documentHash: 'current-hash', noteEvidencePolicy: policy,
    evidenceReceipt: { documentHash: 'current-hash', noteEvidencePolicyId: policy.id, records: ids.map(paragraphId => ({ paragraphId })) }
  } });
  assert.equal(result.sourceWarnings.length, 0);
  assert.equal(sources.projectLiteratureNoteSources(state.valuesByTemplate.basic_research.main_findings).references.flatMap(x => x.sourceIds).length, 14);
  assert.equal(state.valuesByTemplate.basic_research.innovations, 'Manual text');
});

test('caption navigation requires exact document, revision, unique typed ID, source key and text hash', () => {
  const start = content.indexOf('function focusLiteratureNoteCaptionSource(');
  const end = content.indexOf('\nasync function focusArticleWorkspaceSource(', start);
  assert.ok(start >= 0 && end > start);
  let focused = 0; const current = structuredClone(snapshot); current.typedRecords[1].anchor = { domId: 'caption-original' };
  const elements = [{ text: caption.text, getClientRects: () => [1], closest: () => null,
    scrollIntoView: () => { focused++; }, classList: { add() {}, remove() {} } }];
  const deps = { activeNativePdfStructure: () => null, pdfSemanticArticleChatSnapshot: () => null,
    getCanonicalArticleSnapshot: () => current, focusArticleSource: () => { throw Error('Heading fallback forbidden'); },
    document: {},
    SciLLM: { collectArticleCaptionSources: () => elements.map(element => ({ element, text: element.text })) },
    clearArticleChatCitationHighlight: () => {}, setTimeout: () => {} };
  const run = Function(...Object.keys(deps), `return (${content.slice(start, end)});`)(...Object.values(deps));
  const target = { documentHash: current.documentHash, navigationRevision: 3, paragraphId: caption.paragraphId, sourceKey: caption.sourceKey, textHash: caption.textHash };
  assert.equal(run(target), true); assert.equal(focused, 1);
  for (const delta of [{ documentHash: 'other' }, { navigationRevision: 2 }, { paragraphId: body.paragraphId },
    { sourceKey: 'other' }, { textHash: 'changed' }, { paragraphId: '' }]) assert.equal(run({ ...target, ...delta }), false);
  current.typedRecords.push(structuredClone(current.typedRecords[1])); assert.equal(run(target), false);
  current.typedRecords.pop(); elements.push({ ...elements[0] }); assert.equal(run(target), false);
  elements.pop(); elements[0].text = 'Changed DOM text'; assert.equal(run(target), false);
  elements[0].text = caption.text; elements[0].getClientRects = () => []; assert.equal(run(target), false);
  elements[0].getClientRects = () => [1]; elements[0].closest = selector => {
    assert.ok(selector.includes('[data-sci-plugin-ui]')); return { pluginUI: true };
  }; assert.equal(run(target), false);
  assert.equal(focused, 1);
});
