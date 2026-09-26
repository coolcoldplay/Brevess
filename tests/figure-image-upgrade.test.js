const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const FigureViewer = require('../core/figure-viewer.js');
const FigureImageTiles = require('../core/figure-image-tiles.js');
const TabMessenger = require('../core/tab-messenger.js');

const FigureImageRuntime = Object.freeze({
  ...FigureViewer,
  ...FigureImageTiles
});

const CONTENT_SOURCE = fs.readFileSync(
  path.join(__dirname, '..', 'content.js'), 'utf8'
);
const FIGURE_IMAGE_MAX_EDGE = 1600;
const CELL_ARTICLE_URL =
  'https://www.cell.com/cell/fulltext/S0092-8674(26)00001-2';
const CELL_FIGURE_URL =
  'https://www.cell.com/cms/10.1016/j.cell.2026.01.001/asset/' +
  'abcdef12-abcd-abcd-abcd-abcdef123456/main.assets/gr1.jpg';

function contentFunctionSource(name) {
  let start = CONTENT_SOURCE.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} must be defined in content.js`);
  if (CONTENT_SOURCE.slice(Math.max(0, start - 6), start) === 'async ') start -= 6;
  const signatureEnd = CONTENT_SOURCE.indexOf(') {', start);
  assert.ok(signatureEnd >= 0, `${name} must have a standard function signature`);
  const bodyStart = signatureEnd + 2;
  let depth = 0;
  for (let index = bodyStart; index < CONTENT_SOURCE.length; index += 1) {
    if (CONTENT_SOURCE[index] === '{') depth += 1;
    if (CONTENT_SOURCE[index] === '}') depth -= 1;
    if (depth === 0) return CONTENT_SOURCE.slice(start, index + 1);
  }
  assert.fail(`${name} must have a complete function body`);
}

function executableContentFunction(name, dependencies = {}) {
  const names = Object.keys(dependencies);
  return Function(
    ...names,
    `return (${contentFunctionSource(name)});`
  )(...names.map(key => dependencies[key]));
}

function pngImage(width, height, marker = 0) {
  const bytes = Buffer.alloc(25);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(bytes);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12, 'ascii');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  bytes[24] = marker;
  return {
    mediaType: 'image/png',
    dataUrl: `data:image/png;base64,${bytes.toString('base64')}`
  };
}

function jpegDataUrl(width, height) {
  const bytes = Buffer.from([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x0b, 0x08,
    (height >>> 8) & 0xff, height & 0xff,
    (width >>> 8) & 0xff, width & 0xff,
    0x01, 0x01, 0x11, 0x00,
    0xff, 0xd9
  ]);
  return `data:image/jpeg;base64,${bytes.toString('base64')}`;
}

function canvasDocument(draws) {
  return {
    createElement(tagName) {
      assert.equal(tagName, 'canvas');
      const canvas = {
        width: 0,
        height: 0,
        getContext(kind, options) {
          assert.equal(kind, '2d');
          assert.deepEqual(options, { alpha: false });
          return {
            fillRect() {},
            drawImage(...args) { draws.push(args); },
            set fillStyle(_value) {}
          };
        },
        toDataURL(mediaType) {
          assert.equal(mediaType, 'image/jpeg');
          return jpegDataUrl(canvas.width, canvas.height);
        }
      };
      return canvas;
    }
  };
}

function imageElement(source = CELL_FIGURE_URL) {
  return {
    currentSrc: source,
    src: source,
    getAttribute: () => null
  };
}

function figureAdmission(capabilityMode = 'vision') {
  return {
    taskId: 'figure_walkthrough',
    route: { taskType: 'figure_walkthrough', capabilityMode },
    taskPolicySignature: 'figure-image-upgrade-contract'
  };
}

function createImagePolicy() {
  const figureImageError = executableContentFunction('figureImageError');
  const figureImageBytesMatchMediaType = executableContentFunction(
    'figureImageBytesMatchMediaType'
  );
  const admitFigureImageDimensions = executableContentFunction(
    'admitFigureImageDimensions', {
      FIGURE_IMAGE_SOURCE_MAX_EDGE: 8192,
      FIGURE_IMAGE_SOURCE_MAX_PIXELS: 40000000,
      figureImageError
    }
  );
  const readFigureImageDimensions = executableContentFunction(
    'readFigureImageDimensions', {
      figureImageError,
      admitFigureImageDimensions
    }
  );
  const validateFigureProviderImage = executableContentFunction(
    'validateFigureProviderImage', {
      FIGURE_IMAGE_MAX_BYTES: 1572864,
      figureImageError,
      figureImageBytesMatchMediaType,
      atob: value => Buffer.from(value, 'base64').toString('binary')
    }
  );
  const validateFigureProviderImageDimensions = executableContentFunction(
    'validateFigureProviderImageDimensions', {
      validateFigureProviderImage,
      readFigureImageDimensions,
      figureImageError,
      atob: value => Buffer.from(value, 'base64').toString('binary')
    }
  );
  const shouldUpgradePersistedFigureImage = executableContentFunction(
      'shouldUpgradePersistedFigureImage', {
      SciLLM: FigureImageRuntime,
      document: { baseURI: CELL_ARTICLE_URL },
      validateFigureProviderImageDimensions,
      FIGURE_IMAGE_MAX_EDGE
    }
  );
  const preferHigherResolutionFigureImages = executableContentFunction(
    'preferHigherResolutionFigureImages', {
      validateFigureProviderImageDimensions
    }
  );
  return {
    figureImageError,
    validateFigureProviderImageDimensions,
    shouldUpgradePersistedFigureImage,
    preferHigherResolutionFigureImages
  };
}

const policy = createImagePolicy();

function createRealDetailPreparation(sourceImage) {
  const draws = [];
  const calls = { loads: 0, releases: 0 };
  const admitFigureImageDimensions = executableContentFunction(
    'admitFigureImageDimensions', {
      FIGURE_IMAGE_SOURCE_MAX_EDGE: 8192,
      FIGURE_IMAGE_SOURCE_MAX_PIXELS: 40000000,
      figureImageError: policy.figureImageError
    }
  );
  const encodeFigureImageVariant = executableContentFunction(
    'encodeFigureImageVariant', {
      admitFigureImageDimensions,
      normalizePanelCropGeometry: executableContentFunction(
        'normalizePanelCropGeometry'
      ),
      figureDataUrlBytes: executableContentFunction('figureDataUrlBytes'),
      FIGURE_IMAGE_MAX_EDGE,
      FIGURE_IMAGE_MAX_BYTES: 1572864,
      figureImageError: policy.figureImageError,
      document: canvasDocument(draws)
    }
  );
  const prepareFigureImageDetails = executableContentFunction(
    'prepareFigureImageDetails', {
      loadPreparedFigureSource: async () => {
        calls.loads += 1;
        return sourceImage;
      },
      SciLLM: FigureImageRuntime,
      encodeFigureImageVariant,
      FIGURE_IMAGE_MAX_EDGE,
      figureImageTimeoutError: executableContentFunction('figureImageTimeoutError'),
      releaseFigureImage: () => { calls.releases += 1; },
      Date
    }
  );
  return { calls, draws, prepareFigureImageDetails };
}

function detailedFigureAdmission({
  taskId = 'figure_walkthrough', providerId = 'deepseek',
  capabilityMode = 'vision'
} = {}) {
  return {
    taskId,
    route: { taskType: taskId, capabilityMode, providerId },
    taskPolicySignature: `figure-regions-${taskId}-${providerId}`
  };
}

function createDetailedPreparationHarness({ rejectTileIndex = -1 } = {}) {
  const sourceImage = { naturalWidth: 3370, naturalHeight: 3740 };
  const details = createRealDetailPreparation(sourceImage);
  const calls = { admissions: [], normal: 0, warnings: [] };
  const admitFigureProviderImages = async (value, limit) => {
    const input = Array.isArray(value) ? value : [];
    const batch = { input, limit, admitted: [] };
    let rejected = 0;
    input.slice(0, limit).forEach((image, index) => {
      if (input.length === 4 && index === rejectTileIndex) {
        rejected += 1;
        return;
      }
      try {
        batch.admitted.push(policy.validateFigureProviderImageDimensions(image).image);
      } catch (_) {
        rejected += 1;
      }
    });
    calls.admissions.push(batch);
    return {
      images: batch.admitted,
      rejected,
      truncated: input.length > limit
    };
  };
  const prepareFigureImage = async () => {
    calls.normal += 1;
    return pngImage(1200, 800, 40 + calls.normal);
  };
  const prepareFigureImages = executableContentFunction('prepareFigureImages', {
    requireFigureTaskAdmission: executableContentFunction(
      'requireFigureTaskAdmission'
    ),
    ensureNativePdfFigureImages: async () => undefined,
    admitFigureProviderImages,
    SciLLM: FigureImageRuntime,
    shouldUpgradePersistedFigureImage: policy.shouldUpgradePersistedFigureImage,
    prepareFigureImageDetails: details.prepareFigureImageDetails,
    prepareFigureImage,
    preferHigherResolutionFigureImages: policy.preferHigherResolutionFigureImages,
    figureImageError: policy.figureImageError,
    figureImageDiagnosticCode: executableContentFunction('figureImageDiagnosticCode'),
    FIGURE_IMAGE_LIMIT: 4,
    FIGURE_IMAGE_PREPARATION_TIMEOUT_MS: 1000,
    Date,
    console: { warn(...parts) { calls.warnings.push(parts); } }
  });
  return { calls, details, prepareFigureImages, sourceImage };
}

function createPreparationHarness({ preparedImage = null, preparationError = null } = {}) {
  const calls = { ensure: 0, prepare: 0, warnings: [] };
  const ensureNativePdfFigureImages = async () => { calls.ensure += 1; };
  const admitFigureProviderImages = async (value, limit) => {
    const source = Array.isArray(value) ? value : [];
    const images = [];
    let rejected = 0;
    for (const image of source.slice(0, limit)) {
      try {
        images.push(policy.validateFigureProviderImageDimensions(image).image);
      } catch (_) {
        rejected += 1;
      }
    }
    return { images, rejected, truncated: source.length > limit };
  };
  const prepareFigureImage = async () => {
    calls.prepare += 1;
    if (preparationError) throw preparationError;
    return preparedImage;
  };
  const figureImageDiagnosticCode = executableContentFunction(
    'figureImageDiagnosticCode'
  );
  const common = {
    ensureNativePdfFigureImages,
    admitFigureProviderImages,
    shouldUpgradePersistedFigureImage: policy.shouldUpgradePersistedFigureImage,
    preferHigherResolutionFigureImages: policy.preferHigherResolutionFigureImages,
    prepareFigureImage,
    figureImageError: policy.figureImageError,
    figureImageDiagnosticCode,
    FIGURE_IMAGE_PREPARATION_TIMEOUT_MS: 1000,
    Date,
    console: { warn(...parts) { calls.warnings.push(parts); } }
  };
  const prepareFigureImages = executableContentFunction('prepareFigureImages', {
    ...common,
    requireFigureTaskAdmission: executableContentFunction(
      'requireFigureTaskAdmission'
    ),
    FIGURE_IMAGE_LIMIT: 4
  });
  const preparePersistedFigureImages = executableContentFunction(
    'preparePersistedFigureImages', common
  );
  return { calls, prepareFigureImages, preparePersistedFigureImages };
}

async function runBothPreparationEntries(harness, figure) {
  return {
    walkthrough: await harness.prepareFigureImages(
      figure, figureAdmission(), 'figure_walkthrough'
    ),
    persisted: await harness.preparePersistedFigureImages(figure)
  };
}

test('single low-resolution cached Cell Figure upgrades through both preparation entries', async () => {
  const low = pngImage(800, 500, 1);
  const high = pngImage(1600, 1000, 2);
  const figure = { analysisImages: [low], imageElements: [imageElement()] };

  assert.equal(
    FigureViewer.cellPressLargeImageSource(CELL_FIGURE_URL, CELL_ARTICLE_URL),
    'https://ars.els-cdn.com/content/image/1-s2.0-S0092867426000012-gr1_lrg.jpg'
  );
  assert.equal(policy.shouldUpgradePersistedFigureImage(figure, [low]), true);

  const harness = createPreparationHarness({ preparedImage: high });
  const results = await runBothPreparationEntries(harness, figure);
  assert.deepEqual(results.walkthrough, [high]);
  assert.deepEqual(results.persisted, [high]);
  assert.equal(harness.calls.prepare, 2);
});

test('a cached 1600-edge Cell Figure is reused without reading fresh pixels', async () => {
  const cached = pngImage(1600, 900, 3);
  const figure = { analysisImages: [cached], imageElements: [imageElement()] };
  assert.equal(policy.shouldUpgradePersistedFigureImage(figure, [cached]), false);

  const harness = createPreparationHarness({ preparedImage: pngImage(1600, 1000, 4) });
  const results = await runBothPreparationEntries(harness, figure);
  assert.deepEqual(results.walkthrough, [cached]);
  assert.deepEqual(results.persisted, [cached]);
  assert.equal(harness.calls.prepare, 0);
});

test('PDF/offline and multi-image Figures retain their existing cache bindings', async () => {
  const cachedA = pngImage(800, 500, 5);
  const cachedB = pngImage(700, 500, 6);
  const offlineFigure = {
    analysisImages: [cachedA],
    imageElements: [imageElement('blob:https://reader.test/native-pdf-figure')]
  };
  const multiFigure = {
    analysisImages: [cachedA, cachedB],
    imageElements: [imageElement(), imageElement(CELL_FIGURE_URL.replace('gr1', 'gr2'))]
  };
  assert.equal(policy.shouldUpgradePersistedFigureImage(offlineFigure, [cachedA]), false);
  assert.equal(
    policy.shouldUpgradePersistedFigureImage(multiFigure, [cachedA, cachedB]), false
  );

  const harness = createPreparationHarness({ preparedImage: pngImage(1600, 1000, 7) });
  const offline = await runBothPreparationEntries(harness, offlineFigure);
  assert.deepEqual(offline.walkthrough, [cachedA]);
  assert.deepEqual(offline.persisted, [cachedA]);
  assert.deepEqual(await harness.prepareFigureImages(
    multiFigure, figureAdmission(), 'figure_walkthrough'
  ), [cachedA, cachedB]);
  assert.deepEqual(await harness.preparePersistedFigureImages(multiFigure), [cachedA]);
  assert.equal(harness.calls.prepare, 0);
});

test('fresh image preparation failure preserves the admitted old Cell cache', async () => {
  const cached = pngImage(800, 500, 8);
  const figure = { analysisImages: [cached], imageElements: [imageElement()] };
  const failure = Object.assign(new Error('source unavailable'), {
    code: 'FIGURE_IMAGE_INVALID'
  });
  const harness = createPreparationHarness({ preparationError: failure });
  const results = await runBothPreparationEntries(harness, figure);
  assert.deepEqual(results.walkthrough, [cached]);
  assert.deepEqual(results.persisted, [cached]);
  assert.equal(harness.calls.prepare, 2);
  assert.equal(harness.calls.warnings.length, 2);
});

test('a returned lower-resolution Cell candidate never overwrites the old cache', async () => {
  const cached = pngImage(900, 700, 9);
  const lower = pngImage(800, 700, 10);
  const figure = { analysisImages: [cached], imageElements: [imageElement()] };
  assert.equal(policy.shouldUpgradePersistedFigureImage(figure, [cached]), true);
  assert.deepEqual(
    policy.preferHigherResolutionFigureImages([lower], [cached]), [cached]
  );

  const harness = createPreparationHarness({ preparedImage: lower });
  const results = await runBothPreparationEntries(harness, figure);
  assert.deepEqual(results.walkthrough, [cached]);
  assert.deepEqual(results.persisted, [cached]);
  assert.equal(harness.calls.prepare, 2);
});

test('prepareFigureImageDetails uses the production tile plan, crop encoder, and dimensions', async () => {
  const sourceImage = { naturalWidth: 3370, naturalHeight: 3740 };
  const element = imageElement();
  const details = createRealDetailPreparation(sourceImage);
  const expectedTiles = FigureImageTiles.planFigureImageTiles(3370, 3740);
  const encoded = await details.prepareFigureImageDetails(
    element, Date.now() + 1000
  );

  assert.equal(encoded.length, 4);
  assert.equal(details.calls.loads, 1);
  assert.equal(details.calls.releases, 1,
    'the separately decoded source must be released once after all crops');
  assert.equal(details.draws.length, 4);
  encoded.forEach((image, index) => {
    const tile = expectedTiles[index];
    assert.deepEqual(details.draws[index].slice(1, 5), [
      tile.x, tile.y, tile.width, tile.height
    ]);
    const admitted = policy.validateFigureProviderImageDimensions(image);
    assert.deepEqual(admitted.dimensions, {
      width: image.width, height: image.height, orientation: 1
    });
    assert.equal(Math.max(image.width, image.height), FIGURE_IMAGE_MAX_EDGE);
  });
});

test('DeepSeek walkthrough sends all four admitted regions without replacing full-image cache', async () => {
  const cachedFullFigure = pngImage(1442, 1600, 50);
  const figure = {
    analysisImages: [cachedFullFigure],
    imageElements: [imageElement()]
  };
  const before = structuredClone(figure.analysisImages);
  const harness = createDetailedPreparationHarness();
  const regions = await harness.prepareFigureImages(
    figure, detailedFigureAdmission(), 'figure_walkthrough'
  );

  assert.equal(regions.length, 4);
  assert.equal(harness.calls.admissions.length, 2,
    'the complete cache and the generated region set must each cross admission');
  assert.equal(harness.calls.admissions[1].input.length, 4);
  assert.equal(harness.calls.admissions[1].admitted.length, 4);
  assert.equal(harness.calls.normal, 0);
  assert.equal(harness.details.calls.loads, 1);
  assert.deepEqual(figure.analysisImages, before,
    'transient model regions must not mutate the persisted complete Figure');
  assert.ok(regions.every(image => image.dataUrl !== cachedFullFigure.dataUrl));
});

test('one rejected DeepSeek region discards the partial set and falls back to full-image cache', async () => {
  const cachedFullFigure = pngImage(1442, 1600, 51);
  const figure = {
    analysisImages: [cachedFullFigure],
    imageElements: [imageElement()]
  };
  const harness = createDetailedPreparationHarness({ rejectTileIndex: 2 });
  const result = await harness.prepareFigureImages(
    figure, detailedFigureAdmission(), 'figure_walkthrough'
  );

  assert.deepEqual(result, [cachedFullFigure]);
  assert.equal(harness.calls.admissions[1].input.length, 4);
  assert.equal(harness.calls.admissions[1].admitted.length, 3);
  assert.equal(harness.calls.warnings.length, 1);
  assert.equal(harness.calls.normal, 0);
});

test('tiling stays disabled outside one-image DeepSeek walkthroughs', async () => {
  const nonDeepSeek = createDetailedPreparationHarness();
  assert.equal((await nonDeepSeek.prepareFigureImages(
    { analysisImages: [], imageElements: [imageElement()] },
    detailedFigureAdmission({ providerId: 'openai' }), 'figure_walkthrough'
  )).length, 1);
  assert.equal(nonDeepSeek.details.calls.loads, 0);
  assert.equal(nonDeepSeek.calls.normal, 1);

  const panelTask = createDetailedPreparationHarness();
  assert.equal((await panelTask.prepareFigureImages(
    { analysisImages: [], imageElements: [imageElement()] },
    detailedFigureAdmission({ taskId: 'figure_panel_interpretation' }),
    'figure_panel_interpretation'
  )).length, 1);
  assert.equal(panelTask.details.calls.loads, 0);
  assert.equal(panelTask.calls.normal, 1);

  const multiple = createDetailedPreparationHarness();
  assert.equal((await multiple.prepareFigureImages({
    analysisImages: [], imageElements: [imageElement(), imageElement()]
  }, detailedFigureAdmission(), 'figure_walkthrough')).length, 2);
  assert.equal(multiple.details.calls.loads, 0);
  assert.equal(multiple.calls.normal, 2);
});

test('caption_text_only returns before any Figure image property or preparation read', async () => {
  let propertyReads = 0;
  const figure = {};
  for (const property of ['analysisImages', 'imageElements']) {
    Object.defineProperty(figure, property, {
      get() {
        propertyReads += 1;
        throw new Error(`${property} must not be read`);
      }
    });
  }
  const harness = createPreparationHarness({
    preparationError: new Error('pixel preparation must not run')
  });
  assert.deepEqual(await harness.prepareFigureImages(
    figure, detailedFigureAdmission({ capabilityMode: 'caption_text_only' }),
    'figure_walkthrough'
  ), []);
  assert.equal(propertyReads, 0);
  assert.equal(harness.calls.ensure, 0);
  assert.equal(harness.calls.prepare, 0);
});

test('Figure tile runtime loads before content in article and PDF entrypoints', () => {
  const backgroundSource = fs.readFileSync(
    path.join(__dirname, '..', 'background.js'), 'utf8'
  );
  assert.match(backgroundSource, /['"]core\/figure-image-tiles\.js['"]/u);

  const files = TabMessenger.CONTENT_SCRIPT_FILES;
  const tileIndex = files.indexOf('core/figure-image-tiles.js');
  const contentIndex = files.indexOf('content.js');
  assert.ok(tileIndex >= 0 && tileIndex < contentIndex,
    'ordinary article injection must install the tile planner before content.js');

  const pdfReader = fs.readFileSync(
    path.join(__dirname, '..', 'pdf-reader.html'), 'utf8'
  );
  const pdfTileIndex = pdfReader.indexOf('src="core/figure-image-tiles.js"');
  const pdfContentIndex = pdfReader.indexOf('src="content.js"');
  assert.ok(pdfTileIndex >= 0 && pdfTileIndex < pdfContentIndex,
    'PDF reader must install the tile planner before content.js');
});
