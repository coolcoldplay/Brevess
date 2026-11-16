(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  const SEMANTIC_FIND_MESSAGE_TYPES = Object.freeze([
    'LLM_SEMANTIC_FIND', 'LLM_SEMANTIC_FIND_CANCEL'
  ]);
  const MAX_PARAGRAPHS = 5000;
  const MAX_PARAGRAPH_CHARS = 1000000;
  const MAX_TOTAL_PARAGRAPH_CHARS = 4 * 1024 * 1024;

  function serviceError(code, message = code) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  function cancelledError() {
    return serviceError('CANCELLED', 'Semantic find was cancelled');
  }

  function safeError(error) {
    return {
      code: String(error?.code || 'SEMANTIC_FIND_FAILED').slice(0, 100),
      message: String(error?.message || error?.code || 'Semantic find failed').slice(0, 500)
    };
  }

  function ownDataValue(object, key) {
    if (!object || (typeof object !== 'object' && typeof object !== 'function')) {
      return undefined;
    }
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    return descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value')
      ? descriptor.value : undefined;
  }

  function trustedOwner(sender, runtimeExtensionId) {
    try {
      if (typeof runtimeExtensionId !== 'string' || !runtimeExtensionId ||
          ownDataValue(sender, 'id') !== runtimeExtensionId) return null;
      const tab = ownDataValue(sender, 'tab');
      const tabId = ownDataValue(tab, 'id');
      const frameId = ownDataValue(sender, 'frameId');
      const documentId = ownDataValue(sender, 'documentId');
      if (!Number.isSafeInteger(tabId) || tabId < 0 ||
          !Number.isSafeInteger(frameId) || frameId < 0 ||
          typeof documentId !== 'string' || !documentId || documentId.length > 256 ||
          documentId !== documentId.normalize('NFKC').trim()) return null;
      return Object.freeze({ tabId, frameId, documentId });
    } catch (_) {
      return null;
    }
  }

  function boundedIdentity(value, field, minimum, maximum) {
    if (typeof value !== 'string' || value.length < minimum || value.length > maximum ||
        value !== value.trim() || /[\u0000-\u001f\u007f\s]/u.test(value)) {
      throw serviceError('SEMANTIC_FIND_INVALID_REQUEST', `${field} is invalid`);
    }
    return value;
  }

  function validateParagraphs(value) {
    if (!Array.isArray(value) || !value.length) {
      throw serviceError('SEMANTIC_FIND_INVALID_REQUEST', 'paragraphs are required');
    }
    if (value.length > MAX_PARAGRAPHS) {
      throw serviceError('SEMANTIC_FIND_LIMIT_EXCEEDED',
        `Semantic find accepts at most ${MAX_PARAGRAPHS} paragraphs`);
    }
    let totalChars = 0;
    const paragraphIds = new Set();
    const paragraphs = value.map(paragraph => {
      if (!paragraph || typeof paragraph !== 'object' || Array.isArray(paragraph) ||
          typeof paragraph.paragraphId !== 'string' || !paragraph.paragraphId ||
          paragraph.paragraphId.length > 256 ||
          /[\u0000-\u001f\u007f]/u.test(paragraph.paragraphId) ||
          paragraphIds.has(paragraph.paragraphId) ||
          typeof paragraph.text !== 'string' || !paragraph.text ||
          (Object.prototype.hasOwnProperty.call(paragraph, 'sectionTitle') &&
            typeof paragraph.sectionTitle !== 'string')) {
        throw serviceError('SEMANTIC_FIND_INVALID_REQUEST', 'paragraphs are invalid');
      }
      if (paragraph.text.length > MAX_PARAGRAPH_CHARS ||
          String(paragraph.sectionTitle || '').length > 1000) {
        throw serviceError('SEMANTIC_FIND_LIMIT_EXCEEDED', 'A semantic find paragraph is too large');
      }
      totalChars += paragraph.text.length + String(paragraph.sectionTitle || '').length;
      if (totalChars > MAX_TOTAL_PARAGRAPH_CHARS) {
        throw serviceError('SEMANTIC_FIND_LIMIT_EXCEEDED',
          'Semantic find source text exceeds its explicit input limit');
      }
      paragraphIds.add(paragraph.paragraphId);
      return {
        paragraphId: paragraph.paragraphId,
        text: paragraph.text,
        ...(paragraph.sectionTitle ? { sectionTitle: paragraph.sectionTitle } : {})
      };
    });
    return Object.freeze(paragraphs.map(Object.freeze));
  }

  function validateFindRequest(message) {
    const operationId = boundedIdentity(message?.operationId, 'operationId', 8, 160);
    const sourceKey = boundedIdentity(message?.sourceKey, 'sourceKey', 1, 512);
    if (typeof message?.query !== 'string' || !message.query.trim() ||
        message.query.length > 1000) {
      throw serviceError('SEMANTIC_FIND_INVALID_REQUEST', 'query is invalid');
    }
    return Object.freeze({
      type: 'LLM_SEMANTIC_FIND',
      operationId,
      sourceKey,
      query: message.query,
      paragraphs: validateParagraphs(message.paragraphs)
    });
  }

  function validateCancelRequest(message) {
    return Object.freeze({
      operationId: boundedIdentity(message?.operationId, 'operationId', 8, 160),
      sourceKey: boundedIdentity(message?.sourceKey, 'sourceKey', 1, 512)
    });
  }

  function ownerKey(owner) {
    return JSON.stringify([owner.tabId, owner.frameId, owner.documentId]);
  }

  function validateProgress(progress, record) {
    if (!progress || typeof progress !== 'object' || Array.isArray(progress) ||
        !Number.isSafeInteger(progress.processed) || progress.processed < 0 ||
        !Number.isSafeInteger(progress.total) || progress.total < 0 || progress.total > 10000 ||
        !Number.isSafeInteger(progress.skipped) || progress.skipped < 0 ||
        progress.processed + progress.skipped > progress.total ||
        !Array.isArray(progress.scores) || progress.scores.length > 64 ||
        typeof progress.done !== 'boolean' ||
        !['full', 'partial'].includes(progress.coverage) ||
        progress.done !== (progress.processed + progress.skipped === progress.total) ||
        progress.coverage !== (progress.skipped ? 'partial' : 'full') ||
        (record.progressTotal !== null && progress.total !== record.progressTotal) ||
        (record.progressSkipped !== null && progress.skipped !== record.progressSkipped) ||
        progress.processed < record.progressProcessed ||
        progress.scores.length !== progress.processed - record.progressProcessed) {
      throw serviceError('SEMANTIC_FIND_INVALID_PROGRESS', 'Semantic find progress is invalid');
    }
    const batchIds = new Set();
    const scores = progress.scores.map(item => {
      if (!item || typeof item !== 'object' || Array.isArray(item) ||
          typeof item.id !== 'string' || !item.id || item.id.length > 160 ||
          batchIds.has(item.id) || record.progressScoreIds.has(item.id) ||
          typeof item.score !== 'number' || !Number.isFinite(item.score) ||
          item.score < 0 || item.score > 1) {
        throw serviceError('SEMANTIC_FIND_INVALID_PROGRESS', 'Semantic find scores are invalid');
      }
      batchIds.add(item.id);
      return Object.freeze({ id: item.id, score: item.score });
    });
    record.progressTotal = progress.total;
    record.progressSkipped = progress.skipped;
    record.progressProcessed = progress.processed;
    batchIds.forEach(id => record.progressScoreIds.add(id));
    return Object.freeze({
      processed: progress.processed,
      total: progress.total,
      skipped: progress.skipped,
      scores: Object.freeze(scores),
      done: progress.done,
      coverage: progress.coverage
    });
  }

  function createSemanticFindService({
    runtimeExtensionId,
    runRequest,
    sendProgress,
    AbortControllerImpl = globalThis.AbortController
  } = {}) {
    if (typeof runtimeExtensionId !== 'string' || !runtimeExtensionId ||
        typeof runRequest !== 'function' || typeof sendProgress !== 'function' ||
        typeof AbortControllerImpl !== 'function') {
      throw serviceError('SEMANTIC_FIND_SERVICE_UNAVAILABLE');
    }
    const activeByOwner = new Map();

    function abortRecord(record) {
      if (!record?.controller.signal.aborted) record.controller.abort();
    }

    function cancelledResponse() {
      return { success: false, error: safeError(cancelledError()) };
    }

    async function start(message, owner) {
      const validated = validateFindRequest(message);
      const key = ownerKey(owner);
      const previous = activeByOwner.get(key);
      if (previous) abortRecord(previous);
      const record = {
        owner,
        operationId: validated.operationId,
        sourceKey: validated.sourceKey,
        controller: new AbortControllerImpl(),
        progressProcessed: 0,
        progressTotal: null,
        progressSkipped: null,
        progressScoreIds: new Set()
      };
      activeByOwner.set(key, record);
      const isCurrent = () => activeByOwner.get(key) === record &&
        !record.controller.signal.aborted;
      const onSemanticFindProgress = async progress => {
        if (!isCurrent()) throw cancelledError();
        const safeProgress = validateProgress(progress, record);
        if (!isCurrent()) throw cancelledError();
        try {
          await sendProgress(record.owner, Object.freeze({
            action: 'semanticFindProgress',
            operationId: record.operationId,
            sourceKey: record.sourceKey,
            progress: safeProgress
          }));
        } catch (_) {
          abortRecord(record);
          throw cancelledError();
        }
        if (!isCurrent()) throw cancelledError();
      };
      try {
        const response = await runRequest(validated, {
          semanticFindSignal: record.controller.signal,
          onSemanticFindProgress
        });
        if (!isCurrent()) return cancelledResponse();
        return response;
      } catch (error) {
        if (!isCurrent() || record.controller.signal.aborted || error?.code === 'CANCELLED') {
          return cancelledResponse();
        }
        return { success: false, error: safeError(error) };
      } finally {
        if (activeByOwner.get(key) === record) activeByOwner.delete(key);
      }
    }

    function cancel(message, owner) {
      const validated = validateCancelRequest(message);
      const key = ownerKey(owner);
      const record = activeByOwner.get(key);
      if (!record || record.operationId !== validated.operationId ||
          record.sourceKey !== validated.sourceKey) {
        return { success: true, data: { cancelled: false } };
      }
      abortRecord(record);
      activeByOwner.delete(key);
      return { success: true, data: { cancelled: true } };
    }

    async function handle(message, sender) {
      try {
        const owner = trustedOwner(sender, runtimeExtensionId);
        if (!owner) throw serviceError(
          'SEMANTIC_FIND_OWNER_UNAVAILABLE', 'Semantic find requires a trusted document owner'
        );
        if (message?.type === 'LLM_SEMANTIC_FIND') return await start(message, owner);
        if (message?.type === 'LLM_SEMANTIC_FIND_CANCEL') return cancel(message, owner);
        throw serviceError('SEMANTIC_FIND_INVALID_REQUEST', 'Unknown semantic find message');
      } catch (error) {
        return { success: false, error: safeError(error) };
      }
    }

    async function commitTrustedDocument(input) {
      if (String(input?.senderExtensionId || '') !== runtimeExtensionId ||
          !Number.isSafeInteger(input?.senderTabId) || input.senderTabId < 0 ||
          !Number.isSafeInteger(input?.senderFrameId) || input.senderFrameId < 0 ||
          typeof input?.senderDocumentId !== 'string' || !input.senderDocumentId) {
        throw serviceError('SEMANTIC_FIND_OWNER_UNAVAILABLE');
      }
      let cancelled = 0;
      for (const [key, record] of activeByOwner) {
        if (record.owner.tabId !== input.senderTabId ||
            record.owner.frameId !== input.senderFrameId ||
            record.owner.documentId === input.senderDocumentId) continue;
        abortRecord(record);
        activeByOwner.delete(key);
        cancelled += 1;
      }
      return { cancelled };
    }

    async function retireTrustedTab(input) {
      if (String(input?.senderExtensionId || '') !== runtimeExtensionId ||
          !Number.isSafeInteger(input?.senderTabId) || input.senderTabId < 0) {
        throw serviceError('SEMANTIC_FIND_OWNER_UNAVAILABLE');
      }
      let cancelled = 0;
      for (const [key, record] of activeByOwner) {
        if (record.owner.tabId !== input.senderTabId) continue;
        abortRecord(record);
        activeByOwner.delete(key);
        cancelled += 1;
      }
      return { cancelled };
    }

    return Object.freeze({
      handles(type) { return SEMANTIC_FIND_MESSAGE_TYPES.includes(String(type || '')); },
      handle,
      commitTrustedDocument,
      retireTrustedTab
    });
  }

  return { SEMANTIC_FIND_MESSAGE_TYPES, createSemanticFindService };
});
