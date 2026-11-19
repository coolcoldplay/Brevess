(function (root, factory) {
  const api = factory();
  if (typeof module === 'object') module.exports = api;
  root.BrevessPdfResearchSource = api;
})(globalThis, function () {
  'use strict';
  function isReader(url, extensionRoot) {
    try {
      const u = new URL(url), own = new URL(extensionRoot);
      return u.protocol === 'chrome-extension:' && u.host === own.host && u.pathname === '/pdf-reader.html';
    } catch { return false; }
  }
  function snapshot(native, semantic, title) {
    if (native?.phase !== 'text-ready' || !native.structure?.documentHash || !semantic?.paragraphs?.length) {
      throw Error('PDF_SOURCE_NOT_READY');
    }
    const documentHash = native.structure.documentHash;
    if (semantic.documentHash !== documentHash) throw Error('SOURCE_DOCUMENT_CHANGED');
    const records = [];
    for (const p of semantic.paragraphs) {
      const text = String(p.text || '');
      for (let start = 0; start < text.length; start += 1200) {
        records.push({ id: 'pdf-' + (records.length + 1),
          text: text.slice(start, start + 1200), textTruncated: false,
          target: { frame: 'top', nativePdf: { documentHash, paragraphId: p.paragraphId, pageNumber: Number(p.semanticTarget?.pageNumber) || null, pageNumbers: p.semanticTarget?.pageNumbers || [], start } } });
      }
    }
    return { title, documentHash, session: documentHash + ':' + native.documentGeneration,
      version: String(semantic.revision || documentHash), records };
  }
  function overview(s) {
    return { frames: [{ frameId: 0, ok: true, data: {
      frame: 'top', session: s.session, version: s.version, total: s.records.length,
      truncated: false, sample: s.records.slice(0, 3)
    } }], coverage: { available: 1, unavailable: 0 } };
  }
  function read(s, name, args = {}) {
    if (args.frameId !== 0) throw Error('FRAME_NOT_SELECTED');
    if (!['read', 'find', 'inspect'].includes(name)) throw Error('PDF_SOURCE_TOOL_INVALID');
    if (args.id) {
      const record = s.records.find(r => r.id === args.id);
      if (!record) throw Error('SOURCE_EVIDENCE_CHANGED');
      return name === 'inspect' ? record : { items: [record], total: 1, next: null };
    }
    const offset = args.offset ?? 0, limit = args.limit ?? 20;
    if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 80) throw Error('PDF_SOURCE_RANGE_INVALID');
    const query = String(args.query || '').trim().toLowerCase();
    if (name === 'find' && !query) throw Error('PDF_SOURCE_QUERY_REQUIRED');
    const records = name === 'find' ? s.records.filter(r => r.text.toLowerCase().includes(query)) : s.records;
    return { items: records.slice(offset, offset + limit), total: records.length,
      next: offset + limit < records.length ? offset + limit : null, truncated: false };
  }
  return { isReader, snapshot, overview, read };
});

// This listener is loaded only by our own PDF reader. It never injects into
// Chrome's built-in viewer and never exposes the text to page content scripts.
if (typeof document !== 'undefined' && typeof chrome !== 'undefined' &&
    BrevessPdfResearchSource.isReader(location.href, chrome.runtime.getURL(''))) {
  chrome.runtime.onMessage.addListener((m, sender, reply) => {
    if (m?.type !== 'BREVESS_PDF_RESEARCH') return false;
    if (sender.id !== chrome.runtime.id || sender.tab) { reply({ ok: false, error: 'CALLER_DENIED' }); return false; }
    void (async () => {
      const semantic = pdfSemanticArticleChatSnapshot();
      const s = BrevessPdfResearchSource.snapshot(globalThis.__brevessNativePdfDocument, semantic, document.title);
      if (m.command === 'SNAPSHOT') return s;
      if (m.command === 'VERSION') return { session: s.session, version: s.version, documentHash: s.documentHash };
      if (m.command !== 'LOCATE') throw Error('COMMAND_INVALID');
      const target = m.target?.nativePdf;
      if (!target || target.documentHash !== s.documentHash || typeof m.quote !== 'string' || !m.quote.trim()) throw Error('SOURCE_EVIDENCE_CHANGED');
      const record = s.records.find(r => r.target.nativePdf.paragraphId === target.paragraphId && r.target.nativePdf.start === target.start);
      if (!record?.text.includes(m.quote)) throw Error('SOURCE_EVIDENCE_CHANGED');
      const paragraph = semantic.paragraphs.find(p => p.paragraphId === target.paragraphId);
      const result = await verifyAndFocusArticleChatCitation({ ...paragraph.semanticTarget,
        locatorKind: 'pdf-semantic', paragraphId: target.paragraphId,
        documentHash: s.documentHash, quote: m.quote, expectedNormalizedQuote: m.quote });
      if (!result?.focused) throw Error('SOURCE_CITATION_NOT_LOCATED');
      return result;
    })().then(data => reply({ ok: true, data }), e => reply({ ok: false, error: e.message }));
    return true;
  });
}
