const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('../core/article-structure.js');
const ArticleExtractor = require('../core/article-extractor.js');

const contentSource = fs.readFileSync(path.join(__dirname, '../content.js'), 'utf8');

function sourceBetween(startText, endText) {
  const start = contentSource.indexOf(startText);
  const end = contentSource.indexOf(endText, start + startText.length);
  assert.ok(start >= 0 && end > start, `missing content source boundary: ${startText}`);
  return contentSource.slice(start, end);
}

function rawArticleRecords() {
  const section = (title, kind, texts) => texts.map((text, index) => {
    const sectionId = `sec-${title.toLowerCase()}`;
    return {
      paragraphId: `${sectionId}-p-${String(index + 1).padStart(3, '0')}`,
      sourceIdentity: `${kind}-${index + 1}`,
      textHash: `${kind}-hash-${index + 1}`,
      recordType: 'body',
      sectionId,
      sectionTitle: title,
      displaySectionTitle: title,
      sectionKind: kind,
      headingLevel: 2,
      headingPath: [{ level: 2, sectionId, title, displayTitle: title }],
      kind: 'paragraph',
      text,
      displayText: text
    };
  });
  return [
    ...section('Introduction', 'introduction', ['question']),
    ...section('Methods', 'methods', ['method']),
    ...section('Results', 'results', ['positive one', 'positive two', 'negative']),
    ...section('Discussion', 'discussion', ['boundary'])
  ];
}

function canonicalSnapshot(records = rawArticleRecords()) {
  const structure = ArticleExtractor.buildArticleStructureFromRecords(
    { title: 'Scope identity fixture', location: { hostname: '127.0.0.1' } },
    records,
    { adapter: { id: 'generic', family: 'generic' }, strategy: 'scope-test' }
  );
  return { structure, nodes: structure.nodes, paragraphs: structure.paragraphs };
}

function createScopeApi(snapshot, selection = new Map()) {
  const articleNavigatorState = { analysisSectionSelection: selection };
  const DEFAULT_ANALYSIS_SECTION_KINDS = new Set([
    'abstract', 'main', 'introduction', 'results', 'discussion', 'conclusion'
  ]);
  const scopeSource = sourceBetween(
    'function defaultArticleAnalysisSectionSelection(',
    'const REVIEW_ROLE_LABELS'
  );
  const flatten = (sections, output = []) => {
    for (const section of sections || []) {
      output.push(section);
      flatten(section.children, output);
    }
    return output;
  };
  return new Function(
    'articleNavigatorState', 'DEFAULT_ANALYSIS_SECTION_KINDS',
    'getCanonicalArticleSnapshot', 'flattenPdfSemanticNavigationSections',
    'currentNativePdfSemanticHighlightState', 'lastRegexHighlightRequest',
    'highlighter', 'lastLlmAnalysis', 'renderLlmAnalysis',
    'scheduleArticleWorkspaceArtifactsSave', 'scheduleCurrentArticleArchiveSave',
    'buildArticleWorkspaceSnapshot',
    `${scopeSource}\nreturn { articleNavigatorState, articleAnalysisSectionSelected, ` +
      'selectedArticleAnalysisParagraphIds, filterParagraphsForArticleAnalysis, ' +
      'setArticleAnalysisSectionSelection };'
  )(
    articleNavigatorState, DEFAULT_ANALYSIS_SECTION_KINDS, () => snapshot, flatten,
    () => ({ context: null }), null, { applyHighlight() {} }, null, () => {},
    () => {}, () => {}, () => ({})
  );
}

function canonicalSection(snapshot, rawSectionId) {
  const nodes = [];
  const visit = items => (items || []).forEach(item => {
    nodes.push(item);
    visit(item.children);
  });
  visit(snapshot.structure.nodes);
  const node = nodes.find(item => item.sourceKey === rawSectionId);
  assert.ok(node, `missing canonical section for ${rawSectionId}`);
  assert.notEqual(node.sectionId, rawSectionId,
    'fixture must exercise different canonical and raw section identities');
  return node;
}

test('canonical-only persisted selection filters raw records by unique source identity', () => {
  const records = rawArticleRecords();
  const snapshot = canonicalSnapshot(records);
  const methods = canonicalSection(snapshot, 'sec-methods');
  const introduction = canonicalSection(snapshot, 'sec-introduction');
  const selection = new Map([
    [methods.sectionId, true],
    [introduction.sectionId, false]
  ]);
  const api = createScopeApi(snapshot, selection);

  const filtered = api.filterParagraphsForArticleAnalysis(records);

  assert.deepEqual(filtered.map(item => item.paragraphId), [
    'sec-methods-p-001',
    'sec-results-p-001',
    'sec-results-p-002',
    'sec-results-p-003',
    'sec-discussion-p-001'
  ]);
  assert.ok(filtered.every(item => records.includes(item)),
    'scope filtering must retain the original paragraph objects and identities');
  assert.equal(filtered.some(item => item.paragraphId === 'sec-introduction-p-001'), false);
});

test('section toggle reports six selected paragraphs instead of twelve mixed identities', () => {
  const records = rawArticleRecords();
  const snapshot = canonicalSnapshot(records);
  const methods = canonicalSection(snapshot, 'sec-methods');
  const api = createScopeApi(snapshot);

  const mixedIds = api.selectedArticleAnalysisParagraphIds(snapshot);
  assert.equal(mixedIds.size, 10,
    'five default-selected paragraphs expose both canonical and raw paragraph identities');

  const result = api.setArticleAnalysisSectionSelection([methods.sectionId], true);
  assert.equal(result.selectedParagraphCount, 6);
  assert.equal(api.selectedArticleAnalysisParagraphIds(snapshot).size, 12,
    'allowed identity set intentionally retains two identities for each selected paragraph');
});

test('ambiguous or title-only identities do not expand the selected scope', () => {
  const records = rawArticleRecords();
  const snapshot = canonicalSnapshot(records);
  const methods = canonicalSection(snapshot, 'sec-methods');
  const api = createScopeApi(snapshot, new Map([[methods.sectionId, true]]));
  const ambiguousId = 'sec-ambiguous-p-001';
  const ambiguousSnapshot = {
    ...snapshot,
    paragraphs: [
      ...snapshot.paragraphs,
      { ...snapshot.paragraphs[0], paragraphId: 'canonical-ambiguous-a',
        sourceKey: ambiguousId, sectionId: methods.sectionId },
      { ...snapshot.paragraphs[0], paragraphId: 'canonical-ambiguous-b',
        sourceKey: ambiguousId, sectionId: snapshot.paragraphs[0].sectionId }
    ]
  };
  const ambiguousApi = createScopeApi(ambiguousSnapshot, new Map([[methods.sectionId, true]]));
  const inputs = [
    {
      paragraphId: ambiguousId,
      sectionId: 'sec-unmapped-ambiguous',
      sectionTitle: 'Methods',
      sectionKind: 'methods',
      text: 'ambiguous identity'
    },
    {
      paragraphId: 'sec-title-only-p-001',
      sectionId: 'sec-title-only',
      sectionTitle: 'Methods',
      sectionKind: 'methods',
      text: 'title-only identity'
    }
  ];

  assert.deepEqual(ambiguousApi.filterParagraphsForArticleAnalysis(inputs), [],
    'ambiguous and title-only matches must fall back to direct/default section rules');

  ambiguousApi.articleNavigatorState.analysisSectionSelection.set(
    'sec-unmapped-ambiguous', true
  );
  assert.deepEqual(
    ambiguousApi.filterParagraphsForArticleAnalysis(inputs).map(item => item.paragraphId),
    [ambiguousId],
    'an explicit direct section selection remains authoritative for ambiguous identities'
  );

  assert.equal(api.filterParagraphsForArticleAnalysis([inputs[1]]).length, 0,
    'a unique selected Methods title alone is not an identity match');
});
