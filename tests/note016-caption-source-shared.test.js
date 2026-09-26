const test = require('node:test');
const assert = require('node:assert/strict');
const { articleCaptionSource, collectArticleCaptionSources } = require('../core/article-extractor.js');

const textNode = nodeValue => ({ nodeType: 3, nodeValue });
function caption(children, ancestor = '') {
  return { tagName: 'FIGCAPTION', childNodes: children,
    closest: selector => ancestor && selector.split(',').map(s => s.trim()).includes(ancestor) ? {} : null };
}

test('shared caption source preserves ordinary publisher scientific text and exact original target', () => {
  const element = caption([textNode('Figure 1. CD8'), { tagName: 'SUP', childNodes: [textNode('+')] },
    textNode(' cells and H'), { tagName: 'SUB', childNodes: [textNode('2')] }, textNode('O.')]);
  const source = articleCaptionSource(element);
  assert.equal(source.element, element);
  assert.deepEqual(source.parts, [element]);
  assert.equal(source.text, 'Figure 1. CD8+ cells and H2O.');
  assert.equal(source.displayText, 'Figure 1. CD8<sup>+</sup> cells and H<sub>2</sub>O.');
});

test('shared caption source rejects UI, hidden, related and navigation containers', () => {
  for (const ancestor of ['[data-sci-plugin-ui]', '#sci-reading-panel', '[hidden]', '[aria-hidden="true"]',
    '.c-article-recommendations-card', '.related-articles', 'nav', 'aside']) {
    assert.equal(articleCaptionSource(caption([textNode('Figure 1. Original scientific evidence.')], ancestor)), null, ancestor);
  }
});

test('supplementary title parsing stays restricted to a Nature article document', () => {
  const element = { tagName: 'H3', matches: selector => selector === 'h3.c-article-supplementary__title',
    textContent: 'Extended Data Fig. 1 Not a source on this site.',
    ownerDocument: { location: { hostname: 'www.cell.com', pathname: '/articles/foreign' } } };
  assert.equal(articleCaptionSource(element), null);
  element.ownerDocument.location = { hostname: 'www.nature.com', pathname: '/articles/id/figures/1' };
  assert.equal(articleCaptionSource(element), null);
});

test('source enumeration retains duplicate visible candidates for navigation to reject ambiguity', () => {
  const first = caption([textNode('Figure 1. Matching original caption.')]);
  const second = caption([textNode('Figure 1. Matching original caption.')]);
  const sources = collectArticleCaptionSources({ querySelectorAll: () => [first, second] });
  assert.equal(sources.length, 2);
  assert.notEqual(sources[0].element, sources[1].element);
  assert.equal(sources[0].text, sources[1].text);
});
