const test = require('node:test');
const assert = require('node:assert/strict');

const abbreviations = require('../core/abbreviation-extractor');
globalThis.SciLLM = abbreviations;
const {
  buildLocalReadingLibrary,
  queryLocalReadingLibrary,
  countLocalLibraryAbbreviationOccurrences
} = require('../core/local-reading-library');

const W1 = `workspace:${'1'.repeat(64)}`;
const W2 = `workspace:${'2'.repeat(64)}`;

function fixtures() {
  const workspaces = [
    { workspaceId: W1, title: 'Inflammation Atlas', canonicalUrl: 'https://example.org/one',
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-02-01T00:00:00.000Z' },
    { workspaceId: W2, title: 'Repair Atlas', canonicalUrl: 'https://example.org/two',
      createdAt: '2026-01-02T00:00:00.000Z', updatedAt: '2026-02-02T00:00:00.000Z' }
  ];
  const assetsByWorkspace = new Map([
    [W1, [
      // An obsolete duplicate record must never add another occurrence.
      { relativePath: 'article/paragraphs.json', revision: 1, content: {
        paragraphs: [{ sectionTitle: 'Old', text: 'TNF obsolete TNF' }]
      }},
      { relativePath: 'article/paragraphs.json', revision: 2, content: { paragraphs: [
        { sectionTitle: 'Abstract', text: 'TNF drives inflammation; TNF-like signals and tnf recur.' },
        { sectionTitle: 'Materials and Methods', text: 'Cells received TNF before imaging.' },
        { sectionTitle: 'Results', text: 'A fulltext-only sentinel was observed.' }
      ]}},
      { relativePath: 'annotations/literature-note.json', revision: 1, content: {
        valuesByTemplate: { default: { insight: 'notebook sentinel' } }
      }},
      { relativePath: 'annotations/paragraph-notes.json', revision: 1,
        content: { notes: [{ note: 'paragraph-note sentinel' }] } },
      { relativePath: 'annotations/highlights.json', revision: 1,
        content: { annotations: [{ note: 'highlight-note sentinel' }] } },
      { relativePath: 'figures/inventory.json', revision: 1, content: {
        figures: [{ figureLabel: 'Figure 1', caption: 'caption sentinel with TNF.' }]
      }}
    ]],
    [W2, [
      { relativePath: 'article/paragraphs.json', revision: 1, content: { paragraphs: [
        { sectionTitle: 'Results', text: 'TNF appears, but xTNF and TNF1 are different tokens.' }
      ]}},
      { relativePath: 'annotations/literature-note.json', revision: 1, content: {
        valuesByTemplate: { default: { insight: 'repair note' } }
      }}
    ]]
  ]);
  const globalMemory = { entries: [{
    abbreviation: 'TNF', fullName: 'tumor necrosis factor', meaningZh: '肿瘤坏死因子',
    supportCount: 2, addedAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    firstImportedAt: '2025-06-01T00:00:00.000Z'
  }, {
    abbreviation: 'IL6', fullName: 'interleukin 6', supportCount: 1,
    addedAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z'
  }] };
  return { workspaces, assetsByWorkspace, globalMemory };
}

test('builds exact per-document abbreviation counts without duplicate rescans', () => {
  const library = buildLocalReadingLibrary(fixtures());
  const tnf = library.abbreviations.find(item => item.abbreviation === 'TNF');
  assert.equal(tnf.documentCount, 2);
  assert.equal(tnf.totalCount, 6);
  assert.deepEqual(tnf.occurrences.map(item => [item.title, item.count]), [
    ['Repair Atlas', 1],
    ['Inflammation Atlas', 5]
  ]);
  assert.equal(tnf.firstImportedAt, '2025-06-01T00:00:00.000Z');
  assert.equal(library.abbreviations.find(item => item.abbreviation === 'IL6').firstImportedAt, '');
});

test('counts abbreviations case-insensitively with scientific token boundaries', () => {
  assert.equal(countLocalLibraryAbbreviationOccurrences(
    'TNF tnf xTNF TNF1 (TNF) TNF-like', 'TNF'
  ), 4);
  assert.equal(countLocalLibraryAbbreviationOccurrences(
    'A/B a/b XA/B A/BC', 'A/B'
  ), 2);
});

test('searches only the selected real source and reports coverage', () => {
  const library = buildLocalReadingLibrary(fixtures());
  const cases = [
    ['title', 'Inflammation Atlas'],
    ['notes', 'notebook sentinel'],
    ['notes', 'paragraph-note sentinel'],
    ['notes', 'highlight-note sentinel'],
    ['fulltext', 'fulltext-only sentinel'],
    ['abstract', 'drives inflammation'],
    ['method', 'before imaging'],
    ['caption', 'caption sentinel']
  ];
  cases.forEach(([scope, query]) => {
    const result = queryLocalReadingLibrary(library, { kind: 'articles', scope, query });
    assert.equal(result.total, 1, `${scope} should find one real source`);
    assert.deepEqual(result.items[0].hitScopes, [scope]);
    assert.ok(result.items[0].snippets[0].text.includes(query));
  });
  const falseFulltext = queryLocalReadingLibrary(library, {
    kind: 'articles', scope: 'fulltext', query: 'notebook sentinel'
  });
  assert.equal(falseFulltext.total, 0);
  const abstractCoverage = queryLocalReadingLibrary(library, {
    kind: 'articles', scope: 'abstract', query: 'not present'
  });
  assert.equal(abstractCoverage.totals.coverage.abstract, 1);
  assert.equal(abstractCoverage.totals.coverage.fulltext, 2);
});

test('rebuilding after deletion removes the document and recalculates associations', () => {
  const source = fixtures();
  const first = buildLocalReadingLibrary(source);
  const rebuilt = buildLocalReadingLibrary({
    ...source,
    workspaces: source.workspaces.filter(item => item.workspaceId !== W1)
  });
  assert.equal(first.abbreviations.find(item => item.abbreviation === 'TNF').documentCount, 2);
  assert.equal(rebuilt.articles.length, 1);
  assert.equal(rebuilt.abbreviations.find(item => item.abbreviation === 'TNF').totalCount, 1);
});

test('paginates article and abbreviation results', () => {
  const library = buildLocalReadingLibrary(fixtures());
  const articles = queryLocalReadingLibrary(library, {
    kind: 'articles', page: 2, pageSize: 5
  });
  // Page size is deliberately bounded to at least five, and an overlarge page
  // is clamped to the actual last page.
  assert.equal(articles.page, 1);
  assert.equal(articles.pageCount, 1);
  const terms = queryLocalReadingLibrary(library, {
    kind: 'abbreviations', query: 'tumor', page: 1, pageSize: 25
  });
  assert.equal(terms.total, 1);
  assert.equal(terms.items[0].abbreviation, 'TNF');
  assert.equal(Object.hasOwn(terms.items[0], 'occurrences'), false);
  const occurrences = queryLocalReadingLibrary(library, {
    kind: 'occurrences', abbreviationId: terms.items[0].id,
    page: 1, pageSize: 5
  });
  assert.equal(occurrences.total, 2);
  assert.equal(occurrences.items[0].count, 1);
});

test('firstImportedAt is only created by a real import operation', () => {
  const legacy = abbreviations.normalizeGlobalAbbreviationMemory({ entries: [{
    abbreviation: 'TNF', fullName: 'tumor necrosis factor'
  }] });
  assert.equal(legacy.entries[0].firstImportedAt, undefined);
  const imported = abbreviations.mergeGlobalAbbreviationMemory(legacy, [{
    abbreviation: 'TNF', fullName: 'tumor necrosis factor'
  }], {
    now: '2026-03-01T00:00:00.000Z',
    importedAt: '2026-03-01T00:00:00.000Z'
  });
  assert.equal(imported.memory.entries[0].firstImportedAt, '2026-03-01T00:00:00.000Z');
  const roundTrip = abbreviations.parseGlobalAbbreviationMemoryImport(
    abbreviations.createGlobalAbbreviationMemoryExport(imported.memory)
  );
  assert.equal(roundTrip.entries[0].firstImportedAt, '2026-03-01T00:00:00.000Z');
});

test('global abbreviation CRUD keeps stable identity, metadata, and reload state', () => {
  const created = abbreviations.mutateGlobalAbbreviationMemory({}, {
    action: 'create', abbreviation: 'NF-kB', fullName: 'nuclear factor kappa B',
    meaningZh: '核因子 κB'
  }, { now: '2026-04-01T00:00:00.000Z' });
  const original = created.memory.entries[0];
  assert.match(original.entryId, /^abbr:[a-f0-9]{16}$/u);
  assert.equal(original.hiddenFromReading, undefined);

  const edited = abbreviations.mutateGlobalAbbreviationMemory(created.memory, {
    action: 'update', entryId: original.entryId,
    fullName: 'nuclear factor kappa-light-chain-enhancer of activated B cells',
    meaningZh: '活化 B 细胞核因子 κB'
  }, { now: '2026-04-02T00:00:00.000Z' });
  const reloaded = abbreviations.normalizeGlobalAbbreviationMemory(edited.memory).entries[0];
  assert.equal(reloaded.entryId, original.entryId);
  assert.equal(reloaded.firstImportedAt, original.firstImportedAt);
  assert.equal(reloaded.addedAt, original.addedAt);
  assert.equal(reloaded.supportCount, original.supportCount);
  assert.match(reloaded.fullName, /activated B cells/u);

  const hidden = abbreviations.mutateGlobalAbbreviationMemory(edited.memory, {
    action: 'set-visibility', entryId: original.entryId, hiddenFromReading: true
  }, { now: '2026-04-03T00:00:00.000Z' });
  assert.equal(hidden.memory.entries[0].hiddenFromReading, true);
  const exported = abbreviations.createGlobalAbbreviationMemoryExport(hidden.memory);
  assert.equal(abbreviations.parseGlobalAbbreviationMemoryImport(exported)
    .entries[0].hiddenFromReading, true);

  const visible = abbreviations.mutateGlobalAbbreviationMemory(hidden.memory, {
    action: 'set-visibility', entryId: original.entryId, hiddenFromReading: false
  }, { now: '2026-04-04T00:00:00.000Z' });
  assert.equal(visible.memory.entries[0].hiddenFromReading, undefined);
  const deleted = abbreviations.mutateGlobalAbbreviationMemory(visible.memory, {
    action: 'delete', entryId: original.entryId
  });
  assert.equal(deleted.memory.entries.length, 0);
});

test('hidden global entries remain in library statistics but disappear from reading composition', () => {
  const source = fixtures();
  const normalized = abbreviations.normalizeGlobalAbbreviationMemory(source.globalMemory);
  const tnf = normalized.entries.find(item => item.abbreviation === 'TNF');
  const edited = abbreviations.mutateGlobalAbbreviationMemory(normalized, {
    action: 'update', entryId: tnf.entryId,
    fullName: 'tumor necrosis factor alpha', meaningZh: '肿瘤坏死因子 α'
  }, { now: '2026-04-02T00:00:00.000Z' }).memory;
  const hidden = abbreviations.mutateGlobalAbbreviationMemory(edited, {
    action: 'set-visibility', entryId: tnf.entryId, hiddenFromReading: true
  }, { now: '2026-04-03T00:00:00.000Z' }).memory;
  const articleTable = abbreviations.composeArticleAbbreviations({
    paragraphs: [{ paragraphId: 'p1', text: 'tumor necrosis factor (TNF) rises.' }],
    globalMemory: hidden
  });
  assert.equal(articleTable.entries.some(item => item.abbreviation === 'TNF'), false);
  const library = buildLocalReadingLibrary({ ...source, globalMemory: hidden });
  const libraryTnf = library.abbreviations.find(item => item.abbreviation === 'TNF');
  assert.equal(libraryTnf.hiddenFromReading, true);
  assert.equal(libraryTnf.documentCount, 2);
  assert.equal(libraryTnf.totalCount, 6);

  const shown = abbreviations.mutateGlobalAbbreviationMemory(hidden, {
    action: 'set-visibility', entryId: tnf.entryId, hiddenFromReading: false
  }, { now: '2026-04-04T00:00:00.000Z' }).memory;
  assert.equal(abbreviations.composeArticleAbbreviations({
    paragraphs: [{ paragraphId: 'p1', text: 'tumor necrosis factor (TNF) rises.' }],
    globalMemory: shown
  }).entries.some(item => item.abbreviation === 'TNF'), true);
});

test('deleting a global entry does not blacklist a later article import', () => {
  const normalized = abbreviations.normalizeGlobalAbbreviationMemory(fixtures().globalMemory);
  const tnf = normalized.entries.find(item => item.abbreviation === 'TNF');
  const deleted = abbreviations.mutateGlobalAbbreviationMemory(normalized, {
    action: 'delete', entryId: tnf.entryId
  }).memory;
  const importedAgain = abbreviations.mergeGlobalAbbreviationMemory(deleted, [{
    abbreviation: 'TNF', fullName: 'tumor necrosis factor'
  }], { incrementSupport: true, importedAt: '2026-05-01T00:00:00.000Z' });
  assert.equal(importedAgain.memory.entries.some(item => item.abbreviation === 'TNF'), true);
});
