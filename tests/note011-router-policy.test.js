// Production router contracts with synthetic local responses; no model/network/browser calls.
const test = require('node:test');
const assert = require('node:assert/strict');
for (const file of [
  "../core/category-store.js",
  "../core/i18n.js",
  "../core/adaptive-catalog.js",
  "../core/study-profile.js",
  "../core/confidence-policy.js",
  "../core/settings-store.js",
  "../providers/provider-utils.js",
  "../core/prompt-compiler.js",
  "../core/provider-probes.js",
  "../core/chunker.js",
  "../core/result-validator.js",
  "../core/semantic-find.js",
  "../core/evidence-ledger.js",
  "../core/figure-analysis.js",
  "../core/figure-panel-planner.js",
  "../core/figure-panel-recovery.js",
  "../core/supplemental-materials.js",
  "../core/article-chat-tokenizer.js",
  "../core/article-chat-index.js",
  "../core/article-chat-retrieval.js",
  "../core/article-chat-memory.js",
  "../core/article-chat-citations.js",
  "../core/article-chat-stream.js",
  "../core/article-chat-web-sources.js",
  "../core/article-chat.js",
  "../core/research-evidence.js",
  "../core/research-logic-pipeline.js",
  "../core/reading-tools.js",
  "../core/panel-ledger.js",
  "../core/cross-figure-logic.js",
  "../core/review-outline.js",
  "../core/abbreviation-extractor.js",
  "../core/cache-planner.js",
  "../core/privacy-sanitizer.js",
  "../core/article-workspace.js",
  "../core/article-workspace-save.js",
  "../core/pdf-workspace.js",
  "../core/article-workspace-store.js",
  "../core/figure-workspace.js",
  "../core/article-archive.js",
  "../core/directory-sync.js",
  "../core/migration-bundle.js",
  "../core/analysis-pipeline.js",
  "../core/analysis-cache.js",
  "../core/review-outline-pipeline.js",
  "../core/corpus-store.js",
  "../core/pdf-annotations.js",
  "../core/manual-annotations.js",
  "../core/document-store.js",
  "../providers/openai.js",
  "../providers/anthropic.js",
  "../providers/gemini.js",
  "../providers/deepseek.js",
  "../providers/codex-local.js",
  "../providers/openai-compatible.js",
  "../providers/provider-registry.js",
  "../core/provider-model-discovery.js",
  "../core/task-profile-router.js",
  "../core/token-budget.js",
  "../core/article-chat-context-planner.js",
  "../core/operation-control.js",
  "../core/mechanism-operation-coordinator.js",
  "../core/evidence-first-mechanism.js"
]) require(file);
const { createBackgroundRouter } = require('../core/background-router.js');
const api = globalThis.SciLLM;
const POLICY = 'html-basic-main-findings-v1';
const clone = value => structuredClone(value);
function storage() {
  const values = {};
  return { get(key, done) { done({ [key]: values[key] }); }, set(input, done) { Object.assign(values, input); done(); } };
}
function message({ large = false, sourceKind = 'html-canonical' } = {}) {
  const template = api.normalizeLiteratureNoteTemplates()[0];
  template.fields = template.fields.filter(f => f.id === 'main_findings');
  const captions = Array.from({ length: 14 }, (_, i) => ({ paragraphId: `caption-${i + 1}`, sourceIdentity: `raw-caption-${i + 1}`,
    sourceKey: `caption-key-${i + 1}`, textHash: `caption-hash-${i + 1}`, recordType: 'figure-caption', sectionKind: 'figure',
    sectionTitle: `Figure ${i + 1}`, text: (`Figure ${i + 1}. Original controlled experiment ${i + 1}. ` + 'caption content '.repeat(large ? 110 : 2)).trim() }));
  const body = Array.from({ length: large ? 14 : 1 }, (_, i) => ({ paragraphId: `body-${i + 1}`, sourceIdentity: `raw-body-${i + 1}`,
    sourceKey: `body-key-${i + 1}`, textHash: `body-hash-${i + 1}`, sectionKind: 'introduction',
    text: `Grounded premise ${i + 1}. ` + 'intro content '.repeat(large ? 200 : 2) }));
  return { type: 'LLM_AUTOFILL_LITERATURE_NOTE', operationId: 'note011-unit', template,
    document: { sourceKind, title: 'Synthetic paper', documentHash: 'a'.repeat(64), paragraphs: [...body, ...captions] } };
}
function requestRecords(body) {
  const text = body.input || body.messages?.find(m => m.role === 'user')?.content || '';
  return String(text).split('\n').flatMap(line => { try { const r = JSON.parse(line); return r.paragraphId ? [r] : []; } catch { return []; } });
}
function schema(body) { return body.text?.format?.schema || body.response_format?.json_schema?.schema; }
function answer(records, extra = {}) {
  return { values: { main_findings: '- Figure 1: synthetic bounded finding.' }, statuses: { main_findings: 'supported' },
    sources: { main_findings: records.filter(r => r.paragraphId.startsWith('caption-')).map(r => r.paragraphId) }, ...extra };
}
async function harness(respond, { cacheStore = api.createMemoryAnalysisCache(), storageArea = storage() } = {}) {
  const requests = [];
  const router = createBackgroundRouter({ storageArea, cacheStore, sleepImpl: async () => {}, fetchImpl: async (_url, options) => {
    const body = JSON.parse(options.body); requests.push(body);
    const value = await respond(body, requests.length);
    const status = value?.httpStatus || 200;
    return { ok: status === 200, status, headers: { get() { return null; } }, async text() { return JSON.stringify(status === 200 ? { output_text: JSON.stringify(value) } : {}); } };
  } });
  assert.equal((await router.handle({ type: 'LLM_SAVE_PROVIDER', providerId: 'openai', config: { apiKey: 'synthetic-never-sent', model: 'gpt-5.1' } })).success, true);
  assert.equal((await router.handle({ type: 'LLM_UPDATE_PREFERENCES', preferences: { mode: 'llm', providerId: 'openai', consentGranted: true } })).success, true);
  return { router, requests, cacheStore, storageArea };
}

test('actual router sends 14 complete captions and available body under active 128k cap and caches sources', async () => {
  const m = message({ large: true }), h = await harness(body => answer(requestRecords(body)));
  const first = await h.router.handle(m);
  assert.equal(first.success, true, JSON.stringify(first.error));
  assert.equal(schema(h.requests[0]).properties.sources.properties.main_findings.maxItems, 32);
  const stableEvidence = h.requests[0].input.split('CANONICAL_ARTICLE_EVIDENCE_V2:\n')[1].split('\nLITERATURE_NOTE_REQUEST:\n')[0];
  assert.ok(stableEvidence.length > 36000 && stableEvidence.length <= 128000);
  const records = requestRecords(h.requests[0]), expected = m.document.paragraphs.filter(r => r.recordType === 'figure-caption');
  for (const caption of expected) {
    const sent = records.find(r => r.paragraphId === caption.paragraphId);
    assert.equal(sent.text, caption.text); assert.equal(sent.sourceIdentity, caption.sourceIdentity); assert.equal(sent.textHash, caption.textHash);
  }
  assert.equal(first.data.sources.main_findings.length, 14);
  assert.equal(first.data.evidenceReceipt.noteEvidencePolicyId, POLICY);
  assert.equal(first.data.evidenceReceipt.captionCoverage.complete, true);
  assert.equal(first.data.evidenceReceipt.captionCoverage.completeParagraphIds.length, 14);
  const stored = (await h.cacheStore.getMany([first.data.operationReceipt.cacheIdentity.cacheKey])).get(first.data.operationReceipt.cacheIdentity.cacheKey);
  assert.deepEqual(stored.captionCoverage, first.data.evidenceReceipt.captionCoverage);
  const second = await h.router.handle({ ...m, operationId: 'cached' });
  assert.equal(second.data.cacheHit, true); assert.equal(h.requests.length, 1);
  assert.deepEqual(second.data.evidenceReceipt, first.data.evidenceReceipt);
});

test('compact retry records and caches actual partial coverage, never the full original coverage', async () => {
  const h = await harness((body, n) => n === 1 ? { httpStatus: 503 } : answer(requestRecords(body))), m = message({ large: true });
  const first = await h.router.handle(m);
  assert.equal(first.success, true, JSON.stringify(first.error)); assert.equal(h.requests.length, 2);
  const actual = requestRecords(h.requests[1]).filter(r => r.paragraphId.startsWith('caption-'));
  assert.ok(actual.length > 0 && actual.length < 14);
  const coverage = first.data.evidenceReceipt.captionCoverage;
  assert.equal(coverage.complete, false); assert.deepEqual(coverage.completeParagraphIds, actual.map(r => r.paragraphId));
  assert.equal(coverage.missingParagraphIds.length, 14 - actual.length);
  assert.deepEqual(first.data.sources.main_findings, actual.map(r => r.paragraphId));
  const again = await h.router.handle({ ...m, operationId: 'compact-cache' });
  assert.equal(again.data.cacheHit, true); assert.equal(h.requests.length, 2);
  assert.deepEqual(again.data.evidenceReceipt.captionCoverage, coverage);
});

test('schema repair uses the same 32 policy; unknown source remains fail-closed missing', async () => {
  for (const validRepair of [true, false]) {
    const h = await harness((body, n) => {
      assert.equal(schema(body).properties.sources.properties.main_findings.maxItems, 32);
      const raw = answer(requestRecords(body));
      if (n === 1 || !validRepair) raw.sources.main_findings[0] = 'foreign-id';
      return raw;
    });
    const result = await h.router.handle(message()); assert.equal(result.success, true);
    assert.equal(h.requests.length, 2); assert.match(h.requests[1].instructions, /SCHEMA_REPAIR_PASS/);
    assert.equal(result.data.statuses.main_findings, validRepair ? 'supported' : 'missing');
    assert.equal(result.data.sources.main_findings.length, validRepair ? 14 : 0);
  }
});

test('PDF, missing source kind and custom prompt/label keep max12; client supplied policy does not override', async () => {
  const mutations = [m => { delete m.document.sourceKind; }, m => { m.document.sourceKind = 'pdf-semantic'; },
    m => { m.document.sourceKind = 'pdf-native'; }, m => { m.template.fields[0].prompt = 'My custom instruction'; },
    m => { m.template.fields[0].label = 'Repurposed'; }];
  for (const mutate of mutations) {
    const m = message(); mutate(m); m.noteEvidencePolicy = { id: POLICY, sourceKind: 'html-canonical', maxSources: 32, captionFirst: true };
    const h = await harness(body => { assert.equal(schema(body).properties.sources.properties.main_findings.maxItems, 12); return answer(requestRecords(body)); });
    const result = await h.router.handle(m); assert.equal(result.success, true);
    assert.equal(result.data.statuses.main_findings, 'missing'); assert.deepEqual(result.data.sources.main_findings, []);
    assert.equal(result.data.evidenceReceipt.noteEvidencePolicyId, undefined); assert.equal(result.data.evidenceReceipt.captionCoverage, undefined);
  }
});

test('pre-policy default cache stays usable unchanged while active caption policy uses a separate key', async () => {
  const cacheStore = api.createMemoryAnalysisCache(), storageArea = storage();
  const h = await harness(body => { const raw = answer(requestRecords(body)); raw.sources.main_findings = raw.sources.main_findings.slice(0, 1); return raw; }, { cacheStore, storageArea });
  const m = message(); delete m.document.sourceKind;
  const old = await h.router.handle(m); assert.equal(old.success, true);
  const key = old.data.operationReceipt.cacheIdentity.cacheKey;
  const identity = old.data.operationReceipt.cacheIdentity;
  assert.equal(key, `literature-note:${api.stableHash({ version: 5, documentHash: identity.documentHash,
    evidence: identity.evidenceSignature, template: identity.templateSignature, profile: identity.profileSignature, outputLanguage: identity.outputLanguage })}`);
  const oldEntry = clone((await cacheStore.getMany([key])).get(key));
  assert.equal(oldEntry.captionCoverage, undefined);
  const reopened = await harness(body => answer(requestRecords(body)), { cacheStore, storageArea });
  const reused = await reopened.router.handle({ ...m, operationId: 'old-default-cache' });
  assert.equal(reused.data.cacheHit, true); assert.equal(reopened.requests.length, 0);
  const active = await reopened.router.handle({ ...m, document: { ...m.document, sourceKind: 'html-canonical' }, operationId: 'new-policy' });
  assert.equal(active.success, true); assert.equal(active.data.cacheHit, false); assert.equal(active.data.sources.main_findings.length, 14);
  assert.notEqual(active.data.operationReceipt.cacheIdentity.cacheKey, key);
  assert.deepEqual(clone((await cacheStore.getMany([key])).get(key)), oldEntry);
  const stillOld = await reopened.router.handle({ ...m, operationId: 'old-again' });
  assert.equal(stillOld.data.cacheHit, true); assert.deepEqual(stillOld.data.values, old.data.values); assert.equal(reopened.requests.length, 1);
});


test('active guidance revision ignores old caption-policy cache without deleting it and reuses the new key', async () => {
  const seed = await harness(body => answer(requestRecords(body))), m = message();
  const generated = await seed.router.handle(m); assert.equal(generated.success, true);
  const identity = generated.data.operationReceipt.cacheIdentity;
  const oldKey = 'literature-note:' + api.stableHash({ version: 5, documentHash: identity.documentHash,
    evidence: identity.evidenceSignature, template: identity.templateSignature, profile: identity.profileSignature, outputLanguage: identity.outputLanguage });
  const oldEntry = clone((await seed.cacheStore.getMany([identity.cacheKey])).get(identity.cacheKey));
  oldEntry.key = oldKey; oldEntry.normalized.values.main_findings = '- Figure 1: old guidance cached value.';
  const isolatedCache = api.createMemoryAnalysisCache(); await isolatedCache.setMany([oldEntry]);
  const h = await harness(body => answer(requestRecords(body)), { cacheStore: isolatedCache, storageArea: seed.storageArea });
  const fresh = await h.router.handle(m); assert.equal(fresh.success, true);
  assert.equal(fresh.data.cacheHit, false, 'old active-policy cache must not masquerade as new guidance output');
  assert.equal(h.requests.length, 1); assert.notEqual(fresh.data.operationReceipt.cacheIdentity.cacheKey, oldKey);
  assert.deepEqual(clone((await isolatedCache.getMany([oldKey])).get(oldKey)), oldEntry);
  const again = await h.router.handle(m); assert.equal(again.data.cacheHit, true); assert.equal(h.requests.length, 1);
  assert.deepEqual(again.data.values, fresh.data.values);
});
