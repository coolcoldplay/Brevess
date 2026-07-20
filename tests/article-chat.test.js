const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeArticleChatHistory,
  selectArticleChatContext,
  normalizeArticleChatInput,
  compileArticleChatPrompt,
  validateArticleChatResponse
} = require('../core/article-chat.js');

test('article chat keeps bounded alternating conversation context', () => {
  const history = Array.from({ length: 30 }, (_, index) => ({
    role: index % 2 ? 'assistant' : 'user', content: `turn ${index}`
  }));
  const normalized = normalizeArticleChatHistory(history);
  assert.equal(normalized.length, 20);
  assert.equal(normalized[0].content, 'turn 10');
  assert.equal(normalized.at(-1).role, 'assistant');
});

test('article chat sends the complete article when it fits the context budget', () => {
  const selected = selectArticleChatContext([
    { paragraphId: 'p1', sourceKey: 'source-1', sectionTitle: 'Abstract', text: 'A'.repeat(2000) },
    { paragraphId: 'p2', sourceKey: 'source-2', sectionTitle: 'Results', text: 'B'.repeat(2000) }
  ], 'What is the result?', 20000);
  assert.equal(selected.coverage.truncated, false);
  assert.equal(selected.coverage.sentParagraphs, 2);
});

test('article chat keeps question-relevant paragraphs when a very long article is bounded', () => {
  const paragraphs = Array.from({ length: 30 }, (_, index) => ({
    paragraphId: `p${index}`,
    sectionTitle: index === 18 ? 'Mechanism' : 'Background',
    text: index === 18 ? `kinase rescue ${'x'.repeat(1800)}` : 'y'.repeat(1800)
  }));
  const selected = selectArticleChatContext(paragraphs, 'How does kinase rescue work?', 20000);
  assert.equal(selected.coverage.truncated, true);
  assert.ok(selected.paragraphs.some(item => item.paragraphId === 'p18'));
});

test('article chat prompt and response remain strict structured JSON', () => {
  const input = normalizeArticleChatInput({
    question: '作者最重要的结论是什么？',
    profileId: 'profile_test_model',
    history: [{ role: 'user', content: '先概括方法' }],
    document: {
      title: 'Paper', url: 'https://example.org/paper',
      paragraphs: [{ paragraphId: 'p1', sourceKey: 'source-1', sectionTitle: 'Conclusion', text: 'The intervention improved survival.' }]
    }
  });
  const prompt = compileArticleChatPrompt(input);
  assert.equal(prompt.schemaName, 'article_fulltext_chat');
  assert.match(prompt.userPrompt, /作者最重要的结论/);
  const response = validateArticleChatResponse({
    answer_zh: '**核心结论**\n\n1. 干预改善了生存。[[1]]\n2. 仍需验证效应量。',
    evidence: [{
      paragraph_id: 'p1',
      source_key: 'source-1',
      section_title: 'Conclusion',
      quote: 'The intervention improved survival.',
      support_zh: '结论段直接报告该结果。'
    }],
    limitations_zh: '网页正文未提供具体效应量。'
  });
  assert.equal(response.evidence[0].sectionTitle, 'Conclusion');
  assert.equal(response.evidence[0].paragraphId, 'p1');
  assert.equal(response.evidence[0].sourceKey, 'source-1');
  assert.equal(response.evidence[0].quote, 'The intervention improved survival.');
  assert.match(response.answer, /\*\*核心结论\*\*\n\n1\./);
  assert.deepEqual(prompt.responseSchema.properties.evidence.items.required, [
    'paragraph_id', 'source_key', 'section_title', 'quote', 'support_zh'
  ]);
  assert.match(prompt.systemPrompt, /every numbered or bulleted item on its own line/);
  assert.match(prompt.systemPrompt, /append \[\[n\]\] immediately after every sentence/);
  assert.throws(() => validateArticleChatResponse({ answer_zh: '' }), /answer/i);
});
