(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  const AMBIGUOUS_CAUSAL_CUES = new Set(['as', 'since']);

  function sanitizeBuiltInRegexRules(rules) {
    const source = rules && typeof rules === 'object' ? rules : {};
    const sanitized = Object.fromEntries(Object.entries(source).map(([categoryId, category]) => [
      categoryId,
      category && typeof category === 'object'
        ? { ...category, patterns: Array.isArray(category.patterns) ? [...category.patterns] : [] }
        : category
    ]));
    const causality = sanitized.causality;
    if (causality?.isBuiltIn && Array.isArray(causality.patterns)) {
      causality.patterns = causality.patterns.filter(pattern =>
        !AMBIGUOUS_CAUSAL_CUES.has(String(pattern).trim().toLowerCase())
      );
    }
    return sanitized;
  }

  return { sanitizeBuiltInRegexRules };
});
