(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(shared) {
  function createLiteratureNoteExport({ template, values = {}, fieldEvidence = {}, format = 'markdown' } = {}) {
    const api = globalThis.SciLLM || shared;
    if (!Array.isArray(template?.fields) || !['markdown', 'text'].includes(format)) {
      return { ok: false, error: '笔记模板不可用' };
    }
    const heading = value => String(value || '').replace(/[\r\n]+/g, ' ').trim();
    const sections = [(format === 'markdown' ? '# ' : '') + heading(template.name || '文献笔记')];
    const sourceNumberRegistry = api.createLiteratureNoteSourceNumberRegistry?.({ template, values, fieldEvidence });
    for (const field of template.fields) {
      const value = String(values[field.id] || '');
      const projection = api.projectLiteratureNoteSources(value, { sourceNumberRegistry });
      const display = api.serializeLiteratureNoteSourceProjection(projection);
      if (display === null) return { ok: false, error: `“${heading(field.label)}”的来源无法安全转换，原文已保留` };
      const body = format === 'text' ? api.plainLiteratureNoteCopyText(display) : display;
      if (typeof body !== 'string') return { ok: false, error: '笔记格式无法安全转换，原文已保留' };
      sections.push((format === 'markdown' ? '## ' : '') + heading(field.label), body);
      const rawEvidence = fieldEvidence[field.id];
      if (rawEvidence) {
        const evidence = api.normalizeLiteratureNoteEvidenceRecord?.(rawEvidence);
        if (evidence?.status === 'verified') {
          sections.push('已保存的精确引文（导出时未重新核验）：');
          evidence.locators.forEach((locator, index) => {
            const quote = locator.expectedNormalizedQuote;
            // Escape display syntax only in Markdown; plain copy keeps exact quote text.
            const content = format === 'markdown'
              ? quote.replace(/[\\`*_{}\[\]<>()#+.!|>-]/g, '\\$&').replace(/\n/g, '\n> ') : quote;
            const number = sourceNumberRegistry?.sourceIds?.indexOf(locator.paragraphId);
            const label = number >= 0 ? `来源 ${number + 1}` : `已保存引文 ${index + 1}`;
            sections.push(`${label}：${content}`);
          });
        } else {
          const status = evidence?.status;
          sections.push(status === 'degraded' && evidence.pageAnchor
            ? `来源仅有第 ${evidence.pageAnchor.pageNumber} 页位置，待核验。`
            : ({ stale: '来源已过期，待重新核验。', ambiguous: '来源存在歧义，待核验。',
                missing: '未找到正文来源。', invalid: '来源记录无效，无法定位。',
                'historical-unsaved': '历史内容，来源未保存。' }[status] || '来源记录无法核验。'));
        }
      }
    }
    return { ok: true, text: sections.join('\n\n') + '\n' };
  }
  return { createLiteratureNoteExport };
});
