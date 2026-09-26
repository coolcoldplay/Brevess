(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(shared) {
  const TYPESAFE_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';

  function invalidResponse() {
    return new shared.ProviderRequestError('INVALID_RESPONSE',
      'TypeSafe returned incomplete or invalid typed decisions', { retryable: true });
  }

  function validateTypeSafeAnswers(data, questions) {
    if (!data || typeof data !== 'object' || !data.answers ||
        typeof data.answers !== 'object' || Array.isArray(data.answers)) throw invalidResponse();
    const probability = value => typeof value === 'number' && Number.isFinite(value) &&
      value >= 0 && value <= 1;
    for (const [id, question] of Object.entries(questions)) {
      if (!Object.prototype.hasOwnProperty.call(data.answers, id)) throw invalidResponse();
      const answer = data.answers[id];
      if (!answer || answer.type !== question.type) throw invalidResponse();
      if (question.type === 'noul') {
        if (!probability(answer.noul)) throw invalidResponse();
      } else if (question.type === 'choice') {
        const options = Object.keys(question.criteria || {});
        if (!options.includes(answer.choice) || !probability(answer.confidence) ||
            !answer.probabilities || typeof answer.probabilities !== 'object' ||
            options.some(option => !Object.prototype.hasOwnProperty.call(answer.probabilities, option) ||
              !probability(answer.probabilities[option])) ||
            Object.keys(answer.probabilities).some(option => !options.includes(option)) ||
            Math.abs(options.reduce((sum, option) => sum + answer.probabilities[option], 0) - 1) > 0.01 + 1e-9) {
          throw invalidResponse();
        }
      } else throw invalidResponse();
    }
    return data;
  }

  function createTypeSafeAdapter(config, fetchImpl) {
    // TypeSafe credentials are never sent to a user-supplied alternative host.
    const configured = String(config.baseUrl || '').replace(/\/+$/u, '');
    if (configured && configured !== TYPESAFE_ENDPOINT &&
        configured !== 'https://api.typesafe.ai/v1') {
      throw new shared.ProviderRequestError('INVALID_SETTINGS', 'Invalid TypeSafe API endpoint');
    }
    const adapter = {
      providerId: 'typesafe',
      typedDecisions: true,
      supportsTextGeneration: false,
      async evaluateDecisions(request) {
        if (request.signal?.aborted) throw new shared.ProviderRequestError('CANCELLED', 'Request cancelled');
        if (!request.questions || !Object.keys(request.questions).length || request.images?.length) {
          throw new shared.ProviderRequestError('INVALID_SETTINGS', 'TypeSafe requires text decision questions');
        }
        const startedAt = Date.now();
        const body = { model: String(config.model || 'jev-latest'),
          state: request.state, questions: request.questions };
        const data = await shared.requestJson(fetchImpl, TYPESAFE_ENDPOINT, {
          method: 'POST', headers: { 'Content-Type': 'application/json',
            Authorization: `Bearer ${config.apiKey}` },
          body: JSON.stringify(body), signal: request.signal,
          timeoutMs: Number(request.timeoutMs) || 60000
        });
        shared.emitProviderTelemetry(request, {
          providerId: 'typesafe', model: data?.model || body.model,
          elapsedMs: Date.now() - startedAt, finishReason: 'typed_decisions', usage: data?.usage
        });
        return validateTypeSafeAnswers(data, body.questions);
      },
      async analyzeChunk(request) {
        if (request.schemaName !== 'scientific_annotations_v3' ||
            !Array.isArray(request.requestedCategories) ||
            typeof shared.analyzeJevHighlights !== 'function') {
          throw new shared.ProviderRequestError('CAPABILITY_MISMATCH',
            'TypeSafe Jev supports document text highlighting only');
        }
        return shared.analyzeJevHighlights(request, input => adapter.evaluateDecisions({
          ...input, signal: request.signal, timeoutMs: request.timeoutMs,
          onProviderTelemetry: request.onProviderTelemetry
        }));
      }
    };
    return adapter;
  }

  return { TYPESAFE_ENDPOINT, validateTypeSafeAnswers, createTypeSafeAdapter };
});
