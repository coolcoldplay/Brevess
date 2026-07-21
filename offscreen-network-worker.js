const controllers = new Map();
const MAX_STREAM_EVENT_BYTES = 64 * 1024;
const MAX_STREAM_ERROR_BYTES = 16 * 1024;
const MAX_ERROR_RESPONSE_BYTES = 16 * 1024;

async function readBoundedResponseText(response, maximumBytes = MAX_ERROR_RESPONSE_BYTES) {
  const reader = response.body?.getReader?.();
  if (!reader) return String(await response.text()).slice(0, maximumBytes);
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = '';
  try {
    while (bytesRead < maximumBytes) {
      const item = await reader.read();
      if (item.done) break;
      const value = item.value instanceof Uint8Array
        ? item.value : new Uint8Array(item.value || []);
      const allowed = Math.min(value.length, maximumBytes - bytesRead);
      text += decoder.decode(value.subarray(0, allowed), { stream: true });
      bytesRead += allowed;
      if (allowed < value.length) break;
    }
    text += decoder.decode();
    if (bytesRead >= maximumBytes) await reader.cancel();
    return text;
  } finally {
    try { reader.releaseLock(); } catch { /* Best effort. */ }
  }
}

function postStreamEvent(requestId, type, value = {}) {
  self.postMessage({ requestId, type, ...value });
}

async function streamResponseBody(message, response, controller) {
  postStreamEvent(message.requestId, 'started', {
    status: response.status,
    ok: response.ok,
    retryAfter: response.headers.get('Retry-After') || '',
    contentType: response.headers.get('Content-Type') || ''
  });
  const maximumBytes = response.ok ? Number.POSITIVE_INFINITY : MAX_STREAM_ERROR_BYTES;
  let bytesRead = 0;
  const reader = response.body?.getReader?.();
  try {
    if (reader) {
      const decoder = new TextDecoder();
      let done = false;
      while (!done && bytesRead < maximumBytes) {
        const item = await reader.read();
        done = item.done === true;
        if (done) break;
        const value = item.value instanceof Uint8Array
          ? item.value : new Uint8Array(item.value || []);
        const allowed = Math.min(value.length, maximumBytes - bytesRead);
        for (let offset = 0; offset < allowed; offset += MAX_STREAM_EVENT_BYTES) {
          const part = value.subarray(offset, Math.min(allowed, offset + MAX_STREAM_EVENT_BYTES));
          const text = decoder.decode(part, { stream: true });
          if (text) postStreamEvent(message.requestId, 'chunk', { text });
        }
        bytesRead += allowed;
        if (allowed < value.length) await reader.cancel();
      }
      const tail = decoder.decode();
      if (tail) postStreamEvent(message.requestId, 'chunk', { text: tail });
    } else {
      const body = String(await response.text()).slice(
        0,
        Number.isFinite(maximumBytes) ? maximumBytes : 4 * 1024 * 1024
      );
      for (let offset = 0; offset < body.length; offset += 16 * 1024) {
        postStreamEvent(message.requestId, 'chunk', {
          text: body.slice(offset, offset + 16 * 1024)
        });
      }
    }
    postStreamEvent(message.requestId, 'completed');
  } catch (error) {
    postStreamEvent(message.requestId, error?.name === 'AbortError' || controller.signal.aborted
      ? 'cancelled' : 'error', {
      status: response.status,
      stage: 'response-body',
      error: error?.name === 'AbortError' || controller.signal.aborted ? undefined : {
        name: error?.name || 'TypeError',
        message: error?.message || 'Failed to read response'
      }
    });
  } finally {
    try { reader?.releaseLock?.(); } catch { /* Best effort. */ }
    controllers.delete(message.requestId);
  }
}

async function handleStreamRequest(message) {
  const controller = new AbortController();
  controllers.set(message.requestId, controller);
  try {
    const response = await fetch(message.url, {
      ...(message.options || {}),
      signal: controller.signal
    });
    await streamResponseBody(message, response, controller);
  } catch (error) {
    postStreamEvent(message.requestId, error?.name === 'AbortError' || controller.signal.aborted
      ? 'cancelled' : 'error', {
      status: 0,
      stage: 'request',
      error: error?.name === 'AbortError' || controller.signal.aborted ? undefined : {
        name: error?.name || 'TypeError',
        message: error?.message || 'Failed to fetch'
      }
    });
    controllers.delete(message.requestId);
  }
}

self.onmessage = async event => {
  const message = event.data || {};
  if (message.type === 'cancel') {
    controllers.get(message.requestId)?.abort();
    return;
  }
  if (message.type === 'stream') {
    await handleStreamRequest(message);
    return;
  }
  if (message.type !== 'fetch') return;

  const controller = new AbortController();
  controllers.set(message.requestId, controller);
  let response;
  try {
    response = await fetch(message.url, {
      ...(message.options || {}),
      signal: controller.signal
    });
  } catch (error) {
    self.postMessage({
      requestId: message.requestId,
      success: false,
      stage: 'request',
      status: 0,
      error: { name: error?.name || 'TypeError', message: error?.message || 'Failed to fetch' }
    });
    controllers.delete(message.requestId);
    return;
  }

  if (!response.ok) {
    let body = '';
    try {
      body = await readBoundedResponseText(response);
    } catch {
      // Preserve the HTTP status even when its diagnostic body cannot be read.
    }
    self.postMessage({
      requestId: message.requestId,
      success: true,
      status: response.status,
      body,
      retryAfter: response.headers.get('Retry-After') || ''
    });
    controllers.delete(message.requestId);
    return;
  }

  try {
    const body = await response.text();
    self.postMessage({
      requestId: message.requestId,
      success: true,
      status: response.status,
      body,
      retryAfter: response.headers.get('Retry-After') || ''
    });
  } catch (error) {
    self.postMessage({
      requestId: message.requestId,
      success: false,
      stage: 'response-body',
      status: response.status,
      error: { name: error?.name || 'TypeError', message: error?.message || 'Failed to read response' }
    });
  } finally {
    controllers.delete(message.requestId);
  }
};
