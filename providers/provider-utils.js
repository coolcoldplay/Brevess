(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  class ProviderRequestError extends Error {
    constructor(code, message, options = {}) {
      super(message);
      this.name = 'ProviderRequestError';
      this.code = code;
      this.status = options.status || 0;
      this.retryable = Boolean(options.retryable);
      this.diagnosticStage = options.diagnosticStage || '';
      this.diagnosticType = options.diagnosticType || '';
      this.requestBytes = Number.isFinite(options.requestBytes) ? options.requestBytes : 0;
      this.elapsedMs = Number.isFinite(options.elapsedMs) ? options.elapsedMs : 0;
      this.retryAfterMs = Number.isFinite(options.retryAfterMs)
        ? Math.max(0, Math.min(300000, options.retryAfterMs)) : 0;
      this.suggestedMaxOutputTokens = Number.isFinite(options.suggestedMaxOutputTokens)
        ? Math.max(512, Math.min(65536, Math.round(options.suggestedMaxOutputTokens))) : undefined;
    }
  }

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
      if (Number.isFinite(suggested) && suggested >= 512 && suggested <= 65536) return Math.round(suggested);
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

  async function readBoundedErrorBody(response, maximumBytes = 16 * 1024) {
    if (!response?.body?.getReader) {
      const declaredBytes = Number(response?.headers?.get?.('Content-Length'));
      if (Number.isFinite(declaredBytes) && declaredBytes > maximumBytes) return '';
      try { return String(await response.text()).slice(0, maximumBytes); } catch { return ''; }
    }
    let reader;
    let bytesRead = 0;
    let text = '';
    try {
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      while (bytesRead < maximumBytes) {
        const item = await reader.read();
        if (item.done) break;
        const bytes = item.value instanceof Uint8Array ? item.value : new Uint8Array(item.value || []);
        const allowed = Math.min(bytes.length, maximumBytes - bytesRead);
        text += decoder.decode(bytes.subarray(0, allowed), { stream: true });
        bytesRead += allowed;
      }
      text += decoder.decode();
      return text;
    } catch {
      return '';
    } finally {
      try { await reader?.cancel?.(); } catch { /* Preserve the HTTP status error. */ }
      try { reader?.releaseLock?.(); } catch { /* Preserve the HTTP status error. */ }
    }
  }

  function requestByteLength(body) {
    if (typeof body !== 'string') return 0;
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(body).length;
    return unescape(encodeURIComponent(body)).length;
  }

  function normalizeOutputTokenLimit(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && Number.isInteger(numeric) && numeric > 0 && numeric <= 65536
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
    const event = {
      providerId: String(value.providerId || ''),
      model: String(value.model || '').slice(0, 160),
      elapsedMs: boundedUsageNumber(value.elapsedMs),
      finishReason: String(value.finishReason || '').slice(0, 80),
      inputTokens: boundedUsageNumber(
        usage.input_tokens ?? usage.prompt_tokens ?? usage.promptTokenCount
      ),
      outputTokens: boundedUsageNumber(
        usage.output_tokens ?? usage.completion_tokens ?? usage.candidatesTokenCount
      ),
      reasoningTokens: boundedUsageNumber(
        usage.output_tokens_details?.reasoning_tokens ??
        usage.completion_tokens_details?.reasoning_tokens ??
        usage.thoughtsTokenCount
      ),
      cacheHitTokens: boundedUsageNumber(
        usage.prompt_cache_hit_tokens ?? usage.cache_read_input_tokens
      ),
      cacheMissTokens: boundedUsageNumber(usage.prompt_cache_miss_tokens)
    };
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
    let timedOut = false;
    const forwardAbort = () => controller.abort();
    if (externalSignal?.aborted) controller.abort();
    else externalSignal?.addEventListener('abort', forwardAbort, { once: true });
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const startedAt = Date.now();
    const requestBytes = requestByteLength(fetchOptions.body);
    let diagnosticStage = 'request';
    let responseStatus = 0;
    let text;
    try {
      const response = await fetchImpl(url, { ...fetchOptions, signal: controller.signal });
      responseStatus = Number(response.status) || 0;
      if (!response.ok) {
        const retryAfterMs = parseRetryAfter(response.headers?.get?.('Retry-After'));
        let responseBody = '';
        if (response.status === 400) {
          diagnosticStage = 'response-body';
          responseBody = await readBoundedErrorBody(response);
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
      text = await response.text();
    } catch (error) {
      if (error instanceof ProviderRequestError) throw error;
      const diagnostics = {
        status: responseStatus,
        retryable: true,
        diagnosticStage,
        diagnosticType: error?.name || 'Error',
        requestBytes,
        elapsedMs: Math.max(0, Date.now() - startedAt)
      };
      if (error?.name === 'AbortError') {
        if (timedOut) {
          throw new ProviderRequestError('REQUEST_TIMEOUT', 'Provider request timed out', diagnostics);
        }
        throw new ProviderRequestError('CANCELLED', 'Provider request was cancelled', {
          ...diagnostics,
          retryable: false
        });
      }
      throw new ProviderRequestError('NETWORK_ERROR', 'Unable to reach the provider', diagnostics);
    } finally {
      clearTimeout(timeout);
      externalSignal?.removeEventListener('abort', forwardAbort);
    }
    return returnMetadata ? { text, status: responseStatus } : text;
  }

  async function requestJson(fetchImpl, url, options) {
    const startedAt = Date.now();
    const requestBytes = requestByteLength(options?.body);
    const response = await requestText(fetchImpl, url, { ...options, _returnMetadata: true });
    try {
      return JSON.parse(response.text);
    } catch {
      throw new ProviderRequestError('INVALID_RESPONSE', 'Provider returned invalid JSON', {
        status: response.status,
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
    if (!response?.body?.getReader) {
      const body = String(await response.text());
      for (let offset = 0; offset < body.length; offset += MAX_PROVIDER_STREAM_EVENT_CHARS) {
        yield body.slice(offset, offset + MAX_PROVIDER_STREAM_EVENT_CHARS);
      }
      return;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
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
        try { await reader.cancel?.(); } catch { /* Preserve the provider result. */ }
      }
      try { reader.releaseLock?.(); } catch { /* Preserve the provider result. */ }
    }
  }

  async function openProviderTextTransport(fetchImpl, url, fetchOptions) {
    if (typeof fetchImpl?.stream !== 'function') {
      const response = await fetchImpl(url, fetchOptions);
      return {
        ok: Boolean(response?.ok),
        status: Number(response?.status) || 0,
        headers: response?.headers || { get() { return null; } },
        chunks: readableResponseChunks(response)
      };
    }
    const iterator = fetchImpl.stream(url, fetchOptions)[Symbol.asyncIterator]();
    const first = await iterator.next();
    if (first.done || first.value?.type === 'error') {
      throw streamTransportError(first.value?.error);
    }
    if (first.value?.type === 'cancelled') {
      const error = new Error('The operation was aborted');
      error.name = 'AbortError';
      throw error;
    }
    if (first.value?.type !== 'started') {
      throw new ProviderRequestError('INVALID_RESPONSE', 'Offscreen stream did not start correctly');
    }
    const started = first.value;
    return {
      ok: started.ok === true || (Number(started.status) >= 200 && Number(started.status) < 300),
      status: Number(started.status) || 0,
      headers: responseHeadersFromStreamStart(started),
      chunks: (async function* transportChunks() {
        while (true) {
          const item = await iterator.next();
          if (item.done) return;
          const event = item.value || {};
          if (event.type === 'chunk') {
            yield String(event.text || '').slice(0, MAX_PROVIDER_STREAM_EVENT_CHARS);
            continue;
          }
          if (event.type === 'completed') return;
          if (event.type === 'cancelled') {
            const error = new Error('The operation was aborted');
            error.name = 'AbortError';
            throw error;
          }
          if (event.type === 'error') throw streamTransportError(event.error);
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

  function protocolEvents(protocol, frame) {
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
      retryAfterMs: Math.max(0, Number(error?.retryAfterMs) || 0)
    };
  }

  function isTruncatedFinishReason(value) {
    return /^(?:length|max_tokens|max_output_tokens|MAX_TOKENS|incomplete)$/i
      .test(String(value || ''));
  }

  async function* createProviderTextStream({
    fetchImpl,
    url,
    options = {},
    protocol = 'openai-chat',
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
    let timedOut = false;
    const forwardAbort = () => controller.abort();
    if (externalSignal?.aborted) controller.abort();
    else externalSignal?.addEventListener('abort', forwardAbort, { once: true });
    const timeoutMs = Number.isFinite(Number(requestedTimeout))
      ? Math.max(1, Number(requestedTimeout)) : 240000;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const startedAt = Date.now();
    const requestBytes = requestByteLength(fetchOptions.body);
    let responseStatus = 0;
    try {
      const transport = await openProviderTextTransport(fetchImpl, url, {
        ...fetchOptions,
        signal: controller.signal
      });
      responseStatus = transport.status;
      if (!transport.ok) {
        let responseBody = '';
        for await (const chunk of transport.chunks) {
          responseBody += chunk;
          if (responseBody.length >= 16 * 1024) break;
        }
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
      const usage = {};
      const consume = function* consumeFrames(frames) {
        for (const frame of frames) {
          sawSse = true;
          fallback = '';
          for (const item of protocolEvents(protocol, frame)) {
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
            } else if (item.kind === 'usage') {
              usageSeen = mergeStreamUsage(usage, item.usage) || usageSeen;
            } else if (item.kind === 'finish') {
              finishReason = String(item.reason || finishReason);
            }
          }
        }
      };

      for await (const chunk of transport.chunks) {
        if (!sawSse) {
          fallback += chunk;
          if (fallback.length > MAX_NON_STREAM_FALLBACK_CHARS) {
            throw new ProviderRequestError(
              'INVALID_RESPONSE', 'Non-stream provider fallback exceeded the response limit'
            );
          }
        }
        for (const event of consume(decoder.push(chunk))) yield event;
      }
      for (const event of consume(decoder.finish())) yield event;

      if (!sawSse) {
        let data;
        try { data = JSON.parse(fallback.trim()); } catch {
          throw new ProviderRequestError('INVALID_RESPONSE', 'Provider returned invalid streaming JSON');
        }
        const result = nonStreamProtocolResult(protocol, data);
        const text = String(result.text || '');
        if (text.length > MAX_NON_STREAM_FALLBACK_CHARS) {
          throw new ProviderRequestError('INVALID_RESPONSE', 'Provider fallback text exceeded the limit');
        }
        if (text) {
          sawText = true;
          for (let offset = 0; offset < text.length; offset += MAX_PROVIDER_STREAM_EVENT_CHARS) {
            yield { type: 'text_delta', text: text.slice(offset, offset + MAX_PROVIDER_STREAM_EVENT_CHARS) };
          }
        }
        usageSeen = mergeStreamUsage(usage, result.usage) || usageSeen;
        finishReason = result.finishReason || finishReason;
      }

      if (!sawText) {
        throw new ProviderRequestError('INVALID_RESPONSE', 'Provider stream did not contain text');
      }
      emitProviderTelemetry(request, {
        providerId, model, elapsedMs: Date.now() - startedAt,
        finishReason, usage
      });
      if (usageSeen) yield { type: 'usage', usage: normalizeStreamUsage(usage) };
      if (isTruncatedFinishReason(finishReason)) {
        throw new ProviderRequestError('OUTPUT_TRUNCATED', 'Model output reached its token limit');
      }
      if (finishReason === 'insufficient_system_resource') {
        throw new ProviderRequestError(
          'PROVIDER_UNAVAILABLE', 'Provider inference resources are temporarily unavailable',
          { retryable: true }
        );
      }
      yield { type: 'completed', finishReason: finishReason || 'stop' };
    } catch (error) {
      if (error?.name === 'AbortError' || error?.code === 'CANCELLED') {
        if (timedOut) {
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
        } else {
          yield { type: 'cancelled' };
        }
      } else {
        const normalized = error instanceof ProviderRequestError ? error : new ProviderRequestError(
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
        { retryable: true }
      );
    }
    return joined;
  }

  async function requestSseJson(fetchImpl, url, options) {
    return parseJsonText(parseSseContent(await requestText(fetchImpl, url, options)));
  }

  function parseJsonText(value) {
    let text = String(value || '').trim();
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    try {
      return JSON.parse(text);
    } catch {
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      if (start >= 0 && end > start) {
        try {
          return JSON.parse(text.slice(start, end + 1));
        } catch {
          // Fall through to a provider-safe error.
        }
      }
      throw new ProviderRequestError('INVALID_RESPONSE', 'Model output was not valid annotation JSON');
    }
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
    ProviderRequestError,
    parseRetryAfter,
    requestText,
    requestJson,
    createProviderTextStream,
    requestSseJson,
    parseSseContent,
    parseJsonText,
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
