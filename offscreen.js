const pendingResponses = new Map();
const pendingStreams = new Map();
const networkWorker = new Worker('offscreen-network-worker.js');

networkWorker.onmessage = event => {
  const result = event.data || {};
  const sendResponse = pendingResponses.get(result.requestId);
  if (sendResponse) {
    pendingResponses.delete(result.requestId);
    sendResponse(result);
    return;
  }
  const port = pendingStreams.get(result.requestId);
  if (!port) return;
  try { port.postMessage(result); } catch { /* The caller disconnected. */ }
  if (['completed', 'error', 'cancelled'].includes(result.type)) {
    pendingStreams.delete(result.requestId);
  }
};

networkWorker.onerror = event => {
  const result = {
    success: false,
    stage: 'request',
    status: 0,
    error: { name: 'TypeError', message: String(event?.message || 'Network worker failed') }
  };
  pendingResponses.forEach((sendResponse, requestId) => sendResponse({ ...result, requestId }));
  pendingResponses.clear();
  pendingStreams.forEach((port, requestId) => {
    try { port.postMessage({ ...result, requestId, type: 'error' }); } catch { /* Closed. */ }
  });
  pendingStreams.clear();
};

chrome.runtime.onConnect.addListener(port => {
  if (port?.name !== 'sci-offscreen-network-stream') return;
  const requestIds = new Set();
  port.onMessage.addListener(message => {
    if (message?.target !== 'sci-offscreen-network') return;
    if (message.type === 'SCI_OFFSCREEN_FETCH_STREAM') {
      requestIds.add(message.requestId);
      pendingStreams.set(message.requestId, port);
      networkWorker.postMessage({
        type: 'stream',
        requestId: message.requestId,
        url: message.url,
        options: message.options || {}
      });
      return;
    }
    if (message.type === 'SCI_OFFSCREEN_FETCH_CANCEL') {
      networkWorker.postMessage({ type: 'cancel', requestId: message.requestId });
    }
  });
  port.onDisconnect.addListener(() => {
    requestIds.forEach(requestId => {
      if (pendingStreams.get(requestId) !== port) return;
      pendingStreams.delete(requestId);
      networkWorker.postMessage({ type: 'cancel', requestId });
    });
    requestIds.clear();
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target !== 'sci-offscreen-network') return false;
  if (message.type === 'SCI_OFFSCREEN_FETCH') {
    pendingResponses.set(message.requestId, sendResponse);
    networkWorker.postMessage({
      type: 'fetch',
      requestId: message.requestId,
      url: message.url,
      options: message.options || {}
    });
    return true;
  }
  if (message.type === 'SCI_OFFSCREEN_FETCH_CANCEL') {
    networkWorker.postMessage({ type: 'cancel', requestId: message.requestId });
    return false;
  }
  return false;
});
