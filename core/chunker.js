(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  function chunkParagraphs(paragraphs, options = {}) {
    const maxChars = Math.max(100, Number(options.maxChars) || 12000);
    const overlapParagraphs = Math.max(0, Number(options.overlapParagraphs ?? 1));
    const items = (Array.isArray(paragraphs) ? paragraphs : []).map(item => ({ ...item }));
    const chunks = [];
    let start = 0;

    while (start < items.length) {
      let end = start;
      let chars = 0;
      const chunkSectionKind = items[start].sectionKind || '';
      const chunkSectionKey = items[start].sectionId || items[start].sectionTitle || '';
      while (end < items.length) {
        const nextSectionKind = items[end].sectionKind || '';
        const nextSectionKey = items[end].sectionId || items[end].sectionTitle || '';
        if (end > start && chunkSectionKind && nextSectionKind &&
            nextSectionKind !== chunkSectionKind) break;
        if (end > start && chunkSectionKind === 'results' &&
            nextSectionKind === 'results' && chunkSectionKey && nextSectionKey &&
            nextSectionKey !== chunkSectionKey) break;
        const paragraphChars = String(items[end].text || '').length;
        if (end > start && chars + paragraphChars > maxChars) break;
        chars += paragraphChars;
        end += 1;
        if (chars >= maxChars) break;
      }

      chunks.push({
        chunkId: `chunk-${String(chunks.length + 1).padStart(3, '0')}`,
        sectionTitle: items[start].sectionTitle || '',
        sectionKind: items[start].sectionKind || '',
        paragraphs: items.slice(start, end).map(item => ({ ...item }))
      });

      if (end >= items.length) break;
      const nextSectionKind = items[end]?.sectionKind || '';
      const nextSectionKey = items[end]?.sectionId || items[end]?.sectionTitle || '';
      const crossesSectionBoundary = chunkSectionKind && nextSectionKind && (
        nextSectionKind !== chunkSectionKind ||
        (chunkSectionKind === 'results' && chunkSectionKey && nextSectionKey &&
          nextSectionKey !== chunkSectionKey)
      );
      start = crossesSectionBoundary
        ? end
        : Math.max(start + 1, end - overlapParagraphs);
    }

    return chunks;
  }

  return { chunkParagraphs };
});
