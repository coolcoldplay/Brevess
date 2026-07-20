(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  const ARTICLE_CHAT_MAX_CONTEXT_CHARS = 220000;
  const ARTICLE_CHAT_MAX_HISTORY_MESSAGES = 20;

  function cleanText(value, maximum = 12000) {
    return String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, maximum);
  }

  function cleanMarkdown(value, maximum = 32000) {
    return String(value || '')
      .normalize('NFKC')
      .replace(/\0/g, '')
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map(line => line.replace(/[\t\f\v ]+/g, ' ').trimEnd())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
      .slice(0, maximum);
  }

  function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function invalidSettings(fields) {
    const error = new Error('Article chat input is invalid');
    error.code = 'INVALID_SETTINGS';
    error.fields = fields;
    return error;
  }

  function invalidResponse(message) {
    const error = new Error(message || 'Article chat response is invalid');
    error.code = 'INVALID_RESPONSE';
    return error;
  }

  function normalizeArticleChatHistory(value) {
    return (Array.isArray(value) ? value : [])
      .slice(-ARTICLE_CHAT_MAX_HISTORY_MESSAGES)
      .map(item => ({
        role: item?.role === 'assistant' ? 'assistant' : 'user',
        content: cleanMarkdown(item?.content, 16000)
      }))
      .filter(item => item.content);
  }

  function questionTerms(question) {
    const stopWords = new Set([
      'the', 'and', 'for', 'with', 'that', 'this', 'from', 'what', 'which',
      'how', 'why', 'are', 'was', 'were', 'does', 'did', 'into', 'about',
      '一个', '这个', '这些', '论文', '文章', '作者', '什么', '如何', '为什么',
      '是否', '可以', '请问', '请', '分析', '说明', '解释'
    ]);
    const latin = cleanText(question, 4000).toLowerCase().match(/[a-z0-9][a-z0-9._+-]{2,}/g) || [];
    const chinese = cleanText(question, 4000).match(/[\u3400-\u9fff]{2,8}/g) || [];
    return [...new Set([...latin, ...chinese].filter(term => !stopWords.has(term)))].slice(0, 40);
  }

  function normalizeArticleParagraphs(value) {
    return (Array.isArray(value) ? value : []).slice(0, 5000).map((item, index) => ({
      index,
      paragraphId: cleanText(item?.paragraphId, 120),
      sourceKey: cleanText(item?.sourceKey, 120),
      sectionTitle: cleanText(item?.sectionTitle, 300),
      text: cleanText(item?.text, 12000)
    })).filter(item => item.text);
  }

  function selectArticleChatContext(value, question, maximum = ARTICLE_CHAT_MAX_CONTEXT_CHARS) {
    const paragraphs = normalizeArticleParagraphs(value);
    const totalCharacters = paragraphs.reduce((sum, item) => sum + item.text.length, 0);
    const limit = Math.max(20000, Number(maximum) || ARTICLE_CHAT_MAX_CONTEXT_CHARS);
    if (totalCharacters <= limit) {
      return {
        paragraphs,
        coverage: {
          totalParagraphs: paragraphs.length,
          sentParagraphs: paragraphs.length,
          totalCharacters,
          sentCharacters: totalCharacters,
          truncated: false
        }
      };
    }

    const terms = questionTerms(question);
    const scored = paragraphs.map(item => {
      const haystack = `${item.sectionTitle} ${item.text}`.toLowerCase();
      const relevance = terms.reduce((sum, term) => sum + (haystack.includes(term.toLowerCase()) ? 4 : 0), 0);
      const sectionPriority = /abstract|summary|introduction|discussion|conclusion|摘要|引言|讨论|结论/i
        .test(item.sectionTitle) ? 2 : 0;
      const edgePriority = item.index < 8 || item.index >= paragraphs.length - 8 ? 1 : 0;
      return { item, score: relevance + sectionPriority + edgePriority };
    }).sort((left, right) => right.score - left.score || left.item.index - right.item.index);

    const selected = [];
    const selectedIndexes = new Set();
    let sentCharacters = 0;
    for (const candidate of scored) {
      const cost = candidate.item.text.length + candidate.item.sectionTitle.length + 32;
      if (selected.length && sentCharacters + cost > limit) continue;
      selected.push(candidate.item);
      selectedIndexes.add(candidate.item.index);
      sentCharacters += cost;
      if (sentCharacters >= limit) break;
    }
    selected.sort((left, right) => left.index - right.index);
    return {
      paragraphs: selected.map(({ index, ...item }) => item),
      coverage: {
        totalParagraphs: paragraphs.length,
        sentParagraphs: selected.length,
        totalCharacters,
        sentCharacters,
        truncated: selectedIndexes.size < paragraphs.length
      }
    };
  }

  function normalizeArticleChatInput(message = {}) {
    const question = cleanText(message.question, 4000);
    if (!question) throw invalidSettings(['question']);
    const profileId = cleanText(message.profileId, 100);
    if (profileId && !/^profile_[a-z0-9_]{3,80}$/.test(profileId)) {
      throw invalidSettings(['profileId']);
    }
    const document = isPlainObject(message.document) ? message.document : {};
    const selected = selectArticleChatContext(document.paragraphs, question);
    if (!selected.paragraphs.length) throw invalidSettings(['document.paragraphs']);
    return {
      question,
      profileId,
      history: normalizeArticleChatHistory(message.history),
      document: {
        title: cleanText(document.title, 1000),
        url: cleanText(document.url || document.canonicalUrl, 2000),
        paragraphs: selected.paragraphs
      },
      coverage: selected.coverage
    };
  }

  function createArticleChatSchema() {
    return {
      type: 'object',
      additionalProperties: false,
      properties: {
        answer_zh: { type: 'string' },
        evidence: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              paragraph_id: { type: 'string' },
              source_key: { type: 'string' },
              section_title: { type: 'string' },
              quote: { type: 'string' },
              support_zh: { type: 'string' }
            },
            required: ['paragraph_id', 'source_key', 'section_title', 'quote', 'support_zh']
          }
        },
        limitations_zh: { type: 'string' }
      },
      required: ['answer_zh', 'evidence', 'limitations_zh']
    };
  }

  function compileArticleChatPrompt(input) {
    return {
      systemPrompt: [
        'You are a rigorous biomedical paper assistant.',
        'Answer the user in Chinese using only the supplied webpage article context and conversation history.',
        'You may synthesize across sections, compare claims, explain methods, critique evidence, or help the user reason about the paper.',
        'Never invent a result, sample size, method detail, citation, or conclusion absent from the supplied context.',
        'When the article context cannot support part of the answer, say so explicitly in limitations_zh.',
        'Write answer_zh as readable Markdown: put every numbered or bulleted item on its own line, leave a blank line between paragraphs, and use **bold** for concise emphasis. Do not use HTML.',
        'For every distinct source paragraph used, add a separate evidence item. Copy its exact supplied paragraphId into paragraph_id, copy its exact supplied sourceKey into source_key, and include one short verbatim sentence or excerpt from that paragraph in quote. Never invent paragraph IDs or source keys.',
        'Number evidence items from 1 in their array order. In answer_zh, append [[n]] immediately after every sentence or list item supported by evidence item n. Keep each marker directly after the supported sentence, never collect markers in a separate references paragraph.',
        'Keep the answer readable with short paragraphs. Return strict JSON only.'
      ].join('\n'),
      userPrompt: JSON.stringify({
        article: input.document,
        conversation_history: input.history,
        current_question: input.question,
        context_coverage: input.coverage
      }),
      responseSchema: createArticleChatSchema(),
      schemaName: 'article_fulltext_chat'
    };
  }

  function validateArticleChatResponse(value) {
    if (!isPlainObject(value)) throw invalidResponse();
    const allowed = new Set(['answer_zh', 'evidence', 'limitations_zh']);
    if (Object.keys(value).some(key => !allowed.has(key))) {
      throw invalidResponse('Article chat response contains unsupported fields');
    }
    const answer = cleanMarkdown(value.answer_zh, 32000);
    if (!answer) throw invalidResponse('Article chat response did not contain an answer');
    const evidence = (Array.isArray(value.evidence) ? value.evidence : []).slice(0, 12)
      .map(item => ({
        paragraphId: cleanText(item?.paragraph_id, 120),
        sourceKey: cleanText(item?.source_key || item?.paragraph_id, 120),
        sectionTitle: cleanText(item?.section_title, 300),
        quote: cleanText(item?.quote, 2000),
        support: cleanText(item?.support_zh, 1600)
      })).filter(item => item.paragraphId || item.sectionTitle || item.quote || item.support);
    return {
      answer,
      evidence,
      limitations: cleanMarkdown(value.limitations_zh, 4000)
    };
  }

  return {
    ARTICLE_CHAT_MAX_CONTEXT_CHARS,
    ARTICLE_CHAT_MAX_HISTORY_MESSAGES,
    normalizeArticleChatHistory,
    selectArticleChatContext,
    normalizeArticleChatInput,
    createArticleChatSchema,
    compileArticleChatPrompt,
    validateArticleChatResponse
  };
});
