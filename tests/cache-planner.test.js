const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildCategoryCacheKey,
  buildProfileCacheKey,
  buildLedgerCacheKey,
  buildFigureCacheKey,
  buildReviewOutlineCacheKey,
  buildReviewOutlineProgressKey,
  planCategoryAnalysis
} = require('../core/cache-planner.js');

const context = {
  documentHash: 'doc123',
  providerId: 'openai',
  model: 'user-model',
  promptVersion: '1',
  chunkerVersion: '1'
};

test('changes only the modified category cache key', () => {
  const v1 = buildCategoryCacheKey({ ...context, categoryId: 'limitation', categoryVersion: 1 });
  const v2 = buildCategoryCacheKey({ ...context, categoryId: 'limitation', categoryVersion: 2 });
  const future = buildCategoryCacheKey({ ...context, categoryId: 'future', categoryVersion: 1 });
  assert.notEqual(v1, v2);
  assert.notEqual(v1, future);
});

test('category cache key accepts an effective definition signature while legacy callers stay stable', () => {
  const input = {
    ...context,
    categoryId: 'limitation',
    categoryVersion: 3
  };
  const legacy = buildCategoryCacheKey(input);
  assert.equal(buildCategoryCacheKey({ ...input }), legacy);
  assert.notEqual(
    buildCategoryCacheKey({ ...input, effectiveCategorySignature: 'definition-a' }),
    buildCategoryCacheKey({ ...input, effectiveCategorySignature: 'definition-b' })
  );
  assert.notEqual(
    buildCategoryCacheKey({ ...input, effectiveCategorySignature: 'definition-a' }),
    legacy
  );
});

test('analyzes only selected categories missing from cache', () => {
  const categories = [
    { categoryId: 'limitation', version: 1 },
    { categoryId: 'future', version: 1 }
  ];
  const cachedKey = buildCategoryCacheKey({ ...context, categoryId: 'limitation', categoryVersion: 1 });
  const plan = planCategoryAnalysis({ context, categories, cachedKeys: new Set([cachedKey]) });
  assert.deepEqual(plan.cachedCategoryIds, ['limitation']);
  assert.deepEqual(plan.missingCategoryIds, ['future']);
});

test('changes category cache when study type or blueprint context changes', () => {
  const base = {
    documentHash: 'doc', providerId: 'deepseek', model: 'model',
    categoryId: 'key_result', categoryVersion: 1,
    promptVersion: '4', chunkerVersion: '1'
  };
  assert.notEqual(
    buildCategoryCacheKey({ ...base, contextHash: 'basic-quick' }),
    buildCategoryCacheKey({ ...base, contextHash: 'trial-quick' })
  );
});

test('builds stable profile and evidence-ledger cache keys', () => {
  assert.equal(
    buildProfileCacheKey({
      documentHash: 'doc', providerId: 'deepseek', model: 'model', classifierVersion: '1'
    }),
    buildProfileCacheKey({
      documentHash: 'doc', providerId: 'deepseek', model: 'model', classifierVersion: '1'
    })
  );
  assert.notEqual(
    buildLedgerCacheKey({
      documentHash: 'doc', viewId: 'quick_story', studyTypeSignature: 'basic',
      categorySignature: 'a', annotationDigest: 'one', ledgerVersion: '1'
    }),
    buildLedgerCacheKey({
      documentHash: 'doc', viewId: 'quick_story', studyTypeSignature: 'basic',
      categorySignature: 'a', annotationDigest: 'two', ledgerVersion: '1'
    })
  );
});

test('separates standard and deep Figure cache entries', () => {
  const base = {
    documentHash: 'doc', providerId: 'deepseek', model: 'deepseek-v4-flash',
    figureId: 'figure-1', figureHash: 'hash', figureVersion: '2'
  };
  assert.notEqual(
    buildFigureCacheKey({ ...base, analysisDepth: 'standard' }),
    buildFigureCacheKey({ ...base, analysisDepth: 'deep' })
  );
});

test('separates complete review outline and resumable progress keys', () => {
  const input = {
    documentHash: 'doc', providerId: 'deepseek', model: 'model',
    outlineVersion: '1', promptVersion: '1'
  };
  assert.match(buildReviewOutlineCacheKey(input), /^review-outline:/);
  assert.match(buildReviewOutlineProgressKey(input), /^review-progress:/);
  assert.notEqual(buildReviewOutlineCacheKey(input), buildReviewOutlineProgressKey(input));
  assert.equal(buildReviewOutlineCacheKey(input), 'review-outline:60ba2f94');
  assert.equal(buildReviewOutlineProgressKey(input), 'review-progress:60ba2f94');
});

test('separates both review outline keys when the manual study type changes', () => {
  const input = {
    documentHash: 'doc', providerId: 'deepseek', model: 'model',
    outlineVersion: '1', promptVersion: '1'
  };
  const observational = {
    ...input,
    studyTypeSignature: 'observational::not_review:manual'
  };
  const systematicReview = {
    ...input,
    studyTypeSignature: 'systematic_review_meta::narrative:manual'
  };

  assert.notEqual(
    buildReviewOutlineCacheKey(observational),
    buildReviewOutlineCacheKey(systematicReview)
  );
  assert.notEqual(
    buildReviewOutlineProgressKey(observational),
    buildReviewOutlineProgressKey(systematicReview)
  );
  assert.equal(
    buildReviewOutlineCacheKey(observational),
    buildReviewOutlineCacheKey({ ...observational })
  );
  assert.equal(
    buildReviewOutlineProgressKey(observational),
    buildReviewOutlineProgressKey({ ...observational })
  );
});

test('separates whole-document and section-scoped review summaries', () => {
  const input = {
    documentHash: 'doc', providerId: 'deepseek', model: 'model',
    outlineVersion: '1', promptVersion: '1',
    studyTypeSignature: 'systematic_review_meta::narrative:manual'
  };
  assert.notEqual(
    buildReviewOutlineCacheKey(input),
    buildReviewOutlineCacheKey({ ...input, scopeSignature: 'section-a' })
  );
  assert.notEqual(
    buildReviewOutlineProgressKey({ ...input, scopeSignature: 'section-a' }),
    buildReviewOutlineProgressKey({ ...input, scopeSignature: 'section-b' })
  );
});

test('isolates every provider cache key by task profile signature', () => {
  const profileA = 'profile-openai-a';
  const profileB = 'profile-openai-b';
  const category = {
    ...context, categoryId: 'result', categoryVersion: 1
  };
  const profile = {
    documentHash: 'doc', providerId: 'openai', model: 'same-model', classifierVersion: '1'
  };
  const ledger = {
    documentHash: 'doc', viewId: 'quick_story', studyTypeSignature: 'basic',
    categorySignature: 'a', annotationDigest: 'one', ledgerVersion: '1'
  };
  const figure = {
    documentHash: 'doc', providerId: 'openai', model: 'same-model', figureId: 'figure-1',
    figureHash: 'hash', analysisDepth: 'deep', figureVersion: '1'
  };
  const review = {
    documentHash: 'doc', providerId: 'openai', model: 'same-model',
    outlineVersion: '1', promptVersion: '1'
  };

  [
    [buildCategoryCacheKey, category], [buildProfileCacheKey, profile],
    [buildLedgerCacheKey, ledger], [buildFigureCacheKey, figure],
    [buildReviewOutlineCacheKey, review], [buildReviewOutlineProgressKey, review]
  ].forEach(([build, input]) => {
    assert.notEqual(build({ ...input, profileSignature: profileA }),
      build({ ...input, profileSignature: profileB }));
  });
});

test('changes provider-backed cache identity when request behavior signatures change', () => {
  const input = {
    ...context, categoryId: 'result', categoryVersion: 1,
    profileSignature: 'deepseek-thinking-disabled'
  };
  assert.notEqual(
    buildCategoryCacheKey(input),
    buildCategoryCacheKey({ ...input, profileSignature: 'deepseek-thinking-enabled' })
  );
  assert.notEqual(
    buildFigureCacheKey({
      documentHash: 'doc', providerId: 'openai-compatible', model: 'same-model',
      profileSignature: 'compatible-json-enabled', figureId: 'figure-1', figureHash: 'hash',
      analysisDepth: 'deep', figureVersion: '1'
    }),
    buildFigureCacheKey({
      documentHash: 'doc', providerId: 'openai-compatible', model: 'same-model',
      profileSignature: 'compatible-json-disabled', figureId: 'figure-1', figureHash: 'hash',
      analysisDepth: 'deep', figureVersion: '1'
    })
  );
});
