const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const modulePath = path.join(__dirname, '../core/article-bibliography.js');
const api = fs.existsSync(modulePath) ? require(modulePath) : {};
const workspaceId = `workspace:${'a'.repeat(64)}`;
const canonicalUrl = 'https://example.org/article?id=1';
const identity = { workspaceId, canonicalUrl };

function documentWith(metas = [], extras = {}) {
  return {
    head: { querySelectorAll(selector) {
      assert.equal(selector, 'meta[name],meta[property]');
      return metas.map(([key, content, attr = 'name']) => ({
        getAttribute(name) { return name === attr ? key : name === 'content' ? content : null; }
      }));
    } },
    title: 'A scientific article', ...extras
  };
}
function extract(metas, extras, options = {}) {
  assert.equal(typeof api.extractArticleBibliography, 'function', 'bibliography extractor must exist');
  return api.extractArticleBibliography(documentWith(metas, extras), { canonicalUrl, ...options });
}
function normalize(value, options = identity) {
  assert.equal(typeof api.normalizeArticleBibliographyAsset, 'function', 'bibliography validator must exist');
  return api.normalizeArticleBibliographyAsset(value, options);
}
function asset(metas = [['citation_journal_title', 'Science'], ['citation_date', '2024-02-29']]) {
  return { ...extract(metas), workspaceId };
}

test('LIB-010 exposes the plain asset path and CommonJS/SciLLM API', () => {
  assert.equal(api.ARTICLE_BIBLIOGRAPHY_ASSET_PATH, 'article/bibliography.json');
  assert.equal(globalThis.SciLLM.extractArticleBibliography, api.extractArticleBibliography);
});

test('empty head remains unknown and never uses title, domain, modified or copyright dates', () => {
  const result = extract([
    ['article:modified_time', '2025-01-01', 'property'], ['dc.date.modified', '2024-01-01'],
    ['copyright', '2020'], ['citation_title', 'Science — 2024']
  ], { title: 'Science 2024', location: { href: 'https://nature.com/article' } });
  assert.equal(result.journal.status, 'unknown');
  assert.equal(result.journal.reason, 'missing');
  assert.equal(result.publicationDate.value, '');
  assert.equal(result.publicationDate.precision, 'unknown');
  assert.equal(result.publicationDate.year, null);
  assert.equal(result.canonicalUrl, canonicalUrl);
});

test('explicit citation and PRISM journal metadata preserve raw provenance and NFC scientific text', () => {
  const raw = '  Cafe\u0301 µRNA ² α ⇌ β 🧬  ';
  const result = extract([
    ['citation_journal_title', raw], ['PRISM.publicationName', raw.normalize('NFC'), 'property']
  ]);
  assert.equal(result.journal.value, 'Café µRNA ² α ⇌ β 🧬');
  assert.equal(result.journal.raw, raw.normalize('NFC'));
  assert.equal(result.journal.source, 'meta:citation_journal_title');
  assert.equal(result.journal.evidence.length, 2);
});

for (const [raw, value, precision, year, month, day] of [
  ['2024', '2024', 'year', 2024, null, null],
  ['2024-02', '2024-02', 'month', 2024, 2, null],
  ['2024/02', '2024-02', 'month', 2024, 2, null],
  ['2024-02-29', '2024-02-29', 'day', 2024, 2, 29],
  ['2000/02/29', '2000-02-29', 'day', 2000, 2, 29]
]) {
  test(`publication date ${raw} keeps ${precision} precision without invented parts`, () => {
    const result = extract([['citation_publication_date', raw]]).publicationDate;
    assert.equal(result.status, 'known');
    assert.deepEqual([result.value, result.precision, result.year, result.month, result.day],
      [value, precision, year, month, day]);
    assert.equal(result.raw, raw);
    assert.equal(result.source, 'meta:citation_publication_date');
  });
}

test('invalid dates, incomplete syntax and unsupported timestamps are unknown, never Date-coerced', () => {
  for (const raw of ['1900-02-29', '2023-02-29', '2024-04-31', '0000', '2024-00', '2024-13',
    '2024-01-00', '2024-02/29', '24-02-29', 'February 2024', '2024-1-1', '2024-01-01T25:00:00Z']) {
    const result = extract([['prism.publicationDate', raw, 'property']]).publicationDate;
    assert.equal(result.status, 'unknown', raw);
    assert.equal(result.reason, 'invalid', raw);
    assert.equal(result.value, '', raw);
    assert.equal(result.evidence[0].raw, raw);
  }
});

test('semantically equal numeric date encodings agree but different precision remains a conflict', () => {
  const same = extract([['citation_date', '2024/02/29'], ['prism.publicationDate', '2024-02-29', 'property']]);
  assert.equal(same.publicationDate.value, '2024-02-29');
  const conflict = extract([['citation_date', '2024'], ['citation_publication_date', '2024-02-29']]);
  assert.equal(conflict.publicationDate.status, 'unknown');
  assert.equal(conflict.publicationDate.reason, 'conflict');
  assert.equal(conflict.publicationDate.evidence.length, 2);
});

test('different journal names or publication dates remain unknown with both bounded sources', () => {
  const result = extract([
    ['citation_journal_title', 'Science'], ['prism.publicationName', 'Nature', 'property'],
    ['citation_date', '2024-02-28'], ['citation_publication_date', '2024-02-29']
  ]);
  assert.equal(result.journal.reason, 'conflict');
  assert.equal(result.publicationDate.reason, 'conflict');
  assert.deepEqual(result.journal.evidence.map(item => item.raw), ['Science', 'Nature']);
});

test('invalid competing publication evidence cannot be hidden by an otherwise valid value', () => {
  const result = extract([['citation_date', '2024-02-29'], ['citation_publication_date', '2023-02-29']]);
  assert.equal(result.publicationDate.status, 'unknown');
  assert.equal(result.publicationDate.reason, 'invalid');
});

test('related-paper JSON-LD and body metadata are not used by the explicit head-only contract', () => {
  let bodyReads = 0;
  const result = extract([], { querySelectorAll() { bodyReads++; return [{
    textContent: JSON.stringify({ '@type': 'ScholarlyArticle', '@id': 'https://example.org/article?id=2',
      headline: 'A scientific article', datePublished: '2025-01-01', isPartOf: { name: 'Unrelated Journal' } })
  }]; } });
  assert.equal(bodyReads, 0);
  assert.equal(result.journal.reason, 'missing');
  assert.equal(result.publicationDate.reason, 'missing');
});

test('control characters, bidi controls and lone surrogates are refused without truncating into a valid name', () => {
  for (const raw of ['Science\u0000', 'Nature\n', 'Cell\u0085', 'RNA\u202eabc', 'RNA\ud800']) {
    const result = extract([['citation_journal_title', raw]]).journal;
    assert.equal(result.status, 'unknown', JSON.stringify(raw));
    assert.equal(result.reason, 'invalid');
    assert.equal(result.raw, '');
    assert.deepEqual(result.evidence, []);
  }
});

test('safe HTML-like strings stay plain text data and are never interpreted', () => {
  const raw = '<img src=x onerror=alert(1)> µRNA';
  assert.equal(extract([['citation_journal_title', raw]]).journal.value, raw);
});

test('field and head bounds fail closed instead of claiming a complete conflict-free value', () => {
  const long = extract([['citation_journal_title', 'A'.repeat(513)], ['citation_date', '2024']]);
  assert.equal(long.journal.reason, 'bounds');
  assert.equal(long.publicationDate.value, '2024');
  const many = extract(Array.from({ length: 33 }, () => ['citation_journal_title', 'Same']));
  assert.equal(many.journal.reason, 'bounds');
  assert.ok(many.journal.evidence.length <= 32);
  const hugeHead = extract(Array.from({ length: 257 }, () => ['unrelated', 'value']));
  assert.equal(hugeHead.journal.reason, 'bounds');
  assert.equal(hugeHead.publicationDate.reason, 'bounds');
});

test('oversized raw strings hit their bound before content inspection and retain no partial raw evidence', () => {
  const result = extract([['citation_journal_title', `${'A'.repeat(513)}\u0000`]]).journal;
  assert.equal(result.reason, 'bounds');
  assert.deepEqual(result.evidence, []);
  const original = asset();
  original.journal.evidence[0].source = `meta:${'a'.repeat(100000)}`;
  assert.equal(normalize(original), null);
});

test('malformed document input does not throw or invent evidence', () => {
  assert.equal(typeof api.extractArticleBibliography, 'function');
  for (const doc of [null, {}, { head: { querySelectorAll() { throw new Error('unavailable'); } } }]) {
    const result = api.extractArticleBibliography(doc, { canonicalUrl });
    assert.equal(result.journal.status, 'unknown');
    assert.equal(result.publicationDate.status, 'unknown');
  }
});

test('normalizer binds schema 1 to the exact verified workspace and canonical URL', () => {
  const original = asset();
  const normalized = normalize(original);
  assert.equal(normalized.schemaVersion, 1);
  assert.equal(normalized.workspaceId, workspaceId);
  assert.equal(normalized.canonicalUrl, canonicalUrl);
  assert.equal(normalized.publicationDate.value, '2024-02-29');
  for (const wrong of [
    { ...original, schemaVersion: 2 }, { ...original, workspaceId: `workspace:${'b'.repeat(64)}` },
    { ...original, canonicalUrl: 'https://example.org/article?id=2' },
    { ...original, canonicalUrl: `${canonicalUrl}#other` }
  ]) assert.equal(normalize(wrong), null);
});

test('normalizer preserves unknown conflict, invalid and bounded reasons through JSON round trips', () => {
  for (const metas of [[], [['citation_date', '2023-02-29']],
    [['citation_journal_title', 'One'], ['citation_journal_title', 'Two']],
    [['citation_journal_title', 'A'.repeat(513)]]]) {
    const original = asset(metas);
    assert.deepEqual(normalize(JSON.parse(JSON.stringify(original))), original);
  }
});

test('normalizer recomputes derived fields, strips unknown keys and does not mutate the asset', () => {
  const input = asset();
  input.journal.value = 'Forged journal';
  Object.assign(input.publicationDate, { value: '1900-01-01', year: 1900, month: 1, day: 1, precision: 'year' });
  input.untrusted = '<script>alert(1)</script>';
  const before = JSON.stringify(input);
  const output = normalize(input);
  assert.equal(output.journal.value, 'Science');
  assert.equal(output.publicationDate.value, '2024-02-29');
  assert.equal(output.publicationDate.year, 2024);
  assert.equal(output.untrusted, undefined);
  assert.equal(JSON.stringify(input), before);
});

test('normalizer rejects unsupported provenance, unsafe strings, excess evidence and wrong structures', () => {
  const original = asset();
  for (const evidence of [
    [{ source: 'meta:article:modified_time', raw: '2024' }],
    [{ source: 'meta:citation_date', raw: '2024\u0000' }],
    [{ source: 'meta:citation_date', raw: '2'.repeat(129) }],
    Array.from({ length: 33 }, () => ({ source: 'meta:citation_date', raw: '2024' }))
  ]) assert.equal(normalize({ ...original, publicationDate: { ...original.publicationDate, evidence } }), null);
  for (const input of [null, [], {}, { ...original, journal: null }, { ...original, publicationDate: [] }]) {
    assert.equal(normalize(input), null);
  }
});

test('unsafe URL schemes, credentials, controls, oversized URLs and malformed workspace IDs are rejected', () => {
  for (const url of ['javascript:alert(1)', 'file:///article.pdf', 'https://user:pass@example.org/paper',
    'https://example.org/\narticle', `https://example.org/${'a'.repeat(4096)}`]) {
    const raw = { ...asset(), canonicalUrl: url };
    assert.equal(normalize(raw, { workspaceId, canonicalUrl: url }), null);
    const extracted = extract([['citation_date', '2024']], undefined, { canonicalUrl: url });
    assert.equal(extracted.canonicalUrl, '');
    assert.equal(extracted.publicationDate.status, 'unknown');
  }
  assert.equal(normalize({ ...asset(), workspaceId: 'wrong' }, { ...identity, workspaceId: 'wrong' }), null);
});
