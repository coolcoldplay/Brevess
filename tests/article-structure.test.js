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

test('preserves bilingual heading line breaks without changing the canonical title', () => {
  const structure = buildArticleStructure(input([{
    sourceKey: 'h-results',
    title: 'Results',
    displayTitle: 'Results\n结果',
    level: 2,
    order: 1
  }]));

  assert.equal(structure.nodes[0].title, 'Results');
  assert.equal(structure.nodes[0].displayTitle, 'Results\n结果');
});

test('keeps navigable front and end matter while excluding page utility headings', () => {
  const structure = buildArticleStructure(input([
    { sourceKey: 'h-abstract', title: 'Abstract', level: 2, order: 1 },
    { sourceKey: 'h-keywords', title: 'Keywords', level: 2, order: 2 },
    { sourceKey: 'h-results', title: 'Results', level: 2, order: 3 },
    { sourceKey: 'h-info', title: 'Info', level: 3, order: 4 },
    {
      sourceKey: 'h-accessibility',
      title: 'Accessibility & Keyboard Shortcuts',
      level: 3,
      order: 5
    },
    { sourceKey: 'h-transcript', title: 'Transcript', level: 3, order: 6 },
    { sourceKey: 'h-references', title: 'References', level: 2, order: 7 },
    { sourceKey: 'h-recommended', title: 'Recommended articles', level: 2, order: 8 }
  ]));

  assert.deepEqual(
    flattenStructureNodes(structure.nodes).map(item => item.title),
    ['Abstract', 'Keywords', 'Results', 'References']
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

test('increments revision when Immersive Translate adds a bilingual heading line', () => {
  const first = buildArticleStructure(input([{
    sourceKey: 'h-results', title: 'Results', displayTitle: 'Results', level: 2, order: 1
  }]));
  const translated = buildArticleStructure(input([{
    sourceKey: 'h-results', title: 'Results', displayTitle: 'Results\n结果', level: 2, order: 1
  }]));
  const reconciled = reconcileArticleStructure(first, translated);

  assert.equal(reconciled.revision, first.revision + 1);
  assert.equal(reconciled.nodes[0].displayTitle, 'Results\n结果');
  assert.notEqual(structureSignature(first), structureSignature(reconciled));
});

test('preserves paragraph identity across harmless DOM source-key and selector changes', () => {
  const first = buildArticleStructure(input([
    { sourceKey: 'h-results', title: 'Results', level: 2, order: 1 }
  ], [{
    sourceKey: 'desktop-wrapper-p1', sourceIdentity: 'results-p1',
    headingSourceKey: 'h-results', text: 'Stable evidence.',
    textHash: 'stable-hash', dataSelector: '.desktop > p', order: 2
  }]));
  const reflowed = buildArticleStructure(input([
    { sourceKey: 'h-results', title: 'Results', level: 2, order: 1 }
  ], [{
    sourceKey: 'mobile-wrapper-p9', sourceIdentity: 'results-p1',
    headingSourceKey: 'h-results', text: 'Stable evidence.',
    textHash: 'stable-hash', dataSelector: '.mobile > div > p', order: 2
  }]));
  const reconciled = reconcileArticleStructure(first, reflowed);

  assert.equal(reconciled.paragraphs[0].paragraphId, first.paragraphs[0].paragraphId);
  assert.equal(reconciled.paragraphs[0].textHash, 'stable-hash');
  assert.equal(reconciled.revision, first.revision);
  assert.equal(structureSignature(reconciled), structureSignature(first));
});

test('keeps identical sentences in different real sections as distinct paragraphs', () => {
  const sentence = 'No adverse events were observed.';
  const structure = buildArticleStructure(input([
    { sourceKey: 'h-results', title: 'Results', level: 2, order: 1 },
    { sourceKey: 'h-discussion', title: 'Discussion', level: 2, order: 3 }
  ], [
    { sourceKey: 'result-p1', sourceIdentity: 'result-p1', headingSourceKey: 'h-results', text: sentence, textHash: 'same', order: 2 },
    { sourceKey: 'discussion-p1', sourceIdentity: 'discussion-p1', headingSourceKey: 'h-discussion', text: sentence, textHash: 'same', order: 4 }
  ]));

  assert.equal(structure.paragraphs.length, 2);
  assert.notEqual(structure.paragraphs[0].paragraphId, structure.paragraphs[1].paragraphId);
});

test('exposes typed records and body-only diagnostics while signatures include captions and references', () => {
  const baseInput = input([
    { sourceKey: 'h-results', title: 'Results', level: 2, order: 1 }
  ], [
    { sourceKey: 'p1', headingSourceKey: 'h-results', text: 'Body result.', recordType: 'body', textHash: 'body', order: 2 },
    { sourceKey: 'fig1', headingSourceKey: 'h-results', text: 'Figure 1. Result.', recordType: 'figure-caption', textHash: 'fig-a', order: 3 },
    { sourceKey: 'ref1', headingSourceKey: '', sectionTitle: 'References', text: 'Smith 2020.', recordType: 'reference', textHash: 'ref', order: 4 }
  ]);
  const first = buildArticleStructure(baseInput);
  const changedCaption = buildArticleStructure({
    ...baseInput,
    paragraphs: baseInput.paragraphs.map(item => item.sourceKey === 'fig1'
      ? { ...item, text: 'Figure 1. Changed result.', textHash: 'fig-b' }
      : item)
  });

  assert.equal(first.paragraphs.length, 1);
  assert.equal(first.typedRecords.length, 3);
  assert.equal(first.diagnostics.paragraphCount, 1);
  assert.equal(first.diagnostics.bodyParagraphCount, 1);
  assert.equal(first.diagnostics.figureCaptionCount, 1);
  assert.equal(first.diagnostics.referenceCount, 1);
  assert.notEqual(structureSignature(first), structureSignature(changedCaption));
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
