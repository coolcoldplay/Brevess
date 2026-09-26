(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  const DEFAULT_CONFIDENCE_THRESHOLD = 0.8;
  const MIN_CONFIDENCE_THRESHOLD = 0.5;
  const MAX_CONFIDENCE_THRESHOLD = 0.95;

  function normalizeConfidenceThreshold(value, fallback = DEFAULT_CONFIDENCE_THRESHOLD) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(
      MAX_CONFIDENCE_THRESHOLD,
      Math.max(MIN_CONFIDENCE_THRESHOLD, Math.round(number * 100) / 100)
    );
  }

  function effectiveConfidenceThreshold(category, userThreshold) {
    const globalMinimum = normalizeConfidenceThreshold(userThreshold);
    const categoryMinimum = Number.isFinite(Number(category?.minimumConfidence))
      ? Number(category.minimumConfidence) : 0;
    const inferredMinimum = category?.claimMode === 'inferred' ? 0.9 : 0;
    return Math.min(
      MAX_CONFIDENCE_THRESHOLD,
      Math.max(globalMinimum, categoryMinimum, inferredMinimum)
    );
  }

  function filterAnnotationGroupsByConfidence(groups, threshold) {
    const minimum = normalizeConfidenceThreshold(threshold);
    let hiddenCount = 0;
    let keptCount = 0;
    const annotations = (Array.isArray(groups) ? groups : []).flatMap(group => {
      const categories = (Array.isArray(group.categories) ? group.categories : [])
        .filter(category => {
          const keep = Number(category.confidence) >=
            effectiveConfidenceThreshold(category, minimum);
          if (keep) keptCount += 1;
          else hiddenCount += 1;
          return keep;
        });
      return categories.length ? [{ ...group, categories }] : [];
    });
    return { annotations, hiddenCount, keptCount, threshold: minimum };
  }

  return {
    DEFAULT_CONFIDENCE_THRESHOLD,
    MIN_CONFIDENCE_THRESHOLD,
    MAX_CONFIDENCE_THRESHOLD,
    normalizeConfidenceThreshold,
    effectiveConfidenceThreshold,
    filterAnnotationGroupsByConfidence
  };
});
