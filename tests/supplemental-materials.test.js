const test = require('node:test');
const assert = require('node:assert/strict');
require('../core/pdf-workspace.js');
require('../core/figure-extractor.js');
const {
  SUPPLEMENTAL_FIGURE_SOURCE_MODES,
  SUPPLEMENTAL_TRANSIENT_IMAGE_MAX_BYTES,
  SUPPLEMENTAL_TRANSIENT_IMAGE_MAX_EDGE,
  discoverSupplementalMaterials,
  extractSupplementalReferences,
  mergeSupplementalFigureAssets,
  buildSupplementalCoverage,
  supplementalFigureAssetPath,
  createSupplementalPdfReaderUrl,
  readSupplementalPdfBinding,
  normalizeSupplementalFigureSource,
  normalizeSupplementalTransientImage,
  allocateSupplementalMaterialId,
  createManualSupplementalDraft,
  createSupplementalFigureImportDraft
} = require('../core/supplemental-materials.js');

const fingerprint = character => `sha256:${character.repeat(64)}`;
const importedAt = '2026-08-03T00:00:00.000Z';

test('normalizes exactly pdf image and caption supplemental Figure sources', () => {
  assert.deepEqual([...SUPPLEMENTAL_FIGURE_SOURCE_MODES], ['pdf', 'image', 'caption']);
  const shared = {
    sourceMaterialId: 'manual-s1',
    sourceImportedAt: importedAt,
    sourceFingerprint: fingerprint('a')
  };
  const image = normalizeSupplementalFigureSource({
    ...shared,
    sourceMode: 'image',
    sourceFileName: 'figure-s1.JPEG',
    sourceMimeType: 'image/jpeg',
    sourceFileSize: 1024,
    imageWidth: 2048,
    imageHeight: 1024
  });
  assert.equal(image.sourceMode, 'image');
  assert.equal(image.sourceFileSize, 1024);
  assert.equal(image.caption, '');
  assert.deepEqual(normalizeSupplementalFigureSource(image), image);
  const pdf = normalizeSupplementalFigureSource({
    ...shared,
    sourceMode: 'pdf',
    sourceFileName: 'supplement.PDF',
    sourceMimeType: 'application/pdf',
    sourceFileSize: 2048
  });
  assert.equal(pdf.sourceMode, 'pdf');
  const caption = normalizeSupplementalFigureSource({
    ...shared,
    sourceMode: 'caption',
    caption: '  Figure S1. Replication.  '
  });
  assert.equal(caption.caption, 'Figure S1. Replication.');
  assert.throws(
    () => normalizeSupplementalFigureSource({ ...shared, sourceMode: 'video' }),
    /SUPPLEMENTAL_SOURCE_MODE/
  );
  assert.throws(
    () => normalizeSupplementalFigureSource({ ...shared, sourceMode: 'caption', caption: '   ' }),
    /SUPPLEMENTAL_CAPTION_EMPTY/
  );
  assert.throws(
    () => normalizeSupplementalFigureSource({
      ...shared,
      sourceMode: 'caption',
      caption: 'x'.repeat(8001)
    }),
    /SUPPLEMENTAL_CAPTION_TOO_LONG/
  );
});

test('rejects invalid PDF and image file metadata at their hard limits', () => {
  const shared = {
    sourceMaterialId: 'manual-s2',
    sourceImportedAt: importedAt,
    sourceFingerprint: fingerprint('b')
  };
  const image = overrides => normalizeSupplementalFigureSource({
    ...shared,
    sourceMode: 'image',
    sourceFileName: 'figure.png',
    sourceMimeType: 'image/png',
    sourceFileSize: 20 * 1024 * 1024,
    imageWidth: 1,
    imageHeight: 1,
    ...overrides
  });
  assert.equal(image().sourceFileSize, 20 * 1024 * 1024);
  for (const overrides of [
    { sourceFileName: 'figure.jpg' },
    { sourceMimeType: 'image/gif' },
    { sourceFileSize: 0 },
    { sourceFileSize: 20 * 1024 * 1024 + 1 }
  ]) assert.throws(() => image(overrides), /SUPPLEMENTAL_IMAGE_INVALID/);

  const pdf = overrides => normalizeSupplementalFigureSource({
    ...shared,
    sourceMode: 'pdf',
    sourceFileName: 'supplement.pdf',
    sourceMimeType: 'application/pdf',
    sourceFileSize: 200 * 1024 * 1024,
    ...overrides
  });
  assert.equal(pdf().sourceFileSize, 200 * 1024 * 1024);
  for (const overrides of [
    { sourceFileName: 'supplement.pdf.exe' },
    { sourceMimeType: 'application/octet-stream' },
    { sourceFileSize: 0 },
    { sourceFileSize: 200 * 1024 * 1024 + 1 }
  ]) assert.throws(() => pdf(overrides), /SUPPLEMENTAL_PDF_INVALID/);
});

test('requires a sha256 fingerprint and bounds the transient image payload shape', () => {
  assert.equal(SUPPLEMENTAL_TRANSIENT_IMAGE_MAX_BYTES, 1572864);
  assert.equal(SUPPLEMENTAL_TRANSIENT_IMAGE_MAX_EDGE, 1600);
  const base = {
    sourceMode: 'caption',
    sourceMaterialId: 'caption-s1',
    sourceImportedAt: importedAt,
    caption: 'Figure S1. Replication.'
  };
  for (const sourceFingerprint of ['', 'sha256:abc', `md5:${'a'.repeat(64)}`]) {
    assert.throws(
      () => normalizeSupplementalFigureSource({ ...base, sourceFingerprint }),
      /SUPPLEMENTAL_SOURCE_FINGERPRINT/
    );
  }
  const transient = normalizeSupplementalTransientImage({
    mediaType: 'image/webp',
    dataUrl: 'data:image/webp;base64,AAAA',
    width: 1600,
    height: 900,
    sourceFingerprint: fingerprint('c'),
    ignored: 'must-not-pass-through'
  });
  assert.deepEqual(Object.keys(transient).sort(), [
    'dataUrl', 'height', 'mediaType', 'sourceFingerprint', 'width'
  ]);
  assert.throws(
    () => normalizeSupplementalTransientImage({ ...transient, mediaType: 'image/png' }),
    /SUPPLEMENTAL_TRANSIENT_IMAGE/
  );
  assert.throws(
    () => normalizeSupplementalTransientImage({ ...transient, width: 0 }),
    /SUPPLEMENTAL_TRANSIENT_IMAGE/
  );
  assert.throws(
    () => normalizeSupplementalTransientImage(transient, fingerprint('d')),
    /SUPPLEMENTAL_TRANSIENT_FINGERPRINT/
  );
});

test('requires finite safe positive transient dimensions within the shared max edge', () => {
  const transient = {
    mediaType: 'image/png',
    dataUrl: 'data:image/png;base64,AAAA',
    width: 1600,
    height: 1,
    sourceFingerprint: fingerprint('8')
  };
  assert.equal(normalizeSupplementalTransientImage(transient).width, 1600);
  for (const [field, value] of [
    ['width', 1601],
    ['height', 1601],
    ['width', Infinity],
    ['height', NaN],
    ['width', 1.5],
    ['height', -1]
  ]) {
    assert.throws(
      () => normalizeSupplementalTransientImage({ ...transient, [field]: value }),
      error => error?.code === 'SUPPLEMENTAL_TRANSIENT_IMAGE' &&
        error.message === 'SUPPLEMENTAL_TRANSIENT_IMAGE'
    );
  }
});

test('strictly decodes transient base64 and enforces the encoded image byte ceiling', () => {
  const exactBytes = 1572864;
  const exactBase64 = 'AAAA'.repeat(exactBytes / 3);
  const base = {
    mediaType: 'image/png',
    width: 1600,
    height: 900,
    sourceFingerprint: fingerprint('e')
  };
  assert.equal(
    normalizeSupplementalTransientImage({
      ...base,
      dataUrl: `data:image/png;base64,${exactBase64}`
    }).dataUrl.length,
    'data:image/png;base64,'.length + exactBase64.length
  );
  assert.throws(
    () => normalizeSupplementalTransientImage({
      ...base,
      dataUrl: `data:image/png;base64,${exactBase64}AA==`
    }),
    /SUPPLEMENTAL_TRANSIENT_IMAGE_TOO_LARGE/
  );
  for (const malformed of [
    'A===', 'AAAA===', 'AA=A', 'AAAA*', 'AAA',
    'AB==', // valid alphabet and padding shape, but non-canonical pad bits
    'AAB='
  ]) {
    assert.throws(
      () => normalizeSupplementalTransientImage({
        ...base,
        dataUrl: `data:image/png;base64,${malformed}`
      }),
      /SUPPLEMENTAL_TRANSIENT_IMAGE/
    );
  }
  const tooLongAndMalformed = `${'A'.repeat(2097153)}*`;
  assert.throws(
    () => normalizeSupplementalTransientImage({
      ...base,
      dataUrl: `data:image/png;base64,${tooLongAndMalformed}`
    }),
    error => error?.code === 'SUPPLEMENTAL_TRANSIENT_IMAGE_TOO_LARGE'
  );
});

test('creates a bounded persisted source draft without copying transient image data', () => {
  const transientImage = {
    mediaType: 'image/png',
    dataUrl: 'data:image/png;base64,AAAA',
    width: 1,
    height: 1,
    sourceFingerprint: fingerprint('d')
  };
  const asset = createSupplementalFigureImportDraft({
    sourceMode: 'caption',
    sourceMaterialId: 'caption-s1',
    caption: 'Figure S1. (A) Replication. (B) Rescue.',
    sourceImportedAt: importedAt,
    sourceFingerprint: fingerprint('d'),
    transientImage
  });
  assert.equal(asset.figures[0].analysisStatus, 'draft');
  assert.equal(asset.figures[0].humanReviewed, false);
  assert.deepEqual(asset.figures[0].panelHints, ['A', 'B']);
  assert.deepEqual(asset.figures[0].captionBlocks.map(block => block.panels), [[], ['A'], ['B']]);
  assert.match(asset.figures[0].figureId,
    /^supp-[a-z0-9](?:[a-z0-9-]{0,47})-[a-z0-9](?:[a-z0-9-]{0,23})$/);
  assert.equal(supplementalFigureAssetPath(asset.materialId),
    'figures/supplemental/caption-s1.json');
  assert.equal(JSON.stringify(asset).includes('data:image/'), false);
  assert.equal(JSON.stringify(asset).includes('transientImage'), false);
});

test('creates an image draft from already-normalized persistent provenance', () => {
  const normalized = normalizeSupplementalFigureSource({
    sourceMode: 'image',
    sourceMaterialId: 'manual-image-s3',
    sourceFileName: 'figure-s3.webp',
    sourceMimeType: 'image/webp',
    sourceFileSize: 2048,
    sourceImportedAt: importedAt,
    sourceFingerprint: fingerprint('9'),
    imageWidth: 1200,
    imageHeight: 800
  });
  const draft = createSupplementalFigureImportDraft(normalized);
  assert.equal(draft.sourceMode, 'image');
  assert.equal(draft.figures[0].sourceMode, 'image');
  assert.equal(draft.figures[0].analysisStatus, 'draft');
  assert.doesNotMatch(JSON.stringify(draft), /data:image\//);
});

test('bounds the Figure id material segment while retaining the PDF binding material id', () => {
  const materialId = `publisher-${'a'.repeat(70)}`;
  const asset = createSupplementalFigureImportDraft({
    sourceMode: 'pdf',
    sourceMaterialId: materialId,
    sourceFileName: 'supplement.pdf',
    sourceMimeType: 'application/pdf',
    sourceFileSize: 2048,
    sourceImportedAt: importedAt,
    sourceFingerprint: fingerprint('e'),
    figureLabel: `Figure ${'z'.repeat(100)}`
  });
  assert.equal(asset.materialId, materialId);
  const [, , materialSegment, figureSegment] = asset.figures[0].figureId.match(
    /^(supp)-([a-z0-9](?:[a-z0-9-]{0,47}))-([a-z0-9](?:[a-z0-9-]{0,23}))$/
  ) || [];
  assert.ok(materialSegment.length <= 48);
  assert.ok(figureSegment.length <= 24);
});

test('does not let manual image or caption material ids bypass the persisted path segment cap', () => {
  const longMaterialId = `manual-${'x'.repeat(60)}`;
  const shared = {
    sourceMaterialId: longMaterialId,
    sourceImportedAt: importedAt,
    sourceFingerprint: fingerprint('6')
  };
  assert.throws(() => normalizeSupplementalFigureSource({
    ...shared,
    sourceMode: 'caption',
    caption: 'Figure S1. Replication.'
  }), /SUPPLEMENTAL_MATERIAL_ID_BOUNDS/);
  assert.throws(() => normalizeSupplementalFigureSource({
    ...shared,
    sourceMode: 'image',
    sourceFileName: 'figure.png',
    sourceMimeType: 'image/png',
    sourceFileSize: 10,
    imageWidth: 1,
    imageHeight: 1
  }), /SUPPLEMENTAL_MATERIAL_ID_BOUNDS/);

  const pdf = normalizeSupplementalFigureSource({
    ...shared,
    sourceMode: 'pdf',
    sourceFileName: 'supplement.pdf',
    sourceMimeType: 'application/pdf',
    sourceFileSize: 10
  });
  assert.equal(pdf.sourceMaterialId, longMaterialId);
  assert.equal(
    supplementalFigureAssetPath(pdf.sourceMaterialId),
    `figures/supplemental/${longMaterialId}.json`
  );
});

test('allocates bounded candidate ids while final create-only CAS prevents concurrent overwrite', async () => {
  const occupied = new Set();
  const exists = async id => occupied.has(id);
  const longPrefix = `figure-s1-${'x'.repeat(100)}`;
  const first = await allocateSupplementalMaterialId({
    readablePrefix: longPrefix,
    sourceFingerprint: fingerprint('f')
  }, { exists, randomHex: () => '11111111' });
  occupied.add(first);
  const second = await allocateSupplementalMaterialId({
    readablePrefix: longPrefix,
    sourceFingerprint: fingerprint('f')
  }, { exists, randomHex: () => '22222222' });
  assert.notEqual(first, second);
  assert.ok(first.length <= 48 && second.length <= 48);
  assert.match(first, /^figure-s1-/);
  assert.match(second, /-22222222$/);
});

test('requires an injected existence check before allocating a manual material id', async () => {
  await assert.rejects(
    allocateSupplementalMaterialId({
      readablePrefix: 'figure-s1',
      sourceFingerprint: fingerprint('7')
    }),
    /SUPPLEMENTAL_EXISTS_REQUIRED/
  );
});

test('retries injected id collisions and stops after the bounded attempt budget', async () => {
  const attempts = [];
  const id = await allocateSupplementalMaterialId({
    readablePrefix: 'same-prefix',
    sourceFingerprint: fingerprint('1')
  }, {
    exists: async candidate => {
      attempts.push(candidate);
      return attempts.length < 3;
    },
    randomHex: length => (attempts.length === 1 ? 'aaaaaaaa' : 'bbbbbbbb').slice(0, length)
  });
  assert.equal(attempts.length, 3);
  assert.match(id, /-bbbbbbbb$/);
  await assert.rejects(
    allocateSupplementalMaterialId({
      readablePrefix: 'same-prefix',
      sourceFingerprint: fingerprint('2')
    }, { exists: async () => true, randomHex: () => 'cccccccc' }),
    /SUPPLEMENTAL_MATERIAL_ID_COLLISION/
  );
});

test('creates concurrent manual drafts with create-only persistence and unique material ids', async () => {
  const records = new Map();
  const conflicts = [];
  let randomIndex = 0;
  const deps = {
    exists: async materialId => records.has(supplementalFigureAssetPath(materialId)),
    randomHex: () => String(++randomIndex).padStart(8, '0'),
    save: async (relativePath, draft, conflict) => {
      await Promise.resolve();
      conflicts.push(conflict);
      if (records.has(relativePath)) {
        const error = new Error('ASSET_REVISION_CONFLICT');
        error.code = 'ASSET_REVISION_CONFLICT';
        throw error;
      }
      const asset = { relativePath, content: draft, revision: 1 };
      records.set(relativePath, asset);
      return asset;
    }
  };
  const input = {
    sourceMode: 'caption',
    sourceMaterialId: 'caption-s1',
    caption: 'Figure S1. Replication.',
    sourceImportedAt: importedAt,
    sourceFingerprint: fingerprint('3')
  };

  const created = await Promise.all([
    createManualSupplementalDraft(input, deps),
    createManualSupplementalDraft(input, deps)
  ]);

  assert.equal(records.size, 2);
  assert.deepEqual(Object.keys(created[0]).sort(), [
    'asset', 'materialId', 'persisted', 'relativePath'
  ]);
  assert.notEqual(created[0].materialId, created[1].materialId);
  assert.notEqual(created[0].relativePath, created[1].relativePath);
  assert.deepEqual(conflicts, conflicts.map(() => ({
    expectedRevision: 0,
    createOnly: true
  })));
  assert.deepEqual(
    new Set(created.map(item => item.asset.materialId)),
    new Set(created.map(item => item.materialId))
  );
  assert.deepEqual(
    new Set(created.map(item => item.persisted.content.materialId)),
    new Set(created.map(item => item.materialId))
  );
});

test('stops manual draft creation after eight atomic create conflicts', async () => {
  let saveCalls = 0;
  let randomIndex = 0;
  await assert.rejects(
    createManualSupplementalDraft({
      sourceMode: 'caption',
      sourceMaterialId: 'caption-s2',
      caption: 'Figure S2. Rescue.',
      sourceImportedAt: importedAt,
      sourceFingerprint: fingerprint('4')
    }, {
      exists: async () => false,
      randomHex: () => (++randomIndex).toString(16).padStart(8, '0'),
      save: async (_relativePath, _draft, conflict) => {
        saveCalls += 1;
        assert.deepEqual(conflict, { expectedRevision: 0, createOnly: true });
        const error = new Error('ASSET_REVISION_CONFLICT');
        error.code = 'ASSET_REVISION_CONFLICT';
        throw error;
      }
    }),
    error => error?.code === 'SUPPLEMENTAL_MATERIAL_ID_COLLISION'
  );
  assert.equal(saveCalls, 8);
});

test('normalizes one manual analysis image inside the shared draft contract', async () => {
  const sourceFingerprint = fingerprint('5');
  let savedDraft = null;
  const created = await createManualSupplementalDraft({
    sourceMode: 'image',
    sourceMaterialId: 'manual-image-s5',
    sourceFileName: 'figure-s5.png',
    sourceMimeType: 'image/png',
    sourceFileSize: 4,
    sourceImportedAt: importedAt,
    sourceFingerprint,
    analysisImages: [{
      mediaType: 'image/png',
      dataUrl: 'data:image/png;base64,AAAA',
      width: 1,
      height: 1,
      sourceFingerprint,
      rawFileName: 'must-not-persist.png'
    }]
  }, {
    exists: async () => false,
    save: async (_relativePath, draft, conflict) => {
      savedDraft = draft;
      assert.deepEqual(conflict, { expectedRevision: 0, createOnly: true });
      return { revision: 1, contentHash: 'saved' };
    }
  });

  assert.equal(created.asset, savedDraft);
  assert.equal(created.persisted.revision, 1);
  assert.equal(created.asset.analysisStatus, 'awaiting_article_context');
  assert.equal(created.asset.figures[0].analysisStatus, 'awaiting_article_context');
  assert.deepEqual(created.asset.figures[0].analysisImages, [{
    mediaType: 'image/png',
    dataUrl: 'data:image/png;base64,AAAA',
    width: 1,
    height: 1,
    sourceFingerprint
  }]);
  await assert.rejects(
    createManualSupplementalDraft({
      sourceMode: 'image',
      sourceMaterialId: 'manual-image-s5',
      sourceFileName: 'figure-s5.png',
      sourceMimeType: 'image/png',
      sourceFileSize: 4,
      sourceImportedAt: importedAt,
      sourceFingerprint,
      analysisImages: [{
        mediaType: 'image/png', dataUrl: 'data:image/png;base64,AAAA',
        width: 1, height: 1, sourceFingerprint
      }, {
        mediaType: 'image/png', dataUrl: 'data:image/png;base64,AAAA',
        width: 1, height: 1, sourceFingerprint
      }]
    }, { exists: async () => false, save: async () => ({}) }),
    error => error?.code === 'SUPPLEMENTAL_TRANSIENT_IMAGE'
  );
});

test('migrates only legacy PDF supplemental Figures to the explicit pdf source mode', () => {
  const merged = mergeSupplementalFigureAssets([], [{
    materialId: 'legacy-pdf',
    sourceUrl: 'https://journal.example/mmc1.pdf',
    parsedDocument: { markdown: '# Supplemental information' },
    figures: [{ figureId: 'figure-s1', figureLabel: 'Figure S1' }]
  }, {
    materialId: 'explicit-caption',
    sourceMode: 'caption',
    sourceUrl: 'https://journal.example/looks-like.pdf',
    figures: [{ figureId: 'figure-s2', figureLabel: 'Figure S2' }]
  }, {
    materialId: 'explicit-image',
    parsedDocument: { markdown: '# stale metadata' },
    figures: [{
      figureId: 'figure-s3',
      figureLabel: 'Figure S3',
      sourceMode: 'image'
    }]
  }, {
    materialId: 'legacy-unknown',
    figures: [{ figureId: 'figure-s4', figureLabel: 'Figure S4' }]
  }]);
  assert.equal(merged[0].sourceMode, 'pdf');
  assert.equal(merged[1].sourceMode, 'caption');
  assert.equal(merged[2].sourceMode, 'image');
  assert.equal(Object.hasOwn(merged[3], 'sourceMode'), false);
});

test('discovers publisher supplemental links and inline videos without treating the article PDF as supplemental', () => {
  const link = (href, textContent) => ({
    href,
    textContent,
    getAttribute: name => name === 'href' ? href : null
  });
  const block = textContent => ({ textContent });
  const documentLike = {
    baseURI: 'https://journal.example/article/1',
    querySelectorAll: selector => selector.startsWith('a[')
      ? [
          link('/article/1.pdf', 'Download PDF'),
          link('/article/mmc1.pdf', 'Supplemental information'),
          link('/article/mmc2.mp4', 'Video S2')
        ]
      : [
          block('A normal Results paragraph citing Videos S1 and S2.'),
          block('Video S1. 3D rendering related to Figure 1')
        ]
  };
  const materials = discoverSupplementalMaterials(documentLike);
  assert.deepEqual(materials.map(item => item.kind), ['pdf', 'video', 'video']);
  assert.ok(materials.every(item => item.title !== 'Download PDF'));
});

test('extracts supplemental Figure, Extended Data and Video references from canonical prose', () => {
  const references = extractSupplementalReferences([{
    paragraphId: 'p-1',
    sectionTitle: 'Results',
    text: 'The phenotype was reproduced in Figures S2A and S3, Extended Data Figure 4, and Videos S1 and S2.'
  }]);
  assert.deepEqual(references.map(item => item.shortLabel), [
    'S2', 'S3', 'ED4', 'Video S1', 'Video S2'
  ]);
  assert.deepEqual(references[0].panels, ['A']);
});

test('merges imported supplemental figures with collision-safe ids and reports coverage', () => {
  const figures = mergeSupplementalFigureAssets(
    [{ figureId: 'figure-1', figureLabel: 'Figure 1', isSupplemental: false }],
    [{
      materialId: 'cell-supplement',
      sourceUrl: 'https://journal.example/mmc1.pdf',
      figures: [{
        figureId: 'figure-s2',
        figureLabel: 'Figure S2',
        sourceReaderTabId: 42,
        sourceReaderUrl: 'chrome-extension://test/pdf-reader.html?suppMaterial=cell-supplement',
        deep: { coreConclusion: 'Supplemental result.' }
      }, {
        figureId: 'figure-s3',
        figureLabel: 'Figure S3'
      }]
    }]
  );
  assert.equal(figures.length, 3);
  assert.match(figures[1].figureId, /^supp-cell-supplement-/);
  assert.equal(figures[1].isSupplemental, true);
  assert.equal(figures[1].sourceReaderTabId, 42);
  assert.match(figures[1].sourceReaderUrl, /pdf-reader\.html/);
  const coverage = buildSupplementalCoverage({
    references: extractSupplementalReferences([{
      text: 'Figures S2 and S3 support the main conclusion.'
    }]),
    materials: [{ materialId: 'cell-supplement' }],
    figures
  });
  assert.equal(coverage.status, 'found');
  assert.equal(coverage.expectedFigureCount, 2);
  assert.equal(coverage.foundFigureCount, 2);
  assert.equal(coverage.analyzedFigureCount, 1);
  assert.deepEqual(coverage.missingFigureLabels, []);
});

test('round-trips a parent workspace binding through the supplemental PDF reader URL', () => {
  const workspaceId = `workspace:${'a'.repeat(64)}`;
  const documentHash = `sha256:${'c'.repeat(64)}`;
  const url = createSupplementalPdfReaderUrl(
    path => `chrome-extension://test/${path}`,
    {
      sourceUrl: 'https://journal.example/mmc1.pdf',
      title: 'Supplemental information',
      materialId: 'mmc1',
      parentWorkspaceId: workspaceId,
      parentWorkspaceGeneration: 3,
      parentCanonicalUrl: 'https://journal.example/article/1',
      parentDocumentHash: documentHash,
      parentTitle: 'Paper',
      parentTabId: 314
    }
  );
  const binding = readSupplementalPdfBinding(url);
  assert.equal(binding.parentWorkspaceId, workspaceId);
  assert.equal(binding.parentWorkspaceGeneration, 3);
  assert.equal(binding.parentDocumentHash, documentHash);
  assert.equal(binding.materialId, 'mmc1');
  assert.equal(binding.parentTabId, 314);
  assert.equal(binding.sourceUrl, 'https://journal.example/mmc1.pdf');
  assert.equal(supplementalFigureAssetPath('MMC 1'), 'figures/supplemental/mmc-1.json');
});

test('normalizes production bare document hashes in supplemental PDF URL bindings', () => {
  const bareDocumentHash = 'E'.repeat(64);
  const url = createSupplementalPdfReaderUrl(
    path => `chrome-extension://test/${path}`,
    {
      materialId: 'manual-supplement',
      parentWorkspaceId: `workspace:${'d'.repeat(64)}`,
      parentDocumentHash: bareDocumentHash
    }
  );
  const parsed = new URL(url);
  const normalized = `sha256:${'e'.repeat(64)}`;
  assert.equal(parsed.searchParams.get('suppParentDocumentHash'), normalized);
  assert.equal(readSupplementalPdfBinding(url).parentDocumentHash, normalized);

  parsed.searchParams.set('suppParentDocumentHash', bareDocumentHash);
  assert.equal(readSupplementalPdfBinding(parsed.href).parentDocumentHash, normalized);
});

test('supplemental PDF bindings omit malformed optional parent document hashes', () => {
  const url = createSupplementalPdfReaderUrl(
    path => `chrome-extension://test/${path}`,
    {
      materialId: 'manual-supplement',
      parentWorkspaceId: `workspace:${'d'.repeat(64)}`,
      parentDocumentHash: 'not-a-document-hash'
    }
  );
  const binding = readSupplementalPdfBinding(url);
  assert.equal(binding.parentDocumentHash, '');
  assert.equal(new URL(url).searchParams.has('suppParentDocumentHash'), false);
});

test('creates a bound local-file picker when the publisher exposes no supplemental PDF URL', () => {
  const workspaceId = `workspace:${'b'.repeat(64)}`;
  const url = createSupplementalPdfReaderUrl(
    path => `chrome-extension://test/${path}`,
    {
      title: '本地补充材料 PDF',
      materialId: 'manual-supplement',
      parentWorkspaceId: workspaceId,
      parentWorkspaceGeneration: 2,
      parentCanonicalUrl: 'https://journal.example/article/2'
    }
  );
  const parsed = new URL(url);
  const binding = readSupplementalPdfBinding(url);
  assert.equal(parsed.pathname, '/pdf-reader.html');
  assert.equal(parsed.searchParams.get('source'), null);
  assert.equal(parsed.searchParams.get('title'), '本地补充材料 PDF');
  assert.equal(binding.parentWorkspaceId, workspaceId);
  assert.equal(binding.materialId, 'manual-supplement');
  assert.equal(binding.sourceUrl, '');
});
