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

function message({ count = 14, large = false } = {}) {
  const template = api.normalizeLiteratureNoteTemplates()[0];
  template.fields = template.fields.filter(field => field.id === 'main_findings');
  return { type: 'LLM_AUTOFILL_LITERATURE_NOTE', operationId: 'note011-units', template,
    document: { sourceKind: 'html-canonical', title: 'Synthetic complete-caption budget', documentHash: 'c'.repeat(64),
      paragraphs: [{ paragraphId: 'body-1', sourceIdentity: 'body:1', textHash: 'body-hash', sectionKind: 'introduction', text: 'A controlled experiment supports the result.' },
        ...Array.from({ length: count }, (_, i) => ({ paragraphId: `caption-${i + 1}`, sourceIdentity: `raw-caption-${i + 1}`,
          textHash: `caption-hash-${i + 1}`, recordType: 'figure-caption', sectionKind: 'figure', sectionTitle: `Figure ${i + 1}`,
          text: (`Figure ${i + 1}. Independent controlled experimental finding. ` + 'Original caption. '.repeat(large ? 105 : 2)).trim() }))] } };
}
function records(body) {
  return body.messages[1].content.split('\n').flatMap(line => {
    try { const record = JSON.parse(line); return record.paragraphId ? [record] : []; } catch { return []; }
  });
}
function answer(body) {
  const request = JSON.parse(body.messages[1].content.split('LITERATURE_NOTE_REQUEST:\n')[1]);
  const raw = { values: {}, statuses: {}, sources: {} };
  for (const field of request.template.fields) {
    raw.values[field.id] = '有明确原文来源的实验发现。'; raw.statuses[field.id] = 'supported';
    raw.sources[field.id] = [records(body)[0].paragraphId];
  }
  return JSON.stringify(raw);
}
async function harness(respond = body => ({ content: answer(body) }), { tokenRule, contextWindowTokens } = {}) {
  const values = {}, requests = [], progress = [], entries = new Map();
  const router = createBackgroundRouter({
    storageArea: { get(key, done) { done({ [key]: values[key] }); }, set(input, done) { Object.assign(values, input); done(); } },
    cacheStore: { async getMany(keys) { return new Map(keys.filter(key => entries.has(key)).map(key => [key, entries.get(key)])); },
      async setMany(items) { items.forEach(item => entries.set(item.key, structuredClone(item))); } },
    sleepImpl: async () => {}, fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body); requests.push(body);
      const value = respond(body, requests.length), status = value.status || 200;
      return new Response(JSON.stringify(status === 200
        ? { choices: [{ finish_reason: value.finish || 'stop', message: { content: value.content || '' } }] }
        : { error: { message: 'Local simulated transport error' } }), { status, headers: { 'Content-Type': 'application/json' } });
    }
  });
  for (const request of [
    { type: 'LLM_SAVE_PROFILE', profile: { id: 'profile_note011_units', name: 'Local budget test', providerId: 'deepseek',
      contextWindowTokens,
      config: { apiKey: 'synthetic-never-sent', model: 'deepseek-flash', maxOutputTokens: 8192, reasoningEnabled: false } } },
    { type: 'LLM_UPDATE_PROFILE_ROUTING', globalProfileId: 'profile_note011_units', taskRoutes: {} },
    { type: 'LLM_UPDATE_PREFERENCES', preferences: { mode: 'llm', consentGranted: true } }
  ]) assert.equal((await router.handle(request)).success, true);
  if (tokenRule) {
    const policies = structuredClone(values.sciLlmSettingsV2.taskPolicies);
    policies.literature_note_autofill.tokenRule = tokenRule;
    assert.equal((await router.handle({ type: 'LLM_UPDATE_PROFILE_ROUTING', taskPolicies: policies })).success, true);
  }
  return { router, requests, progress, entries,
    run: (m = message()) => router.handle(m, { onProgress: event => progress.push(event) }) };
}

function largeBodyMessage() {
  const m = message({ large: true });
  m.document.paragraphs.unshift(...Array.from({ length: 23 }, (_, i) => ({
    paragraphId: `results-${i}`, sourceKey: `results-key-${i}`, textHash: `results-hash-${i}`,
    sectionKind: 'results', sectionTitle: `Controlled comparison ${i}`,
    text: `Direction ${i}: the control had no effect, while the intervention prevented the measured outcome. ` + 'Specific observed evidence with its experimental conditions. '.repeat(48)
  })));
  return m;
}
test('active Figure findings sends complete result paragraphs beyond the old 36k budget', async () => {
  const m = largeBodyMessage(), h = await harness();
  const result = await h.run(m); assert.equal(result.success, true, JSON.stringify(result.error));
  const sent = records(h.requests[0]);
  for (const expected of m.document.paragraphs) {
    assert.equal(sent.find(record => record.paragraphId === expected.paragraphId)?.text, expected.text.trim());
  }
  const evidenceText = h.requests[0].messages[1].content.split('CANONICAL_ARTICLE_EVIDENCE_V2:\n')[1].split('\nLITERATURE_NOTE_REQUEST:\n')[0];
  assert.ok(evidenceText.length > 52000 && evidenceText.length <= 128000);
  assert.equal(h.requests[0].max_tokens, 7424);
});
test('active evidence respects actual profile context override before any provider call or cache write', async () => {
  const h = await harness(undefined, { contextWindowTokens: 16384 });
  const result = await h.run(largeBodyMessage());
  assert.equal(result.success, false);
  assert.equal(result.error.code, 'CONTEXT_BUDGET_EXCEEDED');
  assert.equal(h.requests.length, 0); assert.equal(h.entries.size, 0);
  assert.equal(h.progress.some(event => /retry/.test(event.phase)), false);
});
test('active evidence obeys explicit task input cap without altering output or compacting away results', async () => {
  const h = await harness(undefined, { tokenRule: { input: { sourceCapTokens: 1024 }, output: {} } });
  const result = await h.run(largeBodyMessage());
  assert.equal(result.success, false); assert.equal(result.error.code, 'CONTEXT_BUDGET_EXCEEDED');
  assert.equal(h.requests.length, 0);
});

test('actual token manager gives 14 complete captions 7424 initial and one bounded 12288 retry', async () => {
  const h = await harness((body, n) => n === 1 ? { finish: 'length', content: '{"values":' } : { content: answer(body) });
  const result = await h.run(); assert.equal(result.success, true, JSON.stringify(result.error));
  assert.deepEqual(h.requests.map(body => body.max_tokens), [7424, 12288]);
  assert.equal(h.requests[1].messages[1].content, h.requests[0].messages[1].content);
  assert.equal(result.data.operationReceipt.providerAttempts, 1, 'token retry stays inside the original adapter invocation');
  assert.equal(h.progress.filter(event => event.phase === 'output_token_retry').length, 1);
  assert.equal(result.data.evidenceReceipt.captionCoverage.completeParagraphIds.length, 14);
});

test('repeated truncation still fails after exactly the existing single adapter retry', async () => {
  const h = await harness(() => ({ finish: 'length', content: '{"values":' }));
  const result = await h.run(); assert.equal(result.success, false); assert.equal(result.error.code, 'OUTPUT_TRUNCATED');
  assert.deepEqual(h.requests.map(body => body.max_tokens), [7424, 12288]);
  assert.equal(h.entries.size, 0); assert.equal(h.progress.some(e => e.phase === 'literature_note_schema_retry'), false);
});

test('network compact retry recomputes units from only the complete captions actually sent', async () => {
  const h = await harness((body, n) => n === 1 ? { status: 503 } : { content: answer(body) });
  const result = await h.run(message({ large: true })); assert.equal(result.success, true, JSON.stringify(result.error));
  const completeIds = result.data.evidenceReceipt.captionCoverage.completeParagraphIds;
  assert.ok(completeIds.length > 0 && completeIds.length < 14);
  const expected = api.computeOutputTokenBudget('literature_note_autofill', {
    tokenPolicy: { mode: 'auto', autoCap: 12288 }, units: Math.max(2, completeIds.length)
  }).initial;
  assert.deepEqual(h.requests.map(body => body.max_tokens), [7424, expected]);
  assert.ok(expected < 7424); assert.equal(result.data.operationReceipt.providerAttempts, 2);
  assert.deepEqual(records(h.requests[1]).filter(r => r.sectionKind === 'figure').map(r => r.paragraphId), completeIds);
});

test('complete-caption units obey the active source bound and the configured task rule', async () => {
  const tokenRule = { output: { base: 512, perUnit: 256, floor: 512, ceiling: 12288 } };
  const h = await harness(undefined, { tokenRule }), m = message({ count: 40 });
  const result = await h.run(m); assert.equal(result.success, true, JSON.stringify(result.error));
  assert.equal(result.data.evidenceReceipt.captionCoverage.completeParagraphIds.length, 40);
  const policy = api.resolveLiteratureNoteEvidencePolicy(m.template, { sourceKind: 'html-canonical' });
  assert.equal(policy.maxSources, 32);
  const expected = api.computeOutputTokenBudget('literature_note_autofill', {
    taskRule: tokenRule, tokenPolicy: { mode: 'auto', autoCap: 12288 }, units: policy.maxSources
  }).initial;
  assert.equal(expected, 8704); assert.deepEqual(h.requests.map(body => body.max_tokens), [expected]);
});

test('zero or one complete caption never lowers the old minimum of two units', async () => {
  for (const count of [0, 1]) {
    const h = await harness(), result = await h.run(message({ count }));
    assert.equal(result.success, true); assert.deepEqual(h.requests.map(body => body.max_tokens), [2304]);
  }
});

test('PDF, custom prompt/label and background requests retain the old budget and prompt contracts', async () => {
  const variants = [m => { m.document.sourceKind = 'pdf-semantic'; }, m => { delete m.document.sourceKind; },
    m => { m.template.fields[0].prompt = 'My own brief instruction'; }, m => { m.template.fields[0].label = 'Repurposed'; },
    m => { m.template.fields = api.normalizeLiteratureNoteTemplates()[0].fields.filter(f => f.id === 'research_background'); }];
  for (const mutate of variants) {
    const m = message(); mutate(m);
    const h = await harness(), result = await h.run(m);
    assert.equal(result.success, true, JSON.stringify(result.error));
    assert.deepEqual(h.requests.map(body => body.max_tokens), [2304]);
    const sent = JSON.parse(h.requests[0].messages[1].content.split('LITERATURE_NOTE_REQUEST:\n')[1]);
    assert.deepEqual(sent.template.fields.map(f => f.id), m.template.fields.map(f => f.id));
    if (m.template.fields[0].prompt) assert.equal(sent.template.fields[0].prompt, m.template.fields[0].prompt);
    assert.equal(result.data.evidenceReceipt.noteEvidencePolicyId, undefined);
  }
});

test('production token manager preserves explicit manual/automatic/model caps without truncation retries at the cap', async () => {
  // Profile normalization currently always returns auto/null. Test explicit budget
  // contracts here, without pretending LLM_SAVE_PROFILE preserves a manual cap.
  for (const scenario of [
    { tokenPolicy: { mode: 'manual', manualMax: 3072 }, adapterCap: 65536, expected: 3072 },
    { tokenPolicy: { mode: 'auto', autoCap: 4096 }, adapterCap: 65536, expected: 4096 },
    { tokenPolicy: { mode: 'auto', autoCap: 12288 }, adapterCap: 4096, expected: 4096 }
  ]) {
    const requests = [];
    const rawAdapter = api.createDeepSeekAdapter({ model: 'deepseek-flash', apiKey: 'synthetic-never-sent' }, async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return new Response(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: '{"values":' } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    const adapter = api.createTokenManagedAdapter({ kind: 'literature_note_autofill', rawAdapter,
      tokenPolicy: scenario.tokenPolicy, adapterCap: scenario.adapterCap, maxTruncationRetries: 1 });
    await assert.rejects(adapter.generateJson({ userPrompt: 'Local budget contract', outputUnits: 14 }),
      error => error.code === 'OUTPUT_TRUNCATED');
    assert.deepEqual(requests.map(body => body.max_tokens), [scenario.expected]);
  }
});

test('format repair reuses the current caption budget without new source compaction', async () => {
  const h = await harness((body, n) => ({ content: n === 1 ? '{"values":' : answer(body) }));
  const result = await h.run(); assert.equal(result.success, true, JSON.stringify(result.error));
  assert.deepEqual(h.requests.map(body => body.max_tokens), [7424, 7424]);
  assert.equal(h.requests[1].messages[1].content, h.requests[0].messages[1].content);
  assert.match(h.requests[1].messages[0].content, /SCHEMA_REPAIR_PASS/);
  assert.equal(result.data.operationReceipt.providerAttempts, 2);
});

test('current caption-label cache identity preserves schema3 values without budget-based invalidation', async () => {
  const h = await harness(), first = await h.run(); assert.equal(first.success, true);
  const identity = first.data.operationReceipt.cacheIdentity;
  const expectedKey = `literature-note:${api.stableHash({ version: 5,
    guidance: api.LITERATURE_NOTE_HTML_FINDINGS_GUIDANCE_VERSION,
    captionLabels: 'extended-data-v1',
    documentHash: identity.documentHash, evidence: identity.evidenceSignature,
    template: identity.templateSignature, profile: identity.profileSignature, outputLanguage: identity.outputLanguage })}`;
  assert.equal(identity.cacheKey, expectedKey);
  const raw = structuredClone(h.entries.get(expectedKey));
  assert.equal(raw.schemaVersion, 3); assert.equal(Object.hasOwn(raw, 'outputUnits'), false);
  raw.normalized.values.main_findings = '旧缓存中已有且来源合法的人工保留文本。';
  h.entries.set(expectedKey, raw);
  const cached = await h.run({ ...message(), operationId: 'note011-units-cached' });
  assert.equal(cached.data.cacheHit, true); assert.equal(cached.data.operationReceipt.providerAttempts, 0);
  assert.equal(cached.data.values.main_findings, raw.normalized.values.main_findings);
  assert.deepEqual(cached.data.evidenceReceipt, first.data.evidenceReceipt); assert.equal(h.requests.length, 1);
});

test('input caps include the actual schema example wrapper even for zero or one Figure caption', async () => {
  for (const count of [0, 1]) {
    const m = message({ count });
    const policy = api.resolveLiteratureNoteEvidencePolicy(m.template, m.document);
    const document = api.buildResearchEvidenceDocument(m.document, { maxCharacters: 128000, noteEvidencePolicy: policy });
    const prompt = api.compileLiteratureNoteAutofillPrompt(m.template, document, {
      outputLanguage: 'zh-CN', noteEvidencePolicy: policy
    });
    const localized = api.applyOutputLanguageContract(prompt, 'zh-CN');
    const previousEstimate = api.estimateArticleChatTokens(JSON.stringify({
      system: localized.systemPrompt, user: localized.userPrompt, schema: localized.responseSchema
    }));
    const actualWrappedEstimate = api.estimateArticleChatTokens(
      `${api.withStructuredSchemaPrompt(localized)}\n${localized.userPrompt}`
    );
    assert.ok(actualWrappedEstimate > previousEstimate, 'fixture reproduces the real omitted wrapper boundary');
    const h = await harness(undefined, { tokenRule: { input: { sourceCapTokens: previousEstimate }, output: {} } });
    const result = await h.run(m);
    assert.equal(result.success, false);
    assert.equal(result.error.code, 'CONTEXT_BUDGET_EXCEEDED');
    assert.equal(h.requests.length, 0);
    assert.equal(h.entries.size, 0);
    assert.equal(h.progress.some(event => /retry/.test(event.phase)), false);
  }
});

test('an output-only task override cannot remove the larger NOTE input safety margin', async () => {
  const normalized = api.normalizeTaskTokenRule('literature_note_autofill', { output: {} });
  assert.equal(normalized.input.safetyRatio, 1);
  assert.equal(normalized.input.reservedTokens, 0);
  for (const tokenRule of [undefined, { output: {} }]) {
    const h = await harness(undefined, { contextWindowTokens: 16384, tokenRule });
    const result = await h.run(message({ count: 1 }));
    assert.equal(result.success, false);
    assert.equal(result.error.code, 'CONTEXT_BUDGET_EXCEEDED');
    assert.equal(h.requests.length, 0);
    assert.equal(h.entries.size, 0);
    assert.equal(h.progress.some(event => /retry/.test(event.phase)), false);
  }
});
