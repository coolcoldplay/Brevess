(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(shared) {
  const MAX_ARTICLE_CHAT_SEGMENTS = 8;
  function normalizeText(value, maximum = 16000) {
    return String(value || '').normalize('NFKC').replace(/\0/g, '')
      .replace(/\s+/gu, ' ').trim().slice(0, maximum);
  }

  function normalizeMarkdown(value, maximum = 64 * 1024) {
    return String(value || '').normalize('NFC').replace(/\0/g, '')
      .replace(/\r\n?/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim().slice(0, maximum);
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

  function invalidSettings(fields) {
    const error = new Error('Article chat input is invalid');
    error.code = 'INVALID_SETTINGS';
    error.fields = fields;
    return error;
  }

  function normalizeHeadingPath(value, fallbackTitle, fallbackId) {
    const path = (Array.isArray(value) ? value : []).map((item, index) => ({
      level: Math.max(1, Math.min(6, Number(item?.level) || 2)),
      sectionId: normalizeText(item?.sectionId || `${fallbackId}-${index + 1}`, 160),
      title: normalizeText(typeof item === 'string' ? item : item?.title, 300)
    })).filter(item => item.title);
    if (path.length || !fallbackTitle) return path;
    return [{ level: 2, sectionId: normalizeText(fallbackId, 160), title: fallbackTitle }];
  }

  function normalizeArticleParagraph(item, index) {
    const text = normalizeText(item?.text, 16000);
    if (!text) return null;
    const paragraphId = normalizeText(item?.paragraphId || `p-${index + 1}`, 160);
    const sourceKey = normalizeText(item?.sourceKey || paragraphId, 160);
    const sectionTitle = normalizeText(item?.sectionTitle, 300) || 'Article';
    const sectionId = normalizeText(item?.sectionId || `section-${hash(sectionTitle)}`, 160);
    const headingInput = Array.isArray(item?.headingPath)
      ? item.headingPath : item?.sectionPath;
    return {
      paragraphId,
      sourceKey,
      sourceIdentity: normalizeText(item?.sourceIdentity || sourceKey, 200),
      textHash: normalizeText(item?.textHash || hash(text), 160),
      recordType: normalizeText(item?.recordType || 'body', 40),
      sectionId,
      sectionTitle,
      sectionKind: normalizeText(item?.sectionKind || sectionTitle, 80).toLowerCase(),
      headingPath: normalizeHeadingPath(headingInput, sectionTitle, sectionId),
      text,
      order: Number.isFinite(Number(item?.order)) ? Number(item.order) : index
    };
  }

  function normalizeArticleHistory(value) {
    return (Array.isArray(value) ? value : []).map((turn, index) => ({
      turnId: normalizeText(turn?.turnId || turn?.id || `turn-${index + 1}`, 160),
      role: turn?.role === 'assistant' ? 'assistant' :
        turn?.role === 'user' ? 'user' : '',
      content: normalizeMarkdown(turn?.content, 32000),
      question: normalizeText(
        turn?.question || (turn?.role === 'user' ? turn?.content : ''), 4000
      ),
      answer: normalizeMarkdown(
        turn?.answer || (turn?.role === 'assistant' ? turn?.content : ''), 32000
      ),
      answerBlocks: (Array.isArray(turn?.answerBlocks) ? turn.answerBlocks : []).map(block => ({
        blockId: normalizeText(block?.blockId || block?.id, 160),
        markdown: normalizeMarkdown(block?.markdown || block?.text || block?.content, 64 * 1024)
      })).filter(block => block.markdown),
      summary: normalizeMarkdown(turn?.summary, 2000),
      createdAt: Math.max(0, Number(turn?.createdAt) || 0)
    })).filter(turn => turn.turnId && (
      turn.question || turn.answer || turn.content || turn.answerBlocks.length
    ));
  }

  function articleChatOutputUnits(question) {
    const text = String(question || '').normalize('NFKC');
    let units = Math.max(1, Math.ceil(text.length / 600));
    if (/(?:一步一步|逐步|分步骤|详细|详述|证据链|论证链|推理链|step[ -]?by[ -]?step|evidence chain|argument chain)/iu.test(text)) {
      units = Math.max(units, 8);
    }
    if (typeof shared.isBroadArticleChatQuery === 'function' &&
        shared.isBroadArticleChatQuery(text)) {
      units = Math.max(units, 8);
    }
    return units;
  }

  function normalizeArticleChatInput(message = {}) {
    const question = normalizeText(message?.question, 4000);
    if (!question) throw invalidSettings(['question']);
    const profileId = normalizeText(message?.profileId, 100);
    if (profileId && !/^profile_[a-z0-9_]{3,80}$/.test(profileId)) {
      throw invalidSettings(['profileId']);
    }
    const document = message?.document && typeof message.document === 'object'
      ? message.document : {};
    const sourceRecords = Array.isArray(document.typedRecords)
      ? document.typedRecords : document.paragraphs;
    const typedRecords = (Array.isArray(sourceRecords) ? sourceRecords : [])
      .map(normalizeArticleParagraph).filter(Boolean);
    const paragraphs = typedRecords.filter(item => item.recordType === 'body');
    if (!paragraphs.length) throw invalidSettings(['document.paragraphs']);
    const revision = Math.max(1, Number(document.revision) || 1);
    const documentHash = normalizeText(document.documentHash, 160) || hash(
      typedRecords.map(item => [item.sourceIdentity, item.textHash, item.recordType])
    );
    return {
      question,
      profileId,
      turnId: normalizeText(message?.turnId, 160),
      operationId: normalizeText(message?.operationId, 100),
      history: normalizeArticleHistory(message.history),
      cacheState: message?.cacheState && typeof message.cacheState === 'object'
        ? { ...message.cacheState } : null,
      document: {
        title: normalizeText(document.title, 1000),
        url: normalizeText(document.url || document.canonicalUrl, 2000),
        documentHash,
        revision,
        key: `${documentHash}:${revision}`,
        paragraphs,
        typedRecords
      }
    };
  }

  async function prepareArticleChatRequest(input, profile = {}, options = {}) {
    if (typeof shared.buildArticleChatIndex !== 'function' ||
        typeof shared.planArticleChatContext !== 'function') {
      throw new Error('Article chat planning modules are not loaded');
    }
    const snapshot = input.document;
    const index = shared.buildArticleChatIndex(snapshot, options.indexOptions);
    const memory = typeof shared.buildArticleChatMemory === 'function'
      ? shared.buildArticleChatMemory(input.history) : { entries: [] };
    const plan = await shared.planArticleChatContext({
      index,
      query: input.question,
      history: input.history,
      memory,
      profile,
      kind: 'articleChat',
      outputUnits: articleChatOutputUnits(input.question),
      cacheState: input.cacheState,
      embedTexts: options.embedTexts,
      neighborRadius: options.neighborRadius
    });
    return { snapshot, index, memory, plan };
  }

  function publicChunk(chunk) {
    return {
      chunkId: chunk.chunkId,
      recordType: chunk.recordType,
      sectionId: chunk.sectionId,
      sectionTitle: chunk.sectionTitle,
      sectionKind: chunk.sectionKind,
      headingPath: chunk.headingPath,
      sourceSpans: chunk.sourceSpans,
      text: chunk.text
    };
  }

  function includedHistory(input, plan) {
    const ids = new Set(plan.includedHistoryIds || []);
    return input.history.filter(turn => ids.has(turn.turnId)).map(turn => ({
      turnId: turn.turnId,
      question: turn.question,
      answer: turn.answer,
      answerBlocks: turn.answerBlocks,
      summary: turn.summary
    }));
  }

  function compileArticleChatPrompt(input, plan, options = {}) {
    const stablePayload = {
      article: {
        title: input.document.title,
        canonical_url: input.document.url,
        document_hash: input.document.documentHash,
        document_revision: input.document.revision,
        index_id: plan.indexId,
        context_mode: plan.mode,
        chunks: plan.chunks.map(publicChunk)
      }
    };
    const stablePrefix = `ARTICLE_CONTEXT\n${JSON.stringify(stablePayload)}\n`;
    const continuation = options.continuation || null;
    const dynamicPayload = {
      conversation_history: includedHistory(input, plan),
      retrieved_old_turn_memory: plan.localMemory,
      current_question: input.question,
      section_coverage: plan.sectionCoverage,
      continuation: continuation ? {
        continue_after_block_ids: continuation.blockIds,
        turn_summary_so_far: continuation.summary || '',
        instruction: continuation.formatRepair
          ? 'The previous response was invalid NDJSON. Retry using exactly one compact JSON object per line, beginning with a complete answer_block and ending with turn_summary and final records. Do not use Markdown code fences or introductory prose.'
          : continuation.truncationRecovery
            ? 'The previous response was truncated before completing the answer. Continue from the next missing step. If no complete block was preserved, restart the answer. Emit one compact answer_block per numbered step so each step is saved before generating the next one. Do not repeat preserved block IDs.'
          : 'Continue with new block IDs. Do not repeat earlier blocks.'
      } : null
    };
    return {
      schemaName: 'article_chat_ndjson',
      stablePrefix,
      systemPrompt: [
        'You are a rigorous biomedical paper assistant. Answer in Chinese using only the supplied article context and conversation memory.',
        'Return newline-delimited JSON (NDJSON) only. Do not wrap lines in Markdown fences and do not emit a JSON array.',
        'Emit one complete answer_block line per complete Markdown paragraph, list, heading section, code block, or table.',
        'For a numbered or stepwise answer, emit one answer_block per numbered step. Never place the whole chain in one answer_block.',
        'Keep each answer_block compact: at most 600 Chinese characters or 900 Latin characters, including Markdown but excluding evidence metadata.',
        'answer_block schema: {"type":"answer_block","block_id":"block-1","markdown":"...","evidence":[{"marker":"1","paragraph_id":"...","source_key":"...","text_hash":"...","quote":"...","section_path":["..."]}]}',
        'Every evidence marker must refer to one supplied source paragraph. Copy IDs, hashes, quotes, and section paths exactly.',
        'In markdown, append [[marker]] immediately after the supported sentence or list item. Never collect markers in a references paragraph.',
        'Use readable Markdown. Put every bullet or numbered item on its own line, preserve blank lines, and close every code fence and table inside its block.',
        'After all answer blocks, emit one turn_summary line: {"type":"turn_summary","summary":"brief factual memory"}.',
        'End with exactly one final line: {"type":"final","status":"completed"}.',
        'Never invent evidence, study details, usage data, or hidden reasoning.'
      ].join('\n'),
      userPrompt: `${stablePrefix}CHAT_REQUEST\n${JSON.stringify(dynamicPayload)}`
    };
  }

  function operationCancelledError() {
    const error = new Error('Article chat was cancelled');
    error.name = 'AbortError';
    error.code = 'CANCELLED';
    error.retryable = false;
    return error;
  }

  function streamEventError(value = {}) {
    const error = new Error(String(value.message || 'Provider stream failed').slice(0, 240));
    error.code = String(value.code || 'NETWORK_ERROR');
    error.retryable = value.retryable === true;
    error.status = Math.max(0, Number(value.status) || 0);
    error.retryAfterMs = Math.max(0, Number(value.retryAfterMs) || 0);
    return error;
  }

  function publicPlan(plan) {
    return {
      mode: plan.mode,
      indexId: plan.indexId,
      contextWindowTokens: plan.contextWindowTokens,
      inputBudgetTokens: plan.inputBudgetTokens,
      outputBudgetTokens: plan.outputBudgetTokens,
      estimatedInputTokens: plan.estimatedInputTokens,
      chunkIds: plan.chunks.map(chunk => chunk.chunkId),
      completeHistoryIds: [...plan.completeHistoryIds],
      includedHistoryIds: [...plan.includedHistoryIds],
      retrievedOldTurnIds: [...plan.retrievedOldTurnIds],
      sectionCoverage: [...plan.sectionCoverage],
      cacheDecision: plan.cacheDecision,
      retrievalCoverage: plan.retrievalCoverage
    };
  }

  function coverageFromPlan(snapshot, plan) {
    const paragraphIds = new Set(plan.chunks.flatMap(chunk => chunk.paragraphIds || []));
    const sentCharacters = plan.chunks.reduce((sum, chunk) => sum + chunk.text.length, 0);
    const totalCharacters = snapshot.paragraphs.reduce((sum, item) => sum + item.text.length, 0);
    return {
      mode: plan.mode,
      totalParagraphs: snapshot.paragraphs.length,
      sentParagraphs: paragraphIds.size,
      totalCharacters,
      sentCharacters,
      truncated: plan.mode !== 'full',
      sectionCoverage: [...plan.sectionCoverage],
      cacheDecision: plan.cacheDecision
    };
  }

  function continuationOutputTokens(plan, currentOutputTokens) {
    const initial = Math.max(512, Number(plan?.outputBudgetTokens?.initial) || 4096);
    const ceiling = Math.max(initial, Number(plan?.outputBudgetTokens?.ceiling) || initial);
    const contextWindow = Math.max(
      0,
      Number(plan?.inputBudgetTokens?.usableContextWindowTokens) ||
        Number(plan?.contextWindowTokens) || 0
    );
    const estimatedInput = Math.max(0, Number(plan?.estimatedInputTokens) || 0);
    const reserved = Math.max(0, Number(plan?.inputBudgetTokens?.reservedTokens) || 0);
    const system = Math.max(0, Number(plan?.inputBudgetTokens?.systemTokens) || 0);
    const safeHeadroom = Math.floor(Math.max(
      0, contextWindow - estimatedInput - reserved - system - 512
    ) / 256) * 256;
    if (safeHeadroom <= initial) return initial;
    const current = Math.max(initial, Number(currentOutputTokens) || initial);
    const next = Math.ceil((current * 1.75) / 256) * 256;
    return Math.min(ceiling, safeHeadroom, next);
  }

  function compatibilityMessage(state, limited) {
    const evidence = [];
    const markdownBlocks = state.blocks.map(block => {
      const markerMap = new Map();
      block.evidence.forEach(item => {
        const globalMarker = String(evidence.length + 1);
        markerMap.set(item.marker, globalMarker);
        evidence.push({ ...item, marker: globalMarker });
      });
      return block.markdown.replace(/\[\[(\d{1,3})\]\]/g, (match, marker) =>
        markerMap.has(marker) ? `[[${markerMap.get(marker)}]]` : match
      );
    });
    return {
      answer: markdownBlocks.join('\n\n'),
      answerBlocks: state.blocks,
      evidence,
      summary: state.summary || normalizeText(markdownBlocks.join(' '), 1200),
      limitations: limited
        ? 'The provider reached its output limit twice. Complete answer blocks were preserved.' : '',
      status: limited ? 'truncated' : 'completed'
    };
  }

  async function runArticleChat(options = {}) {
    const input = options.input;
    const profile = options.profile || {};
    const adapter = options.adapter;
    const report = event => {
      try {
        options.onProgress?.({
          operationId: input.operationId || '',
          turnId: input.turnId || '',
          ...event
        });
      } catch {
        // Progress listeners must not affect chat generation.
      }
    };
    if (!input || !adapter || typeof adapter.generateTextStream !== 'function') {
      throw invalidSettings(['adapter']);
    }
    report({ phase: 'chat_started', turnId: input.turnId || '' });
    let prepared;
    try {
      prepared = await prepareArticleChatRequest(input, profile, options);
    } catch (error) {
      report({ phase: 'chat_error', errorCode: error?.code || 'INTERNAL_ERROR' });
      throw error;
    }
    const coverage = coverageFromPlan(prepared.snapshot, prepared.plan);
    report({
      phase: 'chat_context_ready',
      coverage,
      plan: publicPlan(prepared.plan)
    });
    const parser = shared.createArticleChatNdjsonParser({
      snapshot: prepared.snapshot,
      onBlock: block => report({ phase: 'chat_answer_block', block })
    });
    let usage = null;
    let limited = false;
    let continuationCount = 0;
    let repairFormat = false;
    let recoverTruncation = false;
    let currentOutputTokens = prepared.plan.outputBudgetTokens.initial;

    try {
      for (let attempt = 0; attempt < MAX_ARTICLE_CHAT_SEGMENTS; attempt += 1) {
        if (options.signal?.aborted) throw operationCancelledError();
        await options.waitIfPaused?.();
        const current = parser.snapshot();
        const prompt = compileArticleChatPrompt(input, prepared.plan, attempt ? {
          continuation: {
            blockIds: current.blocks.map(block => block.blockId),
            summary: current.summary,
            formatRepair: repairFormat,
            truncationRecovery: recoverTruncation
          }
        } : {});
        const request = {
          ...prompt,
          selectedProfileId: String(options.selectedProfileId || input.profileId || ''),
          maxOutputTokens: currentOutputTokens,
          timeoutMs: Number(options.timeoutMs) || 240000,
          signal: options.signal
        };
        let terminalError = null;
        let completed = false;
        let parserError = null;
        for await (const event of adapter.generateTextStream(request)) {
          if (options.signal?.aborted) throw operationCancelledError();
          await options.waitIfPaused?.();
          if (event?.type === 'text_delta') {
            try {
              parser.push(event.text);
            } catch (error) {
              if (error?.code !== 'INVALID_RESPONSE') throw error;
              parserError = error;
              parser.discardPending();
            }
          }
          else if (event?.type === 'usage') {
            usage = { ...(usage || {}), ...(event.usage || {}) };
            report({ phase: 'chat_usage', usage });
          } else if (event?.type === 'completed') {
            completed = true;
          } else if (event?.type === 'cancelled') {
            throw operationCancelledError();
          } else if (event?.type === 'error') {
            terminalError = streamEventError(event.error);
            break;
          }
        }

        let finalized = false;
        if (completed && !terminalError) {
          try {
            finalized = parser.finish();
          } catch (error) {
            if (error?.code !== 'INVALID_RESPONSE') throw error;
            parserError = error;
            parser.discardPending();
          }
        }
        const after = parser.snapshot();
        if (terminalError && terminalError.code !== 'OUTPUT_TRUNCATED') {
          if (terminalError.code === 'INVALID_RESPONSE' && attempt === 0) {
            repairFormat = true;
            recoverTruncation = false;
            parser.discardPending();
            report({ phase: 'chat_repairing_format', errorCode: terminalError.code });
            continue;
          }
          throw terminalError;
        }
        const validCompleteResponse = finalized && Boolean(after.final) && after.blocks.length > 0;
        const needsContinuation = terminalError?.code === 'OUTPUT_TRUNCATED' ||
          !validCompleteResponse || (parserError && !validCompleteResponse);
        if (!needsContinuation) break;
        parser.discardPending();
        if (attempt < MAX_ARTICLE_CHAT_SEGMENTS - 1) {
          continuationCount += 1;
          repairFormat = Boolean(parserError);
          recoverTruncation = terminalError?.code === 'OUTPUT_TRUNCATED';
          if (recoverTruncation) {
            currentOutputTokens = continuationOutputTokens(
              prepared.plan,
              currentOutputTokens
            );
          }
          report(repairFormat ? {
            phase: 'chat_repairing_format',
            errorCode: parserError?.code || 'INVALID_RESPONSE'
          } : {
            phase: 'chat_continuing',
            continuation: continuationCount,
            lastBlockId: after.blocks.at(-1)?.blockId || '',
            maxOutputTokens: currentOutputTokens
          });
          continue;
        }
        if (terminalError && terminalError.code !== 'OUTPUT_TRUNCATED') throw terminalError;
        limited = true;
      }
    } catch (error) {
      if (error?.code === 'CANCELLED' || error?.name === 'AbortError') {
        parser.discardPending();
        report({ phase: 'chat_cancelled', completedBlockCount: parser.snapshot().blocks.length });
        throw operationCancelledError();
      }
      parser.discardPending();
      report({ phase: 'chat_error', errorCode: error?.code || 'INTERNAL_ERROR' });
      throw error;
    }

    const state = parser.snapshot();
    if (!state.blocks.length) {
      const error = new Error('Article chat did not produce a complete answer block');
      error.code = limited ? 'OUTPUT_TRUNCATED' : 'INVALID_RESPONSE';
      report({ phase: 'chat_error', errorCode: error.code });
      throw error;
    }
    const message = compatibilityMessage(state, limited);
    report({
      phase: 'chat_completed',
      status: message.status,
      completedBlockCount: state.blocks.length,
      continuationCount
    });
    return {
      message,
      usage,
      coverage,
      plan: publicPlan(prepared.plan),
      cacheState: {
        indexId: prepared.index.indexId,
        stablePrefixChunkIds: prepared.plan.chunks.map(chunk => chunk.chunkId)
      }
    };
  }

  return {
    normalizeArticleChatHistory: normalizeArticleHistory,
    normalizeArticleChatInput,
    prepareArticleChatRequest,
    compileArticleChatPrompt,
    runArticleChat
  };
});
