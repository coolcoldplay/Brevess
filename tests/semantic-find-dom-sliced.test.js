const test = require('node:test');
const assert = require('node:assert/strict');
const { createSemanticFindDomSnapshot } = require('../core/semantic-find-dom.js');
const { normalizeTextWithOffsets } = require('../core/article-extractor.js');
const { domFixture } = require('./helpers/semantic-find-dom-fixture.js');

function fixture(customize = () => {}) {
  const f = domFixture(); let now = 0; let timed = false; let serial = 0;
  const timers = new Map(); const computed = f.document.defaultView.getComputedStyle;
  f.document.defaultView.performance = { now: () => now };
  f.document.defaultView.setTimeout = callback => { const id = ++serial; timers.set(id, callback); return id; };
  f.document.defaultView.clearTimeout = id => timers.delete(id);
  f.document.defaultView.getComputedStyle = node => { if (timed) now += 1; return computed(node); };
  const first = f.element('p', {}, [f.text('First source remains stable.')]);
  const hidden = f.element('p', {}, [f.text('Newly visible source.')]); hidden.style.display = 'none';
  f.append(first, hidden);
  for (let index = 0; index < 1000; index++) f.append(f.element('p', {}, [f.text(`Loaded source ${index}.`)]));
  customize(f);
  const snapshot = createSemanticFindDomSnapshot(f.document, { normalizeTextWithOffsets });
  timed = true;
  const hit = { ...snapshot.paragraphs[0], start: 0, end: snapshot.paragraphs[0].text.length };
  let rebounds = 0; let additions = 0; let invalidated = 0;
  snapshot.watch(() => invalidated++, () => rebounds++, () => additions++);
  const tick = () => { const pending = timers.entries().next().value; if (!pending) return false;
    timers.delete(pending[0]); pending[1](); return true; };
  const flush = () => { let count = 0; while (tick()) assert.ok(++count < 10000, 'bounded scan must finish'); return count; };
  return { ...f, first, hidden, snapshot, hit, timers, tick, flush,
    get rebounds() { return rebounds; }, get additions() { return additions; }, get invalidated() { return invalidated; } };
}

test('a global class visibility scan yields instead of blocking isCurrent, then admits newly shown text', () => {
  const f = fixture(); const before = f.snapshot.counters.scannedTextNodes;
  f.hidden.style.display = 'block'; f.records.push({ type: 'attributes', attributeName: 'class', target: f.first });
  assert.equal(f.snapshot.isCurrent(), true);
  assert.ok(f.snapshot.counters.scannedTextNodes - before < 100, 'isCurrent must not extract the entire page synchronously');
  assert.ok(f.timers.size > 0, 'remaining visibility work is scheduled');
  assert.equal(f.snapshot.isHitCurrent(f.hit), true);
  assert.deepEqual(f.snapshot.drainAdditionalParagraphs(), []);
  assert.ok(f.flush() > 1);
  assert.deepEqual(f.snapshot.drainAdditionalParagraphs().map(p => p.text), ['Newly visible source.']);
  assert.equal(f.invalidated, 0); assert.equal(f.additions, 1);
  f.snapshot.disconnect();
});

test('a new mutation cancels the old scan generation and changed text is retired before the scan finishes', () => {
  const f = fixture();
  f.hidden.style.display = 'block'; f.records.push({ type: 'attributes', attributeName: 'class', target: f.first });
  f.snapshot.isCurrent(); assert.ok(f.timers.size > 0);
  f.hidden.childNodes[0].nodeValue = 'Replacement newly visible source.';
  f.first.childNodes[0].nodeValue = 'Changed old source.';
  f.records.push({ type: 'characterData', target: f.hidden.childNodes[0] },
    { type: 'characterData', target: f.first.childNodes[0] });
  assert.equal(f.snapshot.isCurrent(), true); assert.equal(f.snapshot.isHitCurrent(f.hit), false);
  assert.deepEqual(f.snapshot.ranges(f.hit), []);
  f.flush();
  const delta = f.snapshot.drainAdditionalParagraphs();
  assert.ok(delta.some(p => p.text === 'Replacement newly visible source.'));
  assert.ok(!delta.some(p => p.text === 'Newly visible source.'), 'cancelled scan must never commit stale text');
  assert.equal(f.invalidated, 0); f.snapshot.disconnect();
});

test('inserted source structure and removed owners reject old hits while a visibility scan is pending', () => {
  const f = fixture(); const owner = f.element('p', {}, [f.text('The effect '), f.text('increases.')]); f.append(owner);
  f.records.push({ type: 'childList', target: f.document.body, addedNodes: [owner], removedNodes: [] });
  f.snapshot.isCurrent(); f.flush();
  const p = f.snapshot.drainAdditionalParagraphs().find(p => p.text === 'The effect increases.');
  const hit = { ...p, start: 0, end: p.text.length };
  f.records.push({ type: 'attributes', attributeName: 'class', target: f.first }); f.snapshot.isCurrent();
  assert.ok(f.timers.size > 0);
  const inserted = f.text('never '); inserted.parentNode = inserted.parentElement = owner; owner.childNodes.splice(1, 0, inserted);
  f.records.push({ type: 'childList', target: owner, addedNodes: [inserted], removedNodes: [] });
  assert.equal(f.snapshot.isHitCurrent(hit), false); assert.deepEqual(f.snapshot.ranges(hit), []);
  f.first.isConnected = false; f.first.childNodes[0].isConnected = false;
  f.document.body.childNodes = f.document.body.childNodes.filter(node => node !== f.first);
  f.records.push({ type: 'childList', target: f.document.body, addedNodes: [], removedNodes: [f.first] });
  assert.equal(f.snapshot.isHitCurrent(f.hit), false);
  f.flush(); assert.equal(f.invalidated, 0); f.snapshot.disconnect();
});

test('disconnect cancels scheduled visibility work and publishes no new corpus or callbacks', () => {
  const f = fixture(); f.hidden.style.display = 'block';
  f.records.push({ type: 'attributes', attributeName: 'class', target: f.first }); f.snapshot.isCurrent();
  assert.ok(f.timers.size > 0);
  const before = f.snapshot.counters.scannedTextNodes; f.snapshot.disconnect(); f.flush();
  assert.equal(f.snapshot.counters.scannedTextNodes, before); assert.equal(f.additions, 0);
  assert.equal(f.snapshot.isCurrent(), false);
});

test('adding a card to a large container also yields while removed source retires immediately', () => {
  const f = fixture(); const added = f.element('p', {}, [f.text('Appended independent card.')]); f.append(added);
  const before = f.snapshot.counters.scannedTextNodes;
  f.records.push({ type: 'childList', target: f.document.body, addedNodes: [added], removedNodes: [] });
  assert.equal(f.snapshot.isCurrent(), true);
  assert.ok(f.snapshot.counters.scannedTextNodes - before < 100);
  assert.ok(f.timers.size > 0); assert.equal(f.snapshot.isHitCurrent(f.hit), true);
  f.first.isConnected = false; f.first.childNodes[0].isConnected = false;
  f.document.body.childNodes = f.document.body.childNodes.filter(node => node !== f.first);
  f.records.push({ type: 'childList', target: f.document.body, addedNodes: [], removedNodes: [f.first] });
  assert.equal(f.snapshot.isHitCurrent(f.hit), false);
  f.flush(); assert.ok(f.snapshot.drainAdditionalParagraphs().some(p => p.text === 'Appended independent card.'));
  assert.equal(f.invalidated, 0); f.snapshot.disconnect();
});

test('an attribute CSS dependency outside the target subtree still discovers newly visible source once', () => {
  const f = fixture(); const computed = f.document.defaultView.getComputedStyle;
  f.document.defaultView.getComputedStyle = node => ({ ...computed(node),
    ...(node === f.hidden ? { display: f.first.attributes['aria-expanded'] === 'true' ? 'block' : 'none' } : {}) });
  f.first.attributes['aria-expanded'] = 'true';
  f.records.push({ type: 'attributes', target: f.first, attributeName: 'aria-expanded' });
  f.snapshot.isCurrent(); f.flush();
  assert.deepEqual(f.snapshot.drainAdditionalParagraphs().map(p => p.text), ['Newly visible source.']);
  for (const value of ['false', 'true']) {
    f.first.attributes['aria-expanded'] = value;
    f.records.push({ type: 'attributes', target: f.first, attributeName: 'aria-expanded' });
    f.snapshot.isCurrent(); f.flush();
  }
  assert.deepEqual(f.snapshot.drainAdditionalParagraphs(), []); f.snapshot.disconnect();
});

test('source conversion to an editor or plugin rejects the hit before the visibility scan settles', () => {
  for (const attribute of ['contenteditable', 'ui']) {
    const f = fixture(); f.records.push({ type: 'attributes', target: f.first, attributeName: 'class' });
    f.snapshot.isCurrent(); assert.ok(f.snapshot.pendingVisibilityScan);
    f.first.attributes[attribute] = true;
    f.records.push({ type: 'attributes', target: f.first, attributeName: attribute });
    assert.equal(f.snapshot.isHitCurrent(f.hit), false); assert.deepEqual(f.snapshot.ranges(f.hit), []);
    assert.ok(f.rebounds > 0); f.flush(); assert.equal(f.snapshot.isHitCurrent(f.hit), false);
    assert.equal(f.invalidated, 0); f.snapshot.disconnect();
  }
});

test('cancelled discovery consumes no paragraph IDs or admission and a replacement body cancels every late slice', () => {
  const f = fixture(); const initialSize = f.snapshot.bindings.size;
  f.hidden.style.display = 'block';
  f.records.push({ type: 'attributes', target: f.first, attributeName: 'class' }); f.snapshot.isCurrent();
  f.hidden.style.display = 'none';
  f.records.push({ type: 'attributes', target: f.first, attributeName: 'class' }); f.snapshot.isCurrent(); f.flush();
  assert.equal(f.snapshot.bindings.size, initialSize); assert.deepEqual(f.snapshot.drainAdditionalParagraphs(), []);
  f.hidden.style.display = 'block';
  f.records.push({ type: 'attributes', target: f.first, attributeName: 'class' }); f.snapshot.isCurrent(); f.flush();
  const delta = f.snapshot.drainAdditionalParagraphs(); assert.equal(delta.length, 1);
  assert.equal(delta[0].paragraphId, `semantic-dom-${initialSize + 1}`);
  f.records.push({ type: 'attributes', target: f.first, attributeName: 'class' }); f.snapshot.isCurrent();
  f.document.body.isConnected = false; f.document.body = f.element('body');
  assert.equal(f.snapshot.isCurrent(), false); f.flush(); assert.equal(f.invalidated, 1);
  assert.equal(f.snapshot.pendingVisibilityScan, false); assert.equal(f.snapshot.isHitCurrent(f.hit), false);
});

test('slot reassignment retires a composed sentence synchronously rather than waiting for a visibility scan', () => {
  let spanA; let slotA; let slotB; let spanB;
  const f = fixture(dom => {
    spanA = dom.element('span', { slot: 'a' }, [dom.text('First ')]);
    spanB = dom.element('span', { slot: 'b' }, [dom.text('second.')]);
    slotA = dom.element('slot'); slotB = dom.element('slot');
    slotA.style.display = slotB.style.display = 'contents';
    slotA.assignedNodes = () => [spanA]; slotB.assignedNodes = () => [spanB];
    spanA.assignedSlot = slotA; spanB.assignedSlot = slotB;
    const p = dom.element('p', {}, [slotA, slotB]);
    const host = dom.element('div', {}, [spanA, spanB]);
    const shadow = { nodeType: 11, host, childNodes: [p], isConnected: true };
    host.shadowRoot = shadow; p.parentNode = shadow;
    p.getRootNode = slotA.getRootNode = slotB.getRootNode = () => shadow;
    dom.append(host);
  });
  const paragraph = f.snapshot.paragraphs.find(p => p.text === 'First second.'); assert.ok(paragraph);
  const hit = { ...paragraph, start: 0, end: paragraph.text.length };
  slotA.assignedNodes = () => []; slotB.assignedNodes = () => [spanB, spanA];
  spanA.assignedSlot = slotB; spanA.attributes.slot = 'b';
  f.records.push({ type: 'attributes', target: spanA, attributeName: 'slot' });
  assert.equal(f.snapshot.isHitCurrent(hit), false);
  assert.deepEqual(f.snapshot.ranges(hit), []); assert.equal(f.snapshot.isHitCurrent(f.hit), true);
  f.flush(); assert.ok(f.snapshot.drainAdditionalParagraphs().some(p => p.text === 'second.First'));
  f.snapshot.disconnect();
});

test('inline style attributes can reveal source outside their subtree through CSS selectors', () => {
  const f = fixture(); const computed = f.document.defaultView.getComputedStyle;
  f.document.defaultView.getComputedStyle = node => ({ ...computed(node),
    ...(node === f.hidden ? { display: f.first.style.color ? 'block' : 'none' } : {}) });
  f.first.style.color = 'red'; f.records.push({ type: 'attributes', target: f.first, attributeName: 'style' });
  f.snapshot.isCurrent(); f.flush();
  assert.deepEqual(f.snapshot.drainAdditionalParagraphs().map(p => p.text), ['Newly visible source.']);
  assert.equal(f.snapshot.isHitCurrent(f.hit), true); f.snapshot.disconnect();
});

test('slot reassignment immediately retires both the previous owner and the receiving owner', () => {
  let spanA; let spanB; let spanC; let slotA; let slotB; let slotC;
  const f = fixture(dom => {
    spanA = dom.element('span', { slot: 'a' }, [dom.text('never ')]);
    spanB = dom.element('span', { slot: 'b' }, [dom.text('The effect ')]);
    spanC = dom.element('span', { slot: 'c' }, [dom.text('increases.')]);
    [slotA, slotB, slotC] = ['a', 'b', 'c'].map(name => dom.element('slot', { name }));
    for (const slot of [slotA, slotB, slotC]) slot.style.display = 'contents';
    slotA.assignedNodes = () => [spanA]; slotB.assignedNodes = () => [spanB]; slotC.assignedNodes = () => [spanC];
    spanA.assignedSlot = slotA; spanB.assignedSlot = slotB; spanC.assignedSlot = slotC;
    const first = dom.element('p', {}, [slotA]); const second = dom.element('p', {}, [slotB, slotC]);
    const host = dom.element('div', {}, [spanB, spanC, spanA]);
    const shadow = { nodeType: 11, host, childNodes: [first, second], isConnected: true };
    host.shadowRoot = shadow; first.parentNode = second.parentNode = shadow;
    for (const node of [first, second, slotA, slotB, slotC]) node.getRootNode = () => shadow;
    dom.append(host);
  });
  const hits = ['never', 'The effect increases.'].map(text => {
    const paragraph = f.snapshot.paragraphs.find(p => p.text === text); assert.ok(paragraph);
    return { ...paragraph, start: 0, end: paragraph.text.length };
  });
  slotA.assignedNodes = () => []; slotB.assignedNodes = () => [spanB, spanA];
  spanA.assignedSlot = slotB; spanA.attributes.slot = 'b';
  f.records.push({ type: 'attributes', target: spanA, attributeName: 'slot' });
  for (const hit of hits) { assert.equal(f.snapshot.isHitCurrent(hit), false); assert.deepEqual(f.snapshot.ranges(hit), []); }
  assert.equal(f.snapshot.isHitCurrent(f.hit), true);
  f.flush(); assert.ok(f.snapshot.drainAdditionalParagraphs().some(p => p.text === 'The effect never increases.'));
  f.snapshot.disconnect();
});

test('removing source exclusions retires the surrounding owner before the visibility scan settles', () => {
  for (const [attribute, mutationName] of [['contenteditable', 'contenteditable'], ['ui', 'data-sci-plugin-ui'], ['note', 'class']]) {
    let excluded;
    const f = fixture(dom => {
      excluded = dom.element('span', { [attribute]: true }, [dom.text('never ')]);
      dom.append(dom.element('p', {}, [dom.text('The effect '), excluded, dom.text('increases.')]));
    });
    const paragraph = f.snapshot.paragraphs.find(p => p.text === 'The effect increases.'); assert.ok(paragraph);
    const hit = { ...paragraph, start: 0, end: paragraph.text.length };
    delete excluded.attributes[attribute];
    f.records.push({ type: 'attributes', target: excluded, attributeName: mutationName });
    assert.equal(f.snapshot.isHitCurrent(hit), false, `${mutationName} removal rejects the old sentence immediately`);
    assert.deepEqual(f.snapshot.ranges(hit), []); assert.equal(f.snapshot.isHitCurrent(f.hit), true);
    f.flush(); assert.ok(f.snapshot.drainAdditionalParagraphs().some(p => p.text === 'The effect never increases.'));
    f.snapshot.disconnect();
  }
});

test('an independently owned child text replacement preserves unchanged parent text and its structural boundary', () => {
  let section; let nested;
  const f = fixture(dom => {
    nested = dom.element('p', {}, [dom.text('Nested original.')]);
    section = dom.element('section', {}, [dom.text('Stable leading source.'), nested, dom.text('Stable trailing source.')]);
    dom.append(section);
  });
  const hits = ['Stable leading source.', 'Stable trailing source.'].map(text => {
    const paragraph = f.snapshot.paragraphs.find(p => p.text === text); assert.ok(paragraph);
    return { ...paragraph, start: 0, end: paragraph.text.length };
  });
  const removed = nested.childNodes[0]; removed.isConnected = false;
  const replacement = f.text('Nested replacement.'); replacement.parentNode = replacement.parentElement = nested;
  nested.childNodes = [replacement];
  f.records.push({ type: 'childList', target: nested, addedNodes: [replacement], removedNodes: [removed] });
  for (const hit of hits) { assert.equal(f.snapshot.isHitCurrent(hit), true); assert.equal(f.snapshot.ranges(hit).length, 1); }
  f.flush(); assert.ok(f.snapshot.drainAdditionalParagraphs().some(p => p.text === 'Nested replacement.'));
  // Removing the independent boundary changes the parent's composition: it
  // must not silently accept an old range spanning a newly merged source.
  section.childNodes = section.childNodes.filter(node => node !== nested); nested.isConnected = false; replacement.isConnected = false;
  f.records.push({ type: 'childList', target: section, addedNodes: [], removedNodes: [nested] });
  for (const hit of hits) { assert.equal(f.snapshot.isHitCurrent(hit), false); assert.deepEqual(f.snapshot.ranges(hit), []); }
  f.snapshot.disconnect();
});

test('unindexed hidden branch text identity does not invalidate unchanged visible source', () => {
  let hidden; let visible;
  const f = fixture(dom => {
    hidden = dom.element('span', {}, [dom.text('Hidden original.')]); hidden.style.display = 'none';
    visible = dom.element('p', {}, [dom.text('Stable visible sentence.'), hidden]); dom.append(visible);
  });
  const paragraph = f.snapshot.paragraphs.find(p => p.text === 'Stable visible sentence.');
  const hit = { ...paragraph, start: 0, end: paragraph.text.length };
  for (const text of ['Hidden replacement.', '']) {
    const removed = hidden.childNodes; for (const node of removed) node.isConnected = false;
    hidden.childNodes = text ? [f.text(text)] : [];
    for (const node of hidden.childNodes) node.parentNode = node.parentElement = hidden;
    f.records.push({ type: 'childList', target: hidden, addedNodes: hidden.childNodes, removedNodes: removed });
    assert.equal(f.snapshot.isHitCurrent(hit), true); f.flush();
    assert.equal(f.snapshot.isHitCurrent(hit), true); assert.equal(f.snapshot.ranges(hit).length, 1);
    assert.deepEqual(f.snapshot.drainAdditionalParagraphs(), []);
  }
  const empty = f.element('span'); empty.parentNode = empty.parentElement = visible; visible.childNodes.push(empty);
  f.records.push({ type: 'childList', target: visible, addedNodes: [empty], removedNodes: [] });
  assert.equal(f.snapshot.isHitCurrent(hit), true, 'an empty decorative node is not new source');
  f.snapshot.disconnect();
});
