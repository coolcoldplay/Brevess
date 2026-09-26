const test = require('node:test');
const assert = require('node:assert/strict');

require('../core/chunker.js');
require('../core/review-outline.js');
const { analyzeReviewOutline } = require('../core/review-outline-pipeline.js');
const { buildReviewOutlineCacheKey } = require('../core/cache-planner.js');

function outlineParagraphs(count) {
  return Array.from({ length: count }, (_, index) => ({
    paragraphId: `sec-a-p-${String(index + 1).padStart(3, '0')}`,
    sectionId: 'sec-a', sectionTitle: 'Evidence', sectionKind: 'article',
    headingLevel: 1,
    headingPath: [{ level: 1, sectionId: 'sec-a', title: 'Evidence' }],
    text: `Paragraph ${index + 1} contains review evidence and enough text for chunking.`
  }));
}

function deterministicReviewAdapter(options = {}) {
  let mapCalls = 0;
  const requests = [];
  return {
    requests,
    async generateJson(request) {
      requests.push(request);
      const payload = JSON.parse(request.userPrompt);
      if (request.schemaName === 'review_paragraph_batch') {
        mapCalls += 1;
        if (options.timeoutFirst && mapCalls === 1) {
          throw Object.assign(new Error('timeout'), {
            code: 'REQUEST_TIMEOUT', retryable: true
          });
        }
        if (mapCalls <= Number(options.invalidMapTimes || 0) ||
            (options.invalidMapWhileMultiParagraph && payload.paragraphs.length > 1)) {
          return {
            batch_id: payload.batch_id,
            paragraphs_reviewed: payload.paragraphs.map(item => item.paragraph_id),
            paragraph_summaries: []
          };
        }
        return {
          batch_id: payload.batch_id,
          paragraphs_reviewed: payload.paragraphs.map(item => item.paragraph_id),
          paragraph_summaries: payload.paragraphs.map(item => ({
            paragraph_id: item.paragraph_id, summary_zh: `摘要 ${item.paragraph_id}`,
            rhetorical_role: 'evidence_support', key_point_zh: '支持主题',
            transition_from_previous_zh: ''
          }))
        };
      }
      if (options.failReduce) {
        throw Object.assign(new Error('busy'), {
          code: 'PROVIDER_UNAVAILABLE', retryable: true
        });
      }
      if (options.invalidReduce) {
        return {
          paper_thesis_zh: '中心命题', organization_strategy_zh: '主题式组织',
          sections: [], key_tensions: []
        };
      }
      return {
        paper_thesis_zh: '中心命题', organization_strategy_zh: '主题式组织',
        sections: payload.sections.map(item => ({
          section_id: item.section_id, section_role: '证据综合',
          section_summary_zh: '章节摘要', transition_from_previous_zh: '',
          logical_units: item.paragraph_summaries.length ? [{
            unit_id: 'unit-1', title_zh: '证据链', rhetorical_role: 'synthesis',
            summary_zh: '整合本节段落证据。',
            source_paragraph_ids: item.paragraph_summaries.map(entry => entry.paragraph_id)
          }] : []
        })), key_tensions: []
      };
    }
  };
}

test('summarizes every paragraph once and reduces summaries into a tree', async () => {
  const adapter = deterministicReviewAdapter();
  const result = await analyzeReviewOutline({
    paragraphs: outlineParagraphs(3), articleTitle: 'Review', reviewSubtype: 'narrative',
    adapter, sleepImpl: async () => {}, maxChars: 10000
  });
  assert.equal(result.paragraphCount, 3);
  assert.equal(result.globalSynthesisAvailable, true);
  assert.equal(adapter.requests.filter(item => item.schemaName === 'review_paragraph_batch').length, 1);
  const reduce = adapter.requests.find(item => item.schemaName === 'review_global_synthesis');
  assert.doesNotMatch(reduce.userPrompt, /Paragraph 1 contains review evidence/);
});

test('splits a timed-out multi-paragraph review chunk and continues', async () => {
  const adapter = deterministicReviewAdapter({ timeoutFirst: true });
  const phases = [];
  const result = await analyzeReviewOutline({
    paragraphs: outlineParagraphs(4), articleTitle: 'Review', reviewSubtype: 'narrative',
    adapter, sleepImpl: async () => {}, onProgress: event => phases.push(event.phase)
  });
  assert.equal(result.paragraphCount, 4);
  assert.ok(phases.includes('review_split'));
});

test('retries a transient invalid paragraph response instead of aborting the outline', async () => {
  const adapter = deterministicReviewAdapter({ invalidMapTimes: 1 });
  const phases = [];
  const result = await analyzeReviewOutline({
    paragraphs: outlineParagraphs(2), articleTitle: 'Review', reviewSubtype: 'narrative',
    adapter, sleepImpl: async () => {}, onProgress: event => phases.push(event.phase)
  });
  assert.equal(result.paragraphCount, 2);
  const mapRequests = adapter.requests.filter(item => item.schemaName === 'review_paragraph_batch');
  assert.equal(mapRequests.length, 2);
  assert.match(mapRequests[1].systemPrompt, /上一轮输出格式不合格/);
  assert.ok(phases.includes('review_retry'));
});

test('splits a repeatedly invalid multi-paragraph response and completes smaller chunks', async () => {
  const adapter = deterministicReviewAdapter({ invalidMapWhileMultiParagraph: true });
  const phases = [];
  const result = await analyzeReviewOutline({
    paragraphs: outlineParagraphs(4), articleTitle: 'Review', reviewSubtype: 'narrative',
    adapter, sleepImpl: async () => {}, onProgress: event => phases.push(event.phase)
  });
  assert.equal(result.paragraphCount, 4);
  assert.ok(phases.includes('review_retry'));
  assert.ok(phases.includes('review_split'));
});

test('uses a visibly labelled extractive fallback when one paragraph repeatedly violates the schema', async () => {
  const paragraphs = outlineParagraphs(1);
  const phases = [];
  const adapter = deterministicReviewAdapter({ invalidMapTimes: 99 });
  const result = await analyzeReviewOutline({
    paragraphs, articleTitle: 'Review', reviewSubtype: 'narrative',
    paragraphOnly: true, adapter, sleepImpl: async () => {},
    onProgress: event => phases.push(event)
  });
  assert.equal(result.paragraphCount, 1);
  const summary = result.nodes[0].paragraphs[0].summary;
  assert.match(summary, /模型格式异常/);
  assert.match(summary, /Paragraph 1 contains review evidence/);
  assert.ok(phases.some(event => event.phase === 'review_fallback'));
  assert.equal(adapter.requests.filter(item =>
    item.schemaName === 'review_paragraph_batch').length, 2);
});

test('reuses completed map checkpoints after a later run', async () => {
  const checkpoints = [];
  const adapter = deterministicReviewAdapter();
  await analyzeReviewOutline({
    paragraphs: outlineParagraphs(3), articleTitle: 'Review', reviewSubtype: 'narrative',
    adapter, resumeChunks: new Map(), onChunkComplete: async item => checkpoints.push(item),
    maxChars: 120, sleepImpl: async () => {}
  });
  const resumedAdapter = deterministicReviewAdapter();
  await analyzeReviewOutline({
    paragraphs: outlineParagraphs(3), articleTitle: 'Review', reviewSubtype: 'narrative',
    adapter: resumedAdapter,
    resumeChunks: new Map(checkpoints.map(item => [item.chunkId, item])),
    maxChars: 120, sleepImpl: async () => {}
  });
  assert.equal(resumedAdapter.requests.filter(item => item.schemaName === 'review_paragraph_batch').length, 0);
});

test('returns paragraph outline when global synthesis is unavailable', async () => {
  const result = await analyzeReviewOutline({
    paragraphs: outlineParagraphs(2), articleTitle: 'Review', reviewSubtype: 'narrative',
    adapter: deterministicReviewAdapter({ failReduce: true }), sleepImpl: async () => {}
  });
  assert.equal(result.globalSynthesisAvailable, false);
  assert.equal(result.paragraphCount, 2);
});

test('paragraph-only analysis skips the global synthesis request', async () => {
  const adapter = deterministicReviewAdapter();
  const result = await analyzeReviewOutline({
    paragraphs: outlineParagraphs(1), articleTitle: 'Review',
    reviewSubtype: 'narrative', paragraphOnly: true,
    adapter, sleepImpl: async () => {}
  });
  assert.deepEqual(adapter.requests.map(item => item.schemaName),
    ['review_paragraph_batch']);
  assert.equal(result.paragraphCount, 1);
  assert.equal(result.globalSynthesisAvailable, false);
});

test('keeps paragraph summaries when global synthesis repeatedly returns invalid JSON shape', async () => {
  const adapter = deterministicReviewAdapter({ invalidReduce: true });
  const result = await analyzeReviewOutline({
    paragraphs: outlineParagraphs(2), articleTitle: 'Review', reviewSubtype: 'narrative',
    adapter, sleepImpl: async () => {}
  });
  assert.equal(result.globalSynthesisAvailable, false);
  assert.equal(result.paragraphCount, 2);
  assert.equal(adapter.requests.filter(item => item.schemaName === 'review_global_synthesis').length, 2);
});

test('complete outline cache key changes with document model or prompt version', () => {
  const base = { documentHash: 'doc', providerId: 'deepseek', model: 'm1',
    outlineVersion: '1', promptVersion: '1' };
  assert.notEqual(buildReviewOutlineCacheKey(base),
    buildReviewOutlineCacheKey({ ...base, model: 'm2' }));
  assert.notEqual(buildReviewOutlineCacheKey(base),
    buildReviewOutlineCacheKey({ ...base, promptVersion: '2' }));
  assert.notEqual(
    buildReviewOutlineCacheKey({ ...base, analysisStrategy: 'review' }),
    buildReviewOutlineCacheKey({ ...base, analysisStrategy: 'primary_research' })
  );
});
