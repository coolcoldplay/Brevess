'use strict';
// Pure source-attribute contract, based on the captured Nature reference list.
// Geometry is verified separately by the bounded real-source browser replay.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { functionSource } = require('./helpers/r28-full07-source.js');
const api = require('../core/faithful-page-snapshot.js');
const fixtureSource = fs.readFileSync(path.join(__dirname, 'r21-export-faithful-snapshot.test.js'), 'utf8');
const fixture = new Function(functionSource(fixtureSource, 'fixture') + '\nreturn fixture;')();
const REFERENCE_CSS = '.c-article-references__item::before{content:attr(data-counter);font-size:1.5rem;line-height:1.4;text-align:right}';

function reference(f, counter, overrides = {}) {
  const list = f.element(overrides.listTag || 'ol', { class: overrides.listClass ?? 'c-article-references' });
  const item = f.element(overrides.itemTag || 'li', { class: overrides.itemClass ?? 'c-article-references__item js-c-reading-companion-references-item', 'data-counter': counter, ...overrides.attrs });
  const paragraph = f.element('p', { class: 'c-article-references__text', id: 'ref-CR' + counter.slice(0, -1) }, 'Original reference text.');
  item.appendChild(paragraph); list.appendChild(item); (overrides.parent || f.article).appendChild(list);
  return { list, item, paragraph };
}
function count(html) { return [...html.matchAll(/\sdata-counter="([^"]*)"/g)].map(match => match[1]); }

test('captured Nature reference semantics retain all 48 exact counters and the original CSS attr rule', async () => {
  const f = fixture(); f.style(REFERENCE_CSS);
  for (let n = 1; n <= 48; n++) reference(f, n + '.');
  const before = f.document.documentElement.outerHTML;
  const result = await api.exportFaithfulPageSnapshot(f.options);
  assert.deepEqual(count(result.html), Array.from({ length: 48 }, (_, index) => (index + 1) + '.'));
  assert.ok(result.html.includes(REFERENCE_CSS));
  assert.equal(f.document.documentElement.outerHTML, before, 'source attributes and element order stay untouched');
});

test('bounded positive decimal counter values are copied verbatim, without renumbering', async () => {
  const f = fixture(); for (const value of ['48.', '1.', '9999.', '48.']) reference(f, value);
  assert.deepEqual(count((await api.exportFaithfulPageSnapshot(f.options)).html), ['48.', '1.', '9999.', '48.']);
});

for (const value of ['0.', '01.', '10000.', '-1.', '1', '1.5', '1. ', ' 1.', '１.', 'SECRET.', '1.\n', '1." onmouseover="steal()']) {
  test('rejects a non-contract counter value ' + JSON.stringify(value), async () => {
    const f = fixture(); reference(f, value);
    assert.deepEqual(count((await api.exportFaithfulPageSnapshot(f.options)).html), []);
  });
}

for (const overrides of [
  { itemTag: 'p' }, { listTag: 'ul' }, { listClass: 'ordinary-list' },
  { itemClass: 'ordinary-item' }, { listClass: 'not-c-article-references' },
  { itemClass: 'c-article-references__item-suffix' },
  { itemClass: 'c-article-footnote--listed__item' }
]) test('rejects an unsupported counter container ' + JSON.stringify(overrides), async () => {
  const f = fixture(); reference(f, '1.', overrides);
  assert.deepEqual(count((await api.exportFaithfulPageSnapshot(f.options)).html), []);
});

test('a matching list outside the selected article does not expose its counter or text', async () => {
  const f = fixture(); reference(f, '1.', { parent: f.wrapper });
  const result = await api.exportFaithfulPageSnapshot(f.options);
  assert.deepEqual(count(result.html), []); assert.doesNotMatch(result.html, /Original reference text/);
});

test('private and plugin nodes, including matching list ancestors, remain excluded', async () => {
  const f = fixture();
  for (const attrs of [{ class: 'account' }, { 'data-sci-plugin-ui': '' }, { 'data-sci-translation': 'true' }]) {
    const privateRoot = f.element('div', attrs); f.article.appendChild(privateRoot); reference(f, '1.', { parent: privateRoot });
  }
  reference(f, '2.', { itemClass: 'c-article-references__item user-account' });
  const result = await api.exportFaithfulPageSnapshot(f.options);
  assert.deepEqual(count(result.html), []); assert.doesNotMatch(result.html, /Original reference text/);
});

test('counter support does not copy other data, event attributes, CSS comments or executable CSS', async () => {
  const f = fixture();
  f.style('/* PRIVATE_COMMENT */' + REFERENCE_CSS + '.c-article-references__item{color:blue;background:url(javascript:steal());x:expression(steal())}');
  const { item } = reference(f, '1.', { attrs: { 'data-session-token': 'PRIVATE_TOKEN', 'data-track-item_id': 'PRIVATE_TRACK', onclick: 'steal()', style: 'padding-left:8px' } });
  const before = item.outerHTML;
  const result = await api.exportFaithfulPageSnapshot({ ...f.options, fetchResource() { throw Error('No resource request expected'); } });
  assert.deepEqual(count(result.html), ['1.']); assert.match(result.html, /padding-left:8px/);
  assert.ok(result.html.includes(REFERENCE_CSS));
  assert.doesNotMatch(result.html, /PRIVATE_|data-session|data-track|onclick|javascript:|expression\(|<script/i);
  assert.equal(item.outerHTML, before);
});

test('reference annotations retain a static note without exporting their private source attributes', async () => {
  const f = fixture(); const { paragraph } = reference(f, '1.');
  paragraph.appendChild(f.element('mark', { class: 'sci-manual-highlight', 'data-annotation-id': 'ref-note', 'data-counter': '2.', 'data-session-token': 'PRIVATE_TOKEN', role: 'button', 'aria-label': 'Edit highlight' }, 'marked reference'));
  const result = await api.exportFaithfulPageSnapshot({ ...f.options, annotations: [{ id: 'ref-note', quote: 'marked reference', note: 'Reference reading note' }] });
  assert.deepEqual(count(result.html), ['1.']); assert.equal(result.report.preservedAnnotations, 1);
  assert.match(result.html, /Reference reading note/); assert.doesNotMatch(result.html, /data-annotation-id|PRIVATE_TOKEN|role="button"|Edit highlight/);
});
