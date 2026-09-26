const test = require('node:test');
const assert = require('node:assert/strict');
const entry = import('../scripts/verify-note011-live-structure.mjs');
const clone = value => JSON.parse(JSON.stringify(value));

async function fixture() {
  const m = await entry, api = m.loadProduction();
  const article = { title: 'Synthetic source-count boundary', sourceSha256: 'source-count-document', figures: [],
    paragraphs: Array.from({ length: 40 }, (_, i) => ({ id: `p-${String(i + 1).padStart(16, '0')}`,
      text: `Controlled comparison ${i + 1} supplies the corresponding measured outcome and its condition.` })) };
  const template = api.normalizeLiteratureNoteTemplates()[0];
  template.fields = template.fields.filter(f => f.id === 'main_findings');
  const policy = api.resolveLiteratureNoteEvidencePolicy(template, { sourceKind: 'html-canonical' });
  const document = api.buildResearchEvidenceDocument({ title: article.title, sourceKind: 'html-canonical', documentHash: article.sourceSha256,
    paragraphs: article.paragraphs.map(p => ({ paragraphId: p.id, sourceKey: p.id, sectionKind: 'results', text: p.text })) },
    { maxCharacters: 128000, noteEvidencePolicy: policy });
  const prompt = api.compileLiteratureNoteAutofillPrompt(template, document, { noteEvidencePolicy: policy });
  const body = { model: m.MODEL, messages: [{ role: 'system', content: prompt.systemPrompt }, { role: 'user', content: prompt.userPrompt }] };
  return { m, api, article, template, policy, document, prompt, body };
}
function answer(f, count) {
  return { values: { main_findings: '- Figure 1: synthetic supported comparison.' },
    statuses: { main_findings: 'supported' }, sources: { main_findings: f.document.records.slice(0, count).map(r => r.paragraphId) } };
}
async function capture(f, count) {
  const raw = JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(answer(f, count)) } }] });
  let call;
  const forward = f.m.createForwarder({ ...f, secret: 'synthetic-no-network', callCap: 2, timeoutMs: 1000,
    fetchImpl: async () => new Response(raw), record: r => { call = clone(r); } });
  assert.equal((await forward.forward(JSON.stringify(f.body))).bytes.toString(), raw);
  return call;
}

test('caption-first guidance states the actual source ceiling and minimum sufficient evidence without truncation', async () => {
  const f = await fixture();
  for (const outputLanguage of ['en', 'zh-CN']) {
    const prompt = f.api.compileLiteratureNoteAutofillPrompt(f.template, f.document, { noteEvidencePolicy: f.policy, outputLanguage });
    const guide = JSON.parse(prompt.userPrompt.split('LITERATURE_NOTE_REQUEST:\n')[1]).template.fields[0].prompt;
    const limit = prompt.responseSchema.properties.sources.properties.main_findings.maxItems;
    assert.equal(limit, 32);
    assert.match(guide, new RegExp(`at most ${limit} distinct supplied paragraphIds`, 'i'));
    assert.match(guide, /smallest sufficient.*directly support.*actual conclusions/is);
    assert.match(guide, /(?:do not|never).*all input.*source/is);
    assert.match(guide, /(?:do not|never).*truncate.*source/is);
    assert.match(guide, /(?:do not|never).*invent.*(?:ID|source)/is);
  }
  assert.equal(f.api.LITERATURE_NOTE_HTML_FINDINGS_GUIDANCE_VERSION, '6');
});

test('existing 32-source validator and fail-closed state are unchanged; no automatic evidence dropping', async () => {
  const f = await fixture();
  assert.equal(f.document.records.length, 40);
  const options = { noteEvidencePolicy: f.policy };
  assert.equal(f.api.validateLiteratureNoteAutofillResponse(answer(f, 32), f.template, f.document, options).sources.main_findings.length, 32);
  for (const count of [33, 34, 39]) {
    const raw = answer(f, count), before = JSON.stringify(raw);
    assert.throws(() => f.api.validateLiteratureNoteAutofillResponse(raw, f.template, f.document, options), { code: 'INVALID_RESPONSE' });
    const closed = f.api.finalizeLiteratureNoteAutofillFailClosed(raw, f.template, f.document, options);
    assert.equal(closed.statuses.main_findings, 'missing');
    assert.equal(closed.values.main_findings, undefined);
    assert.deepEqual(closed.sources.main_findings, []);
    assert.equal(JSON.stringify(raw), before);
  }
});

test('transparent capture retains both real failure shapes and numeric schema evidence', async () => {
  const f = await fixture();
  for (const count of [39, 34]) {
    const call = await capture(f, count);
    assert.equal(call.validated, undefined);
    assert.match(call.validation, /not-valid-as-received/);
    assert.equal(call.validationErrorCode, 'INVALID_RESPONSE');
    assert.deepEqual(call.schemaEvidence, { fieldId: 'main_findings', valueCharacters: answer(f, count).values.main_findings.length,
      sourceCount: count, distinctSourceCount: count, sourceLimit: 32, unknownSourceCount: 0, status: 'supported' });
    assert.doesNotMatch(JSON.stringify(call), /synthetic-no-network/);
  }
});

test('unchanged empty or old field with no validated generation is a generation failure, never a save-loss claim', async () => {
  const f = await fixture(), calls = [await capture(f, 39), await capture(f, 34)];
  for (const prior of [undefined, '', 'Previously saved manual result.']) {
    assert.throws(() => f.m.inspectGeneratedField('main_findings', prior, prior, calls, f.api, f.article.sourceSha256), error => {
      assert.equal(error.code, 'NOTE011_GENERATION_FAILED');
      assert.equal(error.details.previousValueUnchanged, true);
      assert.deepEqual(error.details.attempts.map(c => c.schemaEvidence.sourceCount), [39, 34]);
      assert.ok(error.details.attempts.every(c => c.validationErrorCode === 'INVALID_RESPONSE'));
      return true;
    });
  }
});

test('changed unvalidated field and mismatched valid generation still fail the exact saved-value contract', async () => {
  const f = await fixture(), invalid = await capture(f, 34), valid = await capture(f, 1);
  const preparationFailed = clone(valid); delete preparationFailed.htmlSources;
  for (const [before, after, calls] of [[undefined, 'Unexpected new value', [invalid]],
    ['Old manual value', 'Old manual value', [valid]], [undefined, undefined, [valid]],
    [undefined, undefined, [preparationFailed]]]) {
    assert.throws(() => f.m.inspectGeneratedField('main_findings', before, after, calls, f.api, f.article.sourceSha256),
      { code: 'NOTE011_SAVED_VALUE_NOT_FROM_VALIDATED_RESPONSE' });
  }
  const inspected = f.m.inspectGeneratedField('main_findings', undefined, valid.htmlSources.value, [invalid, valid], f.api, f.article.sourceSha256);
  assert.equal(inspected.call, valid);
  assert.equal(inspected.evidence.kind, 'html-canonical-reference');
  assert.throws(() => f.m.inspectGeneratedField('main_findings', undefined, valid.htmlSources.value, [valid], f.api, 'wrong-doc'),
    { code: 'NOTE011_SAVED_SOURCE_BINDING' });
});

test('classification does not mutate old fields, calls, templates or explicit-clear metadata', async () => {
  const f = await fixture(), call = await capture(f, 34);
  const state = { valuesByTemplate: { basic_research: { main_findings: 'Manual result', innovations: 'Sibling' } },
    fieldUpdatedAtByTemplate: { basic_research: { main_findings: 5, limitations: 6 } }, updatedAt: 6 };
  const original = JSON.stringify({ state, call, template: f.template });
  assert.throws(() => f.m.inspectGeneratedField('main_findings', state.valuesByTemplate.basic_research.main_findings,
    state.valuesByTemplate.basic_research.main_findings, [call], f.api, f.article.sourceSha256), { code: 'NOTE011_GENERATION_FAILED' });
  assert.equal(JSON.stringify({ state, call, template: f.template }), original);
});
