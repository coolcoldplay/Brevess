const test = require('node:test');
const assert = require('node:assert/strict');
require('../providers/provider-utils.js');
require('../core/article-chat-web-sources.js');
require('../providers/deepseek.js');
require('../providers/openai.js');
const {
  createProviderAdapter,
  getProviderCapabilities,
  getProviderReasoningCapabilities
} = require('../providers/provider-registry.js');

const request = { systemPrompt: 'Return JSON.', userPrompt: 'Question', maxOutputTokens: 4096 };
async function collect(stream) {
  const events = [];
  for await (const event of stream) events.push(event);
  return events;
}

test('official deepseek-flash alias supports vision while preserving explicit ordinary JSON thinking controls', async () => {
  assert.deepEqual(getProviderReasoningCapabilities('deepseek', {
    model: 'deepseek-flash'
  }), {
    supported: true,
    mode: 'effort',
    levels: ['low', 'high', 'max'],
    defaultLevel: 'high'
  });
  assert.equal(getProviderCapabilities('deepseek', {
    model: 'deepseek-flash'
  }).supportsVision, true);
  assert.equal(getProviderCapabilities('deepseek', { model: 'deepseek-flash' }).visionInputFormat, 'openai');
  assert.equal(getProviderReasoningCapabilities('deepseek', {
    model: 'deepseek-v5-future'
  }).supported, false);
  assert.equal(getProviderCapabilities('deepseek', {
    model: 'deepseek-v5-future'
  }).supportsVision, false);

  for (const [reasoningEnabled, reasoningEffort, expectedThinking, expectedEffort] of [
    [false, 'auto', { type: 'disabled' }, undefined],
    [true, 'low', { type: 'enabled' }, 'low'],
    [true, 'max', { type: 'enabled' }, 'max']
  ]) {
    let body;
    const adapter = createProviderAdapter({
      providerId: 'deepseek',
      config: {
        apiKey: 'fixture', model: 'deepseek-flash',
        reasoningEnabled, reasoningEffort
      },
      fetchImpl: async (_url, options) => {
        body = JSON.parse(options.body);
        return new Response(JSON.stringify({
          model: 'deepseek-flash',
          choices: [{ finish_reason: 'stop', message: { content: '{"ok":true}' } }],
          usage: { prompt_tokens: 1, completion_tokens: 1 }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
    });
    assert.deepEqual(await adapter.generateJson({
      ...request, responseSchema: { type: 'object' }
    }), { ok: true });
    assert.deepEqual(body.thinking, expectedThinking);
    assert.equal(body.reasoning_effort, expectedEffort);
    assert.equal(body.messages[1].content, 'Question');
    assert.equal(typeof body.messages[1].content, 'string');
  }
});

test('DeepSeek ordinary text stream respects disabled, enabled, and per-request thinking settings', async () => {
  for (const [settings, overrides, expected] of [
    [{ reasoningEnabled: false }, {}, 'none'],
    [{ reasoningEnabled: true, reasoningEffort: 'max' }, {}, 'max'],
    [{ reasoningEnabled: true, reasoningEffort: 'xhigh' }, {}, 'high'],
    [{ reasoningEnabled: true, reasoningEffort: 'max' }, { reasoningEnabled: false }, 'none'],
    [{ reasoningEnabled: false }, { reasoningEnabled: true, reasoningEffort: 'low' }, 'low']
  ]) {
    let body, seenUrl;
    const adapter = createProviderAdapter({
      providerId: 'deepseek',
      config: { apiKey: 'fixture', model: 'deepseek-v4-flash', ...settings },
      fetchImpl: async (url, options) => {
        seenUrl = url;
        body = JSON.parse(options.body);
        return new Response('data: {"choices":[{"delta":{"content":"hello"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', {
          headers: { 'Content-Type': 'text/event-stream' }
        });
      }
    });
    const events = await collect(adapter.generateTextStream({ ...request, ...overrides }));
    assert.equal(seenUrl, 'https://api.deepseek.com/chat/completions');
    assert.deepEqual(body.thinking, { type: expected === 'none' ? 'disabled' : 'enabled' });
    assert.equal(body.reasoning_effort, expected === 'none' ? undefined : expected);
    assert.equal(body.reasoning, undefined);
    assert.equal(body.tools, undefined);
    assert.ok(events.some(event => event.type === 'completed'));
    assert.equal(events.filter(event => event.type === 'text_delta').map(event => event.text).join(''), 'hello');
  }
});

test('explicit official DeepSeek Responses endpoint keeps ordinary JSON and stream on Chat Completions', async () => {
  const seen = [];
  const adapter = createProviderAdapter({
    providerId: 'deepseek',
    config: { apiKey: 'fixture', model: 'deepseek-v4-flash', baseUrl: 'https://api.deepseek.com/responses/' },
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      seen.push({ url, body });
      if (body.stream) return new Response('data: {"choices":[{"delta":{"content":"hello"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', {
        headers: { 'Content-Type': 'text/event-stream' }
      });
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }] }));
    }
  });
  assert.equal(adapter.generateWebSearchTextStream, undefined);
  assert.deepEqual(await adapter.generateJson({ ...request, responseSchema: { type: 'object' } }), { ok: true });
  const events = await collect(adapter.generateTextStream(request));
  assert.ok(events.some(event => event.type === 'completed'));
  assert.equal(events.filter(event => event.type === 'text_delta').map(event => event.text).join(''), 'hello');
  assert.equal(seen.length, 2);
  for (const { url, body } of seen) {
    assert.equal(url, 'https://api.deepseek.com/chat/completions');
    assert.ok(Array.isArray(body.messages));
    assert.equal(body.input, undefined);
    assert.equal(body.tools, undefined);
  }
});

test('default and explicit official DeepSeek Responses endpoints expose ordinary methods without unsupported web dispatch', () => {
  for (const baseUrl of [undefined, 'https://api.deepseek.com/responses/']) {
    let calls = 0;
    const adapter = createProviderAdapter({
      providerId: 'deepseek',
      config: {
        apiKey: 'fixture', model: 'deepseek-v4-flash',
        ...(baseUrl ? { baseUrl } : {})
      },
      fetchImpl: async () => {
        calls++;
        throw new Error('unsupported web must not dispatch');
      }
    });

    assert.equal(adapter.generateWebSearchTextStream, undefined);
    assert.equal(typeof adapter.generateTextStream, 'function');
    assert.equal(typeof adapter.generateJson, 'function');
    assert.equal(calls, 0);
  }
});

test('supported OpenAI web finalization excludes commentary and preserves genuine final source annotations', async () => {
  const markdown = '## 原生最终回答\n\n完整正文保持不变。';
  const text = [JSON.stringify({ type: 'answer_block', block_id: 'final-block', markdown, evidence: [] }),
    JSON.stringify({ type: 'final', status: 'completed' })].join('\n');
  let calls = 0;
  let seenBody, seenUrl;
  const adapter = createProviderAdapter({
    providerId: 'openai',
    config: { apiKey: 'fixture', model: 'gpt-5-mini' },
    fetchImpl: async (url, options) => {
      calls += 1;
      seenUrl = url;
      seenBody = JSON.parse(options.body);
      return new Response(JSON.stringify({
        id: 'resp_native_adapter', status: 'completed',
        output_text: `search narration\n${text}`,
        output: [{
          type: 'message', role: 'assistant', status: 'completed', phase: 'commentary',
          content: [{ type: 'output_text', text: 'search narration', annotations: [] }]
        }, {
          type: 'web_search_call', status: 'completed'
        }, {
          type: 'message', role: 'assistant', status: 'completed', phase: 'final_answer',
          content: [{ type: 'output_text', text, annotations: [{ type: 'url_citation',
            start_index: text.indexOf('##'), end_index: text.indexOf('##') + '## 原生最终回答'.length,
            url: 'https://www.nih.gov/news-events', title: 'NIH News' }] }]
        }],
        usage: { input_tokens: 20, output_tokens: 10 }
      }));
    }
  });

  const events = await collect(adapter.generateWebSearchTextStream({
    ...request,
    systemPrompt: 'Return NDJSON answer_block and final records with Markdown block content.'
  }));
  assert.equal(calls, 1);
  assert.equal(seenUrl, 'https://api.openai.com/v1/responses');
  assert.deepEqual(events.map(event => event.type),
    ['started', 'text_delta', 'web_grounding', 'usage', 'completed']);
  assert.equal(JSON.parse(events[1].text.split('\n')[0]).markdown, markdown);
  assert.equal(events[1].text.includes('search narration'), false);
  assert.equal(events[2].grounding.sources[0].url, 'https://www.nih.gov/news-events');
  assert.deepEqual(events[2].grounding.sources[0].blockIds, ['final-block']);
  assert.match(seenBody.instructions, /NDJSON answer_block/);
  assert.deepEqual(seenBody.tools, [{ type: 'web_search' }]);
  assert.deepEqual(seenBody.tool_choice, { type: 'web_search' });
});
