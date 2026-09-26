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

  function usesChatCompletionsEndpoint(value) {
    return /\/chat\/completions(?:[/?#]|$)/i.test(String(value || '').trim());
  }

  function officialResponsesEndpoint(value) {
    const configured = String(value || '').trim();
    if (!configured) return 'https://api.openai.com/v1/responses';
    try {
      const parsed = new URL(configured);
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password ||
          parsed.port ||
          parsed.hostname.toLocaleLowerCase('en-US') !== 'api.openai.com' ||
          parsed.search || parsed.hash || parsed.pathname.replace(/\/+$/u, '') !== '/v1/responses') {
        return '';
      }
      return 'https://api.openai.com/v1/responses';
    } catch {
      return '';
    }
  }

  function openAIHeaders(config) {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`
    };
  }

  function reasoningBody(config, request) {
    const capability = config.__reasoningCapabilities;
    const effort = String(request.reasoningEffort ?? config.reasoningEffort ?? 'auto');
    if (capability?.supported !== true || capability.mode !== 'effort' ||
        effort === 'auto' || !capability.levels.includes(effort)) return {};
    return { reasoning: { effort } };
  }

  function promptCacheBody(config, request) {
    const endpoint = String(config.baseUrl || '').trim();
    if (request.ephemeral === true || (endpoint &&
        !/^https:\/\/api\.openai\.com(?:[/:]|$)/i.test(endpoint))) return {};
    const source = String(request.promptCacheKey || request.conversationKey || '').trim();
    if (!source) return {};
    return { prompt_cache_key: `brevess:${source}`.slice(0, 128) };
  }

  function createOpenAIAdapter(config, fetchImpl) {
    const adapter = {
      providerId: 'openai',
      generateTextStream(request) {
        const images = shared.normalizeImageInputs(request.images);
        const chatCompletions = usesChatCompletionsEndpoint(config.baseUrl);
        if (chatCompletions) {
          return shared.createProviderTextStream({
            fetchImpl,
            url: config.baseUrl,
            providerId: 'openai',
            model: config.model,
            protocol: 'openai-chat',
            request,
            options: {
              method: 'POST',
              headers: openAIHeaders(config),
              body: JSON.stringify({
                model: config.model,
                messages: [
                  { role: 'system', content: String(request.systemPrompt || '') },
                  {
                    role: 'user',
                    content: shared.openAIChatUserContent(request.userPrompt, images)
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
        }
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
            headers: openAIHeaders(config),
            body: JSON.stringify({
              model: config.model,
              instructions: request.systemPrompt,
              input,
              max_output_tokens: shared.normalizeOutputTokenLimit(request.maxOutputTokens),
              store: false,
              stream: true,
              ...reasoningBody(config, request),
              ...promptCacheBody(config, request)
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
        const chatCompletions = usesChatCompletionsEndpoint(config.baseUrl);
        const url = config.baseUrl || 'https://api.openai.com/v1/responses';
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
        const body = chatCompletions ? {
          model: config.model,
          messages: [
            { role: 'system', content: shared.withStructuredSchemaPrompt(request) },
            {
              role: 'user',
              content: shared.openAIChatUserContent(request.userPrompt, images)
            }
          ],
          max_tokens: shared.normalizeOutputTokenLimit(request.maxOutputTokens),
          response_format: { type: 'json_object' },
          stream: false
        } : {
          model: config.model,
          instructions: request.systemPrompt,
          input,
          max_output_tokens: shared.normalizeOutputTokenLimit(request.maxOutputTokens),
          store: false,
          ...reasoningBody(config, request),
          ...promptCacheBody(config, request),
          text: {
            format: {
              type: 'json_schema',
              name: request.schemaName || 'structured_response',
              strict: true,
              schema: responseSchema
            }
          }
        };
        const data = await shared.requestJson(fetchImpl, url, {
          method: 'POST',
          headers: openAIHeaders(config),
          body: JSON.stringify(body),
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
    const webSearchEndpoint = officialResponsesEndpoint(config.baseUrl);
    if (webSearchEndpoint) {
      adapter.generateWebSearchTextStream = async function* generateWebSearchTextStream(request) {
        yield { type: 'started', providerId: 'openai', model: String(config.model || '') };
        try {
          const images = shared.normalizeImageInputs(request.images);
          const input = images.length ? [{
            role: 'user',
            content: [
              { type: 'input_text', text: request.userPrompt },
              ...images.map(image => ({ type: 'input_image', image_url: image.dataUrl }))
            ]
          }] : request.userPrompt;
          const startedAt = Date.now();
          const data = await shared.requestJson(fetchImpl, webSearchEndpoint, {
            method: 'POST',
            headers: openAIHeaders(config),
            body: JSON.stringify({
              model: config.model,
              instructions: request.systemPrompt,
              input,
              max_output_tokens: shared.normalizeOutputTokenLimit(request.maxOutputTokens),
              tools: [{ type: 'web_search' }],
              tool_choice: { type: 'web_search' },
              store: false,
              stream: false,
              ...reasoningBody(config, request),
              ...promptCacheBody(config, request)
            }),
            signal: request.signal,
            timeoutMs: request.timeoutMs
          });
          if (data?.status === 'incomplete' &&
              data?.incomplete_details?.reason === 'max_output_tokens') {
            throw new shared.ProviderRequestError(
              'OUTPUT_TRUNCATED', 'Model output reached its token limit'
            );
          }
          const normalized = shared.normalizeArticleChatWebResponse(data, {
            providerId: 'openai', model: String(config.model || '')
          }, { requireGrounding: true });
          const usage = shared.normalizeStreamUsage(normalized.usage);
          shared.emitProviderTelemetry(request, {
            providerId: 'openai', model: data?.model || config.model,
            elapsedMs: Date.now() - startedAt,
            finishReason: 'completed', usage: normalized.usage
          });
          yield { type: 'text_delta', text: normalized.text };
          yield { type: 'web_grounding', grounding: normalized.grounding };
          yield { type: 'usage', usage };
          yield { type: 'completed', finishReason: 'completed' };
        } catch (error) {
          yield { type: 'error', error: shared.publicStreamError(error) };
        }
      };
    }
    return adapter;
  }

  return { createOpenAIAdapter };
});
