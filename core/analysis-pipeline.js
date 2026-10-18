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
    resumeParagraphs = {},
    resumeDecisionRounds = {},
    onChunkComplete = async () => {},
    onParagraphComplete = async () => {},
    onDecisionRoundComplete = async () => {},
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
    const resumedParagraphs = resumeParagraphs instanceof Map
      ? resumeParagraphs : new Map(Object.entries(resumeParagraphs || {}));
    const completedByChunk = new Map();
    const decisionRounds = new Map(Object.entries(resumeDecisionRounds || {}));
    const retrySchedule = [2000, 5000, 12000, 25000];
    const workerLimit = Math.max(1, Math.min(6, Math.floor(Number(concurrency) || 1)));
    let completedChunks = 0;
    let totalChunks = queue.length;
    let checkpointTail = Promise.resolve();
    let paragraphCheckpointTail = Promise.resolve();
    let paragraphCheckpointError = null;
    let decisionCheckpointTail = Promise.resolve();

    const decisionCheckpoint = {
      get: key => decisionRounds.get(key),
      beforeRequest: checkpoint,
      async put(completed) {
        // Preserve a validated paid response even if the user paused or stopped.
        // Dispatch and final chunk commits still pass through checkpoint().
        const operation = decisionCheckpointTail.then(() => onDecisionRoundComplete(completed));
        decisionCheckpointTail = operation.catch(() => {});
        try { await operation; } catch (error) {
          // A storage failure is not a failed model request and must never spend another call.
          error.retryable = false;
          error.code ||= 'ANALYSIS_CHECKPOINT_WRITE_FAILED';
          throw error;
        }
        decisionRounds.set(completed.key, completed);
        if (decisionRounds.size > 4096) decisionRounds.delete(decisionRounds.keys().next().value);
      }
    };

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
      if (error?.code === 'INVALID_RESPONSE') return attempt >= 2;
      return error?.code === 'PROVIDER_UNAVAILABLE' && attempt >= 2;
    }

    function serializeCheckpoint(completed) {
      const operation = checkpointTail.then(() => onChunkComplete(completed));
      checkpointTail = operation.catch(() => {});
      return operation;
    }

    function serializeParagraphCheckpoint(completed) {
      const operation = paragraphCheckpointTail.then(() => onParagraphComplete(completed));
      paragraphCheckpointTail = operation.catch(error => {
        paragraphCheckpointError ||= error;
      });
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

    async function processStreamingChunk(chunk) {
      const paragraphResults = new Map();
      chunk.paragraphs.forEach((item, paragraphIndex) => {
        const saved = resumedParagraphs.get(`${chunk.chunkId}:${paragraphIndex}`);
        if (saved?.paragraphId === item.paragraphId) paragraphResults.set(paragraphIndex, saved);
      });
      let attempt = 1;
      let continuation = 0;
      const maximumContinuations = Math.max(3, Math.min(12, chunk.paragraphs.length + 2));

      while (paragraphResults.size < chunk.paragraphs.length) {
        await checkpoint();
        const completedIndices = [...paragraphResults.keys()];
        const prompt = shared.compileAnalysisStreamPrompt({
          categories: missingCategories,
          chunkId: chunk.chunkId,
          sectionTitle: chunk.sectionTitle,
          sectionKind: chunk.sectionKind,
          paragraphs: chunk.paragraphs,
          viewId,
          paperBlueprint,
          studyProfile,
          completedIndices
        });
        const beforeCount = paragraphResults.size;
        const parser = shared.createHighlightNdjsonParser({
          categoryCodeMap: prompt.categoryCodeMap,
          sentenceQuoteMap: prompt.sentenceQuoteMap,
          pendingIndices: prompt.pendingIndices,
          onParagraph: record => {
            const materialized = shared.materializeHighlightStreamRecord({
              record,
              paragraphs: chunk.paragraphs,
              categories: missingCategories
            });
            const validated = shared.validateChunkResult({
              paragraphs: chunk.paragraphs,
              requestedCategoryIds: prompt.requestedCategoryIds,
              requestedCategories: prompt.requestedCategories,
              response: materialized,
              expectedChunkId: `${chunk.chunkId}:p${record.paragraphIndex}`
            });
            const completed = {
              chunkId: chunk.chunkId,
              paragraphIndex: record.paragraphIndex,
              paragraphId: chunk.paragraphs[record.paragraphIndex]?.paragraphId || '',
              annotations: validated.annotations,
              rejected: validated.rejected,
              protocol: 'ndjson-v1'
            };
            paragraphResults.set(record.paragraphIndex, completed);
            resumedParagraphs.set(`${chunk.chunkId}:${record.paragraphIndex}`, completed);
            serializeParagraphCheckpoint(completed);
            report({
              phase: 'paragraph_checkpoint',
              chunkId: chunk.chunkId,
              paragraphId: completed.paragraphId,
              completedParagraphs: paragraphResults.size,
              totalParagraphs: chunk.paragraphs.length
            });
          }
        });
        let terminalError = null;
        report({
          phase: continuation ? 'stream_continuation' : 'analyzing',
          chunkId: chunk.chunkId,
          completedChunks,
          totalChunks,
          attempt,
          completedParagraphs: paragraphResults.size,
          totalParagraphs: chunk.paragraphs.length
        });
        try {
          const request = {
            ...prompt,
            paragraphs: chunk.paragraphs.filter((item, index) =>
              prompt.pendingIndices.includes(index)),
            outputUnits: prompt.pendingIndices.length,
            structuredOutput: true,
            signal
          };
          for await (const event of adapter.generateTextStream(request)) {
            if (event?.type === 'text_delta') parser.push(event.text);
            else if (event?.type === 'usage') report({
              phase: 'provider_usage', chunkId: chunk.chunkId, usage: event.usage
            });
            else if (event?.type === 'error') throw shared.providerStreamEventError(event);
            else if (event?.type === 'cancelled') throw cancelledError();
          }
          parser.finish();
        } catch (error) {
          terminalError = error;
          parser.discardPending();
        }
        await paragraphCheckpointTail;
        if (paragraphCheckpointError) throw paragraphCheckpointError;
        const madeProgress = paragraphResults.size > beforeCount;
        if (paragraphResults.size >= chunk.paragraphs.length) {
          const completed = {
            chunkId: chunk.chunkId,
            annotations: [...paragraphResults.values()].flatMap(item => item.annotations || []),
            rejected: [...paragraphResults.values()].flatMap(item => item.rejected || []),
            missingParagraphIds: [],
            protocol: 'ndjson-v1'
          };
          await finishChunk(chunk, completed, { attempt });
          return null;
        }

        const canContinueImmediately = !terminalError || [
          'OUTPUT_TRUNCATED', 'INVALID_RESPONSE', 'REQUEST_TIMEOUT'
        ].includes(terminalError.code);
        if (madeProgress && canContinueImmediately && continuation < maximumContinuations) {
          continuation += 1;
          report({
            phase: 'coverage_continuation',
            chunkId: chunk.chunkId,
            completedChunks,
            totalChunks,
            remainingParagraphCount: chunk.paragraphs.length - paragraphResults.size,
            errorCode: terminalError?.code || ''
          });
          continue;
        }
        const effectiveError = terminalError || Object.assign(
          new Error('Highlight stream ended without covering pending paragraphs'),
          { code: 'INVALID_RESPONSE', retryable: true }
        );
        if (shouldSplitAfterError(effectiveError, attempt, chunk.paragraphs.length) &&
            paragraphResults.size === 0) {
          const children = splitChunk(chunk);
          report({
            phase: 'split', chunkId: chunk.chunkId,
            completedChunks, totalChunks: totalChunks + 1,
            errorCode: effectiveError.code
          });
          return { split: children };
        }
        const recoverableFormatError = effectiveError.code === 'INVALID_RESPONSE';
        if ((!effectiveError.retryable && !recoverableFormatError) || attempt > maxRetries ||
            continuation >= maximumContinuations) throw effectiveError;
        const waitMs = retryDelay(effectiveError, attempt - 1);
        attempt += 1;
        report({
          phase: 'retry', chunkId: chunk.chunkId,
          completedChunks, totalChunks, attempt, waitMs,
          errorCode: effectiveError.code || 'NETWORK_ERROR'
        });
        await controlledSleep(waitMs);
      }
      return null;
    }

    async function processChunk(chunk) {
      await checkpoint();
      const savedCheckpoint = resumed.get(chunk.chunkId);
      if (savedCheckpoint) {
        await finishChunk(chunk, savedCheckpoint, { resumed: true });
        return null;
      }

      if (typeof adapter.generateTextStream === 'function' &&
          typeof shared.compileAnalysisStreamPrompt === 'function' &&
          typeof shared.createHighlightNdjsonParser === 'function') {
        return processStreamingChunk(chunk);
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
          response = await adapter.analyzeChunk({ ...request, signal, decisionCheckpoint });
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
      let fatalError = null;
      const failedChunks = [];

      const pump = () => {
        while (!fatalError && active < workerLimit && cursor < queue.length) {
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
            failedChunks.push({ chunkId: chunk.chunkId, errorCode: error?.code || 'UNKNOWN_ERROR' });
            // Malformed content in one chunk must not discard the rest of the document.
            // Transport, authentication, cancellation and persistence failures stop dispatch.
            if (error?.diagnosticType === 'HtmlResponse' ||
                !['INVALID_RESPONSE', 'OUTPUT_TRUNCATED', 'JEV_LIMIT_EXCEEDED'].includes(error?.code)) {
              fatalError ||= error;
            }
            report({ phase: 'chunk_failed', chunkId: chunk.chunkId, completedChunks,
              totalChunks, errorCode: error?.code || 'UNKNOWN_ERROR' });
          }).finally(() => {
            active -= 1;
            if (active === 0 && (fatalError || cursor >= queue.length)) {
              if (firstError) {
                const failure = fatalError || firstError;
                failure.failedChunks = failedChunks;
                failure.completedChunks = completedChunks;
                failure.totalChunks = totalChunks;
                reject(failure);
              }
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
    await Promise.all([checkpointTail, paragraphCheckpointTail]);

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
