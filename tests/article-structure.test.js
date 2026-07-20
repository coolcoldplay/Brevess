const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildArticleStructure,
  reconcileArticleStructure,
  structureSignature,
  flattenStructureNodes,
  resolveArticleStructureParagraph,
  toReviewParagraphRecords
} = require('../core/article-structure.js');

function input(headings, paragraphs = []) {
  return {
    adapterId: 'fixture',
    publisherFamily: 'fixture',
    title: 'Review',
    headings,
    paragraphs
  };
}

test('builds one ordered hierarchy and assigns paragraphs to the requested leaf', () => {
  const structure = buildArticleStructure(input([
    { sourceKey: 'h-a', title: 'Mechanisms', level: 2, order: 1 },
    { sourceKey: 'h-b', title: 'Metabolism', level: 3, order: 2 }
  ], [
    {
      sourceKey: 'p-1', headingSourceKey: 'h-b',
      text: 'Evidence paragraph.', order: 3
    }
  ]));

  assert.equal(structure.nodes.length, 1);
  assert.equal(structure.nodes[0].title, 'Mechanisms');
  assert.equal(structure.nodes[0].children[0].title, 'Metabolism');
  assert.deepEqual(
    structure.nodes[0].children[0].paragraphIds,
    [structure.paragraphs[0].paragraphId]
  );
  assert.deepEqual(
    structure.paragraphs[0].headingPath.map(item => item.title),
    ['Mechanisms', 'Metabolism']
  );
});

test('uses parent source keys when publisher headings share one HTML level', () => {
  const structure = buildArticleStructure(input([
    { sourceKey: 'h-overview', title: 'Overview', level: 2, order: 1 },
    {
      sourceKey: 'h-discovery', parentSourceKey: 'h-overview',
      title: 'The discovery', level: 2, order: 2
    }
  ]));

  assert.equal(structure.nodes[0].children[0].title, 'The discovery');
  assert.equal(structure.nodes[0].children[0].level, 3);
});

test('stops at references and excludes utility headings', () => {
  const structure = buildArticleStructure(input([
    { sourceKey: 'h-abstract', title: 'Abstract', level: 2, order: 1 },
    { sourceKey: 'h-keywords', title: 'Keywords', level: 2, order: 2 },
    { sourceKey: 'h-results', title: 'Results', level: 2, order: 3 },
    { sourceKey: 'h-references', title: 'References', level: 2, order: 4 },
    { sourceKey: 'h-recommended', title: 'Recommended articles', level: 2, order: 5 }
  ]));

  assert.deepEqual(
    flattenStructureNodes(structure.nodes).map(item => item.title),
    ['Abstract', 'Results']
  );
});

test('reconciles a dynamic update while preserving stable node ids', () => {
  const first = buildArticleStructure(input([
    { sourceKey: 'h-abstract', title: 'Abstract', level: 2, order: 1 },
    { sourceKey: 'h-intro', title: 'Introduction', level: 2, order: 2 }
  ]));
  const second = buildArticleStructure(input([
    { sourceKey: 'h-abstract', title: 'Abstract', level: 2, order: 1 },
    { sourceKey: 'h-intro', title: 'Introduction', level: 2, order: 2 },
    { sourceKey: 'h-mechanisms', title: 'Mechanisms', level: 2, order: 3 }
  ]));
  const reconciled = reconcileArticleStructure(first, second);

  assert.equal(reconciled.nodes[0].nodeId, first.nodes[0].nodeId);
  assert.equal(reconciled.nodes[1].nodeId, first.nodes[1].nodeId);
  assert.equal(reconciled.revision, first.revision + 1);
  assert.notEqual(structureSignature(first), structureSignature(reconciled));
});

test('does not increment revision for an unchanged structure', () => {
  const first = buildArticleStructure(input([
    { sourceKey: 'h-abstract', title: 'Abstract', level: 2, order: 1 }
  ]));
  const same = buildArticleStructure(input([
    { sourceKey: 'h-abstract', title: 'Abstract', level: 2, order: 1 }
  ]));
  assert.equal(reconcileArticleStructure(first, same).revision, first.revision);
});

test('resolves a workspace paragraph by id first and source key as a fallback', () => {
  const structure = buildArticleStructure(input([
    { sourceKey: 'h-results', title: 'Results', level: 2, order: 1 }
  ], [
    { sourceKey: 'p-stable', headingSourceKey: 'h-results', text: 'Stable source.', order: 2 }
  ]));
  const paragraph = structure.paragraphs[0];

  assert.equal(
    resolveArticleStructureParagraph(structure, {
      paragraphId: paragraph.paragraphId,
      sourceKey: 'not-the-matching-source'
    }),
    paragraph
  );
  assert.equal(
    resolveArticleStructureParagraph(structure, {
      paragraphId: 'obsolete-id', sourceKey: paragraph.sourceKey
    }),
    paragraph
  );
});

test('converts navigation paragraphs to independent review records without changing fields', () => {
  const structure = buildArticleStructure(input([
    { sourceKey: 'h-results', title: 'Results', level: 2, order: 1 }
  ], [
    { sourceKey: 'p-stable', headingSourceKey: 'h-results', text: 'Stable source.', order: 2 }
  ]));
  const original = structure.paragraphs[0];
  const [record] = toReviewParagraphRecords(structure);

  assert.deepEqual(record, original);
  assert.notEqual(record, original);
  assert.notEqual(record.headingPath, original.headingPath);
  assert.notEqual(record.headingPath[0], original.headingPath[0]);
});
