// Acceptance-harness contracts only: synthetic responses here never count as live note quality.
const test = require('node:test');
const assert = require('node:assert/strict');
const entry = import('../scripts/verify-note011-live-structure.mjs');
const clone = value => JSON.parse(JSON.stringify(value));

async function fixture(id = 'research_background') {
  const m = await entry, api = m.loadProduction();
  const article = { title: 'Unit source', url: 'https://example.org/unit', sourceSha256: 'unit-document',
    paragraphs: [{ id: 'p-0000000000000001', section: 'Introduction', text: 'The concept is defined; prior studies reported the known link, but causality remains unknown.' },
      { id: 'p-0000000000000002', section: 'Results', text: 'Figure 1 shows the controlled comparison. Figure S1 provides an independent measurement.' }],
    figures: [{ label: 'Figure 1', sourceId: 'p-0000000000000003', title: 'Comparison', caption: 'Figure 1. ' + 'Controlled comparison and conditions. '.repeat(8) },
      { label: 'Figure S1', sourceId: 'p-0000000000000004', title: 'Measurement', caption: 'Figure S1. ' + 'Independent measurement and limitation. '.repeat(8) }] };
  const document = api.buildResearchEvidenceDocument({ title: article.title, documentHash: article.sourceSha256,
    paragraphs: article.paragraphs.map(p => ({ paragraphId: p.id, sourceKey: p.id, sectionTitle: p.section, text: p.text })) }, { maxCharacters: 36000 });
  const template = api.normalizeLiteratureNoteTemplates().find(t => t.id === 'basic_research');
  template.fields = template.fields.filter(f => f.id === id);
  const prompt = api.compileLiteratureNoteAutofillPrompt(template, document, { outputLanguage: 'zh-CN' });
  const body = { model: m.MODEL, stream: false, messages: [{ role: 'system', content: prompt.systemPrompt }, { role: 'user', content: prompt.userPrompt }] };
  return { m, api, article, document, template, body, id };
}
function responseFor(f, value = '**关键概念**\n- 概念：定义。\n\n**现状与已知**\n- 已知的相关观察。\n\n**未知与矛盾**\n- 因果性仍未知。') {
  return JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({
    values: { [f.id]: value }, statuses: { [f.id]: 'supported' }, sources: { [f.id]: [f.document.records[0].paragraphId] }
  }) } }] });
}
function mutateRecord(body, mutate) {
  const copy = clone(body); copy.messages[1].content = copy.messages[1].content.split('\n').map(line => {
    try { const r = JSON.parse(line); if (r.paragraphId) { mutate(r); return JSON.stringify(r); } } catch {}
    return line;
  }).join('\n'); return copy;
}

test('default is no-API preflight; explicit live is separate and bounded', async () => {
  const m = await entry, args = ['--article', 'public.json', '--source-manifest', 'observed.json'];
  assert.equal(m.parseArguments(args).live, false);
  assert.equal(m.parseArguments([...args, '--live']).live, true);
  for (const extras of [['--live', '--preflight-only'], ['--call-cap', '9'], ['--call-cap', '1'], ['--deadline-ms', '1800001'],
    ['--provider-timeout-ms', '180001'], ['--model', 'deepseek-reasoner'], ['--transport', 'fetch'], ['xxcall-cap', '8']]) {
    assert.throws(() => m.parseArguments([...args, ...extras]), { code: 'NOTE011_ARGUMENT_INVALID' });
  }
  assert.throws(() => m.parseArguments([...args, '--portable-config', 'x']), { code: 'NOTE011_PROFILE_REQUIRED' });
  assert.throws(() => m.parseArguments([...args, '--profile-model-override', 'deepseek-flash']), { code: 'NOTE011_MODEL_OVERRIDE_INVALID' });
  assert.equal(m.parseArguments([...args, '--portable-config', 'x', '--profile', 'DS', '--profile-model-override', 'deepseek-flash']).profileModelOverride, 'deepseek-flash');
});

test('production compilation preflight records omissions and does not produce a quality PASS', async () => {
  const f = await fixture(), result = f.m.preflight(f.article, f.api);
  assert.equal(result.status, 'PREFLIGHT_READY'); assert.equal(result.realApiCalls, 0); assert.equal(result.browserCalls, 0); assert.equal(result.credentialRead, false);
  assert.equal(result.requests.length, 2); assert.match(result.boundary, /not actual content extraction/);
  const coverage = f.m.inspectRequest(f.body, f.article, f.api).coverage;
  assert.deepEqual(coverage.fullCaptions, []);
  assert.deepEqual(coverage.mentionedFigures, ['1', 'S1']); assert.equal(coverage.fullFigureCaptionCoverage, false);
  assert.deepEqual(coverage.missingFullCaptions, ['1', 'S1']);
});

test('full caption, partial caption and mention are different coverage observations', async () => {
  const f = await fixture();
  const c = f.m.coverage([{ text: f.article.figures[0].caption }, { text: f.article.figures[1].caption.slice(0, 110) }], f.article);
  assert.deepEqual(c.fullCaptions, ['1']); assert.deepEqual(c.partialCaptions, ['S1']); assert.equal(c.fullFigureCaptionCoverage, false);
});

test('request guard uses production default single-field guidance and rejects wrong source/model/field', async () => {
  const f = await fixture(); assert.equal(f.m.inspectRequest(f.body, f.article, f.api).fieldId, f.id);
  assert.throws(() => f.m.inspectRequest({ ...f.body, model: 'wrong' }, f.article, f.api), { code: 'NOTE011_REQUEST_INVALID' });
  const wrong = clone(f.body); wrong.messages[1].content = wrong.messages[1].content.replace('关键概念', '自定义概念');
  assert.throws(() => f.m.inspectRequest(wrong, f.article, f.api), { code: 'NOTE011_GUIDANCE_MISMATCH' });
  const other = clone(f.body); other.messages[1].content = other.messages[1].content.replace('research_background', 'innovations');
  assert.throws(() => f.m.inspectRequest(other, f.article, f.api), { code: 'NOTE011_REQUEST_IDENTITY' });
  assert.throws(() => f.m.inspectRequest(mutateRecord(f.body, r => { r.text = 'Foreign invented evidence.'; }), f.article, f.api), { code: 'NOTE011_SOURCE_BINDING' });
  assert.throws(() => f.m.inspectRequest(f.body, { ...f.article, runtimeDocumentHash: 'other' }, f.api), { code: 'NOTE011_SOURCE_BINDING' });
  const duplicate = clone(f.body); const line = duplicate.messages[1].content.split('\n').find(l => l.includes('"paragraphId"'));
  duplicate.messages[1].content = duplicate.messages[1].content.replace(line, line + '\n' + line);
  assert.throws(() => f.m.inspectRequest(duplicate, f.article, f.api), { code: 'NOTE011_SOURCE_BINDING' });
});

test('runtime paragraph identity and text hash must match actual canonical snapshot', async () => {
  const f = await fixture(); f.article.runtimeParagraphs = clone(f.document.records); f.article.runtimeDocumentHash = f.article.sourceSha256;
  assert.equal(f.m.inspectRequest(f.body, f.article, f.api).paragraphIds.length, 2);
  assert.throws(() => f.m.inspectRequest(mutateRecord(f.body, r => { r.textHash = 'wrong'; }), f.article, f.api), { code: 'NOTE011_SOURCE_BINDING' });
  assert.throws(() => f.m.inspectRequest(mutateRecord(f.body, r => { r.sourceKey = 'wrong'; }), f.article, f.api), { code: 'NOTE011_SOURCE_BINDING' });
});

test('structure checks requested headings and per-Figure grouping without inventing missing evidence', async () => {
  const f = await fixture(), bg = JSON.parse(JSON.parse(responseFor(f)).choices[0].message.content).values[f.id];
  assert.deepEqual(f.m.inspectStructure(f.id, bg, f.article, {}).issues, []);
  assert.ok(f.m.inspectStructure(f.id, bg.replace('关键概念', '其他概念'), f.article, {}).issues.includes('BACKGROUND_HEADINGS_ORDER'));
  assert.ok(f.m.inspectStructure(f.id, bg.replace('- 已知的相关观察。', ''), f.article, {}).issues.includes('BACKGROUND_SECTION_BULLETS'));
  const sent = { fullCaptions: ['1'], partialCaptions: [], mentionedFigures: ['1', 'S1'] };
  assert.deepEqual(f.m.inspectStructure('main_findings', '- **Figure 1：有条件的结论。**\n  - Panel A：支持条件。\n- **Figure S1：独立测量。**', f.article, sent).issues, []);
  const bad = f.m.inspectStructure('main_findings', '- Figure 99：虚构。\n- Figure 1：一。\n- Figure 1：重复。', f.article, sent);
  for (const code of ['INVENTED_FIGURE_ID', 'FIGURE_NOT_IN_SENT_EVIDENCE', 'DUPLICATE_FIGURE_GROUP']) assert.ok(bad.issues.includes(code));
  assert.ok(f.m.inspectStructure('main_findings', '- Figures 1, 99：多个图。', f.article, sent).issues.includes('INVENTED_FIGURE_ID'));
  assert.ok(f.m.inspectStructure('main_findings', '- Figure 1000：虚构。', f.article, sent).issues.includes('INVENTED_FIGURE_ID'));
  const orderedArticle = { figures: ['1', '2', 'S1', 'S2'].map(id => ({ label: `Figure ${id}` })) };
  const orderedSent = { fullCaptions: ['1', '2', 'S1', 'S2'], partialCaptions: [], mentionedFigures: [] };
  assert.ok(f.m.inspectStructure('main_findings', '- Figure 2: two.\n- Figure 1: one.\n- Figure S2: two.\n- Figure S1: one.', orderedArticle, orderedSent).issues.includes('FIGURE_ORDER'));
  assert.deepEqual(new Set(f.m.figureIds('Figures 1–3; Fig. S1; 图4')), new Set(['1', '2', '3', 'S1', '4']));
});

test('transparent forwarder returns exact real-boundary bytes and uses HTML source storage contract', async () => {
  const f = await fixture(), raw = responseFor(f), seen = [];
  const forward = f.m.createForwarder({ ...f, secret: 'unit-secret', callCap: 2, timeoutMs: 1000,
    fetchImpl: async (url, options) => { assert.equal(url, f.m.ENDPOINT); assert.equal(options.headers.Authorization, 'Bearer unit-secret'); return new Response(raw, { status: 200 }); },
    record: (r, artifacts) => seen.push({ r: clone(r), artifacts }) });
  const result = await forward.forward(JSON.stringify(f.body)); assert.equal(result.bytes.toString(), raw); assert.equal(forward.calls, 1);
  const call = seen.at(-1).r; assert.equal(call.htmlSources.sourcesSaved, true);
  assert.notEqual(call.htmlSources.value, call.validated.values[f.id]);
  const saved = f.m.inspectSavedField(f.id, call.htmlSources.value, call, f.api, f.article.sourceSha256);
  assert.equal(saved.kind, 'html-canonical-reference'); assert.equal(saved.persistedSourceIds.length, 1);
  assert.throws(() => f.m.inspectSavedField(f.id, call.validated.values[f.id], call, f.api, f.article.sourceSha256), { code: 'NOTE011_SAVED_VALUE_NOT_FROM_VALIDATED_RESPONSE' });
  assert.throws(() => f.m.inspectSavedField(f.id, call.htmlSources.value, call, f.api, 'wrong-document'), { code: 'NOTE011_SAVED_SOURCE_BINDING' });
  assert.doesNotMatch(JSON.stringify(seen), /unit-secret/);
});

test('malformed model output is never replaced; public validator rejection remains visible', async () => {
  const f = await fixture(), raw = '{"choices":[{"message":{"content":"{\"values\":{}}"}}]}'; let observed;
  const forward = f.m.createForwarder({ ...f, secret: 'unit-secret', callCap: 2, timeoutMs: 1000,
    fetchImpl: async () => new Response(raw), record: r => { observed = clone(r); } });
  assert.equal((await forward.forward(JSON.stringify(f.body))).bytes.toString(), raw);
  assert.equal(observed.validated, undefined); assert.match(observed.validation, /not-valid-as-received/);
});

test('concurrent requests reserve the cap before sending and disabled provider cannot reopen-call', async () => {
  const f = await fixture(), raw = responseFor(f); let sends = 0, release;
  const gate = new Promise(resolve => { release = resolve; });
  const forward = f.m.createForwarder({ ...f, secret: 'unit-secret', callCap: 2, timeoutMs: 1000,
    fetchImpl: async () => { sends++; await gate; return new Response(raw); } });
  const first = forward.forward(JSON.stringify(f.body)), second = forward.forward(JSON.stringify(f.body));
  await assert.rejects(forward.forward(JSON.stringify(f.body)), { code: 'NOTE011_CALL_CAP' }); assert.equal(sends, 2);
  release(); await Promise.all([first, second]); forward.disable();
  await assert.rejects(forward.forward(JSON.stringify(f.body)), { code: 'NOTE011_PROVIDER_DISABLED' }); assert.equal(sends, 2);
});

test('foreign evidence is rejected before transport and aborted signal sends nothing', async () => {
  const f = await fixture(); let sends = 0;
  const forward = f.m.createForwarder({ ...f, secret: 'unit-secret', callCap: 2, timeoutMs: 1000, fetchImpl: async () => { sends++; } });
  await assert.rejects(forward.forward(JSON.stringify(mutateRecord(f.body, r => { r.text = 'Unknown evidence'; }))), { code: 'NOTE011_SOURCE_BINDING' });
  const aborted = f.m.createForwarder({ ...f, secret: 'unit-secret', callCap: 2, timeoutMs: 1000, signal: AbortSignal.abort(), fetchImpl: async () => { sends++; } });
  await assert.rejects(aborted.forward(JSON.stringify(f.body)), { code: 'NOTE011_PROVIDER_DISABLED' }); assert.equal(sends, 0);
});

test('portable profile contract requires official origin and explicit model override; test loader is synthetic', async () => {
  const f = await fixture(), args = { portableConfig: 'unit-path-never-read', profile: 'DS' };
  const p = { providerId: 'deepseek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', apiKey: 'unit-secret', sourceSha256: 'synthetic' };
  const result = await f.m.loadCredential(args, { loadProfile: async () => p });
  assert.equal(result.secret, 'unit-secret'); assert.doesNotMatch(JSON.stringify(result), /unit-secret/);
  await assert.rejects(f.m.loadCredential(args, { loadProfile: async () => ({ ...p, baseUrl: 'https://example.org' }) }), { code: 'NOTE011_PROFILE_MISMATCH' });
  await assert.rejects(f.m.loadCredential(args, { loadProfile: async () => ({ ...p, model: 'other' }) }), { code: 'NOTE011_PROFILE_MISMATCH' });
  assert.equal((await f.m.loadCredential({ ...args, profileModelOverride: 'deepseek-flash' }, { loadProfile: async () => ({ ...p, model: 'other' }) })).metadata.explicitModelOverride, 'deepseek-flash');
});

test('generation must preserve all sibling values, evidence, explicit clears and other templates', async () => {
  const { m } = await fixture(), before = { valuesByTemplate: { basic_research: { innovations: 'manual', limitations: '' }, custom: { own: 'custom' } },
    fieldStatusByTemplate: { basic_research: { innovations: 'supported' } },
    fieldEvidenceByTemplate: { basic_research: { innovations: { source: 'retained' } } },
    fieldUpdatedAtByTemplate: { basic_research: { innovations: 12, limitations: 13 } } };
  const after = clone(before); after.valuesByTemplate.basic_research.research_background = 'new value';
  after.fieldUpdatedAtByTemplate.basic_research.research_background = 14;
  assert.doesNotThrow(() => m.assertPreservedSiblings(before, after, 'research_background'));
  for (const mutate of [s => { s.valuesByTemplate.basic_research.innovations = ''; }, s => { s.valuesByTemplate.custom.own = ''; },
    s => { s.fieldUpdatedAtByTemplate.basic_research.limitations = 14; }, s => { delete s.fieldEvidenceByTemplate.basic_research.innovations; }]) {
    const changed = clone(after); mutate(changed); assert.throws(() => m.assertPreservedSiblings(before, changed, 'research_background'));
  }
});

test('first generation may introduce target-only containers without relaxing sibling comparison', async () => {
  const { m } = await fixture();
  const before = { valuesByTemplate: { basic_research: { innovations: 'manual', limitations: '' }, custom: { own: 'keep' } },
    fieldStatusByTemplate: {}, fieldEvidenceByTemplate: {}, fieldUpdatedAtByTemplate: { basic_research: { limitations: 13 } } };
  const after = clone(before);
  after.valuesByTemplate.basic_research.research_background = 'new';
  after.fieldStatusByTemplate.basic_research = { research_background: 'supported' };
  after.fieldEvidenceByTemplate.basic_research = { research_background: { source: 'new' } };
  after.fieldUpdatedAtByTemplate.basic_research.research_background = 14;
  assert.doesNotThrow(() => m.assertPreservedSiblings(before, after, 'research_background'));
  for (const table of ['fieldStatusByTemplate', 'fieldEvidenceByTemplate']) {
    const addedSibling = clone(after); addedSibling[table].basic_research.innovations = 'unexpected';
    assert.throws(() => m.assertPreservedSiblings(before, addedSibling, 'research_background'));
  }
  const changedTemplate = clone(after); changedTemplate.valuesByTemplate.custom.own = 'changed';
  assert.throws(() => m.assertPreservedSiblings(before, changedTemplate, 'research_background'));
});

async function typedFixture() {
  const f = await fixture('main_findings');
  f.article.figures = Array.from({ length: 14 }, (_, i) => ({ label: `Figure ${i + 1}`, sourceId: `p-${(i + 100).toString(16).padStart(16, '0')}`,
    title: 'Comparison', caption: `Figure ${i + 1}. ` + 'Original conditions and measurements. '.repeat(10) }));
  const noteEvidencePolicy = f.api.resolveLiteratureNoteEvidencePolicy(f.template, { sourceKind: 'html-canonical' });
  f.document = f.api.buildResearchEvidenceDocument({ title: f.article.title, sourceKind: 'html-canonical', documentHash: f.article.sourceSha256,
    paragraphs: f.article.figures.map(r => ({ paragraphId: r.sourceId, sourceKey: r.sourceId, sourceIdentity: `original-${r.sourceId}`,
      recordType: 'figure-caption', sectionKind: 'figure', text: `${r.label}. ${r.title} ${r.caption}` })) }, { maxCharacters: 36000, noteEvidencePolicy });
  const prompt = f.api.compileLiteratureNoteAutofillPrompt(f.template, f.document, { outputLanguage: 'zh-CN', noteEvidencePolicy });
  f.body = { model: f.m.MODEL, messages: [{ role: 'system', content: prompt.systemPrompt }, { role: 'user', content: prompt.userPrompt }] };
  f.article.runtimeDocumentHash = f.article.sourceSha256; f.article.runtimeParagraphs = [];
  f.article.runtimeTypedRecords = clone(f.document.records).map(r => ({ ...r, recordType: 'figure-caption' }));
  return f;
}

test('production policy bridge retains same-realm guards and preflight uses per-field strategy', async () => {
  const f = await fixture('main_findings');
  const policy = f.api.resolveLiteratureNoteEvidencePolicy(clone(f.template), { sourceKind: 'html-canonical' });
  assert.equal(policy.maxSources, 32);
  const projection = f.m.preflight(f.article, f.api);
  const background = projection.requests.find(r => r.fieldId === 'research_background');
  const findings = projection.requests.find(r => r.fieldId === 'main_findings');
  assert.equal(background.noteEvidencePolicy.maxSources, 12); assert.deepEqual(background.coverage.fullCaptions, []);
  assert.equal(findings.noteEvidencePolicy.maxSources, 32); assert.equal(findings.coverage.fullFigureCaptionCoverage, true);
  assert.equal(findings.captionCoverage.complete, true);
});

test('actual typed caption identity is accepted only for main findings and rejects foreign kind/hash/identity', async () => {
  const f = await typedFixture(), observed = f.m.inspectRequest(f.body, f.article, f.api);
  assert.equal(observed.noteEvidencePolicy.maxSources, 32); assert.equal(observed.paragraphIds.length, 14);
  assert.equal(observed.coverage.fullCaptions.length, 14);
  for (const mutate of [r => { r.recordType = 'table'; }, r => { r.textHash = 'other'; }, r => { r.sourceIdentity = 'other'; }]) {
    const article = clone(f.article); mutate(article.runtimeTypedRecords[0]);
    assert.throws(() => f.m.inspectRequest(f.body, article, f.api), { code: 'NOTE011_SOURCE_BINDING' });
  }
  const background = f.api.normalizeLiteratureNoteTemplates()[0]; background.fields = background.fields.filter(r => r.id === 'research_background');
  const prompt = f.api.compileLiteratureNoteAutofillPrompt(background, f.document, { outputLanguage: 'zh-CN' });
  assert.throws(() => f.m.inspectRequest({ model: f.m.MODEL, messages: [{ role: 'user', content: prompt.userPrompt }] }, f.article, f.api), { code: 'NOTE011_SOURCE_BINDING' });
});

test('14-source transparent response is validated and stored through scoped production policy without mutation', async () => {
  const f = await typedFixture(), value = '- Figure 1: synthetic finding.';
  const raw = JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ values: { main_findings: value },
    statuses: { main_findings: 'supported' }, sources: { main_findings: f.document.records.map(r => r.paragraphId) } }) } }] });
  let call; const forward = f.m.createForwarder({ ...f, secret: 'unit-secret', callCap: 2, timeoutMs: 1000,
    fetchImpl: async () => new Response(raw), record: r => { call = clone(r); } });
  assert.equal((await forward.forward(JSON.stringify(f.body))).bytes.toString(), raw);
  assert.equal(call.validated.sources.main_findings.length, 14); assert.equal(call.htmlSources.sourcesSaved, true);
  const saved = f.m.inspectSavedField('main_findings', call.htmlSources.value, call, f.api, f.article.sourceSha256);
  assert.equal(saved.persistedSourceIds.length, 14);
  assert.ok(f.api.projectLiteratureNoteSources(call.htmlSources.value).references.every(r => r.sourceIds.length <= 12));
});

test('figure coverage requirement belongs to main findings, not background; quality remains review-required', async () => {
  const m = await entry, fields = [{ fieldId: 'research_background', issues: [], sourceCoverage: { fullFigureCaptionCoverage: false } },
    { fieldId: 'main_findings', issues: [], sourceCoverage: { fullFigureCaptionCoverage: true } }];
  assert.equal(m.classifyStructureResult(fields), 'PASS_STRUCTURE_REVIEW_REQUIRED');
  fields[1].sourceCoverage.fullFigureCaptionCoverage = false;
  assert.equal(m.classifyStructureResult(fields), 'PARTIAL_SOURCE_COVERAGE');
  fields[0].issues.push('BACKGROUND_HEADINGS_ORDER');
  assert.equal(m.classifyStructureResult(fields), 'FAIL_STRUCTURE');
});

test('omitting a sent complete S3 caption fails the final structure result', async () => {
  const m = await entry, article = { figures: ['1', 'S3'].map(id => ({ label: `Figure ${id}` })) };
  const result = m.inspectStructure('main_findings', '- **Figure 1: result.**', article,
    { fullCaptions: ['1', 'S3'], partialCaptions: [], mentionedFigures: ['1', 'S3'] });
  assert.deepEqual(result.omittedSentFullCaptions, ['S3']);
  assert.ok(result.issues.includes('SENT_FULL_CAPTION_GROUP_MISSING'));
  assert.equal(m.classifyStructureResult([{ fieldId: 'research_background', issues: [] },
    { ...result, sourceCoverage: { fullFigureCaptionCoverage: true } }]), 'FAIL_STRUCTURE');
});

test('a Figure group can refer to another figure in its conclusion without creating another heading', async () => {
  const m = await entry, article = { figures: ['1', 'S1'].map(id => ({ label: `Figure ${id}` })) };
  const sent = { fullCaptions: ['1', 'S1'], partialCaptions: [], mentionedFigures: ['1', 'S1'] };
  for (const text of [
    '- **Figure 1**：主图结论。\n- **Figure S1**：补充 Figure 1 的对照。',
    '- Figure 1: result.\n- Figure S1: independent control for Figure 1.'
  ]) {
    const result = m.inspectStructure('main_findings', text, article, sent);
    assert.deepEqual(result.figureGroups, ['1', 'S1']);
    assert.deepEqual(result.issues, []);
  }
  assert.ok(m.inspectStructure('main_findings', '- Figures 1, S1: combined.', article, sent).issues.includes('FIGURE_TOP_LEVEL_STRUCTURE'));
  assert.ok(m.inspectStructure('main_findings', '- Figure 1: see Figure 99.\n- Figure S1: control.', article, sent).issues.includes('INVENTED_FIGURE_ID'));
});

test('explicit supplementary Figure sections may be one level below a supplementary container', async () => {
  const m = await entry, article = { figures: ['1', 'S1', 'S2'].map(id => ({ label: `Figure ${id}` })) };
  const sent = { fullCaptions: ['1', 'S1', 'S2'], partialCaptions: [], mentionedFigures: ['1', 'S1', 'S2'] };
  const text = '- 摘要总结：整体机制。\n- Figure 1：主图结论。\n  - 实验比较。\n- 补充图（按原编号）：\n  - Figure S1：独立对照。\n  - Figure S2：额外结果。';
  assert.deepEqual(m.inspectStructure('main_findings', text, article, sent).issues, []);
  assert.deepEqual(m.inspectStructure('main_findings', text.replace('补充图（按原编号）', 'Supplementary figures'), article, sent).figureGroups, ['1', 'S1', 'S2']);
  for (const changed of [text.replace('- 补充图（按原编号）：\n', ''),
    text.replace('  - Figure S1：', '  - 提到了 Figure S1：'),
    text.replace('  - Figure S1：独立对照。\n', ''),
    text.replace('  - Figure S1：', '    - Figure S1：')]) {
    assert.ok(m.inspectStructure('main_findings', changed, article, sent).issues.includes('SENT_FULL_CAPTION_GROUP_MISSING'));
  }
  assert.ok(m.inspectStructure('main_findings', text + '\n  - Figure S1：重复。', article, sent).issues.includes('DUPLICATE_FIGURE_GROUP'));
  assert.ok(m.inspectStructure('main_findings', text.replace('Figure S2：', 'Figure S99：'), article, sent).issues.includes('INVENTED_FIGURE_ID'));
});

test('incidental body mentions cannot replace a sent caption top-level Figure group', async () => {
  const m = await entry, article = { figures: ['1', 'S3'].map(id => ({ label: `Figure ${id}` })) };
  const sent = { fullCaptions: ['1', 'S3'], partialCaptions: [], mentionedFigures: ['1', 'S3'] };
  for (const mention of ['  - See Figure S3 for a control.', 'See Figure S3 for a control.', '- A control appears in Figure S3.']) {
    const result = m.inspectStructure('main_findings', '- **Figure 1: result.**\n' + mention, article, sent);
    assert.deepEqual(result.omittedSentFullCaptions, ['S3']);
    assert.ok(result.issues.includes('SENT_FULL_CAPTION_GROUP_MISSING'));
  }
  assert.deepEqual(m.inspectStructure('main_findings', '- **Figure 1: result.**\n- **Figure S3: control.**', article, sent).issues, []);
});

test('unsent or partial captions are observed but not demanded as complete Figure groups', async () => {
  const m = await entry, article = { figures: ['1', 'S3'].map(id => ({ label: `Figure ${id}` })) };
  for (const sent of [{ fullCaptions: ['1'], partialCaptions: [], mentionedFigures: [] },
    { fullCaptions: ['1'], partialCaptions: ['S3'], mentionedFigures: ['S3'] }]) {
    const result = m.inspectStructure('main_findings', '- Figure 1: result.', article, sent);
    assert.deepEqual(result.omittedSentFullCaptions, []);
    assert.deepEqual(result.omittedArticleFigures, ['S3']);
    assert.deepEqual(result.issues, []);
  }
});

function reopenState() {
  return { schemaVersion: 3, templateId: 'basic_research', updatedAt: 17,
    valuesByTemplate: { basic_research: { main_findings: 'exact source-bearing text', innovations: 'manual', limitations: '' }, custom: { own: 'keep' } },
    fieldStatusByTemplate: { basic_research: { main_findings: 'supported' } },
    fieldEvidenceByTemplate: {}, fieldUpdatedAtByTemplate: { basic_research: { main_findings: 15, limitations: 16 } } };
}

test('reopen normalization accepts only the proven empty basic_research evidence container and records raw difference', async () => {
  const m = await entry, api = m.loadProduction(), before = reopenState(), after = clone(before);
  after.fieldEvidenceByTemplate.basic_research = {};
  for (const [left, right] of [[before, after], [after, before]]) {
    const result = m.inspectReopenedNoteState(left, right, api);
    assert.deepEqual(result.rawDifferences.map(d => d.path), ['/fieldEvidenceByTemplate/basic_research']);
    assert.deepEqual(result.unexpectedRawDifferences, []); assert.deepEqual(result.normalizedDifferences, []);
    assert.doesNotThrow(() => m.assertReopenedNoteState(result));
  }
  assert.deepEqual(before, reopenState(), 'inspection cannot mutate captured state');
  assert.deepEqual(after.fieldEvidenceByTemplate, { basic_research: {} });
  const input = clone(before); delete input.valuesByTemplate.custom;
  const captured = api.normalizeLiteratureNoteDocumentState(input);
  const reconciled = api.reconcileLiteratureNoteDocumentStates(captured, captured);
  assert.doesNotThrow(() => m.assertReopenedNoteState(m.inspectReopenedNoteState(captured, reconciled, api)));
});

test('production normalization cannot hide nonempty evidence, value, status, revision or extra-field changes on reopen', async () => {
  const m = await entry, api = m.loadProduction(), before = reopenState();
  const mutations = [
    s => { s.fieldEvidenceByTemplate.basic_research = { main_findings: { unexpected: 'invalid metadata still differs' } }; },
    s => { s.valuesByTemplate.basic_research.main_findings += ' changed source'; },
    s => { s.valuesByTemplate.basic_research.innovations = 'edited'; },
    s => { delete s.valuesByTemplate.basic_research.limitations; },
    s => { s.valuesByTemplate.custom.own = 'edited'; },
    s => { s.fieldStatusByTemplate.basic_research.main_findings = 'not_found'; },
    s => { s.fieldUpdatedAtByTemplate.basic_research.limitations++; }, s => { s.updatedAt++; },
    s => { s.templateId = 'custom'; }, s => { s.schemaVersion = 4; },
    s => { s.extra = 'must not be dropped by normalizer'; },
    s => { s.fieldEvidenceByTemplate.custom = {}; },
    s => { s.fieldEvidenceByTemplate.basic_research = []; },
    s => { s.fieldEvidenceByTemplate.basic_research = null; },
    s => { delete s.fieldEvidenceByTemplate; }
  ];
  for (const mutate of mutations) {
    const after = clone(before); mutate(after);
    const result = m.inspectReopenedNoteState(before, after, api);
    assert.ok(result.rawDifferences.length); assert.ok(result.unexpectedRawDifferences.length);
    assert.throws(() => m.assertReopenedNoteState(result), { code: 'ERR_ASSERTION' });
  }
  const left = clone(before); left.fieldEvidenceByTemplate.basic_research = { main_findings: { unexpected: 'original' } };
  const right = clone(left); right.fieldEvidenceByTemplate.basic_research.main_findings.unexpected = 'changed';
  assert.throws(() => m.assertReopenedNoteState(m.inspectReopenedNoteState(left, right, api)), { code: 'ERR_ASSERTION' });
});
