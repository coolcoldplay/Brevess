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

function template(ids = ['research_background']) {
  const t = api.normalizeLiteratureNoteTemplates()[0];
  t.fields = t.fields.filter(f => ids.includes(f.id));
  return t;
}
function message(t = template(), sourceKind = 'html-canonical') {
  return { type: 'LLM_AUTOFILL_LITERATURE_NOTE', template: t,
    document: { sourceKind, title: 'Public synthetic temporal distinction', documentHash: 'before-study-paper',
      paragraphs: [{ paragraphId: 'intro', sourceIdentity: 'intro:1', textHash: 'intro-hash',
        sectionKind: 'introduction', text: 'Before this study, prior work established the terminology but the outcome remained unknown.' },
      { paragraphId: 'result', sourceIdentity: 'results:1', textHash: 'results-hash', sectionKind: 'results',
        text: 'This study found a new outcome after its experimental intervention.' }] } };
}
function compile(t, language = 'zh-CN') {
  const prompt = api.compileLiteratureNoteAutofillPrompt(t, { version: '2', stableText: '' }, { outputLanguage: language });
  return JSON.parse(prompt.userPrompt.split('LITERATURE_NOTE_REQUEST:\n')[1]).template.fields;
}

test('default basic-research background locates all three sections before the study and excludes new findings from definitions', () => {
  for (const lang of ['zh-CN', 'en']) {
    const guide = compile(template(), lang)[0].prompt;
    assert.match(guide, /all three.*before (?:this|the) study (?:began|started)/i);
    assert.match(guide, /definitions?.*(?:explain|clarify).*terms? only/i);
    assert.match(guide, /(?:do not|never).*this study.*methods?.*findings?.*conclusions?.*(?:definitions?|prior|known)/i);
    assert.match(guide, /new findings.*main_findings/i);
    assert.doesNotMatch(guide, /BAPTA|HF-TAC|HFSC|sympathetic|RTX/);
    for (const heading of lang === 'en' ? ['Key concepts', 'Current knowledge', 'Unknowns and contradictions'] : ['关键概念', '现状与已知', '未知与矛盾']) assert.ok(guide.includes(heading));
  }
});

test('background guidance version follows actual default matching, including default background in multifield templates', () => {
  assert.equal(typeof api.getLiteratureNoteBackgroundGuidanceVersion, 'function');
  assert.equal(api.getLiteratureNoteBackgroundGuidanceVersion(template()), '1');
  assert.equal(api.getLiteratureNoteBackgroundGuidanceVersion(template(['research_background', 'main_findings'])), '1');
  for (const mutate of [t => { t.fields[0].prompt = 'Use my own temporal scope'; },
    t => { t.fields[0].label = 'My renamed field'; }, t => { t.studyFamily = 'custom'; },
    t => { t.id = 'custom_template'; }]) {
    const t = template(); mutate(t);
    assert.equal(api.getLiteratureNoteBackgroundGuidanceVersion(t), '');
    assert.doesNotMatch(compile(t)[0].prompt, /all three.*before.*study/i);
  }
  assert.equal(api.getLiteratureNoteBackgroundGuidanceVersion(template(['main_findings'])), '');
  const custom = template(); custom.fields[0].prompt = 'Use my own temporal scope';
  assert.equal(compile(custom)[0].prompt, custom.fields[0].prompt);
});

async function harness() {
  const values = {}, entries = new Map(), requests = [];
  const router = createBackgroundRouter({
    storageArea: { get(key, cb) { cb({ [key]: values[key] }); }, set(input, cb) { Object.assign(values, input); cb(); } },
    cacheStore: { async getMany(keys) { return new Map(keys.filter(k => entries.has(k)).map(k => [k, entries.get(k)])); },
      async setMany(items) { for (const item of items) entries.set(item.key, structuredClone(item)); } },
    sleepImpl: async () => {}, fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body); requests.push(body);
      const payload = JSON.parse(body.messages[1].content.split('LITERATURE_NOTE_REQUEST:\n')[1]);
      const raw = { values: {}, statuses: {}, sources: {} };
      for (const field of payload.template.fields) {
        raw.values[field.id] = '有原文支持的限定内容。'; raw.statuses[field.id] = 'supported'; raw.sources[field.id] = ['intro'];
      }
      return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(raw) } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
  });
  assert.equal((await router.handle({ type: 'LLM_SAVE_PROVIDER', providerId: 'deepseek', config: { apiKey: 'synthetic-no-network', model: 'deepseek-flash' } })).success, true);
  assert.equal((await router.handle({ type: 'LLM_UPDATE_PREFERENCES', preferences: { mode: 'llm', providerId: 'deepseek', consentGranted: true } })).success, true);
  return { entries, requests, run: m => router.handle(m) };
}
function historicalKey(identity, m) {
  const policy = api.resolveLiteratureNoteEvidencePolicy(m.template, m.document);
  return 'literature-note:' + api.stableHash({ version: 5,
    ...(policy.id ? { guidance: api.LITERATURE_NOTE_HTML_FINDINGS_GUIDANCE_VERSION, captionLabels: 'extended-data-v1' } : {}),
    documentHash: identity.documentHash, evidence: identity.evidenceSignature,
    template: identity.templateSignature, profile: identity.profileSignature, outputLanguage: identity.outputLanguage });
}

test('new default background ignores old cache without deleting it and reuses only its new guidance cache', async () => {
  for (const [ids, kind] of [[['research_background'], 'html-canonical'],
    [['research_background', 'main_findings'], 'html-canonical'], [['research_background'], 'pdf-semantic']]) {
    const h = await harness(), m = message(template(ids), kind), before = JSON.stringify(m);
    const first = await h.run(m); assert.equal(first.success, true, JSON.stringify(first.error));
    const identity = first.data.operationReceipt.cacheIdentity, oldKey = historicalKey(identity, m);
    const old = structuredClone(h.entries.get(identity.cacheKey));
    old.key = oldKey; old.normalized.values.research_background = 'Old cached study findings mislabeled as prior knowledge.';
    h.entries.clear(); h.entries.set(oldKey, old); // Fixture setup only, not a production mutation.
    const fresh = await h.run(m);
    assert.equal(fresh.success, true, JSON.stringify(fresh.error));
    assert.equal(fresh.data.cacheHit, false);
    assert.notEqual(fresh.data.operationReceipt.cacheIdentity.cacheKey, oldKey);
    assert.equal(h.requests.length, 2);
    assert.deepEqual(h.entries.get(oldKey), old);
    assert.notEqual(fresh.data.values.research_background, old.normalized.values.research_background);
    const reused = await h.run(m);
    assert.equal(reused.data.cacheHit, true); assert.equal(h.requests.length, 2);
    assert.deepEqual(reused.data.values, fresh.data.values);
    assert.equal(JSON.stringify(m), before);
  }
});

test('custom background retains legacy cache identity while default findings use their scoped caption version', async () => {
  const variants = [t => { t.fields[0].prompt = 'My explicit custom instruction'; },
    t => { t.fields[0].label = 'Repurposed'; }, t => { t.studyFamily = 'custom'; }];
  const templates = variants.map(change => { const t = template(); change(t); return t; });
  templates.push(template(['main_findings']));
  const multiCustom = template(['research_background', 'main_findings']); multiCustom.fields[0].prompt = 'Custom background'; templates.push(multiCustom);
  for (const t of templates) {
    const h = await harness(), m = message(t), first = await h.run(m);
    assert.equal(first.success, true, JSON.stringify(first.error));
    const identity = first.data.operationReceipt.cacheIdentity;
    assert.equal(identity.cacheKey, historicalKey(identity, m));
    const raw = h.entries.get(identity.cacheKey), id = t.fields[0].id;
    raw.normalized.values[id] = 'Preserved historical value';
    const again = await h.run(m);
    assert.equal(again.data.cacheHit, true); assert.equal(h.requests.length, 1);
    assert.equal(again.data.values[id], 'Preserved historical value');
  }
});
