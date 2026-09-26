(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(shared) {
  function localCodexError(code, message, details = {}) {
    if (typeof shared.ProviderRequestError === 'function') {
      const error = new shared.ProviderRequestError(code, message);
      error.retryable = details.retryable === true;
      if (Number.isFinite(details.status)) error.status = details.status;
      return error;
    }
    const error = new Error(message);
    error.code = code;
    error.retryable = details.retryable === true;
    if (Number.isFinite(details.status)) error.status = details.status;
    return error;
  }

  function schemaInstruction(request = {}) {
    if (!request.responseSchema) return '';
    return '\nReturn only one JSON object that validates against this JSON Schema:\n' +
      JSON.stringify(request.responseSchema);
  }

  function boundedToken(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? Math.round(number) : 0;
  }

  function codexUsage(value = {}) {
    const usage = value?.last || value?.lastTokenUsage ||
      value?.last_token_usage || value?.total || value;
    return {
      inputTokens: boundedToken(
        usage?.inputTokens ?? usage?.input_tokens ?? usage?.prompt_tokens
      ),
      outputTokens: boundedToken(
        usage?.outputTokens ?? usage?.output_tokens ?? usage?.completion_tokens
      ),
      reasoningTokens: boundedToken(
        usage?.reasoningTokens ?? usage?.reasoningOutputTokens ??
        usage?.reasoning_tokens
      ),
      cacheHitTokens: boundedToken(
        usage?.cacheHitTokens ?? usage?.cachedInputTokens ??
        usage?.cache_read_input_tokens
      ),
      cacheMissTokens: boundedToken(
        usage?.cacheMissTokens ?? usage?.prompt_cache_miss_tokens
      )
    };
  }

  function hasUsage(usage) {
    return Object.values(usage || {}).some(value => boundedToken(value) > 0);
  }

  function reasoningEffort(config, request) {
    const allowed = new Set(['auto', 'low', 'medium', 'high', 'xhigh']);
    const requested = String(request?.reasoningEffort || '').trim();
    if (allowed.has(requested)) return requested;
    const configured = String(config?.reasoningEffort || 'auto').trim();
    return allowed.has(configured) ? configured : 'auto';
  }

  function estimatedUsage(request, outputText) {
    const prompt = `${request?.systemPrompt || ''}\n${request?.userPrompt || ''}`;
    const images = Array.isArray(request?.images) ? request.images.length : 0;
    return {
      inputTokens: Math.max(1, Math.ceil(prompt.length / 4) + images * 1024),
      outputTokens: Math.max(1, Math.ceil(String(outputText || '').length / 4)),
      reasoningTokens: 0,
      cacheHitTokens: 0,
      cacheMissTokens: 0
    };
  }

  function reportUsage(request, config, usageInput, outputText, finishReason = 'stop') {
    const normalized = codexUsage(usageInput);
    const exact = hasUsage(normalized);
    shared.emitProviderTelemetry(request, {
      providerId: 'codex-local',
      model: String(config.model || 'auto'),
      finishReason,
      usage: exact ? normalized : estimatedUsage(request, outputText),
      estimated: !exact
    });
  }

  function createCodexLocalAdapter(config = {}, nativeClient) {
    if (!nativeClient || typeof nativeClient.streamTurn !== 'function') {
      throw localCodexError(
        'CODEX_BRIDGE_UNAVAILABLE',
        'The local Codex Native Messaging bridge is unavailable'
      );
    }

    function turnInput(request = {}, overrides = {}) {
      const model = String(config.model || 'auto').trim() || 'auto';
      const images = shared.normalizeImageInputs(request.images, { maxImages: 8 })
        .map(image => ({
          mediaType: image.mediaType,
          dataUrl: image.dataUrl,
          detail: 'high'
        }));
      return {
        conversationKey: String(
          overrides.conversationKey ?? request.conversationKey ?? ''
        ),
        conversationLabel: String(
          overrides.conversationLabel ?? request.conversationLabel ?? ''
        ),
        profileId: String(request.selectedProfileId || config.profileId || ''),
        model,
        reasoningEffort: reasoningEffort(config, request),
        systemPrompt: String(request.systemPrompt || '') +
          schemaInstruction(request),
        userPrompt: String(request.userPrompt || ''),
        images,
        maxOutputTokens: request.maxOutputTokens,
        timeoutMs: request.timeoutMs,
        signal: request.signal,
        ephemeral: overrides.ephemeral === true ||
          (overrides.ephemeral === undefined && request.ephemeral === true)
      };
    }

    const adapter = {
      providerId: 'codex-local',
      async testConnection(options = {}) {
        return nativeClient.health({
          timeoutMs: options.timeoutMs || 20000
        });
      },
      async *generateTextStream(request) {
        let text = '';
        let usage = null;
        let finishReason = 'stop';
        let completed = false;
        for await (const event of nativeClient.streamTurn(turnInput(request))) {
          if (event?.type === 'text_delta') text += String(event.text || '');
          if (event?.type === 'usage') usage = event.usage || usage;
          if (event?.type === 'completed') {
            usage = event.usage || usage;
            finishReason = String(event.finishReason || 'stop');
            completed = true;
          }
          yield event;
        }
        if (completed) reportUsage(request, config, usage, text, finishReason);
      },
      async generateJson(request) {
        let text = '';
        let terminalError = null;
        let usage = null;
        let finishReason = 'stop';
        let completed = false;
        for await (const event of nativeClient.streamTurn(turnInput(request, {
          conversationKey: '',
          conversationLabel: 'Brevess structured task',
          ephemeral: true
        }))) {
          if (event?.type === 'text_delta') text += String(event.text || '');
          else if (event?.type === 'usage') usage = event.usage || usage;
          else if (event?.type === 'completed') {
            usage = event.usage || usage;
            finishReason = String(event.finishReason || 'stop');
            completed = true;
          }
          else if (event?.type === 'cancelled') {
            throw localCodexError('CANCELLED', 'Local Codex request was cancelled');
          } else if (event?.type === 'error') {
            terminalError = localCodexError(
              event.error?.code || 'CODEX_BRIDGE_UNAVAILABLE',
              event.error?.message || 'Local Codex request failed',
              event.error || {}
            );
          }
        }
        if (terminalError) throw terminalError;
        if (!text.trim()) {
          throw localCodexError('INVALID_RESPONSE', 'Local Codex returned no output');
        }
        if (completed) reportUsage(request, config, usage, text, finishReason);
        return shared.parseJsonText(text);
      },
      async analyzeChunk(request) {
        return adapter.generateJson({
          ...request,
          responseSchema: request.responseSchema ||
            shared.createAnnotationSchema(request.requestedCategoryIds || [])
        });
      }
    };
    return adapter;
  }

  return { createCodexLocalAdapter };
});
