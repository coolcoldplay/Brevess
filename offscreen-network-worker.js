const controllers = new Map();

self.onmessage = async event => {
  const message = event.data || {};
  if (message.type === 'cancel') {
    controllers.get(message.requestId)?.abort();
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
    self.postMessage({
      requestId: message.requestId,
      success: true,
      status: response.status,
      body: '',
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
