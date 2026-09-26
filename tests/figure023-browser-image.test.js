const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = process.env.SCI_FIGURE_TEST_SOURCE_ROOT || path.join(__dirname, '..');
const content = fs.readFileSync(path.join(root, 'content.js'), 'utf8');

function extract(name) {
  let start = content.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} exists`);
  if (content.slice(start - 6, start) === 'async ') start -= 6;
  const body = content.indexOf(') {', start) + 2;
  let depth = 0;
  for (let i = body; i < content.length; i++) {
    if (content[i] === '{') depth++;
    if (content[i] === '}') depth--;
    if (!depth) return content.slice(start, i + 1);
  }
  throw Error('Unclosed function');
}
const executable = (name, dependencies = {}) => new Function(...Object.keys(dependencies),
  `return (${extract(name)});`)(...Object.values(dependencies));
const admission = (allowTextFallback = false, capabilityMode = 'vision') => ({
  route: { capabilityMode }, allowTextFallback
});

test('FIG023 preflight binds explicit fallback permission to the signature settings snapshot', async () => {
  const router = fs.readFileSync(path.join(root, 'core/background-router.js'), 'utf8');
  const start = router.indexOf("if (message.type === 'LLM_PREFLIGHT_TASK_ROUTE') {");
  const end = router.indexOf("if (message.type === 'CATEGORY_GET')", start);
  const execute = new Function('message', 'shared', 'requireLlmReady', 'FIGURE_ROUTE_PREFLIGHT_TASK_IDS',
    'publicRoute', 'buildTaskPolicySignature', 'storageArea', 'unknownLlmTask',
    `return (async () => { ${router.slice(start, end)} })();`);
  for (const allowed of [false, true, undefined]) {
    const settings = { taskPolicies: { figure_walkthrough: { allowTextFallback: allowed } } };
    let loads = 0;
    const result = await execute({ type: 'LLM_PREFLIGHT_TASK_ROUTE', taskId: 'figure_walkthrough' }, {
      loadSettings: async () => { loads++; return settings; },
      resolveTaskProfile: observed => { assert.equal(observed, settings); return { taskType: 'figure_walkthrough' }; }
    }, () => {}, new Set(['figure_walkthrough']), route => route,
    observed => { assert.equal(observed, settings); return 'same-snapshot'; }, {}, () => Error('unknown'));
    assert.equal(result.allowTextFallback, allowed === true);
    assert.equal(result.taskPolicySignature, 'same-snapshot'); assert.equal(loads, 1);
  }
});

test('FIG023 missing visual input is actionable and only explicit text permission permits fallback', () => {
  const requireInput = executable('requireFigureVisualInput');
  for (const policy of [admission(false), { route: { capabilityMode: 'vision' } }]) {
    assert.throws(() => requireInput([], policy), error => error.code === 'FIGURE_IMAGE_UNAVAILABLE' &&
      error.message.includes('尚未发送模型请求') && error.message.includes('文本回退'));
  }
  assert.deepEqual(requireInput([], admission(true)), []);
  assert.deepEqual(requireInput([], admission(false, 'caption_text_only')), []);
  const pixels = [{}]; assert.equal(requireInput(pixels, admission()), pixels);
});

for (const entry of ['preparePdfFigureProductionInput', 'prepareFigurePanelProductionInput']) {
  test(`FIG023 ${entry} cannot silently accept failed HTML vision acquisition`, async () => {
    const requireFigureVisualInput = executable('requireFigureVisualInput');
    const execute = executable(entry, { activeNativePdfStructure: () => null,
      prepareFigureImages: async () => [], prepareFigurePanelImageVariants: async () => [],
      requireFigureVisualInput });
    const call = policy => entry === 'preparePdfFigureProductionInput'
      ? execute({}, policy) : execute({}, 'B', policy, 'figure_panel_followup');
    await assert.rejects(call(admission()), { code: 'FIGURE_IMAGE_UNAVAILABLE' });
    await assert.doesNotReject(call(admission(true)));
  });
}

function fetchHarness(resource = { bytes: new Uint8Array([0xff, 0xd8, 0xff]), contentType: 'image/jpeg' }) {
  const decoded = { naturalWidth: 2, naturalHeight: 2 }, log = [];
  const TestURL = class extends URL {};
  TestURL.createObjectURL = () => 'blob:diagnostic'; TestURL.revokeObjectURL = () => {};
  const execute = executable('fetchFigureImage', {
    FIGURE_IMAGE_LOAD_TIMEOUT_MS: 8000, FIGURE_IMAGE_SOURCE_MAX_BYTES: 32,
    figureImageError: executable('figureImageError'),
    figureImageTimeoutError: executable('figureImageTimeoutError'),
    readBoundedFigureImageBody: async response => new Uint8Array(await response.arrayBuffer()),
    figureImageBytesMatchMediaType: executable('figureImageBytesMatchMediaType'),
    readFigureImageDimensions: () => ({ width: 2, height: 2 }),
    admitFigureImageDimensions: (width, height) => ({ width, height }),
    releaseFigureImage: () => { log.push('released'); },
    fetch: async () => { log.push('page-fetch-rejected'); throw TypeError('CORS'); },
    fetchExportImageSource: async source => { log.push(source); return typeof resource === 'function' ? resource() : resource; },
    loadFigureImage: async () => { log.push('decoded'); return decoded; },
    document: { baseURI: 'https://paper.test/article', location: { href: 'https://paper.test/article' } },
    URL: TestURL, Blob, Response, AbortController, Uint8Array, setTimeout, clearTimeout, Date
  });
  return { execute, decoded, log };
}
test('FIG023 page CORS failure reuses existing download bytes through original admission and decoding', async () => {
  const h = fetchHarness(); assert.equal(await h.execute('https://cdn.test/figure.jpg', 1000), h.decoded);
  assert.deepEqual(h.log, ['page-fetch-rejected', 'https://cdn.test/figure.jpg', 'decoded']);
});
test('FIG023 downloaded oversized and non-image responses remain rejected before decoding', async () => {
  for (const [resource, code] of [
    [{ bytes: new Uint8Array(33), contentType: 'image/jpeg' }, 'FIGURE_IMAGE_TOO_LARGE'],
    [{ bytes: new Uint8Array([0xff, 0xd8, 0xff]), contentType: 'text/html' }, 'FIGURE_IMAGE_INVALID']
  ]) {
    const h = fetchHarness(resource);
    await assert.rejects(h.execute('https://cdn.test/figure.jpg', 1000), { code });
    assert.ok(!h.log.includes('decoded'));
  }
});
test('FIG023 hung background download cannot extend the acquisition deadline or decode a late result', async () => {
  let resolve; const h = fetchHarness(() => new Promise(done => { resolve = done; }));
  await assert.rejects(h.execute('https://cdn.test/figure.jpg', 25), { code: 'FIGURE_IMAGE_TIMEOUT' });
  resolve({ bytes: new Uint8Array([0xff, 0xd8, 0xff]), contentType: 'image/jpeg' });
  await new Promise(done => setTimeout(done, 10)); assert.ok(!h.log.includes('decoded'));
});
test('FIG023 changed or detached image during download cannot supply stale decoded pixels', async () => {
  for (const mutation of ['source', 'detach']) {
    const image = { src: 'https://cdn.test/a.jpg', currentSrc: 'https://cdn.test/a.jpg',
      isConnected: true, complete: false, getAttribute: () => '' };
    const decoded = {}; let resolve, released = 0;
    const execute = executable('loadPreparedFigureSource', {
      FIGURE_IMAGE_LOAD_TIMEOUT_MS: 8000,
      resolveFigureImageSources: async () => [image.src],
      figureImageTimeoutError: executable('figureImageTimeoutError'),
      fetchFigureImage: () => new Promise(done => { resolve = done; }),
      releaseFigureImage: value => { assert.equal(value, decoded); released++; }
    });
    const pending = execute(image, Date.now() + 1000);
    while (!resolve) await new Promise(done => setImmediate(done));
    if (mutation === 'source') image.src = 'https://cdn.test/b.jpg'; else image.isConnected = false;
    resolve(decoded); await assert.rejects(pending, { code: 'FIGURE_IMAGE_SOURCE_CHANGED' });
    assert.equal(released, 1);
  }
});

test('FIG023 Panel source change cannot recover using previously persisted pixels', async () => {
  let persistedReads = 0;
  const execute = executable('prepareFigurePanelImageVariants', {
    requireFigureTaskAdmission: () => {}, ensureNativePdfFigureImages: async () => {},
    activeNativePdfStructure: () => null,
    admitFigureProviderImages: async () => { persistedReads++; return {
      decodedSources: [{ naturalWidth: 1000, naturalHeight: 600 }] }; },
    validateFigureProviderImageDimensions: image => ({ image }),
    admitFigureImageDimensions: () => {}, figureImageDiagnosticCode: error => error.code,
    FIGURE_IMAGE_PREPARATION_TIMEOUT_MS: 1000, figureImagePixelArea: () => 1,
    findDedicatedPanelImageElement: () => null,
    loadPreparedFigureSource: async () => { throw Object.assign(new Error('Changed'), {
      code: 'FIGURE_IMAGE_SOURCE_CHANGED' }); },
    normalizePanelCropGeometry: () => null,
    encodeFigureImageVariant: (_source, width) => ({ width, height: 600, dataUrl: 'synthetic' }),
    releaseFigureImage: () => {}, console: { warn() {} }
  });
  await assert.rejects(execute({ imageElements: [{}], analysisImages: [{}] }, 'B', admission(true),
    'figure_panel_followup'), { code: 'FIGURE_IMAGE_SOURCE_CHANGED' });
  assert.equal(persistedReads, 0);
});

for (const failureStage of ['resolution', 'download']) {
  test(`FIG023 changed source plus ${failureStage} rejection cannot revive persisted Panel pixels`, async () => {
    const image = { src: 'https://cdn.test/a.jpg', currentSrc: 'https://cdn.test/a.jpg',
      isConnected: true, complete: false, getAttribute: () => '' };
    const failAfterChange = () => {
      image.src = image.currentSrc = 'https://cdn.test/b.jpg';
      throw Object.assign(new Error('HTTP 503 fixture'), { code: 'FIGURE_IMAGE_INVALID' });
    };
    const loadPreparedFigureSource = executable('loadPreparedFigureSource', {
      FIGURE_IMAGE_LOAD_TIMEOUT_MS: 8000,
      figureImageTimeoutError: executable('figureImageTimeoutError'),
      resolveFigureImageSources: async () => failureStage === 'resolution'
        ? failAfterChange() : [image.src],
      fetchFigureImage: async () => failAfterChange(), releaseFigureImage: () => {}
    });
    let persistedReads = 0;
    const execute = executable('prepareFigurePanelImageVariants', {
      requireFigureTaskAdmission: () => {}, ensureNativePdfFigureImages: async () => {},
      activeNativePdfStructure: () => null,
      admitFigureProviderImages: async () => { persistedReads++; return {
        decodedSources: [{ naturalWidth: 1000, naturalHeight: 600 }] }; },
      validateFigureProviderImageDimensions: image => ({ image }),
      admitFigureImageDimensions: () => {}, figureImageDiagnosticCode: error => error.code,
      FIGURE_IMAGE_PREPARATION_TIMEOUT_MS: 1000, figureImagePixelArea: () => 1,
      findDedicatedPanelImageElement: () => null, loadPreparedFigureSource,
      normalizePanelCropGeometry: () => null,
      encodeFigureImageVariant: (_source, width) => ({ width, height: 600, dataUrl: 'synthetic' }),
      releaseFigureImage: () => {}, console: { warn() {} }
    });
    await assert.rejects(execute({ imageElements: [image], analysisImages: [{}] }, 'B', admission(),
      'figure_panel_followup'), { code: 'FIGURE_IMAGE_SOURCE_CHANGED' });
    assert.equal(persistedReads, 0);
  });
  test(`FIG023 ${failureStage} rejection preserves unchanged-source errors and explicit cancellation`, async () => {
    for (const code of ['FIGURE_IMAGE_INVALID', 'CANCELLED']) {
      const image = { src: 'https://cdn.test/a.jpg', currentSrc: 'https://cdn.test/a.jpg',
        isConnected: true, complete: false, getAttribute: () => '' };
      const originalError = Object.assign(new Error('Original fixture error'), { code });
      const fail = () => {
        if (code === 'CANCELLED') image.src = 'https://cdn.test/b.jpg';
        throw originalError;
      };
      const execute = executable('loadPreparedFigureSource', {
        FIGURE_IMAGE_LOAD_TIMEOUT_MS: 8000,
        figureImageTimeoutError: executable('figureImageTimeoutError'),
        resolveFigureImageSources: async () => failureStage === 'resolution' ? fail() : [image.src],
        fetchFigureImage: async () => fail(), releaseFigureImage: () => {}
      });
      await assert.rejects(execute(image, Date.now() + 1000), error => error === originalError);
    }
  });
}
