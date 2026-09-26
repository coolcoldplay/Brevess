const test = require('node:test');
const assert = require('node:assert/strict');
const { createSemanticFindDomSnapshot } = require('../core/semantic-find-dom.js');
const { normalizeTextWithOffsets } = require('../core/article-extractor.js');
const { domFixture } = require('./helpers/semantic-find-dom-fixture.js');

function fixture() {
  const f = domFixture();
  const text = f.text('Known sentence.');
  const block = f.element('p', {}, [text]); f.append(block);
  const snapshot = createSemanticFindDomSnapshot(f.document, { normalizeTextWithOffsets });
  return { ...f, snapshot, source: text, block };
}
function assertRetired(snapshot, paragraph = snapshot.paragraphs[0]) {
  const hit = { ...paragraph, start: 0, end: paragraph.text.length };
  assert.equal(snapshot.isCurrent(), true);
  assert.equal(snapshot.isHitCurrent(hit), false); assert.deepEqual(snapshot.ranges(hit), []);
}

test('new independent blocks keep immutable original paragraphs, scores identity and ranges', () => {
  const f = fixture(); const original = JSON.stringify(f.snapshot.paragraphs);
  let notices = 0; let invalidations = 0;
  f.snapshot.watch(() => invalidations++, () => {}, () => notices++);
  for (let index = 0; index < 3; index++) {
    const added = f.element('p', {}, [f.text(`Lazy card ${index}.`)]); f.append(added);
    f.records.push({ type: 'childList', target: f.document.body, addedNodes: [added], removedNodes: [] });
    assert.equal(f.snapshot.isCurrent(), true);
    assert.equal(JSON.stringify(f.snapshot.paragraphs), original);
    const p = f.snapshot.paragraphs[0];
    assert.equal(f.snapshot.range({ ...p, start: 0, end: p.text.length }).startContainer, f.source);
  }
  assert.equal(notices, 3, 'each newly admitted batch schedules a supplemental search'); assert.equal(invalidations, 0);
});

test('adding text inside an indexed block is a real source change even after independent additions', () => {
  const f = fixture();
  const added = f.element('p', {}, [f.text('New independent content.')]); f.append(added);
  f.records.push({ type: 'childList', target: f.document.body, addedNodes: [added], removedNodes: [] });
  assert.equal(f.snapshot.isCurrent(), true);
  f.source.nodeValue += ' Changed within indexed paragraph.';
  f.records.push({ type: 'characterData', target: f.source });
  assertRetired(f.snapshot);
  assert.ok(f.snapshot.drainAdditionalParagraphs().some(p => p.text === 'Known sentence. Changed within indexed paragraph.'));
});

test('empty text filling inside an existing paragraph rejects its old sentence and readmits the new one', () => {
  const f = fixture(); const blank = f.text(''); blank.parentElement = blank.parentNode = f.block;
  f.block.childNodes.push(blank);
  blank.nodeValue = ' New detail.'; f.records.push({ type: 'characterData', target: blank });
  assertRetired(f.snapshot);
  assert.equal(f.snapshot.drainAdditionalParagraphs()[0].text, 'Known sentence. New detail.');
});

test('pure visibility changes retain original text whereas showing a separate block is additional', () => {
  const f = fixture(); const added = f.element('p', {}, [f.text('Newly shown independent source.')]);
  added.style.display = 'none'; f.append(added);
  added.style.display = 'block'; f.records.push({ type: 'attributes', target: added, attributeName: 'class' });
  assert.equal(f.snapshot.isCurrent(), true); assert.equal(f.snapshot.hasAdditionalContent, true);
  f.block.style.display = 'none'; f.records.push({ type: 'attributes', target: f.block, attributeName: 'class' });
  assert.equal(f.snapshot.isCurrent(), true);
  f.source.nodeValue = 'Changed while hidden.';
  f.records.push({ type: 'characterData', target: f.source });
  assertRetired(f.snapshot);
  assert.ok(!f.snapshot.drainAdditionalParagraphs().some(p => p.text === 'Changed while hidden.'));
});

test('inserting a nested block between unchanged old Text nodes changes the original sentence', () => {
  const f = domFixture(); const first = f.text('The effect '); const last = f.text('increases.');
  const p = f.element('p', {}, [first, last]); f.append(p);
  const snapshot = createSemanticFindDomSnapshot(f.document, { normalizeTextWithOffsets });
  const inserted = f.element('div', {}, [f.text('never')]); inserted.parentNode = inserted.parentElement = p;
  p.childNodes = [first, inserted, last];
  f.records.push({ type: 'childList', target: p, addedNodes: [inserted], removedNodes: [] });
  assertRetired(snapshot);
  assert.ok(snapshot.drainAdditionalParagraphs().some(p => p.text === 'never'));
});

test('reordering unchanged Text nodes is a source change, not a visibility change', () => {
  const f = domFixture(); const first = f.text('first '); const last = f.text('second.');
  const p = f.element('p', {}, [first, last]); f.append(p);
  const snapshot = createSemanticFindDomSnapshot(f.document, { normalizeTextWithOffsets });
  p.childNodes = [last, first];
  f.records.push({ type: 'childList', target: p, addedNodes: [first], removedNodes: [first] });
  assertRetired(snapshot);
  assert.ok(snapshot.drainAdditionalParagraphs().some(p => p.text !== snapshot.paragraphs[0].text));
});

test('replacing or removing a known source owner cannot be passed off as only additional content', () => {
  const f = fixture(); const replacement = f.element('p', {}, [f.text('Known sentence.')]);
  f.block.isConnected = false; f.source.isConnected = false; f.document.body.childNodes = []; f.append(replacement);
  f.records.push({ type: 'childList', target: f.document.body, addedNodes: [replacement], removedNodes: [f.block] });
  assertRetired(f.snapshot);
  const replacementParagraph = f.snapshot.drainAdditionalParagraphs()[0];
  assert.notEqual(replacementParagraph.paragraphId, f.snapshot.paragraphs[0].paragraphId);
  assert.equal(f.snapshot.range({ ...replacementParagraph, start: 0, end: replacementParagraph.text.length }).startContainer, replacement.childNodes[0]);
});
