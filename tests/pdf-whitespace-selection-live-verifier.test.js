const test = require('node:test');
const assert = require('node:assert/strict');
const helpers = import('../scripts/verify-pdf-whitespace-selection-live.mjs');
const baselineHelpers = import('../scripts/verify-pdf-chat-note-migration-live.mjs');

test('whitespace visual gate rejects lost text or moved physical endpoints', async () => {
  const { assertSelectionIdentity } = await helpers;
  const baseline = (await baselineHelpers).RECORDED_SELECTION_BASELINES[1];
  const actual = { ...baseline, rangeCount: 1,
    endpoints: baseline.endpoints.map(({ pageNumber, index, offset }) => ({ pageNumber, index, offset })) };
  assert.doesNotThrow(() => assertSelectionIdentity(actual, baseline));
  for (const key of ['rawCharacters', 'normalizedCharacters', 'rawSha256', 'normalizedSha256']) {
    assert.throws(() => assertSelectionIdentity({ ...actual, [key]: null }, baseline), /WHITESPACE_SELECTION_/);
  }
  assert.throws(() => assertSelectionIdentity({ ...actual, endpoints: [] }, baseline), /ENDPOINTS_CHANGED/);
});

test('whitespace pixels must disappear while body color, transparent BR and unmarked parents remain', async () => {
  const { assertWhitespaceVisualPair, REQUIRED_WHITESPACE_INDICES } = await helpers;
  const before = { regions: REQUIRED_WHITESPACE_INDICES.map(index => ({ kind: 'whitespace', index,
    pixelCount: 40, bluePixels: 30 })).concat({ kind: 'body', index: 5, bluePixels: 80 }) };
  const after = { styles: { wronglyMarkedParents: 0, wronglyMarkedText: 0, parentCount: 4, brCount: 10, opaqueBrCount: 0 },
    regions: REQUIRED_WHITESPACE_INDICES.map(index => ({ kind: 'whitespace', index, pixelCount: 40,
      bluePixels: 0, marked: true, pureWhitespaceLeaf: true, transparent: true, intersectsSelection: true }))
      .concat({ kind: 'body', index: 5, bluePixels: 80, marked: false, transparent: false }) };
  assert.deepEqual(assertWhitespaceVisualPair(before, after), { visual: 'PASS', parentContainers: 'PASS', parentCount: 4 });
  assert.deepEqual(assertWhitespaceVisualPair(before, { ...after, styles: { ...after.styles, parentCount: 0 } }),
    { visual: 'PASS', parentContainers: 'N/A', parentCount: 0 }, 'absent parent samples must not claim live parent coverage');
  assert.throws(() => assertWhitespaceVisualPair(before, { ...after, styles: { ...after.styles, parentCount: undefined } }),
    /PARENT_COUNT_MISSING/);
  const changed = structuredClone(after); changed.regions[0].bluePixels = 1;
  assert.throws(() => assertWhitespaceVisualPair(before, changed), /BACKGROUND_STILL_VISIBLE/);
  for (const key of ['wronglyMarkedParents', 'wronglyMarkedText', 'opaqueBrCount']) {
    assert.throws(() => assertWhitespaceVisualPair(before, { ...after, styles: { ...after.styles, [key]: 1 } }), /WHITESPACE_/);
  }
  const lostBody = structuredClone(after); lostBody.regions.at(-1).bluePixels = 0;
  assert.throws(() => assertWhitespaceVisualPair(before, lostBody), /BODY_SELECTION_LOST/);
});

test('pixel rectangles must move with actual scroll instead of reusing screenshot coordinates', async () => {
  const { assertScrollProjection, REQUIRED_WHITESPACE_INDICES } = await helpers;
  const first = { scrollTop: 100, regions: REQUIRED_WHITESPACE_INDICES.map(index =>
    ({ kind: 'whitespace', index, rect: { left: 300, top: 400 + index } })) };
  const second = { scrollTop: 140, regions: first.regions.map(row => ({ ...row,
    rect: { ...row.rect, top: row.rect.top - 40 } })) };
  assert.equal(assertScrollProjection(first, second), true);
  assert.throws(() => assertScrollProjection(first, { ...second, regions: first.regions }), /PROJECTION_MISMATCH/);
});
