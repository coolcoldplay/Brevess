const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const verifierPath = path.join(root, 'scripts', 'verify-mechanism-panel-coverage.mjs');
const matrixPath = path.join(root, 'docs', 'qa', '2026-08-17-mechanism-panel-coverage-matrix.md');
const pngBytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const name = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, crc]);
}

function mechanismPng(width = 800, height = 800, offset = 0) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 3, 255);
    row[0] = 0;
    for (let x = 0; x < width; x += 1) {
      if (x > 80 && x < 720 && y > 80 && y < 720) {
        row[1 + x * 3] = (x + offset) % 255;
        row[2 + x * 3] = (y + offset) % 255;
        row[3 + x * 3] = 120;
      }
    }
    rows.push(row);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr), pngChunk('IDAT', zlib.deflateSync(Buffer.concat(rows))),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

async function verifier() {
  return import(`${pathToFileURL(verifierPath).href}?test=${Date.now()}-${Math.random()}`);
}

test('headed driver reloads the unpacked extension before opening its control page', () => {
  const source = fs.readFileSync(verifierPath, 'utf8');
  const launchStart = source.indexOf('async launch({ extensionPath, headed, trustedProfileDir })');
  const controlPageStart = source.indexOf('controlPage = await context.newPage()', launchStart);
  const launchSource = source.slice(launchStart, controlPageStart);
  assert.match(launchSource, /chrome\.runtime\.reload\(\)/);
  assert.match(launchSource, /waitForEvent\(['"]serviceworker['"]/);
});

function pdfEscape(value) {
  return String(value).replace(/([\\()])/g, '\\$1');
}

function writePdf(filename, title, pageCount = 2) {
  const pageIds = Array.from({ length: pageCount }, (_, index) => 3 + index);
  const infoId = 3 + pageCount;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Count ${pageCount} /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] >>`,
    ...pageIds.map(() => '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>'),
    `<< /Title (${pdfEscape(title)}) >>`
  ];
  let body = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, 'binary'));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body, 'binary');
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${infoId} 0 R >>\n`;
  body += `startxref\n${xref}\n%%EOF\n`;
  fs.writeFileSync(filename, Buffer.from(body, 'binary'));
}

function mechanismEdgeId(from, to, polarity) {
  const text = `${from}\u0000${to}\u0000${polarity}`;
  let first = 2166136261;
  let second = 2246822507;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    first = Math.imul(first ^ code, 16777619) >>> 0;
    second = Math.imul(second ^ code, 3266489909) >>> 0;
  }
  return `edge-${first.toString(16).padStart(8, '0')}${second.toString(16).padStart(8, '0')}`;
}

function strictMechanism() {
  const edgeId = mechanismEdgeId('source', 'target', 'positive');
  return {
    mechanismVocabulary: [
      { nodeId: 'source', label: 'Source state', nodeType: 'state' },
      { nodeId: 'target', label: 'Target process', nodeType: 'process' }
    ],
    mechanismEdges: [{
      edgeId, from: 'Source state', to: 'Target process', polarity: 'positive',
      supportPanels: ['figure-1:A'],
      panelAssignments: [{ panelKey: 'figure-1:A', evidenceClass: 'sufficiency' }]
    }],
    panelDispositions: [
      { panelKey: 'figure-1:A', status: 'linked', edgeIds: [edgeId] },
      { panelKey: 'figure-1:B', status: 'unlinked', reason: 'No bounded edge.' },
      { panelKey: 'figure-2:A', status: 'excluded', reason: 'Outside mechanism scope.' },
      {
        panelKey: 'figure-2:B', status: 'ambiguous', reason: 'Caption mapping is ambiguous.',
        candidatePanelKeys: ['figure-1:B']
      }
    ]
  };
}

function strictMechanismForFigures(figures) {
  const keys = figures.flatMap(figure => (figure.panelHints || [])
    .map(panelId => `${figure.figureId}:${panelId}`));
  if (keys.length === 4 && keys.every(key =>
    ['figure-1:A', 'figure-1:B', 'figure-2:A', 'figure-2:B'].includes(key))) {
    return strictMechanism();
  }
  const edgeId = mechanismEdgeId('source', 'target', 'positive');
  return {
    mechanismVocabulary: [
      { nodeId: 'source', label: 'Source state', nodeType: 'state' },
      { nodeId: 'target', label: 'Target process', nodeType: 'process' }
    ],
    mechanismEdges: [{
      edgeId, from: 'Source state', to: 'Target process', polarity: 'positive',
      supportPanels: [keys[0]],
      panelAssignments: [{ panelKey: keys[0], evidenceClass: 'sufficiency' }]
    }],
    panelDispositions: keys.map(panelKey => panelKey === keys[0]
      ? { panelKey, status: 'linked', edgeIds: [edgeId] }
      : panelKey.startsWith('figure-ed')
      ? { panelKey, status: 'excluded', reason: 'PDF-only Extended Data evidence.' }
      : { panelKey, status: 'unlinked', reason: 'No bounded edge.' })
  };
}

function createPaperFixture(directory, expected, index) {
  const paperDir = path.join(directory, `paper-${index + 1}`);
  fs.mkdirSync(paperDir, { recursive: true });
  const pdfPath = path.join(paperDir, 'article.pdf');
  const archivePath = path.join(paperDir, 'article.json');
  const panelManifestPath = path.join(paperDir, 'panels.json');
  const documentId = `sha256:${String(index + 1).repeat(64)}`;
  const articleUrl = `https://example.test/articles/${expected.key}`;
  writePdf(pdfPath, expected.title, 2 + index);
  fs.writeFileSync(archivePath, JSON.stringify({
    schemaVersion: 1,
    kind: 'sci-logic-highlighter-article',
    revision: 1,
    savedAt: '2026-08-17T00:00:00.000Z',
    extensionVersion: '2.4.1',
    documentId,
    documentHash: `document-hash-${index + 1}`,
    canonicalUrl: articleUrl,
    title: expected.title,
    publisher: 'fixture-publisher',
    documentRecord: {
      schemaVersion: 1, documentId, documentHash: `document-hash-${index + 1}`,
      title: expected.title, canonicalUrl: articleUrl
    },
    workspace: {
      figures: [
        { figureId: 'figure-1', figureLabel: 'Figure 1', panelHints: ['A', 'B'] },
        { figureId: 'figure-2', figureLabel: 'Figure 2', panelHints: ['A', 'B'] }
      ]
    }
  }), 'utf8');
  const manifest = {
    schemaVersion: 1, paperKey: expected.key, title: expected.title,
    documentIdentity: { documentId, canonicalUrl: articleUrl },
    document: {
      title: expected.title,
      paperBlueprint: { research_question: 'Question', claimed_contribution: 'Contribution' },
      representativeContext: 'Bounded archive context.'
    },
    figures: [{
      figureId: 'figure-1', figureLabel: 'Figure 1', panelHints: ['A', 'B'],
      analysis: { coreConclusion: 'First result.', figureQuestion: 'First question?' }
    }, {
      figureId: 'figure-2', figureLabel: 'Figure 2', panelHints: ['A', 'B'],
      analysis: { coreConclusion: 'Second result.', figureQuestion: 'Second question?' }
    }],
    originalPanels: [
      { figureId: 'figure-1', panelId: 'A', selector: '#p1a' },
      { figureId: 'figure-1', panelId: 'B', selector: '#p1b' },
      { figureId: 'figure-2', panelId: 'A', selector: '#p2a' },
      { figureId: 'figure-2', panelId: 'B', selector: '#p2b' }
    ]
  };
  fs.writeFileSync(panelManifestPath, JSON.stringify(manifest), 'utf8');
  return {
    key: expected.key, title: expected.title, identifier: `10.1000/real-${index + 1}`,
    archiveType: 'article-archive-json', articleUrl,
    pdfPath, archivePath, panelManifestPath
  };
}

function createFixtureSet(requiredPapers) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mechanism-real-gate-'));
  const extensionPath = path.join(directory, 'extension');
  const trustedProfileDir = path.join(directory, 'trusted-profile');
  fs.mkdirSync(extensionPath);
  fs.mkdirSync(path.join(trustedProfileDir, 'Default'), { recursive: true });
  fs.writeFileSync(path.join(extensionPath, 'manifest.json'), JSON.stringify({
    manifest_version: 3, name: 'Brevess fixture', version: '1.0.1'
  }), 'utf8');
  fs.writeFileSync(path.join(extensionPath, 'background.js'), 'globalThis.fixture = true;\n', 'utf8');
  fs.writeFileSync(path.join(trustedProfileDir, 'Default', 'fixture-settings.json'), JSON.stringify({
    consentGranted: true,
    taskRoutes: {},
    profiles: {
      deepseek_flash_user: {
        id: 'deepseek_flash_user', name: 'DeepSeek V4 Flash', providerId: 'deepseek',
        capabilities: { text: true, structuredOutput: true },
        config: {
          model: 'deepseek-v4-flash', reasoningEffort: 'disabled',
          apiKey: 'private-fixture-flash-key'
        }
      },
      deepseek_pro_user: {
        id: 'deepseek_pro_user', name: 'DeepSeek V4 Pro', providerId: 'deepseek',
        capabilities: { text: true, structuredOutput: true, reasoning: true },
        config: {
          model: 'deepseek-v4-pro', reasoningEffort: 'enabled',
          apiKey: 'private-fixture-pro-key'
        }
      }
    }
  }), 'utf8');
  fs.writeFileSync(path.join(trustedProfileDir, 'profile-version.txt'), 'fixture-v1\n', 'utf8');
  return {
    directory, extensionPath, trustedProfileDir,
    papers: requiredPapers.map((paper, index) => createPaperFixture(directory, paper, index)),
    profiles: { flashProfileId: 'deepseek_flash_user', proProfileId: 'deepseek_pro_user' }
  };
}

function makeSrpxSupersetFixture(paper) {
  const archive = JSON.parse(fs.readFileSync(paper.archivePath, 'utf8'));
  const mainFigures = Array.from({ length: 7 }, (_, figureIndex) => {
    const count = figureIndex < 6 ? 8 : 6;
    return {
      figureId: `figure-${figureIndex + 1}`,
      figureLabel: `Figure ${figureIndex + 1}`,
      panelHints: Array.from({ length: count }, (_, panelIndex) => `P${panelIndex + 1}`)
    };
  });
  archive.workspace.figures = mainFigures;
  fs.writeFileSync(paper.archivePath, JSON.stringify(archive), 'utf8');

  const supplementalFigures = Array.from({ length: 3 }, (_, index) => ({
    figureId: `figure-ed${index + 1}`,
    figureLabel: `Extended Data Figure ${index + 1}`,
    panelHints: ['P1', 'P2', 'P3', 'P4']
  }));
  const allFigures = [...mainFigures, ...supplementalFigures].map(figure => ({
    ...figure,
    analysis: { coreConclusion: `${figure.figureLabel} result.`, figureQuestion: 'What changed?' }
  }));
  const originalPanels = allFigures.flatMap(figure => figure.panelHints.map((panelId, index) => {
    const supplemental = figure.figureId.startsWith('figure-ed');
    return {
      figureId: figure.figureId, panelId,
      ...(supplemental ? {
        captionObservation: `${figure.figureLabel} caption explicitly identifies Panel ${panelId}.`,
        pageNumber: 2 + (Number(figure.figureId.at(-1)) % 3)
      } : { selector: `#${figure.figureId}-${index + 1}` })
    };
  }));
  const manifest = JSON.parse(fs.readFileSync(paper.panelManifestPath, 'utf8'));
  manifest.figures = allFigures;
  manifest.originalPanels = originalPanels;
  fs.writeFileSync(paper.panelManifestPath, JSON.stringify(manifest), 'utf8');
}

function sourceTreeDigest(directory) {
  const values = [];
  const visit = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const filename = path.join(current, entry.name);
      if (entry.isDirectory()) visit(filename);
      else values.push(`${path.relative(directory, filename)}\0${sha256(fs.readFileSync(filename))}`);
    }
  };
  visit(directory);
  return sha256(Buffer.from(values.sort().join('\n')));
}

function makeExecutableDriver(calls, options = {}) {
  return {
    async launch({ extensionPath, headed, trustedProfileDir }) {
      assert.ok(fs.statSync(trustedProfileDir).isDirectory());
      const sourceBefore = sourceTreeDigest(trustedProfileDir);
      const copiedProfileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mechanism-profile-copy-'));
      fs.cpSync(trustedProfileDir, copiedProfileDir, { recursive: true });
      if (options.mutateTrustedSource) {
        fs.appendFileSync(path.join(trustedProfileDir, 'Default', 'fixture-settings.json'), ' ');
      }
      const stored = JSON.parse(fs.readFileSync(
        path.join(copiedProfileDir, 'Default', 'fixture-settings.json'), 'utf8'
      ));
      const profiles = Object.fromEntries(Object.entries(stored.profiles).map(([id, profile]) => [id, {
        ...profile,
        config: { ...profile.config, apiKey: undefined, hasApiKey: Boolean(profile.config.apiKey) }
      }]));
      calls.push({
        type: 'launch', extensionPath, headed, trustedProfileProvided: true,
        sourceBefore, copiedProfile: copiedProfileDir !== trustedProfileDir, copiedProfileDir
      });
      let currentProfile = '';
      return {
        trustedProfileCopied: true,
        runtimeSenderContext: options.runtimeSenderContext || 'extension-page',
        async loadLiveArticle({ paperKey, articleUrl, expectedTitle, panelSelectors }) {
          calls.push({ type: 'loadLiveArticle', paperKey, articleUrl });
          return {
            title: expectedTitle, canonicalUrl: articleUrl,
            foundPanelKeys: panelSelectors.map(item => item.panelKey)
          };
        },
        async runtimeMessage(message) {
          calls.push({ type: 'runtimeMessage', message });
          if (message.type === 'LLM_GET_SETTINGS') {
            return { success: true, data: { settings: {
              consentGranted: stored.consentGranted, profiles, taskRoutes: stored.taskRoutes
            } } };
          }
          if (message.type === 'LLM_TEST_PROFILE') {
            return { success: true, data: {
              connected: true, profileId: message.profileId,
              providerId: profiles[message.profileId].providerId,
              model: profiles[message.profileId].config.model,
              probes: message.probeIds.map(id => ({ id, status: 'passed' }))
            } };
          }
          if (message.type === 'LLM_UPDATE_PROFILE_ROUTING') {
            currentProfile = message.taskRoutes.crossFigure.profileId;
            return { success: true, data: { settings: { profiles, taskRoutes: message.taskRoutes } } };
          }
          if (message.type === 'LLM_ANALYZE_CROSS_FIGURE_LOGIC') {
            return { success: true, data: {
              providerId: 'deepseek', model: profiles[currentProfile].config.model,
              profileSignature: sha256(Buffer.from(currentProfile)),
              route: {
                effectiveProfileId: currentProfile
              },
              cacheHit: false, fallbackUsed: false, diagnostics: [],
              crossFigureLogic: {
                ...strictMechanismForFigures(message.figures), cacheHit: false,
                representativeContext: 'Bounded archive context.',
                rawPrompt: 'PRIVATE RAW PROMPT', rawResponse: 'PRIVATE RAW RESPONSE'
              }
            } };
          }
          throw new Error(`unexpected message ${message.type}`);
        },
        async renderMechanismWorkspaceAndCapture({
          paperKey, title, mechanismResult, canonicalLedger, filename
        }) {
          calls.push({ type: 'renderMechanismWorkspaceAndCapture', paperKey, filename });
          fs.writeFileSync(filename, mechanismPng());
          return {
            workspaceKind: 'mechanism', mechanismViewVisible: true,
            paperKey, title,
            canonicalPanelCount: canonicalLedger.entries.length,
            edgeIds: mechanismResult.mechanismEdges.map(edge => edge.edgeId),
            assignmentKeys: mechanismResult.mechanismEdges
              .flatMap(edge => edge.panelAssignments.map(item => item.panelKey)),
            dispositions: Object.fromEntries(mechanismResult.panelDispositions
              .map(item => [item.panelKey, item.status])),
            requiredUiElements: {
              mechanismView: true, networkCanvas: true, evidenceMatrix: true,
              renderedNodes: mechanismResult.mechanismVocabulary.length
            }
          };
        },
        async close() {
          calls.push({
            type: 'close', sourceAfter: sourceTreeDigest(trustedProfileDir),
            copiedProfileRemoved: true
          });
          fs.rmSync(copiedProfileDir, { recursive: true, force: true });
        }
      };
    }
  };
}

test('real artifact inspection hashes bytes and parses PDF plus production JSON archive identity', async () => {
  const { requiredPapers, inspectPaperArtifacts } = await verifier();
  const fixture = createFixtureSet(requiredPapers);
  try {
    const inspected = await inspectPaperArtifacts(fixture.papers[0], requiredPapers[0]);
    assert.equal(inspected.ok, true);
    assert.equal(inspected.pageCount, 2);
    assert.equal(inspected.pdfTitle, requiredPapers[0].title);
    assert.equal(inspected.archiveTitle, requiredPapers[0].title);
    assert.match(inspected.documentId, /^sha256:/);
    assert.deepEqual(inspected.archiveFigureIds, ['figure-1', 'figure-2']);
    assert.equal(inspected.canonicalUrl, fixture.papers[0].articleUrl);
    assert.match(inspected.pdfSha256, /^[a-f0-9]{64}$/);
    assert.match(inspected.archiveSha256, /^[a-f0-9]{64}$/);
    assert.match(inspected.panelManifestSha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(inspected.canonicalLedger.entries.map(item => item.panelKey), [
      'figure-1:A', 'figure-1:B', 'figure-2:A', 'figure-2:B'
    ]);
    const archive = JSON.parse(fs.readFileSync(fixture.papers[0].archivePath, 'utf8'));
    archive.revision += 1;
    fs.writeFileSync(fixture.papers[0].archivePath, JSON.stringify(archive), 'utf8');
    const changed = await inspectPaperArtifacts(fixture.papers[0], requiredPapers[0]);
    assert.notEqual(changed.archiveSha256, inspected.archiveSha256);
  } finally { fs.rmSync(fixture.directory, { recursive: true, force: true }); }
});

test('artifact title variants require an exact per-paper titleAliases binding', async () => {
  const { requiredPapers, inspectPaperArtifacts } = await verifier();
  const fixture = createFixtureSet(requiredPapers);
  const paper = fixture.papers[0];
  const archiveVariant = `${requiredPapers[0].title}. - Abstract - Publisher`;
  const recordVariant = `${requiredPapers[0].title} - Publisher record`;
  const pdfVariant = `${requiredPapers[0].title} | Journal PDF`;
  try {
    const archive = JSON.parse(fs.readFileSync(paper.archivePath, 'utf8'));
    archive.title = archiveVariant;
    archive.documentRecord.title = recordVariant;
    fs.writeFileSync(paper.archivePath, JSON.stringify(archive), 'utf8');
    writePdf(paper.pdfPath, pdfVariant, 2);

    paper.titleAliases = [archiveVariant, recordVariant, pdfVariant];
    const inspected = await inspectPaperArtifacts(paper, requiredPapers[0]);

    assert.equal(inspected.ok, true);
    assert.equal(inspected.title, requiredPapers[0].title);
    assert.equal(inspected.archiveTitle, archiveVariant);
    assert.equal(inspected.pdfTitle, pdfVariant);
  } finally { fs.rmSync(fixture.directory, { recursive: true, force: true }); }
});

test('titleAliases rejects malformed, duplicate, canonical, or over-broad declarations', async () => {
  const { requiredPapers, inspectPaperArtifacts } = await verifier();
  const invalidDeclarations = [
    'single alias is not an array',
    [''],
    [requiredPapers[0].title],
    ['Publisher title', ' publisher   title '],
    ['Alias one', 'Alias two', 'Alias three', 'Alias four', 'Alias five']
  ];
  for (const titleAliases of invalidDeclarations) {
    const fixture = createFixtureSet(requiredPapers);
    try {
      fixture.papers[0].titleAliases = titleAliases;
      await assert.rejects(
        inspectPaperArtifacts(fixture.papers[0], requiredPapers[0]),
        /ARTIFACT_TITLE_BINDING_INVALID/
      );
    } finally { fs.rmSync(fixture.directory, { recursive: true, force: true }); }
  }
});

test('JSON archive and imported manifest require explicit type, real bytes, and exact document identity', async () => {
  const { requiredPapers, inspectPaperArtifacts } = await verifier();
  const fixture = createFixtureSet(requiredPapers);
  try {
    const paper = fixture.papers[0];
    const manifestPath = paper.panelManifestPath;
    delete paper.panelManifestPath;
    paper.originalInspection = {
      panelManifestPath: manifestPath, panelManifestHash: 'semantic-self-report'
    };
    const imported = await inspectPaperArtifacts(paper, requiredPapers[0]);
    assert.equal(imported.panelManifestSha256, sha256(fs.readFileSync(manifestPath)));

    const missingFile = { ...paper, originalInspection: undefined, panelManifestHash: 'semantic-only' };
    await assert.rejects(inspectPaperArtifacts(missingFile, requiredPapers[0]),
      /Panel manifest path is required/);

    const missingType = { ...paper, archiveType: '' };
    await assert.rejects(inspectPaperArtifacts(missingType, requiredPapers[0]),
      /ARTICLE_ARCHIVE_TYPE_REQUIRED/);

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    delete manifest.originalPanels[0].selector;
    manifest.originalPanels[0].captionObservation =
      'The original caption explicitly labels this item as Panel A.';
    fs.writeFileSync(manifestPath, JSON.stringify(manifest), 'utf8');
    const captionBound = await inspectPaperArtifacts(paper, requiredPapers[0]);
    assert.equal(captionBound.originalPanelKeys.length, 4);
    assert.equal(captionBound.panelSelectors.length, 3);

    manifest.documentIdentity.documentId = `sha256:${'f'.repeat(64)}`;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest), 'utf8');
    await assert.rejects(inspectPaperArtifacts(paper, requiredPapers[0]),
      /PANEL_MANIFEST_DOCUMENT_IDENTITY_MISMATCH/);
  } finally { fs.rmSync(fixture.directory, { recursive: true, force: true }); }
});

test('SRPX2 accepts a 54 archive Panel subset plus 12 PDF-bound Extended Data Panels only as nonlinked', async () => {
  const {
    requiredPapers, inspectPaperArtifacts, auditMechanismResult, auditOriginalInspection
  } = await verifier();
  const fixture = createFixtureSet(requiredPapers);
  const expected = requiredPapers[2];
  const paper = fixture.papers[2];
  try {
    makeSrpxSupersetFixture(paper);
    const binding = await inspectPaperArtifacts(paper, expected);
    assert.equal(binding.archivePanelKeys.length, 54);
    assert.equal(binding.originalPanelKeys.length, 66);
    assert.equal(binding.supplementalPanelKeys.length, 12);
    assert.deepEqual(binding.supplementalFigureIds,
      ['figure-ed1', 'figure-ed2', 'figure-ed3']);
    const originalReview = {
      status: 'PASS', originalArticleReviewed: true, paperKey: binding.paperKey,
      title: binding.title, pageCount: binding.pageCount,
      pdfSha256: binding.pdfSha256, archiveSha256: binding.archiveSha256,
      panelManifestSha256: binding.panelManifestSha256,
      originalPanelKeys: binding.originalPanelKeys,
      observation: 'All 66 Panels were checked against the PDF at native resolution.'
    };
    assert.equal(auditOriginalInspection(originalReview, binding).ok, true);
    assert.equal(auditOriginalInspection({
      ...originalReview, archiveSha256: '0'.repeat(64)
    }, binding).ok, false);

    const edgeId = mechanismEdgeId('source', 'target', 'positive');
    const mechanism = {
      mechanismVocabulary: [
        { nodeId: 'source', label: 'Source state', nodeType: 'state' },
        { nodeId: 'target', label: 'Target process', nodeType: 'process' }
      ],
      mechanismEdges: [{
        edgeId, from: 'Source state', to: 'Target process', polarity: 'positive',
        supportPanels: [binding.archivePanelKeys[0]],
        panelAssignments: [{
          panelKey: binding.archivePanelKeys[0], evidenceClass: 'sufficiency'
        }]
      }],
      panelDispositions: binding.originalPanelKeys.map(panelKey => panelKey === binding.archivePanelKeys[0]
        ? { panelKey, status: 'linked', edgeIds: [edgeId] }
        : binding.supplementalPanelKeys.includes(panelKey)
        ? { panelKey, status: 'excluded', reason: 'PDF-only Extended Data evidence.' }
        : { panelKey, status: 'unlinked', reason: 'No bounded mechanism edge.' })
    };
    const accepted = auditMechanismResult(
      mechanism, binding.canonicalLedger, binding.supplementalPanelKeys
    );
    assert.equal(accepted.ok, true);
    assert.equal(accepted.supplementalDispositions.length, 12);

    const forged = structuredClone(mechanism);
    const supplementalKey = binding.supplementalPanelKeys[0];
    forged.mechanismEdges[0].supportPanels.push(supplementalKey);
    forged.mechanismEdges[0].panelAssignments.push({
      panelKey: supplementalKey, evidenceClass: 'necessity'
    });
    forged.panelDispositions.find(item => item.panelKey === supplementalKey).status = 'linked';
    forged.panelDispositions.find(item => item.panelKey === supplementalKey).edgeIds = [edgeId];
    delete forged.panelDispositions.find(item => item.panelKey === supplementalKey).reason;
    assert.equal(auditMechanismResult(
      forged, binding.canonicalLedger, binding.supplementalPanelKeys
    ).ok, false);

    const manifest = JSON.parse(fs.readFileSync(paper.panelManifestPath, 'utf8'));
    const validManifest = structuredClone(manifest);
    delete manifest.originalPanels.find(item => item.figureId === 'figure-ed1').pageNumber;
    fs.writeFileSync(paper.panelManifestPath, JSON.stringify(manifest), 'utf8');
    await assert.rejects(inspectPaperArtifacts(paper, expected), /PANEL_MANIFEST_SUPERSET_INVALID/);

    const missingArchiveFigure = structuredClone(validManifest);
    missingArchiveFigure.figures = missingArchiveFigure.figures
      .filter(item => item.figureId !== 'figure-7');
    missingArchiveFigure.originalPanels = missingArchiveFigure.originalPanels
      .filter(item => item.figureId !== 'figure-7');
    fs.writeFileSync(paper.panelManifestPath, JSON.stringify(missingArchiveFigure), 'utf8');
    await assert.rejects(inspectPaperArtifacts(paper, expected),
      /PANEL_MANIFEST_DOCUMENT_IDENTITY_MISMATCH/);

    const duplicate = structuredClone(validManifest);
    duplicate.originalPanels.push(structuredClone(duplicate.originalPanels.at(-1)));
    fs.writeFileSync(paper.panelManifestPath, JSON.stringify(duplicate), 'utf8');
    await assert.rejects(inspectPaperArtifacts(paper, expected), /PANEL_MANIFEST_INVALID/);

    const phantom = structuredClone(validManifest);
    phantom.originalPanels.push({
      figureId: 'figure-ed4', panelId: 'P1', pageNumber: 4,
      captionObservation: 'A fabricated Panel that has no canonical Figure ledger entry.'
    });
    fs.writeFileSync(paper.panelManifestPath, JSON.stringify(phantom), 'utf8');
    await assert.rejects(inspectPaperArtifacts(paper, expected), /PANEL_MANIFEST_LEDGER_MISMATCH/);

    const conflict = structuredClone(validManifest);
    conflict.originalPanels.find(item => item.figureId === 'figure-ed1').selector =
      conflict.originalPanels.find(item => item.figureId === 'figure-1').selector;
    fs.writeFileSync(paper.panelManifestPath, JSON.stringify(conflict), 'utf8');
    await assert.rejects(inspectPaperArtifacts(paper, expected), /PANEL_MANIFEST_INVALID/);
  } finally { fs.rmSync(fixture.directory, { recursive: true, force: true }); }
});

test('original inspection must bind computed hashes, page count, title, and exact original Panels', async () => {
  const { requiredPapers, inspectPaperArtifacts, auditOriginalInspection } = await verifier();
  const fixture = createFixtureSet(requiredPapers);
  try {
    const binding = await inspectPaperArtifacts(fixture.papers[0], requiredPapers[0]);
    const review = {
      status: 'PASS', originalArticleReviewed: true, paperKey: requiredPapers[0].key,
      title: requiredPapers[0].title, pageCount: binding.pageCount,
      pdfSha256: binding.pdfSha256, archiveSha256: binding.archiveSha256,
      panelManifestSha256: binding.panelManifestSha256,
      originalPanelKeys: binding.originalPanelKeys,
      observation: 'Every visible original Panel and caption was checked.'
    };
    assert.equal(auditOriginalInspection(review, binding).ok, true);
    assert.equal(auditOriginalInspection({ ...review, pdfSha256: '0'.repeat(64) }, binding).ok, false);
    assert.equal(auditOriginalInspection({
      ...review, originalPanelKeys: review.originalPanelKeys.slice(1)
    }, binding).ok, false);
  } finally { fs.rmSync(fixture.directory, { recursive: true, force: true }); }
});

test('mechanism audit uses strict production edge/assignment/disposition validation', async () => {
  const { requiredPapers, inspectPaperArtifacts, auditMechanismResult } = await verifier();
  const fixture = createFixtureSet(requiredPapers);
  try {
    const binding = await inspectPaperArtifacts(fixture.papers[0], requiredPapers[0]);
    const valid = auditMechanismResult(strictMechanism(), binding.canonicalLedger);
    assert.equal(valid.ok, true);
    assert.deepEqual(valid.counts, {
      discovered: 4, linked: 1, unlinked: 1, excluded: 1, ambiguous: 1, edge: 1
    });
    const duplicate = structuredClone(strictMechanism());
    duplicate.mechanismEdges[0].supportPanels.push('figure-1:A');
    duplicate.mechanismEdges[0].panelAssignments.push({
      panelKey: 'figure-1:A', evidenceClass: 'sufficiency'
    });
    assert.equal(auditMechanismResult(duplicate, binding.canonicalLedger).ok, false);
    const phantom = structuredClone(strictMechanism());
    phantom.panelDispositions[3].panelKey = 'figure-99:Z';
    assert.equal(auditMechanismResult(phantom, binding.canonicalLedger).ok, false);
    const missing = structuredClone(strictMechanism());
    missing.panelDispositions.pop();
    assert.equal(auditMechanismResult(missing, binding.canonicalLedger).ok, false);
  } finally { fs.rmSync(fixture.directory, { recursive: true, force: true }); }
});

test('fresh gate invokes headed extension boundary, Pro probe, six forced provider generations, and screenshots', async () => {
  const { requiredPapers, executeFreshRun } = await verifier();
  const fixture = createFixtureSet(requiredPapers);
  const outputDir = path.join(fixture.directory, 'output');
  const calls = [];
  try {
    const receipt = await executeFreshRun({
      papers: fixture.papers, profiles: fixture.profiles,
      extensionPath: fixture.extensionPath, trustedProfileDir: fixture.trustedProfileDir, outputDir
    }, { driver: makeExecutableDriver(calls) });
    assert.equal(calls.filter(call => call.type === 'launch').length, 1);
    assert.equal(calls.find(call => call.type === 'launch').headed, true);
    assert.equal(calls.filter(call => call.type === 'loadLiveArticle').length, 6);
    assert.equal(calls.filter(call => call.type === 'loadLiveArticle')
      .every(call => /^https:\/\//.test(call.articleUrl) && !Object.hasOwn(call, 'archivePath')), true);
    const messages = calls.filter(call => call.type === 'runtimeMessage').map(call => call.message);
    assert.equal(messages.filter(message => message.type === 'LLM_TEST_PROFILE').length, 2);
    assert.deepEqual(messages.filter(message => message.type === 'LLM_TEST_PROFILE')
      .map(message => message.probeIds), [['connectivity'], ['connectivity', 'reasoning_structured']]);
    assert.equal(messages.filter(message =>
      message.type === 'LLM_ANALYZE_CROSS_FIGURE_LOGIC').length, 6);
    assert.ok(messages.filter(message => message.type === 'LLM_ANALYZE_CROSS_FIGURE_LOGIC')
      .every(message => message.forceRefresh === true));
    assert.equal(calls.filter(call =>
      call.type === 'renderMechanismWorkspaceAndCapture').length, 3);
    assert.equal(receipt.runs.length, 6);
    assert.equal(receipt.runs.every(run => run.mechanism.ok), true);
    assert.equal(receipt.probe.ok, true);
    assert.deepEqual(receipt.profileReadiness.map(item => [item.role, item.ready]), [
      ['flash', true], ['pro', true]
    ]);
    const launch = calls.find(call => call.type === 'launch');
    const close = calls.find(call => call.type === 'close');
    assert.equal(launch.trustedProfileProvided, true);
    assert.equal(launch.copiedProfile, true);
    assert.equal(close.sourceAfter, launch.sourceBefore);
    assert.equal(fs.existsSync(launch.copiedProfileDir), false);
    assert.equal(receipt.trustedProfileBundle.safeFileCount, 1);
    assert.doesNotMatch(JSON.stringify(receipt),
      /private-fixture-(?:flash|pro)-key|trusted-profile|fixture-settings/i);
    assert.equal(receipt.screenshots.every(item => fs.existsSync(item.path)), true);
    assert.equal(receipt.screenshots.every(item => item.width === 800 && item.height === 800), true);
    assert.equal(Object.hasOwn(receipt, 'actualProviderCall'), false);
    assert.doesNotMatch(JSON.stringify(receipt),
      /Bounded archive context|PRIVATE RAW PROMPT|PRIVATE RAW RESPONSE/);
    const messagesAfterRun = calls.filter(call => call.type === 'runtimeMessage')
      .map(call => call.message);
    assert.deepEqual(messagesAfterRun.at(-1), {
      type: 'LLM_UPDATE_PROFILE_ROUTING', taskRoutes: {}
    });
  } finally { fs.rmSync(fixture.directory, { recursive: true, force: true }); }
});

test('fresh gate treats an unavailable browser as PENDING and request-shape failures as hard errors', async () => {
  const { requiredPapers, executeFreshRun } = await verifier();
  const fixture = createFixtureSet(requiredPapers);
  const outputDir = path.join(fixture.directory, 'output');
  try {
    await assert.rejects(executeFreshRun({
      papers: fixture.papers, profiles: fixture.profiles,
      extensionPath: fixture.extensionPath, trustedProfileDir: fixture.trustedProfileDir, outputDir
    }, { driver: { async launch() { throw new Error('browser executable missing'); } } }),
    /PENDING_EXTERNAL_INPUT: headed Microsoft Edge\/browser unavailable/);

    const calls = [];
    const base = makeExecutableDriver(calls);
    const failingDriver = {
      async launch(options) {
        const session = await base.launch(options);
        const send = session.runtimeMessage.bind(session);
        let failed = false;
        session.runtimeMessage = async message => {
          if (!failed && message.type === 'LLM_ANALYZE_CROSS_FIGURE_LOGIC') {
            failed = true;
            return { success: false, error: { code: 'INVALID_REQUEST_SHAPE' } };
          }
          return send(message);
        };
        return session;
      }
    };
    await assert.rejects(executeFreshRun({
      papers: fixture.papers, profiles: fixture.profiles,
      extensionPath: fixture.extensionPath, trustedProfileDir: fixture.trustedProfileDir, outputDir
    }, { driver: failingDriver }), /MECHANISM_GENERATION_FAILED:INVALID_REQUEST_SHAPE/);
  } finally { fs.rmSync(fixture.directory, { recursive: true, force: true }); }
});

test('fresh gate requires a trusted profile, rejects source writes, and verifies both profile readiness responses', async () => {
  const { requiredPapers, executeFreshRun } = await verifier();
  const fixture = createFixtureSet(requiredPapers);
  const outputDir = path.join(fixture.directory, 'output');
  try {
    await assert.rejects(executeFreshRun({
      papers: fixture.papers, profiles: fixture.profiles,
      extensionPath: fixture.extensionPath, outputDir
    }, { driver: makeExecutableDriver([]) }),
    /PENDING_EXTERNAL_INPUT: trusted unlocked profile path is required/);

    await assert.rejects(executeFreshRun({
      papers: fixture.papers, profiles: fixture.profiles,
      extensionPath: fixture.extensionPath,
      trustedProfileDir: path.join(fixture.directory, 'does-not-exist'), outputDir
    }, { driver: makeExecutableDriver([]) }),
    /PENDING_EXTERNAL_INPUT: trusted unlocked profile directory is missing/);

    await assert.rejects(executeFreshRun({
      papers: fixture.papers, profiles: fixture.profiles,
      extensionPath: fixture.extensionPath, trustedProfileDir: fixture.trustedProfileDir, outputDir
    }, { driver: makeExecutableDriver([], { mutateTrustedSource: true }) }),
    /PENDING_EXTERNAL_INPUT: trusted profile source was modified/);

    const secondFixture = createFixtureSet(requiredPapers);
    try {
      const calls = [];
      const base = makeExecutableDriver(calls);
      const notReadyDriver = {
        async launch(options) {
          const session = await base.launch(options);
          const send = session.runtimeMessage.bind(session);
          session.runtimeMessage = async message => {
            const response = await send(message);
            if (message.type === 'LLM_TEST_PROFILE' &&
                message.profileId === secondFixture.profiles.flashProfileId) {
              response.data.connected = false;
            }
            return response;
          };
          return session;
        }
      };
      await assert.rejects(executeFreshRun({
        papers: secondFixture.papers, profiles: secondFixture.profiles,
        extensionPath: secondFixture.extensionPath,
        trustedProfileDir: secondFixture.trustedProfileDir,
        outputDir: path.join(secondFixture.directory, 'output')
      }, { driver: notReadyDriver }), /DeepSeek V4 Flash is not ready/);
      assert.equal(calls.some(call => call.type === 'runtimeMessage' &&
        call.message.type === 'LLM_TEST_PROFILE'), true);
    } finally {
      fs.rmSync(secondFixture.directory, { recursive: true, force: true });
    }
  } finally { fs.rmSync(fixture.directory, { recursive: true, force: true }); }
});

test('fresh gate rejects service-worker self-send and requires an extension-page runtime sender', async () => {
  const { requiredPapers, executeFreshRun } = await verifier();
  const fixture = createFixtureSet(requiredPapers);
  const calls = [];
  try {
    await assert.rejects(executeFreshRun({
      papers: fixture.papers, profiles: fixture.profiles,
      extensionPath: fixture.extensionPath, trustedProfileDir: fixture.trustedProfileDir,
      outputDir: path.join(fixture.directory, 'output')
    }, { driver: makeExecutableDriver(calls, { runtimeSenderContext: 'service-worker' }) }),
    /PENDING_EXTERNAL_INPUT: runtime messages require an extension page sender/);
    assert.equal(calls.filter(call => call.type === 'close').length, 1);
    assert.equal(fs.existsSync(calls.find(call => call.type === 'launch').copiedProfileDir), false);
  } finally { fs.rmSync(fixture.directory, { recursive: true, force: true }); }
});

test('fresh gate loads the live article URL and rejects a redirected or wrong article identity', async () => {
  const { requiredPapers, executeFreshRun } = await verifier();
  const fixture = createFixtureSet(requiredPapers);
  const base = makeExecutableDriver([]);
  try {
    const wrongLiveArticle = {
      async launch(options) {
        const session = await base.launch(options);
        const load = session.loadLiveArticle.bind(session);
        session.loadLiveArticle = async input => ({
          ...await load(input), canonicalUrl: 'https://example.test/articles/wrong-paper'
        });
        return session;
      }
    };
    await assert.rejects(executeFreshRun({
      papers: fixture.papers, profiles: fixture.profiles,
      extensionPath: fixture.extensionPath, trustedProfileDir: fixture.trustedProfileDir,
      outputDir: path.join(fixture.directory, 'output')
    }, { driver: wrongLiveArticle }), /LIVE_ARTICLE_IDENTITY_FAILED/);
  } finally { fs.rmSync(fixture.directory, { recursive: true, force: true }); }
});

test('fresh gate retries one transient live article identity without duplicating provider calls', async () => {
  const { requiredPapers, executeFreshRun } = await verifier();
  const fixture = createFixtureSet(requiredPapers);
  const calls = [];
  const base = makeExecutableDriver(calls);
  let transientFailure = true;
  try {
    const transientLiveArticle = {
      async launch(options) {
        const session = await base.launch(options);
        const load = session.loadLiveArticle.bind(session);
        session.loadLiveArticle = async input => {
          const live = await load(input);
          if (!transientFailure) return live;
          transientFailure = false;
          return { ...live, canonicalUrl: 'https://example.test/articles/transient-page' };
        };
        return session;
      }
    };

    const receipt = await executeFreshRun({
      papers: fixture.papers, profiles: fixture.profiles,
      extensionPath: fixture.extensionPath, trustedProfileDir: fixture.trustedProfileDir,
      outputDir: path.join(fixture.directory, 'output')
    }, { driver: transientLiveArticle });

    assert.equal(receipt.runs.length, 6);
    assert.equal(calls.filter(call => call.type === 'loadLiveArticle').length, 7);
    assert.equal(calls.filter(call =>
      call.type === 'runtimeMessage' &&
      call.message.type === 'LLM_ANALYZE_CROSS_FIGURE_LOGIC').length, 6);
  } finally { fs.rmSync(fixture.directory, { recursive: true, force: true }); }
});

test('live article identity accepts only canonical or explicit alias title evidence', async () => {
  const { liveArticleIdentityMatches } = await verifier();
  const binding = {
    canonicalUrl: 'https://example.test/articles/paper',
    allowedTitles: ['Canonical paper title', 'Publisher paper title.'],
    panelSelectors: [{ panelKey: 'figure-1:A' }]
  };
  assert.equal(liveArticleIdentityMatches({
    canonicalUrl: binding.canonicalUrl,
    titleEvidence: ['Generic search page', 'Publisher paper title.'],
    foundPanelKeys: ['figure-1:A']
  }, binding), true);
  assert.equal(liveArticleIdentityMatches({
    canonicalUrl: binding.canonicalUrl,
    titleEvidence: ['Generic search page'],
    foundPanelKeys: ['figure-1:A']
  }, binding), false);
  assert.equal(liveArticleIdentityMatches({
    canonicalUrl: binding.canonicalUrl,
    titleEvidence: ['Publisher paper title.'],
    foundPanelKeys: []
  }, binding), false);
});

test('mechanism failures preserve fixed provider stage codes but suppress arbitrary text', async () => {
  const { safeRuntimeFailure } = await verifier();
  assert.equal(safeRuntimeFailure(new Error('PROVIDER_GENERATION_RECEIPT_INVALID')),
    'PROVIDER_GENERATION_RECEIPT_INVALID');
  assert.equal(safeRuntimeFailure(new Error('MECHANISM_GENERATION_FAILED:INVALID_RESPONSE')),
    'MECHANISM_GENERATION_FAILED:INVALID_RESPONSE');
  assert.equal(safeRuntimeFailure(new Error('sk-secret C:\\private\\paper.pdf')),
    'MECHANISM_PANEL_COVERAGE_VERIFIER_FAILED');
});

test('private mechanism diagnostics retain only error class, message hash, and local frames', async () => {
  const { privateRuntimeFailureDiagnostic } = await verifier();
  const error = new TypeError('sk-secret C:\\private\\paper.pdf');
  error.stack = 'TypeError: private\n    at executeFreshRun (C:\\private\\verify.mjs:812:17)';
  const diagnostic = privateRuntimeFailureDiagnostic(error);
  assert.equal(diagnostic.name, 'TypeError');
  assert.match(diagnostic.messageSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(diagnostic.frames, [{ file: 'verify.mjs', line: 812, column: 17 }]);
  assert.doesNotMatch(JSON.stringify(diagnostic), /sk-secret|C:\\\\private|paper\.pdf/);
});

test('fresh gate rejects a screenshot boundary that shows only the archive instead of mechanism UI', async () => {
  const { requiredPapers, executeFreshRun } = await verifier();
  const fixture = createFixtureSet(requiredPapers);
  const outputDir = path.join(fixture.directory, 'output');
  const calls = [];
  const base = makeExecutableDriver(calls);
  try {
    const archiveOnlyDriver = {
      async launch(options) {
        const session = await base.launch(options);
        session.renderMechanismWorkspaceAndCapture = async ({ paperKey, title, filename }) => {
          fs.writeFileSync(filename, mechanismPng());
          return {
            workspaceKind: 'archive', mechanismViewVisible: false, paperKey, title,
            canonicalPanelCount: 4, edgeIds: [], assignmentKeys: [], dispositions: {},
            requiredUiElements: {
              mechanismView: false, networkCanvas: false, evidenceMatrix: false,
              renderedNodes: 0
            }
          };
        };
        return session;
      }
    };
    await assert.rejects(executeFreshRun({
      papers: fixture.papers, profiles: fixture.profiles,
      extensionPath: fixture.extensionPath, trustedProfileDir: fixture.trustedProfileDir, outputDir
    }, { driver: archiveOnlyDriver }), /MECHANISM_WORKSPACE_RENDER_INVALID/);
  } finally { fs.rmSync(fixture.directory, { recursive: true, force: true }); }
});

test('actual nonblank mechanism PNG and separate native inspection are hash-bound and recursively private', async () => {
  const { inspectScreenshotFile, auditNativeInspection, auditInspectionPrivacy } = await verifier();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mechanism-shot-'));
  const filename = path.join(directory, 'mechanism.png');
  try {
    fs.writeFileSync(filename, mechanismPng());
    const evidence = inspectScreenshotFile(filename, 'paper-a');
    assert.deepEqual({ width: evidence.width, height: evidence.height }, { width: 800, height: 800 });
    assert.equal(evidence.nonBlank, true);
    const review = {
      status: 'PASS', nativeResolution: true, paperKey: 'paper-a',
      filename: path.basename(filename), sha256: evidence.sha256,
      width: 800, height: 800, observation: 'Native pixels were inspected independently.'
    };
    assert.equal(auditNativeInspection(review, evidence).ok, true);
    fs.writeFileSync(filename, mechanismPng(800, 800, 17));
    assert.equal(auditNativeInspection(review, inspectScreenshotFile(filename, 'paper-a')).ok, false);
    assert.equal(auditInspectionPrivacy({ papers: { a: review } }).ok, true);
    assert.equal(auditInspectionPrivacy({ nested: { arbitraryEndpoint: 'https://secret.invalid' } }).ok, false);
    assert.equal(auditInspectionPrivacy({ nested: { innocent: 'C:\\private\\review.json' } }).ok, false);
    assert.equal(auditInspectionPrivacy({ nested: { innocent: '../private/review.json' } }).ok, false);
    assert.equal(auditInspectionPrivacy({ nested: { innocent: '/srv/private/review.json' } }).ok, false);
    assert.equal(auditInspectionPrivacy({ nested: { credentialBlob: 'not-safe' } }).ok, false);
    fs.writeFileSync(filename, pngBytes);
    assert.throws(() => inspectScreenshotFile(filename, 'paper-a'), /SCREENSHOT_INVALID/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('audit-existing is read-only, rehashes artifacts/screenshots/receipt, and never launches the driver', async () => {
  const { requiredPapers, executeFreshRun, auditExistingRun, hashFile } = await verifier();
  const fixture = createFixtureSet(requiredPapers);
  const outputDir = path.join(fixture.directory, 'output');
  const calls = [];
  try {
    makeSrpxSupersetFixture(fixture.papers[2]);
    fixture.papers[0].titleAliases = ['Explicit unused metadata title variant'];
    const receipt = await executeFreshRun({
      papers: fixture.papers, profiles: fixture.profiles,
      extensionPath: fixture.extensionPath, trustedProfileDir: fixture.trustedProfileDir, outputDir
    }, { driver: makeExecutableDriver(calls) });
    const receiptPath = path.join(outputDir, 'run-receipt.json');
    const inspection = {
      schemaVersion: 1, receiptSha256: hashFile(receiptPath),
      papers: Object.fromEntries(receipt.screenshots.map(evidence => [evidence.paperKey, {
        original: {
          status: 'PASS', originalArticleReviewed: true, paperKey: evidence.paperKey,
          title: receipt.paperBindings.find(item => item.paperKey === evidence.paperKey).title,
          pageCount: receipt.paperBindings.find(item => item.paperKey === evidence.paperKey).pageCount,
          pdfSha256: receipt.paperBindings.find(item => item.paperKey === evidence.paperKey).pdfSha256,
          archiveSha256: receipt.paperBindings.find(item => item.paperKey === evidence.paperKey).archiveSha256,
          panelManifestSha256: receipt.paperBindings.find(item => item.paperKey === evidence.paperKey).panelManifestSha256,
          originalPanelKeys: receipt.paperBindings.find(item => item.paperKey === evidence.paperKey).originalPanelKeys,
          observation: 'Every original Panel was checked against the article.'
        },
        native: {
          status: 'PASS', nativeResolution: true, paperKey: evidence.paperKey,
          filename: path.basename(evidence.path), sha256: evidence.sha256,
          width: evidence.width, height: evidence.height,
          observation: 'Native screenshot pixels were reviewed independently.'
        }
      }]))
    };
    const launchCount = calls.filter(call => call.type === 'launch').length;
    const result = await auditExistingRun({
      receiptPath, papers: fixture.papers, inspection
    }, { driver: { launch() { throw new Error('audit-existing must not launch'); } } });
    assert.equal(result.pass, true);
    fixture.papers[0].titleAliases = ['Replacement metadata title variant'];
    await assert.rejects(auditExistingRun({
      receiptPath, papers: fixture.papers, inspection
    }), /RUN_RECEIPT_ARTIFACT_TAMPERED/);
    fixture.papers[0].titleAliases = ['Explicit unused metadata title variant'];
    const srpxBinding = receipt.paperBindings.find(item =>
      item.paperKey === 'nat-neuro-2020-srpx2');
    assert.equal(srpxBinding.archivePanelKeys.length, 54);
    assert.equal(srpxBinding.supplementalPanelKeys.length, 12);
    assert.equal(receipt.runs.filter(run => run.paperKey === srpxBinding.paperKey)
      .every(run => run.supplementalDispositions.length === 12), true);
    assert.equal(calls.filter(call => call.type === 'launch').length, launchCount);
    assert.doesNotMatch(JSON.stringify(result.publicReport),
      /run-receipt|mechanism-real-gate|representativeContext|Source state|Target process/i);
    const originalReceiptBytes = fs.readFileSync(receiptPath);
    const tamperedReceipt = JSON.parse(originalReceiptBytes.toString('utf8'));
    tamperedReceipt.runs.find(run => run.paperKey === srpxBinding.paperKey)
      .supplementalDispositions[0].status = 'linked';
    fs.writeFileSync(receiptPath, JSON.stringify(tamperedReceipt), 'utf8');
    inspection.receiptSha256 = hashFile(receiptPath);
    await assert.rejects(auditExistingRun({
      receiptPath, papers: fixture.papers, inspection
    }), /RUN_RECEIPT_MECHANISM_INVALID/);
    fs.writeFileSync(receiptPath, originalReceiptBytes);
    inspection.receiptSha256 = hashFile(receiptPath);
    fs.appendFileSync(path.join(fixture.extensionPath, 'background.js'), '// tampered\n');
    await assert.rejects(auditExistingRun({
      receiptPath, papers: fixture.papers, inspection
    }), /RUN_RECEIPT_EXTENSION_TAMPERED/);
  } finally { fs.rmSync(fixture.directory, { recursive: true, force: true }); }
});

test('main requires explicit real extension, headed mode, artifacts, profiles, and executable browser/provider', () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mechanism-main-pending-'));
  try {
    fs.writeFileSync(path.join(outputDir, 'qa-result.json'), JSON.stringify({ pass: true }));
    const run = spawnSync(process.execPath, [verifierPath, '--output', outputDir], {
      cwd: root, encoding: 'utf8', env: {
        ...process.env, MECHANISM_COVERAGE_INPUT: '', EXTENSION_PATH: '', HEADLESS: ''
      }
    });
    assert.equal(run.status, 1);
    assert.match(`${run.stdout}\n${run.stderr}`, /PENDING_EXTERNAL_INPUT/);
    const report = JSON.parse(fs.readFileSync(path.join(outputDir, 'qa-result.json'), 'utf8'));
    assert.equal(report.status, 'FAILED');
    assert.equal(report.pass, false);
  } finally { fs.rmSync(outputDir, { recursive: true, force: true }); }
});

test('public matrix remains PENDING and documents fresh-run plus read-only audit-existing', () => {
  const markdown = fs.readFileSync(matrixPath, 'utf8');
  for (const token of [
    'neuron-2026-dopamine-circuits', 'neuron-2020-hippocampal-ripples',
    'nat-neuro-2020-srpx2', 'DeepSeek V4 Flash', 'DeepSeek V4 Pro',
    'reasoning_structured', 'native-resolution', 'audit-existing', '--trusted-profile',
    'disposable profile', 'LLM_TEST_PROFILE', 'article-archive-json', 'articleUrl',
    'titleAliases', 'semantic `panelManifestHash`', 'Controlled PDF superset',
    '54 Panels', '12 PDF-only Panels'
  ]) assert.match(markdown, new RegExp(token, 'i'), token);
  assert.match(markdown, /PENDING_EXTERNAL_INPUT/);
  assert.match(markdown, /DO NOT MARK PASS/i);
  assert.doesNotMatch(markdown, /\|\s*PASS\s*\|/);
});
