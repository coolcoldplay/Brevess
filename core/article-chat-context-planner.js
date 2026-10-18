(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(shared) {
  const DEFAULT_CONTEXT_WINDOW_TOKENS = 32768;
  const DEFAULT_RESERVED_TOKENS = 1024;
  const DEFAULT_SYSTEM_TOKENS = 768;
  const MIN_ARTICLE_OUTPUT_TOKENS = 2048;
  const MIN_PANEL_OUTPUT_TOKENS = 1024;
  const MIN_ARTICLE_CONTEXT_TOKENS = 512;

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

  function roundDown256(value) {
    return Math.floor(Math.max(0, Number(value) || 0) / 256) * 256;
  }

  function contextAwareOutputBudget(requested, options) {
    const minimumOutputTokens = options.kind === 'panelChat'
      ? MIN_PANEL_OUTPUT_TOKENS : MIN_ARTICLE_OUTPUT_TOKENS;
    const usableContextWindowTokens = Math.floor(
      options.contextWindowTokens * (options.safetyRatio || 1)
    );
    const maximumInitialByShare = Math.max(
      minimumOutputTokens,
      roundDown256(usableContextWindowTokens * 0.25)
    );
    const maximumCeilingByShare = Math.max(
      minimumOutputTokens,
      roundDown256(usableContextWindowTokens * 0.50)
    );
    const maximumBySpace = roundDown256(
      usableContextWindowTokens - options.reservedTokens - options.systemTokens -
      options.queryTokens - MIN_ARTICLE_CONTEXT_TOKENS
    );
    const maximumInitial = Math.min(maximumInitialByShare, maximumBySpace);
    const maximumCeiling = Math.min(maximumCeilingByShare, maximumBySpace);
    const requestedInitial = Math.max(512, Number(requested.initial) || minimumOutputTokens);
    const minimumViableOutput = Math.min(minimumOutputTokens, requestedInitial);
    if (maximumInitial < minimumViableOutput) return null;
    const initial = Math.min(requestedInitial, maximumInitial);
    const ceiling = Math.max(
      initial,
      Math.min(Number(requested.ceiling) || initial, maximumCeiling)
    );
    return {
      ...requested,
      initial,
      ceiling,
      requestedInitial: requested.initial,
      requestedCeiling: requested.ceiling,
      contextClamped: initial !== requested.initial || ceiling !== requested.ceiling
    };
  }

  function fitChunkToBudget(chunk, maximumTokens) {
    const fullCost = estimateTokens(chunk?.text) + 8;
    if (fullCost <= maximumTokens) return chunk;
    const text = String(chunk?.text || '');
    if (!text || maximumTokens < 64) return null;
    let low = 1;
    let high = text.length;
    let best = 0;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      if (estimateTokens(text.slice(0, middle)) + 8 <= maximumTokens) {
        best = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    if (best < 40) return null;
    const minimumBoundary = Math.floor(best * 0.6);
    let boundary = best;
    for (let index = best - 1; index >= minimumBoundary; index -= 1) {
      if (/[.!?。！？；;:\s]/u.test(text[index])) {
        boundary = index + 1;
        break;
      }
    }
    const fittedText = text.slice(0, boundary).trim();
    if (!fittedText) return null;
    const sourceSpans = Array.isArray(chunk.sourceSpans) ? chunk.sourceSpans : [];
    const sourceSpanRanges = Array.isArray(chunk.sourceSpanRanges) ? chunk.sourceSpanRanges : [];
    const fittedPairs = sourceSpans.map((span, index) => ({
      span,
      range: sourceSpanRanges[index]
    })).filter(({ range }) => !Number.isFinite(Number(range?.chunkStart)) ||
      Number(range.chunkStart) < boundary).map(({ span, range }) => {
        if (!Number.isFinite(Number(range?.chunkStart)) ||
            !Number.isFinite(Number(range?.chunkEnd))) {
          return { span: { ...span }, range: range ? { ...range } : null };
        }
        const includedCharacters = Math.max(
          0,
          Math.min(Number(range.chunkEnd), boundary) - Number(range.chunkStart)
        );
        return {
          span: {
            ...span,
            sourceEnd: Math.min(
              Number(span.sourceEnd) || 0,
              (Number(span.sourceStart) || 0) + includedCharacters
            )
          },
          range: {
            ...range,
            chunkEnd: Math.min(Number(range.chunkEnd), boundary)
          }
        };
      }).filter(({ span }) => Number(span.sourceEnd) > Number(span.sourceStart));
    const spans = fittedPairs.map(item => item.span);
    return {
      ...chunk,
      chunkId: `${chunk.chunkId}:fit-${boundary}`,
      text: fittedText,
      sourceSpans: spans.length ? spans : chunk.sourceSpans,
      sourceSpanRanges: spans.length
        ? fittedPairs.map(item => item.range) : chunk.sourceSpanRanges,
      paragraphIds: spans.length
        ? [...new Set(spans.map(span => span.paragraphId).filter(Boolean))]
        : chunk.paragraphIds,
      sourceKeys: spans.length
        ? [...new Set(spans.map(span => span.sourceKey).filter(Boolean))]
        : chunk.sourceKeys,
      characterCount: fittedText.length,
      tokenCount: estimateTokens(fittedText),
      fittedForContextBudget: true
    };
  }

  function fitPublicationMetadata(value, maximumTokens) {
    if (!value || maximumTokens <= 0) return null;
    const metadata = JSON.parse(JSON.stringify(value));
    metadata.authors = Array.isArray(metadata.authors) ? metadata.authors : [];
    metadata.notes = Array.isArray(metadata.notes) ? metadata.notes : [];
    while (estimateTokens(JSON.stringify(metadata)) > maximumTokens) {
      metadata.truncated = true;
      const unassignedNote = metadata.notes.findLastIndex(note => note.kind !== 'correspondence');
      const otherAuthor = metadata.authors.findLastIndex(author => author.corresponding !== true);
      const multipleAffiliations = metadata.authors.findLast(author => author.affiliations?.length > 1);
      if (unassignedNote >= 0) metadata.notes.splice(unassignedNote, 1);
      else if (metadata.authors.length > 1 && otherAuthor >= 0) metadata.authors.splice(otherAuthor, 1);
      else if (multipleAffiliations) multipleAffiliations.affiliations.pop();
      else if (metadata.notes.length) metadata.notes.pop();
      else if (metadata.authors.length > 1) metadata.authors.pop();
      else if (metadata.authors[0]?.affiliations?.length) metadata.authors[0].affiliations.pop();
      else if (metadata.authors.length) metadata.authors.pop();
      else return null;
    }
    return metadata;
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
    const profile = input.profile || {};
    const adapterCap = typeof shared.getProviderMaxOutputTokens === 'function'
      ? shared.getProviderMaxOutputTokens(profile.providerId, profile.config || {})
      : null;
    const requestedOutputBudgetTokens = shared.computeOutputTokenBudget(
      input.kind === 'panelChat' ? 'panelChat' : 'articleChat', {
        units: Math.max(1, Number(input.outputUnits) || 1),
        tokenPolicy: profile.tokenPolicy || {},
        adapterCap
      }
    );
    const contextWindowTokens = resolveContextWindow(profile);
    const safetyRatio = 0.9;
    const reservedTokens = input.reservedTokens ?? DEFAULT_RESERVED_TOKENS;
    const systemTokens = (input.systemTokens ?? DEFAULT_SYSTEM_TOKENS) +
      Math.max(0, Math.ceil(Number(input.extraSystemTokens) || 0));
    const fixedInputTokens = Math.max(0, Math.ceil(Number(input.fixedInputTokens) || 0));
    const queryTokens = estimateTokens(input.query) + 16 + fixedInputTokens;
    const outputBudgetTokens = contextAwareOutputBudget(requestedOutputBudgetTokens, {
      kind: input.kind,
      contextWindowTokens,
      reservedTokens,
      systemTokens,
      queryTokens,
      safetyRatio
    });
    if (!outputBudgetTokens) {
      throw contextError({
        phase: 'fixed-prefix', contextWindowTokens, reservedTokens, systemTokens,
        queryTokens, outputBudgetTokens: requestedOutputBudgetTokens
      });
    }
    const inputBudgetTokens = shared.computeInputTokenBudget({
      contextWindowTokens,
      outputTokens: outputBudgetTokens.initial,
      reservedTokens,
      systemTokens,
      safetyRatio
    });
    if (inputBudgetTokens.available - queryTokens < 512) {
      throw contextError({
        phase: 'fixed-prefix', inputBudgetTokens, queryTokens, outputBudgetTokens
      });
    }

    const memoryMatches = typeof shared.retrieveArticleChatMemory === 'function'
      ? shared.retrieveArticleChatMemory(memory, input.query, { limit: 6 }) : [];
    const memoryBudget = Math.floor(inputBudgetTokens.available * 0.10);
    const localMemory = [];
    let memoryTokens = 0;
    for (const entry of memoryMatches) {
      const cost = estimateTokens(entry.summary) + 8;
      if (localMemory.length && memoryTokens + cost > memoryBudget) break;
      if (!localMemory.length && cost > memoryBudget) continue;
      localMemory.push(entry);
      memoryTokens += cost;
    }

    const historyBudget = Math.floor(inputBudgetTokens.available * 0.25);
    const recent = chooseRecentHistory(history, historyBudget);
    let remainingForArticle = inputBudgetTokens.available - queryTokens -
      memoryTokens - recent.used;
    if (remainingForArticle < 256) {
      throw contextError({
        phase: 'history-memory', inputBudgetTokens, queryTokens,
        memoryTokens, historyTokens: recent.used
      });
    }

    const articleChunks = index.chunks.filter(chunk =>
      ['body', 'figure-caption', 'table-caption'].includes(chunk.recordType));
    const requiredChunkIds = [...new Set(
      (Array.isArray(input.requiredChunkIds) ? input.requiredChunkIds : [])
        .map(value => String(value || '')).filter(Boolean)
    )];
    const requiredChunks = requiredChunkIds.map(chunkId =>
      articleChunks.find(chunk => chunk.chunkId === chunkId)
    );
    if (requiredChunks.some(chunk => !chunk)) {
      throw contextError({ phase: 'required-article-context', requiredChunkIds });
    }
    const minimumArticleTokens = Math.max(MIN_ARTICLE_CONTEXT_TOKENS,
      requiredChunks.reduce((sum, chunk) => sum + estimateTokens(chunk.text) + 8, 0));
    const publicationMetadata = fitPublicationMetadata(input.metadata, Math.max(0, Math.min(
      Math.floor(inputBudgetTokens.available * 0.25), remainingForArticle - minimumArticleTokens
    )));
    const metadataTokens = publicationMetadata ? estimateTokens(JSON.stringify(publicationMetadata)) : 0;
    remainingForArticle -= metadataTokens;
    const completeArticleTokens = articleChunks.reduce((sum, chunk) =>
      sum + estimateTokens(chunk.text) + 8, 0);
    const broadQuery = typeof shared.isBroadArticleChatQuery === 'function'
      ? shared.isBroadArticleChatQuery(input.query) : false;
    let mode = broadQuery && completeArticleTokens <= remainingForArticle
      ? 'full' : 'retrieval';
    let chunks;
    let retrieval = null;
    if (mode === 'full') {
      chunks = articleChunks.slice();
    } else {
      retrieval = await shared.retrieveArticleChatContext(index, input.query, {
        maxChars: Math.max(200, Math.min(
          broadQuery ? 60000 : 18000,
          Math.floor(remainingForArticle * 3)
        )),
        limit: Math.max(1, Math.min(
          broadQuery ? 12 : 8,
          Math.ceil(remainingForArticle / 500)
        )),
        neighborRadius: input.neighborRadius ?? 1,
        embedTexts: input.embedTexts
      });
      chunks = retrieval.chunks.slice();
    }

    if (requiredChunks.length) {
      const required = new Set(requiredChunkIds);
      chunks = [
        ...requiredChunks,
        ...chunks.filter(chunk => !required.has(chunk.chunkId))
      ];
    }

    let chunkTokens = chunks.reduce((sum, chunk) => sum + estimateTokens(chunk.text) + 8, 0);
    const requiredTokenCost = requiredChunks.reduce((sum, chunk) =>
      sum + estimateTokens(chunk.text) + 8, 0);
    if (requiredTokenCost > remainingForArticle) {
      throw contextError({
        phase: 'required-article-context', inputBudgetTokens,
        remainingForArticle, requiredTokenCost, requiredChunkIds
      });
    }
    while (chunks.length > Math.max(1, requiredChunks.length) &&
        chunkTokens > remainingForArticle) {
      chunks.pop();
      chunkTokens = chunks.reduce((sum, chunk) => sum + estimateTokens(chunk.text) + 8, 0);
    }
    if (!requiredChunks.length && chunks.length === 1 && chunkTokens > remainingForArticle) {
      const fitted = fitChunkToBudget(chunks[0], remainingForArticle);
      chunks = fitted ? [fitted] : [];
      chunkTokens = fitted ? estimateTokens(fitted.text) + 8 : 0;
    }
    if (!chunks.length || chunkTokens > remainingForArticle) {
      throw contextError({
        phase: 'article-context', inputBudgetTokens, remainingForArticle, chunkTokens
      });
    }
    const estimatedInputTokens = queryTokens + metadataTokens + memoryTokens + recent.used + chunkTokens;
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
      fixedInputTokens,
      metadataTokens,
      publicationMetadata,
      chunks: Object.freeze(chunks),
      requiredChunkIds: Object.freeze(requiredChunkIds),
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
