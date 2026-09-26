const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isSafeWebSourceUrl,
  normalizeArticleChatWebResponse,
  normalizeArticleChatWebGroundingResponse,
  createArticleChatWebGroundingReceipt,
  normalizeArticleChatWebGroundingReceipt
} = require('../core/article-chat-web-sources.js');

test('retains only a complete final web answer as explicitly unverified when source metadata is absent or invalid', () => {
  const fixture = groundedFixture();
  const identity = { providerId: 'deepseek', model: 'deepseek-v4-flash' };
  for (const annotations of [[], undefined, [{ type: 'url_citation', url: 'javascript:alert(1)', start_index: 0, end_index: 1 }]]) {
    const result = normalizeArticleChatWebResponse(completedResponse({ text: fixture.text, annotations }), identity);
    assert.equal(result.text, fixture.text);
    assert.equal(result.grounding, null);
    assert.deepEqual(result.answerProvenance, { origin: 'provider_unverified', verification: 'unverified' });
  }
  const multiple = completedResponse({ text: fixture.text, annotations: [] });
  multiple.output.unshift({ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Searching for relevant papers.' }] });
  delete multiple.output_text;
  assert.equal(normalizeArticleChatWebResponse(multiple, identity).text, fixture.text);
  const narrated = completedResponse({ text: `Search finished.\nHere is the requested response:\n${fixture.text}`, annotations: [] });
  assert.equal(normalizeArticleChatWebResponse(narrated, identity).text, fixture.text);
  const damaged = completedResponse({ text: `{broken record\n${fixture.text}`, annotations: [] });
  assert.throws(() => normalizeArticleChatWebResponse(damaged, identity));
  multiple.output.push({ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Here are the findings:' }] });
  assert.throws(() => normalizeArticleChatWebResponse(multiple, identity));
  for (const changed of [
    { ...fixture.response, status: 'incomplete' },
    completedResponse({ text: fixture.text.split('\n').slice(0, -1).join('\n'), annotations: [] }),
    { ...fixture.response, output_text: 'conflicting answer' }
  ]) assert.throws(() => normalizeArticleChatWebResponse(changed, identity));
  const trusted = normalizeArticleChatWebResponse(fixture.response, identity);
  assert.equal(trusted.grounding.sources.length, 2);
  assert.equal(trusted.answerProvenance, undefined);
});

function completedResponse({
  text,
  annotations,
  responseId = 'resp_grounded_001',
  webStatus = 'completed',
  status = 'completed'
}) {
  return {
    id: responseId,
    status,
    output_text: text,
    output: [
      {
        id: 'ws_001',
        type: 'web_search_call',
        status: webStatus,
        action: { type: 'search', queries: ['recent evidence'] }
      },
      {
        id: 'msg_001',
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text, annotations }]
      }
    ],
    usage: { input_tokens: 41, output_tokens: 19 }
  };
}

function nativeMarkdownResponse({
  markdown = '## Final answer\n\nA complete native Markdown answer.',
  annotations = [],
  responseStatus = 'completed',
  messageStatus = 'completed',
  role = 'assistant',
  phase = 'final_answer',
  trailingMessage = null
} = {}) {
  const output = [{
    id: 'commentary-1', type: 'message', role: 'assistant',
    status: 'completed', phase: 'commentary',
    content: [{ type: 'output_text', text: 'I will search before answering.', annotations: [] }]
  }, {
    id: 'search-1', type: 'web_search_call', status: 'completed'
  }, {
    id: 'final-1', type: 'message', role, status: messageStatus, phase,
    content: [{ type: 'output_text', text: markdown, annotations }]
  }];
  if (trailingMessage) output.push(trailingMessage);
  return {
    id: 'resp_native_markdown_001', status: responseStatus,
    output_text: `I will search before answering.\n${markdown}`,
    output,
    usage: { input_tokens: 91, output_tokens: 37 }
  };
}

test('normalizes only the final DeepSeek phase as one native Markdown answer block', () => {
  const markdown = [
    '## 完整回答',
    '',
    '搜索过程不会进入答案。',
    '',
    '- 保留原始 Markdown [普通链接](https://untrusted.example/path)。'
  ].join('\n');
  const normalized = normalizeArticleChatWebResponse(
    nativeMarkdownResponse({ markdown }),
    { providerId: 'deepseek', model: 'deepseek-v4-flash' },
    { answerFormat: 'markdown' }
  );
  const records = normalized.text.split('\n').map(JSON.parse);

  assert.equal(records[0].type, 'answer_block');
  assert.equal(records[0].block_id, 'block-1');
  assert.equal(records[0].markdown, markdown);
  assert.deepEqual(records[0].evidence, []);
  assert.deepEqual(records[1], { type: 'final', status: 'completed' });
  assert.equal(normalized.answerBlocks.length, 1);
  assert.equal(normalized.answerBlocks[0].blockId, 'block-1');
  assert.equal(normalized.text.includes('I will search before answering.'), false);
  assert.equal(normalized.grounding, null);
  assert.deepEqual(normalized.answerProvenance,
    { origin: 'provider_unverified', verification: 'unverified' });
});

test('binds valid native Markdown url citations and downgrades invalid metadata without changing text', () => {
  const markdown = '## 更新\n\nNIH reports a recent result.';
  const start = markdown.indexOf('NIH reports');
  const identity = { providerId: 'deepseek', model: 'deepseek-v4-flash' };
  const valid = normalizeArticleChatWebResponse(nativeMarkdownResponse({
    markdown,
    annotations: [{
      type: 'url_citation', start_index: start,
      end_index: start + 'NIH reports'.length,
      url: 'https://www.nih.gov/news/native-source', title: 'NIH source'
    }]
  }), identity, { answerFormat: 'markdown' });

  assert.equal(valid.answerProvenance, undefined);
  assert.equal(valid.grounding.sources.length, 1);
  assert.equal(valid.grounding.sources[0].url,
    'https://www.nih.gov/news/native-source');
  assert.deepEqual(valid.grounding.sources[0].blockIds, ['block-1']);

  const invalid = normalizeArticleChatWebResponse(nativeMarkdownResponse({
    markdown,
    annotations: [{
      type: 'url_citation', start_index: start,
      end_index: start + 'NIH reports'.length,
      url: 'https://127.0.0.1/private', title: 'unsafe'
    }]
  }), identity, { answerFormat: 'markdown' });
  assert.equal(JSON.parse(invalid.text.split('\n')[0]).markdown, markdown);
  assert.equal(invalid.grounding, null);
  assert.equal(invalid.answerProvenance.origin, 'provider_unverified');
});

test('rejects incomplete, commentary-only, non-assistant, blank, oversized, or nonterminal native Markdown', () => {
  const identity = { providerId: 'deepseek', model: 'deepseek-v4-flash' };
  const commentaryOnly = nativeMarkdownResponse();
  commentaryOnly.output = commentaryOnly.output.slice(0, 2);
  const cases = [
    commentaryOnly,
    nativeMarkdownResponse({ responseStatus: 'incomplete' }),
    nativeMarkdownResponse({ messageStatus: 'incomplete' }),
    nativeMarkdownResponse({ role: 'user' }),
    nativeMarkdownResponse({ phase: 'commentary' }),
    nativeMarkdownResponse({ markdown: '   ' }),
    nativeMarkdownResponse({ markdown: 'A'.repeat(65537) }),
    nativeMarkdownResponse({ trailingMessage: {
      id: 'commentary-late', type: 'message', role: 'assistant',
      status: 'completed', phase: 'commentary',
      content: [{ type: 'output_text', text: 'late narration', annotations: [] }]
    } })
  ];
  for (const raw of cases) {
    assert.throws(
      () => normalizeArticleChatWebResponse(raw, identity, { answerFormat: 'markdown' }),
      error => error.code === 'INVALID_RESPONSE'
    );
  }
});

test('unverified complete web records preserve the first inline block and literal string line breaks', () => {
  const identity = { providerId: 'deepseek', model: 'deepseek-v4-flash' };
  const first = JSON.stringify({ type: 'answer_block', block_id: 'first', markdown: 'First complete answer.' });
  const second = '{"type":"answer_block","block_id":"second","markdown":"Point one.\nPoint two.\r\nPoint three.\tDone.","evidence":[]}';
  const final = '{"type":"final","status":"completed"}';
  const normalized = normalizeArticleChatWebResponse(completedResponse({
    text: `Search narration.\nNow the answer:${first}\n${second}\n${final}`, annotations: []
  }), identity);
  const records = normalized.text.split('\n').map(JSON.parse);
  assert.deepEqual(normalized.answerBlocks.map(block => block.blockId), ['first', 'second']);
  assert.equal(records[0].markdown, 'First complete answer.');
  assert.equal(records[1].markdown, 'Point one.\nPoint two.\r\nPoint three.\tDone.');
  assert.equal(normalized.grounding, null);
  assert.equal(normalized.answerProvenance.origin, 'provider_unverified');
  for (const text of [
    `{broken record\n${first}\n${final}`,
    `Narration:{"type":"answer_block","block_id":"missing"\n${first}\n${final}`,
    `${first}\n${second}`,
    `${first}\n${final}\n${second}`,
    `${first}\n{"type":"answer_block","block_id":"bad","markdown":"unterminated\n${final}`,
    `${first}\n{"type":"answer_block","block_id":"bad","markdown":"bad\\q"}\n${final}`,
    `${first}\ninterleaved narration\n${final}`
  ]) assert.throws(() => normalizeArticleChatWebResponse(completedResponse({ text, annotations: [] }), identity));
});

function groundedFixture() {
  const first = JSON.stringify({
    type: 'answer_block',
    block_id: 'answer-1',
    markdown: 'Recent evidence supports the first claim.'
  });
  const second = JSON.stringify({
    type: 'answer_block',
    block_id: 'answer-2',
    markdown: 'A second source supports the follow-up.'
  });
  const final = JSON.stringify({ type: 'final', status: 'completed' });
  const text = `${first}\n${second}\n${final}`;
  const firstStart = text.indexOf('first claim');
  const secondStart = text.indexOf('second source');
  return {
    text,
    response: completedResponse({
      text,
      annotations: [
        {
          type: 'url_citation',
          start_index: firstStart,
          end_index: firstStart + 'first claim'.length,
          url: 'https://journals.example.org/article?id=7',
          title: 'Primary evidence'
        },
        {
          type: 'url_citation',
          start_index: secondStart,
          end_index: secondStart + 'second source'.length,
          url: 'https://journals.example.org/article?id=7',
          title: 'Primary evidence'
        },
        {
          type: 'url_citation',
          start_index: secondStart,
          end_index: secondStart + 'second source'.length,
          url: 'https://www.nih.gov/news/example',
          title: 'NIH update'
        }
      ]
    })
  };
}

test('normalizes only completed Responses grounding and binds deduplicated sources to answer blocks', () => {
  const fixture = groundedFixture();
  const result = normalizeArticleChatWebGroundingResponse(fixture.response, {
    providerId: 'openai', model: 'gpt-5-mini'
  });

  assert.equal(result.text, fixture.text);
  assert.deepEqual(result.answerBlocks.map(item => item.blockId), ['answer-1', 'answer-2']);
  assert.equal(result.grounding.schemaVersion, 1);
  assert.equal(result.grounding.providerId, 'openai');
  assert.equal(result.grounding.model, 'gpt-5-mini');
  assert.equal(result.grounding.providerResponseId, 'resp_grounded_001');
  assert.equal(result.grounding.searched, true);
  assert.equal(result.grounding.sources.length, 2);
  assert.deepEqual(result.grounding.sources[0].blockIds, ['answer-1', 'answer-2']);
  assert.equal(result.grounding.sources[0].hostname, 'journals.example.org');
  assert.match(result.grounding.sources[0].sourceId, /^web-source-[a-f0-9]{16}$/);
  assert.deepEqual(result.usage, { input_tokens: 41, output_tokens: 19 });
});

test('requires completed response, a completed search call, one final output text, and real citations', () => {
  const fixture = groundedFixture();
  const cases = [
    completedResponse({ text: fixture.text, annotations: [], status: 'incomplete' }),
    completedResponse({ text: fixture.text, annotations: [], webStatus: 'in_progress' }),
    completedResponse({ text: fixture.text, annotations: [] }),
    {
      ...fixture.response,
      output_text: `${fixture.text}tampered`
    },
    {
      ...fixture.response,
      output: [...fixture.response.output, {
        type: 'message', status: 'completed',
        content: [{ type: 'output_text', text: 'second text', annotations: [] }]
      }]
    }
  ];
  for (const value of cases) {
    assert.throws(
      () => normalizeArticleChatWebGroundingResponse(
        value, { providerId: 'openai', model: 'gpt-5-mini' }
      ),
      error => ['INVALID_RESPONSE', 'WEB_SEARCH_GROUNDING_MISSING'].includes(error.code)
    );
  }
});

test('fails closed when a citation is out of range, crosses NDJSON blocks, or targets a non-answer line', () => {
  const fixture = groundedFixture();
  const newline = fixture.text.indexOf('\n');
  const finalStart = fixture.text.lastIndexOf('{"type":"final"');
  const typeValueStart = fixture.text.indexOf('answer_block');
  const blockIdValueStart = fixture.text.indexOf('answer-1');
  const markdownKeyStart = fixture.text.indexOf('markdown');
  const invalidAnnotations = [
    [{
      type: 'url_citation', start_index: -1, end_index: 4,
      url: 'https://example.org/source', title: 'Source'
    }],
    [{
      type: 'url_citation', start_index: newline - 2, end_index: newline + 2,
      url: 'https://example.org/source', title: 'Source'
    }],
    [{
      type: 'url_citation', start_index: finalStart, end_index: finalStart + 5,
      url: 'https://example.org/source', title: 'Source'
    }],
    [{
      type: 'url_citation', start_index: typeValueStart,
      end_index: typeValueStart + 'answer_block'.length,
      url: 'https://example.org/source', title: 'Source'
    }],
    [{
      type: 'url_citation', start_index: blockIdValueStart,
      end_index: blockIdValueStart + 'answer-1'.length,
      url: 'https://example.org/source', title: 'Source'
    }],
    [{
      type: 'url_citation', start_index: markdownKeyStart,
      end_index: markdownKeyStart + 'markdown'.length,
      url: 'https://example.org/source', title: 'Source'
    }]
  ];

  invalidAnnotations.forEach(annotations => {
    assert.throws(
      () => normalizeArticleChatWebGroundingResponse(
        completedResponse({ text: fixture.text, annotations }),
        { providerId: 'openai', model: 'gpt-5-mini' }
      ),
      error => error.code === 'INVALID_RESPONSE'
    );
  });
});

test('rejects a citation that only survives beyond the displayed markdown boundary', () => {
  const markdown = `${'A'.repeat(65536)} External evidence.`;
  const line = JSON.stringify({
    type: 'answer_block', block_id: 'answer-oversized', markdown
  });
  const text = `${line}\n{"type":"final","status":"completed"}`;
  const start = text.indexOf('External evidence.');

  assert.throws(
    () => normalizeArticleChatWebGroundingResponse(completedResponse({
      text,
      annotations: [{
        type: 'url_citation', start_index: start,
        end_index: start + 'External evidence.'.length,
        url: 'https://www.nih.gov/source', title: 'NIH source'
      }]
    }), { providerId: 'openai', model: 'gpt-5-mini' }),
    error => error.code === 'INVALID_RESPONSE'
  );
});

test('rejects a cited suffix truncated after CRLF-heavy markdown reaches the display boundary', () => {
  const markdown = `${'A'.repeat(65510)}${'\r\n'.repeat(20)}External evidence.`;
  const line = JSON.stringify({
    type: 'answer_block', block_id: 'answer-crlf-oversized', markdown
  });
  const text = `${line}\n{"type":"final","status":"completed"}`;
  const start = text.indexOf('External evidence.');

  assert.throws(
    () => normalizeArticleChatWebGroundingResponse(completedResponse({
      text,
      annotations: [{
        type: 'url_citation', start_index: start,
        end_index: start + 'External evidence.'.length,
        url: 'https://www.nih.gov/source', title: 'NIH source'
      }]
    }), { providerId: 'openai', model: 'gpt-5-mini' }),
    error => error.code === 'INVALID_RESPONSE'
  );
});

test('accepts cited markdown at the exact 65536-character display boundary', () => {
  const suffix = 'External evidence.';
  const markdown = `${'A'.repeat(65536 - suffix.length)}${suffix}`;
  const line = JSON.stringify({
    type: 'answer_block', block_id: 'answer-exact-boundary', markdown
  });
  const text = `${line}\n{"type":"final","status":"completed"}`;
  const start = text.indexOf(suffix);
  const normalized = normalizeArticleChatWebGroundingResponse(completedResponse({
    text,
    annotations: [{
      type: 'url_citation', start_index: start, end_index: start + suffix.length,
      url: 'https://www.nih.gov/source', title: 'NIH source'
    }]
  }), { providerId: 'openai', model: 'gpt-5-mini' });

  assert.equal(normalized.answerBlocks[0].blockId, 'answer-exact-boundary');
  assert.deepEqual(normalized.grounding.sources[0].blockIds, ['answer-exact-boundary']);
});

test('accepts only public HTTPS citation URLs and never extracts Markdown links as grounding', () => {
  for (const value of [
    'https://example.org/article',
    'https://8.8.8.8/article',
    'https://[2606:4700:4700::1111]/article'
  ]) assert.equal(isSafeWebSourceUrl(value), true, value);

  for (const value of [
    'http://example.org/article',
    'javascript:alert(1)',
    'https://user:pass@example.org/',
    'https://localhost/source',
    'https://localhost./source',
    'https://api.internal/source',
    'https://api.internal./source',
    'https://project.local/source',
    'https://10.0.0.1/source',
    'https://127.0.0.1/source',
    'https://169.254.1.2/source',
    'https://172.16.4.5/source',
    'https://192.168.1.2/source',
    'https://192.0.2.4/source',
    'https://198.51.100.3/source',
    'https://203.0.113.9/source',
    'https://[::1]/source',
    'https://[fe80::1]/source',
    'https://[fd00::1]/source',
    'https://[64:ff9b::a00:1]/source',
    'https://[2001::1]/source',
    'https://[2001:db8::1]/source'
  ]) assert.equal(isSafeWebSourceUrl(value), false, value);

  const line = JSON.stringify({
    type: 'answer_block', block_id: 'answer-1',
    markdown: 'An untrusted [link](https://untrusted.example/path) appears here.'
  });
  assert.throws(
    () => normalizeArticleChatWebGroundingResponse(
      completedResponse({ text: `${line}\n{"type":"final","status":"completed"}`, annotations: [] }), {
      providerId: 'openai', model: 'gpt-5-mini'
      }
    ),
    error => error.code === 'WEB_SEARCH_GROUNDING_MISSING'
  );
});

test('creates a durable receipt whose identity covers route, question, answer, blocks, and sources', () => {
  const normalized = normalizeArticleChatWebGroundingResponse(groundedFixture().response, {
    providerId: 'openai', model: 'gpt-5-mini'
  });
  const binding = {
    providerId: 'openai',
    model: 'gpt-5-mini',
    turnId: 'turn-001',
    operationId: 'operation-001',
    question: 'What changed recently?',
    answer: normalized.text,
    answerBlocks: normalized.answerBlocks,
    grounding: normalized.grounding
  };
  const receipt = createArticleChatWebGroundingReceipt(binding);

  assert.match(receipt.receiptId, /^web-source-receipt-v1-sha256-[a-f0-9]{64}$/);
  assert.deepEqual(normalizeArticleChatWebGroundingReceipt(receipt, binding), receipt);

  for (const [field, value] of [
    ['providerId', 'deepseek'],
    ['model', 'gpt-5'],
    ['turnId', 'turn-002'],
    ['operationId', 'operation-002'],
    ['question', 'A different question'],
    ['answer', `${normalized.text} changed`],
    ['answerBlocks', [{ ...normalized.answerBlocks[0], blockId: 'answer-changed' }]]
  ]) {
    assert.equal(
      normalizeArticleChatWebGroundingReceipt(receipt, { ...binding, [field]: value }),
      null,
      field
    );
  }

  const tampered = structuredClone(receipt);
  tampered.grounding.sources[0].url = 'https://attacker.example/source';
  assert.equal(normalizeArticleChatWebGroundingReceipt(tampered, binding), null);
});

test('rejects missing, invalid, duplicate, or nonterminal final records before accepting web grounding', () => {
  const fixture = groundedFixture();
  const lines = fixture.text.split('\n');
  const answers = lines.slice(0, -1);
  const invalidTexts = [
    answers.join('\n'),
    [...answers, '{"type":"final"}'].join('\n'),
    [...answers, '{"type":"final","status":"failed"}'].join('\n'),
    [...answers, '{"type":"final","status":"truncated"}'].join('\n'),
    [...lines, lines.at(-1)].join('\n'),
    [lines.at(-1), ...answers].join('\n'),
    [...lines, '{"type":"turn_summary","summary":"late"}'].join('\n')
  ];
  for (const text of invalidTexts) {
    const start = text.indexOf('first claim');
    assert.throws(() => normalizeArticleChatWebGroundingResponse(completedResponse({
      text,
      annotations: [{ type: 'url_citation', start_index: start, end_index: start + 11,
        url: 'https://www.nih.gov/source', title: 'Source' }]
    }), { providerId: 'openai', model: 'gpt-5-mini' }),
    error => error.code === 'INVALID_RESPONSE', text);
  }
});

test('the web runner rejects an invalid final even when an adapter supplies grounding', async () => {
  for (const moduleName of ['article-chat-tokenizer', 'article-chat-index',
    'article-chat-retrieval', 'article-chat-memory', 'article-chat-citations',
    'token-budget', 'article-chat-context-planner', 'article-chat-stream']) {
    require(`../core/${moduleName}.js`);
  }
  const { normalizeArticleChatInput, runArticleChat } = require('../core/article-chat.js');
  const fixture = groundedFixture();
  const grounding = normalizeArticleChatWebGroundingResponse(fixture.response, {
    providerId: 'openai', model: 'gpt-5-mini'
  }).grounding;
  const input = normalizeArticleChatInput({
    question: 'What changed?', turnId: 'turn-1', operationId: 'operation-1',
    webSearch: { enabled: true },
    document: { title: 'Paper', url: 'https://www.nih.gov/paper',
      paragraphs: [{ paragraphId: 'p1', text: 'The study reported a significant result.' }] }
  });
  const progress = [];
  await assert.rejects(runArticleChat({
    input,
    profile: { providerId: 'openai', config: { model: 'gpt-5-mini' },
      tokenPolicy: {}, contextWindowTokens: 65536 },
    routeIdentity: { providerId: 'openai', model: 'gpt-5-mini',
      turnId: input.turnId, operationId: input.operationId },
    adapter: { async *generateWebSearchTextStream() {
      yield { type: 'started' };
      yield { type: 'text_delta', text: fixture.text.replace('"status":"completed"', '"status":"failed"') };
      yield { type: 'web_grounding', grounding };
      yield { type: 'usage', usage: {} };
      yield { type: 'completed' };
    } },
    onProgress: event => progress.push(event)
  }), error => error.code === 'WEB_SEARCH_RESPONSE_INCOMPLETE');
  assert.equal(progress.some(event => event.phase === 'chat_answer_block'), false);
});
