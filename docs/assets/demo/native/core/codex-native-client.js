(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  // Native Messaging host IDs are persistent protocol identifiers, not display branding.
  const CODEX_NATIVE_HOST = 'com.sci_reader.codex_bridge';
  const DEFAULT_TIMEOUT_MS = 300000;
  // This observes cancellation receipts; it never extends model execution.
  const TERMINATION_RECEIPT_RETENTION_MS = 60000;
  const MAX_TERMINATION_RECEIPTS = 128;

  function bridgeError(code, message, retryable = false, status = 0) {
    const error = new Error(String(message || code || 'Codex bridge failed'));
    error.code = String(code || 'CODEX_BRIDGE_UNAVAILABLE');
    error.retryable = retryable === true;
    if (Number.isFinite(status) && status > 0) error.status = status;
    return error;
  }

  function createEventChannel() {
    const values = [];
    const waiters = [];
    let terminal = false;

    function push(value) {
      if (terminal) return;
      const waiter = waiters.shift();
      if (waiter) waiter.resolve({ value, done: false });
      else values.push(value);
    }

    function close() {
      if (terminal) return;
      terminal = true;
      while (waiters.length) waiters.shift().resolve({ value: undefined, done: true });
    }

    return {
      push,
      close,
      [Symbol.asyncIterator]() {
        return {
          next() {
            if (values.length) return Promise.resolve({ value: values.shift(), done: false });
            if (terminal) return Promise.resolve({ value: undefined, done: true });
            return new Promise((resolve, reject) => waiters.push({ resolve, reject }));
          },
          return() {
            close();
            return Promise.resolve({ value: undefined, done: true });
          }
        };
      }
    };
  }

  function createCodexNativeClient(runtime, options = {}) {
    if (!runtime || typeof runtime.connectNative !== 'function') {
      throw bridgeError('CODEX_BRIDGE_UNAVAILABLE', 'Native Messaging is unavailable');
    }
    const hostName = String(options.hostName || CODEX_NATIVE_HOST);
    const streams = new Map();
    const controls = new Map();
    const terminationReceipts = new Map();
    let port = null;
    let portSessionId = 0;
    let sequence = 0;
    let jsonCapabilities = null;
    let terminationCapabilities = null;
    let jsonCapabilityPort = null;
    let jsonCapabilityCheck = null;

    function nextRequestId(prefix = 'request') {
      sequence += 1;
      return `${prefix}-${Date.now().toString(36)}-${sequence.toString(36)}`;
    }

    function clearControl(requestId, error, value) {
      const pending = controls.get(requestId);
      if (!pending) return;
      controls.delete(requestId);
      clearTimeout(pending.timer);
      if (error) pending.reject(error);
      else pending.resolve(value);
    }

    function closeStream(requestId, terminalEvent) {
      const pending = streams.get(requestId);
      if (!pending) return;
      if (terminalEvent) pending.channel.push(terminalEvent);
      pending.channel.close();
      pending.cleanup?.();
      streams.delete(requestId);
    }

    function nativeDiagnostic(pending, stage = pending.stage) {
      return Object.freeze({ stage, enteredAt: pending.enteredAt,
        dispatchedAt: pending.dispatchedAt, startedAt: pending.startedAt,
        lastActivityAt: pending.lastActivityAt, cancelRequestedAt: pending.cancelRequestedAt,
        terminalAt: pending.terminalAt });
    }

    function reportNativeState(pending, stage) {
      pending.stage = stage;
      try { pending.onNativeRequestState?.(Object.freeze({ requestId: pending.requestId,
        portSessionId: pending.portSessionId || 0, ...nativeDiagnostic(pending) })); }
      catch (_) { /* Diagnostics cannot alter execution or cancellation. */ }
    }

    function finishTerminationReceipt(requestId, details) {
      const receipt = terminationReceipts.get(requestId);
      if (!receipt) return;
      terminationReceipts.delete(requestId);
      clearTimeout(receipt.timer);
      const pending = receipt.pending;
      if (details.state === 'terminal_confirmed') pending.terminalAt = Date.now();
      reportNativeState(pending, details.state === 'terminal_confirmed' ? 'terminal_confirmed' : 'outcome_unknown');
      try { receipt.callback(Object.freeze({ requestId, portSessionId: receipt.portSessionId,
        cancelReason: receipt.cancelReason, ...details, nativeRequestDiagnostic: nativeDiagnostic(pending) })); }
      catch (_) { /* Observation cannot change the original request outcome. */ }
    }

    function retainTerminationReceipt(requestId, pending) {
      if (!pending.started || typeof pending.onTerminationReceipt !== 'function' || terminationReceipts.has(requestId)) return;
      while (terminationReceipts.size >= MAX_TERMINATION_RECEIPTS) {
        finishTerminationReceipt(terminationReceipts.keys().next().value,
          { state: 'unknown', reason: 'receipt_capacity', upstreamStatus: 'unknown' });
      }
      const receipt = { callback: pending.onTerminationReceipt, pending,
        cancelReason: pending.cancelReason, connection: pending.connection,
        portSessionId: pending.portSessionId, protocol: pending.terminationProtocol, timer: null };
      terminationReceipts.set(requestId, receipt);
      receipt.timer = setTimeout(() => finishTerminationReceipt(requestId,
        { state: 'unknown', reason: 'receipt_expired', upstreamStatus: 'unknown' }), TERMINATION_RECEIPT_RETENTION_MS);
      receipt.timer?.unref?.();
    }

    function observeTerminationReceipt(message, requestId) {
      const receipt = terminationReceipts.get(requestId);
      if (!receipt || receipt.connection !== port || !['turn.cancelled', 'turn.completed', 'turn.error'].includes(message.type)) return;
      if (!receipt.protocol) {
        finishTerminationReceipt(requestId, { state: 'unknown', reason: 'terminal_unverified', upstreamStatus: 'unknown' });
        return;
      }
      const identity = value => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,200}$/u.test(value);
      const statuses = message.type === 'turn.cancelled' ? ['interrupted', 'completed']
        : message.type === 'turn.completed' ? ['completed'] : ['completed', 'failed'];
      if (message.terminationReceiptProtocol !== 1 || !statuses.includes(message.upstreamStatus) ||
          !identity(message.threadId) || !identity(message.turnId) ||
          (receipt.pending.threadId && receipt.pending.threadId !== message.threadId) ||
          (receipt.pending.turnId && receipt.pending.turnId !== message.turnId)) return;
      finishTerminationReceipt(requestId, { state: 'terminal_confirmed',
        terminalType: message.type, upstreamStatus: message.upstreamStatus });
    }

    function cancelledEvent(pending) {
      if (pending?.cancelReason === 'timeout') {
        return {
          type: 'error',
          error: {
            code: 'REQUEST_TIMEOUT',
            message: 'Local Codex request timed out',
            retryable: true,
            diagnosticStage: `native_${pending.cancelStage || pending.stage}`,
            diagnosticType: 'absolute_deadline',
            nativeRequestDiagnostic: nativeDiagnostic(pending, pending.cancelStage || pending.stage)
          }
        };
      }
      return { type: 'cancelled', diagnosticStage: `native_${pending.cancelStage || pending.stage}`,
        diagnosticType: 'explicit_abort', nativeRequestDiagnostic: nativeDiagnostic(pending, pending.cancelStage || pending.stage) };
    }

    function handleMessage(message = {}) {
      const requestId = String(message.requestId || '');
      observeTerminationReceipt(message, requestId);
      if (message.type === 'health.result' || message.type === 'reader.event.ack') {
        if (message.type === 'health.result' && controls.get(requestId)?.connection === port) {
          const value = message.jsonResponseCapabilities;
          jsonCapabilities = value && typeof value === 'object' ? {
            version: value.version, completedFinal: value.completedFinal,
            outputSchemaForwarding: value.outputSchemaForwarding
          } : null;
          jsonCapabilityPort = port;
          terminationCapabilities = message.terminationReceiptCapabilities?.version === 1 &&
            message.terminationReceiptCapabilities.upstreamTerminal === true;
        }
        clearControl(requestId, null, message);
        return;
      }
      if (message.type === 'auth.login.started') {
        clearControl(requestId, null, {
          loginId: String(message.loginId || ''),
          authUrl: String(message.authUrl || '')
        });
        return;
      }
      if (message.type === 'auth.logout.result') {
        clearControl(requestId, null, { success: message.success === true });
        return;
      }
      if (message.type === 'host.error' && controls.has(requestId)) {
        clearControl(requestId, bridgeError(
          message.error?.code,
          message.error?.message,
          message.error?.retryable,
          message.error?.status
        ));
        return;
      }
      const pending = streams.get(requestId);
      if (!pending) return;
      if (pending.responseMode === 'json' && pending.cancelReason) {
        closeStream(requestId, cancelledEvent(pending));
        return;
      }
      if (message.type === 'turn.started') {
        if (!pending.turnId && typeof message.threadId === 'string' && message.threadId &&
            typeof message.turnId === 'string' && message.turnId) {
          pending.threadId = message.threadId;
          pending.turnId = message.turnId;
          pending.startedAt = pending.lastActivityAt = Date.now();
          reportNativeState(pending, 'running');
        }
        pending.channel.push({
          type: 'metadata',
          threadId: String(message.threadId || ''),
          turnId: String(message.turnId || '')
        });
      } else if (message.type === 'turn.delta') {
        if (pending.responseMode === 'json') {
          if (typeof message.text !== 'string' || typeof message.itemId !== 'string' || !message.itemId ||
              message.phase !== 'final' || message.itemCompleted !== true || message.jsonResponseProtocol !== 1 ||
              typeof message.schemaForwarded !== 'boolean' || (pending.hasOutputSchema && message.schemaForwarded !== true) ||
              pending.jsonFinalCount !== 0) {
            closeStream(requestId, { type: 'error', error: { code: 'CODEX_JSON_PROTOCOL_INVALID',
              message: 'Expected exactly one completed final JSON item from the native bridge', retryable: false } });
            return;
          }
          pending.jsonFinalCount++;
          pending.channel.push({ type: 'json_final', text: message.text, itemId: message.itemId,
            phase: message.phase, itemCompleted: message.itemCompleted, jsonResponseProtocol: message.jsonResponseProtocol,
            schemaForwarded: message.schemaForwarded });
        } else if (message.text) pending.channel.push({
          type: 'text_delta',
          text: String(message.text)
        });
      } else if (message.type === 'turn.item.diagnostic') {
        if (typeof message.itemId === 'string' && message.itemId.length > 0 && message.itemId.length <= 200 &&
            ['started', 'delta', 'completed'].includes(message.eventType) &&
            ['commentary', 'final', 'unknown'].includes(message.phase) &&
            Number.isSafeInteger(message.textLength) && message.textLength >= 0 &&
            typeof message.textHash === 'string' && /^[a-f0-9]{64}$/u.test(message.textHash)) {
          const signature = `${message.eventType}:${message.phase}:${message.textLength}:${message.textHash}`;
          if (pending.activityItems.get(message.itemId) !== signature &&
              (pending.activityItems.has(message.itemId) || pending.activityItems.size < 128)) {
            pending.activityItems.set(message.itemId, signature);
            pending.lastActivityAt = Date.now();
          }
        }
        pending.channel.push({ type: 'metadata', itemId: message.itemId, phase: message.phase,
          eventType: message.eventType, textLength: message.textLength, textHash: message.textHash });
      } else if (message.type === 'turn.usage') {
        pending.channel.push({ type: 'usage', usage: message.usage || {} });
      } else if (message.type === 'turn.completed') {
        if (pending.responseMode === 'json' && pending.jsonFinalCount !== 1) {
          closeStream(requestId, { type: 'error', error: { code: 'CODEX_JSON_PROTOCOL_INVALID',
            message: 'Native JSON completion requires exactly one final item', retryable: false } });
          return;
        }
        pending.terminalAt = Date.now();
        reportNativeState(pending, 'completed');
        closeStream(requestId, {
          type: 'completed',
          finishReason: String(message.finishReason || 'stop'),
          usage: message.usage || null
        });
      } else if (message.type === 'turn.cancelled') {
        closeStream(requestId, cancelledEvent(pending));
      } else if (message.type === 'turn.error' || message.type === 'host.error') {
        closeStream(requestId, {
          type: 'error',
          error: {
            code: String(message.error?.code || 'CODEX_BRIDGE_UNAVAILABLE'),
            message: String(message.error?.message || 'Codex bridge failed'),
            retryable: message.error?.retryable === true,
            status: Number(message.error?.status) || 0
          }
        });
      }
    }

    function handleDisconnect() {
      const runtimeError = runtime.lastError;
      const error = bridgeError(
        'CODEX_BRIDGE_UNAVAILABLE',
        runtimeError?.message || 'The local Codex bridge disconnected',
        true
      );
      port = null;
      jsonCapabilities = null;
      terminationCapabilities = null;
      jsonCapabilityPort = null;
      jsonCapabilityCheck = null;
      for (const requestId of [...controls.keys()]) clearControl(requestId, error);
      for (const requestId of [...streams.keys()]) {
        const pending = streams.get(requestId);
        const diagnosticStage = `native_${pending.cancelStage || pending.stage}`;
        const diagnostic = nativeDiagnostic(pending, pending.cancelStage || pending.stage);
        reportNativeState(pending, 'outcome_unknown');
        closeStream(requestId, {
          type: 'error',
          error: { code: error.code, message: error.message, retryable: true,
            diagnosticStage, diagnosticType: 'bridge_disconnected', nativeRequestDiagnostic: diagnostic }
        });
      }
      for (const requestId of [...terminationReceipts.keys()]) {
        finishTerminationReceipt(requestId,
          { state: 'unknown', reason: 'bridge_disconnected', upstreamStatus: 'unknown' });
      }
    }

    function ensurePort() {
      if (port) return port;
      try {
        const connectedPort = runtime.connectNative(hostName);
        port = connectedPort;
        portSessionId += 1;
        connectedPort.onMessage.addListener(message => { if (port === connectedPort) handleMessage(message); });
        connectedPort.onDisconnect.addListener(() => { if (port === connectedPort) handleDisconnect(); });
        return port;
      } catch (error) {
        port = null;
        throw bridgeError(
          'CODEX_BRIDGE_UNAVAILABLE',
          error?.message || 'Unable to start the local Codex bridge'
        );
      }
    }

    function post(message) {
      try {
        ensurePort().postMessage(message);
      } catch (error) {
        throw bridgeError(
          'CODEX_BRIDGE_UNAVAILABLE',
          error?.message || 'Unable to contact the local Codex bridge',
          true
        );
      }
    }

    function health(options = {}) {
      const requestId = nextRequestId('health');
      const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 20000);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          clearControl(requestId, bridgeError(
            'REQUEST_TIMEOUT',
            'Timed out while checking the local Codex installation',
            true
          ));
        }, timeoutMs);
        controls.set(requestId, { resolve, reject, timer });
        try {
          controls.get(requestId).connection = ensurePort();
          post({ type: 'health.check', requestId });
        } catch (error) {
          clearControl(requestId, error);
        }
      });
    }

    function controlRequest(type, payload = {}, options = {}) {
      const requestId = nextRequestId(type.replace(/\./g, '-'));
      const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 30000);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          clearControl(requestId, bridgeError(
            'REQUEST_TIMEOUT',
            `Timed out while handling ${type}`,
            true
          ));
        }, timeoutMs);
        controls.set(requestId, { resolve, reject, timer });
        try {
          post({ type, requestId, ...payload });
        } catch (error) {
          clearControl(requestId, error);
        }
      });
    }

    function startLogin(options = {}) {
      return controlRequest(
        'auth.login.start',
        { force: options.force === true },
        options
      );
    }

    function logout(options = {}) {
      return controlRequest('auth.logout', {}, options);
    }

    function publishReaderEvent(event, options = {}) {
      return controlRequest('reader.event.publish', { event }, {
        ...options,
        timeoutMs: options.timeoutMs || 15000
      });
    }

    function streamTurn(input = {}) {
      const requestId = nextRequestId('turn');
      const channel = createEventChannel();
      const signal = input.signal;
      const timeoutMs = Math.max(1000, Number(input.timeoutMs) || DEFAULT_TIMEOUT_MS);
      const jsonMode = input.responseMode === 'json';
      const hasOutputSchema = jsonMode && input.outputSchema !== undefined;
      let timeout = null;
      let abortHandler = null;

      const cancel = reason => {
        const pending = streams.get(requestId);
        if (!pending) return;
        pending.cancelReason = String(reason || 'cancelled');
        pending.cancelStage = pending.stage;
        pending.cancelRequestedAt = Date.now();
        reportNativeState(pending, 'cancel_requested');
        if (jsonMode) {
          retainTerminationReceipt(requestId, pending);
          if (pending.started) {
            try { post({ type: 'turn.cancel', requestId, reason: pending.cancelReason }); } catch (_) {}
          }
          closeStream(requestId, cancelledEvent(pending));
          return;
        }
        try {
          post({ type: 'turn.cancel', requestId, reason: String(reason || 'cancelled') });
          setTimeout(() => {
            const current = streams.get(requestId);
            if (current) closeStream(requestId, cancelledEvent(current));
          }, 15000);
        } catch (_) {
          closeStream(requestId, cancelledEvent(pending));
        }
      };

      abortHandler = () => cancel('aborted');
      if (signal?.aborted) {
        channel.push({ type: 'cancelled' });
        channel.close();
        return channel;
      }
      signal?.addEventListener?.('abort', abortHandler, { once: true });
      timeout = setTimeout(() => cancel('timeout'), timeoutMs);
      const pending = {
        channel,
        cancelReason: '',
        responseMode: jsonMode ? 'json' : 'text',
        hasOutputSchema,
        jsonFinalCount: 0,
        requestId, stage: 'handshake', enteredAt: Date.now(), dispatchedAt: null,
        startedAt: null, lastActivityAt: null, cancelRequestedAt: null, terminalAt: null,
        threadId: '', turnId: '', activityItems: new Map(),
        onNativeRequestState: input.onNativeRequestState,
        onTerminationReceipt: input.onTerminationReceipt,
        connection: null,
        started: false,
        cleanup() {
          clearTimeout(timeout);
          signal?.removeEventListener?.('abort', abortHandler);
        }
      };
      streams.set(requestId, pending);
      reportNativeState(pending, 'handshake');
      let payload;
      try {
        payload = {
          type: 'turn.start',
          requestId,
          conversationKey: String(input.conversationKey || ''),
          conversationLabel: String(input.conversationLabel || ''),
          profileId: String(input.profileId || ''),
          model: String(input.model || 'auto'),
          reasoningEffort: String(input.reasoningEffort || 'auto'),
          systemPrompt: String(input.systemPrompt || ''),
          userPrompt: String(input.userPrompt || ''),
          images: (Array.isArray(input.images) ? input.images : [])
            .slice(0, 8)
            .map(image => ({
              mediaType: String(image?.mediaType || ''),
              dataUrl: String(image?.dataUrl || ''),
              detail: String(image?.detail || 'high')
            }))
            .filter(image => /^data:image\/(?:jpeg|png|webp);base64,/i.test(image.dataUrl)),
          maxOutputTokens: Math.max(0, Number(input.maxOutputTokens) || 0),
          ephemeral: input.ephemeral === true,
          ...(jsonMode ? { responseMode: 'json', ...(hasOutputSchema ? { outputSchema: input.outputSchema } : {}) } : {})
        };
      } catch (error) {
        closeStream(requestId, { type: 'error',
          error: { code: error.code, message: error.message, retryable: error.retryable } });
        return channel;
      }
      const dispatch = () => {
        if (streams.get(requestId) !== pending) return;
        if (signal?.aborted || pending.cancelReason) { cancel('aborted'); return; }
        pending.connection = ensurePort();
        pending.portSessionId = portSessionId;
        pending.terminationProtocol = terminationCapabilities === true;
        pending.started = true;
        pending.dispatchedAt = Date.now();
        pending.stage = 'submitted';
        post(payload);
        // A local observer may synchronously abort. Notify only after posting,
        // and never overwrite a synchronously received running/terminal state.
        if (streams.get(requestId) === pending && pending.stage === 'submitted') reportNativeState(pending, 'submitted');
      };
      const fail = error => {
        if (streams.get(requestId) !== pending) return;
        closeStream(requestId, { type: 'error',
          error: { code: error.code, message: error.message, retryable: error.retryable,
            diagnosticStage: `native_${pending.stage}`, diagnosticType: 'bridge_failure',
            nativeRequestDiagnostic: nativeDiagnostic(pending) } });
      };
      if (!jsonMode) {
        try { dispatch(); } catch (error) { fail(error); }
      } else {
        (async () => {
          const connection = ensurePort();
          if (jsonCapabilityPort !== connection) {
            if (!jsonCapabilityCheck || jsonCapabilityCheck.connection !== connection) {
              const check = { connection, promise: health({ timeoutMs: Math.min(timeoutMs, 20000) }) };
              jsonCapabilityCheck = check;
              check.promise.finally(() => { if (jsonCapabilityCheck === check) jsonCapabilityCheck = null; }).catch(() => {});
            }
            await jsonCapabilityCheck.promise;
          }
          if (streams.get(requestId) !== pending) return;
          if (signal?.aborted || pending.cancelReason) { cancel('aborted'); return; }
          if (port !== connection || jsonCapabilityPort !== connection || jsonCapabilities?.version !== 1 ||
              jsonCapabilities.completedFinal !== true || (hasOutputSchema && jsonCapabilities.outputSchemaForwarding !== true))
            throw bridgeError('CODEX_JSON_PROTOCOL_UNAVAILABLE', 'The native bridge lacks the completed-final JSON response protocol');
          dispatch();
        })().catch(fail);
      }
      return channel;
    }

    function disconnect() {
      const connectedPort = port;
      try {
        port?.disconnect();
      } catch (_) {
        // The browser already closed the native port.
      }
      if (port === connectedPort && port) handleDisconnect();
      port = null;
      jsonCapabilities = null;
      jsonCapabilityPort = null;
      jsonCapabilityCheck = null;
    }

    return {
      health,
      startLogin,
      logout,
      publishReaderEvent,
      streamTurn,
      disconnect,
      hostName
    };
  }

  return {
    CODEX_NATIVE_HOST,
    createCodexNativeClient,
    createCodexNativeEventChannel: createEventChannel
  };
});
