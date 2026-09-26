// Acceptance guards only. Synthetic sources/responses here are never live or scientific evidence.
const test = require('node:test');
const assert = require('node:assert/strict');
const entry = import('../scripts/verify-note016-live-nature.mjs');
const production = import('../scripts/verify-note011-live-structure.mjs');
const clone = value => structuredClone(value);

async function fixture(single = false) {
  const m = await entry, api = (await production).loadProduction();
  const canonical = { title: m.ARTICLE_TITLE + ' | Nature', url: m.ARTICLE_URL, documentHash: 'unit-note016',
    paragraphs: Array.from({ length: 11 }, (_, i) => ({ paragraphId: `p-${String(i + 1).padStart(16, '0')}`,
      sourceKey: `body-${i}`, textHash: `text-${i}`, sectionKind: 'main', sectionTitle: m.RESULT_SECTIONS[i % 4],
      text: `Controlled comparison ${i + 1} showed a bounded observation with its own limitations.` })), typedRecords: [], diagnostics: { sourceCaptionDom: [] } };
  const labels = ['1', '2', '3', '4', '5', ...Array.from({ length: 8 }, (_, i) => `ED${i + 1}`)];
  for (const [i, id] of labels.entries()) {
    const label = id.startsWith('ED') ? `Extended Data Fig. ${id.slice(2)}` : `Fig. ${id}`;
    const description = `a, Controlled panel comparison ${id}. b, Independent measurement with reported conditions.`;
    canonical.typedRecords.push({ paragraphId: `p-${String(i + 101).padStart(16, '0')}`, sourceKey: `caption-${id}`,
      textHash: `caption-text-${id}`, recordType: 'figure-caption', sectionKind: 'main', text: `${label}: Measured observation. ${description}` });
    canonical.diagnostics.sourceCaptionDom.push({ label: { id, label }, caption: `${label}: Measured observation.`, description });
  }
  const template = api.normalizeLiteratureNoteTemplates()[0];
  if (single) template.fields = template.fields.filter(f => f.id === 'main_findings');
  const policy = api.resolveLiteratureNoteEvidencePolicy(template, { sourceKind: 'html-canonical' });
  const document = api.buildResearchEvidenceDocument({ ...canonical, sourceKind: 'html-canonical',
    paragraphs: [...canonical.paragraphs, ...canonical.typedRecords] }, { evidencePurpose: 'literature-note', maxCharacters: 128000, noteEvidencePolicy: policy });
  const prompt = api.compileLiteratureNoteAutofillPrompt(template, document, { outputLanguage: 'zh-CN', noteEvidencePolicy: policy });
  const body = { model: m.MODEL, stream: false, max_tokens: 12288,
    messages: [{ role: 'system', content: prompt.systemPrompt }, { role: 'user', content: prompt.userPrompt }] };
  return { m, api, canonical, template, policy, document, body };
}
function changeRecords(body, callback) {
  const copy = clone(body); copy.messages[1].content = copy.messages[1].content.split('\n').flatMap(line => {
    let value; try { value = JSON.parse(line); } catch { return [line]; }
    return value.paragraphId ? callback(value).map(r => JSON.stringify(r)) : [line];
  }).join('\n'); return copy;
}
function responseFor(f, count = 1) {
  const raw = { values: {}, statuses: {}, sources: {} };
  for (const field of f.template.fields) {
    raw.values[field.id] = 'A bounded source-supported observation.'; raw.statuses[field.id] = 'supported';
    raw.sources[field.id] = f.document.records.slice(0, count).map(r => r.paragraphId);
  }
  return JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(raw) } }] });
}

test('preflight never authorizes credential access; live CLI pins DS revision/hash and bounded costs', async () => {
  const m = await entry, hash = 'a'.repeat(64);
  assert.equal(m.parseArguments([]).executeLive, false);
  const args = ['--execute-live', '--portable-config', 'unread-test-path', '--profile', 'DS', '--config-sha256', hash, '--config-revision', '50'];
  assert.equal(m.parseArguments(args).callCap, 4);
  for (const extra of [['--call-cap', '6'], ['--call-cap', '0'], ['--provider-timeout-ms', '180001'], ['--deadline-ms', '1200001'],
    ['--preflight-only'], ['xxcall-cap', '2'], ['--model', 'deepseek-flash']]) assert.throws(() => m.parseArguments([...args, ...extra]));
  for (const replace of [['DS', 'other'], [hash, 'wrong'], ['50', '49']]) {
    assert.throws(() => m.parseArguments(args.map(a => a === replace[0] ? replace[1] : a)), { code: 'NOTE016_PROFILE_REQUIRED' });
  }
  let reads = 0;
  await assert.rejects(m.loadCredential(m.parseArguments([]), { loadProfile: async () => { reads++; } }), { code: 'NOTE016_LIVE_AUTHORIZATION_REQUIRED' });
  assert.equal(reads, 0);
});

test('canonical readiness requires genuine main body and thirteen full unique DOM-bound captions', async () => {
  const f = await fixture(), result = f.m.inspectCanonical(f.canonical);
  assert.equal(result.ready, true); assert.equal(result.mainCaptionCount, 5); assert.equal(result.extendedDataCaptionCount, 8);
  const titles = clone(f.canonical); titles.typedRecords.forEach((r, i) => { r.text = titles.diagnostics.sourceCaptionDom[i].caption; });
  assert.equal(f.m.inspectCanonical(titles).ready, false); assert.equal(f.m.inspectCanonical(titles).incompleteDescriptions.length, 13);
  const missing = clone(f.canonical); missing.typedRecords.splice(5); assert.equal(f.m.inspectCanonical(missing).ready, false);
  const relabelled = clone(f.canonical); relabelled.paragraphs[0].sectionKind = 'results'; assert.equal(f.m.inspectCanonical(relabelled).ready, false);
  const wrong = clone(f.canonical); wrong.url = 'https://example.org'; assert.throws(() => f.m.inspectCanonical(wrong), { code: 'NOTE016_SOURCE_IDENTITY' });
  const duplicate = clone(f.canonical); duplicate.typedRecords[1].text = duplicate.typedRecords[0].text;
  assert.throws(() => f.m.inspectCanonical(duplicate), { code: 'NOTE016_CAPTION_LABEL_AMBIGUOUS' });
});

test('caption label discovery never interprets panels/ranges/citations as figure identities', async () => {
  const m = await entry;
  assert.equal(m.figureLabelAtStart('Extended Data Fig. 8 Additional title.')?.id, 'ED8');
  assert.equal(m.figureLabelAtStart('Fig. 4: Title.')?.id, '4');
  for (const text of ['a, Observed outcome', 'See Fig. 4: title', 'Extended Data Fig. 1a: panel', 'Extended Data Fig. 1–2: range',
    'Extended Data Fig. 1 a, panel', 'Extended Data Fig. 1 and 2: range']) assert.equal(m.figureLabelAtStart(text), null, text);
});

test('full nine-field and single-main production prompts pass the exact source and guidance guard', async () => {
  for (const single of [false, true]) {
    const f = await fixture(single), result = f.m.inspectRequest(f.body, f.canonical, f.api);
    assert.equal(result.completeCaptionIds.length, 13); assert.equal(result.completeResultIds.length, 11);
    assert.equal(result.fieldIds.length, single ? 1 : 9); assert.equal(result.noteEvidencePolicy.captionFirst, true);
  }
});

test('source guard rejects foreign identities, altered main classification, truncation and duplicate evidence before transport', async () => {
  const f = await fixture();
  for (const key of ['paragraphId', 'sourceKey', 'textHash', 'sourceIdentity', 'documentHash', 'text']) {
    assert.throws(() => f.m.inspectRequest(changeRecords(f.body, r => [{ ...r, [key]: 'foreign' }]), f.canonical, f.api), { code: 'NOTE016_SOURCE_BINDING' });
  }
  assert.throws(() => f.m.inspectRequest(changeRecords(f.body, r => [r, r]), f.canonical, f.api), { code: 'NOTE016_SOURCE_BINDING' });
  assert.throws(() => f.m.inspectRequest(changeRecords(f.body, r => [{ ...r, sectionKind: 'results' }]), f.canonical, f.api), { code: 'NOTE016_MAIN_RELABELLED' });
  assert.throws(() => f.m.inspectRequest(changeRecords(f.body, r => [{ ...r, text: r.text.slice(0, 30) }]), f.canonical, f.api), { code: 'NOTE016_OUTBOUND_COVERAGE_INCOMPLETE' });
  const altered = clone(f.body); altered.messages[1].content = altered.messages[1].content.replace('关键概念', '伪造指导');
  assert.throws(() => f.m.inspectRequest(altered, f.canonical, f.api), { code: 'NOTE016_GUIDANCE_MISMATCH' });
  for (const change of [{ max_tokens: 12289 }, { model: 'other' }, { stream: true }]) assert.throws(() => f.m.inspectRequest({ ...f.body, ...change }, f.canonical, f.api));
});

test('portable profile must exactly match saved DS with no endpoint or model override and key is non-enumerable', async () => {
  const m = await entry, hash = 'a'.repeat(64), args = { executeLive: true, portableConfig: 'never-read', profile: 'DS', configSha256: hash, configRevision: 50 };
  const p = { name: 'DS', providerId: 'deepseek', model: m.MODEL, baseUrl: '', revision: 50, sourceSha256: hash, apiKey: 'synthetic-secret' };
  const credential = await m.loadCredential(args, { loadProfile: async () => p });
  assert.equal(credential.secret, p.apiKey); assert.doesNotMatch(JSON.stringify(credential), /synthetic-secret/);
  for (const change of [{ name: 'Old DS' }, { providerId: 'openai' }, { model: 'deepseek-pro' }, { baseUrl: 'https://api.deepseek.com/' }, { revision: 49 }, { sourceSha256: 'b'.repeat(64) }]) {
    await assert.rejects(m.loadCredential(args, { loadProfile: async () => ({ ...p, ...change }) }), { code: 'NOTE016_PROFILE_MISMATCH' });
  }
});

test('forwarder validates budget arguments and reserves concurrent call cap before actual sends', async () => {
  const f = await fixture();
  for (const change of [{ callCap: 6 }, { timeoutMs: 180001 }, { timeoutMs: 0 }]) assert.throws(() => f.m.createForwarder({ ...f, secret: 'unit', ...change }));
  let sends = 0, release; const gate = new Promise(resolve => { release = resolve; });
  const forward = f.m.createForwarder({ ...f, secret: 'synthetic-secret', callCap: 2, timeoutMs: 1000,
    fetchImpl: async (url, options) => { assert.equal(url, f.m.ENDPOINT); assert.equal(options.headers.Authorization, 'Bearer synthetic-secret'); sends++; await gate; return new Response(responseFor(f)); } });
  const first = forward.forward(JSON.stringify(f.body)), second = forward.forward(JSON.stringify(f.body));
  await assert.rejects(forward.forward(JSON.stringify(f.body)), { code: 'NOTE016_CALL_CAP' }); assert.equal(sends, 2);
  release(); await Promise.all([first, second]); forward.disable();
  await assert.rejects(forward.forward(JSON.stringify(f.body)), { code: 'NOTE016_PROVIDER_DISABLED' }); assert.equal(sends, 2);
});

test('raw valid response bytes are unchanged and all nine saved HTML source receipts bind to the actual response', async () => {
  const f = await fixture(), raw = responseFor(f); let observed;
  const forward = f.m.createForwarder({ ...f, secret: 'synthetic-secret', timeoutMs: 1000,
    fetchImpl: async () => new Response(raw), record: r => { observed = clone(r); } });
  assert.equal((await forward.forward(JSON.stringify(f.body))).bytes.toString(), raw);
  assert.equal(observed.validated.statuses.main_findings, 'supported');
  const before = { valuesByTemplate: { basic_research: {} } }, after = clone(before);
  for (const field of f.template.fields) after.valuesByTemplate.basic_research[field.id] = observed.htmlSources[field.id].value;
  assert.equal(f.m.inspectSavedFields(before, after, [observed], f.api, f.canonical, f.template.fields.map(f => f.id)).length, 9);
  after.valuesByTemplate.basic_research.main_findings = observed.validated.values.main_findings;
  assert.throws(() => f.m.inspectSavedFields(before, after, [observed], f.api, f.canonical, ['main_findings']), { code: 'NOTE016_GENERATION_FAILED' });
  assert.doesNotMatch(JSON.stringify(observed), /synthetic-secret/);
});

test('invalid or truncated provider output is preserved without repairs and cannot count as saved generation', async () => {
  const f = await fixture();
  for (const raw of ['{invalid-json', JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: '{}' } }] }), responseFor(f, 13)]) {
    let observed;
    const forward = f.m.createForwarder({ ...f, secret: 'synthetic-secret', timeoutMs: 1000,
      fetchImpl: async () => new Response(raw), record: r => { observed = clone(r); } });
    assert.equal((await forward.forward(JSON.stringify(f.body))).bytes.toString(), raw);
    assert.match(observed.validation, /not-valid-as-received/);
    assert.equal(observed.schemaEvidence?.main_findings?.sourceLimit ?? 32, 32);
    const state = { valuesByTemplate: { basic_research: { main_findings: 'previous manual value' } } };
    assert.throws(() => f.m.inspectSavedFields(state, state, [observed], f.api, f.canonical, ['main_findings']), { code: 'NOTE016_GENERATION_FAILED' });
  }
});

test('foreign evidence and aborted execution never reach transport; response containing secret cannot be recorded', async () => {
  const f = await fixture(); let sends = 0, recordedSecret = false;
  const forward = f.m.createForwarder({ ...f, secret: 'synthetic-secret', timeoutMs: 1000,
    fetchImpl: async () => { sends++; return new Response('synthetic-secret'); }, record: (r, artifact) => { recordedSecret ||= JSON.stringify(artifact).includes('synthetic-secret'); } });
  await assert.rejects(forward.forward(JSON.stringify(changeRecords(f.body, r => [{ ...r, text: 'foreign' }]))), { code: 'NOTE016_SOURCE_BINDING' }); assert.equal(sends, 0);
  const aborted = f.m.createForwarder({ ...f, secret: 'unit', timeoutMs: 1000, signal: AbortSignal.abort(), fetchImpl: async () => { sends++; } });
  await assert.rejects(aborted.forward(JSON.stringify(f.body)), { code: 'NOTE016_PROVIDER_DISABLED' }); assert.equal(sends, 0);
  await assert.rejects(forward.forward(JSON.stringify(f.body)), { code: 'NOTE016_RESPONSE_SECRET' }); assert.equal(recordedSecret, false);
});

test('Figure layout checks main and Extended Data separately with one real subordinate point per group', async () => {
  const f = await fixture(), labels = f.m.inspectCanonical(f.canonical).captions.map(c => c.label.label);
  const value = labels.map(label => `- **${label}**\n  - Bounded finding requiring source review.`).join('\n');
  assert.deepEqual(f.m.inspectFindings(value, f.canonical).issues, []);
  assert.ok(f.m.inspectFindings(value.replace('Fig. 1**', 'Fig. 99**'), f.canonical).issues.includes('FIGURE_GROUP_COVERAGE_OR_ORDER'));
  assert.ok(f.m.inspectFindings(value.replace(/\n  - Bounded finding requiring source review\./u, ''), f.canonical).issues.includes('FIGURE_CONCLUSION_MISSING'));
  assert.match(f.m.inspectFindings(value, f.canonical).scientificReview, /Manual source review/);
});

test('preflight UI gate requires all thirteen caption sources and default rendered mode with one global toggle', async () => {
  const m = await entry, state = { fields: Array.from({ length: 9 }, () => ({ empty: true, visible: false })),
    captionSourceCount: 13, globalToggleCount: 1, globalTogglePressed: 'true', perFieldToggleCount: 0 };
  assert.equal(m.inspectInitialPopup(state).defaultRenderedMode, true);
  for (const change of [{ captionSourceCount: 5 }, { globalToggleCount: 9 }, { globalTogglePressed: 'false' },
    { perFieldToggleCount: 1 }, { fields: state.fields.slice(1) }, { fields: state.fields.map(f => ({ ...f, visible: true })) }]) {
    assert.throws(() => m.inspectInitialPopup({ ...state, ...change }), { code: 'NOTE016_INITIAL_UI_INVALID' });
  }
});

test('later valid retries cannot erase an invalid observed response from final acceptance status', async () => {
  const m = await entry, valid = { status: 200 }, fields = [{ structure: { issues: [] } }];
  assert.equal(m.classifyRun([valid], fields), 'PASS_FUNCTIONAL_REVIEW_REQUIRED');
  assert.equal(m.classifyRun([{ status: 200, validation: 'not-valid-as-received' }, valid], fields), 'FAIL_RESPONSE');
  assert.equal(m.classifyRun([{ status: 503 }, valid], fields), 'FAIL_RESPONSE');
  assert.equal(m.classifyRun([], fields), 'FAIL_RESPONSE');
  assert.equal(m.classifyRun([valid], [{ structure: { issues: ['FIGURE_GROUP_COVERAGE_OR_ORDER'] } }]), 'FAIL_STRUCTURE');
});

test('protected batch must preserve manual and generated field values plus evidence/status/revision', async () => {
  const m = await entry, before = { valuesByTemplate: { basic_research: { innovations: 'manual', main_findings: 'generated', limitations: '' } },
    fieldStatusByTemplate: { basic_research: { main_findings: 'supported' } },
    fieldEvidenceByTemplate: { basic_research: { main_findings: { source: 'bound' } } },
    fieldUpdatedAtByTemplate: { basic_research: { main_findings: 100, innovations: 101 } } };
  assert.deepEqual(m.inspectPreservedFields(before, clone(before), ['innovations', 'main_findings', 'limitations']), ['innovations', 'main_findings']);
  for (const key of ['valuesByTemplate', 'fieldStatusByTemplate', 'fieldEvidenceByTemplate', 'fieldUpdatedAtByTemplate']) {
    const after = clone(before); after[key].basic_research.main_findings = 'changed';
    assert.throws(() => m.inspectPreservedFields(before, after, ['innovations', 'main_findings']));
  }
});
