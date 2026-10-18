(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(shared) {
  function localCodexError(code, message, details = {}) {
    const diagnostic = error => {
      if (['native_handshake', 'native_submitted', 'native_running'].includes(details.diagnosticStage)) {
        error.diagnosticStage = details.diagnosticStage;
        error.diagnosticType = ['absolute_deadline', 'explicit_abort', 'bridge_failure', 'bridge_disconnected'].includes(details.diagnosticType) ? details.diagnosticType : '';
        const value = details.nativeRequestDiagnostic;
        if (value && ['handshake', 'submitted', 'running'].includes(value.stage)) {
          error.nativeRequestDiagnostic = Object.freeze(Object.fromEntries([
            ['stage', value.stage], ...['enteredAt', 'dispatchedAt', 'startedAt', 'lastActivityAt', 'cancelRequestedAt', 'terminalAt']
              .map(key => [key, Number.isFinite(value[key]) && value[key] >= 0 ? value[key] : null])
          ]));
        }
      }
      return error;
    };
    if (typeof shared.ProviderRequestError === 'function') {
      const error = new shared.ProviderRequestError(code, message);
      error.retryable = details.retryable === true;
      if (Number.isFinite(details.status)) error.status = details.status;
      return diagnostic(error);
    }
    const error = new Error(message);
    error.code = code;
    error.retryable = details.retryable === true;
    if (Number.isFinite(details.status)) error.status = details.status;
    return diagnostic(error);
  }

  function schemaInstruction(request = {}) {
    if (!request.responseSchema) return '';
    return '\nReturn only one JSON object that validates against this JSON Schema:\n' +
      JSON.stringify(request.responseSchema);
  }

  // Native strict output supports a subset of JSON Schema. Keep the full
  // business schema in the prompt and its downstream validator unchanged.
  // Reuse identical enum definitions to avoid counting source-ID enums once
  // per occurrence against the service's aggregate enum limit.
  // Transport-only, bounded transformations for the existing business schemas.
  // Null internally means an unsatisfiable schema, never a model output value.
  function projectCodexSchemaStructure(schema) {
    const fail = message => { throw localCodexError('CODEX_SCHEMA_UNSUPPORTED', message); };
    const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    function intersect(a, b) {
      const out = { ...a };
      for (const [key, value] of Object.entries(b)) {
        if (!(key in out)) { out[key] = value; continue; }
        if (equal(out[key], value)) continue;
        if (key === 'properties') {
          out.properties = { ...out.properties };
          for (const [name, child] of Object.entries(value)) {
            if (a.additionalProperties === false && !Object.hasOwn(a.properties || {}, name)) fail('Intersection adds a forbidden property');
            Object.defineProperty(out.properties, name, { enumerable: true, configurable: true, writable: true,
              value: Object.hasOwn(out.properties, name) ? intersect(out.properties[name], child) : child });
          }
        } else if (key === 'required') out.required = [...new Set([...out.required, ...value])];
        else if (key === 'enum') out.enum = out.enum.filter(x => value.some(y => equal(x, y)));
        else if (['minLength', 'minItems', 'minimum'].includes(key)) out[key] = Math.max(out[key], value);
        else if (['maxLength', 'maxItems', 'maximum'].includes(key)) out[key] = Math.min(out[key], value);
        else fail('Unsupported intersecting schema constraint: ' + key);
      }
      return out;
    }
    function disjoint(a, b) {
      if (a.type !== 'object' || b.type !== 'object') return false;
      if (a.additionalProperties === false && (b.required || []).some(k => !Object.hasOwn(a.properties || {}, k))) return true;
      if (b.additionalProperties === false && (a.required || []).some(k => !Object.hasOwn(b.properties || {}, k))) return true;
      return (a.required || []).some(k => (b.required || []).includes(k) &&
        Array.isArray(a.properties?.[k]?.enum) && Array.isArray(b.properties?.[k]?.enum) &&
        !a.properties[k].enum.some(x => b.properties[k].enum.some(y => equal(x, y))));
    }
    function walk(node, atRoot = false) {
      if (!node || typeof node !== 'object' || Array.isArray(node)) return node;
      if (Array.isArray(node.enum) && !node.enum.length) return null;
      if (node.oneOf) {
        const { oneOf, ...base } = node;
        if (!Array.isArray(oneOf) || !oneOf.length || oneOf.length > 128) fail('Unsupported oneOf branch count');
        const branches = oneOf.map(branch => intersect(base, branch));
        for (let i = 0; i < branches.length; i++) for (let j = i + 1; j < branches.length; j++) {
          if (!disjoint(branches[i], branches[j])) fail('oneOf branches are not provably disjoint');
        }
        if (atRoot) fail('Root unions are unsupported');
        const possible = branches.map(branch => walk(branch)).filter(Boolean);
        return possible.length ? { anyOf: possible } : null;
      }
      const out = { ...node };
      if (node.anyOf) {
        out.anyOf = node.anyOf.map(branch => walk(branch)).filter(Boolean);
        if (!out.anyOf.length) return null;
        if (atRoot) fail('Root unions are unsupported');
      }
      for (const key of ['$defs', 'definitions']) if (node[key]) {
        out[key] = Object.fromEntries(Object.entries(node[key]).map(([name, child]) => {
          const next = walk(child); if (!next) fail('Unsatisfiable named schema definition'); return [name, next];
        }));
      }
      if (node.items && typeof node.items === 'object' && !Array.isArray(node.items)) {
        const items = walk(node.items);
        if (!items) {
          if ((node.minItems || 0) > 0) return null;
          out.minItems = 0; out.maxItems = 0; out.items = { type: 'string' };
        } else out.items = items;
      }
      if (node.properties) {
        const properties = [];
        for (const [key, child] of Object.entries(node.properties)) {
          const next = walk(child);
          if (!next) { if ((node.required || []).includes(key)) return null; }
          else properties.push([key, next]);
        }
        out.properties = Object.fromEntries(properties);
        const required = node.required || [], optional = Object.keys(out.properties).filter(k => !required.includes(k));
        if (required.some(k => !Object.hasOwn(node.properties, k))) fail('Required schema property is not declared');
        // Incomplete schema fragments without a required declaration retain the
        // previous projection contract; actual core object schemas declare it.
        if (optional.length && Array.isArray(node.required)) {
          if (atRoot || node.type !== 'object' || node.additionalProperties !== false || optional.length > 3) {
            fail('Unsupported optional-property schema shape');
          }
          const branches = [];
          for (let mask = 0; mask < 2 ** optional.length; mask++) {
            const properties = Object.fromEntries(Object.entries(out.properties).filter(([key]) =>
              required.includes(key) || (mask & (1 << optional.indexOf(key)))));
            branches.push({ ...out, properties, required: Object.keys(properties) });
          }
          return { anyOf: branches };
        }
      }
      return out;
    }
    const output = walk(schema, true);
    if (!output) fail('The response schema has no possible output');
    return output;
  }

  function checkCodexSchemaBudget(schema) {
    let enums = 0, properties = 0, strings = 0;
    const fail = () => { throw localCodexError('CODEX_SCHEMA_COMPLEXITY_LIMIT', 'The complete response schema exceeds the native structured-output budget'); };
    function visit(node) {
      if (!node || typeof node !== 'object' || Array.isArray(node)) return;
      if (Array.isArray(node.enum)) {
        enums += node.enum.length;
        const chars = node.enum.reduce((sum, value) => sum + (typeof value === 'string' ? value.length : 0), 0);
        strings += chars; if (node.enum.length > 250 && chars > 15000) fail();
      }
      if (typeof node.const === 'string') strings += node.const.length;
      properties += Object.keys(node.properties || {}).length;
      for (const key of ['properties', '$defs', 'definitions']) for (const [name, child] of Object.entries(node[key] || {})) { strings += name.length; visit(child); }
      for (const key of ['items', 'additionalProperties']) if (node[key] && typeof node[key] === 'object') visit(node[key]);
      for (const key of ['anyOf', 'oneOf', 'allOf']) for (const child of node[key] || []) visit(child);
    }
    visit(schema);
    if (enums > 1000 || properties > 5000 || strings > 120000) fail();
  }

  function prepareCodexOutputSchema(schema) {
    schema = projectCodexSchemaStructure(schema);
    const enumCounts = new Map(), definitions = new Map();
    const existingNames = new Set(Object.keys(schema?.$defs || {}));
    function transform(node, project) {
      if (!node || typeof node !== 'object' || Array.isArray(node)) return node;
      const output = { ...node };
      if (project) delete output.uniqueItems;
      for (const key of ['properties', '$defs', 'definitions']) {
        if (node[key] && typeof node[key] === 'object' && !Array.isArray(node[key])) {
          output[key] = Object.fromEntries(Object.entries(node[key]).map(([name, child]) =>
            [name, transform(child, project)]));
        }
      }
      for (const key of ['items', 'additionalProperties']) {
        if (node[key] && typeof node[key] === 'object' && !Array.isArray(node[key])) {
          output[key] = transform(node[key], project);
        }
      }
      for (const key of ['anyOf', 'oneOf', 'allOf']) {
        if (Array.isArray(node[key])) output[key] = node[key].map(child => transform(child, project));
      }
      if (Array.isArray(node.enum) && !node.$ref && !node.properties && !node.items) {
        const identity = JSON.stringify(node);
        if (!project) enumCounts.set(identity, (enumCounts.get(identity) || 0) + 1);
        else if (enumCounts.get(identity) > 1) {
          if (!definitions.has(identity)) {
            let name = 'brevessEnum' + (definitions.size + 1);
            while (existingNames.has(name)) name += '_';
            existingNames.add(name);
            definitions.set(identity, { name, schema: output });
          }
          return { $ref: '#/$defs/' + definitions.get(identity).name };
        }
      }
      return output;
    }
    transform(schema, false);
    const output = transform(schema, true);
    if (definitions.size) output.$defs = { ...(output.$defs || {}),
      ...Object.fromEntries([...definitions.values()].map(entry => [entry.name, entry.schema])) };
    checkCodexSchemaBudget(output);
    return output;
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
        // Local observations only; never enter the Native Messaging payload.
        onTerminationReceipt: request.onTerminationReceipt,
        onNativeRequestState: request.onNativeRequestState,
        ...(overrides.responseMode === 'json' ? { responseMode: 'json',
          ...(request.responseSchema !== undefined ? { outputSchema: prepareCodexOutputSchema(request.responseSchema) } : {}) } : {}),
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
        let finalCount = 0;
        let terminalError = null;
        let usage = null;
        let finishReason = 'stop';
        let completed = false;
        for await (const event of nativeClient.streamTurn(turnInput(request, {
          conversationKey: '',
          conversationLabel: 'Brevess structured task',
          responseMode: 'json',
          ephemeral: true
        }))) {
          if (event?.type === 'json_final') {
            finalCount++;
            if (finalCount !== 1 || typeof event.text !== 'string') terminalError ||= localCodexError(
              'CODEX_JSON_PROTOCOL_INVALID', 'Local Codex must return exactly one completed final JSON item');
            else text = event.text;
          } else if (event?.type === 'text_delta') terminalError ||= localCodexError(
            'CODEX_JSON_PROTOCOL_INVALID', 'Unmarked native text cannot satisfy a JSON request');
          else if (event?.type === 'usage') usage = event.usage || usage;
          else if (event?.type === 'completed') {
            usage = event.usage || usage;
            finishReason = String(event.finishReason || 'stop');
            completed = true;
          }
          else if (event?.type === 'cancelled') {
            throw localCodexError('CANCELLED', 'Local Codex request was cancelled', event);
          } else if (event?.type === 'error') {
            terminalError = localCodexError(
              event.error?.code || 'CODEX_BRIDGE_UNAVAILABLE',
              event.error?.message || 'Local Codex request failed',
              event.error || {}
            );
          }
        }
        if (terminalError) throw terminalError;
        if (!completed || finalCount !== 1) throw localCodexError('CODEX_JSON_PROTOCOL_INVALID',
          'Local Codex JSON requires one final item followed by successful completion');
        if (!text.trim()) {
          throw localCodexError('INVALID_RESPONSE', 'Local Codex returned no output');
        }
        if (completed) reportUsage(request, config, usage, text, finishReason);
        return shared.parseJsonText(text, { strictJson: true });
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

  return { createCodexLocalAdapter, prepareCodexOutputSchema };
});
