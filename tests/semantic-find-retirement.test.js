const test = require('node:test');
const assert = require('node:assert/strict');
const { createSemanticFindDomSnapshot } = require('../core/semantic-find-dom.js');
const { normalizeTextWithOffsets } = require('../core/article-extractor.js');
const { domFixture } = require('./helpers/semantic-find-dom-fixture.js');

function fixture() {
  const f = domFixture();
  const stableText = f.text('Stable scientific source.'); const counterText = f.text('0');
  const stable = f.element('p', {}, [stableText]); const counter = f.element('p', {}, [counterText]);
  f.append(stable, counter);
  const snapshot = createSemanticFindDomSnapshot(f.document, { normalizeTextWithOffsets });
  let stale = 0; let rebound = 0; let additions = 0;
  snapshot.watch(() => stale++, () => rebound++, () => additions++);
  const hits = snapshot.paragraphs.map(p => ({ ...p, start: 0, end: p.text.length }));
  return { ...f, stableText, counterText, stable, counter, snapshot, hits,
    get stale() { return stale; }, get rebound() { return rebound; }, get additions() { return additions; } };
}

test('live counter plus appended card retires only old counter and admits new content once', () => {
  const f = fixture(); f.counterText.nodeValue = '23';
  const added = f.element('p', {}, [f.text('New feed card.')]); f.append(added);
  f.records.push({ type: 'characterData', target: f.counterText },
    { type: 'childList', target: f.document.body, addedNodes: [added], removedNodes: [] });
  assert.equal(f.snapshot.isCurrent(), true); assert.equal(f.stale, 0);
  assert.equal(f.snapshot.isHitCurrent(f.hits[0]), true);
  assert.equal(f.snapshot.isHitCurrent(f.hits[1]), false); assert.deepEqual(f.snapshot.ranges(f.hits[1]), []);
  const delta = f.snapshot.drainAdditionalParagraphs();
  assert.deepEqual(delta.map(p => p.text), ['23', 'New feed card.']);
  assert.ok(delta.every(p => !f.hits.some(hit => hit.paragraphId === p.paragraphId)));
  assert.equal(f.snapshot.drainAdditionalParagraphs().length, 0); assert.equal(f.rebound, 1);
});

test('deleting an indexed or pending block preserves other results and removes pending dead text', () => {
  const f = fixture(); const pending = f.element('p', {}, [f.text('Temporary appended block.')]); f.append(pending);
  f.records.push({ type: 'childList', target: f.document.body, addedNodes: [pending], removedNodes: [] });
  assert.equal(f.snapshot.isCurrent(), true);
  for (const removed of [pending, f.counter]) {
    removed.isConnected = false; removed.childNodes.forEach(node => { node.isConnected = false; });
    f.document.body.childNodes = f.document.body.childNodes.filter(node => node !== removed);
    removed.parentNode = removed.parentElement = null;
    f.records.push({ type: 'childList', target: f.document.body, addedNodes: [], removedNodes: [removed] });
  }
  assert.equal(f.snapshot.isCurrent(), true); assert.equal(f.snapshot.isHitCurrent(f.hits[0]), true);
  assert.equal(f.snapshot.isHitCurrent(f.hits[1]), false); assert.equal(f.snapshot.drainAdditionalParagraphs().length, 0);
});

test('new words and old-node reorder retire their owner without bridging a stale sentence', () => {
  for (const mutation of ['insert', 'reorder']) {
    const f = fixture(); const a = f.text('The effect '); const b = f.text('increases.');
    const p = f.element('p', {}, [a, b]); f.append(p);
    f.records.push({ type: 'childList', target: f.document.body, addedNodes: [p], removedNodes: [] });
    const admitted = f.snapshot.drainAdditionalParagraphs()[0]; const hit = { ...admitted, start: 0, end: admitted.text.length };
    const added = mutation === 'insert' ? f.element('div', {}, [f.text('never')]) : a;
    if (mutation === 'insert') { added.parentNode = added.parentElement = p; p.childNodes = [a, added, b]; }
    else p.childNodes = [b, a];
    f.records.push({ type: 'childList', target: p, addedNodes: [added], removedNodes: mutation === 'insert' ? [] : [a] });
    assert.equal(f.snapshot.isCurrent(), true); assert.equal(f.snapshot.isHitCurrent(hit), false);
    assert.deepEqual(f.snapshot.ranges(hit), []); assert.equal(f.snapshot.isHitCurrent(f.hits[0]), true);
    assert.ok(f.snapshot.drainAdditionalParagraphs().length > 0);
  }
});

test('visibility preserves identity but conversion to editing/plugin content suppresses its hit', () => {
  for (const excluded of ['contenteditable', 'ui']) {
    const f = fixture(); f.counter.style.display = 'none';
    f.records.push({ type: 'attributes', target: f.counter, attributeName: 'style' });
    assert.equal(f.snapshot.isCurrent(), true); assert.equal(f.snapshot.isHitCurrent(f.hits[1]), true);
    f.counter.style.display = 'block'; f.counter.attributes[excluded] = true;
    f.records.push({ type: 'attributes', target: f.counter, attributeName: excluded });
    assert.equal(f.snapshot.isCurrent(), true); assert.equal(f.snapshot.isHitCurrent(f.hits[1]), false);
    assert.equal(f.snapshot.isHitCurrent(f.hits[0]), true); assert.deepEqual(f.snapshot.ranges(f.hits[1]), []);
  }
});

test('replacing the document body still invalidates the whole snapshot', () => {
  const f = fixture(); f.document.body.isConnected = false; f.document.body = f.element('body');
  assert.equal(f.snapshot.isCurrent(), false); assert.equal(f.snapshot.isHitCurrent(f.hits[0]), false);
});
