// Actual router + token manager + DeepSeek wire serialization, with local responses only.
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

function message(sourceKind = 'html-canonical', custom = false) {
  const template = api.normalizeLiteratureNoteTemplates()[0];
  template.fields = template.fields.filter(f => f.id === 'main_findings');
  if (custom) template.fields[0].prompt = 'Keep my own extraction instruction.';
  return { type: 'LLM_AUTOFILL_LITERATURE_NOTE', template,
    document: { sourceKind, title: 'Source-count cache fixture', documentHash: 'source-count-cache',
      paragraphs: [{ paragraphId: 'source-1', sourceKey: 'source:1', textHash: 'source-hash',
        sectionKind: 'results', text: 'Figure 1 establishes the synthetic controlled comparison.' }] } };
}
async function harness() {
  const values = {}, entries = new Map(), requests = [];
  const router = createBackgroundRouter({
    storageArea: { get(key, cb) { cb({ [key]: values[key] }); }, set(input, cb) { Object.assign(values, input); cb(); } },
    cacheStore: { async getMany(keys) { return new Map(keys.filter(k => entries.has(k)).map(k => [k, entries.get(k)])); },
      async setMany(items) { for (const item of items) entries.set(item.key, structuredClone(item)); } },
    sleepImpl: async () => {}, fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body); requests.push(body);
      return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({
        values: { main_findings: '- Figure 1: supported synthetic comparison.' }, statuses: { main_findings: 'supported' },
        sources: { main_findings: ['source-1'] }
      }) } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
  });
  assert.equal((await router.handle({ type: 'LLM_SAVE_PROVIDER', providerId: 'deepseek', config: { apiKey: 'offline-only', model: 'deepseek-flash' } })).success, true);
  assert.equal((await router.handle({ type: 'LLM_UPDATE_PREFERENCES', preferences: { mode: 'llm', providerId: 'deepseek', consentGranted: true } })).success, true);
  return { entries, requests, run: m => router.handle(m) };
}
function oldKey(identity, active) {
  return 'literature-note:' + api.stableHash({ version: 5, ...(active ? { guidance: '5' } : {}),
    documentHash: identity.documentHash, evidence: identity.evidenceSignature, template: identity.templateSignature,
    profile: identity.profileSignature, outputLanguage: identity.outputLanguage });
}

test('active v6 skips intact v5 cache, sends the new guide, then reuses only its v6 result', async () => {
  const h = await harness(), m = message(), frozenInput = JSON.stringify(m);
  const first = await h.run(m); assert.equal(first.success, true, JSON.stringify(first.error));
  const identity = first.data.operationReceipt.cacheIdentity, legacyKey = oldKey(identity, true);
  const old = structuredClone(h.entries.get(identity.cacheKey));
  old.key = legacyKey; old.normalized.values.main_findings = 'Historical cached note remains unchanged.';
  h.entries.clear(); h.entries.set(legacyKey, old); // Isolated synthetic cache setup.
  const oldSnapshot = structuredClone(old), fresh = await h.run(m);
  assert.equal(fresh.success, true, JSON.stringify(fresh.error));
  assert.equal(fresh.data.cacheHit, false);
  assert.notEqual(fresh.data.operationReceipt.cacheIdentity.cacheKey, legacyKey);
  assert.equal(h.requests.length, 2);
  assert.deepEqual(h.entries.get(legacyKey), oldSnapshot);
  const wireGuide = JSON.parse(h.requests[1].messages[1].content.split('LITERATURE_NOTE_REQUEST:\n')[1]).template.fields[0].prompt;
  assert.match(wireGuide, /at most 32 distinct supplied paragraphIds/);
  const reused = await h.run(m);
  assert.equal(reused.data.cacheHit, true); assert.equal(h.requests.length, 2);
  assert.deepEqual(reused.data.values, fresh.data.values);
  assert.equal(JSON.stringify(m), frozenInput);
});

test('PDF and custom main-finding requests retain their old cache identity and stored value', async () => {
  for (const m of [message('pdf-semantic'), message('html-canonical', true)]) {
    const h = await harness(), first = await h.run(m);
    assert.equal(first.success, true, JSON.stringify(first.error));
    const identity = first.data.operationReceipt.cacheIdentity;
    assert.equal(identity.cacheKey, oldKey(identity, false));
    h.entries.get(identity.cacheKey).normalized.values.main_findings = 'Historical custom/PDF note.';
    const again = await h.run(m);
    assert.equal(again.data.cacheHit, true); assert.equal(h.requests.length, 1);
    assert.equal(again.data.values.main_findings, 'Historical custom/PDF note.');
  }
});
