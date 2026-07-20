(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(shared) {
  function createOpenAICompatibleAdapter(config, fetchImpl) {
    const adapter = {
      providerId: 'openai-compatible',
      generateTextStream(request) {
        const compatibleImages = config.supportsVision === true ? request.images : [];
        const authHeader = config.authHeader || 'Authorization';
        const prefix = config.authPrefix === undefined ? 'Bearer ' :
          (config.authPrefix ? `${String(config.authPrefix).trim()} ` : '');
        const headers = Object.assign({}, config.customHeaders || {}, {
          'Content-Type': 'application/json',
          [authHeader]: `${prefix}${config.apiKey}`
        });
        return shared.createProviderTextStream({
          fetchImpl,
          url: shared.joinEndpoint(config.baseUrl, '/chat/completions'),
          providerId: 'openai-compatible',
          model: config.model,
          protocol: 'openai-chat',
          request,
          options: {
            method: 'POST',
            headers,
            body: JSON.stringify({
              model: config.model,
              messages: [
                { role: 'system', content: String(request.systemPrompt || '') },
                {
                  role: 'user',
                  content: shared.openAIChatUserContent(request.userPrompt, compatibleImages)
                }
              ],
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
        const compatibleImages = config.supportsVision === true ? request.images : [];
        const authHeader = config.authHeader || 'Authorization';
        const prefix = config.authPrefix === undefined ? 'Bearer ' :
          (config.authPrefix ? `${String(config.authPrefix).trim()} ` : '');
        const headers = Object.assign({}, config.customHeaders || {}, {
          'Content-Type': 'application/json',
          [authHeader]: `${prefix}${config.apiKey}`
        });
        const body = {
          model: config.model,
          messages: [
            { role: 'system', content: shared.withStructuredSchemaPrompt(request) },
            { role: 'user', content: shared.openAIChatUserContent(request.userPrompt, compatibleImages) }
          ],
          max_tokens: shared.normalizeOutputTokenLimit(request.maxOutputTokens),
          stream: false
        };
        if (config.jsonMode !== false) body.response_format = { type: 'json_object' };
        const data = await shared.requestJson(
          fetchImpl,
          shared.joinEndpoint(config.baseUrl, '/chat/completions'),
          {
            method: 'POST', headers, body: JSON.stringify(body), signal: request.signal,
            timeoutMs: request.timeoutMs
          }
        );
        shared.emitProviderTelemetry(request, {
          providerId: 'openai-compatible', model: data?.model || config.model,
          elapsedMs: Date.now() - startedAt,
          finishReason: data?.choices?.[0]?.finish_reason,
          usage: data?.usage
        });
        if (data?.choices?.[0]?.finish_reason === 'length') {
          throw new shared.ProviderRequestError('OUTPUT_TRUNCATED', 'Model output reached its token limit');
        }
        const text = data.choices?.[0]?.message?.content;
        if (typeof text !== 'string') {
          throw new shared.ProviderRequestError('INVALID_RESPONSE', 'Compatible provider response did not contain text');
        }
        return shared.parseJsonText(text);
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

  return { createOpenAICompatibleAdapter };
});
