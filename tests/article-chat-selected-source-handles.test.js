const test = require('node:test');
const assert = require('node:assert/strict');

require('../core/article-chat-tokenizer.js');
require('../core/article-chat-index.js');
require('../core/article-chat-retrieval.js');
require('../core/article-chat-memory.js');
require('../core/article-chat-citations.js');
require('../core/token-budget.js');
require('../core/article-chat-context-planner.js');
const {
  createArticleChatNdjsonParser
} = require('../core/article-chat-stream.js');
const {
  normalizeArticleChatInput,
  prepareArticleChatRequest,
  compileArticleChatPrompt,
  runArticleChat
} = require('../core/article-chat.js');

const pageOneText =
  'Microglial surveillance depends on intact neuronal activity in vivo.';
const pageTwoText =
  'Anesthesia suppresses process motility and changes the measured baseline.';
const documentHash = 'selected-handle-document';

function snapshot() {
  return {
    revision: 4,
    documentHash,
    paragraphs: [{
      paragraphId: 'pdf-page-1', sourceKey: 'pdf-page-1', textHash: 'page-one-hash',
      sectionId: 'page-1', sectionTitle: 'Page 1', sectionKind: 'main',
      sectionPath: ['Page 1'], text: pageOneText
    }, {
      paragraphId: 'pdf-page-2', sourceKey: 'pdf-page-2', textHash: 'page-two-hash',
      sectionId: 'page-2', sectionTitle: 'Page 2', sectionKind: 'main',
      sectionPath: ['Page 2'], text: pageTwoText
    }, {
      paragraphId: 'pdf-page-3', sourceKey: 'pdf-page-3', textHash: 'page-three-hash',
      sectionId: 'page-3', sectionTitle: 'Page 3', sectionKind: 'main',
      sectionPath: ['Page 3'], text: 'A third paragraph supports an ordinary numeric citation.'
    }]
  };
}

function selectedSources(overrides = {}) {
  return [{
    id: 'S1', page_number: 1, paragraph_id: 'pdf-page-1', source_key: 'pdf-page-1',
    text_hash: 'page-one-hash', quote: pageOneText
  }, {
    id: 'S2', page_number: 2, paragraph_id: 'pdf-page-2', source_key: 'pdf-page-2',
    text_hash: 'page-two-hash', quote: pageTwoText
  }].map(source => ({ ...source, ...(overrides[source.id] || {}) }));
}

function selectionEvidence() {
  return {
    documentHash,
    documentGeneration: 4,
    selectionGeneration: 9,
    segments: selectedSources().map(source => ({
      text: source.quote,
      pageNumber: source.page_number,
      paragraphId: source.paragraph_id,
      contextHash: `context-${source.id.toLowerCase()}`,
      documentHash,
      documentGeneration: 4,
      selectionGeneration: 9,
      paragraphTextHash: source.text_hash
    }))
  };
}

function input(withSelection = true) {
  return normalizeArticleChatInput({
    question: 'Explain the supplied evidence.',
    profileId: 'profile_selected_handles',
    history: [],
    ...(withSelection ? { selectionEvidence: selectionEvidence() } : {}),
    document: {
      title: 'Selected handle fixture',
      documentHash,
      revision: 4,
      paragraphs: snapshot().paragraphs
    }
  });
}

function parser(options = {}) {
  return createArticleChatNdjsonParser({
    snapshot: snapshot(),
    selectedCitationSources: selectedSources(),
    requireExactEvidence: true,
    ...options
  });
}

function finish(target, blocks) {
  for (const block of blocks) target.push(`${JSON.stringify(block)}\n`);
  target.push('{"type":"turn_summary","summary":"The selected evidence is covered."}\n');
  target.push('{"type":"final","status":"completed"}\n');
  assert.equal(target.finish(), true);
  return target.snapshot();
}

test('two fixed selected-page handles become numeric exact verified citations', () => {
  const state = finish(parser(), [{
    type: 'answer_block', block_id: 'selected-pages',
    markdown: 'Page one supports surveillance.[[S1]] Page two qualifies the baseline.[[S2]]',
    evidence: []
  }]);

  assert.equal(state.blocks.length, 1);
  assert.equal(state.blocks[0].markdown,
    'Page one supports surveillance.[[1]] Page two qualifies the baseline.[[2]]');
  assert.deepEqual(state.blocks[0].evidence.map(item => item.marker), ['1', '2']);
  assert.deepEqual(state.blocks[0].evidence.map(item =>
    item.verification.target.paragraphId), ['pdf-page-1', 'pdf-page-2']);
  assert.ok(state.blocks[0].evidence.every(item =>
    item.verification.status === 'verified' && item.verification.target.quoteSpan));
});

test('selected handles and ordinary numeric citations allocate collision-free markers', () => {
  const state = finish(parser(), [{
    type: 'answer_block', block_id: 'mixed-markers',
    markdown: 'Additional context is numeric.[[1]] Selected pages remain fixed.[[S1]][[S2]]',
    evidence: [{
      marker: '1', paragraph_id: 'pdf-page-3', source_key: 'pdf-page-3',
      text_hash: 'page-three-hash',
      quote: 'A third paragraph supports an ordinary numeric citation.',
      section_path: ['Page 3']
    }]
  }]);

  assert.equal(state.blocks[0].markdown,
    'Additional context is numeric.[[1]] Selected pages remain fixed.[[2]][[3]]');
  assert.deepEqual(state.blocks[0].evidence.map(item => item.marker), ['1', '2', '3']);
  assert.equal(new Set(state.blocks[0].evidence.map(item => item.marker)).size, 3);
});

test('selected handles ignore unsolicited evidence that markdown never cites', () => {
  const state = finish(parser(), [{
    type: 'answer_block', block_id: 'provider-recopied-unused-evidence',
    markdown: 'Page one is selected.[[S1]] Page two is selected.[[S2]]',
    evidence: [{
      marker: '1', paragraph_id: 'pdf-page-1', source_key: 'pdf-page-1',
      text_hash: 'page-one-hash', quote: 'A provider-authored non-source fragment.'
    }, {
      marker: '2', paragraph_id: 'pdf-page-2', source_key: 'pdf-page-2',
      text_hash: 'page-two-hash', quote: 'Another unused fragment.'
    }]
  }]);

  assert.equal(state.blocks[0].markdown,
    'Page one is selected.[[1]] Page two is selected.[[2]]');
  assert.deepEqual(state.blocks[0].evidence.map(item => item.marker), ['1', '2']);
  assert.deepEqual(state.blocks[0].evidence.map(item => item.quote),
    [pageOneText, pageTwoText]);
  assert.ok(state.blocks[0].evidence.every(item =>
    item.verification.status === 'verified' && item.verification.target.quoteSpan));
});

test('selected-handle cleanup preserves every cited numeric source and stays strictly scoped', () => {
  const mixed = finish(parser(), [{
    type: 'answer_block', block_id: 'referenced-numeric-survives',
    markdown: 'Ordinary context remains cited.[[7]] Selection remains fixed.[[S1]]',
    evidence: [{
      marker: '7', paragraph_id: 'pdf-page-3', source_key: 'pdf-page-3',
      text_hash: 'page-three-hash',
      quote: 'A third paragraph supports an ordinary numeric citation.'
    }, {
      marker: '8', paragraph_id: 'pdf-page-3', source_key: 'pdf-page-3',
      text_hash: 'page-three-hash', quote: 'Unused provider metadata.'
    }]
  }]);
  assert.equal(mixed.blocks[0].markdown,
    'Ordinary context remains cited.[[7]] Selection remains fixed.[[1]]');
  assert.deepEqual(mixed.blocks[0].evidence.map(item => item.marker), ['7', '1']);
  assert.deepEqual(mixed.blocks[0].evidence.map(item => item.paragraphId),
    ['pdf-page-3', 'pdf-page-1']);

  assert.throws(() => parser().push(`${JSON.stringify({
    type: 'answer_block', block_id: 'bad-referenced-numeric',
    markdown: 'A bad numeric source stays invalid.[[7]] Selection is fixed.[[S1]]',
    evidence: [{ marker: '7', paragraph_id: 'pdf-page-3', source_key: 'pdf-page-3',
      text_hash: 'page-three-hash', quote: 'Not an exact source quote.' }]
  })}\n`), error => error?.code === 'INVALID_RESPONSE');

  assert.throws(() => parser().push(`${JSON.stringify({
    type: 'answer_block', block_id: 'numeric-only-unused-evidence',
    markdown: 'No citation appears in this block.',
    evidence: [{ marker: '1', paragraph_id: 'pdf-page-3', source_key: 'pdf-page-3',
      text_hash: 'page-three-hash',
      quote: 'A third paragraph supports an ordinary numeric citation.' }]
  })}\n`), error => error?.code === 'INVALID_RESPONSE');
});

test('unknown selected handles and caller-supplied forged handle evidence are rejected', () => {
  assert.throws(() => parser().push(`${JSON.stringify({
    type: 'answer_block', block_id: 'unknown-handle',
    markdown: 'This handle does not exist.[[S9]]', evidence: []
  })}\n`), error => error?.code === 'INVALID_RESPONSE');

  assert.throws(() => parser().push(`${JSON.stringify({
    type: 'answer_block', block_id: 'forged-handle-object',
    markdown: 'A forged source cannot define S9.[[S9]]',
    evidence: [{ marker: 'S9', paragraph_id: 'pdf-page-1',
      source_key: 'pdf-page-1', text_hash: 'page-one-hash', quote: pageOneText }]
  })}\n`), error => error?.code === 'INVALID_RESPONSE');

  assert.throws(() => parser().push(`${JSON.stringify({
    type: 'answer_block', block_id: 'out-of-range-handle',
    markdown: 'An out-of-range selected handle is never left unresolved.[[S1000]]',
    evidence: []
  })}\n`), error => error?.code === 'INVALID_RESPONSE');
});

test('tampered selected-source hash and quote cannot verify in strict mode', () => {
  const target = parser({
    selectedCitationSources: selectedSources({
      S1: { text_hash: 'tampered-hash', quote: 'A fabricated selected quote.' }
    })
  });
  assert.throws(() => target.push(`${JSON.stringify({
    type: 'answer_block', block_id: 'tampered-source',
    markdown: 'The tampered source is cited.[[S1]]', evidence: []
  })}\n`), error => error?.code === 'INVALID_RESPONSE');
  assert.equal(target.snapshot().blocks.length, 0);
});

test('the same handle is stable across blocks while an accepted block remains immutable', () => {
  const target = parser();
  const first = {
    type: 'answer_block', block_id: 'first-use',
    markdown: 'First use of the selected source.[[S1]]', evidence: []
  };
  target.push(`${JSON.stringify(first)}\n`);
  target.push(`${JSON.stringify(first)}\n`);
  target.push(`${JSON.stringify({
    type: 'answer_block', block_id: 'second-use',
    markdown: 'Second use of the same selected source.[[S1]]', evidence: []
  })}\n`);

  assert.equal(target.snapshot().blocks.length, 2);
  assert.deepEqual(target.snapshot().blocks.map(block => block.evidence[0].marker), ['1', '1']);
  assert.deepEqual(target.snapshot().blocks.map(block =>
    block.evidence[0].verification.target.paragraphId), ['pdf-page-1', 'pdf-page-1']);
  assert.throws(() => target.push(`${JSON.stringify({
    ...first, markdown: 'An attempted replacement changes the accepted block.[[S1]]'
  })}\n`), error => error?.code === 'INVALID_RESPONSE');
  assert.equal(target.snapshot().blocks[0].markdown,
    'First use of the selected source.[[1]]');
});

test('compile and run expose fixed mappings only from normalized selection evidence', async () => {
  const profile = {
    providerId: 'deepseek', config: { model: 'deepseek-v4-pro' },
    tokenPolicy: {}, contextWindowTokens: 65536
  };
  const selected = input(true);
  const plain = input(false);
  const selectedPrepared = await prepareArticleChatRequest(selected, profile);
  const plainPrepared = await prepareArticleChatRequest(plain, profile);
  const selectedPrompt = compileArticleChatPrompt(selected, selectedPrepared.plan);
  const plainPrompt = compileArticleChatPrompt(plain, plainPrepared.plan);
  const selectedPayload = JSON.parse(selectedPrompt.userPrompt.split(/\r?\n/)[3]);
  const plainPayload = JSON.parse(plainPrompt.userPrompt.split(/\r?\n/)[3]);
  assert.deepEqual(selectedPayload.selected_citation_sources.map(item => item.id), ['S1', 'S2']);
  assert.deepEqual(plainPayload.selected_citation_sources, []);

  let calls = 0;
  const result = await runArticleChat({
    input: selected,
    profile,
    adapter: {
      generateTextStream(request) {
        calls += 1;
        const payload = JSON.parse(request.userPrompt.split(/\r?\n/)[3]);
        assert.deepEqual(payload.selected_citation_sources.map(item => item.id), ['S1', 'S2']);
        return (async function* generate() {
          yield { type: 'started' };
          yield { type: 'text_delta', text: [
            JSON.stringify({ type: 'answer_block', block_id: 'selected-run',
              markdown: 'Both selected pages are grounded.[[S1]][[S2]]', evidence: [] }),
            JSON.stringify({ type: 'turn_summary', summary: 'Both pages are covered.' }),
            JSON.stringify({ type: 'final', status: 'completed' }),
            ''
          ].join('\n') };
          yield { type: 'completed', finishReason: 'stop' };
        })();
      }
    }
  });
  assert.equal(calls, 1);
  assert.equal(result.message.status, 'completed');
  assert.deepEqual(result.message.answerBlocks[0].evidence.map(item =>
    item.verification.target.paragraphId), ['pdf-page-1', 'pdf-page-2']);
});
