const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PUBLISHER_ADAPTER_VERSION,
  PUBLISHER_ADAPTERS,
  selectPublisherAdapter
} = require('../core/publisher-adapters.js');

test('selects the confirmed publisher family by hostname', () => {
  const cases = [
    ['www.sciencedirect.com', 'elsevier'],
    ['www.cell.com', 'elsevier'],
    ['www.thelancet.com', 'elsevier'],
    ['www.nature.com', 'springer-nature'],
    ['link.springer.com', 'springer-nature'],
    ['bmccancer.biomedcentral.com', 'springer-nature'],
    ['onlinelibrary.wiley.com', 'wiley'],
    ['academic.oup.com', 'oup'],
    ['www.tandfonline.com', 'taylor-francis'],
    ['journals.plos.org', 'plos'],
    ['www.frontiersin.org', 'frontiers'],
    ['www.mdpi.com', 'mdpi'],
    ['pubs.acs.org', 'acs'],
    ['pubs.rsc.org', 'rsc'],
    ['www.science.org', 'aaas'],
    ['jamanetwork.com', 'jama'],
    ['www.bmj.com', 'bmj'],
    ['www.nejm.org', 'nejm'],
    ['pmc.ncbi.nlm.nih.gov', 'pmc-jats'],
    ['www.biorxiv.org', 'preprint'],
    ['www.medrxiv.org', 'preprint']
  ];

  for (const [hostname, expectedFamily] of cases) {
    assert.equal(
      selectPublisherAdapter({ hostname }, {}).family,
      expectedFamily,
      hostname
    );
  }
});

test('defines immutable bounded structural contracts for every adapter', () => {
  assert.equal(PUBLISHER_ADAPTER_VERSION, '3');
  assert.ok(PUBLISHER_ADAPTERS.length >= 16);
  for (const adapter of PUBLISHER_ADAPTERS) {
    assert.ok(Object.isFrozen(adapter), adapter.id);
    for (const key of [
      'articleRootSelectors', 'outlineRootSelectors', 'outlineLinkSelectors',
      'headingSelectors', 'paragraphSelectors', 'excludedSelectors',
      'stabilitySelectors'
    ]) {
      assert.ok(Array.isArray(adapter[key]), `${adapter.id}:${key}`);
      assert.ok(adapter[key].length > 0, `${adapter.id}:${key}`);
      assert.ok(adapter[key].length <= 40, `${adapter.id}:${key}`);
    }
  }
});

test('falls back to a generic adapter for an unknown journal', () => {
  const adapter = selectPublisherAdapter({ hostname: 'journal.example' }, {});
  assert.equal(adapter.id, 'generic');
  assert.equal(adapter.family, 'generic');
  assert.ok(adapter.articleRootSelectors.includes('article'));
  assert.ok(adapter.headingSelectors.includes('h1,h2,h3,h4,h5,h6'));
});

test('uses the ACS body container as the clean publisher-specific root', () => {
  const adapter = selectPublisherAdapter({ hostname: 'pubs.acs.org' }, {});
  assert.deepEqual(adapter.specificArticleRootSelectors, ['.article_content']);
  assert.ok(adapter.articleRootSelectors.includes('main'));
});

test('keeps ScienceDirect leaf article-body containers out of trusted full-text roots', () => {
  const adapter = selectPublisherAdapter({ hostname: 'www.sciencedirect.com' }, {});
  assert.ok(adapter.specificArticleRootSelectors.includes('#body'));
  assert.ok(adapter.specificArticleRootSelectors.includes('.Body'));
  assert.equal(adapter.specificArticleRootSelectors.includes('.article-body'), false);
});

test('declares Cell video controls as precise publisher chrome', () => {
  const adapter = selectPublisherAdapter({ hostname: 'www.cell.com' }, {});
  assert.ok(adapter.excludedSelectors.includes('.video-player'));
  assert.ok(adapter.excludedSelectors.includes('.video-playback'));
  assert.ok(adapter.excludedSelectors.includes('.video-player-modal'));
  assert.ok(adapter.excludedSelectors.includes('.keyboard-shortcuts-modal'));
  assert.ok(adapter.excludedSelectors.includes('.download-options-modal'));
  assert.ok(adapter.excludedSelectors.includes('.transcript-panel'));
  assert.equal(adapter.excludedSelectors.includes('[class*="transcript"]'), false);
});

test('declares AAAS collateral and author panels as publisher chrome', () => {
  const adapter = selectPublisherAdapter({ hostname: 'spj.science.org' }, {});
  assert.ok(adapter.excludedSelectors.includes('.core-authors'));
  assert.ok(adapter.excludedSelectors.includes('.core-collateral'));
  assert.ok(adapter.excludedSelectors.includes('#tab-contributors'));
});

test('uses the bioRxiv full-text markup as the clean preprint root', () => {
  const adapter = selectPublisherAdapter({ hostname: 'www.biorxiv.org' }, {});
  assert.deepEqual(adapter.specificArticleRootSelectors, ['.highwire-markup']);
});
