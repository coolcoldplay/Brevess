const test = require('node:test');
const assert = require('node:assert/strict');

require('../core/article-chat-tokenizer.js');
const { buildArticleChatIndex } = require('../core/article-chat-index.js');
const {
  retrieveArticleChatContext,
  reciprocalRankFusion,
  maximalMarginalRelevance
} = require('../core/article-chat-retrieval.js');

function record(id, sectionTitle, sectionKind, text, recordType = 'body') {
  return {
    paragraphId: id, sourceKey: `source-${id}`, sourceIdentity: `stable-${id}`,
    textHash: `hash-${id}`, recordType, sectionId: `sec-${sectionTitle.toLowerCase()}`,
    sectionTitle, sectionKind,
    headingPath: [{ level: 2, sectionId: `sec-${sectionTitle.toLowerCase()}`, title: sectionTitle }],
    text
  };
}

function fixtureIndex() {
  const records = [
    record('p-abstract', 'Abstract', 'abstract',
      'This study identifies a skin hypothalamus axis that couples chronic heat stress to metabolic dysfunction.'),
    record('p-intro', 'Introduction', 'introduction',
      'The background explains why chronic heat stress and central energy balance require mechanistic study.'),
    record('p-method', 'Methods', 'methods',
      'Mice received a 24-h thermal exposure and hypothalamic nuclei were profiled by ATAC-seq.'),
    record('p-r1', 'Results', 'results',
      'Kinase rescue restored glucose tolerance, but did not increase food intake in treated mice.'),
    record('p-r2', 'Results', 'results',
      'Kinase rescue also normalized lipid metabolism after chronic heat stress.'),
    record('p-r3', 'Results', 'results',
      'A separate neural inhibition experiment prevented the endocrine response.'),
    record('p-discussion', 'Discussion', 'discussion',
      'The authors conclude that the rescue supports causality, while limited sample size constrains generalization.'),
    record('p-ref', 'References', 'reference',
      'Smith J. Kinase signaling under heat stress. Example Journal. 2020.', 'reference')
  ];
  return buildArticleChatIndex({
    key: 'fixture:1', documentHash: 'fixture', revision: 1,
    paragraphs: records.filter(item => item.recordType === 'body'),
    typedRecords: records
  }, { targetChars: 80, minChars: 40, maxChars: 180 });
}

test('BM25 plus exact phrase and section boosts rank the requested scientific result first', async () => {
  const result = await retrieveArticleChatContext(
    fixtureIndex(), 'Results 中的 "kinase rescue" 是否没有增加 food intake？',
    { maxChars: 500, neighborRadius: 0 }
  );

  assert.equal(result.chunks[0].paragraphIds.includes('p-r1'), true);
  assert.ok(result.chunks[0].explanation.bm25 > 0);
  assert.ok(result.chunks[0].explanation.exactPhraseBoost > 0);
  assert.ok(result.chunks[0].explanation.sectionBoost > 0);
  assert.ok(result.queryTokens.includes('not') || result.queryTokens.includes('没有'));
});

test('reciprocal-rank fusion and MMR preserve relevance while increasing section diversity', () => {
  const fused = reciprocalRankFusion([
    ['a', 'b', 'c'],
    ['b', 'd', 'a']
  ]);
  assert.ok(fused.get('b') > fused.get('c'));

  const selected = maximalMarginalRelevance([
    { chunkId: 'a', sectionId: 'results', tokens: ['kinase', 'rescue'], score: 10 },
    { chunkId: 'b', sectionId: 'results', tokens: ['kinase', 'rescue'], score: 9 },
    { chunkId: 'c', sectionId: 'discussion', tokens: ['limitation', 'sample'], score: 7 }
  ], { limit: 2, lambda: 0.6 });
  assert.deepEqual(selected.map(item => item.chunkId), ['a', 'c']);
});

test('retrieval expands same-section neighbors and reports each decision', async () => {
  const result = await retrieveArticleChatContext(
    fixtureIndex(), 'neural inhibition experiment',
    { maxChars: 900, limit: 1, neighborRadius: 1 }
  );

  assert.ok(result.chunks.some(chunk => chunk.paragraphIds.includes('p-r3')));
  assert.ok(result.neighborDecisions.some(item => item.included === true));
  assert.ok(result.neighborDecisions.every(item => item.reason === 'same-section-neighbor'));
});

test('a broad question covers major sections instead of returning redundant Results chunks', async () => {
  const result = await retrieveArticleChatContext(
    fixtureIndex(), '请概括全文的研究背景、主要发现和结论',
    { maxChars: 1200, limit: 6, neighborRadius: 0 }
  );
  const kinds = new Set(result.chunks.map(chunk => chunk.sectionKind));

  assert.equal(result.coverage.broadQuery, true);
  assert.ok(kinds.has('abstract'));
  assert.ok(kinds.has('results'));
  assert.ok(kinds.has('discussion'));
});

test('reference chunks require explicit References intent', async () => {
  const index = fixtureIndex();
  const normal = await retrieveArticleChatContext(index, 'kinase signaling study', {
    maxChars: 1000, neighborRadius: 0
  });
  const references = await retrieveArticleChatContext(index, '参考文献里 Smith 2020 的题目是什么？', {
    maxChars: 1000, neighborRadius: 0
  });

  assert.equal(normal.chunks.some(chunk => chunk.recordType === 'reference'), false);
  assert.equal(references.coverage.referencesIntent, true);
  assert.equal(references.chunks.some(chunk => chunk.recordType === 'reference'), true);
});

test('embeddings are optional and no callback is required for local retrieval', async () => {
  const local = await retrieveArticleChatContext(fixtureIndex(), 'ATAC-seq methods', {
    maxChars: 600, neighborRadius: 0
  });
  assert.equal(local.coverage.embeddingUsed, false);

  let calls = 0;
  const hybrid = await retrieveArticleChatContext(fixtureIndex(), 'ATAC-seq methods', {
    maxChars: 600,
    neighborRadius: 0,
    async embedTexts(texts) {
      calls += 1;
      return texts.map((_, index) => [index === 0 ? 1 : 0.5, index / 10]);
    }
  });
  assert.equal(calls, 1);
  assert.equal(hybrid.coverage.embeddingUsed, true);
});
