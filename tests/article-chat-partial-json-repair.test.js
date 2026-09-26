const test = require('node:test');
const assert = require('node:assert/strict');

require('../core/article-chat-tokenizer.js');
require('../core/article-chat-index.js');
require('../core/article-chat-retrieval.js');
require('../core/article-chat-memory.js');
require('../core/article-chat-citations.js');
require('../core/token-budget.js');
require('../core/article-chat-context-planner.js');
require('../core/article-chat-stream.js');
const {
  normalizeArticleChatInput,
  runArticleChat
} = require('../core/article-chat.js');

const profile = {
  providerId: 'deepseek',
  config: { model: 'deepseek-v4-pro' },
  tokenPolicy: {},
  contextWindowTokens: 65536
};

function input() {
  return normalizeArticleChatInput({
    question: 'Which observations support the conclusion?',
    profileId: 'profile_partial_repair',
    history: [],
    document: {
      title: 'Repair fixture',
      url: 'https://example.org/repair-fixture',
      revision: 3,
      paragraphs: [{
        paragraphId: 'p-results',
        sourceKey: 'results:1',
        textHash: 'hash-results',
        sectionId: 'results',
        sectionTitle: 'Results',
        sectionKind: 'results',
        sectionPath: ['Results'],
        text: 'Heat stress significantly increased circulating IL-6 after 24 hours.'
      }, {
        paragraphId: 'p-discussion',
        sourceKey: 'discussion:1',
        textHash: 'hash-discussion',
        sectionId: 'discussion',
        sectionTitle: 'Discussion',
        sectionKind: 'discussion',
        sectionPath: ['Discussion'],
        text: 'The authors interpret IL-6 as a candidate systemic signal.'
      }]
    }
  });
}

function evidence(paragraphId = 'p-results') {
  const results = paragraphId === 'p-results';
  return {
    marker: '1',
    paragraph_id: paragraphId,
    source_key: results ? 'results:1' : 'discussion:1',
    text_hash: results ? 'hash-results' : 'hash-discussion',
    quote: results
      ? 'Heat stress significantly increased circulating IL-6 after 24 hours.'
      : 'The authors interpret IL-6 as a candidate systemic signal.',
    section_path: [results ? 'Results' : 'Discussion']
  };
}

function block(blockId, markdown, paragraphId = 'p-results') {
  return {
    type: 'answer_block',
    block_id: blockId,
    markdown,
    evidence: [evidence(paragraphId)]
  };
}

function invalidBlock(blockId) {
  return {
    type: 'answer_block',
    block_id: blockId,
    markdown: 'This marker has no evidence.[[2]]',
    evidence: []
  };
}

function twoInvalidStreams(onRequest = () => {}) {
  let calls = 0;
  return {
    get calls() { return calls; },
    generateTextStream(request) {
      calls += 1;
      onRequest(request, calls);
      const attempt = calls;
      return (async function* generate() {
        yield { type: 'started' };
        const records = attempt === 1 ? [
          block('preserved-block', 'The measured increase is retained.[[1]]'),
          invalidBlock('invalid-first')
        ] : [invalidBlock('invalid-repair')];
        yield {
          type: 'text_delta',
          text: `${records.map(record => JSON.stringify(record)).join('\n')}\n`
        };
        yield { type: 'completed', finishReason: 'stop' };
      })();
    }
  };
}

const selectedPageOne = 'While microglia have been linked to Alzheimer’s disease ' +
  '(Heneka et al., 2014; Ransohoff, 2016), little is known about their healthy function.';
const selectedPageTwo =
  'Neuronal activity changes microglial process motility in vivo.';

function selectedInput() {
  return normalizeArticleChatInput({
    question: 'Explain both selected pages.',
    profileId: 'profile_partial_repair',
    history: [],
    selectionEvidence: {
      documentHash: 'doc-selected-pages',
      documentGeneration: 4,
      selectionGeneration: 9,
      segments: [{
        text: selectedPageOne,
        pageNumber: 1,
        paragraphId: 'pdf-page-1',
        contextHash: 'context-page-one',
        documentHash: 'doc-selected-pages',
        documentGeneration: 4,
        selectionGeneration: 9,
        paragraphTextHash: 'hash-page-one'
      }, {
        text: selectedPageTwo,
        pageNumber: 2,
        paragraphId: 'pdf-page-2',
        contextHash: 'context-page-two',
        documentHash: 'doc-selected-pages',
        documentGeneration: 4,
        selectionGeneration: 9,
        paragraphTextHash: 'hash-page-two'
      }]
    },
    document: {
      title: 'Selected PDF pages',
      documentHash: 'doc-selected-pages',
      revision: 4,
      paragraphs: [{
        paragraphId: 'pdf-page-1', sourceKey: 'pdf-page-1',
        textHash: 'hash-page-one', sectionId: 'page-1', sectionTitle: 'Page 1',
        sectionKind: 'main', sectionPath: ['Page 1'], text: selectedPageOne
      }, {
        paragraphId: 'pdf-page-2', sourceKey: 'pdf-page-2',
        textHash: 'hash-page-two', sectionId: 'page-2', sectionTitle: 'Page 2',
        sectionKind: 'main', sectionPath: ['Page 2'], text: selectedPageTwo
      }]
    }
  });
}

function selectedBlock(blockId, pageNumber, quote) {
  return {
    type: 'answer_block',
    block_id: blockId,
    markdown: `Selected page ${pageNumber} is addressed.[[1]]`,
    evidence: [{
      marker: '1',
      paragraph_id: `pdf-page-${pageNumber}`,
      source_key: `pdf-page-${pageNumber}`,
      text_hash: `hash-page-${pageNumber === 1 ? 'one' : 'two'}`,
      quote,
      section_path: [`Page ${pageNumber}`]
    }]
  };
}

function completeRecords(blocks, summary = 'Both selected pages are addressed.') {
  return [
    ...blocks,
    { type: 'turn_summary', summary },
    { type: 'final', status: 'completed' }
  ].map(record => JSON.stringify(record)).join('\n') + '\n';
}

test('partial invalid streams use one bounded JSON repair and never rewrite accepted blocks', async () => {
  const stream = twoInvalidStreams();
  let jsonCalls = 0;
  let fallbackRequest = null;
  const adapter = {
    generateTextStream: request => stream.generateTextStream(request),
    async generateJson(request) {
      jsonCalls += 1;
      fallbackRequest = request;
      return {
        records: [
          block('repaired-block', 'The interpretation is retained separately.[[1]]',
            'p-discussion'),
          { type: 'turn_summary', summary: 'Measurement and interpretation are complete.' },
          { type: 'final', status: 'completed' }
        ]
      };
    }
  };

  const result = await runArticleChat({ input: input(), profile, adapter });

  assert.equal(stream.calls, 2);
  assert.equal(jsonCalls, 1);
  assert.equal(fallbackRequest.schemaName, 'article_chat_json_fallback');
  assert.equal(fallbackRequest.responseSchema.properties.records.minItems, 2);
  assert.match(fallbackRequest.userPrompt, /preserved-block/);
  assert.match(fallbackRequest.userPrompt, /completed_blocks/);
  assert.equal(result.message.status, 'completed');
  assert.deepEqual(result.message.answerBlocks.map(item => item.blockId),
    ['preserved-block', 'repaired-block']);
  assert.equal(result.message.answerBlocks[0].markdown,
    'The measured increase is retained.[[1]]');
  assert.equal(result.message.answerBlocks[0].evidence[0].paragraphId, 'p-results');
});

test('a partial JSON repair may add only summary and final to immutable accepted blocks', async () => {
  const stream = twoInvalidStreams();
  let jsonCalls = 0;
  const adapter = {
    generateTextStream: request => stream.generateTextStream(request),
    async generateJson() {
      jsonCalls += 1;
      return { records: [
        { type: 'turn_summary', summary: 'The retained evidence already answers the question.' },
        { type: 'final', status: 'completed' }
      ] };
    }
  };

  const result = await runArticleChat({ input: input(), profile, adapter });

  assert.equal(stream.calls, 2);
  assert.equal(jsonCalls, 1);
  assert.equal(result.message.status, 'completed');
  assert.deepEqual(result.message.answerBlocks.map(item => item.blockId), ['preserved-block']);
  assert.equal(result.message.answerBlocks[0].markdown,
    'The measured increase is retained.[[1]]');
});

test('a conflicting duplicate in JSON repair preserves the partial result as incomplete', async () => {
  const stream = twoInvalidStreams();
  let jsonCalls = 0;
  const adapter = {
    generateTextStream: request => stream.generateTextStream(request),
    async generateJson() {
      jsonCalls += 1;
      return { records: [
        block('preserved-block', 'A conflicting replacement must not overwrite.[[1]]',
          'p-discussion'),
        { type: 'turn_summary', summary: 'This conflicting repair is invalid.' },
        { type: 'final', status: 'completed' }
      ] };
    }
  };

  const result = await runArticleChat({ input: input(), profile, adapter });

  assert.equal(stream.calls, 2);
  assert.equal(jsonCalls, 1);
  assert.equal(result.message.status, 'incomplete');
  assert.deepEqual(result.message.answerBlocks.map(item => item.blockId), ['preserved-block']);
  assert.equal(result.message.answerBlocks[0].markdown,
    'The measured increase is retained.[[1]]');
});

test('a malformed JSON repair is attempted once and leaves the valid partial block visible', async () => {
  const stream = twoInvalidStreams();
  let jsonCalls = 0;
  const adapter = {
    generateTextStream: request => stream.generateTextStream(request),
    async generateJson() {
      jsonCalls += 1;
      return { records: [invalidBlock('invalid-json-repair')] };
    }
  };

  const result = await runArticleChat({ input: input(), profile, adapter });

  assert.equal(stream.calls, 2);
  assert.equal(jsonCalls, 1);
  assert.equal(result.message.status, 'incomplete');
  assert.deepEqual(result.message.answerBlocks.map(item => item.blockId), ['preserved-block']);
});

test('a normal complete stream does not invoke JSON repair', async () => {
  let streamCalls = 0;
  let jsonCalls = 0;
  const adapter = {
    generateTextStream() {
      streamCalls += 1;
      return (async function* generate() {
        yield { type: 'started' };
        yield { type: 'text_delta', text: [
          JSON.stringify(block('normal-block', 'The normal response is complete.[[1]]')),
          JSON.stringify({ type: 'turn_summary', summary: 'Normal completion.' }),
          JSON.stringify({ type: 'final', status: 'completed' }),
          ''
        ].join('\n') };
        yield { type: 'completed', finishReason: 'stop' };
      })();
    },
    async generateJson() {
      jsonCalls += 1;
      throw new Error('JSON repair must not run for a normal stream');
    }
  };

  const result = await runArticleChat({ input: input(), profile, adapter });

  assert.equal(streamCalls, 1);
  assert.equal(jsonCalls, 0);
  assert.equal(result.message.status, 'completed');
  assert.deepEqual(result.message.answerBlocks.map(item => item.blockId), ['normal-block']);
});

test('selected quote with a removed parenthetical triggers repair and accepts a shorter exact quote', async () => {
  let streamCalls = 0;
  let jsonCalls = 0;
  const requests = [];
  const badNoncontiguousQuote =
    'While microglia have been linked to Alzheimer’s disease, little is known about their healthy function.';
  const adapter = {
    generateTextStream(request) {
      streamCalls += 1;
      requests.push(request);
      const attempt = streamCalls;
      return (async function* generate() {
        yield { type: 'started' };
        const records = attempt === 1
          ? completeRecords([selectedBlock('bad-page-one', 1, badNoncontiguousQuote)])
          : completeRecords([
            selectedBlock('exact-page-one', 1,
              'little is known about their healthy function.'),
            selectedBlock('exact-page-two', 2, selectedPageTwo)
          ]);
        yield { type: 'text_delta', text: records };
        yield { type: 'completed', finishReason: 'stop' };
      })();
    },
    async generateJson() {
      jsonCalls += 1;
      throw new Error('A successful bounded stream repair must not use JSON fallback');
    }
  };

  const result = await runArticleChat({ input: selectedInput(), profile, adapter });

  assert.equal(streamCalls, 2);
  assert.equal(jsonCalls, 0);
  assert.match(requests[1].userPrompt, /format or citation validation/i);
  assert.equal(result.message.status, 'completed');
  assert.deepEqual(result.message.answerBlocks.map(item => item.blockId),
    ['exact-page-one', 'exact-page-two']);
  assert.ok(result.message.answerBlocks.every(item =>
    item.evidence.every(source => source.verification.status === 'verified' &&
      source.verification.target.quoteSpan)));
});

test('selected citations that remain unlocatable cannot become completed', async () => {
  let streamCalls = 0;
  let jsonCalls = 0;
  const impossibleQuote = 'This sentence is not present on either selected page.';
  const adapter = {
    generateTextStream() {
      streamCalls += 1;
      const attempt = streamCalls;
      return (async function* generate() {
        yield { type: 'started' };
        const blocks = attempt === 1 ? [
          selectedBlock('preserved-page-two', 2, selectedPageTwo),
          selectedBlock('bad-page-one', 1, impossibleQuote)
        ] : [selectedBlock('bad-page-one-repair', 1, impossibleQuote)];
        yield { type: 'text_delta', text: completeRecords(blocks) };
        yield { type: 'completed', finishReason: 'stop' };
      })();
    },
    async generateJson() {
      jsonCalls += 1;
      return { records: [
        selectedBlock('bad-page-one-json', 1, impossibleQuote),
        { type: 'turn_summary', summary: 'The invalid quote remains unlocatable.' },
        { type: 'final', status: 'completed' }
      ] };
    }
  };

  const result = await runArticleChat({ input: selectedInput(), profile, adapter });

  assert.equal(streamCalls, 2);
  assert.equal(jsonCalls, 1);
  assert.equal(result.message.status, 'incomplete');
  assert.deepEqual(result.message.answerBlocks.map(item => item.blockId),
    ['preserved-page-two']);
  assert.match(result.message.limitations, /引用|校验/);
});

test('a complete selected answer missing one page must continue before completion', async () => {
  let streamCalls = 0;
  let jsonCalls = 0;
  const requests = [];
  const adapter = {
    generateTextStream(request) {
      streamCalls += 1;
      requests.push(request);
      const attempt = streamCalls;
      return (async function* generate() {
        yield { type: 'started' };
        const blocks = attempt === 1
          ? [selectedBlock('only-page-one', 1,
            'little is known about their healthy function.')]
          : [selectedBlock('added-page-two', 2, selectedPageTwo)];
        yield { type: 'text_delta', text: completeRecords(blocks) };
        yield { type: 'completed', finishReason: 'stop' };
      })();
    },
    async generateJson() {
      jsonCalls += 1;
      throw new Error('Exact page coverage continuation must not need JSON fallback');
    }
  };

  const result = await runArticleChat({ input: selectedInput(), profile, adapter });

  assert.equal(streamCalls, 2);
  assert.equal(jsonCalls, 0);
  assert.match(requests[1].userPrompt, /completed_blocks/);
  assert.equal(result.message.status, 'completed');
  assert.deepEqual(result.message.answerBlocks.map(item => item.blockId),
    ['only-page-one', 'added-page-two']);
});

test('ordinary non-selection chat still displays a complete block with unverified evidence', async () => {
  let streamCalls = 0;
  let jsonCalls = 0;
  const adapter = {
    generateTextStream() {
      streamCalls += 1;
      return (async function* generate() {
        yield { type: 'started' };
        yield { type: 'text_delta', text: completeRecords([{
          type: 'answer_block', block_id: 'legacy-unverified',
          markdown: 'Legacy navigation keeps the answer visible.[[1]]',
          evidence: [{ ...evidence(), quote: 'A quote absent from the article.' }]
        }], 'Legacy compatibility is retained.') };
        yield { type: 'completed', finishReason: 'stop' };
      })();
    },
    async generateJson() {
      jsonCalls += 1;
      throw new Error('Non-selection compatibility must not trigger strict repair');
    }
  };

  const result = await runArticleChat({ input: input(), profile, adapter });

  assert.equal(streamCalls, 1);
  assert.equal(jsonCalls, 0);
  assert.equal(result.message.status, 'completed');
  assert.equal(result.message.answerBlocks[0].blockId, 'legacy-unverified');
  assert.equal(result.message.answerBlocks[0].evidence[0].verification.status, 'missing');
  assert.equal(result.message.answerBlocks[0].evidence[0].verification.target, null);
});
