'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { webcrypto, createHash } = require('node:crypto');
const { functionSource } = require('./helpers/r28-full07-source.js');
const { jpegDataUrl } = require('./helpers/r28-c-tile-image-fixtures.js');
const viewer = require('../core/figure-viewer.js');
const root = path.resolve(__dirname, '..');
const content = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const sourceUrl = 'https://media.example.test/article/figure-1.jpg';
const hqUrl = 'https://media.example.test/original/figure-1.jpg';
const pageUrl = 'https://publisher.example.test/articles/cache-regression';
const jpeg = new Uint8Array(Buffer.from(jpegDataUrl(1441, 1600).split(',')[1], 'base64'));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const errorWithCode = code => Object.assign(new Error(code), { code });
const base = vm.createContext({ content, background, sourceUrl, pageUrl, jpeg, digest, errorWithCode,
  functionSource, vm, assert, webcrypto, URL, Uint8Array, Blob, Response, AbortController, TextEncoder, TextDecoder,
  atob, Buffer, setTimeout, clearTimeout, Date });
vm.runInContext(functionSource(fs.readFileSync(path.join(root, 'tests/r33-figure-image-cache.test.cjs'), 'utf8'), 'harness'), base);

async function fixture(options = {}) {
  let documentHash = 'document-hash-1', pageIdentity = 'page-identity-1';
  const domSourceUrl = options.domSourceUrl || sourceUrl;
  const styles = new Map(), attrs = new Map([['src', domSourceUrl]]);
  const image = { src: domSourceUrl, currentSrc: domSourceUrl, complete: true, naturalWidth: 400, naturalHeight: 300,
    isConnected: true, getAttribute: name => attrs.get(name) ?? null, closest: () => null,
    addEventListener() {}, removeEventListener() {}, getBoundingClientRect: () => ({ width: 400, height: 300 }),
    style: { getPropertyValue: name => styles.get(name)?.value || '', getPropertyPriority: name => styles.get(name)?.priority || '',
      setProperty: (name, value, priority = '') => styles.set(name, { value, priority }), removeProperty: name => styles.delete(name) } };
  const figure = { figureId: 'figure-1', imageElements: [image] };
  const resource = { bytes: jpeg, contentType: 'image/jpeg', dataUrl: jpegDataUrl(1441, 1600),
    pixelWidth: 1441, pixelHeight: 1600, cacheStored: true,
    cacheReceipt: { cacheKey: hqUrl, sourceUrl: hqUrl, byteLength: jpeg.length, sha256: digest(jpeg) } };
  const view = { crypto: webcrypto, Blob, Image: class { decode() { return Promise.resolve(); } },
    URL: { createObjectURL: () => 'blob:verified-display', revokeObjectURL() {} }, requestAnimationFrame: fn => fn(),
    getComputedStyle: () => ({ objectFit: 'contain', objectPosition: '50% 50%' }),
    addEventListener() {}, removeEventListener() {}, MutationObserver: class { observe() {} disconnect() {} } };
  const manager = viewer.createFigureOriginalDisplayManager({ windowRef: view, documentRef: { documentElement: {} }, getPageIdentity: () => pageIdentity });
  const metadata = { figureId: figure.figureId, imageIndex: 0, documentHash, pageUrl,
    sourceIdentity: viewer.figureOriginalDisplaySourceIdentity(image), cacheKey: hqUrl,
    sha256: digest(jpeg), byteLength: jpeg.length, pixelWidth: 1441, pixelHeight: 1600, ...options.metadata };
  assert.equal(await manager.apply(image, resource, metadata), true, 'actual display manager verifies and installs the HQ asset');
  const h = base.harness({ page: '403', record: { cacheKey: hqUrl, sourceUrl: hqUrl,
    bytes: jpeg, contentType: 'image/jpeg', byteLength: jpeg.length }, ...options });
  Object.assign(h.context, { getSavedFigureOriginalDisplayAssets: () => manager.entries(),
    figureOriginalDisplayPageIdentity: () => pageIdentity, canonicalArticlePreindexUrl: () => pageUrl,
    getCanonicalArticleSnapshot: () => ({ documentHash }), activeNativePdfStructure: () => null });
  h.context.SciLLM.figureOriginalDisplaySourceIdentity = viewer.figureOriginalDisplaySourceIdentity;
  if (/^function getSavedFigureOriginalAnalysisSource\(/m.test(content)) {
    vm.runInContext(functionSource(content, 'getSavedFigureOriginalAnalysisSource'), h.context);
  }
  return { ...h, image, figure, resource, manager,
    changeDocument: () => { documentHash = 'document-hash-2'; },
    changePage: () => { pageIdentity = 'page-identity-2'; },
    prepare: (binding = {}, deadline = Date.now() + 1000) => h.context.loadPreparedFigureSource(image, deadline, binding, figure) };
}

test('R33 analysis uses the exact image-bound saved HQ URL without changing publisher src/srcset', async () => {
  const h = await fixture(), binding = {};
  assert.equal((await h.prepare(binding)).naturalWidth, 1441);
  assert.equal(binding.sourceUrl, hqUrl);
  assert.equal(h.image.src, sourceUrl);
  assert.equal(h.count('page-network') + h.count('background-network') + h.count('direct-network'), 0);
  assert.equal(h.events.find(event => event.stage === 'cache-read').key, hqUrl);
});

for (const [name, metadata] of [
  ['another figure', { figureId: 'figure-other' }], ['another image index', { imageIndex: 1 }],
  ['another document', { documentHash: 'old-document' }], ['another page URL', { pageUrl: 'https://other.test/article' }],
  ['wrong saved hash', { sha256: '0'.repeat(64) }], ['wrong saved byte count', { byteLength: jpeg.length + 1 }]
]) test(`R33 saved HQ metadata for ${name} cannot enter this image preparation`, async () => {
  const h = await fixture({ metadata, backgroundFailure: true });
  await assert.rejects(h.prepare());
  assert.equal(h.events.some(event => event.stage === 'cache-read' && event.key === hqUrl), false);
  assert.equal(h.count('decode'), 0);
});

test('R33 cache preference off prevents saved HQ reuse and retains the ordinary live source', async () => {
  const h = await fixture({ enabled: false, page: 'jpeg' }), binding = {};
  assert.equal((await h.prepare(binding)).naturalWidth, 1441);
  assert.equal(binding.sourceUrl, sourceUrl);
  assert.equal(h.count('cache-read'), 0);
  assert.equal(h.events.find(event => event.stage === 'page-network').source, sourceUrl);
});

test('R33 evicted HQ bytes do not start an HQ download and retain the ordinary candidate path', async () => {
  const h = await fixture({ record: null, page: 'jpeg' }), binding = {};
  assert.equal((await h.prepare(binding)).naturalWidth, 1441);
  assert.ok(h.events.some(event => event.stage === 'cache-read' && event.key === hqUrl));
  assert.equal(h.events.some(event => event.stage === 'page-network' && event.source === hqUrl), false);
  assert.equal(binding.sourceUrl, sourceUrl);
});

for (const options of [{ record: null }, { enabled: false }]) test(`R33 unavailable saved HQ cannot reenter network through ordinary discovery ${JSON.stringify(options)}`, async () => {
  const h = await fixture({ page: 'jpeg', ...options }), binding = {};
  h.context.resolveFigureImageSources = async () => [hqUrl, `${hqUrl}#viewer`, sourceUrl];
  await h.prepare(binding);
  assert.equal(h.events.some(event => event.stage === 'page-network' && event.source.startsWith(hqUrl)), false);
  assert.equal(binding.sourceUrl, sourceUrl);
});

for (const options of [{ record: null }, { enabled: false }]) test(`R33 an actual displayed URL keeps its ordinary path when it also has a saved receipt ${JSON.stringify(options)}`, async () => {
  const h = await fixture({ page: 'jpeg', domSourceUrl: hqUrl, ...options }), binding = {};
  h.context.resolveFigureImageSources = async () => [hqUrl];
  await h.prepare(binding);
  assert.equal(binding.sourceUrl, hqUrl);
  assert.equal(h.events.some(event => event.stage === 'page-network' && event.source === hqUrl), true);
});

for (const change of ['document', 'page', 'display entry']) test(`R33 failed saved HQ acquisition rechecks ${change} before ordinary IO`, async () => {
  const h = await fixture({ page: 'jpeg' });
  h.context.fetchExportImageSource = async () => {
    if (change === 'document') h.changeDocument();
    else if (change === 'page') h.changePage();
    else h.manager.dispose();
    throw errorWithCode('FIGURE_IMAGE_INVALID');
  };
  await assert.rejects(h.prepare(), { code: 'FIGURE_IMAGE_SOURCE_CHANGED' });
  assert.equal(h.count('page-network') + h.count('background-network') + h.count('direct-network'), 0);
});

test('R33 an already-bound ordinary URL cannot silently switch to the saved HQ URL', async () => {
  const h = await fixture({ backgroundFailure: true });
  await assert.rejects(h.prepare({ sourceUrl }));
  assert.equal(h.events.some(event => event.stage === 'cache-read' && event.key === hqUrl), false);
});

for (const [name, options] of [['evicted', { record: null }], ['disabled', { enabled: false }]]) {
  test(`R33 ${name} saved HQ cannot become a new network download after source binding`, async () => {
    const h = await fixture({ page: 'jpeg', ...options });
    await assert.rejects(h.prepare({ sourceUrl: hqUrl }));
    assert.equal(h.count('page-network') + h.count('background-network') + h.count('direct-network'), 0);
    assert.equal(h.count('decode'), 0);
  });
}

for (const change of ['document', 'display entry']) {
  test(`R33 a bound saved HQ fails before acquisition when its ${change} changes between preparations`, async () => {
    const h = await fixture(), binding = {};
    await h.prepare(binding);
    const cacheReads = h.count('cache-read');
    if (change === 'document') h.changeDocument(); else h.manager.dispose();
    await assert.rejects(h.prepare(binding), { code: 'FIGURE_IMAGE_SOURCE_CHANGED' });
    assert.equal(h.count('cache-read'), cacheReads);
    assert.equal(h.count('page-network') + h.count('background-network') + h.count('direct-network'), 0);
  });
}

test('R33 newer cached bytes cannot impersonate the display manager saved receipt', async () => {
  const bytes = new Uint8Array(jpeg); bytes[bytes.length - 10] ^= 1;
  const h = await fixture({ backgroundFailure: true, record: { cacheKey: hqUrl, sourceUrl: hqUrl, bytes, contentType: 'image/jpeg', byteLength: bytes.length } });
  await assert.rejects(h.prepare());
  assert.ok(h.events.some(event => event.stage === 'cache-read' && event.key === hqUrl));
  assert.equal(h.count('decode'), 0);
});

for (const change of ['document', 'page', 'source', 'detach']) {
  test(`R33 saved HQ cannot survive a ${change} change during cache acquisition`, async () => {
    let h;
    h = await fixture({ beforeCacheReturn: () => {
      if (change === 'document') h.changeDocument();
      if (change === 'page') h.changePage();
      if (change === 'source') h.image.src = h.image.currentSrc = 'https://media.example.test/other.jpg';
      if (change === 'detach') h.image.isConnected = false;
    } });
    await assert.rejects(h.prepare(), { code: 'FIGURE_IMAGE_SOURCE_CHANGED' });
    assert.equal(h.count('release'), 1);
  });
}

test('R33 exact tiles cannot accept a saved-display receipt option', async () => {
  const h = await fixture();
  await assert.rejects(h.context.fetchFigureImage(sourceUrl, 1000, null, { width: 1441, height: 1600 }, h.resource.cacheReceipt),
    { code: 'FIGURE_IMAGE_INVALID' });
  assert.equal(h.count('cache-read'), 0);
});

for (const page of ['403', 'html']) {
  test(`R33 ordinary cold ${page} acquisition can use the bounded image bridge before text fallback`, async () => {
    const h = base.harness({ record: null, page });
    assert.equal((await h.run()).naturalWidth, 1441);
    assert.equal(h.count('page-network'), 1);
    assert.equal(h.count('background-network'), 1);
    assert.equal(h.count('direct-network'), 0);
  });
}

test('R33 exact tile HTTP failure does not gain the ordinary response fallback', async () => {
  const h = base.harness({ record: null, page: '403' });
  const fetch = h.context.fetch;
  h.context.fetch = async (...args) => {
    const response = await fetch(...args);
    Object.defineProperty(response, 'url', { value: sourceUrl });
    return response;
  };
  await assert.rejects(h.run(1000, { width: 1441, height: 1600 }), { code: 'FIGURE_IMAGE_INVALID' });
  assert.equal(h.count('background-network'), 0);
});
