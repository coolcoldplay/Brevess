(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(shared) {
  function normalize(value, maximum) {
    return String(value || '').normalize('NFKC').replace(/\s+/gu, ' ').trim()
      .slice(0, maximum);
  }

  function hash(value) {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    let first = 2166136261;
    let second = 2166136261 ^ 0x9e3779b9;
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      first = Math.imul(first ^ code, 16777619);
      second = Math.imul(second ^ code, 2246822519);
    }
    return `${(first >>> 0).toString(16).padStart(8, '0')}` +
      `${(second >>> 0).toString(16).padStart(8, '0')}`;
  }

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
  }

  function answerText(turn) {
    if (turn?.answer) return turn.answer;
    if (turn?.content && turn?.role === 'assistant') return turn.content;
    return (Array.isArray(turn?.answerBlocks) ? turn.answerBlocks : [])
      .map(block => block?.markdown || block?.text || block?.content || '')
      .join('\n\n');
  }

  function summarize(question, answer) {
    const combined = [question, answer].filter(Boolean).join(' — ');
    const sentences = combined.match(/[^.!?。！？]+[.!?。！？]?/gu) || [combined];
    return normalize(sentences.slice(0, 4).join(' '), 1600);
  }

  function normalizeTurns(turns) {
    return (Array.isArray(turns) ? turns : []).map((turn, index) => {
      const question = normalize(
        turn?.question || (turn?.role === 'user' ? turn?.content : ''), 4000
      );
      const answer = normalize(answerText(turn), 16000);
      return {
        turnId: normalize(turn?.turnId || turn?.id || `turn-${index + 1}`, 160),
        question,
        answer,
        createdAt: Number(turn?.createdAt) || 0
      };
    }).filter(turn => turn.turnId && (turn.question || turn.answer));
  }

  function buildArticleChatMemory(turns) {
    if (typeof shared.tokenizeRetrievalText !== 'function') {
      throw new Error('article-chat-tokenizer must be loaded before article-chat-memory');
    }
    const originalTurns = normalizeTurns(turns);
    const entries = originalTurns.map((turn, index) => {
      const summary = summarize(turn.question, turn.answer);
      return {
        turnId: turn.turnId,
        order: index,
        question: turn.question,
        answer: turn.answer,
        summary,
        createdAt: turn.createdAt,
        tokens: [...new Set(shared.tokenizeRetrievalText(
          `${turn.question} ${turn.answer}`, {
            fallbackToUnfilteredIfEmpty: true,
            maxTokens: 1024
          }
        ))]
      };
    });
    return deepFreeze({
      version: 1,
      memoryId: `article-chat-memory-${hash(originalTurns.map(turn => [
        turn.turnId, turn.question, turn.answer, turn.createdAt
      ]))}`,
      originalTurns,
      entries
    });
  }

  function retrieveArticleChatMemory(memory, query, options = {}) {
    if (!memory || !Array.isArray(memory.entries) ||
        typeof shared.tokenizeRetrievalQuery !== 'function') return [];
    const queryTokens = new Set(shared.tokenizeRetrievalQuery(query, 128));
    if (!queryTokens.size) return [];
    const limit = Math.max(1, Number(options.limit) || 6);
    return memory.entries.map(entry => {
      const entryTokens = new Set(entry.tokens || []);
      let overlap = 0;
      queryTokens.forEach(token => { if (entryTokens.has(token)) overlap += 1; });
      const phrase = normalize(query, 4000).toLowerCase();
      const searchable = `${entry.question} ${entry.answer}`.toLowerCase();
      const phraseBoost = phrase.length >= 4 && searchable.includes(phrase) ? 4 : 0;
      const score = overlap * 2 + phraseBoost;
      return { ...entry, score };
    }).filter(entry => entry.score > 0)
      .sort((left, right) => right.score - left.score || left.order - right.order)
      .slice(0, limit);
  }

  function deleteArticleChatTurnAndRebuild(memory, turnId) {
    const target = normalize(turnId, 160);
    const turns = (Array.isArray(memory?.originalTurns) ? memory.originalTurns : [])
      .filter(turn => turn.turnId !== target);
    return buildArticleChatMemory(turns);
  }

  return {
    buildArticleChatMemory,
    retrieveArticleChatMemory,
    deleteArticleChatTurnAndRebuild
  };
});
