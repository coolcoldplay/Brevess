const pendingResponses = new Map();
const networkWorker = new Worker('offscreen-network-worker.js');

networkWorker.onmessage = event => {
  const result = event.data || {};
  const sendResponse = pendingResponses.get(result.requestId);
  if (!sendResponse) return;
  pendingResponses.delete(result.requestId);
  sendResponse(result);
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
};

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
