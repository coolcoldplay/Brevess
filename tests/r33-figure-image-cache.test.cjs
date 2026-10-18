'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto, createHash } = require('node:crypto');
const { functionSource } = require('./helpers/r28-full07-source.js');
const { jpegDataUrl, pngImage } = require('./helpers/r28-c-tile-image-fixtures.js');

const root = process.env.SCI_FIGURE_TEST_SOURCE_ROOT || path.resolve(__dirname, '..');
const content = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const sourceUrl = 'https://media.example.test/article/figure-1.jpg';
const pageUrl = 'https://publisher.example.test/articles/cache-regression';
const jpeg = new Uint8Array(Buffer.from(jpegDataUrl(1441, 1600).split(',')[1], 'base64'));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const errorWithCode = code => Object.assign(new Error(code), { code });

// The production acquisition, export bridge, background cache protocol, bounded
// body reader and header/dimension admission run together. Only browser/RPC,
// IndexedDB and the final browser decoder are substituted. This does not claim
// a publisher/browser reproduction or a test of browser image decoding.
function harness(options = {}) {
  const events = [];
  const cacheRecord = options.record === undefined ? {
    cacheKey: sourceUrl, sourceUrl, bytes: jpeg, contentType: 'image/jpeg',
    byteLength: jpeg.length
  } : options.record;
  const responseFor = (bytes = jpeg, contentType = 'image/jpeg', url = sourceUrl) => {
    const response = new Response(bytes, { headers: { 'content-type': contentType,
      'content-length': String(bytes.length) } });
    Object.defineProperty(response, 'url', { value: url });
    return response;
  };
  const dataFor = (bytes = jpeg, url = sourceUrl) => ({
    dataUrl: `data:image/jpeg;base64,${Buffer.from(bytes).toString('base64')}`,
    contentType: 'image/jpeg', byteLength: bytes.length, sourceUrl: url
  });
  const backgroundContext = {
    URL, Uint8Array, crypto: webcrypto, atob,
    parseRemoteFigureUrl: value => new URL(value),
    waitForExportImageCache: promise => promise,
    bytesToBase64: bytes => Buffer.from(bytes).toString('base64'),
    exportAbortError: () => errorWithCode('CANCELLED'),
    figureImageCache: {
      get: async key => {
        events.push({ stage: 'cache-read', key });
        if (options.readCache) return options.readCache();
        return cacheRecord;
      },
      put: async () => { events.push({ stage: 'cache-write' }); }
    },
    fetchExportImageResourceUncached: async message => {
      events.push({ stage: 'background-network', message });
      if (options.backgroundFailure) throw errorWithCode('EXPORT_IMAGE_FETCH_FAILED');
      return dataFor(jpeg, options.backgroundSource || sourceUrl);
    }
  };
  vm.createContext(backgroundContext);
  vm.runInContext(functionSource(background, 'fetchExportImageResource'), backgroundContext);
  const urls = new Map();
  const TestURL = class extends URL {};
  TestURL.createObjectURL = blob => {
    const key = `blob:fixture-${urls.size}`;
    urls.set(key, blob);
    return key;
  };
  TestURL.revokeObjectURL = key => { events.push({ stage: 'revoke', key }); urls.delete(key); };
  const context = {
    URL: TestURL, Uint8Array, Blob, Response, AbortController, TextEncoder,
    TextDecoder, atob, crypto: webcrypto, setTimeout, clearTimeout, Date,
    FIGURE_IMAGE_LOAD_TIMEOUT_MS: 1000,
    FIGURE_IMAGE_SOURCE_MAX_BYTES: 20971520,
    FIGURE_IMAGE_SOURCE_MAX_EDGE: 8192,
    FIGURE_IMAGE_SOURCE_MAX_PIXELS: 40000000,
    figureImageCachePreference: null,
    document: { baseURI: pageUrl, location: { href: pageUrl } },
    SciLLM: { isUsefulFigureImage: () => true,
      sha256FigureBytes: async bytes => {
        events.push({ stage: 'hash' });
        if (options.hashBytes) return options.hashBytes(bytes);
        return digest(bytes);
      } },
    chrome: { runtime: { sendMessage: async message => {
      assert.equal(message.type, 'LLM_GET_SETTINGS');
      events.push({ stage: 'settings' });
      if (options.settings) return options.settings();
      return { data: { settings: { autoCacheFigureImages: options.enabled !== false } } };
    } } },
    assertArticleContentExportOperation: () => {},
    articleExportCancelled: error => error?.code === 'CANCELLED',
    effectiveArticlePageUrl: () => pageUrl,
    requestArticleExportResource: async (type, operation, message, signal) => {
      assert.equal(type, 'EXPORT_FETCH_IMAGE_RESOURCE');
      events.push({ stage: 'resource-request', message, signal });
      if (options.resourceFailure) throw errorWithCode(options.resourceFailure);
      const resource = await backgroundContext.fetchExportImageResource(message, { signal });
      if (options.beforeCacheReturn && resource.cacheHit) await options.beforeCacheReturn();
      if (options.tamper && resource.cacheHit) options.tamper(resource);
      return resource;
    },
    fetchExportImageDirect: async () => {
      events.push({ stage: 'direct-network' });
      throw errorWithCode('EXPORT_IMAGE_FETCH_FAILED');
    },
    fetch: async (source, request) => {
      events.push({ stage: 'page-network', source, request });
      const behavior = options.page || 'jpeg';
      if (behavior === '403') return new Response('denied', { status: 403 });
      if (behavior === 'html') return new Response('<html>challenge</html>',
        { headers: { 'content-type': 'text/html' } });
      if (behavior === 'hang') return new Promise(() => {});
      if (behavior === 'cors') throw new TypeError('Synthetic page CORS rejection');
      return responseFor(jpeg, 'image/jpeg', options.pageSource || sourceUrl);
    },
    loadFigureImage: async objectUrl => {
      const blob = urls.get(objectUrl);
      assert.ok(blob, 'decoder receives an admitted blob');
      const bytes = new Uint8Array(await blob.arrayBuffer());
      events.push({ stage: 'decode', digest: digest(bytes), byteLength: bytes.length });
      return { naturalWidth: options.decodedWidth || 1441, naturalHeight: 1600 };
    },
    releaseFigureImage: image => events.push({ stage: 'release', image }),
    resolveFigureImageSources: async () => [sourceUrl],
    isFigureDomImageOriginClean: () => false
  };
  vm.createContext(context);
  const names = ['figureImageError', 'figureImageTimeoutError',
    'figureImageBytesMatchMediaType', 'admitFigureImageDimensions',
    'readFigureImageDimensions', 'matchFigureImageDimensions',
    'readBoundedFigureImageBody', 'figureImageCacheMode', 'decodeExportDataUrl',
    'fetchExportImageSource', 'fetchFigureImage', 'loadPreparedFigureSource'];
  for (const name of names) vm.runInContext(functionSource(content, name), context);
  return { context, events, sourceUrl, count: stage => events.filter(event => event.stage === stage).length,
    run: (timeout = 1000, expectedDimensions = null) =>
      context.fetchFigureImage(sourceUrl, timeout, null, expectedDimensions) };
}

for (const page of ['403', 'html', 'hang']) {
  test(`R33 analysis consumes an exact saved JPEG before a live ${page} response`, async () => {
    const h = harness({ page });
    const decoded = await h.run(page === 'hang' ? 80 : 1000);
    assert.equal(decoded.naturalWidth, 1441);
    assert.equal(h.count('page-network'), 0, 'known saved bytes do not wait for a live request');
    assert.equal(h.count('background-network'), 0);
    assert.equal(h.count('direct-network'), 0);
    const requests = h.events.filter(event => event.stage === 'resource-request');
    assert.equal(requests.length, 1);
    assert.equal(requests[0].message.url, sourceUrl);
    assert.equal(requests[0].message.cacheMode, 'read-only');
    assert.equal(h.events.find(event => event.stage === 'decode').digest, digest(jpeg));
  });
}

test('R33 disabled image cache is not consulted and live acquisition still works', async () => {
  const h = harness({ enabled: false });
  assert.equal((await h.run()).naturalWidth, 1441);
  assert.equal(h.count('cache-read'), 0);
  assert.equal(h.count('resource-request'), 0);
  assert.equal(h.count('page-network'), 1);
});

test('R33 a cache-only miss does not perform its own download before the normal live path', async () => {
  const h = harness({ record: null });
  assert.equal((await h.run()).naturalWidth, 1441);
  assert.equal(h.count('cache-read'), 1);
  assert.equal(h.count('page-network'), 1);
  assert.equal(h.count('background-network'), 0);
  assert.equal(h.count('direct-network'), 0);
});

test('R33 cold cache retains the existing CORS download fallback', async () => {
  const h = harness({ record: null, page: 'cors' });
  assert.equal((await h.run()).naturalWidth, 1441);
  assert.equal(h.count('page-network'), 1);
  assert.equal(h.count('background-network'), 1);
  assert.equal(h.count('decode'), 1);
});

test('R33 CORS fallback shares the acquisition abort signal after the cache-only miss', async () => {
  const h = harness({ record: null, page: 'cors' });
  assert.equal((await h.run()).naturalWidth, 1441);
  const pageSignal = h.events.find(event => event.stage === 'page-network').request.signal;
  const requests = h.events.filter(event => event.stage === 'resource-request');
  assert.equal(requests.length, 2);
  assert.equal(requests[0].signal, pageSignal);
  assert.equal(requests[1].signal, pageSignal);
});

test('R33 disabled cache also stays disabled in the CORS download fallback', async () => {
  const h = harness({ enabled: false, page: 'cors' });
  assert.equal((await h.run()).naturalWidth, 1441);
  assert.equal(h.count('cache-read'), 0);
  assert.equal(h.events.find(event => event.stage === 'resource-request').message.cacheMode, 'none');
  assert.equal(h.count('background-network'), 1);
});

test('R33 a stalled cache lookup cannot extend the deadline or decode a late cache hit', async () => {
  let deliver;
  const h = harness({ page: 'hang', readCache: () => new Promise(resolve => { deliver = resolve; }) });
  const started = Date.now();
  await assert.rejects(h.run(60), { code: 'FIGURE_IMAGE_TIMEOUT' });
  assert.ok(Date.now() - started < 600, 'the acquisition deadline bounds cache access');
  assert.equal(h.count('cache-read'), 1);
  deliver({ cacheKey: sourceUrl, sourceUrl, contentType: 'image/jpeg', bytes: jpeg, byteLength: jpeg.length });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(h.count('decode'), 0);
  assert.equal(h.count('page-network') + h.count('background-network') + h.count('direct-network'), 0);
});

test('R33 ordinary saved images retain their requested-key binding across an original redirect', async () => {
  const h = harness({ page: '403', record: { cacheKey: sourceUrl,
    sourceUrl: 'https://cdn.example.test/original.jpg', contentType: 'image/jpeg',
    bytes: jpeg, byteLength: jpeg.length } });
  assert.equal((await h.run()).naturalWidth, 1441);
  assert.equal(h.count('page-network'), 0);
  assert.equal(h.events.find(event => event.stage === 'resource-request').message.url, sourceUrl);
});

test('R33 cache receipt uses the canonical parsed request URL', async () => {
  const h = harness({ page: '403' });
  assert.equal((await h.context.fetchFigureImage('HTTPS://MEDIA.EXAMPLE.TEST:443/article/figure-1.jpg', 1000)).naturalWidth, 1441);
  assert.equal(h.count('page-network'), 0);
  assert.equal(h.events.find(event => event.stage === 'resource-request').message.url, sourceUrl);
});

test('R33 ordinary content verifies cached bytes even without the optional PDF hash helper', async () => {
  const h = harness({ page: '403' });
  delete h.context.SciLLM.sha256FigureBytes;
  assert.equal((await h.run()).naturalWidth, 1441);
  assert.equal(h.count('page-network'), 0);
  assert.equal(h.events.find(event => event.stage === 'decode').digest, digest(jpeg));
});

for (const [name, tamper] of [
  ['wrong hash', data => { data.cacheReceipt.sha256 = '0'.repeat(64); }],
  ['wrong requested URL', data => { data.cacheReceipt.cacheKey = 'https://other.test/figure.jpg'; }],
  ['wrong byte count', data => { data.cacheReceipt.byteLength += 1; }],
  ['missing receipt', data => { data.cacheReceipt = null; }],
  ['malformed digest', data => { data.cacheReceipt.sha256 = 'abc'; }],
  ['missing saved flag', data => { data.cacheStored = false; }],
  ['missing hit flag', data => { data.cacheHit = false; }],
  ['wrong resolved source', data => { data.cacheReceipt.sourceUrl = 'https://other.test/figure.jpg'; }],
  ['non-HTTP resolved source', data => { data.sourceUrl = data.cacheReceipt.sourceUrl = 'blob:unbound'; }]
]) {
  test(`R33 cached pixels with ${name} are never decoded`, async () => {
    const h = harness({ page: '403', tamper });
    await assert.rejects(h.run());
    assert.equal(h.count('cache-read'), 1, 'exercise cached pixels, not just the live HTTP rejection');
    assert.equal(h.count('decode'), 0);
  });
}

const invalidRecordCases = [
  ['unsupported MIME', { bytes: jpeg, contentType: 'image/avif' }],
  ['wrong magic', { bytes: new Uint8Array([60, 104, 116, 109, 108, 62]), contentType: 'image/jpeg' }],
  ['oversize bytes', { bytes: new Uint8Array(20971521), contentType: 'image/jpeg' }],
  ['oversize header dimensions', (() => {
    const bytes = new Uint8Array(Buffer.from(pngImage(2, 3).dataUrl.split(',')[1], 'base64'));
    new DataView(bytes.buffer).setUint32(16, 8193);
    return { bytes, contentType: 'image/png' };
  })()]
];
for (const [name, fields] of invalidRecordCases) {
  test(`R33 a saved image still obeys analysis admission: ${name}`, async () => {
    const h = harness({ page: '403', record: { cacheKey: sourceUrl, sourceUrl,
      ...fields, byteLength: fields.bytes.length } });
    await assert.rejects(h.run());
    assert.equal(h.count('cache-read'), 1);
    assert.equal(h.count('decode'), 0);
  });
}

test('R33 cached header/decoded-dimension mismatch is rejected and decoded object released', async () => {
  const h = harness({ page: '403', decodedWidth: 1440 });
  await assert.rejects(h.run(), { code: 'FIGURE_IMAGE_INVALID' });
  assert.equal(h.count('decode'), 1);
  assert.equal(h.count('release'), 1);
});

for (const source of ['data:image/jpeg;base64,/9j/', 'blob:ordinary-fixture']) {
  test(`R33 cache preflight does not intercept an ordinary ${source.split(':')[0]} source`, async () => {
    const h = harness();
    assert.equal((await h.context.fetchFigureImage(source, 1000)).naturalWidth, 1441);
    assert.equal(h.count('settings'), 0);
    assert.equal(h.count('cache-read'), 0);
    assert.equal(h.events.find(event => event.stage === 'page-network').source, source);
  });
}

test('R33 a cancelled cache-only request does not start any live fallback', async () => {
  const h = harness({ resourceFailure: 'CANCELLED', page: '403' });
  await assert.rejects(h.run(), { code: 'CANCELLED' });
  assert.equal(h.count('resource-request'), 1);
  assert.equal(h.count('page-network') + h.count('background-network') + h.count('direct-network'), 0);
  assert.equal(h.count('decode'), 0);
});

test('R33 unavailable cache may continue through the ordinary remaining-budget live path', async () => {
  const h = harness({ resourceFailure: 'CACHE_UNAVAILABLE' });
  assert.equal((await h.run()).naturalWidth, 1441);
  assert.equal(h.count('resource-request'), 1);
  assert.equal(h.count('page-network'), 1);
  assert.equal(h.count('background-network') + h.count('direct-network'), 0);
});

test('R33 stalled cache preference lookup is bounded and cannot start late acquisition', async () => {
  let deliver;
  const h = harness({ settings: () => new Promise(resolve => { deliver = resolve; }) });
  await assert.rejects(h.run(60), { code: 'FIGURE_IMAGE_TIMEOUT' });
  assert.equal(h.count('settings'), 1);
  deliver({ data: { settings: { autoCacheFigureImages: true } } });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(h.count('resource-request') + h.count('page-network') + h.count('decode'), 0);
});

test('R33 receipt verification shares the deadline and cannot decode a late digest', async () => {
  let deliver;
  const h = harness({ page: '403', hashBytes: () => new Promise(resolve => { deliver = resolve; }) });
  await assert.rejects(h.run(60), { code: 'FIGURE_IMAGE_TIMEOUT' });
  assert.equal(h.count('hash'), 1);
  deliver(digest(jpeg));
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(h.count('page-network') + h.count('decode'), 0);
});

test('R33 a delayed cache miss leaves only the original remaining network deadline', async () => {
  const h = harness({ page: 'hang', readCache: () => new Promise(resolve => setTimeout(() => resolve(null), 40)) });
  const started = Date.now();
  await assert.rejects(h.run(90), { code: 'FIGURE_IMAGE_TIMEOUT' });
  assert.equal(h.count('cache-read'), 1);
  assert.equal(h.count('page-network'), 1);
  assert.ok(Date.now() - started < 250);
  assert.equal(h.events.find(event => event.stage === 'page-network').request.signal.aborted, true);
  assert.equal(h.count('background-network') + h.count('direct-network') + h.count('decode'), 0);
});

for (const change of ['source', 'detach']) {
  test(`R33 saved pixels cannot survive a ${change} change while acquisition awaits`, async () => {
    const element = { src: sourceUrl, currentSrc: sourceUrl, complete: true,
      naturalWidth: 1441, naturalHeight: 1600, isConnected: true, getAttribute: () => '' };
    const h = harness({ page: '403', beforeCacheReturn: () => {
      if (change === 'source') element.src = element.currentSrc = 'https://media.example.test/other.jpg';
      else element.isConnected = false;
    } });
    const binding = {};
    await assert.rejects(h.context.loadPreparedFigureSource(element, Date.now() + 1000, binding),
      { code: 'FIGURE_IMAGE_SOURCE_CHANGED' });
    assert.equal(h.count('cache-read'), 1);
    assert.equal(h.count('release'), 1);
    assert.equal(binding.sourceUrl, undefined);
  });
}

test('R33 an exact tile keeps cache bypass, exact request URL and dimensions', async () => {
  const h = harness();
  assert.equal((await h.run(1000, { width: 1441, height: 1600 })).naturalWidth, 1441);
  assert.equal(h.count('cache-read'), 0);
  assert.equal(h.count('resource-request'), 0);
  assert.equal(h.events.find(event => event.stage === 'page-network').request.redirect, 'error');
});

test('R33 tile CORS fallback preserves cache-none and requireExactSource', async () => {
  const h = harness({ page: 'cors' });
  assert.equal((await h.run(1000, { width: 1441, height: 1600 })).naturalWidth, 1441);
  assert.equal(h.count('cache-read'), 0);
  const request = h.events.find(event => event.stage === 'resource-request').message;
  assert.equal(request.cacheMode, 'none');
  assert.equal(request.requireExactSource, true);
});

test('R33 tile fallback rejects a changed resolved URL', async () => {
  const h = harness({ page: 'cors', backgroundSource: 'https://media.example.test/different-tile.jpg' });
  await assert.rejects(h.run(1000, { width: 1441, height: 1600 }), { code: 'FIGURE_IMAGE_INVALID' });
  assert.equal(h.count('cache-read'), 0);
  assert.equal(h.count('decode'), 0);
});

test('R33 tile dimensions remain exact after acquisition', async () => {
  const h = harness();
  await assert.rejects(h.run(1000, { width: 1440, height: 1600 }), { code: 'FIGURE_IMAGE_INVALID' });
  assert.equal(h.count('decode'), 0);
});

test('R33 read-only export bridge miss never falls back to direct or background download', async () => {
  const h = harness({ record: null });
  await assert.rejects(h.context.fetchExportImageSource(sourceUrl, { cacheMode: 'read-only' }),
    { code: 'FIGURE_IMAGE_CACHE_MISS' });
  assert.equal(h.count('cache-read'), 1);
  assert.equal(h.count('page-network'), 0);
  assert.equal(h.count('background-network'), 0);
  assert.equal(h.count('direct-network'), 0);
});

test('R33 existing export cache hit has a byte-bound receipt usable by analysis', async () => {
  const h = harness();
  const resource = await h.context.fetchExportImageSource(sourceUrl, { cacheMode: 'read-only' });
  assert.equal(resource.cacheHit, true);
  assert.equal(resource.cacheReceipt.cacheKey, sourceUrl);
  assert.equal(resource.cacheReceipt.byteLength, jpeg.length);
  assert.equal(resource.cacheReceipt.sha256, digest(resource.bytes));
  assert.equal(h.count('page-network') + h.count('background-network') + h.count('direct-network'), 0);
});
