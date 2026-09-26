(function attach(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(root) {
  const PDF_FIGURE_NATIVE_HOST = 'com.sci_reader.codex_bridge';
  const PDF_FIGURE_MAX_BYTES = 200 * 1024 * 1024;
  const DEFAULT_UPLOAD_CHUNK_BYTES = 512 * 1024;
  const DEFAULT_IMAGE_CHUNK_BYTES = 384 * 1024;

  function nativeFigureError(code, message, retryable = false) {
    const error = new Error(String(message || code || 'PDF Figure engine failed'));
    error.code = String(code || 'PDF_FIGURE_BRIDGE_UNAVAILABLE');
    error.retryable = retryable === true;
    return error;
  }

  function eventChannel() {
    const values = [];
    const waiters = [];
    let terminal = false;
    return {
      push(value) {
        if (terminal) return;
        const waiter = waiters.shift();
        if (waiter) waiter.resolve({ value, done: false });
        else values.push(value);
      },
      close() {
        if (terminal) return;
        terminal = true;
        while (waiters.length) waiters.shift().resolve({ value: undefined, done: true });
      },
      [Symbol.asyncIterator]() {
        return {
          next() {
            if (values.length) return Promise.resolve({ value: values.shift(), done: false });
            if (terminal) return Promise.resolve({ value: undefined, done: true });
            return new Promise((resolve, reject) => waiters.push({ resolve, reject }));
          },
          return() {
            terminal = true;
            while (waiters.length) waiters.shift().resolve({ value: undefined, done: true });
            return Promise.resolve({ value: undefined, done: true });
          }
        };
      }
    };
  }

  function toUint8Array(value) {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) {
      return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    }
    throw nativeFigureError('PDF_FIGURE_INPUT_INVALID', 'PDF bytes are missing');
  }

  function bytesToBase64(bytes) {
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
    }
    let binary = '';
    const step = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += step) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + step));
    }
    return btoa(binary);
  }

  function base64ToBytes(value) {
    const text = String(value || '').replace(/\s+/g, '');
    if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(text, 'base64'));
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }

  async function sha256Hex(bytes) {
    const view = toUint8Array(bytes);
    const subtle = root.crypto?.subtle;
    if (!subtle) throw nativeFigureError(
      'PDF_FIGURE_HASH_UNAVAILABLE',
      'This browser cannot verify PDF Figure data'
    );
    const digest = await subtle.digest(
      'SHA-256',
      view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength)
    );
    return Array.from(new Uint8Array(digest), value =>
      value.toString(16).padStart(2, '0')
    ).join('');
  }

  function createPdfFigureNativeClient(runtime, options = {}) {
    if (!runtime || typeof runtime.connectNative !== 'function') {
      throw nativeFigureError(
        'PDF_FIGURE_BRIDGE_UNAVAILABLE',
        'Native Messaging is unavailable'
      );
    }
    const hostName = String(options.hostName || PDF_FIGURE_NATIVE_HOST);
    const uploadChunkBytes = Math.max(64 * 1024, Math.min(
      512 * 1024,
      Number(options.uploadChunkBytes) || DEFAULT_UPLOAD_CHUNK_BYTES
    ));
    const imageChunkBytes = Math.max(64 * 1024, Math.min(
      512 * 1024,
      Number(options.imageChunkBytes) || DEFAULT_IMAGE_CHUNK_BYTES
    ));
    const controls = new Map();
    const extractions = new Map();
    let port = null;
    let sequence = 0;

    function requestId(prefix) {
      sequence += 1;
      return `${prefix}-${Date.now().toString(36)}-${sequence.toString(36)}`;
    }

    function closeControl(id, error, value) {
      const pending = controls.get(id);
      if (!pending) return;
      controls.delete(id);
      clearTimeout(pending.timer);
      if (error) pending.reject(error);
      else pending.resolve(value);
    }

    function closeExtraction(id, terminalEvent) {
      const pending = extractions.get(id);
      if (!pending) return;
      extractions.delete(id);
      clearTimeout(pending.timer);
      pending.signal?.removeEventListener?.('abort', pending.abortHandler);
      if (terminalEvent) pending.channel.push(terminalEvent);
      pending.channel.close();
    }

    function messageError(message) {
      return nativeFigureError(
        message.error?.code || 'PDF_FIGURE_BRIDGE_FAILED',
        message.error?.message || 'PDF Figure engine failed',
        message.error?.retryable === true
      );
    }

    function handleMessage(message = {}) {
      const id = String(message.requestId || '');
      if (message.type === 'host.error' || message.type === 'pdf.figure.extract.error' ||
          message.type === 'pdf.translation.error') {
        if (controls.has(id)) closeControl(id, messageError(message));
        else if (extractions.has(id)) closeExtraction(id, {
          type: 'error', error: message.error || {}
        });
        return;
      }
      const control = controls.get(id);
      if (control && control.acceptedTypes.has(String(message.type || ''))) {
        closeControl(id, null, message);
        return;
      }
      const extraction = extractions.get(id);
      if (!extraction) return;
      if (message.type === 'pdf.figure.extract.progress') {
        extraction.channel.push({
          type: 'progress',
          taskId: String(message.taskId || extraction.taskId),
          phase: String(message.phase || 'extracting'),
          progress: Math.max(0, Math.min(100, Number(message.progress) || 0)),
          completedFigures: Math.max(0, Number(message.completedFigures) || 0)
        });
      } else if (message.type === 'pdf.figure.extract.result') {
        closeExtraction(id, {
          type: 'result',
          taskId: String(message.taskId || extraction.taskId),
          extractorVersion: String(message.extractorVersion || ''),
          figures: Array.isArray(message.figures) ? message.figures : [],
          warnings: Array.isArray(message.warnings) ? message.warnings : []
        });
      } else if (message.type === 'pdf.figure.extract.cancelled') {
        closeExtraction(id, { type: 'cancelled', taskId: extraction.taskId });
      }
    }

    function disconnectError() {
      return nativeFigureError(
        'PDF_FIGURE_BRIDGE_UNAVAILABLE',
        runtime.lastError?.message || 'The local PDF Figure engine disconnected',
        true
      );
    }

    function handleDisconnect() {
      const error = disconnectError();
      port = null;
      for (const id of [...controls.keys()]) closeControl(id, error);
      for (const id of [...extractions.keys()]) closeExtraction(id, {
        type: 'error',
        error: { code: error.code, message: error.message, retryable: true }
      });
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
        throw nativeFigureError(
          'PDF_FIGURE_BRIDGE_UNAVAILABLE',
          error?.message || 'Unable to start the local PDF Figure engine',
          true
        );
      }
    }

    function post(message) {
      ensurePort().postMessage(message);
    }

    function control(type, payload, acceptedTypes, controlOptions = {}) {
      const id = requestId(type.replace(/[^a-z]+/gi, '-'));
      const timeoutMs = Math.max(1000, Number(controlOptions.timeoutMs) || 30000);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => closeControl(id, nativeFigureError(
          'REQUEST_TIMEOUT',
          `Timed out while handling ${type}`,
          true
        )), timeoutMs);
        controls.set(id, {
          resolve, reject, timer,
          acceptedTypes: new Set(Array.isArray(acceptedTypes) ? acceptedTypes : [acceptedTypes])
        });
        try {
          post({ type, requestId: id, ...(payload || {}) });
        } catch (error) {
          closeControl(id, nativeFigureError(
            'PDF_FIGURE_BRIDGE_UNAVAILABLE',
            error?.message || 'Unable to contact the local PDF Figure engine',
            true
          ));
        }
      });
    }

    function health(healthOptions = {}) {
      return control(
        'pdf.figure.health',
        {},
        'pdf.figure.health.result',
        { timeoutMs: healthOptions.timeoutMs || 15000 }
      );
    }

    function publishTranslationPage(input = {}) {
      return control(
        'pdf.translation.publish',
        {
          title: String(input.title || 'Parsed PDF').slice(0, 500),
          articleHtml: String(input.articleHtml || ''),
          sourceUrl: String(input.sourceUrl || '').slice(0, 8000)
        },
        'pdf.translation.published',
        { timeoutMs: input.timeoutMs || 60000 }
      );
    }

    function extract(input = {}) {
      const channel = eventChannel();
      queueMicrotask(async () => {
        let taskId = '';
        let commitRequestId = '';
        try {
          const bytes = toUint8Array(input.pdfBytes);
          if (bytes.length < 5 || bytes.length > PDF_FIGURE_MAX_BYTES ||
              String.fromCharCode(...bytes.subarray(0, 5)) !== '%PDF-') {
            throw nativeFigureError(
              bytes.length > PDF_FIGURE_MAX_BYTES
                ? 'PDF_FIGURE_INPUT_TOO_LARGE' : 'PDF_FIGURE_INPUT_INVALID',
              'The local Figure engine requires a valid PDF up to 200 MB'
            );
          }
          const fingerprint = String(input.documentFingerprint || '').toLowerCase();
          if (!/^[a-f0-9]{64}$/.test(fingerprint)) {
            throw nativeFigureError(
              'PDF_FIGURE_FINGERPRINT_INVALID',
              'A valid PDF fingerprint is required'
            );
          }
          taskId = requestId('pdf-figure-task');
          const ready = await control(
            'pdf.figure.extract.begin',
            {
              taskId,
              documentFingerprint: fingerprint,
              fileName: String(input.fileName || 'article.pdf').slice(0, 180),
              kind: input.kind === 'supplemental' ? 'supplemental' : 'main',
              totalBytes: bytes.length
            },
            'pdf.figure.upload.ready',
            { timeoutMs: input.uploadTimeoutMs || 30000 }
          );
          let offset = Math.max(0, Number(ready.nextOffset) || 0);
          while (offset < bytes.length) {
            if (input.signal?.aborted) throw nativeFigureError(
              'PDF_FIGURE_CANCELLED', 'PDF Figure extraction was cancelled'
            );
            const chunk = bytes.subarray(offset, Math.min(bytes.length, offset + uploadChunkBytes));
            const ack = await control(
              'pdf.figure.extract.chunk',
              { taskId, offset, data: bytesToBase64(chunk) },
              'pdf.figure.upload.ack',
              { timeoutMs: input.uploadTimeoutMs || 30000 }
            );
            const nextOffset = Number(ack.nextOffset);
            if (!Number.isInteger(nextOffset) || nextOffset !== offset + chunk.length) {
              throw nativeFigureError(
                'PDF_FIGURE_UPLOAD_OFFSET',
                'The local Figure engine rejected a PDF upload chunk'
              );
            }
            offset = nextOffset;
            channel.push({
              type: 'upload_progress',
              taskId,
              uploadedBytes: offset,
              totalBytes: bytes.length,
              progress: Math.round(offset / bytes.length * 100)
            });
          }
          commitRequestId = requestId('pdf-figure-commit');
          const timeoutMs = Math.max(10000, Number(input.timeoutMs) || 10 * 60 * 1000);
          const abortHandler = () => {
            try {
              post({
                type: 'pdf.figure.extract.cancel',
                requestId: requestId('pdf-figure-cancel'),
                taskId
              });
            } catch (_) {
              // Disconnect handling closes the stream.
            }
          };
          const timer = setTimeout(() => abortHandler(), timeoutMs);
          extractions.set(commitRequestId, {
            channel,
            taskId,
            timer,
            signal: input.signal,
            abortHandler
          });
          input.signal?.addEventListener?.('abort', abortHandler, { once: true });
          post({
            type: 'pdf.figure.extract.commit',
            requestId: commitRequestId,
            taskId
          });
        } catch (error) {
          if (taskId) {
            try {
              post({
                type: 'pdf.figure.extract.cancel',
                requestId: requestId('pdf-figure-cancel'),
                taskId
              });
            } catch (_) {
              // The original error is more actionable.
            }
          }
          if (commitRequestId && extractions.has(commitRequestId)) {
            closeExtraction(commitRequestId, {
              type: error?.code === 'PDF_FIGURE_CANCELLED' ? 'cancelled' : 'error',
              error: { code: error?.code, message: error?.message, retryable: error?.retryable }
            });
          } else {
            channel.push({
              type: error?.code === 'PDF_FIGURE_CANCELLED' ? 'cancelled' : 'error',
              error: { code: error?.code, message: error?.message, retryable: error?.retryable }
            });
            channel.close();
          }
        }
      });
      return channel;
    }

    async function readImage(input = {}) {
      const expectedBytes = Math.max(1, Number(input.byteLength) || 0);
      if (expectedBytes > 96 * 1024 * 1024) throw nativeFigureError(
        'PDF_FIGURE_IMAGE_TOO_LARGE', 'A Figure image exceeded the local limit'
      );
      const chunks = [];
      let offset = 0;
      while (offset < expectedBytes) {
        const result = await control(
          'pdf.figure.image.read',
          {
            taskId: String(input.taskId || ''),
            imageId: String(input.imageId || ''),
            offset,
            length: Math.min(imageChunkBytes, expectedBytes - offset)
          },
          'pdf.figure.image.chunk',
          { timeoutMs: input.timeoutMs || 30000 }
        );
        const chunk = base64ToBytes(result.data);
        if (Number(result.offset) !== offset || !chunk.length ||
            Number(result.nextOffset) !== offset + chunk.length) {
          throw nativeFigureError(
            'PDF_FIGURE_IMAGE_CHUNK_INVALID',
            'The local Figure image stream was incomplete'
          );
        }
        chunks.push(chunk);
        offset += chunk.length;
        if (result.eof === true && offset !== expectedBytes) throw nativeFigureError(
          'PDF_FIGURE_IMAGE_CHUNK_INVALID',
          'The local Figure image ended early'
        );
      }
      const bytes = new Uint8Array(expectedBytes);
      let cursor = 0;
      chunks.forEach(chunk => {
        bytes.set(chunk, cursor);
        cursor += chunk.length;
      });
      const expectedHash = String(input.sha256 || '').toLowerCase();
      const actualHash = await sha256Hex(bytes);
      if (!/^[a-f0-9]{64}$/.test(expectedHash) || actualHash !== expectedHash) {
        throw nativeFigureError(
          'PDF_FIGURE_IMAGE_HASH_MISMATCH',
          'The local Figure image failed integrity verification',
          true
        );
      }
      return {
        bytes,
        mimeType: /^image\/(?:png|jpeg|webp)$/i.test(String(input.mimeType || ''))
          ? String(input.mimeType).toLowerCase() : 'image/png',
        sha256: actualHash
      };
    }

    async function release(taskId, releaseOptions = {}) {
      return control(
        'pdf.figure.extract.release',
        { taskId: String(taskId || '') },
        'pdf.figure.extract.released',
        { timeoutMs: releaseOptions.timeoutMs || 15000 }
      );
    }

    function disconnect() {
      try { port?.disconnect(); } catch (_) { /* already closed */ }
      port = null;
    }

    return {
      health,
      extract,
      readImage,
      release,
      publishTranslationPage,
      disconnect,
      hostName
    };
  }

  return {
    PDF_FIGURE_NATIVE_HOST,
    PDF_FIGURE_MAX_BYTES,
    createPdfFigureNativeClient
  };
});
