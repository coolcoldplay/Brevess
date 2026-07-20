(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(shared) {
  function createDeepSeekAdapter(config, fetchImpl) {
    const adapter = {
      providerId: 'deepseek',
      generateTextStream(request) {
        return shared.createProviderTextStream({
          fetchImpl,
          url: config.baseUrl || 'https://api.deepseek.com/chat/completions',
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
                { role: 'user', content: String(request.userPrompt || '') }
              ],
              thinking: { type: config.thinking === true ? 'enabled' : 'disabled' },
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
        const responseText = await shared.requestText(fetchImpl, config.baseUrl || 'https://api.deepseek.com/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.apiKey}`
          },
          body: JSON.stringify({
            model: config.model,
            messages: [
              { role: 'system', content: shared.withStructuredSchemaPrompt(request) },
              { role: 'user', content: String(request.userPrompt || '') }
            ],
            thinking: { type: config.thinking === true ? 'enabled' : 'disabled' },
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
          return shared.parseJsonText(content);
        }
        let data;
        try {
          data = JSON.parse(responseText);
        } catch {
          throw new shared.ProviderRequestError(
            'INVALID_RESPONSE', 'DeepSeek returned invalid response JSON'
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
            { retryable: true }
          );
        }
        const content = choice?.message?.content;
        if (typeof content !== 'string' || !content.trim()) {
          throw new shared.ProviderRequestError(
            'INVALID_RESPONSE', 'DeepSeek returned empty JSON content', { retryable: true }
          );
        }
        return shared.parseJsonText(content);
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
    return adapter;
  }

  return { createDeepSeekAdapter };
});
