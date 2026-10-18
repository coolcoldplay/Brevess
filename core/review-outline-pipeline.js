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

  function withFormatRepairPrompt(prompt, previousErrorCode, validationIssue = '') {
    if (previousErrorCode !== 'INVALID_RESPONSE') return prompt;
    return {
      ...prompt,
      systemPrompt: `${prompt.systemPrompt}\n` +
        '上一轮输出格式不合格。请严格逐字段核对 JSON schema、ID 完整性和唯一性后重新输出；不要添加 Markdown 或解释。' +
        (validationIssue ? '\n本地校验指出：' + validationIssue : '')
    };
  }

  function extractiveParagraphFallback(paragraph) {
    const source = String(paragraph?.text || '')
      .normalize('NFKC')
      .replace(/\s+/g, ' ')
      .trim();
    const firstSentence = source.match(/^.*?[.!?。！？](?:\s|$)/u)?.[0]?.trim() || source;
    const excerpt = firstSentence.slice(0, 520).trim();
    const summary = `（模型格式异常，暂显示原文首句）${excerpt || '本段正文暂不可用。'}`;
    return {
      paragraphId: String(paragraph?.paragraphId || ''),
      summary,
      rhetoricalRole: 'other',
      keyPoint: summary.slice(0, 500),
      transitionFromPrevious: '',
      fallbackMode: 'extractive'
    };
  }

  async function analyzeReviewOutline({
    paragraphs,
    articleTitle,
    reviewSubtype = 'narrative',
    analysisStrategy = 'review',
    documentHash = '',
    adapter,
    resumeChunks = new Map(),
    onChunkComplete = async () => {},
    onProgress = () => {},
    sleepImpl,
    maxChars = 10000,
    maxRetries = 4,
    paragraphOnly = false,
    signal,
    assertCurrent = () => {}
  }) {
    const guard = async () => {
      if (signal?.aborted) {
        throw Object.assign(new Error('Review outline was cancelled'), { code: 'CANCELLED', name: 'AbortError', retryable: false });
      }
      await assertCurrent();
      if (signal?.aborted) throw Object.assign(new Error('Review outline was cancelled'), { code: 'CANCELLED', retryable: false });
    };
    const waitForRetry = async delay => {
      await guard();
      let retryTimer;
      const sleep = () => typeof sleepImpl === 'function' ? sleepImpl(delay, { signal })
        : new Promise(resolve => { retryTimer = setTimeout(resolve, delay); });
      if (!signal) { await sleep(); await guard(); return; }
      let abort;
      const cancelled = new Promise((_, reject) => {
        abort = () => reject(Object.assign(new Error('Review outline was cancelled'),
          { code: 'CANCELLED', name: 'AbortError', retryable: false }));
        signal.addEventListener('abort', abort, { once: true });
      });
      try { await Promise.race([Promise.resolve().then(async () => { await guard(); return sleep(); }), cancelled]); }
      finally { clearTimeout(retryTimer); signal.removeEventListener('abort', abort); }
      await guard();
    };
    await guard();
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
    const summaries = [];
    const completedParagraphIds = new Set();
    let completedChunks = 0;
    const sourceById = new Map(sourceParagraphs.map(item => [item.paragraphId, item]));
    const restoredChunks = [];
    // A previous timeout may have split a chunk. Reuse its validated children
    // by their exact source signature, not only by the next run's parent ID.
    for (const checkpoint of resumed.values()) {
      const ids = checkpoint?.paragraphIds;
      const saved = checkpoint?.summaries;
      if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length ||
          !Array.isArray(saved) || saved.length !== ids.length ||
          !ids.every(id => sourceById.has(id)) ||
          new Set(saved.map(item => item?.paragraphId)).size !== ids.length ||
          !saved.every(item => ids.includes(item?.paragraphId)) ||
          checkpoint.paragraphSignature !== chunkSignature({ paragraphs: ids.map(id => sourceById.get(id)) })) continue;
      const fresh = saved.filter(item => !completedParagraphIds.has(item.paragraphId));
      if (!fresh.length) continue;
      summaries.push(...fresh);
      fresh.forEach(item => completedParagraphIds.add(item.paragraphId));
      completedChunks++;
      restoredChunks.push({ ...checkpoint, summaries: fresh });
    }
    const queue = shared.chunkParagraphs(sourceParagraphs.filter(item =>
      !completedParagraphIds.has(item.paragraphId)), { maxChars, overlapParagraphs: 0 });
    if (completedParagraphIds.size) queue.forEach(chunk => {
      chunk.chunkId = `${chunk.chunkId}-resume-${chunkSignature(chunk)}`;
    });
    const restoredChunkCount = completedChunks;

    async function report(event) {
      await guard();
      try {
        await onProgress({
          completedParagraphs: completedParagraphIds.size,
          totalParagraphs: sourceParagraphs.length,
          completedChunks,
          totalChunks: restoredChunkCount + queue.length,
          ...event
        });
      } catch { /* Progress rendering cannot interrupt analysis. */ }
    }

    for (const checkpoint of restoredChunks) {
      await report({ phase: 'review_chunk_checkpoint', chunkId: checkpoint.chunkId,
        checkpointSummaries: checkpoint.summaries, resumed: true });
    }

    for (let chunkIndex = 0; chunkIndex < queue.length; chunkIndex += 1) {
      await guard();
      const chunk = queue[chunkIndex];
      const signature = chunkSignature(chunk);

      let attempt = 1;
      let split = false;
      let validated;
      let previousErrorCode = '';
      await report({ phase: 'review_map', chunkId: chunk.chunkId, attempt });
      while (true) {
        await guard();
        const prompt = withFormatRepairPrompt(
          shared.compileReviewParagraphPrompt(
            chunk.chunkId, chunk.paragraphs, analysisStrategy
          ),
          previousErrorCode
        );
        try {
          const response = await adapter.generateJson({
            ...prompt,
            signal,
            outputUnits: chunk.paragraphs.length
          });
          await guard();
          validated = shared.validateReviewParagraphBatch(
            response, chunk.paragraphs, chunk.chunkId
          );
          break;
        } catch (error) {
          await guard();
          if (FATAL_CODES.has(error?.code) || error?.code === 'STALE_OPERATION') throw error;
          previousErrorCode = error?.code || '';
          if (shouldSplit(error, attempt, chunk.paragraphs.length)) {
            const children = splitReviewChunk(chunk);
            queue.splice(chunkIndex, 1, ...children);
            await report({
              phase: 'review_split', chunkId: chunk.chunkId,
              errorCode: error?.code || 'NETWORK_ERROR'
            });
            split = true;
            break;
          }
          if (error?.code === 'INVALID_RESPONSE' &&
              chunk.paragraphs.length === 1 && attempt >= 2) {
            validated = [extractiveParagraphFallback(chunk.paragraphs[0])];
            await report({
              phase: 'review_fallback', chunkId: chunk.chunkId,
              paragraphId: chunk.paragraphs[0]?.paragraphId || '',
              errorCode: 'INVALID_RESPONSE'
            });
            break;
          }
          const recoverableFormatError = error?.code === 'INVALID_RESPONSE';
          if ((!error?.retryable && !recoverableFormatError) || attempt > maxRetries) throw error;
          attempt += 1;
          const waitMs = retryDelay(error, attempt - 2);
          await report({
            phase: 'review_retry', chunkId: chunk.chunkId, attempt, waitMs,
            errorCode: error?.code || 'NETWORK_ERROR'
          });
          await waitForRetry(waitMs);
        }
      }
      if (split) {
        chunkIndex -= 1;
        continue;
      }

      await guard();
      const completed = {
        chunkId: chunk.chunkId,
        paragraphSignature: signature,
        paragraphIds: chunk.paragraphs.map(item => item.paragraphId),
        summaries: validated
      };
      await onChunkComplete(completed);
      // A confirmed chunk remains available if cancellation follows its save.
      resumed.set(chunk.chunkId, completed);
      await guard();
      summaries.push(...validated);
      validated.forEach(item => completedParagraphIds.add(item.paragraphId));
      completedChunks += 1;
      await report({ phase: 'review_map', chunkId: chunk.chunkId, attempt });
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
        articleTitle, reviewSubtype, analysisStrategy, documentHash,
        paragraphs: sourceParagraphs, summaries: orderedSummaries, synthesis: null
      });
      const result = {
        ...outline,
        paragraphCount: orderedSummaries.length,
        completedChunks,
        globalSynthesisAvailable: false,
        globalSynthesisStatus: 'not_requested',
        globalSynthesisFailure: null
      };
      await report({ phase: 'review_complete', globalSynthesisAvailable: false,
        globalSynthesisStatus: 'not_requested', globalSynthesisFailure: null });
      return result;
    }

    await report({ phase: 'review_reduce' });
    const reducePrompt = shared.compileReviewSynthesisPrompt(
      articleTitle, sourceParagraphs, orderedSummaries, reviewSubtype, analysisStrategy
    );
    const expectedSectionIds = reducePrompt.responseSchema.properties.sections
      .items.properties.section_id.enum;
    let synthesis = null;
    let reduceAttempt = 1;
    let reducePreviousErrorCode = '';
    let reduceValidationIssue = '';
    let globalSynthesisFailure = null;
    while (true) {
      await guard();
      try {
        const response = await adapter.generateJson(
          {
            ...withFormatRepairPrompt(reducePrompt, reducePreviousErrorCode, reduceValidationIssue),
            signal,
            outputUnits: expectedSectionIds.length
          }
        );
        await guard();
        try {
          synthesis = shared.validateReviewSynthesis(
            response, expectedSectionIds, sourceParagraphs
          );
        } catch (validationError) {
          // Only our own validator's bounded diagnostic may enter a repair
          // prompt. Provider response bodies and credentials are never copied.
          reduceValidationIssue = String(validationError.message || '').slice(0, 500);
          throw validationError;
        }
        globalSynthesisFailure = null;
        break;
      } catch (error) {
        await guard();
        reducePreviousErrorCode = error?.code || '';
        if (FATAL_CODES.has(error?.code)) throw error;
        const recoverable = error?.retryable === true || RECOVERABLE_REDUCE_CODES.has(error?.code);
        if (!recoverable) throw error;
        globalSynthesisFailure = {
          stage: 'global_synthesis',
          code: RECOVERABLE_REDUCE_CODES.has(error?.code) ? error.code : 'PROVIDER_UNAVAILABLE',
          attempts: reduceAttempt,
          retryable: true
        };
        if (reduceAttempt >= 3) break;
        reduceAttempt += 1;
        const waitMs = retryDelay(error, reduceAttempt - 2);
        await report({
          phase: 'review_retry', stage: 'reduce', attempt: reduceAttempt,
          waitMs, errorCode: error?.code || 'NETWORK_ERROR'
        });
        await waitForRetry(waitMs);
      }
    }

    const outline = shared.buildReviewOutlineTree({
      articleTitle, reviewSubtype, analysisStrategy, documentHash,
      paragraphs: sourceParagraphs, summaries: orderedSummaries, synthesis
    });
    const result = {
      ...outline,
      paragraphCount: orderedSummaries.length,
      completedChunks,
      globalSynthesisAvailable: Boolean(synthesis),
      globalSynthesisStatus: synthesis ? 'complete' : 'failed',
      globalSynthesisFailure
    };
    await report({ phase: 'review_complete', globalSynthesisAvailable: Boolean(synthesis),
      globalSynthesisStatus: result.globalSynthesisStatus, globalSynthesisFailure });
    return result;
  }

  return { analyzeReviewOutline };
});
