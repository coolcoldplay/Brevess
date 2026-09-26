const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SEMANTIC_FIND_VERSION,
  createSemanticFindSentences,
  runSemanticFind,
  semanticFindScoreAlpha
} = require('../core/semantic-find.js');

function answersFor(questions, score = () => 0.5) {
  return {
    answers: Object.fromEntries(Object.entries(questions).map(([id, question], index) => [
      id,
      { type: question.type, noul: score(id, index) }
    ]))
  };
}

test('each Jev question names its exact source path because response IDs are invisible to the model',async()=>{
  const sentences=createSemanticFindSentences([{paragraphId:'p',text:
    'Treatment increased recovery. Treatment did not increase recovery.'}]);
  await runSemanticFind({query:'recovery increases',sentences,evaluate:async({questions,state})=>{
    const instructions=Object.entries(questions).map(([id,question])=>{
      assert.ok(question.instructions.includes(`sentences[${JSON.stringify(id)}].text`));
      assert.ok(state.sentences[id]);
      assert.doesNotMatch(question.instructions,/whose id is this question key/);
      return question.instructions;
    });
    assert.equal(new Set(instructions).size,sentences.length);
    return answersFor(questions);
  }});
});

test('creates source-exact Chinese and English scientific sentences', () => {
  const text = [
    'Dr. Li measured 3.2±0.4 mg, e.g. in cohort A. 结果显著（P = 0.03）。',
    '软换行仍属于',
    '同一句！'
  ].join('\n');
  const sentences = createSemanticFindSentences([{
    paragraphId: 'p-science',
    sectionTitle: 'Results',
    text
  }]);

  assert.match(SEMANTIC_FIND_VERSION, /^semantic-find-v\d+$/u);
  assert.deepEqual(sentences.map(sentence => sentence.text), [
    'Dr. Li measured 3.2±0.4 mg, e.g. in cohort A.',
    '结果显著（P = 0.03）。',
    '软换行仍属于\n同一句！'
  ]);
  for (const sentence of sentences) {
    assert.equal(text.slice(sentence.start, sentence.end), sentence.text);
    assert.equal(sentence.paragraphId, 'p-science');
    assert.equal(sentence.sectionTitle, 'Results');
  }
});

test('uses UTF-16 offsets and zero-based occurrences for repeated exact sentences', () => {
  const quote = 'LRRC7⁺ cells were ≤ 5% 😊.';
  const text = `${quote} ${quote}`;
  const sentences = createSemanticFindSentences([{ paragraphId: 'p-repeat', text }]);

  assert.deepEqual(sentences.map(sentence => sentence.occurrence), [0, 1]);
  assert.equal(sentences[0].start, 0);
  assert.equal(sentences[0].end, quote.length);
  assert.equal(sentences[1].start, text.lastIndexOf(quote));
  assert.equal(sentences[1].end, text.length);
  assert.ok(sentences.every(sentence => text.slice(sentence.start, sentence.end) === quote));
});

test('keeps paragraph order and rejects an unbounded sentence inventory', () => {
  const sentences = createSemanticFindSentences([
    { paragraphId: 'p2', text: 'Second.' },
    { paragraphId: 'p1', text: 'First.' }
  ]);
  assert.deepEqual(sentences.map(sentence => sentence.paragraphId), ['p2', 'p1']);
  assert.deepEqual(sentences.map(sentence => sentence.id), ['semantic_sentence_0', 'semantic_sentence_1']);

  const tooMany = Array.from({ length: 10001 }, (_, index) => ({
    paragraphId: `p${index}`,
    text: 'One sentence.'
  }));
  assert.throws(() => createSemanticFindSentences(tooMany), error =>
    error?.code === 'SEMANTIC_FIND_LIMIT_EXCEEDED');
});

test('evaluates every sentence in bounded TypeSafe batches and reports cumulative progress', async () => {
  const sentences = createSemanticFindSentences(Array.from({ length: 130 }, (_, index) => ({
    paragraphId: `p${index}`,
    text: `Scientific sentence ${index}.`
  })));
  const calls = [];
  const progress = [];
  const result = await runSemanticFind({
    query: '寻找表达研究限制的句子',
    sentences,
    async evaluate({ state, questions, signal }) {
      calls.push({ state, questions, signal });
      return answersFor(questions, (_id, index) => index / 100);
    },
    onProgress(update) {
      progress.push(update);
    }
  });

  assert.deepEqual(calls.map(call => Object.keys(call.questions).length), [64, 64, 2]);
  assert.ok(calls.every(call => call.state.query === '寻找表达研究限制的句子'));
  assert.ok(calls.every(call => Object.values(call.questions)
    .every(question => question.type === 'noul')));
  assert.ok(calls.every(call => Object.isFrozen(call.state) &&
    Object.isFrozen(call.state.sentences) && Object.isFrozen(call.questions)));
  assert.ok(calls.every(call => Object.values(call.questions).every(question =>
    !question.instructions.includes(call.state.query) &&
    Object.values(call.state.sentences).every(sentence =>
      !question.instructions.includes(sentence.text)))));
  assert.ok(calls.every(call => Object.keys(call.state.sentences).length ===
    Object.keys(call.questions).length));
  assert.deepEqual(progress.map(update => update.processed), [64, 128, 130]);
  assert.deepEqual(progress.map(update => update.scores.length), [64, 64, 2]);
  assert.deepEqual(progress.map(update => update.done), [false, false, true]);
  assert.equal(result.processed, 130);
  assert.equal(result.total, 130);
  assert.equal(result.skipped, 0);
  assert.equal(result.scores.length, 130);
  assert.equal(result.complete, true);
  assert.equal(result.coverage, 'full');
  assert.deepEqual(result.scores.map(item => item.id), sentences.map(item => item.id));
});

test('respects both Jev byte envelopes when forming batches', async () => {
  const sentences = createSemanticFindSentences(Array.from({ length: 4 }, (_, index) => ({
    paragraphId: `large-${index}`,
    text: `${String.fromCharCode(65 + index)}${'x'.repeat(15000)}.`
  })));
  const calls = [];
  const result = await runSemanticFind({
    query: 'matching experimental claim',
    sentences,
    async evaluate({ state, questions }) {
      calls.push({ state, questions });
      return answersFor(questions, () => 0.75);
    }
  });

  assert.ok(calls.length > 1, 'the byte envelope must split an otherwise four-item batch');
  assert.equal(calls.reduce((sum, call) => sum + Object.keys(call.questions).length, 0), 4);
  for (const call of calls) {
    const stateBytes = Buffer.byteLength(JSON.stringify(call.state));
    const longestQuestion = Math.max(...Object.values(call.questions)
      .map(question => Buffer.byteLength(JSON.stringify(question))));
    const totalBytes = Buffer.byteLength(JSON.stringify(call)) + 256;
    assert.ok(stateBytes + longestQuestion <= (32 * 1024) - 256);
    assert.ok(totalBytes <= 64 * 1024);
  }
  assert.equal(result.complete, true);
});

test('uses exact response keys and noul probabilities without inventing scores', async t => {
  const sentences = createSemanticFindSentences([
    { paragraphId: 'p1', text: 'First claim.' },
    { paragraphId: 'p2', text: 'Second claim.' }
  ]);
  const exact = await runSemanticFind({
    query: 'claim', sentences,
    evaluate: async ({ questions }) => answersFor(questions, (_id, index) => [0.125, 0.875][index])
  });
  assert.deepEqual(exact.scores.map(item => item.score), [0.125, 0.875]);

  const invalidCases = [
    questions => ({ answers: { [Object.keys(questions)[0]]: { type: 'noul', noul: 0.5 } } }),
    questions => ({ answers: Object.fromEntries(Object.keys(questions)
      .map(id => [id, { type: 'choice', noul: 0.5 }])) }),
    questions => ({ answers: Object.fromEntries(Object.keys(questions)
      .map(id => [id, { type: 'noul', noul: Number.NaN }])) }),
    questions => ({ answers: Object.fromEntries(Object.keys(questions)
      .map(id => [id, { type: 'noul', noul: 1.01 }])) }),
    questions => ({ answers: { ...answersFor(questions).answers,
      invented: { type: 'noul', noul: 0.2 } } })
  ];
  for (const [index, response] of invalidCases.entries()) {
    await t.test(`rejects invalid response ${index + 1}`, async () => {
      await assert.rejects(runSemanticFind({
        query: 'claim', sentences, evaluate: async ({ questions }) => response(questions)
      }), error => error?.code === 'SEMANTIC_FIND_INVALID_RESPONSE');
    });
  }
});

test('checks cancellation before and after evaluate and never publishes a cancelled batch', async () => {
  const sentences = createSemanticFindSentences([{ paragraphId: 'p1', text: 'A result.' }]);
  const before = new AbortController();
  before.abort();
  let calls = 0;
  let publications = 0;
  await assert.rejects(runSemanticFind({
    query: 'result', sentences, signal: before.signal,
    evaluate: async ({ questions }) => {
      calls += 1;
      return answersFor(questions);
    },
    onProgress: () => { publications += 1; }
  }), error => error?.code === 'CANCELLED');
  assert.equal(calls, 0);
  assert.equal(publications, 0);

  const during = new AbortController();
  await assert.rejects(runSemanticFind({
    query: 'result', sentences, signal: during.signal,
    evaluate: async ({ questions }) => {
      during.abort();
      return answersFor(questions);
    },
    onProgress: () => { publications += 1; }
  }), error => error?.code === 'CANCELLED');
  assert.equal(publications, 0);
});

test('skips an oversized exact sentence and reports partial coverage without truncation', async () => {
  const sentences = createSemanticFindSentences([
    { paragraphId: 'huge', text: `${'x'.repeat(40000)}.` },
    { paragraphId: 'small', text: 'A usable sentence.' }
  ]);
  const seen = [];
  const result = await runSemanticFind({
    query: 'usable evidence', sentences,
    async evaluate({ state, questions }) {
      seen.push(...Object.values(state.sentences).map(sentence => sentence.text));
      return answersFor(questions, () => 0.61);
    }
  });

  assert.deepEqual(seen, ['A usable sentence.']);
  assert.deepEqual(result.scores, [{ id: sentences[1].id, score: 0.61 }]);
  assert.equal(result.processed, 1);
  assert.equal(result.skipped, 1);
  assert.equal(result.total, 2);
  assert.equal(result.complete, false);
  assert.equal(result.coverage, 'partial');
});

test('validates query and maps only valid probabilities to monotonic alpha', async () => {
  const sentences = createSemanticFindSentences([{ paragraphId: 'p1', text: 'Evidence.' }]);
  for (const query of ['', '   ', 'x'.repeat(1001)]) {
    await assert.rejects(runSemanticFind({ query, sentences, evaluate: async () => ({}) }),
      error => error?.code === 'SEMANTIC_FIND_INVALID_REQUEST');
  }
  assert.ok(semanticFindScoreAlpha(0) < semanticFindScoreAlpha(0.5));
  assert.ok(semanticFindScoreAlpha(0.5) < semanticFindScoreAlpha(1));
  for (const value of [-0.01, 1.01, Number.NaN, Number.POSITIVE_INFINITY, '0.5']) {
    assert.throws(() => semanticFindScoreAlpha(value), error =>
      error?.code === 'SEMANTIC_FIND_INVALID_SCORE');
  }
});
