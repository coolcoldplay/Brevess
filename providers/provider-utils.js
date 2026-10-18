(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  const MAX_NON_STREAM_RESPONSE_BYTES = 4 * 1024 * 1024;
  const RESPONSE_LIMIT_MESSAGE = 'Provider response body exceeded the 4 MiB limit';
  const REQUEST_BOUNDARY_TRANSPORT_LEASES = new WeakMap();
  const PROVIDER_TRANSPORT_LEASES = new WeakMap();
  // Prior model text is private request context, never a public Error field.
  const JSON_FORMAT_FAILURE_CONTEXTS = new WeakMap();
  const MAX_JSON_FORMAT_FAILURE_CHARS = 32768;

  class ProviderRequestError extends Error {
    constructor(code, message, options = {}) {
      super(message);
      this.name = 'ProviderRequestError';
      this.code = code;
      this.status = options.status || 0;
      this.retryable = Boolean(options.retryable);
      this.diagnosticStage = options.diagnosticStage || '';
      this.diagnosticType = options.diagnosticType || '';
      this.finishReason = typeof options.finishReason === 'string'
        ? options.finishReason.slice(0, 80) : '';
      this.requestBytes = Number.isFinite(options.requestBytes) ? options.requestBytes : 0;
      this.elapsedMs = Number.isFinite(options.elapsedMs) ? options.elapsedMs : 0;
      this.retryAfterMs = Number.isFinite(options.retryAfterMs)
        ? Math.max(0, Math.min(300000, options.retryAfterMs)) : 0;
      this.suggestedMaxOutputTokens = Number.isFinite(options.suggestedMaxOutputTokens)
        ? Math.max(512, Math.min(2000000, Math.round(options.suggestedMaxOutputTokens))) : undefined;
    }
  }

  class ResponseLimitError extends Error {
    constructor() {
      super(RESPONSE_LIMIT_MESSAGE);
      this.name = 'ResponseLimitError';
      this.code = 'RESPONSE_BODY_TOO_LARGE';
    }
  }

  const NATIVE_RESPONSE_INTRINSICS = (() => {
    try {
      if (typeof Response !== 'function') return null;
      const responsePrototype = Response.prototype;
      const textDescriptor = Object.getOwnPropertyDescriptor(responsePrototype, 'text');
      const bodyDescriptor = Object.getOwnPropertyDescriptor(responsePrototype, 'body');
      if (!textDescriptor || typeof textDescriptor.value !== 'function' ||
          !bodyDescriptor || typeof bodyDescriptor.get !== 'function') return null;
      let streamPrototype = null;
      let getReaderDescriptor = null;
      if (typeof ReadableStream === 'function') {
        streamPrototype = ReadableStream.prototype;
        getReaderDescriptor = Object.getOwnPropertyDescriptor(streamPrototype, 'getReader');
        if (!getReaderDescriptor || typeof getReaderDescriptor.value !== 'function') {
          streamPrototype = null;
          getReaderDescriptor = null;
        }
      }
      return {
        responsePrototype,
        textDescriptor,
        bodyDescriptor,
        streamPrototype,
        getReaderDescriptor
      };
    } catch {
      return null;
    }
  })();

  function errorFromStatus(status, options = {}) {
    const tokenLimit = status === 400 ? extractTokenLimitSuggestion(options.responseBody) : null;
    if (tokenLimit !== null) {
      return new ProviderRequestError('TOKEN_LIMIT_REJECTED', 'Provider rejected the requested output token limit', {
        status, suggestedMaxOutputTokens: tokenLimit, ...options
      });
    }
    if (status === 401 || status === 403) {
      return new ProviderRequestError('AUTH_INVALID', 'API authentication failed', { status, ...options });
    }
    if (status === 402) {
      return new ProviderRequestError('QUOTA_EXHAUSTED', 'API quota is exhausted', { status, ...options });
    }
    if (status === 408) {
      return new ProviderRequestError('REQUEST_TIMEOUT', 'Provider request timed out', {
        status, retryable: true, ...options
      });
    }
    if (status === 429) {
      return new ProviderRequestError('RATE_LIMITED', 'Provider rate limit reached', {
        status, retryable: true, ...options
      });
    }
    if (status >= 500) {
      return new ProviderRequestError('PROVIDER_UNAVAILABLE', 'Provider is temporarily unavailable', {
        status, retryable: true, ...options
      });
    }
    return new ProviderRequestError('PROVIDER_REJECTED', 'Provider rejected the request', {
      status, ...options
    });
  }

  function extractTokenLimitSuggestion(body) {
    const text = String(body || '').slice(0, 16 * 1024);
    const field = '(?:max_tokens|max_output_tokens|maxOutputTokens)';
    const number = '(\\d+(?:\\.\\d+)?)';
    const patterns = [
      `\\b${field}\\b\\s*must\\s+be\\s*(?:<=|<|at\\s+most|no\\s+more\\s+than)\\s*${number}`,
      `\\b${field}\\b\\s*cannot\\s+exceed\\s*${number}`,
      `\\b${field}\\b\\s*(?:maximum|allowed|limit)\\s*(?:is|of|:|=)\\s*${number}`,
      `\\b${field}\\b\\s*(?:maximum|allowed|limit)\\s*:\\s*${number}`,
      `\\b${field}\\b\\s*exceeds?\\s+(?:the\\s+)?(?:maximum|allowed|limit)(?:\\s+(?:is|of))?\\s*${number}`,
      `\\b(?:maximum|allowed|limit)\\s+${field}\\b\\s*(?:is|of|:|=)\\s*${number}`
    ];
    for (const pattern of patterns) {
      const match = text.match(new RegExp(pattern, 'i'));
      if (!match) continue;
      const suggested = Number(match[1]);
      if (Number.isFinite(suggested) && suggested >= 512 && suggested <= 2000000) return Math.round(suggested);
    }
    return null;
  }

  function parseRetryAfter(value, now = Date.now()) {
    const text = String(value || '').trim();
    if (!text) return 0;
    const seconds = Number(text);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(300000, Math.round(seconds * 1000));
    const date = Date.parse(text);
    return Number.isFinite(date) ? Math.max(0, Math.min(300000, date - now)) : 0;
  }

  function requestAbortError() {
    const error = new Error('The operation was aborted');
    error.name = 'AbortError';
    return error;
  }

  function getProviderTransportLease(error) {
    if (!error || (typeof error !== 'object' && typeof error !== 'function')) return null;
    return PROVIDER_TRANSPORT_LEASES.get(error) || null;
  }

  function attachProviderTransportLease(error, boundaryError) {
    const lease = REQUEST_BOUNDARY_TRANSPORT_LEASES.get(boundaryError);
    if (lease) PROVIDER_TRANSPORT_LEASES.set(error, lease);
    return error;
  }

  function awaitRequestBoundary(value, signal, onLateFulfilled) {
    const operation = Promise.resolve(value);
    let transportSettled = false;
    let resolveTransportSettlement;
    const transportSettlement = new Promise(resolve => {
      resolveTransportSettlement = resolve;
    });
    const markTransportSettled = () => {
      if (transportSettled) return;
      transportSettled = true;
      resolveTransportSettlement();
    };
    const transportLease = Object.freeze({
      settlement: transportSettlement,
      isSettled: () => transportSettled
    });
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (handler, result) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        handler(result);
      };
      const onAbort = () => {
        if (settled) return;
        const error = requestAbortError();
        if (!transportSettled) REQUEST_BOUNDARY_TRANSPORT_LEASES.set(error, transportLease);
        finish(reject, error);
      };
      signal.addEventListener('abort', onAbort, { once: true });
      operation.then(
        result => {
          markTransportSettled();
          if (!settled) finish(resolve, result);
          else if (signal.aborted && typeof onLateFulfilled === 'function') {
            try { onLateFulfilled(result); } catch {
              // A late result is cleanup-only and cannot replace the latched terminal result.
            }
          }
        },
        error => {
          markTransportSettled();
          if (!settled) finish(reject, error);
        }
      );
      if (signal.aborted) onAbort();
    });
  }

  async function readBoundedErrorBody(response, signal, maximumBytes = 16 * 1024) {
    if (!response?.body?.getReader) {
      const declaredBytes = Number(response?.headers?.get?.('Content-Length'));
      if (Number.isFinite(declaredBytes) && declaredBytes > maximumBytes) return '';
      try {
        return String(await awaitRequestBoundary(response.text(), signal)).slice(0, maximumBytes);
      } catch (error) {
        if (REQUEST_BOUNDARY_TRANSPORT_LEASES.has(error)) {
          cancelResponseBodyWithoutWaiting(response);
          throw error;
        }
        return '';
      }
    }
    let reader;
    let bytesRead = 0;
    let text = '';
    try {
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      while (bytesRead < maximumBytes) {
        const item = await awaitRequestBoundary(reader.read(), signal);
        if (item.done) break;
        const bytes = item.value instanceof Uint8Array ? item.value : new Uint8Array(item.value || []);
        const allowed = Math.min(bytes.length, maximumBytes - bytesRead);
        text += decoder.decode(bytes.subarray(0, allowed), { stream: true });
        bytesRead += allowed;
      }
      text += decoder.decode();
      return text;
    } catch (error) {
      if (REQUEST_BOUNDARY_TRANSPORT_LEASES.has(error)) throw error;
      return '';
    } finally {
      cancelAndReleaseReader(reader);
    }
  }

  function requestByteLength(body) {
    if (typeof body !== 'string') return 0;
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(body).length;
    return unescape(encodeURIComponent(body)).length;
  }

  function declaredResponseBytes(response) {
    const raw = response?.headers?.get?.('Content-Length');
    if (raw === null || raw === undefined) return null;
    const text = String(raw).trim();
    if (!/^\d+$/.test(text)) return null;
    const value = Number(text);
    return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
  }

  function utf8ByteLength(value) {
    return new TextEncoder().encode(value).length;
  }

  function createUtf8ByteCounter(maximumBytes) {
    let bytesRead = 0;
    let trailingHighSurrogate = '';
    const account = (value, final = false) => {
      let text = trailingHighSurrogate + String(value || '');
      trailingHighSurrogate = '';
      if (!final && /[\uD800-\uDBFF]$/.test(text)) {
        trailingHighSurrogate = text.slice(-1);
        text = text.slice(0, -1);
      }
      bytesRead += utf8ByteLength(text);
      if (bytesRead > maximumBytes) throw new ResponseLimitError();
    };
    return {
      add(value) { account(value, false); },
      finish() { account('', true); }
    };
  }

  function sameDataDescriptor(current, captured) {
    return Boolean(current && captured &&
      Object.hasOwn(current, 'value') && current.value === captured.value &&
      current.writable === captured.writable &&
      current.enumerable === captured.enumerable &&
      current.configurable === captured.configurable);
  }

  function sameAccessorDescriptor(current, captured) {
    return Boolean(current && captured &&
      current.get === captured.get && current.set === captured.set &&
      current.enumerable === captured.enumerable &&
      current.configurable === captured.configurable);
  }

  function inspectNativeResponse(response) {
    const native = NATIVE_RESPONSE_INTRINSICS;
    if (!native || (!response || (typeof response !== 'object' && typeof response !== 'function'))) {
      return { kind: 'other' };
    }
    let prototype;
    let ownText;
    let ownBody;
    let currentText;
    let currentBody;
    try {
      prototype = Object.getPrototypeOf(response);
      if (prototype !== native.responsePrototype) return { kind: 'other' };
      ownText = Object.getOwnPropertyDescriptor(response, 'text');
      ownBody = Object.getOwnPropertyDescriptor(response, 'body');
      currentText = Object.getOwnPropertyDescriptor(native.responsePrototype, 'text');
      currentBody = Object.getOwnPropertyDescriptor(native.responsePrototype, 'body');
    } catch {
      return { kind: 'unsafe' };
    }
    if (ownText || ownBody ||
        !sameDataDescriptor(currentText, native.textDescriptor) ||
        !sameAccessorDescriptor(currentBody, native.bodyDescriptor)) {
      return { kind: 'other' };
    }
    let body;
    try {
      body = native.bodyDescriptor.get.call(response);
    } catch {
      return { kind: 'other' };
    }
    if (!body || !native.streamPrototype || !native.getReaderDescriptor) {
      return { kind: 'text', method: native.textDescriptor.value };
    }
    try {
      const streamPrototype = Object.getPrototypeOf(body);
      const ownGetReader = Object.getOwnPropertyDescriptor(body, 'getReader');
      const currentGetReader = Object.getOwnPropertyDescriptor(native.streamPrototype, 'getReader');
      if (streamPrototype !== native.streamPrototype || ownGetReader ||
          !sameDataDescriptor(currentGetReader, native.getReaderDescriptor)) {
        return { kind: 'text', method: native.textDescriptor.value };
      }
    } catch {
      return { kind: 'text', method: native.textDescriptor.value };
    }
    return { kind: 'reader', body, getReader: native.getReaderDescriptor.value };
  }

  function inspectResponseTextFacade(response) {
    let owner = response;
    for (let depth = 0; owner !== null && depth < 16; depth += 1) {
      let descriptor;
      try {
        descriptor = Object.getOwnPropertyDescriptor(owner, 'text');
      } catch {
        return { kind: 'unsafe' };
      }
      if (descriptor) {
        if (Object.hasOwn(descriptor, 'value')) {
          return typeof descriptor.value === 'function'
            ? { kind: 'method', method: descriptor.value }
            : { kind: 'unsafe' };
        }
        return typeof descriptor.get === 'function'
          ? { kind: 'accessor', getter: descriptor.get }
          : { kind: 'unsafe' };
      }
      try {
        owner = Object.getPrototypeOf(owner);
      } catch {
        return { kind: 'unsafe' };
      }
    }
    return owner === null ? { kind: 'none' } : { kind: 'unsafe' };
  }

  function unsafeResponseFacade() {
    return new TypeError('Provider response text facade is not safely callable');
  }

  async function readCheckedResponseText(response, inspection, signal) {
    let method = inspection.method;
    if (inspection.kind === 'accessor') {
      method = inspection.getter.call(response);
      if (typeof method !== 'function') throw unsafeResponseFacade();
    }
    let rawText;
    try {
      rawText = await awaitRequestBoundary(method.call(response), signal);
    } catch (error) {
      if (REQUEST_BOUNDARY_TRANSPORT_LEASES.has(error)) {
        cancelResponseBodyWithoutWaiting(response);
      }
      throw error;
    }
    const text = String(rawText);
    if (utf8ByteLength(text) > MAX_NON_STREAM_RESPONSE_BYTES) {
      throw new ResponseLimitError();
    }
    return text;
  }

  function cancelWithoutWaiting(target) {
    try { Promise.resolve(target?.cancel?.()).catch(() => {}); } catch {
      // Cleanup is best effort and must not replace or delay the primary result.
    }
  }

  function releaseWithoutWaiting(reader) {
    try { Promise.resolve(reader?.releaseLock?.()).catch(() => {}); } catch {
      // Cleanup is best effort and must not replace or delay the primary result.
    }
  }

  function closeIteratorWithoutWaiting(iterator) {
    try { Promise.resolve(iterator?.return?.()).catch(() => {}); } catch {
      // Closing the upstream iterator is best effort and must not delay the primary result.
    }
  }

  function cancelAndReleaseReader(reader) {
    cancelWithoutWaiting(reader);
    releaseWithoutWaiting(reader);
  }

  function cancelResponseBodyWithoutWaiting(response) {
    let body;
    try { body = response?.body; } catch { return; }
    let reader = null;
    try {
      const getReader = body?.getReader;
      if (typeof getReader === 'function') reader = getReader.call(body);
    } catch {
      // The declared limit remains authoritative even when cleanup cannot acquire a reader.
    }
    if (reader) cancelAndReleaseReader(reader);
    else cancelWithoutWaiting(body);
  }

  async function readNonStreamResponseText(response, signal) {
    const declaredBytes = declaredResponseBytes(response);
    if (declaredBytes !== null && declaredBytes > MAX_NON_STREAM_RESPONSE_BYTES) {
      cancelResponseBodyWithoutWaiting(response);
      throw new ResponseLimitError();
    }

    const nativeResponse = inspectNativeResponse(response);
    if (nativeResponse.kind === 'unsafe') throw unsafeResponseFacade();
    if (nativeResponse.kind === 'text') {
      return readCheckedResponseText(response, {
        kind: 'method', method: nativeResponse.method
      }, signal);
    }

    if (nativeResponse.kind !== 'reader') {
      const facade = inspectResponseTextFacade(response);
      if (facade.kind === 'unsafe') throw unsafeResponseFacade();
      if (facade.kind === 'method' || facade.kind === 'accessor') {
        return readCheckedResponseText(response, facade, signal);
      }
    }

    let body = nativeResponse.body;
    let getReader = nativeResponse.getReader;
    if (nativeResponse.kind !== 'reader') {
      body = response?.body;
      getReader = body?.getReader;
      if (typeof getReader !== 'function') throw unsafeResponseFacade();
    }

    const reader = getReader.call(body);
    const decoder = new TextDecoder();
    let bytesRead = 0;
    let completed = false;
    let text = '';
    try {
      while (true) {
        const item = await awaitRequestBoundary(reader.read(), signal);
        if (item.done) {
          completed = true;
          text += decoder.decode();
          return text;
        }
        const bytes = item.value instanceof Uint8Array
          ? item.value : new Uint8Array(item.value || []);
        if (bytesRead + bytes.length > MAX_NON_STREAM_RESPONSE_BYTES) {
          throw new ResponseLimitError();
        }
        bytesRead += bytes.length;
        text += decoder.decode(bytes, { stream: true });
      }
    } finally {
      if (!completed) cancelAndReleaseReader(reader);
      else releaseWithoutWaiting(reader);
    }
  }

  function normalizeOutputTokenLimit(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && Number.isInteger(numeric) && numeric > 0 && numeric <= 2000000
      ? numeric : 4096;
  }

  function boundedUsageNumber(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 0
      ? Math.min(Number.MAX_SAFE_INTEGER, Math.round(numeric)) : 0;
  }

  function emitProviderTelemetry(request, value = {}) {
    if (typeof request?.onProviderTelemetry !== 'function') return;
    const usage = value.usage || {};
    const input = usage.input_tokens ?? usage.prompt_tokens ?? usage.promptTokenCount ?? usage.inputTokens;
    const output = usage.output_tokens ?? usage.completion_tokens ?? usage.candidatesTokenCount ?? usage.outputTokens;
    const provided = number => number !== null && number !== undefined && number !== '' &&
      Number.isFinite(Number(number)) && Number(number) >= 0;
    const event = {
      providerId: String(value.providerId || ''),
      model: String(value.model || '').slice(0, 160),
      elapsedMs: boundedUsageNumber(value.elapsedMs),
      finishReason: String(value.finishReason || '').slice(0, 80),
      inputTokens: boundedUsageNumber(
        usage.input_tokens ?? usage.prompt_tokens ?? usage.promptTokenCount ??
        usage.inputTokens
      ),
      outputTokens: boundedUsageNumber(
        usage.output_tokens ?? usage.completion_tokens ?? usage.candidatesTokenCount ??
        usage.outputTokens
      ),
      reasoningTokens: boundedUsageNumber(
        usage.output_tokens_details?.reasoning_tokens ??
        usage.completion_tokens_details?.reasoning_tokens ??
        usage.thoughtsTokenCount ?? usage.reasoningTokens ?? usage.reasoningOutputTokens
      ),
      cacheHitTokens: boundedUsageNumber(
        usage.prompt_cache_hit_tokens ?? usage.cache_read_input_tokens ??
        usage.cacheHitTokens ?? usage.cachedInputTokens
      ),
      cacheMissTokens: boundedUsageNumber(usage.prompt_cache_miss_tokens)
    };
    if (/^[A-Za-z0-9._:-]{1,100}$/u.test(value.providerRequestId || '')) {
      event.providerRequestId = value.providerRequestId;
    }
    event.inputTokensProvided = provided(input);
    event.outputTokensProvided = provided(output);
    event.usageProvided = event.inputTokensProvided || event.outputTokensProvided;
    event.estimated = value.estimated === true;
    try { request.onProviderTelemetry(event); } catch {
      // Telemetry must never affect provider handling.
    }
  }

  async function requestText(fetchImpl, url, options) {
    const {
      signal: externalSignal,
      timeoutMs: requestedTimeout,
      _returnMetadata: returnMetadata,
      ...fetchOptions
    } = options || {};
    const controller = new AbortController();
    const timeoutMs = Number.isFinite(Number(requestedTimeout))
      ? Math.max(1, Number(requestedTimeout))
      : 240000;
    let abortReason = '';
    const abort = reason => {
      if (abortReason || controller.signal.aborted) return;
      abortReason = reason;
      controller.abort();
    };
    const throwIfAborted = () => {
      if (!abortReason) return;
      throw requestAbortError();
    };
    const forwardAbort = () => abort('cancelled');
    if (externalSignal?.aborted) forwardAbort();
    else {
      externalSignal?.addEventListener('abort', forwardAbort, { once: true });
      if (externalSignal?.aborted) forwardAbort();
    }
    const timeout = setTimeout(() => abort('timeout'), timeoutMs);
    const startedAt = Date.now();
    const requestBytes = requestByteLength(fetchOptions.body);
    let diagnosticStage = 'request';
    let responseStatus = 0;
    let responseContentType = '';
    let text;
    try {
      throwIfAborted();
      const response = await awaitRequestBoundary(
        fetchImpl(url, { ...fetchOptions, signal: controller.signal }),
        controller.signal,
        cancelResponseBodyWithoutWaiting
      );
      responseStatus = Number(response.status) || 0;
      responseContentType = String(response.headers?.get?.('Content-Type') || '');
      if (!response.ok) {
        const retryAfterMs = parseRetryAfter(response.headers?.get?.('Retry-After'));
        let responseBody = '';
        if (response.status === 400) {
          diagnosticStage = 'response-body';
          responseBody = await readBoundedErrorBody(response, controller.signal);
          throwIfAborted();
        }
        throw errorFromStatus(response.status, {
          retryAfterMs,
          responseBody,
          status: responseStatus,
          diagnosticStage: 'response-body',
          requestBytes,
          elapsedMs: Math.max(0, Date.now() - startedAt)
        });
      }
      diagnosticStage = 'response-body';
      text = await readNonStreamResponseText(response, controller.signal);
      throwIfAborted();
    } catch (error) {
      const diagnostics = {
        status: responseStatus,
        retryable: true,
        diagnosticStage,
        diagnosticType: error?.name || 'Error',
        requestBytes,
        elapsedMs: Math.max(0, Date.now() - startedAt)
      };
      if (abortReason === 'timeout') {
        throw attachProviderTransportLease(
          new ProviderRequestError('REQUEST_TIMEOUT', 'Provider request timed out', diagnostics),
          error
        );
      }
      if (abortReason === 'cancelled') {
        throw attachProviderTransportLease(
          new ProviderRequestError('CANCELLED', 'Provider request was cancelled', {
            ...diagnostics,
            retryable: false
          }),
          error
        );
      }
      if (error instanceof ProviderRequestError) throw error;
      if (error?.name === 'AbortError') {
        throw new ProviderRequestError('CANCELLED', 'Provider request was cancelled', {
          ...diagnostics,
          retryable: false
        });
      }
      if (diagnosticStage === 'response-body' &&
          (error?.name === 'ResponseLimitError' || error?.code === 'RESPONSE_BODY_TOO_LARGE')) {
        throw new ProviderRequestError('INVALID_RESPONSE', RESPONSE_LIMIT_MESSAGE, {
          ...diagnostics,
          retryable: false,
          diagnosticStage: 'response-body',
          diagnosticType: 'ResponseLimitError'
        });
      }
      throw new ProviderRequestError('NETWORK_ERROR', 'Unable to reach the provider', diagnostics);
    } finally {
      clearTimeout(timeout);
      externalSignal?.removeEventListener('abort', forwardAbort);
    }
    return returnMetadata
      ? { text, status: responseStatus, contentType: responseContentType } : text;
  }

  async function requestJson(fetchImpl, url, options) {
    const startedAt = Date.now();
    const requestBytes = requestByteLength(options?.body);
    const response = await requestText(fetchImpl, url, { ...options, _returnMetadata: true });
    try {
      return JSON.parse(response.text);
    } catch {
      const looksLikeHtml = /(?:text\/html|application\/xhtml)/i.test(
        response.contentType || ''
      ) || /^\s*(?:<!doctype\s+html|<html\b)/i.test(response.text || '');
      throw new ProviderRequestError('INVALID_RESPONSE', 'Provider returned invalid JSON', {
        status: response.status,
        diagnosticType: looksLikeHtml ? 'HtmlResponse' : 'JsonSyntaxError',
        diagnosticStage: 'response-body', requestBytes, elapsedMs: Math.max(0, Date.now() - startedAt)
      });
    }
  }

  const MAX_PROVIDER_STREAM_EVENT_CHARS = 64 * 1024;
  const MAX_PROVIDER_STREAM_BUFFER_CHARS = 256 * 1024;
  const MAX_NON_STREAM_FALLBACK_CHARS = 4 * 1024 * 1024;

  function streamTransportError(value, fallback = 'Provider stream failed') {
    const error = new Error(String(value?.message || fallback).slice(0, 240));
    error.name = String(value?.name || 'TypeError').slice(0, 80);
    return error;
  }

  function responseHeadersFromStreamStart(value) {
    return {
      get(name) {
        const key = String(name || '').toLowerCase();
        if (key === 'retry-after') return String(value?.retryAfter || '') || null;
        if (key === 'content-type') return String(value?.contentType || '') || null;
        return null;
      }
    };
  }

  async function* readableResponseChunks(response) {
    const boundedSuccess = response?.ok === true;
    if (boundedSuccess) {
      const declaredBytes = declaredResponseBytes(response);
      if (declaredBytes !== null && declaredBytes > MAX_NON_STREAM_RESPONSE_BYTES) {
        cancelResponseBodyWithoutWaiting(response);
        throw new ResponseLimitError();
      }
    }
    if (!response?.body?.getReader) {
      const body = String(await response.text());
      if (boundedSuccess && utf8ByteLength(body) > MAX_NON_STREAM_RESPONSE_BYTES) {
        throw new ResponseLimitError();
      }
      for (let offset = 0; offset < body.length; offset += MAX_PROVIDER_STREAM_EVENT_CHARS) {
        yield body.slice(offset, offset + MAX_PROVIDER_STREAM_EVENT_CHARS);
      }
      return;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let bytesRead = 0;
    let completed = false;
    try {
      while (true) {
        const item = await reader.read();
        if (item.done) {
          completed = true;
          break;
        }
        const bytes = item.value instanceof Uint8Array
          ? item.value : new Uint8Array(item.value || []);
        if (boundedSuccess && bytesRead + bytes.length > MAX_NON_STREAM_RESPONSE_BYTES) {
          throw new ResponseLimitError();
        }
        bytesRead += bytes.length;
        for (let offset = 0; offset < bytes.length; offset += MAX_PROVIDER_STREAM_EVENT_CHARS) {
          const text = decoder.decode(
            bytes.subarray(offset, offset + MAX_PROVIDER_STREAM_EVENT_CHARS),
            { stream: true }
          );
          if (text) yield text;
        }
      }
      const tail = decoder.decode();
      if (tail) yield tail;
    } finally {
      if (!completed) {
        cancelAndReleaseReader(reader);
      } else {
        try { reader.releaseLock?.(); } catch { /* Preserve the provider result. */ }
      }
    }
  }

  async function openProviderTextTransport(fetchImpl, url, fetchOptions) {
    if (typeof fetchImpl?.stream !== 'function') {
      const response = await fetchImpl(url, fetchOptions);
      return {
        ok: Boolean(response?.ok),
        status: Number(response?.status) || 0,
        headers: response?.headers || { get() { return null; } },
        chunks: readableResponseChunks(response),
        close() { cancelResponseBodyWithoutWaiting(response); }
      };
    }
    const iterator = fetchImpl.stream(url, fetchOptions)[Symbol.asyncIterator]();
    let first;
    try {
      first = await iterator.next();
    } catch (error) {
      closeIteratorWithoutWaiting(iterator);
      throw error;
    }
    if (first.done || first.value?.type === 'error') {
      closeIteratorWithoutWaiting(iterator);
      throw streamTransportError(first.value?.error);
    }
    if (first.value?.type === 'cancelled') {
      closeIteratorWithoutWaiting(iterator);
      const error = new Error('The operation was aborted');
      error.name = 'AbortError';
      throw error;
    }
    if (first.value?.type !== 'started') {
      closeIteratorWithoutWaiting(iterator);
      throw new ProviderRequestError('INVALID_RESPONSE', 'Offscreen stream did not start correctly');
    }
    const started = first.value;
    const successful = started.ok === true ||
      (Number(started.status) >= 200 && Number(started.status) < 300);
    return {
      ok: successful,
      status: Number(started.status) || 0,
      headers: responseHeadersFromStreamStart(started),
      close() { closeIteratorWithoutWaiting(iterator); },
      chunks: (async function* transportChunks() {
        const byteCounter = successful
          ? createUtf8ByteCounter(MAX_NON_STREAM_RESPONSE_BYTES) : null;
        try {
          while (true) {
            const item = await iterator.next();
            if (item.done) {
              byteCounter?.finish();
              return;
            }
            const event = item.value || {};
            if (event.type === 'chunk') {
              const text = String(event.text || '').slice(0, MAX_PROVIDER_STREAM_EVENT_CHARS);
              byteCounter?.add(text);
              yield text;
              continue;
            }
            if (event.type === 'completed') {
              byteCounter?.finish();
              return;
            }
            if (event.type === 'cancelled') {
              const error = new Error('The operation was aborted');
              error.name = 'AbortError';
              throw error;
            }
            if (event.type === 'error') throw streamTransportError(event.error);
          }
        } finally {
          closeIteratorWithoutWaiting(iterator);
        }
      })()
    };
  }

  function createSseFrameDecoder() {
    let buffer = '';
    function parseBlock(block) {
      let eventName = '';
      const dataLines = [];
      for (const line of block.replace(/\r\n?/g, '\n').split('\n')) {
        if (!line || line.startsWith(':')) continue;
        if (line.startsWith('event:')) eventName = line.slice(6).trim();
        if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
      }
      if (!dataLines.length) return null;
      return { event: eventName, data: dataLines.join('\n') };
    }
    function pull(final = false) {
      const frames = [];
      let boundary = buffer.match(/\r\n\r\n|\n\n|\r\r/);
      while (boundary) {
        const block = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        const frame = parseBlock(block);
        if (frame) frames.push(frame);
        boundary = buffer.match(/\r\n\r\n|\n\n|\r\r/);
      }
      if (final && buffer.trim() && /^(?:event:|data:|:)/m.test(buffer.trimStart())) {
        const frame = parseBlock(buffer);
        buffer = '';
        if (frame) frames.push(frame);
      }
      if (buffer.length > MAX_PROVIDER_STREAM_BUFFER_CHARS) {
        throw new ProviderRequestError('INVALID_RESPONSE', 'Provider streaming event exceeded the parser limit');
      }
      return frames;
    }
    return {
      push(value) {
        buffer += String(value || '');
        return pull(false);
      },
      finish() { return pull(true); }
    };
  }

  function parseStreamJson(frame) {
    if (frame.data === '[DONE]') return { done: true };
    try {
      return { data: JSON.parse(frame.data), event: frame.event };
    } catch {
      throw new ProviderRequestError('INVALID_RESPONSE', 'Provider returned malformed streaming data');
    }
  }

  function protocolEvents(protocol, frame, publicProcess = '') {
    const parsed = parseStreamJson(frame);
    if (parsed.done) return [{ kind: 'done' }];
    const data = parsed.data || {};
    if (data.error) {
      throw new ProviderRequestError('PROVIDER_REJECTED', 'Provider rejected the streaming request');
    }
    if (protocol === 'openai-responses') {
      const compatibleChoice = data.choices?.[0] || {};
      if (Array.isArray(data.choices)) {
        return [
          ...(typeof compatibleChoice.delta?.content === 'string' && compatibleChoice.delta.content
            ? [{ kind: 'delta', text: compatibleChoice.delta.content }] : []),
          ...(data.usage ? [{ kind: 'usage', usage: data.usage }] : []),
          ...(compatibleChoice.finish_reason
            ? [{ kind: 'finish', reason: compatibleChoice.finish_reason }] : [])
        ];
      }
      const type = data.type || parsed.event;
      if (publicProcess === 'openai-summary' &&
          ['response.reasoning_summary_text.delta', 'response.reasoning_summary_text.done'].includes(type)) {
        return [{ kind: 'public_summary', data, done: type.endsWith('.done') }];
      }
      if (type === 'response.output_text.delta' && typeof data.delta === 'string') {
        return [{ kind: 'delta', text: data.delta }];
      }
      if (type === 'response.completed' || type === 'response.incomplete') {
        const response = data.response || data;
        return [
          ...(response.usage ? [{ kind: 'usage', usage: response.usage }] : []),
          {
            kind: 'finish',
            reason: response.status === 'incomplete'
              ? response.incomplete_details?.reason || 'incomplete' : response.status || 'completed'
          }
        ];
      }
      return [];
    }
    if (protocol === 'anthropic') {
      const type = data.type || parsed.event;
      if (type === 'content_block_delta' && data.delta?.type === 'text_delta' &&
          typeof data.delta.text === 'string') {
        return [{ kind: 'delta', text: data.delta.text }];
      }
      if (type === 'message_start') {
        return data.message?.usage ? [{ kind: 'usage', usage: data.message.usage }] : [];
      }
      if (type === 'message_delta') {
        return [
          ...(data.usage ? [{ kind: 'usage', usage: data.usage }] : []),
          ...(data.delta?.stop_reason
            ? [{ kind: 'finish', reason: data.delta.stop_reason }] : [])
        ];
      }
      if (type === 'message_stop') return [{ kind: 'done' }];
      return [];
    }
    if (protocol === 'gemini') {
      const candidate = data.candidates?.[0] || {};
      const text = (Array.isArray(candidate.content?.parts) ? candidate.content.parts : [])
        .map(part => typeof part?.text === 'string' ? part.text : '').join('');
      return [
        ...(text ? [{ kind: 'delta', text }] : []),
        ...(data.usageMetadata ? [{ kind: 'usage', usage: data.usageMetadata }] : []),
        ...(candidate.finishReason
          ? [{ kind: 'finish', reason: candidate.finishReason }] : [])
      ];
    }
    const choice = data.choices?.[0] || {};
    return [
      ...(publicProcess === 'deepseek-reasoning' && typeof choice.delta?.reasoning_content === 'string'
        ? [{ kind: 'public_reasoning', text: choice.delta.reasoning_content }] : []),
      ...(typeof choice.delta?.content === 'string' && choice.delta.content
        ? [{ kind: 'delta', text: choice.delta.content }] : []),
      ...(data.usage ? [{ kind: 'usage', usage: data.usage }] : []),
      ...(choice.finish_reason ? [{ kind: 'finish', reason: choice.finish_reason }] : [])
    ];
  }

  function nonStreamProtocolResult(protocol, data) {
    if (protocol === 'openai-responses') {
      const compatibleChoice = data?.choices?.[0] || {};
      if (typeof compatibleChoice.message?.content === 'string') {
        return {
          text: compatibleChoice.message.content,
          usage: data?.usage,
          finishReason: compatibleChoice.finish_reason || 'stop'
        };
      }
      let text = typeof data?.output_text === 'string' ? data.output_text : '';
      if (!text) {
        text = (Array.isArray(data?.output) ? data.output : []).flatMap(output =>
          Array.isArray(output?.content) ? output.content : []
        ).filter(item => item?.type === 'output_text')
          .map(item => String(item?.text || '')).join('');
      }
      return {
        text,
        usage: data?.usage,
        finishReason: data?.status === 'incomplete'
          ? data?.incomplete_details?.reason || 'incomplete' : data?.status || 'completed'
      };
    }
    if (protocol === 'anthropic') {
      return {
        text: (Array.isArray(data?.content) ? data.content : [])
          .filter(item => item?.type === 'text').map(item => String(item?.text || '')).join(''),
        usage: data?.usage,
        finishReason: data?.stop_reason || 'end_turn'
      };
    }
    if (protocol === 'gemini') {
      const candidate = data?.candidates?.[0] || {};
      return {
        text: (Array.isArray(candidate.content?.parts) ? candidate.content.parts : [])
          .map(item => String(item?.text || '')).join(''),
        usage: data?.usageMetadata,
        finishReason: candidate.finishReason || 'STOP'
      };
    }
    const choice = data?.choices?.[0] || {};
    return {
      text: typeof choice.message?.content === 'string' ? choice.message.content : '',
      usage: data?.usage,
      finishReason: choice.finish_reason || 'stop'
    };
  }

  function mergeStreamUsage(target, value) {
    if (!value || typeof value !== 'object') return false;
    Object.entries(value).forEach(([key, item]) => {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        target[key] = { ...(target[key] || {}), ...item };
      } else if (item !== undefined && item !== null) {
        target[key] = item;
      }
    });
    return true;
  }

  function normalizeStreamUsage(value = {}) {
    return {
      inputTokens: boundedUsageNumber(
        value.input_tokens ?? value.prompt_tokens ?? value.promptTokenCount
      ),
      outputTokens: boundedUsageNumber(
        value.output_tokens ?? value.completion_tokens ?? value.candidatesTokenCount
      ),
      reasoningTokens: boundedUsageNumber(
        value.output_tokens_details?.reasoning_tokens ??
        value.completion_tokens_details?.reasoning_tokens ?? value.thoughtsTokenCount
      ),
      cacheHitTokens: boundedUsageNumber(
        value.prompt_cache_hit_tokens ?? value.cache_read_input_tokens ??
        value.cached_content_token_count
      ),
      cacheMissTokens: boundedUsageNumber(value.prompt_cache_miss_tokens)
    };
  }

  function publicStreamError(error) {
    return {
      code: String(error?.code || 'NETWORK_ERROR').slice(0, 80),
      message: String(error?.message || 'Provider stream failed').slice(0, 240),
      retryable: error?.retryable === true,
      status: Math.max(0, Number(error?.status) || 0),
      retryAfterMs: Math.max(0, Number(error?.retryAfterMs) || 0),
      diagnosticStage: ['request', 'response-headers', 'response-body', 'parse']
        .includes(error?.diagnosticStage) ? error.diagnosticStage : '',
      diagnosticType: String(error?.diagnosticType || error?.name || '')
        .replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 80),
      requestBytes: Math.max(0, Math.min(1000000, Number(error?.requestBytes) || 0)),
      elapsedMs: Math.max(0, Math.min(600000, Number(error?.elapsedMs) || 0))
    };
  }

  function isTruncatedFinishReason(value) {
    return /^(?:length|max_tokens|max_output_tokens|MAX_TOKENS|incomplete)$/i
      .test(String(value || ''));
  }

  function createPublicProcessMapper() {
    const summaries = new Map();
    const notice = '\n[公开过程已截断]\n';
    let emittedChars = 0;
    let sealed = false;
    const clean = value => value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '');
    const slice = (value, limit) => {
      let result = value.slice(0, Math.max(0, limit));
      if (/[\uD800-\uDBFF]$/u.test(result)) result = result.slice(0, -1);
      return result;
    };
    const emit = (type, text, forceTruncate = false) => {
      if (sealed) return null;
      const available = Math.min(8192, 32768 - emittedChars);
      const truncated = forceTruncate || text.length > available - notice.length;
      const bounded = truncated ? slice(text, available - notice.length) + notice : text;
      if (truncated) sealed = true;
      if (!bounded.trim()) return null;
      emittedChars += bounded.length;
      return { type, visibility: 'public', text: bounded };
    };
    return item => {
      if (sealed) return null;
      if (item.kind === 'public_reasoning') return emit('public_reasoning_delta', clean(item.text));
      const data = item.data;
      if (typeof data.item_id !== 'string' || !data.item_id || data.item_id.length > 160 ||
          !Number.isSafeInteger(data.output_index) || data.output_index < 0 ||
          !Number.isSafeInteger(data.summary_index) || data.summary_index < 0 ||
          !Number.isSafeInteger(data.sequence_number) || data.sequence_number < 0) return null;
      const rawText = item.done ? data.text : data.delta;
      if (typeof rawText !== 'string') return null;
      const key = JSON.stringify([data.item_id, data.output_index, data.summary_index]);
      let state = summaries.get(key);
      if (!state) {
        if (summaries.size >= 8) return emit('public_summary', '', true);
        state = { sequence: -1, text: '', done: false, started: false };
        summaries.set(key, state);
      }
      if (state.done || data.sequence_number <= state.sequence) return null;
      state.sequence = data.sequence_number;
      const text = clean(rawText);
      const boundary = !state.started && emittedChars && text.trim() ? '\n\n' : '';
      if (item.done) {
        state.done = true;
        if (!state.text) return emit('public_summary', boundary + text);
        // Done contains the full summary. Recover only a proven missing suffix;
        // a mismatching snapshot must never be concatenated to streamed text.
        return text.startsWith(state.text) ? emit('public_reasoning_delta', text.slice(state.text.length)) : null;
      }
      const event = emit('public_reasoning_delta', boundary + text);
      if (event) {
        state.started = true;
        // Keep the provider prefix separate from UI part boundaries.
        if (!sealed) state.text += text;
      }
      return event;
    };
  }

  async function* createProviderTextStream({
    fetchImpl,
    url,
    options = {},
    protocol = 'openai-chat',
    publicProcess = '',
    providerId = '',
    model = '',
    request = {}
  } = {}) {
    yield { type: 'started', providerId: String(providerId), model: String(model) };
    const {
      signal: externalSignal,
      timeoutMs: requestedTimeout,
      ...fetchOptions
    } = options || {};
    const controller = new AbortController();
    let abortReason = '';
    const abort = reason => {
      if (abortReason || controller.signal.aborted) return;
      abortReason = reason;
      controller.abort();
    };
    const throwIfAborted = () => {
      if (!abortReason) return;
      const error = new Error('The operation was aborted');
      error.name = 'AbortError';
      throw error;
    };
    const forwardAbort = () => abort('cancelled');
    if (externalSignal?.aborted) forwardAbort();
    else {
      externalSignal?.addEventListener('abort', forwardAbort, { once: true });
      if (externalSignal?.aborted) forwardAbort();
    }
    const timeoutMs = Number.isFinite(Number(requestedTimeout))
      ? Math.max(1, Number(requestedTimeout)) : 240000;
    const timeout = setTimeout(() => {
      abort('timeout');
    }, timeoutMs);
    const startedAt = Date.now();
    const requestBytes = requestByteLength(fetchOptions.body);
    let responseStatus = 0;
    try {
      throwIfAborted();
      const transport = await openProviderTextTransport(fetchImpl, url, {
        ...fetchOptions,
        signal: controller.signal
      });
      if (abortReason) transport.close?.();
      throwIfAborted();
      responseStatus = transport.status;
      if (!transport.ok) {
        let responseBody = '';
        for await (const chunk of transport.chunks) {
          throwIfAborted();
          responseBody += chunk;
          if (responseBody.length >= 16 * 1024) break;
        }
        throwIfAborted();
        throw errorFromStatus(transport.status, {
          retryAfterMs: parseRetryAfter(transport.headers?.get?.('Retry-After')),
          responseBody: responseBody.slice(0, 16 * 1024),
          diagnosticStage: 'response-body',
          requestBytes,
          elapsedMs: Math.max(0, Date.now() - startedAt)
        });
      }

      const decoder = createSseFrameDecoder();
      let fallback = '';
      let sawSse = false;
      let sawText = false;
      let finishReason = '';
      let usageSeen = false;
      let actualModel = model;
      const usage = {};
      const mapPublicProcess = createPublicProcessMapper();
      let processFinished = false;
      const consume = function* consumeFrames(frames) {
        for (const frame of frames) {
          sawSse = true;
          fallback = '';
          const parsed = parseStreamJson(frame).data;
          const reportedModel = parsed?.model || parsed?.response?.model || parsed?.message?.model || parsed?.modelVersion;
          if (typeof reportedModel === 'string' && reportedModel.trim()) actualModel = reportedModel.slice(0, 160);
          for (const item of protocolEvents(protocol, frame, publicProcess)) {
            if (item.kind === 'delta') {
              const text = String(item.text || '');
              if (text.length > MAX_PROVIDER_STREAM_EVENT_CHARS) {
                throw new ProviderRequestError(
                  'INVALID_RESPONSE', 'Provider text delta exceeded the event limit'
                );
              }
              if (text) {
                sawText = true;
                yield { type: 'text_delta', text };
              }
            } else if (item.kind === 'public_summary' || item.kind === 'public_reasoning') {
              if (!processFinished) {
                const event = mapPublicProcess(item);
                if (event) yield event;
              }
            } else if (item.kind === 'usage') {
              usageSeen = mergeStreamUsage(usage, item.usage) || usageSeen;
            } else if (item.kind === 'finish') {
              processFinished = true;
              finishReason = String(item.reason || finishReason);
            } else if (item.kind === 'done') {
              processFinished = true;
            }
          }
        }
      };

      for await (const chunk of transport.chunks) {
        throwIfAborted();
        if (!sawSse) {
          fallback += chunk;
          if (fallback.length > MAX_NON_STREAM_FALLBACK_CHARS) {
            throw new ProviderRequestError(
              'INVALID_RESPONSE', 'Non-stream provider fallback exceeded the response limit'
            );
          }
        }
        for (const event of consume(decoder.push(chunk))) {
          throwIfAborted();
          yield event;
          throwIfAborted();
        }
      }
      throwIfAborted();
      for (const event of consume(decoder.finish())) {
        throwIfAborted();
        yield event;
        throwIfAborted();
      }

      if (!sawSse) {
        let data;
        try { data = JSON.parse(fallback.trim()); } catch {
          throw new ProviderRequestError('INVALID_RESPONSE', 'Provider returned invalid streaming JSON');
        }
        const result = nonStreamProtocolResult(protocol, data);
        actualModel = data?.model || data?.response?.model || data?.modelVersion || actualModel;
        const text = String(result.text || '');
        if (text.length > MAX_NON_STREAM_FALLBACK_CHARS) {
          throw new ProviderRequestError('INVALID_RESPONSE', 'Provider fallback text exceeded the limit');
        }
        if (text) {
          sawText = true;
          for (let offset = 0; offset < text.length; offset += MAX_PROVIDER_STREAM_EVENT_CHARS) {
            throwIfAborted();
            yield { type: 'text_delta', text: text.slice(offset, offset + MAX_PROVIDER_STREAM_EVENT_CHARS) };
            throwIfAborted();
          }
        }
        usageSeen = mergeStreamUsage(usage, result.usage) || usageSeen;
        finishReason = result.finishReason || finishReason;
      }

      if (!sawText) {
        throw new ProviderRequestError('INVALID_RESPONSE', 'Provider stream did not contain text');
      }
      throwIfAborted();
      emitProviderTelemetry(request, {
        providerId, model: actualModel, elapsedMs: Date.now() - startedAt,
        finishReason, usage
      });
      if (usageSeen) {
        throwIfAborted();
        yield { type: 'usage', usage: normalizeStreamUsage(usage) };
        throwIfAborted();
      }
      if (isTruncatedFinishReason(finishReason)) {
        throw new ProviderRequestError('OUTPUT_TRUNCATED', 'Model output reached its token limit');
      }
      if (finishReason === 'insufficient_system_resource') {
        throw new ProviderRequestError(
          'PROVIDER_UNAVAILABLE', 'Provider inference resources are temporarily unavailable',
          { retryable: true }
        );
      }
      throwIfAborted();
      yield { type: 'completed', finishReason: finishReason || 'stop' };
    } catch (error) {
      if (abortReason === 'cancelled') {
        yield { type: 'cancelled' };
      } else if (abortReason === 'timeout') {
        const timeoutError = new ProviderRequestError(
          'REQUEST_TIMEOUT', 'Provider request timed out', {
            status: responseStatus,
            retryable: true,
            diagnosticStage: responseStatus ? 'response-body' : 'request',
            requestBytes,
            elapsedMs: Math.max(0, Date.now() - startedAt)
          }
        );
        yield { type: 'error', error: publicStreamError(timeoutError) };
      } else if (error?.name === 'AbortError' || error?.code === 'CANCELLED') {
        yield { type: 'cancelled' };
      } else {
        const responseLimit = error?.name === 'ResponseLimitError' ||
          error?.code === 'RESPONSE_BODY_TOO_LARGE';
        const normalized = responseLimit
          ? new ProviderRequestError('INVALID_RESPONSE', RESPONSE_LIMIT_MESSAGE, {
              status: responseStatus,
              retryable: false,
              diagnosticStage: responseStatus ? 'response-body' : 'request',
              diagnosticType: 'ResponseLimitError',
              requestBytes,
              elapsedMs: Math.max(0, Date.now() - startedAt)
            })
          : error instanceof ProviderRequestError ? error : new ProviderRequestError(
          'NETWORK_ERROR', 'Unable to reach the provider', {
            status: responseStatus,
            retryable: true,
            diagnosticStage: responseStatus ? 'response-body' : 'request',
            diagnosticType: error?.name || 'Error',
            requestBytes,
            elapsedMs: Math.max(0, Date.now() - startedAt)
          }
        );
        yield { type: 'error', error: publicStreamError(normalized) };
      }
    } finally {
      clearTimeout(timeout);
      externalSignal?.removeEventListener('abort', forwardAbort);
    }
  }

  function parseSseContent(value) {
    const content = [];
    let sawEvent = false;
    let finishReason = '';
    for (const rawLine of String(value || '').split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith(':') || !line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      sawEvent = true;
      let event;
      try {
        event = JSON.parse(payload);
      } catch {
        throw new ProviderRequestError('INVALID_RESPONSE', 'Provider returned malformed streaming data');
      }
      const delta = event?.choices?.[0]?.delta?.content;
      if (typeof delta === 'string') content.push(delta);
      if (event?.choices?.[0]?.finish_reason) {
        finishReason = String(event.choices[0].finish_reason);
      }
    }
    if (finishReason === 'length') {
      throw new ProviderRequestError('OUTPUT_TRUNCATED', 'Model output reached its token limit');
    }
    if (finishReason === 'insufficient_system_resource') {
      throw new ProviderRequestError(
        'PROVIDER_UNAVAILABLE', 'Provider inference resources are temporarily unavailable',
        { retryable: true }
      );
    }
    const joined = content.join('');
    if (!sawEvent || !joined.trim()) {
      throw new ProviderRequestError(
        'INVALID_RESPONSE',
        'DeepSeek returned empty streaming content',
        { retryable: true,
          ...(sawEvent && finishReason === 'stop'
            ? { diagnosticStage: 'provider-completion', diagnosticType: 'empty_json_content' }
            : {}) }
      );
    }
    return joined;
  }

  function readSseCompletionMetadata(value) {
    let model = '', finishReason = '', usage;
    for (const line of String(value || '').split(/\r?\n/u)) {
      if (!line.trim().startsWith('data:')) continue;
      let data;
      try { data = JSON.parse(line.trim().slice(5).trim()); } catch { continue; }
      if (typeof data?.model === 'string') model = data.model.slice(0, 160);
      if (typeof data?.choices?.[0]?.finish_reason === 'string') finishReason = data.choices[0].finish_reason;
      if (data?.usage && typeof data.usage === 'object') usage = data.usage;
    }
    return { model, finishReason, usage };
  }

  async function requestSseJson(fetchImpl, url, options) {
    return parseJsonText(parseSseContent(await requestText(fetchImpl, url, options)));
  }

  function getJsonFormatFailureContext(error, request = null) {
    const context = JSON_FORMAT_FAILURE_CONTEXTS.get(error);
    if (!context) return null;
    const result = { text: context.text, diagnostic: { ...context.diagnostic } };
    const partial = context.partialFigureClosure;
    // One-shot private projection of this exact request; generic format repair
    // callers and copied/externally decorated Errors cannot inject Panel data.
    if (request && partial?.request === request && partial.signature === JSON.stringify(request)) {
      result.partialFigureClosure = partial.candidate;
      delete context.partialFigureClosure;
    }
    return result;
  }

  // Measurement belongs to one completed response/error, never to a shared
  // telemetry slot. Unchanged vision payloads are already covered by it.
  function estimateJsonFormatRepairInputTokens(error, input = {}) {
    const context = JSON_FORMAT_FAILURE_CONTEXTS.get(error);
    const measurement = context?.inputMeasurement;
    if (!measurement || input.model !== measurement.model ||
        JSON.stringify(input.originalMessages) !== measurement.messagesJson) return null;
    const original = input.originalMessages, repaired = input.repairedMessages;
    if (!Array.isArray(original) || !Array.isArray(repaired) || original.length !== 2 || repaired.length !== 2 ||
        original[0]?.role !== 'system' || repaired[0]?.role !== 'system' ||
        original[1]?.role !== 'user' || repaired[1]?.role !== 'user') return null;
    const originalSystem = original[0].content, repairedSystem = repaired[0].content;
    if (typeof originalSystem !== 'string' || typeof repairedSystem !== 'string') return null;
    const schemaMarker = '\nThe response must satisfy this JSON schema exactly.\nRESPONSE_JSON_SCHEMA=';
    const schemaAt = originalSystem.indexOf(schemaMarker);
    if (schemaAt < 0 || repairedSystem.slice(repairedSystem.indexOf(schemaMarker)) !== originalSystem.slice(schemaAt)) return null;
    const oldParts = original[1].content, newParts = repaired[1].content;
    let oldText, newText;
    if (typeof oldParts === 'string' && typeof newParts === 'string') {
      oldText = oldParts; newText = newParts;
    } else if (Array.isArray(oldParts) && Array.isArray(newParts) && oldParts.length === newParts.length &&
        oldParts[0]?.type === 'text' && newParts[0]?.type === 'text' &&
        JSON.stringify(oldParts.slice(1)) === JSON.stringify(newParts.slice(1))) {
      oldText = oldParts[0].text; newText = newParts[0].text;
    } else return null;
    if (typeof oldText !== 'string' || typeof newText !== 'string') return null;
    try {
      const oldData = JSON.parse(oldText), newData = JSON.parse(newText);
      if (Object.hasOwn(oldData, 'format_repair') ||
          JSON.stringify(newData.format_repair) !== JSON.stringify({ previous_response: context.text, diagnostic: context.diagnostic })) return null;
      delete newData.format_repair;
      if (JSON.stringify(oldData) !== JSON.stringify(newData)) return null;
    } catch (_) { return null; }
    function insertedByteEstimate(before, after) {
      // Count serialized escapes too. Permit additions only; a replacement,
      // dropped source, or changed schema cannot borrow the measured baseline.
      before = JSON.stringify(before); after = JSON.stringify(after);
      let prefix = 0;
      while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++;
      let suffix = 0;
      while (suffix < before.length - prefix && suffix < after.length - prefix &&
          before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++;
      if (prefix + suffix !== before.length) return null;
      const inserted = after.slice(prefix, after.length - suffix);
      // One token per UTF-8 byte is deliberately conservative for new text.
      // Keep an additional boundary allowance rather than assuming token
      // counts are perfectly additive across an insertion.
      return inserted ? requestByteLength(inserted) + 256 : 0;
    }
    const systemDelta = insertedByteEstimate(originalSystem, repairedSystem);
    const userDelta = insertedByteEstimate(oldText, newText);
    if (systemDelta === null || userDelta === null) return null;
    const tokens = measurement.promptTokens + systemDelta + userDelta;
    return Number.isSafeInteger(tokens) ? tokens : null;
  }

  // A Figure-only candidate, never a generic JSON repair or validation bypass.
  // The private input measurement is captured by DeepSeek only after its stop
  // completion guard. Bind that actual error to the same user payload/schema.
  function recoverFigureGroupClosure(error, request = {}, binding = {}) {
    const context = JSON_FORMAT_FAILURE_CONTEXTS.get(error);
    if (context) delete context.partialFigureClosure;
    if (error?.code !== 'INVALID_RESPONSE' || error.diagnosticStage !== 'provider-completion' ||
        error.figureOwnerGuardFailure === true || !['figure_walkthrough_standard', 'figure_synthesis_standard'].includes(request.schemaName) ||
        !context?.inputMeasurement || typeof context.originalText !== 'string' ||
        binding.model !== context.inputMeasurement.model ||
        JSON.stringify(binding.messages) !== context.inputMeasurement.messagesJson) return null;
    try {
      const messages = JSON.parse(context.inputMeasurement.messagesJson);
      if (messages.length !== 2 || messages[0]?.role !== 'system' || messages[1]?.role !== 'user' ||
          JSON.stringify(messages[1].content) !== JSON.stringify(openAIChatUserContent(request.userPrompt, request.images)) ||
          !messages[0].content.includes('\nRESPONSE_JSON_SCHEMA=' + JSON.stringify(request.responseSchema) + '\nJSON_OUTPUT_EXAMPLE=')) return null;
      const input = JSON.parse(request.userPrompt);
      if (input.analysis_depth !== 'standard' || typeof input.figure_id !== 'string' || !input.figure_id) return null;
      const text = context.originalText, tokens = [];
      // Lex strings before punctuation; escaped braces/keys remain string data.
      for (let at = 0; at < text.length;) {
        if (/[\x20\t\r\n]/u.test(text[at])) { at++; continue; }
        const start = at, c = text[at];
        if ('{}[],:'.includes(c)) { tokens.push({ value: c, at: at++ }); continue; }
        if (c === '"') {
          at++;
          let closed = false;
          while (at < text.length) {
            if (text[at] === '\\') { at += 2; continue; }
            if (text[at++] === '"') { closed = true; break; }
          }
          if (!closed) return null;
          tokens.push({ kind: 'string', value: JSON.parse(text.slice(start, at)), at: start, end: at });
          continue;
        }
        const match = /^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/u.exec(text.slice(at));
        if (!match) return null;
        const value = JSON.parse(match[0]);
        if (typeof value === 'number' && !Number.isFinite(value)) return null;
        tokens.push({ kind: 'primitive', value, at }); at += match[0].length;
      }
      let cursor = 0; const insertions = [], basisRemovals = [], rootEdits = [], rootFieldRepairs = [];
      const rootTextKeys = ['figure_title_zh', 'figure_question_zh', 'remaining_question_zh'];
      let titleCopy;
      const allowBasisRemoval = request.schemaName === 'figure_synthesis_standard' &&
        input.pass === 'figure_synthesis' && ['vision_text', 'caption_context'].includes(input.analysis_basis);
      const is = value => tokens[cursor]?.value === value && !tokens[cursor]?.kind;
      const invalid = () => { throw new Error('Invalid Figure closure candidate'); };
      function parse(path, depth = 0) {
        if (depth > 32 || !tokens[cursor]) return invalid();
        if (tokens[cursor].kind) { const token = tokens[cursor++]; return { kind: 'scalar', value: token.value, at: token.at, end: token.end }; }
        if (is('[')) {
          cursor++; let count = 0;
          if (!is(']')) for (;;) {
            parse([...path, count++], depth + 1);
            if (is(']')) break;
            if (!is(',')) return invalid();
            cursor++;
          }
          cursor++; return { kind: 'array', closed: true };
        }
        if (!is('{')) return invalid();
        cursor++; const keys = new Set(), firstTexts = new Map(); let lastKey, lastValue, precedingComma, firstBasis;
        if (!is('}')) for (;;) {
          const key = tokens[cursor++];
          // Compare decoded names, including escaped Unicode spellings.
          if (key?.kind !== 'string' || !is(':')) return invalid();
          const duplicate = keys.has(key.value);
          if (duplicate && !(allowBasisRemoval && path.length === 0 &&
              (key.value === 'basis' || rootTextKeys.includes(key.value)))) return invalid();
          keys.add(key.value); lastKey = key.value; cursor++;
          lastValue = parse([...path, key.value], depth + 1);
          if (path.length === 0 && key.value === 'basis') {
            if (duplicate) {
              if (!firstBasis || firstBasis.value !== input.analysis_basis || lastValue.kind !== 'scalar' ||
                  lastValue.value !== input.analysis_basis || !Number.isSafeInteger(precedingComma) || basisRemovals.length >= 8) return invalid();
              basisRemovals.push({ offset: precedingComma, end: lastValue.end, path: ['basis'],
                keyOffset: key.at, firstKeyOffset: firstBasis.keyOffset,
                originalValue: lastValue.value, expectedValue: input.analysis_basis });
            } else firstBasis = { value: lastValue.value, keyOffset: key.at };
          }
          if (path.length === 0 && rootTextKeys.includes(key.value)) {
            if (duplicate) {
              const first = firstTexts.get(key.value);
              if (typeof first?.value !== 'string' || lastValue.kind !== 'scalar' || typeof lastValue.value !== 'string' ||
                  !Number.isSafeInteger(precedingComma) ||
                  (key.value !== 'figure_title_zh' && first.value !== lastValue.value)) return invalid();
              rootEdits.push({ offset: precedingComma, end: lastValue.end, replacement: '' });
              rootFieldRepairs.push({ field: key.value, action: 'remove_redundant_member', count: 1 });
              // Keep the original member location; its value token is copied
              // verbatim from the last title, without generating display text.
              if (key.value === 'figure_title_zh') titleCopy = { offset: first.at, end: first.end,
                replacement: text.slice(lastValue.at, lastValue.end) };
            } else firstTexts.set(key.value, lastValue);
          }
          if (basisRemovals.length + rootEdits.length > 8) return invalid();
          if (is('}')) break;
          const nextGroup = is(',') && tokens[cursor + 1]?.value === '{' && !tokens[cursor + 1]?.kind;
          const finalGroup = is(']') && tokens[cursor + 1]?.value === ',' && !tokens[cursor + 1]?.kind &&
            tokens[cursor + 2]?.kind === 'string' && tokens[cursor + 2].value === 'logic_bridges' &&
            tokens[cursor + 3]?.value === ':' && !tokens[cursor + 3]?.kind;
          // At this typed boundary an object cannot consume either token as
          // its next member. Close only this complete group, never its data.
          if ((nextGroup || finalGroup) && path.length === 2 && path[0] === 'panel_groups' &&
              Number.isSafeInteger(path[1]) && lastKey === 'grouping_basis' && lastValue?.closed === true &&
              lastValue.lastKey === 'source_refs' && lastValue.lastValue?.kind === 'array' && lastValue.lastValue.closed === true) {
            if (insertions.length >= 8) return invalid();
            insertions.push({ offset: tokens[cursor].at, path: [...path], character: '}',
              boundary: nextGroup ? 'next_group' : 'logic_bridges' });
            return { kind: 'object', closed: true, lastKey, lastValue };
          }
          if (!is(',')) return invalid();
          precedingComma = tokens[cursor].at;
          cursor++;
        }
        cursor++; return { kind: 'object', closed: true, lastKey, lastValue };
      }
      const root = parse([]);
      if (titleCopy && text.slice(titleCopy.offset, titleCopy.end) !== titleCopy.replacement) {
        rootEdits.push(titleCopy);
        rootFieldRepairs.push({ field: 'figure_title_zh', action: 'copy_last_text', count: 1 });
      }
      if (root.kind !== 'object' || !root.closed || cursor !== tokens.length ||
          basisRemovals.length + rootEdits.length > 8 || !(insertions.length + basisRemovals.length + rootEdits.length)) return null;
      let repairedText = text;
      const edits = [...insertions.map(item => ({ offset: item.offset, end: item.offset, replacement: '}' })),
        ...basisRemovals.map(item => ({ ...item, replacement: '' })), ...rootEdits].sort((a, b) => b.offset - a.offset);
      for (const edit of edits) {
        repairedText = repairedText.slice(0, edit.offset) + edit.replacement + repairedText.slice(edit.end);
      }
      const value = JSON.parse(repairedText);
      // This is the exact captured request schema. Do not project, coerce,
      // default or trim a closure candidate into a schema-valid object.
      function matchesSchema(value, schema) {
        const allowed = ['type', 'additionalProperties', 'properties', 'required', 'enum', 'items',
          'minItems', 'maxItems', 'minLength', 'maxLength'];
        if (!schema || Object.keys(schema).some(key => !allowed.includes(key))) return false;
        if (schema.enum && !schema.enum.includes(value)) return false;
        if (schema.type === 'string') return typeof value === 'string' &&
          (schema.minLength === undefined || [...value].length >= schema.minLength) &&
          (schema.maxLength === undefined || [...value].length <= schema.maxLength);
        if (schema.type === 'array') return Array.isArray(value) &&
          (schema.minItems === undefined || value.length >= schema.minItems) &&
          (schema.maxItems === undefined || value.length <= schema.maxItems) &&
          value.every(item => matchesSchema(item, schema.items));
        if (schema.type !== 'object' || !value || typeof value !== 'object' || Array.isArray(value)) return false;
        return (schema.required || []).every(key => Object.hasOwn(value, key)) &&
          Object.keys(value).every(key => Object.hasOwn(schema.properties || {}, key)
            ? matchesSchema(value[key], schema.properties[key]) : schema.additionalProperties !== false);
      }
      if (value.figure_id !== input.figure_id || value.analysis_depth !== 'standard') return null;
      if (rootEdits.length && value.basis !== input.analysis_basis) return null;
      const candidate = { value, originalText: text, repairedText, insertions,
        offset: edits.at(-1).offset, kind: rootEdits.length ? 'figure_synthesis_root_text_recovered' :
          basisRemovals.length ? 'figure_synthesis_basis_redundancy_removed' : 'figure_group_closure_inserted',
        count: insertions.length + basisRemovals.length + rootEdits.length,
        ...(basisRemovals.length ? { basisRemovals } : {}), ...(rootFieldRepairs.length ? { rootFieldRepairs } : {}) };
      if (['figure_walkthrough_standard', 'figure_synthesis_standard'].includes(request.schemaName) && value.basis === input.analysis_basis) {
        // This never admits a Figure. Whole responses may salvage independent
        // Panels; synthesis candidates still need bounded root projection and
        // the router's complete strict scientific validation.
        context.partialFigureClosure = { request, signature: JSON.stringify(request), candidate };
      }
      if (!matchesSchema(value, request.responseSchema)) return null;
      return candidate;
    } catch (_) { return null; }
  }

  // Notes cannot silently choose between duplicate field/map keys. Walk only
  // already-valid note JSON; quoted braces/escaped keys are decoded correctly.
  function assertUniqueNoteJsonKeys(text, parsed, allObjects = false) {
    const note = parsed && typeof parsed === 'object' && !Array.isArray(parsed) &&
      ['values', 'statuses', 'sources'].every(key => Object.hasOwn(parsed, key));
    if (!parsed || typeof parsed !== 'object' || (!allObjects && !note)) return;
    const label = note ? 'Note' : 'Structured';
    const stack = [];
    for (let at = 0; at < text.length;) {
      const c = text[at++];
      if (c === '{' || c === '[') {
        stack.push(c === '{' ? { keys: new Set(), key: true } : null);
        if (stack.length > 32) throw new ProviderRequestError('INVALID_RESPONSE', `${label} JSON nesting exceeded its limit`);
      } else if (c === '}' || c === ']') stack.pop();
      else if (c === ',') { const top = stack.at(-1); if (top) top.key = true; }
      else if (c === '"') {
        const start = at - 1;
        while (at < text.length) {
          if (text[at] === '\\') { at += 2; continue; }
          if (text[at++] === '"') break;
        }
        const top = stack.at(-1);
        if (top?.key) {
          const key = JSON.parse(text.slice(start, at));
          if (top.keys.has(key)) throw new ProviderRequestError('INVALID_RESPONSE', `${label} JSON contains duplicate keys`,
            { diagnosticType: note ? 'duplicate_note_key' : 'duplicate_json_key' });
          top.keys.add(key); top.key = false;
        }
      }
    }
  }

  function parseJsonText(value, options = {}) {
    if (options.strictJson === true) {
      if (typeof value !== 'string') {
        throw new ProviderRequestError('INVALID_RESPONSE', 'Structured model output must be JSON text');
      }
      let parsed;
      try { parsed = JSON.parse(value); }
      catch (_) { throw new ProviderRequestError('INVALID_RESPONSE', 'Structured model output was not one complete JSON value'); }
      assertUniqueNoteJsonKeys(value, parsed, true);
      return parsed;
    }
    let text = String(value || '').trim();
    text = text
      .replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, '')
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    function balancedObjects(input) {
      const values = [];
      let start = -1;
      let depth = 0;
      let inString = false;
      let escaped = false;
      for (let index = 0; index < input.length; index += 1) {
        const character = input[index];
        if (inString) {
          if (escaped) escaped = false;
          else if (character === '\\') escaped = true;
          else if (character === '"') inString = false;
          continue;
        }
        if (character === '"') {
          inString = true;
          continue;
        }
        if (character === '{') {
          if (depth === 0) start = index;
          depth += 1;
        } else if (character === '}' && depth > 0) {
          depth -= 1;
          if (depth === 0 && start >= 0) {
            values.push(input.slice(start, index + 1));
            start = -1;
          }
        }
      }
      return values;
    }

    function escapeStringControls(input) {
      let output = '';
      let inString = false;
      let escaped = false;
      for (const character of input) {
        if (inString && !escaped) {
          if (character === '\n') { output += '\\n'; continue; }
          if (character === '\r') { output += '\\r'; continue; }
          if (character === '\t') { output += '\\t'; continue; }
        }
        output += character;
        if (!inString && character === '"') inString = true;
        else if (inString && escaped) escaped = false;
        else if (inString && character === '\\') escaped = true;
        else if (inString && character === '"') inString = false;
      }
      return output;
    }

    const measuredInput = options.formatFailureInput;
    const inputMeasurement = measuredInput && typeof measuredInput.model === 'string' && measuredInput.model &&
        typeof measuredInput.messagesJson === 'string' && Number.isSafeInteger(measuredInput.promptTokens) && measuredInput.promptTokens > 0
      ? { model: measuredInput.model, messagesJson: measuredInput.messagesJson, promptTokens: measuredInput.promptTokens } : null;
    let measuredSynthesis = false;
    if (options.captureFormatFailure === true && inputMeasurement) try {
      const messages = JSON.parse(inputMeasurement.messagesJson);
      const content = messages[1]?.content;
      const prompt = typeof content === 'string' ? content : content?.find(item => item.type === 'text')?.text;
      const input = JSON.parse(prompt);
      measuredSynthesis = messages.length === 2 && messages[0]?.role === 'system' && messages[1]?.role === 'user' &&
        messages[0].content.includes('\nRESPONSE_JSON_SCHEMA=') && input.pass === 'figure_synthesis' &&
        input.analysis_depth === 'standard' && typeof input.figure_id === 'string' && !!input.figure_id &&
        ['vision_text', 'caption_context'].includes(input.analysis_basis) && Array.isArray(input.panel_evidence);
    } catch (_) { /* Missing measured synthesis identity cannot enable private capture. */ }
    let duplicateError;
    const candidates = [...new Set([text, ...balancedObjects(text)].filter(Boolean))];
    candidateLoop: for (const candidate of candidates) {
      const repairs = [...new Set([
        candidate,
        candidate.replace(/,\s*([}\]])/g, '$1'),
        escapeStringControls(candidate),
        escapeStringControls(candidate).replace(/,\s*([}\]])/g, '$1')
      ])];
      for (const repaired of repairs) {
        try {
          const parsed = JSON.parse(repaired);
          assertUniqueNoteJsonKeys(repaired, parsed, measuredSynthesis);
          if (typeof parsed === 'string') {
            try {
              const inner = JSON.parse(parsed); assertUniqueNoteJsonKeys(parsed, inner, measuredSynthesis); return inner;
            } catch (error) { if (error?.code === 'INVALID_RESPONSE') throw error; /* Try the next candidate. */ }
          } else {
            return parsed;
          }
        } catch (error) {
          if (error?.code === 'INVALID_RESPONSE') {
            if (!measuredSynthesis) throw error;
            duplicateError = error; break candidateLoop;
          }
          // Keep checking bounded, deterministic repairs.
        }
      }
    }
    const error = duplicateError || new ProviderRequestError('INVALID_RESPONSE', 'Model output was not valid annotation JSON');
    if (options.captureFormatFailure === true && text.length <= MAX_JSON_FORMAT_FAILURE_CHARS) {
      let offset = null;
      try { JSON.parse(text); } catch (syntaxError) {
        // Retain only the numeric offset, not engine messages with text excerpts.
        const match = /\bposition (\d+)\b/u.exec(String(syntaxError?.message || ''));
        if (match && Number(match[1]) <= text.length) offset = Number(match[1]);
      }
      JSON_FORMAT_FAILURE_CONTEXTS.set(error, { text, inputMeasurement,
        originalText: typeof value === 'string' && value.length <= MAX_JSON_FORMAT_FAILURE_CHARS ? value : null, diagnostic: {
        kind: duplicateError ? 'duplicate_json_key' : 'invalid_json', offset, offsetUnit: 'utf16', sourceLength: text.length
      } });
    }
    throw error;
  }

  function splitDataUrl(value) {
    const text = String(value || '').trim();
    const match = text.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=\s]+)$/i);
    if (!match) return null;
    const mediaType = match[1].toLowerCase();
    const data = match[2].replace(/\s+/g, '');
    if (!data) return null;
    return { mediaType, data, dataUrl: 'data:' + mediaType + ';base64,' + data };
  }

  function normalizeImageInputs(values, options = {}) {
    const maxImages = Math.max(0, Math.min(4, Number(options.maxImages) || 4));
    const maxBytes = Math.max(
      1024,
      Math.min(4 * 1024 * 1024, Number(options.maxBytes) || 2 * 1024 * 1024)
    );
    const images = [];
    for (const value of Array.isArray(values) ? values : []) {
      const parsed = splitDataUrl(value?.dataUrl || value);
      if (!parsed) continue;
      const estimatedBytes = Math.floor(parsed.data.length * 3 / 4);
      if (estimatedBytes > maxBytes) continue;
      images.push(parsed);
      if (images.length >= maxImages) break;
    }
    return images;
  }

  function openAIChatUserContent(text, images) {
    const normalized = normalizeImageInputs(images);
    if (!normalized.length) return String(text || '');
    return [
      { type: 'text', text: String(text || '') },
      ...normalized.map(image => ({
        type: 'image_url',
        image_url: { url: image.dataUrl }
      }))
    ];
  }

  function createAnnotationSchema(categoryIds) {
    return {
      type: 'object',
      additionalProperties: false,
      properties: {
        chunk_id: { type: 'string' },
        paragraphs_reviewed: { type: 'array', items: { type: 'string' } },
        annotations: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              paragraph_id: { type: 'string' },
              quote: { type: 'string' },
              occurrence: { type: 'integer', minimum: 0 },
              category_id: { type: 'string', enum: categoryIds },
              confidence: { type: 'number', minimum: 0, maximum: 1 },
              reason_zh: { type: 'string' }
            },
            required: ['paragraph_id', 'quote', 'occurrence', 'category_id', 'confidence', 'reason_zh']
          }
        }
      },
      required: ['chunk_id', 'paragraphs_reviewed', 'annotations']
    };
  }

  function createAnnotationSchemaV3(categoryIds) {
    return {
      type: 'object',
      additionalProperties: false,
      properties: {
        chunk_id: { type: 'string' },
        paragraphs_reviewed: { type: 'array', items: { type: 'string' } },
        annotations: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              annotation_id: { type: 'string' },
              relation_id: { type: 'string' },
              category_id: { type: 'string', enum: categoryIds },
              claim_mode: { type: 'string', enum: ['explicit', 'inferred'] },
              highlight_quotes: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    paragraph_id: { type: 'string' },
                    quote: { type: 'string' },
                    occurrence: { type: 'integer', minimum: 0 },
                    role: { type: 'string' }
                  },
                  required: ['paragraph_id', 'quote', 'occurrence', 'role']
                }
              },
              slots: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    name: { type: 'string' },
                    value: { type: 'string' }
                  },
                  required: ['name', 'value']
                }
              },
              confidence: { type: 'number', minimum: 0, maximum: 1 },
              reason_zh: { type: 'string' }
            },
            required: [
              'annotation_id', 'relation_id', 'category_id', 'claim_mode',
              'highlight_quotes', 'slots', 'confidence', 'reason_zh'
            ]
          }
        }
      },
      required: ['chunk_id', 'paragraphs_reviewed', 'annotations']
    };
  }

  function withStructuredSchemaPrompt(request) {
    if (!request?.responseSchema || request.schemaName === 'scientific_annotations') {
      return String(request?.systemPrompt || '');
    }
    function exampleFor(schema, depth = 0) {
      if (!schema || depth > 12) return null;
      if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
      if (schema.type === 'string') return '';
      if (schema.type === 'integer' || schema.type === 'number') return 0;
      if (schema.type === 'boolean') return false;
      if (schema.type === 'array') return [exampleFor(schema.items, depth + 1)];
      if (schema.type === 'object') {
        const properties = schema.properties || {};
        const keys = Array.isArray(schema.required) ? schema.required : Object.keys(properties);
        return Object.fromEntries(keys
          .filter(key => Object.prototype.hasOwnProperty.call(properties, key))
          .map(key => [key, exampleFor(properties[key], depth + 1)]));
      }
      return null;
    }
    return [
      String(request.systemPrompt || ''),
      'The response must satisfy this JSON schema exactly.',
      `RESPONSE_JSON_SCHEMA=${JSON.stringify(request.responseSchema)}`,
      `JSON_OUTPUT_EXAMPLE=${JSON.stringify(exampleFor(request.responseSchema))}`
    ].join('\n');
  }

  function joinEndpoint(baseUrl, suffix) {
    const base = String(baseUrl || '').replace(/\/+$/, '');
    if (base.endsWith(suffix)) return base;
    return `${base}${suffix}`;
  }

  return {
    MAX_NON_STREAM_RESPONSE_BYTES,
    ProviderRequestError,
    getProviderTransportLease,
    parseRetryAfter,
    requestText,
    requestJson,
    createProviderTextStream,
    normalizeStreamUsage,
    publicStreamError,
    requestSseJson,
    parseSseContent,
    readSseCompletionMetadata,
    parseJsonText,
    getJsonFormatFailureContext,
    recoverFigureGroupClosure,
    estimateJsonFormatRepairInputTokens,
    normalizeOutputTokenLimit,
    emitProviderTelemetry,
    splitDataUrl,
    normalizeImageInputs,
    openAIChatUserContent,
    createAnnotationSchema,
    createAnnotationSchemaV3,
    withStructuredSchemaPrompt,
    joinEndpoint
  };
});
