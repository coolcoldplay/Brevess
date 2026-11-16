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

  // One scientific sentence may have multiple anchors/categories. Keep the
  // locally grounded scores, deduplicate sentence identity, and simulate the
  // renderer's descending-start overlap rule for the current threshold.
  function buildConfidenceSentenceDistribution(groups, threshold, selectedCategoryIds) {
    const selected = new Set(Array.isArray(selectedCategoryIds) ? selectedCategoryIds : []);
    const candidates = (Array.isArray(groups) ? groups : []).filter(group =>
      typeof group?.paragraphId === 'string' && Number.isSafeInteger(group.start) &&
      Number.isSafeInteger(group.end) && group.start >= 0 && group.end > group.start &&
      Array.isArray(group.sentenceKeys) && group.sentenceKeys.length
    ).map(group => ({ ...group, categories: (Array.isArray(group.categories) ? group.categories : [])
      .filter(category => selected.has(category?.categoryId) &&
        Number.isFinite(Number(category.confidence)) && Number(category.confidence) >= 0 &&
        Number(category.confidence) <= 1) }));
    const base = filterAnnotationGroupsByConfidence(candidates, MIN_CONFIDENCE_THRESHOLD).annotations;
    const scores = new Map();
    for (const group of base) {
      const score = Math.max(...group.categories.map(category => Number(category.confidence)));
      for (const key of group.sentenceKeys.filter(key => typeof key === 'string' && key)) {
        scores.set(key, Math.max(scores.get(key) || 0, score));
      }
    }
    // Producer categories are already in presentation priority order. Retained
    // sentences use the first surviving primary of the first renderer-accepted
    // anchor; excluded sentences retain their baseline category color. Scores
    // still use the strongest grounded relation, preserving existing bins.
    const baselineOwners = new Map();
    for (const group of base.slice().sort((a,b) => b.start - a.start)) {
      for (const key of group.sentenceKeys) {
        if (scores.has(key) && !baselineOwners.has(key)) baselineOwners.set(key, group.categories[0].categoryId);
      }
    }
    const keptKeys = new Set(), accepted = new Map(), keptOwners = new Map();
    const filtered = filterAnnotationGroupsByConfidence(base, threshold);
    for (const group of filtered.annotations.slice().sort((a,b) => b.start - a.start)) {
      const ranges = accepted.get(group.paragraphId) || [];
      if (ranges.some(range => range.start < group.end && group.start < range.end)) continue;
      ranges.push(group); accepted.set(group.paragraphId, ranges);
      group.sentenceKeys.forEach(key => {
        if (!scores.has(key)) return;
        keptKeys.add(key);
        if (!keptOwners.has(key)) keptOwners.set(key, group.categories[0].categoryId);
      });
    }
    const bins = Array.from({length:10}, (_, index) => ({
      lower: .5 + index * .05, upper: .55 + index * .05, count:0, kept:0, excluded:0,
      categories:[]
    }));
    for (const [key,score] of scores) {
      const bin = bins[Math.min(9, Math.max(0, Math.floor((score - .5) / .05 + 1e-8)))];
      const field = keptKeys.has(key) ? 'kept' : 'excluded';
      const categoryId = keptOwners.get(key) || baselineOwners.get(key);
      let category = bin.categories.find(item => item.categoryId === categoryId);
      if (!category) {
        category = { categoryId, count:0, kept:0, excluded:0 };
        bin.categories.push(category);
      }
      category.count += 1; category[field] += 1;
      bin.count += 1; bin[field] += 1;
    }
    bins.forEach(bin => bin.categories.sort((a,b) => String(a.categoryId).localeCompare(String(b.categoryId))));
    return { bins, total:scores.size, kept:keptKeys.size, excluded:scores.size-keptKeys.size,
      threshold:filtered.threshold, scoreMinimum:.5, scoreMaximum:1 };
  }

  return {
    DEFAULT_CONFIDENCE_THRESHOLD,
    MIN_CONFIDENCE_THRESHOLD,
    MAX_CONFIDENCE_THRESHOLD,
    normalizeConfidenceThreshold,
    effectiveConfidenceThreshold,
    filterAnnotationGroupsByConfidence,
    buildConfidenceSentenceDistribution
  };
});
