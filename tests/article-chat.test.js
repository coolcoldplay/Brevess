const test = require('node:test');
const assert = require('node:assert/strict');

require('../core/article-chat-tokenizer.js');
require('../core/article-chat-index.js');
require('../core/article-chat-retrieval.js');
require('../core/article-chat-memory.js');
require('../core/article-chat-citations.js');
require('../core/token-budget.js');
require('../providers/provider-registry.js');
require('../core/article-chat-context-planner.js');
require('../core/article-chat-stream.js');
const {
  normalizeArticleChatInput,
  prepareArticleChatRequest,
  compileArticleChatPrompt,
  runArticleChat
} = require('../core/article-chat.js');

function articleMessage(overrides = {}) {
  return {
    question: '作者用哪些证据支持核心机制？',
    profileId: 'profile_deepseek_chat',
    history: [],
    document: {
      title: 'Mechanistic paper',
      url: 'https://example.org/paper',
      revision: 3,
      paragraphs: [
        {
          paragraphId: 'p-results', sourceKey: 'results:1', textHash: 'hash-results',
          sectionId: 'results', sectionTitle: 'Results', sectionKind: 'results',
          sectionPath: ['Results'],
          text: 'Heat stress significantly increased circulating IL-6 after 24 hours.'
        },
        {
          paragraphId: 'p-discussion', sourceKey: 'discussion:1', textHash: 'hash-discussion',
          sectionId: 'discussion', sectionTitle: 'Discussion', sectionKind: 'discussion',
          sectionPath: ['Discussion'],
          text: 'The authors interpret IL-6 as a candidate systemic signal.'
        }
      ]
    },
    ...overrides
  };
}

const profile = {
  providerId: 'deepseek',
  config: { model: 'deepseek-v4-pro' },
  tokenPolicy: {},
  contextWindowTokens: 65536
};

function blockLine(blockId, markdown, paragraphId = 'p-results') {
  return JSON.stringify({
    type: 'answer_block',
    block_id: blockId,
    markdown,
    evidence: [{
      marker: '1', paragraph_id: paragraphId,
      source_key: paragraphId === 'p-results' ? 'results:1' : 'discussion:1',
      text_hash: paragraphId === 'p-results' ? 'hash-results' : 'hash-discussion',
      quote: paragraphId === 'p-results'
        ? 'Heat stress significantly increased circulating IL-6 after 24 hours.'
        : 'The authors interpret IL-6 as a candidate systemic signal.',
      section_path: [paragraphId === 'p-results' ? 'Results' : 'Discussion']
    }]
  });
}

test('normalizes complete history without a fixed conversation-count limit', () => {
  const history = Array.from({ length: 80 }, (_, index) => ({
    turnId: `turn-${index + 1}`,
    question: `question ${index + 1}`,
    answerBlocks: [{ blockId: `block-${index + 1}`, markdown: `answer ${index + 1}` }]
  }));
  const input = normalizeArticleChatInput(articleMessage({ history }));

  assert.equal(input.history.length, 80);
  assert.equal(input.history[0].turnId, 'turn-1');
  assert.equal(input.history.at(-1).turnId, 'turn-80');
});

test('prepares one indexed token-aware request and a stable-prefix NDJSON prompt', async () => {
  const input = normalizeArticleChatInput(articleMessage());
  const prepared = await prepareArticleChatRequest(input, profile);
  const first = compileArticleChatPrompt(input, prepared.plan);
  const followup = compileArticleChatPrompt({
    ...input, question: '这项机制的局限是什么？'
  }, prepared.plan);

  assert.equal(prepared.plan.mode, 'full');
  assert.ok(prepared.plan.outputBudgetTokens.initial >= 4096);
  assert.equal(prepared.plan.outputBudgetTokens.ceiling, 12288);
  assert.equal(first.stablePrefix, followup.stablePrefix);
  assert.ok(first.userPrompt.startsWith(first.stablePrefix));
  assert.match(first.systemPrompt, /NDJSON/);
  assert.match(first.systemPrompt, /answer_block/);
  assert.match(first.systemPrompt, /turn_summary/);
  assert.match(first.systemPrompt, /append \[\[marker\]\] immediately/);
  assert.equal('responseSchema' in first, false);
});

test('streams verified blocks, continues once after truncation, and deduplicates continuation', async () => {
  const requests = [];
  const progress = [];
  const firstBlock = blockLine(
    'block-1',
    '**核心证据**\n\nIL-6 在热应激后显著升高。[[1]]'
  );
  const secondBlock = blockLine(
    'block-2',
    '**机制解释**\n\n作者把 IL-6 解释为候选系统信号。[[1]]',
    'p-discussion'
  );
  const adapter = {
    generateTextStream(request) {
      requests.push(request);
      const attempt = requests.length;
      return (async function* stream() {
        yield { type: 'started' };
        if (attempt === 1) {
          yield { type: 'text_delta', text: `${firstBlock}\n{"type":"answer_block","block_id":"partial"` };
          yield { type: 'error', error: { code: 'OUTPUT_TRUNCATED', message: 'limit' } };
          return;
        }
        yield { type: 'text_delta', text: `${firstBlock}\n${secondBlock}\n` };
        yield { type: 'text_delta', text: `${JSON.stringify({
          type: 'turn_summary', summary: '热应激后 IL-6 升高，并被解释为候选系统信号。'
        })}\n${JSON.stringify({ type: 'final', status: 'completed' })}\n` };
        yield { type: 'usage', usage: { inputTokens: 100, outputTokens: 40 } };
        yield { type: 'completed', finishReason: 'stop' };
      })();
    }
  };

  const result = await runArticleChat({
    input: normalizeArticleChatInput(articleMessage({ turnId: 'turn-stream' })),
    profile,
    selectedProfileId: 'profile_deepseek_chat',
    adapter,
    onProgress: event => progress.push(event)
  });

  assert.equal(requests.length, 2);
  assert.equal(requests[0].selectedProfileId, 'profile_deepseek_chat');
  assert.equal(requests[1].selectedProfileId, 'profile_deepseek_chat');
  assert.match(requests[1].userPrompt, /block-1/);
  assert.deepEqual(result.message.answerBlocks.map(block => block.blockId), [
    'block-1', 'block-2'
  ]);
  assert.equal(result.message.answerBlocks[0].evidence[0].verification.status, 'verified');
  assert.equal(result.message.summary, '热应激后 IL-6 升高，并被解释为候选系统信号。');
  assert.equal(result.usage.outputTokens, 40);
  assert.ok(progress.every(event => event.turnId === 'turn-stream'));
  assert.deepEqual(progress.map(event => event.phase), [
    'chat_started', 'chat_context_ready', 'chat_answer_block',
    'chat_continuing', 'chat_answer_block', 'chat_usage', 'chat_completed'
  ]);
});

test('uses the same NDJSON parser when a provider returns the whole answer in one delta', async () => {
  const adapter = {
    generateTextStream() {
      return (async function* stream() {
        yield { type: 'started' };
        yield { type: 'text_delta', text: [
          blockLine('block-only', '结果段支持这一结论。[[1]]'),
          JSON.stringify({ type: 'turn_summary', summary: '结果段支持结论。' }),
          JSON.stringify({ type: 'final', status: 'completed' }),
          ''
        ].join('\n') };
        yield { type: 'completed', finishReason: 'stop' };
      })();
    }
  };
  const result = await runArticleChat({
    input: normalizeArticleChatInput(articleMessage()), profile, adapter
  });

  assert.equal(result.message.answerBlocks.length, 1);
  assert.equal(result.message.status, 'completed');
});

test('emits a terminal cancelled phase and preserves already completed blocks', async () => {
  const progress = [];
  const adapter = {
    generateTextStream() {
      return (async function* stream() {
        yield { type: 'started' };
        yield { type: 'text_delta', text: `${blockLine(
          'block-before-cancel', '取消前已经完成的回答。[[1]]'
        )}\n` };
        yield { type: 'cancelled' };
      })();
    }
  };

  await assert.rejects(() => runArticleChat({
    input: normalizeArticleChatInput(articleMessage()), profile, adapter,
    onProgress: event => progress.push(event)
  }), error => error.code === 'CANCELLED');
  assert.ok(progress.some(event =>
    event.phase === 'chat_answer_block' && event.block.blockId === 'block-before-cancel'
  ));
  assert.equal(progress.at(-1).phase, 'chat_cancelled');
});

test('does not continue after a non-truncation provider error', async () => {
  let requestCount = 0;
  const progress = [];
  const adapter = {
    generateTextStream() {
      requestCount += 1;
      return (async function* stream() {
        yield { type: 'started' };
        yield {
          type: 'error',
          error: { code: 'NETWORK_ERROR', message: 'provider unavailable' }
        };
      })();
    }
  };

  await assert.rejects(() => runArticleChat({
    input: normalizeArticleChatInput(articleMessage()), profile, adapter,
    onProgress: event => progress.push(event)
  }), error => error.code === 'NETWORK_ERROR');
  assert.equal(requestCount, 1);
  assert.equal(progress.some(event => event.phase === 'chat_continuing'), false);
  assert.equal(progress.at(-1).phase, 'chat_error');
});

test('continues at most once and returns complete blocks after repeated truncation', async () => {
  let requestCount = 0;
  const adapter = {
    generateTextStream() {
      requestCount += 1;
      const blockId = `block-truncated-${requestCount}`;
      return (async function* stream() {
        yield { type: 'started' };
        yield { type: 'text_delta', text: `${blockLine(
          blockId, `Complete block ${requestCount}. [[1]]`
        )}\n{\"type\":\"answer_block\",\"block_id\":\"partial-${requestCount}\"` };
        yield { type: 'error', error: { code: 'OUTPUT_TRUNCATED', message: 'limit' } };
      })();
    }
  };

  const result = await runArticleChat({
    input: normalizeArticleChatInput(articleMessage()), profile, adapter
  });

  assert.equal(requestCount, 2);
  assert.equal(result.message.status, 'truncated');
  assert.deepEqual(result.message.answerBlocks.map(block => block.blockId), [
    'block-truncated-1', 'block-truncated-2'
  ]);
});
