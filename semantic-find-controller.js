(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  const t = value => globalThis.SciLLM?.translateInterfaceText?.(value) || value;
  const DEFAULT_THRESHOLD = 0.7;
  const MAX_SESSION_SENTENCES = 10000;
  const ADDITIONAL_DEBOUNCE_MS = 400;
  const ROLES = Object.freeze([
    'query', 'submit', 'previous', 'next', 'close', 'settings',
    'threshold-range', 'threshold-number', 'status', 'position',
    'progress', 'score', 'legend', 'scope'
  ]);

  function strictScore(value) {
    return typeof value === 'number' && Number.isFinite(value) &&
      value >= 0 && value <= 1 ? value : null;
  }

  function thresholdValue(value) {
    const score = Number(value);
    return Number.isFinite(score) && score >= 0 && score <= 1 ? score : null;
  }

  function normalizedQuery(value) {
    return String(value || '').normalize('NFKC').replace(/\s+/gu, ' ').trim();
  }

  function integerOr(value, fallback = 0) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number >= 0 ? number : fallback;
  }

  function messageError(response) {
    if (!response || response.success !== false) return null;
    const detail = response.error;
    const code = String(response.code || detail?.code || detail || 'SEMANTIC_FIND_FAILED');
    const message = String(detail?.message || response.message || detail || code);
    const error = new Error(message);
    error.code = code;
    return error;
  }

  function friendlyError(error) {
    if (error?.code === 'NO_USABLE_PROFILE') {
      return '未配置可用的 TypeSafe Jev。请打开模型设置并为语义查找指定 Profile。';
    }
    if (error?.code === 'CAPABILITY_MISMATCH') {
      return '当前模型不能返回语义查找所需的概率，请改用 TypeSafe Jev。';
    }
    if (error?.code === 'CANCELLED') return '';
    return `语义查找失败：${String(error?.message || '请稍后重试').slice(0, 240)}`;
  }

  function createSemanticFindController(options = {}) {
    const adapter = options.adapter;
    const sendMessage = options.sendMessage;
    const openSettings = options.openSettings;
    const documentRef = options.document;
    const windowRef = options.window || globalThis;
    if (!adapter || typeof adapter.buildCorpus !== 'function' ||
        typeof adapter.isCurrent !== 'function' || typeof adapter.paint !== 'function' ||
        typeof adapter.focus !== 'function' || typeof adapter.clear !== 'function' ||
        typeof adapter.confirm !== 'function' || typeof sendMessage !== 'function' ||
        !documentRef?.createElement) {
      throw new TypeError('Semantic find controller dependencies are incomplete');
    }

    let rootNode = null;
    let refs = {};
    let openState = false;
    let destroyed = false;
    let revision = 0;
    let operationSequence = 0;
    let activeOperation = null;
    let corpus = null;
    let knownSentences = new Map();
    let sentenceOrder = new Map();
    let scores = new Map();
    let submittedQuery = '';
    let currentId = null;
    let processed = 0;
    let total = 0;
    let skipped = 0;
    let partial = false;
    let coverageMessage = '';
    let sourceNotice = '';
    let autoFocused = false;
    let focusSequence = 0;
    let transportOperation = null;
    let additionalTimer = null;
    let pendingAdditional = false;
    let collectingAdditional = null;
    let additionalStopped = false;
    let additionalFailure = '';
    let seenParagraphs = new Map();
    const timerHost = typeof windowRef.setTimeout === 'function' ? windowRef : globalThis;

    function make(tag, role, text) {
      const node = documentRef.createElement(tag);
      if (role) node.setAttribute('data-semantic-find-role', role);
      if (text !== undefined) node.textContent = text;
      return node;
    }

    function setStatus(message, state = 'info') {
      if (!refs.status) return;
      refs.status.textContent = String(message || '');
      refs.status.setAttribute('data-state', state);
    }

    function threshold() {
      return thresholdValue(refs.thresholdNumber?.value) ?? DEFAULT_THRESHOLD;
    }

    function updateScope() {
      if (!refs.scope) return;
      const kind = corpus?.identity?.kind;
      if (kind === 'html') {
        const message = String(corpus.coverageMessage || '当前网页可搜索文本；具体范围以本次索引为准。');
        refs.scope.textContent = t(`无需打开侧栏 · ${message}`);
      } else if (kind === 'pdf') {
        refs.scope.textContent = t('范围：当前 PDF 已索引文本（含未显示页）。');
      } else {
        refs.scope.textContent = t('无需打开侧栏；搜索范围将在读取当前页面后显示。');
      }
      if (corpus && sourceNotice) refs.scope.textContent += ` ${t(sourceNotice)}`;
    }

    function updateSourceNotice(message) {
      // The adapter guards its source lease; idle/cleared sessions admit no notice.
      if (!openState || destroyed || !corpus || (!submittedQuery && !activeOperation)) return false;
      sourceNotice = String(message || '').trim();
      updateScope();
      return true;
    }

    function stopAdditionalQueue() {
      if (additionalTimer !== null) timerHost.clearTimeout(additionalTimer);
      additionalTimer = null;
      pendingAdditional = false;
      collectingAdditional = null;
    }

    function scheduleAdditional() {
      if (!pendingAdditional || additionalStopped || !openState || destroyed || !submittedQuery ||
          activeOperation || transportOperation || collectingAdditional ||
          typeof adapter.collectAdditionalCorpus !== 'function') return;
      if (additionalTimer !== null) timerHost.clearTimeout(additionalTimer);
      additionalTimer = timerHost.setTimeout(() => {
        additionalTimer = null;
        void collectAdditional();
      }, ADDITIONAL_DEBOUNCE_MS);
    }

    function queueAdditionalSearch() {
      if (!openState || destroyed || !submittedQuery || additionalStopped ||
          typeof adapter.collectAdditionalCorpus !== 'function') return false;
      pendingAdditional = true;
      updateSourceNotice('检测到新增内容，已排队补充检索。');
      scheduleAdditional();
      return true;
    }

    function releaseTransport(operation) {
      if (transportOperation !== operation) return;
      transportOperation = null;
      if (operation.revision !== revision || !openState || destroyed || !submittedQuery) return;
      // The final progress callback can precede the service's response. Never
      // start another request until that response has settled (one owner/flight).
      if (!operation.additional && operation.completed && typeof adapter.collectAdditionalCorpus === 'function') {
        pendingAdditional = true;
      }
      scheduleAdditional();
    }

    function resultStatus(hits) {
      if (additionalFailure) { setStatus(additionalFailure, 'error'); return; }
      setStatus(hits.length
        ? `找到 ${hits.length} 条当前阈值以上结果。` : '当前阈值下没有匹配结果。',
      partial ? 'info' : 'success');
    }

    function failAdditional(operation, error) {
      if (operation) {
        operation.failed = true;
        for (const id of operation.localToGlobal.values()) scores.delete(id);
        processed = operation.baseProcessed;
        skipped = operation.baseSkipped;
        if (activeOperation === operation) activeOperation = null;
      }
      partial = true;
      if (error?.code === 'SEMANTIC_FIND_LIMIT_EXCEEDED') {
        additionalStopped = true;
        stopAdditionalQueue();
        additionalFailure = '自动补充检索已达到本轮文本容量上限；已有结果保留。';
      } else {
        additionalFailure = `新增内容补充检索失败；已有结果保留，可点击“搜索”重试。${friendlyError(error)}`;
      }
      updateSourceNotice('');
      const hits = paint();
      resultStatus(hits);
    }

    function admitAdditional(delta) {
      if (!delta) return null;
      if (!Array.isArray(delta.paragraphs) || !Array.isArray(delta.sentences)) {
        throw invalidCorpusError('新增文本索引格式无效。');
      }
      if (!delta.paragraphs.length && !delta.sentences.length) return null;
      if (typeof delta.sourceKey !== 'string' || !delta.sourceKey || delta.sourceKey.length > 512 ||
          !delta.paragraphs.length || !delta.sentences.length) {
        throw invalidCorpusError('新增文本缺少有效批次身份或句子。');
      }
      const paragraphs = new Map();
      for (const paragraph of delta.paragraphs) {
        if (typeof paragraph?.paragraphId !== 'string' || !paragraph.paragraphId ||
            typeof paragraph.text !== 'string' || paragraphs.has(paragraph.paragraphId)) {
          throw invalidCorpusError('新增文本段落身份无效。');
        }
        paragraphs.set(paragraph.paragraphId, paragraph.text);
      }
      // Atomic-drain adapters normally never return duplicates. Keep consumed
      // failed batches in this set too, so a new DOM event cannot retry them.
      if ([...paragraphs].every(([id, text]) => seenParagraphs.get(id) === text)) return null;
      if ([...paragraphs.keys()].some(id => seenParagraphs.has(id))) {
        throw invalidCorpusError('新增文本与已处理段落身份冲突。');
      }
      if (knownSentences.size + delta.sentences.length > MAX_SESSION_SENTENCES) {
        const error = invalidCorpusError('累计句子数量达到上限。');
        error.code = 'SEMANTIC_FIND_LIMIT_EXCEEDED';
        throw error;
      }
      const operationId = `semantic_find_${Date.now().toString(36)}_${++operationSequence}`;
      const localToGlobal = new Map(), globalSentences = [];
      delta.sentences.forEach((sentence, index) => {
        const text = paragraphs.get(sentence?.paragraphId);
        if (sentence?.id !== `semantic_sentence_${index}` || typeof text !== 'string' ||
            !Number.isSafeInteger(sentence.start) || !Number.isSafeInteger(sentence.end) ||
            sentence.start < 0 || sentence.end <= sentence.start || sentence.end > text.length ||
            text.slice(sentence.start, sentence.end) !== sentence.text) {
          throw invalidCorpusError('新增句子的局部身份或原文坐标无效。');
        }
        const globalId = `${operationId}:${sentence.id}`;
        localToGlobal.set(sentence.id, globalId);
        globalSentences.push({ ...sentence, id: globalId });
      });
      paragraphs.forEach((text, id) => seenParagraphs.set(id, text));
      globalSentences.forEach(sentence => {
        sentenceOrder.set(sentence.id, knownSentences.size);
        knownSentences.set(sentence.id, sentence);
      });
      corpus.sentences = [...corpus.sentences, ...globalSentences];
      total += globalSentences.length;
      return { additional: true, operationId, sourceKey: delta.sourceKey, query: submittedQuery,
        revision, paragraphs: delta.paragraphs, localToGlobal, received: new Map(),
        size: globalSentences.length, processed: 0, skipped: null,
        baseProcessed: processed, baseSkipped: skipped };
    }

    async function collectAdditional() {
      if (!pendingAdditional || activeOperation || transportOperation || collectingAdditional ||
          additionalStopped || !openState || destroyed || !submittedQuery || !currentCorpusIsValid()) return;
      const token = { revision, corpus, query: submittedQuery };
      collectingAdditional = token;
      pendingAdditional = false;
      let operation = null;
      const current = () => collectingAdditional === token && token.revision === revision &&
        token.corpus === corpus && token.query === submittedQuery && openState && !destroyed;
      try {
        const delta = await adapter.collectAdditionalCorpus(token.corpus);
        if (!current() || !currentCorpusIsValid()) return;
        operation = admitAdditional(delta);
        if (!operation) {
          if (!pendingAdditional) updateSourceNotice('');
          return;
        }
        activeOperation = transportOperation = operation;
        updateSourceNotice('正在补充检索新加载内容；已有结果保留。');
        updateReadout();
        setStatus('正在补充检索新增文本…', 'working');
        const response = await sendMessage({ type: 'LLM_SEMANTIC_FIND', operationId: operation.operationId,
          sourceKey: operation.sourceKey, query: operation.query, paragraphs: operation.paragraphs });
        if (!current() || activeOperation !== operation) return;
        const failure = messageError(response);
        if (failure) throw failure;
        const payload = response?.data && typeof response.data === 'object' ? response.data
          : response?.result && typeof response.result === 'object' ? response.result : response;
        if (!ingestResult(payload || {}, operation, true) && activeOperation === operation) {
          throw invalidCorpusError('补充检索返回了错误的批次身份。');
        }
      } catch (error) {
        if (current() && currentCorpusIsValid()) failAdditional(operation, error);
      } finally {
        if (operation) releaseTransport(operation);
        if (collectingAdditional === token) {
          collectingAdditional = null;
          scheduleAdditional();
        }
      }
    }

    function ingestAdditional(payload, operation, terminal) {
      if (operation.failed || (operation.progressComplete && !terminal)) return false;
      const next = new Map(operation.received);
      const incoming = Array.isArray(payload.scores) ? payload.scores : Array.isArray(payload.hits) ? payload.hits : [];
      let error = '';
      for (const item of incoming) {
        const id = String(item?.id || item?.sentenceId || '');
        const score = strictScore(item?.score);
        if (!operation.localToGlobal.has(id) || score === null || (next.has(id) && next.get(id) !== score)) {
          error = '模型返回了无效、冲突或不属于本批的分值。'; break;
        }
        next.set(id, score);
      }
      const count = payload.processed, omitted = payload.skipped, batchTotal = payload.total;
      const done = terminal || payload.done === true || payload.complete === true;
      if (!Number.isSafeInteger(count) || !Number.isSafeInteger(omitted) || omitted < 0 ||
          batchTotal !== operation.size || count !== next.size || count < operation.processed ||
          count + omitted > operation.size || (done && count + omitted !== operation.size) ||
          (operation.skipped !== null && omitted !== operation.skipped)) error ||= '补充检索的批次覆盖计数不一致。';
      if (error) {
        failAdditional(operation, invalidCorpusError(error));
        if (!terminal) Promise.resolve(sendMessage({ type: 'LLM_SEMANTIC_FIND_CANCEL',
          operationId: operation.operationId, sourceKey: operation.sourceKey })).catch(() => undefined);
        return false;
      }
      operation.received = next;
      operation.processed = count;
      operation.skipped = omitted;
      next.forEach((score, id) => scores.set(operation.localToGlobal.get(id), score));
      processed = operation.baseProcessed + count;
      skipped = operation.baseSkipped + omitted;
      if (omitted || payload.coverage === 'partial') partial = true;
      const hits = paint();
      // Appended high scores must not steal the current result or scroll focus.
      if (done) {
        operation.progressComplete = true;
        if (terminal) {
          operation.completed = true;
          activeOperation = null;
          updateSourceNotice(pendingAdditional ? '检测到新增内容，已排队补充检索。' : '');
        }
        resultStatus(hits);
      } else setStatus('正在补充检索新增文本…', 'working');
      return true;
    }

    function currentHitIsValid(hit) {
      if (!corpus || !hit) return false;
      if (typeof adapter.isHitCurrent !== 'function') return true;
      try { return adapter.isHitCurrent(corpus, hit) === true; } catch (_) { return false; }
    }

    function visibleHits() {
      const minimum = threshold();
      return [...scores.entries()]
        .map(([id, score]) => ({ ...knownSentences.get(id), score }))
        .filter(hit => hit.id && hit.score >= minimum && currentHitIsValid(hit))
        .sort((left, right) =>
          right.score - left.score ||
          (sentenceOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
          (sentenceOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER)
        );
    }

    function currentCorpusIsValid() {
      if (!corpus) return false;
      let current = false;
      try { current = adapter.isCurrent(corpus) === true; } catch (_) { current = false; }
      if (!current) invalidate('当前文档已变化，请重新打开语义查找。');
      return current;
    }

    function updateReadout(hits = visibleHits()) {
      const index = hits.findIndex(hit => hit.id === currentId);
      if (refs.position) {
        refs.position.textContent = hits.length
          ? `${Math.max(1, index + 1)} / ${hits.length}` : `0 / ${hits.length}`;
      }
      const current = index >= 0 ? hits[index] : null;
      if (refs.score) {
        refs.score.textContent = current
          ? `当前分值 ${current.score.toFixed(2)}` : '当前分值 —';
      }
      if (refs.progress) {
        const coverage = partial
          ? ` · 部分覆盖${coverageMessage ? `：${coverageMessage}` : ''}` : '';
        refs.progress.textContent = `累计已处理 ${processed} / ${total}${coverage}`;
      }
      if (refs.previous) refs.previous.disabled = hits.length === 0;
      if (refs.next) refs.next.disabled = hits.length === 0;
    }

    function paint() {
      if (!corpus || !currentCorpusIsValid()) return [];
      const hits = visibleHits();
      if (currentId && !hits.some(hit => hit.id === currentId)) currentId = null;
      if (!currentId && hits.length) currentId = hits[0].id;
      adapter.paint(corpus, hits, currentId);
      updateReadout(hits);
      return hits;
    }

    function refreshSourceHits() {
      if (!openState || destroyed || !corpus || !currentCorpusIsValid()) return false;
      const hits = paint();
      if (!corpus) return false;
      if (!activeOperation) resultStatus(hits);
      return true;
    }

    function cancelActive() {
      const operation = activeOperation || transportOperation;
      activeOperation = null;
      transportOperation = null;
      stopAdditionalQueue();
      revision += 1;
      if (operation) {
        Promise.resolve(sendMessage({
          type: 'LLM_SEMANTIC_FIND_CANCEL',
          operationId: operation.operationId,
          sourceKey: operation.sourceKey || ''
        })).catch(() => undefined);
      }
    }

    function clearResults({ cancel = true } = {}) {
      if (cancel) cancelActive();
      focusSequence += 1;
      scores = new Map();
      currentId = null;
      processed = 0;
      skipped = 0;
      total = corpus?.sentences?.length || 0;
      partial = corpus?.coverage === 'partial';
      coverageMessage = partial ? String(corpus?.coverageMessage || '') : '';
      sourceNotice = '';
      additionalStopped = false;
      additionalFailure = '';
      autoFocused = false;
      try { adapter.clear(); } catch (_) {}
      updateScope();
      updateReadout([]);
    }

    function resetCorpus() {
      corpus = null;
      knownSentences = new Map();
      sentenceOrder = new Map();
      total = 0;
      skipped = 0;
      partial = false;
      coverageMessage = '';
      sourceNotice = '';
      seenParagraphs = new Map();
      updateScope();
      updateReadout([]);
    }

    function invalidCorpusError(message) {
      const error = new Error(message);
      error.code = 'SEMANTIC_FIND_INVALID_CORPUS';
      return error;
    }

    function admitCorpus(value) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw invalidCorpusError('当前文档没有可搜索的语义索引');
      }
      const sourceKey = String(value.sourceKey || '');
      if (!sourceKey || !Array.isArray(value.paragraphs) ||
          !Array.isArray(value.sentences) || !value.sentences.length) {
        throw invalidCorpusError('当前文档没有可搜索的句子');
      }
      const byId = new Map();
      const order = new Map();
      value.sentences.forEach((sentence, index) => {
        const id = String(sentence?.id || '');
        if (!id || byId.has(id)) throw invalidCorpusError('语义索引中的句子身份无效');
        byId.set(id, sentence);
        order.set(id, index);
      });
      corpus = value;
      knownSentences = byId;
      sentenceOrder = order;
      seenParagraphs = new Map(value.paragraphs.map(paragraph => [paragraph.paragraphId, paragraph.text]));
      total = value.sentences.length;
      partial = value.coverage === 'partial';
      coverageMessage = partial ? String(value.coverageMessage || '') : '';
      sourceNotice = String(value.sourceNotice || '').trim();
      updateScope();
      return value;
    }

    async function focusHit(hit) {
      if (!hit || !currentCorpusIsValid() || !currentHitIsValid(hit)) return false;
      const focusRevision = revision;
      const focusToken = ++focusSequence;
      try {
        await adapter.focus(corpus, hit);
      } catch (error) {
        if (focusRevision === revision && focusToken === focusSequence && currentHitIsValid(hit)) {
          setStatus(friendlyError(error), 'error');
        }
        return false;
      }
      if (focusRevision !== revision || focusToken !== focusSequence ||
          !currentCorpusIsValid() || !currentHitIsValid(hit)) return false;
      return true;
    }

    function maybeAutoFocus(hits) {
      if (autoFocused || !hits.length) return;
      autoFocused = true;
      void focusHit(hits.find(hit => hit.id === currentId) || hits[0]);
    }

    function ingestResult(payload, operation, terminal = false) {
      if (!payload || typeof payload !== 'object' || !activeOperation ||
          activeOperation.operationId !== operation.operationId ||
          activeOperation.sourceKey !== operation.sourceKey ||
          String(payload.operationId || operation.operationId) !== operation.operationId ||
          String(payload.sourceKey || operation.sourceKey) !== operation.sourceKey ||
          !currentCorpusIsValid()) return false;
      if (operation.additional) return ingestAdditional(payload, operation, terminal);
      const incoming = Array.isArray(payload.scores)
        ? payload.scores : Array.isArray(payload.hits) ? payload.hits : [];
      const admitted = new Map();
      let invalidReason = '';
      for (const item of incoming) {
        const id = String(item?.id || item?.sentenceId || '');
        const score = strictScore(item?.score);
        if (!id || score === null || !knownSentences.has(id)) {
          invalidReason = '模型返回了无效或不属于当前文档的匹配分值。';
          break;
        }
        const previous = admitted.has(id) ? admitted.get(id) : scores.get(id);
        if (previous !== undefined && previous !== score) {
          invalidReason = '模型对同一句子返回了冲突分值。';
          break;
        }
        admitted.set(id, score);
      }
      if (invalidReason) {
        cancelActive();
        clearResults({ cancel: false });
        submittedQuery = '';
        setStatus(invalidReason, 'error');
        return false;
      }
      admitted.forEach((score, id) => scores.set(id, score));
      const reportedProcessed = integerOr(payload.processed, processed);
      processed = Math.min(total, Math.max(processed, reportedProcessed));
      skipped = Math.max(skipped, integerOr(payload.skipped, skipped));
      if (payload.coverage === 'partial' || skipped > 0) partial = true;
      const hits = paint();
      maybeAutoFocus(hits);
      const done = terminal || payload.done === true || payload.complete === true;
      if (done) {
        activeOperation = null;
        const reportedTotal = integerOr(payload.total, total);
        const consistent = reportedTotal === total &&
          reportedProcessed === scores.size &&
          reportedProcessed + skipped === total;
        if (!consistent) {
          partial = true;
          submittedQuery = '';
          updateReadout(hits);
          setStatus('结果覆盖计数不一致，未标记全文完成。', 'error');
          return false;
        }
        operation.completed = true;
        setStatus(hits.length
          ? `找到 ${hits.length} 条当前阈值以上结果。` : '当前阈值下没有匹配结果。',
        partial ? 'info' : 'success');
      } else {
        setStatus('正在检查当前索引中的文本…', 'working');
      }
      return true;
    }

    async function startSearch(force = false) {
      if (!openState || destroyed) return false;
      const query = normalizedQuery(refs.query?.value);
      if (!query) {
        setStatus('请输入要查找的语义描述。', 'error');
        refs.query?.focus?.();
        return false;
      }
      if (!force && query === submittedQuery) return navigate(1);
      cancelActive();
      clearResults({ cancel: false });
      resetCorpus();
      submittedQuery = query;
      const operationId = `semantic_find_${Date.now().toString(36)}_${++operationSequence}`;
      const operation = { operationId, sourceKey: '', query, revision };
      activeOperation = operation;
      setStatus('正在准备当前文档…', 'working');
      try {
        const built = await adapter.buildCorpus();
        if (!openState || activeOperation !== operation || operation.revision !== revision) return false;
        admitCorpus(built);
        if (!currentCorpusIsValid()) return false;
        operation.sourceKey = corpus.sourceKey;
        total = corpus.sentences.length;
        updateReadout([]);
        setStatus('正在检查当前索引中的文本…', 'working');
        transportOperation = operation;
        const response = await sendMessage({
          type: 'LLM_SEMANTIC_FIND',
          operationId,
          sourceKey: corpus.sourceKey,
          query,
          paragraphs: corpus.paragraphs
        });
        if (!openState || activeOperation !== operation || operation.revision !== revision) return false;
        const failure = messageError(response);
        if (failure) throw failure;
        const payload = response?.data && typeof response.data === 'object'
          ? response.data
          : response?.result && typeof response.result === 'object'
            ? response.result : response;
        return ingestResult(payload || {}, operation, true);
      } catch (error) {
        if (!openState || activeOperation !== operation || operation.revision !== revision) return false;
        activeOperation = null;
        stopAdditionalQueue();
        submittedQuery = '';
        const message = friendlyError(error);
        if (message) setStatus(message, 'error');
        return false;
      } finally {
        releaseTransport(operation);
      }
    }

    function navigate(direction) {
      if (!corpus || !currentCorpusIsValid()) {
        updateReadout([]);
        return false;
      }
      const hits = visibleHits();
      if (!hits.length) {
        updateReadout(hits);
        return false;
      }
      let index = hits.findIndex(hit => hit.id === currentId);
      if (index < 0) index = direction < 0 ? 0 : -1;
      index = (index + (direction < 0 ? -1 : 1) + hits.length) % hits.length;
      currentId = hits[index].id;
      adapter.paint(corpus, hits, currentId);
      updateReadout(hits);
      void focusHit(hits[index]);
      return true;
    }

    function syncThreshold(value) {
      const score = thresholdValue(value);
      if (score === null) return false;
      const normalized = score.toFixed(2);
      refs.thresholdRange.value = normalized;
      refs.thresholdNumber.value = normalized;
      const hits = paint();
      if (corpus && submittedQuery && !activeOperation) {
        resultStatus(hits);
      }
      return true;
    }

    function handleQueryInput() {
      if (normalizedQuery(refs.query.value) === submittedQuery) return;
      cancelActive();
      clearResults({ cancel: false });
      submittedQuery = '';
      setStatus('按 Enter 开始语义查找。');
    }

    function buildUi() {
      const panel = make('section');
      panel.className = 'sci-semantic-find';
      panel.setAttribute('data-brevess-interface', '');
      panel.setAttribute('data-sci-plugin-ui', 'true');
      panel.setAttribute('role', 'search');
      panel.setAttribute('aria-label', '语义查找');

      const header = make('header');
      header.className = 'sci-semantic-find__header';
      const title = make('strong', null, '语义查找');
      const headerActions = make('div');
      const settings = make('button', 'settings', '模型设置');
      const close = make('button', 'close', '关闭');
      settings.type = close.type = 'button';
      headerActions.append(settings, close);
      header.append(title, headerActions);

      const searchRow = make('div');
      searchRow.className = 'sci-semantic-find__search';
      const query = make('input', 'query');
      query.type = 'search';
      query.autocomplete = 'off';
      query.maxLength = 1000;
      query.placeholder = '描述要查找的语义';
      query.setAttribute('aria-label', '语义查找内容');
      const submit = make('button', 'submit', '搜索');
      submit.type = 'button';
      searchRow.append(query, submit);

      const navigation = make('div');
      navigation.className = 'sci-semantic-find__navigation';
      navigation.setAttribute('aria-label', '按匹配分值从高到低浏览结果');
      const previous = make('button', 'previous', '上一条');
      const next = make('button', 'next', '下一条');
      previous.type = next.type = 'button';
      const position = make('span', 'position', '0 / 0');
      const score = make('span', 'score', '当前分值 —');
      navigation.append(previous, next, position, score);

      const thresholdRow = make('label');
      thresholdRow.className = 'sci-semantic-find__threshold';
      thresholdRow.append(make('span', null, '最低显示分值'));
      const thresholdRange = make('input', 'threshold-range');
      thresholdRange.type = 'range';
      thresholdRange.min = '0';
      thresholdRange.max = '1';
      thresholdRange.step = '0.01';
      thresholdRange.value = DEFAULT_THRESHOLD.toFixed(2);
      const thresholdNumber = make('input', 'threshold-number');
      thresholdNumber.type = 'number';
      thresholdNumber.min = '0';
      thresholdNumber.max = '1';
      thresholdNumber.step = '0.01';
      thresholdNumber.value = DEFAULT_THRESHOLD.toFixed(2);
      thresholdRow.append(thresholdRange, thresholdNumber);

      const legend = make('div', 'legend');
      legend.className = 'sci-semantic-find__legend';
      const legendBar = make('span');
      legendBar.className = 'sci-semantic-find__legend-bar';
      legend.append(legendBar, make('span', null, '模型匹配分值：从高到低 · 深色表示分值更高'));
      const scope = make('div', 'scope');
      const progress = make('div', 'progress', '累计已处理 0 / 0');
      const status = make('div', 'status', '输入描述后按 Enter 搜索。');
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');

      panel.append(header, searchRow, navigation, thresholdRow, legend, scope, progress, status);
      refs = {
        query, submit, previous, next, close, settings, thresholdRange,
        thresholdNumber, status, position, progress, score, legend, scope
      };
      updateScope();
      query.addEventListener('input', handleQueryInput);
      submit.addEventListener('click', () => { void startSearch(true); });
      previous.addEventListener('click', () => navigate(-1));
      next.addEventListener('click', () => navigate(1));
      close.addEventListener('click', closeController);
      settings.addEventListener('click', () => {
        if (typeof openSettings !== 'function') return;
        Promise.resolve().then(() => openSettings('semantic_find')).catch(error => {
          if (openState) setStatus(friendlyError(error), 'error');
        });
      });
      thresholdRange.addEventListener('input', event => syncThreshold(event.target.value));
      thresholdNumber.addEventListener('change', event => syncThreshold(event.target.value));
      rootNode = panel;
      return panel;
    }

    function open() {
      if (destroyed) return false;
      if (!rootNode) {
        const panel = buildUi();
        (documentRef.body || documentRef.documentElement).appendChild(panel);
      }
      openState = true;
      rootNode.hidden = false;
      refs.query.focus?.();
      return true;
    }

    function closeController() {
      if (!openState && !rootNode) return false;
      openState = false;
      cancelActive();
      clearResults({ cancel: false });
      resetCorpus();
      submittedQuery = '';
      if (rootNode) rootNode.hidden = true;
      return true;
    }

    function invalidate(reason = '当前文档已变化，请重新搜索。') {
      cancelActive();
      clearResults({ cancel: false });
      resetCorpus();
      submittedQuery = '';
      if (openState) setStatus(reason, 'error');
      return true;
    }

    function handleProgress(message) {
      const action = String(message?.action || message?.type || '');
      if (action !== 'semanticFindProgress' || !message?.progress ||
          typeof message.progress !== 'object' || Array.isArray(message.progress)) return false;
      if (!activeOperation || String(message?.operationId || '') !== activeOperation.operationId ||
          String(message?.sourceKey || '') !== activeOperation.sourceKey) return false;
      return ingestResult({
        ...message.progress,
        operationId: message.operationId,
        sourceKey: message.sourceKey
      }, activeOperation, false);
    }

    function editableTarget(target) {
      if (!target || target === refs.query) return false;
      if (typeof target.closest !== 'function') return false;
      return Boolean(target.closest(
        'input, textarea, select, option, [contenteditable]:not([contenteditable="false"]), ' +
        '[role="textbox"], dialog, a[href], button, [role="button"], [role="link"]'
      ));
    }

    function handleKeydown(event) {
      if (!openState || destroyed || event?.defaultPrevented || event?.isComposing ||
          event?.repeat ||
          event?.key === 'Process') return false;
      if (event.key === 'Escape') {
        event.preventDefault?.();
        event.stopPropagation?.();
        closeController();
        return true;
      }
      const target = event.composedPath?.()[0] || event.target;
      if (event.key !== 'Enter' || event.ctrlKey || event.metaKey || event.altKey ||
          editableTarget(target)) return false;
      event.preventDefault?.();
      event.stopPropagation?.();
      const query = normalizedQuery(refs.query?.value);
      if (query && query === submittedQuery) navigate(event.shiftKey ? -1 : 1);
      else void startSearch(false);
      return true;
    }

    async function confirm(hitId, rect) {
      const id = String(hitId || '');
      const score = scores.get(id);
      const sentence = knownSentences.get(id);
      if (!sentence || strictScore(score) === null || !currentCorpusIsValid() || !currentHitIsValid(sentence)) return false;
      const confirmRevision = revision;
      try {
        const result = await adapter.confirm(corpus, { ...sentence, score }, rect);
        if (confirmRevision !== revision || !currentCorpusIsValid() || !currentHitIsValid(sentence)) return false;
        return result;
      } catch (error) {
        if (confirmRevision === revision && openState && currentHitIsValid(sentence)) {
          setStatus(friendlyError(error), 'error');
        }
        return false;
      }
    }

    function destroy() {
      if (destroyed) return;
      closeController();
      destroyed = true;
      unsubscribeLanguage?.();
      rootNode?.remove?.();
      rootNode = null;
      refs = {};
    }

    const unsubscribeLanguage = globalThis.SciLLM?.onInterfaceLanguageChange?.(() => {
      if (openState && !destroyed) { updateScope(); updateReadout(); }
    });
    return Object.freeze({
      open,
      close: closeController,
      invalidate,
      updateSourceNotice,
      queueAdditionalSearch,
      refreshSourceHits,
      handleProgress,
      handleKeydown,
      confirm,
      isOpen: () => openState,
      destroy,
      roles: ROLES
    });
  }

  return { createSemanticFindController, DEFAULT_SEMANTIC_FIND_THRESHOLD: DEFAULT_THRESHOLD };
});
