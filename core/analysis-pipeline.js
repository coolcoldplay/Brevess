(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(shared) {
  async function analyzeDocument({
    paragraphs,
    selectedCategories,
    cachedCategoryIds = new Set(),
    adapter,
    maxChars = 12000,
    maxRetries = 4,
    concurrency = 3,
    viewId = 'quick_story',
    paperBlueprint = {},
    studyProfile = null,
    resumeChunks = {},
    onChunkComplete = async () => {},
    sleepImpl = delay => new Promise(resolve => setTimeout(resolve, delay)),
    signal,
    waitIfPaused = async () => {},
    onProgress = () => {}
  }) {
    const missingCategories = selectedCategories.filter(item => !cachedCategoryIds.has(item.categoryId));
    if (!missingCategories.length) {
      return {
        annotations: [],
        analyzedCategoryIds: [],
        cachedCategoryIds: [...cachedCategoryIds],
        rejected: []
      };
    }

    const overlapParagraphs = viewId === 'quick_story' ? 1 : 2;
    const chunks = shared.chunkParagraphs(paragraphs, { maxChars, overlapParagraphs });
    const queue = [...chunks];
    const resumed = resumeChunks instanceof Map
      ? resumeChunks : new Map(Object.entries(resumeChunks || {}));
    const completedByChunk = new Map();
    const retrySchedule = [2000, 5000, 12000, 25000];
    const workerLimit = Math.max(1, Math.min(6, Math.floor(Number(concurrency) || 1)));
    let completedChunks = 0;
    let totalChunks = queue.length;
    let checkpointTail = Promise.resolve();

    function cancelledError() {
      return shared.operationError
        ? shared.operationError()
        : Object.assign(new Error('Analysis was cancelled'), { code: 'CANCELLED' });
    }

    async function checkpoint() {
      if (signal?.aborted) throw cancelledError();
      await waitIfPaused();
      if (signal?.aborted) throw cancelledError();
    }

    async function controlledSleep(delay) {
      await checkpoint();
      if (!signal) {
        await sleepImpl(delay);
        return checkpoint();
      }
      let onAbort;
      const aborted = new Promise((resolve, reject) => {
        onAbort = () => reject(cancelledError());
        signal.addEventListener('abort', onAbort, { once: true });
      });
      try {
        await Promise.race([sleepImpl(delay), aborted]);
      } finally {
        signal.removeEventListener('abort', onAbort);
      }
      await checkpoint();
    }

    function retryDelay(error, retryIndex) {
      const scheduled = retrySchedule[Math.min(retryIndex, retrySchedule.length - 1)];
      return Math.max(scheduled, Number(error?.retryAfterMs) || 0);
    }

    function report(event) {
      try { onProgress(event); } catch { /* Progress UI must not interrupt analysis. */ }
    }

    function splitChunk(chunk) {
      const midpoint = Math.ceil(chunk.paragraphs.length / 2);
      const safeOverlap = Math.min(overlapParagraphs, Math.max(0, midpoint - 1));
      const rightStart = Math.max(1, midpoint - safeOverlap);
      return [
        { ...chunk, chunkId: `${chunk.chunkId}a`, paragraphs: chunk.paragraphs.slice(0, midpoint) },
        { ...chunk, chunkId: `${chunk.chunkId}b`, paragraphs: chunk.paragraphs.slice(rightStart) }
      ];
    }

    function shouldSplitAfterError(error, attempt, paragraphCount) {
      if (paragraphCount <= 1) return false;
      if (error?.code === 'OUTPUT_TRUNCATED' || error?.code === 'REQUEST_TIMEOUT') return true;
      return error?.code === 'PROVIDER_UNAVAILABLE' && attempt >= 2;
    }

    function serializeCheckpoint(completed) {
      const operation = checkpointTail.then(() => onChunkComplete(completed));
      checkpointTail = operation.catch(() => {});
      return operation;
    }

    async function finishChunk(chunk, completed, options = {}) {
      await checkpoint();
      completedByChunk.set(chunk.chunkId, completed);
      resumed.set(chunk.chunkId, completed);
      await serializeCheckpoint(completed);
      completedChunks += 1;
      report({
        phase: 'complete',
        chunkId: chunk.chunkId,
        completedChunks,
        totalChunks,
        attempt: options.attempt || 1,
        resumed: options.resumed === true
      });
    }

    async function processChunk(chunk) {
      await checkpoint();
      const savedCheckpoint = resumed.get(chunk.chunkId);
      if (savedCheckpoint) {
        await finishChunk(chunk, savedCheckpoint, { resumed: true });
        return null;
      }

      const prompt = shared.compileAnalysisPrompt({
        categories: missingCategories,
        chunkId: chunk.chunkId,
        sectionTitle: chunk.sectionTitle,
        sectionKind: chunk.sectionKind,
        paragraphs: chunk.paragraphs,
        viewId,
        paperBlueprint,
        studyProfile
      });
      const request = { ...prompt, paragraphs: chunk.paragraphs };
      let response;
      let attempt = 1;
      report({
        phase: 'analyzing', chunkId: chunk.chunkId,
        completedChunks, totalChunks, attempt
      });

      while (true) {
        try {
          await checkpoint();
          response = await adapter.analyzeChunk({ ...request, signal });
          break;
        } catch (error) {
          if (signal?.aborted) throw cancelledError();
          if (shouldSplitAfterError(error, attempt, chunk.paragraphs.length)) {
            const children = splitChunk(chunk);
            report({
              phase: 'split', chunkId: chunk.chunkId,
              completedChunks, totalChunks: totalChunks + 1,
              errorCode: error.code
            });
            return { split: children };
          }
          if (!error?.retryable || attempt > maxRetries) throw error;
          attempt += 1;
          const waitMs = retryDelay(error, attempt - 2);
          report({
            phase: 'retry', chunkId: chunk.chunkId,
            completedChunks, totalChunks, attempt, waitMs,
            errorCode: error.code || 'NETWORK_ERROR'
          });
          await controlledSleep(waitMs);
        }
      }

      const validated = shared.validateChunkResult({
        paragraphs: chunk.paragraphs,
        requestedCategoryIds: prompt.requestedCategoryIds,
        requestedCategories: prompt.requestedCategories,
        response,
        expectedChunkId: chunk.chunkId
      });
      let chunkAnnotations = [...validated.annotations];
      let chunkRejected = [...validated.rejected];
      let missingParagraphIds = [...(validated.missingParagraphIds || [])];

      if (missingParagraphIds.length) {
        const missingParagraphs = chunk.paragraphs.filter(item =>
          missingParagraphIds.includes(item.paragraphId));
        if (missingParagraphs.length) {
          report({
            phase: 'coverage_retry', chunkId: chunk.chunkId,
            completedChunks, totalChunks,
            missingParagraphCount: missingParagraphs.length
          });
          try {
            await checkpoint();
            const coverageChunkId = `${chunk.chunkId}:coverage`;
            const coveragePrompt = shared.compileAnalysisPrompt({
              categories: missingCategories,
              chunkId: coverageChunkId,
              sectionTitle: chunk.sectionTitle,
              sectionKind: chunk.sectionKind,
              paragraphs: missingParagraphs,
              viewId,
              paperBlueprint,
              studyProfile
            });
            const coverageResponse = await adapter.analyzeChunk({
              ...coveragePrompt,
              paragraphs: missingParagraphs,
              signal
            });
            const coverageValidated = shared.validateChunkResult({
              paragraphs: missingParagraphs,
              requestedCategoryIds: coveragePrompt.requestedCategoryIds,
              requestedCategories: coveragePrompt.requestedCategories,
              response: coverageResponse,
              expectedChunkId: coverageChunkId
            });
            chunkAnnotations.push(...coverageValidated.annotations);
            chunkRejected.push(...coverageValidated.rejected);
            missingParagraphIds = coverageValidated.missingParagraphIds || [];
          } catch (error) {
            if (signal?.aborted || error?.code === 'CANCELLED') throw cancelledError();
            chunkRejected.push({ reason: 'COVERAGE_RETRY_FAILED', errorCode: error?.code || '' });
          }
        }
      }

      const groundingCategoryIds = [...new Set(chunkRejected
        .filter(item => item?.reason === 'SLOT_VALUE_NOT_GROUNDED')
        .map(item => String(item?.annotation?.category_id || ''))
        .filter(Boolean))];
      const groundingCategories = missingCategories.filter(item =>
        groundingCategoryIds.includes(item.categoryId));
      if (groundingCategories.length) {
        report({
          phase: 'grounding_retry', chunkId: chunk.chunkId,
          completedChunks, totalChunks,
          categoryIds: groundingCategories.map(item => item.categoryId)
        });
        try {
          await checkpoint();
          const groundingChunkId = `${chunk.chunkId}:grounding`;
          const groundingPrompt = shared.compileAnalysisPrompt({
            categories: groundingCategories,
            chunkId: groundingChunkId,
            sectionTitle: chunk.sectionTitle,
            sectionKind: chunk.sectionKind,
            paragraphs: chunk.paragraphs,
            viewId,
            paperBlueprint,
            studyProfile
          });
          groundingPrompt.systemPrompt = [
            groundingPrompt.systemPrompt,
            'GROUNDING_REPAIR_PASS: A prior response used slot values that were not copied verbatim from its own quotes.',
            'Reassess the supplied paragraphs for the active categories. Return an annotation only if every required slot is an exact substring of one of that annotation\'s highlight_quotes; do not expand abbreviations, summarize evidence, or supply unstated design details.'
          ].join('\n');
          const groundingResponse = await adapter.analyzeChunk({
            ...groundingPrompt,
            paragraphs: chunk.paragraphs,
            signal
          });
          const groundingValidated = shared.validateChunkResult({
            paragraphs: chunk.paragraphs,
            requestedCategoryIds: groundingPrompt.requestedCategoryIds,
            requestedCategories: groundingPrompt.requestedCategories,
            response: groundingResponse,
            expectedChunkId: groundingChunkId
          });
          chunkAnnotations.push(...groundingValidated.annotations);
          chunkRejected.push(...groundingValidated.rejected);
        } catch (error) {
          if (signal?.aborted || error?.code === 'CANCELLED') throw cancelledError();
          chunkRejected.push({ reason: 'GROUNDING_RETRY_FAILED', errorCode: error?.code || '' });
        }
      }

      const completed = {
        chunkId: chunk.chunkId,
        annotations: chunkAnnotations,
        rejected: chunkRejected,
        missingParagraphIds
      };
      await finishChunk(chunk, completed, { attempt });
      return null;
    }

    await new Promise((resolve, reject) => {
      let cursor = 0;
      let active = 0;
      let firstError = null;

      const pump = () => {
        while (!firstError && active < workerLimit && cursor < queue.length) {
          const chunk = queue[cursor];
          cursor += 1;
          active += 1;
          processChunk(chunk).then(outcome => {
            if (outcome?.split?.length === 2) {
              totalChunks += 1;
              queue.push(...outcome.split);
            }
          }).catch(error => {
            firstError ||= error;
          }).finally(() => {
            active -= 1;
            if (active === 0 && (firstError || cursor >= queue.length)) {
              if (firstError) reject(firstError);
              else resolve();
              return;
            }
            pump();
          });
        }
        if (active === 0 && cursor >= queue.length) resolve();
      };
      pump();
    });
    await checkpointTail;

    const ordered = [...completedByChunk.entries()]
      .sort(([first], [second]) => first.localeCompare(second, 'en'))
      .map(([, completed]) => completed);
    const accepted = ordered.flatMap(item => item.annotations || []);
    const rejected = ordered.flatMap(item => item.rejected || []);
    return {
      annotations: shared.mergeAnnotations(accepted),
      analyzedCategoryIds: missingCategories.map(item => item.categoryId),
      cachedCategoryIds: [...cachedCategoryIds],
      rejected
    };
  }

  return { analyzeDocument };
});
