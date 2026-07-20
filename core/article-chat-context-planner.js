(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(shared) {
  const DEFAULT_CONTEXT_WINDOW_TOKENS = 32768;
  const DEFAULT_RESERVED_TOKENS = 1024;
  const DEFAULT_SYSTEM_TOKENS = 768;

  function estimateTokens(value) {
    const text = String(value || '');
    const cjk = (text.match(/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/gu) || []).length;
    return Math.max(text ? 1 : 0, Math.ceil(cjk + (text.length - cjk) / 3.2));
  }

  function contextError(details) {
    const error = new Error('The selected model context window cannot fit this request');
    error.code = 'CONTEXT_BUDGET_EXCEEDED';
    error.details = details;
    return error;
  }

  function historyText(turn) {
    return [
      turn?.question || (turn?.role === 'user' ? turn?.content : ''),
      turn?.answer || (turn?.role === 'assistant' ? turn?.content : ''),
      ...(Array.isArray(turn?.answerBlocks)
        ? turn.answerBlocks.map(block => block?.markdown || block?.text || '') : [])
    ].filter(Boolean).join('\n');
  }

  function historyId(turn, index) {
    return String(turn?.turnId || turn?.id || `turn-${index + 1}`);
  }

  function chooseRecentHistory(history, maximumTokens) {
    const selected = [];
    let used = 0;
    for (let index = history.length - 1; index >= 0; index -= 1) {
      const turn = history[index];
      const cost = estimateTokens(historyText(turn)) + 8;
      if (selected.length && used + cost > maximumTokens) break;
      if (!selected.length && cost > maximumTokens) continue;
      selected.unshift(turn);
      used += cost;
    }
    return { selected, used };
  }

  function resolveContextWindow(profile) {
    if (typeof shared.getProviderContextWindowTokens === 'function') {
      return shared.getProviderContextWindowTokens(
        profile?.providerId,
        profile?.config || {},
        profile?.contextWindowTokens
      );
    }
    const explicit = Number(profile?.contextWindowTokens);
    return Number.isFinite(explicit) && explicit >= 8192
      ? explicit : DEFAULT_CONTEXT_WINDOW_TOKENS;
  }

  function cacheDecision(index, cacheState) {
    if (!cacheState || cacheState.indexId !== index.indexId) {
      return { status: cacheState ? 'index-changed' : 'miss', stablePrefixChunkIds: [] };
    }
    const stablePrefixChunkIds = (Array.isArray(cacheState.stablePrefixChunkIds)
      ? cacheState.stablePrefixChunkIds : []).filter(chunkId =>
      index.chunks.some(chunk => chunk.chunkId === chunkId));
    return {
      status: stablePrefixChunkIds.length ? 'reuse-stable-prefix' : 'index-hit',
      stablePrefixChunkIds
    };
  }

  async function planArticleChatContext(input = {}) {
    const index = input.index;
    if (!index || !Array.isArray(index.chunks)) throw new TypeError('Article chat index is required');
    if (typeof shared.computeOutputTokenBudget !== 'function' ||
        typeof shared.computeInputTokenBudget !== 'function' ||
        typeof shared.retrieveArticleChatContext !== 'function') {
      throw new Error('Article chat planning dependencies are not loaded');
    }
    const history = Array.isArray(input.history) ? input.history : [];
    const completeHistoryIds = history.map(historyId);
    const memory = input.memory || (typeof shared.buildArticleChatMemory === 'function'
      ? shared.buildArticleChatMemory(history) : { entries: [] });
    const outputBudgetTokens = shared.computeOutputTokenBudget(
      input.kind === 'panelChat' ? 'panelChat' : 'articleChat', {
        units: Math.max(1, Number(input.outputUnits) || 1),
        tokenPolicy: input.profile?.tokenPolicy || {}
      }
    );
    const contextWindowTokens = resolveContextWindow(input.profile || {});
    const inputBudgetTokens = shared.computeInputTokenBudget({
      contextWindowTokens,
      outputTokens: outputBudgetTokens.initial,
      reservedTokens: input.reservedTokens ?? DEFAULT_RESERVED_TOKENS,
      systemTokens: input.systemTokens ?? DEFAULT_SYSTEM_TOKENS
    });
    const queryTokens = estimateTokens(input.query) + 16;
    if (inputBudgetTokens.available - queryTokens < 512) {
      throw contextError({
        phase: 'fixed-prefix', inputBudgetTokens, queryTokens, outputBudgetTokens
      });
    }

    const memoryMatches = typeof shared.retrieveArticleChatMemory === 'function'
      ? shared.retrieveArticleChatMemory(memory, input.query, { limit: 6 }) : [];
    const memoryBudget = Math.floor(inputBudgetTokens.available * 0.18);
    const localMemory = [];
    let memoryTokens = 0;
    for (const entry of memoryMatches) {
      const cost = estimateTokens(entry.summary) + 8;
      if (localMemory.length && memoryTokens + cost > memoryBudget) break;
      if (!localMemory.length && cost > memoryBudget) continue;
      localMemory.push(entry);
      memoryTokens += cost;
    }

    const historyBudget = Math.floor(inputBudgetTokens.available * 0.32);
    const recent = chooseRecentHistory(history, historyBudget);
    const remainingForArticle = inputBudgetTokens.available - queryTokens -
      memoryTokens - recent.used;
    if (remainingForArticle < 256) {
      throw contextError({
        phase: 'history-memory', inputBudgetTokens, queryTokens,
        memoryTokens, historyTokens: recent.used
      });
    }

    const firstTurn = history.length === 0;
    const bodyChunks = index.chunks.filter(chunk => chunk.recordType === 'body');
    const completeArticleTokens = bodyChunks.reduce((sum, chunk) =>
      sum + estimateTokens(chunk.text) + 8, 0);
    let mode = firstTurn && completeArticleTokens <= remainingForArticle
      ? 'full' : 'retrieval';
    let chunks;
    let retrieval = null;
    if (mode === 'full') {
      chunks = bodyChunks.slice();
    } else {
      retrieval = await shared.retrieveArticleChatContext(index, input.query, {
        maxChars: Math.max(200, Math.floor(remainingForArticle * 3)),
        limit: Math.max(1, Math.min(12, Math.ceil(remainingForArticle / 500))),
        neighborRadius: input.neighborRadius ?? 1,
        embedTexts: input.embedTexts
      });
      chunks = retrieval.chunks.slice();
    }

    let chunkTokens = chunks.reduce((sum, chunk) => sum + estimateTokens(chunk.text) + 8, 0);
    while (chunks.length > 1 && chunkTokens > remainingForArticle) {
      chunks.pop();
      chunkTokens = chunks.reduce((sum, chunk) => sum + estimateTokens(chunk.text) + 8, 0);
    }
    if (!chunks.length || chunkTokens > remainingForArticle) {
      throw contextError({
        phase: 'article-context', inputBudgetTokens, remainingForArticle, chunkTokens
      });
    }
    const estimatedInputTokens = queryTokens + memoryTokens + recent.used + chunkTokens;
    const includedHistoryIds = recent.selected.map((turn, indexValue) =>
      historyId(turn, history.indexOf(turn) >= 0 ? history.indexOf(turn) : indexValue));
    const retrievedOldTurnIds = localMemory.map(entry => entry.turnId);
    return Object.freeze({
      mode,
      indexId: index.indexId,
      contextWindowTokens,
      inputBudgetTokens: Object.freeze(inputBudgetTokens),
      outputBudgetTokens: Object.freeze(outputBudgetTokens),
      estimatedInputTokens,
      chunks: Object.freeze(chunks),
      completeHistoryIds: Object.freeze(completeHistoryIds),
      includedHistoryIds: Object.freeze(includedHistoryIds),
      retrievedOldTurnIds: Object.freeze(retrievedOldTurnIds),
      localMemory: Object.freeze(localMemory),
      cacheDecision: Object.freeze(cacheDecision(index, input.cacheState)),
      sectionCoverage: Object.freeze([
        ...new Set(chunks.map(chunk => chunk.sectionKind || chunk.sectionTitle).filter(Boolean))
      ]),
      retrievalCoverage: retrieval?.coverage || null
    });
  }

  return {
    estimateArticleChatTokens: estimateTokens,
    planArticleChatContext
  };
});
