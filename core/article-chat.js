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
    } else if (/(?:如何|为什么|为何|机制|原理|比较|区别|联系|how|why|mechanism|compare|difference|relationship)/iu.test(text)) {
      units = Math.max(units, 4);
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

  function completedContinuationBlocks(value) {
    const blocks = Array.isArray(value) ? value : [];
    const result = [];
    let remainingCharacters = 6000;
    for (const block of blocks) {
      if (remainingCharacters <= 0) break;
      const markdown = normalizeMarkdown(
        block?.markdown,
        Math.min(1200, remainingCharacters)
      );
      if (!markdown) continue;
      result.push({
        block_id: normalizeText(block?.blockId, 160),
        markdown
      });
      remainingCharacters -= markdown.length;
    }
    return result;
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
        completed_blocks: completedContinuationBlocks(continuation.blocks),
        turn_summary_so_far: continuation.summary || '',
        instruction: continuation.formatRepair
          ? 'One or more previous records failed format or citation validation. The completed_blocks are already visible and immutable. Continue only from the next missing point using new block IDs, with exactly one valid JSON object per line, then emit a fresh turn_summary and final record. Do not restart, restate an overview, or repeat completed content.'
          : continuation.truncationRecovery
            ? 'The previous response was truncated before completing the answer. Treat completed_blocks as already visible and immutable, and continue from the next missing step. If no complete block was preserved, restart the answer. Emit one complete answer_block per numbered step, then a fresh turn_summary and final record. Do not repeat preserved content.'
            : continuation.incompleteAnswer
              ? 'The previous response ended after promising details, steps, evidence, or a list that it did not provide. Treat completed_blocks as already visible and immutable. Continue immediately with every missing item using new answer_block IDs, then emit a fresh turn_summary and final record. Do not repeat the introduction, overview, recap, conclusion, or any preserved block.'
          : 'Treat completed_blocks as already visible and immutable. Continue at the next logical point with new block IDs, then emit a fresh turn_summary and final record. Do not repeat earlier content.'
      } : null
    };
    return {
      schemaName: 'article_chat_ndjson',
      stablePrefix,
      systemPrompt: [
        'You are a rigorous biomedical paper assistant. Answer in Chinese using only the supplied article context and conversation memory.',
        'Use your judgment to match the depth, structure, and length of the answer to the user\'s actual question. Unless the user explicitly asks for brevity, answer fully enough to explain the concrete evidence and distinctions needed to understand the result.',
        'For questions about how, why, definitions, criteria, comparisons, methods, or figures, naturally include the relevant conditions, steps, contrasts, measurements, and limitations that are present in the supplied context. Do not force a fixed template when it would not help.',
        'Return newline-delimited JSON (NDJSON) only. Do not wrap lines in Markdown fences and do not emit a JSON array.',
        'Emit one complete answer_block line per complete Markdown paragraph, list, heading section, code block, or table.',
        'For a numbered or stepwise answer, emit one answer_block per fully explained numbered step. Never place the whole chain in one answer_block.',
        'Every answer_block must be substantive and self-contained. Never emit a heading or numbered label as a block by itself; include that section\'s explanation and citations in the same block.',
        'Use at most one introductory overview and one concluding synthesis. Emit the conclusion only after every promised numbered step or section is complete.',
        'Use as many answer_block records as the question needs. Split a long answer at natural Markdown boundaries so completed portions can be shown progressively; do not shorten the substance merely to reduce the number of blocks.',
        'answer_block schema: {"type":"answer_block","block_id":"block-1","markdown":"...","evidence":[{"marker":"1","paragraph_id":"...","source_key":"...","text_hash":"...","quote":"...","section_path":["..."]}]}',
        'Every evidence marker must refer to one supplied source paragraph. Copy IDs, hashes, quotes, and section paths exactly. Use a different marker for every distinct source location inside one answer_block.',
        'Set quote to the shortest complete source sentence or clause that directly proves the cited claim, including the exact condition, parameter, group, time point, dose, sample size, or result when the user asks for it.',
        'Ground every paper-specific factual sentence or list item with an evidence marker. When one answer sentence synthesizes evidence from several source paragraphs, append every supporting marker to that sentence and include one evidence object per paragraph; never use one paragraph as a proxy for evidence distributed across the paper.',
        'If the supplied context does not contain a requested detail, say so explicitly instead of replacing it with a vague generalization.',
        'In markdown, append [[marker]] immediately after the supported sentence or list item. Never collect markers in a references paragraph.',
        'Use readable Markdown. Put every bullet or numbered item on its own line, preserve blank lines, and close every code fence and table inside its block.',
        'Before declaring completion, verify that every promised explanation, step, list, comparison, and line of evidence has actually been emitted. Never end on a lead-in such as "the following steps:" or its equivalent.',
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

  function compatibilityMessage(state, exhaustionReason = '') {
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
    const limitations = {
      output_truncated: '模型在多次自动续写后仍达到实际输出上限；已保留已完成的回答块。',
      invalid_response: '部分模型输出连续未通过格式或引用校验；已保留通过校验的回答块。',
      incomplete_answer: '模型多次续写后仍以未完成的引导句结束；已保留已经完成的回答块。',
      incomplete_response: '模型多次续写后仍未形成完整回答；已保留已经完成的回答块。'
    };
    return {
      answer: markdownBlocks.join('\n\n'),
      answerBlocks: state.blocks,
      evidence,
      summary: state.summary || normalizeText(markdownBlocks.join(' '), 1200),
      limitations: limitations[exhaustionReason] || '',
      status: exhaustionReason
        ? (exhaustionReason === 'output_truncated' ? 'truncated' : 'incomplete')
        : 'completed'
    };
  }

  function hasDanglingAnswerLeadIn(blocks) {
    const markdown = normalizeMarkdown(blocks?.at(-1)?.markdown, 64 * 1024)
      .replace(/\[\[\d{1,3}\]\]\s*$/u, '').trim();
    if (!markdown) return false;
    return /(?:如下|(?:主要)?(?:分为|包括)以下(?:几个|这些|各个|若干)?(?:步骤|阶段|方面|部分|要点)|以下(?:几个|这些|各个|若干)?(?:步骤|阶段|方面|要点|证据|结果|内容))\s*[：:]?\s*$/u.test(markdown) ||
      /\b(?:as follows|the following (?:steps|stages|points|items|lines of evidence|results))\s*[:：]?\s*$/iu.test(markdown);
  }

  function smallSequenceNumber(value) {
    const text = String(value || '').trim().toLowerCase();
    if (/^\d{1,2}$/.test(text)) return Number(text);
    const english = {
      one: 1, two: 2, three: 3, four: 4, five: 5,
      six: 6, seven: 7, eight: 8, nine: 9, ten: 10
    };
    if (english[text]) return english[text];
    const digits = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
    if (digits[text]) return digits[text];
    if (text === '十') return 10;
    const chinese = text.match(/^([一二两三四五六七八九])?十([一二三四五六七八九])?$/u);
    if (!chinese) return 0;
    return (chinese[1] ? digits[chinese[1]] : 1) * 10 +
      (chinese[2] ? digits[chinese[2]] : 0);
  }

  function hasIncompletePromisedSequence(blocks) {
    const markdown = (Array.isArray(blocks) ? blocks : [])
      .map(block => normalizeMarkdown(block?.markdown, 64 * 1024))
      .filter(Boolean).join('\n');
    if (!markdown) return false;
    const promise = markdown.match(
      /(?:分为|包括|可分成|可归纳为)[^。！？\n]{0,24}?([一二两三四五六七八九十\d]{1,3})\s*个?\s*(?:步骤|阶段|层次|环节)/u
    ) || markdown.match(
      /\b(?:divided into|includes?|consists? of|has)\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d{1,2})\s+(?:steps|stages|phases|parts)\b/iu
    );
    const expected = smallSequenceNumber(promise?.[1]);
    if (expected < 2 || expected > 20) return false;
    const observed = new Set();
    for (const match of markdown.matchAll(
      /(?:^|\n)\s*(?:#{1,6}\s*)?(?:\*{1,2})?(\d{1,2})\s*[.、．)]/gu
    )) {
      observed.add(Number(match[1]));
    }
    for (const match of markdown.matchAll(
      /第\s*([一二两三四五六七八九十\d]{1,3})\s*(?:步|阶段|层|环节)/gu
    )) {
      observed.add(smallSequenceNumber(match[1]));
    }
    return Array.from({ length: expected }, (_, index) => index + 1)
      .some(number => !observed.has(number));
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
    let exhaustionReason = '';
    let continuationCount = 0;
    let repairFormat = false;
    let recoverTruncation = false;
    let recoverIncomplete = false;
    let currentOutputTokens = prepared.plan.outputBudgetTokens.initial;

    try {
      for (let attempt = 0; attempt < MAX_ARTICLE_CHAT_SEGMENTS; attempt += 1) {
        if (options.signal?.aborted) throw operationCancelledError();
        await options.waitIfPaused?.();
        const current = parser.snapshot();
        const prompt = compileArticleChatPrompt(input, prepared.plan, attempt ? {
          continuation: {
            blockIds: current.blocks.map(block => block.blockId),
            blocks: current.blocks,
            summary: current.summary,
            formatRepair: repairFormat,
            truncationRecovery: recoverTruncation,
            incompleteAnswer: recoverIncomplete
          }
        } : {});
        const request = {
          ...prompt,
          selectedProfileId: String(options.selectedProfileId || input.profileId || ''),
          conversationKey: input.document.documentHash,
          conversationLabel: input.document.title,
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
        const danglingAnswerLeadIn = validCompleteResponse &&
          hasDanglingAnswerLeadIn(after.blocks);
        const incompletePromisedSequence = validCompleteResponse &&
          hasIncompletePromisedSequence(after.blocks);
        const semanticallyIncomplete = danglingAnswerLeadIn || incompletePromisedSequence;
        const needsContinuation = terminalError?.code === 'OUTPUT_TRUNCATED' ||
          !validCompleteResponse || Boolean(parserError) || semanticallyIncomplete;
        if (!needsContinuation) break;
        parser.discardPending();
        parser.clearFinalRecord?.();
        if (attempt < MAX_ARTICLE_CHAT_SEGMENTS - 1) {
          continuationCount += 1;
          repairFormat = Boolean(parserError);
          recoverTruncation = terminalError?.code === 'OUTPUT_TRUNCATED';
          recoverIncomplete = semanticallyIncomplete;
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
        exhaustionReason = terminalError?.code === 'OUTPUT_TRUNCATED'
          ? 'output_truncated'
          : parserError
            ? 'invalid_response'
            : semanticallyIncomplete
              ? 'incomplete_answer'
              : 'incomplete_response';
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
      error.code = exhaustionReason === 'output_truncated'
        ? 'OUTPUT_TRUNCATED' : 'INVALID_RESPONSE';
      report({ phase: 'chat_error', errorCode: error.code });
      throw error;
    }
    const message = compatibilityMessage(state, exhaustionReason);
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
    articleChatOutputUnits,
    normalizeArticleChatInput,
    prepareArticleChatRequest,
    compileArticleChatPrompt,
    runArticleChat
  };
});
