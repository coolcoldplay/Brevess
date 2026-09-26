// Offline compiler/acceptance contracts; no claim that model output is scientifically correct.
const test = require('node:test');
const assert = require('node:assert/strict');
const note = require('../core/reading-tools.js');
const evidence = require('../core/research-evidence.js');
const entry = import('../scripts/verify-note011-live-structure.mjs');
const clone = value => JSON.parse(JSON.stringify(value));
function fixture(texts = ['Figure S8. Independent control. See also Figure 42.',
  'Figure 3. Measured comparison.', 'Fig. 19: Separate measured comparison.']) {
  const template = note.normalizeLiteratureNoteTemplates()[0];
  template.fields = template.fields.filter(f => f.id === 'main_findings');
  const policy = note.resolveLiteratureNoteEvidencePolicy(template, { sourceKind: 'html-canonical' });
  const document = evidence.buildResearchEvidenceDocument({ sourceKind: 'html-canonical', title: 'Synthetic caption outline',
    documentHash: 'outline-document', paragraphs: texts.map((text, i) => ({ paragraphId: `caption-${i}`, sourceKey: `figure-${i}`,
      recordType: 'figure-caption', sectionTitle: 'Untrusted heading Figure 99', text })) }, { maxCharacters: 128000, noteEvidencePolicy: policy });
  return { template, policy, document };
}
function compile(f) {
  const prompt = note.compileLiteratureNoteAutofillPrompt(f.template, f.document, { noteEvidencePolicy: f.policy });
  return { prompt, guide: JSON.parse(prompt.userPrompt.split('LITERATURE_NOTE_REQUEST:\n')[1]).template.fields[0].prompt };
}

test('outline uses actual complete caption starts in source order, never later mentions or caption titles', () => {
  const f = fixture(), frozen = JSON.stringify(f), { guide, prompt } = compile(f);
  assert.match(guide, /Verified complete-caption Figure order: Figure S8; Figure 3; Fig\. 19\./);
  assert.match(guide, /heading.*only.*original Figure identifier/i);
  assert.match(guide, /first indented bullet.*concise conclusion.*1–3 supporting/is);
  assert.doesNotMatch(guide, /number and its key conclusion|Figure 42|Figure 99|Measured comparison/);
  assert.equal(prompt.responseSchema.properties.sources.properties.main_findings.maxItems, 32);
  assert.equal(prompt.responseSchema.properties.values.properties.main_findings.maxLength, 12000);
  assert.equal(JSON.stringify(f), frozen);
  assert.equal(note.LITERATURE_NOTE_HTML_FINDINGS_GUIDANCE_VERSION, '6');
});

test('compact evidence outlines only actually complete captions and explicitly retains partial coverage', () => {
  const f = fixture(['Figure 7. ' + 'A measured condition. '.repeat(115), 'Figure S6. ' + 'Separate control. '.repeat(150)]);
  f.document = evidence.compactResearchEvidenceDocument(f.document, { maxCharacters: 4000 });
  assert.equal(f.document.captionCoverage.complete, false);
  assert.equal(f.document.captionCoverage.completeParagraphIds.length, 1);
  const { guide } = compile(f);
  assert.match(guide, /Verified complete-caption Figure order: Figure 7\./);
  assert.doesNotMatch(guide, /Figure S6/);
  assert.match(guide, /partial.*do not claim full-paper coverage/is);
});

test('ambiguous, plural, panel-specific, unknown or duplicate starting labels produce no guessed outline', () => {
  for (const texts of [['Figures 1 and 2. Combined.'], ['Figure 1–2. Range.'], ['Figure 1A. Panel only.'],
    ['See Figure 5. Citation.'], ['Figure 1.2. Decimal.'], ['Extended data figures 4–5. Ambiguous label.'],
    ['Figure 1. First.', 'Fig. 1. Repeated identifier.'], ['Figure S2. First.', '图S2：Repeated identifier.']]) {
    const { guide } = compile(fixture(texts));
    assert.doesNotMatch(guide, /Verified complete-caption Figure order:/);
    assert.match(guide, /number and its key conclusion/);
  }
});

test('broken coverage, absent records and mismatched record owner cannot provide an outline', () => {
  for (const mutate of [d => { delete d.captionCoverage; }, d => { d.captionCoverage.completeParagraphIds.push('missing'); },
    d => { d.captionCoverage.completeParagraphIds.reverse(); }, d => { d.records[0].documentHash = 'foreign'; },
    d => { d.records.push(clone(d.records[0])); }, d => { d.captionCoverage.missingParagraphIds.push('caption-0'); }]) {
    const f = fixture(); f.document = clone(f.document); mutate(f.document);
    assert.doesNotMatch(compile(f).guide, /Verified complete-caption Figure order:/);
  }
});

test('strict original labels include Chinese and zero guessing without changing custom prompt', () => {
  const f = fixture(['图 23：独立对照。', 'Figure S4. Supplementary comparison.']);
  assert.match(compile(f).guide, /Verified complete-caption Figure order: 图 23; Figure S4\./);
  f.template.fields[0].prompt = 'My custom instruction.';
  assert.equal(compile(f).guide, 'My custom instruction.');
});

test('wire verification rebuilds the outline from bound runtime captions and rejects tampered guidance', async () => {
  const f = fixture(), m = await entry, api = m.loadProduction(), { prompt } = compile(f);
  const article = { title: f.document.title, paragraphs: [],
    figures: f.document.records.map((r, i) => ({ label: `Figure ${i + 1}`, caption: r.text })),
    runtimeDocumentHash: f.document.documentHash, runtimeParagraphs: [],
    runtimeTypedRecords: f.document.records.map(r => ({ ...r, recordType: 'figure-caption' })) };
  const body = { model: m.MODEL, messages: [{ role: 'user', content: prompt.userPrompt }] };
  assert.equal(m.inspectRequest(body, article, api).captionCoverage.complete, true);
  const altered = clone(body);
  altered.messages[0].content = altered.messages[0].content.replace(
    'Verified complete-caption Figure order: Figure S8; Figure 3; Fig. 19.',
    'Verified complete-caption Figure order: Figure S8; Figure 3; Figure 999.');
  assert.throws(() => m.inspectRequest(altered, article, api), { code: 'NOTE011_GUIDANCE_MISMATCH' });
  const foreign = clone(article); foreign.runtimeTypedRecords[0].sourceKey = 'wrong';
  assert.throws(() => m.inspectRequest(body, foreign, api), { code: 'NOTE011_SOURCE_BINDING' });
});

const background = definition => `**关键概念**\n${definition}\n**现状与已知**\n- 既有证据支持条件相关观察。\n**未知与矛盾**\n- 条件之间的关系尚未确定。`;
test('natural Chinese and English definitions do not require a colon; semantic review stays required', async () => {
  const m = await entry;
  for (const line of ['- 毛囊是皮肤中的一种微型器官。', '- 静息指细胞暂时不进入增殖的状态。',
    '- **Organoid** is a three-dimensional culture derived from cells.', '- Quiescence refers to a reversible non-proliferative state.',
    '- Cells are the basic structural units.', '- 概念：定义。']) {
    const result = m.inspectStructure('research_background', background(line), { figures: [] }, {});
    assert.deepEqual(result.issues, [], line);
    assert.equal(result.definitionReview.semanticReview, 'required');
    assert.match(result.scientificReview, /source review/);
  }
});

test('missing definitions and explicit study-result-only bullets still fail rather than passing by punctuation', async () => {
  const m = await entry;
  for (const line of ['', '- 毛囊和细胞周期。', '- 本研究发现：处理降低了细胞死亡。', '- 实验结果是处理组出现更少死亡。',
    '- Results: treatment reduced the measured endpoint.', '- We found that treatment is effective.',
    '- 细胞死亡：本研究发现处理降低了它。']) {
    assert.ok(m.inspectStructure('research_background', background(line), { figures: [] }, {}).issues.includes('CONCEPT_DEFINITIONS_MISSING'), line);
  }
});

test('identifier-only headings need content underneath, while populated groups retain a manual scientific-review boundary', async () => {
  const m = await entry, article = { figures: [{ label: 'Figure 3' }] }, sent = { fullCaptions: ['3'], partialCaptions: [], mentionedFigures: [] };
  assert.ok(m.inspectStructure('main_findings', '- **Figure 3**', article, sent).issues.includes('FIGURE_CONCLUSION_MISSING'));
  const full = m.inspectStructure('main_findings', '- **Figure 3**\n  - The controlled comparison supported a condition-specific change.\n  - Panel A reports the comparison.', article, sent);
  assert.deepEqual(full.issues, []);
  assert.match(full.scientificReview, /conclusion.*method.*manual source review/i);
});
