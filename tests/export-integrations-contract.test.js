const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function read(file) {
  return fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
}

test('side-panel toolbar exposes PPT materials and enhanced Zotero snapshot actions', () => {
  const html = read('popup.html');
  const popup = read('popup.js');
  [
    'exportPptMaterials',
    'exportEnhancedSnapshotToZotero'
  ].forEach(id => {
    assert.match(html, new RegExp(`id="${id}"`));
    assert.match(popup, new RegExp(`getElementById\\('${id}'\\)`));
  });
  assert.match(html, /导出 PPT 材料包/);
  assert.match(html, /导出到 Zotero/);
  assert.match(html, /side-panel-tool-letter" aria-hidden="true">P</);
  assert.match(html, /side-panel-tool-letter" aria-hidden="true">Z</);
  assert.match(popup, /action:\s*'exportPptMaterials'/);
  assert.match(popup, /action:\s*'exportEnhancedSnapshotToZotero'/);
});

test('side-panel toolbar keeps save primary and groups exports before the destructive action', () => {
  const html = read('popup.html');
  const ids = [
    'saveCurrentArticleWorkspace',
    'scanArticleWorkspace',
    'importCurrentArticleArchiveButton',
    'exportCurrentArticleArchive',
    'exportPptMaterials',
    'exportEnhancedSnapshotToZotero',
    'clearArticleWorkspace'
  ];
  const positions = ids.map(id => html.indexOf(`id="${id}"`));
  positions.forEach(position => assert.ok(position >= 0));
  assert.deepEqual([...positions].sort((left, right) => left - right), positions);
});

test('content export packages original Figure resources and complete reading artifacts', () => {
  const content = read('content.js');
  assert.match(content, /collectFigureImageCandidates/);
  assert.match(content, /EXPORT_FETCH_IMAGE_RESOURCE/);
  assert.match(content, /measureExportImageResource/);
  assert.match(content, /compareExportImageQuality/);
  assert.match(content, /qualitySelection:\s*'largest-pixel-area'/);
  assert.match(content, /pixelWidth:\s*image\.pixelWidth/);
  assert.match(content, /pixelHeight:\s*image\.pixelHeight/);
  assert.match(content, /analysis\/figures\/\$\{figureStem\}\.json/);
  assert.match(content, /analysis\/cross-figure-logic\.json/);
  assert.match(content, /analysis\/fulltext-question-answer\.json/);
  assert.match(content, /PROMPT_FOR_CODEX_OR_AGENT\.md/);
  assert.match(content, /currentManualDocument\?\.record\?\.annotations/);
  assert.match(content, /buildEnhancedArticleSnapshotHtml/);
  assert.match(content, /resolveZoteroSnapshotArticleRoot\(\)/);
  assert.match(content, /outputDocument\.importNode\(liveRoot, true\)/);
  assert.doesNotMatch(content, /const\s+liveRoot\s*=\s*document\.documentElement/);
  assert.match(content, /data-sci-reader-snapshot/);
  assert.match(content, /faithful-v1/);
  assert.match(content, /chrome\.runtime\.getURL\('content\.css'\)/);
  assert.match(content, /loadZoteroSnapshotPluginCss/);
  assert.match(content, /sci-snapshot-highlight-control/);
  assert.match(content, /sci-snapshot-highlight-label/);
  assert.match(content, /sci-snapshot-highlight-popover/);
  assert.match(content, /annotation\?\.note/);
  assert.match(content, /encodeSnapshotImageDataUrl/);
  assert.match(content, /data-sci-embedded-original/);
  assert.match(content, /collectZoteroSnapshotFigureResources/);
  assert.match(content, /embeddedImageByElement/);
  assert.match(content, /embeddedImageCount/);
  assert.match(content, /source\.removeAttribute\('srcset'\)/);
  assert.match(content, /source\.removeAttribute\('src'\)/);
  assert.match(content, /charset\.setAttribute\('charset', 'utf-8'\)/);
  assert.match(content, /default-src 'none'/);
  assert.match(content, /#js-enable-context-bar/);
  assert.match(content, /#immersive-translate-browser-popup/);
  assert.match(content, /buildZoteroFigureNoteHtml/);
  assert.match(content, /buildZoteroChatNoteHtml/);
  assert.match(content, /SCI-Reader-Figure-Interpretation\.html/);
  assert.match(content, /SCI-Reader-Fulltext-QA\.html/);
  assert.match(content, /ZOTERO_IMPORT_ENHANCED_SNAPSHOT/);
  assert.match(content, /fallbackDownloaded:\s*true/);
});

test('mechanism UI separates lossless workspace JSON from Panel-free visual graph exports', () => {
  const popup = read('popup.js');
  const start = popup.indexOf('async function exportMechanismNetwork');
  const end = popup.indexOf('function mechanismNetworkImportFailureCode', start);
  const source = popup.slice(start, end);
  const importStart = popup.indexOf('async function importMechanismNetworkFile');
  const importEnd = popup.indexOf('function closeMechanismNetworkExportMenu', importStart);
  const importSource = popup.slice(importStart, importEnd);
  assert.match(source, /createMechanismNetworkJson/);
  assert.match(source, /mechanismGeneration/);
  assert.match(source, /createMechanismGraphExportDto/);
  assert.match(source, /serializeMechanismAuditSvg/);
  assert.match(importSource, /parseMechanismGraphExport/);
  assert.match(importSource, /createMechanismNetworkJson/);
  assert.match(importSource, /restoreJsonText/);
  assert.match(importSource, /parseMechanismNetworkJson/);
  assert.doesNotMatch(source, /serializeMechanismGraphExport/);
  assert.doesNotMatch(source, /serializeMechanismNetworkSvg\(\{\s*chain/u);
  const jsonBranch = source.slice(
    source.indexOf("normalizedFormat === 'json'"),
    source.indexOf('} else {', source.indexOf("normalizedFormat === 'json'"))
  );
  assert.match(jsonBranch, /createMechanismNetworkJson/);
  assert.doesNotMatch(jsonBranch, /createMechanismGraphExportDto|serializeMechanismAuditSvg/u);
  const visualBranch = source.slice(source.indexOf('} else {'));
  assert.match(visualBranch, /createMechanismGraphExportDto/);
  assert.doesNotMatch(visualBranch, /mechanismGeneration|panelAliases|panelEvidence/u);
});

test('background loads Zotero integration and content injection loads ZIP helpers', () => {
  const background = read('background.js');
  const messenger = read('core/tab-messenger.js');
  assert.match(background, /core\/zotero-connector\.js/);
  const resourceBranchStart = background.indexOf("if (['EXPORT_FETCH_IMAGE_RESOURCE', 'EXPORT_FETCH_SNAPSHOT_RESOURCE', 'EXPORT_RESOLVE_IMAGE_CANDIDATES'].includes(message?.type))");
  const legacyBranchStart = background.indexOf("if (message?.type === 'FIGURE_RESOLVE_IMAGE_CANDIDATES')", resourceBranchStart);
  const zoteroBranchStart = background.indexOf("if (message?.type === 'ZOTERO_IMPORT_ENHANCED_SNAPSHOT')", legacyBranchStart);
  const routedBranchStart = background.indexOf('if (ROUTED_MESSAGE_TYPES.has(message?.type))', zoteroBranchStart);
  assert.ok(resourceBranchStart >= 0 && legacyBranchStart > resourceBranchStart &&
    zoteroBranchStart > legacyBranchStart && routedBranchStart > zoteroBranchStart);
  const resourceBranch = background.slice(resourceBranchStart, legacyBranchStart);
  const legacyBranch = background.slice(legacyBranchStart, zoteroBranchStart);
  const zoteroBranch = background.slice(zoteroBranchStart, routedBranchStart);
  assert.match(resourceBranch, /keepAliveUntil\(runBackgroundExportResource\(message, sender\), chrome\)/);
  assert.match(resourceBranch, /exportPublicError\(error, 'EXPORT_IMAGE_FETCH_FAILED'\)/);
  assert.match(legacyBranch, /keepAliveUntil\(resolveFigureImageCandidates\(message\), chrome\)/);
  assert.doesNotMatch(legacyBranch, /runBackgroundExportResource/);
  assert.match(zoteroBranch, /keepAliveUntil\(runBackgroundZoteroExport\(message, sender\), chrome\)/);
  assert.match(zoteroBranch, /exportPublicError\(error, 'ZOTERO_IMPORT_FAILED'\)/);
  assert.match(background, /message\?\.type === 'FIGURE_RESOLVE_IMAGE_CANDIDATES'/);
  assert.match(background, /core\/figure-image-cache\.js/);
  assert.match(background, /core\/figure-viewer\.js/);
  assert.match(background, /message\?\.type === 'ZOTERO_IMPORT_ENHANCED_SNAPSHOT'/);
  assert.match(background, /saveEnhancedSnapshotToZotero/);

  // Exercise the production scope helper rather than accepting a broad type
  // regex that could accidentally route guarded exports through the legacy path.
  const helperStart = background.indexOf('const backgroundExportOperations =');
  const helperEnd = background.indexOf('async function fetchExportImageResourceUncached(', helperStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart);
  const context = { AbortController, Map, Set, Date, Math, setTimeout, clearTimeout,
    chrome: { runtime: { id: 'extension' } } };
  vm.runInNewContext(background.slice(helperStart, helperEnd), context);
  const sender = { id: 'extension', tab: { id: 7 }, frameId: 0, documentId: 'chrome-document' };
  const message = { operationId: 'fixture-export', contentDocumentIdentity: 'content-document',
    navigationIdentity: 'https://fixture.invalid/a', documentUrl: 'https://fixture.invalid/a',
    sourceLifecycle: 1, resourceId: 'resource-1', type: 'EXPORT_FETCH_IMAGE_RESOURCE' };
  assert.equal(context.scopedBackgroundExport({ type: 'EXPORT_FETCH_IMAGE_RESOURCE' }, sender), null,
    'legacy callers without operationId remain supported');
  const record = context.scopedBackgroundExport(message, sender);
  assert.equal(context.scopedBackgroundExport(message, sender), record);
  for (const invalidSender of [{ ...sender, id: 'foreign' }, { ...sender, tab: { id: -1 } },
    { ...sender, tab: { id: 1.5 } }, { ...sender, frameId: -1 }]) {
    assert.throws(() => context.scopedBackgroundExport(message, invalidSender), { code: 'EXPORT_OPERATION_SOURCE_INVALID' });
  }
  for (const invalidMessage of [{ operationId: 'invalid operation' }, { contentDocumentIdentity: '' },
    { navigationIdentity: '' }, { documentUrl: '' }]) {
    assert.throws(() => context.scopedBackgroundExport({ ...message, ...invalidMessage }, sender), { code: 'EXPORT_OPERATION_SOURCE_INVALID' });
  }
  for (const changedBinding of [{ contentDocumentIdentity: 'another-document' },
    { navigationIdentity: 'https://fixture.invalid/b' }, { documentUrl: 'https://fixture.invalid/b' }, { sourceLifecycle: 2 }]) {
    assert.throws(() => context.scopedBackgroundExport({ ...message, ...changedBinding }, sender), { code: 'EXPORT_OPERATION_SOURCE_CHANGED' });
  }
  assert.equal(record.controller.signal.aborted, false, 'rejected bindings leave the owner operation intact');

  assert.match(messenger, /core\/export-bundle\.js/);
  assert.ok(
    messenger.indexOf("'core/export-bundle.js'") < messenger.indexOf("'content.js'"),
    'ZIP and note helpers must load before the content exporter'
  );
});
