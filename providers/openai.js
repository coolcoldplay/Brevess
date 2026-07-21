(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(shared) {
  function extractOutputText(data) {
    if (typeof data.output_text === 'string') return data.output_text;
    for (const output of Array.isArray(data.output) ? data.output : []) {
      for (const content of Array.isArray(output.content) ? output.content : []) {
        if (content.type === 'output_text' && typeof content.text === 'string') return content.text;
        if (content?.parsed && typeof content.parsed === 'object') {
          return JSON.stringify(content.parsed);
        }
      }
    }
    const message = data?.choices?.[0]?.message;
    if (typeof message?.content === 'string') return message.content;
    if (message?.parsed && typeof message.parsed === 'object') {
      return JSON.stringify(message.parsed);
    }
    throw new shared.ProviderRequestError('INVALID_RESPONSE', 'OpenAI response did not contain output text');
  }

  function createOpenAIAdapter(config, fetchImpl) {
    const adapter = {
      providerId: 'openai',
      generateTextStream(request) {
        const images = shared.normalizeImageInputs(request.images);
        const input = images.length ? [{
          role: 'user',
          content: [
            { type: 'input_text', text: request.userPrompt },
            ...images.map(image => ({ type: 'input_image', image_url: image.dataUrl }))
          ]
        }] : request.userPrompt;
        return shared.createProviderTextStream({
          fetchImpl,
          url: config.baseUrl || 'https://api.openai.com/v1/responses',
          providerId: 'openai',
          model: config.model,
          protocol: 'openai-responses',
          request,
          options: {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${config.apiKey}`
            },
            body: JSON.stringify({
              model: config.model,
              instructions: request.systemPrompt,
              input,
              max_output_tokens: shared.normalizeOutputTokenLimit(request.maxOutputTokens),
              store: false,
              stream: true
            }),
            signal: request.signal,
            timeoutMs: request.timeoutMs
          }
        });
      },
      async generateJson(request) {
        const startedAt = Date.now();
        const responseSchema = request.responseSchema ||
          shared.createAnnotationSchema(request.requestedCategoryIds || []);
        const images = shared.normalizeImageInputs(request.images);
        const input = images.length ? [{
          role: 'user',
          content: [
            { type: 'input_text', text: request.userPrompt },
            ...images.map(image => ({
              type: 'input_image',
              image_url: image.dataUrl
            }))
          ]
        }] : request.userPrompt;
        const data = await shared.requestJson(fetchImpl, config.baseUrl || 'https://api.openai.com/v1/responses', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.apiKey}`
          },
          body: JSON.stringify({
            model: config.model,
            instructions: request.systemPrompt,
            input,
            max_output_tokens: shared.normalizeOutputTokenLimit(request.maxOutputTokens),
            store: false,
            text: {
              format: {
                type: 'json_schema',
                name: request.schemaName || 'structured_response',
                strict: true,
                schema: responseSchema
              }
            }
          }),
          signal: request.signal,
          timeoutMs: request.timeoutMs
        });
        shared.emitProviderTelemetry(request, {
          providerId: 'openai', model: data?.model || config.model,
          elapsedMs: Date.now() - startedAt,
          finishReason: data?.status === 'incomplete'
            ? data?.incomplete_details?.reason : data?.status,
          usage: data?.usage
        });
        if (data?.status === 'incomplete' && data?.incomplete_details?.reason === 'max_output_tokens') {
          throw new shared.ProviderRequestError('OUTPUT_TRUNCATED', 'Model output reached its token limit');
        }
        if (data?.choices?.[0]?.finish_reason === 'length') {
          throw new shared.ProviderRequestError('OUTPUT_TRUNCATED', 'Model output reached its token limit');
        }
        return shared.parseJsonText(extractOutputText(data));
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

  return { createOpenAIAdapter };
});
