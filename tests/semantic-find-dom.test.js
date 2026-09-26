const test = require('node:test');
const assert = require('node:assert/strict');
const { createSemanticFindDomSnapshot } = require('../core/semantic-find-dom.js');
const { normalizeTextWithOffsets } = require('../core/article-extractor.js');
const { domFixture } = require('./helpers/semantic-find-dom-fixture.js');

function fixture() { const dom = domFixture(); return { ...dom, snapshot: () => createSemanticFindDomSnapshot(dom.document, { normalizeTextWithOffsets }) }; }

test('DOM corpus owns duplicate text locations separately and maps nested inline offsets', () => {
  const f = fixture(); const first = f.text('A '); const nested = f.text('nested'); const last = f.text(' sentence.');
  f.append(f.element('p', {}, [first, f.element('b', {}, [nested]), last]),
    f.element('p', {}, [f.text('Repeat.')]), f.element('p', {}, [f.text('Repeat.')]));
  // Model this semantic inline B as inline, just as the browser does.
  nested.parentElement.style.display = 'inline';
  const snapshot = f.snapshot();
  assert.deepEqual(snapshot.paragraphs.map(p => p.text), ['A nested sentence.', 'Repeat.', 'Repeat.']);
  assert.equal(new Set(snapshot.paragraphs.map(p => p.paragraphId)).size, 3);
  const hit = { paragraphId: snapshot.paragraphs[0].paragraphId, start: 2, end: 8, text: 'nested' };
  const range = snapshot.range(hit);
  assert.equal(range.startContainer, nested); assert.equal(range.endContainer, nested);
  assert.equal(range.startOffset, 0); assert.equal(range.endOffset, 6);
  assert.equal(snapshot.range({ ...hit, text: 'wrong' }), null);
});

test('DOM corpus excludes controls, editing contents and plugin labels while retaining marked source', () => {
  const f = fixture();
  f.append(f.element('p', {}, [f.text('To test '), f.element('sup', { note: true }, [f.text('备注')]),
    f.element('mark', {}, [f.text('the source.')])]), f.element('input', {}, [f.text('secret')]),
  f.element('div', { contenteditable: '' }, [f.text('editor')]), f.element('div', { ui: true }, [f.text('plugin')]));
  assert.deepEqual(f.snapshot().paragraphs.map(p => p.text), ['To test the source.']);
});

test('range fragments never bridge excluded visible editor or plugin text', () => {
  const f = fixture(); const before = f.text('Before '); const after = f.text('after.');
  f.append(f.element('p', {}, [before, f.element('span', { contenteditable: '' }, [f.text('secret')]), after]));
  const snapshot = f.snapshot(); const paragraph = snapshot.paragraphs[0];
  const hit = { ...paragraph, start: 0, end: paragraph.text.length };
  assert.equal(paragraph.text, 'Before after.');
  assert.equal(snapshot.range(hit), null, 'an enclosing manual-save range would include the editor');
  const ranges = snapshot.ranges(hit);
  assert.equal(ranges.length, 2);
  assert.equal(ranges[0].startContainer, before); assert.equal(ranges[0].endContainer, before);
  assert.equal(ranges[1].startContainer, after); assert.equal(ranges[1].endContainer, after);
});

test('changed source retires its old range synchronously without discarding unaffected source', () => {
  const f = fixture(); const node = f.text('Original.'); f.append(f.element('p', {}, [node]), f.element('p', {}, [f.text('Unaffected.')]));
  const snapshot = f.snapshot(); let invalidated = 0; snapshot.watch(() => invalidated++);
  node.nodeValue = 'Changed.'; f.records.push({ type: 'characterData', target: node });
  assert.equal(snapshot.isCurrent(), true); assert.equal(invalidated, 0);
  assert.equal(snapshot.range({ ...snapshot.paragraphs[0], start: 0, end: 9 }), null);
  assert.equal(snapshot.isHitCurrent({ ...snapshot.paragraphs[1], start: 0, end: 11 }), true);
  const delta = snapshot.drainAdditionalParagraphs(); assert.equal(delta[0].text, 'Changed.');
  assert.notEqual(delta[0].paragraphId, snapshot.paragraphs[0].paragraphId);
  assert.equal(snapshot.isCurrent(), true); assert.equal(invalidated, 0);
});

test('same-text annotation replacement rebinds ranges without invalidation or all-page character scans', () => {
  const f = fixture(); const node = f.text('Keep source.'); const p = f.element('p', {}, [node]);
  f.append(p, f.element('p', {}, [f.text('Other source.')])); const snapshot = f.snapshot();
  const next = f.text('Keep source.'); const mark = f.element('mark', {}, [next]);
  mark.parentElement = p; mark.parentNode = p; p.childNodes = [mark]; node.isConnected = false;
  f.records.push({ type: 'childList', target: p, addedNodes: [mark], removedNodes: [node] });
  const scanned = snapshot.counters.scannedTextNodes;
  assert.equal(snapshot.isCurrent(), true);
  assert.equal(snapshot.counters.scannedTextNodes - scanned, 1);
  const paragraph = snapshot.paragraphs[0];
  assert.equal(snapshot.range({ ...paragraph, start: 0, end: paragraph.text.length }).startContainer, next);
});

test('initially empty blocks advertise new text while hidden/edited/plugin filling stays quiet', () => {
  for (const initial of ['', '   ']) {
    const f = fixture(); const node = f.text(initial); f.append(f.element('p', {}, [node]));
    const snapshot = f.snapshot(); let notices = 0;
    snapshot.watch(() => {}, () => {}, () => notices++); node.nodeValue = 'New dynamic result.';
    f.records.push({ type: 'characterData', target: node });
    assert.equal(snapshot.isCurrent(), true, JSON.stringify(initial));
    assert.equal(snapshot.hasAdditionalContent, true); assert.equal(notices, 1);
    assert.deepEqual(snapshot.paragraphs, [], 'new text belongs to a subsequent search');
  }
  for (const attributes of [{ contenteditable: '' }, { ui: true }]) {
    const f = fixture(); const node = f.text(''); f.append(f.element('p', attributes, [node]));
    const snapshot = f.snapshot(); node.nodeValue = 'Excluded dynamic result.';
    f.records.push({ type: 'characterData', target: node }); assert.equal(snapshot.isCurrent(), true);
  }
  const f = fixture(); const hidden = f.text(''); const container = f.element('p', {}, [hidden]);
  container.style.display = 'none'; f.append(container, f.element('p', {}, [f.text('Other visible source.')]));
  const snapshot = f.snapshot(); const scanned = snapshot.counters.scannedTextNodes;
  hidden.nodeValue = 'Still hidden source.'; f.records.push({ type: 'characterData', target: hidden });
  assert.equal(snapshot.isCurrent(), true);
  assert.equal(snapshot.counters.scannedTextNodes, scanned, 'hidden empty scope must not rescan the page');
});

test('partial clipping keeps source offsets and avoids geometry probes for fully visible nodes', () => {
  const f = fixture(); const node = f.text('ABCD'); const clipped = f.element('p', {}, [node]);
  clipped.style.overflowX = 'hidden'; clipped.getBoundingClientRect = () =>
    ({ left: 10, right: 30, top: 0, bottom: 20, width: 20, height: 20 });
  f.document.createRange = () => ({
    selectNodeContents(source) { this.startContainer = this.endContainer = source; this.startOffset = 0; this.endOffset = source.nodeValue.length; },
    setStart(source, offset) { this.startContainer = source; this.startOffset = offset; },
    setEnd(source, offset) { this.endContainer = source; this.endOffset = offset; },
    getClientRects() { return [{ left: this.startOffset * 10, right: this.endOffset * 10,
      top: 0, bottom: 20, width: (this.endOffset - this.startOffset) * 10, height: 20 }]; }
  });
  f.append(clipped); const snapshot = f.snapshot();
  assert.equal(snapshot.paragraphs[0].text, 'BC');
  const range = snapshot.range({ ...snapshot.paragraphs[0], start: 0, end: 2 });
  assert.equal(range.startOffset, 1); assert.equal(range.endOffset, 3);
  assert.ok(snapshot.counters.clipRangeProbes > 0 && snapshot.counters.clipRangeProbes < 10);
  clipped.style.overflowX = 'auto'; const scrollable = f.snapshot();
  assert.equal(scrollable.paragraphs[0].text, 'ABCD'); assert.equal(scrollable.counters.clipRangeProbes, 0);
});

test('live geometry failure invalidates the old snapshot instead of admitting late results', () => {
  const f = fixture(); const p = f.element('p', {}, [f.text('Existing source.')]); f.append(p);
  const snapshot = f.snapshot(); let invalidations = 0; snapshot.watch(() => invalidations++);
  f.document.createRange = () => { throw new Error('geometry unavailable'); };
  f.records.push({ type: 'attributes', target: p, attributeName: 'style' });
  assert.equal(snapshot.isCurrent(), false); assert.equal(invalidations, 1);
});
