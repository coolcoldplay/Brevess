(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory(shared) {
  const fallbackI18n = typeof module === 'object' && module.exports ? require('./i18n-export.js') : {};
  function createLiteratureNoteExport({ template, values = {}, fieldEvidence = {}, format = 'markdown', language, interfaceLanguage, outputLanguage } = {}) {
    const api = globalThis.SciLLM || shared;
    const locale = outputLanguage || interfaceLanguage || language || api.getInterfaceLanguage?.() || 'zh-CN';
    const english = String(locale).toLowerCase().startsWith('en');
    const text = value => (api.translateExportBuiltin || fallbackI18n.translateExportBuiltin)?.(value, locale) ?? value;
    const message = (parts, ...values) => (api.formatExportBuiltin || fallbackI18n.formatExportBuiltin)?.(parts, values, locale)
      ?? parts.reduce((result, part, index) => result + part + (values[index] ?? ''), '');
    if (!Array.isArray(template?.fields) || !['markdown', 'text'].includes(format)) {
      return { ok: false, error: text('笔记模板不可用') };
    }
    const displayTemplate = api.localizeBuiltinSettings?.({ literatureNoteTemplates: [template] }, locale)?.literatureNoteTemplates?.[0] || template;
    const heading = value => String(value || '').replace(/[\r\n]+/g, ' ').trim();
    const sections = [(format === 'markdown' ? '# ' : '') + heading(displayTemplate.name || text('文献笔记'))];
    const sourceNumberRegistry = api.createLiteratureNoteSourceNumberRegistry?.({ template, values, fieldEvidence });
    for (const field of template.fields) {
      const value = String(values[field.id] || '');
      const projection = api.projectLiteratureNoteSources(value, { sourceNumberRegistry });
      let display = api.serializeLiteratureNoteSourceProjection(projection);
      const fieldLabel = displayTemplate.fields.find(item => item.id === field.id)?.label || field.label;
      if (display === null) return { ok: false, error: message`“${heading(fieldLabel)}”的来源无法安全转换，原文已保留` };
      // Only replace validated generated source-token ranges. Never search or
      // translate the surrounding authored note or literal lookalike text.
      if (english) for (const ref of [...projection.references].reverse()) {
        const marker = `⟦Citation ${ref.index + 1}: ${ref.sourceNumbers.map(number => `Source ${number}`).join(', ')} (unverified)⟧`;
        display = display.slice(0, ref.start) + marker + display.slice(ref.end);
      }
      const body = format === 'text' ? api.plainLiteratureNoteCopyText(display) : display;
      if (typeof body !== 'string') return { ok: false, error: text('笔记格式无法安全转换，原文已保留') };
      sections.push((format === 'markdown' ? '## ' : '') + heading(fieldLabel), body);
      const rawEvidence = fieldEvidence[field.id];
      if (rawEvidence) {
        const evidence = api.normalizeLiteratureNoteEvidenceRecord?.(rawEvidence);
        if (evidence?.status === 'verified') {
          sections.push(text('已保存的精确引文（导出时未重新核验）：'));
          evidence.locators.forEach((locator, index) => {
            const quote = locator.expectedNormalizedQuote;
            // Escape display syntax only in Markdown; plain copy keeps exact quote text.
            const content = format === 'markdown'
              ? quote.replace(/[\\`*_{}\[\]<>()#+.!|>-]/g, '\\$&').replace(/\n/g, '\n> ') : quote;
            const number = sourceNumberRegistry?.sourceIds?.indexOf(locator.paragraphId);
            const label = number >= 0 ? message`来源 ${number + 1}` : message`已保存引文 ${index + 1}`;
            sections.push(`${label}${english ? ': ' : '：'}${content}`);
          });
        } else {
          const status = evidence?.status;
          sections.push(status === 'degraded' && evidence.pageAnchor
            ? message`来源仅有第 ${evidence.pageAnchor.pageNumber} 页位置，待核验。`
            : text({ stale: '来源已过期，待重新核验。', ambiguous: '来源存在歧义，待核验。',
                missing: '未找到正文来源。', invalid: '来源记录无效，无法定位。',
                'historical-unsaved': '历史内容，来源未保存。' }[status] || '来源记录无法核验。'));
        }
      }
    }
    return { ok: true, text: sections.join('\n\n') + '\n' };
  }
  return { createLiteratureNoteExport };
});
