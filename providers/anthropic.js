(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(shared) {
  function createAnthropicAdapter(config, fetchImpl) {
    const adapter = {
      providerId: 'anthropic',
      async generateJson(request) {
        const startedAt = Date.now();
        const images = shared.normalizeImageInputs(request.images);
        const content = images.length ? [
          { type: 'text', text: request.userPrompt },
          ...images.map(image => ({
            type: 'image',
            source: {
              type: 'base64',
              media_type: image.mediaType,
              data: image.data
            }
          }))
        ] : request.userPrompt;
        const data = await shared.requestJson(fetchImpl, config.baseUrl || 'https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': config.apiKey,
            'anthropic-version': config.anthropicVersion || '2023-06-01'
          },
          body: JSON.stringify({
            model: config.model,
            max_tokens: shared.normalizeOutputTokenLimit(request.maxOutputTokens),
            system: shared.withStructuredSchemaPrompt(request),
            messages: [{ role: 'user', content }]
          }),
          signal: request.signal,
          timeoutMs: request.timeoutMs
        });
        shared.emitProviderTelemetry(request, {
          providerId: 'anthropic', model: data?.model || config.model,
          elapsedMs: Date.now() - startedAt,
          finishReason: data?.stop_reason,
          usage: data?.usage
        });
        if (data?.stop_reason === 'max_tokens') {
          throw new shared.ProviderRequestError('OUTPUT_TRUNCATED', 'Model output reached its token limit');
        }
        const textBlock = (Array.isArray(data.content) ? data.content : [])
          .find(item => item.type === 'text' && typeof item.text === 'string');
        if (!textBlock) {
          throw new shared.ProviderRequestError('INVALID_RESPONSE', 'Anthropic response did not contain text');
        }
        return shared.parseJsonText(textBlock.text);
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

  return { createAnthropicAdapter };
});
