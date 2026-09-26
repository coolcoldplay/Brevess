const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const filename = process.env.SCI_SELECTION_CONTENT_SOURCE || path.join(root, 'content.js');
const content = fs.readFileSync(filename, 'utf8');
const start = content.includes('function sameManualSelectionAnchor(')
  ? content.indexOf('function sameManualSelectionAnchor(') : content.indexOf('function inspectManualSelection(');
const end = content.indexOf('function scheduleManualSelectionInspection(', start);
assert.ok(start >= 0 && end > start);
const source = content.slice(start, end);
const descriptor = () => ({ documentId: 'doc-a', blockId: 'block-a', text: 'Exact source.',
  pdfDocumentGeneration: 0, pdfSelectionGeneration: 0, validation: { valid: true },
  anchor: { quote: 'Exact source.', startOffset: 4, endOffset: 17 },
  anchorSegments: [{ blockId: 'block-a', anchor: { quote: 'Exact source.', startOffset: 4, endOffset: 17 } }],
  rect: { top: 5, left: 5, bottom: 20, right: 100 } });
function fixture() {
  const previous = { ...descriptor(), semanticFindSourceKey: 'source:hit:1' };
  const next = descriptor();
  const calls = { show: 0, close: 0, release: 0, check: 0 };
  const context = {
    currentManualBlocks: [{}], currentManualCategories: [{}], currentManualSelection: previous,
    describeCurrentManualSelection: () => next,
    showManualSelectionToolbar(value) { calls.show++; context.currentManualSelection = value; },
    closeManualSelectionToolbar() { calls.close++; context.currentManualSelection = null; },
    releaseSelectionAfterManualAction() { calls.release++; context.currentManualSelection = null; },
    showManualStatus() {},
    __brevessSemanticFind: { isCurrentSource(key) { calls.check++; assert.equal(key, previous.semanticFindSourceKey); return true; } }
  };
  vm.runInNewContext(source, context);
  return { context, previous, next, calls, inspect: () => context.inspectManualSelection() };
}
test('delayed inspection of the identical source retains the semantic owner and existing toolbar', () => {
  const f = fixture(); f.inspect();
  assert.equal(f.context.currentManualSelection, f.previous);
  assert.equal(f.calls.show, 0); assert.equal(f.calls.check, 1);
});
test('retired semantic confirmation closes instead of becoming an ordinary unguarded selection', () => {
  const f = fixture(); f.context.__brevessSemanticFind.isCurrentSource = () => false; f.inspect();
  assert.equal(f.calls.release, 1); assert.equal(f.calls.show, 0); assert.equal(f.context.currentManualSelection, null);
});
test('missing or throwing source validation fails closed', () => {
  for (const validator of [null, { isCurrentSource() { throw Error('stale'); } }]) {
    const f = fixture(); f.context.__brevessSemanticFind = validator;
    assert.doesNotThrow(f.inspect); assert.equal(f.calls.release, 1); assert.equal(f.calls.show, 0);
  }
});
test('a source callback cannot release a newer unrelated owner', () => {
  const f = fixture(), other = descriptor();
  f.context.__brevessSemanticFind.isCurrentSource = () => { f.context.currentManualSelection = other; return false; };
  f.inspect(); assert.equal(f.calls.release, 0); assert.equal(f.calls.show, 0); assert.equal(f.context.currentManualSelection, other);
});
test('geometry-only change retains the exact semantic source', () => {
  const f = fixture(); f.next.rect.top = 90; f.inspect();
  assert.equal(f.context.currentManualSelection, f.previous); assert.equal(f.calls.show, 0);
});
for (const [name, mutate] of [
  ['document', d => { d.documentId = 'doc-b'; }],
  ['block', d => { d.blockId = 'block-b'; }],
  ['quote', d => { d.anchor.quote = 'Other source.'; }],
  ['offset', d => { d.anchor.startOffset++; }],
  ['segment block', d => { d.anchorSegments[0].blockId = 'block-b'; }],
  ['segment offset', d => { d.anchorSegments[0].anchor.endOffset++; }],
  ['segment quote', d => { d.anchorSegments[0].anchor.quote = 'Other source.'; }],
  ['additional segment', d => { d.anchorSegments.push(structuredClone(d.anchorSegments[0])); }],
  ['PDF generation', d => { d.pdfDocumentGeneration = 3; }],
  ['PDF selection', d => { d.pdfSelectionGeneration = 3; }],
  ['PDF anchor', d => { d.anchorSegments[0].anchor.pdfAnchor = { pageNumber: 2 }; }]
]) test('a new selection with different ' + name + ' does not inherit the old owner', () => {
  const f = fixture(); mutate(f.next); f.inspect();
  assert.equal(f.context.currentManualSelection, f.next);
  assert.equal(f.context.currentManualSelection.semanticFindSourceKey, undefined); assert.equal(f.calls.show, 1);
});
test('ordinary manual selection keeps its existing inspection behavior', () => {
  const f = fixture(); delete f.previous.semanticFindSourceKey; f.inspect();
  assert.equal(f.context.currentManualSelection, f.next); assert.equal(f.calls.show, 1); assert.equal(f.calls.check, 0);
});
test('empty and invalid selections still close rather than reopen', () => {
  for (const next of [null, { validation: { valid: false, code: 'CROSS_BLOCK', message: 'invalid' } }]) {
    const f = fixture(); f.context.describeCurrentManualSelection = () => next; f.inspect();
    assert.equal(f.calls.close, 1); assert.equal(f.calls.show, 0);
  }
});
