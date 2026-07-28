(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  // Native Messaging host IDs are persistent protocol identifiers, not display branding.
  const CODEX_NATIVE_HOST = 'com.sci_reader.codex_bridge';
  const DEFAULT_TIMEOUT_MS = 300000;

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
    let port = null;
    let sequence = 0;

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

    function cancelledEvent(pending) {
      if (pending?.cancelReason === 'timeout') {
        return {
          type: 'error',
          error: {
            code: 'REQUEST_TIMEOUT',
            message: 'Local Codex request timed out',
            retryable: true
          }
        };
      }
      return { type: 'cancelled' };
    }

    function handleMessage(message = {}) {
      const requestId = String(message.requestId || '');
      if (message.type === 'health.result' || message.type === 'reader.event.ack') {
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
      if (message.type === 'turn.started') {
        pending.channel.push({
          type: 'metadata',
          threadId: String(message.threadId || ''),
          turnId: String(message.turnId || '')
        });
      } else if (message.type === 'turn.delta') {
        if (message.text) pending.channel.push({
          type: 'text_delta',
          text: String(message.text)
        });
      } else if (message.type === 'turn.usage') {
        pending.channel.push({ type: 'usage', usage: message.usage || {} });
      } else if (message.type === 'turn.completed') {
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
      for (const requestId of [...controls.keys()]) clearControl(requestId, error);
      for (const requestId of [...streams.keys()]) {
        closeStream(requestId, {
          type: 'error',
          error: { code: error.code, message: error.message, retryable: true }
        });
      }
    }

    function ensurePort() {
      if (port) return port;
      try {
        port = runtime.connectNative(hostName);
        port.onMessage.addListener(handleMessage);
        port.onDisconnect.addListener(handleDisconnect);
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
      let timeout = null;
      let abortHandler = null;

      const cancel = reason => {
        const pending = streams.get(requestId);
        if (!pending) return;
        pending.cancelReason = String(reason || 'cancelled');
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
      streams.set(requestId, {
        channel,
        cancelReason: '',
        cleanup() {
          clearTimeout(timeout);
          signal?.removeEventListener?.('abort', abortHandler);
        }
      });
      try {
        post({
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
          ephemeral: input.ephemeral === true
        });
      } catch (error) {
        closeStream(requestId, {
          type: 'error',
          error: { code: error.code, message: error.message, retryable: error.retryable }
        });
      }
      return channel;
    }

    function disconnect() {
      try {
        port?.disconnect();
      } catch (_) {
        // The browser already closed the native port.
      }
      port = null;
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
