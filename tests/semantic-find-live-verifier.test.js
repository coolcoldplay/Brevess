const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const scriptFile = path.join(__dirname, '..', 'scripts', 'verify-semantic-find.mjs');
const source = fs.readFileSync(scriptFile, 'utf8');

async function verifier() {
  return import('../scripts/verify-semantic-find.mjs');
}

function validRequest(overrides = {}) {
  const sentences = {
    semantic_sentence_0: {
      paragraph_id: 'p-en', section_title: 'Results', start: 0, end: 44,
      occurrence: 0, text: 'Compound Q clearly increased signal recovery.'
    },
    semantic_sentence_1: {
      paragraph_id: 'p-zh', section_title: '结果', start: 0, end: 11,
      occurrence: 0, text: '处理组的信号恢复增加。'
    }
  };
  const questions = Object.fromEntries(Object.keys(sentences).map(id => [id, {
    type: 'noul', instructions: 'Return the matching probability.'
  }]));
  return {
    model: 'jev-1.13.0',
    state: {
      phase: 'semantic_find', version: 'semantic-find-v1',
      query: '寻找信号恢复增加的句子', sentences
    },
    questions,
    ...overrides
  };
}

test('semantic-find verifier gives full-PDF fixture room while real calls retain a hard cap of ten',
  async () => {
    const { normalizeOptions } = await verifier();
    const options = normalizeOptions([], {});
    assert.equal(options.apiMode, 'fixture');
    assert.equal(options.browser, 'msedge');
    assert.equal(normalizeOptions(['--browser', 'chrome']).browser, 'chrome');
    assert.throws(() => normalizeOptions(['--browser', 'unsupported']),
      /SEMANTIC_FIND_BROWSER_INVALID/u);
    assert.equal(options.callCap, 32);
    assert.equal(options.headed, false);
    assert.equal(options.html, true);
    assert.equal(options.pdf, true);
    assert.match(options.pdfPath, /elife-83176-v2\.pdf$/u);
    assert.equal(normalizeOptions(['--api-mode', 'real-api', '--call-cap', '4']).apiMode,
      'real-api');
    assert.equal(normalizeOptions(['--api-mode', 'real-api']).callCap, 10);
    assert.throws(() => normalizeOptions(['--api-mode', 'replay']),
      /SEMANTIC_FIND_API_MODE_INVALID/u);
    assert.throws(() => normalizeOptions(['--api-mode', 'real-api', '--call-cap', '11']),
      /SEMANTIC_FIND_CALL_CAP_INVALID/u);
    assert.throws(() => normalizeOptions(['--call-cap', '33']),
      /SEMANTIC_FIND_CALL_CAP_INVALID/u);
    assert.throws(() => normalizeOptions(['--html-only', '--pdf-only']),
      /SEMANTIC_FIND_STAGE_SELECTION_INVALID/u);
  });

test('fixture validates the official semantic-find TypeSafe shape and returns exact noul keys',
  async () => {
    const { validateSemanticFindRequest, buildFixtureDecision, assertExactDecision } =
      await verifier();
    const request = validRequest();
    const admitted = validateSemanticFindRequest(request);
    assert.deepEqual(admitted.sentenceIds, ['semantic_sentence_0', 'semantic_sentence_1']);
    const response = buildFixtureDecision(request);
    assert.deepEqual(Object.keys(response.answers), admitted.sentenceIds);
    assert.equal(assertExactDecision(request, response), true);
    assert.ok(Object.values(response.answers).every(answer =>
      answer.type === 'noul' && answer.noul >= 0 && answer.noul <= 1));
    assert.equal(response.answers.semantic_sentence_0.noul, 0.96);
    assert.equal(response.answers.semantic_sentence_1.noul, 0.92);
  });

test('fixture rejects changed phases, non-noul questions, and missing or invented answers',
  async t => {
    const { validateSemanticFindRequest, assertExactDecision, buildFixtureDecision } =
      await verifier();
    const invalid = [
      { ...validRequest(), state: { ...validRequest().state, phase: 'candidate_screen' } },
      { ...validRequest(), questions: { ...validRequest().questions,
        semantic_sentence_0: { type: 'choice', instructions: 'wrong type' } } },
      { ...validRequest(), questions: { semantic_sentence_0:
        validRequest().questions.semantic_sentence_0 } }
    ];
    for (const [index, request] of invalid.entries()) {
      await t.test(`request ${index + 1}`, () => assert.throws(
        () => validateSemanticFindRequest(request), /SEMANTIC_FIND_FIXTURE_/u));
    }
    const request = validRequest();
    const response = buildFixtureDecision(request);
    const ids = Object.keys(response.answers);
    assert.throws(() => assertExactDecision(request, {
      answers: { [ids[0]]: response.answers[ids[0]] }
    }), /SEMANTIC_FIND_PROVIDER_KEYS_INVALID/u);
    assert.throws(() => assertExactDecision(request, {
      answers: { ...response.answers, invented: { type: 'noul', noul: 0.2 } }
    }), /SEMANTIC_FIND_PROVIDER_KEYS_INVALID/u);
    assert.throws(() => assertExactDecision(request, {
      answers: { ...response.answers, [ids[0]]: { type: 'noul', noul: 1.01 } }
    }), /SEMANTIC_FIND_PROVIDER_SCORE_INVALID/u);
  });

test('cross-language fixture scores positives, a hard negation, and unrelated text distinctly',
  async () => {
    const { scoreFixtureSentence } = await verifier();
    assert.equal(scoreFixtureSentence('寻找信号恢复增加的句子',
      'Compound Q clearly increased signal recovery by 28 percent.'), 0.96);
    assert.equal(scoreFixtureSentence('sentences reporting increased signal recovery',
      '作者明确报告处理组的信号恢复增加，而载体对照保持稳定。'), 0.92);
    assert.equal(scoreFixtureSentence('increased signal recovery',
      'Compound Q did not increase signal recovery in the confirmatory cohort.'), 0.04);
    assert.ok(scoreFixtureSentence('increased signal recovery',
      'The unrelated apparatus remained calibrated.') < 0.2);
    assert.equal(scoreFixtureSentence('为了验证某个目的，我们设计了下面的实验',
      'To test this alternative hypothesis, we designed a MERFISH experiment.'), 0.97);
  });

test('visual score acceptance verifies the exact alpha formula and strict multi-score depth',
  async () => {
    const { assertScoreVisualIntensity } = await verifier();
    assert.equal(assertScoreVisualIntensity([
      { score: 0.97, background: 'rgba(255, 187, 35, 0.88)' }
    ], 'VISUAL_SCORE_INVALID'), true);
    assert.equal(assertScoreVisualIntensity([
      { score: 0.84, background: 'rgba(255, 187, 35, 0.78)' },
      { score: 0.92, background: 'rgba(255, 187, 35, 0.84)' },
      { score: 0.96, background: 'rgba(255, 187, 35, 0.87)' }
    ], 'VISUAL_SCORE_INVALID'), true);
    assert.throws(() => assertScoreVisualIntensity([
      { score: 0.84, background: 'rgba(255, 187, 35, 0.87)' },
      { score: 0.96, background: 'rgba(255, 187, 35, 0.78)' }
    ], 'VISUAL_SCORE_INVALID'), /VISUAL_SCORE_INVALID/u);
  });

test('real-mode evidence binds raw provider scores to exact source ranges and UI buckets',
  async () => {
    const { assertHtmlProviderUiBinding } = await verifier();
    const query = 'semantic　query';
    const source = 'Compound Q clearly increased signal recovery by 28 percent compared with vehicle.';
    const textSha256 = crypto.createHash('sha256').update(source).digest('hex');
    const querySha256 = crypto.createHash('sha256').update('semantic query').digest('hex');
    const report = { provider: { calls: [{ querySha256, decisions: [{
      id: 'semantic_sentence_0', paragraphId: 'positive-en', textSha256, score: 0.8764
    }] }] } };
    const hits = { score: 0.876, currentRange: { paragraphId: 'positive-en', textSha256 },
      buckets: [{ score: 0.88, ranges: [{ paragraphId: 'positive-en', textSha256 }] }] };
    assert.equal(assertHtmlProviderUiBinding(report, query, hits, ['positive-en'], ['negative']), true);
    assert.throws(() => assertHtmlProviderUiBinding(report, query,
      { ...hits, buckets: [{ score: 0.87, ranges: hits.buckets[0].ranges }] },
      ['positive-en']), /SEMANTIC_FIND_UI_SCORE_BUCKET_CHANGED/u);
    assert.throws(() => assertHtmlProviderUiBinding(report, query, hits,
      ['positive-en', 'positive-zh']), /SEMANTIC_FIND_REQUIRED_SOURCE_MISSING/u);
  });

test('report boundary rejects credentials and unredacted provider payloads', async () => {
  const { assertSafeReport } = await verifier();
  assert.equal(assertSafeReport({ execution: { apiMode: 'fixture' }, scores: [0.2, 0.9] }),
    true);
  assert.throws(() => assertSafeReport({ apiKey: 'hidden' }),
    /SEMANTIC_FIND_REPORT_FORBIDDEN_KEY/u);
  assert.throws(() => assertSafeReport({ diagnostic: 'Bearer private-token' }),
    /SEMANTIC_FIND_REPORT_SECRET_LEAK/u);
  assert.throws(() => assertSafeReport({ diagnostic: 'memory-only-secret' },
    'memory-only-secret'), /SEMANTIC_FIND_REPORT_SECRET_LEAK/u);
});

test('browser verifier drives J UI and both production renderers without private function calls',
  () => {
    assert.match(source, /page\.keyboard\.press\('j'\)/u);
    assert.match(source, /data-semantic-find-role="query"/u);
    assert.match(source, /data-semantic-find-role="progress"/u);
    assert.match(source, /input\.press\('j'\)/u);
    assert.match(source, /input\.press\('Enter'\)/u);
    assert.match(source, /page\.keyboard\.press\('Shift\+Enter'\)/u);
    assert.match(source, /page\.keyboard\.press\('Escape'\)/u);
    assert.match(source, /CSS\.highlights\?\.get\('sci-semantic-search-current'\)/u);
    assert.match(source, /\.pdf-native-semantic-search-hit/u);
    assert.match(source, /\.pdf-native-semantic-search-layer/u);
    assert.match(source, /#sci-manual-toolbar \.sci-manual-category/u);
    assert.doesNotMatch(source, /__brevessSemanticFind\.(?:open|confirm|handleProgress)/u);
  });

test('browser verifier checks original PDF lifecycle, persistence, and late-result cancellation', () => {
  assert.match(source, /#pdfLocalFile/u);
  assert.match(source, /indexedPageCount === pages/u);
  assert.match(source, /originalPdfPageCount:\s*normalized\.pdf && isDefaultPublicPdf \? 23 : 0/u);
  assert.match(source, /command\('setScale'/u);
  assert.match(source, /command\(\s*'updatePageWindow'/u);
  assert.match(source, /pdf-native-page\[data-pdf-page-number/u);
  assert.match(source, /page\.reload/u);
  assert.match(source, /late cancel signal recovery increase/u);
  assert.match(source, /SEMANTIC_FIND_CANCEL_LAYER_RETURNED/u);
  assert.match(source, /\.sci-manual-highlight/u);
  assert.match(source, /\.sci-highlight,\.sci-llm-highlight/u);
  assert.match(source, /deriveRealApiPdf/u);
  assert.match(source, /derivedSourcePageNumbers/u);
  assert.match(source, /public-elife-83176-pages-1-2\.pdf/u);
});

test('real API mode uses masked TTY and a localhost dummy credential boundary only', () => {
  assert.match(source, /readSecretFromTty/u);
  assert.match(source, /Authorized TypeSafe key \(masked, memory only\)/u);
  assert.match(source, /Authorization|authorization/u);
  assert.match(source, /Bearer \$\{DUMMY_SECRET\}/u);
  assert.match(source, /Bearer \$\{getSecret\(\)\}/u);
  assert.match(source, /secret = ''/u);
  assert.match(source, /DEFAULT_CALL_CAP = 10/u);
  assert.doesNotMatch(source, /process\.env\.(?:API|TYPESAFE|OPENAI).*KEY/u);
});

test('help and reports distinguish fixture evidence from fresh provider calls', async () => {
  const { helpText } = await verifier();
  const help = helpText();
  assert.match(help, /--api-mode fixture\|real-api/u);
  assert.match(help, /fixture makes zero real provider calls/u);
  assert.match(source, /fixtureIsRealApi:\s*false/u);
  assert.match(source, /realCalls/u);
  assert.match(source, /sourceHashes/u);
  assert.match(source, /html-semantic-find\.png/u);
  assert.match(source, /pdf-semantic-find\.png/u);
  assert.match(source, /--diagnose-manual/u);
  assert.match(source, /--diagnose-injection/u);
  for (const name of ['clearManualHighlightMarks', 'freezeManualDocumentInteraction',
    'prepareManualDocumentFresh', 'prepareManualDocument']) assert.ok(source.includes(name));
});
