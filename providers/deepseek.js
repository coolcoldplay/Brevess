(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(shared) {
  function thinkingBody(config, request) {
    const capability = config.__reasoningCapabilities;
    if (capability?.supported !== true || capability.mode !== 'effort' ||
        !Array.isArray(capability.levels) || capability.levels.length === 0) return {};
    const rawEffort = request.reasoningEffort !== undefined
      ? String(request.reasoningEffort)
      : config.reasoningEffort !== undefined
        ? String(config.reasoningEffort)
        : 'auto';
    const enabled = typeof request.reasoningEnabled === 'boolean'
      ? request.reasoningEnabled
      : typeof config.reasoningEnabled === 'boolean'
        ? config.reasoningEnabled
        : typeof config.thinking === 'boolean'
          ? config.thinking
          : !['', 'auto', 'none', 'disabled'].includes(rawEffort);
    if (!enabled) return { thinking: { type: 'disabled' } };
    if (typeof shared.normalizeReasoningForProvider !== 'function') return {};
    const normalized = shared.normalizeReasoningForProvider('deepseek', config, {
      enabled,
      effort: rawEffort
    });
    if (normalized.enabled !== true) return { thinking: { type: 'disabled' } };
    if (!capability.levels.includes(normalized.effort)) return {};
    return {
      thinking: { type: 'enabled' },
      reasoning_effort: normalized.effort
    };
  }

  function officialResponsesEndpoint(value) {
    const configured = String(value || '').trim();
    if (!configured) return 'https://api.deepseek.com/responses';
    try {
      const parsed = new URL(configured);
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password ||
          parsed.port ||
          parsed.hostname.toLocaleLowerCase('en-US') !== 'api.deepseek.com' ||
          parsed.search || parsed.hash || parsed.pathname.replace(/\/+$/u, '') !== '/responses') {
        return '';
      }
      return 'https://api.deepseek.com/responses';
    } catch {
      return '';
    }
  }

  function createDeepSeekAdapter(config, fetchImpl) {
    const responsesEndpoint = officialResponsesEndpoint(config.baseUrl);
    // Ordinary methods use the Chat Completions wire protocol even when the
    // official Responses URL was explicitly selected in an existing profile.
    const chatEndpoint = responsesEndpoint
      ? 'https://api.deepseek.com/chat/completions'
      : config.baseUrl || 'https://api.deepseek.com/chat/completions';

    function userContent(request) {
      const images = config.__providerCapabilities?.supportsVision === true
        ? request.images : [];
      return shared.openAIChatUserContent(request.userPrompt, images);
    }

    function parseCompletedJson(content) {
      try { return shared.parseJsonText(content); }
      catch (error) {
        // The complete HTTP body has arrived. Invalid model JSON is a known
        // response outcome; it must not leave a paid-request receipt unsealed.
        if (error?.code === 'INVALID_RESPONSE') error.diagnosticStage = 'provider-completion';
        throw error;
      }
    }

    const adapter = {
      providerId: 'deepseek',
      generateTextStream(request) {
        return shared.createProviderTextStream({
          fetchImpl,
          url: chatEndpoint,
          providerId: 'deepseek',
          model: config.model,
          protocol: 'openai-chat',
          request,
          options: {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${config.apiKey}`
            },
            body: JSON.stringify({
              model: config.model,
              messages: [
                { role: 'system', content: String(request.systemPrompt || '') },
                { role: 'user', content: userContent(request) }
              ],
              ...thinkingBody(config, request),
              max_tokens: shared.normalizeOutputTokenLimit(request.maxOutputTokens),
              stream: true,
              stream_options: { include_usage: true }
            }),
            signal: request.signal,
            timeoutMs: request.timeoutMs
          }
        });
      },
      async generateJson(request) {
        const startedAt = Date.now();
        const thinking = thinkingBody(config, request);
        const responseText = await shared.requestText(fetchImpl, chatEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.apiKey}`
          },
          body: JSON.stringify({
            model: config.model,
            messages: [
              { role: 'system', content: shared.withStructuredSchemaPrompt(request) },
              { role: 'user', content: userContent(request) }
            ],
            ...thinking,
            response_format: { type: 'json_object' },
            max_tokens: shared.normalizeOutputTokenLimit(request.maxOutputTokens),
            stream: false
          }),
          signal: request.signal,
          timeoutMs: request.timeoutMs
        });
        // Some compatible gateways still return SSE despite stream=false. Keep
        // that response readable while official DeepSeek uses compact JSON.
        if (/^\s*(?:data:|: keep-alive)/m.test(responseText)) {
          const content = shared.parseSseContent(responseText);
          shared.emitProviderTelemetry(request, {
            providerId: 'deepseek', model: config.model,
            elapsedMs: Date.now() - startedAt, finishReason: 'stop'
          });
          return parseCompletedJson(content);
        }
        let data;
        try {
          data = JSON.parse(responseText);
        } catch {
          throw new shared.ProviderRequestError(
            'INVALID_RESPONSE', 'DeepSeek returned invalid response JSON',
            { diagnosticStage: 'provider-completion' }
          );
        }
        const choice = data?.choices?.[0] || {};
        shared.emitProviderTelemetry(request, {
          providerId: 'deepseek',
          model: data?.model || config.model,
          elapsedMs: Date.now() - startedAt,
          finishReason: choice.finish_reason,
          usage: data?.usage
        });
        if (choice.finish_reason === 'length') {
          throw new shared.ProviderRequestError('OUTPUT_TRUNCATED', 'Model output reached its token limit');
        }
        if (choice.finish_reason === 'insufficient_system_resource') {
          throw new shared.ProviderRequestError(
            'PROVIDER_UNAVAILABLE', 'Provider inference resources are temporarily unavailable',
            { retryable: true, status: 200, diagnosticStage: 'provider-completion' }
          );
        }
        const content = choice?.message?.content;
        if (typeof content !== 'string' || !content.trim()) {
          throw new shared.ProviderRequestError(
            'INVALID_RESPONSE', 'DeepSeek returned empty JSON content',
            { retryable: true, diagnosticStage: 'provider-completion' }
          );
        }
        return parseCompletedJson(content);
      },
      async analyzeChunk(request) {
        return adapter.generateJson({
          ...request,
          schemaName: request.schemaName || 'scientific_annotations',
          responseSchema: request.responseSchema ||
            shared.createAnnotationSchema(request.requestedCategoryIds || [])
        });
      }
    };
    const webEndpoint = officialMessagesSearchEndpoint(config);
    if (webEndpoint) {
      adapter.generateWebSearchTextStream = async function* generateWebSearchTextStream(request) {
        yield { type: 'started', providerId: 'deepseek', model: config.model };
        try {
          const startedAt = Date.now();
          const data = await shared.requestJson(fetchImpl, webEndpoint, {
            method: 'POST', redirect: 'error',
            headers: { 'Content-Type': 'application/json', 'x-api-key': config.apiKey,
              'anthropic-version': '2023-06-01' },
            body: JSON.stringify({
              model: config.model,
              max_tokens: shared.normalizeOutputTokenLimit(request.maxOutputTokens),
              system: [String(request.webSystemPrompt || request.systemPrompt || ''),
                'Perform exactly one web search before answering. Return readable Markdown, not JSON.',
                'Cite external claims with inline [source](URL) links copied exactly from the web search results, including every query string and fragment. Do not add URLs absent from those results, omit fragments, use reference-style links, or invent sources.',
                'If the search fails or provides no useful sources, say so explicitly. Do not present an unsourced answer as searched.'
              ].join('\n'),
              messages: [{ role: 'user', content: String(request.userPrompt || '') }],
              tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 1 }],
              thinking: { type: 'disabled' }, stream: false
            }),
            signal: request.signal, timeoutMs: request.timeoutMs
          });
          // Even an unusable completed response consumed tokens. Preserve its
          // telemetry before validating grounding; never auto-continue it.
          shared.emitProviderTelemetry(request, { providerId: 'deepseek', model: data?.model || config.model,
            elapsedMs: Date.now() - startedAt, finishReason: data?.stop_reason, usage: data?.usage });
          const normalized = shared.normalizeDeepSeekAnthropicWebResponse(data,
            { providerId: 'deepseek', model: config.model });
          for (const event of [
            { type: 'text_delta', text: normalized.text },
            { type: 'web_grounding', grounding: normalized.grounding },
            { type: 'usage', usage: shared.normalizeStreamUsage(normalized.usage) },
            { type: 'completed', finishReason: 'completed' }
          ]) {
            if (request.signal?.aborted) {
              throw new shared.ProviderRequestError('CANCELLED', 'Provider request was cancelled', { retryable: false });
            }
            yield event;
          }
        } catch (error) {
          yield { type: 'error', error: shared.publicStreamError(error) };
        }
      };
    }
    return adapter;
  }

  // Responses ignores built-in web_search. The separately verified Messages
  // protocol is available only for this exact official model and known routes;
  // never forward a compatible gateway's key to a different host.
  function officialMessagesSearchEndpoint(config) {
    if (config.model !== 'deepseek-flash') return '';
    const configured = String(config.baseUrl || '').trim();
    if (!configured) return 'https://api.deepseek.com/anthropic/v1/messages';
    try {
      const parsed = new URL(configured);
      const pathname = parsed.pathname.replace(/\/+$/u, '');
      if (parsed.protocol !== 'https:' || parsed.hostname !== 'api.deepseek.com' ||
          parsed.port || parsed.username || parsed.password || parsed.search || parsed.hash ||
          !['', '/v1', '/responses', '/v1/responses', '/chat/completions', '/v1/chat/completions'].includes(pathname)) return '';
      return 'https://api.deepseek.com/anthropic/v1/messages';
    } catch { return ''; }
  }

  return { createDeepSeekAdapter };
});
