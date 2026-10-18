(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(shared) {
  function thinkingConfig(config, request) {
    const capability = config.__reasoningCapabilities;
    const effort = String(request.reasoningEffort ?? config.reasoningEffort ?? 'auto');
    if (capability?.supported !== true || capability.mode !== 'effort' ||
        effort === 'auto' || !capability.levels.includes(effort)) return {};
    return { thinkingConfig: { thinkingLevel: effort } };
  }

  function createGeminiAdapter(config, fetchImpl) {
    const adapter = {
      providerId: 'gemini',
      generateTextStream(request) {
        const model = encodeURIComponent(config.model);
        const defaultUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`;
        const configured = String(config.baseUrl || '').trim();
        const baseUrl = configured
          ? configured.replace(':generateContent', ':streamGenerateContent')
          : defaultUrl;
        const url = configured && !/[?&]alt=sse(?:&|$)/.test(baseUrl)
          ? `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}alt=sse` : baseUrl;
        const images = shared.normalizeImageInputs(request.images);
        return shared.createProviderTextStream({
          fetchImpl,
          url,
          providerId: 'gemini',
          model: config.model,
          protocol: 'gemini',
          request,
          options: {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-goog-api-key': config.apiKey
            },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: String(request.systemPrompt || '') }] },
              contents: [{
                role: 'user',
                parts: [
                  { text: String(request.userPrompt || '') },
                  ...images.map(image => ({
                    inlineData: { mimeType: image.mediaType, data: image.data }
                  }))
                ]
              }],
              generationConfig: {
                maxOutputTokens: shared.normalizeOutputTokenLimit(request.maxOutputTokens),
                ...thinkingConfig(config, request)
              }
            }),
            signal: request.signal,
            timeoutMs: request.timeoutMs
          }
        });
      },
      async generateJson(request) {
        const startedAt = Date.now();
        const model = encodeURIComponent(config.model);
        const url = config.baseUrl || `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
        const images = shared.normalizeImageInputs(request.images);
        const userParts = [
          { text: request.userPrompt },
          ...images.map(image => ({
            inlineData: { mimeType: image.mediaType, data: image.data }
          }))
        ];
        const data = await shared.requestJson(fetchImpl, url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': config.apiKey
          },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: shared.withStructuredSchemaPrompt(request) }] },
            contents: [{ role: 'user', parts: userParts }],
            generationConfig: {
              responseMimeType: 'application/json',
              maxOutputTokens: shared.normalizeOutputTokenLimit(request.maxOutputTokens),
              ...thinkingConfig(config, request)
            }
          }),
          signal: request.signal,
          timeoutMs: request.timeoutMs
        });
        shared.emitProviderTelemetry(request, {
          providerId: 'gemini', model: config.model,
          elapsedMs: Date.now() - startedAt,
          finishReason: data?.candidates?.[0]?.finishReason,
          usage: data?.usageMetadata
        });
        if (data?.candidates?.[0]?.finishReason === 'MAX_TOKENS') {
          throw new shared.ProviderRequestError('OUTPUT_TRUNCATED', 'Model output reached its token limit');
        }
        const parts = data.candidates?.[0]?.content?.parts;
        const text = Array.isArray(parts) ? parts.map(item => item.text || '').join('') : '';
        if (!text) throw new shared.ProviderRequestError('INVALID_RESPONSE', 'Gemini response did not contain text');
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

  return { createGeminiAdapter };
});
