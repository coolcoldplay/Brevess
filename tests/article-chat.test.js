const test = require('node:test');
const assert = require('node:assert/strict');

require('../core/article-chat-tokenizer.js');
const { buildArticleChatIndex } = require('../core/article-chat-index.js');
const { retrieveArticleChatContext } = require('../core/article-chat-retrieval.js');
const {
  buildArticleChatMemory,
  retrieveArticleChatMemory
} = require('../core/article-chat-memory.js');
const { verifyArticleChatEvidence } = require('../core/article-chat-citations.js');
require('../core/token-budget.js');
require('../providers/provider-registry.js');
require('../core/article-chat-context-planner.js');
require('../core/article-chat-stream.js');
const {
  normalizeArticleChatInput,
  articleChatOutputUnits,
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

  assert.equal(prepared.plan.mode, 'retrieval');
  assert.ok(prepared.plan.outputBudgetTokens.initial >= 4096);
  assert.equal(prepared.plan.outputBudgetTokens.ceiling, 29440);
  assert.equal(first.stablePrefix, followup.stablePrefix);
  assert.ok(first.userPrompt.startsWith(first.stablePrefix));
  assert.match(first.systemPrompt, /NDJSON/);
  assert.match(first.systemPrompt, /answer_block/);
  assert.match(first.systemPrompt, /one answer_block per fully explained numbered step/i);
  assert.match(first.systemPrompt, /Number ordered steps continuously across answer_block records/i);
  assert.match(first.systemPrompt, /Use your judgment to match the depth/i);
  assert.match(first.systemPrompt, /Use as many answer_block records as the question needs/i);
  assert.match(first.systemPrompt, /Never emit a heading or numbered label as a block by itself/i);
  assert.match(first.systemPrompt, /Ground every paper-specific factual sentence or list item/i);
  assert.match(first.systemPrompt, /shortest complete source sentence or clause/i);
  assert.match(first.systemPrompt, /condition, parameter, group, time point, dose, sample size/i);
  assert.match(first.systemPrompt, /synthesizes evidence from several source paragraphs/i);
  assert.match(first.systemPrompt, /include one evidence object per paragraph/i);
  assert.doesNotMatch(first.systemPrompt, /at most 600 Chinese characters|Keep each answer_block compact/i);
  assert.match(first.systemPrompt, /turn_summary/);
  assert.match(first.systemPrompt, /append \[\[marker\]\] immediately/);
  assert.equal('responseSchema' in first, false);
});

test('allocates a larger initial answer budget for a stepwise evidence-chain question', async () => {
  const input = normalizeArticleChatInput(articleMessage({
    question: '这个研究如何一步一步找到介导攻击行为的关键神经元？'
  }));
  const prepared = await prepareArticleChatRequest(input, profile);

  assert.ok(prepared.plan.outputBudgetTokens.initial >= 8192);
  assert.ok(prepared.plan.outputBudgetTokens.initial <=
    prepared.plan.outputBudgetTokens.ceiling);
});

test('reserves more answer room for explanatory questions without inflating simple lookups', () => {
  assert.equal(articleChatOutputUnits('GAL4 品系是什么？'), 1);
  assert.equal(articleChatOutputUnits('作者如何定义热暴露的标准？'), 4);
  assert.equal(articleChatOutputUnits('为什么这条证据链能够支持该机制？'), 8);
});

test('retries once with a format-repair instruction after malformed streamed output', async () => {
  const requests = [];
  const progress = [];
  const adapter = {
    generateTextStream(request) {
      requests.push(request);
      const attempt = requests.length;
      return (async function* stream() {
        yield { type: 'started' };
        if (attempt === 1) {
          yield { type: 'text_delta', text: 'This is not the requested NDJSON.\n' };
        } else {
          yield { type: 'text_delta', text: [
            blockLine('block-repaired', '结果段支持该结论。[[1]]'),
            JSON.stringify({ type: 'turn_summary', summary: '结果段支持结论。' }),
            JSON.stringify({ type: 'final', status: 'completed' }),
            ''
          ].join('\n') };
        }
        yield { type: 'completed', finishReason: 'stop' };
      })();
    }
  };

  const result = await runArticleChat({
    input: normalizeArticleChatInput(articleMessage()), profile, adapter,
    onProgress: event => progress.push(event)
  });

  assert.equal(requests.length, 2);
  assert.match(requests[1].userPrompt, /format or citation validation/i);
  assert.equal(result.message.answerBlocks[0].blockId, 'block-repaired');
  assert.ok(progress.some(event => event.phase === 'chat_repairing_format'));
});

test('does not accept a final record after a later answer block failed validation', async () => {
  const requests = [];
  const adapter = {
    generateTextStream(request) {
      requests.push(request);
      const attempt = requests.length;
      return (async function* stream() {
        yield { type: 'started' };
        if (attempt === 1) {
          yield { type: 'text_delta', text: `${JSON.stringify({
            type: 'answer_block', block_id: 'block-intro',
            markdown: 'The evidence chain has several stages.', evidence: []
          })}\n` };
          yield { type: 'text_delta', text: `${JSON.stringify({
            type: 'answer_block', block_id: 'block-invalid',
            markdown: 'The first stage is supported by the Results. [[2]]', evidence: []
          })}\n` };
          yield { type: 'text_delta', text: `${JSON.stringify({
            type: 'turn_summary', summary: 'The response attempted an evidence chain.'
          })}\n${JSON.stringify({ type: 'final', status: 'completed' })}\n` };
        } else {
          yield { type: 'text_delta', text: [
            blockLine('block-step-1', 'The first stage is supported by the Results. [[1]]'),
            JSON.stringify({ type: 'turn_summary', summary: 'The evidence chain is complete.' }),
            JSON.stringify({ type: 'final', status: 'completed' }),
            ''
          ].join('\n') };
        }
        yield { type: 'completed', finishReason: 'stop' };
      })();
    }
  };

  const result = await runArticleChat({
    input: normalizeArticleChatInput(articleMessage()), profile, adapter
  });

  assert.equal(requests.length, 2);
  assert.match(requests[1].userPrompt, /format or citation validation/i);
  assert.match(requests[1].userPrompt, /completed_blocks/);
  assert.match(requests[1].userPrompt, /The evidence chain has several stages/);
  assert.deepEqual(result.message.answerBlocks.map(block => block.blockId), [
    'block-intro', 'block-step-1'
  ]);
});

test('reports exhausted format recovery as incomplete instead of an output limit', async () => {
  let requestCount = 0;
  const adapter = {
    generateTextStream() {
      requestCount += 1;
      return (async function* stream() {
        yield { type: 'started' };
        if (requestCount === 1) {
          yield { type: 'text_delta', text: `${JSON.stringify({
            type: 'answer_block', block_id: 'block-preserved',
            markdown: 'A validated introduction remains visible.', evidence: []
          })}\n` };
        }
        yield { type: 'text_delta', text: `${JSON.stringify({
          type: 'answer_block', block_id: `block-invalid-${requestCount}`,
          markdown: 'An invalid leading marker follows. [[2]]', evidence: []
        })}\n` };
        yield { type: 'text_delta', text: `${JSON.stringify({
          type: 'turn_summary', summary: 'The response is still incomplete.'
        })}\n${JSON.stringify({ type: 'final', status: 'completed' })}\n` };
        yield { type: 'completed', finishReason: 'stop' };
      })();
    }
  };

  const result = await runArticleChat({
    input: normalizeArticleChatInput(articleMessage()), profile, adapter
  });

  assert.equal(requestCount, 8);
  assert.equal(result.message.status, 'incomplete');
  assert.match(result.message.limitations, /格式或引用校验/);
  assert.doesNotMatch(result.message.limitations, /output limit/i);
});

test('continues an answer that ends with a dangling promise of following steps', async () => {
  const requests = [];
  const adapter = {
    generateTextStream(request) {
      requests.push(request);
      const attempt = requests.length;
      return (async function* stream() {
        yield { type: 'started' };
        if (attempt === 1) {
          yield { type: 'text_delta', text: [
            JSON.stringify({
              type: 'answer_block', block_id: 'block-lead-in',
              markdown: '作者采用了系统性筛选，主要分为以下几个步骤：', evidence: []
            }),
            JSON.stringify({ type: 'turn_summary', summary: 'An unfinished stepwise answer.' }),
            JSON.stringify({ type: 'final', status: 'completed' }),
            ''
          ].join('\n') };
        } else {
          yield { type: 'text_delta', text: [
            blockLine('block-step', 'The first step is supported by the Results. [[1]]'),
            JSON.stringify({ type: 'turn_summary', summary: 'The stepwise answer is complete.' }),
            JSON.stringify({ type: 'final', status: 'completed' }),
            ''
          ].join('\n') };
        }
        yield { type: 'completed', finishReason: 'stop' };
      })();
    }
  };

  const result = await runArticleChat({
    input: normalizeArticleChatInput(articleMessage()), profile, adapter
  });

  assert.equal(requests.length, 2);
  assert.match(requests[1].userPrompt, /ended after promising details/i);
  assert.deepEqual(result.message.answerBlocks.map(block => block.blockId), [
    'block-lead-in', 'block-step'
  ]);
});

test('continues until every explicitly promised numbered step is present', async () => {
  const requests = [];
  const adapter = {
    generateTextStream(request) {
      requests.push(request);
      const attempt = requests.length;
      return (async function* stream() {
        yield { type: 'started' };
        if (attempt === 1) {
          yield { type: 'text_delta', text: [
            JSON.stringify({
              type: 'answer_block', block_id: 'overview',
              markdown: '研究过程大致分为四个步骤。', evidence: []
            }),
            JSON.stringify({
              type: 'answer_block', block_id: 'step-1',
              markdown: '1. 完成第一步筛选', evidence: []
            }),
            JSON.stringify({
              type: 'answer_block', block_id: 'step-2',
              markdown: '2. 完成第二步定位', evidence: []
            }),
            JSON.stringify({
              type: 'answer_block', block_id: 'step-3',
              markdown: '3. 完成第三步验证', evidence: []
            }),
            JSON.stringify({ type: 'turn_summary', summary: 'Only three of four steps.' }),
            JSON.stringify({ type: 'final', status: 'completed' }),
            ''
          ].join('\n') };
        } else {
          yield { type: 'text_delta', text: [
            JSON.stringify({
              type: 'answer_block', block_id: 'step-4',
              markdown: '4. 完成第四步机制确认', evidence: []
            }),
            JSON.stringify({ type: 'turn_summary', summary: 'All four steps are complete.' }),
            JSON.stringify({ type: 'final', status: 'completed' }),
            ''
          ].join('\n') };
        }
        yield { type: 'completed', finishReason: 'stop' };
      })();
    }
  };

  const result = await runArticleChat({
    input: normalizeArticleChatInput(articleMessage()), profile, adapter
  });

  assert.equal(requests.length, 2);
  assert.match(requests[1].userPrompt, /every missing item/i);
  assert.deepEqual(result.message.answerBlocks.map(block => block.blockId), [
    'overview', 'step-1', 'step-2', 'step-3', 'step-4'
  ]);
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

test('raises the safe continuation budget when truncation occurs before the first complete block', async () => {
  const requests = [];
  const progress = [];
  const adapter = {
    generateTextStream(request) {
      requests.push(request);
      const attempt = requests.length;
      return (async function* stream() {
        yield { type: 'started' };
        if (attempt === 1) {
          yield { type: 'text_delta', text: '{"type":"answer_block","block_id":"partial"' };
          yield { type: 'error', error: { code: 'OUTPUT_TRUNCATED', message: 'limit' } };
          return;
        }
        yield { type: 'text_delta', text: [
          blockLine('block-after-limit', '第一步由结果段支持。[[1]]'),
          JSON.stringify({ type: 'turn_summary', summary: '结果段支持第一步。' }),
          JSON.stringify({ type: 'final', status: 'completed' }),
          ''
        ].join('\n') };
        yield { type: 'completed', finishReason: 'stop' };
      })();
    }
  };

  const result = await runArticleChat({
    input: normalizeArticleChatInput(articleMessage()), profile, adapter,
    onProgress: event => progress.push(event)
  });

  assert.equal(requests.length, 2);
  assert.ok(requests[1].maxOutputTokens > requests[0].maxOutputTokens);
  assert.ok(requests[1].maxOutputTokens <= 32768);
  assert.match(requests[1].userPrompt, /truncated before completing/i);
  assert.equal(result.message.answerBlocks[0].blockId, 'block-after-limit');
  assert.ok(progress.some(event => event.phase === 'chat_continuing'));
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

test('continues through bounded segments and returns complete blocks after repeated truncation', async () => {
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

  assert.equal(requestCount, 8);
  assert.equal(result.message.status, 'truncated');
  assert.deepEqual(result.message.answerBlocks.map(block => block.blockId),
    Array.from({ length: 8 }, (_, index) => `block-truncated-${index + 1}`));
});

test('keeps streaming until a later continuation produces a final record', async () => {
  let requestCount = 0;
  const adapter = {
    generateTextStream() {
      requestCount += 1;
      const attempt = requestCount;
      return (async function* stream() {
        yield { type: 'started' };
        yield { type: 'text_delta', text: `${blockLine(
          `block-segment-${attempt}`, `Complete segment ${attempt}. [[1]]`
        )}\n` };
        if (attempt < 4) {
          yield { type: 'error', error: { code: 'OUTPUT_TRUNCATED', message: 'limit' } };
          return;
        }
        yield { type: 'text_delta', text: `${JSON.stringify({
          type: 'turn_summary', summary: 'Recovered across four output segments.'
        })}\n${JSON.stringify({ type: 'final', status: 'completed' })}\n` };
        yield { type: 'completed', finishReason: 'stop' };
      })();
    }
  };

  const result = await runArticleChat({
    input: normalizeArticleChatInput(articleMessage()), profile, adapter
  });

  assert.equal(requestCount, 4);
  assert.equal(result.message.status, 'completed');
  assert.equal(result.message.answerBlocks.length, 4);
});

function scaleParagraphs(count) {
  const sections = [
    ['Abstract', 'abstract'], ['Introduction', 'introduction'],
    ['Results', 'results'], ['Discussion', 'discussion'], ['Conclusion', 'conclusion']
  ];
  return Array.from({ length: count }, (_, index) => {
    const [sectionTitle, sectionKind] = sections[index % sections.length];
    const rare = index === count - 17
      ? 'rare-neuroaxis-CRISPR rescue restored thermoregulation without changing food intake.'
      : `Replicate ${index + 1} measured heat stress, metabolism, signaling, and controls.`;
    return {
      paragraphId: `scale-p-${index + 1}`,
      sourceKey: `scale-source-${index + 1}`,
      textHash: `scale-hash-${index + 1}`,
      sectionId: `scale-${sectionKind}`,
      sectionTitle,
      sectionKind,
      sectionPath: [sectionTitle],
      text: `${rare} This paragraph preserves a stable scientific evidence record.`
    };
  });
}

test('100 to 500 paragraph fixtures keep broad coverage and narrow evidence bounded', async () => {
  const small = scaleParagraphs(100);
  const large = scaleParagraphs(500);
  const smallIndex = buildArticleChatIndex({
    documentHash: 'scale-small', revision: 1, paragraphs: small
  }, { minChars: 80, targetChars: 220, maxChars: 360 });
  const largeIndex = buildArticleChatIndex({
    documentHash: 'scale-large', revision: 1, paragraphs: large
  }, { minChars: 80, targetChars: 220, maxChars: 360 });
  const broad = await retrieveArticleChatContext(
    smallIndex, '请概括全文的研究背景、主要发现和结论',
    { maxChars: 12000, limit: 8, neighborRadius: 0 }
  );
  const narrow = await retrieveArticleChatContext(
    largeIndex, 'rare-neuroaxis-CRISPR rescue 对 food intake 有什么影响？',
    { maxChars: 4000, limit: 6, neighborRadius: 1 }
  );

  assert.equal(broad.coverage.broadQuery, true);
  for (const kind of ['abstract', 'introduction', 'results', 'discussion', 'conclusion']) {
    assert.ok(broad.coverage.selectedSectionKinds.includes(kind), kind);
  }
  assert.ok(narrow.chunks.some(chunk => chunk.text.includes('rare-neuroaxis-CRISPR')));
  assert.ok(narrow.selectedChars <= 4000);
  assert.ok(narrow.chunks.length < largeIndex.chunks.length);
});

test('5,000 turns remain searchable without a conversation-count cap', () => {
  const history = Array.from({ length: 5000 }, (_, index) => ({
    turnId: `scale-turn-${index + 1}`,
    question: index === 16
      ? 'What did the rare-synaptic-lipid result show?'
      : `Question ${index + 1} about the common result`,
    answer: index === 16
      ? 'The rare-synaptic-lipid response was reversible.'
      : `Answer ${index + 1} summarizes a common result.`,
    createdAt: index + 1
  }));
  const normalized = normalizeArticleChatInput(articleMessage({ history }));
  const memory = buildArticleChatMemory(normalized.history);
  const found = retrieveArticleChatMemory(memory, 'rare-synaptic-lipid reversible', {
    limit: 4
  });

  assert.equal(normalized.history.length, 5000);
  assert.equal(memory.entries.length, 5000);
  assert.equal(found[0].turnId, 'scale-turn-17');
  assert.ok(memory.entries.every(entry => entry.tokens.length <= 1024));
});

test('duplicate evidence across a 500-paragraph fixture never creates a jump target', () => {
  const duplicate = 'This repeated evidence sentence is intentionally non-unique.';
  const paragraphs = scaleParagraphs(500).map((paragraph, index) => ({
    ...paragraph,
    text: index % 25 === 0 ? duplicate : paragraph.text
  }));
  const result = verifyArticleChatEvidence({ quote: duplicate }, {
    revision: 1, paragraphs
  });

  assert.equal(result.status, 'ambiguous');
  assert.equal(result.candidateCount, 20);
  assert.equal(result.target, null);
});
