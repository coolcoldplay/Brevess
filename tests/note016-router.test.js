const test = require('node:test');
const assert = require('node:assert/strict');
const { api, createBackgroundRouter } = require('./helpers/note016-runtime.js');
function parse(body) {
  const user = body.messages.find(m => m.role === 'user').content;
  return { request: JSON.parse(user.split('LITERATURE_NOTE_REQUEST:\n')[1]), records: user.split('\n').flatMap(line => {
    try { const item = JSON.parse(line); return item.paragraphId ? [item] : []; } catch { return []; }
  }) };
}
async function harness(contextWindowTokens) {
  const values = {}, requests = [], entries = new Map();
  const router = createBackgroundRouter({
    storageArea: { get(key, cb) { cb({ [key]: values[key] }); }, set(input, cb) { Object.assign(values, input); cb(); } },
    cacheStore: { async getMany(keys) { return new Map(keys.filter(k => entries.has(k)).map(k => [k, entries.get(k)])); },
      async setMany(items) { items.forEach(item => entries.set(item.key, structuredClone(item))); } },
    sleepImpl: async () => {}, fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body); requests.push(body);
      const { request, records } = parse(body), raw = { values: {}, statuses: {}, sources: {} };
      for (const field of request.template.fields) {
        raw.values[field.id] = 'Local response with a supplied source.'; raw.statuses[field.id] = 'supported';
        raw.sources[field.id] = [records.find(r => r.sectionKind === 'main')?.paragraphId || records[0].paragraphId];
      }
      return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(raw) } }] }), { status: 200 });
    }
  });
  for (const m of [
    { type: 'LLM_SAVE_PROFILE', profile: { id: 'profile_note016', name: 'Offline note fixture', providerId: 'deepseek', contextWindowTokens,
      config: { apiKey: 'offline-only', model: 'deepseek-flash', reasoningEnabled: false } } },
    { type: 'LLM_UPDATE_PROFILE_ROUTING', globalProfileId: 'profile_note016', taskRoutes: {} },
    { type: 'LLM_UPDATE_PREFERENCES', preferences: { mode: 'llm', consentGranted: true } }
  ]) assert.equal((await router.handle(m)).success, true);
  return { requests, entries, run: m => router.handle(m) };
}
function message() {
  return { type: 'LLM_AUTOFILL_LITERATURE_NOTE', template: api.normalizeLiteratureNoteTemplates()[0],
    document: { sourceKind: 'html-canonical', documentHash: 'note016-router', paragraphs: [
      { paragraphId: 'main', sourceKey: 'original-main', sectionKind: 'main', sectionTitle: 'Comparison', text: 'The comparison supplies the result.' },
      { paragraphId: 'method', sectionKind: 'methods', text: 'Calibration assay method.' },
      ...Array.from({ length: 13 }, (_, i) => ({ paragraphId: `caption-${i}`, recordType: 'figure-caption',
        text: `${i < 5 ? `Fig. ${i + 1}` : `Extended Data Fig. ${i - 4}`}: Reported experiment.` }))
    ] } };
}
test('batch router sends neutral main, methods and complete captions with v6 guide and per-field limits', async () => {
  const h = await harness(), m = message(), before = JSON.stringify(m), result = await h.run(m);
  assert.equal(result.success, true, JSON.stringify(result.error));
  const { records, request } = parse(h.requests[0]);
  assert.equal(records.find(r => r.paragraphId === 'main')?.sectionKind, 'main');
  assert.equal(records.find(r => r.paragraphId === 'method')?.sectionKind, 'methods');
  assert.equal(result.data.evidenceReceipt.captionCoverage.completeParagraphIds.length, 13);
  assert.match(request.template.fields.find(f => f.id === 'main_findings').prompt, /Extended Data Fig\. 8/);
  assert.match(h.requests[0].messages[0].content, /"important_methods":\{"type":"array","maxItems":12/);
  assert.match(h.requests[0].messages[0].content, /"main_findings":\{"type":"array","maxItems":32/);
  assert.equal((await h.run(m)).data.cacheHit, true);
  assert.equal(h.requests.length, 1); assert.equal(JSON.stringify(m), before);
});
test('caption policy cache is isolated from pre-Extended-Data interpretation without deleting prior entry', async () => {
  const h = await harness(), m = message();
  m.template.fields = m.template.fields.filter(f => f.id === 'main_findings');
  const first = await h.run(m);
  assert.equal(first.success, true);
  const id = first.data.operationReceipt.cacheIdentity;
  const legacyKey = 'literature-note:' + api.stableHash({ version: 5, guidance: '6',
    documentHash: id.documentHash, evidence: id.evidenceSignature, template: id.templateSignature,
    profile: id.profileSignature, outputLanguage: id.outputLanguage });
  const old = structuredClone(h.entries.get(id.cacheKey)); old.key = legacyKey;
  old.normalized.values.main_findings = 'Historical untouched value.';
  h.entries.delete(id.cacheKey); h.entries.set(legacyKey, old);
  const before = JSON.stringify(old), fresh = await h.run(m);
  assert.equal(fresh.data.cacheHit, false);
  assert.notEqual(fresh.data.operationReceipt.cacheIdentity.cacheKey, legacyKey);
  assert.equal(JSON.stringify(h.entries.get(legacyKey)), before);
});
test('batch complete-request budget guard rejects oversized input before network and cache writes', async () => {
  const h = await harness(16384), m = message();
  m.document.paragraphs.unshift(...Array.from({ length: 24 }, (_, i) => ({ paragraphId: `large-${i}`, sectionKind: 'main',
    text: 'Reported experimental condition and its controlled measured comparison. '.repeat(45) })));
  const result = await h.run(m);
  assert.equal(result.success, false); assert.equal(result.error.code, 'CONTEXT_BUDGET_EXCEEDED');
  assert.equal(h.requests.length, 0); assert.equal(h.entries.size, 0);
});
