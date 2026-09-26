const test = require('node:test');
const assert = require('node:assert/strict');
const { selectPublisherAdapter } = require('../core/publisher-adapters.js');
const { collectContentElements, extractArticle, scientificInlineText } = require('../core/article-extractor.js');

const adapter = selectPublisherAdapter({ hostname: 'www.cell.com', pathname: '/cell/fulltext/S0092-8674(25)01247-4' });
function element(tagName, ancestors = []) {
  return { tagName, textContent: 'Original scientific caption remains a typed source, with controls and uncertainty.',
    closest(selector) { return selector.split(',').map(value => value.trim()).some(value => ancestors.includes(value)) ? {} : null; },
    querySelector: () => null, getAttribute: () => null };
}
function root(elements) {
  return { querySelectorAll(selector) {
    if (selector === '*') return elements;
    if (selector === 'p') return elements.filter(value => value.tagName === 'P');
    return [];
  } };
}

test('Cell adapter preserves original figcaption while still excluding noncaption figure prose', () => {
  assert.equal(adapter.id, 'elsevier-sciencedirect'); assert.ok(adapter.excludedSelectors.includes('figure'));
  const caption = element('FIGCAPTION', ['figure']);
  const figureProse = element('P', ['figure']);
  const body = element('P');
  assert.deepEqual(collectContentElements(root([caption, figureProse, body]), adapter), [caption, body]);
});

test('caption exception cannot escape hidden or navigation ancestors', () => {
  for (const ancestor of ['[hidden]', '[aria-hidden="true"]', 'nav', 'aside']) {
    const caption = element('FIGCAPTION', ['figure', ancestor]);
    assert.deepEqual(collectContentElements(root([caption]), adapter), [], ancestor);
  }
});

test('publisher-specific excluded containers still reject captions', () => {
  const caption = element('FIGCAPTION', ['figure', '.article-tools']);
  assert.deepEqual(collectContentElements(root([caption]), adapter), []);
});

test('default body extraction and body markers still exclude captions; typed capture retains them', () => {
  const caption = { ...element('FIGCAPTION', ['figure']), dataset: {} };
  const paragraph = { ...element('P'), textContent: 'The original body paragraph reports matched control measurements.', dataset: {} };
  const container = { ...root([caption, paragraph]), tagName: 'MAIN', id: 'main', className: '', getAttribute: () => null };
  const document = { body: container, querySelectorAll: () => [container] };
  assert.deepEqual(extractArticle(document, { adapter }).map(record => record.text), [paragraph.textContent]);
  assert.equal(caption.dataset.sciLlmParagraphId, undefined);
  assert.ok(paragraph.dataset.sciLlmParagraphId);
  const typed = extractArticle(document, { adapter, includeTyped: true });
  assert.equal(typed.filter(record => record.recordType === 'figure-caption').length, 1);
});

test('caption scientific text still excludes plugin note UI and retains mark text and superscript', () => {
  const text = nodeValue => ({ nodeType: 3, nodeValue });
  const node = (tagName, childNodes, plugin = false) => ({ tagName, childNodes,
    matches: selector => plugin && selector.includes('[data-sci-plugin-ui]') });
  const caption = node('FIGCAPTION', [text('Figure 1. '), node('MARK', [text('IL-2')]),
    text(' and CD8'), node('SUP', [text('+')]), text(' cells.'), node('BUTTON', [text('私有备注')], true)]);
  assert.equal(scientificInlineText(caption), 'Figure 1. IL-2 and CD8<sup>+</sup> cells.');
});

test('table captions and reference prose collection are unchanged', () => {
  const tableCaption = element('CAPTION');
  const referenceProse = element('P');
  assert.deepEqual(collectContentElements(root([tableCaption, referenceProse]), adapter), [tableCaption, referenceProse]);
});
