#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'benchmarks', 'checkpoint2');
const corpusRoot = path.resolve(process.env.ZOTERO_MINERU_ROOT || path.join(
  os.homedir(), 'Zotero', 'llm-for-zotero-mineru'
));
const assetDir = path.join(out, 'review-assets', 'figures');
const manifestRows = fs.readFileSync(path.join(out, 'corpus-manifest.jsonl'), 'utf8')
  .trim().split('\n').map(JSON.parse)
  .filter(item => item.articleLike && ['development', 'validation'].includes(item.split));
const desired = [
  'microscopy', 'western_blot', 'flow_cytometry', 'bar_or_line',
  'survival_curve', 'heatmap_or_umap', 'multi_panel', 'unstable_or_unlabeled_panels'
];
// Deterministic exclusions discovered by the required visual QA pass.  These
// are source-image hashes, so the decision remains reproducible if the queue is
// rebuilt.  The first item has a survival caption but the extracted bitmap is
// only the recurrence schematic, not the Kaplan-Meier panels.
const visualQaRejects = new Map([
  ['03741337186b2647d4685ef6a2b0d5dde028daae2196ac882177d7737b18df50',
    'caption/image mismatch: extracted bitmap does not contain the survival curves'],
  ['01bb544b1fb127dd97a902a4f38cf9cedf112934fa94c77cfff94665cc1077b1',
    'caption/image mismatch: extracted bitmap is an isolated blot Panel, not the captioned survival panels'],
  ['3514c7135b4c8497be8b061ed8c4e2eba3b7de505a1accd6b6e7a463b6d32dc2',
    'not a survival curve: extracted Figure is a subgroup forest plot']
]);
const candidates = [];

for (const document of manifestRows) {
  const directory = path.join(corpusRoot, document.mineruDirectory);
  const manifestPath = path.join(directory, 'manifest.json');
  if (!fs.existsSync(manifestPath)) continue;
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch { continue; }
  for (const entry of figureEntries(manifest, directory)) {
    const dimensions = imageDimensions(entry.absolutePath);
    const bytes = fs.statSync(entry.absolutePath).size;
    if (!dimensions || dimensions.width < 250 || dimensions.height < 140 || bytes < 5000) continue;
    const classified = classifyFigure(entry);
    if (dimensions.width < 700 || dimensions.width * dimensions.height < 400000) {
      classified.modalities = classified.modalities.filter(item => item !== 'survival_curve');
    }
    const imageSha256 = hashFile(entry.absolutePath);
    if (visualQaRejects.has(imageSha256)) continue;
    candidates.push({
      document, entry, dimensions, bytes,
      imageSha256,
      ...classified
    });
  }
}

const selected = [];
const imageHashes = new Set();
const clusterCounts = new Map();
function add(candidate) {
  if (!candidate || imageHashes.has(candidate.imageSha256)) return false;
  if ((clusterCounts.get(candidate.document.clusterId) || 0) >= 1) return false;
  imageHashes.add(candidate.imageSha256);
  clusterCounts.set(candidate.document.clusterId,
    (clusterCounts.get(candidate.document.clusterId) || 0) + 1);
  selected.push(candidate);
  return true;
}

for (const modality of desired) {
  const ranked = candidates.filter(item => item.modalities.includes(modality))
    .filter(item => modality !== 'survival_curve' ||
      (item.dimensions.width >= 700 && item.dimensions.width * item.dimensions.height >= 400000))
    .sort((left, right) =>
      score(right, modality) - score(left, modality) ||
      left.imageSha256.localeCompare(right.imageSha256)
    );
  for (const candidate of ranked) {
    if (selected.filter(item => item.modalities.includes(modality)).length >= 2) break;
    add(candidate);
  }
}

candidates.sort((left, right) =>
  score(right, 'fill') - score(left, 'fill') ||
  left.imageSha256.localeCompare(right.imageSha256)
).forEach(candidate => {
  if (selected.length < 30) add(candidate);
});

if (selected.length < 30) throw new Error(`Only ${selected.length} unique Figure images passed QA`);
fs.mkdirSync(assetDir, { recursive: true });
const items = selected.slice(0, 30).map((candidate, index) => {
  const extension = path.extname(candidate.entry.absolutePath).toLowerCase() || '.png';
  const assetName = `figure-${String(index + 1).padStart(3, '0')}${extension}`;
  fs.copyFileSync(candidate.entry.absolutePath, path.join(assetDir, assetName));
  return {
    queueId: `figure-${String(index + 1).padStart(3, '0')}`,
    documentId: candidate.document.documentId,
    clusterId: candidate.document.clusterId,
    split: candidate.document.split,
    studyType: candidate.document.studyType,
    title: candidate.document.title,
    figureLabel: candidate.entry.label,
    caption: candidate.entry.caption,
    pdfPage: candidate.entry.page,
    sourcePdfAlias: candidate.document.sourcePdf?.aliasPath || '',
    imageAsset: `review-assets/figures/${assetName}`,
    imageSha256: candidate.imageSha256,
    imageWidth: candidate.dimensions.width,
    imageHeight: candidate.dimensions.height,
    candidateModalities: candidate.modalities,
    stablePanelLabelsFound: candidate.panelLabels,
    adjudication: {
      panelLabels: [], captionPairing: '', groups: [], comparisons: [], methods: [],
      directObservations: [], evidenceLevel: '', unsupportedConclusions: [], reviewerNote: ''
    }
  };
});
const modalityCoverage = Object.fromEntries(desired.map(modality => [
  modality, items.filter(item => item.candidateModalities.includes(modality)).length
]));
const queue = {
  formatVersion: 1,
  generatedAt: new Date().toISOString(),
  queueKind: 'blind_real_figure_seed_gold',
  goldStatus: 'unadjudicated',
  captionOnlyGoldAllowed: false,
  actualImageRequired: true,
  lockedTestItemsIncluded: false,
  requestedMinimum: 30,
  selectionQa: {
    minimumWidth: 250,
    minimumHeight: 140,
    minimumBytes: 5000,
    exactImageSha256Deduplication: true,
    maximumPerDocumentCluster: 1,
    curatedVisualQaRejects: Object.fromEntries(visualQaRejects),
    survivalPriority: 'Stable Figure/Fig label plus explicit Kaplan-Meier, OS, or PFS caption; extracted bitmap width >= 700 and area >= 400,000 pixels'
  },
  modalityCoverage,
  items
};
fs.writeFileSync(path.join(out, 'figure-review-queue.json'), stableJson(queue), 'utf8');
const corpusReportPath = path.join(out, 'Checkpoint2_Corpus_And_Split_Report.md');
if (fs.existsSync(corpusReportPath)) {
  const report = fs.readFileSync(corpusReportPath, 'utf8');
  const coverage = Object.entries(modalityCoverage)
    .map(([id, count]) => `${id}=${count}`).join(', ');
  const section = `## Figure 队列\n\n- 实际提取图像：${items.length}\n- 唯一源图 SHA-256：${new Set(items.map(item => item.imageSha256)).size}\n- 每个 document cluster 最多入选：1\n- locked_test 项：0\n- 仅图注项：0（每个项目均复制实际图像资产）\n- 模态候选覆盖：${coverage}\n\nFigure 候选模态只用于分层抽样，不是视觉 Gold。队列已经过像素尺寸、文件体积、精确图像哈希和接触表目视复核；目视发现的图注—位图错配以源图 SHA-256 排除项固化。Panel、图注配对、分组、比较、方法、直接观察、证据等级与不可支持结论仍须人工联合查看原图和图注后填写。\n`;
  fs.writeFileSync(corpusReportPath, report.replace(/## Figure 队列[\s\S]*$/u, section), 'utf8');
}
console.log(JSON.stringify({ items: items.length, modalityCoverage,
  uniqueImageHashes: new Set(items.map(item => item.imageSha256)).size }, null, 2));

function score(candidate, modality) {
  const caption = candidate.entry.caption.toLowerCase();
  const stableFigure = /^(?:fig\.?|figure)\s*[s\d]/i.test(candidate.entry.label);
  let value = candidate.modalities.length * 8;
  value += Math.min(30, Math.log10(candidate.bytes) * 4);
  value += Math.min(20, candidate.dimensions.width * candidate.dimensions.height / 100000);
  if (stableFigure) value += 35;
  if (candidate.document.split === 'development') value += 3;
  if (modality === 'survival_curve') {
    if (/kaplan[–-]?meier/.test(caption)) value += 150;
    if (/\b(?:os|pfs)\b|overall survival|progression.free survival/.test(caption)) value += 70;
    if (stableFigure) value += 60;
  }
  if (modality === 'western_blot' && /western blot|immunoblot/.test(caption)) value += 50;
  if (modality === 'flow_cytometry' && /flow cytometr|facs|gating/.test(caption)) value += 50;
  if (modality === 'heatmap_or_umap' && /heatmap|umap|t-sne|tsne/.test(caption)) value += 50;
  if (modality === 'unstable_or_unlabeled_panels' && !candidate.entry.caption) value -= 25;
  return value;
}

function figureEntries(manifest, directory) {
  const values = [];
  const append = item => {
    const relativePath = String(item?.path || '').replace(/\\/g, '/');
    const absolutePath = path.resolve(directory, relativePath);
    if (!relativePath || !absolutePath.startsWith(path.resolve(directory) + path.sep) ||
        !fs.existsSync(absolutePath)) return;
    const label = clean(item?.label);
    const caption = clean(item?.caption);
    if (/^table\b/i.test(label)) return;
    values.push({ label, caption, page: Number(item?.page) || null, relativePath, absolutePath });
  };
  (manifest.allFigures || []).forEach(append);
  (manifest.sections || []).forEach(section => {
    (section.figures || []).forEach(append);
    (section.tables || []).filter(item => /\bfig(?:ure)?\b/i.test(
      `${item?.label || ''} ${item?.caption || ''}`
    )).forEach(append);
  });
  const seen = new Set();
  return values.filter(item => {
    const key = path.resolve(item.absolutePath).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}

function classifyFigure(entry) {
  const text = `${entry.label} ${entry.caption}`.toLowerCase();
  const modalities = [];
  if (/microscop|immunofluores|immunohist|stain|scale bar|confocal|histolog|representative image/.test(text)) modalities.push('microscopy');
  if (/western blot|immunoblot|\bwb\b/.test(text)) modalities.push('western_blot');
  if (/flow cytometr|\bfacs\b|gating/.test(text)) modalities.push('flow_cytometry');
  if (/bar graph|line graph|time course|dose.response|quantification|mean [±+]/.test(text)) modalities.push('bar_or_line');
  if (/kaplan[–—-]?meier|survival curves?/.test(text)) modalities.push('survival_curve');
  if (/heatmap|umap|t-sne|tsne|cluster map/.test(text)) modalities.push('heatmap_or_umap');
  const labels = [...text.matchAll(/\(([a-z])\)|\bpanel\s+([a-z])\b/gi)]
    .map(match => (match[1] || match[2]).toUpperCase());
  if (new Set(labels).size >= 2 || /multi[- ]panel|panels? [a-z](?:[-–][a-z])?/.test(text)) modalities.push('multi_panel');
  if (!labels.length && (/^image[-_ ]?\d+$/i.test(entry.label) || !entry.caption)) modalities.push('unstable_or_unlabeled_panels');
  return { modalities: [...new Set(modalities)], panelLabels: [...new Set(labels)] };
}

function imageDimensions(file) {
  const buffer = fs.readFileSync(file);
  if (buffer.length >= 24 && buffer.toString('ascii', 1, 4) === 'PNG') {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (buffer.length >= 10 && ['GIF87a', 'GIF89a'].includes(buffer.toString('ascii', 0, 6))) {
    return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) { offset += 1; continue; }
      const marker = buffer[offset + 1];
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) };
      }
      const length = buffer.readUInt16BE(offset + 2);
      if (!length) break;
      offset += length + 2;
    }
  }
  return null;
}

function hashFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function clean(value) {
  return String(value || '').normalize('NFKC').replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function stableJson(value) {
  const stable = item => Array.isArray(item) ? item.map(stable)
    : item && typeof item === 'object'
      ? Object.fromEntries(Object.keys(item).sort().map(key => [key, stable(item[key])]))
      : item;
  return `${JSON.stringify(stable(value), null, 2)}\n`;
}
