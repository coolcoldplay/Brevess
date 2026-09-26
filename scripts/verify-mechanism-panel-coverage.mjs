import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { pathToFileURL } from 'node:url';
import panelLedgerCore from '../core/panel-ledger.js';
import crossFigureCore from '../core/cross-figure-logic.js';
import articleArchiveCore from '../core/article-archive.js';

const root = path.resolve(import.meta.dirname, '..');
const hashPattern = /^[a-f0-9]{64}$/u;
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
let activeReport = null;

const clean = (value, maximum = 500) => String(value ?? '')
  .normalize('NFKC').replace(/\s+/gu, ' ').trim().slice(0, maximum);
const normalizeTitle = value => clean(value, 1000).toLowerCase();
const sameArray = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function artifactTitleBinding(paper = {}, expected = {}) {
  const aliases = paper.titleAliases === undefined ? [] : paper.titleAliases;
  if (!Array.isArray(aliases) || aliases.length > 4 || aliases.some(value =>
    typeof value !== 'string' || !clean(value, 1000))) {
    throw new Error('ARTIFACT_TITLE_BINDING_INVALID');
  }
  const normalized = aliases.map(normalizeTitle);
  const canonical = normalizeTitle(expected.title);
  if (!canonical || new Set(normalized).size !== normalized.length ||
      normalized.includes(canonical)) {
    throw new Error('ARTIFACT_TITLE_BINDING_INVALID');
  }
  const allowed = new Set([canonical, ...normalized]);
  const titleAliasesSha256 = crypto.createHash('sha256')
    .update('artifact-title-aliases-v1\n')
    .update([...normalized].sort().join('\n'))
    .digest('hex');
  return Object.freeze({
    titleAliasesSha256,
    allowedTitles: Object.freeze([expected.title, ...aliases]),
    matches: value => allowed.has(normalizeTitle(value))
  });
}

export const requiredPapers = Object.freeze([
  Object.freeze({
    key: 'neuron-2026-dopamine-circuits',
    title: 'Receptor and cell-type-specific mechanisms in mesocortical dopamine circuits gate chronic pain and comorbid symptoms'
  }),
  Object.freeze({
    key: 'neuron-2020-hippocampal-ripples',
    title: 'Routing of Hippocampal Ripples to Subcortical Structures via the Lateral Septum'
  }),
  Object.freeze({
    key: 'nat-neuro-2020-srpx2',
    title: 'The endogenous neuronal complement inhibitor SRPX2 protects against complement-mediated synapse elimination during development'
  })
]);

export const requiredProfiles = Object.freeze([
  Object.freeze({
    role: 'flash', profileLabel: 'DeepSeek V4 Flash', providerId: 'deepseek',
    reasoningEnabled: false
  }),
  Object.freeze({
    role: 'pro', profileLabel: 'DeepSeek V4 Pro', providerId: 'deepseek',
    reasoningEnabled: true
  })
]);

export function hashFile(filename) {
  const bytes = fs.readFileSync(filename);
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function requireFile(filename, label) {
  const value = String(filename || '').trim();
  if (!value) throw new Error(`PENDING_EXTERNAL_INPUT: ${label} path is required`);
  const resolved = path.resolve(value);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw new Error(`PENDING_EXTERNAL_INPUT: ${label} file is missing`);
  }
  return resolved;
}

function requireDirectory(directory, label) {
  const value = String(directory || '').trim();
  if (!value) throw new Error(`PENDING_EXTERNAL_INPUT: ${label} path is required`);
  const resolved = path.resolve(value);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error(`PENDING_EXTERNAL_INPUT: ${label} directory is missing`);
  }
  return resolved;
}

const unsafeProfileFingerprintPath = /(?:^|\/)(?:cache|code cache|gpucache|dawncache|shadercache|tmp|temp|logs?|crashpad|cookies?|login data|web data|local storage|local extension settings|indexeddb|session storage|service worker|preferences|secure preferences|local state|[^/]*(?:settings|credentials?|secrets?|tokens?|api[-_]?keys?)[^/]*)(?:\/|$)/iu;

function trustedProfileSnapshot(directoryValue) {
  const directory = requireDirectory(directoryValue, 'trusted unlocked profile');
  const records = [];
  const safeRecords = [];
  const visit = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const filename = path.join(current, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error('PENDING_EXTERNAL_INPUT: trusted profile contains a symbolic link');
      }
      if (entry.isDirectory()) visit(filename);
      else if (entry.isFile()) {
        const relative = path.relative(directory, filename).split(path.sep).join('/');
        const size = fs.statSync(filename).size;
        const digest = hashFile(filename);
        records.push(`${relative}\u0000${size}\u0000${digest}`);
        if (!unsafeProfileFingerprintPath.test(relative)) {
          safeRecords.push(`${relative}\u0000${size}\u0000${digest}`);
        }
      }
    }
  };
  visit(directory);
  if (!records.length) throw new Error('PENDING_EXTERNAL_INPUT: trusted profile is empty');
  records.sort();
  safeRecords.sort();
  if (!safeRecords.length) {
    throw new Error('PENDING_EXTERNAL_INPUT: trusted profile has no safe fingerprint material');
  }
  return Object.freeze({
    directory,
    sourceIntegrity: crypto.createHash('sha256').update(records.join('\n')).digest('hex'),
    safeFingerprint: crypto.createHash('sha256')
      .update('trusted-profile-safe-v1\n').update(safeRecords.join('\n')).digest('hex'),
    safeFileCount: safeRecords.length
  });
}

function normalizeHttpUrl(value) {
  try {
    const parsed = new URL(String(value || '').trim());
    if (!/^https?:$/u.test(parsed.protocol) || parsed.username || parsed.password) return '';
    parsed.search = '';
    parsed.hash = '';
    return parsed.href.replace(/\/$/u, '');
  } catch (_) {
    return '';
  }
}

function archiveFigureInventory(archive) {
  const figures = Array.isArray(archive?.workspace?.figures) ? archive.workspace.figures : [];
  const figureIds = figures.map(item => clean(item?.figureId || item?.id, 200)).filter(Boolean);
  let ledger;
  try { ledger = panelLedgerCore.buildPanelLedger(figures); } catch (_) {}
  const panelKeys = (Array.isArray(ledger?.entries) ? ledger.entries : [])
    .map(item => clean(item?.panelKey, 300));
  if (figureIds.length < 2 || !exactUnique(figureIds) || !exactUnique(panelKeys) ||
      figureIds.some(figureId => !panelKeys.some(key => key.startsWith(`${figureId}:`)))) {
    throw new Error('ARTICLE_ARCHIVE_FIGURE_INVENTORY_INVALID');
  }
  return Object.freeze({ figureIds: Object.freeze([...figureIds].sort()),
    panelKeys: Object.freeze([...panelKeys].sort()) });
}

function inspectArticleArchive(bytes, paper, expected) {
  if (paper.archiveType !== 'article-archive-json') {
    throw new Error('ARTICLE_ARCHIVE_TYPE_REQUIRED');
  }
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch (_) {
    throw new Error('ARTICLE_ARCHIVE_JSON_INVALID');
  }
  let archive;
  try {
    archive = articleArchiveCore.validateArticleArchive(parsed);
  } catch (_) {
    throw new Error('ARTICLE_ARCHIVE_SCHEMA_INVALID');
  }
  const canonicalUrl = normalizeHttpUrl(archive.canonicalUrl);
  const articleUrl = normalizeHttpUrl(paper.articleUrl);
  const documentId = clean(archive.documentId, 200);
  const workspaceId = clean(
    archive.workspace?.localWorkspace?.workspaceId || archive.workspace?.workspaceId, 100
  );
  const inventory = archiveFigureInventory(archive);
  const titleBinding = artifactTitleBinding(paper, expected);
  if (!documentId || !canonicalUrl || !articleUrl || canonicalUrl !== articleUrl ||
      !titleBinding.matches(archive.title) ||
      !titleBinding.matches(archive.documentRecord?.title) ||
      clean(archive.documentRecord?.documentId, 200) !== documentId) {
    throw new Error('ARTICLE_ARCHIVE_IDENTITY_MISMATCH');
  }
  return Object.freeze({ archive, title: archive.title, documentId, workspaceId,
    canonicalUrl, articleUrl, figureIds: inventory.figureIds, panelKeys: inventory.panelKeys });
}

function panelKey(value) {
  const figureId = clean(value?.figureId, 200);
  const panelId = clean(value?.panelId, 100);
  return figureId && panelId ? `${figureId}:${panelId}` : '';
}

function exactUnique(values) {
  return values.length > 0 && new Set(values).size === values.length;
}

async function inspectPdf(filename) {
  const bytes = fs.readFileSync(filename);
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(bytes), useSystemFonts: true, isEvalSupported: false
  });
  const document = await loadingTask.promise;
  try {
    const metadata = await document.getMetadata().catch(() => ({ info: {} }));
    return {
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      pageCount: document.numPages,
      title: clean(metadata?.info?.Title, 1000)
    };
  } finally {
    await document.destroy();
  }
}

function validatePanelManifest(value, expected, archiveBinding, pageCount) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Number(value.schemaVersion) !== 1 || clean(value.paperKey, 100) !== expected.key ||
      normalizeTitle(value.title) !== normalizeTitle(expected.title) ||
      !value.documentIdentity || typeof value.documentIdentity !== 'object' ||
      !value.document || typeof value.document !== 'object' ||
      !Array.isArray(value.figures) || value.figures.length < 2 ||
      !Array.isArray(value.originalPanels) || !value.originalPanels.length) {
    throw new Error('PANEL_MANIFEST_INVALID');
  }
  const originals = value.originalPanels.map(item => ({
    figureId: clean(item?.figureId, 200), panelId: clean(item?.panelId, 100),
    panelKey: panelKey(item), selector: clean(item?.selector, 500),
    captionObservation: clean(item?.captionObservation, 1000),
    pageNumber: Number(item?.pageNumber)
  }));
  if (originals.some(item => !item.panelKey ||
      (!item.selector && item.captionObservation.length < 20)) ||
      !exactUnique(originals.map(item => item.panelKey)) ||
      (originals.some(item => item.selector) && !exactUnique(
        originals.filter(item => item.selector).map(item => item.selector)
      )) || (originals.some(item => item.captionObservation) && !exactUnique(
        originals.filter(item => item.captionObservation).map(item => item.captionObservation)
      ))) {
    throw new Error('PANEL_MANIFEST_INVALID');
  }
  const canonicalLedger = panelLedgerCore.buildPanelLedger(value.figures);
  const ledgerKeys = (Array.isArray(canonicalLedger?.entries) ? canonicalLedger.entries : [])
    .map(item => clean(item?.panelKey, 300));
  const originalKeys = originals.map(item => item.panelKey);
  if (!exactUnique(ledgerKeys) || !sameArray([...ledgerKeys].sort(), [...originalKeys].sort())) {
    throw new Error('PANEL_MANIFEST_LEDGER_MISMATCH');
  }
  const manifestFigureIds = value.figures.map(item => clean(item?.figureId, 200)).sort();
  const archiveFigureIds = archiveBinding.figureIds;
  const archivePanelKeys = archiveBinding.panelKeys;
  const supplementalFigureIds = manifestFigureIds
    .filter(figureId => !archiveFigureIds.includes(figureId));
  const supplementalPanelKeys = originalKeys
    .filter(key => !archivePanelKeys.includes(key)).sort();
  const supplementalRecords = originals.filter(item => supplementalPanelKeys.includes(item.panelKey));
  const identity = value.documentIdentity;
  const identityMatches = clean(identity.documentId, 200) === archiveBinding.documentId &&
    normalizeHttpUrl(identity.canonicalUrl) === archiveBinding.canonicalUrl &&
    clean(identity.workspaceId, 100) === archiveBinding.workspaceId &&
    exactUnique(manifestFigureIds) && archiveFigureIds.every(id => manifestFigureIds.includes(id));
  if (!identityMatches) throw new Error('PANEL_MANIFEST_DOCUMENT_IDENTITY_MISMATCH');
  const supersetValid = archivePanelKeys.every(key => originalKeys.includes(key)) &&
    supplementalRecords.every(item => Number.isSafeInteger(item.pageNumber) &&
      item.pageNumber >= 1 && item.pageNumber <= pageCount &&
      (item.selector || item.captionObservation.length >= 20)) &&
    supplementalFigureIds.every(figureId =>
      supplementalRecords.some(item => item.figureId === figureId));
  if (!supersetValid) throw new Error('PANEL_MANIFEST_SUPERSET_INVALID');
  return {
    manifest: value, originals, originalKeys, canonicalLedger,
    archivePanelKeys, supplementalPanelKeys, supplementalFigureIds
  };
}

export async function inspectPaperArtifacts(paper = {}, expected = {}) {
  const pdfPath = requireFile(paper.pdfPath, `${expected.key || 'paper'} PDF`);
  const archivePath = requireFile(paper.archivePath, `${expected.key || 'paper'} archive`);
  const importedPanelManifestPath = paper.panelManifestPath ||
    paper.originalInspection?.panelManifestPath || paper.inspectionRecord?.panelManifestPath;
  const panelManifestPath = requireFile(
    importedPanelManifestPath, `${expected.key || 'paper'} Panel manifest`
  );
  const [pdf, archiveBytes, manifestBytes] = await Promise.all([
    inspectPdf(pdfPath),
    Promise.resolve(fs.readFileSync(archivePath)),
    Promise.resolve(fs.readFileSync(panelManifestPath))
  ]);
  const archive = inspectArticleArchive(archiveBytes, paper, expected);
  const parsed = validatePanelManifest(
    JSON.parse(manifestBytes.toString('utf8')), expected, archive, pdf.pageCount
  );
  const titleBinding = artifactTitleBinding(paper, expected);
  const titlesMatch = [paper.title, parsed.manifest.title]
    .every(value => normalizeTitle(value) === normalizeTitle(expected.title)) &&
    titleBinding.matches(pdf.title) && titleBinding.matches(archive.title);
  const ok = clean(paper.key, 100) === expected.key && titlesMatch &&
    Number.isSafeInteger(pdf.pageCount) && pdf.pageCount > 0;
  return Object.freeze({
    ok, paperKey: expected.key, title: expected.title,
    identifier: clean(paper.identifier, 160), pageCount: pdf.pageCount,
    pdfTitle: pdf.title, archiveTitle: archive.title,
    titleAliasesSha256: titleBinding.titleAliasesSha256,
    allowedTitles: titleBinding.allowedTitles,
    documentId: archive.documentId, workspaceId: archive.workspaceId,
    canonicalUrl: archive.canonicalUrl, archiveFigureIds: Object.freeze(archive.figureIds),
    archivePanelKeys: Object.freeze(parsed.archivePanelKeys),
    supplementalPanelKeys: Object.freeze(parsed.supplementalPanelKeys),
    supplementalFigureIds: Object.freeze(parsed.supplementalFigureIds),
    pdfSha256: pdf.sha256,
    archiveSha256: crypto.createHash('sha256').update(archiveBytes).digest('hex'),
    panelManifestSha256: crypto.createHash('sha256').update(manifestBytes).digest('hex'),
    originalPanelKeys: Object.freeze([...parsed.originalKeys].sort()),
    panelSelectors: Object.freeze(parsed.originals.filter(item => item.selector).map(item => Object.freeze({
      panelKey: item.panelKey, selector: item.selector
    }))),
    canonicalLedger: parsed.canonicalLedger,
    manifest: parsed.manifest,
    paths: Object.freeze({
      pdfPath, archivePath, panelManifestPath, articleUrl: archive.articleUrl
    })
  });
}

export function liveArticleIdentityMatches(live = {}, binding = {}) {
  const evidence = Array.isArray(live.titleEvidence) ? live.titleEvidence : [live.title];
  const allowed = new Set((Array.isArray(binding.allowedTitles) ? binding.allowedTitles : [binding.title])
    .map(normalizeTitle).filter(Boolean));
  const found = Array.isArray(live.foundPanelKeys)
    ? live.foundPanelKeys.map(item => clean(item, 300)).sort() : [];
  const expectedPanels = (Array.isArray(binding.panelSelectors) ? binding.panelSelectors : [])
    .map(item => clean(item?.panelKey, 300)).sort();
  return normalizeHttpUrl(live.canonicalUrl) === normalizeHttpUrl(binding.canonicalUrl) &&
    evidence.some(value => allowed.has(normalizeTitle(value))) &&
    sameArray(found, expectedPanels);
}

async function loadVerifiedLiveArticle(session, binding) {
  const input = {
    paperKey: binding.paperKey, articleUrl: binding.paths.articleUrl,
    expectedTitle: binding.title, expectedCanonicalUrl: binding.canonicalUrl,
    allowedTitles: binding.allowedTitles, panelSelectors: binding.panelSelectors
  };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const live = await session.loadLiveArticle(input);
    if (liveArticleIdentityMatches(live, binding)) return live;
  }
  throw new Error('LIVE_ARTICLE_IDENTITY_FAILED');
}

export function auditOriginalInspection(review = {}, binding = {}) {
  const reviewKeys = Array.isArray(review.originalPanelKeys)
    ? review.originalPanelKeys.map(value => clean(value, 300)).sort() : [];
  const expectedKeys = Array.isArray(binding.originalPanelKeys)
    ? [...binding.originalPanelKeys].sort() : [];
  const bound = clean(review.paperKey, 100) === clean(binding.paperKey, 100) &&
    normalizeTitle(review.title) === normalizeTitle(binding.title) &&
    Number(review.pageCount) === Number(binding.pageCount) &&
    clean(review.pdfSha256, 64).toLowerCase() === binding.pdfSha256 &&
    clean(review.archiveSha256, 64).toLowerCase() === binding.archiveSha256 &&
    clean(review.panelManifestSha256, 64).toLowerCase() === binding.panelManifestSha256 &&
    exactUnique(reviewKeys) && sameArray(reviewKeys, expectedKeys);
  const human = review.status === 'PASS' && review.originalArticleReviewed === true &&
    clean(review.observation, 1000).length >= 20;
  return Object.freeze({ ok: bound && human, bound, human });
}

export function auditMechanismResult(value = {}, canonicalLedger = {}, supplementalPanelKeys = []) {
  const safeCounts = {
    discovered: Array.isArray(canonicalLedger?.entries) ? canonicalLedger.entries.length : 0,
    linked: Array.isArray(value?.panelDispositions)
      ? value.panelDispositions.filter(item => item?.status === 'linked').length : 0,
    unlinked: Array.isArray(value?.panelDispositions)
      ? value.panelDispositions.filter(item => item?.status === 'unlinked').length : 0,
    excluded: Array.isArray(value?.panelDispositions)
      ? value.panelDispositions.filter(item => item?.status === 'excluded').length : 0,
    ambiguous: Array.isArray(value?.panelDispositions)
      ? value.panelDispositions.filter(item => item?.status === 'ambiguous').length : 0,
    edge: Array.isArray(value?.mechanismEdges) ? value.mechanismEdges.length : 0
  };
  try {
    const normalized = crossFigureCore.validateCachedStagedMechanism(value, canonicalLedger);
    const dispositions = normalized.dispositions || [];
    const supplementalSet = new Set(supplementalPanelKeys.map(value => clean(value, 300)));
    const supplementalDispositions = dispositions
      .filter(item => supplementalSet.has(clean(item?.panelKey, 300)))
      .map(item => Object.freeze({
        panelKey: clean(item.panelKey, 300), status: clean(item.status, 32)
      })).sort((left, right) => left.panelKey.localeCompare(right.panelKey));
    const supplementalValid = supplementalDispositions.length === supplementalSet.size &&
      supplementalDispositions.every(item =>
        ['unlinked', 'excluded', 'ambiguous'].includes(item.status));
    const counts = {
      discovered: Array.isArray(canonicalLedger?.entries) ? canonicalLedger.entries.length : 0,
      linked: dispositions.filter(item => item.status === 'linked').length,
      unlinked: dispositions.filter(item => item.status === 'unlinked').length,
      excluded: dispositions.filter(item => item.status === 'excluded').length,
      ambiguous: dispositions.filter(item => item.status === 'ambiguous').length,
      edge: normalized.edges.length
    };
    const exactCount = counts.discovered ===
      counts.linked + counts.unlinked + counts.excluded + counts.ambiguous;
    const failureCode = normalized.audit?.ok !== true ? 'PANEL_AUDIT_INVALID'
      : !supplementalValid ? 'SUPPLEMENTAL_DISPOSITION_INVALID'
      : !exactCount ? 'PANEL_COUNT_INVALID' : '';
    return Object.freeze({ ok: !failureCode, failureCode,
      counts, supplementalDispositions: Object.freeze(supplementalDispositions) });
  } catch (_) {
    return Object.freeze({
      ok: false,
      failureCode: 'STAGED_MECHANISM_INVALID', counts: safeCounts,
      supplementalDispositions: Object.freeze([])
    });
  }
}

function pngCrc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function paeth(left, above, upperLeft) {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
  return aboveDistance <= upperLeftDistance ? above : upperLeft;
}

function decodePng(bytes) {
  if (bytes.length < 57 || !bytes.subarray(0, 8).equals(pngSignature)) {
    throw new Error('SCREENSHOT_INVALID');
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  let sawHeader = false;
  let sawEnd = false;
  const compressed = [];
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) throw new Error('SCREENSHOT_INVALID');
    const length = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString('ascii');
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const crcEnd = dataEnd + 4;
    if (length > 128 * 1024 * 1024 || crcEnd > bytes.length) {
      throw new Error('SCREENSHOT_INVALID');
    }
    const expectedCrc = bytes.readUInt32BE(dataEnd);
    if (pngCrc32(bytes.subarray(offset + 4, dataEnd)) !== expectedCrc) {
      throw new Error('SCREENSHOT_INVALID');
    }
    const data = bytes.subarray(dataStart, dataEnd);
    if (type === 'IHDR') {
      if (sawHeader || length !== 13) throw new Error('SCREENSHOT_INVALID');
      sawHeader = true;
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const bitDepth = data[8];
      const colorType = data[9];
      channels = ({ 0: 1, 2: 3, 4: 2, 6: 4 })[colorType] || 0;
      if (bitDepth !== 8 || !channels || data[10] !== 0 || data[11] !== 0 || data[12] !== 0) {
        throw new Error('SCREENSHOT_INVALID');
      }
    } else if (type === 'IDAT') {
      if (!sawHeader || sawEnd) throw new Error('SCREENSHOT_INVALID');
      compressed.push(data);
    } else if (type === 'IEND') {
      if (length !== 0 || !sawHeader || !compressed.length) throw new Error('SCREENSHOT_INVALID');
      sawEnd = true;
      offset = crcEnd;
      break;
    }
    offset = crcEnd;
  }
  if (!sawEnd || offset !== bytes.length || width < 700 || height < 700 ||
      width > 32768 || height > 32768) throw new Error('SCREENSHOT_INVALID');
  const stride = width * channels;
  const decoded = zlib.inflateSync(Buffer.concat(compressed), {
    maxOutputLength: (stride + 1) * height
  });
  if (decoded.length !== (stride + 1) * height) throw new Error('SCREENSHOT_INVALID');
  const pixels = Buffer.alloc(stride * height);
  let sourceOffset = 0;
  for (let rowIndex = 0; rowIndex < height; rowIndex += 1) {
    const filter = decoded[sourceOffset++];
    if (filter > 4) throw new Error('SCREENSHOT_INVALID');
    const rowOffset = rowIndex * stride;
    const priorOffset = rowOffset - stride;
    for (let column = 0; column < stride; column += 1) {
      const raw = decoded[sourceOffset++];
      const left = column >= channels ? pixels[rowOffset + column - channels] : 0;
      const above = rowIndex > 0 ? pixels[priorOffset + column] : 0;
      const upperLeft = rowIndex > 0 && column >= channels
        ? pixels[priorOffset + column - channels] : 0;
      const predictor = filter === 1 ? left
        : filter === 2 ? above
          : filter === 3 ? Math.floor((left + above) / 2)
            : filter === 4 ? paeth(left, above, upperLeft) : 0;
      pixels[rowOffset + column] = (raw + predictor) & 0xff;
    }
  }
  let firstPixel = '';
  let nonBlank = false;
  const pixelCount = width * height;
  const sampleStep = Math.max(1, Math.floor(pixelCount / 200000));
  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += sampleStep) {
    const start = pixelIndex * channels;
    const sample = pixels.subarray(start, start + channels).toString('hex');
    if (!firstPixel) firstPixel = sample;
    else if (sample !== firstPixel) { nonBlank = true; break; }
  }
  if (!nonBlank) throw new Error('SCREENSHOT_INVALID');
  return { width, height, nonBlank };
}

export function inspectScreenshotFile(filename, paperKeyValue = '') {
  const resolved = requireFile(filename, 'screenshot');
  const bytes = fs.readFileSync(resolved);
  const { width, height, nonBlank } = decodePng(bytes);
  return Object.freeze({
    paperKey: clean(paperKeyValue, 100), path: resolved, filename: path.basename(resolved),
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'), width, height, nonBlank
  });
}

export function auditNativeInspection(review = {}, evidence = {}) {
  const bound = clean(review.paperKey, 100) === clean(evidence.paperKey, 100) &&
    path.basename(clean(review.filename, 200)) === evidence.filename &&
    clean(review.sha256, 64).toLowerCase() === evidence.sha256 &&
    Number(review.width) === evidence.width && Number(review.height) === evidence.height;
  const human = review.status === 'PASS' && review.nativeResolution === true &&
    clean(review.observation, 1000).length >= 20;
  return Object.freeze({ ok: bound && human, bound, human });
}

const forbiddenInspectionKey = /(?:api.?key|authorization|credential|secret|token|endpoint|url|path|prompt|response|full.?text|article.?text|attachment)/iu;
const forbiddenInspectionValue = /(?:^[a-z]:[\\/]|^\\\\|^file:|^https?:\/\/|^\/|^\.\.?[\\/]|sk-[a-z0-9_-]{8,}|bearer\s+[a-z0-9._-]+)/iu;

export function auditInspectionPrivacy(value) {
  const violations = [];
  const visit = (entry, route) => {
    if (Array.isArray(entry)) {
      entry.forEach((item, index) => visit(item, `${route}[${index}]`));
      return;
    }
    if (entry && typeof entry === 'object') {
      for (const [key, child] of Object.entries(entry)) {
        const next = route ? `${route}.${key}` : key;
        if (forbiddenInspectionKey.test(key)) violations.push(next);
        else visit(child, next);
      }
      return;
    }
    if (typeof entry === 'string' && forbiddenInspectionValue.test(entry.trim())) {
      violations.push(route);
    }
  };
  visit(value, '');
  return Object.freeze({ ok: violations.length === 0, violations: violations.slice(0, 64) });
}

function extensionBuildBinding(extensionPathValue) {
  const extensionPath = path.resolve(String(extensionPathValue || ''));
  const manifestPath = requireFile(path.join(extensionPath, 'manifest.json'), 'extension manifest');
  const manifestBytes = fs.readFileSync(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (Number(manifest.manifest_version) !== 3) throw new Error('EXTENSION_BUILD_INVALID');
  const files = [];
  const visit = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('EXTENSION_BUILD_INVALID');
      if (entry.isDirectory()) visit(filename);
      else if (entry.isFile()) files.push(filename);
    }
  };
  visit(extensionPath);
  files.sort((left, right) => left.localeCompare(right));
  const buildHasher = crypto.createHash('sha256');
  for (const filename of files) {
    const relative = path.relative(extensionPath, filename).split(path.sep).join('/');
    buildHasher.update(relative).update('\u0000').update(hashFile(filename)).update('\n');
  }
  return {
    path: extensionPath,
    name: clean(manifest.name, 200), version: clean(manifest.version, 40),
    manifestSha256: crypto.createHash('sha256').update(manifestBytes).digest('hex'),
    buildSha256: buildHasher.digest('hex')
  };
}

function profileFromSettings(settings, profileId) {
  return settings?.profiles?.[profileId] || null;
}

function validateConfiguredProfiles(settings, configured = {}) {
  if (settings?.consentGranted !== true) {
    throw new Error('PENDING_EXTERNAL_INPUT: trusted profile consent is not granted');
  }
  const values = requiredProfiles.map(expected => {
    const profileId = clean(configured[`${expected.role}ProfileId`], 100);
    const profile = profileFromSettings(settings, profileId);
    const effort = clean(profile?.config?.reasoningEffort, 40).toLowerCase();
    const reasoningMatches = expected.reasoningEnabled
      ? effort && !['disabled', 'none', 'off', 'false'].includes(effort)
      : !effort || ['disabled', 'none', 'off', 'false'].includes(effort);
    const valid = Boolean(profile) && clean(profile.name ?? profile.label, 100) === expected.profileLabel &&
      clean(profile.providerId, 40) === expected.providerId &&
      clean(profile?.config?.model, 120).length > 0 && profile?.config?.hasApiKey === true &&
      profile?.capabilities && typeof profile.capabilities === 'object' &&
      reasoningMatches;
    if (!valid) throw new Error(`PENDING_EXTERNAL_INPUT: configured ${expected.profileLabel} is unavailable`);
    return {
      role: expected.role, profileId, profileLabel: expected.profileLabel,
      providerId: expected.providerId, model: clean(profile.config.model, 120),
      reasoningEnabled: expected.reasoningEnabled
    };
  });
  if (values[0].profileId === values[1].profileId) {
    throw new Error('PENDING_EXTERNAL_INPUT: Flash and Pro profile IDs must differ');
  }
  return values;
}

function validateProfileReadiness(data, profile, requestedProbeIds) {
  const probes = Array.isArray(data?.probes) ? data.probes : [];
  const passed = requestedProbeIds.every(id => probes.some(item =>
    item?.id === id && item?.status === 'passed'));
  if (data?.connected !== true || clean(data?.profileId, 100) !== profile.profileId ||
      clean(data?.providerId, 40) !== profile.providerId ||
      clean(data?.model, 120) !== profile.model || !passed) {
    throw new Error(`PENDING_EXTERNAL_INPUT: configured ${profile.profileLabel} is not ready`);
  }
  return Object.freeze({
    role: profile.role, profileLabel: profile.profileLabel,
    providerId: profile.providerId, model: profile.model,
    capabilityProbes: Object.freeze([...requestedProbeIds]), ready: true
  });
}

function profileReadinessData(response, profile) {
  if (response?.success === true) return response.data;
  const code = clean(response?.error?.code || response?.error, 100);
  if (/REQUEST_SHAPE|INVALID_REQUEST/iu.test(code)) {
    throw new Error(`PROFILE_READINESS_FAILED:${code || 'INVALID_REQUEST_SHAPE'}`);
  }
  throw new Error(`PENDING_EXTERNAL_INPUT: configured ${profile.profileLabel} readiness test failed`);
}

function recordedProfileReadinessIsValid(receipt) {
  if (!Array.isArray(receipt?.profileReadiness) || receipt.profileReadiness.length !== 2) return false;
  return requiredProfiles.every(expected => {
    const record = receipt.profileReadiness.find(item => item?.role === expected.role);
    const expectedProbes = expected.role === 'pro'
      ? ['connectivity', 'reasoning_structured'] : ['connectivity'];
    return record?.ready === true && record.profileLabel === expected.profileLabel &&
      record.providerId === expected.providerId && clean(record.model, 120).length > 0 &&
      sameArray(record.capabilityProbes, expectedProbes);
  });
}

function assertRuntimeSuccess(response, code) {
  if (response?.success !== true) {
    const errorCode = clean(response?.error?.code || response?.error || code, 100);
    throw new Error(`${code}:${errorCode}`);
  }
  return response.data;
}

function boundedMechanismReceipt(data, binding, expectedProfile) {
  const productionProfileSignature = clean(data?.profileSignature, 64).toLowerCase();
  if (clean(data?.providerId, 40) !== 'deepseek' || data?.cacheHit === true ||
      data?.fallbackUsed === true || clean(data?.route?.effectiveProfileId, 100) !==
        expectedProfile.profileId || !clean(data?.model, 120) ||
      !/^[a-f0-9]{8,64}$/u.test(productionProfileSignature) ||
      (Array.isArray(data?.diagnostics) && data.diagnostics.length > 0)) {
    throw new Error('PROVIDER_GENERATION_RECEIPT_INVALID');
  }
  const mechanismValue = data?.crossFigureLogic || {};
  const mechanism = auditMechanismResult(
    mechanismValue, binding.canonicalLedger, binding.supplementalPanelKeys
  );
  if (!mechanism.ok) {
    if (process.env.BREVESS_PRIVATE_QA_DIAGNOSTIC === '1') {
      console.error(`PRIVATE_MECHANISM_AUDIT ${JSON.stringify({
        paperKey: binding.paperKey,
        failureCode: mechanism.failureCode,
        counts: mechanism.counts
      })}`);
    }
    throw new Error('PANEL_LEDGER_INCOMPLETE');
  }
  const mechanismResult = {
    mechanismVocabulary: mechanismValue.mechanismVocabulary,
    mechanismEdges: mechanismValue.mechanismEdges,
    panelDispositions: mechanismValue.panelDispositions
  };
  return {
    paperKey: binding.paperKey, profileRole: expectedProfile.role,
    profileLabel: expectedProfile.profileLabel, profileId: expectedProfile.profileId,
    providerId: 'deepseek', model: clean(data.model, 120),
    profileSignature: crypto.createHash('sha256')
      .update(productionProfileSignature).digest('hex'),
    requestShape: 'accepted', cacheHit: false, fallbackUsed: false,
    mechanism: { ok: mechanism.ok, counts: mechanism.counts },
    supplementalDispositions: mechanism.supplementalDispositions, mechanismResult
  };
}

function auditMechanismWorkspaceMarkers(markers = {}, binding = {}, run = {}) {
  const result = run.mechanismResult || {};
  const expectedEdgeIds = (Array.isArray(result.mechanismEdges) ? result.mechanismEdges : [])
    .map(edge => clean(edge?.edgeId, 100)).sort();
  const expectedAssignments = (Array.isArray(result.mechanismEdges) ? result.mechanismEdges : [])
    .flatMap(edge => Array.isArray(edge?.panelAssignments) ? edge.panelAssignments : [])
    .map(item => clean(item?.panelKey, 300)).sort();
  const expectedDispositions = Object.fromEntries(
    (Array.isArray(result.panelDispositions) ? result.panelDispositions : [])
      .map(item => [clean(item?.panelKey, 300), clean(item?.status, 32)])
  );
  const actualEdgeIds = Array.isArray(markers.edgeIds)
    ? markers.edgeIds.map(value => clean(value, 100)).sort() : [];
  const actualAssignments = Array.isArray(markers.assignmentKeys)
    ? markers.assignmentKeys.map(value => clean(value, 300)).sort() : [];
  const actualDispositions = markers.dispositions && typeof markers.dispositions === 'object'
    ? Object.fromEntries(Object.entries(markers.dispositions)
      .map(([key, value]) => [clean(key, 300), clean(value, 32)])) : {};
  const ui = markers.requiredUiElements || {};
  const expectedNodes = Array.isArray(result.mechanismVocabulary)
    ? result.mechanismVocabulary.length : 0;
  return markers.workspaceKind === 'mechanism' && markers.mechanismViewVisible === true &&
    clean(markers.paperKey, 100) === binding.paperKey &&
    normalizeTitle(markers.title) === normalizeTitle(binding.title) &&
    Number(markers.canonicalPanelCount) === binding.canonicalLedger.entries.length &&
    sameArray(actualEdgeIds, expectedEdgeIds) &&
    sameArray(actualAssignments, expectedAssignments) &&
    JSON.stringify(actualDispositions) === JSON.stringify(expectedDispositions) &&
    ui.mechanismView === true && ui.networkCanvas === true &&
    ui.evidenceMatrix === true && Number(ui.renderedNodes) === expectedNodes &&
    expectedNodes > 0 && expectedEdgeIds.length > 0;
}

function writeJsonAtomically(filename, value) {
  const temporary = `${filename}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, filename);
}

export async function executeFreshRun(config = {}, { driver } = {}) {
  if (!driver || typeof driver.launch !== 'function') throw new Error('BROWSER_DRIVER_REQUIRED');
  const outputDir = path.resolve(String(config.outputDir || ''));
  if (!outputDir) throw new Error('OUTPUT_DIRECTORY_REQUIRED');
  fs.mkdirSync(outputDir, { recursive: true });
  const extensionBuild = extensionBuildBinding(config.extensionPath);
  const trustedProfile = trustedProfileSnapshot(config.trustedProfileDir);
  if (!Array.isArray(config.papers) || config.papers.length !== requiredPapers.length) {
    throw new Error('PENDING_EXTERNAL_INPUT: exactly three real papers are required');
  }
  const bindings = [];
  for (const expected of requiredPapers) {
    const paper = config.papers.find(item => clean(item?.key, 100) === expected.key);
    if (!paper) throw new Error(`PENDING_EXTERNAL_INPUT: ${expected.key} is missing`);
    const binding = await inspectPaperArtifacts(paper, expected);
    if (!binding.ok) throw new Error('PAPER_ARTIFACT_BINDING_FAILED');
    bindings.push(binding);
  }
  let session;
  try {
    session = await driver.launch({
      extensionPath: extensionBuild.path, headed: true, outputDir,
      trustedProfileDir: trustedProfile.directory
    });
    if (session?.trustedProfileCopied !== true) {
      throw new Error('PENDING_EXTERNAL_INPUT: trusted profile bootstrap was not confirmed');
    }
    if (session?.runtimeSenderContext !== 'extension-page') {
      throw new Error('PENDING_EXTERNAL_INPUT: runtime messages require an extension page sender');
    }
  } catch (error) {
    await session?.close?.().catch(() => undefined);
    const current = trustedProfileSnapshot(trustedProfile.directory);
    if (current.sourceIntegrity !== trustedProfile.sourceIntegrity) {
      throw new Error('PENDING_EXTERNAL_INPUT: trusted profile source was modified');
    }
    if (clean(error?.message, 200).startsWith('PENDING_EXTERNAL_INPUT:')) throw error;
    throw new Error('PENDING_EXTERNAL_INPUT: headed Microsoft Edge/browser unavailable');
  }
  const runs = [];
  const screenshots = [];
  let probe;
  let profileReadiness = [];
  let originalRoutes = {};
  let routesLoaded = false;
  try {
    for (const binding of bindings) {
      await loadVerifiedLiveArticle(session, binding);
    }
    const settingsData = assertRuntimeSuccess(
      await session.runtimeMessage({ type: 'LLM_GET_SETTINGS' }), 'SETTINGS_READ_FAILED'
    );
    const settings = settingsData?.settings || {};
    originalRoutes = settings.taskRoutes || {};
    routesLoaded = true;
    const profiles = validateConfiguredProfiles(settings, config.profiles);
    for (const profile of profiles) {
      const probeIds = profile.role === 'pro'
        ? ['connectivity', 'reasoning_structured'] : ['connectivity'];
      const readinessResponse = await session.runtimeMessage({
        type: 'LLM_TEST_PROFILE', profileId: profile.profileId, probeIds
      });
      const readinessData = profileReadinessData(readinessResponse, profile);
      profileReadiness.push(validateProfileReadiness(readinessData, profile, probeIds));
    }
    const pro = profiles.find(item => item.role === 'pro');
    probe = { profileId: pro.profileId, id: 'reasoning_structured', ok: true };
    for (const profile of profiles) {
      const routed = {
        ...originalRoutes,
        crossFigure: { mode: 'profile', profileId: profile.profileId }
      };
      assertRuntimeSuccess(await session.runtimeMessage({
        type: 'LLM_UPDATE_PROFILE_ROUTING', taskRoutes: routed
      }), 'PROFILE_ROUTING_FAILED');
      for (const binding of bindings) {
        const generated = assertRuntimeSuccess(await session.runtimeMessage({
          type: 'LLM_ANALYZE_CROSS_FIGURE_LOGIC',
          document: binding.manifest.document,
          figures: binding.manifest.figures,
          forceRefresh: true
        }), 'MECHANISM_GENERATION_FAILED');
        runs.push(boundedMechanismReceipt(generated, binding, profile));
      }
    }
    for (const binding of bindings) {
      await loadVerifiedLiveArticle(session, binding);
      const filename = path.join(outputDir, `${binding.paperKey}-mechanism.png`);
      const mechanismRun = runs.find(run =>
        run.paperKey === binding.paperKey && run.profileRole === 'pro');
      const markers = await session.renderMechanismWorkspaceAndCapture({
        paperKey: binding.paperKey, title: binding.title,
        figures: binding.manifest.figures,
        canonicalLedger: binding.canonicalLedger,
        mechanismResult: mechanismRun?.mechanismResult,
        filename
      });
      if (!mechanismRun || !auditMechanismWorkspaceMarkers(markers, binding, mechanismRun)) {
        throw new Error('MECHANISM_WORKSPACE_RENDER_INVALID');
      }
      screenshots.push({
        ...inspectScreenshotFile(filename, binding.paperKey),
        workspaceKind: 'mechanism',
        renderedNodes: Number(markers.requiredUiElements?.renderedNodes) || 0,
        renderedEdges: Array.isArray(markers.edgeIds) ? markers.edgeIds.length : 0,
        renderedAssignments: Array.isArray(markers.assignmentKeys)
          ? markers.assignmentKeys.length : 0
      });
    }
  } finally {
    if (routesLoaded && session?.runtimeMessage) {
      await session.runtimeMessage({
        type: 'LLM_UPDATE_PROFILE_ROUTING', taskRoutes: originalRoutes
      }).catch(() => undefined);
    }
    await session?.close?.().catch(() => undefined);
    const current = trustedProfileSnapshot(trustedProfile.directory);
    if (current.sourceIntegrity !== trustedProfile.sourceIntegrity) {
      throw new Error('PENDING_EXTERNAL_INPUT: trusted profile source was modified');
    }
  }
  if (runs.length !== requiredPapers.length * requiredProfiles.length ||
      screenshots.length !== requiredPapers.length) throw new Error('REAL_GATE_INCOMPLETE');
  const receipt = {
    schemaVersion: 2, runId: crypto.randomUUID(), generatedAt: new Date().toISOString(),
    extensionBuild,
    trustedProfileBundle: {
      safeFingerprint: trustedProfile.safeFingerprint,
      safeFileCount: trustedProfile.safeFileCount
    },
    paperBindings: bindings.map(binding => ({
      paperKey: binding.paperKey, title: binding.title, identifier: binding.identifier,
      pageCount: binding.pageCount, pdfSha256: binding.pdfSha256,
      archiveSha256: binding.archiveSha256,
      panelManifestSha256: binding.panelManifestSha256,
      titleAliasesSha256: binding.titleAliasesSha256,
      originalPanelKeys: binding.originalPanelKeys,
      documentId: binding.documentId, workspaceId: binding.workspaceId,
      canonicalUrl: binding.canonicalUrl, archiveFigureIds: binding.archiveFigureIds,
      archivePanelKeys: binding.archivePanelKeys,
      supplementalFigureIds: binding.supplementalFigureIds,
      supplementalPanelKeys: binding.supplementalPanelKeys
    })),
    profileReadiness, probe, runs, screenshots
  };
  writeJsonAtomically(path.join(outputDir, 'run-receipt.json'), receipt);
  return receipt;
}

function comparableBinding(binding) {
  return {
    paperKey: binding.paperKey, title: binding.title, identifier: binding.identifier,
    pageCount: binding.pageCount, pdfSha256: binding.pdfSha256,
    archiveSha256: binding.archiveSha256,
    panelManifestSha256: binding.panelManifestSha256,
    titleAliasesSha256: binding.titleAliasesSha256,
    originalPanelKeys: [...binding.originalPanelKeys],
    documentId: binding.documentId, workspaceId: binding.workspaceId,
    canonicalUrl: binding.canonicalUrl, archiveFigureIds: [...binding.archiveFigureIds],
    archivePanelKeys: [...binding.archivePanelKeys],
    supplementalFigureIds: [...binding.supplementalFigureIds],
    supplementalPanelKeys: [...binding.supplementalPanelKeys]
  };
}

function publicReportFromAudit(receipt, audits, securityOk) {
  return {
    schemaVersion: 2,
    papers: requiredPapers.map(expected => {
      const binding = receipt.paperBindings.find(item => item.paperKey === expected.key);
      const runAudits = audits.runs.filter(item => item.paperKey === expected.key);
      const counts = runAudits[0]?.counts || {
        discovered: 0, linked: 0, unlinked: 0, excluded: 0, ambiguous: 0, edge: 0
      };
      return {
        key: expected.key, title: expected.title, identifier: clean(binding?.identifier, 160),
        hashes: {
          pdfSha256: clean(binding?.pdfSha256, 64),
          archiveSha256: clean(binding?.archiveSha256, 64),
          panelManifestSha256: clean(binding?.panelManifestSha256, 64)
        },
        pageCount: Number(binding?.pageCount) || 0,
        coverage: { ...counts, ok: runAudits.length === 2 && runAudits.every(item => item.ok) },
        pass: audits.originals[expected.key]?.ok === true &&
          audits.native[expected.key]?.ok === true && runAudits.length === 2 &&
          runAudits.every(item => item.ok)
      };
    }),
    profiles: requiredProfiles.map(profile => ({
      profileLabel: profile.profileLabel, reasoningEnabled: profile.reasoningEnabled,
      probe: profile.role === 'pro'
        ? 'connectivity+reasoning_structured' : 'connectivity',
      completedRuns: audits.runs.filter(item => item.profileRole === profile.role && item.ok).length,
      pass: audits.runs.filter(item => item.profileRole === profile.role && item.ok).length === 3 &&
        receipt.profileReadiness?.some(item => item.role === profile.role && item.ready === true) &&
        (profile.role !== 'pro' || receipt.probe?.ok === true)
    })),
    visualReview: {
      required: 3, reviewed: Object.values(audits.native).filter(item => item.ok).length,
      ok: Object.values(audits.native).length === 3 &&
        Object.values(audits.native).every(item => item.ok)
    },
    security: {
      ok: securityOk,
      checks: {
        inspectionMetadataOnly: securityOk,
        publicOutputAllowlist: true,
        noCredentialsOrEndpoints: securityOk,
        noRawPromptsOrResponses: true,
        noLocalPathsOrPrivateAttachments: true
      }
    },
    pass: false
  };
}

export async function auditExistingRun(config = {}, _dependencies = {}) {
  const receiptPath = requireFile(config.receiptPath, 'run receipt');
  const inspection = config.inspection || {};
  const privacy = auditInspectionPrivacy(inspection);
  if (!privacy.ok) throw new Error('UNSAFE_INSPECTION_METADATA');
  if (Number(inspection.schemaVersion) !== 1 ||
      clean(inspection.receiptSha256, 64).toLowerCase() !== hashFile(receiptPath)) {
    throw new Error('INSPECTION_RECEIPT_BINDING_FAILED');
  }
  const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  if (Number(receipt.schemaVersion) !== 2 || !Array.isArray(receipt.runs) ||
      receipt.runs.length !== 6 || receipt.probe?.id !== 'reasoning_structured' ||
      receipt.probe?.ok !== true || !recordedProfileReadinessIsValid(receipt) ||
      !hashPattern.test(clean(receipt.trustedProfileBundle?.safeFingerprint, 64)) ||
      !Number.isSafeInteger(receipt.trustedProfileBundle?.safeFileCount) ||
      receipt.trustedProfileBundle.safeFileCount < 1) throw new Error('RUN_RECEIPT_INVALID');
  const bindings = [];
  for (const expected of requiredPapers) {
    const paper = (config.papers || []).find(item => clean(item?.key, 100) === expected.key);
    const binding = await inspectPaperArtifacts(paper, expected);
    const recorded = receipt.paperBindings.find(item => item.paperKey === expected.key);
    if (!binding.ok || !recorded || !sameArray(
      Object.values(comparableBinding(binding)), Object.values(recorded)
    )) throw new Error('RUN_RECEIPT_ARTIFACT_TAMPERED');
    bindings.push(binding);
  }
  if (!receipt.extensionBuild?.path) throw new Error('RUN_RECEIPT_EXTENSION_TAMPERED');
  const currentBuild = extensionBuildBinding(receipt.extensionBuild.path);
  if (currentBuild.manifestSha256 !== receipt.extensionBuild.manifestSha256 ||
      currentBuild.buildSha256 !== receipt.extensionBuild.buildSha256) {
    throw new Error('RUN_RECEIPT_EXTENSION_TAMPERED');
  }
  const audits = { runs: [], originals: {}, native: {} };
  for (const run of receipt.runs) {
    const binding = bindings.find(item => item.paperKey === run.paperKey);
    const expectedProfile = requiredProfiles.find(item => item.role === run.profileRole);
    const profileValid = expectedProfile && run.profileLabel === expectedProfile.profileLabel &&
      run.providerId === 'deepseek' && run.requestShape === 'accepted' &&
      run.cacheHit === false && run.fallbackUsed === false && hashPattern.test(run.profileSignature);
    const mechanism = binding ? auditMechanismResult(
      run.mechanismResult, binding.canonicalLedger, binding.supplementalPanelKeys
    ) : {
      ok: false, counts: {}
    };
    const recordedSupplemental = Array.isArray(run.supplementalDispositions)
      ? run.supplementalDispositions : [];
    audits.runs.push({
      paperKey: run.paperKey, profileRole: run.profileRole,
      ok: Boolean(profileValid && mechanism.ok && sameArray(
        recordedSupplemental, mechanism.supplementalDispositions
      )), counts: mechanism.counts
    });
  }
  const runKeys = audits.runs.map(item => `${item.paperKey}\u0000${item.profileRole}`);
  if (!exactUnique(runKeys) || audits.runs.some(item => !item.ok)) {
    throw new Error('RUN_RECEIPT_MECHANISM_INVALID');
  }
  for (const binding of bindings) {
    const evidenceRecord = receipt.screenshots.find(item => item.paperKey === binding.paperKey);
    const currentEvidence = inspectScreenshotFile(evidenceRecord?.path, binding.paperKey);
    const proRun = receipt.runs.find(run =>
      run.paperKey === binding.paperKey && run.profileRole === 'pro');
    const expectedAssignments = (Array.isArray(proRun?.mechanismResult?.mechanismEdges)
      ? proRun.mechanismResult.mechanismEdges : []).reduce((sum, edge) =>
      sum + (Array.isArray(edge?.panelAssignments) ? edge.panelAssignments.length : 0), 0);
    if (currentEvidence.sha256 !== evidenceRecord.sha256 ||
        currentEvidence.width !== evidenceRecord.width ||
        currentEvidence.height !== evidenceRecord.height || currentEvidence.nonBlank !== true ||
        evidenceRecord.workspaceKind !== 'mechanism' ||
        Number(evidenceRecord.renderedNodes) < 1 || Number(evidenceRecord.renderedEdges) < 1 ||
        Number(evidenceRecord.renderedAssignments) !== expectedAssignments) {
      throw new Error('RUN_SCREENSHOT_TAMPERED');
    }
    const reviews = inspection.papers?.[binding.paperKey] || {};
    audits.originals[binding.paperKey] = auditOriginalInspection(reviews.original, binding);
    audits.native[binding.paperKey] = auditNativeInspection(reviews.native, currentEvidence);
  }
  const publicReport = publicReportFromAudit(receipt, audits, privacy.ok);
  publicReport.pass = publicReport.papers.length === 3 && publicReport.papers.every(item => item.pass) &&
    publicReport.profiles.every(item => item.pass) && publicReport.visualReview.ok &&
    publicReport.security.ok;
  return Object.freeze({ pass: publicReport.pass, publicReport, audits });
}

export function createPlaywrightDriver() {
  return {
    async launch({ extensionPath, headed, trustedProfileDir }) {
      if (headed !== true) throw new Error('HEADED_EDGE_REQUIRED');
      const { chromium } = await import('playwright');
      const sourceProfile = requireDirectory(trustedProfileDir, 'trusted unlocked profile');
      const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'brevess-mechanism-real-gate-'));
      const profileDir = path.join(temporaryRoot, 'profile');
      try {
        fs.cpSync(sourceProfile, profileDir, {
          recursive: true, errorOnExist: true, force: false,
          filter: source => !fs.lstatSync(source).isSymbolicLink()
        });
      } catch (error) {
        fs.rmSync(temporaryRoot, { recursive: true, force: true });
        throw error;
      }
      let context;
      try {
        context = await chromium.launchPersistentContext(profileDir, {
          channel: 'msedge', headless: false, viewport: { width: 1440, height: 1000 },
          args: [
            `--disable-extensions-except=${extensionPath}`,
            `--load-extension=${extensionPath}`
          ]
        });
      } catch (error) {
        fs.rmSync(temporaryRoot, { recursive: true, force: true });
        throw error;
      }
      let extensionId;
      let controlPage;
      try {
        let workers = context.serviceWorkers();
        if (!workers.length) workers = [await context.waitForEvent('serviceworker')];
        const reloadedWorkerPromise = context.waitForEvent('serviceworker', {
          timeout: 15000
        });
        await workers[0].evaluate(() => chrome.runtime.reload()).catch(error => {
          if (!/closed|destroyed|target/iu.test(String(error?.message || ''))) throw error;
        });
        const reloadedWorker = await reloadedWorkerPromise;
        extensionId = new URL(reloadedWorker.url()).host;
        controlPage = await context.newPage();
        await controlPage.goto(`chrome-extension://${extensionId}/options.html`, {
          waitUntil: 'domcontentloaded'
        });
      } catch (error) {
        await context.close().catch(() => undefined);
        fs.rmSync(temporaryRoot, { recursive: true, force: true });
        throw error;
      }
      let liveArticlePage = null;
      let mechanismPage = null;
      return {
        trustedProfileCopied: true,
        runtimeSenderContext: 'extension-page',
        async loadLiveArticle({ articleUrl, expectedCanonicalUrl, allowedTitles, panelSelectors }) {
          await liveArticlePage?.close().catch(() => undefined);
          liveArticlePage = await context.newPage();
          await liveArticlePage.goto(articleUrl, {
            waitUntil: 'domcontentloaded', timeout: 90000
          });
          await liveArticlePage.waitForFunction(input => {
            const normalize = value => String(value ?? '').normalize('NFKC')
              .replace(/\s+/gu, ' ').trim().toLowerCase();
            const headings = [...document.querySelectorAll('h1')]
              .map(node => node.textContent?.trim() || '').filter(Boolean);
            const evidence = [
              document.title,
              document.querySelector('meta[name="citation_title"]')?.content || '',
              document.querySelector('meta[property="og:title"]')?.content || '',
              ...(headings.length === 1 ? headings : [])
            ].map(normalize).filter(Boolean);
            const allowed = new Set(input.allowedTitles.map(normalize));
            return evidence.some(value => allowed.has(value));
          }, { allowedTitles }, { timeout: 30000 }).catch(() => undefined);
          const titleEvidence = await liveArticlePage.evaluate(() => {
            const headings = [...document.querySelectorAll('h1')]
              .map(node => node.textContent?.trim() || '').filter(Boolean);
            return [
              document.title,
              document.querySelector('meta[name="citation_title"]')?.content || '',
              document.querySelector('meta[property="og:title"]')?.content || '',
              ...(headings.length === 1 ? headings : [])
            ].filter(Boolean);
          });
          const foundPanelKeys = [];
          for (const item of panelSelectors) {
            const locator = liveArticlePage.locator(item.selector);
            if (await locator.count() === 1 && await locator.first().isVisible()) {
              foundPanelKeys.push(item.panelKey);
            }
          }
          return {
            title: await liveArticlePage.title(),
            titleEvidence,
            canonicalUrl: normalizeHttpUrl(liveArticlePage.url()) === normalizeHttpUrl(expectedCanonicalUrl)
              ? expectedCanonicalUrl : liveArticlePage.url(),
            foundPanelKeys
          };
        },
        async runtimeMessage(message) {
          return controlPage.evaluate(value => new Promise(resolve => {
            chrome.runtime.sendMessage(value, response => {
              if (chrome.runtime.lastError) {
                resolve({ success: false, error: { code: 'RUNTIME_MESSAGE_FAILED' } });
              } else resolve(response);
            });
          }), message);
        },
        async renderMechanismWorkspaceAndCapture({
          paperKey, title, figures, canonicalLedger, mechanismResult, filename
        }) {
          if (!mechanismPage) {
            mechanismPage = await context.newPage();
            await mechanismPage.setViewportSize({ width: 1440, height: 1000 });
            await mechanismPage.goto(`chrome-extension://${extensionId}/popup.html`, {
              waitUntil: 'domcontentloaded'
            });
            await mechanismPage.locator('#mechanismChainList').waitFor({ state: 'attached' });
          }
          const expected = {
            nodeCount: Array.isArray(mechanismResult?.mechanismVocabulary)
              ? mechanismResult.mechanismVocabulary.length : 0,
            edgeCount: Array.isArray(mechanismResult?.mechanismEdges)
              ? mechanismResult.mechanismEdges.length : 0,
            assignmentCount: (Array.isArray(mechanismResult?.mechanismEdges)
              ? mechanismResult.mechanismEdges : []).reduce((sum, edge) =>
              sum + (Array.isArray(edge?.panelAssignments) ? edge.panelAssignments.length : 0), 0),
            nonLinkedCount: (Array.isArray(mechanismResult?.panelDispositions)
              ? mechanismResult.panelDispositions : [])
              .filter(item => item?.status !== 'linked').length
          };
          await mechanismPage.evaluate(payload => {
            const vocabulary = Array.isArray(payload.mechanismResult?.mechanismVocabulary)
              ? payload.mechanismResult.mechanismVocabulary : [];
            const labelToId = new Map(vocabulary.map(node => [node.label, node.nodeId]));
            const nodes = vocabulary.map(node => ({
              id: node.nodeId,
              label: { value: node.label, humanReviewed: false }
            }));
            const edges = (Array.isArray(payload.mechanismResult?.mechanismEdges)
              ? payload.mechanismResult.mechanismEdges : []).map(edge => ({
              id: edge.edgeId,
              from: labelToId.get(edge.from),
              to: labelToId.get(edge.to),
              label: { value: '', humanReviewed: false },
              polarity: edge.polarity,
              panelEvidence: (Array.isArray(edge.panelAssignments)
                ? edge.panelAssignments : []).map(item => {
                const separator = String(item.panelKey || '').lastIndexOf(':');
                return {
                  figureId: String(item.panelKey || '').slice(0, separator),
                  panelId: String(item.panelKey || '').slice(separator + 1),
                  evidenceClass: item.evidenceClass,
                  evidenceClassSource: 'inferred'
                };
              })
            }));
            const draft = {
              revision: 0,
              mechanismChain: { initialized: true, nodes, edges }
            };
            const snapshot = {
              title: payload.title,
              figureWorkspaceDraft: draft,
              figures: {
                figures: payload.figures,
                draft,
                crossFigureLogic: { result: {
                  panelDispositions: payload.mechanismResult.panelDispositions
                } }
              }
            };
            currentWorkspaceSnapshot = snapshot;
            switchWorkspaceView('mechanism', { persist: false });
            renderMechanismChainWorkspace(snapshot, { coordinated: true });
            const view = document.querySelector('[data-workspace-view="mechanism"]');
            if (!view) throw new Error('MECHANISM_WORKSPACE_RENDER_INVALID');
            const options = SciLLM.mechanismPanelEvidenceOptions(payload.figures);
            const byDisplay = new Map();
            options.forEach(option => {
              const list = byDisplay.get(option.displayName) || [];
              list.push(option);
              byDisplay.set(option.displayName, list);
            });
            view.dataset.qaPaperKey = payload.paperKey;
            view.dataset.qaPaperTitle = payload.title;
            view.dataset.qaCanonicalPanelCount = String(options.length);
            view.querySelectorAll('.workspace-mechanism-matrix-evidence').forEach(chip => {
              const matches = byDisplay.get(String(chip.textContent || '').trim()) || [];
              if (matches.length === 1) {
                chip.dataset.qaPanelKey = `${matches[0].figureId}:${matches[0].panelId}`;
              }
            });
          }, { paperKey, title, figures, mechanismResult });
          await mechanismPage.waitForFunction(expectedCounts => {
            const view = document.querySelector('[data-workspace-view="mechanism"]');
            const nodeIds = new Set([...view?.querySelectorAll(
              '[data-mechanism-node-id]'
            ) || []].map(node => node.dataset.mechanismNodeId));
            const edgeIds = new Set([...view?.querySelectorAll(
              '[data-mechanism-edge-id]'
            ) || []].map(node => node.dataset.mechanismEdgeId));
            return view && view.hidden === false &&
              nodeIds.size === expectedCounts.nodeCount && edgeIds.size === expectedCounts.edgeCount &&
              view.querySelectorAll('.workspace-mechanism-matrix-evidence[data-qa-panel-key]').length ===
                expectedCounts.assignmentCount &&
              view.querySelectorAll('[data-panel-disposition-key]').length ===
                expectedCounts.nonLinkedCount;
          }, expected, { timeout: 30000 });
          const markers = await mechanismPage.evaluate(() => {
            const view = document.querySelector('[data-workspace-view="mechanism"]');
            const nodeIds = [...new Set([...view.querySelectorAll(
              '[data-mechanism-node-id]'
            )].map(node => node.dataset.mechanismNodeId))];
            const edgeIds = [...new Set([...view.querySelectorAll(
              '[data-mechanism-edge-id]'
            )].map(node => node.dataset.mechanismEdgeId))];
            const assignments = [...view.querySelectorAll(
              '.workspace-mechanism-matrix-evidence[data-qa-panel-key]'
            )].map(node => node.dataset.qaPanelKey);
            const dispositions = Object.fromEntries(assignments.map(key => [key, 'linked']));
            view.querySelectorAll('[data-panel-disposition-key]').forEach(node => {
              dispositions[node.dataset.panelDispositionKey] = node.dataset.panelDispositionStatus;
            });
            const rect = view.getBoundingClientRect();
            return {
              workspaceKind: 'mechanism',
              mechanismViewVisible: view.hidden === false && rect.width > 0 && rect.height > 0,
              paperKey: view.dataset.qaPaperKey,
              title: view.dataset.qaPaperTitle,
              canonicalPanelCount: Number(view.dataset.qaCanonicalPanelCount),
              edgeIds,
              assignmentKeys: assignments,
              dispositions,
              requiredUiElements: {
                mechanismView: view.hidden === false,
                networkCanvas: Boolean(view.querySelector(
                  '#mechanismChainList.workspace-mechanism-network-canvas'
                )),
                evidenceMatrix: Boolean(view.querySelector('.workspace-mechanism-matrix')),
                renderedNodes: nodeIds.length
              }
            };
          });
          if (Number(canonicalLedger?.entries?.length) !== Number(markers.canonicalPanelCount)) {
            throw new Error('MECHANISM_WORKSPACE_RENDER_INVALID');
          }
          await mechanismPage.screenshot({ path: filename, fullPage: false });
          return markers;
        },
        async close() {
          await context.close().catch(() => undefined);
          fs.rmSync(temporaryRoot, { recursive: true, force: true });
        }
      };
    }
  };
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--input') options.input = argv[++index];
    else if (argv[index] === '--extension') options.extension = argv[++index];
    else if (argv[index] === '--trusted-profile') options.trustedProfile = argv[++index];
    else if (argv[index] === '--inspection') options.inspection = argv[++index];
    else if (argv[index] === '--audit-existing') options.auditExisting = argv[++index];
    else if (argv[index] === '--output') options.output = argv[++index];
    else if (argv[index] === '--help') options.help = true;
  }
  return options;
}

function helpText() {
  return [
    'Mechanism Panel coverage real-paper gate',
    'Fresh run:',
    '  node scripts/verify-mechanism-panel-coverage.mjs --input <private-bootstrap.json>',
    '    --extension <unpacked-extension> --trusted-profile <unlocked-user-profile>',
    '    --output <private-artifact-dir>',
    'Audit existing (read-only; does not recapture or call a provider):',
    '  node scripts/verify-mechanism-panel-coverage.mjs --input <private-bootstrap.json>',
    '    --audit-existing <run-receipt.json> --inspection <review.json> --output <report-dir>',
    '',
    'Fresh execution requires HEADLESS=0, a trusted unlocked user profile copied read-only into',
    'a disposable directory, headed Microsoft Edge, the real extension background,',
    'the configured DeepSeek V4 Flash/Pro profiles, three external artifacts per paper, and network.',
    'Public reports never include paths, credentials, raw prompts, raw responses, or article text.'
  ].join('\n');
}

function readPrivateJson(filename, label) {
  const resolved = requireFile(filename, label);
  return JSON.parse(fs.readFileSync(resolved, 'utf8'));
}

function beginReport(outputDir) {
  fs.mkdirSync(outputDir, { recursive: true });
  activeReport = {
    filename: path.join(outputDir, 'qa-result.json'),
    runId: crypto.randomUUID(), generatedAt: new Date().toISOString()
  };
  writeJsonAtomically(activeReport.filename, {
    schemaVersion: 2, runId: activeReport.runId, generatedAt: activeReport.generatedAt,
    status: 'RUNNING', papers: [], profiles: [], pass: false
  });
}

export function safeRuntimeFailure(error) {
  const message = clean(error?.message || error, 300);
  if (message.startsWith('PENDING_EXTERNAL_INPUT:')) return message;
  if (/^(?:PROFILE_READINESS_FAILED|PROFILE_ROUTING_FAILED|MECHANISM_GENERATION_FAILED):[A-Z][A-Z0-9_-]{2,80}$/u
    .test(message)) return message;
  const allowed = new Set([
    'PANEL_MANIFEST_INVALID', 'PANEL_MANIFEST_LEDGER_MISMATCH',
    'PANEL_MANIFEST_DOCUMENT_IDENTITY_MISMATCH', 'PANEL_MANIFEST_SUPERSET_INVALID',
    'ARTIFACT_TITLE_BINDING_INVALID',
    'ARTICLE_ARCHIVE_TYPE_REQUIRED', 'ARTICLE_ARCHIVE_JSON_INVALID',
    'ARTICLE_ARCHIVE_SCHEMA_INVALID', 'ARTICLE_ARCHIVE_IDENTITY_MISMATCH',
    'ARTICLE_ARCHIVE_FIGURE_INVENTORY_INVALID',
    'PAPER_ARTIFACT_BINDING_FAILED', 'LIVE_ARTICLE_IDENTITY_FAILED',
    'PROVIDER_GENERATION_RECEIPT_INVALID', 'REAL_GATE_INCOMPLETE',
    'MECHANISM_WORKSPACE_RENDER_INVALID', 'SCREENSHOT_INVALID',
    'REASONING_PROBE_FAILED', 'PANEL_LEDGER_INCOMPLETE',
    'UNSAFE_INSPECTION_METADATA', 'INSPECTION_RECEIPT_BINDING_FAILED',
    'RUN_RECEIPT_INVALID', 'RUN_RECEIPT_ARTIFACT_TAMPERED',
    'RUN_RECEIPT_EXTENSION_TAMPERED', 'RUN_RECEIPT_MECHANISM_INVALID',
    'RUN_SCREENSHOT_TAMPERED'
  ]);
  return allowed.has(message) ? message : 'MECHANISM_PANEL_COVERAGE_VERIFIER_FAILED';
}

export function privateRuntimeFailureDiagnostic(error) {
  const name = /^[A-Za-z]+Error$/u.test(String(error?.name || ''))
    ? String(error.name) : 'Error';
  const messageSha256 = crypto.createHash('sha256')
    .update(String(error?.message || error || '')).digest('hex');
  const frames = [];
  for (const line of String(error?.stack || '').split(/\r?\n/u).slice(1)) {
    const match = line.match(/((?:[A-Za-z]:[\\/]|file:\/\/\/)[^():\r\n]+?\.(?:mjs|js)):(\d+):(\d+)/u);
    if (!match) continue;
    const file = path.basename(match[1].replace(/^file:\/\/\//u, '').replace(/\\/gu, '/'));
    frames.push({ file, line: Number(match[2]), column: Number(match[3]) });
    if (frames.length >= 8) break;
  }
  return Object.freeze({ name, messageSha256, frames: Object.freeze(frames) });
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const args = parseArguments(argv);
  if (args.help) { console.log(helpText()); return; }
  const outputDir = path.resolve(args.output || env.OUTPUT_DIR ||
    path.join(root, 'output', 'playwright', 'mechanism-panel-coverage'));
  beginReport(outputDir);
  const input = readPrivateJson(
    args.input || env.MECHANISM_COVERAGE_INPUT,
    'set --input or MECHANISM_COVERAGE_INPUT'
  );
  if (args.auditExisting) {
    const inspection = readPrivateJson(
      args.inspection || env.MECHANISM_COVERAGE_INSPECTION,
      'set --inspection or MECHANISM_COVERAGE_INSPECTION'
    );
    const audited = await auditExistingRun({
      receiptPath: args.auditExisting, papers: input.papers, inspection
    });
    const report = {
      ...audited.publicReport, runId: activeReport.runId,
      generatedAt: activeReport.generatedAt, status: 'COMPLETED'
    };
    writeJsonAtomically(activeReport.filename, report);
    console.log(JSON.stringify(report, null, 2));
    if (!report.pass) process.exitCode = 1;
    return report;
  }
  const extensionPath = args.extension || env.EXTENSION_PATH;
  if (!extensionPath) throw new Error('PENDING_EXTERNAL_INPUT: set --extension or EXTENSION_PATH');
  const trustedProfileDir = args.trustedProfile || input.trustedProfileDir ||
    env.MECHANISM_COVERAGE_TRUSTED_PROFILE;
  if (!trustedProfileDir) {
    throw new Error('PENDING_EXTERNAL_INPUT: set --trusted-profile or private trustedProfileDir');
  }
  if (env.HEADLESS !== '0') throw new Error('PENDING_EXTERNAL_INPUT: headed Edge requires HEADLESS=0');
  const receipt = await executeFreshRun({
    papers: input.papers, profiles: input.profiles, extensionPath, trustedProfileDir, outputDir
  }, { driver: createPlaywrightDriver() });
  const report = {
    schemaVersion: 2, runId: activeReport.runId, generatedAt: activeReport.generatedAt,
    status: 'AWAITING_INSPECTION', receiptSha256: hashFile(path.join(outputDir, 'run-receipt.json')),
    papers: receipt.paperBindings.map(binding => ({
      key: binding.paperKey, title: binding.title, identifier: binding.identifier,
      hashes: {
        pdfSha256: binding.pdfSha256, archiveSha256: binding.archiveSha256,
        panelManifestSha256: binding.panelManifestSha256
      },
      pageCount: binding.pageCount, pass: false
    })),
    profiles: requiredProfiles.map(profile => ({
      profileLabel: profile.profileLabel, completedRuns: 3, pass: false
    })),
    pass: false
  };
  writeJsonAtomically(activeReport.filename, report);
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = 1;
  return report;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath && pathToFileURL(invokedPath).href === import.meta.url) {
  main().catch(error => {
    const failure = {
      schemaVersion: 2, runId: activeReport?.runId || crypto.randomUUID(),
      generatedAt: activeReport?.generatedAt || new Date().toISOString(),
      status: 'FAILED', papers: [], profiles: [], pass: false,
      error: safeRuntimeFailure(error)
    };
    if (activeReport?.filename) writeJsonAtomically(activeReport.filename, failure);
    if (process.env.BREVESS_PRIVATE_QA_DIAGNOSTIC === '1') {
      console.error(`PRIVATE_DIAGNOSTIC ${JSON.stringify(privateRuntimeFailureDiagnostic(error))}`);
    }
    console.error(JSON.stringify(failure, null, 2));
    process.exitCode = 1;
  });
}
