(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(shared) {
  const RETRY_SCHEDULE = [2000, 5000, 12000, 25000];
  const FATAL_CODES = new Set([
    'INVALID_SETTINGS', 'AUTH_INVALID', 'QUOTA_EXHAUSTED', 'CANCELLED', 'LLM_NOT_READY'
  ]);
  const RECOVERABLE_REDUCE_CODES = new Set([
    'REQUEST_TIMEOUT', 'RATE_LIMITED', 'PROVIDER_UNAVAILABLE',
    'NETWORK_ERROR', 'OUTPUT_TRUNCATED', 'INVALID_RESPONSE'
  ]);

  function localHash(value) {
    const input = JSON.stringify(value);
    let hash = 2166136261;
    for (let index = 0; index < input.length; index += 1) {
      hash ^= input.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  function chunkSignature(chunk) {
    return localHash((chunk?.paragraphs || []).map(item => ({
      paragraphId: item.paragraphId, text: item.text,
      headingPath: item.headingPath || []
    })));
  }

  function splitReviewChunk(chunk) {
    const midpoint = Math.ceil(chunk.paragraphs.length / 2);
    return [
      { ...chunk, chunkId: `${chunk.chunkId}a`, paragraphs: chunk.paragraphs.slice(0, midpoint) },
      { ...chunk, chunkId: `${chunk.chunkId}b`, paragraphs: chunk.paragraphs.slice(midpoint) }
    ];
  }

  function shouldSplit(error, attempt, paragraphCount) {
    if (paragraphCount <= 1) return false;
    if (error?.code === 'OUTPUT_TRUNCATED' || error?.code === 'REQUEST_TIMEOUT') return true;
    if (error?.code === 'INVALID_RESPONSE') return attempt >= 2;
    return error?.code === 'PROVIDER_UNAVAILABLE' && attempt >= 2;
  }

  function retryDelay(error, retryIndex) {
    const scheduled = RETRY_SCHEDULE[Math.min(retryIndex, RETRY_SCHEDULE.length - 1)];
    return Math.max(scheduled, Number(error?.retryAfterMs) || 0);
  }

  function withFormatRepairPrompt(prompt, previousErrorCode) {
    if (previousErrorCode !== 'INVALID_RESPONSE') return prompt;
    return {
      ...prompt,
      systemPrompt: `${prompt.systemPrompt}\n` +
        '上一轮输出格式不合格。请严格逐字段核对 JSON schema、ID 完整性和唯一性后重新输出；不要添加 Markdown 或解释。'
    };
  }

  async function analyzeReviewOutline({
    paragraphs,
    articleTitle,
    reviewSubtype = 'narrative',
    documentHash = '',
    adapter,
    resumeChunks = new Map(),
    onChunkComplete = async () => {},
    onProgress = () => {},
    sleepImpl = delay => new Promise(resolve => setTimeout(resolve, delay)),
    maxChars = 10000,
    maxRetries = 4,
    paragraphOnly = false
  }) {
    const sourceParagraphs = Array.isArray(paragraphs) ? paragraphs : [];
    if (!sourceParagraphs.length) {
      const error = new Error('Review outline requires at least one paragraph');
      error.code = 'INVALID_REQUEST';
      throw error;
    }
    if (!adapter?.generateJson) {
      const error = new Error('Review outline requires a JSON-capable provider');
      error.code = 'INVALID_SETTINGS';
      throw error;
    }
    const resumed = resumeChunks instanceof Map
      ? resumeChunks : new Map(Object.entries(resumeChunks || {}));
    const queue = shared.chunkParagraphs(sourceParagraphs, {
      maxChars, overlapParagraphs: 0
    });
    const summaries = [];
    const completedParagraphIds = new Set();
    let completedChunks = 0;

    function report(event) {
      try {
        onProgress({
          completedParagraphs: completedParagraphIds.size,
          totalParagraphs: sourceParagraphs.length,
          completedChunks,
          totalChunks: queue.length,
          ...event
        });
      } catch { /* Progress rendering cannot interrupt analysis. */ }
    }

    for (let chunkIndex = 0; chunkIndex < queue.length; chunkIndex += 1) {
      const chunk = queue[chunkIndex];
      const signature = chunkSignature(chunk);
      const checkpoint = resumed.get(chunk.chunkId);
      if (checkpoint?.paragraphSignature === signature &&
          Array.isArray(checkpoint.summaries)) {
        const expectedIds = chunk.paragraphs.map(item => item.paragraphId);
        const actualIds = checkpoint.summaries.map(item => item.paragraphId);
        if (expectedIds.length === actualIds.length &&
            expectedIds.every(id => actualIds.includes(id))) {
          summaries.push(...checkpoint.summaries);
          actualIds.forEach(id => completedParagraphIds.add(id));
          completedChunks += 1;
          report({ phase: 'review_map', chunkId: chunk.chunkId, resumed: true });
          continue;
        }
      }

      let attempt = 1;
      let split = false;
      let validated;
      let previousErrorCode = '';
      report({ phase: 'review_map', chunkId: chunk.chunkId, attempt });
      while (true) {
        const prompt = withFormatRepairPrompt(
          shared.compileReviewParagraphPrompt(chunk.chunkId, chunk.paragraphs),
          previousErrorCode
        );
        try {
          const response = await adapter.generateJson({
            ...prompt,
            outputUnits: chunk.paragraphs.length
          });
          validated = shared.validateReviewParagraphBatch(
            response, chunk.paragraphs, chunk.chunkId
          );
          break;
        } catch (error) {
          previousErrorCode = error?.code || '';
          if (shouldSplit(error, attempt, chunk.paragraphs.length)) {
            const children = splitReviewChunk(chunk);
            queue.splice(chunkIndex, 1, ...children);
            report({
              phase: 'review_split', chunkId: chunk.chunkId,
              errorCode: error?.code || 'NETWORK_ERROR'
            });
            split = true;
            break;
          }
          const recoverableFormatError = error?.code === 'INVALID_RESPONSE';
          if ((!error?.retryable && !recoverableFormatError) || attempt > maxRetries) throw error;
          attempt += 1;
          const waitMs = retryDelay(error, attempt - 2);
          report({
            phase: 'review_retry', chunkId: chunk.chunkId, attempt, waitMs,
            errorCode: error?.code || 'NETWORK_ERROR'
          });
          await sleepImpl(waitMs);
        }
      }
      if (split) {
        chunkIndex -= 1;
        continue;
      }

      summaries.push(...validated);
      validated.forEach(item => completedParagraphIds.add(item.paragraphId));
      const completed = {
        chunkId: chunk.chunkId,
        paragraphSignature: signature,
        paragraphIds: chunk.paragraphs.map(item => item.paragraphId),
        summaries: validated
      };
      resumed.set(chunk.chunkId, completed);
      await onChunkComplete(completed);
      completedChunks += 1;
      report({ phase: 'review_map', chunkId: chunk.chunkId, attempt });
    }

    const summaryById = new Map(summaries.map(item => [item.paragraphId, item]));
    const orderedSummaries = sourceParagraphs.map(item => summaryById.get(item.paragraphId));
    if (orderedSummaries.some(item => !item) || summaryById.size !== sourceParagraphs.length) {
      const error = new Error('Review map did not cover every paragraph exactly once');
      error.code = 'INVALID_RESPONSE';
      throw error;
    }

    if (paragraphOnly) {
      const outline = shared.buildReviewOutlineTree({
        articleTitle, reviewSubtype, documentHash,
        paragraphs: sourceParagraphs, summaries: orderedSummaries, synthesis: null
      });
      const result = {
        ...outline,
        paragraphCount: orderedSummaries.length,
        completedChunks,
        globalSynthesisAvailable: false
      };
      report({ phase: 'review_complete', globalSynthesisAvailable: false });
      return result;
    }

    report({ phase: 'review_reduce' });
    const reducePrompt = shared.compileReviewSynthesisPrompt(
      articleTitle, sourceParagraphs, orderedSummaries, reviewSubtype
    );
    const expectedSectionIds = reducePrompt.responseSchema.properties.sections
      .items.properties.section_id.enum;
    let synthesis = null;
    let reduceAttempt = 1;
    let reducePreviousErrorCode = '';
    while (true) {
      try {
        const response = await adapter.generateJson(
          {
            ...withFormatRepairPrompt(reducePrompt, reducePreviousErrorCode),
            outputUnits: expectedSectionIds.length
          }
        );
        synthesis = shared.validateReviewSynthesis(
          response, expectedSectionIds, sourceParagraphs
        );
        break;
      } catch (error) {
        reducePreviousErrorCode = error?.code || '';
        if (FATAL_CODES.has(error?.code)) throw error;
        const recoverable = error?.retryable === true || RECOVERABLE_REDUCE_CODES.has(error?.code);
        if (!recoverable) throw error;
        if (reduceAttempt >= 2) break;
        reduceAttempt += 1;
        const waitMs = retryDelay(error, reduceAttempt - 2);
        report({
          phase: 'review_retry', stage: 'reduce', attempt: reduceAttempt,
          waitMs, errorCode: error?.code || 'NETWORK_ERROR'
        });
        await sleepImpl(waitMs);
      }
    }

    const outline = shared.buildReviewOutlineTree({
      articleTitle, reviewSubtype, documentHash,
      paragraphs: sourceParagraphs, summaries: orderedSummaries, synthesis
    });
    const result = {
      ...outline,
      paragraphCount: orderedSummaries.length,
      completedChunks,
      globalSynthesisAvailable: Boolean(synthesis)
    };
    report({ phase: 'review_complete', globalSynthesisAvailable: Boolean(synthesis) });
    return result;
  }

  return { analyzeReviewOutline };
});
