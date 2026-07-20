(function attach(root, factory) {
  const api = factory(root.SciLLM || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SciLLM = Object.assign(root.SciLLM || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  function stableHash(value) {
    const text = JSON.stringify(value);
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  function canonicalizeJson(value) {
    if (Array.isArray(value)) return value.map(canonicalizeJson);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(
      Object.keys(value).sort().map(key => [key, canonicalizeJson(value[key])])
    );
  }

  function buildEffectiveCategorySignature(category) {
    return stableHash(canonicalizeJson(category || {}));
  }

  function buildCategoryCacheKey(input) {
    const context = {
      documentHash: input.documentHash,
      providerId: input.providerId,
      model: input.model,
      categoryId: input.categoryId,
      categoryVersion: input.categoryVersion,
      promptVersion: input.promptVersion,
      chunkerVersion: input.chunkerVersion,
      contextHash: input.contextHash || ''
    };
    if (input.effectiveCategorySignature) {
      context.effectiveCategorySignature = input.effectiveCategorySignature;
    }
    if (input.profileSignature) context.profileSignature = input.profileSignature;
    return `llm:${stableHash(context)}`;
  }

  function buildProfileCacheKey(input) {
    const context = {
      documentHash: input.documentHash,
      providerId: input.providerId,
      model: input.model,
      classifierVersion: input.classifierVersion
    };
    if (input.profileSignature) context.profileSignature = input.profileSignature;
    return `profile:${stableHash(context)}`;
  }

  function buildLedgerCacheKey(input) {
    const context = {
      documentHash: input.documentHash,
      viewId: input.viewId,
      studyTypeSignature: input.studyTypeSignature,
      categorySignature: input.categorySignature,
      annotationDigest: input.annotationDigest,
      ledgerVersion: input.ledgerVersion
    };
    if (input.profileSignature) context.profileSignature = input.profileSignature;
    return `ledger:${stableHash(context)}`;
  }

  function buildFigureCacheKey(input) {
    const context = {
      documentHash: input.documentHash,
      providerId: input.providerId,
      model: input.model,
      figureId: input.figureId,
      figureHash: input.figureHash,
      analysisDepth: input.analysisDepth === 'deep' ? 'deep' : 'standard',
      figureVersion: input.figureVersion
    };
    if (input.profileSignature) context.profileSignature = input.profileSignature;
    return 'figure:' + stableHash(context);
  }

  function buildReviewOutlineCacheKey(input) {
    const context = {
      documentHash: input.documentHash,
      providerId: input.providerId,
      model: input.model,
      outlineVersion: input.outlineVersion,
      promptVersion: input.promptVersion
    };
    if (input.studyTypeSignature) context.studyTypeSignature = input.studyTypeSignature;
    if (input.scopeSignature) context.scopeSignature = input.scopeSignature;
    if (input.profileSignature) context.profileSignature = input.profileSignature;
    return 'review-outline:' + stableHash(context);
  }

  function buildReviewOutlineProgressKey(input) {
    const context = {
      documentHash: input.documentHash,
      providerId: input.providerId,
      model: input.model,
      outlineVersion: input.outlineVersion,
      promptVersion: input.promptVersion
    };
    if (input.studyTypeSignature) context.studyTypeSignature = input.studyTypeSignature;
    if (input.scopeSignature) context.scopeSignature = input.scopeSignature;
    if (input.profileSignature) context.profileSignature = input.profileSignature;
    return 'review-progress:' + stableHash(context);
  }

  function planCategoryAnalysis({ context, categories, cachedKeys }) {
    const cachedCategoryIds = [];
    const missingCategoryIds = [];
    categories.forEach(category => {
      const key = buildCategoryCacheKey({
        ...context,
        categoryId: category.categoryId,
        categoryVersion: category.version
      });
      (cachedKeys.has(key) ? cachedCategoryIds : missingCategoryIds).push(category.categoryId);
    });
    return { cachedCategoryIds, missingCategoryIds };
  }

  return {
    stableHash,
    buildEffectiveCategorySignature,
    buildCategoryCacheKey,
    buildProfileCacheKey,
    buildLedgerCacheKey,
    buildFigureCacheKey,
    buildReviewOutlineCacheKey,
    buildReviewOutlineProgressKey,
    planCategoryAnalysis
  };
});
