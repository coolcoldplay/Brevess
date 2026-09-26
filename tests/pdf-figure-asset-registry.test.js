const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { webcrypto } = require('node:crypto');
const vm = require('node:vm');

const {
  createPdfFigureAssetRegistry,
  sha256FigureBytes
} = require('../core/figure-asset-registry.js');
const {
  createPdfFigureVisualEvidenceSet
} = require('../core/pdf-figure-request.js');

const HASH = '1'.repeat(64);
const registrySource = readFileSync(require.resolve('../core/figure-asset-registry.js'), 'utf8');

function registryWithControlledDigest(getCurrentBinding) {
  let pause = null;
  let hashCount = 0;
  const context = vm.createContext({
    ArrayBuffer, Uint8Array, TextEncoder,
    SciLLM: { createPdfFigureVisualEvidenceSet },
    crypto: { subtle: {
      async digest(algorithm, value) {
        hashCount += 1;
        const gate = pause && --pause.remaining === 0 ? pause : null;
        if (gate) pause = null;
        const digest = await webcrypto.subtle.digest(algorithm, value);
        if (gate) {
          gate.enter();
          await gate.released;
        }
        return digest;
      }
    } }
  });
  vm.runInContext(registrySource, context);
  return {
    registry: context.SciLLM.createPdfFigureAssetRegistry({ getCurrentBinding }),
    get hashCount() { return hashCount; },
    pauseHash(remaining = 1) {
      let enter;
      let release;
      const entered = new Promise(resolve => { enter = resolve; });
      const released = new Promise(resolve => { release = resolve; });
      pause = { remaining, enter, released };
      return { entered, release };
    }
  };
}

function bytes(value) {
  return new TextEncoder().encode(value);
}

function binding(overrides = {}) {
  return {
    documentHash: HASH,
    documentGeneration: 4,
    semanticRevision: 7,
    ...overrides
  };
}

function fullAssetInput(value = 'provider-ready-image', overrides = {}) {
  return {
    bytes: bytes(value),
    ...binding(),
    figureId: 'figure-2',
    pageNumbers: [2],
    pageCount: 10,
    sourceType: 'full-figure',
    sourceSlot: 'figure-main',
    mimeType: 'image/png',
    width: 800,
    height: 600,
    ...overrides
  };
}

function cropAssetInput(parent, value = 'crop') {
  return fullAssetInput(value, {
    sourceType: 'panel', sourceSlot: 'panel-a',
    parentAssetId: parent.assetId,
    parentImageContentHash: parent.imageContentHash,
    rect: { x: 0.1, y: 0.2, width: 0.4, height: 0.5 },
    encoderRevision: 1
  });
}

function pageAssetInput(pageNumber, value = `page-${pageNumber}`, pageNumbers = [8, 9]) {
  return fullAssetInput(value, {
    pageNumbers,
    sourceType: 'page-region',
    sourceSlot: `page-${pageNumber}`,
    pageNumber,
    rect: { x: 0, y: 0, width: 1, height: 1 },
    width: 900,
    height: 1200
  });
}

async function registerPageSet(registry, pageNumbers = [8, 9]) {
  const assets = [];
  for (const pageNumber of pageNumbers) {
    assets.push(await registry.register(pageAssetInput(
      pageNumber, `page-${pageNumber}`, pageNumbers
    )));
  }
  const visualEvidenceSet = await createPdfFigureVisualEvidenceSet({
    figureId: 'figure-2',
    binding: binding(),
    requiredArtworkPageNumbers: pageNumbers,
    coverageComplete: true,
    assets
  });
  return { assets, visualEvidenceSet };
}

test('hashes final provider bytes and stably reuses the same slot and revision', async () => {
  let current = binding();
  const registry = createPdfFigureAssetRegistry({ getCurrentBinding: () => current });
  const input = fullAssetInput();
  const expected = await sha256FigureBytes(input.bytes);
  const first = await registry.register({ ...input, expectedImageContentHash: expected });
  const second = await registry.register({ ...input, expectedImageContentHash: expected });

  assert.equal(first.imageContentHash, expected);
  assert.equal(first.assetId, second.assetId);
  assert.equal(first.assetRevision, 1);
  assert.equal(second.assetRevision, 1);
  assert.equal(first.cropRevision, 0);
  assert.equal(Object.isFrozen(first), true);
  assert.deepEqual(Object.keys(first).sort(), [
    'assetId', 'assetRevision', 'cropRevision', 'documentGeneration', 'documentHash',
    'figureId', 'height', 'imageContentHash', 'mimeType', 'pageNumbers',
    'semanticRevision', 'sourceSlot', 'sourceType', 'width'
  ].sort());
  assert.equal(JSON.stringify(first).includes('provider-ready-image'), false);

  const resolved = await registry.resolveForRequest({
    assetIds: [first.assetId],
    expected: first
  });
  assert.equal(Object.isFrozen(resolved), true);
  assert.equal(Object.isFrozen(resolved.descriptor), true);
  assert.equal(Object.isFrozen(resolved.bytes), true);
  assert.equal(new TextDecoder().decode(resolved.bytes), 'provider-ready-image');
  current = binding();
});

test('increments assetRevision when final bytes change in the same slot', async () => {
  const registry = createPdfFigureAssetRegistry({ getCurrentBinding: () => binding() });
  const first = await registry.register(fullAssetInput('first'));
  const second = await registry.register(fullAssetInput('second'));
  assert.equal(first.assetRevision, 1);
  assert.equal(second.assetRevision, 2);
  assert.notEqual(first.assetId, second.assetId);
  assert.notEqual(first.imageContentHash, second.imageContentHash);
});

test('binds crops to their parent, rect, and encoder revision', async () => {
  const registry = createPdfFigureAssetRegistry({ getCurrentBinding: () => binding() });
  const parent = await registry.register(fullAssetInput('parent'));
  const crop = value => ({
    bytes: bytes(value),
    ...binding(),
    figureId: 'figure-2',
    pageNumbers: [2],
    pageCount: 10,
    sourceType: 'panel',
    sourceSlot: 'panel-a',
    mimeType: 'image/webp',
    width: 400,
    height: 300,
    parentAssetId: parent.assetId,
    parentImageContentHash: parent.imageContentHash,
    rect: { x: 0.1, y: 0.2, width: 0.4, height: 0.5 },
    encoderRevision: 1
  });
  const first = await registry.register(crop('crop'));
  const same = await registry.register(crop('crop'));
  const changedRect = await registry.register({
    ...crop('crop'),
    rect: { x: 0.15, y: 0.2, width: 0.4, height: 0.5 }
  });
  const changedEncoder = await registry.register({
    ...crop('crop'),
    rect: changedRect.rect,
    encoderRevision: 2
  });

  assert.equal(first.cropRevision, 1);
  assert.equal(same.cropRevision, 1);
  assert.equal(changedRect.cropRevision, 2);
  assert.equal(changedEncoder.cropRevision, 3);
  assert.equal(changedRect.assetRevision, 1);
  assert.notEqual(first.assetId, changedRect.assetId);
  assert.deepEqual(first.rect, { x: 0.1, y: 0.2, width: 0.4, height: 0.5 });
  assert.equal(first.parentAssetId, parent.assetId);
  assert.equal(first.parentImageContentHash, parent.imageContentHash);
});

test('rejects forged final hashes, IDs, stale generations, and multiple request assets', async () => {
  let current = binding();
  const registry = createPdfFigureAssetRegistry({ getCurrentBinding: () => current });
  await assert.rejects(
    registry.register(fullAssetInput('hash-mismatch', {
      expectedImageContentHash: '2'.repeat(64)
    })),
    error => error?.code === 'PDF_FIGURE_ASSET_HASH_MISMATCH'
  );

  const asset = await registry.register(fullAssetInput());
  await assert.rejects(
    registry.resolveForRequest({ assetIds: ['pdfa-' + '0'.repeat(48)], expected: asset }),
    error => error?.code === 'PDF_FIGURE_ASSET_NOT_FOUND'
  );
  await assert.rejects(
    registry.resolveForRequest({ assetIds: [asset.assetId, asset.assetId], expected: asset }),
    error => error?.code === 'PDF_FIGURE_IMAGE_COUNT_INVALID'
  );

  current = binding({ documentGeneration: 5 });
  await assert.rejects(
    registry.resolveForRequest({ assetIds: [asset.assetId], expected: asset }),
    error => error?.code === 'PDF_FIGURE_ASSET_STALE'
  );

  let bindingReadCount = 0;
  const switchingRegistry = createPdfFigureAssetRegistry({
    getCurrentBinding: () => ++bindingReadCount === 1
      ? binding() : binding({ documentGeneration: 5 })
  });
  await assert.rejects(
    switchingRegistry.register(fullAssetInput('generation-switched-during-hash')),
    error => error?.code === 'PDF_FIGURE_ASSET_STALE'
  );
});

test('rejects invalid page domains, page-region geometry, and crop parent proofs', async () => {
  const registry = createPdfFigureAssetRegistry({ getCurrentBinding: () => binding() });
  await assert.rejects(
    registry.register(fullAssetInput('bad-page', { pageNumbers: [11] })),
    error => error?.code === 'PDF_FIGURE_PAGE_INVALID'
  );
  await assert.rejects(
    registry.register(fullAssetInput('bad-region', {
      sourceType: 'page-region',
      sourceSlot: 'page-2',
      pageNumber: 2,
      rect: { x: 0.9, y: 0.2, width: 0.2, height: 0.5 }
    })),
    error => error?.code === 'PDF_FIGURE_REGION_INVALID'
  );
  await assert.rejects(
    registry.register({
      ...fullAssetInput('orphan-crop'),
      sourceType: 'panel',
      sourceSlot: 'panel-a',
      rect: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 },
      encoderRevision: 1,
      parentAssetId: 'pdfa-' + '0'.repeat(48),
      parentImageContentHash: '3'.repeat(64)
    }),
    error => error?.code === 'PDF_FIGURE_CROP_PARENT_INVALID'
  );
  const parent = await registry.register(fullAssetInput('parent-page-proof'));
  await assert.rejects(
    registry.register({
      ...fullAssetInput('wrong-parent-page', { pageNumbers: [3] }),
      sourceType: 'panel',
      sourceSlot: 'panel-wrong-page',
      rect: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 },
      encoderRevision: 1,
      parentAssetId: parent.assetId,
      parentImageContentHash: parent.imageContentHash
    }),
    error => error?.code === 'PDF_FIGURE_CROP_PARENT_INVALID'
  );
});

test('rejects a forged expected descriptor after successful registration', async () => {
  const registry = createPdfFigureAssetRegistry({ getCurrentBinding: () => binding() });
  const asset = await registry.register(fullAssetInput());
  await assert.rejects(
    registry.resolveForRequest({
      assetIds: [asset.assetId],
      expected: { ...asset, imageContentHash: '4'.repeat(64) }
    }),
    error => error?.code === 'PDF_FIGURE_ASSET_BINDING_CONFLICT'
  );
  await assert.rejects(
    registry.resolveForRequest({
      assetIds: [asset.assetId],
      expected: { ...asset, pageNumbers: [3] }
    }),
    error => error?.code === 'PDF_FIGURE_ASSET_BINDING_CONFLICT'
  );
  const region = await registry.register(fullAssetInput('region', {
    sourceType: 'page-region', sourceSlot: 'region-2', pageNumber: 2,
    rect: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 }
  }));
  await assert.rejects(
    registry.resolveForRequest({
      assetIds: [region.assetId],
      expected: { ...region, rect: { ...region.rect, x: 0.2 } }
    }),
    error => error?.code === 'PDF_FIGURE_ASSET_BINDING_CONFLICT'
  );
});

for (const [change, nextBinding, code] of [
  ['cleared', null, 'PDF_FIGURE_ASSET_BINDING_CONFLICT'],
  ['document replaced', binding({ documentHash: '2'.repeat(64) }), 'PDF_FIGURE_ASSET_STALE'],
  ['generation replaced', binding({ documentGeneration: 5 }), 'PDF_FIGURE_ASSET_STALE'],
  ['semantic revision replaced', binding({ semanticRevision: 8 }), 'PDF_FIGURE_ASSET_STALE']
]) {
  test(`rejects a read when its owner is ${change} during async hashing`, { timeout: 5000 }, async t => {
    let current = binding();
    const { registry, pauseHash } = registryWithControlledDigest(() => current);
    const asset = await registry.register(fullAssetInput());
    const gate = pauseHash();
    t.after(gate.release);
    const pending = registry.resolveForRequest({ assetIds: [asset.assetId], expected: asset });
    await gate.entered;
    current = nextBinding;
    gate.release();
    await assert.rejects(pending, error => error?.code === code);
  });
}

test('rejects a read replaced in the same slot during async hashing', { timeout: 5000 }, async t => {
  const { registry, pauseHash } = registryWithControlledDigest(() => binding());
  const first = await registry.register(fullAssetInput('first'));
  const gate = pauseHash();
  t.after(gate.release);
  const pending = registry.resolveForRequest({ assetIds: [first.assetId], expected: first });
  await gate.entered;
  const second = await registry.register(fullAssetInput('second'));
  gate.release();
  await assert.rejects(pending, error => error?.code === 'PDF_FIGURE_ASSET_STALE');
  const resolved = await registry.resolveForRequest({ assetIds: [second.assetId], expected: second });
  assert.equal(new TextDecoder().decode(resolved.bytes), 'second');
  assert.equal(second.assetRevision, 2);
});

test('allows unchanged asset reuse while its read is hashing', { timeout: 5000 }, async t => {
  const { registry, pauseHash } = registryWithControlledDigest(() => binding());
  const first = await registry.register(fullAssetInput());
  const gate = pauseHash();
  t.after(gate.release);
  const pending = registry.resolveForRequest({ assetIds: [first.assetId], expected: first });
  await gate.entered;
  const reused = await registry.register(fullAssetInput());
  gate.release();
  const resolved = await pending;
  assert.equal(reused.assetId, first.assetId);
  assert.equal(reused.assetRevision, 1);
  assert.equal(resolved.descriptor.assetId, first.assetId);
  assert.equal(new TextDecoder().decode(resolved.bytes), 'provider-ready-image');
});

test('resolves a complete visual evidence set in declared page order without stitching', async () => {
  const registry = createPdfFigureAssetRegistry({ getCurrentBinding: () => binding() });
  const { assets, visualEvidenceSet } = await registerPageSet(registry);

  const resolved = await registry.resolveSetForRequest({ visualEvidenceSet });

  assert.deepEqual(resolved.visualEvidenceSet, visualEvidenceSet);
  assert.deepEqual(resolved.images.map(image => image.descriptor), assets);
  assert.deepEqual(resolved.images.map(image => new TextDecoder().decode(image.bytes)),
    ['page-8', 'page-9']);
  assert.equal(Object.isFrozen(resolved), true);
  assert.equal(Object.isFrozen(resolved.images), true);
  assert.equal(Object.isFrozen(resolved.images[0]), true);
  assert.notEqual(resolved.images[0].bytes, resolved.images[1].bytes,
    'each page remains an independent provider byte payload');
});

test('accepts complete ordered three- and four-page visual evidence sets', async () => {
  for (const pageNumbers of [[3, 4, 5], [3, 4, 5, 6]]) {
    const registry = createPdfFigureAssetRegistry({ getCurrentBinding: () => binding() });
    const { visualEvidenceSet } = await registerPageSet(registry, pageNumbers);
    const resolved = await registry.resolveSetForRequest({ visualEvidenceSet });
    assert.deepEqual(resolved.visualEvidenceSet.requiredArtworkPageNumbers, pageNumbers);
    assert.deepEqual(resolved.images.map(image => image.descriptor.pageNumber), pageNumbers);
  }
});

test('rejects reordered, duplicate, missing, partial, oversized, and digest-tampered sets', async () => {
  const registry = createPdfFigureAssetRegistry({ getCurrentBinding: () => binding() });
  const { visualEvidenceSet } = await registerPageSet(registry);
  const rejected = [
    {
      value: { ...visualEvidenceSet,
        requiredArtworkPageNumbers: [...visualEvidenceSet.requiredArtworkPageNumbers].reverse(),
        assets: [...visualEvidenceSet.assets].reverse() },
      code: 'PDF_FIGURE_VISUAL_SET_DIGEST_MISMATCH'
    },
    {
      value: { ...visualEvidenceSet,
        assets: [visualEvidenceSet.assets[0], visualEvidenceSet.assets[0]] },
      code: 'PDF_FIGURE_ASSET_BINDING_CONFLICT'
    },
    {
      value: { ...visualEvidenceSet,
        assets: [visualEvidenceSet.assets[0]] },
      code: 'PDF_FIGURE_IMAGE_COUNT_INVALID'
    },
    {
      value: { ...visualEvidenceSet,
        requiredArtworkPageNumbers: [8], assets: [visualEvidenceSet.assets[0]] },
      code: 'PDF_FIGURE_ARTWORK_PAGES_INVALID'
    },
    {
      value: { ...visualEvidenceSet, coverageComplete: false },
      code: 'PDF_FIGURE_ARTWORK_COVERAGE_INCOMPLETE'
    },
    {
      value: { ...visualEvidenceSet,
        requiredArtworkPageNumbers: [1, 2, 3, 4, 5],
        assets: [1, 2, 3, 4, 5].map((pageNumber, index) => ({
          ...visualEvidenceSet.assets[0], pageNumber, sourceSlot: `page-${pageNumber}`,
          assetId: `pdfa-${String(index + 2).repeat(48)}`
        })) },
      code: 'PDF_FIGURE_MULTI_ASSET_LIMIT'
    },
    {
      value: { ...visualEvidenceSet, setDigest: 'f'.repeat(64) },
      code: 'PDF_FIGURE_VISUAL_SET_DIGEST_MISMATCH'
    }
  ];
  for (const item of rejected) {
    await assert.rejects(registry.resolveSetForRequest({ visualEvidenceSet: item.value }),
      error => error?.code === item.code);
  }
});

test('rejects a set when its first member is replaced while a later member hashes',
  { timeout: 5000 }, async t => {
    const { registry, pauseHash } = registryWithControlledDigest(() => binding());
    const { visualEvidenceSet } = await registerPageSet(registry);
    const gate = pauseHash(2);
    t.after(gate.release);

    const pending = registry.resolveSetForRequest({ visualEvidenceSet });
    await gate.entered;
    await registry.register(pageAssetInput(8, 'replacement-page-8'));
    gate.release();

    await assert.rejects(pending, error => error?.code === 'PDF_FIGURE_ASSET_STALE');
  });

test('rejects a set when its owner changes while a later member hashes',
  { timeout: 5000 }, async t => {
    let current = binding();
    const { registry, pauseHash } = registryWithControlledDigest(() => current);
    const { visualEvidenceSet } = await registerPageSet(registry);
    const gate = pauseHash(2);
    t.after(gate.release);

    const pending = registry.resolveSetForRequest({ visualEvidenceSet });
    await gate.entered;
    current = binding({ semanticRevision: 8 });
    gate.release();

    await assert.rejects(pending, error => error?.code === 'PDF_FIGURE_ASSET_STALE');
  });

for (const hashNumber of [1, 2]) {
  test(`rejects a crop whose parent is replaced during registration hash ${hashNumber}`,
    { timeout: 5000 }, async t => {
      const { registry, pauseHash } = registryWithControlledDigest(() => binding());
      const parent = await registry.register(fullAssetInput('parent'));
      const cropInput = cropAssetInput(parent);
      const gate = pauseHash(hashNumber);
      t.after(gate.release);
      const pending = registry.register(cropInput);
      await gate.entered;
      const replacement = await registry.register(fullAssetInput('new-parent'));
      gate.release();
      await assert.rejects(pending, error => error?.code === 'PDF_FIGURE_CROP_PARENT_INVALID');

      const currentCrop = await registry.register({
        ...cropInput,
        parentAssetId: replacement.assetId,
        parentImageContentHash: replacement.imageContentHash
      });
      assert.equal(currentCrop.assetRevision, 1);
      assert.equal(currentCrop.cropRevision, 1);
      assert.equal(currentCrop.parentAssetId, replacement.assetId);
      const resolved = await registry.resolveForRequest({
        assetIds: [currentCrop.assetId], expected: currentCrop
      });
      assert.equal(new TextDecoder().decode(resolved.bytes), 'crop');
    });
}

test('rejects a committed crop before hashing when its parent was replaced', async () => {
  const controlled = registryWithControlledDigest(() => binding());
  const { registry } = controlled;
  const parent = await registry.register(fullAssetInput('parent'));
  const crop = await registry.register(cropAssetInput(parent));
  await registry.register(fullAssetInput('replacement-parent'));
  const hashCount = controlled.hashCount;

  await assert.rejects(
    registry.resolveForRequest({ assetIds: [crop.assetId], expected: crop }),
    error => error?.code === 'PDF_FIGURE_CROP_PARENT_INVALID'
  );
  assert.equal(controlled.hashCount, hashCount, 'a stale parent is rejected before reading crop bytes');
});

test('rejects a committed crop whose parent changes during read hashing', { timeout: 5000 }, async t => {
  const { registry, pauseHash } = registryWithControlledDigest(() => binding());
  const parent = await registry.register(fullAssetInput('parent'));
  const crop = await registry.register(cropAssetInput(parent));
  const gate = pauseHash();
  t.after(gate.release);
  const pending = registry.resolveForRequest({ assetIds: [crop.assetId], expected: crop });
  await gate.entered;
  const replacement = await registry.register(fullAssetInput('replacement-parent'));
  gate.release();
  await assert.rejects(pending, error => error?.code === 'PDF_FIGURE_CROP_PARENT_INVALID');

  const currentCrop = await registry.register(cropAssetInput(replacement));
  const resolved = await registry.resolveForRequest({
    assetIds: [currentCrop.assetId], expected: currentCrop
  });
  assert.equal(new TextDecoder().decode(resolved.bytes), 'crop');
  assert.equal(resolved.descriptor.parentAssetId, replacement.assetId);
});

test('allows a committed crop when its unchanged parent is reused during read hashing',
  { timeout: 5000 }, async t => {
    const { registry, pauseHash } = registryWithControlledDigest(() => binding());
    const parent = await registry.register(fullAssetInput('parent'));
    const crop = await registry.register(cropAssetInput(parent));
    const gate = pauseHash();
    t.after(gate.release);
    const pending = registry.resolveForRequest({ assetIds: [crop.assetId], expected: crop });
    await gate.entered;
    const reused = await registry.register(fullAssetInput('parent'));
    gate.release();
    const resolved = await pending;
    assert.equal(reused.assetId, parent.assetId);
    assert.equal(resolved.descriptor.parentAssetId, parent.assetId);
    assert.equal(new TextDecoder().decode(resolved.bytes), 'crop');
  });
