import './pdf-heading-extractor.js';
import './pdf-semantic-index.js';

const ERROR_CODE = /^[A-Z][A-Z0-9_]{2,79}$/u;
const safeCode = value => ERROR_CODE.test(String(value || ''))
  ? String(value) : 'PDF_SEMANTIC_WORKER_BUILD_FAILED';

self.addEventListener('message', event => {
  const message = event?.data;
  if (message?.type !== 'build' || typeof message.requestId !== 'string') return;
  const requestId = message.requestId.slice(0, 160);
  Promise.resolve().then(() => {
    if (typeof globalThis.SciLLM?.buildPdfSemanticIndex !== 'function') {
      const error = new Error('PDF_SEMANTIC_WORKER_UNAVAILABLE');
      error.code = 'PDF_SEMANTIC_WORKER_UNAVAILABLE';
      throw error;
    }
    return globalThis.SciLLM.buildPdfSemanticIndex(message.input || {});
  }).then(result => {
    self.postMessage({ type: 'result', requestId, result });
  }).catch(error => {
    self.postMessage({ type: 'error', requestId, code: safeCode(error?.code) });
  });
});
