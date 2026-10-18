const controllers = new Map();
const MAX_STREAM_EVENT_BYTES = 64 * 1024;
const MAX_STREAM_ERROR_BYTES = 16 * 1024;
const MAX_ERROR_RESPONSE_BYTES = 16 * 1024;
const MAX_NON_STREAM_RESPONSE_BYTES = 4 * 1024 * 1024;
const RESPONSE_LIMIT_MESSAGE = 'Provider response body exceeded the 4 MiB limit';

class ResponseLimitError extends Error {
  constructor() {
    super(RESPONSE_LIMIT_MESSAGE);
    this.name = 'ResponseLimitError';
    this.code = 'RESPONSE_BODY_TOO_LARGE';
  }
}

function declaredResponseBytes(response) {
  const raw = response?.headers?.get?.('Content-Length');
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim();
  if (!/^\d+$/.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

function utf8ByteLength(value) {
  return new TextEncoder().encode(value).length;
}

function cancelWithoutWaiting(target) {
  try { Promise.resolve(target?.cancel?.()).catch(() => {}); } catch {
    // Cleanup is best effort and must not replace or delay the primary result.
  }
}

function cancelAndReleaseReader(reader) {
  cancelWithoutWaiting(reader);
  try { reader?.releaseLock?.(); } catch { /* Preserve the response limit or read error. */ }
}

function cancelResponseBodyWithoutWaiting(response) {
  let body;
  try { body = response?.body; } catch { return; }
  let reader = null;
  try {
    const getReader = body?.getReader;
    if (typeof getReader === 'function') reader = getReader.call(body);
  } catch {
    // The declared limit remains authoritative even when cleanup cannot acquire a reader.
  }
  if (reader) cancelAndReleaseReader(reader);
  else cancelWithoutWaiting(body);
}

async function readSuccessfulResponseText(response) {
  const declaredBytes = declaredResponseBytes(response);
  if (declaredBytes !== null && declaredBytes > MAX_NON_STREAM_RESPONSE_BYTES) {
    cancelResponseBodyWithoutWaiting(response);
    throw new ResponseLimitError();
  }

  const getReader = response?.body?.getReader;
  if (typeof getReader !== 'function') {
    const text = String(await response.text());
    if (utf8ByteLength(text) > MAX_NON_STREAM_RESPONSE_BYTES) {
      throw new ResponseLimitError();
    }
    return text;
  }

  const reader = getReader.call(response.body);
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let completed = false;
  let text = '';
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) {
        completed = true;
        text += decoder.decode();
        return text;
      }
      const bytes = item.value instanceof Uint8Array
        ? item.value : new Uint8Array(item.value || []);
      if (bytesRead + bytes.length > MAX_NON_STREAM_RESPONSE_BYTES) {
        throw new ResponseLimitError();
      }
      bytesRead += bytes.length;
      text += decoder.decode(bytes, { stream: true });
    }
  } finally {
    if (!completed) cancelAndReleaseReader(reader);
    else {
      try { reader.releaseLock?.(); } catch { /* Preserve the completed response. */ }
    }
  }
}

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
  const successful = response.ok === true;
  const maximumBytes = successful ? MAX_NON_STREAM_RESPONSE_BYTES : MAX_STREAM_ERROR_BYTES;
  let bytesRead = 0;
  let reader = null;
  let completed = false;
  try {
    const declaredBytes = successful ? declaredResponseBytes(response) : null;
    if (declaredBytes !== null && declaredBytes > maximumBytes) {
      cancelResponseBodyWithoutWaiting(response);
      throw new ResponseLimitError();
    }
    reader = response.body?.getReader?.();
    if (reader) {
      const decoder = new TextDecoder();
      while (true) {
        const item = await reader.read();
        if (item.done === true) {
          completed = true;
          break;
        }
        const value = item.value instanceof Uint8Array
          ? item.value : new Uint8Array(item.value || []);
        if (successful && bytesRead + value.length > maximumBytes) {
          throw new ResponseLimitError();
        }
        const allowed = Math.min(value.length, maximumBytes - bytesRead);
        for (let offset = 0; offset < allowed; offset += MAX_STREAM_EVENT_BYTES) {
          const part = value.subarray(offset, Math.min(allowed, offset + MAX_STREAM_EVENT_BYTES));
          const text = decoder.decode(part, { stream: true });
          if (text) postStreamEvent(message.requestId, 'chunk', { text });
        }
        bytesRead += allowed;
        if (!successful && (allowed < value.length || bytesRead >= maximumBytes)) break;
      }
      const tail = decoder.decode();
      if (tail) postStreamEvent(message.requestId, 'chunk', { text: tail });
    } else {
      const responseText = String(await response.text());
      if (successful && utf8ByteLength(responseText) > maximumBytes) {
        throw new ResponseLimitError();
      }
      const body = successful ? responseText : responseText.slice(0, maximumBytes);
      for (let offset = 0; offset < body.length; offset += 16 * 1024) {
        postStreamEvent(message.requestId, 'chunk', {
          text: body.slice(offset, offset + 16 * 1024)
        });
      }
    }
    postStreamEvent(message.requestId, 'completed');
  } catch (error) {
    const responseLimit = error?.name === 'ResponseLimitError' ||
      error?.code === 'RESPONSE_BODY_TOO_LARGE';
    const cancelled = !responseLimit &&
      (error?.name === 'AbortError' || controller.signal.aborted);
    postStreamEvent(message.requestId, cancelled
      ? 'cancelled' : 'error', {
      status: response.status,
      stage: 'response-body',
      error: cancelled ? undefined : responseLimit
        ? {
            name: 'ResponseLimitError',
            code: 'RESPONSE_BODY_TOO_LARGE',
            message: RESPONSE_LIMIT_MESSAGE
          }
        : {
            name: error?.name || 'TypeError',
            message: error?.message || 'Failed to read response'
          }
    });
  } finally {
    if (reader && !completed) cancelAndReleaseReader(reader);
    else {
      try { reader?.releaseLock?.(); } catch { /* Best effort. */ }
    }
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
      contentType: response.headers.get('Content-Type') || '',
      retryAfter: response.headers.get('Retry-After') || ''
    });
    controllers.delete(message.requestId);
    return;
  }

  try {
    const body = await readSuccessfulResponseText(response);
    self.postMessage({
      requestId: message.requestId,
      success: true,
      status: response.status,
      body,
      contentType: response.headers.get('Content-Type') || '',
      retryAfter: response.headers.get('Retry-After') || ''
    });
  } catch (error) {
    const responseLimit = error?.name === 'ResponseLimitError' ||
      error?.code === 'RESPONSE_BODY_TOO_LARGE';
    self.postMessage({
      requestId: message.requestId,
      success: false,
      stage: 'response-body',
      status: response.status,
      error: responseLimit
        ? { name: 'ResponseLimitError', message: RESPONSE_LIMIT_MESSAGE }
        : { name: error?.name || 'TypeError', message: error?.message || 'Failed to read response' }
    });
  } finally {
    controllers.delete(message.requestId);
  }
};
